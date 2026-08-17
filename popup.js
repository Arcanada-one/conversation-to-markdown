const btn = document.getElementById('btn-copy');
const btnCancel = document.getElementById('btn-cancel');
const status = document.getElementById('status');
const chkImages = document.getElementById('chk-images');
const chkTimestamp = document.getElementById('chk-timestamp');

// Id of the tab currently being scanned, so Stop knows where to send the flag.
var scanningTabId = null;
var progressTimer = null;

function showStatus(type, message) {
  status.className = type;
  status.textContent = message;
}

/** Parse ![](url) references from Markdown, return {url, alt} pairs. */
function parseImageRefs(md) {
  const seen = new Set();
  const refs = [];
  const re = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
  let m;
  while ((m = re.exec(md)) !== null) {
    if (!seen.has(m[2])) {
      seen.add(m[2]);
      refs.push({ url: m[2], alt: m[1] });
    }
  }
  return refs;
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
  // Try to infer extension from the alt text first (e.g. "photo.jpg")
  var ext = 'png';
  var altMatch = alt && alt.match(/\.(png|jpe?g|gif|webp|svg|bmp)(\?|$)/i);
  if (altMatch) {
    ext = altMatch[1].toLowerCase().replace('jpeg', 'jpg');
  } else {
    try {
      var pathMatch = new URL(url).pathname.match(/\.(png|jpe?g|gif|webp|svg|bmp)(\?|$)/i);
      if (pathMatch) ext = pathMatch[1].toLowerCase().replace('jpeg', 'jpg');
    } catch (_e) {}
  }
  var prefix = slug ? slug + '-' : '';
  return prefix + 'image_' + String(index + 1).padStart(3, '0') + '.' + ext;
}

/** Format a date as YYYYMMDD-HHMM for timestamped re-exports. */
function formatExportTimestamp(date) {
  var d = date || new Date();
  var pad = function(n) { return String(n).padStart(2, '0'); };
  return String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate()) +
    '-' + pad(d.getHours()) + pad(d.getMinutes());
}

/** Build the .md filename; timestamp suffix implements re-export without uniquify suffixes. */
function buildMdFilename(slug, useTimestamp, now) {
  var base = slug || 'conversation';
  return useTimestamp ? base + '--' + formatExportTimestamp(now) + '.md' : base + '.md';
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

btnCancel.addEventListener('click', async () => {
  if (scanningTabId === null) return;
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
  btn.textContent = 'Scanning conversation…';
  btnCancel.classList.add('visible');
  btnCancel.disabled = false;
  btnCancel.textContent = 'Stop scanning';
  status.className = '';
  status.textContent = '';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url?.match(/https:\/\/(chatgpt\.com|chat\.openai\.com)\//)) {
      showStatus('error', 'Open a ChatGPT conversation page first.');
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
    const downloadImages = chkImages && chkImages.checked;
    const useTimestamp = chkTimestamp && chkTimestamp.checked;
    // Conversation title drives both the .md filename and its export folder.
    const slug = result.slug || null;
    const mdName = buildMdFilename(slug, useTimestamp);
    const partialSuffix = result.partial ? ' (partial export)' : '';

    if (downloadImages && typeof chrome.downloads !== 'undefined') {
      // Fetch images via content script (has host_permissions for CDN CORS bypass).
      // Falls back to canvas extraction if old content.js is still cached.
      var refs = parseImageRefs(md);
      var extracted = [];
      if (refs.length > 0) {
        btn.textContent = 'Downloading ' + refs.length + ' images…';
        var urls = refs.map(function(r) { return r.url; });
        var extractResult = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: async function(urls) {
            if (typeof fetchImageDataUrls === 'function') return await fetchImageDataUrls(urls);
            // Fallback for old content.js cache — canvas extraction (usually fails on CORS)
            if (typeof extractImageDataUrls === 'function') return await extractImageDataUrls(urls);
            return urls.map(function() { return null; });
          },
          args: [urls],
        });
        extracted = extractResult?.[0]?.result || [];
      }

      // Download extracted data URLs + save .md file
      btn.textContent = 'Saving files…';
      var mdChanged = md;
      var dlOk = 0;
      var dlErrors = [];
      for (var i = 0; i < extracted.length; i++) {
        var ex = extracted[i];
        if (ex && ex.dataUrl) {
          var fname = imageFilename(ex.url, refs[i] ? refs[i].alt : '', i, slug);
          var r = await downloadOne(ex.dataUrl, fname, exportPath(slug, fname));
          if (r.ok) {
            dlOk++;
            mdChanged = mdChanged.split(ex.url).join('./' + r.filename);
          } else {
            dlErrors.push(r.error || 'unknown');
          }
        }
      }

      // Save .md with local paths for successfully extracted images
      var mdFinal = dlOk > 0 ? mdChanged : md;
      await downloadOne(
        'data:text/markdown;charset=utf-8,' + encodeURIComponent(mdFinal),
        mdName,
        exportPath(slug, mdName)
      );

      if (dlOk > 0) {
        showStatus('success',
          '✓ Copied!' + partialSuffix + ' ' + result.lines + ' lines · ' + result.words + ' words\n' +
          'Images: ' + dlOk + '/' + refs.length + ' downloaded + ' + mdName
        );
      } else if (refs.length > 0) {
        var hint = dlErrors.length > 0 ? ' (' + dlErrors[0] + ')' : '';
        showStatus('success',
          '✓ Copied!' + partialSuffix + ' ' + result.lines + ' lines · ' + result.words + ' words\n' +
          'Images: 0/' + refs.length + ' fetched' + hint + ' — original URLs kept in .md'
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
    btn.disabled = false;
    btn.textContent = 'Copy as Markdown';
  }
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildMdFilename: buildMdFilename,
    formatExportTimestamp: formatExportTimestamp,
    exportPath: exportPath,
    downloadOne: downloadOne,
  };
}
