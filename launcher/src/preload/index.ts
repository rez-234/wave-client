import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

import { IpcChannels, type WaveApi } from '@shared/ipc'

/** Subscribes to a main-process event; returns the unsubscribe function. */
function on<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => {
    ipcRenderer.removeListener(channel, wrapped)
  }
}

/** Electron prefixes errors from main-process handlers; the UI gets only the message written for players. */
const REMOTE_ERROR = /^Error invoking remote method '[^']*':\s*(?:[A-Za-z]*Error:\s*)?/

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  (ipcRenderer.invoke(channel, ...args) as Promise<T>).catch((error: unknown) => {
    throw new Error(error instanceof Error ? error.message.replace(REMOTE_ERROR, '') : 'Something went wrong.')
  })

/** The only bridge to the main process: typed calls, no raw ipcRenderer, no Node APIs. */
const api: WaveApi = {
  app: {
    info: () => invoke(IpcChannels.appInfo),
    openFolder: (kind) => invoke(IpcChannels.openFolder, kind),
    openExternal: (url) => invoke(IpcChannels.openExternal, url)
  },
  accounts: {
    list: () => invoke(IpcChannels.accountsList),
    signIn: (method) => invoke(IpcChannels.accountsSignIn, method),
    cancelSignIn: () => invoke(IpcChannels.accountsCancelSignIn),
    signOut: (id) => invoke(IpcChannels.accountsSignOut, id),
    select: (id) => invoke(IpcChannels.accountsSelect, id),
    onSignIn: (listener) => on(IpcChannels.eventSignIn, listener),
    onChange: (listener) => on(IpcChannels.eventAccounts, listener)
  },
  settings: {
    get: () => invoke(IpcChannels.settingsGet),
    set: (settings) => invoke(IpcChannels.settingsSet, settings),
    pickJava: () => invoke(IpcChannels.settingsPickJava),
    javaInfo: () => invoke(IpcChannels.settingsJavaInfo)
  },
  game: {
    launch: (options) => invoke(IpcChannels.gameLaunch, options ?? {}),
    cancel: () => invoke(IpcChannels.gameCancel),
    kill: () => invoke(IpcChannels.gameKill),
    state: () => invoke(IpcChannels.gameState),
    openCrashFile: (kind) => invoke(IpcChannels.gameOpenCrashFile, kind),
    onState: (listener) => on(IpcChannels.eventGame, listener)
  },
  logs: {
    snapshot: () => invoke(IpcChannels.logsSnapshot),
    exportToFile: () => invoke(IpcChannels.logsExport),
    onLine: (listener) => on(IpcChannels.eventLog, listener)
  }
}

contextBridge.exposeInMainWorld('wave', api)
