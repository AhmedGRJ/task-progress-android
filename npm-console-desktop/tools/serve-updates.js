// Serves a folder over HTTP so installed copies can fetch updates from it.
// Usage: node tools/serve-updates.js <folder> [port]
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const dir = path.resolve(process.argv[2] || 'dist');
const port = parseInt(process.argv[3], 10) || 8099;
const types = { '.yml': 'text/yaml', '.json': 'application/json', '.exe': 'application/octet-stream', '.blockmap': 'application/octet-stream', '.sig': 'text/plain' };

http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
  const file = path.join(dir, rel);
  if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Content-Length': fs.statSync(file).size });
  fs.createReadStream(file).pipe(res);
}).listen(port, '0.0.0.0', () => {
  console.log('Serving ' + dir + ' on port ' + port);
  Object.values(os.networkInterfaces()).forEach((l) => (l || []).forEach((n) => { if (n.family === 'IPv4' && !n.internal) console.log('  http://' + n.address + ':' + port + '/'); }));
  console.log('  http://localhost:' + port + '/');
});
