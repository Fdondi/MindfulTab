# MindfulTab

MindfulTab is a browser companion to MindfulHome: timer-first, soft nudges, no hard blocks.

This extension overrides the New Tab page with a phone-like timer screen, then adds:

- soft nudge notification when timer ends
- domain karma scoring based on overrun behavior
- graduated hiding of frequent-site shortcuts
- reflection gate for low-karma domains that always allows "continue anyway"

## Browser support

- Microsoft Edge (Chromium-based)
- Firefox (WebExtensions)

One codebase is used for both browsers.

## Compatibility notes

- Uses standard WebExtensions APIs (`storage`, `tabs`, `alarms`, `notifications`, `runtime` messaging).
- Uses `chrome_url_overrides.newtab` for New Tab replacement.
- Includes `browser_specific_settings.gecko` for Firefox packaging identity.
- Uses `browser`/`chrome` fallback (`const EXT_API = typeof browser !== "undefined" ? browser : chrome`) so the same scripts run on both browsers.

## Current architecture

- `manifest.json`: extension definition, permissions, cross-browser keys
- `src/background.js`: timer lifecycle, alarms, domain tracking, karma updates, reflection-gate routing
- `src/newtab/newtab.html`: New Tab UI
- `src/newtab/newtab.css`: phone-like visual style
- `src/newtab/newtab.js`: New Tab interactions, status rendering, shortcut hiding
- `src/shared/storage.js`: storage helpers and keys
- `src/shared/karma.js`: karma scoring helpers
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

## Behavior notes

- MindfulTab does not force-close tabs or hard block navigation.
- Reflection gate is short friction only, then it relents.
- Karma is domain-based and persisted in extension local storage.
