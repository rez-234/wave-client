import { describe, expect, it } from 'vitest'

import type { TaskProgress } from '@shared/ipc'

import { describeProgress, isBusy, isCancellable, phaseAnnouncement, taskTitle } from './progress'

const task = (patch: Partial<TaskProgress>): TaskProgress => ({ label: 'Downloading', doneFiles: 0, totalFiles: 0, doneBytes: 0, totalBytes: 0, ...patch })

describe('describeProgress', () => {
  it('prefers bytes when their total is known', () => {
    const view = describeProgress(task({ doneBytes: 42 * 1024 * 1024, totalBytes: 100 * 1024 * 1024, doneFiles: 3, totalFiles: 10 }))
    expect(view.mode).toBe('bytes')
    expect(view.percent).toBe(42)
    expect(view.fraction).toBeCloseTo(0.42)
    expect(view.amount).toBe('42.0 MB of 100.0 MB')
  })

  it('falls back to files', () => {
    const view = describeProgress(task({ doneFiles: 12, totalFiles: 340 }))
    expect(view.mode).toBe('files')
    expect(view.percent).toBe(3)
    expect(view.amount).toBe('12 of 340 files')
    expect(describeProgress(task({ doneFiles: 0, totalFiles: 1 })).amount).toBe('0 of 1 file')
  })

  it('is indeterminate without totals or without a task', () => {
    expect(describeProgress(task({}))).toEqual({ mode: 'indeterminate', fraction: null, percent: null, amount: '' })
    expect(describeProgress(undefined).mode).toBe('indeterminate')
  })

  it('clamps progress that overshoots', () => {
    const view = describeProgress(task({ doneBytes: 150, totalBytes: 100 }))
    expect(view.fraction).toBe(1)
    expect(view.percent).toBe(100)
    expect(view.amount).toBe('100 B of 100 B')
  })
})

describe('phases', () => {
  it('knows which phases are busy', () => {
    expect(isBusy('idle')).toBe(false)
    expect(isBusy('downloading')).toBe(true)
    expect(isBusy('running')).toBe(true)
    expect(isBusy('crashed')).toBe(false)
  })

  it('only offers cancel while preparing', () => {
    expect(isCancellable('preparing')).toBe(true)
    expect(isCancellable('downloading')).toBe(true)
    expect(isCancellable('starting')).toBe(false)
    expect(isCancellable('running')).toBe(false)
  })
})

describe('taskTitle', () => {
  it('uses the task label, or a default per phase', () => {
    expect(taskTitle({ phase: 'downloading', task: task({ label: 'Downloading assets' }) })).toBe('Downloading assets')
    expect(taskTitle({ phase: 'downloading', task: task({ label: '  ' }) })).toBe('Downloading game files')
    expect(taskTitle({ phase: 'preparing' })).toBe('Getting ready…')
    expect(taskTitle({ phase: 'starting' })).toBe('Starting Minecraft…')
  })
})

describe('phaseAnnouncement', () => {
  it('names what is happening without percentages', () => {
    expect(phaseAnnouncement({ phase: 'downloading', task: task({ label: 'Downloading libraries', doneBytes: 5, totalBytes: 10 }) }, true)).toBe(
      'Downloading libraries'
    )
    expect(phaseAnnouncement({ phase: 'starting' }, true)).toBe('Starting Minecraft')
    expect(phaseAnnouncement({ phase: 'running' }, false)).toBe('Minecraft is running')
    expect(phaseAnnouncement({ phase: 'idle' }, true)).toBe('Getting ready…')
    expect(phaseAnnouncement({ phase: 'idle' }, false)).toBe('')
    expect(phaseAnnouncement({ phase: 'exited', exitCode: 0 }, false)).toBe('Minecraft closed. The last session ended normally.')
    expect(phaseAnnouncement({ phase: 'exited', exitCode: 143, closedByLauncher: true }, false)).toBe('Minecraft was closed from the launcher.')
  })

  it('leaves crashes and failures to their alerts', () => {
    expect(phaseAnnouncement({ phase: 'crashed' }, false)).toBe('')
    expect(phaseAnnouncement({ phase: 'failed', error: 'Nope' }, false)).toBe('')
  })
})
