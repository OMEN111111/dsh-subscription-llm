// Regression tests for the ChatGPT stream terminal handling and adapter finish.
import test from 'node:test'
import assert from 'node:assert/strict'

import chatgpt from '../src/channels/chatgpt.js'
import { SubscriptionAdapter } from '../src/adapter.js'

/** Build an adapter over the real ChatGPT parser and a stub service. */
function harness() {
  const service = {
    instancesByRoute: new Map([['test-route', { route: 'test-route', scope: 'test', label: 'Test', channel: chatgpt }]]),
    label: () => 'Test',
    credential: async () => ({ accessToken: 'token' }),
    imagesFor: async () => new Map(),
    requestContext: () => ({ config: {} }),
    effortWire: () => undefined,
    invalidate: async () => {},
    ctx: { logger: { info() {}, debug() {} } },
  }
  return new SubscriptionAdapter(service)
}

/** Build a streaming Response from SSE frames, optionally failing afterwards. */
function streamResponse(frames, options = {}) {
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`))
      if (options.after === 'error') {
        setTimeout(() => controller.error(new TypeError('terminated')), 5)
      } else if (options.after === 'abort') {
        setTimeout(() => controller.error(new DOMException('aborted', 'AbortError')), 5)
      } else {
        controller.close()
      }
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream', ...options.headers } })
}

/** Drain one adapter stream. */
async function collect(adapter, options = {}) {
  const chunks = []
  for await (const chunk of adapter.stream({ provider: 'test-route', model: 'gpt-6.1-sol', messages: [], ...options })) {
    chunks.push(chunk)
  }
  return chunks
}

const completed = { type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 2, output_tokens: 1 } } }
const delta = { type: 'response.output_text.delta', item_id: 'm', delta: 'hi' }
const messageDone = { type: 'response.output_item.done', item: { id: 'm', type: 'message' } }

test('a reset after response.completed still finishes successfully', async () => {
  const adapter = harness()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => streamResponse([delta, messageDone, completed], { after: 'error' })
  try {
    const chunks = await collect(adapter)
    const finishes = chunks.filter(chunk => chunk.type === 'finish')
    assert.equal(finishes.length, 1)
    assert.deepEqual(finishes[0].reason, { kind: 'stop' })
    assert.ok(chunks.some(chunk => chunk.type === 'text-delta' && chunk.text === 'hi'))
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('a reset before response.completed is reported as a network failure', async () => {
  const adapter = harness()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => streamResponse([delta], { after: 'error' })
  try {
    const chunks = await collect(adapter)
    const finish = chunks.at(-1)
    assert.equal(finish.type, 'finish')
    assert.equal(finish.reason.kind, 'error')
    assert.equal(finish.reason.failure.code, 'TRANSPORT')
    assert.match(finish.reason.failure.message, /terminated/u)
    assert.equal(chunks.filter(chunk => chunk.type === 'finish').length, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('nested error events keep code, message, and request id', async () => {
  const adapter = harness()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => streamResponse(
    [{ type: 'error', error: { code: 'server_error', message: 'boom' } }],
    { headers: { 'x-oai-request-id': 'req_test_1' } },
  )
  try {
    const chunks = await collect(adapter)
    const finish = chunks.at(-1)
    assert.equal(finish.reason.kind, 'error')
    assert.equal(finish.reason.failure.code, 'SERVER')
    assert.match(finish.reason.failure.message, /server_error/u)
    assert.match(finish.reason.failure.message, /boom/u)
    assert.match(finish.reason.failure.message, /req_test_1/u)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('response.failed keeps the provider reason and does not finish as success', async () => {
  const adapter = harness()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => streamResponse([{
    type: 'response.failed',
    response: { status: 'failed', error: { code: 'rate_limit_exceeded', message: 'slow down' } },
  }])
  try {
    const chunks = await collect(adapter)
    const finish = chunks.at(-1)
    assert.equal(finish.reason.kind, 'error')
    assert.equal(finish.reason.failure.code, 'RATE_LIMIT')
    assert.match(finish.reason.failure.message, /rate_limit_exceeded/u)
    assert.match(finish.reason.failure.message, /slow down/u)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('response.incomplete is never treated as a normal stop', async () => {
  const adapter = harness()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => streamResponse([{
    type: 'response.incomplete',
    response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
  }])
  try {
    const chunks = await collect(adapter)
    const finish = chunks.at(-1)
    assert.notDeepEqual(finish.reason, { kind: 'stop' })
    assert.deepEqual(finish.reason, { kind: 'max-tokens' })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('an aborted request reports cancellation, not an upstream fault', async () => {
  const adapter = harness()
  const originalFetch = globalThis.fetch
  const controller = new AbortController()
  globalThis.fetch = async () => {
    setTimeout(() => controller.abort(), 5)
    return streamResponse([delta], { after: 'abort' })
  }
  try {
    const chunks = await collect(adapter, { signal: controller.signal })
    const finish = chunks.at(-1)
    assert.equal(finish.reason.kind, 'aborted')
    assert.equal(finish.reason.failure.code, 'ABORTED')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('tool-call streams still finish as tool-calls exactly once', async () => {
  const adapter = harness()
  const originalFetch = globalThis.fetch
  const toolStart = { type: 'response.output_item.added', item: { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'bash' } }
  const toolDelta = { type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '{"command":"ls"}' }
  const toolDone = { type: 'response.output_item.done', item: { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'bash', arguments: '{"command":"ls"}' } }
  globalThis.fetch = async () => streamResponse([toolStart, toolDelta, toolDone, completed])
  try {
    const chunks = await collect(adapter)
    assert.equal(chunks.filter(chunk => chunk.type === 'finish').length, 1)
    assert.deepEqual(chunks.at(-1).reason, { kind: 'tool-calls' })
    const call = chunks.find(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
    assert.equal(call.block.name, 'bash')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('a stream that ends without a terminal event is reported as truncated', async () => {
  const adapter = harness()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => streamResponse([delta])
  try {
    const chunks = await collect(adapter)
    const finish = chunks.at(-1)
    assert.equal(finish.reason.kind, 'error')
    assert.equal(finish.reason.failure.code, 'STREAM_CLOSED')
    assert.match(finish.reason.failure.message, /without a terminal response event/u)
    assert.equal(chunks.filter(chunk => chunk.type === 'finish').length, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('incomplete for reasons other than max tokens is an error finish', async () => {
  const adapter = harness()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => streamResponse([{
    type: 'response.incomplete',
    response: { status: 'incomplete', incomplete_details: { reason: 'content_filter' } },
  }])
  try {
    const chunks = await collect(adapter)
    const finish = chunks.at(-1)
    assert.equal(finish.reason.kind, 'error')
    assert.match(finish.reason.failure.message, /content_filter/u)
  } finally {
    globalThis.fetch = originalFetch
  }
})
