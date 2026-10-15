import { downloadStaticSite } from './controls.mjs';
import { bytesToDownloadUrl, downloadOne, textToUtf8Bytes, waitForDownloadComplete } from './downloads.mjs';
import { btnShowFolder, showStatus, status } from './options.mjs';
import { formatExportTimestamp } from './paths.mjs';
import { state } from './state.mjs';
import { handlePanelHide, storageArea } from './storage.mjs';

/** Where the last failure is kept so it outlives the popup. */
var LAST_ERROR_KEY = 'c2mLastError';

/** Report a failure so it can be investigated afterwards.
 *
 *  The operator hit a failure on a ~600-turn conversation and had nothing to look
 *  at: this product shipped with ZERO console calls in any of its three scripts,
 *  and the only channel was `err.message` in a popup element that dies with the
 *  popup. "I have no logs" was an accurate description of the code.
 *
 *  Three channels, because each fails differently. The status element is the one
 *  the user reads and the one that disappears. The console survives as long as
 *  DevTools is attached and carries the STACK, which the status never showed.
 *  chrome.storage survives the popup closing entirely, which is the case that
 *  left the operator with nothing. */
function reportFailure(phase, err) {
  var message = (err && err.message) || String(err) || 'unknown error';
  showStatus('error', message);

  var detail = {
    phase: sanitizeLogText(phase),
    message: sanitizeLogText(message),
    stack: err && err.stack ? sanitizeLogText(err.stack) : null,
    at: new Date().toISOString(),
  };

  // eslint-disable-next-line no-console
  if (typeof console !== 'undefined' && console.error) {
    console.error('[conversation-to-markdown] ' + phase + ' failed:', detail);
  }

  // Best effort by design: a failure to record a failure must not replace it.
  try {
    var area = storageArea();
    if (area)
      area.set({ [LAST_ERROR_KEY]: detail }, function () {
        void chrome.runtime.lastError;
      });
  } catch (_e) {
    /* the report is a courtesy; the error above is the message */
  }
}

/** The status line for a save-to-disk export: what landed, what did not, and why.
 *
 *  Extracted from the click handler so it can be tested. It was inline, and the
 *  consequence was not cosmetic: `saved.mdOk` went unread for the whole life of
 *  the feature, so Chrome refusing the .md write produced "✓ Copied!" over an
 *  empty folder. The helper had always returned the flag; nothing consumed it.
 *
 *  Returns {type, text} rather than calling showStatus, so a test can read the
 *  words the user gets instead of asserting that a function was called. */
function buildSaveStatus(parts) {
  var saved = parts.saved || {};
  var refs = parts.refs || [];
  var counts = parts.lines + ' lines · ' + parts.words + ' words';

  // THE FILE IS THE EXPORT. Its refusal is the headline, above any attachment
  // count: a run that saved nine images and no conversation saved nothing.
  if (!saved.mdOk) {
    return {
      type: 'error',
      text:
        'Not saved: ' +
        (saved.mdError || 'the browser refused the write') +
        '\n' +
        (refs.length > 0 ? saved.dlOk + '/' + refs.length + ' files were fetched. ' : '') +
        'Nothing was written for this conversation — run it again.',
    };
  }

  var incomplete = !!parts.partialSuffix || saved.dlOk < refs.length;
  var head = (incomplete ? '⚠ Saved incompletely' : '✓ Saved') + ' ' + counts + '\n' + saved.mdName;
  if (refs.length === 0)
    return {
      type: incomplete ? 'warning' : 'success',
      text: head + (incomplete ? '\nRe-run to complete it.' : ''),
    };
  if (saved.dlOk === refs.length) {
    return {
      type: incomplete ? 'warning' : 'success',
      text: head + ' + ' + saved.dlOk + '/' + refs.length + ' files' + (incomplete ? '\nRe-run to complete it.' : ''),
    };
  }
  // A missing attachment leaves an expiring URL in the saved Markdown.
  var reason = saved.dlErrors && saved.dlErrors.length > 0 ? ' (' + saved.dlErrors[0] + ')' : '';
  return {
    type: 'warning',
    text:
      head +
      '\n' +
      saved.dlOk +
      '/' +
      refs.length +
      ' files fetched' +
      reason +
      ' — missing files remain as links that expire. Re-run to repair.',
  };
}

/** The run whose log is being written, so a crash in this popup can still
 *  append the exception before the document goes away. */

function noteExportDownload(id) {
  if (id !== undefined && id !== null) state.lastExportDownloadId = id;
}

function revealExportFolder() {
  if (typeof chrome === 'undefined' || !chrome.downloads) return;
  if (state.lastExportDownloadId !== null && typeof chrome.downloads.show === 'function') {
    chrome.downloads.show(state.lastExportDownloadId);
    return;
  }
  if (typeof chrome.downloads.showDefaultFolder === 'function') chrome.downloads.showDefaultFolder();
}

function markExportFolderVisible() {
  if (!btnShowFolder || btnShowFolder.id !== 'btn-show-folder') return;
  if (btnShowFolder.classList) btnShowFolder.classList.add('visible');
}

if (btnShowFolder && btnShowFolder !== status && typeof btnShowFolder.addEventListener === 'function') {
  btnShowFolder.addEventListener('click', function () {
    revealExportFolder();
  });
}

/** Drop URLs, tokens, and oversized text. The log sits beside the export and
 *  must not become a second copy of the conversation or of a signed link. */
function sanitizeLogText(value) {
  var text = String(value == null ? '' : value);
  text = text.replace(/https?:\/\/[^\s)'"<>]+/gi, '[url]');
  text = text.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
  text = text.replace(/((?:sig|token|access_token|authorization)=)[^&\s]+/gi, '$1[redacted]');
  if (text.length > 600) text = text.slice(0, 600);
  return text;
}

function createRunLog(kind, options) {
  var manifest = null;
  try {
    manifest =
      typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getManifest === 'function'
        ? chrome.runtime.getManifest()
        : null;
  } catch (_e) {
    manifest = null;
  }
  var opts = options || {};
  return {
    version: (manifest && manifest.version) || null,
    runId: opts.runId || formatExportTimestamp(),
    kind: kind,
    startedAt: new Date().toISOString(),
    options: {
      saveMarkdown: !!opts.downloadImages,
      saveHtml: !!opts.downloadHtml,
    },
    events: [],
  };
}

function pushLogEvent(log, event) {
  if (!log) return;
  var source = event || {};
  log.events.push({
    at: new Date().toISOString(),
    level: source.level || 'info',
    phase: sanitizeLogText(source.phase || ''),
    outcome: sanitizeLogText(source.outcome || ''),
    conversationId: source.conversationId ? sanitizeLogText(source.conversationId) : null,
    title: source.title ? sanitizeLogText(source.title) : null,
    message: source.message ? sanitizeLogText(source.message) : null,
    stack: source.stack ? sanitizeLogText(source.stack) : null,
    counts: source.counts || null,
  });
}

function runLogJson(log) {
  return JSON.stringify(
    {
      version: log.version,
      runId: log.runId,
      kind: log.kind,
      startedAt: log.startedAt,
      updatedAt: new Date().toISOString(),
      options: log.options,
      events: log.events,
    },
    null,
    2
  );
}

/** Rewrite the log file with everything recorded so far. Chrome cannot append,
 *  so each flush overwrites one file for this run. A crash keeps the last
 *  flush. A failure here must not fail the export. */
async function flushRunLog(log, options) {
  if (!log) return { ok: false, error: 'no log' };
  var body = runLogJson(log);
  var opts = options || {};
  var ok = true;
  var error = null;
  if (opts.htmlSiteDir && typeof writeStaticSite === 'function') {
    try {
      writeStaticSite(opts.htmlSiteDir, {
        files: [{ path: 'export-log.json', body: body, mime: 'application/json', role: 'log' }],
      });
    } catch (err) {
      ok = false;
      error = (err && err.message) || String(err);
    }
  }
  var canDownload =
    opts.downloadLog !== false &&
    typeof chrome !== 'undefined' &&
    chrome.downloads &&
    typeof chrome.downloads.download === 'function';
  if (canDownload) {
    var handle = bytesToDownloadUrl(textToUtf8Bytes(body), 'application/json');
    try {
      var write = await downloadOne(
        handle.url,
        'export-log.json',
        'chatgpt-export/logs/' + log.runId + '.json',
        opts.timeoutMs || 12000
      );
      if (write.ok && chrome.downloads.onChanged) {
        var written = await waitForDownloadComplete(write.downloadId, opts.timeoutMs || 12000);
        if (!written) {
          ok = false;
          error = error || 'the log write did not complete';
        }
      } else if (!write.ok) {
        ok = false;
        error = write.error || error || 'download rejected';
      }
    } catch (err) {
      ok = false;
      error = (err && err.message) || String(err);
    } finally {
      if (handle) handle.revoke(handle.url);
    }
  }
  return { ok: ok, error: error };
}

function searchDownloadPaths(filenameRegex, accept) {
  return new Promise(function (resolve) {
    if (typeof chrome === 'undefined' || !chrome.downloads || !chrome.downloads.search) {
      resolve(null);
      return;
    }
    chrome.downloads.search({ filenameRegex: filenameRegex }, function (items) {
      var paths = [];
      if (items) {
        for (var i = 0; i < items.length; i++) {
          var item = items[i];
          if (!item || !item.filename) continue;
          if (item.exists === false) continue;
          if (item.state && item.state !== 'complete') continue;
          if (accept(item.filename)) paths.push(item.filename);
        }
      }
      resolve(paths);
    });
  });
}

function searchHtmlCompletePaths() {
  if (typeof htmlCompleteDirFromDownloadPath !== 'function') return Promise.resolve(null);
  return new Promise(function (resolve) {
    if (typeof chrome === 'undefined' || !chrome.downloads || !chrome.downloads.search) {
      resolve(null);
      return;
    }
    chrome.downloads.search(
      { filenameRegex: 'chatgpt-export/html/.+/(index\\.html|export-complete\\.txt)$' },
      function (items) {
        if (chrome.runtime && chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        var dirs = Object.create(null);
        for (var i = 0; i < (items || []).length; i++) {
          var item = items[i];
          if (!item || !item.filename) continue;
          var pageDir = htmlChatDirFromDownloadPath(item.filename);
          var markerDir = htmlCompleteDirFromDownloadPath(item.filename);
          var dir = pageDir || markerDir;
          if (!dir) continue;
          var row = dirs[dir] || (dirs[dir] = {});
          var field = pageDir ? 'page' : 'marker';
          if (!row[field] || (typeof item.id === 'number' && item.id > row[field].id)) row[field] = item;
        }
        var complete = [];
        for (var dir in dirs) {
          var row = dirs[dir];
          // The marker is written after the page. A later page write without a
          // later marker is partial, and a marker without a page proves nothing.
          // exists === false means the file was deleted. An absent exists field
          // is the same history row the Markdown search already keeps: Chrome
          // does not always set the field, and requiring true made every HTML
          // chat look missing and forced the page open. A missing marker, an
          // interrupted download, or a marker that is not newer than the page
          // is still incomplete.
          if (
            row.page &&
            row.marker &&
            row.page.exists !== false &&
            row.marker.exists !== false &&
            row.page.state === 'complete' &&
            row.marker.state === 'complete' &&
            typeof row.page.id === 'number' &&
            typeof row.marker.id === 'number' &&
            row.marker.id > row.page.id
          ) {
            complete.push(row.marker.filename);
          }
        }
        resolve(complete);
      }
    );
  });
}

function searchHtmlPagePaths() {
  if (typeof htmlChatDirFromDownloadPath !== 'function') return Promise.resolve(null);
  return searchDownloadPaths('chatgpt-export/html/.+/index\\.html$', htmlChatDirFromDownloadPath);
}

function htmlDirForConversation(conv) {
  if (typeof sessionDirectory !== 'function' || !conv) return null;
  return sessionDirectory({
    id: conv.id || null,
    title: conv.title || null,
    slug: conv.slug || null,
    projectId: conv.projectId || null,
    projectTitle: conv.projectTitle || null,
    projectSlug: conv.projectSlug || null,
  });
}

function htmlChatLanded(conv, completePaths) {
  if (!completePaths || typeof htmlCompleteDirFromDownloadPath !== 'function') return false;
  var dir = htmlDirForConversation(conv);
  if (!dir) return false;
  var needle = dir.toLowerCase();
  for (var i = 0; i < completePaths.length; i++) {
    var found = htmlCompleteDirFromDownloadPath(completePaths[i]);
    if (found && found.toLowerCase() === needle) return true;
  }
  return false;
}

function exportSavedLines(runLog, htmlSaved) {
  var lines = [];
  if (htmlSaved) lines.push('HTML: chatgpt-export/html/');
  if (runLog && runLog.runId) lines.push('Log: chatgpt-export/logs/' + runLog.runId + '.json');
  return lines.join('\n');
}

async function publishHtmlSessions(sessions) {
  var earlier = typeof searchHtmlPagePaths === 'function' ? await searchHtmlPagePaths() : [];
  if (earlier === null) earlier = [];
  var complete = typeof searchHtmlCompletePaths === 'function' ? await searchHtmlCompletePaths() : null;
  var laid = layoutStaticSite(sessions, earlier, complete);
  var write = await downloadStaticSite(laid);
  noteExportDownload(write.downloadId);
  return write;
}

if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('error', function (event) {
    if (!state.activeRunLog) return;
    var err = event && event.error;
    pushLogEvent(state.activeRunLog, {
      level: 'error',
      phase: 'window',
      outcome: 'exception',
      message: (err && err.message) || (event && event.message) || 'error',
      stack: err && err.stack,
    });
    flushRunLog(state.activeRunLog, state.activeRunLogOptions);
  });
  window.addEventListener('unhandledrejection', function (event) {
    if (!state.activeRunLog) return;
    var reason = event && event.reason;
    pushLogEvent(state.activeRunLog, {
      level: 'error',
      phase: 'unhandledrejection',
      outcome: 'exception',
      message: (reason && reason.message) || String(reason || 'unhandled rejection'),
      stack: reason && reason.stack,
    });
    flushRunLog(state.activeRunLog, state.activeRunLogOptions);
  });
  window.addEventListener('pagehide', handlePanelHide);
}

export {
  buildSaveStatus,
  createRunLog,
  exportSavedLines,
  flushRunLog,
  htmlChatLanded,
  htmlDirForConversation,
  LAST_ERROR_KEY,
  markExportFolderVisible,
  noteExportDownload,
  publishHtmlSessions,
  pushLogEvent,
  reportFailure,
  revealExportFolder,
  runLogJson,
  sanitizeLogText,
  searchDownloadPaths,
  searchHtmlCompletePaths,
  searchHtmlPagePaths,
};
