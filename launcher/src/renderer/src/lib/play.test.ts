import { describe, expect, it } from 'vitest'

import type { AccountView, CrashSummary } from '@shared/ipc'

import { crashDetailsText, exitNote, playButtonModel, suspectName } from './play'

const ok: AccountView = { id: 'a'.repeat(32), name: 'Steve', selected: true, status: 'ok' }
const expired: AccountView = { ...ok, status: 'expired' }

describe('playButtonModel', () => {
  it('can play when idle with a working account', () => {
    expect(playButtonModel('idle', ok, false)).toEqual({ label: 'Play', action: 'play', disabled: false, hint: null })
    expect(playButtonModel('exited', ok, false).disabled).toBe(false)
    expect(playButtonModel('crashed', ok, false).disabled).toBe(false)
    expect(playButtonModel('failed', ok, false).disabled).toBe(false)
  })

  it('asks to sign in again when the account expired', () => {
    expect(playButtonModel('idle', expired, false)).toMatchObject({ label: 'Sign in again', action: 'sign-in', disabled: false })
  })

  it('is disabled without an account', () => {
    expect(playButtonModel('idle', null, false)).toMatchObject({ disabled: true })
  })

  it('is disabled while launching, preparing, starting or running', () => {
    expect(playButtonModel('idle', ok, true)).toMatchObject({ label: 'Preparing…', disabled: true })
    expect(playButtonModel('downloading', ok, false)).toMatchObject({ disabled: true })
    expect(playButtonModel('starting', ok, true)).toMatchObject({ label: 'Starting…', disabled: true })
    expect(playButtonModel('running', expired, false)).toMatchObject({ label: 'Playing', disabled: true })
  })
})

describe('crash details', () => {
  const crash: CrashSummary = {
    reason: 'Mixin apply failed',
    reportPath: '/game/crash-reports/crash.txt',
    jvmErrorPath: null,
    suspectedMods: [
      { id: 'sodium', name: 'Sodium', file: 'sodium-0.6.jar', reason: 'In the stack trace' },
      { id: 'lithium', reason: 'Named in the crash report' }
    ],
    lastLines: ['[12:00:00] [Render thread/ERROR]: Boom']
  }

  it('names suspects by name, falling back to the id', () => {
    expect(suspectName({ id: 'x', name: '  ', reason: '' })).toBe('x')
    expect(suspectName({ id: 'x', name: 'Xaero', reason: '' })).toBe('Xaero')
  })

  it('includes the reason, suspects and last lines', () => {
    const text = crashDetailsText(crash, '1.21.11', '0.1.0')
    expect(text).toContain('Minecraft 1.21.11 crashed (Wave Client 0.1.0)')
    expect(text).toContain('Reason: Mixin apply failed')
    expect(text).toContain('- Sodium (sodium) [sodium-0.6.jar]: In the stack trace')
    expect(text).toContain('- lithium: Named in the crash report')
    expect(text).toContain('Last output:\n[12:00:00] [Render thread/ERROR]: Boom')
  })

  it('leaves out empty sections', () => {
    const text = crashDetailsText({ ...crash, suspectedMods: [], lastLines: [] }, '1.21.11', '0.1.0')
    expect(text).not.toContain('Suspected')
    expect(text).not.toContain('Last output')
  })
})

describe('exitNote', () => {
  it('says a normal exit ended normally', () => {
    expect(exitNote({ phase: 'exited', exitCode: 0 })).toEqual({ text: 'Last session ended normally', normal: true })
    expect(exitNote({ phase: 'exited' })).toEqual({ text: 'Last session ended normally', normal: true })
  })

  it('says a forced quit was a forced quit', () => {
    expect(exitNote({ phase: 'exited', exitCode: 143, closedByLauncher: true })).toEqual({ text: 'Minecraft was closed from the launcher', normal: false })
    expect(exitNote({ phase: 'exited', exitCode: null, closedByLauncher: true })).toEqual({ text: 'Minecraft was closed from the launcher', normal: false })
  })

  it('is empty outside the exited phase', () => {
    expect(exitNote({ phase: 'idle' })).toBeNull()
    expect(exitNote({ phase: 'crashed', exitCode: 1 })).toBeNull()
  })
})
