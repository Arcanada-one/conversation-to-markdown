'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const popup = loadPopupExports();

function loadPopupExports() {
  const zipSource = fs.readFileSync(path.join(__dirname, '..', 'zip.js'), 'utf8');
  const context = {
    module: { exports: {} },
    document: {
      getElementById: () => ({
        addEventListener() {},
        disabled: false,
        textContent: '',
        classList: { add() {}, remove() {} },
      }),
    },
    chrome: {
      tabs: { query: async () => [] },
      scripting: { executeScript: async () => [] },
      downloads: { download() {}, search(_query, callback) { callback([]); } },
      runtime: { lastError: null },
    },
    navigator: { clipboard: { writeText: async () => {} } },
    TextEncoder,
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    // Real popup globals: the popup is a document, so Blob/URL.createObjectURL
    // exist there. Omitting them would silently exercise the data: fallback and
    // hide the size-ceiling defect the blob path fixes.
    Blob,
    URL,
    Uint8Array,
    encodeURIComponent,
    buildStoreZip: null,
  };
  vm.runInNewContext(zipSource, context);
  context.buildStoreZip = context.module.exports.buildStoreZip;
  context.module = { exports: {} };
  const popupSource = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
  vm.runInNewContext(popupSource, context);
  return context.module.exports;
}

test('formatBatchProgress shows n of N and the current title', () => {
  assert.equal(popup.formatBatchProgress(0, 5, 'First chat'), '1 of 5 — First chat');
  assert.equal(popup.formatBatchProgress(4, 5, null), '5 of 5');
});

test('filterPendingConversations skips paths already downloaded', () => {
  const conversations = [
    { id: 'aaa', slug: 'alpha', title: 'Alpha' },
    { id: 'bbb', slug: 'beta', title: 'Beta' },
  ];
  const completed = new Set(['chatgpt-export/My-Project/alpha/alpha.md']);
  const pending = popup.filterPendingConversations(
    conversations,
    completed,
    'My-Project',
    false,
    null,
  );
  assert.deepEqual(pending.map((item) => item.slug), ['beta']);
});

test('mdDownloadPath nests each conversation under the project folder', () => {
  assert.equal(
    popup.mdDownloadPath('alpha', 'My-Project', false, null),
    'chatgpt-export/My-Project/alpha/alpha.md',
  );
  assert.match(
    popup.mdDownloadPath('alpha', 'My-Project', true, '20260817-1200'),
    /alpha--20260817-1200\.md$/,
  );
});

// ---------------------------------------------------------------------------
// Wave 2e — long-run resilience. A full-project export is a long job over a
// network the extension does not control, so these behaviours are requirements
// rather than niceties: survive a blip, distinguish a dead network from a bad
// conversation, hold and resume, and never re-download what already landed.
// ---------------------------------------------------------------------------

test('resume matches the ABSOLUTE paths chrome.downloads.search really returns', () => {
  const popup = loadPopupExports();

  // This is the whole point of the test: Chrome reports a full filesystem path,
  // while the batch builds a relative one. A fixture that feeds relative paths
  // back models a Chrome that does not exist, and that fixture is exactly why
  // this defect shipped green.
  const absolute = '/Downloads/chatgpt-export/proj/First-chat/First-chat.md';
  const conversations = [{ slug: 'First-chat' }, { slug: 'Second-chat' }];

  const pending = popup.filterPendingConversations(conversations, new Set([absolute]), 'proj');
  assert.equal(pending.length, 1, 'an already-downloaded conversation must be skipped');
  assert.equal(pending[0].slug, 'Second-chat');
});

test('resume recognises its own stamped file, on either platform', () => {
  const popup = loadPopupExports();

  // A stamp records when a past run happened, so a later run cannot reproduce it.
  // Resume therefore collects the stamps present on disk and generates the names that
  // could exist with them. Asserting the OUTCOME rather than an internal key means
  // this test survives a change of mechanism — the previous version asserted a key
  // shape and had to be rewritten when the mechanism changed, which is a sign it was
  // testing the implementation.
  const conv = { id: 'abc123', slug: 'Chat' };
  const posix = '/Downloads/chatgpt-export/proj/Chat/' +
    popup.batchMdFilename('Chat', 'abc123', true, '20260817-1000', false);
  const windows = 'C:\\Downloads\\chatgpt-export\\proj\\Chat\\' +
    popup.batchMdFilename('Chat', 'abc123', true, '20260817-1400', false);

  assert.equal(
    popup.filterPendingConversations([conv], new Set([posix]), 'proj').length, 0,
    'a stamped file this conversation wrote must be recognised');
  assert.equal(
    popup.filterPendingConversations([conv], new Set([windows]), 'proj').length, 0,
    'the same must hold for a Windows path');

  // And an unstamped file from an older version, which is what keeps an upgrade from
  // re-downloading an entire archive.
  assert.equal(
    popup.filterPendingConversations([conv],
      new Set(['/Downloads/chatgpt-export/proj/Chat/Chat.md']), 'proj').length, 0);
});

// A FALSE SKIP is the one resume failure that loses data permanently: the
// conversation is never written, the run reports "already exported", and
// re-running never repairs it. Re-downloading something twice merely costs
// bandwidth. The two directions are not equally bad, so these tests pin the
// safe direction for every way two conversations can collide on a title.
test('two conversations with the SAME title are both exported', () => {
  const popup = loadPopupExports();

  // Duplicate titles are ordinary inside a Project, and "Untitled" is the
  // common case. The slug is derived from the title, so slug-keyed resume makes
  // these two share one key: exporting the first skipped the second forever.
  const conversations = [
    { id: 'aaaaaaaa-1111', slug: 'Untitled', title: 'Untitled' },
    { id: 'bbbbbbbb-2222', slug: 'Untitled', title: 'Untitled' },
  ];
  const firstLanded = new Set([
    '/Downloads/chatgpt-export/proj/Untitled/' +
      popup.batchMdFilename('Untitled', 'aaaaaaaa-1111', false, null, false),
  ]);

  const pending = popup.filterPendingConversations(conversations, firstLanded, 'proj');
  const ids = pending.map((c) => c.id);

  assert.deepEqual(ids, ['bbbbbbbb-2222'], 'the second conversation must still be pending');
});

test('conversations whose titles differ only by case are both exported', () => {
  const popup = loadPopupExports();

  // Directories must fold: on macOS and Windows `Budget/` and `budget/` are the
  // SAME directory. The conversation identity must NOT fold, or interrupting a
  // run after `Budget` landed skips `budget` forever.
  const conversations = [
    { id: 'aaaaaaaa-1111', slug: 'Budget' },
    { id: 'bbbbbbbb-2222', slug: 'budget' },
  ];
  const onlyFirstLanded = new Set([
    '/Downloads/chatgpt-export/proj/Budget/' +
      popup.batchMdFilename('Budget', 'aaaaaaaa-1111', false, null, false),
  ]);

  const pending = popup.filterPendingConversations(conversations, onlyFirstLanded, 'proj');
  assert.deepEqual(pending.map((c) => c.id), ['bbbbbbbb-2222']);
});

test('a slug-less conversation does not skip every other slug-less one', () => {
  const popup = loadPopupExports();

  // Every conversation without a usable title used to key to the same literal
  // `conversation`, so the first one exported skipped all the rest.
  const conversations = [
    { id: 'aaaaaaaa-1111', slug: '' },
    { id: 'bbbbbbbb-2222', slug: '' },
    { id: 'cccccccc-3333', slug: '' },
  ];
  const firstLanded = new Set([
    '/Downloads/chatgpt-export/proj/aaaaaaaa-1111/' +
      popup.batchMdFilename('aaaaaaaa-1111', 'aaaaaaaa-1111', false, null, false),
  ]);

  const pending = popup.filterPendingConversations(conversations, firstLanded, 'proj');
  assert.deepEqual(pending.map((c) => c.id), ['bbbbbbbb-2222', 'cccccccc-3333']);
});

// The id is recovered from the FILENAME, because there is no extension storage
// to consult. That makes the parse load-bearing: get it wrong and resume either
// re-downloads the whole archive every run, or skips something that never
// landed. These pin both directions against the two shapes the earlier fixtures
// never built — the timestamp enabled, and a title containing `--`.
test('resume recognises its own file when the date-time stamp is enabled', () => {
  const popup = loadPopupExports();

  const id = '68a1f2c3-dead-beef-abcd';
  const name = popup.batchMdFilename('Chat', id, true, '20260817-1830', false);
  const pending = popup.filterPendingConversations(
    [{ id: id, slug: 'Chat' }],
    new Set(['/Downloads/chatgpt-export/proj/Chat/' + name]),
    'proj',
  );
  assert.equal(pending.length, 0,
    'a stamped file the run itself wrote must count as already exported: ' + name);
});

test('a title containing a double dash does not confuse resume', () => {
  const popup = loadPopupExports();

  // `--` is legal inside a slug: `slugifyTitle` turns "Build -- v2" into `Build--v2`.
  // Earlier schemes separated the id with `--` too, so a title could forge an id
  // boundary. The id marker cannot appear in a slug, so this class is closed by
  // construction — these cases pin it.
  const id = '68a1f2c3-dead-beef-abcd';
  for (const slug of ['Build--experimental-build', 'Chat--abc', 'A--1']) {
    const name = popup.batchMdFilename(slug, id, false, null, false);
    const own = '/Downloads/chatgpt-export/proj/' + slug + '/' + name;
    assert.equal(
      popup.filterPendingConversations([{ id: id, slug: slug }], new Set([own]), 'proj').length,
      0, slug + ' must be recognised as already exported');
    // A different conversation must NOT be excused by that same file.
    assert.equal(
      popup.filterPendingConversations([{ id: 'other-id', slug: slug }], new Set([own]), 'proj').length,
      1, 'a file naming another id must not excuse this conversation');
  }
});

test('an older stamped export does not skip a conversation whose id looks like a stamp', () => {
  const popup = loadPopupExports();

  // `Chat--20260101-0900.md` written by an older version is an id-LESS stamped export
  // of the title "Chat". It is also, character for character, what a conversation
  // whose id is `20260101-0900` would have been named under the previous scheme. One
  // conversation generating that name is the sole claimant, so no ambiguity guard can
  // fire, and the file — belonging to a different conversation entirely — skipped it.
  //
  // Blocklisting stamp-shaped ids would have been a sixth guess in a row. The cause
  // is that the two name formats shared an alphabet, so the current format now
  // carries a marker no title can contain (see `ID_MARKER`) and the two spaces cannot
  // overlap at all.
  const olderStampedExport = '/Downloads/chatgpt-export/proj/Chat/Chat--20260101-0900.md';
  const conv = { id: '20260101-0900', slug: 'Chat' };

  const pending = popup.filterPendingConversations([conv], new Set([olderStampedExport]), 'proj');
  assert.deepEqual(
    pending.map((c) => c.id),
    ['20260101-0900'],
    'a conversation with no file of its own must never be skipped',
  );

  // Positive control: that conversation's OWN file must still be recognised, or the
  // fix has degenerated into "trust nothing".
  const ownFile = '/Downloads/chatgpt-export/proj/Chat/' +
    popup.batchMdFilename('Chat', '20260101-0900', false, null, false);
  assert.equal(
    popup.filterPendingConversations([conv], new Set([ownFile]), 'proj').length,
    0,
    'the conversation must be skipped once its own file exists',
  );
});

test('no title can forge the marker that introduces a conversation id', () => {
  const parser = require('../content.js');

  // The invariant the design now rests on: a slug cannot contain the id marker, so a
  // name written by an older version can never be mistaken for a current one. Without
  // this, every guard downstream is guessing again.
  const hostile = ['a~b', '~x', 'id~', 'a~~b', 'Chat~~20260101-0900', '~~', '~'];
  for (const title of hostile) {
    const slug = parser.slugifyTitle(title);
    if (slug === null) continue;
    assert.doesNotMatch(
      slug,
      /~/,
      'slug ' + JSON.stringify(slug) + ' from title ' + JSON.stringify(title) +
        ' contains the id marker and could forge an id boundary',
    );
  }
});

test('a title ending in another conversation id does not skip that conversation', () => {
  const popup = loadPopupExports();

  // `slugifyTitle` turns a spaced hyphen into `---`, so "Budget - draft" becomes
  // `Budget---draft`, whose trailing `--`-delimited field is `-draft`. ChatGPT ids
  // are `[A-Za-z0-9-]+`, so `-draft` is a legal id — and asking only "does the
  // trailing field equal a known id?" then read this ordinary older file as an
  // export OF the conversation whose id is `-draft`, skipping that conversation
  // without it ever being written.
  //
  // Matching a field is necessary but NOT sufficient evidence of ownership. The
  // only sufficient evidence is that the whole name is one this conversation would
  // have written.
  const conversations = [
    { id: '-draft', slug: 'Weekly-sync', title: 'Weekly sync' },
    { id: 'k9', slug: 'Budget---draft', title: 'Budget - draft' },
  ];
  const onlyLegacyBudgetLanded = new Set([
    '/Downloads/chatgpt-export/proj/Budget---draft/Budget---draft.md',
  ]);

  const pending = popup.filterPendingConversations(conversations, onlyLegacyBudgetLanded, 'proj');
  assert.ok(
    pending.some((c) => c.id === '-draft'),
    'a conversation with no file of its own must never be skipped; pending was ' +
      JSON.stringify(pending.map((c) => c.id)),
  );
});

test('an id differing only in case does not excuse a conversation', () => {
  const popup = loadPopupExports();

  // The folder and slug are case-folded because macOS and Windows fold them — that
  // follows the filesystem and is right. The ID must NOT be folded: it is the one
  // field the whole design relies on to be unforgeable, and folding it collapses two
  // identities into one key.
  //
  // Not reachable today (ChatGPT ids are lowercase hex), which is why this is
  // hardening rather than a fix. It is recorded and pinned because it is the same
  // assumption — "this name can only mean one thing" — that produced six consecutive
  // silent-loss defects, and it sits one upstream change away from being live.
  const exported = '68a1b2c3-dead-beef-abcd';
  const neverExported = '68A1B2C3-DEAD-BEEF-ABCD';
  const landed = '/Downloads/chatgpt-export/proj/Chat/' +
    popup.batchMdFilename('Chat', exported, false, null, false);

  const pending = popup.filterPendingConversations(
    [{ id: neverExported, slug: 'Chat' }], new Set([landed]), 'proj');
  assert.deepEqual(pending.map((c) => c.id), [neverExported],
    'a conversation whose id differs only in case has its own, different file');

  // Positive control: the actual writer must still be recognised.
  assert.equal(
    popup.filterPendingConversations([{ id: exported, slug: 'Chat' }], new Set([landed]), 'proj').length,
    0, 'the conversation that wrote the file must still be skipped');
});

test('normalisation cannot smuggle the id marker past the strip', () => {
  const parser = require('../content.js');

  // U+FF5E FULLWIDTH TILDE folds to ASCII `~` under NFKC (though not under NFC), so
  // a normalisation form is one plausible way for a title to acquire the marker.
  // What makes that harmless is ORDER: `slugifyTitle` normalises FIRST and strips the
  // marker afterwards, so any tilde a normalisation produces is then removed.
  //
  // The first version of this test asserted only that NFC does not fold the
  // fullwidth tilde — which is true unconditionally, so swapping NFC for NFKC left it
  // green. It was pinning a fact about Unicode rather than a property of this code.
  // This version asserts the ordering, which is the thing that can actually break.
  assert.equal('\uFF5E'.normalize('NFKC'), '~', 'precondition: NFKC folds the fullwidth tilde');

  for (const title of ['Chat\uFF5Eabc', '\uFF5E', 'a\uFF5E\uFF5Eb', 'Chat~abc']) {
    const slug = parser.slugifyTitle(title);
    if (slug === null) continue;
    assert.doesNotMatch(
      slug,
      /~/,
      'slug ' + JSON.stringify(slug) + ' from ' + JSON.stringify(title) +
        ' carries the id marker; the strip must run AFTER normalisation',
    );
  }
});

test('an id-bearing name and an older name cannot be confused', () => {
  const popup = loadPopupExports();

  // The invariant: the current format carries a marker no slug may contain, so the
  // two name spaces are disjoint. Before it, a stamp-shaped id made
  // `Budget--20260817-1200.md` mean two different things and a conversation was
  // skipped though it had never been saved.
  const stampShapedId = '20260817-1200';
  const current = popup.batchMdFilename('Budget', stampShapedId, false, null, false);
  const older = 'Budget--' + stampShapedId + '.md';

  assert.notEqual(current, older, 'the two formats must not produce the same name');
  assert.ok(current.includes(popup.ID_MARKER), 'the current format must carry the marker');
  assert.ok(!older.includes(popup.ID_MARKER), 'an older name cannot contain the marker');

  const conv = { id: stampShapedId, slug: 'Budget' };
  assert.equal(
    popup.filterPendingConversations([conv],
      new Set(['/Downloads/chatgpt-export/proj/Budget/' + older]), 'proj').length,
    1, 'an older stamped export must not excuse a stamp-shaped-id conversation');
  assert.equal(
    popup.filterPendingConversations([conv],
      new Set(['/Downloads/chatgpt-export/proj/Budget/' + current]), 'proj').length,
    0, 'its own file must still be recognised');
});

test('a legacy file is not credited to a conversation whose own file already landed', () => {
  const popup = loadPopupExports();

  // Both files on disk belong to ID1: a v1.5 export and a v1.6 re-export. ID2
  // shares the title and never landed. Counting files rather than resolving
  // OWNERSHIP let ID1 be excused by its id-bearing file without consuming its own
  // legacy file, leaving that credit to be spent by ID2 — a conversation that
  // never landed, skipped and reported as already exported.
  const completed = new Set([
    '/Downloads/chatgpt-export/proj/Budget/' +
      popup.batchMdFilename('Budget', 'ID1', false, null, false),
    '/Downloads/chatgpt-export/proj/Budget/Budget.md',
  ]);
  const sameTitle = [{ id: 'ID1', slug: 'Budget' }, { id: 'ID2', slug: 'Budget' }];

  assert.deepEqual(
    popup.filterPendingConversations(sameTitle, completed, 'proj').map((c) => c.id),
    ['ID2'],
  );
});

test('two history rows for one file do not yield two credits', () => {
  const popup = loadPopupExports();

  // `chrome.downloads.search` returns download HISTORY, so the same relative file
  // can appear under two absolute paths — the Downloads directory moved, or the
  // file was deleted and fetched again. Both normalise to one key, so counting
  // rows invented a second file that does not exist and skipped a second
  // conversation that never landed.
  // Two different absolute roots for the same relative file. (Written without a
  // real home-directory shape: the public-surface gate bans those in tracked
  // files, and it is right to — an absolute home path is the user's name.)
  const twoRowsOneFile = new Set([
    '/downloads-a/chatgpt-export/proj/Budget/Budget.md',
    '/downloads-b/chatgpt-export/proj/Budget/Budget.md',
  ]);

  // Two conversations claim this title, so the file's owner is unknowable and
  // BOTH are re-exported. What must never happen is a second, invented credit
  // excusing a conversation that never landed.
  const sameTitle = [{ id: 'ID1', slug: 'Budget' }, { id: 'ID2', slug: 'Budget' }];
  assert.equal(
    popup.filterPendingConversations(sameTitle, twoRowsOneFile, 'proj').length,
    2,
    'an ambiguous title must re-export, never skip',
  );

  // With a single claimant the title is unambiguous, so the duplicate history rows
  // must still resolve to one recognised file rather than confusing the lookup.
  const oneClaimant = [{ id: 'ID1', slug: 'Budget' }];
  assert.equal(
    popup.filterPendingConversations(oneClaimant, twoRowsOneFile, 'proj').length,
    0,
    'duplicate history rows for an unambiguous title must still be recognised',
  );
});

test('a legacy file whose owner is ambiguous excuses nobody', () => {
  const popup = loadPopupExports();

  // A file written before ids were recorded carries only a title, so when two
  // conversations share that title its owner is genuinely unknowable. Apportioning
  // it — by counting, or by first-come — is a guess, and a wrong guess skips a
  // conversation that never landed, permanently, while reporting success.
  // Ambiguity therefore resolves to re-export: bandwidth, not loss.
  const legacyFile = new Set(['/Downloads/chatgpt-export/proj/Budget/Budget.md']);
  const sameTitle = [{ id: 'ID1', slug: 'Budget' }, { id: 'ID2', slug: 'Budget' }];

  assert.deepEqual(
    popup.filterPendingConversations(sameTitle, legacyFile, 'proj').map((c) => c.id),
    ['ID1', 'ID2'],
    'neither claimant may be skipped on the strength of a file that could belong to either',
  );

  // The unambiguous case must still be recognised, or upgrading from an older
  // version would re-download an entire archive. Without this half, "never trust a
  // legacy file" would pass the assertion above and destroy the upgrade path.
  const single = [{ id: 'ID1', slug: 'Budget' }];
  assert.equal(
    popup.filterPendingConversations(single, legacyFile, 'proj').length,
    0,
    'a legacy file with exactly one claimant must still be recognised',
  );
});

test('classifies a dead network apart from a bad conversation', () => {
  const popup = loadPopupExports();

  // A dropped network is not a property of the conversation being exported. If
  // it were treated as one, a 40-conversation export would fail 39 more times.
  assert.equal(popup.classifyBatchFailure('Failed to fetch'), 'offline');
  assert.equal(popup.classifyBatchFailure('net::ERR_INTERNET_DISCONNECTED'), 'offline');
  assert.equal(popup.classifyBatchFailure('503 Service Unavailable'), 'unreachable');
  assert.equal(popup.classifyBatchFailure('did not load'), 'transient');
  assert.equal(popup.classifyBatchFailure('unexpected parser state'), 'conversation');
});

test('backs off exponentially with a finite ceiling', () => {
  const popup = loadPopupExports();
  assert.equal(popup.backoffDelayMs(1), 1000);
  assert.equal(popup.backoffDelayMs(2), 2000);
  assert.equal(popup.backoffDelayMs(3), 4000);
  // Capped: an unbounded backoff is a hang wearing a retry costume.
  assert.equal(popup.backoffDelayMs(9), 8000);
});

/** Drive the REAL runBatchExport against a fake `chrome`, so the assertions are
 *  about what reached `chrome.downloads` rather than about a mock's own shape.
 *  `downloadBehaviour` decides Chrome's answer per filename. */
function runBatchAgainstFakeChrome(conversations, downloadBehaviour, options, chromeOptions) {
  const attempted = [];
  const chromeOpts = chromeOptions || {};
  const listeners = [];
  const zipSource = fs.readFileSync(path.join(__dirname, '..', 'zip.js'), 'utf8');
  const context = {
    module: { exports: {} },
    console,
    document: {
      getElementById: () => ({
        addEventListener() {}, disabled: false, textContent: '', value: '', checked: false,
        classList: { add() {}, remove() {} },
      }),
    },
    navigator: { clipboard: { writeText: async () => {} }, onLine: true },
    chrome: {
      tabs: { query: async () => [{ id: 1, url: 'https://chatgpt.com/g/g-p-x/project' }] },
      scripting: {
        executeScript: async (o) => {
          const src = String(o.func || '');
          if (o.files) return [];
          if (/location\.href/.test(src)) return [{ result: true }];
          if (/waitForConversationReady/.test(src)) return [{ result: { ready: true } }];
          if (/getConversationMarkdown/.test(src)) {
            const conv = conversations[context.__cursor++ % conversations.length];
            return [{ result: { ok: true, md: '# x\n', markdown: '# x\n', slug: conv.slug, title: conv.title, lines: 1, words: 1, partial: !!conv.partial } }];
          }
          if (/__c2mScan/.test(src)) return [{ result: null }];
          return [{ result: true }];
        },
      },
      downloads: {
        download(o, cb) {
          attempted.push(o.filename);
          // The accept budget reaches downloadOne as a setTimeout delay, so the
          // wrapper below attributes it to the file being written. Observing the
          // value that actually flows through the real code path — rather than
          // asserting the constant — is what makes a mutant that stops PASSING
          // the budget fail this test.
          if (chromeOpts.recordTimeout) {
            // downloadOne arms its timeout BEFORE calling download(), so the most
            // recently observed delay belongs to THIS file.
            chromeOpts.recordTimeout(o.filename, context.__lastDelay);
          }
          // Chrome REJECTS a filename containing a `..` back-reference; it calls
          // the callback with undefined and sets runtime.lastError.
          const accepted = downloadBehaviour(o.filename);
          if (!accepted) {
            context.chrome.runtime.lastError = { message: 'Invalid filename' };
            cb(undefined);
            context.chrome.runtime.lastError = null;
            return;
          }
          const id = attempted.length;
          cb(id);
          // Real Chrome reports COMPLETION separately, after acceptance — the
          // whole reason a blob URL must not be revoked on the callback alone.
          if (chromeOpts.downloadState) {
            setTimeout(() => {
              for (const l of listeners.slice()) {
                l({ id: id, state: { current: chromeOpts.downloadState } });
              }
            }, 0);
          }
        },
        search(_q, cb) { cb([]); },
        onChanged: {
          addListener(l) { listeners.push(l); },
          removeListener(l) {
            const i = listeners.indexOf(l);
            if (i >= 0) listeners.splice(i, 1);
          },
        },
      },
      runtime: { lastError: null },
    },
    __cursor: 0,
    setTimeout: (fn, ms) => {
      context.__lastDelay = ms;
      return setTimeout(fn, 0);
    },
    clearTimeout, setInterval: () => 0, clearInterval() {},
    URL, encodeURIComponent, decodeURIComponent,
    btoa: (v) => Buffer.from(v, 'binary').toString('base64'),
    atob: (v) => Buffer.from(v, 'base64').toString('binary'),
    Uint8Array, TextEncoder, DataView, Math, Date,
    buildStoreZip: null,
  };
  context.window = context;
  vm.runInNewContext(zipSource, context);
  context.buildStoreZip = context.module.exports.buildStoreZip;
  context.module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8'), context);

  const scripting = context.chrome.scripting;
  const original = scripting.executeScript;
  // The real injected function returns the collector's envelope
  // {conversations, complete, reason} — not a bare array. The stub mirrors that
  // shape so a change to the contract shows up here instead of silently
  // yielding `undefined` conversations.
  const listEnvelope = Object.prototype.hasOwnProperty.call(options || {}, 'listEnvelope')
    ? options.listEnvelope
    : { conversations: conversations, complete: true, reason: 'reached-end' };
  scripting.executeScript = async (o) => {
    const src = String(o.func || '');
    if (/collectSidebarConversations|listSidebarConversations/.test(src)) {
      return [{ result: listEnvelope }];
    }
    return original(o);
  };

  return context.module.exports
    .runBatchExport({ id: 1 }, Object.assign({
      downloadImages: false, buildZip: false, useTimestamp: false,
      projectSlug: 'proj', batchStamp: '20260817-1200',
      maxAttempts: 1, maxHoldRounds: 0,
      isPaused: () => false, isCancelled: () => false,
    }, options || {}))
    .then((res) => ({ res, attempted }));
}

test('a rejected write is never counted as an exported conversation', async () => {
  // Chrome rejects any filename with a `..` back-reference. A conversation or
  // project titled ".." produced exactly that, so EVERY write failed — and
  // because downloadOne's result was discarded, the popup reported the whole
  // project as saved. Zero files on disk, "2 saved" on screen. On a backup tool
  // that is the worst possible outcome: the user is told to trust nothing.
  const conversations = [
    { id: 'aaaaaaaa-1111', href: '/c/aaaaaaaa-1111', title: 'One', slug: 'One' },
    { id: 'bbbbbbbb-2222', href: '/c/bbbbbbbb-2222', title: 'Two', slug: 'Two' },
  ];
  const rejectEverything = () => false;

  const { res, attempted } = await runBatchAgainstFakeChrome(conversations, rejectEverything);

  assert.equal(attempted.length, 2, 'both writes must be attempted');
  assert.equal(res.exported, 0, 'a rejected write must not count as exported');
  assert.equal(res.errors.length, 2, 'each rejected write must be reported');
});

test('an accepted write is still counted, so the guard is not blanket', async () => {
  // The positive control: without it, "exported === 0" could pass because
  // nothing is ever counted.
  const conversations = [
    { id: 'aaaaaaaa-1111', href: '/c/aaaaaaaa-1111', title: 'One', slug: 'One' },
  ];
  const { res } = await runBatchAgainstFakeChrome(conversations, () => true);
  assert.equal(res.exported, 1);
  assert.equal(res.errors.length, 0);
});

test('a truncated export is still repairable on the NEXT run', () => {
  const popup = loadPopupExports();

  // Not banking the partial in memory only protects the run that wrote it. The
  // truncated file is on disk and in download history, so the next run's lookup
  // found it and skipped the conversation — refusing the one action that could
  // repair the file. Resume sees filenames and nothing else, so the incompleteness
  // has to be in the NAME, not only in a notice inside the file.
  const partialName = popup.batchMdFilename('Chat', 'abc123', false, null, true);
  const completeName = popup.batchMdFilename('Chat', 'abc123', false, null, false);

  assert.notEqual(partialName, completeName, 'a partial file must not take the complete name');

  const onDisk = new Set(['/Downloads/chatgpt-export/proj/Chat/' + partialName]);
  const pending = popup.filterPendingConversations([{ id: 'abc123', slug: 'Chat' }], onDisk, 'proj');
  assert.equal(pending.length, 1, 'a conversation whose only file is truncated must stay pending');

  // The complete file must of course still be recognised, or nothing is ever skipped.
  const complete = new Set(['/Downloads/chatgpt-export/proj/Chat/' + completeName]);
  assert.equal(
    popup.filterPendingConversations([{ id: 'abc123', slug: 'Chat' }], complete, 'proj').length,
    0,
  );
});

test('a truncated export is reported and NOT banked as done', async () => {
  // A stall-truncated file used to be recorded as complete, so the next run
  // skipped it as "already exported" — the one action that could repair the file
  // was the one action refused, while the popup said success.
  const conversations = [
    { id: 'aaaaaaaa-1111', href: '/c/aaaaaaaa-1111', title: 'One', slug: 'One', partial: true },
  ];
  const { res } = await runBatchAgainstFakeChrome(conversations, () => true);

  assert.equal(res.partial, 1, 'a truncated conversation must be reported as partial');
  assert.ok(
    res.errors.some((e) => /incompletely|re-run/i.test(e)),
    'the user must be told which conversation needs re-running, got: ' + JSON.stringify(res.errors)
  );
});

test('an interrupted archive is not reported as saved', async () => {
  // `waitForDownloadComplete` distinguishes `complete` from `interrupted`, but its
  // answer only matters if the caller reads it. Reporting the archive's name for a
  // write that was interrupted is the same silent-success class this release set
  // out to remove: the popup names a file that is not there.
  const conversations = [{ id: 'aaaa-1111', href: '/c/aaaa-1111', title: 'One', slug: 'One' }];
  const { res } = await runBatchAgainstFakeChrome(
    conversations,
    () => true,
    { buildZip: true },
    { downloadState: 'interrupted' },
  );

  assert.equal(res.exported, 1, 'the conversation itself did land');
  assert.equal(res.zipName, null, 'an interrupted archive must not be named as saved');
  assert.ok(
    res.errors.some((e) => /archive not completed/i.test(e)),
    'the failure must be reported, got: ' + JSON.stringify(res.errors)
  );
});

test('a completed archive IS reported, so the check is not blanket', async () => {
  // Positive control: without it, "zipName === null" would pass for a build that
  // never produces an archive at all.
  const conversations = [{ id: 'aaaa-1111', href: '/c/aaaa-1111', title: 'One', slug: 'One' }];
  const { res } = await runBatchAgainstFakeChrome(
    conversations,
    () => true,
    { buildZip: true },
    { downloadState: 'complete' },
  );

  assert.match(String(res.zipName), /\.zip$/);
  assert.equal(res.errors.length, 0);
});

test('the archive gets a longer accept budget than a single conversation file', async () => {
  // A blob archive can take longer to be ACCEPTED than a small data: URL. If the
  // accept budget were the per-file default, `downloadOne` would report a timeout
  // while Chrome was still reading the blob, and the caller would then revoke the
  // URL mid-write — corrupting the archive and blaming the network.
  //
  // Asserting the constant's value would be tautological (a mutant that stops
  // PASSING it survives), so this asserts the budget actually reaching
  // chrome.downloads for the zip versus for a conversation file.
  const conversations = [{ id: 'aaaa-1111', href: '/c/aaaa-1111', title: 'One', slug: 'One' }];
  const budgets = [];
  const { res } = await runBatchAgainstFakeChrome(
    conversations,
    () => true,
    { buildZip: true },
    { downloadState: 'complete', recordTimeout: (name, ms) => budgets.push({ name, ms }) },
  );

  assert.match(String(res.zipName), /\.zip$/, 'the archive must have been written');
  const zip = budgets.find((b) => /\.zip$/.test(b.name));
  const md = budgets.find((b) => /\.md$/.test(b.name));
  assert.ok(zip && md, 'both a conversation file and an archive must have been attempted');
  assert.ok(
    zip.ms > md.ms,
    'the archive needs a longer accept budget than a conversation file; got zip=' +
      zip.ms + ' md=' + md.ms
  );
});

test('the archive is delivered by handle, not as a megabytes-long URL', () => {
  const popup = loadPopupExports();

  // A `data:` URL cannot carry a project archive — Chrome caps URL length at a
  // couple of megabytes and base64 inflates the payload by a third on the way, so
  // the one workload the zip exists for is the one that would fail, silently.
  // A blob URL is a handle, so size stops mattering.
  const megabyte = new Uint8Array(1024 * 1024);
  const handle = popup.bytesToDownloadUrl(megabyte, 'application/zip');

  assert.ok(handle.url.length < 1000, 'the URL must be a handle, not the payload: got ' + handle.url.length + ' chars');
  assert.match(handle.url, /^blob:/);
  assert.equal(typeof handle.revoke, 'function', 'the caller must be able to release it');
});

test('a paused run holds instead of proceeding, and a cancel releases it', async () => {
  const popup = loadPopupExports();

  let paused = true;
  let cancelled = false;
  let polls = 0;
  const controls = {
    isPaused: () => { polls += 1; if (polls > 2) paused = false; return paused; },
    isCancelled: () => cancelled,
  };
  assert.equal(await popup.waitWhilePaused(controls), true, 'resuming must report the run may continue');
  assert.ok(polls > 1, 'the hold must actually wait rather than fall through');

  // Cancelling while held must release the wait and report "do not continue".
  paused = true;
  cancelled = true;
  assert.equal(await popup.waitWhilePaused(controls), false);
});
