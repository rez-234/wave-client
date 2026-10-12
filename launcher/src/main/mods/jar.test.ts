import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { makeModJar, simpleMod } from '../../../test/helpers/make-mod-jar'
import { makeZip } from '../../../test/helpers/make-zip'
import { readModIcon, readModJar, readModJarFromBuffer } from './jar'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 1)])

describe('readModJar', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wave-jar-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reads a mod with its nested mods, recursively', async () => {
    const deep = simpleMod('deep-lib', '1.0.0')
    const lib = simpleMod('cloth-config', '15.0.0', { provides: ['cloth'] }, [{ path: 'META-INF/jars/deep.jar', jar: deep }])
    const path = join(dir, 'mod.jar')
    await writeFile(path, simpleMod('modmenu', '11.0.0', { name: 'Mod Menu' }, [{ path: 'META-INF/jars/cloth.jar', jar: lib }]))

    const read = await readModJar(path)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.info.metadata).toMatchObject({ id: 'modmenu', version: '11.0.0', name: 'Mod Menu' })
    expect(read.info.nested).toHaveLength(1)
    expect(read.info.nested[0]!.metadata).toMatchObject({ id: 'cloth-config', provides: ['cloth'] })
    expect(read.info.nested[0]!.nested[0]!.metadata?.id).toBe('deep-lib')
  })

  it('ignores missing nested entries, non-.jar entries, and nested jars without fabric.mod.json', async () => {
    const plainLibrary = makeZip([{ name: 'com/example/A.class', data: 'x' }])
    const jar = makeModJar({
      modJson: { id: 'demo', version: '1', jars: [{ file: 'META-INF/jars/missing.jar' }, { file: 'META-INF/jars/lib.zip' }, { file: 'META-INF/jars/plain.jar' }, { file: 'META-INF/jars/junk.jar' }] },
      nested: [
        { path: 'META-INF/jars/lib.zip', jar: simpleMod('zipped', '1') },
        { path: 'META-INF/jars/plain.jar', jar: plainLibrary },
        { path: 'META-INF/jars/junk.jar', jar: Buffer.from('not a zip at all') }
      ]
    })
    const read = await readModJarFromBuffer(jar)
    expect(read).toMatchObject({ ok: true, info: { nested: [] } })
  })

  it('reads only nested jars that are listed, and each listed one once', async () => {
    const lib = simpleMod('lib', '1')
    const jar = makeModJar({
      modJson: { id: 'demo', version: '1', jars: [{ file: 'META-INF/jars/a.jar' }, { file: 'META-INF/jars/a.jar' }] },
      nested: [
        { path: 'META-INF/jars/a.jar', jar: lib },
        { path: 'META-INF/jars/unlisted.jar', jar: simpleMod('unlisted', '1'), listed: false }
      ]
    })
    const read = await readModJarFromBuffer(jar)
    expect(read.ok && read.info.nested.map((n) => n.metadata?.id)).toEqual(['lib'])
  })

  it('makes the whole jar unreadable when a listed nested jar is broken (Fabric fails too)', async () => {
    const broken = makeModJar({ modJson: '{"schemaVersion":1,"id":"lib",}' })
    const read = await readModJarFromBuffer(simpleMod('demo', '1', {}, [{ path: 'META-INF/jars/lib.jar', jar: broken }]))
    expect(read).toMatchObject({ ok: false, kind: 'unreadable', message: expect.stringMatching(/^lib\.jar: /) })

    const badId = simpleMod('Bad_Id', '1')
    expect(await readModJarFromBuffer(simpleMod('demo', '1', {}, [{ path: 'META-INF/jars/x.jar', jar: badId }]))).toMatchObject({ ok: false, kind: 'unreadable' })

    const encrypted = makeZip([{ name: 'fabric.mod.json', data: '{"schemaVersion":1,"id":"lib","version":"1"}', flags: 1, method: 0 }])
    expect(await readModJarFromBuffer(simpleMod('demo', '1', {}, [{ path: 'META-INF/jars/x.jar', jar: encrypted }]))).toMatchObject({ ok: false, kind: 'unreadable' })
  })

  it("doesn't look inside server-only mods", async () => {
    const broken = makeModJar({ modJson: 'nonsense' })
    const read = await readModJarFromBuffer(simpleMod('server-thing', '1', { environment: 'server' }, [{ path: 'META-INF/jars/x.jar', jar: broken }]))
    expect(read).toMatchObject({ ok: true, info: { metadata: { environment: 'server' }, nested: [] } })
  })

  it('tells which loader a non-Fabric jar is for, only when it has no fabric.mod.json', async () => {
    const kinds = [
      ['META-INF/mods.toml', 'forge'],
      ['META-INF/neoforge.mods.toml', 'neoforge'],
      ['quilt.mod.json', 'quilt'],
      ['com/example/Lib.class', 'unknown']
    ] as const

    for (const [file, kind] of kinds) {
      expect(await readModJarFromBuffer(makeZip([{ name: file, data: 'x' }]))).toEqual({ ok: true, info: { metadata: null, nonFabric: kind, nested: [] } })
    }

    const multi = makeModJar({ modJson: { id: 'multi', version: '1' }, files: [{ name: 'META-INF/mods.toml', data: 'x' }] })
    expect(await readModJarFromBuffer(multi)).toMatchObject({ ok: true, info: { metadata: { id: 'multi' }, nonFabric: null } })
  })

  it('separates what Fabric would fail on from what only this reader gives up on', async () => {
    expect(await readModJarFromBuffer(Buffer.from('definitely not a jar'))).toMatchObject({ ok: false, kind: 'unreadable' })
    expect(await readModJarFromBuffer(makeModJar({ modJson: '{"id": "demo", // no comments\n}' }))).toMatchObject({ ok: false, kind: 'unreadable' })
    const encryptedOther = makeModJar({ modJson: { id: 'demo', version: '1' }, files: [{ name: 'secret', data: 'x', flags: 1 }] })
    expect(await readModJarFromBuffer(encryptedOther)).toMatchObject({ ok: false, kind: 'unreadable' })
    const hugeModJson = makeModJar({ modJson: `{"schemaVersion":1,"id":"demo","version":"1","description":"${'x'.repeat(1_100_000)}"}` })
    expect(await readModJarFromBuffer(hugeModJson)).toMatchObject({ ok: false, kind: 'unchecked' })
    expect(await readModJar(join(dir, 'gone.jar'))).toMatchObject({ ok: false, kind: 'unchecked' })
  })

  it('reads the same nested jar only once (by content)', async () => {
    const lib = simpleMod('lib', '1')
    const jar = makeModJar({
      modJson: { id: 'demo', version: '1' },
      nested: [
        { path: 'META-INF/jars/a.jar', jar: lib },
        { path: 'META-INF/jars/b.jar', jar: lib }
      ]
    })
    const read = await readModJarFromBuffer(jar)
    expect(read.ok && read.info.nested.map((n) => n.metadata?.id)).toEqual(['lib', 'lib'])
  })

  it('stops at the nested-jar cap', async () => {
    const nested = Array.from({ length: 513 }, (_, i) => ({ path: `META-INF/jars/l${i}.jar`, jar: simpleMod(`lib${i}`, '1') }))
    const read = await readModJarFromBuffer(makeModJar({ modJson: { id: 'demo', version: '1' }, nested }))
    expect(read).toMatchObject({ ok: false, kind: 'unchecked' })
  })

  it('reads PNG icons up to 32 KiB, and drops icon paths that are not in the jar', async () => {
    const path = join(dir, 'icon.jar')
    await writeFile(
      path,
      makeModJar({
        modJson: { id: 'demo', version: '1', icon: 'assets/demo/icon.png' },
        files: [
          { name: 'assets/demo/icon.png', data: PNG },
          { name: 'assets/demo/fake.png', data: 'GIF89a' },
          { name: 'assets/demo/big.png', data: Buffer.concat([PNG, Buffer.alloc(40_000)]) }
        ]
      })
    )
    expect(await readModIcon(path, 'assets/demo/icon.png')).toEqual(PNG)
    expect(await readModIcon(path, 'assets/demo/fake.png')).toBeNull()
    expect(await readModIcon(path, 'assets/demo/big.png')).toBeNull()
    expect(await readModIcon(path, 'assets/demo/none.png')).toBeNull()

    const noIcon = await readModJarFromBuffer(makeModJar({ modJson: { id: 'demo', version: '1', icon: 'assets/demo/icon.png' } }))
    expect(noIcon.ok && noIcon.info.metadata?.icon).toBeNull()
    const v0 = await readModJarFromBuffer(makeModJar({ modJson: JSON.stringify({ id: 'old', version: '1' }), files: [{ name: 'assets/old/icon.png', data: PNG }] }))
    expect(v0.ok && v0.info.metadata?.icon).toBe('assets/old/icon.png')
  })
})
