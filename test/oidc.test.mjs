// OIDC helpers used by the Sign in with ChatGPT flow.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSign, generateKeyPairSync } from 'node:crypto'

import { verifyIdToken, revokeSession } from '../src/oidc.js'

/** One RSA pair whose public key is published as a JWK. */
function keyPair(kid) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  return {
    privateKey,
    jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' },
  }
}

/** Sign one JWT with the given private key. */
function sign(privateKey, claims, kid) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const signingInput = `${encode({ alg: 'RS256', typ: 'JWT', kid })}.${encode(claims)}`
  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey).toString('base64url')
  return `${signingInput}.${signature}`
}

const baseClaims = {
  iss: 'https://auth.openai.com',
  aud: 'oaiapp_example',
  sub: 'subject-1',
  email: 'person@example.com',
  nonce: 'nonce-1',
  exp: Math.floor(Date.now() / 1000) + 600,
}

test('a signed ID token verifies and yields its claims', async () => {
  const { privateKey, jwk } = keyPair('test-key')
  const token = sign(privateKey, baseClaims, 'test-key')
  const claims = await verifyIdToken(token, { clientId: 'oaiapp_example', nonce: 'nonce-1', keys: [jwk] })
  assert.equal(claims.sub, 'subject-1')
  assert.equal(claims.email, 'person@example.com')
})

test('a wrong nonce, audience, expiry, issuer, or signature is refused', async () => {
  const { privateKey, jwk } = keyPair('test-key')
  const token = sign(privateKey, baseClaims, 'test-key')
  await assert.rejects(verifyIdToken(token, { clientId: 'oaiapp_example', nonce: 'other', keys: [jwk] }), /nonce/u)
  await assert.rejects(verifyIdToken(token, { clientId: 'oaiapp_other', nonce: 'nonce-1', keys: [jwk] }), /another client/u)
  const expired = sign(privateKey, { ...baseClaims, exp: Math.floor(Date.now() / 1000) - 3600 }, 'test-key')
  await assert.rejects(verifyIdToken(expired, { clientId: 'oaiapp_example', nonce: 'nonce-1', keys: [jwk] }), /expired/u)
  const wrongIssuer = sign(privateKey, { ...baseClaims, iss: 'https://example.test' }, 'test-key')
  await assert.rejects(verifyIdToken(wrongIssuer, { clientId: 'oaiapp_example', nonce: 'nonce-1', keys: [jwk] }), /issuer/u)
  const impostor = keyPair('test-key')
  const forged = sign(impostor.privateKey, baseClaims, 'test-key')
  await assert.rejects(verifyIdToken(forged, { clientId: 'oaiapp_example', nonce: 'nonce-1', keys: [jwk] }), /signature/u)
})

test('revocation posts the refresh token to the discovered endpoint', async () => {
  const originalFetch = globalThis.fetch
  const seen = []
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), body: String(init?.body ?? '') })
    if (String(url).includes('.well-known/openid-configuration')) {
      return new Response(JSON.stringify({ revocation_endpoint: 'https://auth.openai.com/oauth/revoke' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('', { status: 200 })
  }
  try {
    const result = await revokeSession({ clientId: 'oaiapp_example', refreshToken: 'refresh-1' })
    assert.equal(result.ok, true)
    const post = seen.find(entry => entry.url === 'https://auth.openai.com/oauth/revoke')
    assert.ok(post !== undefined)
    assert.match(post.body, /token=refresh-1/u)
    assert.match(post.body, /token_type_hint=refresh_token/u)
    assert.match(post.body, /client_id=oaiapp_example/u)
  } finally {
    globalThis.fetch = originalFetch
  }
})
