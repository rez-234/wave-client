import type { AccountView, SignInEvent, SignInMethod, SignInStep } from '@shared/ipc'

export interface DeviceCodePrompt {
  userCode: string
  verificationUri: string
  expiresAt: number
}

/** What the sign-in panel shows. */
export type SignInState =
  | { status: 'idle' }
  | {
      status: 'working'
      method: SignInMethod | null
      step: SignInStep
      /** Set while the browser has the Microsoft page open. */
      waitingForBrowser: boolean
      /** Set while the user should enter a code on another device. */
      deviceCode: DeviceCodePrompt | null
    }
  | { status: 'done'; account: AccountView }
  | {
      status: 'error'
      message: string
      detail: string | null
      helpUrl: string | null
      /** How the failed attempt signed in, so "Try again" can repeat it. */
      method: SignInMethod | null
    }

export type SignInAction =
  | { type: 'start'; method: SignInMethod }
  | { type: 'event'; event: SignInEvent }
  | { type: 'reset' }
  | { type: 'failed'; message: string }

export const IDLE: SignInState = { status: 'idle' }

export const SIGN_IN_STEPS: ReadonlyArray<{ step: SignInStep; label: string }> = [
  { step: 'microsoft', label: 'Microsoft' },
  { step: 'xbox', label: 'Xbox Live' },
  { step: 'minecraft', label: 'Minecraft' },
  { step: 'profile', label: 'Profile' }
]

function working(state: SignInState): Extract<SignInState, { status: 'working' }> {
  return state.status === 'working' ? state : { status: 'working', method: null, step: 'microsoft', waitingForBrowser: false, deviceCode: null }
}

function nonEmpty(value: string | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

export function signInReducer(state: SignInState, action: SignInAction): SignInState {
  switch (action.type) {
    case 'start':
      return { status: 'working', method: action.method, step: 'microsoft', waitingForBrowser: false, deviceCode: null }
    case 'reset':
      return IDLE
    case 'failed':
      return { status: 'error', message: action.message, detail: null, helpUrl: null, method: state.status === 'working' ? state.method : null }
    case 'event':
      return applyEvent(state, action.event)
  }
}

function applyEvent(state: SignInState, event: SignInEvent): SignInState {
  switch (event.kind) {
    case 'waiting-for-browser':
      return { ...working(state), step: 'microsoft', waitingForBrowser: true, deviceCode: null }
    case 'device-code':
      return {
        ...working(state),
        step: 'microsoft',
        waitingForBrowser: false,
        deviceCode: { userCode: event.userCode, verificationUri: event.verificationUri, expiresAt: event.expiresAt }
      }
    case 'progress': {
      const current = working(state)
      // Past the Microsoft step there is nothing left to do in the browser or with the code.
      return event.step === 'microsoft' ? { ...current, step: 'microsoft' } : { ...current, step: event.step, waitingForBrowser: false, deviceCode: null }
    }
    case 'done':
      return { status: 'done', account: event.account }
    case 'cancelled':
      return IDLE
    case 'error':
      return {
        status: 'error',
        message: nonEmpty(event.message) ?? 'Sign-in failed. Please try again.',
        detail: nonEmpty(event.detail),
        helpUrl: nonEmpty(event.helpUrl),
        method: state.status === 'working' ? state.method : null
      }
    default:
      return state
  }
}

export type StepStatus = 'done' | 'active' | 'pending'

/** Where a step stands relative to the current one. */
export function stepStatus(step: SignInStep, current: SignInStep): StepStatus {
  const index = SIGN_IN_STEPS.findIndex((s) => s.step === step)
  const currentIndex = SIGN_IN_STEPS.findIndex((s) => s.step === current)

  if (index < currentIndex) {
    return 'done'
  }

  return index === currentIndex ? 'active' : 'pending'
}

/** A verification link without the scheme, for the button: "microsoft.com/link". */
export function displayUrl(url: string): string {
  return url
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/$/, '')
}

/** What a screen reader hears as signing in moves along (errors are announced by their alert). */
export function signInAnnouncement(state: SignInState): string {
  switch (state.status) {
    case 'working': {
      if (state.deviceCode) {
        return `Enter the code ${state.deviceCode.userCode} at ${displayUrl(state.deviceCode.verificationUri)}`
      }

      if (state.waitingForBrowser) {
        return 'Finish signing in in your browser'
      }

      const label = SIGN_IN_STEPS.find((s) => s.step === state.step)?.label ?? state.step
      return `Signing in: ${label}`
    }
    case 'done':
      return `Signed in as ${state.account.name}`
    default:
      return ''
  }
}
