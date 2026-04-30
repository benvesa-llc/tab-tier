// =============================================================================
// Tab Lifecycle Manager — settings.js
// =============================================================================

// EN: i18n helper — reassigned at startup if a stored language override is active
// TR: i18n yardımcısı — başlangıçta saklanan dil tercihine göre yeniden atanır
let i18n = (key, subs) => chrome.i18n.getMessage(key, subs);

document.getElementById("appVersion").textContent = "v" + chrome.runtime.getManifest().version;

// EN: Default group names — populated after locale loads | TR: Varsayılan grup adları — locale yüklendikten sonra doldurulur
let DefaultGroupNames = {
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
  timerIntervalMinutes:     1,
  duplicateAction: "redirect",
  onManualClose:   "delete",
  theme:       "dark",
  uiLanguage:  "auto",
  // EN: Empty by default — i18n defaults are resolved at runtime, not stored
  // TR: Varsayılan olarak boş — i18n varsayılanları çalışma zamanında çözülür, saklanmaz
  groupNames: {},
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

  document.getElementById("dupAction").value    = s.duplicateAction;
  document.getElementById("closeAction").value  = s.onManualClose;
  document.getElementById("themeSelect").value  = s.theme || "dark";
  document.getElementById("langSelect").value   = s.uiLanguage || "auto";

  // EN: If a stored name looks like a system default (starts with T0:/T1:/T2:/T3:),
  //     treat it as empty so the i18n placeholder shows instead.
  // TR: Saklanan ad sistem varsayılanına benziyorsa (T0:/T1: vb. ile başlıyorsa),
  //     boş kabul et — i18n yer tutucusu görünsün.
  const isSystemDefault = (v) => !v || /^T[0-3]:/.test(v.trim());
  const gn = s.groupNames || {};
  document.getElementById("gn0").value = isSystemDefault(gn[0]) ? '' : gn[0];
  document.getElementById("gn1").value = isSystemDefault(gn[1]) ? '' : gn[1];
  document.getElementById("gn2").value = isSystemDefault(gn[2]) ? '' : gn[2];
  document.getElementById("gn3").value = isSystemDefault(gn[3]) ? '' : gn[3];
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
    theme:           document.getElementById("themeSelect").value,
    uiLanguage:      document.getElementById("langSelect").value,
    // EN: Store only user-typed custom names; empty = let locale defaults show through
    // TR: Sadece kullanıcının yazdığı özel adları sakla; boş = locale varsayılanı göster
    groupNames: {
      0: document.getElementById("gn0").value.trim(),
      1: document.getElementById("gn1").value.trim(),
      2: document.getElementById("gn2").value.trim(),
      3: document.getElementById("gn3").value.trim(),
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

  document.getElementById("saveBtn").addEventListener("click", async () => {
    await save();
  });

  // EN: Instant language switch: save uiLanguage and reload immediately on change
  // TR: Anlık dil değişimi: uiLanguage'ı kaydet ve değişiklikte hemen yenile
  document.getElementById("langSelect").addEventListener("change", async () => {
    const newLang = document.getElementById("langSelect").value;
    const { settings: s = {} } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: { ...s, uiLanguage: newLang } });
    chrome.runtime.sendMessage({ type: "RENAME_ALL_GROUPS" });
    window.location.reload();
  });

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

// EN: Load locale override before init so all i18n calls use the selected language
// TR: init öncesi locale override'ı yükle ki tüm i18n çağrıları seçili dili kullansın
(async () => {
  try {
    const { settings = {} } = await chrome.storage.local.get("settings");
    const lang = settings.uiLanguage;
    if (lang && lang !== "auto") {
      const resp = await fetch(chrome.runtime.getURL(`_locales/${lang}/messages.json`));
      if (resp.ok) {
        const msgs = await resp.json();
        i18n = (key, subs) => {
          const entry = msgs[key];
          if (!entry) return chrome.i18n.getMessage(key, subs) || `[${key}]`;
          let text = entry.message;
          if (subs && entry.placeholders) {
            const args = Array.isArray(subs) ? subs : [subs];
            for (const [name, ph] of Object.entries(entry.placeholders)) {
              const m = (ph.content || "").match(/^\$(\d+)$/);
              if (m) {
                const val = String(args[parseInt(m[1]) - 1] ?? "");
                text = text.replace(new RegExp(`\\$${name.toUpperCase()}\\$`, "g"), val);
              }
            }
          }
          return text;
        };
        DefaultGroupNames = {
          0: i18n("defaultGroupT0"),
          1: i18n("defaultGroupT1"),
          2: i18n("defaultGroupT2"),
          3: i18n("defaultGroupT3"),
        };
      }
    }
  } catch (e) {}
  init();
})();
