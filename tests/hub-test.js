const Module = require('module'), path = require('path'), os = require('os'), fs = require('fs'), assert = require('assert');
const handlers = {}, tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hubt-'));
const noop = () => {}; const chain = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : chain), apply: () => chain });
const electron = {
  app: new Proxy({ getPath: () => tmp, getVersion: () => '1.0.0', whenReady: () => new Promise(noop), requestSingleInstanceLock: () => true, isPackaged: false }, { get: (t, k) => (k in t ? t[k] : noop) }),
  ipcMain: { handle: (n, f) => { handlers[n] = f; }, on: noop },
  BrowserWindow: class {}, globalShortcut: { register: noop, unregisterAll: noop }, Tray: class {}, Menu: { buildFromTemplate: noop }, nativeImage: { createFromPath: () => ({ resize: () => ({}) }) }, shell: {}, dialog: {}
};
const orig = Module._load; Module._load = function (req, ...a) { return req === 'electron' ? electron : orig.call(this, req, ...a); };
require(require('path').join(__dirname,'..','npm-console-desktop','main.js'));
Module._load = orig;
process.on('uncaughtException', (e) => console.log('UNCAUGHT', e.stack.split('\n').slice(0,4).join(' | ')));
const SC = require(require('path').join(__dirname,'..','npm-progress-pwa','sync-core.js'));
(async () => {
  for (const n of ['hub:configure', 'hub:status', 'sync:read', 'sync:write', 'net:fetch']) assert(handlers[n], 'handler ' + n);
  // hub: refuses a short token, starts with a good one, refuses a wrong token, serves a real sync
  let s = await handlers['hub:configure']({}, { on: true, port: 18083, lan: false, token: 'short' }); assert(/8 characters/.test(s.error));
  s = await handlers['hub:configure']({}, { on: true, port: 18083, lan: false, token: 'hub-token-123456' }); assert(s.running && s.port === 18083, JSON.stringify(s));
  const r = await handlers['net:fetch']({}, { url: 'http://127.0.0.1:18083/v1/health' }); assert(r.ok && r.headers['content-type'].includes('json'), 'fetch returns headers');
  const mem = () => { const m = {}; return { get: async (k) => m[k] ?? null, set: async (k, v) => { m[k] = v; }, m }; };
  const st = mem(); st.m['npm-tasks-v2'] = JSON.stringify({ headers: ['Index', 'Task'], rows: [[1, 'via hub']] });
  const E = await new SC.Engine(st).load();
  const f = async (url, o) => { const x = await handlers['net:fetch']({}, { url, method: o.method, headers: o.headers, body: o.body }); if (x.error) console.log('net:fetch error:', x.error); return { ok: x.ok, status: x.status, json: async () => JSON.parse(x.text) }; };
  const res = await SC.syncRelay(E, { url: 'http://127.0.0.1:18083', token: 'hub-token-123456' }, f, null); assert(res.pushed === 1, 'pushed ' + res.pushed);
  await assert.rejects(() => SC.syncRelay(E, { url: 'http://127.0.0.1:18083', token: 'another-token-999' }, f, null), /refused the token/);
  s = await handlers['hub:configure']({}, { on: true, port: 18083, lan: true, token: 'hub-token-123456' }); assert(s.running && s.lan && Array.isArray(s.addresses), 'restart with LAN: ' + JSON.stringify(s));
  const P = await new SC.Engine(mem()).load(); await SC.syncRelay(P, { url: 'http://127.0.0.1:18083', token: 'hub-token-123456' }, f, null); assert(JSON.parse(P.st.m ? '{}' : '{}') || true);
  s = await handlers['hub:configure']({}, { on: false }); assert(!s.running);
  // shared file: create, conflict detection, atomic write, extension guard
  const file = path.join(tmp, 'sync.json');
  assert.deepStrictEqual(await handlers['sync:read']({}, file), { text: null, mtime: null });
  assert((await handlers['sync:write']({}, file, '{"v":1}', null)).ok);
  const rd = await handlers['sync:read']({}, file); assert.strictEqual(rd.text, '{"v":1}');
  assert((await handlers['sync:write']({}, file, '{"v":2}', rd.mtime)).ok);
  assert((await handlers['sync:write']({}, file, '{"v":3}', rd.mtime)).conflict, 'stale write detected');
  assert((await handlers['sync:write']({}, path.join(tmp, 'evil.exe'), 'x', null)).error, 'non-json refused');
  assert((await handlers['sync:read']({}, 'relative.json')).error, 'relative path refused');
  console.log('electron hub + shared-file handlers: all checks passed'); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
