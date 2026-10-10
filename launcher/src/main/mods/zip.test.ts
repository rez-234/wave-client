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

  it('refuses what is too big, damaged, encrypted or not a zip', async () => {
    const zip = await ZipReader.open(bufferSource(makeZip(files)))
    await expect(zip.read(zip.entry('assets/demo/icon.png')!, 100)).rejects.toThrow(/too large/)

    const damaged = makeZip([{ name: 'a', data: 'hello world', method: 0 }])
    damaged[30 + 1] = 'X'.charCodeAt(0)
    const broken = await ZipReader.open(bufferSource(damaged))
    await expect(broken.read(broken.entry('a')!, 100)).rejects.toThrow(/damaged/)

    const encrypted = await ZipReader.open(bufferSource(makeZip(files)))
    await expect(encrypted.read({ ...encrypted.entry('fabric.mod.json')!, flags: 1 }, 1024)).rejects.toThrow(/encrypted/)

    await expect(ZipReader.open(bufferSource(Buffer.from('not a zip at all, sorry')))).rejects.toBeInstanceOf(ZipError)
    await expect(ZipReader.open(bufferSource(Buffer.alloc(5)))).rejects.toThrow(/Not a zip/)
    const truncated = makeZip(files).subarray(0, 200)
    await expect(ZipReader.open(bufferSource(truncated))).rejects.toBeInstanceOf(ZipError)
  })

  it('stops inflating at the size limit, whatever the directory claims', async () => {
    const real = makeZip([{ name: 'bomb', data: Buffer.alloc(5_000_000) }])
    const zip = await ZipReader.open(bufferSource(real))
    const entry = zip.entry('bomb')!
    // A lying directory: claims 10 bytes, so the size check passes, but inflating is capped.
    await expect(zip.read({ ...entry, size: 10 }, 10)).rejects.toThrow(ZipError)
  })
})
