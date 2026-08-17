const btn = document.getElementById('btn-copy');
const btnCancel = document.getElementById('btn-cancel');
const status = document.getElementById('status');
const chkImages = document.getElementById('chk-images');
const chkTimestamp = document.getElementById('chk-timestamp');
const chkBatch = document.getElementById('chk-batch');
const batchWarning = document.getElementById('batch-warning');

// Id of the tab currently being scanned, so Stop knows where to send the flag.
var scanningTabId = null;
var progressTimer = null;
var batchCancelled = false;

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

/** Derive a filename from an artifact URL or label text. */
function artifactFilename(url, label, index, slug, kind) {
  var ext = kind === 'image' ? 'png' : 'bin';
  var labelMatch = label && label.match(/\.([A-Za-z0-9]{1,8})(?:\?|$)/);
  if (labelMatch) {
    ext = labelMatch[1].toLowerCase();
  } else {
    try {
      var pathMatch = new URL(url).pathname.match(/\.([A-Za-z0-9]{1,8})(?:\?|$)/i);
      if (pathMatch) ext = pathMatch[1].toLowerCase();
    } catch (_e) {}
  }
  if (kind === 'image') {
    ext = ext.replace(/^jpe?g$/i, 'jpg');
    if (!/^(png|jpg|gif|webp|svg|bmp)$/i.test(ext)) ext = 'png';
  }
  var prefix = slug ? slug + '-' : '';
  var stem = kind === 'image' ? 'image' : 'file';
  return prefix + stem + '_' + String(index + 1).padStart(3, '0') + '.' + ext;
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

/** Full download path for a conversation's markdown file. */
function mdDownloadPath(convSlug, projectSlug, useTimestamp, stamp) {
  var mdName = buildMdFilename(convSlug, useTimestamp, null, stamp);
  return conversationFolderPath(convSlug, projectSlug) + '/' + mdName;
}

/** Skip conversations whose markdown already landed in a prior partial run. */
function filterPendingConversations(conversations, completedPaths, projectSlug, useTimestamp, stamp) {
  return conversations.filter(function(conv) {
    var slug = conv.slug || conv.id;
    return !completedPaths.has(mdDownloadPath(slug, projectSlug, useTimestamp, stamp));
  });
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
  var mdName = buildMdFilename(slug, useTimestamp, null, batchStamp);
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

  await downloadOne(
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

  var pending = filterPendingConversations(conversations, completedPaths, projectSlug, useTimestamp, batchStamp);
  var skipped = conversations.length - pending.length;
  var exported = 0;
  var errors = [];

  for (var index = 0; index < pending.length; index++) {
    if (batchCancelled) break;
    var conv = pending[index];
    var progressTitle = conv.title || conv.slug || conv.id;
    if (onProgress) onProgress(index, pending.length, progressTitle);

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
      errors.push((conv.title || conv.id) + ': ' + ((ready && ready.error) || 'did not load'));
      continue;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });

    scanningTabId = tab.id;
    startProgressPolling(tab.id);

    var results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async function() { return getConversationMarkdown(); },
    });
    stopProgressPolling();

    var result = results?.[0]?.result;
    if (!result || !result.ok) {
      errors.push((conv.title || conv.id) + ': ' + ((result && result.error) || 'scan failed'));
      continue;
    }

    if (downloadImages) {
      await saveConversationExport(tab.id, result, {
        downloadImages: true,
        useTimestamp: useTimestamp,
        batchStamp: batchStamp,
        projectSlug: projectSlug,
        zipEntries: zipEntries,
      });
    } else {
      var slug = result.slug || conv.slug || conv.id;
      var mdName = buildMdFilename(slug, useTimestamp, null, batchStamp);
      var folder = conversationFolderPath(slug, projectSlug);
      await downloadOne(
        'data:text/markdown;charset=utf-8,' + encodeURIComponent(result.md),
        mdName,
        folder + '/' + mdName
      );
      if (zipEntries) addZipEntry(zipEntries, projectSlug, slug, mdName, result.md);
    }

    exported += 1;
    var exportSlug = result.slug || conv.slug || conv.id;
    completedPaths.add(mdDownloadPath(exportSlug, projectSlug, useTimestamp, batchStamp));
  }

  var zipName = null;
  if (zipEntries && zipEntries.length > 0 && typeof buildStoreZip === 'function') {
    var stamp = batchStamp || formatExportTimestamp();
    zipName = (projectSlug || 'project') + '-export--' + stamp + '.zip';
    var zipBytes = buildStoreZip(zipEntries);
    await downloadOne(bytesToBase64DataUrl(zipBytes, 'application/zip'), zipName, batchRootPath(projectSlug) + '/' + zipName);
  }

  return {
    ok: true,
    total: conversations.length,
    exported: exported,
    skipped: skipped,
    cancelled: batchCancelled,
    errors: errors,
    zipName: zipName,
  };
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
    batchRootPath: batchRootPath,
    buildMdFilename: buildMdFilename,
    conversationFolderPath: conversationFolderPath,
    downloadOne: downloadOne,
    filterPendingConversations: filterPendingConversations,
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
