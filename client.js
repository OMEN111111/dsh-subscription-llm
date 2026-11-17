// Browser half of the subscription-channels bundle.
// Registers the "第三方订阅渠道" entry in Settings > Models, right after the
// shipped "添加模型提供商" control, and drives the Host login attempts through
// the plugin's own /api/dsh-subscription-channels routes.
window.__ModuleLoader__.load({
  id: 'dsh-subscription-channels',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'subscription-channels'
    const BASE = '/api/dsh-subscription-channels'

    const zh = {
      entry: '第三方订阅渠道',
      entrySub: '登录订阅账号即可使用',
      hint: '登录已有的 ChatGPT、Google Antigravity、Claude 订阅账号，直接使用账号内的模型，无需 API Key。',
      close: '收起',
      login: '登录',
      relogin: '重新登录',
      logout: '退出登录',
      cancel: '取消',
      submit: '提交',
      openLink: '打开登录页面',
      signingIn: '正在登录…',
      waitingLink: '等待浏览器完成授权…',
      linked: '已登录',
      notLinked: '未登录',
      succeeded: '登录成功，模型已加入模型选择器。',
      failed: '登录失败',
      cancelled: '登录已取消',
      answerPlaceholder: '在此粘贴授权码或回调地址',
      models: '个模型',
      modelUnit: '个模型',
      modelOne: '1 个模型',
      availableAfterLogin: '登录后可用',
      expired: '已过期 · 请重新登录',
      catalog: '模型目录',
      failPrefix: '失败',
      catalogHint: '这里可见的模型就是对话框下方胶囊体里能选的模型。',
      catalogMeta: '可见 %VISIBLE% · 已删除 %HIDDEN%',
      discover: '获取可用模型',
      discovering: '正在询问账号…',
      restoreAll: '全部恢复',
      catalogEmpty: '目录为空，请先点「获取可用模型」。',
      modelId: '模型 ID',
      displayName: '显示名称',
      modelOptions: '模型选项',
      removeModel: '删除',
      restoreModel: '恢复',
      removed: '已删除',
      contextWindow: '上下文窗口',
      maxOutput: '最大输出 token 数',
      inputTypes: '输入类型',
      inputText: '文本',
      inputImage: '图片',
      reasoningLevels: '推理等级',
      reasoningNone: '该模型不支持推理等级',
      defaultLevel: '默认等级',
      testModel: '检测',
      testSelected: '检测选中（%COUNT%）',
      testing: '检测中…',
      testAvailable: '可用',
      testUnavailable: '不可用',
      saveFailed: '保存失败：%MESSAGE%',
      selectAll: '全选',
      clearSelection: '取消全选',      confirmLogout: '确认退出',
      retry: '重试',
      errInvalidGrant: '授权被拒绝或已失效，请重新登录。',
      errSessionEnded: '登录会话已结束，请重试。',
      errStaleInput: '这个输入框已失效，请重试。',
      account: '账号',
      footnote: '令牌只保存在本机凭据库；上游接口变化时可在插件配置里覆盖 OAuth 参数。',
      loading: '读取中…',
      unknownChannel: '未知渠道',
    }
    const en = {
      entry: 'Subscription channels',
      entrySub: 'Sign in with a subscription account',
      hint: 'Sign in to an existing ChatGPT, Google Antigravity or Claude subscription and use the models it already includes — no API key needed.',
      close: 'Collapse',
      login: 'Sign in',
      relogin: 'Sign in again',
      logout: 'Sign out',
      cancel: 'Cancel',
      submit: 'Submit',
      openLink: 'Open sign-in page',
      signingIn: 'Signing in…',
      waitingLink: 'Waiting for the browser to finish…',
      linked: 'Signed in',
      notLinked: 'Not signed in',
      succeeded: 'Signed in. The account models are now selectable.',
      failed: 'Sign-in failed',
      cancelled: 'Sign-in cancelled',
      answerPlaceholder: 'Paste the authorization code or callback URL',
      models: ' models',
      modelUnit: 'models',
      modelOne: '1 model',
      availableAfterLogin: 'Available after sign-in',
      expired: 'Expired · sign in again',
      catalog: 'Model catalog',
      failPrefix: 'Failed',
      catalogHint: 'Visible models are the ones the composer offers.',
      catalogMeta: '%VISIBLE% visible · %HIDDEN% removed',
      discover: 'Fetch available models',
      discovering: 'Asking the account…',
      restoreAll: 'Restore all',
      catalogEmpty: 'No models yet. Fetch available models first.',
      modelId: 'Model ID',
      displayName: 'Display name',
      modelOptions: 'Model options',
      removeModel: 'Remove',
      restoreModel: 'Restore',
      removed: 'Removed',
      contextWindow: 'Context window',
      maxOutput: 'Max output tokens',
      inputTypes: 'Input types',
      inputText: 'Text',
      inputImage: 'Image',
      reasoningLevels: 'Reasoning levels',
      reasoningNone: 'This model has no reasoning levels',
      defaultLevel: 'Default level',
      testModel: 'Test',
      testSelected: 'Test selected (%COUNT%)',
      testing: 'Testing…',
      testAvailable: 'Available',
      testUnavailable: 'Unavailable',
      saveFailed: 'Save failed: %MESSAGE%',
      selectAll: 'Select all',
      clearSelection: 'Clear selection',      confirmLogout: 'Confirm sign-out',
      retry: 'Retry',
      errInvalidGrant: 'The authorization was refused or has expired. Sign in again.',
      errSessionEnded: 'That sign-in session ended. Try again.',
      errStaleInput: 'That input is no longer active. Try again.',
      account: 'Account',
      footnote: 'Tokens stay in the local credential store. OAuth parameters can be overridden in the plugin config when an upstream changes.',
      loading: 'Loading…',
      unknownChannel: 'Unknown channel',
    }

    const fallbackLocale = (() => {
      try {
        return String(navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en'
      } catch (_noNavigator) {
        return 'en'
      }
    })()
    const fallbackT = (key) => (fallbackLocale === 'zh' ? zh : en)[key] ?? key

    async function api(path, init) {
      const response = await fetch(BASE + path, {
        credentials: 'same-origin',
        ...init,
        headers: { 'content-type': 'application/json', ...(init && init.headers) },
      })
      const text = await response.text()
      let body = {}
      if (text.length > 0) {
        try {
          body = JSON.parse(text)
        } catch (_notJson) {
          body = { error: text.slice(0, 200) }
        }
      }
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${response.status}`)
      return body
    }

    function IconPlus() {
      return h(
        'svg',
        { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false },
        h('path', {
          d: 'M8 3v10M3 8h10',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          fill: 'none',
        }),
      )
    }

    function IconChevron(props) {
      return h(
        'svg',
        {
          width: 12, height: 12, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false,
          style: { transform: props.open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms ease' },
        },
        h('path', {
          d: 'M6 3.5 10.5 8 6 12.5',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          fill: 'none',
        }),
      )
    }

    /** Turn a Host diagnostic into a sentence the card can show. */
    function friendlyError(raw, t) {
      const text = String(raw ?? '')
      if (/invalid_grant|unauthorized|401/u.test(text)) return t('errInvalidGrant')
      if (/no such sign-in attempt/u.test(text)) return t('errSessionEnded')
      if (/no question is waiting/u.test(text)) return t('errStaleInput')
      return text
    }

    /** One channel row plus its inline sign-in panel. */
    function ChannelRow(props) {
      const { channel, t, onChanged } = props
      const [attemptId, setAttemptId] = React.useState(undefined)
      const [attempt, setAttempt] = React.useState(undefined)
      const [answer, setAnswer] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(undefined)
      const [confirming, setConfirming] = React.useState(false)
      const [catalogOpen, setCatalogOpen] = React.useState(false)

      React.useEffect(() => {
        if (attemptId === undefined) return undefined
        let stopped = false
        let timer
        const tick = async () => {
          try {
            const next = await api('/attempt?id=' + encodeURIComponent(attemptId))
            if (stopped) return
            setAttempt(next)
            if (next.status === 'pending') {
              timer = setTimeout(tick, 900)
              return
            }
            setAttemptId(undefined)
            setBusy(false)
            await onChanged()
          } catch (failure) {
            if (stopped) return
            setAttempt({ status: 'failed', error: String(failure.message ?? failure) })
            setAttemptId(undefined)
            setBusy(false)
          }
        }
        void tick()
        return () => {
          stopped = true
          if (timer !== undefined) clearTimeout(timer)
        }
      }, [attemptId, onChanged])

      const start = async () => {
        setError(undefined)
        setAttempt(undefined)
        setBusy(true)
        try {
          const started = await api('/login', { method: 'POST', body: JSON.stringify({ channel: channel.id }) })
          if (started.status === 'authorized') {
            setBusy(false)
            setAttempt({ status: 'authorized' })
            await onChanged()
            return
          }
          setAttemptId(started.attemptId)
        } catch (failure) {
          setBusy(false)
          setError(String(failure.message ?? failure))
        }
      }

      const cancel = async () => {
        if (attemptId !== undefined) {
          try {
            await api('/cancel', { method: 'POST', body: JSON.stringify({ id: attemptId }) })
          } catch (_ignored) {
            /* the attempt settles on its own */
          }
        }
        setAttemptId(undefined)
        // Acknowledge the cancellation instead of snapping back silently.
        setAttempt({ status: 'cancelled' })
        setBusy(false)
      }

      const signOut = async () => {
        setError(undefined)
        setConfirming(false)
        setBusy(true)
        try {
          await api('/logout', { method: 'POST', body: JSON.stringify({ channel: channel.id }) })
          setAttempt(undefined)
          await onChanged()
        } catch (failure) {
          setError(friendlyError(failure.message ?? failure, t))
        } finally {
          setBusy(false)
        }
      }

      // Clear the paste field only when a new question arrives, so a rejected
      // answer does not look like the card erased what the user typed.
      const promptMessage = attempt !== undefined && attempt.prompt !== undefined ? attempt.prompt.message : undefined
      React.useEffect(() => {
        setAnswer('')
      }, [promptMessage])

      const respond = async () => {
        if (attemptId === undefined || answer.trim().length === 0) return
        try {
          await api('/answer', {
            method: 'POST',
            body: JSON.stringify({ id: attemptId, value: answer }),
          })
        } catch (failure) {
          setError(friendlyError(failure.message ?? failure, t))
        }
      }

      const running = attemptId !== undefined
      const prompt = attempt !== undefined && attempt.status === 'pending' ? attempt.prompt : undefined
      const notices = attempt !== undefined && Array.isArray(attempt.notices) ? attempt.notices : []
      const signedIn = channel.linked === true && channel.status !== 'expired'
      const status = channel.status === 'expired' ? t('expired') : signedIn ? t('linked') : t('notLinked')
      const count = channel.modelCount === 1 ? t('modelOne') : `${channel.modelCount} ${t('modelUnit')}`
      const meta = signedIn ? count : `${t('availableAfterLogin')} ${count}`

      return h(
        'li',
        { className: 'sc-row' },
        h(
          'div',
          { className: 'sc-rowHead' },
          h(
            'div',
            { className: 'sc-rowText' },
            h('span', { className: 'sc-name' }, channel.name),
            h(
              'span',
              { className: signedIn || channel.status === 'expired' ? 'sc-status sc-statusOn' : 'sc-status' },
              status,
              signedIn && channel.account ? ` · ${channel.account}` : '',
            ),
            h('span', { className: 'sc-meta' }, meta),
          ),
          h(
            'div',
            { className: 'sc-rowActions' },
            running
              ? h('button', { type: 'button', className: 'sc-btn', onClick: () => { void cancel() } }, t('cancel'))
              : null,
            !running && channel.linked === true
              ? h('button', { type: 'button', className: 'sc-btn sc-btnPrimary', disabled: busy, onClick: () => { void start() } }, t('relogin'))
              : null,
            !running && channel.linked !== true
              ? h('button', { type: 'button', className: 'sc-btn sc-btnPrimary', disabled: busy, onClick: () => { void start() } }, t('login'))
              : null,
            !running && channel.linked === true
              ? h(
                'button',
                {
                  type: 'button',
                  className: 'sc-btn',
                  'aria-expanded': catalogOpen,
                  onClick: () => setCatalogOpen(value => !value),
                },
                t('catalog'),
              )
              : null,
            !running && channel.linked === true
              ? h(
                'button',
                {
                  type: 'button',
                  className: 'sc-btn sc-btnQuiet',
                  disabled: busy,
                  onClick: () => {
                    if (confirming) {
                      void signOut()
                      return
                    }
                    setConfirming(true)
                    setTimeout(() => setConfirming(false), 4000)
                  },
                },
                confirming ? t('confirmLogout') : t('logout'),
              )
              : null,
          ),
        ),
        error !== undefined
          ? h(
            'p',
            { className: 'sc-error', role: 'alert' },
            `${t('failed')}: ${friendlyError(error, t)}`,
            h('button', { type: 'button', className: 'sc-btn sc-btnTiny', onClick: () => { setError(undefined); void start() } }, t('retry')),
          )
          : null,
        running
          ? h(
            'div',
            { className: 'sc-panel' },
            notices.length === 0
              ? h('p', { className: 'sc-note' }, t('waitingLink'))
              : notices.map((notice, index) => h(
                'p',
                { className: 'sc-note', key: `notice-${index}` },
                notice.message,
                notice.code !== undefined ? h('code', { className: 'sc-code' }, notice.code) : null,
                notice.url !== undefined
                  ? h(
                    'a',
                    { className: 'sc-link', href: notice.url, target: '_blank', rel: 'noreferrer noopener' },
                    t('openLink'),
                  )
                  : null,
              )),
            prompt !== undefined
              ? h(
                'div',
                { className: 'sc-prompt' },
                h('label', { className: 'sc-note', htmlFor: `sc-answer-${channel.id}` }, prompt.message),
                h('input', {
                  id: `sc-answer-${channel.id}`,
                  className: 'sc-input',
                  value: answer,
                  placeholder: prompt.placeholder ?? t('answerPlaceholder'),
                  onChange: event => setAnswer(event.target.value),
                  onKeyDown: event => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void respond()
                    }
                  },
                }),
                h('button', {
                  type: 'button',
                  className: 'sc-btn',
                  disabled: answer.trim().length === 0,
                  onClick: () => { void respond() },
                }, t('submit')),
              )
              : null,
          )
          : null,
        channel.linked === true
          ? h(CatalogPanel, {
            channel,
            t,
            open: catalogOpen,
            onSaved: () => { void onChanged() },
          })
          : null,
        attempt !== undefined && attempt.status === 'authorized'
          ? h('p', { className: 'sc-ok', role: 'status' }, t('succeeded'))
          : null,
        attempt !== undefined && attempt.status === 'cancelled'
          ? h('p', { className: 'sc-note', role: 'status' }, t('cancelled'))
          : null,
        attempt !== undefined && attempt.status === 'failed'
          ? h(
            'p',
            { className: 'sc-error', role: 'alert' },
            `${t('failed')}: ${friendlyError(attempt.error ?? '', t)}`,
            h('button', { type: 'button', className: 'sc-btn sc-btnTiny', onClick: () => { setAttempt(undefined); void start() } }, t('retry')),
          )
          : null,
      )
    }

    /** Parse "256K" / "1M" / "131072" into a token count. */
    function parseCapacity(text) {
      const raw = String(text ?? '').trim().toLowerCase()
      if (raw.length === 0) return undefined
      const match = /^(\d+(?:\.\d+)?)\s*([km])?$/u.exec(raw)
      if (match === null) return undefined
      const value = Math.round(Number(match[1]) * (match[2] === 'm' ? 1_000_000 : match[2] === 'k' ? 1_000 : 1))
      return Number.isSafeInteger(value) && value > 0 ? value : undefined
    }

    /** Render a capacity the way the official model editor does. */
    function formatCapacity(value) {
      if (typeof value !== 'number' || value <= 0) return ''
      if (value % 1_000_000 === 0) return `${value / 1_000_000}M`
      if (value % 1_000 === 0) return `${value / 1_000}K`
      return String(value)
    }

    /** One catalog row: visibility, display name, capacity, input types, reasoning, probe. */
    function CatalogModelRow(props) {
      const { channel, model, t, selected, onSelect, onPatched, probe, onTest, onSaved } = props
      const [open, setOpen] = React.useState(false)
      const [error, setError] = React.useState(undefined)
      const [busy, setBusy] = React.useState(false)
      const [contextDraft, setContextDraft] = React.useState(formatCapacity(model.contextWindow))
      const [maxDraft, setMaxDraft] = React.useState(formatCapacity(model.maxTokens))

      React.useEffect(() => { setContextDraft(formatCapacity(model.contextWindow)) }, [model.contextWindow])
      React.useEffect(() => { setMaxDraft(formatCapacity(model.maxTokens)) }, [model.maxTokens])

      const patch = async (next) => {
        setBusy(true)
        setError(undefined)
        try {
          const view = await api('/catalog/model', {
            method: 'POST',
            body: JSON.stringify({ channel: channel.id, model: model.id, patch: next }),
          })
          onPatched(view)
          onSaved()
        } catch (failure) {
          setError(String(failure.message ?? failure))
        } finally {
          setBusy(false)
        }
      }

      const available = Array.isArray(model.availableEfforts) ? model.availableEfforts : []
      const chosen = new Set((model.reasoning?.efforts ?? []).map(effort => effort.id))
      const input = Array.isArray(model.inputModalities) ? model.inputModalities : ['text']
      const hasImage = input.includes('image')
      const hasText = input.includes('text')

      const toggleEffort = (id) => {
        const next = new Set(chosen)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        const ordered = available.filter(effort => next.has(effort.id)).map(effort => effort.id)
        void patch({ efforts: ordered })
      }

      const toggleInput = (kind) => {
        const next = new Set(input)
        if (next.has(kind)) next.delete(kind)
        else next.add(kind)
        const ordered = ['text', 'image'].filter(value => next.has(value))
        void patch({ input: ordered })
      }

      const probeStatus = probe === 'running'
        ? h('span', { className: 'sc-probe sc-probeBusy' }, t('testing'))
        : probe === undefined
          ? null
          : h(
            'span',
            {
              className: probe.ok ? 'sc-probe sc-probeOk' : 'sc-probe sc-probeFail',
              title: probe.detail ?? probe.reason ?? '',
            },
            probe.ok
              ? `${t('testAvailable')}${typeof probe.latencyMs === 'number' ? ` · ${probe.latencyMs}ms` : ''}`
              : `${t('testUnavailable')}${probe.reason === undefined ? '' : `：${probe.reason}`}`,
          )

      return h(
        'li',
        { className: model.visible ? 'sc-model' : 'sc-model sc-modelOff' },
        h(
          'div',
          { className: 'sc-modelHead' },
          h('input', {
            type: 'checkbox',
            className: 'sc-check',
            checked: selected,
            'aria-label': `${t('testModel')} ${model.name}`,
            onChange: event => onSelect(event.target.checked),
          }),
          h('code', { className: 'sc-modelId', title: model.id }, model.id),
          h('input', {
            className: 'sc-modelName',
            defaultValue: model.name,
            disabled: busy,
            'aria-label': t('displayName'),
            onBlur: event => {
              if (event.target.value !== model.name) void patch({ name: event.target.value })
            },
          }),
          h(
            'button',
            {
              type: 'button',
              className: 'sc-iconBtn',
              'aria-expanded': open,
              'aria-label': t('modelOptions'),
              onClick: () => setOpen(value => !value),
            },
            h(IconChevron, { open }),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'sc-linkBtn',
              disabled: busy,
              onClick: () => { void patch({ visible: !model.visible }) },
            },
            model.visible ? t('removeModel') : t('restoreModel'),
          ),
        ),
        open
          ? h(
            'div',
            { className: 'sc-modelOptions' },
            h(
              'label',
              { className: 'sc-field' },
              h('span', { className: 'sc-fieldLabel' }, t('contextWindow')),
              h('input', {
                className: 'sc-input sc-inputNumber',
                value: contextDraft,
                placeholder: '1M',
                inputMode: 'numeric',
                disabled: busy,
                onChange: event => setContextDraft(event.target.value),
                onBlur: () => {
                  const parsed = parseCapacity(contextDraft)
                  if (parsed === model.contextWindow) return
                  void patch({ contextWindow: parsed })
                },
              }),
            ),
            h(
              'label',
              { className: 'sc-field' },
              h('span', { className: 'sc-fieldLabel' }, t('maxOutput')),
              h('input', {
                className: 'sc-input sc-inputNumber',
                value: maxDraft,
                placeholder: '128K',
                inputMode: 'numeric',
                disabled: busy,
                onChange: event => setMaxDraft(event.target.value),
                onBlur: () => {
                  const parsed = parseCapacity(maxDraft)
                  if (parsed === model.maxTokens) return
                  void patch({ maxTokens: parsed })
                },
              }),
            ),
            h(
              'fieldset',
              { className: 'sc-fieldSet' },
              h('legend', { className: 'sc-fieldLabel' }, t('inputTypes')),
              h('label', { className: 'sc-choice' },
                h('input', {
                  type: 'checkbox',
                  checked: hasText,
                  disabled: busy || (hasText && !hasImage),
                  onChange: () => toggleInput('text'),
                }),
                t('inputText')),
              h('label', { className: 'sc-choice' },
                h('input', {
                  type: 'checkbox',
                  checked: hasImage,
                  disabled: busy || (hasImage && !hasText),
                  onChange: () => toggleInput('image'),
                }),
                t('inputImage')),
            ),
            h(
              'fieldset',
              { className: 'sc-fieldSet' },
              h('legend', { className: 'sc-fieldLabel' }, t('reasoningLevels')),
              available.length === 0
                ? h('span', { className: 'sc-note' }, t('reasoningNone'))
                : available.map(effort => h(
                  'label',
                  { className: 'sc-choice', key: effort.id },
                  h('input', {
                    type: 'checkbox',
                    checked: chosen.has(effort.id),
                    disabled: busy,
                    onChange: () => toggleEffort(effort.id),
                  }),
                  effort.name ?? effort.id,
                )),
            ),
            h(
              'div',
              { className: 'sc-modelActions' },
              h('button', {
                type: 'button',
                className: 'sc-btn sc-btnTiny',
                disabled: busy,
                onClick: () => onTest(model.id),
              }, t('testModel')),
              probeStatus,
            ),
            error === undefined
              ? null
              : h('p', { className: 'sc-error', role: 'alert' }, `${t('failPrefix')}: ${error}`),
          )
          : null,
      )
    }

    /** The per-channel model catalog: visibility, edits, discovery, and probes. */
    function CatalogPanel(props) {
      const { channel, t, open, onSaved } = props
      const [status, setStatus] = React.useState('idle')
      const [view, setView] = React.useState(undefined)
      const [error, setError] = React.useState(undefined)
      const [busy, setBusy] = React.useState(false)
      const [selection, setSelection] = React.useState(() => new Set())
      const [probes, setProbes] = React.useState({})

      const load = React.useCallback(async () => {
        setStatus('loading')
        setError(undefined)
        try {
          const next = await api('/catalog?channel=' + encodeURIComponent(channel.id))
          setView(next)
          setStatus('ready')
        } catch (failure) {
          setError(String(failure.message ?? failure))
          setStatus('failed')
        }
      }, [channel.id])

      React.useEffect(() => {
        if (open && view === undefined) void load()
      }, [open, view, load])

      const discover = async (restore) => {
        setBusy(true)
        setError(undefined)
        try {
          const next = await api('/catalog/discover', {
            method: 'POST',
            body: JSON.stringify({ channel: channel.id, restore }),
          })
          setView(next)
          onSaved()
        } catch (failure) {
          setError(String(failure.message ?? failure))
        } finally {
          setBusy(false)
        }
      }

      const probeOne = async (modelId) => {
        setProbes(current => ({ ...current, [modelId]: 'running' }))
        try {
          const verdict = await api('/test', {
            method: 'POST',
            body: JSON.stringify({ channel: channel.id, model: modelId }),
          })
          setProbes(current => ({ ...current, [modelId]: verdict }))
        } catch (failure) {
          setProbes(current => ({
            ...current,
            [modelId]: { ok: false, reason: String(failure.message ?? failure) },
          }))
        }
      }

      const probeSelected = async () => {
        for (const modelId of selection) await probeOne(modelId)
      }

      if (!open) return null

      const models = view?.models ?? []
      const toggle = (modelId, checked) => {
        setSelection((current) => {
          const next = new Set(current)
          if (checked) next.add(modelId)
          else next.delete(modelId)
          return next
        })
      }

      return h(
        'div',
        { className: 'sc-catalog' },
        h(
          'div',
          { className: 'sc-catHead' },
          h('span', { className: 'sc-catTitle' }, t('catalog')),
          view === undefined
            ? null
            : h('span', { className: 'sc-catMeta' }, t('catalogMeta')
              .replace('%VISIBLE%', String(view.visibleCount))
              .replace('%HIDDEN%', String(view.hiddenCount))),
          h('span', { className: 'sc-catSpacer' }),
          h('button', {
            type: 'button',
            className: 'sc-linkBtn',
            disabled: busy,
            onClick: () => { void discover(false) },
          }, busy ? t('discovering') : t('discover')),
          view !== undefined && view.hiddenCount > 0
            ? h('button', {
              type: 'button',
              className: 'sc-linkBtn',
              disabled: busy,
              onClick: () => { void discover(true) },
            }, t('restoreAll'))
            : null,
        ),
        h('p', { className: 'sc-catHint' }, t('catalogHint')),
        error === undefined ? null : h('p', { className: 'sc-error', role: 'alert' }, `${t('failPrefix')}: ${error}`),
        status === 'loading' ? h('p', { className: 'sc-note' }, t('loading')) : null,
        status === 'ready' && models.length === 0
          ? h('p', { className: 'sc-modelEmpty' }, t('catalogEmpty'))
          : null,
        models.length === 0
          ? null
          : h(
            'ul',
            { className: 'sc-modelList' },
            models.map(model => h(CatalogModelRow, {
              key: model.id,
              channel,
              model,
              t,
              selected: selection.has(model.id),
              onSelect: checked => toggle(model.id, checked),
              onPatched: next => setView(next),
              probe: probes[model.id],
              onTest: modelId => { void probeOne(modelId) },
              onSaved,
            })),
          ),
        models.length === 0
          ? null
          : h(
            'div',
            { className: 'sc-modelFooter' },
            h('button', {
              type: 'button',
              className: 'sc-btn sc-btnTiny',
              disabled: selection.size === 0 || busy,
              onClick: () => { void probeSelected() },
            }, t('testSelected').replace('%COUNT%', String(selection.size))),
            h('button', {
              type: 'button',
              className: 'sc-linkBtn',
              onClick: () => setSelection((current) => current.size === models.length
                ? new Set()
                : new Set(models.map(model => model.id))),
            }, selection.size === models.length ? t('clearSelection') : t('selectAll')),
          ),
      )
    }

    /** The Models-page entry: a dashed button that expands into the channel list. */
    function SubscriptionChannels(props) {
      const t = props.t
      const [open, setOpen] = React.useState(false)
      const [state, setState] = React.useState({ status: 'loading', channels: [] })

      const refresh = React.useCallback(async () => {
        try {
          const next = await api('/state')
          setState({ status: 'ready', channels: Array.isArray(next.channels) ? next.channels : [] })
        } catch (failure) {
          setState({ status: 'failed', channels: [], error: String(failure.message ?? failure) })
        }
      }, [])

      React.useEffect(() => {
        if (open && state.status === 'loading') void refresh()
      }, [open, state.status, refresh])

      // Re-read the truth when the window regains focus: a grant can expire or
      // be revoked while this card sits open.
      React.useEffect(() => {
        if (!open) return undefined
        const onVisible = () => {
          if (document.visibilityState === 'visible') void refresh()
        }
        document.addEventListener('visibilitychange', onVisible)
        window.addEventListener('focus', onVisible)
        return () => {
          document.removeEventListener('visibilitychange', onVisible)
          window.removeEventListener('focus', onVisible)
        }
      }, [open, refresh])

      const linkedCount = state.channels.filter(channel => channel.linked === true && channel.status !== 'expired').length

      return h(
        'div',
        { className: 'sc-root' },
        h(StyleSheet),
        h(
          'button',
          {
            type: 'button',
            className: 'sc-entry',
            'aria-expanded': open,
            onClick: () => setOpen(value => !value),
          },
          h(IconPlus),
          h(
            'span',
            { className: 'sc-entryText' },
            h('span', { className: 'sc-entryLabel' }, t('entry')),
            h('span', { className: 'sc-entrySub' }, t('entrySub')),
          ),
          linkedCount > 0 ? h('span', { className: 'sc-badge' }, `${linkedCount}`) : null,
          h('span', { className: 'sc-entrySpacer' }),
          h(IconChevron, { open }),
        ),
        open
          ? h(
            'div',
            { className: 'sc-card' },
            h('p', { className: 'sc-hint' }, t('hint')),
            state.status === 'loading'
              ? h('p', { className: 'sc-note' }, t('loading'))
              : null,
            state.status === 'failed'
              ? h('p', { className: 'sc-error', role: 'alert' }, String(state.error ?? ''))
              : null,
            state.status === 'ready'
              ? h(
                'ul',
                { className: 'sc-list' },
                state.channels.map(channel => h(ChannelRow, {
                  key: channel.id,
                  channel,
                  t,
                  onChanged: refresh,
                })),
              )
              : null,
            h('p', { className: 'sc-foot' }, t('footnote')),
          )
          : null,
      )
    }

    function StyleSheet() {
      return h('style', null, `
.sc-root { display: flex; flex-direction: column; gap: 12px; }
.sc-entry {
  display: flex; align-items: center; gap: 10px; width: 100%; box-sizing: border-box;
  min-height: 52px; padding: 8px 14px; cursor: pointer; text-align: left;
  font: inherit; color: var(--dsw-alias-label-primary);
  background: transparent; border: 1px dashed var(--dsw-alias-border-l3, var(--dsw-alias-border-l2, var(--dsw-alias-border-l1)));
  border-radius: var(--dsw-radius-lg, 12px);
}
.sc-entry:hover { background: var(--dsw-alias-bg-layer-2); }
.sc-entry:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); }
.sc-entryText { display: flex; flex-direction: column; gap: 1px; flex: 1 1 auto; min-width: 0; }
.sc-entryLabel { font-size: 14px; font-weight: 500; }
.sc-entrySub { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-secondary); }
.sc-badge {
  min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; box-sizing: border-box;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; line-height: 1; color: var(--dsw-alias-bg-base);
  background: var(--dsw-alias-brand-primary);
}
.sc-card {
  display: flex; flex-direction: column; gap: 12px;
  padding: 14px 16px; border-radius: var(--dsw-radius-lg, 12px);
  background: var(--dsw-alias-bg-layer-2); border: 0.5px solid var(--dsw-alias-border-l1);
}
.sc-hint { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.sc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.sc-row {
  display: flex; flex-direction: column; gap: 8px;
  padding: 10px 12px; border-radius: var(--dsw-radius-md, 10px);
  background: var(--dsw-alias-bg-layer-1); border: 0.5px solid var(--dsw-alias-border-l1);
}
.sc-rowHead { display: flex; align-items: center; gap: 12px; }
.sc-rowText { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.sc-name { font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.sc-status { font-size: 12px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.sc-statusOn { color: var(--dsw-alias-state-success-primary); }
.sc-meta { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-secondary); }
.sc-rowActions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.sc-btn {
  height: 28px; padding: 0 12px; cursor: pointer; font: inherit; font-size: 12px;
  color: var(--dsw-alias-label-primary); background: transparent;
  border: 0.5px solid var(--dsw-alias-border-l2, var(--dsw-alias-border-l1));
  border-radius: var(--dsw-radius-sm, 8px);
}
.sc-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.sc-btn:disabled { opacity: 0.5; cursor: default; }
.sc-btn:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); }
.sc-btnPrimary { color: var(--dsw-alias-bg-base); background: var(--dsw-alias-brand-primary); border-color: transparent; }
.sc-btnPrimary:hover:not(:disabled) { background: var(--dsw-alias-brand-primary); opacity: 0.9; }
.sc-btnQuiet { color: var(--dsw-alias-label-secondary); border-color: transparent; }
.sc-btnQuiet:hover:not(:disabled) { color: var(--dsw-alias-state-error-primary); background: transparent; }
.sc-btnTiny { height: 22px; padding: 0 8px; margin-left: 8px; font-size: 11px; }
.sc-panel {
  display: flex; flex-direction: column; gap: 8px;
  padding-top: 8px; border-top: 0.5px solid var(--dsw-alias-border-l1);
}
.sc-note { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.sc-error { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary); overflow-wrap: anywhere; }
.sc-ok { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-success-primary); }
.sc-code {
  margin-left: 6px; padding: 1px 6px; border-radius: 4px; font-size: 12px;
  background: var(--dsw-alias-bg-base); border: 0.5px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-primary);
}
.sc-link { margin-left: 8px; font-size: 12px; color: var(--dsw-alias-brand-primary); }
.sc-prompt { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; width: 100%; }
.sc-input {
  width: 100%; box-sizing: border-box; height: 30px; padding: 0 10px; font: inherit; font-size: 12px;
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base);
  border: 0.5px solid var(--dsw-alias-border-l2, var(--dsw-alias-border-l1));
  border-radius: var(--dsw-radius-sm, 8px);
}
.sc-input:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); }
.sc-catalog {
  display: flex; flex-direction: column; gap: 10px;
  padding-top: 10px; margin-top: 2px; border-top: 0.5px solid var(--dsw-alias-border-l2);
}
.sc-catHead { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sc-catTitle { font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.sc-catMeta { font-size: 12px; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.sc-catSpacer { flex: 1 1 auto; }
.sc-catHint { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.sc-modelList { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; max-height: 380px; overflow: auto; }
.sc-model {
  display: flex; flex-direction: column; gap: 8px;
  padding: 6px 8px; border-radius: var(--dsw-radius-sm, 8px);
  border: 0.5px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base);
}
.sc-modelOff { opacity: 0.6; }
.sc-modelHead { display: flex; align-items: center; gap: 8px; }
.sc-check { width: 14px; height: 14px; margin: 0; accent-color: var(--dsw-alias-brand-primary); flex: 0 0 auto; }
.sc-modelId {
  font: 11px/16px ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--dsw-alias-label-secondary);
  max-width: 42%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 0 0 auto;
}
.sc-modelName {
  flex: 1 1 auto; min-width: 80px; height: 28px; padding: 0 8px; font: inherit; font-size: 12px;
  color: var(--dsw-alias-label-primary); background: transparent;
  border: 0.5px solid transparent; border-radius: var(--dsw-radius-sm, 8px);
}
.sc-modelName:hover:not(:disabled) { border-color: var(--dsw-alias-border-l1); }
.sc-modelName:focus-visible { outline: none; border-color: var(--dsw-alias-border-l2); }
.sc-iconBtn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; padding: 0; cursor: pointer; color: var(--dsw-alias-label-secondary);
  background: transparent; border: none; border-radius: var(--dsw-radius-sm, 8px);
}
.sc-iconBtn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.sc-linkBtn {
  padding: 0; height: auto; cursor: pointer; font: inherit; font-size: 12px;
  color: var(--dsw-alias-brand-primary); background: none; border: none;
}
.sc-linkBtn:disabled { opacity: 0.5; cursor: default; }
.sc-linkBtn:hover:not(:disabled) { text-decoration: underline; }
.sc-modelOptions { display: flex; flex-direction: column; gap: 10px; padding: 4px 2px 6px; }
.sc-field { display: flex; flex-direction: column; gap: 4px; }
.sc-fieldLabel { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); padding: 0; }
.sc-inputNumber { height: 32px; max-width: 180px; }
.sc-fieldSet { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; margin: 0; padding: 0; border: none; }
.sc-fieldSet > legend { float: left; margin-right: 6px; }
.sc-choice { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dsw-alias-label-primary); }
.sc-choice input { width: 14px; height: 14px; margin: 0; accent-color: var(--dsw-alias-brand-primary); }
.sc-modelActions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sc-probe { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.sc-probeBusy { color: var(--dsw-alias-label-secondary); }
.sc-probeOk { color: var(--dsw-alias-state-success-primary); }
.sc-probeFail { color: var(--dsw-alias-state-error-primary); }
.sc-modelEmpty {
  margin: 0; padding: 12px; text-align: center; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
  border: 1px dashed var(--dsw-alias-border-l3, var(--dsw-alias-border-l2)); border-radius: var(--dsw-radius-lg, 12px);
}
.sc-modelFooter { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.sc-foot { margin: 0; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-secondary); }
`)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const locale = ctx.get('locale')
        let t = fallbackT
        if (locale !== undefined) {
          ctx.effect(() => locale.register(NS, 'zh', zh))
          ctx.effect(() => locale.register(NS, 'en', en))
          t = locale.bind(NS)
        }
        ctx.effect(() => ctx.slots.inject('settings.models.footer', () => ctx.slots.register(
          { name: 'settings.models.footer', id: 'subscription-channels', order: 40 },
          props => h(SubscriptionChannels, { ...props, t }),
        )))
      },
    }
  },
})







