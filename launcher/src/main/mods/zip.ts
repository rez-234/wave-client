import { open, type FileHandle } from 'node:fs/promises'
import { promisify } from 'node:util'
import { crc32, inflateRaw } from 'node:zlib'

/** Inflating runs on libuv's thread pool, so scanning many jars doesn't block the main process. */
const inflate = promisify(inflateRaw) as (data: Buffer, options: { maxOutputLength: number }) => Promise<Buffer>

/**
 * A small read-only zip reader for mod jars: it reads the central directory and then only the
 * entries asked for, from a file or from a buffer (a jar inside a jar). Stored and deflated
 * entries; Zip64 sizes and offsets; no encryption. Sizes are capped so a hostile jar can't make
 * the launcher allocate or inflate without bound.
 */

export interface ZipEntry {
  name: string
  method: number
  flags: number
  crc: number
  compressedSize: number
  size: number
  localHeaderOffset: number
}

/** Where the zip's bytes come from. */
export interface ZipSource {
  size: number
  read(offset: number, length: number): Promise<Buffer>
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipError'
  }
}

const EOCD = 0x06054b50
const EOCD64_LOCATOR = 0x07064b50
const EOCD64 = 0x06064b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50
/** EOCD record plus the longest possible comment. */
const EOCD_SEARCH = 22 + 0xffff
const MAX_ENTRIES = 200_000
const MAX_CENTRAL_DIRECTORY = 64 * 1024 * 1024

export function bufferSource(buffer: Buffer): ZipSource {
  return {
    size: buffer.length,
    read: async (offset, length) => {
      if (offset < 0 || offset + length > buffer.length) {
        throw new ZipError('Read past the end of the zip')
      }

      return buffer.subarray(offset, offset + length)
    }
  }
}

function handleSource(handle: FileHandle, size: number): ZipSource {
  return {
    size,
    read: async (offset, length) => {
      if (offset < 0 || offset + length > size) {
        throw new ZipError('Read past the end of the zip')
      }

      const buffer = Buffer.alloc(length)
      let done = 0

      while (done < length) {
        const { bytesRead } = await handle.read(buffer, done, length - done, offset + done)

        if (bytesRead === 0) {
          throw new ZipError('The file ended early')
        }

        done += bytesRead
      }

      return buffer
    }
  }
}

export class ZipReader {
  private constructor(
    private readonly source: ZipSource,
    readonly entries: ReadonlyMap<string, ZipEntry>
  ) {}

  static async open(source: ZipSource): Promise<ZipReader> {
    return new ZipReader(source, await readCentralDirectory(source))
  }

  entry(name: string): ZipEntry | undefined {
    return this.entries.get(name)
  }

  /** An entry's contents, refusing anything larger than maxSize once inflated. */
  async read(entry: ZipEntry, maxSize: number): Promise<Buffer> {
    if (entry.flags & 0x1) {
      throw new ZipError(`${entry.name} is encrypted`)
    }

    if (entry.size > maxSize) {
      throw new ZipError(`${entry.name} is too large (${entry.size} bytes)`)
    }

    const header = await this.source.read(entry.localHeaderOffset, 30)

    if (header.readUInt32LE(0) !== LOCAL) {
      throw new ZipError(`Bad local header for ${entry.name}`)
    }

    const start = entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28)
    const raw = await this.source.read(start, entry.compressedSize)
    let data: Buffer

    if (entry.method === 0) {
      data = raw
    } else if (entry.method === 8) {
      try {
        data = await inflate(raw, { maxOutputLength: Math.max(1, maxSize) })
      } catch (error) {
        throw new ZipError(`Couldn't inflate ${entry.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    } else {
      throw new ZipError(`${entry.name} uses an unsupported compression method (${entry.method})`)
    }

    if (data.length !== entry.size || (crc32(data) >>> 0) !== entry.crc >>> 0) {
      throw new ZipError(`${entry.name} is damaged`)
    }

    return data
  }
}

/** Opens a zip file on disk, runs `use` and closes it again. */
export async function withZipFile<T>(path: string, use: (zip: ZipReader) => Promise<T>): Promise<T> {
  const handle = await open(path, 'r')

  try {
    const { size } = await handle.stat()
    return await use(await ZipReader.open(handleSource(handle, size)))
  } finally {
    await handle.close()
  }
}

async function readCentralDirectory(source: ZipSource): Promise<Map<string, ZipEntry>> {
  if (source.size < 22) {
    throw new ZipError('Not a zip file')
  }

  const tailLength = Math.min(source.size, EOCD_SEARCH)
  const tailStart = source.size - tailLength
  const tail = await source.read(tailStart, tailLength)
  let eocd = -1

  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD) {
      eocd = i
      break
    }
  }

  if (eocd < 0) {
    throw new ZipError('Not a zip file')
  }

  let count = tail.readUInt16LE(eocd + 10)
  let cdSize = tail.readUInt32LE(eocd + 12)
  let cdOffset = tail.readUInt32LE(eocd + 16)

  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    // Zip64: the locator sits right before the EOCD record.
    const locatorAt = tailStart + eocd - 20

    if (locatorAt < 0) {
      throw new ZipError('Broken Zip64 data')
    }

    const locator = await source.read(locatorAt, 20)

    if (locator.readUInt32LE(0) !== EOCD64_LOCATOR) {
      throw new ZipError('Broken Zip64 data')
    }

    const record = await source.read(safeNumber(locator.readBigUInt64LE(8)), 56)

    if (record.readUInt32LE(0) !== EOCD64) {
      throw new ZipError('Broken Zip64 data')
    }

    count = safeNumber(record.readBigUInt64LE(32))
    cdSize = safeNumber(record.readBigUInt64LE(40))
    cdOffset = safeNumber(record.readBigUInt64LE(48))
  }

  if (count > MAX_ENTRIES || cdSize > MAX_CENTRAL_DIRECTORY || cdOffset + cdSize > source.size) {
    throw new ZipError('The zip directory is too large or out of bounds')
  }

  const directory = await source.read(cdOffset, cdSize)
  const entries = new Map<string, ZipEntry>()
  let at = 0

  for (let n = 0; n < count; n++) {
    if (at + 46 > directory.length || directory.readUInt32LE(at) !== CENTRAL) {
      throw new ZipError('Damaged zip directory')
    }

    const flags = directory.readUInt16LE(at + 8)
    const nameLength = directory.readUInt16LE(at + 28)
    const extraLength = directory.readUInt16LE(at + 30)
    const commentLength = directory.readUInt16LE(at + 32)
    const nameEnd = at + 46 + nameLength

    if (nameEnd + extraLength + commentLength > directory.length) {
      throw new ZipError('Damaged zip directory')
    }

    const entry: ZipEntry = {
      name: directory.toString(flags & 0x800 ? 'utf8' : 'latin1', at + 46, nameEnd),
      method: directory.readUInt16LE(at + 10),
      flags,
      crc: directory.readUInt32LE(at + 16),
      compressedSize: directory.readUInt32LE(at + 20),
      size: directory.readUInt32LE(at + 24),
      localHeaderOffset: directory.readUInt32LE(at + 42)
    }

    if (entry.compressedSize === 0xffffffff || entry.size === 0xffffffff || entry.localHeaderOffset === 0xffffffff) {
      applyZip64Extra(entry, directory.subarray(nameEnd, nameEnd + extraLength))
    }

    if (entry.localHeaderOffset + 30 + entry.compressedSize > source.size) {
      throw new ZipError(`${entry.name} points past the end of the zip`)
    }

    // The first entry with a name wins, as in most readers.
    if (!entries.has(entry.name)) {
      entries.set(entry.name, entry)
    }

    at = nameEnd + extraLength + commentLength
  }

  return entries
}

/** Zip64 extra field (0x0001): the 64-bit values, in order, for the fields that were 0xFFFFFFFF. */
function applyZip64Extra(entry: ZipEntry, extra: Buffer): void {
  let at = 0

  while (at + 4 <= extra.length) {
    const id = extra.readUInt16LE(at)
    const length = extra.readUInt16LE(at + 2)
    const data = extra.subarray(at + 4, at + 4 + length)

    if (id === 0x0001) {
      let field = 0
      const next = (): number => {
        if (field + 8 > data.length) {
          throw new ZipError('Broken Zip64 data')
        }

        const value = safeNumber(data.readBigUInt64LE(field))
        field += 8
        return value
      }

      if (entry.size === 0xffffffff) entry.size = next()
      if (entry.compressedSize === 0xffffffff) entry.compressedSize = next()
      if (entry.localHeaderOffset === 0xffffffff) entry.localHeaderOffset = next()
      return
    }

    at += 4 + length
  }

  throw new ZipError('Broken Zip64 data')
}

function safeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ZipError('Zip value out of range')
  }

  return Number(value)
}
