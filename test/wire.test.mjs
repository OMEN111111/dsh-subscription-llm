// Wire-level tests for the three channel parsers and request builders.
// Run: node --test .agent/tests
import test from 'node:test'
import assert from 'node:assert/strict'

import chatgpt from '../src/channels/chatgpt.js'
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



test('antigravity: a missing client secret fails before any browser work', async () => {
  await assert.rejects(
    antigravity.login({
      interaction: { notify() {}, prompt: async () => '' },
      signal: undefined,
      config: { lang: 'en', openBrowser: false },
    }),
    /googleClientSecret[\s\S]*DSH_ANTIGRAVITY_CLIENT_SECRET/u,
  )
})
