const btn = document.getElementById('btn-copy');
const btnCancel = document.getElementById('btn-cancel');
const btnPause = document.getElementById('btn-pause');
const status = document.getElementById('status');
const chkImages = document.getElementById('chk-images');
const chkTimestamp = document.getElementById('chk-timestamp');
const chkBatch = document.getElementById('chk-batch');
const batchWarning = document.getElementById('batch-warning');

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
function batchMdFilename(convSlug, convId, useTimestamp, stamp) {
  var base = convSlug || convId || 'conversation';
  var parts = base;
  if (useTimestamp) parts += '--' + (stamp || formatExportTimestamp());
  if (convId) parts += '--' + convId;
  return parts + '.md';
}

/** Full download path for a conversation's markdown file in a batch. */
function mdDownloadPath(convSlug, projectSlug, useTimestamp, stamp, convId) {
  var mdName = batchMdFilename(convSlug, convId, useTimestamp, stamp);
  return conversationFolderPath(convSlug, projectSlug) + '/' + mdName;
}

/** Reduce a download path to the part that identifies a conversation export.
 *
 *  Two things made the naive comparison always fail, and both are why a
 *  restarted export used to re-download everything:
 *
 *  1. `chrome.downloads.search` reports an ABSOLUTE path
 *     (a full path under the user's Downloads folder), while the batch
 *     builds a RELATIVE one (`chatgpt-export/proj/Chat/Chat.md`). Comparing the
 *     two forms is a guaranteed miss, and a fixture that feeds relative paths
 *     back models a Chrome that does not exist.
 *  2. With the date-time stamp enabled the filename carries the CURRENT run's
 *     stamp, so a file from a previous run could never match by name.
 *
 *  So identity is the conversation FOLDER plus the stem, with any `--<stamp>`
 *  suffix and any leading directories above `chatgpt-export/` removed.
 *
 *  CASE IS SPLIT DELIBERATELY. The directories are compared case-INSENSITIVELY
 *  because on macOS and Windows `Budget/` and `budget/` are the SAME directory,
 *  so folding them is what the filesystem actually does. The STEM keeps its
 *  original case, because `slugifyTitle` does not lower-case and two distinct
 *  ChatGPT conversations may differ only by case. Folding the stem too made them
 *  share one key, so interrupting a run after `Budget` exported but before
 *  `budget` did — the exact situation resume exists for — skipped `budget`
 *  forever and reported it as "already downloaded". Re-downloading costs
 *  bandwidth; a false skip silently loses a conversation, so the two directions
 *  are not equally bad. */
function completionKeyForPath(downloadPath) {
  var normalized = String(downloadPath || '').replace(/\\/g, '/');
  var anchor = normalized.indexOf('chatgpt-export/');
  if (anchor > 0) normalized = normalized.slice(anchor);
  var segments = normalized.split('/').filter(Boolean);
  if (!segments.length) return '';
  var file = segments.pop();
  // Strip in the order the batch appends: `<slug>[--<stamp>][--<id>].md`. The id
  // goes last, so it must come off first or the stamp pattern no longer anchors.
  var stem = file
    .replace(/\.md$/i, '')
    .replace(/--[A-Za-z0-9-]{8,}$/, '')
    .replace(/--\d{8}-\d{4}$/, '');
  var folder = segments.join('/').toLowerCase();
  return folder ? folder + '/' + stem : stem;
}

/** Extract the conversation id a downloaded file was named for, if any.
 *
 *  The id is the only identity ChatGPT guarantees unique. The batch appends it to
 *  the filename precisely so a resumed run can recover it from the path alone —
 *  there is no extension storage to consult, by design. */
function conversationIdFromPath(downloadPath) {
  var normalized = String(downloadPath || '').replace(/\\/g, '/');
  var file = normalized.split('/').filter(Boolean).pop() || '';
  var match = file.replace(/\.md$/i, '').match(/--([A-Za-z0-9-]{8,})$/);
  if (!match) return '';
  // A date-time stamp also matches "8+ chars after a double dash"; it is not an id.
  return /^\d{8}-\d{4}$/.test(match[1]) ? '' : match[1];
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
  var ids = new Set();
  var legacySlugKeys = new Set();
  if (completedPaths && typeof completedPaths.forEach === 'function') {
    completedPaths.forEach(function(item) {
      var id = conversationIdFromPath(item);
      if (id) {
        ids.add(id);
        return;   // an id-bearing file identifies itself; it must not also seed
                  // the title-keyed set, or two same-titled conversations would
                  // collide there and one would be skipped without landing.
      }
      var key = completionKeyForPath(item);
      if (key) legacySlugKeys.add(key);
    });
  }
  return conversations.filter(function(conv) {
    if (conv.id && ids.has(conv.id)) return false;
    // Fall back to the title-derived key so files written by an EARLIER version —
    // which carried no id — are still recognised; otherwise upgrading the
    // extension would re-download an entire archive. This fallback is what makes
    // a title collision skip a conversation, so it applies only when the id was
    // not found among the id-bearing files: `legacySlugKeys` excludes any path
    // that carries an id of its own.
    var slug = conv.slug || conv.id;
    return !legacySlugKeys.has(completionKeyForConversation(slug, projectSlug));
  });
}

/** Build the completion key a conversation would have once exported. */
function completionKeyForConversation(convSlug, projectSlug) {
  return completionKeyForPath(conversationFolderPath(convSlug, projectSlug) + '/' + (convSlug || 'conversation') + '.md');
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

/** Resume a batch by reading prior download paths — no extension storage API. */
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
          if (items[i].filename) paths.add(items[i].filename);
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

/** Wait until Chrome has finished writing a download, so a blob URL backing it
 *  is not revoked out from under a write still in progress.
 *
 *  `chrome.downloads.download` reports acceptance, not completion: its callback
 *  fires with a download id while the bytes are still being written. Revoking the
 *  URL at that point truncates exactly the large archive a blob URL exists to
 *  carry. Resolves anyway on timeout — a stuck download must not wedge the run,
 *  and leaking one URL for the popup's lifetime is the cheaper failure. */
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
    ? batchMdFilename(slug, conversationId, useTimestamp, batchStamp)
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
    func: function() {
      if (typeof listSidebarConversations === 'function') return listSidebarConversations();
      return [];
    },
  });
  var conversations = listResult?.[0]?.result || [];
  if (!conversations.length) {
    return { ok: false, error: 'No conversations found in the sidebar. Open a ChatGPT Project page first.' };
  }

  var pending = filterPendingConversations(conversations, completedPaths, projectSlug);
  var skipped = conversations.length - pending.length;
  var exported = 0;
  var errors = [];

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
  async function attemptConversation(conv) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: function(href) { window.location.href = href; },
      args: [conv.href],
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
        func: async function() { return getConversationMarkdown(); },
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
    if (downloadImages) {
      var saved = await saveConversationExport(tab.id, result, {
        downloadImages: true,
        useTimestamp: useTimestamp,
        batchStamp: batchStamp,
        projectSlug: projectSlug,
        zipEntries: zipEntries,
        conversationId: conv.id,
      });
      writeOk = saved.mdOk;
      writeError = saved.mdError;
    } else {
      var slug = result.slug || conv.slug || conv.id;
      var mdName = batchMdFilename(slug, conv.id, useTimestamp, batchStamp);
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
      completedPaths.add(mdDownloadPath(exportSlug, projectSlug, useTimestamp, batchStamp, conv.id));
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
      var zipWrite = await downloadOne(handle.url, candidateName, batchRootPath(projectSlug) + '/' + candidateName);
      if (zipWrite.ok) {
        // Chrome accepted the download; the bytes are still being written. Wait
        // before the `finally` below revokes the blob URL backing them.
        await waitForDownloadComplete(zipWrite.downloadId);
        zipName = candidateName;
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
    retried: retried,
    // Conversations written but truncated. Reported so "complete" cannot mean
    // "some files are cut short", and deliberately NOT banked as done so a
    // re-run repairs them.
    partial: partial,
    networkWaits: held,
    cancelled: controls.isCancelled(),
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
  if (batchWarning) batchWarning.classList.toggle('visible', batchMode);

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

      var summary = '✓ Batch export complete: ' + batchResult.exported + ' saved';
      if (batchResult.skipped > 0) summary += ', ' + batchResult.skipped + ' skipped (already exported)';
      if (batchResult.cancelled) summary += ' — stopped early';
      if (batchResult.zipName) summary += '\nZip: ' + batchResult.zipName;
      if (batchResult.errors.length) summary += '\nErrors: ' + batchResult.errors.join('; ');
      showStatus('success', summary);
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
      func: async () => getConversationMarkdown(),
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
    conversationIdFromPath: conversationIdFromPath,
    conversationFolderPath: conversationFolderPath,
    downloadOne: downloadOne,
    filterPendingConversations: filterPendingConversations,
    completionKeyForPath: completionKeyForPath,
    completionKeyForConversation: completionKeyForConversation,
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
  };
}
