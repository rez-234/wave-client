import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { DownloadItem, DownloadQueue } from '../net/downloads'
import { inside } from '../paths'
import type { AssetIndexRef } from './version'

export const ASSET_OBJECTS_URL = 'https://resources.download.minecraft.net/'

export interface AssetIndex {
  objects: Record<string, { hash: string; size: number }>
  /** Pre-1.7.3: assets are also copied into assets/virtual/<id>/. */
  virtual?: boolean
  /** Pre-1.6: assets are also copied into <gameDir>/resources/. */
  map_to_resources?: boolean
}

export interface AssetLayout {
  /** The folder passed as --assetsDir (or the virtual folder for old indexes). */
  assetsRoot: string
  indexId: string
  /** Files to copy after download for old indexes: [from object, to path]. */
  copies: [string, string][]
}

const HASH = /^[0-9a-f]{40}$/

/** The asset index file itself, downloaded and verified like any other file. */
export function assetIndexItem(assetsDir: string, ref: AssetIndexRef): DownloadItem {
  return { url: ref.url, path: inside(join(assetsDir, 'indexes'), `${ref.id}.json`), sha1: ref.sha1, size: ref.size }
}

/** Every object in an index as a download, plus where old indexes want copies. */
export function assetObjects(assetsDir: string, ref: AssetIndexRef, index: AssetIndex, gameDir: string): { items: DownloadItem[]; layout: AssetLayout } {
  const items: DownloadItem[] = []
  const copies: [string, string][] = []
  const virtualRoot = join(assetsDir, 'virtual', ref.id)

  for (const [name, object] of Object.entries(index.objects)) {
    if (!HASH.test(object.hash)) {
      throw new Error(`Bad asset hash for ${name}`)
    }

    const sub = object.hash.slice(0, 2)
    const path = join(assetsDir, 'objects', sub, object.hash)
    items.push({ url: `${ASSET_OBJECTS_URL}${sub}/${object.hash}`, path, sha1: object.hash, size: object.size })

    if (index.virtual) {
      copies.push([path, inside(virtualRoot, name)])
    }

    if (index.map_to_resources) {
      copies.push([path, inside(join(gameDir, 'resources'), name)])
    }
  }

  return { items, layout: { assetsRoot: index.virtual ? virtualRoot : assetsDir, indexId: ref.id, copies } }
}

export async function readAssetIndex(assetsDir: string, ref: AssetIndexRef): Promise<AssetIndex> {
  const index = JSON.parse(await readFile(assetIndexItem(assetsDir, ref).path, 'utf8')) as AssetIndex

  if (!index || typeof index.objects !== 'object') {
    throw new Error(`Asset index ${ref.id} is malformed`)
  }

  return index
}

/** Copies objects for old index layouts, skipping copies that are already there. */
export async function applyAssetCopies(copies: [string, string][]): Promise<void> {
  for (const [from, to] of copies) {
    const [source, target] = await Promise.all([stat(from), stat(to).catch(() => null)])

    if (target?.size === source.size) {
      continue
    }

    await mkdir(dirname(to), { recursive: true })
    await copyFile(from, to)
  }
}

/** Downloads the index, then every object. */
export async function installAssets(
  queue: DownloadQueue,
  assetsDir: string,
  ref: AssetIndexRef,
  gameDir: string,
  options: Parameters<DownloadQueue['run']>[1] = {}
): Promise<AssetLayout> {
  await queue.run([assetIndexItem(assetsDir, ref)], { signal: options.signal, verify: 'hash' })
  const index = await readAssetIndex(assetsDir, ref)
  const { items, layout } = assetObjects(assetsDir, ref, index, gameDir)
  await queue.run(items, options)
  await applyAssetCopies(layout.copies)
  return layout
}
