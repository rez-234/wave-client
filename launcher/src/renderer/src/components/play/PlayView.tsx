import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'

import type { AccountView, AppInfo, GameState, LauncherSettings, ModView, ProfileView } from '@shared/ipc'

import { useClipboard } from '../../hooks/useClipboard'
import { useModsReport } from '../../hooks/useModsReport'
import { formatMemory, plural } from '../../lib/format'
import { blockingSummary, turnOffModsWithErrors, type ToastContent } from '../../lib/mods'
import { crashDetailsText, crashTitle, exitNote, failedTitle, matchSuspects, playAgainLabel, playButtonModel } from '../../lib/play'
import { profileDetail, versionLabel } from '../../lib/profiles'
import { isBusy, phaseAnnouncement } from '../../lib/progress'
import { AFTER_LAUNCH_OPTIONS } from '../../lib/settings'
import { Avatar } from '../ui/Avatar'
import { Button } from '../ui/Button'
import { Icon, type IconName } from '../ui/Icon'
import { CrashCard } from './CrashCard'
import { FailedCard } from './FailedCard'
import { GameProgress } from './GameProgress'
import { ModProblemsCard } from './ModProblemsCard'
import { ProfilePicker } from './ProfilePicker'
import { RunningCard } from './RunningCard'

export interface LaunchOptions {
  repair?: boolean
  ignoreModProblems?: boolean
}

interface PlayViewProps {
  info: AppInfo
  account: AccountView | null
  game: GameState
  launching: boolean
  settings: LauncherSettings
  settingsLoaded: boolean
  profiles: ProfileView[]
  profile: ProfileView | null
  onLaunch: (options?: LaunchOptions) => void
  onSignInAgain: () => void
  onCancel: () => void
  onKill: () => void
  onShowLogs: () => void
  onShowSettings: () => void
  /** Opens a profile's Mods tab, filtered to mods with problems. */
  onReviewMods: (profileId: string) => void
  onShowProfiles: () => void
  onShowProfileSettings: (profileId: string) => void
  onToast: (toast: ToastContent) => void
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
    profiles,
    profile,
    onLaunch,
    onSignInAgain,
    onCancel,
    onKill,
    onShowLogs,
    onShowSettings,
    onReviewMods,
    onShowProfiles,
    onShowProfileSettings,
    onToast,
    report
  } = props
  const [copied, copy] = useClipboard(report)
  const button = playButtonModel(game.phase, account, launching)
  const note = exitNote(game)
  const hint = button.hint ?? note?.text ?? null
  const busy = launching || isBusy(game.phase)
  const selectedId = profile?.id ?? null
  /** The selected profile's mods, for the heads-up card; read again whenever a launch starts or ends. */
  const selectedMods = useModsReport(selectedId, false)
  /** The crashed profile's mods, for the suspects' switches. */
  const crashedId = game.phase === 'crashed' ? (game.profile?.id ?? selectedId) : null
  const crashedMods = useModsReport(crashedId, false)
  const [fixing, setFixing] = useState(false)
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(new Set())
  const { reload: reloadSelected } = selectedMods

  useEffect(() => {
    reloadSelected()
  }, [game.phase, profile?.modCount, reloadSelected])

  const blocked = game.phase === 'failed' && game.modProblems && game.modProblems.profileId === selectedId ? game.modProblems : null
  const heads = selectedMods.report && !busy && !blocked && game.phase !== 'crashed' ? blockingSummary(selectedMods.report) : null
  const suspects = useMemo(() => matchSuspects(game.crash?.suspectedMods ?? [], crashedMods.report?.mods ?? null), [game.crash, crashedMods.report])
  const playDisabled = button.disabled || button.action !== 'play'

  const toggleSuspect = useCallback(
    (mod: ModView, enabled: boolean) => {
      const id = crashedId

      if (!id) {
        return
      }

      setPendingKeys((current) => new Set(current).add(mod.key))
      crashedMods
        .change(
          () => window.wave.mods.setEnabled(id, mod.key, enabled),
          (next) => next
        )
        .catch(report)
        .finally(() =>
          setPendingKeys((current) => {
            const next = new Set(current)
            next.delete(mod.key)
            return next
          })
        )
    },
    [crashedId, crashedMods, report]
  )

  /** "Turn them off and play": every turned-on mod with an error goes off (and what breaks because of that), then Play. */
  const turnOffAndPlay = (): void => {
    if (!profile) {
      return
    }

    const id = profile.id
    const name = profile.name
    setFixing(true)
    selectedMods
      .change(
        async () => {
          const start = selectedMods.report?.profileId === id ? selectedMods.report : await window.wave.mods.list(id)
          return turnOffModsWithErrors(start, (key, enabled) => window.wave.mods.setEnabled(id, key, enabled))
        },
        (result) => result.report
      )
      .then(({ turnedOff }) => {
        if (turnedOff.length > 0) {
          onToast({ tone: 'success', title: `Turned off ${plural(turnedOff.length, 'mod')} in ${name}`, lines: turnedOff.length <= 4 ? turnedOff : [...turnedOff.slice(0, 3), `And ${turnedOff.length - 3} more.`] })
        }

        onLaunch()
      })
      .catch(report)
      .finally(() => setFixing(false))
  }

  return (
    <div className="view view--scroll play">
      <section className="card hero" aria-labelledby="hero-title">
        <div className="hero__text">
          <p className="hero__eyebrow">Profile</p>
          <h1 id="hero-title" className="hero__title">
            <ProfilePicker
              profiles={profiles}
              selected={profile}
              versions={info.gameVersions}
              busy={busy}
              onSelect={(next) => {
                if (!next.selected) {
                  window.wave.profiles.select(next.id).catch(report)
                }
              }}
              onManage={onShowProfiles}
            />
          </h1>
          <p className="hero__subtitle">
            {profile ? profileDetail(profile, info.gameVersions) : `Minecraft ${info.minecraftVersion}`} · Fabric · Wave Client {info.version}
          </p>
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

      {blocked && (
        <ModProblemsCard
          count={blocked.errors}
          profileName={game.profile?.name ?? profile?.name ?? null}
          mods={blocked.mods}
          blocked
          working={fixing}
          disabled={playDisabled}
          onReview={() => onReviewMods(blocked.profileId)}
          onTurnOffAndPlay={turnOffAndPlay}
          onPlayAnyway={() => onLaunch({ ignoreModProblems: true })}
        />
      )}

      {heads && heads.count > 0 && profile && (
        <ModProblemsCard
          count={heads.count}
          profileName={profile.name}
          mods={heads.mods}
          blocked={false}
          working={false}
          disabled={playDisabled}
          onReview={() => onReviewMods(profile.id)}
        />
      )}

      {game.phase === 'crashed' && (
        <CrashCard
          title={crashTitle(game)}
          crash={game.crash}
          exitCode={game.exitCode}
          suspects={suspects}
          pendingKeys={pendingKeys}
          playLabel={playAgainLabel(game.profile, profile)}
          onToggleMod={toggleSuspect}
          onReviewMods={crashedId && suspects.length > 0 ? () => onReviewMods(crashedId) : null}
          playDisabled={playDisabled}
          onPlayAgain={() => onLaunch()}
          onShowLogs={onShowLogs}
          onOpenFile={(kind) => void window.wave.game.openCrashFile(kind).catch(report)}
          onCopyDetails={() => game.crash && copy(crashDetailsText(game.crash, info.minecraftVersion, info.version))}
          copied={copied}
        />
      )}

      {game.phase === 'failed' && !game.modProblems && (
        <FailedCard
          title={failedTitle(game)}
          error={game.error}
          disabled={playDisabled}
          onTryAgain={() => onLaunch()}
          onRepair={() => onLaunch({ repair: true })}
          onShowLogs={onShowLogs}
        />
      )}

      {settingsLoaded && profile && (
        <LaunchSummary info={info} profile={profile} settings={settings} onEditProfile={() => onShowProfileSettings(profile.id)} onEditLauncher={onShowSettings} />
      )}
    </div>
  )
}

interface LaunchSummaryProps {
  info: AppInfo
  profile: ProfileView
  settings: LauncherSettings
  onEditProfile: () => void
  onEditLauncher: () => void
}

/** What the next launch will use, at a glance: the profile's version and memory, then the launcher's settings. */
function LaunchSummary({ info, profile, settings, onEditProfile, onEditLauncher }: LaunchSummaryProps): JSX.Element {
  const afterLaunch = AFTER_LAUNCH_OPTIONS.find((option) => option.value === settings.afterLaunch)?.label ?? 'Keep the launcher open'
  const facts: Array<{ icon: IconName; label: string; value: string }> = [
    { icon: 'layers', label: 'Version', value: versionLabel(profile.gameVersion, info.gameVersions).replace(/^Minecraft /, '') },
    { icon: 'memory', label: 'Memory', value: formatMemory(profile.memoryMb) },
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
        <div className="summary__actions">
          <Button variant="ghost" size="sm" onClick={onEditProfile}>
            {profile.name} settings
          </Button>
          <Button variant="ghost" size="sm" onClick={onEditLauncher}>
            Launcher settings
          </Button>
        </div>
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
