# Changelog

All notable changes to Conversation to Markdown are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.6] — 2026-09-24

### Documentation

- Keep the repository's instructions for all agent runtimes in `AGENTS.md`.
- Assign repository code ownership to the `Arcanada` account used for autonomous
  maintenance.

### Fixed

- Do not treat intended output paths inside assistant tool commands, executable
  code messages, or private analysis as produced attachments. An observed
  website-fetch command failed before writing its HTML output; the old parser
  incorrectly reported that nonexistent output as a missing attachment.
- Preserve file candidates from successful tool results and user-facing answer
  links, even when the associated creation command was excluded.
- Mark an unreadable attachment inventory as incomplete, including conversations
  with no visible file controls and those whose visible downloads all resolve.
  A confirmed empty inventory remains complete.

### Verification

- Root cause confirmed in the live conversation's expanded tool record.
- Source filtering and inventory-failure handling have integration regressions,
  successful-output controls, and negative controls against the old behavior.
- The 1.6.5 uploaded-document byte comparison remains valid for its tested flow.
  Current complete live batch coverage is not claimed by the regression tests.

## [1.6.5] — 2026-09-24

### Fixed

- Resolve named uploaded attachments using their file identifiers and the
  observed file-service download endpoint. Keep unresolved uploads in the file
  warnings instead of silently filtering out entries without sandbox paths.
- Reuse download-host validation, authenticated request handling, and progressive
  result preservation for uploaded files.

### Documentation

- Add separate installation, unpacked-update, packaging, and Web Store update
  guides. Correct delivery defaults, overwrite behavior, session-token handling,
  and the distinction between source builds and published releases.

### Verification status

- Local verification build. The upload request and response contract was
  captured from a successful manual download. A fresh extension export saved
  the uploaded document with identical bytes to the manual reference and
  preserved all 218 conversation role blocks. Generated-file lookup failures
  and redundant missing-button warnings remain open.

## [1.6.4] — 2026-09-24

### Fixed

- Resolve explicitly offered sandbox files before intermediate paths found in
  technical messages. When a later reply offers an earlier-created path, promote
  it and retain the offering message's identifier.
- Use the message context carried by each API file instead of retrying unrelated
  message identifiers. Panel-only paths retain their fallback lookup.
- After a scan, explicit API links no longer wait for an absent viewer panel.
  Other layouts retain the bounded late-panel wait.

### Diagnostics

- Distinguish missing URLs, rejected URLs, unreadable JSON and request failures
  even when an endpoint returns HTTP 200. Include rejected hostnames only, never
  the full signed addresses, in incomplete-export diagnostics.
- Local verification build; automatic retrieval on the reported conversation
  still requires a new export before this issue can be called resolved.

## [1.6.3] — 2026-09-24

### Fixed

- Do not retry the same message identifier repeatedly for one unavailable file.
- Preserve already-resolved attachment links when a later lookup times out, so
  the downloader can still save those files beside the conversation.

### Diagnostics

- Incomplete lookups include their stage, request/status counts, candidate count
  and resolved count in the local Markdown. Diagnostics contain no request
  URLs, headers, response bodies, session tokens or signed links.
- This local build provides targeted fixes and evidence for the unresolved
  attachment issue. Successful manual download proves file availability, but
  automated retrieval on the reported conversation still needs verification.

## [1.6.2] — 2026-09-24

### Changed

- Enable **Save .md + files to chatgpt-export/** by default whenever the popup
  opens. Uncheck it to copy Markdown to the clipboard without downloading files.
- This local build changes the default selection only. Attachment lookup
  failures remain unresolved; the export preserves text and reports missing
  files as described in 1.6.1.

## [1.6.1] — 2026-09-24

### Fixed

- Stop invoking page-owned download buttons from the isolated content script.
  Those handlers could download a lone archive or patch outside the export
  folder; replacing the content script's JavaScript methods cannot intercept
  the page's download routines. API-resolvable files still use the existing
  retrieval path; unresolved button labels are retained as explicit warnings.
- Bound attachment lookup to 30 seconds after the text scan. If lookup fails or
  hangs, preserve the captured conversation and report incomplete files instead
  of losing the Markdown. Incomplete file lookup is not banked as a completed
  batch export.

### Verification and limitations

- Regression tests exercise page-owned handlers separately from the content
  script and a lookup that never settles, including after cancellation.
- This is a local verification build. The reported live conversation must be
  exported again before this issue can be called resolved. Uploaded-file
  retrieval and duplicate file links are not changed by this release.

## [1.6.0] — 2026-09-24

### Fixed

- Resume stalled history pagination by moving an idle pagination sentinel out of
  view and returning to the top. Active loading is left undisturbed, and the
  failure budget is not extended by repeated movement.
- Recognize both observed completed pagination layouts, including an empty root
  sibling. Confirm the beginning only when the sentinel is absent and the first
  real message holder has its turn mounted at the top.

### Verification and limitations

- A live long-conversation export preserved all 207 turns of its historical
  reference, with 11 additional turns. A later export saved its conversation,
  five documents and an intact archive; the five documents matched the archive
  contents byte for byte.
- This release does not change attachment retrieval. Uploaded-file omissions,
  duplicate file links and interrupted attachment exports remain unresolved.
- Version 1.6.0 identifies the local verification build. Store publication is a
  separate step; this entry does not claim that the store has been updated.

## [1.5.8] — 2026-09-14

### Fixed

- **The start-of-conversation check read the marker off the wrong element, and
  1.5.7 shipped it silently truncating exports.** The first export after 1.5.7
  began 82% into its conversation, mid-sentence, with no partial notice at all —
  worse than the defect 1.5.7 set out to fix.

  Two mistakes, compounding. The page marks the root of pagination on a
  CONTAINER, not on the turn:

  ```html
  <div data-turn-id-container="paginated-root:<conversation id>">
    <section data-turn-id="bbb21ebf-…" data-turn-id-container="bbb21ebf-…">
  ```

  Reading that attribute off the `[data-turn-id]` element returns the section's
  OWN id, never the marker, so the new arrival check could not return true on
  any real page and every climb fell through to the timing guess it was written
  to replace. And the same change had relaxed the partial-export notice to any
  quiet climb — a condition that was now always met — so the truncation came out
  unannounced. Removing the warning without fixing the cause is the worse half:
  a user cannot even know to re-run.

  The marker is now found by walking up the turn's ancestors, and by matching
  the document's marker container against the first mounted turn. The relaxation
  is narrowed to pages that publish no marker AT ALL; a page that has one and was
  not reached is a truncated export and says so.

  | fixture (real markup shape) | result |
  |---|---|
  | already at the start | confirmed in 1 round |
  | long climb, history still arriving | confirmed after 26 rounds |
  | marker present, climb never reached it | flagged partial |

- **The simulator had been built to the same wrong assumption, so it validated
  the broken code.** Its fixture put the marker on the turn — my belief about
  the page, not the page — and reported a clean climb throughout. Rebuilt to the
  measured shape, it separates the two: the reconstructed 1.5.7 code reports
  `reachedTop: false` on every run, the fix reports `true` with zero turns lost
  at fetch delays up to 4 s and thread lengths up to 3000 turns.

- **The climb could run forever, holding the tab open with no export and no
  error.** Removing the fixed round ceiling in 1.5.7 left the loop with no exit
  for a page that keeps LOOKING like progress: a first turn id that changes
  every round resets the patience budget indefinitely while the marker never
  matches, and a re-rendering list produces exactly that. Found by mutation
  testing — the mutant did not terminate — and reproduced against the unmutated
  code, so it is a real defect rather than an artefact.

  The ceiling is back, but measured in TIME (10 minutes) rather than in rounds,
  because rounds cap the conversation's length and seconds do not: the 3000-turn
  simulator run still completes in 1000 rounds with zero turns lost. It is
  checked last, so a climb that would finish always does, and a climb it stops
  reports a partial export rather than silence.

- **Five ways to break the marker check went undetected by the test suite.**
  Mutation testing found every fixture satisfied both recognition paths at once,
  so disabling either stayed green — including the exact defect that shipped.
  Five tests added, each leaving one path able to answer: the ancestor walk, the
  marker-container match, node identity for an attribute-less turn, two
  different id-less turns not being called the same turn, and asking the
  DOCUMENT rather than the first turn whether the page publishes a marker.

## [1.5.7] — 2026-09-14

### Fixed

- **A slow connection silently truncated the start of a conversation.** The
  climb to the beginning stopped on SILENCE — three rounds of 400ms with an
  unchanged first turn at position zero. A history fetch slower than that looks
  exactly like the end of the thread: the first turn id does not change because
  the next page has not arrived, and scrollTop is already zero because ChatGPT
  holds the viewport still while prepending. Both arrival conditions were
  satisfied by a page that was merely waiting for the network. A real export
  lost 299 lines — 11% of the conversation, its opening question included — and
  carried no partial notice.

  Measured by running the real `scrollToConversationStart` against a simulated
  virtualized page, so the delay is exact rather than incidental:

  | history fetch delay | turns lost, silently |
  |---|---|
  | 1200 ms | 0 |
  | 1300 ms | 12 |
  | 1700 ms | 132 of 142 |

  The threshold is this function's own arithmetic: `stableRounds(3) x
  settleMs(400) = 1200 ms`. Arrival is now a POSITIVE FACT — the first mounted
  turn sits in the container the page marks `paginated-root:<conversation id>`.
  Absence of that fact means keep climbing, however long the silence lasts,
  which is exactly what a slow link needs. Zero turns lost at every delay
  measured, up to 8 seconds per fetch.

- **The round ceiling was a length limit on the conversation in disguise.** The
  climb needs about one round per three turns (measured: 142 -> 45, 600 -> 200,
  3000 -> 1000), so any fixed budget caps the thread it can reach. At the
  retired ceiling a 1200-turn conversation stopped 290 turns short — and 1146
  turns is a real, previously measured size. The budget now derives from the
  work: a climb ends when it stops producing history, not when a counter runs
  out. 3000 turns arrive with zero loss.

- **A page without the start marker cost 16.4 seconds of every export.** The
  full patience budget was spent waiting for a marker that a layout without one
  will never show (measured: 41 rounds x 400 ms). "Not there yet" and "not a
  thing here" are now distinguished by whether the attribute exists at all —
  2.8 seconds instead of 16.4.

- **A page without the marker no longer reports a false partial export.** Such a
  page can still satisfy the old quiet-at-the-top criterion, which is all that
  layout can offer; flagging it partial would stamp "your data is
  untrustworthy" on every complete export the moment ChatGPT renames an
  attribute. The three outcomes — confirmed by marker, quiet without a marker,
  and genuinely still moving — are kept apart, because collapsing any two of
  them has already shipped a defect in one direction or the other.

- **Generated archives were never fetched, through five releases of fixing the
  wrong layer.** A conversation's `.zip` and `.diff` were named in the export
  and never downloaded. Every reader looked somewhere the paths are not:

  | reader | looked in | found |
  |---|---|---|
  | attachment chips | the DOM | nothing — the buttons carry no `href` |
  | `sandboxFilesFromMarkdown` | the exported markdown | nothing — **zero** `/mnt/data` occurrences in the file |
  | artefact panel | the panel rows | only the `.md`/`.txt` siblings — a `.zip` has no viewer, so it gets no row |
  | `fetchConversationArtifacts` | `metadata.attachments`, `part.asset_pointer` | nothing — interpreter output is neither |

  The paths were in the API response the extension **already downloads on every
  export**, written in the message text as bare paths, and that text was never
  read. Measured on the failing conversation: all six generated files appear
  there, and all six resolve through the endpoint the panel files already use.

  Two separate reasons the old code could not see them, both fixed:
  the paths are **bare** (`/mnt/data/x.zip`), while the pattern required the
  `sandbox:` scheme; and they live in messages — including the `tool` role —
  that never reach the markdown, so no pattern applied to the exported text
  could have matched regardless of how it was written.

  Files now arrive without a click. Clicking remains as a fallback, and is
  skipped for anything already resolved.

- **The same archive was about to be downloaded twice.** The exclusion that
  stops a resolved file from being clicked compared the label to the file name
  by substring, and the two spell the same name differently: the file is
  `canon-consilium-prompt-bundle-v1.zip`, the button says "Скачать готовый Canon
  Consilium Prompt Bundle v1" — hyphens against spaces, so the match failed.
  Both sides are now folded to a common form before comparing. Unfixed, the new
  API path would have fetched the bytes AND clicked the button, re-opening the
  viewer-over-panel regression the exclusion exists to prevent.

### Notes

- A path stated by the **user** is not fetched: it is a request, not a produced
  file, and asking the backend for one costs a request per mention to be told
  there is no such file. Covered by a test with a positive control — the same
  sentence from the assistant IS collected, so the empty result proves the role
  check rather than a pattern that matches nothing.

- Success is the presence of a `download_url`, **never** the HTTP status.
  Measured: a path for a file that does not exist answers `200` with no link.
  A status check would have reported success for any nonsense path.

## [1.5.6] — 2026-09-13

### Changed

- **One walk instead of two.** The scan already traverses the whole
  conversation; the download buttons are now collected on that same walk,
  alongside the turns and the artefact rows, instead of by a second traversal
  afterwards. A button found while scrolled away stays clickable — the click
  path calls `scrollIntoView` on it first — so the second pass bought nothing.
  It remains only as a fallback for callers that did not walk.

### Fixed

- **Files offered in the first reply were never fetched.** The second traversal
  ran only when the post-scan page showed ZERO download buttons, and "found
  nothing here" is not the same question as "found the right thing". Measured on
  a live thread: the landing position held 2 `behavior-btn` nodes, both editing
  suggestions ("Make the opening more concrete", "Clarify what Canon Arcana
  stores"), neither a download. Two was not zero, so the traversal never ran —
  and all 5 real download buttons, including the `.zip` and the `.diff`, were
  never seen. Collected during the walk there is no guard left to get wrong.

- **An empty list of buttons was read as "no list given".** `opts.buttons || …`
  treats `[]` as absent, so a walk that legitimately found nothing would trigger
  a full second traversal to reach the same answer.

### Known limit

- The panel-exclusion that keeps an already-resolved file from being clicked
  matches the label against the panel's file name as a substring, and does not
  normalise separators: a button labelled "Скачать полное ТЗ Canon Arcana v0.3"
  does not match the row `Canon_Arcana_Consilium_Context_Selection_TZ_v0.3.md`,
  so it is still clicked. That has always been true. The cost is one viewer
  dismissal, which the click path already handles; it is recorded rather than
  tightened without a measurement to aim at.

## [1.5.5] — 2026-09-13

### Fixed

- **The scan began in the middle of the conversation, and everything above it
  was lost.** A conversation loads its history in chunks, so a single
  `scrollTo(0)` does not reach the beginning: measured on a live thread, the
  smooth scroll settled at **2850 of 0** while `scrollHeight` SHRANK
  **6900 → 5750** mid-flight, because the virtualizer unmounted the turns above
  as the page moved. The scan then walked DOWN from 2850 and never saw the top
  of the thread. A 126KB conversation exported as **26KB** — 542 lines of 2733,
  0 section headings of 48 — carrying only the last turn's attachment, while the
  `.zip` and `.diff` offered in the FIRST reply were never on screen for the
  button-click path to find.

  No gap was detectable between the scan's bands because the hole was not
  between them: it was before the first one. The existing blind-tail check
  caught it and the artifact said `coverage gap`, which is how the defect was
  found at all.

  The scan now climbs to the start repeatedly, and treats arrival as **two**
  conditions rather than one: at position zero AND the first turn has stopped
  changing. Either alone lies — position 0 on a thread still prepending history
  is not the beginning, and a steady first turn at position 40000 is a stalled
  scroll. Three strategies were measured on the same page: smooth-then-jump
  ended at 46368, climbing a screen at a time at 48988, repeated jumps arrived
  in **4 rounds** and held. Across that run the document grew 6900 → 53335 →
  55775 — roughly 8x — which is why one jump plus a fixed wait cannot work.

  Failing to arrive does not abort the export; it is reported as partial, since
  a flagged partial beats nothing at all.

- **A later failure overwrote the reason for an earlier one.** A scan that never
  reached the start also tends to stall afterwards, and the stall replaced the
  real cause — so the artifact told the user "stall" while hiding why. The first
  reason is now kept.

## [1.5.4] — 2026-09-13

### Fixed

- **The artefact panel is nested inside a turn, so it is virtualized with it.**
  Three releases in a row tried to fix a missing file by reading the panel
  better — later, longer, as a union. All three read it at the WRONG MOMENT. The
  live markup settles it:

      <div class="…agent-turn">
        <div data-message-author-role="assistant" …>
        <div class="w-full max-w-[480px]">      <- the artefact panel

  The rows are not a sidebar. A row exists only while its own turn is mounted,
  and the scan restores the original scroll position when it finishes, so every
  read after the scan sees whichever turn happens to be on screen. That is the
  whole explanation for the two different sets of four: the panel showed
  TZ-01..TZ-04 and the export carried `arcanada_talomnia_89_articles_narratives.md`
  plus TZ-02..TZ-04, because they were read at two different scroll positions.

  Artefact rows are now harvested **during** the scan, at every position it
  holds, while the turns there are mounted. A failing collector cannot end a
  scan — the turns are the expensive, unrepeatable part. The post-scan panel
  read is kept and merged, so a conversation whose panel really is a sidebar
  keeps working unchanged.

## [1.5.3] — 2026-09-13

### Fixed

- **The artefact panel is read as a union of frames, because it gets replaced.**
  1.5.2 waited for the row COUNT to settle and fixed nothing: the next export
  came back byte-identical (`543df995…`), still missing
  `TZ-01_Arcanada_Ecosystem_Project_Cards.md`. Measuring the live page explained
  why — the panel on screen held TZ-01..TZ-04 while the export held
  `arcanada_talomnia_89_articles_narratives.md` plus TZ-02..TZ-04. **Two
  different sets of four.** The panel does not only grow as it renders, it is
  swapped for another set as the page settles, and a same-size swap looks
  perfectly stable to a count-based wait.

  Every polled reading is now merged by file name, so a row seen in any frame
  survives the frame that drops it. The asymmetry is deliberate: a stale extra
  name costs one failed resolve, which is reported as unresolved, while a
  dropped name costs a file the user is never told about — this one went
  unnoticed for a day and was fetched by hand.

## [1.5.2] — 2026-09-12

### Fixed

- **A file in the artefact panel was dropped when it mounted a frame late.**
  Measured on a production conversation: five files in the panel, **four
  exported**, `TZ-01_Arcanada_Ecosystem_Project_Cards.md` missing — and missing
  silently. It appeared nowhere in the markdown: not as a link, not under
  "Could not retrieve", not even by name. The numbering gave it away, TZ-02
  through TZ-04 present with TZ-01 absent, and the user downloaded it by hand.

  The panel wait returned on the **first row** it saw, and ChatGPT mounts the
  rows progressively, so every row rendering a frame later was never read.
  Reproduced on a fixture before the fix: one poll, 1 file of 3, and the row
  that mounts late is the one lost. The wait now continues until the row count
  stops growing, with a transient shrink treated as a re-render rather than as
  proof a file vanished. A conversation with no panel still costs one poll.

## [1.5.1] — 2026-09-10

### Added

- **The popup shows the running version.** Four builds were installed in a row
  carrying the same `1.5.0`, with no way to tell from the browser which one was
  actually loaded — an unnecessary doubt during verification. The number is read
  from the manifest, never typed twice, and every fix from now on moves the patch
  version so a reload is visible.

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

- **The buttons were searched for at the one moment they are not there.**
  Measured on the 16:51 export: **zero** buttons found and **no `## Files`
  section written at all**, on a conversation that demonstrably carries eight of
  them. The cause was ordering, not selection. This pass runs after `scanTurns`,
  whose `finally` restores the original scroll position, so ChatGPT's virtualizer
  has unmounted every turn outside the viewport — an earlier probe measured 5 of
  8 turns present in a static DOM for exactly this reason. The feature was dead
  on any conversation longer than one screen, which is every conversation that
  generates files. Buttons are now collected by scrolling the conversation, the
  way the probe found them, and the scroll position is restored afterwards.

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
  **`AGENTS.md`** — the working rules for this repository, both coupled to the
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
