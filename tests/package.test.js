const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;

function commandPath(name) {
  return execFileSync('sh', ['-c', `command -v ${name}`], {
    encoding: 'utf8',
  }).trim();
}

test('the submission package builds when Info-ZIP is unavailable', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'c2m-package-bin-'));
  const archive = path.join(root, 'dist', `conversation-to-markdown-v${version}.zip`);
  const checksum = `${archive}.sha256`;
  const commands = [
    'bash', 'basename', 'cat', 'dirname', 'git', 'head', 'mkdir', 'mktemp', 'node',
    'rm', 'sed', 'shasum', 'tar', '7z',
  ];

  try {
    for (const command of commands) {
      fs.symlinkSync(commandPath(command), path.join(bin, command));
    }

    const output = execFileSync(path.join(root, 'package-extension.sh'), ['HEAD'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PATH: bin },
    });

    assert.ok(
      output.includes(`conversation-to-markdown-v${version}.zip`),
      'the build output must name the versioned archive',
    );
    assert.ok(fs.existsSync(archive), 'the submission archive must exist');
    assert.ok(fs.existsSync(checksum), 'the archive checksum must exist');

    const entries = execFileSync(commandPath('unzip'), ['-Z1', archive], {
      encoding: 'utf8',
    }).trim().split('\n');
    assert.deepEqual(entries.sort(), [
      'content.js',
      'icons/',
      'icons/icon128.png',
      'icons/icon16.png',
      'icons/icon32.png',
      'icons/icon48.png',
      'manifest.json',
      'popup.html',
      'popup.js',
      'zip.js',
    ].sort());
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
    fs.rmSync(archive, { force: true });
    fs.rmSync(checksum, { force: true });
  }
});
