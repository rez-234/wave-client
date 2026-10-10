import { describe, expect, it } from 'vitest'

import type { AccountView, SignInEvent } from '@shared/ipc'

import { IDLE, displayUrl, signInAnnouncement, signInReducer, stepStatus, type SignInState } from './sign-in'

const run = (events: SignInEvent[], from: SignInState = IDLE): SignInState =>
  events.reduce<SignInState>((state, event) => signInReducer(state, { type: 'event', event }), from)

const account: AccountView = { id: '0123456789abcdef0123456789abcdef', name: 'Steve', selected: true, status: 'ok' }

describe('signInReducer', () => {
  it('starts working on the Microsoft step', () => {
    expect(signInReducer(IDLE, { type: 'start', method: 'browser' })).toEqual({
      status: 'working',
      method: 'browser',
      step: 'microsoft',
      waitingForBrowser: false,
      deviceCode: null
    })
  })

  it('follows the browser flow', () => {
    const started = signInReducer(IDLE, { type: 'start', method: 'browser' })
    const waiting = run([{ kind: 'progress', step: 'microsoft' }, { kind: 'waiting-for-browser' }], started)
    expect(waiting).toMatchObject({ status: 'working', method: 'browser', waitingForBrowser: true })

    const xbox = run([{ kind: 'progress', step: 'xbox' }], waiting)
    expect(xbox).toMatchObject({ status: 'working', step: 'xbox', waitingForBrowser: false })

    expect(run([{ kind: 'done', account }], xbox)).toEqual({ status: 'done', account })
  })

  it('keeps the device code until the Microsoft step is over', () => {
    const prompt = { kind: 'device-code', userCode: 'ABCD-EFGH', verificationUri: 'https://www.microsoft.com/link', expiresAt: 1000 } as const
    const state = run([{ kind: 'progress', step: 'microsoft' }, prompt, { kind: 'progress', step: 'microsoft' }])
    expect(state).toMatchObject({ status: 'working', deviceCode: { userCode: 'ABCD-EFGH' } })
    expect(run([{ kind: 'progress', step: 'minecraft' }], state)).toMatchObject({ step: 'minecraft', deviceCode: null })
  })

  it('goes back to idle when cancelled', () => {
    expect(run([{ kind: 'waiting-for-browser' }, { kind: 'cancelled' }])).toBe(IDLE)
  })

  it('keeps error details, dropping empty ones', () => {
    expect(run([{ kind: 'error', message: 'No Xbox profile.', detail: 'XErr 2148916233', helpUrl: 'https://www.minecraft.net/en-us/login' }])).toEqual({
      status: 'error',
      message: 'No Xbox profile.',
      detail: 'XErr 2148916233',
      helpUrl: 'https://www.minecraft.net/en-us/login',
      method: null
    })
    expect(run([{ kind: 'error', message: '', detail: '' }])).toEqual({
      status: 'error',
      message: 'Sign-in failed. Please try again.',
      detail: null,
      helpUrl: null,
      method: null
    })
  })

  it('remembers the method of a failed attempt', () => {
    const started = signInReducer(IDLE, { type: 'start', method: 'device-code' })
    expect(run([{ kind: 'error', message: 'Expired' }], started)).toMatchObject({ status: 'error', method: 'device-code' })
    expect(signInReducer(started, { type: 'failed', message: 'Refused' })).toMatchObject({ status: 'error', method: 'device-code' })
  })

  it('handles a failed call and a reset', () => {
    expect(signInReducer(IDLE, { type: 'failed', message: 'Nope' })).toEqual({ status: 'error', message: 'Nope', detail: null, helpUrl: null, method: null })
    expect(signInReducer({ status: 'done', account }, { type: 'reset' })).toBe(IDLE)
  })
})

describe('stepStatus', () => {
  it('marks earlier steps done and later ones pending', () => {
    expect(stepStatus('microsoft', 'minecraft')).toBe('done')
    expect(stepStatus('minecraft', 'minecraft')).toBe('active')
    expect(stepStatus('profile', 'minecraft')).toBe('pending')
  })
})

describe('displayUrl', () => {
  it('drops the scheme, www and a trailing slash', () => {
    expect(displayUrl('https://www.microsoft.com/link')).toBe('microsoft.com/link')
    expect(displayUrl('https://microsoft.com/devicelogin/')).toBe('microsoft.com/devicelogin')
  })
})

describe('signInAnnouncement', () => {
  const started = signInReducer(IDLE, { type: 'start', method: 'browser' })

  it('says what to do next', () => {
    expect(signInAnnouncement(started)).toBe('Signing in: Microsoft')
    expect(signInAnnouncement(run([{ kind: 'waiting-for-browser' }], started))).toBe('Finish signing in in your browser')
    expect(
      signInAnnouncement(run([{ kind: 'device-code', userCode: 'AB12-CD34', verificationUri: 'https://www.microsoft.com/link', expiresAt: 0 }], started))
    ).toBe('Enter the code AB12-CD34 at microsoft.com/link')
    expect(signInAnnouncement(run([{ kind: 'progress', step: 'xbox' }], started))).toBe('Signing in: Xbox Live')
    expect(signInAnnouncement({ status: 'done', account })).toBe('Signed in as Steve')
  })

  it('stays quiet when idle or failed', () => {
    expect(signInAnnouncement(IDLE)).toBe('')
    expect(signInAnnouncement(run([{ kind: 'error', message: 'Nope' }]))).toBe('')
  })
})
