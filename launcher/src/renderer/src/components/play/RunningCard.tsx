import { useState, type JSX } from 'react'

import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'

/** The game is running: a way to its output, and a force quit for when it hangs. */
export function RunningCard({ onKill, onShowLogs }: { onKill: () => void; onShowLogs: () => void }): JSX.Element {
  const [confirming, setConfirming] = useState(false)

  return (
    <section className="card status-card" aria-labelledby="running-title">
      <div className="status-card__head">
        <h2 id="running-title" className="status-card__title">
          <span className="live-dot" aria-hidden="true" />
          Playing
        </h2>
      </div>
      <p className="status-card__text">Minecraft is running. Its output shows up in the logs as you play.</p>
      <div className="status-card__actions">
        <Button variant="secondary" icon="logs" onClick={onShowLogs}>
          View logs
        </Button>
        <span className="spacer" />
        <Button variant="danger" icon="stop" onClick={() => setConfirming(true)}>
          Force quit
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Force quit Minecraft?"
        confirmLabel="Force quit"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false)
          onKill()
        }}
      >
        Minecraft will close right away without saving. Use this only if the game has stopped responding.
      </ConfirmDialog>
    </section>
  )
}
