#!/usr/bin/env bun

import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const check = process.argv.includes('--check');

for (const name of ['content', 'popup']) {
  const result = await Bun.build({
    entrypoints: [resolve(root, 'src', name, 'index.mjs')],
    target: 'browser',
    format: 'iife',
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exitCode = 1;
    continue;
  }

  const api = `__c2m${name === 'content' ? 'Content' : 'Popup'}Api`;
  const nodeExport =
    name === 'content'
      ? `module.exports = { ...globalThis.${api}, exportActiveSessionHtml: (doc, opts) => globalThis.${api}.exportActiveSessionHtml(doc, { ...opts, site: require('./site.js') }) };`
      : `module.exports = globalThis.${api};`;
  const bundle = `${await result.outputs[0].text()}\nif (typeof module !== 'undefined' && module.exports) ${nodeExport}\n`;
  const target = resolve(root, `${name}.js`);
  if (check) {
    if (!(await Bun.file(target).exists()) || (await Bun.file(target).text()) !== bundle) {
      console.error(`${name}.js is stale; run npm run build`);
      process.exitCode = 1;
    }
  } else {
    await Bun.write(target, bundle);
  }
}
