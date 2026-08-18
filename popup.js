const btn = document.getElementById('btn-copy');
const btnCancel = document.getElementById('btn-cancel');
const btnPause = document.getElementById('btn-pause');
const status = document.getElementById('status');
const chkImages = document.getElementById('chk-images');
const chkTimestamp = document.getElementById('chk-timestamp');
const chkBatch = document.getElementById('chk-batch');
const batchWarning = document.getElementById('batch-warning');
const linksWarning = document.getElementById('links-warning');

/** Show the caveats that should inform the choice, while it is still a choice.
 *
 *  Both were previously revealed inside the click handler, i.e. after the user
 *  had already committed to the run. A warning that arrives then is a status
 *  message, not a warning.
 *
 *  The links caveat matters most for a batch: attachment links ChatGPT serves are
 *  signed and short-lived, so a project archive that keeps the links instead of
 *  the files is an archive that expires. */
function refreshOptionWarnings() {
  var batchOn = !!(chkBatch && chkBatch.checked);
  var filesOn = !!(chkImages && chkImages.checked);
  if (batchWarning) batchWarning.classList.toggle('visible', batchOn);
  if (linksWarning) linksWarning.classList.toggle('visible', batchOn && !filesOn);
}

if (chkBatch) chkBatch.addEventListener('change', refreshOptionWarnings);
if (chkImages) chkImages.addEventListener('change', refreshOptionWarnings);

// Id of the tab currently being scanned, so Stop knows where to send the flag.
var scanningTabId = null;
var progressTimer = null;
var batchCancelled = false;
var batchPaused = false;

function showStatus(type, message) {
  status.className = type;
  status.textContent = message;
}

/** Parse ![](url) references from Markdown, return {url, label, kind} pairs. */
function parseImageRefs(md) {
  const seen = new Set();
  const refs = [];
  const re = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
  let m;
  while ((m = re.exec(md)) !== null) {
    if (!seen.has(m[2])) {
      seen.add(m[2]);
      refs.push({ url: m[2], label: m[1], kind: 'image' });
    }
  }
  return refs;
}

/** Parse [label](url) file links for downloadable artifacts (not images). */
function parseFileRefs(md) {
  const seen = new Set();
  const refs = [];
  const re = /(?<!!)\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
  let m;
  while ((m = re.exec(md)) !== null) {
    if (!seen.has(m[2]) && isDownloadableFileUrl(m[2])) {
      seen.add(m[2]);
      refs.push({ url: m[2], label: m[1], kind: 'file' });
    }
  }
  return refs;
}

function parseArtifactRefs(md) {
  return parseImageRefs(md).concat(parseFileRefs(md));
}

function isDownloadableFileUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'files.oaiusercontent.com') return true;
    if (parsed.hostname === 'chatgpt.com' || parsed.hostname === 'chat.openai.com') {
      return parsed.pathname.includes('/files/') || parsed.pathname.includes('/estuary/');
    }
    return false;
  } catch (_e) {
    return false;
  }
}

/** Build the chatgpt-export/ sub-path for one exported conversation.
 *  A titled conversation gets its own folder so images sit next to the .md;
 *  an untitled one falls back to the flat legacy layout. */
function exportPath(slug, filename) {
  return slug
    ? 'chatgpt-export/' + slug + '/' + filename
    : 'chatgpt-export/' + filename;
}

/** Derive a filename from an image URL or alt text.
 *  Prefixing with the conversation slug keeps names unique across exports:
 *  two conversations both starting at image_001 would otherwise collide in the
 *  flat legacy folder, and Chrome would suffix them "image_001 (1).png". */
function imageFilename(url, alt, index, slug) {
  return artifactFilename(url, alt, index, slug, 'image');
}

/** Sanitize one path segment for the Downloads folder: no separators, no
 *  traversal, no reserved characters. Returns '' when nothing usable remains. */
function sanitizeFilenamePart(value) {
  if (!value) return '';
  var cleaned = String(value)
    .replace(/[\\/]+/g, '-')
    .replace(/[\x00-\x1f<>:"|?*]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/\.+$/, '');
  return cleaned.slice(0, 80);
}

/** Split a filename into stem and extension.
 *
 *  A compound extension such as `.tar.gz` needs no special case here: the stem
 *  keeps everything before the LAST dot, so `archive.tar` + `.gz` recombines to
 *  `archive.tar.gz` unchanged. An earlier version carried an explicit
 *  `(?:\.(?:tar|user))?` branch; a mutation proved it changed no observable
 *  output, so it was removed rather than left as untestable complexity. */
function splitFilenameExtension(name) {
  var match = String(name || '').match(/^(.*?)(\.[A-Za-z0-9]{1,8})$/);
  if (!match) return { stem: String(name || ''), ext: '' };
  return { stem: match[1], ext: match[2].toLowerCase() };
}

/** Derive a filename from an artifact URL or label text.
 *
 *  Documents keep their ORIGINAL name when the link carries one: a Word file
 *  offered as `Договор.docx` is worth more on disk under that name than as
 *  `file_003.docx`, and a batch export of many conversations is unreadable
 *  when every attachment is a numbered stub. Images stay numbered — their
 *  labels are alt text, not filenames — and any name collision is still
 *  disambiguated by the index prefix. */
function artifactFilename(url, label, index, slug, kind) {
  var ext = kind === 'image' ? 'png' : 'bin';
  var originalStem = '';

  var fromLabel = splitFilenameExtension(sanitizeFilenamePart(label));
  if (fromLabel.ext) {
    ext = fromLabel.ext.replace(/^\./, '');
    originalStem = fromLabel.stem;
  } else {
    try {
      var segments = new URL(url).pathname.split('/');
      var last = sanitizeFilenamePart(decodeURIComponent(segments[segments.length - 1] || ''));
      var fromPath = splitFilenameExtension(last);
      if (fromPath.ext) {
        ext = fromPath.ext.replace(/^\./, '');
        originalStem = fromPath.stem;
      }
    } catch (_e) {}
  }

  if (kind === 'image') {
    ext = ext.replace(/^jpe?g$/i, 'jpg');
    if (!/^(png|jpg|gif|webp|svg|bmp)$/i.test(ext)) ext = 'png';
    originalStem = '';
  }

  var prefix = slug ? slug + '-' : '';
  var counter = String(index + 1).padStart(3, '0');
  if (originalStem) {
    return prefix + counter + '-' + originalStem + '.' + ext;
  }
  var stem = kind === 'image' ? 'image' : 'file';
  return prefix + stem + '_' + counter + '.' + ext;
}

/** Marker introducing the conversation id in a batch export filename.
 *
 *  `slugifyTitle` strips this character from every title, so a slug can never contain
 *  it. That makes the current name format (`slug[--stamp]~id`) and the older,
 *  id-less format (`slug[--stamp]`) structurally NON-OVERLAPPING: no name written by
 *  an older version can be read as a current one. Every earlier scheme separated the
 *  id with `--`, which a title may legally contain, and each of the resulting five
 *  defects skipped a conversation that had never been saved. */
var ID_MARKER = '~';

/** Case-fold a candidate key up to the id marker, leaving the id itself untouched.
 *
 *  Two different rules for two different jobs: the path part must follow the
 *  filesystem (macOS and Windows treat `Budget/` and `budget/` as one directory), while
 *  the id must be compared exactly, because it is what makes a name attributable to
 *  one conversation. Both sides of the comparison call this, so they cannot drift. */
function foldExceptId(key) {
  var at = String(key).indexOf(ID_MARKER);
  if (at < 0) return String(key).toLowerCase();
  return String(key).slice(0, at).toLowerCase() + String(key).slice(at);
}

/** Format a date as YYYYMMDD-HHMM for timestamped re-exports. */
function formatExportTimestamp(date) {
  var d = date || new Date();
  var pad = function(n) { return String(n).padStart(2, '0'); };
  return String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate()) +
    '-' + pad(d.getHours()) + pad(d.getMinutes());
}

/** Build the .md filename; timestamp suffix implements re-export without uniquify suffixes. */
function buildMdFilename(slug, useTimestamp, now, fixedStamp) {
  var base = slug || 'conversation';
  if (useTimestamp) {
    var stamp = fixedStamp || formatExportTimestamp(now);
    return base + '--' + stamp + '.md';
  }
  return base + '.md';
}

/** Progress label for a batch export: "3 of 12 — Conversation title". */
function formatBatchProgress(index, total, title) {
  var position = index + 1;
  var label = title ? ' — ' + title : '';
  return position + ' of ' + total + label;
}

/** Root folder for a project batch under Downloads/chatgpt-export/. */
function batchRootPath(projectSlug) {
  return projectSlug ? 'chatgpt-export/' + projectSlug : 'chatgpt-export';
}

/** Per-conversation folder inside a batch export. */
function conversationFolderPath(convSlug, projectSlug) {
  var root = batchRootPath(projectSlug);
  return convSlug ? root + '/' + convSlug : root;
}

/** Build the .md filename for a conversation inside a BATCH export.
 *
 *  The conversation id is appended because titles collide — duplicates and
 *  "Untitled" are ordinary inside a Project — and a resumed run has nothing but
 *  the download paths to identify what already landed. A single export keeps the
 *  clean, title-only name from `buildMdFilename`; only the batch pays the id. */
function batchMdFilename(convSlug, convId, useTimestamp, stamp, isPartial) {
  var base = convSlug || convId || 'conversation';
  // A truncated export is marked IN THE NAME, not only inside the file. Resume can
  // only see filenames, so an incomplete file under the complete name is
  // indistinguishable from a finished one and the next run skips the conversation —
  // refusing the one action that could repair it. The suffix goes before the stamp
  // and id so those keep their positions.
  if (isPartial) base += '-partial';
  var parts = base;
  if (useTimestamp) parts += '--' + (stamp || formatExportTimestamp());
  // The id is introduced by a marker `slugifyTitle` removes from every title, so no
  // title can forge an id boundary. That is the invariant the whole resume mechanism
  // rests on: without it the current and older name formats share an alphabet, and a
  // stamped older export is character-for-character a valid current name belonging to
  // some other conversation — which silently skipped that conversation.
  if (convId) parts += ID_MARKER + convId;
  return parts + '.md';
}

/** Full download path for a conversation's markdown file in a batch. */
function mdDownloadPath(convSlug, projectSlug, useTimestamp, stamp, convId) {
  var mdName = batchMdFilename(convSlug, convId, useTimestamp, stamp);
  return conversationFolderPath(convSlug, projectSlug) + '/' + mdName;
}



/** Filename stem with the `.md` extension removed. */
function mdStem(downloadPath) {
  var normalized = String(downloadPath || '').replace(/\\/g, '/');
  var file = normalized.split('/').filter(Boolean).pop() || '';
  return file.replace(/\.md$/i, '');
}


/** The conversation folder a download path sits in, relative to the export root.
 *  Folds to lower case because macOS and Windows treat `Budget/` and `budget/` as
 *  the same directory — the comparison must follow the filesystem, not the string. */
function conversationFolderFromPath(downloadPath) {
  var normalized = String(downloadPath || '').replace(/\\/g, '/');
  var anchor = normalized.indexOf('chatgpt-export/');
  if (anchor > 0) normalized = normalized.slice(anchor);
  var segments = normalized.split('/').filter(Boolean);
  segments.pop();                                   // drop the filename
  return segments.join('/');
}

/** Every name this conversation could have written, as folder-qualified keys.
 *
 *  `owned` names embed the conversation id and so belong to it alone. `legacy`
 *  names — written before ids were recorded — are shared by every namesake, so the
 *  caller must check for a single claimant before trusting one.
 *
 *  A stamp records when a past run happened and so cannot be reproduced from
 *  scratch. Rather than pattern-matching it out of a name (the inference that failed
 *  five times), the stamps actually present on disk are passed in and each is tried
 *  as a candidate. Generating `slug--<stamp>--<id>` and asking whether that exact
 *  name landed is an exact test of ownership. */
function candidateExportNames(conv, projectSlug, stamps) {
  var slug = conv.slug || conv.id || 'conversation';
  var folder = conversationFolderPath(slug, projectSlug).toLowerCase();
  var prefix = folder + '/' + String(slug).toLowerCase();
  var owned = [];
  var legacy = [prefix];
  var list = stamps || [];

  if (conv.id) {
    // The id keeps its case. Folder and slug are folded because macOS and Windows
    // fold them — that follows the filesystem. The id is different in kind: it is the
    // one field the whole design relies on to be unforgeable, and folding it would
    // collapse two distinct identities onto one name, so a conversation could be
    // excused by a file belonging to another. Not reachable while ChatGPT ids are
    // lowercase hex, but "this name can only mean one thing" is the assumption that
    // produced every silent-loss defect in this file's history.
    var id = String(conv.id);
    owned.push(prefix + ID_MARKER + id);
    for (var s = 0; s < list.length; s++) {
      owned.push(prefix + '--' + list[s] + ID_MARKER + id);
    }
  }
  // A STAMPED legacy name is deliberately NOT generated. `slug--20260817-1200` is
  // simultaneously "an older export of `slug`, stamped" and "an export of the
  // conversation whose id is `20260817-1200`" — the two name spaces overlap exactly
  // there, and nothing in the name resolves it. Treating such a file as proof let it
  // excuse a conversation that had never been written. The cost is that a stamped
  // export from an older version is re-exported once; the alternative is losing a
  // conversation, so the trade is not close.
  return { owned: owned, legacy: legacy };
}

/** The `YYYYMMDD-HHMM` stamps that appear in these download names.
 *
 *  Collected so `candidateExportNames` can generate the stamped names that could
 *  exist, instead of trying to recognise a stamp inside a name it did not build. A
 *  stamp is a fixed, unambiguous shape — unlike an id or a title — so reading one
 *  here is safe: a false positive only adds a candidate name that nothing matches. */
function stampsInPaths(paths) {
  var stamps = new Set();
  for (var i = 0; i < paths.length; i++) {
    // Split on the id marker as well as the separator: in `slug--<stamp>~<id>` the
    // stamp is followed by the marker, not by another separator.
    var fields = mdStem(paths[i]).split(/--|~/);
    for (var f = 0; f < fields.length; f++) {
      if (/^\d{8}-\d{4}$/.test(fields[f])) stamps.add(fields[f]);
    }
  }
  return Array.from(stamps);
}


/** Skip conversations whose markdown already landed in a prior partial run.
 *
 *  Identity is the conversation ID, never the title. Titles are derived into
 *  slugs, and slugs collide: duplicate titles are ordinary inside a Project,
 *  "Untitled" is common, and titles differing only by case fold onto one key.
 *  Every such collision used to make the first export skip the others FOREVER
 *  while reporting success — a silent loss that re-running could not repair.
 *  Conversations with no id fall back to the slug key, which is the old
 *  behaviour and still better than exporting nothing. */
function filterPendingConversations(conversations, completedPaths, projectSlug) {
  var paths = [];
  if (completedPaths && typeof completedPaths.forEach === 'function') {
    completedPaths.forEach(function(item) { paths.push(item); });
  }

  // GENERATE, DON'T PARSE. Five rounds of defects here all had one cause: reading a
  // filename to work out which conversation wrote it. Every attempt — matching the
  // whole stem, counting files per title, checking the trailing field against known
  // ids — was a different inference, and each one silently lost a conversation,
  // because a title can contain anything a separator or an id can contain.
  // `slugifyTitle('Budget - draft')` is `Budget---draft`, whose trailing field is a
  // legal ChatGPT id.
  //
  // The format is ours, so the question is answered forwards instead: for each
  // conversation, build the exact names it COULD have written, and look for those.
  // Nothing about an unrecognised name is inferred — it simply matches nothing.
  //
  // Legacy names (no id) stay ambiguous by nature: two conversations sharing a
  // title generate the same legacy name, and which one wrote the file is unknowable.
  // Such a name is trusted only when a single conversation claims it; otherwise both
  // re-export. Re-exporting costs bandwidth, a false skip loses a conversation
  // permanently and re-running cannot repair it, so ambiguity resolves to the cheap
  // direction.
  var landed = new Set();
  for (var i = 0; i < paths.length; i++) {
    var name = mdStem(paths[i]);
    // Keyed with the conversation folder so a name is only credited inside the folder
    // it belongs to. Everything up to the id marker is folded, matching the
    // filesystem's own case rules on macOS and Windows; the id after the marker keeps
    // its case, because it identifies the conversation rather than the file's place on
    // disk. See `candidateExportNames`, which must fold exactly the same way.
    var folder = conversationFolderFromPath(paths[i]);
    if (name) landed.add(foldExceptId(folder + '/' + name));
  }

  // How many conversations would generate each legacy name.
  var stamps = stampsInPaths(paths);

  // How many conversations could have written each candidate name. Counted across
  // owned AND legacy candidates together, because the two spaces overlap: a stamped
  // legacy name `Budget--20260817-1200` is also the id-bearing name of a
  // conversation whose id happens to be `20260817-1200`. A name more than one
  // conversation could have written is evidence about none of them.
  var claimants = Object.create(null);
  for (var c = 0; c < conversations.length; c++) {
    var all = candidateExportNames(conversations[c], projectSlug, stamps);
    var every = all.owned.concat(all.legacy);
    // Count each conversation once per distinct name, so a conversation cannot
    // inflate a name's count by generating it twice.
    var seen = new Set();
    for (var n = 0; n < every.length; n++) {
      if (seen.has(every[n])) continue;
      seen.add(every[n]);
      claimants[every[n]] = (claimants[every[n]] || 0) + 1;
    }
  }

  return conversations.filter(function(conv) {
    var names = candidateExportNames(conv, projectSlug, stamps);
    var every = names.owned.concat(names.legacy);
    for (var a = 0; a < every.length; a++) {
      // A landed name excuses this conversation only when no other conversation
      // could have produced the same name.
      if (landed.has(every[a]) && claimants[every[a]] === 1) return false;
    }
    return true;
  });
}


/** Classify a per-conversation failure so the run can react instead of
 *  burning through the remaining list.
 *
 *  A dropped network is NOT a property of the conversation being exported: on
 *  a 40-conversation run it would otherwise fail 39 more times and report 39
 *  broken conversations. Offline and unreachable are therefore HOLD conditions,
 *  while a genuine per-conversation problem is RETRY then SKIP. */
function classifyBatchFailure(message) {
  var text = String(message || '').toLowerCase();
  if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) return 'offline';
  if (/failed to fetch|network ?error|net::|err_internet|err_network|err_name_not_resolved|err_connection/.test(text)) return 'offline';
  if (/\b(?:502|503|504)\b|bad gateway|service unavailable|gateway timeout|too many requests|\b429\b/.test(text)) return 'unreachable';
  if (/did not load|timed out|timeout/.test(text)) return 'transient';
  return 'conversation';
}

/** Exponential backoff with a finite budget: 1s, 2s, 4s, capped. */
function backoffDelayMs(attempt) {
  return Math.min(1000 * Math.pow(2, Math.max(0, attempt - 1)), 8000);
}

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

/** Block while the operator has paused, and report cancellation. */
async function waitWhilePaused(controls) {
  while (controls && controls.isPaused && controls.isPaused()) {
    if (controls.isCancelled && controls.isCancelled()) return false;
    await sleep(250);
  }
  return !(controls && controls.isCancelled && controls.isCancelled());
}

/* ---------------------------------------------------------------------------
 * The export index.
 *
 * What a previous run accomplished used to be inferred from Chrome's download
 * history, and that inference cannot answer the question that matters: a
 * filename cannot say whether the conversation has MORE MESSAGES than when it
 * was saved. So a re-run either skipped a conversation that had grown, or
 * re-exported everything.
 *
 * The index answers it directly. Per conversation it keeps five scalars — the
 * conversation's own `update_time`, the id of its newest message, its message
 * count, the bytes written and the file count — and nothing else. Measured
 * before it was designed (see the commit message): 800 conversations is 210 743
 * bytes, 2% of the 10MB quota, written in 15ms; it survives a browser restart;
 * and the conversation mapping it is deliberately NOT caching is 4 661 057 bytes
 * for a single thread.
 *
 * Three properties are load-bearing and each has a test:
 *   - absence of the API reads as "no index", never as a throw (without the
 *     `storage` permission `chrome.storage` is undefined, not a failing call);
 *   - a write is only reported as stored if it actually stored, because quota
 *     failure arrives through `runtime.lastError` and an unchecked write looks
 *     exactly like success;
 *   - an unreadable answer is never grounds for skipping a conversation.
 * ------------------------------------------------------------------------- */

var INDEX_KEY = 'c2mExportIndex';
/** Deliberately far below the 10MB quota. The index is a convenience; the files
 *  on disk remain the source of truth, so it may be trimmed but must never grow
 *  until Chrome refuses writes for the whole extension. */
var INDEX_BYTE_BUDGET = 1048576;

/** The storage area, or null when the permission is absent. Never throws. */
function storageArea() {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return null;
  return chrome.storage.local;
}

/** Read the whole index. An unreadable or corrupt store reads as empty, which
 *  costs a re-export and never a silent skip. */
function readExportIndex() {
  return new Promise(function(resolve) {
    var area = storageArea();
    if (!area) { resolve({}); return; }
    try {
      area.get([INDEX_KEY], function(items) {
        var value = items && items[INDEX_KEY];
        if (!value || typeof value !== 'object') { resolve({}); return; }
        resolve(value);
      });
    } catch (_e) {
      resolve({});
    }
  });
}

/** Record one conversation. Resolves true only when the write actually landed.
 *
 *  Only the decision inputs are kept: passing a mapping, markdown or title here
 *  stores none of them. That is asserted by a test, because "store just the
 *  scalars" is a rule that erodes the moment someone adds a convenient field.
 */
function recordExportedConversation(conversationId, record) {
  return new Promise(function(resolve) {
    var area = storageArea();
    if (!area || !conversationId) { resolve(false); return; }
    readExportIndex().then(function(index) {
      var next = Object.assign({}, index);
      var row = {
        updateTime: typeof record.updateTime === 'number' ? record.updateTime : null,
        currentNode: record.currentNode ? String(record.currentNode) : null,
        messageCount: typeof record.messageCount === 'number' ? record.messageCount : null,
        bytes: typeof record.bytes === 'number' ? record.bytes : null,
        files: typeof record.files === 'number' ? record.files : 0,
        at: typeof record.at === 'number' ? record.at : null,
      };
      next[String(conversationId)] = row;

      var payload = {};
      payload[INDEX_KEY] = next;
      var size = 0;
      try {
        size = new TextEncoder().encode(JSON.stringify(payload)).length;
      } catch (_e) {
        size = 0;
      }
      if (size > INDEX_BYTE_BUDGET) { resolve(false); return; }

      try {
        area.set(payload, function() {
          // The quota is reported HERE, not thrown. Reading it is the difference
          // between an index that stops recording loudly and one that stops
          // recording silently.
          var failed = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError;
          resolve(!failed);
        });
      } catch (_e) {
        resolve(false);
      }
    });
  });
}

/** Compare a conversation's live metadata against what the index remembers.
 *
 *  Verdicts: 'new' (never exported), 'unchanged' (skip), 'grown' (re-export),
 *  'unknown' (metadata unreadable — export, because an unreadable answer is not
 *  an unchanged conversation).
 *
 *  A message count that went DOWN also returns 'grown': a switched branch or a
 *  deleted turn means the saved file no longer matches the conversation, and
 *  "changed" is the useful distinction, not the direction of the change.
 */
function classifyAgainstIndex(index, conversationId, live) {
  var row = index ? index[String(conversationId)] : null;
  if (!row) return { verdict: 'new', stored: null };
  if (!live) return { verdict: 'unknown', stored: row };

  var sameNode = row.currentNode != null && live.currentNode != null
    ? String(row.currentNode) === String(live.currentNode)
    : row.currentNode == null && live.currentNode == null;
  var sameTime = row.updateTime != null && live.updateTime != null
    ? Number(row.updateTime) === Number(live.updateTime)
    : row.updateTime == null && live.updateTime == null;
  var sameCount = row.messageCount != null && live.messageCount != null
    ? Number(row.messageCount) === Number(live.messageCount)
    : true;

  if (sameNode && sameTime && sameCount) return { verdict: 'unchanged', stored: row };
  return { verdict: 'grown', stored: row };
}

/** Resume a batch by reading prior download paths — the fallback when no index
 *  is available, and still a cross-check on the files actually present. */
function searchCompletedDownloadPaths(projectSlug) {
  return new Promise(function(resolve) {
    if (typeof chrome === 'undefined' || !chrome.downloads || !chrome.downloads.search) {
      resolve(new Set());
      return;
    }
    var escaped = (projectSlug || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var pattern = projectSlug
      ? 'chatgpt-export/' + escaped + '/.+/.*\\.md$'
      : 'chatgpt-export/.+/.*\\.md$';
    chrome.downloads.search({ filenameRegex: pattern }, function(items) {
      var paths = new Set();
      if (items) {
        for (var i = 0; i < items.length; i++) {
          var item = items[i];
          if (!item || !item.filename) continue;
          // A history ROW is not a file. Chrome keeps the record after the user
          // deletes, moves or renames the download, and keeps rows for transfers
          // that were interrupted. Trusting those makes resume skip a
          // conversation that is not on disk — a false skip is the one failure
          // re-running cannot repair, so both fields are checked when present.
          if (item.exists === false) continue;
          if (item.state && item.state !== 'complete') continue;
          paths.add(item.filename);
          // Remember the size so a LATER run can tell a conversation that grew
          // from one that did not; the filename alone cannot express that.
          if (typeof item.fileSize === 'number' && item.fileSize > 0) {
            paths.__sizes = paths.__sizes || Object.create(null);
            paths.__sizes[item.filename] = item.fileSize;
          }
        }
      }
      resolve(paths);
    });
  });
}

function bytesToBase64DataUrl(bytes, mimeType) {
  var binary = '';
  for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return 'data:' + (mimeType || 'application/octet-stream') + ';base64,' + btoa(binary);
}

/** A URL for bytes that chrome.downloads can accept at ANY size.
 *
 *  A `data:` URL cannot carry a project archive: Chrome caps URL length at a
 *  couple of megabytes, so the one workload the zip exists for is the one that
 *  would fail — and base64 inflates the payload by a third on the way. A blob
 *  URL is a handle rather than a payload, so size stops mattering. The popup is a
 *  real document, so `URL.createObjectURL` is available here; the `data:` helper
 *  stays for the small in-page artifacts where it is already proven. */
function bytesToDownloadUrl(bytes, mimeType) {
  if (typeof Blob === 'function' && typeof URL !== 'undefined' && URL.createObjectURL) {
    return {
      url: URL.createObjectURL(new Blob([bytes], { type: mimeType || 'application/octet-stream' })),
      revoke: function(url) { try { URL.revokeObjectURL(url); } catch (_e) {} },
    };
  }
  return { url: bytesToBase64DataUrl(bytes, mimeType), revoke: function() {} };
}

function textToUtf8Bytes(text) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
  var out = new Uint8Array(text.length);
  for (var i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function addZipEntry(zipEntries, projectSlug, convSlug, filename, content) {
  var prefix = conversationFolderPath(convSlug, projectSlug) + '/';
  zipEntries.push({
    name: prefix + filename,
    data: typeof content === 'string' ? textToUtf8Bytes(content) : content,
  });
}

/** How long a project archive may take to be accepted AND written. A batch zip is
 *  orders of magnitude larger than a single conversation, so it does not share the
 *  per-file budget: `downloadOne`'s default would give up while Chrome was still
 *  reading the blob, and the caller would then revoke the URL mid-write. */
var ZIP_WRITE_TIMEOUT_MS = 120000;

/** Wait until Chrome has finished writing a download, so a blob URL backing it
 *  is not revoked out from under a write still in progress.
 *
 *  `chrome.downloads.download` reports acceptance, not completion: its callback
 *  fires with a download id while the bytes are still being written. Revoking the
 *  URL at that point truncates exactly the large archive a blob URL exists to
 *  carry.
 *
 *  Returns whether the file is known to have been written. A timeout resolves
 *  `false` — not because the write certainly failed, but because it is not known
 *  to have succeeded, and on a backup tool an unverified file must not be reported
 *  as saved. The run continues either way; a stuck download must not wedge it. */
function waitForDownloadComplete(downloadId, timeoutMs) {
  return new Promise(function(resolve) {
    if (downloadId === undefined || downloadId === null ||
        typeof chrome === 'undefined' || !chrome.downloads || !chrome.downloads.onChanged) {
      resolve(false);
      return;
    }
    var settled = false;
    var finish = function(done) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { chrome.downloads.onChanged.removeListener(listener); } catch (_e) {}
      resolve(done);
    };
    var listener = function(delta) {
      if (!delta || delta.id !== downloadId || !delta.state) return;
      if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
        finish(delta.state.current === 'complete');
      }
    };
    var timer = setTimeout(function() { finish(false); }, timeoutMs || 120000);
    chrome.downloads.onChanged.addListener(listener);
  });
}

/** Download one file via chrome.downloads. Returns {url, filename, ok, error}. */
function downloadOne(url, filename, targetPath, timeoutMs, conflictAction) {
  return new Promise(function(resolve) {
    var settled = false;
    var timer = setTimeout(function() {
      if (!settled) { settled = true; resolve({ url: url, filename: filename, ok: false, error: 'timeout' }); }
    }, timeoutMs || 12000);
    chrome.downloads.download({
      url: url,
      filename: targetPath || ('chatgpt-export/' + filename),
      saveAs: false,
      conflictAction: conflictAction || 'overwrite',
    }, function(downloadId) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      var ok = !chrome.runtime.lastError && downloadId !== undefined;
      resolve({
        url: url,
        filename: filename,
        ok: ok,
        // Returned so a caller holding a revocable blob URL can wait for the
        // write to finish before releasing it.
        downloadId: ok ? downloadId : null,
        error: ok ? null : (chrome.runtime.lastError && chrome.runtime.lastError.message || 'download rejected'),
      });
    });
  });
}

/** Poll the page's scan state so a long run visibly reports work done.
 *  Counts, not a percentage: there is no fixed budget to be a percentage of. */
function startProgressPolling(tabId) {
  stopProgressPolling();
  progressTimer = setInterval(async function() {
    try {
      const probe = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function() { return window.__c2mScan || null; },
      });
      const state = probe && probe[0] && probe[0].result;
      if (state && !state.cancelled) {
        const seconds = Math.round((state.elapsedMs || 0) / 1000);
        btn.textContent = 'Scanning… ' + state.captured + ' messages · ' + seconds + 's';
      }
    } catch (_e) {
      // The tab may navigate or close mid-scan; the scan itself reports that.
    }
  }, 1000);
}

function stopProgressPolling() {
  if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
}

/** Save one scanned conversation to disk and optionally collect zip entries. */
async function saveConversationExport(tabId, result, options) {
  var downloadImages = options.downloadImages;
  var useTimestamp = options.useTimestamp;
  var batchStamp = options.batchStamp;
  var projectSlug = options.projectSlug;
  var zipEntries = options.zipEntries;
  var slug = result.slug || null;
  var convSlug = slug || 'conversation';
  // A batch supplies the conversation id so the file carries its own identity;
  // a single export keeps the clean, title-only name.
  var conversationId = options.conversationId || null;
  var mdName = conversationId
    ? batchMdFilename(slug, conversationId, useTimestamp, batchStamp, result.partial)
    : buildMdFilename(slug, useTimestamp, null, batchStamp);
  var folderPath = projectSlug
    ? conversationFolderPath(convSlug, projectSlug)
    : exportPath(slug, '').replace(/\/$/, '');
  var md = result.md;
  var partialSuffix = result.partial ? ' (partial export)' : '';
  var dlOk = 0;
  var dlTotal = 0;
  var dlErrors = [];
  var mdFinal = md;

  if (downloadImages && typeof chrome.downloads !== 'undefined') {
    var refs = parseArtifactRefs(md);
    dlTotal = refs.length;
    var extracted = [];
    if (refs.length > 0) {
      var urls = refs.map(function(r) { return r.url; });
      var extractResult = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: async function(urls) {
          if (typeof fetchImageDataUrls === 'function') return await fetchImageDataUrls(urls);
          if (typeof extractImageDataUrls === 'function') return await extractImageDataUrls(urls);
          return urls.map(function() { return null; });
        },
        args: [urls],
      });
      extracted = extractResult?.[0]?.result || [];
    }

    mdFinal = md;
    for (var i = 0; i < extracted.length; i++) {
      var ex = extracted[i];
      if (ex && ex.dataUrl) {
        var ref = refs[i] || {};
        var fname = artifactFilename(ex.url, ref.label || '', i, slug, ref.kind || 'image');
        var targetPath = folderPath + '/' + fname;
        var r = await downloadOne(ex.dataUrl, fname, targetPath);
        if (r.ok) {
          dlOk++;
          mdFinal = mdFinal.split(ex.url).join('./' + r.filename);
          if (zipEntries) {
            var dataPart = ex.dataUrl.split(',')[1] || '';
            var bin = Uint8Array.from(atob(dataPart), function(c) { return c.charCodeAt(0); });
            addZipEntry(zipEntries, projectSlug, convSlug, fname, bin);
          }
        } else {
          dlErrors.push(r.error || 'unknown');
        }
      }
    }
  }

  // The markdown IS the export. Chrome can refuse the write (an invalid filename,
  // a full disk, a user-cancelled prompt), so the outcome is returned rather than
  // discarded: a caller that counts a refused write as a saved conversation
  // reports success for an empty folder.
  var mdWrite = await downloadOne(
    'data:text/markdown;charset=utf-8,' + encodeURIComponent(mdFinal),
    mdName,
    folderPath + '/' + mdName
  );
  if (zipEntries) addZipEntry(zipEntries, projectSlug, convSlug, mdName, mdFinal);

  return {
    mdFinal: mdFinal,
    partialSuffix: partialSuffix,
    dlOk: dlOk,
    dlTotal: dlTotal,
    dlErrors: dlErrors,
    mdName: mdName,
    mdOk: mdWrite.ok,
    mdError: mdWrite.error || null,
  };
}

/** Walk the sidebar conversation list in the active tab, export each in turn. */
async function runBatchExport(tab, options) {
  var downloadImages = options.downloadImages;
  var useTimestamp = options.useTimestamp;
  var projectSlug = options.projectSlug;
  var batchStamp = options.batchStamp;
  var onProgress = options.onProgress;
  var zipEntries = options.buildZip ? [] : null;
  var completedPaths = await searchCompletedDownloadPaths(projectSlug);
  var listResult = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async function() {
      // Scroll the virtualized sidebar so every row mounts. The one-frame
      // reader is the fallback only: it can return a subset, and a subset
      // exported as "the whole Project" is invisible to the user.
      if (typeof collectSidebarConversations === 'function') {
        return await collectSidebarConversations();
      }
      if (typeof listSidebarConversations === 'function') {
        return { conversations: listSidebarConversations(), complete: false, reason: 'no-collector' };
      }
      return { conversations: [], complete: false, reason: 'no-collector' };
    },
  });
  var listed = listResult?.[0]?.result || {};
  var conversations = (listed && listed.conversations) || [];
  var listComplete = !!(listed && listed.complete);
  var listReason = (listed && listed.reason) || 'unknown';
  if (!conversations.length) {
    return { ok: false, error: 'No conversations found in the sidebar. Open a ChatGPT Project page first.' };
  }

  var pending = filterPendingConversations(conversations, completedPaths, projectSlug);
  var skipped = conversations.length - pending.length;
  var exported = 0;
  var errors = [];
  // Null when the storage permission is absent, which makes every index check a
  // no-op and leaves the download-history path in charge — the pre-1.2.0
  // behaviour, unchanged.
  var exportIndex = await readExportIndex();
  var indexSkipped = 0;
  var grown = 0;

  var retried = 0;
  var held = 0;
  var partial = 0;
  var maxAttempts = options.maxAttempts || 3;
  var maxHoldRounds = options.maxHoldRounds || 20;
  var controls = {
    isPaused: options.isPaused || function() { return batchPaused; },
    isCancelled: options.isCancelled || function() { return batchCancelled; },
  };

  /** Fetch one conversation. Returns {ok, result} or {ok:false, error}. */
  /** Wait for the tab to finish navigating before scripting it again.
   *
   *  Measured during a full-account export: every conversation reported progress
   *  and NOTHING reached the disk — 60 conversations in, zero files. The cause is
   *  here. `executeScript` issued immediately after `location.href` targets the
   *  document the navigation is destroying, so the injected promise never
   *  settles and the call resolves with `undefined` — not an error, just null.
   *  `attemptConversation` then read that as "did not load", retried twice, and
   *  moved on. The counter advanced; nothing was ever exported.
   */
  function waitForTabNavigation(tabId, conversationId, timeoutMs) {
    var budget = timeoutMs || 30000;
    // Without chrome.tabs.get there is no way to observe the navigation. Resolve
    // true rather than hanging: the readiness check that follows is the real
    // gate, and a missing optional API must not wedge the run.
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.get) {
      return Promise.resolve(true);
    }
    return new Promise(function(resolve) {
      var startedAt = Date.now();
      function poll() {
        chrome.tabs.get(tabId, function(t) {
          if (chrome.runtime.lastError || !t) return resolve(false);
          var onConversation = !conversationId ||
            String(t.url || '').indexOf('/c/' + conversationId) !== -1;
          if (t.status === 'complete' && onConversation) return resolve(true);
          if (Date.now() - startedAt >= budget) return resolve(false);
          setTimeout(poll, 300);
        });
      }
      poll();
    });
  }

  /** Read a conversation's metadata from the page, for the skip decision.
   *
   *  Runs in the tab rather than the popup because the request needs the
   *  session the user is already signed in with, and that session belongs to the
   *  page. Requires navigating there first, which is why this is called after
   *  the tab has arrived — the saving is in not SCANNING an unchanged
   *  conversation, which is where the minutes go, not in avoiding the visit.
   *
   *  Any failure returns null, which classifies as 'unknown' and exports. */
  async function readConversationMetadata(tabId, conv) {
    try {
      var navigated = await (async function() {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: function(href) { window.location.href = href; },
          args: [conv.href],
        });
        return await waitForTabNavigation(tabId, conv.id, 30000);
      })();
      if (!navigated) return null;
      await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['content.js'] });
      var out = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: async function(conversationId) {
          if (typeof fetchConversationMetadata !== 'function') return null;
          return await fetchConversationMetadata(conversationId, {});
        },
        args: [conv.id],
      });
      return (out && out[0] && out[0].result) || null;
    } catch (_e) {
      return null;
    }
  }

  async function attemptConversation(conv) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: function(href) { window.location.href = href; },
      args: [conv.href],
    });

    // The navigation replaces the document, taking the content script with it.
    var navigated = await waitForTabNavigation(tab.id, conv.id, 30000);
    if (!navigated) return { ok: false, error: 'did not load' };
    // Re-inject into the NEW document; the helpers below live in content.js.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });

    var readyResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async function(conversationId) {
        if (typeof waitForConversationReady === 'function') {
          return await waitForConversationReady({ conversationId: conversationId, timeoutMs: 30000 });
        }
        return { ready: false, error: 'waitForConversationReady is unavailable.' };
      },
      args: [conv.id],
    });
    var ready = readyResult?.[0]?.result;
    if (!ready || !ready.ready) {
      return { ok: false, error: (ready && ready.error) || 'did not load' };
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });

    scanningTabId = tab.id;
    startProgressPolling(tab.id);
    var results;
    try {
      results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async function(wantFiles) { return getConversationMarkdown({ downloadFiles: wantFiles }); },
        args: [!!downloadImages],
      });
    } finally {
      stopProgressPolling();
    }

    var scanned = results?.[0]?.result;
    if (!scanned || !scanned.ok) {
      return { ok: false, error: (scanned && scanned.error) || 'scan failed' };
    }
    return { ok: true, result: scanned };
  }

  for (var index = 0; index < pending.length; index++) {
    if (controls.isCancelled()) break;
    // Pause is honoured BETWEEN conversations and inside the retry wait below,
    // so a long run can be held without losing the conversations already done.
    if (!(await waitWhilePaused(controls))) break;
    var conv = pending[index];
    var progressTitle = conv.title || conv.slug || conv.id;
    if (onProgress) onProgress(index, pending.length, progressTitle);

    // Ask the cheap question first. `filterPendingConversations` can only reason
    // about filenames, and a filename cannot say whether a conversation gained
    // messages since it was saved — so a conversation already on disk arrives
    // here either way. One metadata request decides it: unchanged conversations
    // cost milliseconds instead of the minutes a full walk takes.
    //
    // Every uncertain answer resolves towards exporting. 'unknown' (metadata
    // unreadable) and a missing index both export, because the cost of an
    // unnecessary export is bandwidth while the cost of a wrong skip is a
    // conversation that never lands and cannot be recovered by re-running.
    var liveMeta = null;
    var grewThisRound = false;
    if (exportIndex) {
      liveMeta = await readConversationMetadata(tab.id, conv);
      var verdict = classifyAgainstIndex(exportIndex, conv.id, liveMeta).verdict;
      if (verdict === 'unchanged') {
        indexSkipped += 1;
        continue;
      }
      if (verdict === 'grown') {
        grewThisRound = true;
        // The conversation changed since the last export. Chrome cannot append
        // to a file, so the previous export is left exactly as it is and this
        // one lands beside it under its own stamp.
        grown += 1;
      }
    }

    var attempt = 0;
    var outcome = null;
    var lastError = '';
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        outcome = await attemptConversation(conv);
      } catch (err) {
        outcome = { ok: false, error: (err && err.message) || String(err) };
      }
      if (outcome.ok) break;

      lastError = outcome.error;
      var kind = classifyBatchFailure(lastError);
      if (kind === 'conversation') break;          // a real per-conversation problem: do not retry
      if (controls.isCancelled()) break;

      if (kind === 'offline' || kind === 'unreachable') {
        // The network, not this conversation. HOLD rather than spending the
        // remaining list: a 40-conversation export must not fail 39 times
        // because the connection dropped for a minute.
        if (held >= maxHoldRounds) {
          lastError = 'network unavailable after ' + held + ' waits: ' + lastError;
          break;
        }
        held += 1;
        if (onProgress) onProgress(index, pending.length, progressTitle + ' — waiting for the network (' + held + ')');
        attempt -= 1;                               // a hold is not an attempt against this conversation
        await sleep(backoffDelayMs(Math.min(held, 4)));
        if (!(await waitWhilePaused(controls))) break;
        continue;
      }

      // transient: retry with backoff inside this conversation's budget
      if (attempt < maxAttempts) {
        retried += 1;
        if (onProgress) onProgress(index, pending.length, progressTitle + ' — retry ' + attempt + '/' + (maxAttempts - 1));
        await sleep(backoffDelayMs(attempt));
        if (!(await waitWhilePaused(controls))) break;
      }
    }

    if (controls.isCancelled()) break;
    if (!outcome || !outcome.ok) {
      errors.push((conv.title || conv.id) + ': ' + (lastError || 'failed'));
      continue;
    }
    var result = outcome.result;

    var writeOk = false;
    var writeError = null;
    // A conversation that GREW is stamped whether or not the option is ticked.
    // Chrome cannot append to a file and overwriting would destroy the earlier
    // export, so the new copy must carry a name of its own. This is the whole
    // reason the stamp exists; it is not a user preference in this case.
    var stampThis = useTimestamp || grewThisRound;
    if (downloadImages) {
      var saved = await saveConversationExport(tab.id, result, {
        downloadImages: true,
        useTimestamp: stampThis,
        batchStamp: batchStamp,
        projectSlug: projectSlug,
        zipEntries: zipEntries,
        conversationId: conv.id,
      });
      writeOk = saved.mdOk;
      writeError = saved.mdError;
    } else {
      var slug = result.slug || conv.slug || conv.id;
      var mdName = batchMdFilename(slug, conv.id, stampThis, batchStamp, result.partial);
      var folder = conversationFolderPath(slug, projectSlug);
      var write = await downloadOne(
        'data:text/markdown;charset=utf-8,' + encodeURIComponent(result.md),
        mdName,
        folder + '/' + mdName
      );
      writeOk = write.ok;
      writeError = write.error;
      if (writeOk && zipEntries) addZipEntry(zipEntries, projectSlug, slug, mdName, result.md);
    }

    // A refused write is a failure, not an export. Counting it made a run whose
    // every write Chrome rejected report the whole project as saved.
    if (!writeOk) {
      errors.push((conv.title || conv.id) + ': not saved (' + (writeError || 'download rejected') + ')');
      continue;
    }

    exported += 1;
    var exportSlug = result.slug || conv.slug || conv.id;
    if (result.partial) {
      // A stall-truncated export must NOT be banked as done. Banking it made the
      // next run skip the conversation as "already exported", so the one action
      // that could repair a truncated file was the one action refused — while the
      // popup reported success. Counted and reported instead.
      partial += 1;
      errors.push((conv.title || conv.id) + ': saved incompletely (scan did not reach the end) — re-run to finish it');
    } else {
      completedPaths.add(mdDownloadPath(exportSlug, projectSlug, stampThis, batchStamp, conv.id));
      // Record only a COMPLETE export. A partial one is deliberately not banked,
      // for the same reason it is not added to completedPaths: the next run must
      // be free to finish it rather than skip it as done.
      if (liveMeta) {
        await recordExportedConversation(conv.id, {
          updateTime: liveMeta.updateTime,
          currentNode: liveMeta.currentNode,
          messageCount: liveMeta.messageCount,
          bytes: result.md ? result.md.length : null,
          files: 0,
        });
      }
    }
  }

  var zipName = null;
  if (zipEntries && zipEntries.length > 0 && typeof buildStoreZip === 'function') {
    // The zip is a convenience on top of files that are ALREADY on disk. If it
    // fails — too many entries for the format, a refused write — the run must
    // still report the conversations it exported, so the failure is recorded as
    // an error rather than thrown away or allowed to reject the whole export.
    var stamp = batchStamp || formatExportTimestamp();
    var candidateName = (projectSlug || 'project') + '-export--' + stamp + '.zip';
    var handle = null;
    try {
      var zipBytes = buildStoreZip(zipEntries);
      handle = bytesToDownloadUrl(zipBytes, 'application/zip');
      // The archive is a large blob, so Chrome may take longer to ACCEPT it than
      // a small data: URL — and if `downloadOne` gave up first, the `finally`
      // below would revoke the URL while Chrome was still reading it. The accept
      // budget is therefore aligned with the write budget rather than left at the
      // 12s default meant for per-conversation files.
      var zipWrite = await downloadOne(
        handle.url, candidateName, batchRootPath(projectSlug) + '/' + candidateName, ZIP_WRITE_TIMEOUT_MS);
      if (zipWrite.ok) {
        // Chrome accepted the download; the bytes are still being written. Wait
        // before the `finally` below revokes the blob URL backing them — and
        // believe the ANSWER, not the acceptance: an interrupted write leaves no
        // archive, so reporting its name would be another silent success.
        var written = await waitForDownloadComplete(zipWrite.downloadId, ZIP_WRITE_TIMEOUT_MS);
        if (written) {
          zipName = candidateName;
        } else {
          errors.push('archive not completed — the exported files are still on disk');
        }
      } else {
        errors.push('archive not saved (' + (zipWrite.error || 'download rejected') + ') — the exported files are still on disk');
      }
    } catch (zipErr) {
      errors.push('archive not created (' + ((zipErr && zipErr.message) || zipErr) + ') — the exported files are still on disk');
    } finally {
      if (handle) handle.revoke(handle.url);
    }
  }

  return {
    ok: true,
    total: conversations.length,
    exported: exported,
    // Reported explicitly: a conversation skipped because it was already on
    // disk is not a failure, but silence about it reads as success.
    skipped: skipped,
    // Skipped because the index proved the conversation had not changed since it
    // was exported. Counted separately from `skipped`, which is a filename
    // match: this one is a content decision and the user is entitled to see
    // that the run examined the conversation rather than merely recognised a name.
    unchanged: indexSkipped,
    // Conversations that gained messages since the last export and were written
    // beside the earlier file under their own stamp, not over it.
    grown: grown,
    retried: retried,
    // Conversations written but truncated. Reported so "complete" cannot mean
    // "some files are cut short", and deliberately NOT banked as done so a
    // re-run repairs them.
    partial: partial,
    networkWaits: held,
    cancelled: controls.isCancelled(),
    // False when the sidebar walk could not prove it reached the end of the
    // list. The export is then a SUBSET of the Project, and saying so is the
    // whole point: the user cannot detect a missing conversation themselves.
    listComplete: listComplete,
    listReason: listReason,
    errors: errors,
    zipName: zipName,
  };
}

/** Hold the run without losing it. A long export over a network the extension
 *  does not control needs a hold that is not a cancel: cancelling keeps what
 *  landed but ends the run, while pausing resumes exactly where it stopped. */
if (btnPause) {
  btnPause.addEventListener('click', () => {
    batchPaused = !batchPaused;
    btnPause.textContent = batchPaused ? 'Resume' : 'Pause';
    if (batchPaused) showStatus('', 'Paused — press Resume to continue.');
  });
}

btnCancel.addEventListener('click', async () => {
  if (scanningTabId === null) return;
  batchCancelled = true;
  btnCancel.disabled = true;
  btnCancel.textContent = 'Stopping…';
  try {
    await chrome.scripting.executeScript({
      target: { tabId: scanningTabId },
      func: function() { if (window.__c2mScan) window.__c2mScan.cancelled = true; },
    });
  } catch (_e) {
    // Nothing to cancel — the scan already ended.
  }
});

btn.addEventListener('click', async () => {
  btn.disabled = true;
  batchCancelled = false;
  const batchMode = chkBatch && chkBatch.checked;
  btn.textContent = batchMode ? 'Preparing batch export…' : 'Scanning conversation…';
  btnCancel.classList.add('visible');
  btnCancel.disabled = false;
  if (btnPause) {
    batchPaused = false;
    btnPause.textContent = 'Pause';
    btnPause.classList.add('visible');
  }
  btnCancel.textContent = batchMode ? 'Stop export' : 'Stop scanning';
  status.className = '';
  status.textContent = '';
  refreshOptionWarnings();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url?.match(/https:\/\/(chatgpt\.com|chat\.openai\.com)\//)) {
      showStatus('error', 'Open a ChatGPT conversation page first.');
      return;
    }

    const useTimestamp = chkTimestamp && chkTimestamp.checked;
    const downloadImages = chkImages && chkImages.checked;

    if (batchMode) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      });

      var projectInfo = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: function() {
          var title = typeof extractConversationTitle === 'function' ? extractConversationTitle() : null;
          var slug = title && typeof slugifyTitle === 'function' ? slugifyTitle(title) : null;
          return { title: title, slug: slug || 'project-batch' };
        },
      });
      var projectSlug = projectInfo?.[0]?.result?.slug || 'project-batch';
      var batchStamp = useTimestamp ? formatExportTimestamp() : null;
      scanningTabId = tab.id;

      var batchResult = await runBatchExport(tab, {
        downloadImages: downloadImages,
        useTimestamp: useTimestamp,
        projectSlug: projectSlug,
        batchStamp: batchStamp,
        buildZip: true,
        onProgress: function(index, total, title) {
          btn.textContent = 'Exporting ' + formatBatchProgress(index, total, title);
        },
      });

      if (!batchResult.ok) {
        showStatus('error', batchResult.error || 'Batch export failed.');
        return;
      }

      // "Complete" is claimed ONLY when the sidebar walk proved it reached the
      // end of the list. Otherwise the run covered the conversations it could
      // see, which may be a subset — and the user cannot notice a conversation
      // that was never listed, so the wording has to carry the doubt.
      var summary = batchResult.listComplete
        ? '✓ Batch export complete: ' + batchResult.exported + ' saved'
        : '⚠ Exported ' + batchResult.exported + ' of the conversations the sidebar listed'
          + ' — the full list could not be confirmed';
      if (batchResult.skipped > 0) {
        // Never "already exported" on an unconfirmed list: that phrasing reads as
        // verified coverage and argues the user out of checking.
        summary += batchResult.listComplete
          ? ', ' + batchResult.skipped + ' skipped (already exported)'
          : ', ' + batchResult.skipped + ' skipped (files already on disk)';
      }
      if (batchResult.unchanged > 0) {
        summary += ', ' + batchResult.unchanged + ' unchanged';
      }
      if (batchResult.grown > 0) {
        // Say that a NEW file was written rather than the old one updated: the
        // user will find two files for one conversation and should know why
        // before wondering whether the export duplicated itself.
        summary += ', ' + batchResult.grown
          + (batchResult.grown === 1 ? ' updated (saved as a new dated copy)'
                                     : ' updated (saved as new dated copies)');
      }
      if (batchResult.partial > 0) {
        summary += ', ' + batchResult.partial + ' incomplete (re-run to repair)';
      }
      if (batchResult.cancelled) summary += ' — stopped early';
      if (!batchResult.listComplete) {
        summary += '\nScroll the sidebar to the end and re-run to pick up anything missing.';
      }
      if (batchResult.zipName) summary += '\nZip: ' + batchResult.zipName;
      if (batchResult.errors.length) summary += '\nErrors: ' + batchResult.errors.join('; ');
      showStatus(batchResult.listComplete ? 'success' : 'warning', summary);
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });

    scanningTabId = tab.id;
    startProgressPolling(tab.id);

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (wantFiles) => getConversationMarkdown({ downloadFiles: wantFiles }),
      args: [!!downloadImages],
    });

    stopProgressPolling();
    btnCancel.classList.remove('visible');
    if (batchWarning) batchWarning.classList.remove('visible');

    const result = results?.[0]?.result;

    if (!result) {
      showStatus('error', 'Could not get result from page.');
      return;
    }

    if (!result.ok) {
      showStatus('error', result.error || 'Unknown error');
      return;
    }

    let md = result.md;
    // Conversation title drives both the .md filename and its export folder.
    const slug = result.slug || null;
    const mdName = buildMdFilename(slug, useTimestamp);
    const partialSuffix = result.partial ? ' (partial export)' : '';

    if (downloadImages && typeof chrome.downloads !== 'undefined') {
      var saved = await saveConversationExport(tab.id, result, {
        downloadImages: true,
        useTimestamp: useTimestamp,
        projectSlug: null,
        zipEntries: null,
      });
      var mdFinal = saved.mdFinal;
      var refs = parseArtifactRefs(md);
      var dlOk = saved.dlOk;
      var dlErrors = saved.dlErrors || [];

      if (dlOk > 0) {
        showStatus('success',
          '✓ Copied!' + partialSuffix + ' ' + result.lines + ' lines · ' + result.words + ' words\n' +
          'Files: ' + dlOk + '/' + refs.length + ' downloaded + ' + mdName
        );
      } else if (refs.length > 0) {
        var hint = dlErrors.length > 0 ? ' (' + dlErrors[0] + ')' : '';
        showStatus('success',
          '✓ Copied!' + partialSuffix + ' ' + result.lines + ' lines · ' + result.words + ' words\n' +
          'Files: 0/' + refs.length + ' fetched' + hint + ' — original URLs kept in .md'
        );
      } else {
        showStatus('success',
          '✓ Copied!' + partialSuffix + ' ' + result.lines + ' lines · ' + result.words + ' words\n' +
          mdName + ' saved'
        );
      }

      await navigator.clipboard.writeText(mdFinal);
      btn.disabled = false;
      btn.textContent = 'Copy as Markdown';
      return;
    }

    await navigator.clipboard.writeText(md);

    showStatus(
      'success',
      '✓ Copied!' + partialSuffix + ' ' + result.lines + ' lines · ' + result.words + ' words'
    );
  } catch (err) {
    showStatus('error', err.message || String(err));
  } finally {
    stopProgressPolling();
    scanningTabId = null;
    btnCancel.classList.remove('visible');
    if (batchWarning) batchWarning.classList.remove('visible');
    btn.disabled = false;
    btn.textContent = 'Copy as Markdown';
  }
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    addZipEntry: addZipEntry,
    artifactFilename: artifactFilename,
    sanitizeFilenamePart: sanitizeFilenamePart,
    splitFilenameExtension: splitFilenameExtension,
    batchRootPath: batchRootPath,
    buildMdFilename: buildMdFilename,
    batchMdFilename: batchMdFilename,
    bytesToDownloadUrl: bytesToDownloadUrl,
    waitForDownloadComplete: waitForDownloadComplete,
    ZIP_WRITE_TIMEOUT_MS: ZIP_WRITE_TIMEOUT_MS,
    ID_MARKER: ID_MARKER,
    foldExceptId: foldExceptId,
    candidateExportNames: candidateExportNames,
    conversationFolderFromPath: conversationFolderFromPath,
    mdStem: mdStem,
    stampsInPaths: stampsInPaths,
    conversationFolderPath: conversationFolderPath,
    downloadOne: downloadOne,
    filterPendingConversations: filterPendingConversations,
    classifyBatchFailure: classifyBatchFailure,
    backoffDelayMs: backoffDelayMs,
    waitWhilePaused: waitWhilePaused,
    formatBatchProgress: formatBatchProgress,
    formatExportTimestamp: formatExportTimestamp,
    exportPath: exportPath,
    isDownloadableFileUrl: isDownloadableFileUrl,
    mdDownloadPath: mdDownloadPath,
    parseArtifactRefs: parseArtifactRefs,
    parseFileRefs: parseFileRefs,
    parseImageRefs: parseImageRefs,
    runBatchExport: runBatchExport,
    searchCompletedDownloadPaths: searchCompletedDownloadPaths,
    readExportIndex: readExportIndex,
    recordExportedConversation: recordExportedConversation,
    classifyAgainstIndex: classifyAgainstIndex,
    INDEX_KEY: INDEX_KEY,
    INDEX_BYTE_BUDGET: INDEX_BYTE_BUDGET,
  };
}
