import type { SignInEvent, SignInMethod } from '@shared/ipc'

import type { AccountStore, StoredAccount } from '../accounts/store'
import type { HttpClient } from '../net/http'
import { AuthError, notConfiguredError } from './errors'
import { refreshMicrosoft, signInWithBrowser, signInWithDeviceCode, type MicrosoftTokens } from './microsoft'
import { minecraftLogin, minecraftProfile, xboxUserToken, xstsToken, xuidFromToken } from './xbox-minecraft'

/** Refresh when less than this is left: the game can't renew its own token mid-session. */
export const REFRESH_MARGIN_MS = 12 * 60 * 60 * 1000
/** A cached token this fresh is still used when refreshing fails for a transient reason. */
const OFFLINE_MARGIN_MS = 10 * 60 * 1000

export interface AuthServiceConfig {
  http: HttpClient
  store: AccountStore
  /** The Azure app id; null when this build has none. */
  clientId: string | null
  openBrowser: (url: string) => Promise<void>
  now?: () => number
  log?: (message: string) => void
}

/** Microsoft → Xbox Live → XSTS → Minecraft, for signing in and for keeping accounts fresh. */
export class AuthService {
  private readonly refreshes = new Map<string, Promise<StoredAccount>>()
  private readonly now: () => number

  constructor(private readonly config: AuthServiceConfig) {
    this.now = config.now ?? Date.now
  }

  get available(): boolean {
    return this.config.clientId !== null
  }

  /** Interactive sign-in. Adds (or updates) the account and selects it. */
  async signIn(method: SignInMethod, onEvent: (event: SignInEvent) => void, signal?: AbortSignal): Promise<StoredAccount> {
    const clientId = this.requireClientId()
    onEvent({ kind: 'progress', step: 'microsoft' })

    const tokens =
      method === 'browser'
        ? await signInWithBrowser(this.config.http, {
            clientId,
            signal,
            openBrowser: async (url) => {
              onEvent({ kind: 'waiting-for-browser' })
              await this.config.openBrowser(url)
            }
          })
        : await signInWithDeviceCode(this.config.http, {
            clientId,
            signal,
            onPrompt: (prompt) => onEvent({ kind: 'device-code', ...prompt })
          })

    const account = await this.completeChain(tokens, clientId, onEvent, signal)
    await this.config.store.upsert(account)
    this.config.log?.(`Signed in as ${account.name}`)
    return account
  }

  /**
   * The account, refreshed first if its Minecraft token has less than 12 hours left. One refresh
   * runs at a time per account. When refreshing fails only because of the network, a token that
   * is still valid is used anyway.
   */
  ensureFresh(id: string, signal?: AbortSignal): Promise<StoredAccount> {
    const account = this.config.store.get(id)

    if (!account) {
      return Promise.reject(new AuthError('unexpected', 'That account is no longer signed in.'))
    }

    if (account.needsSignIn) {
      return Promise.reject(new AuthError('invalid-grant', `Please sign in to ${account.name} again.`))
    }

    if (account.mcExpiresAt - this.now() > REFRESH_MARGIN_MS) {
      return Promise.resolve(account)
    }

    const running = this.refreshes.get(id)

    if (running) {
      return running
    }

    const refresh = this.refresh(account, signal).finally(() => this.refreshes.delete(id))
    this.refreshes.set(id, refresh)
    return refresh
  }

  private async refresh(account: StoredAccount, signal?: AbortSignal): Promise<StoredAccount> {
    try {
      const clientId = this.requireClientId()

      if (account.msClientId !== clientId) {
        throw new AuthError('client-changed', `Please sign in to ${account.name} again.`)
      }

      const tokens = await refreshMicrosoft(this.config.http, clientId, account.msRefreshToken, signal)
      // Microsoft rotated the refresh token: keep the new one even if a later step fails.
      await this.config.store.update(account.id, { msRefreshToken: tokens.refreshToken })
      const fresh = await this.completeChain(tokens, clientId, undefined, signal)

      if (fresh.id !== account.id) {
        throw new AuthError('unexpected', 'Microsoft signed in a different player than this account.')
      }

      await this.config.store.update(account.id, { ...fresh, needsSignIn: false })
      return fresh
    } catch (error) {
      if (error instanceof AuthError && error.needsSignIn) {
        await this.config.store.update(account.id, { needsSignIn: true })
        throw error
      }

      const transient = error instanceof AuthError && (error.code === 'network' || error.code === 'rate-limited')

      if (transient && account.mcExpiresAt - this.now() > OFFLINE_MARGIN_MS) {
        this.config.log?.(`Couldn't refresh ${account.name} (${error.message}); using the saved token`)
        return account
      }

      throw error
    }
  }

  private async completeChain(tokens: MicrosoftTokens, clientId: string, onEvent?: (event: SignInEvent) => void, signal?: AbortSignal): Promise<StoredAccount> {
    onEvent?.({ kind: 'progress', step: 'xbox' })
    const user = await xboxUserToken(this.config.http, tokens.accessToken, signal)
    const xsts = await xstsToken(this.config.http, user, signal)
    onEvent?.({ kind: 'progress', step: 'minecraft' })
    const minecraft = await minecraftLogin(this.config.http, xsts, signal, this.now)
    onEvent?.({ kind: 'progress', step: 'profile' })
    const profile = await minecraftProfile(this.config.http, minecraft.accessToken, signal)

    return {
      id: profile.id,
      name: profile.name,
      xuid: xuidFromToken(minecraft.accessToken),
      msRefreshToken: tokens.refreshToken,
      msClientId: clientId,
      mcAccessToken: minecraft.accessToken,
      mcExpiresAt: minecraft.expiresAt
    }
  }

  private requireClientId(): string {
    if (!this.config.clientId) {
      throw notConfiguredError()
    }

    return this.config.clientId
  }
}
