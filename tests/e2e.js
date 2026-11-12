// Needs: cd npm-progress-pwa && python server.py 8082 ; node sync-relay.js --port 8083 --data /tmp/rd ; npm i playwright
const { chromium, devices } = require('playwright');
const assert = require('assert');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  const errs = [];
  const mk = async (name, opts) => { const ctx = await browser.newContext(Object.assign({ permissions: ['clipboard-read', 'clipboard-write'] }, opts)); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(name + ': ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(name + ' console: ' + m.text()); }); await p.goto('http://localhost:8082/'); await p.waitForFunction(() => window.appSync && typeof ROWS !== 'undefined' && ROWS.length > 0, null, { timeout: 15000 }); return p; };
  const A = await mk('PC', { viewport: { width: 1280, height: 800 } });
  const B = await mk('phone', Object.assign({}, devices['Pixel 7']));
  console.log('both apps loaded; PC rows', await A.evaluate(() => ROWS.length), 'phone rows', await B.evaluate(() => ROWS.length));

  // --- PC: set up sync through the dialog
  await A.click('#syncChip'); await A.waitForSelector('#syncModal');
  await A.check('#syOn'); await A.fill('#syUrl', 'http://127.0.0.1:8083'); await A.click('#syGen'); await A.fill('#syPass', 'e2e-passphrase');
  await A.click('#syCopy'); await sleep(300);
  const code = await A.evaluate(async () => { try { return await navigator.clipboard.readText(); } catch (e) { return document.getElementById('syCode').value; } });
  assert(code.length > 20, 'setup code produced');
  await A.click('#sySave'); await A.waitForFunction(() => /Synced/.test(window.appSync.status().text), null, { timeout: 15000 });
  console.log('PC status:', JSON.stringify(await A.evaluate(() => window.appSync.status())));
  await A.screenshot({ path: '/tmp/pc-after-sync.png' });

  // --- phone: join with the setup code
  await B.click('#syncChip'); await B.waitForSelector('#syncModal');
  await B.fill('#syCode', code); await B.click('#syUse'); await B.check('#syOn'); await B.fill('#syPass', 'e2e-passphrase');
  await B.screenshot({ path: '/tmp/phone-dialog.png' });
  await B.click('#sySave'); await B.waitForSelector('#syncAsk');
  await B.screenshot({ path: '/tmp/phone-join.png' });
  await B.click('#syncAsk button[data-i="0"]');
  await B.waitForFunction(() => /Synced/.test(window.appSync.status().text), null, { timeout: 15000 });
  const rowsA = await A.evaluate(() => ROWS.map((r) => r.join('|'))), rowsB = await B.evaluate(() => ROWS.map((r) => r.join('|')));
  assert.deepStrictEqual(rowsB.sort(), rowsA.sort(), 'phone has an exact copy (no duplicated sample rows)');
  console.log('phone joined, rows:', rowsB.length);

  // --- edit on the phone, see it on the PC (through the app's own save path)
  await B.evaluate(async () => { const s = HEADERS.indexOf('Status'), t = HEADERS.indexOf('Task'); ROWS[0][s] = 'Suspended'; ROWS[0][HEADERS.indexOf('Progress %')] = 0.77; window.__t = ROWS[0][t]; await commitChange(); });
  await B.waitForFunction(() => window.appSync.status().detail.includes('sent'), null, { timeout: 15000 });
  await A.evaluate(() => window.appSync.syncNow());
  const aStatus = await A.evaluate(() => ROWS[0][HEADERS.indexOf('Status')]);
  assert.strictEqual(aStatus, 'Suspended', 'edit made on the phone arrived on the PC'); assert.strictEqual(await A.evaluate(() => ROWS[0][HEADERS.indexOf('Progress %')]), 0.77);
  const shown = await A.evaluate(() => /Suspended/.test(document.body.innerText));
  console.log('phone edit reached PC; table re-rendered:', shown);

  await B.evaluate(async () => { ROWS[1][HEADERS.indexOf('Task')] = 'Renamed on phone QZX7'; await commitChange(); });
  await B.evaluate(() => window.appSync.syncNow()); await A.evaluate(() => window.appSync.syncNow());
  assert(await A.evaluate(() => document.body.textContent.includes('Renamed on phone QZX7')), 'PC screen re-rendered with the phone edit'); console.log('PC screen re-rendered with synced edit: true');
  // --- add a task on the PC while the phone is "offline", add another on the phone, then reconnect
  await A.evaluate(async () => { const row = HEADERS.map((h) => (h === 'Index' ? Math.max(...ROWS.map((r) => +r[0] || 0)) + 1 : h === 'Task' ? 'Added on PC' : h === 'Status' ? 'Not Started' : null)); ROWS.push(row); await commitChange(); });
  await B.evaluate(async () => { const row = HEADERS.map((h) => (h === 'Index' ? Math.max(...ROWS.map((r) => +r[0] || 0)) + 1 : h === 'Task' ? 'Added on phone' : h === 'Status' ? 'Not Started' : null)); ROWS.push(row); await commitChange(); });
  for (let i = 0; i < 3; i++) { await A.evaluate(() => window.appSync.syncNow()); await B.evaluate(() => window.appSync.syncNow()); }
  const fin = async (p) => p.evaluate(() => ({ tasks: ROWS.map((r) => r[HEADERS.indexOf('Task')]).filter((t) => /Added on/.test(t)).sort(), idx: ROWS.map((r) => r[0]) }));
  const fa = await fin(A), fb = await fin(B);
  assert.deepStrictEqual(fa.tasks, ['Added on PC', 'Added on phone']); assert.deepStrictEqual(fb.tasks, fa.tasks);
  assert.strictEqual(new Set(fa.idx).size, fa.idx.length, 'Index values unique on PC'); assert.strictEqual(new Set(fb.idx).size, fb.idx.length, 'Index values unique on phone');
  console.log('offline adds on both sides merged, indexes unique:', fa.idx.join(','));

  // --- planner event
  await A.evaluate(async () => { const r = JSON.parse(localStorage.getItem('npmconsole:planner-v1') || '{}'); r.events = (r.events || []).concat([{ id: 'e-sync-test', title: 'Sync test meeting', start: Date.now() + 36e5, end: Date.now() + 72e5, allDay: false, blocks: true, color: '#3FD6C5', repeat: 'none', interval: 1, byday: [], until: null, count: 0, skip: [] }]); await AppStorage.set('planner-v1', JSON.stringify(r), false); });
  await A.evaluate(() => window.appSync.syncNow()); await B.evaluate(() => window.appSync.syncNow());
  const ev = await B.evaluate(() => JSON.parse(localStorage.getItem('npmconsole:planner-v1')).events.map((e) => e.title));
  assert(ev.includes('Sync test meeting'), 'planner event arrived on the phone: ' + ev);
  console.log('planner event synced');

  await B.screenshot({ path: '/tmp/phone-main.png' });
  await A.screenshot({ path: '/tmp/pc-main.png' });
  const server = require('fs').readdirSync('/tmp/rd').map((f) => require('fs').readFileSync('/tmp/rd/' + f, 'utf8')).join('');
  assert(!/Added on PC|Sync test meeting/.test(server), 'server data is encrypted');
  console.log('server data is ciphertext only');
  console.log(errs.length ? 'PAGE ERRORS:\n' + errs.join('\n') : 'no page errors');
  await browser.close();
})().catch((e) => { console.error('E2E FAIL:', e.message); process.exit(1); });
