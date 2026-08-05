'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createPopupHarness(runScan, options = {}) {
  let clickHandler;
  let clipboardValue = null;
  let scriptCalls = 0;
  const downloads = [];
  const injected = [];
  // Stands in for the page's window.__c2mScan the scan loop reads.
  const pageScanState = { cancelled: false, captured: 0, observed: 0, elapsedMs: 0 };
  const button = {
    disabled: false,
    textContent: 'Copy as Markdown',
    addEventListener(_event, handler) {
      clickHandler = handler;
    },
  };
  const status = { className: '', textContent: '' };
  // Stop control: the scan has no deadline, so cancelling is the operator's
  // only way to end a long run early. It must exist for popup.js to load.
  let cancelHandler;
  const cancelClasses = new Set();
  const cancelButton = {
    disabled: false,
    textContent: 'Stop scanning',
    classList: {
      add: (name) => cancelClasses.add(name),
      remove: (name) => cancelClasses.delete(name),
      contains: (name) => cancelClasses.has(name),
    },
    addEventListener(_event, handler) {
      cancelHandler = handler;
    },
  };
  // The image checkbox only exists when a test opts into the download path.
  const checkbox = options.downloadImages ? { checked: true } : null;
  const context = {
    document: {
      getElementById: (id) => {
        if (id === 'btn-copy') return button;
        if (id === 'btn-cancel') return cancelButton;
        if (id === 'chk-images') return checkbox;
        return status;
      },
    },
    chrome: {
      tabs: { query: async () => [{ id: 7, url: 'https://chatgpt.com/' }] },
      scripting: {
        executeScript: async (opts) => {
          scriptCalls += 1;
          injected.push(opts);
          if (opts.files) return [];
          if (opts.args) return [{ result: options.extracted || [] }];
          // Only the scan itself is an async injection. The progress probe and
          // the cancellation flag are synchronous one-liners; routing them into
          // runScan would hand them the scan's pending promise and deadlock the
          // very handler under test.
          if (opts.func && opts.func.constructor.name !== 'AsyncFunction') {
            // The injected closure was compiled inside the vm context, so its
            // free `window` resolves against that context's global — not this
            // file's globalThis. Set it where the closure will actually look.
            context.window = { __c2mScan: pageScanState };
            try { return [{ result: opts.func() }]; }
            finally { context.window = undefined; }
          }
          return runScan(opts, button);
        },
      },
      downloads: {
        download: (opts, callback) => {
          downloads.push(opts);
          callback(downloads.length);
        },
      },
      runtime: { lastError: null },
    },
    navigator: {
      clipboard: {
        writeText: async (value) => {
          clipboardValue = value;
        },
      },
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    encodeURIComponent,
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
  vm.runInNewContext(source, context);
  return {
    button,
    status,
    cancelButton,
    cancelVisible: () => cancelClasses.has('visible'),
    injected: () => injected,
    pageScanState: () => pageScanState,
    clickCancel: () => cancelHandler(),
    click: () => clickHandler(),
    clipboardValue: () => clipboardValue,
    scriptCalls: () => scriptCalls,
    downloads: () => downloads,
  };
}

test('waits for asynchronous scanning before writing Markdown to the clipboard', async () => {
  let resolveScan;
  const pendingScan = new Promise((resolve) => {
    resolveScan = resolve;
  });
  const harness = createPopupHarness((options, button) => {
    assert.equal(button.textContent, 'Scanning conversation…');
    assert.equal(options.func.constructor.name, 'AsyncFunction');
    return pendingScan;
  });

  const click = harness.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.clipboardValue(), null);
  assert.equal(harness.button.disabled, true);
  assert.equal(harness.button.textContent, 'Scanning conversation…');

  resolveScan([{ result: { ok: true, md: '# complete', lines: 1, words: 2 } }]);
  await click;

  assert.equal(harness.scriptCalls(), 2);
  assert.equal(harness.clipboardValue(), '# complete');
  assert.equal(harness.status.className, 'success');
  assert.equal(harness.button.disabled, false);
  assert.equal(harness.button.textContent, 'Copy as Markdown');
});

test('shows an incomplete-scan error without touching the clipboard', async () => {
  const harness = createPopupHarness(async () => [{
    result: { ok: false, error: 'Conversation scan is incomplete.' },
  }]);

  await harness.click();

  assert.equal(harness.clipboardValue(), null);
  assert.equal(harness.status.className, 'error');
  assert.equal(harness.status.textContent, 'Conversation scan is incomplete.');
  assert.equal(harness.button.disabled, false);
});

test('prefixes downloaded image names with the conversation slug', async () => {
  const md = '# Агент Аркана\n\n![first](https://files.oaiusercontent.com/a.png?v=1)\n'
    + '![second](https://files.oaiusercontent.com/b.jpg?v=2)';
  const harness = createPopupHarness(async () => [{
    result: { ok: true, md, title: 'Агент Аркана', slug: 'Агент-Аркана', lines: 3, words: 5 },
  }], {
    downloadImages: true,
    extracted: [
      { url: 'https://files.oaiusercontent.com/a.png?v=1', dataUrl: 'data:image/png;base64,AAA' },
      { url: 'https://files.oaiusercontent.com/b.jpg?v=2', dataUrl: 'data:image/jpeg;base64,BBB' },
    ],
  });

  await harness.click();

  const paths = harness.downloads().map((d) => d.filename);
  assert.deepEqual(paths, [
    'chatgpt-export/Агент-Аркана/Агент-Аркана-image_001.png',
    'chatgpt-export/Агент-Аркана/Агент-Аркана-image_002.jpg',
    'chatgpt-export/Агент-Аркана/Агент-Аркана.md',
  ]);

  // The saved Markdown must point at the same slug-prefixed local files.
  assert.match(harness.clipboardValue(), /!\[first\]\(\.\/Агент-Аркана-image_001\.png\)/);
  assert.match(harness.clipboardValue(), /!\[second\]\(\.\/Агент-Аркана-image_002\.jpg\)/);
});

test('falls back to unprefixed image names when the conversation has no title', async () => {
  const md = '![only](https://files.oaiusercontent.com/c.png?v=3)';
  const harness = createPopupHarness(async () => [{
    result: { ok: true, md, title: null, slug: null, lines: 1, words: 1 },
  }], {
    downloadImages: true,
    extracted: [{ url: 'https://files.oaiusercontent.com/c.png?v=3', dataUrl: 'data:image/png;base64,CCC' }],
  });

  await harness.click();

  assert.deepEqual(harness.downloads().map((d) => d.filename), [
    'chatgpt-export/image_001.png',
    'chatgpt-export/conversation.md',
  ]);
});

test('shows an execution failure and restores the button', async () => {
  const harness = createPopupHarness(async () => {
    throw new Error('Page execution failed.');
  });

  await harness.click();

  assert.equal(harness.clipboardValue(), null);
  assert.equal(harness.status.className, 'error');
  assert.equal(harness.status.textContent, 'Page execution failed.');
  assert.equal(harness.button.textContent, 'Copy as Markdown');
});

test('the stop control is offered during a scan and withdrawn after it', async () => {
  // A scan has no deadline, so the operator's ability to stop it is the only
  // exit from a run they decide is too long. If the control is not visible
  // while scanning, that exit does not exist.
  let resolveScan;
  const pendingScan = new Promise((resolve) => { resolveScan = resolve; });
  const harness = createPopupHarness(() => pendingScan);

  const click = harness.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.cancelVisible(), true, 'stop must be reachable mid-scan');

  resolveScan([{ result: { ok: true, md: '# done', lines: 1, words: 2 } }]);
  await click;
  assert.equal(harness.cancelVisible(), false, 'stop disappears once the scan ends');
});

test('pressing stop sets the page cancellation flag', async () => {
  let resolveScan;
  const pendingScan = new Promise((resolve) => { resolveScan = resolve; });
  const harness = createPopupHarness(() => pendingScan);

  const click = harness.click();
  await new Promise((resolve) => setImmediate(resolve));
  await harness.clickCancel();

  // Prove the flag the scan loop actually reads was flipped, rather than
  // merely asserting that some message was sent.
  assert.equal(harness.pageScanState().cancelled, true, 'the page-side cancel flag must be set');

  resolveScan([{ result: { ok: true, md: '# partial', lines: 1, words: 2 } }]);
  await click;
});
