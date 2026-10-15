import { btnPause } from './options.mjs';
import { state } from './state.mjs';

/* ---------------------------------------------------------------------------
 * The export index.
 *
 * What a previous run accomplished used to be inferred from Chrome's download
 * history, and that inference cannot answer the question that matters: a
 * filename cannot say whether the conversation has MORE MESSAGES than when it
 * was saved. So a re-run either skipped a conversation that had grown, or
 * re-exported everything.
 *
 * The index answers it directly. Per conversation it keeps five scalars — the
 * conversation's own `update_time`, the id of its newest message, its message
 * count, the bytes written and the file count — and nothing else. Measured
 * before it was designed (see the commit message): 800 conversations is 210 743
 * bytes, 2% of the 10MB quota, written in 15ms; it survives a browser restart;
 * and the conversation mapping it is deliberately NOT caching is 4 661 057 bytes
 * for a single thread.
 *
 * Three properties are load-bearing and each has a test:
 *   - absence of the API reads as "no index", never as a throw (without the
 *     `storage` permission `chrome.storage` is undefined, not a failing call);
 *   - a write is only reported as stored if it actually stored, because quota
 *     failure arrives through `runtime.lastError` and an unchecked write looks
 *     exactly like success;
 *   - an unreadable answer is never grounds for skipping a conversation.
 * ------------------------------------------------------------------------- */

var INDEX_KEY = 'c2mExportIndex';
/** One paused or running batch. Ids, addresses and titles only — never the
 *  message text. The files on disk and the export index stay the authority
 *  for what already landed; this record is how a run continues days later. */
var BATCH_JOB_KEY = 'c2mBatchJob';
var BATCH_JOB_PREFIX = BATCH_JOB_KEY + ':';

/** Deliberately far below the 10MB quota. The index is a convenience; the files
 *  on disk remain the source of truth, so it may be trimmed but must never grow
 *  until Chrome refuses writes for the whole extension. */
var INDEX_BYTE_BUDGET = 1048576;

/** The storage area, or null when the permission is absent. Never throws. */
function storageArea() {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return null;
  return chrome.storage.local;
}

/** The fields a resumed batch needs. Anything else on the sidebar row,
 *  including message text a caller might have attached, is dropped. */
function conversationJobRecord(conv) {
  var source = conv || {};
  return {
    id: source.id || null,
    href: source.href || null,
    title: source.title || null,
    slug: source.slug || null,
    projectId: source.projectId || null,
    projectTitle: source.projectTitle || null,
  };
}

function writeBatchJob(job) {
  return new Promise(function (resolve) {
    var area = storageArea();
    if (!area || typeof area.set !== 'function') {
      resolve({ ok: false, error: 'no storage' });
      return;
    }
    var payload = {};
    payload[BATCH_JOB_KEY] = job;
    if (job && job.jobId && job.status !== 'done') {
      payload[BATCH_JOB_PREFIX + job.jobId] = job;
    }
    try {
      area.set(payload, function () {
        var err = chrome.runtime && chrome.runtime.lastError;
        if (err) {
          resolve({ ok: false, error: err.message });
          return;
        }
        if (job && job.jobId && job.status === 'done' && typeof area.remove === 'function') {
          area.remove(BATCH_JOB_PREFIX + job.jobId, function () {
            var removalError = chrome.runtime && chrome.runtime.lastError;
            resolve(removalError ? { ok: false, error: removalError.message } : { ok: true });
          });
        } else {
          resolve({ ok: true });
        }
      });
    } catch (err) {
      resolve({ ok: false, error: (err && err.message) || String(err) });
    }
  });
}

function readBatchJob(projectId) {
  return new Promise(function (resolve) {
    var area = storageArea();
    if (!area || typeof area.get !== 'function') {
      resolve(null);
      return;
    }
    try {
      area.get(null, function (data) {
        if (chrome.runtime && chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        var jobs = [];
        for (var key of Object.keys(data || {})) {
          if (key.indexOf(BATCH_JOB_PREFIX) !== 0) continue;
          var candidate = data[key];
          if (!candidate || !Array.isArray(candidate.conversations) || candidate.status === 'done') continue;
          if (projectId !== undefined && (candidate.projectId || null) !== projectId) continue;
          jobs.push(candidate);
        }
        jobs.sort(function (a, b) {
          return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
        });
        if (jobs.length) {
          resolve(jobs[0]);
          return;
        }
        // Older releases stored only one job under the unscoped key. The
        // second read also supports small Chrome shims that lack get(null).
        area.get(BATCH_JOB_KEY, function (legacyData) {
          var legacy = legacyData && legacyData[BATCH_JOB_KEY];
          var legacyScope = legacy && legacy.projectId !== undefined ? legacy.projectId : null;
          if (legacy && legacy.projectId === undefined && Array.isArray(legacy.conversations)) {
            for (var row of legacy.conversations) {
              if (row.projectId) {
                legacyScope = row.projectId;
                break;
              }
            }
          }
          if (legacy && Array.isArray(legacy.conversations) && (projectId === undefined || legacyScope === projectId)) {
            resolve(legacy);
          } else {
            resolve(null);
          }
        });
      });
    } catch (_e) {
      resolve(null);
    }
  });
}

/** Union a saved backup with a fresh sidebar walk.
 *
 *  Saved rows stay, in their order, even when this sidebar no longer shows
 *  them. A chat that exists only on the sidebar is appended. Dropping a saved
 *  row would lose a chat the user paused on; an extra sidebar chat costs one
 *  more export. The same id is kept once. `added` is how many sidebar rows
 *  were not already in the saved list. */
function mergeBackupConversations(saved, discovered) {
  var out = [];
  var seen = Object.create(null);
  function keyOf(row) {
    if (row && row.id) return 'id:' + row.id;
    if (row && row.href) return 'href:' + row.href;
    return '';
  }
  function add(row) {
    var record = conversationJobRecord(row);
    var key = keyOf(record);
    if (!key || seen[key]) return false;
    seen[key] = true;
    out.push(record);
    return true;
  }
  var base = Array.isArray(saved) ? saved : [];
  var extra = Array.isArray(discovered) ? discovered : [];
  for (var i = 0; i < base.length; i++) add(base[i]);
  var added = 0;
  for (var j = 0; j < extra.length; j++) {
    if (add(extra[j])) added += 1;
  }
  return { conversations: out, added: added };
}

async function readSidebarConversations(tabId) {
  await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['content.js'] });
  var listResult = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: async function () {
      // Stop during the history Retry wait reads this flag. The walk sleeps
      // in one-second slices, so the flag has to exist before the first slice.
      if (typeof window !== 'undefined') {
        window.__c2mScan = window.__c2mScan || { cancelled: false, captured: 0, observed: 0, elapsedMs: 0 };
      }
      // Scroll the virtualized sidebar so every row mounts. The one-frame
      // reader is the fallback only: it can return a subset, and a subset
      // exported as "the whole Project" is invisible to the user.
      if (typeof collectSidebarConversations === 'function') {
        return await collectSidebarConversations();
      }
      if (typeof listSidebarConversations === 'function') {
        return { conversations: listSidebarConversations(), complete: false, reason: 'no-collector' };
      }
      return { conversations: [], complete: false, reason: 'no-collector' };
    },
  });
  var listed = listResult?.[0]?.result || {};
  return {
    conversations: (listed && listed.conversations) || [],
    complete: !!(listed && listed.complete),
    reason: (listed && listed.reason) || 'unknown',
  };
}

async function rememberBatchJob(job) {
  state.activeBatchJob = job;
  var stored = await writeBatchJob(job);
  state.batchJobStored = stored.ok;
  if (state.batchRunActive && state.batchJobStored && btnPause) btnPause.classList.add('visible');
  return stored;
}

/** The panel document is going away. The loop dies with it. A running job has
 *  to be marked paused here, or the only copy left says the run is still going
 *  and the next open has to guess. A finished job stays finished: closing the
 *  panel after success must not offer a resume of work that already ended. */
function handlePanelHide() {
  if (!state.batchJobStored || !state.activeBatchJob || state.activeBatchJob.status === 'done') return;
  state.batchPaused = true;
  state.activeBatchJob.status = 'paused';
  state.activeBatchJob.updatedAt = new Date().toISOString();
  writeBatchJob(state.activeBatchJob);
}

/** Read the whole index. An unreadable or corrupt store reads as empty, which
 *  costs a re-export and never a silent skip. */
function readExportIndex() {
  return new Promise(function (resolve) {
    var area = storageArea();
    if (!area) {
      resolve({});
      return;
    }
    try {
      area.get([INDEX_KEY], function (items) {
        var value = items && items[INDEX_KEY];
        if (!value || typeof value !== 'object') {
          resolve({});
          return;
        }
        resolve(value);
      });
    } catch (_e) {
      resolve({});
    }
  });
}

/** Record one conversation. Resolves true only when the write actually landed.
 *
 *  Only the decision inputs are kept: passing a mapping, markdown or title here
 *  stores none of them. That is asserted by a test, because "store just the
 *  scalars" is a rule that erodes the moment someone adds a convenient field.
 */
function recordExportedConversation(conversationId, record) {
  return new Promise(function (resolve) {
    var area = storageArea();
    if (!area || !conversationId) {
      resolve(false);
      return;
    }
    readExportIndex().then(function (index) {
      var next = Object.assign({}, index);
      var row = {
        updateTime: typeof record.updateTime === 'number' ? record.updateTime : null,
        currentNode: record.currentNode ? String(record.currentNode) : null,
        messageCount: typeof record.messageCount === 'number' ? record.messageCount : null,
        bytes: typeof record.bytes === 'number' ? record.bytes : null,
        files: typeof record.files === 'number' ? record.files : 0,
        at: typeof record.at === 'number' ? record.at : null,
      };
      next[String(conversationId)] = row;

      var payload = {};
      payload[INDEX_KEY] = next;
      var size = 0;
      try {
        size = new TextEncoder().encode(JSON.stringify(payload)).length;
      } catch (_e) {
        size = 0;
      }
      if (size > INDEX_BYTE_BUDGET) {
        resolve(false);
        return;
      }

      try {
        area.set(payload, function () {
          // The quota is reported HERE, not thrown. Reading it is the difference
          // between an index that stops recording loudly and one that stops
          // recording silently.
          var failed = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError;
          resolve(!failed);
        });
      } catch (_e) {
        resolve(false);
      }
    });
  });
}

/** Compare a conversation's live metadata against what the index remembers.
 *
 *  Verdicts: 'new' (never exported), 'unchanged' (skip), 'grown' (re-export),
 *  'unknown' (metadata unreadable). Unknown is not unchanged. The batch exports
 *  it when no finished file is on disk. A finished file stays closed for a
 *  later run that can read the metadata, and this function does not record
 *  that file as unchanged.
 *
 *  A message count that went DOWN also returns 'grown': a switched branch or a
 *  deleted turn means the saved file no longer matches the conversation, and
 *  "changed" is the useful distinction, not the direction of the change.
 */
function classifyAgainstIndex(index, conversationId, live) {
  var row = index ? index[String(conversationId)] : null;
  if (!row) return { verdict: 'new', stored: null };
  if (!live) return { verdict: 'unknown', stored: row };
  if (live.updateTime == null && live.currentNode == null && !(live.messageCount > 0)) {
    return { verdict: 'unknown', stored: row };
  }

  var sameNode =
    row.currentNode != null && live.currentNode != null
      ? String(row.currentNode) === String(live.currentNode)
      : row.currentNode == null && live.currentNode == null;
  var sameTime =
    row.updateTime != null && live.updateTime != null
      ? Number(row.updateTime) === Number(live.updateTime)
      : row.updateTime == null && live.updateTime == null;
  var sameCount =
    row.messageCount != null && live.messageCount != null
      ? Number(row.messageCount) === Number(live.messageCount)
      : true;

  if (sameNode && sameTime && sameCount) return { verdict: 'unchanged', stored: row };
  return { verdict: 'grown', stored: row };
}

/** Resume a batch by reading prior download paths — the fallback when no index
 *  is available, and still a cross-check on the files actually present. */

export {
  BATCH_JOB_KEY,
  BATCH_JOB_PREFIX,
  classifyAgainstIndex,
  conversationJobRecord,
  handlePanelHide,
  INDEX_BYTE_BUDGET,
  INDEX_KEY,
  mergeBackupConversations,
  readBatchJob,
  readExportIndex,
  readSidebarConversations,
  recordExportedConversation,
  rememberBatchJob,
  storageArea,
  writeBatchJob,
};
