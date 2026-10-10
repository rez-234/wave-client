import type { JSX } from 'react'

import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'

interface FailedCardProps {
  error: string | undefined
  onTryAgain: () => void
  onRepair: () => void
  onShowLogs: () => void
  disabled: boolean
}

/** Starting the game failed before it ran: the reason, and two ways forward. */
export function FailedCard({ error, onTryAgain, onRepair, onShowLogs, disabled }: FailedCardProps): JSX.Element {
  return (
    <section className="card status-card status-card--danger" role="alert" aria-labelledby="failed-title">
      <div className="status-card__head">
        <h2 id="failed-title" className="status-card__title status-card__title--danger">
          <Icon name="alert" size={18} />
          Couldn't start Minecraft
        </h2>
      </div>
      <p className="status-card__reason">{error?.trim() || 'Something went wrong while starting Minecraft. The log has the details.'}</p>
      <div className="status-card__actions">
        <Button variant="secondary" icon="logs" onClick={onShowLogs}>
          View logs
        </Button>
        <span className="spacer" />
        <Button variant="secondary" icon="wrench" onClick={onRepair} disabled={disabled}>
          Repair game files
        </Button>
        <Button variant="primary" onClick={onTryAgain} disabled={disabled}>
          Try again
        </Button>
      </div>
    </section>
  )
}
