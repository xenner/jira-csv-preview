const $ = (id) => document.getElementById(id);

const I18n = window.JCPI18n;
const i18nReady = I18n ? I18n.ready : Promise.resolve();
const t = (key, substitutions) => (I18n ? I18n.t(key, substitutions) : key);

function formatSize (bytes) {
  if (bytes == null || Number.isNaN(Number(bytes))) return '';
  return I18n ? I18n.formatBytes(bytes) : '';
}

async function init () {
  await i18nReady;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return;

  let attachments = [];
  let issueKey = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    let res = null;
    try {
      res = await chrome.tabs.sendMessage(tab.id, { type: 'CSV_LIST_ATTACHMENTS' });
    } catch {
      break; // Not a Jira tab, or the content script is not available yet.
    }
    attachments = (res && res.attachments) || [];
    issueKey = res && res.issueKey;
    if (attachments.length || !(res && res.loading)) break;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  if (!attachments.length) return;

  $('empty').hidden = true;
  $('found').hidden = false;

  if (issueKey) {
    $('issue-key').textContent = issueKey;
  } else {
    $('issue-key').textContent = t('currentIssueAttachments');
  }

  const allCsv = attachments.every((att) => /\.csv$/i.test(att.filename || ''));
  const formatLabel = allCsv ? 'CSV' : 'CSV/TSV';
  $('found-label').textContent = attachments.length === 1
    ? t('popupAttachmentsOne', [formatLabel])
    : t('popupAttachmentsMany', [I18n ? I18n.formatInt(attachments.length) : String(attachments.length), formatLabel]);

  attachments.forEach((attachment, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'item';

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = /\.tsv$/i.test(attachment.filename) ? 'TSV' : 'CSV';

    const text = document.createElement('span');
    text.className = 'item-text';

    const name = document.createElement('span');
    name.className = 'item-name';
    name.textContent = attachment.filename;
    name.title = attachment.filename;

    const meta = document.createElement('span');
    meta.className = 'item-meta';
    meta.textContent = [formatSize(attachment.size), t('openPreview')].filter(Boolean).join(' · ');

    text.append(name, meta);
    button.append(badge, text);

    button.addEventListener('click', async () => {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'CSV_PREVIEW_INDEX', index });
      } finally {
        window.close();
      }
    });

    $('found-list').appendChild(button);
  });
}

$('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

$('open-demo').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('demo.html') });
  window.close();
});

init();
