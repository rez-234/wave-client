import type { JSX, ReactNode } from 'react'

import { Icon } from './Icon'

export type AlertTone = 'danger' | 'warn' | 'info'

interface AlertProps {
  tone?: AlertTone
  title?: ReactNode
  children?: ReactNode
  /** Shows a close button. */
  onDismiss?: () => void
  /** Extra content under the message, such as buttons. */
  actions?: ReactNode
  className?: string
}

/** An inline message. Errors are announced (role="alert"); notices are just shown. */
export function Alert({ tone = 'info', title, children, onDismiss, actions, className }: AlertProps): JSX.Element {
  return (
    <div className={['alert', `alert--${tone}`, className].filter(Boolean).join(' ')} role={tone === 'danger' ? 'alert' : 'note'}>
      <Icon name={tone === 'info' ? 'info' : 'alert'} size={16} className="alert__icon" />
      <div className="alert__body">
        {title && <p className="alert__title">{title}</p>}
        {children && <div className="alert__message">{children}</div>}
        {actions && <div className="alert__actions">{actions}</div>}
      </div>
      {onDismiss && (
        <button type="button" className="icon-button alert__dismiss" onClick={onDismiss} aria-label="Dismiss">
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  )
}
