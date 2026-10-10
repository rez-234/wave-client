import { copyFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { sha1File, type DownloadOptions, type DownloadQueue } from '../net/downloads'
import type { HttpClient } from '../net/http'
import { fabricApiPath, fabricApiUrl, mavenSha1 } from './fabric'

/**
 * The launcher-owned folder passed to Fabric as -Dfabric.addMods: exactly our mod and the pinned
 * Fabric API, nothing else. Users' own mods go in the profile's mods folder instead.
 */
export async function prepareClientMods(
  http: HttpClient,
  queue: DownloadQueue,
  clientDir: string,
  librariesDir: string,
  fabricApiVersion: string,
  bundledModJar: string,
  options: DownloadOptions = {}
): Promise<string[]> {
  await mkdir(clientDir, { recursive: true })
  const apiUrl = fabricApiUrl(fabricApiVersion)
  const apiFile = `fabric-api-${fabricApiVersion}.jar`
  const modFile = basename(bundledModJar)

  if (!/^waveclient-[\w.+-]+\.jar$/.test(modFile)) {
    throw new Error(`Unexpected mod jar name: ${modFile}`)
  }

  const apiSha1 = await mavenSha1(http, librariesDir, fabricApiPath(fabricApiVersion), apiUrl, options.signal)
  await queue.run([{ url: apiUrl, path: join(clientDir, apiFile), sha1: apiSha1 }], options)
  await copyIfChanged(bundledModJar, join(clientDir, modFile))

  const keep = new Set([apiFile, modFile])

  for (const entry of await readdir(clientDir)) {
    if (!keep.has(entry)) {
      await rm(join(clientDir, entry), { force: true, recursive: true })
    }
  }

  return [...keep].map((file) => join(clientDir, file))
}

async function copyIfChanged(source: string, target: string): Promise<void> {
  const sourceInfo = await stat(source)
  const targetInfo = await stat(target).catch(() => null)

  if (targetInfo?.size === sourceInfo.size && (await sha1File(target)) === (await sha1File(source))) {
    return
  }

  const temp = `${target}.part`
  await copyFile(source, temp)
  await rename(temp, target)
}
