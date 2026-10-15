import { downloadStaticSite, projectIdFromLocation } from './controls.mjs';
import {
  bytesToDownloadUrl,
  downloadOne,
  saveConversationExport,
  searchCompletedDownloadPaths,
  startProgressPolling,
  stopProgressPolling,
  waitForDownloadComplete,
  ZIP_WRITE_TIMEOUT_MS,
} from './downloads.mjs';
import {
  createRunLog,
  flushRunLog,
  htmlChatLanded,
  noteExportDownload,
  pushLogEvent,
  searchHtmlCompletePaths,
  searchHtmlPagePaths,
} from './logging.mjs';
import { showStatus } from './options.mjs';
import { batchRootPath, filterPendingConversations, formatExportTimestamp, mdDownloadPath } from './paths.mjs';
import {
  backoffDelayMs,
  classifyBatchFailure,
  createCallQuota,
  OPENAI_CALL_WINDOW_MS,
  OPENAI_CALLS_PER_MINUTE,
  OPENAI_FILE_LOOKUP_CALLS,
  OPENAI_METADATA_CALLS,
  OPENAI_PAGE_LOAD_CALLS,
  RATE_LIMIT_RETRY_CLICKS,
  RATE_LIMIT_RETRY_WAIT_MS,
  sleep,
  waitWhilePaused,
} from './quota.mjs';
import { state } from './state.mjs';
import {
  classifyAgainstIndex,
  conversationJobRecord,
  mergeBackupConversations,
  readExportIndex,
  readSidebarConversations,
  recordExportedConversation,
  rememberBatchJob,
  writeBatchJob,
} from './storage.mjs';

/** Sleep in slices so Stop and Pause are noticed during the rate-limit wait. */
async function sleepUnlessStopped(ms, guard) {
  var left = ms > 0 ? ms : 0;
  while (left > 0) {
    if (!(await waitWhilePaused(guard))) return false;
    var step = left > 1000 ? 1000 : left;
    await sleep(step);
    left -= step;
  }
  return !(guard && guard.isCancelled && guard.isCancelled());
}

/** See the conversation Retry screen, wait, click it, and repeat until the
 *  thread is actually on the page. Opening the next chat while this screen
 *  is up is what keeps the limit in place.
 */
async function waitForLoadedConversation(tabId, conversationId, hooks) {
  var guard = hooks || {};
  var clicks = 0;
  var limit = typeof guard.maxClicks === 'number' ? guard.maxClicks : RATE_LIMIT_RETRY_CLICKS;
  var waitMs = typeof guard.waitMs === 'number' ? guard.waitMs : RATE_LIMIT_RETRY_WAIT_MS;
  while (true) {
    var readyResult = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: async function (id, timeoutMs) {
        if (typeof waitForConversationReady !== 'function') {
          return { ready: false, error: 'waitForConversationReady is unavailable.' };
        }
        return await waitForConversationReady({ conversationId: id, timeoutMs: timeoutMs });
      },
      args: [conversationId, guard.contentTimeoutMs == null ? 30000 : guard.contentTimeoutMs],
    });
    var ready = readyResult && readyResult[0] && readyResult[0].result;
    if (!ready) return { ready: false, error: 'did not load' };
    if (ready.ready || !ready.rateLimited) return ready;
    if (clicks >= limit) return ready;
    if (guard.onWait) guard.onWait(clicks + 1, waitMs);
    if (!(await sleepUnlessStopped(waitMs, guard))) return { ready: false, error: 'cancelled' };
    clicks += 1;
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function () {
        if (typeof clickConversationRetry === 'function') return clickConversationRetry();
        return false;
      },
    });
  }
}

/** Walk the sidebar conversation list in the active tab, export each in turn. */
async function runBatchExport(tab, options) {
  var downloadImages = options.downloadImages;
  var useTimestamp = options.useTimestamp;
  var projectId = options.projectId === undefined ? projectIdFromLocation(tab && tab.url) : options.projectId;
  var scopeKnown = options.projectId !== undefined || !!(tab && tab.url);
  var projectSlug = options.projectSlug;
  var batchStamp = options.batchStamp || formatExportTimestamp();
  var onProgress = options.onProgress;
  var zipEntries = options.buildZip ? [] : null;
  if (zipEntries && typeof options.zipByteBudget === 'number') {
    zipEntries.budget = options.zipByteBudget;
  }
  var completedPaths = await searchCompletedDownloadPaths(projectSlug);
  var conversations;
  var listComplete;
  var listReason;
  var discovered = 0;
  // A saved list alone is the paused backup. `discover` walks the open sidebar
  // and appends chats that were not on that list. The saved rows are never
  // dropped: the page open days later may be a different project, and following
  // only that sidebar would lose the chats the user paused.
  if (options.discover && Array.isArray(options.conversations)) {
    var found = [];
    var walk = { complete: false, reason: 'unknown' };
    try {
      walk = await readSidebarConversations(tab.id);
      var projects = Object.create(null);
      for (var savedRow of options.conversations) {
        if (savedRow.projectId) projects[String(savedRow.projectId)] = true;
      }
      found = walk.conversations.filter(function (row) {
        return row.projectId && projects[String(row.projectId)];
      });
    } catch (_e) {
      found = [];
    }
    var merged = mergeBackupConversations(options.conversations, found);
    conversations = merged.conversations;
    discovered = merged.added;
    if (!found.length) {
      listComplete = false;
      listReason = 'saved-job';
    } else {
      listComplete = walk.complete;
      listReason = 'sync';
    }
  } else if (Array.isArray(options.conversations)) {
    conversations = options.conversations.map(conversationJobRecord).filter(function (row) {
      return row.id || row.href;
    });
    listComplete = options.listComplete !== false;
    listReason = 'saved-job';
  } else {
    var listed = await readSidebarConversations(tab.id);
    conversations = scopeKnown
      ? listed.conversations.filter(function (row) {
          return (row.projectId || null) === (projectId || null);
        })
      : listed.conversations;
    listComplete = listed.complete;
    listReason = listed.reason;
  }
  if (!conversations.length) {
    return { ok: false, error: 'No conversations found in the sidebar. Open a ChatGPT Project page first.' };
  }

  var wantHtmlRun = !!(options.htmlSiteDir || options.downloadHtml);
  // null means the history could not be read. That is not proof the page is
  // already there, so the run exports. A wrong skip loses the chat.
  var htmlCompletePaths = wantHtmlRun ? await searchHtmlCompletePaths() : [];
  var htmlHistoryKnown = htmlCompletePaths !== null;
  if (!htmlHistoryKnown) htmlCompletePaths = [];
  var htmlPagePaths = wantHtmlRun ? await searchHtmlPagePaths() : [];
  if (htmlPagePaths === null) htmlPagePaths = [];
  var exportIndex = await readExportIndex();
  var wantMarkdown = !!downloadImages || !wantHtmlRun;
  var markdownPending = filterPendingConversations(conversations, completedPaths, projectSlug);
  var markdownPendingKeys = Object.create(null);
  for (var m = 0; m < markdownPending.length; m++) {
    markdownPendingKeys[markdownPending[m].id || markdownPending[m].slug] = true;
  }
  // A filename says a file landed once, not whether the chat changed since.
  // With no index row we cannot prove it is unchanged, so a readable metadata
  // answer still exports that chat once. The filename does decide which chats
  // can be left closed while the unfinished ones are saved.
  function requestedFilesLanded(conv) {
    var htmlMissing = wantHtmlRun && (!htmlHistoryKnown || !htmlChatLanded(conv, htmlCompletePaths));
    var markdownMissing = wantMarkdown && markdownPendingKeys[conv.id || conv.slug];
    return !htmlMissing && !markdownMissing;
  }
  // Measured from the 2026-10-10, 2026-10-14 and 2026-10-15 export logs: resume
  // walked the saved list from the start, opened chats already logged as saved,
  // and stopped on the Retry screen. The 2026-10-15 run repeated the first 10
  // of 40 conversation events from 2026-10-14 and recorded zero skips. Chats
  // with no finished file go first, so that stop happens after progress on the
  // unfinished tail.
  var notYetSaved = [];
  var alreadySaved = [];
  for (var order = 0; order < conversations.length; order++) {
    if (requestedFilesLanded(conversations[order])) alreadySaved.push(conversations[order]);
    else notYetSaved.push(conversations[order]);
  }
  var pending = notYetSaved.concat(alreadySaved);
  var exported = 0;
  var errors = [];
  var indexSkipped = 0;
  var grown = 0;

  var leftClosed = 0;
  var retried = 0;
  var held = 0;
  var partial = 0;
  var htmlLinks = [];
  var htmlChatFiles = 0;
  var htmlOk = true;
  var runLog = createRunLog('batch', {
    runId: batchStamp || formatExportTimestamp(),
    downloadImages: downloadImages,
    downloadHtml: wantHtmlRun,
  });
  state.activeRunLog = runLog;
  state.activeRunLogOptions = { htmlSiteDir: options.htmlSiteDir || null, downloadLog: true };
  pushLogEvent(runLog, {
    phase: 'run',
    outcome: 'started',
    counts: {
      listed: conversations.length,
      pending: pending.length,
      discovered: discovered,
      notOnDisk: notYetSaved.length,
    },
  });
  var logOk = true;
  var logError = null;
  var startedLog = await flushRunLog(runLog, state.activeRunLogOptions);
  if (!startedLog.ok) {
    logOk = false;
    logError = startedLog.error;
  }
  var maxAttempts = options.maxAttempts || 3;
  var maxHoldRounds = options.maxHoldRounds || 20;
  var controls = {
    isPaused:
      options.isPaused ||
      function () {
        return state.batchPaused;
      },
    isCancelled:
      options.isCancelled ||
      function () {
        return state.batchCancelled;
      },
  };
  var callQuota =
    options.callQuota ||
    createCallQuota(OPENAI_CALLS_PER_MINUTE, OPENAI_CALL_WINDOW_MS, null, null, function (delayMs) {
      pushLogEvent(runLog, {
        phase: 'quota',
        outcome: 'waiting',
        counts: { delayMs: delayMs },
      });
    });
  var jobStored = await rememberBatchJob({
    version: 1,
    jobId: options.jobId || batchStamp || runLog.runId,
    status: 'running',
    updatedAt: new Date().toISOString(),
    projectId: projectId || null,
    projectSlug: projectSlug || null,
    batchStamp: batchStamp || runLog.runId,
    downloadImages: !!downloadImages,
    downloadHtml: wantHtmlRun,
    listComplete: listComplete,
    conversations: conversations.map(conversationJobRecord),
  });
  if (!jobStored.ok) {
    if (jobStored.error !== 'no storage') {
      errors.push('saved export could not be stored (' + jobStored.error + ')');
    }
    showStatus(
      'warning',
      'Backup is running, but cannot be resumed after closing this panel (' + jobStored.error + ').'
    );
  }

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
    return new Promise(function (resolve) {
      var startedAt = Date.now();
      function poll() {
        chrome.tabs.get(tabId, function (t) {
          if (chrome.runtime.lastError || !t) return resolve(false);
          var onConversation = !conversationId || String(t.url || '').indexOf('/c/' + conversationId) !== -1;
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
   *  page. The session cookie is already on this tab, so the request does not
   *  navigate. Opening each saved chat to ask the question is what brings up
   *  the Retry screen and stops the run before the unsaved chats.
   *
   *  Any failure returns null. Null is not "unchanged". The caller exports when
   *  no finished file is already on disk, and leaves a finished file closed
   *  until a later run can read the metadata. */
  async function readConversationMetadata(tabId, conv) {
    try {
      await callQuota.take(OPENAI_METADATA_CALLS);
      await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['content.js'] });
      var out = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: async function (conversationId) {
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
    await callQuota.take(OPENAI_PAGE_LOAD_CALLS);
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: function (href) {
        window.location.href = href;
      },
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

    state.scanningTabId = tab.id;
    var ready = await waitForLoadedConversation(tab.id, conv.id, {
      isCancelled: controls.isCancelled,
      isPaused: controls.isPaused,
      onWait: function () {
        if (onProgress) onProgress(index, pending.length, progressTitle + ' — waiting for ChatGPT');
      },
    });
    if (!ready || !ready.ready) {
      return {
        ok: false,
        error: (ready && ready.error) || 'did not load',
        rateLimited: !!(ready && ready.rateLimited),
      };
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });

    startProgressPolling(tab.id);
    var results;
    try {
      if (downloadImages) await callQuota.take(OPENAI_FILE_LOOKUP_CALLS);
      results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async function (wantFiles) {
          return getConversationMarkdown({ downloadFiles: wantFiles });
        },
        args: [!!downloadImages],
      });
    } finally {
      stopProgressPolling();
    }

    var scanned = results?.[0]?.result;
    if (!scanned || !scanned.ok) {
      return {
        ok: false,
        error: (scanned && scanned.error) || 'scan failed',
        stack: scanned && scanned.stack,
      };
    }
    return { ok: true, result: scanned };
  }

  for (var index = 0; index < pending.length; index++) {
    if (controls.isCancelled()) break;
    // Pause is honoured BETWEEN conversations and inside the retry wait below,
    // so a long run can be held without losing the conversations already done.
    // The saved job is written when the pause starts, so closing the panel
    // during the hold still leaves something to resume.
    if (controls.isPaused() && state.activeBatchJob && state.activeBatchJob.status !== 'paused') {
      state.activeBatchJob.status = 'paused';
      state.activeBatchJob.updatedAt = new Date().toISOString();
      await writeBatchJob(state.activeBatchJob);
    } else if (!controls.isPaused() && state.activeBatchJob && state.activeBatchJob.status === 'paused') {
      state.activeBatchJob.status = 'running';
      state.activeBatchJob.updatedAt = new Date().toISOString();
      await writeBatchJob(state.activeBatchJob);
    }
    if (!(await waitWhilePaused(controls))) break;
    var conv = pending[index];
    var progressTitle = conv.title || conv.slug || conv.id;
    if (onProgress) onProgress(index, pending.length, progressTitle);

    // Ask the cheap question first. One metadata request on the already-open
    // tab decides it, and that request does not open the conversation. A
    // filename cannot say whether a conversation gained messages, so a readable
    // answer that has no index row still exports once.
    //
    // Every uncertain answer resolves towards exporting when no finished file
    // is on disk. A wrong skip loses the conversation. A finished file plus an
    // unreadable metadata read is left closed and is not recorded as unchanged:
    // opening it is what brings the Retry screen back, and the next run that
    // can read the metadata still compares.
    var liveMeta = null;
    var grewThisRound = false;
    var verdict = null;
    var filesLanded = requestedFilesLanded(conv);
    if (exportIndex) {
      liveMeta = await readConversationMetadata(tab.id, conv);
      verdict = classifyAgainstIndex(exportIndex, conv.id, liveMeta).verdict;
      if (verdict === 'unchanged' && filesLanded) {
        indexSkipped += 1;
        pushLogEvent(runLog, {
          phase: 'skip',
          outcome: 'unchanged',
          conversationId: conv.id,
          title: conv.title,
        });
        continue;
      }
      if ((!liveMeta || verdict === 'unknown') && filesLanded) {
        leftClosed += 1;
        pushLogEvent(runLog, {
          phase: 'skip',
          outcome: 'file-landed',
          conversationId: conv.id,
          title: conv.title,
        });
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
        outcome = {
          ok: false,
          error: (err && err.message) || String(err),
          stack: err && err.stack,
        };
      }
      if (outcome.ok) break;
      // The wait-and-click budget was already spent. Another hold would open
      // the same limited page again. Stop this conversation and, below, the run.
      if (outcome.rateLimited) break;

      lastError = outcome.error;
      var kind = classifyBatchFailure(lastError);
      if (kind === 'conversation') break; // a real per-conversation problem: do not retry
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
        attempt -= 1; // a hold is not an attempt against this conversation
        await sleep(backoffDelayMs(Math.min(held, 4)));
        if (!(await waitWhilePaused(controls))) break;
        continue;
      }

      // transient: retry with backoff inside this conversation's budget
      if (attempt < maxAttempts) {
        retried += 1;
        if (onProgress)
          onProgress(index, pending.length, progressTitle + ' — retry ' + attempt + '/' + (maxAttempts - 1));
        await sleep(backoffDelayMs(attempt));
        if (!(await waitWhilePaused(controls))) break;
      }
    }

    if (controls.isCancelled()) break;
    if (!outcome || !outcome.ok) {
      if (outcome && outcome.rateLimited) {
        errors.push(
          'ChatGPT rate limit: waited and retried, and the conversation page still asked to retry. Resume later; opening more chats would keep the limit in place.'
        );
        pushLogEvent(runLog, {
          level: 'error',
          phase: 'conversation',
          outcome: 'rate-limit',
          conversationId: conv.id,
          title: conv.title,
          message: outcome.error,
        });
        break;
      }
      errors.push((conv.title || conv.id) + ': ' + (lastError || 'failed'));
      pushLogEvent(runLog, {
        level: 'error',
        phase: 'conversation',
        outcome: 'failed',
        conversationId: conv.id,
        title: conv.title,
        message: lastError || 'failed',
        stack: outcome && outcome.stack,
      });
      var failedLog = await flushRunLog(runLog, state.activeRunLogOptions);
      if (!failedLog.ok) {
        logOk = false;
        logError = failedLog.error;
      }
      continue;
    }
    var result = outcome.result;

    var writeOk = false;
    var writeError = null;
    var saved = null;
    var wantHtml = !!(options.htmlSiteDir || options.downloadHtml);
    // Markdown saving and the HTML site are separate deliverables. Recording
    // the HTML page only after the markdown write returned ok made a refused
    // .md — the path a batch takes when file saving is forced — drop the chat
    // from the site entirely.
    var markdownAlreadyLanded = !markdownPendingKeys[conv.id || conv.slug];
    // The Markdown note is already on disk. Scanning again is for the HTML
    // page, and writing another dated note would pile up copies the user did
    // not ask for. A grown conversation still gets its new note.
    var htmlOnly = wantHtmlRun && markdownAlreadyLanded && verdict === 'unchanged';
    var markdownAttempted = false;
    // A conversation that GREW is stamped whether or not the option is ticked.
    // Chrome cannot append to a file and overwriting would destroy the earlier
    // export, so the new copy must carry a name of its own. This is the whole
    // reason the stamp exists; it is not a user preference in this case.
    // ALWAYS stamped. Every export records the moment it was taken, so a folder of
    // backups is readable at a glance and no file silently replaces another.
    //
    // The export index decides whether the chat changed. Download history only
    // proves whether the old Markdown file is still present.
    var stampThis = true;
    void useTimestamp;
    void grewThisRound;
    if ((downloadImages && !htmlOnly) || !wantHtml) {
      markdownAttempted = true;
      try {
        saved = await saveConversationExport(tab.id, result, {
          downloadImages: !!downloadImages,
          useTimestamp: stampThis,
          batchStamp: batchStamp,
          projectSlug: projectSlug,
          zipEntries: zipEntries,
          conversationId: conv.id,
        });
        writeOk = !!(saved && saved.mdOk);
        writeError = saved && saved.mdError;
      } catch (saveErr) {
        // One attachment must not abort the run before the HTML site is written.
        writeOk = false;
        writeError = (saveErr && saveErr.message) || String(saveErr);
      }
    }

    // HTML is built from the scan's original Markdown plus the bytes that
    // actually arrived. The Markdown file may already have rewritten those
    // URLs to ./names; binding against the original URLs is what puts the
    // bytes in the HTML tree. A missing file keeps this export unbanked.
    // This happens even when the markdown file itself was refused: the page
    // is the deliverable the HTML option asked for.
    var htmlPartial = false;
    var htmlRecorded = false;
    var htmlIndexOk = true;
    if (wantHtml && typeof sessionFromExport === 'function') {
      var retrievedFiles = (conv && conv.retrievedFiles) || null;
      if (downloadImages && saved && saved.savedFiles && saved.savedFiles.length) {
        retrievedFiles = saved.savedFiles;
      }
      var htmlConv = retrievedFiles ? Object.assign({}, conv, { retrievedFiles: retrievedFiles }) : conv;
      var htmlResult = result;
      if (downloadImages && saved && saved.dlErrors && saved.dlErrors.length) {
        htmlResult = Object.assign({}, result, { partial: true });
      }
      var htmlSession = sessionFromExport(htmlConv, htmlResult);
      var chatLaid = typeof layoutChatFiles === 'function' ? layoutChatFiles(htmlSession) : null;
      var chatWriteOk = true;
      var chatWriteError = null;
      if (chatLaid && options.htmlSiteDir && typeof writeStaticSite === 'function') {
        try {
          writeStaticSite(options.htmlSiteDir, { files: chatLaid.files });
        } catch (writeErr) {
          chatWriteOk = false;
          chatWriteError = (writeErr && writeErr.message) || String(writeErr);
        }
      }
      if (chatWriteOk && chatLaid && options.downloadHtml) {
        var chatDownload = await downloadStaticSite({ files: chatLaid.files });
        noteExportDownload(chatDownload.downloadId);
        if (!chatDownload.ok) {
          chatWriteOk = false;
          chatWriteError = chatDownload.error || 'the write did not complete';
        }
      }
      if (!chatLaid) {
        chatWriteOk = false;
        chatWriteError = 'HTML layout is unavailable';
      }
      if (!chatWriteOk) {
        errors.push(
          (conv.title || conv.id) + ': HTML page not saved (' + (chatWriteError || 'the write did not complete') + ')'
        );
        htmlOk = false;
        pushLogEvent(runLog, {
          level: 'error',
          phase: 'html',
          outcome: 'failed',
          conversationId: conv.id,
          title: conv.title,
          message: chatWriteError,
        });
      } else {
        htmlLinks.push(chatLaid.link);
        htmlChatFiles += chatLaid.files.length;
        htmlRecorded = true;
        htmlPartial = !!htmlSession.partial;
        if (typeof layoutIndexFiles === 'function' && typeof mergeChatLinks === 'function') {
          var progressIndexes = layoutIndexFiles(mergeChatLinks(htmlLinks, htmlPagePaths, htmlCompletePaths));
          if (options.htmlSiteDir && typeof writeStaticSite === 'function') {
            writeStaticSite(options.htmlSiteDir, { files: progressIndexes });
          }
          if (options.downloadHtml) {
            var indexDownload = await downloadStaticSite({ files: progressIndexes });
            noteExportDownload(indexDownload.downloadId);
            if (!indexDownload.ok) {
              errors.push('HTML index not saved (' + (indexDownload.error || 'the write did not complete') + ')');
              htmlOk = false;
              htmlIndexOk = false;
            }
          }
        }
      }
    }

    // A refused write is a failure, not an export. Counting it made a run whose
    // every write Chrome rejected report the whole project as saved. An HTML
    // page that did land is still an export: dropping it here is how a markdown
    // refusal used to erase the site.
    if (!htmlRecorded && (!markdownAttempted || !writeOk)) {
      errors.push((conv.title || conv.id) + ': not saved (' + (writeError || 'download rejected') + ')');
      pushLogEvent(runLog, {
        level: 'error',
        phase: 'write',
        outcome: 'failed',
        conversationId: conv.id,
        title: conv.title,
        message: writeError || 'download rejected',
      });
      var rejectedLog = await flushRunLog(runLog, state.activeRunLogOptions);
      if (!rejectedLog.ok) {
        logOk = false;
        logError = rejectedLog.error;
      }
      continue;
    }
    if (markdownAttempted && !writeOk) {
      errors.push((conv.title || conv.id) + ': markdown not saved (' + (writeError || 'download rejected') + ')');
    }

    exported += 1;
    var exportSlug = result.slug || conv.slug || conv.id;
    var attachmentPartial = !!(saved && (saved.dlErrors.length || saved.dlOk < saved.dlTotal));
    var conversationPartial = !!(
      result.partial ||
      htmlPartial ||
      attachmentPartial ||
      (markdownAttempted && !writeOk) ||
      (wantHtml && (!htmlRecorded || !htmlIndexOk))
    );
    if (conversationPartial) {
      // A stall-truncated export must NOT be banked as done. Banking it made the
      // next run skip the conversation as "already exported", so the one action
      // that could repair a truncated file was the one action refused — while the
      // popup reported success. Counted and reported instead. The same rule
      // applies when the HTML site names a file that never arrived. A markdown
      // file that was refused is already named above; it must not be described
      // again as a missing attachment.
      partial += 1;
      if (result.partial || htmlPartial || attachmentPartial) {
        errors.push(
          result.partial
            ? (conv.title || conv.id) + ': saved incompletely (scan did not reach the end) — re-run to finish it'
            : (conv.title || conv.id) + ': saved incompletely (a file was not retrieved) — re-run to finish it'
        );
      }
    } else {
      if (markdownAttempted && writeOk) {
        completedPaths.add(mdDownloadPath(exportSlug, projectSlug, stampThis, batchStamp, conv.id));
      }
      // Record only a COMPLETE export. A partial one is deliberately not banked,
      // for the same reason it is not added to completedPaths: the next run must
      // be free to finish it rather than skip it as done.
      if (liveMeta && ((markdownAttempted && writeOk) || htmlRecorded)) {
        await recordExportedConversation(conv.id, {
          updateTime: liveMeta.updateTime,
          currentNode: liveMeta.currentNode,
          messageCount: liveMeta.messageCount,
          bytes: result.md ? result.md.length : null,
          files: saved ? saved.dlOk : 0,
        });
      }
    }
    pushLogEvent(runLog, {
      level: conversationPartial ? 'warn' : 'info',
      phase: 'conversation',
      outcome: conversationPartial ? 'partial' : 'saved',
      conversationId: conv.id,
      title: conv.title,
      counts: {
        lines: result.lines || 0,
        files: (saved && saved.savedFiles && saved.savedFiles.length) || 0,
      },
    });
    var savedLog = await flushRunLog(runLog, state.activeRunLogOptions);
    if (!savedLog.ok) {
      logOk = false;
      logError = savedLog.error;
    }
  }

  var zipName = null;
  if (zipEntries && zipEntries.dropped > 0) {
    // Stated as an error, not a note: an archive that silently omits files reads
    // as a complete backup. The files themselves are on disk either way.
    errors.push(
      'archive incomplete: ' +
        zipEntries.dropped +
        ' file(s) left out to stay within the memory budget — the saved files on disk are complete'
    );
  }
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
        handle.url,
        candidateName,
        batchRootPath(projectSlug) + '/' + candidateName,
        ZIP_WRITE_TIMEOUT_MS
      );
      if (zipWrite.ok) {
        // Chrome accepted the download; the bytes are still being written. Wait
        // before the `finally` below revokes the blob URL backing them — and
        // believe the ANSWER, not the acceptance: an interrupted write leaves no
        // archive, so reporting its name would be another silent success.
        var written = await waitForDownloadComplete(zipWrite.downloadId, ZIP_WRITE_TIMEOUT_MS);
        if (written) {
          zipName = candidateName;
          noteExportDownload(zipWrite.downloadId);
        } else {
          errors.push('archive not completed — the exported files are still on disk');
        }
      } else {
        errors.push(
          'archive not saved (' + (zipWrite.error || 'download rejected') + ') — the exported files are still on disk'
        );
      }
    } catch (zipErr) {
      errors.push(
        'archive not created (' + ((zipErr && zipErr.message) || zipErr) + ') — the exported files are still on disk'
      );
    } finally {
      if (handle) handle.revoke(handle.url);
    }
  }

  var htmlIndexFiles = 0;
  if (htmlLinks.length && typeof layoutIndexFiles === 'function' && typeof mergeChatLinks === 'function') {
    var finalIndexes = layoutIndexFiles(mergeChatLinks(htmlLinks, htmlPagePaths, htmlCompletePaths));
    htmlIndexFiles = finalIndexes.length;
    if (options.htmlSiteDir && typeof writeStaticSite === 'function') {
      writeStaticSite(options.htmlSiteDir, { files: finalIndexes });
    }
    if (options.downloadHtml) {
      var htmlWrite = await downloadStaticSite({ files: finalIndexes });
      noteExportDownload(htmlWrite.downloadId);
      if (!htmlWrite.ok) {
        errors.push('HTML index not saved (' + (htmlWrite.error || 'the write did not complete') + ')');
        htmlOk = false;
      }
    }
  }

  if (!logOk) errors.push('execution log not saved (' + (logError || 'the write did not complete') + ')');
  pushLogEvent(runLog, {
    phase: 'run',
    outcome: controls.isCancelled() ? 'cancelled' : 'finished',
    counts: { exported: exported, unchanged: indexSkipped, partial: partial, leftClosed: leftClosed },
  });
  var finishedLog = await flushRunLog(runLog, state.activeRunLogOptions);
  if (!finishedLog.ok && logOk) {
    errors.push('execution log not saved (' + (finishedLog.error || 'the write did not complete') + ')');
    logOk = false;
  }
  state.activeRunLog = null;
  if (state.activeBatchJob) {
    state.activeBatchJob.status =
      controls.isCancelled() ||
      controls.isPaused() ||
      partial > 0 ||
      // leftClosed is a finished file we could not check. It is not proof the
      // chat is unchanged, so the job stays resumable.
      exported + indexSkipped < conversations.length ||
      !htmlOk ||
      !listComplete
        ? 'paused'
        : 'done';
    state.activeBatchJob.updatedAt = new Date().toISOString();
    var finalJob = await writeBatchJob(state.activeBatchJob);
    if (!finalJob.ok && finalJob.error !== 'no storage') {
      errors.push('saved export could not be stored (' + finalJob.error + ')');
    }
  }

  return {
    ok: true,
    total: conversations.length,
    exported: exported,
    // Metadata proved the conversation had not changed since it was exported.
    unchanged: indexSkipped,
    // Finished files left closed because metadata could not be read. Not
    // counted as unchanged, and not given an index row.
    leftClosed: leftClosed,
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
    discovered: discovered,
    errors: errors,
    zipName: zipName,
    htmlFiles: htmlChatFiles + htmlIndexFiles,
    htmlOk: htmlOk,
    logOk: logOk,
    logPath: 'chatgpt-export/logs/' + runLog.runId + '.json',
  };
}

export { runBatchExport, waitForLoadedConversation };
