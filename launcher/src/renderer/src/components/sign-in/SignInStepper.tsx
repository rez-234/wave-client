import type { JSX } from 'react'

import type { SignInStep } from '@shared/ipc'

import { SIGN_IN_STEPS, stepStatus } from '../../lib/sign-in'
import { Icon } from '../ui/Icon'

const STATUS_TEXT = { done: 'done', active: 'in progress', pending: 'not started' } as const

/** Microsoft → Xbox Live → Minecraft → Profile, with the current step highlighted. */
export function SignInStepper({ current }: { current: SignInStep }): JSX.Element {
  return (
    <ol className="stepper" aria-label="Sign-in steps">
      {SIGN_IN_STEPS.map(({ step, label }) => {
        const status = stepStatus(step, current)
        return (
          <li key={step} className={`stepper__step stepper__step--${status}`} aria-current={status === 'active' ? 'step' : undefined}>
            <span className="stepper__dot" aria-hidden="true">
              {status === 'done' && <Icon name="check" size={10} />}
            </span>
            <span className="stepper__label">{label}</span>
            <span className="visually-hidden">({STATUS_TEXT[status]})</span>
          </li>
        )
      })}
    </ol>
  )
}
