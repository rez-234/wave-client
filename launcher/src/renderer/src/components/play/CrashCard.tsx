import type { JSX } from 'react'

import type { CrashSummary } from '@shared/ipc'

import { suspectName } from '../../lib/play'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'

interface CrashCardProps {
  crash: CrashSummary | undefined
  exitCode: number | null | undefined
  onPlayAgain: () => void
  onShowLogs: () => void
  onOpenCrashReports: () => void
  onOpenGameFolder: () => void
  onCopyDetails: () => void
  copied: boolean
  playDisabled: boolean
}

/** Why the game crashed, which mods might be to blame, and what to do next. */
export function CrashCard({
  crash,
  exitCode,
  onPlayAgain,
  onShowLogs,
  onOpenCrashReports,
  onOpenGameFolder,
  onCopyDetails,
  copied,
  playDisabled
}: CrashCardProps): JSX.Element {
  const suspects = crash?.suspectedMods ?? []

  return (
    <section className="card status-card status-card--danger" role="alert" aria-labelledby="crash-title">
      <div className="status-card__head">
        <h2 id="crash-title" className="status-card__title status-card__title--danger">
          <Icon name="alert" size={18} />
          Minecraft crashed
        </h2>
        {typeof exitCode === 'number' && <span className="status-card__meta">Exit code {exitCode}</span>}
      </div>
      <p className="status-card__reason">{crash?.reason || 'Minecraft closed unexpectedly.'}</p>

      {suspects.length > 0 && (
        <div className="suspects">
          <p className="suspects__label">{suspects.length === 1 ? 'Suspected mod' : 'Suspected mods'}</p>
          <ul className="chips">
            {suspects.map((mod) => (
              <li key={mod.id} className="chip" title={mod.reason}>
                {suspectName(mod)}
                <span className="visually-hidden">: {mod.reason}</span>
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
          <Button variant="secondary" icon="folder" onClick={onOpenCrashReports}>
            Open crash reports
          </Button>
        ) : crash?.jvmErrorPath ? (
          <Button variant="secondary" icon="folder" onClick={onOpenGameFolder}>
            Open game folder
          </Button>
        ) : null}
        {crash && (
          <Button variant="secondary" icon={copied ? 'check' : 'copy'} onClick={onCopyDetails}>
            {copied ? 'Copied' : 'Copy details'}
          </Button>
        )}
        <span className="spacer" />
        <Button variant="primary" icon="play" onClick={onPlayAgain} disabled={playDisabled}>
          Play again
        </Button>
      </div>
    </section>
  )
}
