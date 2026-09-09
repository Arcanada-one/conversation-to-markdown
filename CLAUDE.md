# Working rules for this repository

Read this before changing anything here. These are not style preferences — each
one exists because ignoring it shipped a defect or would have.

## Versioning: one bump per release, never per change

**The published version is what users see. A gap in it is a bug they can read.**

- Bump the version **once**, when the release is actually prepared — not as work
  lands. In this repository's history seven bumps happened inside one unreleased
  branch, taking `1.1.8` (the published version) to `1.8.0`. Users would have seen
  six minor versions appear with no releases behind them. The branch shipped as
  `1.2.0`.
- Before bumping, check what is **actually published** on the Chrome Web Store,
  not what the repository says. They diverge exactly when this rule is broken.
- `manifest.json`, `package.json` and the top `CHANGELOG.md` entry move together.
  Tests enforce the coupling; that is a backstop, not permission to bump freely.
- Published so far: 1.1.2, 1.1.6, 1.1.7, 1.1.8, 1.2.0.

## FEATURES.md is part of every feature

`FEATURES.md` is the pre-release checklist: one paragraph per user-visible
behaviour, walked by hand against chatgpt.com before a release.

- **A new feature adds its paragraph in the same change.** A test fails when a
  CHANGELOG version is added without touching `FEATURES.md`.
- A removed feature loses its paragraph.
- Write what the user gets, plus the failure it prevents where a past defect
  makes that worth stating. Add *(fixture-only)* when the item genuinely cannot be
  checked against the live site, so the gap stays visible.

Why by hand: everything in the Capture and Batch sections reads a live DOM. When
ChatGPT renames an attribute the feature breaks and every unit test stays green,
because the tests run against fixtures.

## Tests must be able to fail

The recurring defect class in this repository is a green suite over broken
behaviour. Both halves have happened repeatedly:

- **The fixture cannot express the failure.** The turn-scan fixture derived its
  mounted page from `scrollTop / clientHeight`, so a scroll step could never skip
  a page — 166 tests stayed green with a defect that lost every second turn, and
  green again after the fix. Before trusting a passing test, ask whether its
  fixture can produce the failure at all.
- **The helper is tested, its use is not.** A batch feature had tests for every
  helper and none driving `runBatchExport`; five mutants deleting the whole
  feature survived. Drive the real entry point.

So: **mutate the code and confirm the test goes red.** Read the exit code from
the command itself (`npm test`, not a pipeline whose last stage always exits 0),
and restore from a backup copy rather than by re-editing. A guard that no mutant
can kill is either dead or unfalsifiable — say which, in a comment, rather than
leaving it to look verified.

Add a **positive control** whenever a test asserts an absence: prove the fixture
reaches the condition, or the assertion is vacuous.

## Measure before designing

Several plausible designs in this repository were wrong, and only measurement
showed it:

- "Remember the last exported turn and scroll straight to it" — a turn id does
  survive a reload, but walking up to it failed after 200 steps and 146 seconds.
- "The archive uses about 3x the payload" — read off the code; measured at
  **40.9x**, and the cost was in the base64 encoder, not the archive.
- Thresholds: separate the two populations by measuring both, then put the
  threshold in the empty space between them. Do not tune a constant until output
  looks right.

State the measured numbers in the commit message and in a comment where the
constant lives.

## Failure directions are not symmetric

A **wrong skip** loses a conversation permanently and re-running cannot repair
it. A **needless export** costs bandwidth. Every uncertain answer therefore
resolves towards exporting: unreadable metadata, a missing index, an absent
permission.

Likewise, never report success you cannot support. Reaching the bottom of a
document is not proof of having read it; a filename match is not proof a file
exists; download-history rows survive the file being deleted.

And a **false warning is a real cost too** — a "partial export" notice on a
complete file tells the user their good data is untrustworthy. Both directions
need a test.

## Silent failure is the enemy

- `chrome.downloads.download` reports **acceptance, not completion**.
- `chrome.storage` quota failures arrive through `runtime.lastError`; an
  unchecked write is indistinguishable from success.
- Without the `storage` permission `chrome.storage` is **undefined** — absence,
  not a throwing call. Guard every access.
- An out-of-memory kill takes the popup's document with it: no `catch` runs, no
  status is written. Bound memory rather than relying on error handling.
- A partial export is never banked as done, or the one action that could repair
  it — re-running — is the action that gets skipped.

## Privacy is a promise, and promises get out of date

`PRIVACY.md` and `README.md` make factual claims about behaviour. When behaviour
changes, **retract the claim in the same commit**. The document said the
extension "deliberately stores no state of its own" while a change was adding
the `storage` permission, and README claimed Chrome preserves the old file on
re-export while the code passes `conflictAction: 'overwrite'`.

The permission set is locked by an exact-set test. Adding a permission means
editing that lock deliberately and explaining the cost in the comment — a
permission nobody reviewed is an over-broad-permission finding in Web Store
review.

## Web Store review is slow, so correctness is cheap by comparison

A review can take a week. A defect that ships is a week of users having a bad
experience plus another week to fix. Before submitting: full suite green,
`npm run check` clean, `FEATURES.md` walked against the live site, and the
version bumped exactly once.

## Stage before you test

Some gates read `git ls-files`, so an untracked new file is invisible to them.
Running the suite before `git add` is the one window in which the allowlist check
cannot see the file it exists to check — CI then fails on something that was
green locally a minute earlier.

For any change that ADDS a file: stage first, then run the suite.

## Test in the language the product fails in

The defect that cost a user a 600-turn export was invisible to every test in the
suite, because every fixture was English. `encodeURIComponent` leaves ASCII alone
and expands Cyrillic 4.99x, so a Russian conversation crossed Chrome's URL ceiling
near 300 turns while an English one of the same length saved fine past 1,500.

The users of this extension export Russian conversations. A fixture that cannot
reach the failing size is the "fixture cannot express the failure" trap wearing a
different hat — and it stayed green for the whole life of the defect.

## `var` inside a handler shadows the module scope

`var status = ...` inside the click handler hoisted over the module-level
`status` ELEMENT and made the handler throw on its own first line. Prefer a
distinct name for locals in long handlers; the elements are module-level `const`
and share the obvious nouns (`status`, `button`).

## Practical notes

- No runtime or build dependencies; tests are `node:test` with hand-rolled
  DOM/chrome shims. Keep it that way.
- `npm test` runs everything; `npm run check` is a syntax gate over the three
  shipped scripts.
- `content.js` runs inside the ChatGPT page. It must not persist anything —
  `chrome.storage` is banned there by test, on purpose.
- Never commit a real conversation URL: a repository test scans for
  `chatgpt.com/c/<id>` and treats it as a privacy leak. Split the literal if a
  fixture needs to look like one.
