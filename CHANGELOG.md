# Changelog

All notable changes to Conversation to Markdown are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.0] — 2026-08-17

Release-readiness pass. Two independent adversarial audits of 1.5.0 — one on DOM
and resume correctness, one on Web Store compliance — found five defects that the
87-test suite passed clean. Every one of them was a **silent** failure: the popup
reported success while files were missing, truncated or unreadable.

### Fixed

- **A conversation is no longer skipped because another one shares its title.**
  Resume identified conversations by their title-derived slug, so duplicate
  titles — ordinary inside a Project, and "Untitled" especially — collapsed onto
  one key. Interrupting a run after the first landed made every later namesake be
  skipped **forever** as "already exported". Resume now keys on the conversation
  id, which ChatGPT guarantees unique, and the id is recorded in the batch
  filename so a resumed run can recover it. Files written by earlier versions are
  still recognised, so upgrading does not re-download an archive.
- **A write Chrome refused is no longer counted as a saved conversation.** The
  download result was discarded, so a run whose every write was rejected reported
  the whole project as exported — zero files on disk, "40 saved" on screen.
  Failed writes are now reported per conversation.
- **A conversation titled `..` no longer breaks the entire export.** The slug
  becomes a directory name, and Chrome rejects any download path containing a
  `..` back-reference, so one such title made every write in the run fail. A
  dot-only title now falls back to a generated name.
- **A truncated export is no longer banked as complete.** When a scan stalled, the
  partial file was recorded as done, so re-running — the one action that could
  repair it — skipped it as "already exported". Partial exports are now reported
  and left pending.
- **Cyrillic filenames survive extraction from the zip.** Names were written as
  UTF-8 bytes but the header flag declaring so was never set, so extractors fell
  back to code page 437 and Russian titles unzipped as mojibake.
- **Resume recognises its own files when the date-time stamp is enabled.** The id
  appended to a batch filename was parsed with a pattern that matched backwards
  across its own separator, so with the stamp on — and for any title containing a
  double dash — the id came back wrong and every run re-downloaded the entire
  archive.
- **A `~` in a conversation title becomes `-` in the saved filename.** The character
  now marks where the conversation identifier begins, so a filename written by this
  version can never be confused with one written by an earlier version — which is what
  made resume skip conversations it had never saved.
- **Resume no longer guesses which conversation a file belongs to.** It reconstructs
  the exact names each conversation would have written and looks for those. Reading a
  name to work out its owner failed in several ways, all with the same consequence —
  a conversation skipped though it had never been saved. The clearest example: a chat
  titled "Budget - draft" produces the file name `Budget---draft.md`, whose tail is a
  valid conversation id, so it was read as belonging to a different chat entirely. A
  name that more than one conversation could have produced is now treated as evidence
  about none of them.
- **A truncated export can be repaired by running again.** Previously the incomplete
  file was recognised as finished on the next run, so the one action that could fix it
  was refused. Such a file is now marked as partial in its name, not only inside it.
- **A conversation whose id merely looks like a date is no longer mistaken for an
  older export.** ChatGPT ids may consist of digits and dashes, so an id can be
  shaped exactly like a timestamp; such a file was misread as coming from an earlier
  version, and a different conversation sharing its title was then skipped without
  ever being saved. Files are now matched against the ids of the conversations
  actually being exported rather than by how their names look.
- **A file written by an earlier version is trusted only when it is unambiguous.**
  Older exports carry no conversation id, so they can only be recognised by title —
  and when two conversations share that title, which one the file belongs to is
  unknowable. Guessing skipped a conversation that had never been saved. Now such a
  file is trusted only when exactly one conversation claims its title; otherwise
  both are exported again. An archive from an older version is still recognised, so
  updating does not re-download everything.
- **An interrupted archive is no longer reported as saved,** and the archive is
  given a write budget long enough that a large one is not abandoned — and its
  data released — while the browser is still reading it.
- **A large archive is no longer lost to a URL length limit.** The zip was handed
  to the browser as a `data:` URL, which Chrome caps at a couple of megabytes — so
  the one workload the zip exists for was the one that would fail. It is now
  passed by handle. The writer also refuses, loudly, an archive with more entries
  or more bytes than the zip format can address, rather than emitting a corrupt
  file that reports no error.

### Changed

- **The caveats now appear while the choice is still a choice.** Ticking the batch
  option immediately shows that the popup must stay open, and — when files are not
  being saved — that attachment links in the Markdown expire within hours. Both
  were previously revealed only after the run had been started.
- **`activeTab` permission removed.** It was never load-bearing: `scripting` is
  authorised by the declared host permissions. It was also misleading — an
  `activeTab` grant is revoked on navigation, and a batch export navigates the
  tab deliberately. Fewer permissions, identical behaviour.
- **The store description and privacy statement now describe what the extension
  actually does** — batch export across a Project, artifact downloads, the zip,
  and the fact that resume reads download history to find what already landed.

### Verification

See `MUTATION-EVIDENCE.md` § Wave 3 and § Wave 3b through § Wave 3g. Each fix was mutated away and
the test written for it went red, with the exit code read from the test run itself.

Wave 3b is worth reading on its own: the Wave 3 fix was handed to a fresh
adversarial reviewer, which found two blockers **in the fix**, both of the same
silent-loss class it was written to remove. A fix that closes such a defect can
reopen it through its own compatibility path.

## [1.5.0] — 2026-08-17

### Added

- **Pause and resume a batch run.** A full-project export is a long job; the
  popup now carries a **Pause** control that holds the run between
  conversations and inside a retry wait, and continues exactly where it stopped.
  Cancelling still keeps everything already written — pausing is not cancelling.
- **Transient failures are retried with backoff** (1s, 2s, 4s, capped at 8s)
  before a conversation is written off, with a finite attempt budget reported in
  the summary.
- **A dropped network holds the run instead of consuming it.** Offline and
  site-unreachable conditions are told apart from a genuine per-conversation
  error, so a 40-conversation export no longer fails 39 more times because the
  connection went away for a minute. The wait budget is finite and reported.
- **The summary now reports `retried` and `networkWaits`** alongside exported,
  skipped and failed. A conversation skipped because it was already on disk is
  not a failure, but silence about it reads as success.

### Fixed

- **Resume actually resumes.** `chrome.downloads.search` reports a full path
  under the user's Downloads folder while the batch built a relative one, so the
  "already downloaded?" lookup could never match and a restarted export
  re-downloaded everything. Completion is now keyed on the conversation folder
  and stem, with any date-time stamp stripped, so a run started after a
  timestamped export still recognises what landed. Path separators of either
  platform are handled.

### Verification

See `MUTATION-EVIDENCE.md` § Wave 2e.

## [1.4.0] — 2026-08-17

### Added

- **Project batch export.** Export every conversation listed in the sidebar of the
  active ChatGPT tab, one folder per conversation under
  `chatgpt-export/<project>/`, without adding permissions or a service worker.
  The popup must stay open for the run; progress shows `n of N — title`.
- **Resumable batch runs.** Prior exports are detected via
  `chrome.downloads.search` (no `chrome.storage`); restarting skips
  conversations whose `.md` already landed.
- **Batch zip archive.** A minimal STORE-method zip writer bundles every
  exported folder into one `.zip` at the end of a batch run.

### Changed

- **Attachments keep their own filename.** A document offered in a conversation
  as `report.pdf` or `Договор.docx` is saved under that name (behind an index,
  e.g. `Chat-001-report.pdf`) instead of an anonymous `file_001.pdf`. Names are
  sanitized for the Downloads folder, and a compound extension such as
  `.tar.gz` is no longer truncated to `.gz`. Images keep the numbered scheme,
  because an image label is alt text rather than a filename.

### Verification

See `MUTATION-EVIDENCE.md` § Wave 2b and § Wave 2c.

## [1.3.0] — 2026-08-17

### Added

- **File attachment export.** Attachment chips (`data-testid="file-chip"`,
  fixture-derived selector) emit Markdown links and download through the same
  content-script fetch path as images. `parseArtifactRefs` enumerates both image
  and file links from the saved Markdown.
- **Visible placeholders** for `canvas`, `audio`, `video`, and inline `svg`
  artifacts that previously produced silent empty output.
- **Sandbox Code Interpreter links** are preserved in the Markdown as visible
  blockquotes — the real download URL cannot be derived without a live page.

### Fixed

- **KaTeX double emission.** The hidden `.katex-mathml` layer is skipped so
  formulas export once, from `.katex-html`.

### Verification

Each behaviour is covered by a test verified through mutation — delete the fix,
the test must fail. See `MUTATION-EVIDENCE.md` § Wave 2a.

## [1.2.0] — 2026-08-17

### Added

- **Timestamped re-export.** A checkbox writes each export to
  `<slug>--YYYYMMDD-HHMM.md` so re-exporting never silently creates
  `name (1).md` files. `conflictAction: 'overwrite'` is set explicitly on
  every download.

### Fixed

- **Stop no longer discards captured turns.** Cancelling or hitting a scan
  stall returns whatever was already held in memory. The saved Markdown carries
  a `> **Partial export**` notice in the artifact itself — not only in the
  popup status line.
- **Markdown download is awaited** so the popup cannot report success before
  the file write finishes.

### Verification

Each fix is covered by a test verified through mutation — delete the fix, the
test must fail.

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
