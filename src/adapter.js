/**
 * One LLM adapter serving every linked subscription route.
 *
 * The adapter is deliberately duck-typed: a profile-installed bundle cannot
 * import `@deepseek-ai/dsh-llm`, so it implements the documented surface
 * (`providerInfo`, `listModels`, `resolveModel`, `stream`) with plain objects
 * that satisfy the same shapes.
 */
import { CHANNEL_BY_ROUTE } from './channels/index.js'

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
  return { message, code: PROVIDER_ERROR, status }
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
   * @param service - the subscription service owning credentials and channels.
   */
  constructor(service) {
    this.service = service
  }

  /** Describe one linked route. */
  providerInfo(provider) {
    const channel = CHANNEL_BY_ROUTE.get(provider)
    return { id: provider, name: channel === undefined ? provider : this.service.label(channel) }
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

  /** Advertise the channel's visible models for one route. */
  async listModels(provider) {
    const channel = CHANNEL_BY_ROUTE.get(provider)
    if (channel === undefined) return []
    return this.service.models(channel).map(model => ({
      provider,
      id: model.id,
      name: model.name,
      inputModalities: model.inputModalities,
    }))
  }

  /** Resolve one channel model's capacity, reasoning levels, and input types. */
  async resolveModel(provider, model) {
    const channel = CHANNEL_BY_ROUTE.get(provider)
    const entry = channel === undefined ? undefined : this.service.model(channel, model)
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
   * Stream one request through its channel.
   * @param options - the harness request.
   * @returns chunks ending in exactly one terminal `finish`.
   */
  async *stream(options) {
    const channel = CHANNEL_BY_ROUTE.get(options.provider)
    if (channel === undefined) {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: `unknown subscription route ${options.provider}`, code: PROVIDER_ERROR } } }
      return
    }
    let credential
    try {
      credential = await this.service.credential(channel, options.signal)
    } catch (error) {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: String(error?.message ?? error), code: INVALID_CREDENTIAL } } }
      return
    }
    if (credential === undefined) {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: `${this.service.label(channel)} is not signed in`, code: INVALID_CREDENTIAL } } }
      return
    }
    let images
    try {
      images = await this.service.imagesFor(channel, options, options.signal)
    } catch (_imagesUnavailable) {
      images = new Map()
    }
    let response
    try {
      const request = channel.buildRequest(options, credential, { ...this.service.requestContext(channel), images })
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
      if (failure.code === INVALID_CREDENTIAL) this.service.invalidate(channel)
      yield { type: 'finish', reason: { kind: 'error', failure } }
      return
    }
    let finished = false
    try {
      for await (const chunk of channel.parseStream(response, options)) {
        if (chunk.type === 'finish') finished = true
        yield chunk
      }
    } catch (error) {
      if (options.signal?.aborted === true) {
        yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'aborted', code: 'ABORTED' } } }
        return
      }
      yield { type: 'finish', reason: { kind: 'error', failure: { message: String(error?.message ?? error), code: STREAM_CLOSED } } }
      return
    }
    if (!finished) {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: 'stream ended without a stop reason', code: STREAM_CLOSED } } }
    }
  }
}


