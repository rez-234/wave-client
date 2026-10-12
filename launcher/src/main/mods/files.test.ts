import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const failUnlink = vi.hoisted(() => ({ code: null as string | null }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    unlink: async (path: Parameters<typeof actual.unlink>[0]) => {
      if (failUnlink.code !== null && String(path).endsWith('locked.jar')) {
        throw Object.assign(new Error(`${failUnlink.code}: locked`), { code: failUnlink.code })
      }

      return actual.unlink(path)
    },
  }
})

import { FileExistsError, checkModKey, findModFile, freeModName, modForms, renameNoClobber } from './files'

describe('mod file helpers', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wave-modfiles-'))
  })

  afterEach(async () => {
    failUnlink.code = null
    await rm(dir, { recursive: true, force: true })
  })

  it('accepts only plain jar names as keys', () => {
    expect(checkModKey('sodium-0.6.13.jar')).toBe('sodium-0.6.13.jar')
    expect(checkModKey('Odd.JAR')).toBe('Odd.JAR')

    for (const bad of ['../x.jar', 'a/b.jar', 'a\\b.jar', 'a.jar:evil.jar', '.hidden.jar', 'x.txt', '', 'x.jar.disabled', 'con\0.jar', 5]) {
      expect(() => checkModKey(bad), String(bad)).toThrow()
    }
  })

  it('knows both names of a mod and finds the one present', async () => {
    expect(modForms('a.jar')).toEqual({ on: 'a.jar', off: 'a.jar.disabled' })
    expect(modForms('A.JAR')).toEqual({ on: 'A.JAR', off: 'A.jar.disabled' })
    await writeFile(join(dir, 'a.jar.disabled'), 'x')
    expect(await findModFile(dir, 'a.jar')).toEqual({ file: 'a.jar.disabled', enabled: false })
    await writeFile(join(dir, 'b.jar'), 'x')
    expect(await findModFile(dir, 'b.jar')).toEqual({ file: 'b.jar', enabled: true })
    expect(await findModFile(dir, 'c.jar')).toBeNull()
  })

  it('never renames over another file', async () => {
    await writeFile(join(dir, 'sodium.jar'), 'new')
    await writeFile(join(dir, 'sodium.jar.disabled'), 'old')
    await expect(renameNoClobber(dir, 'sodium.jar.disabled', 'sodium.jar')).rejects.toBeInstanceOf(FileExistsError)
    expect(await readFile(join(dir, 'sodium.jar'), 'utf8')).toBe('new')
    expect((await readdir(dir)).sort()).toEqual(['sodium.jar', 'sodium.jar.disabled'])

    await renameNoClobber(dir, 'sodium.jar', 'sodium-new.jar')
    expect((await readdir(dir)).sort()).toEqual(['sodium-new.jar', 'sodium.jar.disabled'])
  })

  it('leaves only the old name when the new name is linked but the old one cannot be removed', async () => {
    for (const code of ['EBUSY', 'EPERM']) {
      await writeFile(join(dir, 'locked.jar'), 'x')
      failUnlink.code = code
      const error = await renameNoClobber(dir, 'locked.jar', 'locked.jar.disabled').catch((caught: unknown) => caught)
      failUnlink.code = null
      expect(error, code).not.toBeInstanceOf(FileExistsError)
      expect((error as NodeJS.ErrnoException).code, code).toBe(code)
      expect(await readdir(dir), code).toEqual(['locked.jar'])
      await rm(join(dir, 'locked.jar'))
    }
  })

  it('picks a free name for an added jar, in either form', async () => {
    await writeFile(join(dir, 'sodium.jar.disabled'), 'x')
    expect(await freeModName(dir, 'sodium.jar')).toBe('sodium (2).jar')
    expect(await freeModName(dir, 'sodium.jar', ['sodium.jar.disabled'])).toBe('sodium.jar')
    expect(await freeModName(dir, '..Mod.JAR')).toBe('Mod.jar')
    expect(await freeModName(dir, `${'x'.repeat(300)}.jar`)).toHaveLength(114)
  })
})
