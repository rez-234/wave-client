import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  expandArguments,
  gameArgumentTemplates,
  jvmArgumentTemplates,
  mergeVersions,
  resolveLibraries,
  rulesAllow,
  substitute,
  type RuleEnvironment,
  type VersionJson
} from './version'

const fixture = (name: string): VersionJson => JSON.parse(readFileSync(join(__dirname, '../../../test/fixtures', name), 'utf8')) as VersionJson
const vanilla = fixture('version-1.21.11.json')
const fabric = fixture('fabric-loader-0.19.4-1.21.11.json')

const env = (os: RuleEnvironment['os'], arch = 'x64', features: Record<string, boolean> = {}): RuleEnvironment => ({
  os,
  arch,
  osVersion: '10.0',
  features
})

describe('rules', () => {
  it('allows with no rules, otherwise the last matching rule decides', () => {
    expect(rulesAllow(undefined, env('linux'))).toBe(true)
    expect(rulesAllow([{ action: 'allow', os: { name: 'osx' } }], env('linux'))).toBe(false)
    expect(rulesAllow([{ action: 'allow', os: { name: 'osx' } }], env('osx'))).toBe(true)
    const allExceptMac = [{ action: 'allow' as const }, { action: 'disallow' as const, os: { name: 'osx' } }]
    expect(rulesAllow(allExceptMac, env('windows'))).toBe(true)
    expect(rulesAllow(allExceptMac, env('osx'))).toBe(false)
  })

  it('treats Mojang\'s "x86" as a 32-bit JVM and matches features', () => {
    expect(rulesAllow([{ action: 'allow', os: { arch: 'x86' } }], env('windows', 'x64'))).toBe(false)
    expect(rulesAllow([{ action: 'allow', os: { arch: 'x86' } }], env('windows', 'ia32'))).toBe(true)
    expect(rulesAllow([{ action: 'allow', features: { has_custom_resolution: true } }], env('linux'))).toBe(false)
    expect(rulesAllow([{ action: 'allow', features: { has_custom_resolution: true } }], env('linux', 'x64', { has_custom_resolution: true }))).toBe(true)
    expect(rulesAllow([{ action: 'allow', os: { version: '^10\\.' } }], env('windows'))).toBe(true)
    expect(rulesAllow([{ action: 'allow', os: { version: '(' } }], env('windows'))).toBe(false)
  })
})

describe('1.21.11', () => {
  it('picks each OS\'s natives and nothing else', () => {
    const names = (os: RuleEnvironment['os']) => resolveLibraries(vanilla.libraries!, env(os)).map((l) => l.name)
    const windows = names('windows')
    expect(windows).toContain('org.lwjgl:lwjgl:3.3.3:natives-windows')
    expect(windows).toContain('org.lwjgl:lwjgl:3.3.3:natives-windows-arm64')
    expect(windows.some((n) => n.includes('natives-linux') || n.includes('natives-macos'))).toBe(false)
    expect(windows).not.toContain('ca.weblite:java-objc-bridge:1.1')
    expect(names('osx')).toContain('ca.weblite:java-objc-bridge:1.1')
    expect(names('linux')).toContain('io.netty:netty-transport-native-epoll:4.2.7.Final:linux-x86_64')
  })

  it('takes download details from the version file', () => {
    const lwjgl = resolveLibraries(vanilla.libraries!, env('windows')).find((l) => l.name === 'org.lwjgl:lwjgl:3.3.3')!
    expect(lwjgl.path).toBe('org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3.jar')
    expect(lwjgl.url).toBe('https://libraries.minecraft.net/org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3.jar')
    expect(lwjgl.sha1).toMatch(/^[0-9a-f]{40}$/)
    expect(lwjgl.size).toBeGreaterThan(0)
  })

  it('expands the game arguments, with the resolution only when asked for', () => {
    const values = {
      auth_player_name: 'Steve',
      version_name: 'fabric-loader-0.19.4-1.21.11',
      game_directory: '/g',
      assets_root: '/a',
      assets_index_name: '29',
      auth_uuid: 'u',
      auth_access_token: 't',
      clientid: 'c',
      auth_xuid: 'x',
      version_type: 'release',
      resolution_width: '1280',
      resolution_height: '720'
    }
    const args = expandArguments(gameArgumentTemplates(vanilla), env('windows'), values)
    expect(args).toEqual([
      '--username', 'Steve', '--version', 'fabric-loader-0.19.4-1.21.11', '--gameDir', '/g', '--assetsDir', '/a',
      '--assetIndex', '29', '--uuid', 'u', '--accessToken', 't', '--clientId', 'c', '--xuid', 'x', '--versionType', 'release'
    ])
    const sized = expandArguments(gameArgumentTemplates(vanilla), env('windows', 'x64', { has_custom_resolution: true }), values)
    expect(sized.slice(-4)).toEqual(['--width', '1280', '--height', '720'])
    expect(sized).not.toContain('--demo')
  })

  it('expands the JVM arguments for each OS', () => {
    const values = { natives_directory: '/n', launcher_name: 'wave', launcher_version: '1', classpath: 'cp' }
    const mac = expandArguments(jvmArgumentTemplates(vanilla), env('osx', 'arm64'), values)
    expect(mac[0]).toBe('-XstartOnFirstThread')
    const windows = expandArguments(jvmArgumentTemplates(vanilla), env('windows'), values)
    expect(windows[0]).toMatch(/^-XX:HeapDumpPath=/)
    expect(windows).not.toContain('-Xss1M')
    expect(windows.slice(-2)).toEqual(['-cp', 'cp'])
    expect(windows).toContain('-Djava.library.path=/n')
  })
})

describe('Fabric on 1.21.11', () => {
  const merged = mergeVersions(fabric, vanilla)

  it('takes Fabric\'s main class and keeps vanilla\'s assets, downloads and Java', () => {
    expect(merged.id).toBe('fabric-loader-0.19.4-1.21.11')
    expect(merged.mainClass).toBe('net.fabricmc.loader.impl.launch.knot.KnotClient')
    expect(merged.inheritsFrom).toBeUndefined()
    expect(merged.assetIndex?.id).toBe('29')
    expect(merged.downloads?.client?.sha1).toBe(vanilla.downloads?.client?.sha1)
    expect(merged.javaVersion).toEqual({ component: 'java-runtime-delta', majorVersion: 21 })
    expect(merged.logging?.client?.file.id).toBe('client-1.21.2.xml')
  })

  it('puts Fabric\'s libraries first, from Fabric\'s Maven with their hashes', () => {
    const libraries = resolveLibraries(merged.libraries!, env('windows'))
    expect(libraries[0]!.name).toMatch(/^org\.ow2\.asm:asm:/)
    expect(libraries[0]!.sha1).toMatch(/^[0-9a-f]{40}$/)
    const loader = libraries.find((l) => l.coordinate.artifact === 'fabric-loader')!
    expect(loader.url).toBe(`https://maven.fabricmc.net/${loader.path}`)
    // Fabric's profile has no hash for the loader and intermediary: the installer fetches Maven's .sha1.
    expect(loader.sha1).toBeUndefined()
    expect(libraries.some((l) => l.coordinate.artifact === 'intermediary')).toBe(true)
  })

  it('keeps Fabric\'s copy when vanilla lists the same library', () => {
    const parent: VersionJson = { id: 'p', libraries: [{ name: 'org.ow2.asm:asm:9.0', downloads: { artifact: { url: 'https://old', sha1: 'a', size: 1 } } }] }
    const child: VersionJson = { id: 'c', inheritsFrom: 'p', libraries: [{ name: 'org.ow2.asm:asm:9.10.1', url: 'https://maven.fabricmc.net/' }] }
    const libraries = resolveLibraries(mergeVersions(child, parent).libraries!, env('linux'))
    expect(libraries.map((l) => l.name)).toEqual(['org.ow2.asm:asm:9.10.1'])
  })

  it('keeps Fabric\'s JVM argument (with spaces) as one argument after vanilla\'s', () => {
    const args = expandArguments(jvmArgumentTemplates(merged), env('linux'), { classpath: 'cp' })
    expect(args.at(-1)).toBe('-DFabricMcEmu= net.minecraft.client.main.Main ')
    expect(args.indexOf('-cp')).toBeLessThan(args.length - 1)
  })
})

describe('substitute', () => {
  it('replaces known placeholders and leaves unknown ones', () => {
    expect(substitute('${a}-${b}-${a}', { a: '1' })).toBe('1-${b}-1')
    expect(substitute('${a}', { a: '$&' })).toBe('$&')
  })

  it('does not treat prototype properties as values', () => {
    expect(substitute('${constructor}', {})).toBe('${constructor}')
  })
})
