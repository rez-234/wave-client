import type { AccountView, CrashSummary, GamePhase, GameState, ModView, SuspectedMod } from '@shared/ipc'

import { plural } from './format'
import { isBusy } from './progress'

export interface PlayButtonModel {
  label: string
  /** 'play' launches, 'sign-in' opens the sign-in panel for an expired account. */
  action: 'play' | 'sign-in'
  disabled: boolean
  /** A short explanation under the button, or null. */
  hint: string | null
}

/** What the big button says and does for the current game phase and account. */
export function playButtonModel(phase: GamePhase, account: AccountView | null, launching: boolean): PlayButtonModel {
  if (phase === 'running') {
    return { label: 'Playing', action: 'play', disabled: true, hint: null }
  }

  if (phase === 'starting') {
    return { label: 'Starting…', action: 'play', disabled: true, hint: null }
  }

  if (launching || isBusy(phase)) {
    return { label: 'Preparing…', action: 'play', disabled: true, hint: null }
  }

  if (!account) {
    return { label: 'Play', action: 'play', disabled: true, hint: 'Choose an account to play with.' }
  }

  if (account.status === 'expired') {
    return { label: 'Sign in again', action: 'sign-in', disabled: false, hint: `The sign-in for ${account.name} has expired.` }
  }

  return { label: 'Play', action: 'play', disabled: false, hint: null }
}

/** The note under the Play button after a session, or null. */
export function exitNote(state: GameState): { text: string; normal: boolean } | null {
  if (state.phase !== 'exited') {
    return null
  }

  const normal = state.closedByLauncher !== true
  return { text: normal ? 'Last session ended normally' : 'Minecraft was closed from the launcher', normal }
}

/** What a suspected mod is called in the UI. */
export function suspectName(mod: SuspectedMod): string {
  return mod.name?.trim() || mod.id
}

/** The crash as plain text, for "Copy details". */
export function crashDetailsText(crash: CrashSummary, minecraftVersion: string, launcherVersion: string): string {
  const parts = [`Minecraft ${minecraftVersion} crashed (Wave Client ${launcherVersion})`, `Reason: ${crash.reason}`]

  if (crash.suspectedMods.length > 0) {
    parts.push(
      `Suspected mods:\n${crash.suspectedMods
        .map((mod) => `- ${suspectName(mod)}${suspectName(mod) !== mod.id ? ` (${mod.id})` : ''}${mod.file ? ` [${mod.file}]` : ''}: ${mod.reason}`)
        .join('\n')}`
    )
  }

  if (crash.lastLines.length > 0) {
    parts.push(`Last output:\n${crash.lastLines.join('\n')}`)
  }

  return parts.join('\n\n')
}

export interface SuspectMatch {
  suspect: SuspectedMod
  /** The mod in the crashed profile it points to, or null (a built-in, a nested mod, or one that's gone). */
  mod: ModView | null
}

/**
 * Finds each suspect among the profile's mods: by file name first, then by mod id, then by a
 * provided id, preferring a copy that loads. Each mod is matched once, so one jar doesn't get two
 * "Turn off" buttons.
 */
export function matchSuspects(suspects: readonly SuspectedMod[], mods: readonly ModView[] | null): SuspectMatch[] {
  const used = new Set<string>()
  const loadsFirst = [...(mods ?? [])].sort((a, b) => Number(b.loads) - Number(a.loads))

  return suspects.map((suspect) => {
    const free = loadsFirst.filter((mod) => !used.has(mod.key))
    const mod =
      (suspect.file ? free.find((m) => m.file === suspect.file || m.key === suspect.file) : undefined) ??
      free.find((m) => m.id === suspect.id) ??
      free.find((m) => m.provides.includes(suspect.id)) ??
      null

    if (mod) {
      used.add(mod.key)
    }

    return { suspect, mod }
  })
}

/** "3 mods in PvP have problems", "1 mod in PvP has a problem". */
export function modProblemsTitle(count: number, profileName: string | null): string {
  const where = profileName ? ` in ${profileName}` : ''
  return count === 1 ? `1 mod${where} has a problem` : `${plural(count, 'mod')}${where} have problems`
}

/** The crash card's heading names the profile that crashed. */
export function crashTitle(state: Pick<GameState, 'profile'>): string {
  return state.profile ? `${state.profile.name} crashed` : 'Minecraft crashed'
}

/** The failed card's heading. */
export function failedTitle(state: Pick<GameState, 'profile'>): string {
  return state.profile ? `${state.profile.name} couldn't start` : "Couldn't start Minecraft"
}
