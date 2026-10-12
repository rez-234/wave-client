import { useCallback, useRef, useState, type JSX } from 'react'

import type { AppInfo, ProfilePatch, ProfileView } from '@shared/ipc'

import { useFlash } from '../../hooks/useFlash'
import { versionLabel } from '../../lib/profiles'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { JvmArgsSetting } from '../settings/JvmArgsSetting'
import { MemorySetting } from '../settings/MemorySetting'
import { SettingRow, SettingsSection } from '../settings/SettingRow'

interface ProfileSettingsTabProps {
  info: AppInfo
  profile: ProfileView
  /** The profile as the main process saved it. */
  onSaved: (profile: ProfileView) => void
  report: (error: unknown) => void
}

/** A profile's Minecraft version, memory and JVM arguments, and where its files are. */
export function ProfileSettingsTab({ info, profile, onSaved, report }: ProfileSettingsTabProps): JSX.Element {
  const [saved, flashSaved] = useFlash(1800)
  const latest = useRef(0)
  const [savingVersion, setSavingVersion] = useState(false)
  const versions = info.gameVersions.some((version) => version.id === profile.gameVersion)
    ? info.gameVersions
    : [...info.gameVersions, { id: profile.gameVersion, label: versionLabel(profile.gameVersion, info.gameVersions), java: 0 }]

  /** Like the launcher settings: what the main process returns is authoritative; only the newest answer is shown. Never rejects. */
  const save = useCallback(
    async (patch: ProfilePatch): Promise<ProfileView | null> => {
      const request = ++latest.current

      try {
        const result = await window.wave.profiles.update(profile.id, patch)

        if (request === latest.current) {
          onSaved(result)
          flashSaved()
        }

        return result
      } catch (error) {
        report(error)
        return null
      }
    },
    [profile.id, onSaved, flashSaved, report]
  )

  return (
    <div className="profile-settings">
      <p className={`saved profile-settings__saved${saved ? ' saved--visible' : ''}`} role="status">
        {saved && (
          <>
            <Icon name="check" size={14} />
            Saved
          </>
        )}
      </p>

      {profile.running && (
        <Alert tone="info" className="profile-settings__note">
          Minecraft is running with this profile. Changes apply next time you play.
        </Alert>
      )}

      <SettingsSection id="profile-game" title="Game">
        <SettingRow id="game-version" htmlFor="game-version-select" label="Minecraft version" description="Wave Client and Fabric are set up for it the next time you play.">
          <div className="select">
            <select
              id="game-version-select"
              value={profile.gameVersion}
              disabled={savingVersion || versions.length < 2}
              aria-describedby="game-version-description"
              onChange={(event) => {
                setSavingVersion(true)
                void save({ gameVersion: event.target.value }).finally(() => setSavingVersion(false))
              }}
            >
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  {version.label}
                </option>
              ))}
            </select>
            <Icon name="chevronUpDown" size={14} className="select__icon" />
          </div>
        </SettingRow>
        <MemorySetting
          memoryMb={profile.memoryMb}
          totalMemoryMb={info.totalMemoryMb}
          limits={info.memoryRangeMb}
          disabled={false}
          onSave={(memoryMb) => save({ memoryMb })}
        />
        <JvmArgsSetting jvmArgs={profile.jvmArgs} disabled={false} onSave={(jvmArgs) => save({ jvmArgs })} />
      </SettingsSection>

      <SettingsSection id="profile-folder" title="Folder">
        <SettingRow
          id="profile-folder-row"
          label="Game folder"
          description={
            <>
              Worlds, screenshots, resource packs and this profile's own Minecraft settings. In the launcher's folder, under{' '}
              <span className="path path--inline">instances/{profile.id}</span>
            </>
          }
        >
          <Button variant="secondary" size="sm" icon="folder" onClick={() => void window.wave.app.openFolder('game', profile.id).catch(report)}>
            Open folder
          </Button>
        </SettingRow>
      </SettingsSection>
    </div>
  )
}
