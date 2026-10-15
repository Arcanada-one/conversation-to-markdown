import {
  findCollapsedProjectRows,
  findHistoryRetryControl,
  findShowMoreControl,
  findSidebarScroller,
  listSidebarConversations,
} from './sidebar-rows.mjs';

/**
 * Enumerate EVERY conversation in the sidebar, scrolling to force virtualized
 * rows to mount, and report whether the end of the list was reached.
 *
 * Returns { conversations, complete, reason }. `complete` is false when the
 * walk ran out of rounds while rows were still arriving, or when the list is
 * scrollable but no scroll container could be found — in both cases the caller
 * holds a SUBSET and must not present it as the whole Project. A subset that
 * silently reports success is unfalsifiable for the user: they have nothing to
 * compare the export against.
 */
/** Wait out a rate-limit Retry, in slices so cancellation is visible.
 *  A single 60s timer would ignore Stop until it fired. */
async function sleepUnlessRateLimitedCancelled(sleep, ms) {
  let left = ms > 0 ? ms : 0;
  while (left > 0) {
    try {
      if (typeof window !== 'undefined' && window.__c2mScan && window.__c2mScan.cancelled) return false;
    } catch (_e) {
      /* a missing window is not a cancel */
    }
    const step = Math.min(left, 1000);
    await sleep(step);
    left -= step;
  }
  return true;
}

async function collectSidebarConversations(options) {
  const supplied = options || {};
  const doc = supplied.doc || (typeof document !== 'undefined' ? document : null);
  const maxRounds = supplied.maxRounds || 200;
  const settleMs = supplied.settleMs || 250;
  // Consecutive rounds that must add nothing AND move nothing before the walk
  // is judged finished. Only consulted once the viewport is already at the
  // bottom, so this is what absorbs a lazy loader that appends after a pause.
  const quietRounds = supplied.quietRounds || 3;
  // Fraction of the viewport to advance per round. Below 1 on purpose: the
  // overlap is what guarantees no band of rows is stepped over unobserved.
  const scrollStepRatio = supplied.scrollStepRatio || 0.5;
  // A bound on "Show more" expansions, so a control that reappears without ever
  // revealing anything cannot spin the walk forever.
  const maxShowMoreClicks = supplied.maxShowMoreClicks === undefined ? 60 : supplied.maxShowMoreClicks;
  // Revealing a page is a network round-trip; it needs longer than a scroll.
  const showMoreSettleMs = supplied.showMoreSettleMs || 1200;
  // Same wait as the popup's RATE_LIMIT_RETRY_WAIT_MS. Recovery was not
  // measured on 2026-10-14; the page shows a Retry button and no countdown.
  // Kept here because this walk runs in the page, not the popup.
  const rateLimitWaitMs = supplied.rateLimitWaitMs == null ? 60000 : supplied.rateLimitWaitMs;
  const maxHistoryRetryClicks = supplied.maxHistoryRetryClicks == null ? 5 : supplied.maxHistoryRetryClicks;
  // Projects start collapsed; opening one is a click plus a fetch.
  const expandProjects = supplied.expandProjects !== false;
  const maxProjectExpansions = supplied.maxProjectExpansions === undefined ? 40 : supplied.maxProjectExpansions;
  const projectSettleMs = supplied.projectSettleMs || 1400;
  // A final re-read pass: rows keep mounting behind the downward walk.
  const finalSweep = supplied.finalSweep !== false;
  const maxSweepPasses = supplied.maxSweepPasses === undefined ? 6 : supplied.maxSweepPasses;
  const sleep =
    supplied.sleep ||
    function (ms) {
      return new Promise(function (resolve) {
        setTimeout(resolve, ms);
      });
    };

  const byId = new Map();
  // Height of the band of rows actually MOUNTED in the last read, measured from
  // the rows themselves. The step must never exceed this: stepping by the
  // viewport when the virtualizer mounts a shorter band jumps over rows that
  // were never in the DOM, and the walk still finishes at the bottom looking
  // complete. Measured, not assumed.
  let mountedBand = 0;
  // Vertical spans, in DOCUMENT space, over which rows were actually observed.
  // Completeness is then a measurable property — "the observed spans cover the
  // scrollable range" — instead of an inference from the walk having gone quiet.
  // Quiescence cannot distinguish "the list ended" from "I stopped looking".
  const coveredSpans = [];
  // Offsets the walk actually READ at. Coverage of the rows proves no band was
  // stepped over; these prove the sweep reached both ends of the scroller.
  let visitedTop = false;
  let visitedBottom = false;
  // Where the LIST begins and ends in document space, learned from the rows seen
  // at the very top and the very bottom. The scroller's own 0..scrollHeight is the
  // wrong reference: it includes the sidebar's header and trailing padding.
  let listTop = Infinity;
  let listBottom = -Infinity;
  function recordCoverage(scrollTop) {
    if (!doc || !doc.querySelectorAll) return 0;
    let links;
    try {
      // Same shape as the enumerator: measuring only `/c/…` rows would ignore
      // every project conversation and read their band as an unobserved gap.
      links = doc.querySelectorAll('nav a[href*="/c/"]');
    } catch (_e) {
      return 0;
    }
    let top = Infinity;
    let bottom = -Infinity;
    let measured = 0;
    for (const link of links) {
      if (!link || typeof link.getBoundingClientRect !== 'function') continue;
      let rect;
      try {
        rect = link.getBoundingClientRect();
      } catch (_e) {
        continue;
      }
      if (!rect) continue;
      const rTop = typeof rect.top === 'number' ? rect.top : 0;
      const rBottom = typeof rect.bottom === 'number' ? rect.bottom : rTop;
      if (rBottom <= rTop) continue;
      top = Math.min(top, rTop);
      bottom = Math.max(bottom, rBottom);
      measured += 1;
    }
    if (!measured || bottom <= top) return 0;
    // Viewport-relative rects become document-relative by adding the offset the
    // rows were read at.
    coveredSpans.push([top + scrollTop, bottom + scrollTop]);
    return bottom - top;
  }

  /** True when no band BETWEEN observed rows went unobserved.
   *
   *  Interior holes only. The extremes are NOT checked here: every bound this
   *  function could use (`listTop`, `listBottom`, row pitch) is derived from rows
   *  that mounted, so a row which never mounted moves no bound and the comparison
   *  becomes a tautology. Measured: `reach >= listBottom - 2` could not fail for
   *  ANY mount budget, because at the terminal offset the deepest mounted row IS
   *  the row defining `listBottom`. The tail is proven separately, by an
   *  obligation the collected rows cannot discharge — see `tailIsProven`. */
  function coverageIsContiguous() {
    if (!coveredSpans.length) return false;
    const spans = coveredSpans.slice().sort(function (a, b) {
      return a[0] - b[0];
    });
    // A hairline, never a mounted band: the band is exactly the distance a
    // stepped-over row could hide in.
    const slack = 2;
    let reach = spans[0][1];
    for (let i = 1; i < spans.length; i++) {
      if (spans[i][0] > reach + slack) return false;
      reach = Math.max(reach, spans[i][1]);
    }
    return true;
  }

  /** The list item containing a conversation row. */
  function rowListItem(link) {
    let current = link;
    for (let depth = 0; depth < 6 && current; depth++) {
      if (current.tagName && current.tagName.toUpperCase() === 'LI') return current;
      current = current.parentElement;
    }
    return null;
  }

  /** Is the deepest row we captured genuinely the LAST one in the list?
   *
   *  Answered by the DOM's own structure rather than by our observations: if the
   *  deepest captured row's list item has a following sibling, a row exists past
   *  everything we collected and the walk has NOT finished — no matter how neatly
   *  its coverage adds up. This is an obligation the collected rows cannot
   *  discharge themselves, which is precisely why it works where geometry did not.
   *
   *  Fails CLOSED on ambiguity: if the rows carry no list-item structure, a null
   *  sibling means "cannot tell", not "proven", and completeness is refused.
   *  Verified on production that the structure does persist (813 `nav li` against
   *  803 mounted links), but a framework that virtualized the items away too would
   *  otherwise turn "cannot tell" into a silent false success. */
  /** Does the list keep `li` structure for rows the window has NOT mounted?
   *
   *  Measured, not assumed: more list items than mounted conversation rows means
   *  the framework leaves the items in place, so a missing next sibling really
   *  does mean "end of list". Production: 813 items against 803 links. When the
   *  counts match, the structure is windowed exactly like the links and proves
   *  nothing — the caller must then refuse to claim completeness. */
  function structurePersistsPastWindow() {
    try {
      const items = doc.querySelectorAll('nav li').length;
      const rows = doc.querySelectorAll('nav a[href*="/c/"]').length;
      return items > rows;
    } catch (_e) {
      return false;
    }
  }

  function tailIsProven() {
    if (!doc || !doc.querySelectorAll) return { proven: false, reason: 'no-document' };
    let links;
    try {
      links = Array.from(doc.querySelectorAll('nav a[href*="/c/"]'));
    } catch (_e) {
      return { proven: false, reason: 'query-failed' };
    }
    if (!links.length) return { proven: false, reason: 'no-rows-mounted' };

    const items = links.map(rowListItem).filter(Boolean);
    if (!items.length) {
      // No structural anchor to reason about — refuse rather than assume.
      return { proven: false, reason: 'tail-unprovable' };
    }
    const deepest = items[items.length - 1];
    const next = deepest.nextElementSibling;
    if (!next) {
      // No successor. That proves the tail ONLY if the list keeps structure for
      // rows beyond the mounted window — otherwise "no next sibling" means "the
      // window ends here", which is exactly what an unread tail also looks like.
      // Production keeps it (813 `nav li` against 803 mounted links), but a
      // framework that virtualized the items away too would turn "cannot tell"
      // into a silent success, so the ambiguous case is refused.
      return structurePersistsPastWindow()
        ? { proven: true, reason: 'deepest-row-is-last-sibling' }
        : { proven: false, reason: 'tail-unprovable' };
    }
    let nextHasRow = false;
    try {
      nextHasRow = !!(next.querySelector && next.querySelector('a[href*="/c/"]'));
    } catch (_e) {
      nextHasRow = false;
    }
    // A following item that holds no conversation row is list chrome (a section
    // heading, the "Show more" row), not an unread conversation.
    return nextHasRow
      ? { proven: false, reason: 'successor-exists-not-mounted' }
      : { proven: true, reason: 'successor-is-not-a-conversation' };
  }

  const scroller = supplied.scroller || findSidebarScroller(doc);

  function absorb() {
    let added = 0;
    const batch = listSidebarConversations(doc);
    for (const conv of batch) {
      if (byId.has(conv.id)) continue;
      byId.set(conv.id, conv);
      added += 1;
    }
    const at = scroller ? scroller.scrollTop || 0 : 0;
    const spanCountBefore = coveredSpans.length;
    mountedBand = recordCoverage(at);
    const newSpan = coveredSpans.length > spanCountBefore ? coveredSpans[coveredSpans.length - 1] : null;
    if (scroller) {
      const maxTop = Math.max(0, (scroller.scrollHeight || 0) - (scroller.clientHeight || 0));
      if (at <= 1) {
        visitedTop = true;
        if (newSpan) listTop = Math.min(listTop, newSpan[0]);
      }
      if (at >= maxTop - 1) {
        visitedBottom = true;
        if (newSpan) listBottom = Math.max(listBottom, newSpan[1]);
      }
    }
    return added;
  }

  absorb();

  // Expand collapsed Projects FIRST. Their conversations do not exist in the DOM
  // until the row is clicked, so scrolling and paginating a sidebar that still
  // has them closed verifies coverage of a list they were never part of.
  let projectsExpanded = 0;
  if (expandProjects) {
    for (let attempt = 0; attempt < maxProjectExpansions; attempt++) {
      const pending = findCollapsedProjectRows(doc);
      if (!pending.length) break;
      let clickedAny = false;
      for (const row of pending) {
        if (projectsExpanded >= maxProjectExpansions) break;
        try {
          row.control.click();
          projectsExpanded += 1;
          clickedAny = true;
          await sleep(projectSettleMs);
          absorb();
        } catch (_e) {
          /* a row that refuses to open is skipped; the walk still runs */
        }
      }
      if (!clickedAny) break;
    }
  }
  let projectsExhausted = findCollapsedProjectRows(doc).length === 0;

  if (!scroller) {
    // The mounted rows may be only one window; no scroller means no proof.
    return {
      conversations: Array.from(byId.values()),
      complete: false,
      reason: 'no-scroll-container',
    };
  }

  const startTop = scroller.scrollTop || 0;
  let quiet = 0;
  let rounds = 0;
  let complete = false;
  let blocked = false;
  let reachedBottom = false;
  // True when the completeness verdict rests on measured coverage rather than on
  // quiescence. Surfaced so a caller can tell a proof from a best guess.
  let coverageVerified = false;
  let showMoreClicks = 0;
  let historyRetryClicks = 0;
  let barrenShowMoreClicks = 0;
  // False when a "Show more" control was still standing at the end of the walk:
  // rows exist that were never listed.
  let showMoreExhausted = true;
  let tailReason = null;

  while (rounds < maxRounds) {
    rounds += 1;
    const maxTop = Math.max(0, (scroller.scrollHeight || 0) - (scroller.clientHeight || 0));
    const before = scroller.scrollTop || 0;
    const heightBefore = scroller.scrollHeight || 0;
    // Step a FRACTION of what was actually observed. Two rules, both learned the
    // hard way: never step further than the band of rows currently mounted (a
    // virtualizer may mount less than a viewport, and the excess is stepped over
    // unseen), and always keep overlap so a partially-visible row at the seam is
    // read by the next round too. When the rows cannot be measured, fall back to
    // the viewport — the pre-measurement behaviour, not a wider guess.
    const reach =
      mountedBand > 0 ? Math.min(mountedBand, scroller.clientHeight || mountedBand) : scroller.clientHeight || 0;
    const step = Math.max(1, Math.floor(reach * scrollStepRatio));
    const nextTop = Math.min(maxTop, before + step);
    try {
      scroller.scrollTop = nextTop;
    } catch (_e) {
      // A scroller whose scrollTop refuses writes cannot be walked. Stop with a
      // reason of its own instead of letting the injected function reject — the
      // caller would otherwise surface "no conversations found — open a Project
      // page", which blames the wrong thing.
      blocked = true;
      break;
    }
    await sleep(settleMs);

    let added = absorb();

    // A "Show more" row means the list is paginated by a click. Scrolling can
    // never reach past it, so a walk that only scrolls stops at a confident
    // subset. Expand it here and count what it reveals as progress.
    // Drain every pending control in this round, not one per round: a long
    // project needs many pages, and the walk otherwise reaches the bottom and
    // stops while pages it never asked for are still hidden. Measured on
    // production: one-per-round found 158 of Aether's 235 conversations.
    // Reset per round: the counter is a guard against one wedged control, not a
    // budget for the whole walk. Left cumulative, two barren clicks anywhere
    // silenced every later "Show more" — which is how a run with five projects
    // expanded only the first one's pages.
    barrenShowMoreClicks = 0;
    while (showMoreClicks < maxShowMoreClicks) {
      const control = findShowMoreControl(doc);
      if (!control || typeof control.click !== 'function') break;
      let clickFailed = false;
      try {
        control.click();
        showMoreClicks += 1;
      } catch (_e) {
        clickFailed = true;
      }
      if (clickFailed) break;
      await sleep(showMoreSettleMs);
      const revealed = absorb();
      added += revealed;
      // A control that keeps reappearing while revealing nothing would spin
      // until the budget ran out. Two barren clicks in a row end the drain; the
      // `maxShowMoreClicks` ceiling remains the outer backstop.
      barrenShowMoreClicks = revealed ? 0 : barrenShowMoreClicks + 1;
      if (barrenShowMoreClicks >= 2) break;
    }
    if (findShowMoreControl(doc)) showMoreExhausted = false;

    // A settled history Retry means the rows below this point were not loaded.
    // Waiting and clicking is what asks for them. Reaching the bottom of the
    // rows that did mount is not the end of the list.
    const historyRetry = findHistoryRetryControl(doc);
    if (historyRetry && historyRetryClicks < maxHistoryRetryClicks) {
      const waited = await sleepUnlessRateLimitedCancelled(sleep, rateLimitWaitMs);
      if (!waited) {
        blocked = true;
        break;
      }
      let clickFailed = false;
      try {
        historyRetry.click();
        historyRetryClicks += 1;
      } catch (_e) {
        clickFailed = true;
      }
      if (!clickFailed) {
        await sleep(settleMs);
        added += absorb();
        quiet = 0;
      }
    }

    const nowTop = scroller.scrollTop || 0;
    const nowMaxTop = Math.max(0, (scroller.scrollHeight || 0) - (scroller.clientHeight || 0));
    const atBottom = nowTop >= nowMaxTop - 1;
    // A list still getting TALLER is still loading, even when this round read no
    // new row: the rows exist but have not mounted yet.
    const stillGrowing = (scroller.scrollHeight || 0) > heightBefore;

    // Progress means a NEW id or the viewport actually moving. scrollHeight
    // merely growing is not progress toward the end — the same lesson the
    // message scanner learned — but it IS evidence the list has not ended,
    // which is why it blocks the completeness verdict below.
    if (added > 0 || Math.abs(nowTop - before) >= 1) {
      quiet = 0;
    } else {
      quiet += 1;
    }

    if (atBottom && added === 0 && !stillGrowing && quiet >= quietRounds) {
      // Quiescence alone is not a coverage proof. When row geometry was
      // measurable, require the observed spans to leave no gap; a gap means rows
      // were stepped over and never mounted, which is precisely the silent
      // subset. Without geometry there is nothing to verify against, so the
      // quiescent verdict stands — the honest limit of what can be known.
      reachedBottom = true;
      // An unexpanded "Show more" still standing means rows exist that were
      // never listed. Reaching the bottom is not reaching the end.
      if (findShowMoreControl(doc)) {
        showMoreExhausted = false;
        complete = false;
        break;
      }
      // With geometry, completeness is VERIFIED: the observed spans must leave
      // no gap across the scrollable range. Without geometry there is nothing to
      // verify against and the verdict falls back to quiescence — which cannot
      // tell "the list ended" from "the loader had not answered yet". That
      // fallback is the known limit of this walk, not a proof.
      coverageVerified = coveredSpans.length > 0;
      // Three independent conditions, none derived from the others: no interior
      // hole, both ends actually visited, and the tail proven by DOM structure.
      const tail = tailIsProven();
      tailReason = tail.reason;
      complete = (coverageVerified ? coverageIsContiguous() : true) && visitedTop && visitedBottom && tail.proven;
      break;
    }
  }

  // One final sweep from the top before concluding. Rows keep mounting behind the
  // walk as the virtualizer settles, and measured on production 28 conversations
  // existed in the DOM that the downward pass never saw. This is a re-read of
  // what is already there, not another expansion pass.
  if (finalSweep && !blocked) {
    // Sweep until a pass adds nothing. A fixed number of passes cannot be right:
    // measured on production the sidebar was still mounting rows after the walk
    // finished (691 in the DOM against 455 listed), so the stopping condition has
    // to be "a full pass found nothing new", not a count chosen in advance.
    for (let pass = 0; pass < maxSweepPasses; pass++) {
      const before = byId.size;
      let position = 0;
      const limit = Math.max(0, (scroller.scrollHeight || 0) - (scroller.clientHeight || 0));
      const sweepStep = Math.max(1, Math.floor((scroller.clientHeight || 1) * scrollStepRatio));
      let guard = 0;
      while (position <= limit && guard < maxRounds) {
        guard += 1;
        try {
          scroller.scrollTop = position;
        } catch (_e) {
          break;
        }
        await sleep(settleMs);
        absorb();
        if (findShowMoreControl(doc)) showMoreExhausted = false;
        if (findCollapsedProjectRows(doc).length) projectsExhausted = false;
        position += sweepStep;
      }
      if (byId.size === before) break;
    }
    // Coverage was re-measured across the whole range, so re-decide on it.
    if (coveredSpans.length) {
      coverageVerified = true;
      const sweptTail = tailIsProven();
      tailReason = sweptTail.reason;
      complete = coverageIsContiguous() && showMoreExhausted && visitedTop && visitedBottom && sweptTail.proven;
    }
  }

  if (findShowMoreControl(doc)) showMoreExhausted = false;
  if (findCollapsedProjectRows(doc).length) projectsExhausted = false;
  if (!showMoreExhausted || !projectsExhausted) complete = false;
  // The history failure is still on the page. The mounted rows are a subset
  // even when their own geometry lines up.
  if (findHistoryRetryControl(doc)) {
    complete = false;
    tailReason = 'history-rate-limited';
  }

  // Put the sidebar back where the user left it.
  try {
    scroller.scrollTop = startTop;
  } catch (_e) {
    /* restoring the view is best-effort; never fail the walk over it */
  }

  let reason;
  if (complete) {
    reason = 'reached-end';
  } else if (tailReason === 'history-rate-limited') {
    reason = tailReason;
  } else if (blocked) {
    reason = 'scroll-blocked';
  } else if (!showMoreExhausted) {
    reason = 'show-more-pending';
  } else if (!projectsExhausted) {
    reason = 'project-expansion-pending';
  } else if (tailReason === 'successor-exists-not-mounted' || tailReason === 'tail-unprovable') {
    // A row exists past everything captured, or the list carries no structure to
    // prove otherwise. Either way the tail is unread, not merely unmeasured.
    reason = tailReason;
  } else if (reachedBottom) {
    // Went quiet at the bottom, but the observed spans had a hole in them: some
    // rows were never mounted where the walk looked.
    reason = 'coverage-gap';
  } else {
    reason = 'round-limit';
  }

  return {
    conversations: Array.from(byId.values()),
    complete: complete,
    reason: reason,
    coverageVerified: coverageVerified,
    showMoreClicks: showMoreClicks,
    projectsExpanded: projectsExpanded,
    tailReason: tailReason,
  };
}

export { collectSidebarConversations };
