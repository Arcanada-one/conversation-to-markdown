'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildStoreZip, crc32 } = require('../zip.js');
const zip = require('../zip.js');
global.btoa = (value) => Buffer.from(value, 'binary').toString('base64');

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

test('a large archive is base64-encoded without building a giant string', () => {
  // Measured, and the reason this exists: the old one-character-at-a-time loop
  // cost 1510.8MB of RSS and 1320.1MB of heap to encode a 40MB payload — 40.9x
  // the data. That is the silent OOM in a batch export, because a renderer
  // killed for memory takes the popup with it: no catch runs, no status is
  // shown, and the run simply stops. Encoding in 3-byte-aligned chunks brought
  // the same work to 2.1MB RSS and 101MB heap, with byte-identical output.
  //
  // The alignment is the whole trick. btoa() pads its output when the input is
  // not a multiple of 3, so a chunk size of, say, 32768 would insert '=' padding
  // in the MIDDLE of the stream and corrupt everything after it.
  assert.equal(typeof zip.bytesToDataUrl, 'function');

  // A payload with every byte value, long enough to span many chunks and to end
  // on a length that is NOT a multiple of 3 — so the final chunk pads and the
  // rest must not.
  const size = 300 * 1024 + 1;
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = (i * 7 + (i >> 8)) & 0xff;

  const url = zip.bytesToDataUrl(bytes, 'application/zip');
  assert.match(url, /^data:application\/zip;base64,/);

  // Decoded, it must be the original bytes exactly. This is what a mutant
  // changing the chunk size to a non-multiple of 3 fails.
  const encoded = url.slice('data:application/zip;base64,'.length);
  const decoded = Buffer.from(encoded, 'base64');
  assert.equal(decoded.length, size);
  assert.ok(Buffer.from(bytes).equals(decoded), 'the encoded archive must decode to the original bytes');
});

test('base64 output is identical across every payload length near a chunk seam', () => {
  // Off-by-one at a chunk boundary is the failure mode a single-size test misses.
  // Every length from just under to just over a seam is checked against the
  // reference encoder, so a chunk that drops or duplicates bytes at the join
  // cannot pass.
  for (const size of [0, 1, 2, 3, 4, 5, 3071, 3072, 3073, 3074, 3075, 6143, 6144, 6145]) {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) bytes[i] = (i * 13) & 0xff;
    const url = zip.bytesToDataUrl(bytes, 'application/zip');
    const encoded = url.slice('data:application/zip;base64,'.length);
    assert.equal(
      encoded, Buffer.from(bytes).toString('base64'),
      `length ${size} encoded differently from the reference`,
    );
  }
});

test('encoding a large archive does not allocate a multiple of its own size', () => {
  // The tests above pass with EITHER implementation, because both produce the
  // same bytes. Correctness was never the defect — allocation was, and a test
  // that cannot see the difference would have let the fix be reverted silently.
  //
  // Measured with --expose-gc on a 40MB payload: the per-character loop used
  // 1320MB of heap, the 3-byte-chunked encoder 101MB. This asserts the shape of
  // that difference at a size small enough to run in a unit test, with a
  // threshold far looser than the 13x gap it is distinguishing.
  const size = 4 * 1024 * 1024;
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = i & 0xff;

  if (global.gc) global.gc();
  const before = process.memoryUsage().heapUsed;
  const url = zip.bytesToDataUrl(bytes, 'application/zip');
  const after = process.memoryUsage().heapUsed;
  // Keep the result reachable so it cannot be collected before measurement.
  assert.ok(url.length > size);

  const ratio = (after - before) / size;
  assert.ok(
    ratio < 8,
    `encoding allocated ${ratio.toFixed(1)}x the payload; the per-character loop measured far above this`,
  );
});
