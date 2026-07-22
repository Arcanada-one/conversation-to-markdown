'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createPopupHarness(runScan) {
  let clickHandler;
  let clipboardValue = null;
  let scriptCalls = 0;
  const button = {
    disabled: false,
    textContent: 'Copy as Markdown',
    addEventListener(_event, handler) {
      clickHandler = handler;
    },
  };
  const status = { className: '', textContent: '' };
  const context = {
    document: { getElementById: (id) => id === 'btn-copy' ? button : status },
    chrome: {
      tabs: { query: async () => [{ id: 7, url: 'https://chatgpt.com/' }] },
      scripting: {
        executeScript: async (options) => {
          scriptCalls += 1;
          if (options.files) return [];
          return runScan(options, button);
        },
      },
    },
    navigator: {
      clipboard: {
        writeText: async (value) => {
          clipboardValue = value;
        },
      },
    },
  };
  const source = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
  vm.runInNewContext(source, context);
  return {
    button,
    status,
    click: () => clickHandler(),
    clipboardValue: () => clipboardValue,
    scriptCalls: () => scriptCalls,
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
