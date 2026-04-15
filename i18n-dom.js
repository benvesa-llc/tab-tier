// EN: Applies chrome.i18n substitutions to all __MSG_*__ placeholders in the DOM.
// TR: DOM'daki tüm __MSG_*__ yer tutucularına chrome.i18n değerlerini uygular.
(function applyI18n() {
  const RE = /__MSG_(\w+)__/g;

  // EN: Replace all __MSG_*__ tokens in a string | TR: Bir dizideki tüm __MSG_*__ ifadelerini değiştir
  function sub(str) {
    return str.replace(RE, (_, key) => chrome.i18n.getMessage(key) || `[${key}]`);
  }

  // EN: Walk every node: substitute text nodes and key attributes
  // TR: Tüm düğümleri gez: metin düğümlerini ve temel nitelikleri değiştir
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
    // EN: Substitute in <title> | TR: <title> etiketinde değiştir
    if (document.title.includes('__MSG_')) {
      document.title = sub(document.title);
    }
    walk(document.body);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
