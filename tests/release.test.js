const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const prepare = path.resolve(__dirname, '../scripts/prepare-release.mjs');

test('release workflow only publishes from verified version tags with pinned actions', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../.github/workflows/release.yml'), 'utf8');
  assert.match(workflow, /push:\s*\n\s+tags: \["v\*"\]/);
  assert.doesNotMatch(workflow, /pull_request_target|workflow_dispatch/);
  assert.match(workflow, /prepare-release\.mjs/);
  assert.match(workflow, /--verify-tag/);
  assert.match(workflow, /--latest/);
  for (const [, action] of workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gm)) {
    assert.match(action, /@[a-f0-9]{40}$/);
  }
});

test('release preparation accepts an annotated main tag and rejects unsafe tags', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'c2m-release-'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  const run = (tag) => spawnSync(process.execPath, [prepare, tag], { cwd: repo, encoding: 'utf8' });

  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.invalid');
    fs.writeFileSync(path.join(repo, 'manifest.json'), '{"version":"1.7.0"}\n');
    fs.writeFileSync(path.join(repo, 'package.json'), '{"version":"1.7.0"}\n');
    fs.writeFileSync(path.join(repo, 'CHANGELOG.md'),
      '## [1.7.0] — 2026-10-11\n\n### Added\n\n- Archive.\n\n' +
      'Store status: not submitted on 2026-10-11.\n\n## [1.6.9] — 2026-10-09\n\nOld notes.\n');
    git('add', '.');
    git('commit', '-qm', 'Release source');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    git('tag', '-a', 'v1.7.0', '-m', 'Release v1.7.0');

    const valid = run('v1.7.0');
    assert.equal(valid.status, 0, valid.stderr);
    const notes = fs.readFileSync(path.join(repo, 'dist/release-notes.md'), 'utf8');
    assert.match(notes, /Store status: not submitted on 2026-10-11/);
    assert.doesNotMatch(notes, /Old notes/);

    git('tag', 'v1.8.0');
    assert.match(run('v1.8.0').stderr, /must match manifest.json and package.json/);
    assert.match(run('v1.7.0-rc.1').stderr, /release tag must be/);

    git('checkout', '-qb', 'feature');
    fs.writeFileSync(path.join(repo, 'feature.txt'), 'branch-only\n');
    git('add', 'feature.txt');
    git('commit', '-qm', 'Branch change');
    assert.match(run('v1.7.0').stderr, /does not point to the checked-out commit/);
    git('tag', 'v1.7.1');
    assert.match(run('v1.7.1').stderr, /must point to a commit on main/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
