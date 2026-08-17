'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const parser = require('../content.js');

/**
 * A sidebar that behaves like a real virtualizer: it holds MANY conversations
 * but mounts only a window of them around the current scroll offset.
 *
 * The ground truth (`allIds`) is deliberately NOT reachable by any selector the
 * code under test can call. That is the whole point: a fixture that mounts every
 * row is complete by construction and cannot express "there were rows you never
 * saw" — the exact blind spot that let a partial export report success.
 */
function createVirtualSidebar(options) {
  const total = options.total;
  const windowSize = options.windowSize;
  // A sidebar that cannot scroll at all (everything fits) sets this.
  const scrollable = options.scrollable !== false;
  const rowHeight = 10;
  const allIds = [];
  for (let i = 0; i < total; i++) allIds.push('conv' + String(i).padStart(3, '0'));

  const nav = {};
  const scroller = {
    scrollTop: 0,
    clientHeight: windowSize * rowHeight,
    get scrollHeight() {
      return scrollable ? total * rowHeight : windowSize * rowHeight;
    },
    parentElement: null,
  };

  function mountedIds() {
    const first = Math.floor(scroller.scrollTop / rowHeight);
    return allIds.slice(first, first + windowSize);
  }

  function linkFor(id) {
    return {
      getAttribute(name) {
        if (name === 'href') return '/c/' + id;
        if (name === 'aria-label') return 'Chat ' + id;
        return null;
      },
      querySelector() { return null; },
      textContent: 'Chat ' + id,
      parentElement: scroller,
    };
  }

  const doc = {
    querySelectorAll(selector) {
      assert.equal(selector, 'nav a[href^="/c/"]');
      return mountedIds().map(linkFor);
    },
    querySelector(selector) {
      if (selector === 'nav a[href^="/c/"]') {
        const ids = mountedIds();
        return ids.length ? linkFor(ids[0]) : null;
      }
      return null;
    },
  };

  nav.doc = doc;
  return { doc, scroller, allIds };
}

const immediate = () => Promise.resolve();

test('a virtualized sidebar is read to the END, not just the mounted window', async () => {
  // 60 conversations, only 8 ever mounted at once. A single unscrolled read
  // returns 8 and would report them as the whole project.
  const fixture = createVirtualSidebar({ total: 60, windowSize: 8 });

  const oneShot = parser.listSidebarConversations(fixture.doc);
  assert.equal(oneShot.length, 8, 'the one-frame reader sees only the mounted window');

  const walked = await parser.collectSidebarConversations({
    doc: fixture.doc,
    scroller: fixture.scroller,
    sleep: immediate,
  });

  assert.equal(walked.conversations.length, 60, 'the walk must reach every conversation');
  assert.equal(walked.complete, true, 'reaching the end must be reported as complete');
  assert.deepEqual(
    walked.conversations.map((c) => c.id).sort(),
    fixture.allIds.slice().sort(),
    'every ground-truth id must be present'
  );
});

test('a walk that runs out of rounds reports complete:false rather than a subset', async () => {
  const fixture = createVirtualSidebar({ total: 60, windowSize: 8 });

  // Far too few rounds to reach the end. The contract is that the shortfall is
  // ANNOUNCED, not that the walk succeeds.
  const walked = await parser.collectSidebarConversations({
    doc: fixture.doc,
    scroller: fixture.scroller,
    sleep: immediate,
    maxRounds: 2,
  });

  assert.ok(walked.conversations.length < 60, 'this run cannot have reached the end');
  assert.equal(walked.complete, false, 'an unfinished walk must NOT claim completeness');
  assert.equal(walked.reason, 'round-limit');
});

test('a sidebar that fits entirely is complete without scrolling', async () => {
  const fixture = createVirtualSidebar({ total: 5, windowSize: 8, scrollable: false });

  const walked = await parser.collectSidebarConversations({
    doc: fixture.doc,
    sleep: immediate,
  });

  assert.equal(walked.conversations.length, 5);
  assert.equal(walked.complete, true);
});

test('the walk restores the scroll position it started from', async () => {
  const fixture = createVirtualSidebar({ total: 40, windowSize: 8 });
  fixture.scroller.scrollTop = 70;

  await parser.collectSidebarConversations({
    doc: fixture.doc,
    scroller: fixture.scroller,
    sleep: immediate,
  });

  assert.equal(fixture.scroller.scrollTop, 70, 'the user\'s sidebar position must survive the walk');
});

test('the walk terminates when the sidebar never scrolls, and says so', async () => {
  // A container that reports room to scroll but refuses to move: a wedged
  // virtualizer, or an element whose scrollTop is not writable in practice.
  const fixture = createVirtualSidebar({ total: 60, windowSize: 8 });
  const stuck = {
    get scrollTop() { return 0; },
    set scrollTop(_v) { /* ignores writes */ },
    clientHeight: 80,
    scrollHeight: 600,
    parentElement: null,
  };

  const walked = await parser.collectSidebarConversations({
    doc: fixture.doc,
    scroller: stuck,
    sleep: immediate,
    maxRounds: 10,
  });

  // It must not hang, and it must not claim to have seen the whole list.
  assert.equal(walked.complete, false, 'a sidebar that never moves cannot be complete');
  assert.equal(walked.conversations.length, 8, 'only the mounted window was ever readable');
});

/**
 * A sidebar that appends more rows only after several quiet polls at the
 * bottom — a lazy loader fetching the next page over the network.
 * `appendAfter` = how many quiet bottom polls elapse before the batch lands.
 */
function createLateAppendingSidebar(appendAfter) {
  const rowHeight = 10;
  const windowSize = 8;
  const ids = [];
  for (let i = 0; i < 8; i++) ids.push('first' + i);
  let bottomPolls = 0;
  let appended = false;

  const scroller = {
    scrollTop: 0,
    clientHeight: windowSize * rowHeight,
    get scrollHeight() { return ids.length * rowHeight; },
    parentElement: null,
  };
  const doc = {
    querySelectorAll() {
      const maxTop = Math.max(0, ids.length * rowHeight - windowSize * rowHeight);
      if (scroller.scrollTop >= maxTop - 1 && !appended) {
        bottomPolls += 1;
        if (bottomPolls > appendAfter) {
          for (let i = 0; i < 10; i++) ids.push('late' + i);
          appended = true;
        }
      }
      const first = Math.floor(scroller.scrollTop / rowHeight);
      return ids.slice(first, first + windowSize).map((id) => ({
        getAttribute(name) { return name === 'href' ? '/c/' + id : null; },
        querySelector() { return null; },
        textContent: id,
        parentElement: scroller,
      }));
    },
    querySelector() { return null; },
  };
  return { doc, scroller, totalAfterAppend: 18 };
}

test('a late-appending page is waited for, and picked up in full', async () => {
  const fixture = createLateAppendingSidebar(4);

  const walked = await parser.collectSidebarConversations({
    doc: fixture.doc,
    scroller: fixture.scroller,
    sleep: immediate,
    quietRounds: 6,
  });

  assert.equal(walked.conversations.length, fixture.totalAfterAppend);
  assert.equal(walked.complete, true);
});

test('quietRounds is the patience budget, and a short budget really does stop early', async () => {
  // What `complete` can and cannot mean, pinned deliberately.
  //
  // A loader that has not yet appended is INDISTINGUISHABLE from a finished
  // list: the viewport is at the bottom, the round added nothing, and
  // scrollHeight is unchanged. Nothing in the DOM announces an in-flight fetch.
  // So `complete:true` asserts "quiet at the bottom for quietRounds rounds",
  // not "the server has no more rows" — a guarantee scrolling cannot provide.
  //
  // This test therefore pins the OBSERVABLE contract: patience changes what is
  // found, so the budget is load-bearing rather than decorative.
  // The loader is slow enough that the two budgets genuinely diverge. (With a
  // fast loader both budgets win, which is why the append delay is tuned here
  // rather than left at a value that makes the knob look decorative.)
  const impatient = createLateAppendingSidebar(10);
  const shortWalk = await parser.collectSidebarConversations({
    doc: impatient.doc,
    scroller: impatient.scroller,
    sleep: immediate,
    quietRounds: 2,
  });

  const patient = createLateAppendingSidebar(10);
  const longWalk = await parser.collectSidebarConversations({
    doc: patient.doc,
    scroller: patient.scroller,
    sleep: immediate,
    quietRounds: 6,
  });

  assert.ok(
    shortWalk.conversations.length < longWalk.conversations.length,
    'a longer quiet budget must find strictly more of a slow list'
  );
  assert.equal(longWalk.conversations.length, patient.totalAfterAppend);
});

/**
 * A realistic virtualizer WITH geometry: it renders the rows overlapping the
 * viewport, capped at `mountCap` rows, and each row reports its own rect.
 * `mountCap` below the number of rows that fit the viewport is the dangerous
 * case — a full-viewport scroll step then jumps over rows that never mounted.
 */
function createMeasuredSidebar(total, mountCap, rowHeight, clientHeight) {
  const ids = [];
  for (let i = 0; i < total; i++) ids.push('m' + String(i).padStart(3, '0'));
  const scroller = {
    scrollTop: 0,
    clientHeight: clientHeight,
    scrollHeight: total * rowHeight,
    parentElement: null,
  };
  const doc = {
    querySelectorAll() {
      const firstVisible = Math.floor(scroller.scrollTop / rowHeight);
      const lastVisible = Math.min(
        total - 1,
        Math.ceil((scroller.scrollTop + clientHeight) / rowHeight) - 1
      );
      const last = Math.min(lastVisible, firstVisible + mountCap - 1);
      const out = [];
      for (let i = firstVisible; i <= last; i++) {
        const id = ids[i];
        const relTop = i * rowHeight - scroller.scrollTop;
        out.push({
          getAttribute(name) { return name === 'href' ? '/c/' + id : null; },
          querySelector() { return null; },
          textContent: id,
          parentElement: scroller,
          getBoundingClientRect() {
            return { top: relTop, bottom: relTop + rowHeight, height: rowHeight };
          },
        });
      }
      return out;
    },
    querySelector() { return null; },
  };
  return { doc, scroller, ids };
}

test('full coverage of a measurable list is reported as verified and complete', async () => {
  const fixture = createMeasuredSidebar(60, 10, 60, 600);

  const walked = await parser.collectSidebarConversations({
    doc: fixture.doc,
    scroller: fixture.scroller,
    sleep: immediate,
    maxRounds: 2000,
  });

  assert.equal(walked.conversations.length, 60, 'every row must be observed');
  assert.equal(walked.complete, true);
  assert.equal(walked.coverageVerified, true, 'completeness here rests on measured coverage');
});

test('rows stepped over leave a coverage gap, and the walk refuses to claim completeness', async () => {
  // THE defect this machinery exists for. The virtualizer mounts a band shorter
  // than the viewport, so some rows are never in the DOM where the walk looks.
  // Missing them is survivable — reporting the remainder as the whole project is
  // not, because the user has nothing to compare against.
  let scenariosWithLoss = 0;
  for (const mountCap of [8, 4, 1]) {
    const fixture = createMeasuredSidebar(60, mountCap, 60, 600);
    const walked = await parser.collectSidebarConversations({
      doc: fixture.doc,
      scroller: fixture.scroller,
      sleep: immediate,
      maxRounds: 2000,
    });

    const missed = fixture.ids.filter(
      (id) => !walked.conversations.some((c) => c.id === id)
    );
    if (!missed.length) continue;
    scenariosWithLoss += 1;
    assert.equal(
      walked.complete,
      false,
      'mountCap=' + mountCap + ': ' + missed.length + ' rows missed, so complete must be false'
    );
    assert.equal(walked.reason, 'coverage-gap');
  }

  // Without this the test would pass vacuously if the scenario ever stopped
  // losing rows — a green assertion about a case that never ran.
  assert.ok(
    scenariosWithLoss > 0,
    'the step-over scenario must still reproduce, or this test proves nothing'
  );
});

test('a scroller that throws on write stops with scroll-blocked, not a false success', async () => {
  // Previously this rejected the injected function, and the popup blamed the
  // user: "no conversations found — open a Project page first."
  const fixture = createMeasuredSidebar(60, 10, 60, 600);
  const throwing = {
    get scrollTop() { return 0; },
    set scrollTop(_v) { throw new Error('scrollTop is not writable here'); },
    clientHeight: 600,
    scrollHeight: 3600,
    parentElement: null,
  };

  const walked = await parser.collectSidebarConversations({
    doc: fixture.doc,
    scroller: throwing,
    sleep: immediate,
  });

  assert.equal(walked.complete, false, 'a walk that could not scroll is not complete');
  assert.equal(walked.reason, 'scroll-blocked');
  assert.ok(walked.conversations.length > 0, 'the rows already mounted are still returned');
});

test('a list whose top was never observed is not complete', async () => {
  // Starting mid-list (the user had scrolled) and walking only downward leaves
  // the rows above unobserved. Reaching the bottom is not reaching everything.
  const fixture = createMeasuredSidebar(60, 10, 60, 600);
  fixture.scroller.scrollTop = 1800;   // half way down

  const walked = await parser.collectSidebarConversations({
    doc: fixture.doc,
    scroller: fixture.scroller,
    sleep: immediate,
    maxRounds: 2000,
  });

  const sawFirstRow = walked.conversations.some((c) => c.id === fixture.ids[0]);
  assert.equal(sawFirstRow, false, 'this walk never looked above its starting point');
  assert.equal(walked.complete, false, 'an unobserved head of the list must block completeness');
  assert.equal(walked.reason, 'coverage-gap');
});

test('a list still growing taller is not declared finished', async () => {
  // The rows exist but have not mounted yet, so a read returns nothing new while
  // scrollHeight climbs. Treating that quiet read as the end would truncate.
  const rowHeight = 10;
  const windowSize = 8;
  const ids = [];
  for (let i = 0; i < 8; i++) ids.push('grow' + i);
  let polls = 0;

  const scroller = {
    scrollTop: 0,
    clientHeight: windowSize * rowHeight,
    // Height keeps climbing for the first few polls, then settles once the
    // remaining rows have mounted.
    get scrollHeight() { return (ids.length + Math.max(0, 4 - polls)) * rowHeight; },
    parentElement: null,
  };
  const doc = {
    querySelectorAll() {
      polls += 1;
      if (polls === 4) for (let i = 0; i < 6; i++) ids.push('mounted' + i);
      const first = Math.floor(scroller.scrollTop / rowHeight);
      return ids.slice(first, first + windowSize).map((id) => ({
        getAttribute(name) { return name === 'href' ? '/c/' + id : null; },
        querySelector() { return null; },
        textContent: id,
        parentElement: scroller,
      }));
    },
    querySelector() { return null; },
  };

  const walked = await parser.collectSidebarConversations({
    doc, scroller, sleep: immediate, quietRounds: 2,
  });

  assert.equal(walked.conversations.length, 14, 'the rows that mounted late must be captured');
});

test('a list arriving in bursts is not cut short by one quiet round', async () => {
  // Real lazy loaders pause: a round can add nothing and still be followed by
  // more rows. Stopping at the first quiet round would silently truncate.
  const rowHeight = 10;
  const windowSize = 8;
  const total = 30;
  const allIds = [];
  for (let i = 0; i < total; i++) allIds.push('burst' + String(i).padStart(3, '0'));

  let reads = 0;
  const scroller = {
    scrollTop: 0,
    clientHeight: windowSize * rowHeight,
    scrollHeight: total * rowHeight,
    parentElement: null,
  };
  const doc = {
    querySelectorAll() {
      reads += 1;
      // Every third read returns nothing new (a stalled burst), yet the list
      // continues afterwards.
      if (reads % 3 === 0) return [];
      const first = Math.floor(scroller.scrollTop / rowHeight);
      return allIds.slice(first, first + windowSize).map((id) => ({
        getAttribute(name) { return name === 'href' ? '/c/' + id : null; },
        querySelector() { return null; },
        textContent: id,
        parentElement: scroller,
      }));
    },
    querySelector() { return null; },
  };

  const walked = await parser.collectSidebarConversations({
    doc, scroller, sleep: immediate,
  });

  assert.equal(walked.conversations.length, total, 'a stalled burst must not end the walk');
  assert.equal(walked.complete, true);
});
