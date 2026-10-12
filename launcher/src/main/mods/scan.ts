import type { BigIntStats } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { readModJar } from './jar'
import type { ModReadResult, ScanResult, ScannedMod } from './types'

/**
 * Lists a profile's mods folder the way Fabric Loader's DirectoryModCandidateFinder walks it: the
 * top level only, following links, regular files whose name ends in exactly ".jar" and doesn't
 * start with "."; "x.jar.disabled" is the launcher's "off". Windows' hidden attribute, which
 * Fabric also skips, can't be seen from Node: such a jar is listed as on.
 */

/** Jars opened at once: enough to keep the disk busy without a burst of open files. */
const PARALLEL = 4
const DISABLED = '.disabled'

export async function scanModsFolder(dir: string, cache: ModJarCache): Promise<ScanResult> {
  let names: string[]

  try {
    const info = await stat(dir)

    if (!info.isDirectory()) {
      return { folder: 'not-a-folder', mods: [] }
    }

    names = await readdir(dir)
  } catch (error) {
    // Fabric creates a missing mods folder; anything else stops it.
    return { folder: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable', mods: [] }
  }

  const listed = new Map<string, { file: string; key: string; state: ScannedMod['state'] }>()

  for (const file of names) {
    const form = classify(file)

    // "x.jar" and "x.jar.disabled" side by side: Fabric loads the first, so it is the one shown.
    if (form && !(form.state === 'off' && listed.has(form.key))) {
      listed.set(form.key, { file, ...form })
    }
  }

  const mods: ScannedMod[] = []
  const queue = [...listed.values()]

  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const path = join(dir, next.file)
      let stats: BigIntStats

      try {
        stats = await stat(path, { bigint: true })
      } catch {
        continue // gone, or a broken link: Fabric skips it too
      }

      if (!stats.isFile()) {
        continue
      }

      mods.push({
        key: next.key,
        file: next.file,
        state: next.state,
        size: Number(stats.size),
        mtimeMs: Number(stats.mtimeMs),
        read: await cache.read(path, next.file, next.key, stats)
      })
    }
  }

  await Promise.all(Array.from({ length: PARALLEL }, worker))
  mods.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return { folder: 'ok', mods }
}

/** What a file in mods/ is to Fabric and to the launcher; null when it isn't listed at all. */
export function classify(file: string): { key: string; state: ScannedMod['state'] } | null {
  if (file.startsWith('.')) {
    return null
  }

  if (file.endsWith('.jar')) {
    return { key: file, state: 'on' }
  }

  if (file.endsWith(`.jar${DISABLED}`)) {
    return { key: file.slice(0, -DISABLED.length), state: 'off' }
  }

  // "Sodium.JAR": Fabric ignores it; the player should know why.
  if (/\.jar$/i.test(file)) {
    return { key: file, state: 'case' }
  }

  return null
}

interface CacheEntry {
  file: string
  /** dev, ino, size and mtime: the same file, possibly renamed. */
  identity: string
  result: ModReadResult
}

/**
 * Parsed jars by file identity (device, inode, size, modification and change time), so a scan
 * reads only new or changed jars. A rename changes the change time on most systems, so the last
 * result per mod key is kept too: turning a mod off and on again reuses it if the inode, size
 * and modification time still match. Failures are cached as well. Least recently used entries
 * go first.
 */
export class ModJarCache {
  private readonly byStat = new Map<string, ModReadResult>()
  private readonly byKey = new Map<string, CacheEntry>()
  private readonly pending = new Map<string, Promise<ModReadResult>>()

  constructor(
    private readonly limit = 2000,
    private readonly reader: (path: string) => Promise<ModReadResult> = readModJar
  ) {}

  async read(path: string, file: string, key: string, stats: BigIntStats): Promise<ModReadResult> {
    const identity = `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}`
    const full = `${identity}:${stats.ctimeNs}`
    const cached = this.byStat.get(full)

    if (cached) {
      this.touch(full, cached)
      return cached
    }

    const previous = this.byKey.get(key)

    if (previous && previous.identity === identity && previous.file !== file) {
      this.remember(full, key, file, identity, previous.result)
      return previous.result
    }

    let running = this.pending.get(full)

    if (!running) {
      running = this.reader(path).finally(() => this.pending.delete(full))
      this.pending.set(full, running)
    }

    const result = await running
    this.remember(full, key, file, identity, result)
    return result
  }

  get size(): number {
    return this.byStat.size
  }

  private remember(full: string, key: string, file: string, identity: string, result: ModReadResult): void {
    this.touch(full, result)
    this.byKey.delete(key)
    this.byKey.set(key, { file, identity, result })

    while (this.byStat.size > this.limit) {
      this.byStat.delete(this.byStat.keys().next().value!)
    }

    while (this.byKey.size > this.limit) {
      this.byKey.delete(this.byKey.keys().next().value!)
    }
  }

  private touch(full: string, result: ModReadResult): void {
    this.byStat.delete(full)
    this.byStat.set(full, result)
  }
}
