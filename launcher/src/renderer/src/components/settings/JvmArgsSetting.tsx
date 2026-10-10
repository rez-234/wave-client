import { useEffect, useRef, useState, type JSX } from 'react'

import type { LauncherSettings } from '@shared/ipc'

import { SettingRow } from './SettingRow'

interface JvmArgsSettingProps {
  jvmArgs: string
  disabled: boolean
  onSave: (jvmArgs: string) => Promise<LauncherSettings | null>
}

/** Extra arguments for Java, applied when the field loses focus or on Enter. Escape undoes the edit. */
export function JvmArgsSetting({ jvmArgs, disabled, onSave }: JvmArgsSettingProps): JSX.Element {
  const [draft, setDraft] = useState(jvmArgs)
  /** A save is under way (the main process may be asking the player to confirm). */
  const saving = useRef(false)

  useEffect(() => setDraft(jvmArgs), [jvmArgs])

  const apply = (): void => {
    if (saving.current || draft === jvmArgs) {
      return
    }

    saving.current = true
    // Show what was saved (the main process may shorten it), or the old value if saving failed.
    void onSave(draft)
      .then((saved) => setDraft(saved ? saved.jvmArgs : jvmArgs))
      .finally(() => {
        saving.current = false
      })
  }

  return (
    <SettingRow
      id="jvm-args"
      htmlFor="jvm-args-input"
      label="Extra JVM arguments"
      stacked
      description="For advanced users. Added to the Java command line, separated by spaces. Press Enter to apply."
    >
      <input
        id="jvm-args-input"
        className="input mono"
        type="text"
        value={draft}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        placeholder="-XX:+UseZGC"
        aria-describedby="jvm-args-description"
        onChange={(event) => setDraft(event.target.value)}
        // Losing focus to another window (or to the confirmation dialog) isn't leaving the field.
        onBlur={() => {
          if (document.hasFocus()) {
            apply()
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            apply()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            setDraft(jvmArgs)
          }
        }}
      />
    </SettingRow>
  )
}
