import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { AccountView } from '@shared/ipc'

/**
 * Encrypts and decrypts with the OS keychain (Electron safeStorage: DPAPI on Windows, Keychain on
 * macOS, libsecret/KWallet on Linux). `available` is false when only an insecure fallback exists.
 */
export interface SecretBox {
  available(): boolean
  encrypt(plainText: string): Buffer
  decrypt(encrypted: Buffer): string
}

/** Everything needed to launch as, and refresh, one Microsoft account. Main process only. */
export interface StoredAccount {
  /** Minecraft profile UUID without dashes. */
  id: string
  name: string
  xuid: string
  /** Microsoft refresh token: re-runs the whole chain without the user. */
  msRefreshToken: string
  /** The Azure app id that issued the refresh token; it only works with that app. */
  msClientId: string
  mcAccessToken: string
  /** Epoch milliseconds. */
  mcExpiresAt: number
  /** Set when refreshing failed in a way only signing in again fixes. */
  needsSignIn?: boolean
}

interface AccountFile {
  version: 1
  selected: string | null
  accounts: StoredAccount[]
}

const EMPTY: AccountFile = { version: 1, selected: null, accounts: [] }

/**
 * The signed-in accounts. Saved encrypted to accounts.dat only when the OS keychain is available;
 * otherwise kept for this session only, so a token never reaches the disk in plain text.
 */
export class AccountStore {
  private data: AccountFile = structuredClone(EMPTY)
  private loaded = false

  constructor(
    private readonly file: string,
    private readonly secrets: SecretBox,
    private readonly log: (message: string) => void = () => {}
  ) {}

  /** Whether accounts survive a restart. */
  get persistent(): boolean {
    return this.secrets.available()
  }

  async load(): Promise<void> {
    this.loaded = true

    if (!this.secrets.available()) {
      return
    }

    let encrypted: Buffer

    try {
      encrypted = await readFile(this.file)
    } catch {
      return
    }

    try {
      const parsed = JSON.parse(this.secrets.decrypt(encrypted)) as AccountFile

      if (parsed.version === 1 && Array.isArray(parsed.accounts)) {
        this.data = { version: 1, selected: parsed.selected ?? null, accounts: parsed.accounts.filter(isAccount) }
      }
    } catch (error) {
      // Encrypted under a different OS user or keychain: unreadable, so start over.
      this.log(`Saved accounts could not be decrypted and were ignored: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  list(): AccountView[] {
    this.assertLoaded()
    return this.data.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      selected: account.id === this.data.selected,
      status: account.needsSignIn ? 'expired' : 'ok'
    }))
  }

  get(id: string): StoredAccount | undefined {
    this.assertLoaded()
    const account = this.data.accounts.find((a) => a.id === id)
    return account ? { ...account } : undefined
  }

  selected(): StoredAccount | undefined {
    return this.data.selected ? this.get(this.data.selected) : undefined
  }

  /** Adds or replaces an account (matched by profile id) and selects it. */
  async upsert(account: StoredAccount): Promise<void> {
    this.assertLoaded()
    const index = this.data.accounts.findIndex((a) => a.id === account.id)
    const clean = { ...account }
    delete clean.needsSignIn

    if (index >= 0) {
      this.data.accounts[index] = clean
    } else {
      this.data.accounts.push(clean)
    }

    this.data.selected = account.id
    await this.save()
  }

  /** Updates tokens after a refresh, keeping the selection. */
  async update(id: string, changes: Partial<StoredAccount>): Promise<void> {
    this.assertLoaded()
    const account = this.data.accounts.find((a) => a.id === id)

    if (!account) {
      return
    }

    Object.assign(account, changes)

    if (changes.needsSignIn === false) {
      delete account.needsSignIn
    }

    await this.save()
  }

  async select(id: string): Promise<void> {
    this.assertLoaded()

    if (!this.data.accounts.some((a) => a.id === id)) {
      throw new Error('Unknown account')
    }

    this.data.selected = id
    await this.save()
  }

  async remove(id: string): Promise<void> {
    this.assertLoaded()
    this.data.accounts = this.data.accounts.filter((a) => a.id !== id)

    if (this.data.selected === id) {
      this.data.selected = this.data.accounts[0]?.id ?? null
    }

    await this.save()
  }

  private async save(): Promise<void> {
    if (!this.secrets.available()) {
      return
    }

    if (this.data.accounts.length === 0) {
      await rm(this.file, { force: true })
      return
    }

    const encrypted = this.secrets.encrypt(JSON.stringify(this.data))
    const temp = `${this.file}.tmp`
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(temp, encrypted, { mode: 0o600 })

    if (process.platform !== 'win32') {
      await chmod(temp, 0o600)
    }

    await rename(temp, this.file)
  }

  private assertLoaded(): void {
    if (!this.loaded) {
      throw new Error('AccountStore.load() must be called first')
    }
  }
}

function isAccount(value: unknown): value is StoredAccount {
  const a = value as StoredAccount
  return (
    typeof a === 'object' &&
    a !== null &&
    typeof a.id === 'string' &&
    /^[0-9a-f]{32}$/.test(a.id) &&
    typeof a.name === 'string' &&
    typeof a.msRefreshToken === 'string' &&
    typeof a.msClientId === 'string' &&
    typeof a.mcAccessToken === 'string' &&
    typeof a.mcExpiresAt === 'number'
  )
}
