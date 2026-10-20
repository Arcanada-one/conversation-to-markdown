import { findScrollContainer } from './scroll.mjs';

/* ------------------------------------------------------------------------- *
 * Files offered only as a BUTTON WITH A HANDLER.
 *
 *  Measured on a production conversation (2026-09-10), after four exports in a
 *  row named a .zip without ever fetching it. The page offered it like this:
 *
 *    <button class="behavior-btn …" type="button">
 *      Скачать готовый Canon Consilium Prompt Bundle v1
 *    </button>
 *
 *  Every other path in this file misses it, and each for its own reason:
 *    - no `href`      -> the attachment-chip selectors match nothing;
 *    - no `sandbox:`  -> `sandboxFilesFromMarkdown` returns [] (measured: 0);
 *    - no panel row   -> a .zip has no built-in viewer, so the panel lists only
 *                        the .md/.txt siblings (measured: 4 rows, no archive);
 *    - no data-*      -> nothing carries a file id (measured: dataAttrs {} on
 *                        all 8 buttons), so the id cannot be read and resolved.
 *
 *  The label is PROSE, not a file name ("Скачать готовый …", no extension), so
 *  it cannot be turned into a path either. The real URL exists only after the
 *  page's own handler runs and asks the backend to sign one:
 *
 *    /backend-api/estuary/content?id=file_…&fn=<real name>&<signature>&ts=…
 *
 *  So the file is reachable only by CLICKING, and the click must be intercepted
 *  rather than allowed to proceed: an unintercepted click downloads through the
 *  PAGE, which never passes a `filename`, so Chrome drops the file in the root
 *  of Downloads instead of beside its conversation. Interception hands the URL
 *  to chrome.downloads, which is the same road every other artefact takes.
 * ------------------------------------------------------------------------- */

/** Buttons that offer a file download and carry no link of their own.
 *
 *  Matched by shape, not by wording alone: the class is ChatGPT's, while the
 *  label is user-facing text that is translated ("Скачать …" / "Download …")
 *  and would break the moment the UI language changes. A button that already
 *  sits inside an <a> is skipped — that one has an href and the existing
 *  attachment path already handles it. */
/** Formats ChatGPT cannot preview, so its button downloads instead of opening.
 *
 *  MEASURED, after clicking on the label alone made the export WORSE (2026-09-10):
 *  a "Скачать …" button for a .md opened the Library viewer instead of
 *  downloading, the viewer covered the artefact panel, and the next export
 *  produced ONE file where the previous one produced four. The label does not
 *  decide the action — the format does. ChatGPT previews what it can render
 *  (.md, .txt, images, video, PDF) and only downloads what it cannot. */
var UNPREVIEWABLE_FORMATS =
  /(^|[^a-z0-9])(zip|diff|patch|tar|gz|tgz|bz2|xz|7z|rar|whl|jar|exe|dmg|pkg|bin|iso|sqlite|db|parquet|pickle|pkl)([^a-z0-9]|$)/i;

/** Fold a name or label to a comparable form: lowercase, and every run of
 *  separators collapsed to one space.
 *
 *  A raw substring test cannot match a file name against the prose that offers
 *  it. Measured on the conversation this was built for:
 *
 *    panel/API name   canon-consilium-prompt-bundle-v1.zip
 *    button label     Скачать готовый Canon Consilium Prompt Bundle v1
 *
 *  The stem is spelled with hyphens and the label with spaces, so
 *  `indexOf(stem)` is -1 and the button reads as "not in the panel". Before this
 *  fix the archive would have been fetched by the API AND clicked — downloading
 *  the same bytes twice and re-opening the exact viewer-over-panel regression
 *  that the exclusion exists to prevent. */
function foldForNameMatching(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s_\-.]+/g, ' ')
    .trim();
}

/** Folded, extension-stripped stems of the names already resolved elsewhere. */
function panelStemsForMatching(panelNames) {
  const stems = [];
  for (const name of Array.from(panelNames || [])) {
    const stem = foldForNameMatching(String(name || '').replace(/\.[A-Za-z0-9]{1,8}$/, ''));
    if (stem) stems.push(stem);
  }
  return stems;
}

/** Whether a button label names a file some other source already resolved. */
function labelMatchesAnyStem(label, stems) {
  const folded = foldForNameMatching(label);
  if (!folded) return false;
  for (const stem of Array.from(stems || [])) {
    if (stem && folded.indexOf(stem) !== -1) return true;
  }
  return false;
}

/** Buttons that offer a file download and carry no link of their own.
 *
 *  Three conditions, all required — the first alone is what broke the export:
 *    1. the label offers a download ("Скачать …" / "Download …");
 *    2. the label names a format ChatGPT cannot preview, so the click really
 *       downloads instead of opening a viewer over the artefact panel;
 *    3. the file is not one the panel already lists, since the panel resolves
 *       it without a click and clicking it is what opens the viewer.
 *
 *  `panelNames` carries what the panel already found. Passing it is how the
 *  regression is prevented, so it is required by the callers that ship. */
function downloadButtonsInPage(doc, panelNames) {
  const root = doc || (typeof document !== 'undefined' ? document : null);
  if (!root || !root.querySelectorAll) return [];
  let nodes;
  try {
    nodes = root.querySelectorAll('button.behavior-btn, .behavior-btn, [data-file-reference="true"]');
  } catch (_e) {
    return [];
  }
  // Stems of the names already resolved without a click, so "Скачать готовый
  // Canon Consilium Prompt Bundle v1" matches
  // "canon-consilium-prompt-bundle-v1.zip". Extension-stripped because the
  // label never carries one, and separator-folded because the name spells with
  // hyphens what the label spells with spaces.
  const known = panelStemsForMatching(panelNames);

  const out = [];
  for (const node of Array.from(nodes)) {
    if (!node) continue;
    const modernName =
      node.getAttribute && node.getAttribute('data-file-reference') === 'true'
        ? node.getAttribute('data-markdown-copy-text')
        : null;
    if (modernName) {
      if (!labelMatchesAnyStem(modernName, known)) {
        out.push({ button: node, label: modernName, archive: UNPREVIEWABLE_FORMATS.test(modernName) });
      }
      continue;
    }
    if (node.tagName !== 'BUTTON') continue;
    if (typeof node.closest === 'function' && node.closest('a')) continue;
    const label = (node.textContent || '').trim();
    if (!label || label.length > 200) continue;
    // "Скачать …" / "Download …" / "Загрузить …". The other behavior-btn labels
    // in the same conversation ("Открыть полное ТЗ", "Посмотреть полный diff")
    // open a viewer instead of downloading, and clicking those would navigate
    // the page out from under a running export.
    // The boundary is whitespace or end-of-string, NEVER `\b`: that is an ASCII
    // word boundary, so `/^скачать\b/i` is false for "Скачать архив" and true
    // for "Download the bundle" — the check would have passed every English
    // label and rejected every Russian one, which is exactly the conversation
    // this was built for. Measured on the failing fixture before the fix.
    if (!/^\s*(скачать|download|загрузить|télécharger|herunterladen|descargar)(\s|$)/i.test(label)) {
      continue;
    }
    // Already resolved without a click — the panel supplies it for free, and
    // clicking it is what opened the viewer over the panel in the first place.
    if (labelMatchesAnyStem(label, known)) continue;
    out.push({ button: node, label: label, archive: UNPREVIEWABLE_FORMATS.test(label) });
  }
  // MEASURED (2026-09-10, probe 7): the markup cannot tell a download button
  // from a viewer button. Both carry the same class, the SAME <svg> icon and
  // the same data-start/data-end — only the prose label differs, and it lies in
  // both directions: the archive's label names no format at all ("Скачать
  // готовый Canon Consilium Prompt Bundle v1") while a VIEWER button says
  // "Посмотреть полный diff". So the format cannot gate the click.
  //
  // Clicking anyway is safe now, and only now: the same probe measured a click
  // on a .md button producing no URL (it opened the Library viewer), the close
  // control being found and pressed, and the panel reading again afterwards. A
  // wrong click therefore costs one dismissal instead of every artefact behind
  // the viewer — which is what the earlier label-only version cost.
  //
  // Ordering still matters: archives first, so the files that can ONLY be had
  // by clicking are fetched before any viewer has a chance to interfere.
  out.sort(function (a, b) {
    return (b.archive ? 1 : 0) - (a.archive ? 1 : 0);
  });
  return out;
}

/** Click each download button with the page's own download routes intercepted,
 *  and return the signed URLs the handlers produced.
 *
 *  The interception replaces three routes and restores all of them in a
 *  `finally`: leaving a patched `click()` behind would break the page for the
 *  user after the export, which is worse than missing a file.
 *
 *    - HTMLAnchorElement.prototype.click — the usual `<a download>` road;
 *    - window.open — used when the handler opens the URL instead;
 *    - URL.createObjectURL — a blob built in the page, which has no address
 *      the popup could fetch later, so its bytes are read here instead.
 *
 *  Each URL is recorded and the underlying action suppressed, so nothing lands
 *  in the Downloads root while the export is running.
 *
 *  Returns [{name, url, label, blob}] — `name` from the URL's `fn=` parameter
 *  when present, because the button's label is prose and not a file name. */
/** Close a viewer a click opened, so it stops covering the artefact panel.
 *
 *  Tried in order of reliability: the viewer's own close control, then Escape.
 *  Both are attempted rather than one, because the close button is identified
 *  by a translated aria-label ("Close" / "Закрыть") that a UI language change
 *  breaks, while Escape is a keyboard convention that survives it. Failing to
 *  close is not an error — the export continues either way and the panel read
 *  reports what it can see. */
/** An Escape keydown, falling back to a plain object where KeyboardEvent does
 *  not exist (Node, and any environment running these functions outside a page).
 *  Without the fallback the Escape route is unreachable off-browser, which makes
 *  it untestable — and an untestable guard is one nobody can prove works. */
function escapeKeydownEvent(win) {
  const Ctor = (win && win.KeyboardEvent) || (typeof KeyboardEvent !== 'undefined' ? KeyboardEvent : null);
  const init = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true };
  if (Ctor) {
    try {
      return new Ctor('keydown', init);
    } catch (_e) {
      /* fall through */
    }
  }
  return Object.assign({ type: 'keydown' }, init);
}

function dismissViewerOverlay(doc, win, options) {
  const root = doc || (typeof document !== 'undefined' ? document : null);
  if (!root) return false;
  const opts = options || {};
  let closed = false;
  if (opts.escapeOnly) {
    // Second pass: the close control already had its turn and cannot report
    // whether the viewer actually went away, so Escape follows unconditionally.
    try {
      const target = root.body || root;
      if (target && typeof target.dispatchEvent === 'function') {
        target.dispatchEvent(escapeKeydownEvent(win));
        return true;
      }
    } catch (_e) {
      /* dispatch refused */
    }
    return false;
  }
  try {
    const candidates = root.querySelectorAll(
      '[role="dialog"] button[aria-label], [data-testid*="close"], button[aria-label]'
    );
    for (const node of Array.from(candidates || [])) {
      const label = (node.getAttribute && node.getAttribute('aria-label')) || '';
      if (!/^(close|закрыть|schließen|fermer|cerrar)$/i.test(label.trim())) continue;
      if (typeof node.click === 'function') {
        node.click();
        closed = true;
        break;
      }
    }
  } catch (_e) {
    /* selector unsupported in a shim */
  }

  if (!closed) {
    try {
      const target = root.body || root;
      if (target && typeof target.dispatchEvent === 'function') {
        target.dispatchEvent(escapeKeydownEvent(win));
        closed = true;
      }
    } catch (_e) {
      /* dispatch refused */
    }
  }
  return closed;
}

/** Find download buttons by scrolling the conversation, mounting them as it goes.
 *
 *  Required because this pass runs after `scanTurns` has restored the original
 *  scroll position: the virtualizer keeps only the visible band mounted, so a
 *  static query sees the buttons of one screen and misses the rest. Collects
 *  across the whole conversation, de-duplicated by label, and leaves the
 *  scroller where it found it. */
/**
 * Drop buttons whose file the panel already resolved, and re-apply the ordering.
 *
 * Split out because the two facts arrive at different times now: the buttons are
 * found during the scan's walk, while the panel's names are only complete after
 * the merge that follows it. Clicking a file the panel already listed is what
 * opened the Library viewer over the panel and cut an export from four files to
 * one, so the exclusion has to happen — just later than the collection.
 */
function filterButtonsAgainstPanel(buttons, panelNames) {
  const known = panelStemsForMatching(panelNames);
  const out = [];
  for (const entry of Array.from(buttons || [])) {
    if (!entry || !entry.label) continue;
    if (!labelMatchesAnyStem(entry.label, known)) out.push(entry);
  }
  // Archives first: the files that can ONLY be had by clicking are fetched
  // before any viewer has a chance to interfere. Same rule as the selector.
  out.sort(function (a, b) {
    return (b.archive ? 1 : 0) - (a.archive ? 1 : 0);
  });
  return out;
}

async function findButtonsByScrolling(doc, win, options) {
  const opts = options || {};
  const root = doc || (typeof document !== 'undefined' ? document : null);
  if (!root || !root.querySelectorAll) return [];
  const sleep =
    opts.sleep ||
    function (ms) {
      return new Promise(function (resolve) {
        setTimeout(resolve, ms);
      });
    };

  let first = null;
  try {
    first = root.querySelector ? root.querySelector('[data-turn-id]') : null;
  } catch (_e) {
    /* shim without querySelector */
  }
  const scroller =
    opts.scroller || (typeof findScrollContainer === 'function' && first ? findScrollContainer(first) : null);
  if (!scroller) return downloadButtonsInPage(root, opts.panelNames);

  const settleMs = opts.buttonScrollSettleMs === undefined ? 500 : opts.buttonScrollSettleMs;
  const maxSteps = opts.buttonScrollMaxSteps === undefined ? 200 : opts.buttonScrollMaxSteps;
  const originalTop = scroller.scrollTop;
  const byLabel = new Map();

  function harvest() {
    for (const entry of downloadButtonsInPage(root, opts.panelNames)) {
      if (!byLabel.has(entry.label)) byLabel.set(entry.label, entry);
    }
  }

  try {
    scroller.scrollTop = 0;
    await sleep(settleMs);
    harvest();
    const maxTop = function () {
      return Math.max(0, (scroller.scrollHeight || 0) - (scroller.clientHeight || 0));
    };
    const step = Math.max(200, Math.floor((scroller.clientHeight || 800) * 0.7));
    for (let i = 0; i < maxSteps; i += 1) {
      const before = scroller.scrollTop;
      scroller.scrollTop = Math.min(before + step, maxTop());
      await sleep(settleMs);
      harvest();
      if (scroller.scrollTop >= maxTop() - 1 && before >= maxTop() - 1) break;
    }
  } finally {
    // A button captured while scrolled away is still clickable: the click path
    // calls scrollIntoView on it first. Restoring the position keeps the page
    // where the user left it.
    try {
      scroller.scrollTop = originalTop;
    } catch (_e) {
      /* detached */
    }
  }
  return Array.from(byLabel.values());
}

export {
  dismissViewerOverlay,
  downloadButtonsInPage,
  escapeKeydownEvent,
  filterButtonsAgainstPanel,
  findButtonsByScrolling,
  foldForNameMatching,
  labelMatchesAnyStem,
  panelStemsForMatching,
  UNPREVIEWABLE_FORMATS,
};
