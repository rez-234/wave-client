import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { launcherPaths, type LauncherPaths } from './paths'
import { ProfileActions, folderContents } from './profile-actions'
import { ProfileStore } from './profiles'

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1).replaceAll('\\', '/'))
    .sort()
}

describe('ProfileActions', () => {
  let dir: string
  let paths: LauncherPaths
  let profiles: ProfileStore
  let busyWith: string | null
  let trashed: string[]
  let trash: (path: string) => Promise<void>
  let confirmRisky: ReturnType<typeof vi.fn<(name: string, args: string[]) => Promise<boolean>>>
  let confirmDelete: ReturnType<typeof vi.fn<(name: string, contents: { worlds: number; bytes: number }) => Promise<boolean>>>

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wave-actions-'))
    paths = launcherPaths(dir)
    profiles = new ProfileStore({ file: join(dir, 'profiles.json'), totalMemoryMb: 16384, listFolders: () => readdir(paths.instances) })
    await profiles.load({ memoryMb: 3072, jvmArgs: '-XX:+UseZGC' })
    busyWith = null
    trashed = []
    trash = async (path) => {
      trashed.push(path)
      await rm(path, { recursive: true })
    }
    confirmRisky = vi.fn(async () => true)
    confirmDelete = vi.fn(async () => true)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const actions = () =>
    new ProfileActions({
      paths,
      profiles,
      mods: { exclusive: (_id, task) => task(), modCount: async () => 0 },
      game: {
        get busy() {
          return busyWith !== null
        },
        isBusyWith: (id) => busyWith === id
      },
      trash: (path) => trash(path),
      confirmRiskyJvmArgs: confirmRisky,
      confirmDelete,
      log: () => {}
    })

  async function defaultFolder(): Promise<string> {
    const game = join(paths.instances, 'default')
    await mkdir(join(game, 'mods'), { recursive: true })
    await mkdir(join(game, 'config', 'waveclient'), { recursive: true })
    await mkdir(join(game, 'saves', 'World 1'), { recursive: true })
    await mkdir(join(game, 'logs'), { recursive: true })
    await writeFile(join(game, 'options.txt'), 'fov:90')
    await writeFile(join(game, 'servers.dat'), 'x')
    await writeFile(join(game, 'config', 'waveclient', 'hud.json'), '{}')
    await writeFile(join(game, 'config', 'sodium.json'), '{}')
    await writeFile(join(game, 'mods', 'sodium.jar'), 'jar')
    await writeFile(join(game, 'mods', '.wave-add-1.tmp'), 'partial')
    await writeFile(join(game, 'saves', 'World 1', 'level.dat'), 'w')
    await writeFile(join(game, 'logs', 'latest.log'), 'log')
    await writeFile(join(game, 'hs_err_pid42.log'), 'jvm')
    return game
  }

  it('creates a profile with settings, keybinds, servers and HUD copied, and selects it', async () => {
    await defaultFolder()
    const view = await actions().create({ name: 'PvP', copy: { from: 'default', what: 'settings' } })

    expect(view).toMatchObject({ id: 'pvp', name: 'PvP', memoryMb: 3072, jvmArgs: '-XX:+UseZGC', selected: true, running: false })
    expect(await files(join(paths.instances, 'pvp'))).toEqual(['config/waveclient/hud.json', 'options.txt', 'servers.dat'])
    expect((await readdir(paths.instances)).sort()).toEqual(['default', 'pvp'])
  })

  it('duplicates everything but worlds, logs and leftovers', async () => {
    await defaultFolder()
    await actions().create({ name: 'Default (copy)', copy: { from: 'default', what: 'everything' } })
    expect(await files(join(paths.instances, 'default-copy'))).toEqual(['config/sodium.json', 'config/waveclient/hud.json', 'mods/sodium.jar', 'options.txt', 'servers.dat'])

    await actions().create({ name: 'With worlds', copy: { from: 'default', what: 'everything', worlds: true } })
    expect(await files(join(paths.instances, 'with-worlds'))).toContain('saves/World 1/level.dat')
  })

  it('checks the name before copying anything, and only selects when the game is idle', async () => {
    await defaultFolder()
    await expect(actions().create({ name: 'default', copy: { from: 'default', what: 'everything' } })).rejects.toThrow(/already exists/)
    await expect(actions().create({ name: '  ' })).rejects.toThrow(/name/)
    expect(await readdir(paths.instances)).toEqual(['default'])

    await expect(actions().create({ name: 'Odd', copy: { from: '../x', what: 'everything' } })).rejects.toThrow(/no longer exists/)
    busyWith = 'default'
    const view = await actions().create({ name: 'Later', id: 'evil', memoryMb: 1 })
    expect(view).toMatchObject({ id: 'later', selected: false, memoryMb: 3072 })
  })

  it('asks before saving JVM arguments that run code, naming the profile', async () => {
    const act = actions()
    confirmRisky.mockResolvedValueOnce(false)
    await expect(act.update('default', { jvmArgs: '-javaagent:x.jar' })).rejects.toThrow(/weren't saved/)
    expect(profiles.get('default')?.jvmArgs).toBe('-XX:+UseZGC')
    expect(confirmRisky).toHaveBeenLastCalledWith('Default', ['-javaagent:x.jar'])

    await act.update('default', { jvmArgs: '-javaagent:x.jar' })
    // Already saved: not asked again.
    await act.update('default', { jvmArgs: '-javaagent:x.jar -Xss2M' })
    expect(confirmRisky).toHaveBeenCalledTimes(2)

    // Only known fields are read.
    const view = await act.update('default', { memoryMb: 2048, playAnyway: 'x', id: 'other', lastPlayedAt: 5 })
    expect(view).toMatchObject({ id: 'default', memoryMb: 2048, lastPlayedAt: null })
    expect(profiles.get('default')?.playAnyway).toBeNull()
  })

  it('moves a removed profile to the trash, and keeps it when that fails', async () => {
    await defaultFolder()
    const act = actions()
    await act.create({ name: 'PvP', copy: { from: 'default', what: 'settings' } })

    trash = async () => {
      throw new Error('not supported')
    }
    await expect(act.remove('pvp', {})).rejects.toThrow(/Couldn't move PvP to the (Trash|Recycle Bin) \(not supported\)\. Nothing was deleted\./)
    expect(profiles.get('pvp')).toBeDefined()

    trash = async (path) => {
      trashed.push(path)
      await rm(path, { recursive: true })
    }
    await act.remove('pvp', {})
    expect(trashed).toEqual([join(paths.instances, 'pvp')])
    expect(profiles.get('pvp')).toBeUndefined()
    expect(profiles.selected().id).toBe('default')
    await expect(act.remove('default', {})).rejects.toThrow(/only profile/)
  })

  it('deletes permanently only after the warning, and never the running profile', async () => {
    await defaultFolder()
    const act = actions()
    await act.create({ name: 'PvP', copy: { from: 'default', what: 'everything', worlds: true } })

    confirmDelete.mockResolvedValueOnce(false)
    await expect(act.remove('pvp', { permanently: true })).rejects.toThrow(/wasn't deleted/)
    expect(confirmDelete).toHaveBeenCalledWith('PvP', { worlds: 1, bytes: expect.any(Number) })
    expect(await readdir(paths.instances)).toContain('pvp')

    busyWith = 'pvp'
    await expect(act.remove('pvp', { permanently: true })).rejects.toThrow(/running with PvP/)
    await expect(act.select('default')).rejects.toThrow(/switch profiles/)

    busyWith = null
    await act.remove('pvp', { permanently: true })
    expect(await readdir(paths.instances)).toEqual(['default'])
    expect(trashed).toEqual([])
  })

  it('refuses ids that are not profiles', async () => {
    const act = actions()
    await expect(act.update('../default', {})).rejects.toThrow(/no longer exists/)
    await expect(act.select(5)).rejects.toThrow(/no longer exists/)
    expect(() => act.gameDir('nope')).toThrow(/no longer exists/)
    expect(act.gameDir()).toBe(join(paths.instances, 'default'))
  })

  it('counts worlds and bytes for the delete warning', async () => {
    const game = await defaultFolder()
    expect(await folderContents(game)).toEqual({ worlds: 1, bytes: 28 })
  })
})
