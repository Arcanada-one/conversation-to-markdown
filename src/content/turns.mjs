import { extractAttachments, extractImages, nodeToMarkdown } from './markdown.mjs';
import { conversationScrollTop } from './scroll.mjs';

function orderCapturedTurns(turns) {
  const ordered = turns instanceof Map ? Array.from(turns.values()) : Array.from(turns);
  const hasCompleteNumericOrder = ordered.every(function (turn) {
    return turn.order !== null && turn.order !== undefined;
  });
  return ordered.sort(function (a, b) {
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

/** App-shell DOM measured on 2026-09-27. A turn-key wraps both roles.
 * Search units, not turn-key containers, are the independently captured messages.
 * Use semantic attributes; hashed CSS names and translated headings are unstable.
 */
function modernMessageRole(section) {
  if (!section.getAttribute || section.getAttribute('data-chatgpt-search-unit-key') === null) return null;
  if (section.querySelector('[data-user-message-bubble]')) return 'user';
  if (section.querySelector('[data-conversation-role]') && section.querySelector('[data-chatgpt-selection-message-id]'))
    return 'assistant';
  return null;
}

function modernMessageSections(root) {
  if (!root || !root.querySelectorAll) return [];
  return Array.from(root.querySelectorAll('[data-chatgpt-search-unit-key]')).filter(function (unit) {
    // Scope to measured conversation turns, excluding search panels and previews.
    return unit.closest && unit.closest('[data-turn-key]');
  });
}

/** History boundary measured in Chrome on 2026-09-29: the direct header
 * status persists while older pages exist, then disappears at the first message.
 * The hidden separator and zero-offset virtual slots distinguish this layout
 * from arbitrary status widgets and from a viewport mounted halfway down.
 */
function readModernPagination(container) {
  const root = container.querySelector && container.querySelector('[data-thread-find-target="conversation"]');
  if (!root || root.getAttribute('data-chatgpt-conversation-selection-target') !== 'true') return null;
  const children = Array.from(root.children || []);
  const separatorIndex = children.findIndex(function (el) {
    return el.tagName === 'SPAN' && el.getAttribute('hidden') !== null;
  });
  if (separatorIndex < 0) return null;
  const virtualizer = children[separatorIndex + 1];
  const list = virtualizer && virtualizer.children && virtualizer.children[0];
  const slot = list && list.children && list.children[0];
  if (!virtualizer || !virtualizer.style || !virtualizer.style.height || !slot) return null;
  const pending = children.slice(0, separatorIndex).some(function (el) {
    return el.getAttribute('role') === 'status' || !!el.querySelector('[role="status"]');
  });
  const first = modernMessageSections(root)[0];
  const firstInSlot = modernMessageSections(slot)[0];
  const atFirstSlot =
    !!first &&
    first === firstInSlot &&
    list.style &&
    slot.style &&
    list.style.marginTop === '0px' &&
    slot.style.marginTop === '0px';
  return {
    pending: pending,
    // The status is a history-availability indicator, including while idle.
    // Allow the existing edge re-arm to nudge it after two quiet rounds.
    loading: false,
    count: modernMessageSections(root).length,
    complete: !pending && atFirstSlot && conversationScrollTop(container) <= 1,
  };
}

function extractModernMessage(section, discoveryIndex) {
  const role = modernMessageRole(section);
  const turnId = getSectionTurnId(section);
  if (!role || !turnId) return null;
  let markdown;
  if (role === 'user') {
    const bubble = section.querySelector('[data-user-message-bubble]');
    // The outer bubble also contains the translated "Show more" control.
    markdown = Array.from(bubble.querySelectorAll('.whitespace-pre-wrap'))
      .map(function (node) {
        return node.textContent.trim();
      })
      .filter(Boolean)
      .join('\n\n');
    const attachments = extractAttachments(section).concat(extractImages(section));
    if (attachments.length) markdown += (markdown ? '\n\n' : '') + attachments.join('\n\n');
  } else {
    const message = section.querySelector('[data-chatgpt-selection-message-id]');
    markdown = Array.from(message.querySelectorAll('[data-markdown-text-style]'))
      .filter(function (node) {
        return !node.parentElement || !node.parentElement.closest('[data-markdown-text-style]');
      })
      .map(function (node) {
        return nodeToMarkdown(node).trim();
      })
      .filter(Boolean)
      .join('\n\n');
    // Do not duplicate inline images/links already converted by nodeToMarkdown.
    for (const extra of extractAttachments(section).concat(extractImages(section))) {
      if (!markdown.includes(extra)) markdown += (markdown ? '\n\n' : '') + extra;
    }
  }
  if (!markdown) return null;
  return createTurn(turnId, section, discoveryIndex, role, markdown.replace(/\n{3,}/g, '\n\n'));
}

function getSectionTurnId(section) {
  if (typeof section.getAttribute === 'function') {
    const legacy = section.getAttribute('data-turn-id') || section.turnId;
    if (legacy) return legacy;
    const unitKey = section.getAttribute('data-chatgpt-search-unit-key');
    const holder = unitKey !== null && section.closest && section.closest('[data-turn-key]');
    return holder ? JSON.stringify([holder.getAttribute('data-turn-key'), unitKey]) : null;
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
  if (section.getAttribute && section.getAttribute('data-chatgpt-search-unit-key') !== null) {
    return extractModernMessage(section, discoveryIndex);
  }
  const turnId = getSectionTurnId(section);
  const role = getSectionRole(section);
  if (!turnId) return null;

  if (role === 'user') {
    const message = section.querySelector('[data-message-author-role="user"]');
    const bubble =
      message && (message.querySelector('.whitespace-pre-wrap') || message.querySelector('[dir="auto"]') || message);
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
      const markdownRoot = message.querySelector('.markdown') || message.querySelector('[class*="prose"]') || message;
      const markdown = nodeToMarkdown(markdownRoot)
        .trim()
        .replace(/\n{3,}/g, '\n\n');
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
        const markdown = nodeToMarkdown(root)
          .trim()
          .replace(/\n{3,}/g, '\n\n');
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

export {
  buildConversationMarkdown,
  createTurn,
  extractModernMessage,
  extractTurn,
  getSectionRole,
  getSectionTurnId,
  isExplicitlyUnsupportedTurn,
  modernMessageRole,
  modernMessageSections,
  orderCapturedTurns,
  parseTurnOrder,
  readModernPagination,
};
