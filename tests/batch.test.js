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

test('resume survives a timestamped filename and Windows separators', () => {
  const popup = loadPopupExports();

  // With the date-time stamp enabled the name carries the CURRENT run's stamp,
  // so a file from a previous run can never match by name. Identity is the
  // folder plus the stem, stamp stripped.
  const run1 = popup.completionKeyForPath('/Downloads/chatgpt-export/proj/Chat/Chat--20260817-1000.md');
  const run2 = popup.completionKeyForPath('C:\\Downloads\\chatgpt-export\\proj\\Chat\\Chat--20260817-1400.md');
  const expected = popup.completionKeyForConversation('Chat', 'proj');

  assert.equal(run1, run2, 'two runs of the same conversation must share one key');
  assert.equal(run1, expected, 'the key must match what the batch will look up');
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
    '/Downloads/chatgpt-export/proj/Untitled/Untitled--aaaaaaaa-1111.md',
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
    '/Downloads/chatgpt-export/proj/Budget/Budget--aaaaaaaa-1111.md',
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
    '/Downloads/chatgpt-export/proj/aaaaaaaa-1111/aaaaaaaa-1111--aaaaaaaa-1111.md',
  ]);

  const pending = popup.filterPendingConversations(conversations, firstLanded, 'proj');
  assert.deepEqual(pending.map((c) => c.id), ['bbbbbbbb-2222', 'cccccccc-3333']);
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
function runBatchAgainstFakeChrome(conversations, downloadBehaviour, options) {
  const attempted = [];
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
          // Chrome REJECTS a filename containing a `..` back-reference; it calls
          // the callback with undefined and sets runtime.lastError.
          const accepted = downloadBehaviour(o.filename);
          if (!accepted) {
            context.chrome.runtime.lastError = { message: 'Invalid filename' };
            cb(undefined);
            context.chrome.runtime.lastError = null;
            return;
          }
          cb(attempted.length);
        },
        search(_q, cb) { cb([]); },
        onChanged: { addListener() {}, removeListener() {} },
      },
      runtime: { lastError: null },
    },
    __cursor: 0,
    setTimeout: (fn) => setTimeout(fn, 0),
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
  scripting.executeScript = async (o) => {
    const src = String(o.func || '');
    if (/listSidebarConversations/.test(src)) return [{ result: conversations }];
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
