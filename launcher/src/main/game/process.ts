import { spawn, type ChildProcess } from 'node:child_process'

import type { CrashSummary, LogLevel, LogLine } from '@shared/ipc'

import { analyzeExit } from './crash'
import { redact, type LaunchCommand } from './launch-command'
import { LogStreamParser, type ParsedLog } from './log-parser'

export const MAX_LINES = 5000

export interface GameExit {
  code: number | null
  signal: NodeJS.Signals | null
  /** Set when the game didn't exit normally (crash report, JVM error or non-zero exit). */
  crash: CrashSummary | null
}

export interface GameSessionOptions {
  onLines: (lines: LogLine[]) => void
  onExit: (exit: GameExit) => void
  spawnFn?: typeof spawn
  now?: () => number
  /** Numbers lines; shared with the launcher's own messages so numbering never restarts. */
  nextSeq?: () => number
}

/**
 * One running game: its process, its parsed and redacted output (the last MAX_LINES lines) and,
 * when it exits, a crash summary if something went wrong.
 */
export class GameSession {
  private readonly lines: LogLine[] = []
  private seq = 0
  private readonly nextSeq: () => number
  private child: ChildProcess | null = null
  private readonly startedAt: number
  private exited = false

  constructor(
    private readonly command: LaunchCommand,
    private readonly options: GameSessionOptions
  ) {
    this.startedAt = (options.now ?? Date.now)()
    this.nextSeq = options.nextSeq ?? (() => this.seq++)
  }

  get running(): boolean {
    return this.child !== null && !this.exited
  }

  get pid(): number | undefined {
    return this.child?.pid
  }

  snapshot(): LogLine[] {
    return [...this.lines]
  }

  start(): void {
    const spawnFn = this.options.spawnFn ?? spawn
    this.launcherLine('INFO', `Starting Minecraft with ${this.command.java}`)

    // No shell: arguments go to Java exactly as built, spaces and all.
    const child = spawnFn(this.command.java, this.command.args, {
      cwd: this.command.cwd,
      env: gameEnvironment(process.env),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false
    })
    this.child = child

    const stdout = new LogStreamParser()
    const stderr = new LogStreamParser()
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => this.add(stdout.push(chunk)))
    child.stderr?.on('data', (chunk: string) => this.add(stderr.push(chunk), true))

    let reported = false
    const finish = async (code: number | null, signal: NodeJS.Signals | null, error?: Error): Promise<void> => {
      if (reported) {
        return
      }

      reported = true
      this.exited = true
      this.add(stdout.flush())
      this.add(stderr.flush(), true)

      if (error) {
        this.launcherLine('ERROR', `Couldn't start Java: ${error.message}`)
      } else {
        this.launcherLine(code === 0 ? 'INFO' : 'WARN', `Minecraft exited with ${signal ? `signal ${signal}` : `code ${code}`}`)
      }

      const crash = await analyzeExit({
        gameDir: this.command.cwd,
        startedAt: this.startedAt,
        exitCode: error ? -1 : code,
        signal,
        pid: child.pid,
        lines: this.lines,
        spawnError: error?.message
      }).catch(() => null)

      this.options.onExit({ code: error ? null : code, signal, crash: crash ? redactCrash(crash, this.command.secrets) : null })
    }

    child.on('error', (error) => void finish(null, null, error))
    child.on('close', (code, signal) => void finish(code, signal))
  }

  /** Ends the game. Minecraft has no clean shutdown signal, so this is a kill. */
  kill(): void {
    if (this.child && !this.exited) {
      this.child.kill()
    }
  }

  private add(parsed: ParsedLog[], fromStderr = false): void {
    if (parsed.length === 0) {
      return
    }

    const out: LogLine[] = parsed.map((line) => ({
      seq: this.nextSeq(),
      time: line.time,
      level: fromStderr && line.level === 'INFO' && line.thread === null ? 'WARN' : line.level,
      thread: line.thread,
      logger: line.logger,
      message: redact(line.message, this.command.secrets),
      ...(line.throwable ? { throwable: redact(line.throwable, this.command.secrets) } : {})
    }))

    this.lines.push(...out)

    if (this.lines.length > MAX_LINES) {
      this.lines.splice(0, this.lines.length - MAX_LINES)
    }

    this.options.onLines(out)
  }

  private launcherLine(level: LogLevel, message: string): void {
    this.add([{ time: Date.now(), level, thread: 'Launcher', logger: 'Wave Client', message }])
  }
}

/** The launcher's environment minus variables that would change how the game's JVM starts. */
export function gameEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {}

  for (const [key, value] of Object.entries(env)) {
    // Electron sets these for itself; Java options from the environment would bypass the launcher's settings.
    if (/^(ELECTRON_|_JAVA_OPTIONS$|JAVA_TOOL_OPTIONS$|JDK_JAVA_OPTIONS$|CLASSPATH$|NODE_OPTIONS$)/.test(key)) {
      continue
    }

    clean[key] = value
  }

  return clean
}

function redactCrash(crash: CrashSummary, secrets: readonly string[]): CrashSummary {
  return {
    ...crash,
    reason: redact(crash.reason, secrets),
    lastLines: crash.lastLines.map((line) => redact(line, secrets))
  }
}
