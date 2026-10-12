import { useEffect, type JSX } from 'react'

import type { AppInfo, ProfileView } from '@shared/ipc'

import type { ToastContent } from '../../lib/mods'
import { ProfileDetail, type ProfileTab } from './ProfileDetail'
import { ProfileList } from './ProfileList'

/** Which profile page is open. The viewed profile is the page's own; it isn't the one Play launches. */
export interface ProfilesRoute {
  /** null: the list. */
  id: string | null
  tab: ProfileTab
  /** Open the Mods tab filtered to mods with problems. */
  problemsOnly?: boolean
}

interface ProfilesViewProps {
  info: AppInfo
  profiles: ProfileView[]
  busy: boolean
  route: ProfilesRoute
  onRoute: (route: ProfilesRoute) => void
  onProfileChanged: (profile: ProfileView) => void
  onToast: (toast: ToastContent) => void
  report: (error: unknown) => void
}

export function ProfilesView({ info, profiles, busy, route, onRoute, onProfileChanged, onToast, report }: ProfilesViewProps): JSX.Element {
  const viewed = route.id === null ? null : (profiles.find((profile) => profile.id === route.id) ?? null)
  // The open profile was deleted (here, or by another window's action): back to the list.
  const gone = route.id !== null && viewed === null && profiles.length > 0

  useEffect(() => {
    if (gone) {
      onRoute({ id: null, tab: 'mods' })
    }
  }, [gone, onRoute])

  /** A new profile may come back before the list event that includes it: add it first, so the page doesn't count it as deleted. */
  const open = (profile: ProfileView): void => {
    onProfileChanged(profile)
    onRoute({ id: profile.id, tab: 'mods' })
  }

  if (!viewed) {
    return <ProfileList info={info} profiles={profiles} busy={busy} onOpen={open} report={report} />
  }

  return (
    <ProfileDetail
      info={info}
      profile={viewed}
      profiles={profiles}
      tab={route.tab}
      problemsOnly={route.problemsOnly === true}
      busy={busy}
      onTab={(tab) => onRoute({ id: viewed.id, tab })}
      onBack={() => onRoute({ id: null, tab: 'mods' })}
      onOpen={open}
      onProfileChanged={onProfileChanged}
      onToast={onToast}
      report={report}
    />
  )
}
