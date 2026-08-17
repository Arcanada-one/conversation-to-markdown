/**
 * Minimal ZIP writer using STORE (no compression) only.
 * Zero dependencies — suitable for bundling every exported conversation folder
 * into one archive after a batch run.
 */

/** General-purpose bit 11: the filename and comment are UTF-8 encoded. */
const UTF8_NAME_FLAG = 0x0800;

const CRC32_TABLE = (function buildCrc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const d = date || new Date();
  const year = Math.max(1980, d.getFullYear());
  const dosDate = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  return { dosDate, dosTime };
}

function encodeUtf8(value) {
  return new TextEncoder().encode(value);
}

function concatChunks(chunks) {
  const total = chunks.reduce(function(sum, chunk) { return sum + chunk.length; }, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Build a ZIP archive from {name, data} entries. Names use forward slashes.
 * @param {Array<{name: string, data: Uint8Array}>} entries
 * @returns {Uint8Array}
 */
/** The end-of-central-directory record stores the entry count in a uint16, and
 *  offsets/sizes in uint32. Past those limits a correct archive needs ZIP64,
 *  which this writer does not implement — `setUint16` would silently wrap and
 *  produce a corrupt archive that reports no error. Refusing loudly is the only
 *  honest option for a backup tool. */
const MAX_ZIP_ENTRIES = 0xffff;
const MAX_ZIP_BYTES = 0xffffffff;

function buildStoreZip(entries, options) {
  const supplied = options || {};
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new Error(
      'too many files for one archive (' + entries.length + ' > ' + MAX_ZIP_ENTRIES +
      '); export without the zip option, or split the project'
    );
  }
  const stamp = dosDateTime(supplied.now ? supplied.now() : new Date());
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encodeUtf8(entry.name);
    const data = entry.data instanceof Uint8Array ? entry.data : encodeUtf8(String(entry.data));
    const checksum = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    // General-purpose bit 11 (0x0800) declares the filename is UTF-8. The bytes
    // always were, but without the flag every extractor falls back to code page
    // 437 and a Cyrillic conversation title unzips as mojibake.
    localView.setUint16(6, UTF8_NAME_FLAG, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, stamp.dosTime, true);
    localView.setUint16(12, stamp.dosDate, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    localParts.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    // The central directory carries its own copy of the flags; an extractor that
    // reads only this header must see the UTF-8 declaration too.
    centralView.setUint16(8, UTF8_NAME_FLAG, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, stamp.dosTime, true);
    centralView.setUint16(14, stamp.dosDate, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length;
    if (offset > MAX_ZIP_BYTES) {
      throw new Error(
        'archive too large for one zip (over 4 GB); export without the zip option, ' +
        'or split the project'
      );
    }
  }

  const centralDirectory = concatChunks(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralDirectory.length, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  return concatChunks(localParts.concat([centralDirectory, end]));
}

function bytesToDataUrl(bytes, mimeType) {
  const mime = mimeType || 'application/zip';
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return 'data:' + mime + ';base64,' + btoa(binary);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildStoreZip: buildStoreZip,
    bytesToDataUrl: bytesToDataUrl,
    crc32: crc32,
  };
}
