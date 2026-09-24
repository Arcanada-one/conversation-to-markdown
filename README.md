# Conversation to Markdown

![A conversation becoming a structured document](assets/conversation-to-markdown-hero.jpg)

Export ChatGPT conversations as Markdown, with downloadable files where supported.
The extension scans the virtualized conversation and preserves headings, lists,
code, tables, links, and user/assistant roles. Processing happens in your browser.

> **Independent open-source project.** This project is not affiliated with, endorsed by, or sponsored by OpenAI. ChatGPT is referenced only to describe compatibility.

## Install

- **Store version:** install from the [Chrome Web Store](https://chromewebstore.google.com/detail/conversation-to-markdown/jhnhkmnignbhmcjbhoihdbjhjfljpili).
- **Repository version:** follow [Install and update in Chrome](docs/how-to/install.md). No build or npm install is needed.
- **Release downloads:** see [GitHub Releases](https://github.com/Arcanada-one/conversation-to-markdown/releases). GitHub and the Web Store can carry different versions; a source checkout can contain unreleased changes.

## Export a conversation

1. Open your conversation on ChatGPT and wait for its messages to appear.
2. Open the **Conversation to Markdown** toolbar popup.
3. Leave **Save .md + files to chatgpt-export/** checked to save files, or uncheck it to copy Markdown to the clipboard.
4. Press **Copy as Markdown**. The button uses the selected delivery mode despite its name.
5. Keep both the popup and conversation tab open until the result appears. Closing the popup interrupts the operation; there is no background worker.
6. Check the result and any warnings in the saved Markdown. Confirm that the linked files exist before treating the export as a complete backup.

Saving is checked by default whenever the popup opens. In save mode the clipboard
is unchanged. Clipboard mode does not fetch attachments; ChatGPT itself may still
make requests while scrolling loads messages.

A typical single-conversation export looks like:

```text
Downloads/chatgpt-export/Example-conversation/
  Example-conversation--20260924-1808.md
  Example-conversation-001-example.zip
```

The Markdown groups messages under `#### You said:` and `#### ChatGPT said:`.
Filenames use the local date and time to the minute. Re-exporting within the same
minute can overwrite the same Markdown filename. Attachment names can also be
reused and overwritten; dated Markdown copies are not independent snapshots of
attachment bytes. An unavailable title falls back to a generic filename.

## Project exports

Batch mode walks the conversation list visible through the Project sidebar and
navigates the current tab through those conversations. It always enables file
saving. Keep the popup open; pause, resume, and cancel controls apply to the run.
A restarted batch uses download history and a local metadata index to avoid
re-exporting unchanged conversations. Incomplete exports are not recorded as
complete. The list is taken from the sidebar, not an authoritative Project
membership API; verify that the intended Project is selected before starting.

An optional ZIP combines batch output in memory. Large batches need sufficient
browser memory. Cancelled or interrupted runs keep files already downloaded.

## Current limitations

- **Not every attachment is supported.** Generated sandbox files and direct download links can be saved. Build 1.6.5 adds file-service lookup for named uploads with file identifiers. A live uploaded-document export was verified byte for byte against a manual download. Uploads without identifiers are reported as unresolved; unidentified assets can remain unsupported. Check the export inventory yourself.
- Some generated files cannot be resolved. An HTTP success response alone does not prove that a download link exists. Expired or unavailable files cannot be reconstructed by the extension.
- File lookup is bounded. A timeout preserves captured text and links already resolved, but can leave files missing. Some page button labels can produce redundant missing-file warnings even when the corresponding file was downloaded.
- Text scanning depends on ChatGPT's live page structure. The extension reports incomplete scans when it cannot establish the conversation boundaries. It does not export every alternate branch, hidden message, or unsupported canvas representation.
- Signed attachment links left after a failed download may expire and can grant temporary access to the file. Review exports before sharing them.
- Ordinary link query parameters are removed; links that require those parameters may stop working.

The current development build is **not accepted as a complete attachment backup**.
See [the feature checklist](FEATURES.md) for verification scope and
[the changelog](CHANGELOG.md) for version history. A checklist entry is not proof
that every current ChatGPT layout works.

## Permissions and privacy

- `clipboardWrite`: deliver Markdown to the clipboard when saving is unchecked.
- `scripting`: run extraction in the ChatGPT tab.
- `downloads`: save files and inspect export download history for batch resume.
- `storage`: keep a local metadata index and the most recent error, not conversation text or file contents.

Host access covers `chatgpt.com`, `chat.openai.com`, and `files.oaiusercontent.com`.
File and batch metadata requests use your existing ChatGPT session. No developer
server, telemetry, or analytics is used. Read [Privacy](PRIVACY.md) for session-token,
local-storage, and signed-link handling.

## Development and publishing

Tests use Node.js (CI uses Node 24); there are no package dependencies to install.

```sh
npm test
npm run check
```

Read [Contributing](CONTRIBUTING.md) before proposing changes.
Maintainers: [prepare a release and update the Chrome Web Store](docs/how-to/publish.md).
Report vulnerabilities through [Security](SECURITY.md).
Released under the [MIT License](LICENSE).
