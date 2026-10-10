import type { JSX } from 'react'

import { initialOf } from '../../lib/format'

/** The first letter of an account's name in a circle. Never loads a skin or any remote image. */
export function Avatar({ name, size = 32, muted = false }: { name: string; size?: number; muted?: boolean }): JSX.Element {
  return (
    <span className={`avatar${muted ? ' avatar--muted' : ''}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.44) }} aria-hidden="true">
      {initialOf(name)}
    </span>
  )
}
