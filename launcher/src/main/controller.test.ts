import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_SETTINGS, type GameState, type LogLine } from '@shared/ipc'

import { AccountStore, type StoredAccount } from './accounts/store'
import { AuthError } from './auth/errors'
import type { AuthService } from './auth/service'
import { GameController, userMessage } from './controller'
import { prepareGame, type PreparedGame } from './game/install'
import type { GameSession } from './game/process'
import { DownloadError, HashMismatchError } from './net/downloads'
import { HttpClient, HttpError } from './net/http'
import { DownloadQueue } from './net/downloads'
import { launcherPaths } from './paths'
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
  let window: { afterLaunch: ReturnType<typeof vi.fn<(mode: string) => void>>; afterExit: ReturnType<typeof vi.fn<(mode: string, crashed: boolean) => void>> }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wave-ctl-'))
    accounts = new AccountStore(join(dir, 'a.dat'), { available: () => false, encrypt: (t) => Buffer.from(t), decrypt: (b) => b.toString() })
    await accounts.load()
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
    const settings = new SettingsStore(join(dir, 'launcher.json'), 16384)
    return new GameController({
      context: { http, queue: new DownloadQueue({ http }), paths: launcherPaths(dir), platform: 'linux', arch: 'x64', osVersion: '6' },
      auth: { ensureFresh: async () => ACCOUNT, ...auth } as AuthService,
      accounts,
      settings,
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
    expect(vi.mocked(prepareGame).mock.calls[0]![1]).toMatchObject({ repair: false, javaPath: null, bundledModJar: '/mod/waveclient-0.4.0.jar' })
    await expect(ctl.launch()).rejects.toThrow(/already/)
  })

  it('turns failures into a message players can act on, without leaking the token', async () => {
    await accounts.upsert(ACCOUNT)
    vi.mocked(prepareGame).mockResolvedValue(PREPARED)
    const ctl = controller({ ensureFresh: async () => Promise.reject(new AuthError('invalid-grant', 'Please sign in to Steve again.')) })
    await ctl.launch()

    expect(states.at(-1)).toEqual({ phase: 'failed', error: 'Please sign in to Steve again.' })
    expect(lines.at(-1)?.message).toBe('Please sign in to Steve again.')
    expect(JSON.stringify(lines)).not.toContain('secret-access-token-123')
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
    expect(userMessage(new DownloadError([{ item, error: new TypeError('fetch failed') }]))).toMatch(/Couldn't download 1 game file/)
    expect(userMessage(new DownloadError([{ item, error: new HashMismatchError('u', 'a', 'b') }]))).toMatch(/checksum/)
    expect(userMessage(new HttpError(503, 'https://x', ''))).toMatch(/aren't responding/)
    expect(userMessage(new TypeError('fetch failed'))).toMatch(/internet connection/)
    expect(userMessage(new Error('ENOSPC: no space left on device'))).toMatch(/disk is full/)
    expect(userMessage(new Error("Minecraft 1.21.11 doesn't support Linux on arm64."))).toBe("Minecraft 1.21.11 doesn't support Linux on arm64.")
    expect(userMessage({})).toMatch(/Something went wrong/)
  })
})
