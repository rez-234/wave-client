import type { JSX } from 'react'

import type { CrashFileKind, CrashSummary, ModView } from '@shared/ipc'

import { suspectName, type SuspectMatch } from '../../lib/play'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'

interface CrashCardProps {
  /** "PvP crashed". */
  title: string
  crash: CrashSummary | undefined
  exitCode: number | null | undefined
  /** The suspects, each with the mod in the crashed profile it points to (if any). */
  suspects: SuspectMatch[]
  /** Keys of mods being turned on or off. */
  pendingKeys: ReadonlySet<string>
  /** "Play again", or "Play Survival" when another profile is selected now. */
  playLabel: string
  onToggleMod: (mod: ModView, enabled: boolean) => void
  onReviewMods: (() => void) | null
  onPlayAgain: () => void
  onShowLogs: () => void
  onOpenFile: (kind: CrashFileKind) => void
  onCopyDetails: () => void
  copied: boolean
  playDisabled: boolean
}

/** Why the game crashed, which mods might be to blame (with a switch for each), and what to do next. */
export function CrashCard({
  title,
  crash,
  exitCode,
  suspects,
  pendingKeys,
  playLabel,
  onToggleMod,
  onReviewMods,
  onPlayAgain,
  onShowLogs,
  onOpenFile,
  onCopyDetails,
  copied,
  playDisabled
}: CrashCardProps): JSX.Element {
  return (
    <section className="card status-card status-card--danger" role="alert" aria-labelledby="crash-title">
      <div className="status-card__head">
        <h2 id="crash-title" className="status-card__title status-card__title--danger">
          <Icon name="alert" size={18} />
          {title}
        </h2>
        {typeof exitCode === 'number' && <span className="status-card__meta">Exit code {exitCode}</span>}
      </div>
      <p className="status-card__reason">{crash?.reason || 'Minecraft closed unexpectedly.'}</p>

      {suspects.length > 0 && (
        <div className="suspects">
          <p className="suspects__label">{suspects.length === 1 ? 'Suspected mod' : 'Suspected mods'}</p>
          <ul className="suspect-list">
            {suspects.map(({ suspect, mod }, i) => (
              <li key={`${suspect.id}-${i}`} className="suspect">
                <div className="suspect__text">
                  <p className="suspect__name">
                    {mod?.name ?? suspectName(suspect)}
                    {mod && !mod.enabled && <span className="badge">Turned off</span>}
                  </p>
                  <p className="suspect__reason">{suspect.reason}</p>
                </div>
                {mod && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={pendingKeys.has(mod.key)}
                    aria-label={`${mod.enabled ? 'Turn off' : 'Turn on'} ${mod.name}`}
                    onClick={() => onToggleMod(mod, !mod.enabled)}
                  >
                    {mod.enabled ? 'Turn off' : 'Turn on'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="status-card__actions">
        <Button variant="secondary" icon="logs" onClick={onShowLogs}>
          View logs
        </Button>
        {crash?.reportPath ? (
          <Button variant="secondary" icon="file" onClick={() => onOpenFile('report')}>
            Open crash report
          </Button>
        ) : crash?.jvmErrorPath ? (
          <Button variant="secondary" icon="file" onClick={() => onOpenFile('jvm-error')}>
            Open error log
          </Button>
        ) : null}
        {crash && (
          <Button variant="secondary" icon={copied ? 'check' : 'copy'} onClick={onCopyDetails}>
            {copied ? 'Copied' : 'Copy details'}
          </Button>
        )}
        {onReviewMods && (
          <Button variant="secondary" icon="layers" onClick={onReviewMods}>
            Review mods
          </Button>
        )}
        <span className="spacer" />
        <Button variant="primary" icon="play" onClick={onPlayAgain} disabled={playDisabled}>
          {playLabel}
        </Button>
      </div>
    </section>
  )
}
