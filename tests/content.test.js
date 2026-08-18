'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const parser = require('../content.js');

function createVirtualizedFixture(pages, originalScrollTop) {
  const calls = [];
  const container = {
    scrollTop: originalScrollTop,
    clientHeight: 100,
    scrollHeight: Math.max(2, pages.length) * 100,
    scrollTo(options) {
      calls.push(options);
      this.scrollTop = options.top;
    },
    querySelectorAll(selector) {
      assert.equal(selector, '[data-turn-id]');
      const pageIndex = Math.min(
        Math.floor(this.scrollTop / this.clientHeight),
        pages.length - 1
      );
      return pages[Math.max(0, pageIndex)];
    },
  };
  container.scrollCalls = calls;
  return container;
}

function textNode(value) {
  return { nodeType: 3, textContent: value };
}

function element(tag, children, attributes) {
  const childNodes = children || [];
  const attrs = attributes || {};
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    childNodes,
    children: childNodes.filter((child) => child.nodeType === 1),
    className: attrs.class || '',
    getAttribute(name) {
      return attrs[name] ?? null;
    },
    querySelector(selector) {
      if (selector === 'a[href]') {
        const visit = (candidate) => {
          if (candidate.nodeType !== 1) return null;
          if (candidate.tagName === 'A' && candidate.getAttribute('href')) return candidate;
          for (const child of candidate.childNodes || []) {
            const found = visit(child);
            if (found) return found;
          }
          return null;
        };
        return visit(this);
      }
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      const accepted = selector.split(',').map((item) => item.trim().toUpperCase());
      const found = [];
      const visit = (candidate) => {
        if (candidate.nodeType !== 1) return;
        if (accepted.includes(candidate.tagName)) found.push(candidate);
        candidate.childNodes.forEach(visit);
      };
      this.childNodes.forEach(visit);
      return found;
    },
  };
  Object.defineProperty(node, 'textContent', {
    get() {
      return childNodes.map((child) => child.textContent).join('');
    },
  });
  childNodes.forEach((child) => {
    if (child.nodeType === 1) child.parentElement = node;
  });
  return node;
}

function image(attributes) {
  return {
    getAttribute(name) {
      return attributes[name] ?? null;
    },
  };
}

function userTurn(turnId, order, value) {
  const bubble = { textContent: value };
  const message = {
    querySelector(selector) {
      return selector === '.whitespace-pre-wrap' ? bubble : null;
    },
  };
  return {
    parentElement: null,
    getAttribute(name) {
      return { 'data-turn-id': turnId, 'data-turn': 'user', 'data-testid': `conversation-turn-${order}` }[name] ?? null;
    },
    querySelector(selector) {
      return selector === '[data-message-author-role="user"]' ? message : null;
    },
    querySelectorAll() {
      return [];
    },
  };
}

test('captures turns that are never mounted together', async () => {
  assert.equal(typeof parser.scanTurns, 'function');

  const container = createVirtualizedFixture([
    [{ turnId: 'u1', order: 1, role: 'user', markdown: 'first' }],
    [{ turnId: 'a1', order: 2, role: 'assistant', markdown: 'answer' }],
    [{ turnId: 'u2', order: 3, role: 'user', markdown: 'last' }],
  ], 42);

  const turns = await parser.scanTurns(container, {
    readSections: (target) => target.querySelectorAll('[data-turn-id]'),
    extractTurn: (turn) => turn,
    settle: async () => {},
    stablePasses: 2,
    maxSteps: 20,
    timeoutMs: 1000,
  });

  assert.deepEqual(turns.map((turn) => turn.turnId), ['u1', 'a1', 'u2']);
  assert.equal(container.scrollTop, 42);
  assert.equal(container.scrollCalls.at(-1).behavior, 'auto');
});

test('orders numbered turns and uses discovery order when numbering is absent', () => {
  assert.equal(typeof parser.orderCapturedTurns, 'function');
  const numbered = new Map([
    ['late', { turnId: 'late', order: 8, discoveryIndex: 0 }],
    ['early', { turnId: 'early', order: 2, discoveryIndex: 1 }],
  ]);
  const fallback = new Map([
    ['second', { turnId: 'second', order: null, discoveryIndex: 4 }],
    ['first', { turnId: 'first', order: null, discoveryIndex: 1 }],
  ]);
  const mixed = new Map([
    ['numbered-late', { turnId: 'numbered-late', order: 2, discoveryIndex: 1 }],
    ['fallback-first', { turnId: 'fallback-first', order: null, discoveryIndex: 0 }],
    ['numbered-early', { turnId: 'numbered-early', order: 1, discoveryIndex: 2 }],
  ]);

  assert.deepEqual(parser.orderCapturedTurns(numbered).map((turn) => turn.turnId), ['early', 'late']);
  assert.deepEqual(parser.orderCapturedTurns(fallback).map((turn) => turn.turnId), ['first', 'second']);
  assert.deepEqual(
    parser.orderCapturedTurns(mixed).map((turn) => turn.turnId),
    ['fallback-first', 'numbered-late', 'numbered-early']
  );
});

test('builds one Markdown document with role headings and separators', () => {
  assert.equal(typeof parser.buildConversationMarkdown, 'function');
  const markdown = parser.buildConversationMarkdown([
    { role: 'user', markdown: 'Question' },
    { role: 'assistant', markdown: 'Answer' },
  ]);

  assert.equal(markdown, '#### You said:\n\nQuestion\n\n---\n\n#### ChatGPT said:\n\nAnswer');
});

test('keeps one visible generated image per file id', () => {
  assert.equal(typeof parser.extractImages, 'function');
  const section = {
    querySelectorAll() {
      return [
        image({ src: 'https://chatgpt.com/backend-api/estuary/content?id=file_abc', alt: 'first' }),
        image({ src: 'https://chatgpt.com/backend-api/estuary/content?id=file_abc', alt: 'duplicate' }),
        image({ src: 'https://chatgpt.com/backend-api/estuary/content?id=file_hidden', 'aria-hidden': 'true' }),
        image({ src: 'https://chatgpt.com/backend-api/estuary/content?id=file_def', alt: 'second' }),
      ];
    },
  };

  assert.deepEqual(parser.extractImages(section), [
    '![first](https://chatgpt.com/backend-api/estuary/content?id=file_abc)',
    '![second](https://chatgpt.com/backend-api/estuary/content?id=file_def)',
  ]);
});

test('restores the original scroll position after extraction throws', async () => {
  const container = createVirtualizedFixture([[{ turnId: 'broken' }]], 37);

  await assert.rejects(
    parser.scanTurns(container, {
      extractTurn: () => { throw new Error('fixture exploded'); },
      settle: async () => {},
      maxSteps: 2,
    }),
    /fixture exploded/
  );
  assert.equal(container.scrollTop, 37);
  assert.equal(container.scrollCalls.at(-1).behavior, 'auto');
});

test('elapsed time alone never ends a healthy scan', async () => {
  // The defect this replaces: a flat deadline aborted a scan that was working
  // perfectly, purely because the conversation was long. Duration is a
  // measurement, not a failure condition — only a stall or a cancellation may
  // end a scan early. The clock here jumps an hour per step, far past any
  // deadline the old code would have imposed.
  const pages = [];
  for (let i = 1; i <= 40; i += 1) {
    pages.push([{ turnId: 't' + i, order: i, role: 'user', markdown: 'turn ' + i }]);
  }
  const container = createVirtualizedFixture(pages, 0);
  let clock = 0;

  let longestElapsed = 0;
  const turns = await parser.scanTurns(container, {
    readSections: (target) => target.querySelectorAll('[data-turn-id]'),
    extractTurn: (turn) => turn,
    settle: async () => {},
    now: () => { clock += 3600000; return clock; },
    onProgress: (p) => { longestElapsed = Math.max(longestElapsed, p.elapsedMs); },
    stablePasses: 2,
  });

  assert.equal(turns.length, 40, 'every turn survives a scan that runs for hours');
  // Positive control: prove the fixture actually reached a duration that every
  // previous build would have aborted on. The old wall was 120000ms.
  assert.ok(
    longestElapsed > 120000,
    `scan must exceed the retired 120s deadline to prove the point (was ${longestElapsed}ms)`
  );
});

test('a stalled scan returns partial turns with a notice in the artifact', async () => {
  // When a scan genuinely stalls mid-conversation, whatever was captured must
  // survive — never silently discarded. The partial notice lives in the markdown
  // itself, not only in the popup.
  const container = createVirtualizedFixture([
    [{ turnId: 'u1', markdown: 'partial' }],
    [{ turnId: 'u2', markdown: 'never reached' }],
  ], 12);
  const scanMeta = {};

  const turns = await parser.scanTurns(container, {
    readSections: (target) => target.querySelectorAll('[data-turn-id]'),
    extractTurn: (turn) => turn,
    settle: async () => {},
    scrollTo: async () => {},
    noProgressSteps: 5,
    scanMeta: scanMeta,
  });

  assert.deepEqual(turns.map((turn) => turn.turnId), ['u1']);
  assert.equal(scanMeta.partial, true);
  assert.equal(scanMeta.reason, 'stall');
  assert.equal(container.scrollTop, 12);
  const md = parser.prefixPartialNotice(parser.buildConversationMarkdown(turns), scanMeta.reason);
  assert.match(md, />\s*\*\*Partial export\*\*/);
});

test('an unexpected scan error propagates even when turns were captured', async () => {
  const container = createVirtualizedFixture([
    [{ turnId: 'u1', markdown: 'captured' }],
    [{ turnId: 'u2', markdown: 'boom' }],
  ], 0);
  const scanMeta = {};
  let capturedBeforeThrow = false;

  await assert.rejects(
    () => parser.scanTurns(container, {
      readSections: (target) => target.querySelectorAll('[data-turn-id]'),
      extractTurn: (turn) => {
        if (turn.turnId === 'u1') capturedBeforeThrow = true;
        if (turn.turnId === 'u2') throw new TypeError('extractor bug');
        return turn;
      },
      settle: async () => {},
      scanMeta: scanMeta,
      noProgressSteps: 1000,
    }),
    /extractor bug/
  );
  assert.equal(capturedBeforeThrow, true);
  assert.notEqual(scanMeta.partial, true);
});

test('the operator can cancel a scan and keep whatever was captured', async () => {
  // Cancellation must not destroy turns already held in memory — the operator
  // stopped the scan, they did not ask to discard it.
  const pages = [];
  for (let i = 1; i <= 40; i += 1) {
    pages.push([{ turnId: 't' + i, order: i, role: 'user', markdown: 'turn ' + i }]);
  }
  const container = createVirtualizedFixture(pages, 5);
  let steps = 0;
  const scanMeta = {};

  const turns = await parser.scanTurns(container, {
    readSections: (target) => target.querySelectorAll('[data-turn-id]'),
    extractTurn: (turn) => turn,
    settle: async () => {},
    isCancelled: () => { steps += 1; return steps > 3; },
    scanMeta: scanMeta,
  });

  assert.ok(turns.length > 0, 'cancelled scan must return captured turns');
  assert.ok(turns.length < 40, 'cancelled scan must not claim completeness');
  assert.equal(scanMeta.partial, true);
  assert.equal(scanMeta.reason, 'cancelled');
  assert.equal(container.scrollTop, 5, 'a cancelled scan still restores the page');
});

test('follows a reachable scroll target when virtualized bounds shrink', async () => {
  const previousAnimationFrame = global.requestAnimationFrame;
  const previousNow = Date.now;
  let clock = 0;

  const turn = {
    turnId: 'assistant-1',
    order: 1,
    discoveryIndex: 0,
    role: 'assistant',
    markdown: 'Complete answer',
  };
  const container = {
    scrollTop: 0,
    clientHeight: 100,
    scrollHeight: 1000,
    scrollTo({ top }) {
      if (top === 0) {
        this.scrollTop = 0;
        return;
      }
      this.scrollHeight = 130;
      this.scrollTop = Math.min(top, this.scrollHeight - this.clientHeight);
    },
    querySelectorAll() {
      return [turn];
    },
  };

  try {
    global.requestAnimationFrame = (callback) => setImmediate(callback);
    Date.now = () => { clock += 500; return clock; };

    const turns = await parser.scanTurns(container, {
      extractTurn: (candidate) => candidate,
      settle: async () => {},
      stablePasses: 2,
      maxSteps: 10,
      timeoutMs: 120000,
    });
    assert.deepEqual(turns.map((candidate) => candidate.turnId), ['assistant-1']);
    assert.equal(container.scrollTop, 0);
  } finally {
    global.requestAnimationFrame = previousAnimationFrame;
    Date.now = previousNow;
  }
});

test('still times out when a reachable scroll target is never approached', async () => {
  const previousAnimationFrame = global.requestAnimationFrame;
  const previousNow = Date.now;
  let clock = 0;

  const turn = {
    turnId: 'assistant-1',
    order: 1,
    discoveryIndex: 0,
    role: 'assistant',
    markdown: 'Complete answer',
  };
  const container = {
    scrollTop: 0,
    clientHeight: 100,
    scrollHeight: 1000,
    scrollTo() {},
    querySelectorAll() {
      return [turn];
    },
  };
  const scanMeta = {};

  try {
    global.requestAnimationFrame = (callback) => setImmediate(callback);
    Date.now = () => { clock += 500; return clock; };

    const turns = await parser.scanTurns(container, {
      extractTurn: (candidate) => candidate,
      settle: async () => {},
      stablePasses: 2,
      maxSteps: 10,
      timeoutMs: 120000,
      scanMeta: scanMeta,
    });
    assert.equal(turns.length, 1);
    assert.equal(scanMeta.partial, true);
    assert.match(scanMeta.reason, /step limit/);
  } finally {
    global.requestAnimationFrame = previousAnimationFrame;
    Date.now = previousNow;
  }
});

test('retargets restoration when virtualized bounds grow again', async () => {
  const previousAnimationFrame = global.requestAnimationFrame;
  const previousNow = Date.now;
  let clock = 0;
  let restoring = false;
	  let scrollCalls = 0;
  let restoredBounds = false;
  const turn = {
    turnId: 'assistant-1',
    order: 1,
    discoveryIndex: 0,
    role: 'assistant',
    markdown: 'Complete answer',
  };
  const container = {
    scrollTop: 900,
    clientHeight: 100,
    scrollHeight: 1000,
    scrollTo({ top, behavior }) {
      
      scrollCalls++; if (scrollCalls === 1) this.scrollHeight = 130; if (scrollCalls >= 4) restoring = true;
      this.scrollTop = Math.min(top, this.scrollHeight - this.clientHeight);
    },
    querySelectorAll() {
      return [turn];
    },
  };

  try {
    global.requestAnimationFrame = (callback) => setImmediate(() => {
      if (restoring && !restoredBounds) {
        container.scrollHeight = 1000;
        restoredBounds = true;
      }
      callback();
    });
    Date.now = () => { clock += 500; return clock; };

    const turns = await parser.scanTurns(container, {
      extractTurn: (candidate) => candidate,
      settle: async () => {},
      stablePasses: 2,
      maxSteps: 10,
      timeoutMs: 120000,
    });
    assert.deepEqual(turns.map((candidate) => candidate.turnId), ['assistant-1']);
    assert.equal(container.scrollTop, 900);
  } finally {
    global.requestAnimationFrame = previousAnimationFrame;
    Date.now = previousNow;
  }
});

test('waits for an observed turn shell to receive content', async () => {
  let reads = 0;
  const shell = { turnId: 'late-turn', order: 1, role: 'assistant', markdown: '' };
  const container = createVirtualizedFixture([[shell]], 25);

  const turns = await parser.scanTurns(container, {
    readSections: (target) => {
      reads += 1;
      if (reads >= 5) shell.markdown = 'late content';
      return target.querySelectorAll('[data-turn-id]');
    },
    extractTurn: (turn) => turn.markdown ? turn : null,
    settle: async () => {},
    stablePasses: 2,
    maxSteps: 12,
  });

  assert.equal(reads >= 5, true);
  assert.deepEqual(turns.map((turn) => turn.turnId), ['late-turn']);
  assert.equal(container.scrollTop, 25);
});

test('a turn that never receives content stops blocking the scan', async () => {
  // ChatGPT's virtualizer recycles bubbles and can render one empty. Such a turn
  // used to pin `unresolved` above zero forever, which froze the scroll target
  // and burned the entire budget standing still — the whole export was lost over
  // one unpainted bubble. It must be retried a bounded number of times and then
  // set aside, not allowed to hold the scan hostage.
  const shell = { turnId: 'empty-turn', order: 1, role: 'assistant', markdown: '' };
  const container = createVirtualizedFixture([[shell]], 18);

  const turns = await parser.scanTurns(container, {
    extractTurn: () => null,
    settle: async () => {},
    stablePasses: 2,
    maxSteps: 40,
    emptyTurnRetries: 3,
  });

  assert.deepEqual(turns, []);
  assert.equal(container.scrollTop, 18, 'original scroll position is restored');
});

test('one unpaintable turn does not cost the rest of the conversation', async () => {
  // The failure the operator hit: a long conversation where a single turn mounts
  // empty. Everything else must still be exported.
  const screens = [];
  for (let i = 0; i < 12; i += 1) {
    screens.push([{ turnId: `t${i}`, order: i, role: 'assistant', markdown: i === 5 ? '' : `answer ${i}` }]);
  }
  const container = createVirtualizedFixture(screens, 0);

  const turns = await parser.scanTurns(container, {
    extractTurn: (turn) => (turn.markdown ? turn : null),
    settle: async () => {},
    stablePasses: 2,
    maxSteps: 200,
    emptyTurnRetries: 3,
  });

  assert.equal(turns.length, 11, 'eleven of twelve turns survive the one bad turn');
  assert.equal(turns.some((t) => t.turnId === 't5'), false, 'the empty turn is the only casualty');
  assert.equal(turns.some((t) => t.turnId === 't11'), true, 'the scan reached the end');
});

test('ignores explicitly unsupported roles without treating them as pending', async () => {
  const toolTurn = {
    getAttribute(name) {
      return { 'data-turn-id': 'tool-1', 'data-turn': 'tool' }[name] ?? null;
    },
    querySelector: () => null,
  };
  const user = { turnId: 'user-1', order: 1, role: 'user', markdown: 'ready' };
  const container = createVirtualizedFixture([[toolTurn, user]], 16);

  const turns = await parser.scanTurns(container, {
    extractTurn: (turn) => turn === toolTurn ? null : turn,
    settle: async () => {},
    stablePasses: 2,
    maxSteps: 6,
  });

  assert.deepEqual(turns.map((turn) => turn.turnId), ['user-1']);
  assert.equal(container.scrollTop, 16);
});

test('continues when the virtualized scroll height grows near the bottom', async () => {
  const container = createVirtualizedFixture([
    [{ turnId: 'u1', order: 1, role: 'user', markdown: 'one' }],
    [{ turnId: 'a1', order: 2, role: 'assistant', markdown: 'two' }],
    [{ turnId: 'u2', order: 3, role: 'user', markdown: 'three' }],
  ], 30);
  container.scrollHeight = 200;

  const turns = await parser.scanTurns(container, {
    extractTurn: (turn) => turn,
    settle: async (target) => {
      if (target.scrollTop >= 100) target.scrollHeight = 300;
    },
    stablePasses: 2,
    maxSteps: 20,
  });

  assert.deepEqual(turns.map((turn) => turn.turnId), ['u1', 'a1', 'u2']);
  assert.equal(container.scrollTop, 30);
});

test('reads the conversation title from the active sidebar entry', () => {
  assert.equal(typeof parser.extractConversationTitle, 'function');
  const link = {
    getAttribute(name) {
      return name === 'aria-label' ? 'Агент Аркана' : null;
    },
    querySelector: () => null,
  };
  const doc = {
    title: 'Агент Аркана - ChatGPT',
    querySelector(selector) {
      return selector === 'a[href="/c/6a664d42"]' ? link : null;
    },
  };

  const previousLocation = global.location;
  global.location = { pathname: '/c/6a664d42' };
  try {
    assert.equal(parser.extractConversationTitle(doc), 'Агент Аркана');
  } finally {
    global.location = previousLocation;
  }
});

test('falls back to the document title without the ChatGPT suffix', () => {
  const doc = {
    title: 'Моря Турции | ChatGPT',
    querySelector: () => null,
  };

  const previousLocation = global.location;
  global.location = { pathname: '/c/other' };
  try {
    assert.equal(parser.extractConversationTitle(doc), 'Моря Турции');
  } finally {
    global.location = previousLocation;
  }
});

test('returns no title when the page is not a saved conversation', () => {
  const doc = { title: 'ChatGPT', querySelector: () => null };
  const previousLocation = global.location;
  global.location = { pathname: '/' };
  try {
    assert.equal(parser.extractConversationTitle(doc), null);
  } finally {
    global.location = previousLocation;
  }
});

test('slugifies titles into filesystem-safe names', () => {
  assert.equal(typeof parser.slugifyTitle, 'function');
  assert.equal(parser.slugifyTitle('Агент Аркана'), 'Агент-Аркана');
  assert.equal(parser.slugifyTitle('Cubrim: лучший/архиватор?'), 'Cubrim-лучший-архиватор');
  assert.equal(parser.slugifyTitle('  spaced  out  '), 'spaced-out');
  assert.equal(parser.slugifyTitle(''), null);
  assert.equal(parser.slugifyTitle(null), null);
  assert.equal(parser.slugifyTitle('a'.repeat(120)).length, 60);
  assert.doesNotMatch(parser.slugifyTitle('trailing---'), /-$/);
});

test('a dot-only title never becomes a path segment', () => {
  // The slug becomes a DIRECTORY name, and in a batch the project slug does too.
  // Chrome rejects any downloads.download() filename containing a `..`
  // back-reference, so a conversation titled ".." made every single write fail —
  // and because the download result was discarded, the popup reported the whole
  // project as exported. Zero files on disk, "40 saved" on screen.
  //
  // This is a different sanitizer from artifactFilename's: that one only ever
  // produces a leaf filename, while this one produces path segments.
  for (const hostile of ['..', '.', '...', '....', '. .', '../..']) {
    const slug = parser.slugifyTitle(hostile);
    if (slug === null) continue;                    // rejecting outright is fine
    assert.doesNotMatch(
      '/' + slug + '/',
      /\/\.\.?\//,
      'slug ' + JSON.stringify(slug) + ' from title ' + JSON.stringify(hostile) +
        ' is a relative-path segment and would be rejected by chrome.downloads'
    );
  }
});

test('parses numeric conversation order from data-testid', () => {
  assert.equal(typeof parser.parseTurnOrder, 'function');
  assert.equal(parser.parseTurnOrder('conversation-turn-17'), 17);
  assert.equal(parser.parseTurnOrder('not-a-turn'), null);
});

test('extracts an image-only assistant turn', () => {
  assert.equal(typeof parser.extractTurn, 'function');
  const section = {
    getAttribute(name) {
      return { 'data-turn-id': 'turn-image', 'data-turn': 'assistant', 'data-testid': 'conversation-turn-9' }[name] ?? null;
    },
    querySelector(selector) {
      assert.equal(selector, '[data-message-author-role="assistant"]');
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'img' || selector === 'img[src*="estuary/content"]') {
        return [image({ src: 'https://chatgpt.com/backend-api/estuary/content?id=file_picture', alt: 'Generated' })];
      }
      return [];
    },
  };

  assert.deepEqual(parser.extractTurn(section, 3), {
    turnId: 'turn-image',
    order: 9,
    discoveryIndex: 3,
    role: 'assistant',
    markdown: '![Generated](https://chatgpt.com/backend-api/estuary/content?id=file_picture)',
  });
});

test('preserves every assistant message segment within one turn', () => {
  const markdownRoots = [
    element('div', [element('p', [textNode('First paragraph.')])]),
    element('div', [element('p', [textNode('Second paragraph.')])]),
  ];
  const messages = markdownRoots.map((markdownRoot) => ({
    querySelector(selector) {
      return selector === '.markdown' ? markdownRoot : null;
    },
  }));
  const section = {
    getAttribute(name) {
      return {
        'data-turn-id': 'multi-segment-answer',
        'data-turn': 'assistant',
        'data-testid': 'conversation-turn-2',
      }[name] ?? null;
    },
    querySelector(selector) {
      return selector === '[data-message-author-role="assistant"]' ? messages[0] : null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-message-author-role="assistant"]') return messages;
      if (selector === 'img' || selector === 'img[src*="estuary/content"]') return [];
      return [];
    },
  };

  const previousNode = global.Node;
  global.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  try {
    const turn = parser.extractTurn(section, 1);
    assert.equal(turn.markdown, 'First paragraph.\n\nSecond paragraph.');
  } finally {
    global.Node = previousNode;
  }
});

// Closes the surviving mutant recorded as Wave 2a / A: removing the
// isAttachmentChip branch from nodeToMarkdown left the whole suite green,
// because every chip fixture wrapped an inner <a href> and therefore still
// exported through `case 'a'`. A chip carrying no resolvable href has no such
// fallback -- without the branch it degrades to bare text and the reader is
// never told a file was attached.
test('names an attachment chip that carries no link', () => {
  const chip = {
    nodeType: 1,
    tagName: 'div',
    getAttribute(name) {
      return name === 'data-testid' ? 'file-chip' : null;
    },
    querySelector() {
      return null;
    },
    childNodes: [],
    textContent: 'quarterly-report.pdf',
  };

  const previousNode = global.Node;
  global.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  try {
    const md = parser.nodeToMarkdown(chip, 0);
    assert.match(md, /quarterly-report\.pdf/);
    assert.notEqual(md.trim(), '');
  } finally {
    global.Node = previousNode;
  }
});

// Shapes below are TRANSCRIBED FROM A REAL SAVED ChatGPT PAGE (an operator-held
// sample of a 4-exchange conversation, not committed here: it carries signed
// `sig=` URLs and a real conversation id, which the public-surface gate bans).
// Every attribute and nesting level was read off those bytes; the URLs and ids
// are replaced with synthetic ones.
//
// What the real page proved, and why this test exists:
//  - An assistant turn whose answer is IMAGE-ONLY carries no `.markdown` and no
//    `[class*="prose"]` container at all, and no `[data-message-author-role]`
//    wrapper either. Its role lives ONLY in `data-turn="assistant"` on the
//    section. Two such turns were dropped by the shipped 1.1.x extractor
//    (8 turns in, 6 out) — the defect this project was filed for.
//  - Generated files are served from `chatgpt.com/backend-api/estuary/content`
//    with the id in a query parameter and NO extension in the path, so filename
//    derivation cannot rely on the URL path.
// A hand-written fixture that gives such a turn a prose container, or an
// author-role attribute, tests a page ChatGPT does not serve.
test('captures an image-only assistant turn shaped like the real page', () => {
  const image = {
    nodeType: 1,
    tagName: 'img',
    getAttribute(name) {
      return {
        src: 'https://chatgpt.com/backend-api/estuary/content?id=file_synth_0001&ts=1&p=fs',
        alt: 'Сформированное изображение: statistics',
      }[name] ?? null;
    },
    childNodes: [],
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };

  const section = {
    nodeType: 1,
    tagName: 'section',
    getAttribute(name) {
      // Role is carried by data-turn ALONE — this is the real shape.
      return {
        'data-turn-id': 'synth-image-only-turn',
        'data-testid': 'conversation-turn-6',
        'data-turn': 'assistant',
      }[name] ?? null;
    },
    // No [data-message-author-role], no .markdown, no [class*="prose"].
    querySelector: () => null,
    querySelectorAll(selector) {
      return selector === 'img' ? [image] : [];
    },
    childNodes: [image],
  };

  const previousNode = global.Node;
  global.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  try {
    const turn = parser.extractTurn(section, 5);
    assert.notEqual(turn, null, 'an image-only assistant turn must not be dropped');
    assert.equal(turn.role, 'assistant');
    assert.match(turn.markdown, /!\[/, 'the image must survive into the markdown');
    assert.match(turn.markdown, /estuary\/content/);
  } finally {
    global.Node = previousNode;
  }
});

test('derives a filename for an estuary URL that carries no extension', () => {
  // Real generated-file URLs put the id in a query parameter and end the path
  // at `/content`, so there is no extension to read. An image still gets a
  // usable name; a file with no label anywhere degrades to .bin rather than to
  // an extensionless name Chrome would refuse.
  const popupPath = require('path').join(__dirname, '..', 'popup.js');
  const vm = require('node:vm');
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
    decodeURIComponent,
    btoa,
  };
  vm.runInNewContext(require('fs').readFileSync(popupPath, 'utf8'), context);
  const popup = context.module.exports;

  const estuary = 'https://chatgpt.com/backend-api/estuary/content?id=file_synth_0002&ts=1&p=fs';
  assert.equal(popup.isDownloadableFileUrl(estuary), true);
  assert.equal(popup.artifactFilename(estuary, '', 0, 'Chat', 'image'), 'Chat-image_001.png');
  assert.equal(popup.artifactFilename(estuary, '', 0, 'Chat', 'file'), 'Chat-file_001.bin');
  // A labelled link still wins, which is the common case for documents.
  assert.equal(popup.artifactFilename(estuary, 'quarterly.xlsx', 0, 'Chat', 'file'), 'Chat-001-quarterly.xlsx');
});

test('falls back to the child author role when data-turn is absent', () => {
  const bubble = { textContent: 'Fallback question' };
  const message = {
    getAttribute: (name) => name === 'data-message-author-role' ? 'user' : null,
    querySelector: (selector) => selector === '.whitespace-pre-wrap' ? bubble : null,
  };
  const section = {
    getAttribute(name) {
      return { 'data-turn-id': 'fallback-user', 'data-testid': 'conversation-turn-4' }[name] ?? null;
    },
    querySelector(selector) {
      if (selector === '[data-message-author-role]') return message;
      if (selector === '[data-message-author-role="user"]') return message;
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };

  assert.deepEqual(parser.extractTurn(section, 2), {
    turnId: 'fallback-user',
    order: 4,
    discoveryIndex: 2,
    role: 'user',
    markdown: 'Fallback question',
  });
});

test('uses the child assistant role for an image-only turn without data-turn', () => {
  const message = element('div', [], { 'data-message-author-role': 'assistant' });
  const section = {
    getAttribute(name) {
      return { 'data-turn-id': 'fallback-image', 'data-testid': 'conversation-turn-5' }[name] ?? null;
    },
    querySelector(selector) {
      if (selector === '[data-message-author-role]') return message;
      if (selector === '[data-message-author-role="assistant"]') return message;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-message-author-role="assistant"]') return [message];
      if (selector === 'img' || selector === 'img[src*="estuary/content"]') {
        return [image({ src: 'https://chatgpt.com/backend-api/estuary/content?id=file_fallback', alt: 'Fallback' })];
      }
      return [];
    },
  };

  const previousNode = global.Node;
  global.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  try {
    const turn = parser.extractTurn(section, 3);
    assert.equal(turn.role, 'assistant');
    assert.match(turn.markdown, /!\[Fallback\]/);
  } finally {
    global.Node = previousNode;
  }
});

test('finds the nearest scrollable ancestor', () => {
  assert.equal(typeof parser.findScrollContainer, 'function');
  const scrolling = { parentElement: null, scrollHeight: 900, clientHeight: 300, overflowY: 'auto' };
  const wrapper = { parentElement: scrolling, scrollHeight: 300, clientHeight: 300, overflowY: 'visible' };
  const section = { parentElement: wrapper };
  const previous = global.getComputedStyle;
  global.getComputedStyle = (node) => ({ overflowY: node.overflowY });
  try {
    assert.equal(parser.findScrollContainer(section), scrolling);
  } finally {
    global.getComputedStyle = previous;
  }
});

test('preserves supported Markdown structures', () => {
  assert.equal(typeof parser.nodeToMarkdown, 'function');
  const previousNode = global.Node;
  const previousLocation = global.location;
  global.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  global.location = { href: 'https://chatgpt.com/' };
  const fixture = element('div', [
    element('p', [textNode('Use '), element('strong', [textNode('bold')]), textNode(' and '), element('em', [textNode('italic')])]),
    element('pre', [element('code', [textNode('const x = 1;')], { class: 'language-js' })]),
    element('ul', [element('li', [textNode('one')]), element('li', [textNode('two')])]),
    element('blockquote', [textNode('quoted')]),
    element('a', [textNode('relative')], { href: '/help' }),
    element('table', [
      element('tr', [element('th', [textNode('A')]), element('th', [textNode('B')])]),
      element('tr', [element('td', [textNode('1')]), element('td', [textNode('2')])]),
    ]),
  ]);
  try {
    const markdown = parser.nodeToMarkdown(fixture);
    assert.match(markdown, /\*\*bold\*\* and \*italic\*/);
    assert.match(markdown, /```js\nconst x = 1;\n```/);
    assert.match(markdown, /- one\n- two/);
    assert.match(markdown, /> quoted/);
    assert.match(markdown, /\[relative\]\(https:\/\/chatgpt\.com\/help\)/);
    assert.match(markdown, /\| A \| B \|/);
  } finally {
    global.Node = previousNode;
    global.location = previousLocation;
  }
});

test('does not emit executable link schemes into Markdown', () => {
  assert.equal(typeof parser.nodeToMarkdown, 'function');
  const previousNode = global.Node;
  const previousLocation = global.location;
  global.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  global.location = { href: 'https://chatgpt.com/' };
  try {
    const unsafe = element('a', [textNode('visible text')], { href: 'javascript:alert(1)' });
    assert.equal(parser.nodeToMarkdown(unsafe), 'visible text');
  } finally {
    global.Node = previousNode;
    global.location = previousLocation;
  }
});

test('browser entrypoint scans all windows and returns the established result shape', async () => {
  assert.equal(typeof parser.getConversationMarkdown, 'function');
  const turns = [
    userTurn('user-1', 1, 'Question'),
    {
      parentElement: null,
      getAttribute(name) {
        return { 'data-turn-id': 'assistant-1', 'data-turn': 'assistant', 'data-testid': 'conversation-turn-2' }[name] ?? null;
      },
      querySelector() {
        return null;
      },
      querySelectorAll(selector) {
        if (selector === 'img' || selector === 'img[src*="estuary/content"]') {
          return [image({ src: 'https://chatgpt.com/backend-api/estuary/content?id=file_result', alt: 'Result' })];
        }
        return [];
      },
    },
  ];
  const container = createVirtualizedFixture([[turns[0]], [turns[1]]], 44);
  container.overflowY = 'auto';
  turns.forEach((turn) => { turn.parentElement = container; });

  const previousDocument = global.document;
  const previousStyle = global.getComputedStyle;
  const previousLocation = global.location;
  global.document = {
    title: 'ChatGPT',
    querySelector: (selector) => selector === '[data-turn-id]' ? turns[0] : null,
    querySelectorAll: () => container.querySelectorAll('[data-turn-id]'),
  };
  global.getComputedStyle = (node) => ({ overflowY: node.overflowY || 'visible' });
  global.location = { pathname: '/', href: 'https://chatgpt.com/' };
  try {
    const result = await parser.getConversationMarkdown();
    assert.equal(result.ok, true);
    assert.match(result.md, /#### You said:\n\nQuestion/);
    assert.match(result.md, /#### ChatGPT said:\n\n!\[Result\]/);
    assert.equal(result.title, null);
    assert.equal(result.slug, null);
    assert.equal(typeof result.lines, 'number');
    assert.equal(typeof result.words, 'number');
    assert.equal(container.scrollTop, 44);
  } finally {
    global.document = previousDocument;
    global.getComputedStyle = previousStyle;
    global.location = previousLocation;
  }
});

test('prefixes the Markdown with the conversation title when the page has one', async () => {
  const turns = [userTurn('user-1', 1, 'Question')];
  const container = createVirtualizedFixture([[turns[0]]], 0);
  container.overflowY = 'auto';
  turns[0].parentElement = container;

  const sidebarLink = {
    getAttribute: (name) => name === 'aria-label' ? 'Агент Аркана' : null,
    querySelector: () => null,
  };

  const previousDocument = global.document;
  const previousStyle = global.getComputedStyle;
  const previousLocation = global.location;
  global.document = {
    title: 'Агент Аркана - ChatGPT',
    querySelector: (selector) => {
      if (selector === '[data-turn-id]') return turns[0];
      if (selector === 'a[href="/c/abc123"]') return sidebarLink;
      return null;
    },
    querySelectorAll: () => container.querySelectorAll('[data-turn-id]'),
  };
  global.getComputedStyle = (node) => ({ overflowY: node.overflowY || 'visible' });
  global.location = { pathname: '/c/abc123', href: 'https://chatgpt.com/' };
  try {
    const result = await parser.getConversationMarkdown();
    assert.equal(result.ok, true);
    assert.equal(result.title, 'Агент Аркана');
    assert.equal(result.slug, 'Агент-Аркана');
    assert.match(result.md, /^# Агент Аркана\n\n#### You said:/);
  } finally {
    global.document = previousDocument;
    global.getComputedStyle = previousStyle;
    global.location = previousLocation;
  }
});

// --- Guards that a green suite used to leave undefended -----------------
// Each of the three tests below was written against a mutation that survived
// the whole suite: flipping the guard it covers left every test passing.

/**
 * A fixture that behaves like a real virtualizer: only the turns near the
 * current offset are mounted, everything else is unmounted, and scrollHeight
 * grows as later pages are reached (lazy content still loading).
 */
function createUnmountingFixture(pages, options = {}) {
  const grow = options.growUntil ?? 0;
  let reached = 0;
  const container = {
    scrollTop: 0,
    clientHeight: 100,
    get scrollHeight() {
      // Height keeps growing while early pages are visited, the way lazily
      // rendered content extends a conversation as you scroll into it.
      return Math.max(2, pages.length + Math.max(0, grow - reached)) * 100;
    },
    scrollTo(options) {
      this.scrollTop = Math.max(0, Math.min(options.top, this.scrollHeight - this.clientHeight));
      reached = Math.max(reached, Math.floor(this.scrollTop / this.clientHeight));
    },
    querySelectorAll() {
      const page = Math.min(Math.floor(this.scrollTop / this.clientHeight), pages.length - 1);
      // Only the current page is mounted — neighbours are unmounted.
      return pages[Math.max(0, page)];
    },
  };
  return container;
}

test('a turn discovered on the last pass is not lost to an early exit', async () => {
  // Covers the `newIds === 0` guard: without it the scan may declare itself
  // finished on the pass that first sees a new turn, dropping it.
  const pages = [];
  for (let i = 0; i < 6; i += 1) {
    pages.push([{ turnId: `n${i}`, order: i, role: 'assistant', markdown: `answer ${i}` }]);
  }
  const container = createUnmountingFixture(pages);

  const turns = await parser.scanTurns(container, {
    extractTurn: (turn) => (turn.markdown ? turn : null),
    settle: async () => {},
    stablePasses: 2,
    maxSteps: 200,
  });

  assert.equal(turns.length, 6, 'every turn is captured, including the last one found');
  assert.equal(turns[turns.length - 1].turnId, 'n5');
});

test('a conversation still growing is not declared complete', async () => {
  // Covers the `lastHeight === scrollHeight` guard: a container whose height is
  // still changing has not settled, so the bottom is not the bottom yet.
  const pages = [];
  for (let i = 0; i < 5; i += 1) {
    pages.push([{ turnId: `g${i}`, order: i, role: 'assistant', markdown: `answer ${i}` }]);
  }
  const container = createUnmountingFixture(pages, { growUntil: 4 });

  const turns = await parser.scanTurns(container, {
    extractTurn: (turn) => (turn.markdown ? turn : null),
    settle: async () => {},
    stablePasses: 2,
    maxSteps: 200,
  });

  assert.equal(turns.length, 5, 'the scan waited for the height to settle');
});

test('a degraded re-mount never overwrites a good capture', async () => {
  // Covers the longer-markdown heuristic. A turn re-mounting with placeholder
  // chrome ("Thinking…", citation furniture) can be LONGER than the real prose;
  // length alone is not a correctness rule, so a shorter good capture must win
  // over a longer degraded one once we have real content.
  const good = 'The answer.';
  const degraded = 'Thinking… gathering sources… expanding citations…';
  let call = 0;
  const container = {
    scrollTop: 0,
    clientHeight: 100,
    scrollHeight: 200,
    scrollTo(options) { this.scrollTop = Math.max(0, Math.min(options.top, 100)); },
    querySelectorAll() {
      call += 1;
      // First mount yields the real answer, later mounts yield longer chrome.
      const markdown = call === 1 ? good : degraded;
      return [{ turnId: 'd1', order: 1, role: 'assistant', markdown }];
    },
  };

  const turns = await parser.scanTurns(container, {
    extractTurn: (turn) => (turn.markdown ? turn : null),
    settle: async () => {},
    stablePasses: 2,
    maxSteps: 30,
  });

  assert.equal(turns.length, 1);
  assert.equal(turns[0].markdown, good, 'the real answer survives a longer degraded re-mount');
});

test('one never-resolving turn does not cost the rest of a long conversation', async () => {
  // The operator's real failure, measured on the live page: turn d271b4db
  // never yielded content while 31556px of conversation remained. The scan
  // holds its scroll position whenever anything is unresolved, so the page
  // stopped moving; the stall guard then saw no movement and no new turns and
  // killed a scan that had already captured 500 of 570 turns.
  //
  // Both live properties must hold or the test proves nothing: the straggler
  // stays mounted once reached (so it keeps pinning `unresolved` above zero),
  // and it never resolves however many times it is retried. Verified by
  // mutation: deleting the hold-release in content.js makes this test fail with
  // the operator's exact message.
  const total = 24;
  const container = {
    scrollTop: 0,
    clientHeight: 100,
    scrollHeight: total * 100,
    scrollCalls: [],
    scrollTo(options) {
      this.scrollCalls.push(options);
      this.scrollTop = options.top;
    },
    querySelectorAll() {
      const index = Math.min(Math.floor(this.scrollTop / this.clientHeight), total - 1);
      const turns = [{ turnId: 't' + index, order: index, role: 'assistant', markdown: 'answer ' + index }];
      if (index >= 9) turns.unshift({ turnId: 'straggler', order: 9, role: 'assistant', markdown: '' });
      return turns;
    },
  };

  const turns = await parser.scanTurns(container, {
    extractTurn: (turn) => (turn.turnId === 'straggler' ? null : turn),
    settle: async () => {},
    stablePasses: 2,
    holdReleaseSteps: 5,
    noProgressSteps: 30,
    // Retries can never retire it, so only the hold-release can save the scan.
    emptyTurnRetries: 1000,
  });

  assert.equal(turns.some((t) => t.turnId === 't23'), true, 'the scan must reach the final turn');
  assert.equal(turns.some((t) => t.turnId === 'straggler'), false, 'the bad turn is the only casualty');
  assert.ok(turns.length >= 20, `the conversation survives one bad turn (got ${turns.length})`);
});

test('prefixPartialNotice labels the markdown artifact itself', () => {
  const md = parser.prefixPartialNotice('#### You said:\n\nHi', 'cancelled');
  assert.match(md, />\s*\*\*Partial export\*\* — scan was stopped before reaching the end\./);
  assert.match(md, /#### You said:/);
});

test('an assistant turn without the author-role wrapper is still captured', async () => {
  // Measured on the operator's 570-turn conversation: 12 of 285 assistant turns
  // carried no [data-message-author-role] wrapper. extractTurn looked only
  // inside that wrapper, so the loop never ran and answers up to 3106
  // characters were dropped in silence — the export showed two consecutive
  // "You said:" blocks where an answer belonged.
  const prose = element('div', [textNode('Да, да, дай секунду. Я бы не меняла структуру.')], { class: 'markdown' });
  const section = {
    getAttribute(name) {
      return { 'data-turn-id': 'a-orphan', 'data-turn': 'assistant', 'data-testid': 'conversation-turn-468' }[name] ?? null;
    },
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === '[data-message-author-role="assistant"]') return [];
      if (selector.includes('markdown')) return [prose];
      return [];
    },
  };

  const previousNode = global.Node;
  global.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  try {
    const turn = parser.extractTurn(section, 0);
    assert.ok(turn, 'the turn must not be dropped for want of an attribute');
    assert.equal(turn.role, 'assistant');
    assert.match(turn.markdown, /дай секунду/);
  } finally {
    global.Node = previousNode;
  }
});

test('emits a markdown link for a file attachment chip', () => {
  const previousNode = global.Node;
  const previousLocation = global.location;
  global.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  global.location = { href: 'https://chatgpt.com/' };
  const chip = element('a', [textNode('report.pdf')], {
    href: 'https://files.oaiusercontent.com/file-synth-abc/report.pdf',
    'data-testid': 'file-chip',
  });
  try {
    const markdown = parser.nodeToMarkdown(chip).trim();
    assert.match(markdown, /\[report\.pdf\]\(https:\/\/files\.oaiusercontent\.com\/file-synth-abc\/report\.pdf\)/);
  } finally {
    global.Node = previousNode;
    global.location = previousLocation;
  }
});

test('emits a markdown link for a div-wrapped attachment chip', () => {
  const previousNode = global.Node;
  const previousLocation = global.location;
  global.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  global.location = { href: 'https://chatgpt.com/' };
  const chip = element('div', [
    element('a', [textNode('bundle.zip')], {
      href: 'https://files.oaiusercontent.com/file-synth-rst/bundle.zip',
    }),
  ], { 'data-testid': 'file-chip' });
  try {
    const markdown = parser.nodeToMarkdown(chip).trim();
    assert.match(markdown, /\[bundle\.zip\]\(https:\/\/files\.oaiusercontent\.com\/file-synth-rst\/bundle\.zip\)/);
  } finally {
    global.Node = previousNode;
    global.location = previousLocation;
  }
});

test('extracts file attachment chips outside the prose container', () => {
  const chip = {
    getAttribute(name) {
      return name === 'data-testid' ? 'file-chip' : null;
    },
    closest: () => null,
    querySelector() {
      return {
        getAttribute(name) {
          return name === 'href'
            ? 'https://files.oaiusercontent.com/file-synth-def/data.csv'
            : null;
        },
      };
    },
    textContent: 'data.csv',
  };
  const section = {
    querySelectorAll(selector) {
      if (selector === '[data-testid="file-chip"]') return [chip];
      return [];
    },
  };

  assert.deepEqual(parser.extractAttachments(section), [
    '[data.csv](https://files.oaiusercontent.com/file-synth-def/data.csv)',
  ]);
});

/** A chip carrying a real file link, with a caller-chosen data-testid. */
function attachmentChipWithTestid(testid, href) {
  return {
    getAttribute(name) {
      if (name === 'data-testid') return testid;
      if (name === 'href') return href;
      return null;
    },
    tagName: 'A',
    closest: () => null,
    querySelector: () => null,
    textContent: 'report.pdf',
  };
}

/** A section whose querySelectorAll understands the shipped selector shapes. */
function sectionMatching(chips) {
  return {
    querySelectorAll(selector) {
      // A generic `[attr=…]` / `[attr*=…]` engine, derived from the selector
      // itself rather than hardcoded per selector. This keeps the fixture honest
      // about CSS semantics — `*=` really is a substring test, hostile URL or not
      // — without any line here resembling a host check, which it is not: the
      // assertion under test is that the SHIPPED code refuses what this finds.
      const parsed = /^(?:a)?\[([a-z-]+)(\*?)="([^"]+)"\]$/.exec(selector);
      if (!parsed) return [];
      const [, attribute, wildcard, needle] = parsed;
      return chips.filter((chip) => {
        const value = chip.getAttribute(attribute) || '';
        return wildcard ? value.indexOf(needle) !== -1 : value === needle;
      });
    },
  };
}

test('a renamed attachment testid still yields the attachment, and is reported as drift', () => {
  // The failure this guards: one private testid was the ONLY way an attachment
  // was recognised, so a rename stripped every file from every conversation
  // while the export still reported success (0 of 0 saved).
  const url = 'https://chatgpt.com/files/report.pdf';

  const intact = parser.extractAttachmentsDetailed(
    sectionMatching([attachmentChipWithTestid('file-chip', url)])
  );
  assert.equal(intact.links.length, 1);
  assert.equal(intact.primaryMatched, true);

  for (const renamed of ['file-chip-v2', 'attachment-tile', 'something-else-entirely']) {
    const drifted = parser.extractAttachmentsDetailed(
      sectionMatching([attachmentChipWithTestid(renamed, url)])
    );
    assert.equal(drifted.links.length, 1, 'testid "' + renamed + '" must still yield the file');
    assert.equal(drifted.primaryMatched, false, 'and must be reported as drift, not as normal');
    assert.ok(drifted.matchedBy, 'the selector that rescued it is named');
  }
});

test('a fallback href match is re-checked against the real host, not a substring', () => {
  // A `[href*="…"]` selector matches a substring, so these all satisfy it while
  // pointing somewhere else entirely. The popup FETCHES attachment URLs, so a
  // substring match must not be enough to treat one as a conversation file.
  const hostile = [
    'https://evil.example/steal?x=files.oaiusercontent.com',
    'https://files.oaiusercontent.com.attacker.example/payload',
    'https://attacker.example/chatgpt.com/files/report.pdf',
    // A SUFFIX impostor: this host ends with the real one, so a check written
    // with endsWith() instead of an exact comparison would accept it.
    'https://notfiles.oaiusercontent.com/payload',
    'https://evil-files.oaiusercontent.com/payload',
    // http, not https — a downgrade that must not be followed.
    'http://files.oaiusercontent.com/file-abc/report.pdf',
  ];

  for (const url of hostile) {
    const found = parser.extractAttachmentsDetailed(
      sectionMatching([attachmentChipWithTestid('renamed-away', url)])
    );
    assert.deepEqual(found.links, [], 'must not accept ' + url);
  }

  // The genuine host still works through the same fallback path, so the guard
  // rejects impostors rather than disabling the fallback.
  const genuine = parser.extractAttachmentsDetailed(
    sectionMatching([
      attachmentChipWithTestid('renamed-away', 'https://files.oaiusercontent.com/file-abc/report.pdf'),
    ])
  );
  assert.equal(genuine.links.length, 1);
  assert.equal(genuine.primaryMatched, false);
});

test('a turn with genuinely no attachment is distinguishable from selector drift', () => {
  const none = parser.extractAttachmentsDetailed(sectionMatching([]));
  assert.deepEqual(none.links, []);
  // The distinguishing signal: nothing matched at all, versus matchedBy naming a
  // fallback. Previously both cases were an empty array and nothing else.
  assert.equal(none.matchedBy, null);
  assert.equal(none.primaryMatched, false);
});

test('includes user-uploaded attachments in the turn markdown', () => {
  const chip = {
    getAttribute(name) {
      return name === 'data-testid' ? 'file-chip' : null;
    },
    closest: () => null,
    querySelector() {
      return {
        getAttribute(name) {
          return name === 'href'
            ? 'https://files.oaiusercontent.com/file-synth-ghi/source.py'
            : null;
        },
      };
    },
    textContent: 'source.py',
  };
  const bubble = { textContent: 'Please review this file.' };
  const message = {
    querySelector(selector) {
      return selector === '.whitespace-pre-wrap' ? bubble : null;
    },
  };
  const section = {
    getAttribute(name) {
      return {
        'data-turn-id': 'user-attach',
        'data-turn': 'user',
        'data-testid': 'conversation-turn-1',
      }[name] ?? null;
    },
    querySelector(selector) {
      return selector === '[data-message-author-role="user"]' ? message : null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-testid="file-chip"]') return [chip];
      return [];
    },
  };

  const turn = parser.extractTurn(section, 0);
  assert.match(turn.markdown, /Please review this file\./);
  assert.match(turn.markdown, /\[source\.py\]\(https:\/\/files\.oaiusercontent\.com\/file-synth-ghi\/source\.py\)/);
});

test('preserves sandbox Code Interpreter links visibly in markdown', () => {
  const previousNode = global.Node;
  const previousLocation = global.location;
  global.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  global.location = { href: 'https://chatgpt.com/' };
  const link = element('a', [textNode('output.csv')], { href: 'sandbox:/mnt/data/output.csv' });
  try {
    const markdown = parser.nodeToMarkdown(link);
    assert.match(markdown, /Code Interpreter file/);
    assert.match(markdown, /sandbox:\/mnt\/data\/output\.csv/);
    assert.doesNotMatch(markdown, /\[output\.csv\]\(https?:/);
  } finally {
    global.Node = previousNode;
    global.location = previousLocation;
  }
});

test('emits visible placeholders for silent-loss media elements', () => {
  const previousNode = global.Node;
  global.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  const cases = ['canvas', 'audio', 'video', 'svg'];
  try {
    for (const tag of cases) {
      const markdown = parser.nodeToMarkdown(element(tag, []));
      assert.match(markdown, new RegExp('\\*\\[' + tag + ' artifact'), tag + ' must not be silently dropped');
    }
  } finally {
    global.Node = previousNode;
  }
});

test('renders KaTeX once by skipping the hidden MathML layer', () => {
  const previousNode = global.Node;
  global.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  const katex = element('span', [
    element('span', [textNode('E=mc^2')], { class: 'katex-mathml' }),
    element('span', [textNode('E=mc^2')], { class: 'katex-html' }),
  ], { class: 'katex' });
  try {
    const markdown = parser.nodeToMarkdown(katex);
    assert.equal(markdown.trim(), 'E=mc^2');
  } finally {
    global.Node = previousNode;
  }
});

test('lists every sidebar conversation link once', () => {
  assert.equal(typeof parser.listSidebarConversations, 'function');
  const makeLink = (href, title) => ({
    getAttribute(name) {
      if (name === 'href') return href;
      if (name === 'aria-label') return title;
      return null;
    },
    querySelector: () => null,
    textContent: title,
  });
  const doc = {
    // Any conversation-link selector, not one pinned literal: the shipped
    // selector had to widen once already and a restated string breaks the moment
    // the code is corrected.
    querySelectorAll(selector) {
      if (typeof selector !== 'string' || selector.indexOf('/c/') === -1) return [];
      return [
        makeLink('/c/aaa111', 'Alpha chat'),
        makeLink('/c/bbb222', 'Beta chat'),
        makeLink('/c/aaa111', 'Alpha duplicate'),
      ];
    },
  };
  const listed = parser.listSidebarConversations(doc);
  assert.deepEqual(listed.map((item) => item.id), ['aaa111', 'bbb222']);
  assert.equal(listed[0].title, 'Alpha chat');
  assert.equal(listed[0].slug, 'Alpha-chat');
  assert.equal(listed[0].projectId, null, 'a plain conversation has no project');
});

test('a project conversation title comes from the sidebar, not the document title', () => {
  // Reproduces the production defect exactly. On a project conversation both
  // original selectors miss — `a[href="/c/{id}"]` because the href is
  // project-scoped, and `a[data-active][href^="/c/"]` likewise — so the lookup
  // fell through to document.title, which reads "Qoople - Перевод i18n JSON для
  // сайта". The project name then became part of every filename and folder.
  const convId = '69847c8d-e3b0-838f-a0a5-a3b1aff85e96';
  const projectId = 'g-p-6954db053ec481919faff2151c140cb6';
  const projectHref = '/g/' + projectId + '/c/' + convId;

  const sidebarLink = {
    getAttribute(name) {
      if (name === 'href') return projectHref;
      if (name === 'aria-label') return 'Перевод i18n JSON для сайта, chat in project Qoople';
      return null;
    },
    querySelector: () => null,
    textContent: 'Перевод i18n JSON для сайта',
  };

  const doc = {
    title: 'Qoople - Перевод i18n JSON для сайта',
    querySelector(selector) {
      const text = String(selector || '');
      // The row is NOT marked data-active in this DOM, so a selector requiring
      // that attribute must miss — otherwise every href variant looks rescued and
      // the test cannot tell which selector is load-bearing.
      if (text.indexOf('[data-active]') !== -1) return null;
      const parsed = /\[href(\^|\$|=)?="?([^"\]]+)"?\]/.exec(text);
      if (!parsed) return null;
      const operator = parsed[1] === '=' || parsed[1] === undefined ? '=' : parsed[1];
      const needle = parsed[2];
      if (operator === '=') return projectHref === needle ? sidebarLink : null;
      if (operator === '^') return projectHref.startsWith(needle) ? sidebarLink : null;
      return projectHref.endsWith(needle) ? sidebarLink : null;
    },
    querySelectorAll: () => [],
  };

  const previousLocation = global.location;
  global.location = { pathname: projectHref };
  try {
    const title = parser.extractConversationTitle(doc);
    assert.equal(title, 'Перевод i18n JSON для сайта');
    // Specifically NOT the document-title fallback, which carries the project.
    assert.doesNotMatch(title, /Qoople/, 'the project name must not enter the title');
  } finally {
    global.location = previousLocation;
  }
});

test('lists conversations that live inside a Project', () => {
  // Verified on production: a Project conversation is linked as
  // /g/g-p-{projectId}/c/{convId}. Matching only /c/{id} found ZERO of them, so
  // a batch started on a Project exported the global recents instead — a
  // different set, reported as success.
  // Modelled on the measured row: the visible `.truncate` holds the BARE title
  // while aria-label appends a localized description. The old fixture gave the
  // row no `.truncate` at all and set textContent to the full label, so it could
  // only ever exercise the English-regex path that broke under a Russian UI.
  const makeLink = (href, visibleTitle, ariaLabel) => ({
    getAttribute(name) {
      if (name === 'href') return href;
      if (name === 'aria-label') return ariaLabel;
      return null;
    },
    querySelector(sel) {
      return sel === '.truncate' ? { textContent: visibleTitle } : null;
    },
    textContent: visibleTitle,
  });
  const projectId = 'g-p-6954db053ec481919faff2151c140cb6';
  const links = [
    // The ru-RU suffix, measured on production. An English-literal strip leaves
    // it in place and bakes the project name into the folder name.
    makeLink('/g/' + projectId + '/c/69847c8d-e3b0',
      'Перевод i18n JSON для сайта',
      'Перевод i18n JSON для сайта, чат в проекте Qoople'),
    makeLink('/c/plain001', 'A global chat', 'A global chat'),
  ];
  const doc = {
    // Honours CSS attribute semantics: `[href^="/c/"]` is a PREFIX match and
    // `[href*="/c/"]` a substring one. A fixture that ignores the difference
    // returns project links to the narrow selector too, and so cannot detect the
    // very narrowing that lost every project conversation in production.
    querySelectorAll(selector) {
      const parsed = /\[href(\^|\*)="([^"]+)"\]/.exec(String(selector || ''));
      if (!parsed) return [];
      const [, operator, needle] = parsed;
      return links.filter((link) => {
        const href = link.getAttribute('href') || '';
        return operator === '^' ? href.startsWith(needle) : href.indexOf(needle) !== -1;
      });
    },
  };

  const listed = parser.listSidebarConversations(doc);
  assert.deepEqual(listed.map((c) => c.id), ['69847c8d-e3b0', 'plain001']);
  assert.equal(listed[0].projectId, projectId);
  // The href must be the one the PAGE uses: reaching a project conversation
  // through a bare /c/{id} loses its project context.
  assert.equal(listed[0].href, '/g/' + projectId + '/c/69847c8d-e3b0');
  // The accessibility suffix is not part of the title, and would otherwise be
  // baked into the filename and folder name.
  assert.equal(listed[0].title, 'Перевод i18n JSON для сайта');
  assert.equal(listed[0].slug, 'Перевод-i18n-JSON-для-сайта');
  assert.equal(listed[1].projectId, null);
});

test('waitForConversationReady resolves when message content mounts', async () => {
  assert.equal(typeof parser.waitForConversationReady, 'function');
  const previousDocument = global.document;
  const previousLocation = global.location;
  global.location = { pathname: '/c/conv123' };
  global.document = {
    querySelector(selector) {
      if (selector === '[data-turn-id]') return { turnId: 'turn-1' };
      return null;
    },
  };
  try {
    const result = await parser.waitForConversationReady({
      conversationId: 'conv123',
      timeoutMs: 500,
      pollMs: 10,
    });
    assert.equal(result.ready, true);
  } finally {
    global.document = previousDocument;
    global.location = previousLocation;
  }
});

test('waitForConversationReady times out when navigation never arrives', async () => {
  const previousDocument = global.document;
  const previousLocation = global.location;
  global.location = { pathname: '/g/g-p-project' };
  global.document = { querySelector: () => null };
  try {
    const result = await parser.waitForConversationReady({
      conversationId: 'conv123',
      timeoutMs: 40,
      pollMs: 10,
    });
    assert.equal(result.ready, false);
    assert.match(result.error, /Navigation/);
  } finally {
    global.document = previousDocument;
    global.location = previousLocation;
  }
});

test('a title is not truncated at a coincidental prefix', () => {
  // The suffix is removed structurally (aria-label startsWith visible text), so
  // the separator is what distinguishes "title + description" from "the visible
  // text is merely an abbreviation of the label". A sidebar row truncates long
  // titles with an ellipsis while aria-label carries the full one:
  //
  //   visible : "Проектирование хранилища"
  //   label   : "Проектирование хранилища секретов"
  //
  // Without the separator requirement the title silently becomes the truncated
  // visible text and the folder is named after a clipped title. A mutation that
  // dropped that requirement survived every other test.
  const clipped = {
    getAttribute(name) {
      if (name === 'href') return '/c/abc123';
      if (name === 'aria-label') return 'Проектирование хранилища секретов';
      return null;
    },
    querySelector(sel) {
      return sel === '.truncate' ? { textContent: 'Проектирование хранилища' } : null;
    },
    textContent: 'Проектирование хранилища',
  };
  assert.equal(
    parser.titleFromSidebarLink(clipped),
    'Проектирование хранилища секретов',
    'a word-boundary-less remainder is part of the title, not a suffix'
  );

  // The measured project suffix still strips: the remainder starts with ", ".
  const inProject = {
    getAttribute(name) {
      if (name === 'href') return '/g/g-p-abc/c/def456';
      if (name === 'aria-label') return 'Перезапуск nginx, чат в проекте Aether';
      return null;
    },
    querySelector(sel) {
      return sel === '.truncate' ? { textContent: 'Перезапуск nginx' } : null;
    },
    textContent: 'Перезапуск nginx',
  };
  assert.equal(parser.titleFromSidebarLink(inProject), 'Перезапуск nginx');
});

test('a label that does not begin with the visible text is left alone', () => {
  // The structural strip is only valid when aria-label is "visible + suffix".
  // Two guards enforce that: the label must START WITH the visible text, and the
  // remainder must begin with punctuation. They overlap for most inputs, which is
  // why a mutation removing the startsWith guard first survived — the punctuation
  // check still rejected the mid-word slice.
  //
  // This input separates them. visible "Отчёт" is 5 characters and label[5] is a
  // comma, so a blind slice(5) yields ", черновик отчёта" — punctuation-led, and
  // therefore accepted by the second guard alone. Only startsWith can reject it.
  // Without that guard the title becomes "Отчёт", a string the row never showed.
  const unrelatedLabel = {
    getAttribute(name) {
      if (name === 'href') return '/c/xyz789';
      if (name === 'aria-label') return 'Итоги, черновик отчёта';
      return null;
    },
    querySelector(sel) {
      return sel === '.truncate' ? { textContent: 'Отчёт' } : null;
    },
    textContent: 'Отчёт',
  };
  assert.equal(
    parser.titleFromSidebarLink(unrelatedLabel),
    'Итоги, черновик отчёта',
    'a label not prefixed by the visible text must not be cut by length'
  );
});

/* ------------------------------------------------------------------------- *
 * Artefacts that render no chip.
 *
 * Measured on production: a conversation with five generated PDF/DOCX files
 * returned ZERO matches for all six ATTACHMENT_CHIP_SELECTORS, no <a href>, no
 * [download], and no data-testid. The API path exists because the DOM cannot
 * express the file->message link at all, not as an optimisation.
 * ------------------------------------------------------------------------- */

/** A fetch stub that answers only the URLs it is given, so an unexpected
 *  request fails loudly instead of silently returning empty data. */
function stubFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init: init || null });
    for (const [pattern, responder] of routes) {
      if (String(url).indexOf(pattern) !== -1) return responder(String(url), init);
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  impl.calls = calls;
  return impl;
}
const jsonOk = (body) => () => ({ ok: true, status: 200, json: async () => body });

test('artefacts are enumerated from the conversation API, with message ids', async () => {
  // Shape copied from the live 200 response: uploaded files live in
  // metadata.attachments, generated ones in content.parts[].asset_pointer.
  const fetchImpl = stubFetch([
    ['/api/auth/session', jsonOk({ accessToken: 'tok-123' })],
    ['/backend-api/conversation/conv-1', jsonOk({
      mapping: {
        n1: { message: { id: 'msg-a', metadata: { attachments: [
          { id: 'file_up1', name: 'brief.pdf', mime_type: 'application/pdf', size: 4096 },
        ] }, content: { parts: ['hello'] } } },
        n2: { message: { id: 'msg-b', metadata: {}, content: { parts: [
          { asset_pointer: 'sediment://file_gen9', mime_type: 'image/png' },
        ] } } },
      },
    })],
  ]);

  const found = await parser.fetchConversationArtifacts('conv-1', { fetchImpl });
  assert.equal(found.length, 2);
  const upload = found.find((a) => a.kind === 'attachment');
  assert.equal(upload.name, 'brief.pdf');
  assert.equal(upload.messageId, 'msg-a');
  assert.equal(upload.fileId, 'file_up1');
  const asset = found.find((a) => a.kind === 'asset');
  assert.equal(asset.messageId, 'msg-b');
  assert.equal(asset.fileId, 'file_gen9', 'the file id is parsed out of the asset pointer');
});

test('an unreadable API returns null, never an empty artefact list', async () => {
  // "No artefacts" and "could not tell" must not collapse into the same value:
  // a 401 that reads as an empty list turns a failed export into a clean one.
  const unauthorized = stubFetch([
    ['/api/auth/session', jsonOk({ accessToken: 'tok-123' })],
    ['/backend-api/conversation/conv-1', () => ({ ok: false, status: 401, json: async () => ({}) })],
  ]);
  assert.equal(await parser.fetchConversationArtifacts('conv-1', { fetchImpl: unauthorized }), null);

  // No token at all (signed out, or the session shape changed).
  const noToken = stubFetch([['/api/auth/session', jsonOk({})]]);
  assert.equal(await parser.fetchConversationArtifacts('conv-1', { fetchImpl: noToken }), null);

  // A conversation with genuinely no files is an EMPTY LIST, which is different.
  const empty = stubFetch([
    ['/api/auth/session', jsonOk({ accessToken: 'tok-123' })],
    ['/backend-api/conversation/conv-1', jsonOk({ mapping: {
      n1: { message: { id: 'msg-a', metadata: {}, content: { parts: ['just text'] } } },
    } })],
  ]);
  assert.deepEqual(await parser.fetchConversationArtifacts('conv-1', { fetchImpl: empty }), []);
});

test('a sandbox artefact resolves to a host-checked download url', async () => {
  const fetchImpl = stubFetch([
    ['/interpreter/download', jsonOk({
      download_url: 'https://chatgpt.com/backend-api/estuary/content?id=file_x&fn=report.pdf',
      file_name: 'report.pdf', mime_type: 'application/pdf', file_size_bytes: 900,
    })],
  ]);
  const got = await parser.resolveSandboxDownloadUrl(
    'conv-1', 'msg-a', '/mnt/data/report.pdf', { fetchImpl, token: 'tok' });
  assert.equal(got.fileName, 'report.pdf');
  assert.equal(got.size, 900);
  assert.ok(fetchImpl.calls[0].url.indexOf('message_id=msg-a') !== -1,
    'message_id is mandatory: omitting it returns 422 on production');
  assert.ok(fetchImpl.calls[0].url.indexOf(encodeURIComponent('/mnt/data/report.pdf')) !== -1);

  // A url on a host that merely CONTAINS the real one must be refused, because
  // the popup fetches whatever comes back.
  const hostile = stubFetch([
    ['/interpreter/download', jsonOk({
      download_url: 'https://chatgpt.com.attacker.net/backend-api/estuary/content?id=file_x',
      file_name: 'report.pdf',
    })],
  ]);
  assert.equal(await parser.resolveSandboxDownloadUrl(
    'conv-1', 'msg-a', '/mnt/data/report.pdf', { fetchImpl: hostile, token: 'tok' }), null);
});

test('the artefact panel yields file names, not the translated download button', () => {
  // Measured under ru-RU: each artifact row holds an open-file button whose
  // aria-label is the FILE NAME, plus a sibling button labelled "Скачать файл"
  // ("Download file" in English). Matching the button by its label would break
  // in every other locale; the file name is user data and carries an extension.
  const buttons = [
    { getAttribute: (n) => (n === 'aria-label' ? 'Talomnia_RU_v0.5.pdf' : null) },
    { getAttribute: (n) => (n === 'aria-label' ? 'Скачать файл' : null) },
    { getAttribute: (n) => (n === 'aria-label' ? 'Talomnia_EN_v0.5.docx' : null) },
    { getAttribute: (n) => (n === 'aria-label' ? 'Download file' : null) },
    { getAttribute: (n) => (n === 'aria-label' ? 'Кадры решают всё' : null) },
  ];
  const doc = {
    querySelectorAll(sel) {
      return /open-file|artifact-row/.test(sel) ? buttons : [];
    },
  };
  const files = parser.listArtifactPanelFiles(doc);
  assert.deepEqual(files.map((f) => f.name),
    ['Talomnia_RU_v0.5.pdf', 'Talomnia_EN_v0.5.docx']);
  assert.equal(files[0].sandboxPath, '/mnt/data/Talomnia_RU_v0.5.pdf');
});

test('one working message id is reused across every panel file', async () => {
  // Measured: 12 different message ids all resolved the SAME sandbox_path to the
  // same file id, so the id is required context and not a selector. Retrying the
  // candidate list per file would multiply requests against the user's account.
  let downloadCalls = 0;
  const fetchImpl = stubFetch([
    ['/interpreter/download', (url) => {
      downloadCalls += 1;
      // Only the second candidate id is accepted, to prove the search happens
      // once and its result is carried forward.
      if (url.indexOf('message_id=good') === -1) {
        return { ok: false, status: 422, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => ({
        download_url: 'https://chatgpt.com/backend-api/estuary/content?id=file_q',
        file_name: 'x.pdf',
      }) };
    }],
  ]);

  const files = [
    { name: 'a.pdf', sandboxPath: '/mnt/data/a.pdf' },
    { name: 'b.pdf', sandboxPath: '/mnt/data/b.pdf' },
    { name: 'c.pdf', sandboxPath: '/mnt/data/c.pdf' },
  ];
  const out = await parser.resolveArtifactPanelFiles('conv-1', {
    files, fetchImpl, token: 'tok', messageIds: ['bad', 'good'],
  });

  assert.equal(out.length, 3);
  assert.ok(out.every((r) => r.resolved !== null), 'every file must resolve');
  // File 1: 'bad' then 'good' = 2 calls. Files 2 and 3: 'good' directly = 1 each.
  assert.equal(downloadCalls, 4, 'the working id must not be re-discovered per file');
});

test('panel artefacts are appended to the markdown as downloadable links', async () => {
  // The popup's downloader reads artefacts out of the finished markdown
  // (parseArtifactRefs), so a file that never appears there is never fetched.
  const doc = {
    querySelectorAll(sel) {
      if (!/open-file|artifact-row/.test(sel)) return [];
      return [
        { getAttribute: (n) => (n === 'aria-label' ? 'report.pdf' : null) },
        { getAttribute: (n) => (n === 'aria-label' ? 'Скачать файл' : null) },
      ];
    },
  };
  const fetchImpl = stubFetch([
    ['/interpreter/download', jsonOk({
      download_url: 'https://chatgpt.com/backend-api/estuary/content?id=file_r&fn=report.pdf',
      file_name: 'report.pdf',
    })],
  ]);

  const out = await parser.appendPanelArtifacts('# Chat\n\nbody', {
    doc,
    conversationId: 'conv-1',
    artifacts: [{ kind: 'asset', messageId: 'msg-a' }],
    fetchImpl,
    token: 'tok',
  });

  assert.ok(out.indexOf('## Files') !== -1, 'a Files section must be added');
  assert.ok(out.indexOf('[report.pdf](https://chatgpt.com/backend-api/estuary/content') !== -1,
    'the link must be in the markdown link form the popup parses');
  assert.ok(out.indexOf('body') !== -1, 'the conversation body must survive');
});

test('an artefact that cannot be resolved is disclosed, not dropped', async () => {
  // Silently omitting a file presents a partial export as a complete one.
  const doc = {
    querySelectorAll(sel) {
      return /open-file|artifact-row/.test(sel)
        ? [{ getAttribute: (n) => (n === 'aria-label' ? 'secret.docx' : null) }]
        : [];
    },
  };
  const failing = stubFetch([
    ['/interpreter/download', () => ({ ok: false, status: 500, json: async () => ({}) })],
  ]);

  const out = await parser.appendPanelArtifacts('body', {
    doc,
    conversationId: 'conv-1',
    artifacts: null,            // the API itself was unreadable
    fetchImpl: failing,
    token: 'tok',
  });

  assert.ok(out.indexOf('secret.docx') !== -1, 'the file must still be named');
  assert.ok(out.indexOf('Could not retrieve') !== -1, 'the failure must be visible');
  assert.ok(out.indexOf('conversation API was unreachable') !== -1,
    'an unreadable API must be distinguished from a failed single file');
});

test('a conversation with no panel artefacts is left byte-identical', async () => {
  const doc = { querySelectorAll() { return []; } };
  const md = '# Chat\n\nbody';
  assert.equal(await parser.appendPanelArtifacts(md, { doc, conversationId: 'c' }), md);
});

test('the capture path itself appends panel artefacts', async () => {
  // Testing appendPanelArtifacts in isolation proved nothing about whether the
  // export pipeline calls it: a mutation deleting the call from
  // getConversationMarkdown left every other test green. This test exercises the
  // wiring, which is the part that ships.
  const turn = userTurn('user-1', 1, 'Make me a PDF');

  const panelButtons = [
    { getAttribute: (n) => (n === 'aria-label' ? 'report.pdf' : null) },
    { getAttribute: (n) => (n === 'aria-label' ? 'Скачать файл' : null) },
  ];

  const container = createVirtualizedFixture([[turn]], 0);
  container.overflowY = 'auto';
  turn.parentElement = container;

  const previousDocument = global.document;
  const previousStyle = global.getComputedStyle;
  const previousLocation = global.location;
  const previousFetch = global.fetch;

  global.document = {
    title: 'ChatGPT',
    querySelector: (sel) => (sel === '[data-turn-id]' ? turn : null),
    querySelectorAll(sel) {
      if (/open-file|artifact-row/.test(sel)) return panelButtons;
      // The real page carries message ids on the turns; the download endpoint
      // needs one and the artefact panel does not supply it.
      if (sel === '[data-message-id]') {
        return [{ getAttribute: (n) => (n === 'data-message-id' ? 'msg-1' : null) }];
      }
      return container.querySelectorAll('[data-turn-id]');
    },
  };
  global.getComputedStyle = (node) => ({ overflowY: node.overflowY || 'visible' });
  global.location = { pathname: '/c/conv-77', href: 'https://chatgpt.com/' };
  global.fetch = async (url) => {
    const target = String(url);
    if (target.indexOf('/api/auth/session') !== -1) {
      return { ok: true, status: 200, json: async () => ({ accessToken: 'tok' }) };
    }
    if (target.indexOf('/backend-api/conversation/conv-77/interpreter/download') !== -1) {
      return { ok: true, status: 200, json: async () => ({
        download_url: 'https://chatgpt.com/backend-api/estuary/content?id=file_z&fn=report.pdf',
        file_name: 'report.pdf',
      }) };
    }
    if (target.indexOf('/backend-api/conversation/conv-77') !== -1) {
      return { ok: true, status: 200, json: async () => ({
        mapping: { n1: { message: { id: 'msg-1', metadata: {}, content: { parts: ['hi'] } } } },
      }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  try {
    const result = await parser.getConversationMarkdown({ downloadFiles: true });
    assert.equal(result.ok, true, 'capture failed: ' + result.error);
    assert.ok(result.md.indexOf('## Files') !== -1,
      'the shipped capture path must include panel artefacts');
    assert.ok(
      result.md.indexOf('[report.pdf](https://chatgpt.com/backend-api/estuary/content') !== -1,
      'the artefact must be a markdown link the popup can parse'
    );
  } finally {
    global.document = previousDocument;
    global.getComputedStyle = previousStyle;
    global.location = previousLocation;
    if (previousFetch === undefined) delete global.fetch; else global.fetch = previousFetch;
  }
});

test('a plain copy makes no network request at all', async () => {
  // PRIVACY.md states that saving files is the ONLY mode in which the extension
  // makes network requests. Retrieving generated artefacts needs the conversation
  // API, so that lookup must stay behind the save option — otherwise a plain
  // "Copy as Markdown" silently starts calling out and the shipped privacy
  // promise becomes false.
  const turn = userTurn('user-1', 1, 'Make me a PDF');
  const panelButtons = [
    { getAttribute: (n) => (n === 'aria-label' ? 'report.pdf' : null) },
  ];
  const container = createVirtualizedFixture([[turn]], 0);
  container.overflowY = 'auto';
  turn.parentElement = container;

  const previousDocument = global.document;
  const previousStyle = global.getComputedStyle;
  const previousLocation = global.location;
  const previousFetch = global.fetch;

  const requests = [];
  global.document = {
    title: 'ChatGPT',
    querySelector: (sel) => (sel === '[data-turn-id]' ? turn : null),
    querySelectorAll(sel) {
      if (/open-file|artifact-row/.test(sel)) return panelButtons;
      if (sel === '[data-message-id]') {
        return [{ getAttribute: (n) => (n === 'data-message-id' ? 'msg-1' : null) }];
      }
      return container.querySelectorAll('[data-turn-id]');
    },
  };
  global.getComputedStyle = (node) => ({ overflowY: node.overflowY || 'visible' });
  global.location = { pathname: '/c/conv-77', href: 'https://chatgpt.com/' };
  global.fetch = async (url) => {
    requests.push(String(url));
    return { ok: false, status: 500, json: async () => ({}) };
  };

  try {
    const result = await parser.getConversationMarkdown();
    assert.equal(result.ok, true);
    assert.deepEqual(requests, [], 'a plain copy must not touch the network');
    assert.ok(result.md.indexOf('## Files') === -1,
      'no Files section is added when file saving was not requested');
  } finally {
    global.document = previousDocument;
    global.getComputedStyle = previousStyle;
    global.location = previousLocation;
    if (previousFetch === undefined) delete global.fetch; else global.fetch = previousFetch;
  }
});

test('a late-mounting artefact panel is waited for', async () => {
  // Measured on production: after navigation, turns mounted at ~9s and the
  // artefact rows only at ~12s. A single-frame read at 11s found nothing, so an
  // export triggered right after opening a conversation dropped all five of its
  // generated documents in silence.
  let ticks = 0;
  const doc = {
    querySelectorAll(sel) {
      if (!/open-file|artifact-row/.test(sel)) return [];
      // The panel appears only on the third poll.
      return ticks >= 3
        ? [{ getAttribute: (n) => (n === 'aria-label' ? 'late.pdf' : null) }]
        : [];
    },
  };
  const sleep = async () => { ticks += 1; };
  let clock = 0;
  const now = () => (clock += 100);

  const files = await parser.waitForArtifactPanel(doc, { sleep, now, panelWaitMs: 5000 });
  assert.deepEqual(files.map((f) => f.name), ['late.pdf']);
  assert.ok(ticks >= 3, 'the wait must actually poll');
});

test('the panel wait gives up quietly instead of hanging', async () => {
  const doc = { querySelectorAll() { return []; } };
  let clock = 0;
  const files = await parser.waitForArtifactPanel(doc, {
    sleep: async () => {},
    now: () => (clock += 400),
    panelWaitMs: 1000,
  });
  assert.deepEqual(files, [], 'absence is absence, not an error');
});

test('a conversation the API says has no files does not pay the panel wait', async () => {
  // Most conversations have no generated files. Waiting the full budget for each
  // of them would slow every export, so the API result gates the wait.
  let slept = 0;
  const doc = { querySelectorAll() { return []; } };
  const out = await parser.appendPanelArtifacts('body', {
    doc,
    conversationId: 'conv-1',
    artifacts: [],                 // the API answered: nothing here
    sleep: async () => { slept += 1; },
    now: () => Date.now(),
  });
  assert.equal(out, 'body');
  assert.equal(slept, 0, 'an empty conversation must not wait for a panel');
});

test('appendPanelArtifacts waits for a panel that has not mounted yet', async () => {
  // Testing waitForArtifactPanel alone proved nothing about whether the export
  // uses it: a mutant replacing the call with a single-frame read survived —
  // and that single-frame read IS the production bug (panel at ~12s, read at
  // ~11s, five documents lost silently).
  let polls = 0;
  const doc = {
    querySelectorAll(sel) {
      if (!/open-file|artifact-row/.test(sel)) return [];
      return polls >= 2
        ? [{ getAttribute: (n) => (n === 'aria-label' ? 'slow.pdf' : null) }]
        : [];
    },
  };
  const fetchImpl = stubFetch([
    ['/interpreter/download', jsonOk({
      download_url: 'https://chatgpt.com/backend-api/estuary/content?id=file_s',
      file_name: 'slow.pdf',
    })],
  ]);

  const out = await parser.appendPanelArtifacts('body', {
    doc,
    conversationId: 'conv-1',
    artifacts: [{ kind: 'asset', messageId: 'msg-1' }],  // API says files exist
    fetchImpl,
    token: 'tok',
    sleep: async () => { polls += 1; },
    now: () => Date.now(),
    panelWaitMs: 5000,
  });

  assert.ok(out.indexOf('slow.pdf') !== -1,
    'a panel that mounts late must still be exported');
});

test('an unreadable API still waits for the panel', async () => {
  // artifacts === null means "could not tell". Skipping the wait there would
  // turn a transient API failure into a silently file-less export, which is the
  // same collapse of "no files" and "could not tell" the null return exists to
  // prevent.
  let polls = 0;
  const doc = {
    querySelectorAll(sel) {
      if (!/open-file|artifact-row/.test(sel)) return [];
      return polls >= 2
        ? [{ getAttribute: (n) => (n === 'aria-label' ? 'orphan.pdf' : null) }]
        : [];
    },
  };
  const failing = stubFetch([
    ['/interpreter/download', () => ({ ok: false, status: 500, json: async () => ({}) })],
  ]);

  const out = await parser.appendPanelArtifacts('body', {
    doc,
    conversationId: 'conv-1',
    artifacts: null,
    fetchImpl: failing,
    token: 'tok',
    sleep: async () => { polls += 1; },
    now: () => Date.now(),
    panelWaitMs: 5000,
  });

  assert.ok(out.indexOf('orphan.pdf') !== -1,
    'the file must be named even though its link could not be resolved');
  assert.ok(out.indexOf('Could not retrieve') !== -1);
});
