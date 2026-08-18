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

/** Selectors that have identified an attachment chip, most specific first.
 *  More than one on purpose: a single `data-testid` value is a private contract
 *  that can be renamed without notice, and if the only selector misses, every
 *  attachment in every conversation disappears while the export still reports
 *  success. The fallbacks are shape-based (a link to a file host) so a rename
 *  degrades coverage instead of zeroing it. */
const ATTACHMENT_CHIP_SELECTORS = [
  '[data-testid="file-chip"]',
  '[data-testid*="file-chip"]',
  '[data-testid*="attachment"]',
  'a[href*="/files/"]',
  'a[href*="/backend-api/files/"]',
  'a[href*="files.oaiusercontent.com"]',
];

/** True only when the URL's PARSED host is one that serves conversation files.
 *  Exact host comparison, never a substring: `evil.example/?x=files.oaiuser
 *  content.com` and `files.oaiusercontent.com.attacker.net` both contain the
 *  string and neither is the host. */
function isConversationFileUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_e) {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.hostname === 'files.oaiusercontent.com') return true;
  if (parsed.hostname === 'chatgpt.com' || parsed.hostname === 'chat.openai.com') {
    return parsed.pathname.indexOf('/files/') !== -1 ||
      parsed.pathname.indexOf('/estuary/') !== -1;
  }
  return false;
}

/** Extract file attachments from a turn section outside the prose container.
 *  Returns the markdown links, and reports which selector actually matched so a
 *  drifted primary selector is distinguishable from a turn with no attachments —
 *  the two were previously both an empty array. */
function extractAttachmentsDetailed(section) {
  const seenHrefs = new Set();
  const results = [];
  const empty = { links: results, matchedBy: null, primaryMatched: false };
  if (!section || !section.querySelectorAll) return empty;

  let chips = [];
  let matchedBy = null;
  for (const selector of ATTACHMENT_CHIP_SELECTORS) {
    let found;
    try {
      found = section.querySelectorAll(selector);
    } catch (_e) {
      continue;
    }
    const list = found ? Array.from(found) : [];
    if (list.length) {
      chips = list;
      matchedBy = selector;
      break;
    }
  }

  // A `[href*="…"]` selector matches a SUBSTRING, so `https://evil.example/
  // ?x=files.oaiusercontent.com` satisfies it. Anything the fallbacks find is
  // therefore re-checked against the real parsed host before it is treated as an
  // attachment — the popup fetches these URLs, so a substring match is not a
  // sufficient reason to trust one.
  const usedFallbackHrefMatch = matchedBy !== null &&
    matchedBy !== ATTACHMENT_CHIP_SELECTORS[0] &&
    matchedBy.indexOf('href') !== -1;

  for (const chip of chips) {
    if (typeof chip.closest === 'function' &&
        (chip.closest('.markdown') || chip.closest('[class*="prose"]'))) {
      continue;
    }
    const href = hrefFromAttachmentChip(chip);
    if (!href || href.startsWith('sandbox:')) continue;
    const absHref = resolveImageUrl(href);
    if (!absHref || seenHrefs.has(absHref)) continue;
    if (usedFallbackHrefMatch && !isConversationFileUrl(absHref)) continue;
    seenHrefs.add(absHref);
    results.push(markdownLink(labelFromAttachmentChip(chip), absHref));
  }

  return {
    links: results,
    matchedBy: matchedBy,
    // False when attachments were found only by a fallback: the primary testid
    // no longer matches, which is worth surfacing before it silently becomes
    // "this conversation had no files".
    primaryMatched: matchedBy === ATTACHMENT_CHIP_SELECTORS[0],
  };
}

/** Backwards-compatible view: just the markdown links. */
function extractAttachments(section) {
  return extractAttachmentsDetailed(section).links;
}

/* ------------------------------------------------------------------------- *
 * Artefacts that render NO chip at all.
 *
 * Measured on a production conversation the operator supplied as one that
 * "definitely contains the documents": five generated PDF/DOCX files, and
 * EVERY ONE of the six ATTACHMENT_CHIP_SELECTORS found nothing —
 *
 *   a[href*="/files/"], a[href*="files.oaiusercontent.com"] -> []
 *   [data-testid*="file-chip"], [data-testid*="attachment"] -> {} (none)
 *   [download] -> []
 *
 * Code-interpreter output is rendered in a separate artefact <section> with no
 * href, no testid and no download attribute; the file name lives in a bare
 * <span> and the bytes are fetched on click. The panel is also OUTSIDE the
 * message tree (`button.closest('[data-message-id]')` === null at 28 ancestors),
 * so a per-turn DOM scan cannot associate a file with its message even in
 * principle. A DOM-only implementation would have exported ZERO documents from
 * that conversation while reporting success.
 *
 * The conversation API carries what the DOM does not, in one request and with no
 * translatable strings involved (verified: 200, 12 uploaded attachments with
 * {message_id, name, file_id, mime_type, size} plus 31 generated assets):
 *
 *   GET /backend-api/conversation/{id}          (Bearer from /api/auth/session)
 *   GET /backend-api/conversation/{id}/interpreter/download
 *         ?message_id=…&sandbox_path=/mnt/data/…   -> { download_url, … }
 *
 * `message_id` is MANDATORY on the download call (omitting it returns 422), and
 * it is only obtainable from the API — which is the reason this path exists
 * rather than being an optimisation of the DOM one.
 * ------------------------------------------------------------------------- */

/** Fetch the page's own session token. Same-origin, cookie-authenticated; the
 *  token is never stored, logged, or sent anywhere but chatgpt.com. */
async function fetchSessionToken(fetchImpl) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return null;
  try {
    const response = await doFetch('/api/auth/session', {
      credentials: 'include',
      headers: { accept: 'application/json' },
    });
    if (!response || !response.ok) return null;
    const body = await response.json();
    return (body && body.accessToken) || null;
  } catch (_e) {
    return null;
  }
}

/** Enumerate a conversation's artefacts from the API.
 *
 *  Returns null — not an empty list — when the API could not be read. The
 *  distinction matters: "no artefacts" and "could not tell" must never collapse
 *  into the same value, or a failed request reads as a clean conversation. */
async function fetchConversationArtifacts(conversationId, options) {
  const opts = options || {};
  const doFetch = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch || !conversationId) return null;
  const token = opts.token !== undefined
    ? opts.token
    : await fetchSessionToken(doFetch);
  if (!token) return null;

  let payload;
  try {
    const response = await doFetch('/backend-api/conversation/' + conversationId, {
      credentials: 'include',
      headers: { accept: 'application/json', authorization: 'Bearer ' + token },
    });
    if (!response || !response.ok) return null;
    payload = await response.json();
  } catch (_e) {
    return null;
  }
  if (!payload || !payload.mapping) return null;

  const artifacts = [];
  const seen = new Set();
  for (const node of Object.values(payload.mapping)) {
    const message = node && node.message;
    if (!message) continue;
    const messageId = message.id || null;
    const metadata = message.metadata || {};

    for (const attachment of metadata.attachments || []) {
      const key = 'att:' + (attachment.id || attachment.name);
      if (!attachment.name || seen.has(key)) continue;
      seen.add(key);
      artifacts.push({
        kind: 'attachment',
        messageId: messageId,
        name: attachment.name,
        fileId: attachment.id || null,
        mimeType: attachment.mime_type || null,
        size: typeof attachment.size === 'number' ? attachment.size : null,
        sandboxPath: null,
      });
    }

    const parts = (message.content || {}).parts || [];
    for (const part of parts) {
      if (!part || typeof part !== 'object' || !part.asset_pointer) continue;
      const pointer = String(part.asset_pointer);
      if (seen.has('ast:' + pointer)) continue;
      seen.add('ast:' + pointer);
      artifacts.push({
        kind: 'asset',
        messageId: messageId,
        name: part.name || null,
        // "sediment://file_abc" / "file-service://file_abc" -> the file id.
        fileId: (pointer.match(/(file[-_][A-Za-z0-9]+)/) || [])[1] || null,
        mimeType: part.mime_type || null,
        size: typeof part.size === 'number' ? part.size : null,
        sandboxPath: null,
      });
    }
  }
  return artifacts;
}

/** Resolve a sandbox artefact (code-interpreter output) to a fetchable URL.
 *  Returns null on any failure — the caller must not invent a URL. */
async function resolveSandboxDownloadUrl(conversationId, messageId, sandboxPath, options) {
  const opts = options || {};
  const doFetch = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch || !conversationId || !messageId || !sandboxPath) return null;
  const token = opts.token !== undefined
    ? opts.token
    : await fetchSessionToken(doFetch);
  if (!token) return null;
  const url = '/backend-api/conversation/' + conversationId +
    '/interpreter/download?message_id=' + encodeURIComponent(messageId) +
    '&sandbox_path=' + encodeURIComponent(sandboxPath);
  try {
    const response = await doFetch(url, {
      credentials: 'include',
      headers: { accept: 'application/json', authorization: 'Bearer ' + token },
    });
    if (!response || !response.ok) return null;
    const body = await response.json();
    const resolved = body && (body.download_url || body.url);
    if (!resolved || !isConversationFileUrl(resolved)) return null;
    return {
      url: resolved,
      fileName: (body && body.file_name) || null,
      mimeType: (body && body.mime_type) || null,
      size: (body && typeof body.file_size_bytes === 'number')
        ? body.file_size_bytes
        : null,
    };
  } catch (_e) {
    return null;
  }
}

/** Resolve every artefact panel file to a download URL.
 *
 *  `message_id` is mandatory on the endpoint but does NOT select the file:
 *  measured against 12 different message ids in the same conversation, all
 *  returned the SAME file id for one sandbox_path (`distinctFileIds` length 1).
 *  The path identifies the bytes; the id is only required context. So one
 *  working id is found once and reused, instead of retrying per file — which
 *  would otherwise be O(files x messages) requests against the operator's
 *  account for no gain.
 */
async function resolveArtifactPanelFiles(conversationId, options) {
  const opts = options || {};
  const files = opts.files || listArtifactPanelFiles(opts.doc);
  if (!files.length) return [];
  const doFetch = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const token = opts.token !== undefined
    ? opts.token
    : await fetchSessionToken(doFetch);
  if (!token) return files.map((f) => ({ file: f, resolved: null }));

  const messageIds = opts.messageIds || [];
  let workingId = opts.messageId || null;
  const out = [];
  for (const file of files) {
    let resolved = null;
    if (workingId) {
      resolved = await resolveSandboxDownloadUrl(
        conversationId, workingId, file.sandboxPath,
        { fetchImpl: doFetch, token: token });
    }
    if (!resolved) {
      // No id known to work yet (or it stopped working): find one, once.
      for (const candidate of messageIds) {
        const attempt = await resolveSandboxDownloadUrl(
          conversationId, candidate, file.sandboxPath,
          { fetchImpl: doFetch, token: token });
        if (attempt) { workingId = candidate; resolved = attempt; break; }
      }
    }
    out.push({ file: file, resolved: resolved });
  }
  return out;
}

/** Wait for the artefact panel to mount, then list it.
 *
 *  Measured on production: after navigating to a conversation, `[data-message-id]`
 *  turns appeared at ~9s and the artefact rows only at ~12s — no scrolling
 *  involved, just render latency. Reading one frame at 11s returned nothing, so
 *  an export triggered right after opening a conversation dropped all five of its
 *  generated documents without a word.
 *
 *  Bounded and silent on absence: most conversations have no panel at all, and
 *  waiting the full budget for every one of them would slow every export. The
 *  loop therefore exits as soon as rows appear, and gives up quietly otherwise.
 */
async function waitForArtifactPanel(doc, options) {
  const opts = options || {};
  const root = doc || (typeof document !== 'undefined' ? document : null);
  const budgetMs = opts.panelWaitMs === undefined ? 15000 : opts.panelWaitMs;
  const stepMs = opts.panelPollMs === undefined ? 500 : opts.panelPollMs;
  const sleep = opts.sleep || function(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  };
  const now = opts.now || function() { return Date.now(); };

  const deadline = now() + budgetMs;
  let files = listArtifactPanelFiles(root);
  while (!files.length && now() < deadline) {
    await sleep(stepMs);
    files = listArtifactPanelFiles(root);
  }
  return files;
}

/** Read the artefact panel's rows from the DOM: file name plus its sandbox path.
 *  This supplies the sandbox_path the API needs for interpreter output. The panel
 *  is identified structurally (no testid exists) and its label is the file name,
 *  which is user data rather than a translated UI string. */
function listArtifactPanelFiles(doc) {
  const root = doc || (typeof document !== 'undefined' ? document : null);
  if (!root || !root.querySelectorAll) return [];
  let buttons;
  try {
    buttons = root.querySelectorAll('button[class*="open-file"], [class*="artifact-row"] button');
  } catch (_e) {
    return [];
  }
  const files = [];
  const seen = new Set();
  for (const button of buttons) {
    const label = button.getAttribute ? (button.getAttribute('aria-label') || '') : '';
    // A file name, not the sibling download button whose label is translated
    // ("Download file" / "Скачать файл"). An extension is the discriminator.
    if (!/\.[A-Za-z0-9]{1,8}$/.test(label) || seen.has(label)) continue;
    seen.add(label);
    files.push({ name: label, sandboxPath: '/mnt/data/' + label });
  }
  return files;
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
async function appendPanelArtifacts(markdown, options) {
  const opts = options || {};
  const doc = opts.doc || (typeof document !== 'undefined' ? document : null);
  // The panel mounts LATE. Measured on production: turns appeared at 9s and the
  // artefact rows only at 12s after navigation, with no scrolling needed. A
  // single-frame read at 11s found nothing, so a user who exports immediately
  // after opening a conversation would silently lose every generated file. Wait
  // for it, bounded — and treat "still absent" as absent, not as an error.
  const conversationId = opts.conversationId ||
    ((typeof location !== 'undefined' ? location.pathname : '')
      .match(/\/c\/([A-Za-z0-9-]+)/) || [])[1] || null;
  if (!conversationId) return markdown;

  const artifacts = opts.artifacts !== undefined
    ? opts.artifacts
    : await fetchConversationArtifacts(conversationId, opts);

  // Ask the API FIRST, then decide whether waiting for the panel is worth it.
  // Most conversations have no generated files, and paying the panel-wait budget
  // on every one of them would slow every export for nothing. When the API says
  // there is nothing to find, a single-frame read is enough; when it reports
  // artefacts (or could not be read at all), wait for the panel to mount.
  let files = opts.files;
  if (!files) {
    const mayHaveFiles = artifacts === null || artifacts.length > 0;
    files = mayHaveFiles
      ? await waitForArtifactPanel(doc, opts)
      : listArtifactPanelFiles(doc);
  }
  if (!files.length) return markdown;

  // Candidate message ids for the download call. Measured: the endpoint requires
  // a message_id but does NOT use it to select the file — 12 different ids
  // resolved one sandbox_path to the same file id. So ANY id from the
  // conversation works, and taking them only from messages that already showed
  // an artefact is wrong: a conversation can hold a generated PDF while no
  // message carries an attachment or asset_pointer, leaving nothing to try and
  // the file unresolved.
  //
  // null artifacts means the API could not be read at all — kept distinct below
  // rather than implying the conversation had no files.
  let messageIds = opts.messageIds;
  if (!messageIds) {
    messageIds = artifacts
      ? artifacts.map(function(a) { return a.messageId; }).filter(Boolean)
      : [];
    if (!messageIds.length) {
      // Fall back to the ids the DOM carries; the panel is outside the message
      // tree but the turns themselves are still in the page.
      const nodes = doc && doc.querySelectorAll
        ? doc.querySelectorAll('[data-message-id]')
        : [];
      for (const node of Array.from(nodes)) {
        const id = node.getAttribute ? node.getAttribute('data-message-id') : null;
        if (id) messageIds.push(id);
      }
    }
  }

  const resolvedList = await resolveArtifactPanelFiles(conversationId, {
    files: files,
    messageIds: messageIds,
    fetchImpl: opts.fetchImpl,
    token: opts.token,
  });

  const lines = [];
  const unresolved = [];
  for (const entry of resolvedList) {
    if (entry.resolved && entry.resolved.url) {
      lines.push(markdownLink(entry.file.name, entry.resolved.url));
    } else {
      unresolved.push(entry.file.name);
    }
  }
  // Deliberately overlapping with the `!files.length` early return above: that
  // one avoids the network round-trips entirely, this one covers a resolver that
  // returned no rows for files that DID exist. A mutation removing the earlier
  // guard is therefore harmless to output and survives the suite — recorded in
  // MUTATION-EVIDENCE.md as redundant-by-design rather than an untested branch,
  // so it is not "fixed" by deleting one of the two.
  if (!lines.length && !unresolved.length) return markdown;

  const block = ['## Files'];
  if (lines.length) block.push(lines.join('\n'));
  if (unresolved.length) {
    block.push('> Could not retrieve a download link for: ' +
      unresolved.join(', ') +
      (artifacts === null ? ' (the conversation API was unreachable)' : ''));
  }
  const body = block.join('\n\n');
  return markdown ? markdown + '\n\n---\n\n' + body : body;
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

/** Remove the accessibility suffix ChatGPT appends to a project row's label.
 *
 *  The suffix is a TRANSLATED UI string, so it cannot be matched by its words.
 *  Measured on production with the same account under two browser locales:
 *
 *    en-GB : "Перезапуск nginx, chat in project Aether"
 *    ru-RU : "Перезапуск nginx, чат в проекте Aether"
 *
 *  A regex for "chat in project" strips the first and misses the second, baking
 *  the project name into every folder name for a Russian-UI user. So the suffix
 *  is removed STRUCTURALLY instead: the row's own visible text is the bare
 *  title, and the label is that title followed by the localized description.
 *  Verified on all 10 sampled rows under ru-RU: aria-label always startsWith
 *  the visible text (suffix "" for global chats, ", чат в проекте X" inside a
 *  project). No language knowledge is involved. */
function stripSidebarLabelSuffix(label, visibleTitle) {
  const raw = String(label).trim();
  const visible = String(visibleTitle == null ? '' : visibleTitle).trim();
  if (visible && raw.startsWith(visible) && raw.length > visible.length) {
    // Only a separator-led remainder is a suffix. A conversation whose title
    // merely begins with a shorter row text keeps its full name.
    const remainder = raw.slice(visible.length);
    // Punctuation, not whitespace. A row truncates a long title with an ellipsis
    // while aria-label keeps the full one ("Проектирование хранилища" against
    // "Проектирование хранилища секретов"), so a space-led remainder is the REST
    // OF THE TITLE and cutting there renames the folder after a clipped title.
    if (/^\s*[,;:—–]/.test(remainder)) return visible;
  }
  return raw;
}

/** Read a sidebar conversation link's visible title.
 *  The visible text is preferred over aria-label because it carries the title
 *  WITHOUT the localized ", chat in project …" / ", чат в проекте …" suffix. */
function titleFromSidebarLink(link) {
  if (!link) return null;
  const inner = link.querySelector ? link.querySelector('.truncate') : null;
  const visible = inner
    ? (inner.textContent || '').trim()
    : (link.textContent || '').trim();
  const label = (link.getAttribute('aria-label') || '').trim();
  if (visible) return stripSidebarLabelSuffix(label || visible, visible);
  return label ? stripSidebarLabelSuffix(label, '') : null;
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
  if (idMatch) {
    candidates.push('a[href="/c/' + idMatch[1] + '"]');
    // A conversation inside a Project is linked as
    // /g/g-p-{projectId}/c/{convId}, so an exact `/c/{id}` match misses it and
    // the lookup used to fall through to document.title — which carries the
    // project name as a prefix. Verified on production.
    candidates.push('a[href$="/c/' + idMatch[1] + '"]');
  }
  candidates.push('a[data-active][href^="/c/"]');
  candidates.push('a[data-active][href*="/c/"]');

  for (const selector of candidates) {
    const link = root.querySelector(selector);
    const title = titleFromSidebarLink(link);
    if (title) return title;
  }

  const title = (root.title || '').trim();
  if (!title) return null;
  let cleaned = title.replace(/\s*[|-]\s*ChatGPT\s*$/i, '').trim();
  // Last-resort source: on a project conversation the document title reads
  // "Qoople - Перевод i18n JSON для сайта". Drop a leading "<project> - " when
  // the project name is known, so the folder is not named after the project.
  const projectName = knownProjectName(root);
  if (projectName) {
    const prefix = new RegExp('^' + escapeForRegExp(projectName) + '\\s*[-–—|]\\s*');
    const withoutProject = cleaned.replace(prefix, '').trim();
    if (withoutProject) cleaned = withoutProject;
  }
  return cleaned && cleaned.toLowerCase() !== 'chatgpt' ? cleaned : null;
}

function escapeForRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The current Project's display name, when the page is inside one.
 *
 *  Read from the sidebar's PROJECT SECTION rather than parsed out of the row's
 *  localized label. The previous version matched ", chat in project (.+)$",
 *  which returns null under a Russian UI (", чат в проекте Aether") — so the
 *  document.title fallback then kept the "<project> - " prefix and named the
 *  folder after the project. The project row is identified by its href, which
 *  no locale translates. */
function knownProjectName(doc) {
  const root = doc || (typeof document !== 'undefined' ? document : null);
  if (!root || !root.querySelector) return null;
  const path = typeof location !== 'undefined' ? location.pathname : '';
  const idMatch = path.match(/\/c\/([A-Za-z0-9-]+)/);
  if (!idMatch) return null;

  // Inside a project the route itself carries the project id.
  const routeProject = path.match(/\/g\/(g-p-[A-Za-z0-9]+)\//);
  const link = root.querySelector('a[href$="/c/' + idMatch[1] + '"]');
  const href = link ? link.getAttribute('href') || '' : '';
  const projectId = (routeProject && routeProject[1])
    || (href.match(/\/g\/(g-p-[A-Za-z0-9]+)\//) || [])[1]
    || null;
  if (!projectId) return null;

  // A project has NO anchor of its own: measured on production, the sidebar
  // renders projects as div[role="button"] and `nav a[href^="/g/"]` without a
  // /c/ part returns []. So the name is taken from the project row that
  // CONTAINS this conversation's row — found by structure, not by language.
  if (!link) return null;
  // Walk out to the project group and read its header row's visible text.
  let cur = link.parentElement;
  for (let depth = 0; depth < 12 && cur; depth++) {
    const header = cur.querySelector
      ? cur.querySelector('[role="button"] .truncate, button[data-sidebar-item] .truncate')
      : null;
    if (header) {
      const name = (header.textContent || '').trim();
      // A header that is itself a conversation row is not a project name.
      const ownsRows = cur.querySelectorAll
        ? cur.querySelectorAll('a[href*="/c/"]').length
        : 0;
      if (name && ownsRows > 0) return name;
    }
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Enumerate the conversation links CURRENTLY MOUNTED in the sidebar.
 * Verified against production: matches both /c/{id} and the project-scoped
 * /g/g-p-{projectId}/c/{id} shape.
 *
 * This reads one frame only. The sidebar is virtualized, so on a long list this
 * returns a SUBSET. Callers exporting a whole Project must use
 * collectSidebarConversations(), which scrolls until the set stops growing and
 * reports whether the end was actually reached — a subset presented as the
 * complete Project is the failure this split exists to prevent.
 */
function listSidebarConversations(doc) {
  const root = doc || (typeof document !== 'undefined' ? document : null);
  if (!root || !root.querySelectorAll) return [];

  // Two href shapes, both real: a plain conversation is /c/{id}, and one that
  // lives in a Project is /g/g-p-{projectId}/c/{id}. Matching only the first
  // meant a batch started on a Project silently exported the global "Chats"
  // list instead — a different set, not a subset. Verified on production.
  const links = root.querySelectorAll('nav a[href*="/c/"]');
  const seen = new Set();
  const results = [];
  for (const link of links) {
    const href = link.getAttribute('href') || '';
    // A query string or fragment may follow the id: production serves rows like
    // `…/c/{id}?messageId=finalAgentTurnStart`, and anchoring at the id dropped
    // exactly one real conversation from each project that had one.
    const match = href.match(/^(?:\/g\/(g-p-[A-Za-z0-9]+))?\/c\/([A-Za-z0-9-]+)(?:[?#].*)?$/);
    if (!match) continue;
    const projectId = match[1] || null;
    const id = match[2];
    if (seen.has(id)) continue;
    seen.add(id);
    const title = titleFromSidebarLink(link);
    results.push({
      id: id,
      // Navigate to the href the page itself uses: a project conversation
      // reached through /c/{id} loses its project context.
      href: href,
      projectId: projectId,
      title: title,
      slug: slugifyTitle(title) || id,
    });
  }
  return results;
}

/** Collapsed Project rows in the sidebar, which must be expanded before their
 *  conversations exist in the DOM at all.
 *
 *  Verified on production: a Project is a `div[role="button"]` inside a
 *  `group/project-unfurl-row` container, with NO href and NO data-testid, and it
 *  starts collapsed. Until it is clicked, none of its conversations are present —
 *  so a walk that only scrolls and paginates still sees zero of them, however
 *  thoroughly it verifies its coverage of what IS mounted. */
/** The list item that holds a project row AND, once open, its conversations. */
function projectRowContainer(row) {
  let current = row;
  for (let depth = 0; depth < 5 && current; depth++) {
    const tag = current.tagName ? current.tagName.toLowerCase() : '';
    if (tag === 'li') return current;
    current = current.parentElement;
  }
  return row ? row.parentElement || row : null;
}

function findCollapsedProjectRows(doc) {
  const root = doc || (typeof document !== 'undefined' ? document : null);
  if (!root || !root.querySelectorAll) return [];
  let rows;
  try {
    rows = root.querySelectorAll('[class*="project-unfurl-row"]');
  } catch (_e) {
    return [];
  }
  const found = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || !row.querySelector) continue;
    // Openness must be judged on the row's CONTAINER, not the row: verified on
    // production, an expanded project renders its conversations as SIBLINGS of
    // the unfurl row, so the row itself always holds zero links. Testing the row
    // made every project look permanently collapsed, and re-clicking an open one
    // closes it — the walk toggled projects shut instead of opening them.
    const container = projectRowContainer(row);
    let openLinks = 0;
    try {
      openLinks = container ? container.querySelectorAll('a[href*="/c/"]').length : 0;
    } catch (_e) {
      openLinks = 0;
    }
    if (openLinks) continue;
    let control = null;
    try {
      control = row.getAttribute && row.getAttribute('role') === 'button'
        ? row
        : row.querySelector('[role="button"]');
    } catch (_e) {
      control = null;
    }
    if (!control || typeof control.click !== 'function') continue;
    const label = (row.textContent || '').trim().slice(0, 60);
    // The same project renders more than one matching container; one click each.
    if (!label || seen.has(label)) continue;
    seen.add(label);
    found.push({ control: control, label: label });
  }
  return found;
}

/** Find the pagination ("Show more") control in the sidebar, if one is present.
 *
 *  A Project's conversation list is paginated by a CLICK, not by scrolling: the
 *  first rows render, then one more row reveals the rest (verified on
 *  production: one project went from 5 to 35 conversations). Scrolling alone can
 *  never reach past it, so a walk that only scrolls reports a confident subset.
 *
 *  The label is a TRANSLATED UI string and MUST NOT be matched by its words.
 *  Measured on the same account under two browser locales:
 *
 *    en-GB : "Show more"
 *    ru-RU : "Показать больше"
 *
 *  A /^show more$/i test finds the first and misses the second, so a Russian-UI
 *  user's projects silently paginate shut — and, worse, "no control standing"
 *  reads as "no pagination exists", which the completeness check then reports as
 *  a COMPLETE list. The control is therefore identified STRUCTURALLY, by what
 *  distinguishes it from every other sidebar item (measured under ru-RU):
 *
 *    - it is the LAST item of a nested <ul> …
 *    - … whose other children are conversation links (siblingConvLinks > 0)
 *    - it is not itself a link and holds no <a> (a conversation row would)
 *    - it carries no icon (svgCount 0, unlike the other sidebar buttons)
 *
 *  Text is used only as a corroborating hint, never as a requirement. */
function isPaginationControl(button) {
  if (!button || typeof button.click !== 'function') return false;
  try {
    if (button.getAttribute && button.getAttribute('href')) return false;
    if (button.querySelector && button.querySelector('a[href]')) return false;
    const li = button.closest ? button.closest('li') : null;
    const ul = li ? li.parentElement : null;
    if (!li || !ul || !ul.children) return false;
    const kids = Array.from(ul.children);
    if (kids.indexOf(li) !== kids.length - 1) return false;
    const siblingConvLinks = ul.querySelectorAll
      ? ul.querySelectorAll('a[href*="/c/"]').length
      : 0;
    if (!siblingConvLinks) return false;
    // The row itself must not be a conversation.
    if (li.querySelector && li.querySelector('a[href*="/c/"]')) return false;
    return true;
  } catch (_e) {
    return false;
  }
}

function findShowMoreControl(doc) {
  const root = doc || (typeof document !== 'undefined' ? document : null);
  if (!root || !root.querySelectorAll) return null;
  let buttons;
  try {
    buttons = root.querySelectorAll(
      'nav button[data-sidebar-item], nav button, nav [role="button"]'
    );
  } catch (_e) {
    return null;
  }
  for (const button of buttons) {
    if (isPaginationControl(button)) return button;
  }
  return null;
}

/** Locate the scrollable sidebar element holding the conversation list. */
function findSidebarScroller(doc) {
  const root = doc || (typeof document !== 'undefined' ? document : null);
  if (!root || !root.querySelector) return null;
  const anchor = root.querySelector('nav a[href*="/c/"]');
  if (!anchor) return null;
  let current = anchor.parentElement;
  while (current) {
    let overflowY = '';
    try {
      overflowY = (typeof getComputedStyle === 'function'
        ? (getComputedStyle(current).overflowY || '')
        : '');
    } catch (_e) {
      overflowY = '';
    }
    const scrollable = /(auto|scroll|overlay)/.test(overflowY) ||
      (current.scrollHeight || 0) > (current.clientHeight || 0) + 1;
    if (scrollable && (current.scrollHeight || 0) > (current.clientHeight || 0) + 1) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

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
  const maxShowMoreClicks = supplied.maxShowMoreClicks === undefined
    ? 60
    : supplied.maxShowMoreClicks;
  // Revealing a page is a network round-trip; it needs longer than a scroll.
  const showMoreSettleMs = supplied.showMoreSettleMs || 1200;
  // Projects start collapsed; opening one is a click plus a fetch.
  const expandProjects = supplied.expandProjects !== false;
  const maxProjectExpansions = supplied.maxProjectExpansions === undefined
    ? 40
    : supplied.maxProjectExpansions;
  const projectSettleMs = supplied.projectSettleMs || 1400;
  // A final re-read pass: rows keep mounting behind the downward walk.
  const finalSweep = supplied.finalSweep !== false;
  const maxSweepPasses = supplied.maxSweepPasses === undefined ? 6 : supplied.maxSweepPasses;
  const sleep = supplied.sleep || function(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
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
    const spans = coveredSpans.slice().sort(function(a, b) { return a[0] - b[0]; });
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
    const at = scroller ? (scroller.scrollTop || 0) : 0;
    const spanCountBefore = coveredSpans.length;
    mountedBand = recordCoverage(at);
    const newSpan = coveredSpans.length > spanCountBefore
      ? coveredSpans[coveredSpans.length - 1]
      : null;
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

  if (!scroller) {
    // Nothing to scroll. Either the whole list already fits, or the container
    // moved and we cannot tell how much is missing — say which.
    return {
      conversations: Array.from(byId.values()),
      complete: true,
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
    const reach = mountedBand > 0
      ? Math.min(mountedBand, scroller.clientHeight || mountedBand)
      : (scroller.clientHeight || 0);
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
      complete = (coverageVerified ? coverageIsContiguous() : true) &&
        visitedTop && visitedBottom && tail.proven;
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
        position += sweepStep;
      }
      if (byId.size === before) break;
    }
    // Coverage was re-measured across the whole range, so re-decide on it.
    if (coveredSpans.length) {
      coverageVerified = true;
      const sweptTail = tailIsProven();
      tailReason = sweptTail.reason;
      complete = coverageIsContiguous() && showMoreExhausted &&
        visitedTop && visitedBottom && sweptTail.proven;
    }
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
  } else if (blocked) {
    reason = 'scroll-blocked';
  } else if (!showMoreExhausted) {
    reason = 'show-more-pending';
  } else if (tailReason === 'successor-exists-not-mounted' ||
             tailReason === 'tail-unprovable') {
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
    // `~` is reserved as the marker that introduces a conversation id in an export
    // filename. Excluding it here is what makes the two name formats
    // non-overlapping: a title can otherwise contain anything a separator or an id
    // can contain, and a name written by an older version could then be read as a
    // current one belonging to a different conversation. Removing the character from
    // titles is cheap; the ambiguity it prevents cost a conversation.
    .replace(/~+/g, '-')
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
async function getConversationMarkdown(settings) {
  // Retrieving generated artefacts requires calling ChatGPT's own conversation
  // API. PRIVACY.md states that saving files is the ONLY mode in which the
  // extension makes network requests, so that lookup is opt-in and off by
  // default: a plain "copy as Markdown" stays a pure DOM read.
  const wantFiles = !!(settings && settings.downloadFiles);
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
    // Generated (code-interpreter) files render in a panel outside the message
    // tree with no href and no testid, so the per-turn scan above cannot see
    // them. Appending them here puts them in the markdown, which is where the
    // popup's downloader looks for artefacts.
    if (wantFiles) md = await appendPanelArtifacts(md, {});
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
    extractAttachmentsDetailed: extractAttachmentsDetailed,
    ATTACHMENT_CHIP_SELECTORS: ATTACHMENT_CHIP_SELECTORS,
    extractConversationTitle: extractConversationTitle,
    extractImages: extractImages,
    fetchImageDataUrls: fetchImageDataUrls,
    listSidebarConversations: listSidebarConversations,
    collectSidebarConversations: collectSidebarConversations,
    findSidebarScroller: findSidebarScroller,
    findShowMoreControl: findShowMoreControl,
    fetchSessionToken: fetchSessionToken,
    fetchConversationArtifacts: fetchConversationArtifacts,
    resolveSandboxDownloadUrl: resolveSandboxDownloadUrl,
    listArtifactPanelFiles: listArtifactPanelFiles,
    resolveArtifactPanelFiles: resolveArtifactPanelFiles,
    appendPanelArtifacts: appendPanelArtifacts,
    waitForArtifactPanel: waitForArtifactPanel,
    findCollapsedProjectRows: findCollapsedProjectRows,
    projectRowContainer: projectRowContainer,
    stripSidebarLabelSuffix: stripSidebarLabelSuffix,
    knownProjectName: knownProjectName,
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
