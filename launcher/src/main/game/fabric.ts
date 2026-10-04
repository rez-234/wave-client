import { mkdir, readFile, writeFile } from 'node:fs/promises'

import type { HttpClient } from '../net/http'
import { versionFiles, type LauncherPaths } from '../paths'
import { mavenUrl, parseMaven } from '../util/maven'
import type { ResolvedLibrary, VersionJson } from './version'

export const FABRIC_META = 'https://meta.fabricmc.net/v2'
export const FABRIC_MAVEN = 'https://maven.fabricmc.net/'

export function fabricVersionId(gameVersion: string, loaderVersion: string): string {
  return `fabric-loader-${loaderVersion}-${gameVersion}`
}

/**
 * Fabric's launcher profile for a game and loader version: a version JSON that inheritsFrom the
 * vanilla version. Saved under versions/ and reused when Fabric's servers can't be reached.
 */
export async function loadFabricProfile(
  http: HttpClient,
  paths: LauncherPaths,
  gameVersion: string,
  loaderVersion: string,
  signal?: AbortSignal
): Promise<VersionJson> {
  const id = fabricVersionId(gameVersion, loaderVersion)
  const files = versionFiles(paths, id)
  const url = `${FABRIC_META}/versions/loader/${encodeURIComponent(gameVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`

  try {
    const profile = checkProfile(await http.getJson<VersionJson>(url, { signal }), id, gameVersion)
    await mkdir(files.dir, { recursive: true })
    await writeFile(files.json, JSON.stringify(profile, null, 2))
    return profile
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }

    try {
      return checkProfile(JSON.parse(await readFile(files.json, 'utf8')) as VersionJson, id, gameVersion)
    } catch {
      throw error
    }
  }
}

function checkProfile(profile: VersionJson, id: string, gameVersion: string): VersionJson {
  if (profile.id !== id || profile.inheritsFrom !== gameVersion || typeof profile.mainClass !== 'string' || !Array.isArray(profile.libraries)) {
    throw new Error(`Fabric's profile for ${id} doesn't look right`)
  }

  for (const library of profile.libraries) {
    parseMaven(library.name)

    if (library.url !== undefined && !library.url.startsWith('https://')) {
      throw new Error(`Fabric library ${library.name} isn't served over HTTPS`)
    }
  }

  return profile
}

/**
 * Libraries with no SHA-1 in their metadata (Fabric's profile omits it for the loader and
 * intermediary) get it from the ".sha1" file next to the jar in the Maven repository, so nothing
 * is downloaded unverified.
 */
export async function fillMissingHashes(http: HttpClient, libraries: ResolvedLibrary[], signal?: AbortSignal): Promise<ResolvedLibrary[]> {
  return Promise.all(
    libraries.map(async (library) => {
      if (library.sha1) {
        return library
      }

      return { ...library, sha1: await fetchMavenSha1(http, library.url, signal) }
    })
  )
}

export async function fetchMavenSha1(http: HttpClient, artifactUrl: string, signal?: AbortSignal): Promise<string> {
  if (!artifactUrl.startsWith('https://')) {
    throw new Error(`Refusing to verify ${artifactUrl}: not HTTPS`)
  }

  const text = await (await http.get(`${artifactUrl}.sha1`, { signal })).text()
  const match = /^\s*([0-9a-fA-F]{40})\b/.exec(text)

  if (!match) {
    throw new Error(`No SHA-1 published for ${artifactUrl}`)
  }

  return match[1]!.toLowerCase()
}

/** The pinned Fabric API jar from Fabric's Maven. */
export function fabricApiUrl(version: string): string {
  return mavenUrl(FABRIC_MAVEN, parseMaven(`net.fabricmc.fabric-api:fabric-api:${version}`))
}
