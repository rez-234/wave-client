import { useState, type JSX } from 'react'

import type { AppInfo, ProfileView } from '@shared/ipc'

import { useNow } from '../../hooks/useNow'
import { lastPlayedText, newProfileName, profileDetail, selectedProfile } from '../../lib/profiles'
import { Button } from '../ui/Button'
import { NameDialog, type NameDialogRequest } from './NameDialog'
import { ProfileMenu } from './ProfileMenu'
import { UseForPlay } from './UseForPlay'

interface ProfileListProps {
  info: AppInfo
  profiles: ProfileView[]
  /** The game is starting or running: the profile Play uses can't change. */
  busy: boolean
  onOpen: (profile: ProfileView) => void
  report: (error: unknown) => void
}

/** Every profile as a card: open one to change its mods and settings, or pick the one Play uses. */
export function ProfileList({ info, profiles, busy, onOpen, report }: ProfileListProps): JSX.Element {
  const [naming, setNaming] = useState<NameDialogRequest | null>(null)
  const now = useNow(60_000)
  const selected = selectedProfile(profiles)

  const newProfile = (): void =>
    setNaming({
      title: 'New profile',
      confirmLabel: 'Create profile',
      initialName: newProfileName(profiles),
      option: selected ? { label: `Copy settings, keybinds, servers and Wave Client HUD from ${selected.name}`, initial: true } : undefined,
      run: (name, copy) => window.wave.profiles.create({ name, copy: copy && selected ? { from: selected.id, what: 'settings' } : undefined }).then(onOpen)
    })

  return (
    <div className="view view--scroll profiles">
      <div className="profiles__inner">
        <header className="page-header">
          <h1 className="page-title">Profiles</h1>
          <div className="page-header__actions">
            <Button variant="primary" icon="plus" onClick={newProfile}>
              New profile
            </Button>
          </div>
        </header>
        <p className="page-lead">Each profile has its own Minecraft version, mods, memory and game folder, with its own worlds and settings.</p>

        <ul className="profile-grid" aria-label="Profiles">
          {profiles.map((profile) => (
            <li key={profile.id} className={`card profile-card${profile.selected ? ' profile-card--selected' : ''}`}>
              <div className="profile-card__head">
                <h2 className="profile-card__name">
                  {/* The name opens the profile; its hit area covers the card (see .profile-card__open::after). */}
                  <button type="button" className="profile-card__open" onClick={() => onOpen(profile)}>
                    {profile.name}
                  </button>
                </h2>
                <ProfileMenu
                  profile={profile}
                  profiles={profiles}
                  platform={info.platform}
                  onCreated={onOpen}
                  onDeleted={() => undefined}
                  report={report}
                  className="profile-card__menu"
                />
              </div>
              <p className="profile-card__detail">{profileDetail(profile, info.gameVersions)}</p>
              <p className="profile-card__played">{profile.running ? 'Playing now' : lastPlayedText(profile.lastPlayedAt, now)}</p>
              <div className="profile-card__foot">
                <UseForPlay profile={profile} busy={busy} report={report} />
              </div>
            </li>
          ))}
        </ul>
      </div>
      <NameDialog request={naming} profiles={profiles} onClose={() => setNaming(null)} />
    </div>
  )
}
