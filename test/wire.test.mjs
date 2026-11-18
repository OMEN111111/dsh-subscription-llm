// Wire-level tests for the three channel parsers and request builders.
// Run: node --test .agent/tests
import test from 'node:test'
import assert from 'node:assert/strict'

import chatgpt, { siwcAuthorizeUrl } from '../src/channels/chatgpt.js'
import claude from '../src/channels/claude.js'
import antigravity from '../src/channels/antigravity.js'

/** Build a streaming Response whose body is the given SSE payloads. */
function sseResponse(payloads) {
  const text = payloads.map(payload => `data: ${JSON.stringify(payload)}\n\n`).join('')
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

async function collect(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

const types = chunks => chunks.map(chunk => chunk.type)

test('chatgpt: text, tool call and completion map to harness chunks', async () => {
  const chunks = await collect(chatgpt.parseStream(sseResponse([
    { type: 'response.created', response: { id: 'resp_1' } },
    { type: 'response.output_item.added', item: { id: 'msg_1', type: 'message' } },
    { type: 'response.output_text.delta', item_id: 'msg_1', delta: 'Hello ' },
    { type: 'response.output_text.delta', item_id: 'msg_1', delta: 'world' },
    { type: 'response.output_item.done', item: { id: 'msg_1', type: 'message' } },
    { type: 'response.output_item.added', item: { id: 'fc_1', type: 'function_call', call_id: 'call_a', name: 'bash' } },
    { type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '{"command":' },
    { type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '"ls"}' },
    { type: 'response.output_item.done', item: { id: 'fc_1', type: 'function_call', call_id: 'call_a', name: 'bash', arguments: '{"command":"ls"}' } },
    {
      type: 'response.completed',
      response: { status: 'completed', usage: { input_tokens: 12, output_tokens: 5, total_tokens: 17, input_tokens_details: { cached_tokens: 2 } } },
    },
  ])))

  const finish = chunks.at(-1)
  assert.equal(finish.type, 'finish')
  assert.deepEqual(finish.reason, { kind: 'tool-calls' })
  const usage = chunks.find(chunk => chunk.type === 'usage')
  assert.deepEqual(usage.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 17, cacheReadTokens: 2 })
  const textEnd = chunks.find(chunk => chunk.type === 'block-end' && chunk.block.type === 'text')
  assert.equal(textEnd.block.text, 'Hello world')
  const toolEnd = chunks.find(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
  assert.deepEqual(toolEnd.block, { type: 'tool-call', id: 'call_a', name: 'bash', arguments: '{"command":"ls"}' })
  const deltaTypes = types(chunks)
  assert.ok(deltaTypes.includes('block-start'))
  assert.ok(deltaTypes.includes('text-delta'))
  assert.ok(deltaTypes.includes('tool-call-delta'))
})

test('chatgpt: a failed response surfaces as a thrown provider error', async () => {
  await assert.rejects(async () => collect(chatgpt.parseStream(sseResponse([
    { type: 'response.failed', response: { error: { code: 'server_error', message: 'boom' } } },
  ]))), /server_error: boom/u)
})

test('claude: thinking, text, tool_use and stop reason map to harness chunks', async () => {
  const chunks = await collect(claude.parseStream(sseResponse([
    { type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 9, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'plan' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hi there' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'read', input: {} } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"path":' } },
    { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"a.txt"}' } },
    { type: 'content_block_stop', index: 2 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } },
    { type: 'message_stop' },
  ])))

  assert.deepEqual(chunks.at(-1).reason, { kind: 'tool-calls' })
  const reasoning = chunks.find(chunk => chunk.type === 'block-end' && chunk.block.type === 'reasoning')
  assert.equal(reasoning.block.text, 'plan')
  const tool = chunks.find(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
  assert.deepEqual(tool.block, { type: 'tool-call', id: 'toolu_1', name: 'read', arguments: '{"path":"a.txt"}' })
  const usage = chunks.find(chunk => chunk.type === 'usage').usage
  assert.equal(usage.inputTokens, 9)
  assert.equal(usage.outputTokens, 20)
  assert.equal(usage.totalTokens, 29)
})

test('claude: an end_turn without content still finishes as stop', async () => {
  const chunks = await collect(claude.parseStream(sseResponse([
    { type: 'message_start', message: { id: 'm', usage: { input_tokens: 1, output_tokens: 1 } } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    { type: 'message_stop' },
  ])))
  assert.deepEqual(chunks.at(-1).reason, { kind: 'stop' })
})

test('antigravity: wrapped Gemini frames map text, thoughts and function calls', async () => {
  const chunks = await collect(antigravity.parseStream(sseResponse([
    {
      response: {
        candidates: [{ content: { parts: [{ text: 'think', thought: true }, { text: 'answer' }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 14, thoughtsTokenCount: 3 },
      },
    },
    {
      response: {
        candidates: [{
          content: { parts: [{ functionCall: { name: 'bash', args: { command: 'ls' }, id: 'call_1' } }] },
          finishReason: 'STOP',
        }],
      },
    },
  ])))

  const reasoning = chunks.find(chunk => chunk.type === 'block-end' && chunk.block.type === 'reasoning')
  assert.equal(reasoning.block.text, 'think')
  const text = chunks.find(chunk => chunk.type === 'block-end' && chunk.block.type === 'text')
  assert.equal(text.block.text, 'answer')
  const tool = chunks.find(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
  assert.deepEqual(tool.block, { type: 'tool-call', id: 'call_1', name: 'bash', arguments: '{"command":"ls"}' })
  assert.deepEqual(chunks.at(-1).reason, { kind: 'tool-calls' })
  assert.deepEqual(chunks.find(chunk => chunk.type === 'usage').usage, {
    inputTokens: 10, outputTokens: 4, totalTokens: 14, reasoningTokens: 3,
  })
})

test('antigravity: MAX_TOKENS becomes a max-tokens finish', async () => {
  const chunks = await collect(antigravity.parseStream(sseResponse([
    { response: { candidates: [{ content: { parts: [{ text: 'cut' }] }, finishReason: 'MAX_TOKENS' }] } },
  ])))
  assert.deepEqual(chunks.at(-1).reason, { kind: 'max-tokens' })
})

const credential = { accessToken: 'token', accountId: 'acct', refreshToken: 'refresh', project: 'proj' }
const config = { originator: 'codex_cli_rs' }

test('chatgpt: request body carries instructions, tools and history items', () => {
  const options = {
    provider: 'chatgpt-sub',
    model: 'gpt-5.5',
    system: 'You are strict.',
    messages: [
      { role: 'system', content: [{ type: 'text', text: 'system snapshot' }] },
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'calling' },
          { type: 'tool-call', id: 'call_1', name: 'bash', arguments: '{"command":"ls"}' },
        ],
      },
      { role: 'tool', toolCallId: 'call_1', content: [{ type: 'text', text: 'a.txt' }] },
    ],
    tools: [{ name: 'bash', description: 'run', parameters: { type: 'object', properties: { command: { type: 'string' } } } }],
    reasoningEffort: 'high',
    sessionId: 'session-1',
  }
  const request = chatgpt.buildRequest(options, credential, { config })
  assert.equal(request.url, 'https://chatgpt.com/backend-api/codex/responses')
  assert.equal(request.headers['chatgpt-account-id'], 'acct')
  assert.equal(request.headers['session-id'], 'session-1')
  assert.equal(request.body.instructions, 'You are strict.\n\nsystem snapshot')
  assert.deepEqual(request.body.tools.map(tool => tool.name), ['bash'])
  assert.deepEqual(request.body.reasoning, { effort: 'high', summary: 'auto' })
  const kinds = request.body.input.map(item => item.type ?? item.role)
  assert.deepEqual(kinds, ['user', 'message', 'function_call', 'function_call_output'])
})

test('claude: request body carries the identity block, tools and tool results', () => {
  const options = {
    provider: 'claude-sub',
    model: 'claude-sonnet-5-5',
    system: 'Be terse.',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', id: 'toolu_1', name: 'read', arguments: '{"path":"a"}' }],
      },
      { role: 'tool', toolCallId: 'toolu_1', content: [{ type: 'text', text: 'contents' }] },
      { role: 'tool', toolCallId: 'toolu_1', content: [{ type: 'text', text: 'second' }] },
    ],
    tools: [{ name: 'read', description: 'read a file', parameters: { type: 'object', properties: {} } }],
    reasoningEffort: 'low',
  }
  const request = claude.buildRequest(options, credential, { config })
  assert.equal(request.url, 'https://api.anthropic.com/v1/messages')
  assert.equal(request.headers.authorization, 'Bearer token')
  assert.ok(request.headers['anthropic-beta'].includes('oauth-2025-04-20'))
  assert.equal(request.body.system[0].text, "You are Claude Code, Anthropic's official CLI tool for Claude.")
  assert.equal(request.body.system[1].text, 'Be terse.')
  assert.deepEqual(request.body.thinking, { type: 'enabled', budget_tokens: 1024 })
  assert.ok(request.body.max_tokens > 1024)
  const results = request.body.messages.at(-1)
  assert.equal(results.role, 'user')
  assert.deepEqual(results.content.map(block => block.type), ['tool_result', 'tool_result'])
})

test('antigravity: request body is wrapped and tools use upper-case schema types', () => {
  const options = {
    provider: 'google-antigravity',
    model: 'gemini-4-argon-high',
    system: 'Be brief.',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    tools: [{
      name: 'bash',
      description: 'run',
      parameters: { type: 'object', properties: { command: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } } },
    }],
    reasoningEffort: 'medium',
  }
  const request = antigravity.buildRequest(options, credential, { config })
  assert.match(request.url, /v1internal:streamGenerateContent\?alt=sse$/u)
  assert.equal(request.body.project, 'proj')
  assert.equal(request.body.model, 'gemini-4-argon-high')
  assert.equal(request.body.requestType, 'agent')
  assert.deepEqual(request.body.request.generationConfig.thinkingConfig, { includeThoughts: true, thinkingLevel: 'medium' })
  const declarations = request.body.request.tools[0].functionDeclarations
  assert.equal(declarations[0].parameters.type, 'OBJECT')
  assert.equal(declarations[0].parameters.properties.args.type, 'ARRAY')
  assert.deepEqual(declarations[0].parameters.properties.args.items, { type: 'STRING' })
})



test('antigravity: the missing-secret guidance names every configuration point', async () => {
  const { message } = await import('../src/copy.js')
  for (const lang of ['zh', 'en']) {
    const text = message(lang, 'antigravityNeedsSecret')
    assert.match(text, /googleClientSecret/u)
    assert.match(text, /DSH_ANTIGRAVITY_CLIENT_SECRET/u)
  }
})

const imageMessages = [
  {
    role: 'user',
    content: [
      { type: 'text', text: 'what is this?' },
      { type: 'image', attachment: { attachmentId: 'att-1', mediaType: 'image/png', bytes: 4, width: 2, height: 2 } },
    ],
  },
]
const imageContext = { config, images: new Map([['att-1', { mediaType: 'image/png', data: 'AAAA' }]]) }

test('chatgpt: a user image becomes an input_image data URL', () => {
  const request = chatgpt.buildRequest({ provider: 'chatgpt-sub', model: 'gpt-5.5', messages: imageMessages }, credential, imageContext)
  const user = request.body.input[0]
  assert.deepEqual(user.content[0], { type: 'input_text', text: 'what is this?' })
  assert.deepEqual(user.content[1], { type: 'input_image', detail: 'auto', image_url: 'data:image/png;base64,AAAA' })
})

test('chatgpt: without resolved bytes the image block is omitted, text kept', () => {
  const request = chatgpt.buildRequest({ provider: 'chatgpt-sub', model: 'gpt-5.5', messages: imageMessages }, credential, { config })
  const user = request.body.input[0]
  assert.deepEqual(user.content, [{ type: 'input_text', text: 'what is this?' }])
})

test('claude: a user image becomes a base64 source block', () => {
  const request = claude.buildRequest({ provider: 'claude-sub', model: 'claude-sonnet-5-5', messages: imageMessages }, credential, imageContext)
  const user = request.body.messages[0]
  assert.deepEqual(user.content[1], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } })
})

test('antigravity: a user image becomes an inlineData part', () => {
  const request = antigravity.buildRequest({ provider: 'google-antigravity', model: 'gemini-4-argon-high', messages: imageMessages }, credential, imageContext)
  const user = request.body.request.contents[0]
  assert.deepEqual(user.parts[1], { inlineData: { mimeType: 'image/png', data: 'AAAA' } })
})


const siwcCredential = { flow: 'siwc', accessToken: 'siwc-token', refreshToken: 'siwc-refresh', clientId: 'oaiapp_example', expiresAt: Date.now() + 3_600_000 }

test('siwc: the authorization URL carries the documented parameters', () => {
  const url = new URL(siwcAuthorizeUrl({
    clientId: 'dynamic_agent_client',
    redirectUri: 'http://127.0.0.1:1455/auth/callback',
    state: 'state-1',
    nonce: 'nonce-1',
    codeChallenge: 'challenge-1',
    hostId: 'urn:uuid:host-1',
    agentName: 'DeepSeek Harness',
  }))
  assert.equal(url.origin + url.pathname, 'https://auth.openai.com/api/accounts/authorize')
  const params = url.searchParams
  assert.equal(params.get('client_id'), 'dynamic_agent_client')
  assert.equal(params.get('response_type'), 'code')
  assert.equal(params.get('redirect_uri'), 'http://127.0.0.1:1455/auth/callback')
  assert.equal(params.get('resource'), 'https://api.openai.com/v1')
  assert.equal(params.get('state'), 'state-1')
  assert.equal(params.get('nonce'), 'nonce-1')
  assert.equal(params.get('code_challenge'), 'challenge-1')
  assert.equal(params.get('code_challenge_method'), 'S256')
  assert.equal(params.get('ext_agent_host_id'), 'urn:uuid:host-1')
  assert.equal(params.get('agent_name_hint'), 'DeepSeek Harness')
  assert.match(params.get('scope'), /chatgpt\.tokens\.use\.direct/u)
  assert.match(params.get('scope'), /resource\.invoke/u)
})

test('siwc: a returning sign-in reuses its client id and adds hints', () => {
  const url = new URL(siwcAuthorizeUrl({
    clientId: 'oaiapp_saved',
    redirectUri: 'http://127.0.0.1:1455/auth/callback',
    state: 's',
    nonce: 'n',
    codeChallenge: 'c',
    hostId: 'urn:uuid:host-1',
    idTokenHint: 'id-token',
    loginHint: 'person@example.com',
  }))
  assert.equal(url.searchParams.get('client_id'), 'oaiapp_saved')
  assert.equal(url.searchParams.has('agent_name_hint'), false)
  assert.equal(url.searchParams.get('id_token_hint'), 'id-token')
  assert.equal(url.searchParams.get('login_hint'), 'person@example.com')
})

test('siwc: requests go to the public Responses API with the documented body', () => {
  const options = {
    provider: 'chatgpt-sub',
    model: 'gpt-6.1-sol',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    reasoningEffort: 'xhigh',
    temperature: 0.9,
    tools: [{ name: 'bash', description: 'run', parameters: { type: 'object', properties: {} } }],
  }
  const request = chatgpt.buildRequest(options, siwcCredential, { config, wireEffort: 'xhigh', images: new Map() })
  assert.equal(request.url, 'https://api.openai.com/v1/responses')
  assert.equal(request.headers.authorization, 'Bearer siwc-token')
  assert.equal(request.headers['chatgpt-account-id'], undefined)
  assert.equal(request.headers.originator, undefined)
  assert.equal(request.body.store, false)
  assert.equal(request.body.stream, true)
  assert.equal(request.body.temperature, undefined)
  assert.equal(request.body.text, undefined)
  assert.equal(request.body.prompt_cache_key, undefined)
  assert.equal(request.body.max_output_tokens, undefined)
  assert.deepEqual(request.body.reasoning, { effort: 'xhigh', summary: 'auto' })
  assert.deepEqual(request.body.tools.map(tool => tool.type), ['function'])
})

test('codex: a legacy grant keeps the ChatGPT backend route', () => {
  const legacy = { flow: 'codex', accessToken: 'codex-token', accountId: 'acct', refreshToken: 'r', expiresAt: Date.now() + 3_600_000 }
  const request = chatgpt.buildRequest(
    { provider: 'chatgpt-sub', model: 'gpt-5.5', messages: [], sessionId: 'session-1' },
    legacy,
    { config, wireEffort: 'high', images: new Map() },
  )
  assert.equal(request.url, 'https://chatgpt.com/backend-api/codex/responses')
  assert.equal(request.headers['chatgpt-account-id'], 'acct')
  assert.equal(request.headers['session-id'], 'session-1')
  assert.equal(request.body.store, false)
  assert.deepEqual(request.body.text, { verbosity: 'low' })
})

test('siwc: refresh sends the issued client id and resource', async () => {
  const originalFetch = globalThis.fetch
  let seen
  globalThis.fetch = async (url, init) => {
    seen = { url: String(url), body: String(init?.body ?? '') }
    return new Response(JSON.stringify({ access_token: 'fresh', refresh_token: 'rotate', expires_in: 3600 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    const next = await chatgpt.refresh(siwcCredential, config)
    assert.match(seen.url, /\/api\/accounts\/oauth\/token$/u)
    assert.match(seen.body, /grant_type=refresh_token/u)
    assert.match(seen.body, /client_id=oaiapp_example/u)
    assert.match(seen.body, /resource=https%3A%2F%2Fapi\.openai\.com%2Fv1/u)
    assert.equal(next.accessToken, 'fresh')
    assert.equal(next.refreshToken, 'rotate')
    assert.equal(next.clientId, 'oaiapp_example')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('siwc: the model listing maps slugs and drops hidden entries', async () => {
  const originalFetch = globalThis.fetch
  let seenUrl
  globalThis.fetch = async (url) => {
    seenUrl = String(url)
    return new Response(JSON.stringify({
      models: [
        { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol', visibility: 'list' },
        { slug: 'internal-only', display_name: 'Hidden', visibility: 'hidden' },
        { slug: 'gpt-experimental-x' },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const models = await chatgpt.discoverModels(siwcCredential, config)
    assert.equal(seenUrl, 'https://api.openai.com/v1/models')
    assert.deepEqual(models.map(model => model.id), ['gpt-6.1-sol', 'gpt-experimental-x'])
    assert.equal(models[0].contextWindow, 500_000)
    assert.equal(models[1].name, 'gpt-experimental-x')
  } finally {
    globalThis.fetch = originalFetch
  }
})

