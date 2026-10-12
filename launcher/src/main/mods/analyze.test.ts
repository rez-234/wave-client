import { describe, expect, it } from 'vitest'

import { analyzeMods } from './analyze'
import { parseFabricModJson } from './metadata'
import type { AnalysisInput, IncludedSpec, ModJarInfo, ModMetadata, ModReadResult, ScannedMod } from './types'

const NOW = 1_800_000_000_000

const meta = (id: string, version: string, extra: Record<string, unknown> = {}): ModMetadata => parseFabricModJson(JSON.stringify({ schemaVersion: 1, id, version, ...extra }))
const info = (metadata: ModMetadata, nested: ModJarInfo[] = []): ModJarInfo => ({ metadata, nonFabric: null, nested })

function jar(file: string, read: ModMetadata | ModReadResult, options: { nested?: ModJarInfo[]; mtimeMs?: number } = {}): ScannedMod {
  const off = file.endsWith('.disabled')
  const key = off ? file.slice(0, -'.disabled'.length) : file
  const state = off ? 'off' : file.endsWith('.jar') ? 'on' : 'case'
  const result: ModReadResult = 'ok' in read ? read : { ok: true, info: info(read, options.nested) }
  return { key, file, state, size: 1000, mtimeMs: options.mtimeMs ?? NOW - 60_000, read: result }
}

const MODULES = [
  { id: 'fabric-api-base', version: '1.0.5', provides: [] },
  { id: 'fabric-tag-api-v1', version: '1.2.0', provides: ['fabric-client-tags-api-v1'] }
]

function included(modules = MODULES): IncludedSpec[] {
  return [
    { id: 'fabricloader', name: 'Fabric Loader', version: '0.19.5', provides: [], nested: [{ id: 'mixinextras', version: '0.5.5', provides: [] }] },
    { id: 'fabric-api', name: 'Fabric API', version: '0.141.6+1.21.11', provides: ['fabric'], nested: modules },
    { id: 'waveclient', name: 'Wave Client', version: '1.0.0', provides: [], nested: [] }
  ]
}

function analyze(mods: ScannedMod[], extra: Partial<AnalysisInput> = {}): ReturnType<typeof analyzeMods> {
  return analyzeMods({ mods, minecraft: '1.21.11', javaMajor: 21, included: included(), overrides: null, customFabricOptions: false, now: NOW, ...extra })
}

const problemsOf = (analysis: ReturnType<typeof analyzeMods>, key: string) => analysis.mods.get(key)!.problems
const codes = (analysis: ReturnType<typeof analyzeMods>, key: string): string[] => problemsOf(analysis, key).map((p) => `${p.severity}:${p.code}`)

const sodium = (version = '0.6.13', extra: Record<string, unknown> = {}): ModMetadata =>
  meta('sodium', version, { name: 'Sodium', depends: { minecraft: '~1.21.11', fabricloader: '>=0.16' }, ...extra })

describe('analyzeMods', () => {
  it('passes a mod whose requirements are all met by the game, the loader and Fabric API', () => {
    const analysis = analyze([
      jar(
        'good.jar',
        meta('good', '1.0.0', {
          depends: { minecraft: ['1.21.x'], java: '>=21', fabricloader: '>=0.16.0', 'fabric-api': '*', fabric: '*', 'fabric-api-base': '*', 'fabric-client-tags-api-v1': '*', mixinextras: '>=0.4' }
        })
      )
    ])
    expect(analysis.mods.get('good.jar')).toEqual({ loads: true, problems: [], neededBy: [] })
    expect(analysis).toMatchObject({ errors: 0, warnings: 0, profileProblems: [] })
  })

  describe('requirements Fabric checks against the game itself', () => {
    it('minecraft: names the version the mod was made for', () => {
      const analysis = analyze([jar('old.jar', meta('old', '1', { depends: { minecraft: '1.20.1' } }))])
      expect(problemsOf(analysis, 'old.jar')).toEqual([
        { severity: 'error', code: 'minecraft', message: 'Made for Minecraft 1.20.1. Get the version of this mod for 1.21.11.', detail: 'depends minecraft "1.20.1"' }
      ])
      expect(analysis.errors).toBe(1)
    })

    it('minecraft: words several ranges generally', () => {
      const analysis = analyze([jar('old.jar', meta('old', '1', { depends: { minecraft: ['1.20.1', '1.20.4'] } }))])
      expect(problemsOf(analysis, 'old.jar')[0]!.message).toBe('Made for a different Minecraft version. Get the version of this mod for 1.21.11.')
    })

    it('loader: a mod needing a newer Fabric Loader', () => {
      const analysis = analyze([jar('new.jar', meta('new', '1', { depends: { fabricloader: '>=0.20.0' } }))])
      expect(problemsOf(analysis, 'new.jar')[0]).toMatchObject({
        code: 'loader',
        message: 'Needs a newer Fabric Loader than Wave Client uses (0.19.5). Use an older version of this mod.'
      })
    })

    it('java: a mod needing a newer Java', () => {
      const analysis = analyze([jar('j.jar', meta('jmod', '1', { depends: { java: '>=25' } }))])
      expect(problemsOf(analysis, 'j.jar')[0]).toMatchObject({ severity: 'error', code: 'java', message: 'Needs Java 25 or later. Choose a newer Java in Settings.' })
    })

    it('breaks against the game is an error', () => {
      const analysis = analyze([jar('b.jar', meta('bmod', '1', { breaks: { minecraft: '>=1.21.5' } }))])
      expect(codes(analysis, 'b.jar')).toEqual(['error:breaks'])
    })
  })

  describe('dependencies on other mods', () => {
    it('missing: says how to get it and carries the id', () => {
      const analysis = analyze([jar('menu.jar', meta('modmenu', '1', { depends: { 'cloth-config': '>=15' } }))])
      expect(problemsOf(analysis, 'menu.jar')).toEqual([
        {
          severity: 'error',
          code: 'missing',
          message: 'Needs cloth-config. Download its Fabric version for Minecraft 1.21.11 and add it here.',
          detail: 'depends cloth-config ">=15"',
          modId: 'cloth-config'
        }
      ])
    })

    it('an empty requirement list can never be met', () => {
      const analysis = analyze([jar('a.jar', meta('amod', '1', { depends: { bmod: [] } })), jar('b.jar', meta('bmod', '1'))])
      expect(codes(analysis, 'a.jar')).toEqual(['error:dependency-version'])
    })

    it('disabled-dependency: a turned-off mod would meet it, with a fix to turn it on', () => {
      const analysis = analyze([jar('menu.jar', meta('modmenu', '1', { depends: { 'cloth-config': '*' } })), jar('cloth.jar.disabled', meta('cloth-config', '15.0.0', { name: 'Cloth Config' }))])
      expect(problemsOf(analysis, 'menu.jar')).toEqual([
        {
          severity: 'error',
          code: 'disabled-dependency',
          message: 'Needs Cloth Config (turned off).',
          detail: 'depends cloth-config "*"',
          fix: { kind: 'enable', key: 'cloth.jar', label: 'Turn on Cloth Config' }
        }
      ])
      expect(analysis.mods.get('cloth.jar')).toEqual({ loads: false, problems: [], neededBy: ['modmenu'] })
    })

    it('dependency-version: names what is wanted and what is installed', () => {
      const analysis = analyze([jar('iris.jar', meta('iris', '1', { depends: { sodium: '>=0.6' } })), jar('sodium.jar', sodium('0.5.8'))])
      expect(problemsOf(analysis, 'iris.jar')[0]).toMatchObject({ severity: 'error', code: 'dependency-version', message: 'Needs Sodium 0.6 or later (0.5.8 installed).' })
    })

    it('is met by a mod nested in another jar, by id or by provides', () => {
      const analysis = analyze([
        jar('a.jar', meta('amod', '1', { depends: { 'cloth-config': '>=15', cloth: '*' } })),
        jar('b.jar', meta('bmod', '1'), { nested: [info(meta('cloth-config', '15.0.1', { provides: ['cloth'] }))] })
      ])
      expect(codes(analysis, 'a.jar')).toEqual([])
    })

    it('is not met by a nested mod that itself fails its Minecraft requirement, or one inside a jar that does not load', () => {
      const analysis = analyze([
        jar('a.jar', meta('amod', '1', { depends: { lib: '*', lib2: '*' } })),
        jar('b.jar', meta('bmod', '1'), { nested: [info(meta('lib', '1', { depends: { minecraft: '1.19' } }))] }),
        jar('c.jar.disabled', meta('cmod', '1'), { nested: [info(meta('lib2', '1'))] })
      ])
      expect(codes(analysis, 'a.jar')).toEqual(['error:missing', 'error:missing'])
      // The nested library's own failure is not reported: Fabric just doesn't load it.
      expect(codes(analysis, 'b.jar')).toEqual([])
    })

    it('a dependency only a present server-only mod meets is no problem', () => {
      const analysis = analyze([jar('a.jar', meta('amod', '1', { depends: { serverlib: '*' } })), jar('s.jar', meta('serverlib', '1', { environment: 'server' }))])
      expect(codes(analysis, 'a.jar')).toEqual([])
      expect(codes(analysis, 's.jar')).toEqual(['warning:server-only'])
      expect(analysis.mods.get('s.jar')!.loads).toBe(false)
    })

    it('a mod may depend on its own id or on what it provides', () => {
      const analysis = analyze([jar('a.jar', meta('amod', '1.0.0', { provides: ['amod-api'], depends: { 'amod-api': '*', amod: '>=1' }, recommends: { amod: '*' } }))])
      expect(codes(analysis, 'a.jar')).toEqual([])
    })

    it('a dependency only a server-only mod nested in another jar meets is no problem', () => {
      const analysis = analyze([
        jar('b.jar', meta('bmod', '1.0.0'), { nested: [info(meta('srvlib', '1.0.0', { environment: 'server' }))] }),
        jar('c.jar', meta('cmod', '1.0.0', { depends: { srvlib: '*' } }))
      ])
      expect(codes(analysis, 'c.jar')).toEqual([])
      expect(analysis.errors).toBe(0)
    })

    it('a server-only copy meets a dependency even when a turned-off copy is there too (Fabric never sees turned-off files)', () => {
      const analysis = analyze([jar('a.jar', meta('amod', '1', { depends: { serverlib: '*' } })), jar('s.jar', meta('serverlib', '1', { environment: 'server' })), jar('old.jar.disabled', meta('serverlib', '0.9'))])
      expect(codes(analysis, 'a.jar')).toEqual([])
    })

    it('a server-only copy does not excuse a dependency when another copy with that id is there (Fabric keeps it required)', () => {
      const analysis = analyze([
        jar('lib-1.jar', meta('lib', '1.0.0')),
        jar('lib-srv.jar', meta('lib', '2.0.0', { environment: 'server' })),
        jar('aa.jar', meta('aa', '1.0.0', { depends: { lib: '>=2' } }))
      ])
      expect(codes(analysis, 'aa.jar')).toEqual(['error:dependency-version'])
    })

    it('only the id of a server-only mod counts, not what it provides', () => {
      const analysis = analyze([jar('a.jar', meta('amod', '1', { depends: { 'srv-api': '*' } })), jar('s.jar', meta('serverlib', '1', { environment: 'server', provides: ['srv-api'] }))])
      expect(codes(analysis, 'a.jar')).toEqual(['error:missing'])
    })

    it('unknown Fabric API modules: a warning only when the module list is unknown', () => {
      const mod = jar('a.jar', meta('amod', '1', { depends: { 'fabric-new-api-v1': '*' } }))
      expect(codes(analyzeMods({ ...baseInput([mod]), included: included([]) }), 'a.jar')).toEqual(['warning:unknown-dependency'])
      expect(codes(analyze([mod]), 'a.jar')).toEqual(['error:missing'])
    })

    it('does not mistake fabric-language-kotlin for a Fabric API module', () => {
      const analysis = analyze([jar('a.jar', meta('amod', '1', { depends: { 'fabric-language-kotlin': '>=1.12' } }))])
      expect(codes(analysis, 'a.jar')).toEqual(['error:missing'])
    })

    it('MixinExtras comes with the loader; a newer copy in mods is fine', () => {
      const analysis = analyze([jar('a.jar', meta('amod', '1', { depends: { mixinextras: '>=0.5.0' } })), jar('mixinextras.jar', meta('mixinextras', '0.6.0'))])
      expect(codes(analysis, 'a.jar')).toEqual([])
      expect(codes(analysis, 'mixinextras.jar')).toEqual([])
    })
  })

  describe('breaks, conflicts and recommends', () => {
    it('breaks: an error against another loaded top-level mod, with a fix to turn it off', () => {
      const analysis = analyze([jar('a.jar', meta('amod', '1', { breaks: { optifabric: '*' } })), jar('o.jar', meta('optifabric', '1.0', { name: 'OptiFabric' }))])
      expect(problemsOf(analysis, 'a.jar')).toEqual([
        {
          severity: 'error',
          code: 'breaks',
          message: "Doesn't work with OptiFabric 1.0. Turn one of them off.",
          detail: 'breaks optifabric "*"',
          fix: { kind: 'disable', key: 'o.jar', label: 'Turn off OptiFabric' }
        }
      ])
    })

    it('breaks: nothing when the match is only nested (Fabric just leaves it out) or turned off', () => {
      const analysis = analyze([
        jar('a.jar', meta('amod', '1', { breaks: { lib: '*', offmod: '*' } })),
        jar('b.jar', meta('bmod', '1'), { nested: [info(meta('lib', '1'))] }),
        jar('off.jar.disabled', meta('offmod', '1'))
      ])
      expect(codes(analysis, 'a.jar')).toEqual([])
    })

    it('breaks: against an included mod (Fabric API) is an error too', () => {
      const analysis = analyze([jar('a.jar', meta('amod', '1', { breaks: { 'fabric-api': '<1' } }))])
      expect(codes(analysis, 'a.jar')).toEqual(['error:breaks'])
      expect(problemsOf(analysis, 'a.jar')[0]!.fix).toEqual({ kind: 'disable', key: 'a.jar', label: 'Turn off amod' })
    })

    it('conflicts: a warning', () => {
      const analysis = analyze([jar('a.jar', meta('amod', '1', { conflicts: { bmod: '*' } })), jar('b.jar', meta('bmod', '2'))])
      expect(codes(analysis, 'a.jar')).toEqual(['warning:conflicts'])
    })

    it('recommends: a warning when not met', () => {
      const analysis = analyze([jar('a.jar', meta('amod', '1', { recommends: { modmenu: '*', 'fabric-api': '*' } }))])
      expect(problemsOf(analysis, 'a.jar')).toEqual([{ severity: 'warning', code: 'recommends', message: 'Works best with modmenu.', detail: 'recommends modmenu "*"' }])
    })
  })

  describe('built-in and included mods', () => {
    it('a jar claiming to be minecraft or java, even nested deep inside, stops the launch', () => {
      const analysis = analyze([
        jar('mc.jar', meta('minecraft', '1.21.11')),
        jar('deep.jar', meta('deepmod', '1'), { nested: [info(meta('lib', '1'), [info(meta('inner', '1', { provides: ['java'] }))])] })
      ])
      expect(codes(analysis, 'mc.jar')).toEqual(['error:built-in'])
      expect(codes(analysis, 'deep.jar')).toEqual(['error:built-in'])
      expect(problemsOf(analysis, 'deep.jar')[0]!.fix).toEqual({ kind: 'remove', key: 'deep.jar', label: 'Remove it' })
    })

    it('a Fabric Loader or Wave Client jar in mods is an error', () => {
      const analysis = analyze([jar('loader.jar', meta('fabricloader', '0.20.0')), jar('wave.jar', meta('waveclient', '9.0.0'))])
      expect(codes(analysis, 'loader.jar')).toEqual(['error:built-in'])
      expect(codes(analysis, 'wave.jar')).toEqual(['error:built-in'])
      expect(analysis.mods.get('loader.jar')!.loads).toBe(false)
    })

    it('an older or equal Fabric API in mods: not needed, a warning', () => {
      const analysis = analyze([jar('fabric-api.jar', meta('fabric-api', '0.141.6+1.21.11', { provides: ['fabric'] }))])
      expect(problemsOf(analysis, 'fabric-api.jar')).toEqual([
        {
          severity: 'warning',
          code: 'fabric-api-copy',
          message: 'Not needed: Wave Client already includes Fabric API 0.141.6+1.21.11.',
          fix: { kind: 'remove', key: 'fabric-api.jar', label: 'Remove this copy' }
        }
      ])
      expect(analysis.mods.get('fabric-api.jar')!.loads).toBe(false)
    })

    it('a newer Fabric API in mods replaces the included one, modules and all', () => {
      const newer = jar('fabric-api.jar', meta('fabric-api', '0.142.0+1.21.11', { provides: ['fabric'], depends: { minecraft: '>=1.21.11- <1.21.12-' } }), {
        nested: [info(meta('fabric-brand-new-api-v1', '1.0.0'))]
      })
      const user = jar('u.jar', meta('umod', '1', { depends: { 'fabric-brand-new-api-v1': '*', 'fabric-api-base': '*' } }))
      const analysis = analyze([newer, user])
      expect(problemsOf(analysis, 'fabric-api.jar')).toEqual([
        { severity: 'warning', code: 'fabric-api-copy', message: 'Replaces the Fabric API included with Wave Client (0.141.6+1.21.11).' }
      ])
      expect(analysis.mods.get('fabric-api.jar')!.loads).toBe(true)
      // Its own modules count; the included jar's don't any more.
      expect(codes(analysis, 'u.jar')).toEqual(['error:missing'])
      expect(problemsOf(analysis, 'u.jar')[0]!.modId).toBe('fabric-api-base')
    })

    it('a newer Fabric API made for another Minecraft is unused instead', () => {
      const analysis = analyze([jar('fabric-api.jar', meta('fabric-api', '0.150.0+1.22', { provides: ['fabric'], depends: { minecraft: '1.22' } }))])
      expect(codes(analysis, 'fabric-api.jar')).toEqual(['warning:fabric-api-copy'])
      expect(analysis.errors).toBe(0)
    })
  })

  describe('several copies of a mod', () => {
    it('the newest loads; the others are unused, a warning with a fix', () => {
      const analysis = analyze([jar('sodium-0.6.12.jar', sodium('0.6.12')), jar('sodium-0.6.13.jar', sodium('0.6.13'))])
      expect(analysis.mods.get('sodium-0.6.13.jar')).toEqual({ loads: true, problems: [], neededBy: [] })
      expect(analysis.mods.get('sodium-0.6.12.jar')).toEqual({
        loads: false,
        neededBy: [],
        problems: [
          {
            severity: 'warning',
            code: 'duplicate',
            message: 'Not used: Sodium 0.6.13 (sodium-0.6.13.jar) loads instead.',
            fix: { kind: 'remove', key: 'sodium-0.6.12.jar', label: 'Remove this copy' }
          }
        ]
      })
      expect(analysis.errors).toBe(0)
    })

    it('a newer copy that cannot load (made for another Minecraft) loses to an older one that can', () => {
      const analysis = analyze([jar('a.jar', sodium('0.7.0', { depends: { minecraft: '1.22' } })), jar('b.jar', sodium('0.6.13'))])
      expect(codes(analysis, 'a.jar')).toEqual(['warning:duplicate'])
      expect(codes(analysis, 'b.jar')).toEqual([])
      expect(analysis.errors).toBe(0)
    })

    it('when no copy can load, each keeps its own errors', () => {
      const analysis = analyze([jar('a.jar', sodium('0.5.0', { depends: { minecraft: '1.20.1' } })), jar('b.jar', sodium('0.5.1', { depends: { minecraft: '1.20.4' } }))])
      expect(codes(analysis, 'a.jar')).toEqual(['error:minecraft'])
      expect(codes(analysis, 'b.jar')).toEqual(['error:minecraft'])
    })

    it('a tie goes to the first file name; only the winner\'s dependencies count', () => {
      const analysis = analyze([jar('b.jar', meta('dup', '1.0.0', { depends: { nothing: '*' } })), jar('a.jar', meta('dup', '1.0.0'))])
      expect(codes(analysis, 'a.jar')).toEqual([])
      expect(codes(analysis, 'b.jar')).toEqual(['warning:duplicate'])
    })

    it('a mod providing the id of another counts as a copy', () => {
      const analysis = analyze([jar('a.jar', meta('cloth-config', '15.0.0')), jar('b.jar', meta('cloth-fork', '16.0.0', { provides: ['cloth-config'] }))])
      expect(codes(analysis, 'a.jar')).toEqual(['warning:duplicate'])
      expect(analysis.mods.get('b.jar')!.loads).toBe(true)
    })

    it('the copy another mod needs loads, not the newest (Fabric picks a set that works)', () => {
      const analysis = analyze([jar('lib-1.jar', meta('lib', '1.0.0')), jar('lib-2.jar', meta('lib', '2.0.0')), jar('a.jar', meta('aa', '1.0.0', { depends: { lib: '<2' } }))])
      expect(codes(analysis, 'a.jar')).toEqual([])
      expect(analysis.mods.get('lib-1.jar')).toMatchObject({ loads: true, problems: [] })
      expect(analysis.mods.get('lib-2.jar')).toMatchObject({ loads: false, problems: [{ severity: 'warning', code: 'duplicate', message: 'Not used: lib 1.0.0 (lib-1.jar) loads instead.' }] })
      expect(analysis.errors).toBe(0)
    })

    it('a copy another mod breaks loses to one it does not break', () => {
      const analysis = analyze([jar('lib-1.jar', meta('lib', '1.0.0')), jar('lib-2.jar', meta('lib', '2.0.0')), jar('a.jar', meta('aa', '1.0.0', { breaks: { lib: '>=2' } }))])
      expect(codes(analysis, 'a.jar')).toEqual([])
      expect(analysis.mods.get('lib-1.jar')!.loads).toBe(true)
      expect(codes(analysis, 'lib-2.jar')).toEqual(['warning:duplicate'])
      expect(analysis.errors).toBe(0)
    })

    it('a newer copy whose own dependency is missing loses to an older one that works', () => {
      const analysis = analyze([jar('lib-1.jar', meta('lib', '1.0.0')), jar('lib-2.jar', meta('lib', '2.0.0', { depends: { other: '*' } }))])
      expect(analysis.mods.get('lib-1.jar')).toMatchObject({ loads: true, problems: [] })
      expect(codes(analysis, 'lib-2.jar')).toEqual(['warning:duplicate'])
      expect(analysis.errors).toBe(0)
    })

    it('when mods need different copies, only a warning (which copy Fabric picks decides it)', () => {
      const analysis = analyze([
        jar('lib-1.jar', meta('lib', '1.0.0')),
        jar('lib-2.jar', meta('lib', '2.0.0')),
        jar('a.jar', meta('aa', '1.0.0', { depends: { lib: '<2' } })),
        jar('b.jar', meta('bb', '1.0.0', { depends: { lib: '>=2' } }))
      ])
      expect(analysis.errors).toBe(0)
      expect(problemsOf(analysis, 'a.jar')).toEqual([
        expect.objectContaining({ severity: 'warning', code: 'dependency-version', message: 'Needs lib older than 2. Fabric may load lib 1.0.0 (lib-1.jar) instead; if the game doesn\'t start, remove the copy you don\'t need.' })
      ])
    })

    it('a top-level copy that cannot load is unused when a copy nested in another mod can', () => {
      const analysis = analyze([
        jar('cloth-old.jar', meta('cloth-config', '11.0.0', { depends: { minecraft: '1.20.1' } })),
        jar('rei.jar', meta('rei', '1.0.0', { depends: { 'cloth-config': '*' } }), { nested: [info(meta('cloth-config', '20.0.0', { name: 'Cloth Config', depends: { minecraft: '~1.21.11' } }))] })
      ])
      expect(analysis.mods.get('cloth-old.jar')).toMatchObject({
        loads: false,
        problems: [
          {
            severity: 'warning',
            code: 'duplicate',
            message: 'Not used: Cloth Config 20.0.0 (inside rei.jar) loads instead.',
            fix: { kind: 'remove', key: 'cloth-old.jar', label: 'Remove this copy' }
          }
        ]
      })
      expect(codes(analysis, 'rei.jar')).toEqual([])
      expect(analysis.errors).toBe(0)
    })

    it('a nested copy rescues a top-level one only if it can load and covers every id the top-level one has', () => {
      const analysis = analyze([
        jar('x-old.jar', meta('xlib', '1.0.0', { provides: ['xapi'], depends: { minecraft: '1.20.1' } })),
        jar('host.jar', meta('host', '1.0.0'), { nested: [info(meta('xlib', '2.0.0'))] }),
        jar('y-old.jar', meta('ylib', '1.0.0', { depends: { minecraft: '1.20.1' } })),
        jar('host2.jar', meta('host2', '1.0.0'), { nested: [info(meta('ylib', '2.0.0', { depends: { minecraft: '1.20.1' } }))] })
      ])
      expect(codes(analysis, 'x-old.jar')).toEqual(['error:minecraft'])
      expect(codes(analysis, 'y-old.jar')).toEqual(['error:minecraft'])
    })

    it('a top-level copy next to a nested copy is never reported', () => {
      const analysis = analyze([jar('cloth.jar', meta('cloth-config', '15.0.0')), jar('menu.jar', meta('modmenu', '1'), { nested: [info(meta('cloth-config', '14.0.0'))] })])
      expect(codes(analysis, 'cloth.jar')).toEqual([])
      expect(codes(analysis, 'menu.jar')).toEqual([])
    })
  })

  describe('files Fabric does not load', () => {
    it('not-fabric, case, server-only: warnings only', () => {
      const forge: ModReadResult = { ok: true, info: { metadata: null, nonFabric: 'forge', nested: [] } }
      const analysis = analyze([jar('forge.jar', forge), jar('Sodium.JAR', sodium()), jar('s.jar', meta('srv', '1', { environment: 'server', depends: { missing: '*' } }))])
      expect(problemsOf(analysis, 'forge.jar')).toEqual([{ severity: 'warning', code: 'not-fabric', message: "Won't load: this is a Forge mod. Get its Fabric version." }])
      expect(codes(analysis, 'Sodium.JAR')).toEqual(['warning:case'])
      expect(codes(analysis, 's.jar')).toEqual(['warning:server-only'])
      expect(analysis.errors).toBe(0)
      expect([...analysis.mods.values()].every((result) => !result.loads)).toBe(true)
    })

    it('unreadable is an error; still being copied is a warning', () => {
      const broken: ModReadResult = { ok: false, kind: 'unreadable', message: 'Not a zip file' }
      const analysis = analyze([jar('broken.jar', broken), jar('fresh.jar', broken, { mtimeMs: NOW - 500 })])
      expect(problemsOf(analysis, 'broken.jar')[0]).toMatchObject({ severity: 'error', code: 'unreadable', detail: 'Not a zip file' })
      expect(codes(analysis, 'fresh.jar')).toEqual(['warning:copying'])
    })

    it('unchecked is a warning, and then a missing dependency is only a warning (the unchecked jar may provide it)', () => {
      const odd: ModReadResult = { ok: false, kind: 'unchecked', message: 'odd layout' }
      const analysis = analyze([jar('odd.jar', odd), jar('a.jar', meta('amod', '1', { depends: { mystery: '*' } }))])
      expect(codes(analysis, 'odd.jar')).toEqual(['warning:unchecked'])
      expect(codes(analysis, 'a.jar')).toEqual(['warning:missing'])
      expect(analysis.errors).toBe(0)
    })

    it('with an unchecked jar, a wrong version or a turned-off dependency is only a warning too', () => {
      const odd: ModReadResult = { ok: false, kind: 'unchecked', message: 'odd layout' }
      const analysis = analyze([
        jar('lib-1.jar', meta('lib', '1.0.0')),
        jar('lib-2.jar', odd),
        jar('aa.jar', meta('aa', '1.0.0', { depends: { lib: '>=2', offmod: '*' }, breaks: { lib: '1.0.0' } })),
        jar('off.jar.disabled', meta('offmod', '1'))
      ])
      expect(codes(analysis, 'aa.jar')).toEqual(['warning:dependency-version', 'warning:disabled-dependency', 'warning:breaks'])
      expect(analysis.errors).toBe(0)
    })

    it('turned-off mods have no problems of their own', () => {
      const analysis = analyze([jar('old.jar.disabled', meta('old', '1', { depends: { minecraft: '1.12.2', nothing: '*' } })), jar('x.jar.disabled', { ok: false, kind: 'unreadable', message: 'x' })])
      expect(analysis.errors + analysis.warnings).toBe(0)
    })
  })

  describe('profile-wide inputs', () => {
    it('applies fabric_loader_dependencies.json before checking', () => {
      const old = jar('old.jar', meta('old', '1', { depends: { minecraft: '1.21.10', helper: '*' } }))
      const analysis = analyze([old], { overrides: { ok: true, value: { version: 1, overrides: { old: { '-depends': { helper: '' }, '+depends': {}, depends: { minecraft: '1.21.x' } } } } } })
      expect(codes(analysis, 'old.jar')).toEqual([])
      expect(analysis.profileProblems).toEqual([])
    })

    it('applies overrides to nested mods too', () => {
      const analysis = analyze(
        [jar('a.jar', meta('amod', '1', { depends: { lib: '*' } })), jar('b.jar', meta('bmod', '1'), { nested: [info(meta('lib', '1', { depends: { minecraft: '1.19' } }))] })],
        { overrides: { ok: true, value: { version: 1, overrides: { lib: { depends: {} } } } } }
      )
      expect(codes(analysis, 'a.jar')).toEqual([])
    })

    it('an unreadable overrides file is a profile error', () => {
      for (const overrides of [{ ok: false as const, message: 'Unexpected token' }, { ok: true as const, value: { version: 2 } }]) {
        const analysis = analyze([], { overrides })
        expect(analysis.profileProblems).toEqual([expect.objectContaining({ severity: 'error', code: 'overrides' })])
        expect(analysis.errors).toBe(1)
      }
    })

    it('custom Fabric options in the JVM arguments turn every mod error into a warning, with a note', () => {
      const analysis = analyze([jar('old.jar', meta('old', '1', { depends: { minecraft: '1.20.1' } }))], { customFabricOptions: true })
      expect(codes(analysis, 'old.jar')).toEqual(['warning:minecraft'])
      expect(analysis.profileProblems).toEqual([
        { severity: 'warning', code: 'custom-fabric-options', message: 'Custom Fabric options in Java arguments: the mod check may be wrong.' }
      ])
      expect(analysis.errors).toBe(0)
      expect(analysis.warnings).toBe(2)
    })
  })

  it('lists who needs a mod, for "turn it off anyway?"', () => {
    const analysis = analyze([
      jar('cloth.jar', meta('cloth-config', '15.0.0', { name: 'Cloth Config', provides: ['cloth'] })),
      jar('menu.jar', meta('modmenu', '1', { name: 'Mod Menu', depends: { 'cloth-config': '>=15' } })),
      jar('other.jar', meta('other', '1', { name: 'Another Mod', depends: { cloth: '*' } })),
      jar('old.jar', meta('old', '1', { depends: { 'cloth-config': '<10' } })),
      jar('off.jar.disabled', meta('off', '1', { depends: { 'cloth-config': '*' } }))
    ])
    expect(analysis.mods.get('cloth.jar')!.neededBy).toEqual(['Another Mod', 'Mod Menu'])
    expect(analysis.mods.get('menu.jar')!.neededBy).toEqual([])
  })
})

function baseInput(mods: ScannedMod[]): AnalysisInput {
  return { mods, minecraft: '1.21.11', javaMajor: 21, included: included(), overrides: null, customFabricOptions: false, now: NOW }
}
