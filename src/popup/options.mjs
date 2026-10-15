const btn = document.getElementById('btn-copy');
const btnCancel = document.getElementById('btn-cancel');
const btnPause = document.getElementById('btn-pause');
const status = document.getElementById('status');
const chkImages = document.getElementById('chk-images');
const chkBatch = document.getElementById('chk-batch');
const chkHtml = document.getElementById('chk-html');
const batchWarning = document.getElementById('batch-warning');
const btnShowFolder = document.getElementById('btn-show-folder');

// The running version, shown in the popup so a reloaded build is identifiable
// at a glance. Read from the manifest rather than written here: a number typed
// in two places is a number that goes stale in one of them, and the whole point
// is to tell two builds apart. Guarded because the popup is also loaded by the
// test shims, where chrome.runtime is absent.
(function showVersion() {
  const el = document.getElementById('version');
  if (!el) return;
  try {
    const manifest =
      typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getManifest === 'function'
        ? chrome.runtime.getManifest()
        : null;
    if (manifest && manifest.version) el.textContent = 'v' + manifest.version;
  } catch (_e) {
    // Leave the placeholder; a missing version must never break the popup.
  }
})();

/** Label on the action button for the options the user can see right now. */
function exportButtonLabel() {
  var saveMd = !!(chkImages && chkImages.checked);
  var saveHtml = !!(chkHtml && chkHtml.checked);
  if (chkBatch && chkBatch.checked && (saveMd || saveHtml)) return 'Sync backup';
  if (saveMd && saveHtml) return 'Save Markdown and HTML';
  if (saveHtml) return 'Save HTML site';
  if (saveMd) return 'Save Markdown';
  return 'Copy as Markdown';
}

/** Show that label. A running export owns the button text, so leave it alone
 *  while the button is disabled. */
function refreshExportButtonLabel() {
  if (!btn || btn.disabled) return;
  btn.textContent = exportButtonLabel();
}

/** Keep the options consistent, and show the caveat while it is still a choice.
 *
 *  A markdown batch WITHOUT file saving archives signed, short-lived links
 *  rather than the files themselves: the export looks complete the day it runs
 *  and is empty a few hours later. Choosing that batch switches saving on and
 *  holds it there.
 *
 *  An HTML batch is a different deliverable. Forcing the markdown option sent
 *  every chat through that writer, and a refused markdown write dropped the
 *  chat before its HTML page was recorded. While the HTML option is on, the
 *  markdown checkbox stays the user's.
 *
 *  Unchecking the batch hands the option back rather than leaving it stuck on. */
function syncBatchOptions() {
  var batchOn = !!(chkBatch && chkBatch.checked);
  var htmlOn = !!(chkHtml && chkHtml.checked);
  if (batchWarning) batchWarning.classList.toggle('visible', batchOn);
  if (chkImages) {
    var lockMarkdown = batchOn && !htmlOn;
    if (lockMarkdown) chkImages.checked = true;
    chkImages.disabled = lockMarkdown;
  }
  refreshExportButtonLabel();
}

if (chkBatch && typeof chkBatch.addEventListener === 'function') {
  chkBatch.addEventListener('change', syncBatchOptions);
}
if (chkHtml && typeof chkHtml.addEventListener === 'function') {
  chkHtml.addEventListener('change', syncBatchOptions);
}
if (chkImages && typeof chkImages.addEventListener === 'function') {
  chkImages.addEventListener('change', refreshExportButtonLabel);
}
refreshExportButtonLabel();

// Id of the tab currently being scanned, so Stop knows where to send the flag.

function showStatus(type, message) {
  status.className = type;
  status.textContent = message;
}

export {
  batchWarning,
  btn,
  btnCancel,
  btnPause,
  btnShowFolder,
  chkBatch,
  chkHtml,
  chkImages,
  exportButtonLabel,
  refreshExportButtonLabel,
  showStatus,
  status,
  syncBatchOptions,
};
