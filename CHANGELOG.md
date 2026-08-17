# Changelog

All notable changes to Conversation to Markdown are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
