import { useCallback, useEffect, useState } from 'react'

import { DEFAULT_SETTINGS, type AccountView, type AppInfo, type GameState, type LauncherSettings, type LogLine } from '@shared/ipc'

import { errorMessage } from '../lib/errors'
import { mergeLogLines } from '../lib/logs'

export interface LauncherData {
  info: AppInfo | null
  /** Why the app info couldn't be loaded, so the window can offer to retry. */
  infoError: string | null
  accounts: AccountView[]
  accountsLoaded: boolean
  settings: LauncherSettings
  settingsLoaded: boolean
  game: GameState
  logs: LogLine[]
}

export interface LauncherDataApi extends LauncherData {
  retry: () => void
  /** Replaces the settings with the ones the main process returned (they are authoritative). */
  applySettings: (settings: LauncherSettings) => void
}

/** Whether the preload bridge exists (it doesn't when the page is opened outside the launcher). */
function bridgeAvailable(): boolean {
  return typeof window !== 'undefined' && 'wave' in window && typeof window.wave === 'object' && window.wave !== null
}

/**
 * Everything the window shows from the main process: loads it once and keeps it current through
 * the main process's events. Events that arrive before a first load finishes win over its result.
 */
export function useLauncherData(report: (error: unknown) => void): LauncherDataApi {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<AccountView[]>([])
  const [accountsLoaded, setAccountsLoaded] = useState(false)
  const [settings, setSettings] = useState<LauncherSettings>(DEFAULT_SETTINGS)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [game, setGame] = useState<GameState>({ phase: 'idle' })
  const [logs, setLogs] = useState<LogLine[]>([])
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!bridgeAvailable()) {
      setInfoError("The launcher's connection to Wave Client isn't available. Please restart the launcher.")
      return
    }

    const wave = window.wave
    let active = true
    let accountsEvent = false
    let gameEvent = false

    const unsubscribe = [
      wave.accounts.onChange((list) => {
        accountsEvent = true
        setAccounts(Array.isArray(list) ? list : [])
        setAccountsLoaded(true)
      }),
      wave.game.onState((state) => {
        gameEvent = true
        setGame(state)
      }),
      wave.logs.onLine((lines) => {
        if (Array.isArray(lines)) {
          setLogs((current) => mergeLogLines(current, lines))
        }
      })
    ]

    setInfoError(null)

    wave.app
      .info()
      .then((value) => active && setInfo(value))
      .catch((error: unknown) => active && setInfoError(errorMessage(error, "Couldn't start the launcher window.")))

    wave.accounts
      .list()
      .then((list) => {
        if (active && !accountsEvent) {
          setAccounts(Array.isArray(list) ? list : [])
        }
      })
      .catch((error: unknown) => active && report(error))
      .finally(() => active && setAccountsLoaded(true))

    wave.settings
      .get()
      .then((value) => {
        if (active) {
          setSettings(value)
          setSettingsLoaded(true)
        }
      })
      .catch((error: unknown) => active && report(error))

    wave.game
      .state()
      .then((state) => active && !gameEvent && setGame(state))
      .catch((error: unknown) => active && report(error))

    wave.logs
      .snapshot()
      .then((lines) => active && Array.isArray(lines) && setLogs((current) => mergeLogLines(current, lines)))
      .catch((error: unknown) => active && report(error))

    return () => {
      active = false
      unsubscribe.forEach((stop) => stop())
    }
  }, [attempt, report])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  const applySettings = useCallback((value: LauncherSettings) => {
    setSettings(value)
    setSettingsLoaded(true)
  }, [])

  return { info, infoError, accounts, accountsLoaded, settings, settingsLoaded, game, logs, retry, applySettings }
}
