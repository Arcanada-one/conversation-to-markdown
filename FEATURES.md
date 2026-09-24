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

### Local verification build 1.6.0: pagination re-entry

On a long conversation, history loading can stop while its pagination sentinel
remains visible. The climb now moves it out of view and returns, without
extending the failure budget or disturbing an active loading indicator. The
known layout confirms the beginning only when the sentinel is gone and the
first real container has its turn mounted at the top. A stalled pagination
layout remains partial. Live browser measurements reproduced stalls at 71 and
91 containers, recovered them to 81 and 101, and reached 221 containers with
the original first message and no sentinel. The updated extension exported
218 turns: all 207 turns of the earlier complete reference matched in order,
with 11 additional turns. That export still carried
a false start warning: the completed page used an empty paginated-root sibling
instead of client-created-root. Both observed layouts are now recognized, with
the same first-holder guard; this follow-up awaits another live export. File
retrieval remains unresolved. No release is claimed by this entry.

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

**Files offered as links in the answer.** ChatGPT often gives a generated file
as a plain link in its reply rather than as an artefact-panel row, since the
panel lists only what its viewer can open. Verify on a conversation whose answer
links a generated archive: the file must land in the folder, not merely be named
in the `.md`.

**Files the answer only mentions by path.** An archive can reach the reader with
no link, no panel row and no attachment — named in the conversation only as
`/mnt/data/name.zip`, sometimes in a `tool` message the export never shows. The
conversation API carries those paths and each one resolves to a real download,
so the file arrives without any click. Verify on a conversation where ChatGPT
built a `.zip` or a `.diff`: it must land in the folder alongside the `.md`
documents, and exactly once — before 1.5.7 five releases of click-interception
work never fetched it, because every reader searched text that does not contain
the path. A file that cannot be resolved must still be NAMED in the export with
a "Could not retrieve" note; silence there would present a partial export as a
complete one.

**No errors on the extension's own page.** The content script is injected both
declaratively and by the popup, so it must tolerate running twice in one
document. After any export, open `chrome://extensions` and confirm the card
shows no **Errors** button: before 1.4.0 every ordinary export left an
`already been declared` SyntaxError there while still producing a file, so the
extension looked healthy from the outside.

**A bottom that grows is not the bottom.** Because the lower turns are not
mounted while the scan is near the top, the document reports a short height; a
scan that stops there has read only the top of the conversation. The furthest
position visited is checked against the document's final height, and more than
one viewport left below it is reported as partial. Verify on a conversation of
8+ turns that every turn arrives, and that the file carries no partial notice
when it does: before 1.4.0 an 8-turn conversation saved 4 turns silently, and
the generated file attached to a dropped turn went with it.

**A scroll to the top is not the top.** A conversation loads its history in
chunks, so scrolling to position 0 lands mid-thread and the scan then walks
DOWN from there — everything above is lost with no gap between bands to detect,
because the hole is before the first one. Verify by exporting a long
conversation from the bottom: the first turn of the thread must be the first
turn of the file. Measured before the fix on a live thread: the climb settled at
2850 of 0 while the document shrank 6900 → 5750 mid-flight, and a 126KB
conversation exported as 26KB carrying only the last turn's attachment.

**Silence is not the beginning.** The climb stops on a fact, not a timeout: the
first mounted turn must sit in the container ChatGPT marks
`paginated-root:<conversation id>`. Until that is true it keeps climbing, for as
long as the history keeps arriving. This is the slow-connection case, and it is
the one that bites hardest: a fetch slower than the old patience window looked
identical to the end of the thread — unchanged first turn, position already
zero — so the export stopped there and said nothing. A real export lost 299
lines (11%), its opening question included. Verify on a long conversation over a
throttled connection: the first turn of the thread must still be the first turn
of the file, and the export must carry no partial notice when it is. *(The
simulated-delay measurements are fixture-only; the live check is the throttled
export.)*

**The marker is on the container, not on the turn.** That fact is what makes the
paragraph above work, and getting it wrong is how 1.5.7 shipped exports starting
82% into the conversation. The page nests the marked turn:
`<div data-turn-id-container="paginated-root:…">` wrapping
`<section data-turn-id="…" data-turn-id-container="…">` — the section repeats
its OWN id in that attribute, so reading it off the turn never yields the
marker and the check silently never fires. **Verify against the live DOM when
ChatGPT changes its markup**, not against a fixture: open a long conversation,
scroll to the very first turn, and confirm in DevTools that walking up from the
first `[data-turn-id]` reaches an element whose `data-turn-id-container` starts
with `paginated-root`. A fixture built to the wrong shape reports success —
that is exactly what happened here.

**The climb always returns.** A page that keeps looking like it is making
progress — a first turn id that changes every round while the start marker never
matches — used to leave the climb with no exit at all, holding the tab open with
no export and no error. A 10-minute ceiling now ends it, checked after every
other condition so a climb that would finish always does. The limit is in time,
not in rounds, because rounds cap the conversation's length: 3000 turns still
arrive in full. Verify that a normal long export is unaffected; the pathological
page is *(fixture-only)*, since reproducing it live means waiting for ChatGPT to
ship a re-rendering bug.

**A hole is announced even when the cause is unknown.** A climb that never
reached the marker produces a partial notice, and the only exemption is a page
that publishes no marker anywhere — because there, waiting could not help and a
notice on every export would make a true warning meaningless. Verify by
interrupting a long export before it reaches the top: the file must say it is
partial. The failure this prevents is the worse half of the 1.5.7 defect — the
truncation was silent, so there was nothing to tell the user to re-run.

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

**Files offered only as a button.** The export does not click page-owned download
handlers: content-script interception cannot control the page's JavaScript world.
Files with API sandbox paths are still resolved without clicks. A button-only
file with no resolvable path is named in the export as unavailable; it is never
silently omitted or downloaded outside the export folder. Attachment lookup has
a 30-second phase budget independent of the conversation scan. A lookup failure
preserves captured text and reports an incomplete export. Live re-export of the
reported failing conversation is required before claiming this fix complete.

**One walk collects everything.** The scan traverses the conversation once, and
the turns, the artefact rows and the download buttons are all read at each
position while that turn is mounted. There is no second pass. A separate button
traversal used to run afterwards, guarded by "only if nothing was found here" —
and the guard failed the moment any unrelated `behavior-btn` happened to be on
screen: measured on a live thread, the landing position held 2 of them (editing
suggestions like "Make the opening more concrete"), so the traversal never ran
and all 5 download buttons, the `.zip` and `.diff` among them, were missed.
Verify on a conversation whose files are offered in its FIRST reply: they must
arrive when the export is started from the bottom of a long thread.

**Page download isolation.** Saving a conversation does not invoke page-owned
file buttons. Verify that no native attachment appears in the Downloads root
while the extension is collecting files; unresolved files must be disclosed.

**Verify by counting:** export a conversation whose panel lists several
files plus an archive. Every retrievable file must arrive beside the Markdown.
Unavailable files must be named, and no file viewer or native download may be
triggered by the scan.

**Partial lookup preserves progress.** If lookup resolves one file and hangs on
another, the first link remains in the Markdown and reaches the downloader.
Each distinct message id is attempted once per file. Incomplete lookup reports
its stage and numeric HTTP/candidate/resolved counts, without credentials or
signed addresses in the diagnostic line. Verify the actual reported conversation
before claiming automatic retrieval repaired; fixture success alone is not proof.

**Unretrievable files are named.** A file that could not be fetched is listed
with the reason, so an incomplete export never looks complete.

**Local rewriting.** A downloaded file's link in the Markdown is replaced by its
local path, so the signed URL does not survive in the document.

**Link hygiene.** Query parameters are stripped from page links; attachment URLs
keep the parameters their host requires. Verify no `sig=`/`token=` reaches a
saved page link.

**Saving is enabled by default.** Each popup opens with the save option checked.
Uncheck it for clipboard-only output. With the save option unticked, a plain copy makes **no
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

**Files attached to a turn are collected while that turn is on screen.** The
artefact panel is nested inside the turn, not in a sidebar, so its rows are
unmounted with the turn and cannot be read once the scan has scrolled back.
Rows are harvested during the walk instead. **Verify on a conversation where the
files are attached to DIFFERENT answers**, several turns apart: every one must
reach the folder. Reading them afterwards returns only the files of whichever
turn is on screen, which produced two different sets of four on one conversation.

**Every panel row is read, including rows the panel later replaces.** ChatGPT
renders the artefact panel progressively AND swaps its contents as the page
settles — two different sets of four files were measured on one conversation, one
on screen and one in the export. Readings are merged by name across the whole
wait, so a row seen in any frame survives. **Verify by counting**, and by opening
the panel yourself: every name listed there must reach the folder. A file that is
simply absent produces no error line, which is why counting is the check.

**Every panel row is read, including the ones that mount late.** ChatGPT renders
the artefact panel progressively, so the export waits for the row count to settle
rather than reading the first row that appears. **Verify by counting:** open a
conversation whose panel lists four or more files and confirm every one of them
reaches the folder. A conversation once exported four of five files with no
notice at all — the missing one was simply absent from the markdown, which is
why counting is the check and not reading the error line.

**The running version is visible.** The popup shows the loaded version under
its title, read from the manifest rather than written twice. Verify after
reloading an unpacked build that the number matches `manifest.json` — this is how
a reload is confirmed to have taken effect, and four builds once shipped under
one version number with no way to tell them apart from the browser.

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

Published history: 1.1.2, 1.1.6, 1.1.7, 1.1.8, 1.4.0, 1.5.0, 1.5.1, 1.5.2, 1.5.3, 1.5.4, 1.5.5, 1.5.6, 1.5.7, 1.5.8, 1.6.0, 1.6.1, 1.6.2, 1.6.3

The latest entry identifies the prepared local build; it does not imply Chrome
Web Store publication. Attachment retrieval is unchanged in 1.6.0.

**Changelog coupling.** A version bump with no dated CHANGELOG entry fails the
build, because releases 1.1.6 and 1.1.7 reached the store leaving no record of
what changed.
