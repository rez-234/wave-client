import { crc32, deflateRawSync } from 'node:zlib'

export interface ZipFileSpec {
  name: string
  data: Buffer | string
  /** 0 = stored, 8 = deflated (default). */
  method?: 0 | 8
}

/**
 * Builds a zip (a mod jar) in memory for tests. With `zip64`, sizes and offsets are written the
 * Zip64 way (0xFFFFFFFF markers, extra fields and a Zip64 end record), as large jars have them.
 */
export function makeZip(files: ZipFileSpec[], options: { zip64?: boolean; comment?: string } = {}): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const file of files) {
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data)
    const method = file.method ?? 8
    const body = method === 8 ? deflateRawSync(data) : data
    const name = Buffer.from(file.name, 'utf8')
    const crc = crc32(data) >>> 0

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, body)

    const extra = options.zip64 ? Buffer.alloc(28) : Buffer.alloc(0)

    if (options.zip64) {
      extra.writeUInt16LE(0x0001, 0)
      extra.writeUInt16LE(24, 2)
      extra.writeBigUInt64LE(BigInt(data.length), 4)
      extra.writeBigUInt64LE(BigInt(body.length), 12)
      extra.writeBigUInt64LE(BigInt(offset), 20)
    }

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(45, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(options.zip64 ? 0xffffffff : body.length, 20)
    central.writeUInt32LE(options.zip64 ? 0xffffffff : data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(extra.length, 30)
    central.writeUInt32LE(options.zip64 ? 0xffffffff : offset, 42)
    centrals.push(central, name, extra)

    offset += 30 + name.length + body.length
  }

  const directory = Buffer.concat(centrals)
  const comment = Buffer.from(options.comment ?? '')
  const tail: Buffer[] = []

  if (options.zip64) {
    const record = Buffer.alloc(56)
    record.writeUInt32LE(0x06064b50, 0)
    record.writeBigUInt64LE(44n, 4)
    record.writeUInt16LE(45, 12)
    record.writeUInt16LE(45, 14)
    record.writeBigUInt64LE(BigInt(files.length), 24)
    record.writeBigUInt64LE(BigInt(files.length), 32)
    record.writeBigUInt64LE(BigInt(directory.length), 40)
    record.writeBigUInt64LE(BigInt(offset), 48)
    const locator = Buffer.alloc(20)
    locator.writeUInt32LE(0x07064b50, 0)
    locator.writeBigUInt64LE(BigInt(offset + directory.length), 8)
    locator.writeUInt32LE(1, 16)
    tail.push(record, locator)
  }

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(options.zip64 ? 0xffff : files.length, 8)
  eocd.writeUInt16LE(options.zip64 ? 0xffff : files.length, 10)
  eocd.writeUInt32LE(options.zip64 ? 0xffffffff : directory.length, 12)
  eocd.writeUInt32LE(options.zip64 ? 0xffffffff : offset, 16)
  eocd.writeUInt16LE(comment.length, 20)

  return Buffer.concat([...locals, directory, ...tail, eocd, comment])
}
