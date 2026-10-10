import { appendFile, mkdir, readdir, stat } from 'node:fs/promises'
import { totalmem, release } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { BrowserWindow, Menu, app, net, session, shell } from 'electron'

import { IpcChannels, type AfterLaunch, type AppInfo } from '@shared/ipc'

import { AccountStore } from './accounts/store'
import { AuthService } from './auth/service'
import { LAUNCHER_NAME, msaClientId } from './config'
import { GameController } from './controller'
import { electronSecretBox } from './electron/secret-box'
import { PINS } from './game/pins'
import { loadClientId } from './install-id'
import { registerIpc } from './ipc'
import { DownloadQueue } from './net/downloads'
import { HttpClient } from './net/http'
import { launcherPaths } from './paths'
import { SettingsStore, memoryRangeMb } from './settings'

const root = process.env.WAVE_LAUNCHER_HOME ? resolve(process.env.WAVE_LAUNCHER_HOME) : join(app.getPath('appData'), 'WaveClient')
const paths = launcherPaths(root)
const rendererUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
const rendererFile = join(import.meta.dirname, '../renderer/index.html')
const smokeTest = process.env.WAVE_SMOKE_TEST === '1'

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

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }

      mainWindow.show()
      mainWindow.focus()
    }
  })

  hardenWebContents()
  app.whenReady().then(start).catch((error: unknown) => {
    log(`Startup failed: ${String(error)}`)
    app.exit(1)
  })
}

async function start(): Promise<void> {
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
  const settings = new SettingsStore(paths.settingsFile, totalMemoryMb)
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
    platform: process.platform
  }

  const send = (channel: string, payload: unknown): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload)
    }
  }

  const game = new GameController({
    context: { http, queue, paths, platform: process.platform, arch: process.arch, osVersion: release() },
    auth,
    accounts,
    settings,
    bundledModJar: findBundledModJar,
    clientId: () => loadClientId(join(root, 'install-id')),
    launcherName: LAUNCHER_NAME,
    launcherVersion: app.getVersion(),
    emitState: (state) => send(IpcChannels.eventGame, state),
    emitLines: batchLines((lines) => send(IpcChannels.eventLog, lines)),
    window: { afterLaunch, afterExit },
    log
  })

  registerIpc({
    window: () => mainWindow,
    isTrustedUrl,
    info: () => ({ ...info, secureStorage: accounts.persistent }),
    paths,
    accounts,
    auth,
    settings,
    game,
    log
  })

  log(`Wave Client ${app.getVersion()} starting; data in ${root}; sign-in ${clientId ? 'configured' : 'not configured'}; secure storage ${accounts.persistent ? 'on' : 'off'}`)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

  app.on('window-all-closed', () => {
    // Keep running while the game does, so its output and crash report aren't lost.
    if (!game.running) {
      app.quit()
    }
  })
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

  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl)
  } else {
    void mainWindow.loadFile(rendererFile)
  }
}

/** The renderer's own page, and nothing else, may use the API and be navigated to. */
function isTrustedUrl(url: string): boolean {
  if (rendererUrl) {
    return url.startsWith(`${rendererUrl}/`) || url === rendererUrl
  }

  return url.split('#')[0] === pathToFileURL(rendererFile).href
}

function hardenWebContents(): void {
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

/** CI check: the window loads, the preload bridge exists and the API answers, then exit. */
async function runSmokeTest(): Promise<void> {
  try {
    const result = (await mainWindow?.webContents.executeJavaScript(
      `(async () => { const info = await window.wave.app.info(); return { bridge: typeof window.wave, keys: Object.keys(window.wave).sort().join(','), mc: info.minecraftVersion, root: document.getElementById('root')?.childElementCount ?? -1 } })()`
    )) as { bridge: string; keys: string; mc: string; root: number }
    const ok = result.bridge === 'object' && result.keys === 'accounts,app,game,logs,settings' && result.mc === PINS.minecraft && result.root > 0
    log(`SMOKE ${ok ? 'OK' : 'FAILED'} ${JSON.stringify(result)}`)
    app.exit(ok ? 0 : 1)
  } catch (error) {
    log(`SMOKE FAILED ${String(error)}`)
    app.exit(1)
  }
}
