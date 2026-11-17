/**
 * Credential records for the three subscription channels.
 *
 * Each channel owns one record in DSH's credential store under
 * `<scope>/<channel id>`; the record payload is the OAuth grant plus the small
 * amount of account context the Models page shows. Records are the only place
 * tokens live — never Config, never logs.
 */

/** Record scope: the plugin's own credential namespace. */
export const SCOPE = 'dsh-subscription-channels'

/** Current payload layout version; a mismatch is treated as "sign in again". */
export const PAYLOAD_VERSION = 1

/**
 * The record key for one channel.
 * @param channelId - channel identity from the channel table.
 * @returns the `<scope>/<id>` credential key.
 */
export function recordKey(channelId) {
  return `${SCOPE}/${channelId}`
}

/**
 * Read one channel's stored grant.
 * @param ctx - owning plugin context.
 * @param channelId - channel identity.
 * @returns the parsed payload, or undefined when nothing usable is stored.
 */
export async function readLink(ctx, channelId) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) return undefined
  let record
  try {
    record = await credentials.readRecord(recordKey(channelId))
  } catch (_unreadableRecord) {
    return undefined
  }
  if (record === undefined || record.kind !== 'grant') return undefined
  const payload = record.payload
  if (payload === null || typeof payload !== 'object') return undefined
  if (payload.version !== PAYLOAD_VERSION) return undefined
  if (typeof payload.accessToken !== 'string' || payload.accessToken.length === 0) return undefined
  return payload
}

/**
 * Replace one channel's stored grant.
 * @param ctx - owning plugin context.
 * @param channelId - channel identity.
 * @param payload - the grant to store; `version` is stamped here.
 */
export async function writeLink(ctx, channelId, payload) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) throw new Error('this composition mounts no credential store')
  await credentials.modifyRecord(recordKey(channelId), async () => ({
    kind: 'grant',
    payload: { ...payload, version: PAYLOAD_VERSION },
  }))
}

/**
 * Delete one channel's stored grant. Idempotent.
 * @param ctx - owning plugin context.
 * @param channelId - channel identity.
 */
export async function clearLink(ctx, channelId) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) return
  await credentials.deleteRecord(recordKey(channelId))
}

/**
 * Whether a stored grant still looks usable.
 * @param link - stored payload.
 * @param skewMs - treat a token expiring inside this window as expired.
 * @returns true while the access token can still be sent.
 */
export function isFresh(link, skewMs = 60_000) {
  if (typeof link.expiresAt !== 'number') return true
  return link.expiresAt - Date.now() > skewMs
}
