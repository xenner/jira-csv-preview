/* Small i18n helper for extension pages. It uses chrome.i18n when available
   and falls back to the default English messages when the page is opened
   outside the extension (for example, the local test harness). */

(() => {
  if (window.JCPI18n) return;

  const hasChrome = typeof chrome !== 'undefined' &&
    chrome.i18n &&
    typeof chrome.i18n.getMessage === 'function';

  const fallbackMessages = {};

  function detectLocale () {
    try {
      const injectedLocale = hasChrome ? chrome.i18n.getMessage('localeCode') : '';
      const chromeLocale = hasChrome ? chrome.i18n.getMessage('@@ui_locale') : '';
      const value = injectedLocale || chromeLocale || (hasChrome ? chrome.i18n.getUILanguage() : (navigator.language || 'en'));
      return String(value || 'en').replace(/_/g, '-');
    } catch {
      return 'en';
    }
  }

  const locale = detectLocale();
  const intFormatter = new Intl.NumberFormat(locale);
  const decimalFormatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

  function formatInt (value) {
    return intFormatter.format(Number(value) || 0);
  }

  function formatBytes (bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${formatInt(value)} B`;
    if (value < 1048576) return `${decimalFormatter.format(value / 1024)} KB`;
    return `${decimalFormatter.format(value / 1048576)} MB`;
  }

  async function loadFallback () {
    if (hasChrome) return;
    try {
      const base = location.pathname.includes('/options/') ? '../' : '';
      const response = await fetch(base + '_locales/en/messages.json');
      const json = await response.json();
      for (const [key, entry] of Object.entries(json)) {
        fallbackMessages[key] = entry && entry.message ? entry.message : '';
      }
    } catch { /* keep English markup */ }
  }

  function substitute (message, substitutions) {
    const values = substitutions == null
      ? []
      : (Array.isArray(substitutions) ? substitutions : [substitutions]);
    return String(message).replace(/\$(\d+)/g, (match, index) => {
      const value = values[Number(index) - 1];
      return value == null ? match : String(value);
    });
  }

  function get (key, substitutions) {
    if (!key) return '';
    if (hasChrome) {
      try {
        return chrome.i18n.getMessage(key, substitutions) || '';
      } catch {
        return '';
      }
    }
    return fallbackMessages[key] ? substitute(fallbackMessages[key], substitutions) : '';
  }

  function t (key, substitutions) {
    return get(key, substitutions) || key;
  }

  function apply (root = document) {
    for (const node of root.querySelectorAll('[data-i18n]')) {
      const value = get(node.dataset.i18n);
      if (!value) continue;
      node.textContent = value;
      if (node.tagName === 'TITLE') document.title = value;
    }

    for (const attribute of ['title', 'aria-label', 'placeholder', 'alt']) {
      const selector = `[data-i18n-${attribute}]`;
      for (const node of root.querySelectorAll(selector)) {
        const value = get(node.getAttribute(`data-i18n-${attribute}`));
        if (value) node.setAttribute(attribute, value);
      }
    }

    document.documentElement.lang = locale;
  }

  const ready = loadFallback().then(() => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => apply(), { once: true });
    } else {
      apply();
    }
  });

  window.JCPI18n = { t, get, apply, ready, locale, formatInt, formatBytes };
})();
