import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'

import { IpcChannels, type AccountView, type AddModsResult, type AppInfo, type FolderKind, type JavaStatus, type LauncherSettings, type SignInEvent, type SignInMethod } from '@shared/ipc'

import type { AccountStore } from './accounts/store'
import { AuthError } from './auth/errors'
import type { AuthService } from './auth/service'
import { isAllowedExternalUrl } from './config'
import { logText, type GameController } from './controller'
import { probeJava } from './game/java'
import { PINS } from './game/pins'
import type { ModsService } from './mods/service'
import type { LauncherPaths } from './paths'
import type { ProfileActions } from './profile-actions'
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
  profiles: ProfileActions
  mods: ModsService
  /** Sends the profile list to the window (mod counts and running state change it too). */
  emitProfiles: () => void
  log: (message: string) => void
}

const ACCOUNT_ID = /^[0-9a-f]{32}$/
const FOLDERS: FolderKind[] = ['game', 'mods', 'logs', 'crash-reports', 'screenshots', 'launcher']
/** At most this many files per add. */
const MAX_ADD = 500

/**
 * Registers every handler. Calls from anything but the launcher's own page are refused. Returns
 * emitAccounts, which sends the account list to the window (the store calls it on every change).
 */
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

  handle(IpcChannels.openFolder, async (kind: unknown, profileId: unknown) => {
    if (!FOLDERS.includes(kind as FolderKind)) {
      throw new Error('Unknown folder')
    }

    const folder = kind === 'launcher' ? deps.paths.root : folderPath(deps.profiles.gameDir(profileId), kind as Exclude<FolderKind, 'launcher'>)
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
    // A newer sign-in replaces this one; this one's late events would confuse the window.
    const emit = (event: SignInEvent): void => {
      if (signIn === controller) {
        send(IpcChannels.eventSignIn, event)
      }
    }

    try {
      const account = await deps.auth.signIn(method as SignInMethod, emit, controller.signal)
      const view = deps.accounts.list().find((a) => a.id === account.id)

      if (view) {
        emit({ kind: 'done', account: view })
      }
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
  })

  handle(IpcChannels.accountsSelect, async (id: unknown) => {
    if (typeof id !== 'string' || !ACCOUNT_ID.test(id)) {
      throw new Error('Unknown account')
    }

    await deps.accounts.select(id)
  })

  handle(IpcChannels.settingsGet, () => deps.settings.get())

  // One change at a time, so a second call (say, a blur right after Enter) sees what the first
  // saved and doesn't ask about the same JVM options again.
  let settingsQueue: Promise<unknown> = Promise.resolve()

  handle(IpcChannels.settingsSet, (changes: unknown) => {
    const run = settingsQueue.then(
      () => applySettings(changes),
      () => applySettings(changes)
    )
    settingsQueue = run.catch(() => {})
    return run
  })

  const applySettings = async (changes: unknown): Promise<LauncherSettings> => {
    const patch: Record<string, unknown> = typeof changes === 'object' && changes !== null ? { ...changes } : {}

    // What runs as Java comes only from the file picker below (or back to the bundled Java).
    if ('javaPath' in patch && patch.javaPath !== null) {
      delete patch.javaPath
    }

    return deps.settings.set(patch)
  }

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

    await deps.settings.set({ javaPath: path })
    return { path, version: java.version }
  })

  handle(IpcChannels.settingsJavaInfo, async (): Promise<JavaStatus | null> => {
    const path = deps.settings.get().javaPath

    if (!path) {
      return null
    }

    try {
      const java = await probeJava(path)
      return { path, version: java.version, problem: java.major < 21 ? `This is Java ${java.version}. Minecraft ${PINS.minecraft} needs Java 21 or newer.` : null }
    } catch {
      return { path, version: null, problem: "This Java can't be run anymore. Choose another one or use the bundled Java." }
    }
  })

  handle(IpcChannels.gameLaunch, (options: unknown) => {
    const object = typeof options === 'object' && options !== null ? (options as { repair?: unknown; ignoreModProblems?: unknown }) : {}
    // Progress and errors arrive as state events; the call returns once it has finished or failed.
    return deps.game.launch({ repair: object.repair === true, ignoreModProblems: object.ignoreModProblems === true })
  })

  handle(IpcChannels.gameCancel, () => deps.game.cancel())
  handle(IpcChannels.gameKill, () => deps.game.kill())
  handle(IpcChannels.gameState, () => deps.game.getState())
  handle(IpcChannels.logsSnapshot, () => deps.game.snapshot())

  handle(IpcChannels.gameOpenCrashFile, async (kind: unknown) => {
    if (kind !== 'report' && kind !== 'jvm-error') {
      throw new Error('Unknown file')
    }

    // Only the paths of the crash being shown, inside the game folder of the profile that crashed.
    const file = deps.game.crashFile(kind)

    if (!file) {
      throw new Error("That file isn't available.")
    }

    const problem = await shell.openPath(file)

    if (problem) {
      throw new Error(problem)
    }
  })

  handle(IpcChannels.logsExport, async () => {
    const window = deps.window()
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
    const options = { title: 'Export log', defaultPath: `wave-client-log-${stamp}.txt`, filters: [{ name: 'Text', extensions: ['txt'] }] }
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)

    if (result.canceled || !result.filePath) {
      return null
    }

    await writeFile(result.filePath, logText(deps.game.snapshot()))
    return result.filePath
  })

  handle(IpcChannels.profilesList, () => deps.profiles.views())
  handle(IpcChannels.profilesCreate, (options: unknown) => deps.profiles.create(options))
  handle(IpcChannels.profilesUpdate, (id: unknown, patch: unknown) => deps.profiles.update(id, patch))
  handle(IpcChannels.profilesRemove, (id: unknown, options: unknown) => deps.profiles.remove(id, options))
  handle(IpcChannels.profilesSelect, (id: unknown) => deps.profiles.select(id))

  // Mod changes alter the profile list's mod counts.
  const changed = <T>(result: T): T => {
    deps.emitProfiles()
    return result
  }

  handle(IpcChannels.modsList, (profileId: unknown) => deps.mods.report(profileIdOf(profileId)))

  handle(IpcChannels.modsAdd, async (profileId: unknown): Promise<AddModsResult> => {
    const id = profileIdOf(profileId)
    const window = deps.window()
    const options = {
      title: 'Add mods',
      buttonLabel: 'Add',
      properties: ['openFile' as const, 'multiSelections' as const, 'dontAddToRecent' as const],
      filters: [{ name: 'Fabric mods', extensions: ['jar'] }]
    }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)

    if (result.canceled || result.filePaths.length === 0) {
      return { added: [], skipped: [], report: await deps.mods.report(id) }
    }

    return changed(await deps.mods.add(id, result.filePaths.slice(0, MAX_ADD)))
  })

  handle(IpcChannels.modsAddDropped, async (profileId: unknown, paths: unknown) => {
    // The preload resolved these from File objects the player dropped; each is checked again in add().
    const list = Array.isArray(paths) ? paths.slice(0, MAX_ADD) : []
    return changed(await deps.mods.add(profileIdOf(profileId), list))
  })

  handle(IpcChannels.modsSetEnabled, async (profileId: unknown, key: unknown, enabled: unknown) => {
    if (typeof enabled !== 'boolean') {
      throw new Error('Unknown mod')
    }

    return changed(await deps.mods.setEnabled(profileIdOf(profileId), key, enabled))
  })

  handle(IpcChannels.modsRemove, async (profileId: unknown, key: unknown) => changed(await deps.mods.remove(profileIdOf(profileId), key)))
  handle(IpcChannels.modsIcon, (profileId: unknown, key: unknown) => deps.mods.icon(profileIdOf(profileId), key))

  return { emitAccounts }

  function profileIdOf(value: unknown): string {
    // Resolves to the stored id (or throws), so nothing else from the page reaches the file system.
    return basename(deps.profiles.gameDir(value))
  }
}

/** A native dialog, which script in the page can't answer. */
export async function confirmRiskyJvmArgs(window: BrowserWindow | null, profileName: string, args: string[]): Promise<boolean> {
  const options = {
    type: 'warning' as const,
    buttons: ['Cancel', 'Save anyway'],
    defaultId: 0,
    cancelId: 0,
    message: `These JVM arguments for ${profileName} can run other programs or code on your computer`,
    detail: `${args.join('\n')}\n\nOnly save them if you added them yourself and trust where they came from.`
  }
  const { response } = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
  return response === 1
}

/** Asks before deleting a profile's folder outright (native, like above). */
export async function confirmDeleteProfile(window: BrowserWindow | null, profileName: string, contents: { worlds: number; bytes: number }): Promise<boolean> {
  const worlds = contents.worlds === 0 ? 'no worlds' : contents.worlds === 1 ? '1 world' : `${contents.worlds} worlds`
  const options = {
    type: 'warning' as const,
    buttons: ['Cancel', 'Delete permanently'],
    defaultId: 0,
    cancelId: 0,
    message: `Delete ${profileName} permanently?`,
    detail: `Its folder (${worlds}, ${formatBytes(contents.bytes)}) will be deleted, not moved to the ${process.platform === 'win32' ? 'Recycle Bin' : 'Trash'}. This can't be undone.`
  }
  const { response } = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
  return response === 1
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
  }

  return bytes < 1024 ** 3 ? `${Math.round(bytes / 1024 ** 2)} MB` : `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

function fromTrustedPage(event: IpcMainInvokeEvent, deps: IpcDeps): boolean {
  const window = deps.window()
  const frame = event.senderFrame
  return window !== null && event.sender === window.webContents && frame !== null && frame === window.webContents.mainFrame && deps.isTrustedUrl(frame.url)
}

/** A folder of a profile's game folder ('game' is the folder itself). */
export function folderPath(gameDir: string, kind: Exclude<FolderKind, 'launcher'>): string {
  return kind === 'game' ? gameDir : join(gameDir, kind)
}
