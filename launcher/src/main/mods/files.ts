import { link, readdir, rename, stat, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'

/** File systems that treat "Sodium.jar" and "sodium.jar" as the same file. */
export const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin'

/**
 * A mod key from the page (a file name without ".disabled"), checked before it is used: one name
 * in the mods folder, ending in .jar, no path parts, no NTFS stream or device tricks.
 */
export function checkModKey(key: unknown): string {
  if (
    typeof key !== 'string' ||
    key.length === 0 ||
    key.length > 255 ||
    key.startsWith('.') ||
    /[\\/:\0]/.test(key) ||
    key !== basename(key) ||
    !/\.jar$/i.test(key)
  ) {
    throw new Error('Unknown mod')
  }

  return key
}

/** The two names a mod can have in the folder: on (.jar, any case for odd files) and off (.jar.disabled). */
export function modForms(key: string): { on: string; off: string } {
  const normal = key.replace(/\.jar$/i, '.jar')
  return { on: key, off: `${normal}.disabled` }
}

/** Which form of the mod is in the folder now, by exact name (as listed by readdir). */
export async function findModFile(dir: string, key: string): Promise<{ file: string; enabled: boolean } | null> {
  const names = new Set(await readdir(dir).catch(() => [] as string[]))
  const { on, off } = modForms(key)

  if (names.has(on)) {
    return { file: on, enabled: on.endsWith('.jar') }
  }

  if (names.has(off)) {
    return { file: off, enabled: false }
  }

  return null
}

export class FileExistsError extends Error {
  constructor(readonly fileName: string) {
    super(`A file named ${fileName} is already in the mods folder. Remove one of them first.`)
    this.name = 'FileExistsError'
  }
}

/** Whether a name is taken in the folder, ignoring case where the file system does. */
export async function nameTaken(dir: string, name: string, except: readonly string[] = []): Promise<boolean> {
  const names = await readdir(dir).catch(() => [] as string[])
  const fold = (value: string): string => (CASE_INSENSITIVE ? value.toLowerCase() : value)
  const skip = new Set(except.map(fold))
  return names.some((entry) => !skip.has(fold(entry)) && fold(entry) === fold(name))
}

/**
 * Renames without ever replacing an existing file (fs.rename would, on every OS). A hard link
 * fails atomically when the target exists; where links aren't supported (FAT, some network
 * drives) it checks first and renames.
 */
export async function renameNoClobber(dir: string, from: string, to: string): Promise<void> {
  const source = join(dir, from)
  const target = join(dir, to)
  const sameFile = CASE_INSENSITIVE && from.toLowerCase() === to.toLowerCase()

  if (!sameFile) {
    if (await nameTaken(dir, to, [from])) {
      throw new FileExistsError(to)
    }

    let linked = false

    try {
      await link(source, target)
      linked = true
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code

      if (code === 'EEXIST') {
        throw new FileExistsError(to)
      }

      if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EXDEV' && code !== 'ENOSYS' && code !== 'EINVAL' && code !== 'EMLINK') {
        throw error
      }

      if (await stat(target).then(() => true, () => false)) {
        throw new FileExistsError(to)
      }
    }

    if (linked) {
      try {
        await unlink(source)
      } catch (error) {
        // The old name is held open (Windows): drop the new name again so the mod keeps one name.
        await unlink(target).catch(() => {})
        throw error
      }

      return
    }
  }

  await rename(source, target)
}

/**
 * The name an added jar gets: its own name with the extension as ".jar", no leading dots, at most
 * 120 characters, and not one that is taken (either form): "x.jar", then "x (2).jar"...
 */
export async function freeModName(dir: string, original: string, except: readonly string[] = []): Promise<string> {
  let base = original
    .replace(/[\\/:\0]/g, '_')
    .replace(/^\.+/, '')
    .replace(/\.jar$/i, '')
    .trim()
    .slice(0, 110)

  if (base.length === 0) {
    base = 'mod'
  }

  for (let n = 1; ; n++) {
    const name = n === 1 ? `${base}.jar` : `${base} (${n}).jar`

    if (!(await nameTaken(dir, name, except)) && !(await nameTaken(dir, `${name}.disabled`, except))) {
      return name
    }
  }
}

/** A message for a file the OS won't let us rename or move (Windows keeps a running game's jars open). */
export function fileInUseMessage(error: unknown): string | null {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES' ? 'This mod is in use, probably by a running Minecraft. Close the game and try again.' : null
}
