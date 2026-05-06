# Changelog

All notable changes to Tab Tier will be documented in this file.

> **Format rule:** One entry per day. Heading is the date with the highest version released on that day in brackets. Changes are grouped under the three category headings — `### Added`, `### Changed`, `### Fixed` — and only the categories with items are shown. Newest dates on top.

## [1.6.1] - 2026-05-06

### Added
- New in-extension Help & Guide page (`help.html` + `help.js`) — opens from Settings → Developer Tools via a "❓ Help" button, AND from a new ❓ icon in the popup header (between the theme toggle and the settings cog) for one-click access. Loads `data/help.json` and renders 7 short sections (intro, tier system, tier progression, popup, Tab Management, Settings essentials, tips) with full English / Turkish / Spanish translations. Body text supports `**bold**`, `` `code` ``, `[[T0]]…[[T4]]` tier color pills, and bulleted lists; uses the same theme/CSS variables as the other internal pages
- New `helpBtn` i18n key in all three locale files
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
