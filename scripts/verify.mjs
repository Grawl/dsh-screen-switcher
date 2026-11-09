/**
 * Headless check for the Client half.
 *
 * Loads client.js the way web boot does, mounts it against fake Client
 * services and drives the keyboard: places land in the visited list, Tab walks
 * them, releasing Ctrl commits, Esc cancels, and Settings / the Plugins page
 * come back through their own store actions. Run with `pnpm verify` (or
 * `node scripts/verify.mjs`); the browser is still the authority on how it
 * looks.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

/* ---------- timing ---------- */

const realNow = Date.now
let fakeNow = 0
Date.now = () => fakeNow
const timers = []
let timerSeq = 0

function advance(ms) {
  fakeNow += ms
  for (const timer of [...timers]) {
    if (timer.at <= fakeNow) {
      timers.splice(timers.indexOf(timer), 1)
      timer.run()
    }
  }
}

/* ---------- fake React ---------- */

const fakeReact = {
  createElement(tag, props, ...children) {
    return {
      tag,
      props: props ?? {},
      children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false)
    }
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    return getSnapshot()
  },
  useEffect() {},
  useRef(initial) {
    return { current: initial }
  }
}

const fakeReactDom = {
  createPortal(node, target) {
    return { portal: node, target }
  }
}

/* ---------- DOM ---------- */

const styleTags = []
const fakeDocument = {
  visibilityState: 'visible',
  head: {
    appendChild(node) {
      styleTags.push(node)
    }
  },
  body: {},
  querySelector() {
    return null
  },
  querySelectorAll() {
    return []
  },
  createElement(tag) {
    return { tag, dataset: {}, textContent: '', appendChild() {} }
  },
  addEventListener() {},
  removeEventListener() {}
}

class FakeElement {}

/* ---------- window ---------- */

const handlers = new Map()

const localStorage = (() => {
  const values = new Map()
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  }
})()

let captured
const fakeWindow = {
  __ModuleLoader__: {
    load(definition) {
      captured = definition
    }
  },
  addEventListener(type, fn) {
    if (!handlers.has(type)) handlers.set(type, new Set())
    handlers.get(type).add(fn)
  },
  removeEventListener(type, fn) {
    handlers.get(type)?.delete(fn)
  },
  setTimeout(fn, ms) {
    timerSeq += 1
    timers.push({ id: timerSeq, at: fakeNow + (ms ?? 0), run: fn })
    return timerSeq
  },
  clearTimeout(id) {
    const index = timers.findIndex((timer) => timer.id === id)
    if (index >= 0) timers.splice(index, 1)
  }
}

globalThis.localStorage = localStorage
globalThis.Element = FakeElement

const source = readFileSync(join(root, 'client.js'), 'utf8')
// eslint-disable-next-line no-new-func
new Function('window', 'document', 'Element', source)(fakeWindow, fakeDocument, FakeElement)

assert.ok(captured, 'client module registered itself with window.__ModuleLoader__')
assert.equal(captured.id, 'dsh-screen-switcher')

/* ---------- fake Client services ---------- */

function memoryStore(initial) {
  let value = initial
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next) {
      value = next
      for (const listener of [...listeners]) listener()
    }
  }
}

const sessions = memoryStore({
  phase: 'ready',
  ids: ['s1', 's2'],
  byId: {
    s1: { id: 's1', displayTitle: 'Alpha', cwd: '/work/alpha', retainedBy: { mainView: 1 } },
    s2: { id: 's2', displayTitle: 'Beta', cwd: '/work/beta', retainedBy: {} }
  }
})

const panelInfo = memoryStore({ activePanelId: null })
const calls = { openSession: [], selectPanel: [], openSection: [], close: 0, setView: [] }

const settingsState = { open: false, activeId: undefined }
const settingsListeners = new Set()
const notifySettings = () => {
  for (const listener of [...settingsListeners]) listener()
}
const settingsInstance = {
  getSnapshot: () => settingsState,
  subscribe(listener) {
    settingsListeners.add(listener)
    return () => settingsListeners.delete(listener)
  },
  actions: {
    open() {
      settingsState.open = true
      notifySettings()
    },
    close() {
      calls.close += 1
      settingsState.open = false
      settingsState.activeId = undefined
      notifySettings()
    },
    select(id) {
      settingsState.activeId = id
      notifySettings()
    },
    openSection(id) {
      calls.openSection.push(id)
      settingsState.activeId = id
      settingsState.open = true
      notifySettings()
    }
  }
}

const pluginState = { view: { kind: 'list' }, tab: 'installed' }
const pluginListeners = new Set()
const notifyPlugin = () => {
  for (const listener of [...pluginListeners]) listener()
}
const pluginInstance = {
  getSnapshot: () => pluginState,
  subscribe(listener) {
    pluginListeners.add(listener)
    return () => pluginListeners.delete(listener)
  },
  actions: {
    setView(view) {
      calls.setView.push(view)
      pluginState.view = view
      notifyPlugin()
    },
    setTab(tab) {
      pluginState.tab = tab
      notifyPlugin()
    }
  }
}

const slotEntries = new Map([
  ['sidebar.settings', [{ store: { create: () => settingsInstance } }]],
  [
    'main',
    [
      { options: { key: 'conversation' } },
      { options: { key: 'plugins' }, store: { create: () => pluginInstance } }
    ]
  ],
  ['sidebar.panellist', [{ options: { id: 'plugins', label: () => 'Plugins' } }]],
  [
    'settings.section',
    [
      { options: { id: 'general', label: () => 'General' } },
      { options: { id: 'plugins', label: () => 'Plugins' } }
    ]
  ]
])

const registrations = []
const disposers = []

const slots = {
  entriesOfSlot(name) {
    return slotEntries.get(name) ?? []
  },
  subscribe() {
    return () => {}
  },
  inject(_owner, callback) {
    return callback()
  },
  register(options, component) {
    registrations.push({ options, component })
    return () => {}
  }
}

const layout = {
  panelInfo,
  selectPanel(id) {
    calls.selectPanel.push(id)
    panelInfo.set({ activePanelId: id })
  },
  beginNavigation() {
    return new AbortController().signal
  }
}

const uiWorkspace = {
  openSession(id) {
    calls.openSession.push(id)
    const list = sessions.getSnapshot()
    const byId = {}
    for (const key of Object.keys(list.byId)) {
      byId[key] = { ...list.byId[key], retainedBy: key === id ? { mainView: 1 } : {} }
    }
    sessions.set({ ...list, byId })
  }
}

const localeValues = new Map([
  ['title', 'Screens'],
  ['current', 'current'],
  ['empty', 'Nothing else to switch to yet'],
  ['kind.session', 'Session'],
  ['kind.panel', 'Page'],
  ['kind.settings', 'Settings'],
  ['settings.all', 'Settings'],
  ['session.untitled', 'New session'],
  ['session.noWorkspace', 'No workspace'],
  ['hint.tab', 'next'],
  ['hint.back', 'previous'],
  ['hint.esc', 'cancel'],
  ['hint.release', 'release Ctrl to switch']
])

const locale = {
  register() {},
  bind: () => (key) => localeValues.get(key) ?? key,
  getSnapshot: () => ({ locales: [{ id: 'en' }, { id: 'ru' }, { id: 'zh' }], revision: 0 }),
  subscribe: () => () => {},
  getLocale: () => ({ active: 'en' })
}

const sessionsService = { list: sessions }
const services = { slots, locale, sessions: sessionsService, layout, uiWorkspace }
const ctx = {
  slots,
  locale,
  sessions: sessionsService,
  layout,
  uiWorkspace,
  get(name) {
    return services[name]
  },
  effect(callback) {
    const disposer = callback()
    if (typeof disposer === 'function') disposers.push(disposer)
    return disposer
  }
}

const plugin = captured.factory((id) => {
  if (id === 'react') return fakeReact
  if (id === 'react-dom') return fakeReactDom
  throw new Error('unexpected module: ' + id)
})

assert.deepEqual(plugin.inject, ['slots', 'locale', 'sessions', 'layout', 'uiWorkspace'])
assert.equal(typeof plugin.apply, 'function')

plugin.apply(ctx)

/* ---------- helpers ---------- */

function fireKey(type, patch) {
  const event = {
    key: '',
    code: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    target: null,
    preventDefault() {
      this.defaultPrevented = true
    },
    stopPropagation() {},
    ...patch
  }
  for (const handler of [...(handlers.get(type) ?? [])]) handler(event)
  return event
}

const ctrlTab = (patch = {}) => fireKey('keydown', { key: 'Tab', code: 'Tab', ctrlKey: true, ...patch })
const releaseCtrl = () => fireKey('keyup', { key: 'Control' })

function overlayEntry() {
  return registrations.find((entry) => entry.options.name === 'shell.overlay')
}

function props() {
  return overlayEntry().options.inject()
}

function snapshot() {
  return props().overlay.getSnapshot()
}

function collectRows(node, rows = []) {
  if (node === null || node === undefined || typeof node !== 'object') return rows
  if (node.props?.className === 'dss_row') rows.push(node)
  for (const child of node.children ?? []) collectRows(child, rows)
  if (node.portal !== undefined) collectRows(node.portal, rows)
  return rows
}

function rows() {
  const entry = overlayEntry()
  const tree = entry.component(props())
  return tree === null ? [] : collectRows(tree)
}

function textOf(node) {
  if (typeof node === 'string') return node
  if (node === null || node === undefined || typeof node !== 'object') return ''
  return (node.children ?? []).map(textOf).join('')
}

const rowNames = () => rows().map((row) => textOf(row.children[1].children[0]))
const rowMetas = () => rows().map((row) => textOf(row.children[1].children[1]))

function keyOfScreen(screen) {
  if (screen.kind === 'session') return 'session:' + screen.sessionId
  if (screen.kind === 'panel') {
    const view = screen.state?.view
    if (view === undefined) return 'panel:' + screen.panelId
    return 'panel:' + screen.panelId + '#' + String(view.kind ?? '') + (view.name === undefined ? '' : ':' + view.name)
  }
  if (screen.kind === 'settings') return 'settings:' + (screen.sectionId === null ? '' : String(screen.sectionId))
  return ''
}

function openOn(index) {
  ctrlTab()
  let guard = 0
  while (snapshot().index !== index && guard < 40) {
    fireKey('keydown', { key: 'Tab', code: 'Tab', ctrlKey: true })
    guard += 1
  }
  assert.equal(snapshot().index, index, 'reached the expected place')
}

/* ---------- checks ---------- */

assert.equal(styleTags.length, 1, 'stylesheet injected once')
assert.equal(overlayEntry()?.options.id, 'screen-switcher')
assert.equal(overlayEntry().component(props()), null, 'overlay renders nothing while closed')

// The first place is the Session the main view retains.
ctrlTab()
assert.equal(snapshot().open, true)
assert.deepEqual(rowNames(), ['Alpha'])

// Release Ctrl on the current place: nothing moves.
releaseCtrl()
assert.equal(snapshot().open, false)
assert.deepEqual(calls.openSession, [])

// Visiting another Session moves it to the front.
sessions.set({
  ...sessions.getSnapshot(),
  byId: {
    s1: { ...sessions.getSnapshot().byId.s1, retainedBy: {} },
    s2: { ...sessions.getSnapshot().byId.s2, retainedBy: { mainView: 1 } }
  }
})

ctrlTab()
assert.equal(snapshot().index, 1)
assert.deepEqual(rowNames(), ['Beta', 'Alpha'])
assert.equal(rows()[1].props['data-selected'], 'true')
assert.equal(rows()[0].props['data-current'], 'true')

// Every row carries a real SVG glyph; a bare <path> would paint nothing.
const glyphs = rows().map((row) => row.children[0].children[0])
assert.equal(glyphs.length, 2)
for (const glyph of glyphs) {
  assert.equal(glyph.tag, 'svg', 'row icon is an <svg> element')
  assert.ok(glyph.children.length > 0, 'row icon has geometry')
  assert.equal(glyph.props.width, 17)
  assert.equal(glyph.props.viewBox, '0 0 24 24')
}

// Tab keeps walking, Shift+Tab walks back, and the list wraps.
fireKey('keydown', { key: 'Tab', ctrlKey: true })
assert.equal(snapshot().index, 0)
fireKey('keydown', { key: 'Tab', ctrlKey: true, shiftKey: true })
assert.equal(snapshot().index, 1)

// Releasing Ctrl commits the highlighted place.
releaseCtrl()
assert.deepEqual(calls.openSession, ['s1'])
assert.equal(snapshot().open, false)
advance(1500)

// Settings is a place of its own.
settingsInstance.actions.openSection('plugins')
openOn(1)
assert.deepEqual(rowNames(), ['Plugins', 'Alpha', 'Beta'])
assert.equal(rowMetas()[0], 'Settings')

// Committing the Session closes Settings and opens that Session.
releaseCtrl()
assert.equal(settingsState.open, false)
assert.equal(calls.close, 1)
assert.deepEqual(calls.openSession, ['s1', 's1'])
advance(1500)

// Going back to Settings reopens the same section through its store.
ctrlTab()
const settingsIndex = snapshot().screens.findIndex((screen) => keyOfScreen(screen) === 'settings:plugins')
assert.ok(settingsIndex >= 1, 'the visited Settings section stayed in the list')
while (snapshot().index !== settingsIndex) fireKey('keydown', { key: 'Tab', code: 'Tab', ctrlKey: true })
releaseCtrl()
assert.equal(settingsState.open, true)
assert.equal(settingsState.activeId, 'plugins')
advance(1500)

// Leave Settings by hand, then browse to a plugin's page.
settingsInstance.actions.close()
layout.selectPanel('plugins')
pluginInstance.actions.setView({ kind: 'package', name: 'dsh-select-quote' })
layout.selectPanel(null)
uiWorkspace.openSession('s1')
advance(50)

// The Plugins page remembers which plugin was open.
ctrlTab()
assert.deepEqual(rowNames()[1], 'dsh-select-quote')
assert.equal(rowMetas()[1], 'Plugins')
releaseCtrl()
assert.equal(calls.selectPanel.at(-1), 'plugins')
assert.equal(pluginState.view.kind, 'package')
assert.equal(pluginState.view.name, 'dsh-select-quote')
advance(1500)

// Clicking a row commits that row's place.
ctrlTab()
const clickedScreen = snapshot().screens[1]
const sessionsBefore = calls.openSession.length
rows()[1].props.onClick()
assert.equal(snapshot().open, false)
if (clickedScreen.kind === 'session') assert.equal(calls.openSession.length, sessionsBefore + 1)
else assert.deepEqual(calls.selectPanel.at(-1), clickedScreen.panelId)
advance(1500)

// Esc cancels without moving.
ctrlTab()
const openedBefore = calls.openSession.length
fireKey('keydown', { key: 'Escape' })
assert.equal(snapshot().open, false)
assert.equal(calls.openSession.length, openedBefore)

// The visited list survives a reload.
const stored = JSON.parse(localStorage.getItem('dsh.screen-switcher.v1'))
assert.equal(stored.v, 1)
assert.ok(stored.screens.some((screen) => keyOfScreen(screen) === 'panel:plugins#package:dsh-select-quote'))
assert.ok(stored.screens.some((screen) => keyOfScreen(screen) === 'settings:plugins'))

console.log('screen-switcher: visited list, Ctrl+Tab cycling, Settings and Plugins navigation verified headlessly')
console.log('screen-switcher: visual check still needs the running app')

Date.now = realNow
