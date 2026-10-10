import type { LogLevel, LogLine } from '@shared/ipc'

import { formatClock } from './format'

/** The most lines the launcher keeps in memory, like the main process. */
export const MAX_LOG_LINES = 5000
/** The most lines rendered at once; older matches are summarized above the list. */
export const MAX_RENDERED_LINES = 1000

export type LevelFilter = 'all' | 'info' | 'warn' | 'error'

export const LEVEL_FILTERS: ReadonlyArray<{ value: LevelFilter; label: string }> = [
  { value: 'all', label: 'All levels' },
  { value: 'info', label: 'Info and above' },
  { value: 'warn', label: 'Warnings and above' },
  { value: 'error', label: 'Errors only' }
]

const LEVEL_RANK: Record<LogLevel, number> = { TRACE: 0, DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4, FATAL: 5 }
const FILTER_MIN_RANK: Record<LevelFilter, number> = { all: 0, info: 2, warn: 3, error: 4 }

export function isLevelFilter(value: string): value is LevelFilter {
  return value === 'all' || value === 'info' || value === 'warn' || value === 'error'
}

/** The rank of a level; unknown levels (from a newer main process) count as INFO. */
function rankOf(level: LogLevel): number {
  return LEVEL_RANK[level] ?? LEVEL_RANK.INFO
}

/**
 * Adds incoming lines to the kept ones: ordered by seq, duplicates (the same seq from both the
 * snapshot and a live event) dropped, only the newest `max` kept. Returns `current` itself when
 * nothing changed, so React can skip a render.
 */
export function mergeLogLines(current: readonly LogLine[], incoming: readonly LogLine[], max = MAX_LOG_LINES): LogLine[] {
  if (incoming.length === 0) {
    return current as LogLine[]
  }

  const last = current.at(-1)
  let merged: LogLine[]

  if (isStrictlyAscending(incoming) && (last === undefined || (incoming[0]?.seq ?? 0) > last.seq)) {
    // The usual case: new live lines after everything we have.
    merged = current.concat(incoming)
  } else {
    const bySeq = new Map<number, LogLine>()

    for (const line of current) {
      bySeq.set(line.seq, line)
    }

    let added = false

    for (const line of incoming) {
      if (!bySeq.has(line.seq)) {
        bySeq.set(line.seq, line)
        added = true
      }
    }

    if (!added) {
      return current as LogLine[]
    }

    merged = [...bySeq.values()].sort((a, b) => a.seq - b.seq)
  }

  return merged.length > max ? merged.slice(merged.length - max) : merged
}

function isStrictlyAscending(lines: readonly LogLine[]): boolean {
  for (let i = 1; i < lines.length; i++) {
    const previous = lines[i - 1]
    const line = lines[i]

    if (previous === undefined || line === undefined || line.seq <= previous.seq) {
      return false
    }
  }

  return true
}

/** Whether a line passes the level filter and contains the search text (in its message, thread or logger). */
export function matchesLogFilter(line: LogLine, level: LevelFilter, query: string): boolean {
  if (rankOf(line.level) < FILTER_MIN_RANK[level]) {
    return false
  }

  const needle = query.trim().toLowerCase()

  if (needle === '') {
    return true
  }

  return (
    line.message.toLowerCase().includes(needle) ||
    (line.thread?.toLowerCase().includes(needle) ?? false) ||
    (line.logger?.toLowerCase().includes(needle) ?? false)
  )
}

export function filterLogLines(lines: readonly LogLine[], level: LevelFilter, query: string): LogLine[] {
  if (level === 'all' && query.trim() === '') {
    return lines as LogLine[]
  }

  return lines.filter((line) => matchesLogFilter(line, level, query))
}

/** The lines to render: matches up to `untilSeq` (when scrolled back), at most `max` of the newest. */
export function visibleWindow(lines: readonly LogLine[], untilSeq: number | null, max = MAX_RENDERED_LINES): { lines: LogLine[]; hidden: number } {
  let end = lines.length

  if (untilSeq !== null) {
    while (end > 0 && (lines[end - 1]?.seq ?? -Infinity) > untilSeq) {
      end--
    }
  }

  const start = Math.max(0, end - max)
  return { lines: lines.slice(start, end), hidden: start }
}

/** CSS class suffix for a level's color. */
export function levelTone(level: LogLevel): 'muted' | 'info' | 'warn' | 'error' {
  switch (level) {
    case 'WARN':
      return 'warn'
    case 'ERROR':
    case 'FATAL':
      return 'error'
    case 'INFO':
      return 'info'
    default:
      return 'muted'
  }
}

/** One line as plain text, the way the copied or exported log reads. */
export function formatLogLine(line: LogLine): string {
  const source = [line.thread, line.logger].filter((part): part is string => typeof part === 'string' && part !== '').join('/')
  const head = `[${formatClock(line.time)}] [${line.level}]${source ? ` [${source}]` : ''}`
  return `${head} ${line.message}${line.throwable ? `\n${line.throwable}` : ''}`
}

export function formatLogText(lines: readonly LogLine[]): string {
  return lines.map(formatLogLine).join('\n')
}
