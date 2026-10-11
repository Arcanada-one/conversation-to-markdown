/** Download one laid-out static site through chrome.downloads.
 *
 *  Acceptance is not completion. The blob URL stays alive until Chrome reports
 *  the write finished or failed, then it is revoked. A refused or unfinished
 *  write makes the whole call unsuccessful so the popup cannot call it saved.
 */
async function downloadStaticSite(laid) {
  var files = (laid && laid.files) || [];
  var failed = [];
  var lastId = null;
  var canObserveCompletion = typeof chrome !== 'undefined' &&
    chrome.downloads && chrome.downloads.onChanged;
  for (var i = 0; i < files.length; i++) {
    var entry = files[i];
    var bytes = typeof entry.body === 'string' ? textToUtf8Bytes(entry.body) : entry.body;
    var handle = bytesToDownloadUrl(bytes, entry.mime || 'application/octet-stream');
    var leaf = String(entry.path).split('/').pop();
    try {
      var write = await downloadOne(handle.url, leaf, 'chatgpt-export/html/' + entry.path, MD_WRITE_TIMEOUT_MS);
      if (write.ok) lastId = write.downloadId;
      if (write.ok && canObserveCompletion) {
        var written = await waitForDownloadComplete(write.downloadId, MD_WRITE_TIMEOUT_MS);
        if (!written) {
          write.ok = false;
          write.error = write.error || 'the write did not complete';
        }
      }
      if (!write.ok) failed.push((entry.path || leaf) + ': ' + (write.error || 'download rejected'));
    } finally {
      handle.revoke(handle.url);
    }
  }
  return {
    ok: failed.length === 0,
    error: failed.length ? failed.join('; ') : null,
    written: files.length - failed.length,
    failed: failed.length,
    downloadId: lastId,
  };
}

/** Conversation id from a chat URL path. Titles collide; this id does not. */
function conversationIdFromLocation(url) {
  var match = String(url || '').match(/\/c\/([A-Za-z0-9-]+)/);
  return match ? match[1] : null;
}

function projectIdFromLocation(url) {
  var match = String(url || '').match(/\/g\/(g-p-[A-Za-z0-9]+)(?=[/?#]|$)/);
  return match ? match[1] : null;
}

/** Hold the run without losing it. A long export over a network the extension
 *  does not control needs a hold that is not a cancel: cancelling keeps what
 *  landed but ends the run, while pausing resumes exactly where it stopped. */
if (btnPause) {
  btnPause.addEventListener('click', () => {
    if (!batchRunActive) {
      if (!btn.disabled && batchJobStored && activeBatchJob && activeBatchJob.status !== 'done') resumeSavedBatch();
      return;
    }
    if (!batchJobStored) return;
    batchPaused = !batchPaused;
    btnPause.textContent = batchPaused ? 'Resume' : 'Pause';
    if (batchPaused) {
      if (activeBatchJob) {
        activeBatchJob.status = 'paused';
        activeBatchJob.updatedAt = new Date().toISOString();
        writeBatchJob(activeBatchJob);
      }
      showStatus('warning', 'Paused. You can close this panel and resume later. Conversations already saved stay saved.');
    } else if (activeBatchJob) {
      activeBatchJob.status = 'running';
      activeBatchJob.updatedAt = new Date().toISOString();
      writeBatchJob(activeBatchJob);
    }
  });
}

async function executeBatch(tab, batchOptions) {
  batchRunActive = true;
  batchJobStored = false;
  activeBatchJob = null;
  lastExportDownloadId = null;
  scanningTabId = tab.id;
  if (btnPause) {
    batchPaused = false;
    btnPause.textContent = 'Pause';
    btnPause.classList.remove('visible');
  }
  try {
    var batchResult = await runBatchExport(tab, batchOptions);
    if (!batchResult.ok) {
      showStatus('error', batchResult.error || 'Batch export failed.');
      return batchResult;
    }

    var incomplete = batchResult.partial > 0 || batchResult.exported + batchResult.unchanged < batchResult.total;
    var summary = batchResult.htmlOk === false
      ? 'HTML site not saved'
      : batchResult.listComplete && !incomplete && !batchResult.cancelled && !batchResult.errors.length
        ? '✓ Batch export complete: ' + batchResult.exported + ' saved'
        : '⚠ Backup needs attention: ' + batchResult.exported + ' saved';
    if (batchResult.unchanged > 0) {
      summary += ', ' + batchResult.unchanged + ' unchanged';
    }
    if (batchResult.discovered > 0) {
      summary += ', ' + batchResult.discovered
        + (batchResult.discovered === 1 ? ' new chat on the sidebar' : ' new chats on the sidebar');
    }
    if (batchResult.grown > 0) {
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
    if (batchOptions.downloadHtml) {
      summary += '\n' + exportSavedLines({ runId: batchOptions.batchStamp }, true);
    } else if (batchResult.logPath) {
      summary += '\nLog: ' + batchResult.logPath;
    }
    if (batchResult.errors.length) summary += '\nErrors: ' + batchResult.errors.join('; ');
    markExportFolderVisible();
    showStatus(
      batchResult.htmlOk === false ? 'error' :
        (batchResult.listComplete && !incomplete && !batchResult.cancelled && !batchResult.errors.length
          ? 'success' : 'warning'),
      summary
    );
    return batchResult;
  } finally {
    batchRunActive = false;
    if (btnPause) {
      if (batchJobStored && activeBatchJob && activeBatchJob.status !== 'done') {
        btnPause.textContent = 'Resume saved export';
        btnPause.classList.add('visible');
      } else {
        btnPause.classList.remove('visible');
      }
    }
  }
}

async function resumeSavedBatch() {
  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  var tab = tabs && tabs[0];
  if (!tab || !tab.url || !tab.url.match(/https:\/\/(chatgpt\.com|chat\.openai\.com)\//)) {
    showStatus('error', 'Open a ChatGPT page first, then resume.');
    return;
  }
  var job = await readBatchJob(projectIdFromLocation(tab.url));
  if (!job || !job.conversations || !job.conversations.length || job.status === 'done') {
    showStatus('error', 'No saved export for this page. Open the Project or account page where it started.');
    return;
  }
  btn.disabled = true;
  batchCancelled = false;
  btnCancel.classList.add('visible');
  btnCancel.disabled = false;
  btnCancel.textContent = 'Stop export';
  try {
    return await executeBatch(tab, {
      downloadImages: !!job.downloadImages,
      projectId: job.projectId,
      projectSlug: job.projectSlug,
      jobId: job.jobId || job.batchStamp,
      // A new stamp for this sitting. The Markdown name is slug--stamp~id, and
      // Chrome overwrites that path. Reusing the paused run's stamp would
      // replace a chat that grew during a pause of hours or days.
      batchStamp: formatExportTimestamp(),
      buildZip: true,
      downloadHtml: !!job.downloadHtml,
      conversations: job.conversations,
      discover: true,
      onProgress: function(index, total, title) {
        btn.textContent = 'Exporting ' + formatBatchProgress(index, total, title);
      },
    });
  } catch (err) {
    reportFailure('resume export', err);
  } finally {
    btn.disabled = false;
    refreshExportButtonLabel();
    scanningTabId = null;
    btnCancel.classList.remove('visible');
  }
}

function showSavedBatch() {
  chrome.tabs.query({ active: true, currentWindow: true }).then(function(tabs) {
    var tab = tabs && tabs[0];
    return readBatchJob(tab && tab.url ? projectIdFromLocation(tab.url) : undefined);
  }).then(function(job) {
    if (!job || job.status === 'done' || batchRunActive || activeBatchJob) return;
    activeBatchJob = job;
    batchJobStored = true;
    if (!btnPause) return;
    btnPause.classList.add('visible');
    btnPause.textContent = 'Resume saved export';
    showStatus('warning', 'A saved backup is waiting (' + job.conversations.length + ' conversations). Resume checks the open sidebar for chats added since, then saves new and updated ones.');
  }).catch(function() {});
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
  lastExportDownloadId = null;
  btn.disabled = true;
  batchCancelled = false;
  const batchMode = chkBatch && chkBatch.checked;
  btn.textContent = batchMode ? 'Preparing backup…' : 'Scanning conversation…';
  btnCancel.classList.add('visible');
  btnCancel.disabled = false;
  if (btnPause) {
    batchPaused = false;
    btnPause.textContent = 'Pause';
    btnPause.classList.remove('visible');
  }
  btnCancel.textContent = batchMode ? 'Stop export' : 'Stop scanning';
  status.className = '';
  status.textContent = '';
  syncBatchOptions();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url?.match(/https:\/\/(chatgpt\.com|chat\.openai\.com)\//)) {
      showStatus('error', 'Open a ChatGPT conversation page first.');
      return;
    }

    // Every export is stamped. The stamp is part of what a backup file IS — the
    // moment it was taken — not an option, so there is nothing here to read.
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
      var activeProjectId = projectIdFromLocation(tab.url);
      var projectSlug = activeProjectId ? (projectInfo?.[0]?.result?.slug || 'project-batch') : null;
      // One stamp for the whole run, so every file from a single batch carries the
      // same moment rather than drifting minute by minute as the run progresses.
      var batchStamp = formatExportTimestamp();
      await executeBatch(tab, {
        downloadImages: downloadImages,
        projectId: activeProjectId,
        projectSlug: projectSlug,
        batchStamp: batchStamp,
        buildZip: true,
        downloadHtml: !!(chkHtml && chkHtml.checked),
        onProgress: function(index, total, title) {
          btn.textContent = 'Exporting ' + formatBatchProgress(index, total, title);
        },
      });
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
    const partialSuffix = result.partial ? ' (partial export)' : '';
    var runStamp = formatExportTimestamp();
    var singleLog = createRunLog('single', {
      runId: runStamp,
      downloadImages: downloadImages,
      downloadHtml: !!(chkHtml && chkHtml.checked),
    });
    activeRunLog = singleLog;
    activeRunLogOptions = { downloadLog: !!(downloadImages || (chkHtml && chkHtml.checked)) };
    pushLogEvent(singleLog, {
      phase: 'scan',
      outcome: result.partial ? 'partial' : 'ok',
      conversationId: conversationIdFromLocation(tab.url),
      title: result.title,
      counts: { lines: result.lines || 0 },
    });

    if (downloadImages && typeof chrome.downloads !== 'undefined') {
      var saved = await saveConversationExport(tab.id, result, {
        downloadImages: true,
        useTimestamp: true,
        batchStamp: runStamp,
        projectSlug: null,
        zipEntries: null,
      });
      // NOT named `status`: that is the module-level status ELEMENT, and a `var`
      // of the same name hoists to the top of this handler and shadows it for the
      // whole function — including `status.className = ''` at its very first line,
      // which then throws on undefined before the run even starts.
      var saveStatus = buildSaveStatus({
        saved: saved,
        refs: parseArtifactRefs(md),
        lines: result.lines,
        words: result.words,
        partialSuffix: partialSuffix,
      });
      if (chkHtml && chkHtml.checked && typeof sessionFromExport === 'function' && typeof layoutStaticSite === 'function') {
        var projectMatch = String(tab.url || '').match(/\/g\/(g-p-[A-Za-z0-9]+)\//);
        var htmlSession = sessionFromExport({
          id: conversationIdFromLocation(tab.url),
          title: result.title,
          slug: result.slug,
          projectId: projectMatch ? projectMatch[1] : null,
          retrievedFiles: saved.savedFiles || [],
        }, {
          // Original URLs, not the rewritten Markdown: bindRetrievedFiles
          // matches the remote address to the bytes just saved.
          md: md,
          title: result.title,
          slug: result.slug,
          partial: result.partial || (saved.dlErrors && saved.dlErrors.length > 0),
        });
        var htmlWithFiles = await publishHtmlSessions([htmlSession]);
        if (!htmlWithFiles.ok) {
          saveStatus.type = 'error';
          saveStatus.text += '\nHTML site not saved: ' +
            (htmlWithFiles.error || 'the write did not complete');
        }
      }
      saveStatus.text += '\n' + exportSavedLines(singleLog, !!(chkHtml && chkHtml.checked));
      showStatus(saveStatus.type, saveStatus.text);
      markExportFolderVisible();
      await flushRunLog(singleLog, activeRunLogOptions);

      // NOT copied to the clipboard. With the save option on, the file is the
      // deliverable and the clipboard is a second copy nobody asked for — and it
      // used to be the run's most dangerous step: `writeText` rejects with
      // "Document is not focused" the moment the popup loses focus, which a
      // multi-minute scan invites, and the rejection landed in the catch below
      // and REPLACED an already-displayed success with a red error. The file was
      // on disk the whole time.
      btn.disabled = false;
      return;
    }

    if (chkHtml && chkHtml.checked && typeof sessionFromExport === 'function' && typeof layoutStaticSite === 'function') {
      var htmlOnly = sessionFromExport({
        id: conversationIdFromLocation(tab.url),
        title: result.title,
        slug: result.slug,
      }, { md: md, title: result.title, slug: result.slug, partial: result.partial });
      var htmlWrite = await publishHtmlSessions([htmlOnly]);
      if (!htmlWrite.ok) {
        showStatus('error', 'HTML site not saved: ' + (htmlWrite.error || 'the write did not complete'));
        btn.disabled = false;
        return;
      }
      var htmlPartialSuffix = (result.partial || htmlOnly.partial) ? ' (partial export)' : '';
      showStatus(htmlPartialSuffix ? 'warning' : 'success',
        (htmlPartialSuffix ? '⚠ Saved incomplete HTML site' : '✓ Saved HTML site') +
        ' ' + result.lines + ' lines · ' + result.words + ' words\n' +
        exportSavedLines(singleLog, true) + (htmlPartialSuffix ? '\nRe-run to complete it.' : ''));
      markExportFolderVisible();
      await flushRunLog(singleLog, activeRunLogOptions);
      btn.disabled = false;
      return;
    }

    // No save option: the clipboard IS the delivery, so its failure is the run's
    // failure and belongs in the catch.
    await navigator.clipboard.writeText(md);

    showStatus(
      'success',
      '✓ Copied!' + partialSuffix + ' ' + result.lines + ' lines · ' + result.words + ' words'
    );
  } catch (err) {
    pushLogEvent(activeRunLog, {
      level: 'error',
      phase: 'single export',
      outcome: 'exception',
      message: (err && err.message) || String(err),
      stack: err && err.stack,
    });
    if (activeRunLog) await flushRunLog(activeRunLog, activeRunLogOptions);
    reportFailure('single export', err);
  } finally {
    activeRunLog = null;
    stopProgressPolling();
    scanningTabId = null;
    btnCancel.classList.remove('visible');
    if (batchWarning) batchWarning.classList.remove('visible');
    btn.disabled = false;
    if (btnPause && (!activeBatchJob || activeBatchJob.status === 'done')) {
      btnPause.classList.remove('visible');
    }
    refreshExportButtonLabel();
  }
});

showSavedBatch();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    addZipEntry: addZipEntry,
    ZIP_BYTE_BUDGET: ZIP_BYTE_BUDGET,
    artifactFilename: artifactFilename,
    sanitizeFilenamePart: sanitizeFilenamePart,
    splitFilenameExtension: splitFilenameExtension,
    batchRootPath: batchRootPath,
    buildMdFilename: buildMdFilename,
    batchMdFilename: batchMdFilename,
    bytesToDownloadUrl: bytesToDownloadUrl,
    bytesToBase64DataUrl: bytesToBase64DataUrl,
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
    downloadStaticSite: downloadStaticSite,
    saveConversationExport: saveConversationExport,
    buildSaveStatus: buildSaveStatus,
    syncBatchOptions: syncBatchOptions,
    reportFailure: reportFailure,
    LAST_ERROR_KEY: LAST_ERROR_KEY,
    MD_WRITE_TIMEOUT_MS: MD_WRITE_TIMEOUT_MS,
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
    sanitizeLogText: sanitizeLogText,
    noteExportDownload: noteExportDownload,
    revealExportFolder: revealExportFolder,
    mergeBackupConversations: mergeBackupConversations,
    rememberBatchJob: rememberBatchJob,
    resumeSavedBatch: resumeSavedBatch,
    createCallQuota: createCallQuota,
    OPENAI_CALLS_PER_MINUTE: OPENAI_CALLS_PER_MINUTE,
    OPENAI_CALL_WINDOW_MS: OPENAI_CALL_WINDOW_MS,
    OPENAI_PAGE_LOAD_CALLS: OPENAI_PAGE_LOAD_CALLS,
    OPENAI_METADATA_CALLS: OPENAI_METADATA_CALLS,
    OPENAI_FILE_LOOKUP_CALLS: OPENAI_FILE_LOOKUP_CALLS,
    conversationJobRecord: conversationJobRecord,
    readBatchJob: readBatchJob,
    writeBatchJob: writeBatchJob,
    BATCH_JOB_KEY: BATCH_JOB_KEY,
    searchCompletedDownloadPaths: searchCompletedDownloadPaths,
    readExportIndex: readExportIndex,
    recordExportedConversation: recordExportedConversation,
    classifyAgainstIndex: classifyAgainstIndex,
    INDEX_KEY: INDEX_KEY,
    INDEX_BYTE_BUDGET: INDEX_BYTE_BUDGET,
  };
}
