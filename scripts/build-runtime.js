#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const entries = {
  'content.js': [
    'src/content/markdown.js',
    'src/content/artifacts.js',
    'src/content/turns.js',
    'src/content/scroll.js',
    'src/content/scan.js',
    'src/content/button-discovery.js',
    'src/content/button-fetch.js',
    'src/content/sidebar-rows.js',
    'src/content/sidebar-walk.js',
    'src/content/export.js',
  ],
  'popup.js': [
    'src/popup/options.js',
    'src/popup/paths.js',
    'src/popup/quota.js',
    'src/popup/storage.js',
    'src/popup/downloads.js',
    'src/popup/logging.js',
    'src/popup/batch.js',
    'src/popup/controls.js',
  ],
};

const check = process.argv.includes('--check');
for (const [output, sources] of Object.entries(entries)) {
  const bundled = sources.map((source) => fs.readFileSync(path.join(root, source), 'utf8')).join('\n');
  const target = path.join(root, output);
  if (check) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== bundled) {
      console.error(`${output} is stale; run npm run build`);
      process.exitCode = 1;
    }
  } else {
    fs.writeFileSync(target, bundled);
  }
}
