import type { AfterLaunch, CrashFileKind, GameState, LogLevel, LogLine, TaskProgress } from '@shared/ipc'

import type { AccountStore } from './accounts/store'
import { AuthError } from './auth/errors'
import type { AuthService } from './auth/service'
import { isCrashFile } from './game/crash'
import { buildLaunchCommand, redact } from './game/launch-command'
import { prepareGame, type GameContext } from './game/install'
import { NoManagedJavaError } from './game/java'
import { GameSession, MAX_LINES, type GameExit } from './game/process'
import { DEFAULT_GAME_VERSION, findGameVersion } from './game/versions'
import type { LaunchCheck } from './mods/service'
import { DownloadError, HashMismatchError, SizeMismatchError, localFileProblem } from './net/downloads'
import { HttpError, NetworkError } from './net/http'
import { instanceDir } from './paths'
import type { ProfileStore, StoredProfile } from './profiles'
import type { SettingsStore } from './settings'

export interface ControllerDeps {
  context: GameContext
  auth: AuthService
  accounts: AccountStore
  settings: SettingsStore
  profiles: ProfileStore
  /** Checks the profile's mods before a launch. */
  checkMods: (profileId: string, signal: AbortSignal) => Promise<LaunchCheck>
  bundledModJar: () => Promise<string>
  clientId: () => Promise<string>
  launcherName: string
  launcherVersion: string
  emitState: (state: GameState) => void
  emitLines: (lines: LogLine[]) => void
  /** What happens to the launcher window around a game session. */
  window: { afterLaunch: (mode: AfterLaunch) => void; afterExit: (mode: AfterLaunch, crashed: boolean) => void }
  log: (message: string) => void
  /** Starts the game; tests replace it. */
  startSession?: (session: GameSession) => void
}

const BUSY = new Set<GameState['phase']>(['preparing', 'downloading', 'starting', 'running'])

/**
 * Runs one game at a time: install or check files, refresh the account, build the command,
 * start Minecraft, and report what happened when it exits.
 */
export class GameController {
  private state: GameState = { phase: 'idle' }
  private abort: AbortController | null = null
  private session: GameSession | null = null
  /** Output of this and earlier launches (the newest MAX_LINES lines), so nothing vanishes on Play again. */
  private lines: LogLine[] = []
  private seq = 0
  private launches = 0
  /** The profile of the current or last launch, as it was when Play was pressed. */
  private profile: { id: string; name: string; gameDir: string } | null = null

  constructor(private readonly deps: ControllerDeps) {}

  getState(): GameState {
    return this.state
  }

  snapshot(): LogLine[] {
    return [...this.lines]
  }

  /** The crash report or JVM error log of the crash being shown, if there is one (inside that profile's folder). */
  crashFile(kind: CrashFileKind): string | null {
    const crash = this.state.phase === 'crashed' ? this.state.crash : undefined
    const file = (kind === 'report' ? crash?.reportPath : crash?.jvmErrorPath) ?? null
    return file && this.profile && isCrashFile(this.profile.gameDir, file) ? file : null
  }

  /** Whether the game is starting or running with this profile (its files may be in use). */
  isBusyWith(profileId: string): boolean {
    return BUSY.has(this.state.phase) && this.profile?.id === profileId
  }

  get busy(): boolean {
    return BUSY.has(this.state.phase)
  }

  async launch(options: { repair?: boolean; ignoreModProblems?: boolean } = {}): Promise<void> {
    if (BUSY.has(this.state.phase)) {
      throw new Error('Minecraft is already starting or running.')
    }

    const account = this.deps.accounts.selected()

    if (!account) {
      throw new Error('Sign in with a Microsoft account first.')
    }

    // Everything about the profile is read now: changes made while it plays apply next time.
    const profile: StoredProfile = { ...this.deps.profiles.selected() }
    const spec = findGameVersion(profile.gameVersion) ?? DEFAULT_GAME_VERSION
    const abort = new AbortController()
    this.abort = abort
    this.launches++
    this.profile = { id: profile.id, name: profile.name, gameDir: instanceDir(this.deps.context.paths, profile.id) }
    this.setState({ phase: 'preparing', task: { label: 'Checking mods', doneFiles: 0, totalFiles: 0, doneBytes: 0, totalBytes: 0 } })
    const settings = this.deps.settings.get()
    let secrets: string[] = []

    try {
      const check = await untilAborted(this.deps.checkMods(profile.id, abort.signal), abort.signal)

      if (check.errors > 0) {
        const accepted = check.hash === profile.playAnyway

        if (!accepted && !options.ignoreModProblems) {
          const message = `${problemCount(check.errors)}.`
          this.note('ERROR', `Not starting: ${message} ${check.mods.map((m) => `${m.name}: ${m.message}`).join(' ')}`)
          this.setState({ phase: 'failed', error: message, modProblems: { profileId: profile.id, errors: check.errors, mods: check.mods } })
          return
        }

        this.note('WARN', `Playing even though ${problemCount(check.errors)} (Play anyway)`)

        if (!accepted) {
          // Until the problems change, they don't stop this profile again.
          await this.deps.profiles.update(profile.id, { playAnyway: check.hash }).catch((error: unknown) => this.deps.log(`Couldn't save Play anyway: ${String(error)}`))
        }
      }

      this.note('INFO', options.repair ? 'Checking every game file (repair)' : 'Checking game files')
      const game = await prepareGame(this.deps.context, {
        signal: abort.signal,
        repair: options.repair === true,
        javaPath: settings.javaPath,
        bundledModJar: await this.deps.bundledModJar(),
        profileId: profile.id,
        gameVersion: spec,
        // A cancelled or finished launch's stragglers mustn't change the state any more.
        onTask: (task) => {
          if (this.abort === abort && !abort.signal.aborted) {
            this.onTask(task)
          }
        }
      })

      this.setState({ phase: 'preparing', task: { label: 'Signing in', doneFiles: 0, totalFiles: 0, doneBytes: 0, totalBytes: 0 } })
      const fresh = await this.deps.auth.ensureFresh(account.id, abort.signal)
      abort.signal.throwIfAborted()

      const command = buildLaunchCommand({
        ...game,
        account: { name: fresh.name, uuid: fresh.id, accessToken: fresh.mcAccessToken, xuid: fresh.xuid },
        settings,
        memoryMb: profile.memoryMb,
        jvmArgs: profile.jvmArgs,
        launcherName: this.deps.launcherName,
        launcherVersion: this.deps.launcherVersion,
        clientId: await this.deps.clientId()
      })
      secrets = command.secrets
      this.setState({ phase: 'starting' })

      const session = new GameSession(command, {
        onLines: (lines) => this.addLines(lines),
        onExit: (exit) => this.onExit(exit, settings.afterLaunch),
        nextSeq: () => this.seq++
      })
      this.session = session
      ;(this.deps.startSession ?? ((s) => s.start()))(session)
      this.setState({ phase: 'running' })
      await this.deps.profiles.update(profile.id, { lastPlayedAt: Date.now() }).catch((error: unknown) => this.deps.log(`Couldn't save the last played time: ${String(error)}`))
      this.deps.window.afterLaunch(settings.afterLaunch)
    } catch (error) {
      if (abort.signal.aborted) {
        this.note('INFO', 'Cancelled')
        this.setState({ phase: 'idle' })
        return
      }

      const message = userMessage(error)
      this.deps.log(`Launch failed: ${redact(technical(error), secrets)}`)
      this.note('ERROR', message)
      this.setState({ phase: 'failed', error: message })
    } finally {
      if (this.abort === abort) {
        this.abort = null
      }
    }
  }

  /** Stops preparing (downloads, sign-in). Has no effect once the game runs. */
  cancel(): void {
    this.abort?.abort()
  }

  kill(): void {
    this.session?.kill()
  }

  get running(): boolean {
    return this.session?.running === true
  }

  private onTask(task: TaskProgress): void {
    const phase = task.totalBytes > 0 || task.totalFiles > 0 ? 'downloading' : 'preparing'
    this.setState({ phase, task })
  }

  private onExit(exit: GameExit, afterLaunch: AfterLaunch): void {
    this.session = null
    const crashed = exit.crash !== null
    this.setState(crashed ? { phase: 'crashed', exitCode: exit.code, crash: exit.crash! } : { phase: 'exited', exitCode: exit.code, closedByLauncher: exit.killed })
    this.deps.window.afterExit(afterLaunch, crashed)
  }

  private addLines(batch: LogLine[]): void {
    const profile = this.profile?.name
    const lines = batch.map((line) => ({ ...line, session: this.launches, ...(profile ? { profile } : {}) }))
    this.lines.push(...lines)

    if (this.lines.length > MAX_LINES) {
      this.lines.splice(0, this.lines.length - MAX_LINES)
    }

    this.deps.emitLines(lines)
  }

  private note(level: LogLevel, message: string): void {
    this.addLines([{ seq: this.seq++, time: Date.now(), level, thread: 'Launcher', logger: 'Wave Client', message }])
  }

  private setState(state: GameState): void {
    this.state = state.phase !== 'idle' && this.profile ? { ...state, profile: { id: this.profile.id, name: this.profile.name } } : state
    this.deps.emitState(this.state)
  }
}

/** Settles with the promise, or rejects as soon as the signal aborts. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

function problemCount(mods: number): string {
  return mods === 1 ? '1 mod has problems' : `${mods} mods have problems`
}

/** A message a player can act on. Technical detail goes to the log instead. */
export function userMessage(error: unknown): string {
  if (error instanceof AuthError || error instanceof NoManagedJavaError) {
    return error.message
  }

  const local = localFileProblem(error instanceof DownloadError ? error.failures.find((f) => localFileProblem(f.error))?.error : error)

  if (local === 'disk-full') {
    return 'Your disk is full. Free up some space and try again.'
  }

  if (local === 'no-permission' || local === 'unwritable') {
    return "Wave Client couldn't write its game files (permission denied)."
  }

  if (local === 'in-use') {
    return 'A game file is in use by another program. Close any running Minecraft and try again.'
  }

  if (error instanceof DownloadError) {
    const hashes = error.failures.some((f) => f.error instanceof HashMismatchError || f.error instanceof SizeMismatchError)
    return hashes
      ? `${error.failures.length} game file${error.failures.length === 1 ? '' : 's'} didn't match their checksum after downloading. Please try again.`
      : `Couldn't download ${error.failures.length} game file${error.failures.length === 1 ? '' : 's'}. Check your internet connection and try again.`
  }

  if (error instanceof HttpError) {
    return error.status >= 500 || error.status === 429
      ? "Minecraft's or Fabric's servers aren't responding properly right now. Please try again in a few minutes."
      : `A download server answered with an error (HTTP ${error.status}). Please try again later.`
  }

  if (error instanceof NetworkError) {
    return "Couldn't reach the download servers. Check your internet connection."
  }

  if (error instanceof Error && /ENOSPC/.test(error.message)) {
    return 'Your disk is full. Free up some space and try again.'
  }

  if (error instanceof Error && /EACCES|EPERM/.test(error.message)) {
    return "Wave Client couldn't write its game files (permission denied)."
  }

  // Messages written for players (unsupported platform, Java too old, ...) come through as they are.
  if (error instanceof Error && error.message.length > 0 && error.message.length < 300 && !/\n/.test(error.message)) {
    return error.message
  }

  return 'Something went wrong while starting Minecraft. The log has the details.'
}

/** The log as a text file: one line per entry, stack traces under it, a header for each launch. */
export function logText(lines: readonly LogLine[]): string {
  const out: string[] = []
  let session: number | undefined

  for (const line of lines) {
    if (line.session !== undefined && line.session !== session) {
      session = line.session
      out.push(`---- Launch ${session}${line.profile ? ` · ${line.profile}` : ''} ----`)
    }

    out.push(`[${new Date(line.time).toISOString()}] [${line.thread ?? 'output'}/${line.level}] ${line.message}`)

    if (line.throwable) {
      out.push(line.throwable)
    }
  }

  return `${out.join('\n')}\n`
}

function technical(error: unknown): string {
  if (error instanceof AuthError) {
    return `${error.code}: ${error.message}${error.detail ? ` (${error.detail})` : ''}`
  }

  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}
