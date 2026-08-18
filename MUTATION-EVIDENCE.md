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

## Wave 2e — long-run resilience

Operator requirement, 2026-08-17: a full-project export is a long job over a
network the extension does not control, so it must survive network failures and
site unavailability, be pausable, resumable and cancellable, and on a restart
check what is already downloaded instead of fetching it twice.

### The defect the green suite did not catch

Resume was implemented but could never work. `chrome.downloads.search` reports a
full path under the user's Downloads folder; the batch built a relative one; the
`Set` lookup therefore always missed. Driving the real `popup.js` against a mock
that returns an absolute path — which is what Chrome does — produced
`pending = 2` where it must be `1`, i.e. a restarted export re-downloaded
everything. The 82 tests passing at the time fed RELATIVE paths back, so the
fixture modelled a Chrome that does not exist. Same class as Wave 2d.

A second, independent break: with the date-time stamp enabled the filename
carries the CURRENT run's stamp, so a file from a previous run could never match
by name either.

### Mutations — all five kill a test

| # | Edit | Test that went red | EXIT |
| --- | --- | --- | --- |
| A | In `completionKeyForPath`, stop stripping the leading path (`var anchor = -1`). | `resume matches the ABSOLUTE paths chrome.downloads.search really returns` (+1 more) | **1** |
| B | In `completionKeyForPath`, keep the `--<stamp>` suffix. | `resume survives a timestamped filename and Windows separators` | **1** |
| C | In `classifyBatchFailure`, never return `offline`. | `classifies a dead network apart from a bad conversation` | **1** |
| D | In `backoffDelayMs`, remove the `Math.min(..., 8000)` cap. | `backs off exponentially with a finite ceiling` | **1** |
| E | In `waitWhilePaused`, make the hold loop `while (false)`. | `a paused run holds instead of proceeding, and a cancel releases it` | **1** |

### End-to-end runs, not only unit tests

The real `runBatchExport` was driven through four scenarios against a fake
`chrome` API, asserting on what reached `chrome.downloads`:

| Scenario | Result |
| --- | --- |
| Clean, 3 conversations | `exported=3`, one attempt each, 3 files written |
| Transient failure on conversation 2 | `exported=3`, `retried=1`, attempts `{a:1, b:2, c:1}` — the conversation that failed once was recovered instead of lost |
| Network down on conversation 3 | `exported=2`, `networkWaits=2`, one reported error naming the network; the other two conversations unaffected |
| Cancel after the first conversation | `ok=true`, `cancelled=true`, `exported=1` — partial work kept and reported |
| Resume with one conversation already on disk (absolute path) | `total=3`, `exported=2`, `skipped=1`; progress showed `1/2 Two`, `2/2 Three` |
| Pause held for three polls, then released | run continued and finished all 3 |

### A probe error worth recording

Two intermediate probes reported `runBatchExport` never returning, and both
diagnoses were WRONG. `searchCompletedDownloadPaths` wraps
`chrome.downloads.search` in a callback promise, and the mock was written as
`async () => []` — it returned a promise and never invoked the callback, so the
await never settled. The mock was broken, not the code. This is the third time
in this task that a fixture manufactured a defect; the lesson is the same as
Wave 2d's.

## Wave 3 — release readiness (v1.6.0)

The 87 tests passing at 1.5.0 were not evidence of release readiness. Two
independent adversarial audits were run against that commit — one on DOM and
resume correctness, one on Web Store compliance — and between them they found
five defects the suite passed clean. **Every one was silent**: the popup
reported success while files were missing, truncated, or unreadable. On a tool
whose whole purpose is a backup, that is the worst failure class, because the
user may delete the source believing the copy is good.

### What was NOT a defect, stated plainly

Two suspicions were checked and cleared, so effort does not get spent there
again. A sidebar selector that matches nothing is a **loud** failure — the run
returns `ok:false` with an actionable message, verified by execution, so the
feared "0 conversations, reported as success" path does not exist via selector
drift. And a Chrome-uniquified `Chat (1).md` does not match the resume key,
which is the SAFE direction: it re-exports rather than falsely skipping.

### The defects

| # | Defect | Why the suite missed it |
| --- | --- | --- |
| 1 | Resume keyed on the title-derived slug, so duplicate titles — ordinary in a Project, "Untitled" especially — collapsed onto one key. Interrupting a run after the first landed skipped every namesake FOREVER as "already exported". | No fixture had two conversations sharing a title. |
| 2 | `downloadOne`'s result was discarded, so a run whose every write Chrome refused reported the whole project exported. Zero files, "40 saved". | No fixture had Chrome ever refuse a write. |
| 3 | A conversation titled `..` produced a `..` path segment; Chrome rejects such a filename, so ONE such title made every write in the run fail. Combined with #2 it was silent and total. | `slugifyTitle` never saw a dot-only title; the sibling sanitizer that was tested is a different function producing leaf names, not directories. |
| 4 | A truncated export was banked as complete, so re-running — the only action that could repair it — skipped it. | `result.partial` was computed and returned, but no batch caller read it. |
| 5 | Zip filenames were UTF-8 bytes without the header flag declaring so, so extractors fell back to code page 437 and Cyrillic titles unzipped as mojibake — the primary workload. | Tests asserted names round-tripped as bytes, never that an extractor could read them. |

### Mutations — each fix mutated away, each killing its own test

| # | Edit | Test that went red | EXIT |
| --- | --- | --- | --- |
| F | Resume ignores the conversation id, keys on the title again. | `two conversations with the SAME title are both exported` (+2 more) | **1** |
| G | `slugifyTitle` accepts a dot-only title. | `a dot-only title never becomes a path segment` | **1** |
| H | Batch counts a refused write as exported. | `a rejected write is never counted as an exported conversation` | **1** |
| I | Partial export banked as done again. | `a truncated export is reported and NOT banked as done` | **1** |
| J | An id-bearing file also seeds the title-keyed set, so the collision returns through the backward-compatibility fallback. | `two conversations with the SAME title are both exported` | **1** |
| K | Local zip header drops the UTF-8 flag. | `buildStoreZip declares UTF-8 names…` | **1** |
| L | Central directory header drops the UTF-8 flag. | `buildStoreZip declares UTF-8 names…` | **1** |
| M | Zip entry cap removed. | `buildStoreZip refuses more entries than the format can count` | **1** |
| N | Archive delivered as a `data:` URL again. | `the archive is delivered by handle, not as a megabytes-long URL` | **1** |

Every exit code is the test runner's own, never read after a pipe.

### End-to-end, against the real pipeline

`runBatchExport` was driven through the composed scenarios, asserting on what
reached `chrome.downloads`:

| Scenario | Result |
| --- | --- |
| Two conversations titled "Untitled", the first already on disk | `exported=1 skipped=1`, and the file written carries the SECOND id — the namesake is no longer lost |
| Chrome refuses every write | `exported=0`, two reported errors — no longer "2 saved" |
| A truncated scan | `partial=1`, reported and left pending; a later run with a genuinely complete file skips it |
| Zip run | archive written via a blob handle |

### A measurement that lied, and how it was caught

After setting the UTF-8 flag, the system `unzip -l` STILL showed mojibake, which
looked like the fix having failed. Writing a reference archive with Python's
`zipfile` produced byte-identical flags (`0x0800`) and the same mangled listing
from that same `unzip`. The extractor was the faulty witness, not the writer: a
flag-honouring extractor reads `Договор/файл.md` from the new archive and
`╨ö╨╛╨│…` from the old one. A single tool's output is not a measurement — the
reference implementation is the control.

### Still not verified, and it cannot be verified from here

The browser extension was not connected in this session
(`list_connected_browsers` returned empty), so the sidebar and attachment-chip
selectors remain fixture-derived. A LIVE pass on a real Project page is still
required before submission. A partial sidebar match would export a
plausible-looking subset and report completion — that specific risk is
unguarded, because there is no expected count to compare against.

## Wave 3b — the Wave 3 fix was itself defective

Wave 3's own fixes were handed to a fresh adversarial reviewer, which found **two
blockers in the fix itself** — both of the same class the fix was written to
remove. This is the entry worth reading: a fix that closes a silent-loss defect
can reopen it through its own compatibility path.

### Blocker 1 — the legacy fallback reintroduced the collision

Resume now keys on the conversation id, but files written by v1.5 carry no id, so
a fallback recognises them by title. Two conversations sharing that title both
matched the single legacy key, so **both** were skipped — including the one that
never landed. Reproduced: one legacy `Budget.md` on disk, two conversations
titled `Budget` → `pending = 0`, where it must be 1. Anyone upgrading from v1.5
with duplicate titles was exposed, i.e. the entire installed base.

The fix is conceptual, not cosmetic: a legacy file is evidence of **one** export,
so legacy credit is now a *budget that gets spent* rather than a set membership
test. One file vouches for one conversation; the second namesake stays pending.

### Blocker 2 — the id parse spanned its own separator

`/--([A-Za-z0-9-]{8,})$/` puts `-` inside the character class, so the capture
matched backwards across the `--` separator. The stamp-exclusion guard therefore
never fired, because the capture was never a bare stamp:

| filename | captured | correct |
| --- | --- | --- |
| `Chat--68a1f2c3-…` | `68a1f2c3-…` | yes |
| `Chat--20260817-1830--68a1f2c3-…` (stamp ON) | `20260817-1830--68a1f2c3-…` | **no** |
| `Build--experimental-build--68a1f2c3-…` | `experimental-build--68a1f2c3-…` | **no** |

Consequence: with the date-time stamp enabled, resume **never recognised its own
files** — unbounded re-download of the whole archive on every run, which is the
exact failure resume exists to prevent.

Two changes, one structural and one conceptual. Fields are now taken by
**splitting on the separator** and reading the last one, because no regex can
reliably tell `--` the separator from `--` inside a title. And identity is now
*asked* rather than *extracted*: resume already knows the candidate ids, so
`pathCarriesConversationId(path, id)` is an exact test, whereas recovering an
unknown id from an ambiguous name is guesswork.

### Two more, same silent-success class

- **An interrupted archive was reported as saved.** `waitForDownloadComplete`
  correctly distinguished `complete` from `interrupted`, but the caller discarded
  its answer and named the archive anyway. The popup named a file that was not
  there.
- **The blob could be revoked mid-write.** `downloadOne`'s 12s accept budget and
  the 120s write wait were inconsistent: for a large archive Chrome may take
  longer than 12s merely to ACCEPT, after which `downloadOne` reported a timeout,
  `waitForDownloadComplete` was never called, and the `finally` revoked the URL
  while Chrome was still reading it — corrupting the archive and blaming the
  network. The archive now gets a single budget shared by both waits.

### Mutations

| # | Edit | Test that went red | EXIT |
| --- | --- | --- | --- |
| Q | Parse the id with the greedy regex again. | `resume recognises its own file when the date-time stamp is enabled` (+1) | **1** |
| R | Legacy credit becomes a set again (unlimited vouching). | `a legacy file cannot account for more conversations than it is` | **1** |
| S | Interrupted archive reported as saved. | `an interrupted archive is not reported as saved` | **1** |
| T | Zip accept budget back to the per-file default. | `the archive gets a longer accept budget than a single conversation file` | **1** |

**Mutant T survived its first test, and that is recorded rather than tidied
away.** The original assertion read the exported constant's value, so a mutant
that stopped *passing* the constant to `downloadOne` left it green — a
tautological test of exactly the kind criticised elsewhere in this file. Rewritten
to observe the budget that actually reaches `chrome.downloads` through the real
`downloadOne`, it kills T (`zip=12000 md=12000`).

### Why the Wave 3 suite missed both blockers

Every resume fixture passed `useTimestamp: false`, and every fixture slug was
`--`-free (`Untitled`, `Budget`, `alpha`, `One`). The two broken configurations
were the two the fixtures never constructed. The lesson is the one this task keeps
relearning: a fixture set that only builds the shapes the author had in mind
tests the author's mental model, not the code.

## Wave 3c — stop apportioning what cannot be apportioned

Wave 3b was verified by another fresh reviewer, which found **two more blockers**,
again in the new code, again the same silent-loss class. Three rounds of the same
defect is a design verdict, not a run of bad luck, so this round changed the rule
rather than the arithmetic.

### What kept going wrong

A file written before conversation ids were recorded carries **only a title**. When
two conversations share that title, the file's owner is *genuinely unknowable*.
Each round tried to apportion it anyway, and each attempt leaked differently:

| Round | Mechanism | How it lost a conversation |
| --- | --- | --- |
| 3 | Set of title keys | One file excused every namesake. |
| 3b | Count of files, spent per match | An id-matched conversation returned early without consuming its OWN legacy file, so the orphaned credit was spent by a namesake that never landed. |
| 3b | Count incremented per PATH | `chrome.downloads.search` returns history, so one physical file under two absolute paths (Downloads moved, or deleted and re-fetched) invented a second credit. |

### The rule now

Ownership is **resolved, not counted**, and only when unambiguous: a legacy file
excuses a conversation only if exactly **one** conversation in this run claims its
title. Otherwise every claimant is re-exported. Legacy paths are collected as a Set
of KEYS, so history rows cannot multiply into extra files.

This is not a smaller guess — it removes the guess. Re-exporting costs bandwidth; a
false skip loses a conversation permanently and re-running cannot repair it, so
ambiguity must resolve to the cheap direction.

### Mutations

| # | Edit | Test that went red | EXIT |
| --- | --- | --- | --- |
| U | Ambiguity ignored — a legacy file excuses every claimant. | `a legacy file whose owner is ambiguous excuses nobody` (+2) | **1** |
| V | Legacy keys collected per path again. | `two history rows for one file do not yield two credits` (+2) | **1** |
| W | Legacy fallback removed entirely. | `filterPendingConversations skips paths already downloaded` (+2) | **1** |

W matters as much as U: without it, "never trust a legacy file" would satisfy every
safety assertion while destroying the upgrade path — an entire archive re-downloaded
on first run after updating. Both directions are pinned.

### Re-verified after the redesign

The eleven-case false-skip hunt was re-run: **no false skip in any case**, and every
ambiguous case resolves to re-export. Both blocker reproductions now behave. The
upgrade path was re-checked at scale — 40 legacy files with distinct titles, stamped
and unstamped, `pending = 0`.

### One more of my own gates caught me

The first version of the history-row test used a real home-directory path shape, and
the public-surface gate failed the build: an absolute home path is the user's name,
and it is banned in tracked files. Rewritten with neutral roots. Worth recording
because the gate was doing exactly its job on the person who wrote the test.

### Known, accepted, safe-direction

A legacy file whose TITLE contains `--` (`Build--v2.md`) is read as id-bearing and
so earns no legacy credit, meaning that conversation re-exports on every run. It
fails toward bandwidth rather than loss. Not fixed, because distinguishing a title's
`--` from the separator's `--` in a name written by a version that recorded no id is
the same unknowable problem as above; recording it beats pretending it is handled.

## Wave 3d — remove the last guess about identity

A third fresh reviewer found a **fourth** instance of the same silent-loss defect,
and named the design fault precisely: the routing layer still decided "does this
name carry an id?" from the field's **shape**.

ChatGPT ids match `[A-Za-z0-9-]+` (see the sidebar parser), so an id can look
exactly like a date-time stamp. `Budget--20260817-1200.md` — a perfectly ordinary
export whose conversation id happens to be stamp-shaped — was therefore filed as an
older, id-less export. A different conversation sharing that title was then the only
claimant of the title key, the round-3c ambiguity guard never fired, and it was
skipped without ever being saved:

```
conversations:  [{ id: 'c8f21ab4', slug: 'Budget' }]
on disk:        chatgpt-export/proj/Budget/Budget--20260817-1200.md
pending = []                      want ['c8f21ab4']
```

The guard was sound; it was fed a poisoned bucket.

### The rule now: test, never infer

The candidate ids are known at filter time, so classification is a **test against
them**: a path carries an id when its trailing field EQUALS one of this run's ids.
`pathCarriesAnyConversationId` — the shape-sniffer — is gone.

### A second defect, found in the first version of this very fix

Testing against known ids alone moved the loss rather than removing it: a file
belonging to a conversation **no longer in the run** (deleted from the project) has
an unrecognised id, so it fell into the legacy bucket — and the key derivation
*also* stripped fields on shape, collapsing it onto the plain title key where it
excused a live namesake. Caught by probing the fix before committing it.

So key derivation is gated on the same evidence: a trailing field is removed only
when it is one of this run's ids, and a stamp comes off only **after** an id has
been recognised — i.e. only once the name is known to be `slug--stamp--id`.
Stripping a trailing stamp from an unrecognised name is precisely what let one file
impersonate a plain export.

### Mutations

| # | Edit | Test that went red | EXIT |
| --- | --- | --- | --- |
| X | Classify by shape again. | `a file is classified by the ids in the run, not by how its name looks` | **1** |
| Y | Strip a stamp even when the id was not recognised. | same | **1** |
| Z | Strip an id field without checking `knownIds`. | same | **1** |

**Mutant X survived its first run**, and that is the useful part. Reverting the
classifier alone left all 108 tests green, because the key-derivation gate blocks the
loss independently. The redundancy is welcome — but an untested branch is how the
original guess survived four rounds, so each guard is now pinned on its own rather
than only through its outcome.

### Final adversarial battery — 16 cases, 0 false skips

All four historical blockers, the risk this fix introduced, and eleven assorted
shapes: 3-way namesakes with mixed file kinds, ids that are substrings of each other,
a conversation id equal to another's slug, empty slugs, a path with no
`chatgpt-export/` segment, a stamp-shaped slug, a `--` title, the same conversation
listed twice, Windows separators, nothing-on-disk. Every ambiguity resolves to
re-export. Safe-direction regressions hold: 40 legacy files with distinct titles give
`pending = 0`, and a run's own timestamped file is recognised.

### The pattern, for the record

Four rounds, four instances, one cause: **inferring identity instead of testing it.**
Each round fixed the arithmetic of the inference (set → count → ownership → shape)
and the defect reappeared one layer down. It closed only when the inference was
deleted — the ids were available the whole time.

## Wave 3e — generate, don't parse

A fourth reviewer found a **fifth** instance of the same false skip, and the input is
depressingly ordinary:

```
slugifyTitle('Budget - draft')  ->  'Budget---draft'   trailing field: '-draft'
```

A spaced hyphen becomes `---`, and `-draft` is a legal ChatGPT id
(`[A-Za-z0-9-]+`). So an id-less file from an older version, `Budget---draft.md`, was
read as an export **of** the conversation whose id is `-draft` — and that
conversation was skipped without ever being written. Title truncation at 60
characters widens it further: it *manufactures* a trailing field from a title that
had none.

Round 3d's test — "does the trailing field equal a known id?" — is **necessary but
not sufficient** evidence of ownership.

### The design fault, finally named

Five rounds, five instances, one cause: **reading a filename to decide which
conversation wrote it.** Each round replaced one inference with a subtler one:

| Round | Inference | Broke on |
| --- | --- | --- |
| 3 | Title key identifies a conversation | Duplicate titles |
| 3b | Count files per title, spend per match | Credit spent by a non-owner; history rows double-counted |
| 3c | One file, one owner, only if unambiguous | — (sound, but fed by a bad classifier) |
| 3d | Trailing field equals a known id | A title whose tail *is* another conversation's id |

A title can contain anything a separator or an id can contain, so no parse of an
arbitrary name is safe.

### The rule now: the format is ours, so ask forwards

For each conversation, **generate the exact names it could have written** and check
whether any of them landed. Nothing about an unrecognised name is inferred — it
simply matches nothing. `candidateExportNames` builds `slug--id`,
`slug--<stamp>--id` for each stamp actually present on disk, and the bare `slug` for
older exports; `stampsInPaths` supplies the stamps, which is safe because
`YYYYMMDD-HHMM` is a fixed shape and a false positive there only adds a candidate
name that nothing matches.

Two safety rules follow from the design rather than being bolted on:

- **A name more than one conversation could have written is evidence about none of
  them.** Claimants are counted across owned AND legacy candidates together, because
  the spaces overlap.
- **A stamped legacy name is never generated at all.** `slug--20260817-1200` is
  simultaneously "an older stamped export of `slug`" and "an export of the
  conversation whose id is `20260817-1200`". The overlap is exact and nothing in the
  name resolves it, so such a file is never proof. Cost: one re-export of a stamped
  older file. Alternative: losing a conversation. Not a close call.

### Also fixed: a truncated export was repairable only within its own run

Round 3's guard kept a partial out of the in-memory completed set, but the truncated
file is on disk and in download history, so the NEXT run found it and skipped the
conversation — refusing the one action that could repair it. Resume sees filenames
and nothing else, so the incompleteness now lives in the NAME
(`Chat-partial--<id>.md`), not only in the notice inside the file.

### Mutations

| # | Edit | Test that went red | EXIT |
| --- | --- | --- | --- |
| AA | Generate a stamped legacy candidate again. | `a file is classified by the ids in the run, not by how its name looks` | **1** |
| BB | Ignore the claimant count. | `a legacy file is not credited to a conversation whose own file already landed` (+1) | **1** |
| CC | Stop marking a partial in the name. | `a truncated export is still repairable on the NEXT run` | **1** |

### Verified after the redesign

- The 16-case adversarial battery: **0 false skips**, every ambiguity resolving to
  re-export.
- The `Budget - draft` case that opened this round: the victim stays pending.
- Nine hostile-key cases: `__proto__`, `constructor` and `toString` as both slug and
  id, numeric ids, ids differing only by case, `.MD`, a foreign project row, and a
  60-character truncation collision.
- **Two-run end-to-end through `runBatchExport`, stamp ON and OFF:** run 1 exports 3
  (including two both titled "Untitled"), run 2 exports 0 and skips 3, and deleting
  exactly one file re-exports exactly that one.
- Upgrade path at scale: 40 older files with distinct titles, `pending = 0`.

## Wave 3f — make the two name formats structurally disjoint

A fifth reviewer found a **sixth** instance, and it exposed that Wave 3e enforced its
own central rule in only one of the two places it mattered.

3e said: never generate `slug--<stamp>`, because that string is simultaneously "an
older stamped export of `slug`" and "an export of the conversation whose id is
stamp-shaped". The rule was applied when building *legacy* candidates — and quietly
violated when building *owned* ones, because `prefix + '--' + id` rebuilds the
identical string whenever the id is itself stamp-shaped. One conversation generating it
is the sole claimant, so no ambiguity guard could fire:

```
on disk (older version): chatgpt-export/proj/Chat/Chat--20260101-0900.md
run:                     [{ id: '20260101-0900', slug: 'Chat' }]
pending = []             -> skipped, never written, success reported
```

### Why this was fixed differently

The reviewer's own suggestion — suppress the bare form when the id is stamp-shaped —
would have been the **sixth inference in a row**, and the recurrence itself is the
evidence that another guess is the wrong move. The actual cause is upstream of every
guard: the current name format and the older one **shared an alphabet**, so a name from
one could always be read as a name from the other.

So the alphabets are now separated. The id is introduced by `~` (`ID_MARKER`), and
`slugifyTitle` strips that character from every title. A slug therefore cannot contain
it, and `slug[--stamp]~id` can never be produced by the older `slug[--stamp]` format.
The two spaces are disjoint **by construction** rather than by a test that has to be
right.

Removing a character from titles is a real cost, paid once and visibly. The ambiguity
it removes cost a conversation, five times.

### Dead code deleted rather than left to rot

`completionKeyForPath`, `completionKeyForConversation`, `pathCarriesConversationId`
and `pathCarriesKnownConversationId` — about 5.7 KB — were relics of the four earlier
designs. Nothing on the live path called them, yet they were still exported and still
tested, so the suite was pinning behaviour the product no longer had. Every one of the
six defects lived in exactly that kind of parsing helper.

Four tests that exercised them were **rewritten against observable behaviour** rather
than deleted: they now assert that a file is or is not recognised, not what an internal
key looks like. One of them had to be rewritten precisely because it asserted a key
shape — a sign it was testing the implementation.

Hand-written `--<id>` filenames in five fixtures were replaced with calls to
`batchMdFilename`. A fixture that duplicates the format silently rots when the format
changes, which is what happened here: seven tests failed on a name-format change that
was entirely intentional.

### Mutations

| # | Edit | Test that went red | EXIT |
| --- | --- | --- | --- |
| DD | `slugifyTitle` stops stripping the marker. | `no title can forge the marker that introduces a conversation id` | **1** |
| EE | Separate the id with `--` again, so the formats overlap. | `resume recognises its own stamped file, on either platform` (+1) | **1** |
| FF | Stamp harvester ignores the marker. | `resume recognises its own file when the date-time stamp is enabled` (+1) | **1** |

### Verified: 29 adversarial cases, 0 false skips

All six historical blockers; marker-specific attacks (a title that contained a tilde,
an id containing a tilde, an id equal to another conversation's slug, a slug equal to
another's `slug~id`); three-way namesakes with mixed file kinds; ids that are
substrings of each other; case-only-different ids; empty/numeric/`__proto__` slugs and
ids; 60-character truncation collisions; no `chatgpt-export` anchor; foreign-project
and deleted-conversation rows; Windows separators; `.MD`; a duplicate listing;
partial-vs-complete in both directions including a conversation legitimately titled
"Draft-partial"; stamped files of the owner and of another conversation; the 40-file
upgrade path; idempotence and non-mutation of the caller's inputs.

**One flagged case was my probe's error, not the code's**, and is recorded because the
distinction matters: `Budget---draft.md` genuinely belongs to the conversation whose
slug *is* `Budget---draft`, so skipping that one is correct. The property that matters
— the unrelated conversation whose id is `-draft` stays pending — holds.

Two-run end-to-end through `runBatchExport`, stamp ON and OFF: run 1 exports 3
(including two both titled "Untitled"), run 2 exports 0 and skips 3, and deleting
exactly one file re-exports exactly that one.

### The whole arc, in one line

Six defects, one cause: **a name is not evidence of who wrote it unless the format
makes it so.** Five rounds tried to read the name more cleverly. The sixth made the
formats unable to collide, and the guards downstream became simple because they no
longer had anything to guess.

## Wave 3g — the first clean verdict, and two things fixed anyway

The sixth review round returned **ship**. It could not construct a false skip: a brute
force over 41,472 two-conversation worlds and 1,645,920 three-conversation worlds —
including foreign-project, stale and deleted-conversation history rows — found none.

The important part is that the instrument was proven able to fail. The reviewer's first
sweep came back green against a mutant that reintroduced the stamped-legacy defect,
because the probe always placed a file's true writer in the run. Rebuilt with explicit
ground truth (the writer may be absent), five mutants went red. **A green sweep from a
probe that cannot fail is not evidence** — the same lesson as the pipe-swallowed exit
code earlier in this file.

It also verified the marker invariant at its source, and independently confirmed what
was checked here: NFC does not fold any of the tilde look-alikes (U+FF5E, U+301C,
U+223C, U+02DC, U+0303), the 60-character truncation runs after the strip, no other
replacement can emit the marker, the project slug uses the same function, and the
sidebar id regex `[A-Za-z0-9-]+` excludes the marker too.

### Two non-blocking findings, fixed rather than filed

**The conversation id was case-folded** (`popup.js`, `candidateExportNames`). Folder and
slug are folded because macOS and Windows fold them — that follows the filesystem and is
right. Folding the **id** collapses two identities onto one name, so a conversation could
be excused by a file belonging to another:

```
on disk: chatgpt-export/proj/Chat/Chat~68a1b2c3-dead-beef-abcd.md
run:     [{ id: '68A1B2C3-DEAD-BEEF-ABCD', slug: 'Chat' }]
pending = []   -> never written, skipped, success reported
```

Not reachable today — ChatGPT ids are lowercase hex — which is why the verdict was still
"ship". Fixed anyway, because "this name can only mean one thing" is the exact assumption
that produced six consecutive silent-loss defects, and it sat one upstream change away
from being live. `foldExceptId` now folds only up to the marker, and both sides of the
comparison call it so they cannot drift.

**`trailingField` was dead** — a name-*parsing* helper left exported after the redesign
removed the last caller. Deleted. Wave 3f removed four such relics and missed the fifth;
leaving a parsing primitive exported on a code path that just won its safety by refusing
to parse is an invitation.

### A test of my own that pinned nothing

The first version of the normalisation test asserted that NFC does not fold the fullwidth
tilde. Swapping `normalize('NFC')` for `'NFKC'` left it **green** — because the assertion
was a fact about Unicode, not a property of this code. `slugifyTitle` normalises *first*
and strips the marker *after*, so any tilde a normalisation form produces is then removed;
the NFKC swap is genuinely harmless and its survival is correct.

Rewritten to pin the **ordering**, which is what can actually break. Moving the strip
before normalisation now goes red.

### Mutations

| # | Edit | Test that went red | EXIT |
| --- | --- | --- | --- |
| GG | Fold the id again. | `an id differing only in case does not excuse a conversation` (+1) | **1** |
| HH | Fold the whole landed key again. | `a legacy file is not credited to a conversation whose own file already landed` | **1** |
| II | `NFC` → `NFKC`. | none — **correctly survives**, see above | 0 |
| JJ | Strip the marker BEFORE normalising. | `normalisation cannot smuggle the id marker past the strip` | **1** |

114 tests, all green. The 29-case battery, the invariant sweep and the two-run
end-to-end (stamp ON and OFF) all re-run clean after the change.

### Known limitation, safe direction

`foldExceptId` folds up to the FIRST marker in the whole key, so a `~` appearing in a
*directory* name stops the folder folding (`A~B/C~ID` → `a~B/C~ID`). Unreachable in
practice — `slugifyTitle` strips the marker from both the conversation slug and the
project slug — and harmless if it were reached: the generated side is lowercased up to
its own first marker, so a mismatch can only leave a file UNRECOGNISED, i.e. re-exported.
It can never make a file match a different conversation. Verified by construction and by
running it, and recorded rather than "fixed" with another special case.

One stale expectation in my own probe was corrected rather than left to mislead: for
`Budget---draft.md`, skipping the conversation whose slug *is* `Budget---draft` is
correct — that file is genuinely its own. The property under test is that the unrelated
conversation whose id is `-draft` stays pending, and it does.

## Wave 4 — the sidebar walk (v1.7.0)

Wave 3 shipped a batch export whose conversation list was read **once**,
synchronously, from whatever the virtualized sidebar had mounted. The 114-test
suite passed clean because every fixture mounted the whole list — a fixture that
mounts everything is complete by construction and cannot express "there were rows
you never saw". The technique to test it properly was already in the repo
(`createUnmountingFixture`, applied to message turns); it had never been pointed
at the sidebar.

Ground truth added: the fixture holds `allIds`, which **no selector under test can
reach**. A partial read is therefore detectable.

### Mutants — the walk

| Mutant | Change | Result |
|---|---|---|
| M1 | never scroll (drop the `scrollTop` write) | KILLED |
| M2 | `complete: true` unconditionally | KILLED |
| M4 | skip the scroll-position restore | KILLED |
| M5 | declare complete without `atBottom` | KILLED |
| M7 | stop re-reading after the first absorb | KILLED |
| M8 | `maxRounds` 200 → 1 | KILLED |
| M9 | disable de-duplication | KILLED |
| M3 | `quietRounds` 3 → 1 | **survived, then killed** |

M3 first survived because the patience test compared budgets against a loader fast
enough that both budgets won — the knob looked decorative. Probing with slower
loaders showed it *is* load-bearing (8 rows vs 18 at `appendAfter=10`); the test was
retuned to a delay where the budgets genuinely diverge.

### Mutants — coverage verification

Quiescence is not a coverage proof: "the list ended" and "I stopped looking" are
indistinguishable from the walk's own vantage point. Completeness is therefore
**measured** — the vertical spans over which rows were observed must leave no gap
across the scrollable range.

| Mutant | Change | Result |
|---|---|---|
| C1 | completeness ignores coverage | KILLED |
| C2 | contiguity always true | KILLED |
| C3 | gap tolerance 2px → 9999px | KILLED |
| C4 | skip the top-of-list check | KILLED (after adding the scrolled-start test) |
| C5 | ignore whether the tail was reached | KILLED |
| C8 | record coverage without the scroll offset | KILLED |
| C9 | `scrollStepRatio` 0.5 → 1.0 | KILLED |
| C10 | a blocked scroller reported as complete | KILLED (after adding the throwing-setter test) |
| C6 | step by the full viewport again | **survived, correctly** |
| C7 | ignore the measured mounted band | **survived, correctly** |

C6 and C7 survive **by design**: with coverage verification in place, a coarser
step loses rows but is *caught* — `complete` goes false and `reason` becomes
`coverage-gap`. The step size is now an optimisation (fewer missed rows, fewer
rounds), not a correctness guard. Recording this rather than forcing them red:
a mutant that survives for a good reason is a result to explain, not to defeat.

### A fixture that modelled an impossible DOM

An intermediate fixture mounted `mount` rows starting at `scrollTop / rowHeight`,
which made the last rows **unreachable at any legal scroll position** — a
virtualizer that cannot render its own tail. Measured against it, every step-size
fix still "lost" the final rows, and the next move would have been to contort the
code to satisfy it. The fixture was wrong, not the code: a real virtualizer renders
what is visible, which at the bottom includes the last row. Corrected to render the
visible span (capped at `mountCap`), the same code went from 32 missed rows to 6,
and coverage verification then took the remainder to "reported, not silent".

### Two of my own tests proved nothing

- The step-over test originally asserted inside `if (missed.length)`, so it would
  have passed **vacuously** had the scenario stopped losing rows. A counter now
  asserts the scenario still reproduces.
- `assert.equal(manifest.version, '1.6.0')` in two suites made every release a test
  edit — a restated literal, not a check. Both now read the version from the
  CHANGELOG, and the coupling was verified by mutation (manifest → `9.9.9` goes red).

### Attachment selector drift

`extractAttachments` matched exactly one private `data-testid`. A rename returns
`[]` for every conversation — byte-identical to "this chat has no files" — while
the export reports `0/0` saved and no error. Verified by executing a renamed
mutant: the summary was character-for-character identical to the healthy run.

Fixed with a family of selectors ending in the file-host URL shape, so a rename
degrades to a fallback rather than to zero, and `matchedBy: null` distinguishes a
genuine absence from a rescue. Mutation: collapsing the family back to the single
testid goes red.

### A cross-check deliberately NOT built

Comparing the discovered list size against the count of already-landed files was
proposed and rejected on evidence. `chrome.downloads.search` returns download
**rows**, not files: re-downloads duplicate, Chrome's `(1)` uniquifying adds more,
and rows survive the files' deletion. Executed against a healthy two-conversation
project it reported `4 vs 2` — a false alarm on a correct archive — while on a
first-ever run (`landed=0`) it stays silent, which is exactly when the loss
happens. A check that cries wolf on healthy archives and is blind to the primary
failure trains the user to ignore it.

### CodeQL found a hole in the fix itself

The attachment fallback introduced `a[href*="files.oaiusercontent.com"]`, and
CodeQL flagged it: **incomplete URL substring sanitization**. Correct, and worse
than cosmetic — `popup.js` *fetches* attachment URLs, so a `[href*=]` selector
turns `https://evil.example/?x=files.oaiusercontent.com` into something the
extension requests. The fix for one silent failure had opened a different one.

Anything found by an href-shaped fallback is now re-checked against the **parsed
host** (`isConversationFileUrl`), exact comparison, https only. Mutants:

| Mutant | Result |
|---|---|
| remove the host re-check entirely | KILLED |
| `hostname === …` → `hostname.endsWith(…)` | **survived, then killed** |
| drop the https requirement | KILLED |

The `endsWith` mutant survived the first sweep because the hostile URLs in the
test all ended with the *attacker's* domain (`files.oaiusercontent.com.attacker
.example`) — none was a suffix impostor. Added `notfiles.oaiusercontent.com` and
`evil-files.oaiusercontent.com`, which end with the real host and are not it, plus
an `http://` downgrade. A test full of attack strings still tests nothing if none
of them exercises the specific weakening under consideration.

### The fixture's selector engine, and a sweep that lied again

CodeQL kept flagging the test fixture's `href.indexOf('files.oaiusercontent.com')`
line even after the shipped code was fixed. The pattern was genuinely there — the
fixture *must* substring-match, because that is what it emulates — but a
suppression would have hidden a rule that had already caught one real defect.

Rewrote the fixture to parse the selector and apply `=` / `*=` generically, so no
line resembles host validation and the engine is derived from
`ATTACHMENT_CHIP_SELECTORS` itself. A new shipped selector can no longer go
silently unexercised by the fixture.

A mutation in this round reported **SURVIVED** when it had never applied: the
`re.sub` pattern did not match, the file was unchanged, and the sweep dutifully
called the untouched code a survivor. Re-run with `assert s2 != s` before trusting
the verdict, it went red. Same lesson as reading an exit code after a pipe, wearing
a different costume: a sweep that cannot distinguish "mutant survived" from "mutant
never existed" reports the second as the first.

## Wave 5 — what a live browser found that no fixture could (v1.8.0)

Connected Playwright to a **copy** of the Publisher `chatgpt` profile with the
extension side-loaded. The session was live, so the DOM under test was production
ChatGPT, not a hand-made model. Three blockers surfaced immediately, and the first
was worse than anything the fixtures had modelled.

### The core defect: project conversations were invisible

A Project conversation is linked as `/g/g-p-{projectId}/c/{convId}`, not `/c/{id}`.
`nav a[href^="/c/"]` matched **zero** of them. Measured live: unfurling a project
took project-scoped links 0 → 5 → 35 (after "Show more") while the plain `/c/`
count stayed at 28 throughout. Two **disjoint** sets — so a batch started on a
Project exported the global "Chats" recents instead. Not a subset of the intended
set: a different set, reported as success.

Every fixture had modelled `/c/{id}` only, because that is the shape I had
invented. No amount of coverage verification helps when the selector is looking in
the wrong place.

### Mutants

| Mutant | Change | Result |
|---|---|---|
| P1 | selector narrowed back to `href^="/c/"` | **survived, then killed** |
| P2 | drop the project shape from the href regex | KILLED |
| P3 | normalise href to `/c/{id}` (losing project context) | KILLED |
| P4 | never click "Show more" | KILLED |
| P5 | ignore a "Show more" still standing | KILLED |
| P6 | keep the aria-label suffix | KILLED |
| P7 | make the suffix regex inert | KILLED |
| P8 | remove the project-scoped title selector | **survived, correctly** |

P1 first survived because the fixture returned links for *any* selector containing
`/c/` — including the narrow one. A fixture that ignores the difference between
`[href^=…]` and `[href*=…]` cannot detect the very narrowing that lost every
project conversation. Taught it CSS attribute semantics; P1 then died.

P8 survives **legitimately**: two independent paths produce the right title (the
project-scoped selector, and the document-title fallback stripping a known project
prefix). Verified by removing BOTH — the test then fails (`pass 0, fail 1`). A
mutant that survives because the behaviour is genuinely redundant is a result to
explain, not to force red.

### Two fixtures that measured the wrong events

- The burst fixture counted **every** `querySelectorAll` as a conversation read,
  so once the walk also scanned `nav *` for "Show more", its every-third-read
  stall fired on the wrong calls.
- The title fixture returned its link for `[data-active]` selectors even though
  the row carried no such attribute, making every href variant look rescued.

Both were green before the fix and green after, while testing something other than
what their names claimed.

### A sweep that lied twice more

Two P8 verdicts were wrong before the third was right: the first deletion removed
a different occurrence than intended, and a later run traced a file that had
already been restored. Each time the sweep reported SURVIVED for a mutant that was
never actually in place or never actually measured. The fix, again, is to assert
the mutation applied *and* to confirm which code path the test exercised — printing
the selectors actually tried settled it in one run.

### Live-confirmed facts

| Selector / behaviour | Result |
|---|---|
| `[data-turn-id]`, `[data-message-author-role]` | match on production |
| `getConversationMarkdown()` end to end | ok, 109 lines / 336 words from a real chat |
| sidebar virtualization | real: unique count went 100 → 138 while scrolling |
| "Show more" pagination | real: one project 5 → 35 on a single click |
| unfurled project state | NOT sticky — scrolling collapsed it and its rows left the DOM |
| duplicate titles within one project | real: 4 pairs among 401 conversations |

The duplicate-title finding is worth stating plainly: 401 conversations, 401
distinct ids, and 4 pairs sharing a title inside a single project ("Распознавание
текста", "New chat", "Git permission issue fix", "Переключение на ветку main").
The `~id` marker is the only thing separating them — the pre-1.6.0 title-keyed
resume would have silently skipped one of each.

## Wave 6 — locale, and artefacts that render no chip (2026-08-18)

Two classes the earlier waves could not have caught, because every fixture
encoded the English UI and no probed conversation had documents.

### How the locale class was measured

The SAME account and the SAME conversations, opened twice under Playwright with
only the browser locale changed (`locale` + `--lang`), against a COPY of the
profile. The probes ENUMERATE what the sidebar contains rather than searching for
a guessed Russian literal — searching for a guess proves only that the guess was
right, the self-reference trap that produced the tautological coverage check in
Wave 5.

There is no server-side UI-language setting (`/backend-api/settings/user` holds
no lang key; `voice_main_language: "ru"` is voice only), so the locale is the
USER'S BROWSER. Every user is a separate measurement, and the operator's profile
(`en-GB`) could not have revealed any of this.

| control-flow string          | en-GB           | ru-RU              |
|------------------------------|-----------------|--------------------|
| pagination row               | `Show more`     | `Показать больше`  |
| project row label suffix     | `, chat in project X` | `, чат в проекте X` |
| artefact download button     | `Download file` | `Скачать файл`     |

The pagination one was the worst: "no control standing" is the evidence
`showMoreExhausted` uses, so an unmatched control makes a PARTIAL list report
`complete: true`. The Wave-5 tail proof does not catch it — the deepest MOUNTED
row genuinely is last; the unrevealed rows are not in the DOM at all.

### Mutants

| id  | mutation                                              | verdict |
|-----|-------------------------------------------------------|---------|
| L1  | pagination detector back to the English literal        | DIED    |
| L2  | title prefers aria-label again (suffix leaks in)       | DIED    |
| L3a | suffix strip drops the separator requirement           | DIED    |
| L3b | whitespace allowed back as a separator                 | DIED    |
| L4  | pagination accepts a non-last list item                | DIED    |
| L5  | pagination drops the sibling-conversation requirement  | DIED    |
| L6  | pagination accepts an element with its own href        | DIED    |
| L7  | pagination accepts a wrapper around an anchor          | DIED    |
| L8  | pagination accepts a conversation row itself           | DIED    |
| L9  | suffix strip drops the startsWith guard                | DIED    |

L4–L9 all SURVIVED on the first sweep. Each survivor was a real hole: the
detector was wider than anything measured, free to click the wrong sidebar row,
and the strip could cut a title at a coincidental prefix. Negative-control
fixtures (a mid-list row, a row with no conversation siblings, a row that IS a
link) closed L4–L8.

L9 survived TWICE. The first replacement test could not isolate it: two guards
overlap, and the punctuation check still rejected the mid-word slice. The second
version separates them — visible `"Отчёт"` is 5 characters and label
`"Итоги, черновик отчёта"`[5] is a comma, so a blind `slice(5)` is
punctuation-led and only `startsWith` can reject it. A test that cannot fail is
not evidence.

L3 was first reported NOT-APPLIED: the sweep wrote `—` where the file holds
a literal em-dash. Reported as an invalid measurement rather than a pass, then
re-measured against the exact bytes. When it did apply, the test it should have
satisfied went RED and exposed a real defect — `\s` in the separator class cut
`"Проектирование хранилища"` out of `"Проектирование хранилища секретов"`, so a
row that truncates a long title would be foldered under the clipped name.

Test coverage runs the pagination cases under en-GB, ru-RU **and de-DE**
("Mehr anzeigen"). German was never measured; it is there to prove the detector
consults no language at all. A suite green only in the sampled locales would be
the same literal-matching bug relocated into the test file.

### Artefacts that render no chip

The operator supplied a conversation as one that "definitely contains the
documents". All six shipped `ATTACHMENT_CHIP_SELECTORS` found NOTHING there:

    a[href*="/files/"] , a[href*="files.oaiusercontent.com"]   -> []
    [data-testid*="file-chip"] , [data-testid*="attachment"]   -> none
    [download]                                                 -> []

Five generated PDF/DOCX files were present. Code-interpreter output renders in a
separate artefact `<section>` with no href, no testid and no download attribute;
the file name sits in a bare `<span>`. The panel is also OUTSIDE the message tree
(`button.closest('[data-message-id]')` === null across 28 ancestors), so a
per-turn DOM scan cannot associate a file with its message even in principle.
`data-testid="file-chip"`, flagged unverified since Wave 4, is now measured: it
does not cover generated artefacts.

A DOM-only implementation would have exported ZERO documents from that
conversation while reporting success — the same silent-partial failure shape as
the project-conversation bug, in a different subsystem.

Verified mechanism (executed, status 200 — captured by hooking `window.fetch`
around a real click):

    GET /backend-api/conversation/{id}                      -> 12 attachments
                                                              + 29 assets, each
                                                              with its message id
    GET /backend-api/conversation/{id}/interpreter/download
        ?message_id=…&sandbox_path=/mnt/data/…              -> { download_url, … }

Cookies alone give 401; the Bearer token from `/api/auth/session` gives 200.
`message_id` is MANDATORY (omitting it returns 422) and is obtainable ONLY from
the API — which is why this path is a requirement, not an optimisation of the DOM
one. `host_permissions` and `isDownloadableFileUrl` already admit
`/backend-api/estuary/` URLs, so no permission was widened.

A concern I raised against my own code and then measured: resolving a file
through some OTHER message's id could hand back the wrong bytes. Twelve distinct
message ids against one `sandbox_path` all returned the SAME file id
(`distinctFileIds` length 1) — the path identifies the bytes, the id is required
context. Safe, and the working id is therefore found once and reused instead of
retried per file.

| id  | mutation                                                  | verdict |
|-----|-----------------------------------------------------------|---------|
| A1  | unreadable API returns `[]` instead of `null`              | DIED    |
| A2  | missing token returns `[]` instead of `null`               | DIED    |
| A3  | download-url host check removed                            | DIED    |
| A4  | `message_id` dropped from the download request             | DIED    |
| A5  | panel accepts any aria-label (translated button as a file) | DIED    |
| A6  | working message id not carried forward                     | DIED    |

A1/A2 guard the distinction that matters most here: "no artefacts" and "could
not tell" must never collapse into the same value, or a 401 reads as a clean
conversation.

### Live end-to-end, under ru-RU

The shipped module was loaded into the real page and driven against the real
conversation:

    panelFiles      5      (all PDF/DOCX; "Скачать файл" correctly NOT a file)
    apiWasReadable  true
    apiCount        41     (29 assets + 12 attachments)
    resolved        a signed estuary URL with cd=attachment and sig=…

Where the shipped selectors found zero, this path finds five documents and 41
artefacts.

### Wiring the mechanism into the shipped path

The mechanism above was verified as a unit and against production while the
export pipeline still ignored it. Wiring it in exposed two more defects, both
found by mutation rather than by the passing suite:

| id  | mutation                                                   | verdict |
|-----|------------------------------------------------------------|---------|
| B1  | append not called from the shipped capture path             | DIED    |
| B2  | unresolved artefacts silently dropped                       | DIED    |
| B3  | unreachable-API note removed                                | DIED    |
| B4  | Files section emitted with no artefacts                     | SURVIVED (by design) |
| B5  | link form broken (not a markdown link)                      | DIED    |
| B6  | DOM message-id fallback removed                             | DIED    |

**B1 was the worst survivor of the whole task.** Deleting the call from
`getConversationMarkdown` left all 154 tests green: the helper was tested, its
USE was not. Testing a function in isolation says nothing about whether the
pipeline invokes it, which is the only part that ships. A test that drives the
real entry point (`getConversationMarkdown`, with an artefact panel in the DOM)
kills it.

**B6 was a real defect the wiring test caught.** Candidate message ids were taken
only from messages that already showed an artefact — but a conversation can hold
a generated PDF while no message carries an attachment or `asset_pointer`, so the
list was empty, nothing could be tried, and the file went unresolved. Since the
endpoint uses `message_id` as required context and not as a selector (12 ids ->
1 file id), ANY id from the conversation works; the DOM's `[data-message-id]`
nodes are now the fallback.

**B4 survives by design and must not be "fixed".** The `!files.length` early
return and the `!lines.length && !unresolved.length` return overlap: the first
avoids the network round-trips, the second covers a resolver that returned no
rows for files that did exist. Removing the first changes no output, so no test
can kill it. Recorded here as redundant-by-design so it is not mistaken for an
untested branch and closed by deleting one of the two.

### Privacy gate, again

The repository's own gate rejected the first version of the wiring test: it
embedded a full conversation URL (origin plus the `/c/<id>` path), matching the
pattern the gate reserves for real conversation links. Scrubbed to a bare origin.
Second time this task that a project gate caught the change rather than a
reviewer — and this note itself tripped the same gate on its first draft, for
quoting the offending URL verbatim while describing it.

### The panel mounts late, and the first fix read one frame

Verifying the built package on production exposed a defect the unit tests could
not have shown, because they hand the function a DOM that already contains the
panel.

Timing measured after navigating to the conversation (no scrolling involved):

    t=3s    turns 0    artefact rows 0
    t=6s    turns 0    artefact rows 0
    t=9s    turns 12   artefact rows 0
    t=12s   turns 29   artefact rows 10   <- panel appears here

An earlier probe read the panel at 11s and reported `gotFiles: false`. A user who
presses export right after opening a conversation would have lost all five
generated documents in silence — the same failure the API path was added to fix,
reintroduced by a timing assumption.

| id  | mutation                                        | verdict |
|-----|-------------------------------------------------|---------|
| W1  | no wait; single-frame read (the production bug)  | DIED    |
| W2  | wait loop never polls                            | DIED    |
| W3  | empty conversation still pays the wait           | DIED    |
| W4  | unreadable API skips the wait                    | DIED    |

W1 and W4 SURVIVED the first sweep — the same mistake as B1, one layer down: the
wait helper was tested in isolation while nothing asserted that
`appendPanelArtifacts` uses it. Tests driving the caller kill both.

W3 guards the cost. Most conversations have no generated files, so the API result
gates the wait: when it reports nothing, a single frame is read and no time is
spent. When it reports artefacts — or could not be read at all (W4) — the panel is
waited for, because skipping the wait on an unreadable API collapses "could not
tell" into "no files" again.

Verified on production against the built package, exporting deliberately early:

    panelAtStart  0          (the panel was genuinely absent)
    elapsedMs     14106
    gotFiles      true
    links         5
    unresolved    false

### A timing figure worth recording

A full export of that conversation (32,974 lines, 66 images) took ~6 minutes end
to end. That cost is in the pre-existing scan, not in this change: the artefact
step is one API call plus one resolve per file. It is recorded here because two
full scans of it exceeded a 9-minute probe budget, which is a fact about the
extension a future reader should not have to rediscover.

---

## Wave 7 — the release that became 1.2.0

Three groups of work: a silent turn-loss defect, the export index, and the
archive's memory cost. Every mutant below was applied to the real file, measured
with the exit code read from `npm test` itself, and reverted from a backup copy
rather than by re-editing.

### The scan step (turn loss)

| # | Mutation | Result |
|---|---|---|
| M1 | step by the viewport, ignoring the mounted band | DIED (7) |
| M2 | drop `min(band, viewport)` | **SURVIVED — kept and labelled unproven** |
| M3 | never measure the band (`mountedBand = 0`) | DIED (9) |
| M4 | stop passing the band to `nextScrollTop` | DIED (7) |
| G1 | never report a coverage gap | DIED (3) |
| G2 | credit an empty band as a viewport of coverage | DIED (3) |
| G3 | blind-tail threshold to zero (false positives) | DIED (7) |
| G4 | ignore the blind tail entirely | DIED (5) |
| G5 | drop the 1px seam tolerance | DIED (3) |

**M2 is recorded as a survivor on purpose.** No geometry could be constructed
where the viewport cap changes the outcome — including bands three viewports
tall, weighted above and below the scroll position. Turns in a band taller than
the viewport are already in the DOM and are read in the same round. It is kept
as a conservative bound on a number ChatGPT chooses, and the comment says it is
unproven so it is not later mistaken for a checked invariant.

### The fixture could not express the failure

The defect lost every second turn on a 400px band in an 800px viewport — 30 of
60, returned as a complete export. All 166 tests were green with the defect
present, and green again after the fix, because `createVirtualizedFixture`
derives its mounted page from `scrollTop / clientHeight`: a 0.75-viewport step
always lands on the same page or the next, and can never skip one. A fixture
placing turns at absolute offsets and mounting only those inside a band was
needed before any mutant could die.

### Two false-positive rounds, both recorded in tests

Getting the gap detector to distinguish a real hole from ordinary scrolling took
three attempts, and the two failures are worth as much as the fix:

1. Crediting an unmounted band as a viewport of coverage — reported a gap on
   exports that captured all 40 turns.
2. Judging the stretch past the final turn — the scan always overruns it, so
   every complete export was flagged partial.

A false "partial export" notice tells the user their complete file is
untrustworthy, so both directions have an assertion.

### The blind-tail threshold was measured, not tuned

| geometry | captured | blind tail | in viewports |
|---|---|---|---|
| band 1600 / spacing 300 | 40/40 | −380px | −0.47 |
| band 800 / spacing 300 | 40/40 | −80px | −0.10 |
| band 400 / spacing 300 | 40/40 | 25px | 0.03 |
| band 300 / spacing 300 | 40/40 | 100px | 0.13 |
| band 900 / spacing 800 | 40/40 | 300px | 0.38 |
| **band 200 / spacing 300** | **1/40** | **11 860px** | **14.82** |

One viewport sits in empty space between the two populations rather than on a
boundary either could cross.

### The export index

| # | Mutation | Result |
|---|---|---|
| S1 | ignore `runtime.lastError` after a write | DIED (3) |
| S2 | drop the index byte budget | **SURVIVED → new test → DIED (3)** |
| S3 | unreadable metadata reads as 'unchanged' | DIED (3) |
| S4 | ignore `currentNode` in the comparison | DIED (3) |
| S5 | ignore `messageCount` | DIED (3) |
| S6 | unguarded `chrome.storage` access | DIED (3) |
| S7 | store the whole record verbatim | DIED (7) |

S2 survived because the test that appeared to cover it enforced a 4KB *browser*
quota, so the refusal came from `lastError` rather than from our budget — two
different guards, only one proven. A test with an effectively unlimited browser
quota isolates it.

### The feature was tested; its use was not

| # | Mutation | Before | After |
|---|---|---|---|
| W1 | never skip an unchanged conversation | SURVIVED | DIED (3) |
| W2 | never record an export in the index | SURVIVED | DIED (3) |
| W3 | grown conversation overwrites instead of stamping | SURVIVED | DIED (3) |
| W4 | never read the index at all | SURVIVED | DIED (3) |
| W5 | treat 'unknown' as 'unchanged' | — | DIED (3) |

Every helper had tests. None of them drove `runBatchExport`, so the entire
feature could be deleted with a green suite. This is the same shape as Wave 6's
B1 and W1/W4 — the third occurrence, which is why it is now a rule in
`CLAUDE.md`.

The harness also could not express the failure: its markdown stub answered from a
blind cursor, pairing one conversation's slug with another's id
(`same--<stamp>~c-grew.md`) — a combination the real page cannot produce. It now
answers for the conversation the tab is actually on.

### The archive

| # | Mutation | Result |
|---|---|---|
| Z1 | revert to the per-character base64 loop | DIED (1) |
| Z2 | chunk size not a multiple of 3 (3070) | DIED (2) |
| Z3 | never report a truncated archive | DIED (1) |
| Z4 | remove the zip byte budget | DIED (1) |

Measured cost of encoding a 40MB export to a data: URL:

| implementation | RSS | heap | output |
|---|---|---|---|
| per-character loop | 1510.8MB | 1320.1MB | reference |
| 3-byte-aligned chunks | **2.1MB** | **101.0MB** | byte-identical |

My own earlier estimate in this task was "roughly 3× the payload", read off the
code. Measured, it was **40.9×**, and the cost was in the encoder rather than the
archive. The correctness tests pass with either implementation, so an allocation
test was added and checked to go red on the old code **both with and without
`--expose-gc`**, since `npm test` supplies neither.

### Findings that measurement overturned

- **"Scroll to the remembered phrase and read only updates"** — a turn id does
  survive a reload (`presentImmediately: true`), but walking up from the bottom
  failed to reach a cursor five turns from the end after 200 steps and 146
  seconds. The tail read did see only 67 of 327 turns, so reading less than the
  whole thread saves ~80%; it is the cursor matching that fails. Replaced by a
  metadata comparison that decides whether to walk at all.
- **A first probe reported a flat 28 mounted turns** across six scroll steps,
  which would have suggested these threads are small. It was selecting a
  container by dimensions alone; the shipped rule requires
  `overflowY: auto|scroll|overlay`. Re-measured: **327 turns** and still not
  finished at 400 steps.
- **`chrome.storage` measured before being designed against:** works from the
  popup with no service worker; 800 conversations = 210 743 bytes, 15ms write,
  6ms read; survives a browser restart; hard 10MB quota
  (`Resource::kQuotaBytes quota exceeded` at 10MB); and **absent entirely**
  without the permission, so every access needs a guard rather than a try/catch.
- **The conversation mapping is 4 661 057 bytes** for one thread, which is why
  the index stores five scalars and caches nothing.
