import { useCallback, useRef, useState, type JSX } from 'react'

import type { AccountView, AppInfo, FolderKind, LauncherSettings } from '@shared/ipc'

import { useFlash } from '../../hooks/useFlash'
import { AFTER_LAUNCH_OPTIONS } from '../../lib/settings'
import { Avatar } from '../ui/Avatar'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Icon } from '../ui/Icon'
import { SegmentedControl } from '../ui/SegmentedControl'
import { JavaSetting } from './JavaSetting'
import { JvmArgsSetting } from './JvmArgsSetting'
import { MemorySetting } from './MemorySetting'
import { SettingRow, SettingsSection } from './SettingRow'
import { WindowSettings } from './WindowSettings'

interface SettingsViewProps {
  info: AppInfo
  settings: LauncherSettings
  settingsLoaded: boolean
  accounts: AccountView[]
  /** Whether "Repair game files" can start now (signed in, nothing running). */
  canRepair: boolean
  onApplySettings: (settings: LauncherSettings) => void
  onRepair: () => void
  onOpenFolder: (kind: FolderKind) => void
  onAddAccount: () => void
  onSignOut: (account: AccountView) => void
  report: (error: unknown) => void
}

const FOLDERS: ReadonlyArray<{ kind: FolderKind; label: string }> = [
  { kind: 'game', label: 'Open game folder' },
  { kind: 'mods', label: 'Open mods folder' },
  { kind: 'screenshots', label: 'Open screenshots folder' },
  { kind: 'logs', label: 'Open logs folder' },
  { kind: 'crash-reports', label: 'Open crash reports folder' },
  { kind: 'launcher', label: 'Open launcher folder' }
]

const AFTER_LAUNCH_HINTS: Record<LauncherSettings['afterLaunch'], string> = {
  'keep-open': 'The launcher stays open while you play.',
  minimize: 'The launcher minimizes while you play.',
  close: 'The launcher closes while you play. It comes back if the game crashes.'
}

export function SettingsView({
  info,
  settings,
  settingsLoaded,
  accounts,
  canRepair,
  onApplySettings,
  onRepair,
  onOpenFolder,
  onAddAccount,
  onSignOut,
  report
}: SettingsViewProps): JSX.Element {
  const [saved, flashSaved] = useFlash(1800)
  const latest = useRef(0)
  const disabled = !settingsLoaded
  const checkJava = useCallback(() => window.wave.settings.javaInfo(), [])

  /**
   * Saves a change right away. The main process may adjust values (it clamps them), so what it
   * returns replaces the local copy. Only the newest request's answer is applied. Never rejects.
   */
  const save = useCallback(
    async (patch: Partial<LauncherSettings>): Promise<LauncherSettings | null> => {
      const request = ++latest.current

      try {
        const result = await window.wave.settings.set(patch)

        if (request === latest.current) {
          onApplySettings(result)
          flashSaved()
        }

        return result
      } catch (error) {
        report(error)
        return null
      }
    },
    [flashSaved, onApplySettings, report]
  )

  return (
    <div className="view view--scroll settings">
      <div className="settings__inner">
        <header className="page-header page-header--sticky">
          <h1 className="page-title">Settings</h1>
          <p className={`saved${saved ? ' saved--visible' : ''}`} role="status">
            {saved && (
              <>
                <Icon name="check" size={14} />
                Saved
              </>
            )}
          </p>
        </header>

        <div className="settings__body">
          <SettingsSection id="game" title="Game">
            <MemorySetting memoryMb={settings.memoryMb} totalMemoryMb={info.totalMemoryMb} limits={info.memoryRangeMb} disabled={disabled} onSave={(memoryMb) => save({ memoryMb })} />
            <JavaSetting
              javaPath={settings.javaPath}
              disabled={disabled}
              onPick={() => window.wave.settings.pickJava()}
              onCheck={checkJava}
              onPicked={() => save({})}
              onReset={() => save({ javaPath: null })}
            />
            <JvmArgsSetting jvmArgs={settings.jvmArgs} disabled={disabled} onSave={(jvmArgs) => save({ jvmArgs })} />
          </SettingsSection>

          <SettingsSection id="window" title="Game window">
            <WindowSettings settings={settings} disabled={disabled} onSave={save} />
          </SettingsSection>

          <SettingsSection id="launcher" title="Launcher">
            <SettingRow id="after-launch" label="After launching" stacked description={AFTER_LAUNCH_HINTS[settings.afterLaunch]}>
              <SegmentedControl
                value={settings.afterLaunch}
                options={AFTER_LAUNCH_OPTIONS}
                disabled={disabled}
                labelledBy="after-launch-label"
                describedBy="after-launch-description"
                onChange={(afterLaunch) => void save({ afterLaunch })}
              />
            </SettingRow>
          </SettingsSection>

          <SettingsSection id="folders" title="Folders">
            <div className="folder-grid">
              {FOLDERS.map((folder) => (
                <Button key={folder.kind} variant="secondary" icon="folder" className="folder-grid__button" onClick={() => onOpenFolder(folder.kind)}>
                  {folder.label}
                </Button>
              ))}
            </div>
          </SettingsSection>

          <SettingsSection id="repair" title="Troubleshooting">
            <SettingRow
              id="repair-row"
              label="Repair game files"
              description={
                canRepair
                  ? 'Checks every game file, downloads any that are missing or damaged, and then starts Minecraft.'
                  : 'Checks every game file and starts Minecraft. Available when you are signed in and the game is not running.'
              }
            >
              <Button variant="secondary" icon="wrench" size="sm" disabled={!canRepair} onClick={onRepair}>
                Repair game files
              </Button>
            </SettingRow>
          </SettingsSection>

          <AccountsSection accounts={accounts} secureStorage={info.secureStorage} onAddAccount={onAddAccount} onSignOut={onSignOut} />

          <SettingsSection id="about" title="About">
            <dl className="about">
              <div className="about__row">
                <dt>Wave Client</dt>
                <dd>{info.version}</dd>
              </div>
              <div className="about__row">
                <dt>Minecraft</dt>
                <dd>{info.minecraftVersion} with Fabric</dd>
              </div>
            </dl>
            <p className="about__note">
              Minecraft is downloaded from Mojang's servers when you first play and is never bundled with Wave Client. Wave Client is not an official Minecraft
              product and is not associated with Mojang or Microsoft.
            </p>
          </SettingsSection>
        </div>
      </div>
    </div>
  )
}

interface AccountsSectionProps {
  accounts: AccountView[]
  secureStorage: boolean
  onAddAccount: () => void
  onSignOut: (account: AccountView) => void
}

function AccountsSection({ accounts, secureStorage, onAddAccount, onSignOut }: AccountsSectionProps): JSX.Element {
  const [confirming, setConfirming] = useState<AccountView | null>(null)

  return (
    <SettingsSection id="accounts" title="Accounts">
      {accounts.length === 0 ? (
        <SettingRow id="no-accounts" label="No accounts yet" description="Sign in with a Microsoft account that owns Minecraft: Java Edition." />
      ) : (
        <ul className="account-list">
          {accounts.map((account) => (
            <li key={account.id} className="account-list__item">
              <Avatar name={account.name} size={32} muted={account.status === 'expired'} />
              <div className="account-list__text">
                <p className="account-list__name">{account.name}</p>
                <p className={`account-list__status${account.status === 'expired' ? ' account-list__status--warn' : ''}`}>
                  {account.status === 'expired' ? 'Sign-in expired' : account.selected ? 'Selected' : 'Signed in'}
                </p>
              </div>
              <Button variant="ghost" size="sm" icon="signOut" onClick={() => setConfirming(account)} aria-label={`Sign out of ${account.name}`}>
                Sign out
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="settings-card__footer">
        <Button variant="secondary" size="sm" icon="plus" onClick={onAddAccount}>
          Add account
        </Button>
        {!secureStorage && (
          <p className="settings-card__note">Accounts won't be remembered after you close the launcher, because this system has no secure keychain.</p>
        )}
      </div>
      <ConfirmDialog
        open={confirming !== null}
        title={confirming ? `Sign out of ${confirming.name}?` : 'Sign out?'}
        confirmLabel="Sign out"
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const account = confirming
          setConfirming(null)

          if (account) {
            onSignOut(account)
          }
        }}
      >
        Wave Client will forget this account. You can sign in again at any time.
      </ConfirmDialog>
    </SettingsSection>
  )
}
