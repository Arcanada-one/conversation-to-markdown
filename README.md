# Conversation to Markdown

![A voice waveform and conversation becoming a structured document](assets/conversation-to-markdown-hero.png)

Export your own ChatGPT conversations as clean Markdown with one click. The extension gently scans the full virtualized conversation, groups every message by role, preserves useful formatting, and writes one Markdown document to your clipboard.

> **Independent open-source project.** This project is not affiliated with, endorsed by, or sponsored by OpenAI. ChatGPT is referenced only to describe compatibility.

## Why it exists

Long conversations are difficult to archive when the page keeps only part of the thread mounted in the browser. Copying visible text can miss earlier turns, later segments of one response, code blocks, lists, links, and generated images. Conversation to Markdown walks through the conversation, waits for lazy content to appear, combines message segments that belong to the same turn, restores your original scroll position, and copies the result as one document.

## Features

- Captures user and assistant turns across a virtualized conversation.
- Preserves paragraphs, headings, lists, blockquotes, links, code, tables, and visible generated images.
- Combines multiple message segments from one turn instead of keeping only the first paragraph.
- Restores the original scroll position after success or failure.
- Processes everything locally in the browser with no telemetry, storage, or server.
- Reports incomplete scans instead of silently copying a partial conversation.

## Install in Chrome

This repository is distributed as an unpacked Manifest V3 extension; it is not a Chrome Web Store listing.

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

The output uses role headings and separators:

```markdown
## User

How should I archive this conversation?

---

## Assistant

Copy it as structured Markdown.
```

## Permissions

The extension asks only for permissions used by the export flow:

- `clipboardWrite` writes the finished Markdown to your clipboard.
- `activeTab` lets the popup act on the ChatGPT tab you chose.
- `scripting` runs the extraction entrypoint in that tab when requested.
- Host access is limited to `https://chatgpt.com/*` and `https://chat.openai.com/*`.
- The content script loads at `document_idle` on those two hosts so it can observe the conversation DOM; extraction begins only after you press the copy button.

See [PRIVACY.md](PRIVACY.md) for the complete data-handling statement.

## Limitations

- ChatGPT can change its page structure, which may require an extension update.
- The tab must stay open while scanning; very long conversations can take longer.
- Only content rendered by the conversation page can be exported.
- Unsafe executable link schemes are intentionally omitted.

## Development

The project has no runtime or development dependencies beyond Node.js for tests.

```bash
npm test
npm run check
```

Before proposing a change, read [CONTRIBUTING.md](CONTRIBUTING.md). Security reports belong in the private channel described in [SECURITY.md](SECURITY.md).

## License

Released under the [MIT License](LICENSE).
