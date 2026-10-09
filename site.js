/**
 * Static HTML site for a saved ChatGPT export.
 *
 * Pure layout and rendering. The popup writes the bytes these functions
 * return. A separate local server reads the directory afterwards. Nothing
 * here talks to ChatGPT or keeps a session.
 *
 * Conversation text is escaped. A chat can contain markup, and a page opened
 * from disk still runs a script tag that was copied through.
 */
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeFileName(value) {
  var cleaned = String(value || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 120);
  return cleaned || 'file';
}

function slugSegment(value) {
  var slug = String(value || '')
    .normalize('NFC')
    .replace(/[\\/:*?"<>|~]+/g, ' ')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  if (!slug || /^\.+$/.test(slug)) return null;
  return slug;
}

function safeUrl(url) {
  var value = String(url || '');
  if (value.indexOf('..') !== -1) return false;
  if (value.indexOf('./') === 0) return true;
  return /^https?:\/\//i.test(value);
}

function fileNameFromUrl(url) {
  try {
    var pathname = new URL(url).pathname;
    var parts = pathname.split('/').filter(Boolean);
    return sanitizeFileName(parts.length ? parts[parts.length - 1] : 'file');
  } catch (_e) {
    return 'file';
  }
}

/** Same hosts content.js will fetch. Other https links stay outbound. */
function isConversationFileUrl(url) {
  var parsed;
  try {
    parsed = new URL(url);
  } catch (_e) {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.hostname === 'files.oaiusercontent.com') return true;
  if (parsed.hostname === 'chatgpt.com' || parsed.hostname === 'chat.openai.com') {
    return parsed.pathname.indexOf('/files/') !== -1 ||
      parsed.pathname.indexOf('/estuary/') !== -1;
  }
  return false;
}

/** Image and link URLs in already-captured Markdown. */
function collectMarkdownRefs(markdown) {
  var refs = [];
  var seen = {};
  var pattern = /(!?)\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
  var match;
  while ((match = pattern.exec(String(markdown || ''))) !== null) {
    if (seen[match[3]]) continue;
    seen[match[3]] = true;
    refs.push({ image: match[1] === '!', label: match[2], url: match[3] });
  }
  return refs;
}

function citedButNotDownloaded(markdown) {
  var names = [];
  var pattern = /`([^`]+)` \(referenced file; not downloaded\)/g;
  var match;
  while ((match = pattern.exec(String(markdown || ''))) !== null) names.push(match[1]);
  return names;
}

/**
 * Rewrite retrieved URLs to sibling relative paths and name anything that
 * did not arrive. A missing file keeps the export incomplete.
 */
function bindRetrievedFiles(markdown, retrieved) {
  var md = String(markdown || '');
  var byUrl = {};
  var files = retrieved || [];
  for (var i = 0; i < files.length; i++) {
    if (files[i] && files[i].url && files[i].bytes) byUrl[files[i].url] = files[i];
  }
  var saved = [];
  var missing = [];
  var used = {};
  var refs = collectMarkdownRefs(md);
  for (var r = 0; r < refs.length; r++) {
    var ref = refs[r];
    // A citation to the open web is not a file this export was supposed to
    // store. Rewriting it to "could not retrieve" deletes the link and marks
    // a complete transcript incomplete. Only conversation-file hosts are bound.
    if (!isConversationFileUrl(ref.url)) continue;
    var got = byUrl[ref.url];
    var name = sanitizeFileName((got && got.name) || ref.label || fileNameFromUrl(ref.url));
    if (got) {
      if (!used[name]) {
        used[name] = true;
        saved.push({ name: name, bytes: got.bytes });
      }
      md = md.split(ref.url).join('./' + name);
    } else {
      missing.push(name);
      var note = 'Could not retrieve: ' + name;
      if (ref.image) {
        md = md.split('![' + ref.label + '](' + ref.url + ')').join(note);
      } else {
        md = md.split('[' + ref.label + '](' + ref.url + ')').join(note);
      }
    }
  }
  var cited = citedButNotDownloaded(md);
  for (var c = 0; c < cited.length; c++) missing.push(cited[c]);
  return { markdown: md, saved: saved, missing: missing, partial: missing.length > 0 };
}

function renderInline(src) {
  var out = '';
  var i = 0;
  var text = String(src || '');
  while (i < text.length) {
    if (text.charAt(i) === '`') {
      var end = text.indexOf('`', i + 1);
      if (end > i) {
        out += '<code>' + escapeHtml(text.slice(i + 1, end)) + '</code>';
        i = end + 1;
        continue;
      }
    }
    if (text.slice(i, i + 2) === '![') {
      var image = /^!\[([^\]]*)\]\(([^)\s]+)\)/.exec(text.slice(i));
      if (image && safeUrl(image[2])) {
        out += '<img alt="' + escapeHtml(image[1]) + '" src="' + escapeHtml(image[2]) + '">';
        i += image[0].length;
        continue;
      }
    }
    if (text.charAt(i) === '[') {
      var link = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(text.slice(i));
      if (link && safeUrl(link[2])) {
        out += '<a href="' + escapeHtml(link[2]) + '">' + escapeHtml(link[1]) + '</a>';
        i += link[0].length;
        continue;
      }
    }
    var j = i + 1;
    while (j < text.length && text.charAt(j) !== '`' && text.charAt(j) !== '[' &&
        !(text.charAt(j) === '!' && text.charAt(j + 1) === '[')) j++;
    out += escapeHtml(text.slice(i, j));
    i = j;
  }
  return out;
}

function splitTableRow(line) {
  return String(line || '').trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function(cell) {
    return cell.trim();
  });
}

function isSeparatorRow(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function isTableStart(lines, index) {
  return index + 1 < lines.length && /^\s*\|/.test(lines[index]) && isSeparatorRow(lines[index + 1]);
}

function tableHtml(rows) {
  var html = '<table>';
  var bodyStarted = false;
  for (var i = 0; i < rows.length; i++) {
    if (isSeparatorRow(rows[i])) continue;
    var cells = splitTableRow(rows[i]);
    var tag = bodyStarted ? 'td' : 'th';
    if (!bodyStarted) bodyStarted = true;
    else if (i > 1) tag = 'td';
    html += '<tr>' + cells.map(function(cell) {
      return '<' + tag + '>' + renderInline(cell) + '</' + tag + '>';
    }).join('') + '</tr>';
  }
  return html + '</table>';
}

function markdownToHtml(markdown) {
  var lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  var html = '';
  var i = 0;
  while (i < lines.length) {
    if (lines[i].indexOf('```') === 0) {
      var code = [];
      i += 1;
      while (i < lines.length && lines[i].indexOf('```') !== 0) {
        code.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      html += '<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>';
      continue;
    }
    if (isTableStart(lines, i)) {
      var tableRows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        tableRows.push(lines[i]);
        i += 1;
      }
      html += tableHtml(tableRows);
      continue;
    }
    var heading = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (heading) {
      var level = heading[1].length;
      html += '<h' + level + '>' + renderInline(heading[2]) + '</h' + level + '>';
      i += 1;
      continue;
    }
    if (/^\s*---\s*$/.test(lines[i])) {
      html += '<hr>';
      i += 1;
      continue;
    }
    if (!lines[i].trim()) {
      i += 1;
      continue;
    }
    var paragraph = [];
    while (i < lines.length && lines[i].trim() && lines[i].indexOf('```') !== 0 &&
        !isTableStart(lines, i) && !/^(#{1,6})\s+/.test(lines[i]) && !/^\s*---\s*$/.test(lines[i])) {
      paragraph.push(lines[i]);
      i += 1;
    }
    html += '<p>' + renderInline(paragraph.join('\n')) + '</p>';
  }
  return html;
}

/** In the page itself. A separate stylesheet is another file the download can
 *  drop, and a page opened from disk would then have no formatting at all. */
function documentStyle() {
  return '<style>' +
    'html{background:#f4f1ea;color:#1f1a14}' +
    'body{max-width:44rem;margin:0 auto;padding:2.5rem 1.25rem 4rem;' +
      'font:1.05rem/1.6 Georgia,"Iowan Old Style",Palatino,"Palatino Linotype",serif}' +
    'h1{font-size:1.8rem;line-height:1.2;margin:0 0 1.5rem}' +
    'h2{font-size:.85rem;letter-spacing:.06em;text-transform:uppercase;margin:0 0 .7rem;color:#6b6258}' +
    'p{margin:.35rem 0 .85rem;white-space:pre-wrap;overflow-wrap:anywhere}' +
    'a{color:#1d4e89}' +
    'img{max-width:100%;height:auto}' +
    'pre{overflow:auto;padding:.9rem 1rem;background:#221e19;color:#f6f1e7;border-radius:8px}' +
    'code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9em}' +
    'table{border-collapse:collapse;width:100%;margin:0 0 1rem}' +
    'th,td{border:1px solid #d9d1c3;padding:.45rem .65rem;text-align:left;vertical-align:top;overflow-wrap:anywhere}' +
    'th{background:#efeae1}' +
    '.turn{margin:0 0 1rem;padding:1rem 1.1rem;border-radius:10px}' +
    '.turn.user{background:#fff}' +
    '.turn.assistant{background:#f7f3eb}' +
    '.missing,.partial{background:#fff4e5;border:1px solid #e6c48a;padding:.8rem 1rem;border-radius:8px}' +
    '.md-actions{display:flex;flex-wrap:wrap;gap:.5rem;margin:0 0 1.25rem}' +
    '.md-btn{display:inline-block;padding:.45rem .8rem;border:1px solid #d9d1c3;border-radius:8px;' +
      'background:#fff;color:#1d4e89;font:inherit;text-decoration:none;cursor:pointer}' +
    'ul{padding-left:1.2rem}li{margin:.4rem 0}' +
    '</style>';
}

function documentShell(title, body, tail) {
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>' + escapeHtml(title) + '</title>\n' + documentStyle() +
    '\n</head>\n<body>\n<h1>' + escapeHtml(title) + '</h1>\n' + body +
    (tail ? '\n' + tail : '') + '\n</body>\n</html>\n';
}

/** Markdown sibling of a chat page. The bound export text when the session
 *  has it; otherwise the turns, under the same role headings as a saved note. */
function sessionMarkdown(session) {
  var body = session && session.markdown ? String(session.markdown) : '';
  if (!body) {
    var turns = (session && session.turns) || [];
    var parts = [];
    for (var i = 0; i < turns.length; i++) {
      var role = turns[i].role === 'user' ? 'You said' : 'ChatGPT said';
      parts.push('#### ' + role + ':\n\n' + (turns[i].markdown || ''));
    }
    body = parts.join('\n\n');
    if (session && session.title) body = '# ' + session.title + (body ? '\n\n' + body : '');
  }
  if (session && session.partial && body.indexOf('Partial export.') === -1) {
    body += (body ? '\n\n' : '') + 'Partial export. Re-run to retrieve files that are still missing.';
  }
  if (body && body.charAt(body.length - 1) !== '\n') body += '\n';
  return body;
}

function markdownFileName(saved) {
  var taken = false;
  var files = saved || [];
  for (var i = 0; i < files.length; i++) {
    if (files[i] && files[i].name === 'conversation.md') taken = true;
  }
  return taken ? 'conversation-export.md' : 'conversation.md';
}

function markdownActions(href, mdPath) {
  return '<p class="md-actions">' +
    '<a class="md-btn" href="' + escapeHtml(href) + '" download="' + escapeHtml(href.replace(/^\.\//, '')) + '">Get in markdown</a>' +
    '<button type="button" class="md-btn" data-md-path="' + escapeHtml(mdPath) + '">Copy path to markdown version</button>' +
    '</p>';
}

/** Click handler for the path button. A constant: conversation text is never
 *  concatenated into it. On a file: page the copied path is the markdown file
 *  next to the page; otherwise it is the path inside the saved site. */
function markdownCopyScript() {
  return '<script>' +
    'document.addEventListener("click",function(event){' +
    'var button=event.target&&event.target.closest?event.target.closest("[data-md-path]"):null;' +
    'if(!button)return;' +
    'var path=button.getAttribute("data-md-path")||"";' +
    'if(location.protocol==="file:"){' +
    'try{var page=decodeURIComponent(location.pathname||"");' +
    'if(/^\\/[A-Za-z]:\\//.test(page))page=page.slice(1);' +
    'var cut=page.lastIndexOf("/");' +
    'var leaf=path.split("/").pop()||"conversation.md";' +
    'if(cut>=0)path=page.slice(0,cut+1)+leaf;}catch(e){}}' +
    'function finish(ok){var previous=button.getAttribute("data-md-label")||button.textContent;' +
    'if(!button.getAttribute("data-md-label"))button.setAttribute("data-md-label",previous);' +
    'button.textContent=ok?"Path copied":"Path not copied";' +
    'setTimeout(function(){button.textContent=button.getAttribute("data-md-label");},1500);}' +
    'function fallback(value){var area=document.createElement("textarea");area.value=value;' +
    'document.body.appendChild(area);area.select();var ok=false;' +
    'try{ok=document.execCommand("copy");}catch(e){}area.remove();return ok;}' +
    'if(navigator.clipboard&&navigator.clipboard.writeText){' +
    'navigator.clipboard.writeText(path).then(function(){finish(true);},function(){finish(fallback(path));});}' +
    'else{finish(fallback(path));}});' +
    '</script>';
}

function renderSessionHtml(session, link) {
  var title = session.title || 'Conversation';
  var href = (link && link.href) || './conversation.md';
  var mdPath = (link && link.path) || 'conversation.md';
  var body = markdownActions(href, mdPath);
  var turns = session.turns || [];
  if (turns.length) {
    for (var i = 0; i < turns.length; i++) {
      var role = turns[i].role === 'user' ? 'user' : 'assistant';
      var label = role === 'user' ? 'You said' : 'ChatGPT said';
      body += '<section class="turn ' + role + '"><h2>' + label + '</h2>' +
        markdownToHtml(turns[i].markdown || '') + '</section>';
    }
  } else {
    body += markdownToHtml(session.markdown || '');
  }
  var missing = session.missing || [];
  if (missing.length) {
    body += '<aside class="missing"><p>Could not retrieve: ' +
      missing.map(escapeHtml).join(', ') + '</p></aside>';
  }
  if (session.partial) {
    body += '<p class="partial">Partial export. Re-run to retrieve files that are still missing.</p>';
  }
  return {
    html: documentShell(title, body, markdownCopyScript()),
    title: title,
    partial: !!(session.partial || missing.length),
  };
}

/** Conversation id suffix. Same character as popup.js ID_MARKER: titles are
 *  slugified without it, so two chats named Notes cannot share a directory. */
function conversationIdSegment(session) {
  var raw = session && session.id ? String(session.id) : '';
  var id = raw.replace(/[\\/:*?"<>|~\u0000-\u001f]/g, '');
  return id || null;
}

function chatSegment(session) {
  var base = slugSegment(session.slug) || slugSegment(session.title) || 'chat';
  var id = conversationIdSegment(session);
  if (!id) return base;
  return base + '~' + id;
}

function projectSegment(session) {
  return slugSegment(session.projectSlug) || slugSegment(session.projectTitle) || slugSegment(session.projectId) || null;
}

/**
 * A project chat lives under that project. A chat with no project stays
 * under chats/ so it is still its own address.
 */
function sessionDirectory(session) {
  var chat = chatSegment(session);
  var project = projectSegment(session);
  if (project) return project + '/' + chat;
  return 'chats/' + chat;
}

function pageShell(title, body) {
  return documentShell(title, body);
}

function layoutStaticSite(sessions) {
  var list = sessions || [];
  var files = [];
  var projects = {};
  var projectOrder = [];
  var loose = [];
  for (var i = 0; i < list.length; i++) {
    var session = list[i];
    var dir = sessionDirectory(session);
    var project = projectSegment(session);
    var saved = session.saved || [];
    var markdownName = markdownFileName(saved);
    var markdownPath = dir + '/' + markdownName;
    var rendered = renderSessionHtml(session, {
      href: './' + markdownName,
      path: markdownPath,
    });
    files.push({
      path: dir + '/index.html',
      body: rendered.html,
      mime: 'text/html; charset=utf-8',
      role: 'chat',
    });
    files.push({
      path: markdownPath,
      body: sessionMarkdown(session),
      mime: 'text/markdown; charset=utf-8',
      role: 'markdown',
    });
    for (var s = 0; s < saved.length; s++) {
      files.push({
        path: dir + '/' + saved[s].name,
        body: saved[s].bytes,
        mime: 'application/octet-stream',
        role: 'file',
      });
    }
    var chatLink = { title: session.title || chatSegment(session), href: dir + '/index.html', dir: dir };
    if (project) {
      if (!projects[project]) {
        projects[project] = { slug: project, title: session.projectTitle || project, chats: [] };
        projectOrder.push(project);
      }
      projects[project].chats.push(chatLink);
    } else {
      loose.push(chatLink);
    }
  }
  for (var p = 0; p < projectOrder.length; p++) {
    var group = projects[projectOrder[p]];
    var items = group.chats.map(function(chat) {
      var relative = chat.dir.slice(group.slug.length + 1) + '/index.html';
      return '<li><a href="' + escapeHtml(relative) + '">' + escapeHtml(chat.title) + '</a></li>';
    }).join('');
    files.push({
      path: group.slug + '/index.html',
      body: pageShell(group.title, '<ul>' + items + '</ul>'),
      mime: 'text/html; charset=utf-8',
      role: 'project',
    });
  }
  var indexBody = '';
  if (projectOrder.length) {
    indexBody += '<section><h2>Projects</h2><ul>' + projectOrder.map(function(slug) {
      var group = projects[slug];
      return '<li><a href="' + escapeHtml(group.slug + '/index.html') + '">' + escapeHtml(group.title) + '</a></li>';
    }).join('') + '</ul></section>';
  }
  if (loose.length) {
    indexBody += '<section><h2>Chats</h2><ul>' + loose.map(function(chat) {
      return '<li><a href="' + escapeHtml(chat.href) + '">' + escapeHtml(chat.title) + '</a></li>';
    }).join('') + '</ul></section>';
  }
  if (!indexBody) indexBody = '<p>No conversations exported.</p>';
  files.unshift({
    path: 'index.html',
    body: pageShell('Chat archive', indexBody),
    mime: 'text/html; charset=utf-8',
    role: 'index',
  });
  return { files: files };
}

function writeStaticSite(dir, laid) {
  var fs = require('fs');
  var path = require('path');
  var files = (laid && laid.files) || [];
  for (var i = 0; i < files.length; i++) {
    var dest = path.join(dir, files[i].path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (typeof files[i].body === 'string') fs.writeFileSync(dest, files[i].body);
    else fs.writeFileSync(dest, Buffer.from(files[i].body));
  }
  return { dir: dir, files: files.length };
}

function sessionFromExport(conv, result) {
  var source = result || {};
  var meta = conv || {};
  var bound = bindRetrievedFiles(source.md || source.markdown || '', meta.retrievedFiles || []);
  return {
    id: meta.id || null,
    title: source.title || meta.title || 'Conversation',
    slug: source.slug || meta.slug || null,
    projectId: meta.projectId || null,
    projectTitle: meta.projectTitle || null,
    projectSlug: meta.projectSlug || null,
    markdown: bound.markdown,
    saved: bound.saved,
    missing: bound.missing,
    partial: !!(source.partial || bound.partial),
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    escapeHtml: escapeHtml,
    bindRetrievedFiles: bindRetrievedFiles,
    markdownToHtml: markdownToHtml,
    renderSessionHtml: renderSessionHtml,
    sessionDirectory: sessionDirectory,
    layoutStaticSite: layoutStaticSite,
    writeStaticSite: writeStaticSite,
    sessionFromExport: sessionFromExport,
    slugSegment: slugSegment,
  };
}
