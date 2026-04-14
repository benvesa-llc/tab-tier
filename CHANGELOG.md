# Changelog

All notable changes to Tab Tier will be documented in this file.

## [0.2.5] - 2026-04-14

### Added
- Clear button (✕) inside the filter input in Tab Management

### Fixed
- Tabs opened after extension load were not tracked until Reconcile was pressed
- onUpdated now creates a T1 record with immediate countdown for untracked tabs with real URLs
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
- Clicking the Fixed cell in Tab Management toggles a tab between T0 and T1
- Moving a tab to T1 via toggle immediately starts the inactivity timer

### Changed
- T0 group membership is now the sole source of truth for fixed status
- timerCheck skips demotion when currentTier === 0 instead of checking isPinned
- onActivated promote simplified to currentTier > 1
- Fixed column in Tab Management reflects currentTier === 0
- Debug page renamed to Tab Management for general user access
- Onboarding updated from pin terminology to T0 group terminology
- Renamed debug page button label in settings to Tab Management
- Moved Fixed column to the first position in Tab Management table
- T0 tabs now show dash in elapsed time column instead of countdown

### Fixed
- Tabs manually moved out of T0 group shown incorrectly as fixed
- SET_TAB_TIER handler now sets lastFocusEnd when demoting to T1

## [0.1.0] - 2026-04-13

### Added
- Initial project setup and repository