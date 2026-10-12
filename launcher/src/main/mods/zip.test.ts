import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { makeZip } from '../../../test/helpers/make-zip'
import { ZipError, ZipReader, bufferSource, withZipFile } from './zip'

describe('ZipReader', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wave-zip-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const files = [
    { name: 'fabric.mod.json', data: '{"schemaVersion":1,"id":"demo"}' },
    { name: 'assets/demo/icon.png', data: Buffer.alloc(300, 7), method: 0 as const },
    { name: 'META-INF/jars/inner.jar', data: makeZip([{ name: 'fabric.mod.json', data: '{"id":"inner"}' }]), method: 0 as const }
  ]

  it('reads stored and deflated entries from a file, and a jar inside a jar', async () => {
    const path = join(dir, 'demo.jar')
    await writeFile(path, makeZip(files, { comment: 'built by a test' }))

    const inner = await withZipFile(path, async (zip) => {
      expect([...zip.entries.keys()]).toEqual(files.map((f) => f.name))
      expect((await zip.read(zip.entry('fabric.mod.json')!, 1024)).toString()).toContain('"demo"')
      expect(await zip.read(zip.entry('assets/demo/icon.png')!, 1024)).toEqual(Buffer.alloc(300, 7))
      return zip.read(zip.entry('META-INF/jars/inner.jar')!, 1024 * 1024)
    })

    const nested = await ZipReader.open(bufferSource(inner))
    expect((await nested.read(nested.entry('fabric.mod.json')!, 1024)).toString()).toBe('{"id":"inner"}')
  })

  it('reads Zip64 jars', async () => {
    const zip = await ZipReader.open(bufferSource(makeZip(files, { zip64: true })))
    expect(zip.entries.size).toBe(3)
    expect((await zip.read(zip.entry('fabric.mod.json')!, 1024)).toString()).toContain('"demo"')
  })

  it('refuses what is too big, damaged or not a zip', async () => {
    const zip = await ZipReader.open(bufferSource(makeZip(files)))
    await expect(zip.read(zip.entry('assets/demo/icon.png')!, 100)).rejects.toMatchObject({ kind: 'unchecked', message: expect.stringMatching(/too large/) })

    await expect(ZipReader.open(bufferSource(Buffer.from('not a zip at all, sorry')))).rejects.toMatchObject({ kind: 'unreadable' })
    await expect(ZipReader.open(bufferSource(Buffer.alloc(5)))).rejects.toThrow(/Not a zip/)
    const truncated = makeZip(files).subarray(0, 200)
    await expect(ZipReader.open(bufferSource(truncated))).rejects.toBeInstanceOf(ZipError)
  })

  it('treats a wrong checksum like Java: ignored by ZipFile (unchecked), fatal in ZipInputStream', async () => {
    const damaged = makeZip([{ name: 'a', data: 'hello world', method: 0, crc: 1234 }])
    const asFile = await ZipReader.open(bufferSource(damaged), 'file')
    await expect(asFile.read(asFile.entry('a')!, 100)).rejects.toMatchObject({ kind: 'unchecked' })
    const asStream = await ZipReader.open(bufferSource(damaged), 'stream')
    await expect(asStream.read(asStream.entry('a')!, 100)).rejects.toMatchObject({ kind: 'unreadable' })
  })

  it('fails on broken deflate data as Java does', async () => {
    const zip = makeZip([{ name: 'a', data: 'x'.repeat(1000) }])
    // Corrupt the deflate stream right after the local header.
    zip.writeUInt8(zip.readUInt8(31) ^ 0xff, 31)
    zip.writeUInt8(zip.readUInt8(32) ^ 0xff, 32)
    const reader = await ZipReader.open(bufferSource(zip))
    await expect(reader.read(reader.entry('a')!, 10_000)).rejects.toMatchObject({ kind: 'unreadable' })
  })

  it('refuses the whole jar for any encrypted or unknown-method entry (ZipFile), only that entry (ZipInputStream)', async () => {
    const encrypted = makeZip([...files, { name: 'secret.bin', data: 'xx', method: 0, flags: 1 }])
    await expect(ZipReader.open(bufferSource(encrypted), 'file')).rejects.toMatchObject({ kind: 'unreadable', message: expect.stringMatching(/encrypted/) })
    const stream = await ZipReader.open(bufferSource(encrypted), 'stream')
    expect((await stream.read(stream.entry('fabric.mod.json')!, 1024)).toString()).toContain('demo')
    await expect(stream.read(stream.entry('secret.bin')!, 1024)).rejects.toMatchObject({ kind: 'unreadable' })

    const bzip = makeZip([...files, { name: 'b.bin', data: 'xx', rawMethod: 12 }])
    await expect(ZipReader.open(bufferSource(bzip), 'file')).rejects.toMatchObject({ kind: 'unreadable', message: expect.stringMatching(/method 12/) })
  })

  it('reads jars with bytes in front, shifting offsets like Java', async () => {
    const zip = await ZipReader.open(bufferSource(makeZip(files, { prepend: Buffer.alloc(1000, 0x41) })))
    expect((await zip.read(zip.entry('fabric.mod.json')!, 1024)).toString()).toContain('"demo"')
    // Java follows the Zip64 locator's absolute offset, misses the record and gives up too.
    await expect(ZipReader.open(bufferSource(makeZip(files, { prepend: Buffer.alloc(1000), zip64: true })))).rejects.toMatchObject({ kind: 'unreadable' })
  })

  it('accepts trailing bytes after the end record when the directory checks out', async () => {
    const padded = Buffer.concat([makeZip(files), Buffer.alloc(100)])
    const zip = await ZipReader.open(bufferSource(padded))
    expect(zip.entries.size).toBe(3)
  })

  it('finds the last entry of a name like ZipFile, the first like ZipInputStream', async () => {
    const twice = makeZip([
      { name: 'a', data: 'first' },
      { name: 'a', data: 'second' }
    ])
    const file = await ZipReader.open(bufferSource(twice), 'file')
    expect((await file.read(file.entry('a')!, 100)).toString()).toBe('second')
    const stream = await ZipReader.open(bufferSource(twice), 'stream')
    expect((await stream.read(stream.entry('a')!, 100)).toString()).toBe('first')
  })

  it('reports directory problems in nested jars as unchecked (ZipInputStream never reads it)', async () => {
    const zip = makeZip(files)
    const cd = zip.readUInt32LE(zip.length - 22 + 16)
    zip[cd] = 0
    await expect(ZipReader.open(bufferSource(zip), 'file')).rejects.toMatchObject({ kind: 'unreadable' })
    await expect(ZipReader.open(bufferSource(zip), 'stream')).rejects.toMatchObject({ kind: 'unchecked' })
  })

  it('stops inflating at the size limit, whatever the directory claims', async () => {
    const real = makeZip([{ name: 'bomb', data: Buffer.alloc(5_000_000) }])
    const zip = await ZipReader.open(bufferSource(real))
    const entry = zip.entry('bomb')!
    // A lying directory: claims 10 bytes, so the size check passes, but inflating is capped.
    await expect(zip.read({ ...entry, size: 10 }, 10)).rejects.toThrow(ZipError)
  })
})
