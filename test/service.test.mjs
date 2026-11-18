// Service + adapter integration tests against an in-memory Host.
import test from 'node:test'
import assert from 'node:assert/strict'

import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SubscriptionService } from '../src/service.js'
import { normalizeConfig } from '../src/config.js'
import { recordKey, readSet, readLink, writeLink, selectAccount } from '../src/store.js'
import { CHANNEL_BY_ID } from '../src/channels/index.js'

// Never reach the network: discovery gets a 404 unless a test installs its own mock.
globalThis.fetch = async () => new Response('', { status: 404 })


/** Route id of the (single) ChatGPT instance, once registered. */
const chatgptRoute = host => [...host.adapters.keys()].find(route => route.startsWith('chatgpt-sub'))

/** One ChatGPT provider instance with a linked fake grant, for catalog tests. */
function testChatgpt(service) {
  return service.instanceOf(CHANNEL_BY_ID.get('chatgpt'), {
    flow: 'siwc',
    clientId: 'oaiapp_test',
    accessToken: 'tok',
    refreshToken: 'ref',
    expiresAt: Date.now() + 3_600_000,
    account: 'test@example.com',
  }, 'chatgpt-test', 'chatgpt-sub-test')
}

// Keep the catalog document inside a throwaway home instead of the real ~/.dsh.
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-subscription-channels-test-'))

/** A minimal Cordis-shaped Host: credential store, LLM registry, authorization seam. */
function makeHost({ withAuthorization = true } = {}) {
  const records = new Map()
  const adapters = new Map()
  const flows = new Map()
  const credentials = {
    async readRecord(key) { return records.get(key) },
    async modifyRecord(key, mutate) {
      const next = await mutate(records.get(key))
      if (next === undefined) records.delete(key)
      else records.set(key, next)
      return next
    },
    async deleteRecord(key) { records.delete(key) },
  }
  const llm = {
    registerAdapter(providers, adapter) {
      for (const provider of providers) {
        if (adapters.has(provider)) throw new Error('DUPLICATE_ADAPTER')
      }
      for (const provider of providers) adapters.set(provider, adapter)
      const handle = () => { for (const provider of providers) adapters.delete(provider) }
      handle.replace = () => {}
      return handle
    },
    listProviders() { return [...adapters.keys()].map(id => ({ id, name: id })) },
    async listModels(provider) { return adapters.get(provider).listModels(provider) },
    async resolveModelInfo(provider, model) { return adapters.get(provider).resolveModel(provider, model) },
  }
  const authorization = withAuthorization
    ? {
        registerFlow(flow) {
          flows.set(flow.key, flow)
          return () => flows.delete(flow.key)
        },
        async begin({ key, method, interaction }) {
          const flow = flows.get(key)
          if (flow === undefined) throw new Error(`NO_FLOW ${key}`)
          return flow.run({
            method,
            signal: new AbortController().signal,
            commit: async record => { records.set(key, record) },
            notify: notice => interaction.notify(notice),
            prompt: prompt => interaction.prompt(prompt),
          }).then(() => ({ status: 'authorized' }))
        },
      }
    : undefined
  const services = new Map([['credentials', credentials], ['llm', llm]])
  if (authorization !== undefined) services.set('authorization', authorization)
  const warnings = []
  const ctx = {
    get: name => services.get(name),
    effect: (callback) => {
      const disposer = callback()
      return () => { if (typeof disposer === 'function') disposer() }
    },
    logger: { warn: message => warnings.push(String(message)), info: () => {} },
  }
  return { ctx, records, adapters, flows, warnings }
}

const config = normalizeConfig({})

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = predicate()
    if (value !== undefined && value !== false) return value
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('timed out waiting for condition')
}

/** A channel that signs in without touching a browser. */
function fakeChannel() {
  return {
    id: 'chatgpt',
    route: 'chatgpt-sub',
    name: { zh: 'ChatGPT 订阅', en: 'ChatGPT subscription' },
    models: [{ id: 'gpt-test', name: 'GPT Test', contextWindow: 1000, maxTokens: 100 }],
    modelInfo: model => (model === 'gpt-test'
      ? {
          id: 'gpt-test',
          name: 'GPT Test',
          contextWindow: 1000,
          maxTokens: 100,
          reasoning: { efforts: [{ id: 'low', name: 'Low' }], defaultEffort: 'low' },
        }
      : undefined),
    async login({ interaction }) {
      interaction.notify({ message: 'Open the sign-in page.', url: 'https://example.test/authorize' })
      const code = await interaction.prompt({ kind: 'text', message: 'Paste the callback URL.', placeholder: 'url' })
      if (code !== 'abc') throw new Error('unexpected answer')
      return {
        flow: 'siwc',
        clientId: 'oaiapp_fake',
        accessToken: 'tok',
        refreshToken: 'ref',
        expiresAt: Date.now() + 3_600_000,
        accountId: 'acct-123',
        account: 'me@example.test',
      }
    },
  }
}

test('a clean profile exposes no account cards', async () => {
  const host = makeHost()
  const service = new SubscriptionService(host.ctx, config)
  service.start()
  const state = await service.state()
  assert.deepEqual(state.channels, [])
  assert.equal(host.adapters.size, 0)
  assert.equal(host.flows.size, 3)
  service.dispose()
})

test('a completed sign-in stores the grant and publishes the route', async () => {
  const host = makeHost({ withAuthorization: false })
  const service = new SubscriptionService(host.ctx, config)
  const channel = fakeChannel()
  const attempt = {
    id: 'attempt-1',
    channelId: channel.id,
    status: 'pending',
    notices: [],
    prompt: undefined,
    cancelled: false,
    controller: new AbortController(),
    createdAt: Date.now(),
  }
  service.attempts.set(attempt.id, attempt)
  service.active.set(channel.id, attempt)
  const running = service.runAttempt(attempt, channel)

  const view = await waitFor(() => (service.attempt('attempt-1').prompt === undefined ? undefined : service.attempt('attempt-1')))
  assert.equal(view.status, 'pending')
  assert.ok(view.notices.some(notice => notice.url === 'https://example.test/authorize'))
  assert.equal(view.prompt.message, 'Paste the callback URL.')

  assert.equal(service.answer('attempt-1', 'abc'), true)
  await running

  assert.equal(service.attempt('attempt-1').status, 'authorized')
  const stored = host.records.get(recordKey('chatgpt'))
  assert.equal(stored.kind, 'grant')
  assert.equal(stored.payload.version, 1)
  assert.equal(stored.payload.selected, 'oaiapp_fake')
  assert.equal(stored.payload.accounts[0].clientId, 'oaiapp_fake')
  assert.ok(chatgptRoute(host) !== undefined)

  // The route serves the real ChatGPT catalog; the fake channel only replaced the sign-in.
  const models = await host.ctx.get('llm').listModels(chatgptRoute(host))
  assert.ok(models.length > 0)
  const resolved = await host.ctx.get('llm').resolveModelInfo(chatgptRoute(host), models[0].id)
  assert.ok(resolved.context.contextWindow > 0)
  assert.ok(resolved.reasoning.efforts.length > 0)

  const state = await service.state()
  assert.equal(state.channels.find(entry => entry.channelId === 'chatgpt').linked, true)
  assert.equal(state.channels.find(entry => entry.channelId === 'chatgpt').account, 'me@example.test')
  service.dispose()
})

test('a failing channel marks the attempt failed and stores nothing', async () => {
  const host = makeHost({ withAuthorization: false })
  const service = new SubscriptionService(host.ctx, config)
  const channel = { ...fakeChannel(), async login() { throw new Error('provider said no') } }
  const attempt = {
    id: 'attempt-2',
    channelId: 'chatgpt',
    status: 'pending',
    notices: [],
    prompt: undefined,
    cancelled: false,
    controller: new AbortController(),
    createdAt: Date.now(),
  }
  service.attempts.set(attempt.id, attempt)
  await service.runAttempt(attempt, channel)
  assert.equal(service.attempt('attempt-2').status, 'failed')
  assert.equal(service.attempt('attempt-2').error, 'provider said no')
  assert.equal(host.records.size, 0)
  service.dispose()
})

test('logging out withdraws the route and the stored grant', async () => {
  const host = makeHost()
  host.records.set(recordKey('claude'), {
    kind: 'grant',
    payload: { version: 1, accessToken: 'tok', refreshToken: 'ref', expiresAt: Date.now() + 3_600_000, account: 'me@example.com' },
  })
  const service = new SubscriptionService(host.ctx, config)
  service.start()
  await waitFor(() => host.adapters.has('claude-sub'))

  const before = await service.state()
  assert.equal(before.channels.find(channel => channel.channelId === 'claude').account, 'me@example.com')

  await service.logout('claude')
  assert.equal(host.records.has(recordKey('claude')), false)
  assert.equal(host.adapters.has('claude-sub'), false)
  assert.deepEqual((await service.state()).channels, [])
  service.dispose()
})

test('an expiring grant rotates through the channel refresh before use', async () => {
  const host = makeHost()
  host.records.set(recordKey('chatgpt'), {
    kind: 'grant',
    payload: { flow: 'siwc', clientId: 'oaiapp_test',
      version: 1,
      accessToken: 'stale',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() - 1000,
      accountId: 'acct-1',
    },
  })
  const originalFetch = globalThis.fetch
  const seen = []
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), body: String(init?.body ?? '') })
    return new Response(JSON.stringify({ access_token: 'fresh', refresh_token: 'refresh-2', expires_in: 3600 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  const service = new SubscriptionService(host.ctx, config)
  service.start()
  await waitFor(() => chatgptRoute(host) !== undefined)
  try {
    const credential = await service.credential(CHANNEL_BY_ID.get('chatgpt'), undefined)
    assert.equal(credential.accessToken, 'fresh')
    assert.equal(seen[0].url, 'https://auth.openai.com/api/accounts/oauth/token')
    assert.match(seen[0].body, /grant_type=refresh_token/u)
    assert.match(seen[0].body, /resource=https%3A%2F%2Fapi\.openai\.com%2Fv1/u)
    const stored = host.records.get(recordKey('chatgpt')).payload.accounts[0]
    assert.equal(stored.accessToken, 'fresh')
    assert.equal(stored.clientId, 'oaiapp_test')
  } finally {
    globalThis.fetch = originalFetch
    service.dispose()
  }
})

test('the adapter streams a mocked provider response and classifies failures', async () => {
  const host = makeHost()
  host.records.set(recordKey('chatgpt'), {
    kind: 'grant',
    payload: { flow: 'siwc', clientId: 'oaiapp_test', version: 1, accessToken: 'tok', refreshToken: 'ref', expiresAt: Date.now() + 3_600_000, accountId: 'acct' },
  })
  const service = new SubscriptionService(host.ctx, config)
  service.start()
  await waitFor(() => chatgptRoute(host) !== undefined)
  const adapter = host.adapters.get(chatgptRoute(host))

  const originalFetch = globalThis.fetch
  const sse = 'data: {"type":"response.output_text.delta","item_id":"m","delta":"hi"}\n\n'
    + 'data: {"type":"response.output_item.done","item":{"id":"m","type":"message"}}\n\n'
    + 'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":3,"output_tokens":1,"total_tokens":4}}}\n\n'
  globalThis.fetch = async () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  try {
    const chunks = []
    for await (const chunk of adapter.stream({ provider: chatgptRoute(host), model: 'gpt-5.5', messages: [] })) chunks.push(chunk)
    assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'stop' } })
    assert.ok(chunks.some(chunk => chunk.type === 'text-delta' && chunk.text === 'hi'))
  } finally {
    globalThis.fetch = originalFetch
  }

  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401 })
  try {
    const chunks = []
    for await (const chunk of adapter.stream({ provider: chatgptRoute(host), model: 'gpt-5.5', messages: [] })) chunks.push(chunk)
    assert.deepEqual(chunks.at(-1), {
      type: 'finish',
      reason: { kind: 'error', failure: { message: 'invalid api key', code: 'INVALID_CREDENTIAL', status: 401 } },
    })
    // The rejected grant is forgotten, so the channel reads as signed out.
    await waitFor(() => chatgptRoute(host) === undefined)
    assert.equal(chatgptRoute(host), undefined)
    assert.equal(host.records.get(recordKey('chatgpt')).payload.accounts[0].accessToken, undefined)
  } finally {
    globalThis.fetch = originalFetch
    service.dispose()
  }
})

test('a route with no stored grant reports a sign-in failure instead of calling the provider', async () => {
  const host = makeHost()
  const service = new SubscriptionService(host.ctx, config)
  service.start()
  host.adapters.set('claude-sub', service.adapter)
  const chunks = []
  for await (const chunk of service.adapter.stream({ provider: 'claude-sub', model: 'claude-sonnet-5-5', messages: [] })) chunks.push(chunk)
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].reason.kind, 'error')
  assert.equal(chunks[0].reason.failure.code, 'PROVIDER_ERROR')
  service.dispose()
})


test('state derives expiry from the stored grant', async () => {
  const host = makeHost()
  host.records.set(recordKey('chatgpt'), {
    kind: 'grant',
    payload: { flow: 'siwc', clientId: 'oaiapp_test', version: 1, accessToken: 'a', refreshToken: '', expiresAt: Date.now() - 1000 },
  })
  host.records.set(recordKey('claude'), {
    kind: 'grant',
    payload: { version: 1, accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() - 1000 },
  })
  const service = new SubscriptionService(host.ctx, config)
  service.start()
  const state = await service.state()
  assert.equal(state.channels.find(channel => channel.channelId === 'chatgpt').status, 'expired')
  assert.equal(state.channels.find(channel => channel.channelId === 'claude').status, 'expiring')
  assert.equal(state.channels.some(channel => channel.channelId === 'antigravity'), false)
  service.dispose()
})

test('a silent channel settles as a timeout, not as a cancel', async () => {
  const host = makeHost({ withAuthorization: false })
  const service = new SubscriptionService(host.ctx, { ...config, loginTimeoutMs: 60 })
  const channel = {
    ...fakeChannel(),
    async login({ interaction }) {
      interaction.notify({ message: 'waiting' })
      await interaction.prompt({ kind: 'text', message: 'paste' })
      return {}
    },
  }
  const attempt = {
    id: 'attempt-timeout',
    channelId: 'chatgpt',
    status: 'pending',
    notices: [],
    prompt: undefined,
    cancelled: false,
    controller: new AbortController(),
    createdAt: Date.now(),
  }
  service.attempts.set(attempt.id, attempt)
  await service.runAttempt(attempt, channel)
  assert.equal(service.attempt('attempt-timeout').status, 'failed')
  assert.match(service.attempt('attempt-timeout').error, /超时/u)
  service.dispose()
})



test('catalog edits hide models, change capacity, and persist', async () => {
  const host = makeHost()
  const service = new SubscriptionService(host.ctx, config)
  const channel = testChatgpt(service)
  const original = service.models(channel).map(entry => entry.id)
  assert.ok(original.includes('gpt-5.5'))

  await service.updateModel(channel, 'gpt-5.5', { visible: false, contextWindow: 123_456, efforts: ['low'], input: ['text', 'image'] })
  assert.equal(service.models(channel).some(entry => entry.id === 'gpt-5.5'), false)
  const entry = service.model(channel, 'gpt-5.5')
  assert.equal(entry.visible, false)
  assert.equal(entry.contextWindow, 123_456)
  assert.deepEqual(entry.reasoning.efforts.map(effort => effort.id), ['low'])
  assert.deepEqual(entry.inputModalities, ['text', 'image'])

  service.instancesByRoute.set(channel.route, channel)
  const listed = await service.adapter.listModels(channel.route)
  assert.equal(listed.some(model => model.id === 'gpt-5.5'), false)
  const hidden = await service.adapter.resolveModel(channel.route, 'gpt-5.5')
  assert.equal(hidden.context.contextWindow, 123_456)
  assert.deepEqual(hidden.inputModalities, ['text', 'image'])

  const document = JSON.parse(readFileSync(join(process.env.DSH_HOME, 'subscription-channels', 'catalog.json'), 'utf8'))
  assert.equal(document.channels[channel.id].overrides['gpt-5.5'].contextWindow, 123_456)

  await service.updateModel(channel, 'gpt-5.5', { visible: true, contextWindow: undefined, efforts: undefined, input: ['text'] })
  assert.ok(service.models(channel).some(model => model.id === 'gpt-5.5'))
  assert.deepEqual(service.model(channel, 'gpt-5.5').inputModalities, ['text'])
  service.dispose()
})

test('discovery adopts the channel catalog and can restore hidden models', async () => {
  const host = makeHost()
  const service = new SubscriptionService(host.ctx, config)
  const channel = CHANNEL_BY_ID.get('claude')
  await service.updateModel(channel, 'claude-opus-5-5', { visible: false })
  await service.updateModel(channel, 'claude-sonnet-5-5', { visible: false })
  assert.equal((await service.channelCatalog(channel)).hiddenCount, 2)

  const view = await service.discover(channel, { restore: true })
  assert.equal(view.hiddenCount, 0)
  assert.ok(view.visibleCount >= 7)
  assert.equal(view.discoveredModels >= 7, true)
  const document = JSON.parse(readFileSync(join(process.env.DSH_HOME, 'subscription-channels', 'catalog.json'), 'utf8'))
  assert.ok(document.channels.claude.discovered.length >= 7)
  service.dispose()
})

test('a probe reports success, auth failure, and quota with reasons', async () => {
  const host = makeHost()
  host.records.set(recordKey('chatgpt'), {
    kind: 'grant',
    payload: { flow: 'siwc', clientId: 'oaiapp_test', version: 1, accessToken: 'tok', refreshToken: 'ref', expiresAt: Date.now() + 3_600_000, accountId: 'acct' },
  })
  const service = new SubscriptionService(host.ctx, config)
  const channel = testChatgpt(service)
  const originalFetch = globalThis.fetch
  const sse = 'data: {"type":"response.output_text.delta","item_id":"m","delta":"pong"}\n\n'

  globalThis.fetch = async () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  try {
    const verdict = await service.testModel(channel, 'gpt-5.5', undefined)
    assert.equal(verdict.ok, true)
    assert.equal(verdict.status, 200)
    assert.equal(typeof verdict.latencyMs, 'number')
  } finally {
    globalThis.fetch = originalFetch
  }

  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 })
  try {
    const verdict = await service.testModel(channel, 'gpt-5.5', undefined)
    assert.equal(verdict.ok, false)
    assert.equal(verdict.code, 'INVALID_CREDENTIAL')
    assert.match(verdict.reason, /授权/u)
  } finally {
    globalThis.fetch = originalFetch
  }

  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), { status: 429 })
  try {
    const verdict = await service.testModel(channel, 'gpt-5.5', undefined)
    assert.equal(verdict.ok, false)
    assert.equal(verdict.code, 'QUOTA')
    assert.match(verdict.reason, /额度/u)
  } finally {
    globalThis.fetch = originalFetch
  }
  service.dispose()
})


test('catalog order, custom models, and reset round-trip', async () => {
  const host = makeHost()
  const service = new SubscriptionService(host.ctx, config)
  const channel = testChatgpt(service)
  const ids = service.models(channel).map(model => model.id)

  const reversed = await service.updateOrder(channel, [...ids].reverse())
  assert.deepEqual(reversed.models.map(model => model.id), [...ids].reverse())

  const created = await service.createModel(channel, 'gpt-custom-x', 'Custom X')
  assert.equal(created.customized, true)
  assert.ok(created.models.some(model => model.id === 'gpt-custom-x' && model.custom === true))
  assert.ok(service.models(channel).some(model => model.id === 'gpt-custom-x'))
  const wire = service.model(channel, 'gpt-custom-x').availableEfforts
  assert.deepEqual(wire.map(effort => effort.wire), ['low', 'medium', 'high'])

  const dropped = await service.updateModel(channel, 'gpt-custom-x', { visible: false })
  assert.equal(dropped.models.some(model => model.id === 'gpt-custom-x'), false)

  await service.updateModel(channel, 'gpt-5.5', { visible: false, contextWindow: 300_000 })
  channel.account = undefined
  const reset = await service.resetCatalog(channel)
  assert.equal(reset.hiddenCount, 0)
  assert.equal(reset.customized, false)
  assert.equal(service.model(channel, 'gpt-5.5').contextWindow, 272_000)
  assert.deepEqual(service.models(channel).map(model => model.id), ids)
  service.dispose()
})

test('fetching lists candidates and adopting the picked ones restores them', async () => {
  const host = makeHost()
  const service = new SubscriptionService(host.ctx, config)
  const channel = testChatgpt(service)
  await service.updateModel(channel, 'gpt-5.5', { visible: false })
  assert.equal((await service.channelCatalog(channel)).hiddenCount, 1)

  const view = await service.discover(channel)
  assert.equal(view.hiddenCount, 1)
  assert.ok(view.candidates.some(candidate => candidate.id === 'gpt-5.5'))

  const adopted = await service.adoptModels(channel, ['gpt-5.5'])
  assert.equal(adopted.hiddenCount, 0)
  assert.ok(adopted.models.some(model => model.id === 'gpt-5.5'))
  service.dispose()
})

test('claude reasoning levels expose a thinking budget as their wire value', async () => {
  const host = makeHost()
  const service = new SubscriptionService(host.ctx, config)
  const channel = CHANNEL_BY_ID.get('claude')
  const entry = service.model(channel, 'claude-sonnet-5-5')
  const low = entry.availableEfforts.find(effort => effort.id === 'low')
  assert.equal(low.wire, 'budget 1024 tokens')
  service.dispose()
})

test('gpt-6.1-sol declares its five reasoning levels with wire values', async () => {
  const host = makeHost()
  const service = new SubscriptionService(host.ctx, config)
  const channel = testChatgpt(service)
  const entry = service.model(channel, 'gpt-6.1-sol')
  assert.deepEqual(entry.availableEfforts.map(effort => effort.id), ['low', 'medium', 'high', 'xhigh', 'ultra'])
  assert.deepEqual(entry.reasoning.efforts.map(effort => effort.id), ['low', 'medium', 'high', 'xhigh', 'ultra'])
  assert.equal(service.effortWire(channel, 'gpt-6.1-sol', 'xhigh'), 'xhigh')
  assert.equal(service.effortWire(channel, 'gpt-6.1-sol', 'ultra'), 'ultra')
  service.dispose()
})

test('a custom level keeps its edited wire value', async () => {
  const host = makeHost()
  const service = new SubscriptionService(host.ctx, config)
  const channel = CHANNEL_BY_ID.get('claude')
  await service.updateModel(channel, 'claude-sonnet-5-5', { efforts: [{ id: 'high', wire: 'budget 20000 tokens' }] })
  const entry = service.model(channel, 'claude-sonnet-5-5')
  assert.deepEqual(entry.efforts, [{ id: 'high', name: 'High', wire: 'budget 20000 tokens' }])
  assert.equal(service.effortWire(channel, 'claude-sonnet-5-5', 'high'), 'budget 20000 tokens')
  service.dispose()
})

test('removing a model hides it from the editor list and adoption brings it back', async () => {
  const host = makeHost()
  const service = new SubscriptionService(host.ctx, config)
  const channel = testChatgpt(service)
  await service.updateModel(channel, 'gpt-5.5', { visible: false })
  assert.equal((await service.channelCatalog(channel)).models.some(model => model.id === 'gpt-5.5'), false)
  assert.equal((await service.channelCatalog(channel)).hiddenCount, 1)

  const adopted = await service.adoptModels(channel, ['gpt-5.5', 'gpt-not-listed'])
  assert.equal(adopted.models.some(model => model.id === 'gpt-5.5'), true)
  assert.equal(adopted.models.some(model => model.id === 'gpt-not-listed' && model.custom === true), true)
  service.dispose()
})



test('credential sets keep every registration and select one', async () => {
  const host = makeHost()
  const now = Date.now() + 3_600_000
  await writeLink(host.ctx, 'chatgpt', { flow: 'siwc', clientId: 'oaiapp_a', account: 'a@example.com', accessToken: 't1', refreshToken: 'r1', expiresAt: now })
  await writeLink(host.ctx, 'chatgpt', { flow: 'siwc', clientId: 'oaiapp_b', account: 'b@example.com', accessToken: 't2', refreshToken: 'r2', expiresAt: now })
  const set = await readSet(host.ctx, 'chatgpt')
  assert.equal(set.accounts.length, 2)
  assert.equal(set.selected, 'oaiapp_b')
  assert.equal((await readLink(host.ctx, 'chatgpt')).account, 'b@example.com')

  const picked = await selectAccount(host.ctx, 'chatgpt', 'oaiapp_a')
  assert.equal(picked.account, 'a@example.com')
  assert.equal((await readLink(host.ctx, 'chatgpt')).account, 'a@example.com')
})

test('a legacy single grant is read as one default registration', async () => {
  const host = makeHost()
  host.records.set(recordKey('chatgpt'), {
    kind: 'grant',
    payload: { flow: 'siwc', clientId: 'oaiapp_test', version: 1, accessToken: 'legacy', refreshToken: 'r', expiresAt: Date.now() + 3_600_000, account: 'old@example.com' },
  })
  const set = await readSet(host.ctx, 'chatgpt')
  assert.equal(set.accounts.length, 1)
  assert.equal(set.selected, 'default')
  assert.equal((await readLink(host.ctx, 'chatgpt')).account, 'old@example.com')
})

test('signing out keeps the ChatGPT registration, host identity, and other accounts', async () => {
  const host = makeHost()
  const now = Date.now() + 3_600_000
  await writeLink(host.ctx, 'chatgpt', { flow: 'siwc', clientId: 'oaiapp_a', account: 'a@example.com', accessToken: 't1', refreshToken: 'r1', idToken: 'id1', expiresAt: now })
  await writeLink(host.ctx, 'chatgpt', { flow: 'siwc', clientId: 'oaiapp_b', account: 'b@example.com', accessToken: 't2', refreshToken: 'r2', expiresAt: now })
  await selectAccount(host.ctx, 'chatgpt', 'oaiapp_b')
  const service = new SubscriptionService(host.ctx, config)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (String(url).includes('openid-configuration')) {
      return new Response(JSON.stringify({ revocation_endpoint: 'https://auth.openai.com/oauth/revoke' }), { status: 200 })
    }
    return new Response('', { status: 200 })
  }
  try {
    await service.logout('chatgpt')
  } finally {
    globalThis.fetch = originalFetch
    service.dispose()
  }
  const set = await readSet(host.ctx, 'chatgpt')
  assert.equal(set.accounts.length, 2)
  const first = set.accounts.find(entry => entry.clientId === 'oaiapp_a')
  const second = set.accounts.find(entry => entry.clientId === 'oaiapp_b')
  assert.equal(first.accessToken, 't1')
  assert.equal(second.accessToken, undefined)
  assert.equal(second.account, 'b@example.com')
  assert.equal(set.selected, 'oaiapp_a')
})


test('concurrent requests share one token refresh', async () => {
  const host = makeHost()
  await writeLink(host.ctx, 'chatgpt', {
    flow: 'codex',
    accessToken: 'stale',
    refreshToken: 'refresh-1',
    expiresAt: Date.now() - 1000,
    accountId: 'acct',
  })
  const service = new SubscriptionService(host.ctx, config)
  let calls = 0
  const channel = {
    id: 'chatgpt',
    async refresh() {
      calls += 1
      await new Promise(resolve => setTimeout(resolve, 40))
      return { flow: 'codex', accessToken: 'fresh', refreshToken: 'refresh-2', expiresAt: Date.now() + 3_600_000, accountId: 'acct' }
    },
  }
  const results = await Promise.all([
    service.credential(channel),
    service.credential(channel),
    service.credential(channel),
  ])
  assert.equal(calls, 1)
  assert.ok(results.every(grant => grant.accessToken === 'fresh'))
  const stored = (await readSet(host.ctx, 'chatgpt')).accounts[0]
  assert.equal(stored.accessToken, 'fresh')
  assert.equal(stored.refreshToken, 'refresh-2')
  service.dispose()
})

test('an in-stream provider failure becomes a finish error', async () => {
  const host = makeHost()
  host.records.set(recordKey('chatgpt'), {
    kind: 'grant',
    payload: { flow: 'siwc', clientId: 'oaiapp_test', version: 1, accessToken: 'tok', refreshToken: 'ref', expiresAt: Date.now() + 3_600_000, accountId: 'acct' },
  })
  const service = new SubscriptionService(host.ctx, config)
  service.start()
  await waitFor(() => chatgptRoute(host) !== undefined)
  const adapter = host.adapters.get(chatgptRoute(host))
  const originalFetch = globalThis.fetch
  const sse = 'data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded","message":"usage limit reached"}}}\n\n'
  globalThis.fetch = async () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  try {
    const chunks = []
    for await (const chunk of adapter.stream({ provider: chatgptRoute(host), model: 'gpt-5.5', messages: [] })) chunks.push(chunk)
    const finish = chunks.at(-1)
    assert.equal(finish.type, 'finish')
    assert.equal(finish.reason.kind, 'error')
    assert.match(finish.reason.failure.message, /usage limit reached/u)
  } finally {
    globalThis.fetch = originalFetch
    service.dispose()
  }
})

test('a quota 429 maps to the QUOTA failure code', async () => {
  const host = makeHost()
  host.records.set(recordKey('chatgpt'), {
    kind: 'grant',
    payload: { flow: 'siwc', clientId: 'oaiapp_test', version: 1, accessToken: 'tok', refreshToken: 'ref', expiresAt: Date.now() + 3_600_000, accountId: 'acct' },
  })
  const service = new SubscriptionService(host.ctx, config)
  service.start()
  await waitFor(() => chatgptRoute(host) !== undefined)
  const adapter = host.adapters.get(chatgptRoute(host))
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'quota exceeded for this account' } }), { status: 429 })
  try {
    const chunks = []
    for await (const chunk of adapter.stream({ provider: chatgptRoute(host), model: 'gpt-5.5', messages: [] })) chunks.push(chunk)
    assert.deepEqual(chunks.at(-1).reason.failure.code, 'QUOTA')
  } finally {
    globalThis.fetch = originalFetch
    service.dispose()
  }
})



test('a legacy ChatGPT grant is treated as signed out', async () => {
  const host = makeHost()
  host.records.set(recordKey('chatgpt'), {
    kind: 'grant',
    payload: { version: 1, accessToken: 'legacy', refreshToken: 'r', expiresAt: Date.now() + 3_600_000, accountId: 'acct' },
  })
  const service = new SubscriptionService(host.ctx, config)
  service.start()
  const state = await service.state()
  assert.equal(state.channels.some(entry => entry.channelId === 'chatgpt'), false)
  assert.equal(await service.credential(CHANNEL_BY_ID.get('chatgpt'), undefined), undefined)
  service.dispose()
})

test('signing out one account keeps the others and moves the selection', async () => {
  const host = makeHost()
  const now = Date.now() + 3_600_000
  await writeLink(host.ctx, 'chatgpt', { flow: 'siwc', clientId: 'oaiapp_a', account: 'first@example.com', accessToken: 't1', refreshToken: 'r1', expiresAt: now })
  await writeLink(host.ctx, 'chatgpt', { flow: 'siwc', clientId: 'oaiapp_b', account: 'second@example.com', accessToken: 't2', refreshToken: 'r2', expiresAt: now })
  await selectAccount(host.ctx, 'chatgpt', 'oaiapp_b')
  const service = new SubscriptionService(host.ctx, config)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (String(url).includes('openid-configuration')) {
      return new Response(JSON.stringify({ revocation_endpoint: 'https://auth.openai.com/oauth/revoke' }), { status: 200 })
    }
    return new Response('', { status: 200 })
  }
  try {
    const state = await service.logoutAccount('chatgpt', 'oaiapp_b')
    const entries = state.channels.filter(entry => entry.channelId === 'chatgpt')
    assert.equal(entries.length, 1)
    assert.equal(entries[0].accountKey, 'oaiapp_a')
    assert.equal(entries[0].linked, true)
    assert.equal(entries[0].account, 'first@example.com')
  } finally {
    globalThis.fetch = originalFetch
    service.dispose()
  }
})

test('a supported image attachment reaches the Responses payload', async () => {
  const host = makeHost()
  await writeLink(host.ctx, 'chatgpt', {
    flow: 'siwc',
    clientId: 'oaiapp_test',
    accessToken: 'tok',
    refreshToken: 'ref',
    expiresAt: Date.now() + 3_600_000,
  })
  const originalGet = host.ctx.get.bind(host.ctx)
  host.ctx.get = name => name === 'attachments'
    ? { readImageRequest: async () => ({ mediaType: 'image/png', data: new Uint8Array([137, 80, 78, 71]) }) }
    : originalGet(name)
  const service = new SubscriptionService(host.ctx, config)
  service.start()
  await waitFor(() => chatgptRoute(host) !== undefined)
  const adapter = host.adapters.get(chatgptRoute(host))
  const originalFetch = globalThis.fetch
  const seen = []
  globalThis.fetch = async (url, init) => {
    seen.push(JSON.parse(String(init?.body ?? '{}')))
    return new Response('data: {"type":"response.completed","response":{"status":"completed"}}\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
  }
  try {
    const chunks = []
    for await (const chunk of adapter.stream({
      provider: chatgptRoute(host),
      model: 'gpt-6.1-sol',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'describe' },
          {
            type: 'image',
            attachment: { attachmentId: 'att-1', mediaType: 'image/png', width: 256, height: 256, bytes: 4 },
          },
        ],
      }],
    })) chunks.push(chunk)
    assert.equal(seen.length, 1)
    const parts = seen[0].input[0].content
    const image = parts.find(part => part.type === 'input_image')
    assert.ok(image !== undefined)
    assert.match(image.image_url, /^data:image\/png;base64,/u)
    assert.equal(chunks.at(-1).type, 'finish')
  } finally {
    globalThis.fetch = originalFetch
    service.dispose()
  }
})


test('each ChatGPT registration becomes its own provider with its own label', async () => {
  const host = makeHost()
  const now = Date.now() + 3_600_000
  await writeLink(host.ctx, 'chatgpt', { flow: 'siwc', clientId: 'oaiapp_a', account: 'a@example.com', label: 'Personal', accessToken: 't1', refreshToken: 'r1', expiresAt: now })
  await writeLink(host.ctx, 'chatgpt', { flow: 'siwc', clientId: 'oaiapp_b', account: 'b@example.com', label: 'Work', accessToken: 't2', refreshToken: 'r2', expiresAt: now })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async url => String(url).includes('/v1/models')
    ? new Response(JSON.stringify({ models: [{ slug: 'gpt-6.2-sol', display_name: 'GPT-6.2 Sol', visibility: 'list', input_modalities: ['text', 'image'] }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    : new Response('', { status: 404 })
  try {
    const service = new SubscriptionService(host.ctx, config)
    service.start()
    await waitFor(() => [...host.adapters.keys()].filter(route => route.startsWith('chatgpt-sub')).length === 2)
    const state = await service.state()
    const cards = state.channels.filter(entry => entry.channelId === 'chatgpt')
    assert.equal(cards.length, 2)
    assert.deepEqual(cards.map(entry => entry.name).sort(), ['Personal', 'Work'])
    const routes = [...host.adapters.keys()].filter(route => route.startsWith('chatgpt-sub')).sort()
    assert.deepEqual(routes.map(route => service.adapter.providerInfo(route).name).sort(), ['Personal', 'Work'])
    service.dispose()
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('restoring defaults uses the account current catalog, not the static table', async () => {
  const host = makeHost()
  await writeLink(host.ctx, 'chatgpt', { flow: 'siwc', clientId: 'oaiapp_test', account: 'a@example.com', accessToken: 't', refreshToken: 'r', expiresAt: Date.now() + 3_600_000 })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async url => String(url).includes('/v1/models')
    ? new Response(JSON.stringify({
      models: [
        { slug: 'gpt-6.2-sol', display_name: 'GPT-6.2 Sol', visibility: 'list', context_window: 500_000, input_modalities: ['text', 'image'] },
        { slug: 'gpt-6.2-astra', display_name: 'GPT-6.2 Astra', visibility: 'list', context_window: 500_000, input_modalities: ['text', 'image'] },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
    : new Response('', { status: 404 })
  try {
    const service = new SubscriptionService(host.ctx, config)
    service.start()
    await waitFor(() => [...host.adapters.keys()].some(route => route.startsWith('chatgpt-sub')))
    const card = (await service.state()).channels.find(entry => entry.channelId === 'chatgpt')
    const instance = service.instance(card.id)
    await service.updateModel(instance, 'gpt-6.2-sol', { visible: false })
    assert.equal(service.models(instance).some(model => model.id === 'gpt-6.2-sol'), false)
    const reset = await service.resetCatalog(instance)
    assert.ok(reset.models.some(model => model.id === 'gpt-6.2-sol'))
    assert.ok(reset.models.some(model => model.id === 'gpt-6.2-astra'))
    service.dispose()
  } finally {
    globalThis.fetch = originalFetch
  }
})


test('undefined fields never reach the credential payload', async () => {
  const host = makeHost({ withAuthorization: false })
  await writeLink(host.ctx, 'chatgpt', {
    flow: 'siwc',
    clientId: 'oaiapp_clean',
    account: 'clean@example.com',
    label: undefined,
    subject: undefined,
    accessToken: 'tok',
    refreshToken: 'ref',
    expiresAt: Date.now() + 3_600_000,
  })
  const set = await readSet(host.ctx, 'chatgpt')
  const stored = set.accounts[0]
  assert.equal('label' in stored, false)
  assert.equal('subject' in stored, false)
  assert.equal(stored.account, 'clean@example.com')

  const service = new SubscriptionService(host.ctx, config)
  const channel = { id: 'chatgpt', name: { zh: 'ChatGPT', en: 'ChatGPT' }, async login() {
    return { flow: 'siwc', clientId: 'oaiapp_flow', accessToken: 't', refreshToken: 'r', expiresAt: Date.now() + 3_600_000, label: undefined, subject: undefined }
  } }
  const attempt = { id: 'a1', channelId: 'chatgpt', status: 'pending', notices: [], prompt: undefined, cancelled: false, controller: new AbortController(), createdAt: Date.now() }
  service.attempts.set('a1', attempt)
  service.active.set('chatgpt', attempt)
  await service.runAttempt(attempt, channel)
  const committed = host.records.get(recordKey('chatgpt')).payload.accounts.find(entry => entry.clientId === 'oaiapp_flow')
  assert.ok(committed !== undefined)
  assert.equal('label' in committed, false)
  assert.equal('subject' in committed, false)
  service.dispose()
})



test('renaming an account overrides the token name and can be reset', async () => {
  const host = makeHost()
  await writeLink(host.ctx, 'chatgpt', {
    flow: 'siwc',
    clientId: 'oaiapp_name',
    account: 'name@example.com',
    defaultLabel: 'Token Name',
    accessToken: 'tok',
    refreshToken: 'ref',
    expiresAt: Date.now() + 3_600_000,
  })
  const service = new SubscriptionService(host.ctx, config)
  const before = await service.state()
  assert.equal(before.channels[0].name, 'Token Name')

  const renamed = await service.renameAccount(before.channels[0].id, '自定义名字')
  assert.equal(renamed.channels[0].name, '自定义名字')

  const reset = await service.renameAccount(before.channels[0].id, '')
  assert.equal(reset.channels[0].name, 'Token Name')
  service.dispose()
})
