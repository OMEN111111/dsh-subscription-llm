/** HTTP surface the settings page talks to: one provider instance per account. */

const BASE = '/api/dsh-subscription-channels'

/**
 * Register this plugin's routes on the host connection.
 * @param ctx - the plugin context carrying the `connection` service.
 * @param service - the subscription service.
 */
export function registerRoutes(ctx, service) {
  const connection = ctx.get('connection')
  if (connection === undefined) return
  const json = (value, status = 200) => new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
  const body = async (request) => {
    try {
      return JSON.parse(await request.text())
    } catch (_noBody) {
      return {}
    }
  }
  const target = value => service.instance(String(value ?? ''))
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
    const input = await body(request)
    return json(service.login(input.channel, { label: input.label, accountKey: input.accountKey }))
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

  register('/catalog', ['GET'], async (request) => {
    const instance = target(new URL(request.url).searchParams.get('channel'))
    if (instance === undefined) return json({ error: 'unknown provider instance' }, 404)
    return json(await service.channelCatalog(instance))
  })

  register('/catalog/model', ['POST'], async (request) => {
    const input = await body(request)
    const instance = target(input.channel)
    if (instance === undefined) return json({ error: 'unknown provider instance' }, 404)
    if (input.create === true) {
      return json(await service.createModel(instance, input.model, input.name))
    }
    return json(await service.updateModel(instance, String(input.model ?? ''), input.patch ?? {}))
  })

  register('/catalog/order', ['POST'], async (request) => {
    const input = await body(request)
    const instance = target(input.channel)
    if (instance === undefined) return json({ error: 'unknown provider instance' }, 404)
    return json(await service.updateOrder(instance, input.order))
  })

  register('/catalog/reset', ['POST'], async (request) => {
    const input = await body(request)
    const instance = target(input.channel)
    if (instance === undefined) return json({ error: 'unknown provider instance' }, 404)
    return json(await service.resetCatalog(instance))
  })

  register('/catalog/adopt', ['POST'], async (request) => {
    const input = await body(request)
    const instance = target(input.channel)
    if (instance === undefined) return json({ error: 'unknown provider instance' }, 404)
    return json(await service.adoptModels(instance, input.models))
  })

  register('/catalog/discover', ['POST'], async (request) => {
    const input = await body(request)
    const instance = target(input.channel)
    if (instance === undefined) return json({ error: 'unknown provider instance' }, 404)
    return json(await service.discover(instance, { restore: input.restore === true }))
  })

  register('/test', ['POST'], async (request) => {
    const input = await body(request)
    const instance = target(input.channel)
    if (instance === undefined) return json({ error: 'unknown provider instance' }, 404)
    return json(await service.testModel(instance, String(input.model ?? '')))
  })

  register('/logout', ['POST'], async (request) => {
    const input = await body(request)
    await service.logout(input.channel)
    return json(await service.state())
  })

  // Kept for older settings pages: selecting an account is no longer required
  // now that every registration owns its own provider route.
  register('/account/select', ['POST'], async (request) => {
    const input = await body(request)
    await service.selectAccount(input.channel, input.key)
    return json(await service.state())
  })

  register('/account/logout', ['POST'], async (request) => {
    const input = await body(request)
    const instance = target(input.channel)
    if (instance === undefined) return json({ error: 'unknown provider instance' }, 404)
    await service.logoutAccount(instance.channel.id, instance.accountKey)
    return json(await service.state())
  })
}



