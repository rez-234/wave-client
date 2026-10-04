/** Why signing in or refreshing failed, with a message a player can act on. */
export type AuthErrorCode =
  | 'not-configured'
  | 'cancelled'
  | 'declined'
  | 'timed-out'
  | 'expired-code'
  | 'invalid-grant'
  | 'client-changed'
  | 'xbox'
  | 'app-not-approved'
  | 'no-profile'
  | 'not-owned'
  | 'rate-limited'
  | 'network'
  | 'unexpected'

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
    readonly helpUrl?: string,
    /** Technical detail for the log; never shown as the main message. */
    readonly detail?: string
  ) {
    super(message)
    this.name = 'AuthError'
  }

  /** Errors that only signing in again fixes (as opposed to retrying later). */
  get needsSignIn(): boolean {
    return this.code === 'invalid-grant' || this.code === 'client-changed'
  }
}

export const APP_REVIEW_URL = 'https://aka.ms/mce-reviewappid'

interface XboxErrorInfo {
  message: string
  helpUrl?: string
}

/**
 * Xbox Live's XErr codes from the XSTS step (HTTP 401). Sources: PrismLauncher, prismarine-auth,
 * MinecraftAuth (XO_E_* constants from microsoft/xbox-live-api), HMCL, ATLauncher.
 */
const XBOX_ERRORS: Record<number, XboxErrorInfo> = {
  2148916227: { message: 'This Microsoft account is banned from Xbox Live.', helpUrl: 'https://enforcement.xbox.com/' },
  2148916228: { message: 'This Microsoft account is banned from Xbox Live by a third party.' },
  2148916229: {
    message: "This is a child account, and its parent or guardian hasn't allowed online play. They can change that in Microsoft Family settings.",
    helpUrl: 'https://account.microsoft.com/family/'
  },
  2148916233: {
    message: "This Microsoft account doesn't have an Xbox profile yet. Sign in once at minecraft.net or xbox.com to create one, then try again.",
    helpUrl: 'https://www.minecraft.net/en-us/login'
  },
  2148916234: { message: "You need to accept the Xbox terms of use first. Sign in at xbox.com, then try again.", helpUrl: 'https://www.xbox.com/' },
  2148916235: { message: "Xbox Live isn't available in this account's country or region." },
  2148916236: { message: 'This account needs age verification before it can play online (South Korea).', helpUrl: 'https://account.xbox.com/' },
  2148916237: { message: "This account has reached its playtime limit for now (a parent or guardian's time limit)." },
  2148916238: {
    message: 'This account is under 18 and must be added to a Microsoft Family by an adult before it can sign in.',
    helpUrl: 'https://help.minecraft.net/hc/en-us/articles/4408968616077'
  },
  2148916258: { message: 'Your Xbox sign-in expired. Please try again.' },
  2148916261: { message: 'Your Xbox sign-in is no longer valid. Please sign in again.' }
}

export function xboxError(xerr: number | null, detail?: string): AuthError {
  const info = xerr !== null ? XBOX_ERRORS[xerr] : undefined
  return new AuthError(
    'xbox',
    info?.message ?? `Xbox Live sign-in failed${xerr !== null ? ` (XErr ${xerr})` : ''}.`,
    info?.helpUrl,
    detail
  )
}

export function notConfiguredError(): AuthError {
  return new AuthError(
    'not-configured',
    "Microsoft sign-in isn't set up in this build of Wave Client. It needs an Azure app ID approved for Minecraft (WAVE_MSA_CLIENT_ID).",
    APP_REVIEW_URL
  )
}

export function appNotApprovedError(detail?: string): AuthError {
  return new AuthError(
    'app-not-approved',
    "Microsoft and Xbox accepted the sign-in, but Minecraft's servers rejected this launcher's app registration. The app has to be approved by Mojang first; try again once it is.",
    APP_REVIEW_URL,
    detail
  )
}
