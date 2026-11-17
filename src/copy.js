/** User-facing sign-in copy, in the two languages the plugin ships. */

const TABLE = {
  zh: {
    openChatgpt: '打开 ChatGPT 登录页完成授权。',
    openClaude: '打开 Claude 登录页完成授权。',
    openAntigravity: '使用 Antigravity 账号打开 Google 登录页完成授权。',
    pastePrompt: '等待浏览器完成授权；如果浏览器无法回到本地端口，把回调地址粘贴到这里。',
    pastePromptClaude: '等待浏览器完成授权；如果 Claude 只给你一段授权码，粘贴到这里（code#state 亦可）。',
    pasteRetry: '（授权码不匹配，请重试）',
    loopbackBusy: '本地端口 %PORT% 被占用；请粘贴回调地址继续。',
    loopbackBusyAntigravity: '本地端口 %PORT% 被占用。请退出 Antigravity 应用后重试，或粘贴浏览器打不开的回调地址。',
    stateMismatch: '回调地址与本次登录不匹配。',
    noCode: '对方没有返回授权码；请粘贴完整的回调地址。',
    succeeded: '登录成功，账号模型已加入模型选择器。',
    timedOut: '登录超时，请点击重新登录。',
    antigravityNeedsSecret: 'Google Antigravity 登录需要 OAuth 客户端密钥：请在插件配置里填 googleClientSecret，或设置环境变量 DSH_ANTIGRAVITY_CLIENT_SECRET。',
    antigravityOnboard: '正在为该账号开通 Antigravity 项目（可能需要几秒钟）…',
    antigravityFallback: 'Cloud Code 项目查询失败（%ERROR%），改用文档中的默认项目。',
    openLabel: '打开登录页面',
  },
  en: {
    openChatgpt: 'Open the ChatGPT sign-in page to authorize DeepSeek Harness.',
    openClaude: 'Open the Claude sign-in page to authorize DeepSeek Harness.',
    openAntigravity: 'Open the Google sign-in page with the Antigravity account.',
    pastePrompt: 'Waiting for the browser sign-in. If it cannot return to localhost, paste the callback URL here.',
    pastePromptClaude: 'Waiting for the browser sign-in. If Claude only shows you a code, paste it here (code#state is fine).',
    pasteRetry: ' (the code did not match; try again)',
    loopbackBusy: 'Loopback port %PORT% is unavailable; paste the callback URL instead.',
    loopbackBusyAntigravity: 'Loopback port %PORT% is in use. Quit the Antigravity app, or paste the full callback URL the browser fails to open.',
    stateMismatch: 'The callback state did not match this sign-in attempt.',
    noCode: 'The provider returned no authorization code; paste the full callback URL instead.',
    succeeded: 'Signed in. The account models are now available in the model selector.',
    timedOut: 'The sign-in timed out; start it again from Settings.',
    antigravityNeedsSecret: 'Antigravity sign-in needs the OAuth client secret: set googleClientSecret in the plugin config, or the DSH_ANTIGRAVITY_CLIENT_SECRET environment variable.',
    antigravityOnboard: 'Provisioning the Antigravity project for this account (this can take a few seconds)…',
    antigravityFallback: 'Cloud Code project lookup failed (%ERROR%); using the documented fallback project.',
    openLabel: 'Open sign-in page',
  },
}

/**
 * One localized message.
 * @param lang - `zh` or `en`.
 * @param key - table key.
 * @param values - `%NAME%` replacements.
 * @returns the rendered string; an unknown key renders as the key itself.
 */
export function message(lang, key, values = {}) {
  const table = TABLE[lang === 'en' ? 'en' : 'zh']
  const template = table[key]
  if (template === undefined) return key
  return template.replace(/%([A-Z_]+)%/gu, (_match, name) => String(values[name] ?? name))
}


