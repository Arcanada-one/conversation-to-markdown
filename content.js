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

  // src/content/export.mjs
  var exports_export = {};
  __export(exports_export, {
    ATTACHMENT_CHIP_SELECTORS: () => ATTACHMENT_CHIP_SELECTORS,
    RATE_LIMIT_PAGE_ERROR: () => RATE_LIMIT_PAGE_ERROR,
    UNPREVIEWABLE_FORMATS: () => UNPREVIEWABLE_FORMATS,
    activeConversationRoot: () => activeConversationRoot,
    appendPanelArtifacts: () => appendPanelArtifacts,
    buildConversationMarkdown: () => buildConversationMarkdown,
    clickConversationRetry: () => clickConversationRetry,
    collectButtonDownloads: () => collectButtonDownloads,
    collectSidebarConversations: () => collectSidebarConversations,
    dedupeNamed: () => dedupeNamed,
    dismissViewerOverlay: () => dismissViewerOverlay,
    downloadButtonsInPage: () => downloadButtonsInPage,
    downloadNameFromUrl: () => downloadNameFromUrl,
    escapeKeydownEvent: () => escapeKeydownEvent,
    exportActiveSessionHtml: () => exportActiveSessionHtml,
    extractAttachments: () => extractAttachments,
    extractAttachmentsDetailed: () => extractAttachmentsDetailed,
    extractConversationTitle: () => extractConversationTitle,
    extractImages: () => extractImages,
    extractTurn: () => extractTurn,
    fetchConversationArtifacts: () => fetchConversationArtifacts,
    fetchConversationMetadata: () => fetchConversationMetadata,
    fetchImageDataUrls: () => fetchImageDataUrls,
    fetchSessionToken: () => fetchSessionToken,
    filterButtonsAgainstPanel: () => filterButtonsAgainstPanel,
    findButtonsByScrolling: () => findButtonsByScrolling,
    findCollapsedProjectRows: () => findCollapsedProjectRows,
    findConversationRetryControl: () => findConversationRetryControl,
    findHistoryRetryControl: () => findHistoryRetryControl,
    findScrollContainer: () => findScrollContainer,
    findShowMoreControl: () => findShowMoreControl,
    findSidebarScroller: () => findSidebarScroller,
    foldForNameMatching: () => foldForNameMatching,
    getConversationMarkdown: () => getConversationMarkdown,
    knownProjectName: () => knownProjectName,
    largestCoverageGap: () => largestCoverageGap,
    listArtifactPanelFiles: () => listArtifactPanelFiles,
    listSidebarConversations: () => listSidebarConversations,
    nodeToMarkdown: () => nodeToMarkdown,
    orderCapturedTurns: () => orderCapturedTurns,
    parseTurnOrder: () => parseTurnOrder,
    prefixPartialNotice: () => prefixPartialNotice,
    projectRowContainer: () => projectRowContainer,
    readModernPagination: () => readModernPagination,
    resolveArtifactPanelFiles: () => resolveArtifactPanelFiles,
    resolveSandboxDownloadUrl: () => resolveSandboxDownloadUrl,
    sandboxFilesFromMarkdown: () => sandboxFilesFromMarkdown,
    sandboxPathsFromApiMessage: () => sandboxPathsFromApiMessage,
    scanTurns: () => scanTurns,
    scrollToConversationStart: () => scrollToConversationStart,
    slugifyTitle: () => slugifyTitle,
    stripSidebarLabelSuffix: () => stripSidebarLabelSuffix,
    titleFromSidebarLink: () => titleFromSidebarLink,
    turnsOnRoot: () => turnsOnRoot,
    waitForArtifactPanel: () => waitForArtifactPanel,
    waitForConversationReady: () => waitForConversationReady
  });

  // src/content/markdown.mjs
  if (typeof globalThis !== "undefined")
    globalThis.__c2mContentScriptLoaded = true;
  function stripUrlQuery(url, allowedQueryNames) {
    const allowedNames = new Set(allowedQueryNames || []);
    for (const name of Array.from(url.searchParams.keys())) {
      if (!allowedNames.has(name))
        url.searchParams.delete(name);
    }
    return url;
  }
  function resolveHttpUrl(rawUrl, allowedQueryNames) {
    if (!rawUrl)
      return null;
    try {
      const baseUrl = typeof location !== "undefined" ? location.href : "https://chatgpt.com/";
      const resolved = new URL(rawUrl, baseUrl);
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:")
        return null;
      return stripUrlQuery(resolved, allowedQueryNames).href;
    } catch (_error) {
      return null;
    }
  }
  function resolveImageUrl(rawUrl) {
    if (!rawUrl)
      return null;
    try {
      const baseUrl = typeof location !== "undefined" ? location.href : "https://chatgpt.com/";
      const resolved = new URL(rawUrl, baseUrl);
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:")
        return null;
      if (resolved.hostname !== "files.oaiusercontent.com" && resolved.hostname !== "chatgpt.com" && resolved.hostname !== "chat.openai.com") {
        stripUrlQuery(resolved);
      }
      return resolved.href;
    } catch (_error) {
      return null;
    }
  }
  function artifactPlaceholder(kind, detail) {
    const label = detail ? " (" + detail + ")" : "";
    return `

*[` + kind + " artifact — not exported" + label + `]*

`;
  }
  function isKatexMathml(node) {
    const cls = node.className || "";
    return typeof cls === "string" && /\bkatex-mathml\b/.test(cls);
  }
  function isKatexRoot(node) {
    const cls = node.className || "";
    return typeof cls === "string" && /(?:^|\s)katex(?:\s|$)/.test(cls);
  }
  function isAttachmentChip(node) {
    return node.getAttribute && node.getAttribute("data-testid") === "file-chip";
  }
  function hrefFromAttachmentChip(node) {
    if (!node)
      return null;
    if (node.tagName && node.tagName.toLowerCase() === "a") {
      return node.getAttribute("href") || null;
    }
    if (typeof node.querySelector === "function") {
      const link = node.querySelector("a[href]");
      return link ? link.getAttribute("href") : null;
    }
    return null;
  }
  function labelFromAttachmentChip(node) {
    const text = (node.textContent || "").trim();
    if (text)
      return text;
    const href = hrefFromAttachmentChip(node);
    if (!href)
      return "attachment";
    try {
      const parts = new URL(href, "https://chatgpt.com/").pathname.split("/");
      return parts[parts.length - 1] || "attachment";
    } catch (_error) {
      return "attachment";
    }
  }
  function markdownDestination(href) {
    return /[()]/.test(href) ? "<" + href + ">" : href;
  }
  function markdownLabel(label) {
    return String(label).replace(/([\\\[\]])/g, "\\$1");
  }
  function markdownLink(label, href) {
    const safeLabel = (label || href).trim();
    return safeLabel ? "[" + markdownLabel(safeLabel) + "](" + markdownDestination(href) + ")" : href;
  }
  function nodeToMarkdown(node, depth) {
    if (depth === undefined)
      depth = 0;
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent;
    }
    if (node.nodeType !== Node.ELEMENT_NODE)
      return "";
    const tag = node.tagName.toLowerCase();
    const children = function() {
      return Array.from(node.childNodes).map(function(n) {
        return nodeToMarkdown(n, depth);
      }).join("");
    };
    if (node.getAttribute && node.getAttribute("data-file-reference") === "true") {
      const name = node.getAttribute("data-markdown-copy-text") || node.textContent || "";
      return "`" + name.replace(/`/g, "") + "`";
    }
    if (node.getAttribute && node.getAttribute("data-block-actions") !== null)
      return "";
    if (node.getAttribute && node.getAttribute("data-markdown-copy") === "code-block") {
      const code = node.querySelector && node.querySelector("code");
      if (code)
        return "```\n" + code.textContent.replace(/\n$/, "") + "\n```\n\n";
    }
    if (isKatexMathml(node))
      return "";
    if (isKatexRoot(node)) {
      const annotation = node.querySelector('annotation[encoding="application/x-tex"]');
      if (annotation && annotation.textContent) {
        const tex = annotation.textContent.trim();
        const display = node.parentElement && /\bkatex-display\b/.test(node.parentElement.className || "");
        return display ? `$$
` + tex + `
$$

` : "$" + tex + "$";
      }
      const htmlEl = node.querySelector(".katex-html");
      if (htmlEl)
        return nodeToMarkdown(htmlEl, depth);
      return children();
    }
    if (isAttachmentChip(node)) {
      const href = hrefFromAttachmentChip(node);
      if (!href)
        return labelFromAttachmentChip(node);
      if (href.startsWith("sandbox:")) {
        return "> **Attachment (Code Interpreter):** `" + href + `\`

`;
      }
      const absHref = resolveImageUrl(href);
      if (!absHref)
        return labelFromAttachmentChip(node);
      return markdownLink(labelFromAttachmentChip(node), absHref) + `

`;
    }
    switch (tag) {
      case "p":
        return children() + `

`;
      case "br":
        return `
`;
      case "strong":
      case "b":
        return "**" + children() + "**";
      case "em":
      case "i":
        return "*" + children() + "*";
      case "code": {
        const text = node.textContent;
        if (node.parentElement && node.parentElement.tagName.toLowerCase() === "pre")
          return text;
        return "`" + text + "`";
      }
      case "pre": {
        const codeEl = node.querySelector("code");
        const lang = codeEl ? (codeEl.className.match(/language-(\S+)/) || [])[1] || "" : "";
        const text = codeEl ? codeEl.textContent : node.textContent;
        return "```" + lang + `
` + text + "\n```\n\n";
      }
      case "h1":
        return "# " + children() + `

`;
      case "h2":
        return "## " + children() + `

`;
      case "h3":
        return "### " + children() + `

`;
      case "h4":
        return "#### " + children() + `

`;
      case "h5":
        return "##### " + children() + `

`;
      case "h6":
        return "###### " + children() + `

`;
      case "ul": {
        var items = Array.from(node.children).map(function(li) {
          return "- " + nodeToMarkdown(li, depth + 1).trim();
        }).join(`
`);
        return items + `

`;
      }
      case "ol": {
        var items = Array.from(node.children).map(function(li, i) {
          return i + 1 + ". " + nodeToMarkdown(li, depth + 1).trim();
        }).join(`
`);
        return items + `

`;
      }
      case "li":
        return children();
      case "blockquote":
        return children().split(`
`).map(function(l) {
          return "> " + l;
        }).join(`
`) + `

`;
      case "a": {
        const href = node.getAttribute("href") || "";
        const text = children().trim();
        if (!href)
          return text;
        if (href.startsWith("sandbox:")) {
          const label = text || href.replace(/^sandbox:/, "");
          return "> **Code Interpreter file:** `" + href + "`" + (label && label !== href ? " (" + label + ")" : "") + `

`;
        }
        const absHref = resolveHttpUrl(href);
        if (!absHref)
          return text;
        return text ? markdownLink(text, absHref) : absHref;
      }
      case "img": {
        if (node.getAttribute("aria-hidden") === "true")
          return "";
        const src = node.getAttribute("src") || "";
        if (!src || src.startsWith("data:") || src.startsWith("blob:"))
          return "";
        if (src.includes("favicon") || src.includes("s2/favicons"))
          return "";
        const absSrc = resolveImageUrl(src);
        if (!absSrc)
          return "";
        const alt = (node.getAttribute("alt") || "").trim();
        return "![" + markdownLabel(alt) + "](" + markdownDestination(absSrc) + `)

`;
      }
      case "hr":
        return `---

`;
      case "table": {
        const rows = Array.from(node.querySelectorAll("tr"));
        if (!rows.length)
          return "";
        const parseRow = function(row) {
          return Array.from(row.querySelectorAll("th, td")).map(function(cell) {
            return cell.textContent.trim();
          }).join(" | ");
        };
        const header = parseRow(rows[0]);
        const sep = header.split(" | ").map(function() {
          return "---";
        }).join(" | ");
        const body = rows.slice(1).map(parseRow).join(`
`);
        return "| " + header + ` |
| ` + sep + ` |
` + (body ? body.split(`
`).map(function(r) {
          return "| " + r + " |";
        }).join(`
`) + `
` : "") + `
`;
      }
      case "canvas":
        return artifactPlaceholder("canvas");
      case "audio":
        return artifactPlaceholder("audio");
      case "video":
        return artifactPlaceholder("video");
      case "svg":
        if (node.getAttribute("aria-hidden") === "true")
          return "";
        return artifactPlaceholder("svg");
      case "button": {
        if (node.getAttribute("data-testid") === "chatgpt-library-file-citation") {
          const label = node.getAttribute("aria-label") || "";
          const name = /([^\s/\\]+\.(?:md|txt|pdf|docx?|xlsx?|csv|json|zip|png|jpe?g))$/i.exec(label);
          if (name)
            return " `" + name[1].replace(/`/g, "") + "` (referenced file; not downloaded)";
        }
        return "";
      }
      default:
        return children();
    }
  }
  function extractImages(section) {
    const seenSrcs = new Set;
    const results = [];
    const imgEls = section.querySelectorAll("img");
    for (const img of imgEls) {
      if (img.getAttribute("aria-hidden") === "true")
        continue;
      const src = img.getAttribute("src") || "";
      if (!src || src.startsWith("data:") || src.startsWith("blob:"))
        continue;
      if (src.includes("favicon") || src.includes("s2/favicons"))
        continue;
      if (typeof img.closest === "function" && (img.closest(".markdown") || img.closest('[class*="prose"]')))
        continue;
      const absSrc = resolveImageUrl(src);
      if (!absSrc)
        continue;
      if (seenSrcs.has(absSrc))
        continue;
      seenSrcs.add(absSrc);
      const alt = (img.getAttribute("alt") || "").trim();
      results.push("![" + markdownLabel(alt) + "](" + markdownDestination(absSrc) + ")");
    }
    return results;
  }
  var ATTACHMENT_CHIP_SELECTORS = [
    '[data-testid="file-chip"]',
    '[data-testid*="file-chip"]',
    '[data-testid*="attachment"]',
    'a[href*="/files/"]',
    'a[href*="/backend-api/files/"]',
    'a[href*="files.oaiusercontent.com"]'
  ];
  function isConversationFileUrl(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_e) {
      return false;
    }
    if (parsed.protocol !== "https:")
      return false;
    if (parsed.hostname === "files.oaiusercontent.com")
      return true;
    if (parsed.hostname === "chatgpt.com" || parsed.hostname === "chat.openai.com") {
      return parsed.pathname.indexOf("/files/") !== -1 || parsed.pathname.indexOf("/estuary/") !== -1;
    }
    return false;
  }
  function extractAttachmentsDetailed(section) {
    const seenHrefs = new Set;
    const results = [];
    const empty = { links: results, matchedBy: null, primaryMatched: false };
    if (!section || !section.querySelectorAll)
      return empty;
    let chips = [];
    let matchedBy = null;
    for (const selector of ATTACHMENT_CHIP_SELECTORS) {
      let found;
      try {
        found = section.querySelectorAll(selector);
      } catch (_e) {
        continue;
      }
      const list = found ? Array.from(found) : [];
      if (list.length) {
        chips = list;
        matchedBy = selector;
        break;
      }
    }
    const usedFallbackHrefMatch = matchedBy !== null && matchedBy !== ATTACHMENT_CHIP_SELECTORS[0] && matchedBy.indexOf("href") !== -1;
    for (const chip of chips) {
      if (typeof chip.closest === "function" && (chip.closest(".markdown") || chip.closest('[class*="prose"]'))) {
        continue;
      }
      const href = hrefFromAttachmentChip(chip);
      if (!href || href.startsWith("sandbox:"))
        continue;
      const absHref = resolveImageUrl(href);
      if (!absHref || seenHrefs.has(absHref))
        continue;
      if (usedFallbackHrefMatch && !isConversationFileUrl(absHref))
        continue;
      seenHrefs.add(absHref);
      results.push(markdownLink(labelFromAttachmentChip(chip), absHref));
    }
    return {
      links: results,
      matchedBy,
      primaryMatched: matchedBy === ATTACHMENT_CHIP_SELECTORS[0]
    };
  }
  function extractAttachments(section) {
    return extractAttachmentsDetailed(section).links;
  }

  // src/content/artifacts.mjs
  async function fetchSessionToken(fetchImpl) {
    const doFetch = fetchImpl || (typeof fetch === "function" ? fetch : null);
    if (!doFetch)
      return null;
    try {
      const response = await doFetch("/api/auth/session", {
        credentials: "include",
        headers: { accept: "application/json" }
      });
      if (!response || !response.ok)
        return null;
      const body = await response.json();
      return body && body.accessToken || null;
    } catch (_e) {
      return null;
    }
  }
  function metadataFromConversationBody(body) {
    if (!body || typeof body !== "object")
      return null;
    const updateTime = typeof body.update_time === "number" && Number.isFinite(body.update_time) ? body.update_time : null;
    const currentNode = body.current_node ? String(body.current_node) : null;
    const paged = !body.mapping && body.page_info && (body.page_info.has_previous_page || body.page_info.has_next_page);
    let messageCount = null;
    if (!paged && body.mapping && typeof body.mapping === "object") {
      messageCount = 0;
      for (const key of Object.keys(body.mapping)) {
        if (body.mapping[key] && body.mapping[key].message)
          messageCount += 1;
      }
    } else if (!paged && Array.isArray(body.messages)) {
      messageCount = 0;
      for (const message of body.messages) {
        if (message)
          messageCount += 1;
      }
    }
    if (updateTime === null && !currentNode && messageCount === null)
      return null;
    return {
      updateTime,
      currentNode,
      messageCount
    };
  }
  async function fetchConversationMetadata(conversationId, options) {
    const opts = options || {};
    const doFetch = opts.fetchImpl || (typeof fetch === "function" ? fetch : null);
    if (!doFetch || !conversationId)
      return null;
    const token = opts.token !== undefined ? opts.token : await fetchSessionToken(doFetch);
    if (!token)
      return null;
    const init = {
      credentials: "include",
      headers: { accept: "application/json", Authorization: "Bearer " + token }
    };
    const id = encodeURIComponent(conversationId);
    let meta = null;
    try {
      const response = await doFetch("/backend-api/conversation/" + id, init);
      if (response && response.ok)
        meta = metadataFromConversationBody(await response.json());
    } catch (_e) {
      meta = null;
    }
    if (meta)
      return meta;
    try {
      const modern = await doFetch("/backend-api/conversations/" + id + "?num_turns=10&include_has_versions=true", init);
      if (!modern || !modern.ok)
        return null;
      return metadataFromConversationBody(await modern.json());
    } catch (_e) {
      return null;
    }
  }
  function sandboxPathsFromApiMessage(message) {
    const content = message && message.content || {};
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const chunks = [];
    for (const part of parts) {
      if (typeof part === "string")
        chunks.push(part);
    }
    if (typeof content.text === "string")
      chunks.push(content.text);
    const text = chunks.join(`
`);
    const out = [];
    const seen = new Set;
    const pattern = /(?:sandbox:(\/[^\s`)\]}"'\\,;]+)|(\/mnt\/data\/[^\s`)\]}"'\\,;]+))/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const sandboxPath = (match[1] || match[2]).replace(/[.]+$/, "");
      if (!sandboxPath || seen.has(sandboxPath))
        continue;
      const name = sandboxPath.split("/").pop();
      if (!name)
        continue;
      seen.add(sandboxPath);
      out.push({ name, sandboxPath });
    }
    return out;
  }
  async function fetchConversationArtifacts(conversationId, options) {
    const opts = options || {};
    const doFetch = opts.fetchImpl || (typeof fetch === "function" ? fetch : null);
    if (!doFetch || !conversationId)
      return null;
    const token = opts.token !== undefined ? opts.token : await fetchSessionToken(doFetch);
    if (!token)
      return null;
    let payload;
    const init = {
      credentials: "include",
      headers: { accept: "application/json", authorization: "Bearer " + token }
    };
    try {
      const response = await doFetch("/backend-api/conversation/" + conversationId, init);
      if (response && response.ok)
        payload = await response.json();
      if (!payload || !payload.mapping && !Array.isArray(payload.messages)) {
        const modern = await doFetch("/backend-api/conversations/" + conversationId + "?num_turns=10&include_has_versions=true", init);
        if (!modern || !modern.ok)
          return null;
        payload = await modern.json();
      }
    } catch (_e) {
      return null;
    }
    if (!payload || !payload.mapping && !Array.isArray(payload.messages))
      return null;
    if (!payload.mapping && payload.page_info && (payload.page_info.has_previous_page || payload.page_info.has_next_page))
      return null;
    const artifacts = [];
    const seen = new Set;
    const messages = payload.mapping ? Object.values(payload.mapping).map(function(node) {
      return node && node.message;
    }) : payload.messages;
    for (const message of messages) {
      if (!message)
        continue;
      const messageId = message.id || null;
      const metadata = message.metadata || {};
      const role = (message.author || {}).role || "";
      const isAssistantInstruction = role === "assistant" && (message.recipient && message.recipient !== "all" || (message.content || {}).content_type === "code" || message.channel === "analysis");
      if (role !== "user" && !isAssistantInstruction) {
        for (const found of sandboxPathsFromApiMessage(message)) {
          const key = "sbx:" + found.sandboxPath;
          const parts = (message.content || {}).parts || [];
          const chunks = (Array.isArray(parts) ? parts : []).concat((message.content || {}).text || "");
          const offered = chunks.some(function(part) {
            return typeof part === "string" && part.indexOf("sandbox:" + found.sandboxPath) !== -1;
          });
          const priority = offered ? 0 : role === "assistant" ? 1 : 2;
          if (seen.has(key)) {
            const existing = artifacts.find(function(a) {
              return a.sandboxPath === found.sandboxPath;
            });
            if (existing && priority < existing.priority) {
              existing.priority = priority;
              existing.messageId = messageId;
            }
            continue;
          }
          seen.add(key);
          artifacts.push({
            kind: "sandbox",
            priority,
            messageId,
            name: found.name,
            fileId: null,
            mimeType: null,
            size: null,
            sandboxPath: found.sandboxPath
          });
        }
      }
      for (const attachment of metadata.attachments || []) {
        const key = "att:" + (attachment.id || attachment.name);
        if (!attachment.name || seen.has(key))
          continue;
        seen.add(key);
        artifacts.push({
          kind: "attachment",
          messageId,
          name: attachment.name,
          fileId: attachment.id || null,
          mimeType: attachment.mime_type || null,
          size: typeof attachment.size === "number" ? attachment.size : null,
          sandboxPath: null
        });
      }
      const parts = (message.content || {}).parts || [];
      for (const part of parts) {
        if (!part || typeof part !== "object" || !part.asset_pointer)
          continue;
        const pointer = String(part.asset_pointer);
        if (seen.has("ast:" + pointer))
          continue;
        seen.add("ast:" + pointer);
        artifacts.push({
          kind: "asset",
          messageId,
          name: part.name || null,
          fileId: (pointer.match(/(file[-_][A-Za-z0-9]+)/) || [])[1] || null,
          mimeType: part.mime_type || null,
          size: typeof part.size === "number" ? part.size : null,
          sandboxPath: null
        });
      }
    }
    return artifacts;
  }
  async function resolveSandboxDownloadUrl(conversationId, messageId, sandboxPath, options) {
    const opts = options || {};
    const doFetch = opts.fetchImpl || (typeof fetch === "function" ? fetch : null);
    if (!doFetch || !conversationId || !messageId || !sandboxPath)
      return null;
    const token = opts.token !== undefined ? opts.token : await fetchSessionToken(doFetch);
    if (!token)
      return null;
    const url = "/backend-api/conversation/" + conversationId + "/interpreter/download?message_id=" + encodeURIComponent(messageId) + "&sandbox_path=" + encodeURIComponent(sandboxPath);
    return requestArtifactDownloadUrl(url, doFetch, token, opts);
  }
  async function resolveUploadedDownloadUrl(conversationId, fileId, options) {
    const opts = options || {};
    const doFetch = opts.fetchImpl || (typeof fetch === "function" ? fetch : null);
    if (!doFetch || !conversationId || !fileId)
      return null;
    const token = opts.token !== undefined ? opts.token : await fetchSessionToken(doFetch);
    if (!token)
      return null;
    const url = "/backend-api/files/download/" + encodeURIComponent(fileId) + "?conversation_id=" + encodeURIComponent(conversationId) + "&download_intent=true";
    return requestArtifactDownloadUrl(url, doFetch, token, opts);
  }
  async function requestArtifactDownloadUrl(url, doFetch, token, opts) {
    const fail = function(kind, host) {
      if (typeof opts.onFailure === "function")
        opts.onFailure(kind, host);
      return null;
    };
    let step = "request";
    try {
      const response = await doFetch(url, {
        credentials: "include",
        headers: { accept: "application/json", authorization: "Bearer " + token }
      });
      if (!response || !response.ok)
        return fail("http-error");
      step = "json";
      const body = await response.json();
      const resolved = body && (body.download_url || body.url);
      if (typeof resolved !== "string" || !resolved)
        return fail("missing-url");
      if (!isConversationFileUrl(resolved)) {
        let host = "";
        try {
          host = new URL(resolved).hostname;
        } catch (_e) {}
        return fail("rejected-url", host);
      }
      return {
        url: resolved,
        fileName: body && body.file_name || null,
        mimeType: body && body.mime_type || null,
        size: body && typeof body.file_size_bytes === "number" ? body.file_size_bytes : null
      };
    } catch (_e) {
      return fail(step === "json" ? "unreadable-json" : "request-error");
    }
  }
  async function resolveArtifactPanelFiles(conversationId, options) {
    const opts = options || {};
    const files = opts.files || listArtifactPanelFiles(opts.doc);
    if (!files.length)
      return [];
    const doFetch = opts.fetchImpl || (typeof fetch === "function" ? fetch : null);
    const token = opts.token !== undefined ? opts.token : await fetchSessionToken(doFetch);
    if (!token)
      return files.map((f) => ({ file: f, resolved: null }));
    const messageIds = Array.from(new Set(opts.messageIds || []));
    let workingId = opts.messageId || null;
    const out = [];
    for (const file of files) {
      let resolved = null;
      const candidates = file.messageId ? [file.messageId] : Array.from(new Set([workingId].concat(messageIds).filter(Boolean)));
      if (file.kind === "attachment") {
        resolved = await resolveUploadedDownloadUrl(conversationId, file.fileId, {
          fetchImpl: doFetch,
          token,
          onFailure: opts.onFailure
        });
      }
      for (const candidate of file.kind === "attachment" ? [] : candidates) {
        const attempt = await resolveSandboxDownloadUrl(conversationId, candidate, file.sandboxPath, {
          fetchImpl: doFetch,
          token,
          onFailure: opts.onFailure
        });
        if (attempt) {
          workingId = candidate;
          resolved = attempt;
          break;
        }
      }
      const entry = { file, resolved };
      out.push(entry);
      if (typeof opts.onResolved === "function")
        opts.onResolved(entry);
    }
    return out;
  }
  async function waitForArtifactPanel(doc, options) {
    const opts = options || {};
    const root = doc || (typeof document !== "undefined" ? document : null);
    const budgetMs = opts.panelWaitMs === undefined ? 15000 : opts.panelWaitMs;
    const stepMs = opts.panelPollMs === undefined ? 500 : opts.panelPollMs;
    const stablePolls = opts.panelStablePolls === undefined ? 2 : opts.panelStablePolls;
    const sleep = opts.sleep || function(ms) {
      return new Promise(function(resolve) {
        setTimeout(resolve, ms);
      });
    };
    const now = opts.now || function() {
      return Date.now();
    };
    const deadline = now() + budgetMs;
    let files = listArtifactPanelFiles(root);
    while (!files.length && now() < deadline) {
      await sleep(stepMs);
      files = listArtifactPanelFiles(root);
    }
    if (!files.length)
      return files;
    const byName = new Map;
    for (const file of files)
      byName.set(file.name, file);
    let steady = 0;
    while (steady < stablePolls && now() < deadline) {
      await sleep(stepMs);
      let added = 0;
      for (const file of listArtifactPanelFiles(root)) {
        if (byName.has(file.name))
          continue;
        byName.set(file.name, file);
        added += 1;
      }
      steady = added > 0 ? 0 : steady + 1;
    }
    return Array.from(byName.values());
  }
  function listArtifactPanelFiles(doc) {
    const root = doc || (typeof document !== "undefined" ? document : null);
    if (!root || !root.querySelectorAll)
      return [];
    let buttons;
    try {
      buttons = root.querySelectorAll('button[class*="open-file"], [class*="artifact-row"] button');
    } catch (_e) {
      return [];
    }
    const files = [];
    const seen = new Set;
    for (const button of buttons) {
      const label = button.getAttribute ? button.getAttribute("aria-label") || "" : "";
      if (!/\.[A-Za-z0-9]{1,8}$/.test(label) || seen.has(label))
        continue;
      seen.add(label);
      files.push({ name: label, sandboxPath: "/mnt/data/" + label });
    }
    return files;
  }

  // src/content/turns.mjs
  function orderCapturedTurns(turns) {
    const ordered = turns instanceof Map ? Array.from(turns.values()) : Array.from(turns);
    const hasCompleteNumericOrder = ordered.every(function(turn) {
      return turn.order !== null && turn.order !== undefined;
    });
    return ordered.sort(function(a, b) {
      if (hasCompleteNumericOrder && a.order !== b.order)
        return a.order - b.order;
      return a.discoveryIndex - b.discoveryIndex;
    });
  }
  function parseTurnOrder(testId) {
    const match = String(testId || "").match(/^conversation-turn-(\d+)$/);
    return match ? Number(match[1]) : null;
  }
  function buildConversationMarkdown(turns) {
    const parts = [];
    for (const turn of turns) {
      if (!turn.markdown)
        continue;
      if (turn.role === "user")
        parts.push(`#### You said:

` + turn.markdown);
      if (turn.role === "assistant")
        parts.push(`#### ChatGPT said:

` + turn.markdown);
    }
    return parts.length ? parts.join(`

---

`) : null;
  }
  function modernMessageRole(section) {
    if (!section.getAttribute || section.getAttribute("data-chatgpt-search-unit-key") === null)
      return null;
    if (section.querySelector("[data-user-message-bubble]"))
      return "user";
    if (section.querySelector("[data-conversation-role]") && section.querySelector("[data-chatgpt-selection-message-id]"))
      return "assistant";
    return null;
  }
  function modernMessageSections(root) {
    if (!root || !root.querySelectorAll)
      return [];
    return Array.from(root.querySelectorAll("[data-chatgpt-search-unit-key]")).filter(function(unit) {
      return unit.closest && unit.closest("[data-turn-key]");
    });
  }
  function readModernPagination(container) {
    const root = container.querySelector && container.querySelector('[data-thread-find-target="conversation"]');
    if (!root || root.getAttribute("data-chatgpt-conversation-selection-target") !== "true")
      return null;
    const children = Array.from(root.children || []);
    const separatorIndex = children.findIndex(function(el) {
      return el.tagName === "SPAN" && el.getAttribute("hidden") !== null;
    });
    if (separatorIndex < 0)
      return null;
    const virtualizer = children[separatorIndex + 1];
    const list = virtualizer && virtualizer.children && virtualizer.children[0];
    const slot = list && list.children && list.children[0];
    if (!virtualizer || !virtualizer.style || !virtualizer.style.height || !slot)
      return null;
    const pending = children.slice(0, separatorIndex).some(function(el) {
      return el.getAttribute("role") === "status" || !!el.querySelector('[role="status"]');
    });
    const first = modernMessageSections(root)[0];
    const firstInSlot = modernMessageSections(slot)[0];
    const atFirstSlot = !!first && first === firstInSlot && list.style && slot.style && list.style.marginTop === "0px" && slot.style.marginTop === "0px";
    return {
      pending,
      loading: false,
      count: modernMessageSections(root).length,
      complete: !pending && atFirstSlot && conversationScrollTop(container) <= 1
    };
  }
  function extractModernMessage(section, discoveryIndex) {
    const role = modernMessageRole(section);
    const turnId = getSectionTurnId(section);
    if (!role || !turnId)
      return null;
    let markdown;
    if (role === "user") {
      const bubble = section.querySelector("[data-user-message-bubble]");
      markdown = Array.from(bubble.querySelectorAll(".whitespace-pre-wrap")).map(function(node) {
        return node.textContent.trim();
      }).filter(Boolean).join(`

`);
      const attachments = extractAttachments(section).concat(extractImages(section));
      if (attachments.length)
        markdown += (markdown ? `

` : "") + attachments.join(`

`);
    } else {
      const message = section.querySelector("[data-chatgpt-selection-message-id]");
      markdown = Array.from(message.querySelectorAll("[data-markdown-text-style]")).filter(function(node) {
        return !node.parentElement || !node.parentElement.closest("[data-markdown-text-style]");
      }).map(function(node) {
        return nodeToMarkdown(node).trim();
      }).filter(Boolean).join(`

`);
      for (const extra of extractAttachments(section).concat(extractImages(section))) {
        if (!markdown.includes(extra))
          markdown += (markdown ? `

` : "") + extra;
      }
    }
    if (!markdown)
      return null;
    return createTurn(turnId, section, discoveryIndex, role, markdown.replace(/\n{3,}/g, `

`));
  }
  function getSectionTurnId(section) {
    if (typeof section.getAttribute === "function") {
      const legacy = section.getAttribute("data-turn-id") || section.turnId;
      if (legacy)
        return legacy;
      const unitKey = section.getAttribute("data-chatgpt-search-unit-key");
      const holder = unitKey !== null && section.closest && section.closest("[data-turn-key]");
      return holder ? JSON.stringify([holder.getAttribute("data-turn-key"), unitKey]) : null;
    }
    return section.turnId || null;
  }
  function getSectionRole(section) {
    const directRole = section.getAttribute("data-turn");
    if (directRole === "user" || directRole === "assistant")
      return directRole;
    const message = section.querySelector("[data-message-author-role]");
    if (!message)
      return null;
    const childRole = message.getAttribute("data-message-author-role");
    return childRole === "user" || childRole === "assistant" ? childRole : null;
  }
  function isExplicitlyUnsupportedTurn(section) {
    if (typeof section.getAttribute !== "function") {
      return Boolean(section.role && section.role !== "user" && section.role !== "assistant");
    }
    const directRole = section.getAttribute("data-turn");
    if (directRole)
      return directRole !== "user" && directRole !== "assistant";
    const message = section.querySelector("[data-message-author-role]");
    if (!message)
      return false;
    const childRole = message.getAttribute("data-message-author-role");
    return Boolean(childRole && childRole !== "user" && childRole !== "assistant");
  }
  function extractTurn(section, discoveryIndex) {
    if (section.getAttribute && section.getAttribute("data-chatgpt-search-unit-key") !== null) {
      return extractModernMessage(section, discoveryIndex);
    }
    const turnId = getSectionTurnId(section);
    const role = getSectionRole(section);
    if (!turnId)
      return null;
    if (role === "user") {
      const message = section.querySelector('[data-message-author-role="user"]');
      const bubble = message && (message.querySelector(".whitespace-pre-wrap") || message.querySelector('[dir="auto"]') || message);
      const text = bubble ? bubble.textContent.trim() : "";
      const userImages = extractImages(section);
      const userAttachments = extractAttachments(section);
      if (!text && !userImages.length && !userAttachments.length)
        return null;
      const parts = [];
      if (text)
        parts.push(text);
      if (userAttachments.length)
        parts.push(userAttachments.join(`

`));
      if (userImages.length)
        parts.push(userImages.join(`

`));
      return createTurn(turnId, section, discoveryIndex, role, parts.join(`

`));
    }
    if (role === "assistant") {
      const pieces = extractAttachments(section).concat(extractImages(section));
      const fragments = [];
      const messages = section.querySelectorAll('[data-message-author-role="assistant"]');
      for (const message of messages) {
        const markdownRoot = message.querySelector(".markdown") || message.querySelector('[class*="prose"]') || message;
        const markdown = nodeToMarkdown(markdownRoot).trim().replace(/\n{3,}/g, `

`);
        if (markdown)
          fragments.push(markdown);
      }
      if (!fragments.length) {
        const orphanRoots = section.querySelectorAll('.markdown, [class*="prose"]');
        for (const root of orphanRoots) {
          if (root.parentElement && root.parentElement.closest('.markdown, [class*="prose"]'))
            continue;
          const markdown = nodeToMarkdown(root).trim().replace(/\n{3,}/g, `

`);
          if (markdown)
            fragments.push(markdown);
        }
      }
      if (fragments.length)
        pieces.push(fragments.join(`

`));
      if (!pieces.length)
        return null;
      return createTurn(turnId, section, discoveryIndex, role, pieces.join(`

`));
    }
    return null;
  }
  function createTurn(turnId, section, discoveryIndex, role, markdown) {
    return {
      turnId,
      order: parseTurnOrder(section.getAttribute("data-testid")),
      discoveryIndex,
      role,
      markdown
    };
  }

  // src/content/scroll.mjs
  function findScrollContainer(startElement) {
    let current = startElement ? startElement.parentElement : null;
    while (current) {
      const style = getComputedStyle(current);
      if (/(auto|scroll|overlay)/.test(style.overflowY) && current.scrollHeight > current.clientHeight + 1) {
        return current;
      }
      current = current.parentElement;
    }
    if (typeof document === "undefined")
      return null;
    return document.scrollingElement || document.documentElement;
  }
  function reverseConversationScroll(target) {
    const view = target.ownerDocument && target.ownerDocument.defaultView;
    const style = view && view.getComputedStyle ? view.getComputedStyle(target) : typeof getComputedStyle === "function" ? getComputedStyle(target) : null;
    return !!style && style.flexDirection === "column-reverse";
  }
  function conversationScrollMax(target) {
    return Math.max(0, target.scrollHeight - target.clientHeight);
  }
  function conversationScrollTop(target) {
    return reverseConversationScroll(target) ? target.scrollTop + conversationScrollMax(target) : target.scrollTop;
  }
  function nativeConversationScrollTop(target, top) {
    const maxTop = conversationScrollMax(target);
    const logicalTop = Math.max(0, Math.min(top, maxTop));
    return reverseConversationScroll(target) ? logicalTop - maxTop : logicalTop;
  }
  function waitForScrollPosition(target, requestedTop, behavior, timeoutMs) {
    if (typeof requestAnimationFrame !== "function")
      return Promise.resolve();
    return new Promise(function(resolve, reject) {
      const startedAt = Date.now();
      let stableFrames = 0;
      let previousTop = target.scrollTop;
      let lastReachableTop = nativeConversationScrollTop(target, requestedTop);
      function check() {
        const reachableTop = nativeConversationScrollTop(target, requestedTop);
        const targetChanged = Math.abs(reachableTop - lastReachableTop) >= 1;
        if (targetChanged) {
          lastReachableTop = reachableTop;
          target.scrollTo({ top: reachableTop, behavior });
        }
        const currentTop = target.scrollTop;
        const topMoved = Math.abs(currentTop - previousTop) >= 1;
        if (!topMoved) {
          stableFrames += 1;
        } else {
          stableFrames = 0;
        }
        if (Math.abs(currentTop - reachableTop) < 2 && stableFrames >= 2)
          return resolve();
        if (Date.now() - startedAt >= timeoutMs) {
          return reject(new Error("Conversation scroll did not settle before timeout."));
        }
        previousTop = currentTop;
        requestAnimationFrame(check);
      }
      requestAnimationFrame(check);
    });
  }
  async function scrollToConversationPosition(target, top, behavior) {
    const expectedTop = nativeConversationScrollTop(target, top);
    target.scrollTo({ top: expectedTop, behavior });
    try {
      await waitForScrollPosition(target, top, behavior, 8000);
    } catch (_e) {
      target.scrollTo({ top: nativeConversationScrollTop(target, top), behavior: "auto" });
      await new Promise(function(r) {
        return setTimeout(r, 1500);
      });
    }
  }
  async function scrollToConversationStart(container, options) {
    const opts = options || {};
    const sleep = opts.sleep || function(ms) {
      return new Promise(function(r) {
        return setTimeout(r, ms);
      });
    };
    const scrollTo = opts.scrollTo || scrollToConversationPosition;
    const readFirstTurn = opts.readFirstTurn || function(target) {
      return target.querySelector ? target.querySelector("[data-turn-id]") : null;
    };
    const readFirstTurnId = opts.readFirstTurnId || function(target) {
      const first = readFirstTurn(target);
      return first && first.getAttribute ? first.getAttribute("data-turn-id") : null;
    };
    const readPagination = opts.readPagination || function(target) {
      if (!target.querySelector || !target.querySelectorAll)
        return null;
      const candidate = target.querySelector('[data-testid="conversation-pagination-sentinel"]');
      const sentinel = candidate && candidate.getAttribute && candidate.getAttribute("data-testid") === "conversation-pagination-sentinel" ? candidate : null;
      const root = target.querySelector('[data-turn-id-container="client-created-root"]');
      const paginatedRoot = target.querySelector('div[data-turn-id-container^="paginated-root:"]');
      const knownLayout = root && root.getAttribute && root.getAttribute("data-turn-id-container") === "client-created-root" || paginatedRoot && paginatedRoot.tagName === "DIV" && paginatedRoot.getAttribute("data-turn-id-container").indexOf("paginated-root:") === 0 && !paginatedRoot.querySelector("[data-turn-id]");
      if (!sentinel && !knownLayout)
        return null;
      const holders = Array.from(target.querySelectorAll("div[data-turn-id-container]")).filter(function(el) {
        const id = el.getAttribute("data-turn-id-container");
        return id && id !== "client-created-root" && id.indexOf("paginated-root") !== 0;
      });
      const first = readFirstTurn(target);
      const held = holders[0] && holders[0].querySelector("[data-turn-id]");
      const atFirstHolder = !!first && !!held && (held === first || !!held.getAttribute("data-turn-id") && held.getAttribute("data-turn-id") === first.getAttribute("data-turn-id"));
      return {
        pending: !!sentinel,
        loading: !!(sentinel && sentinel.querySelector("svg")),
        count: holders.length,
        complete: !sentinel && !!knownLayout && atFirstHolder && conversationScrollTop(target) <= 1
      };
    };
    const markerFromAncestors = function(node) {
      let el = node;
      for (let depth = 0;el && depth < 12; depth += 1) {
        const value = el.getAttribute ? el.getAttribute("data-turn-id-container") : null;
        if (typeof value === "string" && value.indexOf("paginated-root") === 0)
          return value;
        el = el.parentElement || null;
      }
      return null;
    };
    const readsAtStart = opts.readsAtStart || function(target) {
      const first = readFirstTurn(target);
      if (!first)
        return false;
      if (markerFromAncestors(first))
        return true;
      if (!target.querySelector)
        return false;
      const marked = target.querySelector('[data-turn-id-container^="paginated-root"]');
      if (!marked)
        return false;
      const inside = marked.querySelector ? marked.querySelector("[data-turn-id]") : null;
      if (!inside)
        return false;
      if (inside === first)
        return true;
      const a = inside.getAttribute ? inside.getAttribute("data-turn-id") : null;
      const b = first.getAttribute ? first.getAttribute("data-turn-id") : null;
      return !!a && a === b;
    };
    const publishesMarker = opts.publishesMarker || function(target) {
      if (target.querySelector && target.querySelector('[data-turn-id-container^="paginated-root"]')) {
        return true;
      }
      const first = readFirstTurn(target);
      if (!first || !first.getAttribute)
        return false;
      return typeof first.getAttribute("data-turn-id-container") === "string";
    };
    const settleMs = opts.settleMs === undefined ? 400 : opts.settleMs;
    const stableRounds = opts.stableRounds === undefined ? 3 : opts.stableRounds;
    const noProgressRounds = opts.noProgressRounds === undefined ? 40 : opts.noProgressRounds;
    const noMarkerRounds = opts.noMarkerRounds === undefined ? 6 : opts.noMarkerRounds;
    const maxRounds = opts.maxRounds === undefined ? 0 : opts.maxRounds;
    const maxClimbMs = opts.maxClimbMs === undefined ? 600000 : opts.maxClimbMs;
    const clock = opts.now || (typeof Date !== "undefined" ? Date.now : function() {
      return 0;
    });
    const startedAt = clock();
    const countTurns = opts.countTurns || function(target) {
      const all = target.querySelectorAll ? target.querySelectorAll("[data-turn-id]") : [];
      return all.length || 0;
    };
    let steady = 0;
    let previousFirstId = null;
    let rounds = 0;
    let confirmed = false;
    let confirmedByPagination = false;
    let sawPagination = false;
    let sinceProgress = 0;
    let bestFirstId = null;
    let seenTurnIds = 0;
    let ranOutOfTime = false;
    for (let i = 0;maxRounds === 0 || i < maxRounds; i += 1) {
      rounds = i + 1;
      await scrollTo(container, 0, "auto");
      await sleep(settleMs);
      const pagination = readPagination(container);
      if (pagination)
        sawPagination = true;
      if (pagination && pagination.complete) {
        confirmed = true;
        confirmedByPagination = true;
        break;
      }
      if (!(pagination && pagination.pending) && readsAtStart(container)) {
        confirmed = true;
        break;
      }
      const firstId = readFirstTurnId(container);
      const mounted = pagination ? pagination.count : countTurns(container);
      if (firstId !== bestFirstId || mounted > seenTurnIds) {
        sinceProgress = 0;
        bestFirstId = firstId;
        if (mounted > seenTurnIds)
          seenTurnIds = mounted;
      } else {
        sinceProgress += 1;
      }
      const atTop = conversationScrollTop(container) <= 1;
      steady = atTop && firstId === previousFirstId ? steady + 1 : 0;
      previousFirstId = firstId;
      const budget = sawPagination || publishesMarker(container) ? noProgressRounds : noMarkerRounds;
      if (sinceProgress >= budget)
        break;
      if (maxClimbMs > 0 && clock() - startedAt >= maxClimbMs) {
        ranOutOfTime = true;
        break;
      }
      if (pagination && pagination.pending && !pagination.loading && sinceProgress >= 2 && atTop) {
        await scrollTo(container, Math.min(container.clientHeight * 2, conversationScrollMax(container)), "auto");
        await sleep(settleMs);
      }
    }
    return {
      reachedTop: confirmed,
      confirmedByMarker: confirmed && !confirmedByPagination,
      confirmedByPagination,
      quietedWithoutMarker: !confirmed && steady >= stableRounds,
      markerAbsentFromPage: !ranOutOfTime && !sawPagination && !publishesMarker(container),
      ranOutOfTime,
      rounds
    };
  }
  function waitForRenderQuiet(target) {
    if (typeof MutationObserver === "undefined")
      return Promise.resolve();
    return new Promise(function(resolve) {
      let quietTimer;
      const finish = function() {
        clearTimeout(quietTimer);
        clearTimeout(maxTimer);
        observer.disconnect();
        resolve();
      };
      const schedule = function() {
        clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, 120);
      };
      const observer = new MutationObserver(schedule);
      const maxTimer = setTimeout(finish, 2000);
      observer.observe(target, { childList: true, subtree: true, attributes: true });
      schedule();
    });
  }
  function createScanSettings(options) {
    const supplied = options || {};
    return {
      readSections: supplied.readSections || function(target) {
        return target.querySelectorAll("[data-turn-id]");
      },
      extractTurn: supplied.extractTurn || extractTurn,
      onMounted: supplied.onMounted || null,
      settle: supplied.settle || waitForRenderQuiet,
      scrollTo: supplied.scrollTo || scrollToConversationPosition,
      scrollToStart: supplied.scrollToStart || function(target) {
        return scrollToConversationStart(target, { scrollTo: supplied.scrollTo });
      },
      now: supplied.now || function() {
        return Date.now();
      },
      stablePasses: supplied.stablePasses || 3,
      emptyTurnRetries: supplied.emptyTurnRetries || 3,
      noProgressSteps: supplied.noProgressSteps || 60,
      holdReleaseSteps: supplied.holdReleaseSteps || 20,
      isCancelled: supplied.isCancelled || function() {
        return false;
      },
      scanMeta: supplied.scanMeta || null,
      onProgress: supplied.onProgress || null,
      maxSteps: supplied.maxSteps || 0
    };
  }

  // src/content/button-discovery.mjs
  var UNPREVIEWABLE_FORMATS = /(^|[^a-z0-9])(zip|diff|patch|tar|gz|tgz|bz2|xz|7z|rar|whl|jar|exe|dmg|pkg|bin|iso|sqlite|db|parquet|pickle|pkl)([^a-z0-9]|$)/i;
  function foldForNameMatching(value) {
    return String(value || "").toLowerCase().replace(/[\s_\-.]+/g, " ").trim();
  }
  function panelStemsForMatching(panelNames) {
    const stems = [];
    for (const name of Array.from(panelNames || [])) {
      const stem = foldForNameMatching(String(name || "").replace(/\.[A-Za-z0-9]{1,8}$/, ""));
      if (stem)
        stems.push(stem);
    }
    return stems;
  }
  function labelMatchesAnyStem(label, stems) {
    const folded = foldForNameMatching(label);
    if (!folded)
      return false;
    for (const stem of Array.from(stems || [])) {
      if (stem && folded.indexOf(stem) !== -1)
        return true;
    }
    return false;
  }
  function downloadButtonsInPage(doc, panelNames) {
    const root = doc || (typeof document !== "undefined" ? document : null);
    if (!root || !root.querySelectorAll)
      return [];
    let nodes;
    try {
      nodes = root.querySelectorAll('button.behavior-btn, .behavior-btn, [data-file-reference="true"]');
    } catch (_e) {
      return [];
    }
    const known = panelStemsForMatching(panelNames);
    const out = [];
    for (const node of Array.from(nodes)) {
      if (!node)
        continue;
      const modernName = node.getAttribute && node.getAttribute("data-file-reference") === "true" ? node.getAttribute("data-markdown-copy-text") : null;
      if (modernName) {
        if (!labelMatchesAnyStem(modernName, known)) {
          out.push({ button: node, label: modernName, archive: UNPREVIEWABLE_FORMATS.test(modernName) });
        }
        continue;
      }
      if (node.tagName !== "BUTTON")
        continue;
      if (typeof node.closest === "function" && node.closest("a"))
        continue;
      const label = (node.textContent || "").trim();
      if (!label || label.length > 200)
        continue;
      if (!/^\s*(скачать|download|загрузить|télécharger|herunterladen|descargar)(\s|$)/i.test(label)) {
        continue;
      }
      if (labelMatchesAnyStem(label, known))
        continue;
      out.push({ button: node, label, archive: UNPREVIEWABLE_FORMATS.test(label) });
    }
    out.sort(function(a, b) {
      return (b.archive ? 1 : 0) - (a.archive ? 1 : 0);
    });
    return out;
  }
  function escapeKeydownEvent(win) {
    const Ctor = win && win.KeyboardEvent || (typeof KeyboardEvent !== "undefined" ? KeyboardEvent : null);
    const init = { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true };
    if (Ctor) {
      try {
        return new Ctor("keydown", init);
      } catch (_e) {}
    }
    return Object.assign({ type: "keydown" }, init);
  }
  function dismissViewerOverlay(doc, win, options) {
    const root = doc || (typeof document !== "undefined" ? document : null);
    if (!root)
      return false;
    const opts = options || {};
    let closed = false;
    if (opts.escapeOnly) {
      try {
        const target = root.body || root;
        if (target && typeof target.dispatchEvent === "function") {
          target.dispatchEvent(escapeKeydownEvent(win));
          return true;
        }
      } catch (_e) {}
      return false;
    }
    try {
      const candidates = root.querySelectorAll('[role="dialog"] button[aria-label], [data-testid*="close"], button[aria-label]');
      for (const node of Array.from(candidates || [])) {
        const label = node.getAttribute && node.getAttribute("aria-label") || "";
        if (!/^(close|закрыть|schließen|fermer|cerrar)$/i.test(label.trim()))
          continue;
        if (typeof node.click === "function") {
          node.click();
          closed = true;
          break;
        }
      }
    } catch (_e) {}
    if (!closed) {
      try {
        const target = root.body || root;
        if (target && typeof target.dispatchEvent === "function") {
          target.dispatchEvent(escapeKeydownEvent(win));
          closed = true;
        }
      } catch (_e) {}
    }
    return closed;
  }
  function filterButtonsAgainstPanel(buttons, panelNames) {
    const known = panelStemsForMatching(panelNames);
    const out = [];
    for (const entry of Array.from(buttons || [])) {
      if (!entry || !entry.label)
        continue;
      if (!labelMatchesAnyStem(entry.label, known))
        out.push(entry);
    }
    out.sort(function(a, b) {
      return (b.archive ? 1 : 0) - (a.archive ? 1 : 0);
    });
    return out;
  }
  async function findButtonsByScrolling(doc, win, options) {
    const opts = options || {};
    const root = doc || (typeof document !== "undefined" ? document : null);
    if (!root || !root.querySelectorAll)
      return [];
    const sleep = opts.sleep || function(ms) {
      return new Promise(function(resolve) {
        setTimeout(resolve, ms);
      });
    };
    let first = null;
    try {
      first = root.querySelector ? root.querySelector("[data-turn-id]") : null;
    } catch (_e) {}
    const scroller = opts.scroller || (typeof findScrollContainer === "function" && first ? findScrollContainer(first) : null);
    if (!scroller)
      return downloadButtonsInPage(root, opts.panelNames);
    const settleMs = opts.buttonScrollSettleMs === undefined ? 500 : opts.buttonScrollSettleMs;
    const maxSteps = opts.buttonScrollMaxSteps === undefined ? 200 : opts.buttonScrollMaxSteps;
    const originalTop = scroller.scrollTop;
    const byLabel = new Map;
    function harvest() {
      for (const entry of downloadButtonsInPage(root, opts.panelNames)) {
        if (!byLabel.has(entry.label))
          byLabel.set(entry.label, entry);
      }
    }
    try {
      scroller.scrollTop = 0;
      await sleep(settleMs);
      harvest();
      const maxTop = function() {
        return Math.max(0, (scroller.scrollHeight || 0) - (scroller.clientHeight || 0));
      };
      const step = Math.max(200, Math.floor((scroller.clientHeight || 800) * 0.7));
      for (let i = 0;i < maxSteps; i += 1) {
        const before = scroller.scrollTop;
        scroller.scrollTop = Math.min(before + step, maxTop());
        await sleep(settleMs);
        harvest();
        if (scroller.scrollTop >= maxTop() - 1 && before >= maxTop() - 1)
          break;
      }
    } finally {
      try {
        scroller.scrollTop = originalTop;
      } catch (_e) {}
    }
    return Array.from(byLabel.values());
  }

  // src/content/scan.mjs
  var PLACEHOLDER_MARKDOWN = /^(thinking|reasoning|searching|analyzing|analysing|gathering|expanding|loading|generating|working)\b|^(думаю|размышляю|ищу|загружаю|генерирую)\b/i;
  function looksLikePlaceholder(markdown) {
    return PLACEHOLDER_MARKDOWN.test(markdown.trim());
  }
  function shouldReplaceCapture(previousMarkdown, candidateMarkdown) {
    const previousIsPlaceholder = looksLikePlaceholder(previousMarkdown);
    const candidateIsPlaceholder = looksLikePlaceholder(candidateMarkdown);
    if (previousIsPlaceholder !== candidateIsPlaceholder)
      return previousIsPlaceholder;
    return candidateMarkdown.length > previousMarkdown.length;
  }
  function captureMountedTurns(sections, settings, seen, state) {
    let newIds = 0;
    let bandTop = Infinity;
    let bandBottom = -Infinity;
    for (const section of sections) {
      if (typeof section.getBoundingClientRect === "function") {
        try {
          const rect = section.getBoundingClientRect();
          if (rect && typeof rect.top === "number" && typeof rect.bottom === "number") {
            if (rect.top < bandTop)
              bandTop = rect.top;
            if (rect.bottom > bandBottom)
              bandBottom = rect.bottom;
          }
        } catch (_e) {}
      }
      if (isExplicitlyUnsupportedTurn(section))
        continue;
      const rawTurnId = getSectionTurnId(section);
      if (rawTurnId && !state.observedIds.has(rawTurnId)) {
        state.observedIds.add(rawTurnId);
        newIds += 1;
      }
      const candidate = settings.extractTurn(section, state.discoveryIndex);
      if (!candidate) {
        if (rawTurnId) {
          const attempts = (state.emptyAttempts.get(rawTurnId) ?? 0) + 1;
          state.emptyAttempts.set(rawTurnId, attempts);
          if (attempts >= settings.emptyTurnRetries)
            state.skipped.add(rawTurnId);
        }
        continue;
      }
      if (rawTurnId) {
        state.emptyAttempts.delete(rawTurnId);
        state.skipped.delete(rawTurnId);
      }
      const previous = seen.get(candidate.turnId);
      if (!previous) {
        candidate.discoveryIndex = state.discoveryIndex;
        state.discoveryIndex += 1;
      }
      if (!previous || shouldReplaceCapture(previous.markdown, candidate.markdown)) {
        seen.set(candidate.turnId, previous ? Object.assign({}, candidate, { discoveryIndex: previous.discoveryIndex }) : candidate);
      }
    }
    let unresolved = 0;
    for (const id of state.observedIds) {
      if (!seen.has(id) && !state.skipped.has(id))
        unresolved += 1;
    }
    const mountedBand = bandBottom > bandTop ? bandBottom - bandTop : 0;
    return { newIds, unresolved, mountedBand };
  }
  function nextScrollTop(container, atBottom, mountedBand) {
    if (atBottom)
      return conversationScrollTop(container);
    const reach = mountedBand > 0 ? Math.min(mountedBand, container.clientHeight || mountedBand) : container.clientHeight || 0;
    const increment = Math.max(1, Math.floor(reach * 0.75));
    return Math.min(conversationScrollTop(container) + increment, conversationScrollMax(container));
  }
  function largestCoverageGap(bands, viewportHeight, documentHeight) {
    if (!bands || bands.length === 0)
      return { width: 0, at: 0 };
    const sorted = bands.slice().sort(function(a, b) {
      return a[0] - b[0];
    });
    let lastProductive = -1;
    let firstProductive = -1;
    for (let i = 0;i < sorted.length; i += 1) {
      if (sorted[i][1] > 0) {
        if (firstProductive < 0)
          firstProductive = i;
        lastProductive = i;
      }
    }
    if (lastProductive < 0)
      return { width: 0, at: 0 };
    let reach = sorted[firstProductive][0] + sorted[firstProductive][1];
    let widest = 0;
    let at = 0;
    for (let i = firstProductive + 1;i <= lastProductive; i += 1) {
      const start = sorted[i][0];
      if (start > reach + 1) {
        const width = start - reach;
        if (width > widest) {
          widest = width;
          at = reach;
        }
      }
      const end = sorted[i][0] + sorted[i][1];
      if (end > reach)
        reach = end;
    }
    const traversedTo = sorted[sorted.length - 1][0];
    const seenTo = sorted[lastProductive][0] + sorted[lastProductive][1];
    const blind = traversedTo - seenTo;
    if (viewportHeight > 0 && blind > viewportHeight) {
      if (blind > widest) {
        widest = blind;
        at = seenTo;
      }
    }
    if (viewportHeight > 0 && documentHeight > 0) {
      const unreached = documentHeight - traversedTo - viewportHeight;
      if (unreached > viewportHeight && unreached > widest) {
        widest = unreached;
        at = traversedTo;
      }
    }
    return { width: widest, at };
  }
  function markPartialScan(settings, reason) {
    if (settings.scanMeta) {
      settings.scanMeta.partial = true;
      if (!settings.scanMeta.reason)
        settings.scanMeta.reason = reason;
    }
  }
  function prefixPartialNotice(md, reason) {
    if (reason === "history start unverified for this page layout") {
      return `> **Partial export** — history start is unverified for this page layout; earlier messages may be missing.

` + md;
    }
    var detail = reason === "cancelled" ? "scan was stopped before reaching the end" : "scan did not reach the end (" + reason + ")";
    return "> **Partial export** — " + detail + `.

` + md;
  }
  async function scanTurns(container, options) {
    const settings = createScanSettings(options);
    const originalNativeScrollTop = container.scrollTop;
    const seen = new Map;
    const state = {
      discoveryIndex: 0,
      observedIds: new Set,
      emptyAttempts: new Map,
      skipped: new Set
    };
    let stablePasses = 0;
    let lastHeight = -1;
    const readBands = [];
    const startedAt = settings.now();
    let stepsSinceProgress = 0;
    let lastProgressTop = -1;
    try {
      const start = await settings.scrollToStart(container);
      if (!start.reachedTop && !(start.quietedWithoutMarker && start.markerAbsentFromPage)) {
        markPartialScan(settings, "never reached the start");
      }
      await settings.settle(container);
      for (let step = 0;settings.maxSteps === 0 || step < settings.maxSteps; step += 1) {
        if (settings.isCancelled()) {
          markPartialScan(settings, "cancelled");
          return orderCapturedTurns(seen);
        }
        const observation = captureMountedTurns(settings.readSections(container), settings, seen, state);
        const logicalTop = conversationScrollTop(container);
        const atBottom = logicalTop >= conversationScrollMax(container) - 1;
        readBands.push([logicalTop, observation.mountedBand]);
        if (settings.onMounted) {
          try {
            settings.onMounted(container);
          } catch (_e) {}
        }
        const movedDown = Math.abs(logicalTop - lastProgressTop) >= 1;
        if (observation.newIds > 0 || movedDown) {
          stepsSinceProgress = 0;
          lastProgressTop = logicalTop;
        } else {
          stepsSinceProgress += 1;
          if (stepsSinceProgress >= settings.holdReleaseSteps && observation.unresolved > 0) {
            for (const id of state.observedIds) {
              if (!seen.has(id))
                state.skipped.add(id);
            }
            observation.unresolved = 0;
            stepsSinceProgress = 0;
          }
          if (stepsSinceProgress >= settings.noProgressSteps && !atBottom) {
            markPartialScan(settings, "stall");
            return orderCapturedTurns(seen);
          }
        }
        if (settings.onProgress) {
          settings.onProgress({
            captured: seen.size,
            observed: state.observedIds.size,
            elapsedMs: settings.now() - startedAt,
            scrollTop: logicalTop,
            scrollHeight: container.scrollHeight
          });
        }
        stablePasses = atBottom && observation.newIds === 0 && observation.unresolved === 0 && lastHeight === container.scrollHeight ? stablePasses + 1 : 0;
        if (stablePasses >= settings.stablePasses) {
          const gap = largestCoverageGap(readBands, container.clientHeight || 0, container.scrollHeight || 0);
          if (gap.width > 0)
            markPartialScan(settings, "coverage gap");
          return orderCapturedTurns(seen);
        }
        lastHeight = container.scrollHeight;
        const target = observation.unresolved > 0 ? logicalTop : nextScrollTop(container, atBottom, observation.mountedBand);
        await settings.scrollTo(container, target, "auto");
        await settings.settle(container);
      }
      if (seen.size > 0) {
        markPartialScan(settings, "step limit");
        return orderCapturedTurns(seen);
      }
      throw new Error("Conversation scan exceeded its step limit before reaching a stable bottom.");
    } finally {
      const restoreTop = reverseConversationScroll(container) ? originalNativeScrollTop + conversationScrollMax(container) : originalNativeScrollTop;
      await settings.scrollTo(container, restoreTop, "auto");
    }
  }
  function sandboxFilesFromMarkdown(markdown) {
    const text = String(markdown || "");
    const files = [];
    const seen = new Set;
    const pattern = /sandbox:(\/[^\s`)"'\\]+)/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const sandboxPath = match[1];
      if (seen.has(sandboxPath))
        continue;
      seen.add(sandboxPath);
      const name = sandboxPath.split("/").pop();
      if (!name)
        continue;
      files.push({ name, sandboxPath, fromBody: true });
    }
    return files;
  }

  // src/content/button-fetch.mjs
  async function collectButtonDownloads(options) {
    const opts = options || {};
    const doc = opts.doc || (typeof document !== "undefined" ? document : null);
    const win = opts.win || (typeof window !== "undefined" ? window : null);
    if (!doc || !win)
      return [];
    if (typeof opts.onSelectButtons === "function")
      opts.onSelectButtons(opts.panelNames || []);
    const supplied = opts.buttons !== undefined;
    let buttons = supplied ? opts.buttons : downloadButtonsInPage(doc, opts.panelNames);
    if (!supplied && !buttons.length && opts.scrollForButtons !== false) {
      buttons = await findButtonsByScrolling(doc, win, opts);
    }
    if (!buttons.length)
      return [];
    const sleep = opts.sleep || function(ms) {
      return new Promise(function(resolve) {
        setTimeout(resolve, ms);
      });
    };
    const settleMs = opts.clickSettleMs === undefined ? 2500 : opts.clickSettleMs;
    const captured = [];
    const anchorProto = win.HTMLAnchorElement && win.HTMLAnchorElement.prototype;
    const originalAnchorClick = anchorProto ? anchorProto.click : null;
    const originalOpen = win.open;
    const originalCreateObjectURL = win.URL && win.URL.createObjectURL;
    function record(url, blob) {
      if (!url && !blob)
        return;
      captured.push({ url: url || null, blob: blob || null });
    }
    try {
      if (anchorProto && typeof originalAnchorClick === "function") {
        anchorProto.click = function() {
          const href = this.getAttribute ? this.getAttribute("href") || "" : "";
          if (href && (this.hasAttribute("download") || /^(https?:|blob:)/.test(href))) {
            record(href, null);
            return;
          }
          return originalAnchorClick.apply(this, arguments);
        };
      }
      win.open = function(url) {
        if (url) {
          record(String(url), null);
          return null;
        }
        return originalOpen ? originalOpen.apply(win, arguments) : null;
      };
      if (win.URL && typeof originalCreateObjectURL === "function") {
        win.URL.createObjectURL = function(obj) {
          const url = originalCreateObjectURL.apply(win.URL, arguments);
          record(url, obj || null);
          return url;
        };
      }
      for (const entry of buttons) {
        const before = captured.length;
        try {
          if (typeof entry.button.scrollIntoView === "function") {
            entry.button.scrollIntoView({ block: "center" });
          }
          entry.button.click();
        } catch (_e) {
          continue;
        }
        const pollMs = opts.clickPollMs === undefined ? 150 : opts.clickPollMs;
        const maxPolls = Math.max(1, Math.ceil(settleMs / Math.max(1, pollMs)));
        for (let poll = 0;poll < maxPolls && captured.length === before; poll += 1) {
          await sleep(pollMs);
        }
        for (let i = before;i < captured.length; i += 1) {
          captured[i].label = entry.label;
        }
        if (captured.length === before) {
          dismissViewerOverlay(doc, win);
          await sleep(opts.dismissSettleMs === undefined ? 400 : opts.dismissSettleMs);
          dismissViewerOverlay(doc, win, { escapeOnly: true });
        }
      }
    } finally {
      if (anchorProto && typeof originalAnchorClick === "function") {
        anchorProto.click = originalAnchorClick;
      }
      win.open = originalOpen;
      if (win.URL && typeof originalCreateObjectURL === "function") {
        win.URL.createObjectURL = originalCreateObjectURL;
      }
    }
    const seen = new Set;
    const files = [];
    for (const item of captured) {
      const key = item.url || item.label + ":blob";
      if (seen.has(key))
        continue;
      seen.add(key);
      files.push({
        name: downloadNameFromUrl(item.url, item.label),
        url: item.url,
        blob: item.blob,
        label: item.label || null,
        fromButton: true
      });
    }
    return files;
  }
  function downloadNameFromUrl(url, label) {
    const fallback = String(label || "download").trim().replace(/[\\/:*?"<>|]+/g, "-");
    if (!url)
      return fallback;
    let parsed;
    try {
      parsed = new URL(url, typeof location !== "undefined" ? location.href : undefined);
    } catch (_e) {
      return fallback;
    }
    const fn = parsed.searchParams ? parsed.searchParams.get("fn") : null;
    if (fn)
      return fn;
    const last = (parsed.pathname || "").split("/").filter(Boolean).pop();
    if (last && /\.[A-Za-z0-9]{1,8}$/.test(last))
      return last;
    return fallback;
  }
  async function appendPanelArtifacts(markdown, options) {
    const opts = options || {};
    const doc = opts.doc || (typeof document !== "undefined" ? document : null);
    const conversationId = opts.conversationId || ((typeof location !== "undefined" ? location.pathname : "").match(/\/c\/([A-Za-z0-9-]+)/) || [])[1] || null;
    if (!conversationId)
      return markdown;
    const scannedFiles = Array.isArray(opts.scannedPanelFiles) ? opts.scannedPanelFiles : [];
    const artifacts = opts.artifacts !== undefined ? opts.artifacts : await fetchConversationArtifacts(conversationId, opts);
    if (typeof opts.onInventory === "function")
      opts.onInventory(artifacts);
    const bodyFiles = sandboxFilesFromMarkdown(markdown);
    const apiFiles = (artifacts || []).filter(function(a) {
      return a && a.sandboxPath;
    }).map(function(a) {
      return {
        name: a.name,
        sandboxPath: a.sandboxPath,
        fromApi: true,
        priority: a.priority === undefined ? 1 : a.priority,
        messageId: a.messageId
      };
    });
    const uploadedFiles = (artifacts || []).filter(function(a) {
      return a && a.kind === "attachment" && a.name;
    }).map(function(a) {
      return Object.assign({}, a, { priority: 0 });
    });
    let files = opts.files;
    if (!files) {
      const mayHaveFiles = artifacts === null || artifacts.length > 0 || bodyFiles.length > 0 || scannedFiles.length > 0;
      const offeredAfterScan = Array.isArray(opts.scannedPanelFiles) && (uploadedFiles.length > 0 || apiFiles.some(function(file) {
        return file.priority === 0;
      }));
      files = mayHaveFiles && !offeredAfterScan ? await waitForArtifactPanel(doc, opts) : listArtifactPanelFiles(doc);
    }
    const bySandboxPath = new Map;
    for (const file of scannedFiles)
      bySandboxPath.set(file.sandboxPath, file);
    for (const file of files)
      bySandboxPath.set(file.sandboxPath, file);
    for (const file of bodyFiles)
      bySandboxPath.set(file.sandboxPath, file);
    for (const file of apiFiles) {
      const visible = bySandboxPath.has(file.sandboxPath);
      bySandboxPath.set(file.sandboxPath, visible ? Object.assign({}, file, { priority: 0 }) : file);
    }
    files = uploadedFiles.concat(Array.from(bySandboxPath.values())).sort(function(a, b) {
      return (a.priority || 0) - (b.priority || 0);
    });
    const panelNames = files.map(function(f) {
      return f.name;
    });
    const scannedButtons = Array.isArray(opts.scannedButtons) ? filterButtonsAgainstPanel(opts.scannedButtons, panelNames) : null;
    const buttonFiles = opts.clickDownloads === false ? opts.reportUnresolvedButtons ? (scannedButtons || downloadButtonsInPage(doc, panelNames)).map(function(entry) {
      return { name: entry.label, url: null };
    }) : [] : opts.buttonFiles !== undefined ? opts.buttonFiles : await collectButtonDownloads(Object.assign({}, opts, {
      panelNames,
      buttons: scannedButtons === null ? undefined : scannedButtons
    }));
    const inventoryUnavailable = artifacts === null;
    if (!files.length && !buttonFiles.length && !inventoryUnavailable)
      return markdown;
    let messageIds = opts.messageIds;
    if (!messageIds) {
      messageIds = artifacts ? artifacts.map(function(a) {
        return a.messageId;
      }).filter(Boolean) : [];
      messageIds.sort(function(a, b) {
        const rank = function(id) {
          for (const art of artifacts || []) {
            if (art.messageId === id)
              return art.sandboxPath ? 0 : 1;
          }
          return 1;
        };
        return rank(a) - rank(b);
      });
      if (!messageIds.length) {
        const nodes = doc && doc.querySelectorAll ? doc.querySelectorAll("[data-message-id]") : [];
        for (const node of Array.from(nodes)) {
          const id = node.getAttribute ? node.getAttribute("data-message-id") : null;
          if (id)
            messageIds.push(id);
        }
      }
    }
    const resolvedList = await resolveArtifactPanelFiles(conversationId, {
      files,
      messageIds,
      fetchImpl: opts.fetchImpl,
      token: opts.token,
      onResolved: opts.onResolved,
      onFailure: opts.onFailure
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
    const alreadyNamed = new Set;
    for (const entry of resolvedList)
      alreadyNamed.add(entry.file.name);
    for (const file of buttonFiles) {
      if (!file || alreadyNamed.has(file.name))
        continue;
      alreadyNamed.add(file.name);
      if (file.url) {
        lines.push(markdownLink(file.name, file.url));
      } else {
        unresolved.push(file.name);
      }
    }
    if (!lines.length && !unresolved.length && !inventoryUnavailable)
      return markdown;
    const block = ["## Files"];
    if (lines.length)
      block.push(lines.join(`
`));
    if (unresolved.length || inventoryUnavailable) {
      if (typeof opts.onIncomplete === "function")
        opts.onIncomplete();
    }
    if (inventoryUnavailable) {
      block.push("> Could not enumerate attachments: the conversation API was unreachable. " + "Visible file links were preserved, but attachment completeness is unknown.");
    }
    if (unresolved.length) {
      block.push("> Could not retrieve a download link for: " + unresolved.join(", ") + (artifacts === null ? " (the conversation API was unreachable)" : ""));
    }
    const body = block.join(`

`);
    return markdown ? markdown + `

---

` + body : body;
  }
  function extractConversationLegacy(root) {
    const messages = (root || document).querySelectorAll("[data-message-author-role]");
    if (!messages.length)
      return null;
    const parts = [];
    for (const msg of messages) {
      const role = msg.getAttribute("data-message-author-role");
      if (role === "user") {
        const bubble = msg.querySelector(".whitespace-pre-wrap") || msg.querySelector('[dir="auto"]') || msg;
        const text = bubble.textContent.trim();
        if (text)
          parts.push(`#### You said:

` + text);
      } else if (role === "assistant") {
        const markdownDiv = msg.querySelector(".markdown") || msg.querySelector('[class*="prose"]') || msg;
        let md = nodeToMarkdown(markdownDiv).trim();
        md = md.replace(/\n{3,}/g, `

`);
        if (md)
          parts.push(`#### ChatGPT said:

` + md);
      }
    }
    return parts.length ? parts.join(`

---

`) : null;
  }

  // src/content/sidebar-rows.mjs
  function stripSidebarLabelSuffix(label, visibleTitle) {
    const raw = String(label).trim();
    const visible = String(visibleTitle == null ? "" : visibleTitle).trim();
    if (visible && raw.startsWith(visible) && raw.length > visible.length) {
      const remainder = raw.slice(visible.length);
      if (/^\s*[,;:—–]/.test(remainder))
        return visible;
    }
    return raw;
  }
  function titleFromSidebarLink(link) {
    if (!link)
      return null;
    const inner = link.querySelector ? link.querySelector(".truncate") : null;
    const visible = inner ? (inner.textContent || "").trim() : (link.textContent || "").trim();
    const label = (link.getAttribute("aria-label") || "").trim();
    if (visible)
      return stripSidebarLabelSuffix(label || visible, visible);
    return label ? stripSidebarLabelSuffix(label, "") : null;
  }
  function extractConversationTitle(doc) {
    const root = doc || (typeof document !== "undefined" ? document : null);
    if (!root)
      return null;
    const idMatch = (typeof location !== "undefined" ? location.pathname : "").match(/\/c\/([A-Za-z0-9-]+)/);
    const candidates = [];
    if (idMatch) {
      candidates.push('a[href="/c/' + idMatch[1] + '"]');
      candidates.push('a[href$="/c/' + idMatch[1] + '"]');
    }
    candidates.push('a[data-active][href^="/c/"]');
    candidates.push('a[data-active][href*="/c/"]');
    for (const selector of candidates) {
      const link = root.querySelector(selector);
      const title = titleFromSidebarLink(link);
      if (title)
        return title;
    }
    const title = (root.title || "").trim();
    if (!title)
      return null;
    let cleaned = title.replace(/\s*[|-]\s*ChatGPT\s*$/i, "").trim();
    const projectName = knownProjectName(root);
    if (projectName) {
      const prefix = new RegExp("^" + escapeForRegExp(projectName) + "\\s*[-–—|]\\s*");
      const withoutProject = cleaned.replace(prefix, "").trim();
      if (withoutProject)
        cleaned = withoutProject;
    }
    return cleaned && cleaned.toLowerCase() !== "chatgpt" ? cleaned : null;
  }
  function escapeForRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function knownProjectName(doc) {
    const root = doc || (typeof document !== "undefined" ? document : null);
    if (!root || !root.querySelector)
      return null;
    const path = typeof location !== "undefined" ? location.pathname : "";
    const idMatch = path.match(/\/c\/([A-Za-z0-9-]+)/);
    if (!idMatch)
      return null;
    const routeProject = path.match(/\/g\/(g-p-[A-Za-z0-9]+)\//);
    const link = root.querySelector('a[href$="/c/' + idMatch[1] + '"]');
    const href = link ? link.getAttribute("href") || "" : "";
    const projectId = routeProject && routeProject[1] || (href.match(/\/g\/(g-p-[A-Za-z0-9]+)\//) || [])[1] || null;
    if (!projectId)
      return null;
    if (!link)
      return null;
    let cur = link.parentElement;
    for (let depth = 0;depth < 12 && cur; depth++) {
      const header = cur.querySelector ? cur.querySelector('[role="button"] .truncate, button[data-sidebar-item] .truncate') : null;
      if (header) {
        const name = (header.textContent || "").trim();
        const ownsRows = cur.querySelectorAll ? cur.querySelectorAll('a[href*="/c/"]').length : 0;
        if (name && ownsRows > 0)
          return name;
      }
      cur = cur.parentElement;
    }
    return null;
  }
  function projectTitleForConversationLink(link) {
    var current = link;
    var depth;
    for (depth = 0;depth < 8 && current; depth++) {
      current = current.parentElement;
      if (!current || typeof current.querySelector !== "function")
        continue;
      var row = null;
      try {
        row = current.querySelector('[class*="project-unfurl-row"]');
      } catch (_e) {
        row = null;
      }
      if (!row)
        continue;
      var label = String(row.textContent || "").replace(/\s+/g, " ").trim();
      if (!label)
        continue;
      return label.slice(0, 80);
    }
    return null;
  }
  function listSidebarConversations(doc) {
    const root = doc || (typeof document !== "undefined" ? document : null);
    if (!root || !root.querySelectorAll)
      return [];
    const links = root.querySelectorAll('nav a[href*="/c/"]');
    const seen = new Set;
    const results = [];
    for (const link of links) {
      const href = link.getAttribute("href") || "";
      const match = href.match(/^(?:\/g\/(g-p-[A-Za-z0-9]+))?\/c\/([A-Za-z0-9-]+)(?:[?#].*)?$/);
      if (!match)
        continue;
      const projectId = match[1] || null;
      const id = match[2];
      if (seen.has(id))
        continue;
      seen.add(id);
      const title = titleFromSidebarLink(link);
      results.push({
        id,
        href,
        projectId,
        projectTitle: projectTitleForConversationLink(link),
        title,
        slug: slugifyTitle(title) || id
      });
    }
    return results;
  }
  function projectRowContainer(row) {
    let current = row;
    for (let depth = 0;depth < 5 && current; depth++) {
      const tag = current.tagName ? current.tagName.toLowerCase() : "";
      if (tag === "li")
        return current;
      current = current.parentElement;
    }
    return row ? row.parentElement || row : null;
  }
  function findCollapsedProjectRows(doc) {
    const root = doc || (typeof document !== "undefined" ? document : null);
    if (!root || !root.querySelectorAll)
      return [];
    let rows;
    try {
      rows = root.querySelectorAll('[class*="project-unfurl-row"]');
    } catch (_e) {
      return [];
    }
    const found = [];
    const seen = new Set;
    for (const row of rows) {
      if (!row || !row.querySelector)
        continue;
      const container = projectRowContainer(row);
      let openLinks = 0;
      try {
        openLinks = container ? container.querySelectorAll('a[href*="/c/"]').length : 0;
      } catch (_e) {
        openLinks = 0;
      }
      if (openLinks)
        continue;
      let control = null;
      try {
        control = row.getAttribute && row.getAttribute("role") === "button" ? row : row.querySelector('[role="button"]');
      } catch (_e) {
        control = null;
      }
      if (!control || typeof control.click !== "function")
        continue;
      const label = (row.textContent || "").trim().slice(0, 60);
      if (!label || seen.has(label))
        continue;
      seen.add(label);
      found.push({ control, label });
    }
    return found;
  }
  function isPaginationControl(button) {
    if (!button || typeof button.click !== "function")
      return false;
    try {
      if (button.getAttribute && button.getAttribute("href"))
        return false;
      if (button.querySelector && button.querySelector("a[href]"))
        return false;
      const li = button.closest ? button.closest("li") : null;
      const ul = li ? li.parentElement : null;
      if (!li || !ul || !ul.children)
        return false;
      const kids = Array.from(ul.children);
      if (kids.indexOf(li) !== kids.length - 1)
        return false;
      const siblingConvLinks = ul.querySelectorAll ? ul.querySelectorAll('a[href*="/c/"]').length : 0;
      if (!siblingConvLinks)
        return false;
      if (li.querySelector && li.querySelector('a[href*="/c/"]'))
        return false;
      return true;
    } catch (_e) {
      return false;
    }
  }
  function findHistoryRetryControl(doc) {
    const root = doc || (typeof document !== "undefined" ? document : null);
    if (!root || !root.querySelectorAll)
      return null;
    let nodes;
    try {
      nodes = root.querySelectorAll('nav [role="status"]');
    } catch (_e) {
      return null;
    }
    for (const node of nodes) {
      if (node.getAttribute && node.getAttribute("aria-busy") === "true")
        continue;
      const button = node.querySelector ? node.querySelector("button") : null;
      if (!button || typeof button.click !== "function")
        continue;
      if (button.querySelector && button.querySelector('a[href*="/c/"]'))
        continue;
      return button;
    }
    return null;
  }
  function findShowMoreControl(doc) {
    const root = doc || (typeof document !== "undefined" ? document : null);
    if (!root || !root.querySelectorAll)
      return null;
    let buttons;
    try {
      buttons = root.querySelectorAll('nav button[data-sidebar-item], nav button, nav [role="button"]');
    } catch (_e) {
      return null;
    }
    for (const button of buttons) {
      if (isPaginationControl(button))
        return button;
    }
    return null;
  }
  function findSidebarScroller(doc) {
    const root = doc || (typeof document !== "undefined" ? document : null);
    if (!root || !root.querySelector)
      return null;
    const anchor = root.querySelector('nav a[href*="/c/"]');
    if (!anchor)
      return null;
    let current = anchor.parentElement;
    while (current) {
      let overflowY = "";
      try {
        overflowY = typeof getComputedStyle === "function" ? getComputedStyle(current).overflowY || "" : "";
      } catch (_e) {
        overflowY = "";
      }
      const scrollable = /(auto|scroll|overlay)/.test(overflowY) || (current.scrollHeight || 0) > (current.clientHeight || 0) + 1;
      if (scrollable && (current.scrollHeight || 0) > (current.clientHeight || 0) + 1) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  // src/content/sidebar-walk.mjs
  async function sleepUnlessRateLimitedCancelled(sleep, ms) {
    let left = ms > 0 ? ms : 0;
    while (left > 0) {
      try {
        if (typeof window !== "undefined" && window.__c2mScan && window.__c2mScan.cancelled)
          return false;
      } catch (_e) {}
      const step = Math.min(left, 1000);
      await sleep(step);
      left -= step;
    }
    return true;
  }
  async function collectSidebarConversations(options) {
    const supplied = options || {};
    const doc = supplied.doc || (typeof document !== "undefined" ? document : null);
    const maxRounds = supplied.maxRounds || 200;
    const settleMs = supplied.settleMs || 250;
    const quietRounds = supplied.quietRounds || 3;
    const scrollStepRatio = supplied.scrollStepRatio || 0.5;
    const maxShowMoreClicks = supplied.maxShowMoreClicks === undefined ? 60 : supplied.maxShowMoreClicks;
    const showMoreSettleMs = supplied.showMoreSettleMs || 1200;
    const rateLimitWaitMs = supplied.rateLimitWaitMs == null ? 60000 : supplied.rateLimitWaitMs;
    const maxHistoryRetryClicks = supplied.maxHistoryRetryClicks == null ? 5 : supplied.maxHistoryRetryClicks;
    const expandProjects = supplied.expandProjects !== false;
    const maxProjectExpansions = supplied.maxProjectExpansions === undefined ? 40 : supplied.maxProjectExpansions;
    const projectSettleMs = supplied.projectSettleMs || 1400;
    const finalSweep = supplied.finalSweep !== false;
    const maxSweepPasses = supplied.maxSweepPasses === undefined ? 6 : supplied.maxSweepPasses;
    const sleep = supplied.sleep || function(ms) {
      return new Promise(function(resolve) {
        setTimeout(resolve, ms);
      });
    };
    const byId = new Map;
    let mountedBand = 0;
    const coveredSpans = [];
    let visitedTop = false;
    let visitedBottom = false;
    let listTop = Infinity;
    let listBottom = -Infinity;
    function recordCoverage(scrollTop) {
      if (!doc || !doc.querySelectorAll)
        return 0;
      let links;
      try {
        links = doc.querySelectorAll('nav a[href*="/c/"]');
      } catch (_e) {
        return 0;
      }
      let top = Infinity;
      let bottom = -Infinity;
      let measured = 0;
      for (const link of links) {
        if (!link || typeof link.getBoundingClientRect !== "function")
          continue;
        let rect;
        try {
          rect = link.getBoundingClientRect();
        } catch (_e) {
          continue;
        }
        if (!rect)
          continue;
        const rTop = typeof rect.top === "number" ? rect.top : 0;
        const rBottom = typeof rect.bottom === "number" ? rect.bottom : rTop;
        if (rBottom <= rTop)
          continue;
        top = Math.min(top, rTop);
        bottom = Math.max(bottom, rBottom);
        measured += 1;
      }
      if (!measured || bottom <= top)
        return 0;
      coveredSpans.push([top + scrollTop, bottom + scrollTop]);
      return bottom - top;
    }
    function coverageIsContiguous() {
      if (!coveredSpans.length)
        return false;
      const spans = coveredSpans.slice().sort(function(a, b) {
        return a[0] - b[0];
      });
      const slack = 2;
      let reach = spans[0][1];
      for (let i = 1;i < spans.length; i++) {
        if (spans[i][0] > reach + slack)
          return false;
        reach = Math.max(reach, spans[i][1]);
      }
      return true;
    }
    function rowListItem(link) {
      let current = link;
      for (let depth = 0;depth < 6 && current; depth++) {
        if (current.tagName && current.tagName.toUpperCase() === "LI")
          return current;
        current = current.parentElement;
      }
      return null;
    }
    function structurePersistsPastWindow() {
      try {
        const items = doc.querySelectorAll("nav li").length;
        const rows = doc.querySelectorAll('nav a[href*="/c/"]').length;
        return items > rows;
      } catch (_e) {
        return false;
      }
    }
    function tailIsProven() {
      if (!doc || !doc.querySelectorAll)
        return { proven: false, reason: "no-document" };
      let links;
      try {
        links = Array.from(doc.querySelectorAll('nav a[href*="/c/"]'));
      } catch (_e) {
        return { proven: false, reason: "query-failed" };
      }
      if (!links.length)
        return { proven: false, reason: "no-rows-mounted" };
      const items = links.map(rowListItem).filter(Boolean);
      if (!items.length) {
        return { proven: false, reason: "tail-unprovable" };
      }
      const deepest = items[items.length - 1];
      const next = deepest.nextElementSibling;
      if (!next) {
        return structurePersistsPastWindow() ? { proven: true, reason: "deepest-row-is-last-sibling" } : { proven: false, reason: "tail-unprovable" };
      }
      let nextHasRow = false;
      try {
        nextHasRow = !!(next.querySelector && next.querySelector('a[href*="/c/"]'));
      } catch (_e) {
        nextHasRow = false;
      }
      return nextHasRow ? { proven: false, reason: "successor-exists-not-mounted" } : { proven: true, reason: "successor-is-not-a-conversation" };
    }
    const scroller = supplied.scroller || findSidebarScroller(doc);
    function absorb() {
      let added = 0;
      const batch = listSidebarConversations(doc);
      for (const conv of batch) {
        if (byId.has(conv.id))
          continue;
        byId.set(conv.id, conv);
        added += 1;
      }
      const at = scroller ? scroller.scrollTop || 0 : 0;
      const spanCountBefore = coveredSpans.length;
      mountedBand = recordCoverage(at);
      const newSpan = coveredSpans.length > spanCountBefore ? coveredSpans[coveredSpans.length - 1] : null;
      if (scroller) {
        const maxTop = Math.max(0, (scroller.scrollHeight || 0) - (scroller.clientHeight || 0));
        if (at <= 1) {
          visitedTop = true;
          if (newSpan)
            listTop = Math.min(listTop, newSpan[0]);
        }
        if (at >= maxTop - 1) {
          visitedBottom = true;
          if (newSpan)
            listBottom = Math.max(listBottom, newSpan[1]);
        }
      }
      return added;
    }
    absorb();
    let projectsExpanded = 0;
    if (expandProjects) {
      for (let attempt = 0;attempt < maxProjectExpansions; attempt++) {
        const pending = findCollapsedProjectRows(doc);
        if (!pending.length)
          break;
        let clickedAny = false;
        for (const row of pending) {
          if (projectsExpanded >= maxProjectExpansions)
            break;
          try {
            row.control.click();
            projectsExpanded += 1;
            clickedAny = true;
            await sleep(projectSettleMs);
            absorb();
          } catch (_e) {}
        }
        if (!clickedAny)
          break;
      }
    }
    let projectsExhausted = findCollapsedProjectRows(doc).length === 0;
    if (!scroller) {
      return {
        conversations: Array.from(byId.values()),
        complete: false,
        reason: "no-scroll-container"
      };
    }
    const startTop = scroller.scrollTop || 0;
    let quiet = 0;
    let rounds = 0;
    let complete = false;
    let blocked = false;
    let reachedBottom = false;
    let coverageVerified = false;
    let showMoreClicks = 0;
    let historyRetryClicks = 0;
    let barrenShowMoreClicks = 0;
    let showMoreExhausted = true;
    let tailReason = null;
    while (rounds < maxRounds) {
      rounds += 1;
      const maxTop = Math.max(0, (scroller.scrollHeight || 0) - (scroller.clientHeight || 0));
      const before = scroller.scrollTop || 0;
      const heightBefore = scroller.scrollHeight || 0;
      const reach = mountedBand > 0 ? Math.min(mountedBand, scroller.clientHeight || mountedBand) : scroller.clientHeight || 0;
      const step = Math.max(1, Math.floor(reach * scrollStepRatio));
      const nextTop = Math.min(maxTop, before + step);
      try {
        scroller.scrollTop = nextTop;
      } catch (_e) {
        blocked = true;
        break;
      }
      await sleep(settleMs);
      let added = absorb();
      barrenShowMoreClicks = 0;
      while (showMoreClicks < maxShowMoreClicks) {
        const control = findShowMoreControl(doc);
        if (!control || typeof control.click !== "function")
          break;
        let clickFailed = false;
        try {
          control.click();
          showMoreClicks += 1;
        } catch (_e) {
          clickFailed = true;
        }
        if (clickFailed)
          break;
        await sleep(showMoreSettleMs);
        const revealed = absorb();
        added += revealed;
        barrenShowMoreClicks = revealed ? 0 : barrenShowMoreClicks + 1;
        if (barrenShowMoreClicks >= 2)
          break;
      }
      if (findShowMoreControl(doc))
        showMoreExhausted = false;
      const historyRetry = findHistoryRetryControl(doc);
      if (historyRetry && historyRetryClicks < maxHistoryRetryClicks) {
        const waited = await sleepUnlessRateLimitedCancelled(sleep, rateLimitWaitMs);
        if (!waited) {
          blocked = true;
          break;
        }
        let clickFailed = false;
        try {
          historyRetry.click();
          historyRetryClicks += 1;
        } catch (_e) {
          clickFailed = true;
        }
        if (!clickFailed) {
          await sleep(settleMs);
          added += absorb();
          quiet = 0;
        }
      }
      const nowTop = scroller.scrollTop || 0;
      const nowMaxTop = Math.max(0, (scroller.scrollHeight || 0) - (scroller.clientHeight || 0));
      const atBottom = nowTop >= nowMaxTop - 1;
      const stillGrowing = (scroller.scrollHeight || 0) > heightBefore;
      if (added > 0 || Math.abs(nowTop - before) >= 1) {
        quiet = 0;
      } else {
        quiet += 1;
      }
      if (atBottom && added === 0 && !stillGrowing && quiet >= quietRounds) {
        reachedBottom = true;
        if (findShowMoreControl(doc)) {
          showMoreExhausted = false;
          complete = false;
          break;
        }
        coverageVerified = coveredSpans.length > 0;
        const tail = tailIsProven();
        tailReason = tail.reason;
        complete = (coverageVerified ? coverageIsContiguous() : true) && visitedTop && visitedBottom && tail.proven;
        break;
      }
    }
    if (finalSweep && !blocked) {
      for (let pass = 0;pass < maxSweepPasses; pass++) {
        const before = byId.size;
        let position = 0;
        const limit = Math.max(0, (scroller.scrollHeight || 0) - (scroller.clientHeight || 0));
        const sweepStep = Math.max(1, Math.floor((scroller.clientHeight || 1) * scrollStepRatio));
        let guard = 0;
        while (position <= limit && guard < maxRounds) {
          guard += 1;
          try {
            scroller.scrollTop = position;
          } catch (_e) {
            break;
          }
          await sleep(settleMs);
          absorb();
          if (findShowMoreControl(doc))
            showMoreExhausted = false;
          if (findCollapsedProjectRows(doc).length)
            projectsExhausted = false;
          position += sweepStep;
        }
        if (byId.size === before)
          break;
      }
      if (coveredSpans.length) {
        coverageVerified = true;
        const sweptTail = tailIsProven();
        tailReason = sweptTail.reason;
        complete = coverageIsContiguous() && showMoreExhausted && visitedTop && visitedBottom && sweptTail.proven;
      }
    }
    if (findShowMoreControl(doc))
      showMoreExhausted = false;
    if (findCollapsedProjectRows(doc).length)
      projectsExhausted = false;
    if (!showMoreExhausted || !projectsExhausted)
      complete = false;
    if (findHistoryRetryControl(doc)) {
      complete = false;
      tailReason = "history-rate-limited";
    }
    try {
      scroller.scrollTop = startTop;
    } catch (_e) {}
    let reason;
    if (complete) {
      reason = "reached-end";
    } else if (tailReason === "history-rate-limited") {
      reason = tailReason;
    } else if (blocked) {
      reason = "scroll-blocked";
    } else if (!showMoreExhausted) {
      reason = "show-more-pending";
    } else if (!projectsExhausted) {
      reason = "project-expansion-pending";
    } else if (tailReason === "successor-exists-not-mounted" || tailReason === "tail-unprovable") {
      reason = tailReason;
    } else if (reachedBottom) {
      reason = "coverage-gap";
    } else {
      reason = "round-limit";
    }
    return {
      conversations: Array.from(byId.values()),
      complete,
      reason,
      coverageVerified,
      showMoreClicks,
      projectsExpanded,
      tailReason
    };
  }

  // src/content/export.mjs
  function activeConversationRoot(doc) {
    if (!doc || !doc.querySelectorAll)
      return doc;
    if (!doc.querySelector("[data-app-shell-active-page]"))
      return doc;
    const pages = Array.from(doc.querySelectorAll("[data-app-shell-active-page]"));
    if (!pages.length)
      return doc;
    const active = pages.filter(function(page) {
      return page.getAttribute("data-app-shell-active-page") === "true";
    });
    return active.length === 1 ? active[0] : null;
  }
  function conversationHasMessages(root) {
    if (!root || !root.querySelector)
      return false;
    if (root.querySelector("[data-turn-id]") || root.querySelector("[data-message-author-role]"))
      return true;
    return modernMessageSections(root).some(function(unit) {
      return !!modernMessageRole(unit);
    });
  }
  function retryButtonText(button) {
    return String(button && button.textContent || "").replace(/\s+/g, " ").trim();
  }
  function loneActionButton(container) {
    if (!container || !container.querySelectorAll)
      return null;
    let buttons;
    try {
      buttons = Array.from(container.querySelectorAll("button"));
    } catch (_e) {
      return null;
    }
    const usable = buttons.filter(function(button) {
      if (!button || typeof button.click !== "function")
        return false;
      if (button.disabled)
        return false;
      if (button.getAttribute && button.getAttribute("aria-disabled") === "true")
        return false;
      if (button.querySelector && button.querySelector('a[href*="/c/"]'))
        return false;
      return retryButtonText(button).length > 0;
    });
    return usable.length === 1 ? usable[0] : null;
  }
  function findConversationRetryControl(doc) {
    const root = doc || (typeof document !== "undefined" ? document : null);
    if (!root || !root.querySelector)
      return null;
    const page = activeConversationRoot(root);
    if (!page || !page.querySelector)
      return null;
    if (conversationHasMessages(page))
      return null;
    const focus = page.querySelector('[data-app-shell-focus-area="main"]');
    const fromFocus = loneActionButton(focus);
    if (fromFocus)
      return fromFocus;
    const main = page.querySelector("main") || page;
    if (!main.querySelectorAll)
      return null;
    let buttons;
    try {
      buttons = Array.from(main.querySelectorAll("button"));
    } catch (_e) {
      return null;
    }
    const labeled = buttons.filter(function(button) {
      return retryButtonText(button) === "Retry" && typeof button.click === "function" && !button.disabled;
    });
    return labeled.length === 1 ? labeled[0] : null;
  }
  function clickConversationRetry() {
    const button = findConversationRetryControl(typeof document !== "undefined" ? document : null);
    if (!button)
      return false;
    try {
      button.click();
      return true;
    } catch (_e) {
      return false;
    }
  }
  var RATE_LIMIT_PAGE_ERROR = "ChatGPT rate limit: the conversation page asked to retry.";
  function rateLimitPageError(doc) {
    if (!findConversationRetryControl(doc || (typeof document !== "undefined" ? document : null)))
      return null;
    return { ok: false, error: RATE_LIMIT_PAGE_ERROR, rateLimited: true };
  }
  function waitForConversationReady(options) {
    const supplied = options || {};
    const timeoutMs = supplied.timeoutMs == null ? 30000 : supplied.timeoutMs;
    const pollMs = supplied.pollMs || 300;
    const conversationId = supplied.conversationId || null;
    return new Promise(function(resolve) {
      const startedAt = Date.now();
      function check() {
        if (conversationId) {
          const pathMatch = (typeof location !== "undefined" ? location.pathname : "").match(/\/c\/([A-Za-z0-9-]+)/);
          if (!pathMatch || pathMatch[1] !== conversationId) {
            if (Date.now() - startedAt >= timeoutMs) {
              return resolve({ ready: false, error: "Navigation did not reach the conversation." });
            }
            return setTimeout(check, pollMs);
          }
        }
        const root = typeof document !== "undefined" ? activeConversationRoot(document) : null;
        if (conversationHasMessages(root))
          return resolve({ ready: true });
        if (findConversationRetryControl(typeof document !== "undefined" ? document : null)) {
          return resolve({ ready: false, rateLimited: true, error: RATE_LIMIT_PAGE_ERROR });
        }
        if (Date.now() - startedAt >= timeoutMs) {
          return resolve({ ready: false, error: "Conversation content did not load." });
        }
        setTimeout(check, pollMs);
      }
      check();
    });
  }
  function slugifyTitle(title, maxLength) {
    const limit = maxLength || 60;
    if (!title)
      return null;
    const slug = String(title).normalize("NFC").replace(/[\u0000-\u001F\u007F-\u009F\uE000-\uF8FF\uFDD0-\uFDEF\uFFF0-\uFFFF]/g, " ").replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, function(pair) {
      const code = pair.codePointAt(0);
      const inPrivatePlane = code >= 983040 && code <= 1114109;
      const isNonCharacter = (code & 65534) === 65534;
      return inPrivatePlane || isNonCharacter ? " " : pair;
    }).replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, " ").replace(/[\\/:*?"<>|]+/g, " ").replace(/~+/g, "-").replace(/[\s_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, limit).replace(/-+$/g, "");
    if (/^\.+$/.test(slug))
      return null;
    return slug || null;
  }
  async function getConversationMarkdown(settings) {
    const wantFiles = !!(settings && settings.downloadFiles);
    try {
      let assertSameConversation = function() {
        if (typeof location !== "undefined" && location.pathname !== startPath || activeConversationRoot(document) !== root) {
          throw new Error("Conversation changed during export. Return to the intended conversation and export again.");
        }
      };
      const root = activeConversationRoot(document);
      if (!root)
        return { ok: false, error: "Could not identify the active conversation. Try again after it loads." };
      const startPath = typeof location !== "undefined" ? location.pathname : "";
      const conversationId = (startPath.match(/\/c\/([A-Za-z0-9-]+)/) || [])[1] || null;
      const legacySection = root.querySelector("[data-turn-id]");
      const modern = !legacySection && modernMessageSections(root).length > 0;
      const firstSection = legacySection || (modern ? modernMessageSections(root)[0] : null);
      let md;
      var scanMeta = null;
      const panelFilesDuringScan = new Map;
      const buttonsDuringScan = new Map;
      if (!firstSection) {
        md = extractConversationLegacy(root);
      } else {
        const container = findScrollContainer(firstSection);
        if (!container)
          return { ok: false, error: "Could not find the conversation scroll area." };
        const scanState = { cancelled: false, captured: 0, observed: 0, elapsedMs: 0 };
        scanMeta = {};
        if (typeof window !== "undefined")
          window.__c2mScan = scanState;
        const turns = await scanTurns(container, {
          readSections: function() {
            assertSameConversation();
            return modern ? modernMessageSections(root) : root.querySelectorAll("[data-turn-id]");
          },
          scrollToStart: modern ? async function(target) {
            const result = await scrollToConversationStart(target, {
              readFirstTurn: function(root) {
                return modernMessageSections(root)[0] || null;
              },
              readFirstTurnId: function(root) {
                const first = modernMessageSections(root)[0];
                return first ? getSectionTurnId(first) : null;
              },
              countTurns: function(root) {
                return modernMessageSections(root).length;
              },
              readPagination: readModernPagination
            });
            if (!result.confirmedByPagination) {
              markPartialScan({ scanMeta }, "history start unverified for this page layout");
            }
            return result;
          } : undefined,
          extractTurn,
          isCancelled: function() {
            return scanState.cancelled === true;
          },
          scanMeta,
          onProgress: function(p) {
            scanState.captured = p.captured;
            scanState.observed = p.observed;
            scanState.elapsedMs = p.elapsedMs;
          },
          onMounted: wantFiles ? function() {
            for (const file of listArtifactPanelFiles(root)) {
              if (!panelFilesDuringScan.has(file.name)) {
                panelFilesDuringScan.set(file.name, file);
              }
            }
            for (const entry of downloadButtonsInPage(root, [])) {
              if (!buttonsDuringScan.has(entry.label)) {
                buttonsDuringScan.set(entry.label, entry);
              }
            }
          } : null
        });
        md = buildConversationMarkdown(turns);
        if (scanMeta.partial)
          md = prefixPartialNotice(md, scanMeta.reason);
      }
      if (!md)
        return rateLimitPageError(document) || { ok: false, error: "No conversation found on this page." };
      let attachmentsIncomplete = false;
      if (wantFiles) {
        const controller = typeof AbortController === "function" ? new AbortController : null;
        const phaseBudget = settings && settings.artifactTimeoutMs !== undefined ? settings.artifactTimeoutMs : 30000;
        let phaseTimer;
        const resolvedSoFar = [];
        const lookup = {
          stage: "starting",
          requests: 0,
          statuses: {},
          candidates: null,
          offered: 0,
          failures: {},
          rejectedHosts: [],
          reason: "unresolved"
        };
        try {
          md = await Promise.race([
            appendPanelArtifacts(md, {
              doc: root,
              conversationId,
              scannedPanelFiles: firstSection ? Array.from(panelFilesDuringScan.values()) : undefined,
              scannedButtons: firstSection ? Array.from(buttonsDuringScan.values()) : undefined,
              clickDownloads: false,
              reportUnresolvedButtons: true,
              onInventory: function(artifacts) {
                lookup.candidates = artifacts === null ? null : artifacts.length;
                lookup.offered = (artifacts || []).filter(function(a) {
                  return a.priority === 0;
                }).length;
                lookup.stage = "panel";
              },
              onResolved: function(entry) {
                resolvedSoFar.push(entry);
              },
              onFailure: function(kind, host) {
                lookup.failures[kind] = (lookup.failures[kind] || 0) + 1;
                if (host && lookup.rejectedHosts.indexOf(host) === -1)
                  lookup.rejectedHosts.push(host);
              },
              onIncomplete: function() {
                attachmentsIncomplete = true;
              },
              fetchImpl: typeof fetch === "function" ? async function(url, init) {
                assertSameConversation();
                if (controller && controller.signal.aborted)
                  throw new Error("lookup cancelled");
                lookup.stage = String(url).indexOf("/api/auth/session") !== -1 ? "session" : String(url).indexOf("/interpreter/download") !== -1 || String(url).indexOf("/files/download/") !== -1 ? "file-link" : "conversation";
                lookup.requests += 1;
                const response = await fetch(url, Object.assign({}, init, controller ? { signal: controller.signal } : {}));
                const code = response && Number.isInteger(response.status) ? response.status : 0;
                lookup.statuses[code] = (lookup.statuses[code] || 0) + 1;
                return response;
              } : undefined
            }),
            new Promise(function(_resolve, reject) {
              phaseTimer = setTimeout(function() {
                lookup.reason = "timeout";
                if (controller)
                  controller.abort();
                reject(new Error("attachment lookup timed out"));
              }, phaseBudget);
            })
          ]);
        } catch (_error) {
          attachmentsIncomplete = true;
          if (lookup.reason !== "timeout")
            lookup.reason = "exception";
          const names = Array.from(new Set(Array.from(panelFilesDuringScan.values()).map(function(f) {
            return f.name;
          }).concat(Array.from(buttonsDuringScan.values()).map(function(b) {
            return b.label;
          }))));
          const available = resolvedSoFar.filter(function(entry) {
            return entry.resolved && entry.resolved.url;
          });
          const recoveredLinks = available.map(function(entry) {
            return markdownLink(entry.file.name, entry.resolved.url);
          });
          const recoveredNames = new Set(available.map(function(entry) {
            return entry.file.name;
          }));
          const missingNames = names.filter(function(name) {
            return !recoveredNames.has(name);
          });
          md += `

---

## Files` + (recoveredLinks.length ? `

` + recoveredLinks.join(`
`) : "") + `

> Attachment lookup failed or timed out; ` + "the conversation text was preserved. Re-run to retrieve files." + (missingNames.length ? `

> Could not retrieve a download link for: ` + missingNames.join(", ") : "");
        } finally {
          clearTimeout(phaseTimer);
        }
        if (attachmentsIncomplete) {
          md += `

> Attachment diagnostics: reason=` + lookup.reason + "; stage=" + lookup.stage + "; requests=" + lookup.requests + "; HTTP=" + JSON.stringify(lookup.statuses) + "; candidates=" + (lookup.candidates === null ? "unknown" : lookup.candidates) + "; resolved=" + resolvedSoFar.filter(function(entry) {
            return entry.resolved;
          }).length + "; offered=" + lookup.offered + "; linkFailures=" + JSON.stringify(lookup.failures) + "; rejectedHosts=" + JSON.stringify(lookup.rejectedHosts) + ".";
        }
      }
      if (wantFiles && /\(referenced file; not downloaded\)/.test(md)) {
        attachmentsIncomplete = true;
        md += `

> Library files cited in this conversation were not downloaded. ` + "Download them from ChatGPT Library before treating this export as complete.";
      }
      assertSameConversation();
      const title = extractConversationTitle();
      if (title)
        md = "# " + title + `

` + md;
      return {
        ok: true,
        md,
        partial: !!scanMeta && scanMeta.partial === true || attachmentsIncomplete,
        partialReason: scanMeta && scanMeta.partial ? scanMeta.reason : attachmentsIncomplete ? "attachments-unavailable" : null,
        title,
        slug: slugifyTitle(title),
        lines: md.split(`
`).length,
        words: md.split(/\s+/).filter(Boolean).length
      };
    } catch (error) {
      return { ok: false, error: error.message || String(error), stack: error && error.stack || null };
    }
  }
  async function fetchImageDataUrls(urls) {
    const results = [];
    for (const url of urls) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" || !["chatgpt.com", "chat.openai.com", "files.oaiusercontent.com"].includes(parsed.hostname)) {
          results.push(null);
          continue;
        }
        const response = await fetch(url);
        if (!response.ok) {
          results.push(null);
          continue;
        }
        const blob = await response.blob();
        const dataUrl = await new Promise(function(resolve, reject) {
          const reader = new FileReader;
          reader.onload = function() {
            resolve(reader.result);
          };
          reader.onerror = function() {
            reject(reader.error);
          };
          reader.readAsDataURL(blob);
        });
        results.push({ url, dataUrl });
      } catch (_e) {
        results.push(null);
      }
    }
    return results;
  }
  function turnsOnRoot(root) {
    if (!root || !root.querySelectorAll)
      return [];
    var legacy = root.querySelectorAll("[data-turn-id]");
    if (legacy && legacy.length) {
      return orderCapturedTurns(Array.from(legacy).map(function(section, index) {
        return extractTurn(section, index);
      }).filter(Boolean));
    }
    var modern = modernMessageSections(root);
    return orderCapturedTurns(modern.map(function(section, index) {
      return extractTurn(section, index);
    }).filter(Boolean));
  }
  function dedupeNamed(items, readName) {
    var seen = {};
    var out = [];
    for (var i = 0;i < items.length; i++) {
      var name = readName(items[i]);
      if (!name || seen[name])
        continue;
      seen[name] = true;
      out.push(items[i]);
    }
    return out;
  }
  function exportActiveSessionHtml(doc, options) {
    var opts = options || {};
    var site = opts.site || null;
    if (!site || typeof site.layoutStaticSite !== "function") {
      return { ok: false, error: "HTML exporter is unavailable." };
    }
    var root = activeConversationRoot(doc);
    if (!root)
      return { ok: false, error: "Could not identify the active conversation. Try again after it loads." };
    var turns = turnsOnRoot(root);
    if (!turns.length)
      return rateLimitPageError(doc) || { ok: false, error: "No conversation found on this page." };
    var saved = [];
    var missing = [];
    var partial = !!opts.partial;
    var renderedTurns = [];
    for (var i = 0;i < turns.length; i++) {
      var bound = site.bindRetrievedFiles(turns[i].markdown, opts.retrieved || []);
      renderedTurns.push({ role: turns[i].role, markdown: bound.markdown });
      saved = saved.concat(bound.saved);
      missing = missing.concat(bound.missing);
      if (bound.partial)
        partial = true;
    }
    var session = {
      id: opts.id || null,
      title: opts.title || "Conversation",
      slug: opts.slug || "conversation",
      projectId: opts.projectId || null,
      projectTitle: opts.projectTitle || null,
      projectSlug: opts.projectSlug || null,
      turns: renderedTurns,
      saved: dedupeNamed(saved, function(file) {
        return file.name;
      }),
      missing: dedupeNamed(missing, function(name) {
        return name;
      }),
      partial
    };
    var laid = site.layoutStaticSite([session]);
    if (opts.outputDir)
      site.writeStaticSite(opts.outputDir, laid);
    var page = null;
    for (var f = 0;f < laid.files.length; f++) {
      if (laid.files[f].role === "chat")
        page = laid.files[f];
    }
    return {
      ok: true,
      html: page ? page.body : "",
      pagePath: page ? page.path : null,
      partial: session.partial,
      missing: session.missing,
      files: laid.files,
      title: session.title
    };
  }

  // src/content/index.mjs
  globalThis.__c2mContentApi = exports_export;
  Object.assign(globalThis, exports_export);
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { ...globalThis.__c2mContentApi, exportActiveSessionHtml: (doc, opts) => globalThis.__c2mContentApi.exportActiveSessionHtml(doc, { ...opts, site: require('./site.js') }) };
