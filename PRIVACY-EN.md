# Privacy Policy — CSV Preview for Jira

**CSV Preview for Jira does not collect, sell, share, or transmit personal data.**

## Data processed

The extension works only with data that is already in your browser and in your Jira instance:

- The key of the Jira issue you are viewing (for example, `ABC-123`), read from the URL or the page.
- The attachment list of that issue, obtained from your own Jira REST API.
- The content of the `.csv` or `.tsv` attachment you choose to preview, downloaded from your own Jira with your existing session.

All processing happens locally and is displayed in the viewer. No data is sent to the developer, because the extension has no servers.

## What is stored

Only preferences are stored in `chrome.storage.local` on your computer:

- theme (auto, light or dark);
- row density and text size;
- whether the first row is used as a header;
- additional Jira domains you add manually.

You can remove this data by uninstalling the extension.

## Network requests

The extension makes only these requests, always to your Jira instance:

1. `GET /rest/api/3/issue/{key}?fields=attachment` (or `/rest/api/2/...` on older installations) to read the attachment list.
2. The download of the attachment you click, following any redirect Jira returns (for example, to its media host).

No analytics, fonts, scripts, images or other resources are loaded from the Internet. Papa Parse is bundled inside the extension; no remote code is executed.

## Permissions

- **storage**: save the preferences listed above.
- **scripting**: enable the extension on custom Jira domains you add manually.
- **Atlassian host permissions**: read the attachment list and download the file you choose.
- **Optional `*://*/*`**: only if you enable it, for Jira installations that serve attachments from an external domain. You can revoke it in Settings at any time.

## Third parties

- [Papa Parse](https://www.papaparse.com/) (MIT) is bundled in `vendor/` to parse CSV. It is not a remote service.
- This extension is not affiliated with, endorsed by, or sponsored by Atlassian. Jira is a trademark of Atlassian Pty Ltd.

## Changes

If the extension's data handling changes, this policy will be updated before the new version is published.

Last updated: November 2026.
