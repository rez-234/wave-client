import { useRef, type JSX, type KeyboardEvent } from 'react'

import type { AppInfo, ProfileView } from '@shared/ipc'

import type { ToastContent } from '../../lib/mods'
import { profileDetail } from '../../lib/profiles'
import { Icon } from '../ui/Icon'
import { ModsTab } from './ModsTab'
import { ProfileMenu } from './ProfileMenu'
import { ProfileSettingsTab } from './ProfileSettingsTab'
import { UseForPlay } from './UseForPlay'

export type ProfileTab = 'mods' | 'settings'

const TABS: ReadonlyArray<{ tab: ProfileTab; label: string }> = [
  { tab: 'mods', label: 'Mods' },
  { tab: 'settings', label: 'Settings' }
]

interface ProfileDetailProps {
  info: AppInfo
  profile: ProfileView
  profiles: ProfileView[]
  tab: ProfileTab
  /** Start the Mods tab with only the mods that have problems (from "Review mods"). */
  problemsOnly: boolean
  busy: boolean
  onTab: (tab: ProfileTab) => void
  onBack: () => void
  onOpen: (profile: ProfileView) => void
  onProfileChanged: (profile: ProfileView) => void
  onToast: (toast: ToastContent) => void
  report: (error: unknown) => void
}

/** One profile: its mods and its settings, whether or not it's the one Play launches. */
export function ProfileDetail(props: ProfileDetailProps): JSX.Element {
  const { info, profile, profiles, tab, problemsOnly, busy, onTab, onBack, onOpen, onProfileChanged, onToast, report } = props
  const tabRefs = useRef<Partial<Record<ProfileTab, HTMLButtonElement | null>>>({})

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = TABS.findIndex((item) => item.tab === tab)
    let next: number | null = null

    if (event.key === 'ArrowRight') {
      next = (index + 1) % TABS.length
    } else if (event.key === 'ArrowLeft') {
      next = (index - 1 + TABS.length) % TABS.length
    } else if (event.key === 'Home') {
      next = 0
    } else if (event.key === 'End') {
      next = TABS.length - 1
    }

    const target = next === null ? undefined : TABS[next]

    if (target) {
      event.preventDefault()
      onTab(target.tab)
      tabRefs.current[target.tab]?.focus()
    }
  }

  return (
    <div className="view profile">
      <header className="profile__header">
        <button type="button" className="back-button" onClick={onBack}>
          <Icon name="chevronLeft" size={16} />
          Profiles
        </button>
        <div className="profile__title-row">
          <div className="profile__title-text">
            <h1 className="page-title profile__name">{profile.name}</h1>
            <p className="profile__detail">
              {profileDetail(profile, info.gameVersions)}
              {profile.running && <span className="badge badge--live">Playing</span>}
            </p>
          </div>
          <div className="profile__actions">
            <UseForPlay profile={profile} busy={busy} report={report} />
            <ProfileMenu profile={profile} profiles={profiles} platform={info.platform} onCreated={onOpen} onDeleted={onBack} report={report} />
          </div>
        </div>
        <div className="tabs" role="tablist" aria-label={`${profile.name} sections`} onKeyDown={onTabKeyDown}>
          {TABS.map((item) => (
            <button
              key={item.tab}
              ref={(element) => {
                tabRefs.current[item.tab] = element
              }}
              type="button"
              role="tab"
              id={`profile-tab-${item.tab}`}
              aria-selected={tab === item.tab}
              aria-controls={`profile-panel-${item.tab}`}
              tabIndex={tab === item.tab ? 0 : -1}
              className={`tabs__tab${tab === item.tab ? ' tabs__tab--active' : ''}`}
              onClick={() => onTab(item.tab)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <div className="profile__panel" role="tabpanel" id={`profile-panel-${tab}`} aria-labelledby={`profile-tab-${tab}`}>
        {tab === 'mods' ? (
          <ModsTab key={profile.id} info={info} profile={profile} initialProblemsOnly={problemsOnly} onToast={onToast} report={report} />
        ) : (
          <ProfileSettingsTab key={profile.id} info={info} profile={profile} onSaved={onProfileChanged} report={report} />
        )}
      </div>
    </div>
  )
}
