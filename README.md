# dsh-screen-switcher

**Ctrl+Tab for DeepSeek Harness, the way Alt+Tab works on the desktop.**

Hold Ctrl and press Tab: an Alt-Tab-style list of every place you have been
appears — sessions, Settings sections, the Plugins page and a plugin's own
page — most recently visited first. Each further Tab moves down the list,
Shift+Tab moves back, and releasing Ctrl goes to the highlighted place. Esc
cancels. A single Ctrl+Tab-and-release returns to the previous session.

## What makes it different

The community catalog already has session cyclers and tab bars. This plugin is
the one that shows the list **while Ctrl is held** — nothing switches until you
release, and Esc leaves you exactly where you were. Places are more than
sessions: a Settings section and a plugin's page are places of their own, and
returning to them restores that section and that plugin card. No new chrome,
no extra windows — one chord, one overlay.

## What counts as a place

| Place | How it is read | How it is restored |
|---|---|---|
| Session | the Session the main view retains (`ctx.sessions.list`) | `ctx.uiWorkspace.openSession()` |
| Page | the selected global panel (`ctx.layout.panelInfo`) | `ctx.layout.selectPanel()` |
| Plugin page | the Plugins page's own store (`view`, `tab`) | that store's `setView`/`setTab` |
| Settings | the Settings shell store (`open`, `activeId`) | its `open()`/`openSection()` |

Visited places persist in `localStorage` under `dsh.screen-switcher.v1`, so the
switcher still knows your recent screens after a reload or restart. Sessions
that no longer exist and pages that are no longer registered are dropped when
the list opens.

## Install

Install the directory as a bundle in the current profile — from the Plugin
Manager, or with the CLI for a published copy:

```bash
dsh plugin --profile "$DSH_PROFILE" add dsh-screen-switcher
```

Restart the app once after installing a new package; Client code changes made
to an already installed copy hot-reload.

## Behaviour details

- Ctrl+Tab and Ctrl+Shift+Tab are handled in the page and take priority over
  editors and dialogs, except inside a terminal pane and while a shortcut is
  being recorded.
- The list is a shell overlay portalled to `document.body`, so it stays on top
  of the Settings dialog — the place you are leaving is still visible behind it.
- Clicking a row switches to it; clicking outside cancels.
- Switching to a Session closes Settings first and clears the selected page.
- A failed navigation (deleted Session, withdrawn page) leaves the list intact
  and logs one warning; the next open shows where you actually are.

## Limits

- Browsers reserve Ctrl+Tab for their own tabs, so the web build only works in
  the desktop app or in a browser where that shortcut can be delivered to the
  page.
- Screen history stops at the global page level; the right sidebar (files,
  terminal, browser) is not part of the list.
- Settings sub-tabs whose state lives inside a section component (for example
  the read-only inventory tabs under Built-in plugins) are restored to the
  section, not to the exact tab.

## Development

```bash
node scripts/verify.mjs   # headless: fake Client services, real key events
```

`scripts/verify.mjs` loads `client.js` through the same `window.__ModuleLoader__`
facade the app uses, then drives Ctrl+Tab against fake services: visited order,
cycling, commit/cancel, Settings reopen, plugin page restore and persistence.
It does not check pixels; the running app is the authority on how the overlay
looks.

No build step: `client.js` is the browser artifact, written against the module
table the app provides (`react`, `react-dom`).

## License

MIT
