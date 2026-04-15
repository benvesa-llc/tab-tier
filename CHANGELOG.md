# Changelog

All notable changes to Tab Tier will be documented in this file.

## [0.3.6] - 2026-04-15

### Removed
- `debug.html` and `debug.js` deleted — fully replaced by `tab-management.html` and `tab-management.js`

### Fixed
- Tab bar group names were created with the wrong language (e.g. "Sıcak" instead of "Hot") because `background.js` merge logic only skipped empty stored names but not old translated defaults — filter now also excludes values matching the `T0:/T1:/T2:/T3:` prefix pattern, same as the settings UI fix
- Group name inputs in settings showed the wrong language (e.g. Turkish defaults when browser is English) because translated strings were previously stored in `chrome.storage.local` — `DefaultSettings.groupNames` is now `{}` in both `settings.js` and `background.js`; stored names that look like system defaults (`T0:…`, `T1:…`) are cleared on display so the i18n placeholder appears; merge logic filters out empty stored values so `DefaultGroupNames` (always resolved from current browser language) shows through
- Group name input placeholders in settings now use `__MSG_defaultGroupT*__` instead of hardcoded English strings, so they display in the correct browser language
- "Edge" replaced with "browser" in two user-facing strings (`applyToTabsTitle`, `groupNamesHint`) in both locale files — extension works on Chrome and other Chromium browsers too
- `__MSG_*__` placeholders in HTML pages were rendered as literal text instead of translated strings — added `i18n-dom.js`, a shared script that walks the DOM on load and substitutes all `__MSG_*__` tokens via `chrome.i18n.getMessage()`; script is included in `<head>` of all four HTML pages (popup, settings, onboarding, tab-management)
- Popup sort options replaced with three tier-first presets: "Tier + Domain", "Tier + Başlık", "Tier + URL" — all use tier as the primary sort key, eliminating the bug where applying a URL-only or domain-only sort caused Edge to auto-assign nearby tabs into the wrong tier group during the physical tab move loop
- Popup now shows all tiers (T0–T4) in the default view, not just T3 and T4 — enables quick browsing and search across all tabs without opening Tab Management
- `sortTabsInWindow` in background updated to handle new sort types (`tierDomain`, `tierTitle`, `tierUrl`); legacy sort types fall back to tier-first domain sort
- `moveTabToTierGroup` now skips pinned tabs silently — Chrome/Edge API rejects grouping pinned tabs, which caused a silent error for regularly-pinned tabs (e.g. localhost, devtools pages)
- `moveTabToTierGroup` retry condition broadened from `"dragging"` to `"cannot be edited"` to catch all transient Edge tab-lock errors, not just the dragging variant
- `onActivated` now corrects pinned tabs that have T2/T3 in storage to T0, preventing a failed `moveTabToTierGroup` call on every activation
- `moveTabToTierGroup` now retries up to 3 times (300 ms / 600 ms / 900 ms delays) when Edge rejects the group change with "Tabs cannot be edited right now (user may be dragging a tab)" — this was the root cause of T2/T3 tabs not promoting to T1 when clicked directly in the Edge tab bar
- `tabs.onReplaced` listener added: when Edge reassigns a tab ID after waking a sleeping tab, the storage record is immediately re-linked to the new ID — prevents "yok" (missing) entries in Tab Management
- `timerCheck` now runs a mini-reconcile before processing tier transitions: stale non-T4 records whose tab ID is no longer open are either re-linked by URL or immediately archived to T4 — no more waiting days for the T3→T4 threshold to expire on a tab that is already gone
- `onActivated` now tries URL-based re-link before creating a new record when no record is found for the activated tab ID: fixes the race condition where `onReplaced` and `onActivated` run concurrently on sleeping-tab wake, causing the promotion to T1 and group move to be skipped
- `onActivated` now calls `moveTabToTierGroup` even when creating a brand-new record, ensuring the tab is visually placed in the T1 group regardless of which group it was in before
- `onUpdated` groupId handler now checks `tab.active` before setting `lastFocusEnd`: if the tab is currently active (just clicked by the user), `lastFocusEnd` stays `null` instead of being overwritten with the current timestamp — fixes a race where `onActivated` → `moveTabToTierGroup` → `onUpdated` would reset the inactivity timer on a freshly activated tab
- "Tier + Domain" sort shows tabs grouped by domain; "Tier + Title" and "Tier + URL" sorts show a flat list sorted by title or URL respectively — no domain grouping in non-domain modes
- Sort apply button renamed to "Apply to Tabs" for clarity

### Added
- Full i18n support: all user-facing text now uses `chrome.i18n` — browser automatically shows English or Turkish based on browser language setting; default locale is English
- `_locales/en/messages.json` and `_locales/tr/messages.json` fully populated with keys for all pages (popup, settings, tab management, onboarding)
- `manifest.json` now uses `__MSG_extName__` and `__MSG_extDescription__` for localized extension name and description in the browser's extension list

### Changed
- `debug.html` and `debug.js` renamed to `tab-management.html` and `tab-management.js`; `debug.html` now redirects to the new URL for any existing bookmarks
- `manifest.json` `web_accessible_resources` updated to reference `tab-management.html` and `tab-management.js`
- Default group names in settings now use i18n (English: "T0: Fixed", "T1: Hot" etc.; Turkish: "T0: Sabit", "T1: Sıcak" etc.) — applied when settings are first initialized
- `background.js` `DefaultGroupNames`, `INTERNAL_GROUP_TITLE` ("Other"/"Diğer" tab group for internal pages), and new-tab loading title placeholder now use `chrome.i18n.getMessage()` — all Chrome tab bar labels are fully localized

## [0.2.8] - 2026-04-14

### Added
- Clear button (✕) inside the filter input in Tab Management — appears when text is present, clears filter and restores focus on click
- Tab Management page reacts instantly to tab close or tier change via `chrome.storage.onChanged`
- Debounce (150ms) collapses rapid consecutive storage writes into a single reload
- Dragging a tab between tier groups in the Edge tab bar now immediately syncs the tier in storage
- Dragging a tab out of all groups falls back to T1 with the inactivity timer starting immediately
- `reorderGroupsInWindow`: automatically sorts tier groups left-to-right (T0 → T1 → T2 → T3) when a new group is created, without disturbing tabs inside existing groups
- `COLOR_TO_TIER` constant at top-level, derived from `TIER_GROUP_COLORS`

### Changed
- `onUpdated` now also triggers on `changeInfo.groupId` in addition to URL and title changes

### Removed
- 10-second polling interval replaced by `chrome.storage.onChanged` listener

### Fixed
- Tabs opened after extension load were not tracked until Reconcile was pressed — `onUpdated` now creates a T1 record with immediate countdown for untracked tabs
- Duplicate check also applied in `onUpdated` for the new-record path
- Newly created tier group was appearing at the end of the tab bar instead of in tier order

## [0.2.3] - 2026-04-13

### Added
- Tab Management page (previously debug page) accessible from popup footer
- Clicking the Fixed cell in Tab Management toggles a tab between T0 and T1
- Moving a tab to T1 via the Fixed toggle immediately starts the inactivity timer

### Changed
- T0 group membership is now the sole source of truth for fixed status — `isPinned` flag no longer drives timer or promote logic
- `timerCheck` skips demotion when `currentTier === 0` instead of checking `isPinned`
- `onActivated` promote simplified to `currentTier > 1`
- Fixed column in Tab Management reflects `currentTier === 0` instead of stored `isPinned` field
- Debug page renamed to Tab Management for general user access
- Onboarding updated from pin terminology to T0 group terminology
- Debug page button label in settings renamed to Tab Management
- Fixed column moved to first position in Tab Management table
- T0 tabs show dash in elapsed time column instead of a countdown
- `SET_TAB_TIER` handler sets `lastFocusEnd` when demoting to T1 so the timer starts immediately

### Fixed
- Tabs manually moved out of T0 group were still shown as fixed in the management table

## [0.1.0] - 2026-04-13

### Added
- Initial project setup and repository
- Tab lifecycle tiering system (T0-T4)
- Background tab monitoring
- Popup UI for tab management
- Settings page
- Onboarding page for first-time setup
