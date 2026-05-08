// EN: Detect UI language — stored preference wins; falls back to browser locale | TR: UI dilini tespit et — saklanan tercih önce gelir; yoksa tarayıcı dili
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

// EN: Translate a fixed UI string. Pass an object keyed by language code; falls back to en.
// TR: Sabit bir UI metnini çevir. Anahtar dil kodu olan obje al; en'e fallback yapar.
function t(lang, dict) {
  return dict[lang] || dict.en || "";
}

// EN: Pick the localized field of a section (body, bodyTR, bodyES, bodyDE, bodyFR…) | TR: Bir bölümün dil-alanını seç
function pickField(section, base, lang) {
  if (lang !== "en") {
    const localized = section[base + lang.toUpperCase()];
    if (localized) return localized;
  }
  return section[base];
}

// EN: Render the body string. Supported markup:
//     **bold**  → <strong>bold</strong>
//     `code`    → <code>code</code>
//     [[T0]] [[T1]] [[T2]] [[T3]] [[T4]] → tier color pills
//     blank lines split paragraphs; lines starting with "- " become a <ul>
// TR: body metnini render et. Desteklenen biçimler:
//     **kalın**, `code`, [[T0..T4]] tier rozetleri,
//     boş satırlar paragraf, "- " ile başlayan satırlar liste.
function renderBody(text) {
  if (!text) return "";

  const escape = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // EN: Inline replacements applied AFTER escape | TR: Escape sonrası inline değişimler
  const inline = (s) =>
    s
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\[\[T0\]\]/g, '<span class="tier-pill tier-t0">T0</span>')
      .replace(/\[\[T1\]\]/g, '<span class="tier-pill tier-t1">T1</span>')
      .replace(/\[\[T2\]\]/g, '<span class="tier-pill tier-t2">T2</span>')
      .replace(/\[\[T3\]\]/g, '<span class="tier-pill tier-t3">T3</span>')
      .replace(/\[\[T4\]\]/g, '<span class="tier-pill tier-t4">T4</span>');

  const blocks = text.split(/\n\s*\n/);
  const html = blocks.map((block) => {
    const lines = block.split("\n").map((l) => l.trimEnd());
    const allBullets = lines.every((l) => /^\s*-\s+/.test(l));
    if (allBullets && lines.length > 0) {
      const items = lines
        .map((l) => l.replace(/^\s*-\s+/, ""))
        .map((l) => `<li>${inline(escape(l))}</li>`)
        .join("");
      return `<ul>${items}</ul>`;
    }
    return `<p>${inline(escape(lines.join(" ")))}</p>`;
  });
  return html.join("");
}

function renderSections(sections, lang) {
  const container = document.getElementById("sectionsContainer");
  container.innerHTML = "";
  container.className = "";

  for (const section of sections) {
    const card = document.createElement("div");
    card.className = "help-section";

    const header = document.createElement("div");
    header.className = "help-section-header";

    const icon = document.createElement("span");
    icon.className = "help-section-icon";
    icon.textContent = section.icon || "📘";

    const title = document.createElement("span");
    title.className = "help-section-title";
    title.textContent = pickField(section, "title", lang) || section.title || "—";

    header.appendChild(icon);
    header.appendChild(title);

    const body = document.createElement("div");
    body.className = "help-section-body";
    body.innerHTML = renderBody(pickField(section, "body", lang) || "");

    card.appendChild(header);
    card.appendChild(body);
    container.appendChild(card);
  }
}

function showError(msg) {
  const el = document.getElementById("sectionsContainer");
  el.className = "loading";
  el.textContent = msg;
}

async function load() {
  const lang = await detectLang();

  document.getElementById("pageTitle").textContent = t(lang, {
    en: "Help & Guide",
    tr: "Yardım ve Rehber",
    es: "Ayuda y Guía",
    de: "Hilfe & Anleitung",
    fr: "Aide et Guide",
  });
  document.getElementById("pageSubtitle").textContent = t(lang, {
    en: "A quick walkthrough of how Tab Tier works.",
    tr: "Tab Tier'ın nasıl çalıştığına dair kısa bir rehber.",
    es: "Una guía rápida de cómo funciona Tab Tier.",
    de: "Eine kurze Übersicht, wie Tab Tier funktioniert.",
    fr: "Un aperçu rapide du fonctionnement de Tab Tier.",
  });
  document.getElementById("openPopupBtn").textContent = t(lang, {
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
  document.getElementById("openWhatsNewBtn").textContent = t(lang, {
    en: "What's New",
    tr: "Yenilikler",
    es: "Novedades",
    de: "Neuerungen",
    fr: "Nouveautés",
  });

  try {
    const resp = await fetch(chrome.runtime.getURL("data/help.json"));
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const sections = await resp.json();
    renderSections(sections, lang);
  } catch (e) {
    showError(
      t(lang, {
        en: "Could not load help content.",
        tr: "Yardım içeriği yüklenemedi.",
        es: "No se pudo cargar el contenido de ayuda.",
        de: "Hilfeinhalt konnte nicht geladen werden.",
        fr: "Impossible de charger le contenu d'aide.",
      }) +
        " (" +
        e.message +
        ")"
    );
  }
}

document.getElementById("openPopupBtn").addEventListener("click", () => {
  chrome.action.openPopup().catch(() => window.close());
});
document.getElementById("openSettingsBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("settings.html") });
});
document.getElementById("openWhatsNewBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("whatsnew.html") });
});

load();
