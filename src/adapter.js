/**
 * One LLM adapter serving every subscription provider instance.
 *
 * Each ChatGPT registration is its own provider route, so the composer shows
 * one group per account and switching groups never mixes two accounts' models.
 * The adapter is deliberately duck-typed: a profile-installed bundle cannot
 * import `@deepseek-ai/dsh-llm`, so it implements the documented surface
 * (`providerInfo`, `listModels`, `resolveModel`, `prepareCall`, `stream`) with
 * plain objects that satisfy the same shapes.
 */

/** Failure codes the harness retry policy understands. */
const INVALID_CREDENTIAL = 'INVALID_CREDENTIAL'
const RATE_LIMIT = 'RATE_LIMIT'
const QUOTA = 'QUOTA'
const PROVIDER_ERROR = 'PROVIDER_ERROR'
const STREAM_CLOSED = 'STREAM_CLOSED'

/**
 * Classify one provider HTTP failure.
 * @param status - HTTP status.
 * @param body - decoded provider error body, if any.
 * @returns the harness failure object.
 */
export function providerFailure(status, body) {
  const message = errorMessage(body) ?? `provider responded ${status}`
  if (status === 401 || status === 403) return { message, code: INVALID_CREDENTIAL, status }
  if (status === 429) {
    const quota = /quota|exceeded|limit reached|credits/iu.test(message)
    return { message, code: quota ? QUOTA : RATE_LIMIT, status }
  }
  if (status === 503) return { message, code: PROVIDER_ERROR, status, retryable: true }
  return { message, code: PROVIDER_ERROR, status }
}

/**
 * Whether an error means the transport closed under us rather than the
 * provider rejecting the request.
 * @param error - thrown value.
 * @returns true for socket/stream failures.
 */
function isNetworkError(error) {
  if (error === null || typeof error !== 'object') return false
  const message = String(error.message ?? '')
  return /terminated|ECONNRESET|ECONNABORTED|EPIPE|socket|other side closed|fetch failed|network/iu.test(message)
}

/**
 * Map a provider stream error code onto the harness failure vocabulary.
 * @param code - provider code, if any.
 * @returns the harness code.
 */
function classifyStreamCode(code) {
  const text = String(code ?? '')
  if (/rate.?limit/iu.test(text)) return RATE_LIMIT
  if (/quota|usage_limit|credits|exceeded/iu.test(text)) return QUOTA
  if (/invalid.*credential|unauthor|forbidden/iu.test(text)) return INVALID_CREDENTIAL
  return PROVIDER_ERROR
}

/**
 * Emit one safe diagnostic line: status, request id, event types, timing.
 * Never includes prompts, completions, or tokens.
 * @param service - owning service.
 * @param details - provider, model, outcome, and counters.
 */
function logStream(service, details) {
  const logger = service.ctx?.logger
  if (logger === undefined) return
  const line = 'subscription stream ' + details.provider + ' ' + details.outcome
    + ' status=' + details.status
    + ' requestId=' + (details.requestId ?? '-')
    + ' events=' + details.events
    + ' elapsed=' + details.elapsed + 'ms'
  if (details.outcome === 'ok') logger.debug?.(line)
  else logger.info?.(line)
}

function errorMessage(body) {
  if (body === null || typeof body !== 'object') return undefined
  const error = body.error
  if (typeof error === 'string') return error
  if (error !== null && typeof error === 'object' && typeof error.message === 'string') return error.message
  if (typeof body.message === 'string') return body.message
  if (typeof body.raw === 'string' && body.raw.length > 0) return body.raw.slice(0, 400)
  return undefined
}

export class SubscriptionAdapter {
  /**
   * @param service - the subscription service owning credentials and instances.
   */
  constructor(service) {
    this.service = service
  }

  /** Resolve the provider instance a route belongs to. */
  instance(provider) {
    return this.service.instancesByRoute.get(provider)
  }

  /** Describe one provider route; the name is the account's own label. */
  providerInfo(provider) {
    const instance = this.instance(provider)
    return { id: provider, name: instance === undefined ? provider : this.service.label(instance) }
  }

  /** No provider-owned retry policy: the harness normal defaults apply. */
  providerRetryPolicy() {
    return undefined
  }

  /** Subscription channels are billed by the account, not per image request. */
  imageRequestPricing() {
    return undefined
  }

  /** Pass normalized image dimensions through unchanged. */
  imageRequestTarget(_provider, _model, image) {
    return { width: image.width, height: image.height, maxBytes: image.bytes }
  }

  /** Advertise one account's visible models. */
  async listModels(provider) {
    const instance = this.instance(provider)
    if (instance === undefined) return []
    return this.service.models(instance).map(model => ({
      provider,
      id: model.id,
      name: model.name,
      inputModalities: model.inputModalities,
    }))
  }

  /** Resolve one model's capacity, reasoning levels, and input types. */
  async resolveModel(provider, model) {
    const instance = this.instance(provider)
    const entry = instance === undefined ? undefined : this.service.model(instance, model)
    const base = { provider, id: model, name: entry?.name ?? model, inputModalities: entry?.inputModalities ?? ['text'] }
    if (entry === undefined) return base
    return {
      ...base,
      ...entry.contextWindow === undefined ? {} : { context: { contextWindow: entry.contextWindow } },
      ...entry.maxTokens === undefined ? {} : { defaultMaxTokens: entry.maxTokens },
      ...entry.reasoning === undefined ? {} : { reasoning: entry.reasoning },
    }
  }

  /** Bind this generation's model metadata to the dispatch. */
  async prepareCall(provider, model, signal) {
    const resolved = await this.resolveModel(provider, model, signal)
    return { model: resolved, stream: options => this.stream(options) }
  }

  /**
   * Stream one request through its provider instance.
   * @param options - the harness request.
   * @returns chunks ending in exactly one terminal `finish`.
   */
  async *stream(options) {
    const instance = this.instance(options.provider)
    if (instance === undefined) {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: `unknown subscription route ${options.provider}`, code: PROVIDER_ERROR } } }
      return
    }
    const channel = instance.channel
    let credential
    try {
      credential = await this.service.credential(instance, options.signal)
    } catch (error) {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: String(error?.message ?? error), code: INVALID_CREDENTIAL } } }
      return
    }
    if (credential === undefined) {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: `${this.service.label(instance)} is not signed in`, code: INVALID_CREDENTIAL } } }
      return
    }
    let images
    try {
      images = await this.service.imagesFor(instance, options, options.signal)
    } catch (_imagesUnavailable) {
      images = new Map()
    }
    let response
    try {
      const request = channel.buildRequest(options, credential, {
        ...this.service.requestContext(channel),
        images,
        wireEffort: this.service.effortWire(instance, options.model, options.reasoningEffort),
      })
      response = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: options.signal,
      })
    } catch (error) {
      if (options.signal?.aborted === true) {
        yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'aborted', code: 'ABORTED' } } }
        return
      }
      yield { type: 'finish', reason: { kind: 'error', failure: { message: String(error?.message ?? error), code: PROVIDER_ERROR } } }
      return
    }
    if (!response.ok) {
      let body
      try {
        const text = await response.text()
        try {
          body = JSON.parse(text)
        } catch (_notJson) {
          body = { raw: text.slice(0, 600) }
        }
      } catch (_unreadableBody) {
        body = undefined
      }
      const failure = providerFailure(response.status, body)
      if (failure.code === INVALID_CREDENTIAL) await this.service.invalidate(instance)
      yield { type: 'finish', reason: { kind: 'error', failure } }
      return
    }
    let finished = false
    const startedAt = Date.now()
    const diagnostics = {
      events: new Set(),
      requestId: response.headers.get('x-oai-request-id') ?? response.headers.get('openai-request-id') ?? undefined,
    }
    const diagnostic = outcome => logStream(this.service, {
      provider: options.provider,
      model: options.model,
      outcome,
      status: response.status,
      requestId: diagnostics.requestId,
      events: diagnostics.events.size,
      elapsed: Date.now() - startedAt,
    })
    try {
      for await (const chunk of channel.parseStream(response, options, diagnostics)) {
        if (finished) break
        if (chunk.type === 'finish') finished = true
        yield chunk
      }
    } catch (error) {
      // A terminal chunk already went out; never emit a second finish.
      if (finished) return
      if (options.signal?.aborted === true || error?.name === 'AbortError') {
        diagnostic('aborted')
        const reason = options.signal?.reason
        const message = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : 'aborted'
        yield { type: 'finish', reason: { kind: 'aborted', failure: { message, code: 'ABORTED' } } }
        return
      }
      if (error?.name === 'StreamClosedError') {
        diagnostic('truncated')
        yield { type: 'finish', reason: { kind: 'error', failure: { message: String(error.message), code: STREAM_CLOSED } } }
        return
      }
      if (error?.name === 'ProviderStreamError') {
        diagnostic('provider-error')
        const code = classifyStreamCode(error.code)
        const suffix = error.requestId === undefined ? '' : ` (request ${error.requestId})`
        const param = error.param === undefined ? '' : ` param=${error.param}`
        yield {
          type: 'finish',
          reason: { kind: 'error', failure: { message: `${error.code}: ${error.message}${param}${suffix}`, code } },
        }
        return
      }
      if (isNetworkError(error)) {
        diagnostic('network')
        yield { type: 'finish', reason: { kind: 'error', failure: { message: `network: ${String(error?.message ?? error)}`, code: 'NETWORK' } } }
        return
      }
      diagnostic('error')
      yield { type: 'finish', reason: { kind: 'error', failure: { message: String(error?.message ?? error), code: PROVIDER_ERROR } } }
      return
    }
    if (!finished) {
      diagnostic('truncated')
      yield { type: 'finish', reason: { kind: 'error', failure: { message: 'stream ended without a stop reason', code: STREAM_CLOSED } } }
      return
    }
    diagnostic('ok')
  }
}


