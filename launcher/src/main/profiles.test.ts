import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ProfileStore, cleanProfileName, copyName, profileIdFor } from './profiles'

describe('profile ids and names', () => {
  it('makes a folder-safe, unique id from the name', () => {
    expect(profileIdFor('PvP 1.21', [])).toBe('pvp-1-21')
    expect(profileIdFor('Café Ünïcode', [])).toBe('cafe-unicode')
    expect(profileIdFor('日本語', [])).toBe('profile')
    expect(profileIdFor('PvP', ['pvp', 'PVP-2'])).toBe('pvp-3')
    expect(profileIdFor('x'.repeat(80), [])).toHaveLength(40)
  })

  it('never uses a Windows device name', () => {
    expect(profileIdFor('Con', [])).toBe('con-profile')
    expect(profileIdFor('LPT1', [])).toBe('lpt1-profile')
    expect(profileIdFor('Console', [])).toBe('console')
  })

  it('cleans names and names copies', () => {
    expect(cleanProfileName('  My\tprofile \n ')).toBe('My profile')
    expect(cleanProfileName('   ')).toBeNull()
    expect(cleanProfileName(5)).toBeNull()
    expect(cleanProfileName('a'.repeat(60))).toHaveLength(40)
    expect(copyName('PvP', ['PvP'])).toBe('PvP (copy)')
    expect(copyName('PvP', ['PvP', 'pvp (copy)'])).toBe('PvP (copy 2)')
    expect(copyName('PvP (copy)', ['PvP', 'PvP (copy)'])).toBe('PvP (copy 2)')
  })
})

describe('ProfileStore', () => {
  let dir: string
  let file: string
  let instances: string
  let clock: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wave-profiles-'))
    file = join(dir, 'profiles.json')
    instances = join(dir, 'instances')
    clock = 1_000
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const store = () =>
    new ProfileStore({ file, totalMemoryMb: 16384, listFolders: () => readdir(instances).catch(() => []), now: () => clock++ })

  it('starts with a Default profile that takes over the old global memory and JVM arguments', async () => {
    const profiles = store()
    await profiles.load({ memoryMb: 6144, jvmArgs: '-XX:+UseZGC' })
    expect(profiles.list()).toEqual([
      { id: 'default', name: 'Default', gameVersion: '1.21.11', memoryMb: 6144, jvmArgs: '-XX:+UseZGC', createdAt: expect.any(Number), lastPlayedAt: null, playAnyway: null }
    ])
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ version: 1, selected: 'default' })

    // Once saved, the old settings no longer matter.
    const again = store()
    await again.load({ memoryMb: 2048 })
    expect(again.selected().memoryMb).toBe(6144)
  })

  it('creates, copies, renames, selects and removes profiles', async () => {
    const profiles = store()
    await profiles.load()
    const pvp = await profiles.create('PvP', await profiles.nextId('PvP'), null, true)
    expect(pvp).toMatchObject({ id: 'pvp', name: 'PvP', memoryMb: 4096 })
    expect(profiles.selected().id).toBe('pvp')

    await profiles.update('pvp', { memoryMb: 3072, jvmArgs: '-Xss2M', name: 'Ranked PvP' })
    const copy = await profiles.create('Ranked PvP (copy)', await profiles.nextId('Ranked PvP (copy)'), profiles.get('pvp')!, false)
    expect(copy).toMatchObject({ id: 'ranked-pvp-copy', memoryMb: 3072, jvmArgs: '-Xss2M' })
    expect(profiles.selected().id).toBe('pvp')

    await expect(profiles.create('ranked pvp', 'x', null, false)).rejects.toThrow(/already exists/)
    await expect(profiles.update('pvp', { name: 'DEFAULT' })).rejects.toThrow(/already exists/)

    // Removing the selected profile selects the one played most recently.
    await profiles.update('ranked-pvp-copy', { lastPlayedAt: 5 })
    await profiles.remove('pvp')
    expect(profiles.list().map((p) => p.id)).toEqual(['default', 'ranked-pvp-copy'])
    expect(profiles.selected().id).toBe('ranked-pvp-copy')

    await profiles.remove('ranked-pvp-copy')
    await expect(profiles.remove('default')).rejects.toThrow(/only profile/)

    const reloaded = store()
    await reloaded.load()
    expect(reloaded.list().map((p) => p.name)).toEqual(['Default'])
  })

  it('keeps new ids clear of folders already in instances/', async () => {
    await mkdir(join(instances, 'pvp'), { recursive: true })
    const profiles = store()
    await profiles.load()
    // The orphaned folder came back as a profile, and a new "PvP" doesn't take its folder.
    expect(profiles.list().map((p) => [p.id, p.name])).toEqual([
      ['default', 'Default'],
      ['pvp', 'pvp']
    ])
    expect(await profiles.nextId('PvP')).toBe('pvp-2')
  })

  it('checks and clamps what it is given', async () => {
    const profiles = store()
    await profiles.load()
    await expect(profiles.create('   ', 'blank', null, false)).rejects.toThrow(/name/)
    await expect(profiles.create('Bad', '../evil', null, false)).rejects.toThrow(/folder/)
    await expect(profiles.update('default', { gameVersion: '1.8.9' })).rejects.toThrow(/version/)
    await expect(profiles.update('default', { name: '' })).rejects.toThrow(/name/)
    await expect(profiles.update('nope', { memoryMb: 2048 })).rejects.toThrow(/no longer exists/)
    expect((await profiles.update('default', { memoryMb: 999_999 })).memoryMb).toBe(12288)
    expect((await profiles.update('default', { memoryMb: 10 })).memoryMb).toBe(1024)
    expect((await profiles.update('default', { jvmArgs: 'x'.repeat(5000) })).jvmArgs).toHaveLength(2000)
    expect((await profiles.update('default', { playAnyway: 'abc' })).playAnyway).toBe('abc')
  })

  it('reads a damaged file safely, keeps it, and rebuilds the list from the folders', async () => {
    await mkdir(join(instances, 'pvp'), { recursive: true })
    await mkdir(join(instances, 'default'), { recursive: true })
    await writeFile(file, '{ not json')
    const profiles = store()
    await profiles.load()
    expect(profiles.list().map((p) => p.id).sort()).toEqual(['default', 'pvp'])
    expect((await readdir(dir)).sort()).toEqual(['instances', 'profiles.json', expect.stringMatching(/^profiles\.json\.unreadable-\d+$/)])

    await writeFile(
      file,
      JSON.stringify({ version: 1, selected: 'gone', profiles: [{ id: '../evil', name: 'x' }, { id: 'ok', name: 'OK', memoryMb: 'lots' }, { id: 'ok', name: 'Dup' }] })
    )
    await rm(instances, { recursive: true })
    const odd = store()
    await odd.load()
    expect(odd.list()).toMatchObject([{ id: 'ok', name: 'OK', memoryMb: 4096 }])
    expect(odd.selected().id).toBe('ok')
  })

  it('tells listeners about every change and writes them in order', async () => {
    const profiles = store()
    await profiles.load()
    let changes = 0
    profiles.onChange = () => changes++
    await Promise.all([profiles.create('A', 'a', null, true), profiles.create('B', 'b', null, true), profiles.update('default', { memoryMb: 2048 })])
    expect(changes).toBe(3)
    const saved = JSON.parse(await readFile(file, 'utf8'))
    expect(saved.profiles.map((p: { id: string }) => p.id)).toEqual(['default', 'a', 'b'])
    expect(saved.profiles[0].memoryMb).toBe(2048)
    expect(saved.selected).toBe('b')
  })
})
