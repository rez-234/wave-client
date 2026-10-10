import type { JSX } from 'react'

/** A small spinning ring; still when the user prefers reduced motion. */
export function Spinner({ size = 16, label }: { size?: number; label?: string }): JSX.Element {
  return (
    <span
      className="spinner"
      style={{ width: size, height: size }}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  )
}
