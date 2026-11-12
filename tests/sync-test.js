const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const SC = require(require('path').join(__dirname,'..','npm-progress-pwa','sync-core.js'));
const { createRelay } = require(require('path').join(__dirname,'..','npm-progress-pwa','sync-relay.js'));

const mem = () => { const m = {}; return { get: async (k) => (k in m ? m[k] : null), set: async (k, v) => { m[k] = v; }, m }; };
const HEAD = ['Index', 'Topic', 'Task', 'Status', 'Progress %'];
const J = (s) => JSON.parse(s);
async function mkDevice(name, seed) {
  const st = mem(); if (seed) Object.entries(seed).forEach(([k, v]) => { st.m[k] = JSON.stringify(v); });
  const applied = [];
  const eng = await new SC.Engine(st, { onApplied: async (ids) => applied.push(ids) }).load();
  eng.name = name; eng.applied = applied; eng.st = st; return eng;
}
const rows = (e) => J(e.st.m['npm-tasks-v2']).rows;
const byIdx = (e) => Object.fromEntries(rows(e).map((r) => [r[0], r]));
let passed = 0; const ok = (name, fn) => fn().then(() => { passed++; console.log('  ok  ' + name); }, (e) => { console.log('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1; });

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-'));
  const relay = createRelay({ dataDir: dir });
  const srv = await relay.listen(0, '127.0.0.1');
  const cfg = { url: 'http://127.0.0.1:' + srv.address().port, token: 'tok-1234567890' };
  const f = (u, o) => fetch(u, o);

  const seed = {
    'npm-tasks-v2': { headers: HEAD, rows: [[1, 'VoLTE', 'Drive test', 'In Progress', 0.4], [2, '5G', 'KPI audit', 'Not Started', 0], [3, 'Tool', 'PowerBI', 'Suspended', 0.1]] },
    'planner-v1': { events: [{ id: 'e1', title: 'Customer call', start: 1, end: 2 }], meta: { '1': { dur: 90 } }, recurring: [], doneOcc: {}, past: [{ s: 1 }], autoBlocks: [{ x: 1 }], settings: { workStart: '09:00', feed: { token: 'SECRET-DEVICE' }, view: 'week' }, view: 'week' },
    'notes-journal': [{ id: 'n1', title: 'Kickoff', date: '2026-10-01T10:00:00Z' }],
    'subtasks': { '1': [{ t: 'collect logs', done: false }] }
  };
  const cipher = await SC.makeCipher('correct horse', 'g');

  console.log('Relay + encryption');
  const A = await mkDevice('A', seed), B = await mkDevice('B');
  await ok('A pushes everything, B (empty) receives it', async () => {
    const ra = await SC.syncRelay(A, cfg, f, cipher);
    assert(ra.pushed >= 6, 'pushed ' + ra.pushed);
    const rb = await SC.syncRelay(B, cfg, f, cipher);
    assert(rb.pulled >= 6, 'pulled ' + rb.pulled);
    assert.deepStrictEqual(byIdx(B)[1], [1, 'VoLTE', 'Drive test', 'In Progress', 0.4]);
    assert.strictEqual(J(B.st.m['planner-v1']).events[0].title, 'Customer call');
    assert.strictEqual(J(B.st.m['notes-journal'])[0].title, 'Kickoff');
    assert.deepStrictEqual(J(B.st.m['subtasks'])['1'][0].t, 'collect logs');
    assert(B.applied.length > 0, 'onApplied hook fired');
  });
  await ok("device-specific planner data (calendar link token, past blocks) never leaves a device", async () => {
    const pb = J(B.st.m['planner-v1']);
    assert(!pb.settings.feed || pb.settings.feed.token !== 'SECRET-DEVICE');
    assert.deepStrictEqual(pb.past, []);
  });
  await ok('relay data file holds only ciphertext', async () => {
    const txt = fs.readdirSync(dir).filter((x) => x.endsWith('.json')).map((x) => fs.readFileSync(path.join(dir, x), 'utf8')).join('');
    await new Promise((r) => setTimeout(r, 500));
    const txt2 = fs.readdirSync(dir).filter((x) => x.endsWith('.json')).map((x) => fs.readFileSync(path.join(dir, x), 'utf8')).join('');
    assert(txt2.length > 100); assert(!/Drive test|Customer call|Kickoff|KPI audit/.test(txt2), 'plaintext found on server');
  });
  await ok('wrong passphrase is rejected and changes nothing', async () => {
    const C = await mkDevice('C'); const bad = await SC.makeCipher('wrong', 'g');
    await assert.rejects(() => SC.syncRelay(C, cfg, f, bad), /Wrong sync passphrase/);
    assert(!C.st.m['npm-tasks-v2']);
    await assert.rejects(() => SC.syncRelay(C, cfg, f, null), /uses a sync passphrase/);
  });
  await ok('wrong token is refused', async () => {
    await assert.rejects(() => SC.syncRelay(B, { url: cfg.url, token: 'x' }, f, cipher), /refused the token/);
  });

  console.log('Offline edits on both devices');
  await ok('concurrent edits merge: different rows, new rows with the same Index, deletion, planner event', async () => {
    // A: edit row1 status, add task (Index 4), delete row 3
    let t = J(A.st.m['npm-tasks-v2']);
    t.rows[0][3] = 'Done'; t.rows[0][4] = 1; t.rows.push([4, 'A-topic', 'Added on PC', 'Not Started', 0]); t.rows = t.rows.filter((r) => r[0] !== 3);
    A.st.m['npm-tasks-v2'] = JSON.stringify(t);
    // B: edit row2 progress, add task (Index 4 as well!), add planner event, add note
    t = J(B.st.m['npm-tasks-v2']); t.rows[1][4] = 0.7; t.rows[1][3] = 'In Progress'; t.rows.push([4, 'B-topic', 'Added on phone', 'Not Started', 0]);
    B.st.m['npm-tasks-v2'] = JSON.stringify(t);
    const p = J(B.st.m['planner-v1']); p.events.push({ id: 'e2', title: 'Phone event', start: 5, end: 6 }); B.st.m['planner-v1'] = JSON.stringify(p);
    const n = J(B.st.m['notes-journal']); n.unshift({ id: 'n2', title: 'Phone note', date: '2026-10-02T10:00:00Z' }); B.st.m['notes-journal'] = JSON.stringify(n);

    await SC.syncRelay(A, cfg, f, cipher); await SC.syncRelay(B, cfg, f, cipher); await SC.syncRelay(A, cfg, f, cipher); await SC.syncRelay(B, cfg, f, cipher); await SC.syncRelay(A, cfg, f, cipher);
    for (const e of [A, B]) {
      const r = byIdx(e);
      assert.strictEqual(r[1][3], 'Done', e.name + ' row1 status');
      assert.strictEqual(r[2][4], 0.7, e.name + ' row2 progress');
      assert(!r[3], e.name + ' row3 deleted');
      const titles = rows(e).map((x) => x[2]).sort();
      assert.deepStrictEqual(titles, ['Added on PC', 'Added on phone', 'Drive test', 'KPI audit'], e.name + ' tasks ' + titles);
      const idxs = rows(e).map((x) => x[0]); assert.strictEqual(new Set(idxs).size, idxs.length, e.name + ' Index values unique: ' + idxs);
      assert.strictEqual(J(e.st.m['planner-v1']).events.length, 2, e.name + ' events');
      assert.strictEqual(J(e.st.m['notes-journal']).length, 2, e.name + ' notes');
    }
    assert.deepStrictEqual(rows(A).map((x) => x.join('|')).sort(), rows(B).map((x) => x.join('|')).sort(), 'devices identical');
  });
  await ok('settled devices do not keep sending changes (no ping-pong)', async () => {
    for (let i = 0; i < 2; i++) { await SC.syncRelay(A, cfg, f, cipher); await SC.syncRelay(B, cfg, f, cipher); }
    const ra = await SC.syncRelay(A, cfg, f, cipher), rb = await SC.syncRelay(B, cfg, f, cipher);
    assert.strictEqual(ra.pushed + ra.pulled + rb.pushed + rb.pulled, 0, JSON.stringify([ra, rb]));
  });
  await ok('same row edited on both: latest edit wins, even if that phone clock is an hour behind', async () => {
    const real = Date.now; const base = real();
    Date.now = () => base;            // PC edits "now"
    let t = J(A.st.m['npm-tasks-v2']); t.rows.find((r) => r[2] === 'KPI audit')[3] = 'Suspended'; A.st.m['npm-tasks-v2'] = JSON.stringify(t);
    await SC.syncRelay(A, cfg, f, cipher); await SC.syncRelay(B, cfg, f, cipher);
    Date.now = () => base - 3600e3;   // phone clock is 1h slow, edits afterwards
    t = J(B.st.m['npm-tasks-v2']); t.rows.find((r) => r[2] === 'KPI audit')[3] = 'Done'; B.st.m['npm-tasks-v2'] = JSON.stringify(t);
    await SC.syncRelay(B, cfg, f, cipher); await SC.syncRelay(A, cfg, f, cipher);
    Date.now = real;
    assert.strictEqual(rows(A).find((r) => r[2] === 'KPI audit')[3], 'Done'); assert.strictEqual(rows(B).find((r) => r[2] === 'KPI audit')[3], 'Done');
  });
  await ok('a column added on one device appears on the other; column order stays local', async () => {
    let t = J(A.st.m['npm-tasks-v2']); t.headers.push('Owner'); t.rows.forEach((r) => r.push('Ahmed')); A.st.m['npm-tasks-v2'] = JSON.stringify(t);
    t = J(B.st.m['npm-tasks-v2']); const swap = (a, i, j) => { [a[i], a[j]] = [a[j], a[i]]; }; swap(t.headers, 1, 2); t.rows.forEach((r) => swap(r, 1, 2)); B.st.m['npm-tasks-v2'] = JSON.stringify(t);
    await SC.syncRelay(A, cfg, f, cipher); await SC.syncRelay(B, cfg, f, cipher); await SC.syncRelay(A, cfg, f, cipher);
    const tb = J(B.st.m['npm-tasks-v2']); assert(tb.headers.includes('Owner')); assert.strictEqual(tb.headers[1], 'Task', 'B kept its own column order');
    assert.strictEqual(tb.rows[0][tb.headers.indexOf('Owner')], 'Ahmed');
    assert.strictEqual(J(A.st.m['npm-tasks-v2']).headers[1], 'Topic', 'A order untouched');
  });
  await ok('server data lost: devices detect the new epoch and re-upload everything', async () => {
    fs.readdirSync(dir).forEach((x) => fs.unlinkSync(path.join(dir, x)));
    const relay2 = createRelay({ dataDir: dir }); const srv2 = await relay2.listen(0, '127.0.0.1');
    const cfg2 = { url: cfg.url, token: cfg.token };
    srv.close(); await new Promise((r) => setTimeout(r, 50));
    // same URL is gone; point the same URL id to the new server by reusing the port is not possible, so emulate: new relay, same remote id
    const id = SC.relayId(cfg.url); const rem = A.getRemote(id); A.setRemote(SC.relayId('http://127.0.0.1:' + srv2.address().port), rem);
    const cfg3 = { url: 'http://127.0.0.1:' + srv2.address().port, token: cfg.token };
    const C = await mkDevice('C'); await SC.syncRelay(A, cfg3, f, cipher);
    await SC.syncRelay(C, cfg3, f, cipher);
    assert.strictEqual(rows(C).length, rows(A).length);
    A.cfg3 = cfg3; global.__cfg3 = cfg3; global.__srv2 = srv2;
  });

  console.log('Document transport (WebDAV / shared file)');
  await ok('two devices sync through one file with optimistic locking; second device joins and edits merge', async () => {
    let file = null, etag = 0;
    const io = { async get() { return { text: file, etag: String(etag) }; }, async put(text, et) { if (file !== null && String(et) !== String(etag)) return { conflict: true }; file = text; etag++; return { ok: true }; } };
    const P1 = await mkDevice('P1', seed), P2 = await mkDevice('P2');
    await SC.syncDoc(P1, io, cipher, 'f'); await SC.syncDoc(P2, io, cipher, 'f');
    assert.strictEqual(rows(P2).length, 3); assert(!/Drive test/.test(file), 'file is encrypted');
    let t = J(P2.st.m['npm-tasks-v2']); t.rows[0][3] = 'Done'; P2.st.m['npm-tasks-v2'] = JSON.stringify(t);
    t = J(P1.st.m['npm-tasks-v2']); t.rows[1][4] = 0.9; P1.st.m['npm-tasks-v2'] = JSON.stringify(t);
    await SC.syncDoc(P2, io, cipher, 'f'); await SC.syncDoc(P1, io, cipher, 'f'); await SC.syncDoc(P2, io, cipher, 'f');
    assert.strictEqual(byIdx(P1)[1][3], 'Done'); assert.strictEqual(byIdx(P2)[2][4], 0.9);
    const before = file; const r = await SC.syncDoc(P1, io, cipher, 'f'); assert.strictEqual(file, before, 'no rewrite when nothing changed'); assert.strictEqual(r.pushed, 0);
  });
  await ok('conflict on write (another device wrote in between) is retried and merged', async () => {
    let file = null, etag = 0, injected = false;
    const P1 = await mkDevice('Q1', seed), P2 = await mkDevice('Q2');
    const io = { async get() { return { text: file, etag: String(etag) }; }, async put(text, et) {
      if (!injected && file !== null) { injected = true; // P2 sneaks in a write first
        const t = J(P2.st.m['npm-tasks-v2']); t.rows[2][4] = 0.55; P2.st.m['npm-tasks-v2'] = JSON.stringify(t); await SC.syncDoc(P2, io2, cipher, 'q'); }
      if (file !== null && String(et) !== String(etag)) return { conflict: true }; file = text; etag++; return { ok: true }; } };
    const io2 = { get: io.get, async put(text, et) { if (file !== null && String(et) !== String(etag)) return { conflict: true }; file = text; etag++; return { ok: true }; } };
    await SC.syncDoc(P1, io, cipher, 'q'); await SC.syncDoc(P2, io2, cipher, 'q');
    let t = J(P1.st.m['npm-tasks-v2']); t.rows[0][3] = 'Done'; P1.st.m['npm-tasks-v2'] = JSON.stringify(t);
    await SC.syncDoc(P1, io, cipher, 'q'); await SC.syncDoc(P2, io2, cipher, 'q');
    assert.strictEqual(byIdx(P1)[1][3], 'Done'); assert.strictEqual(byIdx(P1)[3][4], 0.55); assert.strictEqual(byIdx(P2)[1][3], 'Done');
  });

  console.log('Joining');
  await ok('probe reports how much the server already holds', async () => {
    assert((await SC.probeRelay(global.__cfg3, f)) > 5);
    assert.strictEqual(await SC.probeRelay({ url: global.__cfg3.url, token: 'a-different-token' }, f), 0);
  });
  await ok('wipeLocal + sync makes a fresh device an exact copy (no duplicated sample rows)', async () => {
    const N = await mkDevice('N', { 'npm-tasks-v2': { headers: HEAD, rows: [[1, 'Sample', 'Sample task', 'Done', 1]] }, 'planner-v1': { events: [{ id: 'sample', title: 's' }] } });
    await N.wipeLocal(); await SC.syncRelay(N, global.__cfg3, f, cipher);
    assert(!rows(N).some((r) => r[2] === 'Sample task')); assert.strictEqual(rows(N).length, rows(A).length);
    assert(!J(N.st.m['planner-v1']).events.some((e) => e.id === 'sample'));
  });

  global.__srv2.close(); srv.close(); relay.flushAll();
  console.log('\n' + passed + ' checks passed' + (process.exitCode ? ', SOME FAILED' : ''));
})().catch((e) => { console.error(e); process.exit(1); });
