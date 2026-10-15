(() => {
  var __defProp = Object.defineProperty;
  var __returnValue = (v) => v;
  function __exportSetter(name, newValue) {
    this[name] = __returnValue.bind(null, newValue);
  }
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, {
        get: all[name],
        enumerable: true,
        configurable: true,
        set: __exportSetter.bind(all, name)
      });
  };

  // src/popup/controls.mjs
  var exports_controls = {};
  __export(exports_controls, {
    BATCH_JOB_KEY: () => BATCH_JOB_KEY,
    ID_MARKER: () => ID_MARKER,
    INDEX_BYTE_BUDGET: () => INDEX_BYTE_BUDGET,
    INDEX_KEY: () => INDEX_KEY,
    LAST_ERROR_KEY: () => LAST_ERROR_KEY,
    MD_WRITE_TIMEOUT_MS: () => MD_WRITE_TIMEOUT_MS,
    OPENAI_CALLS_PER_MINUTE: () => OPENAI_CALLS_PER_MINUTE,
    OPENAI_CALL_WINDOW_MS: () => OPENAI_CALL_WINDOW_MS,
    OPENAI_FILE_LOOKUP_CALLS: () => OPENAI_FILE_LOOKUP_CALLS,
    OPENAI_METADATA_CALLS: () => OPENAI_METADATA_CALLS,
    OPENAI_PAGE_LOAD_CALLS: () => OPENAI_PAGE_LOAD_CALLS,
    RATE_LIMIT_RETRY_CLICKS: () => RATE_LIMIT_RETRY_CLICKS,
    RATE_LIMIT_RETRY_WAIT_MS: () => RATE_LIMIT_RETRY_WAIT_MS,
    ZIP_BYTE_BUDGET: () => ZIP_BYTE_BUDGET,
    ZIP_WRITE_TIMEOUT_MS: () => ZIP_WRITE_TIMEOUT_MS,
    addZipEntry: () => addZipEntry,
    artifactFilename: () => artifactFilename,
    backoffDelayMs: () => backoffDelayMs,
    batchMdFilename: () => batchMdFilename,
    batchRootPath: () => batchRootPath,
    buildMdFilename: () => buildMdFilename,
    buildSaveStatus: () => buildSaveStatus,
    bytesToBase64DataUrl: () => bytesToBase64DataUrl,
    bytesToDownloadUrl: () => bytesToDownloadUrl,
    candidateExportNames: () => candidateExportNames,
    classifyAgainstIndex: () => classifyAgainstIndex,
    classifyBatchFailure: () => classifyBatchFailure,
    conversationFolderFromPath: () => conversationFolderFromPath,
    conversationFolderPath: () => conversationFolderPath,
    conversationIdFromLocation: () => conversationIdFromLocation,
    conversationJobRecord: () => conversationJobRecord,
    createCallQuota: () => createCallQuota,
    downloadOne: () => downloadOne,
    downloadStaticSite: () => downloadStaticSite,
    executeBatch: () => executeBatch,
    exportPath: () => exportPath,
    filterPendingConversations: () => filterPendingConversations,
    foldExceptId: () => foldExceptId,
    formatBatchProgress: () => formatBatchProgress,
    formatExportTimestamp: () => formatExportTimestamp,
    isDownloadableFileUrl: () => isDownloadableFileUrl,
    mdDownloadPath: () => mdDownloadPath,
    mdStem: () => mdStem,
    mergeBackupConversations: () => mergeBackupConversations,
    noteExportDownload: () => noteExportDownload,
    parseArtifactRefs: () => parseArtifactRefs,
    parseFileRefs: () => parseFileRefs,
    parseImageRefs: () => parseImageRefs,
    projectIdFromLocation: () => projectIdFromLocation,
    readBatchJob: () => readBatchJob,
    readExportIndex: () => readExportIndex,
    recordExportedConversation: () => recordExportedConversation,
    rememberBatchJob: () => rememberBatchJob,
    reportFailure: () => reportFailure,
    resumeSavedBatch: () => resumeSavedBatch,
    revealExportFolder: () => revealExportFolder,
    runBatchExport: () => runBatchExport,
    sanitizeFilenamePart: () => sanitizeFilenamePart,
    sanitizeLogText: () => sanitizeLogText,
    saveConversationExport: () => saveConversationExport,
    searchCompletedDownloadPaths: () => searchCompletedDownloadPaths,
    showSavedBatch: () => showSavedBatch,
    splitFilenameExtension: () => splitFilenameExtension,
    stampsInPaths: () => stampsInPaths,
    syncBatchOptions: () => syncBatchOptions,
    waitForDownloadComplete: () => waitForDownloadComplete,
    waitForLoadedConversation: () => waitForLoadedConversation,
    waitWhilePaused: () => waitWhilePaused,
    writeBatchJob: () => writeBatchJob
  });

  // src/popup/options.mjs
  var btn = document.getElementById("btn-copy");
  var btnCancel = document.getElementById("btn-cancel");
  var btnPause = document.getElementById("btn-pause");
  var status = document.getElementById("status");
  var chkImages = document.getElementById("chk-images");
  var chkBatch = document.getElementById("chk-batch");
  var chkHtml = document.getElementById("chk-html");
  var batchWarning = document.getElementById("batch-warning");
  var btnShowFolder = document.getElementById("btn-show-folder");
  (function showVersion() {
    const el = document.getElementById("version");
    if (!el)
      return;
    try {
      const manifest = typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.getManifest === "function" ? chrome.runtime.getManifest() : null;
      if (manifest && manifest.version)
        el.textContent = "v" + manifest.version;
    } catch (_e) {}
  })();
  function exportButtonLabel() {
    var saveMd = !!(chkImages && chkImages.checked);
    var saveHtml = !!(chkHtml && chkHtml.checked);
    if (chkBatch && chkBatch.checked && (saveMd || saveHtml))
      return "Sync backup";
    if (saveMd && saveHtml)
      return "Save Markdown and HTML";
    if (saveHtml)
      return "Save HTML site";
    if (saveMd)
      return "Save Markdown";
    return "Copy as Markdown";
  }
  function refreshExportButtonLabel() {
    if (!btn || btn.disabled)
      return;
    btn.textContent = exportButtonLabel();
  }
  function syncBatchOptions() {
    var batchOn = !!(chkBatch && chkBatch.checked);
    var htmlOn = !!(chkHtml && chkHtml.checked);
    if (batchWarning)
      batchWarning.classList.toggle("visible", batchOn);
    if (chkImages) {
      var lockMarkdown = batchOn && !htmlOn;
      if (lockMarkdown)
        chkImages.checked = true;
      chkImages.disabled = lockMarkdown;
    }
    refreshExportButtonLabel();
  }
  if (chkBatch && typeof chkBatch.addEventListener === "function") {
    chkBatch.addEventListener("change", syncBatchOptions);
  }
  if (chkHtml && typeof chkHtml.addEventListener === "function") {
    chkHtml.addEventListener("change", syncBatchOptions);
  }
  if (chkImages && typeof chkImages.addEventListener === "function") {
    chkImages.addEventListener("change", refreshExportButtonLabel);
  }
  refreshExportButtonLabel();
  function showStatus(type, message) {
    status.className = type;
    status.textContent = message;
  }

  // src/popup/paths.mjs
  function markdownHttpRefs(md) {
    const refs = [];
    const re = /(!?)\[((?:\\.|[^\]])*)\]\((?:<(https?:\/\/[^>\s]+)>|(https?:\/\/[^)\s]+))\)/g;
    let match;
    while ((match = re.exec(md)) !== null) {
      refs.push({
        image: match[1] === "!",
        label: match[2].replace(/\\([\\\[\]])/g, "$1"),
        url: match[3] || match[4]
      });
    }
    return refs;
  }
  function parseImageRefs(md) {
    const seen = new Set;
    const refs = [];
    for (const ref of markdownHttpRefs(md)) {
      if (!ref.image || seen.has(ref.url))
        continue;
      let parsed;
      try {
        parsed = new URL(ref.url);
      } catch (_e) {
        continue;
      }
      if (parsed.protocol === "https:" && ["chatgpt.com", "chat.openai.com", "files.oaiusercontent.com"].includes(parsed.hostname)) {
        seen.add(ref.url);
        refs.push({ url: ref.url, label: ref.label, kind: "image" });
      }
    }
    return refs;
  }
  function parseFileRefs(md) {
    const seen = new Set;
    const refs = [];
    for (const ref of markdownHttpRefs(md)) {
      if (!ref.image && !seen.has(ref.url) && isDownloadableFileUrl(ref.url)) {
        seen.add(ref.url);
        refs.push({ url: ref.url, label: ref.label, kind: "file" });
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
      if (parsed.protocol !== "https:")
        return false;
      if (parsed.hostname === "files.oaiusercontent.com")
        return true;
      if (parsed.hostname === "chatgpt.com" || parsed.hostname === "chat.openai.com") {
        return parsed.pathname.includes("/files/") || parsed.pathname.includes("/estuary/");
      }
      return false;
    } catch (_e) {
      return false;
    }
  }
  function exportPath(slug, filename) {
    return slug ? "chatgpt-export/" + slug + "/" + filename : "chatgpt-export/" + filename;
  }
  function sanitizeFilenamePart(value) {
    if (!value)
      return "";
    var cleaned = String(value).replace(/[\\/]+/g, "-").replace(/[\x00-\x1f<>:"|?*]+/g, "").replace(/\s+/g, " ").trim().replace(/^\.+/, "").replace(/\.+$/, "");
    return cleaned.slice(0, 80);
  }
  function splitFilenameExtension(name) {
    var match = String(name || "").match(/^(.*?)(\.[A-Za-z0-9]{1,8})$/);
    if (!match)
      return { stem: String(name || ""), ext: "" };
    return { stem: match[1], ext: match[2].toLowerCase() };
  }
  function artifactFilename(url, label, index, slug, kind) {
    var ext = kind === "image" ? "png" : "bin";
    var originalStem = "";
    var fromLabel = splitFilenameExtension(sanitizeFilenamePart(label));
    if (fromLabel.ext) {
      ext = fromLabel.ext.replace(/^\./, "");
      originalStem = fromLabel.stem;
    } else {
      try {
        var segments = new URL(url).pathname.split("/");
        var last = sanitizeFilenamePart(decodeURIComponent(segments[segments.length - 1] || ""));
        var fromPath = splitFilenameExtension(last);
        if (fromPath.ext) {
          ext = fromPath.ext.replace(/^\./, "");
          originalStem = fromPath.stem;
        }
      } catch (_e) {}
    }
    if (kind === "image") {
      ext = ext.replace(/^jpe?g$/i, "jpg");
      if (!/^(png|jpg|gif|webp|svg|bmp)$/i.test(ext))
        ext = "png";
      originalStem = "";
    }
    var prefix = slug ? slug + "-" : "";
    var counter = String(index + 1).padStart(3, "0");
    if (originalStem) {
      return prefix + counter + "-" + originalStem + "." + ext;
    }
    var stem = kind === "image" ? "image" : "file";
    return prefix + stem + "_" + counter + "." + ext;
  }
  var ID_MARKER = "~";
  function foldExceptId(key) {
    var at = String(key).indexOf(ID_MARKER);
    if (at < 0)
      return String(key).toLowerCase();
    return String(key).slice(0, at).toLowerCase() + String(key).slice(at);
  }
  var EXPORT_STAMP_NONCE = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2).padEnd(8, "0");
  var exportStampSequence = 0;
  function formatExportTimestamp(date) {
    var d = date || new Date;
    var pad = function(n) {
      return String(n).padStart(2, "0");
    };
    return String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes()) + "-" + EXPORT_STAMP_NONCE + "-" + (++exportStampSequence).toString(36);
  }
  function buildMdFilename(slug, useTimestamp, now, fixedStamp) {
    var base = slug || "conversation";
    if (useTimestamp) {
      var stamp = fixedStamp || formatExportTimestamp(now);
      return base + "--" + stamp + ".md";
    }
    return base + ".md";
  }
  function formatBatchProgress(index, total, title) {
    var position = index + 1;
    var label = title ? " — " + title : "";
    return position + " of " + total + label;
  }
  function batchRootPath(projectSlug) {
    return projectSlug ? "chatgpt-export/" + projectSlug : "chatgpt-export";
  }
  function conversationFolderPath(convSlug, projectSlug) {
    var root = batchRootPath(projectSlug);
    return convSlug ? root + "/" + convSlug : root;
  }
  function batchMdFilename(convSlug, convId, useTimestamp, stamp, isPartial) {
    var base = convSlug || convId || "conversation";
    if (isPartial)
      base += "-partial";
    var parts = base;
    if (useTimestamp)
      parts += "--" + (stamp || formatExportTimestamp());
    if (convId)
      parts += ID_MARKER + convId;
    return parts + ".md";
  }
  function mdDownloadPath(convSlug, projectSlug, useTimestamp, stamp, convId) {
    var mdName = batchMdFilename(convSlug, convId, useTimestamp, stamp);
    return conversationFolderPath(convSlug, projectSlug) + "/" + mdName;
  }
  function mdStem(downloadPath) {
    var normalized = String(downloadPath || "").replace(/\\/g, "/");
    var file = normalized.split("/").filter(Boolean).pop() || "";
    return file.replace(/\.md$/i, "");
  }
  function conversationFolderFromPath(downloadPath) {
    var normalized = String(downloadPath || "").replace(/\\/g, "/");
    var anchor = normalized.indexOf("chatgpt-export/");
    if (anchor > 0)
      normalized = normalized.slice(anchor);
    var segments = normalized.split("/").filter(Boolean);
    segments.pop();
    return segments.join("/");
  }
  function candidateExportNames(conv, projectSlug, stamps) {
    var slug = conv.slug || conv.id || "conversation";
    var folder = conversationFolderPath(slug, projectSlug).toLowerCase();
    var prefix = folder + "/" + String(slug).toLowerCase();
    var owned = [];
    var legacy = [prefix];
    var list = stamps || [];
    if (conv.id) {
      var id = String(conv.id);
      owned.push(prefix + ID_MARKER + id);
      for (var s = 0;s < list.length; s++) {
        owned.push(prefix + "--" + list[s] + ID_MARKER + id);
      }
    }
    return { owned, legacy };
  }
  function stampsInPaths(paths) {
    var stamps = new Set;
    for (var i = 0;i < paths.length; i++) {
      var fields = mdStem(paths[i]).split(/--|~/);
      for (var f = 0;f < fields.length; f++) {
        if (/^\d{8}-\d{4}(?:-[a-z0-9-]{8,36}-[a-z0-9]+)?$/.test(fields[f]))
          stamps.add(fields[f]);
      }
    }
    return Array.from(stamps);
  }
  function filterPendingConversations(conversations, completedPaths, projectSlug) {
    var paths = [];
    if (completedPaths && typeof completedPaths.forEach === "function") {
      completedPaths.forEach(function(item) {
        paths.push(item);
      });
    }
    var landed = new Set;
    for (var i = 0;i < paths.length; i++) {
      var name = mdStem(paths[i]);
      var folder = conversationFolderFromPath(paths[i]);
      if (name)
        landed.add(foldExceptId(folder + "/" + name));
    }
    var stamps = stampsInPaths(paths);
    var claimants = Object.create(null);
    for (var c = 0;c < conversations.length; c++) {
      var all = candidateExportNames(conversations[c], projectSlug, stamps);
      var every = all.owned.concat(all.legacy);
      var seen = new Set;
      for (var n = 0;n < every.length; n++) {
        if (seen.has(every[n]))
          continue;
        seen.add(every[n]);
        claimants[every[n]] = (claimants[every[n]] || 0) + 1;
      }
    }
    return conversations.filter(function(conv) {
      var names = candidateExportNames(conv, projectSlug, stamps);
      var every = names.owned.concat(names.legacy);
      for (var a = 0;a < every.length; a++) {
        if (landed.has(every[a]) && claimants[every[a]] === 1)
          return false;
      }
      return true;
    });
  }

  // src/popup/state.mjs
  var state = {
    scanningTabId: null,
    progressTimer: null,
    batchCancelled: false,
    batchPaused: false,
    batchRunActive: false,
    activeBatchJob: null,
    batchJobStored: false,
    activeRunLog: null,
    activeRunLogOptions: null,
    lastExportDownloadId: null
  };

  // src/popup/storage.mjs
  var INDEX_KEY = "c2mExportIndex";
  var BATCH_JOB_KEY = "c2mBatchJob";
  var BATCH_JOB_PREFIX = BATCH_JOB_KEY + ":";
  var INDEX_BYTE_BUDGET = 1048576;
  function storageArea() {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local)
      return null;
    return chrome.storage.local;
  }
  function conversationJobRecord(conv) {
    var source = conv || {};
    return {
      id: source.id || null,
      href: source.href || null,
      title: source.title || null,
      slug: source.slug || null,
      projectId: source.projectId || null,
      projectTitle: source.projectTitle || null
    };
  }
  function writeBatchJob(job) {
    return new Promise(function(resolve) {
      var area = storageArea();
      if (!area || typeof area.set !== "function") {
        resolve({ ok: false, error: "no storage" });
        return;
      }
      var payload = {};
      payload[BATCH_JOB_KEY] = job;
      if (job && job.jobId && job.status !== "done") {
        payload[BATCH_JOB_PREFIX + job.jobId] = job;
      }
      try {
        area.set(payload, function() {
          var err = chrome.runtime && chrome.runtime.lastError;
          if (err) {
            resolve({ ok: false, error: err.message });
            return;
          }
          if (job && job.jobId && job.status === "done" && typeof area.remove === "function") {
            area.remove(BATCH_JOB_PREFIX + job.jobId, function() {
              var removalError = chrome.runtime && chrome.runtime.lastError;
              resolve(removalError ? { ok: false, error: removalError.message } : { ok: true });
            });
          } else {
            resolve({ ok: true });
          }
        });
      } catch (err) {
        resolve({ ok: false, error: err && err.message || String(err) });
      }
    });
  }
  function readBatchJob(projectId) {
    return new Promise(function(resolve) {
      var area = storageArea();
      if (!area || typeof area.get !== "function") {
        resolve(null);
        return;
      }
      try {
        area.get(null, function(data) {
          if (chrome.runtime && chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          var jobs = [];
          for (var key of Object.keys(data || {})) {
            if (key.indexOf(BATCH_JOB_PREFIX) !== 0)
              continue;
            var candidate = data[key];
            if (!candidate || !Array.isArray(candidate.conversations) || candidate.status === "done")
              continue;
            if (projectId !== undefined && (candidate.projectId || null) !== projectId)
              continue;
            jobs.push(candidate);
          }
          jobs.sort(function(a, b) {
            return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
          });
          if (jobs.length) {
            resolve(jobs[0]);
            return;
          }
          area.get(BATCH_JOB_KEY, function(legacyData) {
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
  function mergeBackupConversations(saved, discovered) {
    var out = [];
    var seen = Object.create(null);
    function keyOf(row) {
      if (row && row.id)
        return "id:" + row.id;
      if (row && row.href)
        return "href:" + row.href;
      return "";
    }
    function add(row) {
      var record = conversationJobRecord(row);
      var key = keyOf(record);
      if (!key || seen[key])
        return false;
      seen[key] = true;
      out.push(record);
      return true;
    }
    var base = Array.isArray(saved) ? saved : [];
    var extra = Array.isArray(discovered) ? discovered : [];
    for (var i = 0;i < base.length; i++)
      add(base[i]);
    var added = 0;
    for (var j = 0;j < extra.length; j++) {
      if (add(extra[j]))
        added += 1;
    }
    return { conversations: out, added };
  }
  async function readSidebarConversations(tabId) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    var listResult = await chrome.scripting.executeScript({
      target: { tabId },
      func: async function() {
        if (typeof window !== "undefined") {
          window.__c2mScan = window.__c2mScan || { cancelled: false, captured: 0, observed: 0, elapsedMs: 0 };
        }
        if (typeof collectSidebarConversations === "function") {
          return await collectSidebarConversations();
        }
        if (typeof listSidebarConversations === "function") {
          return { conversations: listSidebarConversations(), complete: false, reason: "no-collector" };
        }
        return { conversations: [], complete: false, reason: "no-collector" };
      }
    });
    var listed = listResult?.[0]?.result || {};
    return {
      conversations: listed && listed.conversations || [],
      complete: !!(listed && listed.complete),
      reason: listed && listed.reason || "unknown"
    };
  }
  async function rememberBatchJob(job) {
    state.activeBatchJob = job;
    var stored = await writeBatchJob(job);
    state.batchJobStored = stored.ok;
    if (state.batchRunActive && state.batchJobStored && btnPause)
      btnPause.classList.add("visible");
    return stored;
  }
  function handlePanelHide() {
    if (!state.batchJobStored || !state.activeBatchJob || state.activeBatchJob.status === "done")
      return;
    state.batchPaused = true;
    state.activeBatchJob.status = "paused";
    state.activeBatchJob.updatedAt = new Date().toISOString();
    writeBatchJob(state.activeBatchJob);
  }
  function readExportIndex() {
    return new Promise(function(resolve) {
      var area = storageArea();
      if (!area) {
        resolve({});
        return;
      }
      try {
        area.get([INDEX_KEY], function(items) {
          var value = items && items[INDEX_KEY];
          if (!value || typeof value !== "object") {
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
  function recordExportedConversation(conversationId, record) {
    return new Promise(function(resolve) {
      var area = storageArea();
      if (!area || !conversationId) {
        resolve(false);
        return;
      }
      readExportIndex().then(function(index) {
        var next = Object.assign({}, index);
        var row = {
          updateTime: typeof record.updateTime === "number" ? record.updateTime : null,
          currentNode: record.currentNode ? String(record.currentNode) : null,
          messageCount: typeof record.messageCount === "number" ? record.messageCount : null,
          bytes: typeof record.bytes === "number" ? record.bytes : null,
          files: typeof record.files === "number" ? record.files : 0,
          at: typeof record.at === "number" ? record.at : null
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
          area.set(payload, function() {
            var failed = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.lastError;
            resolve(!failed);
          });
        } catch (_e) {
          resolve(false);
        }
      });
    });
  }
  function classifyAgainstIndex(index, conversationId, live) {
    var row = index ? index[String(conversationId)] : null;
    if (!row)
      return { verdict: "new", stored: null };
    if (!live)
      return { verdict: "unknown", stored: row };
    if (live.updateTime == null && live.currentNode == null && !(live.messageCount > 0)) {
      return { verdict: "unknown", stored: row };
    }
    var sameNode = row.currentNode != null && live.currentNode != null ? String(row.currentNode) === String(live.currentNode) : row.currentNode == null && live.currentNode == null;
    var sameTime = row.updateTime != null && live.updateTime != null ? Number(row.updateTime) === Number(live.updateTime) : row.updateTime == null && live.updateTime == null;
    var sameCount = row.messageCount != null && live.messageCount != null ? Number(row.messageCount) === Number(live.messageCount) : true;
    if (sameNode && sameTime && sameCount)
      return { verdict: "unchanged", stored: row };
    return { verdict: "grown", stored: row };
  }

  // src/popup/logging.mjs
  var LAST_ERROR_KEY = "c2mLastError";
  function reportFailure(phase, err) {
    var message = err && err.message || String(err) || "unknown error";
    showStatus("error", message);
    var detail = {
      phase: sanitizeLogText(phase),
      message: sanitizeLogText(message),
      stack: err && err.stack ? sanitizeLogText(err.stack) : null,
      at: new Date().toISOString()
    };
    if (typeof console !== "undefined" && console.error) {
      console.error("[conversation-to-markdown] " + phase + " failed:", detail);
    }
    try {
      var area = storageArea();
      if (area)
        area.set({ [LAST_ERROR_KEY]: detail }, function() {
          chrome.runtime.lastError;
        });
    } catch (_e) {}
  }
  function buildSaveStatus(parts) {
    var saved = parts.saved || {};
    var refs = parts.refs || [];
    var counts = parts.lines + " lines · " + parts.words + " words";
    if (!saved.mdOk) {
      return {
        type: "error",
        text: "Not saved: " + (saved.mdError || "the browser refused the write") + `
` + (refs.length > 0 ? saved.dlOk + "/" + refs.length + " files were fetched. " : "") + "Nothing was written for this conversation — run it again."
      };
    }
    var incomplete = !!parts.partialSuffix || saved.dlOk < refs.length;
    var head = (incomplete ? "⚠ Saved incompletely" : "✓ Saved") + " " + counts + `
` + saved.mdName;
    if (refs.length === 0)
      return {
        type: incomplete ? "warning" : "success",
        text: head + (incomplete ? `
Re-run to complete it.` : "")
      };
    if (saved.dlOk === refs.length) {
      return {
        type: incomplete ? "warning" : "success",
        text: head + " + " + saved.dlOk + "/" + refs.length + " files" + (incomplete ? `
Re-run to complete it.` : "")
      };
    }
    var reason = saved.dlErrors && saved.dlErrors.length > 0 ? " (" + saved.dlErrors[0] + ")" : "";
    return {
      type: "warning",
      text: head + `
` + saved.dlOk + "/" + refs.length + " files fetched" + reason + " — missing files remain as links that expire. Re-run to repair."
    };
  }
  function noteExportDownload(id) {
    if (id !== undefined && id !== null)
      state.lastExportDownloadId = id;
  }
  function revealExportFolder() {
    if (typeof chrome === "undefined" || !chrome.downloads)
      return;
    if (state.lastExportDownloadId !== null && typeof chrome.downloads.show === "function") {
      chrome.downloads.show(state.lastExportDownloadId);
      return;
    }
    if (typeof chrome.downloads.showDefaultFolder === "function")
      chrome.downloads.showDefaultFolder();
  }
  function markExportFolderVisible() {
    if (!btnShowFolder || btnShowFolder.id !== "btn-show-folder")
      return;
    if (btnShowFolder.classList)
      btnShowFolder.classList.add("visible");
  }
  if (btnShowFolder && btnShowFolder !== status && typeof btnShowFolder.addEventListener === "function") {
    btnShowFolder.addEventListener("click", function() {
      revealExportFolder();
    });
  }
  function sanitizeLogText(value) {
    var text = String(value == null ? "" : value);
    text = text.replace(/https?:\/\/[^\s)'"<>]+/gi, "[url]");
    text = text.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
    text = text.replace(/((?:sig|token|access_token|authorization)=)[^&\s]+/gi, "$1[redacted]");
    if (text.length > 600)
      text = text.slice(0, 600);
    return text;
  }
  function createRunLog(kind, options) {
    var manifest = null;
    try {
      manifest = typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.getManifest === "function" ? chrome.runtime.getManifest() : null;
    } catch (_e) {
      manifest = null;
    }
    var opts = options || {};
    return {
      version: manifest && manifest.version || null,
      runId: opts.runId || formatExportTimestamp(),
      kind,
      startedAt: new Date().toISOString(),
      options: {
        saveMarkdown: !!opts.downloadImages,
        saveHtml: !!opts.downloadHtml
      },
      events: []
    };
  }
  function pushLogEvent(log, event) {
    if (!log)
      return;
    var source = event || {};
    log.events.push({
      at: new Date().toISOString(),
      level: source.level || "info",
      phase: sanitizeLogText(source.phase || ""),
      outcome: sanitizeLogText(source.outcome || ""),
      conversationId: source.conversationId ? sanitizeLogText(source.conversationId) : null,
      title: source.title ? sanitizeLogText(source.title) : null,
      message: source.message ? sanitizeLogText(source.message) : null,
      stack: source.stack ? sanitizeLogText(source.stack) : null,
      counts: source.counts || null
    });
  }
  function runLogJson(log) {
    return JSON.stringify({
      version: log.version,
      runId: log.runId,
      kind: log.kind,
      startedAt: log.startedAt,
      updatedAt: new Date().toISOString(),
      options: log.options,
      events: log.events
    }, null, 2);
  }
  async function flushRunLog(log, options) {
    if (!log)
      return { ok: false, error: "no log" };
    var body = runLogJson(log);
    var opts = options || {};
    var ok = true;
    var error = null;
    if (opts.htmlSiteDir && typeof writeStaticSite === "function") {
      try {
        writeStaticSite(opts.htmlSiteDir, {
          files: [{ path: "export-log.json", body, mime: "application/json", role: "log" }]
        });
      } catch (err) {
        ok = false;
        error = err && err.message || String(err);
      }
    }
    var canDownload = opts.downloadLog !== false && typeof chrome !== "undefined" && chrome.downloads && typeof chrome.downloads.download === "function";
    if (canDownload) {
      var handle = bytesToDownloadUrl(textToUtf8Bytes(body), "application/json");
      try {
        var write = await downloadOne(handle.url, "export-log.json", "chatgpt-export/logs/" + log.runId + ".json", opts.timeoutMs || 12000);
        if (write.ok && chrome.downloads.onChanged) {
          var written = await waitForDownloadComplete(write.downloadId, opts.timeoutMs || 12000);
          if (!written) {
            ok = false;
            error = error || "the log write did not complete";
          }
        } else if (!write.ok) {
          ok = false;
          error = write.error || error || "download rejected";
        }
      } catch (err) {
        ok = false;
        error = err && err.message || String(err);
      } finally {
        if (handle)
          handle.revoke(handle.url);
      }
    }
    return { ok, error };
  }
  function searchDownloadPaths(filenameRegex, accept) {
    return new Promise(function(resolve) {
      if (typeof chrome === "undefined" || !chrome.downloads || !chrome.downloads.search) {
        resolve(null);
        return;
      }
      chrome.downloads.search({ filenameRegex }, function(items) {
        var paths = [];
        if (items) {
          for (var i = 0;i < items.length; i++) {
            var item = items[i];
            if (!item || !item.filename)
              continue;
            if (item.exists === false)
              continue;
            if (item.state && item.state !== "complete")
              continue;
            if (accept(item.filename))
              paths.push(item.filename);
          }
        }
        resolve(paths);
      });
    });
  }
  function searchHtmlCompletePaths() {
    if (typeof htmlCompleteDirFromDownloadPath !== "function")
      return Promise.resolve(null);
    return new Promise(function(resolve) {
      if (typeof chrome === "undefined" || !chrome.downloads || !chrome.downloads.search) {
        resolve(null);
        return;
      }
      chrome.downloads.search({ filenameRegex: "chatgpt-export/html/.+/(index\\.html|export-complete\\.txt)$" }, function(items) {
        if (chrome.runtime && chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        var dirs = Object.create(null);
        for (var i = 0;i < (items || []).length; i++) {
          var item = items[i];
          if (!item || !item.filename)
            continue;
          var pageDir = htmlChatDirFromDownloadPath(item.filename);
          var markerDir = htmlCompleteDirFromDownloadPath(item.filename);
          var dir = pageDir || markerDir;
          if (!dir)
            continue;
          var row = dirs[dir] || (dirs[dir] = {});
          var field = pageDir ? "page" : "marker";
          if (!row[field] || typeof item.id === "number" && item.id > row[field].id)
            row[field] = item;
        }
        var complete = [];
        for (var dir in dirs) {
          var row = dirs[dir];
          if (row.page && row.marker && row.page.exists !== false && row.marker.exists !== false && row.page.state === "complete" && row.marker.state === "complete" && typeof row.page.id === "number" && typeof row.marker.id === "number" && row.marker.id > row.page.id) {
            complete.push(row.marker.filename);
          }
        }
        resolve(complete);
      });
    });
  }
  function searchHtmlPagePaths() {
    if (typeof htmlChatDirFromDownloadPath !== "function")
      return Promise.resolve(null);
    return searchDownloadPaths("chatgpt-export/html/.+/index\\.html$", htmlChatDirFromDownloadPath);
  }
  function htmlDirForConversation(conv) {
    if (typeof sessionDirectory !== "function" || !conv)
      return null;
    return sessionDirectory({
      id: conv.id || null,
      title: conv.title || null,
      slug: conv.slug || null,
      projectId: conv.projectId || null,
      projectTitle: conv.projectTitle || null,
      projectSlug: conv.projectSlug || null
    });
  }
  function htmlChatLanded(conv, completePaths) {
    if (!completePaths || typeof htmlCompleteDirFromDownloadPath !== "function")
      return false;
    var dir = htmlDirForConversation(conv);
    if (!dir)
      return false;
    var needle = dir.toLowerCase();
    for (var i = 0;i < completePaths.length; i++) {
      var found = htmlCompleteDirFromDownloadPath(completePaths[i]);
      if (found && found.toLowerCase() === needle)
        return true;
    }
    return false;
  }
  function exportSavedLines(runLog, htmlSaved) {
    var lines = [];
    if (htmlSaved)
      lines.push("HTML: chatgpt-export/html/");
    if (runLog && runLog.runId)
      lines.push("Log: chatgpt-export/logs/" + runLog.runId + ".json");
    return lines.join(`
`);
  }
  async function publishHtmlSessions(sessions) {
    var earlier = typeof searchHtmlPagePaths === "function" ? await searchHtmlPagePaths() : [];
    if (earlier === null)
      earlier = [];
    var complete = typeof searchHtmlCompletePaths === "function" ? await searchHtmlCompletePaths() : null;
    var laid = layoutStaticSite(sessions, earlier, complete);
    var write = await downloadStaticSite(laid);
    noteExportDownload(write.downloadId);
    return write;
  }
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("error", function(event) {
      if (!state.activeRunLog)
        return;
      var err = event && event.error;
      pushLogEvent(state.activeRunLog, {
        level: "error",
        phase: "window",
        outcome: "exception",
        message: err && err.message || event && event.message || "error",
        stack: err && err.stack
      });
      flushRunLog(state.activeRunLog, state.activeRunLogOptions);
    });
    window.addEventListener("unhandledrejection", function(event) {
      if (!state.activeRunLog)
        return;
      var reason = event && event.reason;
      pushLogEvent(state.activeRunLog, {
        level: "error",
        phase: "unhandledrejection",
        outcome: "exception",
        message: reason && reason.message || String(reason || "unhandled rejection"),
        stack: reason && reason.stack
      });
      flushRunLog(state.activeRunLog, state.activeRunLogOptions);
    });
    window.addEventListener("pagehide", handlePanelHide);
  }

  // src/popup/downloads.mjs
  function searchCompletedDownloadPaths(projectSlug) {
    return new Promise(function(resolve) {
      if (typeof chrome === "undefined" || !chrome.downloads || !chrome.downloads.search) {
        resolve(new Set);
        return;
      }
      var escaped = (projectSlug || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      var pattern = projectSlug ? "chatgpt-export/" + escaped + "/.+/.*\\.md$" : "chatgpt-export/.+/.*\\.md$";
      chrome.downloads.search({ filenameRegex: pattern }, function(items) {
        var paths = new Set;
        if (items) {
          for (var i = 0;i < items.length; i++) {
            var item = items[i];
            if (!item || !item.filename)
              continue;
            if (item.exists === false)
              continue;
            if (item.state && item.state !== "complete")
              continue;
            paths.add(item.filename);
            if (typeof item.fileSize === "number" && item.fileSize > 0) {
              paths.__sizes = paths.__sizes || Object.create(null);
              paths.__sizes[item.filename] = item.fileSize;
            }
          }
        }
        resolve(paths);
      });
    });
  }
  function bytesToBase64DataUrl(bytes, mimeType) {
    var type = mimeType || "application/octet-stream";
    if (typeof bytesToDataUrl === "function")
      return bytesToDataUrl(bytes, type);
    var encoded = "";
    for (var start = 0;start < bytes.length; start += 3072) {
      var end = Math.min(start + 3072, bytes.length);
      var binary = "";
      for (var i = start;i < end; i++)
        binary += String.fromCharCode(bytes[i]);
      encoded += btoa(binary);
    }
    return "data:" + type + ";base64," + encoded;
  }
  function bytesToDownloadUrl(bytes, mimeType) {
    if (typeof Blob === "function" && typeof URL !== "undefined" && URL.createObjectURL) {
      return {
        url: URL.createObjectURL(new Blob([bytes], { type: mimeType || "application/octet-stream" })),
        revoke: function(url) {
          try {
            URL.revokeObjectURL(url);
          } catch (_e) {}
        }
      };
    }
    return { url: bytesToBase64DataUrl(bytes, mimeType), revoke: function() {} };
  }
  function textToUtf8Bytes(text) {
    if (typeof TextEncoder !== "undefined")
      return new TextEncoder().encode(text);
    var out = new Uint8Array(text.length);
    for (var i = 0;i < text.length; i++)
      out[i] = text.charCodeAt(i) & 255;
    return out;
  }
  var ZIP_BYTE_BUDGET = 64 * 1024 * 1024;
  function addZipEntry(zipEntries, projectSlug, convSlug, filename, content) {
    var prefix = conversationFolderPath(convSlug, projectSlug) + "/";
    var data = typeof content === "string" ? textToUtf8Bytes(content) : content;
    var budget = typeof zipEntries.budget === "number" ? zipEntries.budget : ZIP_BYTE_BUDGET;
    var used = typeof zipEntries.bytes === "number" ? zipEntries.bytes : 0;
    var incoming = data && data.length || 0;
    if (used + incoming > budget) {
      zipEntries.dropped = (zipEntries.dropped || 0) + 1;
      return false;
    }
    zipEntries.bytes = used + incoming;
    zipEntries.push({ name: prefix + filename, data });
    return true;
  }
  var ZIP_WRITE_TIMEOUT_MS = 120000;
  var MD_WRITE_TIMEOUT_MS = 120000;
  function waitForDownloadComplete(downloadId, timeoutMs) {
    return new Promise(function(resolve) {
      if (downloadId === undefined || downloadId === null || typeof chrome === "undefined" || !chrome.downloads || !chrome.downloads.onChanged) {
        resolve(false);
        return;
      }
      var settled = false;
      var finish = function(done) {
        if (settled)
          return;
        settled = true;
        clearTimeout(timer);
        try {
          chrome.downloads.onChanged.removeListener(listener);
        } catch (_e) {}
        resolve(done);
      };
      var listener = function(delta) {
        if (!delta || delta.id !== downloadId || !delta.state)
          return;
        if (delta.state.current === "complete" || delta.state.current === "interrupted") {
          finish(delta.state.current === "complete");
        }
      };
      var timer = setTimeout(function() {
        finish(false);
      }, timeoutMs || 120000);
      chrome.downloads.onChanged.addListener(listener);
      if (typeof chrome.downloads.search === "function") {
        try {
          chrome.downloads.search({ id: downloadId }, function(items) {
            if (chrome.runtime && chrome.runtime.lastError)
              return;
            var item = items && items[0];
            if (!item || item.id !== downloadId)
              return;
            if (item.state === "interrupted")
              finish(false);
            else if (item.state === "complete" && item.exists === true)
              finish(true);
          });
        } catch (_e) {}
      }
    });
  }
  function downloadOne(url, filename, targetPath, timeoutMs, conflictAction) {
    return new Promise(function(resolve) {
      var settled = false;
      var timer = setTimeout(function() {
        if (!settled) {
          settled = true;
          resolve({ url, filename, ok: false, error: "timeout" });
        }
      }, timeoutMs || 12000);
      chrome.downloads.download({
        url,
        filename: targetPath || "chatgpt-export/" + filename,
        saveAs: false,
        conflictAction: conflictAction || "overwrite"
      }, function(downloadId) {
        if (settled)
          return;
        settled = true;
        clearTimeout(timer);
        var ok = !chrome.runtime.lastError && downloadId !== undefined;
        resolve({
          url,
          filename,
          ok,
          downloadId: ok ? downloadId : null,
          error: ok ? null : chrome.runtime.lastError && chrome.runtime.lastError.message || "download rejected"
        });
      });
    });
  }
  function startProgressPolling(tabId) {
    stopProgressPolling();
    state.progressTimer = setInterval(async function() {
      try {
        const probe = await chrome.scripting.executeScript({
          target: { tabId },
          func: function() {
            return window.__c2mScan || null;
          }
        });
        const state2 = probe && probe[0] && probe[0].result;
        if (state2 && !state2.cancelled) {
          const seconds = Math.round((state2.elapsedMs || 0) / 1000);
          btn.textContent = "Scanning… " + state2.captured + " messages · " + seconds + "s";
        }
      } catch (_e) {}
    }, 1000);
  }
  function stopProgressPolling() {
    if (state.progressTimer) {
      clearInterval(state.progressTimer);
      state.progressTimer = null;
    }
  }
  async function saveConversationExport(tabId, result, options) {
    var downloadImages = options.downloadImages;
    var useTimestamp = options.useTimestamp;
    var batchStamp = options.batchStamp || formatExportTimestamp();
    var projectSlug = options.projectSlug;
    var zipEntries = options.zipEntries;
    var slug = result.slug || null;
    var convSlug = slug || "conversation";
    var conversationId = options.conversationId || null;
    var mdName = conversationId ? batchMdFilename(slug, conversationId, useTimestamp, batchStamp, result.partial) : buildMdFilename(slug, useTimestamp, null, batchStamp);
    var folderPath = projectSlug ? conversationFolderPath(convSlug, projectSlug) : exportPath(slug, "").replace(/\/$/, "");
    var md = result.md;
    var partialSuffix = result.partial ? " (partial export)" : "";
    var dlOk = 0;
    var dlTotal = 0;
    var dlErrors = [];
    var mdFinal = md;
    var savedFiles = [];
    if (downloadImages && typeof chrome.downloads !== "undefined") {
      var refs = parseArtifactRefs(md);
      dlTotal = refs.length;
      var extracted = [];
      if (refs.length > 0) {
        var urls = refs.map(function(r) {
          return r.url;
        });
        try {
          var extractResult = await chrome.scripting.executeScript({
            target: { tabId },
            func: async function(urls) {
              if (typeof fetchImageDataUrls === "function")
                return await fetchImageDataUrls(urls);
              if (typeof extractImageDataUrls === "function")
                return await extractImageDataUrls(urls);
              return urls.map(function() {
                return null;
              });
            },
            args: [urls]
          });
          extracted = extractResult?.[0]?.result || [];
        } catch (fetchErr) {
          dlErrors.push("attachments unavailable (" + (fetchErr && fetchErr.message || fetchErr) + ")");
        }
      }
      mdFinal = md;
      for (var i = 0;i < refs.length; i++) {
        var ex = extracted[i];
        if (ex && ex.dataUrl) {
          var ref = refs[i] || {};
          var fname = artifactFilename(ex.url, ref.label || "", i, slug, ref.kind || "image");
          var dot = fname.lastIndexOf(".");
          fname = fname.slice(0, dot) + "--" + batchStamp + fname.slice(dot);
          var targetPath = folderPath + "/" + fname;
          var r = await downloadOne(ex.dataUrl, fname, targetPath);
          if (r.ok && chrome.downloads.onChanged) {
            if (!await waitForDownloadComplete(r.downloadId, MD_WRITE_TIMEOUT_MS)) {
              r.ok = false;
              r.error = "the attachment write did not complete";
            }
          } else if (r.ok) {
            r.ok = false;
            r.error = "attachment completion could not be checked";
          }
          if (r.ok) {
            dlOk++;
            var localUrl = "./" + r.filename.replace(/[ #%?()[\]]/g, function(char) {
              return "%" + char.charCodeAt(0).toString(16).toUpperCase();
            });
            mdFinal = mdFinal.split(ex.url).join(localUrl);
            var dataPart = ex.dataUrl.split(",")[1] || "";
            var bin = Uint8Array.from(atob(dataPart), function(c) {
              return c.charCodeAt(0);
            });
            savedFiles.push({ url: ex.url, name: fname, bytes: bin });
            if (zipEntries)
              addZipEntry(zipEntries, projectSlug, convSlug, fname, bin);
          } else {
            dlErrors.push(r.error || "unknown");
          }
        } else {
          dlErrors.push("attachment unavailable: " + (refs[i].label || "file " + (i + 1)));
        }
      }
    }
    var mdHandle = bytesToDownloadUrl(textToUtf8Bytes(mdFinal), "text/markdown;charset=utf-8");
    var mdWrite = await downloadOne(mdHandle.url, mdName, folderPath + "/" + mdName, MD_WRITE_TIMEOUT_MS);
    var canObserveCompletion = typeof chrome !== "undefined" && chrome.downloads && chrome.downloads.onChanged;
    if (mdWrite.ok && canObserveCompletion) {
      var mdWritten = await waitForDownloadComplete(mdWrite.downloadId, MD_WRITE_TIMEOUT_MS);
      if (!mdWritten) {
        mdWrite.ok = false;
        mdWrite.error = mdWrite.error || "the write did not complete";
      }
    }
    mdHandle.revoke(mdHandle.url);
    if (mdWrite.ok)
      noteExportDownload(mdWrite.downloadId);
    if (zipEntries)
      addZipEntry(zipEntries, projectSlug, convSlug, mdName, mdFinal);
    return {
      mdFinal,
      partialSuffix,
      dlOk,
      dlTotal,
      dlErrors,
      mdName,
      mdOk: mdWrite.ok,
      mdError: mdWrite.error || null,
      savedFiles
    };
  }

  // src/popup/quota.mjs
  function classifyBatchFailure(message) {
    var text = String(message || "").toLowerCase();
    if (typeof navigator !== "undefined" && navigator && navigator.onLine === false)
      return "offline";
    if (/failed to fetch|network ?error|net::|err_internet|err_network|err_name_not_resolved|err_connection/.test(text))
      return "offline";
    if (/\b(?:502|503|504)\b|bad gateway|service unavailable|gateway timeout|too many requests|\b429\b|rate limit|slow down|try again later/.test(text))
      return "unreachable";
    if (/did not load|timed out|timeout/.test(text))
      return "transient";
    return "conversation";
  }
  function backoffDelayMs(attempt) {
    return Math.min(1000 * Math.pow(2, Math.max(0, attempt - 1)), 8000);
  }
  function sleep(ms) {
    return new Promise(function(resolve) {
      setTimeout(resolve, ms);
    });
  }
  var OPENAI_CALLS_PER_MINUTE = 30;
  var OPENAI_CALL_WINDOW_MS = 60000;
  var RATE_LIMIT_RETRY_WAIT_MS = OPENAI_CALL_WINDOW_MS;
  var RATE_LIMIT_RETRY_CLICKS = 5;
  var OPENAI_PAGE_LOAD_CALLS = 4;
  var OPENAI_METADATA_CALLS = 2;
  var OPENAI_FILE_LOOKUP_CALLS = 2;
  function createCallQuota(limit, windowMs, now, wait, onWait) {
    var times = [];
    var cap = typeof limit === "number" ? limit : OPENAI_CALLS_PER_MINUTE;
    var span = typeof windowMs === "number" ? windowMs : OPENAI_CALL_WINDOW_MS;
    var clock = now || function() {
      return Date.now();
    };
    var sleepFn = wait || sleep;
    return {
      limit: cap,
      take: async function(count) {
        var need = count > 0 ? Math.floor(count) : 1;
        var frozen = 0;
        for (;; ) {
          var t = clock();
          var kept = [];
          for (var i = 0;i < times.length; i++) {
            if (t - times[i] < span)
              kept.push(times[i]);
          }
          times = kept;
          if (times.length + need <= cap) {
            for (var n = 0;n < need; n++)
              times.push(t);
            return;
          }
          var delay = span - (t - times[0]);
          if (delay < 1)
            delay = 1;
          if (onWait)
            onWait(delay);
          var before = t;
          await sleepFn(delay);
          if (clock() === before) {
            frozen += 1;
            if (frozen > 1) {
              for (var k = 0;k < need; k++)
                times.push(clock());
              return;
            }
          } else {
            frozen = 0;
          }
        }
      }
    };
  }
  async function waitWhilePaused(controls) {
    while (controls && controls.isPaused && controls.isPaused()) {
      if (controls.isCancelled && controls.isCancelled())
        return false;
      await sleep(250);
    }
    return !(controls && controls.isCancelled && controls.isCancelled());
  }

  // src/popup/batch.mjs
  async function sleepUnlessStopped(ms, guard) {
    var left = ms > 0 ? ms : 0;
    while (left > 0) {
      if (!await waitWhilePaused(guard))
        return false;
      var step = left > 1000 ? 1000 : left;
      await sleep(step);
      left -= step;
    }
    return !(guard && guard.isCancelled && guard.isCancelled());
  }
  async function waitForLoadedConversation(tabId, conversationId, hooks) {
    var guard = hooks || {};
    var clicks = 0;
    var limit = typeof guard.maxClicks === "number" ? guard.maxClicks : RATE_LIMIT_RETRY_CLICKS;
    var waitMs = typeof guard.waitMs === "number" ? guard.waitMs : RATE_LIMIT_RETRY_WAIT_MS;
    while (true) {
      var readyResult = await chrome.scripting.executeScript({
        target: { tabId },
        func: async function(id, timeoutMs) {
          if (typeof waitForConversationReady !== "function") {
            return { ready: false, error: "waitForConversationReady is unavailable." };
          }
          return await waitForConversationReady({ conversationId: id, timeoutMs });
        },
        args: [conversationId, guard.contentTimeoutMs == null ? 30000 : guard.contentTimeoutMs]
      });
      var ready = readyResult && readyResult[0] && readyResult[0].result;
      if (!ready)
        return { ready: false, error: "did not load" };
      if (ready.ready || !ready.rateLimited)
        return ready;
      if (clicks >= limit)
        return ready;
      if (guard.onWait)
        guard.onWait(clicks + 1, waitMs);
      if (!await sleepUnlessStopped(waitMs, guard))
        return { ready: false, error: "cancelled" };
      clicks += 1;
      await chrome.scripting.executeScript({
        target: { tabId },
        func: function() {
          if (typeof clickConversationRetry === "function")
            return clickConversationRetry();
          return false;
        }
      });
    }
  }
  async function runBatchExport(tab, options) {
    var downloadImages = options.downloadImages;
    var useTimestamp = options.useTimestamp;
    var projectId = options.projectId === undefined ? projectIdFromLocation(tab && tab.url) : options.projectId;
    var scopeKnown = options.projectId !== undefined || !!(tab && tab.url);
    var projectSlug = options.projectSlug;
    var batchStamp = options.batchStamp || formatExportTimestamp();
    var onProgress = options.onProgress;
    var zipEntries = options.buildZip ? [] : null;
    if (zipEntries && typeof options.zipByteBudget === "number") {
      zipEntries.budget = options.zipByteBudget;
    }
    var completedPaths = await searchCompletedDownloadPaths(projectSlug);
    var conversations;
    var listComplete;
    var listReason;
    var discovered = 0;
    if (options.discover && Array.isArray(options.conversations)) {
      var found = [];
      var walk = { complete: false, reason: "unknown" };
      try {
        walk = await readSidebarConversations(tab.id);
        var projects = Object.create(null);
        for (var savedRow of options.conversations) {
          if (savedRow.projectId)
            projects[String(savedRow.projectId)] = true;
        }
        found = walk.conversations.filter(function(row) {
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
        listReason = "saved-job";
      } else {
        listComplete = walk.complete;
        listReason = "sync";
      }
    } else if (Array.isArray(options.conversations)) {
      conversations = options.conversations.map(conversationJobRecord).filter(function(row) {
        return row.id || row.href;
      });
      listComplete = options.listComplete !== false;
      listReason = "saved-job";
    } else {
      var listed = await readSidebarConversations(tab.id);
      conversations = scopeKnown ? listed.conversations.filter(function(row) {
        return (row.projectId || null) === (projectId || null);
      }) : listed.conversations;
      listComplete = listed.complete;
      listReason = listed.reason;
    }
    if (!conversations.length) {
      return { ok: false, error: "No conversations found in the sidebar. Open a ChatGPT Project page first." };
    }
    var wantHtmlRun = !!(options.htmlSiteDir || options.downloadHtml);
    var htmlCompletePaths = wantHtmlRun ? await searchHtmlCompletePaths() : [];
    var htmlHistoryKnown = htmlCompletePaths !== null;
    if (!htmlHistoryKnown)
      htmlCompletePaths = [];
    var htmlPagePaths = wantHtmlRun ? await searchHtmlPagePaths() : [];
    if (htmlPagePaths === null)
      htmlPagePaths = [];
    var exportIndex = await readExportIndex();
    var wantMarkdown = !!downloadImages || !wantHtmlRun;
    var markdownPending = filterPendingConversations(conversations, completedPaths, projectSlug);
    var markdownPendingKeys = Object.create(null);
    for (var m = 0;m < markdownPending.length; m++) {
      markdownPendingKeys[markdownPending[m].id || markdownPending[m].slug] = true;
    }
    function requestedFilesLanded(conv) {
      var htmlMissing = wantHtmlRun && (!htmlHistoryKnown || !htmlChatLanded(conv, htmlCompletePaths));
      var markdownMissing = wantMarkdown && markdownPendingKeys[conv.id || conv.slug];
      return !htmlMissing && !markdownMissing;
    }
    var notYetSaved = [];
    var alreadySaved = [];
    for (var order = 0;order < conversations.length; order++) {
      if (requestedFilesLanded(conversations[order]))
        alreadySaved.push(conversations[order]);
      else
        notYetSaved.push(conversations[order]);
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
    var runLog = createRunLog("batch", {
      runId: batchStamp || formatExportTimestamp(),
      downloadImages,
      downloadHtml: wantHtmlRun
    });
    state.activeRunLog = runLog;
    state.activeRunLogOptions = { htmlSiteDir: options.htmlSiteDir || null, downloadLog: true };
    pushLogEvent(runLog, {
      phase: "run",
      outcome: "started",
      counts: {
        listed: conversations.length,
        pending: pending.length,
        discovered,
        notOnDisk: notYetSaved.length
      }
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
      isPaused: options.isPaused || function() {
        return state.batchPaused;
      },
      isCancelled: options.isCancelled || function() {
        return state.batchCancelled;
      }
    };
    var callQuota = options.callQuota || createCallQuota(OPENAI_CALLS_PER_MINUTE, OPENAI_CALL_WINDOW_MS, null, null, function(delayMs) {
      pushLogEvent(runLog, {
        phase: "quota",
        outcome: "waiting",
        counts: { delayMs }
      });
    });
    var jobStored = await rememberBatchJob({
      version: 1,
      jobId: options.jobId || batchStamp || runLog.runId,
      status: "running",
      updatedAt: new Date().toISOString(),
      projectId: projectId || null,
      projectSlug: projectSlug || null,
      batchStamp: batchStamp || runLog.runId,
      downloadImages: !!downloadImages,
      downloadHtml: wantHtmlRun,
      listComplete,
      conversations: conversations.map(conversationJobRecord)
    });
    if (!jobStored.ok) {
      if (jobStored.error !== "no storage") {
        errors.push("saved export could not be stored (" + jobStored.error + ")");
      }
      showStatus("warning", "Backup is running, but cannot be resumed after closing this panel (" + jobStored.error + ").");
    }
    function waitForTabNavigation(tabId, conversationId, timeoutMs) {
      var budget = timeoutMs || 30000;
      if (typeof chrome === "undefined" || !chrome.tabs || !chrome.tabs.get) {
        return Promise.resolve(true);
      }
      return new Promise(function(resolve) {
        var startedAt = Date.now();
        function poll() {
          chrome.tabs.get(tabId, function(t) {
            if (chrome.runtime.lastError || !t)
              return resolve(false);
            var onConversation = !conversationId || String(t.url || "").indexOf("/c/" + conversationId) !== -1;
            if (t.status === "complete" && onConversation)
              return resolve(true);
            if (Date.now() - startedAt >= budget)
              return resolve(false);
            setTimeout(poll, 300);
          });
        }
        poll();
      });
    }
    async function readConversationMetadata(tabId, conv) {
      try {
        await callQuota.take(OPENAI_METADATA_CALLS);
        await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
        var out = await chrome.scripting.executeScript({
          target: { tabId },
          func: async function(conversationId) {
            if (typeof fetchConversationMetadata !== "function")
              return null;
            return await fetchConversationMetadata(conversationId, {});
          },
          args: [conv.id]
        });
        return out && out[0] && out[0].result || null;
      } catch (_e) {
        return null;
      }
    }
    async function attemptConversation(conv) {
      await callQuota.take(OPENAI_PAGE_LOAD_CALLS);
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: function(href) {
          window.location.href = href;
        },
        args: [conv.href]
      });
      var navigated = await waitForTabNavigation(tab.id, conv.id, 30000);
      if (!navigated)
        return { ok: false, error: "did not load" };
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });
      state.scanningTabId = tab.id;
      var ready = await waitForLoadedConversation(tab.id, conv.id, {
        isCancelled: controls.isCancelled,
        isPaused: controls.isPaused,
        onWait: function() {
          if (onProgress)
            onProgress(index, pending.length, progressTitle + " — waiting for ChatGPT");
        }
      });
      if (!ready || !ready.ready) {
        return {
          ok: false,
          error: ready && ready.error || "did not load",
          rateLimited: !!(ready && ready.rateLimited)
        };
      }
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });
      startProgressPolling(tab.id);
      var results;
      try {
        if (downloadImages)
          await callQuota.take(OPENAI_FILE_LOOKUP_CALLS);
        results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: async function(wantFiles) {
            return getConversationMarkdown({ downloadFiles: wantFiles });
          },
          args: [!!downloadImages]
        });
      } finally {
        stopProgressPolling();
      }
      var scanned = results?.[0]?.result;
      if (!scanned || !scanned.ok) {
        return {
          ok: false,
          error: scanned && scanned.error || "scan failed",
          stack: scanned && scanned.stack
        };
      }
      return { ok: true, result: scanned };
    }
    for (var index = 0;index < pending.length; index++) {
      if (controls.isCancelled())
        break;
      if (controls.isPaused() && state.activeBatchJob && state.activeBatchJob.status !== "paused") {
        state.activeBatchJob.status = "paused";
        state.activeBatchJob.updatedAt = new Date().toISOString();
        await writeBatchJob(state.activeBatchJob);
      } else if (!controls.isPaused() && state.activeBatchJob && state.activeBatchJob.status === "paused") {
        state.activeBatchJob.status = "running";
        state.activeBatchJob.updatedAt = new Date().toISOString();
        await writeBatchJob(state.activeBatchJob);
      }
      if (!await waitWhilePaused(controls))
        break;
      var conv = pending[index];
      var progressTitle = conv.title || conv.slug || conv.id;
      if (onProgress)
        onProgress(index, pending.length, progressTitle);
      var liveMeta = null;
      var grewThisRound = false;
      var verdict = null;
      var filesLanded = requestedFilesLanded(conv);
      if (exportIndex) {
        liveMeta = await readConversationMetadata(tab.id, conv);
        verdict = classifyAgainstIndex(exportIndex, conv.id, liveMeta).verdict;
        if (verdict === "unchanged" && filesLanded) {
          indexSkipped += 1;
          pushLogEvent(runLog, {
            phase: "skip",
            outcome: "unchanged",
            conversationId: conv.id,
            title: conv.title
          });
          continue;
        }
        if ((!liveMeta || verdict === "unknown") && filesLanded) {
          leftClosed += 1;
          pushLogEvent(runLog, {
            phase: "skip",
            outcome: "file-landed",
            conversationId: conv.id,
            title: conv.title
          });
          continue;
        }
        if (verdict === "grown") {
          grewThisRound = true;
          grown += 1;
        }
      }
      var attempt = 0;
      var outcome = null;
      var lastError = "";
      while (attempt < maxAttempts) {
        attempt += 1;
        try {
          outcome = await attemptConversation(conv);
        } catch (err) {
          outcome = {
            ok: false,
            error: err && err.message || String(err),
            stack: err && err.stack
          };
        }
        if (outcome.ok)
          break;
        if (outcome.rateLimited)
          break;
        lastError = outcome.error;
        var kind = classifyBatchFailure(lastError);
        if (kind === "conversation")
          break;
        if (controls.isCancelled())
          break;
        if (kind === "offline" || kind === "unreachable") {
          if (held >= maxHoldRounds) {
            lastError = "network unavailable after " + held + " waits: " + lastError;
            break;
          }
          held += 1;
          if (onProgress)
            onProgress(index, pending.length, progressTitle + " — waiting for the network (" + held + ")");
          attempt -= 1;
          await sleep(backoffDelayMs(Math.min(held, 4)));
          if (!await waitWhilePaused(controls))
            break;
          continue;
        }
        if (attempt < maxAttempts) {
          retried += 1;
          if (onProgress)
            onProgress(index, pending.length, progressTitle + " — retry " + attempt + "/" + (maxAttempts - 1));
          await sleep(backoffDelayMs(attempt));
          if (!await waitWhilePaused(controls))
            break;
        }
      }
      if (controls.isCancelled())
        break;
      if (!outcome || !outcome.ok) {
        if (outcome && outcome.rateLimited) {
          errors.push("ChatGPT rate limit: waited and retried, and the conversation page still asked to retry. Resume later; opening more chats would keep the limit in place.");
          pushLogEvent(runLog, {
            level: "error",
            phase: "conversation",
            outcome: "rate-limit",
            conversationId: conv.id,
            title: conv.title,
            message: outcome.error
          });
          break;
        }
        errors.push((conv.title || conv.id) + ": " + (lastError || "failed"));
        pushLogEvent(runLog, {
          level: "error",
          phase: "conversation",
          outcome: "failed",
          conversationId: conv.id,
          title: conv.title,
          message: lastError || "failed",
          stack: outcome && outcome.stack
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
      var markdownAlreadyLanded = !markdownPendingKeys[conv.id || conv.slug];
      var htmlOnly = wantHtmlRun && markdownAlreadyLanded && verdict === "unchanged";
      var markdownAttempted = false;
      var stampThis = true;
      if (downloadImages && !htmlOnly || !wantHtml) {
        markdownAttempted = true;
        try {
          saved = await saveConversationExport(tab.id, result, {
            downloadImages: !!downloadImages,
            useTimestamp: stampThis,
            batchStamp,
            projectSlug,
            zipEntries,
            conversationId: conv.id
          });
          writeOk = !!(saved && saved.mdOk);
          writeError = saved && saved.mdError;
        } catch (saveErr) {
          writeOk = false;
          writeError = saveErr && saveErr.message || String(saveErr);
        }
      }
      var htmlPartial = false;
      var htmlRecorded = false;
      var htmlIndexOk = true;
      if (wantHtml && typeof sessionFromExport === "function") {
        var retrievedFiles = conv && conv.retrievedFiles || null;
        if (downloadImages && saved && saved.savedFiles && saved.savedFiles.length) {
          retrievedFiles = saved.savedFiles;
        }
        var htmlConv = retrievedFiles ? Object.assign({}, conv, { retrievedFiles }) : conv;
        var htmlResult = result;
        if (downloadImages && saved && saved.dlErrors && saved.dlErrors.length) {
          htmlResult = Object.assign({}, result, { partial: true });
        }
        var htmlSession = sessionFromExport(htmlConv, htmlResult);
        var chatLaid = typeof layoutChatFiles === "function" ? layoutChatFiles(htmlSession) : null;
        var chatWriteOk = true;
        var chatWriteError = null;
        if (chatLaid && options.htmlSiteDir && typeof writeStaticSite === "function") {
          try {
            writeStaticSite(options.htmlSiteDir, { files: chatLaid.files });
          } catch (writeErr) {
            chatWriteOk = false;
            chatWriteError = writeErr && writeErr.message || String(writeErr);
          }
        }
        if (chatWriteOk && chatLaid && options.downloadHtml) {
          var chatDownload = await downloadStaticSite({ files: chatLaid.files });
          noteExportDownload(chatDownload.downloadId);
          if (!chatDownload.ok) {
            chatWriteOk = false;
            chatWriteError = chatDownload.error || "the write did not complete";
          }
        }
        if (!chatLaid) {
          chatWriteOk = false;
          chatWriteError = "HTML layout is unavailable";
        }
        if (!chatWriteOk) {
          errors.push((conv.title || conv.id) + ": HTML page not saved (" + (chatWriteError || "the write did not complete") + ")");
          htmlOk = false;
          pushLogEvent(runLog, {
            level: "error",
            phase: "html",
            outcome: "failed",
            conversationId: conv.id,
            title: conv.title,
            message: chatWriteError
          });
        } else {
          htmlLinks.push(chatLaid.link);
          htmlChatFiles += chatLaid.files.length;
          htmlRecorded = true;
          htmlPartial = !!htmlSession.partial;
          if (typeof layoutIndexFiles === "function" && typeof mergeChatLinks === "function") {
            var progressIndexes = layoutIndexFiles(mergeChatLinks(htmlLinks, htmlPagePaths, htmlCompletePaths));
            if (options.htmlSiteDir && typeof writeStaticSite === "function") {
              writeStaticSite(options.htmlSiteDir, { files: progressIndexes });
            }
            if (options.downloadHtml) {
              var indexDownload = await downloadStaticSite({ files: progressIndexes });
              noteExportDownload(indexDownload.downloadId);
              if (!indexDownload.ok) {
                errors.push("HTML index not saved (" + (indexDownload.error || "the write did not complete") + ")");
                htmlOk = false;
                htmlIndexOk = false;
              }
            }
          }
        }
      }
      if (!htmlRecorded && (!markdownAttempted || !writeOk)) {
        errors.push((conv.title || conv.id) + ": not saved (" + (writeError || "download rejected") + ")");
        pushLogEvent(runLog, {
          level: "error",
          phase: "write",
          outcome: "failed",
          conversationId: conv.id,
          title: conv.title,
          message: writeError || "download rejected"
        });
        var rejectedLog = await flushRunLog(runLog, state.activeRunLogOptions);
        if (!rejectedLog.ok) {
          logOk = false;
          logError = rejectedLog.error;
        }
        continue;
      }
      if (markdownAttempted && !writeOk) {
        errors.push((conv.title || conv.id) + ": markdown not saved (" + (writeError || "download rejected") + ")");
      }
      exported += 1;
      var exportSlug = result.slug || conv.slug || conv.id;
      var attachmentPartial = !!(saved && (saved.dlErrors.length || saved.dlOk < saved.dlTotal));
      var conversationPartial = !!(result.partial || htmlPartial || attachmentPartial || markdownAttempted && !writeOk || wantHtml && (!htmlRecorded || !htmlIndexOk));
      if (conversationPartial) {
        partial += 1;
        if (result.partial || htmlPartial || attachmentPartial) {
          errors.push(result.partial ? (conv.title || conv.id) + ": saved incompletely (scan did not reach the end) — re-run to finish it" : (conv.title || conv.id) + ": saved incompletely (a file was not retrieved) — re-run to finish it");
        }
      } else {
        if (markdownAttempted && writeOk) {
          completedPaths.add(mdDownloadPath(exportSlug, projectSlug, stampThis, batchStamp, conv.id));
        }
        if (liveMeta && (markdownAttempted && writeOk || htmlRecorded)) {
          await recordExportedConversation(conv.id, {
            updateTime: liveMeta.updateTime,
            currentNode: liveMeta.currentNode,
            messageCount: liveMeta.messageCount,
            bytes: result.md ? result.md.length : null,
            files: saved ? saved.dlOk : 0
          });
        }
      }
      pushLogEvent(runLog, {
        level: conversationPartial ? "warn" : "info",
        phase: "conversation",
        outcome: conversationPartial ? "partial" : "saved",
        conversationId: conv.id,
        title: conv.title,
        counts: {
          lines: result.lines || 0,
          files: saved && saved.savedFiles && saved.savedFiles.length || 0
        }
      });
      var savedLog = await flushRunLog(runLog, state.activeRunLogOptions);
      if (!savedLog.ok) {
        logOk = false;
        logError = savedLog.error;
      }
    }
    var zipName = null;
    if (zipEntries && zipEntries.dropped > 0) {
      errors.push("archive incomplete: " + zipEntries.dropped + " file(s) left out to stay within the memory budget — the saved files on disk are complete");
    }
    if (zipEntries && zipEntries.length > 0 && typeof buildStoreZip === "function") {
      var stamp = batchStamp || formatExportTimestamp();
      var candidateName = (projectSlug || "project") + "-export--" + stamp + ".zip";
      var handle = null;
      try {
        var zipBytes = buildStoreZip(zipEntries);
        handle = bytesToDownloadUrl(zipBytes, "application/zip");
        var zipWrite = await downloadOne(handle.url, candidateName, batchRootPath(projectSlug) + "/" + candidateName, ZIP_WRITE_TIMEOUT_MS);
        if (zipWrite.ok) {
          var written = await waitForDownloadComplete(zipWrite.downloadId, ZIP_WRITE_TIMEOUT_MS);
          if (written) {
            zipName = candidateName;
            noteExportDownload(zipWrite.downloadId);
          } else {
            errors.push("archive not completed — the exported files are still on disk");
          }
        } else {
          errors.push("archive not saved (" + (zipWrite.error || "download rejected") + ") — the exported files are still on disk");
        }
      } catch (zipErr) {
        errors.push("archive not created (" + (zipErr && zipErr.message || zipErr) + ") — the exported files are still on disk");
      } finally {
        if (handle)
          handle.revoke(handle.url);
      }
    }
    var htmlIndexFiles = 0;
    if (htmlLinks.length && typeof layoutIndexFiles === "function" && typeof mergeChatLinks === "function") {
      var finalIndexes = layoutIndexFiles(mergeChatLinks(htmlLinks, htmlPagePaths, htmlCompletePaths));
      htmlIndexFiles = finalIndexes.length;
      if (options.htmlSiteDir && typeof writeStaticSite === "function") {
        writeStaticSite(options.htmlSiteDir, { files: finalIndexes });
      }
      if (options.downloadHtml) {
        var htmlWrite = await downloadStaticSite({ files: finalIndexes });
        noteExportDownload(htmlWrite.downloadId);
        if (!htmlWrite.ok) {
          errors.push("HTML index not saved (" + (htmlWrite.error || "the write did not complete") + ")");
          htmlOk = false;
        }
      }
    }
    if (!logOk)
      errors.push("execution log not saved (" + (logError || "the write did not complete") + ")");
    pushLogEvent(runLog, {
      phase: "run",
      outcome: controls.isCancelled() ? "cancelled" : "finished",
      counts: { exported, unchanged: indexSkipped, partial, leftClosed }
    });
    var finishedLog = await flushRunLog(runLog, state.activeRunLogOptions);
    if (!finishedLog.ok && logOk) {
      errors.push("execution log not saved (" + (finishedLog.error || "the write did not complete") + ")");
      logOk = false;
    }
    state.activeRunLog = null;
    if (state.activeBatchJob) {
      state.activeBatchJob.status = controls.isCancelled() || controls.isPaused() || partial > 0 || exported + indexSkipped < conversations.length || !htmlOk || !listComplete ? "paused" : "done";
      state.activeBatchJob.updatedAt = new Date().toISOString();
      var finalJob = await writeBatchJob(state.activeBatchJob);
      if (!finalJob.ok && finalJob.error !== "no storage") {
        errors.push("saved export could not be stored (" + finalJob.error + ")");
      }
    }
    return {
      ok: true,
      total: conversations.length,
      exported,
      unchanged: indexSkipped,
      leftClosed,
      grown,
      retried,
      partial,
      networkWaits: held,
      cancelled: controls.isCancelled(),
      listComplete,
      listReason,
      discovered,
      errors,
      zipName,
      htmlFiles: htmlChatFiles + htmlIndexFiles,
      htmlOk,
      logOk,
      logPath: "chatgpt-export/logs/" + runLog.runId + ".json"
    };
  }

  // src/popup/controls.mjs
  async function downloadStaticSite(laid) {
    var files = laid && laid.files || [];
    var failed = [];
    var lastId = null;
    var canObserveCompletion = typeof chrome !== "undefined" && chrome.downloads && chrome.downloads.onChanged;
    for (var i = 0;i < files.length; i++) {
      var entry = files[i];
      var bytes = typeof entry.body === "string" ? textToUtf8Bytes(entry.body) : entry.body;
      var handle = bytesToDownloadUrl(bytes, entry.mime || "application/octet-stream");
      var leaf = String(entry.path).split("/").pop();
      try {
        var write = await downloadOne(handle.url, leaf, "chatgpt-export/html/" + entry.path, MD_WRITE_TIMEOUT_MS);
        if (write.ok)
          lastId = write.downloadId;
        if (write.ok && canObserveCompletion) {
          var written = await waitForDownloadComplete(write.downloadId, MD_WRITE_TIMEOUT_MS);
          if (!written) {
            write.ok = false;
            write.error = write.error || "the write did not complete";
          }
        }
        if (!write.ok)
          failed.push((entry.path || leaf) + ": " + (write.error || "download rejected"));
      } finally {
        handle.revoke(handle.url);
      }
    }
    return {
      ok: failed.length === 0,
      error: failed.length ? failed.join("; ") : null,
      written: files.length - failed.length,
      failed: failed.length,
      downloadId: lastId
    };
  }
  function conversationIdFromLocation(url) {
    var match = String(url || "").match(/\/c\/([A-Za-z0-9-]+)/);
    return match ? match[1] : null;
  }
  function projectIdFromLocation(url) {
    var match = String(url || "").match(/\/g\/(g-p-[A-Za-z0-9]+)(?=[/?#]|$)/);
    return match ? match[1] : null;
  }
  if (btnPause) {
    btnPause.addEventListener("click", () => {
      if (!state.batchRunActive) {
        if (!btn.disabled && state.batchJobStored && state.activeBatchJob && state.activeBatchJob.status !== "done")
          resumeSavedBatch();
        return;
      }
      if (!state.batchJobStored)
        return;
      state.batchPaused = !state.batchPaused;
      btnPause.textContent = state.batchPaused ? "Resume" : "Pause";
      if (state.batchPaused) {
        if (state.activeBatchJob) {
          state.activeBatchJob.status = "paused";
          state.activeBatchJob.updatedAt = new Date().toISOString();
          writeBatchJob(state.activeBatchJob);
        }
        showStatus("warning", "Paused. You can close this panel and resume later. Conversations already saved stay saved.");
      } else if (state.activeBatchJob) {
        state.activeBatchJob.status = "running";
        state.activeBatchJob.updatedAt = new Date().toISOString();
        writeBatchJob(state.activeBatchJob);
      }
    });
  }
  async function executeBatch(tab, batchOptions) {
    state.batchRunActive = true;
    state.batchJobStored = false;
    state.activeBatchJob = null;
    state.lastExportDownloadId = null;
    state.scanningTabId = tab.id;
    if (btnPause) {
      state.batchPaused = false;
      btnPause.textContent = "Pause";
      btnPause.classList.remove("visible");
    }
    try {
      var batchResult = await runBatchExport(tab, batchOptions);
      if (!batchResult.ok) {
        showStatus("error", batchResult.error || "Batch export failed.");
        return batchResult;
      }
      var incomplete = batchResult.partial > 0 || batchResult.exported + batchResult.unchanged < batchResult.total;
      var summary = batchResult.htmlOk === false ? "HTML site not saved" : batchResult.listComplete && !incomplete && !batchResult.cancelled && !batchResult.errors.length ? "✓ Batch export complete: " + batchResult.exported + " saved" : "⚠ Backup needs attention: " + batchResult.exported + " saved";
      if (batchResult.unchanged > 0) {
        summary += ", " + batchResult.unchanged + " unchanged";
      }
      if (batchResult.leftClosed > 0) {
        summary += ", " + batchResult.leftClosed + " already on disk and left closed";
      }
      if (batchResult.discovered > 0) {
        summary += ", " + batchResult.discovered + (batchResult.discovered === 1 ? " new chat on the sidebar" : " new chats on the sidebar");
      }
      if (batchResult.grown > 0) {
        summary += ", " + batchResult.grown + (batchResult.grown === 1 ? " updated (saved as a new dated copy)" : " updated (saved as new dated copies)");
      }
      if (batchResult.partial > 0) {
        summary += ", " + batchResult.partial + " incomplete (re-run to repair)";
      }
      if (batchResult.cancelled)
        summary += " — stopped early";
      if (!batchResult.listComplete) {
        summary += batchResult.listReason === "history-rate-limited" ? `
ChatGPT could not load the rest of the sidebar. The export waited and retried; run it again after history loads.` : `
Scroll the sidebar to the end and re-run to pick up anything missing.`;
      }
      if (batchResult.zipName)
        summary += `
Zip: ` + batchResult.zipName;
      if (batchOptions.downloadHtml) {
        summary += `
` + exportSavedLines({ runId: batchOptions.batchStamp }, true);
      } else if (batchResult.logPath) {
        summary += `
Log: ` + batchResult.logPath;
      }
      if (batchResult.errors.length)
        summary += `
Errors: ` + batchResult.errors.join("; ");
      markExportFolderVisible();
      showStatus(batchResult.htmlOk === false ? "error" : batchResult.listComplete && !incomplete && !batchResult.cancelled && !batchResult.errors.length ? "success" : "warning", summary);
      return batchResult;
    } finally {
      state.batchRunActive = false;
      if (btnPause) {
        if (state.batchJobStored && state.activeBatchJob && state.activeBatchJob.status !== "done") {
          btnPause.textContent = "Resume saved export";
          btnPause.classList.add("visible");
        } else {
          btnPause.classList.remove("visible");
        }
      }
    }
  }
  async function resumeSavedBatch() {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    var tab = tabs && tabs[0];
    if (!tab || !tab.url || !tab.url.match(/https:\/\/(chatgpt\.com|chat\.openai\.com)\//)) {
      showStatus("error", "Open a ChatGPT page first, then resume.");
      return;
    }
    var job = await readBatchJob(projectIdFromLocation(tab.url));
    if (!job || !job.conversations || !job.conversations.length || job.status === "done") {
      showStatus("error", "No saved export for this page. Open the Project or account page where it started.");
      return;
    }
    btn.disabled = true;
    state.batchCancelled = false;
    btnCancel.classList.add("visible");
    btnCancel.disabled = false;
    btnCancel.textContent = "Stop export";
    try {
      return await executeBatch(tab, {
        downloadImages: !!job.downloadImages,
        projectId: job.projectId,
        projectSlug: job.projectSlug,
        jobId: job.jobId || job.batchStamp,
        batchStamp: formatExportTimestamp(),
        buildZip: true,
        downloadHtml: !!job.downloadHtml,
        conversations: job.conversations,
        discover: true,
        onProgress: function(index, total, title) {
          btn.textContent = "Exporting " + formatBatchProgress(index, total, title);
        }
      });
    } catch (err) {
      reportFailure("resume export", err);
    } finally {
      btn.disabled = false;
      refreshExportButtonLabel();
      state.scanningTabId = null;
      btnCancel.classList.remove("visible");
    }
  }
  function showSavedBatch() {
    chrome.tabs.query({ active: true, currentWindow: true }).then(function(tabs) {
      var tab = tabs && tabs[0];
      return readBatchJob(tab && tab.url ? projectIdFromLocation(tab.url) : undefined);
    }).then(function(job) {
      if (!job || job.status === "done" || state.batchRunActive || state.activeBatchJob)
        return;
      state.activeBatchJob = job;
      state.batchJobStored = true;
      if (!btnPause)
        return;
      btnPause.classList.add("visible");
      btnPause.textContent = "Resume saved export";
      showStatus("warning", "A saved backup is waiting (" + job.conversations.length + " conversations). Resume checks the open sidebar for chats added since, then saves new and updated ones.");
    }).catch(function() {});
  }
  btnCancel.addEventListener("click", async () => {
    if (state.scanningTabId === null)
      return;
    state.batchCancelled = true;
    btnCancel.disabled = true;
    btnCancel.textContent = "Stopping…";
    try {
      await chrome.scripting.executeScript({
        target: { tabId: state.scanningTabId },
        func: function() {
          if (window.__c2mScan)
            window.__c2mScan.cancelled = true;
        }
      });
    } catch (_e) {}
  });
  btn.addEventListener("click", async () => {
    state.lastExportDownloadId = null;
    btn.disabled = true;
    state.batchCancelled = false;
    const batchMode = chkBatch && chkBatch.checked;
    btn.textContent = batchMode ? "Preparing backup…" : "Scanning conversation…";
    btnCancel.classList.add("visible");
    btnCancel.disabled = false;
    if (btnPause) {
      state.batchPaused = false;
      btnPause.textContent = "Pause";
      btnPause.classList.remove("visible");
    }
    btnCancel.textContent = batchMode ? "Stop export" : "Stop scanning";
    status.className = "";
    status.textContent = "";
    syncBatchOptions();
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url?.match(/https:\/\/(chatgpt\.com|chat\.openai\.com)\//)) {
        showStatus("error", "Open a ChatGPT conversation page first.");
        return;
      }
      const downloadImages = chkImages && chkImages.checked;
      if (batchMode) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"]
        });
        var projectInfo = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: function() {
            var title = typeof extractConversationTitle === "function" ? extractConversationTitle() : null;
            var slug = title && typeof slugifyTitle === "function" ? slugifyTitle(title) : null;
            return { title, slug: slug || "project-batch" };
          }
        });
        var activeProjectId = projectIdFromLocation(tab.url);
        var projectSlug = activeProjectId ? projectInfo?.[0]?.result?.slug || "project-batch" : null;
        var batchStamp = formatExportTimestamp();
        await executeBatch(tab, {
          downloadImages,
          projectId: activeProjectId,
          projectSlug,
          batchStamp,
          buildZip: true,
          downloadHtml: !!(chkHtml && chkHtml.checked),
          onProgress: function(index, total, title) {
            btn.textContent = "Exporting " + formatBatchProgress(index, total, title);
          }
        });
        return;
      }
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });
      state.scanningTabId = tab.id;
      var loaded = await waitForLoadedConversation(tab.id, conversationIdFromLocation(tab.url), {
        contentTimeoutMs: 0,
        isCancelled: function() {
          return state.batchCancelled;
        },
        isPaused: function() {
          return false;
        },
        onWait: function() {
          btn.textContent = "Waiting for ChatGPT…";
        }
      });
      if (loaded.error === "cancelled" || loaded.rateLimited && !loaded.ready) {
        btnCancel.classList.remove("visible");
        showStatus(loaded.error === "cancelled" ? "warning" : "error", loaded.error === "cancelled" ? "Stopped." : loaded.error || "Could not load this conversation.");
        return;
      }
      startProgressPolling(tab.id);
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async (wantFiles) => getConversationMarkdown({ downloadFiles: wantFiles }),
        args: [!!downloadImages]
      });
      stopProgressPolling();
      btnCancel.classList.remove("visible");
      if (batchWarning)
        batchWarning.classList.remove("visible");
      const result = results?.[0]?.result;
      if (!result) {
        showStatus("error", "Could not get result from page.");
        return;
      }
      if (!result.ok) {
        showStatus("error", result.error || "Unknown error");
        return;
      }
      let md = result.md;
      const partialSuffix = result.partial ? " (partial export)" : "";
      var runStamp = formatExportTimestamp();
      var singleLog = createRunLog("single", {
        runId: runStamp,
        downloadImages,
        downloadHtml: !!(chkHtml && chkHtml.checked)
      });
      state.activeRunLog = singleLog;
      state.activeRunLogOptions = { downloadLog: !!(downloadImages || chkHtml && chkHtml.checked) };
      pushLogEvent(singleLog, {
        phase: "scan",
        outcome: result.partial ? "partial" : "ok",
        conversationId: conversationIdFromLocation(tab.url),
        title: result.title,
        counts: { lines: result.lines || 0 }
      });
      if (downloadImages && typeof chrome.downloads !== "undefined") {
        var saved = await saveConversationExport(tab.id, result, {
          downloadImages: true,
          useTimestamp: true,
          batchStamp: runStamp,
          projectSlug: null,
          zipEntries: null
        });
        var saveStatus = buildSaveStatus({
          saved,
          refs: parseArtifactRefs(md),
          lines: result.lines,
          words: result.words,
          partialSuffix
        });
        if (chkHtml && chkHtml.checked && typeof sessionFromExport === "function" && typeof layoutStaticSite === "function") {
          var projectMatch = String(tab.url || "").match(/\/g\/(g-p-[A-Za-z0-9]+)\//);
          var htmlSession = sessionFromExport({
            id: conversationIdFromLocation(tab.url),
            title: result.title,
            slug: result.slug,
            projectId: projectMatch ? projectMatch[1] : null,
            retrievedFiles: saved.savedFiles || []
          }, {
            md,
            title: result.title,
            slug: result.slug,
            partial: result.partial || saved.dlErrors && saved.dlErrors.length > 0
          });
          var htmlWithFiles = await publishHtmlSessions([htmlSession]);
          if (!htmlWithFiles.ok) {
            saveStatus.type = "error";
            saveStatus.text += `
HTML site not saved: ` + (htmlWithFiles.error || "the write did not complete");
          }
        }
        saveStatus.text += `
` + exportSavedLines(singleLog, !!(chkHtml && chkHtml.checked));
        showStatus(saveStatus.type, saveStatus.text);
        markExportFolderVisible();
        await flushRunLog(singleLog, state.activeRunLogOptions);
        btn.disabled = false;
        return;
      }
      if (chkHtml && chkHtml.checked && typeof sessionFromExport === "function" && typeof layoutStaticSite === "function") {
        var htmlOnly = sessionFromExport({
          id: conversationIdFromLocation(tab.url),
          title: result.title,
          slug: result.slug
        }, { md, title: result.title, slug: result.slug, partial: result.partial });
        var htmlWrite = await publishHtmlSessions([htmlOnly]);
        if (!htmlWrite.ok) {
          showStatus("error", "HTML site not saved: " + (htmlWrite.error || "the write did not complete"));
          btn.disabled = false;
          return;
        }
        var htmlPartialSuffix = result.partial || htmlOnly.partial ? " (partial export)" : "";
        showStatus(htmlPartialSuffix ? "warning" : "success", (htmlPartialSuffix ? "⚠ Saved incomplete HTML site" : "✓ Saved HTML site") + " " + result.lines + " lines · " + result.words + ` words
` + exportSavedLines(singleLog, true) + (htmlPartialSuffix ? `
Re-run to complete it.` : ""));
        markExportFolderVisible();
        await flushRunLog(singleLog, state.activeRunLogOptions);
        btn.disabled = false;
        return;
      }
      await navigator.clipboard.writeText(md);
      showStatus("success", "✓ Copied!" + partialSuffix + " " + result.lines + " lines · " + result.words + " words");
    } catch (err) {
      pushLogEvent(state.activeRunLog, {
        level: "error",
        phase: "single export",
        outcome: "exception",
        message: err && err.message || String(err),
        stack: err && err.stack
      });
      if (state.activeRunLog)
        await flushRunLog(state.activeRunLog, state.activeRunLogOptions);
      reportFailure("single export", err);
    } finally {
      state.activeRunLog = null;
      stopProgressPolling();
      state.scanningTabId = null;
      btnCancel.classList.remove("visible");
      if (batchWarning)
        batchWarning.classList.remove("visible");
      btn.disabled = false;
      if (btnPause && (!state.activeBatchJob || state.activeBatchJob.status === "done")) {
        btnPause.classList.remove("visible");
      }
      refreshExportButtonLabel();
    }
  });
  showSavedBatch();

  // src/popup/index.mjs
  globalThis.__c2mPopupApi = exports_controls;
  Object.assign(globalThis, exports_controls, { flushRunLog });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.__c2mPopupApi;
