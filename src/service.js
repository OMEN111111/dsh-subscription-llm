/**
 * The subscription service: stored grants, in-flight sign-ins, and the LLM
 * routes each linked channel owns.
 */
import { randomUUID } from 'node:crypto'
import { CHANNELS, CHANNEL_BY_ID } from './channels/index.js'
import { SubscriptionAdapter } from './adapter.js'
import { readLink, writeLink, clearLink, isFresh, recordKey, PAYLOAD_VERSION } from './store.js'
import { message } from './copy.js'

/** How long a settled attempt stays readable by the browser. */
const ATTEMPT_RETENTION_MS = 5 * 60 * 1000

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
    /** channel id -> adapter registration handle */
    this.routes = new Map()
    /** channel id -> model list discovered from the account */
    this.discovered = new Map()
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
   * Models one channel advertises: account discovery when it answered,
   * otherwise the module's static catalog.
   * @param channel - channel module.
   * @returns model entries.
   */
  models(channel) {
    return this.discovered.get(channel.id) ?? channel.models
  }

  /**
   * One model's metadata, including its reasoning levels.
   * @param channel - channel module.
   * @param model - model id.
   * @returns metadata, or undefined when the model is not advertised.
   */
  model(channel, model) {
    const entry = channel.modelInfo?.(model)
    if (entry !== undefined) return entry
    const known = this.models(channel).find(candidate => candidate.id === model)
    return known
  }

  /**
   * The per-request context a channel wiring may read.
   * @param _channel - channel module.
   * @returns the context object.
   */
  requestContext(_channel) {
    return { config: this.config }
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
          const payload = await channel.login({
            interaction: {
              notify: notice => { session.notify(notice) },
              prompt: prompt => session.prompt(prompt),
            },
            signal: session.signal,
            config: this.config,
          })
          await session.commit({ kind: 'grant', payload: { ...payload, version: PAYLOAD_VERSION } })
          this.registerRoute(channel)
        },
      }))
    }
  }

  /**
   * Read one channel's grant, rotating it when it is close to expiry.
   * @param channel - channel module.
   * @param signal - request cancellation.
   * @returns the grant, or undefined when the channel is not signed in.
   */
  async credential(channel, signal) {
    const link = await readLink(this.ctx, channel.id)
    if (link === undefined) return undefined
    if (isFresh(link)) return link
    if (typeof link.refreshToken !== 'string' || link.refreshToken.length === 0) return link
    try {
      const next = await channel.refresh(link, this.config)
      if (signal?.aborted === true) return next
      await writeLink(this.ctx, channel.id, next)
      return { ...next, version: PAYLOAD_VERSION }
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
   * Advertise the models the linked account can actually use.
   * @param channel - channel module.
   */
  async refreshModels(channel) {
    if (typeof channel.discoverModels !== 'function') return
    try {
      const link = await readLink(this.ctx, channel.id)
      if (link === undefined) return
      const models = await channel.discoverModels(link, this.config)
      if (Array.isArray(models) && models.length > 0) this.discovered.set(channel.id, models)
    } catch (_discoveryFailed) {
      // The static catalog stays authoritative when discovery cannot answer.
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
        const link = await readLink(this.ctx, channel.id)
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
      const link = await readLink(this.ctx, channel.id)
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
        modelCount: this.models(channel).length,
        expiresAt: typeof link?.expiresAt === 'number' ? link.expiresAt : undefined,
      })
    }
    return { channels }
  }

  /**
   * Begin one browser sign-in.
   * @param channelId - which channel.
   * @returns `{ status }` when already settled, else the attempt id to poll.
   */
  login(channelId) {
    const channel = CHANNEL_BY_ID.get(channelId)
    if (channel === undefined) throw new Error(`unknown subscription channel "${String(channelId)}"`)
    const running = this.active.get(channel.id)
    if (running !== undefined) return { status: 'pending', attemptId: running.id }
    const attempt = {
      id: randomUUID(),
      channelId: channel.id,
      status: 'pending',
      notices: [],
      prompt: undefined,
      error: undefined,
      cancelled: false,
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
      const payload = await this.authorize(channel, interaction, attempt.controller.signal)
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
  async authorize(channel, interaction, signal) {
    const authorization = this.ctx.get('authorization')
    if (authorization === undefined) {
      return channel.login({ interaction, signal, config: this.config })
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
    await clearLink(this.ctx, channel.id)
    await this.dropRoute(channel)
    this.discovered.delete(channel.id)
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






