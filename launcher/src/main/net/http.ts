/**
 * A small HTTP client over a fetch function: timeouts, cancellation, retries with backoff for
 * idempotent requests, and errors that carry the status without leaking request bodies.
 *
 * In the app the fetch function is Electron's net.fetch (it follows the system proxy); tests pass
 * a fake one.
 */

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

export interface HttpOptions {
  /** Per-attempt timeout. */
  timeoutMs?: number
  signal?: AbortSignal
  headers?: Record<string, string>
  /** Extra attempts after the first, for network errors, 408, 429 and 5xx. */
  retries?: number
}

export class HttpError extends Error {
  /** The start of the response body, for messages. */
  readonly bodySnippet: string

  constructor(
    readonly status: number,
    readonly url: string,
    /** The response body (capped), for parsing error details. Never includes the request. */
    readonly body: string,
    readonly retryAfterMs: number | null = null,
    readonly headers: Headers = new Headers()
  ) {
    const snippet = body.length > 300 ? `${body.slice(0, 300)}…` : body
    super(`HTTP ${status} from ${redactUrl(url)}${snippet ? `: ${snippet}` : ''}`)
    this.name = 'HttpError'
    this.bodySnippet = snippet
  }

  /** The body parsed as JSON, or null. */
  json<T = Record<string, unknown>>(): T | null {
    try {
      return JSON.parse(this.body) as T
    } catch {
      return null
    }
  }
}

/** Strips the query string, which can hold codes or tokens, from a URL used in a message. */
export function redactUrl(url: string): string {
  const query = url.indexOf('?')
  return query < 0 ? url : `${url.slice(0, query)}?…`
}

const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_BACKOFF_MS = 15_000

export interface HttpClientConfig {
  fetch: FetchFn
  userAgent: string
  /** Backoff before retry n (0-based); tests make it instant. */
  backoffMs?: (attempt: number) => number
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

export class HttpClient {
  private readonly fetchFn: FetchFn
  private readonly userAgent: string
  private readonly backoffMs: (attempt: number) => number
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>

  constructor(config: HttpClientConfig) {
    this.fetchFn = config.fetch
    this.userAgent = config.userAgent
    this.backoffMs = config.backoffMs ?? ((attempt) => Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt))
    this.sleep = config.sleep ?? abortableSleep
  }

  /** GET and parse JSON, retrying transient failures. */
  async getJson<T>(url: string, options: HttpOptions = {}): Promise<T> {
    const response = await this.request(url, { method: 'GET', headers: { Accept: 'application/json' } }, { retries: 3, ...options })
    return (await response.json()) as T
  }

  /** GET the raw response (for streaming downloads), retrying transient failures before the body starts. */
  async get(url: string, options: HttpOptions = {}): Promise<Response> {
    return this.request(url, { method: 'GET' }, { retries: 3, ...options })
  }

  /** POST a JSON body. Not retried unless asked: auth calls must not be replayed blindly. */
  async postJson<T>(url: string, body: unknown, options: HttpOptions = {}): Promise<T> {
    const response = await this.request(
      url,
      { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', Accept: 'application/json' } },
      { retries: 0, ...options }
    )
    return (await response.json()) as T
  }

  /** POST application/x-www-form-urlencoded and parse JSON. */
  async postForm<T>(url: string, form: Record<string, string>, options: HttpOptions = {}): Promise<T> {
    const response = await this.request(
      url,
      {
        method: 'POST',
        body: new URLSearchParams(form).toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }
      },
      { retries: 0, ...options }
    )
    return (await response.json()) as T
  }

  /**
   * Sends a request and returns the response when it is 2xx. Non-2xx responses become HttpError;
   * transient failures are retried up to options.retries times.
   */
  async request(url: string, init: RequestInit, options: HttpOptions = {}): Promise<Response> {
    const retries = options.retries ?? 0
    let lastError: unknown

    for (let attempt = 0; attempt <= retries; attempt++) {
      options.signal?.throwIfAborted()
      const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout

      try {
        const response = await this.fetchFn(url, {
          ...init,
          signal,
          headers: { 'User-Agent': this.userAgent, ...(init.headers as Record<string, string> | undefined), ...options.headers }
        })

        if (response.ok) {
          return response
        }

        const error = new HttpError(response.status, url, await errorBody(response), retryAfter(response), response.headers)

        if (!RETRY_STATUSES.has(response.status) || attempt === retries) {
          throw error
        }

        lastError = error
        await this.sleep(Math.max(error.retryAfterMs ?? 0, this.backoffMs(attempt)), options.signal)
      } catch (error) {
        if (error instanceof HttpError || options.signal?.aborted || attempt === retries) {
          throw error
        }

        // A network error or a timed-out attempt: try again.
        lastError = error
        await this.sleep(this.backoffMs(attempt), options.signal)
      }
    }

    throw lastError
  }
}

const MAX_ERROR_BODY = 8192

async function errorBody(response: Response): Promise<string> {
  try {
    const text = await response.text()
    return text.length > MAX_ERROR_BODY ? text.slice(0, MAX_ERROR_BODY) : text
  } catch {
    return ''
  }
}

function retryAfter(response: Response): number | null {
  const value = response.headers.get('retry-after')

  if (!value) {
    return null
  }

  const seconds = Number(value)

  if (Number.isFinite(seconds)) {
    return Math.min(60_000, Math.max(0, seconds * 1000))
  }

  const date = Date.parse(value)
  return Number.isNaN(date) ? null : Math.min(60_000, Math.max(0, date - Date.now()))
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    function onAbort(): void {
      clearTimeout(timer)
      reject(signal?.reason)
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
