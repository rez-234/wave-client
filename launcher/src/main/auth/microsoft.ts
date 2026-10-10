import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import { HttpError, NetworkError, abortableSleep, type HttpClient } from '../net/http'
import { AuthError } from './errors'

/** Microsoft identity platform v2, personal accounts (Xbox sign-in is personal-account only). */
export const MS_AUTHORIZE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize'
export const MS_TOKEN = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'
export const MS_DEVICE_CODE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode'
export const MS_SCOPE = 'XboxLive.signin offline_access'

export interface MicrosoftTokens {
  accessToken: string
  refreshToken: string
  /** Epoch milliseconds. */
  expiresAt: number
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
}

/** PKCE (RFC 7636, S256). */
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

export function authorizeUrl(clientId: string, redirectUri: string, challenge: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: MS_SCOPE,
    response_mode: 'query',
    prompt: 'select_account',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state
  })
  return `${MS_AUTHORIZE}?${params.toString()}`
}

export interface BrowserSignInOptions {
  clientId: string
  openBrowser: (url: string) => Promise<void>
  signal?: AbortSignal
  /** How long to wait for the user in the browser. */
  timeoutMs?: number
}

/**
 * Signs in with the system browser (RFC 8252): a one-shot HTTP server on 127.0.0.1 receives the
 * redirect at http://localhost:<port>, and the code is redeemed with PKCE. The Azure app must
 * list "http://localhost" as a Mobile and desktop redirect URI (any port matches).
 */
export async function signInWithBrowser(http: HttpClient, options: BrowserSignInOptions): Promise<MicrosoftTokens> {
  const { verifier, challenge } = createPkce()
  const state = randomBytes(16).toString('base64url')
  const receiver = await startLoopback(state, options.signal, options.timeoutMs ?? 5 * 60_000)

  try {
    await options.openBrowser(authorizeUrl(options.clientId, receiver.redirectUri, challenge, state))
    const code = await receiver.code
    return await redeem(
      http,
      options.clientId,
      { grant_type: 'authorization_code', code, redirect_uri: receiver.redirectUri, code_verifier: verifier },
      options.signal
    )
  } finally {
    receiver.close()
  }
}

interface Loopback {
  redirectUri: string
  code: Promise<string>
  close: () => void
}

const DONE_PAGE = (title: string, text: string): string =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font:16px system-ui,sans-serif;background:#0F1012;color:#E6E6E8;display:grid;place-items:center;height:100vh;margin:0">` +
  `<div style="text-align:center"><h1 style="color:#5B8CFF;font-weight:600">${title}</h1><p>${text}</p></div>`

export function startLoopback(state: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<Loopback> {
  return new Promise((resolveServer, rejectServer) => {
    let settle: { resolve: (code: string) => void; reject: (error: Error) => void }
    const code = new Promise<string>((resolve, reject) => {
      settle = { resolve, reject }
    })
    // Don't leave an unhandled rejection if the caller stops waiting.
    code.catch(() => {})
    let port = 0

    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const host = request.headers.host ?? ''

      // Only answer the browser's redirect to this exact loopback address.
      if (request.method !== 'GET' || (host !== `localhost:${port}` && host !== `127.0.0.1:${port}`)) {
        response.writeHead(400).end()
        return
      }

      const url = new URL(request.url ?? '/', `http://localhost:${port}`)

      if (url.pathname !== '/') {
        response.writeHead(404).end()
        return
      }

      const params = url.searchParams

      if (params.get('state') !== state) {
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(DONE_PAGE('Sign-in failed', 'This sign-in link is out of date. Start again from Wave Client.'))
        return
      }

      const error = params.get('error')

      if (error) {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(DONE_PAGE('Sign-in cancelled', 'You can close this tab and return to Wave Client.'))
        settle.reject(
          error === 'access_denied'
            ? new AuthError('cancelled', 'Sign-in was cancelled.')
            : new AuthError('unexpected', 'Microsoft sign-in failed.', undefined, `${error}: ${params.get('error_description') ?? ''}`)
        )
        return
      }

      const value = params.get('code')

      if (!value) {
        response.writeHead(400).end()
        return
      }

      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(DONE_PAGE('Signed in', 'You can close this tab and return to Wave Client.'))
      settle.resolve(value)
    })

    const timer = setTimeout(() => settle.reject(new AuthError('timed-out', 'Sign-in timed out. Please try again.')), timeoutMs)
    const onAbort = (): void => settle.reject(new AuthError('cancelled', 'Sign-in was cancelled.'))
    signal?.addEventListener('abort', onAbort, { once: true })

    const close = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      server.closeAllConnections()
      server.close()
    }

    server.on('error', (error) => {
      close()
      rejectServer(new AuthError('unexpected', "Couldn't start the sign-in listener.", undefined, error.message))
    })

    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port
      resolveServer({ redirectUri: `http://localhost:${port}`, code, close })
    })

    if (signal?.aborted) {
      onAbort()
    }
  })
}

export interface DeviceCodePrompt {
  userCode: string
  verificationUri: string
  expiresAt: number
}

export interface DeviceCodeOptions {
  clientId: string
  onPrompt: (prompt: DeviceCodePrompt) => void
  signal?: AbortSignal
  now?: () => number
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

/** The slowest polling gets after network trouble, so an approved code is still picked up soon. */
const MAX_POLL_INTERVAL_MS = 30_000

/**
 * Signs in by showing a code to enter at microsoft.com/link (RFC 8628). Polling survives network
 * trouble (it backs off and tries again), since the player may already have entered the code.
 */
export async function signInWithDeviceCode(http: HttpClient, options: DeviceCodeOptions): Promise<MicrosoftTokens> {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? abortableSleep
  const start = await msRequest(() =>
    http.postForm<{ device_code: string; user_code: string; verification_uri: string; expires_in: number; interval?: number }>(
      MS_DEVICE_CODE,
      { client_id: options.clientId, scope: MS_SCOPE },
      { signal: options.signal }
    )
  )
  const expiresAt = now() + start.expires_in * 1000
  let interval = Math.max(1, start.interval ?? 5) * 1000
  options.onPrompt({ userCode: start.user_code, verificationUri: start.verification_uri, expiresAt })

  for (;;) {
    try {
      await sleep(interval, options.signal)
    } catch {
      throw new AuthError('cancelled', 'Sign-in was cancelled.')
    }

    if (now() >= expiresAt) {
      throw new AuthError('expired-code', 'The sign-in code expired. Please start again.')
    }

    try {
      return await redeem(http, options.clientId, {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: start.device_code
      }, options.signal)
    } catch (error) {
      if (options.signal?.aborted) {
        throw new AuthError('cancelled', 'Sign-in was cancelled.')
      }

      if (error instanceof AuthError && (error.code === 'network' || error.code === 'rate-limited')) {
        interval = Math.min(MAX_POLL_INTERVAL_MS, interval * 2)
        continue
      }

      if (!(error instanceof OAuthError)) {
        throw error
      }

      switch (error.oauthCode) {
        case 'authorization_pending':
          continue
        case 'slow_down':
          interval += 5000
          continue
        case 'temporarily_unavailable':
          interval = Math.min(MAX_POLL_INTERVAL_MS, interval * 2)
          continue
        case 'authorization_declined':
          throw new AuthError('declined', 'Sign-in was declined.')
        case 'expired_token':
          throw new AuthError('expired-code', 'The sign-in code expired. Please start again.')
        default:
          throw toAuthError(error)
      }
    }
  }
}

/** Uses the refresh token. Microsoft rotates it: the new one in the result must replace the old. */
export function refreshMicrosoft(http: HttpClient, clientId: string, refreshToken: string, signal?: AbortSignal): Promise<MicrosoftTokens> {
  return redeem(http, clientId, { grant_type: 'refresh_token', refresh_token: refreshToken, scope: MS_SCOPE }, signal).catch((error: unknown) => {
    throw error instanceof OAuthError ? toAuthError(error) : error
  })
}

/** An error response from the token endpoint ({error, error_description}). */
class OAuthError extends Error {
  constructor(
    readonly oauthCode: string,
    readonly description: string
  ) {
    super(`${oauthCode}: ${description}`)
  }
}

async function redeem(http: HttpClient, clientId: string, form: Record<string, string>, signal?: AbortSignal): Promise<MicrosoftTokens> {
  let response: TokenResponse

  try {
    response = await http.postForm<TokenResponse>(MS_TOKEN, { client_id: clientId, ...form }, { signal })
  } catch (error) {
    if (error instanceof HttpError && error.status === 400) {
      const body = error.json<{ error?: string; error_description?: string }>()

      if (body?.error) {
        throw new OAuthError(body.error, body.error_description ?? '')
      }
    }

    throw mapNetwork(error)
  }

  if (!response.access_token || !response.refresh_token) {
    throw new AuthError('unexpected', 'Microsoft sign-in returned an incomplete response.')
  }

  return { accessToken: response.access_token, refreshToken: response.refresh_token, expiresAt: Date.now() + response.expires_in * 1000 }
}

function toAuthError(error: OAuthError): AuthError {
  if (error.oauthCode === 'invalid_grant' || error.oauthCode === 'interaction_required' || error.oauthCode === 'consent_required') {
    return new AuthError('invalid-grant', 'Your Microsoft sign-in has expired. Please sign in again.', undefined, error.message)
  }

  return new AuthError('unexpected', 'Microsoft sign-in failed.', undefined, error.message)
}

async function msRequest<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    throw mapNetwork(error)
  }
}

/** HTTP and network failures as AuthErrors (rate limits and outages get their own messages). */
export function mapNetwork(error: unknown): unknown {
  if (error instanceof AuthError) {
    return error
  }

  if (error instanceof HttpError) {
    if (error.status === 429) {
      return new AuthError('rate-limited', 'Too many sign-in attempts. Please wait a few minutes and try again.', undefined, error.message)
    }

    if (error.status >= 500) {
      return new AuthError('network', 'The sign-in service is having problems. Please try again later.', undefined, error.message)
    }

    return new AuthError('unexpected', 'Sign-in failed.', undefined, error.message)
  }

  if (error instanceof NetworkError) {
    return new AuthError('network', "Couldn't reach the sign-in service. Check your internet connection.", undefined, error.message)
  }

  // The player (or a newer sign-in) cancelled while a request was in flight.
  if (error instanceof Error && error.name === 'AbortError') {
    return new AuthError('cancelled', 'Sign-in was cancelled.')
  }

  return error
}
