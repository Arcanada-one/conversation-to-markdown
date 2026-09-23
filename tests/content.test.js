'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const parser = require('../content.js');

test('content.js survives being injected twice into one document', () => {
  // Reported from chrome://extensions against a live conversation:
  //   Uncaught SyntaxError: Identifier 'ATTACHMENT_CHIP_SELECTORS' has already
  //   been declared          content.js:1
  //
  // The manifest declares this script on every chatgpt.com page AND popup.js
  // re-injects it after a batch navigation. On an already-loaded tab both run
  // in the same window, and the second copy dies at PARSE time on the first
  // top-level `const` — so none of its code executes. The export still produced
  // a file, because the first copy's listener answered; the only symptom was an
  // error page most users never open.
  //
  // Executing the real shipped file twice in one context is the only way to
  // reach this. Requiring the module twice cannot: Node caches it, and the
  // second require returns the same exports without re-parsing.
  const source = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    URL,
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
    module: undefined,
  });

  vm.runInContext(source, context, { filename: 'content.js#1' });
  // Positive control: the first injection must actually define the binding the
  // second one would collide with, or this test passes over an empty file.
  assert.equal(
    context.ATTACHMENT_CHIP_SELECTORS === undefined, false,
    'the first injection must define the top-level bindings',
  );

  assert.doesNotThrow(
    () => vm.runInContext(source, context, { filename: 'content.js#2' }),
    're-injecting into a document that already has the script must be a no-op',
  );
});

test('content.js carries no version number of its own', () => {
  // The header said `v1.3.0` while manifest.json said 1.4.0. Every other place
  // the version appears is coupled by a test; a comment is not, so it drifts
  // and then lies with the authority of documentation.
  const header = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8')
    .slice(0, 2000);
  assert.equal(
    /v\d+\.\d+\.\d+/.test(header), false,
    'content.js must not restate the version; manifest.json is the one source',
  );
});

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
    // The page's own start marker, which the climb waits for. On the live site
    // it lives on a CONTAINER around the turn, not on the turn itself, so it is
    // answered here as its own element rather than by decorating a turn — the
    // production check walks up from the turn and queries the document, and a
    // fixture that cannot tell the two selectors apart cannot exercise either.
    querySelector(selector) {
      const wantsMarker = String(selector).indexOf('paginated-root') !== -1;
      const atStart = this.scrollTop <= 1;
      if (wantsMarker) {
        // The marker element EXISTS in the page whether or not the climb has
        // reached it — that is what distinguishes "not there yet" from "this
        // layout has no marker". It contains the first turn only at the start.
        const first = pages[0] && pages[0][0];
        return {
          getAttribute: (name) => (name === 'data-turn-id-container'
            ? 'paginated-root:conv-fixture' : null),
          querySelector: () => (atStart && first ? first : null),
        };
      }
      // This fixture models the legacy marker layout, not the separate
      // pagination sentinel. Unknown selectors match nothing, as in a DOM.
      if (selector !== '[data-turn-id]') return null;
      const list = this.querySelectorAll(selector);
      return list && list.length ? list[0] : null;
    },
  };
  container.scrollCalls = calls;
  return container;
}

// Measured DOM shape: an empty root, a separate pagination sentinel, and
// height-preserving containers. The sentinel needs to LEAVE and RE-ENTER;
// assigning scrollTop=0 again never loads a third page on its own.
function createSentinelConversation(options = {}) {
  let loaded = options.complete ? 220 : 20;
  let intersecting = false;
  let markerGone = !!options.complete;
  const calls = [];
  const attrNode = (attrs, querySelector = () => null) => ({
    tagName: 'DIV', getAttribute: name => attrs[name] ?? null, querySelector,
  });
  let first = attrNode({ 'data-turn-id': 'first-' + loaded });
  const root = attrNode({ 'data-turn-id-container': options.paginatedRoot ? 'paginated-root:fixture' : 'client-created-root' });
  const sentinel = attrNode({ 'data-testid': 'conversation-pagination-sentinel' },
    sel => sel === 'svg' && options.loading ? {} : null);
  const container = {
    scrollTop: 40000, scrollHeight: 55000, clientHeight: 855,
    querySelector(selector) {
      if (selector === '[data-testid="conversation-pagination-sentinel"]') return markerGone ? null : sentinel;
      if (selector === '[data-turn-id-container="client-created-root"]') return options.paginatedRoot ? null : root;
      if (selector === 'div[data-turn-id-container^="paginated-root:"]') return options.paginatedRoot ? root : null;
      if (selector === '[data-turn-id]') return first;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-turn-id]') return [first];
      if (selector !== 'div[data-turn-id-container]') return [];
      return [root, ...Array.from({ length: loaded }, (_, i) =>
        attrNode({ 'data-turn-id-container': i === 0 ? 'first-' + loaded : 'holder-' + i },
          () => i === 0 && !options.firstUnmounted ? first : null))];
    },
  };
  const scrollTo = async (target, top) => {
    calls.push(top);
    target.scrollTop = top;
    const nextIntersecting = top < 855;
    if (nextIntersecting && !intersecting && !options.stalled && !options.loading && !markerGone) {
      loaded = Math.min(220, loaded + 10);
      target.scrollHeight += 4000;
      first = attrNode({ 'data-turn-id': 'first-' + loaded });
      markerGone = loaded === 220;
    }
    intersecting = nextIntersecting;
  };
  return { container, scrollTo, calls, loaded: () => loaded };
}

test('sentinel re-entry loads the full history after repeated top assignments stall', async () => {
  const control = createSentinelConversation();
  for (let i = 0; i < 50; i++) await control.scrollTo(control.container, 0);
  assert.equal(control.loaded(), 30, 'positive control: repeated zero really stalls');
  const page = createSentinelConversation();
  const result = await parser.scrollToConversationStart(page.container, {
    scrollTo: page.scrollTo, sleep: async () => {}, noProgressRounds: 6,
  });
  assert.equal(page.loaded(), 220);
  assert.equal(result.reachedTop, true);
  assert.equal(result.confirmedByPagination, true);
  assert.equal(result.confirmedByMarker, false);
  assert.ok(page.calls.some(top => top >= page.container.clientHeight));
});

test('an already fully loaded pagination layout confirms its first mounted holder', async () => {
  for (const paginatedRoot of [false, true]) {
    const page = createSentinelConversation({ complete: true, paginatedRoot });
    const result = await parser.scrollToConversationStart(page.container, {
      scrollTo: page.scrollTo, sleep: async () => {},
    });
    assert.equal(result.reachedTop, true);
    assert.equal(result.rounds, 1);
  }
});

test('sentinel disappearance cannot confirm a later mounted turn above an empty first holder', async () => {
  for (const paginatedRoot of [false, true]) {
    const page = createSentinelConversation({ complete: true, firstUnmounted: true, paginatedRoot });
    const result = await parser.scrollToConversationStart(page.container, {
      scrollTo: page.scrollTo, sleep: async () => {}, noProgressRounds: 4,
    });
    assert.equal(result.reachedTop, false);
    assert.equal(result.markerAbsentFromPage, false);
  }
});

test('a pending sentinel never receives the marker-less completeness exemption', async () => {
  for (const paginatedRoot of [false, true]) {
    for (const loading of [false, true]) {
      const page = createSentinelConversation({ stalled: true, loading, paginatedRoot });
      const result = await parser.scrollToConversationStart(page.container, {
        scrollTo: page.scrollTo, sleep: async () => {}, noProgressRounds: 4,
      });
      assert.equal(result.reachedTop, false);
      assert.equal(result.markerAbsentFromPage, false);
      assert.ok(result.rounds <= 6, 're-entry does not replenish the failure budget');
      assert.equal(page.calls.some(top => top > 0), !loading,
        'an active loading indicator prevents re-entry until the request finishes');
    }
  }
});

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

/**
 * A conversation that prepends history when scrolled to 0, as measured on the
 * live site: the height went 6900 -> 53335 -> 55775 across one run, and each
 * arrival pushed the position back down. A single jump lands mid-conversation.
 */
function createPrependingConversation(options) {
  const opts = options || {};
  const chunks = opts.chunks === undefined ? 3 : opts.chunks;
  // Whether the page ever exposes its own start marker. A fixture that cannot
  // produce one cannot express arrival at all under the current criterion —
  // which is how seven tests came to drive the silence fallback instead of the
  // behaviour they were written for.
  const marks = opts.marksStart !== false;
  let loaded = 0;
  const container = {
    scrollTop: 50000,
    scrollHeight: 6900,
    clientHeight: 900,
    firstTurnId: 'turn-latest',
    atStart: false,
    firstTurnNode() {
      return {
        getAttribute(name) {
          if (name === 'data-turn-id') return container.firstTurnId;
          // The page marks the root of pagination only on the turn that really
          // is the first one. Everything else carries its own id.
          if (name === 'data-turn-id-container') {
            return (marks && container.atStart)
              ? 'paginated-root:conv-fixture' : container.firstTurnId;
          }
          return null;
        },
      };
    },
    querySelector() { return container.firstTurnNode(); },
    querySelectorAll() { return [container.firstTurnNode()]; },
  };
  container.jumpToTop = function() {
    if (loaded < chunks) {
      // History arrives: the document grows and the position is pushed back
      // down, so this jump did NOT reach the beginning.
      loaded += 1;
      container.scrollHeight += 20000;
      container.scrollTop = opts.settlesAtZero ? 0 : 3000;
      container.firstTurnId = 'turn-older-' + loaded;
      return;
    }
    container.scrollTop = 0;
    container.atStart = true;
  };
  return container;
}

test('the scan reaches the true beginning of a conversation that prepends history', async () => {
  // The defect this covers: scrollTo(0) settled at 2850 of 0 while the
  // virtualizer unmounted the turns above, and the scan walked down from the
  // middle. A 126KB conversation exported as 26KB.
  const container = createPrependingConversation();

  const result = await parser.scrollToConversationStart(container, {
    scrollTo: async (target) => { target.jumpToTop(); },
    sleep: async () => {},
    settleMs: 0,
  });

  assert.equal(result.reachedTop, true);
  assert.equal(container.scrollTop, 0);
  // Positive control: one jump is genuinely not enough on this fixture, so the
  // assertion above is not vacuously true.
  const single = createPrependingConversation();
  single.jumpToTop();
  assert.notEqual(single.scrollTop, 0);
});

test('position zero while history is still arriving is not the beginning', async () => {
  // Position 0 on a thread still prepending history is not the beginning. This
  // fixture parks at 0 on EVERY jump while older turns keep arriving, so a
  // position check — and the old steady-first-turn check with it — would stop
  // above nothing and lose the history.
  const container = createPrependingConversation({ chunks: 2, settlesAtZero: true });
  const seen = [];

  const result = await parser.scrollToConversationStart(container, {
    scrollTo: async (target) => { target.jumpToTop(); },
    sleep: async () => {},
    settleMs: 0,
    readFirstTurnId: (target) => { seen.push(target.firstTurnId); return target.firstTurnId; },
  });

  assert.equal(result.reachedTop, true);
  assert.equal(result.confirmedByMarker, true, 'arrival must come from the page marker');
  // Positive control: the fixture really does sit at zero before it is done, so
  // the assertion above is not vacuous — a position-only check would have
  // stopped on the very first round.
  const early = createPrependingConversation({ chunks: 2, settlesAtZero: true });
  early.jumpToTop();
  assert.equal(early.scrollTop, 0, 'fixture parks at zero while still loading');
  assert.equal(early.atStart, false, 'yet it is NOT at the start');
});

test('history still arriving keeps resetting the patience budget', async () => {
  // The climb gives up only when it stops producing history. That reset is what
  // separates "slow" from "finished", and without it the budget runs out while
  // pages are still arriving: measured on the simulator, deleting the reset lost
  // 434 turns of 600 at a 2s fetch delay. A SHORT conversation is unharmed,
  // which is why this needs its own test — the slow-fetch test above stays green
  // under that mutation.
  //
  // The fixture delivers one page per round, slower than the budget, forever
  // until the start. Each page is progress; only a working reset survives it.
  // The fixture mirrors what the virtualizer really does: the FIRST MOUNTED
  // TURN changes only when a new page of history lands, and it takes several
  // rounds of climbing to pull each one. In between, every observable is
  // identical — same id, same count — which is exactly the state the budget is
  // counting. Only resetting on the page that does land keeps the climb alive.
  const roundsPerPage = 12;          // slower than nothing, faster than never
  const pages = 8;                   // 96 rounds total, > twice the 40 budget
  let round = 0;
  const container = {
    scrollTop: 9000, scrollHeight: 90000, clientHeight: 900, atStart: false,
    pagesIn: 0,
    node() {
      return {
        getAttribute: (n) => n === 'data-turn-id'
          // Stays put between arrivals — this is the whole difficulty.
          ? 'turn-page-' + container.pagesIn
          : (container.atStart ? 'paginated-root:c' : 'mid'),
      };
    },
    querySelector() { return container.node(); },
    querySelectorAll() { return [container.node()]; },
    climb() {
      round += 1;
      if (round % roundsPerPage === 0) {
        container.pagesIn += 1;      // a page of history finally arrives
        if (container.pagesIn >= pages) {
          container.atStart = true;
          container.scrollTop = 0;
        }
      }
    },
  };

  const result = await parser.scrollToConversationStart(container, {
    scrollTo: async (target) => { target.climb(); },
    sleep: async () => {},
    settleMs: 0,
  });

  assert.equal(result.reachedTop, true,
    'the climb must not give up while history is still arriving');
  assert.ok(result.rounds >= pages * roundsPerPage - roundsPerPage,
    `expected a climb of ~${pages * roundsPerPage} rounds, took ${result.rounds}`);
});

test('a long conversation is not cut short by a fixed round ceiling', async () => {
  // A constant ceiling is a length limit on the conversation wearing a disguise,
  // and it survived the first round of mutation testing unnoticed: restoring
  // `maxRounds = 40` left every test green while the simulator lost 36 turns.
  //
  // Measured on the simulator: the climb needs about one round per three turns
  // (142 -> 45, 600 -> 200, 3000 -> 1000). So a thread long enough to exceed any
  // fixed budget must still arrive. 1146 turns is a real size — this operator's
  // own thread — and at the retired ceiling of 40 it would stop 290 turns short.
  const pagesNeeded = 120;          // 3x the retired ceiling of 40
  let page = 0;
  const container = {
    scrollTop: 5000, scrollHeight: 90000, clientHeight: 900, atStart: false,
    node() {
      return {
        getAttribute: (n) => n === 'data-turn-id'
          ? 'turn-' + page
          : (container.atStart ? 'paginated-root:c' : 'mid-' + page),
      };
    },
    querySelector() { return container.node(); },
    querySelectorAll() { return [container.node()]; },
    climb() {
      page += 1;                     // each round really does pull more history
      if (page >= pagesNeeded) { container.atStart = true; container.scrollTop = 0; }
    },
  };

  const result = await parser.scrollToConversationStart(container, {
    scrollTo: async (target) => { target.climb(); },
    sleep: async () => {},
    settleMs: 0,
  });

  assert.equal(result.reachedTop, true, 'a long climb must still reach the start');
  assert.ok(result.rounds >= pagesNeeded,
    `needed ${pagesNeeded} rounds of history, took ${result.rounds}`);
  // Positive control: the fixture genuinely requires more rounds than the old
  // ceiling allowed, so this is not vacuously true.
  assert.ok(pagesNeeded > 40, 'fixture must exceed the retired ceiling to prove the point');
});

test('a page that publishes no marker settles quickly instead of waiting it out', async () => {
  // Waiting the full patience budget for a marker that this layout will never
  // show cost 16.4 seconds of EVERY export (measured: 41 rounds x 400ms). It is
  // not a data defect, which is exactly why it survived the first mutation pass
  // — no turns are lost, only the user's time.
  const turn = { getAttribute: (n) => (n === 'data-turn-id' ? 'turn-1' : null) };
  const container = {
    scrollTop: 0, scrollHeight: 5000, clientHeight: 900,
    // Answers only its OWN selector. A fixture that returns a node for every
    // query says "the marker is here" to a check asking whether the page has
    // one at all — which is how 20 tests went red on a correct change.
    querySelector: (sel) => (String(sel).indexOf('paginated-root') !== -1 ? null : turn),
    querySelectorAll: () => [turn],
  };

  const result = await parser.scrollToConversationStart(container, {
    scrollTo: async () => {}, sleep: async () => {},
  });

  assert.equal(result.reachedTop, false, 'no marker means arrival is unconfirmed');
  assert.equal(result.quietedWithoutMarker, true, 'but the old criterion was met');
  assert.equal(result.markerAbsentFromPage, true, 'and the page has no marker at all');
  assert.ok(result.rounds <= 10,
    `a marker-less page must settle cheaply, took ${result.rounds} rounds`);

  // Positive control: a page that DOES publish the attribute still gets the full
  // patience, so the cheap exit cannot swallow a slow-but-marked page.
  let round = 0;
  const marked = {
    scrollTop: 0, scrollHeight: 5000, clientHeight: 900,
    node: () => ({
      getAttribute: (n) => n === 'data-turn-id' ? 'turn-1'
        : (round > 20 ? 'paginated-root:c' : 'mid'),
    }),
    querySelector() { return marked.node(); },
    querySelectorAll() { return [marked.node()]; },
  };
  const slow = await parser.scrollToConversationStart(marked, {
    scrollTo: async () => { round += 1; }, sleep: async () => {},
  });
  assert.equal(slow.reachedTop, true, 'a marked page is waited for, not cut off');
  assert.ok(slow.rounds > 20, 'and it took longer than the cheap exit allows');
});

test('a quiet climb on a marker-less page is not reported as a partial export', async () => {
  // A false "partial" tells the user their good data is untrustworthy. If
  // ChatGPT renames the attribute, EVERY export would carry that notice while
  // being perfectly complete. The three outcomes stay distinct.
  const turn = { getAttribute: (n) => (n === 'data-turn-id' ? 't1' : null) };
  const container = {
    scrollTop: 0, clientHeight: 100, scrollHeight: 100,
    scrollTo() {}, querySelector: () => turn,
    querySelectorAll: () => [{ turnId: 't1', order: 1, role: 'user', markdown: 'hi' }],
  };
  const meta = {};

  await parser.scanTurns(container, {
    extractTurn: (t) => t,
    settle: async () => {},
    scanMeta: meta,
    maxSteps: 5,
    scrollToStart: async () => ({
      reachedTop: false, confirmedByMarker: false,
      quietedWithoutMarker: true, markerAbsentFromPage: true, rounds: 7,
    }),
  });
  assert.notEqual(meta.partial, true, 'a quiet marker-less climb is not partial');

  // Negative control: a climb that was still MOVING must still flag partial —
  // the relaxation must not swallow the real failure it was carved out of.
  const meta2 = {};
  await parser.scanTurns(container, {
    extractTurn: (t) => t,
    settle: async () => {},
    scanMeta: meta2,
    maxSteps: 5,
    scrollToStart: async () => ({
      reachedTop: false, confirmedByMarker: false,
      quietedWithoutMarker: false, markerAbsentFromPage: true, rounds: 40,
    }),
  });
  assert.equal(meta2.partial, true, 'a climb that never settled IS partial');
  assert.equal(meta2.reason, 'never reached the start');

  // THE CASE THAT SHIPPED TRUNCATED AND SILENT: the page DOES publish a marker,
  // the climb quieted down without reaching it. Exempting every quiet climb —
  // rather than only the ones on a page with no marker at all — is what let an
  // export missing 82% of its conversation come out with no notice.
  const meta3 = {};
  await parser.scanTurns(container, {
    extractTurn: (t) => t,
    settle: async () => {},
    scanMeta: meta3,
    maxSteps: 5,
    scrollToStart: async () => ({
      reachedTop: false, confirmedByMarker: false,
      quietedWithoutMarker: true, markerAbsentFromPage: false, rounds: 41,
    }),
  });
  assert.equal(meta3.partial, true,
    'a page WITH a marker the climb never reached is a truncated export');
  assert.equal(meta3.reason, 'never reached the start');
});

// The two tests below exist because mutation testing found them missing. The
// marker is recognised through TWO independent paths — walking up the turn's
// ancestors, and matching the document's marker container against the first
// mounted turn — and every earlier fixture satisfied BOTH at once. Disabling
// either path on its own therefore stayed green, while the shipped defect was
// precisely "one path, and it was the wrong one". Each test below leaves
// exactly one path able to answer.

test('the marker is found on an ANCESTOR of the first turn', async () => {
  // The live shape, measured 2026-09-14:
  //   <div data-turn-id-container="paginated-root:<conversation id>">
  //     <section data-turn-id="bbb21ebf-…" data-turn-id-container="bbb21ebf-…">
  // Reading the attribute off the SECTION returns that section's own id, never
  // the marker. That is why the first version of the check could not return
  // true on any real page, and every export fell through to the timing guess.
  const makeTurn = (id, withRoot) => {
    const turn = {
      getAttribute: (n) => (n === 'data-turn-id' ? id
        : n === 'data-turn-id-container' ? id : null),
      parentElement: withRoot ? {
        getAttribute: (n) => (n === 'data-turn-id-container'
          ? 'paginated-root:conv-x' : null),
        parentElement: null,
      } : null,
    };
    return turn;
  };

  let round = 0;
  const container = {
    scrollTop: 0, scrollHeight: 40000, clientHeight: 900,
    first() { return makeTurn(round > 6 ? 'sec-first' : 'sec-mid', round > 6); },
    // The document CANNOT answer the marker query, so the sibling-container
    // path is unavailable and only the ancestor walk can confirm arrival.
    querySelector(sel) {
      return String(sel).indexOf('paginated-root') !== -1 ? null : container.first();
    },
    querySelectorAll() { return [container.first()]; },
  };

  const result = await parser.scrollToConversationStart(container, {
    scrollTo: async () => { round += 1; }, sleep: async () => {},
  });

  assert.equal(result.reachedTop, true,
    'a marker on the ancestor container confirms the start');
  assert.equal(result.confirmedByMarker, true);

  // Positive control: the same fixture WITHOUT the ancestor never confirms, so
  // the assertion above is not satisfied by something else in the climb.
  let r2 = 0;
  const noAncestor = {
    scrollTop: 0, scrollHeight: 40000, clientHeight: 900,
    first() { return makeTurn(r2 > 6 ? 'sec-first' : 'sec-mid', false); },
    querySelector(sel) {
      return String(sel).indexOf('paginated-root') !== -1 ? null : noAncestor.first();
    },
    querySelectorAll() { return [noAncestor.first()]; },
  };
  const control = await parser.scrollToConversationStart(noAncestor, {
    scrollTo: async () => { r2 += 1; }, sleep: async () => {},
  });
  assert.equal(control.reachedTop, false,
    'without the ancestor there is nothing to confirm arrival');
});

test('the marker container is matched against the first mounted turn', async () => {
  // The second shape: the marker sits on a container the turn is not a DOM
  // ancestor-chain member of (a fixture cannot always model parentElement, and
  // a re-render can detach it). Arrival is then proven by the turn INSIDE the
  // marker container being the first mounted turn — never by the container
  // merely existing, which it does even at the bottom of the thread.
  let round = 0;
  const firstId = () => (round > 6 ? 'sec-first' : 'sec-mid');
  // No parentElement at all: the ancestor walk cannot answer here.
  const turn = () => ({
    getAttribute: (n) => (n === 'data-turn-id' ? firstId()
      : n === 'data-turn-id-container' ? firstId() : null),
  });
  const markerContainer = {
    getAttribute: (n) => (n === 'data-turn-id-container'
      ? 'paginated-root:conv-y' : null),
    // Holds the conversation's genuinely first turn, which is only MOUNTED
    // once the climb has pulled the history back that far.
    querySelector: () => (round > 6 ? turn() : null),
  };
  const container = {
    scrollTop: 0, scrollHeight: 40000, clientHeight: 900,
    querySelector(sel) {
      return String(sel).indexOf('paginated-root') !== -1 ? markerContainer : turn();
    },
    querySelectorAll() { return [turn()]; },
  };

  const result = await parser.scrollToConversationStart(container, {
    scrollTo: async () => { round += 1; }, sleep: async () => {},
  });

  assert.equal(result.reachedTop, true,
    'the first mounted turn being the marked one confirms the start');

  // Negative control, and it is the one that matters: the marker container is
  // present from the very bottom of the thread (measured: present with 5 of
  // 142 turns mounted). Its EXISTENCE must never be read as arrival.
  let r2 = 0;
  const neverArrives = {
    scrollTop: 0, scrollHeight: 40000, clientHeight: 900,
    querySelector(sel) {
      return String(sel).indexOf('paginated-root') !== -1
        ? { getAttribute: () => 'paginated-root:conv-y', querySelector: () => null }
        : { getAttribute: (n) => (n === 'data-turn-id' ? 'sec-mid' : 'sec-mid') };
    },
    querySelectorAll() {
      return [{ getAttribute: (n) => (n === 'data-turn-id' ? 'sec-mid' : 'sec-mid') }];
    },
  };
  const control = await parser.scrollToConversationStart(neverArrives, {
    scrollTo: async () => { r2 += 1; }, sleep: async () => {},
  });
  assert.equal(control.reachedTop, false,
    'a marker container that holds no mounted turn is not the beginning');
  assert.equal(control.markerAbsentFromPage, false,
    'and the page DOES publish a marker, so a partial export must be flagged');
});

test('the same NODE is arrival even when it carries no id', async () => {
  // Node identity is checked BEFORE the ids, and it has to be: a turn stripped
  // of its attributes (a re-render mid-flight, an unexpected markup change) is
  // still unambiguously the turn inside the marker container when it is the
  // very same object. Deleting the identity check left a fixture like this one
  // silently unconfirmed while every other test stayed green.
  let round = 0;
  const theTurn = { getAttribute: () => null };      // ONE stable node, no id
  const someOtherTurn = { getAttribute: () => null };
  const markerContainer = {
    getAttribute: (n) => (n === 'data-turn-id-container' ? 'paginated-root:z' : null),
    querySelector: () => (round > 6 ? theTurn : someOtherTurn),
  };
  const container = {
    scrollTop: 0, scrollHeight: 40000, clientHeight: 900,
    querySelector(sel) {
      return String(sel).indexOf('paginated-root') !== -1 ? markerContainer : theTurn;
    },
    querySelectorAll() { return [theTurn]; },
  };

  const result = await parser.scrollToConversationStart(container, {
    scrollTo: async () => { round += 1; }, sleep: async () => {},
  });
  assert.equal(result.reachedTop, true,
    'the identical node inside the marker is the beginning, id or no id');
});

test('two different id-less turns are never called the same turn', async () => {
  // The mirror of the test above, and the reason the id comparison is guarded
  // by `!!a`. Two DIFFERENT nodes that both lack the attribute compare as
  // `null === null` — which would declare arrival at a marker container holding
  // something else entirely. A wrong "we are at the start" silently truncates.
  const firstTurn = { getAttribute: () => null };
  const insideMarker = { getAttribute: () => null };   // different object
  const markerContainer = {
    getAttribute: (n) => (n === 'data-turn-id-container' ? 'paginated-root:q' : null),
    querySelector: () => insideMarker,
  };
  const container = {
    scrollTop: 0, scrollHeight: 40000, clientHeight: 900,
    querySelector(sel) {
      return String(sel).indexOf('paginated-root') !== -1 ? markerContainer : firstTurn;
    },
    querySelectorAll() { return [firstTurn]; },
  };

  const result = await parser.scrollToConversationStart(container, {
    scrollTo: async () => {}, sleep: async () => {},
  });
  assert.equal(result.reachedTop, false,
    'a shared absence of ids is not evidence of being the same turn');
});

test('whether the page publishes a marker is asked of the DOCUMENT', async () => {
  // `publishesMarker` decides how long to wait and whether a quiet climb may
  // skip the partial notice. The marker CONTAINER exists in the document from
  // the bottom of the thread onwards, while the first mounted turn carries no
  // such attribute at all — so asking the turn answers "this layout has no
  // marker", which both cuts the climb short and exempts it from the warning.
  // That combination is exactly the shipped defect, from the other direction.
  const plainTurn = { getAttribute: (n) => (n === 'data-turn-id' ? 't1' : null) };
  const markerContainer = {
    getAttribute: (n) => (n === 'data-turn-id-container' ? 'paginated-root:w' : null),
    querySelector: () => null,      // the first turn is not mounted yet
  };
  const container = {
    scrollTop: 0, scrollHeight: 40000, clientHeight: 900,
    querySelector(sel) {
      return String(sel).indexOf('paginated-root') !== -1 ? markerContainer : plainTurn;
    },
    querySelectorAll() { return [plainTurn]; },
  };

  const result = await parser.scrollToConversationStart(container, {
    scrollTo: async () => {}, sleep: async () => {},
  });
  assert.equal(result.markerAbsentFromPage, false,
    'the document publishes a marker even though the first turn does not');
  assert.equal(result.reachedTop, false, 'and the climb never reached it');
  // Measured: asking the turn instead collapses this climb from 41 rounds to 7,
  // because a marker-less layout is given the cheap exit. The full patience is
  // the observable difference, so assert it rather than the flag alone.
  assert.ok(result.rounds > 10,
    `a marked page gets the full patience, took ${result.rounds} rounds`);
});

test('a climb that can never finish still returns, and says it is partial', async () => {
  // Found by mutation testing, and it is a real defect rather than an artefact
  // of the mutant: removing the fixed round ceiling left the loop with no exit
  // at all for a page that keeps LOOKING like progress. A first turn id that
  // changes every round resets the patience budget forever while the marker
  // never matches, so the climb runs until the tab is closed — no export, no
  // error, nothing to re-run. A re-rendering list produces exactly this shape.
  let n = 0;
  let virtualNow = 0;
  const turn = () => ({
    getAttribute: (k) => (k === 'data-turn-id' ? 't' + n : null),
    parentElement: null,
  });
  const otherTurn = { getAttribute: (k) => (k === 'data-turn-id' ? 'OTHER' : null) };
  const markerContainer = {
    getAttribute: (k) => (k === 'data-turn-id-container' ? 'paginated-root:z' : null),
    querySelector: () => otherTurn,       // never the first mounted turn
  };
  const container = {
    scrollTop: 0, scrollHeight: 40000, clientHeight: 900,
    querySelector(sel) {
      return String(sel).indexOf('paginated-root') !== -1 ? markerContainer : turn();
    },
    querySelectorAll() { return [turn()]; },
  };

  const result = await parser.scrollToConversationStart(container, {
    scrollTo: async () => { n += 1; virtualNow += 400; },
    sleep: async () => {},
    now: () => virtualNow,
  });

  assert.equal(result.ranOutOfTime, true, 'the clock is what ended this climb');
  assert.equal(result.reachedTop, false, 'and it never reached the start');
  assert.equal(result.markerAbsentFromPage, false,
    'a timed-out climb must never qualify for the marker-less exemption');

  // The ceiling must be a TIME limit, not a length limit in disguise: the
  // simulator reaches a 3000-turn conversation in 1000 rounds, so the budget
  // has to allow well past that before it fires.
  assert.ok(result.rounds > 1000,
    `the backstop must not cap conversation length, fired at ${result.rounds}`);

  // Positive control: a climb that WOULD finish is never cut off by the clock,
  // because the ceiling is checked last.
  let round = 0;
  const marked = {
    scrollTop: 0, scrollHeight: 40000, clientHeight: 900,
    node: () => ({
      getAttribute: (k) => (k === 'data-turn-id' ? 'the-first' : null),
      parentElement: round > 3 ? {
        getAttribute: (k) => (k === 'data-turn-id-container'
          ? 'paginated-root:ok' : null),
        parentElement: null,
      } : null,
    }),
    querySelector(sel) {
      return String(sel).indexOf('paginated-root') !== -1 ? null : marked.node();
    },
    querySelectorAll() { return [marked.node()]; },
  };
  let okNow = 0;
  const ok = await parser.scrollToConversationStart(marked, {
    // A realistic clock — one round costs about a settle — and a budget this
    // climb fits inside. The ceiling exists for the loop that never ends, not
    // for the one that takes a while, and this asserts it does not fire early.
    scrollTo: async () => { round += 1; okNow += 400; },
    sleep: async () => {},
    now: () => okNow,
    maxClimbMs: 600000,
  });
  assert.equal(ok.reachedTop, true, 'arrival is decided before the clock is');
  assert.notEqual(ok.ranOutOfTime, true);
});

test('the clock is checked after arrival, never before it', async () => {
  // The positive control above cannot see the ORDER of the two checks, because
  // its clock never advances past the ceiling. Here the ceiling is already
  // exceeded on the very first round AND the page is at its start: if the
  // ceiling were tested first, a conversation that was fully captured would be
  // reported as a truncated one — a false partial on complete data, which this
  // repository treats as a real cost rather than a safe default.
  const atStart = {
    getAttribute: (k) => (k === 'data-turn-id' ? 'first' : null),
    parentElement: {
      getAttribute: (k) => (k === 'data-turn-id-container'
        ? 'paginated-root:done' : null),
      parentElement: null,
    },
  };
  const container = {
    scrollTop: 0, scrollHeight: 40000, clientHeight: 900,
    querySelector(sel) {
      return String(sel).indexOf('paginated-root') !== -1 ? null : atStart;
    },
    querySelectorAll() { return [atStart]; },
  };

  // The elapsed time is measured from a `startedAt` captured BEFORE the loop,
  // so a constant clock always reads zero elapsed and proves nothing — the
  // first version of this test asserted against a mutant that behaved
  // identically to the real code. The clock has to ADVANCE past the budget
  // during the very first round for the ordering to be observable at all.
  let virtualNow = 0;
  const result = await parser.scrollToConversationStart(container, {
    scrollTo: async () => { virtualNow += 10000; },   // one round blows the budget
    sleep: async () => {},
    now: () => virtualNow,
    maxClimbMs: 1000,
  });

  assert.equal(result.reachedTop, true,
    'a conversation already at its start is complete, whatever the clock says');
  assert.notEqual(result.ranOutOfTime, true,
    'and it must not be reported as having run out of time');
  assert.equal(result.rounds, 1, 'positive control: only one round ran');
});

test('a timed-out climb on a marker-less page is still a partial export', async () => {
  // The marker-less exemption exists so a renamed attribute does not put a
  // false warning on every export. It must NOT swallow a climb the clock cut
  // short: there, turns really are missing. Both conditions hold at once here —
  // no marker anywhere on the page, and a climb that kept producing new first
  // turn ids until the ceiling fired — so this is the exact overlap.
  let n = 0;
  let virtualNow = 0;
  const turn = () => ({
    getAttribute: (k) => (k === 'data-turn-id' ? 't' + n : null),
    parentElement: null,
  });
  const container = {
    scrollTop: 0, scrollHeight: 40000, clientHeight: 900,
    // Answers nothing for the marker: this layout has no such mechanism.
    querySelector(sel) {
      return String(sel).indexOf('paginated-root') !== -1 ? null : turn();
    },
    querySelectorAll() { return [turn()]; },
  };

  const start = await parser.scrollToConversationStart(container, {
    scrollTo: async () => { n += 1; virtualNow += 400; },
    sleep: async () => {},
    now: () => virtualNow,
  });
  assert.equal(start.ranOutOfTime, true, 'positive control: the clock fired');
  assert.equal(start.markerAbsentFromPage, false,
    'a timed-out climb never claims the marker-less exemption');

  // And the flag reaches the export, which is the part the user sees.
  const meta = {};
  const scanTarget = {
    scrollTop: 0, clientHeight: 100, scrollHeight: 100, scrollTo() {},
    querySelector: () => turn(),
    querySelectorAll: () => [{ turnId: 't1', order: 1, role: 'user', markdown: 'hi' }],
  };
  await parser.scanTurns(scanTarget, {
    extractTurn: (t) => t,
    settle: async () => {},
    scanMeta: meta,
    maxSteps: 5,
    scrollToStart: async () => start,
  });
  assert.equal(meta.partial, true, 'the export says it is partial');
  assert.equal(meta.reason, 'never reached the start');
});

test('a slow history fetch is never mistaken for the end of the conversation', async () => {
  // THE DEFECT, in the form it reached a user: 299 lines (11%) of a real
  // conversation lost with no partial notice. Measured against a simulated
  // virtualized page, the threshold was exact and was this function's own
  // arithmetic — stableRounds(3) x settleMs(400) = 1200ms:
  //
  //     fetch delay 1200ms ->   0 turns lost
  //     fetch delay 1300ms ->  12 turns lost
  //     fetch delay 1700ms -> 132 of 142 lost
  //
  // Here the fixture stays SILENT for more rounds than the old criterion would
  // wait, then finally delivers the rest of the history. Stopping during that
  // silence is the defect; waiting through it is the fix.
  const silentRounds = 12;      // 4x the old patience of 3 rounds
  let round = 0;
  const container = {
    scrollTop: 0, scrollHeight: 40000, clientHeight: 900,
    firstTurnId: 'turn-mid', atStart: false,
    node() {
      return {
        getAttribute: (n) => n === 'data-turn-id'
          ? container.firstTurnId
          : (container.atStart ? 'paginated-root:c' : 'mid'),
      };
    },
    querySelector() { return container.node(); },
    querySelectorAll() { return [container.node()]; },
    scrollTo() {
      round += 1;
      // Nothing at all changes while the fetch is in flight: same id, same
      // height, already at zero. Every condition the old criterion checked is
      // satisfied by a page that is merely waiting for the network.
      if (round > silentRounds) { container.atStart = true; }
    },
  };

  const result = await parser.scrollToConversationStart(container, {
    scrollTo: async (target) => { target.scrollTo(); },
    sleep: async () => {},
    settleMs: 0,
  });

  assert.equal(result.reachedTop, true, 'the climb must wait out a slow fetch');
  assert.ok(result.rounds > silentRounds,
    `must keep climbing through ${silentRounds} silent rounds (took ${result.rounds})`);
});

test('a conversation that never reaches its start exports as partial', async () => {
  // Failing the climb must not fail the export — a flagged partial beats
  // nothing — but the user has to be able to read that it happened.
  const container = createPrependingConversation({ chunks: Infinity });

  const result = await parser.scrollToConversationStart(container, {
    scrollTo: async (target) => { target.jumpToTop(); },
    sleep: async () => {},
    settleMs: 0,
    maxRounds: 5,
  });

  assert.equal(result.reachedTop, false);
  assert.equal(result.rounds, 5);
});

test('the scan marks a partial export when it never reached the start', async () => {
  const container = createVirtualizedFixture([
    [{ turnId: 'u1', markdown: 'from the middle' }],
  ], 0);
  const scanMeta = {};

  await parser.scanTurns(container, {
    readSections: (target) => target.querySelectorAll('[data-turn-id]'),
    extractTurn: (turn) => turn,
    settle: async () => {},
    scrollTo: async () => {},
    scrollToStart: async () => ({ reachedTop: false, rounds: 40 }),
    scanMeta: scanMeta,
  });

  assert.equal(scanMeta.partial, true);
  assert.equal(scanMeta.reason, 'never reached the start');
  const md = parser.prefixPartialNotice(parser.buildConversationMarkdown([]), scanMeta.reason);
  assert.match(md, />\s*\*\*Partial export\*\*/);
});

test('a scan that reaches the start is not flagged partial', async () => {
  // The other direction: a false "partial export" notice on a complete file
  // tells the user their good data is untrustworthy.
  const container = createVirtualizedFixture([
    [{ turnId: 'u1', markdown: 'complete' }],
  ], 0);
  const scanMeta = {};

  await parser.scanTurns(container, {
    readSections: (target) => target.querySelectorAll('[data-turn-id]'),
    extractTurn: (turn) => turn,
    settle: async () => {},
    scrollTo: async () => {},
    scrollToStart: async () => ({ reachedTop: true, rounds: 4 }),
    scanMeta: scanMeta,
  });

  assert.notEqual(scanMeta.reason, 'never reached the start');
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
    // This fixture is about stalling mid-scan, so it starts from a reached top;
    // otherwise the climb reports first and masks the stall under test.
    scrollToStart: async () => ({ reachedTop: true, rounds: 1 }),
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
  let scanCall = 0;
  const container = {
    scrollTop: 0,
    clientHeight: 100,
    scrollHeight: 200,
    scrollTo(options) { this.scrollTop = Math.max(0, Math.min(options.top, 100)); },
    querySelectorAll() {
      scanCall += 1;
      // First mount yields the real answer, later mounts yield longer chrome.
      const markdown = scanCall === 1 ? good : degraded;
      return [{ turnId: 'd1', order: 1, role: 'assistant', markdown }];
    },
    // The climb reads the page too, and counting ITS reads as mounts made this
    // fixture hand the good capture to the climb instead of to the scan. The
    // scan is what this test is about, so the climb is settled separately.
    querySelector() {
      return { getAttribute: () => 'paginated-root:conv-fixture' };
    },
  };

  const turns = await parser.scanTurns(container, {
    extractTurn: (turn) => (turn.markdown ? turn : null),
    settle: async () => {},
    stablePasses: 2,
    maxSteps: 30,
    scrollToStart: async () => ({ reachedTop: true, confirmedByMarker: true, rounds: 1 }),
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

/* ------------------------------------------------------------------------- *
 * Files the API NAMES but never attaches.
 *
 * Measured on a production conversation (2026-09-13). Six generated files; the
 * two archives among them survived six releases of click-interception work
 * because every reader looked in the wrong place. Both are named in the API
 * response as bare `/mnt/data/…` paths and resolve through the ordinary
 * interpreter/download endpoint — no click, no main world, no prototype patch.
 * ------------------------------------------------------------------------- */

test('bare /mnt/data paths in message text are read as artefacts', async () => {
  // Verbatim shapes from the measured response: the assistant states the path
  // in prose, and a `tool` message — which NEVER reaches the markdown — states
  // the others. Searching the exported file could not have found any of them.
  const fetchImpl = stubFetch([
    ['/api/auth/session', jsonOk({ accessToken: 'tok-123' })],
    ['/backend-api/conversation/conv-1', jsonOk({
      mapping: {
        n1: { message: { id: 'msg-a', author: { role: 'assistant' }, metadata: {},
          content: { parts: ['Готово: /mnt/data/canon-consilium-prompt-bundle-v1.zip — забирайте.'] } } },
        n2: { message: { id: 'msg-tool', author: { role: 'tool' }, metadata: {},
          content: { parts: ['wrote /mnt/data/Canon_Arcana_v0.2_to_v0.3.diff'] } } },
      },
    })],
  ]);

  const found = await parser.fetchConversationArtifacts('conv-1', { fetchImpl });
  const paths = found.map((a) => a.sandboxPath).sort();
  assert.deepEqual(paths, [
    '/mnt/data/Canon_Arcana_v0.2_to_v0.3.diff',
    '/mnt/data/canon-consilium-prompt-bundle-v1.zip',
  ], 'both archives are found, and the tool message is read like any other');
  const zip = found.find((a) => a.sandboxPath.endsWith('.zip'));
  assert.equal(zip.kind, 'sandbox');
  assert.equal(zip.name, 'canon-consilium-prompt-bundle-v1.zip');
  assert.equal(zip.messageId, 'msg-a', 'the id travels with the path');
});

test('a path the USER typed is not fetched as an artefact', async () => {
  // A path in the user's own message is a request, not a produced file. Asking
  // the backend for it spends a request per mention to be told there is none.
  const fetchImpl = stubFetch([
    ['/api/auth/session', jsonOk({ accessToken: 'tok-123' })],
    ['/backend-api/conversation/conv-1', jsonOk({
      mapping: {
        n1: { message: { id: 'msg-u', author: { role: 'user' }, metadata: {},
          content: { parts: ['положи результат в /mnt/data/wanted.zip'] } } },
      },
    })],
  ]);
  assert.deepEqual(await parser.fetchConversationArtifacts('conv-1', { fetchImpl }), []);

  // POSITIVE CONTROL: the identical text from the assistant IS collected, so the
  // empty result above is the role check and not a pattern that matches nothing.
  const fromAssistant = stubFetch([
    ['/api/auth/session', jsonOk({ accessToken: 'tok-123' })],
    ['/backend-api/conversation/conv-1', jsonOk({
      mapping: {
        n1: { message: { id: 'msg-a', author: { role: 'assistant' }, metadata: {},
          content: { parts: ['положи результат в /mnt/data/wanted.zip'] } } },
      },
    })],
  ]);
  const found = await parser.fetchConversationArtifacts('conv-1', { fetchImpl: fromAssistant });
  assert.equal(found.length, 1, 'the same sentence from the assistant IS an artefact');
});

test('sandbox paths are parsed in both the bare and the scheme-prefixed shape', () => {
  const found = parser.sandboxPathsFromApiMessage({
    content: { parts: [
      'bare /mnt/data/a.zip and scheme sandbox:/mnt/data/b.diff here',
      // Trailing punctuation is sentence punctuation, not part of the name.
      'end of line /mnt/data/c.txt.',
      // A Cyrillic label may follow with no separator at all.
      '[Скачать](sandbox:/mnt/data/d.zip)',
      // A bare directory names no file.
      'see /mnt/data/ for details',
    ] },
  });
  assert.deepEqual(found.map((f) => f.sandboxPath), [
    '/mnt/data/a.zip', '/mnt/data/b.diff', '/mnt/data/c.txt', '/mnt/data/d.zip',
  ]);
  assert.deepEqual(found.map((f) => f.name), ['a.zip', 'b.diff', 'c.txt', 'd.zip']);
});

test('the same path stated twice yields one artefact', () => {
  const found = parser.sandboxPathsFromApiMessage({
    content: { parts: ['/mnt/data/x.zip', 'again: /mnt/data/x.zip'] },
  });
  assert.equal(found.length, 1);
});

test('a button is not clicked for a file the API already resolved', () => {
  // The stem spells with hyphens what the label spells with spaces. Before the
  // fold, indexOf() was -1 and the archive was fetched AND clicked: the same
  // bytes twice, plus the viewer-over-panel regression this exclusion exists to
  // prevent.
  const buttons = [
    { label: 'Скачать готовый Canon Consilium Prompt Bundle v1', archive: true },
    { label: 'Скачать чужой архив', archive: true },
  ];
  const kept = parser.filterButtonsAgainstPanel(
    buttons, ['canon-consilium-prompt-bundle-v1.zip']);
  assert.deepEqual(kept.map((b) => b.label), ['Скачать чужой архив'],
    'the resolved file is excluded, the unresolved one survives');
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

test('an archive named only in the API is exported with no panel and no link', async () => {
  // THE MEASURED CASE, end to end. The archive has:
  //   no panel row      (a .zip has no viewer, so the panel never lists it)
  //   no sandbox: link  (the markdown contains ZERO occurrences — measured)
  //   no attachment     (it is interpreter output, not an upload)
  // Its ONLY trace is the path in the API message text. Six releases of
  // click-interception work missed it because nothing read that text.
  const doc = { querySelectorAll() { return []; } };
  const fetchImpl = stubFetch([
    ['/interpreter/download', (url) => {
      // The endpoint selects the file by sandbox_path, so the path must arrive.
      assert.ok(url.indexOf(encodeURIComponent('/mnt/data/bundle-v1.zip')) !== -1,
        'the sandbox path must be sent');
      return { ok: true, status: 200, json: async () => ({
        download_url: 'https://chatgpt.com/backend-api/estuary/content?id=file_z&fn=bundle-v1.zip',
        file_name: 'bundle-v1.zip',
      }) };
    }],
  ]);

  const out = await parser.appendPanelArtifacts('# Chat\n\nbody with no link at all', {
    doc,
    conversationId: 'conv-1',
    artifacts: [{
      kind: 'sandbox', messageId: 'msg-a', name: 'bundle-v1.zip',
      fileId: null, mimeType: null, size: null,
      sandboxPath: '/mnt/data/bundle-v1.zip',
    }],
    clickDownloads: false,     // prove it needs no click whatsoever
    fetchImpl,
    token: 'tok',
  });

  assert.ok(out.indexOf('[bundle-v1.zip](https://chatgpt.com/backend-api/estuary/content') !== -1,
    'the archive must reach the markdown as a downloadable link, without a click');
});

test('an API-named file that does not resolve is disclosed, never invented', async () => {
  // The negative control that made this design safe: a path for a file that does
  // not exist answered 200 WITH NO LINK. Checking the status instead of the link
  // would have reported success for any nonsense path.
  const doc = { querySelectorAll() { return []; } };
  const noLink = stubFetch([
    ['/interpreter/download', jsonOk({ file_name: 'ghost.tar' })],   // 200, no url
  ]);

  const out = await parser.appendPanelArtifacts('body', {
    doc,
    conversationId: 'conv-1',
    artifacts: [{
      kind: 'sandbox', messageId: 'msg-a', name: 'ghost.tar',
      sandboxPath: '/mnt/data/ghost.tar',
    }],
    clickDownloads: false,
    fetchImpl: noLink,
    token: 'tok',
  });

  assert.ok(out.indexOf('ghost.tar') !== -1, 'the file must still be named');
  assert.ok(out.indexOf('Could not retrieve') !== -1,
    'a 200 without a link is a failure, not a success');
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

test('the capture path collects a button that is only mounted early in the scan', async () => {
  // The wiring, not the helper. Two mutants survived a suite that drove
  // collectButtonDownloads directly with a hand-supplied list: "do not collect
  // during the scan" and "do not pass what was collected". Both are exactly the
  // production defect — the buttons live in the FIRST reply, the export starts
  // at the bottom, and nothing carried them across.
  const turn = userTurn('user-1', 1, 'Собери архив');
  // Starts at the BOTTOM, which is where a real export starts: the user scrolls
  // to the end of a long thread and clicks save. The scan restores that position
  // when it finishes, which is what unmounts the early turn's button again.
  const container = createVirtualizedFixture([[turn]], 100);
  container.overflowY = 'auto';
  turn.parentElement = container;

  const previousDocument = global.document;
  const previousStyle = global.getComputedStyle;
  const previousLocation = global.location;
  const previousFetch = global.fetch;
  const previousWindow = global.window;

  // The archive button exists ONLY while the page is scrolled to the top, the
  // way a virtualized turn's button does. `scanTurns` restores the original
  // position in its `finally`, so after the walk it is gone and a post-scan read
  // cannot find it. Tied to the ACTUAL scroll position rather than a flag that
  // only ever turns on: a latch that never resets leaves the button visible
  // forever, and then the fixture cannot express the failure at all — mutants
  // deleting the collection and the hand-off both survived against exactly that.
  const buttonMounted = () => container.scrollTop <= 1;

  // Count the trips back to the top. The scan makes one; the retired button
  // traversal made a second. Both routes are watched — the scan goes through
  // scrollTo, the traversal assigns scrollTop directly.
  let returnsToTop = 0;
  let scrollTopValue = container.scrollTop;
  let wasAtTop = scrollTopValue <= 1;
  Object.defineProperty(container, 'scrollTop', {
    get() { return scrollTopValue; },
    set(value) {
      scrollTopValue = value;
      const atTop = value <= 1;
      if (atTop && !wasAtTop) returnsToTop += 1;
      wasAtTop = atTop;
    },
  });
  const archiveButton = downloadButton('Скачать готовый Canon Consilium Prompt Bundle v1', {
    onClick() {
      global.window.HTMLAnchorElement.prototype.click.call({
        getAttribute: () => 'https://chatgpt.com/backend-api/estuary/content' +
          '?id=file_9&fn=canon-consilium-prompt-bundle-v1.zip&SIGNED&ts=1',
        hasAttribute: (n) => n === 'download',
      });
    },
  });
  // What the landing position shows instead: unrelated suggestions. Two of them,
  // as measured — enough to make a "found nothing here" guard stand down.
  const suggestions = [
    downloadButton('Make the opening more concrete'),
    downloadButton('Clarify what Canon Arcana stores'),
  ];

  global.document = {
    title: 'ChatGPT',
    querySelector: (sel) => (sel === '[data-turn-id]' ? turn : null),
    querySelectorAll(sel) {
      if (/behavior-btn/.test(sel)) {
        return buttonMounted() ? [archiveButton].concat(suggestions) : suggestions;
      }
      if (/open-file|artifact-row/.test(sel)) return [];
      if (sel === '[data-message-id]') {
        return [{ getAttribute: (n) => (n === 'data-message-id' ? 'msg-1' : null) }];
      }
      return container.querySelectorAll('[data-turn-id]');
    },
  };
  global.getComputedStyle = (node) => ({ overflowY: node.overflowY || 'visible' });
  global.location = { pathname: '/c/conv-88', href: 'https://chatgpt.com/' };
  global.window = makeWin();
  global.fetch = async (url) => {
    const target = String(url);
    if (target.indexOf('/api/auth/session') !== -1) {
      return { ok: true, status: 200, json: async () => ({ accessToken: 'tok' }) };
    }
    return { ok: true, status: 200, json: async () => ({ mapping: {} }) };
  };

  try {
    const result = await parser.getConversationMarkdown({ downloadFiles: true });
    assert.equal(result.ok, true, 'capture failed: ' + result.error);
    assert.equal(archiveButton.clicked, 1,
      'the button seen only during the scan must still be clicked');
    assert.ok(
      result.md.indexOf('canon-consilium-prompt-bundle-v1.zip') !== -1,
      'the archive must reach the markdown the popup downloads from'
    );
    // Positive control: the suggestions are present throughout and must never be
    // clicked, or the assertion above could be satisfied by clicking everything.
    assert.equal(suggestions[0].clicked, 0);
    assert.equal(suggestions[1].clicked, 0);
    // ONE walk. The click assertion alone cannot see the defect: a second
    // traversal scrolls back to the top, remounts the button and clicks it, so
    // the archive still arrives — just after walking the whole conversation
    // twice. Counting returns to the top is what tells the two apart.
    assert.equal(returnsToTop, 1,
      'the conversation must be traversed once, not once per concern');
  } finally {
    global.document = previousDocument;
    global.getComputedStyle = previousStyle;
    global.location = previousLocation;
    if (previousFetch === undefined) delete global.fetch; else global.fetch = previousFetch;
    if (previousWindow === undefined) delete global.window; else global.window = previousWindow;
  }
});

test('a conversation with no download buttons is not walked a second time', async () => {
  // The case that separates `[] ` from `undefined`, and the only one that can:
  // when the walk finds buttons, both readings behave the same. Most
  // conversations have none, so this is the common path — and treating its
  // empty result as "nothing supplied" traverses the entire conversation again
  // to re-discover that there is nothing there.
  const turn = userTurn('user-1', 1, 'Просто поговорим');
  const container = createVirtualizedFixture([[turn]], 100);
  container.overflowY = 'auto';
  turn.parentElement = container;

  let returnsToTop = 0;
  let scrollTopValue = container.scrollTop;
  let wasAtTop = scrollTopValue <= 1;
  Object.defineProperty(container, 'scrollTop', {
    get() { return scrollTopValue; },
    set(value) {
      scrollTopValue = value;
      const atTop = value <= 1;
      if (atTop && !wasAtTop) returnsToTop += 1;
      wasAtTop = atTop;
    },
  });

  const previousDocument = global.document;
  const previousStyle = global.getComputedStyle;
  const previousLocation = global.location;
  const previousFetch = global.fetch;
  const previousWindow = global.window;

  global.document = {
    title: 'ChatGPT',
    querySelector: (sel) => (sel === '[data-turn-id]' ? turn : null),
    querySelectorAll(sel) {
      if (/behavior-btn/.test(sel)) return [];
      if (/open-file|artifact-row/.test(sel)) return [];
      if (sel === '[data-message-id]') {
        return [{ getAttribute: (n) => (n === 'data-message-id' ? 'msg-1' : null) }];
      }
      return container.querySelectorAll('[data-turn-id]');
    },
  };
  global.getComputedStyle = (node) => ({ overflowY: node.overflowY || 'visible' });
  global.location = { pathname: '/c/conv-89', href: 'https://chatgpt.com/' };
  global.window = makeWin();
  global.fetch = async (url) => {
    const target = String(url);
    if (target.indexOf('/api/auth/session') !== -1) {
      return { ok: true, status: 200, json: async () => ({ accessToken: 'tok' }) };
    }
    return { ok: true, status: 200, json: async () => ({ mapping: {} }) };
  };

  try {
    const result = await parser.getConversationMarkdown({ downloadFiles: true });
    assert.equal(result.ok, true, 'capture failed: ' + result.error);
    assert.equal(returnsToTop, 1,
      'an empty result from the walk is an answer, not a reason to walk again');
  } finally {
    global.document = previousDocument;
    global.getComputedStyle = previousStyle;
    global.location = previousLocation;
    if (previousFetch === undefined) delete global.fetch; else global.fetch = previousFetch;
    if (previousWindow === undefined) delete global.window; else global.window = previousWindow;
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

test('a title Chrome cannot put in a filename is sanitised, not passed through', () => {
  // Measured on production during a full-account export: a conversation titled
  // with a Private Use Area codepoint produced a slug that chrome.downloads
  // rejected with "Invalid filename". The run reported progress while that
  // conversation saved nothing — the same silent-loss shape as ".." before it.
  const puaPlane = 'Обзор репозитория ' + String.fromCodePoint(0x7FFFF);
  assert.equal(parser.slugifyTitle(puaPlane), 'Обзор-репозитория');

  assert.equal(parser.slugifyTitle('Chat ' + String.fromCharCode(0xE123) + ' name'), 'Chat-name');
  assert.equal(parser.slugifyTitle('Chat' + String.fromCharCode(0x07) + 'name'), 'Chat-name');
  assert.equal(parser.slugifyTitle('Chat' + String.fromCharCode(0xFFFE) + 'x'), 'Chat-x');
  // A lone surrogate is not a character and cannot survive into a filename.
  assert.equal(parser.slugifyTitle('Chat' + String.fromCharCode(0xD83D) + 'x'), 'Chat-x');
});

test('sanitising a title does not strip legitimate characters', () => {
  // The first version of the fix swept the whole D800-DFFF range and so split
  // every emoji into two spaces. Cyrillic and emoji are ordinary title content
  // and both are valid in a filename.
  assert.equal(parser.slugifyTitle('Кадры решают всё'), 'Кадры-решают-всё');
  assert.equal(parser.slugifyTitle('План 🚀 запуска'), 'План-🚀-запуска');
  assert.equal(parser.slugifyTitle('日本語のタイトル'), '日本語のタイトル');
});

/** A conversation whose turns mount in a band NARROWER than the viewport.
 *
 *  createVirtualizedFixture cannot express this: it derives the mounted page
 *  from `scrollTop / clientHeight`, so a step of 0.75 viewports always lands on
 *  the same page or the next one and can never jump over a page. Real
 *  virtualization does not work that way — it mounts a band of DOM around the
 *  scroll position, and a heavy conversation (long turns, images, code blocks)
 *  mounts fewer pixels of it. Turns are therefore placed at absolute offsets
 *  and reported through getBoundingClientRect, which is how the real DOM says
 *  how much is mounted.
 */
function createBandedFixture(bandHeight, turnSpacing, turnCount, viewportHeight) {
  const clientHeight = viewportHeight || 800;
  let container;
  const turns = [];
  for (let i = 0; i < turnCount; i += 1) {
    const turn = userTurn('t' + i, i + 1, 'turn ' + i);
    turn.top = i * turnSpacing;
    turn.getBoundingClientRect = function () {
      return {
        top: this.top - container.scrollTop,
        bottom: this.top - container.scrollTop + 80,
      };
    };
    turns.push(turn);
  }
  container = {
    scrollTop: 0,
    clientHeight: clientHeight,
    scrollHeight: turnCount * turnSpacing + clientHeight,
    scrollTo(options) { this.scrollTop = options.top; },
    querySelectorAll() {
      const low = this.scrollTop - bandHeight / 2;
      const high = this.scrollTop + bandHeight / 2;
      return turns.filter((turn) => turn.top >= low && turn.top <= high);
    },
  };
  return container;
}

test('THE INVARIANT: a turn is never stepped over because the mounted band is narrow', async () => {
  // Reproduced before it was fixed: with a 400px band in an 800px viewport the
  // scan captured 30 of 60 turns — every second one — and returned them as a
  // COMPLETE export with no partial notice. The scroll step was a fixed 0.75 of
  // the viewport, so it advanced past turns the virtualizer had never mounted.
  //
  // The sidebar walk already had this right, and says why in its own comment:
  // "never step further than the band of rows currently mounted (a virtualizer
  // may mount less than a viewport, and the excess is stepped over unseen)".
  // The conversation scan simply did not carry the same rule.
  //
  // Every band here is physically possible: at least as tall as the gap between
  // two turns, so no band leaves a visible hole in the viewport.
  const geometries = [
    { band: 1600, spacing: 300 },
    { band: 800, spacing: 300 },
    { band: 400, spacing: 300 },
    { band: 300, spacing: 300 },
    { band: 200, spacing: 150 },
    { band: 900, spacing: 800 },
  ];

  for (const geometry of geometries) {
    const meta = {};
    const container = createBandedFixture(geometry.band, geometry.spacing, 40);
    const turns = await parser.scanTurns(container, {
      readSections: (target) => target.querySelectorAll('[data-turn-id]'),
      settle: async () => {},
      stablePasses: 2,
      scanMeta: meta,
    });
    const captured = new Set(turns.map((turn) => turn.turnId));
    const missing = [];
    for (let i = 0; i < 40; i += 1) if (!captured.has('t' + i)) missing.push('t' + i);
    assert.deepEqual(
      missing, [],
      `band ${geometry.band}px / spacing ${geometry.spacing}px lost ${missing.length} turns`,
    );
    assert.equal(meta.partial, undefined, `band ${geometry.band}px reported a partial scan`);
  }
});

test('a narrow band is measured from the DOM, not assumed from the viewport', async () => {
  // Positive control for the test above. It must be able to FAIL: if the
  // fixture's geometry were unreachable, or the band were always wide enough,
  // the invariant would pass without the fix and prove nothing. Here the band
  // is deliberately narrower than the viewport, and the assertion is that the
  // scan's own step never exceeds what was mounted.
  const container = createBandedFixture(400, 300, 12);
  const tops = [];
  const originalScrollTo = container.scrollTo;
  container.scrollTo = function (options) {
    tops.push(options.top);
    originalScrollTo.call(this, options);
  };

  await parser.scanTurns(container, {
    readSections: (target) => target.querySelectorAll('[data-turn-id]'),
    settle: async () => {},
    stablePasses: 2,
  });

  // The mounted band is 400px tall at most, so no forward step may advance by a
  // full viewport (800 * 0.75 = 600). Proves the cap is real rather than the
  // turns merely happening to be caught.
  let widest = 0;
  for (let i = 1; i < tops.length; i += 1) {
    const delta = tops[i] - tops[i - 1];
    if (delta > widest) widest = delta;
  }
  assert.ok(widest > 0, 'the scan must actually move down the document');
  assert.ok(widest <= 400, `a step of ${widest}px exceeded the ${400}px mounted band`);
});

test('a scan that reached the bottom blind reports a gap, not a complete export', async () => {
  // Reaching the bottom is not a coverage proof. With a mounted band narrower
  // than the gap between two turns, only the first turn can ever mount: the scan
  // then crawls the remaining 11 860px of the document with nothing in the DOM
  // and used to return 1 turn of 40 as a finished export, with no notice.
  //
  // This geometry is not one ChatGPT is known to produce — a virtualizer that
  // mounted less than the gap between turns would leave visible blank space. It
  // is tested because "complete" must be a claim the code can support, and a
  // silent hole is the one failure a re-run cannot repair.
  const meta = {};
  const container = createBandedFixture(200, 300, 40);
  const turns = await parser.scanTurns(container, {
    readSections: (target) => target.querySelectorAll('[data-turn-id]'),
    settle: async () => {},
    stablePasses: 2,
    scanMeta: meta,
  });

  assert.ok(turns.length < 40, 'the fixture must genuinely lose turns for this to mean anything');
  assert.equal(meta.partial, true);
  assert.equal(meta.reason, 'coverage gap');
});

test('a complete scan is never reported as a coverage gap', async () => {
  // The counter-assertion, and the one that took two attempts to get right.
  // A first version credited an empty band as a viewport of coverage, and a
  // second judged the stretch past the final turn: both reported "partial
  // export" on exports that had captured every single turn. A false partial is
  // a worse user experience than no notice at all, because it tells the user
  // their complete file is untrustworthy.
  const geometries = [
    { band: 1600, spacing: 300 },
    { band: 800, spacing: 300 },
    { band: 400, spacing: 300 },
    { band: 300, spacing: 300 },
    { band: 200, spacing: 150 },
    { band: 900, spacing: 800 },
  ];

  for (const geometry of geometries) {
    const meta = {};
    const container = createBandedFixture(geometry.band, geometry.spacing, 40);
    const turns = await parser.scanTurns(container, {
      readSections: (target) => target.querySelectorAll('[data-turn-id]'),
      settle: async () => {},
      stablePasses: 2,
      scanMeta: meta,
    });
    assert.equal(turns.length, 40, `band ${geometry.band}px did not capture every turn`);
    assert.notEqual(
      meta.reason, 'coverage gap',
      `band ${geometry.band}px / spacing ${geometry.spacing}px falsely reported a coverage gap`,
    );
  }
});

test('coverage gaps are measured between read positions, not guessed', () => {
  assert.equal(typeof parser.largestCoverageGap, 'function');
  // [scrollTop, heightOfBandMountedThere]
  // Contiguous coverage: each band reaches the next position.
  assert.equal(parser.largestCoverageGap([[0, 100], [100, 100], [200, 100]], 800).width, 0);
  // A hole between two productive positions is the gap that matters.
  assert.equal(parser.largestCoverageGap([[0, 100], [500, 100]], 800).width, 400);
  // The stretch past the LAST turn is bottom padding, not a hole: the scan
  // always runs a little beyond the final turn.
  assert.equal(parser.largestCoverageGap([[0, 100], [100, 100], [900, 0]], 800).width, 0);
  // Unless it is beyond a whole viewport of blind travel.
  assert.ok(parser.largestCoverageGap([[0, 100], [5000, 0]], 800).width > 800);
  // Nothing mounted anywhere: no claim either way, and no false gap.
  assert.equal(parser.largestCoverageGap([[0, 0], [800, 0]], 800).width, 0);
  assert.equal(parser.largestCoverageGap([], 800).width, 0);
  // Sub-pixel seams from a zoomed or high-DPI viewport are not missing turns.
  assert.equal(parser.largestCoverageGap([[0, 100], [100.5, 100]], 800).width, 0);
});

test('a scan that stopped at a bottom which later grew is a coverage gap', () => {
  // The defect this covers, measured on a real export: an 8-turn conversation
  // saved 4 turns and carried NO partial notice. While the scan sat near the
  // top, the virtualizer had not mounted the lower turns, so scrollHeight was
  // short; the scan reached the bottom of that short height, went stable and
  // stopped — at the last turn it read.
  //
  // Both older checks are structurally blind to it. There is no later band to
  // leave a hole against, and the travelled-but-unseen tail is
  // `traversedTo - seenTo` = 2400 - 3200 = -800px: negative, so `blind >
  // viewportHeight` can never fire. The gap is only visible by comparing the
  // furthest position visited against the document's FINAL height.
  const readTop = [[0, 800], [800, 800], [1600, 800], [2400, 800]];
  const gap = parser.largestCoverageGap(readTop, 800, 6400);
  assert.ok(
    gap.width > 0,
    'half the conversation below the scan must be reported, not presented as complete',
  );
  assert.equal(gap.at, 2400, 'the gap starts at the furthest position visited');

  // Positive control for the assertion above: the SAME bands and viewport, with
  // the document ending where the scan stopped, must stay silent. Without this
  // the test would also pass if the new branch fired unconditionally.
  assert.equal(
    parser.largestCoverageGap(readTop, 800, 3200).width, 0,
    'a scan that truly reached the bottom is complete',
  );
  // A false "partial export" on a good file is a real cost, so the ordinary
  // overshoot past the final turn stays under the one-viewport threshold.
  assert.equal(
    parser.largestCoverageGap(readTop, 800, 3500).width, 0,
    '300px of unreached document is ordinary, not a hole',
  );
  // Omitting documentHeight leaves every existing caller's behaviour unchanged.
  assert.equal(parser.largestCoverageGap(readTop, 800).width, 0);
});

test('conversation metadata is read for a skip decision without scrolling', async () => {
  // Measured on a real 1146-message thread: walking it to find out whether it
  // grew took 282 seconds and did not finish. The same question is answered by
  // one request to the endpoint the page itself uses, which returns the
  // conversation's update_time, the id of its newest message and its message
  // count. This is what makes "skip unchanged conversations" cheap.
  assert.equal(typeof parser.fetchConversationMetadata, 'function');

  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url === '/api/auth/session') {
      return { ok: true, json: async () => ({ accessToken: 'token-abc' }) };
    }
    return {
      ok: true,
      json: async () => ({
        title: 'Кадры решают всё',
        update_time: 1787047506.810519,
        create_time: 1786725126.086031,
        current_node: 'node-newest',
        mapping: {
          a: { message: { id: 'a' } },
          b: { message: { id: 'b' } },
          c: { message: null },
        },
      }),
    };
  };

  const meta = await parser.fetchConversationMetadata('conv-1', { fetchImpl: fakeFetch });
  assert.equal(meta.updateTime, 1787047506.810519);
  assert.equal(meta.currentNode, 'node-newest');
  // Nodes WITHOUT a message body are not messages. Counting raw mapping keys
  // would compare a number against a differently-derived stored one, and the
  // measured thread showed the two differ (1147 nodes, 1146 messages).
  assert.equal(meta.messageCount, 2);
  assert.ok(
    calls.some((url) => url.indexOf('conv-1') !== -1),
    'the conversation id must reach the request',
  );
  // The mapping itself must not be carried out of here: it was 4 661 057 bytes
  // for the measured thread and has no place in a skip decision.
  assert.equal(meta.mapping, undefined);
});

test('unreadable metadata returns null rather than a shape that reads as unchanged', async () => {
  // The distinction the whole skip decision rests on. A conversation whose
  // metadata could not be read is NOT an unchanged conversation, and returning
  // zeros or an empty object here would make it look like one.
  const noToken = await parser.fetchConversationMetadata('conv-1', {
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
  });
  assert.equal(noToken, null, 'no session token means no answer');

  const httpError = await parser.fetchConversationMetadata('conv-1', {
    fetchImpl: async (url) => (url === '/api/auth/session'
      ? { ok: true, json: async () => ({ accessToken: 't' }) }
      : { ok: false, status: 404 }),
  });
  assert.equal(httpError, null, 'an HTTP error means no answer');

  const threw = await parser.fetchConversationMetadata('conv-1', {
    fetchImpl: async () => { throw new Error('offline'); },
  });
  assert.equal(threw, null, 'a network failure means no answer');

  const noId = await parser.fetchConversationMetadata('', {
    fetchImpl: async () => ({ ok: true, json: async () => ({ accessToken: 't' }) }),
  });
  assert.equal(noId, null, 'no conversation id means no answer');
});

test('a sandbox: link in the message body is resolved and downloaded', async () => {
  // The defect that cost four exports in a row. Measured from the live
  // conversation the operator supplied: ChatGPT offers generated files as
  // ORDINARY MARKDOWN LINKS inside the answer, not as artefact-panel rows —
  //
  //   [Скачать Canon Consilium Prompt Bundle v1](sandbox:/mnt/data/canon-consilium-prompt-bundle-v1.zip)
  //
  // `nodeToMarkdown` turned each one into a prose note ("> **Code Interpreter
  // file:** `sandbox:/mnt/data/…`"), and popup.js's downloader only matches
  // `[label](http…)`. Both the note and the original link yield ZERO matches
  // for that pattern, so the file was named in the export and never fetched.
  //
  // The panel path could not save it either: a `.zip` is not opened by the
  // built-in viewer, so it gets no panel row at all.
  const conversationMd = [
    'Готова версия 0.3.',
    '',
    '> **Code Interpreter file:** `sandbox:/mnt/data/Canon_Arcana_TZ_v0.3.md` (Скачать ТЗ)',
    '',
    '> **Code Interpreter file:** `sandbox:/mnt/data/canon-consilium-prompt-bundle-v1.zip` (Скачать бандл)',
    '',
    '> **Code Interpreter file:** `sandbox:/mnt/data/outputs/Canon_Arcana_v0.2_to_v0.3.diff` (diff)',
  ].join('\n');

  const fetchImpl = stubFetch([
    ['/interpreter/download', (url) => {
      const path = decodeURIComponent((url.match(/sandbox_path=([^&]+)/) || [])[1] || '');
      const name = path.split('/').pop();
      return {
        ok: true,
        status: 200,
        json: async () => ({
          download_url: 'https://files.oaiusercontent.com/' + name,
          file_name: name,
        }),
      };
    }],
  ]);

  const out = await parser.appendPanelArtifacts(conversationMd, {
    doc: { querySelectorAll: () => [] },   // no artefact panel at all
    conversationId: 'conv-1',
    artifacts: [],                          // the API reports nothing
    messageIds: ['msg-1'],
    fetchImpl,
    token: 'tok',
    panelWaitMs: 0,
  });

  assert.ok(
    out.indexOf('https://files.oaiusercontent.com/canon-consilium-prompt-bundle-v1.zip') !== -1,
    'the zip offered as a sandbox: link must reach the markdown as a fetchable URL',
  );
  assert.ok(
    out.indexOf('https://files.oaiusercontent.com/Canon_Arcana_TZ_v0.3.md') !== -1,
    'every sandbox: link in the body counts, not just the last one',
  );
  // A subdirectory path must survive: '/mnt/data/' + filename would have
  // produced '/mnt/data/Canon_Arcana_v0.2_to_v0.3.diff' and resolved the wrong
  // file, or nothing.
  const diffCall = fetchImpl.calls.find((c) => c.url.indexOf('.diff') !== -1);
  assert.ok(diffCall, 'the subdirectory file must be requested');
  assert.ok(
    decodeURIComponent(diffCall.url).indexOf('/mnt/data/outputs/') !== -1,
    'the real sandbox path is read from the link, never rebuilt from the file name',
  );
});

/* ------------------------------------------------------------------------- *
 * Files offered only as a button with a click handler.
 *
 * Measured on a production conversation (2026-09-10): the archive the user kept
 * losing was offered as
 *   <button class="behavior-btn">Скачать готовый Canon Consilium Prompt Bundle v1</button>
 * with NO href, NO sandbox: link, NO panel row and NO data-* attributes, and a
 * label that is prose rather than a file name. Every earlier source measured
 * zero on that page, so these fixtures reproduce exactly that shape.
 * ------------------------------------------------------------------------- */

/** A button whose handler signs a URL and downloads it the way the page does. */
function downloadButton(label, options) {
  const opts = options || {};
  const node = {
    tagName: 'BUTTON',
    textContent: label,
    clicked: 0,
    getAttribute: (n) => (n === 'class' ? 'behavior-btn' : null),
    closest: () => (opts.insideAnchor ? { tagName: 'A' } : null),
    scrollIntoView() {},
    click() {
      this.clicked += 1;
      if (opts.onClick) opts.onClick();
    },
  };
  return node;
}

/** Minimal window shim carrying the three routes the interceptor patches. */
function makeWin() {
  const anchorClicks = [];
  const win = {
    HTMLAnchorElement: { prototype: { click() { anchorClicks.push(this); } } },
    open() { return 'real-open'; },
    URL: { createObjectURL: () => 'blob:real' },
    anchorClicks,
  };
  win.originalAnchorClick = win.HTMLAnchorElement.prototype.click;
  win.originalOpen = win.open;
  win.originalCreateObjectURL = win.URL.createObjectURL;
  return win;
}

function docWithButtons(buttons) {
  return {
    querySelectorAll(sel) {
      return /behavior-btn/.test(sel) ? buttons : [];
    },
  };
}

test('buttons found on the scan are used instead of a second traversal', async () => {
  // MEASURED on a live thread: the landing position held 2 behavior-btn nodes,
  // both editing suggestions ("Make the opening more concrete"), neither a
  // download. The old guard ran the button traversal only when it found ZERO
  // buttons, so two-that-were-wrong stopped it, and all 5 real download buttons
  // — the .zip and .diff among them — were never seen.
  const win = makeWin();
  const offScreen = downloadButton('Скачать готовый Canon Consilium Prompt Bundle v1', {
    onClick() {
      win.HTMLAnchorElement.prototype.click.call({
        getAttribute: () => 'https://chatgpt.com/backend-api/estuary/content' +
          '?id=file_1&fn=canon-consilium-prompt-bundle-v1.zip&SIGNED&ts=1',
        hasAttribute: (n) => n === 'download',
      });
    },
  });
  // The page as it stands when the scan is over: only the unrelated suggestions
  // are mounted. A traversal-based search would see no download button here.
  const doc = docWithButtons([
    downloadButton('Make the opening more concrete'),
    downloadButton('Clarify what Canon Arcana stores'),
  ]);
  let traversed = false;

  const captured = await parser.collectButtonDownloads({
    doc,
    win,
    buttons: [{ button: offScreen, label: 'Скачать готовый Canon Consilium Prompt Bundle v1', archive: false }],
    scroller: { get scrollTop() { traversed = true; return 0; }, set scrollTop(_v) { traversed = true; } },
    sleep: async () => {},
    clickSettleMs: 10,
    clickPollMs: 5,
  });

  assert.equal(offScreen.clicked, 1, 'the button the walk found must be clicked');
  assert.equal(captured.length, 1);
  assert.equal(traversed, false, 'a second traversal must not run when the walk supplied buttons');
});

test('an empty button list from the scan is an answer, not a missing argument', async () => {
  // `opts.buttons || …` treats [] as absent and re-traverses the whole
  // conversation to reach the same result. The walk already looked.
  const doc = docWithButtons([downloadButton('Скачать архив late.zip')]);
  let traversed = false;

  const captured = await parser.collectButtonDownloads({
    doc,
    win: makeWin(),
    buttons: [],
    scroller: { get scrollTop() { traversed = true; return 0; }, set scrollTop(_v) { traversed = true; } },
    sleep: async () => {},
    clickSettleMs: 10,
    clickPollMs: 5,
  });

  assert.deepEqual(captured, []);
  assert.equal(traversed, false);
});

test('a scan-collected button whose file the panel resolved is not clicked', async () => {
  // The exclusion moved later — collection happens during the walk, the panel's
  // names are only complete after it — but it must still happen, or clicking a
  // .md the panel already listed opens the Library viewer over the panel. That
  // regression cut an export from four files to one.
  const kept = { button: downloadButton('Скачать архив bundle.zip'), label: 'Скачать архив bundle.zip', archive: true };
  // The match is a substring of the extension-stripped panel name, so it fires
  // when the label quotes the file name. It does NOT normalise separators: a
  // label saying "Скачать полное ТЗ Canon Arcana v0.3" does not match the panel
  // row "Canon_Arcana_Consilium_Context_Selection_TZ_v0.3.md", and never has —
  // underscores against spaces, plus extra words in the middle. That button is
  // still clicked. The cost is one viewer dismissal, which the click path
  // already handles, so it is recorded here rather than tightened blind.
  const dropped = {
    button: downloadButton('Скачать Canon_Arcana_v0.3_SHA256SUMS'),
    label: 'Скачать Canon_Arcana_v0.3_SHA256SUMS',
    archive: false,
  };

  const out = parser.filterButtonsAgainstPanel([dropped, kept], [
    'Canon_Arcana_v0.3_SHA256SUMS.txt',
  ]);

  assert.deepEqual(out.map((e) => e.label), ['Скачать архив bundle.zip']);
  // Positive control: without the panel name the same button survives, so the
  // assertion above is testing the exclusion and not a broken fixture.
  assert.equal(parser.filterButtonsAgainstPanel([dropped, kept], []).length, 2);
});

test('scan-collected buttons keep archives first', async () => {
  // Ordering is not decoration: a viewer opening over the panel costs the files
  // behind it, so the ones obtainable ONLY by clicking go first.
  const out = parser.filterButtonsAgainstPanel([
    { button: downloadButton('Скачать отчёт'), label: 'Скачать отчёт', archive: false },
    { button: downloadButton('Скачать архив'), label: 'Скачать архив', archive: true },
  ], []);

  assert.deepEqual(out.map((e) => e.archive), [true, false]);
});

test('a file offered only as a button is clicked and its signed URL captured', async () => {
  // The exact failure the user hit four exports in a row: the archive exists,
  // the page will hand over a URL, but only if something clicks the button.
  const win = makeWin();
  const button = downloadButton('Скачать готовый Canon Consilium Prompt Bundle v1.zip', {
    onClick() {
      // What ChatGPT's handler does: build an <a download> and click it.
      const anchor = {
        getAttribute: () => 'https://chatgpt.com/backend-api/estuary/content' +
          '?id=file_000&fn=canon-consilium-prompt-bundle-v1.zip&SIGNED&ts=1',
        hasAttribute: (n) => n === 'download',
      };
      win.HTMLAnchorElement.prototype.click.call(anchor);
    },
  });

  const files = await parser.collectButtonDownloads({
    doc: docWithButtons([button]),
    win,
    sleep: async () => {},
  });

  assert.equal(button.clicked, 1, 'the button must actually be clicked');
  assert.equal(files.length, 1, 'the handler produced exactly one download');
  assert.equal(files[0].name, 'canon-consilium-prompt-bundle-v1.zip',
    'the real name comes from fn=, never from the prose label');
  assert.ok(files[0].url.indexOf('SIGNED') !== -1, 'the signed URL must be kept intact');
});

test('the intercepted click does not reach the page, and the routes are restored', async () => {
  // Two failures in one: an unintercepted click downloads through the PAGE,
  // which passes no filename and drops the file in the Downloads root; and a
  // patch left behind would break downloading for the user after the export.
  const win = makeWin();
  const button = downloadButton('Скачать архив bundle.zip', {
    onClick() {
      const anchor = {
        getAttribute: () => 'https://chatgpt.com/backend-api/estuary/content?fn=a.zip',
        hasAttribute: () => true,
      };
      win.HTMLAnchorElement.prototype.click.call(anchor);
    },
  });

  await parser.collectButtonDownloads({
    doc: docWithButtons([button]),
    win,
    sleep: async () => {},
  });

  assert.equal(win.anchorClicks.length, 0,
    'the real anchor click must be suppressed, or the page downloads it itself');
  assert.equal(win.HTMLAnchorElement.prototype.click, win.originalAnchorClick,
    'anchor click must be restored');
  assert.equal(win.open, win.originalOpen, 'window.open must be restored');
  assert.equal(win.URL.createObjectURL, win.originalCreateObjectURL,
    'createObjectURL must be restored');
});

test('routes are restored even when a handler throws', async () => {
  // A positive control for the finally block: without it one bad button leaves
  // the page permanently unable to download anything.
  const win = makeWin();
  const button = downloadButton('Скачать bundle.zip', { onClick() { throw new Error('handler blew up'); } });

  await parser.collectButtonDownloads({
    doc: docWithButtons([button]),
    win,
    sleep: async () => {},
  });

  assert.equal(win.HTMLAnchorElement.prototype.click, win.originalAnchorClick,
    'a throwing handler must not leave the page patched');
  assert.equal(win.open, win.originalOpen, 'window.open must be restored after a throw');
});

test('only download buttons are clicked, never viewer buttons', async () => {
  // The same conversation carried "Открыть полное техническое задание" and
  // "Посмотреть полный diff" on identical markup. Clicking those opens a viewer
  // and navigates the page out from under a running export.
  const buttons = [
    downloadButton('Скачать полное ТЗ Canon Arcana v0.3.zip'),
    downloadButton('Открыть полное техническое задание'),
    downloadButton('Посмотреть полный diff v0.2 → v0.3'),
    downloadButton('Контрольные суммы SHA-256'),
    downloadButton('Download the bundle.diff'),
  ];
  const found = parser.downloadButtonsInPage(docWithButtons(buttons));
  const labels = found.map((f) => f.label);

  assert.deepEqual(labels, ['Скачать полное ТЗ Canon Arcana v0.3.zip', 'Download the bundle.diff'],
    'only labels that offer a download may be clicked');
});

test('a button already wrapped in a link is left to the attachment path', async () => {
  // That one has an href, which the existing chip path reads without clicking.
  const inside = downloadButton('Скачать файл archive.zip', { insideAnchor: true });
  assert.deepEqual(parser.downloadButtonsInPage(docWithButtons([inside])), []);
});

test('a blob download keeps its bytes, since a blob URL is unusable elsewhere', async () => {
  // A blob: URL minted in the page cannot be fetched from the popup, so the
  // object itself has to travel with the entry.
  const win = makeWin();
  const blob = { size: 12, type: 'application/zip' };
  const button = downloadButton('Скачать отчёт report.zip', {
    onClick() { win.URL.createObjectURL(blob); },
  });

  const files = await parser.collectButtonDownloads({
    doc: docWithButtons([button]),
    win,
    sleep: async () => {},
  });

  assert.equal(files.length, 1);
  assert.equal(files[0].blob, blob, 'the blob must be carried, not just its URL');
});

test('button downloads reach the markdown as links the popup can fetch', async () => {
  // The end-to-end contract: parseArtifactRefs reads the finished markdown, so
  // a file that never appears there is never downloaded into the folder.
  const out = await parser.appendPanelArtifacts('body', {
    doc: { querySelectorAll: () => [] },
    conversationId: 'conv-1',
    artifacts: [],
    fetchImpl: stubFetch([]),
    token: 'tok',
    buttonFiles: [{
      name: 'canon-consilium-prompt-bundle-v1.zip',
      url: 'https://chatgpt.com/backend-api/estuary/content?id=file_0&fn=canon-consilium-prompt-bundle-v1.zip',
      fromButton: true,
    }],
  });

  assert.ok(out.indexOf('## Files') !== -1, 'a Files section must be added');
  assert.ok(
    out.indexOf('[canon-consilium-prompt-bundle-v1.zip](https://chatgpt.com/backend-api/estuary/') !== -1,
    'the archive must be a markdown link, which is what the downloader parses',
  );
});

test('a file already resolved by the panel is not clicked a second time', async () => {
  // Clicking costs a network round-trip and a page side effect; the panel and
  // the body reach the same file more cheaply.
  const doc = {
    querySelectorAll(sel) {
      return /open-file|artifact-row/.test(sel)
        ? [{ getAttribute: (n) => (n === 'aria-label' ? 'report.pdf' : null) }]
        : [];
    },
  };
  const out = await parser.appendPanelArtifacts('body', {
    doc,
    conversationId: 'conv-1',
    artifacts: [{ kind: 'asset', messageId: 'm1' }],
    fetchImpl: stubFetch([
      ['/interpreter/download', jsonOk({
        download_url: 'https://chatgpt.com/backend-api/estuary/content?id=file_r&fn=report.pdf',
        file_name: 'report.pdf',
      })],
    ]),
    token: 'tok',
    buttonFiles: [{ name: 'report.pdf', url: 'https://example.com/duplicate.pdf' }],
  });

  // Counted as LINKS, not as occurrences of the name: the resolved URL carries
  // `fn=report.pdf`, so the name legitimately appears twice inside one link.
  assert.equal(out.split('[report.pdf](').length - 1, 1,
    'the file must be linked exactly once');
  assert.ok(out.indexOf('duplicate.pdf') === -1, 'the cheaper source wins');
});

test('clicking is opt-out, so a plain markdown copy never touches the page', async () => {
  // Clicking is a side effect. "Copy as Markdown" is a pure DOM read and must
  // stay one; a stray click would download files the user did not ask for.
  let clicked = false;
  const button = downloadButton('Скачать архив bundle.zip', { onClick() { clicked = true; } });
  const out = await parser.appendPanelArtifacts('body', {
    doc: docWithButtons([button]),
    win: makeWin(),
    conversationId: 'conv-1',
    artifacts: [],
    fetchImpl: stubFetch([]),
    token: 'tok',
    clickDownloads: false,
  });

  assert.equal(clicked, false, 'no button may be clicked when clicking is off');
  assert.equal(out, 'body', 'the markdown must come back untouched');
});

test('the prose label is used only when the URL carries no name', async () => {
  assert.equal(
    parser.downloadNameFromUrl(
      'https://chatgpt.com/backend-api/estuary/content?id=file_0&fn=bundle.zip', 'Скачать всё'),
    'bundle.zip', 'fn= wins');
  assert.equal(
    parser.downloadNameFromUrl('https://example.com/files/report.pdf', 'Скачать'),
    'report.pdf', 'a path segment that looks like a file name is used');
  assert.equal(
    parser.downloadNameFromUrl('https://chatgpt.com/backend-api/estuary/content', 'Скачать всё'),
    'Скачать всё', '/content is a route, not a file name');
  assert.equal(
    parser.downloadNameFromUrl(null, 'a/b:c'), 'a-b-c',
    'a label used as a filename must not carry path separators');
});

test('the shipped capture path reaches a file offered only as a button', async () => {
  // The wiring, not the helper. A mutation deleting the button collection from
  // appendPanelArtifacts leaves every unit test above green, because they call
  // the helper directly. This drives getConversationMarkdown — the function the
  // popup actually calls — against a page shaped like the measured one: a
  // conversation whose archive has no link, no panel row and no file id.
  const turn = userTurn('user-1', 1, 'Собери архив');
  const container = createVirtualizedFixture([[turn]], 0);
  container.overflowY = 'auto';
  turn.parentElement = container;

  let clicked = 0;
  const archiveButton = {
    tagName: 'BUTTON',
    textContent: 'Скачать готовый Canon Consilium Prompt Bundle v1.zip',
    getAttribute: () => null,
    closest: () => null,
    scrollIntoView() {},
    click() {
      clicked += 1;
      // ChatGPT's handler: sign a URL, then click a hidden <a download>.
      const anchor = {
        getAttribute: () => 'https://chatgpt.com/backend-api/estuary/content' +
          '?id=file_000&fn=canon-consilium-prompt-bundle-v1.zip',
        hasAttribute: (n) => n === 'download',
      };
      global.window.HTMLAnchorElement.prototype.click.call(anchor);
    },
  };

  const previousDocument = global.document;
  const previousWindow = global.window;
  const previousStyle = global.getComputedStyle;
  const previousLocation = global.location;
  const previousFetch = global.fetch;

  global.document = {
    title: 'ChatGPT',
    querySelector: (sel) => (sel === '[data-turn-id]' ? turn : null),
    querySelectorAll(sel) {
      if (/behavior-btn/.test(sel)) return [archiveButton];
      if (/open-file|artifact-row/.test(sel)) return [];   // a .zip gets no panel row
      if (sel === '[data-message-id]') return [];
      return container.querySelectorAll('[data-turn-id]');
    },
  };
  global.window = {
    HTMLAnchorElement: { prototype: { click() { throw new Error('the page must not download it'); } } },
    open() { throw new Error('the page must not open it'); },
    URL: { createObjectURL: () => 'blob:x' },
  };
  global.getComputedStyle = (node) => ({ overflowY: node.overflowY || 'visible' });
  global.location = { pathname: '/c/conv-88', href: 'https://chatgpt.com/' };
  global.fetch = async (url) => {
    const target = String(url);
    if (target.indexOf('/api/auth/session') !== -1) {
      return { ok: true, status: 200, json: async () => ({ accessToken: 'tok' }) };
    }
    if (target.indexOf('/backend-api/conversation/conv-88') !== -1) {
      return { ok: true, status: 200, json: async () => ({ mapping: {} }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  try {
    const result = await parser.getConversationMarkdown({ downloadFiles: true });
    assert.equal(result.ok, true, 'capture failed: ' + result.error);
    assert.equal(clicked, 1, 'the shipped path must click the download button');
    assert.ok(
      result.md.indexOf('[canon-consilium-prompt-bundle-v1.zip](https://chatgpt.com/backend-api/estuary/') !== -1,
      'the archive must reach the markdown as a link the popup can fetch',
    );
  } finally {
    global.document = previousDocument;
    if (previousWindow === undefined) delete global.window; else global.window = previousWindow;
    global.getComputedStyle = previousStyle;
    global.location = previousLocation;
    if (previousFetch === undefined) delete global.fetch; else global.fetch = previousFetch;
  }
});

test('a plain copy clicks nothing in the shipped path either', async () => {
  // Positive control for the opt-in: the same fixture, downloadFiles off. If the
  // click were unconditional, "Copy as Markdown" would silently download files.
  const turn = userTurn('user-1', 1, 'Просто скопируй');
  const container = createVirtualizedFixture([[turn]], 0);
  container.overflowY = 'auto';
  turn.parentElement = container;

  let clicked = 0;
  const button = {
    tagName: 'BUTTON',
    textContent: 'Скачать архив bundle.zip',
    getAttribute: () => null,
    closest: () => null,
    scrollIntoView() {},
    click() { clicked += 1; },
  };

  const previousDocument = global.document;
  const previousStyle = global.getComputedStyle;
  const previousLocation = global.location;

  global.document = {
    title: 'ChatGPT',
    querySelector: (sel) => (sel === '[data-turn-id]' ? turn : null),
    querySelectorAll(sel) {
      if (/behavior-btn/.test(sel)) return [button];
      return container.querySelectorAll('[data-turn-id]');
    },
  };
  global.getComputedStyle = (node) => ({ overflowY: node.overflowY || 'visible' });
  global.location = { pathname: '/c/conv-99', href: 'https://chatgpt.com/' };

  try {
    const result = await parser.getConversationMarkdown({});
    assert.equal(result.ok, true, 'capture failed: ' + result.error);
    assert.equal(clicked, 0, 'a plain copy must not click anything');
  } finally {
    global.document = previousDocument;
    global.getComputedStyle = previousStyle;
    global.location = previousLocation;
  }
});

/* ------------------------------------------------------------------------- *
 * The regression measured on 2026-09-10, after clicking on the label alone.
 *
 * A "Скачать …" button for a .md OPENED the Library viewer instead of
 * downloading. The viewer slid over the artefact panel, the panel read went
 * from 4 rows to 1, and the export produced ONE file where the previous run
 * produced four — worse than before the feature existed. The label does not
 * decide the action; the format does, and a file the panel already resolved
 * must never be clicked at all.
 * ------------------------------------------------------------------------- */

test('archives are clicked before anything else', () => {
  // MEASURED (probe 7): the markup cannot separate a download button from a
  // viewer button — same class, same <svg>, same data-*. Only the label
  // differs, and it lies both ways: the archive's label names no format while a
  // VIEWER button says "Посмотреть полный diff". So format cannot gate the
  // click; it only orders it. Files obtainable ONLY by clicking go first.
  const buttons = [
    downloadButton('Скачать Canon_Arcana_Control_Arcana_TZ_v0.1.md'),
    downloadButton('Скачать заметку notes.txt'),
    downloadButton('Скачать архив bundle.zip'),
  ];
  const found = parser.downloadButtonsInPage(docWithButtons(buttons), []);
  assert.equal(found[0].label, 'Скачать архив bundle.zip',
    'the archive must be clicked first, before a viewer can interfere');
  assert.equal(found.length, 3, 'the others are still clicked, just later');
});

test('a file the panel already resolved is never clicked', () => {
  // The panel supplies it without a click, and clicking is exactly what opened
  // the viewer over the panel. Matched on the stem, because the button label
  // carries no extension.
  const buttons = [
    downloadButton('Скачать полное ТЗ Canon_Arcana_Consilium_Context_Selection_TZ_v0.3.zip'),
    downloadButton('Скачать canon-consilium-prompt-bundle-v1.zip'),
  ];
  const panelNames = ['Canon_Arcana_Consilium_Context_Selection_TZ_v0.3.md'];
  const labels = parser.downloadButtonsInPage(docWithButtons(buttons), panelNames).map((b) => b.label);
  assert.deepEqual(labels, ['Скачать canon-consilium-prompt-bundle-v1.zip'],
    'the panel-resolved file must be left alone; only the archive is clicked');
});

test('a label naming no format is still clicked — that is the archive', () => {
  // The user's actual archive: "Скачать готовый Canon Consilium Prompt Bundle
  // v1" carries no extension and no format word. An earlier version skipped it
  // for that reason and the file never arrived. It is safe to click now because
  // a click that opens a viewer is dismissed, measured working in probe 7.
  const buttons = [downloadButton('Скачать готовый Canon Consilium Prompt Bundle v1')];
  const labels = parser.downloadButtonsInPage(docWithButtons(buttons), []).map((b) => b.label);
  assert.deepEqual(labels, ['Скачать готовый Canon Consilium Prompt Bundle v1'],
    'the file that can ONLY be had by clicking must not be skipped');
});

test('a click that opened a viewer is dismissed, not left covering the panel', async () => {
  // Positive control for the recovery path: without it one viewer costs every
  // artefact behind it for the rest of the run.
  let closed = 0;
  const doc = {
    body: { dispatchEvent() { return true; } },
    querySelectorAll(sel) {
      if (/behavior-btn/.test(sel)) {
        return [downloadButton('Скачать архив bundle.zip', { onClick() { /* opens a viewer */ } })];
      }
      if (/aria-label|close/.test(sel)) {
        return [{
          getAttribute: (n) => (n === 'aria-label' ? 'Закрыть' : null),
          click() { closed += 1; },
        }];
      }
      return [];
    },
  };

  await parser.collectButtonDownloads({ doc, win: makeWin(), sleep: async () => {} });
  assert.equal(closed, 1, 'the viewer must be closed when the click produced no URL');
});

test('a successful download does not trigger the viewer dismissal', async () => {
  // The dismissal presses Escape as a fallback, which would close things the
  // user is looking at. It must fire only when a click produced nothing.
  let closed = 0;
  const win = makeWin();
  const doc = {
    body: { dispatchEvent() { closed += 1; return true; } },
    querySelectorAll(sel) {
      if (/behavior-btn/.test(sel)) {
        return [downloadButton('Скачать архив bundle.zip', {
          onClick() {
            const anchor = {
              getAttribute: () => 'https://chatgpt.com/backend-api/estuary/content?fn=bundle.zip',
              hasAttribute: () => true,
            };
            win.HTMLAnchorElement.prototype.click.call(anchor);
          },
        })];
      }
      return [];
    },
  };

  const files = await parser.collectButtonDownloads({ doc, win, sleep: async () => {} });
  assert.equal(files.length, 1, 'the download must be captured');
  assert.equal(closed, 0, 'nothing may be dismissed when the click worked');
});

test('panel files reaching the export are not reduced by the button pass', async () => {
  // The end-to-end shape of the regression: four panel files in, four out. The
  // measured failure produced one.
  const panelRows = [
    'Canon_Arcana_Control_Arcana_TZ_v0.1.md',
    'Canon_Arcana_MultiPortal_Context_Selection_TZ_v0.2.md',
    'Canon_Arcana_Consilium_Context_Selection_TZ_v0.3.md',
    'Canon_Arcana_v0.3_SHA256SUMS.txt',
  ];
  const doc = {
    querySelectorAll(sel) {
      if (/open-file|artifact-row/.test(sel)) {
        return panelRows.map((name) => ({
          getAttribute: (n) => (n === 'aria-label' ? name : null),
        }));
      }
      if (/behavior-btn/.test(sel)) {
        // The same buttons the real conversation carries, including the ones
        // whose labels repeat the panel's files.
        return [
          downloadButton('Скачать полное ТЗ Canon_Arcana_Control_Arcana_TZ_v0.1.md'),
          downloadButton('Скачать готовый Canon Consilium Prompt Bundle v1'),
        ];
      }
      return [];
    },
  };

  const out = await parser.appendPanelArtifacts('body', {
    doc,
    win: makeWin(),
    conversationId: 'conv-1',
    artifacts: [{ kind: 'asset', messageId: 'm1' }],
    fetchImpl: stubFetch([
      ['/interpreter/download', jsonOk({
        download_url: 'https://chatgpt.com/backend-api/estuary/content?id=f&fn=x',
        file_name: 'x',
      })],
    ]),
    token: 'tok',
  });

  for (const name of panelRows) {
    assert.ok(out.indexOf(name) !== -1, 'the panel file must survive the button pass: ' + name);
  }
});

test('the panel names actually reach the button selector', async () => {
  // Kills the mutant that survived: replacing `files.map(f => f.name)` with []
  // left every test green, because the fixtures above pass panelNames directly
  // to downloadButtonsInPage instead of letting appendPanelArtifacts derive it.
  // Without this, the guard that prevents the measured regression is unverified
  // wiring — the exact "helper is tested, its use is not" trap in CLAUDE.md.
  let seenPanelNames = null;
  const panelRow = 'Canon_Arcana_Consilium_Context_Selection_TZ_v0.3.md';

  const doc = {
    querySelectorAll(sel) {
      if (/open-file|artifact-row/.test(sel)) {
        return [{ getAttribute: (n) => (n === 'aria-label' ? panelRow : null) }];
      }
      if (/behavior-btn/.test(sel)) {
        return [downloadButton('Скачать ' + panelRow.replace('.md', '.zip'))];
      }
      return [];
    },
  };

  // Wrap the real selector so the arguments it receives can be asserted.
  const realSelector = parser.downloadButtonsInPage;
  await parser.appendPanelArtifacts('body', {
    doc,
    win: makeWin(),
    conversationId: 'conv-1',
    artifacts: [{ kind: 'asset', messageId: 'm1' }],
    fetchImpl: stubFetch([
      ['/interpreter/download', jsonOk({
        download_url: 'https://chatgpt.com/backend-api/estuary/content?id=f&fn=' + panelRow,
        file_name: panelRow,
      })],
    ]),
    token: 'tok',
    // Intercept at the boundary appendPanelArtifacts actually calls.
    buttons: undefined,
    onSelectButtons(namesPassed) { seenPanelNames = namesPassed; },
  });
  assert.equal(typeof realSelector, 'function');

  assert.ok(Array.isArray(seenPanelNames),
    'appendPanelArtifacts must hand the panel names to the button selector');
  assert.ok(seenPanelNames.indexOf(panelRow) !== -1,
    'the resolved panel file must be among the names, or it will be clicked');
});

test('a viewer gets both dismissal routes, not just the first', async () => {
  // The close control cannot report whether the viewer actually went away, and
  // a viewer left open costs every artefact behind it. Escape follows it.
  let closeClicks = 0;
  let escapes = 0;
  const doc = {
    body: {
      dispatchEvent(ev) { if (ev && ev.key === 'Escape') escapes += 1; return true; },
    },
    querySelectorAll(sel) {
      if (/behavior-btn/.test(sel)) {
        return [downloadButton('Скачать ТЗ v0.1', { onClick() { /* opens a viewer */ } })];
      }
      if (/aria-label|close/.test(sel)) {
        return [{
          getAttribute: (n) => (n === 'aria-label' ? 'Закрыть' : null),
          click() { closeClicks += 1; },
        }];
      }
      return [];
    },
  };

  await parser.collectButtonDownloads({
    doc,
    win: makeWin(),
    sleep: async () => {},
    dismissSettleMs: 0,
  });

  assert.equal(closeClicks, 1, 'the close control must be pressed');
  assert.equal(escapes, 1, 'Escape must follow, since the control reports nothing');
});

test('buttons outside the viewport are found by scrolling for them', async () => {
  // MEASURED (2026-09-10, 16:51 export): zero buttons, no `## Files` section at
  // all, on a conversation that carries eight of them. This pass runs AFTER
  // scanTurns restores the original scroll position, so the virtualizer has
  // unmounted everything off-screen — a static query sees one screen's worth.
  // The feature is dead without this on any conversation longer than a screen,
  // which is every conversation that generates files.
  const allButtons = [
    downloadButton('Скачать ТЗ v0.1'),
    downloadButton('Скачать готовый Canon Consilium Prompt Bundle v1'),
  ];

  // A virtualized page: only the button whose band is in view is mounted.
  const scroller = { scrollTop: 0, scrollHeight: 3000, clientHeight: 1000 };
  const doc = {
    querySelector: () => ({ tag: 'turn' }),
    querySelectorAll(sel) {
      if (!/behavior-btn/.test(sel)) return [];
      // First button mounts near the top, the second near the bottom.
      return scroller.scrollTop < 1000 ? [allButtons[0]] : [allButtons[1]];
    },
  };

  const found = await parser.findButtonsByScrolling(doc, makeWin(), {
    scroller,
    sleep: async () => {},
    buttonScrollSettleMs: 0,
  });
  const labels = found.map((b) => b.label).sort();

  assert.deepEqual(labels,
    ['Скачать ТЗ v0.1', 'Скачать готовый Canon Consilium Prompt Bundle v1'].sort(),
    'both buttons must be found, including the one that starts unmounted');
  assert.equal(scroller.scrollTop, 0, 'the scroll position must be restored');
});

test('the export scrolls for buttons when a static read finds none', async () => {
  // Drives appendPanelArtifacts, not the helper: the ordering defect lived in
  // the caller, and a helper test would not have caught it.
  const archive = downloadButton('Скачать готовый Canon Consilium Prompt Bundle v1', {
    onClick() {
      const anchor = {
        getAttribute: () => 'https://chatgpt.com/backend-api/estuary/content?fn=bundle.zip',
        hasAttribute: () => true,
      };
      win.HTMLAnchorElement.prototype.click.call(anchor);
    },
  });
  const win = makeWin();
  const scroller = { scrollTop: 0, scrollHeight: 3000, clientHeight: 1000 };
  const doc = {
    querySelector: () => ({ tag: 'turn' }),
    querySelectorAll(sel) {
      if (/open-file|artifact-row/.test(sel)) return [];
      if (!/behavior-btn/.test(sel)) return [];
      // Mounted only once the scan has scrolled down — the measured shape.
      return scroller.scrollTop > 0 ? [archive] : [];
    },
  };

  const out = await parser.appendPanelArtifacts('body', {
    doc,
    win,
    scroller,
    conversationId: 'conv-1',
    artifacts: [],
    fetchImpl: stubFetch([]),
    token: 'tok',
    sleep: async () => {},
    buttonScrollSettleMs: 0,
    panelWaitMs: 0,
  });

  assert.ok(out.indexOf('[bundle.zip](') !== -1,
    'the archive must be found even though it is unmounted when the pass starts');
});

test('the panel is read after it stops growing, not on its first row', async () => {
  // MEASURED (2026-09-12): a conversation with five panel files exported four.
  // TZ-01_Arcanada_Ecosystem_Project_Cards.md appeared NOWHERE in the markdown —
  // not as a link, not as unresolved, not by name. The panel mounts its rows
  // progressively and the wait returned on the first one, so anything rendering
  // a frame later was dropped silently. The user had to download it by hand.
  const rows = [
    'TZ-01_Arcanada_Ecosystem_Project_Cards.md',
    'arcanada_talomnia_89_articles_narratives.md',
    'TZ-02_Canon_Arcana_Authoring_Manual.md',
  ];
  let poll = 0;
  const doc = {
    querySelectorAll(sel) {
      if (!/open-file|artifact-row/.test(sel)) return [];
      poll += 1;
      // The measured shape: one row on the first frame, the rest a frame later.
      const visible = poll <= 1 ? rows.slice(1, 2) : rows;
      return visible.map((n) => ({
        getAttribute: (a) => (a === 'aria-label' ? n : null),
      }));
    },
  };

  const files = await parser.waitForArtifactPanel(doc, {
    sleep: async () => {},
    now: () => Date.now(),
  });
  const names = files.map((f) => f.name);

  assert.equal(names.length, 3, 'every mounted row must be read, not just the first');
  assert.ok(names.indexOf('TZ-01_Arcanada_Ecosystem_Project_Cards.md') !== -1,
    'the row that mounts late is exactly the one that used to be lost');
});

test('a conversation with no panel still costs only one poll', async () => {
  // Positive control for the cost: the growth wait must not run when there is
  // nothing to wait for, or every panel-less export pays the full budget.
  let polls = 0;
  const doc = {
    querySelectorAll(sel) {
      if (/open-file|artifact-row/.test(sel)) polls += 1;
      return [];
    },
  };

  let clock = 0;
  const files = await parser.waitForArtifactPanel(doc, {
    sleep: async () => { clock += 500; },
    now: () => clock,
    panelWaitMs: 2000,
    panelPollMs: 500,
  });

  assert.deepEqual(files, []);
  // 2000ms of budget at 500ms per poll: the absence loop spends 5 reads and the
  // export moves on. This bounds the COST of a panel-less conversation, which is
  // most of them.
  //
  // Honest limit of this assertion: it does not kill a mutant deleting the
  // `if (!files.length) return files;` guard. By the time the absence loop ends
  // the budget is spent, so the stability wait it guards exits immediately too —
  // the guard is unobservable from the outside here. Asserting it with a LIVE
  // budget does not work either: an empty panel then spins until the deadline,
  // and with a stubbed clock that never advances the suite hangs instead of
  // failing (measured: two files timed out at 60s). Recorded in
  // MUTATION-EVIDENCE.md as redundant-by-design rather than left looking
  // verified — the guard is a cheap early exit, not a correctness boundary.
  assert.ok(polls <= 5,
    'an absent panel must not cost more than its budget, saw ' + polls);
});

test('a transient shrink does not erase files already seen', async () => {
  // The panel re-renders. A frame reporting fewer rows is a render artefact, not
  // proof a file vanished — treating it as truth would reintroduce the loss.
  const all = ['a.md', 'b.md', 'c.md'];
  let poll = 0;
  const doc = {
    querySelectorAll(sel) {
      if (!/open-file|artifact-row/.test(sel)) return [];
      poll += 1;
      const visible = poll === 3 ? all.slice(0, 1) : all;   // one frame shrinks
      return visible.map((n) => ({
        getAttribute: (a) => (a === 'aria-label' ? n : null),
      }));
    },
  };

  const files = await parser.waitForArtifactPanel(doc, {
    sleep: async () => {},
    now: () => Date.now(),
  });

  assert.equal(files.length, 3, 'a shrinking frame must not shrink the result');
});

test('a panel replaced by a different set of the same size loses nothing', async () => {
  // MEASURED (2026-09-13). The count-based wait shipped in 1.5.2 fixed nothing:
  // the export came back byte-identical to the one before it. The reason is that
  // the panel does not only GROW, it is REPLACED as the page settles —
  //
  //   panel on screen:  TZ-01, TZ-02, TZ-03, TZ-04
  //   export contained: 89_articles, TZ-02, TZ-03, TZ-04
  //
  // two different sets of four. A same-size swap looks perfectly stable to a
  // count-based wait, so it returned the set that was missing the file the user
  // actually wanted, with no notice of any kind.
  const early = ['arcanada_talomnia_89_articles_narratives.md', 'b.md', 'c.md', 'd.md'];
  const late = ['TZ-01_Arcanada_Ecosystem_Project_Cards.md', 'b.md', 'c.md', 'd.md'];
  let poll = 0;
  const doc = {
    querySelectorAll(sel) {
      if (!/open-file|artifact-row/.test(sel)) return [];
      poll += 1;
      return (poll <= 1 ? early : late).map((n) => ({
        getAttribute: (a) => (a === 'aria-label' ? n : null),
      }));
    },
  };

  const names = (await parser.waitForArtifactPanel(doc, {
    sleep: async () => {},
    now: () => Date.now(),
  })).map((f) => f.name);

  assert.equal(names.length, 5, 'the union of both frames, not the last frame');
  assert.ok(names.indexOf('TZ-01_Arcanada_Ecosystem_Project_Cards.md') !== -1,
    'the file the user came for must survive the swap');
  assert.ok(names.indexOf('arcanada_talomnia_89_articles_narratives.md') !== -1,
    'and the one the earlier frame carried must survive it too');
});

test('a name seen once is never dropped by a later frame', async () => {
  // The asymmetry that justifies the union: a stale extra name costs one failed
  // resolve, reported as unresolved. A dropped name costs a file the user never
  // hears about — which is exactly how this defect stayed invisible for a day.
  let poll = 0;
  const doc = {
    querySelectorAll(sel) {
      if (!/open-file|artifact-row/.test(sel)) return [];
      poll += 1;
      // Present on the first frame, gone from every frame after it.
      return (poll <= 1 ? ['vanishing.md', 'stable.md'] : ['stable.md']).map((n) => ({
        getAttribute: (a) => (a === 'aria-label' ? n : null),
      }));
    },
  };

  const names = (await parser.waitForArtifactPanel(doc, {
    sleep: async () => {},
    now: () => Date.now(),
  })).map((f) => f.name);

  assert.ok(names.indexOf('vanishing.md') !== -1,
    'a row that disappears from a later frame must still be reported');
});

/* ------------------------------------------------------------------------- *
 * The artefact panel is nested INSIDE a turn, so it is virtualized with it.
 *
 * Measured from the live markup (2026-09-13):
 *
 *   <div class="…agent-turn">
 *     <div data-message-author-role="assistant" …>
 *     <div class="w-full max-w-[480px]">      <- the artefact panel
 *
 * The rows are not a sidebar. A row exists only while its own turn is mounted,
 * and scanTurns restores the original scroll position in its `finally`, so a
 * post-scan read sees whichever turn happens to be on screen. That is why the
 * panel showed TZ-01..TZ-04 while the export carried 89_articles plus
 * TZ-02..TZ-04 — two different sets of four, read at two scroll positions.
 * ------------------------------------------------------------------------- */

test('artefact rows are harvested during the scan, while their turn is mounted', async () => {
  // The rows visible depend on scroll position, exactly as on the live page.
  let scrollTop = 0;
  const doc = {
    querySelectorAll(sel) {
      if (!/open-file|artifact-row/.test(sel)) return [];
      const rows = scrollTop < 500
        ? ['TZ-01_Arcanada_Ecosystem_Project_Cards.md']
        : ['TZ-02_x.md', 'TZ-03_x.md'];
      return rows.map((n) => ({ getAttribute: (a) => (a === 'aria-label' ? n : null) }));
    },
  };

  const collected = new Map();
  for (const pos of [0, 600]) {
    scrollTop = pos;
    for (const f of parser.listArtifactPanelFiles(doc)) collected.set(f.name, f);
  }
  // The scan has finished and restored the position: only TZ-01 is on screen.
  scrollTop = 0;

  const out = await parser.appendPanelArtifacts('body', {
    doc,
    conversationId: 'conv-1',
    artifacts: [{ kind: 'asset', messageId: 'm1' }],
    scannedPanelFiles: Array.from(collected.values()),
    token: 'tok',
    sleep: async () => {},
    clickDownloads: false,
    fetchImpl: stubFetch([
      ['/interpreter/download', jsonOk({
        download_url: 'https://chatgpt.com/backend-api/estuary/content?id=f&fn=x',
        file_name: 'x',
      })],
    ]),
  });

  for (const name of ['TZ-01_Arcanada_Ecosystem_Project_Cards.md', 'TZ-02_x.md', 'TZ-03_x.md']) {
    assert.ok(out.indexOf(name) !== -1,
      'every turn\'s rows must survive the scan, missing: ' + name);
  }
});

test('the scan calls its mounted-collector at each position it holds', async () => {
  // Drives scanTurns itself: the collector is the wiring, and wiring is what
  // broke here. A helper test cannot see that the scan never calls it.
  const positions = [];
  const container = { scrollTop: 0, scrollHeight: 2000, clientHeight: 1000 };
  const turn = {
    getAttribute: (n) => (n === 'data-turn-id' ? 't1' : null),
    querySelector: () => null,
    querySelectorAll: () => [],
    textContent: 'hi',
  };

  await parser.scanTurns(container, {
    readSections: () => [turn],
    extractTurn: () => ({ id: 't1', order: 1, markdown: 'hi', discoveryIndex: 0 }),
    scrollTo: async (target, top) => { target.scrollTop = top; },
    settle: async () => {},
    isCancelled: () => false,
    scanMeta: {},
    maxSteps: 6,
    stablePasses: 1,
    onMounted: () => { positions.push(container.scrollTop); },
  });

  assert.ok(positions.length >= 2,
    'the collector must run at more than one scroll position, saw ' + positions.length);
});

test('a throwing collector does not lose the conversation', async () => {
  // The turns are the expensive, unrepeatable part. A failure reading artefact
  // rows must not take them with it.
  const container = { scrollTop: 0, scrollHeight: 2000, clientHeight: 1000 };
  const turn = {
    getAttribute: (n) => (n === 'data-turn-id' ? 't1' : null),
    querySelector: () => null,
    querySelectorAll: () => [],
    textContent: 'hi',
  };

  const turns = await parser.scanTurns(container, {
    readSections: () => [turn],
    extractTurn: () => ({ id: 't1', order: 1, markdown: 'hi', discoveryIndex: 0 }),
    scrollTo: async (target, top) => { target.scrollTop = top; },
    settle: async () => {},
    isCancelled: () => false,
    scanMeta: {},
    maxSteps: 4,
    stablePasses: 1,
    onMounted: () => { throw new Error('collector exploded'); },
  });

  assert.equal(turns.length, 1, 'the captured turns must survive a failing collector');
});
