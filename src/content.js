/* Content script: find CSV/TSV attachments on the Jira issue being viewed and
   open them in the CSV viewer. The Jira REST API is the source of truth: the
   modern issue view renders attachments as cards, where the file name and
   download URL are not exposed as a normal link. */

(() => {
  if (window.__jcpInjected) return;
  window.__jcpInjected = true;

  const CSV_RE = /\.(csv|tsv)$/i;
  const KEY_RE = /^[A-Z][A-Z0-9_]{1,20}-\d+$/i;
  const ATTACHMENT_HREF_RE = /\/secure\/attachment\/|\/attachment\/content\/|api\.media\.atlassian\.com|\/download\//i;

  const t = (key, substitutions) => {
    try {
      return chrome.i18n.getMessage(key, substitutions) || key;
    } catch {
      return key;
    }
  };

  const uiLocale = (() => {
    try {
      return chrome.i18n.getMessage('localeCode') || chrome.i18n.getMessage('@@ui_locale') || chrome.i18n.getUILanguage() || navigator.language || 'en';
    } catch {
      return navigator.language || 'en';
    }
  })().replace(/_/g, '-');
  const numberFormatter = new Intl.NumberFormat(uiLocale);
  const decimalFormatter = new Intl.NumberFormat(uiLocale, { maximumFractionDigits: 1 });

  const send = (msg) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
        else resolve(res || { ok: false, error: t('noResponse') });
      });
    } catch (err) {
      resolve({ ok: false, error: String((err && err.message) || err) });
    }
  });

  const formatSize = (bytes) => {
    if (bytes == null || Number.isNaN(Number(bytes))) return '';
    const n = Number(bytes);
    if (n < 1024) return numberFormatter.format(n) + ' B';
    if (n < 1048576) return decimalFormatter.format(n / 1024) + ' KB';
    return decimalFormatter.format(n / 1048576) + ' MB';
  };

  /* ------------------------------------------------------------- issue key */

  function issueKeyFromUrl () {
    let path = location.pathname;
    try { path = decodeURIComponent(path); } catch { /* keep the raw path */ }

    let match = path.match(/\/(?:browse|issues)\/([A-Z][A-Z0-9_]{1,20}-\d+)(?:[/?#]|$)/i);
    if (match) return match[1].toUpperCase();

    const selected = new URLSearchParams(location.search).get('selectedIssue');
    if (selected && KEY_RE.test(selected)) return selected.toUpperCase();

    match = path.match(/\/(?:projects|boards)\/[^/]+\/(?:issues|backlog)?\/?([A-Z][A-Z0-9_]{1,20}-\d+)(?:[/?#]|$)/i);
    if (match) return match[1].toUpperCase();

    // Last resort for Jira installations with custom issue paths.
    match = path.match(/\/([A-Z][A-Z0-9_]{1,20}-\d+)(?:[/?#]|$)/);
    if (match) return match[1].toUpperCase();

    return null;
  }

  function issueKeyFromDom () {
    const meta = document.querySelector('meta[name="ajs-issue-key"], meta[name="issue-key"]');
    if (meta && KEY_RE.test((meta.content || '').trim())) return meta.content.trim().toUpperCase();

    const dialogHolder = document.querySelector('[role="dialog"] [data-issue-key], [data-testid*="issue"] [data-issue-key]');
    const holders = dialogHolder
      ? [dialogHolder]
      : [...document.querySelectorAll('[data-issue-key]')].filter((element) => element.getClientRects().length > 0);
    if (holders.length === 1) {
      const value = (holders[0].getAttribute('data-issue-key') || '').trim();
      if (KEY_RE.test(value)) return value.toUpperCase();
    }

    const keyEl = document.querySelector('#key-val');
    if (keyEl) {
      const value = (keyEl.textContent || '').trim();
      if (KEY_RE.test(value)) return value.toUpperCase();
    }

    const titleMatch = (document.title || '').match(/\b([A-Z][A-Z0-9_]{1,20}-\d+)\b/i);
    if (titleMatch) return titleMatch[1].toUpperCase();
    return null;
  }

  function currentIssueKey () {
    return issueKeyFromUrl() || issueKeyFromDom();
  }

  /** Jira Data Center can live under a context path such as /jira. */
  function jiraBaseUrl () {
    const baseMeta = document.querySelector('meta[name="ajs-base-url"]');
    if (baseMeta && baseMeta.content) {
      try {
        const base = new URL(baseMeta.content, location.origin);
        return base.origin + base.pathname.replace(/\/+$/, '');
      } catch { /* fall through */ }
    }
    const contextMeta = document.querySelector('meta[name="ajs-context-path"]');
    if (contextMeta && contextMeta.content) {
      const path = contextMeta.content.startsWith('/') ? contextMeta.content : '/' + contextMeta.content;
      return location.origin + path.replace(/\/+$/, '');
    }
    return location.origin;
  }

  /* ------------------------------------------------------------ discovery */

  let issueKey = null;
  let attachments = [];
  let loadedFor = null;
  let requestSeq = 0;
  let loadingAttachments = false;
  let retryKey = null;
  let retryCount = 0;

  const isCsv = (filename) => CSV_RE.test(String(filename || '').trim());

  function mapAttachment (att) {
    let url = att.content || (att._links && att._links.content) || '';
    if (url) {
      try {
        url = new URL(url, jiraBaseUrl() + '/').href;
      } catch { /* keep the raw URL */ }
    }
    return {
      filename: String(att.filename || '').trim(),
      url,
      size: att.size,
      mime: att.mimeType || '',
      id: att.id
    };
  }

  async function loadAttachments (force = false) {
    const key = currentIssueKey();
    if (!key) {
      requestSeq++;
      loadingAttachments = false;
      issueKey = null;
      loadedFor = null;
      attachments = [];
      renderLauncher();
      return;
    }

    if (!force && key === loadedFor) return;

    if (key !== loadedFor) {
      attachments = [];
      renderLauncher();
      if (shell) closeShell();
    }

    const seq = ++requestSeq;
    issueKey = key;
    loadedFor = key;
    loadingAttachments = true;

    const res = await send({
      type: 'CSV_FETCH_ATTACHMENTS',
      baseUrl: jiraBaseUrl(),
      issueKey: key
    });

    if (seq !== requestSeq) return;
    loadingAttachments = false;

    let list = [];
    if (res.ok) {
      retryKey = null;
      retryCount = 0;
      const raw = (res.data && res.data.attachments) || [];
      list = raw.filter((a) => isCsv(a.filename)).map(mapAttachment);
    } else {
      // A few Jira setups restrict the REST endpoint. If the page already
      // shows attachment links, that is still enough to offer a preview.
      list = discoverFromDom();
      if (!list.length) scheduleRetry(key);
    }

    attachments = list.filter((a) => a.url);
    renderLauncher();
  }

  function scheduleRetry (key) {
    if (retryKey !== key) {
      retryKey = key;
      retryCount = 0;
    }
    if (retryCount >= 2) return;
    retryCount++;
    setTimeout(() => {
      if (currentIssueKey() !== key) return;
      loadedFor = null;
      loadAttachments();
    }, 2200);
  }

  function discoverFromDom () {
    const found = new Map();
    const links = document.querySelectorAll('a[href]');
    for (const link of links) {
      const href = link.href;
      if (!/^https?:/i.test(href) || !ATTACHMENT_HREF_RE.test(href)) continue;

      let name = '';
      for (const attribute of ['download', 'title', 'aria-label']) {
        const value = (link.getAttribute(attribute) || '').trim();
        if (isCsv(value)) { name = value; break; }
      }
      if (!isCsv(name)) {
        const text = (link.textContent || '').trim();
        if (isCsv(text)) name = text;
      }
      if (!isCsv(name)) {
        try {
          const segment = decodeURIComponent(new URL(href).pathname.split('/').pop() || '');
          if (isCsv(segment)) name = segment;
        } catch { /* ignore malformed URLs */ }
      }
      if (!isCsv(name)) {
        const container = link.closest('li, [data-testid*="attachment"], [class*="attachment"]') || link.parentElement;
        const match = container && (container.textContent || '').match(/[^\s/\\]+\.(?:csv|tsv)\b/i);
        if (match) name = match[0];
      }
      if (!isCsv(name) || found.has(href)) continue;

      found.set(href, { filename: name, url: href, size: null, mime: '', id: null });
    }
    return [...found.values()];
  }

  /* ---------------------------------------------------------------- theme */

  function detectTheme () {
    const html = document.documentElement;
    const body = document.body;
    const explicit =
      (html && html.getAttribute('data-color-mode')) ||
      (html && html.getAttribute('data-theme')) ||
      (body && body.getAttribute('data-color-mode')) ||
      (body && body.getAttribute('data-theme')) ||
      '';

    if (/dark/i.test(explicit)) return 'dark';
    if (/light/i.test(explicit)) return 'light';

    const parseColor = (value) => {
      const match = String(value || '').match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/i);
      if (!match) return null;
      const [r, g, b] = match.slice(1, 4).map(Number);
      const alpha = match[4] == null ? 1 : Number(match[4]);
      return { r, g, b, alpha };
    };

    const bodyColor = body && parseColor(getComputedStyle(body).backgroundColor);
    const htmlColor = html && parseColor(getComputedStyle(html).backgroundColor);
    const color = bodyColor && bodyColor.alpha > 0.2 ? bodyColor : htmlColor;

    if (color && color.alpha > 0.2) {
      const luminance = (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255;
      if (luminance < 0.42) return 'dark';
      if (luminance > 0.58) return 'light';
    }
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  /* ------------------------------------------------------------- launcher */

  let launcher = null;
  let menuOpen = false;
  let outsideClickBound = false;

  function ensureLauncher () {
    if (launcher) return launcher;
    launcher = document.createElement('div');
    launcher.className = 'jcp-launcher';
    launcher.dataset.theme = detectTheme();
    (document.body || document.documentElement).appendChild(launcher);

    if (!outsideClickBound) {
      outsideClickBound = true;
      document.addEventListener('click', (event) => {
        if (!launcher || !menuOpen) return;
        if (!launcher.contains(event.target)) closeMenu();
      }, true);
    }
    return launcher;
  }

  let themeTimer = 0;

  function updateTheme () {
    const theme = detectTheme();
    if (launcher) launcher.dataset.theme = theme;
    if (shell) shell.host.dataset.theme = theme;
  }

  /** The Markdown Preview extension uses the same bottom-right corner. Stack
      our pill above its launcher when both are present so neither one hides
      the other. */
  function syncLauncherOffset () {
    if (!launcher) return;
    const markdown = document.querySelector('.mdp-launcher');
    const visible = markdown &&
      markdown.getClientRects().length > 0 &&
      getComputedStyle(markdown).display !== 'none';
    launcher.classList.toggle('jcp-stacked', Boolean(visible));
  }

  function scheduleThemeUpdate () {
    clearTimeout(themeTimer);
    themeTimer = setTimeout(updateTheme, 120);
  }

  function closeMenu () {
    menuOpen = false;
    if (!launcher) return;
    const menu = launcher.querySelector('.jcp-menu');
    if (menu) menu.classList.add('jcp-hidden');
    if (pillButton) pillButton.setAttribute('aria-expanded', 'false');
  }

  let pillButton = null;

  function renderLauncher () {
    if (!attachments.length) {
      if (launcher) {
        launcher.remove();
        launcher = null;
        pillButton = null;
        menuOpen = false;
      }
      return;
    }

    const root = ensureLauncher();
    root.dataset.theme = detectTheme();
    root.innerHTML = '';
    menuOpen = false;
    syncLauncherOffset();

    const single = attachments.length === 1;
    const hasOnlyTsv = attachments.every((a) => /\.tsv$/i.test(a.filename));
    const hasOnlyCsv = attachments.every((a) => /\.csv$/i.test(a.filename));
    const kind = hasOnlyTsv ? 'TSV' : hasOnlyCsv ? 'CSV' : 'CSV/TSV';

    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'jcp-pill';
    pill.setAttribute('aria-haspopup', single ? 'false' : 'true');
    pill.setAttribute('aria-expanded', 'false');

    const badge = document.createElement('span');
    badge.className = 'jcp-badge';
    badge.textContent = hasOnlyTsv ? 'TSV' : 'CSV';

    const label = document.createElement('span');
    label.className = 'jcp-label';
    label.textContent = single
      ? attachments[0].filename
      : t('attachmentsCountMany', [String(attachments.length), kind]);

    pill.append(badge, label);

    if (!single) {
      const chevron = document.createElement('span');
      chevron.className = 'jcp-chevron';
      chevron.setAttribute('aria-hidden', 'true');
      chevron.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m4 6 4 4 4-4"/></svg>';
      pill.appendChild(chevron);
    }

    pill.title = single
      ? t('previewFile', [attachments[0].filename])
      : t('viewAttachments');
    root.appendChild(pill);
    pillButton = pill;

    if (single) {
      pill.addEventListener('click', () => previewAttachment(attachments[0]));
      return;
    }

    const menu = document.createElement('div');
    menu.className = 'jcp-menu jcp-hidden';
    menu.setAttribute('role', 'menu');

    const heading = document.createElement('div');
    heading.className = 'jcp-menu-heading';
    heading.textContent = t('attachmentsInIssue');
    menu.appendChild(heading);

    for (const att of attachments) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'jcp-menu-item';
      item.setAttribute('role', 'menuitem');

      const icon = document.createElement('span');
      icon.className = 'jcp-menu-icon';
      icon.textContent = /\.tsv$/i.test(att.filename) ? 'TSV' : 'CSV';

      const text = document.createElement('span');
      text.className = 'jcp-menu-text';

      const name = document.createElement('span');
      name.className = 'jcp-menu-name';
      name.textContent = att.filename;

      const meta = document.createElement('span');
      meta.className = 'jcp-menu-meta';
      meta.textContent = [formatSize(att.size), t('preview')].filter(Boolean).join(' · ');

      text.append(name, meta);
      item.append(icon, text);
      item.addEventListener('click', () => {
        closeMenu();
        previewAttachment(att);
      });
      menu.appendChild(item);
    }

    const footer = document.createElement('div');
    footer.className = 'jcp-menu-footer';
    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'jcp-refresh';
    refresh.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5V5H11"/></svg>';
    const refreshLabel = document.createElement('span');
    refreshLabel.textContent = t('refresh');
    refresh.appendChild(refreshLabel);
    refresh.addEventListener('click', async () => {
      refresh.classList.add('jcp-spinning');
      await loadAttachments(true);
      if (launcher) {
        menuOpen = true;
        const nextMenu = launcher.querySelector('.jcp-menu');
        if (nextMenu) nextMenu.classList.remove('jcp-hidden');
        const nextPill = launcher.querySelector('.jcp-pill');
        if (nextPill) nextPill.setAttribute('aria-expanded', 'true');
      }
    });
    footer.appendChild(refresh);
    menu.appendChild(footer);

    root.appendChild(menu);

    pill.addEventListener('click', (event) => {
      event.stopPropagation();
      menuOpen = !menuOpen;
      menu.classList.toggle('jcp-hidden', !menuOpen);
      pill.setAttribute('aria-expanded', String(menuOpen));
    });
  }

  /* ---------------------------------------------------------------- modal */

  let shell = null;
  let previewSeq = 0;

  function ensureShell () {
    if (shell) return shell;

    const host = document.createElement('div');
    host.id = 'jcp-modal-host';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .backdrop {
          position: fixed; inset: 0; z-index: 2147483646;
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
          background: rgba(2, 6, 23, .58);
          backdrop-filter: blur(2px);
          font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
          animation: jcp-fade .14s ease-out;
        }
        @keyframes jcp-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes jcp-spin { to { transform: rotate(360deg) } }
        .frame {
          position: relative;
          width: min(1400px, 100%);
          height: min(920px, 100%);
          overflow: hidden;
          border-radius: 14px;
          background: #fff;
          box-shadow: 0 30px 80px rgba(2, 6, 23, .48), 0 0 0 1px rgba(255, 255, 255, .08) inset;
        }
        :host([data-theme="dark"]) .frame { background: #0b1220; }
        iframe {
          display: block; width: 100%; height: 100%; border: 0;
          background: transparent;
        }
        .loading {
          position: absolute; inset: 0;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 14px; padding: 32px; text-align: center;
          color: #475569; background: #fff;
        }
        :host([data-theme="dark"]) .loading { color: #94a3b8; background: #0b1220; }
        .spinner {
          width: 26px; height: 26px; border-radius: 50%;
          border: 2.5px solid rgba(14, 116, 144, .22);
          border-top-color: #0e7490;
          animation: jcp-spin .8s linear infinite;
        }
        :host([data-theme="dark"]) .spinner {
          border-color: rgba(34, 211, 238, .2);
          border-top-color: #22d3ee;
        }
        .loading-text { max-width: 520px; overflow-wrap: anywhere; font-size: 13px; }
        .loading-cancel {
          all: unset; box-sizing: border-box; margin-top: 3px;
          padding: 7px 14px; border-radius: 6px; cursor: pointer;
          color: #475569; background: #f1f5f9;
          font-family: inherit; font-size: 12px; font-weight: 600; line-height: 1;
          box-shadow: 0 0 0 1px #dbe3ec inset;
        }
        :host([data-theme="dark"]) .loading-cancel {
          color: #cbd5e1; background: #162033; box-shadow: 0 0 0 1px #263449 inset;
        }
        .loading-cancel:hover { filter: brightness(.98); }
        .error {
          position: absolute; inset: 0;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 10px; padding: 40px; text-align: center;
          color: #334155; background: #fff;
        }
        :host([data-theme="dark"]) .error { color: #cbd5e1; background: #0b1220; }
        .error-icon {
          width: 42px; height: 42px; display: grid; place-items: center;
          border-radius: 50%; background: rgba(190, 18, 60, .1); color: #be123c;
          font-size: 22px; font-weight: 700;
        }
        :host([data-theme="dark"]) .error-icon { background: rgba(251, 113, 133, .12); color: #fb7185; }
        .error h3 { margin: 2px 0 0; font-size: 16px; font-weight: 650; }
        .error p {
          margin: 0; max-width: 520px; font-size: 13px; line-height: 1.6;
          color: #64748b;
        }
        :host([data-theme="dark"]) .error p { color: #94a3b8; }
        .actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 8px; }
        .actions button {
          all: unset; box-sizing: border-box;
          padding: 8px 15px; border-radius: 7px; cursor: pointer;
          font-family: inherit; font-size: 13px; font-weight: 600; line-height: 1.2;
          color: #fff; background: #0e7490;
        }
        .actions button.secondary {
          color: #334155; background: #f1f5f9;
          box-shadow: 0 0 0 1px #dbe3ec inset;
        }
        :host([data-theme="dark"]) .actions button.secondary {
          color: #e2e8f0; background: #162033; box-shadow: 0 0 0 1px #263449 inset;
        }
        .actions button:hover { filter: brightness(1.07); }
        .hidden { display: none !important; }
        @media (max-width: 680px) {
          .backdrop { padding: 0; }
          .frame { width: 100%; height: 100%; border-radius: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .backdrop { animation: none; }
        }
      </style>
      <div class="backdrop" part="backdrop">
        <div class="frame" role="dialog" aria-modal="true" aria-label="${t('csvPreview')}">
          <div class="loading">
            <span class="spinner" aria-hidden="true"></span>
            <span class="loading-text">${t('downloadingAttachment')}</span>
            <button type="button" class="loading-cancel">${t('cancel')}</button>
          </div>
          <div class="error hidden" role="alert"></div>
          <iframe class="hidden" title="${t('csvViewer')}" allow="clipboard-write; clipboard-read"></iframe>
        </div>
      </div>`;

    (document.body || document.documentElement).appendChild(host);

    const backdrop = root.querySelector('.backdrop');
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) closeShell();
    });

    shell = {
      host,
      root,
      backdrop,
      iframe: root.querySelector('iframe'),
      loading: root.querySelector('.loading'),
      loadingText: root.querySelector('.loading-text'),
      loadingCancel: root.querySelector('.loading-cancel'),
      error: root.querySelector('.error'),
      onMessage: null,
      readyTimer: null
    };

    shell.host.dataset.theme = detectTheme();
    shell.loadingCancel.addEventListener('click', closeShell);
    lockScroll(true);
    document.addEventListener('keydown', onKeyDown, true);
    return shell;
  }

  function setLoading (text) {
    const s = shell;
    if (!s) return;
    s.error.classList.add('hidden');
    s.iframe.classList.add('hidden');
    s.loading.classList.remove('hidden');
    s.loadingText.textContent = text;
  }

  function showError ({ title, detail, actions = [] }) {
    const s = shell;
    if (!s) return;
    s.loading.classList.add('hidden');
    s.iframe.classList.add('hidden');
    s.error.classList.remove('hidden');
    s.error.innerHTML = '';

    const icon = document.createElement('div');
    icon.className = 'error-icon';
    icon.textContent = '!';

    const heading = document.createElement('h3');
    heading.textContent = title;

    const paragraph = document.createElement('p');
    paragraph.textContent = detail;

    const row = document.createElement('div');
    row.className = 'actions';

    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      if (action.secondary) button.classList.add('secondary');
      button.addEventListener('click', action.onClick);
      row.appendChild(button);
    }

    s.error.append(icon, heading, paragraph, row);
  }

  function closeShell () {
    if (!shell) return;
    if (shell.readyTimer) clearTimeout(shell.readyTimer);
    if (shell.onMessage) window.removeEventListener('message', shell.onMessage);
    shell.host.remove();
    shell = null;
    lockScroll(false);
    document.removeEventListener('keydown', onKeyDown, true);
  }

  function lockScroll (locked) {
    const html = document.documentElement;
    const body = document.body;
    if (locked) {
      if (html) {
        html.dataset.jcpOverflow = html.style.overflow || '';
        html.style.overflow = 'hidden';
      }
      if (body) {
        body.dataset.jcpOverflow = body.style.overflow || '';
        body.style.overflow = 'hidden';
      }
    } else {
      if (html) {
        html.style.overflow = html.dataset.jcpOverflow || '';
        delete html.dataset.jcpOverflow;
      }
      if (body) {
        body.style.overflow = body.dataset.jcpOverflow || '';
        delete body.dataset.jcpOverflow;
      }
    }
  }

  function onKeyDown (event) {
    if (event.key !== 'Escape') return;
    if (menuOpen) {
      closeMenu();
      return;
    }
    if (shell) {
      event.preventDefault();
      event.stopPropagation();
      closeShell();
    }
  }

  function openViewer (doc) {
    const s = ensureShell();
    if (!s) return;
    if (s.readyTimer) clearTimeout(s.readyTimer);
    s.error.classList.add('hidden');
    s.loading.classList.remove('hidden');
    s.loadingText.textContent = t('openingViewer');
    s.iframe.classList.add('hidden');

    if (s.onMessage) window.removeEventListener('message', s.onMessage);
    s.onMessage = (event) => {
      if (!shell || event.source !== shell.iframe.contentWindow) return;
      const data = event.data || {};
      if (data.type === 'JCP_VIEWER_READY') {
        if (shell.readyTimer) {
          clearTimeout(shell.readyTimer);
          shell.readyTimer = null;
        }
        shell.iframe.contentWindow.postMessage({ type: 'JCP_RENDER', doc }, '*');
        shell.loading.classList.add('hidden');
        shell.iframe.classList.remove('hidden');
        shell.iframe.focus();
      } else if (data.type === 'JCP_VIEWER_RENDERED') {
        shell.loading.classList.add('hidden');
        shell.iframe.classList.remove('hidden');
      } else if (data.type === 'JCP_VIEWER_CLOSE') {
        closeShell();
      }
    };
    window.addEventListener('message', s.onMessage);

    s.readyTimer = setTimeout(() => {
      if (!shell || shell !== s) return;
      showError({
        title: t('viewerNotResponding'),
        detail: t('viewerTimeoutDetail'),
        actions: [
          { label: t('retry'), onClick: () => previewAttachment(doc.attachment) },
          { label: t('download'), secondary: true, onClick: () => window.open(doc.url, '_blank', 'noopener') },
          { label: t('close'), secondary: true, onClick: closeShell }
        ]
      });
    }, 15000);

    // Reload the viewer for every preview so a retry always gets a fresh
    // READY handshake, even when the iframe has been used before.
    s.iframe.src = chrome.runtime.getURL('viewer.html') + '?t=' + Date.now();
  }

  async function previewAttachment (att) {
    if (!att) return;
    closeMenu();
    const s = ensureShell();
    const seq = ++previewSeq;
    setLoading(t('downloadingFile', [att.filename]));

    const res = await send({ type: 'CSV_FETCH_BYTES', url: att.url });
    if (!shell || shell !== s || seq !== previewSeq) return; // superseded or closed

    if (!res.ok) {
      const actions = [];
      if (res.needsPermission) {
        actions.push({
          label: t('openSettings'),
          onClick: () => send({ type: 'CSV_OPEN_OPTIONS' })
        });
      }
      actions.push({
        label: t('downloadFile'),
        secondary: true,
        onClick: () => window.open(att.url, '_blank', 'noopener')
      });
      actions.push({ label: t('close'), secondary: true, onClick: closeShell });

      showError({
        title: res.code === 'TOO_LARGE' ? t('fileTooLarge') : t('couldNotLoadCsv'),
        detail: res.needsPermission
          ? t('permissionErrorDetail', [res.error])
          : res.error,
        actions
      });
      return;
    }

    openViewer({
      attachment: att,
      filename: att.filename,
      url: att.url,
      size: res.data.size || att.size || 0,
      bytesBase64: res.data.base64,
      jiraTheme: detectTheme()
    });
  }

  /* ------------------------------------------------------------- messages */

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === 'CSV_TOGGLE_PANEL') {
      if (shell) {
        closeShell();
      } else if (attachments.length === 1) {
        previewAttachment(attachments[0]);
      } else if (attachments.length > 1) {
        const pill = launcher && launcher.querySelector('.jcp-pill');
        if (pill) pill.click();
      }
      sendResponse({ ok: true });
    } else if (msg.type === 'CSV_LIST_ATTACHMENTS') {
      sendResponse({ ok: true, attachments, issueKey, loading: loadingAttachments });
    } else if (msg.type === 'CSV_PREVIEW_INDEX') {
      const att = attachments[msg.index];
      if (att) previewAttachment(att);
      sendResponse({ ok: Boolean(att) });
    } else if (msg.type === 'CSV_REFRESH') {
      loadAttachments(true).then(() => sendResponse({ ok: true }));
      return true;
    }
  });

  /* ----------------------------------------------------------------- boot */

  function boot () {
    loadAttachments();

    // Jira is a SPA: the issue can change without a page navigation. Some
    // board layouts open the issue in a panel while the URL stays the same,
    // so check both the URL and the key exposed by the DOM.
    let href = location.href;
    setInterval(() => {
      syncLauncherOffset();
      const key = currentIssueKey();
      const hrefChanged = location.href !== href;
      const keyChanged = key !== loadedFor;
      if (!hrefChanged && !keyChanged) return;
      href = location.href;
      loadAttachments();
      updateTheme();
    }, 700);

    window.addEventListener('popstate', () => {
      setTimeout(() => loadAttachments(), 60);
    });

    if (window.MutationObserver) {
      const observer = new MutationObserver(scheduleThemeUpdate);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'style', 'data-theme', 'data-color-mode']
      });
    }
    if (window.matchMedia) {
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', scheduleThemeUpdate);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
