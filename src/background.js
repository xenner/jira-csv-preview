/* Service worker: talks to the Jira REST API and downloads attachments with the
   user's existing session. Nothing leaves the browser. */

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const LOGIN_RE = /id\.atlassian\.com\/login|login\.jsp/i;

const t = (key, substitutions) => {
  try {
    return chrome.i18n.getMessage(key, substitutions) || key;
  } catch {
    return key;
  }
};

const uiLocale = (() => {
  try {
    return chrome.i18n.getMessage('localeCode') || chrome.i18n.getMessage('@@ui_locale') || chrome.i18n.getUILanguage() || 'en';
  } catch {
    return 'en';
  }
})().replace(/_/g, '-');
const numberFormatter = new Intl.NumberFormat(uiLocale);
const decimalFormatter = new Intl.NumberFormat(uiLocale, { maximumFractionDigits: 1 });

function formatBytes (bytes) {
  if (bytes < 1024) return numberFormatter.format(bytes) + ' B';
  if (bytes < 1048576) return decimalFormatter.format(bytes / 1024) + ' KB';
  return decimalFormatter.format(bytes / 1048576) + ' MB';
}

async function fetchJson (url) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { Accept: 'application/json' }
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${res.statusText}`.trim());
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** Jira Cloud uses API v3; Data Center and older instances expose v2. */
async function fetchAttachments (baseUrl, issueKey) {
  let lastError = null;
  for (const version of [3, 2]) {
    const url = `${baseUrl}/rest/api/${version}/issue/${encodeURIComponent(issueKey)}?fields=attachment`;
    try {
      const data = await fetchJson(url);
      const list = (data && data.fields && data.fields.attachment) || [];
      return { attachments: list, apiVersion: version };
    } catch (err) {
      lastError = err;
      // A missing issue / permissions problem will not be fixed by trying v2.
      if (err.status && err.status !== 404 && err.status !== 400) break;
    }
  }
  throw lastError || new Error(t('couldNotQueryIssue'));
}

function toBase64 (buffer) {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchBytes (url) {
  const res = await fetch(url, {
    credentials: 'include',
    redirect: 'follow',
    headers: {
      Accept: 'text/csv, text/tab-separated-values, text/plain, */*'
    }
  });

  if (!res.ok) {
    throw new Error(t('couldNotDownloadAttachment', [String(res.status)]));
  }
  if (LOGIN_RE.test(res.url)) {
    throw new Error(t('sessionExpired'));
  }

  const length = Number(res.headers.get('content-length') || 0);
  if (length > MAX_BYTES) {
    const err = new Error(t('fileTooLargeWithSize', [formatBytes(length), formatBytes(MAX_BYTES)]));
    err.code = 'TOO_LARGE';
    throw err;
  }

  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) {
    const err = new Error(t('fileTooLargeLimit', [formatBytes(MAX_BYTES)]));
    err.code = 'TOO_LARGE';
    throw err;
  }
  if (!buffer.byteLength) {
    throw new Error(t('fileEmpty'));
  }

  const contentType = res.headers.get('content-type') || '';
  if (/text\/html/i.test(contentType)) {
    const head = new TextDecoder('utf-8').decode(buffer.subarray(0, 600)).trim().toLowerCase();
    if (head.startsWith('<!doctype') || head.startsWith('<html') || head.includes('<head') || head.includes('<body')) {
      throw new Error(t('loginPageReturned'));
    }
  }

  return {
    base64: toBase64(buffer),
    size: buffer.byteLength,
    contentType,
    finalUrl: res.url
  };
}

async function hasBroadAccess () {
  try {
    return await chrome.permissions.contains({ origins: ['*://*/*'] });
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.type) {
        case 'CSV_FETCH_ATTACHMENTS':
          sendResponse({
            ok: true,
            data: await fetchAttachments(msg.baseUrl, msg.issueKey)
          });
          break;
        case 'CSV_FETCH_BYTES':
          sendResponse({ ok: true, data: await fetchBytes(msg.url) });
          break;
        case 'CSV_OPEN_OPTIONS':
          await chrome.runtime.openOptionsPage();
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ ok: false, error: t('unknownMessage') });
      }
    } catch (err) {
      const message = String((err && err.message) || err);
      // Chrome throws TypeError when the final redirect host is not covered by
      // the extension's host permissions. That is actionable in settings.
      const needsPermission = err instanceof TypeError && !(await hasBroadAccess());
      sendResponse({
        ok: false,
        error: message,
        code: err && err.code,
        needsPermission
      });
    }
  })();
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'open-csv-panel') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return;
  chrome.tabs.sendMessage(tab.id, { type: 'CSV_TOGGLE_PANEL' }).catch(() => {});
});

/* Dynamic content scripts are registered by the options page for self-hosted
   Jira sites. Re-register them after an install/update if Chrome cleared them. */
const EXTRA_SCRIPT_ID = 'jcp-extra-sites';

async function ensureExtraSiteScripts () {
  try {
    const stored = await chrome.storage.local.get({ extraSites: [] });
    const sites = Array.isArray(stored.extraSites) ? stored.extraSites : [];
    if (!sites.length) return;

    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [EXTRA_SCRIPT_ID] });
    if (existing.length) return;

    const patterns = [];
    for (const site of sites) {
      try {
        const origin = new URL(site).origin;
        if (await chrome.permissions.contains({ origins: [origin + '/*'] })) {
          patterns.push(site + '/*');
        }
      } catch { /* skip malformed stored entries */ }
    }
    if (!patterns.length) return;

    await chrome.scripting.registerContentScripts([{
      id: EXTRA_SCRIPT_ID,
      matches: patterns,
      js: ['src/content.js'],
      css: ['src/content.css'],
      runAt: 'document_idle',
      allFrames: false,
      persistAcrossSessions: true
    }]);
  } catch (err) {
    console.warn('No se pudieron restaurar los sitios adicionales', err);
  }
}

chrome.runtime.onInstalled.addListener(() => { ensureExtraSiteScripts(); });
chrome.runtime.onStartup.addListener(() => { ensureExtraSiteScripts(); });
