import { describe, expect, it } from 'vitest'

import { memoryRange, parseDimension, snapMemory } from './settings'

describe('memoryRange', () => {
  it("uses the main process's limits in 256 MB steps", () => {
    expect(memoryRange({ min: 1024, max: 12288 })).toEqual({ min: 1024, max: 12288, step: 256 })
  })

  it('rounds the top down to a whole step', () => {
    // 75% of 16000 MB is 12000, which isn't on the grid.
    expect(memoryRange({ min: 1024, max: 12000 }).max).toBe(11776)
  })

  it('never goes below the minimum', () => {
    expect(memoryRange({ min: 1024, max: 1024 })).toEqual({ min: 1024, max: 1024, step: 256 })
    expect(memoryRange({ min: 1024, max: Number.NaN }).max).toBe(1024)
    expect(memoryRange(undefined)).toEqual({ min: 1024, max: 1024, step: 256 })
  })
})

describe('snapMemory', () => {
  const range = memoryRange({ min: 1024, max: 12288 })

  it('snaps to the grid and clamps', () => {
    expect(snapMemory(4096, range)).toBe(4096)
    expect(snapMemory(4200, range)).toBe(4096)
    expect(snapMemory(4300, range)).toBe(4352)
    expect(snapMemory(100, range)).toBe(1024)
    expect(snapMemory(99999, range)).toBe(12288)
    expect(snapMemory(Number.NaN, range)).toBe(1024)
  })
})

describe('parseDimension', () => {
  it('accepts whole positive numbers', () => {
    expect(parseDimension('1280')).toBe(1280)
    expect(parseDimension(' 720 ')).toBe(720)
  })

  it('rejects anything else', () => {
    expect(parseDimension('')).toBeNull()
    expect(parseDimension('0')).toBeNull()
    expect(parseDimension('-5')).toBeNull()
    expect(parseDimension('12.5')).toBeNull()
    expect(parseDimension('abc')).toBeNull()
    expect(parseDimension('99999999')).toBeNull()
  })
})
