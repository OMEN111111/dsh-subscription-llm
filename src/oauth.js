/**
 * Small OAuth/HTTP toolkit shared by the three subscription channels.
 *
 * Nothing here knows about DeepSeek Harness: it is PKCE, a loopback callback
 * listener, a browser opener, and JSON/SSE plumbing over global fetch.
 */
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'

const BASE64URL = /\+/g

/** RFC 7636 code verifier plus its S256 challenge. */
export function createPkce() {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/** URL-safe base64 without padding. */
export function base64url(bytes) {
  return Buffer.from(bytes).toString('base64').replace(BASE64URL, '-').replace(/\//g, '_').replace(/=+$/u, '')
}

/** An opaque OAuth `state` value. */
export function randomState() {
  return base64url(randomBytes(24))
}

/**
 * Open one URL in the user's default browser.
 *
 * Windows goes through `rundll32 url.dll,FileProtocolHandler`, which hands the
 * URL to the shell without re-parsing it: `cmd /c start` splits an unquoted URL
 * at its first `&`, which silently dropped every authorize parameter after
 * `redirect_uri`. The `start` form stays as a fallback, quoted.
 * @param url - absolute URL.
 * @returns whether a platform opener was started; a headless host answers false.
 */
export function openBrowser(url) {
  const candidates = process.platform === 'win32'
    ? [
        { file: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] },
        { file: 'cmd.exe', args: ['/c', 'start', '""', `"${url}"`] },
      ]
    : process.platform === 'darwin'
      ? [{ file: 'open', args: [url] }]
      : [{ file: 'xdg-open', args: [url] }]
  for (const command of candidates) {
    try {
      const child = spawn(command.file, command.args, { detached: true, stdio: 'ignore', windowsHide: true })
      child.on('error', () => {})
      child.unref()
      return true
    } catch (_noOpener) {
      // Try the next opener; a host without one answers false below.
    }
  }
  return false
}

const CALLBACK_PAGE = '<!doctype html><meta charset="utf-8"><title>Signed in</title>'
  + '<style>body{font:15px system-ui;margin:20vh auto;max-width:32rem;text-align:center;color:#222}</style>'
  + '<p>Authorization received. You can close this window and return to DeepSeek Harness.</p>'

/**
 * Listen on one loopback port for an OAuth redirect.
 * @param options - port (0 picks a free one), path, and the overall wait budget.
 * @returns the redirect URI to send to the provider plus a waiter for the query.
 */
export async function startLoopback(options) {
  const port = options.port ?? 0
  const path = options.path ?? '/callback'
  const received = withResolvers()
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
    if (url.pathname !== path) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('not found')
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(CALLBACK_PAGE)
    received.resolve(Object.fromEntries(url.searchParams.entries()))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  const bound = typeof address === 'object' && address !== null ? address.port : port
  const close = () => {
    try {
      server.close()
    } catch (_alreadyClosed) {
      /* idempotent */
    }
  }
  return {
    redirectUri: `http://127.0.0.1:${bound}${path}`,
    port: bound,
    wait: signal => received.promise(signal, options.timeoutMs ?? 300_000).finally(close),
    close,
  }
}

/** A promise plus its settle functions, so a signal can race it. */
function withResolvers() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return {
    resolve,
    reject,
    /** Wait for the value, a signal abort, or a deadline. */
    async promise(signal, timeoutMs) {
      if (signal?.aborted === true) throw new Error('sign-in cancelled')
      let timer
      let onAbort
      try {
        return await Promise.race([
          promise,
          new Promise((_res, rej) => {
            timer = setTimeout(() => rej(new Error('sign-in timed out')), timeoutMs)
            if (signal !== undefined) {
              onAbort = () => rej(new Error('sign-in cancelled'))
              signal.addEventListener('abort', onAbort, { once: true })
            }
          }),
        ])
      } finally {
        clearTimeout(timer)
        if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
      }
    },
  }
}

/**
 * POST an `application/x-www-form-urlencoded` body and read JSON.
 * @param url - token endpoint.
 * @param fields - form fields.
 * @param options - extra headers and cancellation.
 * @returns the decoded JSON body; a non-JSON body is returned as `{raw}`.
 */
export async function postForm(url, fields, options = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
      ...options.headers,
    },
    body: new URLSearchParams(fields).toString(),
    signal: options.signal,
  })
  return decode(response)
}

/**
 * POST a JSON body and read JSON.
 * @param url - endpoint.
 * @param body - JSON-serializable body.
 * @param options - extra headers and cancellation.
 * @returns the decoded JSON body; a non-JSON body is returned as `{raw}`.
 */
export async function postJson(url, body, options = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...options.headers,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  })
  return decode(response)
}

async function decode(response) {
  const text = await response.text()
  let body
  try {
    body = text.length === 0 ? {} : JSON.parse(text)
  } catch (_notJson) {
    body = { raw: text.slice(0, 2000) }
  }
  if (!response.ok) {
    const detail = typeof body.error_description === 'string'
      ? body.error_description
      : typeof body.error === 'string'
        ? body.error
        : typeof body.message === 'string'
          ? body.message
          : JSON.stringify(body).slice(0, 400)
    throw new Error(`${response.status} ${detail}`)
  }
  return body
}

/**
 * Iterate Server-Sent Events of one streaming response.
 * @param response - an already-failed-checked fetch response with an SSE body.
 * @returns `{ event, data }` pairs, where `data` is the raw string payload.
 */
export async function* sseEvents(response) {
  const body = response.body
  if (body === null) throw new Error('response has no body')
  const decoder = new TextDecoder()
  let buffer = ''
  let event = ''
  let data = []
  const flush = function* () {
    if (data.length === 0) return
    const payload = data.join('\n')
    data = []
    yield { event: event.length === 0 ? 'message' : event, data: payload }
    event = ''
  }
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true })
    let index = buffer.indexOf('\n')
    while (index !== -1) {
      const line = buffer.slice(0, index).replace(/\r$/u, '')
      buffer = buffer.slice(index + 1)
      if (line.length === 0) {
        yield* flush()
      } else if (line.startsWith('event:')) {
        event = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        data.push(line.slice(5).replace(/^ /u, ''))
      }
      index = buffer.indexOf('\n')
    }
  }
  yield* flush()
}

/**
 * Read an SSE response as decoded JSON payloads.
 * @param response - streaming response.
 * @returns one decoded object per `data:` payload, skipping `[DONE]`.
 */
export async function* sseJson(response) {
  for await (const { data } of sseEvents(response)) {
    const trimmed = data.trim()
    if (trimmed.length === 0 || trimmed === '[DONE]') continue
    try {
      yield JSON.parse(trimmed)
    } catch (_malformedJson) {
      // A provider may emit a keep-alive comment or an empty frame; ignore it.
    }
  }
}

/** Unix seconds for `now + seconds`. */
export function expiresAt(seconds) {
  return Date.now() + Math.max(0, Math.trunc(seconds)) * 1000
}

/** Milliseconds until this ISO timestamp. */
export function isoExpiry(value) {
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : undefined
}
