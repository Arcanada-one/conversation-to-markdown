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

function renderSessionHtml(session) {
  var title = session.title || 'Conversation';
  var body = '';
  var turns = session.turns || [];
  if (turns.length) {
    for (var i = 0; i < turns.length; i++) {
      var role = turns[i].role === 'user' ? 'user' : 'assistant';
      var label = role === 'user' ? 'You said' : 'ChatGPT said';
      body += '<section class="turn ' + role + '"><h2>' + label + '</h2>' +
        markdownToHtml(turns[i].markdown || '') + '</section>';
    }
  } else {
    body = markdownToHtml(session.markdown || '');
  }
  var missing = session.missing || [];
  if (missing.length) {
    body += '<aside class="missing"><p>Could not retrieve: ' +
      missing.map(escapeHtml).join(', ') + '</p></aside>';
  }
  if (session.partial) {
    body += '<p class="partial">Partial export. Re-run to retrieve files that are still missing.</p>';
  }
  var html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>' +
    escapeHtml(title) + '</title>\n</head>\n<body>\n<h1>' + escapeHtml(title) +
    '</h1>\n' + body + '\n</body>\n</html>\n';
  return { html: html, title: title, partial: !!(session.partial || missing.length) };
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
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>' +
    escapeHtml(title) + '</title>\n</head>\n<body>\n<h1>' + escapeHtml(title) +
    '</h1>\n' + body + '\n</body>\n</html>\n';
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
    var rendered = renderSessionHtml(session);
    files.push({
      path: dir + '/index.html',
      body: rendered.html,
      mime: 'text/html; charset=utf-8',
      role: 'chat',
    });
    var saved = session.saved || [];
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
