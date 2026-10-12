import { describe, expect, it } from 'vitest'

import type { GameVersionView, ProfileView } from '@shared/ipc'

import {
  cleanProfileName,
  duplicateName,
  lastPlayedText,
  modCountText,
  pickerLabel,
  profileDetail,
  profileNameProblem,
  selectedProfile,
  trashName,
  versionLabel
} from './profiles'

const profile = (id: string, patch: Partial<ProfileView> = {}): ProfileView => ({
  id,
  name: id,
  gameVersion: '1.21.11',
  memoryMb: 4096,
  jvmArgs: '',
  selected: false,
  running: false,
  createdAt: 0,
  lastPlayedAt: null,
  modCount: 0,
  ...patch
})

const versions: GameVersionView[] = [{ id: '1.21.11', label: 'Minecraft 1.21.11', java: 21 }]

describe('selectedProfile', () => {
  it('finds the selected one, or falls back to the first', () => {
    const list = [profile('default'), profile('pvp', { selected: true })]
    expect(selectedProfile(list)?.id).toBe('pvp')
    expect(selectedProfile([profile('a'), profile('b')])?.id).toBe('a')
    expect(selectedProfile([])).toBeNull()
  })
})

describe('labels', () => {
  it('names versions the launcher knows, and builds one for others', () => {
    expect(versionLabel('1.21.11', versions)).toBe('Minecraft 1.21.11')
    expect(versionLabel('1.22', versions)).toBe('Minecraft 1.22')
  })

  it('counts mods', () => {
    expect(modCountText(0)).toBe('No mods')
    expect(modCountText(1)).toBe('1 mod')
    expect(modCountText(12)).toBe('12 mods')
  })

  it('describes a profile in the picker', () => {
    expect(profileDetail(profile('pvp', { modCount: 12 }), versions)).toBe('Minecraft 1.21.11 · 12 mods')
    expect(profileDetail(profile('pvp'), versions)).toBe('Minecraft 1.21.11 · No mods')
  })

  it('tells screen readers why the picker is disabled', () => {
    expect(pickerLabel(profile('pvp', { name: 'PvP' }), false)).toBe('Profile: PvP. Change profile')
    expect(pickerLabel(profile('pvp', { name: 'PvP' }), true)).toBe('Profile: PvP. You can switch profiles when Minecraft closes.')
    expect(pickerLabel(null, false)).toBe('Profile')
  })

  it("uses the system's word for the trash", () => {
    expect(trashName('win32')).toBe('Recycle Bin')
    expect(trashName('darwin')).toBe('Trash')
    expect(trashName('linux')).toBe('Trash')
  })
})

describe('lastPlayedText', () => {
  const now = new Date(2026, 9, 10, 8, 0).getTime()

  it('counts calendar days', () => {
    expect(lastPlayedText(null, now)).toBe('Never played')
    expect(lastPlayedText(new Date(2026, 9, 10, 0, 5).getTime(), now)).toBe('Played today')
    expect(lastPlayedText(new Date(2026, 9, 9, 23, 0).getTime(), now)).toBe('Played yesterday')
    expect(lastPlayedText(new Date(2026, 9, 6, 12, 0).getTime(), now)).toBe('Played 4 days ago')
  })

  it('shows a date after a week, with the year when it differs', () => {
    expect(lastPlayedText(new Date(2026, 8, 28).getTime(), now)).toBe('Played on Sep 28')
    expect(lastPlayedText(new Date(2025, 11, 31).getTime(), now)).toBe('Played on Dec 31, 2025')
  })

  it('treats a time in the future (a changed clock) as today', () => {
    expect(lastPlayedText(now + 3 * 86_400_000, now)).toBe('Played today')
    expect(lastPlayedText(Number.NaN, now)).toBe('Never played')
  })
})

describe('names', () => {
  it('cleans names like the main process', () => {
    expect(cleanProfileName('  PvP \n  1.21 ')).toBe('PvP 1.21')
    expect(cleanProfileName('a'.repeat(50))).toHaveLength(40)
    expect(cleanProfileName('\t\u0000')).toBe('')
  })

  it('explains names that can not be used', () => {
    const list = [profile('default', { name: 'Default' }), profile('pvp', { name: 'PvP' })]
    expect(profileNameProblem('   ', list)).toBe('Enter a name for the profile.')
    expect(profileNameProblem(' pvp ', list)).toBe('A profile named PvP already exists.')
    expect(profileNameProblem('Survival', list)).toBeNull()
    // Renaming a profile to itself (or a different case of itself) is fine.
    expect(profileNameProblem('PVP', list, 'pvp')).toBeNull()
  })

  it('names copies after the original', () => {
    const list = [profile('pvp', { name: 'PvP' })]
    expect(duplicateName('PvP', list)).toBe('PvP (copy)')
    expect(duplicateName('PvP', [...list, profile('c', { name: 'pvp (Copy)' })])).toBe('PvP (copy 2)')
    expect(duplicateName('PvP', [...list, profile('c', { name: 'PvP (copy)' }), profile('d', { name: 'PvP (copy 2)' })])).toBe('PvP (copy 3)')
  })

  it('keeps copies within 40 characters', () => {
    const long = 'A very long profile name for testing it'
    const copy = duplicateName(long, [])
    expect(copy.length).toBeLessThanOrEqual(40)
    expect(copy.endsWith(' (copy)')).toBe(true)
  })
})
