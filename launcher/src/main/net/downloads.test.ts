import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DownloadError, DownloadQueue, type DownloadProgress } from './downloads'
import { HttpClient, HttpError, type FetchFn } from './http'

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

  it('stops when cancelled', async () => {
    const controller = new AbortController()
    const { fetch } = fakeFetch({ 'https://x/a': 'alpha' })
    controller.abort()
    await expect(new DownloadQueue({ http: client(fetch) }).run([item('a', 'alpha')], { signal: controller.signal })).rejects.toThrow()
  })
})
