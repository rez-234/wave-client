import type { JSX } from 'react'

import { modProblemsText, modProblemsTitle } from '../../lib/play'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'

interface ModProblemsCardProps {
  /** How many mods (and profile-level problems) stop the launch. */
  count: number
  profileName: string | null
  /** The first few, by name with what's wrong. */
  mods: ReadonlyArray<{ key: string; name: string; message: string }>
  /** Set when Play was pressed and the launch stopped; otherwise the card is a heads-up before Play. */
  blocked: boolean
  /** The player chose Play anyway for exactly these problems, so Play starts Minecraft regardless. */
  accepted?: boolean
  /** A fix-and-play is under way. */
  working: boolean
  disabled: boolean
  onReview: () => void
  onTurnOffAndPlay?: () => void
  onPlayAnyway?: () => void
}

/** Mods that would stop (or just stopped) Minecraft from starting, with ways forward. Amber, not red: nothing broke yet. */
export function ModProblemsCard({ count, profileName, mods, blocked, accepted = false, working, disabled, onReview, onTurnOffAndPlay, onPlayAnyway }: ModProblemsCardProps): JSX.Element {
  const more = count - mods.length

  return (
    <section className="card status-card status-card--warn" role={blocked ? 'alert' : undefined} aria-labelledby="mod-problems-title">
      <div className="status-card__head">
        <h2 id="mod-problems-title" className="status-card__title status-card__title--warn">
          <Icon name="alert" size={18} />
          {modProblemsTitle(count, profileName)}
        </h2>
      </div>
      <p className="status-card__text">
        {modProblemsText(blocked, accepted)}
      </p>
      {mods.length > 0 && (
        <ul className="problem-list">
          {mods.map((mod) => (
            <li key={mod.key} className="problem-list__item">
              <span className="problem-list__name">{mod.name}</span>
              <span className="problem-list__message">{mod.message}</span>
            </li>
          ))}
          {more > 0 && <li className="problem-list__more">And {more === 1 ? '1 more' : `${more} more`}.</li>}
        </ul>
      )}
      <div className="status-card__actions">
        <Button variant={blocked ? 'primary' : 'secondary'} onClick={onReview}>
          Review mods
        </Button>
        {blocked && (
          <>
            <span className="spacer" />
            {onTurnOffAndPlay && (
              <Button variant="secondary" disabled={disabled || working} onClick={onTurnOffAndPlay}>
                {working ? 'Turning off…' : 'Turn them off and play'}
              </Button>
            )}
            {onPlayAnyway && (
              <Button variant="ghost" disabled={disabled || working} onClick={onPlayAnyway}>
                Play anyway
              </Button>
            )}
          </>
        )}
      </div>
    </section>
  )
}
