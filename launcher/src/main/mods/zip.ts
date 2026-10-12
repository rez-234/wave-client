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
 *
 * Fabric Loader opens a mod jar with Java's ZipFile and a jar inside a jar with ZipInputStream,
 * and fails the whole launch when either throws. So the reader copies their rules where it
 * matters ('file' and 'stream' mode), and every failure says whether Java would fail too
 * ('unreadable') or whether it is only something this reader doesn't handle ('unchecked').
 */

export interface ZipEntry {
  name: string
  method: number
  flags: number
  crc: number
  compressedSize: number
  size: number
  /** Already shifted by any bytes in front of the zip, as Java does. */
  localHeaderOffset: number
  /** Why Java would refuse this entry (encrypted, unknown method), checked when it is read. */
  invalid?: string
}

/** Where the zip's bytes come from. */
export interface ZipSource {
  size: number
  read(offset: number, length: number): Promise<Buffer>
}

/**
 * unreadable: Java would fail on it too, so Fabric would. unchecked: this reader couldn't handle
 * it (a cap, an unusual layout), but Java might.
 */
export type ZipErrorKind = 'unreadable' | 'unchecked'

export class ZipError extends Error {
  constructor(
    message: string,
    readonly kind: ZipErrorKind = 'unreadable'
  ) {
    super(message)
    this.name = 'ZipError'
  }
}

/**
 * file: java.util.zip.ZipFile (Fabric's top-level jars): every directory entry is validated when
 * the zip is opened; CRCs aren't checked. stream: ZipInputStream (nested jars): problems surface
 * only for the entries read, and a wrong CRC or size fails.
 */
export type ZipMode = 'file' | 'stream'

const EOCD = 0x06054b50
const EOCD64_LOCATOR = 0x07064b50
const EOCD64 = 0x06064b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50
/** EOCD record plus the longest possible comment. */
const EOCD_SEARCH = 22 + 0xffff
const MAX_ENTRIES = 200_000
const MAX_CENTRAL_DIRECTORY = 64 * 1024 * 1024
const MAGIC32 = 0xffffffff

export function bufferSource(buffer: Buffer): ZipSource {
  return {
    size: buffer.length,
    read: async (offset, length) => {
      if (offset < 0 || offset + length > buffer.length) {
        throw new ZipError('The zip ends early')
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
        throw new ZipError('The zip ends early')
      }

      const buffer = Buffer.alloc(length)
      let done = 0

      while (done < length) {
        const { bytesRead } = await handle.read(buffer, done, length - done, offset + done)

        if (bytesRead === 0) {
          throw new ZipError('The file ended early', 'unchecked')
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
    readonly mode: ZipMode,
    readonly entries: ReadonlyMap<string, ZipEntry>
  ) {}

  static async open(source: ZipSource, mode: ZipMode = 'file'): Promise<ZipReader> {
    try {
      return new ZipReader(source, mode, await readCentralDirectory(source, mode))
    } catch (error) {
      // ZipInputStream never reads the directory: whatever is wrong with it, Java may cope.
      if (mode === 'stream' && error instanceof ZipError) {
        throw new ZipError(error.message, 'unchecked')
      }

      throw error
    }
  }

  entry(name: string): ZipEntry | undefined {
    return this.entries.get(name)
  }

  /** An entry's contents, refusing anything larger than maxSize once inflated. */
  async read(entry: ZipEntry, maxSize: number): Promise<Buffer> {
    if (entry.invalid) {
      throw new ZipError(`${entry.name}: ${entry.invalid}`)
    }

    if (entry.size > maxSize) {
      throw new ZipError(`${entry.name} is too large to check (${entry.size} bytes)`, 'unchecked')
    }

    const header = await this.source.read(entry.localHeaderOffset, 30)

    if (header.readUInt32LE(0) !== LOCAL) {
      throw new ZipError(`Bad local header for ${entry.name}`)
    }

    // The local name and extra lengths, not the central ones: they often differ.
    const start = entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28)
    const raw = await this.source.read(start, entry.compressedSize)
    let data: Buffer

    if (entry.method === 0) {
      data = raw
    } else {
      try {
        data = await inflate(raw, { maxOutputLength: Math.max(1, Math.min(entry.size, maxSize)) })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
          // Larger than the directory says: Java's ZipFile reads on regardless.
          throw new ZipError(`${entry.name} is larger than its zip directory says`, this.mode === 'file' ? 'unchecked' : 'unreadable')
        }

        throw new ZipError(`${entry.name} is damaged (${error instanceof Error ? error.message : String(error)})`)
      }
    }

    if (data.length !== entry.size || crc32(data) >>> 0 !== entry.crc >>> 0) {
      // ZipFile doesn't check the CRC; ZipInputStream does.
      throw new ZipError(`${entry.name} is damaged (wrong size or checksum)`, this.mode === 'file' ? 'unchecked' : 'unreadable')
    }

    return data
  }
}

/** Opens a zip file on disk (ZipFile rules), runs `use` and closes it again. */
export async function withZipFile<T>(path: string, use: (zip: ZipReader) => Promise<T>): Promise<T> {
  const handle = await open(path, 'r')

  try {
    const { size } = await handle.stat()
    return await use(await ZipReader.open(handleSource(handle, size), 'file'))
  } finally {
    await handle.close()
  }
}

interface End {
  /** Where the end record (or the Zip64 end record) starts. */
  endPos: number
  count: number
  cdSize: number
  cdOffset: number
}

/**
 * Finds the end record the way JDK 21's ZipFile.Source.findEND does: scanning back, and when the
 * comment length doesn't reach the end of the file, accepting the record only if the directory
 * and first local header are where it says.
 */
async function findEnd(source: ZipSource): Promise<End> {
  if (source.size < 22) {
    throw new ZipError('Not a zip file')
  }

  const tailLength = Math.min(source.size, EOCD_SEARCH)
  const tailStart = source.size - tailLength
  const tail = await source.read(tailStart, tailLength)

  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) !== EOCD) {
      continue
    }

    const end: End = {
      endPos: tailStart + i,
      count: tail.readUInt16LE(i + 10),
      cdSize: tail.readUInt32LE(i + 12),
      cdOffset: tail.readUInt32LE(i + 16)
    }
    const commentLength = tail.readUInt16LE(i + 20)

    if (end.endPos + 22 + commentLength !== source.size) {
      const cdPos = end.endPos - end.cdSize
      const locPos = cdPos - end.cdOffset

      if (cdPos < 0 || locPos < 0 || (await signatureAt(source, cdPos)) !== CENTRAL || (await signatureAt(source, locPos)) !== LOCAL) {
        continue
      }
    }

    await applyZip64End(source, end)
    return end
  }

  throw new ZipError('Not a zip file')
}

async function signatureAt(source: ZipSource, offset: number): Promise<number | null> {
  if (offset < 0 || offset + 4 > source.size) {
    return null
  }

  return (await source.read(offset, 4)).readUInt32LE(0)
}

/** A Zip64 end record replaces the plain one's values when present and consistent (as in Java). */
async function applyZip64End(source: ZipSource, end: End): Promise<void> {
  if (end.endPos < 20 || (await signatureAt(source, end.endPos - 20)) !== EOCD64_LOCATOR) {
    return
  }

  const locator = await source.read(end.endPos - 20, 20)
  const recordAt = locator.readBigUInt64LE(8)

  if (recordAt > BigInt(source.size - 56) || (await signatureAt(source, Number(recordAt))) !== EOCD64) {
    return
  }

  const record = await source.read(Number(recordAt), 56)
  const count = record.readBigUInt64LE(32)
  const cdSize = record.readBigUInt64LE(40)
  const cdOffset = record.readBigUInt64LE(48)

  if (
    (cdSize !== BigInt(end.cdSize) && end.cdSize !== MAGIC32) ||
    (cdOffset !== BigInt(end.cdOffset) && end.cdOffset !== MAGIC32) ||
    (count !== BigInt(end.count) && end.count !== 0xffff)
  ) {
    return
  }

  end.count = safeNumber(count)
  end.cdSize = safeNumber(cdSize)
  end.cdOffset = safeNumber(cdOffset)
  end.endPos = Number(recordAt)
}

async function readCentralDirectory(source: ZipSource, mode: ZipMode): Promise<Map<string, ZipEntry>> {
  const end = await findEnd(source)

  if (end.cdSize > end.endPos) {
    throw new ZipError('Bad zip directory size')
  }

  // Java takes the directory to sit right before the end record; anything before the recorded
  // offset (a launcher stub, a signature block) shifts every local header by the same amount.
  const cdPos = end.endPos - end.cdSize
  const shift = cdPos - end.cdOffset

  if (shift < 0) {
    throw new ZipError('Bad zip directory offset')
  }

  if (end.count > MAX_ENTRIES || end.cdSize > MAX_CENTRAL_DIRECTORY) {
    throw new ZipError('The zip has too many files to check', 'unchecked')
  }

  const directory = await source.read(cdPos, end.cdSize)
  const entries = new Map<string, ZipEntry>()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let at = 0
  let n = 0

  while (at + 46 <= directory.length) {
    if (directory.readUInt32LE(at) !== CENTRAL) {
      throw new ZipError('Damaged zip directory (bad signature)')
    }

    const flags = directory.readUInt16LE(at + 8)
    const method = directory.readUInt16LE(at + 10)
    const nameLength = directory.readUInt16LE(at + 28)
    const extraLength = directory.readUInt16LE(at + 30)
    const commentLength = directory.readUInt16LE(at + 32)
    const nameEnd = at + 46 + nameLength

    if (nameEnd + extraLength + commentLength > directory.length) {
      throw new ZipError('Damaged zip directory (bad header size)')
    }

    let name: string

    try {
      // Java reads jar entry names as UTF-8 whatever the flag says.
      name = decoder.decode(directory.subarray(at + 46, nameEnd))
    } catch {
      throw new ZipError('Damaged zip directory (bad entry name)')
    }

    let invalid: string | undefined

    if (flags & 0x1) {
      invalid = 'encrypted entry'
    } else if (method !== 0 && method !== 8) {
      invalid = `unsupported compression method ${method}`
    }

    // ZipFile refuses the whole jar for any such entry; ZipInputStream only for those it reads.
    if (invalid && mode === 'file') {
      throw new ZipError(`The zip has an ${invalid} (${name})`)
    }

    const entry: ZipEntry = {
      name,
      method,
      flags,
      crc: directory.readUInt32LE(at + 16),
      compressedSize: directory.readUInt32LE(at + 20),
      size: directory.readUInt32LE(at + 24),
      localHeaderOffset: directory.readUInt32LE(at + 42),
      ...(invalid ? { invalid } : {})
    }

    if (entry.compressedSize === MAGIC32 || entry.size === MAGIC32 || entry.localHeaderOffset === MAGIC32) {
      applyZip64Extra(entry, directory.subarray(nameEnd, nameEnd + extraLength))
    }

    entry.localHeaderOffset += shift

    if (entry.localHeaderOffset + 30 + entry.compressedSize > source.size) {
      throw new ZipError(`${name} points past the end of the zip`)
    }

    // ZipFile finds the last entry of a name, ZipInputStream the first.
    if (mode === 'file' || !entries.has(name)) {
      entries.set(name, entry)
    }

    at = nameEnd + extraLength + commentLength
    n++
  }

  if (n !== end.count) {
    throw new ZipError('The zip directory lists a different number of files', 'unchecked')
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

      if (entry.size === MAGIC32) entry.size = next()
      if (entry.compressedSize === MAGIC32) entry.compressedSize = next()
      if (entry.localHeaderOffset === MAGIC32) entry.localHeaderOffset = next()
      return
    }

    at += 4 + length
  }

  throw new ZipError('Broken Zip64 data')
}

function safeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ZipError('Zip value out of range', 'unchecked')
  }

  return Number(value)
}
