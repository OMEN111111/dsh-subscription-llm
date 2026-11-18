/**
 * Shared browser sign-in choreography: one authorize URL, an optional loopback
 * listener, and a paste field for the cases the browser cannot return through
 * localhost.
 */
import { message } from './copy.js'

/**
 * Accept every shape a user might paste: a full redirect URL, `code#state`, a
 * bare query string, or the bare code.
 * @param input - pasted text.
 * @returns the code, state, and issued client id it carried, when present.
 */
export function parseAuthorizationInput(input) {
  const value = String(input ?? '').trim()
  if (value.length === 0) return {}
  try {
    const url = new URL(value)
    return {
      code: url.searchParams.get('code') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
      clientId: url.searchParams.get('client_id') ?? undefined,
    }
  } catch (_notAUrl) {
    /* fall through to the compact forms */
  }
  if (value.includes('#')) {
    const [code, state] = value.split('#', 2)
    return { code, state }
  }
  if (value.includes('code=')) {
    const params = new URLSearchParams(value.startsWith('?') ? value.slice(1) : value)
    return {
      code: params.get('code') ?? undefined,
      state: params.get('state') ?? undefined,
      clientId: params.get('client_id') ?? undefined,
    }
  }
  return { code: value }
}

/**
 * Wait for the provider's redirect and return every parameter it carried:
 * whichever arrives first, the loopback callback or a pasted value. A failed
 * listener just leaves the paste field.
 * @param options - prompt wording, the listener, state to verify, cancellation.
 * @returns the authorization callback parameters, always with a `code`.
 * @throws when the user's cancellation or a rejected answer ends the attempt.
 */
export async function waitForParams(options) {
  const { interaction, loopback, signal, message: promptText, placeholder, state, lang } = options
  const entries = []
  if (loopback !== undefined) {
    entries.push({
      source: 'callback',
      promise: loopback.wait(signal).then(
        params => ({ ok: true, params: normalizeCallbackParams(params) }),
        error => ({ ok: false, error }),
      ),
    })
  }
  let promptRound = 0
  const ask = () => {
    promptRound += 1
    entries.push({
      source: `paste-${promptRound}`,
      promise: interaction.prompt({
        kind: 'text',
        message: promptRound === 1 ? promptText : `${promptText}${message(lang, 'pasteRetry')}`,
        placeholder,
      }).then(
        value => ({ ok: true, params: parseAuthorizationInput(value) }),
        error => ({ ok: false, error }),
      ),
    })
  }
  ask()
  // Cancellation must settle this wait even when the only remaining answer is a
  // paste field nobody will fill in.
  const cancelled = new Promise((_resolve, reject) => {
    if (signal === undefined) return
    if (signal.aborted === true) {
      reject(new Error('sign-in cancelled'))
      return
    }
    signal.addEventListener('abort', () => reject(new Error('sign-in cancelled')), { once: true })
  })
  // A successful race leaves this promise behind; keep its rejection handled.
  cancelled.catch(() => {})
  while (entries.length > 0) {
    if (signal?.aborted === true) throw new Error('sign-in cancelled')
    const settled = await Promise.race([
      ...entries.map(entry => entry.promise.then(result => ({ source: entry.source, result }))),
      cancelled.then(() => ({ source: 'abort', result: { ok: false, error: new Error('sign-in cancelled') } })),
    ])
    const index = entries.findIndex(entry => entry.source === settled.source)
    if (index >= 0) entries.splice(index, 1)
    const { result, source } = settled
    if (!result.ok) {
      if (source === 'callback') continue
      throw result.error instanceof Error ? result.error : new Error(String(result.error))
    }
    const params = result.params ?? {}
    if (params.code === undefined || params.code.length === 0) {
      if (source === 'callback') interaction.notify({ message: message(lang, 'noCode') })
      ask()
      continue
    }
    if (state !== undefined && params.state !== undefined && params.state !== state) {
      interaction.notify({ message: message(lang, 'stateMismatch') })
      ask()
      continue
    }
    return params
  }
  throw new Error('sign-in cancelled')
}

/**
 * Normalize one provider callback into the shape the flows read.
 *
 * A loopback callback carries raw query keys (`client_id`, `code`, `state`),
 * while a pasted callback is parsed by {@link parseAuthorizationInput}. Both
 * must expose the issued client id as `clientId`, otherwise a new registration
 * looks like it never received one.
 * @param params - raw callback parameters.
 * @returns the normalized parameters.
 */
function normalizeCallbackParams(params) {
  if (params === null || typeof params !== 'object') return {}
  const { client_id: clientId, ...rest } = params
  return clientId === undefined ? rest : { ...rest, clientId }
}

/**
 * Wait for the provider's redirect and return just the authorization code.
 * @param options - prompt wording, the listener, state to verify, cancellation.
 * @returns the authorization code.
 * @throws when the user's cancellation or a rejected answer ends the attempt.
 */
export async function waitForCode(options) {
  const params = await waitForParams(options)
  return params.code
}

/**
 * Read the payload of a JWT without verifying it; only used for identity claims
 * the provider itself signs.
 * @param token - compact JWT.
 * @returns decoded claims, or undefined when the token is not a JWT.
 */
export function decodeJwt(token) {
  if (typeof token !== 'string') return undefined
  const parts = token.split('.')
  if (parts.length < 2) return undefined
  try {
    const json = Buffer.from(parts[1].replace(/-/gu, '+').replace(/_/gu, '/'), 'base64').toString('utf8')
    const claims = JSON.parse(json)
    return claims !== null && typeof claims === 'object' ? claims : undefined
  } catch (_notJwt) {
    return undefined
  }
}
