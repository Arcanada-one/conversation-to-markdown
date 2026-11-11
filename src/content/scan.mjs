import { extractConversationLegacy } from './button-fetch.mjs';
import {
  conversationScrollMax,
  conversationScrollTop,
  createScanSettings,
  reverseConversationScroll,
} from './scroll.mjs';
import {
  buildConversationMarkdown,
  extractTurn,
  getSectionTurnId,
  isExplicitlyUnsupportedTurn,
  orderCapturedTurns,
} from './turns.mjs';

// Chrome a re-mounted turn shows while its real content is still coming back.
// These are not answers, however long they run.
var PLACEHOLDER_MARKDOWN =
  /^(thinking|reasoning|searching|analyzing|analysing|gathering|expanding|loading|generating|working)\b|^(думаю|размышляю|ищу|загружаю|генерирую)\b/i;

function looksLikePlaceholder(markdown) {
  return PLACEHOLDER_MARKDOWN.test(markdown.trim());
}

/**
 * Decide whether a re-mounted capture should replace the one already held.
 *
 * Length alone is not a correctness rule: a turn re-mounting with placeholder
 * chrome ("Thinking… gathering sources…") can be LONGER than the real prose, and
 * taking the longer string silently corrupts the export. Prefer real content
 * over a placeholder; only then fall back to preferring the longer text, which
 * still rescues a capture truncated mid-stream.
 */
function shouldReplaceCapture(previousMarkdown, candidateMarkdown) {
  const previousIsPlaceholder = looksLikePlaceholder(previousMarkdown);
  const candidateIsPlaceholder = looksLikePlaceholder(candidateMarkdown);
  if (previousIsPlaceholder !== candidateIsPlaceholder) return previousIsPlaceholder;
  return candidateMarkdown.length > previousMarkdown.length;
}

function captureMountedTurns(sections, settings, seen, state) {
  let newIds = 0;
  // The height of the band the virtualizer actually mounted. Measured the same
  // way the sidebar walk measures its rows, and for the same reason: a band
  // narrower than the viewport means a viewport-sized scroll step jumps over
  // turns that were never in the DOM to be read. See `nextScrollTop`.
  let bandTop = Infinity;
  let bandBottom = -Infinity;
  for (const section of sections) {
    if (typeof section.getBoundingClientRect === 'function') {
      try {
        const rect = section.getBoundingClientRect();
        if (rect && typeof rect.top === 'number' && typeof rect.bottom === 'number') {
          if (rect.top < bandTop) bandTop = rect.top;
          if (rect.bottom > bandBottom) bandBottom = rect.bottom;
        }
      } catch (_e) {
        // An element that refuses measurement is simply not measured; the band
        // falls back to the viewport, which is the pre-measurement behaviour.
      }
    }
    if (isExplicitlyUnsupportedTurn(section)) continue;
    const rawTurnId = getSectionTurnId(section);
    if (rawTurnId && !state.observedIds.has(rawTurnId)) {
      state.observedIds.add(rawTurnId);
      newIds += 1;
    }
    const candidate = settings.extractTurn(section, state.discoveryIndex);
    if (!candidate) {
      // A turn can mount before its content paints — ChatGPT's virtualizer
      // recycles bubbles and briefly renders them empty. Give it a bounded
      // number of chances, then stop letting it block the scan: one such turn
      // used to pin `unresolved` above zero forever, which froze the scroll
      // target at the current position and burned the whole budget in place.
      if (rawTurnId) {
        const attempts = (state.emptyAttempts.get(rawTurnId) ?? 0) + 1;
        state.emptyAttempts.set(rawTurnId, attempts);
        if (attempts >= settings.emptyTurnRetries) state.skipped.add(rawTurnId);
      }
      continue;
    }
    if (rawTurnId) {
      // It resolved after all — drop any strike against it.
      state.emptyAttempts.delete(rawTurnId);
      state.skipped.delete(rawTurnId);
    }
    const previous = seen.get(candidate.turnId);
    if (!previous) {
      candidate.discoveryIndex = state.discoveryIndex;
      state.discoveryIndex += 1;
    }
    if (!previous || shouldReplaceCapture(previous.markdown, candidate.markdown)) {
      seen.set(
        candidate.turnId,
        previous ? Object.assign({}, candidate, { discoveryIndex: previous.discoveryIndex }) : candidate
      );
    }
  }
  // Set difference, not a size subtraction: sizes can coincide while a real id
  // is missing, which would report "nothing outstanding" over a genuine gap.
  let unresolved = 0;
  for (const id of state.observedIds) {
    if (!seen.has(id) && !state.skipped.has(id)) unresolved += 1;
  }
  const mountedBand = bandBottom > bandTop ? bandBottom - bandTop : 0;
  return { newIds: newIds, unresolved: unresolved, mountedBand: mountedBand };
}

/** Where to scroll next, never further than the turns that were actually mounted.
 *
 *  A fixed fraction of the VIEWPORT was the defect: with a 400px mounted band in
 *  an 800px viewport the scan captured 30 of 60 turns — every second one — and
 *  reported a complete export, because each step advanced 600px past turns the
 *  virtualizer had never rendered. The sidebar walk already capped its step at
 *  the observed band; this is the same rule for the conversation.
 *
 *  `mountedBand` of 0 means nothing could be measured, and the step falls back
 *  to the viewport — the previous behaviour, not a wider guess.
 *
 *  The `min(band, viewport)` cap is deliberately NOT claimed to be load-bearing.
 *  A mutant that removes it survives, and no geometry — including bands three
 *  viewports tall, weighted above or below the scroll position — could be built
 *  where it changes the outcome: turns in a band taller than the viewport are
 *  already in the DOM and are read in the same round. It is kept as a
 *  conservative bound on a number that comes from ChatGPT's virtualizer rather
 *  than from us, and it is recorded here as unproven so nobody later mistakes it
 *  for a checked invariant.
 */
function nextScrollTop(container, atBottom, mountedBand) {
  if (atBottom) return conversationScrollTop(container);
  const reach =
    mountedBand > 0 ? Math.min(mountedBand, container.clientHeight || mountedBand) : container.clientHeight || 0;
  const increment = Math.max(1, Math.floor(reach * 0.75));
  return Math.min(conversationScrollTop(container) + increment, conversationScrollMax(container));
}

/** The widest stretch between two read positions that neither of them covered.
 *
 *  Each entry is `[scrollTop, mountedBandHeight]` — where the scan read, and how
 *  tall a band of turns was mounted there. Coverage is only credited where turns
 *  actually mounted, and only the stretch BEFORE the last such position is
 *  judged: everything past the final turn is the document's bottom padding, and
 *  counting it as a hole reported a false "partial export" on a complete one.
 *
 *  Two failure modes this catches, both measured:
 *
 *   - the scan advanced further than it mounted, so a stretch between two
 *     positions was stepped over unseen;
 *   - a position mounted nothing at all in the middle of the conversation.
 *
 *  Reaching the bottom is not a coverage proof — this is what turns "I arrived"
 *  into "I saw".
 */
function largestCoverageGap(bands, viewportHeight, documentHeight) {
  if (!bands || bands.length === 0) return { width: 0, at: 0 };
  const sorted = bands.slice().sort(function (a, b) {
    return a[0] - b[0];
  });

  // Everything after the last position that mounted a turn is bottom padding.
  let lastProductive = -1;
  let firstProductive = -1;
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i][1] > 0) {
      if (firstProductive < 0) firstProductive = i;
      lastProductive = i;
    }
  }
  if (lastProductive < 0) return { width: 0, at: 0 };

  let reach = sorted[firstProductive][0] + sorted[firstProductive][1];
  let widest = 0;
  let at = 0;
  for (let i = firstProductive + 1; i <= lastProductive; i += 1) {
    const start = sorted[i][0];
    // A 1px tolerance: scroll positions are fractional in a zoomed or high-DPI
    // viewport, and a sub-pixel seam is not a missing turn.
    if (start > reach + 1) {
      const width = start - reach;
      if (width > widest) {
        widest = width;
        at = reach;
      }
    }
    const end = sorted[i][0] + sorted[i][1];
    if (end > reach) reach = end;
  }

  // The tail case the band-to-band comparison above cannot see: when turns
  // mounted at only a few early positions, there IS no later band to leave a
  // hole against, yet the scan still travelled the rest of the document blind.
  // Measured on a fixture whose band was narrower than the gap between turns:
  // 1 of 40 turns captured, reported complete.
  //
  // The threshold is one viewport, and it is measured rather than tuned. Across
  // every geometry that captured every turn the blind tail was at most 300px
  // (0.38 viewports) — the scan always runs a little past the final turn, which
  // is ordinary. The failing geometry's tail was 11 860px, or 14.8 viewports.
  // Three orders of magnitude separate the two populations, so one viewport sits
  // in empty space between them rather than on a boundary either could cross.
  const traversedTo = sorted[sorted.length - 1][0];
  const seenTo = sorted[lastProductive][0] + sorted[lastProductive][1];
  const blind = traversedTo - seenTo;
  if (viewportHeight > 0 && blind > viewportHeight) {
    if (blind > widest) {
      widest = blind;
      at = seenTo;
    }
  }

  // The case both comparisons above are blind to: the scan STOPPED at the last
  // turn it read, so there is neither a later band to leave a hole against nor
  // any travelled-but-unseen tail. `blind` is then zero or negative and the
  // check above can never fire.
  //
  // That is exactly what a virtualized list produces. While the scan is near the
  // top, ChatGPT has not mounted the turns below, so `scrollHeight` is short;
  // the scan reaches the bottom OF THAT HEIGHT, sees three stable passes and
  // stops — at the last turn it read. Measured on the export that prompted this:
  // 4 of 8 turns, `blind` = -800px, reported complete with no notice.
  //
  // This function cannot see the defect on its own: `bands` says where the scan
  // looked, never how tall the document turned out to be. The caller compares
  // the two and passes `documentHeight`; without it the tail check is unchanged,
  // which keeps every existing caller and test honest.
  if (viewportHeight > 0 && documentHeight > 0) {
    const unreached = documentHeight - traversedTo - viewportHeight;
    if (unreached > viewportHeight && unreached > widest) {
      widest = unreached;
      at = traversedTo;
    }
  }
  return { width: widest, at: at };
}

/** Record that a scan ended before reaching a stable bottom. */
function markPartialScan(settings, reason) {
  if (settings.scanMeta) {
    settings.scanMeta.partial = true;
    // Keep the FIRST reason. A scan that never reached the start also tends to
    // stall later, and overwriting would report the symptom while hiding the
    // cause — the user reads this reason in the artifact itself.
    if (!settings.scanMeta.reason) settings.scanMeta.reason = reason;
  }
}

/** Prefix markdown with a visible partial-export notice — must live in the artifact itself. */
function prefixPartialNotice(md, reason) {
  if (reason === 'history start unverified for this page layout') {
    return (
      '> **Partial export** — history start is unverified for this page layout; earlier messages may be missing.\n\n' +
      md
    );
  }
  var detail =
    reason === 'cancelled' ? 'scan was stopped before reaching the end' : 'scan did not reach the end (' + reason + ')';
  return '> **Partial export** — ' + detail + '.\n\n' + md;
}

async function scanTurns(container, options) {
  const settings = createScanSettings(options);
  const originalNativeScrollTop = container.scrollTop;
  const seen = new Map();
  const state = {
    discoveryIndex: 0,
    observedIds: new Set(),
    // Turns that mounted but never yielded content, and how many tries each got.
    emptyAttempts: new Map(),
    skipped: new Set(),
  };
  let stablePasses = 0;
  let lastHeight = -1;
  // Where the scan actually READ, and how tall a band it read there. Reaching
  // the bottom proves coverage only if these bands, joined together, leave no
  // gap: a scan that advances further than it mounts crawls to the end past
  // turns that were never in the DOM, and "I arrived" is not "I saw". Same
  // reasoning the sidebar walk applies to its rows — quiescence is not a
  // coverage proof.
  const readBands = [];
  const startedAt = settings.now();
  // Progress is measured in work done, not time elapsed. A scan that keeps
  // surfacing turns or keeps moving down the document is healthy however long
  // it runs — a 100-hour conversation is a long job, not a failure. The only
  // way a scan ends unsuccessfully is by genuinely stalling, or by the operator
  // cancelling it. There is deliberately no deadline and no step ceiling: both
  // are limits on conversation LENGTH wearing the costume of a safety check,
  // and raising the constant only moves the wall further out.
  let stepsSinceProgress = 0;
  let lastProgressTop = -1;

  try {
    // Reach the actual beginning before walking down, or everything above the
    // landing position is lost silently. See scrollToConversationStart.
    const start = await settings.scrollToStart(container);
    // Three outcomes, and collapsing any two of them is a defect that has
    // already shipped in one direction or the other:
    //   - confirmed by the page's own start marker -> complete, say nothing;
    //   - no marker on this page, but the climb went quiet at the top -> the
    //     old criterion, which is all such a layout can offer. Flagging it
    //     partial would put a "your data is untrustworthy" notice on every
    //     export the moment ChatGPT renames an attribute — a false warning is
    //     a real cost, not a safe default;
    //   - still moving, or never at the top -> genuinely partial.
    //
    // The exemption is ONLY for a page with no marker mechanism at all. Scoping
    // it to `quietedWithoutMarker` alone was a defect of its own: a page that
    // does publish a marker the climb failed to reach also quiets down, so an
    // export missing 82% of its conversation came out unflagged. Silence about
    // a real hole is far worse than a needless warning — the user cannot even
    // know to re-run.
    if (!start.reachedTop && !(start.quietedWithoutMarker && start.markerAbsentFromPage)) {
      markPartialScan(settings, 'never reached the start');
    }
    await settings.settle(container);
    for (let step = 0; settings.maxSteps === 0 || step < settings.maxSteps; step += 1) {
      if (settings.isCancelled()) {
        markPartialScan(settings, 'cancelled');
        return orderCapturedTurns(seen);
      }
      const observation = captureMountedTurns(settings.readSections(container), settings, seen, state);
      const logicalTop = conversationScrollTop(container);
      const atBottom = logicalTop >= conversationScrollMax(container) - 1;
      // Record every position and what it mounted there. Positions that mounted
      // nothing are kept: below the last turn that is legitimate, but between two
      // turns it is the signature of a stretch the virtualizer never rendered
      // while the scan was looking at it.
      readBands.push([logicalTop, observation.mountedBand]);
      // Read anything that lives inside a turn BEFORE the scan scrolls away and
      // the virtualizer unmounts it. Guarded: a throwing collector must not end
      // a scan that has already captured turns.
      if (settings.onMounted) {
        try {
          settings.onMounted(container);
        } catch (_e) {
          /* collector failed */
        }
      }

      const movedDown = Math.abs(logicalTop - lastProgressTop) >= 1;
      if (observation.newIds > 0 || movedDown) {
        stepsSinceProgress = 0;
        lastProgressTop = logicalTop;
      } else {
        stepsSinceProgress += 1;
        // Waiting for a turn to paint is work, so it must not be mistaken for a
        // stall — but it must not be unbounded either. A single turn that never
        // resolves froze the scroll target ("hold position until unresolved
        // clears"), which stopped the page moving, which then read as a stall
        // and cost the remaining turns: 1 bad turn lost 70 good ones. Give up
        // on the stragglers instead of giving up on the conversation.
        if (stepsSinceProgress >= settings.holdReleaseSteps && observation.unresolved > 0) {
          for (const id of state.observedIds) {
            if (!seen.has(id)) state.skipped.add(id);
          }
          observation.unresolved = 0;
          stepsSinceProgress = 0;
        }
        if (stepsSinceProgress >= settings.noProgressSteps && !atBottom) {
          markPartialScan(settings, 'stall');
          return orderCapturedTurns(seen);
        }
      }

      if (settings.onProgress) {
        // Report captured/observed rather than a percentage of a budget: there
        // is no budget to be a percentage of, and the honest signal is that the
        // count keeps climbing.
        settings.onProgress({
          captured: seen.size,
          observed: state.observedIds.size,
          elapsedMs: settings.now() - startedAt,
          scrollTop: logicalTop,
          scrollHeight: container.scrollHeight,
        });
      }

      stablePasses =
        atBottom && observation.newIds === 0 && observation.unresolved === 0 && lastHeight === container.scrollHeight
          ? stablePasses + 1
          : 0;
      if (stablePasses >= settings.stablePasses) {
        // `scrollHeight` is read HERE, at the end of the scan, when the
        // virtualizer has mounted everything it is going to mount. Comparing it
        // against the furthest position the scan actually visited is what
        // catches a scan that stopped at a bottom which later grew.
        const gap = largestCoverageGap(readBands, container.clientHeight || 0, container.scrollHeight || 0);
        // A gap wider than the band that should have covered it means turns
        // existed in a stretch of the document the scan never mounted. Say so in
        // the artifact rather than presenting a hole as a complete conversation.
        if (gap.width > 0) markPartialScan(settings, 'coverage gap');
        return orderCapturedTurns(seen);
      }
      lastHeight = container.scrollHeight;
      const target =
        observation.unresolved > 0 ? logicalTop : nextScrollTop(container, atBottom, observation.mountedBand);
      await settings.scrollTo(container, target, 'auto');
      await settings.settle(container);
    }
    // Only reachable when a test supplies maxSteps; production leaves it 0 and
    // the loop above is bounded solely by stability, stall, or cancellation.
    if (seen.size > 0) {
      markPartialScan(settings, 'step limit');
      return orderCapturedTurns(seen);
    }
    throw new Error('Conversation scan exceeded its step limit before reaching a stable bottom.');
  } finally {
    // Restore the native offset so a conversation whose height grew during the
    // walk returns to the same viewport edge (especially native zero/bottom in
    // the reverse layout), rather than to its old distance from the start.
    const restoreTop = reverseConversationScroll(container)
      ? originalNativeScrollTop + conversationScrollMax(container)
      : originalNativeScrollTop;
    await settings.scrollTo(container, restoreTop, 'auto');
  }
}

/** Extract clean Markdown from the current ChatGPT page. */
function extractConversation() {
  const sections = document.querySelectorAll('[data-turn-id]');
  if (!sections.length) return extractConversationLegacy();
  const turns = Array.from(sections)
    .map(function (section, index) {
      return extractTurn(section, index);
    })
    .filter(Boolean);
  return buildConversationMarkdown(orderCapturedTurns(turns));
}

/** Append the artefacts that render no chip anywhere in the message stream.
 *
 *  Generated (code-interpreter) files live in a separate panel with no href, no
 *  testid and no download attribute, outside the message tree — so the per-turn
 *  scan above cannot see them and `parseArtifactRefs` in the popup has nothing to
 *  find. Measured on production: a conversation with five PDF/DOCX files yielded
 *  ZERO matches for every shipped attachment selector.
 *
 *  Returns the markdown UNCHANGED when there is nothing to add, and appends a
 *  visible note when artefacts exist but could not be resolved — a silent drop
 *  would present a partial export as a complete one.
 */
/** Collect generated files that the answer text offers as `sandbox:` links.
 *
 *  Two shapes reach the markdown, and both must be read:
 *    - the note nodeToMarkdown writes for a chip or <a>:
 *        > **Code Interpreter file:** `sandbox:/mnt/data/report.zip` (label)
 *    - a raw link, when the export came from a path that did not rewrite it:
 *        [label](sandbox:/mnt/data/report.zip)
 *
 *  The path is taken verbatim. `/mnt/data/` is where most interpreter output
 *  lands, but not all of it — a file written to `/mnt/data/outputs/` resolves
 *  only if the subdirectory survives, which is why this never rebuilds a path
 *  from the file name the way the panel reader has to. */
function sandboxFilesFromMarkdown(markdown) {
  const text = String(markdown || '');
  const files = [];
  const seen = new Set();
  // Stop at whitespace, a closing paren or a backtick: the path sits inside
  // either `…` or (…), and a Cyrillic label may follow immediately after.
  const pattern = /sandbox:(\/[^\s`)"'\\]+)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const sandboxPath = match[1];
    if (seen.has(sandboxPath)) continue;
    seen.add(sandboxPath);
    const name = sandboxPath.split('/').pop();
    if (!name) continue;
    files.push({ name: name, sandboxPath: sandboxPath, fromBody: true });
  }
  return files;
}

export {
  captureMountedTurns,
  extractConversation,
  largestCoverageGap,
  looksLikePlaceholder,
  markPartialScan,
  nextScrollTop,
  PLACEHOLDER_MARKDOWN,
  prefixPartialNotice,
  sandboxFilesFromMarkdown,
  scanTurns,
  shouldReplaceCapture,
};
