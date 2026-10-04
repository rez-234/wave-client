/**
 * The contract between the renderer (UI) and the main process. The renderer only ever sees these
 * shapes: no tokens, no file handles, no raw errors.
 */

export const IpcChannels = {
  accountsList: 'accounts:list',
  accountsSignIn: 'accounts:sign-in',
  accountsCancelSignIn: 'accounts:cancel-sign-in',
  accountsSignOut: 'accounts:sign-out',
  accountsSelect: 'accounts:select',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  gameLaunch: 'game:launch',
  gameCancel: 'game:cancel',
  gameKill: 'game:kill',
  gameState: 'game:state',
  logsSnapshot: 'logs:snapshot',
  logsExport: 'logs:export',
  openFolder: 'shell:open-folder',
  appInfo: 'app:info',
  /** Main → renderer events. */
  eventSignIn: 'event:sign-in',
  eventGame: 'event:game',
  eventLog: 'event:log',
  eventAccounts: 'event:accounts'
} as const

export interface AccountView {
  /** The Minecraft profile UUID without dashes. */
  id: string
  name: string
  selected: boolean
  /** 'expired' when the saved sign-in no longer works and the user must sign in again. */
  status: 'ok' | 'expired'
}

export type SignInMethod = 'browser' | 'device-code'

export type SignInStep = 'microsoft' | 'xbox' | 'minecraft' | 'profile'

export type SignInEvent =
  | { kind: 'waiting-for-browser' }
  | { kind: 'device-code'; userCode: string; verificationUri: string; expiresAt: number }
  | { kind: 'progress'; step: SignInStep }
  | { kind: 'done'; account: AccountView }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string; detail?: string; helpUrl?: string }

export type AfterLaunch = 'keep-open' | 'minimize' | 'close'

export interface LauncherSettings {
  /** Maximum heap for the game, in MiB. */
  memoryMb: number
  /** A Java executable to use instead of the managed runtime, or null. */
  javaPath: string | null
  /** Extra JVM arguments, space separated. */
  jvmArgs: string
  width: number
  height: number
  fullscreen: boolean
  afterLaunch: AfterLaunch
}

export const DEFAULT_SETTINGS: LauncherSettings = {
  memoryMb: 4096,
  javaPath: null,
  jvmArgs: '',
  width: 1280,
  height: 720,
  fullscreen: false,
  afterLaunch: 'keep-open'
}

export type GamePhase = 'idle' | 'preparing' | 'downloading' | 'starting' | 'running' | 'exited' | 'crashed' | 'failed'

/** What is being prepared, for the progress bar. */
export interface TaskProgress {
  label: string
  doneFiles: number
  totalFiles: number
  doneBytes: number
  totalBytes: number
}

export interface SuspectedMod {
  id: string
  name?: string
  file?: string
  reason: string
}

export interface CrashSummary {
  /** One line, e.g. the crash report's description or the JVM error. */
  reason: string
  reportPath: string | null
  jvmErrorPath: string | null
  suspectedMods: SuspectedMod[]
  /** The last lines of output before the game exited. */
  lastLines: string[]
}

export interface GameState {
  phase: GamePhase
  task?: TaskProgress
  exitCode?: number | null
  crash?: CrashSummary
  /** A user-facing message for 'failed'. */
  error?: string
}

export type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'

export interface LogLine {
  /** Increases by one per line, so the UI can merge snapshots and live events. */
  seq: number
  time: number
  level: LogLevel
  thread: string | null
  logger: string | null
  message: string
  throwable?: string
}

export type FolderKind = 'game' | 'mods' | 'logs' | 'crash-reports' | 'screenshots' | 'launcher'

export interface AppInfo {
  version: string
  minecraftVersion: string
  /** False when this build has no Microsoft client id, so signing in can't work. */
  signInAvailable: boolean
  /** False when the OS has no secure storage (e.g. Linux without a keyring): accounts aren't remembered. */
  secureStorage: boolean
  platform: 'win32' | 'darwin' | 'linux' | (string & {})
}

/** What the preload script exposes as window.wave. */
export interface WaveApi {
  app: {
    info(): Promise<AppInfo>
    openFolder(kind: FolderKind): Promise<void>
  }
  accounts: {
    list(): Promise<AccountView[]>
    signIn(method: SignInMethod): Promise<void>
    cancelSignIn(): Promise<void>
    signOut(id: string): Promise<void>
    select(id: string): Promise<void>
    onSignIn(listener: (event: SignInEvent) => void): () => void
    onChange(listener: (accounts: AccountView[]) => void): () => void
  }
  settings: {
    get(): Promise<LauncherSettings>
    set(settings: Partial<LauncherSettings>): Promise<LauncherSettings>
  }
  game: {
    launch(options?: { repair?: boolean }): Promise<void>
    cancel(): Promise<void>
    kill(): Promise<void>
    state(): Promise<GameState>
    onState(listener: (state: GameState) => void): () => void
  }
  logs: {
    snapshot(): Promise<LogLine[]>
    exportToFile(): Promise<string | null>
    onLine(listener: (lines: LogLine[]) => void): () => void
  }
}
