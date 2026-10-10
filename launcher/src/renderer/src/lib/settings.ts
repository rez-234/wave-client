import type { AfterLaunch } from '@shared/ipc'

/** The main process never gives the game less than this (see main/settings.ts). */
export const MIN_MEMORY_MB = 1024
export const MEMORY_STEP_MB = 256

export interface MemoryRange {
  min: number
  max: number
  step: number
}

/**
 * The memory slider's range: 1 GB up to 75% of the installed memory (what the main process
 * allows), rounded down to whole steps so the top of the slider can be reached.
 */
export function memoryRange(totalMemoryMb: number): MemoryRange {
  const allowed = Number.isFinite(totalMemoryMb) ? Math.floor(totalMemoryMb * 0.75) : MIN_MEMORY_MB
  const steps = Math.max(0, Math.floor((allowed - MIN_MEMORY_MB) / MEMORY_STEP_MB))
  return { min: MIN_MEMORY_MB, max: MIN_MEMORY_MB + steps * MEMORY_STEP_MB, step: MEMORY_STEP_MB }
}

/** A value on the slider's grid, inside its range. */
export function snapMemory(value: number, range: MemoryRange): number {
  if (!Number.isFinite(value)) {
    return range.min
  }

  const snapped = range.min + Math.round((value - range.min) / range.step) * range.step
  return Math.min(range.max, Math.max(range.min, snapped))
}

/** A whole, positive number typed into a size field, or null if it isn't one. */
export function parseDimension(text: string): number | null {
  const trimmed = text.trim()

  if (!/^\d{1,6}$/.test(trimmed)) {
    return null
  }

  const value = Number(trimmed)
  return value > 0 ? value : null
}

export const AFTER_LAUNCH_OPTIONS: ReadonlyArray<{ value: AfterLaunch; label: string }> = [
  { value: 'keep-open', label: 'Keep the launcher open' },
  { value: 'minimize', label: 'Minimize the launcher' },
  { value: 'close', label: 'Close the launcher' }
]
