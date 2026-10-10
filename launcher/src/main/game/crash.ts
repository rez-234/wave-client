import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

import type { CrashSummary, LogLine, SuspectedMod } from '@shared/ipc'

export interface ExitInfo {
  gameDir: string
  /** Epoch ms when the game was started; older crash reports are ignored. */
  startedAt: number
  exitCode: number | null
  signal: NodeJS.Signals | null
  pid?: number
  lines: readonly LogLine[]
  spawnError?: string
}

const LAST_LINES = 500
/** Minecraft prints this straight to stdout (not through log4j) when it saves a crash report. */
const CRASH_SAVED = /^#@!@# Game crashed! Crash report saved to: #@!@# (.+)$/
/** Our own mod and Fabric's are never "suspects" just for appearing in a stack trace. */
const NEVER_SUSPECT = new Set(['minecraft', 'java', 'fabricloader', 'fabric-api', 'mixinextras'])

/**
 * Whether a file is one the game writes when it crashes: crash-reports/crash-*.txt or
 * hs_err_pid*.log in the game folder. Paths from the game's output are checked with this before
 * the launcher reads or opens them.
 */
export function isCrashFile(gameDir: string, file: string): boolean {
  const rel = relative(resolve(gameDir), resolve(gameDir, file))
  return /^crash-reports[\\/]crash-[^\\/]*\.txt$/.test(rel) || /^hs_err_pid\d+\.log$/.test(rel)
}

/**
 * Decides whether the game crashed and, if so, why: the crash report the game wrote (newest one
 * since launch), a JVM fatal error log, Fabric's mod-resolution errors, or just the exit code.
 * Returns null for a normal exit.
 */
export async function analyzeExit(info: ExitInfo): Promise<CrashSummary | null> {
  const lastLines = info.lines.slice(-LAST_LINES).map(formatLine)
  const reportPath = await findCrashReport(info)
  const jvmErrorPath = await findJvmError(info)

  if (info.exitCode === 0 && !reportPath && !jvmErrorPath) {
    return null
  }

  const report = reportPath ? await readFile(reportPath, 'utf8').catch(() => '') : ''
  const reason =
    (info.spawnError && `Java couldn't be started: ${info.spawnError}`) ||
    describeReport(report) ||
    (jvmErrorPath ? 'The Java virtual machine crashed (see the JVM error log).' : null) ||
    describeOutput(info.lines) ||
    describeExitCode(info.exitCode, info.signal)

  return {
    reason,
    reportPath,
    jvmErrorPath,
    suspectedMods: suspectMods(report, info.lines),
    lastLines
  }
}

function formatLine(line: LogLine): string {
  const head = `[${new Date(line.time).toISOString().slice(11, 19)}] [${line.thread ?? 'output'}/${line.level}]`
  return `${head}: ${line.message}${line.throwable ? `\n${line.throwable}` : ''}`
}

async function findCrashReport(info: ExitInfo): Promise<string | null> {
  for (let i = info.lines.length - 1; i >= 0; i--) {
    const line = info.lines[i]!
    // Only the game's own raw output line counts: anyone can put the same text in a chat message,
    // which the game logs through log4j. The path must also be a crash report written during this
    // launch; otherwise (a mis-decoded path, say) the folder is searched instead.
    const match = line.thread === null && line.logger === null ? CRASH_SAVED.exec(line.message) : null

    if (match) {
      const path = resolve(info.gameDir, match[1]!.trim())

      if (isCrashFile(info.gameDir, path) && (await writtenSince(path, info.startedAt))) {
        return path
      }
    }
  }

  const dir = join(info.gameDir, 'crash-reports')
  const candidates = await newestFiles(dir, (name) => /^crash-.*\.txt$/.test(name), info.startedAt)
  return candidates[0] ?? null
}

async function writtenSince(path: string, since: number): Promise<boolean> {
  const info = await stat(path).catch(() => null)
  return info !== null && info.isFile() && info.mtimeMs >= since - 2000
}

async function findJvmError(info: ExitInfo): Promise<string | null> {
  if (info.pid !== undefined) {
    const exact = join(info.gameDir, `hs_err_pid${info.pid}.log`)

    if (await stat(exact).then(() => true, () => false)) {
      return exact
    }
  }

  const candidates = await newestFiles(info.gameDir, (name) => /^hs_err_pid\d+\.log$/.test(name), info.startedAt)
  return candidates[0] ?? null
}

async function newestFiles(dir: string, accept: (name: string) => boolean, since: number): Promise<string[]> {
  let names: string[]

  try {
    names = await readdir(dir)
  } catch {
    return []
  }

  const files = await Promise.all(
    names.filter(accept).map(async (name) => {
      const path = join(dir, name)
      const info = await stat(path).catch(() => null)
      return info && info.mtimeMs >= since - 2000 ? { path, time: info.mtimeMs } : null
    })
  )

  return files
    .filter((file): file is { path: string; time: number } => file !== null)
    .sort((a, b) => b.time - a.time)
    .map((file) => file.path)
}

/** "Description: Rendering overlay" plus the exception line under it. */
export function describeReport(report: string): string | null {
  if (!report) {
    return null
  }

  const lines = report.split(/\r?\n/)
  const index = lines.findIndex((line) => line.startsWith('Description:'))

  if (index < 0) {
    return null
  }

  const description = lines[index]!.slice('Description:'.length).trim()
  const exception = lines.slice(index + 1).find((line) => line.trim().length > 0)?.trim()
  return exception ? `${description}: ${exception}` : description
}

function describeOutput(lines: readonly LogLine[]): string | null {
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - LAST_LINES); i--) {
    const message = lines[i]!.message

    if (/Incompatible mods? found|Mod resolution failed|Some of your mods are incompatible/i.test(message)) {
      return 'Fabric found incompatible or missing mods.'
    }

    if (/OutOfMemoryError/.test(message) || /OutOfMemoryError/.test(lines[i]!.throwable ?? '')) {
      return 'Minecraft ran out of memory. Try giving it more in Settings.'
    }

    if (/Could not reserve enough space|Invalid maximum heap size|Could not create the Java Virtual Machine/.test(message)) {
      return 'Java could not start with these memory settings. Try a smaller amount in Settings.'
    }

    if (/UnsupportedClassVersionError/.test(message)) {
      return 'The Java version is too old for this Minecraft version.'
    }
  }

  return null
}

function describeExitCode(code: number | null, signal: NodeJS.Signals | null): string {
  if (signal) {
    return `Minecraft was stopped (${signal}).`
  }

  // 0xC0000005 etc. arrive as negative or large unsigned numbers on Windows.
  const unsigned = code !== null ? code >>> 0 : null

  if (unsigned === 0xc0000005) {
    return 'Minecraft crashed with an access violation, usually a graphics driver problem.'
  }

  if (unsigned === 0xcfffffff || code === -805306369) {
    return 'Minecraft was closed because it stopped responding.'
  }

  return `Minecraft exited unexpectedly (exit code ${code}).`
}

/**
 * Mods named in the report or the output as the source of the failure: mixin errors name the
 * mod ("from mod <id>"), Fabric's resolution errors name mod ids and jar files.
 */
export function suspectMods(report: string, lines: readonly LogLine[]): SuspectedMod[] {
  const found = new Map<string, SuspectedMod>()
  const text = [report, ...lines.slice(-LAST_LINES).map((line) => `${line.message}\n${line.throwable ?? ''}`)].join('\n')

  const add = (id: string, reason: string, file?: string): void => {
    const key = id.toLowerCase()

    if (!NEVER_SUSPECT.has(key) && /^[a-z][a-z0-9_-]{1,63}$/.test(key) && !found.has(key)) {
      found.set(key, { id: key, reason, ...(file ? { file } : {}) })
    }
  }

  for (const match of text.matchAll(/from mod ([a-z][a-z0-9_-]{1,63})/gi)) {
    add(match[1]!, 'Named in a mixin error')
  }

  for (const match of text.matchAll(/Mod '([^']+)' \(([a-z][a-z0-9_-]{1,63})\) [^\n]*?(?:requires|is incompatible|breaks)/gi)) {
    add(match[2]!, 'Fabric reported it as incompatible or missing a dependency')
  }

  for (const match of text.matchAll(/^\s*-\s*Mod '([^']+)' \(([a-z][a-z0-9_-]{1,63})\)/gim)) {
    add(match[2]!, 'Fabric reported it as incompatible or missing a dependency')
  }

  return [...found.values()].slice(0, 10)
}
