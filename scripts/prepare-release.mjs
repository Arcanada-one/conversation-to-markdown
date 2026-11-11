#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const tag = process.argv[2];
if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag || '')) {
  throw new Error('release tag must be vMAJOR.MINOR.PATCH');
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD');
if (git('rev-parse', `refs/tags/${tag}^{commit}`) !== commit) {
  throw new Error(`${tag} does not point to the checked-out commit`);
}
try {
  git('merge-base', '--is-ancestor', commit, 'refs/remotes/origin/main');
} catch {
  throw new Error(`${tag} must point to a commit on main`);
}

const version = tag.slice(1);
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (manifest.version !== version || pkg.version !== version) {
  throw new Error(`${tag} must match manifest.json and package.json`);
}

const changelog = readFileSync('CHANGELOG.md', 'utf8');
const headings = [...changelog.matchAll(/^## \[([^\]]+)\][^\n]*$/gm)];
if (headings[0]?.[1] !== version) {
  throw new Error(`${tag} must be the top CHANGELOG.md entry`);
}
const notes = changelog.slice(headings[0].index, headings[1]?.index).trim();
if (!notes.includes('\n### ')) throw new Error(`${tag} needs release notes in CHANGELOG.md`);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/release-notes.md', `${notes}\n`);
console.log(`Prepared release notes for ${tag} at ${commit}`);
