import { useEffect, useState, type JSX } from 'react'

import type { ToastItem } from '../../hooks/useToasts'
import { Icon } from './Icon'

/** How long a notice stays, longer for ones with more to read; hovering or focusing it keeps it. */
function lifetime(toast: ToastItem): number {
  return 6000 + toast.lines.length * 2000
}

/** The notices in the bottom corner. The region is always there, so screen readers hear new ones. */
export function Toasts({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }): JSX.Element {
  return (
    <div className="toasts" aria-live="polite" aria-relevant="additions">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

/** `toast` and `onDismiss` keep their identity across the window's re-renders, so the timer isn't restarted by them. */
function Toast({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }): JSX.Element {
  const [held, setHeld] = useState(false)

  useEffect(() => {
    if (held) {
      return
    }

    const timer = window.setTimeout(() => onDismiss(toast.id), lifetime(toast))
    return () => window.clearTimeout(timer)
  }, [held, toast, onDismiss])

  return (
    <div
      className={`toast toast--${toast.tone}`}
      role="status"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <Icon name={toast.tone === 'success' ? 'check' : 'info'} size={16} className="toast__icon" />
      <div className="toast__body">
        <p className="toast__title">{toast.title}</p>
        {toast.lines.length > 0 && (
          <ul className="toast__lines">
            {toast.lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        )}
      </div>
      <button type="button" className="icon-button toast__dismiss" aria-label="Dismiss" onClick={() => onDismiss(toast.id)}>
        <Icon name="close" size={14} />
      </button>
    </div>
  )
}
