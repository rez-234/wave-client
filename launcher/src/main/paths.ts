import { isAbsolute, join, relative, resolve } from 'node:path'

/**
 * Where everything lives on disk (see docs/ARCHITECTURE.md, "Disk layout"):
 *
 *   <root>/launcher.json, accounts.dat
 *   <root>/shared/{versions,libraries,assets,runtimes}/   game files shared by every profile
 *   <root>/client/                                        our mod and the managed Fabric API
 *   <root>/instances/<profile>/                           one game directory per profile
 *
 * On Windows root is %APPDATA%\WaveClient.
 */
export interface LauncherPaths {
  root: string
  settingsFile: string
  accountsFile: string
  versions: string
  libraries: string
  assets: string
  runtimes: string
  client: string
  instances: string
  /** Chromium's own data (cache, local storage), kept apart from game data. */
  electronData: string
}

export function launcherPaths(root: string): LauncherPaths {
  const shared = join(root, 'shared')
  return {
    root,
    settingsFile: join(root, 'launcher.json'),
    accountsFile: join(root, 'accounts.dat'),
    versions: join(shared, 'versions'),
    libraries: join(shared, 'libraries'),
    assets: join(shared, 'assets'),
    runtimes: join(shared, 'runtimes'),
    client: join(root, 'client'),
    instances: join(root, 'instances'),
    electronData: join(root, 'electron')
  }
}

/** versions/<id>/<id>.json and versions/<id>/<id>.jar */
export function versionFiles(paths: LauncherPaths, id: string): { json: string; jar: string; dir: string } {
  const dir = inside(paths.versions, id)
  return { dir, json: join(dir, `${id}.json`), jar: join(dir, `${id}.jar`) }
}

/** The game directory of a profile. Profile ids are restricted to safe folder names. */
export function instanceDir(paths: LauncherPaths, profileId: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profileId)) {
    throw new Error(`Invalid profile id: ${profileId}`)
  }

  return join(paths.instances, profileId)
}

/**
 * Joins a relative path from downloaded metadata onto a base folder, refusing anything that would
 * land outside it ("../", absolute paths, drive letters).
 */
export function inside(base: string, relativePath: string): string {
  if (relativePath.length === 0 || isAbsolute(relativePath) || /^[a-zA-Z]:/.test(relativePath) || relativePath.includes('\0')) {
    throw new Error(`Unsafe path in metadata: ${relativePath}`)
  }

  const target = resolve(base, relativePath)
  const rel = relative(resolve(base), target)

  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Unsafe path in metadata: ${relativePath}`)
  }

  return target
}
