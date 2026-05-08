// EN: Detect UI language — stored preference wins; falls back to browser locale
// TR: UI dilini tespit et — saklanan tercih önce gelir; yoksa tarayıcı dili
const SUPPORTED_LANGS = ["en", "tr", "es", "de", "fr"];

async function detectLang() {
  try {
    const { settings = {} } = await chrome.storage.local.get("settings");
    const stored = settings.uiLanguage;
    if (stored && stored !== "auto") return stored;
  } catch (e) {}
  const ui = chrome.i18n.getUILanguage().toLowerCase();
  for (const code of SUPPORTED_LANGS) {
    if (code !== "en" && ui.startsWith(code)) return code;
  }
  return "en";
}

// EN: Category labels match CHANGELOG.md headings (Added / Changed / Fixed) so users see the same
//     category vocabulary in both places. Order is fixed: feat → change → fix.
// TR: Kategori etiketleri CHANGELOG.md başlıklarıyla aynıdır (Added / Changed / Fixed); kullanıcı
//     iki yerde de aynı kategori sözlüğünü görür. Sıra sabit: feat → change → fix.
const CATEGORY_ORDER = ["feat", "change", "fix"];
function categoryLabel(type, lang) {
  const labels = {
    feat:   { en: "Added",   tr: "Eklenenler",    es: "Añadido",  de: "Hinzugefügt", fr: "Ajouté" },
    change: { en: "Changed", tr: "Değişenler",    es: "Cambiado", de: "Geändert",    fr: "Modifié" },
    fix:    { en: "Fixed",   tr: "Düzeltilenler", es: "Corregido", de: "Behoben",    fr: "Corrigé" },
  };
  return (labels[type] || {})[lang] || (labels[type] || {}).en || type;
}

const LOCALE_BCP47 = { en: "en-US", tr: "tr-TR", es: "es-ES", de: "de-DE", fr: "fr-FR" };

function formatDate(dateStr, lang) {
  const locale = LOCALE_BCP47[lang] || "en-US";
  try {
    return new Date(dateStr).toLocaleDateString(locale, {
      year: "numeric", month: "long", day: "numeric",
    });
  } catch (e) { return dateStr; }
}

// EN: Translate a fixed UI string. Pass an object keyed by language code; falls back to en.
// TR: Sabit bir UI metnini çevir. Anahtar dil kodu olan obje al; en'e fallback yapar.
function t(lang, dict) {
  return dict[lang] || dict.en || "";
}

function showError(id, msg) {
  const el = document.getElementById(id);
  el.className = "";
  el.textContent = msg;
}

function renderChangelog(changelog, version, lang) {
  const container = document.getElementById("changelogContainer");
  container.innerHTML = "";
  container.className = "";

  changelog.forEach(entry => {
    const isCurrent = entry.version === version;
    const card = document.createElement("div");
    card.className = "version-card";

    const header = document.createElement("div");
    header.className = "version-header";
    const numSpan = document.createElement("span");
    numSpan.className = "version-number";
    numSpan.textContent = "v" + entry.version;
    const dateSpan = document.createElement("span");
    dateSpan.className = "version-date";
    dateSpan.textContent = formatDate(entry.date, lang);
    header.appendChild(numSpan);
    header.appendChild(dateSpan);
    if (isCurrent) {
      const badge = document.createElement("span");
      badge.className = "version-badge";
      badge.textContent = t(lang, { en: "Installed", tr: "Yüklü", es: "Instalado", de: "Installiert", fr: "Installé" });
      header.appendChild(badge);
    }

    card.appendChild(header);

    // EN: Group changes by type and render each group under a category heading,
    //     mirroring CHANGELOG.md (### Added / ### Changed / ### Fixed). Empty groups are skipped.
    // TR: Değişiklikleri tipine göre grupla ve her grubu kategori başlığı altında göster;
    //     CHANGELOG.md ile aynı yapı (### Added / ### Changed / ### Fixed). Boş gruplar atlanır.
    const byType = {};
    for (const c of entry.changes) {
      (byType[c.type] = byType[c.type] || []).push(c);
    }

    const ordered = [
      ...CATEGORY_ORDER.filter((t) => byType[t]),
      ...Object.keys(byType).filter((t) => !CATEGORY_ORDER.includes(t)),
    ];

    ordered.forEach((type) => {
      const heading = document.createElement("div");
      heading.className = "change-category type-" + type;
      heading.textContent = categoryLabel(type, lang);
      card.appendChild(heading);

      const list = document.createElement("ul");
      list.className = "change-list";
      byType[type].forEach((c) => {
        const li = document.createElement("li");
        li.className = "change-item";
        // EN: pick localized field text → textTR / textES / textDE / textFR; fall back to text | TR: yerelleştirilmiş alanı seç; yoksa text'e dön
        const localized = lang !== "en" && c["text" + lang.toUpperCase()];
        li.textContent = localized || c.text;
        list.appendChild(li);
      });
      card.appendChild(list);
    });

    container.appendChild(card);
  });
}

function renderRoadmap(roadmap, lang) {
  const container = document.getElementById("roadmapContainer");
  container.innerHTML = "";
  container.className = "roadmap-list";

  roadmap.forEach(item => {
    const div = document.createElement("div");
    div.className = "roadmap-item";
    const dot = document.createElement("span");
    dot.className = "roadmap-dot";
    const title = document.createElement("span");
    title.className = "roadmap-title";
    const localized = lang !== "en" && item["title" + lang.toUpperCase()];
    title.textContent = localized || item.title;
    div.appendChild(dot);
    div.appendChild(title);
    container.appendChild(div);
  });
}

async function load() {
  const lang = await detectLang();
  const version = chrome.runtime.getManifest().version;

  document.getElementById("pageTitle").textContent      = t(lang, {
    en: "What's New in Tab Tier",
    tr: "Tab Tier'daki Yenilikler",
    es: "Novedades en Tab Tier",
    de: "Neuerungen in Tab Tier",
    fr: "Nouveautés de Tab Tier",
  });
  document.getElementById("pageSubtitle").textContent   = t(lang, {
    en: "Version v" + version + " installed — thanks for using Tab Tier!",
    tr: "Sürüm v" + version + " yüklendi — teşekkürler!",
    es: "Versión v" + version + " instalada — ¡gracias por usar Tab Tier!",
    de: "Version v" + version + " installiert — danke, dass du Tab Tier nutzt!",
    fr: "Version v" + version + " installée — merci d'utiliser Tab Tier !",
  });
  document.getElementById("changelogTitle").textContent = t(lang, {
    en: "Recent Changes",
    tr: "Son Değişiklikler",
    es: "Cambios Recientes",
    de: "Neueste Änderungen",
    fr: "Changements récents",
  });
  document.getElementById("roadmapTitle").textContent   = t(lang, {
    en: "Coming Up",
    tr: "Yakında",
    es: "Próximamente",
    de: "Demnächst",
    fr: "À venir",
  });
  document.getElementById("openPopupBtn").textContent   = t(lang, {
    en: "Open Tab Tier",
    tr: "Tab Tier'ı Aç",
    es: "Abrir Tab Tier",
    de: "Tab Tier öffnen",
    fr: "Ouvrir Tab Tier",
  });
  document.getElementById("openSettingsBtn").textContent = t(lang, {
    en: "Settings",
    tr: "Ayarlar",
    es: "Ajustes",
    de: "Einstellungen",
    fr: "Paramètres",
  });

  try {
    const resp = await fetch(chrome.runtime.getURL("data/changelog.json"));
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const changelog = await resp.json();
    const latestEntry = changelog[0];
    if (latestEntry) {
      const d = formatDate(latestEntry.date, lang);
      document.getElementById("pageSubtitle").textContent =
        "v" + latestEntry.version + " — " + d;
    }
    renderChangelog(changelog, version, lang);
  } catch (e) {
    showError("changelogContainer", t(lang, {
      en: "Could not load changelog.",
      tr: "Değişiklikler yüklenemedi.",
      es: "No se pudo cargar el historial.",
      de: "Änderungsprotokoll konnte nicht geladen werden.",
      fr: "Impossible de charger le journal des changements.",
    }) + " (" + e.message + ")");
  }

  try {
    const resp = await fetch(chrome.runtime.getURL("data/roadmap.json"));
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const roadmap = await resp.json();
    renderRoadmap(roadmap, lang);
  } catch (e) {
    showError("roadmapContainer", t(lang, {
      en: "Could not load roadmap.",
      tr: "Yol haritası yüklenemedi.",
      es: "No se pudo cargar la hoja de ruta.",
      de: "Roadmap konnte nicht geladen werden.",
      fr: "Impossible de charger la feuille de route.",
    }) + " (" + e.message + ")");
  }
}

document.getElementById("openPopupBtn").addEventListener("click", () => {
  chrome.action.openPopup().catch(() => window.close());
});
document.getElementById("openSettingsBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("settings.html") });
});

load();
