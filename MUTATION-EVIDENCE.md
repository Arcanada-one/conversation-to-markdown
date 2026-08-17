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
