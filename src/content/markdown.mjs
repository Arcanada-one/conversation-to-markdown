/**
 * ChatGPT → Markdown
 * Content script: parses the live ChatGPT conversation and returns clean Markdown.
 *
 * Iterates [data-turn-id] sections (not just [data-message-author-role]) so that
 * generated images — which live outside the message div but inside the turn section —
 * are correctly captured. Strips query parameters from exported URLs (privacy).
 *
 * NO VERSION NUMBER IN THIS HEADER. It carried a stale one for two releases
 * while manifest.json had moved on, because a header comment is the one place
 * the version-coupling tests cannot see. A number that only some releases
 * remember to bump is worse than no number: it reads as authoritative and is
 * silently wrong. A test now keeps this header free of one.
 *
 * DOUBLE INJECTION IS EXPECTED. The manifest and popup can both inject the
 * shipped script into one document. Bun wraps module declarations in an IIFE
 * to prevent redeclaration errors; index.mjs exposes the callable API on
 * globalThis for chrome.scripting.executeScript callbacks.
 */
if (typeof globalThis !== 'undefined') globalThis.__c2mContentScriptLoaded = true;

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

/** Preserve signed ChatGPT file links, but do not copy third-party query strings. */
function resolveImageUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const baseUrl = typeof location !== 'undefined' ? location.href : 'https://chatgpt.com/';
    const resolved = new URL(rawUrl, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    if (
      resolved.hostname !== 'files.oaiusercontent.com' &&
      resolved.hostname !== 'chatgpt.com' &&
      resolved.hostname !== 'chat.openai.com'
    ) {
      stripUrlQuery(resolved);
    }
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
  // `katex-display` wraps the actual `katex` span. A word-boundary check also
  // matches that wrapper at the hyphen, turning display math into inline math.
  return typeof cls === 'string' && /(?:^|\s)katex(?:\s|$)/.test(cls);
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

function markdownDestination(href) {
  return /[()]/.test(href) ? '<' + href + '>' : href;
}

function markdownLabel(label) {
  return String(label).replace(/([\\\[\]])/g, '\\$1');
}

function markdownLink(label, href) {
  const safeLabel = (label || href).trim();
  return safeLabel ? '[' + markdownLabel(safeLabel) + '](' + markdownDestination(href) + ')' : href;
}

function nodeToMarkdown(node, depth) {
  if (depth === undefined) depth = 0;

  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const tag = node.tagName.toLowerCase();
  const children = function () {
    return Array.from(node.childNodes)
      .map(function (n) {
        return nodeToMarkdown(n, depth);
      })
      .join('');
  };

  if (node.getAttribute && node.getAttribute('data-file-reference') === 'true') {
    const name = node.getAttribute('data-markdown-copy-text') || node.textContent || '';
    return '`' + name.replace(/`/g, '') + '`';
  }

  // App-shell Markdown embeds table controls inside the rendered content.
  if (node.getAttribute && node.getAttribute('data-block-actions') !== null) return '';
  // The app shell renders a fenced code block as a div, not a pre. Its
  // data-markdown-copy marker encloses both the code and a toolbar; reading
  // children flattened the lines and added the toolbar's label and SVG.
  if (node.getAttribute && node.getAttribute('data-markdown-copy') === 'code-block') {
    const code = node.querySelector && node.querySelector('code');
    if (code) return '```\n' + code.textContent.replace(/\n$/, '') + '\n```\n\n';
  }
  if (isKatexMathml(node)) return '';
  if (isKatexRoot(node)) {
    // Visible KaTeX text flattens fractions into an ambiguous string. The
    // rendered formula carries its original TeX in a semantic annotation.
    const annotation = node.querySelector('annotation[encoding="application/x-tex"]');
    if (annotation && annotation.textContent) {
      const tex = annotation.textContent.trim();
      const display = node.parentElement && /\bkatex-display\b/.test(node.parentElement.className || '');
      return display ? '$$\n' + tex + '\n$$\n\n' : '$' + tex + '$';
    }
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
      const lang = codeEl ? (codeEl.className.match(/language-(\S+)/) || [])[1] || '' : '';
      const text = codeEl ? codeEl.textContent : node.textContent;
      return '```' + lang + '\n' + text + '\n```\n\n';
    }
    case 'h1':
      return '# ' + children() + '\n\n';
    case 'h2':
      return '## ' + children() + '\n\n';
    case 'h3':
      return '### ' + children() + '\n\n';
    case 'h4':
      return '#### ' + children() + '\n\n';
    case 'h5':
      return '##### ' + children() + '\n\n';
    case 'h6':
      return '###### ' + children() + '\n\n';
    case 'ul': {
      var items = Array.from(node.children)
        .map(function (li) {
          return '- ' + nodeToMarkdown(li, depth + 1).trim();
        })
        .join('\n');
      return items + '\n\n';
    }
    case 'ol': {
      var items = Array.from(node.children)
        .map(function (li, i) {
          return i + 1 + '. ' + nodeToMarkdown(li, depth + 1).trim();
        })
        .join('\n');
      return items + '\n\n';
    }
    case 'li':
      return children();
    case 'blockquote':
      return (
        children()
          .split('\n')
          .map(function (l) {
            return '> ' + l;
          })
          .join('\n') + '\n\n'
      );
    case 'a': {
      const href = node.getAttribute('href') || '';
      const text = children().trim();
      if (!href) return text;
      if (href.startsWith('sandbox:')) {
        const label = text || href.replace(/^sandbox:/, '');
        return (
          '> **Code Interpreter file:** `' + href + '`' + (label && label !== href ? ' (' + label + ')' : '') + '\n\n'
        );
      }
      const absHref = resolveHttpUrl(href);
      if (!absHref) return text;
      return text ? markdownLink(text, absHref) : absHref;
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
      return '![' + markdownLabel(alt) + '](' + markdownDestination(absSrc) + ')\n\n';
    }
    case 'hr':
      return '---\n\n';
    case 'table': {
      const rows = Array.from(node.querySelectorAll('tr'));
      if (!rows.length) return '';
      const parseRow = function (row) {
        return Array.from(row.querySelectorAll('th, td'))
          .map(function (cell) {
            return cell.textContent.trim();
          })
          .join(' | ');
      };
      const header = parseRow(rows[0]);
      const sep = header
        .split(' | ')
        .map(function () {
          return '---';
        })
        .join(' | ');
      const body = rows.slice(1).map(parseRow).join('\n');
      return (
        '| ' +
        header +
        ' |\n| ' +
        sep +
        ' |\n' +
        (body
          ? body
              .split('\n')
              .map(function (r) {
                return '| ' + r + ' |';
              })
              .join('\n') + '\n'
          : '') +
        '\n'
      );
    }
    case 'canvas':
      return artifactPlaceholder('canvas');
    case 'audio':
      return artifactPlaceholder('audio');
    case 'video':
      return artifactPlaceholder('video');
    case 'svg':
      if (node.getAttribute('aria-hidden') === 'true') return '';
      return artifactPlaceholder('svg');
    case 'button': {
      if (node.getAttribute('data-testid') === 'chatgpt-library-file-citation') {
        const label = node.getAttribute('aria-label') || '';
        const name = /([^\s/\\]+\.(?:md|txt|pdf|docx?|xlsx?|csv|json|zip|png|jpe?g))$/i.exec(label);
        if (name) return ' `' + name[1].replace(/`/g, '') + '` (referenced file; not downloaded)';
      }
      return '';
    }
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
    if (typeof img.closest === 'function' && (img.closest('.markdown') || img.closest('[class*="prose"]'))) continue;

    // All image URLs: preserve query params — estuary needs p+ts,
    // CDN needs SAS tokens. fetchImageDataUrls replaces them with
    // local paths after download.
    const absSrc = resolveImageUrl(src);
    if (!absSrc) continue;

    if (seenSrcs.has(absSrc)) continue;
    seenSrcs.add(absSrc);

    const alt = (img.getAttribute('alt') || '').trim();
    results.push('![' + markdownLabel(alt) + '](' + markdownDestination(absSrc) + ')');
  }

  return results;
}

/** Selectors that have identified an attachment chip, most specific first.
 *  More than one on purpose: a single `data-testid` value is a private contract
 *  that can be renamed without notice, and if the only selector misses, every
 *  attachment in every conversation disappears while the export still reports
 *  success. The fallbacks are shape-based (a link to a file host) so a rename
 *  degrades coverage instead of zeroing it. */
var ATTACHMENT_CHIP_SELECTORS = [
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
    return parsed.pathname.indexOf('/files/') !== -1 || parsed.pathname.indexOf('/estuary/') !== -1;
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
  const usedFallbackHrefMatch =
    matchedBy !== null && matchedBy !== ATTACHMENT_CHIP_SELECTORS[0] && matchedBy.indexOf('href') !== -1;

  for (const chip of chips) {
    if (typeof chip.closest === 'function' && (chip.closest('.markdown') || chip.closest('[class*="prose"]'))) {
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

export {
  ATTACHMENT_CHIP_SELECTORS,
  artifactPlaceholder,
  extractAttachments,
  extractAttachmentsDetailed,
  extractImages,
  hrefFromAttachmentChip,
  isAttachmentChip,
  isConversationFileUrl,
  isKatexMathml,
  isKatexRoot,
  labelFromAttachmentChip,
  markdownDestination,
  markdownLabel,
  markdownLink,
  nodeToMarkdown,
  resolveHttpUrl,
  resolveImageUrl,
  stripUrlQuery,
};
