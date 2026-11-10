/**
 * dsh-screen-switcher — Client half.
 *
 * Ctrl+Tab walks a most-recently-visited list of places: conversation
 * sessions, top-level pages (the Plugins page and friends) and Settings
 * sections. The list stays on screen while Ctrl is held; releasing Ctrl goes
 * to the highlighted place, Esc cancels, and the list only ever contains
 * places the user actually visited.
 *
 * The list is derived from the Client services the app already publishes:
 * `ctx.sessions.list` (which Session the main view retains), `ctx.layout`
 * (which global panel is selected) and the `sidebar.settings` slot store
 * (whether Settings is open and on which section). Restoring a place uses the
 * same facades: `ctx.uiWorkspace.openSession`, `ctx.layout.selectPanel` and
 * the Settings slot stores' own actions. No React internals, no Harness
 * Client packages.
 */
window.__ModuleLoader__.load({
  id: 'dsh-screen-switcher',
  factory(require) {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement
    const useSyncExternalStore = React.useSyncExternalStore
    const useEffect = React.useEffect
    const useRef = React.useRef

    /** Locale namespace owned by this plugin. */
    const NS = 'screenSwitcher'
    /** Versioned localStorage key; the list survives reloads and restarts. */
    const STORAGE_KEY = 'dsh.screen-switcher.v1'
    /** Style tag id, rewritten in place so a hot reload picks up new CSS. */
    const CSS_TAG = 'dsh-screen-switcher/overlay.css'
    /** Settings shell slot: a single slot whose store owns open/activeId. */
    const SETTINGS_SLOT = 'sidebar.settings'
    /** Sidebar page list: the place to read a page's display label from. */
    const PANEL_LIST_SLOT = 'sidebar.panellist'
    /** Settings navigation entries: the place to read a section's label from. */
    const SECTION_SLOT = 'settings.section'
    /** Top-level panel registry. */
    const MAIN_SLOT = 'main'
    /** The shipped page whose inner state (tab, plugin details) is restorable. */
    const PLUGINS_PANEL = 'plugins'

    const zh = {
      title: '屏幕',
      'hint.tab': '下一个',
      'hint.back': '上一个',
      'hint.esc': '取消',
      'hint.release': '松开 Ctrl 切换',
      empty: '还没有可切换的地方',
      current: '当前',
      'kind.session': '会话',
      'kind.panel': '页面',
      'kind.settings': '设置',
      'settings.all': '设置',
      'session.untitled': '新会话',
      'session.noWorkspace': '无工作目录',
      'status.running': '运行中',
      'status.completed': '有新结果未读',
      'status.approval': '等待批准',
      'status.planReview': '计划待审阅',
      'status.answer': '等待回答',
      'status.idle': '空闲'
    }

    const en = {
      title: 'Screens',
      'hint.tab': 'next',
      'hint.back': 'previous',
      'hint.esc': 'cancel',
      'hint.release': 'release Ctrl to switch',
      empty: 'Nothing else to switch to yet',
      current: 'current',
      'kind.session': 'Session',
      'kind.panel': 'Page',
      'kind.settings': 'Settings',
      'settings.all': 'Settings',
      'session.untitled': 'New session',
      'session.noWorkspace': 'No workspace',
      'status.running': 'Running',
      'status.completed': 'New completion, unread',
      'status.approval': 'Waiting for approval',
      'status.planReview': 'Plan awaiting review',
      'status.answer': 'Waiting for answer',
      'status.idle': 'Idle'
    }

    const ru = {
      title: 'Экраны',
      'hint.tab': 'дальше',
      'hint.back': 'назад',
      'hint.esc': 'отмена',
      'hint.release': 'отпустите Ctrl — перейти',
      empty: 'Пока некуда переключаться',
      current: 'сейчас',
      'kind.session': 'Сессия',
      'kind.panel': 'Страница',
      'kind.settings': 'Настройки',
      'settings.all': 'Настройки',
      'session.untitled': 'Новая сессия',
      'session.noWorkspace': 'Без рабочей папки',
      'status.running': 'Выполняется',
      'status.completed': 'Новый результат, не прочитан',
      'status.approval': 'Ждёт подтверждения',
      'status.planReview': 'План ждёт проверки',
      'status.answer': 'Ждёт ответа',
      'status.idle': 'Без активности'
    }

    /** Dictionaries beyond the zh/en baseline; registered only when the Host ships that language. */
    const EXTRA_DICTS = { ru }

    const CSS = [
      '.dss_root{position:fixed;inset:0;z-index:3000;display:flex;align-items:center;justify-content:center;padding:48px;',
      'background:rgba(15,17,21,.28);',
      'background:color-mix(in srgb,var(--dsw-alias-bg-mask-1,rgba(15,17,21,.32)) 75%,transparent);color:var(--dsw-alias-label-primary);',
      'font-family:inherit;-webkit-font-smoothing:antialiased}',
      '.dss_card{display:flex;flex-direction:column;gap:4px;width:min(560px,100%);max-height:min(64vh,560px);user-select:none;',
      'padding:10px;border-radius:var(--dsw-radius-panel,16px);background:var(--dsw-alias-bg-layer-2,#fff);',
      'border:.5px solid var(--dsw-alias-border-l3,rgba(0,0,0,.08));box-shadow:var(--dsw-elevation-prominent,0 18px 48px rgba(0,0,0,.22));',
      'overflow:hidden;animation:dss_in .12s ease-out}',
      '@keyframes dss_in{from{transform:scale(.985);opacity:.5}to{transform:scale(1);opacity:1}}',
      '@media (prefers-reduced-motion:reduce){.dss_card{animation:none}}',
      '.dss_head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:4px 8px 2px}',
      '.dss_title{font-size:13px;font-weight:600;letter-spacing:.01em}',
      '.dss_position{font-size:12px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
      '.dss_list{display:flex;flex-direction:column;gap:2px;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:2px;',
      'scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-thumb,transparent) transparent}',
      '.dss_row{display:flex;align-items:center;gap:10px;width:100%;min-height:44px;padding:7px 10px;',
      'border:1px solid transparent;border-radius:10px;background:transparent;color:inherit;font:inherit;',
      'text-align:left;cursor:pointer}',
      '.dss_row:focus{outline:none}',
      '.dss_row[data-selected=true]{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));',
      'border-color:var(--dsw-alias-state-business-primary,#2f6fed)}',
      '.dss_row[data-current=true] .dss_name{font-weight:600}',
      '.dss_icon{flex:none;display:flex;align-items:center;justify-content:center;width:28px;height:28px;',
      'border-radius:8px;background:var(--dsw-alias-bg-layer-3,rgba(0,0,0,.04));color:var(--dsw-alias-label-secondary)}',
      '.dss_row[data-selected=true] .dss_icon{color:var(--dsw-alias-label-primary)}',
      '.dss_text{display:flex;flex-direction:column;flex:1;min-width:0}',
      '.dss_name,.dss_meta{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.dss_name{font-size:13.5px;line-height:18px}',
      '.dss_meta{font-size:11.5px;line-height:15px;color:var(--dsw-alias-label-tertiary)}',
      '.dss_status{position:relative;flex:none;display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;',
      'color:var(--dsw-alias-state-idle-primary,#a0a4ab)}',
      '.dss_status:after{content:"";position:absolute;inset:20%;border-radius:50%;background:currentColor}',
      '.dss_status[data-state=done]{color:var(--dsw-alias-state-success-primary,#2ea043)}',
      '.dss_status[data-state=warning]{color:var(--dsw-alias-state-warn-primary,#d29922)}',
      '.dss_status[data-state=ongoing]{color:var(--dsw-alias-label-tertiary,#9aa0a6)}',
      '.dss_status[data-state=ongoing]:after{content:none}',
      '.dss_spin{width:12px;height:12px;overflow:visible;animation:dss_rotate 1.5s linear infinite}',
      '.dss_spinTrack,.dss_spinArc{fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round}',
      '.dss_spinTrack{opacity:.25}',
      '.dss_spinArc{stroke-dasharray:12 150;animation:dss_dash 1.5s ease-in-out infinite}',
      '@keyframes dss_rotate{to{transform:rotate(360deg)}}',
      '@keyframes dss_dash{0%{stroke-dasharray:1 150;stroke-dashoffset:0}50%{stroke-dasharray:90 150;stroke-dashoffset:-35}',
      '100%{stroke-dasharray:90 150;stroke-dashoffset:-124}}',
      '@media (prefers-reduced-motion:reduce){.dss_spin,.dss_spinArc{animation:none}}',
      '.dss_badge{flex:none;padding:1px 7px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l3,rgba(0,0,0,.1));',
      'color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:16px}',
      '.dss_empty{padding:18px 10px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:13px}',
      '.dss_foot{display:flex;align-items:center;gap:6px;margin-top:2px;padding:6px 8px 2px;',
      'border-top:.5px solid var(--dsw-alias-border-l3,rgba(0,0,0,.08));color:var(--dsw-alias-label-tertiary);font-size:11.5px}',
      '.dss_kbd{padding:0 5px;border-radius:5px;border:.5px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));',
      'background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-secondary);',
      'font-family:inherit;font-size:10.5px;line-height:16px}',
      '.dss_sep{opacity:.5}',
      '.dss_spacer{flex:1}'
    ].join('')

    /**
     * Rewrite the plugin stylesheet in place.
     *
     * The Host reloads one Client module in a live document, so an early
     * "already injected" return would freeze the page on the first version.
     * @param doc - the document to style.
     */
    function ensureStyles(doc) {
      const selector = 'style[data-plugin-css="' + CSS_TAG + '"]'
      const existing = doc.querySelector(selector)
      if (existing !== null) {
        if (existing.textContent !== CSS) existing.textContent = CSS
        return
      }
      const tag = doc.createElement('style')
      tag.dataset.plugin = 'dsh-screen-switcher'
      tag.dataset.pluginCss = CSS_TAG
      tag.textContent = CSS
      doc.head.appendChild(tag)
    }

    /** Resolve a slot label that may be a string, a thunk or a localized record. */
    function resolveLabel(label) {
      try {
        if (typeof label === 'function') {
          const value = label()
          return typeof value === 'string' ? value : ''
        }
        if (typeof label === 'string') return label
        if (label !== null && typeof label === 'object' && typeof label.text === 'string') return label.text
      } catch (_error) {
        return ''
      }
      return ''
    }

    /** Basename of a directory path, whichever separator it uses. */
    function baseName(path) {
      if (typeof path !== 'string' || path === '') return ''
      const parts = path.split(/[\\/]+/).filter(Boolean)
      return parts.length === 0 ? path : parts[parts.length - 1]
    }

    /** Stable history key: places differing only by inner state count as different places. */
    function keyOf(screen) {
      if (screen === null || typeof screen !== 'object') return ''
      if (screen.kind === 'session') return 'session:' + screen.sessionId
      if (screen.kind === 'panel') {
        const view = screen.state !== undefined ? screen.state.view : undefined
        if (view === undefined) return 'panel:' + screen.panelId
        return 'panel:' + screen.panelId + '#' + String(view.kind ?? '') + (view.name === undefined ? '' : ':' + view.name)
      }
      if (screen.kind === 'settings') return 'settings:' + (screen.sectionId === null ? '' : String(screen.sectionId))
      return ''
    }

    /** Front-move `screen`, keeping one entry per key. The list is uncapped; dead places are pruned. */
    function mergeScreen(list, screen) {
      const key = keyOf(screen)
      const rest = list.filter((item) => keyOf(item) !== key)
      return [screen, ...rest]
    }

    /** Wrap an index into a non-empty list. */
    function stepIndex(index, length, step) {
      if (length <= 0) return 0
      return ((index + step) % length + length) % length
    }

    /** Narrow an untyped persisted value into a place descriptor. */
    function isScreen(value) {
      if (value === null || typeof value !== 'object') return false
      if (value.kind === 'session') return typeof value.sessionId === 'string' && value.sessionId !== ''
      if (value.kind === 'panel') return typeof value.panelId === 'string' && value.panelId !== ''
      if (value.kind === 'settings') return value.sectionId === null || typeof value.sectionId === 'string'
      return false
    }

    /** Keep only the plugin-page view shapes the page itself publishes. */
    function sanitizeView(view) {
      if (view === null || typeof view !== 'object') return undefined
      const kind = view.kind
      if (kind === 'list' || kind === 'more') return { kind }
      if (kind === 'package' && typeof view.name === 'string' && view.name !== '') {
        return {
          kind: 'package',
          name: view.name,
          ...(typeof view.returnTab === 'string' ? { returnTab: view.returnTab } : {}),
          ...(view.from === 'more' ? { from: 'more' } : {})
        }
      }
      return undefined
    }

    /** Persisted places for the next boot. */
    function readHistory() {
      try {
        const raw = globalThis.localStorage.getItem(STORAGE_KEY)
        if (raw === null) return []
        const parsed = JSON.parse(raw)
        const screens = Array.isArray(parsed) ? parsed : parsed?.screens
        if (!Array.isArray(screens)) return []
        return screens.filter(isScreen)
      } catch (_error) {
        return []
      }
    }

    function writeHistory(screens) {
      try {
        globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, screens }))
      } catch (_error) {
        /* private mode or a full quota: the list still works for this run */
      }
    }

    /** Minimal external store: immutable snapshots, synchronous listeners. */
    function createStore(initial) {
      let snapshot = Object.freeze(initial)
      const listeners = new Set()
      return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        set: (patch) => {
          snapshot = Object.freeze({ ...snapshot, ...patch })
          for (const listener of [...listeners]) listener()
        }
      }
    }

    /** One glyph per place kind; strokes inherit the row color. */
    function icon(kind) {
      const common = {
        width: 17,
        height: 17,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true'
      }
      if (kind === 'settings') {
        return h(
          'svg',
          common,
          h('path', { d: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3', key: 'a' }),
          h('path', { d: 'M1 14h6M9 8h6M17 16h6', key: 'b', strokeWidth: 1.5 })
        )
      }
      if (kind === 'panel') {
        return h(
          'svg',
          common,
          h('rect', { x: 3, y: 3, width: 7.5, height: 7.5, rx: 1.6, key: 'a' }),
          h('rect', { x: 13.5, y: 3, width: 7.5, height: 7.5, rx: 1.6, key: 'b' }),
          h('rect', { x: 3, y: 13.5, width: 7.5, height: 7.5, rx: 1.6, key: 'c' }),
          h('rect', { x: 13.5, y: 13.5, width: 7.5, height: 7.5, rx: 1.6, key: 'd' })
        )
      }
      return h(
        'svg',
        common,
        h('path', {
          d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
          key: 'a'
        })
      )
    }

    function keycap(text) {
      return h('kbd', { className: 'dss_kbd' }, text)
    }

    /**
     * Render the switcher while it is open.
     * @param props - overlay store, translation and live description helpers.
     * @returns the portal or null while closed.
     */
    function ScreenSwitcherOverlay(props) {
      const state = useSyncExternalStore(props.overlay.subscribe, props.overlay.getSnapshot)
      useSyncExternalStore(props.subscribeLocale, props.getLocaleRevision)
      const rowsRef = useRef([])
      rowsRef.current = []

      useEffect(() => {
        if (!state.open) return
        const row = rowsRef.current[state.index]
        if (row !== undefined && row !== null && typeof row.scrollIntoView === 'function') {
          row.scrollIntoView({ block: 'nearest' })
        }
      }, [state.open, state.index])

      if (!state.open) return null
      const t = props.translate
      const screens = state.screens
      const rows = screens.map((screen, index) => {
        const info = props.describe(screen)
        return h(
          'button',
          {
            type: 'button',
            role: 'option',
            key: keyOf(screen) + ':' + String(index),
            className: 'dss_row',
            'data-selected': index === state.index ? 'true' : 'false',
            'data-current': index === 0 ? 'true' : 'false',
            'aria-selected': index === state.index ? 'true' : 'false',
            ref: (element) => {
              rowsRef.current[index] = element
            },
            onPointerMove: () => {
              if (index !== state.index) props.select(index)
            },
            onClick: () => props.commitScreen(screen)
          },
          h('span', { className: 'dss_icon' }, icon(info.icon)),
          h(
            'span',
            { className: 'dss_text' },
            h('span', { className: 'dss_name' }, info.title),
            h('span', { className: 'dss_meta' }, info.meta)
          ),
          info.status === undefined
            ? null
            : h(
                'span',
                {
                  className: 'dss_status',
                  'data-state': info.status.state,
                  title: info.status.label,
                  'aria-label': info.status.label,
                  role: 'img'
                },
                info.status.state === 'ongoing'
                  ? h(
                      'svg',
                      { className: 'dss_spin', viewBox: '0 0 24 24', 'aria-hidden': 'true' },
                      h('circle', { className: 'dss_spinTrack', cx: 12, cy: 12, r: 9.5 }),
                      h('circle', { className: 'dss_spinArc', cx: 12, cy: 12, r: 9.5 })
                    )
                  : null
              ),
          index === 0 ? h('span', { className: 'dss_badge' }, t('current')) : null
        )
      })

      return ReactDOM.createPortal(
        h(
          'div',
          {
            className: 'dss_root',
            role: 'dialog',
            'aria-modal': 'false',
            'aria-label': t('title'),
            onPointerDown: (event) => event.stopPropagation(),
            onMouseDown: (event) => event.stopPropagation(),
            onClick: (event) => {
              if (event.target === event.currentTarget) props.cancel()
            }
          },
          h(
            'div',
            { className: 'dss_card' },
            h(
              'div',
              { className: 'dss_head' },
              h('span', { className: 'dss_title' }, t('title')),
              h('span', { className: 'dss_position' }, String(state.index + 1) + ' / ' + String(Math.max(1, screens.length)))
            ),
            screens.length === 0
              ? h('div', { className: 'dss_empty' }, t('empty'))
              : h('div', { className: 'dss_list', role: 'listbox' }, rows),
            h(
              'div',
              { className: 'dss_foot' },
              keycap('Tab'),
              h('span', null, t('hint.tab')),
              h('span', { className: 'dss_sep' }, '·'),
              keycap('Shift', t),
              keycap('Tab'),
              h('span', null, t('hint.back')),
              h('span', { className: 'dss_sep' }, '·'),
              keycap('Esc'),
              h('span', null, t('hint.esc')),
              h('span', { className: 'dss_spacer' }),
              h('span', null, t('hint.release'))
            )
          )
        ),
        document.body
      )
    }

    /**
     * Mount the switcher.
     * @param ctx - the Client plugin context.
     */
    function apply(ctx) {
      ensureStyles(document)

      const locale = ctx.locale
      ctx.effect(() => locale.register(NS, { zh, en }), 'screen-switcher: dictionaries (zh, en)')
      const hostLanguages = new Set(
        (locale.getSnapshot().locales ?? []).map((language) => String(language.id ?? '').toLowerCase())
      )
      for (const [id, dictionary] of Object.entries(EXTRA_DICTS)) {
        if (!hostLanguages.has(id)) continue
        ctx.effect(() => locale.register(NS, id, dictionary), 'screen-switcher: dictionary (' + id + ')')
      }
      const boundTranslate = locale.bind(NS)
      const translate = (key, params) => boundTranslate(key, params)

      const overlay = createStore({ open: false, index: 0, screens: [] })
      let history = readHistory()
      /** Navigation sets its own places; ignore the echo the observers produce. */
      let suppressUntil = 0
      /** Cached Settings shell / Plugins page handles, rebound when their slots change. */
      let settingsBinding = null
      let panelBinding = null
      let domProbeAt = 0
      let domProbeOpen = false

      const entriesOf = (name) => {
        try {
          const entries = ctx.slots.entriesOfSlot?.(name)
          return Array.isArray(entries) ? entries : []
        } catch (_error) {
          return []
        }
      }

      /** Instantiate a slot's store handle; only registrations that memoize the instance are used. */
      const instanceOf = (entry) => {
        const store = entry?.store
        if (store === null || typeof store !== 'object' || typeof store.create !== 'function') return null
        try {
          const instance = store.create()
          return instance !== null && typeof instance === 'object' ? instance : null
        } catch (_error) {
          return null
        }
      }

      const subscribeInstance = (instance, onChange) => {
        if (typeof instance?.subscribe !== 'function') return null
        try {
          const off = instance.subscribe(onChange)
          return typeof off === 'function' ? off : null
        } catch (_error) {
          return null
        }
      }

      function bindSettings() {
        if (settingsBinding !== null) {
          settingsBinding.off?.()
          settingsBinding = null
        }
        const instance = instanceOf(entriesOf(SETTINGS_SLOT)[0])
        if (instance === null) return
        settingsBinding = { instance, off: subscribeInstance(instance, () => recordCurrent()) }
      }

      function bindPanel() {
        if (panelBinding !== null) {
          panelBinding.off?.()
          panelBinding = null
        }
        const entry = entriesOf(MAIN_SLOT).find((candidate) => {
          const options = candidate?.options
          return options !== undefined && (options.key === PLUGINS_PANEL || options.id === PLUGINS_PANEL)
        })
        const instance = instanceOf(entry)
        if (instance === null) return
        panelBinding = { instance, off: subscribeInstance(instance, () => recordCurrent()) }
      }

      /** Settings open state, read from its own store with a throttled DOM fallback. */
      function settingsSnapshot() {
        const instance = settingsBinding?.instance
        if (instance !== null && instance !== undefined) {
          try {
            const snapshot = instance.getSnapshot()
            if (snapshot !== null && typeof snapshot === 'object') {
              return { open: snapshot.open === true, activeId: snapshot.activeId ?? null }
            }
          } catch (_error) {
            /* the slot was torn down mid-read: fall through to the DOM probe */
          }
        }
        if (Date.now() - domProbeAt > 750) {
          domProbeAt = Date.now()
          domProbeOpen = document.querySelector('[data-shortcut-modal="settings"]') !== null
        }
        return { open: domProbeOpen, activeId: null }
      }

      function settingsDialog() {
        return document.querySelector('[role="dialog"][data-shortcut-modal="settings"]')
      }

      function currentSessionId() {
        const list = ctx.sessions?.list?.getSnapshot?.()
        if (list?.byId === undefined || list.byId === null) return null
        const ids = Array.isArray(list.ids) ? list.ids : Object.keys(list.byId)
        for (const id of ids) {
          const row = list.byId[id]
          if (row !== undefined && (row.retainedBy?.mainView ?? 0) > 0) return id
        }
        for (const id of Object.keys(list.byId)) {
          const row = list.byId[id]
          if (row !== undefined && (row.retainedBy?.mainView ?? 0) > 0) return row.id ?? id
        }
        return null
      }

      function activePanelId() {
        try {
          return ctx.layout?.panelInfo?.getSnapshot?.()?.activePanelId ?? null
        } catch (_error) {
          return null
        }
      }

      /** Where the user is now, or null while the app still has nothing to show. */
      function currentScreen() {
        const settings = settingsSnapshot()
        if (settings.open) return { kind: 'settings', sectionId: settings.activeId }
        const panelId = activePanelId()
        if (panelId !== null) {
          const screen = { kind: 'panel', panelId }
          if (panelId === PLUGINS_PANEL) {
            let state = null
            try {
              state = panelBinding?.instance?.getSnapshot?.() ?? null
            } catch (_error) {
              state = null
            }
            const view = sanitizeView(state?.view)
            const tab = typeof state?.tab === 'string' ? state.tab : undefined
            if (view !== undefined || tab !== undefined) {
              screen.state = { ...(view === undefined ? {} : { view }), ...(tab === undefined ? {} : { tab }) }
            }
          }
          return screen
        }
        const sessionId = currentSessionId()
        return sessionId === null ? null : { kind: 'session', sessionId }
      }

      function persist() {
        writeHistory(history)
      }

      /** Places that still exist: a deleted or archived Session, a withdrawn page or Settings section is gone. */
      function livePlaces() {
        const list = ctx.sessions?.list?.getSnapshot?.()
        const sessionsReady = list?.phase === 'ready' && list?.byId !== undefined && list.byId !== null
        let archived = null
        try {
          const archivedIds = ctx.get?.('workspaces')?.list?.getSnapshot?.()?.archivedSessionIds
          if (Array.isArray(archivedIds)) archived = new Set(archivedIds)
        } catch (_error) {
          archived = null
        }
        const panelIds = new Set(
          entriesOf(MAIN_SLOT)
            .map((entry) => entry?.options?.key ?? entry?.options?.id)
            .filter((id) => typeof id === 'string')
        )
        const sectionIds = new Set(
          entriesOf(SECTION_SLOT)
            .map((entry) => entry?.options?.id)
            .filter((id) => typeof id === 'string')
        )
        return history.filter((screen) => {
          if (screen.kind === 'session') {
            if (!sessionsReady) return true
            if (list.byId[screen.sessionId] === undefined) return false
            return archived === null || !archived.has(screen.sessionId)
          }
          if (screen.kind === 'panel') return panelIds.size === 0 || panelIds.has(screen.panelId)
          if (screen.kind === 'settings') {
            return screen.sectionId === null || sectionIds.size === 0 || sectionIds.has(screen.sectionId)
          }
          return false
        })
      }

      function refreshOpenList() {
        const state = overlay.getSnapshot()
        const screens = livePlaces()
        const index = Math.min(state.index, Math.max(0, screens.length - 1))
        overlay.set({ screens, index })
      }

      /** Drop dead places from the stored list, not only from the open overlay. */
      function pruneHistory() {
        const live = livePlaces()
        if (live.length === history.length) return
        history = live
        persist()
        if (overlay.getSnapshot().open) refreshOpenList()
      }

      function recordCurrent(force) {
        pruneHistory()
        if (!force && Date.now() < suppressUntil) return
        const screen = currentScreen()
        if (screen === null) return
        const previous = history[0]
        if (previous !== undefined && keyOf(previous) === keyOf(screen)) {
          if (JSON.stringify(previous) !== JSON.stringify(screen)) {
            history = mergeScreen(history, screen)
            persist()
            if (overlay.getSnapshot().open) refreshOpenList()
          }
          return
        }
        history = mergeScreen(history, screen)
        persist()
        if (overlay.getSnapshot().open) refreshOpenList()
      }

      function panelLabel(panelId) {
        const entry = entriesOf(PANEL_LIST_SLOT).find((candidate) => candidate?.options?.id === panelId)
        const label = resolveLabel(entry?.options?.label)
        if (label !== '') return label
        const main = entriesOf(MAIN_SLOT).find((candidate) => {
          const options = candidate?.options
          return options !== undefined && (options.key === panelId || options.id === panelId)
        })
        return resolveLabel(main?.options?.label) || panelId
      }

      function sectionLabel(sectionId) {
        if (sectionId === null || sectionId === undefined) return ''
        const entry = entriesOf(SECTION_SLOT).find((candidate) => candidate?.options?.id === sectionId)
        return resolveLabel(entry?.options?.label)
      }

      /** Sidebar status of one Session: pending interaction, live run, unread completion, then idle. */
      function statusOf(sessionId) {
        let status
        try {
          status = ctx.get?.('uiSession')?.sessionStatus?.getSnapshot?.()?.get?.(sessionId)
        } catch (_error) {
          status = undefined
        }
        if (status === undefined || status === null) return { state: 'idle', label: translate('status.idle') }
        const pending = status.pendingInteraction
        if (pending !== undefined && pending !== null) {
          const kind = pending.kind
          const key = kind === 'approval' ? 'status.approval' : kind === 'plan-review' ? 'status.planReview' : 'status.answer'
          return { state: 'warning', label: translate(key) }
        }
        if (status.running === true) return { state: 'ongoing', label: translate('status.running') }
        if (status.completionUnread === true) return { state: 'done', label: translate('status.completed') }
        return { state: 'idle', label: translate('status.idle') }
      }

      function describe(screen) {
        if (screen.kind === 'session') {
          const list = ctx.sessions?.list?.getSnapshot?.()
          const row = list?.byId?.[screen.sessionId]
          const title = String(row?.displayTitle ?? row?.title ?? '').trim()
          const workspace = baseName(row?.cwd)
          return {
            icon: 'session',
            title: title === '' ? translate('session.untitled') : title,
            meta: workspace === '' ? translate('session.noWorkspace') : workspace,
            status: statusOf(screen.sessionId)
          }
        }
        if (screen.kind === 'panel') {
          const label = panelLabel(screen.panelId)
          const view = screen.state?.view
          if (view?.kind === 'package' && typeof view.name === 'string') {
            return { icon: 'panel', title: view.name, meta: label }
          }
          return { icon: 'panel', title: label, meta: translate('kind.panel') }
        }
        if (screen.kind === 'settings') {
          const label = sectionLabel(screen.sectionId)
          return {
            icon: 'settings',
            title: label === '' ? translate('settings.all') : label,
            meta: translate('kind.settings')
          }
        }
        return { icon: 'session', title: '', meta: '' }
      }

      function closeSettings() {
        const instance = settingsBinding?.instance
        try {
          if (instance !== null && instance !== undefined && instance.getSnapshot().open === true) {
            instance.actions.close()
            return
          }
        } catch (_error) {
          /* fall through to the DOM path */
        }
        const dialog = settingsDialog()
        const overlayElement = dialog?.parentElement
        const mask = overlayElement?.querySelector('[aria-hidden="true"]')
        if (mask !== null && mask !== undefined && typeof mask.click === 'function') mask.click()
      }

      function settingsLauncher() {
        const buttons = [...document.querySelectorAll('button[aria-haspopup="dialog"]')]
        const byShortcut = buttons.find((button) =>
          String(button.getAttribute('aria-keyshortcuts') ?? '').includes('Comma')
        )
        if (byShortcut !== undefined) return byShortcut
        let label = ''
        try {
          label = String(locale.bind('settings')('trigger') ?? '')
        } catch (_error) {
          label = ''
        }
        if (label === '') return null
        return buttons.find((button) => button.getAttribute('aria-label') === label) ?? null
      }

      function openSettings(sectionId) {
        const instance = settingsBinding?.instance
        try {
          if (instance !== null && instance !== undefined && instance.actions !== undefined) {
            if (typeof sectionId === 'string' && sectionId !== '' && typeof instance.actions.openSection === 'function') {
              instance.actions.openSection(sectionId)
            } else if (typeof instance.actions.open === 'function') {
              instance.actions.open()
            }
            return
          }
        } catch (error) {
          console.warn('screen-switcher: Settings store refused navigation', error)
        }
        const launcher = settingsLauncher()
        if (launcher !== null) {
          launcher.click()
          return
        }
        console.warn('screen-switcher: Settings cannot be reopened in this composition')
      }

      function restorePanelState(state) {
        const instance = panelBinding?.instance
        if (instance === null || instance === undefined || instance.actions === undefined) return
        try {
          if (typeof state.tab === 'string' && typeof instance.actions.setTab === 'function') {
            instance.actions.setTab(state.tab)
          }
          if (state.view !== undefined && typeof instance.actions.setView === 'function') {
            instance.actions.setView(state.view)
          }
        } catch (error) {
          console.warn('screen-switcher: page state could not be restored', error)
        }
      }

      /**
       * The Plugins page renders a card or a detail for every package it knows.
       * Once its list has settled, a package name it no longer shows is a dead place:
       * forget it and leave the page on its list instead of an empty detail.
       */
      function verifyPluginPlace(screen) {
        if (screen.kind !== 'panel' || screen.panelId !== PLUGINS_PANEL) return
        const view = screen.state?.view
        if (view?.kind !== 'package' || typeof view.name !== 'string' || view.name === '') return
        const name = view.name
        const startedAt = Date.now()
        const stillOn = () => {
          const instance = panelBinding?.instance
          if (instance === null || instance === undefined) return false
          try {
            const snapshot = instance.getSnapshot()
            return snapshot?.view?.kind === 'package' && snapshot.view.name === name
          } catch (_error) {
            return false
          }
        }
        const nodes = () => {
          try {
            return Array.from(document.querySelectorAll('[data-plugin-detail],[data-plugin-package]'))
          } catch (_error) {
            return []
          }
        }
        const forget = () => {
          const next = history.filter((item) => keyOf(item) !== keyOf(screen))
          if (next.length !== history.length) {
            history = next
            persist()
            if (overlay.getSnapshot().open) refreshOpenList()
          }
          try {
            const instance = panelBinding?.instance
            if (instance?.actions?.setView !== undefined && instance.getSnapshot()?.view?.kind === 'package') {
              instance.actions.setView({ kind: 'list' })
            }
          } catch (_error) {
            /* the page owns its own recovery */
          }
        }
        const tick = () => {
          if (!stillOn()) return
          const found = nodes()
          if (found.some((node) => node?.getAttribute?.('data-plugin-detail') === name)) return
          if (found.some((node) => node?.getAttribute?.('data-plugin-package') === name)) return
          if (found.some((node) => node?.hasAttribute?.('data-plugin-package') === true)) {
            forget()
            return
          }
          if (Date.now() - startedAt < 6000) window.setTimeout(tick, 120)
        }
        window.setTimeout(tick, 60)
      }

      function navigateTo(screen) {
        suppressUntil = Date.now() + 1500
        history = mergeScreen(history, screen)
        persist()
        try {
          if (screen.kind === 'settings') {
            openSettings(screen.sectionId)
          } else {
            closeSettings()
            if (screen.kind === 'panel') {
              ctx.layout.selectPanel(screen.panelId)
              if (screen.panelId === PLUGINS_PANEL && screen.state !== undefined) {
                restorePanelState(screen.state)
                verifyPluginPlace(screen)
              }
            } else if (screen.kind === 'session') {
              ctx.layout.selectPanel(null)
              const workspace = ctx.uiWorkspace
              if (workspace !== undefined && typeof workspace.openSession === 'function') {
                workspace.openSession(screen.sessionId)
              } else {
                console.warn('screen-switcher: uiWorkspace is not available, cannot open a Session')
              }
            }
          }
        } catch (error) {
          console.warn('screen-switcher: navigation failed', error)
        }
        window.setTimeout(() => {
          suppressUntil = 0
          recordCurrent(true)
        }, 1200)
      }

      function openOverlay(step) {
        recordCurrent()
        const screens = livePlaces()
        const index = screens.length <= 1 ? 0 : step < 0 ? screens.length - 1 : 1
        overlay.set({ open: true, index, screens })
      }

      function cycle(step) {
        const state = overlay.getSnapshot()
        if (!state.open) {
          openOverlay(step)
          return
        }
        if (state.screens.length <= 1) return
        overlay.set({ index: stepIndex(state.index, state.screens.length, step) })
      }

      function closeOverlay() {
        overlay.set({ open: false, index: 0 })
      }

      function commitScreen(screen) {
        const here = currentScreen()
        closeOverlay()
        if (screen === undefined || (here !== null && keyOf(here) === keyOf(screen))) {
          recordCurrent()
          return
        }
        navigateTo(screen)
      }

      function commit(index) {
        commitScreen(overlay.getSnapshot().screens[index])
      }

      function blockedTarget(target) {
        const element = target instanceof Element ? target : null
        if (element !== null && element.closest('.xterm') !== null) return true
        return document.querySelector('[data-shortcut-modal="shortcut-edit"]') !== null
      }

      function onKeyDown(event) {
        if (event.defaultPrevented === true || event.isComposing === true) return
        if (event.key === 'Tab' && event.ctrlKey && !event.metaKey && !event.altKey) {
          if (blockedTarget(event.target)) return
          event.preventDefault()
          event.stopPropagation()
          if (event.repeat) return
          cycle(event.shiftKey ? -1 : 1)
          return
        }
        const state = overlay.getSnapshot()
        if (!state.open) return
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          closeOverlay()
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          event.stopPropagation()
          commit(state.index)
          return
        }
        if (event.key === 'Tab') {
          event.preventDefault()
          event.stopPropagation()
          cycle(event.shiftKey ? -1 : 1)
          return
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          event.stopPropagation()
          cycle(1)
          return
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          event.stopPropagation()
          cycle(-1)
        }
      }

      function onKeyUp(event) {
        if (event.key !== 'Control') return
        const state = overlay.getSnapshot()
        if (state.open) commit(state.index)
      }

      function onWindowBlur() {
        if (overlay.getSnapshot().open) closeOverlay()
      }

      function onVisibilityChange() {
        if (document.visibilityState === 'hidden' && overlay.getSnapshot().open) closeOverlay()
      }

      ctx.effect(() => {
        bindSettings()
        bindPanel()
        const offSettingsSlot = ctx.slots.subscribe(SETTINGS_SLOT, () => {
          bindSettings()
          recordCurrent()
        })
        const offMainSlot = ctx.slots.subscribe(MAIN_SLOT, () => {
          bindPanel()
          recordCurrent()
        })
        const offSessions = ctx.sessions.list.subscribe(() => recordCurrent())
        const offPanelInfo = ctx.layout?.panelInfo?.subscribe?.(() => recordCurrent())
        recordCurrent(true)
        return () => {
          offSettingsSlot?.()
          offMainSlot?.()
          offSessions?.()
          offPanelInfo?.()
          settingsBinding?.off?.()
          panelBinding?.off?.()
          settingsBinding = null
          panelBinding = null
        }
      }, 'screen-switcher: visited places')

      ctx.effect(() => {
        window.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('keyup', onKeyUp, true)
        window.addEventListener('blur', onWindowBlur)
        document.addEventListener('visibilitychange', onVisibilityChange)
        return () => {
          window.removeEventListener('keydown', onKeyDown, true)
          window.removeEventListener('keyup', onKeyUp, true)
          window.removeEventListener('blur', onWindowBlur)
          document.removeEventListener('visibilitychange', onVisibilityChange)
        }
      }, 'screen-switcher: Ctrl+Tab input')

      const overlayProps = Object.freeze({
        overlay,
        translate,
        describe,
        commitScreen,
        cancel: closeOverlay,
        select: (index) => overlay.set({ index }),
        subscribeLocale: (listener) => locale.subscribe(listener),
        getLocaleRevision: () => locale.getSnapshot().revision
      })

      ctx.effect(
        () =>
          ctx.slots.inject('shell.overlay', () =>
            ctx.slots.register(
              {
                name: 'shell.overlay',
                id: 'screen-switcher',
                order: 40,
                locale: NS,
                inject: () => overlayProps
              },
              ScreenSwitcherOverlay
            )
          ),
        'screen-switcher: overlay'
      )
    }

    exports.inject = ['slots', 'locale', 'sessions', 'layout', 'uiWorkspace']
    exports.apply = apply
    return module.exports
  }
})
