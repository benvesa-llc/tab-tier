# Changelog

All notable changes to Tab Tier will be documented in this file.

## [0.2.9] - 2026-04-15

### Fixed
- `tabs.onReplaced` listener added: when Edge reassigns a tab ID after waking a sleeping tab, the storage record is immediately re-linked to the new ID — prevents "yok" (missing) entries in Tab Management
- `timerCheck` now runs a mini-reconcile before processing tier transitions: stale non-T4 records whose tab ID is no longer open are either re-linked by URL or immediately archived to T4 — no more waiting days for the T3→T4 threshold to expire on a tab that is already gone

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
