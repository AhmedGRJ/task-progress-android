/* sync.js: connects the dashboard to sync-core.js. Settings dialog, automatic sync, status in the header.
   Works the same in the web app, Electron, Tauri and the Android app. */
(() => {
  'use strict';
  if (window.appSync || !window.SyncCore) return;
  const SC = window.SyncCore, D = window.desktop || null;
  const CFG_KEY = 'sync-config-v1';
  const WATCH = new Set(SC.ADAPTERS.map((a) => a.key));
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const toast = (m, o) => { if (typeof showToast === 'function') showToast(m, o); };
  const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const DEF = { on: false, mode: 'relay', relay: { url: '', token: '' }, hub: { on: false, port: 8083, lan: true }, dav: { url: '', user: '', pass: '' }, file: { path: '' }, pass: '', group: '', interval: 60 };
  let cfg = JSON.parse(JSON.stringify(DEF)), engine = null, busy = false, quiet = false, failN = 0, timer = null, deb = null;
  let status = { state: 'off', text: 'Sync off', at: 0, detail: '' };
  let hubInfo = null;

  /* ---------- storage access that bypasses the change watcher ---------- */
  const rawGet = AppStorage.get.bind(AppStorage), rawSet = AppStorage.set.bind(AppStorage);
  const store = {
    get: async (k) => { const r = await rawGet(k, false); return r && r.value != null ? r.value : null; },
    set: async (k, v) => { await rawSet(k, v, false); }
  };
  AppStorage.set = function (key) { // schedule a sync shortly after the app saves something we sync
    const r = rawSet.apply(AppStorage, arguments);
    if (WATCH.has(key) && cfg.on && !quiet) schedule(4000);
    return r;
  };

  const fetcher = () => window.desktopFetch || ((u, o) => fetch(u, o));
  let cipherMemo = { sig: '', c: null };
  async function cipher() {
    if (!cfg.pass) return null;
    const sig = cfg.pass + '\u0001' + cfg.group;
    if (cipherMemo.sig !== sig) cipherMemo = { sig, c: await SC.makeCipher(cfg.pass, cfg.group) };
    return cipherMemo.c;
  }

  /* ---------- which remote are we talking to ---------- */
  function effectiveRelay() {
    if (cfg.hub.on && D && D.hub) return { url: 'http://127.0.0.1:' + cfg.hub.port, token: cfg.relay.token };
    return cfg.relay;
  }
  function fileIO() {
    const F = D && D.syncFile;
    return {
      async get() { const r = await F.read(cfg.file.path); if (r.error) throw new Error(r.error); return { text: r.text, etag: r.mtime == null ? null : String(r.mtime) }; },
      async put(text, etag) { const r = await F.write(cfg.file.path, text, etag); if (r.error) throw new Error(r.error); return r.conflict ? { conflict: true } : { ok: true }; }
    };
  }
  function remote() {
    if (cfg.mode === 'dav') {
      if (!cfg.dav.url) throw new Error('Enter the WebDAV file address.');
      const io = SC.davIO(cfg.dav, fetcher());
      return { id: 'doc:' + SC.hash(cfg.dav.url), probe: () => SC.probeDoc(io), run: (c) => SC.syncDoc(engine, io, c, SC.hash(cfg.dav.url)) };
    }
    if (cfg.mode === 'file') {
      if (!(D && D.syncFile)) throw new Error('Shared-file sync is available in the Windows app. Use a server or WebDAV on the phone.');
      if (!cfg.file.path) throw new Error('Choose the sync file.');
      const io = fileIO();
      return { id: 'doc:' + SC.hash(cfg.file.path), probe: () => SC.probeDoc(io), run: (c) => SC.syncDoc(engine, io, c, SC.hash(cfg.file.path)) };
    }
    const r = effectiveRelay();
    if (!r.url) throw new Error('Enter the server address.');
    if (!r.token || r.token.length < 8) throw new Error('The token needs at least 8 characters.');
    return { id: SC.relayId(r.url), probe: () => SC.probeRelay(r, fetcher()), run: (c) => SC.syncRelay(engine, r, fetcher(), c) };
  }

  /* ---------- the sync cycle ---------- */
  const editing = () => {
    const a = document.activeElement;
    if (!a || a === document.body || a.closest('#syncModal')) return false;
    return /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable;
  };
  function setStatus(state, text, detail) { status = { state, text, detail: detail || '', at: Date.now() }; paint(); }

  async function reloadUI(ids) {
    try {
      if (ids.includes('tasks') && typeof loadState === 'function') await loadState();
      if (ids.includes('subtasks') && typeof loadSubtasks === 'function') await loadSubtasks();
      if (ids.includes('notes') && typeof loadNotes === 'function') await loadNotes();
      if (typeof renderAll === 'function' && ids.some((i) => i !== 'planner')) renderAll();
      if (ids.includes('notes') && typeof renderNotesList === 'function') { try { renderNotesList(); } catch (e) { /* tab not built yet */ } }
      if (ids.includes('planner') && window.planner && window.planner.reload) await window.planner.reload();
    } catch (e) { console.warn('sync: refreshing the screen failed', e); }
  }

  async function ensureEngine() {
    if (engine) return engine;
    engine = await new SC.Engine(store, { onApplied: reloadUI }).load();
    return engine;
  }

  async function syncNow(o) {
    o = o || {};
    if (!cfg.on) { if (o.manual) open(); return null; }
    if (busy) return null;
    if (!o.manual && navigator.onLine === false) { setStatus('wait', 'Offline: will sync when connected'); return null; }
    if (!o.force && editing()) { schedule(3000); return null; }
    busy = true; const prev = status; if (!o.local) setStatus('busy', 'Syncing…');
    try {
      await ensureEngine();
      // the dashboard keeps its rows in memory and saves on edit: make sure storage holds exactly what is on screen
      quiet = true; try { if (typeof saveState === 'function') await saveState(); } catch (e) { /* ignore */ } finally { setTimeout(() => { quiet = false; }, 50); }
      if (o.local) { await engine.scan(); if (!engine.outgoing().length) { busy = false; return null; } setStatus('busy', 'Syncing…'); }
      const rem = remote(), c = await cipher();
      if (!engine.state.remotes[rem.id] && !engine.state.lastSync) { // a device that never synced before
        const n = await rem.probe();
        if (n > 0) {
          const pick = await ask3('Join the synced data', 'This sync location already holds ' + n + ' items. Is this a new device?', ['Replace this device\u2019s data (new phone)', 'Merge both', 'Cancel']);
          if (pick === 2 || pick == null) { setStatus('wait', 'Sync cancelled'); busy = false; return null; }
          if (pick === 0) { await engine.wipeLocal(); await reloadUI(['tasks', 'subtasks', 'notes', 'planner']); }
        }
      }
      const r = await rem.run(c);
      failN = 0; engine.state.lastSync = Date.now(); await engine.persist();
      setStatus('ok', 'Synced ' + fmtTime(Date.now()), (r.pushed ? 'sent ' + r.pushed + ' ' : '') + (r.pulled ? 'received ' + r.pulled : (r.pushed ? '' : 'up to date')));
      if (o.manual) toast(r.pulled || r.pushed ? 'Synced: ' + (r.pushed ? 'sent ' + r.pushed + ', ' : '') + 'received ' + r.pulled : 'Already up to date');
      return r;
    } catch (e) {
      failN++;
      const msg = /Failed to fetch|NetworkError|Load failed|fetch/i.test(e.message) ? 'Cannot reach the sync location' : e.message;
      setStatus('err', msg, e.message);
      if (o.manual) toast('Sync failed: ' + msg, { type: 'error' });
      return null;
    } finally { busy = false; }
  }
  function schedule(ms) { clearTimeout(deb); deb = setTimeout(() => syncNow({ local: true }), ms); }
  function restartTimer() {
    clearInterval(timer); timer = null;
    if (!cfg.on || !cfg.interval) return;
    timer = setInterval(() => { if (document.visibilityState === 'hidden') return; if (failN > 0 && Date.now() - status.at < Math.min(300, cfg.interval * Math.pow(2, failN)) * 1000) return; syncNow({}); }, 15000);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && cfg.on) schedule(800); });
  window.addEventListener('online', () => { if (cfg.on) schedule(500); });
  window.addEventListener('focus', () => { if (cfg.on && Date.now() - status.at > 20000) schedule(500); });

  /* ---------- header chip ---------- */
  function paint() {
    const icon = status.state === 'err' ? '⚠' : '⟳', spin = status.state === 'busy' ? ' spin' : '';
    const full = '<span class="sy-ic' + spin + '">' + icon + '</span> <span class="sy-t">' + esc(status.state === 'off' ? 'Sync' : status.text) + '</span>';
    const short = '<span class="sy-ic' + spin + '">' + icon + '</span> <span class="sy-t">' + esc({ off: 'Sync', ok: fmtTime(status.at || Date.now()), busy: 'Syncing', wait: 'Sync', err: 'Sync error' }[status.state] || 'Sync') + '</span>';
    [['#syncBtn', full], ['#syncChip', short]].forEach(([sel, html]) => {
      const b = $(sel); if (!b) return;
      b.innerHTML = html; b.classList.toggle('sy-err', status.state === 'err'); b.classList.toggle('sy-ok', status.state === 'ok'); b.title = status.detail || status.text;
    });
    const l = $('#syncLine'); if (l) { l.className = 'sy-line ' + status.state; l.textContent = status.text + (status.detail ? ' · ' + status.detail : ''); }
  }

  /* ---------- dialogs ---------- */
  function overlay(id, html, width) {
    let ov = document.getElementById(id); if (ov) ov.remove();
    ov = document.createElement('div'); ov.className = 'modal-overlay active'; ov.id = id;
    ov.innerHTML = '<div class="modal sy-modal" style="max-width:' + (width || 560) + 'px">' + html + '</div>';
    document.body.appendChild(ov);
    return ov;
  }
  function ask3(title, msg, labels) {
    return new Promise((res) => {
      const ov = overlay('syncAsk', '<h3>' + esc(title) + '</h3><p>' + esc(msg) + '</p><div class="sy-ask">' + labels.map((l, i) => '<button class="btn' + (i === 0 ? ' primary' : '') + '" data-i="' + i + '">' + esc(l) + '</button>').join('') + '</div>', 440);
      ov.onclick = (e) => { const b = e.target.closest('button[data-i]'); if (b) { ov.remove(); res(+b.dataset.i); } };
    });
  }
  const randToken = () => { const a = new Uint8Array(18); crypto.getRandomValues(a); return Array.from(a, (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join(''); };
  const encodeSetup = () => { const r = effectiveRelayForPhone(); return btoa(unescape(encodeURIComponent(JSON.stringify({ tps: 1, mode: cfg.mode, url: r.url, token: r.token, dav: cfg.mode === 'dav' ? cfg.dav : undefined, group: cfg.group })))); };
  function effectiveRelayForPhone() {
    const port = cfg.hub.port, ip = hubInfo && hubInfo.addresses && hubInfo.addresses[0];
    if (cfg.hub.on && ip) return { url: 'http://' + ip + ':' + port, token: cfg.relay.token };
    return cfg.relay;
  }
  function applySetup(code) {
    let o; try { o = JSON.parse(decodeURIComponent(escape(atob(code.trim())))); } catch (e) { return false; }
    if (!o || o.tps !== 1) return false;
    if (o.mode === 'dav' && o.dav) { cfg.mode = 'dav'; cfg.dav = Object.assign({}, cfg.dav, o.dav); } else { cfg.mode = 'relay'; cfg.relay = { url: o.url || '', token: o.token || '' }; cfg.hub.on = false; }
    cfg.group = o.group || ''; return true;
  }

  async function saveCfg() { await store.set(CFG_KEY, JSON.stringify(cfg)); }
  async function applyHub() {
    if (!(D && D.hub)) return;
    try { hubInfo = await D.hub.configure({ on: !!(cfg.on && cfg.hub.on), port: cfg.hub.port, lan: cfg.hub.lan, token: cfg.relay.token }); } catch (e) { hubInfo = { error: e.message }; }
  }

  async function open() {
    await refreshHub();
    const hasHub = !!(D && D.hub), hasFile = !!(D && D.syncFile);
    const ov = overlay('syncModal',
      '<h3>Sync devices</h3>' +
      '<div id="syncLine" class="sy-line"></div>' +
      '<div class="sy-row"><label class="sy-sw"><input type="checkbox" id="syOn"> <b>Keep this device in sync automatically</b></label></div>' +
      '<div class="sy-tabs" id="syTabs"><button data-m="relay">' + (hasHub ? 'PC hub / server' : 'Server') + '</button><button data-m="dav">WebDAV</button>' + (hasFile ? '<button data-m="file">Shared file</button>' : '') + '</div>' +
      '<div class="sy-pane" data-p="relay">' +
        (hasHub ? '<label class="sy-sw"><input type="checkbox" id="syHub"> Run a sync hub on this computer (your phone connects to it over Wi-Fi or VPN)</label><div id="syHubBox" class="sy-sub"><div class="sy-row"><label>Port <input id="syPort" type="number" min="1024" max="65535" style="width:90px"></label><label class="sy-sw"><input type="checkbox" id="syLan"> Allow other devices on my network</label></div><div id="syHubInfo" class="sy-hint"></div></div>' : '') +
        '<div id="syUrlRow"><label>Server address<input id="syUrl" placeholder="http://192.168.1.20:8083"></label></div>' +
        '<label>Token <span class="sy-hint">(same on every device, 8+ characters)</span><span class="sy-inline"><input id="syTok" autocomplete="off" spellcheck="false"><button class="btn" id="syGen" type="button">Generate</button></span></label>' +
      '</div>' +
      '<div class="sy-pane" data-p="dav"><label>File address<input id="syDavUrl" placeholder="https://cloud.example.com/remote.php/dav/files/me/task-progress-sync.json"></label><div class="sy-row"><label>User<input id="syDavUser"></label><label>Password / app password<input id="syDavPass" type="password"></label></div><div class="sy-hint">Works with Nextcloud, ownCloud and most NAS. OneDrive, Google Drive and Dropbox do not offer WebDAV: on the PC use \u201cShared file\u201d with their sync folder, on the phone use a server.</div></div>' +
      (hasFile ? '<div class="sy-pane" data-p="file"><label>Sync file <span class="sy-inline"><input id="syFile" readonly placeholder="Pick a file inside your OneDrive / Google Drive / Dropbox folder"><button class="btn" id="syPick" type="button">Choose…</button></span></label><div class="sy-hint">Every computer that points at the same cloud-synced file stays in sync. A phone cannot read that folder; add a server for the phone.</div></div>' : '') +
      '<label>Sync passphrase <span class="sy-hint">(end-to-end encryption, optional but recommended)</span><input id="syPass" type="password" autocomplete="new-password" placeholder="Same on every device"></label>' +
      '<div class="sy-hint sy-warn">With a passphrase the server or cloud folder only ever stores unreadable data. If you forget it the synced copy cannot be recovered (each device keeps its own data).</div>' +
      '<div class="sy-row"><label>Sync every <select id="syInt"><option value="30">30 seconds</option><option value="60">1 minute</option><option value="300">5 minutes</option><option value="0">only when I press Sync now</option></select></label></div>' +
      '<div class="sy-row sy-setup"><button class="btn" id="syCopy" type="button">Copy phone setup code</button><span class="sy-inline"><input id="syCode" placeholder="Paste a setup code here"><button class="btn" id="syUse" type="button">Use</button></span></div>' +
      '<div class="row"><button class="btn" id="syReset" type="button" title="Forget what was synced and send everything again on the next sync">Resend everything</button><button class="btn" id="syClose" type="button">Close</button><button class="btn primary" id="sySave" type="button">Save &amp; sync now</button></div>', 620);

    const f = (id) => $('#' + id, ov);
    const fill = () => {
      f('syOn').checked = cfg.on; f('syUrl').value = cfg.relay.url; f('syTok').value = cfg.relay.token; f('syPass').value = cfg.pass; f('syInt').value = String(cfg.interval);
      f('syDavUrl').value = cfg.dav.url; f('syDavUser').value = cfg.dav.user; f('syDavPass').value = cfg.dav.pass;
      if (hasHub) { f('syHub').checked = cfg.hub.on; f('syPort').value = cfg.hub.port; f('syLan').checked = cfg.hub.lan; }
      if (hasFile) f('syFile').value = cfg.file.path;
      tab(cfg.mode); hubUI(); paint();
    };
    const tab = (m) => { cfg.mode = m; ov.querySelectorAll('#syTabs button').forEach((b) => b.classList.toggle('on', b.dataset.m === m)); ov.querySelectorAll('.sy-pane').forEach((p) => { p.style.display = p.dataset.p === m ? '' : 'none'; }); };
    const hubUI = () => {
      if (!hasHub) return;
      const on = f('syHub').checked; f('syHubBox').style.display = on ? '' : 'none'; f('syUrlRow').style.display = on ? 'none' : '';
      const i = f('syHubInfo');
      if (on) i.innerHTML = hubInfo && hubInfo.error ? '<span class="sy-bad">' + esc(hubInfo.error) + '</span>' : (hubInfo && hubInfo.running ? 'Hub running. On the phone enter: ' + (hubInfo.addresses || []).map((a) => '<b>http://' + esc(a) + ':' + hubInfo.port + '</b>').join(' or ') + ' and the same token. Windows may ask to allow the app through the firewall: allow it on private networks.' : 'Hub starts when you save.');
    };
    const read = () => {
      cfg.on = f('syOn').checked; cfg.relay = { url: f('syUrl').value.trim(), token: f('syTok').value.trim() }; cfg.pass = f('syPass').value; cfg.interval = +f('syInt').value;
      cfg.dav = { url: f('syDavUrl').value.trim(), user: f('syDavUser').value, pass: f('syDavPass').value };
      if (hasHub) cfg.hub = { on: f('syHub').checked, port: Math.max(1024, Math.min(65535, +f('syPort').value || 8083)), lan: f('syLan').checked };
      if (hasFile) cfg.file = { path: f('syFile').value };
    };
    ov.querySelectorAll('#syTabs button').forEach((b) => { b.onclick = () => tab(b.dataset.m); });
    if (hasHub) f('syHub').onchange = async () => { read(); if (cfg.hub.on && !cfg.relay.token) { cfg.relay.token = randToken(); f('syTok').value = cfg.relay.token; } hubUI(); };
    f('syGen').onclick = () => { f('syTok').value = randToken(); };
    if (hasFile) f('syPick').onclick = async () => { const p = await D.syncFile.pick(); if (p) f('syFile').value = p; };
    f('syClose').onclick = () => ov.remove();
    f('syCopy').onclick = async () => {
      read(); if (cfg.hub.on && !cfg.relay.token) { cfg.relay.token = randToken(); f('syTok').value = cfg.relay.token; }
      const code = encodeSetup();
      try { await navigator.clipboard.writeText(code); toast('Setup code copied. Paste it in the Sync dialog on the phone.'); } catch (e) { f('syCode').value = code; toast('Copy the code from the box.'); }
    };
    f('syUse').onclick = () => { if (applySetup(f('syCode').value)) { fill(); toast('Setup code applied. Press Save & sync now.'); } else toast('That is not a valid setup code.', { type: 'error' }); };
    f('syReset').onclick = async () => { await ensureEngine(); engine.markAllDirty(); engine.state.remotes = {}; await engine.persist(); toast('Everything will be sent again on the next sync.'); };
    f('sySave').onclick = async () => {
      read(); failN = 0;
      if (cfg.on && cfg.mode === 'relay' && !(cfg.hub.on && hasHub) && !/^https?:\/\//i.test(cfg.relay.url)) { toast('The server address must start with http:// or https://', { type: 'error' }); return; }
      if (cfg.on && cfg.mode === 'relay' && cfg.relay.token.length < 8) { toast('The token needs at least 8 characters (press Generate).', { type: 'error' }); return; }
      await saveCfg(); await applyHub(); restartTimer(); hubUI();
      if (!cfg.on) { setStatus('off', 'Sync off'); toast('Sync is off.'); return; }
      const r = await syncNow({ manual: true, force: true });
      if (r) ov.remove();
    };
    fill();
  }

  async function refreshHub() { if (D && D.hub && D.hub.status) { try { hubInfo = await D.hub.status(); } catch (e) { /* ignore */ } } }

  /* ---------- start ---------- */
  async function init() {
    try { const s = await store.get(CFG_KEY); if (s) { const o = JSON.parse(s); cfg = Object.assign({}, DEF, o, { relay: Object.assign({}, DEF.relay, o.relay), hub: Object.assign({}, DEF.hub, o.hub), dav: Object.assign({}, DEF.dav, o.dav), file: Object.assign({}, DEF.file, o.file) }); } } catch (e) { /* defaults */ }
    const b = $('#syncBtn'); if (b) b.onclick = () => open();
    const bar = $('#tabBar');
    if (bar && !$('#syncChip')) { const c = document.createElement('button'); c.id = 'syncChip'; c.className = 'sy-chip'; c.type = 'button'; c.onclick = () => open(); bar.appendChild(c); }
    setStatus(cfg.on ? 'wait' : 'off', cfg.on ? 'Sync starting…' : 'Sync off');
    if (cfg.on) { await applyHub(); restartTimer(); setTimeout(() => syncNow({ force: true }), 3500); }
  }
  window.appSync = { open, syncNow: (o) => syncNow(Object.assign({ manual: true, force: true }, o)), status: () => Object.assign({ on: cfg.on }, status), schedule };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0)); else setTimeout(init, 0);
})();
