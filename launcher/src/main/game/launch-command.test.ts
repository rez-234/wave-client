import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS } from '@shared/ipc'

import { buildLaunchCommand, redact, type LaunchInput } from './launch-command'
import { mergeVersions, type VersionJson } from './version'

const fixture = (name: string): VersionJson => JSON.parse(readFileSync(join(__dirname, '../../../test/fixtures', name), 'utf8')) as VersionJson
const merged = mergeVersions(fixture('fabric-loader-0.19.4-1.21.11.json'), fixture('version-1.21.11.json'))
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.secret-access-token'

const input = (overrides: Partial<LaunchInput> = {}): LaunchInput => ({
  version: merged,
  env: { os: 'linux', arch: 'x64', osVersion: '6.0', features: {} },
  java: '/rt/bin/java',
  classpath: ['/lib/a.jar', '/lib/b.jar', '/versions/1.21.11/1.21.11.jar'],
  gameDir: '/inst/default',
  nativesDir: '/versions/fabric/natives',
  librariesDir: '/lib',
  assetsRoot: '/assets',
  assetIndexName: '29',
  logConfigPath: '/assets/log_configs/client-1.21.2.xml',
  addMods: ['/client'],
  account: { name: 'Steve', uuid: '0123456789abcdef0123456789abcdef', accessToken: TOKEN, xuid: '2535' },
  settings: { ...DEFAULT_SETTINGS, memoryMb: 4096, jvmArgs: '-XX:+UseZGC -Xmx6G' },
  launcherName: 'wave-client',
  launcherVersion: '0.1.0',
  clientId: 'client-id',
  ...overrides
})

describe('buildLaunchCommand', () => {
  it('builds JVM options, the main class and game arguments in order', () => {
    const { java, args, cwd, secrets } = buildLaunchCommand(input())
    const main = args.indexOf('net.fabricmc.loader.impl.launch.knot.KnotClient')

    expect(java).toBe('/rt/bin/java')
    expect(cwd).toBe('/inst/default')
    expect(secrets).toEqual([TOKEN])
    expect(args.slice(0, main)).toEqual([
      '-Djava.library.path=/versions/fabric/natives',
      '-Djna.tmpdir=/versions/fabric/natives',
      '-Dorg.lwjgl.system.SharedLibraryExtractPath=/versions/fabric/natives',
      '-Dio.netty.native.workdir=/versions/fabric/natives',
      '-Dminecraft.launcher.brand=wave-client',
      '-Dminecraft.launcher.version=0.1.0',
      '-cp',
      '/lib/a.jar:/lib/b.jar:/versions/1.21.11/1.21.11.jar',
      '-DFabricMcEmu= net.minecraft.client.main.Main ',
      '-Dlog4j.configurationFile=/assets/log_configs/client-1.21.2.xml',
      '-Xms1024M',
      '-Xmx4096M',
      '-Dfabric.addMods=/client',
      // The user's own flags come last, so their -Xmx wins.
      '-XX:+UseZGC',
      '-Xmx6G'
    ])
    expect(args.slice(main + 1)).toEqual([
      '--username', 'Steve', '--version', 'fabric-loader-0.19.4-1.21.11', '--gameDir', '/inst/default', '--assetsDir', '/assets',
      '--assetIndex', '29', '--uuid', '0123456789abcdef0123456789abcdef', '--accessToken', TOKEN, '--clientId', 'client-id',
      '--xuid', '2535', '--versionType', 'release', '--width', '1280', '--height', '720'
    ])
  })

  it('uses Windows separators and flags on Windows, and fullscreen instead of a size', () => {
    const { args } = buildLaunchCommand(input({ env: { os: 'windows', arch: 'x64', osVersion: '10.0', features: {} }, settings: { ...DEFAULT_SETTINGS, fullscreen: true } }))
    expect(args[0]).toMatch(/^-XX:HeapDumpPath=/)
    expect(args).toContain('/lib/a.jar;/lib/b.jar;/versions/1.21.11/1.21.11.jar')
    expect(args.at(-1)).toBe('--fullscreen')
    expect(args).not.toContain('--width')
  })

  it('starts macOS on the first thread and never adds the 32-bit stack flag on 64-bit', () => {
    const { args } = buildLaunchCommand(input({ env: { os: 'osx', arch: 'arm64', osVersion: '24.0', features: {} } }))
    expect(args[0]).toBe('-XstartOnFirstThread')
    expect(args).not.toContain('-Xss1M')
  })

  it('refuses to launch with a placeholder it cannot fill', () => {
    const broken: VersionJson = { ...merged, arguments: { jvm: ['-cp', '${classpath}'], game: ['--mystery', '${unknown_thing}'] } }
    expect(() => buildLaunchCommand(input({ version: broken }))).toThrow(/unknown_thing/)
  })
})

describe('redact', () => {
  it('removes every copy of each secret', () => {
    expect(redact(`--accessToken ${TOKEN} and again ${TOKEN}`, [TOKEN])).toBe('--accessToken [redacted] and again [redacted]')
    expect(redact('short', ['abc'])).toBe('short')
  })
})
