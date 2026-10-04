import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { TaskProgress } from '@shared/ipc'

import type { DownloadItem, DownloadQueue } from '../net/downloads'
import type { HttpClient } from '../net/http'
import { inside, instanceDir, versionFiles, type LauncherPaths } from '../paths'
import { installAssets } from './assets'
import { prepareClientMods } from './client-mods'
import { fillMissingHashes, loadFabricProfile } from './fabric'
import { installJavaRuntime, probeJava } from './java'
import { PINS } from './pins'
import { mergeVersions, mojangOsName, resolveLibraries, type RuleEnvironment, type VersionJson } from './version'

export const VERSION_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'

interface Manifest {
  versions: { id: string; url: string; sha1: string; type: string }[]
}

export interface GameContext {
  http: HttpClient
  queue: DownloadQueue
  paths: LauncherPaths
  platform: string
  arch: string
  osVersion: string
}

export interface PrepareOptions {
  signal?: AbortSignal
  /** Re-hash every existing file instead of trusting sizes. */
  repair?: boolean
  onTask?: (task: TaskProgress) => void
  /** A user-chosen Java instead of Mojang's runtime. */
  javaPath?: string | null
  /** Our mod jar, shipped with the launcher. */
  bundledModJar: string
  profileId?: string
}

/** Everything about an installed game except who plays it and the user's settings. */
export interface PreparedGame {
  version: VersionJson
  env: RuleEnvironment
  java: string
  classpath: string[]
  gameDir: string
  nativesDir: string
  librariesDir: string
  assetsRoot: string
  assetIndexName: string
  logConfigPath: string | null
  addMods: string[]
}

/**
 * Makes sure Minecraft, Fabric, Java, assets and our mods are installed and valid, downloading
 * whatever is missing, and returns what the launch command needs.
 */
export async function prepareGame(context: GameContext, options: PrepareOptions): Promise<PreparedGame> {
  const { http, queue, paths } = context
  const signal = options.signal
  const verify = options.repair ? 'hash' : 'size'
  const env: RuleEnvironment = { os: mojangOsName(context.platform), arch: context.arch, osVersion: context.osVersion, features: {} }

  if (context.platform === 'linux' && context.arch !== 'x64') {
    // Mojang ships neither a Java runtime nor LWJGL natives for Linux on ARM (or 32-bit).
    throw new Error(`Minecraft ${PINS.minecraft} doesn't support Linux on ${context.arch}.`)
  }
  const task = (label: string) => (progress: Omit<TaskProgress, 'label'>) => options.onTask?.({ label, ...progress })
  const announce = (label: string) => options.onTask?.({ label, doneFiles: 0, totalFiles: 0, doneBytes: 0, totalBytes: 0 })

  announce('Checking for updates')
  const vanilla = await loadVanillaVersion(context, PINS.minecraft, signal)
  const fabric = await loadFabricProfile(http, paths, PINS.minecraft, PINS.fabricLoader, signal)
  const version = mergeVersions(fabric, vanilla)

  if (!version.downloads?.client || !version.assetIndex) {
    throw new Error(`Minecraft ${PINS.minecraft} metadata is missing the client or assets`)
  }

  // Java first: it's needed to launch and is the largest single download.
  let java: string

  if (options.javaPath) {
    announce('Checking Java')
    const info = await probeJava(options.javaPath)
    const required = version.javaVersion?.majorVersion ?? 21

    if (info.major < required) {
      throw new Error(`Minecraft ${PINS.minecraft} needs Java ${required}, but the Java chosen in Settings is ${info.version}.`)
    }

    java = options.javaPath
  } else {
    java = await installJavaRuntime(http, queue, paths.runtimes, version.javaVersion?.component ?? 'java-runtime-delta', {
      signal,
      verify,
      onProgress: task('Downloading Java'),
      platform: context.platform,
      arch: context.arch
    })
  }

  announce('Checking game files')
  const libraries = await fillMissingHashes(http, resolveLibraries(version.libraries ?? [], env), signal)
  const clientJar = versionFiles(paths, PINS.minecraft).jar
  const logConfig = version.logging?.client?.file
  const logConfigPath = logConfig ? inside(join(paths.assets, 'log_configs'), logConfig.id) : null
  const files: DownloadItem[] = [
    ...libraries.map((library) => ({ url: library.url, path: inside(paths.libraries, library.path), sha1: library.sha1, size: library.size })),
    { url: version.downloads.client.url, path: clientJar, sha1: version.downloads.client.sha1, size: version.downloads.client.size }
  ]

  if (logConfig && logConfigPath) {
    files.push({ url: logConfig.url, path: logConfigPath, sha1: logConfig.sha1, size: logConfig.size })
  }

  await queue.run(files, { signal, verify, onProgress: task('Downloading game files') })

  const gameDir = instanceDir(paths, options.profileId ?? 'default')
  await mkdir(gameDir, { recursive: true })
  const assets = await installAssets(queue, paths.assets, version.assetIndex, gameDir, { signal, verify, onProgress: task('Downloading assets') })

  announce('Preparing mods')
  const clientMods = await prepareClientMods(http, queue, paths.client, PINS.fabricApi, options.bundledModJar, { signal, verify })

  const nativesDir = join(versionFiles(paths, version.id).dir, 'natives')
  await mkdir(nativesDir, { recursive: true })

  return {
    version,
    env,
    java,
    classpath: [...libraries.map((library) => inside(paths.libraries, library.path)), clientJar],
    gameDir,
    nativesDir,
    librariesDir: paths.libraries,
    assetsRoot: assets.assetsRoot,
    assetIndexName: assets.indexId,
    logConfigPath,
    addMods: clientMods.length > 0 ? [paths.client] : []
  }
}

/**
 * The vanilla version JSON, checked against the SHA-1 in Mojang's manifest. When the manifest
 * can't be reached, a copy downloaded (and checked) earlier is used.
 */
async function loadVanillaVersion(context: GameContext, id: string, signal?: AbortSignal): Promise<VersionJson> {
  const files = versionFiles(context.paths, id)

  try {
    const manifest = await context.http.getJson<Manifest>(VERSION_MANIFEST, { signal })
    const entry = manifest.versions.find((v) => v.id === id)

    if (!entry) {
      throw new Error(`Minecraft ${id} is not in Mojang's version list`)
    }

    await context.queue.run([{ url: entry.url, path: files.json, sha1: entry.sha1 }], { signal, verify: 'hash' })
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }

    try {
      await readFile(files.json)
    } catch {
      throw error
    }
  }

  const version = JSON.parse(await readFile(files.json, 'utf8')) as VersionJson

  if (version.id !== id) {
    throw new Error(`Downloaded metadata is for ${version.id}, not ${id}`)
  }

  return version
}
