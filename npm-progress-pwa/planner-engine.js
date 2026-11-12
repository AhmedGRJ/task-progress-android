/* Planner engine: pure functions (no DOM, no dashboard globals) so it can be tested on its own.
   Times are epoch milliseconds, local time. Slots are 15 minutes. */
(function (root) {
  'use strict';
  const MIN = 60000, DAY = 86400000, SLOT = 15 * MIN;

  /* ---------- dates ---------- */
  const sod = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => { d = new Date(d); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const fromYmd = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const hm = (s) => { const p = String(s || '0:0').split(':'); return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0); };
  const atMin = (day, mins) => { const x = new Date(day); x.setHours(0, 0, 0, 0); x.setMinutes(mins); return x.getTime(); };
  const ceil15 = (ms) => Math.ceil(ms / SLOT) * SLOT;
  const floor15 = (ms) => Math.floor(ms / SLOT) * SLOT;
  const round15m = (m) => Math.max(15, Math.ceil(m / 15) * 15);

  /* ---------- recurrence ---------- */
  // rule: {repeat:'daily'|'workdays'|'weekly'|'monthly', interval, byday:[0-6], until:ms|null}
  function matchRule(r, startDay, d, S) {
    const iv = Math.max(1, r.interval || 1);
    if (d < startDay) return false;
    if (r.until && d.getTime() > r.until) return false;
    const diffDays = Math.round((d - startDay) / DAY);
    switch (r.repeat) {
      case 'daily': return diffDays % iv === 0;
      case 'workdays': return S.days.includes(d.getDay());
      case 'weekly': {
        const by = r.byday && r.byday.length ? r.byday : [startDay.getDay()];
        if (!by.includes(d.getDay())) return false;
        const wk0 = addDays(startDay, -((startDay.getDay() - S.weekStart + 7) % 7));
        const wk = Math.floor(Math.round((sod(d) - wk0) / DAY) / 7);
        return wk % iv === 0;
      }
      case 'monthly': {
        const md = (d.getFullYear() - startDay.getFullYear()) * 12 + d.getMonth() - startDay.getMonth();
        return d.getDate() === startDay.getDate() && md % iv === 0;
      }
      default: return false;
    }
  }

  // Occurrences of an event overlapping [from, to).
  function occurrences(ev, from, to, S) {
    const out = [], dur = ev.end - ev.start, skip = ev.skip || [];
    const mk = (s) => { const k = ymd(s); if (!skip.includes(k)) out.push({ id: ev.id, key: ev.id + '@' + k, s, e: s + dur, ev }); };
    if (!ev.repeat || ev.repeat === 'none') { if (ev.end > from && ev.start < to) mk(ev.start); return out; }
    const startDay = sod(ev.start), tod = ev.start - startDay.getTime();
    let d = ev.count ? startDay : sod(Math.max(ev.start, from - dur - DAY));
    if (d < startDay) d = startDay;
    let n = 0;
    for (; d.getTime() < to; d = addDays(d, 1)) {
      if (!matchRule(ev, startDay, d, S)) continue;
      n++;
      if (ev.count && n > ev.count) break;
      const s = ev.allDay ? d.getTime() : atMin(d, Math.round(tod / MIN));
      if (s + dur > from && s < to) mk(s);
    }
    return out;
  }

  /* ---------- free time ---------- */
  function dayWindows(day, S) {
    if (!S.days.includes(day.getDay())) return [];
    const ws = hm(S.workStart), we = hm(S.workEnd);
    if (we <= ws) return [];
    if (S.lunch) {
      const ls = hm(S.lunchStart), le = hm(S.lunchEnd);
      if (ls > ws && le < we && le > ls) return [[atMin(day, ws), atMin(day, ls)], [atMin(day, le), atMin(day, we)]];
    }
    return [[atMin(day, ws), atMin(day, we)]];
  }

  function subtract(free, busy) {
    const out = [];
    for (const f of free) {
      let cur = f[0];
      const e0 = f[1];
      for (const b of busy) {
        if (b[1] <= cur) continue;
        if (b[0] >= e0) break;
        if (b[0] > cur) out.push([cur, b[0]]);
        cur = Math.max(cur, b[1]);
        if (cur >= e0) break;
      }
      if (cur < e0) out.push([cur, e0]);
    }
    return out;
  }

  function buildFree(startMs, days, S, busy) {
    const free = [];
    let d = sod(startMs);
    for (let i = 0; i < days; i++, d = addDays(d, 1)) {
      for (const w of dayWindows(d, S)) {
        const s = Math.max(w[0], startMs);
        if (w[1] - s >= SLOT) free.push([s, w[1]]);
      }
    }
    return subtract(free, busy).filter((x) => x[1] - x[0] >= SLOT);
  }

  /* ---------- scheduler ---------- */
  // item: {key, remaining(min), deadline(ms|null), notBefore(ms|null), pri(0 high..2 low), minChunk, maxChunk, ord}
  function place(items, free0, boosted, S) {
    const fr = free0.map((a) => a.slice());
    const buf = S.buffer * MIN, BIG = 8.64e15;
    const blocks = [], risk = new Set(), unsched = [];
    const order = items.slice().sort((a, b) => {
      const x = boosted.has(a.key), y = boosted.has(b.key);
      if (x !== y) return x ? -1 : 1;
      if (x) return (a.deadline || BIG) - (b.deadline || BIG) || a.pri - b.pri || a.ord - b.ord;
      return a.pri - b.pri || (a.deadline || BIG) - (b.deadline || BIG) || a.ord - b.ord;
    });
    for (const it of order) {
      let r = it.remaining;
      if (r <= 0) continue;
      const minC = Math.max(15, Math.min(it.minChunk || S.minChunk, r));
      const maxC = Math.max(minC, it.maxChunk || S.maxChunk);
      let guard = 0;
      while (r > 0 && guard++ < 200) {
        let found = -1, s = 0, len = 0;
        for (let i = 0; i < fr.length; i++) {
          let fs = fr[i][0];
          const fe = fr[i][1];
          if (it.notBefore && fe <= it.notBefore) continue;
          if (it.notBefore && fs < it.notBefore) fs = it.notBefore;
          if (it.hardEnd && fs >= it.hardEnd) continue;
          const l = Math.floor(((it.hardEnd ? Math.min(fe, it.hardEnd) : fe) - fs) / SLOT) * 15;
          if (l >= minC) { found = i; s = fs; len = l; break; }
        }
        if (found < 0) break;
        let take = Math.min(r, maxC, len);
        const rem = r - take;
        if (rem > 0 && rem < minC) { const adj = take - (minC - rem); if (adj >= minC) take = adj; }
        if (it.deadline && s < it.deadline && s + take * MIN > it.deadline) {
          const t2 = Math.floor((it.deadline - s) / SLOT) * 15;
          if (t2 >= 15) take = Math.min(take, t2);
        }
        const e = s + take * MIN;
        const late = !!(it.deadline && e > it.deadline);
        blocks.push({ key: it.key, s, e, pin: false, late });
        if (late) risk.add(it.key);
        const os = fr[found][0], oe = fr[found][1], repl = [];
        if (s - os >= SLOT) repl.push([os, s]);
        if (oe - (e + buf) >= SLOT) repl.push([e + buf, oe]);
        fr.splice(found, 1, ...repl);
        r -= take;
      }
      if (r > 0) { unsched.push({ key: it.key, remaining: r }); if (it.deadline) risk.add(it.key); }
    }
    blocks.sort((a, b) => a.s - b.s);
    return { blocks, risk, unsched };
  }

  // opts: {items, events, pinned:[{s,e}], settings, now, horizonDays}
  function schedule(opts) {
    const S = opts.settings, days = opts.horizonDays || 56;
    const start = ceil15(opts.now), to = addDays(sod(start), days).getTime();
    const buf = S.buffer * MIN, busy = [];
    (opts.events || []).forEach((ev) => {
      if (ev.blocks === false) return;
      occurrences(ev, start, to, S).forEach((o) => busy.push(ev.allDay ? [o.s, o.e] : [o.s - buf, o.e + buf]));
    });
    (opts.pinned || []).forEach((p) => { if (p.e > start) busy.push([p.s, p.e + buf]); });
    busy.sort((a, b) => a[0] - b[0]);
    const free = buildFree(start, days, S, busy);
    const byKey = {};
    opts.items.forEach((i) => { byKey[i.key] = i; });
    const boosted = new Set();
    let res = place(opts.items, free, boosted, S);
    for (let k = 0; k < 6; k++) {
      const nm = [...res.risk].filter((x) => byKey[x].deadline && !boosted.has(x));
      if (!nm.length) break;
      nm.forEach((x) => boosted.add(x));
      res = place(opts.items, free, boosted, S);
    }
    return res;
  }

  /* ---------- ICS ---------- */
  const DAYCODE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const icsStamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const icsDate = (ms) => ymd(ms).replace(/-/g, '');
  const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const icsUnesc = (s) => String(s || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
  function fold(line) {
    const out = [];
    while (line.length > 73) { out.push(line.slice(0, 73)); line = ' ' + line.slice(73); }
    out.push(line);
    return out.join('\r\n');
  }

  // opts: {events, blocks:[{key,s,e}], titleOf(key), settings, now}
  function buildIcs(opts) {
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Task Progress//Planner//EN', 'CALSCALE:GREGORIAN'];
    if (opts.name) L.push('X-WR-CALNAME:' + icsEsc(opts.name), 'NAME:' + icsEsc(opts.name));
    if (opts.refreshMinutes) L.push('REFRESH-INTERVAL;VALUE=DURATION:PT' + opts.refreshMinutes + 'M', 'X-PUBLISHED-TTL:PT' + opts.refreshMinutes + 'M');
    const stamp = icsStamp(opts.now || Date.now());
    (opts.events || []).forEach((ev) => {
      L.push('BEGIN:VEVENT', 'UID:' + (ev.uid || ev.id + '@task-progress'), 'DTSTAMP:' + stamp);
      if (ev.allDay) L.push('DTSTART;VALUE=DATE:' + icsDate(ev.start), 'DTEND;VALUE=DATE:' + icsDate(ev.end));
      else L.push('DTSTART:' + icsStamp(ev.start), 'DTEND:' + icsStamp(ev.end));
      L.push('SUMMARY:' + icsEsc(ev.title));
      if (ev.repeat && ev.repeat !== 'none') {
        const f = ev.repeat === 'workdays' ? 'WEEKLY' : ev.repeat.toUpperCase();
        let r = 'FREQ=' + f;
        if (ev.interval > 1 && ev.repeat !== 'workdays') r += ';INTERVAL=' + ev.interval;
        if (ev.repeat === 'workdays') r += ';BYDAY=' + (opts.settings.days.map((d) => DAYCODE[d]).join(',') || 'MO,TU,WE,TH,FR');
        else if (ev.repeat === 'weekly' && ev.byday && ev.byday.length) r += ';BYDAY=' + ev.byday.map((d) => DAYCODE[d]).join(',');
        if (ev.until) r += ';UNTIL=' + icsDate(ev.until);
        if (ev.count) r += ';COUNT=' + ev.count;
        L.push('RRULE:' + r);
      }
      (ev.skip || []).forEach((k) => L.push('EXDATE' + (ev.allDay ? ';VALUE=DATE' : '') + ':' + (ev.allDay ? k.replace(/-/g, '') : icsStamp(atMin(fromYmd(k), (new Date(ev.start).getHours() * 60 + new Date(ev.start).getMinutes()))))));
      L.push('END:VEVENT');
    });
    (opts.blocks || []).forEach((b) => {
      L.push('BEGIN:VEVENT', 'UID:' + b.key + '-' + b.s + '@task-progress', 'DTSTAMP:' + stamp,
        'DTSTART:' + icsStamp(b.s), 'DTEND:' + icsStamp(b.e), 'SUMMARY:' + icsEsc(opts.hideTitles ? 'Busy (task)' : 'Task: ' + (opts.titleOf ? opts.titleOf(b.key) : b.key)),
        'TRANSP:OPAQUE', 'END:VEVENT');
    });
    L.push('END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }

  function parseIcsTime(val, params) {
    const v = String(val || '').trim();
    if (/VALUE=DATE(?!-)/.test(params) || /^\d{8}$/.test(v)) {
      const m = /^(\d{4})(\d{2})(\d{2})/.exec(v);
      return m ? { ms: new Date(+m[1], +m[2] - 1, +m[3]).getTime(), date: true } : null;
    }
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)/.exec(v);
    if (!m) return null;
    const a = [+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)];
    return { ms: m[7] ? Date.UTC(...a) : new Date(...a).getTime(), date: false };
  }

  function parseIcs(text) {
    const lines = String(text || '').replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
    const events = [];
    let cur = null;
    for (const raw of lines) {
      if (raw === 'BEGIN:VEVENT') { cur = { props: [] }; continue; }
      if (raw === 'END:VEVENT') {
        if (cur) { const ev = icsToEvent(cur.props); if (ev) events.push(ev); }
        cur = null; continue;
      }
      if (!cur) continue;
      const i = raw.indexOf(':');
      if (i < 0) continue;
      const head = raw.slice(0, i), value = raw.slice(i + 1);
      const sc = head.indexOf(';');
      cur.props.push({ name: (sc < 0 ? head : head.slice(0, sc)).toUpperCase(), params: sc < 0 ? '' : head.slice(sc + 1).toUpperCase(), value });
    }
    return events;
  }

  function icsToEvent(props) {
    const get = (n) => props.find((p) => p.name === n);
    const ds = get('DTSTART');
    if (!ds) return null;
    const st = parseIcsTime(ds.value, ds.params);
    if (!st) return null;
    let end = null;
    const de = get('DTEND'), du = get('DURATION');
    if (de) { const t = parseIcsTime(de.value, de.params); if (t) end = t.ms; }
    else if (du) {
      const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/.exec(du.value);
      if (m) end = st.ms + ((+m[1] || 0) * 7 * 1440 + (+m[2] || 0) * 1440 + (+m[3] || 0) * 60 + (+m[4] || 0)) * MIN;
    }
    if (!end || end <= st.ms) end = st.date ? addDays(st.ms, 1).getTime() : st.ms + 60 * MIN;
    const ev = { id: 'ics' + Math.random().toString(36).slice(2, 9), uid: (get('UID') || {}).value || null, title: icsUnesc((get('SUMMARY') || {}).value || '(no title)'), start: st.ms, end, allDay: st.date, blocks: st.date ? false : true, color: '#0284C7', repeat: 'none', interval: 1, byday: [], until: null, count: 0, skip: [] };
    const rr = get('RRULE');
    if (rr) {
      const r = {};
      rr.value.split(';').forEach((kv) => { const [k, v] = kv.split('='); r[k] = v; });
      const f = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly' }[r.FREQ];
      if (f) {
        ev.repeat = f; ev.interval = parseInt(r.INTERVAL, 10) || 1; ev.count = parseInt(r.COUNT, 10) || 0;
        if (r.UNTIL) { const u = parseIcsTime(r.UNTIL, ''); if (u) ev.until = sod(u.ms).getTime(); }
        if (f === 'weekly' && r.BYDAY) ev.byday = r.BYDAY.split(',').map((x) => DAYCODE.indexOf(x.replace(/[^A-Z]/g, ''))).filter((x) => x >= 0);
      }
    }
    props.filter((p) => p.name === 'EXDATE').forEach((p) => p.value.split(',').forEach((v) => { const t = parseIcsTime(v, p.params); if (t) ev.skip.push(ymd(t.ms)); }));
    return ev;
  }

  const api = { MIN, DAY, SLOT, sod, addDays, ymd, fromYmd, hm, atMin, ceil15, floor15, round15m, matchRule, occurrences, dayWindows, subtract, buildFree, place, schedule, buildIcs, parseIcs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PlannerEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
