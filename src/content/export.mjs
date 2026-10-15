import {
  fetchConversationArtifacts,
  fetchConversationMetadata,
  fetchSessionToken,
  listArtifactPanelFiles,
  resolveArtifactPanelFiles,
  resolveSandboxDownloadUrl,
  sandboxPathsFromApiMessage,
  waitForArtifactPanel,
} from './artifacts.mjs';
import {
  dismissViewerOverlay,
  downloadButtonsInPage,
  escapeKeydownEvent,
  filterButtonsAgainstPanel,
  findButtonsByScrolling,
  foldForNameMatching,
  UNPREVIEWABLE_FORMATS,
} from './button-discovery.mjs';
import {
  appendPanelArtifacts,
  collectButtonDownloads,
  downloadNameFromUrl,
  extractConversationLegacy,
} from './button-fetch.mjs';
import {
  ATTACHMENT_CHIP_SELECTORS,
  extractAttachments,
  extractAttachmentsDetailed,
  extractImages,
  markdownLink,
  nodeToMarkdown,
} from './markdown.mjs';
import {
  largestCoverageGap,
  markPartialScan,
  prefixPartialNotice,
  sandboxFilesFromMarkdown,
  scanTurns,
} from './scan.mjs';
import { findScrollContainer, scrollToConversationStart } from './scroll.mjs';
import {
  extractConversationTitle,
  findCollapsedProjectRows,
  findHistoryRetryControl,
  findShowMoreControl,
  findSidebarScroller,
  knownProjectName,
  listSidebarConversations,
  projectRowContainer,
  stripSidebarLabelSuffix,
  titleFromSidebarLink,
} from './sidebar-rows.mjs';
import { collectSidebarConversations } from './sidebar-walk.mjs';
import {
  buildConversationMarkdown,
  extractTurn,
  getSectionTurnId,
  modernMessageRole,
  modernMessageSections,
  orderCapturedTurns,
  parseTurnOrder,
  readModernPagination,
} from './turns.mjs';

/** ChatGPT retains inactive conversations in the app shell. Measured on
 * 2026-10-02: two main surfaces, one under active-page=false (display:none),
 * sharing fallback turn keys. Never combine their text or attachment rows.
 * Older layouts have no app-shell markers and retain the document fallback.
 */
function activeConversationRoot(doc) {
  if (!doc || !doc.querySelectorAll) return doc;
  if (!doc.querySelector('[data-app-shell-active-page]')) return doc;
  const pages = Array.from(doc.querySelectorAll('[data-app-shell-active-page]'));
  if (!pages.length) return doc;
  const active = pages.filter(function (page) {
    return page.getAttribute('data-app-shell-active-page') === 'true';
  });
  return active.length === 1 ? active[0] : null;
}

function conversationHasMessages(root) {
  if (!root || !root.querySelector) return false;
  if (root.querySelector('[data-turn-id]') || root.querySelector('[data-message-author-role]')) return true;
  return modernMessageSections(root).some(function (unit) {
    return !!modernMessageRole(unit);
  });
}

function retryButtonText(button) {
  return String((button && button.textContent) || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function loneActionButton(container) {
  if (!container || !container.querySelectorAll) return null;
  let buttons;
  try {
    buttons = Array.from(container.querySelectorAll('button'));
  } catch (_e) {
    return null;
  }
  const usable = buttons.filter(function (button) {
    if (!button || typeof button.click !== 'function') return false;
    if (button.disabled) return false;
    if (button.getAttribute && button.getAttribute('aria-disabled') === 'true') return false;
    if (button.querySelector && button.querySelector('a[href*="/c/"]')) return false;
    return retryButtonText(button).length > 0;
  });
  return usable.length === 1 ? usable[0] : null;
}

/** The active thread's Retry control, present only when the thread did not load.
 *
 *  Measured 2026-10-14. The active page's
 *  `[data-app-shell-focus-area="main"]` held no turns and exactly one button.
 *  The sentence above it was "Could not load this ChatGPT conversation".
 *  Header and sidebar buttons sit outside that focus area. Several buttons
 *  means some other empty state and must not be clicked. The English label
 *  "Retry" is only the fallback for a page that lost the focus-area marker.
 */
function findConversationRetryControl(doc) {
  const root = doc || (typeof document !== 'undefined' ? document : null);
  if (!root || !root.querySelector) return null;
  const page = activeConversationRoot(root);
  if (!page || !page.querySelector) return null;
  if (conversationHasMessages(page)) return null;
  const focus = page.querySelector('[data-app-shell-focus-area="main"]');
  const fromFocus = loneActionButton(focus);
  if (fromFocus) return fromFocus;
  const main = page.querySelector('main') || page;
  if (!main.querySelectorAll) return null;
  let buttons;
  try {
    buttons = Array.from(main.querySelectorAll('button'));
  } catch (_e) {
    return null;
  }
  const labeled = buttons.filter(function (button) {
    return retryButtonText(button) === 'Retry' && typeof button.click === 'function' && !button.disabled;
  });
  return labeled.length === 1 ? labeled[0] : null;
}

function clickConversationRetry() {
  const button = findConversationRetryControl(typeof document !== 'undefined' ? document : null);
  if (!button) return false;
  try {
    button.click();
    return true;
  } catch (_e) {
    return false;
  }
}

const RATE_LIMIT_PAGE_ERROR = 'ChatGPT rate limit: the conversation page asked to retry.';

function rateLimitPageError(doc) {
  if (!findConversationRetryControl(doc || (typeof document !== 'undefined' ? document : null))) return null;
  return { ok: false, error: RATE_LIMIT_PAGE_ERROR, rateLimited: true };
}

/** Wait until a navigated conversation page has mountable message content.
 *  The Retry screen is reported at once. The popup waits and clicks; this
 *  function does not, so a 30s content timeout is not spent staring at a
 *  button that will fail again if pressed immediately.
 */
function waitForConversationReady(options) {
  const supplied = options || {};
  // 0 is a real timeout: one look, then the caller decides. `||` would turn
  // that into a 30s wait on every page that is still mounting.
  const timeoutMs = supplied.timeoutMs == null ? 30000 : supplied.timeoutMs;
  const pollMs = supplied.pollMs || 300;
  const conversationId = supplied.conversationId || null;

  return new Promise(function (resolve) {
    const startedAt = Date.now();
    function check() {
      if (conversationId) {
        const pathMatch = (typeof location !== 'undefined' ? location.pathname : '').match(/\/c\/([A-Za-z0-9-]+)/);
        if (!pathMatch || pathMatch[1] !== conversationId) {
          if (Date.now() - startedAt >= timeoutMs) {
            return resolve({ ready: false, error: 'Navigation did not reach the conversation.' });
          }
          return setTimeout(check, pollMs);
        }
      }
      const root = typeof document !== 'undefined' ? activeConversationRoot(document) : null;
      if (conversationHasMessages(root)) return resolve({ ready: true });
      if (findConversationRetryControl(typeof document !== 'undefined' ? document : null)) {
        return resolve({ ready: false, rateLimited: true, error: RATE_LIMIT_PAGE_ERROR });
      }
      if (Date.now() - startedAt >= timeoutMs) {
        return resolve({ ready: false, error: 'Conversation content did not load.' });
      }
      setTimeout(check, pollMs);
    }
    check();
  });
}

/** Turn a conversation title into a filesystem-safe slug.
 *  Keeps Unicode letters (Cyrillic titles stay readable), collapses the rest
 *  to single hyphens, and caps the length so the download path stays sane. */
function slugifyTitle(title, maxLength) {
  const limit = maxLength || 60;
  if (!title) return null;
  const slug = String(title)
    .normalize('NFC')
    // Characters Chrome refuses in a download filename even though they are
    // legal in a title. Measured on production: a conversation titled
    // "Обзор репозитория \u{7FFFF}" (a Private Use Area codepoint) produced a
    // slug Chrome rejected with "Invalid filename", so the whole conversation
    // failed to save while the run reported progress. Covers C0/C1 controls, the
    // BMP Private Use Area, both Private Use planes, unpaired surrogates, and
    // the non-characters at the end of each plane.
    .replace(/[\u0000-\u001F\u007F-\u009F\uE000-\uF8FF\uFDD0-\uFDEF\uFFF0-\uFFFF]/g, ' ')
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, function (pair) {
      const code = pair.codePointAt(0);
      const inPrivatePlane = code >= 0xf0000 && code <= 0x10fffd;
      const isNonCharacter = (code & 0xfffe) === 0xfffe;
      return inPrivatePlane || isNonCharacter ? ' ' : pair;
    })
    // A LONE surrogate only: the pair rule above already ran and returned valid
    // pairs untouched, so sweeping the whole D800-DFFF range here would split
    // every emoji into two spaces. Verified: "План 🚀 запуска" kept its emoji
    // before this change and lost it after, until the range was narrowed.
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, ' ')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    // `~` is reserved as the marker that introduces a conversation id in an export
    // filename. Excluding it here is what makes the two name formats
    // non-overlapping: a title can otherwise contain anything a separator or an id
    // can contain, and a name written by an older version could then be read as a
    // current one belonging to a different conversation. Removing the character from
    // titles is cheap; the ambiguity it prevents cost a conversation.
    .replace(/~+/g, '-')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, limit)
    .replace(/-+$/g, '');
  // This slug becomes a DIRECTORY name — in a batch the project slug does too —
  // so a dot-only result is a relative-path segment, not a name. Chrome rejects
  // any downloads.download() filename containing a `..` back-reference, so a
  // conversation titled ".." made every write in the run fail. Returning null
  // hands the caller its own fallback name instead.
  if (/^\.+$/.test(slug)) return null;
  return slug || null;
}

/** Called by popup via chrome.scripting.executeScript — returns text, does NOT write clipboard. */
async function getConversationMarkdown(settings) {
  // Retrieving generated artefacts requires calling ChatGPT's own conversation
  // API. PRIVACY.md states that saving files is the ONLY mode in which the
  // extension makes network requests, so that lookup is opt-in and off by
  // default: a plain "copy as Markdown" stays a pure DOM read.
  const wantFiles = !!(settings && settings.downloadFiles);
  try {
    const root = activeConversationRoot(document);
    if (!root) return { ok: false, error: 'Could not identify the active conversation. Try again after it loads.' };
    const startPath = typeof location !== 'undefined' ? location.pathname : '';
    const conversationId = (startPath.match(/\/c\/([A-Za-z0-9-]+)/) || [])[1] || null;
    function assertSameConversation() {
      if (
        (typeof location !== 'undefined' && location.pathname !== startPath) ||
        activeConversationRoot(document) !== root
      ) {
        throw new Error('Conversation changed during export. Return to the intended conversation and export again.');
      }
    }
    const legacySection = root.querySelector('[data-turn-id]');
    const modern = !legacySection && modernMessageSections(root).length > 0;
    const firstSection = legacySection || (modern ? modernMessageSections(root)[0] : null);
    let md;
    var scanMeta = null;
    // Artefact rows collected while the scan holds each scroll position. Keyed
    // by file name: the same row can mount repeatedly as the walk passes it.
    const panelFilesDuringScan = new Map();
    // Download buttons collected on the same walk. A button found while scrolled
    // away stays clickable — the click path calls scrollIntoView on it first —
    // so there is no reason to traverse the conversation a second time to find
    // them. Keyed by label, since one button can mount repeatedly.
    const buttonsDuringScan = new Map();
    if (!firstSection) {
      md = extractConversationLegacy(root);
    } else {
      const container = findScrollContainer(firstSection);
      if (!container) return { ok: false, error: 'Could not find the conversation scroll area.' };
      // The popup cannot hold a live channel into the page across
      // executeScript calls, so cancellation and progress ride on a window
      // flag it can set and read with a separate one-liner injection. Guarded
      // because this function is also exercised outside a browser window.
      const scanState = { cancelled: false, captured: 0, observed: 0, elapsedMs: 0 };
      scanMeta = {};
      if (typeof window !== 'undefined') window.__c2mScan = scanState;
      const turns = await scanTurns(container, {
        readSections: function () {
          assertSameConversation();
          return modern ? modernMessageSections(root) : root.querySelectorAll('[data-turn-id]');
        },
        scrollToStart: modern
          ? async function (target) {
              const result = await scrollToConversationStart(target, {
                readFirstTurn: function (root) {
                  return modernMessageSections(root)[0] || null;
                },
                readFirstTurnId: function (root) {
                  const first = modernMessageSections(root)[0];
                  return first ? getSectionTurnId(first) : null;
                },
                countTurns: function (root) {
                  return modernMessageSections(root).length;
                },
                readPagination: readModernPagination,
              });
              // Unknown layouts stay uncertain; the measured history boundary can
              // now positively certify arrival instead of warning on every export.
              if (!result.confirmedByPagination) {
                markPartialScan({ scanMeta: scanMeta }, 'history start unverified for this page layout');
              }
              return result;
            }
          : undefined,
        extractTurn: extractTurn,
        isCancelled: function () {
          return scanState.cancelled === true;
        },
        scanMeta: scanMeta,
        onProgress: function (p) {
          scanState.captured = p.captured;
          scanState.observed = p.observed;
          scanState.elapsedMs = p.elapsedMs;
        },
        // Harvest artefact rows AT EVERY SCROLL POSITION, while the scan holds
        // the page there. Measured from the live markup: the rows are not in a
        // sidebar, they are nested INSIDE the turn —
        //
        //   <div class="…agent-turn">
        //     <div data-message-author-role="assistant" …>
        //     <div class="w-full max-w-[480px]">      <- the artefact panel
        //
        // so a row is mounted only while its own turn is, and `scanTurns`
        // restores the original scroll position in its `finally`. Reading after
        // the scan therefore sees whichever turn happens to be on screen: the
        // panel showed TZ-01..TZ-04 while the export carried 89_articles plus
        // TZ-02..TZ-04, two different sets of four, because they were read at
        // two different scroll positions. Collected during the walk, every
        // turn's files are seen while that turn exists.
        onMounted: wantFiles
          ? function () {
              for (const file of listArtifactPanelFiles(root)) {
                if (!panelFilesDuringScan.has(file.name)) {
                  panelFilesDuringScan.set(file.name, file);
                }
              }
              // Same walk, same reason. The separate button traversal that used to
              // run after the scan was guarded by "found nothing here", and the
              // guard failed the moment ANY behavior-btn happened to be on screen:
              // measured on a live thread, the landing position showed 2 buttons
              // (both editing suggestions — "Make the opening more concrete"), so
              // the traversal never ran and all 5 real download buttons were missed.
              // Collected during the walk there is no guard to get wrong.
              for (const entry of downloadButtonsInPage(root, [])) {
                if (!buttonsDuringScan.has(entry.label)) {
                  buttonsDuringScan.set(entry.label, entry);
                }
              }
            }
          : null,
      });
      md = buildConversationMarkdown(turns);
      if (scanMeta.partial) md = prefixPartialNotice(md, scanMeta.reason);
    }
    if (!md) return rateLimitPageError(document) || { ok: false, error: 'No conversation found on this page.' };
    // Generated (code-interpreter) files render in a panel outside the message
    // tree with no href and no testid, so the per-turn scan above cannot see
    // them. Appending them here puts them in the markdown, which is where the
    // popup's downloader looks for artefacts.
    let attachmentsIncomplete = false;
    if (wantFiles) {
      // What the walk saw wins: those rows were read while their own turn was
      // mounted. appendPanelArtifacts still reads the panel itself, and merges,
      // so a conversation whose panel IS a sidebar keeps working unchanged.
      // Content scripts execute in an isolated world. Patching that world's
      // anchor.click/window.open cannot intercept a handler owned by the page.
      // Never click its download buttons: an escaped native download can close
      // the popup before the conversation is saved. Keep unresolved names.
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const phaseBudget = settings && settings.artifactTimeoutMs !== undefined ? settings.artifactTimeoutMs : 30000;
      let phaseTimer;
      const resolvedSoFar = [];
      const lookup = {
        stage: 'starting',
        requests: 0,
        statuses: {},
        candidates: null,
        offered: 0,
        failures: {},
        rejectedHosts: [],
        reason: 'unresolved',
      };
      try {
        md = await Promise.race([
          appendPanelArtifacts(md, {
            doc: root,
            conversationId: conversationId,
            scannedPanelFiles: firstSection ? Array.from(panelFilesDuringScan.values()) : undefined,
            scannedButtons: firstSection ? Array.from(buttonsDuringScan.values()) : undefined,
            clickDownloads: false,
            reportUnresolvedButtons: true,
            onInventory: function (artifacts) {
              lookup.candidates = artifacts === null ? null : artifacts.length;
              lookup.offered = (artifacts || []).filter(function (a) {
                return a.priority === 0;
              }).length;
              lookup.stage = 'panel';
            },
            onResolved: function (entry) {
              resolvedSoFar.push(entry);
            },
            onFailure: function (kind, host) {
              lookup.failures[kind] = (lookup.failures[kind] || 0) + 1;
              if (host && lookup.rejectedHosts.indexOf(host) === -1) lookup.rejectedHosts.push(host);
            },
            onIncomplete: function () {
              attachmentsIncomplete = true;
            },
            fetchImpl:
              typeof fetch === 'function'
                ? async function (url, init) {
                    // Only stage names and status counts leave this wrapper. Never
                    // include URLs, headers, response bodies or exception messages.
                    assertSameConversation();
                    if (controller && controller.signal.aborted) throw new Error('lookup cancelled');
                    lookup.stage =
                      String(url).indexOf('/api/auth/session') !== -1
                        ? 'session'
                        : String(url).indexOf('/interpreter/download') !== -1 ||
                            String(url).indexOf('/files/download/') !== -1
                          ? 'file-link'
                          : 'conversation';
                    lookup.requests += 1;
                    const response = await fetch(
                      url,
                      Object.assign({}, init, controller ? { signal: controller.signal } : {})
                    );
                    const code = response && Number.isInteger(response.status) ? response.status : 0;
                    lookup.statuses[code] = (lookup.statuses[code] || 0) + 1;
                    return response;
                  }
                : undefined,
          }),
          new Promise(function (_resolve, reject) {
            phaseTimer = setTimeout(function () {
              lookup.reason = 'timeout';
              if (controller) controller.abort();
              reject(new Error('attachment lookup timed out'));
            }, phaseBudget);
          }),
        ]);
      } catch (_error) {
        attachmentsIncomplete = true;
        if (lookup.reason !== 'timeout') lookup.reason = 'exception';
        // The text was already captured. Attachment failure must not erase it.
        const names = Array.from(
          new Set(
            Array.from(panelFilesDuringScan.values())
              .map(function (f) {
                return f.name;
              })
              .concat(
                Array.from(buttonsDuringScan.values()).map(function (b) {
                  return b.label;
                })
              )
          )
        );
        const available = resolvedSoFar.filter(function (entry) {
          return entry.resolved && entry.resolved.url;
        });
        const recoveredLinks = available.map(function (entry) {
          return markdownLink(entry.file.name, entry.resolved.url);
        });
        const recoveredNames = new Set(
          available.map(function (entry) {
            return entry.file.name;
          })
        );
        const missingNames = names.filter(function (name) {
          return !recoveredNames.has(name);
        });
        md +=
          '\n\n---\n\n## Files' +
          (recoveredLinks.length ? '\n\n' + recoveredLinks.join('\n') : '') +
          '\n\n> Attachment lookup failed or timed out; ' +
          'the conversation text was preserved. Re-run to retrieve files.' +
          (missingNames.length ? '\n\n> Could not retrieve a download link for: ' + missingNames.join(', ') : '');
      } finally {
        clearTimeout(phaseTimer);
      }
      if (attachmentsIncomplete) {
        md +=
          '\n\n> Attachment diagnostics: reason=' +
          lookup.reason +
          '; stage=' +
          lookup.stage +
          '; requests=' +
          lookup.requests +
          '; HTTP=' +
          JSON.stringify(lookup.statuses) +
          '; candidates=' +
          (lookup.candidates === null ? 'unknown' : lookup.candidates) +
          '; resolved=' +
          resolvedSoFar.filter(function (entry) {
            return entry.resolved;
          }).length +
          '; offered=' +
          lookup.offered +
          '; linkFailures=' +
          JSON.stringify(lookup.failures) +
          '; rejectedHosts=' +
          JSON.stringify(lookup.rejectedHosts) +
          '.';
      }
    }
    // A Library citation is an offered file, even though its preview button
    // exposes no download URL. Keep the inline name, but do not bank the export
    // as complete when saving files was requested. Otherwise batch resume skips
    // the conversation forever despite never saving those cited documents.
    if (wantFiles && /\(referenced file; not downloaded\)/.test(md)) {
      attachmentsIncomplete = true;
      md +=
        '\n\n> Library files cited in this conversation were not downloaded. ' +
        'Download them from ChatGPT Library before treating this export as complete.';
    }
    assertSameConversation();
    const title = extractConversationTitle();
    if (title) md = '# ' + title + '\n\n' + md;
    return {
      ok: true,
      md: md,
      partial: (!!scanMeta && scanMeta.partial === true) || attachmentsIncomplete,
      partialReason:
        scanMeta && scanMeta.partial ? scanMeta.reason : attachmentsIncomplete ? 'attachments-unavailable' : null,
      title: title,
      slug: slugifyTitle(title),
      lines: md.split('\n').length,
      words: md.split(/\s+/).filter(Boolean).length,
    };
  } catch (error) {
    return { ok: false, error: error.message || String(error), stack: (error && error.stack) || null };
  }
}

/** Fetch remote artifact bytes as data URLs using fetch().
 *  Extension host_permissions for declared hosts bypass CORS.
 *  Returns {url, dataUrl} for successfully fetched artifacts; null on error. */
async function fetchImageDataUrls(urls) {
  const results = [];
  for (const url of urls) {
    try {
      const parsed = new URL(url);
      if (
        parsed.protocol !== 'https:' ||
        !['chatgpt.com', 'chat.openai.com', 'files.oaiusercontent.com'].includes(parsed.hostname)
      ) {
        results.push(null);
        continue;
      }
      const response = await fetch(url);
      if (!response.ok) {
        results.push(null);
        continue;
      }
      const blob = await response.blob();
      const dataUrl = await new Promise(function (resolve, reject) {
        const reader = new FileReader();
        reader.onload = function () {
          resolve(reader.result);
        };
        reader.onerror = function () {
          reject(reader.error);
        };
        reader.readAsDataURL(blob);
      });
      results.push({ url: url, dataUrl: dataUrl });
    } catch (_e) {
      results.push(null);
    }
  }
  return results;
}

/** Turns mounted under one conversation root, legacy or app-shell. */
function turnsOnRoot(root) {
  if (!root || !root.querySelectorAll) return [];
  var legacy = root.querySelectorAll('[data-turn-id]');
  if (legacy && legacy.length) {
    return orderCapturedTurns(
      Array.from(legacy)
        .map(function (section, index) {
          return extractTurn(section, index);
        })
        .filter(Boolean)
    );
  }
  var modern = modernMessageSections(root);
  return orderCapturedTurns(
    modern
      .map(function (section, index) {
        return extractTurn(section, index);
      })
      .filter(Boolean)
  );
}

function dedupeNamed(items, readName) {
  var seen = {};
  var out = [];
  for (var i = 0; i < items.length; i++) {
    var name = readName(items[i]);
    if (!name || seen[name]) continue;
    seen[name] = true;
    out.push(items[i]);
  }
  return out;
}

/**
 * Render the active conversation as a static HTML site.
 *
 * Inactive app-shell pages retained in the same document are not read.
 * Pass outputDir to write the tree. Retrieved file bytes become siblings
 * of the chat page; a file that did not arrive is named and the export
 * stays incomplete.
 */
function exportActiveSessionHtml(doc, options) {
  var opts = options || {};
  var site = opts.site || null;
  if (!site || typeof site.layoutStaticSite !== 'function') {
    return { ok: false, error: 'HTML exporter is unavailable.' };
  }
  // Active app-shell page only. A retained conversation shares this document
  // and must not be written into the static page.
  var root = activeConversationRoot(doc);
  if (!root) return { ok: false, error: 'Could not identify the active conversation. Try again after it loads.' };
  var turns = turnsOnRoot(root);
  if (!turns.length) return rateLimitPageError(doc) || { ok: false, error: 'No conversation found on this page.' };
  var saved = [];
  var missing = [];
  var partial = !!opts.partial;
  var renderedTurns = [];
  for (var i = 0; i < turns.length; i++) {
    var bound = site.bindRetrievedFiles(turns[i].markdown, opts.retrieved || []);
    renderedTurns.push({ role: turns[i].role, markdown: bound.markdown });
    saved = saved.concat(bound.saved);
    missing = missing.concat(bound.missing);
    if (bound.partial) partial = true;
  }
  var session = {
    id: opts.id || null,
    title: opts.title || 'Conversation',
    slug: opts.slug || 'conversation',
    projectId: opts.projectId || null,
    projectTitle: opts.projectTitle || null,
    projectSlug: opts.projectSlug || null,
    turns: renderedTurns,
    saved: dedupeNamed(saved, function (file) {
      return file.name;
    }),
    missing: dedupeNamed(missing, function (name) {
      return name;
    }),
    partial: partial,
  };
  var laid = site.layoutStaticSite([session]);
  if (opts.outputDir) site.writeStaticSite(opts.outputDir, laid);
  var page = null;
  for (var f = 0; f < laid.files.length; f++) {
    if (laid.files[f].role === 'chat') page = laid.files[f];
  }
  return {
    ok: true,
    html: page ? page.body : '',
    pagePath: page ? page.path : null,
    partial: session.partial,
    missing: session.missing,
    files: laid.files,
    title: session.title,
  };
}

export {
  ATTACHMENT_CHIP_SELECTORS,
  activeConversationRoot,
  appendPanelArtifacts,
  buildConversationMarkdown,
  clickConversationRetry,
  collectButtonDownloads,
  collectSidebarConversations,
  dedupeNamed,
  dismissViewerOverlay,
  downloadButtonsInPage,
  downloadNameFromUrl,
  escapeKeydownEvent,
  exportActiveSessionHtml,
  extractAttachments,
  extractAttachmentsDetailed,
  extractConversationTitle,
  extractImages,
  extractTurn,
  fetchConversationArtifacts,
  fetchConversationMetadata,
  fetchImageDataUrls,
  fetchSessionToken,
  filterButtonsAgainstPanel,
  findButtonsByScrolling,
  findCollapsedProjectRows,
  findConversationRetryControl,
  findHistoryRetryControl,
  findScrollContainer,
  findShowMoreControl,
  findSidebarScroller,
  foldForNameMatching,
  getConversationMarkdown,
  knownProjectName,
  largestCoverageGap,
  listArtifactPanelFiles,
  listSidebarConversations,
  nodeToMarkdown,
  orderCapturedTurns,
  parseTurnOrder,
  prefixPartialNotice,
  projectRowContainer,
  RATE_LIMIT_PAGE_ERROR,
  readModernPagination,
  resolveArtifactPanelFiles,
  resolveSandboxDownloadUrl,
  sandboxFilesFromMarkdown,
  sandboxPathsFromApiMessage,
  scanTurns,
  scrollToConversationStart,
  slugifyTitle,
  stripSidebarLabelSuffix,
  titleFromSidebarLink,
  turnsOnRoot,
  UNPREVIEWABLE_FORMATS,
  waitForArtifactPanel,
  waitForConversationReady,
};
