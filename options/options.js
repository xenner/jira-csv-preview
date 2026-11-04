const $ = (id) => document.getElementById(id);

const I18n = window.JCPI18n;
const i18nReady = I18n ? I18n.ready : Promise.resolve();
const t = (key, substitutions) => (I18n ? I18n.t(key, substitutions) : key);

const DEFAULTS = {
  theme: 'auto',
  density: 'comfortable',
  fontSize: 13,
  firstRowHeader: true
};

const BROAD_ACCESS = { origins: ['*://*/*'] };
const SCRIPT_ID = 'jcp-extra-sites';
const ATLASSIAN_HOST_RE = /(?:^|\.)(?:atlassian\.net|atlassian\.com|jira\.com)$/i;

let savedTimer = null;
let extraSites = [];

function showSaved (message = t('saved')) {
  const saved = $('saved');
  saved.textContent = message;
  saved.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => saved.classList.remove('show'), 1600);
}

function showSiteError (message) {
  const error = $('site-error');
  if (!message) {
    error.hidden = true;
    error.textContent = '';
    return;
  }
  error.textContent = message;
  error.hidden = false;
}

function normalizeSite (value) {
  let raw = String(value || '').trim();
  if (!raw) throw new Error(t('siteUrlRequired'));
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(t('siteUrlInvalid'));
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(t('siteUrlProtocol'));
  }
  if (url.username || url.password) {
    throw new Error(t('siteUrlCredentials'));
  }

  const path = url.pathname.replace(/\/+$/, '');
  return url.origin + (path === '/' ? '' : path);
}

function permissionPattern (site) {
  // Ask for the whole origin so attachment downloads and the REST API work
  // even when Jira lives under a context path such as /jira.
  return new URL(site).origin + '/*';
}

function siteOrigin (site) {
  return new URL(site).origin;
}

async function hasRegisteredScript () {
  try {
    const scripts = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    return scripts.length > 0;
  } catch {
    return false;
  }
}

async function syncDynamicScripts () {
  const patterns = [];
  for (const site of extraSites) {
    try {
      if (await chrome.permissions.contains({ origins: [permissionPattern(site)] })) {
        patterns.push(site + '/*');
      }
    } catch { /* ignore */ }
  }

  try {
    if (await hasRegisteredScript()) {
      await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    }
    if (patterns.length) {
      await chrome.scripting.registerContentScripts([{
        id: SCRIPT_ID,
        matches: patterns,
        js: ['src/content.js'],
        css: ['src/content.css'],
        runAt: 'document_idle',
        allFrames: false,
        persistAcrossSessions: true
      }]);
    }
  } catch (err) {
    console.warn('No se pudieron registrar los sitios adicionales', err);
    showSiteError(t('siteEnableError'));
  }
}

function renderSiteList () {
  const list = $('site-list');
  list.replaceChildren();

  if (!extraSites.length) {
    const empty = document.createElement('div');
    empty.className = 'form-note';
    empty.style.margin = '0 0 10px';
    empty.textContent = t('noExtraSites');
    list.appendChild(empty);
    return;
  }

  for (const site of extraSites) {
    const item = document.createElement('div');
    item.className = 'site-item';

    const dot = document.createElement('span');
    dot.className = 'dot';

    const code = document.createElement('code');
    code.textContent = site;
    code.title = site;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'link-btn';
    remove.textContent = t('removeSite');
    remove.addEventListener('click', () => removeSite(site));

    item.append(dot, code, remove);
    list.appendChild(item);
  }
}

async function addSite (event) {
  event.preventDefault();
  showSiteError('');

  let site;
  try {
    site = normalizeSite($('site-input').value);
  } catch (err) {
    showSiteError(err.message);
    return;
  }

  if (extraSites.includes(site)) {
    showSiteError(t('siteDuplicate'));
    return;
  }

  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [permissionPattern(site)] });
  } catch {
    showSiteError(t('sitePermissionRequestFailed'));
    return;
  }

  if (!granted) {
    showSiteError(t('sitePermissionDenied'));
    return;
  }

  extraSites.push(site);
  await chrome.storage.local.set({ extraSites });
  await syncDynamicScripts();
  renderSiteList();
  $('site-input').value = '';
  $('reload-tabs').hidden = false;
  showSaved(t('siteAdded'));
}

async function removeSite (site) {
  extraSites = extraSites.filter((item) => item !== site);
  await chrome.storage.local.set({ extraSites });

  const origin = siteOrigin(site);
  const stillUsed = extraSites.some((item) => siteOrigin(item) === origin);
  if (!stillUsed) {
    try {
      await chrome.permissions.remove({ origins: [permissionPattern(site)] });
    } catch { /* it may be covered by the broad permission */ }
  }

  await syncDynamicScripts();
  renderSiteList();
  $('reload-tabs').hidden = false;
  showSaved(t('siteRemoved'));
}

async function reloadJiraTabs () {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    showSaved(t('reloadFailed'));
    return;
  }

  let count = 0;
  for (const tab of tabs) {
    if (!tab.url || tab.id == null) continue;
    let url;
    try {
      url = new URL(tab.url);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;

    const isAtlassian = ATLASSIAN_HOST_RE.test(url.hostname);
    const isExtra = extraSites.some((site) => tab.url.startsWith(site));
    if (!isAtlassian && !isExtra) continue;

    try {
      await chrome.tabs.reload(tab.id);
      count++;
    } catch { /* ignore a tab that cannot be reloaded */ }
  }

  $('reload-tabs').hidden = true;
  showSaved(count
    ? (count === 1 ? t('tabsReloadedOne') : t('tabsReloadedMany', [I18n ? I18n.formatInt(count) : String(count)]))
    : t('noJiraTabs'));
}

async function init () {
  await i18nReady;
  const stored = await chrome.storage.local.get({ ...DEFAULTS, extraSites: [] });
  extraSites = Array.isArray(stored.extraSites) ? stored.extraSites.slice() : [];

  $('theme').value = stored.theme || 'auto';
  $('density').value = stored.density || 'comfortable';
  $('font-size').value = stored.fontSize;
  $('font-size-out').textContent = stored.fontSize + ' px';
  $('first-row-header').checked = stored.firstRowHeader !== false;
  $('version-line').textContent = t('versionFooter', [chrome.runtime.getManifest().version]);

  renderSiteList();
  await syncDynamicScripts();

  try {
    $('broad-access').checked = await chrome.permissions.contains(BROAD_ACCESS);
  } catch { /* ignore */ }

  $('theme').addEventListener('change', async (event) => {
    await chrome.storage.local.set({ theme: event.target.value });
    showSaved();
  });

  $('density').addEventListener('change', async (event) => {
    await chrome.storage.local.set({ density: event.target.value });
    showSaved();
  });

  $('font-size').addEventListener('input', (event) => {
    $('font-size-out').textContent = event.target.value + ' px';
  });
  $('font-size').addEventListener('change', async (event) => {
    await chrome.storage.local.set({ fontSize: Number(event.target.value) });
    showSaved();
  });

  $('first-row-header').addEventListener('change', async (event) => {
    await chrome.storage.local.set({ firstRowHeader: event.target.checked });
    showSaved();
  });

  $('site-form').addEventListener('submit', addSite);
  $('reload-tabs').addEventListener('click', reloadJiraTabs);

  $('broad-access').addEventListener('change', async (event) => {
    if (event.target.checked) {
      let granted = false;
      try {
        granted = await chrome.permissions.request(BROAD_ACCESS);
      } catch { /* ignore */ }
      event.target.checked = granted;
      if (!granted) {
        showSaved(t('broadPermissionDenied'));
        return;
      }
      showSaved();
    } else {
      try {
        await chrome.permissions.remove(BROAD_ACCESS);
      } catch { /* ignore */ }
      showSaved();
    }
  });
}

init();
