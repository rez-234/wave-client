import { describe, expect, it } from 'vitest'

import { parseFabricModJson } from './metadata'
import { OverridesError, applyDependencyOverrides, parseDependencyOverrides, parseDependencyOverridesText } from './overrides'

const mod = parseFabricModJson(
  JSON.stringify({ schemaVersion: 1, id: 'sodium', version: '0.6.13', depends: { minecraft: '1.21.11', fabricloader: '>=0.16' }, breaks: { optifabric: '*' }, recommends: { modmenu: '*' } })
)

describe('dependency overrides', () => {
  it('replaces a kind of dependency', () => {
    const overrides = parseDependencyOverrides({ version: 1, overrides: { sodium: { depends: { minecraft: '*' } } } })
    const result = applyDependencyOverrides(overrides, mod)
    expect(result.depends).toEqual([{ id: 'minecraft', predicates: ['*'] }])
    expect(result.breaks).toEqual(mod.breaks)
    expect(mod.depends).toHaveLength(2)
  })

  it('removes by id, then adds', () => {
    const overrides = parseDependencyOverridesText(
      JSON.stringify({ version: 1, overrides: { sodium: { '+depends': { minecraft: '1.21.x' }, '-depends': { minecraft: '', unrelated: '*' }, '-breaks': { optifabric: '*' } } } })
    )
    const result = applyDependencyOverrides(overrides, mod)
    expect(result.depends).toEqual([
      { id: 'fabricloader', predicates: ['>=0.16'] },
      { id: 'minecraft', predicates: ['1.21.x'] }
    ])
    expect(result.breaks).toEqual([])
  })

  it('lets a replace win over add and remove for the same kind, and ignores empty add/remove', () => {
    const overrides = parseDependencyOverrides({ version: 1, overrides: { sodium: { '+depends': { extra: '*' }, depends: {}, '-recommends': {} } } })
    const result = applyDependencyOverrides(overrides, mod)
    expect(result.depends).toEqual([])
    expect(result.recommends).toEqual(mod.recommends)
  })

  it('leaves other mods alone', () => {
    const overrides = parseDependencyOverrides({ version: 1, overrides: { lithium: { depends: {} } } })
    expect(applyDependencyOverrides(overrides, mod)).toBe(mod)
    expect(applyDependencyOverrides(null, mod)).toBe(mod)
    expect(applyDependencyOverrides(parseDependencyOverrides({ version: 1 }), mod)).toBe(mod)
  })

  it('refuses what Fabric refuses', () => {
    const bad: unknown[] = [
      [],
      {},
      { overrides: {}, version: 1 },
      { version: 2 },
      { version: '1' },
      { version: 1, other: {} },
      { version: 1, overrides: [] },
      { version: 1, overrides: { sodium: { requires: {} } } },
      { version: 1, overrides: { sodium: { depends: [] } } },
      { version: 1, overrides: { sodium: { depends: { minecraft: 5 } } } },
      { version: 1, overrides: { sodium: { depends: { minecraft: [5] } } } },
      { version: 1, overrides: { sodium: { depends: { minecraft: '>= 1.21' } } } }
    ]

    for (const value of bad) {
      expect(() => parseDependencyOverrides(value), JSON.stringify(value)).toThrow(OverridesError)
    }

    expect(() => parseDependencyOverridesText('{"version":1,}')).toThrow(OverridesError)
    expect(() => parseDependencyOverridesText('﻿{"version":1.0}')).not.toThrow()
  })
})
