// EN: Locale detection | TR: Dil tespiti
const isTR = chrome.i18n.getUILanguage().toLowerCase().startsWith("tr");
const lang = chrome.i18n.getUILanguage() || "en";

function t(en, tr) { return isTR ? tr : en; }

function typeLabel(type) {
  if (type === "feature")     return t("Feature",     "Özellik");
  if (type === "fix")         return t("Fix",          "Düzeltme");
  if (type === "improvement") return t("Improvement",  "İyileştirme");
  return type;
}

function statusLabel(status) {
  if (status === "in_progress") return t("In Progress", "Geliştiriliyor");
  return t("Planned", "Planlandı");
}

function formatDate(dateStr) {
  try {
    return new Date(dateStr).toLocaleDateString(lang, {
      year: "numeric", month: "long", day: "numeric",
    });
  } catch (e) { return dateStr; }
}

function showError(id, msg) {
  const el = document.getElementById(id);
  el.className = "";
  el.textContent = msg;
}

function renderChangelog(changelog, version) {
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
    dateSpan.textContent = formatDate(entry.date);
    header.appendChild(numSpan);
    header.appendChild(dateSpan);
    if (isCurrent) {
      const badge = document.createElement("span");
      badge.className = "version-badge";
      badge.textContent = t("Installed", "Yüklü");
      header.appendChild(badge);
    }

    const list = document.createElement("ul");
    list.className = "change-list";
    entry.changes.forEach(c => {
      const li = document.createElement("li");
      li.className = "change-item";
      const badge = document.createElement("span");
      badge.className = "change-type type-" + c.type;
      badge.textContent = typeLabel(c.type);
      const txt = document.createElement("span");
      txt.textContent = (isTR && c.textTR) ? c.textTR : c.text;
      li.appendChild(badge);
      li.appendChild(txt);
      list.appendChild(li);
    });

    card.appendChild(header);
    card.appendChild(list);
    container.appendChild(card);
  });
}

function renderRoadmap(roadmap) {
  const container = document.getElementById("roadmapContainer");
  container.innerHTML = "";
  container.className = "roadmap-list";

  roadmap.forEach(item => {
    const div = document.createElement("div");
    div.className = "roadmap-item";
    const dot = document.createElement("span");
    dot.className = "roadmap-dot dot-" + item.status;
    dot.title = statusLabel(item.status);
    const title = document.createElement("span");
    title.className = "roadmap-title";
    title.textContent = (isTR && item.titleTR) ? item.titleTR : item.title;
    const eta = document.createElement("span");
    eta.className = "roadmap-eta";
    eta.textContent = item.eta;
    div.appendChild(dot);
    div.appendChild(title);
    div.appendChild(eta);
    container.appendChild(div);
  });
}

async function load() {
  const version = chrome.runtime.getManifest().version;

  document.getElementById("pageTitle").textContent      = t("What's New in Tab Tier", "Tab Tier'daki Yenilikler");
  document.getElementById("pageSubtitle").textContent   = t("Version v" + version + " installed — thanks for using Tab Tier!", "Sürüm v" + version + " yüklendi — teşekkürler!");
  document.getElementById("changelogTitle").textContent = t("Recent Changes", "Son Değişiklikler");
  document.getElementById("roadmapTitle").textContent   = t("Coming Up", "Yakında");
  document.getElementById("openPopupBtn").textContent   = t("Open Tab Tier", "Tab Tier'ı Aç");
  document.getElementById("openSettingsBtn").textContent = t("Settings", "Ayarlar");

  try {
    const resp = await fetch(chrome.runtime.getURL("data/changelog.json"));
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const changelog = await resp.json();
    renderChangelog(changelog, version);
  } catch (e) {
    showError("changelogContainer", t("Could not load changelog.", "Değişiklikler yüklenemedi.") + " (" + e.message + ")");
  }

  try {
    const resp = await fetch(chrome.runtime.getURL("data/roadmap.json"));
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const roadmap = await resp.json();
    renderRoadmap(roadmap);
  } catch (e) {
    showError("roadmapContainer", t("Could not load roadmap.", "Yol haritası yüklenemedi.") + " (" + e.message + ")");
  }
}

document.getElementById("openPopupBtn").addEventListener("click", () => {
  chrome.action.openPopup().catch(() => window.close());
});
document.getElementById("openSettingsBtn").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("settings.html") });
});

load();
