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
