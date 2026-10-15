/** Read HTTP Markdown references, including escaped labels and angle URLs. */
function markdownHttpRefs(md) {
  const refs = [];
  const re = /(!?)\[((?:\\.|[^\]])*)\]\((?:<(https?:\/\/[^>\s]+)>|(https?:\/\/[^)\s]+))\)/g;
  let match;
  while ((match = re.exec(md)) !== null) {
    refs.push({
      image: match[1] === '!',
      label: match[2].replace(/\\([\\\[\]])/g, '$1'),
      url: match[3] || match[4],
    });
  }
  return refs;
}

/** Parse ![](url) references from Markdown, return {url, label, kind} pairs. */
function parseImageRefs(md) {
  const seen = new Set();
  const refs = [];
  for (const ref of markdownHttpRefs(md)) {
    if (!ref.image || seen.has(ref.url)) continue;
    let parsed;
    try {
      parsed = new URL(ref.url);
    } catch (_e) {
      continue;
    }
    if (
      parsed.protocol === 'https:' &&
      ['chatgpt.com', 'chat.openai.com', 'files.oaiusercontent.com'].includes(parsed.hostname)
    ) {
      seen.add(ref.url);
      refs.push({ url: ref.url, label: ref.label, kind: 'image' });
    }
  }
  return refs;
}

/** Parse [label](url) file links for downloadable artifacts (not images). */
function parseFileRefs(md) {
  const seen = new Set();
  const refs = [];
  for (const ref of markdownHttpRefs(md)) {
    if (!ref.image && !seen.has(ref.url) && isDownloadableFileUrl(ref.url)) {
      seen.add(ref.url);
      refs.push({ url: ref.url, label: ref.label, kind: 'file' });
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
    if (parsed.protocol !== 'https:') return false;
    if (parsed.hostname === 'files.oaiusercontent.com') return true;
    if (parsed.hostname === 'chatgpt.com' || parsed.hostname === 'chat.openai.com') {
      return parsed.pathname.includes('/files/') || parsed.pathname.includes('/estuary/');
    }
    return false;
  } catch (_e) {
    return false;
  }
}

/** Build the chatgpt-export/ sub-path for one exported conversation.
 *  A titled conversation gets its own folder so images sit next to the .md;
 *  an untitled one falls back to the flat legacy layout. */
function exportPath(slug, filename) {
  return slug ? 'chatgpt-export/' + slug + '/' + filename : 'chatgpt-export/' + filename;
}

/** Derive a filename from an image URL or alt text.
 *  Prefixing with the conversation slug keeps names unique across exports:
 *  two conversations both starting at image_001 would otherwise collide in the
 *  flat legacy folder, and Chrome would suffix them "image_001 (1).png". */
function imageFilename(url, alt, index, slug) {
  return artifactFilename(url, alt, index, slug, 'image');
}

/** Sanitize one path segment for the Downloads folder: no separators, no
 *  traversal, no reserved characters. Returns '' when nothing usable remains. */
function sanitizeFilenamePart(value) {
  if (!value) return '';
  var cleaned = String(value)
    .replace(/[\\/]+/g, '-')
    .replace(/[\x00-\x1f<>:"|?*]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/\.+$/, '');
  return cleaned.slice(0, 80);
}

/** Split a filename into stem and extension.
 *
 *  A compound extension such as `.tar.gz` needs no special case here: the stem
 *  keeps everything before the LAST dot, so `archive.tar` + `.gz` recombines to
 *  `archive.tar.gz` unchanged. An earlier version carried an explicit
 *  `(?:\.(?:tar|user))?` branch; a mutation proved it changed no observable
 *  output, so it was removed rather than left as untestable complexity. */
function splitFilenameExtension(name) {
  var match = String(name || '').match(/^(.*?)(\.[A-Za-z0-9]{1,8})$/);
  if (!match) return { stem: String(name || ''), ext: '' };
  return { stem: match[1], ext: match[2].toLowerCase() };
}

/** Derive a filename from an artifact URL or label text.
 *
 *  Documents keep their ORIGINAL name when the link carries one: a Word file
 *  offered as `Договор.docx` is worth more on disk under that name than as
 *  `file_003.docx`, and a batch export of many conversations is unreadable
 *  when every attachment is a numbered stub. Images stay numbered — their
 *  labels are alt text, not filenames — and any name collision is still
 *  disambiguated by the index prefix. */
function artifactFilename(url, label, index, slug, kind) {
  var ext = kind === 'image' ? 'png' : 'bin';
  var originalStem = '';

  var fromLabel = splitFilenameExtension(sanitizeFilenamePart(label));
  if (fromLabel.ext) {
    ext = fromLabel.ext.replace(/^\./, '');
    originalStem = fromLabel.stem;
  } else {
    try {
      var segments = new URL(url).pathname.split('/');
      var last = sanitizeFilenamePart(decodeURIComponent(segments[segments.length - 1] || ''));
      var fromPath = splitFilenameExtension(last);
      if (fromPath.ext) {
        ext = fromPath.ext.replace(/^\./, '');
        originalStem = fromPath.stem;
      }
    } catch (_e) {}
  }

  if (kind === 'image') {
    ext = ext.replace(/^jpe?g$/i, 'jpg');
    if (!/^(png|jpg|gif|webp|svg|bmp)$/i.test(ext)) ext = 'png';
    originalStem = '';
  }

  var prefix = slug ? slug + '-' : '';
  var counter = String(index + 1).padStart(3, '0');
  if (originalStem) {
    return prefix + counter + '-' + originalStem + '.' + ext;
  }
  var stem = kind === 'image' ? 'image' : 'file';
  return prefix + stem + '_' + counter + '.' + ext;
}

/** Marker introducing the conversation id in a batch export filename.
 *
 *  `slugifyTitle` strips this character from every title, so a slug can never contain
 *  it. That makes the current name format (`slug[--stamp]~id`) and the older,
 *  id-less format (`slug[--stamp]`) structurally NON-OVERLAPPING: no name written by
 *  an older version can be read as a current one. Every earlier scheme separated the
 *  id with `--`, which a title may legally contain, and each of the resulting five
 *  defects skipped a conversation that had never been saved. */
var ID_MARKER = '~';

/** Case-fold a candidate key up to the id marker, leaving the id itself untouched.
 *
 *  Two different rules for two different jobs: the path part must follow the
 *  filesystem (macOS and Windows treat `Budget/` and `budget/` as one directory), while
 *  the id must be compared exactly, because it is what makes a name attributable to
 *  one conversation. Both sides of the comparison call this, so they cannot drift. */
function foldExceptId(key) {
  var at = String(key).indexOf(ID_MARKER);
  if (at < 0) return String(key).toLowerCase();
  return String(key).slice(0, at).toLowerCase() + String(key).slice(at);
}

var EXPORT_STAMP_NONCE =
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2).padEnd(8, '0');
var exportStampSequence = 0;

/** Format a unique run stamp; older YYYYMMDD-HHMM stamps remain readable. */
function formatExportTimestamp(date) {
  var d = date || new Date();
  var pad = function (n) {
    return String(n).padStart(2, '0');
  };
  return (
    String(d.getFullYear()) +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    '-' +
    EXPORT_STAMP_NONCE +
    '-' +
    (++exportStampSequence).toString(36)
  );
}

/** Build the .md filename; timestamp suffix implements re-export without uniquify suffixes. */
function buildMdFilename(slug, useTimestamp, now, fixedStamp) {
  var base = slug || 'conversation';
  if (useTimestamp) {
    var stamp = fixedStamp || formatExportTimestamp(now);
    return base + '--' + stamp + '.md';
  }
  return base + '.md';
}

/** Progress label for a batch export: "3 of 12 — Conversation title". */
function formatBatchProgress(index, total, title) {
  var position = index + 1;
  var label = title ? ' — ' + title : '';
  return position + ' of ' + total + label;
}

/** Root folder for a project batch under Downloads/chatgpt-export/. */
function batchRootPath(projectSlug) {
  return projectSlug ? 'chatgpt-export/' + projectSlug : 'chatgpt-export';
}

/** Per-conversation folder inside a batch export. */
function conversationFolderPath(convSlug, projectSlug) {
  var root = batchRootPath(projectSlug);
  return convSlug ? root + '/' + convSlug : root;
}

/** Build the .md filename for a conversation inside a BATCH export.
 *
 *  The conversation id is appended because titles collide — duplicates and
 *  "Untitled" are ordinary inside a Project — and a resumed run has nothing but
 *  the download paths to identify what already landed. A single export keeps the
 *  clean, title-only name from `buildMdFilename`; only the batch pays the id. */
function batchMdFilename(convSlug, convId, useTimestamp, stamp, isPartial) {
  var base = convSlug || convId || 'conversation';
  // A truncated export is marked IN THE NAME, not only inside the file. Resume can
  // only see filenames, so an incomplete file under the complete name is
  // indistinguishable from a finished one and the next run skips the conversation —
  // refusing the one action that could repair it. The suffix goes before the stamp
  // and id so those keep their positions.
  if (isPartial) base += '-partial';
  var parts = base;
  if (useTimestamp) parts += '--' + (stamp || formatExportTimestamp());
  // The id is introduced by a marker `slugifyTitle` removes from every title, so no
  // title can forge an id boundary. That is the invariant the whole resume mechanism
  // rests on: without it the current and older name formats share an alphabet, and a
  // stamped older export is character-for-character a valid current name belonging to
  // some other conversation — which silently skipped that conversation.
  if (convId) parts += ID_MARKER + convId;
  return parts + '.md';
}

/** Full download path for a conversation's markdown file in a batch. */
function mdDownloadPath(convSlug, projectSlug, useTimestamp, stamp, convId) {
  var mdName = batchMdFilename(convSlug, convId, useTimestamp, stamp);
  return conversationFolderPath(convSlug, projectSlug) + '/' + mdName;
}

/** Filename stem with the `.md` extension removed. */
function mdStem(downloadPath) {
  var normalized = String(downloadPath || '').replace(/\\/g, '/');
  var file = normalized.split('/').filter(Boolean).pop() || '';
  return file.replace(/\.md$/i, '');
}

/** The conversation folder a download path sits in, relative to the export root.
 *  Folds to lower case because macOS and Windows treat `Budget/` and `budget/` as
 *  the same directory — the comparison must follow the filesystem, not the string. */
function conversationFolderFromPath(downloadPath) {
  var normalized = String(downloadPath || '').replace(/\\/g, '/');
  var anchor = normalized.indexOf('chatgpt-export/');
  if (anchor > 0) normalized = normalized.slice(anchor);
  var segments = normalized.split('/').filter(Boolean);
  segments.pop(); // drop the filename
  return segments.join('/');
}

/** Every name this conversation could have written, as folder-qualified keys.
 *
 *  `owned` names embed the conversation id and so belong to it alone. `legacy`
 *  names — written before ids were recorded — are shared by every namesake, so the
 *  caller must check for a single claimant before trusting one.
 *
 *  A stamp records when a past run happened and so cannot be reproduced from
 *  scratch. Rather than pattern-matching it out of a name (the inference that failed
 *  five times), the stamps actually present on disk are passed in and each is tried
 *  as a candidate. Generating `slug--<stamp>--<id>` and asking whether that exact
 *  name landed is an exact test of ownership. */
function candidateExportNames(conv, projectSlug, stamps) {
  var slug = conv.slug || conv.id || 'conversation';
  var folder = conversationFolderPath(slug, projectSlug).toLowerCase();
  var prefix = folder + '/' + String(slug).toLowerCase();
  var owned = [];
  var legacy = [prefix];
  var list = stamps || [];

  if (conv.id) {
    // The id keeps its case. Folder and slug are folded because macOS and Windows
    // fold them — that follows the filesystem. The id is different in kind: it is the
    // one field the whole design relies on to be unforgeable, and folding it would
    // collapse two distinct identities onto one name, so a conversation could be
    // excused by a file belonging to another. Not reachable while ChatGPT ids are
    // lowercase hex, but "this name can only mean one thing" is the assumption that
    // produced every silent-loss defect in this file's history.
    var id = String(conv.id);
    owned.push(prefix + ID_MARKER + id);
    for (var s = 0; s < list.length; s++) {
      owned.push(prefix + '--' + list[s] + ID_MARKER + id);
    }
  }
  // A STAMPED legacy name is deliberately NOT generated. `slug--20260817-1200` is
  // simultaneously "an older export of `slug`, stamped" and "an export of the
  // conversation whose id is `20260817-1200`" — the two name spaces overlap exactly
  // there, and nothing in the name resolves it. Treating such a file as proof let it
  // excuse a conversation that had never been written. The cost is that a stamped
  // export from an older version is re-exported once; the alternative is losing a
  // conversation, so the trade is not close.
  return { owned: owned, legacy: legacy };
}

/** The current unique stamps and older `YYYYMMDD-HHMM` stamps in download names.
 *
 *  Collected so `candidateExportNames` can generate the stamped names that could
 *  exist, instead of trying to recognise a stamp inside a name it did not build. A
 *  stamp is a fixed, unambiguous shape — unlike an id or a title — so reading one
 *  here is safe: a false positive only adds a candidate name that nothing matches. */
function stampsInPaths(paths) {
  var stamps = new Set();
  for (var i = 0; i < paths.length; i++) {
    // Split on the id marker as well as the separator: in `slug--<stamp>~<id>` the
    // stamp is followed by the marker, not by another separator.
    var fields = mdStem(paths[i]).split(/--|~/);
    for (var f = 0; f < fields.length; f++) {
      if (/^\d{8}-\d{4}(?:-[a-z0-9-]{8,36}-[a-z0-9]+)?$/.test(fields[f])) stamps.add(fields[f]);
    }
  }
  return Array.from(stamps);
}

/** Skip conversations whose markdown already landed in a prior partial run.
 *
 *  Identity is the conversation ID, never the title. Titles are derived into
 *  slugs, and slugs collide: duplicate titles are ordinary inside a Project,
 *  "Untitled" is common, and titles differing only by case fold onto one key.
 *  Every such collision used to make the first export skip the others FOREVER
 *  while reporting success — a silent loss that re-running could not repair.
 *  Conversations with no id fall back to the slug key, which is the old
 *  behaviour and still better than exporting nothing. */
function filterPendingConversations(conversations, completedPaths, projectSlug) {
  var paths = [];
  if (completedPaths && typeof completedPaths.forEach === 'function') {
    completedPaths.forEach(function (item) {
      paths.push(item);
    });
  }

  // GENERATE, DON'T PARSE. Five rounds of defects here all had one cause: reading a
  // filename to work out which conversation wrote it. Every attempt — matching the
  // whole stem, counting files per title, checking the trailing field against known
  // ids — was a different inference, and each one silently lost a conversation,
  // because a title can contain anything a separator or an id can contain.
  // `slugifyTitle('Budget - draft')` is `Budget---draft`, whose trailing field is a
  // legal ChatGPT id.
  //
  // The format is ours, so the question is answered forwards instead: for each
  // conversation, build the exact names it COULD have written, and look for those.
  // Nothing about an unrecognised name is inferred — it simply matches nothing.
  //
  // Legacy names (no id) stay ambiguous by nature: two conversations sharing a
  // title generate the same legacy name, and which one wrote the file is unknowable.
  // Such a name is trusted only when a single conversation claims it; otherwise both
  // re-export. Re-exporting costs bandwidth, a false skip loses a conversation
  // permanently and re-running cannot repair it, so ambiguity resolves to the cheap
  // direction.
  var landed = new Set();
  for (var i = 0; i < paths.length; i++) {
    var name = mdStem(paths[i]);
    // Keyed with the conversation folder so a name is only credited inside the folder
    // it belongs to. Everything up to the id marker is folded, matching the
    // filesystem's own case rules on macOS and Windows; the id after the marker keeps
    // its case, because it identifies the conversation rather than the file's place on
    // disk. See `candidateExportNames`, which must fold exactly the same way.
    var folder = conversationFolderFromPath(paths[i]);
    if (name) landed.add(foldExceptId(folder + '/' + name));
  }

  // How many conversations would generate each legacy name.
  var stamps = stampsInPaths(paths);

  // How many conversations could have written each candidate name. Counted across
  // owned AND legacy candidates together, because the two spaces overlap: a stamped
  // legacy name `Budget--20260817-1200` is also the id-bearing name of a
  // conversation whose id happens to be `20260817-1200`. A name more than one
  // conversation could have written is evidence about none of them.
  var claimants = Object.create(null);
  for (var c = 0; c < conversations.length; c++) {
    var all = candidateExportNames(conversations[c], projectSlug, stamps);
    var every = all.owned.concat(all.legacy);
    // Count each conversation once per distinct name, so a conversation cannot
    // inflate a name's count by generating it twice.
    var seen = new Set();
    for (var n = 0; n < every.length; n++) {
      if (seen.has(every[n])) continue;
      seen.add(every[n]);
      claimants[every[n]] = (claimants[every[n]] || 0) + 1;
    }
  }

  return conversations.filter(function (conv) {
    var names = candidateExportNames(conv, projectSlug, stamps);
    var every = names.owned.concat(names.legacy);
    for (var a = 0; a < every.length; a++) {
      // A landed name excuses this conversation only when no other conversation
      // could have produced the same name.
      if (landed.has(every[a]) && claimants[every[a]] === 1) return false;
    }
    return true;
  });
}

export {
  artifactFilename,
  batchMdFilename,
  batchRootPath,
  buildMdFilename,
  candidateExportNames,
  conversationFolderFromPath,
  conversationFolderPath,
  EXPORT_STAMP_NONCE,
  exportPath,
  exportStampSequence,
  filterPendingConversations,
  foldExceptId,
  formatBatchProgress,
  formatExportTimestamp,
  ID_MARKER,
  imageFilename,
  isDownloadableFileUrl,
  markdownHttpRefs,
  mdDownloadPath,
  mdStem,
  parseArtifactRefs,
  parseFileRefs,
  parseImageRefs,
  sanitizeFilenamePart,
  splitFilenameExtension,
  stampsInPaths,
};
