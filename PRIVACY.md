# Privacy

Conversation to Markdown processes conversation content locally in your browser.

The extension's content script is present only on the two sites declared in the manifest: `https://chatgpt.com/*` and `https://chat.openai.com/*`. It begins extraction only after you press **Copy as Markdown** in the extension popup. During extraction, it reads the conversation DOM, temporarily scrolls the page so virtualized content can render, creates Markdown in memory, restores the starting scroll position, and writes the finished result to your clipboard.

Copying a conversation uses three permissions:

- `activeTab` — reads the conversation from the tab you are looking at, and only after you press the button.
- `scripting` — runs the parser inside that page, because the conversation exists only as rendered page content.
- `clipboardWrite` — writes the finished Markdown to your clipboard.

## Saving images

If you tick **Save .md + images to chatgpt-export/** before pressing the button, the extension additionally writes the Markdown file and the conversation's images to your Downloads folder. This is the only mode in which it makes network requests, and it uses two permissions:

- `downloads` — writes the files to your Downloads folder.
- Host access to `https://files.oaiusercontent.com/*` — the host that serves images inside ChatGPT conversations.

In this mode the extension requests each image directly from that host, converts the bytes in memory, and hands the result to the browser's own download mechanism. The requests go only to the image host already serving the conversation you are reading, carry no identifiers added by the extension, and reach no developer-operated endpoint. Nothing is uploaded anywhere.

## What the extension never does

- collects no telemetry or analytics;
- stores no conversation content or user identifiers;
- operates no server or cloud service;
- sends conversation content to no third party;
- does not sell or share data; and
- gives the developer no access to your conversations, files, or clipboard.

## Link handling

Before a link is added to Markdown, its query parameters are removed, so credentials carried in a query string are never copied into the document.

Image URLs are the deliberate exception: ChatGPT serves images from signed, short-lived links that return nothing without their full query string. Those URLs are kept intact so the image can be fetched. When an image downloads successfully, its link in the saved Markdown is replaced by the local file path and the signed URL does not survive in the document. An image that could not be fetched keeps its original URL, which will stop working once the link expires.

Your browser, the ChatGPT website, clipboard manager, operating system, and the application where you paste the result may have their own privacy behavior. Those products are outside this extension's control.

The source code is available in this repository so the behavior can be inspected directly. For a security concern, follow [SECURITY.md](SECURITY.md).
