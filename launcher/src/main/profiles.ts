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
  /** The mod problems the player chose to play with anyway (a hash); they stop no further launches. */
  playAnyway: string | null
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
/** Names Windows reserves for devices: a folder called "con" can't be created there. */
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/

/** Settings an older launcher kept in launcher.json, which now belong to the first profile. */
export interface LegacySettings {
  memoryMb?: unknown
  jvmArgs?: unknown
}

export type ProfileChanges = Partial<Pick<StoredProfile, 'name' | 'gameVersion' | 'memoryMb' | 'jvmArgs' | 'lastPlayedAt' | 'playAnyway'>>

/**
 * A folder-safe id for a new profile: its name in lowercase letters, digits and dashes, never a
 * Windows device name, and unique (case-insensitively) among `taken`.
 */
export function profileIdFor(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((id) => id.toLowerCase()))
  let base =
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'profile'

  if (RESERVED.test(base)) {
    base = `${base}-profile`
  }

  if (!used.has(base)) {
    return base
  }

  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`

    if (!used.has(candidate)) {
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

/** "PvP (copy)", then "PvP (copy 2)"... a name not yet used. */
export function copyName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()))
  const base = name.replace(/ \(copy( \d+)?\)$/, '').slice(0, MAX_PROFILE_NAME - 10)

  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${base} (copy)` : `${base} (copy ${n})`

    if (!used.has(candidate.toLowerCase())) {
      return candidate
    }
  }
}

export interface ProfileStoreOptions {
  /** profiles.json */
  file: string
  totalMemoryMb: number
  /** The folder names in instances/, for adopting orphaned folders and keeping ids unique. */
  listFolders: () => Promise<string[]>
  now?: () => number
  log?: (message: string) => void
}

/**
 * The profiles and which one is selected, saved to profiles.json. Every change is written right
 * away, one write at a time; listeners hear about each change.
 */
export class ProfileStore {
  private data: ProfilesFile
  private writing: Promise<void> = Promise.resolve()
  /** Why profiles.json couldn't be read and was kept as it is; nothing is written while set. */
  private unreadable: string | null = null
  private readonly now: () => number
  /** Called after every change, so the window can show it. */
  onChange: (() => void) | null = null

  constructor(private readonly options: ProfileStoreOptions) {
    this.now = options.now ?? Date.now
    this.data = { version: 1, selected: DEFAULT_PROFILE_ID, profiles: [this.newProfile(DEFAULT_PROFILE_ID, 'Default', {})] }
  }

  /**
   * Reads profiles.json. Without one (first start, or an update from a launcher without
   * profiles), the Default profile gets the memory and JVM arguments the old launcher kept in
   * launcher.json. Folders in instances/ that no profile owns (a profile restored from the trash,
   * or a damaged profiles.json) become profiles again.
   */
  async load(legacy: LegacySettings = {}): Promise<void> {
    let parsed: Partial<ProfilesFile> | null = null
    let text: string | null = null
    let dirty = false
    this.unreadable = null

    try {
      text = await readFile(this.options.file, 'utf8')
      parsed = JSON.parse(text) as Partial<ProfilesFile>
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code

      if (text !== null) {
        // A damaged file is kept under another name, never overwritten.
        const kept = `${this.options.file}.unreadable-${this.now()}`

        try {
          await rename(this.options.file, kept)
          this.options.log?.(`profiles.json could not be read and was set aside as ${kept}`)
        } catch (renameError) {
          this.unreadable = `it is damaged and couldn't be set aside (${messageOf(renameError)})`
        }
      } else if (code !== 'ENOENT') {
        // There is a file, but it can't be opened now (permissions, another program): keep it.
        this.unreadable = code ?? messageOf(error)
      }

      parsed = null
      dirty = true
    }

    if (this.unreadable !== null) {
      this.options.log?.(`profiles.json could not be read (${this.unreadable}); it is left as it is and profile changes won't be saved`)
    }

    const profiles: StoredProfile[] = []

    for (const entry of Array.isArray(parsed?.profiles) ? parsed.profiles : []) {
      const profile = this.sanitize(entry)

      if (profile && !profiles.some((p) => p.id.toLowerCase() === profile.id.toLowerCase())) {
        profiles.push(profile)
      }
    }

    if (parsed === null && !profiles.some((p) => p.id === DEFAULT_PROFILE_ID) && text === null && this.unreadable === null) {
      profiles.push(this.newProfile(DEFAULT_PROFILE_ID, 'Default', legacy))
    }

    for (const folder of await this.options.listFolders().catch(() => [] as string[])) {
      if (PROFILE_ID.test(folder) && !profiles.some((p) => p.id.toLowerCase() === folder.toLowerCase())) {
        const name = this.uniqueName(folder === DEFAULT_PROFILE_ID ? 'Default' : folder, profiles)
        profiles.push(this.newProfile(folder, name, folder === DEFAULT_PROFILE_ID ? legacy : {}))
        this.options.log?.(`Found the profile folder ${folder} and added it as a profile`)
        dirty = true
      }
    }

    if (profiles.length === 0) {
      profiles.push(this.newProfile(DEFAULT_PROFILE_ID, 'Default', legacy))
      dirty = true
    }

    const selected = typeof parsed?.selected === 'string' && profiles.some((p) => p.id === parsed!.selected) ? parsed.selected : profiles[0]!.id
    this.data = { version: 1, selected, profiles }

    if ((dirty || parsed === null) && this.unreadable === null) {
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

  /** The id a new profile with this name would get (unique among profiles and folders). */
  async nextId(name: string): Promise<string> {
    const folders = await this.options.listFolders().catch(() => [] as string[])
    return profileIdFor(name, [...this.data.profiles.map((p) => p.id), ...folders])
  }

  /**
   * Adds a profile. Its memory and JVM arguments come from `from` (or default ones); only those
   * fields are copied. Selects it when `select`.
   */
  async create(name: string, id: string, from: StoredProfile | null, select: boolean): Promise<StoredProfile> {
    this.refuseUnreadable()
    const clean = this.checkName(name, null)

    if (!PROFILE_ID.test(id) || this.data.profiles.some((p) => p.id.toLowerCase() === id.toLowerCase())) {
      throw new Error('That profile folder is already in use.')
    }

    const profile = this.newProfile(id, clean, from ? { memoryMb: from.memoryMb, jvmArgs: from.jvmArgs } : {})

    if (from) {
      profile.gameVersion = from.gameVersion
    }

    this.data.profiles.push(profile)

    if (select) {
      this.data.selected = id
    }

    await this.save()
    return { ...profile }
  }

  /** Changes a profile's name, game settings or play record; values are checked and clamped like on load. */
  async update(id: string, changes: ProfileChanges): Promise<StoredProfile> {
    this.refuseUnreadable()
    const index = this.data.profiles.findIndex((p) => p.id === id)

    if (index < 0) {
      throw new Error('That profile no longer exists.')
    }

    const current = this.data.profiles[index]!
    const patch: ProfileChanges = { ...changes }

    if ('name' in patch) {
      patch.name = this.checkName(patch.name, id)
    }

    if ('gameVersion' in patch && (typeof patch.gameVersion !== 'string' || !findGameVersion(patch.gameVersion))) {
      throw new Error("Wave Client doesn't support that Minecraft version.")
    }

    const next = this.sanitize({ ...current, ...patch, id: current.id, createdAt: current.createdAt })!
    this.data.profiles[index] = next
    await this.save()
    return { ...next }
  }

  /** Removes a profile from the list (its folder is the caller's business). */
  async remove(id: string): Promise<void> {
    this.refuseUnreadable()

    if (this.data.profiles.length <= 1) {
      throw new Error("You can't delete your only profile.")
    }

    const index = this.data.profiles.findIndex((p) => p.id === id)

    if (index < 0) {
      return
    }

    this.data.profiles.splice(index, 1)

    if (this.data.selected === id) {
      // The most recently played one, else the first.
      const played = [...this.data.profiles].sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))[0]!
      this.data.selected = played.lastPlayedAt ? played.id : this.data.profiles[0]!.id
    }

    await this.save()
  }

  async select(id: string): Promise<void> {
    this.refuseUnreadable()

    if (!this.data.profiles.some((p) => p.id === id)) {
      throw new Error('That profile no longer exists.')
    }

    this.data.selected = id
    await this.save()
  }

  /** A clean name, refusing an empty one or one another profile already has. */
  checkName(value: unknown, ownId: string | null): string {
    const name = cleanProfileName(value)

    if (!name) {
      throw new Error('Give the profile a name.')
    }

    if (this.data.profiles.some((p) => p.id !== ownId && p.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`A profile named ${name} already exists.`)
    }

    return name
  }

  private uniqueName(name: string, profiles: StoredProfile[]): string {
    const used = new Set(profiles.map((p) => p.name.toLowerCase()))

    if (!used.has(name.toLowerCase())) {
      return name
    }

    for (let n = 2; ; n++) {
      const candidate = `${name} ${n}`

      if (!used.has(candidate.toLowerCase())) {
        return candidate
      }
    }
  }

  private newProfile(id: string, name: string, legacy: LegacySettings): StoredProfile {
    return this.sanitize({
      id,
      name,
      gameVersion: DEFAULT_GAME_VERSION.minecraft,
      memoryMb: legacy.memoryMb ?? DEFAULT_MEMORY_MB,
      jvmArgs: legacy.jvmArgs ?? '',
      createdAt: this.now(),
      lastPlayedAt: null,
      playAnyway: null
    })!
  }

  /** A profile from disk or a patch, cleaned up; null when it can't be used (bad id or name). */
  private sanitize(input: unknown): StoredProfile | null {
    const value = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
    const name = cleanProfileName(value.name)

    if (typeof value.id !== 'string' || !PROFILE_ID.test(value.id) || !name) {
      return null
    }

    const range = memoryRangeMb(this.options.totalMemoryMb)
    const memory = typeof value.memoryMb === 'number' && Number.isFinite(value.memoryMb) ? Math.round(value.memoryMb) : DEFAULT_MEMORY_MB

    return {
      id: value.id,
      name,
      gameVersion: typeof value.gameVersion === 'string' && findGameVersion(value.gameVersion) ? value.gameVersion : DEFAULT_GAME_VERSION.minecraft,
      memoryMb: Math.min(range.max, Math.max(MIN_MEMORY_MB, memory)),
      jvmArgs: typeof value.jvmArgs === 'string' ? value.jvmArgs.slice(0, MAX_JVM_ARGS_LENGTH) : '',
      createdAt: typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : this.now(),
      lastPlayedAt: typeof value.lastPlayedAt === 'number' && Number.isFinite(value.lastPlayedAt) ? value.lastPlayedAt : null,
      playAnyway: typeof value.playAnyway === 'string' && value.playAnyway.length <= 128 ? value.playAnyway : null
    }
  }

  private refuseUnreadable(): void {
    if (this.unreadable !== null) {
      throw new Error(`Wave Client couldn't read profiles.json (${this.unreadable}), so profile changes can't be saved. Check that file in ${dirname(this.options.file)}, then restart Wave Client.`)
    }
  }

  private save(): Promise<void> {
    this.refuseUnreadable()
    this.onChange?.()
    const run = this.writing.then(
      () => this.write(),
      () => this.write()
    )
    this.writing = run.catch(() => {})
    return run
  }

  private async write(): Promise<void> {
    const temp = `${this.options.file}.tmp`
    await mkdir(dirname(this.options.file), { recursive: true })

    try {
      await writeFile(temp, JSON.stringify(this.data, null, 2))
      await rename(temp, this.options.file)
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {})
      throw error
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
