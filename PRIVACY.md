# Privacy

Conversation to Markdown processes conversation content locally in your browser.

The extension's content script is present only on the two sites declared in the manifest: `https://chatgpt.com/*` and `https://chat.openai.com/*`. It begins extraction only after you press **Copy as Markdown** in the extension popup. During extraction, it reads the conversation DOM, temporarily scrolls the page so virtualized content can render, creates Markdown in memory, restores the starting scroll position, and writes the finished result to your clipboard.

Copying a conversation uses two permissions:

- `scripting` — runs the parser inside the ChatGPT page, because the conversation exists only as rendered page content. It is authorised by the host permissions declared in the manifest, and the popup refuses to run on any other site.
- `clipboardWrite` — writes the finished Markdown to your clipboard.

## Saving files and artifacts

If you tick **Save .md + files to chatgpt-export/** before pressing the button, the extension additionally writes the Markdown file and the conversation's attachments to your Downloads folder. Attachments are not limited to images: any file the conversation carries — PDF, Word, spreadsheet, archive — is saved the same way, because what may be downloaded is decided by the host serving it, never by the file's type. This is the only mode in which it makes network requests, and it uses two permissions:

- `downloads` — writes the files to your Downloads folder, and reads download history (see below).
- Host access to `https://files.oaiusercontent.com/*` — the host that serves files inside ChatGPT conversations.

In this mode the extension requests each file directly from that host, converts the bytes in memory, and hands the result to the browser's own download mechanism. The requests go only to the host already serving the conversation you are reading, carry no identifiers added by the extension, and reach no developer-operated endpoint. Nothing is uploaded anywhere.

Files that ChatGPT **generates** for you — a PDF or Word document it produced during the conversation — are not links in the page at all, so saving them needs one additional step in this same mode: the extension asks ChatGPT for the conversation's own file list, exactly as the page does when you click a file yourself, and then requests the file. This uses the session you are already signed in with; the extension does not read, store, or transmit your credentials or session token, and the request goes to `chatgpt.com` and nowhere else.

This lookup happens **only** when the save checkbox is ticked. A plain **Copy as Markdown** reads the page and nothing more — it makes no network request of any kind, and that is enforced by a test in the repository, not only by this document.

## Exporting a whole Project

If you tick the batch option on a ChatGPT Project page, the extension reads the conversation list from the page's sidebar and exports each conversation in turn. Because that list is virtualized, it first scrolls the sidebar to the end so every row renders, then restores your scroll position; the rows' on-screen positions are measured to confirm the whole list was seen. Those measurements stay in the page and are discarded when the run ends. It does this by **navigating the tab you are looking at** through those conversations one at a time, and returns control to you when the run ends. This is a change from single-conversation export, where only the page already open is read. The run can be paused, resumed and cancelled; cancelling keeps whatever already landed.

**Resume reads your download history.** To avoid downloading the same conversation twice, the extension asks the browser which files it has previously downloaded, filtered to paths inside the `chatgpt-export/` folder. The browser's answer can include entries from other downloads, so this is worth stating plainly: the extension inspects that list only to decide what it already saved, keeps no copy of it, and sends it nowhere. It is used for nothing else.

## The export index

From version 1.2.0 the extension also keeps a small index of its own, using the `storage` permission. Earlier versions did not, and this document previously said so; that sentence is no longer true and this section replaces it.

The index exists because a filename cannot answer the question resume actually needs to ask. Whether a conversation has **grown since you last saved it** is not something the name of a file on disk can express, so a re-run either skipped conversations that had new messages in them, or exported everything again from the beginning.

For each conversation you have exported, the index stores five values and nothing else:

- the conversation's own last-updated time, as ChatGPT reports it;
- the identifier of its newest message;
- how many messages it had;
- how many bytes the saved Markdown was;
- how many files were saved alongside it.

**No conversation content is stored.** Not the Markdown, not the message text, not the title, not the attachments. The index is a list of identifiers and numbers used to decide whether a conversation needs exporting again, and that restriction is enforced by a test in the repository, not only by this document.

It is stored in `chrome.storage.local`, which means it stays on this computer. The extension does not use `chrome.storage.sync`, so nothing about your conversations is copied to your Google account — also enforced by a test. The index never leaves your browser, is sent to no server, and the developer has no access to it.

You can delete it at any time by removing the extension, which discards its storage with it. Deleting it costs you nothing but speed: the files on your disk remain the authoritative record, and a run with no index falls back to reading download history as before.

## The zip archive

When a batch export is asked to produce a single archive, the `.zip` is built **in the
page's own memory** by code shipped in this extension and handed to the browser's
download mechanism like any other file. Nothing is uploaded, no compression service is
contacted, and no library is fetched at runtime. The archive contains exactly the files
the export already wrote to your Downloads folder.

## What the extension never does

- collects no telemetry or analytics;
- stores no conversation content or user identifiers;
- operates no server or cloud service;
- sends conversation content to no third party;
- does not sell or share data; and
- gives the developer no access to your conversations, files, or clipboard.

## Link handling

Before a link is added to Markdown, its query parameters are removed, so credentials carried in a query string are never copied into the document.

Links to a conversation's own images and attachments are the deliberate exception: ChatGPT serves them from signed, short-lived links that return nothing without their full query string. Those URLs are kept intact so the file can be fetched. When a file downloads successfully, its link in the saved Markdown is replaced by the local file path and the signed URL does not survive in the document.

A file that could **not** be fetched keeps its original URL, and that URL still carries its signature. It stops working once the link expires — usually within hours — but until then the saved Markdown contains a link that grants access to that file. This applies to attachments of every type, not only images. If you share an export whose downloads did not all succeed, be aware you may be sharing such links; saving with the download option ticked, and checking the reported count, avoids it.

Your browser, the ChatGPT website, clipboard manager, operating system, and the application where you paste the result may have their own privacy behavior. Those products are outside this extension's control.

The source code is available in this repository so the behavior can be inspected directly. For a security concern, follow [SECURITY.md](SECURITY.md).
