import { useCallback, useEffect, useReducer } from 'react'

import type { SignInMethod } from '@shared/ipc'

import { errorMessage } from '../lib/errors'
import { IDLE, signInReducer, type SignInState } from '../lib/sign-in'

export interface SignInApi {
  state: SignInState
  start: (method: SignInMethod) => void
  /** Stops a sign-in in progress (or just clears an error) and goes back to the start. */
  cancel: () => void
  reset: () => void
}

/** The sign-in flow: starts it and follows the main process's sign-in events. */
export function useSignIn(report: (error: unknown) => void): SignInApi {
  const [state, dispatch] = useReducer(signInReducer, IDLE)

  useEffect(() => {
    if (!('wave' in window)) {
      return
    }

    return window.wave.accounts.onSignIn((event) => dispatch({ type: 'event', event }))
  }, [])

  const start = useCallback((method: SignInMethod) => {
    dispatch({ type: 'start', method })
    // The call settles when signing in ends; how it went arrives as events. A rejection means
    // the request itself was refused.
    window.wave.accounts
      .signIn(method)
      .catch((error: unknown) => dispatch({ type: 'failed', message: errorMessage(error, "Couldn't start signing in. Please try again.") }))
  }, [])

  const cancel = useCallback(() => {
    if (state.status === 'working') {
      window.wave.accounts.cancelSignIn().catch(report)
    }

    dispatch({ type: 'reset' })
  }, [report, state.status])

  const reset = useCallback(() => dispatch({ type: 'reset' }), [])

  return { state, start, cancel, reset }
}
