// EN: Reads the saved theme preference and applies it to <html> as data-theme attribute.
// TR: Kaydedilen tema tercihini okur ve <html> öğesine data-theme niteliği olarak uygular.
(function applyTheme() {
  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
  }

  chrome.storage.local.get('settings', ({ settings }) => {
    apply(settings?.theme || 'dark');
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings?.newValue) {
      apply(changes.settings.newValue.theme || 'dark');
    }
  });
})();
