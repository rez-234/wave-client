import type { AccountView, CrashSummary, GamePhase, GameState, SuspectedMod } from '@shared/ipc'

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

/**
 * The note under the Play button after a session, or null. The main process reports any other
 * abnormal exit as a crash, so an 'exited' game with a non-zero (or no) exit code was closed from
 * the launcher (Force quit).
 */
export function exitNote(state: GameState): { text: string; normal: boolean } | null {
  if (state.phase !== 'exited') {
    return null
  }

  const normal = state.exitCode === 0 || state.exitCode === undefined
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
