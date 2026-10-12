import type { GameVersionView, ProfileView } from '@shared/ipc'

import { plural } from './format'

/** The longest name the main process keeps (it shortens longer ones). */
export const MAX_PROFILE_NAME = 40

/** The profile Play launches. The first one stands in for the moment a change has no selection yet. */
export function selectedProfile(profiles: readonly ProfileView[]): ProfileView | null {
  return profiles.find((profile) => profile.selected) ?? profiles[0] ?? null
}

/** "Minecraft 1.21.11", as the launcher names the version, or built from the id for one it doesn't list. */
export function versionLabel(gameVersion: string, versions: readonly GameVersionView[]): string {
  return versions.find((version) => version.id === gameVersion)?.label ?? `Minecraft ${gameVersion}`
}

/** "No mods", "1 mod", "12 mods" (turned-on mods; Wave Client and Fabric API aren't counted). */
export function modCountText(count: number): string {
  return count > 0 ? plural(count, 'mod') : 'No mods'
}

/** The line under a profile's name in the picker and on its card: "Minecraft 1.21.11 · 12 mods". */
export function profileDetail(profile: ProfileView, versions: readonly GameVersionView[]): string {
  return `${versionLabel(profile.gameVersion, versions)} · ${modCountText(profile.modCount)}`
}

/** What a screen reader hears for the picker button. */
export function pickerLabel(profile: ProfileView | null, busy: boolean): string {
  if (!profile) {
    return 'Profile'
  }

  return busy ? `Profile: ${profile.name}. You can switch profiles when Minecraft closes.` : `Profile: ${profile.name}. Change profile`
}

const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(time: number): number {
  const date = new Date(time)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** "Played today", "Played yesterday", "Played 3 days ago", "Played on Oct 4", "Never played". */
export function lastPlayedText(lastPlayedAt: number | null, now: number): string {
  if (lastPlayedAt === null || !Number.isFinite(lastPlayedAt)) {
    return 'Never played'
  }

  // Calendar days, not 24-hour periods: last night at 23:00 is "yesterday" at 08:00.
  const days = Math.round((startOfDay(now) - startOfDay(lastPlayedAt)) / DAY_MS)

  if (days <= 0) {
    return 'Played today'
  }

  if (days === 1) {
    return 'Played yesterday'
  }

  if (days < 7) {
    return `Played ${days} days ago`
  }

  const date = new Date(lastPlayedAt)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  const text = date.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
  return `Played on ${text}`
}

/** A name the way the main process stores it: one line, single spaces, trimmed, at most 40 characters. */
export function cleanProfileName(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PROFILE_NAME)
    .trim()
}

/**
 * Why a name can't be used, or null. The main process has the final say; checking here lets the
 * dialog explain before anything is sent.
 */
export function profileNameProblem(value: string, profiles: readonly ProfileView[], exceptId?: string): string | null {
  const name = cleanProfileName(value)

  if (name === '') {
    return 'Enter a name for the profile.'
  }

  const lower = name.toLocaleLowerCase()
  const clash = profiles.find((profile) => profile.id !== exceptId && profile.name.toLocaleLowerCase() === lower)
  return clash ? `A profile named ${clash.name} already exists.` : null
}

/** "PvP (copy)", then "PvP (copy 2)" and so on: a name no profile has, within the length limit. */
export function duplicateName(name: string, profiles: readonly ProfileView[]): string {
  const taken = new Set(profiles.map((profile) => profile.name.toLocaleLowerCase()))

  for (let n = 1; ; n++) {
    const suffix = n === 1 ? ' (copy)' : ` (copy ${n})`
    const candidate = `${cleanProfileName(name).slice(0, MAX_PROFILE_NAME - suffix.length).trimEnd()}${suffix}`

    if (!taken.has(candidate.toLocaleLowerCase())) {
      return candidate
    }
  }
}

/** Where deleted things go on this system, in its own words. */
export function trashName(platform: string): string {
  return platform === 'win32' ? 'Recycle Bin' : 'Trash'
}
