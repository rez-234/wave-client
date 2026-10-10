import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { DEFAULT_SETTINGS, type AfterLaunch, type LauncherSettings } from '@shared/ipc'

const AFTER_LAUNCH: AfterLaunch[] = ['keep-open', 'minimize', 'close']
export const MIN_MEMORY_MB = 1024
export const MAX_JVM_ARGS_LENGTH = 2000

/** The memory the game may be given: at least 1 GiB, at most 75% of the installed RAM. */
export function memoryRangeMb(totalMemoryMb: number): { min: number; max: number } {
  return { min: MIN_MEMORY_MB, max: Math.max(MIN_MEMORY_MB, Math.floor(totalMemoryMb * 0.75)) }
}

/**
 * Cleans settings from disk or from the UI: unknown keys dropped, numbers clamped, wrong types
 * replaced by defaults. Never throws.
 */
export function sanitizeSettings(input: unknown, totalMemoryMb: number, base: LauncherSettings = DEFAULT_SETTINGS): LauncherSettings {
  const value = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  const maxMemory = memoryRangeMb(totalMemoryMb).max

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
      // An empty argument ("" on its own) would be taken as the main class, so it is dropped.
      if (started && current.length > 0) {
        args.push(current)
      }

      current = ''
      started = false
    } else {
      current += char
      started = true
    }
  }

  if (started && current.length > 0) {
    args.push(current)
  }

  return args
}

/** launcher.json: preferences only, never secrets. */
export class SettingsStore {
  private current: LauncherSettings
  private writing: Promise<void> = Promise.resolve()

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
    const saved = this.get()
    // One write at a time (quick changes overlap), each writing the settings as they are by then.
    const run = this.writing.then(
      () => this.write(),
      () => this.write()
    )
    this.writing = run.catch(() => {})
    await run
    return saved
  }

  private async write(): Promise<void> {
    const temp = `${this.file}.tmp`
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(temp, JSON.stringify(this.current, null, 2))
    await rename(temp, this.file)
  }
}

/** -XX options whose value is a command to run or a file to load. */
const XX_UNSAFE = /^(OnError|OnOutOfMemoryError|Flags|VMOptionsFile|JVMCILibPath|SharedArchiveFile|ArchiveClassesAtExit|SharedClassListFile|ErrorFile|HeapDumpPath|LogFile|StartFlightRecording)$/i

/** System properties that load code or native libraries, configure logging from a file, or open remote access. */
const PROPERTY_UNSAFE =
  /^(java\.(?!net\.prefer\w+$|awt\.headless$)|jdk\.|sun\.|com\.sun\.|javax\.|jna\.|org\.lwjgl\.|fabric\.|mixin\.|log4j2?\.(configuration|contextSelector|\w*[Ff]actory)|.*\.library\.path$)/

/** Option shapes known to be harmless: memory, GC and tuning flags, plain properties. */
const SAFE_JVM_ARG: RegExp[] = [
  /^-X(ms|mx|mn|ss)\d+[kKmMgGtT]?$/,
  /^-XX:[+-]\w+$/,
  /^-Xshare:(auto|on|off)$/,
  /^-Xlog:(?!.*file=)\S*$/,
  /^-(server|client|ea|da|esa|dsa|enableassertions|disableassertions|enablesystemassertions|disablesystemassertions)$/,
  /^--enable-preview$/
]

/**
 * The JVM options the player should confirm before they are saved: anything that isn't one of a
 * few known-harmless shapes (memory and GC tuning, boolean -XX flags, -XX:Name=number-like values,
 * ordinary -D properties). That covers options that run commands, load agents, classes or native
 * libraries, replace the main class or open remote access, in every spelling. The field stays
 * free-form; this only decides when to ask, in a native dialog that script in the page can't answer.
 */
export function riskyJvmArgs(args: readonly string[]): string[] {
  return args.filter((arg) => !isSafeJvmArg(arg))
}

function isSafeJvmArg(arg: string): boolean {
  if (SAFE_JVM_ARG.some((pattern) => pattern.test(arg))) {
    return true
  }

  const xx = /^-XX:(\w+)=([\w.+-]+)$/.exec(arg)

  if (xx) {
    return !XX_UNSAFE.test(xx[1]!)
  }

  const property = /^-D([\w.-]+)(=(.*))?$/s.exec(arg)

  if (property) {
    // A value that names a file or a URL could point anywhere; ask about it.
    return !PROPERTY_UNSAFE.test(property[1]!) && !/[\\/]|^\w{2,}:/.test(property[3] ?? '')
  }

  return false
}

