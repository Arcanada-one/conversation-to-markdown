/**
 * ChatGPT → Markdown v1.1.6
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
    case 'svg':
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
    if (!text && !userImages.length) return null;
    const parts = [];
    if (text) parts.push(text);
    if (userImages.length) parts.push(userImages.join('\n\n'));
    return createTurn(turnId, section, discoveryIndex, role, parts.join('\n\n'));
  }

  if (role === 'assistant') {
    const pieces = extractImages(section);
    const fragments = [];
    const messages = section.querySelectorAll('[data-message-author-role="assistant"]');
    for (const message of messages) {
      const markdownRoot = message.querySelector('.markdown') ||
        message.querySelector('[class*="prose"]') || message;
      const markdown = nodeToMarkdown(markdownRoot).trim().replace(/\n{3,}/g, '\n\n');
      if (markdown) fragments.push(markdown);
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
    maxSteps: supplied.maxSteps || 1000,
    timeoutMs: supplied.timeoutMs || 120000,
  };
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
    if (!candidate) continue;
    const previous = seen.get(candidate.turnId);
    if (!previous) {
      candidate.discoveryIndex = state.discoveryIndex;
      state.discoveryIndex += 1;
    }
    if (!previous || candidate.markdown.length > previous.markdown.length) {
      seen.set(candidate.turnId, previous
        ? Object.assign({}, candidate, { discoveryIndex: previous.discoveryIndex })
        : candidate);
    }
  }
  return {
    newIds: newIds,
    unresolved: state.observedIds.size - seen.size,
  };
}

function nextScrollTop(container, atBottom) {
  if (atBottom) return container.scrollTop;
  const increment = Math.max(1, Math.floor(container.clientHeight * 0.75));
  return Math.min(container.scrollTop + increment, container.scrollHeight - container.clientHeight);
}

async function scanTurns(container, options) {
  const settings = createScanSettings(options);
  const originalScrollTop = container.scrollTop;
  const seen = new Map();
  const state = { discoveryIndex: 0, observedIds: new Set() };
  let stablePasses = 0;
  let lastHeight = -1;
  const startedAt = settings.now();

  try {
    // Smooth scroll to top triggers ChatGPT's virtualization to mount
    // the earliest turns. Fallback delay catches any timeout.
    await settings.scrollTo(container, 0, 'smooth');
    await settings.settle(container);
    for (let step = 0; step < settings.maxSteps; step += 1) {
      if (settings.now() - startedAt > settings.timeoutMs) {
        throw new Error('Conversation scan timed out before reaching a stable bottom.');
      }
      const observation = captureMountedTurns(settings.readSections(container), settings, seen, state);
      const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 1;
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
    if (!link) continue;
    const label = (link.getAttribute('aria-label') || '').trim();
    if (label) return label;
    const inner = link.querySelector ? link.querySelector('.truncate') : null;
    const text = inner ? (inner.textContent || '').trim() : '';
    if (text) return text;
  }

  const title = (root.title || '').trim();
  if (!title) return null;
  const cleaned = title.replace(/\s*[|-]\s*ChatGPT\s*$/i, '').trim();
  return cleaned && cleaned.toLowerCase() !== 'chatgpt' ? cleaned : null;
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
  return slug || null;
}

/** Called by popup via chrome.scripting.executeScript — returns text, does NOT write clipboard. */
async function getConversationMarkdown() {
  try {
    const firstSection = document.querySelector('[data-turn-id]');
    let md;
    if (!firstSection) {
      md = extractConversationLegacy();
    } else {
      const container = findScrollContainer(firstSection);
      if (!container) return { ok: false, error: 'Could not find the conversation scroll area.' };
      const turns = await scanTurns(container, {
        readSections: function() { return document.querySelectorAll('[data-turn-id]'); },
        extractTurn: extractTurn,
      });
      md = buildConversationMarkdown(turns);
    }
    if (!md) return { ok: false, error: 'No conversation found on this page.' };
    const title = extractConversationTitle();
    if (title) md = '# ' + title + '\n\n' + md;
    return {
      ok: true,
      md: md,
      title: title,
      slug: slugifyTitle(title),
      lines: md.split('\n').length,
      words: md.split(/\s+/).filter(Boolean).length,
    };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
}

/** Fetch image data URLs from remote URLs using fetch().
 *  Extension host_permissions for image CDNs bypass CORS.
 *  Returns {url, dataUrl} for successfully fetched images; null on error. */
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
    extractConversationTitle: extractConversationTitle,
    extractImages: extractImages,
    fetchImageDataUrls: fetchImageDataUrls,
    slugifyTitle: slugifyTitle,
    extractTurn: extractTurn,
    findScrollContainer: findScrollContainer,
    getConversationMarkdown: getConversationMarkdown,
    nodeToMarkdown: nodeToMarkdown,
    orderCapturedTurns: orderCapturedTurns,
    parseTurnOrder: parseTurnOrder,
    scanTurns: scanTurns,
  };
}
