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
      html += '<div class="code-block"><button type="button" class="md-btn" data-copy-code>Copy code</button>' +
        '<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre></div>';
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
    '.code-block{position:relative;margin:0 0 1rem}' +
    '.code-block pre{margin:0}' +
    '.code-block .md-btn{position:absolute;top:.45rem;right:.45rem;font-size:.8rem}' +
    '.archive-search{width:100%;box-sizing:border-box;margin:.4rem 0 1.25rem;padding:.55rem .7rem;' +
      'border:1px solid #d9d1c3;border-radius:8px;font:inherit;background:#fff;color:#1f1a14}' +
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
    'function fallback(value){var area=document.createElement("textarea");area.value=value;' +
    'document.body.appendChild(area);area.select();var ok=false;' +
    'try{ok=document.execCommand("copy");}catch(e){}area.remove();return ok;}' +
    'function finish(button,ok,done,failed){var previous=button.getAttribute("data-md-label")||button.textContent;' +
    'if(!button.getAttribute("data-md-label"))button.setAttribute("data-md-label",previous);' +
    'button.textContent=ok?done:failed;' +
    'setTimeout(function(){button.textContent=button.getAttribute("data-md-label");},1500);}' +
    'function writeText(button,value,done,failed){' +
    'if(navigator.clipboard&&navigator.clipboard.writeText){' +
    'navigator.clipboard.writeText(value).then(function(){finish(button,true,done,failed);},function(){finish(button,fallback(value),done,failed);});}' +
    'else{finish(button,fallback(value),done,failed);}}' +
    'document.addEventListener("click",function(event){' +
    'var codeBtn=event.target&&event.target.closest?event.target.closest("[data-copy-code]"):null;' +
    'if(codeBtn){var holder=codeBtn.parentElement;' +
    'var code=holder&&holder.querySelector?holder.querySelector("code"):null;' +
    'writeText(codeBtn,code?code.textContent:"","Code copied","Code not copied");return;}' +
    'var button=event.target&&event.target.closest?event.target.closest("[data-md-path]"):null;' +
    'if(!button)return;' +
    'var path=button.getAttribute("data-md-path")||"";' +
    'if(location.protocol==="file:"){' +
    'try{var page=decodeURIComponent(location.pathname||"");' +
    'if(/^\\/[A-Za-z]:\\//.test(page))page=page.slice(1);' +
    'var cut=page.lastIndexOf("/");' +
    'var leaf=path.split("/").pop()||"conversation.md";' +
    'if(cut>=0)path=page.slice(0,cut+1)+leaf;}catch(e){}}' +
    'writeText(button,path,"Path copied","Path not copied");});' +
    '</script>';
}

/** Filter on the archive index. A constant: chat titles are read from the
 *  list items at input time, never copied into this script. */
function archiveSearchScript() {
  return '<script>' +
    'document.addEventListener("input",function(event){' +
    'var box=event.target;' +
    'if(!box||!box.getAttribute||box.getAttribute("data-archive-search")===null)return;' +
    'var q=String(box.value||"").toLowerCase();' +
    'var items=document.querySelectorAll("li");' +
    'for(var i=0;i<items.length;i++){' +
    'var text=String(items[i].textContent||"").toLowerCase();' +
    'items[i].style.display=!q||text.indexOf(q)!==-1?"":"none";}});' +
    '</script>';
}

function archiveSearchBox() {
  return '<p><label>Search chats<input class="archive-search" type="search" data-archive-search></label></p>';
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
  return documentShell(title, archiveSearchBox() + body, archiveSearchScript());
}

function chatLinkForSession(session) {
  var dir = sessionDirectory(session);
  var project = projectSegment(session);
  return {
    title: session.title || chatSegment(session),
    href: dir + '/index.html',
    dir: dir,
    partial: !!(session.partial || (session.missing && session.missing.length)),
    projectSlug: project,
    projectTitle: session.projectTitle || project,
  };
}

/** Files for one chat. The root index is a separate write, so a run can put
 *  this chat on disk before it knows what the rest of the archive will be. */
function layoutChatFiles(session) {
  var dir = sessionDirectory(session);
  var saved = session.saved || [];
  var markdownName = markdownFileName(saved);
  var markdownPath = dir + '/' + markdownName;
  var rendered = renderSessionHtml(session, {
    href: './' + markdownName,
    path: markdownPath,
  });
  var files = [{
    path: dir + '/index.html',
    body: rendered.html,
    mime: 'text/html; charset=utf-8',
    role: 'chat',
  }, {
    path: markdownPath,
    body: sessionMarkdown(session),
    mime: 'text/markdown; charset=utf-8',
    role: 'markdown',
  }];
  for (var s = 0; s < saved.length; s++) {
    files.push({
      path: dir + '/' + saved[s].name,
      body: saved[s].bytes,
      mime: 'application/octet-stream',
      role: 'file',
    });
  }
  // A partial page stays readable, and its directory must not look finished.
  // The marker is a separate file so resume can tell the two apart from the
  // name alone. Chrome cannot delete the marker later; a chat that was once
  // incomplete is exported again, which is the cheap direction.
  if (!session.partial && !(session.missing && session.missing.length)) {
    files.push({
      path: dir + '/export-complete.txt',
      body: 'complete\n',
      mime: 'text/plain; charset=utf-8',
      role: 'marker',
    });
  }
  return { files: files, link: chatLinkForSession(session) };
}

/** Two-segment chat directory inside chatgpt-export/html/, or null.
 *  The root index and a project index are one segment and are not chats. */
function htmlChatDirFromDownloadPath(downloadPath) {
  var normalized = String(downloadPath || '').replace(/\\/g, '/');
  var marker = 'chatgpt-export/html/';
  var at = normalized.toLowerCase().indexOf(marker);
  if (at < 0) return null;
  var rest = normalized.slice(at + marker.length);
  if (!/\/index\.html$/i.test(rest)) return null;
  var dir = rest.replace(/\/index\.html$/i, '');
  var parts = dir.split('/').filter(Boolean);
  if (parts.length !== 2) return null;
  if (parts[0].indexOf('..') !== -1 || parts[1].indexOf('..') !== -1) return null;
  return parts.join('/');
}

function htmlCompleteDirFromDownloadPath(downloadPath) {
  var normalized = String(downloadPath || '').replace(/\\/g, '/');
  var marker = 'chatgpt-export/html/';
  var at = normalized.toLowerCase().indexOf(marker);
  if (at < 0) return null;
  var rest = normalized.slice(at + marker.length);
  if (!/\/export-complete\.txt$/i.test(rest)) return null;
  var dir = rest.replace(/\/export-complete\.txt$/i, '');
  var parts = dir.split('/').filter(Boolean);
  if (parts.length !== 2) return null;
  if (parts[0].indexOf('..') !== -1 || parts[1].indexOf('..') !== -1) return null;
  return parts.join('/');
}

function titleFromChatDir(dir) {
  var leaf = String(dir || '').split('/').pop() || 'chat';
  var cut = leaf.indexOf('~');
  var base = cut >= 0 ? leaf.slice(0, cut) : leaf;
  var title = base.replace(/-/g, ' ').trim();
  return title || leaf;
}

/** Links for chat pages already downloaded. This run's own pages replace
 *  any link with the same directory, so a title from this run wins. */
function earlierChatLinksFromPaths(paths) {
  var links = [];
  var seen = Object.create(null);
  var list = paths || [];
  for (var i = 0; i < list.length; i++) {
    var dir = htmlChatDirFromDownloadPath(list[i]);
    if (!dir) continue;
    var key = dir.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    var parts = dir.split('/');
    var project = parts[0] === 'chats' ? null : parts[0];
    links.push({
      title: titleFromChatDir(dir),
      href: dir + '/index.html',
      dir: dir,
      partial: false,
      projectSlug: project,
      projectTitle: project,
      earlier: true,
    });
  }
  return links;
}

function chatListItem(chat, href) {
  var mark = chat.partial ? ' <span class="partial">incomplete</span>' : '';
  return '<li><a href="' + escapeHtml(href) + '">' + escapeHtml(chat.title) + '</a>' + mark + '</li>';
}

function layoutIndexFiles(links) {
  var files = [];
  var projects = {};
  var projectOrder = [];
  var loose = [];
  var list = links || [];
  for (var i = 0; i < list.length; i++) {
    var chat = list[i];
    if (!chat || !chat.dir) continue;
    if (chat.projectSlug) {
      if (!projects[chat.projectSlug]) {
        projects[chat.projectSlug] = {
          slug: chat.projectSlug,
          title: chat.projectTitle || chat.projectSlug,
          chats: [],
        };
        projectOrder.push(chat.projectSlug);
      }
      projects[chat.projectSlug].chats.push(chat);
    } else {
      loose.push(chat);
    }
  }
  for (var p = 0; p < projectOrder.length; p++) {
    var group = projects[projectOrder[p]];
    var items = group.chats.map(function(chat) {
      var relative = chat.dir.slice(group.slug.length + 1) + '/index.html';
      return chatListItem(chat, relative);
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
      return chatListItem(chat, chat.href);
    }).join('') + '</ul></section>';
  }
  if (!indexBody) indexBody = '<p>No conversations exported.</p>';
  files.unshift({
    path: 'index.html',
    body: pageShell('Chat archive', indexBody),
    mime: 'text/html; charset=utf-8',
    role: 'index',
  });
  return files;
}

function mergeChatLinks(current, earlierPaths) {
  var merged = [];
  var seen = Object.create(null);
  var list = current || [];
  for (var i = 0; i < list.length; i++) {
    merged.push(list[i]);
    if (list[i] && list[i].dir) seen[String(list[i].dir).toLowerCase()] = true;
  }
  var earlier = earlierChatLinksFromPaths(earlierPaths);
  for (var e = 0; e < earlier.length; e++) {
    if (seen[String(earlier[e].dir).toLowerCase()]) continue;
    merged.push(earlier[e]);
  }
  return merged;
}

function layoutStaticSite(sessions, earlierPaths) {
  var list = sessions || [];
  var files = [];
  var links = [];
  for (var i = 0; i < list.length; i++) {
    var chat = layoutChatFiles(list[i]);
    files = files.concat(chat.files);
    links.push(chat.link);
  }
  var indexes = layoutIndexFiles(mergeChatLinks(links, earlierPaths));
  return { files: indexes.concat(files) };
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
    layoutChatFiles: layoutChatFiles,
    layoutStaticSite: layoutStaticSite,
    htmlChatDirFromDownloadPath: htmlChatDirFromDownloadPath,
    htmlCompleteDirFromDownloadPath: htmlCompleteDirFromDownloadPath,
    writeStaticSite: writeStaticSite,
    sessionFromExport: sessionFromExport,
    slugSegment: slugSegment,
  };
}
