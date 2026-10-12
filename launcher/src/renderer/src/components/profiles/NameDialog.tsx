import { useEffect, useId, useRef, useState, type JSX } from 'react'

import type { ProfileView } from '@shared/ipc'

import { errorMessage } from '../../lib/errors'
import { MAX_PROFILE_NAME, cleanProfileName, profileNameProblem } from '../../lib/profiles'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'

export interface NameDialogRequest {
  title: string
  confirmLabel: string
  /** The name the field starts with. */
  initialName: string
  /** A checkbox under the name (copy settings, include worlds), or none. */
  option?: { label: string; initial: boolean }
  /** The profile being renamed, so its own name doesn't count as taken. */
  exceptId?: string
  /** Does the work; a rejection is shown in the dialog and leaves it open. */
  run: (name: string, option: boolean) => Promise<unknown>
}

interface NameDialogProps {
  request: NameDialogRequest | null
  profiles: readonly ProfileView[]
  onClose: () => void
}

/** Asks for a profile name (New profile, Rename, Duplicate), checks it, and runs the action. */
export function NameDialog({ request, profiles, onClose }: NameDialogProps): JSX.Element {
  const [name, setName] = useState('')
  const [option, setOption] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The name problem shows only after a first try, so the field isn't red while it's being typed. */
  const [tried, setTried] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const errorId = useId()

  useEffect(() => {
    if (request) {
      setName(request.initialName)
      setOption(request.option?.initial ?? false)
      setBusy(false)
      setError(null)
      setTried(false)
      // After showModal() has focused the field: select the suggested name so typing replaces it.
      window.requestAnimationFrame(() => input.current?.select())
    }
  }, [request])

  const problem = request ? profileNameProblem(name, profiles, request.exceptId) : null
  const shownError = error ?? (tried ? problem : null)

  const submit = (): void => {
    if (!request || busy) {
      return
    }

    setTried(true)

    if (problem) {
      input.current?.focus()
      return
    }

    setBusy(true)
    setError(null)
    request
      .run(cleanProfileName(name), option)
      .then(onClose)
      .catch((reason: unknown) => {
        setError(errorMessage(reason))
        setBusy(false)
      })
  }

  return (
    <Dialog
      open={request !== null}
      title={request?.title ?? ''}
      onClose={onClose}
      onSubmit={submit}
      initialFocus={input}
      busy={busy}
      wide
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? 'Working…' : request?.confirmLabel}
          </Button>
        </>
      }
    >
      <div className="field">
        <label className="field__label" htmlFor={inputId}>
          Name
        </label>
        <input
          ref={input}
          id={inputId}
          className="input"
          type="text"
          value={name}
          maxLength={MAX_PROFILE_NAME + 20}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={shownError !== null || undefined}
          aria-describedby={shownError ? errorId : undefined}
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
          }}
        />
        {shownError && (
          <p id={errorId} className="field-error" role="alert">
            {shownError}
          </p>
        )}
      </div>
      {request?.option && (
        <label className="checkbox">
          <input type="checkbox" checked={option} onChange={(event) => setOption(event.target.checked)} />
          <span>{request.option.label}</span>
        </label>
      )}
    </Dialog>
  )
}
