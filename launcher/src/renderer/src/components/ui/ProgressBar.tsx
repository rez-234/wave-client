import type { JSX } from 'react'

interface ProgressBarProps {
  /** 0 to 1, or null for an indeterminate bar. */
  value: number | null
  label: string
  /** Read out instead of the percentage, e.g. "41.2 MB of 98.1 MB". */
  valueText?: string
  tone?: 'accent' | 'danger'
}

export function ProgressBar({ value, label, valueText, tone = 'accent' }: ProgressBarProps): JSX.Element {
  const percent = value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100)

  return (
    <div
      className={`progress progress--${tone}${percent === null ? ' progress--indeterminate' : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={percent === null ? undefined : 0}
      aria-valuemax={percent === null ? undefined : 100}
      aria-valuenow={percent ?? undefined}
      aria-valuetext={percent === null ? undefined : valueText || `${percent}%`}
    >
      <div className="progress__fill" style={percent === null ? undefined : { width: `${percent}%` }} />
    </div>
  )
}
