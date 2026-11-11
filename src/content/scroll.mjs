import { extractTurn } from './turns.mjs';

function findScrollContainer(startElement) {
  let current = startElement ? startElement.parentElement : null;
  while (current) {
    const style = getComputedStyle(current);
    if (/(auto|scroll|overlay)/.test(style.overflowY) && current.scrollHeight > current.clientHeight + 1) {
      return current;
    }
    current = current.parentElement;
  }
  if (typeof document === 'undefined') return null;
  return document.scrollingElement || document.documentElement;
}

// ChatGPT's app shell uses column-reverse: native scrollTop is 0 at the
// bottom and negative at the start. Keep the scanner's coordinates increasing
// from the start on both layouts. Measured on 2026-09-27: 6951px content in
// an 802px viewport, native bottom 0 and native start about -6149px.
function reverseConversationScroll(target) {
  const view = target.ownerDocument && target.ownerDocument.defaultView;
  const style =
    view && view.getComputedStyle
      ? view.getComputedStyle(target)
      : typeof getComputedStyle === 'function'
        ? getComputedStyle(target)
        : null;
  return !!style && style.flexDirection === 'column-reverse';
}

function conversationScrollMax(target) {
  return Math.max(0, target.scrollHeight - target.clientHeight);
}

function conversationScrollTop(target) {
  return reverseConversationScroll(target) ? target.scrollTop + conversationScrollMax(target) : target.scrollTop;
}

function nativeConversationScrollTop(target, top) {
  const maxTop = conversationScrollMax(target);
  const logicalTop = Math.max(0, Math.min(top, maxTop));
  return reverseConversationScroll(target) ? logicalTop - maxTop : logicalTop;
}

function waitForScrollPosition(target, requestedTop, behavior, timeoutMs) {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise(function (resolve, reject) {
    const startedAt = Date.now();
    let stableFrames = 0;
    let previousTop = target.scrollTop;
    let lastReachableTop = nativeConversationScrollTop(target, requestedTop);
    function check() {
      const reachableTop = nativeConversationScrollTop(target, requestedTop);
      const targetChanged = Math.abs(reachableTop - lastReachableTop) >= 1;
      if (targetChanged) {
        lastReachableTop = reachableTop;
        target.scrollTo({ top: reachableTop, behavior: behavior });
      }
      const currentTop = target.scrollTop;
      // Only reset stability when scrollTop is actively moving, not when
      // scrollHeight merely grows (content still loading — images, lazy renders).
      const topMoved = Math.abs(currentTop - previousTop) >= 1;
      if (!topMoved) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
      }
      if (Math.abs(currentTop - reachableTop) < 2 && stableFrames >= 2) return resolve();
      if (Date.now() - startedAt >= timeoutMs) {
        return reject(new Error('Conversation scroll did not settle before timeout.'));
      }
      previousTop = currentTop;
      requestAnimationFrame(check);
    }
    requestAnimationFrame(check);
  });
}

async function scrollToConversationPosition(target, top, behavior) {
  const expectedTop = nativeConversationScrollTop(target, top);
  target.scrollTo({ top: expectedTop, behavior: behavior });
  try {
    await waitForScrollPosition(target, top, behavior, 8000);
  } catch (_e) {
    // Smooth scroll didn't settle — force instant jump to target so we
    // don't start scanning from mid-conversation. Then wait for the DOM.
    target.scrollTo({ top: nativeConversationScrollTop(target, top), behavior: 'auto' });
    await new Promise(function (r) {
      return setTimeout(r, 1500);
    });
  }
}

/**
 * Drive the conversation to its true beginning, and report whether it arrived.
 *
 * A single scroll to 0 does not reach the top of a virtualized conversation that
 * loads its history in chunks. Measured on a live thread: `scrollTo(0,'smooth')`
 * settled at 2850 of 0 while `scrollHeight` SHRANK 6900 -> 5750 mid-flight (the
 * virtualizer unmounted the turns above), and the scan then walked down from the
 * middle. The export carried 26KB of a 126KB conversation, with only the last
 * turn's attachment, and the top of the thread — where the files were offered —
 * was never mounted once.
 *
 * The document does not merely settle, it GROWS: across one measured run the
 * height went 6900 -> 53335 -> 55775, roughly 8x, as older messages arrived.
 * Each arrival moves the position again, which is why one jump plus a fixed wait
 * cannot work. Two other strategies were measured on the same page and failed:
 * smooth-then-jump ended at 46368, and climbing a screen at a time at 48988.
 * Repeated jumps to 0 arrived in 4 steps and held.
 *
 * Arrival needs BOTH conditions, because either alone lies: position 0 on a
 * thread that is still prepending history is not the beginning, and a steady
 * first turn while the page sits at 40000 is just a stalled scroll.
 *
 * THE DEFECT THAT BOTH OF THOSE STILL ALLOWED, and what replaced them
 * (measured 2026-09-14 by running this very function against a simulated
 * virtualized page, so the network delay is exact rather than incidental):
 *
 *     delay of the history fetch   turns lost, silently
 *       1000 ms                      0
 *       1200 ms                      0
 *       1300 ms                     12       <- threshold
 *       1700 ms                    132 of 142
 *
 * The threshold is not a coincidence, it is this function's own arithmetic:
 * stableRounds(3) x settleMs(400) = 1200 ms. A history fetch slower than that
 * looks EXACTLY like the end of the conversation — the first turn id does not
 * change because the next page has not arrived yet, and scrollTop is already 0
 * because ChatGPT holds the viewport still while prepending. Both "arrival"
 * conditions are satisfied by a page that is merely waiting for the network.
 * A user on a slow link lost 299 lines (11%) of a real conversation this way,
 * with no partial notice, because silence was read as completion.
 *
 * So arrival is no longer inferred from silence. It is a POSITIVE FACT:
 *
 *     the first mounted turn sits in the container the page itself marks as
 *     the root of pagination — data-turn-id-container="paginated-root:<id>"
 *
 * Absence of that fact means "keep climbing", however long the silence lasts,
 * which is precisely what a slow connection needs. The timing constants remain
 * only as the fallback for a page that never exposes the marker (a layout
 * change, an A/B variant), and that fallback is reported separately so it can
 * never be mistaken for a confirmed arrival.
 */
async function scrollToConversationStart(container, options) {
  const opts = options || {};
  const sleep =
    opts.sleep ||
    function (ms) {
      return new Promise(function (r) {
        return setTimeout(r, ms);
      });
    };
  const scrollTo = opts.scrollTo || scrollToConversationPosition;
  const readFirstTurn =
    opts.readFirstTurn ||
    function (target) {
      return target.querySelector ? target.querySelector('[data-turn-id]') : null;
    };
  const readFirstTurnId =
    opts.readFirstTurnId ||
    function (target) {
      const first = readFirstTurn(target);
      return first && first.getAttribute ? first.getAttribute('data-turn-id') : null;
    };
  // Live measurement: paging stalled at 71 and 91 containers while the
  // sentinel stayed visible. Leaving the viewport and returning loaded ten
  // more each time. At the actual beginning (221 containers), the sentinel
  // disappeared. Mounted sections and their relative test indices are NOT a
  // history count: empty height-preserving containers represent unmounted turns.
  const readPagination =
    opts.readPagination ||
    function (target) {
      if (!target.querySelector || !target.querySelectorAll) return null;
      const candidate = target.querySelector('[data-testid="conversation-pagination-sentinel"]');
      const sentinel =
        candidate &&
        candidate.getAttribute &&
        candidate.getAttribute('data-testid') === 'conversation-pagination-sentinel'
          ? candidate
          : null;
      const root = target.querySelector('[data-turn-id-container="client-created-root"]');
      const paginatedRoot = target.querySelector('div[data-turn-id-container^="paginated-root:"]');
      // A freshly navigated page used client-created-root; the same conversation
      // after export used an EMPTY paginated-root sibling. Neither root has to
      // contain the first turn. The first real holder below it must do so.
      const knownLayout =
        (root && root.getAttribute && root.getAttribute('data-turn-id-container') === 'client-created-root') ||
        (paginatedRoot &&
          paginatedRoot.tagName === 'DIV' &&
          paginatedRoot.getAttribute('data-turn-id-container').indexOf('paginated-root:') === 0 &&
          !paginatedRoot.querySelector('[data-turn-id]'));
      if (!sentinel && !knownLayout) return null;
      const holders = Array.from(target.querySelectorAll('div[data-turn-id-container]')).filter(function (el) {
        const id = el.getAttribute('data-turn-id-container');
        return id && id !== 'client-created-root' && id.indexOf('paginated-root') !== 0;
      });
      const first = readFirstTurn(target);
      const held = holders[0] && holders[0].querySelector('[data-turn-id]');
      const atFirstHolder =
        !!first &&
        !!held &&
        (held === first ||
          (!!held.getAttribute('data-turn-id') &&
            held.getAttribute('data-turn-id') === first.getAttribute('data-turn-id')));
      return {
        pending: !!sentinel,
        loading: !!(sentinel && sentinel.querySelector('svg')),
        count: holders.length,
        complete: !sentinel && !!knownLayout && atFirstHolder && conversationScrollTop(target) <= 1,
      };
    };
  // The page's own marker for "nothing exists above this". Measured on a live
  // conversation: exactly one such container among 150, its suffix being the
  // conversation id. Note it is present in the DOM even while scrolled to the
  // bottom, so its EXISTENCE proves nothing — what proves arrival is that the
  // FIRST MOUNTED TURN is the one inside it.
  //
  // The attribute sits on an ANCESTOR of the turn, not on the turn itself.
  // Measured from the live DOM (2026-09-14), the shape is:
  //
  //   <div data-turn-id-container="paginated-root:<conversation id>">
  //     ...
  //     <section data-turn-id="bbb21ebf-…" data-turn-id-container="bbb21ebf-…">
  //
  // Reading it off the `[data-turn-id]` element returns that element's OWN id,
  // never the marker — so the first version of this check could not return true
  // on any real page, and every climb silently fell through to the timing
  // fallback it was written to replace. Worse, the same change had stopped that
  // fallback from flagging a partial export, so a 82%-truncated conversation
  // came out with no notice at all. Walk up instead.
  const markerFromAncestors = function (node) {
    let el = node;
    for (let depth = 0; el && depth < 12; depth += 1) {
      const value = el.getAttribute ? el.getAttribute('data-turn-id-container') : null;
      if (typeof value === 'string' && value.indexOf('paginated-root') === 0) return value;
      el = el.parentElement || null;
    }
    return null;
  };
  const readsAtStart =
    opts.readsAtStart ||
    function (target) {
      const first = readFirstTurn(target);
      if (!first) return false;
      if (markerFromAncestors(first)) return true;
      // The marker may also be a SIBLING container rather than an ancestor: the
      // measured page carried it on a separate div placed before the first turn.
      // Accept it only when the first mounted turn is genuinely the one it marks,
      // which is what `closest`-style walking above cannot see.
      if (!target.querySelector) return false;
      const marked = target.querySelector('[data-turn-id-container^="paginated-root"]');
      if (!marked) return false;
      const inside = marked.querySelector ? marked.querySelector('[data-turn-id]') : null;
      if (!inside) return false;
      // Same NODE is the strongest answer and needs no attribute at all; falling
      // back to the id covers a re-rendered turn. Comparing ids alone would call
      // two attribute-less nodes equal on their shared `null`.
      if (inside === first) return true;
      const a = inside.getAttribute ? inside.getAttribute('data-turn-id') : null;
      const b = first.getAttribute ? first.getAttribute('data-turn-id') : null;
      return !!a && a === b;
    };
  // Whether this page uses the marker mechanism AT ALL. A turn that carries the
  // attribute with some other value is a page where the marker is meaningful and
  // simply has not been reached; a turn with no such attribute is a layout that
  // does not publish one, and no amount of climbing will change that.
  const publishesMarker =
    opts.publishesMarker ||
    function (target) {
      // Asked of the DOCUMENT, not of the first turn: the marker container exists
      // in the page whether or not the climb has reached it, and that is exactly
      // the question here — "does this layout have the mechanism at all".
      if (target.querySelector && target.querySelector('[data-turn-id-container^="paginated-root"]')) {
        return true;
      }
      const first = readFirstTurn(target);
      if (!first || !first.getAttribute) return false;
      return typeof first.getAttribute('data-turn-id-container') === 'string';
    };
  const settleMs = opts.settleMs === undefined ? 400 : opts.settleMs;
  const stableRounds = opts.stableRounds === undefined ? 3 : opts.stableRounds;
  // A FIXED ceiling is a length limit on the conversation wearing a disguise.
  // Measured on the simulator: the climb needs almost exactly one round per
  // three turns (142 -> 45, 600 -> 200), so any constant silently caps the
  // thread it can reach. At a fixed 300 a 1200-turn conversation stopped 290
  // turns short — and 1146 turns is a real size, measured on this operator's
  // own thread. So the budget is DERIVED from the work to be done, and
  // `noProgressRounds` below is what actually ends a hopeless climb.
  //
  // TWO budgets, because "no marker yet" and "no marker ever" are different
  // situations and charging the same wait for both is what made every scan on a
  // marker-less page pay 16.4 seconds for nothing (measured: 41 rounds x 400ms).
  //   - a page that HAS shown the marker shape at least once, or is still
  //     producing history, gets the full patience;
  //   - a page whose first turn never carries the attribute at all is a layout
  //     the marker does not exist in. Waiting cannot make it appear.
  const noProgressRounds = opts.noProgressRounds === undefined ? 40 : opts.noProgressRounds;
  const noMarkerRounds = opts.noMarkerRounds === undefined ? 6 : opts.noMarkerRounds;
  const maxRounds = opts.maxRounds === undefined ? 0 : opts.maxRounds;
  // An UNBOUNDED loop, which is what removing the fixed round ceiling created.
  // Found by mutation testing: a page whose first turn id changes every round
  // while the marker never matches resets the patience budget forever, and the
  // climb never returns — the tab is held open with no export and no error.
  // That is not a contrived shape; a re-rendering list produces it.
  //
  // So the ceiling comes back, but measured in TIME rather than in rounds,
  // because rounds are a length limit on the conversation and seconds are not.
  // The climb spends ~400 ms per round and needs about one round per three
  // turns, so 10 minutes covers roughly 4500 turns — well past the longest
  // thread measured here (1146) and past the 3000-turn simulator run, which
  // completes in 1000 rounds. A climb still making progress at that point is
  // pathological, and stopping it yields a FLAGGED partial export rather than
  // a tab that never answers.
  const maxClimbMs = opts.maxClimbMs === undefined ? 600000 : opts.maxClimbMs;
  const clock =
    opts.now ||
    (typeof Date !== 'undefined'
      ? Date.now
      : function () {
          return 0;
        });
  const startedAt = clock();

  const countTurns =
    opts.countTurns ||
    function (target) {
      const all = target.querySelectorAll ? target.querySelectorAll('[data-turn-id]') : [];
      return all.length || 0;
    };

  let steady = 0;
  let previousFirstId = null;
  let rounds = 0;
  let confirmed = false;
  let confirmedByPagination = false;
  let sawPagination = false;
  // Progress is measured by the climb producing NEW history, not by time.
  let sinceProgress = 0;
  let bestFirstId = null;
  let seenTurnIds = 0;
  let ranOutOfTime = false;
  for (let i = 0; maxRounds === 0 || i < maxRounds; i += 1) {
    rounds = i + 1;
    await scrollTo(container, 0, 'auto');
    await sleep(settleMs);

    const pagination = readPagination(container);
    if (pagination) sawPagination = true;
    if (pagination && pagination.complete) {
      confirmed = true;
      confirmedByPagination = true;
      break;
    }
    // A live pagination sentinel takes precedence over legacy root markers.
    if (!(pagination && pagination.pending) && readsAtStart(container)) {
      confirmed = true;
      break;
    }

    const firstId = readFirstTurnId(container);
    const mounted = pagination ? pagination.count : countTurns(container);
    // A new first turn, or more turns mounted, means history is still arriving:
    // the climb is working and must not be cut off, however long it takes.
    if (firstId !== bestFirstId || mounted > seenTurnIds) {
      sinceProgress = 0;
      bestFirstId = firstId;
      if (mounted > seenTurnIds) seenTurnIds = mounted;
    } else {
      sinceProgress += 1;
    }

    const atTop = conversationScrollTop(container) <= 1;
    steady = atTop && firstId === previousFirstId ? steady + 1 : 0;
    previousFirstId = firstId;
    // The silence fallback no longer ENDS the climb — it only records that the
    // old conditions were met. Stopping here is what lost 132 turns of 142.
    //
    // What DOES end it is a climb that stopped producing history entirely.
    // At the default 400 ms settle the full budget is 16 seconds of no new turn
    // and no new first id, an order of magnitude over the slowest fetch measured
    // (8 s, which the climb survived with zero loss). A page that publishes no
    // marker at all settles for far less: there is nothing to wait for.
    const budget = sawPagination || publishesMarker(container) ? noProgressRounds : noMarkerRounds;
    if (sinceProgress >= budget) break;
    // The backstop. Deliberately checked LAST, so a climb that would finish on
    // its own always does; this only catches the loop that never would.
    if (maxClimbMs > 0 && clock() - startedAt >= maxClimbMs) {
      ranOutOfTime = true;
      break;
    }
    // Re-arm an edge-triggered sentinel instead of repeatedly assigning the
    // same top position. Do not disturb an in-flight request. Two viewport
    // heights clear the sentinel; the next round re-enters it. This movement
    // never resets the no-progress or elapsed-time budgets.
    if (pagination && pagination.pending && !pagination.loading && sinceProgress >= 2 && atTop) {
      await scrollTo(container, Math.min(container.clientHeight * 2, conversationScrollMax(container)), 'auto');
      await sleep(settleMs);
    }
  }

  // Reported rather than thrown: a scan that starts below the beginning is still
  // worth running, and the coverage-gap check turns it into a visible partial
  // export. Failing here would trade a flagged partial for nothing at all.
  //
  // `confirmed` is the marker; `quiet` is the old timing guess. They are kept
  // apart on purpose — collapsing them is exactly how a wait for the network
  // came to be reported as a complete conversation.
  return {
    reachedTop: confirmed,
    confirmedByMarker: confirmed && !confirmedByPagination,
    confirmedByPagination: confirmedByPagination,
    quietedWithoutMarker: !confirmed && steady >= stableRounds,
    // Whether the page has the marker mechanism at all. Only a page WITHOUT one
    // may treat a quiet climb as good enough; a page that has one and did not
    // reach it is a truncated export and must say so.
    // A climb cut off by the clock is ALWAYS incomplete, whatever the page's
    // markup does — so it must never qualify for the marker-less exemption.
    markerAbsentFromPage: !ranOutOfTime && !sawPagination && !publishesMarker(container),
    ranOutOfTime: ranOutOfTime,
    rounds: rounds,
  };
}

function waitForRenderQuiet(target) {
  if (typeof MutationObserver === 'undefined') return Promise.resolve();
  return new Promise(function (resolve) {
    let quietTimer;
    const finish = function () {
      clearTimeout(quietTimer);
      clearTimeout(maxTimer);
      observer.disconnect();
      resolve();
    };
    const schedule = function () {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(finish, 120);
    };
    const observer = new MutationObserver(schedule);
    const maxTimer = setTimeout(finish, 2000);
    observer.observe(target, { childList: true, subtree: true, attributes: true });
    schedule();
  });
}

function createScanSettings(options) {
  const supplied = options || {};
  return {
    readSections:
      supplied.readSections ||
      function (target) {
        return target.querySelectorAll('[data-turn-id]');
      },
    extractTurn: supplied.extractTurn || extractTurn,
    // Called at every scroll position the scan holds, after the turns there
    // have mounted. Used to read per-turn artefact rows while their turn
    // exists — they are unmounted again as soon as the scan moves on.
    onMounted: supplied.onMounted || null,
    settle: supplied.settle || waitForRenderQuiet,
    scrollTo: supplied.scrollTo || scrollToConversationPosition,
    // Injectable so a fixture can drive the arrival-detection directly.
    scrollToStart:
      supplied.scrollToStart ||
      function (target) {
        return scrollToConversationStart(target, { scrollTo: supplied.scrollTo });
      },
    now:
      supplied.now ||
      function () {
        return Date.now();
      },
    stablePasses: supplied.stablePasses || 3,
    // How many times a turn may mount empty before it stops blocking the scan.
    emptyTurnRetries: supplied.emptyTurnRetries || 3,
    // The ONLY limit on a scan: consecutive steps that neither surface a new
    // turn nor move down the document. See scanTurns.
    noProgressSteps: supplied.noProgressSteps || 60,
    // How long the scan holds position waiting for outstanding turns to paint
    // before writing them off and moving on. Must be well below
    // noProgressSteps, or the hold itself trips the stall guard.
    holdReleaseSteps: supplied.holdReleaseSteps || 20,
    // Optional operator cancellation. Returning true aborts at the next step
    // boundary; the scan is never cut off by anything else.
    isCancelled:
      supplied.isCancelled ||
      function () {
        return false;
      },
    scanMeta: supplied.scanMeta || null,
    // Optional progress reporting, so a long scan is visibly alive.
    onProgress: supplied.onProgress || null,
    // Test-only escape hatch. Production never sets this: a step ceiling is a
    // length limit on the conversation, not a safety property.
    maxSteps: supplied.maxSteps || 0,
  };
}

export {
  conversationScrollMax,
  conversationScrollTop,
  createScanSettings,
  findScrollContainer,
  nativeConversationScrollTop,
  reverseConversationScroll,
  scrollToConversationPosition,
  scrollToConversationStart,
  waitForRenderQuiet,
  waitForScrollPosition,
};
