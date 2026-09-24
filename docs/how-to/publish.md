# Prepare a release and update the Chrome Web Store

This guide updates the existing store item. Publishing a GitHub release does not
submit or update the Web Store listing.

## Release acceptance

The uploaded-document resolver has passed a live byte comparison. The remaining
HTML warning was traced to a failed tool command that never wrote its intended
output; 1.6.6 corrects that source classification. Do not advertise universal
attachment coverage: unsupported assets, redundant button warnings, and lookup
timeouts remain possible. Complete the live checklist for the advertised scope
before store submission and disclose accepted limitations in the listing.

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

Dashboard labels can change. Google's [update guide](https://developer.chrome.com/docs/webstore/update)
is the reference for upload, review, and publication. Review submission alone
does not update existing users; the approved update must be published.

Return to the [README](../../README.md).
