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
  vm.runInNewContext(source, context, { filename: path.join(__dirname, '..', 'popup.js') });
  return context.module.exports;
}

function createPopupHarness(runScan, options = {}) {
  const zipSource = fs.readFileSync(path.join(__dirname, '..', 'zip.js'), 'utf8');
  let clickHandler;
  let clipboardValue = null;
  let scriptCalls = 0;
  const downloads = [];
  const downloadListeners = new Set();
  const injected = [];
  const blobs = [];
  const blobUrls = new Map();
  const timerDelays = [];
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
  // The image checkbox only exists when a test opts into the download path,
  // or when it needs to toggle that option without starting it on.
  const checkbox = (options.downloadImages || options.imagesPresent) ? makeCheckbox(!!options.downloadImages) : null;
  const htmlCheckbox = makeCheckbox(!!options.htmlChecked);
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
        if (id === 'chk-html') return htmlCheckbox;
        if (id === 'chk-timestamp') return timestampCheckbox;
        if (id === 'chk-batch') return batchCheckbox;
        if (id === 'batch-warning') return batchWarning;
        if (id === 'links-warning') return linksWarning;
        return status;
      },
    },
    chrome: {
      tabs: { query: async () => [{ id: 7, url: options.tabUrl || 'https://chatgpt.com/' }] },
      scripting: {
        executeScript: async (opts) => {
          scriptCalls += 1;
          injected.push(opts);
          if (opts.files) return [];
          const funcSource = opts.func ? String(opts.func) : '';
          // The Retry probe is its own injection. Routing it into runScan would
          // hand the scan result to the wait, and a page that is simply ready
          // would look like a second scan.
          if (funcSource.includes('waitForConversationReady')) {
            const ready = typeof options.readyResult === 'function'
              ? options.readyResult(opts)
              : { ready: true };
            return [{ result: ready }];
          }
          if (funcSource.includes('clickConversationRetry')) {
            if (options.onRetryClick) options.onRetryClick();
            return [{ result: true }];
          }
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
          if (options.rejectDownload && options.rejectDownload(opts.filename)) {
            context.chrome.runtime.lastError = { message: 'write refused' };
            callback(undefined);
            context.chrome.runtime.lastError = null;
            return;
          }
          const id = downloads.length;
          callback(id);
          setTimeout(() => {
            for (const listener of downloadListeners) {
              listener({ id, state: { current: 'complete' } });
            }
          }, 0);
        },
        search: (_query, callback) => callback([]),
        onChanged: {
          addListener: (listener) => downloadListeners.add(listener),
          removeListener: (listener) => downloadListeners.delete(listener),
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
    setTimeout: options.immediateTimers
      ? (fn, ms, ...rest) => {
          timerDelays.push(ms);
          return setTimeout(fn, 0, ...rest);
        }
      : setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    // The .md is written through a blob URL, so its BYTES never appear in the
    // download options. Capturing them here is what lets a test assert on the
    // file the user ends up with rather than on the clipboard, which the save
    // path deliberately no longer writes.
    Blob: class {
      constructor(parts, opts) {
        this.parts = parts;
        this.type = (opts && opts.type) || '';
        blobs.push(this);
      }
    },
    Uint8Array,
    // The REAL URL class, extended — not replaced. popup.js also calls
    // `new URL(href)` to derive attachment filenames from their links, so a
    // stub object with only createObjectURL silently broke every downloaded
    // name (b.jpg came out as image_002.png) while looking like an unrelated
    // assertion failure.
    URL: Object.assign(
      class extends URL {},
      {
        createObjectURL: (blob) => {
          const id = 'blob:c2m/' + blobs.indexOf(blob);
          blobUrls.set(id, blob);
          return id;
        },
        revokeObjectURL: (id) => { blobUrls.delete(id); },
      },
    ),
    encodeURIComponent,
    TextEncoder,
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    buildStoreZip: null,
    module: { exports: {} },
  };
  if (options.storage) {
    context.chrome.storage = { local: options.storage };
    if (options.storage.runtime) context.chrome.runtime = options.storage.runtime;
  }
  vm.runInNewContext(zipSource, context, { filename: path.join(__dirname, '..', 'zip.js') });
  context.buildStoreZip = context.module.exports.buildStoreZip;
  context.module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
  vm.runInNewContext(source, context, { filename: path.join(__dirname, '..', 'popup.js') });
  return {
    button,
    status,
    cancelButton,
    cancelVisible: () => cancelClasses.has('visible'),
    pauseVisible: () => pauseButton.classList.contains('visible'),
    injected: () => injected,
    pageScanState: () => pageScanState,
    clickCancel: () => cancelHandler(),
    click: () => clickHandler(),
    clipboardValue: () => clipboardValue,
    // What was actually WRITTEN for a download, decoded from its blob.
    writtenText: (filenameSuffix) => {
      const entry = downloads.find((d) => String(d.filename).endsWith(filenameSuffix));
      if (!entry) return null;
      const blob = blobUrls.get(entry.url) || blobs[Number(String(entry.url).split('/').pop())];
      if (!blob) return null;
      return Buffer.concat(blob.parts.map((part) => Buffer.from(part))).toString('utf8');
    },
    scriptCalls: () => scriptCalls,
    timerDelays: () => timerDelays,
    downloads: () => downloads,
    batchCheckbox,
    imagesCheckbox: checkbox,
    htmlCheckbox,
    batchWarningVisible: () => batchWarning.classList.contains('visible'),
    linksWarningVisible: () => linksWarning.classList.contains('visible'),
  };
}

test('the action button names an HTML-only export', async () => {
  let seenWhileScanning = null;
  const harness = createPopupHarness((options, button) => {
    seenWhileScanning = button.textContent;
    return [{ result: { ok: true, md: '# page', title: 'Page', slug: 'Page', lines: 1, words: 1 } }];
  }, { imagesPresent: true });

  // Positive control: markdown saving is a different label, so "Save HTML site"
  // is not the only string the button can show.
  assert.equal(harness.button.textContent, 'Copy as Markdown');
  harness.imagesCheckbox.checked = true;
  harness.imagesCheckbox.dispatchChange();
  assert.equal(harness.button.textContent, 'Save Markdown');

  harness.htmlCheckbox.checked = true;
  harness.htmlCheckbox.dispatchChange();
  assert.equal(harness.button.textContent, 'Save Markdown and HTML');

  harness.imagesCheckbox.checked = false;
  harness.imagesCheckbox.dispatchChange();
  assert.equal(harness.button.textContent, 'Save HTML site');

  await harness.click();
  assert.equal(seenWhileScanning, 'Scanning conversation…');
  assert.equal(harness.button.disabled, false);
  assert.equal(harness.button.textContent, 'Save HTML site');
});

test('the popup injects the packaged content script', async () => {
  const harness = createPopupHarness(() => [{ result: { ok: true, md: '# chat', lines: 1, words: 2 } }]);
  await harness.click();
  const files = harness.injected().flatMap((call) => call.files || []);
  assert.ok(files.length > 0, 'the click must reach script injection');
  assert.deepEqual(files, ['content.js']);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8'), /['"]content\.mjs['"]/, 'no injection path may name an unpackaged module');
});

test('ticking the batch forces file saving on, instead of warning about it', () => {
  // There used to be two caveats here, one of which warned that a batch without
  // file saving archives signed, short-lived LINKS rather than files — an export
  // that looks complete on the day it runs and is empty hours later. A warning
  // the user can read past is the wrong mechanism for a failure that destroys
  // the archive's whole point, so the option is now set and held instead.
  const harness = createPopupHarness(
    () => ({ ok: true, md: '#', slug: 's', lines: 1, words: 1 }),
    { downloadImages: true },
  );

  // Positive control: the state under test is genuinely reachable from "off".
  harness.imagesCheckbox.checked = false;
  harness.imagesCheckbox.disabled = false;
  assert.equal(harness.batchWarningVisible(), false, 'nothing to warn about before the option is chosen');

  harness.batchCheckbox.checked = true;
  harness.batchCheckbox.dispatchChange();

  assert.equal(harness.batchWarningVisible(), true, 'the popup-must-stay-open caveat must show on ticking batch');
  assert.equal(harness.imagesCheckbox.checked, true, 'a batch must save the files it archives');
  assert.equal(harness.imagesCheckbox.disabled, true, 'the option must not be switchable back off');

  // Untick and the choice is handed back — the lock belongs to the batch, not
  // to the session.
  harness.batchCheckbox.checked = false;
  harness.batchCheckbox.dispatchChange();
  assert.equal(harness.imagesCheckbox.disabled, false, 'the option stayed locked after the batch was cancelled');
  assert.equal(harness.batchWarningVisible(), false);
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
  const pauseVisibleDuringScan = harness.pauseVisible();

  resolveScan([{ result: { ok: true, md: '# complete', lines: 1, words: 2 } }]);
  await click;
  assert.equal(pauseVisibleDuringScan, false, 'a single scan cannot pause a batch job');

  // content.js, the Retry-screen probe, then the scan.
  assert.equal(harness.scriptCalls(), 3);
  assert.equal(harness.clipboardValue(), '# complete');
  assert.equal(harness.status.className, 'success');
  assert.equal(harness.button.disabled, false);
  assert.equal(harness.button.textContent, 'Copy as Markdown');
});

test('a Retry screen is waited out, then the open conversation is copied', async () => {
  let probes = 0;
  let clicks = 0;
  let waitedBeforeClick = 0;
  const harness = createPopupHarness(async () => [{
    result: { ok: true, md: '# recovered', lines: 1, words: 1 },
  }], {
    immediateTimers: true,
    readyResult() {
      probes += 1;
      return probes === 1
        ? { ready: false, rateLimited: true, error: 'ChatGPT rate limit: the conversation page asked to retry.' }
        : { ready: true };
    },
    onRetryClick() {
      clicks += 1;
      waitedBeforeClick = harness.timerDelays().filter((ms) => ms === 1000).reduce((sum, ms) => sum + ms, 0);
    },
  });
  await harness.click();
  assert.equal(clicks, 1);
  assert.equal(waitedBeforeClick, 60000);
  assert.equal(harness.clipboardValue(), '# recovered');
  assert.equal(harness.status.className, 'success');
});

test('a Retry screen that stays up is not exported as an empty conversation', async () => {
  let scans = 0;
  let clicks = 0;
  const harness = createPopupHarness(async (opts) => {
    if (String(opts.func || '').includes('getConversationMarkdown')) scans += 1;
    return [{ result: { ok: true, md: '# should-not-run', lines: 1, words: 2 } }];
  }, {
    immediateTimers: true,
    readyResult: () => ({
      ready: false,
      rateLimited: true,
      error: 'ChatGPT rate limit: the conversation page asked to retry.',
    }),
    onRetryClick() {
      clicks += 1;
    },
  });
  await harness.click();
  assert.equal(scans, 0);
  assert.equal(clicks, 5);
  assert.equal(harness.clipboardValue(), null);
  assert.equal(harness.status.className, 'error');
  assert.match(harness.status.textContent, /rate limit/);
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

test('external images are links, not missing attachments in a saved export', () => {
  const md = '![remote](https://tracker.example/pixel) ![local](https://files.oaiusercontent.com/file/image.png)';
  assert.deepEqual(Array.from(popup.parseImageRefs(md), (ref) => ref.label), ['local']);
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
  // The unique run stamp prevents two exports in one minute sharing a name.
  assert.match(
    mdDownload.filename,
    /^chatgpt-export\/Title\/Title--\d{8}-\d{4}-[a-z0-9-]+\.md$/,
    mdDownload.filename,
  );
});

test('the stamp is unconditional — there is no option that turns it off', async () => {
  // There used to be a "Re-export with date-time stamp" checkbox. It changed the
  // FILENAME and nothing else, which read as though re-exporting worked somehow
  // differently when it was ticked — while the extension has never been able to
  // append to a file at all. Removing it leaves one meaning: every export says
  // when it was taken.
  const md = '# chat\n\nbody';
  const harness = createPopupHarness(async () => [{
    result: { ok: true, md, title: 'chat', slug: 'chat', lines: 2, words: 1 },
  }], { downloadImages: true, extracted: [] });   // no useTimestamp passed at all

  await harness.click();

  const mdDownload = harness.downloads().find((d) => d.filename.endsWith('.md'));
  assert.match(mdDownload.filename, /chatgpt-export\/chat\/chat--\d{8}-\d{4}-[a-z0-9-]+\.md$/);
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
  // Attachment names are asserted exactly; the .md carries an unconditional stamp,
  // so it is matched by shape. The prefix — the thing this test is about — is
  // still checked character for character.
  const stamp = paths[2].match(/--(\d{8}-\d{4}-[a-z0-9-]+)\.md$/)?.[1];
  assert.ok(stamp, paths[2]);
  assert.deepEqual(paths.slice(0, 2), [
    'chatgpt-export/Агент-Аркана/Агент-Аркана-image_001--' + stamp + '.png',
    'chatgpt-export/Агент-Аркана/Агент-Аркана-image_002--' + stamp + '.jpg',
  ]);

  // The saved Markdown must point at the same slug-prefixed local files.
  // Asserted against the FILE, not the clipboard: with the save option on the
  // clipboard is deliberately left alone, and the rewritten links are a property
  // of the document the user keeps.
  const written = harness.writtenText('.md');
  assert.ok(written.includes('./Агент-Аркана-image_001--' + stamp + '.png'));
  assert.ok(written.includes('./Агент-Аркана-image_002--' + stamp + '.jpg'));
});

test('re-exported Markdown keeps its own attachment bytes', async () => {
  const md = '![chart](https://files.oaiusercontent.com/file/chart.png)';
  const makeRun = () => createPopupHarness(async () => [{
    result: { ok: true, md, title: 'Chat', slug: 'Chat', lines: 1, words: 1 },
  }], {
    downloadImages: true,
    extracted: [{ url: 'https://files.oaiusercontent.com/file/chart.png', dataUrl: 'data:image/png;base64,AAA' }],
  });
  const first = makeRun();
  const second = makeRun();
  await first.click();
  await second.click();
  const firstImage = first.downloads().find((entry) => entry.filename.endsWith('.png'));
  const secondImage = second.downloads().find((entry) => entry.filename.endsWith('.png'));
  assert.ok(firstImage && secondImage);
  assert.notEqual(firstImage.filename, secondImage.filename,
    'the second export must not replace bytes linked by the first Markdown file');
  for (const [harness, image] of [[first, firstImage], [second, secondImage]]) {
    assert.ok(harness.writtenText('.md').includes('./' + image.filename.split('/').pop()));
  }
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

  const untitled = harness.downloads().map((d) => d.filename);
  assert.match(untitled[0], /^chatgpt-export\/image_001--\d{8}-\d{4}-[a-z0-9-]+\.png$/);
  assert.match(untitled[1], /^chatgpt-export\/conversation--\d{8}-\d{4}-[a-z0-9-]+\.md$/);
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
  assert.equal(popup.isDownloadableFileUrl('http://files.oaiusercontent.com/report.pdf'), false);
});

test('parses escaped Markdown labels and parenthesized attachment destinations', () => {
  const url = 'https://files.oaiusercontent.com/report(final).pdf';
  const md = '[report \\[final\\].pdf](<' + url + '>)';
  assert.deepEqual(JSON.parse(JSON.stringify(popup.parseFileRefs(md))),
    [{ url, label: 'report [final].pdf', kind: 'file' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(popup.parseImageRefs('![plot \\[final\\]](<' + url + '>)'))),
    [{ url, label: 'plot [final]', kind: 'image' }]);
});

test('same-minute export stamps are unique while old stamped files stay recognizable', () => {
  const time = new Date(2026, 9, 10, 12, 34, 0);
  const first = popup.formatExportTimestamp(time);
  const second = popup.formatExportTimestamp(time);
  assert.notEqual(first, second);
  assert.match(first, /^20261010-1234-[a-z0-9-]+$/);
  assert.deepEqual(Array.from(popup.stampsInPaths([
    'chatgpt-export/Chat/Chat--20260817-1000~abc.md',
    'chatgpt-export/Chat/Chat--' + first + '~abc.md',
  ])).sort(), ['20260817-1000', first].sort());
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
  const stamp = paths[2].match(/--(\d{8}-\d{4}-[a-z0-9-]+)\.md$/)?.[1];
  assert.ok(stamp, paths[2]);
  assert.deepEqual(paths.slice(0, 2), [
    'chatgpt-export/Export/Export-image_001--' + stamp + '.png',
    'chatgpt-export/Export/Export-002-report--' + stamp + '.pdf',
  ]);
  const exported = harness.writtenText('.md');
  assert.ok(exported.includes('./Export-image_001--' + stamp + '.png'));
  assert.ok(exported.includes('./Export-002-report--' + stamp + '.pdf'));
  // "Saved", not "Copied": with the save option on, the file is the deliverable
  // and the clipboard is deliberately left untouched.
  assert.match(harness.status.textContent, /✓ Saved/);
  assert.match(harness.status.textContent, /2\/2 files/);
  assert.equal(
    harness.clipboardValue(), null,
    'the clipboard was written even though the export went to disk',
  );
});

test('batch mode reports per-conversation progress and writes a zip archive', async () => {
  const conversations = [
    { id: 'aaa111', href: '/g/g-p-test/c/aaa111', projectId: 'g-p-test', title: 'Alpha', slug: 'Alpha' },
    { id: 'bbb222', href: '/g/g-p-test/c/bbb222', projectId: 'g-p-test', title: 'Beta', slug: 'Beta' },
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
  }, { batchMode: true, tabUrl: 'https://chatgpt.com/g/g-p-test/project' });

  await harness.click();

  assert.match(harness.status.className, /success/, harness.status.textContent);
  assert.match(harness.status.textContent, /Batch export complete: 2 saved/);
  const zipDownload = harness.downloads().find((item) => item.filename.endsWith('.zip'));
  assert.ok(zipDownload, 'batch must download a zip archive');
  assert.match(zipDownload.filename, /My-Project-export--\d{8}-\d{4}-[a-z0-9-]+\.zip$/);
});

test('Pause appears only after a batch has a saved conversation list', async () => {
  let releaseList;
  const pendingList = new Promise((resolve) => { releaseList = resolve; });
  const harness = createPopupHarness(async (call) => {
    const source = String(call.func || '');
    if (source.includes('extractConversationTitle')) {
      return [{ result: { title: 'Project', slug: 'Project' } }];
    }
    if (source.includes('collectSidebarConversations')) return pendingList;
    return [{ result: null }];
  }, { batchMode: true });
  const click = harness.click();
  await new Promise((resolve) => setImmediate(resolve));
  const collectorStarted = harness.injected().some((call) =>
    String(call.func || '').includes('collectSidebarConversations'));
  const pauseVisibleDuringDiscovery = harness.pauseVisible();
  releaseList([{ result: { conversations: [], complete: false, reason: 'empty' } }]);
  await click;
  assert.equal(collectorStarted, true, 'the fixture must reach sidebar discovery');
  assert.equal(pauseVisibleDuringDiscovery, false);
});

test('Pause becomes available after the batch list is stored', async () => {
  const data = {};
  const storage = {
    get(key, cb) { cb({ [key]: data[key] }); },
    set(values, cb) { Object.assign(data, values); cb(); },
  };
  let releaseScan;
  const pendingScan = new Promise((resolve) => { releaseScan = resolve; });
  let signalScanStarted;
  const scanStarted = new Promise((resolve) => { signalScanStarted = resolve; });
  const harness = createPopupHarness(async (call) => {
    const source = String(call.func || '');
    if (source.includes('extractConversationTitle')) return [{ result: { slug: 'Project' } }];
    if (source.includes('collectSidebarConversations')) {
      return [{ result: { conversations: [{ id: 'one', href: '/c/one', title: 'One', slug: 'One' }], complete: true } }];
    }
    if (source.includes('waitForConversationReady')) return [{ result: { ready: true } }];
    if (source.includes('getConversationMarkdown')) {
      signalScanStarted();
      return pendingScan;
    }
    return [{ result: null }];
  }, { batchMode: true, downloadImages: true, storage });
  const click = harness.click();
  let timeoutId;
  try {
    await Promise.race([
      scanStarted,
      new Promise((_resolve, reject) => {
        timeoutId = setTimeout(() => reject(new Error('batch scan did not start')), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
  const jobStored = !!data.c2mBatchJob;
  const pauseVisibleDuringScan = harness.pauseVisible();
  releaseScan([{ result: { ok: true, md: '# One\n', slug: 'One', title: 'One', lines: 1, words: 1 } }]);
  await click;
  assert.equal(jobStored, true, 'the positive control must persist a real list');
  assert.equal(pauseVisibleDuringScan, true);
});

test('a failed job save does not offer Pause or promise resume', async () => {
  const runtime = { lastError: null };
  let writes = 0;
  const storage = {
    runtime,
    get(_key, cb) { cb({}); },
    set(_value, cb) {
      writes += 1;
      runtime.lastError = { message: 'quota exceeded' };
      cb();
      runtime.lastError = null;
    },
  };
  const harness = createPopupHarness(async (call) => {
    const source = String(call.func || '');
    if (source.includes('extractConversationTitle')) return [{ result: { slug: 'Project' } }];
    if (source.includes('collectSidebarConversations')) {
      return [{ result: { conversations: [{ id: 'one', href: '/c/one', title: 'One', slug: 'One' }], complete: true } }];
    }
    if (source.includes('waitForConversationReady')) return [{ result: { ready: true } }];
    if (source.includes('getConversationMarkdown')) {
      return [{ result: { ok: true, md: '# One\n', slug: 'One', title: 'One', lines: 1, words: 1 } }];
    }
    return [{ result: null }];
  }, { batchMode: true, downloadImages: true, storage });
  await harness.click();
  assert.ok(writes > 0, 'the fake must reject a real job write');
  assert.equal(harness.pauseVisible(), false);
  assert.equal(harness.status.className, 'warning');
  assert.match(harness.status.textContent, /saved export could not be stored|cannot be resumed/);
});

test('a refused batch Markdown write never gets a green completion status', async () => {
  const harness = createPopupHarness(async (call) => {
    const source = String(call.func || '');
    if (source.includes('extractConversationTitle')) return [{ result: { slug: 'Project' } }];
    if (source.includes('collectSidebarConversations')) {
      return [{ result: { conversations: [{ id: 'one', href: '/c/one', title: 'One', slug: 'One' }], complete: true } }];
    }
    if (source.includes('waitForConversationReady')) return [{ result: { ready: true } }];
    if (source.includes('getConversationMarkdown')) {
      return [{ result: { ok: true, md: '# One\n', slug: 'One', title: 'One', lines: 1, words: 1 } }];
    }
    return [{ result: null }];
  }, { batchMode: true, downloadImages: true, rejectDownload: (name) => /\.md$/.test(name) });
  await harness.click();
  assert.equal(harness.downloads().some((item) => /\.md$/.test(item.filename)), true);
  assert.equal(harness.status.className, 'warning');
  assert.doesNotMatch(harness.status.textContent, /✓ Batch export complete/);
  assert.match(harness.status.textContent, /write refused/);
});

test('a link captured from a download button is fetched into the conversation folder', () => {
  // Closes the loop measured on 2026-09-10: content.js clicks the button and
  // writes the signed URL into the markdown, and the popup must recognise it as
  // downloadable. If either half drifts, the archive appears in the export as a
  // link while the bytes never land beside the .md — exactly the failure the
  // user reported four exports running.
  const md = [
    '## Files',
    '',
    '[canon-consilium-prompt-bundle-v1.zip]' +
      '(https://chatgpt.com/backend-api/estuary/content?id=file_000&fn=canon-consilium-prompt-bundle-v1.zip)',
  ].join('\n');

  const refs = popup.parseFileRefs(md);
  assert.equal(refs.length, 1, 'the archive link must be picked up for download');
  assert.equal(refs[0].label, 'canon-consilium-prompt-bundle-v1.zip');
  assert.ok(popup.isDownloadableFileUrl(refs[0].url),
    'an estuary URL is the shape a clicked download button produces');
});
