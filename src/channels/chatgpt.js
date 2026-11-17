/**
 * ChatGPT subscription channel (Codex): OAuth against auth.openai.com, then the
 * ChatGPT backend's Codex Responses API with the account's own entitlement.
 */
import { createPkce, randomState, expiresAt, startLoopback, openBrowser, postForm, sseJson } from '../oauth.js'
import { waitForCode, decodeJwt } from '../login.js'
import { message } from '../copy.js'
import { blockText, conversation, instructionText, declaredTools, toolArguments } from '../convert.js'

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize'
const TOKEN_URL = 'https://auth.openai.com/oauth/token'
const REDIRECT_URI = 'http://localhost:1455/auth/callback'
const CALLBACK_PORT = 1455
const CALLBACK_PATH = '/auth/callback'
const SCOPE = 'openid profile email offline_access'
const JWT_CLAIM_PATH = 'https://api.openai.com/auth'
const BASE_URL = 'https://chatgpt.com/backend-api'
const RESPONSES_PATH = '/codex/responses'
const USER_AGENT = 'deepseek-harness (+https://github.com/deepseek-ai/deepseek-harness)'

/** Model catalog advertised before the account is asked anything. */
const MODELS = [
  { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', contextWindow: 500_000, maxTokens: 128_000, efforts: ['low', 'medium', 'high'] },
  { id: 'gpt-6-sol', name: 'GPT-6 Sol', contextWindow: 272_000, maxTokens: 128_000, efforts: ['low', 'medium', 'high'] },
  { id: 'gpt-6-astra', name: 'GPT-6 Astra', contextWindow: 272_000, maxTokens: 128_000, efforts: ['low', 'medium', 'high'] },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', contextWindow: 272_000, maxTokens: 128_000, efforts: ['low', 'medium', 'high'] },
  { id: 'gpt-5.5', name: 'GPT-5.5', contextWindow: 272_000, maxTokens: 128_000, efforts: ['low', 'medium', 'high'] },
  { id: 'gpt-5.3-codex-spark', name: 'GPT-5.3 Codex Spark', contextWindow: 128_000, maxTokens: 128_000, efforts: ['low', 'medium', 'high'] },
]

/** Reasoning levels as the composer offers them. */
const REASONING = {
  efforts: [
    { id: 'low', name: 'Low' },
    { id: 'medium', name: 'Medium' },
    { id: 'high', name: 'High' },
  ],
  defaultEffort: 'medium',
}

export default {
  id: 'chatgpt',
  route: 'chatgpt-sub',
  name: { zh: 'ChatGPT 订阅', en: 'ChatGPT subscription' },
  models: MODELS,

  /**
   * Run the ChatGPT PKCE sign-in.
   * @param request - the service's interaction, cancellation, and config.
   * @returns the grant to store.
   */
  async login({ interaction, signal, config }) {
    const pkce = createPkce()
    const state = randomState()
    const authorize = new URL(AUTHORIZE_URL)
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
      state,
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      originator: config.originator,
    }).toString()
    let loopback
    try {
      loopback = await startLoopback({ port: CALLBACK_PORT, path: CALLBACK_PATH, timeoutMs: config.loginTimeoutMs })
    } catch (error) {
      interaction.notify({ message: message(config.lang, 'loopbackBusy', { PORT: CALLBACK_PORT, ERROR: String(error?.message ?? error) }) })
    }
    interaction.notify({ message: message(config.lang, 'openChatgpt'), url: authorize.href })
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
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      code_verifier: pkce.verifier,
      redirect_uri: REDIRECT_URI,
    }, { signal })
    if (typeof token.access_token !== 'string' || token.access_token.length === 0) {
      throw new Error('ChatGPT returned no access token')
    }
    if (typeof token.refresh_token !== 'string' || token.refresh_token.length === 0) {
      throw new Error('ChatGPT returned no refresh token; sign in again and keep the browser open until it reports success')
    }
    if (typeof token.expires_in !== 'number') throw new Error('ChatGPT returned no token lifetime')
    const claims = decodeJwt(token.id_token) ?? decodeJwt(token.access_token)
    const accountId = claims?.[JWT_CLAIM_PATH]?.chatgpt_account_id
    if (typeof accountId !== 'string' || accountId.length === 0) {
      throw new Error('The ChatGPT token carries no account id')
    }
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: expiresAt(token.expires_in),
      accountId,
      account: typeof claims?.email === 'string' ? claims.email : undefined,
      scope: typeof token.scope === 'string' ? token.scope : SCOPE,
    }
  },

  /**
   * Exchange the stored refresh token for a new access token.
   * @param payload - stored grant.
   * @param config - plugin config.
   * @returns the rotated grant.
   */
  async refresh(payload, config) {
    const token = await postForm(TOKEN_URL, {
      grant_type: 'refresh_token',
      refresh_token: payload.refreshToken,
      client_id: CLIENT_ID,
    })
    if (typeof token.access_token !== 'string' || token.access_token.length === 0) {
      throw new Error('ChatGPT returned no refreshed access token')
    }
    const claims = decodeJwt(token.id_token) ?? decodeJwt(token.access_token)
    const accountId = claims?.[JWT_CLAIM_PATH]?.chatgpt_account_id
    return {
      ...payload,
      accessToken: token.access_token,
      refreshToken: typeof token.refresh_token === 'string' ? token.refresh_token : payload.refreshToken,
      expiresAt: expiresAt(typeof token.expires_in === 'number' ? token.expires_in : 3600),
      accountId: typeof accountId === 'string' && accountId.length > 0 ? accountId : payload.accountId,
      account: typeof claims?.email === 'string' ? claims.email : payload.account,
    }
  },

  /**
   * Describe one model's capacity and reasoning levels.
   * @param model - model id.
   * @returns catalog metadata.
   */
  modelInfo(model) {
    const entry = MODELS.find(candidate => candidate.id === model)
    if (entry === undefined) return undefined
    return { ...entry, reasoning: REASONING }
  },

  /**
   * Build the Codex Responses request.
   * @param options - harness request.
   * @param credential - stored grant.
   * @param context - service context (session id, config).
   * @returns URL, headers, and JSON body.
   */
  buildRequest(options, credential, context) {
    const headers = {
      authorization: `Bearer ${credential.accessToken}`,
      'chatgpt-account-id': credential.accountId ?? '',
      originator: context.config.originator,
      'openai-beta': 'responses=experimental',
      accept: 'text/event-stream',
      'content-type': 'application/json',
      'user-agent': USER_AGENT,
    }
    if (typeof options.sessionId === 'string' && options.sessionId.length > 0) {
      const clamped = options.sessionId.slice(0, 64)
      headers['session-id'] = clamped
      headers['x-client-request-id'] = clamped
    }
    const effort = options.reasoningEffort
    const body = {
      model: options.model,
      store: false,
      stream: true,
      instructions: instructionText(options) || 'You are a helpful assistant.',
      input: responsesInput(options),
      text: { verbosity: 'low' },
      include: ['reasoning.encrypted_content'],
      tool_choice: 'auto',
      parallel_tool_calls: true,
      ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
      ...(effort === undefined ? {} : { reasoning: { effort, summary: 'auto' } }),
      ...(options.sessionId === undefined ? {} : { prompt_cache_key: String(options.sessionId).slice(0, 64) }),
    }
    const tools = declaredTools(options)
    if (tools.length > 0) {
      body.tools = tools.map(tool => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        strict: false,
      }))
    }
    return { url: BASE_URL + RESPONSES_PATH, headers, body }
  },

  /** Translate the Codex event stream into harness chunks. */
  async *parseStream(response) {
    const blocks = new Map()
    let nextIndex = 0
    let usage
    let terminal
    const create = (kind, key) => {
      const block = { index: nextIndex++, kind, key, text: '', json: '', id: '', name: '' }
      blocks.set(key, block)
      return block
    }
    const textBlock = (key) => {
      const existing = blocks.get(key)
      if (existing !== undefined) return existing
      return create('text', key)
    }
    for await (const event of sseJson(response)) {
      const type = event.type
      if (type === 'response.output_item.added') {
        const item = event.item ?? {}
        if (item.type === 'function_call' || item.type === 'custom_tool_call') {
          const key = String(item.id ?? event.item_id ?? `tool-${nextIndex}`)
          const block = create('tool-call', key)
          block.id = String(item.call_id ?? item.id ?? key)
          block.name = String(item.name ?? '')
          yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
          yield { type: 'tool-call-delta', index: block.index, id: block.id, name: block.name, argumentsDelta: '' }
        }
        continue
      }
      if (type === 'response.output_text.delta' || type === 'response.refusal.delta') {
        const block = textBlock(String(event.item_id ?? 'text'))
        if (block.opened !== true) {
          block.opened = true
          yield { type: 'block-start', index: block.index, blockType: 'text' }
        }
        const text = String(event.delta ?? '')
        block.text += text
        if (text.length > 0) yield { type: 'text-delta', index: block.index, text }
        continue
      }
      if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') {
        const key = `reasoning:${String(event.item_id ?? 'reasoning')}`
        let block = blocks.get(key)
        if (block === undefined) {
          block = create('reasoning', key)
          yield { type: 'block-start', index: block.index, blockType: 'reasoning' }
        }
        const text = String(event.delta ?? '')
        block.text += text
        if (text.length > 0) yield { type: 'reasoning-delta', index: block.index, text }
        continue
      }
      if (type === 'response.reasoning_summary_part.done') {
        const block = blocks.get(`reasoning:${String(event.item_id ?? 'reasoning')}`)
        if (block !== undefined) {
          block.text += '\n\n'
          yield { type: 'reasoning-delta', index: block.index, text: '\n\n' }
        }
        continue
      }
      if (type === 'response.function_call_arguments.delta' || type === 'response.custom_tool_call_input.delta') {
        const block = blocks.get(String(event.item_id))
        if (block === undefined) continue
        const delta = String(event.delta ?? '')
        block.json += delta
        if (delta.length > 0) yield { type: 'tool-call-delta', index: block.index, id: block.id, argumentsDelta: delta }
        continue
      }
      if (type === 'response.function_call_arguments.done' || type === 'response.custom_tool_call_input.done') {
        const block = blocks.get(String(event.item_id))
        if (block === undefined) continue
        const complete = String(event.arguments ?? event.input ?? '')
        if (complete.length > block.json.length) {
          const suffix = complete.slice(block.json.length)
          block.json = complete
          if (suffix.length > 0) yield { type: 'tool-call-delta', index: block.index, id: block.id, argumentsDelta: suffix }
        }
        continue
      }
      if (type === 'response.output_item.done') {
        const item = event.item ?? {}
        const key = String(item.id ?? event.item_id ?? '')
        const block = blocks.get(key) ?? blocks.get(`reasoning:${key}`) ?? blocks.get(String(event.item_id ?? ''))
        if (block === undefined) continue
        if (block.kind === 'tool-call') {
          const args = String(item.arguments ?? item.input ?? block.json ?? '')
          yield { type: 'block-end', index: block.index, block: { type: 'tool-call', id: block.id, name: block.name, arguments: args.length === 0 ? '{}' : args } }
          block.closed = true
        } else if (block.kind === 'text') {
          yield { type: 'block-end', index: block.index, block: { type: 'text', text: block.text } }
          block.closed = true
        } else {
          yield { type: 'block-end', index: block.index, block: { type: 'reasoning', text: block.text } }
          block.closed = true
        }
        continue
      }
      if (type === 'response.completed' || type === 'response.incomplete' || type === 'response.done') {
        const payload = event.response ?? {}
        usage = payload.usage ?? usage
        terminal = {
          status: payload.status ?? (type === 'response.completed' ? 'completed' : type === 'response.incomplete' ? 'incomplete' : 'completed'),
          incomplete: payload.incomplete_details?.reason,
        }
        continue
      }
      if (type === 'response.failed') {
        const error = event.response?.error ?? {}
        throw new Error(`${String(error.code ?? 'response_failed')}: ${String(error.message ?? 'the provider failed the response')}`)
      }
      if (type === 'error') {
        throw new Error(`${String(event.code ?? 'error')}: ${String(event.message ?? 'the provider reported an error')}`)
      }
    }
    for (const block of blocks.values()) {
      if (block.closed === true) continue
      if (block.kind === 'tool-call') {
        yield { type: 'block-end', index: block.index, block: { type: 'tool-call', id: block.id, name: block.name, arguments: block.json.length === 0 ? '{}' : block.json } }
      } else if (block.kind === 'reasoning') {
        yield { type: 'block-end', index: block.index, block: { type: 'reasoning', text: block.text } }
      } else {
        yield { type: 'block-end', index: block.index, block: { type: 'text', text: block.text } }
      }
    }
    if (terminal === undefined) throw new Error('the Codex stream ended without a terminal response event')
    const mapped = mapUsage(usage)
    if (mapped !== undefined) yield { type: 'usage', usage: mapped }
    const hasTools = [...blocks.values()].some(block => block.kind === 'tool-call')
    if (terminal.status === 'incomplete') {
      if (terminal.incomplete === 'max_output_tokens') {
        yield { type: 'finish', reason: { kind: 'max-tokens' } }
        return
      }
      yield { type: 'finish', reason: { kind: 'error', failure: { message: `the response was incomplete: ${String(terminal.incomplete ?? 'unknown reason')}`, code: 'PROVIDER_ERROR' } } }
      return
    }
    yield { type: 'finish', reason: { kind: hasTools ? 'tool-calls' : 'stop' } }
  },
}

/**
 * Project harness messages onto Responses `input` items.
 * @param options - harness request.
 * @returns the item list.
 */
function responsesInput(options) {
  const input = []
  for (const message of conversation(options)) {
    if (message.role === 'developer') {
      const text = blockText(message.content)
      if (text.length > 0) input.push({ role: 'developer', content: [{ type: 'input_text', text }] })
      continue
    }
    if (message.role === 'user') {
      const text = blockText(message.content)
      if (text.length > 0) input.push({ role: 'user', content: [{ type: 'input_text', text }] })
      continue
    }
    if (message.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: String(message.toolCallId),
        output: blockText(message.content) || '(no output)',
      })
      continue
    }
    if (message.role !== 'assistant') continue
    for (const block of message.content) {
      if (block === null || typeof block !== 'object') continue
      if (block.type === 'text' && String(block.text ?? '').length > 0) {
        input.push({
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: String(block.text), annotations: [] }],
        })
        continue
      }
      if (block.type === 'tool-call') {
        input.push({
          type: 'function_call',
          id: `fc_${String(block.id)}`,
          call_id: String(block.id),
          name: String(block.name),
          arguments: typeof block.arguments === 'string' ? block.arguments : JSON.stringify(toolArguments(block.arguments)),
          status: 'completed',
        })
      }
    }
  }
  return input
}

/**
 * Map provider usage onto the harness token shape.
 * @param usage - Responses usage object.
 * @returns harness usage, or undefined when the provider reported none.
 */
function mapUsage(usage) {
  if (usage === null || typeof usage !== 'object') return undefined
  const input = Number(usage.input_tokens ?? 0)
  const cached = Number(usage.input_tokens_details?.cached_tokens ?? 0)
  const output = Number(usage.output_tokens ?? 0)
  return {
    inputTokens: Math.max(0, input - cached),
    outputTokens: output,
    totalTokens: Number(usage.total_tokens ?? input + output),
    ...(cached > 0 ? { cacheReadTokens: cached } : {}),
    ...(Number(usage.output_tokens_details?.reasoning_tokens ?? 0) > 0
      ? { reasoningTokens: Number(usage.output_tokens_details.reasoning_tokens) }
      : {}),
  }
}


