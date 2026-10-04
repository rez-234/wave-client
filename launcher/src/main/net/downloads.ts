import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'

import { HttpClient, HttpError, abortableSleep, redactUrl } from './http'

/** One file to fetch. */
export interface DownloadItem {
  url: string
  /** Absolute destination path. */
  path: string
  /** Expected SHA-1 (lowercase hex). Downloads without one are only checked for size. */
  sha1?: string
  size?: number
  /** Mark the file executable after download (non-Windows). */
  executable?: boolean
}

export interface DownloadProgress {
  totalFiles: number
  doneFiles: number
  /** Sum of known sizes; files without a size count once they finish. */
  totalBytes: number
  doneBytes: number
}

export type VerifyMode =
  /** Existing files are trusted when their size matches (hash checked when no size is known). Fast. */
  | 'size'
  /** Every existing file's SHA-1 is checked: "repair". */
  | 'hash'

export interface DownloadOptions {
  signal?: AbortSignal
  onProgress?: (progress: DownloadProgress) => void
  verify?: VerifyMode
}

export class DownloadError extends Error {
  constructor(readonly failures: { item: DownloadItem; error: unknown }[]) {
    super(
      `${failures.length} download${failures.length === 1 ? '' : 's'} failed: ` +
        failures
          .slice(0, 3)
          .map((failure) => `${redactUrl(failure.item.url)} (${describe(failure.error)})`)
          .join('; ') +
        (failures.length > 3 ? '; …' : '')
    )
    this.name = 'DownloadError'
  }
}

export class HashMismatchError extends Error {
  constructor(readonly url: string, readonly expected: string, readonly actual: string) {
    super(`SHA-1 mismatch for ${redactUrl(url)}: expected ${expected}, got ${actual}`)
    this.name = 'HashMismatchError'
  }
}

export class SizeMismatchError extends Error {
  constructor(readonly url: string, readonly expected: number, readonly actual: number) {
    super(`Size mismatch for ${redactUrl(url)}: expected ${expected} bytes, got ${actual}`)
    this.name = 'SizeMismatchError'
  }
}

export interface DownloadQueueConfig {
  http: HttpClient
  concurrency?: number
  /** Extra attempts per file after the first (network errors, bad hashes, truncated bodies). */
  retries?: number
  backoffMs?: (attempt: number) => number
  progressIntervalMs?: number
}

/**
 * Downloads many files in parallel. Each file is written to "<path>.part", checked against its
 * size and SHA-1, then renamed into place, so a crash or a bad mirror never leaves a corrupt file
 * where the game will load it. Files that are already present and valid are skipped.
 */
export class DownloadQueue {
  private readonly http: HttpClient
  private readonly concurrency: number
  private readonly retries: number
  private readonly backoffMs: (attempt: number) => number
  private readonly progressIntervalMs: number

  constructor(config: DownloadQueueConfig) {
    this.http = config.http
    this.concurrency = Math.max(1, config.concurrency ?? 8)
    this.retries = Math.max(0, config.retries ?? 3)
    this.backoffMs = config.backoffMs ?? ((attempt) => Math.min(10_000, 1000 * 2 ** attempt))
    this.progressIntervalMs = config.progressIntervalMs ?? 100
  }

  async run(items: DownloadItem[], options: DownloadOptions = {}): Promise<void> {
    const unique = dedupe(items)
    const progress: DownloadProgress = {
      totalFiles: unique.length,
      doneFiles: 0,
      totalBytes: unique.reduce((sum, item) => sum + (item.size ?? 0), 0),
      doneBytes: 0
    }
    let lastReport = 0
    const report = (force = false): void => {
      const now = Date.now()

      if (options.onProgress && (force || now - lastReport >= this.progressIntervalMs)) {
        lastReport = now
        options.onProgress({ ...progress })
      }
    }

    const failures: { item: DownloadItem; error: unknown }[] = []
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < unique.length) {
        options.signal?.throwIfAborted()
        const item = unique[next++]!

        try {
          await this.fetchOne(item, options, (bytes) => {
            progress.doneBytes += bytes
            report()
          })
        } catch (error) {
          if (options.signal?.aborted) {
            throw error
          }

          failures.push({ item, error })
        }

        progress.doneFiles++
        report()
      }
    }

    report(true)
    await Promise.all(Array.from({ length: Math.min(this.concurrency, unique.length) }, worker))
    report(true)

    if (failures.length > 0) {
      throw new DownloadError(failures)
    }
  }

  /** Makes sure one file is present and valid, downloading it if needed. Reports bytes as they arrive. */
  private async fetchOne(item: DownloadItem, options: DownloadOptions, onBytes: (bytes: number) => void): Promise<void> {
    if (await isValid(item, options.verify ?? 'size')) {
      onBytes(item.size ?? 0)
      return
    }

    let lastError: unknown

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      let counted = 0

      try {
        await this.download(item, options.signal, (bytes) => {
          counted += bytes
          onBytes(bytes)
        })
        return
      } catch (error) {
        // Take back this attempt's bytes so the bar doesn't overshoot on a retry.
        onBytes(-counted)

        if (options.signal?.aborted || !isRetryable(error)) {
          throw error
        }

        lastError = error

        if (attempt < this.retries) {
          await abortableSleep(this.backoffMs(attempt), options.signal)
        }
      }
    }

    throw lastError
  }

  private async download(item: DownloadItem, signal: AbortSignal | undefined, onBytes: (bytes: number) => void): Promise<void> {
    const part = `${item.path}.part`
    await mkdir(dirname(item.path), { recursive: true })
    // Retries are handled here per file, so the request itself isn't retried.
    const response = await this.http.get(item.url, { signal, retries: 0, timeoutMs: 60_000 })

    if (!response.body) {
      throw new Error(`Empty response from ${redactUrl(item.url)}`)
    }

    const hash = createHash('sha1')
    let size = 0
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk)
        size += chunk.length
        onBytes(chunk.length)
        callback(null, chunk)
      }
    })

    try {
      await pipeline(Readable.fromWeb(response.body as WebReadableStream<Uint8Array>), meter, createWriteStream(part), { signal })

      if (item.size !== undefined && size !== item.size) {
        throw new SizeMismatchError(item.url, item.size, size)
      }

      const actual = hash.digest('hex')

      if (item.sha1 && actual !== item.sha1.toLowerCase()) {
        throw new HashMismatchError(item.url, item.sha1, actual)
      }

      await rename(part, item.path)
    } catch (error) {
      await rm(part, { force: true })
      throw error
    }

    if (item.executable && process.platform !== 'win32') {
      await chmod(item.path, 0o755)
    }
  }
}

/** Whether the file on disk already matches the item. */
export async function isValid(item: DownloadItem, verify: VerifyMode): Promise<boolean> {
  let size: number

  try {
    const info = await stat(item.path)

    if (!info.isFile()) {
      return false
    }

    size = info.size
  } catch {
    return false
  }

  if (item.size !== undefined && size !== item.size) {
    return false
  }

  if (item.sha1 && (verify === 'hash' || item.size === undefined)) {
    return (await sha1File(item.path)) === item.sha1.toLowerCase()
  }

  return true
}

export async function sha1File(path: string): Promise<string> {
  const hash = createHash('sha1')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

function dedupe(items: DownloadItem[]): DownloadItem[] {
  const byPath = new Map<string, DownloadItem>()

  for (const item of items) {
    if (!byPath.has(item.path)) {
      byPath.set(item.path, item)
    }
  }

  return [...byPath.values()]
}

function isRetryable(error: unknown): boolean {
  if (error instanceof HttpError) {
    return error.status === 408 || error.status === 429 || error.status >= 500
  }

  // Bad hashes, truncated bodies and network errors are worth another try.
  return true
}

function describe(error: unknown): string {
  if (error instanceof HttpError) {
    return `HTTP ${error.status}`
  }

  return error instanceof Error ? error.message : String(error)
}
