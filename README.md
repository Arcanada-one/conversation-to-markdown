# Conversation to Markdown

![A voice waveform and conversation becoming a structured document](assets/conversation-to-markdown-hero.jpg)

Export your own ChatGPT conversations as clean Markdown with one click. The extension gently scans the full virtualized conversation, groups every message by role, preserves useful formatting, and writes one Markdown document to your clipboard.

> **Independent open-source project.** This project is not affiliated with, endorsed by, or sponsored by OpenAI. ChatGPT is referenced only to describe compatibility.

## Why it exists

Long conversations are difficult to archive when the page keeps only part of the thread mounted in the browser. Copying visible text can miss earlier turns, later segments of one response, code blocks, lists, links, and generated images. Conversation to Markdown walks through the conversation, waits for lazy content to appear, combines message segments that belong to the same turn, restores your original scroll position, and copies the result as one document.

## Features

- Captures user and assistant turns across a virtualized conversation, including very long threads.
- Names the export after the conversation title shown in the sidebar, and adds that title as the document's `#` heading.
- Optionally downloads every attachment to `chatgpt-export/<title>/` and rewrites the Markdown to point at the local copies.
- **Exports every conversation in a ChatGPT Project in one run**, each into its own folder, optionally bundled into a single `.zip`.
- **Downloads all attachments, not just images** — PDF, Word, spreadsheets, archives. What can be saved is decided by the host serving the file, never by its extension.
- **Saves the files ChatGPT generates for you**, not only the ones you uploaded. Documents produced during a conversation appear in no link on the page, so they used to be skipped silently; they are now listed under a **Files** heading in the export. A file that cannot be retrieved is named in the export together with the reason, so an incomplete export never looks like a complete one.
- **Works in any interface language.** Sidebar pagination and conversation titles are located by page structure rather than by English wording, so a Project export does not stop at the first page — and folder names do not pick up the project name — when ChatGPT is displayed in another language.
- **Survives a long run:** transient failures retry with a capped backoff, a dropped network or an unreachable site pauses the run instead of consuming the rest of the list, and the run can be paused, resumed, or cancelled. Cancelling keeps everything already written.
- **Resumes without re-downloading.** A restarted export recognises what already landed and skips it, identifying each conversation by its ChatGPT id — so two conversations sharing a title, including several called "Untitled", never mask one another.
- **Skips conversations that have not changed, and re-saves the ones that have.** A re-run compares each conversation against what it recorded last time and skips it if nothing is new. A conversation that gained messages is saved as a **new dated copy** beside the earlier file, which is left untouched — a Chrome extension cannot append to an existing file, so this is how new messages reach your disk without losing the old export.
- **Says when it cannot prove it saw the whole list.** The sidebar is virtualized, so a long Project mounts only part of itself at a time. The export walks it to the end and verifies it observed every row with no gaps; an unconfirmed walk is reported as unconfirmed rather than as a complete export.
- **Every export is stamped with the date and time it was taken**, so a folder of backups is readable at a glance and no export silently replaces another. This is not an option — re-exporting always writes a new file, so the name says when.
- Preserves paragraphs, headings, lists, blockquotes, links, code, tables, and visible generated images.
- Removes query parameters from exported page links; image URLs keep the parameters their host requires to serve the file.
- Combines multiple message segments from one turn instead of keeping only the first paragraph.
- Restores the original scroll position after success or failure.
- Processes everything locally in the browser with no telemetry and no server. The only thing it stores is a small index of what it has already exported — identifiers and counts, never conversation content — kept on your own computer and never synced. See [PRIVACY.md](PRIVACY.md).
- Runs without a time limit: a scan ends when the conversation ends, when it genuinely stops making progress, or when you stop it — never because a clock expired.
- Shows live progress (messages captured and seconds elapsed) and offers a **Stop scanning** button at any point.
- Keeps going when a single message refuses to render, instead of losing the rest of the conversation to it.
- Captures assistant messages even when the page omits the author-role attribute some turns are missing.
- Reports incomplete scans instead of silently copying a partial conversation.

## Install in Chrome

Published on the Chrome Web Store. This repository is also the source, so it can be
loaded unpacked — useful for reviewing the code or running a version before it reaches
the store.

1. Clone this repository, or choose **Code → Download ZIP** on GitHub and unzip it.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the repository folder that contains `manifest.json`.
6. Pin **Conversation to Markdown** from the Extensions menu if you want it always visible.

After pulling an update, open `chrome://extensions`, press the extension's reload button, and refresh any open ChatGPT tab.

## Use

1. Open a conversation on `https://chatgpt.com/` or `https://chat.openai.com/`.
2. Wait for any active response to finish.
3. Click the extension icon, then **Copy as Markdown**.
4. Keep the conversation tab open while the page scrolls. The extension returns it to the starting position.
5. Paste the Markdown into your editor, notes app, or repository.

The output starts with the conversation title, then uses role headings and separators:

```markdown
# How to archive a conversation

#### You said:

How should I archive this conversation?

---

#### ChatGPT said:

Copy it as structured Markdown.
```

### Saving files alongside the Markdown

Tick **Save .md + files to chatgpt-export/** before pressing the button — the label says *files* because attachments of every type are saved, not only images. The extension then downloads the conversation and every file it references into your Downloads folder:

```
Downloads/chatgpt-export/How-to-archive-a-conversation/
├── How-to-archive-a-conversation.md
├── How-to-archive-a-conversation-image_001.png
└── How-to-archive-a-conversation-image_002.jpg
```

Images carry the conversation name too, so they stay unique even if exports from different conversations end up in the same folder. Image references in the saved Markdown point at the local files, so the document renders offline. Images the browser cannot fetch keep their original URLs, and the status message reports how many were saved. Without a conversation title — a brand-new, unnamed chat — files land directly in `chatgpt-export/` as `conversation.md` and `image_001.png`.

**The clipboard and the file are separate outcomes.** With this option ticked the export goes to disk and the clipboard is left alone — the file is what you asked for, and writing the clipboard as well used to be the run's most fragile step: the browser rejects a clipboard write whenever the popup has lost focus, which a multi-minute scan invites, and that rejection replaced a perfectly good "saved" message with an error. Untick the option and the clipboard becomes the delivery instead.

Earlier versions of this document promised the clipboard always receives the same Markdown that was written to disk. That is no longer true, and the reason it changed is above.

## Permissions

The extension asks only for permissions used by the export flow:

- `clipboardWrite` writes the finished Markdown to your clipboard.
- `scripting` runs the extraction entrypoint in that tab when requested.
- `downloads` saves the Markdown file and attachments to your Downloads folder — used only when you tick the save checkbox. It also lets a resumed batch export ask the browser which files it already downloaded under `chatgpt-export/`, which is how resume avoids fetching the same conversation twice; the extension keeps no copy of that answer and sends it nowhere.
- `storage` keeps a small index of what has already been exported — for each conversation, its last-updated time, the identifier of its newest message, a message count, a byte count and a file count. That is what lets a re-run tell a conversation that gained messages from one that did not, which no filename can express. No conversation content, no message text, no titles. It uses `chrome.storage.local`, so it stays on this computer and is never synced to your Google account; both restrictions are enforced by tests in this repository.
- Host access covers `https://chatgpt.com/*`, `https://chat.openai.com/*`, and `https://files.oaiusercontent.com/*`. The third host serves conversation files and is contacted only while downloading them.
- There is no `activeTab` permission and no background service worker. `scripting` is authorised by the host permissions above, and the popup refuses to run on any other site.
- The content script loads at `document_idle` on the two conversation hosts so it can observe the DOM; extraction begins only after you press the copy button.

See [PRIVACY.md](PRIVACY.md) for the complete data-handling statement.

## Limitations

- ChatGPT can change its page structure, which may require an extension update.
- The tab must stay open while scanning. Very long conversations simply take longer — there is no deadline, and a scan in progress can be stopped from the popup.
- Only content rendered by the conversation page can be exported.
- Unsafe executable link schemes are intentionally omitted.
- Temporary or authenticated page links may stop working after URL query parameters are removed.
- Image URLs are time-limited. Download them while the conversation is open; links left in the Markdown expire.
- **A Chrome extension cannot append to an existing file.** Nothing can add new messages to a Markdown file you already have; the browser's download mechanism only writes whole files. The date-time stamp exists because of that limit, not as a preference.
- Re-exporting writes a **new dated file**; the earlier one is left alone. Two exports within the same minute share a name, and the second overwrites the first — `overwrite` is deliberate, because a folder filling with `(1)`, `(2)`, `(3)` copies is worse. Earlier versions of this document claimed Chrome appends `(1)` and preserves the old file; that was wrong.
- Conversations that have not changed are skipped without being re-read. That decision compares message counts recorded in the extension's own index — not filenames, which cannot say whether a conversation grew. Removing the extension clears the index, and the next run then re-exports everything; the files already on disk are not touched.
- **A project batch always saves files.** Ticking it turns the save option on and holds it there: attachment links ChatGPT serves are signed and expire within hours, so an archive of links rather than files looks complete the day it runs and is empty afterwards.
- **A batch export needs the popup to stay open.** There is no background worker by design, so closing the popup ends the run. What already landed is kept, and restarting resumes from there.
- **A batch export navigates the tab** through each conversation in turn, so the tab is in use for the duration of the run.
- The Project conversation list is read from the page's sidebar. The extension scrolls that sidebar to its end and checks that it observed the whole list without gaps; when it cannot confirm that, the run says so instead of reporting a complete export. Only conversations the sidebar can show are reachable at all.
- Batch mode exports what the **sidebar** lists, which is not the same thing as verified Project membership: the extension has no way to ask ChatGPT which conversations belong to a Project. Start the run from the Project page you mean to export.

## Development

The project has no runtime or development dependencies beyond Node.js for tests.

```bash
npm test
npm run check
```

Before proposing a change, read [CONTRIBUTING.md](CONTRIBUTING.md). Security reports belong in the private channel described in [SECURITY.md](SECURITY.md).

## Changelog

Release history is in [CHANGELOG.md](CHANGELOG.md).

## License

Released under the [MIT License](LICENSE).
