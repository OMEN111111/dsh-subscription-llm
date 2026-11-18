/**
 * ChatGPT subscription channel: OpenAI's documented "Sign in with ChatGPT" flow
 * for open-source / locally hosted clients.
 *
 * A first sign-in dynamically registers a client (`dynamic_agent_client`) for
 * the account and workspace, returns the issued client id through the callback,
 * and grants the Responses API scopes that let eligible ChatGPT plan usage pay
 * for inference at `https://api.openai.com/v1`. Later sign-ins reuse that issued
 * client id; the Codex fallback this plugin shipped earlier is gone.
 */
import { createPkce, randomState, expiresAt, startLoopback, openBrowser, postForm, sseJson } from '../oauth.js'
import { waitForParams } from '../login.js'
import { message } from '../copy.js'
import { verifyIdToken, revokeSession } from '../oidc.js'
import { blockText, conversation, instructionText, declaredTools, toolArguments } from '../convert.js'

/** The only grant format this channel accepts. */
const FLOW_SIWC = 'siwc'

/** OpenAI's documented Sign in with ChatGPT contract for open-source clients. */
const SIWC = {
  dynamicClientId: 'dynamic_agent_client',
  authorizeUrl: 'https://auth.openai.com/api/accounts/authorize',
  tokenUrl: 'https://auth.openai.com/api/accounts/oauth/token',
  callbackPort: 1455,
  callbackPath: '/auth/callback',
  scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
  planScope: 'chatgpt.tokens.use.direct',
  resource: 'https://api.openai.com/v1',
  apiBase: 'https://api.openai.com/v1',
  responsesPath: '/responses',
  modelsPath: '/models',
}

const USER_AGENT = 'deepseek-harness (+https://github.com/deepseek-ai/deepseek-harness)'

/** Model catalog advertised before the account is asked anything. */
const MODELS = [
  { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', contextWindow: 500_000, maxTokens: 128_000, inputModalities: ['text', 'image'], efforts: ['low', 'medium', 'high'] },
  { id: 'gpt-6-sol', name: 'GPT-6 Sol', contextWindow: 272_000, maxTokens: 128_000, inputModalities: ['text', 'image'], efforts: ['low', 'medium', 'high'] },
  { id: 'gpt-6-astra', name: 'GPT-6 Astra', contextWindow: 272_000, maxTokens: 128_000, inputModalities: ['text', 'image'], efforts: ['low', 'medium', 'high'] },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', contextWindow: 272_000, maxTokens: 128_000, inputModalities: ['text', 'image'], efforts: ['low', 'medium', 'high'] },
  { id: 'gpt-5.5', name: 'GPT-5.5', contextWindow: 272_000, maxTokens: 128_000, inputModalities: ['text', 'image'], efforts: ['low', 'medium', 'high'] },
  { id: 'gpt-5.3-codex-spark', name: 'GPT-5.3 Codex Spark', contextWindow: 128_000, maxTokens: 128_000, efforts: ['low', 'medium', 'high'] },
]

/** Every reasoning level the ChatGPT backend family accepts, with its wire value. */
const LEVELS = {
  low: { id: 'low', name: 'Low', wire: 'low' },
  medium: { id: 'medium', name: 'Medium', wire: 'medium' },
  high: { id: 'high', name: 'High', wire: 'high' },
  xhigh: { id: 'xhigh', name: 'Extra high', wire: 'xhigh' },
  max: { id: 'max', name: 'Max', wire: 'max' },
  ultra: { id: 'ultra', name: 'Ultra', wire: 'ultra' },
}

/** Levels each model declares; more capable models expose more of them. */
const MODEL_LEVELS = {
  'gpt-6.1-sol': ['low', 'medium', 'high', 'xhigh', 'ultra'],
  'gpt-6-sol': ['low', 'medium', 'high', 'xhigh'],
  'gpt-6-astra': ['low', 'medium', 'high', 'xhigh'],
  'gpt-5.6-sol': ['low', 'medium', 'high', 'xhigh'],
  'gpt-5.5': ['low', 'medium', 'high'],
  'gpt-5.3-codex-spark': ['low', 'medium', 'high'],
}

/** The channel-wide fallback for models that declare nothing. */
const REASONING = {
  efforts: [LEVELS.low, LEVELS.medium, LEVELS.high],
  defaultEffort: 'medium',
}

/**
 * Build the documented Sign in with ChatGPT authorization URL.
 *
 * Exported so a test can assert the parameters without opening a browser.
 * @param request - issued or dynamic client id, callback, and attempt facts.
 * @returns the absolute authorization URL.
 */
export function siwcAuthorizeUrl(request) {
  const url = new URL(SIWC.authorizeUrl)
  const params = {
    client_id: request.clientId,
    response_type: 'code',
    redirect_uri: request.redirectUri,
    scope: SIWC.scope,
    resource: SIWC.resource,
    state: request.state,
    nonce: request.nonce,
    code_challenge: request.codeChallenge,
    code_challenge_method: 'S256',
    ext_agent_host_id: request.hostId,
  }
  if (typeof request.agentName === 'string' && request.agentName.length > 0) params.agent_name_hint = request.agentName
  if (typeof request.idTokenHint === 'string' && request.idTokenHint.length > 0) params.id_token_hint = request.idTokenHint
  if (typeof request.loginHint === 'string' && request.loginHint.length > 0) params.login_hint = request.loginHint
  url.search = new URLSearchParams(params).toString()
  return url.href
}

/**
 * Run the Sign in with ChatGPT flow.
 * @param request - interaction, cancellation, config, and the previous grant.
 * @returns the grant to store.
 */
async function loginSiwc(request) {
  const { interaction, signal, config, previous } = request
  const requestedLabel = typeof request.label === 'string' && request.label.trim().length > 0 ? request.label.trim() : undefined
  const hostId = typeof config.hostId === 'string' && config.hostId.length > 0 ? config.hostId : undefined
  if (hostId === undefined) throw new Error(message(config.lang, 'siwcHostMissing'))
  const pkce = createPkce()
  const state = randomState()
  const nonce = randomState()
  const returningClientId = typeof previous?.clientId === 'string' && previous.clientId.length > 0 ? previous.clientId : undefined
  let loopback
  try {
    loopback = await startLoopback({ port: SIWC.callbackPort, path: SIWC.callbackPath, timeoutMs: config.loginTimeoutMs })
  } catch (_portBusy) {
    loopback = await startLoopback({ port: 0, path: SIWC.callbackPath, timeoutMs: config.loginTimeoutMs })
  }
  const redirectUri = loopback.redirectUri
  const authorizeUrl = siwcAuthorizeUrl({
    clientId: returningClientId ?? SIWC.dynamicClientId,
    redirectUri,
    state,
    nonce,
    codeChallenge: pkce.challenge,
    hostId,
    ...returningClientId === undefined ? { agentName: requestedLabel ?? config.siwcAgentName } : {},
    ...returningClientId === undefined ? {} : { idTokenHint: previous.idToken },
    ...returningClientId === undefined ? {} : { loginHint: previous.account },
  })
  interaction.notify({ message: message(config.lang, 'openChatgpt'), url: authorizeUrl })
  if (config.openBrowser !== false) openBrowser(authorizeUrl)
  let params
  try {
    params = await waitForParams({
      interaction,
      loopback,
      signal,
      state,
      lang: config.lang,
      message: message(config.lang, 'pastePrompt'),
      placeholder: `${redirectUri}?code=…&state=…`,
    })
  } finally {
    loopback.close()
  }
  const issuedClientId = typeof params.clientId === 'string' && params.clientId.length > 0
    ? params.clientId
    : typeof params.client_id === 'string' && params.client_id.length > 0 ? params.client_id : undefined
  const clientId = issuedClientId ?? returningClientId
  if (clientId === undefined) throw new Error('the sign-in callback carried no issued client id')
  const token = await postForm(SIWC.tokenUrl, {
    grant_type: 'authorization_code',
    client_id: clientId,
    code: params.code,
    code_verifier: pkce.verifier,
    redirect_uri: redirectUri,
    resource: SIWC.resource,
  }, { signal })
  if (typeof token.access_token !== 'string' || token.access_token.length === 0) {
    throw new Error('ChatGPT returned no access token')
  }
  if (typeof token.refresh_token !== 'string' || token.refresh_token.length === 0) {
    throw new Error('ChatGPT returned no refresh token; sign in again and keep the browser open until it reports success')
  }
  const granted = typeof token.scope === 'string' ? token.scope.split(/\s+/u) : []
  if (!granted.includes(SIWC.planScope)) throw new Error(message(config.lang, 'siwcPlanRequired'))
  const claims = await verifyIdToken(token.id_token, { clientId, nonce, signal })
  return {
    flow: FLOW_SIWC,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    idToken: token.id_token,
    clientId,
    expiresAt: expiresAt(typeof token.expires_in === 'number' ? token.expires_in : 3600),
    scope: token.scope ?? SIWC.scope,
    subject: typeof claims.sub === 'string' ? claims.sub : undefined,
    account: typeof claims.email === 'string' ? claims.email : undefined,
    label: requestedLabel ?? previous?.label,
  }
}

/**
 * Project harness messages onto Responses `input` items.
 * @param options - harness request.
 * @param images - resolved image bytes keyed by attachment id.
 * @returns the item list.
 */
function responsesInput(options, images) {
  const input = []
  const attachments = images instanceof Map ? images : new Map()
  for (const item of conversation(options)) {
    if (item.role === 'developer') {
      const text = blockText(item.content)
      if (text.length > 0) input.push({ role: 'developer', content: [{ type: 'input_text', text }] })
      continue
    }
    if (item.role === 'user') {
      const content = []
      const text = blockText(item.content)
      if (text.length > 0) content.push({ type: 'input_text', text })
      for (const block of item.content) {
        if (block === null || typeof block !== 'object' || block.type !== 'image') continue
        const image = attachments.get(block.attachment?.attachmentId)
        if (image === undefined) continue
        content.push({ type: 'input_image', detail: 'auto', image_url: `data:${image.mediaType};base64,${image.data}` })
      }
      if (content.length > 0) input.push({ role: 'user', content })
      continue
    }
    if (item.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: String(item.toolCallId),
        output: blockText(item.content) || '(no output)',
      })
      continue
    }
    if (item.role !== 'assistant') continue
    for (const block of item.content) {
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
 * Build the Sign in with ChatGPT Responses request.
 *
 * Only fields the documented contract accepts are sent: `store: false`,
 * `stream: true`, `input` history, `instructions`, reasoning effort, and plain
 * function tools. System-role input items, temperature, token caps, and cached
 * conversation ids are rejected by this route, so they are never emitted here.
 * @param options - harness request.
 * @param credential - stored grant.
 * @param context - service context (resolved images and effort wire value).
 * @returns URL, headers, and JSON body.
 */
function buildSiwcRequest(options, credential, context) {
  const effort = context.wireEffort ?? options.reasoningEffort
  const body = {
    model: options.model,
    store: false,
    stream: true,
    instructions: instructionText(options) || 'You are a helpful assistant.',
    input: responsesInput(options, context.images),
    ...(effort === undefined ? {} : { reasoning: { effort, summary: 'auto' } }),
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
  return {
    url: SIWC.apiBase + SIWC.responsesPath,
    headers: {
      authorization: `Bearer ${credential.accessToken}`,
      accept: 'text/event-stream',
      'content-type': 'application/json',
      'user-agent': USER_AGENT,
    },
    body,
  }
}

export default {
  id: 'chatgpt',
  route: 'chatgpt-sub',
  name: { zh: 'ChatGPT 订阅', en: 'ChatGPT subscription' },
  models: MODELS,
  /** Grants this channel can use; anything else is treated as signed out. */
  requiresFlow: FLOW_SIWC,

  /** Reasoning levels any model on this channel may declare. */
  reasoningEfforts: REASONING.efforts,

  /** The wire value one reasoning level sends; the level id is the effort. */
  wireValue(level) {
    return LEVELS[level]?.wire ?? level
  },

  modelInfo(model) {
    const entry = MODELS.find(candidate => candidate.id === model)
    if (entry === undefined) return undefined
    const ids = MODEL_LEVELS[model]
    return {
      ...entry,
      reasoning: ids === undefined
        ? REASONING
        : {
          efforts: ids.map(id => LEVELS[id]),
          defaultEffort: ids.includes('medium') ? 'medium' : ids[0],
        },
    }
  },

  /**
   * Run the Sign in with ChatGPT flow.
   * @param request - interaction, cancellation, config, and the previous grant.
   * @returns the grant to store.
   */
  async login(request) {
    return loginSiwc(request)
  },

  /**
   * Rotate the stored grant.
   * @param payload - stored grant.
   * @returns the rotated grant.
   */
  async refresh(payload) {
    const token = await postForm(SIWC.tokenUrl, {
      grant_type: 'refresh_token',
      client_id: payload.clientId,
      refresh_token: payload.refreshToken,
      resource: SIWC.resource,
    })
    if (typeof token.access_token !== 'string' || token.access_token.length === 0) {
      throw new Error('ChatGPT returned no refreshed access token')
    }
    return {
      ...payload,
      accessToken: token.access_token,
      refreshToken: typeof token.refresh_token === 'string' ? token.refresh_token : payload.refreshToken,
      idToken: typeof token.id_token === 'string' ? token.id_token : payload.idToken,
      expiresAt: expiresAt(typeof token.expires_in === 'number' ? token.expires_in : 3600),
      scope: typeof token.scope === 'string' ? token.scope : payload.scope,
    }
  },

  /**
   * End the renewable session at the issuer.
   * @param payload - stored grant.
   * @returns whether revocation was confirmed.
   */
  async revoke(payload) {
    return revokeSession({ clientId: payload.clientId, refreshToken: payload.refreshToken })
  },

  /**
   * Ask the account which models it may use.
   * @param credential - stored grant.
   * @returns discovered models, or an empty list when the route cannot answer.
   */
  async discoverModels(credential) {
    const response = await fetch(SIWC.apiBase + SIWC.modelsPath, {
      headers: { authorization: `Bearer ${credential.accessToken}`, accept: 'application/json' },
    })
    if (!response.ok) return []
    let body
    try {
      body = await response.json()
    } catch (_notJson) {
      return []
    }
    const list = Array.isArray(body.models) ? body.models : Array.isArray(body.data) ? body.data : []
    return list
      .filter(entry => entry !== null && typeof entry === 'object' && (entry.visibility === undefined || entry.visibility === 'list'))
      .map((entry) => {
        const id = String(entry.slug ?? entry.id ?? '')
        const known = MODELS.find(model => model.id === id)
        const levels = Array.isArray(entry.supported_reasoning_levels)
          ? entry.supported_reasoning_levels
            .map(level => String(level?.effort ?? ''))
            .filter(effort => effort.length > 0)
          : []
        return {
          id,
          name: String(entry.display_name ?? entry.name ?? id),
          contextWindow: typeof entry.context_window === 'number' ? entry.context_window : known?.contextWindow,
          maxTokens: known?.maxTokens,
          ...Array.isArray(entry.input_modalities)
            ? { inputModalities: entry.input_modalities.map(value => String(value)).filter(value => value === 'text' || value === 'image') }
            : known?.inputModalities === undefined ? {} : { inputModalities: known.inputModalities },
          ...levels.length === 0 ? {} : { efforts: levels.map(effort => ({ id: effort, name: LEVELS[effort]?.name ?? effort })) },
          ...typeof entry.default_reasoning_level === 'string' ? { defaultEffort: entry.default_reasoning_level } : {},
        }
      })
      .filter(entry => entry.id.length > 0)
  },

  /**
   * Build the Responses request for this grant.
   * @param options - harness request.
   * @param credential - stored grant.
   * @param context - service context.
   * @returns URL, headers, and JSON body.
   */
  buildRequest(options, credential, context) {
    return buildSiwcRequest(options, credential, context)
  },

  /** Translate the Responses event stream into harness chunks. */
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
      if (type === 'response.output_text.done' || type === 'response.refusal.done') {
        // Short replies sometimes arrive only as a terminal `.done` payload.
        const block = textBlock(String(event.item_id ?? 'text'))
        if (block.opened !== true) {
          block.opened = true
          yield { type: 'block-start', index: block.index, blockType: 'text' }
        }
        const complete = String(event.text ?? event.refusal ?? '')
        if (complete.length > block.text.length) {
          const suffix = complete.slice(block.text.length)
          block.text = complete
          if (suffix.length > 0) yield { type: 'text-delta', index: block.index, text: suffix }
        }
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
          error: payload.error,
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
    if (terminal === undefined) throw new Error('the ChatGPT stream ended without a terminal response event')
    if (terminal.error !== undefined && terminal.status === 'failed') {
      const error = terminal.error ?? {}
      throw new Error(`${String(error.code ?? 'response_failed')}: ${String(error.message ?? 'the provider failed the response')}`)
    }
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




