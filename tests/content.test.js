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
  const makeLink = (id, title) => ({
    getAttribute(name) {
      if (name === 'href') return '/c/' + id;
      if (name === 'aria-label') return title;
      return null;
    },
    querySelector: () => null,
    textContent: title,
  });
  const doc = {
    querySelectorAll(selector) {
      if (selector === 'nav a[href^="/c/"]') {
        return [
          makeLink('aaa111', 'Alpha chat'),
          makeLink('bbb222', 'Beta chat'),
          makeLink('aaa111', 'Alpha duplicate'),
        ];
      }
      return [];
    },
  };
  const listed = parser.listSidebarConversations(doc);
  assert.deepEqual(listed.map((item) => item.id), ['aaa111', 'bbb222']);
  assert.equal(listed[0].title, 'Alpha chat');
  assert.equal(listed[0].slug, 'Alpha-chat');
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
