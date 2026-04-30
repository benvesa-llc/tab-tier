// =============================================================================
// TabTier — tab-management.js
// =============================================================================

// EN: i18n helper — reassigned at startup if a stored language override is active
// TR: i18n yardımcısı — başlangıçta saklanan dil tercihine göre yeniden atanır
let i18n = (key, subs) => chrome.i18n.getMessage(key, subs);

document.getElementById("appVersion").textContent = "v" + chrome.runtime.getManifest().version;

// EN: Selected T4 record storage keys | TR: Seçili T4 kayıtların storage key'leri
let selectedKeys = new Set();

// EN: Tier labels — start from i18n defaults, overridden by settings group names on loadData
// TR: Tier etiketleri — i18n varsayılanları, loadData'da settings grup adlarıyla güncellenir
let TIER_LABELS = {
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
let pageSize = 50;    // EN: rows per page; 0 = show all | TR: sayfa başına satır; 0 = tümünü göster
let currentPage = 0; // EN: zero-based current page index | TR: sıfır tabanlı geçerli sayfa indeksi

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
  const g  = i18n("unitAbbrDay");
  const s  = i18n("unitAbbrHour");
  const d  = i18n("unitAbbrMin");
  const sn = i18n("unitAbbrSec");
  // EN: Show up to 3 most significant non-zero components
  // TR: En fazla 3 anlamlı sıfır-olmayan bileşeni göster
  let elapsed;
  if (day > 0) elapsed = `${day}${g} ${hr % 24}${s} ${min % 60}${d}`;
  else if (hr  > 0) elapsed = `${hr}${s} ${min % 60}${d} ${sec % 60}${sn}`;
  else if (min > 0) elapsed = `${min}${d} ${sec % 60}${sn}`;
  else elapsed = `${sec}${sn}`;
  return elapsed;
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
  const [{ tabRecords = {}, settings = {} }, realTabs, realActive] = await Promise.all([
    chrome.storage.local.get(["tabRecords", "settings"]),
    chrome.tabs.query({}),
    chrome.tabs.query({ active: true }),
  ]);

  // EN: Override T0-T3 labels with user-configured group names (same filter as background.js)
  // TR: T0-T3 etiketlerini kullanıcının ayarladığı grup adlarıyla güncelle (background.js ile aynı filtre)
  const gn = settings.groupNames || {};
  const isSystemDefault = (v) => !v || /^T[0-3]:/.test(v.trim());
  for (const tier of [0, 1, 2, 3]) {
    TIER_LABELS[tier] = isSystemDefault(gn[tier]) ? i18n(`defaultGroupT${tier}`) : gn[tier];
  }
  // EN: T4 always uses the i18n label — it has no browser group | TR: T4 her zaman i18n etiketini kullanır — tab bar grubu yoktur

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
    [TIER_LABELS[0], counts[0]],
    [TIER_LABELS[1], counts[1]],
    [TIER_LABELS[2], counts[2]],
    [TIER_LABELS[3], counts[3]],
    [TIER_LABELS[4], counts[4]],
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
    // EN: Secondary sort: when sorting by elapsed, use lastFocusEnd so T0 (all "—") and
    //     ties in elapsed time are ordered by when focus actually ended.
    // TR: Elapsed sıralamasında ikincil kriter lastFocusEnd — T0 ("—") ve eşit süreler
    //     odağın gerçekte ne zaman bittiğine göre sıralanır.
    if (sortCol === "elapsed") {
      const fa = a.lastFocusEnd ?? 0;
      const fb = b.lastFocusEnd ?? 0;
      return fa > fb ? -1 : fa < fb ? 1 : 0;
    }
    return (a.title || "").toLowerCase().localeCompare((b.title || "").toLowerCase());
  });

  const totalRows = rows.length;

  // EN: Clamp currentPage so it stays valid after filter/data changes
  // TR: currentPage'i filtre/veri değişimlerinde geçerli aralıkta tut
  const effectiveSize = pageSize === 0 ? totalRows : pageSize;
  const totalPages = effectiveSize > 0 ? Math.ceil(totalRows / effectiveSize) : 1;
  if (currentPage >= totalPages) currentPage = Math.max(0, totalPages - 1);

  // EN: Slice to current page | TR: Geçerli sayfaya dilimleme
  if (pageSize > 0) rows = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  document.getElementById("noData").style.display =
    totalRows === 0 ? "block" : "none";

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
        openCell = `<span class="status-archive">${i18n("statusArchive")}</span>`;
      } else if (isActive) {
        openCell = `<span class="status-active">${i18n("statusActiveNow")}</span>`;
      } else if (isOpen) {
        openCell = `<span class="status-open">${i18n("statusOpen")}</span>`;
      } else {
        openCell = `<span class="status-missing">${i18n("statusMissing")}</span>`;
      }

      const rowClass = isStale
        ? "row-stale"
        : !isOpen && tier !== 4
          ? "row-missing"
          : "";

      const key = String(r.tabId);
      const isT4 = tier === 4;
      const cbHtml = isT4
        ? `<input type="checkbox" class="row-cb" data-key="${key}" ${selectedKeys.has(key) ? "checked" : ""}>`
        : "";

      const isT0 = r.currentTier === 0;

      return `
      <tr class="${rowClass}">
        <td class="cb-col">${cbHtml}</td>
        <td style="text-align:center;font-size:15px;cursor:pointer" class="toggle-fixed" data-tabid="${r.tabId}" data-tier="${tier}" title="${isT0 ? i18n('unfixTab') : i18n('fixTab')}">${isT0 ? "📌" : "—"}</td>
        <td class="tabid-cell">${r.tabId}${isStale ? ` <span class="status-stale">${i18n("staleLabel")}</span>` : ""}</td>
        <td><span class="${badgeClass}">${label}</span></td>
        <td>${openCell}</td>
        <td class="domain-cell">${escHtml(r.domain || "—")}</td>
        <td class="title-cell" title="${escHtml(r.title || "")}">${escHtml(r.title || "—")}</td>
        <td style="width:28px;text-align:center;padding:4px 6px">${r.favicon ? `<img src="${escHtml(r.favicon)}" width="20" height="20" style="border-radius:3px;vertical-align:middle;object-fit:contain" class="favicon-img">` : ""}</td>
        <td class="url-cell" title="${escHtml(r.url || "")}">
          ${
            isOpen
              ? `<a href="#" class="activate-tab url-open" data-tabid="${r.tabId}">${escHtml(r.url || "—")}</a>`
              : `<a href="#" class="open-archived url-closed" data-url="${escHtml(r.url || "")}" data-key="${key}">${escHtml(r.url || "—")}</a>`
          }
        </td>
        <td class="time-cell">${fmtTime(r.lastFocusStart)}</td>
        <td class="time-cell">${fmtTime(r.lastFocusEnd)}</td>
        <td class="time-cell">${isT0 ? "—" : fmtElapsed(r.lastFocusEnd)}</td>
        <td class="time-cell">${fmtTime(r.createdAt)}</td>
      </tr>`;
    })
    .join("");

  // EN: Hide favicons that fail to load (CSP blocks inline onerror, use addEventListener)
  // TR: Yüklenemeyen favicon'ları gizle (CSP inline onerror'ı engeller, addEventListener kullan)
  document.querySelectorAll(".favicon-img").forEach(img => {
    img.addEventListener("error", () => { img.style.display = "none"; });
  });

  // EN: Update column header sort arrows | TR: Sütun başlığı okları güncelle
  document.querySelectorAll("thead th[data-col]").forEach((th) => {
    th.classList.remove("sorted-asc", "sorted-desc");
    if (th.dataset.col === sortCol) {
      th.classList.add(sortDir === 1 ? "sorted-asc" : "sorted-desc");
    }
  });

  // EN: Activate-tab links — expand collapsed group if needed, then focus tab | TR: Açık tab linkleri — kapalı grup varsa aç, sonra taba odaklan
  document.querySelectorAll(".activate-tab").forEach((a) => {
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      const tabId = parseInt(a.dataset.tabid);
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.groupId && tab.groupId !== -1) {
          await chrome.tabGroups.update(tab.groupId, { collapsed: false });
        }
        await chrome.tabs.update(tabId, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
      } catch (_) {}
    });
  });

  // EN: Fixed column toggle — click 📌 to unfix (T0→T1) or — to fix (T1→T0) | TR: Sabit sütun toggle — 📌 T0→T1, — T1→T0
  document.querySelectorAll(".toggle-fixed").forEach((td) => {
    td.addEventListener("click", async () => {
      const tabId = parseInt(td.dataset.tabid);
      const currentTier = parseInt(td.dataset.tier);
      if (isNaN(tabId) || currentTier === 4) return;
      const newTier = currentTier === 0 ? 1 : 0;
      await chrome.runtime.sendMessage({ type: "SET_TAB_TIER", tabIds: [tabId], tier: newTier });
    });
  });

  // EN: Open-archived links — delete old record, open URL as new T1 tab | TR: Arşiv/kapalı linkleri — eski kaydı sil, URL'yi yeni T1 tab olarak aç
  document.querySelectorAll(".open-archived").forEach((a) => {
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      const { url, key } = a.dataset;
      if (!url) return;
      await chrome.runtime.sendMessage({ type: "OPEN_AS_T1", url, oldKey: key });
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

  renderPagination(totalRows);
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function renderPagination(totalRows) {
  const bar = document.getElementById("pagination");
  const effectiveSize = pageSize === 0 ? totalRows : pageSize;
  const totalPages = effectiveSize > 0 ? Math.ceil(totalRows / effectiveSize) : 1;

  bar.innerHTML = `
    <span class="pg-label">${i18n("pagingRowsLabel")}</span>
    <select id="pageSizeSelect">
      ${[10, 30, 50, 100, 0].map(s =>
        `<option value="${s}" ${s === pageSize ? "selected" : ""}>${s === 0 ? i18n("pagingAll") : s}</option>`
      ).join("")}
    </select>
    <button class="pg-btn" id="pgFirst" ${currentPage === 0 ? "disabled" : ""}>«</button>
    <button class="pg-btn" id="pgPrev"  ${currentPage === 0 ? "disabled" : ""}>‹</button>
    <span class="pg-info">${i18n("pagingInfo", [currentPage + 1, totalPages])}</span>
    <button class="pg-btn" id="pgNext" ${currentPage >= totalPages - 1 ? "disabled" : ""}>›</button>
    <button class="pg-btn" id="pgLast" ${currentPage >= totalPages - 1 ? "disabled" : ""}>»</button>
    <span class="pg-total">(${totalRows})</span>
  `;

  document.getElementById("pageSizeSelect").addEventListener("change", (e) => {
    pageSize = parseInt(e.target.value);
    currentPage = 0;
    renderTable();
  });
  document.getElementById("pgFirst").addEventListener("click", () => { currentPage = 0; renderTable(); });
  document.getElementById("pgPrev").addEventListener("click",  () => { if (currentPage > 0) { currentPage--; renderTable(); } });
  document.getElementById("pgNext").addEventListener("click",  () => { if (currentPage < totalPages - 1) { currentPage++; renderTable(); } });
  document.getElementById("pgLast").addEventListener("click",  () => { currentPage = totalPages - 1; renderTable(); });
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
  currentPage = 0;
  renderTable();
});

filterClear.addEventListener("click", () => {
  filterInput.value = "";
  filterText = "";
  filterClear.style.display = "none";
  filterInput.focus();
  currentPage = 0;
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

// EN: Render duplicate preview panel — groups of duplicate tabs for user to review before deleting
// TR: Kopya önizleme panelini göster — kullanıcı silmeden önce grupları inceleyebilir
function renderDedupPreview(groups) {
  const panel = document.getElementById("dedupPreview");
  panel.innerHTML = "";
  panel.style.display = "block";

  const header = document.createElement("div");
  header.className = "dedup-header";
  const title = document.createElement("span");
  title.className = "dedup-title";
  title.textContent = i18n("dedupPreviewTitle", [groups.length]);
  header.appendChild(title);
  panel.appendChild(header);

  const groupsWrap = document.createElement("div");
  groupsWrap.className = "dedup-groups";

  groups.forEach((group, gi) => {
    const card = document.createElement("div");
    card.className = "dedup-group-card";

    const urlLabel = document.createElement("div");
    urlLabel.className = "dedup-url";
    urlLabel.textContent = group.url;
    card.appendChild(urlLabel);

    // EN: Update row highlight based on selected radio | TR: Seçili radio'ya göre satır vurgusunu güncelle
    function updateDim() {
      const checked = card.querySelector("input[type='radio']:checked");
      card.querySelectorAll(".dedup-entry").forEach(row => {
        const radio = row.querySelector("input[type='radio']");
        row.classList.toggle("dedup-dim", radio !== checked);
      });
    }

    group.entries.forEach(entry => {
      const label = document.createElement("label");
      label.className = "dedup-entry";

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `dedup-group-${gi}`;
      radio.value = entry.key;
      radio.checked = entry.key === group.autoKeepKey;
      radio.addEventListener("change", updateDim);

      const tierBadge = document.createElement("span");
      tierBadge.className = `tier-badge tier-${entry.currentTier}`;
      tierBadge.textContent = `T${entry.currentTier}`;

      const statusSpan = document.createElement("span");
      statusSpan.className = entry.isOpen ? "status-open" : "status-archive";
      statusSpan.textContent = entry.isOpen ? "✓" : "⚫";

      const titleSpan = document.createElement("span");
      titleSpan.className = "dedup-entry-title";
      titleSpan.textContent = entry.title;

      label.appendChild(radio);
      label.appendChild(tierBadge);
      label.appendChild(statusSpan);
      label.appendChild(titleSpan);
      card.appendChild(label);
    });

    groupsWrap.appendChild(card);
    updateDim();
  });

  panel.appendChild(groupsWrap);

  const totalDupes = groups.reduce((s, g) => s + g.entries.length - 1, 0);

  const footer = document.createElement("div");
  footer.className = "dedup-footer";

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "btn-dedup-confirm";
  confirmBtn.textContent = i18n("dedupPreviewConfirm", [totalDupes]);
  confirmBtn.addEventListener("click", async () => {
    const keepKeys = {};
    groups.forEach((group, gi) => {
      const selected = panel.querySelector(`input[name="dedup-group-${gi}"]:checked`);
      if (selected) keepKeys[group.url] = selected.value;
    });
    confirmBtn.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({ type: "DEDUP_RECORDS", keepKeys });
      panel.style.display = "none";
      await loadData();
      const btn = document.getElementById("dedupBtn");
      btn.textContent = i18n("duplicatesRemoved", [res.removed, res.closedTabs]);
      setTimeout(() => { btn.textContent = i18n("dedupBtnLabel"); }, 3500);
    } catch (_) {
      confirmBtn.disabled = false;
    }
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn-dedup-cancel";
  cancelBtn.textContent = i18n("dedupPreviewCancel");
  cancelBtn.addEventListener("click", () => { panel.style.display = "none"; });

  footer.appendChild(confirmBtn);
  footer.appendChild(cancelBtn);
  panel.appendChild(footer);
}

document.getElementById("dedupBtn").addEventListener("click", async () => {
  const btn = document.getElementById("dedupBtn");
  btn.textContent = i18n("cleaning");
  btn.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: "FIND_DUPLICATES" });
    if (!res.groups || res.groups.length === 0) {
      btn.textContent = i18n("noDuplicates");
      setTimeout(() => { btn.textContent = i18n("dedupBtnLabel"); btn.disabled = false; }, 3000);
    } else {
      btn.textContent = i18n("dedupBtnLabel");
      btn.disabled = false;
      renderDedupPreview(res.groups);
    }
  } catch (_) {
    btn.textContent = "❌ Error";
    setTimeout(() => { btn.textContent = i18n("dedupBtnLabel"); btn.disabled = false; }, 3000);
  }
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
    currentPage = 0;
    renderTable();
  });
});

// ─── Init and live update ────────────────────────────────────────────────────

// EN: On page open, auto-reconcile to catch any tabs that drifted out of sync
//     (e.g. after PC sleep/wake or service worker restart)
// TR: Sayfa açılışında otomatik uzlaştır — senkron dışı kalan tabları yakala
//     (örn. PC uyku/açılış veya servis worker yeniden başlatma sonrası)
(async () => {
  // EN: Load locale override before rendering — reassign i18n and TIER_LABELS
  // TR: Render öncesi locale override yükle — i18n ve TIER_LABELS'ı yeniden ata
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
        for (let tier = 0; tier <= 4; tier++) {
          const keys = ["tierT0Name","tierT1Name","tierT2Name","tierT3Name","tierT4Name"];
          TIER_LABELS[tier] = i18n(keys[tier]);
        }
      }
    }
  } catch (e) {}

  try {
    await chrome.runtime.sendMessage({ type: "RECONCILE_TABS" });
  } catch (_) {}
  await loadData();
})();

// EN: Reload on storage change (tab closed, tier change, etc.) | TR: Storage değişince yenile
let reloadTimer = null;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.tabRecords) return;
  // EN: Debounce: collapse rapid successive writes into one reload
  // TR: Debounce: ardışık hızlı yazmaları tek bir yenilemede birleştir
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(loadData, 150);
});
