// Shared sign-in helpers: callback normalization and pasted-input parsing.
import test from 'node:test'
import assert from 'node:assert/strict'

import { waitForParams, parseAuthorizationInput } from '../src/login.js'

test('a loopback callback exposes the issued client id as clientId', async () => {
  const params = await waitForParams({
    interaction: { notify() {}, prompt: () => new Promise(() => {}) },
    loopback: { wait: async () => ({ code: 'code-1', state: 'state-1', client_id: 'oaiapp_issued', scope: 'openid' }) },
    state: 'state-1',
    lang: 'zh',
    message: 'paste',
    placeholder: 'x',
  })
  assert.equal(params.code, 'code-1')
  assert.equal(params.clientId, 'oaiapp_issued')
  assert.equal(params.client_id, undefined)
})

test('a pasted callback URL keeps the issued client id', () => {
  const parsed = parseAuthorizationInput('http://127.0.0.1:1455/auth/callback?code=c&state=s&client_id=oaiapp_y')
  assert.equal(parsed.code, 'c')
  assert.equal(parsed.clientId, 'oaiapp_y')
})

test('a callback without an issued id stays undefined', async () => {
  const params = await waitForParams({
    interaction: { notify() {}, prompt: () => new Promise(() => {}) },
    loopback: { wait: async () => ({ code: 'c', state: 's' }) },
    state: 's',
    lang: 'zh',
    message: 'paste',
    placeholder: 'x',
  })
  assert.equal(params.clientId, undefined)
})
