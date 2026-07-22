# Privacy

Conversation to Markdown processes conversation content locally in your browser.

The extension's content script is present only on the two sites declared in the manifest: `https://chatgpt.com/*` and `https://chat.openai.com/*`. It begins extraction only after you press **Copy as Markdown** in the extension popup. During extraction, it reads the conversation DOM, temporarily scrolls the page so virtualized content can render, creates Markdown in memory, restores the starting scroll position, and writes the finished result to your clipboard.

The extension:

- sends no network requests;
- collects no telemetry or analytics;
- stores no conversation content or user identifiers;
- operates no server or cloud service;
- does not sell or share data; and
- gives the developer no access to your conversations or clipboard.

Before a link or image URL is added to Markdown, all query parameters are removed. A generated-media URL may retain only its non-credential `id` parameter so duplicate images can be identified. Temporary links may stop working after sanitization; preventing query-string credentials from being copied takes priority over preserving a remote link.

Your browser, the ChatGPT website, clipboard manager, operating system, and the application where you paste the result may have their own privacy behavior. Those products are outside this extension's control.

The source code is available in this repository so the behavior can be inspected directly. For a security concern, follow [SECURITY.md](SECURITY.md).
