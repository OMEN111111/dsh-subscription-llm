/**
 * The subscription service: stored grants, in-flight sign-ins, and the LLM
 * routes each linked channel owns.
 */
import { randomUUID } from 'node:crypto'
import { CHANNELS, CHANNEL_BY_ID } from './channels/index.js'
import { SubscriptionAdapter } from './adapter.js'
import { readLink, readSet, writeLink, clearLink, clearAccount, isFresh, accountKey, hasTokens, selectAccount, recordKey, PAYLOAD_VERSION } from './store.js'
import { message } from './copy.js'
import { catalogPath, readCatalog, writeCatalog, emptyCatalog } from './catalog.js'
import { probeModel } from './probe.js'

/** How long a settled attempt stays readable by the browser. */
const ATTEMPT_RETENTION_MS = 5 * 60 * 1000

/**
 * Admit a positive capacity from an edit payload. Numbers pass through; text
 * accepts the same `131072` / `256K` / `1M` spellings the panel shows.
 * @param value - candidate.
 * @returns the integer, or undefined when the value is not one.
 */
function positiveInt(value) {
  let numeric = NaN
  if (typeof value === 'number') numeric = value
  else if (typeof value === 'string') {
    const match = /^(\d+(?:\.\d+)?)\s*([km])?$/iu.exec(value.trim())
    if (match !== null) numeric = Number(match[1]) * (match[2]?.toLowerCase() === 'm' ? 1_000_000 : match[2]?.toLowerCase() === 'k' ? 1_000 : 1)
  }
  const rounded = Math.round(numeric)
  if (!Number.isSafeInteger(rounded) || rounded <= 0) return undefined
  return rounded
}

/**
 * The human-facing name of one registration: its label when set, else the email
 * local part, else the issued client id prefix.
 * @param account - stored registration.
 * @returns a short display name.
 */
function accountName(account) {
  if (typeof account.label === 'string' && account.label.length > 0) return account.label
  if (typeof account.account === 'string' && account.account.includes('@')) {
    return account.account.slice(0, account.account.indexOf('@'))
  }
  const key = accountKey(account)
  return key === 'default' ? 'default' : key.slice(0, 12)
}

export class SubscriptionService {
  /**
   * @param ctx - owning plugin context.
   * @param config - normalized plugin config.
   */
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = config
    /** attempt id -> attempt */
    this.attempts = new Map()
    /** channel id -> the attempt currently running */
    this.active = new Map()
    /** channel ids whose next sign-in must register a new client instead of reusing one */
    this.forceNewAccount = new Set()
    /** `channel:clientId` -> the refresh attempt other callers await */
    this.refreshing = new Map()
    /** channel id -> adapter registration handle */
    this.routes = new Map()
    /** Durable per-channel catalog: visibility, per-model overrides, last discovery. */
    this.catalogPath = catalogPath(ctx)
    this.catalog = readCatalog(this.catalogPath)
    // One stable host id per installation: the official sign-in binds ChatGPT
    // plan usage to a host separately from the issued client id.
    if (typeof this.catalog.hostId !== 'string' || this.catalog.hostId.length === 0) {
      this.catalog.hostId = `urn:uuid:${randomUUID()}`
      void this.persistCatalog()
    }
    this.config.hostId = this.catalog.hostId
    /** The injected LLM registry; optional services are read lazily, never as properties. */
    this.llm = ctx.get('llm')
    this.flowsFor = undefined
    this.adapter = new SubscriptionAdapter(this)
  }

  /**
   * The display name of one channel in the configured language.
   * @param channel - channel module.
   * @returns the label.
   */
  label(channel) {
    return this.config.lang === 'en' ? channel.name.en : channel.name.zh
  }

  /**
   * The stored catalog entry of one channel, created on demand.
   * @param channelId - channel identity.
   * @returns the mutable channel entry.
   */
  channelState(channelId) {
    this.catalog.channels[channelId] ??= {}
    const entry = this.catalog.channels[channelId]
    entry.deleted ??= []
    entry.overrides ??= {}
    entry.discovered ??= []
    entry.custom ??= []
    entry.order ??= []
    return entry
  }

  /**
   * Every model of one channel with the stored overrides applied, hidden ones
   * included: the catalog panel edits the same list the composer reads.
   * @param channel - channel module.
   * @returns merged entries carrying `visible`.
   */
  catalogModels(channel) {
    const stored = this.channelState(channel.id)
    const discovered = Array.isArray(stored.discovered) && stored.discovered.length > 0 ? stored.discovered : channel.models
    const known = new Set(discovered.map(model => model.id))
    const base = [...discovered, ...stored.custom.filter(model => !known.has(model.id))]
    const order = new Map(stored.order.map((id, index) => [id, index]))
    const ordered = [...base].sort((left, right) => {
      const leftIndex = order.get(left.id) ?? Number.MAX_SAFE_INTEGER
      const rightIndex = order.get(right.id) ?? Number.MAX_SAFE_INTEGER
      return leftIndex - rightIndex
    })
    const hidden = new Set(stored.deleted)
    return ordered.map((model) => {
      const override = stored.overrides[model.id] !== null && typeof stored.overrides[model.id] === 'object' ? stored.overrides[model.id] : {}
      const info = channel.modelInfo?.(model.id)
      const template = info ?? model
      const available = (info?.reasoning?.efforts ?? channel.reasoningEfforts ?? []).map(effort => ({
        id: effort.id,
        name: effort.name ?? effort.id,
        wire: typeof effort.wire === 'string' ? effort.wire : (channel.wireValue?.(effort.id) ?? effort.id),
      }))
      const chosen = Array.isArray(override.efforts)
        ? override.efforts
          .map(entry => typeof entry === 'string'
            ? available.find(candidate => candidate.id === entry)
            : (() => {
              const id = String(entry?.id ?? '')
              const known = available.find(candidate => candidate.id === id)
              return {
                id,
                name: String(entry?.name ?? known?.name ?? id),
                wire: String(entry?.wire ?? ''),
              }
            })())
          .filter(entry => entry !== undefined && entry.id.length > 0)
        : available
      const defaultEffort = typeof override.defaultEffort === 'string' && chosen.some(effort => effort.id === override.defaultEffort)
        ? override.defaultEffort
        : chosen.some(effort => effort.id === template?.reasoning?.defaultEffort)
          ? template.reasoning.defaultEffort
          : chosen[0]?.id
      const input = Array.isArray(override.input) && override.input.includes('image') ? ['text', 'image'] : ['text']
      return {
        id: model.id,
        name: typeof override.name === 'string' && override.name.trim().length > 0 ? override.name.trim() : (model.name ?? model.id),
        contextWindow: positiveInt(override.contextWindow) ?? template?.contextWindow,
        maxTokens: positiveInt(override.maxTokens) ?? template?.maxTokens,
        reasoning: chosen.length === 0
          ? undefined
          : { efforts: chosen.map(effort => ({ id: effort.id, name: effort.name })), ...defaultEffort === undefined ? {} : { defaultEffort } },
        efforts: chosen,
        inputModalities: input,
        availableEfforts: available,
        custom: stored.custom.some(entry => entry.id === model.id),
        visible: !hidden.has(model.id),
        overrides: override,
      }
    })
  }

  /**
   * Models the composer may offer.
   * @param channel - channel module.
   * @returns visible merged entries.
   */
  models(channel) {
    return this.catalogModels(channel).filter(entry => entry.visible)
  }

  /**
   * One model's effective metadata; hidden models stay resolvable so an open
   * conversation can finish after the user removes them from the list.
   * @param channel - channel module.
   * @param model - model id.
   * @returns metadata, or undefined when the channel does not know the model.
   */
  model(channel, model) {
    return this.catalogModels(channel).find(entry => entry.id === model)
  }

  /**
   * The wire value one selected reasoning level sends for a model.
   * @param channel - channel module.
   * @param model - model id.
   * @param level - effort id the request selected.
   * @returns the configured wire value, or undefined when the level is unknown.
   */
  effortWire(channel, model, level) {
    if (typeof level !== 'string' || level.length === 0) return undefined
    const entry = this.model(channel, model)
    const effort = entry?.efforts?.find(candidate => candidate.id === level)
    return typeof effort?.wire === 'string' && effort.wire.length > 0 ? effort.wire : undefined
  }

  /**
   * Add the models a user picked from a discovery result: hidden ones come
   * back, unknown ones become custom catalog entries.
   * @param channel - channel module.
   * @param ids - model ids to adopt.
   * @returns the updated catalog view with how many were created.
   */
  async adoptModels(channel, ids) {
    const stored = this.channelState(channel.id)
    const known = new Set(this.catalogModels(channel).map(entry => entry.id))
    const candidates = new Map(
      (Array.isArray(stored.discovered) && stored.discovered.length > 0 ? stored.discovered : channel.models)
        .map(model => [model.id, model]),
    )
    let added = 0
    for (const raw of Array.isArray(ids) ? ids : []) {
      const id = String(raw ?? '').trim()
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/u.test(id)) continue
      if (known.has(id)) {
        stored.deleted = stored.deleted.filter(entry => entry !== id)
        continue
      }
      stored.custom.push({ id, name: candidates.get(id)?.name ?? id })
      stored.deleted = stored.deleted.filter(entry => entry !== id)
      known.add(id)
      added += 1
    }
    await this.persistCatalog()
    this.announce(channel)
    return { ...this.channelCatalog(channel), adopted: added }
  }

  /**
   * Re-announce one route so the browser refreshes its model list after a
   * catalog edit or discovery. `replace` re-emits `llm/adapters-updated`.
   * @param channel - channel module.
   */
  announce(channel) {
    const handle = this.routes.get(channel.id)
    if (handle === undefined) return
    try {
      handle.replace([channel.route])
    } catch (_announceFailed) {
      // A disposed registration simply means the channel is signed out now.
    }
  }

  /** Persist the catalog document, keeping the in-memory copy authoritative. */
  async persistCatalog() {
    try {
      writeCatalog(this.catalogPath, this.catalog)
    } catch (error) {
      this.ctx.logger.warn('subscription-channels: cannot persist the model catalog: %s', String(error?.message ?? error))
    }
  }

  /**
   * The catalog one channel shows in its panel: only the models the composer
   * currently offers, because a removed row must disappear from the editor too.
   * @param channel - channel module.
   * @returns the visible catalog view.
   */
  channelCatalog(channel) {
    const stored = this.channelState(channel.id)
    const all = this.catalogModels(channel)
    const models = all.filter(entry => entry.visible)
    return {
      channel: channel.id,
      route: channel.route,
      name: this.label(channel),
      models,
      visibleCount: models.length,
      hiddenCount: all.length - models.length,
      discoveredAt: typeof stored.discoveredAt === 'number' ? stored.discoveredAt : undefined,
      discovered: Array.isArray(stored.discovered) && stored.discovered.length > 0,
      customized: Object.keys(stored.overrides).length > 0
        || stored.deleted.length > 0
        || stored.custom.length > 0
        || stored.order.length > 0,
    }
  }

  /**
   * Apply one edit to a model's catalog entry.
   * @param channel - channel module.
   * @param modelId - model to edit.
   * @param patch - visibility, name, capacity, reasoning levels, or input types.
   * @returns the updated catalog view.
   */
  async updateModel(channel, modelId, patch) {
    if (this.catalogModels(channel).every(entry => entry.id !== modelId)) {
      throw new Error(`unknown model "${String(modelId)}" for ${channel.id}`)
    }
    this.catalog.channels[channel.id] ??= { deleted: [], overrides: {}, discovered: [], custom: [], order: [] }
    const stored = this.channelState(channel.id)
    const isCustom = stored.custom.some(entry => entry.id === modelId)
    if (patch.visible === true) stored.deleted = stored.deleted.filter(id => id !== modelId)
    if (patch.visible === false) {
      if (isCustom) {
        stored.custom = stored.custom.filter(entry => entry.id !== modelId)
        stored.deleted = stored.deleted.filter(id => id !== modelId)
      } else if (!stored.deleted.includes(modelId)) {
        stored.deleted.push(modelId)
      }
    }
    const next = { ...(stored.overrides[modelId] ?? {}) }
    if ('name' in patch) {
      const name = typeof patch.name === 'string' ? patch.name.trim().slice(0, 120) : ''
      if (name.length === 0) delete next.name
      else next.name = name
    }
    if ('contextWindow' in patch) {
      const value = positiveInt(patch.contextWindow)
      if (value === undefined) delete next.contextWindow
      else next.contextWindow = value
    }
    if ('maxTokens' in patch) {
      const value = positiveInt(patch.maxTokens)
      if (value === undefined) delete next.maxTokens
      else next.maxTokens = value
    }
    if ('efforts' in patch) {
      const defaults = (channel.modelInfo?.(modelId)?.reasoning?.efforts ?? channel.reasoningEfforts ?? [])
        .map(effort => ({ id: effort.id, wire: typeof effort.wire === 'string' ? effort.wire : (channel.wireValue?.(effort.id) ?? effort.id) }))
      const list = Array.isArray(patch.efforts)
        ? patch.efforts
          .map(entry => typeof entry === 'string'
            ? { id: entry, wire: channel.wireValue?.(entry) ?? entry }
            : { id: String(entry?.id ?? '').trim(), wire: String(entry?.wire ?? '').trim() })
          .filter(entry => /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/u.test(entry.id) && entry.wire.length <= 120)
        : []
      const seen = new Set()
      const unique = list.filter((entry) => {
        if (seen.has(entry.id)) return false
        seen.add(entry.id)
        return true
      })
      const unchanged = unique.length === defaults.length
        && unique.every((entry, index) => entry.id === defaults[index].id && entry.wire === defaults[index].wire)
      if (unchanged) delete next.efforts
      else next.efforts = unique
    }
    if ('defaultEffort' in patch) {
      if (typeof patch.defaultEffort === 'string' && patch.defaultEffort.length > 0) next.defaultEffort = patch.defaultEffort
      else delete next.defaultEffort
    }
    if ('input' in patch) {
      const list = Array.isArray(patch.input) ? patch.input.filter(value => value === 'text' || value === 'image') : ['text']
      if (list.includes('image')) next.input = ['text', 'image']
      else delete next.input
    }
    stored.overrides[modelId] = next
    await this.persistCatalog()
    this.announce(channel)
    return this.channelCatalog(channel)
  }

  /**
   * Ask the channel for its available models and adopt them.
   * @param channel - channel module.
   * @param options - `restore` also clears every hidden model.
   * @returns the updated catalog view and how many models answered.
   */
  async discover(channel, options = {}) {
    const credential = await this.credential(channel, undefined)
    let models = []
    if (typeof channel.discoverModels === 'function' && credential !== undefined) {
      try {
        models = await channel.discoverModels(credential, this.config)
      } catch (error) {
        this.ctx.logger.info('subscription-channels: discovery for %s failed: %s', channel.id, String(error?.message ?? error))
      }
    }
    if (!Array.isArray(models) || models.length === 0) models = channel.models
    const stored = this.channelState(channel.id)
    stored.discovered = models.map(model => ({
      id: String(model.id),
      name: typeof model.name === 'string' ? model.name : String(model.id),
      ...positiveInt(model.contextWindow) === undefined ? {} : { contextWindow: positiveInt(model.contextWindow) },
      ...positiveInt(model.maxTokens) === undefined ? {} : { maxTokens: positiveInt(model.maxTokens) },
      ...typeof model.effort === 'string' ? { effort: model.effort } : {},
      ...typeof model.family === 'string' ? { family: model.family } : {},
    }))
    stored.discoveredAt = Date.now()
    // Discovery only refreshes the snapshot: a removed model comes back when the
    // user adopts it from the result list, not as a side effect of fetching.
    if (options.restore === true) stored.deleted = []
    await this.persistCatalog()
    this.announce(channel)
    return {
      ...this.channelCatalog(channel),
      discoveredModels: models.length,
      candidates: stored.discovered.map(model => ({ id: model.id, name: model.name ?? model.id })),
    }
  }

  /**
   * Persist the user's model order.
   * @param channel - channel module.
   * @param ids - model ids in display order.
   * @returns the updated catalog view.
   */
  async updateOrder(channel, ids) {
    const stored = this.channelState(channel.id)
    const known = new Set(this.catalogModels(channel).map(entry => entry.id))
    stored.order = (Array.isArray(ids) ? ids : []).filter(id => known.has(id))
    await this.persistCatalog()
    this.announce(channel)
    return this.channelCatalog(channel)
  }

  /**
   * Add a model the channel's own catalog does not describe.
   * @param channel - channel module.
   * @param id - upstream model id to send.
   * @param name - display name; the id is used when omitted.
   * @returns the updated catalog view.
   */
  async createModel(channel, id, name) {
    const modelId = String(id ?? '').trim()
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/u.test(modelId)) {
      throw new Error('a model id may contain letters, digits, dots, dashes, colons, and underscores')
    }
    if (this.catalogModels(channel).some(entry => entry.id === modelId)) {
      throw new Error(`model "${modelId}" is already in the catalog`)
    }
    const stored = this.channelState(channel.id)
    stored.custom.push({
      id: modelId,
      name: typeof name === 'string' && name.trim().length > 0 ? name.trim().slice(0, 120) : modelId,
    })
    stored.deleted = stored.deleted.filter(entry => entry !== modelId)
    await this.persistCatalog()
    this.announce(channel)
    return this.channelCatalog(channel)
  }

  /**
   * Drop every stored edit for one channel: order, overrides, custom models, and
   * hidden models all return to the channel's own catalog.
   * @param channel - channel module.
   * @returns the reset catalog view.
   */
  async resetCatalog(channel) {
    this.catalog.channels[channel.id] = { deleted: [], overrides: {}, discovered: [], custom: [], order: [] }
    await this.persistCatalog()
    this.announce(channel)
    return this.channelCatalog(channel)
  }

  /**
   * Probe one model with a minimal request and report why it failed.
   * @param channel - channel module.
   * @param modelId - model to probe.
   * @param signal - caller cancellation.
   * @returns the probe verdict.
   */
  async testModel(channel, modelId, signal) {
    const entry = this.model(channel, modelId)
    if (entry === undefined) {
      return { ok: false, code: 'UNKNOWN_MODEL', reason: message(this.config.lang, 'testMissing') }
    }
    let credential
    try {
      credential = await this.credential(channel, signal)
    } catch (error) {
      return { ok: false, code: 'INVALID_CREDENTIAL', detail: String(error?.message ?? error), reason: message(this.config.lang, 'testAuth') }
    }
    if (credential === undefined) {
      return { ok: false, code: 'INVALID_CREDENTIAL', reason: message(this.config.lang, 'testAuth') }
    }
    return probeModel({ channel, modelId, credential, config: this.config, lang: this.config.lang, signal })
  }

  /**
   * The per-request context a channel wiring may read.
   * @param _channel - channel module.
   * @returns the context object.
   */
  requestContext(_channel) {
    return { config: this.config }
  }

  /**
   * Resolve the images one request carries into base64, but only when the
   * target model declares image input; the harness strips them otherwise.
   * @param channel - channel module.
   * @param options - harness request.
   * @param signal - request cancellation.
   * @returns attachment id -> `{ mediaType, data }`, empty when nothing applies.
   */
  async imagesFor(channel, options, signal) {
    const resolved = new Map()
    const model = this.model(channel, options.model)
    if (model?.inputModalities?.includes('image') !== true) return resolved
    const attachments = this.ctx.get('attachments')
    if (attachments === undefined) return resolved
    for (const message of options.messages) {
      const blocks = Array.isArray(message.content) ? message.content : []
      for (const block of blocks) {
        if (block === null || typeof block !== 'object' || block.type !== 'image' || block.offloaded === true) continue
        const ref = block.attachment
        if (ref === undefined || resolved.has(ref.attachmentId)) continue
        try {
          const request = await attachments.readImageRequest(ref, {
            width: ref.width,
            height: ref.height,
            maxBytes: ref.bytes,
          }, signal)
          resolved.set(ref.attachmentId, {
            mediaType: request.mediaType,
            data: Buffer.from(request.data).toString('base64'),
          })
        } catch (_unreadableImage) {
          // An image that cannot be read is omitted; the text still travels.
        }
      }
    }
    return resolved
  }

  /** Start watching stored grants: register the routes they already unlock. */
  start() {
    this.registerFlows(this.ctx.get('authorization'))
    void this.syncRoutes()
  }

  /**
   * Register one authorization flow per channel, so sign-in also works from the
   * seams, not only from this plugin's own card. Re-registering for the same
   * service is a no-op: a second claim of one key would be refused.
   * @param authorization - the authorization service, when the composition has one.
   */
  registerFlows(authorization) {
    if (authorization === undefined || this.flowsFor === authorization) return
    this.flowsFor = authorization
    for (const channel of CHANNELS) {
      this.ctx.effect(() => authorization.registerFlow({
        key: recordKey(channel.id),
        label: this.label(channel),
        methods: [{ id: 'oauth', label: this.config.lang === 'en' ? 'Browser sign-in' : '浏览器登录' }],
        run: async (session) => {
          const previous = this.forceNewAccount.has(channel.id) ? undefined : await this.usableLink(channel)
          const payload = await channel.login({
            interaction: {
              notify: notice => { session.notify(notice) },
              prompt: prompt => session.prompt(prompt),
            },
            signal: session.signal,
            config: this.config,
            previous,
          })
          // Merge into the channel's credential set: one registration per issued
          // client id, and the fresh one becomes selected.
          const current = await readSet(this.ctx, channel.id)
          const key = accountKey(payload)
          const accounts = [
            ...current.accounts.filter(account => accountKey(account) !== key),
            { ...payload, savedAt: new Date().toISOString() },
          ]
          await session.commit({
            kind: 'grant',
            payload: { version: PAYLOAD_VERSION, accounts, selected: key },
          })
          this.registerRoute(channel)
        },
      }))
    }
  }

  /**
   * Read one channel's grant, rotating it when it is close to expiry.
   *
   * Concurrent callers for the same registration share one refresh attempt:
   * OpenAI rotates the refresh token, so two parallel refreshes would race and
   * the loser would persist a token the issuer already invalidated. The first
   * caller starts the exchange; everyone else awaits it and then uses the
   * rotated grant this call already wrote.
   * @param channel - channel module.
   * @param signal - request cancellation.
   * @returns the grant, or undefined when the channel is not signed in.
   */
  /**
   * Read the grant this channel can actually use.
   *
   * A grant written by a removed flow (the retired Codex route, or a foreign
   * record) is reported as signed out, so the Models page asks for a sign-in
   * instead of sending a request that cannot succeed.
   * @param channel - channel module.
   * @returns the usable grant, or undefined.
   */
  async usableLink(channel) {
    const link = await readLink(this.ctx, channel.id)
    if (link === undefined) return undefined
    if (channel.requiresFlow !== undefined && link.flow !== channel.requiresFlow) return undefined
    return link
  }

  async credential(channel, signal) {
    const link = await this.usableLink(channel)
    if (link === undefined) return undefined
    if (isFresh(link)) return link
    if (typeof link.refreshToken !== 'string' || link.refreshToken.length === 0) return link
    const key = `${channel.id}:${accountKey(link)}`
    let pending = this.refreshing.get(key)
    if (pending === undefined) {
      pending = (async () => {
        try {
          // Another process may have rotated the grant while this one waited.
          const current = await this.usableLink(channel)
          const base = current !== undefined && accountKey(current) === accountKey(link) ? current : link
          if (isFresh(base)) return base
          const next = await channel.refresh(base, this.config)
          await writeLink(this.ctx, channel.id, next)
          return { ...next, version: PAYLOAD_VERSION }
        } finally {
          this.refreshing.delete(key)
        }
      })()
      this.refreshing.set(key, pending)
    }
    try {
      const next = await pending
      if (signal?.aborted === true) return next
      return next
    } catch (error) {
      await this.dropRoute(channel)
      throw error
    }
  }

  /**
   * Forget a channel's grant after the provider rejected it.
   * @param channel - channel module.
   */
  invalidate(channel) {
    void this.dropRoute(channel)
    void clearLink(this.ctx, channel.id).catch(() => {})
  }

  /**
   * Refresh the stored discovery snapshot for a linked channel. The static
   * catalog stays authoritative when the account cannot answer.
   * @param channel - channel module.
   */
  async refreshModels(channel) {
    if (typeof channel.discoverModels !== 'function') return
    try {
      const link = await readLink(this.ctx, channel.id)
      if (link === undefined) return
      const models = await channel.discoverModels(link, this.config)
      if (!Array.isArray(models) || models.length === 0) return
      const stored = this.catalog.channels[channel.id] ?? { deleted: [], overrides: {}, discovered: [], custom: [], order: [] }
      stored.discovered = models.map(model => ({
        id: String(model.id),
        name: typeof model.name === 'string' ? model.name : String(model.id),
        ...positiveInt(model.contextWindow) === undefined ? {} : { contextWindow: positiveInt(model.contextWindow) },
        ...positiveInt(model.maxTokens) === undefined ? {} : { maxTokens: positiveInt(model.maxTokens) },
        ...typeof model.effort === 'string' ? { effort: model.effort } : {},
        ...typeof model.family === 'string' ? { family: model.family } : {},
      }))
      stored.discoveredAt = Date.now()
      this.catalog.channels[channel.id] = stored
      await this.persistCatalog()
    } catch (_discoveryFailed) {
      // Keep the previous snapshot when discovery cannot answer.
    }
  }

  /** Register the LLM route one linked channel owns. */
  registerRoute(channel) {
    if (this.routes.has(channel.id)) return
    try {
      const handle = this.llm.registerAdapter([channel.route], this.adapter)
      this.routes.set(channel.id, handle)
      void this.refreshModels(channel)
    } catch (error) {
      this.ctx.logger.warn('subscription-channels: cannot register route %s: %s', channel.route, String(error?.message ?? error))
    }
  }

  /** Withdraw one channel's LLM route. */
  async dropRoute(channel) {
    const handle = this.routes.get(channel.id)
    if (handle === undefined) return
    this.routes.delete(channel.id)
    try {
      handle()
    } catch (_alreadyDisposed) {
      /* idempotent */
    }
  }

  /**
   * Bring route registration in line with the stored grants.
   *
   * Called at startup, when the credential store first appears, and on every
   * committed record change, so a sign-in performed elsewhere (another window,
   * a seeded store) still publishes its route. Concurrent calls collapse into
   * one pass plus a queued re-run.
   */
  async syncRoutes() {
    if (this.syncing !== undefined) {
      this.syncQueued = true
      return this.syncing
    }
    this.syncing = (async () => {
      for (const channel of CHANNELS) {
        const link = await this.usableLink(channel)
        if (link === undefined) await this.dropRoute(channel)
        else this.registerRoute(channel)
      }
    })()
    try {
      await this.syncing
    } finally {
      this.syncing = undefined
      if (this.syncQueued === true) {
        this.syncQueued = false
        await this.syncRoutes()
      }
    }
  }

  /**
   * What the Models page shows for every channel.
   * @returns channel views.
   */
  async state() {
    const channels = []
    for (const channel of CHANNELS) {
      const set = await readSet(this.ctx, channel.id)
      const link = await this.usableLink(channel)
      channels.push({
        id: channel.id,
        route: channel.route,
        name: this.label(channel),
        linked: link !== undefined,
        // `expired` is the only state that needs a new sign-in: the access
        // token is gone and no refresh token can replace it.
        status: link === undefined
          ? undefined
          : isFresh(link)
            ? 'linked'
            : typeof link.refreshToken === 'string' && link.refreshToken.length > 0 ? 'expiring' : 'expired',
        account: typeof link?.account === 'string' ? link.account : undefined,
        accounts: set.accounts.filter(account => channel.requiresFlow === undefined || account.flow === channel.requiresFlow).map(account => ({
          key: accountKey(account),
          name: accountName(account),
          clientPrefix: accountKey(account) === 'default' ? undefined : accountKey(account).slice(0, 12),
          email: typeof account.account === 'string' ? account.account : undefined,
          subject: typeof account.subject === 'string' ? account.subject : undefined,
          linked: hasTokens(account),
          selected: accountKey(account) === set.selected,
        })),
        modelCount: this.models(channel).length,
        hiddenCount: this.catalogModels(channel).length - this.models(channel).length,
        expiresAt: typeof link?.expiresAt === 'number' ? link.expiresAt : undefined,
      })
    }
    return { channels }
  }

  /**
   * Begin one browser sign-in.
   * @param channelId - which channel.
   * @param options - `newAccount` registers a client instead of reusing the saved one.
   * @returns `{ status }` when already settled, else the attempt id to poll.
   */
  login(channelId, options = {}) {
    const channel = CHANNEL_BY_ID.get(channelId)
    if (channel === undefined) throw new Error(`unknown subscription channel "${String(channelId)}"`)
    const running = this.active.get(channel.id)
    if (running !== undefined) return { status: 'pending', attemptId: running.id }
    if (options.newAccount === true) this.forceNewAccount.add(channel.id)
    const attempt = {
      id: randomUUID(),
      channelId: channel.id,
      status: 'pending',
      notices: [],
      prompt: undefined,
      error: undefined,
      cancelled: false,
      newAccount: options.newAccount === true,
      controller: new AbortController(),
      createdAt: Date.now(),
    }
    this.attempts.set(attempt.id, attempt)
    this.active.set(channel.id, attempt)
    void this.runAttempt(attempt, channel)
    return { status: 'pending', attemptId: attempt.id }
  }

  /**
   * Run one attempt to completion in the background.
   * @param attempt - the attempt record.
   * @param channel - channel module.
   */
  async runAttempt(attempt, channel) {
    const interaction = {
      notify: (notice) => {
        attempt.notices.push({
          message: String(notice?.message ?? ''),
          ...(typeof notice?.url === 'string' ? { url: notice.url } : {}),
          ...(typeof notice?.code === 'string' ? { code: notice.code } : {}),
        })
        if (attempt.notices.length > 40) attempt.notices.shift()
      },
      prompt: prompt => new Promise((resolve, reject) => {
        attempt.prompt = {
          kind: prompt.kind,
          message: prompt.message,
          placeholder: prompt.placeholder,
          resolve: (value) => {
            attempt.prompt = undefined
            resolve(value)
          },
          reject,
        }
      }),
    }
    const timer = setTimeout(() => {
      attempt.timedOut = true
      interaction.notify({ message: message(this.config.lang, 'timedOut') })
      attempt.controller.abort()
      if (attempt.prompt !== undefined) {
        attempt.prompt.reject(new Error('timed out'))
        attempt.prompt = undefined
      }
    }, this.config.loginTimeoutMs)
    try {
      const payload = await this.authorize(channel, interaction, attempt.controller.signal, { newAccount: attempt.newAccount === true })
      await writeLink(this.ctx, channel.id, payload)
      this.registerRoute(channel)
      attempt.status = 'authorized'
      interaction.notify({ message: message(this.config.lang, 'succeeded') })
    } catch (error) {
      if (attempt.timedOut === true) {
        attempt.status = 'failed'
        attempt.error = message(this.config.lang, 'timedOut')
      } else if (attempt.cancelled || attempt.controller.signal.aborted) {
        attempt.status = 'cancelled'
      } else {
        attempt.status = 'failed'
        attempt.error = String(error?.message ?? error)
      }
    } finally {
      clearTimeout(timer)
      if (attempt.prompt !== undefined) {
        attempt.prompt.reject(new Error('the sign-in attempt finished'))
        attempt.prompt = undefined
      }
      this.active.delete(channel.id)
      const retention = setTimeout(() => this.attempts.delete(attempt.id), ATTEMPT_RETENTION_MS)
      retention.unref?.()
    }
  }

  /**
   * Obtain a grant, through the authorization seam when the composition has one
   * and directly otherwise.
   * @param channel - channel module.
   * @param interaction - how notices and questions reach the human.
   * @param signal - cancellation.
   * @returns the grant payload.
   */
  async authorize(channel, interaction, signal, options = {}) {
    const authorization = this.ctx.get('authorization')
    const previous = options.newAccount === true ? undefined : await this.usableLink(channel)
    if (authorization === undefined) {
      return channel.login({
        interaction,
        signal,
        config: this.config,
        previous,
      })
    }
    const outcome = await authorization.begin({
      key: recordKey(channel.id),
      method: 'oauth',
      interaction,
      signal,
    })
    if (outcome.status !== 'authorized') throw new Error('the sign-in was cancelled')
    const stored = await readLink(this.ctx, channel.id)
    if (stored === undefined) throw new Error('the sign-in finished without storing a credential')
    return stored
  }

  /**
   * One attempt's current state, for the browser's poll.
   * @param id - attempt id.
   * @returns the view, or undefined when the attempt is gone.
   */
  attempt(id) {
    const attempt = this.attempts.get(id)
    if (attempt === undefined) return undefined
    return {
      status: attempt.status,
      error: attempt.error,
      notices: attempt.notices,
      prompt: attempt.prompt === undefined
        ? undefined
        : { kind: attempt.prompt.kind, message: attempt.prompt.message, placeholder: attempt.prompt.placeholder },
      channel: attempt.channelId,
    }
  }

  /**
   * Answer the question an attempt is waiting on.
   * @param id - attempt id.
   * @param value - the answer.
   * @returns whether a question was waiting.
   */
  answer(id, value) {
    const attempt = this.attempts.get(id)
    if (attempt === undefined || attempt.prompt === undefined) return false
    attempt.prompt.resolve(String(value ?? ''))
    return true
  }

  /**
   * Withdraw one attempt.
   * @param id - attempt id.
   * @returns whether an attempt was withdrawn.
   */
  cancel(id) {
    const attempt = this.attempts.get(id)
    if (attempt === undefined) return false
    attempt.cancelled = true
    attempt.controller.abort()
    if (attempt.prompt !== undefined) {
      attempt.prompt.reject(new Error('cancelled'))
      attempt.prompt = undefined
    }
    return true
  }

  /**
   * Delete one channel's grant and withdraw its models.
   * @param channelId - which channel.
   */
  async logout(channelId) {
    const channel = CHANNEL_BY_ID.get(channelId)
    if (channel === undefined) throw new Error(`unknown subscription channel "${String(channelId)}"`)
    const running = this.active.get(channel.id)
    if (running !== undefined) this.cancel(running.id)
    const link = await readLink(this.ctx, channel.id)
    if (link !== undefined && typeof channel.revoke === 'function') {
      try {
        await channel.revoke(link, this.config)
      } catch (error) {
        // Local credentials are still removed; the log records the unconfirmed
        // remote revocation so the user can disconnect the app in ChatGPT.
        this.ctx.logger.info('subscription-channels: revocation for %s failed: %s', channel.id, String(error?.message ?? error))
      }
    }
    // A Sign in with ChatGPT registration keeps its issued client id and identity
    // so the same account can be reauthorized; catalog edits stay user preferences.
    await clearLink(this.ctx, channel.id, { keepRegistrations: link?.flow === 'siwc' })
    await this.dropRoute(channel)
    await this.persistCatalog()
  }

  /**
   * End one registration, leaving other accounts and the host identity in place.
   * @param channelId - which channel.
   * @param key - the registration's storage key.
   * @returns the refreshed channel state.
   */
  async logoutAccount(channelId, key) {
    const channel = CHANNEL_BY_ID.get(channelId)
    if (channel === undefined) throw new Error(`unknown subscription channel "${String(channelId)}"`)
    const set = await readSet(this.ctx, channel.id)
    const account = set.accounts.find(entry => accountKey(entry) === String(key))
    if (account === undefined) throw new Error('unknown account')
    if (typeof channel.revoke === 'function' && hasTokens(account)) {
      try {
        await channel.revoke(account, this.config)
      } catch (error) {
        this.ctx.logger.info('subscription-channels: revocation for %s failed: %s', accountKey(account), String(error?.message ?? error))
      }
    }
    const accounts = await clearAccount(this.ctx, channel.id, accountKey(account))
    if (accounts.some(hasTokens)) this.registerRoute(channel)
    else await this.dropRoute(channel)
    this.announce(channel)
    return this.state()
  }

  /**
   * Make one saved registration the active one.
   * @param channelId - which channel.
   * @param key - the registration's storage key (issued client id).
   * @returns the refreshed channel state.
   */
  async selectAccount(channelId, key) {
    const channel = CHANNEL_BY_ID.get(channelId)
    if (channel === undefined) throw new Error(`unknown subscription channel "${String(channelId)}"`)
    const account = await selectAccount(this.ctx, channel.id, String(key ?? ''))
    if (account === undefined) throw new Error('that account has no usable tokens; sign in again')
    this.registerRoute(channel)
    this.announce(channel)
    return this.state()
  }

  /** Stop every running attempt; called when the plugin unloads. */
  dispose() {
    for (const attempt of this.attempts.values()) {
      attempt.cancelled = true
      attempt.controller.abort()
    }
    this.attempts.clear()
    this.active.clear()
    this.routes.clear()
  }
}


























