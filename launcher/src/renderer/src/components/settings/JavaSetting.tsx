import { useEffect, useRef, useState, type JSX } from 'react'

import type { JavaStatus } from '@shared/ipc'

import { errorMessage } from '../../lib/errors'
import { Button } from '../ui/Button'
import { SettingRow } from './SettingRow'

interface JavaSettingProps {
  javaPath: string | null
  disabled: boolean
  /** Picks, checks and saves a Java (the main process does all three). */
  onPick: () => Promise<{ path: string; version: string } | null>
  /** Loads the settings as saved after a pick. */
  onPicked: () => Promise<unknown>
  /** Goes back to the bundled Java. */
  onReset: () => Promise<unknown>
  /** Checks the saved Java again. */
  onCheck: () => Promise<JavaStatus | null>
}

/** The bundled Java (recommended), or a Java executable the player picks. */
export function JavaSetting({ javaPath, disabled, onPick, onPicked, onReset, onCheck }: JavaSettingProps): JSX.Element {
  /** What the newest check or pick found; a pick counts as a fresh check. */
  const [status, setStatus] = useState<JavaStatus | null>(null)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Numbers checks and picks, so an older answer never replaces a newer one. */
  const latest = useRef(0)
  const checked = status && status.path === javaPath ? status : null

  // The saved Java may have been updated or removed since it was chosen.
  useEffect(() => {
    if (javaPath === null) {
      return
    }

    const request = ++latest.current
    onCheck()
      .then((result) => request === latest.current && setStatus(result))
      .catch(() => {})
  }, [javaPath, onCheck])

  const browse = (): void => {
    setPicking(true)
    setError(null)
    onPick()
      .then(async (result) => {
        if (result) {
          latest.current++
          setStatus({ path: result.path, version: result.version, problem: null })
          await onPicked()
        }
      })
      .catch((reason: unknown) => setError(errorMessage(reason, "That file couldn't be used as Java.")))
      .finally(() => setPicking(false))
  }

  return (
    <SettingRow
      id="java"
      label="Java"
      description={
        <>
          {javaPath === null ? (
            <p>Use the Java that comes with Wave Client (recommended).</p>
          ) : (
            <>
              <p>Using your own Java{checked?.version ? `: Java ${checked.version}` : ''}.</p>
              <p className="path mono" title={javaPath}>
                {javaPath}
              </p>
            </>
          )}
          {(error ?? checked?.problem) && (
            <p className="field-error" role="alert">
              {error ?? checked?.problem}
            </p>
          )}
        </>
      }
    >
      <div className="button-row">
        {javaPath !== null && (
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => void onReset()}>
            Use bundled Java
          </Button>
        )}
        <Button variant="secondary" size="sm" disabled={disabled || picking} onClick={browse}>
          Browse…
        </Button>
      </div>
    </SettingRow>
  )
}
