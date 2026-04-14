// =============================================================================
// Tab Lifecycle Manager — background.js (Service Worker)
// =============================================================================

const DefaultGroupNames = {
  0: "T0: Sabit",
  1: "T1: Sıcak",
  2: "T2: Ilık",
  3: "T3: Soğuk",
};

const TIER_GROUP_COLORS = {
  0: "red",
  1: "orange",
  2: "yellow",
  3: "blue",
};

const INTERNAL_GROUP_COLOR = "grey";
const INTERNAL_GROUP_TITLE = "Diğer";

const DefaultSettings = {
  tier1_to_tier2_minutes: 60,
  tier2_to_tier3_hours: 24,
  tier3_to_tier4_days: 7,
  tier4_delete_days: 60,
  timerIntervalMinutes: 5,
  duplicateAction: "redirect",
  onManualClose: "delete",
  groupNames: { ...DefaultGroupNames },
  initialized: false,
};

// Şu an aktif olan tab'ın ID'si (sadece bellekte, storage'da değil)
let currentActiveTabId = null;

// =============================================================================
// Yardımcı Fonksiyonlar
// =============================================================================

function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return url;
  }
}

function isBrowserInternalUrl(url) {
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

function log(...args) {
  console.log("[TabTier]", ...args);
}

// =============================================================================
// moveTabToTierGroup: Tab'ı renk kodlu gruba taşı
// cachedSettings: storage okumaktan kaçınmak için opsiyonel
// =============================================================================
async function moveTabToTierGroup(tabId, tier, cachedSettings) {
  if (tier === 4) return;
  if (tier < 0 || tier > 3) return;

  try {
    const settings =
      cachedSettings ||
      (await chrome.storage.local.get("settings")).settings ||
      DefaultSettings;

    const groupNames = { ...DefaultGroupNames, ...(settings.groupNames || {}) };
    const title = groupNames[tier];
    const color = TIER_GROUP_COLORS[tier];

    const tab = await chrome.tabs.get(tabId);
    if (!tab) return;

    const groups = await chrome.tabGroups.query({ windowId: tab.windowId });
    // Renk üzerinden eşleştir: title değişmiş olsa bile doğru grubu bulur
    const targetGroup = groups.find((g) => g.color === color);

    if (targetGroup) {
      // Grup adını da güncelle (ayarlarla senkronize tut)
      if (targetGroup.title !== title) {
        await chrome.tabGroups.update(targetGroup.id, { title });
      }
      await chrome.tabs.group({ tabIds: [tabId], groupId: targetGroup.id });
    } else {
      const groupId = await chrome.tabs.group({ tabIds: [tabId] });
      await chrome.tabGroups.update(groupId, {
        title,
        color,
        collapsed: tier === 3,
      });
    }
  } catch (e) {
    log("moveTabToTierGroup error:", e?.message);
  }
}

// =============================================================================
// sortTabsInWindow: Edge tab bar'daki tab'ları sırala + gruplamaları yenile
// =============================================================================
async function sortTabsInWindow(windowId, sortType) {
  const { tabRecords = {}, settings = DefaultSettings } =
    await chrome.storage.local.get(["tabRecords", "settings"]);

  const tabs = await chrome.tabs.query({ windowId });
  const browserPinned = tabs.filter((t) => t.pinned);
  const normalTabs = tabs.filter((t) => !t.pinned);

  // İç sayfalar (yeni sekme, eklenti sayfaları, ayarlar vb.) en sona
  const internalTabs = normalTabs.filter((t) => isBrowserInternalUrl(t.url));
  const trackable = normalTabs.filter((t) => !isBrowserInternalUrl(t.url));

  const t0Tabs = trackable.filter((t) => tabRecords[t.id]?.currentTier === 0);
  const restTabs = trackable.filter(
    (t) => !tabRecords[t.id] || tabRecords[t.id].currentTier !== 0,
  );

  let sorted;
  if (sortType === "domain") {
    sorted = [...restTabs].sort((a, b) => {
      const ra = tabRecords[a.id];
      const rb = tabRecords[b.id];
      const da = (ra?.domain || extractDomain(a.url || "")).toLowerCase();
      const db = (rb?.domain || extractDomain(b.url || "")).toLowerCase();
      if (da !== db) return da < db ? -1 : 1;
      return (a.url || "")
        .toLowerCase()
        .localeCompare((b.url || "").toLowerCase());
    });
  } else if (sortType === "url") {
    sorted = [...restTabs].sort((a, b) =>
      (a.url || "").toLowerCase().localeCompare((b.url || "").toLowerCase()),
    );
  } else {
    // tierAlpha (default): tier sırası, aynı tier içinde domain A-Z
    sorted = [...restTabs].sort((a, b) => {
      const ra = tabRecords[a.id];
      const rb = tabRecords[b.id];
      const ta = ra?.currentTier ?? 1;
      const tb = rb?.currentTier ?? 1;
      if (ta !== tb) return ta - tb;
      const da = (ra?.domain || extractDomain(a.url || "")).toLowerCase();
      const db = (rb?.domain || extractDomain(b.url || "")).toLowerCase();
      return da < db ? -1 : da > db ? 1 : 0;
    });
  }

  // Sıra: [t0] [sorted T1/T2/T3] [internal — en sonda, grubun dışında]
  const finalOrder = [...t0Tabs, ...sorted, ...internalTabs];
  const startIndex = browserPinned.length;

  for (let i = 0; i < finalOrder.length; i++) {
    try {
      await chrome.tabs.move(finalOrder[i].id, { index: startIndex + i });
    } catch (e) {
      log("sortTabsInWindow move error:", e?.message);
    }
  }

  // Tier gruplarını yeniden ata (önce T0, sonra T1/T2/T3)
  const updatedTabs = await chrome.tabs.query({ windowId });
  const tier0Tabs = updatedTabs.filter(
    (t) => tabRecords[t.id]?.currentTier === 0,
  );
  const tierRest = updatedTabs.filter(
    (t) =>
      tabRecords[t.id] &&
      tabRecords[t.id].currentTier >= 1 &&
      tabRecords[t.id].currentTier <= 3,
  );

  for (const tab of tier0Tabs) {
    await moveTabToTierGroup(tab.id, 0, settings);
  }
  for (const tab of tierRest) {
    await moveTabToTierGroup(tab.id, tabRecords[tab.id].currentTier, settings);
  }

  // İç sayfaları "Diğer" grubuna topla
  await groupInternalTabs(windowId);

  log(
    "sortTabsInWindow done, t0:",
    t0Tabs.length,
    "sorted:",
    sorted.length,
    "internal:",
    internalTabs.length,
  );
}

// =============================================================================
// renameAllGroups: Tüm pencerelerdeki grup adlarını ayarlara göre güncelle
// =============================================================================
async function renameAllGroups() {
  const { settings = DefaultSettings } =
    await chrome.storage.local.get("settings");
  const groupNames = { ...DefaultGroupNames, ...(settings.groupNames || {}) };

  // Renk → tier eşleştirmesi: her tier'ın rengi unique
  // Böylece "Sabit", "T0: Sabit" gibi herhangi bir isimli grubu
  // renginden tanıyıp doğru isimle güncelleyebiliriz.
  const colorToTier = Object.fromEntries(
    Object.entries(TIER_GROUP_COLORS).map(([tier, color]) => [
      color,
      parseInt(tier),
    ]),
  );

  const windows = await chrome.windows.getAll();
  for (const win of windows) {
    const groups = await chrome.tabGroups.query({ windowId: win.id });
    for (const group of groups) {
      const tier = colorToTier[group.color];
      if (tier == null) continue; // bizim yönetmediğimiz grup
      const newTitle = groupNames[tier];
      if (newTitle && newTitle !== group.title) {
        try {
          await chrome.tabGroups.update(group.id, { title: newTitle });
          log("renamed group", group.title, "→", newTitle);
        } catch (e) {}
      }
    }
  }
}

// =============================================================================
// dissolveAllGroups: Tüm pencerelerdeki tab gruplarını çöz (tablar açıkta kalır)
// =============================================================================
async function dissolveAllGroups() {
  const windows = await chrome.windows.getAll();
  for (const win of windows) {
    // Tüm tab'ları sorgula, grupta olanları tek seferde çöz.
    // Grup bazında döngü yerine bu yöntem daha güvenilir:
    // Chrome, bir grubu çözdükten sonra diğer grupların indekslerini
    // değiştirebilir; toplu ungroup bunu önler.
    const allTabs = await chrome.tabs.query({ windowId: win.id });
    const groupedIds = allTabs
      .filter((t) => t.groupId !== -1 && !t.pinned)
      .map((t) => t.id);
    if (groupedIds.length === 0) continue;
    try {
      await chrome.tabs.ungroup(groupedIds);
      log(
        "dissolveAllGroups window",
        win.id,
        "—",
        groupedIds.length,
        "tabs ungrouped",
      );
    } catch (e) {
      log("dissolveAllGroups error:", e?.message);
    }
  }
}

// =============================================================================
// groupInternalTabs: İç sayfaları (yeni sekme, eklenti sayfaları vb.)
// "Diğer" adlı grey grupta topla
// =============================================================================
async function groupInternalTabs(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  const internalTabs = tabs.filter(
    (t) => !t.pinned && isBrowserInternalUrl(t.url),
  );
  if (internalTabs.length === 0) return;

  const tabIds = internalTabs.map((t) => t.id);

  // Mevcut "Diğer" grubunu grey renkle ara
  const groups = await chrome.tabGroups.query({
    windowId,
    color: INTERNAL_GROUP_COLOR,
  });
  const existing = groups.find((g) => g.color === INTERNAL_GROUP_COLOR);

  if (existing) {
    await chrome.tabs.group({ tabIds, groupId: existing.id });
    if (existing.title !== INTERNAL_GROUP_TITLE) {
      await chrome.tabGroups.update(existing.id, {
        title: INTERNAL_GROUP_TITLE,
      });
    }
  } else {
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, {
      title: INTERNAL_GROUP_TITLE,
      color: INTERNAL_GROUP_COLOR,
      collapsed: false,
    });
  }
  log("groupInternalTabs:", internalTabs.length, "tabs → Diğer");
}

// =============================================================================
// dedupRecords: Aynı URL'ye sahip duplicate kayıtları temizle
//   Kural: en düşük tier numaralı kayıt korunur (T0 > T1 > T2 > T3 > T4)
//   Diğerleri: storage'dan silinir + açık tabsa tarayıcıdan kapatılır
// =============================================================================
async function dedupRecords() {
  const { tabRecords = {} } = await chrome.storage.local.get("tabRecords");

  // URL → kayıt listesi
  const byUrl = {};
  for (const [key, rec] of Object.entries(tabRecords)) {
    const url = rec.url;
    if (!url) continue;
    if (!byUrl[url]) byUrl[url] = [];
    byUrl[url].push({ key, rec });
  }

  let removed = 0;
  let closedTabs = 0;

  for (const [, entries] of Object.entries(byUrl)) {
    if (entries.length <= 1) continue;

    // Birincil: en düşük tier numarası (T0 en öncelikli)
    // İkincil: aynı tier içinde en yeni odak zamanı (lastFocusEnd büyük = daha yeni)
    //   null lastFocusEnd = şu an aktif = en yeni kabul edilir
    entries.sort((a, b) => {
      const tierDiff = (a.rec.currentTier ?? 99) - (b.rec.currentTier ?? 99);
      if (tierDiff !== 0) return tierDiff;
      const aTime = a.rec.lastFocusEnd ?? Number.MAX_SAFE_INTEGER; // null = aktif = en yeni
      const bTime = b.rec.lastFocusEnd ?? Number.MAX_SAFE_INTEGER;
      return bTime - aTime; // azalan → en yeni başa
    });
    const [keep, ...dupes] = entries;

    log("dedup keep:", keep.key, "tier:", keep.rec.currentTier, "url:", keep.rec.url);

    for (const { key, rec } of dupes) {
      // Açık bir tab ise kapat
      if (rec.currentTier !== 4 && rec.tabId) {
        try {
          await chrome.tabs.remove(rec.tabId);
          closedTabs++;
          log("dedup closed tab", rec.tabId);
        } catch (e) {
          // Tab zaten kapalı olabilir — sorun değil
        }
      }
      delete tabRecords[key];
      removed++;
      log("dedup removed record", key, "tier:", rec.currentTier);
    }
  }

  await chrome.storage.local.set({ tabRecords });
  log(`dedupRecords done — removed:${removed} closedTabs:${closedTabs}`);
  return { removed, closedTabs };
}

// =============================================================================
// reconcileTabs: Storage'ı gerçek açık tablarla eşitle + grupları uygula
//   - Kapalı tab'ların kayıtlarını HER ZAMAN T4'e gönder (sil değil)
//   - Açık ama kayıtsız tab'lara yeni kayıt ekle
//   - Stale null'ları (gerçekte aktif olmayan) düzelt
//   - Açık tüm kayıtlı tab'ları doğru tier grubuna taşı
// =============================================================================
async function reconcileTabs() {
  const { tabRecords = {}, settings = DefaultSettings } =
    await chrome.storage.local.get(["tabRecords", "settings"]);

  const allTabs = await chrome.tabs.query({});
  const openTabIds = new Set(allTabs.map((t) => t.id));
  const activeTabs = await chrome.tabs.query({ active: true });
  const activeTabIds = new Set(activeTabs.map((t) => t.id));

  const now = Date.now();
  let added = 0, archived = 0, fixed = 0, relinked = 0;

  // URL → açık tab eşlemesi: tabId değişmiş olsa bile URL üzerinden bulabilmek için
  // Aynı URL'den birden fazla açık tab varsa en yeni (en büyük id) tercih edilir
  const urlToOpenTab = {};
  for (const tab of allTabs) {
    if (!tab.url || isBrowserInternalUrl(tab.url)) continue;
    if (!urlToOpenTab[tab.url] || tab.id > urlToOpenTab[tab.url].id) {
      urlToOpenTab[tab.url] = tab;
    }
  }

  // Zaten hangi tabId'lerin kayıtta olduğunu bil (relink çakışmasını önle)
  const recordedTabIds = new Set(Object.keys(tabRecords).map(k => parseInt(k)));

  // Kaydedilen ama tabId üzerinden açık görünmeyen kayıtları kontrol et
  for (const key of Object.keys(tabRecords)) {
    const rec = tabRecords[key];
    if (rec.currentTier === 4) continue; // zaten arşivde

    if (openTabIds.has(parseInt(key))) continue; // tabId eşleşti, sorun yok

    // tabId eşleşmedi → URL üzerinden bak: tab hâlâ açık ama ID değişmiş olabilir
    const matchTab = urlToOpenTab[rec.url];
    if (matchTab && !recordedTabIds.has(matchTab.id)) {
      // Aynı URL ile açık bir tab var ve o tab henüz başka bir kayıtta değil
      // → kaydı yeni tabId'ye taşı (re-link), tier korunur
      delete tabRecords[key];
      tabRecords[matchTab.id] = {
        ...rec,
        tabId: matchTab.id,
        url: matchTab.url,
        title: matchTab.title || rec.title,
        favicon: matchTab.favIconUrl || rec.favicon,
      };
      recordedTabIds.delete(parseInt(key));
      recordedTabIds.add(matchTab.id);
      relinked++;
      log(`reconcile re-link: key=${key} → ${matchTab.id} tier=${rec.currentTier} url=${rec.url}`);
    } else {
      // Gerçekten açık değil → T4'e arşivle
      rec.currentTier = 4;
      rec.lastFocusEnd = now;
      archived++;
    }
  }

  // Stale null'ları düzelt
  for (const [tabId, rec] of Object.entries(tabRecords)) {
    if (rec.lastFocusEnd === null && !activeTabIds.has(parseInt(tabId))) {
      rec.lastFocusEnd = now;
      fixed++;
    }
  }

  // Açık ama kayıtsız tab'ları ekle
  for (const tab of allTabs) {
    if (!tab.url || isBrowserInternalUrl(tab.url)) continue;
    if (tabRecords[tab.id]) continue;
    tabRecords[tab.id] = {
      tabId: tab.id,
      url: tab.url,
      domain: extractDomain(tab.url),
      title: tab.title || tab.url,
      favicon: tab.favIconUrl || "",
      currentTier: tab.pinned ? 0 : 1,
      isPinned: tab.pinned || false,
      lastFocusStart: now,
      lastFocusEnd: activeTabIds.has(tab.id) ? null : now,
      createdAt: now,
    };
    added++;
  }

  await chrome.storage.local.set({ tabRecords });
  log(`reconcile storage done — archived:${archived} added:${added} fixed:${fixed} relinked:${relinked}`);

  // Tarayıcıdaki mevcut grup renklerini topla (tier doğrulama için)
  const colorToTier = Object.fromEntries(
    Object.entries(TIER_GROUP_COLORS).map(([tier, color]) => [color, parseInt(tier)])
  );
  const allGroupsMap = {};
  for (const win of await chrome.windows.getAll()) {
    const gs = await chrome.tabGroups.query({ windowId: win.id });
    for (const g of gs) allGroupsMap[g.id] = g;
  }

  // Açık tüm tab'ları kayıttaki tier grubuna taşı (T0–T3)
  // Önce: tab tarayıcıda zaten daha yüksek bir tier grubundaysa (timer onu
  // taşımış ama storage güncellenememiş olabilir) storage'ı düzelt.
  let grouped = 0, tierCorrected = 0;
  for (const tab of allTabs) {
    if (isBrowserInternalUrl(tab.url)) continue;
    const rec = tabRecords[tab.id];
    if (!rec) continue;

    // Tarayıcıdaki gerçek tier: tab'ın bulunduğu grubun renginden çıkar
    if (tab.groupId !== -1 && allGroupsMap[tab.groupId]) {
      const browserTier = colorToTier[allGroupsMap[tab.groupId].color];
      if (browserTier != null && browserTier > (rec.currentTier ?? 0)) {
        // Timer demote yapmış ama storage kalmış — storage'ı düzelt
        log(`reconcile tier fix: T${rec.currentTier}→T${browserTier} tab=${tab.id}`);
        rec.currentTier = browserTier;
        tierCorrected++;
      }
    }

    if (rec.currentTier >= 0 && rec.currentTier <= 3) {
      await moveTabToTierGroup(tab.id, rec.currentTier, settings);
      grouped++;
    }
  }

  if (tierCorrected > 0) {
    await chrome.storage.local.set({ tabRecords }); // düzeltilmiş tier'ları kaydet
  }

  // İç sayfaları "Diğer" grubuna topla (pencere başına)
  const windowIds = [...new Set(allTabs.map((t) => t.windowId))];
  for (const wid of windowIds) {
    await groupInternalTabs(wid);
  }

  log(`reconcile done — archived:${archived} added:${added} fixed:${fixed} relinked:${relinked} tierCorrected:${tierCorrected} grouped:${grouped}`);
  return { archived, added, fixed, grouped, relinked, tierCorrected };
}

// =============================================================================
// pinTab / unpinTab
// =============================================================================
async function pinTab(tabId) {
  const { tabRecords = {} } = await chrome.storage.local.get("tabRecords");
  if (tabRecords[tabId]) {
    tabRecords[tabId].isPinned = true;
    tabRecords[tabId].currentTier = 0;
    await moveTabToTierGroup(tabId, 0);
    await chrome.storage.local.set({ tabRecords });
    log("pinTab", tabId);
  }
}

async function unpinTab(tabId) {
  const { tabRecords = {} } = await chrome.storage.local.get("tabRecords");
  if (tabRecords[tabId]) {
    tabRecords[tabId].isPinned = false;
    tabRecords[tabId].currentTier = 1;
    tabRecords[tabId].lastFocusEnd = null; // Aktifmiş gibi davran
    await moveTabToTierGroup(tabId, 1);
    await chrome.storage.local.set({ tabRecords });
    log("unpinTab", tabId);
  }
}

// =============================================================================
// timerCheck: Her 5 dakikada çalışan tier düşürme döngüsü
// =============================================================================
async function timerCheck() {
  const { tabRecords = {}, settings = DefaultSettings } =
    await chrome.storage.local.get(["tabRecords", "settings"]);

  const now = Date.now();
  let hasChanges = false;

  const TIER1_TO_2 = settings.tier1_to_tier2_minutes * 60 * 1000;
  const TIER2_TO_3 = settings.tier2_to_tier3_hours * 3600 * 1000;
  const TIER3_TO_4 = settings.tier3_to_tier4_days * 86400 * 1000;
  const TIER4_DELETE = settings.tier4_delete_days * 86400 * 1000;

  for (const tabId of Object.keys(tabRecords)) {
    const tab = tabRecords[tabId];

    // Aktif tab (bakılıyor) → atla
    if (tab.lastFocusEnd === null) continue;
    // Tier 0 (Fixed) — never demote
    if (tab.currentTier === 0) continue;

    const elapsed = now - tab.lastFocusEnd;

    // Tier 4 → Kalıcı silme
    if (tab.currentTier === 4 && TIER4_DELETE > 0 && elapsed >= TIER4_DELETE) {
      delete tabRecords[tabId];
      hasChanges = true;
      continue;
    }

    // Tier 3 → Tier 4: tab bar'dan kaldır, panelde sakla
    if (tab.currentTier === 3 && elapsed >= TIER3_TO_4) {
      tab.currentTier = 4;
      try {
        await chrome.tabs.remove(parseInt(tabId));
      } catch (e) {}
      hasChanges = true;
      log("demote T3→T4", tabId, tab.url);
      continue;
    }

    // Tier 2 → Tier 3: soğuk grubuna taşı
    if (tab.currentTier === 2 && elapsed >= TIER2_TO_3) {
      tab.currentTier = 3;
      await moveTabToTierGroup(parseInt(tabId), 3);
      hasChanges = true;
      log("demote T2→T3", tabId, tab.url);
      continue;
    }

    // Tier 1 → Tier 2: T2 grubuna taşı
    // Not: chrome.tabs.discard() kaldırıldı — Edge bazen discard'dan sonra
    // tab'a yeni bir ID atıyor; eski ID storage'da kalınca debug "yok" gösteriyor.
    // Memory yönetimini Chrome/Edge kendi yapıyor (memory baskısında auto-discard).
    if (tab.currentTier === 1 && elapsed >= TIER1_TO_2) {
      tab.currentTier = 2;
      await moveTabToTierGroup(parseInt(tabId), 2);
      hasChanges = true;
      log("demote T1→T2", tabId, tab.url);
      continue;
    }
  }

  if (hasChanges) {
    await chrome.storage.local.set({ tabRecords });
  }
}

// =============================================================================
// onInstalled: İlk yükleme / güncelleme
// =============================================================================
chrome.runtime.onInstalled.addListener(async (details) => {
  // "install" yerine initialized flag'i kontrol et:
  // Eski eklentiden yükseltme yapıldığında reason="update" gelir ve
  // bu blok atlanırdı. initialized=false ise her durumda ilk kurulum yapılır.
  const { settings: existingSettings = {} } =
    await chrome.storage.local.get("settings");

  if (!existingSettings.initialized) {
    log("First init (reason=%s) — scanning tabs", details.reason);

    const mergedSettings = { ...DefaultSettings, ...existingSettings };
    await chrome.storage.local.set({ settings: mergedSettings });

    const allTabs = await chrome.tabs.query({});
    const tabRecords = {};
    const now = Date.now();

    for (const tab of allTabs) {
      if (!tab.url || isBrowserInternalUrl(tab.url)) continue;
      tabRecords[tab.id] = {
        tabId: tab.id,
        url: tab.url,
        domain: extractDomain(tab.url),
        title: tab.title || tab.url,
        favicon: tab.favIconUrl || "",
        currentTier: tab.pinned ? 0 : 1,
        isPinned: tab.pinned || false,
        lastFocusStart: now,
        lastFocusEnd: now, // Süre hemen başlasın
        createdAt: now,
      };
    }

    // Aktif tab'a dokunulmasın
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (activeTab && tabRecords[activeTab.id]) {
      tabRecords[activeTab.id].lastFocusEnd = null;
      currentActiveTabId = activeTab.id;
    }

    await chrome.storage.local.set({ tabRecords });

    // Onboarding aç
    chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
  }

  // Timer her durumda (install veya update'de)
  chrome.alarms.create("tierCheck", {
    periodInMinutes: DefaultSettings.timerIntervalMinutes,
  });
  log("alarm created");
});

// =============================================================================
// Service Worker Başlangıç: Timer garanti et + aktif tab'ı bul
// =============================================================================
chrome.alarms.get("tierCheck", (alarm) => {
  if (!alarm) {
    chrome.alarms.create("tierCheck", {
      periodInMinutes: DefaultSettings.timerIntervalMinutes,
    });
    log("alarm re-created on startup");
  }
});

(async () => {
  try {
    // Her penceredeki aktif tab'ları bul (birden fazla pencere olabilir)
    const activeTabs = await chrome.tabs.query({ active: true });
    const activeTabIds = new Set(activeTabs.map((t) => t.id));

    // currentWindow'daki aktif tab'ı belle
    const [currentWindowActive] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (currentWindowActive) currentActiveTabId = currentWindowActive.id;

    // Stale null'ları düzelt:
    // Service worker yeniden başladığında currentActiveTabId sıfırlanır.
    // Eğer bir tab gerçekte aktif değilse ama lastFocusEnd=null ise düzelt.
    const { tabRecords = {} } = await chrome.storage.local.get("tabRecords");
    const now = Date.now();
    let fixCount = 0;
    for (const [tabId, record] of Object.entries(tabRecords)) {
      if (record.lastFocusEnd === null && !activeTabIds.has(parseInt(tabId))) {
        record.lastFocusEnd = now;
        fixCount++;
      }
    }
    if (fixCount > 0) {
      await chrome.storage.local.set({ tabRecords });
      log("startup: fixed", fixCount, "stale active(null) records");
    }

    // Birikmiş tier geçişlerini işle (Edge kapalıyken geçen süre)
    await timerCheck();
  } catch (e) {
    log("startup error:", e?.message);
  }
})();

// =============================================================================
// EVENT 1: tabs.onActivated — Tab'a tıklama
// =============================================================================
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const newTabId = activeInfo.tabId;
  const now = Date.now();

  try {
    const { tabRecords = {} } = await chrome.storage.local.get("tabRecords");

    // Önceki tab'dan çıkış: lastFocusEnd başlat
    if (currentActiveTabId && tabRecords[currentActiveTabId]) {
      tabRecords[currentActiveTabId].lastFocusEnd = now;
    }

    // Yeni tab'ı aktif yap
    if (tabRecords[newTabId]) {
      tabRecords[newTabId].lastFocusStart = now;
      tabRecords[newTabId].lastFocusEnd = null; // null = şu an aktif

      // Promote from Tier 2/3/4 to Tier 1 (T0 is 0, already excluded by > 1)
      if (tabRecords[newTabId].currentTier > 1) {
        tabRecords[newTabId].currentTier = 1;
        await moveTabToTierGroup(newTabId, 1);
        log("promote →T1", newTabId);
      }
    } else {
      // Kayıt yok — yeni kayıt oluştur
      try {
        const tab = await chrome.tabs.get(newTabId);
        if (tab && tab.url && !isBrowserInternalUrl(tab.url)) {
          tabRecords[newTabId] = {
            tabId: newTabId,
            url: tab.url,
            domain: extractDomain(tab.url),
            title: tab.title || tab.url,
            favicon: tab.favIconUrl || "",
            currentTier: tab.pinned ? 0 : 1,
            isPinned: tab.pinned || false,
            lastFocusStart: now,
            lastFocusEnd: null,
            createdAt: now,
          };
        }
      } catch (e) {}
    }

    currentActiveTabId = newTabId;
    await chrome.storage.local.set({ tabRecords });
  } catch (e) {
    log("onActivated error:", e?.message);
  }
});

// =============================================================================
// EVENT 2: tabs.onCreated — Yeni tab açıldı (duplikasyon kontrolü)
// =============================================================================
chrome.tabs.onCreated.addListener(async (newTab) => {
  if (!newTab.url || isBrowserInternalUrl(newTab.url)) return;

  try {
    const { tabRecords = {}, settings = DefaultSettings } =
      await chrome.storage.local.get(["tabRecords", "settings"]);

    // Duplikasyon kontrolü (T4 arşiv kayıtları duplicate sayılmaz —
    // PROMOTE_TABS ile açılan tablar T4 kaydı varken tetiklenir ve
    // yanlışlıkla redirect'e düşmemeli)
    const dup = Object.values(tabRecords).find(
      (r) => r.url === newTab.url && r.tabId !== newTab.id && r.currentTier !== 4,
    );

    if (dup && settings.duplicateAction === "redirect") {
      await chrome.tabs.remove(newTab.id);
      if (dup.currentTier === 4) {
        // Arşivden geri aç
        const reopened = await chrome.tabs.create({ url: dup.url });
        dup.tabId = reopened.id;
        dup.currentTier = 1;
        dup.lastFocusEnd = null;
      } else {
        await chrome.tabs.update(dup.tabId, { active: true });
      }
      await chrome.storage.local.set({ tabRecords });
      log("duplicate redirect", newTab.url);
      return;
    }

    const now = Date.now();
    tabRecords[newTab.id] = {
      tabId: newTab.id,
      url: newTab.url,
      domain: extractDomain(newTab.url),
      title: newTab.title || "Yükleniyor...",
      favicon: newTab.favIconUrl || "",
      currentTier: 1,
      isPinned: false,
      lastFocusStart: now,
      lastFocusEnd: null,
      createdAt: now,
    };

    await moveTabToTierGroup(newTab.id, 1);
    await chrome.storage.local.set({ tabRecords });
  } catch (e) {
    log("onCreated error:", e?.message);
  }
});

// =============================================================================
// EVENT 3: tabs.onRemoved — Tab kapatıldı
// =============================================================================
chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    const { tabRecords = {}, settings = DefaultSettings } =
      await chrome.storage.local.get(["tabRecords", "settings"]);

    if (!tabRecords[tabId]) return;

    if (settings.onManualClose === "archive") {
      tabRecords[tabId].currentTier = 4;
      tabRecords[tabId].lastFocusEnd = Date.now();
    } else {
      delete tabRecords[tabId];
    }

    if (currentActiveTabId === tabId) currentActiveTabId = null;
    await chrome.storage.local.set({ tabRecords });
  } catch (e) {
    log("onRemoved error:", e?.message);
  }
});

// =============================================================================
// EVENT 4: tabs.onUpdated — URL veya başlık değişimi
// =============================================================================
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url && !changeInfo.title) return;
  if (changeInfo.url && isBrowserInternalUrl(changeInfo.url)) return;

  try {
    const { tabRecords = {} } = await chrome.storage.local.get("tabRecords");
    if (!tabRecords[tabId]) return;

    if (changeInfo.url) {
      tabRecords[tabId].url = changeInfo.url;
      tabRecords[tabId].domain = extractDomain(changeInfo.url);
    }
    if (changeInfo.title) {
      tabRecords[tabId].title = changeInfo.title;
    }
    if (changeInfo.url && tab.favIconUrl) {
      tabRecords[tabId].favicon = tab.favIconUrl;
    }

    await chrome.storage.local.set({ tabRecords });
  } catch (e) {
    log("onUpdated error:", e?.message);
  }
});

// =============================================================================
// Alarm: Tier kontrol döngüsü (her 5 dakika)
// =============================================================================
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "tierCheck") {
    await timerCheck();
  }
});

// =============================================================================
// Message Handler: Popup / Settings / Onboarding iletişimi
// =============================================================================
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case "PIN_TAB":
      pinTab(message.tabId)
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: e?.message }));
      return true;

    case "UNPIN_TAB":
      unpinTab(message.tabId)
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: e?.message }));
      return true;

    case "PROMOTE_TABS": {
      // Çoklu arşiv açma: keys = eski tabId string'leri (storage key)
      const { keys } = message;
      chrome.storage.local
        .get(["tabRecords", "settings"])
        .then(async ({ tabRecords = {}, settings = DefaultSettings }) => {
          for (const key of keys) {
            const rec = tabRecords[key];
            if (!rec || rec.currentTier !== 4) continue;
            try {
              const newTab = await chrome.tabs.create({
                url: rec.url,
                active: false,
              });
              delete tabRecords[key];
              tabRecords[newTab.id] = {
                ...rec,
                tabId: newTab.id,
                currentTier: 1,
                lastFocusEnd: Date.now(),
              };
              await moveTabToTierGroup(newTab.id, 1, settings);
            } catch (e) {
              log("PROMOTE_TABS error", key, e?.message);
            }
          }
          await chrome.storage.local.set({ tabRecords });
          sendResponse({ ok: true });
        })
        .catch((e) => sendResponse({ ok: false, error: e?.message }));
      return true;
    }

    case "PROMOTE_TAB": {
      // Arşivdeki (T4) tab'ı aç ve T1'e yükselt
      const url = message.url;
      chrome.tabs
        .create({ url, active: true })
        .then(async (tab) => {
          const { tabRecords = {} } =
            await chrome.storage.local.get("tabRecords");
          // Eski arşiv kaydını temizle
          for (const key of Object.keys(tabRecords)) {
            if (
              tabRecords[key].url === url &&
              tabRecords[key].currentTier === 4
            ) {
              tabRecords[key].tabId = tab.id;
              tabRecords[key].currentTier = 1;
              tabRecords[key].lastFocusEnd = null;
              break;
            }
          }
          await chrome.storage.local.set({ tabRecords });
          sendResponse({ ok: true, tabId: tab.id });
        })
        .catch((e) => sendResponse({ ok: false, error: e?.message }));
      return true;
    }

    case "DELETE_RECORD":
      chrome.storage.local
        .get("tabRecords")
        .then(({ tabRecords = {} }) => {
          const key = String(message.tabId);
          delete tabRecords[key];
          return chrome.storage.local.set({ tabRecords });
        })
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: e?.message }));
      return true;

    case "CLEAR_ARCHIVE":
      chrome.storage.local
        .get("tabRecords")
        .then(({ tabRecords = {} }) => {
          for (const key of Object.keys(tabRecords)) {
            if (tabRecords[key].currentTier === 4) delete tabRecords[key];
          }
          return chrome.storage.local.set({ tabRecords });
        })
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: e?.message }));
      return true;

    case "SET_TAB_TIER": {
      const { tabIds, tier } = message;
      chrome.storage.local
        .get("tabRecords")
        .then(async ({ tabRecords = {} }) => {
          const now = Date.now();
          for (const tabId of tabIds) {
            if (tabRecords[tabId]) {
              tabRecords[tabId].isPinned = tier === 0;
              tabRecords[tabId].currentTier = tier;
              if (tier === 0) {
                await moveTabToTierGroup(tabId, 0);
              } else {
                // Start the inactivity timer from now
                tabRecords[tabId].lastFocusEnd = now;
                await moveTabToTierGroup(tabId, 1);
              }
            }
          }
          await chrome.storage.local.set({ tabRecords });
          sendResponse({ ok: true });
        })
        .catch((e) => sendResponse({ ok: false, error: e?.message }));
      return true;
    }

    case "SORT_TABS":
      sortTabsInWindow(message.windowId, message.sortType)
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: e?.message }));
      return true;

    case "RENAME_ALL_GROUPS":
      renameAllGroups()
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: e?.message }));
      return true;

    case "DISSOLVE_ALL_GROUPS":
      dissolveAllGroups()
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: e?.message }));
      return true;

    case "RECONCILE_TABS":
      reconcileTabs()
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((e) => sendResponse({ ok: false, error: e?.message }));
      return true;

    case "DEDUP_RECORDS":
      dedupRecords()
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((e) => sendResponse({ ok: false, error: e?.message }));
      return true;
  }
});
