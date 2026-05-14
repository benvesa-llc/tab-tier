# Changelog

All notable changes to Tab Tier will be documented in this file.

> **Format rule:** One entry per day. Heading is the date with the highest version released on that day in brackets. Changes are grouped under the three category headings — `### Added`, `### Changed`, `### Fixed` — and only the categories with items are shown. Newest dates on top.

## [1.13.8] - 2026-05-13

### Fixed
- Bar-chart labels no longer shift left when a row's favicon is missing or fails to load. Each `barLabelInner` now emits a fixed-size 14×14 `.bar-favicon-slot` wrapper around the (optional) `<img>`; the slot reserves the space whether or not the icon is present, so domain/URL text stays vertically aligned across every row. Previously rows without a favicon rendered no `<img>` at all (no space reserved), and rows where `hideBrokenFavicons` set `display: none` on a broken image had the same problem

### Added
- Persistent `domainFavicons` storage cache. A dedicated `tabs.onUpdated` listener saves any `(domain → favIconUrl)` pair it observes, with debounced writes (500ms) so a burst of icon updates collapses to a single `chrome.storage.local.set`. Tab Management's `rebuildFaviconMaps` now reads this cache as a second-pass fallback after the live `tabRecords`, so a domain that survives only in `statsAggregate` (its tabs all closed long ago) still renders with the correct favicon instead of needing Chrome's built-in favicon API every time
- Donut and Active/Archived ratio cards now vertically center their content inside the card; the donut SVG also auto-scales to ~35% of the card width (clamp 120–200px). When the grid stretches a narrow card to match its row's tallest sibling, the leftover space is absorbed by the chart instead of leaving a big empty band at the bottom. `.stat-card` becomes a flex column; the chart container after the header takes `flex: 1`, and `.donut-wrap` / `.ratio-grid` use `height: 100%` + center-alignment to fill it

### Changed
- Bar-chart rows whose domain/URL no longer has an active `tabRecords` entry (you closed every tab from that site long ago, but `statsAggregate` still has its focus time / count) now also get a favicon. Stored favicons from `_faviconByDomain` / `_faviconByUrl` are still preferred; when absent, the row falls back to Chrome's **built-in favicon API** (`chrome.runtime.getURL("/_favicon/?pageUrl=…&size=32")`). The new `"favicon"` permission was added to `manifest.json` to enable this. No third-party favicon service is contacted — the icon comes from Chrome's own cache (or a built-in placeholder if the cache has nothing)
- Tab Management opens with the table sorted by **Elapsed ascending** by default (recently-used at the top, oldest at the bottom) instead of by `currentTier`. Initial `sortCol` switched from `"currentTier"` to `"elapsed"`. Clicking another column header still works the same way

### Fixed
- Tabs the user never clicked could oscillate `T1 → T2 → T1 → T2 …` once an hour, each transition logging `tier T1→T2` and then `tier T2→T1` with a fresh `lastFocusEnd`. Root cause: `chrome.tabs.onUpdated` for the group change fired AFTER `sortTabsInWindow.finally` (or `moveTabToTierGroup`'s success path) had already cleared the `extensionMovingTabs` flag, so the handler took the "user drag" branch and reset `lastFocusEnd` to `Date.now()`. Next `timerCheck` saw elapsed < 60 min → demoted back to T1, then the natural inactivity drift promoted to T2 again, and the cycle repeated. Fix: keep a parallel `extensionMovingExpiry` Map alongside the Set; `isExtensionMove(tabId)` returns true while the Set has it OR the per-tab expiry is in the future (3-second grace). `markExtensionMove` adds to both; `clearExtensionMove` removes from the Set only — the expiry naturally times out, so late-firing onUpdated events still recognize the move as the extension's, not as a user drag

### Changed
- Bar-chart label-column resize is now **per-card** instead of global. Dragging the handle in one card (e.g. Top Domains) only adjusts that card's label column; the focus-time and URL-focus-time cards keep their own widths. Storage key renamed from `statsBarLabelWidth` (single number) to `statsBarLabelWidths` (object keyed by card-id), and the CSS variable `--bar-label-width` is now set on each `.stat-card` instead of the parent grid. The "↺ Reset order" button now clears the per-card map and removes the inline CSS variable from every card

### Added
- Each row in **Top Domains**, **Top Domains by Focus Time** and **Top URLs by Focus Time** now shows a 14×14 favicon in front of the label. Favicons come from `tabRecords` (first stored favicon per domain / per normalized URL); no third-party favicon service is contacted, so privacy is preserved. Rows whose record never had a favicon just render text — no broken-image placeholders since `hideBrokenFavicons()` removes failed images after each render. Row height is unaffected: the favicon is 14px and label flex-aligned to center

### Changed
- The resize handle between a bar chart's label column and the bar itself is now visible at rest (a thin 2px gray line, brightens to accent on hover and widens to 3px while dragging). Previously it was transparent and only revealed itself on hover, so the resize feature was hidden — users had to know it existed to find it

### Added
- Each bar-chart row on the Statistics page now shows a **percentage suffix** next to the count or focus-time value (e.g. `1h 30m  25%`, `42  18%`). The percentage is computed against the full set behind the chart, not just the visible top-10 — so a domain that takes 18% of all your focus time still reads 18% even when the bar reflects only the top 10 entries. Subtle gray styling so the primary number stays dominant
- Bar-chart **label column is user-resizable**: a thin drag handle between every row's label and bar lets you widen / narrow the left column with the mouse. Cursor switches to col-resize, the handle highlights in accent, and the new width is saved to `settings.statsBarLabelWidth` (single global value; applies to Top Domains, Top URLs, and the focus-time cards). Default 180px (up from 120px) so URLs fit better out of the box. Clamped to 80-480px. The "↺ Reset order" button now also clears this width along with order + per-card widths
- New i18n key `resizeBarLabelTitle` (drag-handle tooltip) in all five locales
- Statistics cards now have a **per-card width selector** (`¼ ½ ¾ 1`) in their header. Pick how wide each card should be — narrow cards flow side-by-side on the same row, wide cards take the whole row. The grid is a 4-column CSS grid, and each card spans 1–4 columns based on its setting. Defaults: tier-donut and active-ratio start at ½ each (share row), every other card starts at full width. Choices are saved to `settings.statsCardWidths` and applied on each visit. Below 820px viewport every card forces back to full width so things don't get cramped. The "↺ Reset order" button now also clears widths so it's a single "back to defaults" control. New `statsCardWidths` field in `DefaultSettings`
- Statistics cards are now **drag-and-drop reorderable**. Each card has a `⋮⋮` grab handle in its header; grab any card and drop it where you want it. Layout switched from a 2-column responsive grid to a single column so reordering is always unambiguous. A small `↺ Reset order` button at the top right of the Statistics view restores the default sequence. The chosen order is saved to `settings.statsCardOrder` and applied on every visit; new cards added in future releases are appended at the end so they're discoverable. New i18n keys `statsResetOrderBtn` and `dragHandleTitle` in all five locales

### Fixed
- Top Domains (by tab count) card now uses the same "label · track · value" flex layout as the focus-time cards — the numeric count sits to the right of the bar instead of being absolutely positioned over the fill. CSS `.bar-count` switched to `flex: 0 0 auto; min-width: 40px; text-align: right`, matching `.focus-bar-time`. All bar-chart cards (counts and focus-times) now look consistent and never overlap their value labels onto the coloured fill
- Bar tracks gained a little more horizontal room: `.bar-label` flex-basis reduced from `140px` to `120px`, so each bar fill has 20 extra pixels to grow into. Long domain / URL labels still truncate with ellipsis as before
- Focus-time bar charts (Top Domains / Top URLs) had a hard-to-read time label sitting on top of the coloured bar — the `--text` colour clashed with the green/blue fill, especially on the light theme. The label is now a flex sibling **after** the track instead of `position: absolute` over the fill, so it never overlaps the bar regardless of how wide the bar grows. CSS `.focus-bar-time` switched from absolute-positioning to `flex: 0 0 auto; min-width: 64px; text-align: right`
- `fmtFocusMs` (used by both focus-time cards) was hard-coding `h` / `m` / `s` so Turkish, German, French and Spanish all saw English units. It now reads `unitAbbrHour` / `unitAbbrMin` / `unitAbbrSec` from the active locale — Turkish now shows `1s 30d` instead of `1h 30m`, German keeps `1h 30m` (which matches its locale), etc.

## [1.10.0] - 2026-05-13

### Added
- New **Top URLs by Focus Time** card on the Statistics view, alongside the existing Top Domains card. URLs are normalized to `protocol://host/path` (query string and fragment stripped) so paths are differentiated but search queries / hashes don't leak into stats. Bars use the blue accent to distinguish from the green domain bars
- Time-range selector (**All / 7d / 24h**) on both focus-time cards (domain and URL). "All" reads the cumulative all-time map; 7d / 24h sums the per-day buckets within the window. Range buttons are styled as pill segments next to each card heading and re-render the card in-place without re-fetching storage (cached aggregate)
- `statsAggregate` schema bumped to v2: new top-level `urlFocusMs` map, and each daily bucket now also carries `domainFocusMs` and `urlFocusMs` so the time-range filter has per-day granularity. Old buckets are backfilled lazily on first write. `clearStatsAggregate` resets the new keys too
- New i18n keys in all five locales: `statsUrlFocusTimeTitle`, `statsRangeAll`, `statsRange7d`, `statsRange1d`. The existing `statsFocusTimeTitle` lost the trailing "(All Time)" suffix now that a range selector is right next to it

## [1.9.0] - 2026-05-13

### Added
- New Settings option **"Auto-sort tabs by recent use"** (off by default). When on, every `tierCheck` alarm tick (configured by `timerIntervalMinutes`, default 1 minute) the extension re-applies the "Tier + Elapsed" sort to every open browser window — the most recently used tab in each tier stays at the top automatically, no need to click `↕ Apply` from the popup. New `autoSortByElapsed` boolean in `DefaultSettings`, new checkbox in `settings.html` Behavior section, load/save wired through `settings.js`. New `autoSortLabel` + `autoSortHint` i18n keys in all five locales (EN/TR/ES/DE/FR). The auto-sort uses the same `extensionMovingTabs` pre-flag protection added in this release so the elapsed timer is never disturbed by the periodic shuffle

### Fixed
- `↕ Apply to Tabs` (sort) no longer collapses 4-5 sleeping tabs into "T1 with the same just-now timestamp". `sortTabsInWindow` was setting `extensionMovingTabs` only around the T0 group move; the per-tab `chrome.tabs.move` loop ran without it. While a tab transited between two tabs of a different tier-color group, Chrome auto-assigned it to that adjacent group and fired `onUpdated(groupId)`. The handler, seeing no flag, took the **user-drag** branch and reset `lastFocusEnd` to `Date.now()` (and changed `currentTier`) for every affected tab. Fix: pre-add every tab-ID we're about to shuffle to `extensionMovingTabs` BEFORE the first `tabs.move`, wrap the entire move+regroup+internal-group flow in a try/finally, and clear the flags in `finally`. Same physical reorder, but the intermediate group reassignments are correctly recognized as extension moves and the records' inactivity timestamps stay intact
- Popup's "Elapsed" sort now matches what `↕ Apply to Tabs` actually does in the browser. Previously the popup sorted purely by inactivity time across all tiers, but the apply step had to keep each tier contiguous (otherwise Chrome auto-regroups tabs based on physical proximity and the tier groups break). Now both surfaces use the same "tier first, then elapsed inside the tier" order, and the button label is renamed accordingly: `Tier + Elapsed` / `Tier + Geçen Süre` / `Nivel + Transcurrido` / `Stufe + Inaktivität` / `Niveau + Inactivité`. No more surprise reorder after clicking Apply

### Changed
- Tab Management summary tier counts (T0-T3) and the Statistics distribution charts now reflect only the **live** state of the browser — open tabs plus T4 archives. Closed-but-not-T4 records (history-kept tabs) used to inflate the per-tier numbers, which the user reads as "this many tabs are running in T1/T2" and that's not what those records represent any more (since 1.5.5, closed tabs intentionally keep their previous tier). The new layout:
  - **Summary row**: `T1: N` is now the count of tabs that are actually open in the browser AND in T1; same for T2, T3. T4 is unchanged (always archived). A new row `○ Closed: N` (new `sumClosedLabel` i18n key in all five locales — `○ Closed / ○ Kapalı / ○ Cerradas / ○ Geschlossen / ○ Fermés`) tallies records whose tab is no longer in the browser but whose tier history is preserved. The redundant `missingWarning` line is gone (it was bundled into the `⚠️` row before and duplicated the same information)
  - **Statistics → Tier Distribution donut** and **Active vs Archived** now compute over `liveRecords = open tabs + T4 archives`. Closed-but-not-T4 records are excluded — they don't consume browser resources, so showing them in a performance-oriented distribution chart was misleading
  - **Statistics → Longest-Lived Tabs** now only lists open tabs. A closed record isn't "lived" any more
  - **Statistics → Top Domains** still counts every record (open + closed + T4), because per-domain browsing history is meaningful even after the tab is closed

## [1.8.6] - 2026-05-11

### Changed
- Tab Management's "missing" status (shown when a record is kept but the tab isn't open in the browser) is renamed and restyled so it no longer looks like an error. The `statusMissing` i18n string changes from `✗ missing` (red) to `○ closed` (neutral subtext gray), and the per-locale wording follows: TR `○ kapalı`, ES `○ cerrada`, DE `○ geschlossen`, FR `○ fermé`. The empty-circle glyph visually pairs with the existing `● active` filled dot, and the gray colour matches the actual semantic — the record is intentionally preserved (1.5.5 behaviour), not lost. CSS `.status-missing` color switches from `var(--red)` to `var(--subtext)` in `tab-management.html`

## [1.8.5] - 2026-05-10

### Fixed
- Tabs no longer spontaneously jump to T1 with their inactivity counter reset for multi-window users. The 1.8.3 fix only handled `tabs.onReplaced` (Edge sleeping-tab wakes) — but `tabs.onActivated` does NOT fire when the user switches between browser windows without clicking a tab in the new one. The previous window's active tab kept its `lastFocusEnd: null` indefinitely (no event ever flipped it), and on the next service-worker restart `reconcileTabs` would force-promote every such stale-null record to T1 + the IIFE stale-null fix would reset its elapsed counter. Two changes resolve this:
  1. New `chrome.windows.onFocusChanged` listener — when the user switches windows, the previously-focused window's active tab gets its `lastFocusEnd` set to now (focus ended), and the newly-focused window's active tab gets activation effects (`lastFocusEnd = null`, T2/T3 → T1, group move). `WINDOW_ID_NONE` (user clicked desktop / switched apps) just clears `currentActiveTabId`
  2. The startup stale-null cleanup now uses `chrome.windows.getLastFocused()` to identify the single tab that is *truly* active (focused window's selected tab), instead of treating every `chrome.tabs.query({active:true})` result (one per window) as live. Records with `lastFocusEnd: null` whose tab is not that one are reset to `lastFocusEnd: now`, healing any stale state accumulated before this fix

## [1.8.4] - 2026-05-09

### Changed
- Settings → Language combo is now sorted alphabetically by the localized language name in the currently active UI language (Auto stays pinned at the top). EN → Auto / English / French / German / Spanish / Turkish; TR → Otomatik / Almanca / Fransızca / İngilizce / İspanyolca / Türkçe; DE → Automatisch / Deutsch / Englisch / Französisch / Spanisch / Türkisch; ES → Auto / Alemán / Español / Francés / Inglés / Turco; FR → Auto / Allemand / Anglais / Espagnol / Français / Turc. Achieved by sorting the `langSelect <option>` list at init via `localeCompare` on each option's localized text content; the popup combo continues to use the locale-neutral two-letter code order (DE / EN / ES / FR / TR), since codes don't have a per-locale collation

### Fixed
- Sleeping/discarded tabs in **background** windows no longer get wrongly promoted to T1 with their inactivity counter reset when Edge wakes them automatically (memory saver, sleeping-tabs auto-wake, etc.). The 1.6.6 `onReplaced` activation logic was treating any tab whose `chrome.tabs.get(...)` reported `active === true` as user-focused — but `tab.active` is true for the currently-selected tab of *any* window, including unfocused ones. Now `onReplaced` additionally calls `chrome.windows.get(liveTab.windowId)` and only applies activation effects (`lastFocusEnd = null`, `T2/T3 → T1`, group move) when the window is actually focused. Wakes in background windows leave the tier and elapsed timer untouched, as the user expects

## [1.8.2] - 2026-05-08

### Added
- German (Deutsch) and French (Français) full localization. New `_locales/de/messages.json` and `_locales/fr/messages.json` cover every i18n key (~140 strings each); `data/help.json` gains `titleDE`/`bodyDE`/`titleFR`/`bodyFR` for all seven sections; `data/changelog.json` gains `textDE`/`textFR` on every change item; `data/roadmap.json` gains `titleDE`/`titleFR`. Settings → Language and the popup AUTO/EN/TR/ES combo now expose `DE` and `FR` options. `whatsnew.js` and `help.js` were generalized: `t(lang, dict)` takes a per-language object, `pickField` derives the suffix from `lang.toUpperCase()`, `detectLang` iterates a `SUPPORTED_LANGS` list, and `categoryLabel` includes German/French translations of the Added/Changed/Fixed headings (Hinzugefügt/Geändert/Behoben, Ajouté/Modifié/Corrigé). Browser locale auto-detection routes `de-*` / `fr-*` accordingly. The screenshot generator (`tools/screenshots.js`) was extended: `LOCALES` and `PROMO` now produce 5×(5 + 5 + 1 + 1) = 60 store assets in one run
- New `build.ps1` — packages the extension into `dist/tabtier-X.Y.Z.zip` ready for the Chrome Web Store dashboard. Reads the version straight from `manifest.json`, includes only runtime files (`manifest.json`, root-level `*.html`/`*.js`/`*.css`, `_locales/`, `icons/`, `data/`), and excludes everything else (`tools/`, `store-assets/`, `node_modules/`, `.git/`, all `*.md`, `CLAUDE.md`, `*.zip`, the build script itself). One command from the repo root: `.\build.ps1`. Reports file count and final ZIP size on success
- New `tools/screenshots.js` — automated Chrome Web Store asset generator. Loads the unpacked extension into Chromium via Playwright, injects realistic demo `tabRecords`, then captures the popup, Tab Management, Settings, Help, and What's New pages at every accepted Web Store size: five 1280×800 primaries, five 640×400 downscales, plus a 440×280 promo tile and a 1400×560 marquee banner per locale. Output lands in `store-assets/{locale}/{size}/*.png`. Companion `tools/package.json` and `tools/README.md` document setup (`npm install` + `npx playwright install chromium`) and the one-command run (`npm run screenshots`). Promo banners use a soft accent→mantle gradient with a localized tagline; the popup is centered as a thumbnail. Output and Chromium profile are added to `.gitignore`

### Changed
- Language picker order in both the popup combo and Settings → Language now puts AUTO at the top followed by language codes ascending (DE / EN / ES / FR / TR), so the list is alphabetically scannable instead of arbitrary
- Tooltip on the popup language combo (`langCycleTitle`) is now just "Change language" (and locale equivalents) — the previous text listed the cycle order, which was stale once the cycle button was replaced by a `<select>` dropdown
- Roadmap: removed the "German (Deutsch) locale" and "French (Français) locale" entries (shipped with this release); kept the Portuguese entry and added DE/FR translations for the remaining items

### Fixed
- Clicking a sleeping (Edge "Sleeping Tabs") T2/T3 tab now promotes it to T1 immediately on wake — previously the tier stayed stuck until the user clicked away and back. Edge fires `tabs.onReplaced` and `tabs.onActivated` concurrently when waking a discarded tab; if `onReplaced` read storage before `onActivated` wrote, it would overwrite the freshly-promoted record with the pre-wake tier. Fixed by re-checking the latest state in `onReplaced`, skipping the relink when the new ID is already linked, and applying activation effects (lastFocusEnd=null, T2/T3→T1, group move) inside `onReplaced` itself when `chrome.tabs.get(addedTabId).active` is true
- Screenshot generator no longer renders every demo record with a "✗ missing" status in Tab Management screenshots. `chrome.tabs.query` is now monkey-patched at the context level via `addInitScript`: the override merges synthetic `Tab` objects (one per demo `tabId` 101…108) with the real query result, so `openTabIds.has(r.tabId)` returns true and rows render as `✓ open`. The active demo record (id 101, T0 pinned) is also flagged `active: true` in the synthetic list so its row gets the `● active` badge instead of being marked `isStale`. No real tabs are opened — purely an in-page chrome API override that disappears with the disposable Chromium profile after the run
- Screenshot generator no longer leaves a grey scrollbar visible on the right edge of Tab Management / Settings / Help / What's New PNGs — `addStyleTag` now injects a tiny CSS rule (`::-webkit-scrollbar { display: none }`, `scrollbar-width: none`) right before each `page.screenshot()`, and the screenshot is taken with an explicit `clip` of exactly `width × height`. The live extension still scrolls normally; the rule only applies in the headless capture
- Screenshot generator forces `deviceScaleFactor: 1` so HiDPI / Retina screens no longer produce 2× PNGs (e.g. 2560×1600 instead of 1280×800), which the Chrome Web Store rejects or downscales awkwardly

## [1.6.5] - 2026-05-07

### Added
- Language combo (`<select>`) in the popup header — a compact AUTO / EN / TR / ES dropdown next to the theme toggle. Pick a language and the popup reloads in it immediately; persists to `settings.uiLanguage` so other extension pages (Settings, Tab Management, Help, What's New) follow suit. Uses short language codes instead of country flags so the choice stays neutral for English/Spanish speakers in any region. New `langCycleTitle` i18n key for the tooltip in all three locales

### Changed
- What's New page now groups changes by category (Added / Changed / Fixed) under coloured headings, mirroring the structure of `CHANGELOG.md`. Replaces the previous per-item type badges with one heading per group; categories follow the fixed order `feat → change → fix` so the same vocabulary and ordering appear in both surfaces. Heading labels are translated in all three locales

### Fixed
- Tab Management summary warnings no longer render with a doubled "⚠️" icon — the per-warning "⚠️" prefix was redundant with the row label and produced text like "⚠️: ⚠️ 4 in records / missing in browser". Removed the prefix from `staleWarning` / `missingWarning` in all three locales, and reworded `missingWarning` to "N closed (record kept)" / "N kapalı (kaydı tutuldu)" / "N cerradas (registro conservado)" since closed records are now intentionally retained at their previous tier (1.5.5 behavior change), not "missing"
- Closing the Reconcile result panel now re-runs `renderTable()` when Auto pagination is active, so the rows-per-page value recovers to the pre-panel viewport size; previously the row count stayed stuck at the smaller value the panel had forced

## [1.6.1] - 2026-05-06

### Added
- New in-extension Help & Guide page (`help.html` + `help.js`) — opens from Settings → Developer Tools via a "❓ Help" button AND from a new ❓ icon in the popup header (between the theme toggle and the settings cog) for one-click access. Loads `data/help.json` and renders 7 short sections (intro, tier system, tier progression, popup, Tab Management, Settings essentials, tips) with full English / Turkish / Spanish translations. Body text supports `**bold**`, `` `code` ``, `[[T0]]…[[T4]]` tier color pills, and bulleted lists; uses the same theme/CSS variables as the other internal pages. New `helpBtn` i18n key in all three locale files
- Tab Management table now ticks live: a 30-second `setInterval` re-renders the table so the elapsed-time column stays fresh between storage events. Uses the in-memory `allRecords` cache (no storage read), and skips when the page is hidden via `document.hidden`

### Changed
- A closed tab now retains its previous tier (T1 / T2 / T3) in Tab Management instead of being immediately moved to T4 archive. `reconcileTabs` and `timerCheck` no longer mutate the tier when a tab is missing from the open-tab set — the record stays where it was, and natural tier promotion via elapsed-time thresholds (T2 → T3 after 24h, T3 → T4 after 7 days) is what eventually moves it through. Explicit user closure still respects `onManualClose` because that path is `tabs.onRemoved`, which is unchanged
- Roadmap: removed "Statistics dashboard (focus time, tier history)" — already shipped in v1.5.0

### Fixed
- T0 (pinned-group) and T2 tabs no longer disappear from Tab Management after a browser close/reopen — their records were being deleted by reconcile/timerCheck when Chrome's session restore was incomplete or arrived after the first reconcile pass; now they remain visible at their previous tier and can be re-opened from there
- Browser close/reopen now reliably resumes every tab in its previous tier with its previous inactivity time intact. The earlier 1.5.1 attempt failed because Chrome reassigns tabIds starting from low numbers on restart — old `tabRecords` keyed at e.g. tabId=5 collided with brand-new restored tabs at id=5, so the URL-based relink never fired and `onCreated` overwrote the records with fresh T1 entries
- New `rekeyRecordsByUrl()` runs at the start of `reconcileTabs()` and pairs each stored record to a currently-open tab by URL (not by tabId), then rewrites the records map — this is robust to tabId reuse after browser restart and is idempotent on extension reload / SW restart
- Added a `startupGate` promise the IIFE assigns synchronously; `tabs.onCreated` and `tabs.onUpdated` await it before mutating records, so concurrent restored-tab events can no longer race with the rekey pass
- `onCreated` now refuses to overwrite an existing record at the new tabId (rekey may have placed one there from the URL pairing); only refreshes title/favicon and exits
- `tabs.onRemoved` continues to skip its onManualClose action when `removeInfo.isWindowClosing` is true so records survive the shutdown and the rekey can find them on restart
- What's New page category badges now show localized labels ("Feature/Fix/Change", "Özellik/Düzeltme/Değişiklik", "Función/Corrección/Cambio") instead of the raw English type code; `whatsnew.js` was looking up `feature`/`improvement` keys while data uses the canonical `feat`/`change` types, so the lookup fell back to the raw string. CSS class names aligned to `.type-feat` / `.type-change` so feature and change badges also render with the correct background color

## [1.5.0] - 2026-05-05

### Added
- Statistics view in Tab Management — a new "📊 Statistics" tab next to "📋 Tab Records" derives charts from the existing `tabRecords` snapshot (no new data tracking required): tier distribution donut, active vs archived counts, top-10 domains horizontal bar chart, and a list of the longest-lived (oldest createdAt) tabs; cards live-refresh whenever data changes if the Stats view is open
- Persistent activity tracking (`statsAggregate` storage key, separate from `tabRecords`): cumulative focus time per domain, 24-bucket hourly activity histogram, last-30-day rolling daily counts of tabs opened/archived/focused
- Three additional stat cards driven by `statsAggregate`: "Top Domains by Focus Time" (cumulative), "Activity by Hour" (24-bar chart), "Last 30 Days — Tabs Opened & Archived" (stacked daily bars with green=opened, red=archived)
- "📊 Reset Statistics" button in Settings → Data Management to clear `statsAggregate` without touching tab records or settings; new background message handler `CLEAR_STATS`

### Fixed
- Archived (T4) URL links in Tab Management now reliably open the URL as a new T1 tab on click; switched to event-delegation on `tbody` (one-time bind that survives re-renders), and surfaces background errors and missing-URL cases in the console instead of failing silently
- Tab Management table not rendering any rows: the prior fix shadowed an existing `tbody` const declared earlier in `renderTable`, throwing a SyntaxError that aborted the whole render; renamed the local to `tbodyEl`
- `OPEN_AS_T1` background handler referenced an undefined `request` variable (the listener parameter is named `message`); archived URL clicks now actually open the new tab

## [1.4.10] - 2026-05-01

### Changed
- Pagination "Auto" mode: removed off-screen probe complexity; uses a two-pass render — first pass renders rows with a 37px row-height estimate, then measures an actual rendered TR and re-renders once with the real pixel height; all subsequent renders use the cached measurement and are consistent; bottom bar height is read from the already-rendered paginationTop (same structure)
- Pagination option order: Auto / 10 / 25 / 50 / 100 / All

## [1.4.6] - 2026-04-30

### Added
- Pagination in Tab Management: rows-per-page selector (10 / 25 / 50 / 100 / All, default 50) with first / prev / next / last navigation shown above and below the table; resets to page 1 on filter or sort change

### Fixed
- Duplicate tab groups (e.g. multiple "T1: Hot" groups) no longer appear when Chrome restores a session or opens many tabs at once; concurrent `moveTabToTierGroup` calls for the same window are now serialized via a per-window async lock
- Reconcile now merges any pre-existing duplicate same-color groups on startup, healing tabs affected by the race condition before this fix

## [1.4.3] - 2026-04-29

### Fixed
- Settings page status messages ("Saved!", "Reset to defaults.", group rename confirmations, etc.) now respect the stored `uiLanguage`; previously they always used the browser locale because `settings.js` called `chrome.i18n.getMessage` synchronously before the locale override was loaded

## [1.4.2] - 2026-04-27

### Changed
- Elapsed sort: secondary sort key (focus-end date) is now descending — most recently focused tabs appear first among ties; applies to popup, Tab Management, and "Apply to Tabs"

## [1.4.1] - 2026-04-25

### Changed
- Duplicate cleanup now shows a preview panel before deleting: tabs are grouped by URL, one is pre-selected to keep (lowest tier / most recently focused), others are dimmed; user can change selection then confirm — or cancel

## [1.4.0] - 2026-04-23

### Added
- Spanish (`es`) locale — full translation of all UI strings in `_locales/es/messages.json`
- Language selector in Settings (Auto / English / Türkçe / Español); preference saved to storage and applied on next page load
- `i18n-dom.js` reads `uiLanguage` from storage and fetches the matching `_locales/{lang}/messages.json` to override `chrome.i18n` for all HTML token substitutions
- `whatsnew.js` detects stored language preference and renders changelog / roadmap / labels in the selected language
- Roadmap: German, Portuguese, and French locale entries added to What's New "Coming Up" section; Spanish (`titleES`) added to all roadmap items

### Changed
- Popup width increased from 520px to 572px (~10% wider) for more comfortable tab browsing
- Language selector in Settings applies instantly on change (no Save click required) — saves `uiLanguage` and reloads the page immediately
- Language dropdown options shown in the active UI language: English shows "Turkish / Spanish", Turkish shows "İngilizce / İspanyolca", Spanish shows "Inglés / Turco"
- What's New page: all post-1.2.4 changes consolidated into a single entry; Spanish (`textES`) entries added to every changelog item
- What's New subtitle shows version and date from the first changelog entry instead of the installed manifest version

### Fixed
- Popup tier badge labels (T0 Fixed, T1 Active…) reflect the stored language — locale JSON is loaded before first render so labels show in the selected language
- Spanish locale: "Elapsed ↑" sort button now correctly shows "Transcurrido ↑"
- Turkish locale: "Elapsed ↑" sort button now correctly shows "Geçen Süre ↑"
- Tab bar group names correctly update to the selected language: `renameAllGroups` applies the same filter as `moveTabToTierGroup` (drops `T0:/T1:` prefixed stored names so locale defaults win)
- Group name inputs: empty inputs no longer store browser-locale defaults — empty string is stored so the locale default always shows through on language change
- Settings page h1 "Tab Lifecycle Manager" converted to `__MSG_onboardingH1__` token so it is processed by `i18n-dom.js`

## [1.2.9] - 2026-04-22

### Added
- "Elapsed ↑" sort option in popup: sorts all tabs by elapsed inactive time ascending (least inactive first); T0 tabs always first, secondary sort by `lastFocusEnd`; also applied to tab bar via "Apply to Tabs"

### Changed
- Popup width increased from 440px to 520px for more comfortable tab browsing
- Elapsed sort in Tab Management uses `lastFocusEnd` as secondary sort key — T0 tabs (all showing "—") and elapsed ties are ordered by when focus actually ended

### Fixed
- "Apply to Tabs" T0 sort: T0 group is moved to the front via `tabGroups.move` before the sort loop so individual `tabs.move` calls stay within the group's span — no ungroup/re-group flash
- Elapsed sort "Apply to Tabs": T0 tabs were sorted by elapsed descending instead of `lastFocusEnd` ascending — now matches popup and Tab Management behaviour
- Favicon images that fail to load were not being hidden: MV3 CSP blocks inline `onerror` attribute handlers; switched to programmatic `addEventListener` after table render

## [1.2.2] - 2026-04-21

### Fixed
- Tab elapsed times were reset on every extension reload: first-time setup now runs exclusively on `reason="install"` — updates (`reason="update"`) never touch `tabRecords` under any condition

## [1.2.1] - 2026-04-20

### Added
- What's New page (`whatsnew.html`) opens automatically after extension updates; shows changelog cards and roadmap items loaded from `data/changelog.json` and `data/roadmap.json`; adapts to browser locale; respects dark/light theme via `theme.js`
- `data/changelog.json` — structured changelog for the What's New page (version, date, typed change entries)
- `data/roadmap.json` — upcoming feature list for the What's New page (title, status, eta)
- `chrome.runtime.onInstalled` opens `whatsnew.html` on `reason="update"` and `onboarding.html` on fresh install; alarm is always cleared and recreated on install/update

### Fixed
- T1 tab elapsed times were reset to ~0 on every extension update: `initialized` flag was defined as `false` in DefaultSettings but never written back as `true`, so the first-install setup block ran on every `onInstalled` event and overwrote all `lastFocusEnd` values
- Timer reset after PC sleep/hibernate: Edge fires `groupId: -1` for ALL open tabs during session restore before reassigning real group IDs — extension was treating this as a user drag and writing `lastFocusEnd = now` for every tab; fix: `groupId: -1` event no longer touches `lastFocusEnd`; tier corrections on user drags are handled by the follow-up real-groupId event

## [1.1.6] - 2026-04-19

### Added
- Dark/light theme support across all pages (Popup, Settings, Tab Management, Onboarding); Catppuccin Mocha (dark) and Catppuccin Latte (light) palettes; toggle with 🌙/☀️ button in popup header or Theme selector in Settings; preference saved to storage and applied instantly via `theme.js`
- Clicking an open tab URL in Tab Management expands the tab group if it is collapsed before focusing the tab — the tab is always visible after clicking
- Favicon column (20×20) in Tab Management between Title and URL columns
- Fixed column toggle restored: clicking 📌 unfixes a tab (T0→T1, timer starts), clicking — fixes it (T1→T0)
- Clicking a closed/archived URL in Tab Management deletes the stale record and opens the URL as a new T1 tab; Tab Management auto-refreshes via `storage.onChanged`
- Tier labels throughout Tab Management (summary cards and tier badges) use user-configured group names from Settings (T0–T3); T4 always shows the fixed "Archive" label

### Changed
- `timerCheck` and `reconcileTabs` use a shared `calcExpectedTier(elapsed, settings)` helper — tier is always assigned directly from elapsed time rather than one step at a time, correcting tabs stuck in the wrong tier in both directions
- T4 tabs incorrectly archived (elapsed shorter than T3→T4 threshold) are automatically restored and placed in the correct tier group; a 5-minute cooldown per URL prevents reopen loops on redirecting or failing URLs

### Fixed
- Version tag color changed from `--overlay` to `--subtext` for better visibility in dark theme (`#a6adc8` vs `#6c7086`)
- Version number displayed in the header of all four pages (Popup logo, Settings h1, Tab Management h1, Onboarding h1) — populated from `chrome.runtime.getManifest().version`, styled as muted `v1.x.x` tag
- Fixed tier badge text color in Tab Management light theme — T0–T3 badges now always use dark text (`#1e1e2e`) instead of `var(--bg)` which became near-white in light mode
- Translated remaining English "duplicate" terms in Turkish locale to "kopya" (`dedupBtnLabel`, `noDuplicates`, `duplicatesRemoved`, `dupActionLabel`, `dupActionAllow`)
- Replaced all hardcoded inline colors in Tab Management rows and status cells with CSS-variable-based classes (`status-open`, `status-missing`, `status-archive`, `url-open`, `url-closed`, `row-stale`, `row-missing`) — all colors now respond to dark/light theme
- Darkened URL and active-status colors in Tab Management light theme for better readability (`--sky` → `#0369a1`, `--green` → `#166534`)
- Missing tabs (status "missing" in Tab Management) respect the "On Manual Close" setting: "archive" moves to T4, "delete" removes the record entirely
- Tabs incorrectly showing as T4 (archived) in Tab Management while still open in the browser — `reconcileTabs` was marking tabs T4 without closing them; archiving is now left entirely to `timerCheck`
- Tab stuck in T2 with only 9 minutes elapsed: race condition where `timerCheck` overwrote an `onActivated` T1 promotion — storage is re-read just before saving and any tab activated during processing is restored from the fresh copy
- T2/T3 group not appearing in tab bar after a failed `moveTabToTierGroup` call: `extensionMovingTabs` flag was never cleared on error, silently blocking all future `onUpdated` events for that tab

## [1.0.9] - 2026-04-18

### Added
- Startup always calls `reconcileTabs()` before `timerCheck()` to catch tabs opened while the service worker was stopped (e.g. after sleep/wake)
- Tab Management auto-reconciles on open to fix any drift between storage and browser state

### Changed
- Tier check alarm interval reduced from 5 minutes to 1 minute
- Elapsed time in Tab Management shows up to 3 components: days+hours+minutes, hours+minutes+seconds, or minutes+seconds
- Fixed column in Tab Management changed to a read-only indicator (📌 / —); tier changes via group drag in the tab bar are synced automatically

### Fixed
- Elapsed time was reset to near-zero after PC sleep/wake: extension-initiated group moves triggered `onUpdated`, overwriting `lastFocusEnd` — added `extensionMovingTabs` Set so only user-initiated drags update the timer; guard also covers the intermediate `groupId: -1` event Edge fires when moving between groups
- 1-minute alarm not taking effect after update: old alarm was kept if it already existed — startup now always clears and recreates the alarm
- "Apply to Tabs" sort did not sort T0 tabs — T0 tabs are now sorted by the same secondary key as the rest

## [1.0.3] - 2026-04-16

### Changed
- Elapsed time units in Tab Management localized: English `2h 34m`, Turkish `2s 34d` (s/d/sn for saat/dakika/saniye)

### Fixed
- Reconcile result displayed as a persistent panel with labeled metric cards (Archived / New / Fixed / Re-linked / Tier corrected / Grouped), dismissible with ✕; previously shown as a disappearing button label
- Elapsed sort in Tab Management places T0 (fixed) tabs first; secondary sort by title when primary values are equal

## [1.0.0] - 2026-04-15

### Added
- Full i18n support: all user-facing text uses `chrome.i18n`; English and Turkish supported; default locale is English
- `_locales/en/messages.json` and `_locales/tr/messages.json` fully populated for all pages
- `manifest.json` uses `__MSG_extName__` and `__MSG_extDescription__` for localized extension name and description

### Changed
- Debug page renamed to Tab Management (`tab-management.html` / `tab-management.js`)
- Default group names use i18n; stored names that look like old system defaults are cleared so the correct language placeholder shows
- All tab bar labels (group names, internal group title, loading placeholder) use `chrome.i18n.getMessage()`
- Popup sort options replaced with three tier-first presets: Tier + Domain, Tier + Title, Tier + URL
- Popup shows all tiers (T0–T4) by default

### Fixed
- `__MSG_*__` placeholders rendered as literal text in HTML pages — added `i18n-dom.js` to substitute tokens on load
- Tab bar groups created with the wrong language when stored names matched old translated defaults
- Group name inputs in settings showed wrong language — `DefaultSettings.groupNames` is now `{}`; i18n defaults resolve at runtime
- "Edge" replaced with "browser" in user-facing strings — extension works on Chrome and other Chromium browsers
- `moveTabToTierGroup` skips pinned tabs silently; retries up to 3 times on transient tab-lock errors
- `onActivated` corrects pinned tabs incorrectly stored as T2/T3 to T0
- `tabs.onReplaced` listener added to re-link storage records when Edge reassigns a tab ID on wake
- `onUpdated` groupId handler checks `tab.active` before setting `lastFocusEnd` to avoid resetting the timer on a freshly activated tab

## [0.2.8] - 2026-04-14

### Added
- Clear button (✕) inside the filter input in Tab Management
- Tab Management reacts instantly to tab close or tier change via `chrome.storage.onChanged` (replaces 10-second polling)
- Dragging a tab between tier groups syncs the tier in storage immediately; dragging out of all groups falls back to T1
- `reorderGroupsInWindow`: tier groups sorted left-to-right (T0→T3) automatically when a new group is created

### Fixed
- Tabs opened after extension load were not tracked until Reconcile — `onUpdated` now creates a T1 record for untracked tabs
- Newly created tier group appeared at the end of the tab bar instead of in tier order

## [0.2.3] - 2026-04-13

### Added
- Initial project setup and repository
- Tab lifecycle tiering system (T0–T4) with background monitoring
- Popup UI, Settings page, and Onboarding page
- Tab Management page accessible from popup footer
- Fixed column toggle: clicking toggles a tab between T0 and T1; moving to T1 starts the inactivity timer immediately

### Changed
- T0 group membership is the sole source of truth for fixed status — `isPinned` flag no longer drives timer or promote logic
- T0 tabs show dash in elapsed time column

### Fixed
- Tabs manually moved out of T0 group were still shown as fixed in Tab Management

## [0.0.0] - 2026-04-12

- Project created
