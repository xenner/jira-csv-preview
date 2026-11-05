/* CSV viewer. Runs inside an extension iframe over the Jira issue. It receives
   the attachment bytes from the content script and renders a virtualized,
   sortable, searchable table. No network requests and no remote code. */

(() => {
  'use strict';
  if (window.__jcpViewer) return;
  window.__jcpViewer = true;

  const $ = (id) => document.getElementById(id);

  const PREFS_DEFAULTS = {
    theme: 'auto',
    density: 'comfortable',
    fontSize: 13,
    firstRowHeader: true
  };

  const DELIMITER_KEYS = {
    ',': 'delimiterComma',
    ';': 'delimiterSemicolon',
    '\t': 'delimiterTab',
    '|': 'delimiterPipe'
  };

  const ENCODING_LABELS = {
    'utf-8': 'UTF-8',
    'windows-1252': 'Windows-1252',
    'iso-8859-1': 'ISO-8859-1',
    'utf-16le': 'UTF-16 LE',
    'utf-16be': 'UTF-16 BE'
  };

  const I18n = window.JCPI18n;
  const i18nReady = I18n ? I18n.ready : Promise.resolve();
  const t = (key, substitutions) => (I18n ? I18n.t(key, substitutions) : key);

  const MAX_COPY_ROWS = 50000;

  const state = {
    doc: null,
    demo: false,
    bytes: null,
    filename: 'adjunto.csv',
    sourceUrl: '',
    fileSize: 0,
    rawRows: [],
    rows: [],
    columns: [],
    visibleColumns: [],
    view: [],
    header: true,
    delimiterPref: 'auto',
    encodingPref: 'auto',
    detectedDelimiter: ',',
    detectedEncoding: 'utf-8',
    sortCol: null,
    sortDir: 0,
    search: '',
    searchLower: '',
    searchIndex: null,
    selected: null,
    dialogCell: null,
    rowHeight: 32,
    headerHeight: 34,
    cellFont: 13,
    tableWidth: 0,
    autoFill: true,
    parseToken: 0,
    renderedSent: false,
    colEls: new Map(),
    effectiveTheme: 'light'
  };

  let prefs = { ...PREFS_DEFAULTS };
  let searchTimer = 0;
  let toastTimer = 0;
  let bodyRaf = 0;
  let resizeDrag = null;

  const el = {
    app: $('app'),
    fileIcon: $('file-icon'),
    fileName: $('file-name'),
    fileSize: $('file-size'),
    fileStats: $('file-stats'),
    themeBtn: $('theme-btn'),
    themeIconMoon: $('theme-icon-moon'),
    themeIconSun: $('theme-icon-sun'),
    downloadBtn: $('download-btn'),
    closeBtn: $('close-btn'),
    search: $('search'),
    searchClear: $('search-clear'),
    delimiter: $('delimiter'),
    encoding: $('encoding'),
    headerBtn: $('header-btn'),
    columnsBtn: $('columns-btn'),
    columnsCount: $('columns-count'),
    moreBtn: $('more-btn'),
    notice: $('notice'),
    noticeText: $('notice-text'),
    noticeClose: $('notice-close'),
    loadingState: $('loading-state'),
    loadingTitle: $('loading-title'),
    loadingDetail: $('loading-detail'),
    fatalState: $('fatal-state'),
    fatalTitle: $('fatal-title'),
    fatalDetail: $('fatal-detail'),
    retryBtn: $('retry-btn'),
    emptyState: $('empty-state'),
    emptyDetail: $('empty-detail'),
    gridWrap: $('grid-wrap'),
    grid: $('grid'),
    colgroup: $('colgroup'),
    thead: $('thead'),
    tbody: $('tbody'),
    statusLeft: $('status-left'),
    selectionInfo: $('selection-info'),
    copyCell: $('copy-cell'),
    copyKbd: $('copy-kbd'),
    columnsPopover: $('columns-popover'),
    columnsAll: $('columns-all'),
    columnsFilter: $('columns-filter'),
    columnsList: $('columns-list'),
    morePopover: $('more-popover'),
    copyView: $('copy-view'),
    exportView: $('export-view'),
    resetWidths: $('reset-widths'),
    cellDialog: $('cell-dialog'),
    cellBackdrop: $('cell-backdrop'),
    cellTitle: $('cell-title'),
    cellValue: $('cell-value'),
    cellChars: $('cell-chars'),
    cellClose: $('cell-close'),
    cellCopy: $('cell-copy'),
    toast: $('toast')
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const formatInt = (n) => (I18n ? I18n.formatInt(n) : new Intl.NumberFormat('en').format(Number(n) || 0));
  const formatBytes = (bytes) => (I18n ? I18n.formatBytes(bytes) : String(bytes));

  function countText (count, unit) {
    const one = unit === 'row' ? 'rowOne' : unit === 'column' ? 'columnOne' : 'characterOne';
    const many = unit === 'row' ? 'rowMany' : unit === 'column' ? 'columnMany' : 'characterMany';
    return t(count === 1 ? one : many, [formatInt(count)]);
  }

  function normalize (value) {
    return String(value == null ? '' : value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function delimiterLabel (delimiter) {
    if (DELIMITER_KEYS[delimiter]) return t(DELIMITER_KEYS[delimiter]);
    return delimiter ? `«${delimiter}»` : t('auto');
  }

  function delimiterChar (value) {
    return value === 'tab' ? '\t' : value;
  }

  function encodingLabel (encoding) {
    return ENCODING_LABELS[encoding] || encoding || t('auto');
  }

  function displayValue (value) {
    return String(value == null ? '' : value)
      .replace(/\r\n?|\n/g, ' ↵ ')
      .replace(/\t/g, ' ');
  }

  function isEditable (target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  /* ------------------------------------------------------------- preferences */

  async function loadPrefs () {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    try {
      const stored = await chrome.storage.local.get(PREFS_DEFAULTS);
      prefs = { ...PREFS_DEFAULTS, ...stored };
    } catch { /* defaults are fine */ }
  }

  function savePrefs (patch) {
    Object.assign(prefs, patch);
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    try {
      chrome.storage.local.set(patch);
    } catch { /* ignore */ }
  }

  function effectiveTheme () {
    if (prefs.theme === 'light' || prefs.theme === 'dark') return prefs.theme;
    if (state.doc && state.doc.jiraTheme) return state.doc.jiraTheme;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme () {
    const theme = effectiveTheme();
    state.effectiveTheme = theme;
    document.documentElement.dataset.theme = theme;
    const dark = theme === 'dark';
    el.themeIconMoon.classList.toggle('is-hidden', dark);
    el.themeIconSun.classList.toggle('is-hidden', !dark);
    el.themeBtn.title = dark ? t('switchToLight') : t('switchToDark');
    el.themeBtn.setAttribute('aria-label', el.themeBtn.title);
  }

  function applyTypography () {
    const compact = prefs.density === 'compact';
    const font = clamp(Number(prefs.fontSize) || 13, 11, 18);
    const row = compact ? Math.max(26, font + 13) : Math.max(30, font + 19);
    const header = compact ? 30 : 34;
    state.cellFont = font;
    state.rowHeight = row;
    state.headerHeight = header;
    document.documentElement.style.setProperty('--row-h', row + 'px');
    document.documentElement.style.setProperty('--header-h', header + 'px');
    document.documentElement.style.setProperty('--cell-font', font + 'px');
    if (state.rows.length && !el.gridWrap.classList.contains('is-hidden')) {
      renderBody();
    }
  }

  function updateHeaderButton () {
    el.headerBtn.classList.toggle('is-on', state.header);
    el.headerBtn.setAttribute('aria-pressed', String(state.header));
    el.headerBtn.title = state.header ? t('headerOnTitle') : t('headerOffTitle');
  }

  /* ---------------------------------------------------------------- messaging */

  function postToParent (message) {
    if (window.parent !== window) {
      window.parent.postMessage(message, '*');
    }
  }

  function notifyReady () {
    postToParent({ type: 'JCP_VIEWER_READY' });
  }

  function notifyRendered () {
    if (state.renderedSent) return;
    state.renderedSent = true;
    if (state.view.length && el.cellDialog.hidden) {
      el.gridWrap.focus({ preventScroll: true });
    }
    postToParent({ type: 'JCP_VIEWER_RENDERED' });
  }

  function closeViewer () {
    if (window.parent !== window) {
      postToParent({ type: 'JCP_VIEWER_CLOSE' });
      return;
    }
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.getCurrent) {
      chrome.tabs.getCurrent((tab) => {
        if (tab && tab.id != null) chrome.tabs.remove(tab.id);
        else window.close();
      });
    } else {
      window.close();
    }
  }

  function onMessage (event) {
    if (event.source !== window.parent && event.source !== window) return;
    const data = event.data || {};
    if (data.type !== 'JCP_RENDER' || !data.doc) return;
    try {
      state.demo = false;
      loadDocument(data.doc);
    } catch (err) {
      showFatal(t('couldNotPrepareFile'), String((err && err.message) || err));
      notifyRendered();
    }
  }

  /* ------------------------------------------------------------------ document */

  function base64ToBytes (base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function bytesToBase64 (bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  async function loadDemo () {
    state.demo = true;
    try {
      const response = await fetch('demo/sample.csv', { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const buffer = await response.arrayBuffer();
      if (!buffer.byteLength) throw new Error('Empty demo file');
      loadDocument({
        filename: 'demo-clientes.csv',
        url: '',
        size: buffer.byteLength,
        bytesBase64: bytesToBase64(new Uint8Array(buffer)),
        jiraTheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      });
    } catch (err) {
      showFatal(t('demoLoadError'), String((err && err.message) || err));
      notifyRendered();
    }
  }

  function decodeBytes (bytes, pref) {
    if (!bytes || !bytes.length) throw new Error(t('fileEmptyError'));

    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' };
    }
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
    }
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
    }

    if (pref === 'auto') {
      try {
        return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
      } catch {
        return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
      }
    }

    try {
      return { text: new TextDecoder(pref).decode(bytes), encoding: pref };
    } catch {
      throw new Error(t('encodingUnsupported', [pref]));
    }
  }

  function parseText (text, delimiterPref) {
    let working = text;
    let delimiterHint = null;

    // Excel writes "sep=;" in front of some semicolon-separated exports.
    const sepHint = working.match(/^sep=(.)\r?\n/i);
    if (sepHint) {
      delimiterHint = sepHint[1];
      working = working.slice(sepHint[0].length);
    }

    const fallback = /\.tsv$/i.test(state.filename) ? '\t' : ',';
    const manual = delimiterPref === 'auto' ? null : delimiterChar(delimiterPref);
    const delimiter = manual || delimiterHint || '';

    const parsed = window.Papa.parse(working, {
      delimiter,
      header: false,
      skipEmptyLines: 'greedy',
      newline: '',
      quoteChar: '"',
      escapeChar: '"',
      dynamicTyping: false,
      worker: false
    });

    const rows = (parsed.data || [])
      .filter((row) => Array.isArray(row))
      .map((row) => row.map((value) => (value == null ? '' : String(value))));

    const errors = parsed.errors || [];
    const undetectable = errors.some((error) => error.code === 'UndetectableDelimiter');
    const missingQuotes = errors.filter((error) => error.code === 'MissingQuotes').length;

    let detected = manual || parsed.meta.delimiter || delimiterHint || fallback;
    if (!detected) detected = fallback;

    const warnings = [];
    if (!manual && undetectable) {
      warnings.push(t('delimiterNotDetected', [delimiterLabel(detected)]));
    }
    if (missingQuotes) {
      warnings.push(t(missingQuotes === 1 ? 'missingQuotesOne' : 'missingQuotesMany', [formatInt(missingQuotes)]));
    }

    return { rows, delimiter: detected, warnings };
  }

  function loadDocument (doc) {
    if (!doc || typeof doc.bytesBase64 !== 'string') {
      throw new Error(t('invalidContent'));
    }

    state.doc = doc;
    state.filename = String(doc.filename || 'attachment.csv');
    state.sourceUrl = doc.url || '';
    state.bytes = base64ToBytes(doc.bytesBase64);
    state.fileSize = Number(doc.size) || state.bytes.length;
    state.renderedSent = false;
    state.parseToken++;
    state.delimiterPref = 'auto';
    state.encodingPref = 'auto';
    state.sortCol = null;
    state.sortDir = 0;
    state.search = '';
    state.searchLower = '';
    state.searchIndex = null;
    state.selected = null;
    state.dialogCell = null;
    state.autoFill = true;
    state.header = prefs.firstRowHeader !== false;

    el.delimiter.value = 'auto';
    el.encoding.value = 'auto';
    el.search.value = '';
    el.searchClear.classList.add('is-hidden');
    el.columnsFilter.value = '';
    el.fileName.textContent = state.filename;
    el.fileName.title = state.filename;
    el.fileSize.textContent = formatBytes(state.fileSize);
    el.fileIcon.textContent = /\.tsv$/i.test(state.filename) ? 'TSV' : 'CSV';
    el.fileStats.textContent = t('analyzingFile');
    document.title = `${state.filename} · ${t('csvPreview')}`;

    if (/^https?:\/\//i.test(state.sourceUrl)) {
      el.downloadBtn.href = state.sourceUrl;
      el.downloadBtn.classList.remove('is-hidden');
    } else {
      el.downloadBtn.classList.add('is-hidden');
      el.downloadBtn.removeAttribute('href');
    }

    updateHeaderButton();
    applyTheme();
    applyTypography();
    closeCellDialog();
    closePopovers();
    hideNotice();

    parseAndRender();
  }

  async function parseAndRender () {
    const token = ++state.parseToken;
    showLoading(t('analyzingCsv'), t('analyzingDetail'));
    el.fileStats.textContent = t('analyzingFile');

    // Give the loading state a chance to paint before the synchronous parse.
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (token !== state.parseToken) return;

    try {
      if (!window.Papa) throw new Error(t('analyzerLoadError'));
      const decoded = decodeBytes(state.bytes, state.encodingPref);
      const text = decoded.text.replace(/^\uFEFF/, '');
      if (!text.trim()) throw new Error(t('fileEmptyError'));

      const parsed = parseText(text, state.delimiterPref);
      if (!parsed.rows.length) throw new Error(t('noRowsFound'));

      state.detectedEncoding = decoded.encoding;
      state.detectedDelimiter = parsed.delimiter;
      state.rawRows = parsed.rows;

      el.delimiter.options[0].textContent = t('autoWithValue', [delimiterLabel(state.detectedDelimiter)]);
      el.encoding.options[0].textContent = t('autoWithValue', [encodingLabel(state.detectedEncoding)]);

      rebuildData();
      renderAll({ resetScroll: true });
      const notices = parsed.warnings.slice();
      if (state.demo) notices.unshift(t('demoNotice'));
      setNotice(notices.join(' '));
      notifyRendered();
    } catch (err) {
      if (token !== state.parseToken) return;
      showFatal(t('couldNotReadCsv'), String((err && err.message) || err));
      el.fileStats.textContent = t('fileReadErrorShort');
      notifyRendered();
    }
  }

  function rebuildData () {
    state.rows = state.header ? state.rawRows.slice(1) : state.rawRows;
    state.columns = buildColumns();
    state.visibleColumns = state.columns.filter((column) => !column.hidden);
    state.searchIndex = null;

    if (!state.visibleColumns.length && state.columns.length) {
      state.visibleColumns = [state.columns[0]];
      state.columns[0].hidden = false;
    }
    if (state.selected) {
      const colExists = state.columns.some((column) => column.index === state.selected.col);
      if (!colExists) state.selected = null;
    }
    buildView();
  }

  function buildColumns () {
    const count = state.rawRows.reduce((max, row) => Math.max(max, row.length), 0);
    if (!count) return [];

    const sourceHeader = state.header ? state.rawRows[0] : null;
    const seen = new Map();
    const columns = [];

    for (let index = 0; index < count; index++) {
      const raw = sourceHeader ? String(sourceHeader[index] == null ? '' : sourceHeader[index]) : '';
      let name = raw.replace(/\s+/g, ' ').trim() || `Columna ${index + 1}`;
      const key = name.toLocaleLowerCase('es');
      const seenCount = seen.get(key) || 0;
      seen.set(key, seenCount + 1);
      if (seenCount) name = `${name} (${seenCount + 1})`;

      columns.push({
        index,
        name,
        width: 120,
        hidden: false,
        numeric: detectNumeric(index)
      });
    }

    computeWidths(columns);
    return columns;
  }

  function detectNumeric (columnIndex) {
    let checked = 0;
    let numeric = 0;
    const limit = Math.min(state.rows.length, 240);
    for (let i = 0; i < limit; i++) {
      const value = state.rows[i][columnIndex];
      if (value == null || String(value).trim() === '') continue;
      checked++;
      if (Number.isFinite(parseNumber(value))) numeric++;
      if (checked >= 120) break;
    }
    return checked >= 2 && numeric / checked >= 0.85;
  }

  function parseNumber (value) {
    let text = String(value == null ? '' : value).trim().replace(/\u00a0/g, '').replace(/\s/g, '');
    if (!text) return NaN;

    const direct = Number(text);
    if (Number.isFinite(direct)) return direct;

    if (state.detectedDelimiter !== ',') {
      if (/^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) {
        return Number(text.replace(/\./g, '').replace(',', '.'));
      }
      if (/^[+-]?\d+,\d+$/.test(text)) return Number(text.replace(',', '.'));
    }
    if (state.detectedDelimiter !== '.' && /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) {
      return Number(text.replace(/,/g, ''));
    }
    return NaN;
  }

  function computeWidths (columns) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      for (const column of columns) column.width = 160;
      return;
    }
    ctx.font = `${state.cellFont}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
    const sampleLimit = columns.length > 120 ? 40 : 160;
    const sample = state.rows.slice(0, sampleLimit);

    for (const column of columns) {
      let maxWidth = ctx.measureText(column.name).width + 26;
      for (const row of sample) {
        const value = displayValue(row[column.index]);
        if (!value) continue;
        const width = ctx.measureText(value.length > 80 ? value.slice(0, 80) : value).width + 24;
        if (width > maxWidth) maxWidth = width;
      }
      column.width = Math.round(clamp(maxWidth, column.numeric ? 90 : 70, 420));
    }
  }

  function buildView () {
    const total = state.rows.length;
    const indexes = new Array(total);
    for (let i = 0; i < total; i++) indexes[i] = i;

    let filtered = indexes;
    const query = normalize(state.search).trim();
    state.searchLower = query;

    if (query) {
      const searchIndex = getSearchIndex();
      filtered = indexes.filter((index) => searchIndex[index].includes(query));
    }

    if (state.sortCol != null && state.sortDir) {
      const column = state.columns.find((col) => col.index === state.sortCol);
      if (column) {
        filtered.sort((a, b) => compareRows(a, b, column) * state.sortDir);
      }
    }

    state.view = filtered;

    if (state.selected) {
      if (!filtered.includes(state.selected.orig)) state.selected = null;
      else {
        const selectedColumn = state.visibleColumns.some((column) => column.index === state.selected.col);
        if (!selectedColumn) state.selected = null;
      }
    }
  }

  function getSearchIndex () {
    if (state.searchIndex) return state.searchIndex;
    const index = new Array(state.rows.length);
    for (let i = 0; i < state.rows.length; i++) {
      index[i] = normalize(state.rows[i].join(' \u0001 '));
    }
    state.searchIndex = index;
    return index;
  }

  function compareRows (a, b, column) {
    const left = state.rows[a][column.index] == null ? '' : String(state.rows[a][column.index]);
    const right = state.rows[b][column.index] == null ? '' : String(state.rows[b][column.index]);
    const leftEmpty = left.trim() === '';
    const rightEmpty = right.trim() === '';

    if (leftEmpty || rightEmpty) {
      if (leftEmpty && rightEmpty) return a - b;
      return leftEmpty ? 1 : -1;
    }

    if (column.numeric) {
      const leftNumber = parseNumber(left);
      const rightNumber = parseNumber(right);
      if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
        return leftNumber === rightNumber ? a - b : leftNumber - rightNumber;
      }
    }

    const compared = left.localeCompare(right, 'es', { numeric: true, sensitivity: 'base' });
    return compared === 0 ? a - b : compared;
  }

  /* -------------------------------------------------------------- rendering */

  function renderAll ({ resetScroll = false } = {}) {
    if (resetScroll) el.gridWrap.scrollTop = 0;

    if (!state.rows.length) {
      showEmpty(state.header ? t('emptyHeaderOnly') : t('emptyNoRows'));
      updateStatus();
      updateFileStats();
      updateColumnsCount();
      updateSelectionUI();
      return;
    }

    if (!state.view.length) {
      showEmpty(state.search ? t('emptyNoMatches', [state.search]) : t('emptyNothing'));
      updateStatus();
      updateFileStats();
      updateColumnsCount();
      updateSelectionUI();
      return;
    }

    showGrid();
    renderColgroup();
    renderHeader();
    renderBody();
    updateStatus();
    updateFileStats();
    updateColumnsCount();
    updateSelectionUI();
  }

  function showGrid () {
    el.loadingState.classList.add('is-hidden');
    el.fatalState.classList.add('is-hidden');
    el.emptyState.classList.add('is-hidden');
    el.gridWrap.classList.remove('is-hidden');
  }

  function showLoading (title, detail) {
    hideNotice();
    el.loadingTitle.textContent = title || t('preparingCsv');
    el.loadingDetail.textContent = detail || '';
    el.loadingState.classList.remove('is-hidden');
    el.fatalState.classList.add('is-hidden');
    el.emptyState.classList.add('is-hidden');
    el.gridWrap.classList.add('is-hidden');
  }

  function showEmpty (detail) {
    el.loadingState.classList.add('is-hidden');
    el.fatalState.classList.add('is-hidden');
    el.emptyState.classList.remove('is-hidden');
    el.emptyDetail.textContent = detail;
    el.gridWrap.classList.add('is-hidden');
  }

  function showFatal (title, detail) {
    hideNotice();
    el.loadingState.classList.add('is-hidden');
    el.emptyState.classList.add('is-hidden');
    el.fatalState.classList.remove('is-hidden');
    el.fatalTitle.textContent = title;
    el.fatalDetail.textContent = detail;
    el.gridWrap.classList.add('is-hidden');
    updateStatus();
    updateSelectionUI();
  }

  function renderColgroup () {
    el.colgroup.replaceChildren();
    state.colEls = new Map();

    const rowCol = document.createElement('col');
    rowCol.style.width = '52px';
    el.colgroup.appendChild(rowCol);

    if (state.autoFill && state.visibleColumns.length) {
      const available = el.gridWrap.clientWidth;
      const current = 52 + state.visibleColumns.reduce((sum, column) => sum + column.width, 0);
      if (available > current + 2) {
        state.visibleColumns[state.visibleColumns.length - 1].width += available - current - 1;
      }
      state.autoFill = false;
    }

    let total = 52;
    for (const column of state.visibleColumns) {
      const col = document.createElement('col');
      col.style.width = column.width + 'px';
      el.colgroup.appendChild(col);
      state.colEls.set(column.index, col);
      total += column.width;
    }

    state.tableWidth = total;
    el.grid.style.width = total + 'px';
  }

  function renderHeader () {
    el.thead.replaceChildren();
    const row = document.createElement('tr');

    const corner = document.createElement('th');
    corner.className = 'rownum';
    corner.setAttribute('scope', 'col');
    corner.title = t('rowNumber');
    corner.textContent = '#';
    row.appendChild(corner);

    for (const column of state.visibleColumns) {
      const th = document.createElement('th');
      th.setAttribute('scope', 'col');
      th.dataset.col = String(column.index);
      th.tabIndex = 0;
      th.title = column.name;
      if (column.numeric) th.classList.add('is-numeric');

      const active = state.sortCol === column.index && state.sortDir !== 0;
      if (active) {
        th.classList.add('is-sorted');
        th.setAttribute('aria-sort', state.sortDir > 0 ? 'ascending' : 'descending');
      } else {
        th.setAttribute('aria-sort', 'none');
      }

      const inner = document.createElement('span');
      inner.className = 'th-inner';

      const label = document.createElement('span');
      label.className = 'th-label';
      label.textContent = column.name;
      inner.appendChild(label);

      if (active) {
        const indicator = document.createElement('span');
        indicator.className = 'sort-ind';
        indicator.textContent = state.sortDir > 0 ? '▲' : '▼';
        inner.appendChild(indicator);
      }

      const resizer = document.createElement('span');
      resizer.className = 'resizer';
      resizer.title = t('resizerTitle');
      resizer.addEventListener('pointerdown', (event) => startResize(event, column, resizer));
      resizer.addEventListener('click', (event) => event.stopPropagation());
      resizer.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        autoWidthColumn(column);
      });

      th.appendChild(inner);
      th.appendChild(resizer);

      th.addEventListener('click', () => cycleSort(column));
      th.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          cycleSort(column);
        }
      });

      row.appendChild(th);
    }

    el.thead.appendChild(row);
  }

  function renderBody () {
    if (el.gridWrap.classList.contains('is-hidden')) return;

    const total = state.view.length;
    const rowHeight = state.rowHeight;
    const scrollTop = el.gridWrap.scrollTop;
    const viewport = el.gridWrap.clientHeight;
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 8);
    const end = Math.min(total, Math.ceil((scrollTop + viewport) / rowHeight) + 8);

    const fragment = document.createDocumentFragment();
    const columns = state.visibleColumns;

    if (start > 0) fragment.appendChild(spacerRow(start * rowHeight, columns.length + 1));

    for (let position = start; position < end; position++) {
      const orig = state.view[position];
      const source = state.rows[orig] || [];
      const tr = document.createElement('tr');
      if (position % 2) tr.classList.add('alt');
      tr.dataset.row = String(orig);

      const rowNumber = document.createElement('th');
      rowNumber.className = 'rownum';
      rowNumber.setAttribute('scope', 'row');
      rowNumber.textContent = String(orig + 1);
      rowNumber.title = t('rowLabel', [formatInt(orig + 1)]);
      tr.appendChild(rowNumber);

      for (const column of columns) {
        const td = document.createElement('td');
        const raw = source[column.index] == null ? '' : String(source[column.index]);
        td.dataset.row = String(orig);
        td.dataset.col = String(column.index);
        if (column.numeric) td.classList.add('is-numeric');

        if (!raw) {
          td.classList.add('is-empty');
        } else {
          const url = raw.trim();
          if (/^https?:\/\/[^\s]+$/i.test(url)) {
            const link = document.createElement('a');
            link.href = url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            appendHighlighted(link, url, state.search);
            link.addEventListener('click', (event) => event.stopPropagation());
            td.appendChild(link);
          } else {
            appendHighlighted(td, raw, state.search);
          }
        }

        if (state.selected && state.selected.orig === orig && state.selected.col === column.index) {
          td.classList.add('is-selected');
        }
        tr.appendChild(td);
      }
      fragment.appendChild(tr);
    }

    if (end < total) fragment.appendChild(spacerRow((total - end) * rowHeight, columns.length + 1));
    el.tbody.replaceChildren(fragment);
  }

  function spacerRow (height, colspan) {
    const tr = document.createElement('tr');
    tr.className = 'spacer';
    const td = document.createElement('td');
    td.colSpan = colspan;
    td.style.height = Math.max(0, height) + 'px';
    tr.appendChild(td);
    return tr;
  }

  function appendHighlighted (container, value, query) {
    const text = displayValue(value);
    const trimmed = String(query || '').trim();
    if (!trimmed) {
      container.textContent = text;
      return;
    }

    const needle = normalize(trimmed).replace(/\s+/g, ' ');
    if (!needle) {
      container.textContent = text;
      return;
    }

    const folded = foldWithMap(text);
    let from = 0;
    let found = folded.text.indexOf(needle, from);
    if (found === -1) {
      container.textContent = text;
      return;
    }

    let cursor = 0;
    while (found !== -1) {
      const start = folded.map[found];
      const end = folded.map[found + needle.length - 1] + 1;
      if (start > cursor) container.appendChild(document.createTextNode(text.slice(cursor, start)));
      const mark = document.createElement('mark');
      mark.textContent = text.slice(start, end);
      container.appendChild(mark);
      cursor = end;
      from = found + needle.length;
      found = folded.text.indexOf(needle, from);
    }
    if (cursor < text.length) container.appendChild(document.createTextNode(text.slice(cursor)));
  }

  /** Fold accents and case while keeping a map back to the original offsets. */
  function foldWithMap (text) {
    let folded = '';
    const map = [];
    for (let index = 0; index < text.length; index++) {
      const piece = text[index]
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
      for (let part = 0; part < piece.length; part++) {
        folded += piece[part];
        map.push(index);
      }
    }
    return { text: folded, map };
  }

  function updateFileStats () {
    if (!state.rows) return;
    const delimiter = delimiterLabel(state.detectedDelimiter);
    const encoding = encodingLabel(state.detectedEncoding);
    el.fileStats.textContent = `${countText(state.rows.length, 'row')} · ${countText(state.columns.length, 'column')} · ${delimiter} · ${encoding}`;
  }

  function updateStatus () {
    const shown = state.view.length;
    const total = state.rows.length;
    const visible = state.visibleColumns.length;
    const columns = state.columns.length;

    let text = shown === total
      ? countText(total, 'row')
      : `${formatInt(shown)} / ${countText(total, 'row')}`;
    text += visible === columns
      ? ` · ${countText(columns, 'column')}`
      : ` · ${formatInt(visible)} / ${countText(columns, 'column')}`;

    if (state.sortCol != null && state.sortDir) {
      const column = state.columns.find((col) => col.index === state.sortCol);
      if (column) text += ` · ${t('sortedBy', [column.name, state.sortDir > 0 ? '↑' : '↓'])}`;
    }

    el.statusLeft.textContent = text;
    el.copyCell.disabled = !state.selected;
  }

  function updateColumnsCount () {
    const visible = state.visibleColumns.length;
    const total = state.columns.length;
    el.columnsCount.textContent = String(visible);
    el.columnsCount.title = t('columnsVisible', [formatInt(visible), countText(total, 'column')]);
    el.columnsBtn.title = t('columnsButtonTitle', [formatInt(visible), countText(total, 'column')]);
  }

  function updateSelectionUI () {
    for (const cell of el.tbody.querySelectorAll('td.is-selected')) {
      cell.classList.remove('is-selected');
    }

    if (!state.selected) {
      el.selectionInfo.textContent = '';
      el.selectionInfo.removeAttribute('title');
      el.copyCell.disabled = true;
      return;
    }

    const { orig, col } = state.selected;
    const column = state.columns.find((item) => item.index === col);
    const value = state.rows[orig] && state.rows[orig][col] != null ? String(state.rows[orig][col]) : '';
    const preview = value.replace(/\s+/g, ' ').slice(0, 80);

    el.selectionInfo.textContent = t('selectedCell', [t('rowLabel', [formatInt(orig + 1)]), column ? column.name : t('columnFallback'), preview || t('cellEmpty')]);
    el.selectionInfo.title = value.length > 80 ? value : '';
    el.copyCell.disabled = false;

    for (const cell of el.tbody.querySelectorAll('td[data-col]')) {
      if (Number(cell.dataset.row) === orig && Number(cell.dataset.col) === col) {
        cell.classList.add('is-selected');
        break;
      }
    }
  }

  /* --------------------------------------------------------------- interaction */

  function selectCell (orig, col, { scroll = false } = {}) {
    state.selected = { orig, col };
    if (scroll) ensureVisible(orig, col);
    updateSelectionUI();
  }

  function ensureVisible (orig, col) {
    const position = state.view.indexOf(orig);
    if (position === -1) return;

    const rowTop = state.headerHeight + position * state.rowHeight;
    const viewTop = el.gridWrap.scrollTop;
    const viewBottom = viewTop + el.gridWrap.clientHeight;

    if (rowTop < viewTop + state.headerHeight) {
      el.gridWrap.scrollTop = Math.max(0, rowTop - state.headerHeight - 2);
    } else if (rowTop + state.rowHeight > viewBottom) {
      el.gridWrap.scrollTop = rowTop + state.rowHeight - el.gridWrap.clientHeight + 2;
    }

    let left = 52;
    for (const column of state.visibleColumns) {
      if (column.index === col) break;
      left += column.width;
    }
    const column = state.visibleColumns.find((item) => item.index === col);
    if (!column) return;
    const right = left + column.width;
    const viewLeft = el.gridWrap.scrollLeft + 52;
    const viewRight = el.gridWrap.scrollLeft + el.gridWrap.clientWidth;

    if (left < viewLeft) {
      el.gridWrap.scrollLeft = Math.max(0, left - 52);
    } else if (right > viewRight) {
      el.gridWrap.scrollLeft = right - el.gridWrap.clientWidth + 2;
    }

    renderBody();
  }

  function moveSelection (rowDelta, colDelta) {
    if (!state.visibleColumns.length || !state.view.length) return;

    if (!state.selected) {
      selectCell(state.view[0], state.visibleColumns[0].index, { scroll: true });
      return;
    }

    let rowPosition = state.view.indexOf(state.selected.orig);
    let colPosition = state.selected
      ? state.visibleColumns.findIndex((column) => column.index === state.selected.col)
      : 0;

    if (rowPosition < 0) rowPosition = 0;
    if (colPosition < 0) colPosition = 0;

    rowPosition = clamp(rowPosition + rowDelta, 0, state.view.length - 1);
    colPosition = clamp(colPosition + colDelta, 0, state.visibleColumns.length - 1);

    const orig = state.view[rowPosition];
    const col = state.visibleColumns[colPosition].index;
    selectCell(orig, col, { scroll: true });
  }

  function jumpSelection (toEnd) {
    if (!state.visibleColumns.length || !state.view.length) return;
    const orig = toEnd ? state.view[state.view.length - 1] : state.view[0];
    const col = toEnd ? state.visibleColumns[state.visibleColumns.length - 1].index : state.visibleColumns[0].index;
    selectCell(orig, col, { scroll: true });
  }

  function cycleSort (column) {
    if (state.sortCol !== column.index) {
      state.sortCol = column.index;
      state.sortDir = 1;
    } else if (state.sortDir === 1) {
      state.sortDir = -1;
    } else {
      state.sortCol = null;
      state.sortDir = 0;
    }
    el.gridWrap.scrollTop = 0;
    buildView();
    renderAll();
  }

  function startResize (event, column, resizer) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const headerCell = resizer.closest('th');
    const startX = event.clientX;
    const startWidth = headerCell ? headerCell.getBoundingClientRect().width : column.width;
    state.autoFill = false;
    resizeDrag = { column, startX, startWidth };
    document.body.classList.add('is-resizing');

    const onMove = (moveEvent) => {
      if (!resizeDrag) return;
      const width = Math.round(clamp(startWidth + moveEvent.clientX - startX, 60, 900));
      resizeDrag.column.width = width;
      const colElement = state.colEls.get(column.index);
      if (colElement) colElement.style.width = width + 'px';
      state.tableWidth = 52 + state.visibleColumns.reduce((sum, item) => sum + item.width, 0);
      el.grid.style.width = state.tableWidth + 'px';
    };

    const onUp = () => {
      resizeDrag = null;
      document.body.classList.remove('is-resizing');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function autoWidthColumn (column) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.font = `${state.cellFont}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;

    let maxWidth = ctx.measureText(column.name).width + 26;
    const sample = state.rows.slice(0, 200);
    for (const row of sample) {
      const value = displayValue(row[column.index]);
      if (!value) continue;
      const width = ctx.measureText(value.length > 80 ? value.slice(0, 80) : value).width + 24;
      if (width > maxWidth) maxWidth = width;
    }

    column.width = Math.round(clamp(maxWidth, column.numeric ? 90 : 70, 900));
    const colElement = state.colEls.get(column.index);
    if (colElement) colElement.style.width = column.width + 'px';
    state.tableWidth = 52 + state.visibleColumns.reduce((sum, item) => sum + item.width, 0);
    el.grid.style.width = state.tableWidth + 'px';
  }

  function resetWidths () {
    computeWidths(state.columns);
    state.autoFill = true;
    renderAll();
    showToast(t('widthsReset'));
  }

  /* ------------------------------------------------------------------ search */

  function onSearchInput () {
    state.search = el.search.value;
    el.searchClear.classList.toggle('is-hidden', !state.search);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      buildView();
      el.gridWrap.scrollTop = 0;
      renderAll();
    }, 110);
  }

  function clearSearch () {
    state.search = '';
    el.search.value = '';
    el.searchClear.classList.add('is-hidden');
    buildView();
    el.gridWrap.scrollTop = 0;
    renderAll();
  }

  /* --------------------------------------------------------------- popovers */

  function openPopover (popover, button) {
    const isOpen = !popover.hidden;
    closePopovers();
    if (isOpen) return;

    if (popover === el.columnsPopover) buildColumnsList(el.columnsFilter.value);
    popover.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    positionPopover(popover, button);
  }

  function positionPopover (popover, button) {
    const rect = button.getBoundingClientRect();
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    let left = rect.right - width;
    left = clamp(left, 10, window.innerWidth - width - 10);
    let top = rect.bottom + 6;
    if (top + height > window.innerHeight - 10) top = Math.max(10, rect.top - height - 6);
    popover.style.left = left + 'px';
    popover.style.top = top + 'px';
  }

  function closePopovers () {
    el.columnsPopover.hidden = true;
    el.morePopover.hidden = true;
    el.columnsBtn.setAttribute('aria-expanded', 'false');
    el.moreBtn.setAttribute('aria-expanded', 'false');
  }

  function buildColumnsList (filter) {
    el.columnsList.replaceChildren();
    const query = normalize(filter).trim();

    for (const column of state.columns) {
      if (query && !normalize(column.name).includes(query)) continue;

      const label = document.createElement('label');
      label.className = 'column-option';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !column.hidden;

      const index = document.createElement('span');
      index.className = 'column-index';
      index.textContent = String(column.index + 1);

      const name = document.createElement('span');
      name.textContent = column.name;
      name.title = column.name;

      checkbox.addEventListener('change', () => {
        if (!checkbox.checked && state.visibleColumns.length === 1 && !column.hidden) {
          checkbox.checked = true;
          showToast(t('lastColumnVisible'));
          return;
        }
        column.hidden = !checkbox.checked;
        state.visibleColumns = state.columns.filter((item) => !item.hidden);
        if (state.selected && column.hidden && state.selected.col === column.index) {
          state.selected = null;
        }
        if (column.hidden && state.sortCol === column.index) {
          state.sortCol = null;
          state.sortDir = 0;
        }
        state.autoFill = false;
        buildView();
        renderAll();
        updateSelectionUI();
      });

      label.append(checkbox, index, name);
      el.columnsList.appendChild(label);
    }
  }

  /* -------------------------------------------------------------------- cell */

  function openCellDialog (orig, col) {
    const column = state.columns.find((item) => item.index === col);
    const value = state.rows[orig] && state.rows[orig][col] != null ? String(state.rows[orig][col]) : '';

    state.dialogCell = { orig, col };
    el.cellTitle.textContent = t('cellTitle', [t('rowLabel', [formatInt(orig + 1)]), column ? column.name : t('columnFallback')]);
    el.cellValue.textContent = value || t('cellEmpty');
    el.cellChars.textContent = countText(value.length, 'character');
    el.cellDialog.hidden = false;
    el.cellCopy.focus();
  }

  function closeCellDialog () {
    if (el.cellDialog.hidden) return;
    el.cellDialog.hidden = true;
    state.dialogCell = null;
    if (!el.gridWrap.classList.contains('is-hidden')) el.gridWrap.focus({ preventScroll: true });
  }

  function copySelectedCell () {
    if (!state.selected) {
      showToast(t('selectCellFirst'));
      return;
    }
    const { orig, col } = state.selected;
    const value = state.rows[orig] && state.rows[orig][col] != null ? String(state.rows[orig][col]) : '';
    copyText(value, value ? t('cellCopied') : t('emptyCellCopied'));
  }

  async function copyText (text, successMessage) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(successMessage || t('copied'));
    } catch {
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
        showToast(successMessage || t('copied'));
      } catch {
        showToast(t('clipboardError'));
      }
    }
  }

  function copyViewAsTsv () {
    if (!state.view.length) {
      showToast(t('noRowsToCopy'));
      return;
    }
    const columns = state.visibleColumns;
    const rows = state.view.slice(0, MAX_COPY_ROWS);
    const lines = [];
    if (state.header) lines.push(columns.map((column) => cleanTsv(column.name)).join('\t'));
    for (const orig of rows) {
      lines.push(columns.map((column) => cleanTsv(state.rows[orig][column.index])).join('\t'));
    }
    copyText(lines.join('\n'), state.view.length > MAX_COPY_ROWS
      ? t('copiedRows', [formatInt(MAX_COPY_ROWS), formatInt(state.view.length)])
      : t('copiedViewTsv'));
    closePopovers();
  }

  function cleanTsv (value) {
    return String(value == null ? '' : value).replace(/[\t\r\n]+/g, ' ');
  }

  function exportView () {
    if (!state.view.length && !state.columns.length) {
      showToast(t('noDataExport'));
      return;
    }
    const columns = state.visibleColumns;
    const data = state.view.map((orig) => columns.map((column) => state.rows[orig][column.index] == null ? '' : String(state.rows[orig][column.index])));
    const payload = state.header ? { fields: columns.map((column) => column.name), data } : data;

    let csv = '';
    try {
      csv = window.Papa.unparse(payload, { delimiter: ',', newline: '\r\n' });
    } catch (err) {
      showToast(t('exportFailed'));
      return;
    }

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const base = state.filename.replace(/\.(csv|tsv)$/i, '') || 'view';
    const safe = base.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safe}${t('exportSuffix')}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showToast(t('viewExported'));
    closePopovers();
  }

  /* ------------------------------------------------------------------- notice */

  function setNotice (message) {
    if (!message) {
      hideNotice();
      return;
    }
    el.noticeText.textContent = message;
    el.notice.classList.remove('is-hidden');
    el.notice.hidden = false;
  }

  function hideNotice () {
    el.notice.hidden = true;
    el.notice.classList.add('is-hidden');
  }

  function showToast (message) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 1900);
  }

  /* ------------------------------------------------------------------ events */

  function bindEvents () {
    el.themeBtn.addEventListener('click', () => {
      prefs.theme = state.effectiveTheme === 'dark' ? 'light' : 'dark';
      savePrefs({ theme: prefs.theme });
      applyTheme();
    });

    el.closeBtn.addEventListener('click', closeViewer);
    el.retryBtn.addEventListener('click', () => parseAndRender());

    el.search.addEventListener('input', onSearchInput);
    el.searchClear.addEventListener('click', () => {
      clearSearch();
      el.search.focus();
    });

    el.delimiter.addEventListener('change', () => {
      state.delimiterPref = el.delimiter.value;
      reparse();
    });

    el.encoding.addEventListener('change', () => {
      state.encodingPref = el.encoding.value;
      reparse();
    });

    el.headerBtn.addEventListener('click', () => {
      state.header = !state.header;
      savePrefs({ firstRowHeader: state.header });
      updateHeaderButton();
      state.selected = null;
      state.sortCol = null;
      state.sortDir = 0;
      state.searchIndex = null;
      state.autoFill = true;
      rebuildData();
      renderAll({ resetScroll: true });
    });

    el.columnsBtn.addEventListener('click', () => openPopover(el.columnsPopover, el.columnsBtn));
    el.moreBtn.addEventListener('click', () => openPopover(el.morePopover, el.moreBtn));

    el.columnsAll.addEventListener('click', () => {
      for (const column of state.columns) column.hidden = false;
      state.visibleColumns = state.columns.slice();
      state.autoFill = false;
      buildView();
      renderAll();
      buildColumnsList(el.columnsFilter.value);
    });

    el.columnsFilter.addEventListener('input', () => buildColumnsList(el.columnsFilter.value));
    el.copyView.addEventListener('click', copyViewAsTsv);
    el.exportView.addEventListener('click', exportView);
    el.resetWidths.addEventListener('click', () => {
      resetWidths();
      closePopovers();
    });
    el.noticeClose.addEventListener('click', hideNotice);

    el.gridWrap.addEventListener('scroll', () => {
      if (bodyRaf) return;
      bodyRaf = requestAnimationFrame(() => {
        bodyRaf = 0;
        renderBody();
      });
    }, { passive: true });

    el.gridWrap.addEventListener('click', (event) => {
      const cell = event.target.closest('td[data-col]');
      if (!cell || !el.gridWrap.contains(cell)) return;
      el.gridWrap.focus({ preventScroll: true });
      selectCell(Number(cell.dataset.row), Number(cell.dataset.col));
    });

    el.gridWrap.addEventListener('dblclick', (event) => {
      if (event.target.closest('a')) return;
      const cell = event.target.closest('td[data-col]');
      if (!cell) return;
      event.preventDefault();
      openCellDialog(Number(cell.dataset.row), Number(cell.dataset.col));
    });

    el.gridWrap.addEventListener('keydown', (event) => {
      if (isEditable(event.target)) return;
      if (event.target.closest('a') && (event.key === 'Enter' || event.key === ' ')) return;
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          moveSelection(1, 0);
          break;
        case 'ArrowUp':
          event.preventDefault();
          moveSelection(-1, 0);
          break;
        case 'ArrowLeft':
          event.preventDefault();
          moveSelection(0, -1);
          break;
        case 'ArrowRight':
          event.preventDefault();
          moveSelection(0, 1);
          break;
        case 'PageDown': {
          event.preventDefault();
          const step = Math.max(1, Math.floor(el.gridWrap.clientHeight / state.rowHeight) - 2);
          moveSelection(step, 0);
          break;
        }
        case 'PageUp': {
          event.preventDefault();
          const step = Math.max(1, Math.floor(el.gridWrap.clientHeight / state.rowHeight) - 2);
          moveSelection(-step, 0);
          break;
        }
        case 'Home':
          event.preventDefault();
          if (event.ctrlKey || event.metaKey) jumpSelection(false);
          else moveSelection(0, -state.visibleColumns.length);
          break;
        case 'End':
          event.preventDefault();
          if (event.ctrlKey || event.metaKey) jumpSelection(true);
          else moveSelection(0, state.visibleColumns.length);
          break;
        case 'Enter':
          if (state.selected) {
            event.preventDefault();
            openCellDialog(state.selected.orig, state.selected.col);
          }
          break;
        default:
          break;
      }
    });

    el.cellClose.addEventListener('click', closeCellDialog);
    el.cellBackdrop.addEventListener('click', closeCellDialog);
    el.cellCopy.addEventListener('click', () => {
      if (!state.dialogCell) return;
      const { orig, col } = state.dialogCell;
      const value = state.rows[orig] && state.rows[orig][col] != null ? String(state.rows[orig][col]) : '';
      copyText(value, value ? t('valueCopied') : t('emptyValueCopied'));
    });
    el.cellDialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const focusable = [el.cellClose, el.cellCopy];
      const current = focusable.indexOf(document.activeElement);
      if (current === -1) return;
      event.preventDefault();
      const next = event.shiftKey
        ? focusable[(current - 1 + focusable.length) % focusable.length]
        : focusable[(current + 1) % focusable.length];
      next.focus();
    });

    el.copyCell.addEventListener('click', copySelectedCell);

    document.addEventListener('click', (event) => {
      if (!el.columnsPopover.hidden &&
          !el.columnsPopover.contains(event.target) &&
          !el.columnsBtn.contains(event.target)) {
        closePopovers();
      }
      if (!el.morePopover.hidden &&
          !el.morePopover.contains(event.target) &&
          !el.moreBtn.contains(event.target)) {
        closePopovers();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Tab' && el.cellDialog.hidden) {
        const focusable = [...document.querySelectorAll('button:not([disabled]), [href], input, select, [tabindex="0"]')]
          .filter((element) => element.getClientRects().length > 0);
        if (focusable.length) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
            return;
          }
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
            return;
          }
        }
      }

      if (event.key === 'Escape') {
        if (!el.cellDialog.hidden) {
          event.preventDefault();
          event.stopPropagation();
          closeCellDialog();
          return;
        }
        if (!el.columnsPopover.hidden || !el.morePopover.hidden) {
          event.preventDefault();
          closePopovers();
          return;
        }
        if (el.search.value) {
          event.preventDefault();
          clearSearch();
          el.search.focus();
          return;
        }
        if (state.selected) {
          state.selected = null;
          updateSelectionUI();
        }
        event.preventDefault();
        event.stopPropagation();
        closeViewer();
        return;
      }

      if (event.key === '/' && !isEditable(event.target)) {
        event.preventDefault();
        el.search.focus();
        el.search.select();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        if (!el.cellDialog.hidden) return;
        event.preventDefault();
        el.search.focus();
        el.search.select();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
        if (!el.cellDialog.hidden) {
          // Let the browser copy a text selection inside the dialog when there is one.
          const selection = window.getSelection();
          if (selection && String(selection).length) return;
          event.preventDefault();
          if (state.dialogCell) {
            const { orig, col } = state.dialogCell;
            const value = state.rows[orig] && state.rows[orig][col] != null ? String(state.rows[orig][col]) : '';
            copyText(value, value ? t('valueCopied') : t('emptyValueCopied'));
          }
          return;
        }
        if (!isEditable(event.target) && state.selected) {
          event.preventDefault();
          copySelectedCell();
        }
      }
    });

    window.addEventListener('resize', closePopovers);

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes.theme) {
          prefs.theme = changes.theme.newValue || 'auto';
          applyTheme();
        }
        if (changes.density) {
          prefs.density = changes.density.newValue || 'comfortable';
          applyTypography();
        }
        if (changes.fontSize) {
          prefs.fontSize = Number(changes.fontSize.newValue) || 13;
          applyTypography();
        }
        if (changes.firstRowHeader && state.doc) {
          const value = changes.firstRowHeader.newValue !== false;
          if (value !== state.header) {
            state.header = value;
            updateHeaderButton();
            state.selected = null;
            state.sortCol = null;
            state.sortDir = 0;
            state.searchIndex = null;
            state.autoFill = true;
            rebuildData();
            renderAll({ resetScroll: true });
          }
        }
      });
    }

    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (prefs.theme === 'auto') applyTheme();
    });
  }

  function reparse () {
    state.search = '';
    state.searchLower = '';
    state.searchIndex = null;
    state.selected = null;
    state.sortCol = null;
    state.sortDir = 0;
    state.autoFill = true;
    el.search.value = '';
    el.searchClear.classList.add('is-hidden');
    parseAndRender();
  }

  /* -------------------------------------------------------------------- boot */

  function setMacLabels () {
    if (/mac/i.test(navigator.platform || '')) {
      el.copyKbd.textContent = '⌘ C';
    }
  }

  async function boot () {
    setMacLabels();
    bindEvents();
    await Promise.all([loadPrefs(), i18nReady]);
    applyTheme();
    applyTypography();
    updateHeaderButton();

    window.addEventListener('message', onMessage);

    if (new URLSearchParams(location.search).get('demo') === '1') {
      await loadDemo();
    } else {
      notifyReady();
      if (window.parent === window) {
        setTimeout(() => {
          if (!state.doc) {
            showFatal(t('openFromJiraTitle'), t('openFromJiraDetail'));
          }
        }, 1600);
      }
    }
  }

  boot();
})();
