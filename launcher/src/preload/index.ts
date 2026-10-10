import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'

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

function pathOfDroppedFile(file: unknown): string {
  try {
    return webUtils.getPathForFile(file as File)
  } catch {
    return ''
  }
}

/** The only bridge to the main process: typed calls, no raw ipcRenderer, no Node APIs. */
const api: WaveApi = {
  app: {
    info: () => invoke(IpcChannels.appInfo),
    openFolder: (kind, profileId) => invoke(IpcChannels.openFolder, kind, profileId),
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
  profiles: {
    list: () => invoke(IpcChannels.profilesList),
    create: (options) => invoke(IpcChannels.profilesCreate, options),
    update: (id, patch) => invoke(IpcChannels.profilesUpdate, id, patch),
    remove: (id, options) => invoke(IpcChannels.profilesRemove, id, options ?? {}),
    select: (id) => invoke(IpcChannels.profilesSelect, id),
    onChange: (listener) => on(IpcChannels.eventProfiles, listener)
  },
  mods: {
    list: (profileId) => invoke(IpcChannels.modsList, profileId),
    add: (profileId) => invoke(IpcChannels.modsAdd, profileId),
    // Paths come only from files the player dropped (a File made by script has none) and are
    // never handed to the page.
    addDropped: (profileId, files) => invoke(IpcChannels.modsAddDropped, profileId, Array.from(files ?? [], pathOfDroppedFile)),
    setEnabled: (profileId, key, enabled) => invoke(IpcChannels.modsSetEnabled, profileId, key, enabled),
    remove: (profileId, key) => invoke(IpcChannels.modsRemove, profileId, key),
    icon: (profileId, key) => invoke(IpcChannels.modsIcon, profileId, key)
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
