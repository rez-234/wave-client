import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AccountStore, type SecretBox, type StoredAccount } from './store'

/** A stand-in for safeStorage: XOR "encryption", enough to prove nothing is written in clear. */
function box(available = true): SecretBox {
  const xor = (buffer: Buffer) => Buffer.from(buffer.map((b) => b ^ 0x5a))
  return { available: () => available, encrypt: (text) => xor(Buffer.from(text)), decrypt: (data) => xor(data).toString() }
}

const account = (id: string, name: string, extra: Partial<StoredAccount> = {}): StoredAccount => ({
  id: id.repeat(32).slice(0, 32),
  name,
  xuid: '123',
  msRefreshToken: `refresh-${name}`,
  mcAccessToken: `access-${name}`,
  mcExpiresAt: 1_000,
  ...extra
})

describe('AccountStore', () => {
  let dir: string
  let file: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wave-accounts-'))
    file = join(dir, 'accounts.dat')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('saves encrypted, never in plain text, and reloads', async () => {
    const store = new AccountStore(file, box())
    await store.load()
    await store.upsert(account('a', 'Alex'))
    await store.upsert(account('b', 'Steve'))

    const raw = await readFile(file)
    expect(raw.toString('latin1')).not.toContain('refresh-Alex')
    expect(raw.toString('latin1')).not.toContain('access-Steve')

    if (process.platform !== 'win32') {
      expect((await stat(file)).mode & 0o077).toBe(0)
    }

    const reloaded = new AccountStore(file, box())
    await reloaded.load()
    expect(reloaded.list()).toEqual([
      { id: 'a'.repeat(32), name: 'Alex', selected: false, status: 'ok' },
      { id: 'b'.repeat(32), name: 'Steve', selected: true, status: 'ok' }
    ])
    expect(reloaded.selected()?.msRefreshToken).toBe('refresh-Steve')
  })

  it('keeps accounts in memory only without a keychain', async () => {
    const store = new AccountStore(file, box(false))
    await store.load()
    await store.upsert(account('a', 'Alex'))
    expect(store.persistent).toBe(false)
    expect(store.list()).toHaveLength(1)
    await expect(stat(file)).rejects.toThrow()
  })

  it('marks, clears and removes', async () => {
    const store = new AccountStore(file, box())
    await store.load()
    await store.upsert(account('a', 'Alex'))
    await store.upsert(account('b', 'Steve'))
    await store.update('a'.repeat(32), { needsSignIn: true })
    expect(store.list()[0]!.status).toBe('expired')

    await store.select('a'.repeat(32))
    await store.remove('a'.repeat(32))
    expect(store.list().map((a) => [a.name, a.selected])).toEqual([['Steve', true]])

    await store.remove('b'.repeat(32))
    await expect(stat(file)).rejects.toThrow()
    await expect(store.select('nope')).rejects.toThrow()
  })

  it('ignores a file it cannot decrypt or that is malformed', async () => {
    await writeFile(file, 'garbage')
    const store = new AccountStore(file, { ...box(), decrypt: () => { throw new Error('wrong key') } })
    await store.load()
    expect(store.list()).toEqual([])

    await writeFile(file, box().encrypt(JSON.stringify({ version: 1, selected: null, accounts: [{ id: '../x', name: 1 }] })))
    const malformed = new AccountStore(file, box())
    await malformed.load()
    expect(malformed.list()).toEqual([])
  })
})
