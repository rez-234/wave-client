import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'

import { IpcChannels, type AccountView, type AppInfo, type FolderKind, type SignInEvent, type SignInMethod } from '@shared/ipc'

import type { AccountStore } from './accounts/store'
import { AuthError } from './auth/errors'
import type { AuthService } from './auth/service'
import { isAllowedExternalUrl } from './config'
import type { GameController } from './controller'
import { probeJava } from './game/java'
import { PINS } from './game/pins'
import { instanceDir, type LauncherPaths } from './paths'
import type { SettingsStore } from './settings'

export interface IpcDeps {
  window: () => BrowserWindow | null
  /** The page the window is allowed to load (dev server URL or file:// index). */
  isTrustedUrl: (url: string) => boolean
  info: () => AppInfo
  paths: LauncherPaths
  accounts: AccountStore
  auth: AuthService
  settings: SettingsStore
  game: GameController
  log: (message: string) => void
}

const ACCOUNT_ID = /^[0-9a-f]{32}$/
const FOLDERS: FolderKind[] = ['game', 'mods', 'logs', 'crash-reports', 'screenshots', 'launcher']

/** Registers every handler. Calls from anything but the launcher's own page are refused. */
export function registerIpc(deps: IpcDeps): { emitAccounts: () => void } {
  let signIn: AbortController | null = null

  const send = (channel: string, payload: unknown): void => {
    const window = deps.window()

    if (window && !window.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }

  const emitAccounts = (): void => send(IpcChannels.eventAccounts, deps.accounts.list())

  const handle = <A extends unknown[], R>(channel: string, handler: (...args: A) => R | Promise<R>): void => {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!fromTrustedPage(event, deps)) {
        throw new Error('Refused')
      }

      try {
        return await handler(...(args as A))
      } catch (error) {
        // Only a plain message crosses to the UI; details stay in the main process log.
        deps.log(`${channel} failed: ${error instanceof AuthError && error.detail ? `${error.message} (${error.detail})` : String(error)}`)
        throw new Error(error instanceof Error ? error.message : 'Something went wrong.')
      }
    })
  }

  handle(IpcChannels.appInfo, () => deps.info())

  handle(IpcChannels.openFolder, async (kind: unknown) => {
    if (!FOLDERS.includes(kind as FolderKind)) {
      throw new Error('Unknown folder')
    }

    const folder = folderPath(deps.paths, kind as FolderKind)
    await mkdir(folder, { recursive: true })
    const problem = await shell.openPath(folder)

    if (problem) {
      throw new Error(problem)
    }
  })

  handle(IpcChannels.openExternal, async (url: unknown) => {
    if (!isAllowedExternalUrl(url)) {
      throw new Error("That link can't be opened.")
    }

    await shell.openExternal(url)
  })

  handle(IpcChannels.accountsList, (): AccountView[] => deps.accounts.list())

  handle(IpcChannels.accountsSignIn, async (method: unknown) => {
    if (method !== 'browser' && method !== 'device-code') {
      throw new Error('Unknown sign-in method')
    }

    signIn?.abort()
    const controller = new AbortController()
    signIn = controller
    const emit = (event: SignInEvent): void => send(IpcChannels.eventSignIn, event)

    try {
      const account = await deps.auth.signIn(method as SignInMethod, emit, controller.signal)
      const view = deps.accounts.list().find((a) => a.id === account.id)

      if (view) {
        emit({ kind: 'done', account: view })
      }

      emitAccounts()
    } catch (error) {
      if (error instanceof AuthError && error.code === 'cancelled') {
        emit({ kind: 'cancelled' })
      } else if (error instanceof AuthError) {
        deps.log(`Sign-in failed: ${error.code}${error.detail ? ` (${error.detail})` : ''}`)
        emit({ kind: 'error', message: error.message, ...(error.detail ? { detail: error.detail } : {}), ...(error.helpUrl ? { helpUrl: error.helpUrl } : {}) })
      } else {
        deps.log(`Sign-in failed: ${String(error)}`)
        emit({ kind: 'error', message: 'Sign-in failed. Please try again.', detail: error instanceof Error ? error.message : undefined })
      }
    } finally {
      if (signIn === controller) {
        signIn = null
      }
    }
  })

  handle(IpcChannels.accountsCancelSignIn, () => {
    signIn?.abort()
  })

  handle(IpcChannels.accountsSignOut, async (id: unknown) => {
    if (typeof id !== 'string' || !ACCOUNT_ID.test(id)) {
      throw new Error('Unknown account')
    }

    if (deps.game.running && deps.accounts.selected()?.id === id) {
      throw new Error("You can't sign out while Minecraft is running with this account.")
    }

    await deps.accounts.remove(id)
    emitAccounts()
  })

  handle(IpcChannels.accountsSelect, async (id: unknown) => {
    if (typeof id !== 'string' || !ACCOUNT_ID.test(id)) {
      throw new Error('Unknown account')
    }

    await deps.accounts.select(id)
    emitAccounts()
  })

  handle(IpcChannels.settingsGet, () => deps.settings.get())
  handle(IpcChannels.settingsSet, (patch: unknown) => deps.settings.set(patch))

  handle(IpcChannels.settingsPickJava, async () => {
    const window = deps.window()
    const options = {
      title: 'Choose a Java executable',
      properties: ['openFile' as const, 'dontAddToRecent' as const],
      ...(process.platform === 'win32' ? { filters: [{ name: 'Java', extensions: ['exe'] }] } : {})
    }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    const path = result.filePaths[0]

    if (result.canceled || !path) {
      return null
    }

    const java = await probeJava(path)

    if (java.major < 21) {
      throw new Error(`That's Java ${java.version}. Minecraft ${PINS.minecraft} needs Java 21 or newer.`)
    }

    return { path, version: java.version }
  })

  handle(IpcChannels.gameLaunch, (options: unknown) => {
    const repair = typeof options === 'object' && options !== null && (options as { repair?: unknown }).repair === true
    // Progress and errors arrive as state events; the call returns once it has finished or failed.
    return deps.game.launch({ repair })
  })

  handle(IpcChannels.gameCancel, () => deps.game.cancel())
  handle(IpcChannels.gameKill, () => deps.game.kill())
  handle(IpcChannels.gameState, () => deps.game.getState())
  handle(IpcChannels.logsSnapshot, () => deps.game.snapshot())

  handle(IpcChannels.logsExport, async () => {
    const window = deps.window()
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
    const options = { title: 'Export log', defaultPath: `wave-client-log-${stamp}.txt`, filters: [{ name: 'Text', extensions: ['txt'] }] }
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)

    if (result.canceled || !result.filePath) {
      return null
    }

    const text = deps.game
      .snapshot()
      .map((line) => `[${new Date(line.time).toISOString()}] [${line.thread ?? 'output'}/${line.level}] ${line.message}${line.throwable ? `\n${line.throwable}` : ''}`)
      .join('\n')
    await writeFile(result.filePath, `${text}\n`)
    return result.filePath
  })

  return { emitAccounts }
}

function fromTrustedPage(event: IpcMainInvokeEvent, deps: IpcDeps): boolean {
  const window = deps.window()
  const frame = event.senderFrame
  return window !== null && event.sender === window.webContents && frame !== null && frame === window.webContents.mainFrame && deps.isTrustedUrl(frame.url)
}

export function folderPath(paths: LauncherPaths, kind: FolderKind): string {
  const game = instanceDir(paths, 'default')

  switch (kind) {
    case 'game':
      return game
    case 'launcher':
      return paths.root
    default:
      return join(game, kind)
  }
}
