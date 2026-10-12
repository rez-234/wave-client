import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { simpleMod } from '../../../test/helpers/make-mod-jar'
import { MOD_ID } from '../mods/metadata'
import { SemanticVersion, parseVersion } from '../mods/version'
import { FABRIC_API_MODULES } from './fabric-api-modules'
import { GAME_VERSIONS } from './versions'

describe('FABRIC_API_MODULES', () => {
  it('has the modules of every pinned Fabric API', () => {
    for (const spec of GAME_VERSIONS) {
      const modules = FABRIC_API_MODULES[spec.fabricApi]
      expect(modules, spec.fabricApi).toBeDefined()
      expect(modules!.length).toBeGreaterThan(30)
      expect(spec.fabricApiModules).toBe(modules)
    }
  })

  it('lists sane modules: valid ids, semantic versions, no duplicates, no dev-only modules', () => {
    for (const [version, modules] of Object.entries(FABRIC_API_MODULES)) {
      const ids = modules.flatMap((m) => [m.id, ...m.provides])
      expect(new Set(ids).size, version).toBe(ids.length)
      expect(ids.every((id) => MOD_ID.test(id) && id.startsWith('fabric-')), version).toBe(true)
      expect(modules.every((m) => parseVersion(m.version) instanceof SemanticVersion), version).toBe(true)
      expect(ids).toContain('fabric-api-base')
      expect(ids).not.toContain('fabric-api')
      expect(ids).not.toContain('fabric-gametest-api-v1')
      expect(ids).not.toContain('fabric-client-gametest-api-v1')
    }
  })

  it('knows the modules that provide other ids (1.21.11)', () => {
    const tags = FABRIC_API_MODULES['0.141.6+1.21.11']!.find((m) => m.id === 'fabric-tag-api-v1')
    expect(tags?.provides).toEqual(['fabric-client-tags-api-v1'])
  })
})

describe('scripts/fabric-api-modules.mjs', () => {
  it('lists the nested mods of a Fabric API jar', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wave-fapi-'))

    try {
      const jar = simpleMod('fabric-api', '9.9.9', { provides: ['fabric'] }, [
        { path: 'META-INF/jars/base.jar', jar: simpleMod('fabric-api-base', '1.0.0+abc') },
        { path: 'META-INF/jars/tags.jar', jar: simpleMod('fabric-tag-api-v1', '1.3.0', { provides: ['fabric-client-tags-api-v1'] }) }
      ])
      await writeFile(join(dir, 'fabric-api.jar'), jar)
      execFileSync(process.execPath, ['scripts/fabric-api-modules.mjs', '--jar', `9.9.9=${join(dir, 'fabric-api.jar')}`, '--out', join(dir, 'out.ts')])
      const out = await readFile(join(dir, 'out.ts'), 'utf8')
      expect(out).toContain("'9.9.9': [\n    { id: 'fabric-api-base', version: '1.0.0+abc', provides: [] },\n    { id: 'fabric-tag-api-v1', version: '1.3.0', provides: ['fabric-client-tags-api-v1'] }\n  ]")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
