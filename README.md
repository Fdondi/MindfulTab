# MindfulTab

MindfulTab is a browser companion to MindfulHome: timer-first, soft nudges, no hard blocks.

This extension overrides the New Tab page with a phone-like timer screen, then adds:

- soft nudge notification when timer ends
- domain karma scoring based on overrun behavior
- graduated hiding of frequent-site shortcuts
- reflection gate for low-karma domains that always allows "continue anyway"
- post-start home view with favorites, URL bar, and intent suggestions

## Browser support

- Microsoft Edge (Chromium-based)
- Firefox (WebExtensions)

One codebase is used for both browsers.

## Compatibility notes

- Uses standard WebExtensions APIs (`storage`, `tabs`, `alarms`, `notifications`, `runtime` messaging, `history`).
- Uses `chrome_url_overrides.newtab` for New Tab replacement.
- Includes `browser_specific_settings.gecko` for Firefox packaging identity.
- Uses `browser`/`chrome` fallback (`const EXT_API = typeof browser !== "undefined" ? browser : chrome`) so the same scripts run on both browsers.

## Current architecture

- `manifest.json`: extension definition, permissions, cross-browser keys
- `src/background.js`: timer lifecycle, alarms, domain tracking, karma updates, reflection-gate routing
- `src/newtab/newtab.html`: New Tab UI
- `src/newtab/newtab.css`: phone-like visual style
- `src/newtab/newtab.js`: wheel timer, timer/home state machine, URL bar, suggestions
- `src/shared/storage.js`: storage helpers and keys
- `src/shared/karma.js`: karma scoring helpers
- `src/search/embeddings.js`: local lightweight embedding utilities
- `src/search/index.js`: embedding index build/query and keyword fallback
- `src/gate/gate.html`: reflection prompt page
- `src/gate/gate.js`: continue-anyway flow

## Load unpacked in Edge (Windows)

1. Open `edge://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this project folder (`MindfulTab`)
5. Open a new tab

## Load temporary in Firefox (Fedora/Windows)

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `manifest.json` in this folder
4. Open a new tab

Note: temporary add-ons are removed when Firefox restarts.

## Development

The extension itself runs in the browser, and no host-level SDK is required.

```bash
npm run check:structure
```

Create a zip package (PowerShell):

```bash
npm run build:zip
```

Output: `dist/mindfultab.zip`

## Search and history behavior

- Timer picker is a scroll wheel from `1` to `120` minutes.
- Pressing `Start` switches from timer screen to the home screen.
- Home screen supports:
  - favorites section
  - URL input (direct navigation for URL-like values)
  - intent query search over previously visited links
- History source mode is user-selectable:
  - browser history only
  - extension-collected history only
  - both (default)
- Local embedding index is built from visited links and cached in extension storage.
- Keyword fallback is used if embedding ranking is unavailable.

## Behavior notes

- MindfulTab does not force-close tabs or hard block navigation.
- Reflection gate is short friction only, then it relents.
- Karma is domain-based and persisted in extension local storage.
