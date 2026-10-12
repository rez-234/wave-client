import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { simpleMod } from '../../../test/helpers/make-mod-jar'
import { readModJar } from './jar'
import { ModJarCache, classify, scanModsFolder } from './scan'

describe('classify', () => {
  it('follows Fabric: exact .jar, no leading dot; .jar.disabled is off; other-case .jar is listed but ignored', () => {
    expect(classify('sodium.jar')).toEqual({ key: 'sodium.jar', state: 'on' })
    expect(classify('sodium.jar.disabled')).toEqual({ key: 'sodium.jar', state: 'off' })
    expect(classify('Sodium.JAR')).toEqual({ key: 'Sodium.JAR', state: 'case' })
    expect(classify('Sodium.Jar')).toEqual({ key: 'Sodium.Jar', state: 'case' })
    expect(classify('._sodium.jar')).toBeNull()
    expect(classify('.wave-add-1234.tmp')).toBeNull()
    expect(classify('readme.txt')).toBeNull()
    expect(classify('sodium.jar.bak')).toBeNull()
    expect(classify('sodium.JAR.disabled')).toBeNull()
  })
})

describe('scanModsFolder', () => {
  let dir: string
  let mods: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wave-scan-'))
    mods = join(dir, 'mods')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reports the folder state', async () => {
    const cache = new ModJarCache()
    expect(await scanModsFolder(mods, cache)).toEqual({ folder: 'missing', mods: [] })
    await writeFile(mods, 'oops')
    expect(await scanModsFolder(mods, cache)).toEqual({ folder: 'not-a-folder', mods: [] })
  })

  it('lists the top level only, following links, sorted by key', async () => {
    await mkdir(join(mods, 'sub'), { recursive: true })
    await writeFile(join(mods, 'b.jar'), simpleMod('bbb', '1'))
    await writeFile(join(mods, 'a.jar.disabled'), simpleMod('aaa', '1'))
    await writeFile(join(mods, 'C.JAR'), simpleMod('ccc', '1'))
    await writeFile(join(mods, '._b.jar'), 'AppleDouble junk')
    await writeFile(join(mods, 'notes.txt'), 'hi')
    await writeFile(join(mods, 'sub', 'deep.jar'), simpleMod('deep', '1'))
    await mkdir(join(mods, 'folder.jar'))
    await writeFile(join(dir, 'outside.jar'), simpleMod('linked', '1'))
    await symlink(join(dir, 'outside.jar'), join(mods, 'linked.jar'))
    await symlink(join(dir, 'nowhere.jar'), join(mods, 'broken.jar'))

    const scan = await scanModsFolder(mods, new ModJarCache())
    expect(scan.folder).toBe('ok')
    expect(scan.mods.map((m) => [m.key, m.file, m.state])).toEqual([
      ['C.JAR', 'C.JAR', 'case'],
      ['a.jar', 'a.jar.disabled', 'off'],
      ['b.jar', 'b.jar', 'on'],
      ['linked.jar', 'linked.jar', 'on']
    ])
    expect(scan.mods.every((m) => m.read.ok)).toBe(true)
    expect(scan.mods[2]!.size).toBeGreaterThan(0)
  })

  it('shows the turned-on copy when both forms of a name exist', async () => {
    await mkdir(mods)
    await writeFile(join(mods, 'x.jar.disabled'), simpleMod('old', '1'))
    await writeFile(join(mods, 'x.jar'), simpleMod('new', '2'))
    const scan = await scanModsFolder(mods, new ModJarCache())
    expect(scan.mods).toHaveLength(1)
    expect(scan.mods[0]).toMatchObject({ file: 'x.jar', state: 'on' })
  })

  it('reads each jar once, also across turning it off and on', async () => {
    await mkdir(mods)
    await writeFile(join(mods, 'a.jar'), simpleMod('aaa', '1'))
    await writeFile(join(mods, 'broken.jar'), 'not a jar')
    const reader = vi.fn(readModJar)
    const cache = new ModJarCache(2000, reader)

    await scanModsFolder(mods, cache)
    expect(reader).toHaveBeenCalledTimes(2)
    const again = await scanModsFolder(mods, cache)
    expect(reader).toHaveBeenCalledTimes(2)
    expect(again.mods.find((m) => m.key === 'broken.jar')!.read).toMatchObject({ ok: false, kind: 'unreadable' })

    await rename(join(mods, 'a.jar'), join(mods, 'a.jar.disabled'))
    await scanModsFolder(mods, cache)
    await rename(join(mods, 'a.jar.disabled'), join(mods, 'a.jar'))
    await scanModsFolder(mods, cache)
    expect(reader).toHaveBeenCalledTimes(2)

    // A changed file is read again.
    await writeFile(join(mods, 'a.jar'), simpleMod('aaa', '2.0.0-changed'))
    const changed = await scanModsFolder(mods, cache)
    expect(reader).toHaveBeenCalledTimes(3)
    expect(changed.mods.find((m) => m.key === 'a.jar')!.read).toMatchObject({ ok: true, info: { metadata: { version: '2.0.0-changed' } } })
  })

  it('forgets the least recently used jars beyond its limit', async () => {
    await mkdir(mods)

    for (let i = 0; i < 5; i++) {
      await writeFile(join(mods, `m${i}.jar`), simpleMod(`mod${i}`, '1'))
    }

    const cache = new ModJarCache(3)
    await scanModsFolder(mods, cache)
    expect(cache.size).toBe(3)
  })
})
