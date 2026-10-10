import type { JSX } from 'react'

import type { GameState } from '@shared/ipc'

import { describeProgress, isCancellable, taskTitle } from '../../lib/progress'
import { Button } from '../ui/Button'
import { ProgressBar } from '../ui/ProgressBar'

/** Checking, downloading or starting: what's happening, how far along, and a way to stop. */
export function GameProgress({ game, onCancel }: { game: GameState; onCancel: () => void }): JSX.Element {
  const starting = game.phase === 'starting'
  const progress = starting ? describeProgress(undefined) : describeProgress(game.task)
  const title = starting ? 'Starting Minecraft…' : taskTitle(game)

  return (
    <section className="card status-card" aria-label="Launch progress">
      <div className="status-card__head">
        <h2 className="status-card__title">{title}</h2>
        {progress.percent !== null && <span className="status-card__percent">{progress.percent}%</span>}
      </div>
      <ProgressBar value={progress.fraction} label={title} valueText={progress.amount || undefined} />
      <div className="status-card__foot">
        <span className="status-card__amount">
          {progress.amount || (starting ? 'The game window will open in a moment.' : 'This can take a minute the first time.')}
        </span>
        {isCancellable(game.phase) && (
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </section>
  )
}
