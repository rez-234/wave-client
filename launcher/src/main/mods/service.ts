import { createHash, randomBytes } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, open, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'

import type { AddModsResult, AddSkipReason, IncludedMod, ModProblem, ModView, ModsReport } from '@shared/ipc'

import { probeJava } from '../game/java'
import { findGameVersion, DEFAULT_GAME_VERSION, type GameVersionSpec } from '../game/versions'
import { instanceDir, type LauncherPaths } from '../paths'
import type { StoredProfile } from '../profiles'
import { splitJvmArgs } from '../settings'
import { analyzeMods } from './analyze'
import { FileExistsError, checkModKey, fileInUseMessage, findModFile, freeModName, renameNoClobber } from './files'
import { readModIcon, readModJar } from './jar'
import { ModJarCache, scanModsFolder } from './scan'
import type { IncludedSpec, ModAnalysis, ModReadResult, ScanResult, ScannedMod } from './types'
import { withZipFile } from './zip'

/** Larger files aren't accepted as mods. */
export const MAX_MOD_SIZE = 256 * 1024 * 1024
const ICON_LIMIT = 32 * 1024
/** Ids the launcher provides itself: a jar claiming them is never added. */
const RESERVED_IDS = new Set(['minecraft', 'java', 'fabricloader', 'waveclient'])
/** JVM properties that change which mods Fabric finds or how it checks them. */
const CUSTOM_FABRIC_OPTION = /^-Dfabric\.(modsFolder|debug\.disableModIds|gameVersion|debug\.replaceVersion)=/

export interface ModsServiceDeps {
  paths: LauncherPaths
  /** The profile, or undefined when it no longer exists. */
  profile: (id: string) => StoredProfile | undefined
  /** The game is starting or running with this profile (its jars may be open). */
  isRunning: (profileId: string) => boolean
  /**
   * The game is being prepared or started with this profile: its mods were already checked, so
   * none may be added until it runs (Fabric would load them unchecked).
   */
  isStarting?: (profileId: string) => boolean
  bundledModJar: () => Promise<string>
  /** Moves a file or folder to the OS trash (shell.trashItem). */
  trash: (path: string) => Promise<void>
  log: (message: string) => void
  now?: () => number
  /** The Java chosen in Settings, or null for the one the launcher installs. */
  javaPath?: () => string | null
  /** The major version of a Java executable (runs it); defaults to probeJava. */
  probeJavaMajor?: (path: string) => Promise<number>
}

/** What the controller needs to decide whether a launch may go ahead. */
export interface LaunchCheck {
  /** Mods with errors (a broken mods folder counts as one). */
  errors: number
  /** The first three, with their first error. */
  mods: Array<{ key: string; name: string; message: string }>
  /** Identifies this exact set of errors, for "Play anyway". */
  hash: string
}

/**
 * Everything about a profile's mods folder: reading it into a report, and every change to it
 * (add, turn on or off, remove). Changes to one profile's folder happen one at a time.
 */
export class ModsService {
  private readonly cache = new ModJarCache()
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly now: () => number
  private bundledInfo: { path: string; version: string | null } | null = null
  private javaInfo: { path: string; mtimeMs: number; major: Promise<number | null> } | null = null

  constructor(private readonly deps: ModsServiceDeps) {
    this.now = deps.now ?? Date.now
  }

  modsDir(profileId: string): string {
    return join(instanceDir(this.deps.paths, profileId), 'mods')
  }

  /** Runs `task` after every earlier change to this profile's folder has finished. */
  exclusive<T>(profileId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(profileId) ?? Promise.resolve()
    const run = previous.then(task, task)
    const settled = run.catch(() => {})
    this.queues.set(profileId, settled)
    void settled.then(() => {
      if (this.queues.get(profileId) === settled) {
        this.queues.delete(profileId)
      }
    })
    return run
  }

  /** Turned-on mods, counted from the file names alone (no jars opened). */
  async modCount(profileId: string): Promise<number> {
    const names = await readdir(this.modsDir(profileId)).catch(() => [] as string[])
    return names.filter((name) => name.endsWith('.jar') && !name.startsWith('.')).length
  }

  async report(profileId: string): Promise<ModsReport> {
    const profile = this.requireProfile(profileId)
    const { scan, analysis, included } = await this.analyze(profile)
    return this.toReport(profile, scan, analysis, included)
  }

  /** Errors that should stop a launch of this profile. */
  async launchCheck(profileId: string): Promise<LaunchCheck> {
    const report = await this.report(profileId)
    const errors: Array<{ key: string; name: string; message: string; code: string }> = []

    for (const problem of report.profileProblems) {
      if (problem.severity === 'error') {
        errors.push({ key: '', name: 'Mods folder', message: problem.message, code: problem.code })
      }
    }

    for (const mod of report.mods) {
      for (const problem of mod.problems) {
        if (problem.severity === 'error') {
          errors.push({ key: mod.key, name: mod.name, message: problem.message, code: problem.code })
        }
      }
    }

    const hash = createHash('sha1')
      .update(errors.map((e) => `${e.key}:${e.code}`).sort().join('\n'))
      .digest('hex')
    // One entry per mod (the folder counts as one): the card says "2 mods have problems".
    const firstPerMod = errors.filter((error, index) => errors.findIndex((other) => other.key === error.key) === index)
    return { errors: firstPerMod.length, mods: firstPerMod.slice(0, 3).map(({ key, name, message }) => ({ key, name, message })), hash }
  }

  async setEnabled(profileId: string, key: unknown, enabled: boolean): Promise<ModsReport> {
    const modKey = checkModKey(key)
    return this.exclusive(profileId, async () => {
      this.refuseWhileRunning(profileId)
      const dir = this.modsDir(profileId)
      const current = await findModFile(dir, modKey)

      if (!current) {
        throw new Error('That mod is no longer in the mods folder.')
      }

      const normal = modKey.replace(/\.jar$/i, '.jar')
      const target = enabled ? normal : `${normal}.disabled`

      if (current.file !== target) {
        try {
          await renameNoClobber(dir, current.file, target)
        } catch (error) {
          throw new Error(error instanceof FileExistsError ? error.message : (fileInUseMessage(error) ?? `Couldn't rename the mod: ${messageOf(error)}`))
        }
      }

      return this.report(profileId)
    })
  }

  async remove(profileId: string, key: unknown): Promise<ModsReport> {
    const modKey = checkModKey(key)
    return this.exclusive(profileId, async () => {
      this.refuseWhileRunning(profileId)
      const dir = this.modsDir(profileId)
      const current = await findModFile(dir, modKey)

      if (current) {
        try {
          await this.deps.trash(join(dir, current.file))
        } catch (error) {
          throw new Error(fileInUseMessage(error) ?? `Couldn't move the mod to the trash: ${messageOf(error)}`)
        }
      }

      return this.report(profileId)
    })
  }

  async icon(profileId: string, key: unknown): Promise<string | null> {
    const modKey = checkModKey(key)
    const dir = this.modsDir(profileId)
    const current = await findModFile(dir, modKey)

    if (!current) {
      return null
    }

    const path = join(dir, current.file)
    const read = await this.readJar(path)
    const iconPath = read.ok ? read.info.metadata?.icon : null

    if (!iconPath) {
      return null
    }

    const png = await readModIcon(path, iconPath).catch(() => null)
    return png && png.length <= ICON_LIMIT ? `data:image/png;base64,${png.toString('base64')}` : null
  }

  /**
   * Adds jar files the player picked or dropped. Every path is checked here, whatever the page
   * sent: an absolute path to a regular .jar file outside the launcher's own folder, at most
   * 256 MB, that is a Fabric mod. A newer (or older) copy of a mod already in the profile replaces
   * it, keeping it on or off as it was.
   */
  add(profileId: string, sources: unknown[]): Promise<AddModsResult> {
    this.requireProfile(profileId)
    return this.exclusive(profileId, async () => {
      if (this.deps.isStarting?.(profileId)) {
        throw new Error('Minecraft is starting with this profile. Add the mods once it has started, or after it closes.')
      }

      const dir = this.modsDir(profileId)
      const result: AddModsResult = { added: [], skipped: [], report: undefined as unknown as ModsReport }

      for (const source of sources.slice(0, 500)) {
        const name = typeof source === 'string' && source.length > 0 ? basename(source) : 'A dropped item'

        try {
          const outcome = await this.addOne(profileId, dir, source)

          if (outcome.added) {
            result.added.push(outcome.added)
          } else {
            result.skipped.push({ name, reason: outcome.reason, message: outcome.message })
          }
        } catch (error) {
          this.deps.log(`Adding ${name} failed: ${messageOf(error)}`)
          result.skipped.push({ name, reason: 'unreadable', message: `${name} couldn't be added: ${messageOf(error)}` })
        }
      }

      result.report = await this.report(profileId)
      return result
    })
  }

  private async addOne(
    profileId: string,
    dir: string,
    source: unknown
  ): Promise<{ added: AddModsResult['added'][number]; reason?: never; message?: never } | { added?: never; reason: AddSkipReason; message: string }> {
    if (typeof source !== 'string' || source.length === 0) {
      return { reason: 'not-a-file', message: "That item isn't a file on this computer. Save or extract it first, then add it." }
    }

    const name = basename(source)

    if (!isAbsolute(source)) {
      return { reason: 'not-a-file', message: `${name} isn't a file on this computer.` }
    }

    const info = await stat(source).catch(() => null)

    if (!info) {
      return { reason: 'not-a-file', message: `${name} couldn't be found.` }
    }

    if (info.isDirectory()) {
      return { reason: 'folder', message: `${name} is a folder. Add the .jar files in it instead.` }
    }

    if (!info.isFile()) {
      return { reason: 'not-a-file', message: `${name} isn't a regular file.` }
    }

    const extension = extname(name).toLowerCase()

    if (extension === '.mrpack') {
      return { reason: 'modpack', message: `${name} is a modpack. Modpacks can't be imported yet; add its mods one by one.` }
    }

    if (extension === '.zip') {
      const isPack = await withZipFile(source, async (zip) => zip.entry('pack.mcmeta') !== undefined).catch(() => false)
      return isPack
        ? { reason: 'resource-pack', message: `${name} is a resource pack. Put it in the profile's resourcepacks folder.` }
        : { reason: 'not-a-jar', message: `${name} isn't a mod: mods are .jar files.` }
    }

    if (extension !== '.jar') {
      return { reason: 'not-a-jar', message: `${name} isn't a mod: mods are .jar files.` }
    }

    if (await this.insideLauncher(source)) {
      return { reason: 'not-a-file', message: `${name} is one of Wave Client's own files.` }
    }

    // Copy from one open handle, so what is checked is what was copied.
    await mkdir(dir, { recursive: true })
    const temp = join(dir, `.wave-add-${randomBytes(6).toString('hex')}.tmp`)
    const handle = await open(source, 'r')

    try {
      const { size } = await handle.stat()

      if (size > MAX_MOD_SIZE) {
        return { reason: 'too-large', message: `${name} is too large to be a mod.` }
      }

      await pipeline(handle.createReadStream({ start: 0, end: Math.max(0, size - 1), autoClose: false }), createWriteStream(temp, { flags: 'wx' }))
    } finally {
      await handle.close()
    }

    try {
      const read = await readModJar(temp)

      if (!read.ok) {
        return { reason: 'unreadable', message: `${name} isn't a working mod file (${read.message}).` }
      }

      const metadata = read.info.metadata

      if (!metadata) {
        const loader = read.info.nonFabric === 'forge' ? 'Forge' : read.info.nonFabric === 'neoforge' ? 'NeoForge' : read.info.nonFabric === 'quilt' ? 'Quilt' : null
        return {
          reason: 'not-fabric',
          message: loader
            ? `${name} is a ${loader} mod. Wave Client runs Fabric mods: get its Fabric version for Minecraft ${this.spec(profileId).minecraft}.`
            : `${name} isn't a Fabric mod.`
        }
      }

      if ([metadata.id, ...metadata.provides].some((id) => RESERVED_IDS.has(id))) {
        return { reason: 'built-in', message: `${metadata.name ?? metadata.id} is already part of Wave Client.` }
      }

      const scan = await scanModsFolder(dir, this.cache)
      const existing = scan.mods.find((mod) => mod.read.ok && mod.read.info.metadata?.id === metadata.id)

      if (existing && existing.read.ok && existing.read.info.metadata?.version === metadata.version && existing.size === (await stat(temp)).size) {
        if ((await sha1(join(dir, existing.file))) === (await sha1(temp))) {
          return { reason: 'already-installed', message: `${metadata.name ?? metadata.id} ${metadata.version} is already installed.` }
        }
      }

      const enabled = existing ? existing.state !== 'off' : true
      const finalName = await freeModName(dir, name, existing ? [existing.file] : [])

      if (existing) {
        try {
          await this.deps.trash(join(dir, existing.file))
        } catch {
          // Out of the way at least: Fabric loads only .jar files.
          await rename(join(dir, existing.file), join(dir, `${existing.key}.replaced-${this.now()}`))
        }
      }

      await renameNoClobber(dir, basename(temp), enabled ? finalName : `${finalName}.disabled`)
      const replaced = existing?.read.ok ? { version: existing.read.info.metadata?.version ?? null } : undefined
      return { added: { key: finalName, name: metadata.name ?? metadata.id, version: metadata.version, ...(replaced ? { replaced } : {}) } }
    } finally {
      await rm(temp, { force: true }).catch(() => {})
    }
  }

  private async insideLauncher(path: string): Promise<boolean> {
    const root = await realpath(this.deps.paths.root).catch(() => resolve(this.deps.paths.root))
    const real = await realpath(path).catch(() => resolve(path))
    const rel = relative(root, real)
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  }

  private async analyze(profile: StoredProfile): Promise<{ scan: ScanResult; analysis: ModAnalysis; included: IncludedSpec[] }> {
    const spec = findGameVersion(profile.gameVersion) ?? DEFAULT_GAME_VERSION
    const scan = await scanModsFolder(this.modsDir(profile.id), this.cache)
    const included = await this.included(spec)
    const java = await this.javaMajor(spec)
    const analysis = analyzeMods({
      mods: scan.mods,
      minecraft: spec.minecraft,
      javaMajor: java ?? spec.java,
      included,
      overrides: await this.readOverrides(profile.id),
      customFabricOptions: splitJvmArgs(profile.jvmArgs).some((arg) => CUSTOM_FABRIC_OPTION.test(arg)),
      now: this.now()
    })

    if (java === null) {
      softenJavaErrors(analysis)
    }

    return { scan, analysis, included }
  }

  /**
   * The major version of the Java the game will run with: the one chosen in Settings (run once
   * per file to ask), else the version's own. Null when the chosen one can't be asked.
   */
  private async javaMajor(spec: GameVersionSpec): Promise<number | null> {
    const path = this.deps.javaPath?.() ?? null

    if (!path) {
      return spec.java
    }

    const mtimeMs = await stat(path).then(
      (info) => info.mtimeMs,
      () => null
    )

    if (mtimeMs === null) {
      return null
    }

    if (this.javaInfo?.path !== path || this.javaInfo.mtimeMs !== mtimeMs) {
      const probe = this.deps.probeJavaMajor ?? ((javaPath: string) => probeJava(javaPath).then((info) => info.major))
      this.javaInfo = {
        path,
        mtimeMs,
        major: probe(path).catch((error: unknown) => {
          this.deps.log(`Couldn't check the version of ${path}: ${messageOf(error)}`)
          return null
        })
      }
    }

    return this.javaInfo.major
  }

  /** Fabric Loader, Fabric API and Wave Client, as the launcher installs them for this version. */
  private async included(spec: GameVersionSpec): Promise<IncludedSpec[]> {
    return [
      { id: 'fabricloader', name: 'Fabric Loader', version: spec.fabricLoader, provides: [], nested: [{ id: 'mixinextras', version: spec.mixinExtras, provides: [] }] },
      { id: 'fabric-api', name: 'Fabric API', version: spec.fabricApi, provides: ['fabric'], nested: spec.fabricApiModules.map((m) => ({ ...m, provides: [...m.provides] })) },
      { id: 'waveclient', name: 'Wave Client', version: (await this.bundledVersion()) ?? '0.0.0', provides: [], nested: [] }
    ]
  }

  private async bundledVersion(): Promise<string | null> {
    try {
      const path = await this.deps.bundledModJar()

      if (this.bundledInfo?.path !== path) {
        const read = await readModJar(path)
        this.bundledInfo = { path, version: read.ok ? (read.info.metadata?.version ?? null) : null }
      }

      return this.bundledInfo.version
    } catch {
      return null
    }
  }

  /** The overrides file's text; the analysis parses it with Fabric's own JSON rules. */
  private async readOverrides(profileId: string): Promise<{ ok: true; text: string } | { ok: false; message: string } | null> {
    try {
      return { ok: true, text: await readFile(join(instanceDir(this.deps.paths, profileId), 'config', 'fabric_loader_dependencies.json'), 'utf8') }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      // Fabric reads it only when it exists; one it can't open stops the game.
      return code === 'ENOENT' || code === 'ENOTDIR' ? null : { ok: false, message: messageOf(error) }
    }
  }

  private toReport(profile: StoredProfile, scan: ScanResult, analysis: ModAnalysis, included: IncludedSpec[]): ModsReport {
    const profileProblems: ModProblem[] = [...analysis.profileProblems]
    let errors = analysis.errors

    if (scan.folder === 'not-a-folder' || scan.folder === 'unreadable') {
      profileProblems.unshift({
        severity: 'error',
        code: 'folder',
        message:
          scan.folder === 'not-a-folder'
            ? 'The mods folder is a file, not a folder. Rename or remove it, then try again.'
            : "The mods folder can't be read. Check its permissions."
      })
      errors++
    }

    const mods: ModView[] = scan.mods.map((mod) => this.toView(mod, analysis))
    mods.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.key.localeCompare(b.key))

    return {
      profileId: profile.id,
      gameVersion: profile.gameVersion,
      folder: scan.folder,
      mods,
      included: included.filter((mod) => mod.id !== 'fabricloader').map((mod): IncludedMod => ({ id: mod.id, name: mod.name, version: mod.version })),
      profileProblems,
      errors,
      warnings: analysis.warnings
    }
  }

  private toView(mod: ScannedMod, analysis: ModAnalysis): ModView {
    const result = analysis.mods.get(mod.key)
    const metadata = mod.read.ok ? mod.read.info.metadata : null

    return {
      key: mod.key,
      file: mod.file,
      enabled: mod.state === 'on',
      loads: result?.loads ?? false,
      id: metadata?.id ?? null,
      provides: metadata?.provides ?? [],
      name: metadata?.name ?? metadata?.id ?? mod.key.replace(/\.jar$/i, ''),
      version: metadata?.version ?? null,
      description: metadata?.description ?? null,
      authors: metadata?.authors ?? [],
      hasIcon: Boolean(metadata?.icon),
      size: mod.size,
      neededBy: result?.neededBy ?? [],
      problems: result?.problems ?? []
    }
  }

  private readJar(path: string): Promise<ModReadResult> {
    return readModJar(path)
  }

  private spec(profileId: string): GameVersionSpec {
    return findGameVersion(this.deps.profile(profileId)?.gameVersion ?? '') ?? DEFAULT_GAME_VERSION
  }

  private requireProfile(profileId: string): StoredProfile {
    const profile = typeof profileId === 'string' ? this.deps.profile(profileId) : undefined

    if (!profile) {
      throw new Error('That profile no longer exists.')
    }

    return profile
  }

  private refuseWhileRunning(profileId: string): void {
    if (this.deps.isRunning(profileId)) {
      throw new Error('Minecraft is running with this profile. Close it to change its mods.')
    }
  }
}

/** The Java in Settings couldn't be asked its version: its requirements are only a warning. */
function softenJavaErrors(analysis: ModAnalysis): void {
  const soften = (problem: ModProblem): ModProblem => (problem.code === 'java' && problem.severity === 'error' ? { ...problem, severity: 'warning' } : problem)
  analysis.profileProblems = analysis.profileProblems.map(soften)

  for (const result of analysis.mods.values()) {
    result.problems = result.problems.map(soften)
  }

  const all = [...analysis.profileProblems, ...[...analysis.mods.values()].flatMap((result) => result.problems)]
  analysis.errors = all.filter((problem) => problem.severity === 'error').length
  analysis.warnings = all.length - analysis.errors
}

async function sha1(path: string): Promise<string> {
  return createHash('sha1')
    .update(await readFile(path))
    .digest('hex')
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
