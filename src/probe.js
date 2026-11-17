/** What a sign-in attempt or a catalog edit reports, and how a probe is judged. */
import { sseJson } from './oauth.js'
import { providerFailure } from './adapter.js'
import { message } from './copy.js'

/** A probe gives up after this long, so one dead model cannot block the panel. */
const PROBE_TIMEOUT_MS = 25_000

/** Frames read from a successful stream before the probe calls it healthy. */
const PROBE_FRAMES = 3

/**
 * Probe one model with a minimal real request.
 * @param request - channel wiring, credential, and the model to test.
 * @returns a verdict; `ok` is true only when the provider streamed content.
 */
export async function probeModel(request) {
  const { channel, modelId, credential, config, lang, signal } = request
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  const forward = () => controller.abort()
  if (signal !== undefined) {
    if (signal.aborted === true) controller.abort()
    else signal.addEventListener('abort', forward, { once: true })
  }
  const stopForward = () => {
    if (signal !== undefined) signal.removeEventListener('abort', forward)
  }
  try {
    const options = {
      provider: channel.route,
      model: modelId,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
      maxTokens: 16,
    }
    const built = channel.buildRequest(options, credential, { config, images: new Map() })
    const response = await fetch(built.url, {
      method: 'POST',
      headers: built.headers,
      body: JSON.stringify(built.body),
      signal: controller.signal,
    })
    const latencyMs = Date.now() - started
    if (!response.ok) {
      let body
      try {
        body = await response.json()
      } catch (_notJson) {
        body = undefined
      }
      const failure = providerFailure(response.status, body)
      return {
        ok: false,
        status: response.status,
        latencyMs,
        code: failure.code,
        detail: failure.message,
        reason: message(lang, reasonKeyFor(failure.code, response.status)),
      }
    }
    const failure = await firstStreamFailure(response)
    if (failure !== undefined) {
      return {
        ok: false,
        status: response.status,
        latencyMs,
        code: 'PROVIDER_ERROR',
        detail: failure,
        reason: message(lang, 'testRejected'),
      }
    }
    return { ok: true, status: response.status, latencyMs, reason: message(lang, 'testOk') }
  } catch (error) {
    const latencyMs = Date.now() - started
    if (signal?.aborted === true) return { ok: false, latencyMs, code: 'ABORTED', reason: message(lang, 'testCancelled') }
    if (controller.signal.aborted) return { ok: false, latencyMs, code: 'TIMEOUT', reason: message(lang, 'testTimeout') }
    return {
      ok: false,
      latencyMs,
      code: 'NETWORK',
      detail: String(error?.message ?? error),
      reason: message(lang, 'testNetwork'),
    }
  } finally {
    clearTimeout(timer)
    stopForward()
  }
}

/**
 * Read the first frames of an accepted stream and report an in-band failure.
 * @param response - provider response.
 * @returns the provider's failure text, or undefined when the stream started.
 */
async function firstStreamFailure(response) {
  let seen = 0
  try {
    for await (const event of sseJson(response)) {
      seen += 1
      if (event.type === 'error') return String(event.message ?? event.error?.message ?? event.code ?? 'error')
      if (event.type === 'response.failed') {
        return String(event.response?.error?.message ?? 'the provider failed the response')
      }
      if (seen >= PROBE_FRAMES) return undefined
    }
  } catch (error) {
    return String(error?.message ?? error)
  }
  return seen === 0 ? 'the provider returned an empty stream' : undefined
}

/**
 * Pick the catalog reason for one provider failure.
 * @param code - harness failure code.
 * @param status - HTTP status.
 * @returns a copy key.
 */
function reasonKeyFor(code, status) {
  if (code === 'INVALID_CREDENTIAL') return 'testAuth'
  if (code === 'QUOTA') return 'testQuota'
  if (code === 'RATE_LIMIT') return 'testRate'
  if (status === 404) return 'testMissing'
  if (status >= 500) return 'testServer'
  return 'testRejected'
}
