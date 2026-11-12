#!/usr/bin/env node
/* sync-relay.js: the sync server. No dependencies, one file.
 *
 *   node sync-relay.js --port 8083 --data ./relay-data
 *
 * Used in two ways:
 *   - standalone, on any always-on machine you own (home PC, NAS, VPS): your own relay server
 *   - embedded in the Windows desktop app: "hub" mode (phone syncs with the PC over Wi-Fi / VPN)
 *
 * Every client sends the same token. The token also selects the data file, so the server stores one
 * independent data set per token. If the apps use a sync passphrase, the server only ever sees ciphertext.
 */
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_BODY = 25 * 1024 * 1024;
const TOMB_TTL = 90 * 24 * 3600 * 1000;
const wins = (r, l) => !l || r.t > l.t || (r.t === l.t && String(r.by) > String(l.by));

function createRelay(opts) {
  opts = opts || {};
  const dataDir = path.resolve(opts.dataDir || './relay-data');
  const log = opts.log || (() => {});
  fs.mkdirSync(dataDir, { recursive: true });
  const rooms = new Map(), timers = new Map(), fails = new Map();

  const roomId = (token) => crypto.createHash('sha256').update('task-progress-relay/' + token).digest('hex').slice(0, 24);
  const file = (id) => path.join(dataDir, id + '.json');

  function room(token) {
    const id = roomId(token);
    if (rooms.has(id)) return rooms.get(id);
    let r = null;
    try { r = JSON.parse(fs.readFileSync(file(id), 'utf8')); } catch (e) { /* new room */ }
    if (!r || !r.items) r = { epoch: crypto.randomBytes(6).toString('hex'), seq: 0, items: {} };
    r.id = id;
    rooms.set(id, r);
    return r;
  }
  function save(r) {
    clearTimeout(timers.get(r.id));
    timers.set(r.id, setTimeout(() => flush(r), 300));
  }
  function flush(r) {
    const now = Date.now();
    Object.keys(r.items).forEach((k) => { if (r.items[k].d && now - r.items[k].t > TOMB_TTL) delete r.items[k]; });
    const tmp = file(r.id) + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify({ epoch: r.epoch, seq: r.seq, items: r.items })); fs.renameSync(tmp, file(r.id)); } catch (e) { log('save failed: ' + e.message); }
  }

  function send(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, {
      'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
    });
    res.end(body);
  }
  const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

  function handler(req, res) {
    const url = (req.url || '').split('?')[0];
    if (req.method === 'OPTIONS') return send(res, 204, {});
    if (req.method === 'GET' && (url === '/v1/health' || url === '/')) return send(res, 200, { ok: true, name: 'task-progress-relay' });
    if (req.method !== 'POST' || url !== '/v1/sync') return send(res, 404, { error: 'not found' });

    const ip = req.socket.remoteAddress || '?', f = fails.get(ip) || { n: 0, t: Date.now() };
    if (Date.now() - f.t > 10 * 60 * 1000) { f.n = 0; f.t = Date.now(); }
    if (f.n >= 20) return send(res, 429, { error: 'too many failed attempts' });

    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    const token = m ? m[1] : '';
    if (token.length < 8) { f.n++; fails.set(ip, f); return send(res, 401, { error: 'bad token' }); }
    if (opts.token && !same(token, opts.token)) { f.n++; fails.set(ip, f); return send(res, 401, { error: 'bad token' }); }

    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { send(res, 413, { error: 'too large' }); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return send(res, 400, { error: 'bad json' }); }
      const r = room(token);
      if (body.countOnly) return send(res, 200, { count: Object.keys(r.items).filter((k) => !r.items[k].d).length, epoch: r.epoch, seq: r.seq });
      if (body.epoch && body.epoch !== r.epoch) return send(res, 200, { epoch: r.epoch, seq: 0, items: [] }); // client will resend everything
      const mine = new Set();
      (Array.isArray(body.items) ? body.items : []).forEach((it) => {
        if (!it || typeof it.k !== 'string' || it.k.length > 300 || typeof it.t !== 'number') return;
        if (!wins(it, r.items[it.k])) return;
        const rec = { t: it.t, by: String(it.by || '').slice(0, 40), seq: ++r.seq };
        if (it.d) rec.d = 1; else if (it.e !== undefined) rec.e = it.e; else rec.v = it.v;
        r.items[it.k] = rec; mine.add(it.k);
      });
      if (mine.size) save(r);
      const since = Number(body.since) || 0, items = [];
      Object.keys(r.items).forEach((k) => {
        const x = r.items[k];
        if (x.seq > since && !mine.has(k)) { const w = { k, t: x.t, by: x.by }; if (x.d) w.d = 1; else if (x.e !== undefined) w.e = x.e; else w.v = x.v; items.push(w); }
      });
      send(res, 200, { epoch: r.epoch, seq: r.seq, items });
    });
    req.on('error', () => {});
  }

  return {
    handler,
    listen(port, host, tls) {
      return new Promise((resolve, reject) => {
        const srv = tls ? https.createServer(tls, handler) : http.createServer(handler);
        srv.keepAliveTimeout = 65000; srv.headersTimeout = 66000; // outlive the client's idle sockets (avoids reset-on-reuse)
        srv.on('error', reject);
        srv.listen(port, host || '0.0.0.0', () => resolve(srv));
      });
    },
    flushAll() { rooms.forEach((r) => flush(r)); }
  };
}

module.exports = { createRelay };

if (require.main === module) {
  const args = process.argv.slice(2), arg = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : (process.env[n.toUpperCase()] || d); };
  const port = Number(arg('port', 8083)), host = arg('host', '0.0.0.0'), dataDir = arg('data', './relay-data');
  const cert = arg('cert', ''), key = arg('key', '');
  const relay = createRelay({ dataDir, token: arg('token', ''), log: (m) => console.log(new Date().toISOString(), m) });
  const tls = cert && key ? { cert: fs.readFileSync(cert), key: fs.readFileSync(key) } : null;
  relay.listen(port, host, tls).then(() => {
    console.log('Task Progress relay on ' + (tls ? 'https' : 'http') + '://' + host + ':' + port + '  (data: ' + path.resolve(dataDir) + ')');
    if (!tls) console.log('Plain http: use it on a trusted network or a VPN, or put it behind an https reverse proxy. Turn on the sync passphrase in the app to keep the data encrypted either way.');
  }).catch((e) => { console.error('Cannot start: ' + e.message); process.exit(1); });
  const bye = () => { relay.flushAll(); process.exit(0); };
  process.on('SIGINT', bye); process.on('SIGTERM', bye);
}
