// =============================================================================
// Tab Lifecycle Manager — settings.js
// =============================================================================

// EN: i18n helper shorthand | TR: i18n yardımcı kısaltması
const i18n = (key, subs) => chrome.i18n.getMessage(key, subs);

// EN: Default group names from i18n (language-aware) | TR: i18n'den varsayılan grup adları
const DefaultGroupNames = {
  0: i18n("defaultGroupT0"),
  1: i18n("defaultGroupT1"),
  2: i18n("defaultGroupT2"),
  3: i18n("defaultGroupT3"),
};

const DefaultSettings = {
  tier1_to_tier2_minutes: 60,
  tier2_to_tier3_hours:   24,
  tier3_to_tier4_days:     7,
  tier4_delete_days:       60,
  timerIntervalMinutes:     5,
  duplicateAction: "redirect",
  onManualClose:   "delete",
  groupNames: { ...DefaultGroupNames },
  initialized: false,
};

// ─── Load ──────────────────────────────────────────────────────────────────────

async function loadSettings() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  return { ...DefaultSettings, ...settings };
}

// ─── Apply to UI ──────────────────────────────────────────────────────────────

function applyToUI(s) {
  document.getElementById("t1t2").value      = s.tier1_to_tier2_minutes;
  document.getElementById("t1t2Range").value = s.tier1_to_tier2_minutes;

  document.getElementById("t2t3").value      = s.tier2_to_tier3_hours;
  document.getElementById("t2t3Range").value = s.tier2_to_tier3_hours;

  document.getElementById("t3t4").value      = s.tier3_to_tier4_days;
  document.getElementById("t3t4Range").value = s.tier3_to_tier4_days;

  document.getElementById("t4del").value      = s.tier4_delete_days;
  document.getElementById("t4delRange").value = s.tier4_delete_days;

  document.getElementById("dupAction").value   = s.duplicateAction;
  document.getElementById("closeAction").value = s.onManualClose;

  const gn = { ...DefaultGroupNames, ...(s.groupNames || {}) };
  document.getElementById("gn0").value = gn[0];
  document.getElementById("gn1").value = gn[1];
  document.getElementById("gn2").value = gn[2];
  document.getElementById("gn3").value = gn[3];
}

// ─── Read from UI ─────────────────────────────────────────────────────────────

function readFromUI(existing) {
  return {
    ...existing,
    tier1_to_tier2_minutes:
      parseInt(document.getElementById("t1t2").value) ||
      DefaultSettings.tier1_to_tier2_minutes,
    tier2_to_tier3_hours:
      parseInt(document.getElementById("t2t3").value) ||
      DefaultSettings.tier2_to_tier3_hours,
    tier3_to_tier4_days:
      parseInt(document.getElementById("t3t4").value) ||
      DefaultSettings.tier3_to_tier4_days,
    tier4_delete_days:
      parseInt(document.getElementById("t4del").value) ??
      DefaultSettings.tier4_delete_days,
    duplicateAction: document.getElementById("dupAction").value,
    onManualClose:   document.getElementById("closeAction").value,
    groupNames: {
      0: document.getElementById("gn0").value.trim() || DefaultGroupNames[0],
      1: document.getElementById("gn1").value.trim() || DefaultGroupNames[1],
      2: document.getElementById("gn2").value.trim() || DefaultGroupNames[2],
      3: document.getElementById("gn3").value.trim() || DefaultGroupNames[3],
    },
  };
}

// ─── Slider ↔ Number sync ─────────────────────────────────────────────────────

function syncSliderNumber(rangerId, numberId) {
  const ranger = document.getElementById(rangerId);
  const number = document.getElementById(numberId);

  ranger.addEventListener("input", () => { number.value = ranger.value; });
  number.addEventListener("input", () => {
    const v = parseInt(number.value);
    if (!isNaN(v)) ranger.value = v;
  });
}

// ─── Save ─────────────────────────────────────────────────────────────────────

let currentSettings = { ...DefaultSettings };

async function save() {
  const updated = readFromUI(currentSettings);
  await chrome.storage.local.set({ settings: updated });
  currentSettings = updated;

  const status = document.getElementById("saveStatus");
  status.textContent = i18n("savedStatus");
  setTimeout(() => { status.textContent = ""; }, 2500);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  currentSettings = await loadSettings();
  applyToUI(currentSettings);

  syncSliderNumber("t1t2Range", "t1t2");
  syncSliderNumber("t2t3Range", "t2t3");
  syncSliderNumber("t3t4Range", "t3t4");
  syncSliderNumber("t4delRange", "t4del");

  document.getElementById("saveBtn").addEventListener("click", save);

  document.getElementById("resetBtn").addEventListener("click", async () => {
    if (confirm(i18n("confirmResetSettings"))) {
      const reset = {
        ...DefaultSettings,
        groupNames:  { ...DefaultGroupNames },
        initialized: currentSettings.initialized,
      };
      await chrome.storage.local.set({ settings: reset });
      currentSettings = reset;
      applyToUI(reset);
      const status = document.getElementById("saveStatus");
      status.textContent = i18n("resetStatus");
      setTimeout(() => { status.textContent = ""; }, 2500);
    }
  });

  document.getElementById("applyGroupNamesBtn").addEventListener("click", async () => {
    const updated = readFromUI(currentSettings);
    await chrome.storage.local.set({ settings: updated });
    currentSettings = updated;
    chrome.runtime.sendMessage({ type: "RENAME_ALL_GROUPS" });
    const status = document.getElementById("groupNameStatus");
    status.textContent = i18n("groupNamesRenamed");
    setTimeout(() => { status.textContent = ""; }, 2500);
  });

  document.getElementById("dissolveGroupsBtn").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "DISSOLVE_ALL_GROUPS" });
    const status = document.getElementById("dissolveStatus");
    status.textContent = i18n("groupsDissolved");
    setTimeout(() => { status.textContent = ""; }, 2500);
  });

  document.getElementById("clearArchiveBtn").addEventListener("click", async () => {
    if (confirm(i18n("confirmClearArchive"))) {
      const { tabRecords = {} } = await chrome.storage.local.get("tabRecords");
      let count = 0;
      for (const key of Object.keys(tabRecords)) {
        if (tabRecords[key].currentTier === 4) {
          delete tabRecords[key];
          count++;
        }
      }
      await chrome.storage.local.set({ tabRecords });
      alert(i18n("archiveClearedMsg", [count]));
    }
  });

  document.getElementById("clearAllBtn").addEventListener("click", async () => {
    if (confirm(i18n("confirmClearAll"))) {
      await chrome.storage.local.clear();
      alert(i18n("allDataClearedMsg"));
    }
  });
}

init();
