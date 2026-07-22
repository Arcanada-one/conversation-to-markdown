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

test('fails without returning partial turns when the scan times out', async () => {
  const container = createVirtualizedFixture([[{ turnId: 'u1', markdown: 'partial' }]], 12);
  let clock = 0;

  await assert.rejects(
    parser.scanTurns(container, {
      extractTurn: (turn) => turn,
      settle: async () => {},
      now: () => { clock += 100; return clock; },
      timeoutMs: 50,
    }),
    /timed out/
  );
  assert.equal(container.scrollTop, 12);
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

  try {
    global.requestAnimationFrame = (callback) => setImmediate(callback);
    Date.now = () => { clock += 500; return clock; };

    await assert.rejects(
      parser.scanTurns(container, {
        extractTurn: (candidate) => candidate,
        settle: async () => {},
        stablePasses: 2,
        maxSteps: 10,
        timeoutMs: 120000,
      }),
      /Conversation scroll did not settle before timeout/
    );
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
      if (behavior === 'smooth' && top === 0) this.scrollHeight = 130;
      if (behavior === 'auto') restoring = true;
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

test('fails explicitly when an observed turn never receives content', async () => {
  const shell = { turnId: 'empty-turn', order: 1, role: 'assistant', markdown: '' };
  const container = createVirtualizedFixture([[shell]], 18);

  await assert.rejects(
    parser.scanTurns(container, {
      extractTurn: () => null,
      settle: async () => {},
      stablePasses: 2,
      maxSteps: 4,
    }),
    /step limit/
  );
  assert.equal(container.scrollTop, 18);
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
      if (selector === 'img[src*="estuary/content"]') {
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
      if (selector === 'img[src*="estuary/content"]') return [];
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
      if (selector === 'img[src*="estuary/content"]') {
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
        if (selector === 'img[src*="estuary/content"]') {
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
  global.document = {
    querySelector: () => turns[0],
    querySelectorAll: () => container.querySelectorAll('[data-turn-id]'),
  };
  global.getComputedStyle = (node) => ({ overflowY: node.overflowY || 'visible' });
  try {
    const result = await parser.getConversationMarkdown();
    assert.equal(result.ok, true);
    assert.match(result.md, /#### You said:\n\nQuestion/);
    assert.match(result.md, /#### ChatGPT said:\n\n!\[Result\]/);
    assert.equal(typeof result.lines, 'number');
    assert.equal(typeof result.words, 'number');
    assert.equal(container.scrollTop, 44);
  } finally {
    global.document = previousDocument;
    global.getComputedStyle = previousStyle;
  }
});
