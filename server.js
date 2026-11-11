/**
 * Read-only static server for a saved HTML export.
 *
 * Bind it to 127.0.0.1. It answers GET and HEAD with the bytes on disk and
 * refuses every other method. It does not import the extension or a ChatGPT
 * session, and it never writes into the directory it serves.
 *
 *   node server.js <directory> [port]
 */
var http = require('http');
var fs = require('fs');
var path = require('path');

var CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function contentType(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function resolveInside(rootDir, urlPath) {
  var decoded;
  try {
    decoded = decodeURIComponent(String(urlPath || '/').split('?')[0]);
  } catch (_e) {
    return null;
  }
  if (decoded.indexOf('\0') !== -1) return null;
  var root = path.resolve(rootDir);
  var full = path.resolve(root, '.' + (decoded.charAt(0) === '/' ? decoded : '/' + decoded));
  if (full !== root && full.indexOf(root + path.sep) !== 0) return null;
  return full;
}

function createStaticServer(rootDir) {
  var root = path.resolve(rootDir);
  return http.createServer(function(req, res) {
    var method = req.method || 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(method === 'HEAD' ? undefined : 'Method not allowed');
      return;
    }
    var full = resolveInside(root, req.url || '/');
    if (!full) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(method === 'HEAD' ? undefined : 'Bad path');
      return;
    }
    var target = full;
    try {
      if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
    } catch (_e) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(method === 'HEAD' ? undefined : 'Unable to read');
      return;
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(method === 'HEAD' ? undefined : 'Not found');
      return;
    }
    var bytes = fs.readFileSync(target);
    res.writeHead(200, {
      'Content-Type': contentType(target),
      'Content-Length': bytes.length,
      'Cache-Control': 'no-store',
    });
    res.end(method === 'HEAD' ? undefined : bytes);
  });
}

function startStaticServer(rootDir, options) {
  var opts = options || {};
  var server = createStaticServer(rootDir);
  var host = opts.host || '127.0.0.1';
  var port = opts.port === undefined ? 0 : opts.port;
  return new Promise(function(resolve, reject) {
    server.once('error', reject);
    server.listen(port, host, function() { resolve(server); });
  });
}

if (require.main === module) {
  var dir = process.argv[2];
  if (!dir) {
    console.error('usage: node server.js <directory> [port]');
    process.exit(1);
  }
  startStaticServer(path.resolve(dir), { port: Number(process.argv[3] || 0) }).then(function(server) {
    var addr = server.address();
    console.log('http://' + addr.address + ':' + addr.port + '/');
  }).catch(function(err) {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = {
  createStaticServer: createStaticServer,
  startStaticServer: startStaticServer,
  resolveInside: resolveInside,
};
