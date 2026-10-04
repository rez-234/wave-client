const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The Azure app id for Microsoft sign-in: WAVE_MSA_CLIENT_ID at runtime (for development and
 * testing) or MAIN_VITE_MSA_CLIENT_ID at build time. Null when neither is a valid id, in which case
 * the launcher explains that sign-in isn't set up instead of trying.
 */
export function msaClientId(runtime: string | undefined, buildTime: string | undefined): string | null {
  for (const value of [runtime, buildTime]) {
    const id = value?.trim()

    if (id && GUID.test(id)) {
      return id.toLowerCase()
    }
  }

  return null
}

export const LAUNCHER_NAME = 'wave-client'

/** Hosts whose pages the UI may open in the browser (sign-in help, account settings). */
const EXTERNAL_HOSTS = ['aka.ms', 'microsoft.com', 'live.com', 'xbox.com', 'minecraft.net']

export function isAllowedExternalUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) {
    return false
  }

  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      EXTERNAL_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
    )
  } catch {
    return false
  }
}
