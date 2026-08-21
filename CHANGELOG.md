# Changelog

All notable changes to Conversation to Markdown are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] — 2026-08-19

Repairs three defects that lost a real export, and settles the popup's options
into two that mean what they say.

**1.2.0 was tagged but never published to the Web Store.** It contains the
`data:` URL defect below, which fails the save path for exactly the long Russian
conversations it was built for. 1.3.0 replaces it; users go from 1.1.8 to 1.3.0.

### Fixed

- **A long Russian conversation failed to save, silently.** The markdown was
  written through a `data:` URL, and `encodeURIComponent` expands Cyrillic 4.99x
  (`П` → `%D0%9F`). A 600-turn Russian export became a 4.17 MB URL against
  Chrome's ~2 MB ceiling and was refused; the threshold falls near 300 turns in
  Russian, and past 1,500 in English — which is why it was never seen in testing.
  The markdown now goes through a blob, as the project archive already did.
- **A refused write reported success.** `saveConversationExport` returned an
  `mdOk` flag that no caller read, so a refusal produced "✓ Copied!" over an
  empty folder. The status now leads with the refusal and names the browser's
  own reason.
- **A clipboard failure erased a successful save.** The clipboard was written
  after the file and after the success message; `writeText` rejects with
  "Document is not focused" whenever the popup has lost focus — routine during a
  scan that runs for minutes — and the rejection replaced the success with a red
  error over a file that was safely on disk. With the save option on, the
  clipboard is no longer written at all.
- **An attachment failure discarded the whole conversation.** The attachment
  fetch runs before the markdown write and was unguarded, so a navigated tab
  threw past the write and lost turns that had taken minutes to capture. The
  fetch is now contained and its failure named in the status.
- **A `var` shadowed the status element.** `var status` inside the click handler
  hoisted over the module-level `status`, so the handler threw on its own first
  line. Found by the existing tests, not by review.

### Changed

- **Every export is stamped with its date and time.** The stamp is no longer an
  option: re-exporting always writes a new file, so the name should say when it
  was taken. Skipping already-exported conversations moved entirely to the
  export index, which compares message counts rather than filenames — a stamped
  name can never match a rebuilt one.
- **The "Re-export with date-time stamp" checkbox is gone.** It changed the
  filename and nothing else, while reading as though re-exporting worked
  differently when ticked. The extension has never been able to append to a file.
- **Choosing a project batch turns file saving on and holds it there.** A batch
  without it archives signed, short-lived links instead of files — an export that
  looks complete the day it runs and is empty hours later. This was a warning
  paragraph; it is now a constraint.
- **The clipboard and the file are separate outcomes.** Save option on: the file
  is the deliverable. Off: the clipboard is. `README.md` previously promised the
  clipboard always receives what was written to disk; that promise is withdrawn.

### Added

- **Failures are recorded.** The extension shipped with zero `console` calls in
  any of its three scripts, so a failure left nothing to investigate — "I have no
  logs" was an accurate description of the code. Errors now carry their phase and
  stack to the console and the last one is kept in `chrome.storage.local`, so it
  outlives the popup that reported it.

## [1.2.0] — 2026-08-18 (tagged, never published)

The first release since 1.1.8. It collapses work that was developed as 1.2.0
through 1.8.0 into a single published version, because those numbers never
reached the store and shipping 1.8.0 would have shown a six-minor-version gap
with no releases behind it.

Batch export of a whole ChatGPT Project is the headline. The rest is mostly
silent-failure repair: several defects here reported success while losing data.

### Added

- **Export every conversation in a ChatGPT Project in one run.** Each lands in
  its own folder, optionally bundled into a single `.zip`. Needs no permission
  beyond those already declared.
- **All attachment types, not just images.** PDF, Word, spreadsheets, archives.
  What may be saved is decided by the host serving the file, never by its
  extension.
- **The files ChatGPT generates for you.** Documents produced during a
  conversation appear in no link on the page, so every shipped selector missed
  them. They are now listed under a **Files** heading; a file that could not be
  retrieved is named together with the reason, so an incomplete export cannot
  look like a complete one.
- **Resume without re-downloading.** A restarted export recognises what already
  landed, identifying each conversation by its ChatGPT id — so conversations
  sharing a title, including several called "Untitled", never mask one another.
- **Unchanged conversations are skipped, grown ones get a new dated copy.** The
  extension keeps a small index (five scalars per conversation, no content) and
  compares it against what ChatGPT reports. A conversation that gained messages
  is written *beside* the earlier file under its own stamp; the old file is left
  untouched, because a Chrome extension cannot append to a file. Both outcomes
  are reported in the summary.
- **Timestamped re-export**, on request: a date-time stamp in the filename keeps
  the previous version alongside the new one.
- **Pause, resume and cancel** a long run. Cancelling keeps everything already
  written.
- **`FEATURES.md`** — a per-feature checklist to walk before each release, and
  **`CLAUDE.md`** — the working rules for this repository, both coupled to the
  build by tests.

### Fixed

- **A heavy conversation lost every second turn and called it complete.** The
  scan advanced a fixed fraction of the viewport while ChatGPT mounts a band of
  DOM whose height it chooses; when that band was narrower than the viewport,
  each step moved past turns that had never rendered. Measured: 30 turns of 60,
  returned as a finished export with no notice. The step is now capped by the
  band actually mounted.
- **A batch export could write nothing at all while reporting progress.** The
  content script was injected into a document the navigation was already
  replacing, so Chrome returned `undefined` rather than an error, and the counter
  counted attempts instead of exports.
- **Reaching the bottom is no longer taken as proof of having read the
  document.** A scan that travelled a stretch with nothing mounted now reports a
  partial export.
- **A conversation whose title Chrome could not put in a filename saved
  nothing**, silently. Titles are sanitised; Cyrillic, emoji and CJK all survive.
- **Resume trusted download history over the disk.** Chrome keeps history rows
  after a file is deleted, moved or renamed, and for interrupted transfers, so a
  file no longer present made resume skip that conversation forever while
  reporting it as already exported.
- **The archive step used 40x the payload in memory and died silently.**
  Measured: 1510.8MB of RSS to encode a 40MB export, dominated by building one
  huge JavaScript string. Encoding in 3-byte-aligned chunks produces identical
  bytes at 2.1MB. An out-of-memory kill takes the popup's document with it — no
  error handler runs and no status appears — so this failure was invisible.
- **The `.zip` no longer accumulates without bound**; it stops at a memory budget
  and reports the files it left out. The saved files on disk are complete
  regardless.
- **A partial export is no longer banked as done**, so re-running repairs it
  instead of skipping it.
- **Stop keeps captured turns.** The saved Markdown carries a
  `> **Partial export**` notice in the artifact itself, not only in the popup.
- **The Markdown download is awaited**, so the popup cannot report success before
  the write finishes.
- **A partial Project list is no longer reported as a complete export.** The
  sidebar walk verifies it observed every row with no gaps and says when it
  cannot.
- **Works in any interface language.** Pagination, titles and download controls
  are located by page structure rather than by English wording. ChatGPT
  translates its UI by browser locale, so an English-only match broke a Project
  export at the first page and baked the project name into folder names.

### Changed

- **New permission: `storage`**, for the export index. It is the reason resume
  can tell a conversation that grew from one that did not. The index holds no
  conversation content, uses `chrome.storage.local` and never `sync`, and both
  facts are enforced by tests.
- `PRIVACY.md` previously stated the extension "deliberately stores no state of
  its own". That is no longer true and has been retracted and replaced with a
  description of exactly what the index holds.
- `README.md` claimed Chrome appends `(1)`, `(2)` and preserves the old file on
  re-export. It does not — the extension asks for `overwrite` deliberately.
  Corrected.
- `activeTab` was removed. It was never load-bearing and was actively
  misleading, since the grant is revoked on navigation while a batch deliberately
  navigates the tab.

### Verification

Every fix is covered by a test verified through mutation: delete the fix, the
test must fail. Two rounds of that found the tests themselves at fault — a
fixture that could not express the turn-loss defect at all, and a feature whose
helpers were tested while nothing drove the real entry point, leaving five
mutants that deleted it outright alive. Both are recorded in
`MUTATION-EVIDENCE.md`.

## [1.1.8] — 2026-08-05

### Removed

- **Scan deadlines.** A 570-turn conversation failed with "scan timed out
  before reaching a stable bottom". Raising the constant only moves the wall,
  so the wall-clock limit and the step ceiling are gone entirely. A flat
  timeout is a limit on conversation *length* wearing the costume of a safety
  check. A scan now ends when the conversation ends, when it genuinely stops
  making progress, or when you stop it. Duration is reported, never enforced.

### Added

- **Stop button and live progress.** A scan in progress can be stopped at any
  point, and the popup reports messages captured and seconds elapsed — so an
  unbounded scan stays under operator control and visibly alive.

### Fixed

- **A single unresolved message no longer costs the rest of the conversation.**
  The scan holds its scroll position while any turn is unresolved; one turn
  that never painted held it forever, so the page stopped moving and the stall
  guard killed a healthy scan. Measured live: 500 of 570 turns captured with
  31556px still to go and one outstanding id. Stragglers are now released after
  a bounded hold.
- **Twelve dropped answers recovered.** Turn extraction searched only inside
  `[data-message-author-role="assistant"]`; 12 of 285 assistant turns carry no
  such wrapper, and eleven of them held real prose, up to 3106 characters. It
  now falls back to the `.markdown`/`.prose` container — deliberately not to
  the whole section, which harvests the "Thinking…" chrome of a re-mounting
  turn and appends duplicate answers.
- `package.json` version, which had drifted to 1.1.4.

### Verification

Each fix is covered by a test verified through mutation — delete the fix, the
test must fail. Verified end-to-end against the reported conversation using the
packaged extension: 63/63 images downloaded, every local image link resolves,
no duplicate blocks, clipboard byte-identical to the saved file. The single
remaining alternation gap is an assistant turn that is empty on the page itself.

## [1.1.7] — 2026-07-30

### Fixed

- **Image filename collisions.** Filenames now carry the conversation slug,
  matching the Markdown file and its folder, so exports from different
  conversations no longer collide as `image_001.png`. Untitled conversations
  keep the previous unprefixed names.
- **PRIVACY.md accuracy.** It claimed the extension sends no network requests
  and did not mention the `downloads` permission or the image host it fetches
  from. Both now match the manifest.

### Security

- Every tracked file is scanned for credential shapes, and a tracked file
  absent from the allowlist fails the build. Findings report the file, rule and
  match length — never the value.

## [1.1.6] — 2026-07-28

Three fixes that together make the extension usable on real, long conversations
with generated images.

### Fixed

- **Scroll stability.** The stability counter reset whenever `scrollHeight`
  changed, which lazy-loading conversations do constantly — so long threads
  always hit "scroll did not settle before timeout". Stability now tracks
  `scrollTop` movement only, and a missed target falls back to an instant jump
  so a scan never starts mid-conversation.
- **Cross-origin images.** Downloads passed remote URLs straight to
  `chrome.downloads`, which fails on cross-origin media without the page's
  credentials. Each image is now fetched from the content script, converted to
  a data URL, and downloaded from that. Image URLs keep the query parameters
  their host requires; only page links are stripped.

### Added

- **Conversation titles.** Read from the active sidebar entry, falling back to
  the document title. The title becomes the document's H1 and the export
  filename, and images land beside the Markdown in `chatgpt-export/<title>/`.
- A popup checkbox to save the `.md` alongside images, a per-download timeout
  so the popup cannot hang, and error reporting in the status line.

## [1.1.2] — 2026-07-22

### Added

- Initial public release: one-click export of a ChatGPT conversation to clean
  Markdown, walking the full virtualized thread and grouping every message by
  role.

### Security

- Query credentials stripped from exported links; media queries restricted to
  an exact allowlist.

Versions 1.1.3 and 1.1.4 predate this public repository and have no commits
here; they were store-only builds between 1.1.2 and 1.1.6.

[1.3.0]: https://github.com/Arcanada-one/conversation-to-markdown/releases/tag/v1.3.0
[1.2.0]: https://github.com/Arcanada-one/conversation-to-markdown/releases/tag/v1.2.0
[1.1.8]: https://github.com/Arcanada-one/conversation-to-markdown/releases/tag/v1.1.8
[1.1.7]: https://github.com/Arcanada-one/conversation-to-markdown/releases/tag/v1.1.7
[1.1.6]: https://github.com/Arcanada-one/conversation-to-markdown/releases/tag/v1.1.6
[1.1.2]: https://github.com/Arcanada-one/conversation-to-markdown/releases/tag/v1.1.2
