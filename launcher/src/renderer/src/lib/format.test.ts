import { describe, expect, it } from 'vitest'

import { formatBytes, formatClock, formatCountdown, formatMemory, initialOf, plural } from './format'

describe('formatBytes', () => {
  it('formats with 1024-based units and one decimal', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(41.2 * 1024 * 1024)).toBe('41.2 MB')
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB')
  })

  it('moves to the next unit instead of showing 1024.0', () => {
    expect(formatBytes(1024 * 1024 - 10)).toBe('1.0 MB')
  })

  it('treats negative and invalid numbers as zero', () => {
    expect(formatBytes(-5)).toBe('0 B')
    expect(formatBytes(Number.NaN)).toBe('0 B')
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 B')
  })
})

describe('formatMemory', () => {
  it('shows gigabytes with one decimal', () => {
    expect(formatMemory(4096)).toBe('4.0 GB')
    expect(formatMemory(1024 + 256)).toBe('1.3 GB')
    expect(formatMemory(12288)).toBe('12.0 GB')
  })
})

describe('formatCountdown', () => {
  it('shows minutes and seconds, rounding up', () => {
    expect(formatCountdown(899_100)).toBe('15:00')
    expect(formatCountdown(61_000)).toBe('1:01')
    expect(formatCountdown(500)).toBe('0:01')
  })

  it('never goes below zero and shows hours when needed', () => {
    expect(formatCountdown(-3000)).toBe('0:00')
    expect(formatCountdown(3_723_000)).toBe('1:02:03')
  })
})

describe('formatClock', () => {
  it('formats local time with leading zeros', () => {
    expect(formatClock(new Date(2026, 0, 2, 9, 5, 3).getTime())).toBe('09:05:03')
  })

  it('handles invalid times', () => {
    expect(formatClock(Number.NaN)).toBe('--:--:--')
  })
})

describe('initialOf', () => {
  it('uses the first letter or digit, upper case', () => {
    expect(initialOf('steve')).toBe('S')
    expect(initialOf('_xX_Notch')).toBe('X')
    expect(initialOf('9lives')).toBe('9')
    expect(initialOf('')).toBe('?')
    expect(initialOf('___')).toBe('?')
  })
})

describe('plural', () => {
  it('picks the right form', () => {
    expect(plural(1, 'file')).toBe('1 file')
    expect(plural(1200, 'file')).toBe('1,200 files')
    expect(plural(0, 'mod')).toBe('0 mods')
  })
})
