import type { JSX } from 'react'

import type { GameVersionView, ProfileView } from '@shared/ipc'

import { pickerLabel, profileDetail } from '../../lib/profiles'
import { Icon } from '../ui/Icon'
import { Menu, type MenuEntry } from '../ui/Menu'

interface ProfilePickerProps {
  profiles: ProfileView[]
  selected: ProfileView | null
  versions: readonly GameVersionView[]
  /** The game is starting or running: the profile can't change until it closes. */
  busy: boolean
  onSelect: (profile: ProfileView) => void
  onManage: () => void
}

/** The hero's title: the profile Play launches, and a menu to pick another. */
export function ProfilePicker({ profiles, selected, versions, busy, onSelect, onManage }: ProfilePickerProps): JSX.Element {
  const name = selected?.name ?? 'No profile'

  if (busy) {
    // Still focusable, so a screen reader hears why it can't be used now.
    return (
      <button type="button" className="profile-picker profile-picker--busy" aria-disabled="true" aria-label={pickerLabel(selected, true)} title="You can switch profiles when Minecraft closes.">
        <span className="profile-picker__name">{name}</span>
      </button>
    )
  }

  const items: MenuEntry[] = [
    ...profiles.map(
      (profile): MenuEntry => ({
        key: profile.id,
        label: profile.name,
        detail: profileDetail(profile, versions),
        checked: profile.selected,
        onSelect: () => onSelect(profile)
      })
    ),
    { kind: 'divider', key: 'divider' },
    { key: 'manage', label: 'Manage profiles', icon: 'layers', onSelect: onManage }
  ]

  return (
    <Menu
      label="Profiles"
      items={items}
      className="profile-picker__menu"
      trigger={(props) => (
        <button {...props} type="button" className="profile-picker" aria-label={pickerLabel(selected, false)}>
          <span className="profile-picker__name">{name}</span>
          <Icon name="chevronDown" size={20} className="profile-picker__chevron" />
        </button>
      )}
    />
  )
}
