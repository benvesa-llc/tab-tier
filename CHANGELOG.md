# Changelog

All notable changes to Tab Tier will be documented in this file.

## [1.2.0] - 2026-04-20

### Added
- What's New page (`whatsnew.html`) opens automatically after extension updates; shows changelog cards and roadmap items loaded from `data/changelog.json` and `data/roadmap.json`; adapts to browser locale (English/Turkish); respects dark/light theme via `theme.js`
- `data/changelog.json` — structured changelog for the What's New page (version, date, typed change entries)
- `data/roadmap.json` — upcoming feature list for the What's New page (title, status, eta)
- `chrome.runtime.onInstalled` now opens `whatsnew.html` on `reason="update"` and `onboarding.html` on fresh install; alarm is always cleared and recreated on install/update to pick up interval changes

## [1.1.7] - 2026-04-20

### Fixed
- Timer reset after PC sleep/hibernate: Edge fires `groupId: -1` for ALL open tabs during session restore before reassigning real group IDs — extension was treating this as a user drag and writing `lastFocusEnd = now` for every tab, resetting elapsed time to zero; fix: `groupId: -1` event no longer touches `lastFocusEnd`; tier corrections on user drags are handled by the follow-up real-groupId event

## [1.1.6] - 2026-04-19

### Added
- Dark/light theme support across all pages (Popup, Settings, Tab Management, Onboarding); Catppuccin Mocha (dark) and Catppuccin Latte (light) palettes; toggle with 🌙/☀️ button in popup header or Theme selector in Settings; preference saved to storage and applied instantly via `theme.js`
- Clicking an open tab URL in Tab Management now expands the tab group if it is collapsed before focusing the tab — the tab is always visible after clicking
- Favicon column (20×20) in Tab Management between Title and URL columns
- Fixed column toggle restored: clicking 📌 unfixes a tab (T0→T1, timer starts), clicking — fixes it (T1→T0)
- Clicking a closed/archived URL in Tab Management deletes the stale record and opens the URL as a new T1 tab; Tab Management auto-refreshes via `storage.onChanged`
- Tier labels throughout Tab Management (summary cards and tier badges) now use user-configured group names from Settings (T0–T3); default fallback uses the full group name (e.g. "T1: Hot") matching what the tab bar shows; T4 always shows the fixed "Archive" label

### Changed
- `timerCheck` and `reconcileTabs` now use a shared `calcExpectedTier(elapsed, settings)` helper — tier is always assigned directly from elapsed time rather than one step at a time, correcting tabs stuck in the wrong tier in both directions
- T4 tabs incorrectly archived (elapsed shorter than T3→T4 threshold) are automatically restored and placed in the correct tier group; a 5-minute cooldown per URL prevents reopen loops on redirecting or failing URLs

### Fixed
- Version tag color changed from `--overlay` to `--subtext` for better visibility in dark theme (`#a6adc8` vs `#6c7086`)
- Version number displayed in the header of all four pages (Popup logo, Settings h1, Tab Management h1, Onboarding h1) — populated from `chrome.runtime.getManifest().version`, styled as muted `v1.x.x` tag
- Fixed tier badge text color in Tab Management light theme — T0–T3 badges now always use dark text (`#1e1e2e`) instead of `var(--bg)` which became near-white in light mode
- Translated remaining English "duplicate" terms in Turkish locale to "kopya" (`dedupBtnLabel`, `noDuplicates`, `duplicatesRemoved`, `dupActionLabel`, `dupActionAllow`)
- Replaced all hardcoded inline colors in Tab Management rows and status cells with CSS-variable-based classes (`status-open`, `status-missing`, `status-archive`, `url-open`, `url-closed`, `row-stale`, `row-missing`) — all colors now respond to dark/light theme
- Darkened URL and active-status colors in Tab Management light theme for better readability (`--sky` → `#0369a1`, `--green` → `#166534`)
- Missing tabs (status "missing" in Tab Management) now respect the "On Manual Close" setting: "archive" moves to T4, "delete" removes the record entirely — applied by both `timerCheck` (within 1 minute) and `reconcileTabs`
- Tabs incorrectly showing as T4 (archived) in Tab Management while still open in the browser — `reconcileTabs` was marking tabs T4 without closing them; archiving is now left entirely to `timerCheck`
- Tab stuck in T2 with only 9 minutes elapsed: race condition where `timerCheck` overwrote an `onActivated` T1 promotion — storage is re-read just before saving and any tab activated during processing is restored from the fresh copy
- T2/T3 group not appearing in tab bar after a failed `moveTabToTierGroup` call: `extensionMovingTabs` flag was never cleared on error, silently blocking all future `onUpdated` events for that tab

## [1.0.9] - 2026-04-18

### Added
- Startup now always calls `reconcileTabs()` before `timerCheck()` to catch tabs opened while the service worker was stopped (e.g. after sleep/wake)
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
- Reconcile result now displayed as a persistent panel with labeled metric cards (Archived / New / Fixed / Re-linked / Tier corrected / Grouped), dismissible with ✕; previously shown as a disappearing button label
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
- Popup now shows all tiers (T0–T4) by default

### Fixed
- `__MSG_*__` placeholders rendered as literal text in HTML pages — added `i18n-dom.js` to substitute tokens on load
- Tab bar groups created with the wrong language when stored names matched old translated defaults
- Group name inputs in settings showed wrong language — `DefaultSettings.groupNames` is now `{}`; i18n defaults resolve at runtime
- "Edge" replaced with "browser" in user-facing strings — extension works on Chrome and other Chromium browsers
- `moveTabToTierGroup` skips pinned tabs silently; retries up to 3 times on transient tab-lock errors
- `onActivated` corrects pinned tabs incorrectly stored as T2/T3 to T0
- `tabs.onReplaced` listener added to re-link storage records when Edge reassigns a tab ID on wake
- `onUpdated` groupId handler checks `tab.active` before setting `lastFocusEnd` to avoid resetting the timer on a freshly activated tab
- Reconcile result shown as persistent panel with labeled metric cards instead of a disappearing button label

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
