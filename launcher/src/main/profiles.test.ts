import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ProfileStore, cleanProfileName, profileIdFor } from './profiles'

describe('profile ids and names', () => {
  it('makes a folder-safe, unique id from the name', () => {
    expect(profileIdFor('PvP 1.21', new Set())).toBe('pvp-1-21')
    expect(profileIdFor('Café Ünïcode', new Set())).toBe('cafe-unicode')
    expect(profileIdFor('日本語', new Set())).toBe('profile')
    expect(profileIdFor('PvP', new Set(['pvp', 'pvp-2']))).toBe('pvp-3')
    expect(profileIdFor('x'.repeat(80), new Set())).toHaveLength(40)
  })

  it('cleans names', () => {
    expect(cleanProfileName('  My\tprofile \n ')).toBe('My profile')
    expect(cleanProfileName('   ')).toBeNull()
    expect(cleanProfileName(5)).toBeNull()
    expect(cleanProfileName('a'.repeat(60))).toHaveLength(40)
  })
})

describe('ProfileStore', () => {
  let dir: string
  let file: string
  let clock: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wave-profiles-'))
    file = join(dir, 'profiles.json')
    clock = 1_000
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const store = () => new ProfileStore(file, 16384, () => clock++)

  it('starts with a Default profile that takes over the old global memory and JVM arguments', async () => {
    const profiles = store()
    await profiles.load({ memoryMb: 6144, jvmArgs: '-XX:+UseZGC' })
    expect(profiles.list()).toEqual([
      { id: 'default', name: 'Default', gameVersion: '1.21.11', memoryMb: 6144, jvmArgs: '-XX:+UseZGC', createdAt: expect.any(Number), lastPlayedAt: null }
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
    const pvp = await profiles.create('PvP')
    expect(pvp).toMatchObject({ id: 'pvp', name: 'PvP', memoryMb: 4096 })
    expect(profiles.selected().id).toBe('pvp')

    await profiles.update('pvp', { memoryMb: 3072, jvmArgs: '-Xss2M', name: 'Ranked PvP' })
    const copy = await profiles.create('Ranked PvP', profiles.get('pvp'))
    expect(copy).toMatchObject({ id: 'ranked-pvp', memoryMb: 3072, jvmArgs: '-Xss2M' })

    await profiles.select('pvp')
    await profiles.remove('pvp')
    expect(profiles.list().map((p) => p.id)).toEqual(['default', 'ranked-pvp'])
    expect(profiles.selected().id).toBe('default')

    await profiles.remove('ranked-pvp')
    await expect(profiles.remove('default')).rejects.toThrow(/only profile/)

    const reloaded = store()
    await reloaded.load()
    expect(reloaded.list().map((p) => p.name)).toEqual(['Default'])
  })

  it('checks and clamps what it is given', async () => {
    const profiles = store()
    await profiles.load()
    await expect(profiles.create('   ')).rejects.toThrow(/name/)
    await expect(profiles.update('default', { gameVersion: '1.8.9' })).rejects.toThrow(/version/)
    await expect(profiles.update('default', { name: '' })).rejects.toThrow(/name/)
    await expect(profiles.update('nope', { memoryMb: 2048 })).rejects.toThrow(/no longer exists/)
    expect((await profiles.update('default', { memoryMb: 999_999 })).memoryMb).toBe(12288)
    expect((await profiles.update('default', { memoryMb: 10 })).memoryMb).toBe(1024)
    expect((await profiles.update('default', { jvmArgs: 'x'.repeat(5000) })).jvmArgs).toHaveLength(2000)
  })

  it('reads a damaged file safely and keeps it', async () => {
    await writeFile(file, '{ not json')
    const profiles = store()
    await profiles.load()
    expect(profiles.list().map((p) => p.id)).toEqual(['default'])
    expect((await readdir(dir)).sort()).toEqual(['profiles.json', expect.stringMatching(/^profiles\.json\.unreadable-\d+$/)])

    await writeFile(
      file,
      JSON.stringify({ version: 1, selected: 'gone', profiles: [{ id: '../evil', name: 'x' }, { id: 'ok', name: 'OK', memoryMb: 'lots' }, { id: 'ok', name: 'Dup' }] })
    )
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
    await Promise.all([profiles.create('A'), profiles.create('B'), profiles.update('default', { memoryMb: 2048 })])
    expect(changes).toBe(3)
    const saved = JSON.parse(await readFile(file, 'utf8'))
    expect(saved.profiles.map((p: { id: string }) => p.id)).toEqual(['default', 'a', 'b'])
    expect(saved.profiles[0].memoryMb).toBe(2048)
  })
})
