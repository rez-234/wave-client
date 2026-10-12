import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseFabricJson } from './json'
import { MetadataError, parseFabricModJson } from './metadata'

const FIXTURES = join(__dirname, '../../../test/fixtures/mods/fabric-parsing/v1')
const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8')
const json = (value: object): string => JSON.stringify(value)
const v1 = (extra: object = {}): string => json({ schemaVersion: 1, id: 'demo', version: '1.0.0', ...extra })
const fails = (text: string, pattern?: RegExp): void => {
  expect(() => parseFabricModJson(text)).toThrow(MetadataError)
  if (pattern) expect(() => parseFabricModJson(text)).toThrow(pattern)
}

describe("Fabric Loader's own parsing fixtures (V1ModJsonParsingTests)", () => {
  it('reads the required values, in either order', () => {
    for (const name of ['spec/required.json', 'spec/required_reversed.json']) {
      const metadata = parseFabricModJson(fixture(name))
      expect(metadata).toMatchObject({ schemaVersion: 1, id: 'v1-parsing-test', version: '1.0.0-SNAPSHOT' })
    }
  })

  it('reads custom values, example 1 and the long file', () => {
    expect(parseFabricModJson(fixture('spec/custom_values.json')).id).toBe('v1-parsing-test')

    const example = parseFabricModJson(fixture('spec/example_1.json'))
    expect(example).toMatchObject({ name: 'Example mod 1', environment: 'client', icon: 'assets/test/mod/icon.png', authors: ['FabricMC', 'Another author'] })
    expect(example.depends).toEqual([{ id: 'fabricloader', predicates: ['>=0.4.0'] }])

    const long = parseFabricModJson(fixture('spec/long.json'))
    expect(long.depends.length).toBeGreaterThan(0)
    expect(long.suggests).toEqual([{ id: 'goodmod', predicates: ['~2.8.7', '>=3.0'] }])
    expect(long.conflicts).toEqual([{ id: 'conflictingmod', predicates: ['*'] }])
    expect(long.breaks).toEqual([{ id: 'breakingmod', predicates: ['*'] }])
    expect(long.authors).toHaveLength(9)
    expect(long.environment).toBe('*')
  })

  it('picks icons like Fabric: smallest at least 64, else the largest', () => {
    expect(parseFabricModJson(fixture('spec/any_icon_size.json')).icon).toBe('assets/testing/icon-64.png')
    expect(parseFabricModJson(fixture('spec/icon_sizes.json')).icon).toBe('assets/testing/icon-64.png')
    expect(parseFabricModJson(fixture('spec/no_icon.json')).icon).toBeNull()
    expect(parseFabricModJson(v1({ icon: { '16': 'a.png', '32': 'b.png' } })).icon).toBe('b.png')
    expect(parseFabricModJson(v1({ icon: { '128': 'big.png', '256': 'huge.png' } })).icon).toBe('big.png')
    fails(v1({ icon: {} }), /must not be empty/)
    fails(v1({ icon: { big: 'a.png' } }), /icon size/)
    fails(v1({ icon: { '0': 'a.png' } }), /positive/)
    fails(v1({ icon: 5 }))
  })

  it('refuses the error fixtures', () => {
    fails(fixture('error/missing_version.json'), /version/)
    fails(fixture('error/duplicate_mismatched_schema_versions.json'), /schema/)
  })
})

describe('parseFabricModJson', () => {
  it("is as strict as Fabric's JSON reader", () => {
    fails('{"schemaVersion":1, // comment\n "id":"demo","version":"1"}')
    fails('{"schemaVersion":1,"id":"demo","version":"1",}')
    fails('{"schemaVersion":1,"id":"demo","version":"1","authors":["a",]}')
    fails("{'schemaVersion':1}")
    fails('{schemaVersion:1}')
    fails('# hello\n{}')
    fails('[]', /must be an object/)
  })

  it('accepts what Fabric accepts that JSON.parse does not', () => {
    expect(parseFabricModJson(`﻿${v1()}`).id).toBe('demo')
    expect(parseFabricModJson(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(v1())])).id).toBe('demo')
    expect(parseFabricModJson(`${v1()} trailing junk Fabric never reads`).id).toBe('demo')
    expect(parseFabricModJson('{"schemaVersion":1,"id":"demo","version":"1","custom":{"a":TRUE,"b":Null}}').id).toBe('demo')
    expect(parseFabricModJson('{"schemaVersion":1,"id":"demo","version":"1","description":"it\\\'s\tfine"}').description).toBe("it's\tfine")
    expect(parseFabricModJson('{"schemaVersion":1.0,"id":"demo","version":"1"}').schemaVersion).toBe(1)
  })

  it('maps schema 0 the way Fabric does', () => {
    const metadata = parseFabricModJson(
      json({ id: 'oldmod', version: '1.2', requires: { fabric: '*' }, conflicts: { other: '*' }, recommends: { nice: '*' }, side: 'client', depends: { ignored: '*' }, environment: [1] })
    )
    expect(metadata).toMatchObject({ schemaVersion: 0, environment: 'client', icon: 'assets/oldmod/icon.png' })
    expect(metadata.depends).toEqual([{ id: 'fabric', predicates: ['*'] }])
    expect(metadata.breaks).toEqual([{ id: 'other', predicates: ['*'] }])
    expect(metadata.suggests).toEqual([{ id: 'nice', predicates: ['*'] }])
    expect(parseFabricModJson(json({ id: 'oldmod', version: '1', side: 'sideways' })).environment).toBe('*')
    expect(parseFabricModJson(json({ id: 'oldmod', version: '1', authors: ['Jane Doe <jane@example.com> (example.com)'] })).authors).toEqual(['Jane Doe'])
    fails(json({ id: 'oldmod', version: '1', authors: ['   '] }))
    fails(json({ id: 'oldmod', version: '1', authors: [{ name: 5 }] }))
    fails(json({ id: 'oldmod', version: '1', initializer: 'a', initializers: ['b'] }))
  })

  it('finds schemaVersion anywhere, and checks a second one', () => {
    expect(parseFabricModJson(json({ id: 'demo', version: '1', schemaVersion: 1, environment: 'client' })).environment).toBe('client')
    expect(parseFabricModJson(json({ $schema: 'x', schemaVersion: 1, id: 'demo', version: '1' })).schemaVersion).toBe(1)
    fails(json({ schemaVersion: 2, id: 'demo', version: '1' }), /newer Fabric Loader/)
    fails(json({ schemaVersion: -1, id: 'demo', version: '1' }), /Unsupported/)
    fails(json({ schemaVersion: '1', id: 'demo', version: '1' }), /must be a number/)
    fails(json({ schemaVersion: 1.5, id: 'demo', version: '1' }))
    fails('{"id":"demo","version":"1","schemaVersion":1,"schemaVersion":0}')
  })

  it('checks ids and provides like MetadataVerifier', () => {
    for (const id of ['ab', 'my_mod', 'my-mod2', 'a'.repeat(64)]) {
      expect(parseFabricModJson(v1({ id })).id).toBe(id)
    }

    for (const id of ['a', 'Sodium', '1mod', 'my mod', 'mod.name', 'a'.repeat(65), '']) {
      fails(v1({ id }), /Invalid mod id/)
    }

    fails(v1({ provides: ['ok', 'Not-OK'] }), /provides/)
    fails(v1({ provides: 'single' }))
    fails(v1({ id: 5 }))
    fails(json({ schemaVersion: 1, version: '1' }), /"id"/)
  })

  it('accepts any non-empty version string', () => {
    expect(parseFabricModJson(v1({ version: 'mc1.21.11-0.21.4-fabric' })).version).toBe('mc1.21.11-0.21.4-fabric')
    fails(v1({ version: '' }))
    fails(v1({ version: 1 }))
  })

  it('reads environment as a case-insensitive string only', () => {
    expect(parseFabricModJson(v1({ environment: 'CLIENT' })).environment).toBe('client')
    expect(parseFabricModJson(v1({ environment: '' })).environment).toBe('*')
    expect(parseFabricModJson(v1({ environment: '*' })).environment).toBe('*')
    expect(parseFabricModJson(v1({ environment: 'Server' })).environment).toBe('server')
    fails(v1({ environment: ['client'] }), /must be a string/)
    fails(v1({ environment: 'both' }), /Invalid environment/)
    fails(v1({ mixins: [{ config: 'a.json', environment: 'nowhere' }] }), /Invalid environment/)
  })

  it('reads dependencies as strings or string arrays, every predicate parseable', () => {
    const metadata = parseFabricModJson(v1({ depends: { minecraft: '~1.21.11', sodium: ['>=0.6', '0.5.x'], never: [] }, recommends: { modmenu: '*' } }))
    expect(metadata.depends).toEqual([
      { id: 'minecraft', predicates: ['~1.21.11'] },
      { id: 'sodium', predicates: ['>=0.6', '0.5.x'] },
      { id: 'never', predicates: [] }
    ])
    expect(metadata.recommends).toEqual([{ id: 'modmenu', predicates: ['*'] }])
    fails(v1({ depends: { minecraft: '>= 1.21' } }), /non-empty/)
    fails(v1({ depends: { thing: '<abc' } }), /Invalid predicate/)
    fails(v1({ depends: { thing: 1 } }), /string or string array/)
    fails(v1({ depends: { thing: [1] } }))
    fails(v1({ depends: ['thing'] }), /must be an object/)
    expect(parseFabricModJson(v1({ requires: 12 })).depends).toEqual([])
  })

  it('keeps duplicate dependency keys as Fabric does', () => {
    const metadata = parseFabricModJson('{"schemaVersion":1,"id":"demo","version":"1","depends":{"a":"1","a":"2"}}')
    expect(metadata.depends).toEqual([
      { id: 'a', predicates: ['1'] },
      { id: 'a', predicates: ['2'] }
    ])
  })

  it('lists nested jars and checks their entries', () => {
    expect(parseFabricModJson(v1({ jars: [{ file: 'META-INF/jars/a.jar' }, { file: 'META-INF/jars/b.jar', other: 1 }] })).jars).toEqual(['META-INF/jars/a.jar', 'META-INF/jars/b.jar'])
    fails(v1({ jars: [{}] }), /'file'/)
    fails(v1({ jars: ['a.jar'] }))
    fails(v1({ jars: [{ file: 3 }] }))
  })

  it('checks the types of the other known keys', () => {
    fails(v1({ entrypoints: { main: 'x' } }))
    fails(v1({ entrypoints: { main: [{ adapter: 'kotlin' }] } }), /value/)
    fails(v1({ entrypoints: { main: [5] } }))
    expect(parseFabricModJson(v1({ entrypoints: { main: ['a', { value: 'b', adapter: 'kotlin' }] } })).id).toBe('demo')
    fails(v1({ authors: [{ contact: {} }] }), /'name'/)
    fails(v1({ authors: [5] }))
    fails(v1({ contact: { homepage: 5 } }))
    fails(v1({ license: [5] }))
    fails(v1({ accessWidener: false }))
    fails(v1({ languageAdapters: { a: 1 } }))
    fails(v1({ custom: [] }))
    fails('{"schemaVersion":1,"id":"demo","version":"1","custom":{"n":1e999}}', /infinities/)
    expect(parseFabricModJson(v1({ mixins: ['a.json', 5, { config: 'b.json' }], whatever: { x: 1 } })).id).toBe('demo')
  })

  it('cleans names, descriptions and authors for display', () => {
    const metadata = parseFabricModJson(
      v1({ name: '§aFancy §lMod\n', description: `${'d'.repeat(400)}`, authors: [...Array.from({ length: 12 }, (_, i) => `Author ${i}`), 'x'.repeat(80)] })
    )
    expect(metadata.name).toBe('Fancy Mod')
    expect([...metadata.description!].length).toBe(300)
    expect(metadata.authors).toHaveLength(10)
    expect(parseFabricModJson(v1({ name: '' })).name).toBeNull()
  })
})

describe('parseFabricJson', () => {
  it('keeps keys in order with duplicates, and reads Gson escapes', () => {
    expect(parseFabricJson('{"b":1,"a":2,"b":3}')).toEqual({
      type: 'object',
      entries: [
        ['b', { type: 'number', raw: '1' }],
        ['a', { type: 'number', raw: '2' }],
        ['b', { type: 'number', raw: '3' }]
      ]
    })
    expect(parseFabricJson('"a\\u0041\\/\\\'"')).toEqual({ type: 'string', value: "aA/'" })
  })

  it('refuses numbers and literals Gson refuses', () => {
    for (const bad of ['01', '1.', '.5', '+1', '-', 'tru', 'nulls', 'NaN', '{"a" 1}', '{"a":1;"b":2}', '{"a"=1}', '[1;2]', '[,1]', '"\\x"', '"\\u12"', '"open']) {
      expect(() => parseFabricJson(bad), bad).toThrow()
    }

    for (const ok of ['0', '-0', '1.5e+10', '[]', '{}', 'tRuE']) {
      expect(() => parseFabricJson(ok), ok).not.toThrow()
    }
  })
})
