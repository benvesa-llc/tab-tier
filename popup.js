// =============================================================================
// Tab Lifecycle Manager — popup.js
// =============================================================================

// EN: i18n helper shorthand | TR: i18n yardımcı kısaltması
const i18n = (key, subs) => chrome.i18n.getMessage(key, subs);

let currentSort = "tierDomain"; // "tierDomain" | "tierTitle" | "tierUrl"

// EN: Tier labels and config from i18n | TR: Tier etiketleri ve yapılandırması i18n'den
const TIER_LABELS = {
  0: { label: i18n("tierT0Name"), cls: "t0", icon: "📌" },
  1: { label: i18n("tierT1Name"), cls: "t1", icon: "🔥" },
  2: { label: i18n("tierT2Name"), cls: "t2", icon: "⏸" },
  3: { label: i18n("tierT3Name"), cls: "t3", icon: "❄️" },
  4: { label: i18n("tierT4Name"), cls: "t4", icon: "⚫" }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(ts) {
  if (!ts) return i18n("timeActive");
  const diffMs = Date.now() - ts;
  const mins   = Math.floor(diffMs / 60000);
  const hours  = Math.floor(mins  / 60);
  const days   = Math.floor(hours / 24);
  if (days  > 0) return i18n("timeDaysAgo",  [days]);
  if (hours > 0) return i18n("timeHoursAgo", [hours]);
  if (mins  > 0) return i18n("timeMinsAgo",  [mins]);
  return i18n("timeJustNow");
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

// ─── Data loading ──────────────────────────────────────────────────────────────

async function loadData() {
  const data = await chrome.storage.local.get(["tabRecords", "settings"]);
  return {
    tabRecords: data.tabRecords || {},
    settings:   data.settings   || {}
  };
}

// ─── Summary band ─────────────────────────────────────────────────────────────

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
  totalBadge.textContent = i18n("totalCountLabel", [total]);
  container.appendChild(totalBadge);
}

// ─── Tab item ─────────────────────────────────────────────────────────────────

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

  const actions = document.createElement("div");
  actions.className = "tab-actions";

  // EN: Open button | TR: Aç butonu
  const openBtn = document.createElement("button");
  openBtn.className = "tab-action-btn";
  openBtn.title = tier === 4 ? i18n("openFromArchive") : i18n("focusTab");
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

  // EN: Pin/unpin button (not shown for T4) | TR: Pin/unpin butonu (T4'te gösterilmez)
  if (tier !== 4) {
    const pinBtn = document.createElement("button");
    pinBtn.className = "tab-action-btn";
    pinBtn.title = record.isPinned ? i18n("unpinTab") : i18n("pinToT0");
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

  // EN: Delete button | TR: Sil butonu
  const delBtn = document.createElement("button");
  delBtn.className = "tab-action-btn danger";
  delBtn.title = i18n("deleteRecord");
  delBtn.textContent = "✕";
  delBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    await sendMsg("DELETE_RECORD", { tabId: record.tabId });
    render();
  });
  actions.appendChild(delBtn);

  item.appendChild(actions);

  // EN: Click row to focus/open tab | TR: Satıra tıklayınca tabı aç/odaklan
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

// ─── Sort functions ───────────────────────────────────────────────────────────

function sortRecords(records) {
  if (currentSort === "tierTitle") {
    return [...records].sort((a, b) => {
      if (a.currentTier !== b.currentTier) return a.currentTier - b.currentTier;
      return (a.title || "").toLowerCase().localeCompare((b.title || "").toLowerCase());
    });
  }
  if (currentSort === "tierUrl") {
    return [...records].sort((a, b) => {
      if (a.currentTier !== b.currentTier) return a.currentTier - b.currentTier;
      return (a.url || "").toLowerCase().localeCompare((b.url || "").toLowerCase());
    });
  }
  // EN: tierDomain (default): tier first, then domain A-Z, then title A-Z
  // TR: tierDomain (varsayılan): tier önce, sonra domain A-Z, sonra başlık A-Z
  return [...records].sort((a, b) => {
    if (a.currentTier !== b.currentTier) return a.currentTier - b.currentTier;
    const da = (a.domain || "").toLowerCase();
    const db = (b.domain || "").toLowerCase();
    if (da !== db) return da < db ? -1 : 1;
    return (a.title || "").toLowerCase().localeCompare((b.title || "").toLowerCase());
  });
}

function sortDomainGroups(byDomain) {
  const domains = Object.keys(byDomain);
  if (currentSort === "tierUrl") {
    return domains.sort((a, b) => {
      const ua = (byDomain[a][0]?.url || "").toLowerCase();
      const ub = (byDomain[b][0]?.url || "").toLowerCase();
      return ua < ub ? -1 : ua > ub ? 1 : 0;
    });
  }
  if (currentSort === "tierTitle") {
    return domains.sort((a, b) => {
      const ta = (byDomain[a][0]?.title || "").toLowerCase();
      const tb = (byDomain[b][0]?.title || "").toLowerCase();
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
  }
  // EN: tierDomain: sort domains A-Z | TR: tierDomain: domainleri A-Z sırala
  return domains.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

// ─── Domain group ─────────────────────────────────────────────────────────────

function createDomainGroup(domain, records, tier) {
  const group = document.createElement("div");
  group.className = "domain-group";

  const header = document.createElement("div");
  header.className = "domain-header";

  const chevron = document.createElement("span");
  chevron.className = "domain-chevron";
  chevron.textContent = "▶";

  const dFav = faviconEl(records[0]?.favicon, domain);
  dFav.className = "domain-favicon";

  const dName = document.createElement("span");
  dName.className = "domain-name";
  dName.textContent = domain || i18n("domainGroupOther");

  const dCount = document.createElement("span");
  dCount.className = "domain-count";
  dCount.textContent = records.length;

  header.appendChild(chevron);
  header.appendChild(dFav);
  header.appendChild(dName);
  header.appendChild(dCount);
  group.appendChild(header);

  const tabList = document.createElement("div");
  tabList.className = "domain-tabs";

  for (const record of records) {
    tabList.appendChild(createTabItem(record, tier));
  }
  group.appendChild(tabList);

  header.addEventListener("click", () => {
    const isOpen = tabList.classList.toggle("open");
    chevron.classList.toggle("open", isOpen);
  });

  return group;
}

// ─── Tier section ─────────────────────────────────────────────────────────────

function createTierSection(tierNum, records, settings) {
  const section = document.createElement("div");

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
    info.textContent = i18n("autoDeleteInfo", [settings.tier4_delete_days]);
    hdr.appendChild(info);
  }

  section.appendChild(hdr);

  if (records.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "padding: 8px 12px; font-size: 12px; color: #6c7086;";
    empty.textContent = i18n("noTabsInTier");
    section.appendChild(empty);
    return section;
  }

  // EN: Domain mode: group by domain. Title/URL modes: flat sorted list.
  // TR: Domain modu: domaine göre grupla. Başlık/URL modları: düz sıralı liste.
  if (currentSort === "tierDomain") {
    const byDomain = {};
    for (const r of records) {
      const d = r.domain || "other";
      if (!byDomain[d]) byDomain[d] = [];
      byDomain[d].push(r);
    }
    const sortedDomains = sortDomainGroups(byDomain);
    for (const domain of sortedDomains) {
      byDomain[domain] = sortRecords(byDomain[domain]);
      section.appendChild(createDomainGroup(domain, byDomain[domain], tierNum));
    }
  } else {
    // EN: Flat list sorted by title or URL | TR: Başlık veya URL'ye göre düz liste
    const sorted = sortRecords(records);
    for (const record of sorted) {
      section.appendChild(createTabItem(record, tierNum));
    }
  }

  return section;
}

// ─── Search results ───────────────────────────────────────────────────────────

function renderSearchResults(tabRecords, query) {
  const q       = query.toLowerCase().trim();
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
        <p>${i18n("noSearchResults", [query])}</p>
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

// ─── Main render ──────────────────────────────────────────────────────────────

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

  let anyContent = false;
  for (let tier = 0; tier <= 4; tier++) {
    const records = Object.values(tabRecords).filter(r => r.currentTier === tier);
    if (records.length > 0) {
      content.appendChild(createTierSection(tier, records, settings));
      anyContent = true;
    }
  }

  if (!anyContent) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">✅</div>
        <p>${i18n("noTabRecords")}</p>
      </div>`;
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

// EN: Sort buttons | TR: Sort butonları
document.querySelectorAll(".sort-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    currentSort = btn.dataset.sort;
    document.querySelectorAll(".sort-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    render();
  });
});

// EN: Apply sort to tab bar | TR: Tab bar'a uygula
document.getElementById("applyTabSortBtn").addEventListener("click", async () => {
  const applyBtn = document.getElementById("applyTabSortBtn");
  applyBtn.disabled = true;
  applyBtn.textContent = i18n("sortingText");

  try {
    const focused = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
    await sendMsg("SORT_TABS", { windowId: focused.id, sortType: currentSort });
    applyBtn.textContent = i18n("sortDone");
    setTimeout(() => {
      applyBtn.disabled = false;
      applyBtn.textContent = "↕ " + i18n("applyToTabs");
    }, 1800);
  } catch (_) {
    applyBtn.disabled = false;
    applyBtn.textContent = "↕ " + i18n("applyToTabs");
  }
});

document.getElementById("searchInput").addEventListener("input", render);

document.getElementById("clearArchiveBtn").addEventListener("click", async () => {
  if (confirm(i18n("confirmClearArchive"))) {
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
  chrome.tabs.create({ url: chrome.runtime.getURL("tab-management.html") });
  window.close();
});

// EN: Initial load | TR: İlk yükleme
render();

// EN: Re-render on storage change | TR: Storage değişince güncelle
chrome.storage.onChanged.addListener(() => {
  if (!document.getElementById("searchInput").value.trim()) render();
});
