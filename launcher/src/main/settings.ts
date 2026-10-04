import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { DEFAULT_SETTINGS, type AfterLaunch, type LauncherSettings } from '@shared/ipc'

const AFTER_LAUNCH: AfterLaunch[] = ['keep-open', 'minimize', 'close']
export const MIN_MEMORY_MB = 1024
export const MAX_JVM_ARGS_LENGTH = 2000

/**
 * Cleans settings from disk or from the UI: unknown keys dropped, numbers clamped, wrong types
 * replaced by defaults. Never throws.
 */
export function sanitizeSettings(input: unknown, totalMemoryMb: number, base: LauncherSettings = DEFAULT_SETTINGS): LauncherSettings {
  const value = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  const maxMemory = Math.max(MIN_MEMORY_MB, Math.floor(totalMemoryMb * 0.75))

  return {
    memoryMb: clampInt(value.memoryMb, MIN_MEMORY_MB, maxMemory, Math.min(base.memoryMb, maxMemory)),
    javaPath: typeof value.javaPath === 'string' && value.javaPath.trim().length > 0 ? value.javaPath.trim() : value.javaPath === null ? null : base.javaPath,
    jvmArgs: typeof value.jvmArgs === 'string' ? value.jvmArgs.slice(0, MAX_JVM_ARGS_LENGTH) : base.jvmArgs,
    width: clampInt(value.width, 320, 16384, base.width),
    height: clampInt(value.height, 240, 16384, base.height),
    fullscreen: typeof value.fullscreen === 'boolean' ? value.fullscreen : base.fullscreen,
    afterLaunch: AFTER_LAUNCH.includes(value.afterLaunch as AfterLaunch) ? (value.afterLaunch as AfterLaunch) : base.afterLaunch
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
}

/**
 * Splits the user's extra JVM arguments on whitespace, keeping quoted parts together
 * ("-Dname=a b" in quotes stays one argument). No shell is involved, so nothing is expanded.
 */
export function splitJvmArgs(text: string): string[] {
  const args: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let started = false

  for (const char of text) {
    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
    } else if (char === '"' || char === "'") {
      quote = char
      started = true
    } else if (/\s/.test(char)) {
      if (started) {
        args.push(current)
        current = ''
        started = false
      }
    } else {
      current += char
      started = true
    }
  }

  if (started) {
    args.push(current)
  }

  return args
}

/** launcher.json: preferences only, never secrets. */
export class SettingsStore {
  private current: LauncherSettings

  constructor(
    private readonly file: string,
    private readonly totalMemoryMb: number
  ) {
    this.current = sanitizeSettings({}, totalMemoryMb)
  }

  async load(): Promise<LauncherSettings> {
    try {
      this.current = sanitizeSettings(JSON.parse(await readFile(this.file, 'utf8')), this.totalMemoryMb)
    } catch {
      this.current = sanitizeSettings({}, this.totalMemoryMb)
    }

    return this.get()
  }

  get(): LauncherSettings {
    return { ...this.current }
  }

  async set(changes: unknown): Promise<LauncherSettings> {
    const patch = typeof changes === 'object' && changes !== null ? changes : {}
    this.current = sanitizeSettings({ ...this.current, ...patch }, this.totalMemoryMb, this.current)
    const temp = `${this.file}.tmp`
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(temp, JSON.stringify(this.current, null, 2))
    await rename(temp, this.file)
    return this.get()
  }
}
