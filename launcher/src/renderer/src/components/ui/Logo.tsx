import type { JSX } from 'react'

/** The Wave Client mark: a wave on an accent tile. */
export function LogoMark({ size = 28 }: { size?: number }): JSX.Element {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="7" fill="var(--color-accent)" />
      <path
        d="M5.5 18.5c2.6 0 2.6-5 5.25-5s2.6 5 5.25 5 2.6-5 5.25-5 2.6 5 5.25 5"
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 23.5c2.6 0 2.6-2.5 5.25-2.5s2.6 2.5 5.25 2.5 2.6-2.5 5.25-2.5 2.6 2.5 5.25 2.5"
        fill="none"
        stroke="#fff"
        strokeOpacity="0.55"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
