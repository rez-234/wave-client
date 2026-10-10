import { useCallback, useEffect, useState, type JSX } from 'react'

import type { AccountView, FolderKind } from '@shared/ipc'

import { ErrorBoundary } from './components/ErrorBoundary'
import { LoadingScreen } from './components/LoadingScreen'
import { LogsView } from './components/logs/LogsView'
import { PlayView } from './components/play/PlayView'
import { SettingsView } from './components/settings/SettingsView'
import { Sidebar, type View } from './components/Sidebar'
import { SignInPanel } from './components/sign-in/SignInPanel'
import { Alert } from './components/ui/Alert'
import { useAlerts } from './hooks/useAlerts'
import { useClipboard } from './hooks/useClipboard'
import { useLauncherData } from './hooks/useLauncherData'
import { useSignIn } from './hooks/useSignIn'
import { describeProgress, isBusy } from './lib/progress'

export function App(): JSX.Element {
  const { alerts, report, dismiss } = useAlerts()
  const data = useLauncherData(report)
  const signIn = useSignIn(report)
  const [view, setView] = useState<View>('play')
  const [signInOpen, setSignInOpen] = useState(false)
  /** The expired account being signed in again, for the panel's heading. */
  const [reauthName, setReauthName] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)
  const [codeCopied, copyCode] = useClipboard(report)

  const { accounts, game } = data
  const selected = accounts.find((account) => account.selected) ?? null
  const signedIn = accounts.length > 0
  const signInDone = signIn.state.status === 'done' ? signIn.state.account : null
  const { reset: resetSignIn, cancel: cancelSignIn } = signIn

  // Signing in finished: once the new account is in the list, go to Play.
  useEffect(() => {
    if (signInDone && accounts.some((account) => account.id === signInDone.id)) {
      setSignInOpen(false)
      setReauthName(null)
      setView('play')
      resetSignIn()
    }
  }, [signInDone, accounts, resetSignIn])

  const launch = useCallback(
    (options?: { repair?: boolean }) => {
      setLaunching(true)
      setView('play')
      window.wave.game
        .launch(options)
        .catch(report)
        .finally(() => setLaunching(false))
    },
    [report]
  )

  const openSignIn = useCallback((account?: AccountView) => {
    setReauthName(account && account.status === 'expired' ? account.name : null)
    setSignInOpen(true)
    setView('play')
  }, [])

  const closeSignIn = useCallback(() => {
    cancelSignIn()
    setSignInOpen(false)
    setReauthName(null)
  }, [cancelSignIn])

  const selectAccount = useCallback(
    (account: AccountView) => {
      if (!account.selected) {
        window.wave.accounts.select(account.id).catch(report)
      }

      if (account.status === 'expired') {
        openSignIn(account)
      }
    },
    [openSignIn, report]
  )

  const signOut = useCallback((account: AccountView) => void window.wave.accounts.signOut(account.id).catch(report), [report])
  const openFolder = useCallback((kind: FolderKind) => void window.wave.app.openFolder(kind).catch(report), [report])
  const openExternal = useCallback((url: string) => void window.wave.app.openExternal(url).catch(report), [report])

  if (!data.info || !data.accountsLoaded) {
    return <LoadingScreen error={data.infoError} onRetry={data.retry} />
  }

  const info = data.info
  const busy = launching || isBusy(game.phase)
  const showSignIn = !signedIn || signInOpen || signInDone !== null
  const percent = game.phase === 'downloading' ? describeProgress(game.task).percent : null
  const playBadge = game.phase === 'running' ? 'Playing' : percent !== null ? `${percent}%` : busy ? 'Starting' : null

  let content: JSX.Element

  if (view === 'logs') {
    content = <LogsView lines={data.logs} onExport={() => window.wave.logs.exportToFile()} onOpenFolder={() => openFolder('logs')} report={report} />
  } else if (view === 'settings') {
    content = (
      <SettingsView
        info={info}
        settings={data.settings}
        settingsLoaded={data.settingsLoaded}
        accounts={accounts}
        canRepair={!busy && selected !== null && selected.status === 'ok'}
        onApplySettings={data.applySettings}
        onRepair={() => launch({ repair: true })}
        onOpenFolder={openFolder}
        onAddAccount={() => openSignIn()}
        onSignOut={signOut}
        report={report}
      />
    )
  } else if (showSignIn) {
    content = (
      <div className="view view--scroll view--centered">
        <SignInPanel
          info={info}
          state={signIn.state}
          canClose={signedIn}
          reauthName={reauthName}
          onStart={signIn.start}
          onCancel={signIn.cancel}
          onClose={closeSignIn}
          onOpenExternal={openExternal}
          onCopy={copyCode}
          copied={codeCopied}
        />
      </div>
    )
  } else {
    content = (
      <PlayView
        info={info}
        account={selected}
        game={game}
        launching={launching}
        settings={data.settings}
        settingsLoaded={data.settingsLoaded}
        onLaunch={launch}
        onSignInAgain={() => openSignIn(selected ?? undefined)}
        onCancel={() => void window.wave.game.cancel().catch(report)}
        onKill={() => void window.wave.game.kill().catch(report)}
        onShowLogs={() => setView('logs')}
        onShowSettings={() => setView('settings')}
        onOpenFolder={openFolder}
        report={report}
      />
    )
  }

  return (
    <div className="app">
      <Sidebar
        view={view}
        onNavigate={setView}
        playBadge={playBadge}
        accounts={accounts}
        onSelectAccount={selectAccount}
        onAddAccount={() => openSignIn()}
        onSignOut={signOut}
      />
      <main className="main">
        <div className="alerts">
          {alerts.map((alert) => (
            <Alert key={alert.id} tone="danger" onDismiss={() => dismiss(alert.id)}>
              {alert.message}
            </Alert>
          ))}
        </div>
        <ErrorBoundary key={view} scope="page">
          {content}
        </ErrorBoundary>
      </main>
    </div>
  )
}
