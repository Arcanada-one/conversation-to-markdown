'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const popup = loadPopupExports();

function loadPopupExports() {
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
      downloads: { download() {} },
      runtime: { lastError: null },
    },
    navigator: { clipboard: { writeText: async () => {} } },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    encodeURIComponent,
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
  vm.runInNewContext(source, context);
  return context.module.exports;
}

function createPopupHarness(runScan, options = {}) {
  const zipSource = fs.readFileSync(path.join(__dirname, '..', 'zip.js'), 'utf8');
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
  // A real checkbox element carries addEventListener; the popup attaches change
  // handlers so the option caveats appear BEFORE the run rather than after it.
  // A stub that is only `{checked}` models an element the DOM does not have.
  function makeCheckbox(checked) {
    return {
      checked: checked,
      _handlers: {},
      addEventListener(event, handler) { this._handlers[event] = handler; },
      dispatchChange() { if (this._handlers.change) return this._handlers.change(); },
    };
  }
  function makeWarning() {
    return {
      classList: {
        _names: new Set(),
        contains(name) { return this._names.has(name); },
        toggle(name, force) {
          if (force === true) this._names.add(name);
          else if (force === false) this._names.delete(name);
          else if (this._names.has(name)) this._names.delete(name);
          else this._names.add(name);
        },
        add(name) { this._names.add(name); },
        remove(name) { this._names.delete(name); },
      },
    };
  }
  // The image checkbox only exists when a test opts into the download path.
  const checkbox = options.downloadImages ? makeCheckbox(true) : null;
  const timestampCheckbox = makeCheckbox(!!options.useTimestamp);
  const batchCheckbox = makeCheckbox(!!options.batchMode);
  const batchWarning = makeWarning();
  const linksWarning = makeWarning();
  // The pause control needs a real element: the popup attaches a listener to
  // it, and the harness default (`return status`) has no addEventListener.
  const pauseButton = {
    textContent: 'Pause',
    disabled: false,
    _handlers: {},
    addEventListener(event, handler) { this._handlers[event] = handler; },
    click() { if (this._handlers.click) return this._handlers.click(); },
    classList: {
      _names: new Set(),
      contains(name) { return this._names.has(name); },
      add(name) { this._names.add(name); },
      remove(name) { this._names.delete(name); },
    },
  };
  const context = {
    document: {
      getElementById: (id) => {
        if (id === 'btn-copy') return button;
        if (id === 'btn-cancel') return cancelButton;
        if (id === 'btn-pause') return pauseButton;
        if (id === 'chk-images') return checkbox;
        if (id === 'chk-timestamp') return timestampCheckbox;
        if (id === 'chk-batch') return batchCheckbox;
        if (id === 'batch-warning') return batchWarning;
        if (id === 'links-warning') return linksWarning;
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
          const funcSource = opts.func ? String(opts.func) : '';
          if (opts.args && /fetchImageDataUrls|extractImageDataUrls/.test(funcSource)) {
            return [{ result: options.extracted || [] }];
          }
          // Only the scan itself is an async injection. The progress probe and
          // the cancellation flag are synchronous one-liners; routing them into
          // runScan would hand them the scan's pending promise and deadlock the
          // very handler under test.
          if (opts.func && opts.func.constructor.name !== 'AsyncFunction') {
            const src = String(opts.func);
            if (runScan && (
              src.includes('listSidebarConversations') ||
              src.includes('extractConversationTitle') ||
              src.includes('waitForConversationReady')
            )) {
              return runScan(opts, button);
            }
            // The injected closure was compiled inside the vm context, so its
            // free `window` resolves against that context's global — not this
            // file's globalThis. Set it where the closure will actually look.
            context.window = { location: { href: 'https://chatgpt.com/' }, __c2mScan: pageScanState };
            try {
              if (opts.args) return [{ result: opts.func(...opts.args) }];
              return [{ result: opts.func() }];
            }
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
        search: (_query, callback) => callback([]),
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
    TextEncoder,
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    buildStoreZip: null,
    module: { exports: {} },
  };
  vm.runInNewContext(zipSource, context);
  context.buildStoreZip = context.module.exports.buildStoreZip;
  context.module = { exports: {} };
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
    batchCheckbox,
    imagesCheckbox: checkbox,
    batchWarningVisible: () => batchWarning.classList.contains('visible'),
    linksWarningVisible: () => linksWarning.classList.contains('visible'),
  };
}

test('the batch caveats appear when the option is ticked, not after the run starts', () => {
  // Both warnings used to be revealed inside the click handler — after the user
  // had already committed. A caveat that arrives then is a status message.
  const harness = createPopupHarness(() => ({ ok: true, md: '#', slug: 's', lines: 1, words: 1 }), {});

  assert.equal(harness.batchWarningVisible(), false, 'nothing to warn about before the option is chosen');
  assert.equal(harness.linksWarningVisible(), false);

  harness.batchCheckbox.checked = true;
  harness.batchCheckbox.dispatchChange();

  assert.equal(harness.batchWarningVisible(), true, 'the popup-must-stay-open caveat must show on ticking batch');
  // Attachment links ChatGPT serves are signed and short-lived, so a project
  // archive that keeps links instead of files is an archive that expires.
  assert.equal(
    harness.linksWarningVisible(),
    true,
    'a batch without the save-files option must warn that links expire'
  );
});

test('the expiring-links caveat disappears once files are being saved', () => {
  const harness = createPopupHarness(
    () => ({ ok: true, md: '#', slug: 's', lines: 1, words: 1 }),
    { downloadImages: true },
  );

  harness.batchCheckbox.checked = true;
  harness.batchCheckbox.dispatchChange();

  assert.equal(harness.batchWarningVisible(), true);
  assert.equal(
    harness.linksWarningVisible(),
    false,
    'with files saved there are no expiring links to warn about'
  );
});

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

test('writes a partial export to the clipboard instead of showing an error', async () => {
  const md = '> **Partial export** — scan was stopped before reaching the end.\n\n# partial body';
  const harness = createPopupHarness(async () => [{
    result: { ok: true, md, partial: true, partialReason: 'cancelled', lines: 2, words: 3 },
  }]);

  await harness.click();

  assert.equal(harness.clipboardValue(), md);
  assert.equal(harness.status.className, 'success');
  assert.match(harness.status.textContent, /partial export/);
  assert.equal(harness.button.disabled, false);
});

test('keeps the original document name and a compound extension', () => {
  const popup = loadPopupExports();

  // A document is worth its own name on disk; `file_001.docx` throws away the
  // one piece of information the user recognises.
  assert.equal(
    popup.artifactFilename('https://files.oaiusercontent.com/file-synth-abc/x', 'Договор.docx', 0, 'Chat', 'file'),
    'Chat-001-Договор.docx',
  );

  // `.tar.gz` truncated to `.gz` misstates what the file is.
  assert.equal(
    popup.artifactFilename('https://files.oaiusercontent.com/file-synth-abc/archive.tar.gz', '', 1, 'Chat', 'file'),
    'Chat-002-archive.tar.gz',
  );

  // No usable name anywhere -> a numbered stub, never an empty or extensionless name.
  assert.equal(
    popup.artifactFilename('https://files.oaiusercontent.com/file-synth-abc/opaque', '', 2, 'Chat', 'file'),
    'Chat-file_003.bin',
  );

  // Images keep the numbered scheme: their label is alt text, not a filename.
  assert.equal(
    popup.artifactFilename('https://files.oaiusercontent.com/file-synth-abc/pic.png', 'a chart of sales', 3, 'Chat', 'image'),
    'Chat-image_004.png',
  );
});

test('never lets an attachment name escape the export folder', () => {
  const popup = loadPopupExports();

  // A label is page-controlled text. Path separators and traversal must not
  // survive into a chrome.downloads filename.
  const escaped = popup.artifactFilename(
    'https://files.oaiusercontent.com/file-synth-abc/x',
    '../../etc/passwd.txt',
    0,
    'Chat',
    'file',
  );
  // The invariant that matters is that no PATH SEPARATOR survives: `..` with no
  // slash is just characters in a filename and cannot leave the folder.
  assert.doesNotMatch(escaped, /[\\/]/);
  assert.match(escaped, /\.txt$/);

  assert.equal(popup.sanitizeFilenamePart('a/b\\c.txt'), 'a-b-c.txt');
  assert.equal(popup.sanitizeFilenamePart('...'), '');
  assert.equal(popup.sanitizeFilenamePart('re<port>:"1".pdf'), 'report1.pdf');
});

test('sets conflictAction explicitly so Chrome does not uniquify to (1).md', async () => {
  const md = '# Title\n\nbody';
  const harness = createPopupHarness(async () => [{
    result: { ok: true, md, title: 'Title', slug: 'Title', lines: 2, words: 1 },
  }], { downloadImages: true, extracted: [] });

  await harness.click();

  const mdDownload = harness.downloads().find((d) => d.filename.endsWith('.md'));
  assert.ok(mdDownload, 'must download the markdown file');
  assert.equal(mdDownload.conflictAction, 'overwrite');
  assert.equal(mdDownload.filename, 'chatgpt-export/Title/Title.md');
});

test('timestamp checkbox produces a stamped filename for re-export', async () => {
  const md = '# chat\n\nbody';
  const harness = createPopupHarness(async () => [{
    result: { ok: true, md, title: 'chat', slug: 'chat', lines: 2, words: 1 },
  }], { downloadImages: true, useTimestamp: true, extracted: [] });

  await harness.click();

  const mdDownload = harness.downloads().find((d) => d.filename.endsWith('.md'));
  assert.match(mdDownload.filename, /chatgpt-export\/chat\/chat--\d{8}-\d{4}\.md$/);
  assert.equal(mdDownload.conflictAction, 'overwrite');
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

test('parseFileRefs collects downloadable attachment links but not arbitrary URLs', () => {
  const md = 'See [notes](https://example.com/page) and [data.csv](https://files.oaiusercontent.com/file-synth-jkl/data.csv).';
  const refs = popup.parseFileRefs(md);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].url, 'https://files.oaiusercontent.com/file-synth-jkl/data.csv');
  assert.equal(refs[0].label, 'data.csv');
  assert.equal(refs[0].kind, 'file');
  assert.equal(popup.isDownloadableFileUrl('https://example.com/file.pdf'), false);
});

test('downloads non-image attachment files alongside images', async () => {
  const md = '# Export\n\n'
    + '![chart](https://files.oaiusercontent.com/file-synth-mno/chart.png)\n'
    + '[report.pdf](https://files.oaiusercontent.com/file-synth-pqr/report.pdf)';
  const harness = createPopupHarness(async () => [{
    result: { ok: true, md, title: 'Export', slug: 'Export', lines: 4, words: 4 },
  }], {
    downloadImages: true,
    extracted: [
      { url: 'https://files.oaiusercontent.com/file-synth-mno/chart.png', dataUrl: 'data:image/png;base64,AAA' },
      { url: 'https://files.oaiusercontent.com/file-synth-pqr/report.pdf', dataUrl: 'data:application/pdf;base64,BBB' },
    ],
  });

  await harness.click();

  const paths = harness.downloads().map((d) => d.filename);
  assert.deepEqual(paths, [
    'chatgpt-export/Export/Export-image_001.png',
    'chatgpt-export/Export/Export-002-report.pdf',
    'chatgpt-export/Export/Export.md',
  ]);
  assert.match(harness.clipboardValue(), /!\[chart\]\(\.\/Export-image_001\.png\)/);
  assert.match(harness.clipboardValue(), /\[report\.pdf\]\(\.\/Export-002-report\.pdf\)/);
  assert.match(harness.status.textContent, /Files: 2\/2 downloaded/);
});

test('batch mode reports per-conversation progress and writes a zip archive', async () => {
  const conversations = [
    { id: 'aaa111', href: '/c/aaa111', title: 'Alpha', slug: 'Alpha' },
    { id: 'bbb222', href: '/c/bbb222', title: 'Beta', slug: 'Beta' },
  ];
  const harness = createPopupHarness(async (opts) => {
    const source = String(opts.func || '');
    if (source.includes('collectSidebarConversations') || source.includes('listSidebarConversations')) {
      return [{ result: { conversations: conversations, complete: true, reason: 'reached-end' } }];
    }
    if (source.includes('extractConversationTitle')) {
      return [{ result: { title: 'My Project', slug: 'My-Project' } }];
    }
    if (source.includes('waitForConversationReady')) {
      return [{ result: { ready: true } }];
    }
    if (source.includes('getConversationMarkdown')) {
      return [{ result: { ok: true, md: '# Alpha\n\nbody', slug: 'Alpha', lines: 2, words: 2 } }];
    }
    return [{ result: null }];
  }, { batchMode: true });

  await harness.click();

  assert.match(harness.status.className, /success/, harness.status.textContent);
  assert.match(harness.status.textContent, /Batch export complete: 2 saved/);
  const zipDownload = harness.downloads().find((item) => item.filename.endsWith('.zip'));
  assert.ok(zipDownload, 'batch must download a zip archive');
  assert.match(zipDownload.filename, /My-Project-export--\d{8}-\d{4}\.zip$/);
});
