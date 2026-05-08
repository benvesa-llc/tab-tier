// =============================================================================
// Tab Tier — Chrome Web Store screenshot & promo generator
//
// Loads the real (unpacked) extension into Chromium, injects realistic demo data
// into chrome.storage.local, then captures each public page in 3 locales (en/tr/es)
// at every size the Web Store accepts:
//
//   1280×800  — primary screenshot (5 per locale)
//   640×400   — secondary screenshot size, downscaled from 1280×800
//   440×280   — small promo tile (1 per locale, popup over gradient + tagline)
//   1400×560  — marquee promo banner (1 per locale, popup beside title + tagline)
//
// Usage:
//   cd tools
//   npm install
//   npx playwright install chromium
//   node screenshots.js
//
// Output: ../store-assets/{locale}/{size}/*.png
// =============================================================================

const { chromium } = require("playwright");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs").promises;

const EXT_PATH = path.resolve(__dirname, "..");
const OUT_DIR = path.resolve(__dirname, "..", "store-assets");
const PROFILE_DIR = path.join(__dirname, ".chromium-profile");
const LOCALES = ["en", "tr", "es", "de", "fr"];

const NOW = Date.now();
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

// EN: Realistic demo records that fill the popup, Tab Management table, and Stats charts
//     with a plausible mix of tiers and recent timestamps.
const DEMO_RECORDS = {
  "101": { tabId: 101, url: "https://github.com/anthropics/anthropic-sdk-typescript", domain: "github.com",            title: "anthropics/anthropic-sdk-typescript",          favicon: "https://github.githubassets.com/favicons/favicon.svg", currentTier: 0, isPinned: true,  lastFocusStart: NOW,                  lastFocusEnd: null,                 createdAt: NOW - 12 * DAY },
  "102": { tabId: 102, url: "https://stackoverflow.com/questions/784539",                domain: "stackoverflow.com",  title: "How to organize tabs by activity?",            favicon: "",                                                       currentTier: 1, isPinned: false, lastFocusStart: NOW - 4 * 60 * 1000,  lastFocusEnd: NOW - 4 * 60 * 1000,  createdAt: NOW - 2 * HOUR  },
  "103": { tabId: 103, url: "https://news.ycombinator.com/",                              domain: "news.ycombinator.com", title: "Hacker News",                                  favicon: "",                                                       currentTier: 1, isPinned: false, lastFocusStart: NOW - 22 * 60 * 1000, lastFocusEnd: NOW - 22 * 60 * 1000, createdAt: NOW - 3 * HOUR  },
  "104": { tabId: 104, url: "https://developer.mozilla.org/en-US/docs/Web/API/Window",   domain: "developer.mozilla.org", title: "Window — Web APIs | MDN",                      favicon: "",                                                       currentTier: 2, isPinned: false, lastFocusStart: NOW - 2 * HOUR,       lastFocusEnd: NOW - 2 * HOUR,       createdAt: NOW - 5 * HOUR  },
  "105": { tabId: 105, url: "https://www.figma.com/files/team/tab-tier/icons",            domain: "figma.com",          title: "Tab Tier — Icons",                             favicon: "",                                                       currentTier: 2, isPinned: false, lastFocusStart: NOW - 6 * HOUR,       lastFocusEnd: NOW - 6 * HOUR,       createdAt: NOW - 1 * DAY   },
  "106": { tabId: 106, url: "https://www.youtube.com/watch?v=q-5z2_o8xNc",                domain: "youtube.com",        title: "Building Chrome Extensions in 2026",           favicon: "",                                                       currentTier: 3, isPinned: false, lastFocusStart: NOW - 2 * DAY,        lastFocusEnd: NOW - 2 * DAY,        createdAt: NOW - 5 * DAY   },
  "107": { tabId: 107, url: "https://medium.com/@author/why-i-built-tab-tier",            domain: "medium.com",         title: "Why I built Tab Tier",                         favicon: "",                                                       currentTier: 3, isPinned: false, lastFocusStart: NOW - 4 * DAY,        lastFocusEnd: NOW - 4 * DAY,        createdAt: NOW - 6 * DAY   },
  "108": { tabId: 108, url: "https://docs.google.com/document/d/abc/edit",                domain: "docs.google.com",    title: "Roadmap — Q3 plan",                            favicon: "",                                                       currentTier: 1, isPinned: false, lastFocusStart: NOW - 11 * 60 * 1000, lastFocusEnd: NOW - 11 * 60 * 1000, createdAt: NOW - 4 * HOUR  },
  "arch_201_x": { tabId: 201, url: "https://www.reddit.com/r/programming/comments/x/",   domain: "reddit.com",         title: "/r/programming",                               favicon: "",                                                       currentTier: 4, isPinned: false, lastFocusStart: NOW - 9 * DAY,        lastFocusEnd: NOW - 9 * DAY,        createdAt: NOW - 14 * DAY  },
  "arch_202_x": { tabId: 202, url: "https://twitter.com/anthropicai/status/12345",       domain: "twitter.com",        title: "@anthropicai on Twitter",                      favicon: "",                                                       currentTier: 4, isPinned: false, lastFocusStart: NOW - 10 * DAY,       lastFocusEnd: NOW - 10 * DAY,       createdAt: NOW - 15 * DAY  },
  "arch_203_x": { tabId: 203, url: "https://lobste.rs/s/abcd/article",                    domain: "lobste.rs",          title: "Lobsters — recent",                            favicon: "",                                                       currentTier: 4, isPinned: false, lastFocusStart: NOW - 13 * DAY,       lastFocusEnd: NOW - 13 * DAY,       createdAt: NOW - 18 * DAY  },
};

const DEMO_SETTINGS = {
  tier1_to_tier2_minutes: 60,
  tier2_to_tier3_hours: 24,
  tier3_to_tier4_days: 7,
  tier4_delete_days: 60,
  timerIntervalMinutes: 1,
  duplicateAction: "redirect",
  onManualClose: "delete",
  theme: "dark",
  groupNames: {},
  initialized: true,
};

// EN: Per-locale tagline shown on the 440×280 / 1400×560 promo banners | TR: Tanıtım banner'larında gösterilen yerel slogan
const PROMO = {
  en: { title: "Tab Tier", tagline: "Tier your tabs by recency." },
  tr: { title: "Tab Tier", tagline: "Sekmelerini etkinliğe göre sırala." },
  es: { title: "Tab Tier", tagline: "Ordena tus pestañas por uso reciente." },
  de: { title: "Tab Tier", tagline: "Tabs nach Aktivität geordnet." },
  fr: { title: "Tab Tier", tagline: "Trie tes onglets par récence." },
};

// EN: Pages to capture as primary 1280×800 screenshots | TR: Birincil 1280×800 ekran görüntüsü olarak yakalanacak sayfalar
const PAGES = [
  { name: "popup",          file: "popup.html",          width: 380,  height: 600,  popup: true  },
  { name: "tab-management", file: "tab-management.html", width: 1280, height: 800, popup: false },
  { name: "settings",       file: "settings.html",       width: 1280, height: 800, popup: false },
  { name: "help",           file: "help.html",           width: 1280, height: 800, popup: false },
  { name: "whatsnew",       file: "whatsnew.html",       width: 1280, height: 800, popup: false },
];

// EN: Subtle dark gradient that matches the extension theme (accent → mantle) | TR: Eklenti temasıyla uyumlu hafif koyu gradient
const GRADIENT = ["#cba6f7", "#1e1e2e"];

// =============================================================================
// Helpers
// =============================================================================

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

function gradientSVG(w, h) {
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${GRADIENT[0]}" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="${GRADIENT[1]}"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
  </svg>`;
}

async function compositePopupOnGradient(popupPath, w, h, outPath) {
  const popupBuf = await fs.readFile(popupPath);
  const meta = await sharp(popupBuf).metadata();
  // Scale so the popup occupies ~85% of the canvas height while staying < 50% width
  const ratio = Math.min((h * 0.85) / meta.height, (w * 0.5) / meta.width);
  const newW = Math.round(meta.width * ratio);
  const newH = Math.round(meta.height * ratio);
  const popupResized = await sharp(popupBuf)
    .resize(newW, newH)
    .png()
    .toBuffer();
  await sharp(Buffer.from(gradientSVG(w, h)))
    .composite([
      {
        input: popupResized,
        top: Math.round((h - newH) / 2),
        left: Math.round((w - newW) / 2),
      },
    ])
    .png()
    .toFile(outPath);
}

async function downscale(srcPath, w, h, outPath) {
  await sharp(srcPath).resize(w, h, { fit: "fill" }).png().toFile(outPath);
}

// EN: Promo banner: gradient + (title+tagline on left) + (popup thumbnail on right) | TR: Tanıtım banner'ı: gradient + (sol başlık+slogan) + (sağ popup minik)
async function makePromoBanner(locale, popupPath, w, h, outPath) {
  const txt = PROMO[locale];
  const popupBuf = await fs.readFile(popupPath);
  const meta = await sharp(popupBuf).metadata();
  const popupTargetH = Math.round(h * 0.86);
  const popupTargetW = Math.round(meta.width * (popupTargetH / meta.height));
  const popupResized = await sharp(popupBuf)
    .resize(popupTargetW, popupTargetH)
    .png()
    .toBuffer();
  const popupTop = Math.round((h - popupTargetH) / 2);
  const popupLeft = w - popupTargetW - Math.round(w * 0.05);

  const titleSize = Math.max(20, Math.round(h * 0.17));
  const taglineSize = Math.max(12, Math.round(h * 0.08));
  const textLeft = Math.round(w * 0.06);
  const textTopTitle = Math.round(h * 0.42);
  const textTopTagline = textTopTitle + titleSize + Math.round(h * 0.04);

  const escapeXml = (s) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const overlay = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${GRADIENT[0]}" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="${GRADIENT[1]}"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <text x="${textLeft}" y="${textTopTitle}" font-family="Segoe UI, Arial, sans-serif" font-size="${titleSize}" font-weight="700" fill="#cdd6f4">${escapeXml(txt.title)}</text>
    <text x="${textLeft}" y="${textTopTagline}" font-family="Segoe UI, Arial, sans-serif" font-size="${taglineSize}" fill="#a6adc8">${escapeXml(txt.tagline)}</text>
  </svg>`;

  await sharp(Buffer.from(overlay))
    .composite([{ input: popupResized, top: popupTop, left: popupLeft }])
    .png()
    .toFile(outPath);
}

// =============================================================================
// Main capture flow
// =============================================================================

async function captureLocale(context, extId, locale) {
  console.log(`\n→ [${locale}] capturing…`);
  const baseDir = path.join(OUT_DIR, locale);
  await ensureDir(path.join(baseDir, "1280x800"));
  await ensureDir(path.join(baseDir, "640x400"));
  await ensureDir(path.join(baseDir, "440x280"));
  await ensureDir(path.join(baseDir, "1400x560"));

  const page = await context.newPage();

  // EN: Open any extension page first so chrome.storage is reachable from this context | TR: Önce bir eklenti sayfası aç ki chrome.storage erişilebilsin
  await page.goto(`chrome-extension://${extId}/help.html`);
  await page.evaluate(
    ({ records, settings, locale }) =>
      chrome.storage.local.set({
        tabRecords: records,
        settings: { ...settings, uiLanguage: locale },
      }),
    { records: DEMO_RECORDS, settings: DEMO_SETTINGS, locale }
  );

  const tempScreens = {};
  for (const cfg of PAGES) {
    await page.setViewportSize({ width: cfg.width, height: cfg.height });
    await page.goto(`chrome-extension://${extId}/${cfg.file}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(800); // EN: let dynamic JS render | TR: dinamik JS render'ı için bekle

    // EN: Hide scrollbars before snapshot — content longer than the viewport (Tab Management,
    //     Settings, Help) otherwise leaves a grey scrollbar in the right edge of the PNG.
    //     The page is still scrollable in the live extension; this only affects the capture.
    // TR: Snapshot'tan önce scrollbar'ı gizle — viewport'tan uzun içerik (Tab Yönetimi, Ayarlar,
    //     Yardım) PNG'nin sağ kenarında gri scrollbar bırakıyordu. Canlı eklentide sayfa hâlâ
    //     scroll'lanabilir; bu sadece yakalamayı etkiler.
    await page.addStyleTag({
      content: `
        html, body { scrollbar-width: none !important; -ms-overflow-style: none !important; }
        ::-webkit-scrollbar, *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
      `,
    });
    await page.waitForTimeout(100); // EN: let layout reflow without scrollbar gutter | TR: scrollbar boşluğu olmadan layout yeniden hesaplansın

    const tmp = path.join(baseDir, `_temp-${cfg.name}.png`);
    await page.screenshot({
      path: tmp,
      fullPage: false,
      clip: { x: 0, y: 0, width: cfg.width, height: cfg.height },
    });
    tempScreens[cfg.name] = tmp;
    console.log(`  • captured ${cfg.name} (${cfg.width}×${cfg.height})`);
  }
  await page.close();

  // 1280×800 outputs
  let i = 1;
  const finalPaths = {};
  for (const cfg of PAGES) {
    const fname = `${String(i).padStart(2, "0")}-${cfg.name}.png`;
    const dest = path.join(baseDir, "1280x800", fname);
    if (cfg.popup) {
      await compositePopupOnGradient(tempScreens[cfg.name], 1280, 800, dest);
    } else {
      await fs.copyFile(tempScreens[cfg.name], dest);
    }
    finalPaths[cfg.name] = dest;
    i++;
  }

  // 640×400 outputs (downscale from 1280×800)
  i = 1;
  for (const cfg of PAGES) {
    const fname = `${String(i).padStart(2, "0")}-${cfg.name}.png`;
    await downscale(finalPaths[cfg.name], 640, 400, path.join(baseDir, "640x400", fname));
    i++;
  }

  // Promo banners
  await makePromoBanner(locale, tempScreens["popup"], 440, 280, path.join(baseDir, "440x280", "promo-tile.png"));
  await makePromoBanner(locale, tempScreens["popup"], 1400, 560, path.join(baseDir, "1400x560", "marquee.png"));

  // Cleanup temp files
  for (const tmp of Object.values(tempScreens)) {
    await fs.unlink(tmp).catch(() => {});
  }

  console.log(`  ✓ [${locale}] done`);
}

(async () => {
  console.log("Tab Tier — store asset generator");
  console.log("Extension path:", EXT_PATH);
  console.log("Output dir:    ", OUT_DIR);

  await ensureDir(OUT_DIR);

  // Fresh chromium profile so previous runs don't leak state
  await fs.rm(PROFILE_DIR, { recursive: true, force: true }).catch(() => {});

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false, // EN: extensions don't always load reliably in headless | TR: headless'te eklentiler her zaman yüklenmiyor
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
    viewport: { width: 1280, height: 800 },
    // EN: Force 1× rendering so HiDPI / Retina screens don't produce 2× PNGs (e.g. 2560×1600
    //     instead of 1280×800), which would make the Web Store reject or downscale awkwardly.
    // TR: HiDPI / Retina ekranlarda 2× PNG (örn. 1280×800 yerine 2560×1600) üretmeyi engelle —
    //     Web Store reddedebilir veya çirkince küçültür. 1× render zorunlu.
    deviceScaleFactor: 1,
  });

  let [sw] = context.serviceWorkers();
  if (!sw) {
    sw = await context.waitForEvent("serviceworker", { timeout: 30000 });
  }
  const extId = sw.url().split("/")[2];
  console.log(`Extension ID:   ${extId}`);

  // EN: Monkey-patch chrome.tabs.query in every page so the demo records' tabIds (101…108)
  //     appear as if they're real open tabs. Without this Tab Management would show every
  //     demo record with the "✗ missing" status because no real browser tabs back them.
  //     The currently-active record (id 101 — its lastFocusEnd is null) is marked active so
  //     the status column renders "● active" and the row isn't flagged as `isStale`.
  // TR: Her sayfada chrome.tabs.query'i monkey-patch'le; demo kayıtların tabId'leri (101…108)
  //     gerçek açık tablar gibi görünsün. Bu olmadan Tab Yönetimi her demo kaydı "✗ yok"
  //     statüsüyle gösterirdi (gerçek tab yok). lastFocusEnd: null olan kayıt (id 101) aktif
  //     işaretlenir; durum "● active" olur ve satır `isStale` olarak işaretlenmez.
  const FAKE_OPEN_TAB_IDS = [101, 102, 103, 104, 105, 106, 107, 108];
  const FAKE_ACTIVE_TAB_ID = 101;
  await context.addInitScript(
    ({ ids, activeId }) => {
      if (typeof chrome === "undefined" || !chrome.tabs || !chrome.tabs.query) return;
      const orig = chrome.tabs.query.bind(chrome.tabs);
      const buildSynthetic = (qi) => {
        const wantActive = qi && qi.active === true;
        return ids
          .filter((id) => !wantActive || id === activeId)
          .map((id) => ({
            id,
            url: "",
            title: "",
            windowId: 1,
            index: 0,
            pinned: false,
            active: id === activeId,
            discarded: false,
            audible: false,
            autoDiscardable: true,
            highlighted: false,
            incognito: false,
            mutedInfo: { muted: false },
            selected: false,
            status: "complete",
          }));
      };
      chrome.tabs.query = function (queryInfo, callback) {
        if (typeof callback === "function") {
          orig(queryInfo || {}, (tabs) => callback([...tabs, ...buildSynthetic(queryInfo)]));
          return;
        }
        return new Promise((resolve) => {
          orig(queryInfo || {}, (tabs) => resolve([...tabs, ...buildSynthetic(queryInfo)]));
        });
      };
    },
    { ids: FAKE_OPEN_TAB_IDS, activeId: FAKE_ACTIVE_TAB_ID }
  );

  for (const locale of LOCALES) {
    await captureLocale(context, extId, locale);
  }

  await context.close();
  await fs.rm(PROFILE_DIR, { recursive: true, force: true }).catch(() => {});

  console.log(`\n✅ All assets generated at: ${OUT_DIR}`);
  console.log("   Upload them per-locale on the Chrome Web Store dashboard.");
})().catch((err) => {
  console.error("\n❌ Failed:", err);
  process.exit(1);
});
