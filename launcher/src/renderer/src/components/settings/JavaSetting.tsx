import { useState, type JSX } from 'react'

import { errorMessage } from '../../lib/errors'
import { Button } from '../ui/Button'
import { SettingRow } from './SettingRow'

interface JavaSettingProps {
  javaPath: string | null
  disabled: boolean
  onPick: () => Promise<{ path: string; version: string } | null>
  onSave: (javaPath: string | null) => Promise<unknown>
}

/** The bundled Java (recommended), or a Java executable the player picks. */
export function JavaSetting({ javaPath, disabled, onPick, onSave }: JavaSettingProps): JSX.Element {
  const [picked, setPicked] = useState<{ path: string; version: string } | null>(null)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const version = picked && picked.path === javaPath ? picked.version : null

  const browse = (): void => {
    setPicking(true)
    setError(null)
    onPick()
      .then(async (result) => {
        if (result) {
          setPicked(result)
          await onSave(result.path)
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
              <p>Using your own Java{version ? `: Java ${version}` : ''}.</p>
              <p className="path mono" title={javaPath}>
                {javaPath}
              </p>
            </>
          )}
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </>
      }
    >
      <div className="button-row">
        {javaPath !== null && (
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => void onSave(null)}>
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
