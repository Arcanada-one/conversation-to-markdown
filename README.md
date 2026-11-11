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
4. Press the button. It reads **Save Markdown**, **Save HTML site**, **Save Markdown and HTML**, or **Copy as Markdown**, matching the boxes.
5. Keep both the popup and conversation tab open until the result appears. Closing the popup interrupts the operation; there is no background worker.
6. Check the result and any warnings in the saved Markdown. Confirm that the linked files exist before treating the export as a complete backup.

Saving is checked by default whenever the popup opens. In save mode the clipboard
is unchanged. Clipboard mode does not fetch attachments; ChatGPT itself may still
make requests while scrolling loads messages.

A typical single-conversation export looks like:

```text
Downloads/chatgpt-export/Example-conversation/
  Example-conversation--20260924-1808-a1b2-1.md
  Example-conversation-001-example--20260924-1808-a1b2-1.zip
```

The Markdown groups messages under `#### You said:` and `#### ChatGPT said:`.
Markdown filenames include the local date and time plus a unique suffix, so
re-exporting within the same minute keeps both Markdown files. Downloaded
attachments carry the same run suffix, so earlier Markdown files keep their
own attachment bytes. An unavailable title falls back to a generic filename.

## Understand an incomplete export

Text completeness and file completeness are checked separately. A saved
conversation can contain every rendered message and still be incomplete because
one cited file was not downloaded.

- A history-start warning means the scanner could not verify the beginning. In
  the measured app-shell layout, it checks the history header, virtual-list
  offsets, and the first mounted message at the top. It does not add the warning
  merely because the page uses that layout. An unfamiliar structure remains
  unverified.
- A Library-file warning names a different limitation: the conversation cites a
  preview-only document whose bytes the exporter cannot retrieve. Open that
  citation in ChatGPT, choose **Download**, and keep the file with the export.
- Downloading a file manually does not edit an existing Markdown warning or the
  extension's local completeness index. Verify the actual files before changing
  an export's status yourself. A partial export remains eligible for batch retry.

## Project exports

Batch mode walks the conversation list visible through the Project sidebar and
navigates the current tab through those conversations. If ChatGPT shows a Retry
screen instead of the conversation, the export waits, clicks Retry, and continues
when the thread loads. While that screen remains, the batch does not open the
next chat. With the HTML option
off, it turns file saving on and holds it there. With **Save a static HTML site**
on, that markdown option stays yours, and a markdown file Chrome does not
finish does not drop the HTML page. The toolbar button opens a side panel, which stays open while you use the page. Pause stores the batch: you can close the panel and resume it later, including on another day. Cancel stops the run and keeps what already landed.
A restarted or resumed batch reads live metadata from the already-open ChatGPT
tab and does not open a chat only to make that check. An unchanged chat whose
finished file is still in download history is left closed. Chats that are not
on disk are exported before chats that already are, so a stop on the Retry
screen continues from the unfinished ones. A finished file whose metadata
cannot be read is left closed and is not recorded as unchanged. A missing file,
a partial save, or metadata that shows the chat changed is exported. A finished
file with readable metadata and no index entry is exported once, so the index
can be written. Incomplete exports are not recorded as complete; a failed
attachment, HTML page, or HTML index remains eligible for retry.
Pause becomes available after the conversation list is stored. If local storage
fails, the panel warns that closing it cannot preserve the run. A new sync walks the sidebar. Resume keeps the saved list and also
checks the open sidebar, adding chats in the saved job's projects that appeared since the pause and keeping
chats the sidebar no longer shows. It is not an authoritative Project
membership API; scroll the sidebar to the end and have the intended Project
open before starting. A personal-chat resume keeps its saved list but cannot
identify which account owns newly visible personal chats; start a new sync to
include those later chats.

An optional ZIP combines only the new or updated files written in that run;
the on-disk folder is the cumulative backup. Large batches need sufficient
browser memory. Cancelled or interrupted runs keep files already downloaded.

## Static HTML site

Check **Save a static HTML site** to write an HTML page for the active
conversation, plus an index. Chats that belong to a project are grouped under
that project. Chats with no project stay in their own folders. Two chats with
the same title each get a directory ending in `~` and the conversation id, so
one does not replace the other. Project directories also end in `~` and the
project id, keeping same-title projects separate. Files the export retrieved sit beside the chat
page and are linked with relative URLs. A file that could not be retrieved is
named on the page, and that export stays incomplete. Images on other web hosts
are shown as links; opening a saved page does not request them automatically. The pages escape
conversation text and carry their own styles, so a page opened on its own is
readable. Each chat folder also contains `conversation.md`. On the page,
**Get in markdown** opens that file, and **Copy path to markdown version**
copies its path: the path inside the saved site, or the file's own path when
the page was opened from disk. A download Chrome accepts but does not finish is reported
as not saved.

The index lists chats from this run and from earlier HTML downloads, marks an
incomplete chat, and has a search box. Each code block has **Copy code**.
The status line names `chatgpt-export/html/`. **Show export folder** reveals
that download.

A run that saves files also writes `chatgpt-export/logs/<run>.json`. The HTML
folder gets a copy as `export-log.json`. The log is for finding failures that
the page does not show: the phase, the outcome, counts, and the error. It does
not contain the conversation text or signed file URLs. It is rewritten as the
run proceeds, so the last successful flush survives a crash.

The extension does not serve those files. After the folder is on disk, a
separate read-only server can host it on this computer:

```sh
node server.js path/to/chatgpt-export/html
```

It listens on 127.0.0.1, answers GET and HEAD, and does not accept uploads.
Open the printed `http://127.0.0.1:<port>/` address. Downloads from the popup
land under `chatgpt-export/html/`.

## Current limitations

- **Not every attachment is supported.** Generated sandbox files and direct download links can be saved. Build 1.6.5 adds file-service lookup for named uploads with file identifiers. A live uploaded-document export was verified byte for byte against a manual download. Uploads without identifiers are reported as unresolved; unidentified assets can remain unsupported. Check the export inventory yourself.
- Library file citations shown as preview buttons have no downloadable URL in the conversation markup. Their filenames remain in the Markdown with a not-downloaded note. File-saving exports that cite them stay incomplete until the files are obtained separately.
- Paths inside tool commands or private analysis are not proof of a produced file and are excluded. An unreadable attachment inventory is reported as incomplete.
- Some generated files cannot be resolved. An HTTP success response alone does not prove that a download link exists. Expired or unavailable files cannot be reconstructed by the extension.
- File lookup is bounded. A timeout preserves captured text and links already resolved, but can leave files missing. Some page button labels can produce redundant missing-file warnings even when the corresponding file was downloaded.
- Text scanning depends on ChatGPT's live page structure. The extension reports incomplete scans when it cannot establish the conversation boundaries. It does not export every alternate branch, hidden message, or unsupported canvas representation.
- Signed attachment links left after a failed download may expire and can grant temporary access to the file. Review exports before sharing them.
- Ordinary link query parameters are removed; links that require those parameters may stop working.
- Images hosted outside ChatGPT's declared file hosts are not fetched by the extension. Their links remain in Markdown without query parameters; click an external image link in the HTML site only if you want to contact its host.

The current development build is **not accepted as a complete attachment backup**.
See [the feature checklist](FEATURES.md) for verification scope and
[the changelog](CHANGELOG.md) for version history. A checklist entry is not proof
that every current ChatGPT layout works.

## Permissions and privacy

- `clipboardWrite`: deliver Markdown to the clipboard when saving is unchecked.
- `scripting`: run extraction in the ChatGPT tab.
- `downloads`: save files and inspect export download history for batch resume.
- `storage`: keep a local metadata index, the most recent error, and unfinished batches (conversation id, address, title, and Project id), not message text or file contents.
- `sidePanel`: open the export controls in a side panel so a click on the page does not cancel a running export.

Host access covers `chatgpt.com`, `chat.openai.com`, and `files.oaiusercontent.com`.
File and batch metadata requests use your existing ChatGPT session. No developer
server, telemetry, or analytics is used. `server.js` is a local reader for a
folder you already saved; the extension does not start it. Read [Privacy](PRIVACY.md) for session-token,
local-storage, and signed-link handling.

## Development and publishing

Tests use Node.js 24. Run `mise run setup` to install the pinned development
tools and enable the pre-commit test hook. Runtime modules live under
`src/content/` and `src/popup/`. Bun bundles them into the committed entry
scripts, so an unpacked extension needs no build step or package dependencies.

```sh
npm run build
npm test
npm run check
```

Read [Contributing](CONTRIBUTING.md) before proposing changes.
Maintainers: [prepare a release and update the Chrome Web Store](docs/how-to/publish.md).
Report vulnerabilities through [Security](SECURITY.md).
Released under the [MIT License](LICENSE).
