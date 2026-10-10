import type { JSX } from 'react'

import type { AccountView, AppInfo, GameState, LauncherSettings } from '@shared/ipc'

import { useClipboard } from '../../hooks/useClipboard'
import { formatMemory } from '../../lib/format'
import { crashDetailsText, exitNote, playButtonModel } from '../../lib/play'
import { phaseAnnouncement } from '../../lib/progress'
import { AFTER_LAUNCH_OPTIONS } from '../../lib/settings'
import { Avatar } from '../ui/Avatar'
import { Button } from '../ui/Button'
import { Icon, type IconName } from '../ui/Icon'
import { CrashCard } from './CrashCard'
import { FailedCard } from './FailedCard'
import { GameProgress } from './GameProgress'
import { RunningCard } from './RunningCard'

interface PlayViewProps {
  info: AppInfo
  account: AccountView | null
  game: GameState
  launching: boolean
  settings: LauncherSettings
  settingsLoaded: boolean
  onLaunch: (options?: { repair?: boolean }) => void
  onSignInAgain: () => void
  onCancel: () => void
  onKill: () => void
  onShowLogs: () => void
  onShowSettings: () => void
  report: (error: unknown) => void
}

export function PlayView(props: PlayViewProps): JSX.Element {
  const {
    info,
    account,
    game,
    launching,
    settings,
    settingsLoaded,
    onLaunch,
    onSignInAgain,
    onCancel,
    onKill,
    onShowLogs,
    onShowSettings,
    report
  } = props
  const [copied, copy] = useClipboard(report)
  const button = playButtonModel(game.phase, account, launching)
  const note = exitNote(game)
  const hint = button.hint ?? note?.text ?? null

  return (
    <div className="view view--scroll play">
      <section className="card hero" aria-labelledby="hero-title">
        <div className="hero__text">
          <p className="hero__eyebrow">Java Edition</p>
          <h1 id="hero-title" className="hero__title">
            Minecraft {info.minecraftVersion}
          </h1>
          <p className="hero__subtitle">Fabric · Wave Client {info.version}</p>
        </div>
        <HeroWaves />
        <div className="hero__footer">
          {account ? (
            <div className="hero__account">
              <Avatar name={account.name} size={40} muted={account.status === 'expired'} />
              <div>
                <p className="hero__account-name">{account.name}</p>
                <p className={`hero__account-status${account.status === 'expired' ? ' hero__account-status--warn' : ''}`}>
                  {account.status === 'expired' ? 'Sign-in expired' : 'Signed in with Microsoft'}
                </p>
              </div>
            </div>
          ) : (
            <div className="hero__account">
              <span className="avatar avatar--empty" style={{ width: 40, height: 40 }} aria-hidden="true" />
              <div>
                <p className="hero__account-name">No account selected</p>
                <p className="hero__account-status">Choose one at the bottom left.</p>
              </div>
            </div>
          )}
          <div className="hero__play">
            <Button
              variant="primary"
              size="lg"
              className="play-button"
              icon={button.action === 'play' && !button.disabled ? 'play' : undefined}
              disabled={button.disabled}
              aria-describedby={hint ? 'play-hint' : undefined}
              onClick={() => (button.action === 'sign-in' ? onSignInAgain() : onLaunch())}
            >
              {button.label}
            </Button>
            {hint && (
              <p id="play-hint" className="hero__hint">
                {!button.hint && note?.normal && <Icon name="check" size={14} />}
                {hint}
              </p>
            )}
          </div>
        </div>
      </section>

      <p className="visually-hidden" role="status">
        {phaseAnnouncement(game, launching)}
      </p>

      <div className="play__status">
        {(game.phase === 'preparing' || game.phase === 'downloading' || game.phase === 'starting') && <GameProgress game={game} onCancel={onCancel} />}
        {launching && game.phase === 'idle' && <GameProgress game={{ phase: 'preparing' }} onCancel={onCancel} />}
        {game.phase === 'running' && <RunningCard onKill={onKill} onShowLogs={onShowLogs} />}
      </div>

      {game.phase === 'crashed' && (
        <CrashCard
          crash={game.crash}
          exitCode={game.exitCode}
          playDisabled={button.disabled || button.action !== 'play'}
          onPlayAgain={() => onLaunch()}
          onShowLogs={onShowLogs}
          onOpenFile={(kind) => void window.wave.game.openCrashFile(kind).catch(report)}
          onCopyDetails={() => game.crash && copy(crashDetailsText(game.crash, info.minecraftVersion, info.version))}
          copied={copied}
        />
      )}

      {game.phase === 'failed' && (
        <FailedCard
          error={game.error}
          disabled={button.disabled || button.action !== 'play'}
          onTryAgain={() => onLaunch()}
          onRepair={() => onLaunch({ repair: true })}
          onShowLogs={onShowLogs}
        />
      )}

      {settingsLoaded && <LaunchSummary settings={settings} onEdit={onShowSettings} />}
    </div>
  )
}

/** The settings the next launch will use, at a glance. */
function LaunchSummary({ settings, onEdit }: { settings: LauncherSettings; onEdit: () => void }): JSX.Element {
  const afterLaunch = AFTER_LAUNCH_OPTIONS.find((option) => option.value === settings.afterLaunch)?.label ?? 'Keep the launcher open'
  const facts: Array<{ icon: IconName; label: string; value: string }> = [
    { icon: 'memory', label: 'Memory', value: formatMemory(settings.memoryMb) },
    { icon: 'coffee', label: 'Java', value: settings.javaPath ? 'Custom' : 'Bundled' },
    { icon: 'monitor', label: 'Window', value: settings.fullscreen ? 'Fullscreen' : `${settings.width} × ${settings.height}` },
    { icon: 'rocket', label: 'After launching', value: afterLaunch.replace(' the launcher', '') }
  ]

  return (
    <section className="summary" aria-labelledby="summary-title">
      <div className="summary__head">
        <h2 id="summary-title" className="section-title">
          Launch settings
        </h2>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          Change settings
        </Button>
      </div>
      <dl className="summary__grid">
        {facts.map((fact) => (
          <div key={fact.label} className="summary__item">
            <dt>
              <Icon name={fact.icon} size={14} />
              {fact.label}
            </dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** Flat wave lines across the hero card; they stretch to whatever room the card has. */
function HeroWaves(): JSX.Element {
  const waves = [0, 1, 2, 3, 4, 5, 6]

  return (
    <div className="hero__band" aria-hidden="true">
      <svg viewBox="0 0 480 120" preserveAspectRatio="none" focusable="false">
        {waves.map((i) => {
          const y = 18 + i * 14
          const lift = 14 - i
          return (
            <path
              key={i}
              d={`M0 ${y} C 60 ${y - lift}, 100 ${y - lift}, 160 ${y} S 260 ${y + lift}, 320 ${y} S 420 ${y - lift}, 480 ${y}`}
              fill="none"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              className={`hero__wave hero__wave--${i}`}
            />
          )
        })}
      </svg>
    </div>
  )
}
