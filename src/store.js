/**
 * Credential records for the subscription channels.
 *
 * One record per channel holds a small credential *set*: every registration the
 * user has authorized, plus which one is selected. A registration is keyed by
 * the issued `client_id` (or `default` for the legacy single-grant channels), so
 * signing into a second ChatGPT account never overwrites the first, and a
 * signed-out registration can keep its identity while its tokens are gone.
 *
 * The record lives in DSH's credential store under `<scope>/<channel id>`;
 * tokens never enter Config, logs, or a model catalog file.
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
 * The storage key of one registration inside a channel's set.
 * @param account - stored registration.
 * @returns the issued client id, or `default` for a legacy grant.
 */
export function accountKey(account) {
  return typeof account?.clientId === 'string' && account.clientId.length > 0 ? account.clientId : 'default'
}

/**
 * Whether a registration still holds usable tokens.
 * @param account - stored registration.
 * @returns true when an access token is present.
 */
export function hasTokens(account) {
  return typeof account?.accessToken === 'string' && account.accessToken.length > 0
}

/**
 * One empty credential set.
 * @returns the set skeleton.
 */
function emptySet() {
  return { version: PAYLOAD_VERSION, accounts: [], selected: undefined }
}

/**
 * Read one channel's credential set, upgrading a legacy single grant on read.
 * @param ctx - owning plugin context.
 * @param channelId - channel identity.
 * @returns the parsed set.
 */
export async function readSet(ctx, channelId) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) return emptySet()
  let record
  try {
    record = await credentials.readRecord(recordKey(channelId))
  } catch (_unreadableRecord) {
    return emptySet()
  }
  if (record === undefined || record.kind !== 'grant') return emptySet()
  const payload = record.payload
  if (payload === null || typeof payload !== 'object') return emptySet()
  if (Array.isArray(payload.accounts)) {
    const accounts = payload.accounts.filter(account => account !== null && typeof account === 'object')
    const selected = typeof payload.selected === 'string' ? payload.selected : undefined
    return { version: PAYLOAD_VERSION, accounts, selected }
  }
  // A record written before credential sets existed: one grant, one account.
  if (typeof payload.accessToken === 'string' && payload.accessToken.length > 0) {
    return { version: PAYLOAD_VERSION, accounts: [payload], selected: 'default' }
  }
  return emptySet()
}

/**
 * Remove `undefined` leaves from a value.
 *
 * The credential store serializes payloads strictly; an object property whose
 * value is `undefined` (for example an omitted display label) makes the whole
 * record unwritable. Strip them at the boundary instead of at every call site.
 * @param value - any JSON-ish value.
 * @returns the same value without undefined object properties.
 */
export function compactValue(value) {
  if (Array.isArray(value)) return value.map(entry => compactValue(entry)).filter(entry => entry !== undefined)
  if (value === null || typeof value !== 'object') return value
  const output = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue
    output[key] = compactValue(entry)
  }
  return output
}

/**
 * Replace one channel's credential set.
 * @param ctx - owning plugin context.
 * @param channelId - channel identity.
 * @param set - accounts and the selected key.
 */
export async function writeSet(ctx, channelId, set) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) throw new Error('this composition mounts no credential store')
  await credentials.modifyRecord(recordKey(channelId), async () => ({
    kind: 'grant',
    payload: compactValue({
      version: PAYLOAD_VERSION,
      accounts: set.accounts,
      ...typeof set.selected === 'string' && set.selected.length > 0 ? { selected: set.selected } : {},
    }),
  }))
}

/**
 * Read the selected registration that still holds tokens, else the first one.
 * @param ctx - owning plugin context.
 * @param channelId - channel identity.
 * @returns the usable registration, or undefined.
 */
export async function readLink(ctx, channelId) {
  const set = await readSet(ctx, channelId)
  const selected = set.accounts.find(account => accountKey(account) === set.selected)
  if (selected !== undefined && hasTokens(selected)) return selected
  return set.accounts.find(account => hasTokens(account))
}

/**
 * Upsert one registration and select it.
 * @param ctx - owning plugin context.
 * @param channelId - channel identity.
 * @param payload - the grant to store; `version` is stamped by {@link writeSet}.
 */
export async function writeLink(ctx, channelId, payload) {
  const set = await readSet(ctx, channelId)
  const key = accountKey(payload)
  const accounts = [...set.accounts.filter(account => accountKey(account) !== key), compactValue(payload)]
  await writeSet(ctx, channelId, { accounts, selected: key })
}

/**
 * Remove the selected registration's tokens.
 *
 * A Sign in with ChatGPT registration keeps its issued client id and identity so
 * the same account can be reauthorized later, and other registrations keep
 * their own tokens; every other channel deletes its record.
 * Forget one registration's tokens while keeping its identity.
 * @param ctx - owning plugin context.
 * @param channelId - channel identity.
 * @param key - the registration's storage key.
 * @returns the remaining accounts.
 */
export async function clearAccount(ctx, channelId, key) {
  const set = await readSet(ctx, channelId)
  const accounts = set.accounts.map((account) => {
    if (accountKey(account) !== key) return account
    const { accessToken, refreshToken, idToken, expiresAt, scope, ...identity } = account
    return identity
  })
  const selectedStillUsable = accounts.find(account => accountKey(account) === set.selected && hasTokens(account))
  const next = selectedStillUsable ?? accounts.find(account => hasTokens(account))
  await writeSet(ctx, channelId, { accounts, selected: next === undefined ? undefined : accountKey(next) })
  return accounts
}

/**
 * Remove the selected registration's tokens.
 *
 * A Sign in with ChatGPT registration keeps its issued client id and identity so
 * the same account can be reauthorized later, and other registrations keep
 * their own tokens; every other channel deletes its record.
 * @param ctx - owning plugin context.
 * @param channelId - channel identity.
 * @param options - `keepRegistrations` strips tokens instead of deleting the record.
 */
export async function clearLink(ctx, channelId, options = {}) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) return
  if (options.keepRegistrations !== true) {
    await credentials.deleteRecord(recordKey(channelId))
    return
  }
  await clearAccount(ctx, channelId, (await readSet(ctx, channelId)).selected)
}

/**
 * Select one saved registration.
 * @param ctx - owning plugin context.
 * @param channelId - channel identity.
 * @param key - the registration's storage key.
 * @returns the selected registration, or undefined when it holds no tokens.
 */
export async function renameAccount(ctx, channelId, key, label) {
  const set = await readSet(ctx, channelId)
  const cleaned = typeof label === 'string' ? label.trim() : ''
  const accounts = set.accounts.map((account) => {
    if (accountKey(account) !== String(key)) return account
    if (cleaned.length === 0) {
      const { label: _discarded, ...rest } = account
      return rest
    }
    return { ...account, label: cleaned }
  })
  await writeSet(ctx, channelId, { accounts, selected: set.selected })
  return accounts
}

export async function removeAccount(ctx, channelId, key) {
  const set = await readSet(ctx, channelId)
  const accounts = set.accounts.filter(account => accountKey(account) !== String(key))
  const next = accounts.find(account => hasTokens(account))
  await writeSet(ctx, channelId, { accounts, selected: next === undefined ? undefined : accountKey(next) })
  return accounts
}

export async function selectAccount(ctx, channelId, key) {
  const set = await readSet(ctx, channelId)
  const account = set.accounts.find(entry => accountKey(entry) === key)
  if (account === undefined || !hasTokens(account)) return undefined
  await writeSet(ctx, channelId, { accounts: set.accounts, selected: key })
  return account
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



