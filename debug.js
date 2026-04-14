// =============================================================================
// TabTier — debug.js
// =============================================================================

// Seçili T4 kayıtlarının storage key'leri (string tabId)
let selectedKeys = new Set();

const TIER_LABELS = {
  0: "T0 Sabit",
  1: "T1 Sıcak",
  2: "T2 Ilık",
  3: "T3 Soğuk",
  4: "T4 Arşiv",
};

let allRecords  = [];
let openTabIds  = new Set(); // gerçekte açık tab ID'leri
let activeTabIds = new Set(); // gerçekte aktif (focused) tab ID'leri
let sortCol = "currentTier";
let sortDir = 1; // 1 = asc, -1 = desc
let filterText = "";

// ─── Zaman Formatlama ─────────────────────────────────────────────────────

function fmtTime(ts) {
  if (ts == null) return '<span class="status-active">● Aktif</span>';
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

function fmtElapsed(lastFocusEnd) {
  if (lastFocusEnd == null) return '<span class="status-active">şu an aktif</span>';
  const ms = Date.now() - lastFocusEnd;
  if (ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}g ${h % 24}sa`;
  if (h > 0) return `${h}sa ${m % 60}dk`;
  if (m > 0) return `${m}dk ${s % 60}sn`;
  return `${s}sn`;
}

// ─── Veri Yükleme ─────────────────────────────────────────────────────────

// İç sayfa URL tespiti (background.js ile aynı mantık)
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

  openTabIds    = new Set(realTabs.map(t => t.id));
  activeTabIds  = new Set(realActive.map(t => t.id));
  internalTabCount = realTabs.filter(t => isInternal(t.url)).length;

  allRecords = Object.values(tabRecords).map(r => ({
    ...r,
    tabId: r.tabId ?? "—",
  }));

  renderSummary();
  renderTable();
  document.getElementById("refreshTime").textContent =
    "Son güncelleme: " + new Date().toLocaleTimeString("tr-TR");
}

// ─── Özet Kartları ────────────────────────────────────────────────────────

function renderSummary() {
  const counts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  let staleNull = 0;
  let missingInBrowser = 0;

  for (const r of allRecords) {
    counts[r.currentTier] = (counts[r.currentTier] || 0) + 1;
    // Stale: lastFocusEnd=null ama gerçekte aktif değil
    if (r.lastFocusEnd === null && !activeTabIds.has(r.tabId)) staleNull++;
    // Kayıtta var, browserda yok (T4 hariç)
    if (r.currentTier !== 4 && !openTabIds.has(r.tabId)) missingInBrowser++;
  }

  const warnings = [];
  if (staleNull > 0)       warnings.push(`⚠️ ${staleNull} stale aktif`);
  if (missingInBrowser > 0) warnings.push(`⚠️ ${missingInBrowser} kayıtta var/browserde yok`);

  const el = document.getElementById("summary");
  el.innerHTML = [
    ["Toplam", allRecords.length],
    ["T0 Sabit",  counts[0]],
    ["T1 Sıcak",  counts[1]],
    ["T2 Ilık",   counts[2]],
    ["T3 Soğuk",  counts[3]],
    ["T4 Arşiv",  counts[4]],
    ["İç sayfa",  `${internalTabCount} (takip dışı)`],
    ...(warnings.length ? [["Sorun", warnings.join(" · ")]] : []),
  ].map(([label, val]) =>
    `<div class="summary-item">${label}: <span>${val}</span></div>`
  ).join("");
}

// ─── Tablo Render ─────────────────────────────────────────────────────────

function getComparableValue(r, col) {
  switch (col) {
    case "tabId":          return r.tabId ?? 0;
    case "currentTier":    return r.currentTier ?? 99;
    case "domain":         return (r.domain || "").toLowerCase();
    case "title":          return (r.title || "").toLowerCase();
    case "url":            return (r.url || "").toLowerCase();
    case "lastFocusStart": return r.lastFocusStart ?? 0;
    case "lastFocusEnd":   return r.lastFocusEnd ?? Number.MAX_SAFE_INTEGER;
    case "elapsed":        return r.lastFocusEnd == null ? -1 : (Date.now() - r.lastFocusEnd);
    case "isPinned":       return r.currentTier === 0 ? 0 : 1;
    case "createdAt":      return r.createdAt ?? 0;
    case "openStatus":     return openTabIds.has(r.tabId) ? 0 : 1;
    default:               return "";
  }
}

function renderTable() {
  const filter = filterText.toLowerCase();
  let rows = allRecords.filter(r =>
    !filter ||
    (r.url    || "").toLowerCase().includes(filter) ||
    (r.domain || "").toLowerCase().includes(filter) ||
    (r.title  || "").toLowerCase().includes(filter)
  );

  rows.sort((a, b) => {
    const va = getComparableValue(a, sortCol);
    const vb = getComparableValue(b, sortCol);
    if (va < vb) return -sortDir;
    if (va > vb) return  sortDir;
    return 0;
  });

  document.getElementById("noData").style.display = rows.length === 0 ? "block" : "none";

  const tbody = document.getElementById("tableBody");
  tbody.innerHTML = rows.map(r => {
    const tier = r.currentTier ?? "?";
    const badgeClass = `tier-badge tier-${tier}`;
    const label = TIER_LABELS[tier] || `T${tier}`;

    const isOpen   = openTabIds.has(r.tabId);
    const isActive = activeTabIds.has(r.tabId);
    // Stale: kaydı aktif gösteriyor ama gerçekte aktif değil
    const isStale  = r.lastFocusEnd === null && !isActive;

    let openCell;
    if (r.currentTier === 4) {
      openCell = '<span style="color:#6c7086">arşiv</span>';
    } else if (isActive) {
      openCell = '<span class="status-active">● aktif</span>';
    } else if (isOpen) {
      openCell = '<span style="color:#a6e3a1">✓ açık</span>';
    } else {
      openCell = '<span style="color:#f38ba8">✗ yok</span>';
    }

    const rowStyle = isStale
      ? 'background: #2d1b1b;'
      : (!isOpen && tier !== 4) ? 'background: #1e1b2d;' : '';

    const key = String(r.tabId);
    const isT4 = tier === 4;
    const cbHtml = isT4
      ? `<input type="checkbox" class="row-cb" data-key="${key}" ${selectedKeys.has(key) ? "checked" : ""}>`
      : "";

    const isT0 = r.currentTier === 0;

    return `
      <tr style="${rowStyle}">
        <td class="cb-col">${cbHtml}</td>
        <td style="text-align:center">${tier !== 4
          ? `<span class="pin-toggle" data-tabid="${r.tabId}" data-tier="${tier}" style="cursor:pointer;font-size:15px" title="${isT0 ? 'T1\'e al (sabiti kaldır)' : 'T0\'a al (sabitle)'}">${isT0 ? "📌" : "—"}</span>`
          : "—"
        }</td>
        <td class="tabid-cell">${r.tabId}${isStale ? ' <span style="color:#f38ba8;font-size:10px">stale</span>' : ''}</td>
        <td><span class="${badgeClass}">${label}</span></td>
        <td>${openCell}</td>
        <td class="domain-cell">${escHtml(r.domain || "—")}</td>
        <td class="title-cell" title="${escHtml(r.title || "")}">${escHtml(r.title || "—")}</td>
        <td class="url-cell" title="${escHtml(r.url || "")}">
          ${isOpen
            ? `<a href="#" class="activate-tab" data-tabid="${r.tabId}" style="color:#89dceb">${escHtml(r.url || "—")}</a>`
            : `<a href="${escHtml(r.url || "#")}" target="_blank" style="color:#a6adc8">${escHtml(r.url || "—")}</a>`
          }
        </td>
        <td class="time-cell">${fmtTime(r.lastFocusStart)}</td>
        <td class="time-cell">${fmtTime(r.lastFocusEnd)}</td>
        <td class="time-cell">${isT0 ? "—" : fmtElapsed(r.lastFocusEnd)}</td>
        <td class="time-cell">${fmtTime(r.createdAt)}</td>
      </tr>`;
  }).join("");

  // Sütun başlığı okları güncelle
  document.querySelectorAll("thead th[data-col]").forEach(th => {
    th.classList.remove("sorted-asc", "sorted-desc");
    if (th.dataset.col === sortCol) {
      th.classList.add(sortDir === 1 ? "sorted-asc" : "sorted-desc");
    }
  });

  // Açık tab linkleri — tıklayınca mevcut tabı aktif et
  document.querySelectorAll(".activate-tab").forEach(a => {
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      const tabId = parseInt(a.dataset.tabid);
      try {
        const tab = await chrome.tabs.update(tabId, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
      } catch (err) {
        // Tab artık açık değilse sessizce geç
      }
    });
  });

  // Pin toggle — T0 ↔ T1 geçişi
  document.querySelectorAll(".pin-toggle").forEach(el => {
    el.addEventListener("click", async () => {
      const tabId = parseInt(el.dataset.tabid);
      const currentTier = parseInt(el.dataset.tier);
      const newTier = currentTier === 0 ? 1 : 0;
      try {
        await chrome.runtime.sendMessage({ type: "SET_TAB_TIER", tabIds: [tabId], tier: newTier });
        await loadData();
      } catch (e) {
        // ignore
      }
    });
  });

  // Checkbox olayları — tbody render edildikten sonra bağla
  document.querySelectorAll(".row-cb").forEach(cb => {
    cb.addEventListener("change", () => {
      if (cb.checked) selectedKeys.add(cb.dataset.key);
      else selectedKeys.delete(cb.dataset.key);
      updateOpenBtn();
    });
  });

  // "Tümünü seç" checkbox durumunu senkronize et
  const t4Count = allRecords.filter(r => r.currentTier === 4).length;
  const selectAll = document.getElementById("selectAllT4");
  selectAll.checked = t4Count > 0 && selectedKeys.size === t4Count;
  selectAll.indeterminate = selectedKeys.size > 0 && selectedKeys.size < t4Count;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Yardımcılar ─────────────────────────────────────────────────────────

function updateOpenBtn() {
  const btn = document.getElementById("openSelectedBtn");
  btn.disabled = selectedKeys.size === 0;
  btn.textContent = selectedKeys.size > 0
    ? `📂 Seçilileri Aç (${selectedKeys.size} tab → T1)`
    : "📂 Seçilileri Aç (T1)";
}

// ─── Olaylar ─────────────────────────────────────────────────────────────

document.getElementById("refreshBtn").addEventListener("click", loadData);

document.getElementById("filterInput").addEventListener("input", (e) => {
  filterText = e.target.value;
  renderTable();
});

document.getElementById("copyBtn").addEventListener("click", async () => {
  const { tabRecords = {} } = await chrome.storage.local.get("tabRecords");
  await navigator.clipboard.writeText(JSON.stringify(tabRecords, null, 2));
  const btn = document.getElementById("copyBtn");
  btn.textContent = "✅ Kopyalandı";
  setTimeout(() => { btn.textContent = "📋 JSON Kopyala"; }, 2000);
});

document.getElementById("reconcileBtn").addEventListener("click", async () => {
  const btn = document.getElementById("reconcileBtn");
  btn.textContent = "⏳ Uzlaştırılıyor…";
  btn.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: "RECONCILE_TABS" });
    await loadData();
    btn.textContent = `✅ arşiv:${res.archived} yeni:${res.added} düzelt:${res.fixed} yeniden-bağ:${res.relinked} tier-düzelt:${res.tierCorrected} grup:${res.grouped}`;
  } catch (e) {
    btn.textContent = "❌ Hata: " + (e?.message || "");
  }
  setTimeout(() => { btn.textContent = "🔄 Uzlaştır"; btn.disabled = false; }, 4000);
});

document.getElementById("dedupBtn").addEventListener("click", async () => {
  const btn = document.getElementById("dedupBtn");
  btn.textContent = "⏳ Temizleniyor…";
  btn.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: "DEDUP_RECORDS" });
    await loadData();
    btn.textContent = res.removed > 0
      ? `✅ ${res.removed} duplicate silindi, ${res.closedTabs} tab kapandı`
      : "✅ Duplicate yok";
  } catch (e) {
    btn.textContent = "❌ Hata";
  }
  setTimeout(() => { btn.textContent = "🧹 Duplicate Temizle"; btn.disabled = false; }, 3500);
});

// "Tümünü seç" başlık checkbox
document.getElementById("selectAllT4").addEventListener("change", (e) => {
  const t4Keys = allRecords
    .filter(r => r.currentTier === 4)
    .map(r => String(r.tabId));
  if (e.target.checked) {
    t4Keys.forEach(k => selectedKeys.add(k));
  } else {
    t4Keys.forEach(k => selectedKeys.delete(k));
  }
  updateOpenBtn();
  renderTable();
});

// Seçilileri Aç
document.getElementById("openSelectedBtn").addEventListener("click", async () => {
  if (selectedKeys.size === 0) return;
  const btn = document.getElementById("openSelectedBtn");
  btn.disabled = true;
  btn.textContent = "⏳ Açılıyor…";
  try {
    await chrome.runtime.sendMessage({
      type: "PROMOTE_TABS",
      keys: [...selectedKeys],
    });
    selectedKeys.clear();
    await loadData();
    updateOpenBtn();
  } catch (e) {
    btn.textContent = "❌ Hata";
    setTimeout(() => { btn.disabled = false; updateOpenBtn(); }, 2000);
  }
});

document.querySelectorAll("thead th[data-col]").forEach(th => {
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

// ─── İlk Yükleme ─────────────────────────────────────────────────────────

loadData();

// 10 saniyede bir otomatik yenile
setInterval(loadData, 10000);
