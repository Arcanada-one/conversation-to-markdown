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
    URL,
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
