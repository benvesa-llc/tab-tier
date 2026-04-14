# Changelog

All notable changes to Tab Tier will be documented in this file.

## [0.2.7] - 2026-04-14

### Added
- Clear button (✕) inside the filter input in Tab Management
- Tab Management page now reacts instantly to tab close or tier change via chrome.storage.onChanged
- Debounce (150ms) prevents redundant reloads from rapid consecutive storage writes
- Dragging a tab between tier groups in Edge tab bar now immediately syncs the tier in storage
- Dragging a tab out of all groups falls back to T1 with timer starting immediately
- COLOR_TO_TIER constant derived from TIER_GROUP_COLORS for group-color-to-tier mapping

### Changed
- onUpdated now also triggers on changeInfo.groupId in addition to URL and title changes

### Removed
- Removed 10-second polling interval (replaced by storage change listener)

### Fixed
- Tabs opened after extension load were not tracked until Reconcile was pressed
- onUpdated now creates a T1 record with immediate countdown for untracked tabs
- Duplicate check applied in onUpdated for new-record path

## [0.2.3] - 2026-04-13

### Added
- Initial development version
- Tab lifecycle tiering system (T0-T4)
- Background tab monitoring
- Popup UI for tab management
- Settings page
- Onboarding page for first-time users
- Debug tools for development
- Tab Management page accessible from popup footer
- Clicking the Fixed cell toggles a tab between T0 and T1
- Moving a tab to T1 via toggle immediately starts the inactivity timer

### Changed
- T0 group membership is now the sole source of truth for fixed status
- Debug page renamed to Tab Management for general user access
- Onboarding updated from pin terminology to T0 group terminology
- Moved Fixed column to the first position in Tab Management table
- T0 tabs now show dash in elapsed time instead of countdown

### Fixed
- Tabs manually moved out of T0 group shown incorrectly as fixed
- SET_TAB_TIER handler now sets lastFocusEnd when demoting to T1

## [0.1.0] - 2026-04-13

### Added
- Initial project setup and repository