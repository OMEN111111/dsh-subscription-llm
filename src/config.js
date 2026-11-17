/** Plugin configuration: every value the channel wirings may need to override. */

/**
 * Resolve the raw row config into the values the plugin uses.
 * @param raw - `config` supplied by the bundle patch, if any.
 * @returns a complete settings object with defaults applied.
 */
export function normalizeConfig(raw) {
  const config = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    /** Display language for provider names: `zh` (default) or `en`. */
    lang: config.lang === 'en' ? 'en' : 'zh',
    /** The `originator` the ChatGPT backend sees; the Codex CLI's own value by default. */
    originator: typeof config.originator === 'string' && config.originator.length > 0 ? config.originator : 'codex_cli_rs',
    /** Overrides for the Antigravity OAuth client, when Google rotates it. */
    googleClientId: typeof config.googleClientId === 'string' ? config.googleClientId : undefined,
    googleClientSecret: typeof config.googleClientSecret === 'string' ? config.googleClientSecret : undefined,
    /** Overrides for the Cloud Code host. */
    antigravityHost: typeof config.antigravityHost === 'string' ? config.antigravityHost : undefined,
    /** Whether a sign-in opens the user's default browser; headless hosts turn this off and read the URL instead. */
    openBrowser: config.openBrowser !== false,
    /** How long a sign-in may stay open before it is abandoned. */
    loginTimeoutMs: Number.isFinite(config.loginTimeoutMs) && config.loginTimeoutMs > 0 ? config.loginTimeoutMs : 10 * 60 * 1000,
  }
}

