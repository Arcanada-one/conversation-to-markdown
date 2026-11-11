import { isConversationFileUrl } from './markdown.mjs';

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

/** Scalars for a skip decision, or null when this body cannot support one.
 *
 *  A modern conversations payload can be a single page. Counting that page as
 *  the whole conversation makes the next full count look like a shrink, and the
 *  chat is exported again on every run. page_info that names another page
 *  withholds messageCount. updateTime and currentNode are still returned when
 *  the body has them. A body with none of the three is null, never a zeroed
 *  shape that could be read as "nothing changed". */
function metadataFromConversationBody(body) {
  if (!body || typeof body !== 'object') return null;
  const updateTime =
    typeof body.update_time === 'number' && Number.isFinite(body.update_time) ? body.update_time : null;
  const currentNode = body.current_node ? String(body.current_node) : null;
  const paged = !body.mapping && body.page_info && (body.page_info.has_previous_page || body.page_info.has_next_page);
  let messageCount = null;
  if (!paged && body.mapping && typeof body.mapping === 'object') {
    // Count MESSAGES, not mapping nodes. The measured thread reported 1147 nodes
    // and 1146 messages: branch points and system nodes carry no message body.
    messageCount = 0;
    for (const key of Object.keys(body.mapping)) {
      if (body.mapping[key] && body.mapping[key].message) messageCount += 1;
    }
  } else if (!paged && Array.isArray(body.messages)) {
    messageCount = 0;
    for (const message of body.messages) {
      if (message) messageCount += 1;
    }
  }
  if (updateTime === null && !currentNode && messageCount === null) return null;
  return {
    updateTime: updateTime,
    currentNode: currentNode,
    messageCount: messageCount,
  };
}

/** Read just enough of a conversation to decide whether it needs exporting.
 *
 *  Walking a conversation to find out whether it grew is the expensive way to
 *  ask: measured on a real 1146-message thread, 282 seconds and it had not
 *  finished. The page's own endpoint answers it in one request, so a batch that
 *  re-runs over 800 conversations can skip the unchanged ones in milliseconds
 *  each instead of re-reading them all.
 *
 *  The legacy conversation endpoint is tried first. When it does not answer,
 *  the app-shell conversations endpoint is tried. That fallback was observed
 *  on the live site, 2026-10-09, for artifact reads: the new endpoint returns
 *  messages directly and may return only one page. A one-page count is not
 *  stored as messageCount.
 *
 *  Returns null when the answer could not be read — never a zeroed shape. "I
 *  could not tell" must not be usable as "nothing changed", because that
 *  direction of mistake skips a conversation permanently and re-running cannot
 *  repair it.
 *
 *  Only three scalars leave this function. The response also carries the whole
 *  message mapping, which was 4 661 057 bytes for the measured thread; it is
 *  read to count messages and then dropped. */
async function fetchConversationMetadata(conversationId, options) {
  const opts = options || {};
  const doFetch = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch || !conversationId) return null;
  const token = opts.token !== undefined ? opts.token : await fetchSessionToken(doFetch);
  if (!token) return null;
  const init = {
    credentials: 'include',
    headers: { accept: 'application/json', Authorization: 'Bearer ' + token },
  };
  const id = encodeURIComponent(conversationId);
  let meta = null;
  try {
    const response = await doFetch('/backend-api/conversation/' + id, init);
    if (response && response.ok) meta = metadataFromConversationBody(await response.json());
  } catch (_e) {
    meta = null;
  }
  if (meta) return meta;
  try {
    const modern = await doFetch('/backend-api/conversations/' + id + '?num_turns=10&include_has_versions=true', init);
    if (!modern || !modern.ok) return null;
    return metadataFromConversationBody(await modern.json());
  } catch (_e) {
    return null;
  }
}

/** Sandbox paths written in the TEXT of an API message.
 *
 *  Measured on a production conversation (2026-09-13) whose .zip and .diff had
 *  survived six releases of click-interception work: all six generated files —
 *  both archives included — are named in the API response as bare paths
 *
 *    /mnt/data/canon-consilium-prompt-bundle-v1.zip
 *    /mnt/data/Canon_Arcana_v0.2_to_v0.3.diff
 *
 *  and every one resolves through the ordinary interpreter/download endpoint.
 *  No click, no world boundary, no prototype patch: the answer was already in a
 *  response the extension downloads on every export and then read only for
 *  `metadata.attachments` and `part.asset_pointer`.
 *
 *  Two reasons the existing readers miss them, and this function answers both:
 *    - the paths are BARE. `sandboxFilesFromMarkdown` requires the `sandbox:`
 *      scheme, so it matched zero of the six;
 *    - the paths live in messages that never reach the markdown at all — the
 *      `tool` role among them — so searching the exported text cannot find them
 *      no matter how the pattern is written (measured: zero occurrences in the
 *      exported file, six in the API response).
 *
 *  Reads only `role`s that can name a produced file. The USER's text is skipped
 *  on purpose: a path the user typed is a request, not an artefact, and asking
 *  the backend for it costs a request per mention and answers "no such file".
 */
function sandboxPathsFromApiMessage(message) {
  const content = (message && message.content) || {};
  const parts = Array.isArray(content.parts) ? content.parts : [];
  const chunks = [];
  for (const part of parts) {
    if (typeof part === 'string') chunks.push(part);
  }
  if (typeof content.text === 'string') chunks.push(content.text);
  const text = chunks.join('\n');
  const out = [];
  const seen = new Set();
  // Accepts both shapes at once: the optional `sandbox:` scheme, then the path.
  // Stops at whitespace, quote, backtick, or a closing bracket — a Cyrillic
  // label frequently follows the path with no separator.
  // Explicit sandbox links now point into /workspace/scratch too (live 2026-10-09).
  // Bare paths remain restricted to the legacy output directory: arbitrary tool
  // paths are not proof of an offered file.
  const pattern = /(?:sandbox:(\/[^\s`)\]}"'\\,;]+)|(\/mnt\/data\/[^\s`)\]}"'\\,;]+))/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    // A trailing period is sentence punctuation far more often than part of a
    // file name; a path that really ends in one resolves to nothing anyway, and
    // the unresolved-file notice keeps that visible instead of silent.
    const sandboxPath = (match[1] || match[2]).replace(/[.]+$/, '');
    if (!sandboxPath || seen.has(sandboxPath)) continue;
    const name = sandboxPath.split('/').pop();
    // A bare directory ("/mnt/data/") names no file.
    if (!name) continue;
    seen.add(sandboxPath);
    out.push({ name: name, sandboxPath: sandboxPath });
  }
  return out;
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
  const token = opts.token !== undefined ? opts.token : await fetchSessionToken(doFetch);
  if (!token) return null;

  let payload;
  const init = {
    credentials: 'include',
    headers: { accept: 'application/json', authorization: 'Bearer ' + token },
  };
  try {
    const response = await doFetch('/backend-api/conversation/' + conversationId, init);
    if (response && response.ok) payload = await response.json();
    // The app-shell endpoint returns messages directly rather than mapping nodes.
    // Observed on the live site, 2026-10-09. Retain the legacy full inventory
    // whenever it is available, since the new endpoint may return only one page.
    if (!payload || (!payload.mapping && !Array.isArray(payload.messages))) {
      const modern = await doFetch(
        '/backend-api/conversations/' + conversationId + '?num_turns=10&include_has_versions=true',
        init
      );
      if (!modern || !modern.ok) return null;
      payload = await modern.json();
    }
  } catch (_e) {
    return null;
  }
  if (!payload || (!payload.mapping && !Array.isArray(payload.messages))) return null;
  if (!payload.mapping && payload.page_info && (payload.page_info.has_previous_page || payload.page_info.has_next_page))
    return null;

  const artifacts = [];
  const seen = new Set();
  const messages = payload.mapping
    ? Object.values(payload.mapping).map(function (node) {
        return node && node.message;
      })
    : payload.messages;
  for (const message of messages) {
    if (!message) continue;
    const messageId = message.id || null;
    const metadata = message.metadata || {};
    const role = (message.author || {}).role || '';

    // Files the answer NAMES rather than attaches. See
    // sandboxPathsFromApiMessage: this is the only source that carried the
    // archives, and the `tool` role is half of it.
    // Tool instructions and private planning name intended paths, not files
    // produced for the user. In an observed failed website fetch, the command
    // named an HTML output but DNS failed before open(..., 'w') ran. Treating
    // that input as output produced a false missing-attachment warning.
    // Keep actual tool RESULTS and user-facing answers as independent sources;
    // metadata attachments below are deliberately outside this filter.
    const isAssistantInstruction =
      role === 'assistant' &&
      ((message.recipient && message.recipient !== 'all') ||
        (message.content || {}).content_type === 'code' ||
        message.channel === 'analysis');
    if (role !== 'user' && !isAssistantInstruction) {
      for (const found of sandboxPathsFromApiMessage(message)) {
        const key = 'sbx:' + found.sandboxPath;
        const parts = (message.content || {}).parts || [];
        const chunks = (Array.isArray(parts) ? parts : []).concat((message.content || {}).text || '');
        const offered = chunks.some(function (part) {
          return typeof part === 'string' && part.indexOf('sandbox:' + found.sandboxPath) !== -1;
        });
        const priority = offered ? 0 : role === 'assistant' ? 1 : 2;
        if (seen.has(key)) {
          const existing = artifacts.find(function (a) {
            return a.sandboxPath === found.sandboxPath;
          });
          if (existing && priority < existing.priority) {
            existing.priority = priority;
            existing.messageId = messageId;
          }
          continue;
        }
        seen.add(key);
        artifacts.push({
          kind: 'sandbox',
          priority: priority,
          messageId: messageId,
          name: found.name,
          fileId: null,
          mimeType: null,
          size: null,
          sandboxPath: found.sandboxPath,
        });
      }
    }

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
  const token = opts.token !== undefined ? opts.token : await fetchSessionToken(doFetch);
  if (!token) return null;
  const url =
    '/backend-api/conversation/' +
    conversationId +
    '/interpreter/download?message_id=' +
    encodeURIComponent(messageId) +
    '&sandbox_path=' +
    encodeURIComponent(sandboxPath);
  return requestArtifactDownloadUrl(url, doFetch, token, opts);
}

/** Uploaded files use the file service, not the interpreter sandbox.
 * Request path and response fields were observed on a manual document download.
 * Never derive a sandbox path from an uploaded filename. */
async function resolveUploadedDownloadUrl(conversationId, fileId, options) {
  const opts = options || {};
  const doFetch = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch || !conversationId || !fileId) return null;
  const token = opts.token !== undefined ? opts.token : await fetchSessionToken(doFetch);
  if (!token) return null;
  const url =
    '/backend-api/files/download/' +
    encodeURIComponent(fileId) +
    '?conversation_id=' +
    encodeURIComponent(conversationId) +
    '&download_intent=true';
  return requestArtifactDownloadUrl(url, doFetch, token, opts);
}

async function requestArtifactDownloadUrl(url, doFetch, token, opts) {
  const fail = function (kind, host) {
    if (typeof opts.onFailure === 'function') opts.onFailure(kind, host);
    return null;
  };
  let step = 'request';
  try {
    const response = await doFetch(url, {
      credentials: 'include',
      headers: { accept: 'application/json', authorization: 'Bearer ' + token },
    });
    if (!response || !response.ok) return fail('http-error');
    step = 'json';
    const body = await response.json();
    const resolved = body && (body.download_url || body.url);
    if (typeof resolved !== 'string' || !resolved) return fail('missing-url');
    if (!isConversationFileUrl(resolved)) {
      let host = '';
      try {
        host = new URL(resolved).hostname;
      } catch (_e) {
        /* invalid URL */
      }
      return fail('rejected-url', host);
    }
    return {
      url: resolved,
      fileName: (body && body.file_name) || null,
      mimeType: (body && body.mime_type) || null,
      size: body && typeof body.file_size_bytes === 'number' ? body.file_size_bytes : null,
    };
  } catch (_e) {
    return fail(step === 'json' ? 'unreadable-json' : 'request-error');
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
  const token = opts.token !== undefined ? opts.token : await fetchSessionToken(doFetch);
  if (!token) return files.map((f) => ({ file: f, resolved: null }));

  const messageIds = Array.from(new Set(opts.messageIds || []));
  let workingId = opts.messageId || null;
  const out = [];
  for (const file of files) {
    let resolved = null;
    // An API path carries its own message context. Retrying every unrelated
    // message id for the same path starves subsequent files without changing
    // which file the endpoint selects. Panel-only paths retain the legacy search.
    const candidates = file.messageId
      ? [file.messageId]
      : Array.from(new Set([workingId].concat(messageIds).filter(Boolean)));
    if (file.kind === 'attachment') {
      resolved = await resolveUploadedDownloadUrl(conversationId, file.fileId, {
        fetchImpl: doFetch,
        token: token,
        onFailure: opts.onFailure,
      });
    }
    for (const candidate of file.kind === 'attachment' ? [] : candidates) {
      const attempt = await resolveSandboxDownloadUrl(conversationId, candidate, file.sandboxPath, {
        fetchImpl: doFetch,
        token: token,
        onFailure: opts.onFailure,
      });
      if (attempt) {
        workingId = candidate;
        resolved = attempt;
        break;
      }
    }
    const entry = { file: file, resolved: resolved };
    out.push(entry);
    if (typeof opts.onResolved === 'function') opts.onResolved(entry);
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
 *  waiting the full budget for every one of them would slow every export.
 *
 *  Waits for the list to STOP GROWING, not for its first row. Measured on a
 *  production conversation (2026-09-12): five files in the panel, four exported,
 *  `TZ-01_Arcanada_Ecosystem_Project_Cards.md` missing with no notice — the file
 *  appeared nowhere in the markdown, not even as unresolved. The panel mounts its
 *  rows progressively, and the old loop returned on the first one, so every row
 *  that rendered a frame later was dropped silently. Reproduced on a fixture: one
 *  poll, 1 file of 3, and the row that mounts late is the one lost.
 *
 *  Absence still costs only one poll: the union wait begins after rows exist.
 *
 *  ACCUMULATES the union of every reading rather than keeping the last one.
 *  Measured (2026-09-13) after a count-based version failed to fix anything: the
 *  panel showed TZ-01..TZ-04 while the export contained TZ-02..TZ-04 plus
 *  `arcanada_talomnia_89_articles_narratives.md` — two DIFFERENT sets of four.
 *  The panel does not only grow, it is REPLACED as the page settles, and a
 *  same-length replacement looked perfectly stable to a count-based wait: four
 *  before, four after, so it returned a set missing the file the user wanted.
 *  Taking the union means a row seen in any frame survives the frame that drops
 *  it. The cost of a stale extra name is one failed resolve, reported as
 *  unresolved; the cost of a dropped name is a file the user never learns about.
 */
async function waitForArtifactPanel(doc, options) {
  const opts = options || {};
  const root = doc || (typeof document !== 'undefined' ? document : null);
  const budgetMs = opts.panelWaitMs === undefined ? 15000 : opts.panelWaitMs;
  const stepMs = opts.panelPollMs === undefined ? 500 : opts.panelPollMs;
  // How many consecutive polls must add nothing new before the list is believed
  // complete. Two, because one unchanged frame is exactly what a half-rendered
  // panel looks like between two renders.
  const stablePolls = opts.panelStablePolls === undefined ? 2 : opts.panelStablePolls;
  const sleep =
    opts.sleep ||
    function (ms) {
      return new Promise(function (resolve) {
        setTimeout(resolve, ms);
      });
    };
  const now =
    opts.now ||
    function () {
      return Date.now();
    };

  const deadline = now() + budgetMs;
  let files = listArtifactPanelFiles(root);
  while (!files.length && now() < deadline) {
    await sleep(stepMs);
    files = listArtifactPanelFiles(root);
  }
  if (!files.length) return files;

  // Rows exist; accumulate by name until no poll contributes anything new.
  const byName = new Map();
  for (const file of files) byName.set(file.name, file);
  let steady = 0;
  while (steady < stablePolls && now() < deadline) {
    await sleep(stepMs);
    let added = 0;
    for (const file of listArtifactPanelFiles(root)) {
      if (byName.has(file.name)) continue;
      byName.set(file.name, file);
      added += 1;
    }
    // Only a poll that CONTRIBUTES resets the counter. A frame that merely
    // swaps one set for another of equal size adds names here rather than
    // replacing them, which is the whole point.
    steady = added > 0 ? 0 : steady + 1;
  }
  return Array.from(byName.values());
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
    const label = button.getAttribute ? button.getAttribute('aria-label') || '' : '';
    // A file name, not the sibling download button whose label is translated
    // ("Download file" / "Скачать файл"). An extension is the discriminator.
    if (!/\.[A-Za-z0-9]{1,8}$/.test(label) || seen.has(label)) continue;
    seen.add(label);
    files.push({ name: label, sandboxPath: '/mnt/data/' + label });
  }
  return files;
}

export {
  fetchConversationArtifacts,
  fetchConversationMetadata,
  fetchSessionToken,
  listArtifactPanelFiles,
  requestArtifactDownloadUrl,
  resolveArtifactPanelFiles,
  resolveSandboxDownloadUrl,
  resolveUploadedDownloadUrl,
  sandboxPathsFromApiMessage,
  waitForArtifactPanel,
};
