import {
  fetchConversationArtifacts,
  listArtifactPanelFiles,
  resolveArtifactPanelFiles,
  waitForArtifactPanel,
} from './artifacts.mjs';
import {
  dismissViewerOverlay,
  downloadButtonsInPage,
  filterButtonsAgainstPanel,
  findButtonsByScrolling,
} from './button-discovery.mjs';
import { markdownLink, nodeToMarkdown } from './markdown.mjs';
import { sandboxFilesFromMarkdown } from './scan.mjs';

async function collectButtonDownloads(options) {
  const opts = options || {};
  const doc = opts.doc || (typeof document !== 'undefined' ? document : null);
  const win = opts.win || (typeof window !== 'undefined' ? window : null);
  if (!doc || !win) return [];
  // Reported so a test can assert the names really travelled: a mutation
  // emptying them left the whole suite green, making the regression guard
  // unverified wiring rather than a checked one.
  if (typeof opts.onSelectButtons === 'function') opts.onSelectButtons(opts.panelNames || []);
  // `!== undefined`, not `||`: an EMPTY supplied list means the caller's walk
  // found no buttons, which is an answer. Treating it as "nothing supplied"
  // would re-traverse the whole conversation to reach the same result.
  const supplied = opts.buttons !== undefined;
  let buttons = supplied ? opts.buttons : downloadButtonsInPage(doc, opts.panelNames);

  // MEASURED (2026-09-10, 16:51 export): zero buttons found, no `## Files`
  // section written at all, while the same conversation demonstrably carries
  // eight of them. The reason is ordering — this runs AFTER scanTurns, whose
  // `finally` restores the original scroll position, so ChatGPT's virtualizer
  // has unmounted every turn outside the viewport. A probe measured 5 turns of
  // 8 present in a static DOM for exactly this reason.
  //
  // So the buttons are searched for the way the probe found them: scroll the
  // conversation and collect what mounts. Without this the feature is dead on a
  // conversation longer than one screen, which is every conversation that
  // generates files.
  //
  // This is now a FALLBACK, not the main path: the scan collects buttons on its
  // own walk and passes them in, so a caller that supplies a list — empty or
  // not — has already traversed. It stays for callers that do not, and because
  // its own guard was itself the next defect:
  //
  //   if (!opts.buttons && !buttons.length && …)
  //
  // "only when nothing was found here" sounds safe and is not. Measured on a
  // live thread: the landing position held 2 behavior-btn nodes, both editing
  // suggestions ("Make the opening more concrete"), neither a download. Two was
  // not zero, so the traversal never ran and all 5 download buttons — the .zip
  // and the .diff among them — were never seen. A guard that reads "we found
  // SOMETHING" cannot tell it apart from "we found the right thing".
  if (!supplied && !buttons.length && opts.scrollForButtons !== false) {
    buttons = await findButtonsByScrolling(doc, win, opts);
  }
  if (!buttons.length) return [];

  const sleep =
    opts.sleep ||
    function (ms) {
      return new Promise(function (resolve) {
        setTimeout(resolve, ms);
      });
    };
  // How long one handler gets to produce a URL. It is a network round-trip to
  // sign the link, so this is not instant; a button that never resolves must
  // not stall the export either.
  const settleMs = opts.clickSettleMs === undefined ? 2500 : opts.clickSettleMs;

  const captured = [];
  const anchorProto = win.HTMLAnchorElement && win.HTMLAnchorElement.prototype;
  const originalAnchorClick = anchorProto ? anchorProto.click : null;
  const originalOpen = win.open;
  const originalCreateObjectURL = win.URL && win.URL.createObjectURL;

  function record(url, blob) {
    if (!url && !blob) return;
    captured.push({ url: url || null, blob: blob || null });
  }

  try {
    if (anchorProto && typeof originalAnchorClick === 'function') {
      anchorProto.click = function () {
        const href = this.getAttribute ? this.getAttribute('href') || '' : '';
        // Only swallow the click when it is a download; an ordinary in-page
        // anchor clicked by unrelated code must still work.
        if (href && (this.hasAttribute('download') || /^(https?:|blob:)/.test(href))) {
          record(href, null);
          return undefined;
        }
        return originalAnchorClick.apply(this, arguments);
      };
    }
    win.open = function (url) {
      if (url) {
        record(String(url), null);
        return null;
      }
      return originalOpen ? originalOpen.apply(win, arguments) : null;
    };
    if (win.URL && typeof originalCreateObjectURL === 'function') {
      win.URL.createObjectURL = function (obj) {
        const url = originalCreateObjectURL.apply(win.URL, arguments);
        // Keep the blob itself: a blob: URL minted in the page is not fetchable
        // from the popup's context, so the bytes have to travel instead.
        record(url, obj || null);
        return url;
      };
    }

    for (const entry of buttons) {
      const before = captured.length;
      try {
        if (typeof entry.button.scrollIntoView === 'function') {
          entry.button.scrollIntoView({ block: 'center' });
        }
        entry.button.click();
      } catch (_e) {
        continue;
      }
      // Wait for the handler's round-trip, but stop as soon as it delivers.
      // Bounded by POLL COUNT, not by the wall clock: a supplied `sleep` that
      // returns immediately (tests, or a page throttling timers) turns a
      // clock-bounded loop into a busy-wait that still burns the full budget —
      // 2.5s per button, 20s over the eight buttons a real conversation
      // carries. Counting polls keeps the bound honest in both environments.
      const pollMs = opts.clickPollMs === undefined ? 150 : opts.clickPollMs;
      const maxPolls = Math.max(1, Math.ceil(settleMs / Math.max(1, pollMs)));
      for (let poll = 0; poll < maxPolls && captured.length === before; poll += 1) {
        await sleep(pollMs);
      }
      for (let i = before; i < captured.length; i += 1) {
        captured[i].label = entry.label;
      }
      // A click that produced no URL opened a viewer instead of downloading —
      // measured: the Library panel slid over the artefact panel and the next
      // export read ONE file where the previous read four. Close it, or every
      // artefact behind it is lost for the rest of the run.
      if (captured.length === before) {
        // Both routes, not the first that "worked": the close control reports
        // nothing about whether the viewer actually went away, and a viewer
        // left open costs every artefact behind it. Escape after it is cheap.
        dismissViewerOverlay(doc, win);
        await sleep(opts.dismissSettleMs === undefined ? 400 : opts.dismissSettleMs);
        dismissViewerOverlay(doc, win, { escapeOnly: true });
      }
    }
  } finally {
    if (anchorProto && typeof originalAnchorClick === 'function') {
      anchorProto.click = originalAnchorClick;
    }
    win.open = originalOpen;
    if (win.URL && typeof originalCreateObjectURL === 'function') {
      win.URL.createObjectURL = originalCreateObjectURL;
    }
  }

  const seen = new Set();
  const files = [];
  for (const item of captured) {
    const key = item.url || item.label + ':blob';
    if (seen.has(key)) continue;
    seen.add(key);
    files.push({
      name: downloadNameFromUrl(item.url, item.label),
      url: item.url,
      blob: item.blob,
      label: item.label || null,
      fromButton: true,
    });
  }
  return files;
}

/** The file's real name, which the button's prose label does not carry.
 *  `fn=` is what the signing endpoint puts there; the last path segment is the
 *  fallback, and the label is used only when the URL offers nothing usable. */
function downloadNameFromUrl(url, label) {
  const fallback = String(label || 'download')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-');
  if (!url) return fallback;
  let parsed;
  try {
    parsed = new URL(url, typeof location !== 'undefined' ? location.href : undefined);
  } catch (_e) {
    return fallback;
  }
  const fn = parsed.searchParams ? parsed.searchParams.get('fn') : null;
  if (fn) return fn;
  const last = (parsed.pathname || '').split('/').filter(Boolean).pop();
  // A path segment is only a name when it looks like one: the estuary endpoint
  // ends in `/content`, which is a route, not a file.
  if (last && /\.[A-Za-z0-9]{1,8}$/.test(last)) return last;
  return fallback;
}

async function appendPanelArtifacts(markdown, options) {
  const opts = options || {};
  const doc = opts.doc || (typeof document !== 'undefined' ? document : null);
  // The panel mounts LATE. Measured on production: turns appeared at 9s and the
  // artefact rows only at 12s after navigation, with no scrolling needed. A
  // single-frame read at 11s found nothing, so a user who exports immediately
  // after opening a conversation would silently lose every generated file. Wait
  // for it, bounded — and treat "still absent" as absent, not as an error.
  const conversationId =
    opts.conversationId ||
    ((typeof location !== 'undefined' ? location.pathname : '').match(/\/c\/([A-Za-z0-9-]+)/) || [])[1] ||
    null;
  if (!conversationId) return markdown;

  // Rows harvested during the scan, while each turn was mounted. They are the
  // authoritative reading for a panel nested inside a turn — see the comment at
  // the onMounted collector in getConversationMarkdown.
  const scannedFiles = Array.isArray(opts.scannedPanelFiles) ? opts.scannedPanelFiles : [];

  const artifacts =
    opts.artifacts !== undefined ? opts.artifacts : await fetchConversationArtifacts(conversationId, opts);

  if (typeof opts.onInventory === 'function') opts.onInventory(artifacts);

  // Ask the API FIRST, then decide whether waiting for the panel is worth it.
  // Most conversations have no generated files, and paying the panel-wait budget
  // on every one of them would slow every export for nothing. When the API says
  // there is nothing to find, a single-frame read is enough; when it reports
  // artefacts (or could not be read at all), wait for the panel to mount.
  // Files offered as ordinary links in the answer text. Measured on the
  // conversation that exposed this: ChatGPT wrote them as
  //
  //   [Скачать … bundle v1](sandbox:/mnt/data/canon-consilium-prompt-bundle-v1.zip)
  //
  // and four exports in a row named the file without ever fetching it. Neither
  // existing path could reach it: `nodeToMarkdown` rewrites the link into a
  // prose note, and the downloader only matches `[label](http…)`, so both the
  // note and the original link give zero matches. The artefact panel does not
  // rescue it either — a .zip has no built-in viewer, so it gets no panel row.
  //
  // This is also the only place a REAL sandbox path is available. The panel
  // rebuilds one as '/mnt/data/' + label, which is a guess; a link carries the
  // path the file actually has, subdirectory and all.
  const bodyFiles = sandboxFilesFromMarkdown(markdown);

  // Paths the API names in message text. This is the source that carries files
  // with no panel row, no attachment and no link — measured: the .zip and the
  // .diff of the conversation this was built for appear NOWHERE else.
  const apiFiles = (artifacts || [])
    .filter(function (a) {
      return a && a.sandboxPath;
    })
    .map(function (a) {
      return {
        name: a.name,
        sandboxPath: a.sandboxPath,
        fromApi: true,
        priority: a.priority === undefined ? 1 : a.priority,
        messageId: a.messageId,
      };
    });

  const uploadedFiles = (artifacts || [])
    .filter(function (a) {
      return a && a.kind === 'attachment' && a.name;
    })
    .map(function (a) {
      return Object.assign({}, a, { priority: 0 });
    });

  let files = opts.files;
  if (!files) {
    // A sandbox link in the body is proof a generated file exists — better
    // proof than the API, which reports neither uploads nor interpreter output
    // for such a conversation. Wait for the panel when either source says so.
    const mayHaveFiles = artifacts === null || artifacts.length > 0 || bodyFiles.length > 0 || scannedFiles.length > 0;
    // A completed scan plus an explicit API link already supplies the file's
    // real path. Do not spend half the lookup budget waiting for a viewer panel
    // that archives do not render. Other layouts retain the late-panel wait.
    const offeredAfterScan =
      Array.isArray(opts.scannedPanelFiles) &&
      (uploadedFiles.length > 0 ||
        apiFiles.some(function (file) {
          return file.priority === 0;
        }));
    files = mayHaveFiles && !offeredAfterScan ? await waitForArtifactPanel(doc, opts) : listArtifactPanelFiles(doc);
  }

  // Merge, preferring the body's real path over the panel's reconstructed one.
  const bySandboxPath = new Map();
  // Scan-time rows first: they were read while their turn was mounted, which a
  // post-scan read cannot reproduce for a panel nested inside a turn.
  for (const file of scannedFiles) bySandboxPath.set(file.sandboxPath, file);
  for (const file of files) bySandboxPath.set(file.sandboxPath, file);
  for (const file of bodyFiles) bySandboxPath.set(file.sandboxPath, file);
  // Last, so a path the API states verbatim wins over one the panel rebuilt
  // from a row label. Both are keyed by path, so this adds the files that have
  // no other source and overwrites nothing that disagrees.
  for (const file of apiFiles) {
    const visible = bySandboxPath.has(file.sandboxPath);
    bySandboxPath.set(file.sandboxPath, visible ? Object.assign({}, file, { priority: 0 }) : file);
  }
  files = uploadedFiles.concat(Array.from(bySandboxPath.values())).sort(function (a, b) {
    return (a.priority || 0) - (b.priority || 0);
  });

  // Files behind a button handler are gathered BEFORE the early return below:
  // such a file has no sandbox path at all, so `files` is empty for a
  // conversation whose only artefact is the archive — and returning here would
  // drop it exactly the way four consecutive exports did.
  // The panel's names are handed to the button selector so a file it already
  // resolved is never clicked. That is the guard against the measured
  // regression: clicking a .md the panel had already listed opened the Library
  // viewer over the panel and cut the next export from four files to one.
  const panelNames = files.map(function (f) {
    return f.name;
  });
  // Buttons gathered on the scan's single walk, filtered HERE rather than
  // there: the exclusion needs the panel's names, and the panel is only fully
  // known once the merge above has run.
  const scannedButtons = Array.isArray(opts.scannedButtons)
    ? filterButtonsAgainstPanel(opts.scannedButtons, panelNames)
    : null;
  const buttonFiles =
    opts.clickDownloads === false
      ? opts.reportUnresolvedButtons
        ? (scannedButtons || downloadButtonsInPage(doc, panelNames)).map(function (entry) {
            return { name: entry.label, url: null };
          })
        : []
      : opts.buttonFiles !== undefined
        ? opts.buttonFiles
        : await collectButtonDownloads(
            Object.assign({}, opts, {
              panelNames: panelNames,
              // Present but empty means the walk genuinely found none — do not fall
              // back to a second traversal, which is what this replaces.
              buttons: scannedButtons === null ? undefined : scannedButtons,
            })
          );

  // An unreadable inventory can hide uploads with no DOM download link.
  // Preserve that uncertainty even if there are no visible candidates.
  const inventoryUnavailable = artifacts === null;
  if (!files.length && !buttonFiles.length && !inventoryUnavailable) return markdown;

  // Candidate message ids for the download call. Measured: the endpoint requires
  // a message_id but does NOT use it to select the file — 12 different ids
  // resolved one sandbox_path to the same file id. So ANY id from the
  // conversation works, and taking them only from messages that already showed
  // an artefact is wrong: a conversation can hold a generated PDF while no
  // message carries an attachment or asset_pointer, leaving nothing to try and
  // the file unresolved.
  //
  // null artifacts means the API could not be read at all — kept distinct below
  // rather than implying the conversation had no files.
  let messageIds = opts.messageIds;
  if (!messageIds) {
    messageIds = artifacts
      ? artifacts
          .map(function (a) {
            return a.messageId;
          })
          .filter(Boolean)
      : [];
    // Sandbox artefacts first: a `tool` message that produced a file is the id
    // most likely to be accepted for it, and the loop in
    // resolveArtifactPanelFiles keeps the first id that works.
    messageIds.sort(function (a, b) {
      const rank = function (id) {
        for (const art of artifacts || []) {
          if (art.messageId === id) return art.sandboxPath ? 0 : 1;
        }
        return 1;
      };
      return rank(a) - rank(b);
    });
    if (!messageIds.length) {
      // Fall back to the ids the DOM carries; the panel is outside the message
      // tree but the turns themselves are still in the page.
      const nodes = doc && doc.querySelectorAll ? doc.querySelectorAll('[data-message-id]') : [];
      for (const node of Array.from(nodes)) {
        const id = node.getAttribute ? node.getAttribute('data-message-id') : null;
        if (id) messageIds.push(id);
      }
    }
  }

  const resolvedList = await resolveArtifactPanelFiles(conversationId, {
    files: files,
    messageIds: messageIds,
    fetchImpl: opts.fetchImpl,
    token: opts.token,
    onResolved: opts.onResolved,
    onFailure: opts.onFailure,
  });

  const lines = [];
  const unresolved = [];
  for (const entry of resolvedList) {
    if (entry.resolved && entry.resolved.url) {
      lines.push(markdownLink(entry.file.name, entry.resolved.url));
    } else {
      unresolved.push(entry.file.name);
    }
  }

  // Files that exist only behind a button handler. Collected LAST, and only
  // when asked: clicking is a side effect on the page, so it must not happen
  // during a plain "copy as Markdown". Names already resolved above are not
  // clicked again — the panel and the body reach the same file more cheaply.
  const alreadyNamed = new Set();
  for (const entry of resolvedList) alreadyNamed.add(entry.file.name);
  for (const file of buttonFiles) {
    if (!file || alreadyNamed.has(file.name)) continue;
    alreadyNamed.add(file.name);
    if (file.url) {
      lines.push(markdownLink(file.name, file.url));
    } else {
      unresolved.push(file.name);
    }
  }
  // Deliberately overlapping with the `!files.length` early return above: that
  // one avoids the network round-trips entirely, this one covers a resolver that
  // returned no rows for files that DID exist. A mutation removing the earlier
  // guard is therefore harmless to output and survives the suite — recorded in
  // MUTATION-EVIDENCE.md as redundant-by-design rather than an untested branch,
  // so it is not "fixed" by deleting one of the two.
  if (!lines.length && !unresolved.length && !inventoryUnavailable) return markdown;

  const block = ['## Files'];
  if (lines.length) block.push(lines.join('\n'));
  if (unresolved.length || inventoryUnavailable) {
    if (typeof opts.onIncomplete === 'function') opts.onIncomplete();
  }
  if (inventoryUnavailable) {
    block.push(
      '> Could not enumerate attachments: the conversation API was unreachable. ' +
        'Visible file links were preserved, but attachment completeness is unknown.'
    );
  }
  if (unresolved.length) {
    block.push(
      '> Could not retrieve a download link for: ' +
        unresolved.join(', ') +
        (artifacts === null ? ' (the conversation API was unreachable)' : '')
    );
  }
  const body = block.join('\n\n');
  return markdown ? markdown + '\n\n---\n\n' + body : body;
}

/** Fallback for older ChatGPT UI that doesn't use [data-turn-id]. */
function extractConversationLegacy(root) {
  const messages = (root || document).querySelectorAll('[data-message-author-role]');
  if (!messages.length) return null;

  const parts = [];
  for (const msg of messages) {
    const role = msg.getAttribute('data-message-author-role');
    if (role === 'user') {
      const bubble = msg.querySelector('.whitespace-pre-wrap') || msg.querySelector('[dir="auto"]') || msg;
      const text = bubble.textContent.trim();
      if (text) parts.push('#### You said:\n\n' + text);
    } else if (role === 'assistant') {
      const markdownDiv = msg.querySelector('.markdown') || msg.querySelector('[class*="prose"]') || msg;
      let md = nodeToMarkdown(markdownDiv).trim();
      md = md.replace(/\n{3,}/g, '\n\n');
      if (md) parts.push('#### ChatGPT said:\n\n' + md);
    }
  }

  return parts.length ? parts.join('\n\n---\n\n') : null;
}

export { appendPanelArtifacts, collectButtonDownloads, downloadNameFromUrl, extractConversationLegacy };
