# Tab Tier — Store Asset Generator

Generates Chrome Web Store screenshots and promo banners in three locales (EN / TR / ES) without you touching a screenshot tool. Loads the real (unpacked) extension into Chromium, injects realistic demo data into `chrome.storage.local`, then captures every public page at every accepted Web Store size.

## What it produces

For each locale (`en`, `tr`, `es`), in `../store-assets/{locale}/`:

| Folder       | What's inside                                                                                                  |
|--------------|----------------------------------------------------------------------------------------------------------------|
| `1280x800/`  | Five primary screenshots — `01-popup.png`, `02-tab-management.png`, `03-settings.png`, `04-help.png`, `05-whatsnew.png` |
| `640x400/`   | The same five, downscaled (alternate size the Web Store also accepts)                                          |
| `440x280/`   | `promo-tile.png` — small promotional tile (popup over gradient + title + tagline)                              |
| `1400x560/`  | `marquee.png` — wide marquee promo banner (popup beside title + tagline)                                       |

The popup is overlaid on a soft gradient canvas (no fake browser frame) since it's smaller than the canvas. Tab Management / Settings / Help / What's New are full-page renders at 1280×800.

## Setup (once)

You need Node.js (≥ 18) and ~250 MB of disk for Chromium.

```bash
cd tools
npm install
npx playwright install chromium
```

## Run

```bash
cd tools
npm run screenshots
```

A Chromium window will pop up briefly while screenshots are taken (extensions don't always load in headless mode reliably, so we run with `headless: false`). After it closes, results are in `../store-assets/`.

Re-run any time after a UI change — the script overwrites the previous output.

## Customising

Edit constants at the top of `screenshots.js`:

- `LOCALES` — add/remove languages (must match a folder under `_locales/`).
- `DEMO_RECORDS` — the fake `tabRecords` injected before screenshots. Tune titles/URLs to taste.
- `DEMO_SETTINGS` — extension settings used during capture.
- `PROMO[lang]` — title and tagline text on the promo banners.
- `PAGES` — which pages to capture and at what viewport.
- `GRADIENT` — the two colours used for popup canvas + promo backdrops.

## Uploading

Chrome Web Store does not auto-localise screenshots — you upload one set per locale via the developer dashboard:

1. Go to your item's edit page → *Store listing*.
2. Top-right language switcher → pick a locale.
3. Upload that locale's `1280x800/*.png` (and optionally `640x400/`, the promo tile, and the marquee).
4. Repeat for each locale.

## Troubleshooting

- **"waiting for serviceworker" timeout** — make sure `manifest.json` is at the repo root (one level above `tools/`), and that `EXT_PATH` in the script resolves correctly.
- **Empty Tab Management screenshot** — the demo data injection happened too early. Increase the `waitForTimeout` in `captureLocale` from 800 to ~1500 ms.
- **Sharp install fails on Windows** — Sharp ships prebuilt binaries; if your antivirus blocks them, run `npm install --include=optional sharp` or temporarily disable the AV.
- **Extension didn't open in expected language** — the script writes `settings.uiLanguage` directly, but `chrome.i18n.getUILanguage()` (used by some places) reflects the browser's UI language. The visible page text still localises correctly because `i18n-dom.js` honours `settings.uiLanguage`.
