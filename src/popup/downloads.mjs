import { noteExportDownload } from './logging.mjs';
import { btn } from './options.mjs';
import {
  artifactFilename,
  batchMdFilename,
  buildMdFilename,
  conversationFolderPath,
  exportPath,
  formatExportTimestamp,
  parseArtifactRefs,
} from './paths.mjs';
import { state } from './state.mjs';

function searchCompletedDownloadPaths(projectSlug) {
  return new Promise(function (resolve) {
    if (typeof chrome === 'undefined' || !chrome.downloads || !chrome.downloads.search) {
      resolve(new Set());
      return;
    }
    var escaped = (projectSlug || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var pattern = projectSlug ? 'chatgpt-export/' + escaped + '/.+/.*\\.md$' : 'chatgpt-export/.+/.*\\.md$';
    chrome.downloads.search({ filenameRegex: pattern }, function (items) {
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

/** Base64 fallback for when Blob/createObjectURL are unavailable.
 *
 *  Delegates to zip.js rather than carrying a second implementation. The first
 *  version of this function appended one character at a time, which is the same
 *  defect measured at 40.9x the payload in memory (1510.8MB for a 40MB export)
 *  and fixed in `bytesToDataUrl`. Fixing one and not the other left the worst
 *  case — this path encodes the ZIP, the largest payload in the product —
 *  unfixed, so the two now share one implementation and cannot drift apart. */
function bytesToBase64DataUrl(bytes, mimeType) {
  var type = mimeType || 'application/octet-stream';
  if (typeof bytesToDataUrl === 'function') return bytesToDataUrl(bytes, type);
  // zip.js absent (it is loaded by popup.html before this file, so this is only
  // reachable in a stripped build). Chunked here too: a fallback that reproduces
  // the defect is not a fallback worth having.
  var encoded = '';
  for (var start = 0; start < bytes.length; start += 3072) {
    var end = Math.min(start + 3072, bytes.length);
    var binary = '';
    for (var i = start; i < end; i++) binary += String.fromCharCode(bytes[i]);
    encoded += btoa(binary);
  }
  return 'data:' + type + ';base64,' + encoded;
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
      revoke: function (url) {
        try {
          URL.revokeObjectURL(url);
        } catch (_e) {}
      },
    };
  }
  return { url: bytesToBase64DataUrl(bytes, mimeType), revoke: function () {} };
}

function textToUtf8Bytes(text) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
  var out = new Uint8Array(text.length);
  for (var i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** How many bytes of archive content may be held in memory at once.
 *
 *  The zip is assembled in the page's memory from entries kept for the WHOLE
 *  run, so its cost grows with the export and is bounded by nothing on a
 *  full-account run. Measured: the archive step alone allocated 125.7MB of RSS
 *  for a 40MB payload. A renderer killed for memory takes the popup's document
 *  with it, which means no `catch` runs and no status is written — the run stops
 *  having reported nothing at all.
 *
 *  64MB is chosen to sit well below that failure while still archiving an
 *  ordinary project in one file. The files are on disk regardless; the archive
 *  is a convenience, so refusing to grow it is always better than losing the run.
 */
var ZIP_BYTE_BUDGET = 64 * 1024 * 1024;

/** Add one file to the pending archive. Returns false when the budget refuses it.
 *
 *  A refusal is COUNTED on the list (`dropped`), because an archive missing files
 *  it does not mention is worse than no archive: it looks complete. */
function addZipEntry(zipEntries, projectSlug, convSlug, filename, content) {
  var prefix = conversationFolderPath(convSlug, projectSlug) + '/';
  var data = typeof content === 'string' ? textToUtf8Bytes(content) : content;
  var budget = typeof zipEntries.budget === 'number' ? zipEntries.budget : ZIP_BYTE_BUDGET;
  var used = typeof zipEntries.bytes === 'number' ? zipEntries.bytes : 0;
  var incoming = (data && data.length) || 0;
  if (used + incoming > budget) {
    zipEntries.dropped = (zipEntries.dropped || 0) + 1;
    return false;
  }
  zipEntries.bytes = used + incoming;
  zipEntries.push({ name: prefix + filename, data: data });
  return true;
}

/** How long a project archive may take to be accepted AND written. A batch zip is
 *  orders of magnitude larger than a single conversation, so it does not share the
 *  per-file budget: `downloadOne`'s default would give up while Chrome was still
 *  reading the blob, and the caller would then revoke the URL mid-write. */
var ZIP_WRITE_TIMEOUT_MS = 120000;

/** The same budget for a single conversation's markdown, and for the same reason.
 *  A long export is megabytes of text; `downloadOne`'s 12s default is sized for a
 *  per-file attachment, and giving up early would revoke the blob URL while Chrome
 *  was still reading it — writing a truncated .md that looks complete. */
var MD_WRITE_TIMEOUT_MS = 120000;

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
  return new Promise(function (resolve) {
    if (
      downloadId === undefined ||
      downloadId === null ||
      typeof chrome === 'undefined' ||
      !chrome.downloads ||
      !chrome.downloads.onChanged
    ) {
      resolve(false);
      return;
    }
    var settled = false;
    var finish = function (done) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        chrome.downloads.onChanged.removeListener(listener);
      } catch (_e) {}
      resolve(done);
    };
    var listener = function (delta) {
      if (!delta || delta.id !== downloadId || !delta.state) return;
      if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
        finish(delta.state.current === 'complete');
      }
    };
    var timer = setTimeout(function () {
      finish(false);
    }, timeoutMs || 120000);
    chrome.downloads.onChanged.addListener(listener);
    // A small file can finish between the download callback and this listener.
    if (typeof chrome.downloads.search === 'function') {
      try {
        chrome.downloads.search({ id: downloadId }, function (items) {
          if (chrome.runtime && chrome.runtime.lastError) return;
          var item = items && items[0];
          if (!item || item.id !== downloadId) return;
          if (item.state === 'interrupted') finish(false);
          else if (item.state === 'complete' && item.exists === true) finish(true);
        });
      } catch (_e) {
        /* the event listener still observes later completion */
      }
    }
  });
}

/** Download one file via chrome.downloads. Returns {url, filename, ok, error}. */
function downloadOne(url, filename, targetPath, timeoutMs, conflictAction) {
  return new Promise(function (resolve) {
    var settled = false;
    var timer = setTimeout(function () {
      if (!settled) {
        settled = true;
        resolve({ url: url, filename: filename, ok: false, error: 'timeout' });
      }
    }, timeoutMs || 12000);
    chrome.downloads.download(
      {
        url: url,
        filename: targetPath || 'chatgpt-export/' + filename,
        saveAs: false,
        conflictAction: conflictAction || 'overwrite',
      },
      function (downloadId) {
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
          error: ok ? null : (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'download rejected',
        });
      }
    );
  });
}

/** Poll the page's scan state so a long run visibly reports work done.
 *  Counts, not a percentage: there is no fixed budget to be a percentage of. */
function startProgressPolling(tabId) {
  stopProgressPolling();
  state.progressTimer = setInterval(async function () {
    try {
      const probe = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function () {
          return window.__c2mScan || null;
        },
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
  if (state.progressTimer) {
    clearInterval(state.progressTimer);
    state.progressTimer = null;
  }
}

/** Save one scanned conversation to disk and optionally collect zip entries. */
async function saveConversationExport(tabId, result, options) {
  var downloadImages = options.downloadImages;
  var useTimestamp = options.useTimestamp;
  var batchStamp = options.batchStamp || formatExportTimestamp();
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
  var savedFiles = [];

  if (downloadImages && typeof chrome.downloads !== 'undefined') {
    var refs = parseArtifactRefs(md);
    dlTotal = refs.length;
    var extracted = [];
    if (refs.length > 0) {
      var urls = refs.map(function (r) {
        return r.url;
      });
      // Guarded because this runs BEFORE the .md write, and its failure used to
      // take the conversation with it: a navigated tab, a content script that
      // went away, or an oversized payload threw straight past the write, so a
      // scan that had already spent minutes capturing several hundred turns
      // produced no file at all. The turns are the expensive, unrepeatable part;
      // attachments are cheap and can be fetched again by re-running.
      try {
        var extractResult = await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: async function (urls) {
            if (typeof fetchImageDataUrls === 'function') return await fetchImageDataUrls(urls);
            if (typeof extractImageDataUrls === 'function') return await extractImageDataUrls(urls);
            return urls.map(function () {
              return null;
            });
          },
          args: [urls],
        });
        extracted = extractResult?.[0]?.result || [];
      } catch (fetchErr) {
        // Named, not swallowed: the .md then keeps the original links, and those
        // expire. An export that looks complete today and is empty next month is
        // the failure this message exists to prevent.
        dlErrors.push('attachments unavailable (' + ((fetchErr && fetchErr.message) || fetchErr) + ')');
      }
    }

    mdFinal = md;
    for (var i = 0; i < refs.length; i++) {
      var ex = extracted[i];
      if (ex && ex.dataUrl) {
        var ref = refs[i] || {};
        var fname = artifactFilename(ex.url, ref.label || '', i, slug, ref.kind || 'image');
        var dot = fname.lastIndexOf('.');
        fname = fname.slice(0, dot) + '--' + batchStamp + fname.slice(dot);
        var targetPath = folderPath + '/' + fname;
        var r = await downloadOne(ex.dataUrl, fname, targetPath);
        if (r.ok && chrome.downloads.onChanged) {
          if (!(await waitForDownloadComplete(r.downloadId, MD_WRITE_TIMEOUT_MS))) {
            r.ok = false;
            r.error = 'the attachment write did not complete';
          }
        } else if (r.ok) {
          r.ok = false;
          r.error = 'attachment completion could not be checked';
        }
        if (r.ok) {
          dlOk++;
          var localUrl =
            './' +
            r.filename.replace(/[ #%?()[\]]/g, function (char) {
              return '%' + char.charCodeAt(0).toString(16).toUpperCase();
            });
          mdFinal = mdFinal.split(ex.url).join(localUrl);
          var dataPart = ex.dataUrl.split(',')[1] || '';
          var bin = Uint8Array.from(atob(dataPart), function (c) {
            return c.charCodeAt(0);
          });
          savedFiles.push({ url: ex.url, name: fname, bytes: bin });
          if (zipEntries) addZipEntry(zipEntries, projectSlug, convSlug, fname, bin);
        } else {
          dlErrors.push(r.error || 'unknown');
        }
      } else {
        dlErrors.push('attachment unavailable: ' + (refs[i].label || 'file ' + (i + 1)));
      }
    }
  }

  // The markdown IS the export. Chrome can refuse the write (an invalid filename,
  // a full disk, a user-cancelled prompt), so the outcome is returned rather than
  // discarded: a caller that counts a refused write as a saved conversation
  // reports success for an empty folder.
  //
  // Written through a BLOB, never a `data:` URL. `encodeURIComponent` leaves ASCII
  // alone but expands every Cyrillic character to six bytes (`П` -> `%D0%9F`), so a
  // Russian conversation inflates 4.99x on the way into the URL. Measured on the
  // export that exposed this: 877,000 characters became a 4.17 MB URL against
  // Chrome's ~2 MB ceiling, and the write was refused — silently, because the
  // caller did not read mdOk either. The threshold lands near 300 turns in Russian
  // and past 1,500 in English, which is why every English test stayed green.
  // bytesToDownloadUrl already existed for the zip; the .md is the larger payload.
  var mdHandle = bytesToDownloadUrl(textToUtf8Bytes(mdFinal), 'text/markdown;charset=utf-8');
  var mdWrite = await downloadOne(mdHandle.url, mdName, folderPath + '/' + mdName, MD_WRITE_TIMEOUT_MS);
  // Chrome accepted the download; the bytes are still being written. Revoking the
  // blob URL now truncates the file — the same trap the zip path documents.
  //
  // Only when completion is OBSERVABLE. `waitForDownloadComplete` answers false
  // both for "the write was interrupted" and for "there is no onChanged to listen
  // to", and those must not be treated alike here: Chrome accepted the download,
  // so reporting "nothing was written — run it again" on the strength of a missing
  // API is a false alarm over a file that is on disk. A false warning costs the
  // user their trust in a good export, which is a real cost in the other
  // direction. The zip resolves this the opposite way on purpose — an archive is
  // a convenience, and an unverified one is better left unclaimed.
  var canObserveCompletion = typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.onChanged;
  if (mdWrite.ok && canObserveCompletion) {
    var mdWritten = await waitForDownloadComplete(mdWrite.downloadId, MD_WRITE_TIMEOUT_MS);
    if (!mdWritten) {
      mdWrite.ok = false;
      mdWrite.error = mdWrite.error || 'the write did not complete';
    }
  }
  mdHandle.revoke(mdHandle.url);
  if (mdWrite.ok) noteExportDownload(mdWrite.downloadId);
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
    savedFiles: savedFiles,
  };
}

export {
  addZipEntry,
  bytesToBase64DataUrl,
  bytesToDownloadUrl,
  downloadOne,
  MD_WRITE_TIMEOUT_MS,
  saveConversationExport,
  searchCompletedDownloadPaths,
  startProgressPolling,
  stopProgressPolling,
  textToUtf8Bytes,
  waitForDownloadComplete,
  ZIP_BYTE_BUDGET,
  ZIP_WRITE_TIMEOUT_MS,
};
