// Browser half of the subscription-channels bundle.
// Registers the subscription-channels entry in Settings > Models and mirrors the
// official provider-row and model-editor patterns of that page.
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
      hint: '登录已有的 ChatGPT、Google Antigravity、Claude 订阅账号，直接使用账号内的模型，无需 API 密钥。',
      login: '登录',
      addAccount: '添加账号',
      accountsTitle: 'ChatGPT 账号',
      accountSelected: '当前账号',
      accountNeedsLogin: '需重新登录',
      edit: '编辑',
      logout: '退出登录',
      cancel: '取消',
      submit: '提交',
      openLink: '打开登录页面',
      waitingLink: '等待浏览器完成授权…',
      linked: '已登录',
      notLinked: '未登录',
      expired: '已过期',
      succeeded: '登录成功。',
      failed: '登录失败',
      cancelled: '登录已取消',
      confirmLogout: '确认退出',
      retry: '重试',
      answerPlaceholder: '在此粘贴授权码或回调地址',
      loading: '读取中…',
      pickTitle: '可用模型',
      pickNone: '没有可添加的模型。',
      pickAdd: '添加',
      effortMinimal: '极低',
      effortLow: '轻度',
      effortMedium: '中',
      effortHigh: '高',
      effortXhigh: '极高',
      effortUltra: 'Ultra',
      effortOff: '关闭',      catalog: '模型目录',
      catalogCustomized: '已自定义模型目录',
      resetCatalog: '恢复默认模型',
      discover: '获取可用模型',
      discovering: '正在询问提供商…',
      addModel: '添加模型',
      addModelConfirm: '添加',
      modelId: '模型 ID',
      displayName: '显示名称',
      modelOptions: '模型选项',
      removeModel: '删除模型',
      contextWindow: '上下文窗口',
      maxOutput: '最大输出 token 数',
      inputTypes: '输入类型',
      inputText: '文本',
      inputImage: '图片',
      reasoning: '推理等级',
      reasoningLevel: '档位',
      reasoningValue: 'API 参数值',
      reasoningAdd: '添加档位',
      reasoningRemove: '移除档位',
      reasoningOff: '关闭思考',
      testModel: '检测',
      testAll: '检测全部',
      testing: '检测中…',
      testAvailable: '可用',
      testUnavailable: '不可用',
      errInvalidGrant: '授权被拒绝或已失效，请重新登录。',
      errSessionEnded: '登录会话已结束，请重试。',
      errStaleInput: '这个输入框已失效，请重试。',
      footnote: '令牌只保存在本机凭据库；上游接口变化时可在插件配置里覆盖 OAuth 参数。',
    }
    const en = {
      entry: 'Subscription channels',
      entrySub: 'Sign in with a subscription account',
      hint: 'Sign in to an existing ChatGPT, Google Antigravity or Claude subscription and use the models it already includes — no API key needed.',
      login: 'Sign in',
      addAccount: 'Add account',
      accountsTitle: 'ChatGPT accounts',
      accountSelected: 'Current account',
      accountNeedsLogin: 'Sign in again',
      edit: 'Edit',
      logout: 'Sign out',
      cancel: 'Cancel',
      submit: 'Submit',
      openLink: 'Open sign-in page',
      waitingLink: 'Waiting for the browser to finish…',
      linked: 'Signed in',
      notLinked: 'Not signed in',
      expired: 'Expired',
      succeeded: 'Signed in.',
      failed: 'Sign-in failed',
      cancelled: 'Sign-in cancelled',
      confirmLogout: 'Confirm sign-out',
      retry: 'Retry',
      answerPlaceholder: 'Paste the authorization code or callback URL',
      loading: 'Loading…',
      pickTitle: 'Available models',
      pickNone: 'No models to add.',
      pickAdd: 'Add',
      effortMinimal: 'Minimal',
      effortLow: 'Low',
      effortMedium: 'Medium',
      effortHigh: 'High',
      effortXhigh: 'Extra high',
      effortUltra: 'Ultra',
      effortOff: 'Off',      catalog: 'Model catalog',
      catalogCustomized: 'Customized catalog',
      resetCatalog: 'Restore defaults',
      discover: 'Fetch available models',
      discovering: 'Asking the provider…',
      addModel: 'Add model',
      addModelConfirm: 'Add',
      modelId: 'Model ID',
      displayName: 'Display name',
      modelOptions: 'Model options',
      removeModel: 'Remove model',
      contextWindow: 'Context window',
      maxOutput: 'Max output tokens',
      inputTypes: 'Input types',
      inputText: 'Text',
      inputImage: 'Image',
      reasoning: 'Reasoning',
      reasoningLevel: 'Level',
      reasoningValue: 'API value',
      reasoningAdd: 'Add level',
      reasoningRemove: 'Remove level',
      reasoningOff: 'Reasoning off',
      testModel: 'Test',
      testAll: 'Test all',
      testing: 'Testing…',
      testAvailable: 'Available',
      testUnavailable: 'Unavailable',
      errInvalidGrant: 'The authorization was refused or has expired. Sign in again.',
      errSessionEnded: 'That sign-in session ended. Try again.',
      errStaleInput: 'That input is no longer active. Try again.',
      footnote: 'Tokens stay in the local credential store. OAuth parameters can be overridden in the plugin config when an upstream changes.',
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

    /** Turn a Host diagnostic into a sentence the card can show. */
    function friendlyError(raw, t) {
      const text = String(raw ?? '')
      if (/invalid_grant|unauthorized|401/u.test(text)) return t('errInvalidGrant')
      if (/no such sign-in attempt/u.test(text)) return t('errSessionEnded')
      if (/no question is waiting/u.test(text)) return t('errStaleInput')
      return text
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

    function IconDrag() {
      return h(
        'svg',
        { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false },
        [3, 8, 13].map(y => h('g', { key: y, fill: 'currentColor' },
          h('circle', { cx: 6, cy: y, r: 1.25 }),
          h('circle', { cx: 10, cy: y, r: 1.25 }))),
      )
    }

    function IconTrash() {
      return h(
        'svg',
        { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false },
        h('path', {
          d: 'M3 4.5h10M6.5 4.5V3.2c0-.4.3-.7.7-.7h1.6c.4 0 .7.3.7.7v1.3M5 4.5l.6 8.1c0 .4.4.7.8.7h3.2c.4 0 .8-.3.8-.7l.6-8.1',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    function IconClose() {
      return h(
        'svg',
        { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false },
        h('path', {
          d: 'M4 4l8 8M12 4l-8 8',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          fill: 'none',
        }),
      )
    }
    /** One model row of the catalog, mirroring the official editor row. */
    function CatalogModelRow(props) {
      const { channel, model, t, index, total, onPatched, onMove, probe, onTest, onSaved } = props
      const [open, setOpen] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(undefined)
      const [over, setOver] = React.useState(false)
      const [contextDraft, setContextDraft] = React.useState(formatCapacity(model.contextWindow))
      const [maxDraft, setMaxDraft] = React.useState(formatCapacity(model.maxTokens))

      React.useEffect(() => { setContextDraft(formatCapacity(model.contextWindow)) }, [model.contextWindow])
      React.useEffect(() => { setMaxDraft(formatCapacity(model.maxTokens)) }, [model.maxTokens])

      const patch = async (next) => {
        setBusy(true)
        setError(undefined)
        try {
          onPatched(await api('/catalog/model', {
            method: 'POST',
            body: JSON.stringify({ channel: channel.id, model: model.id, patch: next }),
          }))
          onSaved()
        } catch (failure) {
          setError(String(failure.message ?? failure))
        } finally {
          setBusy(false)
        }
      }

      const available = Array.isArray(model.availableEfforts) ? model.availableEfforts : []
      const rows = (Array.isArray(model.efforts) ? model.efforts : []).map(effort => ({
        id: effort.id,
        wire: typeof effort.wire === 'string' ? effort.wire : '',
      }))
      const input = Array.isArray(model.inputModalities) ? model.inputModalities : ['text']
      const hasImage = input.includes('image')
      const hasText = input.includes('text')
      const levelIds = [...new Set([...available.map(effort => effort.id), ...rows.map(row => row.id), 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'ultra'])]
      const defaultWire = (id) => available.find(effort => effort.id === id)?.wire ?? id

      const writeEfforts = (next) => { void patch({ efforts: next }) }

      const toggleReasoning = () => {
        writeEfforts(rows.length === 0 ? available.map(effort => ({ id: effort.id, wire: effort.wire })) : [])
      }

      const addLevel = () => {
        const used = new Set(rows.map(row => row.id))
        const nextId = ['low', 'medium', 'high', 'xhigh', 'ultra', 'minimal', 'off'].find(id => !used.has(id)) ?? `level-${rows.length + 1}`
        writeEfforts([...rows, { id: nextId, wire: defaultWire(nextId) }])
      }

      const changeLevel = (position, nextId) => {
        const next = rows.map((row, index_) => index_ === position ? { id: nextId, wire: defaultWire(nextId) } : row)
        const seen = new Set()
        writeEfforts(next.filter((row) => {
          if (seen.has(row.id)) return false
          seen.add(row.id)
          return true
        }))
      }

      const changeWire = (position, wire) => {
        writeEfforts(rows.map((row, index_) => index_ === position ? { ...row, wire } : row))
      }

      const removeLevel = (position) => {
        writeEfforts(rows.filter((_row, index_) => index_ !== position))
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
              : `${t('testUnavailable')} · ${probe.reason ?? ''}`,
          )

      return h(
        'div',
        {
          className: over ? 'sc-modelEntry sc-modelEntryOver' : 'sc-modelEntry',
          onDragOver: (event) => {
            if (event.dataTransfer === null) return
            event.preventDefault()
            setOver(true)
          },
          onDragLeave: (event) => {
            if (event.currentTarget.contains(event.relatedTarget)) return
            setOver(false)
          },
          onDrop: (event) => {
            event.preventDefault()
            setOver(false)
            const from = Number(event.dataTransfer.getData('application/x-dsh-model'))
            if (Number.isInteger(from)) onMove(from, index)
          },
        },
        h(
          'div',
          { className: 'sc-modelRow' },
          h(
            'button',
            {
              type: 'button',
              className: 'sc-iconButton sc-dragHandle',
              'aria-label': `${t('modelOptions')} · ${model.id}`,
              'aria-keyshortcuts': 'ArrowUp ArrowDown',
              draggable: true,
              onDragStart: (event) => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('application/x-dsh-model', String(index))
              },
              onKeyDown: (event) => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                event.preventDefault()
                event.stopPropagation()
                const target = index + (event.key === 'ArrowUp' ? -1 : 1)
                if (target >= 0 && target < total) onMove(index, target)
              },
            },
            h(IconDrag),
          ),
          h('input', {
            className: 'sc-input',
            value: model.id,
            readOnly: true,
            tabIndex: -1,
            'aria-label': t('modelId'),
          }),
          h('input', {
            className: 'sc-input',
            defaultValue: model.name,
            placeholder: model.id,
            disabled: busy,
            'aria-label': t('displayName'),
            onFocus: () => setOpen(true),
            onBlur: (event) => {
              if (event.target.value !== model.name) void patch({ name: event.target.value })
            },
          }),
          h(
            'button',
            {
              type: 'button',
              className: 'sc-iconButton',
              'aria-label': t('modelOptions'),
              'aria-expanded': open,
              title: t('modelOptions'),
              onClick: (event) => { event.currentTarget.focus(); setOpen(value => !value) },
            },
            h(IconChevron, { open }),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'sc-iconButton sc-iconButtonDanger',
              'aria-label': `${t('removeModel')} ${model.id}`,
              title: t('removeModel'),
              disabled: busy,
              onClick: () => { void patch({ visible: false }) },
            },
            h(IconTrash),
          ),
        ),
        open
          ? h(
            'div',
            { className: 'sc-modelAdvanced' },
            h(
              'label',
              { className: 'sc-modelField' },
              h('span', { className: 'sc-modelFieldLabel' }, t('contextWindow')),
              h('input', {
                className: 'sc-input',
                type: 'text',
                inputMode: 'numeric',
                value: contextDraft,
                placeholder: '1M',
                disabled: busy,
                'aria-label': `${t('contextWindow')} ${model.id}`,
                onChange: event => setContextDraft(event.target.value),
                onBlur: () => {
                  const parsed = parseCapacity(contextDraft)
                  if (parsed !== model.contextWindow) void patch({ contextWindow: parsed })
                },
              }),
            ),
            h(
              'label',
              { className: 'sc-modelField' },
              h('span', { className: 'sc-modelFieldLabel' }, t('maxOutput')),
              h('input', {
                className: 'sc-input',
                type: 'text',
                inputMode: 'numeric',
                value: maxDraft,
                placeholder: '128K',
                disabled: busy,
                'aria-label': `${t('maxOutput')} ${model.id}`,
                onChange: event => setMaxDraft(event.target.value),
                onBlur: () => {
                  const parsed = parseCapacity(maxDraft)
                  if (parsed !== model.maxTokens) void patch({ maxTokens: parsed })
                },
              }),
            ),
            h(
              'fieldset',
              { className: 'sc-modelInputTypes' },
              h('legend', { className: 'sc-modelFieldLabel' }, t('inputTypes')),
              h(
                'div',
                { className: 'sc-modelInputChoices' },
                h('label', { className: 'sc-choice' },
                  h('input', {
                    type: 'checkbox',
                    checked: hasText,
                    disabled: busy || (hasText && !hasImage),
                    onChange: () => { void patch({ input: hasImage ? ['image'] : ['text', 'image'] }) },
                  }),
                  t('inputText')),
                h('label', { className: 'sc-choice' },
                  h('input', {
                    type: 'checkbox',
                    checked: hasImage,
                    disabled: busy || (hasImage && !hasText),
                    onChange: () => { void patch({ input: hasImage ? ['text'] : ['text', 'image'] }) },
                  }),
                  t('inputImage')),
              ),
            ),
            h(
              'div',
              { className: 'sc-modelReasoning' },
              h(
                'div',
                { className: 'sc-modelReasoningHead' },
                h('span', { className: 'sc-modelFieldLabel' }, t('reasoning')),
                h('button', {
                  type: 'button',
                  role: 'switch',
                  className: 'sc-switch',
                  'aria-checked': rows.length > 0,
                  'aria-label': t('reasoning'),
                  disabled: busy || available.length === 0,
                  onClick: toggleReasoning,
                }, h('span', { className: 'sc-switchKnob' })),
              ),
              rows.length === 0
                ? null
                : h(
                  'div',
                  { className: 'sc-modelReasoningRow', 'aria-hidden': true },
                  h('span', { className: 'sc-modelFieldLabel' }, t('reasoningLevel')),
                  h('span', { className: 'sc-modelFieldLabel' }, t('reasoningValue')),
                  h('span'),
                ),
              rows.map((row, position) => h(
                'div',
                { className: 'sc-modelReasoningRow', key: `${row.id}-${position}` },
                h(
                  'select',
                  {
                    className: 'sc-input sc-select',
                    value: row.id,
                    disabled: busy,
                    'aria-label': `${t('reasoningLevel')} ${position + 1}`,
                    onChange: event => changeLevel(position, event.target.value),
                  },
                  levelIds.map(id => h('option', { key: id, value: id }, effortLabel(t, id))),
                ),
                h('input', {
                  className: 'sc-input sc-mono',
                  value: row.wire,
                  placeholder: row.id === 'off' ? t('reasoningOff') : defaultWire(row.id),
                  'aria-label': `${row.id} ${t('reasoningValue')}`,
                  disabled: busy || row.id === 'off',
                  onChange: event => changeWire(position, event.target.value),
                  onBlur: () => { if (row.wire.trim().length === 0) changeWire(position, defaultWire(row.id)) },
                }),
                h('button', {
                  type: 'button',
                  className: 'sc-iconButton sc-iconButtonDanger',
                  'aria-label': `${t('reasoningRemove')} ${row.id}`,
                  title: t('reasoningRemove'),
                  disabled: busy,
                  onClick: () => removeLevel(position),
                }, h(IconTrash)),
              )),
              rows.length === 0
                ? null
                : h('button', {
                  type: 'button',
                  className: 'sc-addModelButton',
                  disabled: busy,
                  onClick: addLevel,
                }, h(IconPlus), t('reasoningAdd')),
            ),
            h(
              'div',
              { className: 'sc-modelTest' },
              h('button', {
                type: 'button',
                className: 'sc-linkButton',
                disabled: busy,
                onClick: () => onTest(model.id),
              }, t('testModel')),
              probeStatus,
            ),
            error === undefined ? null : h('p', { className: 'sc-error', role: 'alert' }, error),
          )
          : null,
      )
    }

    /** Render children in a body-level host so a fixed overlay is never clipped. */
    let ReactDOM
    try {
      ReactDOM = require('react-dom')
    } catch (_noReactDom) {
      ReactDOM = undefined
    }

    function Overlay(props) {
      const [host] = React.useState(() => {
        const element = document.createElement('div')
        document.body.appendChild(element)
        return element
      })
      React.useEffect(() => () => host.remove(), [host])
      return ReactDOM !== undefined && typeof ReactDOM.createPortal === 'function'
        ? ReactDOM.createPortal(props.children, host)
        : props.children
    }

    /** Localized display text for one reasoning level id. */
    function effortLabel(t, id, fallback) {
      const key = `effort${id.charAt(0).toUpperCase()}${id.slice(1)}`
      const translated = t(key)
      return translated === key ? (fallback ?? id) : translated
    }

    /** The per-channel catalog panel, mirroring the official model catalog section. */
    function AccountSection(props) {
      const { channel, t, onChanged } = props
      const [busy, setBusy] = React.useState(undefined)
      const [error, setError] = React.useState(undefined)
      const accounts = channel.accounts ?? []
      if (accounts.length === 0) return null
      const select = async (key) => {
        setBusy(key)
        setError(undefined)
        try {
          await api('/account/select', { method: 'POST', body: JSON.stringify({ channel: channel.id, key }) })
          await onChanged()
        } catch (cause) {
          setError(String(cause.message ?? cause))
        } finally {
          setBusy(undefined)
        }
      }
      return h(
        'section',
        { className: 'sc-accountPicker' },
        h(
          'div',
          { className: 'sc-modelCatalogHeading' },
          h('span', { className: 'sc-modelCatalogTitle' }, t('accountsTitle')),
        ),
        ...accounts.map(account => h(
          'button',
          {
            key: account.key,
            type: 'button',
            className: 'sc-accountRow',
            'data-selected': account.selected === true ? 'true' : 'false',
            disabled: account.linked !== true || busy !== undefined,
            onClick: () => { if (account.selected !== true && account.linked === true) void select(account.key) },
          },
          h('span', { className: 'sc-accountEmail' }, account.email ?? `${account.key.slice(0, 14)}…`),
          h('span', { className: 'sc-accountMeta' }, account.linked !== true
            ? t('accountNeedsLogin')
            : account.selected === true ? t('accountSelected') : ''),
        )),
        error === undefined ? null : h('p', { className: 'sc-error', role: 'alert' }, error),
      )
    }

    function CatalogPanel(props) {
      const { channel, t, onSaved } = props
      const [status, setStatus] = React.useState('idle')
      const [view, setView] = React.useState(undefined)
      const [error, setError] = React.useState(undefined)
      const [busy, setBusy] = React.useState(false)
      const [probes, setProbes] = React.useState({})
      const [adding, setAdding] = React.useState(false)
      const [addId, setAddId] = React.useState('')
      const [addName, setAddName] = React.useState('')
      const [picker, setPicker] = React.useState(undefined)

      const load = React.useCallback(async () => {
        setStatus('loading')
        setError(undefined)
        try {
          setView(await api('/catalog?channel=' + encodeURIComponent(channel.id)))
          setStatus('ready')
        } catch (failure) {
          setError(String(failure.message ?? failure))
          setStatus('failed')
        }
      }, [channel.id])

      React.useEffect(() => { void load() }, [load])

      const apply = async (path_, payload) => {
        setBusy(true)
        setError(undefined)
        try {
          const next = await api(path_, { method: 'POST', body: JSON.stringify({ channel: channel.id, ...payload }) })
          setView(next)
          onSaved()
          return next
        } catch (failure) {
          setError(String(failure.message ?? failure))
          return undefined
        } finally {
          setBusy(false)
        }
      }

      const reorder = (from, to) => {
        if (view === undefined || from === to) return
        const ids = view.models.map(model => model.id)
        if (from < 0 || to < 0 || from >= ids.length || to >= ids.length) return
        const next = [...ids]
        next.splice(to, 0, next.splice(from, 1)[0])
        void apply('/catalog/order', { order: next })
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
          setProbes(current => ({ ...current, [modelId]: { ok: false, reason: String(failure.message ?? failure) } }))
        }
      }

      const probeAll = async () => {
        for (const model of view?.models ?? []) await probeOne(model.id)
      }

      const discover = async () => {
        const next = await apply('/catalog/discover', {})
        if (next === undefined) return
        const known = new Set((next.models ?? []).map(model => model.id))
        const candidates = Array.isArray(next.candidates) ? next.candidates : []
        const selected = new Set(candidates.filter(candidate => !known.has(candidate.id)).map(candidate => candidate.id))
        setPicker({ candidates, selected })
      }

      const adopt = async () => {
        if (picker === undefined) return
        const result = await apply('/catalog/adopt', { models: [...picker.selected] })
        if (result !== undefined) setPicker(undefined)
      }

      const models = view?.models ?? []

      return h(
        'section',
        { className: 'sc-modelCatalog' },
        h(
          'div',
          { className: 'sc-modelListHead' },
          h(
            'div',
            { className: 'sc-modelCatalogHeading' },
            h('span', { className: 'sc-modelCatalogTitle' }, t('catalog')),
            view?.customized === true
              ? h('span', { className: 'sc-modelCatalogMeta' }, t('catalogCustomized'))
              : null,
          ),
          h(
            'div',
            { className: 'sc-headLinks' },
            view?.customized === true
              ? h('button', {
                type: 'button',
                className: 'sc-linkButton',
                disabled: busy,
                onClick: () => { void apply('/catalog/reset', {}) },
              }, t('resetCatalog'))
              : null,
            h('button', {
              type: 'button',
              className: 'sc-linkButton',
              disabled: busy || status === 'loading',
              onClick: () => { void discover() },
            }, busy ? t('discovering') : t('discover')),
            h('button', {
              type: 'button',
              className: 'sc-linkButton',
              disabled: busy || models.length === 0,
              onClick: () => { void probeAll() },
            }, t('testAll')),
          ),
        ),
        error === undefined ? null : h('p', { className: 'sc-error', role: 'alert' }, error),
        status === 'loading' ? h('p', { className: 'sc-modelCatalogMeta' }, t('loading')) : null,
        models.length === 0
          ? null
          : h(
            'div',
            { className: 'sc-modelList' },
            models.map((model, index) => h(CatalogModelRow, {
              key: model.id,
              channel,
              model,
              t,
              index,
              total: models.length,
              onPatched: next => setView(next),
              onMove: reorder,
              probe: probes[model.id],
              onTest: modelId => { void probeOne(modelId) },
              onSaved: onSaved,
            })),
          ),
        adding
          ? h(
            'div',
            { className: 'sc-modelAddRow' },
            h('input', {
              className: 'sc-input',
              placeholder: t('modelId'),
              value: addId,
              onChange: event => setAddId(event.target.value),
            }),
            h('input', {
              className: 'sc-input',
              placeholder: t('displayName'),
              value: addName,
              onChange: event => setAddName(event.target.value),
            }),
            h('button', {
              type: 'button',
              className: 'sc-secondaryButton',
              disabled: busy || addId.trim().length === 0,
              onClick: async () => {
                const result = await apply('/catalog/model', { create: true, model: addId, name: addName })
                if (result !== undefined) {
                  setAdding(false)
                  setAddId('')
                  setAddName('')
                }
              },
            }, t('addModelConfirm')),
            h('button', {
              type: 'button',
              className: 'sc-secondaryButton',
              onClick: () => { setAdding(false); setAddId(''); setAddName('') },
            }, t('cancel')),
          )
          : h('button', {
            type: 'button',
            className: 'sc-addModelButton',
            disabled: busy,
            onClick: () => setAdding(true),
          }, h(IconPlus), t('addModel')),
        picker === undefined
          ? null
          : h(
            Overlay,
            null,
            h(
              'div',
              {
                className: 'sc-modalBackdrop',
                onClick: () => setPicker(undefined),
              },
              h(
                'div',
                {
                  className: 'sc-modal',
                  role: 'dialog',
                  'aria-modal': true,
                  'aria-label': t('pickTitle'),
                  onClick: event => event.stopPropagation(),
                },
                h(
                  'div',
                  { className: 'sc-modalHead' },
                  h('span', { className: 'sc-modalTitle' }, t('pickTitle')),
                  h('button', {
                    type: 'button',
                    className: 'sc-iconButton',
                    'aria-label': t('cancel'),
                    onClick: () => setPicker(undefined),
                  }, h(IconClose)),
                ),
                h(
                  'div',
                  { className: 'sc-modalBody' },
                  picker.candidates.length === 0
                    ? h('p', { className: 'sc-modelCatalogMeta' }, t('pickNone'))
                    : picker.candidates.map(candidate => h(
                      'label',
                      { className: 'sc-pickRow', key: candidate.id },
                      h('input', {
                        type: 'checkbox',
                        checked: picker.selected.has(candidate.id),
                        onChange: (event) => {
                          setPicker((current) => {
                            if (current === undefined) return current
                            const selected = new Set(current.selected)
                            if (event.target.checked) selected.add(candidate.id)
                            else selected.delete(candidate.id)
                            return { ...current, selected }
                          })
                        },
                      }),
                      h('span', { className: 'sc-pickName' }, candidate.name),
                      h('code', { className: 'sc-pickId' }, candidate.id),
                    )),
                ),
                h(
                  'div',
                  { className: 'sc-modalFoot' },
                  h('button', {
                    type: 'button',
                    className: 'sc-secondaryButton',
                    onClick: () => setPicker(undefined),
                  }, t('cancel')),
                  h('button', {
                    type: 'button',
                    className: 'sc-secondaryButton',
                    disabled: busy || picker.selected.size === 0,
                    onClick: () => { void adopt() },
                  }, t('pickAdd')),
                ),
              ),
            ),
          ),
      )
    }

    /** One channel row plus its inline sign-in panel and editor. */
    function ChannelRow(props) {
      const { channel, t, onChanged } = props
      const [attemptId, setAttemptId] = React.useState(undefined)
      const [attempt, setAttempt] = React.useState(undefined)
      const [answer, setAnswer] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(undefined)
      const [confirming, setConfirming] = React.useState(false)
      const [editing, setEditing] = React.useState(false)

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

      const start = async (newAccount = false) => {
        setError(undefined)
        setAttempt(undefined)
        setBusy(true)
        try {
          const started = await api('/login', { method: 'POST', body: JSON.stringify({ channel: channel.id, newAccount }) })
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
          setEditing(false)
          await onChanged()
        } catch (failure) {
          setError(friendlyError(failure.message ?? failure, t))
        } finally {
          setBusy(false)
        }
      }

      const promptMessage = attempt !== undefined && attempt.prompt !== undefined ? attempt.prompt.message : undefined
      React.useEffect(() => { setAnswer('') }, [promptMessage])

      const respond = async () => {
        if (attemptId === undefined || answer.trim().length === 0) return
        try {
          await api('/answer', { method: 'POST', body: JSON.stringify({ id: attemptId, value: answer }) })
        } catch (failure) {
          setError(friendlyError(failure.message ?? failure, t))
        }
      }

      const running = attemptId !== undefined
      const prompt = attempt !== undefined && attempt.status === 'pending' ? attempt.prompt : undefined
      const notices = attempt !== undefined && Array.isArray(attempt.notices) ? attempt.notices : []
      const signedIn = channel.linked === true && channel.status !== 'expired'
      const expired = channel.status === 'expired'
      const status = expired ? t('expired') : signedIn ? t('linked') : t('notLinked')

      return h(
        'li',
        { className: 'sc-card' },
        h(
          'div',
          { className: 'sc-rowHead' },
          h(
            'span',
            { className: 'sc-rowIdentity' },
            h('span', { className: 'sc-rowName' }, channel.name),
            channel.linked === true
              ? h('span', {
                className: expired ? 'sc-dot sc-dotMissing' : 'sc-dot',
                role: 'img',
                'aria-label': status,
                title: status,
              })
              : null,
            h(
              'span',
              { className: signedIn ? 'sc-accountStatus sc-accountStatusOn' : 'sc-accountStatus' },
              status,
              signedIn && channel.account ? ` · ${channel.account}` : '',
            ),
          ),
          h(
            'span',
            { className: 'sc-rowActions' },
            running
              ? h('button', { type: 'button', className: 'sc-secondaryButton', onClick: () => { void cancel() } }, t('cancel'))
              : null,
            !running && channel.linked !== true
              ? h('button', { type: 'button', className: 'sc-secondaryButton', disabled: busy, onClick: () => { void start() } }, t('login'))
              : null,
            !running && channel.linked === true
              ? h('button', {
                type: 'button',
                className: 'sc-secondaryButton',
                'aria-expanded': editing,
                disabled: busy,
                onClick: () => setEditing(value => !value),
              }, t('edit'))
              : null,
            !running && channel.linked === true && channel.id === 'chatgpt'
              ? h('button', {
                type: 'button',
                className: 'sc-secondaryButton',
                disabled: busy,
                onClick: () => { void start(true) },
              }, t('addAccount'))
              : null,
            !running && channel.linked === true
              ? h(
                'button',
                {
                  type: 'button',
                  className: 'sc-dangerButton',
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
        error === undefined
          ? null
          : h(
            'p',
            { className: 'sc-error', role: 'alert' },
            `${t('failed')}: ${friendlyError(error, t)}`,
            h('button', {
              type: 'button',
              className: 'sc-linkButton',
              onClick: () => { setError(undefined); void start() },
            }, t('retry')),
          ),
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
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void respond()
                    }
                  },
                }),
                h('button', {
                  type: 'button',
                  className: 'sc-secondaryButton',
                  disabled: answer.trim().length === 0,
                  onClick: () => { void respond() },
                }, t('submit')),
              )
              : null,
          )
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
            h('button', {
              type: 'button',
              className: 'sc-linkButton',
              onClick: () => { setAttempt(undefined); void start() },
            }, t('retry')),
          )
          : null,
        editing && channel.accounts !== undefined && channel.accounts.length > 0
          ? h(AccountSection, { channel, t, onChanged: () => { void onChanged() } })
          : null,
        editing && channel.linked === true
          ? h(CatalogPanel, { channel, t, onSaved: () => { void onChanged() } })
          : null,
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
            { className: 'sc-body' },
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
.sc-body { display: flex; flex-direction: column; gap: 8px; }
.sc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.sc-card {
  display: flex; flex-direction: column; gap: 12px;
  padding: 12px 14px;
  border: 0.5px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l1));
  background: var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-2));
  border-radius: var(--dsw-radius-xl, 16px);
}
.sc-rowHead { display: flex; align-items: center; gap: 10px; }
.sc-rowIdentity { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.sc-rowName { font-size: 14px; line-height: 22px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.sc-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); }
.sc-dotMissing { background: var(--dsw-alias-state-error-primary); }
.sc-accountStatus { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.sc-accountStatusOn { color: var(--dsw-alias-state-success-primary); }
.sc-rowActions { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; }
.sc-secondaryButton,
.sc-dangerButton {
  box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center;
  height: 28px; padding: 0 10px; border-radius: var(--dsw-radius-sm, 8px);
  font: inherit; font-size: 12px; line-height: 18px; background: transparent; cursor: pointer;
}
.sc-secondaryButton { border: 0.5px solid var(--dsw-alias-border-l3, var(--dsw-alias-border-l2)); color: var(--dsw-alias-label-primary); }
.sc-secondaryButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); }
.sc-dangerButton { border: none; color: var(--dsw-alias-state-error-primary); }
.sc-dangerButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger, var(--dsw-alias-bg-layer-2)); }
.sc-secondaryButton:disabled,
.sc-dangerButton:disabled { opacity: 0.5; cursor: default; }
.sc-secondaryButton:focus-visible,
.sc-dangerButton:focus-visible,
.sc-iconButton:focus-visible,
.sc-linkButton:focus-visible,
.sc-addModelButton:focus-visible {
  outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary));
}
.sc-input {
  box-sizing: border-box; width: 100%; height: 32px; padding: 0 10px;
  border: 0.5px solid var(--dsw-alias-border-l4, var(--dsw-alias-border-l2));
  border-radius: var(--dsw-radius-md, 10px);
  font: inherit; font-size: 14px; line-height: 22px;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
}
.sc-input:focus { outline: none; border-color: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); }
.sc-input:disabled { opacity: 0.6; cursor: default; }
.sc-input::placeholder { color: var(--dsw-alias-label-secondary); }
.sc-select {
  appearance: none; padding-right: 32px; cursor: pointer; max-width: 240px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 12px center; background-size: 12px 12px;
}
.sc-mono { font-family: var(--ds-font-family-code, ui-monospace, monospace); font-size: 13px; }
.sc-modelCatalog { display: flex; flex-direction: column; gap: 10px; padding-top: 12px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
.sc-modelListHead { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.sc-modelCatalogHeading { display: flex; flex-direction: column; gap: 2px; }
.sc-modelCatalogTitle { font-size: 12px; line-height: 18px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
    .sc-accountPicker { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
    .sc-accountRow { display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 10px; border: 0.5px solid var(--dsw-alias-border-l4, var(--dsw-alias-border-l1)); border-radius: var(--dsw-radius-md, 8px); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .sc-accountRow[data-selected='true'] { border-color: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); }
    .sc-accountRow:disabled { opacity: 0.55; cursor: default; }
    .sc-accountEmail { font-size: 13px; line-height: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sc-accountMeta { margin-left: auto; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-secondary); }
.sc-modelCatalogMeta { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); opacity: 0.75; }
.sc-headLinks { display: inline-flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: flex-end; }
.sc-modelList { display: flex; flex-direction: column; gap: 8px; }
.sc-modelEntry { position: relative; border: 0.5px solid var(--dsw-alias-border-l4, var(--dsw-alias-border-l1)); border-radius: var(--dsw-radius-lg, 12px); padding: 6px; }
.sc-modelEntryOver { border-color: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); }
.sc-modelRow { display: grid; grid-template-columns: auto minmax(0, 1.4fr) minmax(0, 1fr) auto auto; align-items: center; gap: 6px; }
.sc-modelAdvanced { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 2px 4px; }
.sc-modelField { display: flex; flex-direction: column; min-width: 0; gap: 4px; }
.sc-modelFieldLabel { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.sc-modelInputTypes { grid-column: 1 / -1; min-width: 0; margin: 0; padding: 0; border: none; }
.sc-modelInputTypes legend { padding: 0; margin-bottom: 4px; }
.sc-modelInputChoices { display: flex; flex-wrap: wrap; gap: 16px; min-height: 32px; align-items: center; }
.sc-choice { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--dsw-alias-label-primary); }
.sc-choice input { width: 14px; height: 14px; margin: 0; accent-color: var(--dsw-alias-brand-primary); }
.sc-modelReasoning { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.sc-modelReasoningHead { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sc-modelReasoningRow { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; align-items: center; gap: 6px; }
.sc-switch {
  box-sizing: border-box; position: relative; flex: none; width: 32px; height: 18px; padding: 0;
  border: none; border-radius: 999px; cursor: pointer;
  background: var(--dsw-alias-border-l3, var(--dsw-alias-border-l2));
  transition: background 120ms ease;
}
.sc-switch[aria-checked='true'] { background: var(--dsw-alias-brand-primary); }
.sc-switch:disabled { opacity: 0.5; cursor: default; }
.sc-switchKnob {
  position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%;
  background: var(--dsw-alias-bg-base); transition: transform 120ms ease;
}
.sc-switch[aria-checked='true'] .sc-switchKnob { transform: translateX(14px); }
.sc-iconButton {
  box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0; border: none; border-radius: var(--dsw-radius-sm, 8px);
  background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer;
}
.sc-iconButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); color: var(--dsw-alias-label-primary); }
.sc-iconButtonDanger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger, var(--dsw-alias-bg-layer-2)); color: var(--dsw-alias-state-error-primary); }
.sc-iconButton:disabled { opacity: 0.4; cursor: default; }
.sc-dragHandle { cursor: grab; }
.sc-addModelButton {
  box-sizing: border-box; align-self: flex-start; display: inline-flex; align-items: center; gap: 4px;
  height: 28px; padding: 0 10px; border: 0.5px solid var(--dsw-alias-border-l3, var(--dsw-alias-border-l2));
  border-radius: var(--dsw-radius-sm, 8px); background: transparent;
  color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 18px; cursor: pointer;
}
.sc-addModelButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); }
.sc-addModelButton:disabled { opacity: 0.5; cursor: default; }
.sc-linkButton {
  padding: 0; height: auto; cursor: pointer; font: inherit; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-brand-primary); background: none; border: none;
}
.sc-linkButton:disabled { opacity: 0.5; cursor: default; }
.sc-linkButton:hover:not(:disabled) { text-decoration: underline; }
.sc-modelAddRow { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) auto auto; gap: 6px; }
.sc-modelTest { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sc-probe { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.sc-probeOk { color: var(--dsw-alias-state-success-primary); }
.sc-probeFail { color: var(--dsw-alias-state-error-primary); }
.sc-panel { display: flex; flex-direction: column; gap: 8px; }
.sc-note { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.sc-error { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary); overflow-wrap: anywhere; }
.sc-ok { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-success-primary); }
.sc-code { margin-left: 6px; padding: 1px 6px; border-radius: 4px; font-size: 12px; background: var(--dsw-alias-bg-base); border: 0.5px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); }
.sc-link { margin-left: 8px; font-size: 12px; color: var(--dsw-alias-brand-primary); }
.sc-prompt { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; width: 100%; }
.sc-prompt .sc-input { max-width: 480px; }
.sc-modalBackdrop {
  position: fixed; inset: 0; z-index: 1200; display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.45); padding: 24px;
}
.sc-modal {
  box-sizing: border-box; width: min(520px, 100%); max-height: min(70vh, 640px);
  display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-2));
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-xl, 16px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
}
.sc-modalHead {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 16px; border-bottom: 0.5px solid var(--dsw-alias-border-l1);
}
.sc-modalTitle { font-size: 14px; line-height: 22px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.sc-modalBody { display: flex; flex-direction: column; gap: 2px; padding: 10px 16px; overflow: auto; }
.sc-modalFoot {
  display: flex; align-items: center; justify-content: flex-end; gap: 8px;
  padding: 12px 16px; border-top: 0.5px solid var(--dsw-alias-border-l1);
}
.sc-pickRow {
  display: flex; align-items: center; gap: 10px; padding: 6px 4px;
  border-radius: var(--dsw-radius-sm, 8px); cursor: pointer;
}
.sc-pickRow:hover { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-1)); }
.sc-pickRow input { width: 14px; height: 14px; margin: 0; accent-color: var(--dsw-alias-brand-primary); }
.sc-pickName { flex: 1 1 auto; font-size: 13px; color: var(--dsw-alias-label-primary); }
.sc-pickId { font-family: var(--ds-font-family-code, ui-monospace, monospace); font-size: 11px; color: var(--dsw-alias-label-secondary); }
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






