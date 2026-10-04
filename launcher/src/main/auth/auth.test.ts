import { createHash } from 'node:crypto'
import { request } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { SignInEvent } from '@shared/ipc'

import { AccountStore, type SecretBox, type StoredAccount } from '../accounts/store'
import { HttpClient, type FetchFn } from '../net/http'
import { AuthError } from './errors'
import { MS_DEVICE_CODE, MS_TOKEN, signInWithDeviceCode, startLoopback } from './microsoft'
import { AuthService, REFRESH_MARGIN_MS } from './service'
import { MC_ENTITLEMENTS, MC_LOGIN, MC_PROFILE, XBL_AUTHENTICATE, XSTS_AUTHORIZE, xuidFromToken } from './xbox-minecraft'

const CLIENT = '11111111-2222-3333-4444-555555555555'
const PROFILE_ID = '0123456789abcdef0123456789abcdef'
const jwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`
const MC_TOKEN = jwt({ xuid: '2535405290', sub: 'x' })

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

/** A fake Microsoft + Xbox + Minecraft. Each test overrides the endpoints it cares about. */
function services(overrides: Record<string, Handler> = {}) {
  const calls: { url: string; body: string }[] = []
  let refreshCount = 0
  const handlers: Record<string, Handler> = {
    [MS_TOKEN]: (_url, init) => {
      const form = new URLSearchParams(String(init.body))

      if (form.get('client_id') !== CLIENT) {
        return json({ error: 'invalid_client' }, 400)
      }

      if (form.get('grant_type') === 'refresh_token') {
        refreshCount++
        return json({ access_token: 'ms-access-r', refresh_token: `ms-refresh-${refreshCount + 1}`, expires_in: 3600 })
      }

      return json({ access_token: 'ms-access', refresh_token: 'ms-refresh-1', expires_in: 3600 })
    },
    [XBL_AUTHENTICATE]: (_url, init) => {
      const body = JSON.parse(String(init.body))
      expect(body.Properties.RpsTicket).toMatch(/^d=ms-access/)
      return json({ Token: 'xbl-user', DisplayClaims: { xui: [{ uhs: 'uhs1' }] } })
    },
    [XSTS_AUTHORIZE]: (_url, init) => {
      expect(JSON.parse(String(init.body)).RelyingParty).toBe('rp://api.minecraftservices.com/')
      return json({ Token: 'xsts', DisplayClaims: { xui: [{ uhs: 'uhs1' }] } })
    },
    [MC_LOGIN]: (_url, init) => {
      expect(JSON.parse(String(init.body))).toEqual({ identityToken: 'XBL3.0 x=uhs1;xsts' })
      return json({ access_token: MC_TOKEN, expires_in: 86400 })
    },
    [MC_PROFILE]: () => json({ id: PROFILE_ID, name: 'Steve', skins: [] }),
    [MC_ENTITLEMENTS]: () => json({ items: [{ name: 'game_minecraft' }] }),
    ...overrides
  }
  const fetch: FetchFn = async (url, init = {}) => {
    calls.push({ url, body: String(init.body ?? '') })
    const handler = handlers[url.split('?')[0]!]
    return handler ? handler(url, init) : new Response('', { status: 404 })
  }

  return { http: new HttpClient({ fetch, userAgent: 't', backoffMs: () => 0, sleep: async () => {} }), calls }
}

const box: SecretBox = { available: () => true, encrypt: (t) => Buffer.from(t), decrypt: (b) => b.toString() }

/** Acts as the browser: follows the authorize URL's redirect to the loopback with a code. */
function browserReturning(params: (authorize: URL) => Record<string, string>, host?: (port: string) => string) {
  return async (url: string) => {
    const authorize = new URL(url)
    const redirect = new URL(authorize.searchParams.get('redirect_uri')!)
    const target = new URL(redirect.toString())
    for (const [key, value] of Object.entries(params(authorize))) target.searchParams.set(key, value)
    // Answer asynchronously, like a real browser.
    setTimeout(() => {
      const req = request({ host: '127.0.0.1', port: Number(redirect.port), path: `${target.pathname}${target.search}`, headers: { Host: host ? host(redirect.port) : `localhost:${redirect.port}` } })
      req.on('error', () => {})
      req.end()
    }, 5)
  }
}

describe('sign-in', () => {
  let dir: string
  let store: AccountStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wave-auth-'))
    store = new AccountStore(join(dir, 'accounts.dat'), box)
    await store.load()
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('signs in through the browser with PKCE and saves the account', async () => {
    let challenge = ''
    const { http, calls } = services({
      [MS_TOKEN]: (_url, init) => {
        const form = new URLSearchParams(String(init.body))
        expect(form.get('code')).toBe('the-code')
        expect(form.get('redirect_uri')).toMatch(/^http:\/\/localhost:\d+$/)
        expect(createHash('sha256').update(form.get('code_verifier')!).digest('base64url')).toBe(challenge)
        return json({ access_token: 'ms-access', refresh_token: 'ms-refresh-1', expires_in: 3600 })
      }
    })
    const events: SignInEvent[] = []
    const service = new AuthService({
      http,
      store,
      clientId: CLIENT,
      openBrowser: browserReturning((authorize) => {
        expect(authorize.searchParams.get('scope')).toBe('XboxLive.signin offline_access')
        expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
        expect(authorize.searchParams.get('prompt')).toBe('select_account')
        challenge = authorize.searchParams.get('code_challenge')!
        return { code: 'the-code', state: authorize.searchParams.get('state')! }
      })
    })

    const account = await service.signIn('browser', (e) => events.push(e))

    expect(account).toMatchObject({ id: PROFILE_ID, name: 'Steve', xuid: '2535405290', msRefreshToken: 'ms-refresh-1', msClientId: CLIENT, mcAccessToken: MC_TOKEN })
    expect(store.list()).toEqual([{ id: PROFILE_ID, name: 'Steve', selected: true, status: 'ok' }])
    expect(events.map((e) => (e.kind === 'progress' ? e.step : e.kind))).toEqual(['microsoft', 'waiting-for-browser', 'xbox', 'minecraft', 'profile'])
    expect(calls.map((c) => c.url)).toEqual([MS_TOKEN, XBL_AUTHENTICATE, XSTS_AUTHORIZE, MC_LOGIN, MC_PROFILE])
  })

  it('refuses a callback with the wrong state or host, and reports a cancelled sign-in', async () => {
    const loopback = await startLoopback('right-state', undefined, 5000)
    const port = new URL(loopback.redirectUri).port
    const status = (path: string, host = `localhost:${port}`) =>
      new Promise<number>((resolve) => {
        const req = request({ host: '127.0.0.1', port: Number(port), path, headers: { Host: host } }, (res) => resolve(res.statusCode ?? 0))
        req.end()
      })

    expect(await status('/?code=x&state=wrong')).toBe(400)
    expect(await status('/?code=x&state=right-state', 'evil.example:80')).toBe(400)
    expect(await status('/favicon.ico')).toBe(404)
    expect(await status('/?error=access_denied&state=right-state')).toBe(200)
    await expect(loopback.code).rejects.toMatchObject({ code: 'cancelled' })
    loopback.close()
  })

  it('stops waiting when cancelled', async () => {
    const controller = new AbortController()
    const { http } = services()
    const service = new AuthService({ http, store, clientId: CLIENT, openBrowser: async () => controller.abort() })
    await expect(service.signIn('browser', () => {}, controller.signal)).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('polls the device code through pending and slow_down', async () => {
    const answers = ['authorization_pending', 'slow_down', null]
    const sleeps: number[] = []
    const { http } = services({
      [MS_DEVICE_CODE]: () => json({ device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://www.microsoft.com/link', expires_in: 900, interval: 5 }),
      [MS_TOKEN]: () => {
        const answer = answers.shift()
        return answer ? json({ error: answer }, 400) : json({ access_token: 'ms-access', refresh_token: 'r', expires_in: 3600 })
      }
    })
    const prompts: string[] = []
    const tokens = await signInWithDeviceCode(http, { clientId: CLIENT, onPrompt: (p) => prompts.push(p.userCode), sleep: async (ms) => void sleeps.push(ms) })

    expect(tokens.refreshToken).toBe('r')
    expect(prompts).toEqual(['ABCD-1234'])
    expect(sleeps).toEqual([5000, 5000, 10000])
  })

  it('reports an expired or declined device code', async () => {
    for (const [error, code] of [['expired_token', 'expired-code'], ['authorization_declined', 'declined']] as const) {
      const { http } = services({
        [MS_DEVICE_CODE]: () => json({ device_code: 'dc', user_code: 'U', verification_uri: 'https://www.microsoft.com/link', expires_in: 900, interval: 1 }),
        [MS_TOKEN]: () => json({ error }, 400)
      })
      await expect(signInWithDeviceCode(http, { clientId: CLIENT, onPrompt: () => {}, sleep: async () => {} })).rejects.toMatchObject({ code })
    }
  })

  it('explains Xbox errors from the body or the X-Err header', async () => {
    const signIn = async (handler: Handler) => {
      const { http } = services({ [XSTS_AUTHORIZE]: handler })
      return new AuthService({ http, store, clientId: CLIENT, openBrowser: browserReturning((a) => ({ code: 'c', state: a.searchParams.get('state')! })) })
        .signIn('browser', () => {})
        .then(
          () => {
            throw new Error('expected sign-in to fail')
          },
          (e: unknown) => e as AuthError
        )
    }

    const noProfile = await signIn(() => json({ Identity: '0', XErr: 2148916233, Message: '' }, 401))
    expect(noProfile).toMatchObject({ code: 'xbox' })
    expect(noProfile.message).toMatch(/doesn't have an Xbox profile/)

    const child = await signIn(() => new Response('', { status: 401, headers: { 'X-Err': '2148916238' } }))
    expect(child.message).toMatch(/Microsoft Family/)

    const unknown = await signIn(() => json({ XErr: 1234 }, 401))
    expect(unknown.message).toMatch(/XErr 1234/)
  })

  it('recognises a launcher app Mojang has not approved', async () => {
    for (const status of [401, 403]) {
      const { http } = services({ [MC_LOGIN]: () => json({ error: 'FORBIDDEN', errorMessage: 'Invalid app registration, see https://aka.ms/AppRegInfo' }, status) })
      const service = new AuthService({ http, store, clientId: CLIENT, openBrowser: browserReturning((a) => ({ code: 'c', state: a.searchParams.get('state')! })) })
      await expect(service.signIn('browser', () => {})).rejects.toMatchObject({ code: 'app-not-approved', helpUrl: 'https://aka.ms/mce-reviewappid' })
    }
  })

  it('tells a player without a profile apart from one who does not own the game', async () => {
    for (const [items, code] of [[[{ name: 'game_minecraft' }], 'no-profile'], [[], 'not-owned']] as const) {
      const { http } = services({ [MC_PROFILE]: () => json({ error: 'NOT_FOUND' }, 404), [MC_ENTITLEMENTS]: () => json({ items }) })
      const service = new AuthService({ http, store, clientId: CLIENT, openBrowser: browserReturning((a) => ({ code: 'c', state: a.searchParams.get('state')! })) })
      await expect(service.signIn('browser', () => {})).rejects.toMatchObject({ code })
    }
  })

  it('needs a client id', async () => {
    const service = new AuthService({ http: services().http, store, clientId: null, openBrowser: async () => {} })
    expect(service.available).toBe(false)
    await expect(service.signIn('browser', () => {})).rejects.toMatchObject({ code: 'not-configured' })
  })
})

describe('ensureFresh', () => {
  let dir: string
  let store: AccountStore
  const NOW = 1_000_000_000_000

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wave-auth-'))
    store = new AccountStore(join(dir, 'accounts.dat'), box)
    await store.load()
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const saved = (expiresIn: number, extra: Partial<StoredAccount> = {}): StoredAccount => ({
    id: PROFILE_ID,
    name: 'Steve',
    xuid: '1',
    msRefreshToken: 'ms-refresh-1',
    msClientId: CLIENT,
    mcAccessToken: 'old-token',
    mcExpiresAt: NOW + expiresIn,
    ...extra
  })

  it('uses a token with plenty of time left as it is', async () => {
    const { http, calls } = services()
    await store.upsert(saved(REFRESH_MARGIN_MS + 60_000))
    const account = await new AuthService({ http, store, clientId: CLIENT, openBrowser: async () => {}, now: () => NOW }).ensureFresh(PROFILE_ID)
    expect(account.mcAccessToken).toBe('old-token')
    expect(calls).toHaveLength(0)
  })

  it('refreshes a token close to expiry once, keeping the rotated refresh token', async () => {
    const { http, calls } = services()
    await store.upsert(saved(60_000))
    const service = new AuthService({ http, store, clientId: CLIENT, openBrowser: async () => {}, now: () => NOW })
    const [a, b] = await Promise.all([service.ensureFresh(PROFILE_ID), service.ensureFresh(PROFILE_ID)])

    expect(a).toEqual(b)
    expect(a.mcAccessToken).toBe(MC_TOKEN)
    expect(store.get(PROFILE_ID)).toMatchObject({ msRefreshToken: 'ms-refresh-2', mcAccessToken: MC_TOKEN, mcExpiresAt: NOW + 86_400_000 })
    expect(calls.filter((c) => c.url === MS_TOKEN)).toHaveLength(1)
  })

  it('asks for a new sign-in when Microsoft rejects the refresh token or the app changed', async () => {
    const { http } = services({ [MS_TOKEN]: () => json({ error: 'invalid_grant', error_description: 'AADSTS70000' }, 400) })
    await store.upsert(saved(60_000))
    const service = new AuthService({ http, store, clientId: CLIENT, openBrowser: async () => {}, now: () => NOW })
    await expect(service.ensureFresh(PROFILE_ID)).rejects.toMatchObject({ code: 'invalid-grant' })
    expect(store.list()[0]!.status).toBe('expired')
    await expect(service.ensureFresh(PROFILE_ID)).rejects.toMatchObject({ code: 'invalid-grant' })

    await store.upsert(saved(60_000, { msClientId: 'another-app' }))
    await expect(service.ensureFresh(PROFILE_ID)).rejects.toMatchObject({ code: 'client-changed' })
  })

  it('keeps playing on a still-valid token when the network is down', async () => {
    const down: Handler = () => {
      throw new TypeError('fetch failed')
    }
    const { http } = services({ [MS_TOKEN]: down })
    await store.upsert(saved(60 * 60_000))
    const service = new AuthService({ http, store, clientId: CLIENT, openBrowser: async () => {}, now: () => NOW })
    expect((await service.ensureFresh(PROFILE_ID)).mcAccessToken).toBe('old-token')

    await store.upsert(saved(60_000))
    await expect(service.ensureFresh(PROFILE_ID)).rejects.toMatchObject({ code: 'network' })
  })
})

describe('xuidFromToken', () => {
  it('reads the xuid claim and ignores anything else', () => {
    expect(xuidFromToken(MC_TOKEN)).toBe('2535405290')
    expect(xuidFromToken('not-a-jwt')).toBe('')
    expect(xuidFromToken(jwt({ xuid: '../../x' }))).toBe('')
  })
})
