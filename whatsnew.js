// EN: Detect UI language — stored preference wins; falls back to browser locale
// TR: UI dilini tespit et — saklanan tercih önce gelir; yoksa tarayıcı dili
async function detectLang() {
  try {
    const { settings = {} } = await chrome.storage.local.get("settings");
    const stored = settings.uiLanguage;
    if (stored && stored !== "auto") return stored;
  } catch (e) {}
  return chrome.i18n.getUILanguage().toLowerCase().startsWith("tr") ? "tr"
       : chrome.i18n.getUILanguage().toLowerCase().startsWith("es") ? "es"
       : "en";
}

// EN: Category labels match CHANGELOG.md headings (Added / Changed / Fixed) so users see the same
//     category vocabulary in both places. Order is fixed: feat → change → fix.
// TR: Kategori etiketleri CHANGELOG.md başlıklarıyla aynıdır (Added / Changed / Fixed); kullanıcı
//     iki yerde de aynı kategori sözlüğünü görür. Sıra sabit: feat → change → fix.
const CATEGORY_ORDER = ["feat", "change", "fix"];
function categoryLabel(type, lang) {
  const labels = {
    feat:   { en: "Added",   tr: "Eklenenler",    es: "Añadido" },
    change: { en: "Changed", tr: "Değişenler",    es: "Cambiado" },
    fix:    { en: "Fixed",   tr: "Düzeltilenler", es: "Corregido" },
  };
  return (labels[type] || {})[lang] || (labels[type] || {}).en || type;
}

function formatDate(dateStr, lang) {
  const locale = lang === "tr" ? "tr-TR" : lang === "es" ? "es-ES" : "en-US";
  try {
    return new Date(dateStr).toLocaleDateString(locale, {
      year: "numeric", month: "long", day: "numeric",
    });
  } catch (e) { return dateStr; }
}

function t(lang, en, tr, es) {
  if (lang === "tr") return tr;
  if (lang === "es") return es;
  return en;
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
      badge.textContent = t(lang, "Installed", "Yüklü", "Instalado");
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
        li.textContent =
          lang === "tr" && c.textTR ? c.textTR :
          lang === "es" && c.textES ? c.textES :
          c.text;
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
    title.textContent = lang === "tr" && item.titleTR ? item.titleTR
                      : lang === "es" && item.titleES ? item.titleES
                      : item.title;
    div.appendChild(dot);
    div.appendChild(title);
    container.appendChild(div);
  });
}

async function load() {
  const lang = await detectLang();
  const version = chrome.runtime.getManifest().version;

  document.getElementById("pageTitle").textContent      = t(lang, "What's New in Tab Tier", "Tab Tier'daki Yenilikler", "Novedades en Tab Tier");
  document.getElementById("pageSubtitle").textContent   = t(lang,
    "Version v" + version + " installed — thanks for using Tab Tier!",
    "Sürüm v" + version + " yüklendi — teşekkürler!",
    "Versión v" + version + " instalada — ¡gracias por usar Tab Tier!"
  );
  document.getElementById("changelogTitle").textContent = t(lang, "Recent Changes", "Son Değişiklikler", "Cambios Recientes");
  document.getElementById("roadmapTitle").textContent   = t(lang, "Coming Up", "Yakında", "Próximamente");
  document.getElementById("openPopupBtn").textContent   = t(lang, "Open Tab Tier", "Tab Tier'ı Aç", "Abrir Tab Tier");
  document.getElementById("openSettingsBtn").textContent = t(lang, "Settings", "Ayarlar", "Ajustes");

  try {
    const resp = await fetch(chrome.runtime.getURL("data/changelog.json"));
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const changelog = await resp.json();
    const latestEntry = changelog[0];
    if (latestEntry) {
      const d = formatDate(latestEntry.date, lang);
      document.getElementById("pageSubtitle").textContent = t(lang,
        "v" + latestEntry.version + " — " + d,
        "v" + latestEntry.version + " — " + d,
        "v" + latestEntry.version + " — " + d
      );
    }
    renderChangelog(changelog, version, lang);
  } catch (e) {
    showError("changelogContainer", t(lang,
      "Could not load changelog.",
      "Değişiklikler yüklenemedi.",
      "No se pudo cargar el historial."
    ) + " (" + e.message + ")");
  }

  try {
    const resp = await fetch(chrome.runtime.getURL("data/roadmap.json"));
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const roadmap = await resp.json();
    renderRoadmap(roadmap, lang);
  } catch (e) {
    showError("roadmapContainer", t(lang,
      "Could not load roadmap.",
      "Yol haritası yüklenemedi.",
      "No se pudo cargar la hoja de ruta."
    ) + " (" + e.message + ")");
  }
}

document.getElementById("openPopupBtn").addEventListener("click", () => {
  chrome.action.openPopup().catch(() => window.close());
});
document.getElementById("openSettingsBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("settings.html") });
});

load();
