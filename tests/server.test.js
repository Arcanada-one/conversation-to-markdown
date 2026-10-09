'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const site = require('../site.js');
const serverApi = require('../server.js');

function request(port, method, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: urlPath,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (method === 'POST') req.write('not-allowed');
    req.end();
  });
}

async function bootAndRead(rootDir) {
  const server = await serverApi.startStaticServer(rootDir, { host: '127.0.0.1', port: 0 });
  try {
    const address = server.address();
    assert.equal(address.address, '127.0.0.1');
    const indexPath = path.join(rootDir, 'index.html');
    const chatPath = path.join(rootDir, 'Budget', 'Spec', 'index.html');
    const filePath = path.join(rootDir, 'Budget', 'Spec', 'chart.png');
    const index = await request(address.port, 'GET', '/');
    const chat = await request(address.port, 'GET', '/Budget/Spec/index.html');
    const file = await request(address.port, 'GET', '/Budget/Spec/chart.png');
    const posted = await request(address.port, 'POST', '/Budget/Spec/upload.txt');
    assert.equal(index.status, 200);
    assert.equal(chat.status, 200);
    assert.equal(file.status, 200);
    assert.deepEqual(index.body, fs.readFileSync(indexPath));
    assert.deepEqual(chat.body, fs.readFileSync(chatPath));
    assert.deepEqual(file.body, fs.readFileSync(filePath));
    assert.match(chat.body.toString('utf8'), /Spec line/);
    assert.equal(posted.status, 405);
    assert.equal(fs.existsSync(path.join(rootDir, 'Budget', 'Spec', 'upload.txt')), false);
    return {
      index: index.body.toString('utf8'),
      chat: chat.body.toString('utf8'),
      file: file.body,
    };
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

test('read-only server returns the same bytes on two boots', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'c2m-server-'));
  try {
    const fileBytes = Buffer.from([1, 2, 3, 9, 0, 255]);
    const laid = site.layoutStaticSite([{
      title: 'Spec',
      slug: 'Spec',
      projectTitle: 'Budget',
      markdown: 'Spec line',
      saved: [{ name: 'chart.png', bytes: fileBytes }],
    }]);
    site.writeStaticSite(rootDir, laid);
    const first = await bootAndRead(rootDir);
    const second = await bootAndRead(rootDir);
    assert.equal(first.index, second.index);
    assert.equal(first.chat, second.chat);
    assert.deepEqual(first.file, second.file);
    assert.deepEqual(first.file, fileBytes);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
