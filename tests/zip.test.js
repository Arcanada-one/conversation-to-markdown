'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildStoreZip, crc32 } = require('../zip.js');

test('crc32 matches a known vector', () => {
  const bytes = new TextEncoder().encode('abc');
  assert.equal(crc32(bytes), 0x352441c2);
});

test('buildStoreZip writes the local-file magic bytes', () => {
  const zipBytes = buildStoreZip([
    { name: 'alpha/readme.md', data: new TextEncoder().encode('# Alpha') },
  ]);
  assert.equal(zipBytes[0], 0x50);
  assert.equal(zipBytes[1], 0x4b);
  assert.equal(zipBytes[2], 0x03);
  assert.equal(zipBytes[3], 0x04);
});

test('buildStoreZip embeds every entry name and payload without compression', () => {
  const entries = [
    { name: 'alpha/readme.md', data: new TextEncoder().encode('# Alpha') },
    { name: 'beta/notes.txt', data: new TextEncoder().encode('plain text') },
  ];
  const zipBytes = buildStoreZip(entries);
  const raw = Buffer.from(zipBytes).toString('binary');
  assert.match(raw, /readme\.md/);
  assert.match(raw, /# Alpha/);
  assert.match(raw, /notes\.txt/);
  assert.match(raw, /plain text/);
});

test('buildStoreZip round-trips a nested project path', () => {
  const payload = new TextEncoder().encode('batch payload');
  const zipBytes = buildStoreZip([{ name: 'project/conv/file.md', data: payload }]);
  const raw = Buffer.from(zipBytes).toString('binary');
  assert.match(raw, /project\/conv\/file\.md/);
  assert.match(raw, /batch payload/);
});
