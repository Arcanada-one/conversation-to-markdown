# Changelog

All notable changes to Conversation to Markdown are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] — 2026-09-10

### Fixed

- **A file offered as a link in the answer was named but never downloaded.**
  ChatGPT hands generated files to the reader as ordinary markdown links —
  `[Скачать bundle](sandbox:/mnt/data/canon-consilium-prompt-bundle-v1.zip)` —
  and nothing in the export path could act on one. `nodeToMarkdown` rewrote the
  link into a prose note, and the downloader matches only `[label](http…)`, so
  the note and the original link both yielded zero matches. The artefact panel
  was no help either: a `.zip` has no built-in viewer and so gets no panel row.
  The file appeared in the export by name, and the bytes never arrived — four
  exports in a row.

  Sandbox links in the message body are now collected and resolved through the
  same interpreter endpoint the panel already used, and the path is read from
  the link rather than rebuilt as `/mnt/data/` + filename — a file written to a
  subdirectory resolved to nothing before.

- **A file offered only as a button was unreachable by every existing path.**
  The same conversation offered its archive not as a link but as a button with
  a click handler — `<button class="behavior-btn">Скачать готовый Canon
  Consilium Prompt Bundle v1</button>` — and measurement on the live page found
  every other source at zero: no `href`, no `sandbox:` link, no panel row
  (a `.zip` has no viewer, so the panel listed only its `.md`/`.txt` siblings),
  and no `data-*` carrying a file id on any of the eight buttons present. The
  label is prose rather than a file name, so no path could be derived from it
  either. The signed URL exists only after the page's own handler asks the
  backend for one.

  Such buttons are now clicked during a file-saving export, with the page's
  download routes (`HTMLAnchorElement.click`, `window.open`,
  `URL.createObjectURL`) temporarily intercepted so the URL is captured and the
  page's own download suppressed. This matters for where the file lands: an
  uninterrupted page download passes no `filename`, so Chrome drops it in the
  root of Downloads, whereas the captured URL goes through `chrome.downloads`
  and lands beside its conversation like every other artefact. All three routes
  are restored in a `finally`, including when a handler throws — a patch left
  behind would break downloading for the user after the export.

  Only labels that offer a download are clicked. The same conversation carried
  "Открыть полное техническое задание" and "Посмотреть полный diff" on identical
  markup, and clicking those opens a viewer, navigating the page out from under
  a running scan.

- **The archive is fetched again, now that a wrong click costs nothing.**
  Measured on the live page: the markup cannot tell a download button from a
  viewer button. Both carry the same class, **the same `<svg>` icon** and the
  same `data-start`/`data-end`; only the prose label differs, and it lies in
  both directions — the archive's label names no format at all ("Скачать готовый
  Canon Consilium Prompt Bundle v1") while a *viewer* button reads "Посмотреть
  полный diff". So no attribute can gate the click, and the format-based gate
  from the previous entry skipped the one file that could only be had by
  clicking.

  Clicking every download button is safe only because a wrong click now repairs
  itself, which the same measurement confirmed: a click on a `.md` button
  produced no URL (it opened the Library viewer), the close control was found
  and pressed, and the artefact panel read again afterwards. A wrong click
  therefore costs one dismissal instead of every artefact behind the viewer.
  Archives are clicked first, so the files obtainable only by clicking are
  fetched before any viewer can interfere, and a viewer now gets both dismissal
  routes — the close control **and** Escape — because the control cannot report
  whether the viewer actually went away.

- **A supplied timer turned the click wait into a busy-loop.** The wait for a
  handler's round-trip was bounded by `Date.now()` while the sleep itself was
  injectable, so a `sleep` that returns immediately still burned the full
  budget: 2.5s per button, 20s across the eight buttons a real conversation
  carries. It is bounded by poll count now — 2500ms to 2.6ms in the suite.

- **Clicking on the label alone made the export worse, and now it does not.**
  The first version of the button feature clicked anything labelled "Скачать …".
  Measured against the live conversation: a "Скачать …" button for a `.md`
  **opened the Library viewer instead of downloading**, the viewer slid over the
  artefact panel, and the export produced **one file where the previous run
  produced four** — worse than before the feature existed. ChatGPT previews what
  it can render (`.md`, `.txt`, images, video, PDF) and downloads only what it
  cannot, so the label never decided the action; the format did.

  A button is now clicked only when all three hold: the label offers a download,
  it names a format ChatGPT cannot preview, and the file is **not one the panel
  already resolved** (matched on the extension-stripped stem, because the label
  carries no extension). An unrecognised format is skipped rather than risked —
  a needless skip loses nothing, since the panel still lists what it resolves,
  while a needless click covers the panel and loses files that were arriving.
  And a click that yields no URL is now treated as a viewer that opened: it is
  dismissed via the viewer's own close control, falling back to Escape, so the
  panel is readable for the rest of the run.

- **The download-button filter rejected every Russian label.** The first
  implementation matched `/^(скачать|download|…)\b/i`. `\b` is an ASCII word
  boundary, so it is absent after a Cyrillic letter: the check passed
  "Download the bundle" and failed "Скачать архив" — every label in the
  conversation it was written for. Caught by a fixture in the failing language,
  as this repository's own rule requires; the boundary is now whitespace or
  end-of-string.

## [1.4.0] — 2026-09-10

**The Web Store goes from 1.1.8 straight to 1.4.0.** Versions 1.2.0 and 1.3.0
were tagged in the repository and never published, so no update is missing: this
release carries everything they contained plus the fix below. 1.2.0 held the
`data:` URL defect that broke saving for exactly the long Russian conversations
it was built for; 1.3.0 repaired that, and while it waited, batch Project export
and generated-file downloads landed on top of it.

A user on 1.1.8 receives, in one update: batch export of an entire Project, all
attachment types including files ChatGPT generates, resume without re-downloading,
reliable saving of long Cyrillic conversations, and the coverage fix below.

### Fixed

- **An 8-turn conversation exported 4 turns and called itself complete.** The
  turn list is virtualized: while the scan sits near the top, the turns below it
  are not mounted and `scrollHeight` is short. The scan reached the bottom of
  that short height, saw three stable passes and stopped — at the last turn it
  had read. Neither coverage check could see it. There was no later band to
  leave a hole against, and the travelled-but-unseen tail measured
  `2400 - 3200 = -800px`: negative, so the one-viewport threshold could never
  fire. The scan's furthest position is now compared against the document's
  final height, and a stretch wider than one viewport below it is reported.
  Measured on the export that prompted this: 4 of 8 turns, no notice.

  The turn that carried a generated `.zip` was in the half that was dropped —
  the file was never missing from the download path, it was missing from the
  export.

- **The content script threw on every ordinary export.** The manifest declares
  it on each chatgpt.com page and the popup re-injects it after a batch
  navigation; on an already-loaded tab both copies run in the same window and
  the second one died at parse time — `Identifier 'ATTACHMENT_CHIP_SELECTORS'
  has already been declared`. Because the failure is a parse error, none of the
  second copy ran, while the first copy's listener kept answering: the export
  still produced a file and the only evidence was an error page in
  `chrome://extensions`. Top-level bindings are now `var`, where a repeat is a
  no-op rather than fatal.

- **The file header advertised a version it no longer was.** `content.js` said
  `v1.3.0` while the manifest said 1.4.0 — the one place the version-coupling
  tests could not see. The header no longer names a version, and a test keeps it
  that way.

## [1.3.0] — 2026-08-19 (tagged, never published)

Repairs three defects that lost a real export, and settles the popup's options
into two that mean what they say.

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
