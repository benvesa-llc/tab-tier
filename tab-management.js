// =============================================================================
// TabTier — tab-management.js
// =============================================================================

// EN: i18n helper shorthand | TR: i18n yardımcı kısaltması
const i18n = (key, subs) => chrome.i18n.getMessage(key, subs);

// EN: Selected T4 record storage keys | TR: Seçili T4 kayıtların storage key'leri
let selectedKeys = new Set();

// EN: Tier labels from i18n | TR: Tier etiketleri i18n'den
const TIER_LABELS = {
  0: i18n("tierT0Name"),
  1: i18n("tierT1Name"),
  2: i18n("tierT2Name"),
  3: i18n("tierT3Name"),
  4: i18n("tierT4Name"),
};

let allRecords = [];
let openTabIds = new Set(); // EN: actually open tab IDs | TR: gerçekte açık tab ID'leri
let activeTabIds = new Set(); // EN: currently focused tab IDs | TR: gerçekte aktif (focused) tab ID'leri
let sortCol = "currentTier";
let sortDir = 1; // EN: 1 = asc, -1 = desc | TR: 1 = artan, -1 = azalan
let filterText = "";

// ─── Time formatting ─────────────────────────────────────────────────────────

function fmtTime(ts) {
  if (ts == null)
    return `<span class="status-active">${i18n("statusActiveNow")}</span>`;
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

function fmtElapsed(lastFocusEnd) {
  if (lastFocusEnd == null)
    return `<span class="status-active">${i18n("statusActiveNow")}</span>`;
  const ms = Date.now() - lastFocusEnd;
  if (ms < 0) return "—";
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr  = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  const g = i18n("unitAbbrDay");
  const s = i18n("unitAbbrHour");
  const d = i18n("unitAbbrMin");
  const sn = i18n("unitAbbrSec");
  if (day > 0) return `${day}${g} ${hr % 24}${s}`;
  if (hr  > 0) return `${hr}${s} ${min % 60}${d}`;
  if (min > 0) return `${min}${d} ${sec % 60}${sn}`;
  return `${sec}${sn}`;
}

// ─── Data loading ─────────────────────────────────────────────────────────────

// EN: Internal page URL detection (same logic as background.js)
// TR: İç sayfa URL tespiti (background.js ile aynı mantık)
function isInternal(url) {
  if (!url) return true;
  return (
    url.startsWith("edge://") ||
    url.startsWith("chrome://") ||
    url.startsWith("about:") ||
    url.startsWith("devtools://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("moz-extension://")
  );
}

let internalTabCount = 0;

async function loadData() {
  const [{ tabRecords = {} }, realTabs, realActive] = await Promise.all([
    chrome.storage.local.get("tabRecords"),
    chrome.tabs.query({}),
    chrome.tabs.query({ active: true }),
  ]);

  openTabIds = new Set(realTabs.map((t) => t.id));
  activeTabIds = new Set(realActive.map((t) => t.id));
  internalTabCount = realTabs.filter((t) => isInternal(t.url)).length;

  allRecords = Object.values(tabRecords).map((r) => ({
    ...r,
    tabId: r.tabId ?? "—",
  }));

  renderSummary();
  renderTable();
  document.getElementById("refreshTime").textContent =
    i18n("lastUpdated") + new Date().toLocaleTimeString();
}

// ─── Summary cards ────────────────────────────────────────────────────────────

function renderSummary() {
  const counts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  let staleNull = 0;
  let missingInBrowser = 0;

  for (const r of allRecords) {
    counts[r.currentTier] = (counts[r.currentTier] || 0) + 1;
    // EN: Stale: lastFocusEnd=null but not actually active | TR: Stale: aktif görünüyor ama gerçekte aktif değil
    if (r.lastFocusEnd === null && !activeTabIds.has(r.tabId)) staleNull++;
    // EN: In records but not in browser (excluding T4) | TR: Kayıtta var, browserde yok (T4 hariç)
    if (r.currentTier !== 4 && !openTabIds.has(r.tabId)) missingInBrowser++;
  }

  const warnings = [];
  if (staleNull > 0) warnings.push(i18n("staleWarning", [staleNull]));
  if (missingInBrowser > 0)
    warnings.push(i18n("missingWarning", [missingInBrowser]));

  const rows = [
    [i18n("sumTotal"), allRecords.length],
    [i18n("tierT0Name"), counts[0]],
    [i18n("tierT1Name"), counts[1]],
    [i18n("tierT2Name"), counts[2]],
    [i18n("tierT3Name"), counts[3]],
    [i18n("tierT4Name"), counts[4]],
    [i18n("sumInternalLabel"), i18n("sumInternalValue", [internalTabCount])],
    ...(warnings.length ? [["⚠️", warnings.join(" · ")]] : []),
  ];

  document.getElementById("summary").innerHTML = rows
    .map(
      ([label, val]) =>
        `<div class="summary-item">${label}: <span>${val}</span></div>`,
    )
    .join("");
}

// ─── Table rendering ──────────────────────────────────────────────────────────

function getComparableValue(r, col) {
  switch (col) {
    case "tabId":
      return r.tabId ?? 0;
    case "currentTier":
      return r.currentTier ?? 99;
    case "domain":
      return (r.domain || "").toLowerCase();
    case "title":
      return (r.title || "").toLowerCase();
    case "url":
      return (r.url || "").toLowerCase();
    case "lastFocusStart":
      return r.lastFocusStart ?? 0;
    case "lastFocusEnd":
      return r.lastFocusEnd ?? Number.MAX_SAFE_INTEGER;
    case "elapsed":
      // EN: T0 (fixed) tabs always sort first; active tabs (null lastFocusEnd) second
      // TR: T0 (sabit) tablar her zaman en başa; aktif (null lastFocusEnd) sonra
      if (r.currentTier === 0) return -2;
      return r.lastFocusEnd == null ? -1 : Date.now() - r.lastFocusEnd;
    case "isPinned":
      return r.currentTier === 0 ? 0 : 1;
    case "createdAt":
      return r.createdAt ?? 0;
    case "openStatus":
      return openTabIds.has(r.tabId) ? 0 : 1;
    default:
      return "";
  }
}

function renderTable() {
  const filter = filterText.toLowerCase();
  let rows = allRecords.filter(
    (r) =>
      !filter ||
      (r.url || "").toLowerCase().includes(filter) ||
      (r.domain || "").toLowerCase().includes(filter) ||
      (r.title || "").toLowerCase().includes(filter),
  );

  rows.sort((a, b) => {
    const va = getComparableValue(a, sortCol);
    const vb = getComparableValue(b, sortCol);
    if (va < vb) return -sortDir;
    if (va > vb) return sortDir;
    // EN: Secondary sort: title ascending | TR: İkincil sıralama: başlık artan
    return (a.title || "").toLowerCase().localeCompare((b.title || "").toLowerCase());
  });

  document.getElementById("noData").style.display =
    rows.length === 0 ? "block" : "none";

  const tbody = document.getElementById("tableBody");
  tbody.innerHTML = rows
    .map((r) => {
      const tier = r.currentTier ?? "?";
      const badgeClass = `tier-badge tier-${tier}`;
      const label = TIER_LABELS[tier] || `T${tier}`;

      const isOpen = openTabIds.has(r.tabId);
      const isActive = activeTabIds.has(r.tabId);
      // EN: Stale: record shows active but not actually active | TR: Kaydı aktif gösteriyor ama gerçekte aktif değil
      const isStale = r.lastFocusEnd === null && !isActive;

      let openCell;
      if (r.currentTier === 4) {
        openCell = `<span style="color:#6c7086">${i18n("statusArchive")}</span>`;
      } else if (isActive) {
        openCell = `<span class="status-active">${i18n("statusActiveNow")}</span>`;
      } else if (isOpen) {
        openCell = `<span style="color:#a6e3a1">${i18n("statusOpen")}</span>`;
      } else {
        openCell = `<span style="color:#f38ba8">${i18n("statusMissing")}</span>`;
      }

      const rowStyle = isStale
        ? "background: #2d1b1b;"
        : !isOpen && tier !== 4
          ? "background: #1e1b2d;"
          : "";

      const key = String(r.tabId);
      const isT4 = tier === 4;
      const cbHtml = isT4
        ? `<input type="checkbox" class="row-cb" data-key="${key}" ${selectedKeys.has(key) ? "checked" : ""}>`
        : "";

      const isT0 = r.currentTier === 0;

      return `
      <tr style="${rowStyle}">
        <td class="cb-col">${cbHtml}</td>
        <td style="text-align:center">${
          tier !== 4
            ? `<span class="pin-toggle" data-tabid="${r.tabId}" data-tier="${tier}"
              style="cursor:pointer;font-size:15px"
              title="${isT0 ? i18n("pinToggleUnpin") : i18n("pinTogglePin")}"
            >${isT0 ? "📌" : "—"}</span>`
            : "—"
        }</td>
        <td class="tabid-cell">${r.tabId}${isStale ? ` <span style="color:#f38ba8;font-size:10px">${i18n("staleLabel")}</span>` : ""}</td>
        <td><span class="${badgeClass}">${label}</span></td>
        <td>${openCell}</td>
        <td class="domain-cell">${escHtml(r.domain || "—")}</td>
        <td class="title-cell" title="${escHtml(r.title || "")}">${escHtml(r.title || "—")}</td>
        <td class="url-cell" title="${escHtml(r.url || "")}">
          ${
            isOpen
              ? `<a href="#" class="activate-tab" data-tabid="${r.tabId}" style="color:#89dceb">${escHtml(r.url || "—")}</a>`
              : `<a href="${escHtml(r.url || "#")}" target="_blank" style="color:#a6adc8">${escHtml(r.url || "—")}</a>`
          }
        </td>
        <td class="time-cell">${fmtTime(r.lastFocusStart)}</td>
        <td class="time-cell">${fmtTime(r.lastFocusEnd)}</td>
        <td class="time-cell">${isT0 ? "—" : fmtElapsed(r.lastFocusEnd)}</td>
        <td class="time-cell">${fmtTime(r.createdAt)}</td>
      </tr>`;
    })
    .join("");

  // EN: Update column header sort arrows | TR: Sütun başlığı okları güncelle
  document.querySelectorAll("thead th[data-col]").forEach((th) => {
    th.classList.remove("sorted-asc", "sorted-desc");
    if (th.dataset.col === sortCol) {
      th.classList.add(sortDir === 1 ? "sorted-asc" : "sorted-desc");
    }
  });

  // EN: Activate-tab links — click to focus the open tab | TR: Açık tab linkleri — tıklayınca aktif et
  document.querySelectorAll(".activate-tab").forEach((a) => {
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      const tabId = parseInt(a.dataset.tabid);
      try {
        const tab = await chrome.tabs.update(tabId, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
      } catch (_) {}
    });
  });

  // EN: Pin toggle — switch between T0 ↔ T1 | TR: Pin toggle — T0 ↔ T1 geçişi
  document.querySelectorAll(".pin-toggle").forEach((el) => {
    el.addEventListener("click", async () => {
      const tabId = parseInt(el.dataset.tabid);
      const currentTier = parseInt(el.dataset.tier);
      const newTier = currentTier === 0 ? 1 : 0;
      try {
        await chrome.runtime.sendMessage({
          type: "SET_TAB_TIER",
          tabIds: [tabId],
          tier: newTier,
        });
        await loadData();
      } catch (_) {}
    });
  });

  // EN: Row checkbox events — bind after tbody render | TR: Checkbox olayları — tbody render edildikten sonra bağla
  document.querySelectorAll(".row-cb").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) selectedKeys.add(cb.dataset.key);
      else selectedKeys.delete(cb.dataset.key);
      updateOpenBtn();
    });
  });

  // EN: Sync "select all" checkbox state | TR: "Tümünü seç" checkbox durumunu senkronize et
  const t4Count = allRecords.filter((r) => r.currentTier === 4).length;
  const selectAll = document.getElementById("selectAllT4");
  selectAll.checked = t4Count > 0 && selectedKeys.size === t4Count;
  selectAll.indeterminate =
    selectedKeys.size > 0 && selectedKeys.size < t4Count;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function updateOpenBtn() {
  const btn = document.getElementById("openSelectedBtn");
  btn.disabled = selectedKeys.size === 0;
  btn.textContent =
    selectedKeys.size > 0
      ? i18n("openSelectedWithCount", [selectedKeys.size])
      : i18n("openSelectedBtnLabel");
}

// ─── Event listeners ──────────────────────────────────────────────────────────

document.getElementById("refreshBtn").addEventListener("click", loadData);

const filterInput = document.getElementById("filterInput");
const filterClear = document.getElementById("filterClear");

filterInput.addEventListener("input", (e) => {
  filterText = e.target.value;
  filterClear.style.display = filterText ? "block" : "none";
  renderTable();
});

filterClear.addEventListener("click", () => {
  filterInput.value = "";
  filterText = "";
  filterClear.style.display = "none";
  filterInput.focus();
  renderTable();
});

document.getElementById("copyBtn").addEventListener("click", async () => {
  const { tabRecords = {} } = await chrome.storage.local.get("tabRecords");
  await navigator.clipboard.writeText(JSON.stringify(tabRecords, null, 2));
  const btn = document.getElementById("copyBtn");
  btn.textContent = i18n("copyDone");
  setTimeout(() => {
    btn.textContent = i18n("copyJsonBtnLabel");
  }, 2000);
});

document.getElementById("reconcileBtn").addEventListener("click", async () => {
  const btn = document.getElementById("reconcileBtn");
  btn.textContent = i18n("reconciling");
  btn.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: "RECONCILE_TABS" });
    await loadData();
    // EN: Show structured result panel | TR: Yapılandırılmış sonuç panelini göster
    showReconcileResult(res);
  } catch (e) {
    btn.textContent = "❌ " + (e?.message || "");
    setTimeout(() => { btn.disabled = false; }, 3000);
  }
  btn.textContent = i18n("reconcileBtnLabel");
  btn.disabled = false;
});

function showReconcileResult(res) {
  const panel  = document.getElementById("reconcileResult");
  const title  = document.getElementById("reconcileResultTitle");
  const items  = document.getElementById("reconcileItems");

  title.textContent = i18n("reconcileResultTitle");

  const metrics = [
    { key: "reconcileArchived",  val: res.archived       ?? 0 },
    { key: "reconcileAdded",     val: res.added          ?? 0 },
    { key: "reconcileFixed",     val: res.fixed          ?? 0 },
    { key: "reconcileRelinked",  val: res.relinked       ?? 0 },
    { key: "reconcileTierFixed", val: res.tierCorrected  ?? 0 },
    { key: "reconcileGrouped",   val: res.grouped        ?? 0 },
  ];

  items.innerHTML = metrics.map(({ key, val }) => `
    <div class="reconcile-item">
      <span class="ri-val ${val === 0 ? 'zero' : ''}">${val}</span>
      <span class="ri-lbl">${i18n(key)}</span>
    </div>
  `).join("");

  panel.style.display = "block";
}

document.getElementById("reconcileClose").addEventListener("click", () => {
  document.getElementById("reconcileResult").style.display = "none";
});

document.getElementById("dedupBtn").addEventListener("click", async () => {
  const btn = document.getElementById("dedupBtn");
  btn.textContent = i18n("cleaning");
  btn.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: "DEDUP_RECORDS" });
    await loadData();
    btn.textContent =
      res.removed > 0
        ? i18n("duplicatesRemoved", [res.removed, res.closedTabs])
        : i18n("noDuplicates");
  } catch (_) {
    btn.textContent = "❌ Error";
  }
  setTimeout(() => {
    btn.textContent = i18n("dedupBtnLabel");
    btn.disabled = false;
  }, 3500);
});

// EN: "Select all T4" header checkbox | TR: "Tümünü seç" başlık checkbox
document.getElementById("selectAllT4").addEventListener("change", (e) => {
  const t4Keys = allRecords
    .filter((r) => r.currentTier === 4)
    .map((r) => String(r.tabId));
  if (e.target.checked) {
    t4Keys.forEach((k) => selectedKeys.add(k));
  } else {
    t4Keys.forEach((k) => selectedKeys.delete(k));
  }
  updateOpenBtn();
  renderTable();
});

// EN: Open selected T4 records | TR: Seçili T4 kayıtlarını aç
document
  .getElementById("openSelectedBtn")
  .addEventListener("click", async () => {
    if (selectedKeys.size === 0) return;
    const btn = document.getElementById("openSelectedBtn");
    btn.disabled = true;
    btn.textContent = i18n("opening");
    try {
      await chrome.runtime.sendMessage({
        type: "PROMOTE_TABS",
        keys: [...selectedKeys],
      });
      selectedKeys.clear();
      await loadData();
      updateOpenBtn();
    } catch (_) {
      btn.textContent = "❌ Error";
      setTimeout(() => {
        btn.disabled = false;
        updateOpenBtn();
      }, 2000);
    }
  });

document.querySelectorAll("thead th[data-col]").forEach((th) => {
  th.addEventListener("click", () => {
    const col = th.dataset.col;
    if (sortCol === col) {
      sortDir = -sortDir;
    } else {
      sortCol = col;
      sortDir = 1;
    }
    renderTable();
  });
});

// ─── Init and live update ────────────────────────────────────────────────────

loadData();

// EN: Reload on storage change (tab closed, tier change, etc.) | TR: Storage değişince yenile
let reloadTimer = null;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.tabRecords) return;
  // EN: Debounce: collapse rapid successive writes into one reload
  // TR: Debounce: ardışık hızlı yazmaları tek bir yenilemede birleştir
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(loadData, 150);
});
