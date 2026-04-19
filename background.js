// =============================================================================
// Tab Lifecycle Manager — background.js (Service Worker)
// =============================================================================

// EN: Default group names from i18n — auto-selected based on browser language
// TR: i18n'den varsayılan grup adları — tarayıcı diline göre otomatik seçilir
const DefaultGroupNames = {
  0: chrome.i18n.getMessage("defaultGroupT0"),
  1: chrome.i18n.getMessage("defaultGroupT1"),
  2: chrome.i18n.getMessage("defaultGroupT2"),
  3: chrome.i18n.getMessage("defaultGroupT3"),
};

const TIER_GROUP_COLORS = {
  0: "red",
  1: "orange",
  2: "yellow",
  3: "blue",
};

const INTERNAL_GROUP_COLOR = "grey";
// EN: Tab group title for browser-internal pages (new tab, devtools, etc.)
// TR: Tarayıcı iç sayfaları için tab grubu başlığı (yeni sekme, devtools vb.)
const INTERNAL_GROUP_TITLE = chrome.i18n.getMessage("internalGroupTitle");

// EN: Inverse of TIER_GROUP_COLORS: color → tier number | TR: TIER_GROUP_COLORS tersine çevrilmiş hali: renk → kademe numarası
const COLOR_TO_TIER = Object.fromEntries(
  Object.entries(TIER_GROUP_COLORS).map(([tier, color]) => [
    color,
    parseInt(tier),
  ]),
);

const DefaultSettings = {
  tier1_to_tier2_minutes: 60,
  tier2_to_tier3_hours: 24,
  tier3_to_tier4_days: 7,
  tier4_delete_days: 60,
  timerIntervalMinutes: 1,
  duplicateAction: "redirect",
  onManualClose: "delete",
  // EN: Empty by default — i18n defaults are resolved at runtime, not stored
  // TR: Varsayılan olarak boş — i18n varsayılanları çalışma zamanında çözülür, saklanmaz
  groupNames: {},
  initialized: false,
};

// EN: Currently active tab ID (in-memory only, not in storage) | TR: Şu an aktif tab ID'si (sadece bellekte)
let currentActiveTabId = null;

// EN: Tab IDs currently being moved by the extension — onUpdated must not overwrite lastFocusEnd for these
// TR: Extension tarafından taşınan tab ID'leri — bunlar için onUpdated lastFocusEnd yazmamalı
const extensionMovingTabs = new Set();

// EN: URLs currently being restored from T4 — prevents mini-reconcile from
//     immediately re-archiving a tab that was just reopened (anti-loop guard).
// TR: T4'ten geri yüklenen URL'ler — yeni açılan tab'ı mini-reconcile'ın hemen
//     tekrar arşivlemesini önler (döngü karşıtı koruma).
const restoringUrls = new Map(); // url → restoredAt timestamp
const RESTORE_COOLDOWN_MS = 5 * 60 * 1000; // EN: 5-minute cooldown | TR: 5 dakika bekleme

// =============================================================================
// Yardımcı Fonksiyonlar
// =============================================================================

// EN: Calculate the expected tier from elapsed inactive time (ms) and settings.
//     T0 is never calculated here — callers must skip T0 tabs before calling.
// TR: Geçen hareketsizlik süresi (ms) ve ayarlara göre beklenen tier'ı hesapla.
//     T0 burada hesaplanmaz — çağıranlar T0 tabları atlamalı.
function calcExpectedTier(elapsed, settings) {
  const T1_2 = settings.tier1_to_tier2_minutes * 60 * 1000;
  const T2_3 = settings.tier2_to_tier3_hours   * 3600 * 1000;
  const T3_4 = settings.tier3_to_tier4_days    * 86400 * 1000;
  if (elapsed >= T3_4) return 4;
  if (elapsed >= T2_3) return 3;
  if (elapsed >= T1_2) return 2;
  return 1;
}

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

/*
 * EN: Sort tier groups so T0 → T1 → T2 → T3 left to right.
 *     Only moves groups when they are out of order; tabs within groups are untouched.
 * TR: Kademe gruplarını soldan sağa T0 → T1 → T2 → T3 sırasına dizer.
 *     Yalnızca sıra bozuksa grupları taşır; grup içindeki sekmeler yerinde kalır.
 */
async function reorderGroupsInWindow(windowId) {
  try {
    const [allTabs, allGroups] = await Promise.all([
      chrome.tabs.query({ windowId }),
      chrome.tabGroups.query({ windowId }),
    ]);

    // EN: Only consider our tier groups (by color), sorted T0 → T3
    // TR: Yalnızca renge göre tanınan kademe gruplarını al, T0 → T3 sırala
    const tierGroups = allGroups
      .filter((g) => COLOR_TO_TIER[g.color] !== undefined)
      .sort((a, b) => COLOR_TO_TIER[a.color] - COLOR_TO_TIER[b.color]);

    if (tierGroups.length <= 1) return; // EN: Nothing to reorder | TR: Sıralanacak grup yok

    // EN: Check current first-tab index of each group | TR: Her grubun ilk sekme indeksini bul
    const groupFirstIndex = (g) => {
      const t = allTabs.find((tab) => tab.groupId === g.id);
      return t ? t.index : Infinity;
    };

    const positions = tierGroups.map(groupFirstIndex);
    const alreadySorted = positions.every(
      (p, i) => i === 0 || p > positions[i - 1],
    );
    if (alreadySorted) return;

    // EN: Count tabs per group to advance the insertion cursor | TR: Grup başına sekme sayısı
    const tabCountOf = (g) => allTabs.filter((t) => t.groupId === g.id).length;

    const pinnedCount = allTabs.filter((t) => t.pinned).length;
    let cursor = pinnedCount;

    for (const group of tierGroups) {
      await chrome.tabGroups.move(group.id, { index: cursor });
      cursor += tabCountOf(group);
    }

    log("reorderGroupsInWindow done, window", windowId);
  } catch (e) {
    log("reorderGroupsInWindow error:", e?.message);
  }
}

// =============================================================================
// moveTabToTierGroup: Tab'ı renk kodlu gruba taşı
// cachedSettings: storage okumaktan kaçınmak için opsiyonel
// =============================================================================
async function moveTabToTierGroup(tabId, tier, cachedSettings, _attempt = 0) {
  if (tier === 4) return;
  if (tier < 0 || tier > 3) return;

  try {
    const settings =
      cachedSettings ||
      (await chrome.storage.local.get("settings")).settings ||
      DefaultSettings;

    // EN: Merge i18n defaults with stored custom names; skip empty stored values so defaults show through
    // TR: i18n varsayılanlarını saklanan özel adlarla birleştir; boş kayıtlı değerleri atla, varsayılan görünsün
    // EN: Skip empty values and old translated defaults (T0:/T1:/T2:/T3: prefix) so i18n defaults show through
    // TR: Boş değerleri ve eski çevrilmiş varsayılanları (T0:/T1: vb. öneki) atla; i18n varsayılanları görünsün
    const customNames = Object.fromEntries(
      Object.entries(settings.groupNames || {}).filter(
        ([, v]) => v?.trim() && !/^T[0-3]:/.test(v.trim())
      )
    );
    const groupNames = { ...DefaultGroupNames, ...customNames };
    const title = groupNames[tier];
    const color = TIER_GROUP_COLORS[tier];

    const tab = await chrome.tabs.get(tabId);
    if (!tab) return;
    // EN: Pinned tabs cannot be added to groups — Chrome/Edge API rejects the call | TR: Sabitlenmiş tablar gruba eklenemez — Chrome/Edge API çağrısını reddeder
    if (tab.pinned) return;

    // EN: Mark this tab as being moved by the extension so onUpdated won't reset lastFocusEnd
    // TR: Bu tab'ı extension tarafından taşınıyor olarak işaretle; onUpdated lastFocusEnd'i sıfırlamasın
    extensionMovingTabs.add(tabId);

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
      // EN: New group created — reorder all tier groups so T0 < T1 < T2 < T3 | TR: Yeni grup oluşturuldu, tüm grupları T0 < T1 < T2 < T3 sırasına diz
      await reorderGroupsInWindow(tab.windowId);
    }
  } catch (e) {
    // EN: Always clean up the moving-flag on error so future onUpdated events are not ignored
    // TR: Hata durumunda taşıma bayrağını temizle; sonraki onUpdated olayları yoksayılmasın
    extensionMovingTabs.delete(tabId);

    // EN: Retry up to 3 times if the browser rejects the group change (tab being dragged/edited)
    // TR: Tarayıcı grup değişikliğini reddederse (sürükleme vb.) 3 kez yeniden dene
    if (_attempt < 3 && e?.message?.includes("cannot be edited")) {
      const delay = (_attempt + 1) * 300;
      log(`moveTabToTierGroup retry ${_attempt + 1}/3 in ${delay}ms — tab ${tabId}`);
      await new Promise((r) => setTimeout(r, delay));
      return moveTabToTierGroup(tabId, tier, cachedSettings, _attempt + 1);
    }
    log("moveTabToTierGroup error:", e?.message, "tab", tabId);
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

  // EN: All sort modes use tier as the primary key so tabs of different tiers
  //     are never interleaved. This prevents Edge from auto-assigning a tab to
  //     the wrong group due to physical proximity during the move loop.
  // TR: Tüm sıralama modları birincil anahtar olarak tier kullanır; farklı
  //     tierlerdeki tablar hiçbir zaman iç içe geçmez. Bu, move döngüsü sırasında
  //     Edge'in fiziksel yakınlık nedeniyle bir tabı yanlış gruba atamasını önler.
  // EN: Sort T0 tabs by the same secondary key so the fixed group is also ordered
  // TR: T0 tablarını da aynı ikincil anahtara göre sırala; sabit grup da düzenli olsun
  let sortedT0;
  let sorted;

  if (sortType === "tierTitle") {
    const byTitle = (a, b) =>
      (a.title || "").toLowerCase().localeCompare((b.title || "").toLowerCase());
    sortedT0 = [...t0Tabs].sort(byTitle);
    sorted = [...restTabs].sort((a, b) => {
      const ta = tabRecords[a.id]?.currentTier ?? 1;
      const tb = tabRecords[b.id]?.currentTier ?? 1;
      if (ta !== tb) return ta - tb;
      return byTitle(a, b);
    });
  } else if (sortType === "tierUrl") {
    const byUrl = (a, b) =>
      (a.url || "").toLowerCase().localeCompare((b.url || "").toLowerCase());
    sortedT0 = [...t0Tabs].sort(byUrl);
    sorted = [...restTabs].sort((a, b) => {
      const ta = tabRecords[a.id]?.currentTier ?? 1;
      const tb = tabRecords[b.id]?.currentTier ?? 1;
      if (ta !== tb) return ta - tb;
      return byUrl(a, b);
    });
  } else {
    // EN: tierDomain (default) — tier first, then domain A-Z | TR: tierDomain (varsayılan) — önce tier, sonra domain A-Z
    const byDomain = (a, b) => {
      const da = (tabRecords[a.id]?.domain || extractDomain(a.url || "")).toLowerCase();
      const db = (tabRecords[b.id]?.domain || extractDomain(b.url || "")).toLowerCase();
      return da < db ? -1 : da > db ? 1 : 0;
    };
    sortedT0 = [...t0Tabs].sort(byDomain);
    sorted = [...restTabs].sort((a, b) => {
      const ta = tabRecords[a.id]?.currentTier ?? 1;
      const tb = tabRecords[b.id]?.currentTier ?? 1;
      if (ta !== tb) return ta - tb;
      return byDomain(a, b);
    });
  }

  // EN: Final order: [sorted T0] [sorted T1/T2/T3] [internal pages — always last, ungrouped]
  // TR: Nihai sıra: [sıralı T0] [sıralı T1/T2/T3] [iç sayfalar — her zaman en sonda, grupsuz]
  const finalOrder = [...sortedT0, ...sorted, ...internalTabs];
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
  // EN: Merge i18n defaults with stored custom names; skip empty stored values so defaults show through
  // TR: i18n varsayılanlarını saklanan özel adlarla birleştir; boş kayıtlı değerleri atla, varsayılan görünsün
  const customNames = Object.fromEntries(
    Object.entries(settings.groupNames || {}).filter(([, v]) => v?.trim())
  );
  const groupNames = { ...DefaultGroupNames, ...customNames };

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

    log(
      "dedup keep:",
      keep.key,
      "tier:",
      keep.rec.currentTier,
      "url:",
      keep.rec.url,
    );

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
  let added = 0,
    archived = 0,
    fixed = 0,
    relinked = 0;

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
  const recordedTabIds = new Set(
    Object.keys(tabRecords).map((k) => parseInt(k)),
  );

  // Kaydedilen ama tabId üzerinden açık görünmeyen kayıtları kontrol et
  for (const key of Object.keys(tabRecords)) {
    const rec = tabRecords[key];

    if (rec.currentTier === 4) {
      // EN: T4 tab: check if elapsed time says it should be in a lower tier (incorrectly archived)
      //     Restore with same cooldown guard used by timerCheck.
      // TR: T4 tab: geçen süre daha düşük bir tier'da olması gerektiğini söylüyorsa (yanlış arşivlenmiş)
      //     timerCheck ile aynı bekleme korumasını kullanarak geri yükle.
      if (rec.lastFocusEnd) {
        const elapsedT4 = now - rec.lastFocusEnd;
        const expectedTier = calcExpectedTier(elapsedT4, settings);
        if (expectedTier < 4) {
          const restoredAt = restoringUrls.get(rec.url);
          if (!restoredAt || (now - restoredAt) >= RESTORE_COOLDOWN_MS) {
            try {
              const newTab = await chrome.tabs.create({ url: rec.url, active: false });
              await new Promise((r) => setTimeout(r, 500));
              restoringUrls.set(rec.url, now);
              delete tabRecords[key];
              tabRecords[String(newTab.id)] = {
                ...rec,
                tabId: newTab.id,
                currentTier: expectedTier,
              };
              recordedTabIds.add(newTab.id);
              await moveTabToTierGroup(newTab.id, expectedTier, settings);
              relinked++;
              log(`reconcile restore T4→T${expectedTier}`, key, rec.url);
            } catch (e) {
              log("reconcile restore T4 error:", e?.message, "tab", key);
            }
          }
        }
      }
      continue;
    }

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
      log(
        `reconcile re-link: key=${key} → ${matchTab.id} tier=${rec.currentTier} url=${rec.url}`,
      );
    } else {
      // EN: Before archiving, check restore cooldown | TR: Arşivlemeden önce bekleme süresini kontrol et
      const restoredAt = restoringUrls.get(rec.url);
      if (restoredAt && (now - restoredAt) < RESTORE_COOLDOWN_MS) {
        log(`reconcile skip re-archive (restore cooldown): url=${rec.url}`);
        continue;
      }
      // EN: Tab is truly gone — apply onManualClose setting | TR: Tab gerçekten yok — onManualClose ayarını uygula
      if (settings.onManualClose === "delete") {
        log(`reconcile delete (onManualClose=delete): key=${key} url=${rec.url}`);
        delete tabRecords[key];
      } else {
        rec.currentTier = 4;
        rec.lastFocusEnd = now;
        archived++;
      }
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
  log(
    `reconcile storage done — archived:${archived} added:${added} fixed:${fixed} relinked:${relinked}`,
  );

  // Tarayıcıdaki mevcut grup renklerini topla (tier doğrulama için)
  const colorToTier = Object.fromEntries(
    Object.entries(TIER_GROUP_COLORS).map(([tier, color]) => [
      color,
      parseInt(tier),
    ]),
  );
  const allGroupsMap = {};
  for (const win of await chrome.windows.getAll()) {
    const gs = await chrome.tabGroups.query({ windowId: win.id });
    for (const g of gs) allGroupsMap[g.id] = g;
  }

  // EN: Place every open tab in the correct tier group.
  //     Expected tier is calculated from elapsed inactive time — same logic as timerCheck.
  //     T0 tabs are never moved by this calculation.
  // TR: Her açık tab'ı doğru tier grubuna taşı.
  //     Beklenen tier, hareketsizlik süresinden hesaplanır — timerCheck ile aynı mantık.
  //     T0 tablar bu hesaplamayla hiçbir zaman taşınmaz.
  let grouped = 0, tierCorrected = 0;
  const reconcileNow = Date.now();
  for (const tab of allTabs) {
    if (isBrowserInternalUrl(tab.url)) continue;
    const rec = tabRecords[tab.id];
    if (!rec) continue;
    if (rec.currentTier === 0) {
      await moveTabToTierGroup(tab.id, 0, settings);
      grouped++;
      continue;
    }

    // EN: Active tab — no elapsed time, stays in T1 group | TR: Aktif tab — geçen süre yok, T1 grubunda kalır
    if (rec.lastFocusEnd === null) {
      if (rec.currentTier !== 1) { rec.currentTier = 1; tierCorrected++; }
      await moveTabToTierGroup(tab.id, 1, settings);
      grouped++;
      continue;
    }

    // EN: Calculate expected tier from elapsed time and correct if needed | TR: Geçen süreden beklenen tier'ı hesapla, gerekirse düzelt
    const elapsed = reconcileNow - rec.lastFocusEnd;
    const expectedTier = calcExpectedTier(elapsed, settings);
    if (expectedTier === 4) {
      // EN: Tab should be archived but is still open — leave it in its current group
      //     and let timerCheck close it on the next alarm tick (within 1 minute).
      //     Marking T4 here without closing causes Tab Management to show it as
      //     archived while the browser tab is still visible.
      // TR: Tab arşivlenmeli ama hâlâ açık — mevcut grubunda bırak, timerCheck
      //     bir sonraki alarm tick'inde (1 dk içinde) kapatır.
      //     Burada kapatmadan T4 işaretlemek Tab Management'te açık tab'ı arşivde gösterir.
      continue;
    }
    if (rec.currentTier !== expectedTier) {
      log(`reconcile tier fix: T${rec.currentTier}→T${expectedTier} tab=${tab.id}`);
      rec.currentTier = expectedTier;
      tierCorrected++;
    }
    await moveTabToTierGroup(tab.id, expectedTier, settings);
    grouped++;
  }

  if (tierCorrected > 0) {
    await chrome.storage.local.set({ tabRecords });
  }

  // İç sayfaları "Diğer" grubuna topla (pencere başına)
  const windowIds = [...new Set(allTabs.map((t) => t.windowId))];
  for (const wid of windowIds) {
    await groupInternalTabs(wid);
  }

  log(
    `reconcile done — archived:${archived} added:${added} fixed:${fixed} relinked:${relinked} tierCorrected:${tierCorrected} grouped:${grouped}`,
  );
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

  /*
   * EN: Mini-reconcile — runs every timer tick before tier processing.
   *     Fixes stale records where the tabId no longer exists in the browser
   *     (e.g. Edge sleeping-tabs feature reassigns a new tab ID on wake).
   *     Strategy: try URL re-link first; if no match, archive to T4 immediately.
   * TR: Mini-uzlaştırma — her zamanlayıcı döngüsünde tier işleminden önce çalışır.
   *     tabId'si tarayıcıda artık bulunmayan kayıtları düzeltir
   *     (örn. Edge uyuyan sekmeler özelliği uyanışta yeni tab ID atıyor).
   *     Strateji: önce URL üzerinden yeniden bağlamayı dene; eşleşme yoksa T4'e arşivle.
   */
  {
    const allOpenTabs = await chrome.tabs.query({});
    // EN: Build set of open tab IDs and URL→tab map | TR: Açık tab ID seti ve URL→tab haritası oluştur
    const openTabIds = new Set(allOpenTabs.map((t) => t.id));
    const urlToOpenTab = {};
    for (const t of allOpenTabs) {
      if (!t.url || isBrowserInternalUrl(t.url)) continue;
      if (!urlToOpenTab[t.url] || t.id > urlToOpenTab[t.url].id)
        urlToOpenTab[t.url] = t;
    }
    // EN: Track which tabIds are already in storage to avoid re-link collisions | TR: Çakışmayı önlemek için storage'daki mevcut tabId'leri izle
    const recordedTabIds = new Set(
      Object.keys(tabRecords).map((k) => parseInt(k)),
    );

    for (const key of Object.keys(tabRecords)) {
      const rec = tabRecords[key];
      if (rec.currentTier === 4) continue; // EN: Already archived | TR: Zaten arşivde
      if (openTabIds.has(parseInt(key))) continue; // EN: Tab found, no action needed | TR: Tab bulundu, işlem gerekmez

      const matchTab = urlToOpenTab[rec.url];
      if (matchTab && !recordedTabIds.has(matchTab.id)) {
        // EN: Same URL still open but with a different tabId — re-link the record | TR: Aynı URL farklı tabId ile açık — kaydı yeniden bağla
        delete tabRecords[key];
        tabRecords[String(matchTab.id)] = {
          ...rec,
          tabId: matchTab.id,
          url: matchTab.url,
          title: matchTab.title || rec.title,
          favicon: matchTab.favIconUrl || rec.favicon,
        };
        recordedTabIds.delete(parseInt(key));
        recordedTabIds.add(matchTab.id);
        hasChanges = true;
        log(`timerCheck re-link: tabId=${key} → ${matchTab.id} url=${rec.url}`);
      } else {
        // EN: Before archiving, check restore cooldown — if we just reopened this URL
        //     it may still be loading; don't re-archive it immediately.
        // TR: Arşivlemeden önce restore bekleme süresini kontrol et — bu URL'yi yeni
        //     açtıysak hâlâ yükleniyor olabilir; hemen tekrar arşivleme.
        const restoredAt = restoringUrls.get(rec.url);
        if (restoredAt && (now - restoredAt) < RESTORE_COOLDOWN_MS) {
          log(`timerCheck skip re-archive (restore cooldown): url=${rec.url}`);
          continue;
        }
        // EN: Tab is truly gone — apply onManualClose setting | TR: Tab gerçekten yok — onManualClose ayarını uygula
        log(
          `timerCheck stale (onManualClose=${settings.onManualClose}): tabId=${key} tier=${rec.currentTier} url=${rec.url}`,
        );
        if (settings.onManualClose === "delete") {
          delete tabRecords[key];
        } else {
          rec.currentTier = 4;
          rec.lastFocusEnd = now;
        }
        hasChanges = true;
      }
    }
  }

  const TIER1_TO_2 = settings.tier1_to_tier2_minutes * 60 * 1000;
  const TIER2_TO_3 = settings.tier2_to_tier3_hours * 3600 * 1000;
  const TIER3_TO_4 = settings.tier3_to_tier4_days * 86400 * 1000;
  const TIER4_DELETE = settings.tier4_delete_days * 86400 * 1000;

  for (const tabId of Object.keys(tabRecords)) {
    const tab = tabRecords[tabId];

    // EN: Active tab (currently viewed) — skip | TR: Aktif tab (şu an bakılıyor) — atla
    if (tab.lastFocusEnd === null) continue;
    // EN: Tier 0 (Fixed) — never move | TR: Tier 0 (Sabit) — asla taşıma
    if (tab.currentTier === 0) continue;

    const elapsed = now - tab.lastFocusEnd;

    if (tab.currentTier === 4) {
      const expectedTier = calcExpectedTier(elapsed, settings);
      if (expectedTier < 4) {
        // EN: Tab is T4 but elapsed time says it should be T1/T2/T3 — incorrectly archived.
        //     Reopen and place in the correct tier. Guard against re-archive loops
        //     using restoringUrls cooldown.
        // TR: Tab T4 ama geçen süre T1/T2/T3 olması gerektiğini söylüyor — yanlış arşivlenmiş.
        //     Yeniden aç ve doğru tiere yerleştir. restoringUrls bekleme süresiyle
        //     tekrar arşivleme döngüsüne karşı koru.
        const restoredAt = restoringUrls.get(tab.url);
        if (!restoredAt || (now - restoredAt) >= RESTORE_COOLDOWN_MS) {
          try {
            const newTab = await chrome.tabs.create({ url: tab.url, active: false });
            await new Promise((r) => setTimeout(r, 500));
            restoringUrls.set(tab.url, now);
            delete tabRecords[tabId];
            tabRecords[String(newTab.id)] = {
              ...tab,
              tabId: newTab.id,
              currentTier: expectedTier,
            };
            await moveTabToTierGroup(newTab.id, expectedTier);
            hasChanges = true;
            log(`timerCheck restore T4→T${expectedTier}`, tabId, tab.url);
          } catch (e) {
            log("timerCheck restore T4 error:", e?.message, "tab", tabId);
          }
        }
      } else if (TIER4_DELETE > 0 && elapsed >= TIER4_DELETE) {
        // EN: Permanently delete from storage after the configured retention period | TR: Yapılandırılmış saklama süresi sonunda storage'dan kalıcı sil
        delete tabRecords[tabId];
        hasChanges = true;
      }
      continue;
    }

    // EN: Expected tier from elapsed time — same helper used by reconcileTabs | TR: Geçen süreden beklenen tier — reconcileTabs ile aynı yardımcı
    const expectedTier = calcExpectedTier(elapsed, settings);

    if (tab.currentTier === expectedTier) continue; // EN: Already correct | TR: Zaten doğru

    const prevTier = tab.currentTier;
    tab.currentTier = expectedTier;
    hasChanges = true;

    if (expectedTier === 4) {
      // EN: Archive: close the tab | TR: Arşiv: tab'ı kapat
      try { await chrome.tabs.remove(parseInt(tabId)); } catch (e) {}
      log(`tier T${prevTier}→T4 (archive)`, tabId, tab.url);
    } else {
      // EN: Move to the correct group — works for both demotions and corrections
      // TR: Doğru gruba taşı — hem düşürme hem düzeltme için çalışır
      await moveTabToTierGroup(parseInt(tabId), expectedTier);
      log(`tier T${prevTier}→T${expectedTier}`, tabId, tab.url);
    }
  }

  if (hasChanges) {
    // EN: Re-read before writing to catch race with onActivated.
    //     If a tab was activated while we were processing (lastFocusEnd flipped to null),
    //     our in-memory copy would overwrite that with the old tier/timestamp.
    //     Restore any such tabs from the freshly-read records before saving.
    // TR: Kaydetmeden önce storage'ı tekrar oku — onActivated ile race condition'ı yakala.
    //     İşlem sırasında bir tab aktif olduysa (lastFocusEnd → null),
    //     eski tier/zaman damgasıyla üzerine yazmayız; fresh kayıttan geri al.
    const { tabRecords: fresh = {} } = await chrome.storage.local.get("tabRecords");
    for (const id of Object.keys(tabRecords)) {
      if (fresh[id]?.lastFocusEnd === null && tabRecords[id]?.lastFocusEnd !== null) {
        tabRecords[id] = fresh[id];
      }
    }
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
// EN: Always clear and recreate the alarm on startup so interval changes take effect immediately
// TR: Interval değişikliklerinin hemen geçerli olması için alarm her başlangıçta silinip yeniden oluşturulur
chrome.alarms.clear("tierCheck", () => {
  chrome.alarms.create("tierCheck", {
    periodInMinutes: DefaultSettings.timerIntervalMinutes,
  });
  log("alarm recreated on startup, interval:", DefaultSettings.timerIntervalMinutes, "min");
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

    // EN: Reconcile browser tabs with storage — catches tabs opened while service worker was stopped
    // TR: Tarayıcı tablarını storage ile uzlaştır — servis worker duruyorken açılan tabları yakala
    await reconcileTabs();

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

      // EN: If the tab is pinned but recorded as T2/T3 (e.g. pinned after being demoted),
      //     correct it to T0 — pinned tabs cannot be in groups, so promote would always fail.
      // TR: Tab sabitlenmiş ama T2/T3 olarak kaydedilmişse (örn. düşürüldükten sonra sabitlendi)
      //     T0'a düzelt — sabitlenmiş tablar gruba eklenemez, promote her zaman başarısız olur.
      try {
        const liveTab = await chrome.tabs.get(newTabId);
        if (liveTab?.pinned && tabRecords[newTabId].currentTier !== 0) {
          tabRecords[newTabId].currentTier = 0;
          tabRecords[newTabId].isPinned = true;
          log("onActivated pinned→T0 correction", newTabId);
        }
      } catch (_) {}

      // EN: Promote from Tier 2/3/4 to Tier 1 (T0 is 0, already excluded by > 1) | TR: Tier 2/3/4'ten Tier 1'e yükselt (T0=0 olduğu için > 1 koşulu onu zaten dışlar)
      if (tabRecords[newTabId].currentTier > 1) {
        tabRecords[newTabId].currentTier = 1;
        await moveTabToTierGroup(newTabId, 1);
        log("promote →T1", newTabId);
      }
    } else {
      /*
       * EN: No record found for this tabId.
       *     First try URL-based re-link: handles the race between onReplaced and
       *     onActivated when Edge wakes a sleeping tab (both fire concurrently, so
       *     onActivated may read stale storage before onReplaced has written the new ID).
       *     If re-link succeeds, promote to T1 and move to T1 group.
       *     If no match, create a fresh T1 record.
       * TR: Bu tabId için kayıt bulunamadı.
       *     Önce URL üzerinden yeniden bağlamayı dene: Edge uyuyan sekmeyi uyandırınca
       *     onReplaced ve onActivated eş zamanlı çalışır; onActivated yeni ID yazılmadan
       *     eski storage'ı okuyabilir. Re-link başarılıysa T1'e yükselt ve grubu taşı.
       *     Eşleşme yoksa yeni T1 kaydı oluştur.
       */
      try {
        const tab = await chrome.tabs.get(newTabId);
        if (tab && tab.url && !isBrowserInternalUrl(tab.url)) {
          // EN: Look for an existing non-T4 record with the same URL | TR: Aynı URL'ye sahip T4 dışı mevcut kaydı ara
          const existingEntry = Object.entries(tabRecords).find(
            ([, rec]) => rec.url === tab.url && rec.currentTier !== 4,
          );
          if (existingEntry) {
            // EN: Re-link old record to new tabId (sleeping-tab ID change) | TR: Eski kaydı yeni tabId'ye bağla (uyuyan tab ID değişimi)
            const [oldKey, rec] = existingEntry;
            delete tabRecords[oldKey];
            tabRecords[newTabId] = {
              ...rec,
              tabId: newTabId,
              url: tab.url,
              title: tab.title || rec.title,
              favicon: tab.favIconUrl || rec.favicon,
              lastFocusStart: now,
              lastFocusEnd: null,
            };
            if (tabRecords[newTabId].currentTier > 1) {
              tabRecords[newTabId].currentTier = 1;
              await moveTabToTierGroup(newTabId, 1);
              log("onActivated re-link+promote →T1", newTabId, tab.url);
            }
          } else {
            // EN: Genuinely new tab — create a T1 record and ensure it is in the T1 group | TR: Gerçekten yeni tab — T1 kaydı oluştur ve T1 grubuna taşı
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
            if (!tab.pinned) await moveTabToTierGroup(newTabId, 1);
          }
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
      (r) =>
        r.url === newTab.url && r.tabId !== newTab.id && r.currentTier !== 4,
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
      title: newTab.title || chrome.i18n.getMessage("tabLoadingTitle"),
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
// EVENT 4: tabs.onUpdated — URL, title or group change
// =============================================================================
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const hasUrl = !!changeInfo.url;
  const hasTitle = !!changeInfo.title;
  const hasGroupId = changeInfo.groupId !== undefined;

  if (!hasUrl && !hasTitle && !hasGroupId) return;
  if (hasUrl && isBrowserInternalUrl(changeInfo.url)) return;

  try {
    const { tabRecords = {}, settings = DefaultSettings } =
      await chrome.storage.local.get(["tabRecords", "settings"]);

    if (!tabRecords[tabId]) {
      // EN: Tab was opened before the extension could track it (URL was blank on onCreated). Create a T1 record now.
      // TR: Sekme eklenti takip edemeden açıldı (onCreated anında URL boştu). Şimdi T1 kaydı oluştur.
      if (!changeInfo.url) return;
      const now = Date.now();

      // Duplicate check before creating a new record
      const dup = Object.values(tabRecords).find(
        (r) =>
          r.url === changeInfo.url && r.tabId !== tabId && r.currentTier !== 4,
      );
      if (dup && settings.duplicateAction === "redirect") {
        await chrome.tabs.remove(tabId);
        await chrome.tabs.update(dup.tabId, { active: true });
        await chrome.storage.local.set({ tabRecords });
        log("onUpdated duplicate redirect", changeInfo.url);
        return;
      }

      tabRecords[tabId] = {
        tabId,
        url: changeInfo.url,
        domain: extractDomain(changeInfo.url),
        title: tab.title || changeInfo.url,
        favicon: tab.favIconUrl || "",
        currentTier: 1,
        isPinned: false,
        lastFocusStart: now,
        lastFocusEnd: now,
        createdAt: now,
      };
      await moveTabToTierGroup(tabId, 1);
      await chrome.storage.local.set({ tabRecords });
      log("onUpdated created missing record T1", tabId, changeInfo.url);
      return;
    }

    if (hasUrl) {
      tabRecords[tabId].url = changeInfo.url;
      tabRecords[tabId].domain = extractDomain(changeInfo.url);
    }
    if (hasTitle) {
      tabRecords[tabId].title = changeInfo.title;
    }
    if (hasUrl && tab.favIconUrl) {
      tabRecords[tabId].favicon = tab.favIconUrl;
    }

    // EN: Tab was manually dragged into a different group — sync tier from group color | TR: Sekme farklı bir gruba sürüklendi, grup renginden kademeyi güncelle
    if (hasGroupId) {
      const newGroupId = changeInfo.groupId;
      if (newGroupId === -1) {
        if (extensionMovingTabs.has(tabId)) {
          // EN: Extension is moving this tab between groups — Edge fires groupId:-1 first,
          //     then the target groupId. Ignore this intermediate event; do NOT reset
          //     lastFocusEnd or tier. The follow-up event will handle the final state.
          // TR: Extension bu tab'ı gruplar arasında taşıyor — Edge önce groupId:-1 sonra
          //     hedef groupId'yi tetikler. Bu ara olayı yoksay; lastFocusEnd veya tier
          //     sıfırlanmasın. Asıl durum sonraki event'te işlenecek.
          log("onUpdated ungrouped (extension move, ignored)", tabId);
        } else if (tabRecords[tabId].currentTier !== 0) {
          // EN: User manually dragged tab out of all groups — treat as T1 | TR: Kullanıcı tab'ı tüm gruplardan çıkardı — T1 yap
          tabRecords[tabId].currentTier = 1;
          tabRecords[tabId].lastFocusEnd = Date.now();
          log("onUpdated ungrouped → T1", tabId);
        }
      } else {
        try {
          const group = await chrome.tabGroups.get(newGroupId);
          const tier = COLOR_TO_TIER[group.color];
          if (tier !== undefined && tier !== tabRecords[tabId].currentTier) {
            tabRecords[tabId].currentTier = tier;
            tabRecords[tabId].isPinned = tier === 0;
            if (tier !== 0) {
              if (extensionMovingTabs.has(tabId)) {
                // EN: Extension moved this tab (tier transition) — do NOT touch lastFocusEnd,
                //     the original inactivity timestamp must be preserved.
                // TR: Bu tab'ı extension taşıdı (tier geçişi) — lastFocusEnd'e dokunma,
                //     orijinal hareketsizlik zaman damgası korunmalı.
                extensionMovingTabs.delete(tabId);
              } else {
                // EN: User manually dragged tab to a different group — sync lastFocusEnd
                // TR: Kullanıcı tab'ı farklı gruba sürükledi — lastFocusEnd'i senkronize et
                tabRecords[tabId].lastFocusEnd = tab.active ? null : Date.now();
              }
            }
            log("onUpdated group drag → T" + tier, tabId, group.color);
          }
        } catch (e) {
          // Group may have been dissolved — ignore
        }
      }
    }

    await chrome.storage.local.set({ tabRecords });
  } catch (e) {
    log("onUpdated error:", e?.message);
  }
});

// =============================================================================
// EVENT 5: tabs.onReplaced — tab ID changed after Edge sleeping-tabs wake or restore
// =============================================================================
chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
  try {
    const { tabRecords = {} } = await chrome.storage.local.get("tabRecords");
    const key = String(removedTabId);
    if (!tabRecords[key]) return; // EN: No record for old ID, nothing to do | TR: Eski ID için kayıt yok, işlem gerekmez

    // EN: Move the record to the new tab ID, preserving all tier/timing data | TR: Kaydı yeni tab ID'ye taşı, tüm tier/zamanlama verilerini koru
    const rec = tabRecords[key];
    tabRecords[String(addedTabId)] = { ...rec, tabId: addedTabId };
    delete tabRecords[key];

    await chrome.storage.local.set({ tabRecords });
    log(
      `onReplaced: re-linked tabId ${removedTabId} → ${addedTabId} url=${rec.url}`,
    );
  } catch (e) {
    log("onReplaced error:", e?.message);
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
                // EN: Start the inactivity timer from now | TR: Hareketsizlik zamanlayıcısını şu andan başlat
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

    case "OPEN_AS_T1": {
      // EN: Open a closed/archived tab as T1: delete the old record so the stale
      //     entry is gone, then create a new active tab — onActivated will create
      //     the T1 record automatically and trigger a Tab Management refresh.
      // TR: Kapalı/arşiv tab'ı T1 olarak aç: eski kaydı sil (stale giriş kalmasın),
      //     sonra yeni aktif tab oluştur — onActivated T1 kaydını otomatik oluşturup
      //     Tab Management'i yeniler.
      (async () => {
        try {
          const { url, oldKey } = request;
          if (oldKey) {
            const { tabRecords = {} } = await chrome.storage.local.get("tabRecords");
            if (tabRecords[oldKey]) {
              delete tabRecords[oldKey];
              await chrome.storage.local.set({ tabRecords });
            }
          }
          const newTab = await chrome.tabs.create({ url, active: true });
          sendResponse({ ok: true, tabId: newTab.id });
        } catch (e) {
          sendResponse({ ok: false, error: e?.message });
        }
      })();
      return true;
    }

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
