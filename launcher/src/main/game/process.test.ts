import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { LogLine } from '@shared/ipc'

import { analyzeExit, describeReport, suspectMods } from './crash'
import { GameSession, gameEnvironment, type GameExit } from './process'

const TOKEN = 'eyJ.secret-token-value'

/** A fake child process whose output and exit the test controls. */
function fakeChild() {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), pid: 4242, kill: () => true })
  return child
}

describe('GameSession', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wave-game-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  function run(onSpawn: (child: ReturnType<typeof fakeChild>) => void): Promise<{ exit: GameExit; lines: LogLine[]; args: unknown[] }> {
    return new Promise((resolve) => {
      const lines: LogLine[] = []
      let args: unknown[] = []
      const session = new GameSession(
        { java: '/rt/java', args: ['-cp', 'x', 'Main', '--accessToken', TOKEN], cwd: dir, secrets: [TOKEN] },
        {
          onLines: (batch) => lines.push(...batch),
          onExit: (exit) => resolve({ exit, lines, args }),
          spawnFn: ((...spawnArgs: unknown[]) => {
            args = spawnArgs
            const child = fakeChild()
            setTimeout(() => onSpawn(child), 1)
            return child
          }) as never
        }
      )
      session.start()
    })
  }

  it('streams parsed, redacted output and reports a clean exit', async () => {
    const { exit, lines, args } = await run((child) => {
      child.stdout.write(`<log4j:Event logger="x" timestamp="5" level="INFO" thread="Render thread"><log4j:Message><![CDATA[Setting user: Steve, token ${TOKEN}]]></log4j:Message></log4j:Event>\n`)
      child.stderr.write('Picked up something\n')
      child.stdout.end()
      child.stderr.end()
      child.emit('close', 0, null)
    })

    expect(exit).toEqual({ code: 0, signal: null, crash: null, killed: false })
    expect(lines.map((l) => l.message)).toEqual([
      'Starting Minecraft with /rt/java',
      'Setting user: Steve, token [redacted]',
      'Picked up something',
      'Minecraft exited with code 0'
    ])
    expect(lines.map((l) => l.seq)).toEqual([0, 1, 2, 3])
    expect(lines[2]!.level).toBe('WARN')
    expect(args[1]).toEqual(['-cp', 'x', 'Main', '--accessToken', TOKEN])
    expect((args[2] as { cwd: string }).cwd).toBe(dir)
  })

  it('does not call a forced quit a crash', async () => {
    const lines: LogLine[] = []
    const exit = await new Promise<GameExit>((resolve) => {
      const child = fakeChild()
      const session = new GameSession(
        { java: '/rt/java', args: [], cwd: dir, secrets: [] },
        { onLines: (batch) => lines.push(...batch), onExit: resolve, spawnFn: (() => child) as never }
      )
      session.start()
      child.kill = () => {
        setTimeout(() => child.emit('close', 143, null), 1)
        return true
      }
      session.kill()
    })

    expect(exit).toMatchObject({ code: 143, crash: null, killed: true })
    expect(lines.at(-1)?.message).toBe('Minecraft was closed from the launcher')
  })

  it('reports a crash with the saved report and suspected mods', async () => {
    const report = join(dir, 'crash-reports', 'crash-2026-10-04_14.00.00-client.txt')
    await mkdir(join(dir, 'crash-reports'), { recursive: true })
    await writeFile(
      report,
      '---- Minecraft Crash Report ----\n// Oops.\n\nTime: now\nDescription: Initializing game\n\njava.lang.RuntimeException: Mixin transformation failed\n\tat x\nCaused by: org.spongepowered.asm.mixin.transformer.throwables.MixinTransformerError: Mixin [coolmod.mixins.json:FooMixin] from mod coolmod failed\n'
    )

    const { exit } = await run((child) => {
      child.stdout.write(`#@!@# Game crashed! Crash report saved to: #@!@# ${report}\n`)
      child.stdout.end()
      child.stderr.end()
      child.emit('close', -1, null)
    })

    expect(exit.crash).toMatchObject({
      reason: 'Initializing game: java.lang.RuntimeException: Mixin transformation failed',
      reportPath: report,
      jvmErrorPath: null,
      suspectedMods: [{ id: 'coolmod', reason: 'Named in a mixin error' }]
    })
    expect(exit.crash!.lastLines.join('\n')).toContain('Game crashed!')
  })

  it('explains a Java that cannot start', async () => {
    const { exit } = await run((child) => child.emit('error', Object.assign(new Error('spawn /rt/java ENOENT'), { code: 'ENOENT' })))
    expect(exit.code).toBeNull()
    expect(exit.crash?.reason).toMatch(/Java couldn't be started/)
  })

  it('finds a JVM error log written during this launch', async () => {
    await writeFile(join(dir, 'hs_err_pid4242.log'), '# A fatal error has been detected')
    const { exit } = await run((child) => child.emit('close', 134, null))
    expect(exit.crash).toMatchObject({ jvmErrorPath: join(dir, 'hs_err_pid4242.log') })
    expect(exit.crash?.reason).toMatch(/virtual machine crashed/)
  })
})

describe('crash analysis', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wave-crash-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const line = (message: string): LogLine => ({ seq: 0, time: 0, level: 'ERROR', thread: null, logger: null, message })

  it('ignores crash reports from before this launch', async () => {
    await mkdir(join(dir, 'crash-reports'))
    const old = join(dir, 'crash-reports', 'crash-old-client.txt')
    await writeFile(old, 'Description: old crash\n\nboom')
    await utimes(old, new Date(1_000), new Date(1_000))
    expect(await analyzeExit({ gameDir: dir, startedAt: Date.now(), exitCode: 0, signal: null, lines: [] })).toBeNull()
  })

  it('names common problems from the output and the exit code', async () => {
    const memory = await analyzeExit({ gameDir: dir, startedAt: 0, exitCode: 1, signal: null, lines: [line('Error occurred during initialization of VM'), line('Could not reserve enough space for 8388608KB object heap')] })
    expect(memory?.reason).toMatch(/memory settings/)
    const fabric = await analyzeExit({ gameDir: dir, startedAt: 0, exitCode: 1, signal: null, lines: [line('Incompatible mods found!')] })
    expect(fabric?.reason).toMatch(/incompatible or missing mods/)
    const access = await analyzeExit({ gameDir: dir, startedAt: 0, exitCode: -1073741819, signal: null, lines: [] })
    expect(access?.reason).toMatch(/graphics driver/)
  })

  it('reads the description from a crash report', () => {
    expect(describeReport('---- Minecraft Crash Report ----\nDescription: Ticking entity\n\njava.lang.NullPointerException: x\n')).toBe('Ticking entity: java.lang.NullPointerException: x')
    expect(describeReport('nothing here')).toBeNull()
  })

  it('suspects mods named by mixin errors and Fabric, but never Minecraft or Fabric itself', () => {
    const mods = suspectMods('Mixin [a.mixins.json:X] from mod sodium\nfrom mod minecraft', [
      line("\t - Mod 'Iris' (iris) 1.10.8 is incompatible with any version of mod 'Sodium' (sodium)")
    ])
    expect(mods.map((m) => m.id)).toEqual(['sodium', 'iris'])
  })
})

describe('gameEnvironment', () => {
  it('drops variables that would override the launcher\'s Java settings', () => {
    expect(gameEnvironment({ PATH: '/bin', JAVA_TOOL_OPTIONS: '-Xmx1G', ELECTRON_RUN_AS_NODE: '1', CLASSPATH: 'x', HOME: '/h' })).toEqual({ PATH: '/bin', HOME: '/h' })
  })
})
