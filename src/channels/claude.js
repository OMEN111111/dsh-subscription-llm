/**
 * Claude subscription channel: Claude Code's OAuth client against the public
 * Messages API, authenticated with the account's own subscription grant.
 */
import { createPkce, expiresAt, startLoopback, openBrowser, postJson, sseJson } from '../oauth.js'
import { waitForCode } from '../login.js'
import { message } from '../copy.js'
import { blockText, conversation, instructionText, declaredTools, toolArguments } from '../convert.js'

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize'
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token'
const LOOPBACK_PORT = 53692
const LOOPBACK_PATH = '/callback'
const REDIRECT_URI = `http://localhost:${LOOPBACK_PORT}${LOOPBACK_PATH}`
const COPY_CODE_REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback'
const SCOPES = 'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload'
const MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const BETA_HEADER = 'claude-code-20250219,oauth-2025-04-20'
const USER_AGENT = 'claude-cli/2.1.280'
const IDENTITY = "You are Claude Code, Anthropic's official CLI tool for Claude."

/** Model catalog advertised before the account is asked anything. */
const MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', contextWindow: 1_000_000, maxTokens: 128_000 },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', contextWindow: 1_000_000, maxTokens: 128_000 },
  { id: 'claude-opus-5', name: 'Claude Opus 5', contextWindow: 1_000_000, maxTokens: 128_000 },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', contextWindow: 1_000_000, maxTokens: 128_000 },
  { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', contextWindow: 1_000_000, maxTokens: 128_000 },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: 1_000_000, maxTokens: 128_000 },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', contextWindow: 200_000, maxTokens: 64_000 },
]

const THINKING_BUDGET = { low: 1024, medium: 4096, high: 16000 }

/**
 * Read a thinking budget from a level or an edited wire value such as
 * udget 8192 tokens.
 * @param wire - configured wire value.
 * @returns the budget in tokens, or undefined when none applies.
 */
function budgetFromWire(wire) {
  if (typeof wire !== 'string') return undefined
  const digits = /(\d+)/u.exec(wire)
  if (digits !== null) return Number(digits[1])
  return THINKING_BUDGET[wire]
}

/** Levels Claude accepts, each carrying the thinking budget it sends. */
const REASONING = {
  efforts: [
    { id: 'off', name: 'Off', wire: 'off' },
    { id: 'low', name: 'Low', wire: `budget ${THINKING_BUDGET.low} tokens` },
    { id: 'medium', name: 'Medium', wire: `budget ${THINKING_BUDGET.medium} tokens` },
    { id: 'high', name: 'High', wire: `budget ${THINKING_BUDGET.high} tokens` },
  ],
  defaultEffort: 'medium',
}

export default {
  id: 'claude',
  route: 'claude-sub',
  name: { zh: 'Claude 订阅', en: 'Claude subscription' },
  models: MODELS,

  /**
   * Run the Claude Code subscription sign-in.
   * @param request - the service's interaction, cancellation, and config.
   * @returns the grant to store.
   */
  async login({ interaction, signal, config }) {
    const pkce = createPkce()
    const state = pkce.verifier
    let loopback
    try {
      loopback = await startLoopback({ port: LOOPBACK_PORT, path: LOOPBACK_PATH, timeoutMs: config.loginTimeoutMs })
    } catch (error) {
      interaction.notify({ message: message(config.lang, 'loopbackBusy', { PORT: LOOPBACK_PORT, ERROR: String(error?.message ?? error) }) })
    }
    const redirectUri = loopback === undefined ? COPY_CODE_REDIRECT_URI : REDIRECT_URI
    const authorize = new URL(AUTHORIZE_URL)
    authorize.search = new URLSearchParams({
      code: 'true',
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: SCOPES,
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
      state,
    }).toString()
    interaction.notify({ message: message(config.lang, 'openClaude'), url: authorize.href })
    if (config.openBrowser !== false) openBrowser(authorize.href)
    const code = await waitForCode({
      interaction,
      loopback,
      signal,
      state,
      lang: config.lang,
      message: message(config.lang, 'pastePromptClaude'),
      placeholder: 'code#state',
    })
    if (loopback !== undefined) loopback.close()
    const token = await postJson(TOKEN_URL, {
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      state,
      redirect_uri: redirectUri,
      code_verifier: pkce.verifier,
    }, { signal })
    if (typeof token.access_token !== 'string' || token.access_token.length === 0) {
      throw new Error('Claude returned no access token')
    }
    if (typeof token.refresh_token !== 'string' || token.refresh_token.length === 0) {
      throw new Error('Claude returned no refresh token')
    }
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      // Claude's own client treats a token as expired five minutes early.
      expiresAt: typeof token.expires_in === 'number' ? expiresAt(token.expires_in - 300) : expiresAt(3600),
      scope: SCOPES,
      account: undefined,
    }
  },

  /**
   * Rotate the stored Claude grant.
   * @param payload - stored grant.
   * @returns the rotated grant.
   */
  async refresh(payload) {
    const token = await postJson(TOKEN_URL, {
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: payload.refreshToken,
    })
    if (typeof token.access_token !== 'string' || token.access_token.length === 0) {
      throw new Error('Claude returned no refreshed access token')
    }
    return {
      ...payload,
      accessToken: token.access_token,
      refreshToken: typeof token.refresh_token === 'string' ? token.refresh_token : payload.refreshToken,
      expiresAt: typeof token.expires_in === 'number' ? expiresAt(token.expires_in - 300) : expiresAt(3600),
    }
  },

  /**
   * Describe one model's capacity and reasoning levels.
   * @param model - model id.
   * @returns catalog metadata.
   */
  /** Reasoning levels any model on this channel may declare. */
  reasoningEfforts: REASONING.efforts,

  /** The wire value one reasoning level sends; Claude takes a thinking budget. */
  wireValue(level) {
    const budget = THINKING_BUDGET[level]
    return budget === undefined ? 'off' : `budget ${budget} tokens`
  },

  modelInfo(model) {
    const entry = MODELS.find(candidate => candidate.id === model)
    if (entry === undefined) return undefined
    return { ...entry, reasoning: REASONING }
  },

  /**
   * Build the Messages request.
   * @param options - harness request.
   * @param credential - stored grant.
   * @returns URL, headers, and JSON body.
   */
  buildRequest(options, credential, context) {
    const entry = MODELS.find(candidate => candidate.id === options.model)
    const effort = context.wireEffort ?? options.reasoningEffort
    const budget = effort === undefined || effort === 'off' ? undefined : budgetFromWire(effort)
    const requestedMax = options.maxTokens ?? entry?.maxTokens ?? 32_000
    const maxTokens = budget === undefined ? requestedMax : Math.max(requestedMax, budget + 4096)
    const system = [{ type: 'text', text: IDENTITY }]
    const instructions = instructionText(options)
    if (instructions.length > 0) system.push({ type: 'text', text: instructions })
    const body = {
      model: options.model,
      stream: true,
      max_tokens: maxTokens,
      system,
      messages: messages(options, context.images),
      ...(options.temperature === undefined || budget !== undefined ? {} : { temperature: options.temperature }),
      ...(budget === undefined ? {} : { thinking: { type: 'enabled', budget_tokens: budget } }),
      ...(options.stop === undefined ? {} : { stop_sequences: options.stop }),
    }
    const tools = declaredTools(options)
    if (tools.length > 0) {
      body.tools = tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters }))
    }
    return {
      url: MESSAGES_URL,
      headers: {
        authorization: `Bearer ${credential.accessToken}`,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-beta': BETA_HEADER,
        'anthropic-dangerous-direct-browser-access': 'true',
        'user-agent': USER_AGENT,
        'x-app': 'cli',
        accept: 'text/event-stream',
        'content-type': 'application/json',
      },
      body,
    }
  },

  /** Translate the Messages event stream into harness chunks. */
  async *parseStream(response) {
    const blocks = new Map()
    const usage = { inputTokens: 0, outputTokens: 0 }
    let started = false
    let reason
    for await (const event of sseJson(response)) {
      if (event.type === 'message_start') {
        started = true
        updateUsage(usage, event.message?.usage)
        continue
      }
      if (event.type === 'content_block_start') {
        if (!started) throw new Error('the Claude stream emitted content before message_start')
        const wireIndex = Number(event.index)
        const native = event.content_block ?? {}
        let content
        if (native.type === 'text') content = { type: 'text', text: String(native.text ?? '') }
        else if (native.type === 'thinking') content = { type: 'reasoning', text: String(native.thinking ?? '') }
        else if (native.type === 'redacted_thinking') content = { type: 'reasoning', text: '[Reasoning redacted]' }
        else if (native.type === 'tool_use') {
          content = { type: 'tool-call', id: String(native.id ?? ''), name: String(native.name ?? ''), arguments: JSON.stringify(native.input ?? {}) }
        } else continue
        const block = { index: blocks.size, kind: content.type, content, json: '', closed: false }
        blocks.set(wireIndex, block)
        yield { type: 'block-start', index: block.index, blockType: content.type }
        if (content.type === 'tool-call') {
          yield { type: 'tool-call-delta', index: block.index, id: content.id, name: content.name, argumentsDelta: '' }
        } else if (content.text.length > 0) {
          yield { type: content.type === 'text' ? 'text-delta' : 'reasoning-delta', index: block.index, text: content.text }
        }
        continue
      }
      if (event.type === 'content_block_delta') {
        const block = blocks.get(Number(event.index))
        if (block === undefined || block.closed) throw new Error('the Claude stream sent a delta for an unopened block')
        const delta = event.delta ?? {}
        if (delta.type === 'text_delta' && block.kind === 'text') {
          const text = String(delta.text ?? '')
          block.content.text += text
          yield { type: 'text-delta', index: block.index, text }
        } else if (delta.type === 'thinking_delta' && block.kind === 'reasoning') {
          const text = String(delta.thinking ?? '')
          block.content.text += text
          yield { type: 'reasoning-delta', index: block.index, text }
        } else if (delta.type === 'input_json_delta' && block.kind === 'tool-call') {
          const argumentsDelta = String(delta.partial_json ?? '')
          block.json += argumentsDelta
          yield { type: 'tool-call-delta', index: block.index, id: block.content.id, argumentsDelta }
        }
        continue
      }
      if (event.type === 'content_block_stop') {
        const block = blocks.get(Number(event.index))
        if (block === undefined || block.closed) throw new Error('the Claude stream stopped an unopened block')
        block.closed = true
        if (block.kind === 'tool-call' && block.json.length > 0) block.content.arguments = block.json
        yield { type: 'block-end', index: block.index, block: { ...block.content } }
        continue
      }
      if (event.type === 'message_delta') {
        if (event.delta?.stop_reason !== undefined && event.delta?.stop_reason !== null) {
          reason = stopReason(event.delta.stop_reason)
        }
        if (event.usage !== undefined) updateUsage(usage, event.usage)
        continue
      }
      if (event.type === 'message_stop') break
      if (event.type === 'error') {
        throw new Error(String(event.error?.message ?? 'Claude reported a stream error'))
      }
    }
    if (reason === undefined) throw new Error('the Claude stream ended without a stop reason')
    usage.totalTokens = usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
    yield { type: 'usage', usage }
    yield { type: 'finish', reason }
  },
}

/**
 * Project harness messages onto Anthropic messages.
 * @param options - harness request.
 * @returns the `messages` array.
 */
function messages(options, images) {
  const out = []
  const attachments = images instanceof Map ? images : new Map()
  for (const message of conversation(options)) {
    if (message.role === 'developer') {
      const text = blockText(message.content)
      if (text.length > 0) out.push({ role: 'user', content: [{ type: 'text', text: `<system-reminder>\n${text}\n</system-reminder>` }] })
      continue
    }
    if (message.role === 'user') {
      const content = []
      const text = blockText(message.content)
      if (text.length > 0) content.push({ type: 'text', text })
      for (const block of message.content) {
        if (block === null || typeof block !== 'object' || block.type !== 'image') continue
        const image = attachments.get(block.attachment?.attachmentId)
        if (image === undefined) continue
        content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } })
      }
      if (content.length > 0) out.push({ role: 'user', content })
      continue
    }
    if (message.role === 'tool') {
      const entry = {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: String(message.toolCallId),
          content: blockText(message.content) || '(no output)',
          ...message.isError === true ? { is_error: true } : {},
        }],
      }
      const previous = out.at(-1)
      if (previous !== undefined && previous.role === 'user' && previous.content.every(block => block.type === 'tool_result')) {
        previous.content.push(entry.content[0])
      } else {
        out.push(entry)
      }
      continue
    }
    if (message.role !== 'assistant') continue
    const content = []
    for (const block of message.content) {
      if (block === null || typeof block !== 'object') continue
      if (block.type === 'text' && String(block.text ?? '').length > 0) content.push({ type: 'text', text: String(block.text) })
      else if (block.type === 'reasoning' && String(block.text ?? '').length > 0) content.push({ type: 'thinking', thinking: String(block.text) })
      else if (block.type === 'tool-call') {
        content.push({
          type: 'tool_use',
          id: String(block.id),
          name: String(block.name),
          input: toolArguments(block.arguments),
        })
      }
    }
    if (content.length > 0) out.push({ role: 'assistant', content })
  }
  return out
}

/**
 * Accumulate provider usage onto the harness counters.
 * @param usage - harness usage being built.
 * @param raw - provider usage object.
 */
function updateUsage(usage, raw) {
  if (raw === null || typeof raw !== 'object') return
  if (Number.isFinite(raw.input_tokens)) usage.inputTokens = Number(raw.input_tokens)
  if (Number.isFinite(raw.output_tokens)) usage.outputTokens = Number(raw.output_tokens)
  if (Number.isFinite(raw.cache_read_input_tokens)) usage.cacheReadTokens = Number(raw.cache_read_input_tokens)
  if (Number.isFinite(raw.cache_creation_input_tokens)) usage.cacheWriteTokens = Number(raw.cache_creation_input_tokens)
}

/**
 * Map an Anthropic stop reason.
 * @param value - provider stop reason.
 * @returns the harness finish reason.
 */
function stopReason(value) {
  switch (value) {
    case 'end_turn':
    case 'stop_sequence':
    case 'pause_turn':
      return { kind: 'stop' }
    case 'tool_use':
      return { kind: 'tool-calls' }
    case 'max_tokens':
      return { kind: 'max-tokens' }
    default:
      return { kind: 'stop' }
  }
}








