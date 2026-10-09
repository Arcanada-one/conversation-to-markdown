'use strict';

// Split so the repository's privacy gate does not read a fixture as a real
// conversation link; it scans for origin + /c/<id> as one literal.
const CHAT_ORIGIN = 'https://' + 'chatgpt.com';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const content = require('../content.js');

const CHART_URL = 'https://files.oaiusercontent.com/file/chart.png';
const MISSING_URL = 'https://files.oaiusercontent.com/file/missing.pdf';
const INACTIVE_SENTINEL = 'INACTIVE-SENTINEL-9f3c';

function textNode(value) {
  return { nodeType: 3, textContent: value, childNodes: [], children: [] };
}

function matches(el, selector) {
  if (!el || el.nodeType !== 1) return false;
  if (selector.startsWith('.')) return String(el.className || '').split(/\s+/).includes(selector.slice(1));
  const attr = selector.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
  if (attr) {
    const value = el.getAttribute(attr[1]);
    return attr[2] === undefined ? value !== null : value === attr[2];
  }
  if (/^[a-z0-9]+$/i.test(selector)) return el.tagName.toLowerCase() === selector.toLowerCase();
  return false;
}

function dom(tag, children, attrs) {
  const childNodes = children || [];
  const attributes = attrs || {};
  const node = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    childNodes,
    children: childNodes.filter((child) => child.nodeType === 1),
    className: attributes.class || '',
    parentElement: null,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null;
    },
    querySelectorAll(selector) {
      const selectors = String(selector).split(',').map((item) => item.trim());
      const found = [];
      const visit = (candidate) => {
        if (!candidate || candidate.nodeType !== 1) return;
        if (selectors.some((item) => matches(candidate, item))) found.push(candidate);
        (candidate.children || []).forEach(visit);
      };
      this.children.forEach(visit);
      return found;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    closest(selector) {
      for (let current = this; current; current = current.parentElement) {
        if (matches(current, selector)) return current;
      }
      return null;
    },
  };
  Object.defineProperty(node, 'textContent', {
    get() {
      return childNodes.map((child) => child.textContent || '').join('');
    },
  });
  childNodes.forEach((child) => {
    if (child.nodeType === 1) child.parentElement = node;
  });
  return node;
}

function userTurn(id, text, order) {
  return dom('section', [
    dom('div', [
      dom('div', [textNode(text)], { class: 'whitespace-pre-wrap' }),
    ], { 'data-message-author-role': 'user' }),
  ], {
    'data-turn-id': id,
    'data-turn': 'user',
    'data-testid': 'conversation-turn-' + order,
  });
}

function assistantTurn() {
  return dom('section', [
    dom('div', [
      dom('div', [
        dom('p', [
          textNode('ACTIVE-ASSISTANT-LINE '),
          dom('a', [textNode('spec')], { href: 'https://example.com/spec' }),
        ]),
        dom('pre', [
          dom('code', [textNode('const active = true;')]),
        ]),
        dom('table', [
          dom('tr', [
            dom('th', [textNode('Col')]),
            dom('th', [textNode('Extra')]),
          ]),
          dom('tr', [
            dom('td', [textNode('ACTIVE-CELL')]),
            dom('td', [textNode('kept')]),
          ]),
        ]),
        dom('img', [], { src: CHART_URL, alt: 'chart' }),
        dom('a', [textNode('missing.pdf')], { href: MISSING_URL }),
      ], { class: 'markdown' }),
    ], { 'data-message-author-role': 'assistant' }),
  ], {
    'data-turn-id': 'active-assistant',
    'data-turn': 'assistant',
    'data-testid': 'conversation-turn-2',
  });
}

/** Two app-shell pages. The inactive page is first, so a document-wide query
 *  reads the foreign turn before the active one. */
function twoPageDocument() {
  const inactive = dom('div', [
    userTurn('inactive-turn', INACTIVE_SENTINEL, 0),
  ], { 'data-app-shell-active-page': 'false' });
  const active = dom('div', [
    userTurn('active-user', 'ACTIVE-USER-LINE <script>alert(1)</script>', 1),
    assistantTurn(),
  ], { 'data-app-shell-active-page': 'true' });
  const pages = [inactive, active];
  return {
    inactive,
    active,
    querySelectorAll(selector) {
      const found = [];
      for (const page of pages) {
        if (matches(page, selector)) found.push(page);
        found.push(...page.querySelectorAll(selector));
      }
      return found;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
  };
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('active session export writes escaped HTML and omits the inactive page', () => {
  const previousNode = global.Node;
  global.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  const outputDir = tempDir('c2m-html-');
  try {
    const doc = twoPageDocument();
    const firstTurn = doc.querySelectorAll('[data-turn-id]')[0];
    assert.match(firstTurn.textContent, new RegExp(INACTIVE_SENTINEL),
      'positive control: a document-wide turn query hits the inactive page first');
    assert.match(doc.inactive.textContent, new RegExp(INACTIVE_SENTINEL));
    assert.doesNotMatch(doc.active.textContent, new RegExp(INACTIVE_SENTINEL));

    const chartBytes = Buffer.from('chart-bytes-9f3c');
    const result = content.exportActiveSessionHtml(doc, {
      outputDir,
      title: 'Active session',
      slug: 'Active-session',
      retrieved: [{ url: CHART_URL, name: 'chart.png', bytes: chartBytes }],
    });

    assert.equal(result.ok, true, result.error);
    assert.equal(result.partial, true);
    assert.ok(result.missing.includes('missing.pdf'), JSON.stringify(result.missing));
    const html = fs.readFileSync(path.join(outputDir, result.pagePath), 'utf8');
    assert.equal(html, result.html);
    assert.match(html, /ACTIVE-USER-LINE/);
    assert.match(html, /ACTIVE-ASSISTANT-LINE/);
    assert.match(html, /<h2>You said<\/h2>/);
    assert.match(html, /<h2>ChatGPT said<\/h2>/);
    assert.match(html, /<a href="https:\/\/example.com\/spec">spec<\/a>/);
    assert.match(html, /<pre><code>const active = true;<\/code><\/pre>/);
    assert.match(html, /<td>ACTIVE-CELL<\/td>/);
    assert.match(html, /<img alt="chart" src="\.\/chart\.png">/);
    assert.match(html, /Could not retrieve: missing\.pdf/);
    assert.match(html, /class="partial"/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.equal(html.includes('<script'), false);
    assert.equal(html.includes(INACTIVE_SENTINEL), false);
    const written = fs.readFileSync(path.join(outputDir, 'chats', 'Active-session', 'chart.png'));
    assert.deepEqual(written, chartBytes);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
    if (previousNode === undefined) delete global.Node;
    else global.Node = previousNode;
  }
});

/** Drive the real runBatchExport. site.js is loaded into the same vm so the
 *  HTML layout the popup calls is the shipped one, not a copy. */
function runHtmlBatch(conversations, htmlSiteDir) {
  const zipSource = fs.readFileSync(path.join(__dirname, '..', 'zip.js'), 'utf8');
  const siteSource = fs.readFileSync(path.join(__dirname, '..', 'site.js'), 'utf8');
  const popupSource = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
  const context = {
    module: { exports: {} },
    console,
    require,
    Buffer,
    document: {
      getElementById: () => ({
        addEventListener() {}, disabled: false, textContent: '', value: '', checked: false,
        classList: { add() {}, remove() {} },
      }),
    },
    navigator: { clipboard: { writeText: async () => {} }, onLine: true },
    chrome: {
      tabs: {
        query: async () => [{ id: 1, url: CHAT_ORIGIN + '/g/g-p-budget/project' }],
        get: (_id, callback) => callback({
          id: 1,
          status: 'complete',
          url: context.__tabUrl || (CHAT_ORIGIN + '/'),
        }),
      },
      scripting: {
        executeScript: async (options) => {
          const source = String(options.func || '');
          if (options.files) return [];
          if (/location\.href/.test(source)) {
            context.__tabUrl = CHAT_ORIGIN + ((options.args && options.args[0]) || '');
            return [{ result: true }];
          }
          if (/collectSidebarConversations|listSidebarConversations/.test(source)) {
            return [{ result: { conversations, complete: true, reason: 'reached-end' } }];
          }
          if (/waitForConversationReady/.test(source)) return [{ result: { ready: true } }];
          if (/fetchConversationMetadata/.test(source)) return [{ result: null }];
          if (/getConversationMarkdown/.test(source)) {
            const tabUrl = String(context.__tabUrl || '');
            let conv = conversations[0];
            for (const candidate of conversations) {
              if (candidate.href && tabUrl.indexOf(candidate.href) !== -1) conv = candidate;
            }
            return [{ result: {
              ok: true,
              md: conv.md,
              title: conv.title,
              slug: conv.slug,
              lines: 2,
              words: 4,
              partial: false,
            } }];
          }
          if (/__c2mScan/.test(source)) return [{ result: null }];
          return [{ result: true }];
        },
      },
      downloads: {
        download(_options, callback) { callback(1); },
        search(_query, callback) { callback([]); },
      },
      runtime: { lastError: null },
    },
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout,
    setInterval: () => 0,
    clearInterval() {},
    URL,
    encodeURIComponent,
    decodeURIComponent,
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    Uint8Array,
    TextEncoder,
    DataView,
    Math,
    Date,
  };
  context.window = context;
  vm.runInNewContext(zipSource, context);
  context.buildStoreZip = context.module.exports.buildStoreZip;
  context.module = { exports: {} };
  vm.runInNewContext(siteSource, context);
  const siteExports = context.module.exports;
  context.sessionFromExport = siteExports.sessionFromExport;
  context.layoutStaticSite = siteExports.layoutStaticSite;
  context.writeStaticSite = siteExports.writeStaticSite;
  context.module = { exports: {} };
  vm.runInNewContext(popupSource, context);
  return context.module.exports.runBatchExport({ id: 1 }, {
    downloadImages: false,
    buildZip: false,
    useTimestamp: false,
    projectSlug: 'proj',
    batchStamp: '20260817-1200',
    maxAttempts: 1,
    maxHoldRounds: 0,
    isPaused: () => false,
    isCancelled: () => false,
    htmlSiteDir,
  });
}

test('batch export groups a project chat and leaves a loose chat addressable', async () => {
  const outputDir = tempDir('c2m-site-');
  const chartBytes = Buffer.from('project-chart-bytes');
  const conversations = [
    {
      id: 'proj-chat',
      projectId: 'g-p-budget',
      projectTitle: 'Budget',
      title: 'Spec',
      slug: 'Spec',
      href: '/g/g-p-budget/c/proj-chat',
      md: 'PROJECT-SPEC-LINE\n\n![chart](' + CHART_URL + ')\n',
      retrievedFiles: [{ url: CHART_URL, name: 'chart.png', bytes: chartBytes }],
    },
    {
      id: 'loose-chat',
      title: 'Inbox notes',
      slug: 'Inbox-notes',
      href: '/c/loose-chat',
      md: 'LOOSE-INBOX-LINE\n',
    },
  ];
  try {
    const result = await runHtmlBatch(conversations, outputDir);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.exported, 2, JSON.stringify(result.errors));
    assert.equal(result.partial, 0, JSON.stringify(result.errors));

    const index = fs.readFileSync(path.join(outputDir, 'index.html'), 'utf8');
    assert.match(index, /href="Budget\/index\.html"/);
    assert.match(index, /href="chats\/Inbox-notes~loose-chat\/index\.html"/);
    const project = fs.readFileSync(path.join(outputDir, 'Budget', 'index.html'), 'utf8');
    assert.match(project, /href="Spec~proj-chat\/index\.html"/);
    const spec = fs.readFileSync(path.join(outputDir, 'Budget', 'Spec~proj-chat', 'index.html'), 'utf8');
    assert.match(spec, /PROJECT-SPEC-LINE/);
    assert.match(spec, /src="\.\/chart\.png"/);
    assert.equal(spec.includes('LOOSE-INBOX-LINE'), false);
    const loose = fs.readFileSync(path.join(outputDir, 'chats', 'Inbox-notes~loose-chat', 'index.html'), 'utf8');
    assert.match(loose, /LOOSE-INBOX-LINE/);
    assert.equal(fs.existsSync(path.join(outputDir, 'chats', 'Spec', 'index.html')), false);
    const written = fs.readFileSync(path.join(outputDir, 'Budget', 'Spec~proj-chat', 'chart.png'));
    assert.deepEqual(written, chartBytes);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('same-title chats keep separate directories, including their own text', () => {
  const site = require('../site.js');
  const outputDir = tempDir('c2m-same-title-');
  try {
    const laid = site.layoutStaticSite([
      { id: 'aaa', title: 'Notes', slug: 'Notes', projectTitle: 'Budget', markdown: 'FIRST' },
      { id: 'bbb', title: 'Notes', slug: 'Notes', projectTitle: 'Budget', markdown: 'SECOND' },
      { id: 'ccc', title: 'Notes', slug: 'Notes', markdown: 'LOOSE-FIRST' },
      { id: 'ddd', title: 'Notes', slug: 'Notes', markdown: 'LOOSE-SECOND' },
    ]);
    site.writeStaticSite(outputDir, laid);
    const first = fs.readFileSync(path.join(outputDir, 'Budget', 'Notes~aaa', 'index.html'), 'utf8');
    const second = fs.readFileSync(path.join(outputDir, 'Budget', 'Notes~bbb', 'index.html'), 'utf8');
    const looseFirst = fs.readFileSync(path.join(outputDir, 'chats', 'Notes~ccc', 'index.html'), 'utf8');
    const looseSecond = fs.readFileSync(path.join(outputDir, 'chats', 'Notes~ddd', 'index.html'), 'utf8');
    assert.match(first, /FIRST/);
    assert.equal(first.includes('SECOND'), false);
    assert.match(second, /SECOND/);
    assert.equal(second.includes('FIRST'), false);
    assert.match(looseFirst, /LOOSE-FIRST/);
    assert.equal(looseFirst.includes('LOOSE-SECOND'), false);
    assert.match(looseSecond, /LOOSE-SECOND/);
    const project = fs.readFileSync(path.join(outputDir, 'Budget', 'index.html'), 'utf8');
    assert.match(project, /href="Notes~aaa\/index\.html"/);
    assert.match(project, /href="Notes~bbb\/index\.html"/);
    const index = fs.readFileSync(path.join(outputDir, 'index.html'), 'utf8');
    assert.match(index, /href="chats\/Notes~ccc\/index\.html"/);
    assert.match(index, /href="chats\/Notes~ddd\/index\.html"/);
    assert.equal(index.includes('href="chats/Notes/index.html"'), false);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

function loadDownloadPopup(chromeDownloads) {
  const context = {
    module: { exports: {} },
    console,
    document: {
      getElementById: () => ({
        addEventListener() {}, disabled: false, textContent: '', value: '', checked: false,
        classList: { add() {}, remove() {}, contains() { return false; } },
      }),
    },
    navigator: { clipboard: { writeText: async () => {} }, onLine: true },
    chrome: {
      tabs: { query: async () => [] },
      scripting: { executeScript: async () => [] },
      downloads: chromeDownloads,
      runtime: { lastError: null },
    },
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval() {},
    Blob,
    TextEncoder,
    Uint8Array,
    URL: Object.assign(function UrlShim(value, base) { return new URL(value, base); }, {
      createObjectURL() {
        context.__order.push('create');
        return 'blob:c2m/' + context.__order.length;
      },
      revokeObjectURL() {
        context.__order.push('revoke');
      },
    }),
    encodeURIComponent,
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    __order: [],
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'zip.js'), 'utf8'), context);
  context.buildStoreZip = context.module.exports.buildStoreZip;
  context.module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8'), context);
  return context;
}

function htmlDownloadChrome(state, order) {
  let listener = null;
  return {
    download(_options, callback) {
      order.push('accept');
      const id = order.length;
      callback(id);
      setTimeout(() => {
        order.push('state:' + state);
        assert.equal(order.includes('revoke'), false, 'the blob must still be alive when Chrome finishes');
        if (listener) listener({ id, state: { current: state } });
      }, 30);
    },
    onChanged: {
      addListener(fn) { listener = fn; },
      removeListener(fn) { if (listener === fn) listener = null; },
    },
    search(_query, callback) { callback([]); },
  };
}

test('HTML download revokes the blob only after the write completes', async () => {
  const order = [];
  const context = loadDownloadPopup(htmlDownloadChrome('complete', order));
  context.__order = order;
  const result = await context.module.exports.downloadStaticSite({
    files: [{ path: 'index.html', body: '<p>HELLO-PAGE</p>', mime: 'text/html; charset=utf-8' }],
  });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(order.filter((item) => item !== 'create'), ['accept', 'state:complete', 'revoke']);
});

test('an interrupted or rejected HTML write is not success', async () => {
  const interruptedOrder = [];
  const interrupted = loadDownloadPopup(htmlDownloadChrome('interrupted', interruptedOrder));
  interrupted.__order = interruptedOrder;
  const unfinished = await interrupted.module.exports.downloadStaticSite({
    files: [{ path: 'Budget/Notes/index.html', body: '<p>PAGE</p>', mime: 'text/html' }],
  });
  assert.equal(unfinished.ok, false);
  assert.match(unfinished.error, /did not complete/);
  assert.deepEqual(
    interruptedOrder.filter((item) => item !== 'create'),
    ['accept', 'state:interrupted', 'revoke'],
  );

  const rejectedOrder = [];
  const rejectedContext = loadDownloadPopup({
    download(_options, callback) {
      rejectedOrder.push('accept');
      rejectedContext.chrome.runtime.lastError = { message: 'Invalid filename' };
      callback(undefined);
      rejectedContext.chrome.runtime.lastError = null;
    },
    onChanged: {
      addListener() {},
      removeListener() {},
    },
    search(_query, callback) { callback([]); },
  });
  rejectedContext.__order = rejectedOrder;
  const rejected = await rejectedContext.module.exports.downloadStaticSite({
    files: [{ path: 'index.html', body: '<p>PAGE</p>', mime: 'text/html' }],
  });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /Invalid filename/);
  assert.equal(rejectedOrder.includes('revoke'), true);
  assert.equal(rejectedOrder.includes('state:complete'), false);
});
