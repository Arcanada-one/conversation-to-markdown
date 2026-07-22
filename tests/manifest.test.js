const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const manifest = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'manifest.json'), 'utf8'),
);

function readPngDimensions(filePath) {
  const bytes = fs.readFileSync(filePath);
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  assert.ok(bytes.subarray(0, 8).equals(pngSignature), `${filePath} must be a PNG`);
  assert.equal(bytes.subarray(12, 16).toString('ascii'), 'IHDR');

  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

test('manifest declares version 1.1.2 and a complete icon set', () => {
  const expectedIcons = {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  };

  assert.equal(manifest.version, '1.1.2');
  assert.deepEqual(manifest.icons, expectedIcons);
  assert.deepEqual(manifest.action.default_icon, expectedIcons);

  for (const [declaredSize, relativePath] of Object.entries(expectedIcons)) {
    const iconPath = path.join(projectRoot, relativePath);
    assert.ok(fs.existsSync(iconPath), `${relativePath} must exist`);
    assert.deepEqual(readPngDimensions(iconPath), {
      width: Number(declaredSize),
      height: Number(declaredSize),
    });
  }
});
