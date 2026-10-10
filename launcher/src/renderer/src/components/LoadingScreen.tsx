import type { JSX } from 'react'

import { Button } from './ui/Button'
import { LogoMark } from './ui/Logo'

/** Shown until the launcher knows what to show: just the mark, or what went wrong and a retry. */
export function LoadingScreen({ error, onRetry }: { error: string | null; onRetry: () => void }): JSX.Element {
  if (error) {
    return (
      <div className="screen-center">
        <section className="card fallback" role="alert">
          <LogoMark size={36} />
          <h1 className="fallback__title">Wave Client couldn't start</h1>
          <p className="muted">{error}</p>
          <div className="fallback__actions">
            <Button variant="primary" onClick={onRetry}>
              Try again
            </Button>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="screen-center loading" aria-busy="true">
      <LogoMark size={40} />
      <p className="visually-hidden" role="status">
        Loading Wave Client…
      </p>
    </div>
  )
}
