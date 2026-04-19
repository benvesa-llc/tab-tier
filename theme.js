// EN: Applies theme instantly from localStorage (sync), then syncs with chrome.storage.
// TR: Temayı localStorage'dan anında uygular (sync), ardından chrome.storage ile senkronize eder.
(function applyTheme() {
  function apply(theme) {
    const t = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('tabtier-theme', t);
  }

  // EN: Apply immediately from localStorage — no async delay, no flash
  // TR: localStorage'dan anında uygula — async gecikme yok, flash yok
  const cached = localStorage.getItem('tabtier-theme');
  if (cached) {
    document.documentElement.setAttribute('data-theme', cached);
  }

  // EN: Then confirm / correct from chrome.storage (source of truth)
  // TR: Ardından chrome.storage'dan doğrula / düzelt (gerçek kaynak)
  chrome.storage.local.get('settings', ({ settings }) => {
    apply(settings?.theme || 'dark');
  });

  // EN: Live updates when storage changes (e.g. toggle clicked in popup)
  // TR: Storage değişince canlı güncelle (örn. popup'taki toggle)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings?.newValue) {
      apply(changes.settings.newValue.theme || 'dark');
    }
  });
})();
