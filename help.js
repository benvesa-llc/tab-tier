// EN: Detect UI language — stored preference wins; falls back to browser locale | TR: UI dilini tespit et — saklanan tercih önce gelir; yoksa tarayıcı dili
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

function t(lang, en, tr, es) {
  if (lang === "tr") return tr;
  if (lang === "es") return es;
  return en;
}

// EN: Pick the localized field of a section (body / bodyTR / bodyES, etc.) | TR: Bir bölümün dil-alanını seç
function pickField(section, base, lang) {
  if (lang === "tr") return section[base + "TR"] || section[base];
  if (lang === "es") return section[base + "ES"] || section[base];
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

  document.getElementById("pageTitle").textContent = t(
    lang,
    "Help & Guide",
    "Yardım ve Rehber",
    "Ayuda y Guía"
  );
  document.getElementById("pageSubtitle").textContent = t(
    lang,
    "A quick walkthrough of how Tab Tier works.",
    "Tab Tier'ın nasıl çalıştığına dair kısa bir rehber.",
    "Una guía rápida de cómo funciona Tab Tier."
  );
  document.getElementById("openPopupBtn").textContent = t(
    lang,
    "Open Tab Tier",
    "Tab Tier'ı Aç",
    "Abrir Tab Tier"
  );
  document.getElementById("openSettingsBtn").textContent = t(
    lang,
    "Settings",
    "Ayarlar",
    "Ajustes"
  );
  document.getElementById("openWhatsNewBtn").textContent = t(
    lang,
    "What's New",
    "Yenilikler",
    "Novedades"
  );

  try {
    const resp = await fetch(chrome.runtime.getURL("data/help.json"));
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const sections = await resp.json();
    renderSections(sections, lang);
  } catch (e) {
    showError(
      t(
        lang,
        "Could not load help content.",
        "Yardım içeriği yüklenemedi.",
        "No se pudo cargar el contenido de ayuda."
      ) +
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
