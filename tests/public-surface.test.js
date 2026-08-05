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
  assert.equal(manifest.version, '1.1.8');
  assert.match(popup, /Conversation to Markdown/);
  assert.doesNotMatch(popup, /ChatGPT\s*→\s*Markdown/);
  assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'clipboardWrite', 'downloads', 'scripting']);
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
    /\bchrome\.storage\b/,
    /\b(?:gtag|ga|mixpanel|amplitude|analytics)\s*\(/,
  ];

  for (const pattern of forbidden) {
    assert.doesNotMatch(popupJs, pattern, `popup.js matches ${pattern}`);
    assert.doesNotMatch(contentJs, pattern, `content.js matches ${pattern}`);
  }

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
