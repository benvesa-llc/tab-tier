// =============================================================================
// Tab Lifecycle Manager — onboarding.js
// =============================================================================

// EN: i18n helper shorthand | TR: i18n yardımcı kısaltması
const i18n = (key, subs) => chrome.i18n.getMessage(key, subs);

let allTabs      = []; // EN: all non-T4 tabs from storage | TR: storage'dan gelen tüm tab'lar
let filteredTabs = []; // EN: tabs after search filter | TR: arama sonrası görünenler
let checkedIds   = new Set(); // EN: selected tab IDs (to be set T0) | TR: seçili tabId'ler

// ─── Load tabs from storage ───────────────────────────────────────────────────

async function loadTabs() {
  const { tabRecords = {} } = await chrome.storage.local.get("tabRecords");

  allTabs = Object.values(tabRecords)
    .filter(r => r.currentTier !== 4 && r.tabId != null)
    .sort((a, b) => {
      const da = (a.domain || "").toLowerCase();
      const db = (b.domain || "").toLowerCase();
      if (da !== db) return da < db ? -1 : 1;
      return (a.title || "").toLowerCase().localeCompare((b.title || "").toLowerCase());
    });

  filteredTabs = [...allTabs];
  renderTabList();
  updateStats();
}

// ─── Search filter ────────────────────────────────────────────────────────────

function applySearch(query) {
  const q = query.trim().toLowerCase();
  if (!q) {
    filteredTabs = [...allTabs];
  } else {
    filteredTabs = allTabs.filter(t =>
      (t.title  || "").toLowerCase().includes(q) ||
      (t.domain || "").toLowerCase().includes(q) ||
      (t.url    || "").toLowerCase().includes(q)
    );
  }

  const countEl = document.getElementById("searchCount");
  countEl.textContent = q ? `${filteredTabs.length} / ${allTabs.length}` : "";

  // EN: "Select All" button label changes when search is active
  // TR: "Tümünü Seç" butonu arama aktifken değişir
  const btn = document.getElementById("selectAllBtn");
  btn.textContent = q ? i18n("selectAllVisibleBtnLabel") : i18n("selectAllBtnLabel");

  renderTabList();
  updateStats();
}

// ─── Render tab list ──────────────────────────────────────────────────────────

function renderTabList() {
  const container = document.getElementById("tabList");
  container.innerHTML = "";

  if (filteredTabs.length === 0) {
    container.innerHTML = `<div class="no-results">${i18n("noResultsFound")}</div>`;
    return;
  }

  for (const tab of filteredTabs) {
    const row = document.createElement("div");
    row.className = "tab-row" + (checkedIds.has(tab.tabId) ? " pinned" : "");
    row.dataset.tabId = tab.tabId;

    const cb    = document.createElement("input");
    cb.type     = "checkbox";
    cb.checked  = checkedIds.has(tab.tabId);
    cb.addEventListener("change", () => {
      if (cb.checked) checkedIds.add(tab.tabId);
      else            checkedIds.delete(tab.tabId);
      row.classList.toggle("pinned", cb.checked);
      updateStats();
    });

    const img   = document.createElement("img");
    img.src     = tab.favicon ||
      `https://www.google.com/s2/favicons?domain=${tab.domain}&sz=16`;
    img.onerror = () => {
      img.src = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='16' rx='2' fill='%2345475a'/></svg>";
    };
    img.width  = 16;
    img.height = 16;

    const title       = document.createElement("span");
    title.className   = "tab-title";
    title.textContent = tab.title || tab.url;
    title.title       = tab.url;

    const domain       = document.createElement("span");
    domain.className   = "tab-domain";
    domain.textContent = tab.domain || "";

    row.appendChild(cb);
    row.appendChild(img);
    row.appendChild(title);
    row.appendChild(domain);

    // EN: Click row to toggle checkbox | TR: Satıra tıklayınca checkbox toggle
    row.addEventListener("click", (e) => {
      if (e.target === cb) return;
      cb.checked = !cb.checked;
      if (cb.checked) checkedIds.add(tab.tabId);
      else            checkedIds.delete(tab.tabId);
      row.classList.toggle("pinned", cb.checked);
      updateStats();
    });

    container.appendChild(row);
  }
}

// ─── Stats band ───────────────────────────────────────────────────────────────

function updateStats() {
  const stats   = document.getElementById("pinStats");
  const total   = allTabs.length;
  const visible = filteredTabs.length;
  const pinned  = checkedIds.size;
  const q       = document.getElementById("tabSearch").value.trim();

  if (q) {
    stats.textContent = i18n("statsWithSearch", [total, visible, pinned]);
  } else {
    stats.textContent = i18n("statsWithoutSearch", [total, pinned]);
  }
}

// ─── Select all / deselect all ────────────────────────────────────────────────

document.getElementById("selectAllBtn").addEventListener("click", () => {
  const targets   = filteredTabs;
  const allVisible = targets.every(t => checkedIds.has(t.tabId));

  if (allVisible) {
    targets.forEach(t => checkedIds.delete(t.tabId));
  } else {
    targets.forEach(t => checkedIds.add(t.tabId));
  }

  renderTabList();
  updateStats();
});

// ─── Search input ─────────────────────────────────────────────────────────────

document.getElementById("tabSearch").addEventListener("input", (e) => {
  applySearch(e.target.value);
});

// ─── Start / Skip ─────────────────────────────────────────────────────────────

async function finish(pinSelected) {
  if (pinSelected && checkedIds.size > 0) {
    await chrome.runtime.sendMessage({
      type:   "SET_TAB_TIER",
      tabIds: [...checkedIds],
      tier:   0
    });
  }

  // EN: Mark onboarding as completed | TR: Onboarding'i tamamlandı olarak işaretle
  const { settings = {} } = await chrome.storage.local.get("settings");
  settings.initialized = true;
  await chrome.storage.local.set({ settings });

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]) await chrome.tabs.remove(tabs[0].id);
}

document.getElementById("startBtn").addEventListener("click", () => finish(true));
document.getElementById("skipBtn").addEventListener("click",  () => finish(false));

// ─── Init ─────────────────────────────────────────────────────────────────────
loadTabs();
