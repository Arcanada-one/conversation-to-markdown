/**
 * ChatGPT → Markdown v1.3.0
 * Content script: parses the live ChatGPT conversation and returns clean Markdown.
 *
 * Iterates [data-turn-id] sections (not just [data-message-author-role]) so that
 * generated images — which live outside the message div but inside the turn section —
 * are correctly captured. Strips query parameters from exported URLs (privacy).
 */

/** Convert an HTML element's content to plain Markdown text. */
function stripUrlQuery(url, allowedQueryNames) {
  const allowedNames = new Set(allowedQueryNames || []);
  for (const name of Array.from(url.searchParams.keys())) {
    if (!allowedNames.has(name)) url.searchParams.delete(name);
  }
  return url;
}

function resolveHttpUrl(rawUrl, allowedQueryNames) {
  if (!rawUrl) return null;
  try {
    const baseUrl = typeof location !== 'undefined' ? location.href : 'https://chatgpt.com/';
    const resolved = new URL(rawUrl, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    return stripUrlQuery(resolved, allowedQueryNames).href;
  } catch (_error) {
    return null;
  }
}

/** Resolve an image URL preserving query parameters (SAS tokens etc. needed for fetch). */
function resolveImageUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const baseUrl = typeof location !== 'undefined' ? location.href : 'https://chatgpt.com/';
    const resolved = new URL(rawUrl, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    return resolved.href;
  } catch (_error) {
    return null;
  }
}

/** Visible placeholder when a non-text artifact cannot be exported verbatim. */
function artifactPlaceholder(kind, detail) {
  const label = detail ? ' (' + detail + ')' : '';
  return '\n\n*[' + kind + ' artifact — not exported' + label + ']*\n\n';
}

function isKatexMathml(node) {
  const cls = node.className || '';
  return typeof cls === 'string' && /\bkatex-mathml\b/.test(cls);
}

function isKatexRoot(node) {
  const cls = node.className || '';
  return typeof cls === 'string' && /\bkatex\b/.test(cls) && !/\bkatex-(?:mathml|html)\b/.test(cls);
}

/** Fixture-derived: live ChatGPT attachment chips use data-testid="file-chip". */
function isAttachmentChip(node) {
  return node.getAttribute && node.getAttribute('data-testid') === 'file-chip';
}

function hrefFromAttachmentChip(node) {
  if (!node) return null;
  if (node.tagName && node.tagName.toLowerCase() === 'a') {
    return node.getAttribute('href') || null;
  }
  if (typeof node.querySelector === 'function') {
    const link = node.querySelector('a[href]');
    return link ? link.getAttribute('href') : null;
  }
  return null;
}

function labelFromAttachmentChip(node) {
  const text = (node.textContent || '').trim();
  if (text) return text;
  const href = hrefFromAttachmentChip(node);
  if (!href) return 'attachment';
  try {
    const parts = new URL(href, 'https://chatgpt.com/').pathname.split('/');
    return parts[parts.length - 1] || 'attachment';
  } catch (_error) {
    return 'attachment';
  }
}

function markdownLink(label, href) {
  const safeLabel = (label || href).trim();
  return safeLabel ? '[' + safeLabel + '](' + href + ')' : href;
}

function nodeToMarkdown(node, depth) {
  if (depth === undefined) depth = 0;

  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const tag = node.tagName.toLowerCase();
  const children = function() {
    return Array.from(node.childNodes).map(function(n) { return nodeToMarkdown(n, depth); }).join('');
  };

  if (isKatexMathml(node)) return '';
  if (isKatexRoot(node)) {
    const htmlEl = node.querySelector('.katex-html');
    if (htmlEl) return nodeToMarkdown(htmlEl, depth);
    return children();
  }
  if (isAttachmentChip(node)) {
    const href = hrefFromAttachmentChip(node);
    if (!href) return labelFromAttachmentChip(node);
    if (href.startsWith('sandbox:')) {
      return '> **Attachment (Code Interpreter):** `' + href + '`\n\n';
    }
    const absHref = resolveImageUrl(href);
    if (!absHref) return labelFromAttachmentChip(node);
    return markdownLink(labelFromAttachmentChip(node), absHref) + '\n\n';
  }

  switch (tag) {
    case 'p':
      return children() + '\n\n';
    case 'br':
      return '\n';
    case 'strong':
    case 'b':
      return '**' + children() + '**';
    case 'em':
    case 'i':
      return '*' + children() + '*';
    case 'code': {
      const text = node.textContent;
      if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'pre') return text;
      return '`' + text + '`';
    }
    case 'pre': {
      const codeEl = node.querySelector('code');
      const lang = codeEl
        ? ((codeEl.className.match(/language-(\S+)/) || [])[1] || '')
        : '';
      const text = codeEl ? codeEl.textContent : node.textContent;
      return '```' + lang + '\n' + text + '\n```\n\n';
    }
    case 'h1': return '# ' + children() + '\n\n';
    case 'h2': return '## ' + children() + '\n\n';
    case 'h3': return '### ' + children() + '\n\n';
    case 'h4': return '#### ' + children() + '\n\n';
    case 'h5': return '##### ' + children() + '\n\n';
    case 'h6': return '###### ' + children() + '\n\n';
    case 'ul': {
      var items = Array.from(node.children)
        .map(function(li) { return '- ' + nodeToMarkdown(li, depth + 1).trim(); })
        .join('\n');
      return items + '\n\n';
    }
    case 'ol': {
      var items = Array.from(node.children)
        .map(function(li, i) { return (i + 1) + '. ' + nodeToMarkdown(li, depth + 1).trim(); })
        .join('\n');
      return items + '\n\n';
    }
    case 'li':
      return children();
    case 'blockquote':
      return children()
        .split('\n')
        .map(function(l) { return '> ' + l; })
        .join('\n') + '\n\n';
    case 'a': {
      const href = node.getAttribute('href') || '';
      const text = children().trim();
      if (!href) return text;
      if (href.startsWith('sandbox:')) {
        const label = text || href.replace(/^sandbox:/, '');
        return '> **Code Interpreter file:** `' + href + '`' + (label && label !== href ? ' (' + label + ')' : '') + '\n\n';
      }
      const absHref = resolveHttpUrl(href);
      if (!absHref) return text;
      return text ? '[' + text + '](' + absHref + ')' : absHref;
    }
    case 'img': {
      // Skip favicons, decorative icons, and aria-hidden images
      if (node.getAttribute('aria-hidden') === 'true') return '';
      const src = node.getAttribute('src') || '';
      if (!src || src.startsWith('data:') || src.startsWith('blob:')) return '';
      // Skip small favicons (google s2 favicons, etc.)
      if (src.includes('favicon') || src.includes('s2/favicons')) return '';
      const absSrc = resolveImageUrl(src);
      if (!absSrc) return '';
      const alt = (node.getAttribute('alt') || '').trim();
      return '![' + alt + '](' + absSrc + ')\n\n';
    }
    case 'hr':
      return '---\n\n';
    case 'table': {
      const rows = Array.from(node.querySelectorAll('tr'));
      if (!rows.length) return '';
      const parseRow = function(row) {
        return Array.from(row.querySelectorAll('th, td'))
          .map(function(cell) { return cell.textContent.trim(); })
          .join(' | ');
      };
      const header = parseRow(rows[0]);
      const sep = header.split(' | ').map(function() { return '---'; }).join(' | ');
      const body = rows.slice(1).map(parseRow).join('\n');
      return '| ' + header + ' |\n| ' + sep + ' |\n' +
        (body ? body.split('\n').map(function(r) { return '| ' + r + ' |'; }).join('\n') + '\n' : '') + '\n';
    }
    case 'canvas':
      return artifactPlaceholder('canvas');
    case 'audio':
      return artifactPlaceholder('audio');
    case 'video':
      return artifactPlaceholder('video');
    case 'svg':
      return artifactPlaceholder('svg');
    case 'button':
      return '';
    default:
      return children();
  }
}

/** Extract images from a turn section that live OUTSIDE the .markdown prose
 *  container (nodeToMarkdown handles images inside .markdown). Captures all
 *  visible images regardless of CDN path. */
function extractImages(section) {
  const seenSrcs = new Set();
  const results = [];

  const imgEls = section.querySelectorAll('img');
  for (const img of imgEls) {
    if (img.getAttribute('aria-hidden') === 'true') continue;

    const src = img.getAttribute('src') || '';
    if (!src || src.startsWith('data:') || src.startsWith('blob:')) continue;
    if (src.includes('favicon') || src.includes('s2/favicons')) continue;

    // Skip images already inside a markdown/prose container —
    // nodeToMarkdown will emit them with their surrounding context.
    if (typeof img.closest === 'function' &&
        (img.closest('.markdown') || img.closest('[class*="prose"]'))) continue;

    // All image URLs: preserve query params — estuary needs p+ts,
    // CDN needs SAS tokens. fetchImageDataUrls replaces them with
    // local paths after download.
    const absSrc = resolveImageUrl(src);
    if (!absSrc) continue;

    if (seenSrcs.has(absSrc)) continue;
    seenSrcs.add(absSrc);

    const alt = (img.getAttribute('alt') || '').trim();
    results.push('![' + alt + '](' + absSrc + ')');
  }

  return results;
}

/** Extract file attachments from a turn section outside the prose container.
 *  Selector is fixture-derived (data-testid="file-chip"); needs a live check. */
function extractAttachments(section) {
  const seenHrefs = new Set();
  const results = [];
  if (!section.querySelectorAll) return results;

  const chips = section.querySelectorAll('[data-testid="file-chip"]');
  for (const chip of chips) {
    if (typeof chip.closest === 'function' &&
        (chip.closest('.markdown') || chip.closest('[class*="prose"]'))) {
      continue;
    }
    const href = hrefFromAttachmentChip(chip);
    if (!href || href.startsWith('sandbox:')) continue;
    const absHref = resolveImageUrl(href);
    if (!absHref || seenHrefs.has(absHref)) continue;
    seenHrefs.add(absHref);
    results.push(markdownLink(labelFromAttachmentChip(chip), absHref));
  }

  return results;
}

function orderCapturedTurns(turns) {
  const ordered = turns instanceof Map ? Array.from(turns.values()) : Array.from(turns);
  const hasCompleteNumericOrder = ordered.every(function(turn) {
    return turn.order !== null && turn.order !== undefined;
  });
  return ordered.sort(function(a, b) {
    if (hasCompleteNumericOrder && a.order !== b.order) return a.order - b.order;
    return a.discoveryIndex - b.discoveryIndex;
  });
}

function parseTurnOrder(testId) {
  const match = String(testId || '').match(/^conversation-turn-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function buildConversationMarkdown(turns) {
  const parts = [];
  for (const turn of turns) {
    if (!turn.markdown) continue;
    if (turn.role === 'user') parts.push('#### You said:\n\n' + turn.markdown);
    if (turn.role === 'assistant') parts.push('#### ChatGPT said:\n\n' + turn.markdown);
  }
  return parts.length ? parts.join('\n\n---\n\n') : null;
}

function getSectionTurnId(section) {
  if (typeof section.getAttribute === 'function') {
    return section.getAttribute('data-turn-id') || section.turnId || null;
  }
  return section.turnId || null;
}

function getSectionRole(section) {
  const directRole = section.getAttribute('data-turn');
  if (directRole === 'user' || directRole === 'assistant') return directRole;
  const message = section.querySelector('[data-message-author-role]');
  if (!message) return null;
  const childRole = message.getAttribute('data-message-author-role');
  return childRole === 'user' || childRole === 'assistant' ? childRole : null;
}

function isExplicitlyUnsupportedTurn(section) {
  if (typeof section.getAttribute !== 'function') {
    return Boolean(section.role && section.role !== 'user' && section.role !== 'assistant');
  }
  const directRole = section.getAttribute('data-turn');
  if (directRole) return directRole !== 'user' && directRole !== 'assistant';
  const message = section.querySelector('[data-message-author-role]');
  if (!message) return false;
  const childRole = message.getAttribute('data-message-author-role');
  return Boolean(childRole && childRole !== 'user' && childRole !== 'assistant');
}

function extractTurn(section, discoveryIndex) {
  const turnId = getSectionTurnId(section);
  const role = getSectionRole(section);
  if (!turnId) return null;

  if (role === 'user') {
    const message = section.querySelector('[data-message-author-role="user"]');
    const bubble = message && (
      message.querySelector('.whitespace-pre-wrap') || message.querySelector('[dir="auto"]') || message
    );
    const text = bubble ? bubble.textContent.trim() : '';
    // Capture user-uploaded images that textContent would miss
    const userImages = extractImages(section);
    const userAttachments = extractAttachments(section);
    if (!text && !userImages.length && !userAttachments.length) return null;
    const parts = [];
    if (text) parts.push(text);
    if (userAttachments.length) parts.push(userAttachments.join('\n\n'));
    if (userImages.length) parts.push(userImages.join('\n\n'));
    return createTurn(turnId, section, discoveryIndex, role, parts.join('\n\n'));
  }

  if (role === 'assistant') {
    const pieces = extractAttachments(section).concat(extractImages(section));
    const fragments = [];
    const messages = section.querySelectorAll('[data-message-author-role="assistant"]');
    for (const message of messages) {
      const markdownRoot = message.querySelector('.markdown') ||
        message.querySelector('[class*="prose"]') || message;
      const markdown = nodeToMarkdown(markdownRoot).trim().replace(/\n{3,}/g, '\n\n');
      if (markdown) fragments.push(markdown);
    }
    // Some assistant turns carry no [data-message-author-role] wrapper at all —
    // measured on a 570-turn conversation, 12 of 285 answers were shaped this
    // way and were silently dropped, up to 3106 characters each. The prose is
    // present; only the attribute is missing, so address the .markdown/.prose
    // container directly.
    //
    // Deliberately NOT a fallback to the whole section: doing that harvests the
    // "Thinking…" chrome of a re-mounting turn and appends it as a duplicate
    // answer. Only a real prose container counts.
    if (!fragments.length) {
      const orphanRoots = section.querySelectorAll('.markdown, [class*="prose"]');
      for (const root of orphanRoots) {
        // Skip nested matches: .markdown inside an already-scanned .prose.
        if (root.parentElement && root.parentElement.closest('.markdown, [class*="prose"]')) continue;
        const markdown = nodeToMarkdown(root).trim().replace(/\n{3,}/g, '\n\n');
        if (markdown) fragments.push(markdown);
      }
    }
    if (fragments.length) pieces.push(fragments.join('\n\n'));
    if (!pieces.length) return null;
    return createTurn(turnId, section, discoveryIndex, role, pieces.join('\n\n'));
  }

  return null;
}

function createTurn(turnId, section, discoveryIndex, role, markdown) {
  return {
    turnId: turnId,
    order: parseTurnOrder(section.getAttribute('data-testid')),
    discoveryIndex: discoveryIndex,
    role: role,
    markdown: markdown,
  };
}

function findScrollContainer(startElement) {
  let current = startElement ? startElement.parentElement : null;
  while (current) {
    const style = getComputedStyle(current);
    if (/(auto|scroll|overlay)/.test(style.overflowY) &&
        current.scrollHeight > current.clientHeight + 1) {
      return current;
    }
    current = current.parentElement;
  }
  if (typeof document === 'undefined') return null;
  return document.scrollingElement || document.documentElement;
}

function waitForScrollPosition(target, requestedTop, behavior, timeoutMs) {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise(function(resolve, reject) {
    const startedAt = Date.now();
    let stableFrames = 0;
    let previousTop = target.scrollTop;
    let lastReachableTop = Math.max(
      0,
      Math.min(requestedTop, target.scrollHeight - target.clientHeight)
    );
    function check() {
      const maxTop = Math.max(0, target.scrollHeight - target.clientHeight);
      const reachableTop = Math.max(0, Math.min(requestedTop, maxTop));
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
  const maxTop = Math.max(0, target.scrollHeight - target.clientHeight);
  const expectedTop = Math.max(0, Math.min(top, maxTop));
  target.scrollTo({ top: expectedTop, behavior: behavior });
  try {
    await waitForScrollPosition(target, top, behavior, 8000);
  } catch (_e) {
    // Smooth scroll didn't settle — force instant jump to target so we
    // don't start scanning from mid-conversation. Then wait for the DOM.
    const curMaxTop = Math.max(0, target.scrollHeight - target.clientHeight);
    target.scrollTo({ top: Math.max(0, Math.min(top, curMaxTop)), behavior: 'auto' });
    await new Promise(function(r) { return setTimeout(r, 1500); });
  }
}

function waitForRenderQuiet(target) {
  if (typeof MutationObserver === 'undefined') return Promise.resolve();
  return new Promise(function(resolve) {
    let quietTimer;
    const finish = function() {
      clearTimeout(quietTimer);
      clearTimeout(maxTimer);
      observer.disconnect();
      resolve();
    };
    const schedule = function() {
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
    readSections: supplied.readSections || function(target) {
      return target.querySelectorAll('[data-turn-id]');
    },
    extractTurn: supplied.extractTurn || extractTurn,
    settle: supplied.settle || waitForRenderQuiet,
    scrollTo: supplied.scrollTo || scrollToConversationPosition,
    now: supplied.now || function() { return Date.now(); },
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
    isCancelled: supplied.isCancelled || function() { return false; },
    scanMeta: supplied.scanMeta || null,
    // Optional progress reporting, so a long scan is visibly alive.
    onProgress: supplied.onProgress || null,
    // Test-only escape hatch. Production never sets this: a step ceiling is a
    // length limit on the conversation, not a safety property.
    maxSteps: supplied.maxSteps || 0,
  };
}

// Chrome a re-mounted turn shows while its real content is still coming back.
// These are not answers, however long they run.
const PLACEHOLDER_MARKDOWN = /^(thinking|reasoning|searching|analyzing|analysing|gathering|expanding|loading|generating|working)\b|^(думаю|размышляю|ищу|загружаю|генерирую)\b/i;

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
  for (const section of sections) {
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
      seen.set(candidate.turnId, previous
        ? Object.assign({}, candidate, { discoveryIndex: previous.discoveryIndex })
        : candidate);
    }
  }
  // Set difference, not a size subtraction: sizes can coincide while a real id
  // is missing, which would report "nothing outstanding" over a genuine gap.
  let unresolved = 0;
  for (const id of state.observedIds) {
    if (!seen.has(id) && !state.skipped.has(id)) unresolved += 1;
  }
  return { newIds: newIds, unresolved: unresolved };
}

function nextScrollTop(container, atBottom) {
  if (atBottom) return container.scrollTop;
  const increment = Math.max(1, Math.floor(container.clientHeight * 0.75));
  return Math.min(container.scrollTop + increment, container.scrollHeight - container.clientHeight);
}

/** Record that a scan ended before reaching a stable bottom. */
function markPartialScan(settings, reason) {
  if (settings.scanMeta) {
    settings.scanMeta.partial = true;
    settings.scanMeta.reason = reason;
  }
}

/** Prefix markdown with a visible partial-export notice — must live in the artifact itself. */
function prefixPartialNotice(md, reason) {
  var detail = reason === 'cancelled'
    ? 'scan was stopped before reaching the end'
    : 'scan did not reach the end (' + reason + ')';
  return '> **Partial export** — ' + detail + '.\n\n' + md;
}

async function scanTurns(container, options) {
  const settings = createScanSettings(options);
  const originalScrollTop = container.scrollTop;
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
    // Smooth scroll to top triggers ChatGPT's virtualization to mount
    // the earliest turns. Fallback delay catches any timeout.
    await settings.scrollTo(container, 0, 'smooth');
    await settings.settle(container);
    for (let step = 0; settings.maxSteps === 0 || step < settings.maxSteps; step += 1) {
      if (settings.isCancelled()) {
        markPartialScan(settings, 'cancelled');
        return orderCapturedTurns(seen);
      }
      const observation = captureMountedTurns(settings.readSections(container), settings, seen, state);
      const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 1;

      const movedDown = Math.abs(container.scrollTop - lastProgressTop) >= 1;
      if (observation.newIds > 0 || movedDown) {
        stepsSinceProgress = 0;
        lastProgressTop = container.scrollTop;
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
          scrollTop: container.scrollTop,
          scrollHeight: container.scrollHeight,
        });
      }

      stablePasses = atBottom && observation.newIds === 0 && observation.unresolved === 0 &&
        lastHeight === container.scrollHeight
        ? stablePasses + 1 : 0;
      if (stablePasses >= settings.stablePasses) return orderCapturedTurns(seen);
      lastHeight = container.scrollHeight;
      const target = observation.unresolved > 0
        ? container.scrollTop : nextScrollTop(container, atBottom);
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
    await settings.scrollTo(container, originalScrollTop, 'auto');
  }
}

/** Extract clean Markdown from the current ChatGPT page. */
function extractConversation() {
  const sections = document.querySelectorAll('[data-turn-id]');
  if (!sections.length) return extractConversationLegacy();
  const turns = Array.from(sections)
    .map(function(section, index) { return extractTurn(section, index); })
    .filter(Boolean);
  return buildConversationMarkdown(orderCapturedTurns(turns));
}

/** Fallback for older ChatGPT UI that doesn't use [data-turn-id]. */
function extractConversationLegacy() {
  const messages = document.querySelectorAll('[data-message-author-role]');
  if (!messages.length) return null;

  const parts = [];
  for (const msg of messages) {
    const role = msg.getAttribute('data-message-author-role');
    if (role === 'user') {
      const bubble = msg.querySelector('.whitespace-pre-wrap') || msg.querySelector('[dir="auto"]') || msg;
      const text = bubble.textContent.trim();
      if (text) parts.push('#### You said:\n\n' + text);
    } else if (role === 'assistant') {
      const markdownDiv = msg.querySelector('.markdown') || msg.querySelector('[class*="prose"]') || msg;
      let md = nodeToMarkdown(markdownDiv).trim();
      md = md.replace(/\n{3,}/g, '\n\n');
      if (md) parts.push('#### ChatGPT said:\n\n' + md);
    }
  }

  return parts.length ? parts.join('\n\n---\n\n') : null;
}

/** Read a sidebar conversation link's visible title.
 *  Fixture-derived: aria-label and inner .truncate both carry the title. */
function titleFromSidebarLink(link) {
  if (!link) return null;
  const label = (link.getAttribute('aria-label') || '').trim();
  if (label) return label;
  const inner = link.querySelector ? link.querySelector('.truncate') : null;
  const text = inner ? (inner.textContent || '').trim() : (link.textContent || '').trim();
  return text || null;
}

/** Read the conversation title from the page.
 *  Primary source: the active sidebar entry for the current /c/{id} route
 *  (its aria-label and inner text both carry the title). Falls back to the
 *  document title with the site suffix stripped. */
function extractConversationTitle(doc) {
  const root = doc || (typeof document !== 'undefined' ? document : null);
  if (!root) return null;

  const idMatch = (typeof location !== 'undefined' ? location.pathname : '')
    .match(/\/c\/([A-Za-z0-9-]+)/);

  const candidates = [];
  if (idMatch) candidates.push('a[href="/c/' + idMatch[1] + '"]');
  candidates.push('a[data-active][href^="/c/"]');

  for (const selector of candidates) {
    const link = root.querySelector(selector);
    const title = titleFromSidebarLink(link);
    if (title) return title;
  }

  const title = (root.title || '').trim();
  if (!title) return null;
  const cleaned = title.replace(/\s*[|-]\s*ChatGPT\s*$/i, '').trim();
  return cleaned && cleaned.toLowerCase() !== 'chatgpt' ? cleaned : null;
}

/**
 * Enumerate every conversation link visible in the sidebar.
 * Fixture-derived selector: nav a[href^="/c/"] — needs a live check on a
 * ChatGPT Project page.
 */
function listSidebarConversations(doc) {
  const root = doc || (typeof document !== 'undefined' ? document : null);
  if (!root || !root.querySelectorAll) return [];

  const links = root.querySelectorAll('nav a[href^="/c/"]');
  const seen = new Set();
  const results = [];
  for (const link of links) {
    const href = link.getAttribute('href') || '';
    const match = href.match(/^\/c\/([A-Za-z0-9-]+)/);
    if (!match || seen.has(match[1])) continue;
    seen.add(match[1]);
    const title = titleFromSidebarLink(link);
    results.push({
      id: match[1],
      href: '/c/' + match[1],
      title: title,
      slug: slugifyTitle(title) || match[1],
    });
  }
  return results;
}

/** Wait until a navigated conversation page has mountable message content. */
function waitForConversationReady(options) {
  const supplied = options || {};
  const timeoutMs = supplied.timeoutMs || 30000;
  const pollMs = supplied.pollMs || 300;
  const conversationId = supplied.conversationId || null;

  return new Promise(function(resolve) {
    const startedAt = Date.now();
    function check() {
      if (conversationId) {
        const pathMatch = (typeof location !== 'undefined' ? location.pathname : '')
          .match(/\/c\/([A-Za-z0-9-]+)/);
        if (!pathMatch || pathMatch[1] !== conversationId) {
          if (Date.now() - startedAt >= timeoutMs) {
            return resolve({ ready: false, error: 'Navigation did not reach the conversation.' });
          }
          return setTimeout(check, pollMs);
        }
      }
      if (typeof document !== 'undefined' &&
          (document.querySelector('[data-turn-id]') ||
           document.querySelector('[data-message-author-role]'))) {
        return resolve({ ready: true });
      }
      if (Date.now() - startedAt >= timeoutMs) {
        return resolve({ ready: false, error: 'Conversation content did not load.' });
      }
      setTimeout(check, pollMs);
    }
    check();
  });
}

/** Turn a conversation title into a filesystem-safe slug.
 *  Keeps Unicode letters (Cyrillic titles stay readable), collapses the rest
 *  to single hyphens, and caps the length so the download path stays sane. */
function slugifyTitle(title, maxLength) {
  const limit = maxLength || 60;
  if (!title) return null;
  const slug = String(title)
    .normalize('NFC')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, limit)
    .replace(/-+$/g, '');
  // This slug becomes a DIRECTORY name — in a batch the project slug does too —
  // so a dot-only result is a relative-path segment, not a name. Chrome rejects
  // any downloads.download() filename containing a `..` back-reference, so a
  // conversation titled ".." made every write in the run fail. Returning null
  // hands the caller its own fallback name instead.
  if (/^\.+$/.test(slug)) return null;
  return slug || null;
}

/** Called by popup via chrome.scripting.executeScript — returns text, does NOT write clipboard. */
async function getConversationMarkdown() {
  try {
    const firstSection = document.querySelector('[data-turn-id]');
    let md;
    var scanMeta = null;
    if (!firstSection) {
      md = extractConversationLegacy();
    } else {
      const container = findScrollContainer(firstSection);
      if (!container) return { ok: false, error: 'Could not find the conversation scroll area.' };
      // The popup cannot hold a live channel into the page across
      // executeScript calls, so cancellation and progress ride on a window
      // flag it can set and read with a separate one-liner injection. Guarded
      // because this function is also exercised outside a browser window.
      const scanState = { cancelled: false, captured: 0, observed: 0, elapsedMs: 0 };
      scanMeta = {};
      if (typeof window !== 'undefined') window.__c2mScan = scanState;
      const turns = await scanTurns(container, {
        readSections: function() { return document.querySelectorAll('[data-turn-id]'); },
        extractTurn: extractTurn,
        isCancelled: function() { return scanState.cancelled === true; },
        scanMeta: scanMeta,
        onProgress: function(p) {
          scanState.captured = p.captured;
          scanState.observed = p.observed;
          scanState.elapsedMs = p.elapsedMs;
        },
      });
      md = buildConversationMarkdown(turns);
      if (scanMeta.partial) md = prefixPartialNotice(md, scanMeta.reason);
    }
    if (!md) return { ok: false, error: 'No conversation found on this page.' };
    const title = extractConversationTitle();
    if (title) md = '# ' + title + '\n\n' + md;
    return {
      ok: true,
      md: md,
      partial: !!scanMeta && scanMeta.partial === true,
      partialReason: scanMeta && scanMeta.reason ? scanMeta.reason : null,
      title: title,
      slug: slugifyTitle(title),
      lines: md.split('\n').length,
      words: md.split(/\s+/).filter(Boolean).length,
    };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
}

/** Fetch remote artifact bytes as data URLs using fetch().
 *  Extension host_permissions for declared hosts bypass CORS.
 *  Returns {url, dataUrl} for successfully fetched artifacts; null on error. */
async function fetchImageDataUrls(urls) {
  const results = [];
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) { results.push(null); continue; }
      const blob = await response.blob();
      const dataUrl = await new Promise(function(resolve, reject) {
        const reader = new FileReader();
        reader.onload = function() { resolve(reader.result); };
        reader.onerror = function() { reject(reader.error); };
        reader.readAsDataURL(blob);
      });
      results.push({ url: url, dataUrl: dataUrl });
    } catch (_e) {
      results.push(null);
    }
  }
  return results;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildConversationMarkdown: buildConversationMarkdown,
    extractAttachments: extractAttachments,
    extractConversationTitle: extractConversationTitle,
    extractImages: extractImages,
    fetchImageDataUrls: fetchImageDataUrls,
    listSidebarConversations: listSidebarConversations,
    slugifyTitle: slugifyTitle,
    extractTurn: extractTurn,
    findScrollContainer: findScrollContainer,
    getConversationMarkdown: getConversationMarkdown,
    nodeToMarkdown: nodeToMarkdown,
    orderCapturedTurns: orderCapturedTurns,
    parseTurnOrder: parseTurnOrder,
    prefixPartialNotice: prefixPartialNotice,
    scanTurns: scanTurns,
    titleFromSidebarLink: titleFromSidebarLink,
    waitForConversationReady: waitForConversationReady,
  };
}
