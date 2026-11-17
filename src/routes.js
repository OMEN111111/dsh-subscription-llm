/**
 * HTTP seat for the Models-page card.
 *
 * These are exact Fetch routes on the connection's `/api` channel, so the
 * browser page reaches them with its normal session cookie and nothing else
 * does: an exact route answers only the owner principal.
 */

/** Route prefix owned by this plugin. */
const BASE = '/api/dsh-subscription-channels'

/**
 * Register every route the card calls.
 * @param ctx - a context that carries the `connection` service.
 * @param service - the subscription service.
 */
export function registerRoutes(ctx, service) {
  const connection = ctx.get('connection')
  if (connection === undefined) return
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
  const body = async (request) => {
    try {
      const parsed = await request.json()
      return parsed !== null && typeof parsed === 'object' ? parsed : {}
    } catch (_noBody) {
      return {}
    }
  }
  const register = (path, methods, handler) => {
    ctx.effect(() => connection.fetch.register({
      path: BASE + path,
      methods,
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          return await handler(request)
        } catch (error) {
          return json({ error: String(error?.message ?? error) }, 400)
        }
      },
    }), `subscription-channels: ${path}`)
  }

  register('/state', ['GET'], async () => json(await service.state()))

  register('/login', ['POST'], async (request) => {
    const { channel } = await body(request)
    return json(service.login(channel))
  })

  register('/attempt', ['GET'], async (request) => {
    const id = new URL(request.url).searchParams.get('id')
    const view = service.attempt(String(id ?? ''))
    if (view === undefined) return json({ error: 'no such sign-in attempt' }, 404)
    return json(view)
  })

  register('/answer', ['POST'], async (request) => {
    const { id, value } = await body(request)
    const answered = service.answer(String(id ?? ''), value)
    return answered ? json({ ok: true }) : json({ error: 'no question is waiting for an answer' }, 409)
  })

  register('/cancel', ['POST'], async (request) => {
    const { id } = await body(request)
    return json({ ok: service.cancel(String(id ?? '')) })
  })

  register('/logout', ['POST'], async (request) => {
    const { channel } = await body(request)
    await service.logout(channel)
    return json({ ok: true })
  })
}
