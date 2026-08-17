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

test('buildStoreZip refuses more entries than the format can count', () => {
  // The end-of-central-directory record holds the entry count in a uint16, so
  // past 65535 `setUint16` wraps and the archive is corrupt while reporting
  // success. A backup tool must fail loudly instead.
  const tiny = new TextEncoder().encode('x');
  const tooMany = Array.from({ length: 0x10000 }, (_, i) => ({ name: 'f' + i + '.md', data: tiny }));

  assert.throws(() => buildStoreZip(tooMany), /too many files/i);

  // Positive control: the boundary itself must still work, or the guard is just
  // "throws on anything big".
  const atLimit = Array.from({ length: 3 }, (_, i) => ({ name: 'f' + i + '.md', data: tiny }));
  const bytes = buildStoreZip(atLimit);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x04034b50);
});

test('buildStoreZip declares UTF-8 names so a Cyrillic title survives extraction', () => {
  // Names were already written as UTF-8 bytes, but general-purpose bit 11 — the
  // flag that TELLS the extractor so — was never set, so every extractor fell
  // back to code page 437 and a Russian conversation title unzipped as mojibake.
  // This is the primary workload, not an edge case: slugifyTitle exists partly to
  // keep Cyrillic titles readable.
  const zipBytes = buildStoreZip([{ name: 'Договор/файл.md', data: 'тест' }]);
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);

  const UTF8_FLAG = 0x0800;
  assert.equal(view.getUint16(6, true) & UTF8_FLAG, UTF8_FLAG, 'local header must set bit 11');

  // The central directory carries its own copy of the flag; an extractor reading
  // only that one must see it too.
  const raw = Buffer.from(zipBytes);
  const centralSig = raw.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(centralSig > 0, 'central directory header must exist');
  assert.equal(
    raw.readUInt16LE(centralSig + 8) & UTF8_FLAG,
    UTF8_FLAG,
    'central directory header must set bit 11'
  );

  // And the name itself must still be real UTF-8 bytes.
  assert.ok(raw.includes(Buffer.from('Договор/файл.md', 'utf8')), 'name must be UTF-8 encoded');
});
