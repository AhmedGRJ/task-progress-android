/* Evidence: attach KPI plots, screenshots and exports to a task.
   File contents live in IndexedDB; a small metadata list (with image thumbnails) lives in the app storage. */
(() => {
  'use strict';
  if (window.evidence) return;
  const KEY = 'evidence-v1', DBN = 'task-evidence', STORE = 'files', MAX = 40 * 1024 * 1024;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (v) => (typeof escapeHtml === 'function' ? escapeHtml(v) : String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
  const toast = (m, o) => { if (typeof showToast === 'function') showToast(m, o); };
  const pad = (n) => String(n).padStart(2, '0');
  const fmtSize = (b) => (b < 1024 ? b + ' B' : b < 1048576 ? Math.round(b / 1024) + ' KB' : (b / 1048576).toFixed(1) + ' MB');
  const ext = (n) => { const m = /\.([A-Za-z0-9]{1,5})$/.exec(n || ''); return m ? m[1].toUpperCase() : 'FILE'; };

  /* ---------- metadata ---------- */
  let EV = {}, loadP = null, saveT = null;
  const ready = () => loadP || (loadP = (async () => {
    try { const r = await AppStorage.get(KEY, false); if (r && r.value) EV = JSON.parse(r.value) || {}; } catch (e) { /* first run */ }
  })());
  function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { AppStorage.set(KEY, JSON.stringify(EV), false); } catch (e) { /* ignore */ } }, 200); }

  /* ---------- file contents (IndexedDB) ---------- */
  let dbP = null;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise((res, rej) => {
      if (!window.indexedDB) { rej(new Error('File storage is not available here')); return; }
      const r = indexedDB.open(DBN, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbP;
  }
  const tx = (mode, fn) => db().then((d) => new Promise((res, rej) => {
    const t = d.transaction(STORE, mode), r = fn(t.objectStore(STORE));
    t.oncomplete = () => res(r && r.result);
    t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  }));
  const putBlob = (id, blob) => tx('readwrite', (s) => s.put(blob, id));
  const getBlob = (id) => tx('readonly', (s) => s.get(id));
  const delBlob = (id) => tx('readwrite', (s) => s.delete(id));

  /* ---------- thumbnails ---------- */
  function loadImg(blob) {
    return new Promise((res, rej) => { const u = URL.createObjectURL(blob), im = new Image(); im.onload = () => { URL.revokeObjectURL(u); res(im); }; im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('not an image')); }; im.src = u; });
  }
  async function makeThumb(file) {
    if (!/^image\//.test(file.type)) return null;
    try {
      let src;
      try { src = await createImageBitmap(file); } catch (e) { src = await loadImg(file); }
      const w0 = src.width || src.naturalWidth || 240, h0 = src.height || src.naturalHeight || 240, sc = Math.min(1, 240 / Math.max(w0, h0));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w0 * sc)); c.height = Math.max(1, Math.round(h0 * sc));
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(src, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.72);
    } catch (e) { return null; }
  }

  /* ---------- operations ---------- */
  const MOUNTS = new Set();
  function changed(key) {
    MOUNTS.forEach((el) => { if (!el.isConnected) MOUNTS.delete(el); else if (el.dataset.evKey === key) renderBox(el); });
    decorateCards();
    document.dispatchEvent(new CustomEvent('evidence:changed', { detail: { key } }));
  }
  async function add(key, files) {
    await ready();
    const errs = [];
    let n = 0;
    for (const f of Array.from(files || [])) {
      if (!f || !f.size && !f.name) continue;
      if (f.size > MAX) { errs.push((f.name || 'file') + ' is bigger than 40 MB'); continue; }
      const id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      try { await putBlob(id, f); } catch (e) { errs.push((f.name || 'file') + ': ' + ((e && e.message) || 'could not be stored')); continue; }
      (EV[key] = EV[key] || []).push({ id, name: f.name || 'file', type: f.type || '', size: f.size, added: Date.now(), thumb: await makeThumb(f) });
      n++;
    }
    save(); changed(key);
    if (errs.length) toast(errs.join('. '), { type: 'error' });
    else if (n) toast(n === 1 ? 'Evidence attached' : n + ' files attached');
    return n;
  }
  async function remove(key, id) {
    await ready();
    EV[key] = (EV[key] || []).filter((r) => r.id !== id);
    if (!EV[key].length) delete EV[key];
    try { await delBlob(id); } catch (e) { /* the record is gone either way */ }
    save(); changed(key);
  }
  const list = (key) => EV[key] || [];
  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }
  async function pasteFromClipboard(key) {
    try {
      const items = await navigator.clipboard.read(), files = [];
      for (const it of items) {
        const t = it.types.find((x) => /^image\//.test(x));
        if (t) { const b = await it.getType(t); files.push(new File([b], shotName(t), { type: t })); }
      }
      if (files.length) await add(key, files); else toast('There is no image on the clipboard.');
    } catch (e) { toast('Click here and press Ctrl+V to paste a screenshot.'); }
  }
  const shotName = (type) => { const d = new Date(); return 'screenshot-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.' + (String(type).split('/')[1] || 'png').replace('jpeg', 'jpg'); };

  /* ---------- zip (store only) ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  async function zipBlobs(entries) {
    const parts = [], central = [], enc = new TextEncoder(), d = new Date();
    const dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosD = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    let off = 0, cdSize = 0;
    for (const e of entries) {
      const data = new Uint8Array(await e.blob.arrayBuffer()), nm = enc.encode(e.name), crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true); lh.setUint16(10, dosT, true); lh.setUint16(12, dosD, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nm.length, true); lh.setUint16(28, 0, true);
      parts.push(lh.buffer, nm, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, dosT, true); ch.setUint16(14, dosD, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
      central.push(ch.buffer, nm); cdSize += 46 + nm.length; off += 30 + nm.length + data.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
    return new Blob(parts.concat(central, [end.buffer]), { type: 'application/zip' });
  }
  async function downloadAll(key) {
    const recs = list(key), seen = {}, entries = [];
    for (const r of recs) {
      const b = await getBlob(r.id);
      if (!b) continue;
      let nm = r.name; const n = (seen[nm] = (seen[nm] || 0) + 1);
      if (n > 1) nm = nm.replace(/(\.[^.]*)?$/, ' (' + n + ')$1');
      entries.push({ name: nm, blob: b });
    }
    if (!entries.length) { toast('Nothing to download.'); return; }
    download('evidence-task-' + key + '.zip', await zipBlobs(entries));
  }

  /* ---------- UI: thumbnails box ---------- */
  function thumbHtml(r, i) {
    const label = esc(r.name) + ' (' + fmtSize(r.size) + ')';
    return r.thumb ? '<button class="ev-th" type="button" data-i="' + i + '" title="' + label + '"><img alt="' + esc(r.name) + '" src="' + r.thumb + '"></button>'
      : '<button class="ev-th file" type="button" data-i="' + i + '" title="' + label + '"><b>' + esc(ext(r.name)) + '</b><span>' + esc(r.name.length > 14 ? r.name.slice(0, 12) + '...' : r.name) + '</span></button>';
  }
  function renderBox(el) {
    const key = el.dataset.evKey, recs = list(key), max = +el.dataset.max || 0;
    const shown = max ? recs.slice(0, max) : recs;
    el.innerHTML = '<div class="ev-row">' + shown.map(thumbHtml).join('') + (max && recs.length > max ? '<button class="ev-th more" type="button" data-i="0">+' + (recs.length - max) + '</button>' : '') +
      '<button class="ev-add" type="button" title="Attach files">' + clip() + (recs.length ? '' : ' Attach') + '</button></div>' +
      (el.dataset.hint === '0' ? '' : '<div class="ev-hint">Drop files here, or hover and press Ctrl+V to paste a screenshot.' + (recs.length ? ' <button class="ev-link" data-act="paste" type="button">Paste</button> <button class="ev-link" data-act="zip" type="button">Download all</button>' : ' <button class="ev-link" data-act="paste" type="button">Paste</button>') + '</div>');
  }
  const clip = () => '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.5l-8.6 8.6a5 5 0 01-7.1-7.1l9-9a3.3 3.3 0 014.7 4.7l-9 9a1.7 1.7 0 01-2.4-2.4l8.3-8.3"/></svg>';
  let HOVER = null;
  function pick(key) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true;
    inp.onchange = () => add(key, inp.files);
    inp.click();
  }
  function mount(el, key, opts) {
    if (!el) return;
    opts = opts || {};
    el.classList.add('ev-box');
    el.dataset.evKey = String(key);
    el.dataset.compact = opts.compact ? '1' : '0';
    if (opts.max) el.dataset.max = String(opts.max);
    if (opts.hint === false) el.dataset.hint = '0';
    el.tabIndex = 0;
    MOUNTS.add(el);
    ready().then(() => renderBox(el));
    if (el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('click', (e) => {
      const k = el.dataset.evKey, th = e.target.closest('.ev-th'), a = e.target.closest('.ev-add'), act = e.target.closest('[data-act]');
      if (th) openViewer(k, +th.dataset.i || 0);
      else if (a) pick(k);
      else if (act && act.dataset.act === 'paste') pasteFromClipboard(k);
      else if (act && act.dataset.act === 'zip') downloadAll(k);
    });
    ['dragenter', 'dragover'].forEach((t) => el.addEventListener(t, (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); el.classList.add('drop'); } }));
    ['dragleave', 'drop'].forEach((t) => el.addEventListener(t, (e) => { if (t === 'dragleave' && el.contains(e.relatedTarget)) return; el.classList.remove('drop'); }));
    el.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); add(el.dataset.evKey, e.dataTransfer.files); } });
    el.addEventListener('mouseenter', () => { HOVER = el; });
    el.addEventListener('mouseleave', () => { if (HOVER === el) HOVER = null; });
  }
  document.addEventListener('paste', (e) => {
    const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter((f) => f.size);
    if (!files.length) return;
    const ae = document.activeElement, box = (ae && ae.closest && ae.closest('.ev-box')) || (HOVER && HOVER.isConnected ? HOVER : null);
    if (!box) return;
    e.preventDefault();
    add(box.dataset.evKey, files.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], shotName(f.type || 'image/png'), { type: f.type || 'image/png' }))));
  });

  /* ---------- viewer ---------- */
  let LB = null;
  function closeViewer() { if (LB) { if (LB.url) URL.revokeObjectURL(LB.url); LB.el.remove(); document.removeEventListener('keydown', LB.key, true); LB = null; } }
  async function openViewer(key, i) {
    await ready();
    const recs = list(key);
    if (!recs.length) return;
    i = Math.max(0, Math.min(recs.length - 1, i));
    closeViewer();
    const el = document.createElement('div');
    el.className = 'ev-lb'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Evidence viewer');
    document.body.appendChild(el);
    LB = { el, i, key, tkey: key, url: null };
    const show = async (n) => {
      const recs2 = list(key);
      if (!recs2.length) { closeViewer(); return; }
      LB.i = n = (n + recs2.length) % recs2.length;
      if (LB.url) { URL.revokeObjectURL(LB.url); LB.url = null; }
      const r = recs2[n], blob = await getBlob(r.id);
      let body = '';
      if (!blob) body = '<div class="ev-lb-file"><b>' + esc(ext(r.name)) + '</b><span>This file is no longer in storage.</span></div>';
      else if (/^image\//.test(r.type)) { LB.url = URL.createObjectURL(blob); body = '<img src="' + LB.url + '" alt="' + esc(r.name) + '">'; }
      else if ((/^text\//.test(r.type) || /\.(txt|csv|log|json|md|tsv|xml)$/i.test(r.name)) && r.size < 400000) { body = '<pre>' + esc(await blob.text()) + '</pre>'; }
      else body = '<div class="ev-lb-file"><b>' + esc(ext(r.name)) + '</b><span>No preview for this type. Download it to open it.</span></div>';
      el.innerHTML = '<div class="ev-lb-bar"><div class="ev-lb-t"><b>' + esc(r.name) + '</b><span>' + fmtSize(r.size) + ' &middot; ' + new Date(r.added).toLocaleString() + (recs2.length > 1 ? ' &middot; ' + (n + 1) + ' of ' + recs2.length : '') + '</span></div>' +
        (recs2.length > 1 ? '<button class="ev-b" data-a="prev" aria-label="Previous">&lsaquo;</button><button class="ev-b" data-a="next" aria-label="Next">&rsaquo;</button>' : '') +
        '<button class="ev-b" data-a="dl">Download</button><button class="ev-b danger" data-a="del">Delete</button><button class="ev-b" data-a="x" aria-label="Close">&times;</button></div><div class="ev-lb-body">' + body + '</div>';
    };
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) { if (e.target === el || e.target.classList.contains('ev-lb-body')) closeViewer(); return; }
      const a = b.dataset.a, r = list(key)[LB.i];
      if (a === 'x') closeViewer();
      else if (a === 'prev') show(LB.i - 1);
      else if (a === 'next') show(LB.i + 1);
      else if (a === 'dl' && r) { const bl = await getBlob(r.id); if (bl) download(r.name, bl); }
      else if (a === 'del' && r && confirm('Delete "' + r.name + '" from this task?')) { await remove(key, r.id); show(Math.min(LB ? LB.i : 0, list(key).length - 1)); }
    });
    LB.key = (e) => {
      if (window.ctxmenu && window.ctxmenu.isOpen()) return;
      if (e.key === 'Escape') { e.stopPropagation(); closeViewer(); }
      else if (e.key === 'ArrowLeft') show(LB.i - 1);
      else if (e.key === 'ArrowRight') show(LB.i + 1);
    };
    document.addEventListener('keydown', LB.key, true);
    show(i);
  }

  /* ---------- standalone dialog for one task ---------- */
  function openFor(key, title) {
    key = String(key);
    const bg = document.createElement('div');
    bg.className = 'ev-modal';
    bg.innerHTML = '<div class="ev-card" role="dialog" aria-label="Evidence"><div class="ev-card-h"><h3>Evidence' + (title ? ': ' + esc(title) : '') + '</h3><button class="ev-b" data-x aria-label="Close">&times;</button></div><div id="evDlg"></div></div>';
    document.body.appendChild(bg);
    const close = () => { bg.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape' && !LB && !(window.ctxmenu && window.ctxmenu.isOpen())) { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    bg.addEventListener('pointerdown', (e) => { if (e.target === bg) close(); });
    $('[data-x]', bg).onclick = close;
    mount($('#evDlg', bg), key, {});
  }

  /* ---------- cards in the dashboard ---------- */
  function decorateCards() {
    $$('.task-card[data-k]').forEach((card) => {
      const key = card.dataset.k;
      let strip = $('.tc-ev', card);
      if (!strip) { strip = document.createElement('div'); strip.className = 'tc-ev'; card.appendChild(strip); }
      mount(strip, key, { compact: true, max: 4, hint: false });
    });
  }


  /* ---------- right-click menus ---------- */
  (window.__ctxProviders = window.__ctxProviders || []).push({
    name: 'evidence',
    build(t) {
      if (!t.closest) return null;
      const mi = (label, run, o) => Object.assign({ label, run }, o || {});
      const SEP = '-';
      const cp = (txt) => { if (window.ctxmenu) window.ctxmenu.copyText(txt); };
      const lb = t.closest('.ev-lb');
      if (lb && LB) {
        const k = LB.tkey, r = list(k)[LB.i];
        if (!r) return null;
        return [
          mi('Download', async () => { const b = await getBlob(r.id); if (b) download(r.name, b); }, { icon: 'dl' }),
          mi('Copy file name', () => cp(r.name), { icon: 'copy' }),
          SEP,
          mi('Delete this file…', async () => { if (confirm('Delete "' + r.name + '" from this task?')) { await remove(k, r.id); if (LB) { if (!list(k).length) closeViewer(); else openViewer(k, Math.min(LB.i, list(k).length - 1)); } } }, { icon: 'trash', danger: true }),
          mi('Close viewer', closeViewer, { icon: 'x' })
        ];
      }
      const box = t.closest('.ev-box');
      if (!box) return null;
      const k = box.dataset.evKey, th = t.closest('.ev-th[data-i]');
      if (th && !th.classList.contains('more')) {
        const i = +th.dataset.i || 0, r = list(k)[i];
        if (r) return [
          mi('Open', () => openViewer(k, i)),
          mi('Download', async () => { const b = await getBlob(r.id); if (b) download(r.name, b); }, { icon: 'dl' }),
          mi('Copy file name', () => cp(r.name), { icon: 'copy' }),
          SEP,
          mi('Delete…', async () => { if (confirm('Delete "' + r.name + '" from this task?')) await remove(k, r.id); }, { icon: 'trash', danger: true })
        ];
      }
      return [
        mi('Attach files…', () => pick(k), { icon: 'clip' }),
        mi('Paste screenshot from clipboard', () => pasteFromClipboard(k)),
        mi('Download all as .zip', () => downloadAll(k), { icon: 'dl', disabled: !list(k).length })
      ];
    }
  });

  /* ---------- hooks into the dashboard ---------- */
  function hook(name, after) {
    const orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function () { const r = orig.apply(this, arguments); try { after.apply(this, arguments); } catch (e) { /* decoration only */ } return r; };
  }
  hook('renderCardView', () => ready().then(decorateCards));
  hook('showSubtasks', () => {
    const modal = $('#subtasksModal .modal');
    if (!modal || typeof SUBTASKS_KEY === 'undefined') return;
    let sec = $('#subtasksEvidence', modal);
    if (!sec) {
      sec = document.createElement('div'); sec.id = 'subtasksEvidence'; sec.className = 'ev-sec';
      sec.innerHTML = '<div class="ev-sec-h">Evidence</div><div id="subtasksEvBox"></div>';
      const row = $('.row', modal); modal.insertBefore(sec, row);
    }
    mount($('#subtasksEvBox', sec), SUBTASKS_KEY, {});
  });
  ready().then(() => { if (typeof renderCardView === 'function') decorateCards(); });

  window.evidence = { ready, list, count: (k) => list(String(k)).length, add, remove, mount, openFor, openViewer, downloadAll, zipBlobs, decorateCards };
})();
