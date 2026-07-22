const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
  assert.equal(manifest.version, '1.1.2');
  assert.match(popup, /Conversation to Markdown/);
  assert.doesNotMatch(popup, /ChatGPT\s*→\s*Markdown/);
  assert.deepEqual([...manifest.permissions].sort(), ['clipboardWrite', 'scripting']);
});

test('README states independence and non-affiliation', () => {
  const readme = read('README.md');
  assert.match(readme, /Independent open-source project/);
  assert.match(readme, /not affiliated with, endorsed by, or sponsored by OpenAI/);
  assert.match(readme, /#### You said:/);
  assert.match(readme, /#### ChatGPT said:/);
  assert.doesNotMatch(readme, /^## (?:User|Assistant)$/m);
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

test('shipped JavaScript has no network, storage, or analytics calls', () => {
  const javascript = `${read('content.js')}\n${read('popup.js')}`;
  const forbidden = [
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /\bchrome\.storage\b/,
    /\b(?:gtag|ga|mixpanel|amplitude|analytics)\s*\(/,
  ];

  for (const pattern of forbidden) assert.doesNotMatch(javascript, pattern);
});

test('CI is read-only and pins every action by full commit SHA', () => {
  const workflow = read('.github/workflows/ci.yml');
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(workflow, /pull_request_target/);

  const uses = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]);
  assert.ok(uses.length > 0, 'workflow must use at least one action');
  for (const action of uses) assert.match(action, /@[a-f0-9]{40}$/);
});
