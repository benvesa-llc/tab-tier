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

// EN: Cache locale-aware group name defaults; keyed by language code
// TR: Dil koduna göre anahtarlanan locale farkında grup adı önbelleği
let _localeNameCache = { lang: null, names: null };

async function resolveDefaultGroupNames(settings) {
  const lang = settings.uiLanguage;
  if (!lang || lang === "auto") return DefaultGroupNames;
  if (_localeNameCache.lang === lang) return _localeNameCache.names;
  try {
    const resp = await fetch(chrome.runtime.getURL(`_locales/${lang}/messages.json`));
    if (!resp.ok) return DefaultGroupNames;
    const msgs = await resp.json();
    const names = {
      0: msgs.defaultGroupT0?.message || DefaultGroupNames[0],
      1: msgs.defaultGroupT1?.message || DefaultGroupNames[1],
      2: msgs.defaultGroupT2?.message || DefaultGroupNames[2],
      3: msgs.defaultGroupT3?.message || DefaultGroupNames[3],
    };
    _localeNameCache = { lang, names };
    return names;
  } catch (e) {
    return DefaultGroupNames;
  }
}

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
  theme: "dark",
  // EN: Empty by default — i18n defaults are resolved at runtime, not stored
  // TR: Varsayılan olarak boş — i18n varsayılanları çalışma zamanında çözülür, saklanmaz
  groupNames: {},
  // EN: Auto-sort tabs by "Tier + Elapsed" on every timerCheck alarm tick. Off by default
  //     because re-shuffling tabs while the user is browsing is jarring; opt-in via Settings.
  // TR: Her timerCheck alarmında "Tier + Geçen Süre" ile sekmeleri otomatik sırala. Varsayılan kapalı —
  //     kullanıcı gezerken sekmelerin altından kayması rahatsız edici, Ayarlar'dan opt-in.
  autoSortByElapsed: false,
  // EN: User-customized order of Statistics cards (drag-drop persisted). Empty array = default order.
  // TR: İstatistik kartlarının kullanıcı tarafından özelleştirilen sırası (sürükle-bırak ile kaydedilir).
  //     Boş dizi = varsayılan sıra.
  statsCardOrder: [],
  // EN: Per-card width in quarters (1=¼, 2=½, 3=¾, 4=full). Empty object = use defaults from tab-management.js.
  // TR: Çeyrek bazlı kart genişlikleri (1=¼, 2=½, 3=¾, 4=tam). Boş obje = tab-management.js'teki varsayılanlar.
  statsCardWidths: {},
  // EN: Per-card label-column width (px) on Statistics bar charts. { cardId: px } — each card
  //     can be resized independently. Missing entry / out-of-range value falls back to 180.
  // TR: İstatistik bar grafiklerinde kart başına etiket sütunu genişliği (px).
  //     { cardId: px } — her kart bağımsız boyutlanabilir. Eksik / hatalı değer 180'e döner.
  statsBarLabelWidths: {},
  initialized: false,
};

// EN: Currently active tab ID (in-memory only, not in storage) | TR: Şu an aktif tab ID'si (sadece bellekte)
let currentActiveTabId = null;

// EN: Tab IDs currently being moved by the extension — onUpdated must not overwrite lastFocusEnd
//     for these. A late-firing onUpdated (Chrome's async event scheduling can deliver the event
//     after our move's await has already resolved and the calling code has cleared the flag)
//     would otherwise hit the "user drag" branch and reset lastFocusEnd to now. To prevent that
//     we additionally track a per-tab expiry timestamp; isExtensionMove() returns true while
//     the Set has the id OR the expiry is still in the future. clearExtensionMove() only removes
//     from the Set — the expiry entry naturally times out via EXT_MOVE_GRACE_MS.
// TR: Extension'ın taşıdığı tab ID'leri — bunlar için onUpdated lastFocusEnd'i yazmamalı. Geç
//     ateşleyen onUpdated (Chrome'un async event schedule'ı bizim move'un await'i çözüldükten ve
//     çağıran kod flag'i temizledikten SONRA event'i ulaştırabiliyor) "user drag" dalına düşüp
//     lastFocusEnd'i now'a sıfırlardı. Bunu önlemek için her tab başına bir expiry zaman damgası
//     daha tutuyoruz; isExtensionMove() Set'te varsa VEYA expiry hâlâ gelecekteyse true döner.
//     clearExtensionMove() yalnız Set'ten siler — expiry kaydı EXT_MOVE_GRACE_MS sonra düşer.
const extensionMovingTabs = new Set();
const extensionMovingExpiry = new Map(); // tabId → expiry timestamp (ms)
const EXT_MOVE_GRACE_MS = 3000;

function markExtensionMove(tabId) {
  extensionMovingTabs.add(tabId);
  extensionMovingExpiry.set(tabId, Date.now() + EXT_MOVE_GRACE_MS);
}

function isExtensionMove(tabId) {
  if (extensionMovingTabs.has(tabId)) return true;
  const exp = extensionMovingExpiry.get(tabId);
  if (exp) {
    if (exp > Date.now()) return true;
    extensionMovingExpiry.delete(tabId);
  }
  return false;
}

function clearExtensionMove(tabId) {
  // EN: Remove from Set only — keep expiry entry for the grace period | TR: Yalnızca Set'ten sil — expiry kaydı grace süresi için kalır
  extensionMovingTabs.delete(tabId);
}

// EN: Per-window mutex — serializes group find-or-create to prevent duplicate groups
//     when multiple tabs are moved to the same tier concurrently (e.g. session restore).
// TR: Pencere başına mutex — eş zamanlı grup oluşturma yarış koşulunu önler;
//     aynı anda birden fazla tab aynı tier'a taşınırken yinelenen grup oluşmasını engeller.
const _windowGroupLocks = new Map(); // windowId → Promise<void>

function acquireWindowLock(windowId) {
  let release;
  const lock = new Promise(r => { release = r; });
  const prev = _windowGroupLocks.get(windowId) ?? Promise.resolve();
  _windowGroupLocks.set(windowId, prev.then(() => lock, () => lock));
  return prev.then(() => release, () => release);
}

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

// ─── Stats aggregation ───────────────────────────────────────────────────────
// EN: `statsAggregate` is a separate storage key (does NOT touch tabRecords)
//     populated whenever a focus session ends, a tab is opened, or a tab is
//     archived. Cumulative domain-level focus time + 24-hour activity buckets
//     + last-30-day rolling daily counts. Powers the Statistics view.
// TR: `statsAggregate` ayrı bir storage anahtarı (tabRecords'a dokunmaz);
//     odak oturumu bittiğinde, sekme açıldığında veya arşivlendiğinde güncellenir.
//     Domain bazında toplam odak süresi + 24-saat aktivite kovaları + son 30 gün
//     günlük sayımları. İstatistikler görünümünü besler.

const STATS_RETAIN_DAYS = 30;
const STATS_MIN_FOCUS_MS = 1000;          // EN: ignore <1s blur-and-back blips | TR: <1s'lik kısa odak değişimlerini yok say
const STATS_MAX_FOCUS_MS = 12 * 3600 * 1000; // EN: cap one session at 12h to ignore overnight tabs | TR: tek oturumu 12 saatle sınırla (gece açık kalanları sayma)

function statsDayKey(d = new Date()) {
  const y  = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

// EN: Strip query string + fragment from URL before using it as a stats key. Keeps the path
//     so `github.com/anthropics/anthropic-sdk-python` and `…-typescript` stay distinct, but
//     drops search queries and hashes that would otherwise inflate the URL set and leak
//     potentially-sensitive data into stats storage.
// TR: URL'yi stat anahtarı yapmadan önce query string ve fragment'ı at. Yol kalır
//     (`github.com/anthropics/anthropic-sdk-python` ile `…-typescript` ayrı kalsın), ama
//     arama sorguları ve hash'ler atılır — URL kümesini şişirir ve potansiyel hassas veriyi
//     stat depolamasına sızdırırdı.
// EN: Persistent domain → favicon cache so the Statistics view can still draw an icon next to
//     a domain whose live tab record has been closed and garbage-collected. Without this, a
//     domain only present in `statsAggregate` falls back to Chrome's built-in favicon API,
//     which only knows the icon if Chrome itself currently caches it — short-lived tabs miss.
//     Writes are debounced 500ms so a burst of favicon updates collapses into a single set().
// TR: Kalıcı domain → favicon önbelleği. Canlı tab kaydı silinmiş bir domain'in İstatistikler'de
//     hâlâ ikon görmesi için. Bu olmadan yalnızca statsAggregate'te kalan domainler Chrome'un
//     built-in favicon API'sine düşer; Chrome o anda cache'te tutuyorsa ikon gelir, kısa ömürlü
//     tablar kaçırılır. Yazmalar 500ms debounce — favicon güncelleme patlamaları tek set()'e iner.
let _domainFaviconCache = null;
let _domainFaviconWriteTimer = null;

async function rememberDomainFavicon(domain, favicon) {
  if (!domain || !favicon) return;
  try {
    if (!_domainFaviconCache) {
      const { domainFavicons = {} } = await chrome.storage.local.get("domainFavicons");
      _domainFaviconCache = domainFavicons;
    }
    if (_domainFaviconCache[domain] === favicon) return;
    _domainFaviconCache[domain] = favicon;
    if (!_domainFaviconWriteTimer) {
      _domainFaviconWriteTimer = setTimeout(async () => {
        _domainFaviconWriteTimer = null;
        try { await chrome.storage.local.set({ domainFavicons: _domainFaviconCache }); }
        catch (_) {}
      }, 500);
    }
  } catch (_) {}
}

function normalizeUrlForStats(url) {
  if (!url) return "—";
  try {
    const u = new URL(url);
    return u.protocol + "//" + u.host + u.pathname;
  } catch (e) {
    return url;
  }
}

async function loadStatsAggregate() {
  const { statsAggregate = null } = await chrome.storage.local.get("statsAggregate");
  const stats = statsAggregate || {};
  if (!stats.domainFocusMs) stats.domainFocusMs = {};
  if (!stats.urlFocusMs) stats.urlFocusMs = {};
  if (!Array.isArray(stats.hourlyActivity) || stats.hourlyActivity.length !== 24) {
    stats.hourlyActivity = new Array(24).fill(0);
  }
  if (!stats.daily) stats.daily = {};
  stats.schemaVersion = 2;
  return stats;
}

function pruneOldDaily(stats) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - STATS_RETAIN_DAYS);
  const cutoffKey = statsDayKey(cutoff);
  for (const k of Object.keys(stats.daily)) {
    if (k < cutoffKey) delete stats.daily[k];
  }
}

function ensureDailyBucket(stats, key = statsDayKey()) {
  if (!stats.daily[key]) {
    stats.daily[key] = { opened: 0, archived: 0, focusMs: 0, domainFocusMs: {}, urlFocusMs: {} };
  } else {
    // EN: Lazily backfill new fields on older buckets created by schema v1 | TR: Eski bucket'larda yeni alanları geç-doldur
    if (!stats.daily[key].domainFocusMs) stats.daily[key].domainFocusMs = {};
    if (!stats.daily[key].urlFocusMs) stats.daily[key].urlFocusMs = {};
  }
  return stats.daily[key];
}

async function recordFocusEnd(rec, endTime) {
  if (!rec || !rec.lastFocusStart) return;
  const delta = endTime - rec.lastFocusStart;
  if (delta < STATS_MIN_FOCUS_MS || delta > STATS_MAX_FOCUS_MS) return;
  try {
    const stats = await loadStatsAggregate();
    const domain = (rec.domain || "—").trim() || "—";
    const urlKey = normalizeUrlForStats(rec.url);
    // Cumulative all-time
    stats.domainFocusMs[domain] = (stats.domainFocusMs[domain] || 0) + delta;
    stats.urlFocusMs[urlKey] = (stats.urlFocusMs[urlKey] || 0) + delta;
    // Hourly histogram
    const hour = new Date(rec.lastFocusStart).getHours();
    if (hour >= 0 && hour < 24) stats.hourlyActivity[hour]++;
    // Daily bucket (totals + per-domain + per-url) — supports last-N-days filters
    const bucket = ensureDailyBucket(stats);
    bucket.focusMs += delta;
    bucket.domainFocusMs[domain] = (bucket.domainFocusMs[domain] || 0) + delta;
    bucket.urlFocusMs[urlKey] = (bucket.urlFocusMs[urlKey] || 0) + delta;
    pruneOldDaily(stats);
    await chrome.storage.local.set({ statsAggregate: stats });
  } catch (e) { log("recordFocusEnd error:", e?.message); }
}

async function recordTabOpened() {
  try {
    const stats = await loadStatsAggregate();
    ensureDailyBucket(stats).opened++;
    pruneOldDaily(stats);
    await chrome.storage.local.set({ statsAggregate: stats });
  } catch (e) { log("recordTabOpened error:", e?.message); }
}

async function recordTabArchived(count = 1) {
  if (count <= 0) return;
  try {
    const stats = await loadStatsAggregate();
    ensureDailyBucket(stats).archived += count;
    pruneOldDaily(stats);
    await chrome.storage.local.set({ statsAggregate: stats });
  } catch (e) { log("recordTabArchived error:", e?.message); }
}

async function clearStatsAggregate() {
  await chrome.storage.local.set({
    statsAggregate: {
      domainFocusMs: {},
      urlFocusMs: {},
      hourlyActivity: new Array(24).fill(0),
      daily: {},
      schemaVersion: 2,
    },
  });
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
    const localeDefaults = await resolveDefaultGroupNames(settings);
    const groupNames = { ...localeDefaults, ...customNames };
    const title = groupNames[tier];
    const color = TIER_GROUP_COLORS[tier];

    const tab = await chrome.tabs.get(tabId);
    if (!tab) return;
    // EN: Pinned tabs cannot be added to groups — Chrome/Edge API rejects the call | TR: Sabitlenmiş tablar gruba eklenemez — Chrome/Edge API çağrısını reddeder
    if (tab.pinned) return;

    // EN: Mark this tab as being moved by the extension so onUpdated won't reset lastFocusEnd
    // TR: Bu tab'ı extension tarafından taşınıyor olarak işaretle; onUpdated lastFocusEnd'i sıfırlamasın
    markExtensionMove(tabId);

    // EN: Acquire per-window lock before querying/creating groups to prevent
    //     concurrent calls from each seeing "no group yet" and creating duplicates.
    // TR: Grup sorgusu/oluşturma öncesi pencere kilidini al; eş zamanlı çağrıların
    //     her birinin "grup yok" görüp yinelenen grup açmasını önler.
    const release = await acquireWindowLock(tab.windowId);
    try {
      const groups = await chrome.tabGroups.query({ windowId: tab.windowId });
      // EN: Match by color — finds the correct group even if its title was renamed | TR: Renk üzerinden eşleştir: title değişmiş olsa bile doğru grubu bulur
      const targetGroup = groups.find((g) => g.color === color);

      if (targetGroup) {
        // EN: Keep group title in sync with current settings | TR: Grup adını ayarlarla senkronize tut
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
    } finally {
      release();
    }
  } catch (e) {
    // EN: Always clean up the moving-flag on error so future onUpdated events are not ignored
    //     (the grace-period expiry still protects late events from this attempt)
    // TR: Hata durumunda taşıma bayrağını temizle; sonraki onUpdated olayları yoksayılmasın
    //     (bu denemeden kaynaklı geç event'ler grace expiry tarafından hâlâ korunur)
    clearExtensionMove(tabId);

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
  } else if (sortType === "elapsed") {
    // EN: Elapsed ascending — least inactive first; T0 sorted by lastFocusEnd asc
    // TR: Elapsed artan — en az hareketsiz olan önce; T0 lastFocusEnd artan
    const now = Date.now();
    const elapsedOf = (tab) => {
      const rec = tabRecords[tab.id];
      if (!rec || rec.lastFocusEnd == null) return 0;
      return now - rec.lastFocusEnd;
    };
    const byElapsed = (a, b) => {
      const ea = elapsedOf(a), eb = elapsedOf(b);
      if (ea !== eb) return ea - eb;
      return (tabRecords[b.id]?.lastFocusEnd ?? 0) - (tabRecords[a.id]?.lastFocusEnd ?? 0);
    };
    // EN: T0 tabs show "—" for elapsed; sort them by lastFocusEnd descending (most recently focused first),
    //     matching popup and Tab Management behaviour.
    // TR: T0 sekmeler elapsed için "—" gösterir; lastFocusEnd azalan sırala (en son odaklanan önce),
    //     popup ve Tab Yönetimi davranışıyla uyumlu.
    sortedT0 = [...t0Tabs].sort((a, b) =>
      (tabRecords[b.id]?.lastFocusEnd ?? 0) - (tabRecords[a.id]?.lastFocusEnd ?? 0)
    );
    sorted = [...restTabs].sort((a, b) => {
      const ta = tabRecords[a.id]?.currentTier ?? 1;
      const tb = tabRecords[b.id]?.currentTier ?? 1;
      if (ta !== tb) return ta - tb;
      return byElapsed(a, b);
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

  const finalOrder = [...sortedT0, ...sorted, ...internalTabs];
  const startIndex = browserPinned.length;

  // EN: Mark every tab that we're about to shuffle as an "extension move" BEFORE the first
  //     tabs.move call. Without this flag set, chrome.tabs.move can land a tab momentarily
  //     between two tabs of a different tier group; Chrome auto-assigns it to that adjacent
  //     group based on physical proximity and fires onUpdated(groupId) with the new color.
  //     Our onUpdated handler, seeing no flag, would treat it as a user drag and reset the
  //     tab's lastFocusEnd to Date.now() — making 4-5 sleeping tabs collapse to "T1 with the
  //     same fresh timestamp" after Apply. The pre-set flag keeps lastFocusEnd intact.
  // TR: Karıştıracağımız tüm tabları ilk tabs.move'dan ÖNCE "extension move" olarak işaretle.
  //     Bu flag olmadan, chrome.tabs.move bir tabı kısa süreliğine farklı bir tier grubunun
  //     iki tabı arasına bırakabilir; Chrome fiziksel yakınlığa göre o gruba otomatik atar
  //     ve yeni renkle onUpdated(groupId) ateşler. onUpdated handler, flag göremeyince
  //     user-drag sayar ve lastFocusEnd'i Date.now()'a sıfırlar — Apply sonrası 4-5 uyuyan
  //     tab "aynı taze zaman damgasıyla T1'de" görünüyordu. Önceden set'lenen flag korur.
  const allMovingIds = finalOrder.map((t) => t.id);
  allMovingIds.forEach((id) => markExtensionMove(id));

  try {
    // EN: Move the T0 group to the front first so that individual tabs.move calls
    //     land within the group's span — Chrome keeps grouped tabs in their group
    //     only when the target index is inside the group's current contiguous range.
    // TR: T0 grubunu önce öne taşı; böylece tabs.move çağrıları grubun aralığı
    //     içinde kalır — Chrome, hedef indeks grubun aralığındaysa sekmeyi grupta tutar.
    const allGroups = await chrome.tabGroups.query({ windowId });
    const t0Group = allGroups.find((g) => g.color === TIER_GROUP_COLORS[0]);
    if (t0Group && sortedT0.length > 0) {
      try {
        await chrome.tabGroups.move(t0Group.id, { index: startIndex });
      } catch (e) {
        log("sortTabsInWindow t0Group move error:", e?.message);
      }
    }

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
  } finally {
    // EN: Clean up flags from the Set; grace expiry on each tab still absorbs any late-firing
    //     onUpdated events for ~3 seconds, so the user-drag branch can't reset lastFocusEnd.
    // TR: Set'ten flag'leri temizle; her tabın grace expiry'si ~3 saniye boyunca geç gelen
    //     onUpdated event'lerini soğurur, user-drag dalı lastFocusEnd'i sıfırlayamaz.
    allMovingIds.forEach((id) => clearExtensionMove(id));
  }

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
  // EN: Same filter as moveTabToTierGroup — drop system-default-looking names (T0:/T1: prefix)
  //     so locale defaults always win when the user hasn't set a custom name
  // TR: moveTabToTierGroup ile aynı filtre — T0:/T1: önekli sistem adlarını at;
  //     kullanıcı özel ad belirlemediyse locale varsayılanları kazansın
  const customNames = Object.fromEntries(
    Object.entries(settings.groupNames || {}).filter(
      ([, v]) => v?.trim() && !/^T[0-3]:/.test(v.trim())
    )
  );
  const localeDefaults = await resolveDefaultGroupNames(settings);
  const groupNames = { ...localeDefaults, ...customNames };

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
async function dedupRecords(keepKeys = {}) {
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

  for (const [url, entries] of Object.entries(byUrl)) {
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
    // EN: Use user-chosen key if provided, else auto (first after sort)
    // TR: Kullanıcının seçtiği kayıt varsa onu kullan, yoksa otomatik (sıralamada ilk)
    const chosenKey = keepKeys[url];
    const keepEntry = chosenKey ? (entries.find(e => e.key === chosenKey) || entries[0]) : entries[0];
    const keep = keepEntry;
    const dupes = entries.filter(e => e.key !== keepEntry.key);

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
// EN: Merge duplicate tab groups that share the same color within a window.
//     Keeps the first (lowest-index) group and moves all other tabs into it.
//     This heals duplicate groups created before the per-window lock was introduced.
// TR: Aynı pencerede aynı rengi paylaşan yinelenen tab gruplarını birleştir.
//     İlk (en düşük indisli) grubu tutar, diğer tüm tabları o gruba taşır.
async function mergeDuplicateColorGroups(windowId) {
  try {
    const groups = await chrome.tabGroups.query({ windowId });
    const byColor = new Map();
    for (const g of groups) {
      if (!byColor.has(g.color)) byColor.set(g.color, []);
      byColor.get(g.color).push(g);
    }
    for (const [, colorGroups] of byColor) {
      if (colorGroups.length <= 1) continue;
      colorGroups.sort((a, b) => a.id - b.id);
      const primary = colorGroups[0];
      for (const dupe of colorGroups.slice(1)) {
        const dupeTabs = await chrome.tabs.query({ windowId, groupId: dupe.id });
        if (dupeTabs.length > 0) {
          await chrome.tabs.group({ tabIds: dupeTabs.map(t => t.id), groupId: primary.id });
        }
      }
    }
  } catch (e) {
    log("mergeDuplicateColorGroups error:", e?.message);
  }
}

// =============================================================================
// rekeyRecordsByUrl: Re-key tabRecords by pairing URLs with currently-open tabs.
//
// EN: After a browser restart, Chrome reassigns tabIds starting from low numbers, so a record
//     stored under tabId=5 may now point to a completely different tab — or the previously open
//     tab with that record's URL is now at a brand-new tabId. Trusting tabId as the record key is
//     unsafe in that scenario. This function pairs records to open tabs by URL and rewrites the
//     records map so every open restored tab inherits its previous record (tier, lastFocusEnd,
//     createdAt all preserved). Idempotent — when keys already match the live tabs, no changes
//     are made. Safe to call on every service-worker startup.
// TR: Browser restart sonrası Chrome tabId'leri düşük sayılardan başlayarak yeniden atar; bu yüzden
//     tabId=5 altında saklanan bir kayıt artık tamamen farklı bir sekmeye işaret edebilir — ya da
//     o kaydın URL'sine sahip eski açık sekme şimdi yepyeni bir tabId'de olabilir. Bu senaryoda
//     tabId'yi anahtar olarak güvenmek riskli. Bu fonksiyon kayıtları URL ile açık sekmelere eşler
//     ve kayıt haritasını yeniden yazar; restore edilen her açık sekme önceki kaydını miras alır
//     (tier, lastFocusEnd, createdAt korunur). Idempotent — anahtarlar zaten canlı sekmelerle
//     uyumluysa hiçbir şey değişmez. Her servis worker başlangıcında çağrılabilir.
// =============================================================================
async function rekeyRecordsByUrl() {
  const { tabRecords = {} } = await chrome.storage.local.get("tabRecords");
  const allTabs = await chrome.tabs.query({});
  const tabById = new Map(allTabs.map((t) => [t.id, t]));

  // EN: Group open tabs by URL — supports multiple open tabs with the same URL | TR: Açık sekmeleri URL'ye göre grupla — aynı URL'de birden fazla açık sekme destekli
  const urlToTabs = new Map();
  for (const tab of allTabs) {
    if (!tab.url || isBrowserInternalUrl(tab.url)) continue;
    if (!urlToTabs.has(tab.url)) urlToTabs.set(tab.url, []);
    urlToTabs.get(tab.url).push(tab);
  }

  const newRecords = {};
  const consumedKeys = new Set();
  const consumedTabIds = new Set();
  const now = Date.now();
  let kept = 0, relinked = 0;

  // EN: Phase 1 — record key matches a currently-open tab AND URLs match: keep at same key (no change)
  // TR: Aşama 1 — kayıt anahtarı açık bir sekmeyle eşleşiyor VE URL'ler aynı: aynı anahtarda kal (değişiklik yok)
  for (const [key, rec] of Object.entries(tabRecords)) {
    if (rec.currentTier === 4) continue;
    const intKey = parseInt(key);
    const openTab = tabById.get(intKey);
    if (openTab && openTab.url === rec.url) {
      newRecords[key] = rec;
      consumedKeys.add(key);
      consumedTabIds.add(intKey);
      kept++;
    }
  }

  // EN: Phase 2 — remaining non-T4 records: pair to an open tab by URL (handles tabId reuse after restart)
  // TR: Aşama 2 — kalan T4 olmayan kayıtlar: URL ile açık bir sekmeye bağla (restart sonrası tabId yeniden kullanımını yakalar)
  for (const [key, rec] of Object.entries(tabRecords)) {
    if (consumedKeys.has(key)) continue;
    if (rec.currentTier === 4) continue;
    const candidates = (urlToTabs.get(rec.url) || []).filter((t) => !consumedTabIds.has(t.id));
    if (candidates.length === 0) continue;
    const tab = candidates[0];
    newRecords[tab.id] = {
      ...rec,
      tabId: tab.id,
      title: tab.title || rec.title,
      favicon: tab.favIconUrl || rec.favicon,
      isPinned: tab.pinned || rec.isPinned,
    };
    consumedKeys.add(key);
    consumedTabIds.add(tab.id);
    relinked++;
  }

  // EN: Phase 3 — T4 archive records: keep, but use a synthetic key when the original key collides with a live tabId
  // TR: Aşama 3 — T4 arşiv kayıtları: koru, ancak orijinal anahtar canlı bir tabId ile çakışıyorsa sentetik anahtar kullan
  for (const [key, rec] of Object.entries(tabRecords)) {
    if (consumedKeys.has(key)) continue;
    if (rec.currentTier !== 4) continue;
    const intKey = parseInt(key);
    const collides = !isNaN(intKey) && consumedTabIds.has(intKey);
    const finalKey = collides ? `arch_${key}_${now}` : key;
    newRecords[finalKey] = rec;
    consumedKeys.add(key);
  }

  // EN: Phase 4 — remaining unmatched non-T4 records (URL not currently open): keep with synthetic key when colliding so reconcile can handle them
  // TR: Aşama 4 — kalan eşleşmemiş T4 olmayan kayıtlar (URL şu an açık değil): çakışıyorsa sentetik anahtar ile koru, reconcile'in halletmesi için
  for (const [key, rec] of Object.entries(tabRecords)) {
    if (consumedKeys.has(key)) continue;
    const intKey = parseInt(key);
    const collides = !isNaN(intKey) && consumedTabIds.has(intKey);
    const finalKey = collides ? `orphan_${key}_${now}` : key;
    newRecords[finalKey] = rec;
    consumedKeys.add(key);
  }

  await chrome.storage.local.set({ tabRecords: newRecords });
  if (relinked > 0) {
    log(`rekeyByUrl: kept=${kept} relinked=${relinked} (browser restart or tabId reuse detected)`);
  }
}

// =============================================================================
// reconcileTabs: Storage'ı gerçek açık tablarla eşitle + grupları uygula
//   - Kapalı tab'ların kayıtlarını HER ZAMAN T4'e gönder (sil değil)
//   - Açık ama kayıtsız tab'lara yeni kayıt ekle
//   - Stale null'ları (gerçekte aktif olmayan) düzelt
//   - Açık tüm kayıtlı tab'ları doğru tier grubuna taşı
// =============================================================================
async function reconcileTabs() {
  // EN: First pass — re-key records by URL so tabId-reuse after browser restart is handled correctly.
  //     Idempotent: when nothing changed (extension reload, SW restart) this is a no-op.
  // TR: İlk geçiş — URL bazlı yeniden anahtarlama; browser restart sonrası tabId yeniden kullanımı doğru işlensin.
  //     Idempotent: hiçbir şey değişmediyse (extension reload, SW restart) hiç bir etkisi olmaz.
  await rekeyRecordsByUrl();

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
      // EN: Tab is gone — leave the record at its current tier (do NOT auto-archive to T4).
      //     The user's mental model is that the tier represents recency-of-use; a closed T2 tab
      //     should keep showing as T2 in Tab Management until natural tier promotion (T2→T3→T4)
      //     ages it out via elapsed-time thresholds in timerCheck. Deletion still happens through
      //     tabs.onRemoved (which respects onManualClose) for explicit user closures.
      // TR: Sekme yok — kaydı mevcut tier'ında bırak (T4'e otomatik arşivleme YAPMA).
      //     Kullanıcı modeli: tier kullanım yakınlığını temsil eder; kapanmış bir T2 sekme,
      //     timerCheck'teki geçen süre eşikleri ile doğal tier yükselmesi (T2→T3→T4) gerçekleşene
      //     kadar Tab Management'ta T2 olarak görünmeli. Silme yine tabs.onRemoved üzerinden olur
      //     (orası onManualClose'a uyar) — manuel kapatma için.
      // Just preserve lastFocusEnd if it was null
      if (rec.lastFocusEnd === null) rec.lastFocusEnd = now;
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
    // EN: Merge any duplicate same-color groups left over from previous race conditions
    // TR: Önceki yarış koşullarından kalan aynı renkli yinelenen grupları birleştir
    await mergeDuplicateColorGroups(wid);
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
        // EN: Tab is gone — leave the record at its current tier. Same rationale as reconcile:
        //     a closed T2 tab should remain visible as T2 in Tab Management until natural tier
        //     promotion ages it out. Explicit closures still go through tabs.onRemoved.
        // TR: Sekme yok — kaydı mevcut tier'ında bırak. reconcile ile aynı gerekçe:
        //     kapanmış bir T2 sekme, doğal tier yükselmesi gerçekleşene kadar Tab Management'ta
        //     T2 olarak görünmeli. Manuel kapatma yine tabs.onRemoved üzerinden işlenir.
        if (rec.lastFocusEnd === null) {
          rec.lastFocusEnd = now;
          hasChanges = true;
        }
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
      recordTabArchived();
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

  // EN: Auto-sort by "Tier + Elapsed" on every alarm tick when the user opted in.
  //     This keeps the most recently used tabs at the top of each tier group automatically.
  //     Sorts every window so multi-window layouts stay consistent.
  // TR: Kullanıcı opt-in ettiyse her alarm tick'inde "Tier + Geçen Süre" ile otomatik sırala.
  //     En son kullanılan sekmeler her tier grubunun en üstünde otomatik kalır.
  //     Çoklu pencere düzenleri tutarlı kalsın diye her pencere ayrı sıralanır.
  if (settings.autoSortByElapsed) {
    try {
      const windows = await chrome.windows.getAll();
      for (const win of windows) {
        try { await sortTabsInWindow(win.id, "elapsed"); }
        catch (e) { log("autoSort window error:", win.id, e?.message); }
      }
    } catch (e) {
      log("autoSort error:", e?.message);
    }
  }
}

// =============================================================================
// onInstalled: First install / update
// =============================================================================
chrome.runtime.onInstalled.addListener(async (details) => {
  const { settings: existingSettings = {} } =
    await chrome.storage.local.get("settings");

  // EN: On update, NEVER touch tabRecords — elapsed times must survive extension reloads.
  //     Only a true first install (reason="install") should create tab records.
  //     Previous versions never wrote initialized=true, so do not rely on that flag;
  //     rely solely on the install reason provided by the browser.
  // TR: Güncellemede tabRecords'a ASLA dokunma — geçen süreler uzantı yüklemelerinde korunmalı.
  //     Yalnızca gerçek ilk kurulum (reason="install") sekme kayıtları oluşturmalı.
  if (details.reason === "install") {
    log("Fresh install — scanning tabs");

    const mergedSettings = { ...DefaultSettings, ...existingSettings, initialized: true };
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
        lastFocusEnd: now,
        createdAt: now,
      };
    }

    // EN: Don't reset the active tab's timer | TR: Aktif sekmenin zamanlayıcısını sıfırlama
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab && tabRecords[activeTab.id]) {
      tabRecords[activeTab.id].lastFocusEnd = null;
      currentActiveTabId = activeTab.id;
    }

    await chrome.storage.local.set({ tabRecords });
    chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
  } else if (details.reason === "update") {
    // EN: Merge any new default settings keys without overwriting user values.
    //     tabRecords are intentionally not touched — all elapsed times are preserved.
    // TR: Yeni varsayılan ayar anahtarlarını, kullanıcı değerlerinin üzerine yazmadan birleştir.
    //     tabRecords kasıtlı olarak dokunulmaz — tüm geçen süreler korunur.
    const mergedSettings = { ...DefaultSettings, ...existingSettings, initialized: true };
    await chrome.storage.local.set({ settings: mergedSettings });
    chrome.tabs.create({ url: chrome.runtime.getURL("whatsnew.html") });
  }

  // EN: Always clear and recreate the alarm so interval changes take effect
  // TR: Alarm her durumda sıfırlanıp yeniden oluşturulur
  await chrome.alarms.clear("tierCheck");
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

// EN: Pending promise that resolves when startup rekey + reconcile + timerCheck have completed.
//     Tab event listeners (onCreated, onUpdated) await this so they don't write fresh T1 records
//     on top of records that the startup rekey is about to relink by URL — a race that would
//     otherwise wipe tier and elapsed-time data on browser restart.
// TR: Startup rekey + reconcile + timerCheck tamamlandığında çözülen bekleyen promise.
//     Tab event listener'ları (onCreated, onUpdated) bunu bekler ki startup rekey URL ile
//     yeniden bağlamak üzereyken yeni T1 kayıtları üzerine yazmasın — aksi halde browser
//     restart sonrası tier ve geçen süre verisi silinir.
let startupGate = (async () => {
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

    // EN: Reconcile browser tabs with storage — catches tabs opened while service worker was stopped.
    //     reconcileTabs() now starts with rekeyRecordsByUrl() which handles browser-restart tabId reuse.
    // TR: Tarayıcı tablarını storage ile uzlaştır — servis worker duruyorken açılan tabları yakala.
    //     reconcileTabs() artık browser-restart sonrası tabId yeniden kullanımını ele alan rekeyRecordsByUrl() ile başlıyor.
    await reconcileTabs();

    // EN: Fix stale null lastFocusEnd values AFTER rekey — records have correct tabIds now.
    //     Only the truly-focused window's active tab is allowed to keep `lastFocusEnd: null`;
    //     "active in a non-focused window" no longer counts as active (chrome.tabs.query({active:true})
    //     returns one per window, so without filtering we'd treat all of them as live).
    // TR: Bayat null lastFocusEnd'leri rekey sonrası düzelt — kayıtlar artık doğru tabId'lerde.
    //     `lastFocusEnd: null` yalnızca gerçek odaklı pencerenin aktif sekmesinde kalabilir;
    //     "odaksız penceredeki aktif sekme" artık aktif sayılmaz.
    let focusedActiveTabId = null;
    try {
      const focusedWin = await chrome.windows.getLastFocused({});
      if (focusedWin && focusedWin.focused) {
        const [a] = await chrome.tabs.query({ active: true, windowId: focusedWin.id });
        if (a) focusedActiveTabId = a.id;
      }
    } catch (_) {}

    const { tabRecords = {} } = await chrome.storage.local.get("tabRecords");
    const now = Date.now();
    let fixCount = 0;
    for (const [tabId, record] of Object.entries(tabRecords)) {
      if (record.lastFocusEnd === null && parseInt(tabId) !== focusedActiveTabId) {
        record.lastFocusEnd = now;
        fixCount++;
      }
    }
    if (fixCount > 0) {
      await chrome.storage.local.set({ tabRecords });
      log("startup: fixed", fixCount, "stale active(null) records (multi-window cleanup)");
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
      // EN: Capture aggregate stats BEFORE overwriting lastFocusEnd | TR: lastFocusEnd üzerine yazmadan önce toplam istatistiği kaydet
      recordFocusEnd(tabRecords[currentActiveTabId], now);
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

  // EN: Wait for startup rekey/reconcile to finish before mutating tabRecords. On browser restart,
  //     restored tabs fire onCreated concurrently with the startup pass — without this gate, a fresh
  //     T1 record could overwrite a record that rekey was about to relink by URL.
  // TR: Startup rekey/reconcile bitmeden tabRecords'a dokunma. Browser restart sonrası restore edilen
  //     sekmeler onCreated'ı eşzamanlı tetikler — bu kapı olmadan, rekey URL ile yeniden bağlamak
  //     üzereyken yeni bir T1 kaydı eski kaydı silebilir.
  if (startupGate) { try { await startupGate; } catch (e) {} }

  // EN: Count this as a tab-opened event for daily activity stats | TR: Günlük aktivite istatistikleri için sekme açma olayı say
  recordTabOpened();

  try {
    const { tabRecords = {}, settings = DefaultSettings } =
      await chrome.storage.local.get(["tabRecords", "settings"]);

    // EN: A record may already exist at this tabId after the startup rekey paired it by URL.
    //     Don't overwrite — just refresh title/favicon from the live tab and exit.
    // TR: Startup rekey URL ile eşledikten sonra bu tabId'de zaten bir kayıt olabilir.
    //     Üzerine yazma — sadece canlı sekmeden title/favicon yenile ve çık.
    if (tabRecords[newTab.id]) {
      const rec = tabRecords[newTab.id];
      let dirty = false;
      if (newTab.title && newTab.title !== rec.title) { rec.title = newTab.title; dirty = true; }
      if (newTab.favIconUrl && newTab.favIconUrl !== rec.favicon) { rec.favicon = newTab.favIconUrl; dirty = true; }
      if (dirty) await chrome.storage.local.set({ tabRecords });
      log(`onCreated record already exists, refreshed metadata: ${newTab.id} tier=T${rec.currentTier}`);
      return;
    }

    // EN: Stale-record relink fallback — handles tabs that arrive after startup rekey ran (lazy session restore).
    //     Looks for a record whose key cannot be parsed as a live tabId and whose URL matches.
    // TR: Bayat kayıt yeniden bağlama yedeği — startup rekey çalıştıktan sonra gelen sekmeleri yakalar (gecikmeli session restore).
    //     Anahtarı canlı bir tabId olarak ayrıştırılamayan ve URL'si eşleşen kayıt aranır.
    const openTabIds = new Set((await chrome.tabs.query({})).map((t) => t.id));
    const staleEntry = Object.entries(tabRecords).find(
      ([key, r]) =>
        r.url === newTab.url &&
        r.currentTier !== 4 &&
        parseInt(key) !== newTab.id &&
        !openTabIds.has(parseInt(key)),
    );
    if (staleEntry) {
      const [oldKey, rec] = staleEntry;
      delete tabRecords[oldKey];
      tabRecords[newTab.id] = {
        ...rec,
        tabId: newTab.id,
        title: newTab.title || rec.title,
        favicon: newTab.favIconUrl || rec.favicon,
      };
      await chrome.storage.local.set({ tabRecords });
      await moveTabToTierGroup(newTab.id, rec.currentTier, settings);
      log(`onCreated relinked stale record: ${oldKey} → ${newTab.id} tier=T${rec.currentTier} url=${rec.url}`);
      return;
    }

    // Duplikasyon kontrolü (T4 arşiv kayıtları duplicate sayılmaz —
    // PROMOTE_TABS ile açılan tablar T4 kaydı varken tetiklenir ve
    // yanlışlıkla redirect'e düşmemeli). Sadece açık tabId'li kayıtlar duplicate sayılır.
    const dup = Object.values(tabRecords).find(
      (r) =>
        r.url === newTab.url &&
        r.tabId !== newTab.id &&
        r.currentTier !== 4 &&
        openTabIds.has(r.tabId),
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
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  try {
    // EN: Browser/window shutdown fires onRemoved for every tab with isWindowClosing=true.
    //     Do NOT apply onManualClose here — the tabs are not being manually closed, the browser
    //     is shutting down and will restore them on next launch. Records must persist with their
    //     existing tier/elapsed time so onCreated/onUpdated can re-link to the new tabIds on restore.
    // TR: Browser/pencere kapanışında her sekme için isWindowClosing=true ile onRemoved tetiklenir.
    //     Burada onManualClose'u UYGULAMA — sekmeler manuel kapatılmıyor, browser kapanıyor ve
    //     bir sonraki açılışta restore edecek. Kayıtlar mevcut tier/geçen süre ile korunmalı ki
    //     restore sırasında onCreated/onUpdated yeni tabId'lere yeniden bağlayabilsin.
    if (removeInfo && removeInfo.isWindowClosing) {
      log("onRemoved skipped (window closing — preserving record for session restore)", tabId);
      return;
    }

    const { tabRecords = {}, settings = DefaultSettings } =
      await chrome.storage.local.get(["tabRecords", "settings"]);

    if (!tabRecords[tabId]) return;

    const wasActive = currentActiveTabId === tabId;
    const wasNotArchived = tabRecords[tabId].currentTier !== 4;
    if (wasActive) {
      // EN: Active tab closed — record final focus session before mutating | TR: Aktif sekme kapatıldı — değiştirmeden önce son odak oturumunu kaydet
      recordFocusEnd(tabRecords[tabId], Date.now());
    }

    if (settings.onManualClose === "archive") {
      tabRecords[tabId].currentTier = 4;
      tabRecords[tabId].lastFocusEnd = Date.now();
      if (wasNotArchived) recordTabArchived();
    } else {
      delete tabRecords[tabId];
    }

    if (wasActive) currentActiveTabId = null;
    await chrome.storage.local.set({ tabRecords });
  } catch (e) {
    log("onRemoved error:", e?.message);
  }
});

// EN: Pure favicon-caching listener — fires whenever a tab reports a new favIconUrl.
//     Independent of the main onUpdated handler so it can't be short-circuited by URL/group checks.
//     Persists into the `domainFavicons` cache (debounced) so the Statistics view can show icons
//     for domains whose live tab record has been deleted (long-closed sites in statsAggregate).
// TR: Yalnızca favicon önbellekleme dinleyicisi — bir tab yeni favIconUrl bildirdiğinde tetiklenir.
//     Ana onUpdated handler'ından bağımsız çalışır; URL/grup kontrolleri tarafından kısa devre
//     edilemez. Canlı tab kaydı silinmiş domainler için (statsAggregate'te kalan uzun zamandır
//     kapanmış siteler) İstatistikler'de hâlâ ikon görünebilmesi için `domainFavicons` cache'ine
//     (debounced) yazar.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.favIconUrl || !tab.url) return;
  const domain = extractDomain(tab.url);
  if (domain) rememberDomainFavicon(domain, changeInfo.favIconUrl);
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

  // EN: Wait for startup rekey/reconcile so this listener doesn't race with URL-based relink. | TR: Startup rekey/reconcile'i bekle ki URL bazlı relink ile yarış olmasın.
  if (startupGate) { try { await startupGate; } catch (e) {} }

  try {
    const { tabRecords = {}, settings = DefaultSettings } =
      await chrome.storage.local.get(["tabRecords", "settings"]);

    if (!tabRecords[tabId]) {
      // EN: Tab was opened before the extension could track it (URL was blank on onCreated). Create a T1 record now.
      // TR: Sekme eklenti takip edemeden açıldı (onCreated anında URL boştu). Şimdi T1 kaydı oluştur.
      if (!changeInfo.url) return;
      const now = Date.now();

      // EN: Stale-record relink — likely a session-restored discarded tab whose URL only resolved now.
      //     If a record exists for this URL with a no-longer-open tabId, transfer it to preserve tier and elapsed time.
      // TR: Bayat kayıt yeniden bağlama — büyük olasılıkla URL'si ancak şimdi çözülen oturum-restore'lu discarded sekme.
      //     Bu URL için açık olmayan tabId'li bir kayıt varsa, tier ve geçen süreyi korumak için onu taşı.
      const openTabIds = new Set((await chrome.tabs.query({})).map((t) => t.id));
      const staleEntry = Object.entries(tabRecords).find(
        ([key, r]) =>
          r.url === changeInfo.url &&
          r.currentTier !== 4 &&
          parseInt(key) !== tabId &&
          !openTabIds.has(parseInt(key)),
      );
      if (staleEntry) {
        const [oldKey, rec] = staleEntry;
        delete tabRecords[oldKey];
        tabRecords[tabId] = {
          ...rec,
          tabId,
          url: changeInfo.url,
          title: tab.title || rec.title,
          favicon: tab.favIconUrl || rec.favicon,
        };
        await chrome.storage.local.set({ tabRecords });
        await moveTabToTierGroup(tabId, rec.currentTier, settings);
        log(`onUpdated relinked stale record: ${oldKey} → ${tabId} tier=T${rec.currentTier} url=${changeInfo.url}`);
        return;
      }

      // Duplicate check before creating a new record (only open tabIds count as duplicates)
      const dup = Object.values(tabRecords).find(
        (r) =>
          r.url === changeInfo.url &&
          r.tabId !== tabId &&
          r.currentTier !== 4 &&
          openTabIds.has(r.tabId),
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
        // EN: Do NOT update lastFocusEnd here. Edge fires groupId:-1 for ALL tabs on
        //     sleep/hibernate wake before reassigning real groupIds — treating this as
        //     a user drag would reset every tab's timer. Instead, wait for the follow-up
        //     event with the actual groupId; if the tab lands in a different tier group
        //     that event handles the update. If the tab stays ungrouped, timerCheck
        //     will reclassify it on the next alarm tick.
        // TR: Burada lastFocusEnd güncelleme. Edge, uyku/hibernate sonrası wake sırasında
        //     gerçek groupId'leri yeniden atamadan önce TÜM sekmeler için groupId:-1 tetikler.
        //     Bunu kullanıcı sürüklemesi saymak her sekmenin sayacını sıfırlar. Bunun yerine
        //     gerçek groupId'yi içeren sonraki olayı bekle; sekme farklı bir tier grubuna
        //     girerse o olay güncellemeyi yapar. Sekme grubsuz kalırsa timerCheck halleder.
        if (isExtensionMove(tabId)) {
          log("onUpdated ungrouped (extension move, ignored)", tabId);
        } else {
          log("onUpdated ungrouped (skipped lastFocusEnd reset — may be wake event)", tabId);
        }
      } else {
        try {
          const group = await chrome.tabGroups.get(newGroupId);
          const tier = COLOR_TO_TIER[group.color];
          if (tier !== undefined && tier !== tabRecords[tabId].currentTier) {
            tabRecords[tabId].currentTier = tier;
            tabRecords[tabId].isPinned = tier === 0;
            if (tier !== 0) {
              if (isExtensionMove(tabId)) {
                // EN: Extension moved this tab (tier transition) — do NOT touch lastFocusEnd,
                //     the original inactivity timestamp must be preserved. Grace-period entry
                //     in extensionMovingExpiry lives on for ~3s to catch late-firing onUpdateds.
                // TR: Bu tab'ı extension taşıdı (tier geçişi) — lastFocusEnd'e dokunma, orijinal
                //     hareketsizlik zaman damgası korunmalı. extensionMovingExpiry'deki grace
                //     kaydı ~3 sn boyunca duruyor — geç ateşleyen onUpdated'ları soğurur.
                clearExtensionMove(tabId);
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
    const oldKey = String(removedTabId);
    const newKey = String(addedTabId);

    // EN: Read latest state right before mutating to narrow the race window with onActivated.
    //     Edge wakes a sleeping tab in response to a user click — both onReplaced and onActivated
    //     fire concurrently for the same wake. If onActivated has already URL-relinked the record
    //     to the new ID and promoted it to T1, we must NOT overwrite that with the pre-wake tier.
    // TR: Mutasyondan hemen önce en güncel state'i oku — onActivated ile yarış aralığını daralt.
    //     Edge uyuyan tabı kullanıcı tıklamasıyla uyandırır; aynı uyanma için onReplaced ve
    //     onActivated eş zamanlı tetiklenir. onActivated zaten URL üzerinden yeni ID'ye bağlamış
    //     ve T1'e yükseltmişse, uyanma öncesi tier ile üzerine YAZMAMALIYIZ.
    const { tabRecords = {} } = await chrome.storage.local.get("tabRecords");

    if (tabRecords[newKey]) {
      // EN: onActivated raced ahead and already linked at the new ID. Just clean up the stale old key.
      // TR: onActivated önce davranıp yeni ID'ye bağladı. Sadece bayat eski anahtarı temizle.
      if (tabRecords[oldKey]) {
        delete tabRecords[oldKey];
        await chrome.storage.local.set({ tabRecords });
        log(`onReplaced: cleaned stale ${removedTabId} (newKey ${addedTabId} already linked)`);
      }
      return;
    }

    if (!tabRecords[oldKey]) return; // EN: No record for old ID either, nothing to do | TR: Eski ID için de kayıt yok, işlem gerekmez

    const rec = tabRecords[oldKey];
    tabRecords[newKey] = { ...rec, tabId: addedTabId };
    delete tabRecords[oldKey];

    // EN: If the wake puts the tab in the active state (typical case: user clicked a sleeping tab),
    //     apply activation effects here so a concurrent onActivated either matches our write or runs
    //     against state that already has tier=1 and lastFocusEnd=null. Without this, the tier stays
    //     stuck at the pre-wake value (e.g. T3) until the user clicks elsewhere and back.
    // TR: Uyanma sonucu tab aktif duruma geçtiyse (tipik: kullanıcı uyuyan taba tıkladı), aktivasyon
    //     efektlerini burada uygula — eş zamanlı onActivated ya bizim yazımızla eşleşir ya da zaten
    //     tier=1 / lastFocusEnd=null olan state üzerinde çalışır. Bu olmadan, kullanıcı başka taba
    //     tıklayıp geri dönene kadar tier uyanma öncesi değerinde (örn. T3) takılı kalıyor.
    let promoted = false;
    try {
      const liveTab = await chrome.tabs.get(addedTabId);
      // EN: Only treat as activation if the tab's WINDOW is currently focused. Otherwise
      //     `liveTab.active` is true for any background window's currently-selected tab,
      //     and a wake event there (Edge memory saver, sleeping tabs auto-wake, etc.)
      //     would wrongly promote it to T1 + reset its inactivity timer. The user is only
      //     truly looking at the tab when its window is the focused one.
      // TR: Tabın PENCERESİ gerçekten odaklanmışsa aktivasyon say. Aksi halde `liveTab.active`
      //     herhangi bir arka pencerenin seçili tabı için true; orada bir uyandırma olayı
      //     (Edge memory saver, sleeping tabs otomatik wake, vb.) yanlışlıkla T1'e yükseltir
      //     ve hareketsizlik sayacını sıfırlar. Kullanıcı sekmeye gerçekten ancak penceresi
      //     odaklı iken bakar.
      let windowFocused = false;
      if (liveTab && liveTab.active) {
        try {
          const win = await chrome.windows.get(liveTab.windowId);
          windowFocused = !!(win && win.focused);
        } catch (_) {}
      }
      if (liveTab && liveTab.active && windowFocused && tabRecords[newKey].currentTier !== 0) {
        tabRecords[newKey].lastFocusStart = Date.now();
        tabRecords[newKey].lastFocusEnd = null;
        if (tabRecords[newKey].currentTier > 1) {
          tabRecords[newKey].currentTier = 1;
          promoted = true;
        }
        currentActiveTabId = addedTabId;
      }
    } catch (_) {}

    await chrome.storage.local.set({ tabRecords });

    if (promoted) {
      try { await moveTabToTierGroup(addedTabId, 1); } catch (_) {}
    }

    log(
      `onReplaced: re-linked tabId ${removedTabId} → ${addedTabId} url=${rec.url}${promoted ? " (active, promoted →T1)" : ""}`,
    );
  } catch (e) {
    log("onReplaced error:", e?.message);
  }
});

// =============================================================================
// EVENT 6: windows.onFocusChanged — switch between browser windows
//
// EN: tabs.onActivated only fires when the active tab changes inside a single window.
//     If the user switches to a different window without clicking a tab there, no event
//     fires natively — yet conceptually the "current" tab has changed (the previous
//     window's active tab loses focus, the new window's active tab gains focus).
//     Without this listener, multi-window users accumulate stale `lastFocusEnd: null`
//     records on tabs that were once active in some window. On the next SW startup
//     reconcile force-promotes them to T1 and the IIFE stale-null fix resets their
//     elapsed timer, producing the "spontaneous T1 + focus ended" symptom.
// TR: tabs.onActivated yalnızca tek bir pencere içinde aktif sekme değişince ateşler.
//     Kullanıcı başka pencereye geçer ama orada bir tab'a tıklamazsa hiçbir olay
//     tetiklenmez — ama "şu an kullanılan" tab kavramsal olarak değişmiştir (önceki
//     pencerenin aktif sekmesi odağı kaybeder, yeni pencerenin aktif sekmesi odağı
//     kazanır). Bu listener olmadan, çok pencereli kullanıcılarda bir kez aktif olmuş
//     sekmelerde bayat `lastFocusEnd: null` birikiyor. Bir sonraki SW başlatımında
//     reconcile bunları T1'e zorluyor ve IIFE stale-null fix sayacı sıfırlıyor —
//     "kendiliğinden T1 + odak bitti" semptomunu doğuruyor.
// =============================================================================
chrome.windows.onFocusChanged.addListener(async (newWindowId) => {
  try {
    const { tabRecords = {} } = await chrome.storage.local.get("tabRecords");
    const now = Date.now();
    let changed = false;

    // EN: Previously-tracked active tab (in the now-unfocused window) gets focus-end. | TR: Önceden izlenen aktif tab (şimdi odaktan çıkan pencerede) odak biter.
    if (currentActiveTabId && tabRecords[currentActiveTabId]) {
      const prev = tabRecords[currentActiveTabId];
      if (prev.lastFocusEnd === null) {
        recordFocusEnd(prev, now);
        prev.lastFocusEnd = now;
        changed = true;
      }
    }

    if (newWindowId === chrome.windows.WINDOW_ID_NONE) {
      // EN: No window focused (user clicked desktop, switched to another app, etc.) | TR: Hiçbir pencere odaklı değil
      currentActiveTabId = null;
    } else {
      // EN: Newly-focused window's active tab gains focus | TR: Yeni odaklanan pencerenin aktif sekmesi odağı kazanır
      try {
        const [newActive] = await chrome.tabs.query({ active: true, windowId: newWindowId });
        if (newActive && tabRecords[newActive.id]) {
          const rec = tabRecords[newActive.id];
          if (rec.currentTier !== 0) {
            rec.lastFocusStart = now;
            rec.lastFocusEnd = null;
            if (rec.currentTier > 1) {
              rec.currentTier = 1;
              try { await moveTabToTierGroup(newActive.id, 1); } catch (_) {}
            }
          }
          currentActiveTabId = newActive.id;
          changed = true;
        }
      } catch (_) {}
    }

    if (changed) await chrome.storage.local.set({ tabRecords });
  } catch (e) {
    log("onFocusChanged error:", e?.message);
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

    case "CLEAR_STATS":
      clearStatsAggregate()
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
          const { url, oldKey } = message;
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
      // EN: Optional keepKeys = { url: recordKey } — user-chosen record to keep per URL
      // TR: İsteğe bağlı keepKeys = { url: recordKey } — kullanıcının URL başına saklamak istediği kayıt
      dedupRecords(message.keepKeys || {})
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((e) => sendResponse({ ok: false, error: e?.message }));
      return true;

    case "FIND_DUPLICATES": {
      // EN: Return duplicate groups without deleting — for preview UI
      // TR: Önizleme için silmeden kopya gruplarını döndür
      (async () => {
        try {
          const { tabRecords = {} } = await chrome.storage.local.get("tabRecords");
          const byUrl = {};
          for (const [key, rec] of Object.entries(tabRecords)) {
            if (!rec.url) continue;
            if (!byUrl[rec.url]) byUrl[rec.url] = [];
            byUrl[rec.url].push({ key, rec });
          }
          const groups = [];
          for (const [url, entries] of Object.entries(byUrl)) {
            if (entries.length <= 1) continue;
            entries.sort((a, b) => {
              const tierDiff = (a.rec.currentTier ?? 99) - (b.rec.currentTier ?? 99);
              if (tierDiff !== 0) return tierDiff;
              const aTime = a.rec.lastFocusEnd ?? Number.MAX_SAFE_INTEGER;
              const bTime = b.rec.lastFocusEnd ?? Number.MAX_SAFE_INTEGER;
              return bTime - aTime;
            });
            groups.push({
              url,
              autoKeepKey: entries[0].key,
              entries: entries.map(({ key, rec }) => ({
                key,
                title:        rec.title || rec.url,
                favicon:      rec.favicon,
                currentTier:  rec.currentTier,
                lastFocusEnd: rec.lastFocusEnd,
                isOpen:       rec.currentTier !== 4,
              })),
            });
          }
          // EN: Order the groups themselves: lowest tier in each group first (so T0 duplicate
          //     groups float to the top), then alphabetical by the representative entry's
          //     title. entries[0] is the representative because it's the one auto-selected as
          //     "keep" — lowest-tier most-recently-used record for that URL.
          // TR: Grupları kendi aralarında sırala: her grubun en düşük tier'ı önce gelsin
          //     (T0 kopya grupları en üste çıksın), sonra temsilci girişin başlığına göre
          //     alfabetik. entries[0] temsilcidir — "saklanacak" olarak otomatik seçilen,
          //     URL için en düşük tier'lı + en son kullanılan kayıt.
          groups.sort((a, b) => {
            const tierDiff = (a.entries[0].currentTier ?? 99) - (b.entries[0].currentTier ?? 99);
            if (tierDiff !== 0) return tierDiff;
            return (a.entries[0].title || "").localeCompare(b.entries[0].title || "");
          });
          sendResponse({ ok: true, groups });
        } catch (e) {
          sendResponse({ ok: false, error: e?.message });
        }
      })();
      return true;
    }
  }
});
