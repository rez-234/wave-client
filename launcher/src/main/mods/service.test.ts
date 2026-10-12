import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { makeZip } from '../../../test/helpers/make-zip'
import { launcherPaths, type LauncherPaths } from '../paths'
import type { StoredProfile } from '../profiles'
import { ModsService } from './service'

function fabricJar(id: string, version: string, extra: Record<string, unknown> = {}): Buffer {
  return makeZip([{ name: 'fabric.mod.json', data: JSON.stringify({ schemaVersion: 1, id, version, name: id[0]!.toUpperCase() + id.slice(1), ...extra }) }])
}

const PROFILE: StoredProfile = {
  id: 'default',
  name: 'Default',
  gameVersion: '1.21.11',
  memoryMb: 4096,
  jvmArgs: '',
  createdAt: 1,
  lastPlayedAt: null,
  playAnyway: null
}

describe('ModsService', () => {
  let dir: string
  let outside: string
  let paths: LauncherPaths
  let mods: string
  let running: boolean
  let trashed: string[]

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wave-mods-'))
    paths = launcherPaths(join(dir, 'root'))
    outside = join(dir, 'downloads')
    mods = join(paths.instances, 'default', 'mods')
    await mkdir(outside, { recursive: true })
    await mkdir(paths.client, { recursive: true })
    await writeFile(join(paths.client, 'waveclient.jar'), fabricJar('waveclient', '0.4.0'))
    running = false
    trashed = []
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const service = () =>
    new ModsService({
      paths,
      profile: (id) => (id === 'default' ? PROFILE : undefined),
      isRunning: () => running,
      bundledModJar: async () => join(paths.client, 'waveclient.jar'),
      trash: async (path) => {
        trashed.push(path)
        await rm(path)
      },
      log: () => {}
    })

  async function download(name: string, data: Buffer | string): Promise<string> {
    const path = join(outside, name)
    await writeFile(path, data)
    return path
  }

  it('adds Fabric jars and explains everything it skips', async () => {
    await mkdir(join(outside, 'folder.jar'))
    const result = await service().add('default', [
      await download('Sodium.JAR', fabricJar('sodium', '0.6.13')),
      await download('forge-mod.jar', makeZip([{ name: 'META-INF/mods.toml', data: 'modLoader="javafml"' }])),
      await download('pack.zip', makeZip([{ name: 'pack.mcmeta', data: '{}' }])),
      await download('modpack.mrpack', 'x'),
      await download('broken.jar', 'not a zip'),
      await download('loader.jar', fabricJar('fabricloader', '0.19.5')),
      join(outside, 'folder.jar'),
      join(outside, 'missing.jar'),
      'relative.jar',
      '',
      42
    ])

    expect(result.added).toEqual([{ key: 'Sodium.jar', name: 'Sodium', version: '0.6.13' }])
    expect(result.skipped.map((s) => [s.name, s.reason])).toEqual([
      ['forge-mod.jar', 'not-fabric'],
      ['pack.zip', 'resource-pack'],
      ['modpack.mrpack', 'modpack'],
      ['broken.jar', 'unreadable'],
      ['loader.jar', 'built-in'],
      ['folder.jar', 'folder'],
      ['missing.jar', 'not-a-file'],
      ['relative.jar', 'not-a-file'],
      ['A dropped item', 'not-a-file'],
      ['A dropped item', 'not-a-file']
    ])
    expect(result.skipped[0]!.message).toMatch(/Forge mod/)
    // Nothing but the added mod, and no leftover temporary files.
    expect(await readdir(mods)).toEqual(['Sodium.jar'])
    expect(result.report.mods.map((m) => [m.key, m.enabled, m.version])).toEqual([['Sodium.jar', true, '0.6.13']])
  })

  it("never takes files from the launcher's own folder", async () => {
    const own = join(paths.client, 'waveclient.jar')
    const result = await service().add('default', [own])
    expect(result.skipped).toMatchObject([{ reason: 'not-a-file' }])
  })

  it('updates a mod in place, keeping it off when it was off, and skips an identical copy', async () => {
    const ms = service()
    await ms.add('default', [await download('sodium-0.6.10.jar', fabricJar('sodium', '0.6.10'))])
    await ms.setEnabled('default', 'sodium-0.6.10.jar', false)

    const update = await ms.add('default', [await download('sodium-0.6.13.jar', fabricJar('sodium', '0.6.13'))])
    expect(update.added).toEqual([{ key: 'sodium-0.6.13.jar', name: 'Sodium', version: '0.6.13', replaced: { version: '0.6.10' } }])
    expect(await readdir(mods)).toEqual(['sodium-0.6.13.jar.disabled'])
    expect(trashed).toEqual([join(mods, 'sodium-0.6.10.jar.disabled')])

    const again = await ms.add('default', [await download('copy.jar', fabricJar('sodium', '0.6.13'))])
    expect(again.skipped).toMatchObject([{ reason: 'already-installed' }])
  })

  it('gives a different mod with the same file name a free name', async () => {
    const ms = service()
    await ms.add('default', [await download('mod.jar', fabricJar('alpha', '1.0.0'))])
    await mkdir(join(outside, 'other'))
    const path = join(outside, 'other', 'mod.jar')
    await writeFile(path, fabricJar('beta', '1.0.0'))
    const result = await ms.add('default', [path])
    expect(result.added).toMatchObject([{ key: 'mod (2).jar' }])
  })

  it('turns mods on and off and removes them by key, never while the profile is running', async () => {
    const ms = service()
    await ms.add('default', [await download('lithium.jar', fabricJar('lithium', '0.14.0'))])

    let report = await ms.setEnabled('default', 'lithium.jar', false)
    expect(report.mods[0]).toMatchObject({ key: 'lithium.jar', file: 'lithium.jar.disabled', enabled: false })
    report = await ms.setEnabled('default', 'lithium.jar', true)
    expect(report.mods[0]).toMatchObject({ file: 'lithium.jar', enabled: true })

    running = true
    await expect(ms.setEnabled('default', 'lithium.jar', false)).rejects.toThrow(/running/)
    await expect(ms.remove('default', 'lithium.jar')).rejects.toThrow(/running/)

    running = false
    for (const bad of ['../lithium.jar', 'lithium.jar.disabled', '.hidden.jar', 'x.txt']) {
      await expect(ms.setEnabled('default', bad, false)).rejects.toThrow(/Unknown mod/)
    }
    await expect(ms.setEnabled('default', 'gone.jar', false)).rejects.toThrow(/no longer/)

    report = await ms.remove('default', 'lithium.jar')
    expect(report.mods).toEqual([])
    expect(trashed).toEqual([join(mods, 'lithium.jar')])
    await expect(ms.report('nope')).rejects.toThrow(/no longer exists/)
  })

  it('refuses to turn a mod on over another file', async () => {
    await mkdir(mods, { recursive: true })
    await writeFile(join(mods, 'iris.jar'), fabricJar('iris', '1.8.0'))
    await writeFile(join(mods, 'iris.jar.disabled'), fabricJar('iris', '1.7.0'))
    await expect(service().setEnabled('default', 'iris.jar', false)).rejects.toThrow(/already in the mods folder/)
    expect((await readdir(mods)).sort()).toEqual(['iris.jar', 'iris.jar.disabled'])
  })

  it('stops a launch for errors only, with a hash that changes with the errors', async () => {
    const ms = service()
    await mkdir(mods, { recursive: true })
    await writeFile(join(mods, 'menu.jar'), fabricJar('modmenu', '15.0.0', { depends: { 'cloth-config': '*' } }))
    await writeFile(join(mods, 'old.jar'), fabricJar('oldmod', '1.0.0', { depends: { minecraft: '1.20.1' } }))
    await writeFile(join(mods, 'forge.jar'), makeZip([{ name: 'META-INF/mods.toml', data: 'x' }]))

    const first = await ms.launchCheck('default')
    expect(first.errors).toBe(2)
    expect(first.mods.map((m) => m.key).sort()).toEqual(['menu.jar', 'old.jar'])

    await ms.setEnabled('default', 'old.jar', false)
    const second = await ms.launchCheck('default')
    expect(second.errors).toBe(1)
    expect(second.hash).not.toBe(first.hash)

    await ms.setEnabled('default', 'menu.jar', false)
    expect((await ms.launchCheck('default')).errors).toBe(0)
    expect(await ms.modCount('default')).toBe(1)
  })

  it('checks Java requirements against the Java chosen in Settings, warning when it cannot be run', async () => {
    await mkdir(mods, { recursive: true })
    await writeFile(join(mods, 'aa.jar'), fabricJar('aa', '1.0.0', { depends: { java: '>=25' } }))
    const javaFile = join(outside, 'java')
    await writeFile(javaFile, 'x')
    let javaPath: string | null = null
    let probe: () => Promise<number> = async () => 25
    let probes = 0
    const withJava = () =>
      new ModsService({
        paths,
        profile: (id) => (id === 'default' ? PROFILE : undefined),
        isRunning: () => false,
        bundledModJar: async () => join(paths.client, 'waveclient.jar'),
        trash: async () => {},
        log: () => {},
        javaPath: () => javaPath,
        probeJavaMajor: async () => {
          probes++
          return probe()
        }
      })

    const service = withJava()
    // The managed Java for 1.21.11 is 21.
    expect((await service.launchCheck('default')).errors).toBe(1)
    expect(probes).toBe(0)

    javaPath = javaFile
    expect((await service.launchCheck('default')).errors).toBe(0)
    expect((await service.report('default')).mods[0]!.problems).toEqual([])
    // Probed once per file, not on every check.
    expect(probes).toBe(1)

    probe = async () => {
      throw new Error("Couldn't run it")
    }
    const unknown = withJava()
    expect((await unknown.launchCheck('default')).errors).toBe(0)
    const report = await unknown.report('default')
    expect(report.mods[0]!.problems.map((problem) => [problem.code, problem.severity])).toEqual([['java', 'warning']])
    expect(report.errors).toBe(0)
    expect(report.warnings).toBe(1)
  })

  it('reports the included mods and a mods folder that is a file', async () => {
    const report = await service().report('default')
    expect(report).toMatchObject({ folder: 'missing', errors: 0, mods: [] })
    expect(report.included.map((m) => m.id)).toEqual(['fabric-api', 'waveclient'])
    expect(report.included[1]!.version).toBe('0.4.0')

    await mkdir(join(paths.instances, 'default'), { recursive: true })
    await writeFile(mods, 'x')
    const broken = await service().report('default')
    expect(broken).toMatchObject({ folder: 'not-a-folder', errors: 1, profileProblems: [{ severity: 'error', code: 'folder' }] })
  })

  it('serves small PNG icons only', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)])
    await mkdir(mods, { recursive: true })
    await writeFile(join(mods, 'a.jar'), makeZip([{ name: 'fabric.mod.json', data: JSON.stringify({ schemaVersion: 1, id: 'alpha', version: '1', icon: 'icon.png' }) }, { name: 'icon.png', data: png }]))
    await writeFile(join(mods, 'b.jar'), makeZip([{ name: 'fabric.mod.json', data: JSON.stringify({ schemaVersion: 1, id: 'beta', version: '1', icon: 'icon.png' }) }, { name: 'icon.png', data: 'not a png' }]))
    const ms = service()
    expect(await ms.icon('default', 'a.jar')).toBe(`data:image/png;base64,${png.toString('base64')}`)
    expect(await ms.icon('default', 'b.jar')).toBeNull()
    expect(await ms.icon('default', 'c.jar')).toBeNull()
  })
})
