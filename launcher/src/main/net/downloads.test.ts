import { createHash } from 'node:crypto'
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DownloadError, DownloadQueue, type DownloadProgress } from './downloads'
import { HttpClient, HttpError, NetworkError, type FetchFn } from './http'

/** When set, writing a downloaded file fails as if the disk were full. */
let diskFull = false

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return {
    ...fs,
    createWriteStream: (...args: Parameters<typeof fs.createWriteStream>) => {
      const stream = fs.createWriteStream(...args)

      if (diskFull) {
        stream.destroy(Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' }))
      }

      return stream
    }
  }
})

const sha1 = (text: string): string => createHash('sha1').update(text).digest('hex')

/** A fake fetch serving fixed bodies; each URL can fail a number of times first. */
function fakeFetch(files: Record<string, string>, failures: Record<string, (number | 'reset' | string)[]> = {}): { fetch: FetchFn; calls: string[] } {
  const calls: string[] = []
  const fetch: FetchFn = async (url) => {
    calls.push(url)
    const queue = failures[url]
    const failure = queue?.shift()

    if (failure === 'reset') {
      throw new TypeError('fetch failed')
    }

    if (typeof failure === 'number') {
      return new Response('nope', { status: failure })
    }

    if (typeof failure === 'string') {
      // Serve a corrupt body once.
      return new Response(failure)
    }

    const body = files[url]
    return body === undefined ? new Response('missing', { status: 404 }) : new Response(body)
  }

  return { fetch, calls }
}

/** A body that sends `chunks` pieces, `everyMs` apart, and stops when the request is aborted. */
function trickle(chunks: number, everyMs: number, signal?: AbortSignal | null): ReadableStream<Uint8Array> {
  let timer: NodeJS.Timeout | undefined
  return new ReadableStream({
    start(controller) {
      let sent = 0
      signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        controller.error(signal.reason)
      })
      const tick = (): void => {
        if (sent === chunks) {
          controller.close()
          return
        }

        sent++
        controller.enqueue(new TextEncoder().encode('x'))
        timer = setTimeout(tick, everyMs)
      }
      timer = setTimeout(tick, everyMs)
    },
    cancel() {
      clearTimeout(timer)
    }
  })
}

function client(fetch: FetchFn): HttpClient {
  return new HttpClient({ fetch, userAgent: 'test', backoffMs: () => 0, sleep: async () => {} })
}

describe('HttpClient', () => {
  it('retries transient statuses and network errors on GET', async () => {
    const { fetch, calls } = fakeFetch({ 'https://x/a': '{"ok":true}' }, { 'https://x/a': [503, 'reset', 429] })
    await expect(client(fetch).getJson('https://x/a')).resolves.toEqual({ ok: true })
    expect(calls).toHaveLength(4)
  })

  it('does not retry client errors', async () => {
    const { fetch, calls } = fakeFetch({}, {})
    await expect(client(fetch).getJson('https://x/missing')).rejects.toBeInstanceOf(HttpError)
    expect(calls).toHaveLength(1)
  })

  it('does not retry POSTs by default', async () => {
    const { fetch, calls } = fakeFetch({}, { 'https://x/post': [503] })
    await expect(client(fetch).postJson('https://x/post', {})).rejects.toMatchObject({ status: 503 })
    expect(calls).toHaveLength(1)
  })

  it("turns any transport failure into a NetworkError, Electron's net::ERR_ errors included", async () => {
    const calls: string[] = []
    const fetch: FetchFn = async (url) => {
      calls.push(url)
      throw new Error('net::ERR_INTERNET_DISCONNECTED')
    }
    const error = await client(fetch).getJson('https://x/a').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(NetworkError)
    expect((error as NetworkError).message).toMatch(/ERR_INTERNET_DISCONNECTED/)
    expect(calls).toHaveLength(4)
  })

  it('passes a cancel through as it is', async () => {
    const controller = new AbortController()
    const fetch: FetchFn = (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))
    const pending = client(fetch).getJson('https://x/a', { signal: controller.signal }).catch((e: unknown) => e)
    controller.abort()
    expect(await pending).toMatchObject({ name: 'AbortError' })
  })

  it('gives up waiting for an answer, but not on a download that keeps arriving', async () => {
    const silent: FetchFn = (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('net::ERR_ABORTED'))))
    await expect(client(silent).get('https://x/a', { timeoutMs: 30, retries: 0 })).rejects.toMatchObject({ name: 'NetworkError', timedOut: true })

    // 6 pieces 20 ms apart: longer than the 30 ms deadline in total, but never silent for that long.
    const slow: FetchFn = async (_url, init) => new Response(trickle(6, 20, init?.signal))
    const response = await client(slow).get('https://x/a', { timeoutMs: 30, retries: 0 })
    expect(await response.text()).toBe('xxxxxx')
  })

  it('still limits a JSON body that stops arriving', async () => {
    const stuck: FetchFn = async (_url, init) => new Response(trickle(1_000, 10_000, init?.signal))
    await expect(client(stuck).getJson('https://x/a', { timeoutMs: 30, retries: 0 })).rejects.toMatchObject({ name: 'NetworkError', timedOut: true })
  })

  it('keeps query strings out of error messages', async () => {
    const { fetch } = fakeFetch({})
    await expect(client(fetch).getJson('https://x/missing?code=secret')).rejects.toThrow(/https:\/\/x\/missing\?…/)
    await expect(client(fetch).getJson('https://x/missing?code=secret')).rejects.not.toThrow(/secret/)
  })
})

describe('DownloadQueue', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wave-dl-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const item = (name: string, body: string, extra: object = {}) => ({
    url: `https://x/${name}`,
    path: join(dir, 'sub', name),
    sha1: sha1(body),
    size: body.length,
    ...extra
  })

  it('downloads, verifies and reports progress', async () => {
    const { fetch } = fakeFetch({ 'https://x/a': 'alpha', 'https://x/b': 'bravo!' })
    const reports: DownloadProgress[] = []
    await new DownloadQueue({ http: client(fetch), progressIntervalMs: 0 }).run([item('a', 'alpha'), item('b', 'bravo!')], {
      onProgress: (p) => reports.push(p)
    })

    expect(await readFile(join(dir, 'sub', 'a'), 'utf8')).toBe('alpha')
    expect(await readFile(join(dir, 'sub', 'b'), 'utf8')).toBe('bravo!')
    expect(reports.at(-1)).toEqual({ totalFiles: 2, doneFiles: 2, totalBytes: 11, doneBytes: 11 })
    expect(await readdir(join(dir, 'sub'))).toEqual(['a', 'b'])
  })

  it('retries a corrupt body and never leaves a .part file', async () => {
    const { fetch, calls } = fakeFetch({ 'https://x/a': 'alpha' }, { 'https://x/a': ['alphX'] })
    const reports: DownloadProgress[] = []
    await new DownloadQueue({ http: client(fetch), backoffMs: () => 0, progressIntervalMs: 0 }).run([item('a', 'alpha')], {
      onProgress: (p) => reports.push(p)
    })

    expect(calls).toHaveLength(2)
    expect(await readdir(join(dir, 'sub'))).toEqual(['a'])
    expect(reports.at(-1)?.doneBytes).toBe(5)
  })

  it('gives up after the retries and reports every failure', async () => {
    const { fetch } = fakeFetch({ 'https://x/a': 'alpha', 'https://x/b': 'wrong' })
    const queue = new DownloadQueue({ http: client(fetch), retries: 1, backoffMs: () => 0 })
    const error = await queue.run([item('a', 'alpha'), item('b', 'bravo')]).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(DownloadError)
    expect((error as DownloadError).failures.map((f) => f.item.url)).toEqual(['https://x/b'])
    expect(await readdir(join(dir, 'sub'))).toEqual(['a'])
  })

  it('does not retry a 404', async () => {
    const { fetch, calls } = fakeFetch({})
    await expect(new DownloadQueue({ http: client(fetch), backoffMs: () => 0 }).run([item('a', 'alpha')])).rejects.toBeInstanceOf(DownloadError)
    expect(calls).toHaveLength(1)
  })

  it('skips valid files, re-downloads damaged ones, and hashes everything in repair mode', async () => {
    const { fetch, calls } = fakeFetch({ 'https://x/a': 'alpha', 'https://x/b': 'bravo' })
    const queue = new DownloadQueue({ http: client(fetch) })
    await queue.run([item('a', 'alpha'), item('b', 'bravo')])
    expect(calls).toHaveLength(2)

    await queue.run([item('a', 'alpha'), item('b', 'bravo')])
    expect(calls).toHaveLength(2)

    // Same size, different content: only a hash check notices.
    await writeFile(join(dir, 'sub', 'b'), 'brava')
    await queue.run([item('a', 'alpha'), item('b', 'bravo')])
    expect(calls).toHaveLength(2)
    await queue.run([item('a', 'alpha'), item('b', 'bravo')], { verify: 'hash' })
    expect([...calls].sort()).toEqual(['https://x/a', 'https://x/b', 'https://x/b'])
    expect(await readFile(join(dir, 'sub', 'b'), 'utf8')).toBe('bravo')
  })

  it('downloads a file listed twice once', async () => {
    const { fetch, calls } = fakeFetch({ 'https://x/a': 'alpha' })
    await new DownloadQueue({ http: client(fetch) }).run([item('a', 'alpha'), item('a', 'alpha')])
    expect(calls).toHaveLength(1)
  })

  it('marks executables', async () => {
    if (process.platform === 'win32') {
      return
    }

    const { fetch } = fakeFetch({ 'https://x/java': 'bin' })
    await new DownloadQueue({ http: client(fetch) }).run([item('java', 'bin', { executable: true })])
    expect((await stat(join(dir, 'sub', 'java'))).mode & 0o111).not.toBe(0)
  })

  it('drops a download that stops sending data, and tries again', async () => {
    let calls = 0
    const fetch: FetchFn = async (_url, init) => {
      calls++
      // The first attempt sends one byte and then nothing.
      return new Response(calls === 1 ? trickle(1_000, 10_000, init?.signal) : 'alpha')
    }
    await new DownloadQueue({ http: client(fetch), backoffMs: () => 0, stallTimeoutMs: 50 }).run([item('a', 'alpha')])
    expect(calls).toBe(2)
    expect(await readFile(join(dir, 'sub', 'a'), 'utf8')).toBe('alpha')
  })

  it('does not retry a full disk', async () => {
    const { fetch, calls } = fakeFetch({ 'https://x/a': 'alpha' })
    diskFull = true

    try {
      const error = await new DownloadQueue({ http: client(fetch), backoffMs: () => 0 }).run([item('a', 'alpha')]).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(DownloadError)
      expect((error as DownloadError).failures[0]?.error).toMatchObject({ code: 'ENOSPC' })
      expect(calls).toHaveLength(1)
    } finally {
      diskFull = false
    }
  })

  it('makes an installed executable executable again', async () => {
    if (process.platform === 'win32') {
      return
    }

    const { fetch, calls } = fakeFetch({ 'https://x/java': 'bin' })
    const queue = new DownloadQueue({ http: client(fetch) })
    await queue.run([item('java', 'bin', { executable: true })])
    await chmod(join(dir, 'sub', 'java'), 0o644)
    await queue.run([item('java', 'bin', { executable: true })])
    expect((await stat(join(dir, 'sub', 'java'))).mode & 0o111).not.toBe(0)
    expect(calls).toHaveLength(1)
  })

  it('counts files without a known size in the total as they arrive', async () => {
    const { fetch } = fakeFetch({ 'https://x/a': 'alpha', 'https://x/b': 'bravo!' })
    const reports: DownloadProgress[] = []
    await new DownloadQueue({ http: client(fetch), progressIntervalMs: 0 }).run([item('a', 'alpha'), item('b', 'bravo!', { size: undefined })], {
      onProgress: (p) => reports.push(p)
    })
    expect(reports.every((p) => p.doneBytes <= p.totalBytes)).toBe(true)
    expect(reports.at(-1)).toMatchObject({ totalBytes: 11, doneBytes: 11 })
  })

  it('reports nothing after a cancel, and returns only when every file is left alone', async () => {
    const controller = new AbortController()
    const reports: DownloadProgress[] = []
    let open = 0
    const fetch: FetchFn = async (url, init) => {
      open++
      init?.signal?.addEventListener('abort', () => setTimeout(() => open--, 20))
      // "a" is cancelled at once; "b" is still streaming when that happens.
      if (url.endsWith('/a')) {
        setTimeout(() => controller.abort(), 5)
      }

      return new Response(trickle(1_000, 1, init?.signal))
    }
    const run = new DownloadQueue({ http: client(fetch), progressIntervalMs: 0 }).run([item('a', 'a'.repeat(1000)), item('b', 'b'.repeat(1000))], {
      signal: controller.signal,
      onProgress: (p) => reports.push(p)
    })
    await expect(run).rejects.toThrow()
    const count = reports.length
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(reports.length).toBe(count)
    expect(await readdir(join(dir, 'sub')).catch(() => [])).toEqual([])
  })

  it('stops when cancelled', async () => {
    const controller = new AbortController()
    const { fetch } = fakeFetch({ 'https://x/a': 'alpha' })
    controller.abort()
    await expect(new DownloadQueue({ http: client(fetch) }).run([item('a', 'alpha')], { signal: controller.signal })).rejects.toThrow()
  })
})
