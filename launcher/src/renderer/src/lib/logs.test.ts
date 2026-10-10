import { describe, expect, it } from 'vitest'

import type { LogLevel, LogLine } from '@shared/ipc'

import { filterLogLines, formatLogLine, formatLogText, isLevelFilter, levelTone, matchesLogFilter, mergeLogLines, startsLaunch, visibleWindow } from './logs'

const line = (seq: number, patch: Partial<LogLine> = {}): LogLine => ({
  seq,
  time: new Date(2026, 0, 2, 12, 0, 0).getTime(),
  level: 'INFO',
  thread: 'Render thread',
  logger: 'Minecraft',
  message: `line ${seq}`,
  ...patch
})

const seqs = (lines: readonly LogLine[]): number[] => lines.map((l) => l.seq)

describe('mergeLogLines', () => {
  it('appends new live lines', () => {
    expect(seqs(mergeLogLines([line(1), line(2)], [line(3), line(4)]))).toEqual([1, 2, 3, 4])
  })

  it('drops duplicates when a snapshot overlaps live lines', () => {
    const live = [line(5), line(6)]
    const snapshot = [line(3), line(4), line(5)]
    expect(seqs(mergeLogLines(live, snapshot))).toEqual([3, 4, 5, 6])
  })

  it('returns the same array when nothing is new', () => {
    const current = [line(1), line(2)]
    expect(mergeLogLines(current, [])).toBe(current)
    expect(mergeLogLines(current, [line(2), line(1)])).toBe(current)
  })

  it('keeps only the newest lines', () => {
    const many = Array.from({ length: 10 }, (_, i) => line(i))
    expect(seqs(mergeLogLines(many, [line(10), line(11)], 5))).toEqual([7, 8, 9, 10, 11])
    expect(seqs(mergeLogLines([], many, 3))).toEqual([7, 8, 9])
  })

  it("appends a new session's lines after the old ones", () => {
    const first = [line(1), line(2), line(3)]
    // A new session: the main process cleared its buffer, but numbering continues.
    expect(seqs(mergeLogLines(first, [line(4), line(5)]))).toEqual([1, 2, 3, 4, 5])
  })

  it('sorts lines that arrive out of order', () => {
    expect(seqs(mergeLogLines([line(1)], [line(4), line(2), line(3)]))).toEqual([1, 2, 3, 4])
  })
})

describe('filtering', () => {
  const levels: LogLevel[] = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']
  const lines = levels.map((level, i) => line(i, { level, message: `${level.toLowerCase()} message` }))

  it('filters by minimum level', () => {
    expect(filterLogLines(lines, 'all', '').length).toBe(6)
    expect(filterLogLines(lines, 'info', '').map((l) => l.level)).toEqual(['INFO', 'WARN', 'ERROR', 'FATAL'])
    expect(filterLogLines(lines, 'warn', '').map((l) => l.level)).toEqual(['WARN', 'ERROR', 'FATAL'])
    expect(filterLogLines(lines, 'error', '').map((l) => l.level)).toEqual(['ERROR', 'FATAL'])
  })

  it('returns the same array when there is no filter', () => {
    expect(filterLogLines(lines, 'all', '   ')).toBe(lines)
  })

  it('searches message, thread and logger, ignoring case', () => {
    expect(matchesLogFilter(line(1, { message: 'Loading 42 Mods' }), 'all', 'mods')).toBe(true)
    expect(matchesLogFilter(line(1, { thread: 'Worker-Main-3' }), 'all', 'worker-main')).toBe(true)
    expect(matchesLogFilter(line(1, { logger: 'net.fabricmc.loader' }), 'all', 'FABRIC')).toBe(true)
    expect(matchesLogFilter(line(1, { thread: null, logger: null }), 'all', 'render')).toBe(false)
    expect(matchesLogFilter(line(1, { throwable: 'java.lang.NullPointerException' }), 'all', 'nullpointer')).toBe(false)
  })

  it('combines level and search', () => {
    expect(matchesLogFilter(line(1, { level: 'DEBUG', message: 'mods' }), 'info', 'mods')).toBe(false)
  })

  it('recognizes filter values', () => {
    expect(isLevelFilter('warn')).toBe(true)
    expect(isLevelFilter('verbose')).toBe(false)
  })
})

describe('visibleWindow', () => {
  const lines = Array.from({ length: 20 }, (_, i) => line(i))

  it('keeps the newest lines and counts the hidden ones', () => {
    const view = visibleWindow(lines, null, 5)
    expect(seqs(view.lines)).toEqual([15, 16, 17, 18, 19])
    expect(view.hidden).toBe(15)
  })

  it('stops at the line the user scrolled back to', () => {
    const view = visibleWindow(lines, 9, 5)
    expect(seqs(view.lines)).toEqual([5, 6, 7, 8, 9])
  })

  it('shows everything when it fits', () => {
    expect(visibleWindow(lines.slice(0, 3), null, 5)).toEqual({ lines: lines.slice(0, 3), hidden: 0 })
  })
})

describe('formatting', () => {
  it('formats a line like the exported log', () => {
    expect(formatLogLine(line(1, { message: 'Hello' }))).toBe('[12:00:00] [INFO] [Render thread/Minecraft] Hello')
    expect(formatLogLine(line(1, { level: 'ERROR', thread: null, logger: null, message: 'Boom', throwable: 'java.lang.Error\n\tat x' }))).toBe(
      '[12:00:00] [ERROR] Boom\njava.lang.Error\n\tat x'
    )
    expect(formatLogText([line(1), line(2)]).split('\n')).toHaveLength(2)
  })

  it('marks where a new launch starts', () => {
    const text = formatLogText([line(1, { session: 1 }), line(2, { session: 2 }), line(3, { session: 2 })]).split('\n')
    expect(text).toHaveLength(4)
    expect(text[1]).toBe('---- Launch 2 ----')
    expect(startsLaunch(line(2, { session: 2 }), line(1, { session: 1 }))).toBe(true)
    expect(startsLaunch(line(2, { session: 2 }), undefined)).toBe(false)
    expect(startsLaunch(line(2), line(1))).toBe(false)
  })

  it('maps levels to colors', () => {
    expect(levelTone('TRACE')).toBe('muted')
    expect(levelTone('DEBUG')).toBe('muted')
    expect(levelTone('INFO')).toBe('info')
    expect(levelTone('WARN')).toBe('warn')
    expect(levelTone('FATAL')).toBe('error')
  })
})
