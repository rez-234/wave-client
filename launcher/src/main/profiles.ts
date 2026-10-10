import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { DEFAULT_GAME_VERSION, findGameVersion } from './game/versions'
import { MAX_JVM_ARGS_LENGTH, MIN_MEMORY_MB, memoryRangeMb } from './settings'

/** One profile as saved in profiles.json. Its game folder is instances/<id>/. */
export interface StoredProfile {
  /** Folder name; fixed for the profile's life (renaming changes only `name`). */
  id: string
  name: string
  gameVersion: string
  memoryMb: number
  jvmArgs: string
  createdAt: number
  lastPlayedAt: number | null
}

interface ProfilesFile {
  version: 1
  selected: string
  profiles: StoredProfile[]
}

export const PROFILE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
export const MAX_PROFILE_NAME = 40
export const DEFAULT_MEMORY_MB = 4096
export const DEFAULT_PROFILE_ID = 'default'

/** Settings an older launcher kept in launcher.json, which now belong to the first profile. */
export interface LegacySettings {
  memoryMb?: unknown
  jvmArgs?: unknown
}

/** A folder-safe id for a new profile: its name in lowercase letters, digits and dashes. */
export function profileIdFor(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'profile'

  if (!taken.has(base)) {
    return base
  }

  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`

    if (!taken.has(candidate)) {
      return candidate
    }
  }
}

/** A display name: trimmed, one line, at most 40 characters; null when nothing is left. */
export function cleanProfileName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const name = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_PROFILE_NAME).trim()
  return name.length > 0 ? name : null
}

/**
 * The profiles and which one is selected, saved to profiles.json. Every change is written right
 * away, one write at a time; listeners hear about each change.
 */
export class ProfileStore {
  private data: ProfilesFile
  private writing: Promise<void> = Promise.resolve()
  /** Called after every change, so the window can show it. */
  onChange: (() => void) | null = null

  constructor(
    private readonly file: string,
    private readonly totalMemoryMb: number,
    private readonly now: () => number = Date.now
  ) {
    this.data = { version: 1, selected: DEFAULT_PROFILE_ID, profiles: [this.defaultProfile({})] }
  }

  /**
   * Reads profiles.json. Without one (first start, or after an update from a launcher without
   * profiles), there is one profile, "Default", using instances/default and the memory and JVM
   * arguments from the old global settings.
   */
  async load(legacy: LegacySettings = {}): Promise<void> {
    let parsed: Partial<ProfilesFile> | null = null
    let text: string | null = null

    try {
      text = await readFile(this.file, 'utf8')
      parsed = JSON.parse(text) as Partial<ProfilesFile>
    } catch {
      // A file that exists but can't be read is kept under another name, never overwritten.
      if (text !== null) {
        await rename(this.file, `${this.file}.unreadable-${this.now()}`).catch(() => {})
      }

      parsed = null
    }

    const profiles = Array.isArray(parsed?.profiles) ? parsed.profiles.map((p) => this.sanitize(p)).filter((p): p is StoredProfile => p !== null) : []
    const unique = profiles.filter((profile, index) => profiles.findIndex((other) => other.id === profile.id) === index)

    if (unique.length === 0) {
      unique.push(this.defaultProfile(legacy))
    }

    const selected = typeof parsed?.selected === 'string' && unique.some((p) => p.id === parsed!.selected) ? parsed.selected : unique[0]!.id
    this.data = { version: 1, selected, profiles: unique }

    if (parsed === null) {
      await this.save()
    }
  }

  list(): StoredProfile[] {
    return this.data.profiles.map((profile) => ({ ...profile }))
  }

  get(id: string): StoredProfile | undefined {
    const profile = this.data.profiles.find((p) => p.id === id)
    return profile ? { ...profile } : undefined
  }

  selected(): StoredProfile {
    return this.get(this.data.selected) ?? { ...this.data.profiles[0]! }
  }

  /** Adds a profile with default settings (or a copy of another's) and selects it. */
  async create(name: string, copyFrom?: StoredProfile): Promise<StoredProfile> {
    const clean = cleanProfileName(name)

    if (!clean) {
      throw new Error('Give the profile a name.')
    }

    const id = profileIdFor(clean, new Set(this.data.profiles.map((p) => p.id)))
    const profile: StoredProfile = {
      ...this.defaultProfile({}),
      ...(copyFrom ? { gameVersion: copyFrom.gameVersion, memoryMb: copyFrom.memoryMb, jvmArgs: copyFrom.jvmArgs } : {}),
      id,
      name: clean,
      createdAt: this.now(),
      lastPlayedAt: null
    }
    this.data.profiles.push(profile)
    this.data.selected = id
    await this.save()
    return { ...profile }
  }

  /** Changes a profile's name or game settings; values are checked and clamped like on load. */
  async update(id: string, patch: Partial<Pick<StoredProfile, 'name' | 'gameVersion' | 'memoryMb' | 'jvmArgs' | 'lastPlayedAt'>>): Promise<StoredProfile> {
    const index = this.data.profiles.findIndex((p) => p.id === id)

    if (index < 0) {
      throw new Error('That profile no longer exists.')
    }

    const current = this.data.profiles[index]!

    if ('name' in patch && cleanProfileName(patch.name) === null) {
      throw new Error('Give the profile a name.')
    }

    if ('gameVersion' in patch && (typeof patch.gameVersion !== 'string' || !findGameVersion(patch.gameVersion))) {
      throw new Error('Wave Client doesn\'t support that Minecraft version.')
    }

    const next = this.sanitize({ ...current, ...patch, id: current.id, createdAt: current.createdAt })!
    this.data.profiles[index] = next
    await this.save()
    return { ...next }
  }

  async remove(id: string): Promise<void> {
    if (this.data.profiles.length <= 1) {
      throw new Error("You can't delete your only profile.")
    }

    const index = this.data.profiles.findIndex((p) => p.id === id)

    if (index < 0) {
      return
    }

    this.data.profiles.splice(index, 1)

    if (this.data.selected === id) {
      this.data.selected = this.data.profiles[Math.max(0, index - 1)]!.id
    }

    await this.save()
  }

  async select(id: string): Promise<void> {
    if (!this.data.profiles.some((p) => p.id === id)) {
      throw new Error('That profile no longer exists.')
    }

    this.data.selected = id
    await this.save()
  }

  private defaultProfile(legacy: LegacySettings): StoredProfile {
    return this.sanitize({
      id: DEFAULT_PROFILE_ID,
      name: 'Default',
      gameVersion: DEFAULT_GAME_VERSION.minecraft,
      memoryMb: legacy.memoryMb ?? DEFAULT_MEMORY_MB,
      jvmArgs: legacy.jvmArgs ?? '',
      createdAt: this.now(),
      lastPlayedAt: null
    })!
  }

  /** A profile from disk or a patch, cleaned up; null when it can't be used (bad id or name). */
  private sanitize(input: unknown): StoredProfile | null {
    const value = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
    const name = cleanProfileName(value.name)

    if (typeof value.id !== 'string' || !PROFILE_ID.test(value.id) || !name) {
      return null
    }

    const range = memoryRangeMb(this.totalMemoryMb)
    const memory = typeof value.memoryMb === 'number' && Number.isFinite(value.memoryMb) ? Math.round(value.memoryMb) : DEFAULT_MEMORY_MB

    return {
      id: value.id,
      name,
      gameVersion: typeof value.gameVersion === 'string' && findGameVersion(value.gameVersion) ? value.gameVersion : DEFAULT_GAME_VERSION.minecraft,
      memoryMb: Math.min(range.max, Math.max(MIN_MEMORY_MB, memory)),
      jvmArgs: typeof value.jvmArgs === 'string' ? value.jvmArgs.slice(0, MAX_JVM_ARGS_LENGTH) : '',
      createdAt: typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : this.now(),
      lastPlayedAt: typeof value.lastPlayedAt === 'number' && Number.isFinite(value.lastPlayedAt) ? value.lastPlayedAt : null
    }
  }

  private save(): Promise<void> {
    this.onChange?.()
    const run = this.writing.then(
      () => this.write(),
      () => this.write()
    )
    this.writing = run.catch(() => {})
    return run
  }

  private async write(): Promise<void> {
    const temp = `${this.file}.tmp`
    await mkdir(dirname(this.file), { recursive: true })

    try {
      await writeFile(temp, JSON.stringify(this.data, null, 2))
      await rename(temp, this.file)
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {})
      throw error
    }
  }
}
