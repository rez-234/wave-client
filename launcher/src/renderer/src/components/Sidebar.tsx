import type { JSX } from 'react'

import type { AccountView } from '@shared/ipc'

import { AccountSwitcher } from './AccountSwitcher'
import { Icon, type IconName } from './ui/Icon'
import { LogoMark } from './ui/Logo'

export type View = 'play' | 'logs' | 'settings'

const NAV: ReadonlyArray<{ view: View; label: string; icon: IconName }> = [
  { view: 'play', label: 'Play', icon: 'play' },
  { view: 'logs', label: 'Logs', icon: 'logs' },
  { view: 'settings', label: 'Settings', icon: 'settings' }
]

interface SidebarProps {
  view: View
  onNavigate: (view: View) => void
  /** Shown next to Play while the game is busy, e.g. "Running". */
  playBadge: string | null
  accounts: AccountView[]
  onSelectAccount: (account: AccountView) => void
  onAddAccount: () => void
  onSignOut: (account: AccountView) => void
}

export function Sidebar({ view, onNavigate, playBadge, accounts, onSelectAccount, onAddAccount, onSignOut }: SidebarProps): JSX.Element {
  return (
    <aside className="sidebar">
      <div className="brand">
        <LogoMark size={28} />
        <span className="brand__name">Wave Client</span>
      </div>
      <nav className="nav" aria-label="Main">
        <ul>
          {NAV.map((item) => (
            <li key={item.view}>
              <button
                type="button"
                className={`nav__item${view === item.view ? ' nav__item--active' : ''}`}
                aria-current={view === item.view ? 'page' : undefined}
                onClick={() => onNavigate(item.view)}
              >
                <Icon name={item.icon} size={16} />
                <span className="nav__label">{item.label}</span>
                {item.view === 'play' && playBadge && <span className="nav__badge">{playBadge}</span>}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="sidebar__footer">
        <AccountSwitcher accounts={accounts} onSelect={onSelectAccount} onAddAccount={onAddAccount} onSignOut={onSignOut} />
      </div>
    </aside>
  )
}
