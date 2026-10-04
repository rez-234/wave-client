import type { GamePhase, GameState, TaskProgress } from '@shared/ipc'

import { formatBytes } from './format'

export interface ProgressView {
  /** What the bar measures: bytes when their total is known, else files, else nothing (indeterminate). */
  mode: 'bytes' | 'files' | 'indeterminate'
  /** 0 to 1, or null when indeterminate. */
  fraction: number | null
  /** Whole percent for screen readers and the label, or null when indeterminate. */
  percent: number | null
  /** "41.2 MB of 98.1 MB", "12 of 340 files", or "" when there is nothing to count. */
  amount: string
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

/** How a task's progress is shown: bytes win over files, and no totals means an indeterminate bar. */
export function describeProgress(task: TaskProgress | undefined): ProgressView {
  if (task && task.totalBytes > 0) {
    const fraction = clamp01(task.doneBytes / task.totalBytes)
    return {
      mode: 'bytes',
      fraction,
      percent: Math.floor(fraction * 100),
      amount: `${formatBytes(Math.min(task.doneBytes, task.totalBytes))} of ${formatBytes(task.totalBytes)}`
    }
  }

  if (task && task.totalFiles > 0) {
    const fraction = clamp01(task.doneFiles / task.totalFiles)
    const done = Math.min(Math.max(0, task.doneFiles), task.totalFiles)
    return {
      mode: 'files',
      fraction,
      percent: Math.floor(fraction * 100),
      amount: `${done.toLocaleString('en-US')} of ${task.totalFiles.toLocaleString('en-US')} ${task.totalFiles === 1 ? 'file' : 'files'}`
    }
  }

  return { mode: 'indeterminate', fraction: null, percent: null, amount: '' }
}

const BUSY_PHASES: ReadonlySet<GamePhase> = new Set(['preparing', 'downloading', 'starting', 'running'])

/** Whether the game is being prepared, started or played, so another launch would be refused. */
export function isBusy(phase: GamePhase): boolean {
  return BUSY_PHASES.has(phase)
}

/** Whether a Cancel button makes sense: only while files are checked or downloaded. */
export function isCancellable(phase: GamePhase): boolean {
  return phase === 'preparing' || phase === 'downloading'
}

/** The heading of the progress card. */
export function taskTitle(state: GameState): string {
  const label = state.task?.label.trim()

  if (label) {
    return label
  }

  switch (state.phase) {
    case 'downloading':
      return 'Downloading game files'
    case 'starting':
      return 'Starting Minecraft…'
    default:
      return 'Getting ready…'
  }
}
