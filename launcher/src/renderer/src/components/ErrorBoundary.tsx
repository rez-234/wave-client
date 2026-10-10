import { Component, type ErrorInfo, type JSX, type ReactNode } from 'react'

import { LogoMark } from './ui/Logo'

interface ErrorBoundaryProps {
  children: ReactNode
  /** 'page' replaces just one view and offers to try again; 'app' replaces the whole window. */
  scope?: 'app' | 'page'
}

interface ErrorBoundaryState {
  error: Error | null
}

/** Keeps a rendering bug from leaving a blank window: shows what happened and a way back. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('The launcher window ran into a problem', error, info.componentStack)
  }

  private readonly retry = (): void => this.setState({ error: null })

  override render(): ReactNode {
    const { error } = this.state

    if (!error) {
      return this.props.children
    }

    return this.props.scope === 'page' ? <PageFallback error={error} onRetry={this.retry} /> : <AppFallback error={error} />
  }
}

function PageFallback({ error, onRetry }: { error: Error; onRetry: () => void }): JSX.Element {
  return (
    <div className="view view--centered">
      <section className="card fallback" role="alert">
        <h1 className="fallback__title">This page ran into a problem</h1>
        <p className="muted">The rest of the launcher still works. You can try showing the page again.</p>
        <details className="disclosure">
          <summary>Details</summary>
          <pre className="disclosure__body mono">{error.message}</pre>
        </details>
        <div className="fallback__actions">
          <button type="button" className="btn btn--primary btn--md" onClick={onRetry}>
            Try again
          </button>
        </div>
      </section>
    </div>
  )
}

function AppFallback({ error }: { error: Error }): JSX.Element {
  return (
    <div className="screen-center">
      <section className="card fallback" role="alert">
        <LogoMark size={36} />
        <h1 className="fallback__title">The launcher window ran into a problem</h1>
        <p className="muted">Reloading the window usually fixes this. A game that is already running keeps running.</p>
        <details className="disclosure">
          <summary>Details</summary>
          <pre className="disclosure__body mono">{error.message}</pre>
        </details>
        <div className="fallback__actions">
          <button type="button" className="btn btn--primary btn--md" onClick={() => window.location.reload()}>
            Reload the window
          </button>
        </div>
      </section>
    </div>
  )
}
