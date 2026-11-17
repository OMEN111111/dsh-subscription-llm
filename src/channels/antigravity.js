/**
 * Google Antigravity channel: Google-account OAuth against the Antigravity
 * client, then Cloud Code Assist's wrapped `streamGenerateContent`.
 *
 * These endpoints belong to Google's own Antigravity client rather than a
 * public API, so every value this module depends on can be overridden from the
 * plugin Config (client id/secret, host, model ids).
 */
import { randomUUID } from 'node:crypto'
import { createPkce, randomState, expiresAt, startLoopback, openBrowser, postForm, sseJson } from '../oauth.js'
import { waitForCode } from '../login.js'
import { message } from '../copy.js'
import { blockText, conversation, instructionText, declaredTools, geminiSchema, toolArguments } from '../convert.js'

const CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com'
/**
 * Google's OAuth client secret for the Antigravity client is deliberately not
 * shipped here: it is an installed-application secret that belongs to that
 * client, and repository secret scanning refuses to publish it. Supply it
 * through `config.googleClientSecret` or `DSH_ANTIGRAVITY_CLIENT_SECRET`; the
 * project README says where the public implementations keep the same value.
 * @param config - plugin config.
 * @returns the client secret, or undefined when none was configured.
 */
function clientSecretOf(config) {
  const configured = typeof config.googleClientSecret === 'string' && config.googleClientSecret.length > 0
    ? config.googleClientSecret
    : undefined
  if (configured !== undefined) return configured
  const fromEnv = process.env.DSH_ANTIGRAVITY_CLIENT_SECRET
  return typeof fromEnv === 'string' && fromEnv.length > 0 ? fromEnv : undefined
}

/**
 * Fail before the browser round-trip when the secret is missing.
 * @param config - plugin config.
 * @returns the configured client secret.
 * @throws Error naming both configuration points.
 */
function requireClientSecret(config) {
  const secret = clientSecretOf(config)
  if (secret === undefined) throw new Error(message(config.lang, 'antigravityNeedsSecret'))
  return secret
}
const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v1/userinfo?alt=json'
const REDIRECT_URI = 'http://localhost:51121/oauth-callback'
const LOOPBACK_PORT = 51121
const LOOPBACK_PATH = '/oauth-callback'
const SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cclog',
  'https://www.googleapis.com/auth/experimentsandconfigs',
].join(' ')
const HOST = 'https://daily-cloudcode-pa.googleapis.com'
const FALLBACK_PROJECT = 'rising-fact-p41fc'
const HUB_VERSION = '2.24.0'
const HUB_CHANGELIST = '1000335682'
const HUB_USER_AGENT = `antigravity/hub/${HUB_VERSION} (aidev_client; os_type=darwin; arch=arm64; cl=${HUB_CHANGELIST})`
const ONBOARD_USER_AGENT = `${HUB_USER_AGENT} google-api-nodejs-client/10.3.0`
const SKIP_THOUGHT_SIGNATURE = 'skip_thought_signature_validator'

/** Static catalog; replaced by the account's own list once it answers. */
const MODELS = [
  { id: 'gemini-4-argon-high', name: 'Gemini 4 Argon (high)', contextWindow: 1_048_576, maxTokens: 65_535, effort: 'high', family: 'gemini' },
  { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (high)', contextWindow: 1_048_576, maxTokens: 65_535, effort: 'high', family: 'gemini' },
  { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (medium)', contextWindow: 1_048_576, maxTokens: 65_535, effort: 'medium', family: 'gemini' },
  { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (low)', contextWindow: 1_048_576, maxTokens: 65_535, effort: 'low', family: 'gemini' },
  { id: 'gemini-3-pro-high', name: 'Gemini 3 Pro (high)', contextWindow: 1_048_576, maxTokens: 65_535, effort: 'high', family: 'gemini' },
  { id: 'gemini-3-pro-low', name: 'Gemini 3 Pro (low)', contextWindow: 1_048_576, maxTokens: 65_535, effort: 'low', family: 'gemini' },
  { id: 'claude-opus-5-5-high', name: 'Claude Opus 5.5 (via Antigravity)', contextWindow: 200_000, maxTokens: 64_000, effort: 'high', family: 'claude' },
  { id: 'claude-sonnet-5-5-high', name: 'Claude Sonnet 5.5 (via Antigravity)', contextWindow: 200_000, maxTokens: 64_000, effort: 'high', family: 'claude' },
  { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (via Antigravity)', contextWindow: 200_000, maxTokens: 32_000, effort: 'medium', family: 'other' },
]

const REASONING = {
  efforts: [
    { id: 'low', name: 'Low' },
    { id: 'medium', name: 'Medium' },
    { id: 'high', name: 'High' },
  ],
  defaultEffort: 'high',
}

export default {
  id: 'antigravity',
  route: 'google-antigravity',
  name: { zh: 'Google Antigravity', en: 'Google Antigravity' },
  models: MODELS,

  /**
   * Run the Antigravity Google-account sign-in and resolve the Cloud Code
   * project the account is entitled to.
   * @param request - the service's interaction, cancellation, and config.
   * @returns the grant to store.
   */
  async login({ interaction, signal, config }) {
    const pkce = createPkce()
    const state = randomState()
    const clientId = config.googleClientId ?? CLIENT_ID
    const clientSecret = requireClientSecret(config)
    const host = config.antigravityHost ?? HOST
    const authorize = new URL(AUTHORIZE_URL)
    authorize.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
      state,
    }).toString()
    let loopback
    try {
      loopback = await startLoopback({ port: LOOPBACK_PORT, path: LOOPBACK_PATH, timeoutMs: config.loginTimeoutMs })
    } catch (error) {
      interaction.notify({ message: message(config.lang, 'loopbackBusyAntigravity', { PORT: LOOPBACK_PORT, ERROR: String(error?.message ?? error) }) })
    }
    interaction.notify({ message: message(config.lang, 'openAntigravity'), url: authorize.href })
    if (config.openBrowser !== false) openBrowser(authorize.href)
    const code = await waitForCode({
      interaction,
      loopback,
      signal,
      state,
      lang: config.lang,
      message: message(config.lang, 'pastePrompt'),
      placeholder: `${REDIRECT_URI}?code=…&state=…`,
    })
    if (loopback !== undefined) loopback.close()
    const token = await postForm(TOKEN_URL, {
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
      code_verifier: pkce.verifier,
    }, { signal })
    if (typeof token.access_token !== 'string' || token.access_token.length === 0) {
      throw new Error('Google returned no access token')
    }
    const account = await readEmail(token.access_token, signal)
    const project = await resolveProject(token.access_token, host, interaction, config.lang)
    return {
      accessToken: token.access_token,
      refreshToken: typeof token.refresh_token === 'string' ? token.refresh_token : undefined,
      expiresAt: typeof token.expires_in === 'number' ? expiresAt(token.expires_in) : expiresAt(3600),
      account,
      project,
      host,
      clientId,
    }
  },

  /**
   * Rotate the stored Google grant.
   * @param payload - stored grant.
   * @param config - plugin config.
   * @returns the rotated grant.
   */
  async refresh(payload, config) {
    if (typeof payload.refreshToken !== 'string' || payload.refreshToken.length === 0) {
      throw new Error('Google returned no refresh token; sign in again with prompt=consent')
    }
    const token = await postForm(TOKEN_URL, {
      client_id: payload.clientId ?? config.googleClientId ?? CLIENT_ID,
      client_secret: requireClientSecret(config),
      refresh_token: payload.refreshToken,
      grant_type: 'refresh_token',
    })
    if (typeof token.access_token !== 'string' || token.access_token.length === 0) {
      throw new Error('Google returned no refreshed access token')
    }
    return {
      ...payload,
      accessToken: token.access_token,
      refreshToken: typeof token.refresh_token === 'string' ? token.refresh_token : payload.refreshToken,
      expiresAt: typeof token.expires_in === 'number' ? expiresAt(token.expires_in) : expiresAt(3600),
    }
  },

  /**
   * Describe one model's capacity and reasoning levels.
   * @param model - model id.
   * @returns catalog metadata.
   */
  modelInfo(model) {
    const entry = MODELS.find(candidate => candidate.id === model)
    if (entry === undefined) {
      return { id: model, name: model, contextWindow: 1_048_576, maxTokens: 65_535, reasoning: REASONING }
    }
    return { ...entry, reasoning: REASONING }
  },

  /**
   * Ask the account which models it may use. Best effort: the static catalog
   * answers when the endpoint changes shape.
   * @param credential - stored grant.
   * @param config - plugin config.
   * @returns discovered model ids and display names, when available.
   */
  async discoverModels(credential, config) {
    const host = credential.host ?? config.antigravityHost ?? HOST
    const response = await fetch(`${host}/v1internal:fetchAvailableModels`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${credential.accessToken}`,
        'content-type': 'application/json',
        'user-agent': HUB_USER_AGENT,
      },
      body: JSON.stringify({ project: credential.project ?? FALLBACK_PROJECT }),
    })
    if (!response.ok) return []
    let body
    try {
      body = await response.json()
    } catch (_notJson) {
      return []
    }
    return extractModels(body)
  },

  /**
   * Build the wrapped `streamGenerateContent` request.
   * @param options - harness request.
   * @param credential - stored grant.
   * @param context - service context.
   * @returns URL, headers, and JSON body.
   */
  buildRequest(options, credential, context) {
    const host = credential.host ?? context.config.antigravityHost ?? HOST
    const entry = MODELS.find(candidate => candidate.id === options.model)
    const effort = options.reasoningEffort ?? entry?.effort ?? 'high'
    const request = {
      contents: contents(options),
      ...(instructionText(options).length === 0 ? {} : { systemInstruction: { role: 'user', parts: [{ text: instructionText(options) }] } }),
      generationConfig: {
        maxOutputTokens: options.maxTokens ?? entry?.maxTokens ?? 65_535,
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
        thinkingConfig: { includeThoughts: true, thinkingLevel: effort },
      },
      safetySettings: [],
      ...(typeof options.sessionId === 'string' ? { sessionId: options.sessionId } : {}),
    }
    const tools = declaredTools(options)
    if (tools.length > 0) {
      request.tools = [{
        functionDeclarations: tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          parameters: geminiSchema(tool.parameters),
        })),
      }]
    }
    return {
      url: `${host}/v1internal:streamGenerateContent?alt=sse`,
      headers: {
        authorization: `Bearer ${credential.accessToken}`,
        'content-type': 'application/json',
        accept: 'text/event-stream',
        'user-agent': HUB_USER_AGENT,
      },
      body: {
        project: credential.project ?? FALLBACK_PROJECT,
        model: options.model,
        requestType: 'agent',
        userAgent: 'antigravity',
        requestId: `agent-${randomUUID()}`,
        request,
      },
    }
  },

  /** Translate the wrapped Cloud Code event stream into harness chunks. */
  async *parseStream(response) {
    let text
    let reasoning
    let nextIndex = 0
    let usage
    let finish
    for await (const frame of sseJson(response)) {
      const payload = frame.response ?? frame
      const candidate = payload.candidates?.[0]
      if (candidate !== undefined) {
        for (const part of candidate.content?.parts ?? []) {
          if (part === null || typeof part !== 'object') continue
          if (part.functionCall !== undefined) {
            const call = part.functionCall
            const id = String(call.id ?? `call_${nextIndex}`)
            const name = String(call.name ?? '')
            const args = JSON.stringify(call.args ?? {})
            const index = nextIndex++
            yield { type: 'block-start', index, blockType: 'tool-call' }
            yield { type: 'tool-call-delta', index, id, name, argumentsDelta: args }
            yield { type: 'block-end', index, block: { type: 'tool-call', id, name, arguments: args } }
            continue
          }
          const textPart = typeof part.text === 'string' ? part.text : undefined
          if (textPart === undefined || textPart.length === 0) continue
          if (part.thought === true) {
            if (reasoning === undefined) {
              reasoning = { index: nextIndex++, text: '' }
              yield { type: 'block-start', index: reasoning.index, blockType: 'reasoning' }
            }
            reasoning.text += textPart
            yield { type: 'reasoning-delta', index: reasoning.index, text: textPart }
          } else {
            if (text === undefined) {
              text = { index: nextIndex++, text: '' }
              yield { type: 'block-start', index: text.index, blockType: 'text' }
            }
            text.text += textPart
            yield { type: 'text-delta', index: text.index, text: textPart }
          }
        }
        if (typeof candidate.finishReason === 'string' && candidate.finishReason.length > 0 && candidate.finishReason !== 'FINISH_REASON_UNSPECIFIED') {
          finish = candidate.finishReason
        }
      }
      if (payload.usageMetadata !== undefined) usage = payload.usageMetadata
    }
    if (text !== undefined) yield { type: 'block-end', index: text.index, block: { type: 'text', text: text.text } }
    if (reasoning !== undefined) yield { type: 'block-end', index: reasoning.index, block: { type: 'reasoning', text: reasoning.text } }
    const mapped = mapUsage(usage)
    if (mapped !== undefined) yield { type: 'usage', usage: mapped }
    if (finish === 'MAX_TOKENS') {
      yield { type: 'finish', reason: { kind: 'max-tokens' } }
      return
    }
    if (finish === 'SAFETY' || finish === 'RECITATION' || finish === 'PROHIBITED_CONTENT' || finish === 'BLOCKLIST') {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: `the provider stopped the response: ${finish}`, code: 'PROVIDER_ERROR' } } }
      return
    }
    const hasTools = nextIndex > (text === undefined ? 0 : 1) + (reasoning === undefined ? 0 : 1)
    yield { type: 'finish', reason: { kind: hasTools ? 'tool-calls' : 'stop' } }
  },
}

/**
 * Read the account's e-mail address from Google's userinfo endpoint.
 * @param accessToken - Google access token.
 * @param signal - cancellation.
 * @returns the address, or undefined when it cannot be read.
 */
async function readEmail(accessToken, signal) {
  try {
    const response = await fetch(USERINFO_URL, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      signal,
    })
    if (!response.ok) return undefined
    const body = await response.json()
    return typeof body.email === 'string' ? body.email : undefined
  } catch (_userinfoFailed) {
    return undefined
  }
}

/**
 * Resolve the Cloud Code project the account is entitled to.
 * @param accessToken - Google access token.
 * @param host - Cloud Code host.
 * @param interaction - where onboarding progress is reported.
 * @returns the project id, falling back to the documented default.
 */
async function resolveProject(accessToken, host, interaction, lang) {
  const headers = {
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
    'user-agent': HUB_USER_AGENT,
  }
  try {
    const response = await fetch(`${host}/v1internal:loadCodeAssist`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
    })
    if (response.ok) {
      const body = await response.json()
      const project = typeof body.cloudaicompanionProject === 'string'
        ? body.cloudaicompanionProject
        : typeof body.cloudaicompanionProject?.id === 'string'
          ? body.cloudaicompanionProject.id
          : undefined
      if (typeof project === 'string' && project.length > 0) return project
      const tier = Array.isArray(body.allowedTiers)
        ? body.allowedTiers.find(entry => entry?.isDefault === true)?.id ?? body.allowedTiers[0]?.id
        : undefined
      const onboarded = await onboard(accessToken, host, tier ?? 'free-tier', interaction, lang)
      if (onboarded !== undefined) return onboarded
    }
  } catch (error) {
    interaction.notify({ message: message(lang, 'antigravityFallback', { ERROR: String(error?.message ?? error) }) })
  }
  return FALLBACK_PROJECT
}

/**
 * Ask Cloud Code to provision the account's project.
 * @param accessToken - Google access token.
 * @param host - Cloud Code host.
 * @param tier - tier id from `loadCodeAssist`.
 * @param interaction - where progress is reported.
 * @returns the provisioned project id, when one arrives.
 */
async function onboard(accessToken, host, tier, interaction, lang) {
  interaction.notify({ message: message(lang, 'antigravityOnboard') })
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const response = await fetch(`${host}/v1internal:onboardUser`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
          'user-agent': ONBOARD_USER_AGENT,
          'x-goog-api-client': 'gl-node/22.21.1',
        },
        body: JSON.stringify({
          tier_id: tier,
          metadata: { ide_type: 'ANTIGRAVITY', ide_version: HUB_VERSION, ide_name: 'antigravity' },
        }),
      })
      if (response.ok) {
        const body = await response.json()
        if (body.done === true || body.response !== undefined) {
          const project = typeof body.response?.cloudaicompanionProject === 'string'
            ? body.response.cloudaicompanionProject
            : typeof body.response?.cloudaicompanionProject?.id === 'string'
              ? body.response.cloudaicompanionProject.id
              : undefined
          if (typeof project === 'string' && project.length > 0) return project
          if (body.done === true) return undefined
        }
      }
    } catch (_onboardAttemptFailed) {
      /* retried below */
    }
    await new Promise(resolve => setTimeout(resolve, 5000))
  }
  return undefined
}

/**
 * Project harness messages onto Gemini `contents`.
 * @param options - harness request.
 * @returns the contents array.
 */
function contents(options) {
  const out = []
  for (const message of conversation(options)) {
    if (message.role === 'developer') {
      const text = blockText(message.content)
      if (text.length > 0) out.push({ role: 'user', parts: [{ text: `<system-reminder>\n${text}\n</system-reminder>` }] })
      continue
    }
    if (message.role === 'user') {
      const text = blockText(message.content)
      if (text.length > 0) out.push({ role: 'user', parts: [{ text }] })
      continue
    }
    if (message.role === 'tool') {
      out.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: toolNameOf(options, message.toolCallId),
            response: { output: blockText(message.content) || '(no output)' },
            id: String(message.toolCallId),
          },
        }],
      })
      continue
    }
    if (message.role !== 'assistant') continue
    const parts = []
    let firstToolCall = true
    for (const block of message.content) {
      if (block === null || typeof block !== 'object') continue
      if (block.type === 'text' && String(block.text ?? '').length > 0) {
        parts.push({ text: String(block.text) })
      } else if (block.type === 'reasoning' && String(block.text ?? '').length > 0) {
        parts.push({ text: String(block.text), thought: true })
      } else if (block.type === 'tool-call') {
        parts.push({
          functionCall: {
            name: String(block.name),
            args: toolArguments(block.arguments),
            id: String(block.id),
          },
          // Cloud Code requires a thought signature on the first call of an
          // assistant turn; the sentinel is the documented bypass when the
          // original signature was not retained.
          ...firstToolCall ? { thoughtSignature: SKIP_THOUGHT_SIGNATURE } : {},
        })
        firstToolCall = false
      }
    }
    if (parts.length > 0) out.push({ role: 'model', parts })
  }
  return out
}

/**
 * Find the tool name a durable tool result belongs to.
 * @param options - harness request.
 * @param toolCallId - the call the result answers.
 * @returns the tool name, or `unknown` when the history does not carry it.
 */
function toolNameOf(options, toolCallId) {
  for (const message of options.messages) {
    if (message.role !== 'assistant') continue
    for (const block of message.content) {
      if (block?.type === 'tool-call' && String(block.id) === String(toolCallId)) return String(block.name)
    }
  }
  return 'unknown'
}

/**
 * Extract model ids from a `fetchAvailableModels` reply, tolerating shapes.
 * @param body - decoded reply.
 * @returns discovered models.
 */
function extractModels(body) {
  const candidates = []
  const push = (value) => {
    if (typeof value === 'string') candidates.push({ id: value })
    else if (value !== null && typeof value === 'object' && typeof value.id === 'string') candidates.push(value)
    else if (value !== null && typeof value === 'object' && typeof value.model === 'string') candidates.push({ id: value.model })
  }
  const collections = [body?.models, body?.availableModels, body?.data]
  for (const collection of collections) {
    if (Array.isArray(collection)) collection.forEach(push)
    else if (collection !== null && typeof collection === 'object') {
      for (const [key, value] of Object.entries(collection)) {
        if (value !== null && typeof value === 'object') push({ id: key, ...value })
        else push(key)
      }
    }
  }
  const seen = new Set()
  const models = []
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue
    seen.add(candidate.id)
    const known = MODELS.find(entry => entry.id === candidate.id)
    models.push({
      id: candidate.id,
      name: candidate.displayName ?? candidate.name ?? known?.name ?? candidate.id,
      contextWindow: Number(candidate.maxContextTokens ?? candidate.contextWindow ?? known?.contextWindow ?? 1_048_576),
      maxTokens: Number(candidate.maxOutputTokens ?? candidate.maxTokens ?? known?.maxTokens ?? 65_535),
      effort: known?.effort ?? 'high',
      family: known?.family ?? 'gemini',
    })
  }
  return models
}

/**
 * Map Gemini usage metadata onto the harness token shape.
 * @param usage - provider metadata.
 * @returns harness usage, or undefined when absent.
 */
function mapUsage(usage) {
  if (usage === null || typeof usage !== 'object') return undefined
  const input = Number(usage.promptTokenCount ?? 0)
  const cached = Number(usage.cachedContentTokenCount ?? 0)
  const output = Number(usage.candidatesTokenCount ?? 0)
  const thoughts = Number(usage.thoughtsTokenCount ?? 0)
  return {
    inputTokens: Math.max(0, input - cached),
    outputTokens: output,
    totalTokens: Number(usage.totalTokenCount ?? input + output),
    ...(cached > 0 ? { cacheReadTokens: cached } : {}),
    ...(thoughts > 0 ? { reasoningTokens: thoughts } : {}),
  }
}




