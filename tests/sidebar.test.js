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

  function first() {
    return Math.floor(scroller.scrollTop / rowHeight);
  }
  function mountedIds() {
    return allIds.slice(first(), first() + windowSize);
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
      // Matches any conversation-link selector the shipped code chooses, rather
      // than pinning one literal. The href shape changed once already (project
      // conversations are /g/g-p-…/c/…), and a fixture that restates the
      // selector fails the moment the code is corrected.
      if (selector === 'nav li') return lastBuiltListItems;
      if (!isConversationLinkSelector(selector)) return [];
      return linkListWithItems(mountedIds().map(linkFor), first() + windowSize < total);
    },
    querySelector(selector) {
      if (!isConversationLinkSelector(selector)) return null;
      const ids = mountedIds();
      return ids.length ? linkFor(ids[0]) : null;
    },
  };

  nav.doc = doc;
  return { doc, scroller, allIds };
}

const immediate = () => Promise.resolve();

/** True for any selector the shipped code may use to find conversation links.
 *  Deliberately permissive: the fixture's job is to model a sidebar, not to pin
 *  the exact selector string, which has already changed once. */
/** Wrap conversation-link stubs in the `li` structure the real sidebar uses.
 *  Verified on production: `nav li` persists beyond the mounted links (813 items
 *  against 803 links), which is what lets the walk prove it reached the tail. The
 *  fixtures must carry that structure or they model a DOM that cannot exist. */
/** The list items built by the most recent `linkListWithItems` call, so a fixture
 *  can answer `nav li` the way the real sidebar does. Production keeps MORE items
 *  than mounted links (813 against 803), which is what makes a missing next
 *  sibling mean "end of list" rather than "end of window". */
let lastBuiltListItems = [];

function linkListWithItems(links, hasSuccessor) {
  const items = links.map((link) => {
    const li = {
      tagName: 'LI',
      querySelector(selector) {
        return isConversationLinkSelector(selector) ? link : null;
      },
      nextElementSibling: null,
    };
    link.parentElement = li;
    return li;
  });
  for (let i = 0; i < items.length - 1; i++) items[i].nextElementSibling = items[i + 1];
  // A successor exists only when rows remain AFTER the deepest mounted one — the
  // caller passes `hasSuccessor` for that, because "the list is longer than this
  // window" is true at every offset including the last, where the window really
  // does end the list.
  if (hasSuccessor && items.length) {
    items[items.length - 1].nextElementSibling = {
      tagName: 'LI',
      querySelector(selector) {
        // A pending row exists here but has not mounted; it still answers the
        // structural question "is there anything after what I captured?".
        return isConversationLinkSelector(selector) ? { pending: true } : null;
      },
      nextElementSibling: null,
    };
  }
  // One extra item beyond the rows, mirroring the real sidebar's chrome items, so
  // structure demonstrably outlives the mounted window.
  lastBuiltListItems = items.concat([
    { tagName: 'LI', querySelector() { return null; }, nextElementSibling: null },
  ]);
  return links;
}

function isConversationLinkSelector(selector) {
  return typeof selector === 'string' && selector.indexOf('/c/') !== -1;
}

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
    querySelectorAll(selector) {
      if (selector === 'nav li') return lastBuiltListItems;
      const maxTop = Math.max(0, ids.length * rowHeight - windowSize * rowHeight);
      if (scroller.scrollTop >= maxTop - 1 && !appended) {
        bottomPolls += 1;
        if (bottomPolls > appendAfter) {
          for (let i = 0; i < 10; i++) ids.push('late' + i);
          appended = true;
        }
      }
      const first = Math.floor(scroller.scrollTop / rowHeight);
      const window = ids.slice(first, first + windowSize).map((id) => ({
        getAttribute(name) { return name === 'href' ? '/c/' + id : null; },
        querySelector() { return null; },
        textContent: id,
        parentElement: scroller,
      }));
      return linkListWithItems(window, first + windowSize < ids.length);
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
    querySelectorAll(selector) {
      if (selector === 'nav li') return lastBuiltListItems;
      if (selector !== undefined && !isConversationLinkSelector(selector)) return [];
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
      // `last` is the deepest row rendered; when the list runs past it, structure
      // remains and the walk can tell it has not reached the tail.
      return linkListWithItems(out, last < total - 1);
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
    // Either honest refusal is acceptable: an interior hole is a coverage gap,
    // and a row past the deepest capture is an undischarged tail obligation. What
    // must never happen is `complete: true` with rows missing.
    assert.ok(
      walked.reason === 'coverage-gap' || walked.reason === 'successor-exists-not-mounted',
      'unexpected reason: ' + walked.reason
    );
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

test('a walk starting mid-list still covers the rows above it', async () => {
  // The user had scrolled before pressing the button. The downward pass alone
  // never looks up, so without the final sweep the head of the list is missed
  // entirely — measured on production as 28 conversations that existed in the
  // DOM but were never listed.
  const fixture = createMeasuredSidebar(60, 10, 60, 600);
  fixture.scroller.scrollTop = 1800;   // half way down

  const walked = await parser.collectSidebarConversations({
    doc: fixture.doc,
    scroller: fixture.scroller,
    sleep: immediate,
    maxRounds: 2000,
  });

  assert.ok(
    walked.conversations.some((c) => c.id === fixture.ids[0]),
    'the final sweep must reach the first row'
  );
  assert.equal(walked.conversations.length, 60, 'every row must be listed');
  assert.equal(walked.complete, true);
});

test('without the final sweep, a mid-list start is reported as incomplete', async () => {
  // The guarantee still holds when the sweep is disabled: a partial walk says so
  // rather than presenting the rows below the starting point as the whole list.
  const fixture = createMeasuredSidebar(60, 10, 60, 600);
  fixture.scroller.scrollTop = 1800;

  const walked = await parser.collectSidebarConversations({
    doc: fixture.doc,
    scroller: fixture.scroller,
    sleep: immediate,
    maxRounds: 2000,
    finalSweep: false,
  });

  assert.equal(
    walked.conversations.some((c) => c.id === fixture.ids[0]),
    false,
    'this walk never looked above its starting point'
  );
  assert.equal(walked.complete, false, 'an unobserved head must block completeness');
  assert.ok(
    walked.reason === 'coverage-gap' || walked.reason === 'successor-exists-not-mounted',
    'unexpected reason: ' + walked.reason
  );
});

/**
 * A sidebar paginated by a "Show more" CLICK, as a real Project list is.
 * `pages` is an array of id-batches: the first is rendered, each click reveals
 * the next. Verified against production — one project went 5 → 35 on one click.
 */
/** A paginated sidebar, modelled on the STRUCTURE measured on production
 *  rather than on the control's English label.
 *
 *  Measured under ru-RU: the control is a <button data-sidebar-item> that is the
 *  last <li> of a nested <ul> whose other children are conversation links; it
 *  holds no <a> and no <svg>. `label` is a parameter precisely so the test can
 *  prove the detector is language-blind — the previous fixture hard-coded
 *  'Show more', so it could only ever confirm the English case that shipped.
 */
function createShowMoreSidebar(pages, label) {
  const rowHeight = 10;
  const windowSize = 40;         // tall enough that scrolling alone is not the limit
  let revealed = pages[0].slice();
  let page = 1;

  const scroller = {
    scrollTop: 0,
    clientHeight: windowSize * rowHeight,
    get scrollHeight() { return Math.max(revealed.length, windowSize) * rowHeight; },
    parentElement: null,
  };

  // The nested <ul> holding this project's rows plus the pagination row last.
  const ul = { children: [], querySelectorAll: null };

  const showMoreLi = {
    tagName: 'LI',
    children: [],
    parentElement: ul,
    querySelector(sel) {
      // The pagination row is NOT a conversation row.
      return isConversationLinkSelector(sel) ? null : null;
    },
  };

  const showMoreButton = {
    children: [],
    textContent: label,
    tagName: 'BUTTON',
    getAttribute(name) {
      if (name === 'data-sidebar-item') return 'true';
      if (name === 'href') return null;
      return null;
    },
    querySelector(sel) {
      if (sel === 'a[href]') return null;
      return null;
    },
    querySelectorAll(sel) { return sel === 'svg' ? [] : []; },
    closest(sel) { return sel === 'li' ? showMoreLi : null; },
    parentElement: showMoreLi,
    click() {
      if (page < pages.length) {
        revealed = revealed.concat(pages[page]);
        page += 1;
      }
    },
  };

  function rowsNow() {
    return revealed.map((id) => ({
      getAttribute(name) { return name === 'href' ? '/c/' + id : null; },
      querySelector() { return null; },
      textContent: id,
      parentElement: scroller,
    }));
  }

  // Keep the <ul> consistent with what is revealed: conversation <li>s, then the
  // pagination <li> last for as long as pages remain.
  function refreshUl() {
    const convLis = revealed.map(() => ({ tagName: 'LI', parentElement: ul }));
    ul.children = page < pages.length ? convLis.concat([showMoreLi]) : convLis;
    ul.querySelectorAll = (sel) =>
      isConversationLinkSelector(sel) ? rowsNow() : [];
  }
  refreshUl();

  const doc = {
    querySelectorAll(selector) {
      refreshUl();
      if (selector === 'nav li') return lastBuiltListItems;
      if (isConversationLinkSelector(selector)) {
        // Every revealed row is mounted here, so the deepest one really is last.
        return linkListWithItems(rowsNow(), false);
      }
      // The control's own selector set — it disappears once every page has been
      // revealed, exactly as the real one does.
      if (/button|role="button"/.test(selector)) {
        return page < pages.length ? [showMoreButton] : [];
      }
      return [];
    },
    querySelector(selector) {
      if (!isConversationLinkSelector(selector)) return null;
      const first = revealed[0];
      if (!first) return null;
      return {
        getAttribute(name) { return name === 'href' ? '/c/' + first : null; },
        querySelector() { return null; },
        textContent: first,
        parentElement: scroller,
      };
    },
  };

  return { doc, scroller, total: pages.reduce((n, p) => n + p.length, 0) };
}

// The pagination label is a translated UI string. Both values below were
// MEASURED on production with the same account, only the browser locale
// changed; the third is a language the extension was never tested in, included
// because "add the next literal" is not a fix.
const PAGINATION_LABELS = [
  { locale: 'en-GB', label: 'Show more' },
  { locale: 'ru-RU', label: 'Показать больше' },
  { locale: 'de-DE', label: 'Mehr anzeigen' },
];

for (const { locale, label } of PAGINATION_LABELS) {
  test(`a paginated list is expanded by clicking, not just scrolled [${locale}]`, async () => {
    // Production behaviour: a Project's conversations paginate by a click. No
    // amount of scrolling reaches past the control, so a scroll-only walk stops
    // at a confident subset — the first page — and calls it the whole project.
    const fixture = createShowMoreSidebar([
      ['p1a', 'p1b', 'p1c', 'p1d', 'p1e'],
      ['p2a', 'p2b', 'p2c', 'p2d', 'p2e'],
      ['p3a', 'p3b'],
    ], label);

    const walked = await parser.collectSidebarConversations({
      doc: fixture.doc,
      scroller: fixture.scroller,
      sleep: immediate,
    });

    assert.equal(walked.conversations.length, fixture.total, 'every revealed page must be listed');
    assert.ok(walked.showMoreClicks >= 2, 'the control had to be clicked to reach them');
    assert.equal(walked.complete, true);
  });

  test(`pagination still standing blocks the completeness claim [${locale}]`, async () => {
    // The control is present and clickable, but the budget forbids using it. Rows
    // exist that were never listed, so the walk must not report completeness.
    // This is the failure a language-matched detector produces on EVERY foreign
    // locale: the control is invisible to it, so "none standing" is misread as
    // "no pagination exists" and a partial list ships as complete.
    const fixture = createShowMoreSidebar([
      ['q1a', 'q1b', 'q1c'],
      ['q2a', 'q2b', 'q2c'],
    ], label);

    const walked = await parser.collectSidebarConversations({
      doc: fixture.doc,
      scroller: fixture.scroller,
      sleep: immediate,
      maxShowMoreClicks: 0,
    });

    assert.equal(walked.conversations.length, 3, 'only the first page was reachable');
    assert.equal(walked.complete, false, 'an unexpanded page must not read as complete');
    assert.equal(walked.reason, 'show-more-pending');
  });
}

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

  // The loader releases rows in bursts: `released` grows only every third read,
  // so a round can genuinely add nothing and still be followed by more. Modelled
  // as a shorter LIST rather than an empty DOM or rows from another offset —
  // an empty return starved the tail check, and a shifted offset faked a
  // successor. Both were fixture bugs that made this test measure the wrong thing.
  let reads = 0;
  let released = windowSize;
  const scroller = {
    scrollTop: 0,
    clientHeight: windowSize * rowHeight,
    get scrollHeight() { return Math.max(released, windowSize) * rowHeight; },
    parentElement: null,
  };
  const doc = {
    querySelectorAll(selector) {
      if (selector === 'nav li') return lastBuiltListItems;
      if (!isConversationLinkSelector(selector)) return [];
      reads += 1;
      if (reads % 3 !== 0) released = Math.min(total, released + windowSize);
      const first = Math.floor(scroller.scrollTop / rowHeight);
      const visible = allIds.slice(0, released);
      const rows = visible.slice(first, first + windowSize).map((id) => ({
        getAttribute(name) { return name === 'href' ? '/c/' + id : null; },
        querySelector() { return null; },
        textContent: id,
        parentElement: scroller,
      }));
      return linkListWithItems(rows, first + windowSize < visible.length);
    },
    querySelector() { return null; },
  };

  const walked = await parser.collectSidebarConversations({
    doc, scroller, sleep: immediate,
  });

  assert.equal(walked.conversations.length, total, 'a stalled burst must not end the walk');
  assert.equal(walked.complete, true);
});

/**
 * The invariant, tested in BOTH structural worlds.
 *
 * `liVirtualized: false` — production today: `nav li` outlives the mounted window
 * (813 items against 803 links), so a missing next sibling proves the tail.
 * `liVirtualized: true` — the framework windows the items too. A missing sibling
 * then means "end of window", which is indistinguishable from an unread tail, and
 * the walk must REFUSE to claim completeness rather than assume it.
 */
function createStructuredSidebar(total, mountCap, rowHeight, clientHeight, liVirtualized) {
  const ids = [];
  for (let i = 0; i < total; i++) ids.push('s' + String(i).padStart(3, '0'));
  const scroller = {
    scrollTop: 0,
    clientHeight: clientHeight,
    scrollHeight: total * rowHeight,
    parentElement: null,
  };
  let currentItems = [];
  const doc = {
    querySelectorAll(selector) {
      if (selector === 'nav li') return currentItems;
      if (typeof selector !== 'string' || selector.indexOf('/c/') === -1) return [];
      const firstVisible = Math.floor(scroller.scrollTop / rowHeight);
      const lastVisible = Math.min(
        total - 1,
        Math.ceil((scroller.scrollTop + clientHeight) / rowHeight) - 1
      );
      const last = Math.min(lastVisible, firstVisible + mountCap - 1);
      const links = [];
      for (let i = firstVisible; i <= last; i++) {
        const id = ids[i];
        const relTop = i * rowHeight - scroller.scrollTop;
        links.push({
          getAttribute(name) { return name === 'href' ? '/c/' + id : null; },
          querySelector() { return null; },
          textContent: id,
          parentElement: scroller,
          getBoundingClientRect() {
            return { top: relTop, bottom: relTop + rowHeight, height: rowHeight };
          },
        });
      }
      const items = links.map((link) => {
        const li = {
          tagName: 'LI',
          querySelector(sel) {
            return typeof sel === 'string' && sel.indexOf('/c/') !== -1 ? link : null;
          },
          nextElementSibling: null,
        };
        link.parentElement = li;
        return li;
      });
      for (let i = 0; i < items.length - 1; i++) items[i].nextElementSibling = items[i + 1];
      if (!liVirtualized && last < total - 1 && items.length) {
        items[items.length - 1].nextElementSibling = {
          tagName: 'LI',
          querySelector(sel) {
            return typeof sel === 'string' && sel.indexOf('/c/') !== -1 ? { pending: true } : null;
          },
          nextElementSibling: null,
        };
      }
      currentItems = liVirtualized
        ? items.slice()
        : items.concat([{ tagName: 'LI', querySelector() { return null; }, nextElementSibling: null }]);
      return links;
    },
    querySelector() { return null; },
  };
  return { doc, scroller, ids };
}

test('THE INVARIANT: a row missed is never reported as a complete list', async () => {
  // The one guarantee the whole walk exists to provide. Missing rows is
  // survivable — the caller warns and the user re-runs. Missing rows while
  // claiming completeness is not: the user cannot detect a conversation that was
  // never listed, so a silent subset is unfalsifiable for them.
  let scenariosWithLoss = 0;

  // Both code paths: the in-loop verdict AND the post-sweep one. Testing only the
  // default path left the in-loop decision unguarded — a mutant that dropped the
  // tail requirement there survived, and with `finalSweep: false` it reported
  // `complete: true` with 6 rows missing.
  for (const finalSweep of [true, false]) {
  for (const liVirtualized of [false, true]) {
    for (const mountCap of [10, 8, 4, 1]) {
      const fixture = createStructuredSidebar(60, mountCap, 60, 600, liVirtualized);
      const walked = await parser.collectSidebarConversations({
        doc: fixture.doc,
        scroller: fixture.scroller,
        sleep: immediate,
        maxRounds: 3000,
        finalSweep: finalSweep,
      });

      const missed = fixture.ids.filter(
        (id) => !walked.conversations.some((c) => c.id === id)
      ).length;
      const label = 'finalSweep=' + finalSweep +
        ' liVirtualized=' + liVirtualized + ' mountCap=' + mountCap;

      if (missed > 0) {
        scenariosWithLoss += 1;
        assert.equal(
          walked.complete, false,
          label + ': ' + missed + ' rows missed, so complete must be false'
        );
      }
      // A complete read in the ambiguous world may be refused (fail-closed is the
      // safe direction), but it must NEVER be claimed when rows are missing.
      if (missed === 0 && !liVirtualized && finalSweep) {
        assert.equal(walked.complete, true, label + ': a full read must be reported complete');
      }
    }
  }
  }

  assert.ok(scenariosWithLoss > 0, 'no loss scenario reproduced — this test proves nothing');
});

test('an unprovable tail is refused, not assumed', async () => {
  // Windowed list items: "no next sibling" means "end of window", which an unread
  // tail looks exactly like. The walk must say it cannot tell.
  const fixture = createStructuredSidebar(60, 4, 60, 600, true);
  const walked = await parser.collectSidebarConversations({
    doc: fixture.doc,
    scroller: fixture.scroller,
    sleep: immediate,
    maxRounds: 3000,
  });

  assert.equal(walked.complete, false);
  assert.equal(walked.reason, 'tail-unprovable');
});

/* ------------------------------------------------------------------------- *
 * The pagination control is identified by STRUCTURE, so the structure it
 * requires must actually be load-bearing. A mutation sweep showed that
 * dropping either requirement (last-in-list, has conversation siblings) left
 * every test green — the detector was wider than anything measured, free to
 * click the wrong sidebar row. These fixtures are the negative controls.
 * ------------------------------------------------------------------------- */

/** Build one sidebar button in a list, with full control over the structure. */
function paginationCandidate({ label, isLast, convSiblings, ownHref, holdsAnchor, isConvRow }) {
  const ul = { children: [], querySelectorAll: null };
  const li = {
    tagName: 'LI',
    parentElement: ul,
    querySelector(sel) {
      if (isConversationLinkSelector(sel)) return isConvRow ? { href: '/c/x' } : null;
      return null;
    },
  };
  const button = {
    children: [],
    textContent: label,
    tagName: 'BUTTON',
    getAttribute(name) {
      if (name === 'data-sidebar-item') return 'true';
      if (name === 'href') return ownHref || null;
      return null;
    },
    querySelector(sel) {
      if (sel === 'a[href]') return holdsAnchor ? { href: '/c/y' } : null;
      return null;
    },
    closest(sel) { return sel === 'li' ? li : null; },
    parentElement: li,
    click() {},
  };
  const others = [];
  for (let i = 0; i < 3; i++) others.push({ tagName: 'LI', parentElement: ul });
  ul.children = isLast ? others.concat([li]) : [li].concat(others);
  ul.querySelectorAll = (sel) =>
    isConversationLinkSelector(sel)
      ? Array.from({ length: convSiblings }, () => ({
          getAttribute: (n) => (n === 'href' ? '/c/sib' : null),
        }))
      : [];
  const doc = {
    querySelectorAll(sel) {
      if (/button|role="button"/.test(sel)) return [button];
      return [];
    },
    querySelector() { return null; },
  };
  return { doc, button };
}

test('pagination control must be the LAST item of its list', () => {
  // A row in the middle of the list is a conversation or a header, not the
  // "reveal the rest" affordance. Measured on production: idxInUl 5 of ulSize 6.
  const good = paginationCandidate({
    label: 'Показать больше', isLast: true, convSiblings: 5,
  });
  assert.equal(parser.findShowMoreControl(good.doc), good.button,
    'the last item with conversation siblings IS the control');

  const midList = paginationCandidate({
    label: 'Показать больше', isLast: false, convSiblings: 5,
  });
  assert.equal(parser.findShowMoreControl(midList.doc), null,
    'a mid-list row must not be clicked as pagination');
});

test('pagination control must sit among conversation rows', () => {
  // Measured on production: the control's <ul> also holds the project's
  // conversation links (siblingConvLinks 5). A list with none is some other
  // menu — clicking it navigates away instead of revealing rows.
  const noSiblings = paginationCandidate({
    label: 'Показать больше', isLast: true, convSiblings: 0,
  });
  assert.equal(parser.findShowMoreControl(noSiblings.doc), null,
    'a last item with no conversation siblings is not pagination');
});

test('a conversation row is never mistaken for pagination', () => {
  // Both other discriminators: the control holds no <a> and has no href of its
  // own, while a conversation row is a link.
  const asLink = paginationCandidate({
    label: 'Показать больше', isLast: true, convSiblings: 5, ownHref: '/c/zzz',
  });
  assert.equal(parser.findShowMoreControl(asLink.doc), null,
    'an element with its own href is a link, not the control');

  const wrapsLink = paginationCandidate({
    label: 'Показать больше', isLast: true, convSiblings: 5, holdsAnchor: true,
  });
  assert.equal(parser.findShowMoreControl(wrapsLink.doc), null,
    'an element wrapping an anchor is a row, not the control');

  const convRow = paginationCandidate({
    label: 'Кадры решают всё', isLast: true, convSiblings: 5, isConvRow: true,
  });
  assert.equal(parser.findShowMoreControl(convRow.doc), null,
    'a list item that IS a conversation row is not the control');
});
