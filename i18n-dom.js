// EN: Applies i18n substitutions to __MSG_*__ placeholders in the DOM.
//     If settings.uiLanguage is set (not "auto"), fetches the matching
//     _locales/{lang}/messages.json and uses it instead of chrome.i18n.
// TR: DOM'daki __MSG_*__ yer tutucularına i18n değerlerini uygular.
//     settings.uiLanguage ayarlıysa (auto değilse) ilgili messages.json
//     dosyasını fetch eder ve chrome.i18n yerine kullanır.
(async function applyI18n() {
  // EN: Try to load a stored language override | TR: Saklanan dil tercihini yükle
  let messages = null;
  try {
    const { settings = {} } = await chrome.storage.local.get("settings");
    const lang = settings.uiLanguage;
    if (lang && lang !== "auto") {
      const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
      const resp = await fetch(url);
      if (resp.ok) messages = await resp.json();
    }
  } catch (e) { /* fall back to chrome.i18n */ }

  const RE = /__MSG_(\w+)__/g;

  // EN: Resolve a key — from loaded JSON or from chrome.i18n
  // TR: Anahtarı çöz — yüklenen JSON'dan veya chrome.i18n'dan
  function msg(key) {
    if (messages) {
      const entry = messages[key];
      return entry ? entry.message : `[${key}]`;
    }
    return chrome.i18n.getMessage(key) || `[${key}]`;
  }

  function sub(str) {
    return str.replace(RE, (_, key) => msg(key));
  }

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent.includes('__MSG_')) {
        node.textContent = sub(node.textContent);
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const ATTRS = ['placeholder', 'title', 'value', 'alt', 'aria-label'];
      for (const attr of ATTRS) {
        const val = node.getAttribute(attr);
        if (val && val.includes('__MSG_')) {
          node.setAttribute(attr, sub(val));
        }
      }
      for (const child of node.childNodes) {
        walk(child);
      }
    }
  }

  function run() {
    if (document.title.includes('__MSG_')) {
      document.title = sub(document.title);
    }
    if (document.body) walk(document.body);
  }

  // EN: After await, DOM may already be ready | TR: Await sonrası DOM hazır olabilir
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }

  // EN: Expose resolved message function for JS files loaded after this script
  // TR: Bu scriptten sonra yüklenen JS dosyaları için çözümleme fonksiyonunu aç
  window.i18nMsg = msg;
})();
