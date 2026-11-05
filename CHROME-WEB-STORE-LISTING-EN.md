# Chrome Web Store listing — English

## Store listing

**Name:** CSV Preview for Jira

**Summary (max. 132 characters):**

```text
Preview CSV and TSV attachments on a Jira issue in a fast table viewer, without downloading them.
```

**Category:** Productivity (or Developer Tools)

**Language:** English

**Detailed description:**

```text
Open a Jira issue and click the CSV button in the bottom-right corner. The attachment opens in a table over the issue, with search, sorting, column controls, copy and export.

Built for CSVs attached to tickets: data exports, customer lists, query results and shared spreadsheets. Instead of downloading the file and opening it elsewhere, review it where it already is.

FEATURES

- Detects the current Jira issue and its .csv/.tsv attachments.
- Virtualized table that handles large files smoothly.
- Search across all cells, accent-insensitive (mexico finds México).
- Column sorting with numeric-aware ordering.
- Resizable and hideable columns, with an optional first row as header.
- Automatic delimiter and encoding detection, with manual overrides.
- Copy individual cells or the full view as TSV.
- Export the filtered and sorted view as CSV.
- Light and dark themes that follow Jira.
- Works with Jira Cloud, Data Center and custom domains.
- Keyboard shortcut: Ctrl+Shift+Y.
- Maximum attachment size: 20 MB.
- Includes a bundled demo with sample data for testing without a Jira account.

LANGUAGES

English (default), Spanish (Argentina) and Portuguese (Brazil). The interface follows the Chrome UI language.

PRIVACY

No data is collected, sold or shared. The extension only reads the attachment list of the issue you are viewing and downloads the file you choose to preview, using your existing Jira session. All parsing happens locally in your browser. There are no analytics, accounts, telemetry or external servers.

The extension only runs on Jira domains. No code runs on any other site.

Not affiliated with, endorsed by, or sponsored by Atlassian. Jira is a trademark of Atlassian Pty Ltd.
```

**Screenshots:**

- `screenshots/viewer-light.png`
- `screenshots/viewer-dark.png`
- `screenshots/search-accent.png`
- `screenshots/launcher-menu.png`

## Privacy practices

**Single purpose:**

```text
Preview CSV and TSV attachments on Jira issues in a table viewer.
```

**Host permissions justification:**

```text
The extension reads the attachment list of the Jira issue the user is viewing and downloads only the CSV/TSV file the user chooses to preview. These requests go to the user's own Jira site using the existing session. The atlassian.com host also covers the media host that Jira Cloud redirects downloads to.
```

**`scripting` justification:**

```text
Used only to register the content script on custom Jira domains explicitly added by the user in Settings, for Jira Data Center or self-hosted instances. No code is injected into other sites.
```

**`storage` justification:**

```text
Stores local preferences such as theme, row density, font size, header preference and the list of custom Jira domains. No personal data is transmitted.
```

**Optional `*://*/*` justification:**

```text
Only requested when the user enables "Allow downloads from any domain" in Settings. It is used solely to download the attachment the user selected when a Jira instance serves it from an external host such as S3 or a CDN. It is off by default and can be revoked at any time.
```

**Remote code:**

```text
No. All JavaScript, including the bundled CSV parser (Papa Parse), is packaged with the extension. No code is fetched or evaluated at runtime.
```

**Data usage:**

```text
No user data is collected, sold or shared. The current Jira issue key, attachment list and selected attachment are processed locally in the browser and are never sent to the developer. There are no analytics, telemetry, accounts or external servers.
```

If the privacy questionnaire asks for data categories, the honest option is **Website content**, used only locally to display the selected attachment and never transmitted.

**Privacy policy URL:** https://xenner.github.io/jira-csv-preview/privacy.html

## Test instructions

```text
The Jira test account may require an email verification code that reviewers cannot receive.

To test the viewer without a Jira account:
1. Click the extension icon.
2. Choose "Open demo".
3. Click "Preview CSV" on the simulated issue.
4. Test search, sorting, column visibility, theme and CSV export.

The demo uses bundled sample data. No Jira credentials are required.
```

The bundled demo is the primary review path. If a Jira test account without OTP is available, its credentials can be added after the demo instructions.
