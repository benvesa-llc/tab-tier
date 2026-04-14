# Changelog

All notable changes to Tab Tier will be documented in this file.

## [0.2.3] - 2026-04-13

### Added
- Clicking the Fixed (Sabit) cell in Tab Management toggles a tab between T0 and T1
- Moving a tab to T1 via the toggle immediately starts the inactivity timer

### Fixed
- `SET_TAB_TIER` handler now sets `lastFocusEnd` when demoting to T1 so the countdown begins immediately

---

## [0.2.2] - 2026-04-13

### Changed
- Moved "Fixed" (Sabit) column to the first position in the Tab Management table
- T0 tabs now show "—" in the elapsed time column instead of a countdown

---

## [0.2.1] - 2026-04-13

### Changed

- Renamed debug page button label in settings to "Tab Management"

---

## [0.2.0] - 2026-04-13

### Added

- Tab Management page now accessible from the popup footer via a dedicated button

### Changed

- T0 group membership is now the sole source of truth for fixed status — isPinned flag no longer drives timer or promote logic
- timerCheck: skips demotion when currentTier === 0 instead of checking isPinned
- onActivated promote: simplified to currentTier > 1 (T0 equals 0, already excluded)
- "Fixed" column in Tab Management now reflects currentTier === 0 instead of the stored isPinned field
- Debug page renamed to "Tab Management" for general user access
- Onboarding framing updated from pin terminology to T0 group terminology

### Fixed

- Tabs manually moved out of T0 group were still shown as fixed in the management table

---

## [0.1.0] - 2026-04-13

### Added

- Initial development version
- Tab lifecycle tiering system (T0-T4)
- Background tab monitoring
- Popup UI for tab management
- Settings page
- Onboarding page for first-time users
- Debug tools for development