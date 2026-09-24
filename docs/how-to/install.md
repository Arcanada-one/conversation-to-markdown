# Install and update in Chrome

Use desktop Chrome. Unpacked installation requires Developer mode; a managed
browser may prohibit it. Node.js, npm, and a build step are not required to run
this extension.

## Choose the files

For the published store build, use the [Chrome Web Store listing](https://chromewebstore.google.com/detail/conversation-to-markdown/jhnhkmnignbhmcjbhoihdbjhjfljpili).
Chrome manages updates to that installation.

For a particular repository release, open [GitHub Releases](https://github.com/Arcanada-one/conversation-to-markdown/releases)
and download its `conversation-to-markdown-vVERSION.zip` asset if provided.
Extract it into a permanent folder. The versioned runtime ZIP is different from
GitHub's automatically generated **Source code (zip)** archive.

To use the latest source, open the [repository](https://github.com/Arcanada-one/conversation-to-markdown),
choose **Code → Download ZIP**, and extract it. Alternatively:

```sh
git clone https://github.com/Arcanada-one/conversation-to-markdown.git
cd conversation-to-markdown
```

Source ZIPs contain an outer repository folder. Select the inner folder that
actually contains `manifest.json`, `content.js`, `popup.html`, `popup.js`,
`zip.js`, and `icons/`. Do not select the ZIP itself or the `icons/` folder.
Source on a development branch may be newer than the latest tested release.

## Load the extension

1. Type `chrome://extensions/` into Chrome's address bar.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the extracted folder containing `manifest.json`.
4. Find **Conversation to Markdown** and check the displayed version against that folder's `manifest.json`.
5. Open Chrome's Extensions toolbar menu and pin **Conversation to Markdown**.
6. Reload an already-open ChatGPT tab before testing. Wait for messages to appear, then open the extension popup.

Keep the extracted folder in place: Chrome loads the extension from that folder.
Do not delete it after installation. If a store copy is also installed, disable
one copy while testing so that you know which toolbar action you are using.

These steps follow Chrome's [unpacked extension instructions](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world).

## Update an unpacked copy

1. Obtain the intended release or source revision. With an unmodified clone on the desired branch, run `git pull --ff-only`; if it refuses because of local changes, resolve them without discarding work.
2. Replace the files in the existing extension folder, or remove the old unpacked installation and load the new folder. Removing an installation clears its local export index, so updating in place is preferable.
3. In `chrome://extensions/`, click the **Reload** icon on the unpacked extension's card. The page's **Update** button is not a substitute for reloading a local checkout.
4. Verify the version displayed on the card. Documentation-only changes may retain the same version; for source builds also record `git rev-parse HEAD`.
5. Reload the ChatGPT tab, then reopen the popup. Export a small conversation and check the resulting Markdown and file links.

GitHub releases do not update unpacked installations automatically. A Web Store
update also does not replace an unpacked copy.

## Check common installation problems

- **Manifest missing:** select the folder containing `manifest.json`, not its parent.
- **Old behavior:** confirm the loaded folder, reload the extension, reload ChatGPT, and check that you are using the intended installed copy.
- **Export stops when clicking elsewhere:** keep the popup open until completion; it owns the run.
- **Markdown saved but files missing:** read the warnings and [current limitations](../../README.md#current-limitations). Reinstalling cannot add support for an unsupported attachment type.

Return to [usage instructions](../../README.md#export-a-conversation).
