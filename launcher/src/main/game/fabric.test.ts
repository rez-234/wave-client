import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DownloadQueue } from '../net/downloads'
import { HttpClient, type FetchFn } from '../net/http'
import { launcherPaths } from '../paths'
import { prepareClientMods } from './client-mods'
import { fabricApiUrl, fillMissingHashes, loadFabricProfile } from './fabric'
import { resolveLibraries } from './version'

const sha1 = (text: string): string => createHash('sha1').update(text).digest('hex')
const profileText = readFileSync(join(__dirname, '../../../test/fixtures/fabric-loader-0.19.4-1.21.11.json'), 'utf8')
const PROFILE_URL = 'https://meta.fabricmc.net/v2/versions/loader/1.21.11/0.19.4/profile/json'

function server(files: Record<string, string | number>): { http: HttpClient; calls: string[] } {
  const calls: string[] = []
  const fetch: FetchFn = async (url) => {
    calls.push(url)
    const body = files[url]
    return typeof body === 'number' ? new Response('', { status: body }) : body === undefined ? new Response('', { status: 404 }) : new Response(body)
  }
  return { http: new HttpClient({ fetch, userAgent: 't', backoffMs: () => 0, sleep: async () => {} }), calls }
}

describe('Fabric', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wave-fabric-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('loads the profile, caches it, and falls back to the cache when offline', async () => {
    const paths = launcherPaths(dir)
    const online = await loadFabricProfile(server({ [PROFILE_URL]: profileText }).http, paths, '1.21.11', '0.19.4')
    expect(online.inheritsFrom).toBe('1.21.11')

    const offline = await loadFabricProfile(server({ [PROFILE_URL]: 503 }).http, paths, '1.21.11', '0.19.4')
    expect(offline).toEqual(online)
  })

  it('rejects a profile for the wrong game or with non-HTTPS libraries', async () => {
    const paths = launcherPaths(dir)
    const wrongGame = JSON.stringify({ ...JSON.parse(profileText), inheritsFrom: '1.20' })
    await expect(loadFabricProfile(server({ [PROFILE_URL]: wrongGame }).http, paths, '1.21.11', '0.19.4')).rejects.toThrow(/doesn't look right/)
    const http = JSON.parse(profileText)
    http.libraries[0].url = 'http://maven.fabricmc.net/'
    await expect(loadFabricProfile(server({ [PROFILE_URL]: JSON.stringify(http) }).http, paths, '1.21.11', '0.19.4')).rejects.toThrow(/HTTPS/)
  })

  it('fetches Maven .sha1 files for libraries Fabric leaves unhashed, and keeps them', async () => {
    const libraries = resolveLibraries(JSON.parse(profileText).libraries, { os: 'linux', arch: 'x64', osVersion: '', features: {} })
    const unhashed = libraries.filter((l) => !l.sha1)
    expect(unhashed.map((l) => l.coordinate.artifact).sort()).toEqual(['fabric-loader', 'intermediary'])

    const hashes = Object.fromEntries(unhashed.map((l) => [`${l.url}.sha1`, `${sha1(l.name)}  ${l.path}\n`]))
    const libs = join(dir, 'libraries')
    const filled = await fillMissingHashes(server(hashes).http, libs, libraries)
    expect(filled.every((l) => /^[0-9a-f]{40}$/.test(l.sha1!))).toBe(true)

    // Saved next to the jars: Maven can be unreachable from now on.
    const offline = server({})
    expect(await fillMissingHashes(offline.http, libs, libraries)).toEqual(filled)
    expect(offline.calls).toHaveLength(0)

    await expect(fillMissingHashes(server({}).http, join(dir, 'empty'), libraries)).rejects.toThrow()
    await expect(fillMissingHashes(server(Object.fromEntries(Object.keys(hashes).map((k) => [k, 'not a hash']))).http, join(dir, 'empty'), libraries)).rejects.toThrow(/No SHA-1/)
  })

  it('keeps exactly our mod and the pinned Fabric API in the client folder', async () => {
    const api = 'fabric-api-bytes'
    const { http } = server({ [fabricApiUrl('0.141.6+1.21.11')]: api, [`${fabricApiUrl('0.141.6+1.21.11')}.sha1`]: sha1(api) })
    const queue = new DownloadQueue({ http })
    const clientDir = join(dir, 'client')
    const modJar = join(dir, 'waveclient-0.4.0.jar')
    await writeFile(modJar, 'mod-v1')
    await prepareClientMods(http, queue, join(dir, 'client'), join(dir, 'libraries'), '0.141.6+1.21.11', modJar)
    await writeFile(join(clientDir, 'fabric-api-0.100.0+1.21.jar'), 'stale')

    await writeFile(modJar, 'mod-v2')
    const files = await prepareClientMods(http, queue, clientDir, join(dir, 'libraries'), '0.141.6+1.21.11', modJar)

    expect((await readdir(clientDir)).sort()).toEqual(['fabric-api-0.141.6+1.21.11.jar', 'waveclient-0.4.0.jar'])
    expect(files).toHaveLength(2)
    expect(await readFile(join(clientDir, 'waveclient-0.4.0.jar'), 'utf8')).toBe('mod-v2')
    expect(fabricApiUrl('0.141.6+1.21.11')).toContain('0.141.6%2B1.21.11')
  })

  it('refuses a Fabric API jar that does not match its published hash', async () => {
    const { http } = server({ [fabricApiUrl('0.141.6+1.21.11')]: 'tampered', [`${fabricApiUrl('0.141.6+1.21.11')}.sha1`]: sha1('real') })
    const modJar = join(dir, 'waveclient-0.4.0.jar')
    await writeFile(modJar, 'mod')
    await expect(prepareClientMods(http, new DownloadQueue({ http, retries: 0 }), join(dir, 'client'), join(dir, 'libraries'), '0.141.6+1.21.11', modJar)).rejects.toThrow(/SHA-1/)
  })
})
