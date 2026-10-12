import { createHash } from 'node:crypto'

import { MetadataError, parseFabricModJson } from './metadata'
import type { ModJarInfo, ModReadResult, NonFabricKind } from './types'
import { ZipError, ZipReader, bufferSource, withZipFile } from './zip'

/**
 * Reads a mod jar the way Fabric Loader's ModDiscoverer does: fabric.mod.json, then the jars it
 * lists under "jars" (recursively), each a mod of its own. Anything Fabric would stop on makes
 * the jar unreadable; a jar without fabric.mod.json is simply not a Fabric mod.
 */

const LIMITS = {
  modJson: 1024 * 1024,
  icon: 256 * 1024,
  nestedJar: 64 * 1024 * 1024,
  nestedJars: 512,
  inflated: 256 * 1024 * 1024
}
/** What the launcher shows: larger icons are left out. */
const ICON_LIMIT = 32 * 1024
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Caps and the jar-in-jar cache, shared by one top-level jar and everything nested in it. */
interface Budget {
  inflated: number
  nestedJars: number
  /** By SHA-1 of the nested jar's bytes (Fabric dedupes nested jars by hash too). */
  seen: Map<string, Promise<ModJarInfo | null>>
}

export async function readModJar(path: string): Promise<ModReadResult> {
  try {
    return { ok: true, info: await withZipFile(path, (zip) => readTopLevel(zip)) }
  } catch (error) {
    return failure(error)
  }
}

/** A jar already in memory, read as a top-level mod (Java's ZipFile rules). */
export async function readModJarFromBuffer(buffer: Buffer): Promise<ModReadResult> {
  try {
    return { ok: true, info: await readTopLevel(await ZipReader.open(bufferSource(buffer), 'file')) }
  } catch (error) {
    return failure(error)
  }
}

/** The mod's icon if it is a PNG of at most 32 KiB, else null. */
export async function readModIcon(path: string, iconPath: string): Promise<Buffer | null> {
  return withZipFile(path, async (zip) => {
    const entry = zip.entry(iconPath.replace(/^\/+/, ''))

    if (!entry || entry.size > ICON_LIMIT) {
      return null
    }

    const data = await zip.read(entry, ICON_LIMIT)
    return data.subarray(0, PNG.length).equals(PNG) ? data : null
  })
}

function failure(error: unknown): ModReadResult {
  if (error instanceof ZipError) {
    return { ok: false, kind: error.kind, message: error.message }
  }

  if (error instanceof MetadataError) {
    return { ok: false, kind: 'unreadable', message: error.message }
  }

  // The file itself couldn't be opened or read (permissions, gone, locked): not Fabric's verdict.
  return { ok: false, kind: 'unchecked', message: error instanceof Error ? error.message : String(error) }
}

async function readTopLevel(zip: ZipReader): Promise<ModJarInfo> {
  const budget: Budget = { inflated: LIMITS.inflated, nestedJars: LIMITS.nestedJars, seen: new Map() }
  const info = await readMod(zip, budget)

  if (info) {
    // The icon is only worth showing if it is there (schema 0 always names assets/<id>/icon.png).
    if (info.metadata?.icon && !zip.entry(info.metadata.icon.replace(/^\/+/, ''))) {
      info.metadata.icon = null
    }

    return info
  }

  return { metadata: null, nonFabric: nonFabricKind(zip), nested: [] }
}

function nonFabricKind(zip: ZipReader): NonFabricKind {
  if (zip.entry('META-INF/mods.toml')) return 'forge'
  if (zip.entry('META-INF/neoforge.mods.toml')) return 'neoforge'
  if (zip.entry('quilt.mod.json')) return 'quilt'
  return 'unknown'
}

/** A jar's mod and its nested mods; null when it has no fabric.mod.json. */
async function readMod(zip: ZipReader, budget: Budget): Promise<ModJarInfo | null> {
  const modJson = zip.entry('fabric.mod.json')

  if (!modJson) {
    return null
  }

  const metadata = parseFabricModJson(await readCounted(zip, modJson.name, LIMITS.modJson, budget))
  const nested: ModJarInfo[] = []

  // Fabric doesn't look inside mods that don't run on the client.
  if (metadata.environment === 'server') {
    return { metadata, nonFabric: null, nested }
  }

  for (const path of new Set(metadata.jars)) {
    const entry = zip.entry(path)

    // Missing entries are skipped quietly in production, as are names not ending in .jar.
    if (!entry || !path.endsWith('.jar')) {
      continue
    }

    if (--budget.nestedJars < 0) {
      throw new ZipError('Too many nested jars to check', 'unchecked')
    }

    const bytes = await readCounted(zip, path, LIMITS.nestedJar, budget)
    const hash = createHash('sha1').update(bytes).digest('hex')
    let pending = budget.seen.get(hash)

    if (!pending) {
      pending = readNested(path, bytes, budget)
      budget.seen.set(hash, pending)
    }

    const child = await pending

    if (child) {
      nested.push(child)
    }
  }

  return { metadata, nonFabric: null, nested }
}

/** A jar inside a jar: Fabric streams it with ZipInputStream. */
async function readNested(path: string, bytes: Buffer, budget: Budget): Promise<ModJarInfo | null> {
  let zip: ZipReader

  try {
    zip = await ZipReader.open(bufferSource(bytes), 'stream')
  } catch (error) {
    // ZipInputStream finds no entries in something that doesn't start like a zip: no
    // fabric.mod.json, so Fabric ignores it.
    if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) {
      return null
    }

    throw nestedError(path, error)
  }

  try {
    return await readMod(zip, budget)
  } catch (error) {
    throw nestedError(path, error)
  }
}

function nestedError(path: string, error: unknown): unknown {
  const name = path.split('/').pop()

  if (error instanceof ZipError) {
    return new ZipError(`${name}: ${error.message}`, error.kind)
  }

  if (error instanceof MetadataError) {
    return new MetadataError(`${name}: ${error.message}`)
  }

  return error
}

async function readCounted(zip: ZipReader, name: string, limit: number, budget: Budget): Promise<Buffer> {
  const entry = zip.entry(name)!

  if (entry.size > budget.inflated) {
    throw new ZipError('Too much to unpack to check this jar', 'unchecked')
  }

  const data = await zip.read(entry, limit)
  budget.inflated -= data.length
  return data
}
