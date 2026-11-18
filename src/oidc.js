/**
 * OpenID Connect helpers for the Sign in with ChatGPT flow: ID-token
 * verification against OpenAI's published keys and refresh-token revocation.
 *
 * Nothing here talks to a model; it only protects the identity claims an
 * official sign-in returns and ends a renewable session the way OpenAI asks.
 */
import { createPublicKey, verify } from 'node:crypto'

/** Issuer of the official sign-in tokens. */
export const ISSUER = 'https://auth.openai.com'

/** Discovery document of that issuer. */
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`

/** Discovery is cached this long; keys rotate far less often than tokens. */
const DISCOVERY_TTL_MS = 60 * 60 * 1000

/** Clock skew tolerated when checking `exp`. */
const CLOCK_SKEW_SECONDS = 60

let discovery

/**
 * Read the issuer's discovery document, cached in-process.
 * @param signal - caller cancellation.
 * @returns the discovery document.
 */
export async function openidConfiguration(signal) {
  if (discovery !== undefined && discovery.expiresAt > Date.now()) return discovery.value
  const response = await fetch(DISCOVERY_URL, { headers: { accept: 'application/json' }, signal })
  if (!response.ok) throw new Error(`OpenID discovery answered ${response.status}`)
  const value = await response.json()
  discovery = { value, expiresAt: Date.now() + DISCOVERY_TTL_MS }
  return value
}

/**
 * Decode one JWT segment.
 * @param segment - base64url text.
 * @returns the parsed JSON value.
 */
function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment.replace(/-/gu, '+').replace(/_/gu, '/'), 'base64').toString('utf8'))
}

/**
 * Verify one ID token against the issuer's keys and this attempt's facts.
 *
 * `keys` may be supplied by a caller that already holds a JWK set (tests, or a
 * host that caches them); otherwise the discovery document's `jwks_uri` is read.
 * @param idToken - compact JWT from the token endpoint.
 * @param options - issued client id, expected nonce, issuer, and optional keys.
 * @returns the verified claims.
 * @throws Error when the signature, issuer, audience, expiry, or nonce fails.
 */
export async function verifyIdToken(idToken, options) {
  if (typeof idToken !== 'string') throw new Error('the token response carried no ID token')
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new Error('the ID token is not a compact JWT')
  const header = decodeSegment(parts[0])
  const claims = decodeSegment(parts[1])
  if (header.alg !== 'RS256') throw new Error(`unsupported ID-token algorithm ${String(header.alg)}`)
  const keys = options.keys ?? await signingKeys(options.signal)
  const jwk = keys.find(key => key.kid === header.kid) ?? (keys.length === 1 ? keys[0] : undefined)
  if (jwk === undefined) throw new Error('the ID token names no published signing key')
  const publicKey = createPublicKey({ key: jwk, format: 'jwk' })
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`)
  const signature = Buffer.from(parts[2].replace(/-/gu, '+').replace(/_/gu, '/'), 'base64')
  if (!verify('RSA-SHA256', signed, publicKey, signature)) throw new Error('the ID-token signature is invalid')
  const issuer = options.issuer ?? ISSUER
  if (claims.iss !== issuer) throw new Error(`unexpected ID-token issuer ${String(claims.iss)}`)
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!audience.includes(options.clientId)) throw new Error('the ID token was issued for another client')
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < Math.floor(Date.now() / 1000)) {
    throw new Error('the ID token has expired')
  }
  if (options.nonce !== undefined && claims.nonce !== options.nonce) throw new Error('the ID-token nonce does not match this sign-in')
  return claims
}

/**
 * Read the issuer's signing keys.
 * @param signal - caller cancellation.
 * @returns the JWK set entries.
 */
export async function signingKeys(signal) {
  const configuration = await openidConfiguration(signal)
  const uri = typeof configuration.jwks_uri === 'string'
    ? configuration.jwks_uri
    : `${ISSUER}/.well-known/jwks.json`
  const response = await fetch(uri, { headers: { accept: 'application/json' }, signal })
  if (!response.ok) throw new Error(`the key set answered ${response.status}`)
  const body = await response.json()
  if (!Array.isArray(body.keys)) throw new Error('the key set carried no keys')
  return body.keys
}

/**
 * Revoke one renewable session, as the official sign-out asks.
 * @param request - issued client id and the stored refresh token.
 * @returns whether the issuer confirmed the revocation.
 */
export async function revokeSession(request) {
  const { clientId, refreshToken, signal } = request
  if (typeof refreshToken !== 'string' || refreshToken.length === 0) return { ok: false, reason: 'no refresh token' }
  const configuration = await openidConfiguration(signal)
  const endpoint = configuration.revocation_endpoint
  if (typeof endpoint !== 'string' || endpoint.length === 0) return { ok: false, reason: 'no revocation endpoint' }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: new URLSearchParams({
      token: refreshToken,
      token_type_hint: 'refresh_token',
      ...typeof clientId === 'string' && clientId.length > 0 ? { client_id: clientId } : {},
    }).toString(),
    signal,
  })
  return { ok: response.ok, status: response.status }
}
