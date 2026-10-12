import { describe, expect, it } from 'vitest'

import type { AccountView, CrashSummary, ModView } from '@shared/ipc'

import { crashDetailsText, crashTitle, exitNote, failedTitle, matchSuspects, modProblemsTitle, playButtonModel, suspectName } from './play'

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

describe('matchSuspects', () => {
  const mod = (key: string, patch: Partial<ModView> = {}): ModView => ({
    key,
    file: key,
    enabled: true,
    loads: true,
    id: null,
    provides: [],
    name: key,
    version: null,
    description: null,
    authors: [],
    hasIcon: false,
    size: 0,
    neededBy: [],
    problems: [],
    ...patch
  })
  const mods = [
    mod('sodium-old.jar', { id: 'sodium', loads: false }),
    mod('sodium-new.jar', { id: 'sodium' }),
    mod('iris.jar', { id: 'iris', provides: ['oculus'] }),
    mod('lithium.jar', { id: 'lithium', enabled: false })
  ]

  it('matches by file, then id, then a provided id', () => {
    const matches = matchSuspects(
      [
        { id: 'whatever', file: 'lithium.jar', reason: '' },
        { id: 'oculus', reason: '' },
        { id: 'fabric-api', reason: '' }
      ],
      mods
    )
    expect(matches.map((m) => m.mod?.key ?? null)).toEqual(['lithium.jar', 'iris.jar', null])
  })

  it('prefers the copy that loads and matches each mod once', () => {
    const matches = matchSuspects(
      [
        { id: 'sodium', reason: '' },
        { id: 'sodium', name: 'Sodium again', reason: '' }
      ],
      mods
    )
    expect(matches.map((m) => m.mod?.key ?? null)).toEqual(['sodium-new.jar', 'sodium-old.jar'])
    expect(matchSuspects([{ id: 'iris', reason: '' }, { id: 'oculus', reason: '' }], mods).map((m) => m.mod?.key ?? null)).toEqual(['iris.jar', null])
  })

  it('matches nothing without a report', () => {
    expect(matchSuspects([{ id: 'sodium', reason: '' }], null)).toEqual([{ suspect: { id: 'sodium', reason: '' }, mod: null }])
  })
})

describe('card titles', () => {
  it('names the profile', () => {
    expect(modProblemsTitle(3, 'PvP')).toBe('3 mods in PvP have problems')
    expect(modProblemsTitle(1, 'PvP')).toBe('1 mod in PvP has a problem')
    expect(modProblemsTitle(2, null)).toBe('2 mods have problems')
    expect(crashTitle({ profile: { id: 'pvp', name: 'PvP' } })).toBe('PvP crashed')
    expect(crashTitle({})).toBe('Minecraft crashed')
    expect(failedTitle({ profile: { id: 'pvp', name: 'PvP' } })).toBe("PvP couldn't start")
    expect(failedTitle({})).toBe("Couldn't start Minecraft")
  })
})
