// =============================================================================
// Tab Lifecycle Manager — popup.js
// =============================================================================

let currentSort = "tierAlpha"; // "tierAlpha" | "domain" | "url"

const TIER_LABELS = {
  0: { label: "T0 Sabit",     cls: "t0", icon: "📌" },
  1: { label: "T1 Aktif",     cls: "t1", icon: "🔥" },
  2: { label: "T2 Beklemede", cls: "t2", icon: "⏸" },
  3: { label: "T3 Soğuk",    cls: "t3", icon: "❄️" },
  4: { label: "T4 Arşiv",    cls: "t4", icon: "⚫" }
};

// ─── Yardımcılar ───────────────────────────────────────────────────────────

function relativeTime(ts) {
  if (!ts) return "aktif";
  const diffMs = Date.now() - ts;
  const mins  = Math.floor(diffMs / 60000);
  const hours = Math.floor(mins  / 60);
  const days  = Math.floor(hours / 24);
  if (days  > 0) return `${days} gün önce`;
  if (hours > 0) return `${hours} saat önce`;
  if (mins  > 0) return `${mins} dk önce`;
  return "az önce";
}

function faviconEl(favicon, domain) {
  const img = document.createElement("img");
  img.className = "tab-favicon";
  img.src = favicon || `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
  img.onerror = () => { img.src = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='16' rx='2' fill='%2345475a'/></svg>"; };
  return img;
}

async function sendMsg(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

// ─── Veri yükleme ──────────────────────────────────────────────────────────

async function loadData() {
  const data = await chrome.storage.local.get(["tabRecords", "settings"]);
  return {
    tabRecords: data.tabRecords || {},
    settings: data.settings || {}
  };
}

// ─── Summary Band ──────────────────────────────────────────────────────────

function renderSummary(tabRecords) {
  const counts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const t of Object.values(tabRecords)) {
    counts[t.currentTier] = (counts[t.currentTier] || 0) + 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const container = document.getElementById("summary");
  container.innerHTML = "";

  for (let i = 0; i <= 4; i++) {
    const badge = document.createElement("span");
    badge.className = `tier-badge ${TIER_LABELS[i].cls}`;
    badge.textContent = `${TIER_LABELS[i].icon} T${i}: ${counts[i]}`;
    badge.title = TIER_LABELS[i].label;
    container.appendChild(badge);
  }

  const totalBadge = document.createElement("span");
  totalBadge.className = "tier-badge total";
  totalBadge.textContent = `Toplam: ${total}`;
  container.appendChild(totalBadge);
}

// ─── Tab item oluştur ──────────────────────────────────────────────────────

function createTabItem(record, tier) {
  const item = document.createElement("div");
  item.className = "tab-item";

  item.appendChild(faviconEl(record.favicon, record.domain));

  const info = document.createElement("div");
  info.className = "tab-info";

  const title = document.createElement("div");
  title.className = "tab-title";
  title.textContent = record.title || record.url;

  const meta = document.createElement("div");
  meta.className = "tab-meta";
  meta.textContent = `${record.domain || ""} · ${relativeTime(record.lastFocusEnd)}`;

  info.appendChild(title);
  info.appendChild(meta);
  item.appendChild(info);

  // Aksiyonlar
  const actions = document.createElement("div");
  actions.className = "tab-actions";

  // Aç butonu
  const openBtn = document.createElement("button");
  openBtn.className = "tab-action-btn";
  openBtn.title = tier === 4 ? "Aç (arşivden)" : "Tab'a odaklan";
  openBtn.textContent = tier === 4 ? "↗" : "⤴";
  openBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (tier === 4) {
      await sendMsg("PROMOTE_TAB", { url: record.url });
    } else {
      try {
        await chrome.tabs.update(record.tabId, { active: true });
        const tab = await chrome.tabs.get(record.tabId);
        await chrome.windows.update(tab.windowId, { focused: true });
      } catch (_) {}
    }
    window.close();
  });
  actions.appendChild(openBtn);

  // Pin/Unpin butonu (Tier 4'te pin yok)
  if (tier !== 4) {
    const pinBtn = document.createElement("button");
    pinBtn.className = "tab-action-btn";
    pinBtn.title = record.isPinned ? "Sabiti Kaldır" : "Sabitle (T0)";
    pinBtn.textContent = record.isPinned ? "📌" : "📍";
    pinBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (record.isPinned) {
        await sendMsg("UNPIN_TAB", { tabId: record.tabId });
      } else {
        await sendMsg("PIN_TAB", { tabId: record.tabId });
      }
      render();
    });
    actions.appendChild(pinBtn);
  }

  // Sil butonu
  const delBtn = document.createElement("button");
  delBtn.className = "tab-action-btn danger";
  delBtn.title = "Kaydı sil";
  delBtn.textContent = "✕";
  delBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    await sendMsg("DELETE_RECORD", { tabId: record.tabId });
    render();
  });
  actions.appendChild(delBtn);

  item.appendChild(actions);

  // Tab'a tıklayınca aç
  item.addEventListener("click", async () => {
    if (tier === 4) {
      await sendMsg("PROMOTE_TAB", { url: record.url });
    } else {
      try {
        await chrome.tabs.update(record.tabId, { active: true });
        const tab = await chrome.tabs.get(record.tabId);
        await chrome.windows.update(tab.windowId, { focused: true });
      } catch (_) {}
    }
    window.close();
  });

  return item;
}

// ─── Sıralama fonksiyonları ────────────────────────────────────────────────

function sortRecords(records) {
  if (currentSort === "domain") {
    return [...records].sort((a, b) => {
      const da = (a.domain || "").toLowerCase();
      const db = (b.domain || "").toLowerCase();
      if (da !== db) return da < db ? -1 : 1;
      return (a.title || "").toLowerCase().localeCompare((b.title || "").toLowerCase());
    });
  }
  if (currentSort === "url") {
    return [...records].sort((a, b) => {
      const ua = (a.url || "").toLowerCase();
      const ub = (b.url || "").toLowerCase();
      return ua < ub ? -1 : ua > ub ? 1 : 0;
    });
  }
  // tierAlpha (default): domain A-Z
  return [...records].sort((a, b) =>
    (a.domain || "").toLowerCase().localeCompare((b.domain || "").toLowerCase())
  );
}

function sortDomainGroups(byDomain) {
  const domains = Object.keys(byDomain);

  if (currentSort === "url") {
    return domains.sort((a, b) => {
      const ua = (byDomain[a][0]?.url || "").toLowerCase();
      const ub = (byDomain[b][0]?.url || "").toLowerCase();
      return ua < ub ? -1 : ua > ub ? 1 : 0;
    });
  }
  // tierAlpha + domain: domain A-Z
  return domains.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

// ─── Domain Grubu oluştur ──────────────────────────────────────────────────

function createDomainGroup(domain, records, tier) {
  const group = document.createElement("div");
  group.className = "domain-group";

  // Domain header (tıklanabilir)
  const header = document.createElement("div");
  header.className = "domain-header";

  const chevron = document.createElement("span");
  chevron.className = "domain-chevron";
  chevron.textContent = "▶";

  const dFav = faviconEl(records[0]?.favicon, domain);
  dFav.className = "domain-favicon";

  const dName = document.createElement("span");
  dName.className = "domain-name";
  dName.textContent = domain || "Diğer";

  const dCount = document.createElement("span");
  dCount.className = "domain-count";
  dCount.textContent = records.length;

  header.appendChild(chevron);
  header.appendChild(dFav);
  header.appendChild(dName);
  header.appendChild(dCount);
  group.appendChild(header);

  // Tab listesi (varsayılan kapalı)
  const tabList = document.createElement("div");
  tabList.className = "domain-tabs";

  for (const record of records) {
    tabList.appendChild(createTabItem(record, tier));
  }
  group.appendChild(tabList);

  // Toggle
  header.addEventListener("click", () => {
    const isOpen = tabList.classList.toggle("open");
    chevron.classList.toggle("open", isOpen);
  });

  return group;
}

// ─── Tier Bölümü oluştur ──────────────────────────────────────────────────

function createTierSection(tierNum, records, settings) {
  const section = document.createElement("div");

  // Bölüm başlığı
  const cfg = TIER_LABELS[tierNum];
  const hdr = document.createElement("div");
  hdr.className = `section-header t${tierNum}-header`;
  hdr.innerHTML = `
    <span>${cfg.icon} ${cfg.label}</span>
    <span class="section-count">${records.length}</span>
  `;

  if (tierNum === 4 && settings.tier4_delete_days > 0) {
    const info = document.createElement("div");
    info.className = "archive-info";
    info.textContent = `⏱ Otomatik silme: ${settings.tier4_delete_days} gün`;
    hdr.appendChild(info);
  }

  section.appendChild(hdr);

  if (records.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "padding: 8px 12px; font-size: 12px; color: #6c7086;";
    empty.textContent = "Bu katmanda tab yok.";
    section.appendChild(empty);
    return section;
  }

  // Domain bazlı grupla
  const byDomain = {};
  for (const r of records) {
    const d = r.domain || "diğer";
    if (!byDomain[d]) byDomain[d] = [];
    byDomain[d].push(r);
  }

  // Domain sıralama + her domain içindeki tab sıralama
  const sortedDomains = sortDomainGroups(byDomain);
  for (const domain of sortedDomains) {
    byDomain[domain] = sortRecords(byDomain[domain]);
    section.appendChild(createDomainGroup(domain, byDomain[domain], tierNum));
  }

  return section;
}

// ─── Arama Sonuçları ──────────────────────────────────────────────────────

function renderSearchResults(tabRecords, query) {
  const q = query.toLowerCase().trim();
  const content = document.getElementById("content");
  content.innerHTML = "";

  const matched = Object.values(tabRecords).filter(r =>
    (r.title  || "").toLowerCase().includes(q) ||
    (r.domain || "").toLowerCase().includes(q) ||
    (r.url    || "").toLowerCase().includes(q)
  );
  const results = sortRecords(matched);

  if (results.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <p>"${query}" için sonuç bulunamadı.</p>
      </div>`;
    return;
  }

  for (const r of results) {
    const item = document.createElement("div");
    item.className = "search-result-item";

    const tierBadge = document.createElement("span");
    tierBadge.className = `search-tier-badge ${TIER_LABELS[r.currentTier].cls}`;
    tierBadge.textContent = `T${r.currentTier}`;
    item.appendChild(tierBadge);

    item.appendChild(faviconEl(r.favicon, r.domain));

    const info = document.createElement("div");
    info.className = "tab-info";

    const title = document.createElement("div");
    title.className = "tab-title";
    title.textContent = r.title || r.url;

    const meta = document.createElement("div");
    meta.className = "tab-meta";
    meta.textContent = `${r.domain || ""} · ${relativeTime(r.lastFocusEnd)}`;

    info.appendChild(title);
    info.appendChild(meta);
    item.appendChild(info);

    item.addEventListener("click", async () => {
      if (r.currentTier === 4) {
        await sendMsg("PROMOTE_TAB", { url: r.url });
      } else {
        try {
          await chrome.tabs.update(r.tabId, { active: true });
          const tab = await chrome.tabs.get(r.tabId);
          await chrome.windows.update(tab.windowId, { focused: true });
        } catch (_) {}
      }
      window.close();
    });

    content.appendChild(item);
  }
}

// ─── Ana render ───────────────────────────────────────────────────────────

async function render() {
  const { tabRecords, settings } = await loadData();
  const query = document.getElementById("searchInput").value;

  renderSummary(tabRecords);

  const content = document.getElementById("content");

  if (query.trim().length > 0) {
    renderSearchResults(tabRecords, query);
    return;
  }

  content.innerHTML = "";

  // Tier 3 (Soğuk) — tab bar'da var ama panelde de göster
  const tier3 = Object.values(tabRecords)
    .filter(r => r.currentTier === 3)
    .sort((a, b) => (b.lastFocusEnd || 0) - (a.lastFocusEnd || 0));

  // Tier 4 (Arşiv) — sadece panelde var
  const tier4 = Object.values(tabRecords)
    .filter(r => r.currentTier === 4)
    .sort((a, b) => (b.lastFocusEnd || 0) - (a.lastFocusEnd || 0));

  if (tier3.length === 0 && tier4.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">✅</div>
        <p>Soğuk veya arşiv tab yok.<br>Tab'lar aktif kullanımda!</p>
      </div>`;
    return;
  }

  if (tier3.length > 0) {
    content.appendChild(createTierSection(3, tier3, settings));
  }

  if (tier4.length > 0) {
    content.appendChild(createTierSection(4, tier4, settings));
  }
}

// ─── Event Listener'lar ────────────────────────────────────────────────────

// Sort butonları
document.querySelectorAll(".sort-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    currentSort = btn.dataset.sort;
    document.querySelectorAll(".sort-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    render();
  });
});

// Tab bar'a uygula
document.getElementById("applyTabSortBtn").addEventListener("click", async () => {
  const applyBtn = document.getElementById("applyTabSortBtn");
  applyBtn.disabled = true;
  applyBtn.textContent = "⏳ Sıralanıyor...";

  try {
    const [win] = await chrome.windows.getAll({ windowTypes: ["normal"] });
    const focused = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
    await sendMsg("SORT_TABS", {
      windowId: focused.id,
      sortType: currentSort
    });
    applyBtn.textContent = "✅ Tamam";
    setTimeout(() => {
      applyBtn.disabled = false;
      applyBtn.textContent = "↕ Uygula";
    }, 1800);
  } catch (e) {
    applyBtn.disabled = false;
    applyBtn.textContent = "↕ Uygula";
  }
});

document.getElementById("searchInput").addEventListener("input", render);

document.getElementById("clearArchiveBtn").addEventListener("click", async () => {
  if (confirm("Tüm Tier 4 arşiv kayıtları silinecek. Emin misiniz?")) {
    await sendMsg("CLEAR_ARCHIVE");
    render();
  }
});

document.getElementById("settingsBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("settings.html") });
  window.close();
});

document.getElementById("settingsBtn2").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("settings.html") });
  window.close();
});

document.getElementById("tabManagerBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("debug.html") });
  window.close();
});

// İlk yükleme
render();

// Storage değişince güncelle (başka popup örneğiyle veya background'dan)
chrome.storage.onChanged.addListener(() => {
  if (!document.getElementById("searchInput").value.trim()) render();
});
