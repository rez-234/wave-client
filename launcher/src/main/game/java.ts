import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, constants, lstat, mkdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, win32 } from 'node:path'

import { HashMismatchError, type DownloadItem, type DownloadOptions, type DownloadQueue } from '../net/downloads'
import { isUnreachable, type HttpClient } from '../net/http'
import { inside } from '../paths'

/** Mojang's index of Java runtimes per platform and component. */
export const JAVA_RUNTIME_INDEX =
  'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json'

interface RuntimeEntry {
  manifest: { sha1: string; size: number; url: string }
  version: { name: string; released: string }
}

type RuntimeIndex = Record<string, Record<string, RuntimeEntry[]>>

interface RuntimeFile {
  type: 'file' | 'directory' | 'link'
  executable?: boolean
  target?: string
  downloads?: { raw?: { sha1: string; size: number; url: string }; lzma?: { sha1: string; size: number; url: string } }
}

interface RuntimeManifest {
  files: Record<string, RuntimeFile>
}

/** Written into an installed runtime, last, once it is complete. */
interface RuntimeMarker {
  component: string
  platform: string
  version: string
  /** The manifest the files were checked against; a different one means Mojang updated the runtime. */
  manifestSha1: string
}

const MARKER = '.wave-runtime.json'
/** The manifest itself, so an installed runtime can be checked without Mojang's servers. */
const SAVED_MANIFEST = '.wave-runtime-manifest.json'

export class NoManagedJavaError extends Error {
  constructor(readonly platformKey: string | null, readonly component: string) {
    super(
      platformKey
        ? `Mojang has no ${component} Java runtime for ${platformKey}. Choose a Java ${component === 'java-runtime-delta' ? '21' : ''} installation in Settings.`
        : `Mojang has no Java runtimes for this system. Choose a Java installation in Settings.`
    )
    this.name = 'NoManagedJavaError'
  }
}

/** Mojang's platform key for this machine, or null where Mojang ships no runtimes (e.g. Linux on ARM). */
export function runtimePlatformKey(platform: string, arch: string): string | null {
  switch (`${platform}-${arch}`) {
    case 'win32-x64':
      return 'windows-x64'
    case 'win32-arm64':
      return 'windows-arm64'
    case 'win32-ia32':
      return 'windows-x86'
    case 'darwin-x64':
      return 'mac-os'
    case 'darwin-arm64':
      return 'mac-os-arm64'
    case 'linux-x64':
      return 'linux'
    case 'linux-ia32':
      return 'linux-i386'
    default:
      return null
  }
}

/** Where the java executable sits inside an installed runtime. */
export function javaExecutable(runtimeDir: string, platform: string): string {
  switch (platform) {
    case 'win32':
      // javaw has no console window.
      return join(runtimeDir, 'bin', 'javaw.exe')
    case 'darwin':
      return join(runtimeDir, 'jre.bundle', 'Contents', 'Home', 'bin', 'java')
    default:
      return join(runtimeDir, 'bin', 'java')
  }
}

/**
 * On Windows java.exe opens a console window beside the game, and closing that window kills the
 * game. A java.exe chosen in Settings is swapped for the javaw.exe next to it when there is one.
 */
export async function windowlessJava(javaPath: string, platform: string): Promise<string> {
  if (platform !== 'win32' || win32.basename(javaPath).toLowerCase() !== 'java.exe') {
    return javaPath
  }

  const javaw = `${javaPath.slice(0, -'java.exe'.length)}javaw.exe`
  return (await access(javaw).then(() => true, () => false)) ? javaw : javaPath
}

export interface JavaInstallOptions extends DownloadOptions {
  platform?: string
  arch?: string
}

/**
 * Installs (or checks) the Java runtime Mojang publishes for a component such as
 * "java-runtime-delta" (Java 21), under <runtimes>/<component>/<platform>/, and returns the
 * path of its java executable. When Mojang has updated the runtime, every file is hashed again
 * (an updated file can keep its size). When Mojang can't be reached, an installed runtime is
 * checked against the manifest saved with it.
 */
export async function installJavaRuntime(
  http: HttpClient,
  queue: DownloadQueue,
  runtimesDir: string,
  component: string,
  options: JavaInstallOptions = {}
): Promise<string> {
  const platform = options.platform ?? process.platform
  const key = runtimePlatformKey(platform, options.arch ?? process.arch)

  if (!key) {
    throw new NoManagedJavaError(null, component)
  }

  const root = inside(inside(runtimesDir, component), key)
  const installed = await readInstalled(root)
  let latest: { sha1: string; version: string; text: string }

  try {
    const index = await http.getJson<RuntimeIndex>(JAVA_RUNTIME_INDEX, { signal: options.signal })
    const entry = index[key]?.[component]?.[0]

    if (!entry) {
      throw new NoManagedJavaError(key, component)
    }

    const sha1 = entry.manifest.sha1.toLowerCase()
    const text = installed?.marker.manifestSha1 === sha1 ? installed.text : await getVerifiedText(http, entry.manifest.url, sha1, options.signal)
    latest = { sha1, version: entry.version.name, text }
  } catch (error) {
    if (options.signal?.aborted || !installed || !isUnreachable(error)) {
      throw error
    }

    latest = { sha1: installed.marker.manifestSha1, version: installed.marker.version, text: installed.text }
  }

  const manifest = JSON.parse(latest.text) as RuntimeManifest
  const updated = installed?.marker.manifestSha1 !== latest.sha1
  const downloads: DownloadItem[] = []
  const links: { path: string; target: string }[] = []

  for (const [relativePath, file] of Object.entries(manifest.files)) {
    const path = inside(root, relativePath)

    if (file.type === 'directory') {
      await mkdir(path, { recursive: true })
    } else if (file.type === 'file' && file.downloads?.raw) {
      const raw = file.downloads.raw
      downloads.push({ url: raw.url, path, sha1: raw.sha1, size: raw.size, executable: file.executable === true })
    } else if (file.type === 'link' && file.target) {
      // The link must stay inside the runtime too.
      if (isAbsolute(file.target)) {
        throw new Error(`Unsafe link in Java runtime manifest: ${relativePath}`)
      }

      inside(root, join(dirname(relativePath), file.target))
      links.push({ path, target: file.target })
    }
  }

  await queue.run(downloads, updated ? { ...options, verify: 'hash' } : options)

  if (platform !== 'win32') {
    for (const link of links) {
      await ensureSymlink(link.path, link.target)
    }
  }

  const java = javaExecutable(root, platform)
  await access(java, platform === 'win32' ? constants.F_OK : constants.X_OK)
  const marker: RuntimeMarker = { component, platform: key, version: latest.version, manifestSha1: latest.sha1 }
  await writeFile(join(root, SAVED_MANIFEST), latest.text)
  await writeFile(join(root, MARKER), JSON.stringify(marker, null, 2))
  return java
}

/** The installed runtime's marker and saved manifest, if both are there and agree. */
async function readInstalled(root: string): Promise<{ marker: RuntimeMarker; text: string } | null> {
  try {
    const marker = JSON.parse(await readFile(join(root, MARKER), 'utf8')) as Partial<RuntimeMarker>
    const text = await readFile(join(root, SAVED_MANIFEST), 'utf8')

    if (typeof marker.manifestSha1 !== 'string' || typeof marker.version !== 'string' || createHash('sha1').update(text).digest('hex') !== marker.manifestSha1) {
      return null
    }

    return { marker: marker as RuntimeMarker, text }
  } catch {
    return null
  }
}

async function ensureSymlink(path: string, target: string): Promise<void> {
  try {
    const info = await lstat(path)

    if (info.isSymbolicLink() && (await readlink(path)) === target) {
      return
    }

    await rm(path, { force: true, recursive: true })
  } catch {
    // Not there yet.
  }

  await mkdir(dirname(path), { recursive: true })
  await symlink(target, path)
}

async function getVerifiedText(http: HttpClient, url: string, sha1: string, signal?: AbortSignal): Promise<string> {
  const text = await http.getText(url, { signal })
  const actual = createHash('sha1').update(text).digest('hex')

  if (actual !== sha1) {
    throw new HashMismatchError(url, sha1, actual)
  }

  return text
}

export interface JavaInfo {
  /** Major version, e.g. 21 (8 for "1.8.0_402"). */
  major: number
  version: string
}

/** Parses the first line of `java -version`, e.g. 'openjdk version "21.0.7" 2025-04-15'. */
export function parseJavaVersion(output: string): JavaInfo | null {
  const match = /version "([^"]+)"/.exec(output)

  if (!match) {
    return null
  }

  const version = match[1]!
  const parts = version.split(/[._+-]/)
  const first = Number(parts[0])
  const major = first === 1 ? Number(parts[1]) : first
  return Number.isFinite(major) && major > 0 ? { major, version } : null
}

/** Runs a Java executable chosen by the user to find its version. Rejects anything that isn't Java. */
export function probeJava(javaPath: string, timeoutMs = 10_000): Promise<JavaInfo> {
  // On Windows javaw prints nothing; ask java.exe next to it.
  const executable = javaPath.toLowerCase().endsWith('javaw.exe') ? javaPath.slice(0, -'javaw.exe'.length) + 'java.exe' : javaPath

  return new Promise((resolve, reject) => {
    execFile(executable, ['-version'], { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      const info = parseJavaVersion(`${stderr}\n${stdout}`)

      if (info) {
        resolve(info)
      } else {
        reject(new Error(error ? `Couldn't run ${javaPath}: ${error.message}` : `${javaPath} doesn't look like Java`))
      }
    })
  })
}
