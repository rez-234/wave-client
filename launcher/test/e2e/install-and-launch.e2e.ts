import { randomBytes } from 'node:crypto'
import { access, mkdir, readdir, stat } from 'node:fs/promises'
import { release, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS, type LogLine } from '@shared/ipc'

import { buildLaunchCommand } from '../../src/main/game/launch-command'
import { prepareGame } from '../../src/main/game/install'
import { PINS } from '../../src/main/game/pins'
import { GameSession, type GameExit } from '../../src/main/game/process'
import { DownloadQueue } from '../../src/main/net/downloads'
import { HttpClient } from '../../src/main/net/http'
import { launcherPaths } from '../../src/main/paths'

/**
 * The launcher's real install and launch code against Mojang's and Fabric's servers: installs
 * Minecraft, Fabric, Java, assets, Fabric API and our mod, then starts the game and waits for the
 * mod to initialize. Uses a stand-in offline player, like Fabric's dev runs; the launcher itself
 * always needs a Microsoft account.
 */
describe('install and launch', () => {
  it('installs everything and the game starts with Wave Client loaded', async () => {
    const modJar = process.env.WAVE_MOD_JAR
    expect(modJar, 'WAVE_MOD_JAR must point at the built mod jar').toBeTruthy()
    const root = resolve(process.env.WAVE_E2E_HOME ?? join(tmpdir(), `wave-e2e-${Date.now()}`))
    await mkdir(root, { recursive: true })
    const paths = launcherPaths(root)
    const http = new HttpClient({ fetch: (url, init) => fetch(url, init), userAgent: 'WaveClient-CI/1.0 (+https://github.com/rez-234/wave-client)' })
    const queue = new DownloadQueue({ http, concurrency: 16 })
    const tasks = new Set<string>()
    const started = Date.now()

    const game = await prepareGame(
      { http, queue, paths, platform: process.platform, arch: process.arch, osVersion: release() },
      { bundledModJar: resolve(modJar!), onTask: (task) => tasks.add(task.label) }
    )

    console.log(`Installed in ${Math.round((Date.now() - started) / 1000)} s; tasks: ${[...tasks].join(', ')}`)
    expect(game.version.id).toBe(`fabric-loader-${PINS.fabricLoader}-${PINS.minecraft}`)
    await access(game.java)
    expect((await readdir(paths.client)).sort()).toEqual([`fabric-api-${PINS.fabricApi}.jar`, resolve(modJar!).split(/[\\/]/).pop()].sort())
    expect((await stat(join(paths.versions, PINS.minecraft, `${PINS.minecraft}.jar`))).size).toBeGreaterThan(10_000_000)

    // A second check of an installed game downloads nothing but metadata, quickly.
    const recheck = Date.now()
    await prepareGame({ http, queue, paths, platform: process.platform, arch: process.arch, osVersion: release() }, { bundledModJar: resolve(modJar!) })
    console.log(`Re-check took ${Date.now() - recheck} ms`)

    // And with no network at all (how Electron's net.fetch fails offline), from what was saved.
    const offline = new HttpClient({
      fetch: async () => {
        throw new Error('net::ERR_INTERNET_DISCONNECTED')
      },
      userAgent: 'offline',
      backoffMs: () => 0
    })
    const offlineGame = await prepareGame(
      { http: offline, queue: new DownloadQueue({ http: offline, retries: 0 }), paths, platform: process.platform, arch: process.arch, osVersion: release() },
      { bundledModJar: resolve(modJar!) }
    )
    expect(offlineGame.classpath).toEqual(game.classpath)
    expect(offlineGame.java).toBe(game.java)

    const command = buildLaunchCommand({
      ...game,
      account: { name: 'WaveCI', uuid: randomBytes(16).toString('hex'), accessToken: `offline-${randomBytes(8).toString('hex')}`, xuid: '' },
      settings: { ...DEFAULT_SETTINGS, memoryMb: 2048 },
      launcherName: 'wave-client',
      launcherVersion: 'e2e',
      clientId: Buffer.from('e2e').toString('base64')
    })

    const lines: LogLine[] = []
    let session: GameSession | undefined
    const exit = new Promise<GameExit>((resolveExit) => {
      session = new GameSession(command, {
        onLines: (batch) => {
          lines.push(...batch)

          for (const line of batch) {
            if (line.level === 'ERROR' || line.level === 'FATAL' || /Wave Client|Fabric|Loading Minecraft/.test(line.message)) {
              console.log(`[game/${line.level}] ${line.message}`)
            }
          }
        },
        onExit: resolveExit
      })
      session.start()
    })

    // The mod logs this from its client initializer; then give the game time to finish loading.
    const initialized = await waitFor(() => lines.some((line) => /Wave Client .* initialized/.test(line.message)), exit, 5 * 60_000)
    expect(initialized, 'Wave Client never initialized').toBe(true)
    const crashedEarly = await waitFor(() => false, exit, 30_000)
    expect(crashedEarly, 'the game exited while loading').toBe(false)

    session!.kill()
    const result = await exit
    expect(result.killed).toBe(true)
    expect(result.crash, 'closing the game from the launcher is not a crash').toBeNull()
    expect(lines.some((line) => line.message.includes(command.secrets[0]!))).toBe(false)
    console.log(`Game stopped (${result.signal ?? result.code}); ${lines.length} log lines`)
  })
})

/** Polls until the condition holds (true), the game exits (false) or the timeout passes (false). */
async function waitFor(condition: () => boolean, exit: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let exited = false
  void exit.then(() => {
    exited = true
  })
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (condition()) {
      return true
    }

    if (exited) {
      return false
    }

    await new Promise((r) => setTimeout(r, 250))
  }

  return condition()
}
