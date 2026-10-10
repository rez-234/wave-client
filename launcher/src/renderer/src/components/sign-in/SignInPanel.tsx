import type { JSX } from 'react'

import type { AppInfo, SignInMethod } from '@shared/ipc'

import { signInAnnouncement, type SignInState } from '../../lib/sign-in'
import { Alert } from '../ui/Alert'
import { Button } from '../ui/Button'
import { LogoMark } from '../ui/Logo'
import { Spinner } from '../ui/Spinner'
import { DeviceCode } from './DeviceCode'
import { SignInStepper } from './SignInStepper'

interface SignInPanelProps {
  info: AppInfo
  state: SignInState
  /** True when adding another account (or signing in again), so there's somewhere to go back to. */
  canClose: boolean
  /** The name of an expired account being signed in again, for the heading. */
  reauthName: string | null
  onStart: (method: SignInMethod) => void
  onCancel: () => void
  onClose: () => void
  onOpenExternal: (url: string) => void
  onCopy: (text: string) => void
  copied: boolean
}

/** Signing in with a Microsoft account: choose a method, then follow the steps. */
export function SignInPanel({ info, state, canClose, reauthName, onStart, onCancel, onClose, onOpenExternal, onCopy, copied }: SignInPanelProps): JSX.Element {
  const title = reauthName ? `Sign in again as ${reauthName}` : canClose ? 'Add an account' : 'Sign in to play'

  return (
    <div className="sign-in">
      <section className="card sign-in__card" aria-labelledby="sign-in-title">
        <LogoMark size={40} />
        <h1 id="sign-in-title" className="sign-in__title">
          {title}
        </h1>
        <p className="visually-hidden" role="status">
          {signInAnnouncement(state)}
        </p>

        {state.status === 'idle' && <SignInChoice info={info} canClose={canClose} reauthName={reauthName} onStart={onStart} onClose={onClose} />}

        {state.status === 'working' && (
          <div className="sign-in__working">
            {state.deviceCode ? (
              <DeviceCode prompt={state.deviceCode} onOpen={onOpenExternal} onCopy={onCopy} copied={copied} />
            ) : state.waitingForBrowser ? (
              <div className="sign-in__status">
                <Spinner size={18} />
                <div>
                  <p className="sign-in__status-title">Finish signing in in your browser</p>
                  <p className="muted">A Microsoft sign-in page opened in your browser. Come back here when you're done.</p>
                </div>
              </div>
            ) : (
              <div className="sign-in__status">
                <Spinner size={18} />
                <p className="sign-in__status-title">{state.step === 'microsoft' ? 'Connecting to Microsoft…' : 'Finishing signing in…'}</p>
              </div>
            )}
            <SignInStepper current={state.step} />
            <div className="sign-in__actions">
              <Button variant="secondary" onClick={onCancel}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {state.status === 'done' && (
          <div className="sign-in__status">
            <Spinner size={18} />
            <p className="sign-in__status-title">Signed in as {state.account.name}</p>
          </div>
        )}

        {state.status === 'error' && (
          <div className="sign-in__error">
            <Alert tone="danger" title="Couldn't sign in">
              <p>{state.message}</p>
            </Alert>
            {state.detail && (
              <details className="disclosure">
                <summary>Details</summary>
                <pre className="disclosure__body mono">{state.detail}</pre>
              </details>
            )}
            <div className="sign-in__actions">
              {state.helpUrl && (
                <Button variant="ghost" trailingIcon="external" className="sign-in__learn-more" onClick={() => state.helpUrl && onOpenExternal(state.helpUrl)}>
                  Learn more
                </Button>
              )}
              <Button variant="secondary" onClick={canClose ? onClose : onCancel}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => (state.method ? onStart(state.method) : onCancel())}>
                Try again
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

interface SignInChoiceProps {
  info: AppInfo
  canClose: boolean
  reauthName: string | null
  onStart: (method: SignInMethod) => void
  onClose: () => void
}

function SignInChoice({ info, canClose, reauthName, onStart, onClose }: SignInChoiceProps): JSX.Element {
  const available = info.signInAvailable

  return (
    <>
      <p className="sign-in__lead">
        {reauthName
          ? 'Your saved sign-in no longer works. Sign in with the same Microsoft account to keep playing.'
          : 'You need a Microsoft account that owns Minecraft: Java Edition.'}
      </p>

      {!available && (
        <Alert tone="warn" className="sign-in__notice">
          This build has no Microsoft app ID configured, so signing in isn't possible yet.
        </Alert>
      )}

      <div className="sign-in__buttons">
        <Button variant="primary" size="lg" disabled={!available} onClick={() => onStart('browser')}>
          Sign in with Microsoft
        </Button>
        <Button variant="secondary" disabled={!available} onClick={() => onStart('device-code')}>
          Use a code instead
        </Button>
        {canClose && (
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        )}
      </div>

      {!info.secureStorage && (
        <p className="sign-in__footnote">Your system has no secure keychain, so accounts won't be remembered after you close the launcher.</p>
      )}
    </>
  )
}
