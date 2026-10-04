import { HttpError, type HttpClient } from '../net/http'
import { AuthError, appNotApprovedError, xboxError } from './errors'
import { mapNetwork } from './microsoft'

export const XBL_AUTHENTICATE = 'https://user.auth.xboxlive.com/user/authenticate'
export const XSTS_AUTHORIZE = 'https://xsts.auth.xboxlive.com/xsts/authorize'
export const MC_LOGIN = 'https://api.minecraftservices.com/authentication/login_with_xbox'
export const MC_PROFILE = 'https://api.minecraftservices.com/minecraft/profile'
export const MC_ENTITLEMENTS = 'https://api.minecraftservices.com/entitlements/mcstore'

const XBOX_HEADERS = { 'x-xbl-contract-version': '1' }

interface XboxResponse {
  Token: string
  NotAfter?: string
  DisplayClaims?: { xui?: { uhs?: string; xid?: string }[] }
}

export interface XboxToken {
  token: string
  userHash: string
}

/** Microsoft access token → Xbox Live user token. Azure (GUID) app tokens use the "d=" ticket prefix. */
export async function xboxUserToken(http: HttpClient, msAccessToken: string, signal?: AbortSignal): Promise<XboxToken> {
  const response = await xboxCall(http, XBL_AUTHENTICATE, {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT'
  }, signal)
  return checkXbox(response)
}

/** Xbox user token → XSTS token for Minecraft's services. */
export async function xstsToken(http: HttpClient, userToken: XboxToken, signal?: AbortSignal): Promise<XboxToken> {
  const response = await xboxCall(http, XSTS_AUTHORIZE, {
    Properties: { SandboxId: 'RETAIL', UserTokens: [userToken.token] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT'
  }, signal)
  const xsts = checkXbox(response)

  if (xsts.userHash !== userToken.userHash) {
    throw new AuthError('unexpected', 'Xbox Live returned tokens for two different users.')
  }

  return xsts
}

async function xboxCall(http: HttpClient, url: string, body: unknown, signal?: AbortSignal): Promise<XboxResponse> {
  try {
    return await http.postJson<XboxResponse>(url, body, { signal, headers: XBOX_HEADERS })
  } catch (error) {
    if (error instanceof HttpError && error.status >= 400 && error.status < 500 && error.status !== 429) {
      // XErr comes in the X-Err header or the body ({"XErr": 2148916233, ...}).
      const header = error.headers.get('x-err')
      const fromBody = error.json<{ XErr?: number | string }>()?.XErr
      const xerr = Number(header ?? fromBody)
      throw xboxError(Number.isFinite(xerr) && xerr > 0 ? xerr : null, error.message)
    }

    throw mapNetwork(error)
  }
}

function checkXbox(response: XboxResponse): XboxToken {
  const userHash = response.DisplayClaims?.xui?.[0]?.uhs

  if (!response.Token || !userHash) {
    throw new AuthError('unexpected', 'Xbox Live returned an incomplete response.')
  }

  return { token: response.Token, userHash }
}

export interface MinecraftToken {
  accessToken: string
  /** Epoch milliseconds. */
  expiresAt: number
}

/** XSTS → Minecraft access token. An Azure app Mojang hasn't approved fails here, and only here. */
export async function minecraftLogin(http: HttpClient, xsts: XboxToken, signal?: AbortSignal, now = Date.now): Promise<MinecraftToken> {
  try {
    const response = await http.postJson<{ access_token: string; expires_in: number }>(
      MC_LOGIN,
      { identityToken: `XBL3.0 x=${xsts.userHash};${xsts.token}` },
      { signal }
    )

    if (!response.access_token || !(response.expires_in > 0)) {
      throw new AuthError('unexpected', "Minecraft's sign-in returned an incomplete response.")
    }

    return { accessToken: response.access_token, expiresAt: now() + response.expires_in * 1000 }
  } catch (error) {
    if (error instanceof HttpError && (error.status === 401 || error.status === 403) && /invalid app registration/i.test(error.body)) {
      throw appNotApprovedError(error.message)
    }

    throw mapNetwork(error)
  }
}

export interface MinecraftProfile {
  /** UUID without dashes. */
  id: string
  name: string
}

/**
 * The player's Java Edition profile. No profile (404) is explained with the entitlements: an
 * account that owns the game but never chose a name, or one that doesn't own it.
 */
export async function minecraftProfile(http: HttpClient, mcAccessToken: string, signal?: AbortSignal): Promise<MinecraftProfile> {
  const headers = { Authorization: `Bearer ${mcAccessToken}` }

  try {
    const profile = await http.getJson<MinecraftProfile>(MC_PROFILE, { signal, headers, retries: 1 })

    if (!/^[0-9a-f]{32}$/i.test(profile.id ?? '') || typeof profile.name !== 'string' || profile.name.length === 0) {
      throw new AuthError('unexpected', "Minecraft's profile service returned an unexpected response.")
    }

    return { id: profile.id.toLowerCase(), name: profile.name }
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 404) {
      throw mapNetwork(error)
    }
  }

  let owns = false

  try {
    const entitlements = await http.getJson<{ items?: { name?: string }[] }>(MC_ENTITLEMENTS, { signal, headers, retries: 1 })
    owns = (entitlements.items ?? []).some((item) => item.name === 'game_minecraft' || item.name === 'product_minecraft')
  } catch {
    // Can't tell; assume the more likely case below.
  }

  throw owns
    ? new AuthError(
        'no-profile',
        "This account can play Minecraft but hasn't created a Java Edition profile yet. Choose a player name at minecraft.net (or open the official launcher once), then sign in again.",
        'https://www.minecraft.net/en-us/msaprofile/mygames/editprofile'
      )
    : new AuthError('not-owned', "This Microsoft account doesn't own Minecraft: Java Edition.", 'https://www.minecraft.net/en-us/store/minecraft-java-bedrock-edition-pc')
}

/** The Xbox user id from the Minecraft token's "xuid" claim, or "" (the game accepts an empty value). */
export function xuidFromToken(mcAccessToken: string): string {
  const payload = mcAccessToken.split('.')[1]

  if (!payload) {
    return ''
  }

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { xuid?: unknown }
    return typeof claims.xuid === 'string' && /^\d{1,20}$/.test(claims.xuid) ? claims.xuid : ''
  } catch {
    return ''
  }
}
