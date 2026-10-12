import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_SETTINGS, type GameState, type LogLine, type TaskProgress } from '@shared/ipc'

import { AccountStore, type StoredAccount } from './accounts/store'
import { AuthError } from './auth/errors'
import type { AuthService } from './auth/service'
import { GameController, logText, userMessage } from './controller'
import { prepareGame, type PreparedGame } from './game/install'
import type { GameSession } from './game/process'
import { DownloadError, HashMismatchError } from './net/downloads'
import { HttpClient, HttpError, NetworkError } from './net/http'
import { DownloadQueue } from './net/downloads'
import type { LaunchCheck } from './mods/service'
import { launcherPaths } from './paths'
import { ProfileStore } from './profiles'
import { SettingsStore } from './settings'

vi.mock('./game/install', () => ({ prepareGame: vi.fn() }))

const ACCOUNT: StoredAccount = {
  id: '0123456789abcdef0123456789abcdef',
  name: 'Steve',
  xuid: '1',
  msRefreshToken: 'r',
  msClientId: 'c',
  mcAccessToken: 'secret-access-token-123',
  mcExpiresAt: Date.now() + 86_400_000
}

const PREPARED: PreparedGame = {
  version: { id: 'fabric-loader-0.19.5-1.21.11', mainClass: 'Knot', arguments: { jvm: ['-cp', '${classpath}'], game: ['--accessToken', '${auth_access_token}'] } },
  env: { os: 'linux', arch: 'x64', osVersion: '6', features: {} },
  java: '/java',
  classpath: ['/a.jar'],
  gameDir: '/g',
  nativesDir: '/n',
  librariesDir: '/l',
  assetsRoot: '/as',
  assetIndexName: '29',
  logConfigPath: null,
  addMods: ['/client']
}

describe('GameController', () => {
  let dir: string
  let accounts: AccountStore
  let states: GameState[]
  let lines: LogLine[]
  let started: GameSession[]
  let profiles: ProfileStore
  let check: LaunchCheck
  let window: { afterLaunch: ReturnType<typeof vi.fn<(mode: string) => void>>; afterExit: ReturnType<typeof vi.fn<(mode: string, crashed: boolean) => void>> }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wave-ctl-'))
    accounts = new AccountStore(join(dir, 'a.dat'), { available: () => false, encrypt: (t) => Buffer.from(t), decrypt: (b) => b.toString() })
    await accounts.load()
    profiles = new ProfileStore({ file: join(dir, 'profiles.json'), totalMemoryMb: 16384, listFolders: () => readdir(join(dir, 'instances')).catch(() => []) })
    await profiles.load({ memoryMb: 3072, jvmArgs: '-XX:+UseZGC' })
    check = { errors: 0, mods: [], hash: 'none' }
    states = []
    lines = []
    started = []
    window = { afterLaunch: vi.fn<(mode: string) => void>(), afterExit: vi.fn<(mode: string, crashed: boolean) => void>() }
    vi.mocked(prepareGame).mockReset()
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  function controller(auth: Partial<AuthService> = {}) {
    const http = new HttpClient({ fetch: async () => new Response(''), userAgent: 't' })
    const settings = new SettingsStore(join(dir, 'launcher.json'))
    return new GameController({
      context: { http, queue: new DownloadQueue({ http }), paths: launcherPaths(dir), platform: 'linux', arch: 'x64', osVersion: '6' },
      auth: { ensureFresh: async () => ACCOUNT, ...auth } as AuthService,
      accounts,
      settings,
      profiles,
      checkMods: async () => check,
      bundledModJar: async () => '/mod/waveclient-0.4.0.jar',
      clientId: async () => 'cid',
      launcherName: 'wave-client',
      launcherVersion: '0.1.0',
      emitState: (state) => states.push(state),
      emitLines: (batch) => lines.push(...batch),
      window,
      log: () => {},
      startSession: (session) => started.push(session)
    })
  }

  it('needs a signed-in account', async () => {
    await expect(controller().launch()).rejects.toThrow(/Sign in/)
  })

  it('prepares, refreshes, starts the game and applies the after-launch setting', async () => {
    await accounts.upsert(ACCOUNT)
    vi.mocked(prepareGame).mockImplementation(async (_context, options) => {
      options.onTask?.({ label: 'Downloading assets', doneFiles: 1, totalFiles: 4, doneBytes: 10, totalBytes: 40 })
      return PREPARED
    })
    const ctl = controller()
    await ctl.launch()

    expect(states.map((s) => s.phase)).toEqual(['preparing', 'downloading', 'preparing', 'starting', 'running'])
    expect(started).toHaveLength(1)
    expect(window.afterLaunch).toHaveBeenCalledWith(DEFAULT_SETTINGS.afterLaunch)
    expect(vi.mocked(prepareGame).mock.calls[0]![1]).toMatchObject({ repair: false, javaPath: null, bundledModJar: '/mod/waveclient-0.4.0.jar', profileId: 'default' })
    expect(states.every((s) => s.profile?.name === 'Default')).toBe(true)
    expect(ctl.isBusyWith('default')).toBe(true)
    expect(ctl.isBusyWith('pvp')).toBe(false)
    expect(profiles.get('default')?.lastPlayedAt).toEqual(expect.any(Number))
    await expect(ctl.launch()).rejects.toThrow(/already/)
  })

  it("plays the selected profile with its own memory and Java arguments, as they were when Play was pressed", async () => {
    await accounts.upsert(ACCOUNT)
    await profiles.create('PvP', 'pvp', null, true)
    await profiles.update('pvp', { memoryMb: 2048, jvmArgs: '-Xss4M' })
    let release: () => void = () => {}
    vi.mocked(prepareGame).mockImplementation(async () => {
      await new Promise<void>((resolve) => (release = resolve))
      return PREPARED
    })
    const ctl = controller()
    const launching = ctl.launch()
    await vi.waitFor(() => expect(prepareGame).toHaveBeenCalled())
    // Changed while it starts: applies next time.
    await profiles.update('pvp', { memoryMb: 8192 })
    // Its mods were checked: none may be added until it runs.
    expect(ctl.isStartingWith('pvp')).toBe(true)
    expect(ctl.isStartingWith('default')).toBe(false)
    release()
    await launching
    expect(ctl.isStartingWith('pvp')).toBe(false)
    expect(ctl.isBusyWith('pvp')).toBe(true)

    const command = started[0]!['command'] as { args: string[] }
    expect(command.args).toEqual(expect.arrayContaining(['-Xmx2048M', '-Xss4M']))
    expect(command.args).not.toContain('-XX:+UseZGC')
    expect(lines.every((line) => line.profile === 'PvP')).toBe(true)
    expect(logText(ctl.snapshot())).toMatch(/^---- Launch 1 · PvP ----\n/)
  })

  it('stops before starting when the mods have errors, until the player chooses Play anyway', async () => {
    await accounts.upsert(ACCOUNT)
    vi.mocked(prepareGame).mockResolvedValue(PREPARED)
    check = { errors: 2, mods: [{ key: 'a.jar', name: 'A', message: 'Needs b.' }], hash: 'h1' }
    const ctl = controller()
    await ctl.launch()

    expect(states.at(-1)).toEqual({
      phase: 'failed',
      profile: { id: 'default', name: 'Default' },
      error: '2 mods have problems.',
      modProblems: { profileId: 'default', errors: 2, mods: [{ key: 'a.jar', name: 'A', message: 'Needs b.' }] }
    })
    expect(prepareGame).not.toHaveBeenCalled()

    await ctl.launch({ ignoreModProblems: true })
    expect(ctl.getState().phase).toBe('running')
    expect(profiles.get('default')?.playAnyway).toBe('h1')
    started[0]!['options'].onExit({ code: 0, signal: null, crash: null, killed: false })

    // The same problems don't stop it again; new ones do.
    await ctl.launch()
    expect(ctl.getState().phase).toBe('running')
    started[1]!['options'].onExit({ code: 0, signal: null, crash: null, killed: false })
    check = { ...check, hash: 'h2' }
    await ctl.launch()
    expect(ctl.getState()).toMatchObject({ phase: 'failed', modProblems: { errors: 2 } })
  })

  it('turns failures into a message players can act on, without leaking the token', async () => {
    await accounts.upsert(ACCOUNT)
    vi.mocked(prepareGame).mockResolvedValue(PREPARED)
    const ctl = controller({ ensureFresh: async () => Promise.reject(new AuthError('invalid-grant', 'Please sign in to Steve again.')) })
    await ctl.launch()

    expect(states.at(-1)).toEqual({ phase: 'failed', profile: { id: 'default', name: 'Default' }, error: 'Please sign in to Steve again.' })
    expect(lines.at(-1)?.message).toBe('Please sign in to Steve again.')
    expect(JSON.stringify(lines)).not.toContain('secret-access-token-123')
  })

  it('keeps the log across launches, numbered by launch, and reports a forced quit', async () => {
    await accounts.upsert(ACCOUNT)
    vi.mocked(prepareGame).mockResolvedValue(PREPARED)
    const ctl = controller()
    await ctl.launch()
    started[0]!['options'].onExit({ code: 143, signal: null, crash: null, killed: true })
    expect(states.at(-1)).toEqual({ phase: 'exited', profile: { id: 'default', name: 'Default' }, exitCode: 143, closedByLauncher: true })

    await ctl.launch()
    const snapshot = ctl.snapshot()
    expect(snapshot[0]?.session).toBe(1)
    expect(snapshot.at(-1)?.session).toBe(2)
    expect(lines.map((line) => line.session)).toEqual(snapshot.map((line) => line.session))
    expect(logText(snapshot)).toMatch(/^---- Launch 1 · Default ----\n[\s\S]*\n---- Launch 2 · Default ----\n/)
  })

  it('only offers the files of the crash being shown', async () => {
    await accounts.upsert(ACCOUNT)
    vi.mocked(prepareGame).mockResolvedValue(PREPARED)
    const ctl = controller()
    await ctl.launch()
    const report = join(dir, 'instances', 'default', 'crash-reports', 'crash-1.txt')
    const crash = { reason: 'boom', reportPath: report, jvmErrorPath: '/etc/passwd', suspectedMods: [], lastLines: [] }
    started[0]!['options'].onExit({ code: -1, signal: null, crash, killed: false })

    expect(ctl.crashFile('report')).toBe(report)
    // Only files in that profile's game folder.
    expect(ctl.crashFile('jvm-error')).toBeNull()
    await ctl.launch()
    expect(ctl.crashFile('report')).toBeNull()
  })

  it('ignores progress that arrives after a cancel, so Play works again', async () => {
    await accounts.upsert(ACCOUNT)
    const ctl = controller()
    let late: ((task: TaskProgress) => void) | undefined
    vi.mocked(prepareGame).mockImplementationOnce((_context, options) => new Promise((_resolve, reject) => {
      late = options.onTask
      options.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      setTimeout(() => ctl.cancel(), 1)
    }))
    await ctl.launch()

    // A download worker that was hashing a file reports after the cancel went through.
    late?.({ label: 'Downloading Java', doneFiles: 1, totalFiles: 2, doneBytes: 1, totalBytes: 2 })
    expect(ctl.getState()).toEqual({ phase: 'idle' })
    vi.mocked(prepareGame).mockResolvedValue(PREPARED)
    await ctl.launch()
    expect(ctl.getState().phase).toBe('running')
  })

  it('goes back to idle when cancelled', async () => {
    await accounts.upsert(ACCOUNT)
    const ctl = controller()
    vi.mocked(prepareGame).mockImplementation((_context, options) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      setTimeout(() => ctl.cancel(), 1)
    }))
    await ctl.launch()
    expect(states.at(-1)).toEqual({ phase: 'idle' })
  })
})

describe('userMessage', () => {
  it('explains downloads, servers, the network and the disk', () => {
    const item = { url: 'https://x/a', path: '/a' }
    expect(userMessage(new DownloadError([{ item, error: new NetworkError('x', 'https://x/a', false) }]))).toMatch(/Couldn't download 1 game file/)
    expect(userMessage(new DownloadError([{ item, error: Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' }) }]))).toMatch(/disk is full/)
    // Retried on Windows (antivirus), but reported as what it is once the retries are spent.
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { value: 'win32' })

    try {
      expect(userMessage(new DownloadError([{ item, error: Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' }) }]))).toMatch(/permission denied/)
      expect(userMessage(new DownloadError([{ item, error: Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }) }]))).toMatch(/in use/)
    } finally {
      Object.defineProperty(process, 'platform', platform)
    }
    expect(userMessage(new DownloadError([{ item, error: new HashMismatchError('u', 'a', 'b') }]))).toMatch(/checksum/)
    expect(userMessage(new HttpError(503, 'https://x', ''))).toMatch(/aren't responding/)
    expect(userMessage(new NetworkError("Couldn't reach https://x: net::ERR_INTERNET_DISCONNECTED", 'https://x', false))).toMatch(/internet connection/)
    expect(userMessage(new Error('ENOSPC: no space left on device'))).toMatch(/disk is full/)
    expect(userMessage(new Error("Minecraft 1.21.11 doesn't support Linux on arm64."))).toBe("Minecraft 1.21.11 doesn't support Linux on arm64.")
    expect(userMessage({})).toMatch(/Something went wrong/)
  })
})
