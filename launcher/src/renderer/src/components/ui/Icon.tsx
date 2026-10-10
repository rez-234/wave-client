import type { JSX, ReactElement } from 'react'

/** Simple stroke icons drawn for the launcher (24×24 grid, 1.75px strokes). */
const PATHS = {
  play: <path d="M7 4.5v15l12-7.5-12-7.5Z" strokeLinejoin="round" />,
  logs: (
    <>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.75v2.5M12 18.75v2.5M21.25 12h-2.5M5.25 12h-2.5M18.54 5.46l-1.77 1.77M7.23 16.77l-1.77 1.77M18.54 18.54l-1.77-1.77M7.23 7.23 5.46 5.46" />
    </>
  ),
  chevronUpDown: <path d="m8 9 4-4 4 4M8 15l4 4 4-4" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
    </>
  ),
  external: (
    <>
      <path d="M13.5 4.5h6v6M19.5 4.5 11 13" />
      <path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
    </>
  ),
  folder: <path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7Z" strokeLinejoin="round" />,
  plus: <path d="M12 5v14M5 12h14" />,
  signOut: (
    <>
      <path d="M10 4.5H6a1.5 1.5 0 0 0-1.5 1.5v12A1.5 1.5 0 0 0 6 19.5h4" />
      <path d="m15 8 4 4-4 4M19 12H9.5" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 4.2 2.9 17.5A2 2 0 0 0 4.6 20.5h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" strokeLinejoin="round" />
      <path d="M12 9.5v4M12 17h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  arrowDown: <path d="M12 5v14M6 13l6 6 6-6" />,
  wrench: (
    <path d="M14.7 6.3a4 4 0 0 0-5.2 5.2l-5.3 5.3a1.6 1.6 0 0 0 2.3 2.3l5.3-5.3a4 4 0 0 0 5.2-5.2l-2.5 2.5-2.3-.3-.3-2.3 2.8-2.2Z" strokeLinejoin="round" />
  ),
  download: <path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.5-4.5" />
    </>
  ),
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />,
  memory: (
    <>
      <rect x="4" y="7" width="16" height="10" rx="1.5" />
      <path d="M8 10.5v3M12 10.5v3M16 10.5v3M7 17v2M17 17v2" />
    </>
  ),
  coffee: (
    <>
      <path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9Z" strokeLinejoin="round" />
      <path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M9 3.5v2.5M12.5 3.5v2.5" />
    </>
  ),
  monitor: (
    <>
      <rect x="3.5" y="4.5" width="17" height="11.5" rx="1.5" />
      <path d="M9 20h6M12 16v4" />
    </>
  ),
  rocket: (
    <path d="M12 3.5c3 1.8 4.5 4.8 4.5 8.5l-2 3.5h-5l-2-3.5c0-3.7 1.5-6.7 4.5-8.5ZM9.5 15.5 7 18.5h3M14.5 15.5l2.5 3h-3M12 9.5v.01" strokeLinejoin="round" />
  )
} satisfies Record<string, ReactElement>

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }): JSX.Element {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
