import { createHash } from 'node:crypto'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DownloadQueue } from '../net/downloads'
import { HttpClient, type FetchFn } from '../net/http'
import { launcherPaths } from '../paths'
import { fabricApiUrl } from './fabric'
import { VERSION_MANIFEST, prepareGame } from './install'
import { JAVA_RUNTIME_INDEX } from './java'
import { PINS } from './pins'

const sha1 = (text: string): string => createHash('sha1').update(text).digest('hex')
const art = (url: string, body: string, path?: string) => ({ url, sha1: sha1(body), size: body.length, ...(path ? { path } : {}) })

/** A miniature Mojang + Fabric + Maven, enough for one full install of PINS. */
function world() {
  const files: Record<string, string> = {}
  const add = (url: string, body: string) => {
    files[url] = body
    return body
  }

  const lib = add('https://libraries.minecraft.net/com/example/lib/1/lib-1.jar', 'lib-jar')
  const nativesLinux = add('https://libraries.minecraft.net/org/lwjgl/lwjgl/3/lwjgl-3-natives-linux.jar', 'natives-linux')
  const client = add('https://piston-data/client.jar', 'client-jar')
  const logConfig = add('https://piston-data/client-1.21.2.xml', '<Configuration/>')
  const object = add(`https://resources.download.minecraft.net/${sha1('sound').slice(0, 2)}/${sha1('sound')}`, 'sound')
  const assetIndex = add('https://piston-meta/29.json', JSON.stringify({ objects: { 'minecraft/sounds/x.ogg': { hash: sha1('sound'), size: 5 } } }))
  const vanilla = add(
    'https://piston-meta/1.21.11.json',
    JSON.stringify({
      id: PINS.minecraft,
      type: 'release',
      mainClass: 'net.minecraft.client.main.Main',
      arguments: { game: ['--version', '${version_name}'], jvm: ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'] },
      libraries: [
        { name: 'com.example:lib:1', downloads: { artifact: art('https://libraries.minecraft.net/com/example/lib/1/lib-1.jar', lib, 'com/example/lib/1/lib-1.jar') } },
        {
          name: 'org.lwjgl:lwjgl:3:natives-linux',
          downloads: { artifact: art('https://libraries.minecraft.net/org/lwjgl/lwjgl/3/lwjgl-3-natives-linux.jar', nativesLinux, 'org/lwjgl/lwjgl/3/lwjgl-3-natives-linux.jar') },
          rules: [{ action: 'allow', os: { name: 'linux' } }]
        },
        { name: 'org.lwjgl:lwjgl:3:natives-windows', downloads: { artifact: art('https://nowhere/win.jar', 'x') }, rules: [{ action: 'allow', os: { name: 'windows' } }] }
      ],
      downloads: { client: art('https://piston-data/client.jar', client) },
      assetIndex: { id: '29', ...art('https://piston-meta/29.json', assetIndex) },
      assets: '29',
      javaVersion: { component: 'java-runtime-delta', majorVersion: 21 },
      logging: { client: { argument: '-Dlog4j.configurationFile=${path}', type: 'log4j2-xml', file: { id: 'client-1.21.2.xml', ...art('https://piston-data/client-1.21.2.xml', logConfig) } } }
    })
  )
  add(VERSION_MANIFEST, JSON.stringify({ versions: [{ id: PINS.minecraft, type: 'release', url: 'https://piston-meta/1.21.11.json', sha1: sha1(vanilla) }] }))

  const loaderUrl = `https://maven.fabricmc.net/net/fabricmc/fabric-loader/${PINS.fabricLoader}/fabric-loader-${PINS.fabricLoader}.jar`
  const loader = add(loaderUrl, 'loader-jar')
  add(`${loaderUrl}.sha1`, sha1(loader))
  add(
    `https://meta.fabricmc.net/v2/versions/loader/${PINS.minecraft}/${PINS.fabricLoader}/profile/json`,
    JSON.stringify({
      id: `fabric-loader-${PINS.fabricLoader}-${PINS.minecraft}`,
      inheritsFrom: PINS.minecraft,
      type: 'release',
      mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
      arguments: { game: [], jvm: ['-DFabricMcEmu= net.minecraft.client.main.Main '] },
      libraries: [{ name: `net.fabricmc:fabric-loader:${PINS.fabricLoader}`, url: 'https://maven.fabricmc.net/' }]
    })
  )

  const java = add('https://runtime/java', '#!java')
  const runtimeManifest = add('https://runtime/manifest.json', JSON.stringify({ files: { 'bin/java': { type: 'file', executable: true, downloads: { raw: art('https://runtime/java', java) } } } }))
  add(JAVA_RUNTIME_INDEX, JSON.stringify({ linux: { 'java-runtime-delta': [{ manifest: art('https://runtime/manifest.json', runtimeManifest), version: { name: '21.0.7', released: '' } }] } }))

  const api = add(fabricApiUrl(PINS.fabricApi), 'fabric-api')
  add(`${fabricApiUrl(PINS.fabricApi)}.sha1`, sha1(api))
  void object

  const calls: string[] = []
  let offline = false
  const fetch: FetchFn = async (url) => {
    calls.push(url)

    if (offline) {
      throw new TypeError('fetch failed')
    }

    return files[url] === undefined ? new Response('', { status: 404 }) : new Response(files[url])
  }

  const http = new HttpClient({ fetch, userAgent: 't', backoffMs: () => 0, sleep: async () => {} })
  return { http, calls, goOffline: () => (offline = true) }
}

describe('prepareGame', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wave-install-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('installs everything and returns what the launch needs', async () => {
    const { http, calls } = world()
    const paths = launcherPaths(dir)
    const mod = join(dir, 'waveclient-0.4.0.jar')
    await writeFile(mod, 'our-mod')
    const tasks: string[] = []
    const context = { http, queue: new DownloadQueue({ http, backoffMs: () => 0 }), paths, platform: 'linux', arch: 'x64', osVersion: '6' }

    const game = await prepareGame(context, { bundledModJar: mod, onTask: (t) => tasks.push(t.label) })

    expect(game.version.id).toBe(`fabric-loader-${PINS.fabricLoader}-${PINS.minecraft}`)
    expect(game.java).toBe(join(paths.runtimes, 'java-runtime-delta', 'linux', 'bin', 'java'))
    expect(game.classpath.map((p) => p.slice(paths.root.length))).toEqual([
      join('/shared/libraries/net/fabricmc/fabric-loader', PINS.fabricLoader, `fabric-loader-${PINS.fabricLoader}.jar`),
      join('/shared/libraries/com/example/lib/1/lib-1.jar'),
      join('/shared/libraries/org/lwjgl/lwjgl/3/lwjgl-3-natives-linux.jar'),
      join('/shared/versions', PINS.minecraft, `${PINS.minecraft}.jar`)
    ])
    expect(game.gameDir).toBe(join(paths.instances, 'default'))
    expect(game.addMods).toEqual([paths.client])
    expect(game.assetIndexName).toBe('29')
    expect(await readFile(game.logConfigPath!, 'utf8')).toBe('<Configuration/>')
    await access(game.nativesDir)
    expect(tasks).toContain('Downloading Java')
    expect(tasks).toContain('Downloading assets')
    expect(calls).not.toContain('https://nowhere/win.jar')

    // A second launch only re-reads metadata.
    const before = calls.length
    await prepareGame(context, { bundledModJar: mod })
    const downloads = calls.slice(before).filter((url) => !/(manifest|profile\/json|\.sha1$|all\.json)/.test(url))
    expect(downloads).toEqual([])

    // Repair notices a damaged library that kept its size.
    await writeFile(join(paths.libraries, 'com/example/lib/1/lib-1.jar'), 'LIB-JAR')
    await prepareGame(context, { bundledModJar: mod, repair: true })
    expect(await readFile(join(paths.libraries, 'com/example/lib/1/lib-1.jar'), 'utf8')).toBe('lib-jar')
  })

  it('launches from what is already installed when offline', async () => {
    const { http, goOffline } = world()
    const paths = launcherPaths(dir)
    const mod = join(dir, 'waveclient-0.4.0.jar')
    await writeFile(mod, 'our-mod')
    const context = { http, queue: new DownloadQueue({ http, backoffMs: () => 0, retries: 0 }), paths, platform: 'linux', arch: 'x64', osVersion: '6' }
    await prepareGame(context, { bundledModJar: mod })

    goOffline()
    // Metadata comes from the cache; Java's index and Maven hashes need the network, so this fails
    // loudly rather than launching unverified files.
    await expect(prepareGame(context, { bundledModJar: mod })).rejects.toThrow()
  })

  it('checks a user-chosen Java is new enough', async () => {
    const { http } = world()
    const paths = launcherPaths(dir)
    const mod = join(dir, 'waveclient-0.4.0.jar')
    await writeFile(mod, 'our-mod')
    const fakeJava = join(dir, 'java8.sh')
    await writeFile(fakeJava, '#!/bin/sh\necho \'java version "1.8.0_402"\' >&2\n', { mode: 0o755 })

    if (process.platform === 'win32') {
      return
    }

    const context = { http, queue: new DownloadQueue({ http }), paths, platform: 'linux', arch: 'x64', osVersion: '6' }
    await expect(prepareGame(context, { bundledModJar: mod, javaPath: fakeJava })).rejects.toThrow(/needs Java 21/)
  })
})
