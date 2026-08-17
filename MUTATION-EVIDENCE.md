# Mutation evidence — C2M-0003 wave 1 (v1.2.0)

Method: `set +e; npm test >/tmp/m.txt 2>&1; echo "EXIT=$?"` (never read exit
code after a pipe). Each row is one mutant applied to the tree, then the full
suite run unless noted.

Baseline before mutations: **57 pass, 0 fail, EXIT=0**.

## A. Partial export on stall

| Field | Value |
| --- | --- |
| **Edit** | In `content.js` `scanTurns`, replace the stall guard body with `throw new Error('Scan stalled');` — remove `markPartialScan(settings, 'stall')` and `return orderCapturedTurns(seen)`. |
| **Test that went red** | `a stalled scan returns partial turns with a notice in the artifact` |
| **EXIT** | **1** |

## B. Partial export on operator cancel

| Field | Value |
| --- | --- |
| **Edit** | In `content.js` `scanTurns`, replace the `isCancelled()` branch with `throw new Error('cancelled');` — remove `markPartialScan` and `return orderCapturedTurns(seen)`. |
| **Test that went red** | `the operator can cancel a scan and keep whatever was captured` |
| **EXIT** | **1** |

## C. Partial export on step-limit (test-only path)

| Field | Value |
| --- | --- |
| **Edit** | In `content.js` `scanTurns`, delete the `if (seen.size > 0) { markPartialScan(..., 'step limit'); return orderCapturedTurns(seen); }` block before the step-limit `throw`. |
| **Test that went red** | `still times out when a reachable scroll target is never approached` |
| **EXIT** | **1** |

**Contract change (explicit):** this test previously asserted `assert.rejects(..., /step limit/)` — scan must throw and discard captured turns. The operator now requires the opposite: a step-limited scan with captured turns returns a partial export (`scanMeta.partial === true`, reason matches `/step limit/`). The test was rewritten accordingly; this mutation proves the new guard.

## D. Partial notice in the markdown artifact

| Field | Value |
| --- | --- |
| **Edit** | In `content.js`, change `prefixPartialNotice` to `return md;` (drop the `> **Partial export**` prefix). |
| **Tests that went red** | `prefixPartialNotice labels the markdown artifact itself`; `a stalled scan returns partial turns with a notice in the artifact` (artifact assertion) |
| **EXIT** | **1** |

## E. `conflictAction: 'overwrite'` on downloads

| Field | Value |
| --- | --- |
| **Edit** | In `popup.js` `downloadOne`, remove `conflictAction: conflictAction \|\| 'overwrite',` from the `chrome.downloads.download` options object. |
| **Tests that went red** | `sets conflictAction explicitly so Chrome does not uniquify to (1).md`; `timestamp checkbox produces a stamped filename for re-export` (also asserts `conflictAction`) |
| **EXIT** | **1** |

## F. Timestamped re-export filename

| Field | Value |
| --- | --- |
| **Edit** | In `popup.js` `buildMdFilename`, replace the `useTimestamp` branch with `return base + '.md';` always. |
| **Test that went red** | `timestamp checkbox produces a stamped filename for re-export` |
| **EXIT** | **1** |

## G. Unexpected errors must not launder into partial export

| Field | Value |
| --- | --- |
| **Edit** | In `content.js` `scanTurns`, restore the broad `catch (error) { if (seen.size > 0) { markPartialScan(...); return orderCapturedTurns(seen); } throw error; }` around the scan loop (replaces the narrowed step-limit-only path). |
| **Test that went red** | `an unexpected scan error propagates even when turns were captured` |
| **EXIT** | **1** |

## H. Popup accepts partial scan success

| Field | Value |
| --- | --- |
| **Edit** | In `popup.js`, change `if (!result.ok)` to `if (!result.ok \|\| result.partial)` so partial exports are treated as errors again. |
| **Test that went red** | `writes a partial export to the clipboard instead of showing an error` |
| **EXIT** | **1** |

## Not run — no red test observed

| Behaviour | Reason |
| --- | --- |
| **Await markdown `downloadOne` before reporting success** (`popup.js` ~line 235) | Mutant: remove `await` before the final `downloadOne` for the `.md` file. Full suite stayed **57 pass, EXIT=0**. No test exercises ordering between download completion and popup status; omitted rather than fabricated. |
| **`getConversationMarkdown` calls `prefixPartialNotice` when `scanMeta.partial`** | No dedicated integration test hits that line in isolation; covered indirectly via **D** (`prefixPartialNotice` itself) and stall/cancel tests that call the helper explicitly. |

## Wave 2a

Baseline before mutations: **66 pass, 0 fail, EXIT=0**.

### A. File attachment chip in `nodeToMarkdown`

| Field | Value |
| --- | --- |
| **Edit** | Remove the `if (isAttachmentChip(node)) { … }` block from `nodeToMarkdown`. |
| **Test that went red** | `names an attachment chip that carries no link` |
| **EXIT** | **1** |

**This mutant SURVIVED when first measured, and the gap was real rather than mere
redundancy.** Every chip fixture in the suite wrapped an inner `<a href>`, so removing
the branch still exported the file through `case 'a'` and nothing went red. But the
branch also handles two paths that `case 'a'` cannot reach: a chip with no resolvable
href (falls to `labelFromAttachmentChip`) and a chip whose href uses the `sandbox:`
scheme. Without it, a linkless chip degrades to bare text and the reader is never told
a file was attached — silent loss of exactly the kind this task exists to remove.
A test for the linkless chip was added (`tests/content.test.js`), and re-running the
same mutation now yields **EXIT=1** on that test. Turn-level capture remains isolated
in **F** below.

### B. Sandbox Code Interpreter links

| Field | Value |
| --- | --- |
| **Edit** | Delete the `href.startsWith('sandbox:')` branch inside `case 'a'`. |
| **Test that went red** | `preserves sandbox Code Interpreter links visibly in markdown` |
| **EXIT** | **1** |

### C. Media placeholders (`canvas`, `audio`, `video`, `svg`)

| Field | Value |
| --- | --- |
| **Edit** | Replace `artifactPlaceholder(...)` returns for `canvas`, `audio`, `video`, and `svg` with `return ''`. |
| **Test that went red** | `emits visible placeholders for silent-loss media elements` |
| **EXIT** | **1** |

### D. KaTeX double emission

| Field | Value |
| --- | --- |
| **Edit** | Remove the `isKatexMathml` / `isKatexRoot` guards at the top of `nodeToMarkdown`. |
| **Test that went red** | `renders KaTeX once by skipping the hidden MathML layer` |
| **EXIT** | **1** |

### E. Non-image download enumeration

| Field | Value |
| --- | --- |
| **Edit** | In `parseArtifactRefs`, return `parseImageRefs(md)` only — drop the `parseFileRefs` concat. |
| **Test that went red** | `downloads non-image attachment files alongside images` |
| **EXIT** | **1** |

`parseFileRefs` itself is exercised directly in `parseFileRefs collects downloadable attachment links but not arbitrary URLs`; that test stays green because the function is unchanged — only the popup download path stops calling it.

### F. Turn-level attachment extraction

| Field | Value |
| --- | --- |
| **Edit** | Replace `extractAttachments` with `function extractAttachments(section) { return []; }`. |
| **Tests that went red** | `extracts file attachment chips outside the prose container`; `includes user-uploaded attachments in the turn markdown` |
| **EXIT** | **1** |

### Fixture-derived selectors (not live-verified)

| Selector / assumption | Used for |
| --- | --- |
| `[data-testid="file-chip"]` | Attachment chip discovery in `extractAttachments` and `isAttachmentChip` |
| Inner `a[href]` inside the chip | Resolving download URL and label |
| `.katex` / `.katex-mathml` / `.katex-html` | KaTeX deduplication (standard KaTeX DOM, not re-checked on live ChatGPT) |

## Wave 2b

Baseline before mutations: **78 pass, 0 fail, EXIT=0**.

### A. Sidebar conversation enumeration

| Field | Value |
| --- | --- |
| **Edit** | Replace `listSidebarConversations` with `function listSidebarConversations() { return []; }`. |
| **Test that went red** | `lists every sidebar conversation link once` |
| **EXIT** | **1** |

### B. Batch resume filter

| Field | Value |
| --- | --- |
| **Edit** | Replace `filterPendingConversations` body with `return conversations;` (never skip completed paths). |
| **Test that went red** | `filterPendingConversations skips paths already downloaded` |
| **EXIT** | **1** |

### C. Per-conversation progress label

| Field | Value |
| --- | --- |
| **Edit** | Replace `formatBatchProgress` with `function formatBatchProgress() { return 'Scanning conversation…'; }`. |
| **Test that went red** | `formatBatchProgress shows n of N and the current title` |
| **EXIT** | **1** |

### D. STORE zip writer

| Field | Value |
| --- | --- |
| **Edit** | In `buildStoreZip`, write `0x00034b50` instead of `0x04034b50` for the local header signature. |
| **Test that went red** | `buildStoreZip writes the local-file magic bytes` |
| **EXIT** | **1** |

### E. Batch zip download

| Field | Value |
| --- | --- |
| **Edit** | In `runBatchExport`, delete the `if (zipEntries && zipEntries.length > 0 && typeof buildStoreZip === 'function') { … }` block. |
| **Test that went red** | `batch mode reports per-conversation progress and writes a zip archive` |
| **EXIT** | **1** |

### F. Navigation readiness gate

| Field | Value |
| --- | --- |
| **Edit** | Replace `waitForConversationReady` with `function waitForConversationReady() { return Promise.resolve({ ready: true }); }` always-ready stub — then change it to `return Promise.resolve({ ready: false, error: 'stub' });`. |
| **Tests that went red** | `waitForConversationReady resolves when message content mounts`; `waitForConversationReady times out when navigation never arrives` |
| **EXIT** | **1** |

### Fixture-derived selectors (not live-verified)

| Selector / assumption | Used for |
| --- | --- |
| `nav a[href^="/c/"]` | Project sidebar conversation list in `listSidebarConversations` |
| `aria-label` / `.truncate` on sidebar links | Conversation titles (shared with `titleFromSidebarLink`) |
| `[data-turn-id]` / `[data-message-author-role]` | `waitForConversationReady` content gate |

## Wave 2c — attachment filenames

Operator question, 2026-08-17: "there can be archives, PDFs, Word documents —
we should be able to download all of that, right?" Answer measured on the real
code rather than reasoned about: yes. Downloadability is gated by HOST
(`isDownloadableFileUrl`, popup.js) — `files.oaiusercontent.com` plus the
`/files/` and `/estuary/` paths on chatgpt.com — and never by file type, so PDF,
ZIP, DOCX, XLSX, PPTX and CSV all pass by construction; bytes move as
`application/octet-stream`. Probing the shipped function confirmed each type,
including a Cyrillic name, and confirmed that a URL on an unrelated host is
correctly refused.

Two real defects surfaced from that probe, both fixed here.

**(1) The original filename was thrown away.** The link label — which for a
document IS its filename — was used only to extract an extension, so
`Договор.docx` landed as `Chat-file_001.docx`. In a batch export of many
conversations every attachment became an indistinguishable numbered stub. Now a
document keeps its own name behind the index (`Chat-001-Договор.docx`), while
images stay numbered because their label is alt text, not a filename.

**(2) `archive.tar.gz` became `.gz`**, misstating what the file is. Fixed as a
by-product of (1): the stem now keeps everything before the last dot, so the
compound extension recombines intact.

### A. Original document name preserved

| Field | Value |
| --- | --- |
| **Edit** | In `artifactFilename`, delete the `if (originalStem) { return prefix + counter + '-' + originalStem + '.' + ext; }` branch so every artifact falls back to the numbered stub. |
| **Tests that went red** | `keeps the original document name and a compound extension`; `downloads non-image attachment files alongside images` |
| **EXIT** | **1** |

### B. Path separators cannot survive into a download filename

| Field | Value |
| --- | --- |
| **Edit** | In `sanitizeFilenamePart`, remove the `.replace(/[\\/]+/g, '-')` step. |
| **Test that went red** | `never lets an attachment name escape the export folder` |
| **EXIT** | **1** |

A label is page-controlled text, so this is a real boundary rather than a
formality. Note the invariant the test asserts is that no PATH SEPARATOR
survives — not that the string contains no `..`. An earlier draft of the test
demanded the stricter thing and failed against `Chat-001--..-etc-passwd.txt`,
which is harmless: `..` with no slash is just characters in a filename. The test
was corrected to assert what actually matters instead of being weakened.

### Removed rather than left untestable: compound-extension special case

The first fix carried an explicit `(?:\.(?:tar|user))?` branch in
`splitFilenameExtension`. Mutating it away left the full suite GREEN
(**EXIT=0**), and direct probing showed why: with the original stem preserved,
`archive.tar` + `.gz` recombines to `archive.tar.gz` either way, and on the image
path the stem is discarded so only the extension whitelist applies. The branch
changed no observable output on any reachable path, so it was DELETED rather than
kept with a test written to fit it. A surviving mutant is a claim about the code,
not only about the tests: here the honest reading was dead complexity.

## Wave 2d — checked against a real saved ChatGPT page

Everything above was verified against hand-written fixtures. Hand-written
fixtures test the page the author imagined. This section is what changed after
reading an operator-held save of a real 4-exchange ChatGPT conversation (68 KB of
actual page bytes). The file itself is NOT committed and cannot be: it carries
`sig=` signed URLs and a real conversation id, both banned in tracked text by
`tests/public-surface.test.js:91-92`, and the sample-directory path is banned too. So
the shapes were TRANSCRIBED and the identifiers replaced with synthetic ones.

### What the real bytes proved

| Observation | Consequence |
| --- | --- |
| An image-only assistant turn carries **no** `.markdown`, **no** `[class*="prose"]` and **no** `[data-message-author-role]`. Its role lives ONLY in `data-turn="assistant"` on the section. | The orphan-prose fallback cannot reach such a turn; only the `data-turn` path and the image extractor save it. A fixture that gives such a turn a prose container tests a page ChatGPT does not serve. |
| Generated files are served from `chatgpt.com/backend-api/estuary/content?id=...` — id in a QUERY parameter, path ending at `/content`, **no extension anywhere**. | Filename derivation cannot rely on the URL path. The `/estuary/` host rule already shipped in `isDownloadableFileUrl` is confirmed correct against real bytes. |
| `files.oaiusercontent.com` does not appear in this sample at all; every artifact is on `chatgpt.com`. | The host allowlist needs the `chatgpt.com` paths, not only the CDN. Already the case. |
| Real `data-testid` values in the sample are `conversation-turn-N`, `copy-turn-action-button`, `webpage-citation-pill`, `image-gen-overlay-actions`. | `[data-testid="file-chip"]`, used for attachment discovery, is NOT among them — this sample contains no attachments, so that selector remains **unconfirmed** rather than refuted. Stated plainly instead of counted as verified. |
| All 8 turns in the sample carry `data-turn`. | The historical 8-in / 6-out loss belongs to the 1.1.x extractor, not to the current code. The current code captures all 8. |

### A. The real image-only turn shape must not regress

| Field | Value |
| --- | --- |
| **Edit** | In `getSectionRole`, replace `section.getAttribute('data-turn')` with `null`, so the section-level role attribute is ignored and only `[data-message-author-role]` counts. |
| **Tests that went red** | `captures an image-only assistant turn shaped like the real page`; `extracts an image-only assistant turn`; `preserves every assistant message segment within one turn`; `browser entrypoint scans all windows and returns the established result shape` |
| **EXIT** | **1** |

### B. Extensionless estuary URLs

Covered by `derives a filename for an estuary URL that carries no extension`,
which pins all three outcomes on the real URL shape: an image gets `.png`, a file
with no label anywhere degrades to `.bin` rather than to an extensionless name
Chrome would refuse, and a labelled link still wins (the common case for
documents).

### A measurement error worth recording, because it nearly became a bug report

An intermediate probe concluded that a role-less image-only turn returns `null`
and is silently lost, and that conclusion was WRONG. The synthetic section used
for the probe omitted `data-turn` — an attribute the real page always carries.
The shim, not the extractor, was broken; re-running with the attribute present
returned the turn with its image intact. This is the exact failure mode this
section exists to prevent: a fixture that diverges from the real markup can
manufacture a defect as easily as it can hide one.
