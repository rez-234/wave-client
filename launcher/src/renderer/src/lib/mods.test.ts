import { describe, expect, it } from 'vitest'

import type { AddModsResult, ModProblem, ModView, ModsReport } from '@shared/ipc'

import {
  addResultToast,
  blockingSignature,
  blockingSummary,
  canTurnOffAndPlay,
  compareModVersions,
  folderNote,
  modStateText,
  modsWithErrors,
  problemsChipLabel,
  turnOffModsWithErrors,
  turnOffOutcome,
  turnOffQuestion,
  matchesModQuery,
  modrinthSearchUrl,
  modsSummary,
  modsToTurnOff,
  neededByText,
  orderedProblems,
  problemModCount,
  sameReport,
  skipText,
  sortMods,
  updateText,
  visibleMods
} from './mods'

const error: ModProblem = { severity: 'error', code: 'missing', message: 'Needs cloth-config.', modId: 'cloth-config' }
const warning: ModProblem = { severity: 'warning', code: 'duplicate', message: 'Not used: Sodium 0.6.13 loads instead.' }

const mod = (key: string, patch: Partial<ModView> = {}): ModView => ({
  key,
  file: key,
  enabled: true,
  loads: true,
  id: key.replace(/\.jar$/, ''),
  provides: [],
  name: key.replace(/\.jar$/, ''),
  version: '1.0.0',
  description: null,
  authors: [],
  hasIcon: false,
  size: 1000,
  neededBy: [],
  problems: [],
  ...patch
})

const report = (mods: ModView[]): ModsReport => ({
  profileId: 'pvp',
  gameVersion: '1.21.11',
  folder: 'ok',
  mods,
  included: [],
  profileProblems: [],
  errors: 0,
  warnings: 0
})

describe('sorting and filtering', () => {
  const mods = [
    mod('sodium-0.6.13.jar', { name: 'Sodium' }),
    mod('iris.jar', { name: 'Iris Shaders', authors: ['coderbot'] }),
    mod('cloth.jar', { name: 'cloth Config', id: 'cloth-config', problems: [error] }),
    mod('sodium-0.6.10.jar', { name: 'Sodium', problems: [warning], enabled: false })
  ]

  it('sorts by name ignoring case, then by key', () => {
    expect(sortMods(mods).map((m) => m.key)).toEqual(['cloth.jar', 'iris.jar', 'sodium-0.6.10.jar', 'sodium-0.6.13.jar'])
  })

  it('puts numbers in numeric order', () => {
    expect(sortMods([mod('b', { name: 'Mod 10' }), mod('a', { name: 'Mod 9' })]).map((m) => m.name)).toEqual(['Mod 9', 'Mod 10'])
  })

  it('does not move rows with problems to the top', () => {
    expect(visibleMods(mods, '', false)[0]?.key).toBe('cloth.jar')
    expect(visibleMods(mods, '', false).at(-1)?.key).toBe('sodium-0.6.13.jar')
  })

  it('searches names, ids, file names and authors', () => {
    expect(matchesModQuery(mods[1]!, 'IRIS')).toBe(true)
    expect(matchesModQuery(mods[1]!, 'coderbot')).toBe(true)
    expect(matchesModQuery(mods[2]!, 'cloth-config')).toBe(true)
    expect(matchesModQuery(mods[0]!, '0.6.13')).toBe(true)
    expect(matchesModQuery(mods[0]!, 'lithium')).toBe(false)
    expect(matchesModQuery(mods[0]!, '   ')).toBe(true)
  })

  it('shows only mods with problems when filtered', () => {
    expect(visibleMods(mods, '', true).map((m) => m.key)).toEqual(['cloth.jar', 'sodium-0.6.10.jar'])
    expect(visibleMods(mods, 'sodium', true).map((m) => m.key)).toEqual(['sodium-0.6.10.jar'])
    expect(problemModCount(mods)).toBe(2)
  })

  it('lists errors before warnings', () => {
    expect(orderedProblems([warning, error]).map((p) => p.severity)).toEqual(['error', 'warning'])
  })
})

describe('modsSummary', () => {
  it('counts mods and how many are on', () => {
    expect(modsSummary([]).text).toBe('No mods yet')
    expect(modsSummary([mod('a')]).text).toBe('1 mod, turned on')
    expect(modsSummary([mod('a', { enabled: false })]).text).toBe('1 mod, turned off')
    expect(modsSummary([mod('a'), mod('b')]).text).toBe('2 mods, all turned on')
    expect(modsSummary([mod('a', { enabled: false }), mod('b', { enabled: false })]).text).toBe('2 mods, all turned off')
    expect(modsSummary([mod('a'), mod('b', { enabled: false }), mod('c')]).text).toBe('3 mods, 2 turned on')
  })

  it('counts mods with errors and mods with only warnings', () => {
    const summary = modsSummary([mod('a', { problems: [error, warning] }), mod('b', { problems: [error] }), mod('c', { problems: [warning] }), mod('d')])
    expect(summary.errors).toBe('2 mods would stop Minecraft from starting')
    expect(summary.warnings).toBe('1 mod with warnings')
    expect(modsSummary([mod('a')])).toMatchObject({ errors: null, warnings: null })
  })
})

describe('neededByText', () => {
  it('names one, two, or the first and a count', () => {
    expect(neededByText('Cloth Config', [])).toBe('')
    expect(neededByText('Cloth Config', ['Mod Menu'])).toBe('Mod Menu needs Cloth Config.')
    expect(neededByText('Sodium', ['Iris Shaders', 'Sodium Extra'])).toBe('Iris Shaders and Sodium Extra need Sodium.')
    expect(neededByText('Cloth Config', ['Mod Menu', 'Xaero', 'Roughly Enough Items'])).toBe('Mod Menu and 2 others need Cloth Config.')
  })
})

describe('modsToTurnOff', () => {
  it('picks turned-on mods with errors, not warnings or turned-off ones', () => {
    const r = report([mod('b', { problems: [error] }), mod('a', { problems: [error] }), mod('c', { problems: [warning] }), mod('d', { enabled: false, problems: [error] })])
    expect(modsToTurnOff(r).map((m) => m.key)).toEqual(['a', 'b'])
  })
})

describe('helpers', () => {
  it('builds the Modrinth search link from the id only', () => {
    expect(modrinthSearchUrl('cloth-config')).toBe('https://modrinth.com/mods?q=cloth-config')
    expect(modrinthSearchUrl('a b&c')).toBe('https://modrinth.com/mods?q=a%20b%26c')
  })

  it('compares reports by content', () => {
    const a = report([mod('a')])
    expect(sameReport(a, report([mod('a')]))).toBe(true)
    expect(sameReport(a, report([mod('a', { enabled: false })]))).toBe(false)
    expect(sameReport(null, null)).toBe(true)
    expect(sameReport(a, null)).toBe(false)
  })

  it('compares versions by their leading numbers', () => {
    expect(compareModVersions('0.6.13+mc1.21.11', '0.6.10+mc1.21.11')).toBe(1)
    expect(compareModVersions('0.6.9', '0.6.10')).toBe(-1)
    expect(compareModVersions('1.0', '1.0.0')).toBe(0)
    expect(compareModVersions('v2.1', '2.0')).toBe(1)
    expect(compareModVersions('beta', '1.0')).toBe(0)
  })
})

describe('add result toast', () => {
  const added = (name: string, version: string | null, replaced?: string | null): AddModsResult['added'][number] => ({
    key: `${name}.jar`,
    name,
    version,
    ...(replaced !== undefined ? { replaced: { version: replaced } } : {})
  })

  it('describes updates', () => {
    expect(updateText(added('Sodium', '0.6.13', '0.6.10'))).toBe('Updated Sodium 0.6.10 → 0.6.13')
    expect(updateText(added('Sodium', '0.6.10', '0.6.13'))).toBe('Replaced Sodium 0.6.13 with older 0.6.10')
    expect(updateText(added('Sodium', '0.6.13', '0.6.13'))).toBe('Replaced Sodium 0.6.13')
    expect(updateText(added('Sodium', '0.6.13', null))).toBe('Updated Sodium')
  })

  it('names the file in a skip reason unless the message does', () => {
    expect(skipText({ name: 'OptiFine.jar', reason: 'not-fabric', message: 'OptiFine.jar is a Forge mod.' })).toBe('OptiFine.jar is a Forge mod.')
    expect(skipText({ name: 'pack.zip', reason: 'resource-pack', message: 'This is a resource pack.' })).toBe('pack.zip: This is a resource pack.')
  })

  it('is empty when nothing happened', () => {
    expect(addResultToast({ added: [], skipped: [] }, 'PvP', false)).toBeNull()
  })

  it('summarizes added, updated and skipped files', () => {
    const toast = addResultToast(
      {
        added: [added('Lithium', '0.15.0'), added('Iris', '1.8.12'), added('Sodium', '0.6.13', '0.6.10')],
        skipped: [{ name: 'OptiFine.jar', reason: 'not-fabric', message: 'OptiFine.jar is a Forge mod.' }]
      },
      'PvP',
      false
    )
    expect(toast).toEqual({
      tone: 'warn',
      title: 'Added 2 mods to PvP',
      lines: ['Updated Sodium 0.6.10 → 0.6.13', '1 file skipped:', 'OptiFine.jar is a Forge mod.']
    })
  })

  it('names a single mod', () => {
    expect(addResultToast({ added: [added('Lithium', '0.15.0')], skipped: [] }, 'PvP', false)).toEqual({ tone: 'success', title: 'Added Lithium to PvP', lines: [] })
    expect(addResultToast({ added: [added('Sodium', '0.6.13', '0.6.10')], skipped: [] }, 'PvP', false)?.title).toBe('Updated Sodium 0.6.10 → 0.6.13 in PvP')
  })

  it('lists several updates', () => {
    const toast = addResultToast({ added: [added('Sodium', '0.6.13', '0.6.10'), added('Iris', '1.8.12', '1.8.11')], skipped: [] }, 'PvP', false)
    expect(toast?.title).toBe('Updated 2 mods in PvP')
    expect(toast?.lines).toEqual(['Updated Sodium 0.6.10 → 0.6.13', 'Updated Iris 1.8.11 → 1.8.12'])
  })

  it('explains when nothing was added, and caps the list', () => {
    const skip = (n: number) => ({ name: `f${n}.jar`, reason: 'unreadable' as const, message: "This file isn't a readable mod." })
    const one = addResultToast({ added: [], skipped: [{ name: 'Sodium', reason: 'already-installed', message: 'Sodium 0.6.13 is already installed.' }] }, 'PvP', false)
    expect(one).toEqual({ tone: 'warn', title: 'Nothing was added to PvP', lines: ['Sodium 0.6.13 is already installed.'] })
    const many = addResultToast({ added: [], skipped: [skip(1), skip(2), skip(3), skip(4), skip(5)] }, 'PvP', false)
    expect(many?.title).toBe('None of the 5 files were added to PvP')
    expect(many?.lines).toHaveLength(4)
    expect(many?.lines.at(-1)).toBe('And 2 other files.')
  })

  it('says when the change waits for the next launch', () => {
    expect(addResultToast({ added: [added('Lithium', '0.15.0')], skipped: [] }, 'PvP', true)?.lines).toEqual(['Takes effect next time you play.'])
  })
})

describe('turning mods off', () => {
  it('asks before turning off a mod others need', () => {
    expect(turnOffQuestion({ name: 'Cloth Config', neededBy: ['Mod Menu', 'Iris', 'Sodium'] })).toBe('Mod Menu and 2 others need Cloth Config. Turn it off anyway?')
    expect(turnOffQuestion({ name: 'Cloth Config', neededBy: [] })).toBeNull()
  })

  it('turns off mods with errors, then the ones that break because of it', async () => {
    // b needs a; c is broken. Turning c off breaks nothing; a has an error and once it's off, b does.
    let mods = [mod('a.jar', { problems: [error] }), mod('b.jar'), mod('c.jar', { problems: [error] }), mod('d.jar', { problems: [warning] })]
    const calls: string[] = []
    const setEnabled = async (key: string, enabled: boolean): Promise<ModsReport> => {
      calls.push(`${key}:${enabled}`)
      mods = mods.map((m) => (m.key === key ? { ...m, enabled, problems: [] } : m))
      if (key === 'a.jar') mods = mods.map((m) => (m.key === 'b.jar' ? { ...m, problems: [error] } : m))
      return report(mods)
    }
    const result = await turnOffModsWithErrors(report(mods), setEnabled)
    expect(calls).toEqual(['a.jar:false', 'c.jar:false', 'b.jar:false'])
    expect(result.turnedOff).toEqual(['a', 'c', 'b'])
    expect(modsWithErrors(result.report)).toBe(0)
  })

  it('stops after a few rounds when turning off never settles', async () => {
    let n = 0
    const setEnabled = async (): Promise<ModsReport> => report([mod(`m${n++}.jar`, { problems: [error] })])
    const result = await turnOffModsWithErrors(report([mod('m.jar', { problems: [error] })]), setEnabled)
    expect(result.turnedOff).toHaveLength(5)
  })
})

describe('after turning mods off', () => {
  const profileError: ModProblem = { severity: 'error', code: 'unreadable', message: 'Bad overrides file.' }

  it('plays when mods were turned off and the profile is still the one shown', () => {
    const outcome = turnOffOutcome({ report: report([]), turnedOff: ['a', 'b'] }, 'PvP', true)
    expect(outcome.launch).toBe(true)
    expect(outcome.toast).toEqual({ tone: 'success', title: 'Turned off 2 mods in PvP', lines: ['a', 'b'] })
  })

  it("doesn't play another profile when the player switched profiles meanwhile", () => {
    const outcome = turnOffOutcome({ report: report([]), turnedOff: ['a'] }, 'PvP', false)
    expect(outcome.launch).toBe(false)
    expect(outcome.toast?.title).toBe('Turned off 1 mod in PvP')
  })

  it("doesn't play again when only the profile's own problems are left", () => {
    const left = { ...report([]), profileProblems: [profileError], errors: 1 }
    const outcome = turnOffOutcome({ report: left, turnedOff: [] }, 'PvP', true)
    expect(outcome.launch).toBe(false)
    expect(outcome.toast).toEqual({
      tone: 'warn',
      title: 'No mods to turn off in PvP',
      lines: ["The problems left are with the profile itself, not a mod. Review mods to see them, or choose Play anyway."]
    })
  })

  it('plays when there was nothing left to turn off and nothing stops the launch', () => {
    expect(turnOffOutcome({ report: report([]), turnedOff: [] }, 'PvP', true)).toEqual({ launch: true, toast: null })
  })

  it('offers "Turn them off and play" only when a turned-on mod has an error', () => {
    const profileOnly = { ...report([mod('a.jar', { enabled: false, problems: [error] })]), profileProblems: [profileError], errors: 1 }
    expect(canTurnOffAndPlay(profileOnly, 'pvp')).toBe(false)
    expect(canTurnOffAndPlay({ ...profileOnly, mods: [mod('b.jar', { problems: [error] })] }, 'pvp')).toBe(true)
    // Not read yet, or read for another profile: offer it; the outcome above handles an empty run.
    expect(canTurnOffAndPlay(null, 'pvp')).toBe(true)
    expect(canTurnOffAndPlay(profileOnly, 'other')).toBe(true)
  })
})

describe('blockingSignature', () => {
  it('names each error by mod and code, the same however the mods are ordered', () => {
    const a = mod('a.jar', { problems: [error, warning] })
    const b = mod('b.jar', { problems: [{ ...error, code: 'breaks' }] })
    const r = { ...report([a, b]), profileProblems: [{ severity: 'error' as const, code: 'unreadable' as const, message: 'x' }] }
    expect(blockingSignature(r)).toBe(':unreadable\na.jar:missing\nb.jar:breaks')
    expect(blockingSignature({ ...r, mods: [b, a] })).toBe(blockingSignature(r))
    expect(blockingSignature(report([b]))).not.toBe(blockingSignature(r))
  })
})

describe('row and folder states', () => {
  it('says when a mod is off or will not load', () => {
    expect(modStateText({ enabled: false, loads: false, problems: [] })).toBe('Turned off')
    expect(modStateText({ enabled: true, loads: false, problems: [warning] })).toBe('Not loaded')
    expect(modStateText({ enabled: true, loads: false, problems: [error] })).toBeNull()
    expect(modStateText({ enabled: true, loads: true, problems: [] })).toBeNull()
  })

  it('explains folders that are not normal', () => {
    expect(folderNote('ok')).toBeNull()
    expect(folderNote('missing')?.tone).toBe('info')
    expect(folderNote('not-a-folder')?.tone).toBe('danger')
    expect(folderNote('unreadable')?.tone).toBe('danger')
  })

  it('counts problems for the chip and errors for the Play card', () => {
    const mods = [mod('a.jar', { problems: [error] }), mod('b.jar', { problems: [warning] }), mod('c.jar', { enabled: false, problems: [error] }), mod('d.jar')]
    expect(problemsChipLabel(mods)).toBe('Problems (3)')
    expect(modsWithErrors(report(mods))).toBe(1)
  })
})

describe('blockingSummary', () => {
  it('lists profile problems, then turned-on mods with errors, by name', () => {
    const r = {
      ...report([mod('b.jar', { problems: [error] }), mod('a.jar', { problems: [warning, error] }), mod('c.jar', { enabled: false, problems: [error] })]),
      profileProblems: [{ severity: 'error' as const, code: 'unreadable' as const, message: 'Bad overrides file.' }]
    }
    const summary = blockingSummary(r, 2)
    expect(summary.count).toBe(3)
    expect(summary.mods).toEqual([
      { key: 'profile-0', name: 'This profile', message: 'Bad overrides file.' },
      { key: 'a.jar', name: 'a', message: error.message }
    ])
  })
})
