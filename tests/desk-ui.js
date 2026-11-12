const { chromium } = require('playwright');
const assert = require('assert');
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => {
    window.__calls = []; window.__file = { text: null, tag: null };
    window.desktop = { isDesktop: true,
      hub: { configure: async (c) => { window.__calls.push(['hub', JSON.stringify(c)]); return { running: !!c.on, port: c.port, lan: c.lan, addresses: ['192.168.1.20'] }; }, status: async () => ({ running: false, addresses: ['192.168.1.20'] }) },
      syncFile: { pick: async () => 'C:\\Users\\me\\OneDrive\\task-progress-sync.json',
        read: async () => ({ text: window.__file.text, mtime: window.__file.tag }),
        write: async (path, text, exp) => { if (window.__file.text !== null && String(exp) !== String(window.__file.tag)) return { conflict: true }; window.__file = { text, tag: 't' + Math.random() }; return { ok: true }; } } };
  });
  await p.goto('http://localhost:8082/'); await p.waitForFunction(() => window.appSync && ROWS.length > 0);
  await p.click('#syncChip'); await p.waitForSelector('#syncModal');
  assert.deepStrictEqual(await p.$$eval('#syTabs button', (x) => x.map((e) => e.textContent)), ['PC hub / server', 'WebDAV', 'Shared file']);
  // hub mode: toggling generates a token and shows the phone address; Save starts the hub then syncs against it
  await p.check('#syHub'); const tok = await p.inputValue('#syTok'); assert(tok.length >= 8, 'token generated');
  await p.check('#syOn'); await p.click('#syCopy'); await p.waitForTimeout(200);
  const code = JSON.parse(Buffer.from(await p.inputValue('#syCode').then((v) => v || '', () => ''), 'base64').toString() || '{}');
  console.log('hub dialog: token generated, hub info:', (await p.textContent('#syHubInfo')).slice(0, 90));
  await p.click('#sySave'); await p.waitForTimeout(1500);
  const calls = await p.evaluate(() => window.__calls); assert(calls.some((c) => c[0] === 'hub' && JSON.parse(c[1]).on && JSON.parse(c[1]).token === tok), 'hub configured with the token: ' + JSON.stringify(calls));
  console.log('hub configure call:', calls.filter((c) => c[0] === 'hub').pop()[1]);
  // shared file mode through the mock: choose file, sync, content lands in the file as ciphertext
  await p.evaluate(() => window.appSync.open()); await p.waitForSelector('#syncModal');
  await p.uncheck('#syHub');
  await p.click('#syTabs button[data-m="file"]'); await p.click('#syPick'); assert((await p.inputValue('#syFile')).endsWith('task-progress-sync.json'));
  await p.fill('#syPass', 'file-pass'); await p.check('#syOn'); await p.click('#sySave');
  await p.waitForFunction(() => /Synced/.test(window.appSync.status().text), null, { timeout: 15000 });
  const f = await p.evaluate(() => window.__file); assert(f.text && Object.keys(JSON.parse(f.text).items).length >= 8, 'file holds the items'); assert(!/Drive test|VoLTE/.test(f.text) , 'file content encrypted');
  console.log('shared-file mode: synced, file items =', Object.keys(JSON.parse(f.text).items).length, '(encrypted)');
  console.log('page errors:', errs.join('|') || 'none'); await b.close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
