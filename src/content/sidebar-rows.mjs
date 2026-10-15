import { slugifyTitle } from './export.mjs';

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
  const visible = inner ? (inner.textContent || '').trim() : (link.textContent || '').trim();
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

  const idMatch = (typeof location !== 'undefined' ? location.pathname : '').match(/\/c\/([A-Za-z0-9-]+)/);

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
  const projectId = (routeProject && routeProject[1]) || (href.match(/\/g\/(g-p-[A-Za-z0-9]+)\//) || [])[1] || null;
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
      const ownsRows = cur.querySelectorAll ? cur.querySelectorAll('a[href*="/c/"]').length : 0;
      if (name && ownsRows > 0) return name;
    }
    cur = cur.parentElement;
  }
  return null;
}

/** Project name shown on the unfurl row that contains this conversation link.
 *  The row is a sibling of the link, so the search starts at the parent.
 *  A link with no parent returns null. The name is capped because it becomes
 *  a folder segment. */
function projectTitleForConversationLink(link) {
  var current = link;
  var depth;
  for (depth = 0; depth < 8 && current; depth++) {
    current = current.parentElement;
    if (!current || typeof current.querySelector !== 'function') continue;
    var row = null;
    try {
      row = current.querySelector('[class*="project-unfurl-row"]');
    } catch (_e) {
      row = null;
    }
    if (!row) continue;
    var label = String(row.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!label) continue;
    return label.slice(0, 80);
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
      projectTitle: projectTitleForConversationLink(link),
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
      control = row.getAttribute && row.getAttribute('role') === 'button' ? row : row.querySelector('[role="button"]');
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
    const siblingConvLinks = ul.querySelectorAll ? ul.querySelectorAll('a[href*="/c/"]').length : 0;
    if (!siblingConvLinks) return false;
    // The row itself must not be a conversation.
    if (li.querySelector && li.querySelector('a[href*="/c/"]')) return false;
    return true;
  } catch (_e) {
    return false;
  }
}

/** The sidebar's settled "history did not load" Retry control.
 *
 *  Measured 2026-10-14: a `nav [role="status"]` after the mounted rows, with
 *  aria-busy="false" and one button. The visible sentence was "Unable to load
 *  history". The button text is not required, so a translated label still
 *  matches. A status that is still busy is a loader, not this failure. A
 *  status with no button has nothing to press.
 */
function findHistoryRetryControl(doc) {
  const root = doc || (typeof document !== 'undefined' ? document : null);
  if (!root || !root.querySelectorAll) return null;
  let nodes;
  try {
    nodes = root.querySelectorAll('nav [role="status"]');
  } catch (_e) {
    return null;
  }
  for (const node of nodes) {
    if (node.getAttribute && node.getAttribute('aria-busy') === 'true') continue;
    const button = node.querySelector ? node.querySelector('button') : null;
    if (!button || typeof button.click !== 'function') continue;
    if (button.querySelector && button.querySelector('a[href*="/c/"]')) continue;
    return button;
  }
  return null;
}

function findShowMoreControl(doc) {
  const root = doc || (typeof document !== 'undefined' ? document : null);
  if (!root || !root.querySelectorAll) return null;
  let buttons;
  try {
    buttons = root.querySelectorAll('nav button[data-sidebar-item], nav button, nav [role="button"]');
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
      overflowY = typeof getComputedStyle === 'function' ? getComputedStyle(current).overflowY || '' : '';
    } catch (_e) {
      overflowY = '';
    }
    const scrollable =
      /(auto|scroll|overlay)/.test(overflowY) || (current.scrollHeight || 0) > (current.clientHeight || 0) + 1;
    if (scrollable && (current.scrollHeight || 0) > (current.clientHeight || 0) + 1) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

export {
  escapeForRegExp,
  extractConversationTitle,
  findCollapsedProjectRows,
  findHistoryRetryControl,
  findShowMoreControl,
  findSidebarScroller,
  isPaginationControl,
  knownProjectName,
  listSidebarConversations,
  projectRowContainer,
  projectTitleForConversationLink,
  stripSidebarLabelSuffix,
  titleFromSidebarLink,
};
