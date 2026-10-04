import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { lstat, mkdtemp, readFile, readlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DownloadQueue } from '../net/downloads'
import { HttpClient, type FetchFn } from '../net/http'
import { JAVA_RUNTIME_INDEX, NoManagedJavaError, installJavaRuntime, javaExecutable, parseJavaVersion, runtimePlatformKey } from './java'

const sha1 = (text: string): string => createHash('sha1').update(text).digest('hex')
const realIndex = JSON.parse(readFileSync(join(__dirname, '../../../test/fixtures/java-runtime-all.json'), 'utf8')) as Record<
  string,
  Record<string, { manifest: { url: string; sha1: string } }[]>
>

describe('platform keys', () => {
  it('maps every platform Mojang ships for, and nothing else', () => {
    expect(runtimePlatformKey('win32', 'x64')).toBe('windows-x64')
    expect(runtimePlatformKey('win32', 'arm64')).toBe('windows-arm64')
    expect(runtimePlatformKey('darwin', 'arm64')).toBe('mac-os-arm64')
    expect(runtimePlatformKey('darwin', 'x64')).toBe('mac-os')
    expect(runtimePlatformKey('linux', 'x64')).toBe('linux')
    expect(runtimePlatformKey('linux', 'arm64')).toBeNull()

    // Java 21 exists for every 64-bit platform; 32-bit Windows and Linux get NoManagedJavaError.
    for (const key of ['windows-x64', 'windows-arm64', 'mac-os', 'mac-os-arm64', 'linux']) {
      expect(realIndex[key]?.['java-runtime-delta']?.length, key).toBeGreaterThan(0)
    }

    expect(realIndex['windows-x86']?.['java-runtime-delta'] ?? []).toHaveLength(0)
  })

  it('knows where java lives', () => {
    expect(javaExecutable('/r', 'win32')).toBe(join('/r', 'bin', 'javaw.exe'))
    expect(javaExecutable('/r', 'darwin')).toBe(join('/r', 'jre.bundle', 'Contents', 'Home', 'bin', 'java'))
    expect(javaExecutable('/r', 'linux')).toBe(join('/r', 'bin', 'java'))
  })
})

describe('parseJavaVersion', () => {
  it('reads modern and legacy version strings', () => {
    expect(parseJavaVersion('openjdk version "21.0.7" 2025-04-15\nOpenJDK Runtime Environment')).toEqual({ major: 21, version: '21.0.7' })
    expect(parseJavaVersion('java version "1.8.0_402"')).toEqual({ major: 8, version: '1.8.0_402' })
    expect(parseJavaVersion('openjdk version "25" 2025-09-16')).toEqual({ major: 25, version: '25' })
    expect(parseJavaVersion('bash: java: not found')).toBeNull()
  })
})

describe('installJavaRuntime', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wave-java-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  function serve(manifest: object): { fetch: FetchFn; manifestSha1: string } {
    const manifestText = JSON.stringify(manifest)
    const manifestSha1 = sha1(manifestText)
    const index = {
      linux: { 'java-runtime-delta': [{ manifest: { sha1: manifestSha1, size: manifestText.length, url: 'https://m/manifest.json' }, version: { name: '21.0.7', released: 'x' } }] }
    }
    const files: Record<string, string> = {
      [JAVA_RUNTIME_INDEX]: JSON.stringify(index),
      'https://m/manifest.json': manifestText,
      'https://m/java': '#!java',
      'https://m/libjvm': 'jvm'
    }
    const fetch: FetchFn = async (url) => (files[url] === undefined ? new Response('', { status: 404 }) : new Response(files[url]))
    return { fetch, manifestSha1 }
  }

  const http = (fetch: FetchFn) => new HttpClient({ fetch, userAgent: 't', backoffMs: () => 0, sleep: async () => {} })

  it('installs files, executables and links, and returns the java path', async () => {
    const { fetch } = serve({
      files: {
        bin: { type: 'directory' },
        'bin/java': { type: 'file', executable: true, downloads: { raw: { sha1: sha1('#!java'), size: 6, url: 'https://m/java' } } },
        'lib/server/libjvm.so': { type: 'file', executable: false, downloads: { raw: { sha1: sha1('jvm'), size: 3, url: 'https://m/libjvm' } } },
        'lib/libjvm.so': { type: 'link', target: 'server/libjvm.so' }
      }
    })
    const client = http(fetch)
    const java = await installJavaRuntime(client, new DownloadQueue({ http: client }), dir, 'java-runtime-delta', { platform: 'linux', arch: 'x64' })

    const root = join(dir, 'java-runtime-delta', 'linux')
    expect(java).toBe(join(root, 'bin', 'java'))
    expect(await readFile(java, 'utf8')).toBe('#!java')

    if (process.platform !== 'win32') {
      expect((await lstat(java)).mode & 0o111).not.toBe(0)
      expect(await readlink(join(root, 'lib', 'libjvm.so'))).toBe('server/libjvm.so')
    }

    expect(JSON.parse(await readFile(join(root, '.wave-runtime.json'), 'utf8'))).toMatchObject({ version: '21.0.7' })
  })

  it('refuses a tampered manifest and paths or links that leave the runtime folder', async () => {
    const tampered = serve({ files: {} })
    const bad: FetchFn = async (url) => (url === 'https://m/manifest.json' ? new Response('{"files":{"x":1}}') : tampered.fetch(url))
    await expect(installJavaRuntime(http(bad), new DownloadQueue({ http: http(bad) }), dir, 'java-runtime-delta', { platform: 'linux', arch: 'x64' })).rejects.toThrow(/SHA-1/)

    for (const files of [
      { '../escape': { type: 'directory' } },
      { 'lib/x': { type: 'link', target: '../../../etc/passwd' } },
      { 'lib/x': { type: 'link', target: '/etc/passwd' } }
    ]) {
      const { fetch } = serve({ files })
      await expect(
        installJavaRuntime(http(fetch), new DownloadQueue({ http: http(fetch) }), dir, 'java-runtime-delta', { platform: 'linux', arch: 'x64' })
      ).rejects.toThrow(/Unsafe/)
    }
  })

  it('explains when Mojang has no runtime for this machine', async () => {
    const { fetch } = serve({ files: {} })
    await expect(installJavaRuntime(http(fetch), new DownloadQueue({ http: http(fetch) }), dir, 'java-runtime-delta', { platform: 'linux', arch: 'arm64' })).rejects.toBeInstanceOf(NoManagedJavaError)
    await expect(installJavaRuntime(http(fetch), new DownloadQueue({ http: http(fetch) }), dir, 'java-runtime-epsilon', { platform: 'linux', arch: 'x64' })).rejects.toBeInstanceOf(NoManagedJavaError)
  })
})
