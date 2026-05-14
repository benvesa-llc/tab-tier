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
let pageSize = -1;   // EN: rows per page; -1 = auto-fit viewport, 0 = show all | TR: sayfa başına satır; -1 = otomatik, 0 = tümünü göster
let currentPage = 0; // EN: zero-based current page index | TR: sıfır tabanlı geçerli sayfa indeksi

const PAGE_SIZE_OPTIONS = [-1, 10, 25, 50, 100, 0]; // EN: -1=Auto, 0=All | TR: -1=Otomatik, 0=Tümü

// EN: Measured row height — 0 until the first tbody render, then set from an actual TR.
// TR: Ölçülen satır yüksekliği — ilk tbody render'ından önce 0, sonra gerçek TR'den ölçülür.
let _rowHeight = 0;

// EN: Calculate how many rows fit between the sticky thead and the bottom pagination bar.
//     Uses paginationTop.offsetHeight as a proxy for the bottom bar height (same structure).
//     Falls back to 37px row height before the first real measurement.
// TR: Sabit thead ile alt pagination bar arasına kaç satır sığdığını hesapla.
//     Alt bar yüksekliği için paginationTop.offsetHeight kullanılır (aynı yapı).
//     İlk gerçek ölçümden önce 37px yedek satır yüksekliği kullanılır.
function calcAutoPageSize() {
  const thead  = document.querySelector("#dataTable thead");
  if (!thead) return 25;
  const theadBottom  = thead.getBoundingClientRect().bottom;
  const botBarHeight = document.getElementById("paginationTop").offsetHeight || 36;
  const rowHeight    = _rowHeight || 37;
  const available    = window.innerHeight - theadBottom - botBarHeight - 8;
  return Math.max(5, Math.floor(available / rowHeight));
}

// EN: Build pagination bar HTML without binding events (shared by probe and final render)
// TR: Olay bağlamadan pagination bar HTML'i oluştur (probe ve son render paylaşır)
function buildBarHtml(suffix, atFirst, atLast, cp, totalPages, totalRows, autoLabel) {
  return `
    <span class="pg-label">${i18n("pagingRowsLabel")}</span>
    <select id="pageSizeSelect${suffix}">
      ${PAGE_SIZE_OPTIONS.map(s => {
        const label = s === 0 ? i18n("pagingAll") : s === -1 ? autoLabel : s;
        return `<option value="${s}" ${s === pageSize ? "selected" : ""}>${label}</option>`;
      }).join("")}
    </select>
    <button class="pg-btn" id="pgFirst${suffix}" ${atFirst ? "disabled" : ""}>«</button>
    <button class="pg-btn" id="pgPrev${suffix}"  ${atFirst ? "disabled" : ""}>‹</button>
    <span class="pg-info">${i18n("pagingInfo", [cp + 1, totalPages])}</span>
    <button class="pg-btn" id="pgNext${suffix}" ${atLast ? "disabled" : ""}>›</button>
    <button class="pg-btn" id="pgLast${suffix}" ${atLast ? "disabled" : ""}>»</button>
    <span class="pg-total">(${totalRows})</span>
  `;
}

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
  // EN: If the Stats view is currently active, refresh its cards too | TR: Stats görünümü aktifse kartları da yenile
  const statsView = document.getElementById("statsView");
  if (statsView && statsView.style.display !== "none") renderStats();
  document.getElementById("refreshTime").textContent =
    i18n("lastUpdated") + new Date().toLocaleTimeString();
}

// ─── Summary cards ────────────────────────────────────────────────────────────

function renderSummary() {
  // EN: T0-T3 counts reflect only LIVE tabs (the tab is actually open in the browser).
  //     Closed-but-not-T4 records (their tab was closed but we kept the record) are tallied
  //     into a separate `closedCount` so the per-tier numbers stay honest. T4 archives are
  //     always counted under T4.
  // TR: T0-T3 sayıları yalnızca CANLI sekmeleri yansıtır (sekme tarayıcıda gerçekten açık).
  //     Kapalı-ama-T4-olmayan kayıtlar (sekme kapatıldı ama kayıt tutuldu) ayrı `closedCount`'a
  //     toplanır, böylece tier başına sayılar dürüst kalır. T4 arşivler her zaman T4 altında sayılır.
  const counts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  let staleNull = 0;
  let closedCount = 0;

  for (const r of allRecords) {
    if (r.currentTier === 4) {
      counts[4]++;
    } else if (openTabIds.has(r.tabId)) {
      counts[r.currentTier] = (counts[r.currentTier] || 0) + 1;
    } else {
      closedCount++;
    }
    // EN: Stale: lastFocusEnd=null but not actually active | TR: Stale: aktif görünüyor ama gerçekte aktif değil
    if (r.lastFocusEnd === null && !activeTabIds.has(r.tabId)) staleNull++;
  }

  const warnings = [];
  if (staleNull > 0) warnings.push(i18n("staleWarning", [staleNull]));

  const rows = [
    [i18n("sumTotal"), allRecords.length],
    [TIER_LABELS[0], counts[0]],
    [TIER_LABELS[1], counts[1]],
    [TIER_LABELS[2], counts[2]],
    [TIER_LABELS[3], counts[3]],
    [TIER_LABELS[4], counts[4]],
    ...(closedCount > 0 ? [[i18n("sumClosedLabel"), closedCount]] : []),
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

  // EN: Resolve effective page size: -1 = auto-fit, 0 = all.
  //     For auto mode, pre-render the top bar first so its height is measurable,
  //     then use that height in calcAutoPageSize — ensures consistent results every render.
  // TR: Etkin sayfa boyutunu belirle: -1 = otomatik, 0 = tümü.
  //     Otomatik modda üst barı önce render et, yüksekliğini ölç, calcAutoPageSize'a geçir.
  const resolvedSize = pageSize === -1 ? calcAutoPageSize() : pageSize;

  // EN: Clamp currentPage so it stays valid after filter/data changes
  // TR: currentPage'i filtre/veri değişimlerinde geçerli aralıkta tut
  const effectiveSize = resolvedSize === 0 ? totalRows : resolvedSize;
  const totalPages = effectiveSize > 0 ? Math.ceil(totalRows / effectiveSize) : 1;
  if (currentPage >= totalPages) currentPage = Math.max(0, totalPages - 1);

  // EN: Slice to current page | TR: Geçerli sayfaya dilimleme
  if (resolvedSize > 0) rows = rows.slice(currentPage * resolvedSize, (currentPage + 1) * resolvedSize);

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

  // EN: Open-archived links — delete old record, open URL as new T1 tab. Use event
  //     delegation on tbody so handlers survive re-renders, and log errors so a
  //     silent failure (e.g. background rejecting chrome.tabs.create) is visible.
  // TR: Arşiv/kapalı linkleri — eski kaydı sil, URL'yi yeni T1 tab olarak aç. Event
  //     delegation tbody üzerinde — render sonrası kaybolmaz; hatalar console'a
  //     basılır (sessiz hatalar görünür olsun).
  const tbodyEl = document.getElementById("tableBody");
  if (tbodyEl && !tbodyEl._openArchivedBound) {
    tbodyEl._openArchivedBound = true;
    tbodyEl.addEventListener("click", async (e) => {
      const a = e.target.closest("a.open-archived");
      if (!a) return;
      e.preventDefault();
      const { url, key } = a.dataset;
      if (!url) {
        console.warn("[TabTier] open-archived clicked but data-url empty", { key });
        return;
      }
      try {
        const res = await chrome.runtime.sendMessage({ type: "OPEN_AS_T1", url, oldKey: key });
        if (!res?.ok) console.error("[TabTier] OPEN_AS_T1 failed:", res?.error, { url, key });
      } catch (err) {
        console.error("[TabTier] OPEN_AS_T1 threw:", err, { url, key });
      }
    });
  }

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

  // EN: Two-pass auto-fit: after the first tbody render, measure actual row height from
  //     a live TR and re-render once so the count reflects real pixel dimensions.
  //     The flag prevents an infinite re-render loop.
  // TR: İki geçişli otomatik uyum: ilk tbody render'ından sonra gerçek satır yüksekliğini
  //     ölç, doğru sayı için bir kez yeniden render et. Bayrak sonsuz döngüyü önler.
  if (pageSize === -1 && !_rowHeight) {
    const firstRow = document.querySelector("#tableBody tr");
    if (firstRow && firstRow.offsetHeight > 0) {
      _rowHeight = firstRow.offsetHeight;
      renderTable();
      return;
    }
  }

  renderPagination(totalRows, resolvedSize);
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function renderPagination(totalRows, resolvedSize) {
  const effectiveSize = resolvedSize === 0 ? totalRows : resolvedSize;
  const totalPages = effectiveSize > 0 ? Math.ceil(totalRows / effectiveSize) : 1;
  const atFirst   = currentPage === 0;
  const atLast    = currentPage >= totalPages - 1;
  // EN: Auto label shows the calculated row count so user knows what "Auto" resolved to
  // TR: Otomatik etiketi hesaplanan satır sayısını gösterir
  const autoLabel = pageSize === -1
    ? `${i18n("pagingAuto")} (${resolvedSize})`
    : i18n("pagingAuto");

  document.getElementById("paginationTop").innerHTML =
    buildBarHtml("T", atFirst, atLast, currentPage, totalPages, totalRows, autoLabel);
  document.getElementById("pagination").innerHTML =
    buildBarHtml("B", atFirst, atLast, currentPage, totalPages, totalRows, autoLabel);

  for (const suffix of ["T", "B"]) {
    document.getElementById(`pageSizeSelect${suffix}`).addEventListener("change", (e) => {
      pageSize = parseInt(e.target.value);
      currentPage = 0;
      renderTable();
    });
    document.getElementById(`pgFirst${suffix}`).addEventListener("click", () => { currentPage = 0; renderTable(); });
    document.getElementById(`pgPrev${suffix}`).addEventListener("click",  () => { if (currentPage > 0) { currentPage--; renderTable(); } });
    document.getElementById(`pgNext${suffix}`).addEventListener("click",  () => { if (currentPage < totalPages - 1) { currentPage++; renderTable(); } });
    document.getElementById(`pgLast${suffix}`).addEventListener("click",  () => { currentPage = totalPages - 1; renderTable(); });
  }
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
  // EN: The result panel was occupying vertical space above the table; closing it gives the table
  //     more room. Re-render so Auto pagination recomputes rows-per-page for the new viewport.
  // TR: Sonuç paneli tablonun üstünde dikey alan kaplıyordu; kapanınca tabloya daha fazla yer
  //     açılır. Auto sayfalama yeni alana göre satır sayısını yeniden hesaplasın diye yeniden render et.
  if (pageSize === -1) renderTable();
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

// EN: Re-render on resize when auto mode is active so row count stays fitted to viewport
// TR: Otomatik mod aktifken pencere yeniden boyutlandırılırsa satır sayısını yeniden hesapla
window.addEventListener("resize", () => {
  if (pageSize === -1) renderTable();
});

// ─── View tabs (Records / Stats) ─────────────────────────────────────────────

// EN: Toggle between the Records table view and the Statistics view. Stats
//     are rendered on demand each time the user switches in (cheap — pure
//     in-memory aggregation over allRecords).
// TR: Kayıtlar tablosu ile İstatistikler görünümü arasında geçiş. Stats her
//     görüntülemede yeniden hesaplanır (ucuz — allRecords üzerinde saf bellek
//     içi toplama).
document.querySelectorAll(".view-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    const view = btn.dataset.view;
    document.querySelectorAll(".view-tab").forEach((b) => b.classList.toggle("active", b === btn));
    document.getElementById("recordsView").style.display = view === "records" ? "" : "none";
    document.getElementById("statsView").style.display   = view === "stats"   ? "" : "none";
    if (view === "stats") {
      applyStatsCardOrder();
      bindStatsCardDragDrop();
      bindBarLabelResize();
      renderStats();
    }
  });
});

// =============================================================================
// EN: Drag-and-drop reordering for Statistics cards.
//     Each .stat-card has a data-card-id; on drop, the new order is saved to
//     settings.statsCardOrder. applyStatsCardOrder() reads the saved order and
//     re-appends children of #statsGrid accordingly. Cards that aren't in the
//     saved order (e.g. new ones added in a future release) are appended at the
//     end so they're discoverable.
// TR: İstatistik kartları için sürükle-bırak yeniden sıralama.
//     Her .stat-card'da data-card-id var; bırakınca yeni sıra
//     settings.statsCardOrder'a kaydedilir. applyStatsCardOrder() kaydedilmiş
//     sırayı okuyup #statsGrid çocuklarını ona göre yeniden ekler. Kaydedilmiş
//     sırada olmayan kartlar (gelecekte eklenenler) sona eklenir ki kaybolmasın.
// =============================================================================
const DEFAULT_STATS_CARD_ORDER = [
  "tier-donut",
  "active-ratio",
  "top-domains",
  "longest-lived",
  "focus-time",
  "url-focus-time",
  "hourly",
  "daily",
];

// EN: Default per-card width in quarters (1=¼, 2=½, 3=¾, 4=full). Donut + ratio pair as ½ each
//     so they share a row out of the box; everything else starts full-width.
// TR: Çeyrek bazlı varsayılan kart genişliği (1=¼, 2=½, 3=¾, 4=tam). Donut + ratio çift olarak
//     ½'şer başlar (aynı satırı paylaşırlar); geri kalan tam genişlik.
const DEFAULT_STATS_CARD_WIDTHS = {
  "tier-donut":     2,
  "active-ratio":   2,
  "top-domains":    4,
  "longest-lived":  4,
  "focus-time":     4,
  "url-focus-time": 4,
  "hourly":         4,
  "daily":          4,
};

async function applyStatsCardOrder() {
  const grid = document.getElementById("statsGrid");
  if (!grid) return;
  const { settings = {} } = await chrome.storage.local.get("settings");
  const saved = Array.isArray(settings.statsCardOrder) && settings.statsCardOrder.length
    ? settings.statsCardOrder
    : DEFAULT_STATS_CARD_ORDER;
  const cards = Array.from(grid.querySelectorAll(".stat-card[data-card-id]"));
  const byId = new Map(cards.map((c) => [c.dataset.cardId, c]));
  // EN: Append in saved order; any card not in saved list (added in a later release) goes after | TR: Kayıtlı sırada ekle; listede olmayan (sonraki sürümde eklenmiş) kart sona gider
  for (const id of saved) {
    const c = byId.get(id);
    if (c) { grid.appendChild(c); byId.delete(id); }
  }
  for (const [, c] of byId) grid.appendChild(c);

  // EN: Apply per-card width from settings (or defaults) and reflect active state on the selector buttons.
  // TR: Her kartın genişliğini ayardan (veya default'tan) uygula; selector butonlarında aktif durumu yansıt.
  const widths = (settings.statsCardWidths && typeof settings.statsCardWidths === "object")
    ? settings.statsCardWidths
    : {};
  for (const card of cards) {
    const id = card.dataset.cardId;
    const w = String(widths[id] ?? DEFAULT_STATS_CARD_WIDTHS[id] ?? 4);
    card.setAttribute("data-width", w);
    card.querySelectorAll(".width-selector button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.w === w);
    });
  }
}

async function saveStatsCardWidth(cardId, width) {
  const { settings = {} } = await chrome.storage.local.get("settings");
  const next = { ...(settings.statsCardWidths || {}), [cardId]: width };
  await chrome.storage.local.set({ settings: { ...settings, statsCardWidths: next } });
}

// EN: User-resizable label column for bar charts, PER CARD. Mouse-drag on any `.bar-resize`
//     handle updates `--bar-label-width` on its parent `.stat-card` only — other cards keep
//     their own width. Persisted in `settings.statsBarLabelWidths` as { cardId: px }.
//     Range clamped to [80, 480] pixels so it can't disappear or eat the whole card.
// TR: Bar grafiklerinde KART BAZINDA kullanıcı tarafından genişletilebilir etiket sütunu.
//     `.bar-resize` tutamacında mouse sürükleme yalnızca **kendi** `.stat-card`'ının
//     `--bar-label-width`'ini günceller — diğer kartlar kendi genişliklerini korur.
//     `settings.statsBarLabelWidths` içinde { cardId: px } olarak kaydedilir. [80, 480] aralığı.
let _barResize = null; // EN: { startX, startWidth, card } | TR: { startX, startWidth, card }

async function bindBarLabelResize() {
  const grid = document.getElementById("statsGrid");
  if (!grid) return;

  // EN: Apply saved per-card widths on every (re)bind so a fresh stats-view open picks them up.
  // TR: Her (yeniden) bağlamada kayıtlı kart-başına genişlikleri uygula; stats yeniden açıldığında değerler gelir.
  try {
    const { settings = {} } = await chrome.storage.local.get("settings");
    const widths = (settings.statsBarLabelWidths && typeof settings.statsBarLabelWidths === "object")
      ? settings.statsBarLabelWidths
      : {};
    for (const card of grid.querySelectorAll(".stat-card[data-card-id]")) {
      const id = card.dataset.cardId;
      const w = widths[id];
      if (typeof w === "number" && w >= 80 && w <= 480) {
        card.style.setProperty("--bar-label-width", w + "px");
      } else {
        card.style.removeProperty("--bar-label-width");
      }
    }
  } catch (_) {}

  if (grid._barResizeBound) return;
  grid._barResizeBound = true;

  grid.addEventListener("mousedown", (e) => {
    const handle = e.target.closest(".bar-resize");
    if (!handle) return;
    const card = handle.closest(".stat-card[data-card-id]");
    if (!card) return;
    const cs = getComputedStyle(card);
    const cur = parseInt(cs.getPropertyValue("--bar-label-width")) || 180;
    _barResize = { startX: e.clientX, startWidth: cur, card };
    document.body.classList.add("bar-resizing");
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!_barResize) return;
    const delta = e.clientX - _barResize.startX;
    const next = Math.max(80, Math.min(480, _barResize.startWidth + delta));
    _barResize.card.style.setProperty("--bar-label-width", next + "px");
  });

  document.addEventListener("mouseup", async () => {
    if (!_barResize) return;
    const cs = getComputedStyle(_barResize.card);
    const finalW = parseInt(cs.getPropertyValue("--bar-label-width")) || 180;
    const cardId = _barResize.card.dataset.cardId;
    _barResize = null;
    document.body.classList.remove("bar-resizing");
    try {
      const { settings = {} } = await chrome.storage.local.get("settings");
      const widths = { ...(settings.statsBarLabelWidths || {}), [cardId]: finalW };
      await chrome.storage.local.set({ settings: { ...settings, statsBarLabelWidths: widths } });
    } catch (_) {}
  });
}

async function saveStatsCardOrder() {
  const grid = document.getElementById("statsGrid");
  if (!grid) return;
  const order = Array.from(grid.querySelectorAll(".stat-card[data-card-id]"))
    .map((c) => c.dataset.cardId);
  const { settings = {} } = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({ settings: { ...settings, statsCardOrder: order } });
}

let _statsDragBound = false;
function bindStatsCardDragDrop() {
  const grid = document.getElementById("statsGrid");
  if (!grid || _statsDragBound) return;
  _statsDragBound = true;

  let dragged = null;

  grid.querySelectorAll(".stat-card[data-card-id]").forEach((card) => {
    card.setAttribute("draggable", "true");

    card.addEventListener("dragstart", (e) => {
      dragged = card;
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", card.dataset.cardId); } catch (_) {}
    });

    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      grid.querySelectorAll(".drag-over-top, .drag-over-bottom").forEach((c) => {
        c.classList.remove("drag-over-top", "drag-over-bottom");
      });
      dragged = null;
      saveStatsCardOrder().catch(() => {});
    });

    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (!dragged || dragged === card) return;
      const rect = card.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      // Clear other indicators first
      grid.querySelectorAll(".drag-over-top, .drag-over-bottom").forEach((c) => {
        if (c !== card) c.classList.remove("drag-over-top", "drag-over-bottom");
      });
      card.classList.toggle("drag-over-top", before);
      card.classList.toggle("drag-over-bottom", !before);
    });

    card.addEventListener("dragleave", () => {
      card.classList.remove("drag-over-top", "drag-over-bottom");
    });

    card.addEventListener("drop", (e) => {
      e.preventDefault();
      if (!dragged || dragged === card) return;
      const rect = card.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      if (before) grid.insertBefore(dragged, card);
      else grid.insertBefore(dragged, card.nextSibling);
      card.classList.remove("drag-over-top", "drag-over-bottom");
    });
  });

  // EN: Width selector buttons (¼ / ½ / ¾ / 1) per card | TR: Kart başına genişlik seçici (¼ / ½ / ¾ / 1)
  grid.querySelectorAll(".width-selector").forEach((sel) => {
    if (sel._bound) return;
    sel._bound = true;
    sel.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-w]");
      if (!btn) return;
      const card = sel.closest(".stat-card[data-card-id]");
      if (!card) return;
      const w = btn.dataset.w;
      card.setAttribute("data-width", w);
      sel.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
      saveStatsCardWidth(card.dataset.cardId, parseInt(w, 10)).catch(() => {});
    });
  });

  // EN: Reset order button — also clears per-card widths AND the bar-label resize so user returns to true defaults | TR: Sıfırla butonu — kart genişliklerini ve bar etiket genişliğini de temizler, gerçek default'a döner
  const resetBtn = document.getElementById("statsResetOrderBtn");
  if (resetBtn && !resetBtn._bound) {
    resetBtn._bound = true;
    resetBtn.addEventListener("click", async () => {
      const { settings = {} } = await chrome.storage.local.get("settings");
      await chrome.storage.local.set({
        settings: { ...settings, statsCardOrder: [], statsCardWidths: {}, statsBarLabelWidths: {} },
      });
      const grid = document.getElementById("statsGrid");
      if (grid) {
        for (const card of grid.querySelectorAll(".stat-card[data-card-id]")) {
          card.style.removeProperty("--bar-label-width");
        }
      }
      await applyStatsCardOrder();
    });
  }
}

// EN: Render all stats cards. The first four use the in-memory allRecords
//     snapshot (synchronous). The last three pull from the persistent
//     `statsAggregate` storage key (asynchronous, populated by background.js).
// TR: Tüm istatistik kartlarını render et. İlk dördü bellekteki allRecords
//     anlık görüntüsünü kullanır (senkron). Son üçü kalıcı `statsAggregate`
//     storage anahtarından çekilir (asenkron, background.js tarafından doldurulur).
async function renderStats() {
  // EN: Rebuild favicon lookup tables from the current allRecords snapshot so bar-chart
  //     labels can prepend the matching site icon. First record per domain / per URL wins.
  // TR: Bar grafik etiketlerine site ikonu eklenebilsin diye mevcut allRecords'tan favicon
  //     lookup tablolarını yeniden kur. Domain / URL başına ilk kayıt kazanır.
  rebuildFaviconMaps();

  // EN: Distribution-style cards (tier donut, active/archived ratio, longest-lived) include only
  //     records that reflect the live browser state — open tabs + T4 archives. Closed-but-not-T4
  //     records are user history; counting them as "in T1/T2/T3" would over-report tabs that
  //     don't consume any resources. Top Domains stays on the full list because per-domain
  //     browsing history is meaningful regardless of whether the tab is currently open.
  // TR: Dağılım kartları (tier donut, aktif/arşiv oranı, en uzun yaşayan) yalnızca canlı tarayıcı
  //     durumunu yansıtan kayıtları sayar — açık sekmeler + T4 arşivleri. Kapalı-ama-T4-olmayan
  //     kayıtlar kullanıcı geçmişi; bunları "T1/T2/T3'te" saymak kaynak kullanmayan sekmeleri abartır.
  //     Top Domain'ler tam listede kalır çünkü domain bazlı geçmiş, sekme açık olsun olmasın anlamlı.
  const liveRecords = allRecords.filter(
    (r) => r.currentTier === 4 || openTabIds.has(r.tabId)
  );
  const total = liveRecords.length;
  const tierCounts = [0, 0, 0, 0, 0];
  const domainCounts = new Map();

  for (const r of liveRecords) {
    const t = Number.isInteger(r.currentTier) ? r.currentTier : 1;
    if (t >= 0 && t <= 4) tierCounts[t]++;
  }
  // Top Domains over the full record set (history)
  for (const r of allRecords) {
    const d = (r.domain || "—").trim() || "—";
    domainCounts.set(d, (domainCounts.get(d) || 0) + 1);
  }

  renderTierDonut(tierCounts, total);
  renderActiveRatio(tierCounts, total);
  const domainSorted = [...domainCounts.entries()].sort((a, b) => b[1] - a[1]);
  const domainTotal = domainSorted.reduce((s, [, c]) => s + c, 0);
  renderTopDomains(domainSorted.slice(0, 10), domainTotal);
  renderOldestTabs([...liveRecords].filter((r) => r.createdAt).sort((a, b) => a.createdAt - b.createdAt).slice(0, 8));

  // EN: Aggregate-driven cards — read once and pass to each renderer | TR: Toplam veri kartları — bir kez oku ve her renderer'a aktar
  try {
    const { statsAggregate = null } = await chrome.storage.local.get("statsAggregate");
    const agg = statsAggregate || { domainFocusMs: {}, urlFocusMs: {}, hourlyActivity: new Array(24).fill(0), daily: {} };
    _statsAggCache = agg; // EN: cache for range-button re-renders without re-fetching | TR: range butonlarının yeniden render'ı için cache
    renderFocusTime(_focusRange.domain, agg);
    renderUrlFocusTime(_focusRange.url, agg);
    renderHourlyActivity(Array.isArray(agg.hourlyActivity) ? agg.hourlyActivity : new Array(24).fill(0));
    renderDailyActivity(agg.daily || {});
    bindRangeButtons();
  } catch (e) {
    console.error("[TabTier] renderStats aggregate read failed:", e);
  }
}

// EN: Cached aggregate so range buttons can re-render without another storage read | TR: Range butonları yeniden render için aggregate cache'i
let _statsAggCache = null;
// EN: Domain→favicon and url(normalized)→favicon maps built from allRecords. Used to prepend
//     favicons in bar-chart labels. Only stored favicons (no 3rd-party services for privacy).
// TR: allRecords'tan üretilen domain→favicon ve normalize-url→favicon haritaları. Bar grafiği
//     etiketlerine favicon eklemek için. Gizlilik açısından yalnızca saklanan favicon'lar (3.
//     parti servis çağrısı yok).
let _faviconByDomain = new Map();
let _faviconByUrl = new Map();

function rebuildFaviconMaps() {
  _faviconByDomain = new Map();
  _faviconByUrl = new Map();
  for (const r of allRecords) {
    const fav = (r.favicon || "").trim();
    if (!fav) continue;
    const d = (r.domain || "").trim();
    if (d && !_faviconByDomain.has(d)) _faviconByDomain.set(d, fav);
    // EN: Normalize URL the same way background.js does for stats keys | TR: URL'yi background.js'in stat anahtarlarıyla aynı normalize et
    let urlKey = "";
    if (r.url) {
      try {
        const u = new URL(r.url);
        urlKey = u.protocol + "//" + u.host + u.pathname;
      } catch (_) { urlKey = r.url; }
    }
    if (urlKey && !_faviconByUrl.has(urlKey)) _faviconByUrl.set(urlKey, fav);
  }
}

// EN: Build the HTML for a bar-label: optional favicon img + text span with ellipsis.
// TR: Bar etiketi HTML'i: opsiyonel favicon img + ellipsis'li metin span.
function barLabelInner(text, faviconUrl) {
  const safeText = escHtml(text);
  if (faviconUrl) {
    return `<img class="bar-favicon" src="${escHtml(faviconUrl)}" width="14" height="14" alt=""><span class="bar-label-text">${safeText}</span>`;
  }
  return `<span class="bar-label-text">${safeText}</span>`;
}

// EN: Hide bar favicons that fail to load — keeps the row from showing a broken-image
//     placeholder in the 14×14 slot. Call right after innerHTML is set on the host.
// TR: Yüklenemeyen bar favicon'ları gizle — 14×14 alanda bozuk-görsel placeholder
//     çıkmasın. innerHTML set edildikten hemen sonra çağrılır.
function hideBrokenFavicons(host) {
  host.querySelectorAll(".bar-favicon").forEach((img) => {
    img.addEventListener("error", () => { img.style.display = "none"; });
  });
}
// EN: Per-card range selection (all / 7d / 1d). Persists in-memory while Stats view is open. | TR: Kart başına range seçimi (all / 7d / 1d)
const _focusRange = { domain: "all", url: "all" };

// EN: Sum focus time per key across the last N daily buckets. Used for 7d / 1d filters.
// TR: Son N günlük bucket boyunca anahtar başına odak süresini topla. 7g / 1g filtreleri için.
function sumDailyFocus(daily, field /* "domainFocusMs" | "urlFocusMs" */, days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffKey =
    `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
  const out = {};
  for (const [day, bucket] of Object.entries(daily)) {
    if (day < cutoffKey) continue;
    const map = bucket[field] || {};
    for (const [k, v] of Object.entries(map)) {
      out[k] = (out[k] || 0) + v;
    }
  }
  return out;
}

function pickFocusMap(agg, kind /* "domain" | "url" */, range /* "all" | "7d" | "1d" */) {
  if (range === "all") {
    return kind === "domain" ? (agg.domainFocusMs || {}) : (agg.urlFocusMs || {});
  }
  const days = range === "7d" ? 7 : 1;
  return sumDailyFocus(agg.daily || {}, kind === "domain" ? "domainFocusMs" : "urlFocusMs", days);
}

function bindRangeButtons() {
  document.querySelectorAll(".stat-range").forEach((wrap) => {
    if (wrap._bound) return;
    wrap._bound = true;
    wrap.addEventListener("click", (e) => {
      const btn = e.target.closest(".range-btn");
      if (!btn) return;
      const range = btn.dataset.range;
      const targetId = wrap.dataset.target;
      wrap.querySelectorAll(".range-btn").forEach((b) => b.classList.toggle("active", b === btn));
      if (!_statsAggCache) return;
      if (targetId === "statsFocusTime") {
        _focusRange.domain = range;
        renderFocusTime(range, _statsAggCache);
      } else if (targetId === "statsUrlFocusTime") {
        _focusRange.url = range;
        renderUrlFocusTime(range, _statsAggCache);
      }
    });
  });
}

// EN: Tier color palette — keep aligned with tier-badge classes in CSS.
// TR: Tier renk paleti — CSS'deki tier-badge sınıflarıyla aynı kalmalı.
const TIER_COLORS = {
  0: "var(--blue)",
  1: "var(--yellow)",
  2: "var(--green)",
  3: "var(--accent)",
  4: "var(--overlay)",
};

function renderTierDonut(counts, total) {
  const host = document.getElementById("statsTierDonut");
  if (total === 0) {
    host.innerHTML = `<p class="stats-empty">${i18n("noRecords")}</p>`;
    return;
  }
  // EN: Stack stroke-dasharray segments on a single circle path | TR: Tek bir circle üzerinde stroke-dasharray segmentlerini üst üste bindir
  const C = 2 * Math.PI * 40;
  let cumOffset = 0;
  let segments = "";
  for (let t = 0; t <= 4; t++) {
    if (counts[t] === 0) continue;
    const segLen = (counts[t] / total) * C;
    segments += `<circle r="40" cx="50" cy="50" fill="transparent" stroke="${TIER_COLORS[t]}" stroke-width="14" stroke-dasharray="${segLen} ${C - segLen}" stroke-dashoffset="${-cumOffset}" transform="rotate(-90 50 50)"/>`;
    cumOffset += segLen;
  }

  let legend = "";
  for (let t = 0; t <= 4; t++) {
    if (counts[t] === 0) continue;
    const pct = Math.round((counts[t] / total) * 100);
    legend += `
      <div class="donut-legend-item">
        <span class="donut-legend-color" style="background:${TIER_COLORS[t]}"></span>
        <span class="donut-legend-name">${escHtml(TIER_LABELS[t] || `T${t}`)}</span>
        <span class="donut-legend-count">${counts[t]}<span class="donut-legend-pct">(${pct}%)</span></span>
      </div>`;
  }

  host.innerHTML = `
    <div class="donut-wrap">
      <svg class="donut-svg" viewBox="0 0 100 100">
        ${segments}
        <text x="50" y="50" class="donut-center">${total}</text>
      </svg>
      <div class="donut-legend">${legend}</div>
    </div>`;
}

function renderActiveRatio(counts, total) {
  const archived = counts[4] || 0;
  const active = total - archived;
  const activePct = total > 0 ? Math.round((active / total) * 100) : 0;
  const archivedPct = total > 0 ? Math.round((archived / total) * 100) : 0;
  document.getElementById("statsActiveRatio").innerHTML = `
    <div class="ratio-grid">
      <div class="ratio-cell">
        <div class="ratio-num">${active}</div>
        <div class="ratio-label">${escHtml(i18n("statsActive"))}</div>
        <div class="ratio-pct">${activePct}%</div>
      </div>
      <div class="ratio-cell">
        <div class="ratio-num" style="color:var(--overlay)">${archived}</div>
        <div class="ratio-label">${escHtml(i18n("statsArchived"))}</div>
        <div class="ratio-pct">${archivedPct}%</div>
      </div>
    </div>`;
}

function renderTopDomains(sorted, total) {
  const host = document.getElementById("statsTopDomains");
  if (!sorted.length) {
    host.innerHTML = `<p class="stats-empty">${i18n("noRecords")}</p>`;
    return;
  }
  const max = sorted[0][1];
  host.innerHTML = sorted
    .map(([d, c]) => {
      const pct = total > 0 ? Math.round((c / total) * 100) : 0;
      const fav = _faviconByDomain.get(d);
      return `
      <div class="bar-row">
        <span class="bar-label" title="${escHtml(d)}">${barLabelInner(d, fav)}</span>
        <span class="bar-resize" title="${escHtml(i18n("resizeBarLabelTitle"))}"></span>
        <div class="bar-track">
          <div class="bar-fill" style="width:${Math.max(2, (c / max) * 100)}%"></div>
        </div>
        <span class="bar-count">${c}<span class="bar-pct">${pct}%</span></span>
      </div>`;
    })
    .join("");
  hideBrokenFavicons(host);
}

// EN: Format an age-in-ms as "Nd Hh" or "Hh Mm" using localized unit tokens.
// TR: ms cinsinden yaşı yerelleştirilmiş birim tokenlarıyla "Ng Hs" veya "Hs Md" olarak biçimlendir.
function fmtAge(ms) {
  if (!ms || ms < 0) return "—";
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (days >= 1) return i18n("statsAgeDays", [String(days), String(hours)]);
  return i18n("statsAgeHours", [String(hours), String(mins)]);
}

function renderOldestTabs(oldest) {
  const host = document.getElementById("statsOldest");
  if (!oldest.length) {
    host.innerHTML = `<p class="stats-empty">${i18n("noRecords")}</p>`;
    return;
  }
  const now = Date.now();
  host.innerHTML = oldest
    .map((r) => {
      const tier = r.currentTier ?? 1;
      const label = TIER_LABELS[tier] || `T${tier}`;
      return `
        <div class="oldest-row">
          <span class="oldest-tier-badge tier-badge tier-${tier}">${escHtml(label)}</span>
          <span class="oldest-domain" title="${escHtml(r.url || "")}">${escHtml(r.domain || "—")}</span>
          <span class="oldest-age">${escHtml(fmtAge(now - r.createdAt))}</span>
        </div>`;
    })
    .join("");
}

// EN: Format milliseconds as "Xh Ym" or "Ym Zs"; <1s → "<1s".
// TR: Milisaniyeyi "Xs Yd" veya "Yd Zsn" olarak biçimlendir; <1sn → "<1sn".
function fmtFocusMs(ms) {
  if (!ms || ms < 0) return "—";
  const sAbbr = i18n("unitAbbrSec");
  const mAbbr = i18n("unitAbbrMin");
  const hAbbr = i18n("unitAbbrHour");
  if (ms < 1000) return "<1" + sAbbr;
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hours > 0) return `${hours}${hAbbr} ${mins}${mAbbr}`;
  if (mins > 0)  return `${mins}${mAbbr} ${secs}${sAbbr}`;
  return `${secs}${sAbbr}`;
}

function renderFocusTime(range, agg) {
  const host = document.getElementById("statsFocusTime");
  const map = pickFocusMap(agg, "domain", range);
  const all = Object.entries(map).sort((a, b) => b[1] - a[1]);
  const total = all.reduce((s, [, ms]) => s + ms, 0);
  const entries = all.slice(0, 10);
  if (!entries.length) {
    host.innerHTML = `<p class="stats-empty">${i18n("statsCollectingData")}</p>`;
    return;
  }
  const max = entries[0][1];
  host.innerHTML = entries
    .map(([d, ms]) => {
      const pct = total > 0 ? Math.round((ms / total) * 100) : 0;
      const fav = _faviconByDomain.get(d);
      return `
      <div class="bar-row">
        <span class="bar-label" title="${escHtml(d)}">${barLabelInner(d, fav)}</span>
        <span class="bar-resize" title="${escHtml(i18n("resizeBarLabelTitle"))}"></span>
        <div class="bar-track">
          <div class="bar-fill" style="width:${Math.max(2, (ms / max) * 100)}%; background:var(--green)"></div>
        </div>
        <span class="focus-bar-time">${escHtml(fmtFocusMs(ms))}<span class="bar-pct">${pct}%</span></span>
      </div>`;
    })
    .join("");
  hideBrokenFavicons(host);
}

// EN: Per-URL focus time (top 10) — mirrors renderFocusTime but with URLs as labels.
//     URLs are normalized server-side (protocol + host + path, no query/hash).
// TR: URL bazlı odak süresi (ilk 10) — renderFocusTime ile aynı yapı ama etiket URL.
//     URL'ler arka tarafta normalize edilir (protocol + host + path, query/hash yok).
function renderUrlFocusTime(range, agg) {
  const host = document.getElementById("statsUrlFocusTime");
  const map = pickFocusMap(agg, "url", range);
  const all = Object.entries(map).sort((a, b) => b[1] - a[1]);
  const total = all.reduce((s, [, ms]) => s + ms, 0);
  const entries = all.slice(0, 10);
  if (!entries.length) {
    host.innerHTML = `<p class="stats-empty">${i18n("statsCollectingData")}</p>`;
    return;
  }
  const max = entries[0][1];
  host.innerHTML = entries
    .map(([u, ms]) => {
      const pct = total > 0 ? Math.round((ms / total) * 100) : 0;
      const fav = _faviconByUrl.get(u);
      return `
      <div class="bar-row">
        <span class="bar-label" title="${escHtml(u)}">${barLabelInner(u, fav)}</span>
        <span class="bar-resize" title="${escHtml(i18n("resizeBarLabelTitle"))}"></span>
        <div class="bar-track">
          <div class="bar-fill" style="width:${Math.max(2, (ms / max) * 100)}%; background:var(--blue)"></div>
        </div>
        <span class="focus-bar-time">${escHtml(fmtFocusMs(ms))}<span class="bar-pct">${pct}%</span></span>
      </div>`;
    })
    .join("");
  hideBrokenFavicons(host);
}

function renderHourlyActivity(hourly) {
  const host = document.getElementById("statsHourly");
  const total = hourly.reduce((s, n) => s + n, 0);
  if (total === 0) {
    host.innerHTML = `<p class="stats-empty">${i18n("statsCollectingData")}</p>`;
    return;
  }
  const max = Math.max(...hourly);
  const bars = hourly
    .map((n) => {
      const heightPct = max > 0 ? (n / max) * 100 : 0;
      return `<div class="hourly-bar" data-count="${n}" style="height:${heightPct}%" title="${n}"></div>`;
    })
    .join("");
  // EN: Show every 3rd hour label to keep axis readable | TR: Eksenin okunaklı kalması için her 3. saati göster
  const labels = Array.from({ length: 24 }, (_, h) => `<span>${h % 3 === 0 ? String(h).padStart(2, "0") : ""}</span>`).join("");
  host.innerHTML = `
    <div class="hourly-wrap">${bars}</div>
    <div class="hourly-axis">${labels}</div>`;
}

function renderDailyActivity(daily) {
  const host = document.getElementById("statsDaily");
  // EN: Build last-30-days array (oldest → newest), filling gaps with zero buckets | TR: Son 30 günlük dizi oluştur (eskiden yeniye), boşlukları sıfırla doldur
  const days = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const b = daily[k] || { opened: 0, archived: 0 };
    days.push({ key: k, opened: b.opened || 0, archived: b.archived || 0, day: d });
  }
  const totalEvents = days.reduce((s, d) => s + d.opened + d.archived, 0);
  if (totalEvents === 0) {
    host.innerHTML = `<p class="stats-empty">${i18n("statsCollectingData")}</p>`;
    return;
  }
  const maxStack = Math.max(...days.map((d) => d.opened + d.archived));
  const cols = days
    .map((d) => {
      const stack = d.opened + d.archived;
      const stackHeightPct = maxStack > 0 ? (stack / maxStack) * 100 : 0;
      const openedPct = stack > 0 ? (d.opened / stack) * stackHeightPct : 0;
      const archivedPct = stack > 0 ? (d.archived / stack) * stackHeightPct : 0;
      const tip = `${d.key} — ${i18n("statsDailyOpened")}: ${d.opened}, ${i18n("statsDailyArchived")}: ${d.archived}`;
      return `
        <div class="daily-col" title="${escHtml(tip)}">
          ${d.opened > 0   ? `<div class="daily-seg-opened"   style="height:${openedPct}%"></div>` : ""}
          ${d.archived > 0 ? `<div class="daily-seg-archived" style="height:${archivedPct}%"></div>` : ""}
        </div>`;
    })
    .join("");
  // EN: Axis: show day-of-month labels every 5 days | TR: Eksen: ay-içi gün etiketlerini her 5 günde bir göster
  const axis = days
    .map((d, i) => `<div>${i % 5 === 0 ? d.day.getDate() : ""}</div>`)
    .join("");
  host.innerHTML = `
    <div class="daily-wrap">${cols}</div>
    <div class="daily-axis">${axis}</div>
    <div class="stats-legend">
      <span><span class="stats-legend-dot" style="background:var(--green)"></span>${escHtml(i18n("statsDailyOpened"))}</span>
      <span><span class="stats-legend-dot" style="background:var(--red)"></span>${escHtml(i18n("statsDailyArchived"))}</span>
    </div>`;
}

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

// EN: Live tick — re-render every 30 seconds so the elapsed-time column stays fresh.
//     fmtElapsed() reads Date.now() at render time, so a re-render naturally advances counters.
//     No storage fetch — uses the in-memory allRecords cache. Cheap.
// TR: Canlı tick — 30 saniyede bir yeniden render et; elapsed-süre sütunu güncel kalsın.
//     fmtElapsed() render anında Date.now() okuyor, render edilince sayaçlar otomatik ilerliyor.
//     Storage'a gitmiyor — bellekteki allRecords önbelleğini kullanıyor. Ucuz.
setInterval(() => {
  if (!allRecords || allRecords.length === 0) return;
  if (document.hidden) return; // EN: Skip when the tab is in the background | TR: Sekme arka plandayken atla
  renderTable();
  const refreshEl = document.getElementById("refreshTime");
  if (refreshEl) {
    refreshEl.textContent = i18n("lastUpdated") + new Date().toLocaleTimeString();
  }
}, 30 * 1000);
