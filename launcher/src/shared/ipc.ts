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
  openExternal: 'shell:open-external',
  settingsPickJava: 'settings:pick-java',
  settingsJavaInfo: 'settings:java-info',
  gameOpenCrashFile: 'game:open-crash-file',
  appInfo: 'app:info',
  profilesList: 'profiles:list',
  profilesCreate: 'profiles:create',
  profilesUpdate: 'profiles:update',
  profilesRemove: 'profiles:remove',
  profilesSelect: 'profiles:select',
  modsList: 'mods:list',
  modsAdd: 'mods:add',
  modsAddDropped: 'mods:add-dropped',
  modsSetEnabled: 'mods:set-enabled',
  modsRemove: 'mods:remove',
  modsIcon: 'mods:icon',
  /** Main → renderer events. */
  eventSignIn: 'event:sign-in',
  eventGame: 'event:game',
  eventLog: 'event:log',
  eventAccounts: 'event:accounts',
  eventProfiles: 'event:profiles'
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

/** 'close' hides the launcher while the game runs and quits when it exits (it comes back if the game crashes). */
export type AfterLaunch = 'keep-open' | 'minimize' | 'close'

/** Launcher-wide settings. Memory and JVM arguments are per profile (ProfileView). */
export interface LauncherSettings {
  /** A Java executable to use instead of the managed runtime, or null. */
  javaPath: string | null
  width: number
  height: number
  fullscreen: boolean
  afterLaunch: AfterLaunch
}

export const DEFAULT_SETTINGS: LauncherSettings = {
  javaPath: null,
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

/** Mods that stopped a launch (GameState.modProblems): Play again with ignoreModProblems to go ahead. */
export interface BlockingModProblems {
  profileId: string
  /** How many mods have errors (a broken mods folder counts as one). */
  errors: number
  /** The first few, for the card. */
  mods: Array<{ key: string; name: string; message: string }>
}

export interface GameState {
  phase: GamePhase
  /** The profile being prepared, played, or that just exited/crashed/failed (absent when idle). */
  profile?: { id: string; name: string }
  task?: TaskProgress
  exitCode?: number | null
  /** On 'exited': the player ended the game from the launcher (Force quit). */
  closedByLauncher?: boolean
  crash?: CrashSummary
  /** A user-facing message for 'failed'. */
  error?: string
  /** On 'failed': the launch was stopped before starting because the profile's mods have errors. */
  modProblems?: BlockingModProblems
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
  /** Which launch the line belongs to, counted from 1 since the launcher started. Lines from earlier launches are kept. */
  session?: number
  /** The name of the profile that launch played. */
  profile?: string
}

/** A profile's folders ('game' is the profile's game folder), or the launcher's own folder. */
export type FolderKind = 'game' | 'mods' | 'logs' | 'crash-reports' | 'screenshots' | 'launcher'

/** The files a crash summary can point to. */
export type CrashFileKind = 'report' | 'jvm-error'

/** The Java chosen in Settings, checked again: its version, or why it can't be used. */
export interface JavaStatus {
  path: string
  version: string | null
  problem: string | null
}

export interface AppInfo {
  version: string
  minecraftVersion: string
  /** False when this build has no Microsoft client id, so signing in can't work. */
  signInAvailable: boolean
  /** False when the OS has no secure storage (e.g. Linux without a keyring): accounts aren't remembered. */
  secureStorage: boolean
  /** Installed RAM. */
  totalMemoryMb: number
  /** What the main process accepts for a profile's memoryMb (up to 75% of installed RAM). */
  memoryRangeMb: { min: number; max: number }
  /** The Minecraft versions a profile can use, the default first. */
  gameVersions: GameVersionView[]
  platform: 'win32' | 'darwin' | 'linux' | (string & {})
}

export interface GameVersionView {
  /** The Minecraft version, e.g. "1.21.11". */
  id: string
  /** e.g. "Minecraft 1.21.11". */
  label: string
  /** The Java major version it needs. */
  java: number
}

export interface ProfileView {
  /** Folder name under instances/; fixed for the profile's life. */
  id: string
  name: string
  gameVersion: string
  memoryMb: number
  jvmArgs: string
  /** The profile Play launches. */
  selected: boolean
  /** The game is starting or running with this profile: its mods can't change until it closes. */
  running: boolean
  createdAt: number
  lastPlayedAt: number | null
  /** Turned-on mods in its mods folder (not counting Wave Client and Fabric API). */
  modCount: number
}

export interface ProfileCreate {
  name: string
  /**
   * Start from another profile: 'settings' copies options, keybinds, servers and the Wave Client
   * HUD (options.txt, servers.dat, config/waveclient/); 'everything' duplicates its folder
   * (mods, config, packs...) except worlds unless `worlds`. Memory and JVM arguments come from
   * that profile; without `copy`, from the selected profile.
   */
  copy?: { from: string; what: 'settings' | 'everything'; worlds?: boolean }
}

export type ProfilePatch = Partial<Pick<ProfileView, 'name' | 'gameVersion' | 'memoryMb' | 'jvmArgs'>>

export type ModProblemCode =
  // errors: the game would refuse to start
  | 'unreadable'
  | 'built-in'
  | 'minecraft'
  | 'loader'
  | 'java'
  | 'missing'
  | 'disabled-dependency'
  | 'dependency-version'
  | 'breaks'
  | 'folder'
  | 'overrides'
  // warnings: the game starts; something may not work as expected
  | 'not-fabric'
  | 'case'
  | 'server-only'
  | 'duplicate'
  | 'fabric-api-copy'
  | 'conflicts'
  | 'recommends'
  | 'unchecked'
  | 'copying'
  | 'unknown-dependency'
  | 'custom-fabric-options'

/** A one-click fix shown next to a problem: turn a mod on or off, or remove it. */
export interface ModFix {
  kind: 'enable' | 'disable' | 'remove'
  /** The mod it acts on (ModView.key). */
  key: string
  label: string
}

export interface ModProblem {
  severity: 'error' | 'warning'
  code: ModProblemCode
  /** Written for players: what is wrong and what to do. */
  message: string
  /** Technical detail (the raw version requirement, the parser error). */
  detail?: string
  /** For 'missing': the mod id, for a "Find on Modrinth" link. */
  modId?: string
  fix?: ModFix
}

export interface ModView {
  /** The file name without ".disabled": stable across turning it on and off; how the mod is addressed. */
  key: string
  /** The file name in mods/ now, e.g. "sodium-fabric-0.6.13+mc1.21.11.jar" or "...jar.disabled". */
  file: string
  /** Turned on (its file ends in .jar). */
  enabled: boolean
  /** Fabric will load it: turned on, a readable Fabric mod for the client, and not a duplicate left unused. */
  loads: boolean
  /** Fabric mod id, or null when it isn't a (readable) Fabric mod. */
  id: string | null
  /** Other ids it provides (Fabric "provides"). */
  provides: string[]
  name: string
  version: string | null
  description: string | null
  authors: string[]
  /** Whether it has an icon (load it with mods.icon). */
  hasIcon: boolean
  size: number
  /** Names of turned-on mods that need this one (for "turn it off anyway?"). */
  neededBy: string[]
  problems: ModProblem[]
}

/** Wave Client and Fabric API: always loaded, not part of the profile's mods folder. */
export interface IncludedMod {
  id: string
  name: string
  version: string
}

export interface ModsReport {
  profileId: string
  gameVersion: string
  folder: 'ok' | 'missing' | 'not-a-folder' | 'unreadable'
  /** Sorted by name, case-insensitively. */
  mods: ModView[]
  included: IncludedMod[]
  /** Problems about the profile rather than one mod (its mods folder, dependency overrides, custom Fabric options). */
  profileProblems: ModProblem[]
  /** Errors across the profile (mods and profile-level): the launch stops while there are any. */
  errors: number
  warnings: number
}

export type AddSkipReason =
  | 'already-installed'
  | 'not-fabric'
  | 'built-in'
  | 'not-a-jar'
  | 'not-a-file'
  | 'folder'
  | 'too-large'
  | 'unreadable'
  | 'modpack'
  | 'resource-pack'

export interface AddModsResult {
  added: Array<{
    key: string
    name: string
    version: string | null
    /** Set when it replaced another version of the same mod. */
    replaced?: { version: string | null }
  }>
  skipped: Array<{ name: string; reason: AddSkipReason; message: string }>
  /** The profile's mods afterwards. */
  report: ModsReport
}

/** What the preload script exposes as window.wave. */
export interface WaveApi {
  app: {
    info(): Promise<AppInfo>
    /** Opens a folder of a profile (the selected one if left out), or the launcher's folder. */
    openFolder(kind: FolderKind, profileId?: string): Promise<void>
    /** Opens an https link from the allow-list (Microsoft, Xbox, Minecraft help pages) in the browser. */
    openExternal(url: string): Promise<void>
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
    /**
     * Saves changes and returns the settings as saved. javaPath can only be reset to null here
     * (pickJava sets it). JVM options that run code need the player's OK in a native dialog;
     * declining rejects the call.
     */
    set(settings: Partial<LauncherSettings>): Promise<LauncherSettings>
    /** Shows a file picker for a Java executable, checks it, saves it as javaPath and returns it; null if cancelled. */
    pickJava(): Promise<{ path: string; version: string } | null>
    /** Checks the saved Java again (it may have been updated or removed); null when the bundled Java is used. */
    javaInfo(): Promise<JavaStatus | null>
  }
  profiles: {
    list(): Promise<ProfileView[]>
    /** Creates a profile; it becomes the selected one unless the game is busy. */
    create(options: ProfileCreate): Promise<ProfileView>
    /** JVM options that run code need the player's OK in a native dialog; declining rejects the call. */
    update(id: string, patch: ProfilePatch): Promise<ProfileView>
    /**
     * Moves the profile's folder to the Recycle Bin/Trash and removes it; refused for the last
     * profile and while it is running. If trashing fails, nothing is removed and the call rejects.
     * `permanently` deletes it outright after the player confirms in a native dialog.
     */
    remove(id: string, options?: { permanently?: boolean }): Promise<void>
    /** Makes it the profile Play launches; refused while the game is busy. */
    select(id: string): Promise<void>
    onChange(listener: (profiles: ProfileView[]) => void): () => void
  }
  mods: {
    list(profileId: string): Promise<ModsReport>
    /** Shows a file picker for .jar files and adds them to the profile. Empty result when cancelled. */
    add(profileId: string): Promise<AddModsResult>
    /** Adds files dropped on the window. Only real dropped files work: their paths are resolved in the preload. */
    addDropped(profileId: string, files: File[]): Promise<AddModsResult>
    /** Turns a mod on or off by key; refused while that profile is running. */
    setEnabled(profileId: string, key: string, enabled: boolean): Promise<ModsReport>
    /** Moves a mod to the Recycle Bin/Trash; refused while that profile is running. */
    remove(profileId: string, key: string): Promise<ModsReport>
    /** The mod's icon as a data: URL, or null. */
    icon(profileId: string, key: string): Promise<string | null>
  }
  game: {
    /**
     * Launches the selected profile. It stops before starting when the profile's mods have errors
     * (state 'failed' with modProblems) unless ignoreModProblems, which also stops that exact set
     * of problems from stopping later launches.
     */
    launch(options?: { repair?: boolean; ignoreModProblems?: boolean }): Promise<void>
    cancel(): Promise<void>
    kill(): Promise<void>
    state(): Promise<GameState>
    /** Opens the crash report or JVM error log of the last crash in the default text editor. */
    openCrashFile(kind: CrashFileKind): Promise<void>
    onState(listener: (state: GameState) => void): () => void
  }
  logs: {
    snapshot(): Promise<LogLine[]>
    exportToFile(): Promise<string | null>
    onLine(listener: (lines: LogLine[]) => void): () => void
  }
}
