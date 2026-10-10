import { useEffect, useState, type JSX } from 'react'

import type { LauncherSettings } from '@shared/ipc'

import { parseDimension } from '../../lib/settings'
import { Switch } from '../ui/Switch'
import { SettingRow } from './SettingRow'

interface WindowSettingsProps {
  settings: LauncherSettings
  disabled: boolean
  onSave: (patch: Partial<LauncherSettings>) => Promise<LauncherSettings | null>
}

/** Fullscreen, or the size of the game window. */
export function WindowSettings({ settings, disabled, onSave }: WindowSettingsProps): JSX.Element {
  return (
    <>
      <SettingRow id="fullscreen" label="Fullscreen" description="Start Minecraft in fullscreen. You can always switch with F11.">
        <Switch
          checked={settings.fullscreen}
          disabled={disabled}
          labelledBy="fullscreen-label"
          describedBy="fullscreen-description"
          onChange={(fullscreen) => void onSave({ fullscreen })}
        />
      </SettingRow>
      <SettingRow
        id="window-size"
        label="Window size"
        description={settings.fullscreen ? 'Not used in fullscreen.' : 'The size of the game window when it opens, in pixels.'}
      >
        <div className="size-fields">
          <DimensionInput
            label="Width"
            value={settings.width}
            disabled={disabled || settings.fullscreen}
            onSave={(width) => onSave({ width }).then((saved) => saved?.width ?? null)}
          />
          <span className="size-fields__times" aria-hidden="true">
            ×
          </span>
          <DimensionInput
            label="Height"
            value={settings.height}
            disabled={disabled || settings.fullscreen}
            onSave={(height) => onSave({ height }).then((saved) => saved?.height ?? null)}
          />
        </div>
      </SettingRow>
    </>
  )
}

function DimensionInput({
  label,
  value,
  disabled,
  onSave
}: {
  label: string
  value: number
  disabled: boolean
  onSave: (value: number) => Promise<number | null>
}): JSX.Element {
  const [draft, setDraft] = useState(String(value))

  useEffect(() => setDraft(String(value)), [value])

  const apply = (): void => {
    const parsed = parseDimension(draft)

    if (parsed === null || parsed === value) {
      setDraft(String(value))
      return
    }

    // The main process keeps sizes in a sensible range; show what it saved.
    void onSave(parsed).then((saved) => setDraft(String(saved ?? value)))
  }

  return (
    <input
      className="input input--number"
      type="text"
      inputMode="numeric"
      aria-label={`${label} in pixels`}
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value.replace(/[^\d]/g, ''))}
      onBlur={apply}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          apply()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          setDraft(String(value))
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault()
          const current = parseDimension(draft) ?? value
          setDraft(String(Math.max(1, current + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 10 : 1))))
        }
      }}
    />
  )
}
