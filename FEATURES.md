# Feature checklist

Every user-visible behaviour the extension ships, one paragraph each. **Walk this
list before every release.**

Two things break features here, and neither shows up as a failing test:

1. **ChatGPT changes its page.** Everything in the Capture and Batch sections
   below reads a live DOM. A renamed attribute or a restructured sidebar breaks
   the feature while every unit test stays green, because the tests run against
   fixtures.
2. **A new feature breaks an old one.** The turn-loss defect fixed in 1.2.0 sat
   behind a scroll-step constant that nothing had reason to revisit.

A checked item means **exercised against chatgpt.com**, not "the test passes".
Items marked *(fixture-only)* cannot be checked any other way and are called out
so the gap is visible rather than assumed away.

## Checking against the live site

Four things waste an hour each time they are rediscovered:

- `waitForSelector('[data-turn-id]')` times out on a perfectly healthy page.
  Turns mounted mid-thread sit outside the viewport and the default is
  `visible: true` — wait for `state: 'attached'`, or poll.
- ChatGPT's Content Security Policy blocks injecting a `<script>` into the page.
  That is precisely why the extension uses `chrome.scripting`, which runs in an
  isolated world the page's CSP does not govern.
- Opening `chrome://extensions` or the popup page **before** loading a
  conversation leaves the conversation tab unable to mount its thread. Do the
  conversation work first.
- A long fixed sleep after navigation is worse than polling: the page re-renders
  and the scan finds nothing to read.

### Last verified: 1.3.0, in Chrome

Driven through the real click handler in a real Chrome, on the shipped package
(not the working tree), with the operator's own failing case as the fixture:

    save on   877,050 chars Cyrillic -> blob: URL, content byte-identical,
              file Кадры-решают-всё--20260819-1156.md, status "✓ Saved",
              clipboard NOT written
    the ceiling that broke it: the same payload as a data: URL is 4.53 MB
    refusal   Chrome refuses the .md -> red "Not saved: Invalid filename",
              never a success message  (negative control)
    save off  0 downloads, clipboard holds the full markdown, "✓ Copied!"
    options   two checkboxes; ticking batch sets AND disables file saving,
              unticking releases it

Not verified in this pass: a whole-Project batch against the live site, and the
skip on a second run. Both need a multi-hour run against chatgpt.com.

### Not shipped: 1.2.0

1.2.0 was tagged and released on GitHub but **never published to the Web Store**.
It carries the `data:` URL defect above, which fails the save path for any long
Russian conversation — the case it was most needed for. 1.3.0 supersedes it.

### Last verified: 1.2.0, against chatgpt.com

    full export     32 964 lines, 564 turns, partial: false, 342s
    metadata read   updateTime + currentNode + messageCount 1146, one request
    filename        PUA codepoint 0x5FFFF stripped; Cyrillic and diacritics kept

Not checked live in 1.2.0, and worth doing when a multi-hour run is possible: a
whole-Project batch, the second-run skip, and the stamped copy of a grown
conversation. All three are covered by tests driving the real `runBatchExport`.

## How to keep this file honest

- Adding a feature means adding a paragraph here **in the same change**. A test
  in `tests/public-surface.test.js` fails when a release adds a CHANGELOG entry
  without touching this file, so the two cannot drift apart silently.
- Removing a feature means deleting its paragraph, not leaving it as history.
- The paragraph states what the user gets, and — where a past defect makes it
  worth saying — what failure it exists to prevent. A checklist item nobody can
  verify from its own text is not a checklist item.

---

## Capture

**Long conversations.** A conversation of any length exports in full. The scan
ends when the conversation ends, when it genuinely stops making progress, or when
the user stops it — never on a timer. Verify on a thread of several hundred turns;
the measured example is 564 turns (32 964 lines) in 342 seconds.

**Virtualized turns.** ChatGPT mounts only a band of the conversation at a time.
The scan never advances further than the band actually mounted, measured from the
DOM. Verify on a heavy thread (long turns, images, code blocks): before 1.2.0 a
narrow band lost every second turn and reported a complete export.

**Coverage honesty.** A scan that travelled part of the document with nothing
mounted reports a partial export rather than presenting a hole as a complete
conversation. Verify that a normal complete export is **not** flagged — a false
"partial" is worse than none.

**Markdown fidelity.** Paragraphs, headings, lists, blockquotes, links, code,
tables and visible generated images survive. Multiple segments of one turn are
combined rather than only the first paragraph.

**Role headings.** Turns are labelled `#### You said:` and `#### ChatGPT said:`.
Assistant messages are captured even on turns where the page omits the
author-role attribute.

**Title and heading.** The export is named after the sidebar title and carries it
as the document's `#` heading. Verify with a title containing Cyrillic, emoji and
CJK: all three are legal in a filename and must survive.

**Filename safety.** A title Chrome cannot put in a filename is sanitised rather
than passed through. Verify a title with a Private Use Area codepoint — one such
conversation used to save nothing at all, silently.

**Unrenderable turns.** One message that never paints does not cost the rest of
the conversation.

**Scroll restoration.** The reading position is restored after success and after
failure.

**Live progress and Stop.** Messages captured and seconds elapsed are shown while
scanning, and **Stop scanning** works at any point, keeping what was captured.

**Partial reporting.** An incomplete scan is reported instead of being copied out
as if whole.

## Files and artifacts

**All attachment types.** Not only images: PDF, Word, spreadsheets, archives.
What may be saved is decided by the host serving the file, never by its
extension.

**Generated files.** Documents ChatGPT produced during the conversation appear in
no link on the page. They are listed under a **Files** heading. Verify against a
conversation whose files were generated by the code interpreter — these were
skipped silently by every selector the extension shipped before 1.2.0.

**Unretrievable files are named.** A file that could not be fetched is listed
with the reason, so an incomplete export never looks complete.

**Local rewriting.** A downloaded file's link in the Markdown is replaced by its
local path, so the signed URL does not survive in the document.

**Link hygiene.** Query parameters are stripped from page links; attachment URLs
keep the parameters their host requires. Verify no `sig=`/`token=` reaches a
saved page link.

**Files are opt-in.** With the save option unticked, a plain copy makes **no
network request of any kind** — enforced by a test as well as by the privacy
policy.

**Save and copy are separate outcomes.** With the save option ticked the export
goes to disk and the clipboard is left alone; without it the clipboard IS the
delivery. Verify both. Until 1.3.0 the save path also wrote the clipboard, and a
clipboard rejection — routine, since the popup loses focus during a long scan —
replaced an already-displayed success with a red error over a file that was
safely on disk.

**A refused write is reported as a failure.** If the browser refuses to write the
markdown, the run says so and names the reason instead of reporting success.
Verify by exporting to a full disk or a refused path — before 1.3.0 the refusal
flag was returned by the code and read by nothing, so "✓ Copied!" appeared over
an empty folder.

**A large Russian conversation saves.** The markdown is written through a blob,
not a `data:` URL. Verify on a long Cyrillic conversation of 300+ turns:
`encodeURIComponent` expands Cyrillic 4.99x, so a 600-turn Russian export
produced a 4.17 MB URL against Chrome's ~2 MB ceiling and was refused, while
every English conversation of the same length saved normally.

**Attachments never cost the conversation.** A failure fetching files still
writes the markdown, and names the failure. Verify by exporting with the tab
navigating mid-run: the .md must land.

## Batch export (Projects)

**Whole-Project export.** Every conversation in a Project exports in one run,
each into its own folder, optionally bundled into one `.zip`. Choosing a batch
switches file saving on and holds it there: an archive built without it contains
signed, short-lived LINKS rather than files, so it looks complete on the day it
runs and is empty hours later. Verify the save option is ticked and disabled the
moment the batch box is ticked, and released when it is unticked.

**List completeness.** The virtualized sidebar is walked to the end and every row
verified as observed with no gaps. An unconfirmed walk is reported as
unconfirmed. Verify on a Project of 100+ conversations — an unmatched pagination
control used to make a partial list report as complete.

**Any interface language.** Pagination, titles and download controls are located
by page structure, not English wording. Verify with the browser language set to
Russian **and** to one other language: ChatGPT translates its UI by browser
locale, not by account setting.

**Long-run survival.** Transient failures retry with capped backoff; a dropped
network or unreachable site pauses the run instead of consuming the remaining
list; pause, resume and cancel all work, and cancelling keeps what landed.

**Navigation correctness.** Each conversation is navigated to, the content script
re-injected into the new document, and the thread confirmed rendered before
capture. Verify the exported count matches the conversations actually saved —
before 1.2.0 the counter counted attempts, and a whole batch could write nothing
while reporting progress.

**Resume.** A restarted export skips what already landed, identifying each
conversation by its ChatGPT id, so conversations sharing a title (several called
"Untitled") never mask one another. Verify by deleting one exported file and
re-running: that conversation must be re-exported, the rest skipped.

**Unchanged conversations are skipped.** A conversation whose metadata matches
what was recorded is skipped without being re-read. Verify the run reports them
as unchanged. This decision reads the export INDEX, never a filename — with every
export stamped, a rebuilt filename can never match, so a build that fell back to
name matching would re-export the whole project on every run.

**Grown conversations get a new dated copy.** A conversation that gained messages
is written beside the earlier file under its own stamp; the old file is
untouched, because a Chrome extension cannot append to a file. Verify by adding a
message to an exported conversation and re-running: two files, both readable.

**Every export is stamped.** The filename always carries the date and time the
export was taken, so a folder of backups is readable without opening the files
and no export silently replaces another. Verify that a second run of the same
project produces new dated files and leaves the earlier ones untouched. The
separator is a DOUBLE hyphen: `slugifyTitle` turns spaces into single hyphens, so
a single one would be indistinguishable from a word break in the title.

**Archive budget.** The `.zip` stops accumulating at a memory budget and reports
the files it left out. Verify a large project still produces a usable archive, or
says what is missing — the saved files on disk are complete regardless.

## Privacy and permissions

**Local only.** No telemetry, no analytics, no server, no third party. The
developer has no access to conversations, files or clipboard.

**Permission set.** Exactly `clipboardWrite`, `scripting`, `downloads`,
`storage`. Locked by an exact-set test: an added permission must be a deliberate
edit. Verify the Web Store listing's permission warnings match.

**The export index.** Five scalars per exported conversation, in
`chrome.storage.local`, never `sync`. No conversation content, markdown or title
is stored — enforced by test. Verify the index survives a browser restart and
that removing the extension discards it.

**Privacy policy accuracy.** `PRIVACY.md` describes every declared permission; a
test fails if one is undocumented.

## Release mechanics

**One version bump per release.** The manifest and `package.json` version must
match the CHANGELOG's top entry, and users must never see a gap. The last entry
below is the version being shipped; a test checks this line against the CHANGELOG
so a release cannot be added without revisiting this file.

Published history: 1.1.2, 1.1.6, 1.1.7, 1.1.8, 1.3.0

**Changelog coupling.** A version bump with no dated CHANGELOG entry fails the
build, because releases 1.1.6 and 1.1.7 reached the store leaving no record of
what changed.
