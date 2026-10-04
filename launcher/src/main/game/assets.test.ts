import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DownloadQueue } from '../net/downloads'
import { HttpClient, type FetchFn } from '../net/http'
import { assetObjects, installAssets } from './assets'

const sha1 = (text: string): string => createHash('sha1').update(text).digest('hex')

describe('assets', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wave-assets-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  function setup(extra: object = {}) {
    const sound = 'sound-bytes'
    const lang = 'lang-bytes'
    const index = {
      objects: {
        'minecraft/sounds/a.ogg': { hash: sha1(sound), size: sound.length },
        'minecraft/lang/en_us.json': { hash: sha1(lang), size: lang.length }
      },
      ...extra
    }
    const indexText = JSON.stringify(index)
    const files: Record<string, string> = {
      'https://meta/29.json': indexText,
      [`https://resources.download.minecraft.net/${sha1(sound).slice(0, 2)}/${sha1(sound)}`]: sound,
      [`https://resources.download.minecraft.net/${sha1(lang).slice(0, 2)}/${sha1(lang)}`]: lang
    }
    const calls: string[] = []
    const fetch: FetchFn = async (url) => {
      calls.push(url)
      return files[url] === undefined ? new Response('', { status: 404 }) : new Response(files[url])
    }
    const http = new HttpClient({ fetch, userAgent: 't', backoffMs: () => 0, sleep: async () => {} })
    const ref = { id: '29', url: 'https://meta/29.json', sha1: sha1(indexText), size: indexText.length }
    return { queue: new DownloadQueue({ http }), ref, calls, sound }
  }

  it('downloads the index and each object into objects/<xx>/<hash>', async () => {
    const { queue, ref, calls, sound } = setup()
    const layout = await installAssets(queue, join(dir, 'assets'), ref, join(dir, 'game'))

    expect(layout).toEqual({ assetsRoot: join(dir, 'assets'), indexId: '29', copies: [] })
    expect(await readFile(join(dir, 'assets', 'indexes', '29.json'), 'utf8')).toContain('objects')
    expect(await readFile(join(dir, 'assets', 'objects', sha1(sound).slice(0, 2), sha1(sound)), 'utf8')).toBe(sound)
    expect(calls).toHaveLength(3)

    await installAssets(queue, join(dir, 'assets'), ref, join(dir, 'game'))
    expect(calls).toHaveLength(3)
  })

  it('copies objects for virtual and resources-mapped indexes', async () => {
    const { queue, ref, sound } = setup({ virtual: true, map_to_resources: true })
    const layout = await installAssets(queue, join(dir, 'assets'), ref, join(dir, 'game'))

    expect(layout.assetsRoot).toBe(join(dir, 'assets', 'virtual', '29'))
    expect(await readFile(join(dir, 'assets', 'virtual', '29', 'minecraft', 'sounds', 'a.ogg'), 'utf8')).toBe(sound)
    expect(await readFile(join(dir, 'game', 'resources', 'minecraft', 'sounds', 'a.ogg'), 'utf8')).toBe(sound)
  })

  it('rejects malformed hashes and escaping names', () => {
    const ref = { id: '29', url: 'u', sha1: 'x', size: 1 }
    expect(() => assetObjects(dir, ref, { objects: { a: { hash: '../../x', size: 1 } } }, dir)).toThrow()
    expect(() => assetObjects(dir, ref, { virtual: true, objects: { '../../evil': { hash: sha1('x'), size: 1 } } }, dir)).toThrow(/Unsafe/)
  })
})
