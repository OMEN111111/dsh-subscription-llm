/**
 * Subscription channels — Host half.
 *
 * Mounts three browser sign-in flows (ChatGPT, Google Antigravity, Claude) and
 * the LLM routes their linked accounts serve. The Models-page entry lives in
 * the browser half (`client.js`); both halves talk over this plugin's own
 * `/api/dsh-subscription-channels` routes.
 *
 * Only the LLM registry is a hard dependency. The credential store, the
 * authorization seam, and the browser transport are taken as each becomes
 * available, so this plugin also loads in a composition without a browser or
 * without a sign-in seam.
 */
import { normalizeConfig } from './src/config.js'
import { SubscriptionService } from './src/service.js'
import { registerRoutes } from './src/routes.js'
import { SCOPE } from './src/store.js'

/** The LLM registry is the one service this plugin cannot work without. */
export const inject = ['llm']

/**
 * Mount the service, its authorization flows, and its HTTP seat.
 * @param ctx - plugin context.
 * @param config - row config from `cordis.patch.yml` or the bundle patch.
 */
export function apply(ctx, config) {
  const resolved = normalizeConfig(config)
  const service = new SubscriptionService(ctx, resolved)

  ctx.effect(() => {
    service.start()
    return () => { service.dispose() }
  }, 'subscription-channels: service')

  // The credential store may activate after this plugin: sync once it is there,
  // and again on every committed record change, so a grant written by another
  // surface publishes its route here too.
  ctx.inject(['credentials'], () => {
    void service.syncRoutes()
  })
  ctx.effect(() => ctx.on('credentials/record-updated', (key) => {
    if (typeof key === 'string' && key.startsWith(`${SCOPE}/`)) void service.syncRoutes()
  }), 'subscription-channels: credential records')

  ctx.inject(['authorization'], authorized => {
    service.registerFlows(authorized.authorization)
  })

  ctx.inject(['connection'], connected => {
    registerRoutes(connected, service)
  })
}
