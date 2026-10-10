import { appendFile, mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { totalmem, release } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { BrowserWindow, Menu, app, dialog, net, powerMonitor, protocol, session, shell } from 'electron'

import { IpcChannels, type AfterLaunch, type AppInfo, type GameState } from '@shared/ipc'

import { AccountStore } from './accounts/store'
import { AuthService } from './auth/service'
import { LAUNCHER_NAME, msaClientId } from './config'
import { GameController } from './controller'
import { electronSecretBox } from './electron/secret-box'
import { PINS } from './game/pins'
import { GAME_VERSIONS } from './game/versions'
import { loadClientId } from './install-id'
import { confirmDeleteProfile, confirmRiskyJvmArgs, registerIpc } from './ipc'
import { ModsService } from './mods/service'
import { DownloadQueue } from './net/downloads'
import { HttpClient } from './net/http'
import { inside, launcherPaths } from './paths'
import { ProfileActions } from './profile-actions'
import { ProfileStore, type LegacySettings } from './profiles'
import { SettingsStore, memoryRangeMb } from './settings'

const root = process.env.WAVE_LAUNCHER_HOME ? resolve(process.env.WAVE_LAUNCHER_HOME) : join(app.getPath('appData'), 'WaveClient')
const paths = launcherPaths(root)
const rendererUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
const rendererDir = join(import.meta.dirname, '../renderer')
/**
 * The built page is served from its own origin rather than file://: a file:// page may read any
 * local file, and file URLs are spelled differently by Node and Chromium for some folder names,
 * which would make the trust check below refuse the launcher's own page.
 */
const APP_SCHEME = 'wave'
const APP_PAGE = `${APP_SCHEME}://launcher/index.html`
const smokeTest = process.env.WAVE_SMOKE_TEST === '1'

protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, codeCache: true } }])

// Chromium's caches go next to, not into, the game data.
app.setPath('userData', paths.electronData)
app.setAppUserModelId('dev.waveclient.launcher')

const logFile = join(root, 'logs', 'launcher.log')
function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}\n`
  void mkdir(join(root, 'logs'), { recursive: true })
    .then(() => appendFile(logFile, line))
    .catch(() => {})

  if (!app.isPackaged || smokeTest) {
    process.stdout.write(line)
  }
}

let mainWindow: BrowserWindow | null = null
/** Set once start-up has created the first window; before that there is nothing to show. */
let windowsReady = false

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Starting Wave Client again brings this one back, even if its window was closed while the game ran.
  app.on('second-instance', showLauncher)

  hardenWebContents()
  app.whenReady().then(start).catch((error: unknown) => {
    log(`Startup failed: ${String(error)}`)
    app.exit(1)
  })
}

async function start(): Promise<void> {
  protocol.handle(APP_SCHEME, serveRenderer)
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'clipboard-sanitized-write'))
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => permission === 'clipboard-sanitized-write')

  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
  }

  const http = new HttpClient({ fetch: (url, init) => net.fetch(url, init), userAgent: `WaveClient/${app.getVersion()} (+https://github.com/rez-234/wave-client)` })
  const queue = new DownloadQueue({ http, concurrency: 8 })
  const accounts = new AccountStore(paths.accountsFile, electronSecretBox, log)
  await accounts.load()
  const totalMemoryMb = Math.floor(totalmem() / (1024 * 1024))
  // Memory and JVM arguments used to be launcher-wide: the Default profile takes them over, read
  // before the settings store rewrites the file without them.
  const legacy = await readLegacySettings(paths.settingsFile)
  const profiles = new ProfileStore({ file: join(root, 'profiles.json'), totalMemoryMb, listFolders: () => readdir(paths.instances), log })
  await profiles.load(legacy)
  const settings = new SettingsStore(paths.settingsFile)
  await settings.load()
  const clientId = msaClientId(process.env.WAVE_MSA_CLIENT_ID, import.meta.env.MAIN_VITE_MSA_CLIENT_ID)
  const auth = new AuthService({
    http,
    store: accounts,
    clientId,
    openBrowser: (url) => shell.openExternal(url),
    log
  })

  const info: AppInfo = {
    version: app.getVersion(),
    minecraftVersion: PINS.minecraft,
    signInAvailable: auth.available,
    secureStorage: accounts.persistent,
    totalMemoryMb,
    memoryRangeMb: memoryRangeMb(totalMemoryMb),
    gameVersions: GAME_VERSIONS.map((version) => ({ id: version.minecraft, label: `Minecraft ${version.minecraft}`, java: version.java })),
    platform: process.platform
  }

  const send = (channel: string, payload: unknown): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload)
    }
  }

  // Set below; the mods service only asks once the game controller exists.
  let game: GameController | null = null
  const mods = new ModsService({
    paths,
    profile: (id) => profiles.get(id),
    isRunning: (id) => game?.isBusyWith(id) === true,
    bundledModJar: findBundledModJar,
    trash: (path) => shell.trashItem(path),
    log
  })

  let profilesTimer: NodeJS.Timeout | null = null
  let actions: ProfileActions | null = null
  // Coalesced: a launch changes the running state and the last played time at about the same moment.
  const emitProfiles = (): void => {
    profilesTimer ??= setTimeout(() => {
      profilesTimer = null
      void actions
        ?.views()
        .then((views) => send(IpcChannels.eventProfiles, views))
        .catch((error: unknown) => log(`Couldn't list profiles: ${String(error)}`))
    }, 50)
  }

  let busy = false
  const onState = (state: GameState): void => {
    send(IpcChannels.eventGame, state)
    const nowBusy = state.phase === 'preparing' || state.phase === 'downloading' || state.phase === 'starting' || state.phase === 'running'

    if (nowBusy !== busy) {
      busy = nowBusy
      emitProfiles()
    }
  }

  game = new GameController({
    context: { http, queue, paths, platform: process.platform, arch: process.arch, osVersion: release() },
    auth,
    accounts,
    settings,
    profiles,
    // Waits for any change to the folder in progress, so it checks what will be loaded.
    checkMods: (id) => mods.exclusive(id, () => mods.launchCheck(id)),
    bundledModJar: findBundledModJar,
    clientId: () => loadClientId(join(root, 'install-id')),
    launcherName: LAUNCHER_NAME,
    launcherVersion: app.getVersion(),
    emitState: onState,
    emitLines: batchLines((lines) => send(IpcChannels.eventLog, lines)),
    window: { afterLaunch, afterExit },
    log
  })

  const controller = game
  actions = new ProfileActions({
    paths,
    profiles,
    mods,
    game: {
      get busy() {
        return controller.busy
      },
      isBusyWith: (id) => controller.isBusyWith(id)
    },
    trash: (path) => shell.trashItem(path),
    confirmRiskyJvmArgs: (name, args) => confirmRiskyJvmArgs(mainWindow, name, args),
    confirmDelete: (name, contents) => confirmDeleteProfile(mainWindow, name, contents),
    log
  })

  const { emitAccounts } = registerIpc({
    window: () => mainWindow,
    isTrustedUrl,
    info: () => ({ ...info, secureStorage: accounts.persistent }),
    paths,
    accounts,
    auth,
    settings,
    game: controller,
    profiles: actions,
    mods,
    emitProfiles,
    log
  })
  // Refreshes can mark an account as needing sign-in or rename it; the window hears about every change.
  accounts.onChange = emitAccounts
  profiles.onChange = emitProfiles

  log(`Wave Client ${app.getVersion()} starting; data in ${root}; sign-in ${clientId ? 'configured' : 'not configured'}; secure storage ${accounts.persistent ? 'on' : 'off'}`)
  createWindow()
  windowsReady = true

  // macOS: the Dock icon brings the launcher back, also when it was hidden for the game.
  app.on('activate', showLauncher)

  app.on('window-all-closed', () => {
    // Keep running while the game does, so its output and crash report aren't lost.
    if (!controller.running) {
      app.quit()
    }
  })

  // Quitting outright (Cmd+Q, the Dock) while the game runs asks first: the game would carry on,
  // but the launcher would lose its output and crash report. Logging out or shutting down doesn't ask.
  let quitConfirmed = false
  let shuttingDown = false
  powerMonitor.on('shutdown', () => {
    shuttingDown = true
  })
  app.on('before-quit', (event) => {
    if (!controller.running || quitConfirmed || shuttingDown) {
      return
    }

    event.preventDefault()
    const options = {
      type: 'question' as const,
      buttons: ['Keep Wave Client open', 'Quit'],
      defaultId: 0,
      cancelId: 0,
      message: 'Minecraft is still running. Quit Wave Client anyway?',
      detail: "The game keeps running, but Wave Client won't show its log or a crash report."
    }
    void (mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options)).then(({ response }) => {
      if (response === 1) {
        quitConfirmed = true
        app.quit()
      }
    })
  })
}

/** Shows the launcher window, opening a new one if it was closed. */
function showLauncher(): void {
  if (!windowsReady) {
    return
  }

  if (!mainWindow) {
    createWindow()
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  mainWindow.show()
  mainWindow.focus()
}

/** wave://launcher/<path>: the built renderer's files, and nothing outside its folder. */
async function serveRenderer(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)

    if (url.host !== 'launcher' || (request.method !== 'GET' && request.method !== 'HEAD')) {
      return new Response('', { status: 404 })
    }

    const file = inside(rendererDir, decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html')
    return await net.fetch(pathToFileURL(file).href)
  } catch {
    return new Response('', { status: 404 })
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Wave Client',
    backgroundColor: '#0F1012',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    if (!smokeTest) {
      mainWindow?.show()
    }
  })

  mainWindow.webContents.once('did-finish-load', () => {
    if (smokeTest) {
      void runSmokeTest()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  void mainWindow.loadURL(rendererUrl ?? APP_PAGE)
}

/** The renderer's own page, and nothing else, may use the API and be navigated to. */
function isTrustedUrl(url: string): boolean {
  if (rendererUrl) {
    return url.startsWith(`${rendererUrl}/`) || url === rendererUrl
  }

  try {
    const parsed = new URL(url)
    return parsed.protocol === `${APP_SCHEME}:` && parsed.host === 'launcher' && parsed.pathname === '/index.html'
  } catch {
    return false
  }
}

function hardenWebContents(): void {
  app.on('session-created', (created) => {
    // A dragged-in link or a download request never writes a file from the page.
    created.on('will-download', (event) => event.preventDefault())
  })
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, url) => {
      if (!isTrustedUrl(url)) {
        event.preventDefault()
      }
    })
    contents.on('will-redirect', (event, url) => {
      if (!isTrustedUrl(url)) {
        event.preventDefault()
      }
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
}

function afterLaunch(mode: AfterLaunch): void {
  if (!mainWindow) {
    return
  }

  if (mode === 'minimize') {
    mainWindow.minimize()
  } else if (mode === 'close') {
    mainWindow.hide()
  }
}

function afterExit(mode: AfterLaunch, crashed: boolean): void {
  if (!mainWindow) {
    // The window was closed while the game ran: show a crash, otherwise we're done.
    if (crashed) {
      createWindow()
    } else {
      app.quit()
    }

    return
  }

  if (mode === 'close' && !crashed) {
    app.quit()
    return
  }

  if (mode !== 'keep-open' && mainWindow) {
    mainWindow.show()
    mainWindow.restore()
    mainWindow.focus()
  }
}

/** Sends log lines in batches of at most one per 100 ms, so a chatty game can't flood the UI. */
function batchLines<T>(send: (items: T[]) => void): (items: T[]) => void {
  let pending: T[] = []
  let timer: NodeJS.Timeout | null = null

  return (items) => {
    pending.push(...items)

    if (!timer) {
      timer = setTimeout(() => {
        timer = null
        const batch = pending
        pending = []
        send(batch)
      }, 100)
    }
  }
}

/**
 * Our mod jar: shipped in resources/mod/ by the installer; in development the Gradle build output
 * (or WAVE_MOD_JAR).
 */
async function findBundledModJar(): Promise<string> {
  if (process.env.WAVE_MOD_JAR) {
    return resolve(process.env.WAVE_MOD_JAR)
  }

  const dir = app.isPackaged ? join(process.resourcesPath, 'mod') : resolve(app.getAppPath(), '../mod/build/libs')
  const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => /^waveclient-[\w.+-]+\.jar$/.test(name) && !/-(sources|dev)\.jar$/.test(name))

  if (names.length === 0) {
    throw new Error(app.isPackaged ? 'Wave Client is missing its mod file. Please reinstall.' : `No mod jar in ${dir}. Run ./gradlew build in mod/ first.`)
  }

  const withTimes = await Promise.all(names.map(async (name) => ({ name, time: (await stat(join(dir, name))).mtimeMs })))
  withTimes.sort((a, b) => b.time - a.time)
  return join(dir, withTimes[0]!.name)
}

/** memoryMb and jvmArgs from a launcher.json written before profiles existed. */
async function readLegacySettings(file: string): Promise<LegacySettings> {
  try {
    const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    return {
      ...(typeof raw.memoryMb === 'number' ? { memoryMb: raw.memoryMb } : {}),
      ...(typeof raw.jvmArgs === 'string' ? { jvmArgs: raw.jvmArgs } : {})
    }
  } catch {
    return {}
  }
}

/** CI check: the window loads, the preload bridge exists and the API answers, then exit. */
async function runSmokeTest(): Promise<void> {
  try {
    // Also: a refused call reaches the page as a plain message (no account, so Play is refused),
    // the page can't choose what runs as Java, and its CSP blocks any request of its own.
    const result = (await mainWindow?.webContents.executeJavaScript(
      `(async () => {
        const info = await window.wave.app.info()
        const refused = await window.wave.game.launch().then(() => null, (error) => error.message)
        const settings = await window.wave.settings.set({ javaPath: '/bin/sh' })
        const profiles = await window.wave.profiles.list()
        // A File made up by script has no path on disk: nothing is copied.
        const forged = await window.wave.mods.addDropped(profiles[0].id, [new File(['x'], 'a.jar')])
        // XHR, not fetch: the wave: scheme serves XHR, so only the CSP can stop this request.
        const fetchBlocked = await new Promise((done) => {
          const request = new XMLHttpRequest()
          request.onload = () => done(false)
          request.onerror = () => done(true)
          try {
            request.open('GET', 'index.html')
            request.send()
          } catch {
            done(true)
          }
        })
        return {
          bridge: typeof window.wave,
          keys: Object.keys(window.wave).sort().join(','),
          mc: info.minecraftVersion,
          versions: info.gameVersions.map((v) => v.id).join(','),
          memory: info.memoryRangeMb.min,
          refused,
          javaPath: settings.javaPath,
          profiles: profiles.map((p) => p.id + (p.selected ? '*' : '')).join(','),
          forged: forged.added.length + ':' + forged.skipped.map((s) => s.reason).join(','),
          fetchBlocked,
          root: document.getElementById('root')?.childElementCount ?? -1
        }
      })()`
    )) as { bridge: string; keys: string; mc: string; versions: string; memory: number; refused: string | null; javaPath: string | null; profiles: string; forged: string; fetchBlocked: boolean; root: number }
    const ok =
      result.bridge === 'object' &&
      result.keys === 'accounts,app,game,logs,mods,profiles,settings' &&
      result.versions === PINS.minecraft &&
      result.profiles === 'default*' &&
      result.forged === '0:not-a-file' &&
      result.mc === PINS.minecraft &&
      result.memory === 1024 &&
      result.refused === 'Sign in with a Microsoft account first.' &&
      result.javaPath === null &&
      // The dev server's page allows its own websocket and requests.
      result.fetchBlocked === !rendererUrl &&
      result.root > 0
    log(`SMOKE ${ok ? 'OK' : 'FAILED'} ${JSON.stringify(result)}`)
    app.exit(ok ? 0 : 1)
  } catch (error) {
    log(`SMOKE FAILED ${String(error)}`)
    app.exit(1)
  }
}
