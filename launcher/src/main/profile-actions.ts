import { cp, lstat, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'

import type { ProfileView } from '@shared/ipc'

import type { ModsService } from './mods/service'
import { instanceDir, type LauncherPaths } from './paths'
import { PROFILE_ID, type ProfileChanges, type ProfileStore, type StoredProfile } from './profiles'
import { riskyJvmArgs, splitJvmArgs } from './settings'

export interface ProfileActionsDeps {
  paths: LauncherPaths
  profiles: ProfileStore
  mods: Pick<ModsService, 'exclusive' | 'modCount'>
  game: { readonly busy: boolean; isBusyWith: (profileId: string) => boolean }
  /** Moves a folder to the OS trash (shell.trashItem). */
  trash: (path: string) => Promise<void>
  /** Native dialogs: script in the page can't answer them. */
  confirmRiskyJvmArgs: (profileName: string, args: string[]) => Promise<boolean>
  confirmDelete: (profileName: string, contents: { worlds: number; bytes: number }) => Promise<boolean>
  log: (message: string) => void
}

/** What 'settings' copies from another profile: options, keybinds, servers and the Wave Client HUD. */
const SETTINGS_FILES = ['options.txt', 'servers.dat', join('config', 'waveclient')]
/** What a duplicate leaves out (top level of the game folder). */
const NOT_DUPLICATED = new Set(['logs', 'crash-reports', 'screenshots', '.fabric', 'debug'])
const TRASH_NAME = process.platform === 'win32' ? 'Recycle Bin' : 'Trash'

/**
 * Profile changes that touch more than profiles.json: copying a profile's folder, trashing or
 * deleting it, asking about risky JVM arguments. Arguments come from the page and are checked
 * here; only known fields are read. One change at a time.
 */
export class ProfileActions {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly deps: ProfileActionsDeps) {}

  async views(): Promise<ProfileView[]> {
    const selected = this.deps.profiles.selected().id
    return Promise.all(
      this.deps.profiles.list().map(async (profile) => ({
        id: profile.id,
        name: profile.name,
        gameVersion: profile.gameVersion,
        memoryMb: profile.memoryMb,
        jvmArgs: profile.jvmArgs,
        selected: profile.id === selected,
        running: this.deps.game.isBusyWith(profile.id),
        createdAt: profile.createdAt,
        lastPlayedAt: profile.lastPlayedAt,
        modCount: await this.deps.mods.modCount(profile.id)
      }))
    )
  }

  create(input: unknown): Promise<ProfileView> {
    return this.serial(async () => {
      const options = isObject(input) ? input : {}
      const copy = isObject(options.copy) ? options.copy : null
      const what = copy?.what === 'settings' || copy?.what === 'everything' ? copy.what : null
      const from = copy && what ? this.existing(copy.from) : null
      // Checked before anything is copied.
      const name = this.deps.profiles.checkName(options.name, null)
      const id = await this.deps.profiles.nextId(name)
      const target = instanceDir(this.deps.paths, id)
      const staging = join(this.deps.paths.instances, `.${id}.tmp`)

      if (from && what) {
        await rm(staging, { recursive: true, force: true })
        await mkdir(staging, { recursive: true })

        try {
          // The source's mods don't change while they are copied.
          await this.deps.mods.exclusive(from.id, () => this.copyFolder(instanceDir(this.deps.paths, from.id), staging, what, copy?.worlds === true))
          await rename(staging, target)
        } catch (error) {
          await rm(staging, { recursive: true, force: true }).catch(() => {})
          throw new Error(`Couldn't copy ${from.name}: ${messageOf(error)}`)
        }
      }

      try {
        const created = await this.deps.profiles.create(name, id, from ?? this.deps.profiles.selected(), !this.deps.game.busy)
        return this.view(created.id)
      } catch (error) {
        if (from) {
          await rm(target, { recursive: true, force: true }).catch(() => {})
        }

        throw error
      }
    })
  }

  update(idInput: unknown, input: unknown): Promise<ProfileView> {
    return this.serial(async () => {
      const profile = this.existing(idInput)
      const patch = isObject(input) ? input : {}
      const changes: ProfileChanges = {}

      if ('name' in patch) {
        changes.name = typeof patch.name === 'string' ? patch.name : ''
      }

      if (typeof patch.gameVersion === 'string') {
        changes.gameVersion = patch.gameVersion
      }

      if (typeof patch.memoryMb === 'number' && Number.isFinite(patch.memoryMb)) {
        changes.memoryMb = patch.memoryMb
      }

      if (typeof patch.jvmArgs === 'string') {
        const before = new Set(riskyJvmArgs(splitJvmArgs(profile.jvmArgs)))
        const added = riskyJvmArgs(splitJvmArgs(patch.jvmArgs)).filter((arg) => !before.has(arg))

        if (added.length > 0 && !(await this.deps.confirmRiskyJvmArgs(profile.name, added))) {
          throw new Error("The JVM arguments weren't saved.")
        }

        changes.jvmArgs = patch.jvmArgs
      }

      await this.deps.profiles.update(profile.id, changes)
      return this.view(profile.id)
    })
  }

  /**
   * Moves the profile's folder to the trash and forgets the profile. If the folder can't be
   * trashed, nothing changes. `permanently` deletes the folder instead, after a native warning.
   */
  remove(idInput: unknown, input: unknown): Promise<void> {
    return this.serial(async () => {
      const profile = this.existing(idInput)
      const permanently = isObject(input) && input.permanently === true

      if (this.deps.profiles.list().length <= 1) {
        throw new Error("You can't delete your only profile.")
      }

      await this.deps.mods.exclusive(profile.id, async () => {
        if (this.deps.game.isBusyWith(profile.id)) {
          throw new Error(`Minecraft is running with ${profile.name}. Close it first.`)
        }

        const folder = instanceDir(this.deps.paths, profile.id)
        const exists = await lstat(folder).then(
          () => true,
          () => false
        )

        if (exists && permanently) {
          if (!(await this.deps.confirmDelete(profile.name, await folderContents(folder)))) {
            throw new Error(`${profile.name} wasn't deleted.`)
          }

          try {
            await rm(folder, { recursive: true, force: true, maxRetries: 2 })
          } catch (error) {
            throw new Error(`Couldn't delete all of ${profile.name}'s folder (${messageOf(error)}). Close any program using it and try again.`)
          }
        } else if (exists) {
          try {
            await this.deps.trash(folder)
          } catch (error) {
            throw new Error(`Couldn't move ${profile.name} to the ${TRASH_NAME} (${messageOf(error)}). Nothing was deleted.`)
          }
        }

        await this.deps.profiles.remove(profile.id)
      })
    })
  }

  select(idInput: unknown): Promise<void> {
    return this.serial(async () => {
      const profile = this.existing(idInput)

      if (this.deps.game.busy && this.deps.profiles.selected().id !== profile.id) {
        throw new Error("You can't switch profiles while Minecraft is starting or running.")
      }

      await this.deps.profiles.select(profile.id)
    })
  }

  /** The game folder of a profile (the selected one when left out). */
  gameDir(idInput?: unknown): string {
    return instanceDir(this.deps.paths, idInput === undefined || idInput === null ? this.deps.profiles.selected().id : this.existing(idInput).id)
  }

  private async view(id: string): Promise<ProfileView> {
    const view = (await this.views()).find((p) => p.id === id)

    if (!view) {
      throw new Error('That profile no longer exists.')
    }

    return view
  }

  private existing(id: unknown): StoredProfile {
    const profile = typeof id === 'string' && PROFILE_ID.test(id) ? this.deps.profiles.get(id) : undefined

    if (!profile) {
      throw new Error('That profile no longer exists.')
    }

    return profile
  }

  private async copyFolder(source: string, target: string, what: 'settings' | 'everything', worlds: boolean): Promise<void> {
    if (what === 'settings') {
      for (const item of SETTINGS_FILES) {
        const from = join(source, item)

        if (await stat(from).then(() => true, () => false)) {
          await mkdir(join(target, item, '..'), { recursive: true })
          await cp(from, join(target, item), { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true })
        }
      }

      return
    }

    if (!(await stat(source).then((info) => info.isDirectory(), () => false))) {
      return
    }

    await cp(source, target, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
      filter: (path) => {
        const rel = relative(source, path)

        if (rel === '') {
          return true
        }

        const top = rel.split(sep)[0]!
        const name = basename(path)
        return !NOT_DUPLICATED.has(top) && (worlds || top !== 'saves') && !name.endsWith('.tmp') && !/^hs_err_pid\d+\.log$/.test(name)
      }
    })
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => {})
    return run
  }
}

/** For the delete warning: how many worlds and how many bytes the folder holds (counted up to a limit). */
export async function folderContents(folder: string): Promise<{ worlds: number; bytes: number }> {
  const worlds = await readdir(join(folder, 'saves'), { withFileTypes: true })
    .then((entries) => entries.filter((entry) => entry.isDirectory()).length)
    .catch(() => 0)
  let bytes = 0
  let visited = 0
  const pending = [folder]

  while (pending.length > 0 && visited < 50_000) {
    const dir = pending.pop()!
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])

    for (const entry of entries) {
      visited++
      const path = join(dir, entry.name)

      if (entry.isDirectory()) {
        pending.push(path)
      } else if (entry.isFile()) {
        bytes += await stat(path).then((info) => info.size, () => 0)
      }
    }
  }

  return { worlds, bytes }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
