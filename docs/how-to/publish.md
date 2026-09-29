# Prepare a release and update the Chrome Web Store

This guide updates the existing store item. Publishing a GitHub release does not
submit or update the Web Store listing.

## Release acceptance

The current source corrects reverse scrolling in the app-shell layout,
preserves rendered code and display math, and verifies the measured history
boundary instead of warning on every modern-layout export. A user-provided
installed export was compared with a fresh DOM walk: all 70 rendered message
bodies matched exactly. The generated ZIP passed its CRC check, and its separate
README and start prompt matched the corresponding ZIP members byte for byte.

That observation does not verify an installed copy of the final history-boundary
patch. Before store submission, install the exact upload package and repeat the
checks below. Library citations without download URLs still require manual
retrieval and keep file-saving exports partial. Do not advertise a complete
attachment backup or universal ChatGPT-layout coverage.

1. Compare the version in the [store listing](https://chromewebstore.google.com/detail/conversation-to-markdown/jhnhkmnignbhmcjbhoihdbjhjfljpili), the publisher dashboard (including pending submissions), and `manifest.json`. Use a version greater than the preceding store package.
2. Keep `manifest.json`, `package.json`, `CHANGELOG.md`, and `FEATURES.md` consistent. One release gets one version bump; local verification builds are not evidence of a store release.
3. Review the [feature checklist](../../FEATURES.md) against the live site. Test a long conversation, uploaded files, generated files, clipboard mode, and the batch modes being advertised. Check actual file bytes and links, not only download acceptance or unit tests.
4. Run `npm test` and `npm run check`. Stage any new files before testing because the public-surface gate reads tracked files. Review every skipped test.
5. Commit the reviewed changes and record the exact release revision. Use the repository's normal review and merge process before making a stable release.

## Build the upload package

From a clean checkout of the intended committed revision:

```sh
npm test
npm run check
bash package-extension.sh HEAD
```

The script requires Git, Node.js, Bash, tar, shasum, and either zip or 7z. It
packages the **committed tree**, ignoring uncommitted changes. Output is in
`dist/`: `conversation-to-markdown-vVERSION.zip` and its `.sha256` file.
Use the version actually printed by the script, not a copied filename from an
older release.

Extract that ZIP and load the extracted folder using the [installation guide](install.md).
Verify that `manifest.json` is at the ZIP root and has the intended version.
The runtime package contains only the manifest, three JavaScript files,
`popup.html`, and the icons. Upload this runtime package, not GitHub's source ZIP,
an export ZIP, or a ZIP containing an extra outer folder.

On macOS, verify a downloaded release asset from its containing directory:

```sh
shasum -a 256 -c conversation-to-markdown-vVERSION.zip.sha256
```

Replace `VERSION` with the release version. Attach the ZIP and checksum to the
GitHub release for the same commit. Include verified behavior, known limitations,
and test results in the release notes. This package is for the standard ZIP
upload flow; if the store item already uses Verified CRX Uploads, follow the
[official signing instructions](https://developer.chrome.com/docs/webstore/update#protect-your-package-updates)
using the existing signing key instead.

## Check the exact package in Chrome

1. Extract the upload ZIP into its own folder. Disable any other installed copy
   temporarily so the tested toolbar action is unambiguous.
2. Load or reload that folder using the [installation guide](install.md), verify
   the displayed version, and reload the ChatGPT conversation tab.
3. Export a short conversation and a longer app-shell conversation. Keep the
   popup open until completion. Check the first and last messages, both roles,
   code fences, display math, tables, and actual saved file contents.
4. On a conversation whose history boundary is confirmed and whose files are
   supported, check that no history-start warning appears. On one with a
   preview-only Library citation, check that the cited filename and missing-file
   warning remain visible. Retrieve it manually as described in the README.
5. Test clipboard mode and any batch/ZIP mode you intend to advertise. Check
   that clipboard mode makes no attachment requests and that a partial export
   is retried rather than recorded as complete.
6. Record the package checksum and results. A successful source test or a DOM
   replay is not a substitute for testing this installed package.

## Submit the existing store item

Open the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
with the publisher account that owns **Conversation to Markdown**. Select item
`jhnhkmnignbhmcjbhoihdbjhjfljpili`; do not create a second item for an update.

1. Under **Package**, choose **Upload New Package** and upload the reviewed runtime ZIP. Confirm its version.
2. Review **Store listing**: English description, screenshots, support links, and honest attachment limitations.
3. Review **Privacy practices** against [PRIVACY.md](../../PRIVACY.md) and the actual manifest. Explain local processing, session-authenticated file requests, downloads, and local metadata/error storage. Remove obsolete claims that the extension stores no state or never reads a session token. Ensure the privacy-policy URL points to the published policy for this release.
4. Check **Distribution** and keep the intended audience.
5. Select **Submit for Review**. Choose deferred publication if you want to control the launch after approval.
6. After approval, publish if deferred. Verify the public listing version and test a store-installed copy separately from an unpacked copy.

### Listing and reviewer notes

Keep the listing's feature claims within the tested scope. Suggested update text:

> Exports ChatGPT conversations as Markdown with headings, lists, tables, code,
> math, and user/assistant roles. Saves supported generated files and uploads
> locally. Handles the measured app-shell scroll layout and reports unverified
> history or unavailable files. Preview-only Library documents require a manual
> download. No developer server or analytics is used.

For reviewer test instructions, describe opening an existing ChatGPT
conversation, pressing the toolbar action, keeping the popup open, and checking
the Markdown and local file links. A signed-in ChatGPT session is required; do
not put account passwords, session tokens, or private conversation links in the
reviewer notes. State the known Library limitation and report only package
checks you actually completed.

The privacy-policy URL can point to this repository's public
[PRIVACY.md](https://github.com/Arcanada-one/conversation-to-markdown/blob/main/PRIVACY.md).
Support can point to the public
[issue tracker](https://github.com/Arcanada-one/conversation-to-markdown/issues).

### Complete the permission justifications

The dashboard's **Privacy practices** tab may be called **Privacy** in a
translated interface. Its permission-justification fields are separate from the
store description. Complete every field shown for the uploaded package before
submitting the update. In particular, use this justification for `storage`:

> The storage permission keeps an export metadata index and the latest error in
> chrome.storage.local. The index supports resuming batch exports and finding
> conversations updated since their last export. The error record supports
> troubleshooting. Conversation text, attachment contents, and authentication
> tokens are not stored. This data stays on the user's device and is not synced
> or sent to the developer.

The other declared permissions have distinct purposes: `scripting` runs the
exporter in the ChatGPT tab, `clipboardWrite` copies Markdown when clipboard
mode is selected, and `downloads` saves exported files and checks export
download history for batch resume. The declared ChatGPT and file-service hosts
are used to read conversations and retrieve supported attachments with the
user's existing session. State the single purpose as exporting ChatGPT
conversations and supported attachments to local Markdown files or the
clipboard. Use this release's [privacy policy](../../PRIVACY.md) as the policy
URL, and disclose locally processed user data too; Google's
[privacy-fields guide](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
explains the dashboard fields.

Dashboard labels can change. Google's [update guide](https://developer.chrome.com/docs/webstore/update)
is the reference for upload, review, and publication. Review submission alone
does not update existing users; the approved update must be published.

Return to the [README](../../README.md).
