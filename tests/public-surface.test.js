const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

const requiredFiles = [
  '.github/CODEOWNERS',
  '.github/dependabot.yml',
  '.github/workflows/ci.yml',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'PRIVACY.md',
  'README.md',
  'SECURITY.md',
  'assets/conversation-to-markdown-hero.jpg',
  'public-files.allowlist',
];

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  assert.ok(fs.existsSync(absolutePath), `${relativePath} must exist`);
  return fs.readFileSync(absolutePath, 'utf8');
}

test('ships every public document and repository policy', () => {
  const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(root, file)));
  assert.deepEqual(missing, []);
});

test('ships an optimized JPEG documentation hero', () => {
  const heroPath = path.join(root, 'assets/conversation-to-markdown-hero.jpg');
  const legacyPngPath = path.join(root, 'assets/conversation-to-markdown-hero.png');
  const hero = fs.readFileSync(heroPath);

  assert.equal(hero[0], 0xff);
  assert.equal(hero[1], 0xd8);
  assert.ok(hero.byteLength <= 200 * 1024, `hero is ${hero.byteLength} bytes`);
  assert.equal(fs.existsSync(legacyPngPath), false);
});

test('uses a neutral public identity throughout the extension', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const popup = read('popup.html');
  assert.equal(manifest.name, 'Conversation to Markdown');
  // Read from the CHANGELOG rather than restated here: a hardcoded literal turns
  // every release into a test edit, and an edited assertion is not a check.
  const topChangelogVersion = (read('CHANGELOG.md').match(/^## \[(\d+\.\d+\.\d+)\]/m) || [])[1];
  assert.equal(manifest.version, topChangelogVersion);
  assert.match(popup, /Conversation to Markdown/);
  assert.doesNotMatch(popup, /ChatGPT\s*→\s*Markdown/);
  // An exact-set lock, not a subset check: a permission added without a
  // deliberate edit here is a permission nobody reviewed.
  //
  // `activeTab` was REMOVED in 1.6.0. It was never load-bearing — `scripting` is
  // authorised by `host_permissions`, and `tab.url` is readable from host
  // permission alone — and it was actively misleading, because an `activeTab`
  // grant is revoked on navigation while the batch deliberately navigates the
  // tab. A declared-but-unused permission is also an over-broad-permission
  // finding in Web Store review.
  //
  // `storage` was ADDED in 1.2.0, deliberately and with a cost. Resume used to
  // read Chrome's download HISTORY to work out what a previous run had saved,
  // which is a worse privacy position than keeping a small index of our own: the
  // history answer includes unrelated downloads, and a filename cannot express
  // that a conversation has grown since it was exported. Measured before it was
  // designed: an index of 800 conversations is 210 743 bytes — 2% of the 10MB
  // quota — written in 15ms and read in 6ms, and it survives a browser restart.
  //
  // Two consequences are load-bearing elsewhere. The API is entirely ABSENT
  // without this permission (`chrome.storage === undefined`, not a throwing
  // call), so every access is guarded; and PRIVACY.md previously promised the
  // extension "deliberately stores no state of its own", which this makes false
  // and which was rewritten in the same change rather than left to drift.
  assert.deepEqual(
    [...manifest.permissions].sort(),
    ['clipboardWrite', 'downloads', 'scripting', 'storage'],
  );
});

test('README states independence and non-affiliation', () => {
  const readme = read('README.md');
  assert.match(readme, /Independent open-source project/);
  assert.match(readme, /not affiliated with, endorsed by, or sponsored by OpenAI/);
  assert.match(readme, /#### You said:/);
  assert.match(readme, /#### ChatGPT said:/);
  assert.doesNotMatch(readme, /^## (?:User|Assistant)$/m);
});

test('the changelog documents the version being shipped', () => {
  // Releases 1.1.6 and 1.1.7 reached the store leaving no tag, no release and
  // no changelog entry behind — the only record of what changed was a commit
  // message. Coupling the changelog to the manifest means a version bump that
  // forgets to say what changed fails the build instead of shipping silently.
  const manifest = JSON.parse(read('manifest.json'));
  const changelog = read('CHANGELOG.md');
  // Match the heading as a plain string rather than building a regex out of
  // the version: hand-escaping an interpolated value is a habit worth not
  // having, and there is nothing here a regex does better.
  const dated = /^## \[(\d+\.\d+\.\d+)\] — \d{4}-\d{2}-\d{2}$/gm;
  const documented = [...changelog.matchAll(dated)].map((m) => m[1]);
  assert.ok(
    documented.includes(manifest.version),
    `CHANGELOG.md must carry a dated entry for ${manifest.version}; found ${documented.join(', ') || 'none'}`,
  );
});

test('allowlisted text files contain no private or internal material', () => {
  const files = read('public-files.allowlist').trim().split('\n');
  const textFiles = files.filter(
    (file) => !/\.(?:jpe?g|png)$/i.test(file) && file !== 'tests/public-surface.test.js',
  );
  const forbidden = [
    /\b(?:AGENT|CONTENT|INFRA|QCK|TUNE)-\d{4}\b/,
    /\/(?:Users|home)\/[A-Za-z0-9._-]+\//,
    /[A-Za-z]:\\Users\\[^\\]+\\/,
    /https:\/\/chatgpt\.com\/c\/[A-Za-z0-9-]+/,
    /[?&](?:sig|signature|token|expires|x-amz-[^=]+)=/i,
    /\b(?:DESIGN|PLAN)\.md\b/,
    /(?:^|\/)examples\//,
  ];

  for (const file of textFiles) {
    const body = read(file);
    for (const pattern of forbidden) {
      assert.doesNotMatch(body, pattern, `${file} matches ${pattern}`);
    }
  }
});

// Credential shapes that must never reach a public repository. Kept separate
// from the internal-material list above because these are scanned across EVERY
// tracked file, not just the allowlist — a leaked key in an unlisted file is
// still published.
const CREDENTIAL_PATTERNS = [
  [/-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/, 'private key block'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{22,}\b/, 'GitHub fine-grained PAT'],
  [/\bsk-[A-Za-z0-9]{20,}\b/, 'OpenAI-style secret key'],
  [/\bsk-ant-[A-Za-z0-9-]{20,}\b/, 'Anthropic API key'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, 'Slack token'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'Google API key'],
  [/\bhv[sb]\.[A-Za-z0-9_-]{20,}\b/, 'Vault token'],
  [/\bcfut_[A-Za-z0-9_-]{20,}\b/, 'Cloudflare token'],
  [/\bglpat-[A-Za-z0-9_-]{20,}\b/, 'GitLab PAT'],
  [/\b\d{6,}:AA[A-Za-z0-9_-]{30,}\b/, 'Telegram bot token'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, 'JWT'],
  [/(?:api[_-]?key|secret|passwd|password|access[_-]?token)\s*[:=]\s*['"][^'"\s]{12,}['"]/i, 'assigned secret literal'],
];

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

test('no tracked file carries a credential', () => {
  const binary = /\.(?:jpe?g|png|gif|webp|ico|woff2?|zip|pdf)$/i;
  const findings = [];

  for (const file of trackedFiles()) {
    if (binary.test(file)) continue;
    const body = fs.readFileSync(path.join(root, file), 'utf8');
    for (const [pattern, label] of CREDENTIAL_PATTERNS) {
      const hit = body.match(pattern);
      // Report the file, the rule and the match length — never the value itself.
      if (hit) findings.push(`${file}: ${label} (${hit[0].length} chars)`);
    }
  }

  assert.deepEqual(findings, [], `credential material in tracked files:\n${findings.join('\n')}`);
});

test('every tracked file is declared in the allowlist', () => {
  const declared = new Set(read('public-files.allowlist').trim().split('\n'));
  const undeclared = trackedFiles().filter((file) => !declared.has(file));

  assert.deepEqual(
    undeclared,
    [],
    `tracked but not allowlisted — review before publishing:\n${undeclared.join('\n')}`,
  );
});

test('shipped JavaScript has no network, storage, or analytics calls', () => {
  const popupJs = read('popup.js');
  const contentJs = read('content.js');
  const forbidden = [
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /\b(?:gtag|ga|mixpanel|amplitude|analytics)\s*\(/,
  ];

  for (const pattern of forbidden) {
    assert.doesNotMatch(popupJs, pattern, `popup.js matches ${pattern}`);
    assert.doesNotMatch(contentJs, pattern, `content.js matches ${pattern}`);
  }

  // `chrome.storage` is permitted in popup.js from 1.2.0 — the export index —
  // and stays banned in content.js. That split is the point, not an oversight:
  // content.js runs inside the ChatGPT page, on the user's conversations, and
  // nothing there needs to persist. Keeping the ban where the conversation
  // content lives means a future edit cannot quietly start retaining it.
  assert.doesNotMatch(contentJs, /\bchrome\.storage\b/, 'content.js must not use chrome.storage');
  // The index lives behind named helpers rather than scattered calls, so the
  // whole storage surface is auditable in one place.
  assert.match(popupJs, /function readExportIndex\b/);
  assert.match(popupJs, /function recordExportedConversation\b/);
  // Only `local` — `sync` would copy a record of the user's conversations to
  // their Google account, which is a different privacy promise entirely.
  assert.doesNotMatch(popupJs, /chrome\.storage\.sync\b/, 'the index must never sync');
  assert.doesNotMatch(popupJs, /chrome\.storage\.managed\b/);

  // fetch() is allowed in content.js only — used by fetchImageDataUrls
  // for image downloading via declared host_permissions.
  assert.doesNotMatch(popupJs, /\bfetch\s*\(/, 'popup.js must not use fetch');
  assert.match(contentJs, /\bfetch\s*\(/, 'content.js must use fetch for image download');
  assert.match(contentJs, /fetchImageDataUrls/, 'fetch must be wrapped in fetchImageDataUrls');
});

test('CI is read-only and pins every action by full commit SHA', () => {
  const workflow = read('.github/workflows/ci.yml');
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(workflow, /pull_request_target/);

  const uses = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]);
  assert.ok(uses.length > 0, 'workflow must use at least one action');
  for (const action of uses) assert.match(action, /@[a-f0-9]{40}$/);
});

test('PRIVACY.md describes every permission the manifest declares', () => {
  // The document said the extension "deliberately stores no state of its own"
  // while a change was adding the `storage` permission. A privacy policy that
  // contradicts the manifest is worse than a vague one: it is a promise the
  // build cannot keep, and nothing failed when it stopped being true.
  const manifest = JSON.parse(read('manifest.json'));
  const privacy = read('PRIVACY.md');

  const readme = read('README.md');
  for (const permission of manifest.permissions) {
    assert.match(
      privacy, new RegExp('`' + permission + '`'),
      `PRIVACY.md must account for the ${permission} permission`,
    );
    // The README's permission list is what most users actually read, and it had
    // gone stale in exactly the same way: `storage` was declared and undescribed.
    assert.match(
      readme, new RegExp('`' + permission + '`'),
      `README.md must account for the ${permission} permission`,
    );
  }

  // The retracted sentence must not come back while the permission is declared.
  if (manifest.permissions.includes('storage')) {
    assert.doesNotMatch(
      privacy, /deliberately stores no state of its own/,
      'the no-state promise cannot stand alongside the storage permission',
    );
    // And the two properties the index rests on are stated, not implied.
    assert.match(privacy, /chrome\.storage\.local/);
    assert.match(privacy, /No conversation content is stored/);
    assert.match(privacy, /does not use `chrome\.storage\.sync`/);
  }
});

test('a release cannot add a version without touching the feature checklist', () => {
  // The checklist is only useful if it is current, and a document nobody is
  // forced to update drifts within one release. This couples the two: the number
  // of dated CHANGELOG versions is recorded here, so adding a release without
  // revisiting FEATURES.md fails the build.
  //
  // Deliberately a count rather than content matching. Anything cleverer would be
  // guessing which paragraph belongs to which release, and a wrong guess makes
  // the gate either unfailable or permanently red.
  const changelog = read('CHANGELOG.md');
  const features = read('FEATURES.md');
  const releases = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\] — \d{4}-\d{2}-\d{2}$/gm)];

  const declared = (features.match(/^Published history:.*$/m) || [])[0]
    || (features.match(/^Published so far:.*$/m) || [])[0]
    || '';
  const listedVersions = [...declared.matchAll(/\d+\.\d+\.\d+/g)].map((m) => m[0]);

  assert.ok(
    listedVersions.length > 0,
    'FEATURES.md must record the published version history under "Published history:"',
  );
  assert.equal(
    listedVersions.length, releases.length,
    `FEATURES.md lists ${listedVersions.length} released versions and CHANGELOG.md has ${releases.length}; `
    + 'update FEATURES.md in the same change as the release',
  );
  // The version being shipped must be the newest one named there.
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(
    listedVersions[listedVersions.length - 1], manifest.version,
    'the version being shipped must be the last entry of FEATURES.md\'s published history',
  );
});

test('the feature checklist covers every option the popup offers', () => {
  // A checkbox with no checklist paragraph is a feature nobody re-tests before a
  // release. The mapping is explicit rather than inferred from label text, so
  // renaming a label cannot quietly drop an item from the checklist.
  const popupHtml = read('popup.html');
  const features = read('FEATURES.md');
  const options = [
    ['chk-images', /All attachment types|Files are opt-in/],
    ['chk-timestamp', /Optional timestamp/],
    ['chk-batch', /Whole-Project export/],
  ];

  for (const [id, expected] of options) {
    assert.match(popupHtml, new RegExp('id="' + id + '"'), `popup.html must still offer ${id}`);
    assert.match(features, expected, `FEATURES.md must describe the ${id} option`);
  }

  // Every section the checklist promises, so a wholesale rewrite cannot drop one.
  for (const heading of ['## Capture', '## Files and artifacts', '## Batch export',
    '## Privacy and permissions', '## Release mechanics']) {
    assert.ok(features.indexOf(heading) !== -1, `FEATURES.md must keep the "${heading}" section`);
  }
});

test('the repository rules and the checklist ship with the extension', () => {
  // Both are part of the public surface: CLAUDE.md records why the rules exist,
  // and a rule whose reason is lost gets removed by the next person who finds it
  // inconvenient.
  assert.ok(fs.existsSync(path.join(root, 'CLAUDE.md')), 'CLAUDE.md must exist');
  assert.ok(fs.existsSync(path.join(root, 'FEATURES.md')), 'FEATURES.md must exist');
  const rules = read('CLAUDE.md');
  // The version rule is the one the operator asked for by name; it must not be
  // softened into a suggestion.
  assert.match(rules, /one bump per release/i);
  assert.match(rules, /1\.1\.8/, 'the rule must cite the published version it protects');
});
