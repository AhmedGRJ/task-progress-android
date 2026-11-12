/* sync-core.js: sync engine shared by every build (browser, Electron, Tauri, Android) and the relay server.
 *
 * Model
 *  - The app's data is split into small "items" (one task row, one planner event, one note ...).
 *  - Every item has a timestamp t (hybrid logical clock, so a wrong phone clock cannot make old edits win),
 *    the device that wrote it (by), and an optional tombstone flag (d) for deletions.
 *  - Merging is per item, last writer wins. Two devices editing DIFFERENT tasks never overwrite each other.
 *  - A scan compares the data in storage with the hashes seen at the last sync to find local edits,
 *    so the rest of the app does not need to know that sync exists.
 *  - Values can be end-to-end encrypted (AES-GCM, key from a passphrase) before they leave the device.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SyncCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TOMB_TTL = 90 * 24 * 3600 * 1000;
  const STATE_KEY = 'sync-state-v1';

  /* ---------- helpers ---------- */
  function stable(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }
  function hash(str) { // cyrb53
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const rid = (n) => {
    let s = '';
    const c = (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
    if (c && c.getRandomValues) { const a = new Uint8Array(n); c.getRandomValues(a); for (const b of a) s += (b % 36).toString(36); return s; }
    while (s.length < n) s += Math.random().toString(36).slice(2);
    return s.slice(0, n);
  };
  // does remote record r beat local record l ?
  const wins = (r, l) => !l || r.t > l.t || (r.t === l.t && String(r.by) > String(l.by));

  /* ---------- adapters: how each stored key maps to items ---------- */
  const rowObj = (headers, row) => { const o = {}; headers.forEach((h, i) => { o[h] = row[i] === undefined ? null : row[i]; }); return o; };

  function taskUids(parsed, ids) { // stable hidden id for each row, keyed by its Index value
    const hi = parsed.headers.indexOf('Index'), seen = {}, map = {}, uids = [];
    parsed.rows.forEach((row, i) => {
      const idx = hi >= 0 ? String(row[hi]) : String(i + 1);
      const n = (seen[idx] = (seen[idx] || 0) + 1), mk = n > 1 ? idx + '#' + n : idx;
      const uid = (ids && ids[mk]) || rid(8);
      map[mk] = uid; uids.push(uid);
    });
    return { map, uids };
  }

  const ADAPTERS = [
    {
      id: 'tasks', key: 'npm-tasks-v2', prefixes: ['row:'],
      read(parsed, ctx) {
        const out = {};
        if (!parsed || !Array.isArray(parsed.rows) || !Array.isArray(parsed.headers)) return out;
        const { map, uids } = taskUids(parsed, ctx.ids.tasks);
        ctx.ids.tasks = map;
        parsed.rows.forEach((row, i) => { out['row:' + uids[i]] = rowObj(parsed.headers, row); });
        return out;
      },
      write(parsed, changes, ctx) {
        const out = parsed && Array.isArray(parsed.rows) ? Object.assign({}, parsed, { headers: parsed.headers.slice(), rows: parsed.rows.map((r) => r.slice()) }) : { headers: [], rows: [] };
        const headers = out.headers, rows = out.rows;
        const uids = taskUids(out, ctx.ids.tasks).uids;
        const touched = [];
        Object.keys(changes).forEach((k) => {
          const ch = changes[k], uid = k.slice(4), i = uids.indexOf(uid);
          if (ch.d) { if (i >= 0) { rows.splice(i, 1); uids.splice(i, 1); } return; }
          Object.keys(ch.v || {}).forEach((h) => { if (headers.indexOf(h) < 0) headers.push(h); }); // a column added on another device
          rows.forEach((r) => { while (r.length < headers.length) r.push(null); });
          const arr = headers.map((h, c) => (h in ch.v ? ch.v[h] : (i >= 0 ? rows[i][c] : null)));
          if (i >= 0) rows[i] = arr; else { rows.push(arr); uids.push(uid); }
        });
        // two devices may have given different tasks the same Index while offline: the larger id yields and is renumbered
        const hi = headers.indexOf('Index');
        if (hi >= 0) {
          const groups = {};
          rows.forEach((r, i) => { (groups[String(r[hi])] = groups[String(r[hi])] || []).push(i); });
          let max = Math.max(0, ...rows.map((r) => Number(r[hi]) || 0));
          Object.keys(groups).forEach((g) => {
            const g2 = groups[g];
            if (g2.length < 2) return;
            g2.sort((a, b) => (uids[a] < uids[b] ? -1 : 1));
            g2.slice(1).forEach((i) => { rows[i][hi] = ++max; touched.push('row:' + uids[i]); });
          });
        }
        const nm = {}, seen = {};
        rows.forEach((r, i) => { const idx = hi >= 0 ? String(r[hi]) : String(i + 1); const n = (seen[idx] = (seen[idx] || 0) + 1); nm[n > 1 ? idx + '#' + n : idx] = uids[i]; });
        ctx.ids.tasks = nm;
        return { parsed: out, touched };
      },
      wipe(parsed) { return Object.assign({}, parsed || { headers: [] }, { rows: [] }); }
    },
    mapAdapter('subtasks', 'subtasks', 'st:'),
    {
      id: 'notes', key: 'notes-journal', prefixes: ['nt:'],
      read(parsed) { const o = {}; (Array.isArray(parsed) ? parsed : []).forEach((n) => { if (n && n.id) o['nt:' + n.id] = n; }); return o; },
      write(parsed, changes) {
        const list = Array.isArray(parsed) ? parsed.slice() : [];
        Object.keys(changes).forEach((k) => {
          const id = k.slice(3), i = list.findIndex((n) => n && n.id === id), ch = changes[k];
          if (ch.d) { if (i >= 0) list.splice(i, 1); } else if (i >= 0) list[i] = ch.v; else list.push(ch.v);
        });
        list.sort((a, b) => String((b && b.date) || '').localeCompare(String((a && a.date) || '')));
        return { parsed: list, touched: [] };
      },
      wipe() { return []; }
    },
    {
      id: 'planner', key: 'planner-v1', prefixes: ['ev:', 'rc:', 'mt:', 'do:', 'pls'],
      read(p) {
        const o = {};
        if (!p || typeof p !== 'object') return o;
        (p.events || []).forEach((e) => { if (e && e.id) o['ev:' + e.id] = e; });
        (p.recurring || []).forEach((e) => { if (e && e.id) o['rc:' + e.id] = e; });
        Object.keys(p.meta || {}).forEach((k) => { o['mt:' + k] = p.meta[k]; });
        Object.keys(p.doneOcc || {}).forEach((k) => { o['do:' + k] = p.doneOcc[k]; });
        if (p.settings) { const s = Object.assign({}, p.settings); delete s.feed; o.pls = s; }
        return o;
      },
      write(p, changes) {
        const o = Object.assign({ events: [], recurring: [], meta: {}, doneOcc: {}, past: [], autoBlocks: [], settings: {} }, clone(p) || {});
        Object.keys(changes).forEach((k) => {
          const ch = changes[k], pre = k.slice(0, 3), id = k.slice(3);
          if (k === 'pls') { if (!ch.d) o.settings = Object.assign({}, o.settings, ch.v, { feed: (o.settings || {}).feed }); return; }
          if (pre === 'ev:' || pre === 'rc:') {
            const arr = pre === 'ev:' ? o.events : o.recurring, i = arr.findIndex((e) => e && e.id === id);
            if (ch.d) { if (i >= 0) arr.splice(i, 1); } else if (i >= 0) arr[i] = ch.v; else arr.push(ch.v);
          } else {
            const m = pre === 'mt:' ? o.meta : o.doneOcc;
            if (ch.d) delete m[id]; else m[id] = ch.v;
          }
        });
        return { parsed: o, touched: [] };
      },
      wipe(p) { return Object.assign({}, p || {}, { events: [], recurring: [], meta: {}, doneOcc: {} }); }
    }
  ];

  function mapAdapter(id, key, prefix) {
    return {
      id, key, prefixes: [prefix],
      read(p) { const o = {}; if (p && typeof p === 'object' && !Array.isArray(p)) Object.keys(p).forEach((k) => { o[prefix + k] = p[k]; }); return o; },
      write(p, changes) {
        const m = Object.assign({}, p && typeof p === 'object' && !Array.isArray(p) ? p : {});
        Object.keys(changes).forEach((k) => { const key2 = k.slice(prefix.length); if (changes[k].d) delete m[key2]; else m[key2] = changes[k].v; });
        return { parsed: m, touched: [] };
      },
      wipe() { return {}; }
    };
  }

  /* ---------- optional end-to-end encryption ---------- */
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };

  async function makeCipher(pass, group) {
    const subtle = typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle;
    if (!subtle) throw new Error('Encryption needs a secure page (https or localhost).');
    const te = new TextEncoder(), td = new TextDecoder();
    const base = await subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveKey']);
    const key = await subtle.deriveKey({ name: 'PBKDF2', salt: te.encode('task-progress-sync/v1/' + (group || '')), iterations: 150000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return {
      async enc(k, v) {
        const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
        const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(k) }, key, te.encode(JSON.stringify(v))));
        const all = new Uint8Array(12 + ct.length); all.set(iv); all.set(ct, 12);
        return b64(all);
      },
      async dec(k, s) {
        const all = unb64(s);
        const pt = await subtle.decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12), additionalData: te.encode(k) }, key, all.subarray(12));
        return JSON.parse(td.decode(pt));
      }
    };
  }
  async function encodeItem(it, cipher) {
    const w = { k: it.k, t: it.t, by: it.by };
    if (it.d) { w.d = 1; return w; }
    if (cipher) w.e = await cipher.enc(it.k, it.v); else w.v = it.v;
    return w;
  }
  async function decodeItem(w, cipher) {
    const it = { k: w.k, t: w.t, by: w.by };
    if (w.d) { it.d = 1; return it; }
    if (w.e !== undefined) {
      if (!cipher) throw new Error('The other device uses a sync passphrase. Enter the same passphrase here.');
      try { it.v = await cipher.dec(w.k, w.e); } catch (e) { throw new Error('Wrong sync passphrase (cannot decrypt the data).'); }
    } else {
      if (cipher) throw new Error('The other device does not use a passphrase, but this one does. Use the same setting on both.');
      it.v = w.v;
    }
    return it;
  }

  /* ---------- engine ---------- */
  class Engine {
    // storage: { get(key) -> string|null, set(key, string) }  (async)
    constructor(storage, opts) {
      this.st = storage; this.opts = opts || {};
      this.adapters = this.opts.adapters || ADAPTERS;
      this.state = { dev: rid(10), clock: 0, items: {}, ids: { tasks: {} }, remotes: {}, lastSync: 0 };
      this.cur = {};
    }
    async load() {
      try { const s = await this.st.get(STATE_KEY); if (s) this.state = Object.assign(this.state, JSON.parse(s)); } catch (e) { /* first run */ }
      this.state.ids = this.state.ids || { tasks: {} };
      this.state.remotes = this.state.remotes || {};
      return this;
    }
    async persist() { await this.st.set(STATE_KEY, JSON.stringify(this.state)); }
    dev() { return this.state.dev; }
    tick() { this.state.clock = Math.max(Date.now(), this.state.clock + 1); return this.state.clock; }

    async readAll() {
      const cur = {};
      for (const a of this.adapters) {
        let parsed = null;
        try { const s = await this.st.get(a.key); parsed = s ? JSON.parse(s) : null; } catch (e) { parsed = null; }
        Object.assign(cur, a.read(parsed, this.state));
      }
      return cur;
    }
    // find local edits and deletions since the last scan
    async scan() {
      const S = this.state, cur = await this.readAll(), now = Date.now();
      let changed = 0;
      Object.keys(cur).forEach((k) => {
        const h = hash(stable(cur[k])), r = S.items[k];
        if (!r || r.d || r.h !== h) { S.items[k] = { t: this.tick(), by: S.dev, h, dirty: 1 }; changed++; }
      });
      Object.keys(S.items).forEach((k) => {
        const r = S.items[k];
        if (r.d) { if (now - r.t > TOMB_TTL && !r.dirty) delete S.items[k]; return; }
        if (!(k in cur) && this.adapterFor(k)) { S.items[k] = { t: this.tick(), by: S.dev, d: 1, dirty: 1 }; changed++; }
      });
      this.cur = cur;
      return changed;
    }
    adapterFor(k) { return this.adapters.find((a) => a.prefixes.some((p) => k === p || k.indexOf(p) === 0)); }

    outgoing() {
      const out = [];
      Object.keys(this.state.items).forEach((k) => {
        const r = this.state.items[k];
        if (!r.dirty) return;
        if (r.d) out.push({ k, t: r.t, by: r.by, d: 1 });
        else if (k in this.cur) out.push({ k, t: r.t, by: r.by, v: this.cur[k] });
      });
      return out;
    }
    fullState() { // every live item and tombstone with its current value (for file based transports)
      const out = [];
      Object.keys(this.state.items).forEach((k) => {
        const r = this.state.items[k];
        if (r.d) out.push({ k, t: r.t, by: r.by, d: 1 });
        else if (k in this.cur) out.push({ k, t: r.t, by: r.by, v: this.cur[k] });
      });
      return out;
    }
    markPushed(list) {
      list.forEach((it) => { const r = this.state.items[it.k]; if (r && r.t === it.t && r.by === it.by) r.dirty = 0; });
    }
    markAllDirty() { Object.keys(this.state.items).forEach((k) => { this.state.items[k].dirty = 1; }); }

    // apply items that arrived from another device; returns {count, adapters}
    async applyIncoming(list) {
      const S = this.state, byAdapter = {};
      let count = 0;
      list.forEach((it) => {
        if (!it || !it.k || typeof it.t !== 'number') return;
        const a = this.adapterFor(it.k);
        if (!a) return; // unknown kind of item (newer app version): ignore
        S.clock = Math.max(S.clock, it.t);
        const l = S.items[it.k];
        if (!wins(it, l)) return;
        // identical to what is already here: just adopt the newer stamp
        if (l && !l.d && !it.d && l.h === hash(stable(it.v))) { S.items[it.k] = { t: it.t, by: it.by, h: l.h, dirty: 0 }; return; }
        if (l && l.d && it.d) { S.items[it.k] = { t: it.t, by: it.by, d: 1, dirty: 0 }; return; }
        S.items[it.k] = it.d ? { t: it.t, by: it.by, d: 1, dirty: 0 } : { t: it.t, by: it.by, h: hash(stable(it.v)), dirty: 0 };
        (byAdapter[a.id] = byAdapter[a.id] || {})[it.k] = it.d ? { d: 1 } : { v: it.v };
        count++;
      });
      const ids = Object.keys(byAdapter);
      for (const a of this.adapters.filter((x) => byAdapter[x.id])) {
        let parsed = null;
        try { const s = await this.st.get(a.key); parsed = s ? JSON.parse(s) : null; } catch (e) { parsed = null; }
        const res = a.write(parsed, byAdapter[a.id], this.state);
        await this.st.set(a.key, JSON.stringify(res.parsed));
        // what was really stored is now "in sync"; items the adapter had to change further (renumbered rows) stay dirty-able
        const now = a.read(res.parsed, this.state), touched = new Set(res.touched || []);
        Object.keys(byAdapter[a.id]).forEach((k) => {
          const r = S.items[k];
          if (r && !r.d && k in now && !touched.has(k)) r.h = hash(stable(now[k]));
        });
        Object.assign(this.cur, now);
      }
      if (ids.length && this.opts.onApplied) await this.opts.onApplied(ids);
      return { count, adapters: ids };
    }

    // first sync of a device that should take over the data of the other devices
    async wipeLocal() {
      for (const a of this.adapters) {
        let parsed = null;
        try { const s = await this.st.get(a.key); parsed = s ? JSON.parse(s) : null; } catch (e) { parsed = null; }
        if (parsed !== null || a.id !== 'tasks') await this.st.set(a.key, JSON.stringify(a.wipe(parsed)));
      }
      this.state.items = {}; this.state.ids = { tasks: {} }; this.cur = {};
      await this.persist();
    }
    getRemote(id) { return this.state.remotes[id] || { seq: 0, epoch: '' }; }
    setRemote(id, v) { this.state.remotes[id] = v; }
  }

  /* ---------- transports ---------- */
  const relayId = (url) => 'relay:' + hash(String(url).replace(/\/+$/, ''));

  // Relay / hub: POST {dev, since, epoch, items} -> {seq, epoch, items}
  async function syncRelay(engine, cfg, fetchFn, cipher) {
    const base = String(cfg.url).replace(/\/+$/, ''), id = relayId(base), rem = engine.getRemote(id);
    await engine.scan();
    const out = engine.outgoing();
    const wire = [];
    for (const it of out) wire.push(await encodeItem(it, cipher));
    const res = await fetchFn(base + '/v1/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (cfg.token || '') },
      body: JSON.stringify({ dev: engine.dev(), since: rem.seq || 0, epoch: rem.epoch || '', items: wire })
    });
    if (res.status === 401) throw new Error('The server refused the token.');
    if (!res.ok) throw new Error('Server answered ' + res.status);
    const body = await res.json();
    if (rem.epoch && body.epoch && rem.epoch !== body.epoch) { // the server was reset: send everything again
      engine.markAllDirty(); engine.setRemote(id, { seq: 0, epoch: body.epoch }); await engine.persist();
      return syncRelay(engine, cfg, fetchFn, cipher);
    }
    const incoming = [];
    for (const w of body.items || []) incoming.push(await decodeItem(w, cipher));
    const r = await engine.applyIncoming(incoming);
    engine.markPushed(out);
    engine.setRemote(id, { seq: body.seq, epoch: body.epoch });
    engine.state.lastSync = Date.now();
    await engine.persist();
    return { pushed: out.length, pulled: r.count };
  }

  // How many items does the remote already hold? (used to avoid duplicating data when a new device joins)
  async function probeRelay(cfg, fetchFn) {
    const base = String(cfg.url).replace(/\/+$/, '');
    const res = await fetchFn(base + '/v1/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (cfg.token || '') }, body: JSON.stringify({ dev: 'probe', since: 0, epoch: '', items: [], countOnly: true }) });
    if (res.status === 401) throw new Error('The server refused the token.');
    if (!res.ok) throw new Error('Server answered ' + res.status);
    const b = await res.json();
    return b.count || 0;
  }

  // Document based (WebDAV or a file in a shared folder): io.get() -> {text, etag}, io.put(text, etag) -> {ok, conflict}
  async function syncDoc(engine, io, cipher, idKey) {
    const id = 'doc:' + idKey;
    for (let attempt = 0; attempt < 4; attempt++) {
      await engine.scan();
      const got = await io.get();
      const remote = got.text ? JSON.parse(got.text) : { v: 1, items: {} };
      const rItems = remote.items || {}, incoming = [];
      for (const k of Object.keys(rItems)) incoming.push(await decodeItem(Object.assign({ k }, rItems[k]), cipher));
      const applied = await engine.applyIncoming(incoming);
      await engine.scan(); // renumbered rows etc.
      const doc = { v: 1, items: {} };
      let needPut = false;
      const local = engine.fullState();
      for (const k of Object.keys(rItems)) doc.items[k] = rItems[k];
      for (const it of local) {
        const r = rItems[it.k];
        if (!r || wins(it, r)) {
          if (r && r.t === it.t && String(r.by) === String(it.by)) continue;
          const w = await encodeItem(it, cipher); delete w.k; doc.items[it.k] = w; needPut = true;
        }
      }
      const now = Date.now();
      Object.keys(doc.items).forEach((k) => { if (doc.items[k].d && now - doc.items[k].t > TOMB_TTL) { delete doc.items[k]; needPut = true; } });
      if (needPut || !got.text) {
        const res = await io.put(JSON.stringify(doc), got.etag);
        if (res.conflict) continue;
        if (!res.ok) throw new Error('Could not write the sync file.');
      }
      engine.markPushed(local);
      engine.state.lastSync = Date.now();
      engine.setRemote(id, { seq: 0, epoch: '' });
      await engine.persist();
      return { pushed: needPut ? 1 : 0, pulled: applied.count };
    }
    throw new Error('The sync file kept changing; try again.');
  }
  async function probeDoc(io) { const g = await io.get(); if (!g.text) return 0; try { return Object.keys(JSON.parse(g.text).items || {}).length; } catch (e) { return 0; } }

  // WebDAV (Nextcloud, ownCloud, NAS ...)
  function davIO(cfg, fetchFn) {
    const url = String(cfg.url), auth = cfg.user ? 'Basic ' + b64(new TextEncoder().encode(cfg.user + ':' + (cfg.pass || ''))) : null;
    const hdr = (extra) => Object.assign({}, auth ? { Authorization: auth } : {}, extra || {});
    return {
      async get() {
        const r = await fetchFn(url, { method: 'GET', headers: hdr() });
        if (r.status === 404) return { text: null, etag: null };
        if (r.status === 401 || r.status === 403) throw new Error('The WebDAV server refused the login.');
        if (!r.ok) throw new Error('WebDAV answered ' + r.status);
        const text = await r.text();
        const etag = r.headers && r.headers.get ? r.headers.get('ETag') : (r.headers && r.headers.etag) || null;
        return { text, etag };
      },
      async put(text, etag) {
        const h = hdr({ 'Content-Type': 'application/json' });
        if (etag) h['If-Match'] = etag; else h['If-None-Match'] = '*';
        const r = await fetchFn(url, { method: 'PUT', headers: h, body: text });
        if (r.status === 412) return { conflict: true };
        return { ok: r.ok };
      }
    };
  }

  return { Engine, ADAPTERS, syncRelay, probeRelay, syncDoc, probeDoc, davIO, makeCipher, encodeItem, decodeItem, hash, stable, wins, relayId, STATE_KEY, TOMB_TTL };
});
