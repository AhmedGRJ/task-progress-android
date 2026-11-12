/* Planner tab: a Motion-style calendar for the dashboard's tasks.
   Reads/writes the same ROWS as the table; scheduling data (durations, pins, events…) lives in its own store key. */
(() => {
  'use strict';
  const E = window.PlannerEngine;
  if (!E || window.__planner) return;
  const { MIN, DAY, sod, addDays, ymd, fromYmd, hm, atMin, ceil15 } = E;

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (v) => (typeof escapeHtml === 'function' ? escapeHtml(v) : String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
  const pad2 = (n) => String(n).padStart(2, '0');
  const T = (ms) => { const d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
  const fmtDur = (m) => { m = Math.round(m); const h = Math.floor(m / 60), r = m % 60; return h ? (r ? h + 'h ' + r + 'm' : h + 'h') : r + 'm'; };
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const PAL = ['#3B82F6', '#E8833A', '#2FA66A', '#8B5CF6', '#E5484D', '#0EA5A4', '#C79A00', '#D6409F', '#64748B', '#0284C7'];
  const colorOf = (name) => { let h = 0; const s = String(name || '-'); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return PAL[h % PAL.length]; };
  const col = (n) => colIdx(n);
  const uid = () => Math.random().toString(36).slice(2, 9);

  const ic = (d, w) => '<svg viewBox="0 0 24 24" width="' + (w || 15) + '" height="' + (w || 15) + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const ICON = {
    cal: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
    l: '<path d="M15 6l-6 6 6 6"/>', r: '<path d="M9 6l6 6-6 6"/>',
    refresh: '<path d="M21 12a9 9 0 11-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', pin: '<path d="M12 17v5M9 3h6l-1 6 3 3H7l3-3z"/>',
    rep: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 01-3 3H3"/>',
    more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    side: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
    minus: '<path d="M5 12h14"/>',
    warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>', diamond: '<path d="M12 3l9 9-9 9-9-9z"/>'
  };

  /* ---------- state ---------- */
  const DEFAULTS = { workStart: '09:00', workEnd: '17:30', days: [0, 1, 2, 3, 4], lunch: true, lunchStart: '12:30', lunchEnd: '13:30', buffer: 5, defaultDur: 60, minChunk: 30, maxChunk: 120, auto: true, hourPx: 56, weekStart: 0, notify: false, sidebar: true, feed: { on: false, lan: false, port: 8765, token: '', titles: true } };
  const mkDefaults = () => JSON.parse(JSON.stringify(DEFAULTS));
  const feedCfg = () => Object.assign({}, DEFAULTS.feed, P.settings.feed || {});
  const P = {
    view: 'week', anchor: sod(new Date()), mini: sod(new Date()),
    events: [], meta: {}, recurring: [], past: [], doneOcc: {}, autoBlocks: [],
    settings: mkDefaults(), focus: null, loaded: false, planned: false, filter: { q: '', hidden: {} },
    items: {}, itemList: [], risk: new Set(), unsched: [], rowMap: new Map(), ready: false, dirty: true, listAll: false
  };
  const KEY = 'planner-v1';
  const STATUSES = ['Not Started', 'In Progress', 'Done', 'Suspended', 'Routine'];
  const OPEN_NOT = ['Done', 'Suspended', 'Routine'];

  async function load() {
    try {
      const r = await AppStorage.get(KEY, false);
      if (r && r.value) {
        const o = JSON.parse(r.value);
        P.events = o.events || []; P.meta = o.meta || {}; P.recurring = o.recurring || [];
        P.past = o.past || []; P.doneOcc = o.doneOcc || {}; P.autoBlocks = o.autoBlocks || [];
        Object.assign(P.settings, o.settings || {});
        P.settings.feed = Object.assign({}, DEFAULTS.feed, (o.settings || {}).feed || {});
        P.focus = o.focus || null;
        if (o.view) P.view = o.view;
      }
      if (window.innerWidth < 720 && !(r && r.value && JSON.parse(r.value).view)) P.view = 'day';
    } catch (e) { /* first run */ }
  }
  let saveT = null;
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      const cutoff = Date.now() - 60 * DAY;
      P.past = P.past.filter((p) => p.e > cutoff);
      try { AppStorage.set(KEY, JSON.stringify({ events: P.events, meta: P.meta, recurring: P.recurring, past: P.past, doneOcc: P.doneOcc, autoBlocks: P.autoBlocks, settings: P.settings, focus: P.focus, view: P.view }), false); } catch (e) { /* ignore */ }
    }, 250);
  }

  /* ---------- tasks ---------- */
  function refreshRowMap() {
    const m = new Map();
    if (typeof ROWS !== 'undefined' && Array.isArray(ROWS)) { const ic0 = col('Index'); ROWS.forEach((r, i) => m.set(String(r[ic0]), i)); }
    P.rowMap = m;
  }
  function info(key) {
    if (key.indexOf('r:') === 0) {
      const p = key.split(':'), rec = P.recurring.find((x) => x.id === p[1]);
      if (!rec) return null;
      return { key, kind: 'rec', title: rec.title, project: rec.project || '', status: P.doneOcc[key] ? 'Done' : 'Open', priority: rec.priority || 'Medium', rec, date: p[2], prog: 0 };
    }
    const i = P.rowMap.get(key);
    if (i == null) return null;
    const r = ROWS[i];
    return { key, kind: 'row', row: i, title: r[col('Task')] || r[col('Sub-Topic')] || '(untitled)', project: r[col('Project')] || r[col('Topic')] || '', status: r[col('Status')], priority: r[col('Priority')] || 'Medium', due: r[col('Due Date')], prog: Math.min(1, Math.max(0, Number(r[col('Progress %')]) || 0)) };
  }
  const isOpen = (key) => { const i = info(key); return !!i && !OPEN_NOT.includes(i.status) && i.status !== 'Done'; };
  const priRank = (p) => ({ High: 0, Medium: 1, Low: 2 }[p] != null ? { High: 0, Medium: 1, Low: 2 }[p] : 1);
  const durOf = (key, fallback) => (P.meta[key] && P.meta[key].dur) || fallback || P.settings.defaultDur;

  const focusOn = () => !!P.focus && (!P.focus.until || P.focus.until >= ymd(Date.now()));
  function matchSpec(spec, inf, r) {
    const has = (v, hay) => String(hay || '').toLowerCase().indexOf(String(v).toLowerCase()) >= 0;
    const topic = r ? r[col('Topic')] : '', sub = r ? r[col('Sub-Topic')] : '', proj = r ? r[col('Project')] : inf.project;
    let any = false;
    if (spec.topic) { any = true; if (!(has(spec.topic, topic) || has(spec.topic, sub))) return false; }
    if (spec.project) { any = true; if (!has(spec.project, proj)) return false; }
    if (spec.text) { any = true; if (!(has(spec.text, inf.title) || has(spec.text, topic) || has(spec.text, sub) || has(spec.text, proj))) return false; }
    return any;
  }
  const focusHit = (inf, r) => focusOn() && matchSpec(P.focus, inf, r);
  const focusLabel = () => [P.focus.topic, P.focus.project, P.focus.text].filter(Boolean).join(' / ');

  function buildItems(now) {
    const S = P.settings, items = [], start = ceil15(now);
    const pinnedMin = (key) => ((P.meta[key] && P.meta[key].pinned) || []).filter((p) => p.e > now).reduce((a, p) => a + (p.e - p.s) / MIN, 0);
    const mk = (key, o) => {
      const m = P.meta[key] || {};
      const rem = Math.max(0, o.base - pinnedMin(key));
      const it = { key, ord: items.length, pri: o.focus ? -1 : priRank(o.priority), remaining: Math.ceil(rem / 15) * 15, left: Math.ceil(Math.max(0, o.base) / 15) * 15, deadline: o.deadline, hardEnd: o.hardEnd || null, notBefore: o.notBefore, minChunk: m.minChunk || S.minChunk, maxChunk: m.maxChunk || S.maxChunk, hard: !!m.hard, manual: !!m.manual, dur: o.dur };
      if (!it.manual) items.push(it); else P.items[key] = it;
      return it;
    };
    P.items = {};
    if (typeof ROWS === 'undefined') return items;
    const ic0 = col('Index');
    ROWS.forEach((r) => {
      const key = String(r[ic0]), inf = info(key);
      if (!inf || OPEN_NOT.includes(inf.status)) return;
      const dur = durOf(key), due = fromYmd(inf.due), m = P.meta[key] || {};
      let nb = m.notBefore ? fromYmd(m.notBefore) : null;
      const sd = fromYmd(r[col('Start Date')]);
      if (sd && sd.getTime() > sod(now).getTime() && (!nb || sd > nb)) nb = sd;
      mk(key, { focus: focusHit(inf, r), base: dur * (1 - inf.prog), dur, priority: inf.priority, deadline: due ? atMin(due, hm(S.workEnd)) : null, notBefore: nb ? atMin(nb, hm(S.workStart)) : null });
    });
    // recurring task occurrences for the next 28 days
    const sDay = sod(now);
    P.recurring.forEach((rec) => {
      const startDay = fromYmd(rec.start) || sDay;
      for (let i = 0; i < 28; i++) {
        const d = addDays(sDay, i);
        if (!E.matchRule(rec, startDay, d, S)) continue;
        const key = 'r:' + rec.id + ':' + ymd(d);
        if (P.doneOcc[key]) continue;
        mk(key, { base: rec.dur, dur: rec.dur, priority: rec.priority || 'Medium', deadline: null, hardEnd: atMin(addDays(d, 1), 0), notBefore: atMin(d, hm(S.workStart)) });
      }
    });
    return items.concat([]);
  }

  function computePlan(replace) {
    refreshRowMap();
    const now = Date.now();
    // drop pinned blocks older than 45 days
    Object.keys(P.meta).forEach((k) => { const m = P.meta[k]; if (m.pinned) m.pinned = m.pinned.filter((p) => p.e > now - 45 * DAY); });
    const items = buildItems(now);
    P.itemList = items;
    P.planned = true;
    items.forEach((it) => { P.items[it.key] = it; });
    if (!replace) return;
    const pinned = [];
    Object.keys(P.meta).forEach((k) => { ((P.meta[k].pinned) || []).forEach((p) => { if (p.e > now && isOpen(k)) pinned.push(p); }); });
    const res = E.schedule({ items, events: P.events, pinned, settings: P.settings, now, horizonDays: 56 });
    P.autoBlocks = res.blocks; P.risk = res.risk; P.unsched = res.unsched;
  }

  function allBlocks(raw) {
    const now = Date.now(), out = [];
    P.autoBlocks.forEach((b) => { if (isOpen(b.key) && !(P.meta[b.key] && P.meta[b.key].manual)) out.push(Object.assign({}, b)); });
    Object.keys(P.meta).forEach((k) => {
      const m = P.meta[k];
      (m.pinned || []).forEach((p, i) => {
        const inf = info(k);
        if (!inf) return;
        if (p.e > now && !isOpen(k)) return;
        const it = P.items[k];
        out.push({ key: k, s: p.s, e: p.e, pin: true, pi: i, late: !!(it && it.deadline && p.e > it.deadline) });
      });
    });
    P.past.forEach((p) => out.push(Object.assign({}, p, { done: true, past: true })));
    if (raw) return out;
    const hid = P.filter.hidden;
    return out.filter((b) => { const inf = b.done ? { project: b.project } : info(b.key); return inf && !hid[inf.project || '-']; });
  }

  /* ---------- refresh / render plumbing ---------- */
  const pane = () => $('#tab-planner');
  const active = () => !!pane() && pane().classList.contains('active');
  let popRefresh = null;
  let loadP = null;
  function loadOnce() { if (!loadP) loadP = load().then(() => { P.loaded = true; }); return loadP; }
  async function ensureLoaded() {
    await loadOnce();
    if (!P.planned) computePlan(P.settings.auto || !P.autoBlocks.length);
  }
  function refresh(force) {
    if (!P.loaded) return;
    computePlan(!!force || P.settings.auto);
    if (P.ready) render();
    save();
    feedPush();
    if (popRefresh) popRefresh();
  }
  let dcT = null;
  function dataChanged() {
    P.dirty = true;
    if (!P.loaded) return;
    clearTimeout(dcT);
    if (!P.ready || !active()) { if (feedOn()) dcT = setTimeout(() => { computePlan(P.settings.auto); feedPush(); }, 300); return; }
    dcT = setTimeout(() => { P.dirty = false; refresh(); }, 30);
  }

  function patchRow(i, patch) {
    const r = ROWS[i];
    if (!r) return false;
    Object.keys(patch).forEach((name) => {
      const c = col(name);
      if (c < 0) return;
      const before = r[c];
      r[c] = patch[name];
      try { LAST_EDITED_TS[rowHistoryKey(i)] = Date.now(); saveLastEditedTs(); } catch (e) { /* history is best effort */ }
      try { logRowChange(i, name, before, patch[name]); } catch (e) { /* same */ }
    });
    return true;
  }
  async function updateRow(i, patch) {
    if (!patchRow(i, patch)) return;
    await commitChange();
  }
  function setMeta(key, patch) {
    const m = P.meta[key] || (P.meta[key] = {});
    Object.keys(patch).forEach((k) => { if (patch[k] === null || patch[k] === '' || patch[k] === false) delete m[k]; else m[k] = patch[k]; });
    if (!Object.keys(m).length) delete P.meta[key];
  }

  /* ---------- skeleton ---------- */
  function build() {
    pane().innerHTML =
      '<div class="pl" id="pl">' +
      '<aside class="pl-side" id="plSide">' +
      '<div class="pl-add"><input id="plQuick" aria-label="Add a task" placeholder="Add task: Draft RCA 2h !high due:fri @Project"><button class="pl-btn pri" id="plQuickBtn" type="button">Add</button></div>' +
      '<div class="pl-hint">Enter to add. 90m or 2h sets the duration; !high, due:fri, #topic, @project are optional.</div>' +
      '<div id="plMini"></div><div id="plStats"></div><div id="plAttn"></div>' +
      '<div class="pl-sec"><div class="pl-sec-h"><span>Tasks</span><input id="plFilter" aria-label="Filter tasks" placeholder="Filter"></div><div id="plProj" class="pl-chips"></div><div id="plList"></div></div>' +
      '<div class="pl-sec"><div class="pl-sec-h"><span>Recurring</span><button class="pl-link" id="plRecAdd" type="button">+ New</button></div><div id="plRec"></div></div>' +
      '</aside>' +
      '<section class="pl-main"><div class="pl-bar" id="plBar"></div><div class="pl-cal" id="plCal"></div></section>' +
      '</div>';
    const q = $('#plQuick');
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); quickAdd(); } });
    $('#plQuickBtn').onclick = quickAdd;
    $('#plFilter').addEventListener('input', (e) => { P.filter.q = e.target.value.toLowerCase(); renderList(); });
    $('#plRecAdd').onclick = () => editRecurring(null);
    $('#plCal').addEventListener('pointerdown', onDown);
    $('#plCal').addEventListener('click', onCalClick);
    $('#plCal').addEventListener('wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey) || !(window.appZoom && window.appZoom.available) || !e.target.closest('.pl-scroll')) return;
      e.preventDefault();
      timeZoom(e.deltaY < 0 ? 4 : -4);
    }, { passive: false });
    $('#plCal').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { const b = e.target.closest('.pl-blk,.pl-chip'); if (b) { e.preventDefault(); openFromEl(b); } } });
    $('#plSide').addEventListener('pointerdown', onSideDown);
    $('#plSide').addEventListener('click', onSideClick);
    $('#plBar').addEventListener('click', onBarClick);
    pane().classList.toggle('no-side', !P.settings.sidebar);
  }

  /* ---------- toolbar ---------- */
  function rangeDays() {
    const a = P.anchor, S = P.settings;
    if (P.view === 'day') return [a];
    const diff = (a.getDay() - S.weekStart + 7) % 7;
    if (P.view === 'week') { const s = addDays(a, -diff); return [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(s, i)); }
    const first = new Date(a.getFullYear(), a.getMonth(), 1), dim = new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate();
    const lead = (first.getDay() - S.weekStart + 7) % 7, weeks = Math.ceil((lead + dim) / 7), gs = addDays(first, -lead), out = [];
    for (let i = 0; i < weeks * 7; i++) out.push(addDays(gs, i));
    return out;
  }
  function titleText() {
    const d = rangeDays();
    if (P.view === 'day') return DOW[P.anchor.getDay()] + ', ' + MONS[P.anchor.getMonth()].slice(0, 3) + ' ' + P.anchor.getDate() + ', ' + P.anchor.getFullYear();
    if (P.view === 'month') return MONS[P.anchor.getMonth()] + ' ' + P.anchor.getFullYear();
    const a = d[0], b = d[6];
    return a.getMonth() === b.getMonth() ? MONS[a.getMonth()].slice(0, 3) + ' ' + a.getDate() + ' to ' + b.getDate() + ', ' + b.getFullYear() : MONS[a.getMonth()].slice(0, 3) + ' ' + a.getDate() + ' to ' + MONS[b.getMonth()].slice(0, 3) + ' ' + b.getDate() + ', ' + b.getFullYear();
  }
  function renderBar() {
    const seg = ['day', 'week', 'month'].map((v) => '<button type="button" class="' + (P.view === v ? 'on' : '') + '" data-view="' + v + '">' + v[0].toUpperCase() + v.slice(1) + '</button>').join('');
    $('#plBar').innerHTML =
      '<button class="pl-ic" data-a="side" title="Show or hide the task panel" aria-label="Toggle task panel">' + ic(ICON.side) + '</button>' +
      '<button class="pl-btn" data-a="today">Today</button>' +
      '<button class="pl-ic" data-a="prev" aria-label="Previous">' + ic(ICON.l) + '</button><button class="pl-ic" data-a="next" aria-label="Next">' + ic(ICON.r) + '</button>' +
      '<h2 class="pl-title">' + esc(titleText()) + '</h2>' + (focusOn() ? '<button class="pl-chip-tg on" data-a="clearfocus" title="Tasks matching this are planned first. Click to clear.">Focus: ' + esc(focusLabel()) + ' &times;</button>' : '') + '<span class="pl-spacer"></span>' +
      '<button class="pl-ic" data-a="tzout" title="Shrink the time scale (-)" aria-label="Zoom the calendar out">' + ic(ICON.minus) + '</button><button class="pl-ic" data-a="tzin" title="Stretch the time scale (+)" aria-label="Zoom the calendar in">' + ic(ICON.plus) + '</button>' +
      '<div class="pl-seg" role="group" aria-label="View">' + seg + '</div>' +
      '<button class="pl-chip-tg ' + (P.settings.auto ? 'on' : '') + '" data-a="auto" title="When on, the plan updates itself after every change"><i></i>Auto-schedule</button>' +
      '<button class="pl-btn" data-a="replan" title="Rebuild the plan now (A)">' + ic(ICON.refresh, 14) + ' Re-plan</button>' +
      '<button class="pl-btn" data-a="newev" title="New event (N)">' + ic(ICON.plus, 14) + ' Event</button>' +
      '<button class="pl-ic" data-a="menu" aria-label="More" title="More">' + ic(ICON.more) + '</button>' +
      '<button class="pl-ic" data-a="settings" aria-label="Planner settings" title="Planner settings">' + ic(ICON.gear) + '</button>';
  }
  function onBarClick(e) {
    const v = e.target.closest('[data-view]');
    if (v) { P.view = v.dataset.view; save(); render(true); return; }
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (a === 'today') { P.anchor = sod(new Date()); P.mini = sod(new Date()); render(true); }
    else if (a === 'prev' || a === 'next') navigate(a === 'next' ? 1 : -1);
    else if (a === 'auto') { P.settings.auto = !P.settings.auto; if (P.settings.auto) refresh(true); else { save(); render(); } }
    else if (a === 'replan') { refresh(true); toast('Plan rebuilt'); }
    else if (a === 'newev') newEventAt(null, b);
    else if (a === 'clearfocus') { P.focus = null; refresh(true); }
    else if (a === 'tzin') timeZoom(8);
    else if (a === 'tzout') timeZoom(-8);
    else if (a === 'side') { P.settings.sidebar = !P.settings.sidebar; pane().classList.toggle('no-side', !P.settings.sidebar); save(); }
    else if (a === 'settings') openSettings();
    else if (a === 'menu') openMenu(b);
  }
  function timeZoom(d) {
    const S = P.settings, old = S.hourPx, n = Math.min(112, Math.max(32, old + d));
    if (n === old) return;
    const sc = $('.pl-scroll', $('#plCal')), centre = sc ? (sc.scrollTop + sc.clientHeight / 2) / old : null;
    S.hourPx = n;
    renderCal();
    const sc2 = $('.pl-scroll', $('#plCal'));
    if (sc2 && centre != null) sc2.scrollTop = Math.max(0, centre * n - sc2.clientHeight / 2);
    save();
  }
  function navigate(dir) {
    if (P.view === 'day') P.anchor = addDays(P.anchor, dir);
    else if (P.view === 'week') P.anchor = addDays(P.anchor, 7 * dir);
    else P.anchor = new Date(P.anchor.getFullYear(), P.anchor.getMonth() + dir, 1);
    P.mini = sod(P.anchor);
    render(true);
  }

  /* ---------- calendar ---------- */
  const slotY = (min) => (min / 60) * P.settings.hourPx;
  function dayItems(day, blocks) {
    const ds = day.getTime(), de = addDays(day, 1).getTime(), out = [];
    P.events.forEach((ev) => {
      if (ev.allDay) return;
      E.occurrences(ev, ds, de, P.settings).forEach((o) => out.push({ type: 'ev', ev, o, s: Math.max(o.s, ds), e: Math.min(o.e, de) }));
    });
    blocks.forEach((b) => { if (b.e > ds && b.s < de) out.push({ type: 'task', b, s: Math.max(b.s, ds), e: Math.min(b.e, de) }); });
    return out;
  }
  function layout(items) {
    items.sort((a, b) => a.s - b.s || b.e - a.e);
    const out = [];
    let cluster = [], cEnd = 0;
    const flush = () => {
      const ends = [];
      cluster.forEach((it) => { let c = 0; while (ends[c] != null && ends[c] > it.s) c++; ends[c] = it.e; it.col = c; });
      cluster.forEach((it) => { it.cols = ends.length; });
      out.push.apply(out, cluster); cluster = [];
    };
    items.forEach((it) => { if (cluster.length && it.s >= cEnd) { flush(); cEnd = 0; } cluster.push(it); cEnd = Math.max(cEnd, it.e); });
    if (cluster.length) flush();
    return out;
  }
  function offBlocks(day) {
    const S = P.settings, w = E.dayWindows(day, S), hp = S.hourPx, ds = day.getTime();
    const seg = (a, b) => (b > a ? '<div class="pl-off" style="top:' + slotY((a - ds) / MIN) + 'px;height:' + slotY((b - a) / MIN) + 'px"></div>' : '');
    if (!w.length) return seg(ds, addDays(day, 1).getTime());
    let out = seg(ds, w[0][0]);
    for (let i = 1; i < w.length; i++) out += '<div class="pl-lunch" style="top:' + slotY((w[i - 1][1] - ds) / MIN) + 'px;height:' + slotY((w[i][0] - w[i - 1][1]) / MIN) + 'px"></div>';
    return out + seg(w[w.length - 1][1], addDays(day, 1).getTime());
  }
  function blockHtml(it, ds) {
    const hp = P.settings.hourPx, now = Date.now();
    const top = slotY((it.s - ds) / MIN), hgt = Math.max(16, slotY((it.e - it.s) / MIN) - 1);
    const left = (it.col / it.cols) * 100, wid = 100 / it.cols;
    const pos = 'top:' + top + 'px;height:' + hgt + 'px;left:calc(' + left + '% + 2px);width:calc(' + wid + '% - 4px)';
    const meta = T(it.type === 'ev' ? it.o.s : it.b.s) + ' to ' + T(it.type === 'ev' ? it.o.e : it.b.e);
    const small = hgt < 34;
    if (it.type === 'ev') {
      const ev = it.ev, past = it.o.e <= now;
      return '<div class="pl-blk ev' + (past ? ' past' : '') + '" tabindex="0" role="button" aria-label="' + esc(ev.title + ', ' + meta) + '" data-type="ev" data-id="' + ev.id + '" data-occ="' + it.o.s + '" data-s="' + it.o.s + '" data-e="' + it.o.e + '" style="' + pos + ';--c:' + esc(ev.color || '#0284C7') + '">' +
        '<div class="t">' + (ev.repeat && ev.repeat !== 'none' ? ic(ICON.rep, 11) + ' ' : '') + esc(ev.title) + '</div>' + (small ? '' : '<div class="m">' + meta + '</div>') + '<div class="rs"></div></div>';
    }
    const b = it.b, inf = b.done ? { title: b.title, project: b.project, kind: 'row' } : info(b.key);
    if (!inf) return '';
    const past = b.e <= now, rec = b.key.indexOf('r:') === 0;
    const cls = 'pl-blk task' + (b.pin ? ' pin' : '') + (b.late ? ' late' : '') + (past ? ' past' : '') + (b.done ? ' done' : '') + (past || b.done ? ' nodrag' : '');
    return '<div class="' + cls + '" tabindex="0" role="button" aria-label="' + esc(inf.title + ', ' + meta) + '" data-type="task" data-k="' + esc(b.key) + '" data-s="' + b.s + '" data-e="' + b.e + '" data-pi="' + (b.pi == null ? '' : b.pi) + '" data-done="' + (b.done ? 1 : 0) + '" style="' + pos + ';--c:' + colorOf(inf.project) + '">' +
      '<span class="chk' + (b.done ? ' on' : '') + '" data-act="done" title="Mark done" role="checkbox" aria-checked="' + (b.done ? 'true' : 'false') + '"></span>' +
      '<div class="t">' + (rec ? ic(ICON.rep, 11) + ' ' : '') + esc(inf.title) + '</div>' + (small ? '' : '<div class="m">' + meta + ' &middot; ' + fmtDur((b.e - b.s) / MIN) + '</div>') +
      (b.pin ? '<span class="pin-ic" title="Pinned: the planner will not move this">' + ic(ICON.pin, 11) + '</span>' : '') + (b.late ? '<span class="late-ic" title="Misses its deadline">' + ic(ICON.warn, 11) + '</span>' : '') +
      (past || b.done ? '' : '<div class="rs"></div>') + '</div>';
  }
  function dueChips(day) {
    const k = ymd(day), out = [];
    if (typeof ROWS === 'undefined') return out;
    const dc = col('Due Date'), ic0 = col('Index');
    ROWS.forEach((r) => {
      if (r[dc] !== k) return;
      const key = String(r[ic0]), inf = info(key);
      if (!inf || OPEN_NOT.includes(inf.status) || P.filter.hidden[inf.project || '-']) return;
      out.push({ key, inf });
    });
    return out;
  }
  function allDayEvents(day) {
    const ds = day.getTime(), de = addDays(day, 1).getTime(), out = [];
    P.events.forEach((ev) => { if (ev.allDay) E.occurrences(ev, ds, de, P.settings).forEach((o) => out.push({ ev, o })); });
    return out;
  }
  function workCapacity(day) { return E.dayWindows(day, P.settings).reduce((a, w) => a + (w[1] - w[0]) / MIN, 0); }

  function renderCal(keepScroll) {
    const cal = $('#plCal'), S = P.settings, days = rangeDays();
    const prev = cal.querySelector('.pl-scroll');
    const scrollTop = prev ? prev.scrollTop : null;
    cal.style.setProperty('--hp', S.hourPx + 'px');
    if (P.view === 'month') { cal.innerHTML = monthHtml(days); return; }
    const blocks = allBlocks(), today = ymd(Date.now()), now = Date.now();
    let head = '', adr = '', cols = '';
    days.forEach((d) => {
      const ds = d.getTime(), items = dayItems(d, blocks), isToday = ymd(d) === today;
      const planned = items.filter((i) => i.type === 'task' && !i.b.done).reduce((a, i) => a + (i.e - i.s) / MIN, 0);
      const cap = workCapacity(d), pct = cap ? Math.min(130, (planned / cap) * 100) : 0;
      head += '<div class="pl-dh' + (isToday ? ' today' : '') + '" data-day="' + ds + '"><span class="dow">' + DOW[d.getDay()] + '</span><span class="num">' + d.getDate() + '</span>' + (planned ? '<span class="load" title="Planned work vs working hours"><i class="' + (pct > 100 ? 'over' : pct > 85 ? 'hi' : '') + '" style="width:' + Math.min(100, pct) + '%"></i></span><span class="lt">' + fmtDur(planned) + '</span>' : '') + '</div>';
      const chips = allDayEvents(d).map((x) => '<div class="pl-chip ev" tabindex="0" data-type="ev" data-id="' + x.ev.id + '" data-occ="' + x.o.s + '" style="--c:' + esc(x.ev.color || '#0284C7') + '">' + esc(x.ev.title) + '</div>').join('') +
        dueChips(d).slice(0, 3).map((x) => '<div class="pl-chip due" tabindex="0" data-type="task" data-k="' + esc(x.key) + '" style="--c:' + colorOf(x.inf.project) + '" title="Deadline">' + ic(ICON.diamond, 9) + ' ' + esc(x.inf.title) + '</div>').join('');
      adr += '<div class="pl-ad" data-day="' + ds + '">' + chips + '</div>';
      const laid = layout(items), nowLine = isToday ? '<div class="pl-now" style="top:' + slotY((now - ds) / MIN) + 'px"></div>' : '';
      cols += '<div class="pl-col' + (isToday ? ' today' : '') + '" data-ds="' + ds + '">' + offBlocks(d) + laid.map((it) => blockHtml(it, ds)).join('') + nowLine + '<div class="pl-ghost" hidden></div></div>';
    });
    let times = '';
    for (let h = 1; h < 24; h++) times += '<div class="pl-tl" style="top:' + slotY(h * 60) + 'px">' + pad2(h) + ':00</div>';
    cal.innerHTML = '<div class="pl-cols-head" style="--n:' + days.length + '"><div class="pl-gut"></div>' + head + '</div>' +
      '<div class="pl-cols-ad" style="--n:' + days.length + '"><div class="pl-gut"><span>all day</span></div>' + adr + '</div>' +
      '<div class="pl-scroll"><div class="pl-grid" style="--n:' + days.length + ';height:' + slotY(24 * 60) + 'px"><div class="pl-times">' + times + '</div>' + cols + '</div></div>';
    const sc = cal.querySelector('.pl-scroll');
    cal.style.setProperty('--sb', (sc.offsetWidth - sc.clientWidth) + 'px');
    if (scrollTop != null && keepScroll !== 'reset') sc.scrollTop = scrollTop;
    else sc.scrollTop = Math.max(0, slotY(hm(S.workStart) - 60));
  }
  function monthHtml(days) {
    const S = P.settings, blocks = allBlocks(), today = ymd(Date.now()), cm = P.anchor.getMonth();
    const heads = days.slice(0, 7).map((d) => '<div class="pl-mh">' + DOW[d.getDay()] + '</div>').join('');
    const cells = days.map((d) => {
      const ds = d.getTime(), de = addDays(d, 1).getTime(), chips = [];
      allDayEvents(d).forEach((x) => chips.push('<div class="pl-chip ev" tabindex="0" data-type="ev" data-id="' + x.ev.id + '" data-occ="' + x.o.s + '" style="--c:' + esc(x.ev.color || '#0284C7') + '">' + esc(x.ev.title) + '</div>'));
      P.events.forEach((ev) => { if (!ev.allDay) E.occurrences(ev, ds, de, S).forEach((o) => chips.push('<div class="pl-chip ev solid" tabindex="0" data-type="ev" data-id="' + ev.id + '" data-occ="' + o.s + '" style="--c:' + esc(ev.color || '#0284C7') + '"><b>' + T(o.s) + '</b> ' + esc(ev.title) + '</div>')); });
      const per = {};
      blocks.forEach((b) => { if (b.e > ds && b.s < de) { const inf = b.done ? { title: b.title, project: b.project } : info(b.key); if (!inf) return; (per[b.key] = per[b.key] || { inf, key: b.key, min: 0, late: false }).min += (Math.min(b.e, de) - Math.max(b.s, ds)) / MIN; if (b.late) per[b.key].late = true; } });
      Object.keys(per).forEach((k) => chips.push('<div class="pl-chip task' + (per[k].late ? ' late' : '') + '" tabindex="0" data-type="task" data-k="' + esc(k) + '" style="--c:' + colorOf(per[k].inf.project) + '">' + esc(per[k].inf.title) + ' <em>' + fmtDur(per[k].min) + '</em></div>'));
      const shown = chips.slice(0, 3).join(''), more = chips.length > 3 ? '<div class="pl-more">+' + (chips.length - 3) + ' more</div>' : '';
      return '<div class="pl-mcell' + (ymd(d) === today ? ' today' : '') + (d.getMonth() !== cm ? ' dim' : '') + (S.days.includes(d.getDay()) ? '' : ' off') + '" data-day="' + ds + '"><div class="mn">' + d.getDate() + '</div>' + shown + more + '</div>';
    }).join('');
    return '<div class="pl-month"><div class="pl-mheads">' + heads + '</div><div class="pl-mgrid" style="grid-template-rows:repeat(' + (days.length / 7) + ',minmax(96px,1fr))">' + cells + '</div></div>';
  }

  /* ---------- sidebar ---------- */
  function renderMini() {
    const m = P.mini, S = P.settings, first = new Date(m.getFullYear(), m.getMonth(), 1), dim = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    const lead = (first.getDay() - S.weekStart + 7) % 7, today = ymd(Date.now()), sel = rangeDays().map(ymd);
    let h = '<div class="mini-h"><button class="pl-ic" data-mini="-1" aria-label="Previous month">' + ic(ICON.l, 13) + '</button><span>' + MONS[m.getMonth()] + ' ' + m.getFullYear() + '</span><button class="pl-ic" data-mini="1" aria-label="Next month">' + ic(ICON.r, 13) + '</button></div><div class="mini-g">';
    for (let i = 0; i < 7; i++) h += '<i class="mh">' + DOW[(S.weekStart + i) % 7][0] + '</i>';
    for (let i = 0; i < lead; i++) h += '<i></i>';
    for (let d = 1; d <= dim; d++) { const dt = new Date(m.getFullYear(), m.getMonth(), d), k = ymd(dt); h += '<button type="button" class="md' + (k === today ? ' today' : '') + (sel.includes(k) && P.view !== 'month' ? ' sel' : '') + '" data-md="' + dt.getTime() + '">' + d + '</button>'; }
    $('#plMini').innerHTML = h + '</div>';
  }
  function visibleRange() {
    const d = rangeDays();
    return [d[0].getTime(), addDays(d[d.length - 1], 1).getTime()];
  }
  function renderStats() {
    const [a, b] = visibleRange(), blocks = allBlocks();
    let task = 0, ev = 0;
    blocks.forEach((x) => { if (!x.done && x.e > a && x.s < b) task += (Math.min(x.e, b) - Math.max(x.s, a)) / MIN; });
    P.events.forEach((e) => { if (!e.allDay) E.occurrences(e, a, b, P.settings).forEach((o) => { ev += (Math.min(o.e, b) - Math.max(o.s, a)) / MIN; }); });
    const risk = attention().late.length;
    const nx = allBlocks().filter((x) => !x.done && x.e > Date.now()).sort((p, q) => p.s - q.s)[0], nxi = nx ? info(nx.key) : null;
    $('#plStats').innerHTML = (nx && nxi ? '<button type="button" class="pl-nextup" data-jump="' + nx.s + '"><span>Next up</span><b>' + esc(nxi.title) + '</b><em>' + whenText(nx.s) + '</em></button>' : '') + '<div class="pl-stats"><div><b>' + fmtDur(task) + '</b><span>planned work</span></div><div><b>' + fmtDur(ev) + '</b><span>meetings</span></div><div class="' + (risk ? 'bad' : '') + '"><b>' + risk + '</b><span>at risk</span></div></div>';
  }
  function attention() {
    const now = Date.now(), late = [], un = [];
    const hasBlock = {}, lateKeys = new Set(P.risk);
    allBlocks().forEach((b) => { if (!b.done && b.e > now) { hasBlock[b.key] = true; if (b.late) lateKeys.add(b.key); } });
    (P.itemList || []).forEach((it) => {
      const inf = info(it.key);
      if (!inf || inf.kind === 'rec') return;
      if (lateKeys.has(it.key)) {
        const last = P.autoBlocks.filter((b) => b.key === it.key).reduce((m, b) => Math.max(m, b.e), 0);
        const days = it.deadline && last ? Math.max(0, Math.ceil((last - it.deadline) / DAY)) : null;
        late.push({ it, inf, why: it.remaining && !last && P.risk.has(it.key) ? 'No free time before the deadline' : days ? 'Finishes ' + days + (days === 1 ? ' day' : ' days') + ' after its deadline' : 'Has time planned after its deadline' });
      } else if (it.remaining > 0 && !hasBlock[it.key] && P.settings.auto === false) un.push({ it, inf, why: 'Not scheduled yet. Press Re-plan.' });
      else if (it.remaining > 0 && !hasBlock[it.key]) un.push({ it, inf, why: 'No free slot in the next 8 weeks' });
    });
    return { late, un };
  }
  function renderAttn() {
    const a = attention(), rows = a.late.concat(a.un);
    if (!rows.length) { $('#plAttn').innerHTML = ''; return; }
    $('#plAttn').innerHTML = '<div class="pl-sec"><div class="pl-sec-h"><span>Needs attention</span><em>' + rows.length + '</em></div>' + rows.slice(0, 6).map((r) =>
      '<div class="pl-task attn" data-k="' + esc(r.it.key) + '" style="--c:' + colorOf(r.inf.project) + '"><span class="dot"></span><div class="tx"><div class="tt">' + esc(r.inf.title) + '</div><div class="ts">' + esc(r.why) + '</div></div></div>').join('') + '</div>';
  }
  function nextBlockOf(key) {
    const now = Date.now();
    const bs = allBlocks().filter((b) => b.key === key && !b.done && b.e > now).sort((x, y) => x.s - y.s);
    return bs[0] || null;
  }
  function whenText(ms) {
    const d = new Date(ms), t = sod(new Date()).getTime(), dd = sod(d).getTime();
    const lab = dd === t ? 'Today' : dd === t + DAY ? 'Tomorrow' : DOW[d.getDay()] + ' ' + d.getDate();
    return lab + ' ' + T(ms);
  }
  function renderProj() {
    const set = {};
    (P.itemList || []).forEach((it) => { const i = info(it.key); if (i) set[i.project || '-'] = 1; });
    Object.keys(P.filter.hidden).forEach((k) => { set[k] = 1; });
    $('#plProj').innerHTML = Object.keys(set).sort().map((p) => '<button type="button" class="pl-pc' + (P.filter.hidden[p] ? ' off' : '') + '" data-proj="' + esc(p) + '" style="--c:' + colorOf(p === '-' ? '' : p) + '"><i></i>' + esc(p === '-' ? 'No project' : p) + '</button>').join('');
  }
  function renderList() {
    const q = P.filter.q, now = Date.now();
    const rows = (P.itemList || []).concat(Object.keys(P.items).map((k) => P.items[k]).filter((x) => x.manual)).filter((it, i, a) => a.findIndex((z) => z.key === it.key) === i)
      .map((it) => ({ it, inf: info(it.key), nb: nextBlockOf(it.key) })).filter((r) => r.inf && r.inf.kind === 'row')
      .filter((r) => !q || (r.inf.title + ' ' + r.inf.project).toLowerCase().includes(q))
      .sort((x, y) => (x.nb ? x.nb.s : 9e15) - (y.nb ? y.nb.s : 9e15) || x.it.pri - y.it.pri);
    const lim = P.listAll ? rows.length : 40;
    $('#plList').innerHTML = rows.slice(0, lim).map((r) => {
      const due = r.inf.due ? fromYmd(r.inf.due) : null, od = due && due.getTime() < sod(now).getTime();
      const pri = { High: '&#9650;', Low: '&#9660;' }[r.inf.priority] || '';
      return '<div class="pl-task' + (r.it.manual ? ' manual' : '') + '" data-k="' + esc(r.it.key) + '" style="--c:' + colorOf(r.inf.project) + '" title="Drag onto the calendar to pin it"><span class="dot"></span><div class="tx"><div class="tt">' + esc(r.inf.title) + '</div><div class="ts">' +
        fmtDur(r.it.left != null ? r.it.left : r.it.remaining || 0) + ' left' + (r.it.manual ? ' &middot; manual' : r.nb ? ' &middot; ' + whenText(r.nb.s) : ' &middot; unscheduled') + '</div></div>' +
        '<div class="rt">' + (due ? '<span class="due' + (od ? ' od' : '') + '">' + DOW[due.getDay()] + ' ' + due.getDate() + '/' + (due.getMonth() + 1) + '</span>' : '') + '<span class="pri p' + esc(r.inf.priority) + '">' + pri + '</span></div></div>';
    }).join('') + (rows.length > lim ? '<button class="pl-link" data-a="more" type="button">Show all ' + rows.length + '</button>' : '') + (rows.length ? '' : '<div class="pl-empty">No open tasks. Add one above.</div>');
  }
  function renderRec() {
    const lab = { daily: 'Every day', workdays: 'Every working day', weekly: 'Weekly', monthly: 'Monthly' };
    $('#plRec').innerHTML = P.recurring.map((r) => '<div class="pl-rec" data-rec="' + r.id + '" style="--c:' + colorOf(r.project) + '"><span class="dot"></span><div class="tx"><div class="tt">' + ic(ICON.rep, 11) + ' ' + esc(r.title) + '</div><div class="ts">' + (lab[r.repeat] || r.repeat) + ' &middot; ' + fmtDur(r.dur) + '</div></div></div>').join('') || '<div class="pl-empty">Routines that repeat, planned around your meetings.</div>';
  }
  function renderSide() { renderMini(); renderStats(); renderAttn(); renderProj(); renderList(); renderRec(); }
  function render(reset) { if (!P.ready || !pane()) return; renderBar(); renderSide(); renderCal(reset === true ? 'reset' : undefined); }

  function onSideClick(e) {
    const mm = e.target.closest('[data-mini]');
    if (mm) { P.mini = new Date(P.mini.getFullYear(), P.mini.getMonth() + (+mm.dataset.mini), 1); renderMini(); return; }
    const jp = e.target.closest('[data-jump]');
    if (jp) { P.anchor = sod(new Date(+jp.dataset.jump)); P.mini = sod(P.anchor); if (P.view === 'month') P.view = 'week'; render(true); const sc = $('.pl-scroll', $('#plCal')); if (sc) sc.scrollTop = Math.max(0, slotY((+jp.dataset.jump - P.anchor.getTime()) / MIN - 60)); return; }
    const md = e.target.closest('[data-md]');
    if (md) { P.anchor = sod(new Date(+md.dataset.md)); P.mini = sod(P.anchor); if (P.view === 'month') P.view = 'day'; render(true); return; }
    const pc = e.target.closest('[data-proj]');
    if (pc) { const k = pc.dataset.proj; if (P.filter.hidden[k]) delete P.filter.hidden[k]; else P.filter.hidden[k] = 1; renderProj(); renderCal(); renderStats(); return; }
    if (e.target.closest('[data-a="more"]')) { P.listAll = true; renderList(); return; }
    const rc = e.target.closest('[data-rec]');
    if (rc) { editRecurring(P.recurring.find((r) => r.id === rc.dataset.rec)); }
  }

  /* ---------- pointer interactions on the grid ---------- */
  const snap = (m) => Math.round(m / 15) * 15;
  let DRAG = null, clickGuard = 0, tipEl = null;
  function tip(txt, x, y) {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'pl-tip'; document.body.appendChild(tipEl); }
    tipEl.textContent = txt; tipEl.style.left = x + 14 + 'px'; tipEl.style.top = y + 14 + 'px';
  }
  const untip = () => { if (tipEl) { tipEl.remove(); tipEl = null; } };
  const colsEls = () => $$('.pl-col', $('#plCal'));
  function colAt(x, cols) {
    for (let i = 0; i < cols.length; i++) { const r = cols[i].getBoundingClientRect(); if (x >= r.left && x < r.right) return i; }
    const f = cols[0].getBoundingClientRect();
    return x < f.left ? 0 : cols.length - 1;
  }
  const minAt = (y, colEl) => ((y - colEl.getBoundingClientRect().top) / P.settings.hourPx) * 60;

  function onDown(e) {
    if (e.button !== 0 || P.view === 'month') return;
    if (e.target.closest('[data-act]')) return;
    const blk = e.target.closest('.pl-blk');
    const cols = colsEls();
    if (!cols.length) return;
    if (blk) {
      if (blk.classList.contains('nodrag')) return;
      const colEl = blk.closest('.pl-col'), mode = e.target.closest('.rs') ? 'resize' : 'move';
      DRAG = { mode, blk, cols, x0: e.clientX, y0: e.clientY, moved: false, s: +blk.dataset.s, e: +blk.dataset.e, type: blk.dataset.type, colEl, offY: e.clientY - blk.getBoundingClientRect().top, dur: (+blk.dataset.e - +blk.dataset.s) / MIN };
    } else {
      const ci = colAt(e.clientX, cols);
      if (!cols[ci].contains(e.target)) return;
      const m0 = Math.floor(minAt(e.clientY, cols[ci]) / 15) * 15;
      DRAG = { mode: 'create', cols, ci, m0, m1: m0 + 15, x0: e.clientX, y0: e.clientY, moved: false, ghost: cols[ci].querySelector('.pl-ghost') };
    }
    closePop();
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }
  function onMove(e) {
    const D = DRAG;
    if (!D) return;
    if (!D.moved && Math.hypot(e.clientX - D.x0, e.clientY - D.y0) < 4) return;
    D.moved = true;
    const hp = P.settings.hourPx;
    if (D.mode === 'create') {
      const m = Math.max(0, Math.min(24 * 60, Math.ceil(minAt(e.clientY, D.cols[D.ci]) / 15) * 15));
      const a = Math.min(D.m0, m - 15 < D.m0 ? D.m0 : m), b = Math.max(D.m0 + 15, m);
      D.m1 = b; D.ma = a;
      D.ghost.hidden = false; D.ghost.style.top = slotY(a) + 'px'; D.ghost.style.height = slotY(b - a) + 'px';
      tip(T(atMin(new Date(+D.cols[D.ci].dataset.ds), a)) + ' to ' + T(atMin(new Date(+D.cols[D.ci].dataset.ds), b)), e.clientX, e.clientY);
      return;
    }
    D.blk.classList.add('dragging');
    if (D.mode === 'move') {
      const ci = colAt(e.clientX, D.cols), colEl = D.cols[ci];
      let m = snap(minAt(e.clientY - D.offY, colEl));
      m = Math.max(0, Math.min(24 * 60 - D.dur, m));
      if (D.blk.parentNode !== colEl) colEl.appendChild(D.blk);
      D.blk.style.top = slotY(m) + 'px'; D.blk.style.left = '2px'; D.blk.style.width = 'calc(100% - 4px)';
      const ds = +colEl.dataset.ds;
      D.newS = atMin(new Date(ds), m); D.newE = D.newS + D.dur * MIN;
      tip(T(D.newS) + ' to ' + T(D.newE), e.clientX, e.clientY);
    } else {
      const ds = +D.colEl.dataset.ds, startMin = (D.s - ds) / MIN;
      let m = snap(minAt(e.clientY, D.colEl));
      m = Math.max(startMin + 15, Math.min(24 * 60, m));
      D.blk.style.height = Math.max(16, slotY(m - startMin) - 1) + 'px';
      D.newS = D.s; D.newE = atMin(new Date(ds), m);
      tip(T(D.newS) + ' to ' + T(D.newE) + ' (' + fmtDur((D.newE - D.newS) / MIN) + ')', e.clientX, e.clientY);
    }
  }
  function onUp(e) {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    const D = DRAG; DRAG = null; untip();
    if (!D) return;
    if (D.mode === 'create') {
      if (D.ghost) D.ghost.hidden = true;
      if (!D.moved) return;
      const ds = new Date(+D.cols[D.ci].dataset.ds);
      newEventAt({ s: atMin(ds, D.ma != null ? D.ma : D.m0), e: atMin(ds, D.m1) }, null, { x: e.clientX, y: e.clientY });
      return;
    }
    if (!D.moved) return; // plain click: handled by the click listener
    clickGuard = Date.now();
    if (D.newS == null || (D.newS === D.s && D.newE === D.e)) { render(); return; }
    if (D.type === 'ev') {
      const ev = P.events.find((x) => x.id === D.blk.dataset.id);
      if (ev) { const delta = D.newS - D.s, dur = D.newE - D.newS; ev.start += delta; ev.end = ev.start + dur; }
      refresh(true);
    } else {
      commitTaskMove(D.blk.dataset.k, D.blk.dataset.pi, D.s, D.e, D.newS, D.newE);
    }
  }
  function commitTaskMove(key, pi, os, oe, ns, ne) {
    const m = P.meta[key] || (P.meta[key] = {});
    m.pinned = m.pinned || [];
    const idx = pi !== '' && pi != null ? +pi : -1;
    if (idx >= 0 && m.pinned[idx]) { m.pinned[idx].s = ns; m.pinned[idx].e = ne; }
    else m.pinned.push({ s: ns, e: ne });
    refresh(true);
  }

  function onCalClick(e) {
    if (Date.now() - clickGuard < 250) return;
    const act = e.target.closest('[data-act="done"]');
    if (act) { const blk = act.closest('.pl-blk'); toggleDone(blk.dataset.k, +blk.dataset.s, +blk.dataset.e, blk.dataset.done === '1'); return; }
    const el = e.target.closest('.pl-blk,.pl-chip');
    if (el) { openFromEl(el); return; }
    const mc = e.target.closest('.pl-mcell');
    if (mc && P.view === 'month') { P.anchor = sod(new Date(+mc.dataset.day)); P.view = 'day'; P.mini = sod(P.anchor); save(); render(true); return; }
    const dh = e.target.closest('.pl-dh');
    if (dh && P.view === 'week') { P.anchor = sod(new Date(+dh.dataset.day)); P.view = 'day'; save(); render(true); }
  }
  function openFromEl(el) {
    const r = el.getBoundingClientRect();
    if (el.dataset.type === 'ev') openEvent(P.events.find((x) => x.id === el.dataset.id), +el.dataset.occ, r);
    else openTask(el.dataset.k, r, el.classList.contains('pl-blk') ? { s: +el.dataset.s, e: +el.dataset.e, pin: el.classList.contains('pin'), pi: el.dataset.pi, done: el.dataset.done === '1' } : null);
  }

  /* sidebar drag: pin a task onto the calendar */
  function onSideDown(e) {
    if (e.button !== 0) return;
    const t = e.target.closest('.pl-task[data-k]');
    if (!t || e.target.closest('button,input')) return;
    const st = { x: e.clientX, y: e.clientY, key: t.dataset.k, el: t, moved: false, ghost: null, target: null };
    const mv = (ev) => {
      if (!st.moved && Math.hypot(ev.clientX - st.x, ev.clientY - st.y) < 5) return;
      if (!st.moved) { st.moved = true; st.ghost = document.createElement('div'); st.ghost.className = 'pl-dragghost'; st.ghost.style.setProperty('--c', t.style.getPropertyValue('--c')); st.ghost.textContent = (info(st.key) || {}).title || ''; document.body.appendChild(st.ghost); }
      st.ghost.style.left = ev.clientX + 10 + 'px'; st.ghost.style.top = ev.clientY + 10 + 'px';
      $$('.pl-col .pl-ghost', $('#plCal')).forEach((g) => { g.hidden = true; });
      $$('.pl-mcell.drop', $('#plCal')).forEach((c) => c.classList.remove('drop'));
      st.target = null;
      if (P.view === 'month') {
        const c = document.elementFromPoint(ev.clientX, ev.clientY);
        const mc = c && c.closest ? c.closest('.pl-mcell') : null;
        if (mc) { mc.classList.add('drop'); st.target = { s: atMin(new Date(+mc.dataset.day), hm(P.settings.workStart)) }; }
      } else {
        const cols = colsEls();
        for (let i = 0; i < cols.length; i++) {
          const r = cols[i].getBoundingClientRect();
          if (ev.clientX >= r.left && ev.clientX < r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
            const sc = $('.pl-scroll', $('#plCal')).getBoundingClientRect();
            if (ev.clientY < sc.top || ev.clientY > sc.bottom) break;
            const m = Math.max(0, Math.min(24 * 60 - 15, snap(minAt(ev.clientY, cols[i]) - 7)));
            const it = P.items[st.key], len = Math.max(15, Math.min((it && it.remaining) || durOf(st.key), P.settings.maxChunk));
            const g = cols[i].querySelector('.pl-ghost');
            g.hidden = false; g.style.top = slotY(m) + 'px'; g.style.height = slotY(len) + 'px';
            st.target = { s: atMin(new Date(+cols[i].dataset.ds), m), len };
            break;
          }
        }
      }
    };
    const up = () => {
      document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up);
      if (st.ghost) st.ghost.remove();
      $$('.pl-col .pl-ghost', $('#plCal')).forEach((g) => { g.hidden = true; });
      $$('.pl-mcell.drop', $('#plCal')).forEach((c) => c.classList.remove('drop'));
      if (!st.moved) { openTask(st.key, st.el.getBoundingClientRect(), nextBlockOf(st.key)); return; }
      if (st.target) {
        const it = P.items[st.key], len = st.target.len || Math.max(15, Math.min((it && it.remaining) || durOf(st.key), P.settings.maxChunk));
        const m = P.meta[st.key] || (P.meta[st.key] = {});
        (m.pinned = m.pinned || []).push({ s: st.target.s, e: st.target.s + len * MIN });
        refresh(true);
        toast('Pinned to ' + whenText(st.target.s));
      }
    };
    document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
  }

  /* ---------- popovers & modals ---------- */
  let POP = null;
  function closePop() {
    if (!POP) return;
    POP.el.remove(); document.removeEventListener('pointerdown', POP.out, true); document.removeEventListener('keydown', POP.key, true);
    POP = null; popRefresh = null;
  }
  function openPop(anchor, html, mount) {
    closePop();
    const el = document.createElement('div');
    el.className = 'pl-pop'; el.setAttribute('role', 'dialog'); el.innerHTML = html;
    document.body.appendChild(el);
    const w = el.offsetWidth, h = el.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    let x = anchor.right != null ? anchor.right + 10 : anchor.x + 12, y = anchor.top != null ? anchor.top : anchor.y - 20;
    if (anchor.right != null && x + w > vw - 10) x = Math.max(10, anchor.left - w - 10);
    x = Math.max(10, Math.min(vw - w - 10, x)); y = Math.max(46, Math.min(vh - h - 10, y));
    el.style.left = x + 'px'; el.style.top = y + 'px';
    const out = (e) => { if (!el.contains(e.target) && !e.target.closest('.pl-blk,.pl-chip,.pl-task,.pl-modal')) closePop(); };
    const key = (e) => { if (e.key === 'Escape' && !(window.ctxmenu && window.ctxmenu.isOpen())) { closePop(); } };
    document.addEventListener('pointerdown', out, true); document.addEventListener('keydown', key, true);
    POP = { el, out, key };
    $$('[data-x]', el).forEach((b) => { b.onclick = closePop; });
    if (mount) mount(el);
    return el;
  }
  let MODAL = null;
  function closeModal() { if (MODAL) { document.removeEventListener('keydown', MODAL._esc, true); MODAL.remove(); MODAL = null; } }
  function openModal(title, html, mount) {
    closeModal(); closePop();
    const bg = document.createElement('div');
    bg.className = 'pl-modal'; bg.innerHTML = '<div class="pl-card" role="dialog" aria-label="' + esc(title) + '"><div class="pl-card-h"><h3>' + esc(title) + '</h3><button class="pl-ic" data-x aria-label="Close">' + ic(ICON.x) + '</button></div><div class="pl-card-b">' + html + '</div></div>';
    document.body.appendChild(bg); MODAL = bg;
    bg._esc = (e) => { if (e.key === 'Escape' && !(window.ctxmenu && window.ctxmenu.isOpen()) && !document.querySelector('.pl-pop')) closeModal(); };
    document.addEventListener('keydown', bg._esc, true);
    bg.addEventListener('pointerdown', (e) => { if (e.target === bg) closeModal(); });
    $$('[data-x]', bg).forEach((b) => { b.onclick = closeModal; });
    bg.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
    if (mount) mount(bg);
    return bg;
  }
  const opt = (arr, cur) => arr.map((o) => '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(cur) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('');
  const DURS = [15, 30, 45, 60, 90, 120, 180, 240, 360, 480];
  const durOpts = (cur) => opt((DURS.indexOf(cur) < 0 ? DURS.concat([cur]).sort((a, b) => a - b) : DURS).map((d) => [d, fmtDur(d)]), cur);

  function openTask(key, anchor, blk) {
    const inf = info(key);
    if (!inf) return;
    const m = P.meta[key] || {}, it = P.items[key], isRec = inf.kind === 'rec', S = P.settings;
    const c = colorOf(inf.project);
    const dur = isRec ? inf.rec.dur : durOf(key);
    const chunks = [15, 30, 45, 60, 90, 120, 180, 240].map((v) => [v, fmtDur(v)]);
    const when = () => {
      const b = blk && !blk.done ? blk : nextBlockOf(key);
      return b ? DOW[new Date(b.s).getDay()] + ' ' + new Date(b.s).getDate() + ' ' + MONS[new Date(b.s).getMonth()].slice(0, 3) + ', ' + T(b.s) + ' to ' + T(b.e) : (m.manual ? 'Manual: not auto-scheduled' : 'Not scheduled');
    };
    const html = '<div class="pp-h"><span class="dot" style="background:' + c + '"></span><input class="pp-title" id="ppTitle" value="' + esc(inf.title) + '"' + (isRec ? ' readonly' : '') + ' aria-label="Task title"><button class="pl-ic" data-x aria-label="Close">' + ic(ICON.x) + '</button></div>' +
      '<div class="pp-when" id="ppWhen">' + esc(when()) + '</div><div class="pp-sub">' + esc(inf.project || 'No project') + (isRec ? ' &middot; repeats' : '') + '</div>' +
      '<div class="pp-grid">' +
      '<label>Duration<select data-f="dur">' + durOpts(dur) + '</select></label>' +
      '<label>Priority<select data-f="pri">' + opt([['High', 'High'], ['Medium', 'Medium'], ['Low', 'Low']], inf.priority) + '</select></label>' +
      (isRec ? '' : '<label>Deadline<input type="date" data-f="due" value="' + esc(inf.due || '') + '"></label><label>Status<select data-f="status">' + opt(STATUSES.map((s) => [s, s]), inf.status) + '</select></label>' +
        '<label>Progress %<input type="number" min="0" max="100" step="5" data-f="prog" value="' + Math.round(inf.prog * 100) + '"></label><label>Not before<input type="date" data-f="nb" value="' + esc(m.notBefore || '') + '"></label>' +
        '<label>Min chunk<select data-f="minc">' + opt(chunks, m.minChunk || S.minChunk) + '</select></label><label>Max chunk<select data-f="maxc">' + opt(chunks, m.maxChunk || S.maxChunk) + '</select></label>') + '</div>' +
      (isRec ? '' : '<label class="pp-chk"><input type="checkbox" data-f="hard"' + (m.hard ? ' checked' : '') + '> Hard deadline (flag in red when missed)</label><label class="pp-chk"><input type="checkbox" data-f="manual"' + (m.manual ? ' checked' : '') + '> Do not auto-schedule this task</label>') +
      (isRec ? '' : '<div class="pp-sec">Evidence</div><div class="pp-ev" id="ppEv"></div>') + '<div class="pp-act"><button class="pl-btn pri" data-a="done">' + (inf.status === 'Done' ? 'Reopen' : 'Mark done') + '</button>' +
      (blk && !blk.done ? (blk.pin ? '<button class="pl-btn" data-a="unpin">Unpin this block</button>' : '<button class="pl-btn" data-a="pin">Pin here</button>') : '') +
      ((m.pinned || []).length ? '<button class="pl-btn" data-a="unpinall">Unpin all</button>' : '') +
      (isRec ? '<button class="pl-btn" data-a="editrec">Edit series</button><button class="pl-btn" data-a="skip">Skip this day</button>' : '') + '</div>';
    const el = openPop(anchor, html, (el) => {
      const apply = async (f, v, tgt) => {
        if (f === 'dur') { if (isRec) { inf.rec.dur = +v; save(); } else setMeta(key, { dur: +v }); refresh(true); }
        else if (f === 'pri') { if (isRec) { inf.rec.priority = v; save(); refresh(true); } else await updateRow(inf.row, { Priority: v }); }
        else if (f === 'due') await updateRow(inf.row, { 'Due Date': v });
        else if (f === 'status') await updateRow(inf.row, v === 'Done' ? { Status: v, 'Progress %': 1 } : { Status: v });
        else if (f === 'prog') await updateRow(inf.row, { 'Progress %': Math.min(100, Math.max(0, +v || 0)) / 100 });
        else if (f === 'nb') { setMeta(key, { notBefore: v }); refresh(true); }
        else if (f === 'minc') { setMeta(key, { minChunk: +v }); refresh(true); }
        else if (f === 'maxc') { setMeta(key, { maxChunk: +v }); refresh(true); }
        else if (f === 'hard') { setMeta(key, { hard: tgt.checked }); refresh(true); }
        else if (f === 'manual') { setMeta(key, { manual: tgt.checked }); refresh(true); }
      };
      el.addEventListener('change', (e) => { const f = e.target.dataset.f; if (f) apply(f, e.target.value, e.target); });
      const t = $('#ppTitle', el);
      if (!isRec && window.evidence) window.evidence.mount($('#ppEv', el), key, { compact: true });
      if (!isRec) t.addEventListener('change', () => { if (t.value.trim()) updateRow(inf.row, { Task: t.value.trim() }); });
      el.addEventListener('click', (e) => {
        const a = e.target.closest('[data-a]');
        if (!a) return;
        const k = a.dataset.a;
        if (k === 'done') { toggleDone(key, blk ? blk.s : Date.now(), blk ? blk.e : Date.now(), inf.status === 'Done'); closePop(); }
        else if (k === 'pin') { const mm = P.meta[key] || (P.meta[key] = {}); (mm.pinned = mm.pinned || []).push({ s: blk.s, e: blk.e }); refresh(true); closePop(); }
        else if (k === 'unpin') { const mm = P.meta[key]; if (mm && mm.pinned) { mm.pinned.splice(+blk.pi, 1); setMeta(key, {}); } refresh(true); closePop(); }
        else if (k === 'unpinall') { setMeta(key, { pinned: null }); refresh(true); closePop(); }
        else if (k === 'editrec') { closePop(); editRecurring(inf.rec); }
        else if (k === 'skip') { P.doneOcc[key] = true; refresh(true); closePop(); }
      });
      popRefresh = () => { const w = $('#ppWhen', el); if (w) w.textContent = when(); };
    });
    return el;
  }

  function toggleDone(key, s, e, wasDone) {
    const inf = info(key);
    if (!inf) return;
    const now = Date.now();
    if (inf.kind === 'rec') {
      if (wasDone) delete P.doneOcc[key]; else P.doneOcc[key] = true;
      if (!wasDone && s <= now) P.past.push({ key, s, e: Math.min(e, Math.max(s + 15 * MIN, now)), title: inf.title, project: inf.project });
      refresh(true); return;
    }
    const prevStatus = inf.status, prevProg = ROWS[inf.row][col('Progress %')];
    if (wasDone || inf.status === 'Done') {
      P.past = P.past.filter((p) => p.key !== key);
      updateRow(inf.row, { Status: 'In Progress', 'Progress %': Math.min(0.9, inf.prog) });
      return;
    }
    if (s <= now) P.past.push({ key, s, e: Math.min(e, Math.max(s + 15 * MIN, now)), title: inf.title, project: inf.project });
    updateRow(inf.row, { Status: 'Done', 'Progress %': 1 }).then(() => {
      toast('Marked done: ' + inf.title, { actionLabel: 'Undo', onAction: () => { P.past = P.past.filter((p) => !(p.key === key && p.s === s)); updateRow(inf.row, { Status: prevStatus, 'Progress %': prevProg }); } });
    });
  }

  /* events */
  function newEventAt(range, anchorEl, pt) {
    const now = new Date();
    let s, e;
    if (range) { s = range.s; e = range.e; }
    else {
      const day = sod(P.anchor);
      s = ymd(day) === ymd(now) ? ceil15(now.getTime()) : atMin(day, hm(P.settings.workStart));
      e = s + 60 * MIN;
    }
    const ev = { id: 'e' + uid(), title: '', start: s, end: e, allDay: false, blocks: true, color: '#0284C7', repeat: 'none', interval: 1, byday: [], until: null, count: 0, skip: [] };
    const anchor = pt ? { x: pt.x, y: pt.y } : anchorEl ? anchorEl.getBoundingClientRect() : { x: window.innerWidth / 2, y: 140 };
    editEvent(ev, true, anchor);
  }
  function openEvent(ev, occStart, rect) { if (ev) editEvent(ev, false, rect, occStart); }
  const toLocalInput = (ms) => pad2(new Date(ms).getHours()) + ':' + pad2(new Date(ms).getMinutes());
  function editEvent(ev, isNew, anchor, occStart) {
    const draft = JSON.parse(JSON.stringify(ev));
    const recurring = ev.repeat && ev.repeat !== 'none';
    const swatches = PAL.map((c) => '<button type="button" class="sw' + (c === draft.color ? ' on' : '') + '" data-c="' + c + '" style="background:' + c + '" aria-label="Color ' + c + '"></button>').join('');
    const html = '<div class="pp-h"><input class="pp-title" id="evTitle" placeholder="Event title" value="' + esc(draft.title) + '" aria-label="Event title"><button class="pl-ic" data-x aria-label="Close">' + ic(ICON.x) + '</button></div>' +
      '<div class="pp-grid"><label>Date<input type="date" id="evDate" value="' + ymd(draft.start) + '"></label><label class="pp-chk in"><input type="checkbox" id="evAll"' + (draft.allDay ? ' checked' : '') + '> All day</label>' +
      '<label class="tm">Start<input type="time" id="evS" value="' + toLocalInput(draft.start) + '"></label><label class="tm">End<input type="time" id="evE" value="' + toLocalInput(draft.end) + '"></label>' +
      '<label>Repeat<select id="evRep">' + opt([['none', 'Does not repeat'], ['daily', 'Daily'], ['workdays', 'Every working day'], ['weekly', 'Weekly'], ['monthly', 'Monthly']], draft.repeat || 'none') + '</select></label>' +
      '<label>Until<input type="date" id="evUntil" value="' + (draft.until ? ymd(draft.until) : '') + '"></label></div>' +
      '<div class="pp-sw">' + swatches + '</div>' +
      '<label class="pp-chk"><input type="checkbox" id="evBlk"' + (draft.blocks !== false ? ' checked' : '') + '> Blocks scheduling (tasks are planned around it)</label>' +
      '<div class="pp-act"><button class="pl-btn pri" id="evSave">' + (isNew ? 'Create' : 'Save') + '</button>' + (isNew ? '' : '<button class="pl-btn danger" id="evDel">Delete' + (recurring ? ' series' : '') + '</button>') + (recurring && occStart ? '<button class="pl-btn" id="evSkip">Skip this one</button>' : '') + '</div>';
    openPop(anchor, html, (el) => {
      const upd = () => { const all = $('#evAll', el).checked; $$('.tm', el).forEach((x) => { x.style.display = all ? 'none' : ''; }); };
      upd();
      $('#evAll', el).onchange = () => { upd(); $('#evBlk', el).checked = !$('#evAll', el).checked; };
      el.querySelector('.pp-sw').addEventListener('click', (e) => { const b = e.target.closest('.sw'); if (!b) return; draft.color = b.dataset.c; $$('.sw', el).forEach((x) => x.classList.toggle('on', x === b)); });
      const title = $('#evTitle', el);
      if (isNew) setTimeout(() => title.focus(), 0);
      title.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#evSave', el).click(); });
      $('#evSave', el).onclick = () => {
        const d = fromYmd($('#evDate', el).value) || sod(new Date()), all = $('#evAll', el).checked;
        draft.title = title.value.trim() || '(no title)'; draft.allDay = all; draft.blocks = $('#evBlk', el).checked;
        if (all) { draft.start = d.getTime(); draft.end = addDays(d, 1).getTime(); }
        else { draft.start = atMin(d, hm($('#evS', el).value)); draft.end = atMin(d, hm($('#evE', el).value)); if (draft.end <= draft.start) draft.end = draft.start + 30 * MIN; }
        draft.repeat = $('#evRep', el).value;
        const u = fromYmd($('#evUntil', el).value); draft.until = u ? u.getTime() : null;
        if (draft.repeat === 'weekly' && !(draft.byday && draft.byday.length)) draft.byday = [new Date(draft.start).getDay()];
        if (isNew) P.events.push(draft); else { const i = P.events.findIndex((x) => x.id === ev.id); if (i >= 0) P.events[i] = draft; }
        closePop(); refresh(true);
      };
      const del = $('#evDel', el);
      if (del) del.onclick = () => { const snapshot = JSON.stringify(ev); P.events = P.events.filter((x) => x.id !== ev.id); closePop(); refresh(true); toast('Event deleted', { actionLabel: 'Undo', onAction: () => { P.events.push(JSON.parse(snapshot)); refresh(true); } }); };
      const sk = $('#evSkip', el);
      if (sk) sk.onclick = () => { const e0 = P.events.find((x) => x.id === ev.id); if (e0) (e0.skip = e0.skip || []).push(ymd(occStart)); closePop(); refresh(true); };
    });
  }

  /* recurring tasks */
  function editRecurring(rec) {
    const isNew = !rec;
    const r = rec ? JSON.parse(JSON.stringify(rec)) : { id: 'x' + uid(), title: '', project: '', dur: 30, priority: 'Medium', repeat: 'workdays', interval: 1, byday: [], start: ymd(Date.now()), until: null };
    const S = P.settings;
    const days = [0, 1, 2, 3, 4, 5, 6].map((i) => (S.weekStart + i) % 7).map((d) => '<button type="button" class="dchip' + ((r.byday || []).includes(d) ? ' on' : '') + '" data-d="' + d + '">' + DOW[d] + '</button>').join('');
    openModal(isNew ? 'New recurring task' : 'Edit recurring task',
      '<div class="pp-grid one"><label>Title<input id="rcTitle" value="' + esc(r.title) + '" placeholder="e.g. Daily KPI review"></label>' +
      '<label>Project<input id="rcProj" value="' + esc(r.project || '') + '" placeholder="optional"></label></div>' +
      '<div class="pp-grid"><label>Duration<select id="rcDur">' + durOpts(r.dur) + '</select></label><label>Priority<select id="rcPri">' + opt([['High', 'High'], ['Medium', 'Medium'], ['Low', 'Low']], r.priority) + '</select></label>' +
      '<label>Repeat<select id="rcRep">' + opt([['daily', 'Every day'], ['workdays', 'Every working day'], ['weekly', 'Weekly'], ['monthly', 'Monthly']], r.repeat) + '</select></label>' +
      '<label>Every<input type="number" min="1" max="12" id="rcInt" value="' + (r.interval || 1) + '"></label>' +
      '<label>Starts<input type="date" id="rcStart" value="' + esc(r.start) + '"></label><label>Until<input type="date" id="rcUntil" value="' + (r.until ? ymd(r.until) : '') + '"></label></div>' +
      '<div class="pp-days" id="rcDays">' + days + '</div><div class="pp-note">Each day it repeats, the task is planned into free time that day, around your meetings.</div>' +
      '<div class="pp-act"><button class="pl-btn pri" id="rcSave">' + (isNew ? 'Create' : 'Save') + '</button>' + (isNew ? '' : '<button class="pl-btn danger" id="rcDel">Delete</button>') + '</div>',
      (bg) => {
        const sync = () => { $('#rcDays', bg).style.display = $('#rcRep', bg).value === 'weekly' ? '' : 'none'; };
        sync(); $('#rcRep', bg).onchange = sync;
        $('#rcDays', bg).addEventListener('click', (e) => { const b = e.target.closest('.dchip'); if (b) b.classList.toggle('on'); });
        $('#rcSave', bg).onclick = () => {
          r.title = $('#rcTitle', bg).value.trim();
          if (!r.title) { $('#rcTitle', bg).focus(); return; }
          r.project = $('#rcProj', bg).value.trim(); r.dur = +$('#rcDur', bg).value; r.priority = $('#rcPri', bg).value; r.repeat = $('#rcRep', bg).value;
          r.interval = Math.max(1, +$('#rcInt', bg).value || 1); r.start = $('#rcStart', bg).value || ymd(Date.now());
          const u = fromYmd($('#rcUntil', bg).value); r.until = u ? u.getTime() : null;
          r.byday = $$('.dchip.on', bg).map((b) => +b.dataset.d);
          if (isNew) P.recurring.push(r); else { const i = P.recurring.findIndex((x) => x.id === r.id); if (i >= 0) P.recurring[i] = r; }
          closeModal(); refresh(true);
        };
        const d = $('#rcDel', bg);
        if (d) d.onclick = () => { P.recurring = P.recurring.filter((x) => x.id !== r.id); closeModal(); refresh(true); };
        $('#rcTitle', bg).focus();
      });
  }

  /* quick add */
  function parseDay(s) {
    s = String(s || '').trim().toLowerCase();
    const t = sod(new Date());
    if (s === 'today') return ymd(t);
    if (s === 'tomorrow' || s === 'tmr') return ymd(addDays(t, 1));
    let m = s.match(/^\+(\d+)d?$/);
    if (m) return ymd(addDays(t, +m[1]));
    m = s.match(/^\+(\d+)w$/);
    if (m) return ymd(addDays(t, 7 * +m[1]));
    const names = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    if (/^[a-z]{3,9}$/.test(s) && names.indexOf(s.slice(0, 3)) >= 0) return ymd(addDays(t, ((names.indexOf(s.slice(0, 3)) - t.getDay() + 7) % 7) || 7));
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    m = s.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/);
    if (m) { let y = m[3] ? +m[3] : t.getFullYear(); if (y < 100) y += 2000; const d = new Date(y, +m[2] - 1, +m[1]); if (d.getMonth() === +m[2] - 1) return ymd(d); }
    return null;
  }
  function matchVal(colName, raw) {
    const q = String(raw || '').replace(/_/g, ' ').trim(), vals = typeof uniqueVals === 'function' ? uniqueVals(colName) : [];
    return vals.find((v) => v.toLowerCase() === q.toLowerCase()) || vals.find((v) => v.toLowerCase().indexOf(q.toLowerCase()) === 0) || q;
  }
  function createTask(o) {
    const ic0 = col('Index'), now = new Date();
    const next = Math.max(0, ...ROWS.map((r) => Number(r[ic0]) || 0)) + 1;
    const row = HEADERS.map((h) => {
      switch (h) {
        case 'Index': return next; case 'Task': return o.title; case 'Topic': return o.topic || ''; case 'Project': return o.project || '';
        case 'Period': return now.getFullYear() + ' Q' + Math.ceil((now.getMonth() + 1) / 3); case 'Month': return now.toLocaleString('en-US', { month: 'long' });
        case 'Status': return 'Not Started'; case 'Progress %': return 0; case 'Priority': return o.pri || 'Medium';
        case 'Start Date': return ymd(now); case 'Due Date': return o.due || ''; default: return '';
      }
    });
    ROWS.push(row);
    if (o.dur) setMeta(String(next), { dur: o.dur });
    return String(next);
  }
  async function quickAdd() {
    const input = $('#plQuick');
    let t = ' ' + input.value + ' ';
    if (!input.value.trim()) return;
    const o = {};
    t = t.replace(/\s(\d+(?:\.\d+)?)\s?(h|hr|hrs|hours?|m|min|mins|minutes?)(?=\s)/i, (m, n, u) => { o.dur = Math.max(15, Math.round((parseFloat(n) * (/^h/i.test(u) ? 60 : 1)) / 15) * 15); return ' '; });
    t = t.replace(/\s!(high|medium|med|low)(?=\s)/i, (m, p) => { o.pri = /^h/i.test(p) ? 'High' : /^l/i.test(p) ? 'Low' : 'Medium'; return ' '; });
    t = t.replace(/\sdue:(\S+)/i, (m, d) => { o.due = parseDay(d); return ' '; });
    t = t.replace(/\s#"([^"]+)"|\s#(\S+)/, (m, a, b) => { o.topic = matchVal('Topic', a || b); return ' '; });
    t = t.replace(/\s@"([^"]+)"|\s@(\S+)/, (m, a, b) => { o.project = matchVal('Project', a || b); return ' '; });
    const title = t.replace(/\s+/g, ' ').trim();
    if (!title) return;
    if (o.due === null) { toast('I could not read that due date. Try due:fri, due:+3d or due:2026-10-20.', { type: 'error' }); return; }
    const key = createTask({ title, dur: o.dur, pri: o.pri, due: o.due, topic: o.topic, project: o.project });
    const next = key;
    input.value = '';
    await commitChange();
    if (P.settings.auto) { clearTimeout(dcT); P.dirty = false; refresh(); }
    const b = nextBlockOf(next);
    toast(b ? 'Added and planned for ' + whenText(b.s) : P.settings.auto ? 'Added. No free slot in the next 8 weeks.' : 'Added. Press Re-plan to schedule it.');
  }

  /* settings, menu, import/export */
  function openMenu(btn) {
    const r = btn.getBoundingClientRect();
    openPop({ left: r.left, right: r.left, top: r.bottom + 4 },
      '<div class="pp-menu"><button data-m="print">Print daily pages…</button><button data-m="imp">Import calendar (.ics)</button><button data-m="exp">Export calendar and plan (.ics)</button><button data-m="off">Add time off</button><button data-m="clr">Clear the auto-plan</button></div>',
      (el) => {
        el.classList.add('menu');
        el.addEventListener('click', (e) => {
          const b = e.target.closest('[data-m]');
          if (!b) return;
          const k = b.dataset.m;
          closePop();
          if (k === 'print') { if (window.printpages) window.printpages.open(); }
          else if (k === 'imp') importIcs();
          else if (k === 'exp') exportIcs();
          else if (k === 'off') { const d = sod(P.anchor); const ev = { id: 'e' + uid(), title: 'Time off', start: d.getTime(), end: addDays(d, 1).getTime(), allDay: true, blocks: true, color: '#64748B', repeat: 'none', interval: 1, byday: [], until: null, count: 0, skip: [] }; editEvent(ev, true, { x: r.left, y: r.bottom + 20 }); }
          else if (k === 'clr') { P.autoBlocks = []; refresh(true); }
        });
      });
  }
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function exportIcs() {
    const now = Date.now(), blocks = allBlocks().filter((b) => !b.done && b.e > now);
    const text = E.buildIcs({ events: P.events, blocks, titleOf: (k) => (info(k) || {}).title || k, settings: P.settings, now });
    download('task-progress-plan.ics', text, 'text/calendar');
    toast('Exported ' + P.events.length + ' events and ' + blocks.length + ' planned task blocks');
  }
  function importIcs() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.ics,text/calendar';
    inp.onchange = () => {
      const f = inp.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        const evs = E.parseIcs(String(rd.result));
        let added = 0, replaced = 0;
        evs.forEach((ev) => {
          const i = ev.uid ? P.events.findIndex((x) => x.uid === ev.uid) : -1;
          if (i >= 0) { ev.id = P.events[i].id; P.events[i] = ev; replaced++; } else { P.events.push(ev); added++; }
        });
        refresh(true);
        toast(evs.length ? 'Imported ' + added + ' events' + (replaced ? ' (' + replaced + ' updated)' : '') : 'No events found in that file', evs.length ? undefined : { type: 'error' });
      };
      rd.readAsText(f);
    };
    inp.click();
  }
  function openSettings() {
    const S = P.settings;
    const dayChips = [0, 1, 2, 3, 4, 5, 6].map((i) => (S.weekStart + i) % 7).map((d) => '<button type="button" class="dchip' + (S.days.includes(d) ? ' on' : '') + '" data-d="' + d + '">' + DOW[d] + '</button>').join('');
    const ch = [15, 30, 45, 60, 90, 120, 180, 240].map((v) => [v, fmtDur(v)]);
    openModal('Planner settings',
      '<div class="pp-sec">Working hours</div><div class="pp-grid"><label>Start<input type="time" data-s="workStart" value="' + S.workStart + '"></label><label>End<input type="time" data-s="workEnd" value="' + S.workEnd + '"></label></div>' +
      '<div class="pp-days" id="stDays">' + dayChips + '</div>' +
      '<label class="pp-chk"><input type="checkbox" data-s="lunch"' + (S.lunch ? ' checked' : '') + '> Keep a break free</label><div class="pp-grid"><label>Break from<input type="time" data-s="lunchStart" value="' + S.lunchStart + '"></label><label>Break to<input type="time" data-s="lunchEnd" value="' + S.lunchEnd + '"></label></div>' +
      '<div class="pp-sec">Scheduling</div><div class="pp-grid"><label>Default task length<select data-s="defaultDur" data-n="1">' + opt(ch, S.defaultDur) + '</select></label><label>Gap between items<select data-s="buffer" data-n="1">' + opt([[0, 'None'], [5, '5 min'], [10, '10 min'], [15, '15 min'], [30, '30 min']], S.buffer) + '</select></label>' +
      '<label>Shortest chunk<select data-s="minChunk" data-n="1">' + opt(ch, S.minChunk) + '</select></label><label>Longest chunk<select data-s="maxChunk" data-n="1">' + opt(ch, S.maxChunk) + '</select></label></div>' +
      '<label class="pp-chk"><input type="checkbox" data-s="auto"' + (S.auto ? ' checked' : '') + '> Auto-schedule after every change</label>' +
      '<div class="pp-sec">Display</div><div class="pp-grid"><label>Week starts on<select data-s="weekStart" data-n="1">' + opt([[0, 'Sunday'], [1, 'Monday'], [6, 'Saturday']], S.weekStart) + '</select></label><label>Hour height<input type="range" min="36" max="100" step="4" data-s="hourPx" data-n="1" value="' + S.hourPx + '"></label></div>' +
      '<label class="pp-chk"><input type="checkbox" data-s="notify"' + (S.notify ? ' checked' : '') + '> Notify me when a task block starts</label>' +
      feedSection() + '<div class="pp-act"><button class="pl-btn" id="stReset">Reset to defaults</button><button class="pl-btn danger" id="stWipe">Delete all planner data</button></div>',
      (bg) => {
        const done = () => { if (S.days.length === 0) S.days = [0]; refresh(true); };
        bg.addEventListener('change', (e) => {
          const k = e.target.dataset.s;
          if (!k) return;
          S[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.dataset.n ? +e.target.value : e.target.value;
          if (k === 'notify' && S.notify && window.Notification && Notification.permission === 'default') Notification.requestPermission();
          done();
        });
        $('#stDays', bg).addEventListener('click', (e) => { const b = e.target.closest('.dchip'); if (!b) return; const d = +b.dataset.d; S.days = S.days.includes(d) ? S.days.filter((x) => x !== d) : S.days.concat([d]).sort(); b.classList.toggle('on'); done(); });
        bg.addEventListener('input', (e) => { if (e.target.dataset.s === 'hourPx') { S.hourPx = +e.target.value; renderCal(); } });
        bindFeed(bg);
        $('#stReset', bg).onclick = () => { Object.assign(P.settings, mkDefaults()); closeModal(); refresh(true); };
        $('#stWipe', bg).onclick = () => { if (confirm('Delete all events, recurring tasks, pins and settings of the planner? Your task table is not touched.')) { P.events = []; P.meta = {}; P.recurring = []; P.past = []; P.doneOcc = {}; P.autoBlocks = []; Object.assign(P.settings, mkDefaults()); closeModal(); refresh(true); } };
      });
  }
  function toast(msg, opts) { if (typeof showToast === 'function') showToast(msg, opts); }


  /* ---------- calendar feed (desktop builds) ---------- */
  const hasFeed = () => !!(window.desktop && window.desktop.feed);
  const feedOn = () => hasFeed() && feedCfg().on;
  const randToken = () => { const a = new Uint8Array(12); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); };
  function buildFeedIcs() {
    const now = Date.now(), cfg = feedCfg();
    const blocks = allBlocks(true).filter((b) => !b.done && b.e > now - 7 * DAY);
    return E.buildIcs({ events: P.events, blocks, titleOf: (k) => (info(k) || {}).title || k, settings: P.settings, now, name: 'Task Progress plan', refreshMinutes: 15, hideTitles: !cfg.titles });
  }
  let fpT = null;
  function feedPush() {
    if (!feedOn()) return;
    clearTimeout(fpT);
    fpT = setTimeout(() => { try { window.desktop.feed.update(buildFeedIcs()); } catch (e) { /* the feed is best effort */ } }, 800);
  }
  async function feedApply() {
    if (!hasFeed()) return null;
    const cfg = feedCfg();
    if (cfg.on && !cfg.token) { cfg.token = randToken(); P.settings.feed = cfg; save(); }
    let st;
    try {
      st = await window.desktop.feed.configure({ on: cfg.on, lan: cfg.lan, port: cfg.port, token: cfg.token });
      if (cfg.on) await window.desktop.feed.update(buildFeedIcs());
    } catch (e) { st = { running: false, error: String((e && e.message) || e), urls: [] }; }
    return st;
  }
  function feedSection() {
    if (!hasFeed()) return '';
    const f = feedCfg();
    return '<div class="pp-sec">Calendar link</div>' +
      '<label class="pp-chk"><input type="checkbox" id="fdOn"' + (f.on ? ' checked' : '') + '> Share my plan as a calendar you can subscribe to</label>' +
      '<div id="fdBody"' + (f.on ? '' : ' hidden') + '><div class="pp-grid"><label>Who can open it<select id="fdScope">' + opt([[0, 'This computer only'], [1, 'Devices on my network']], f.lan ? 1 : 0) + '</select></label>' +
      '<label>Port<input type="number" id="fdPort" min="1024" max="65535" value="' + f.port + '"></label></div>' +
      '<label class="pp-chk"><input type="checkbox" id="fdTitles"' + (f.titles ? ' checked' : '') + '> Show task names (otherwise tasks appear as Busy)</label>' +
      '<div id="fdUrls" class="fd-urls"></div><div class="pp-note" id="fdNote"></div><div class="pp-act"><button class="pl-btn" id="fdNew" type="button">Make a new link</button></div></div>';
  }
  function bindFeed(bg) {
    if (!hasFeed()) return;
    const body = $('#fdBody', bg), urls = $('#fdUrls', bg), note = $('#fdNote', bg), f = () => feedCfg();
    const show = (st) => {
      const cfg = f();
      if (!cfg.on || !st) { urls.innerHTML = ''; note.textContent = ''; return; }
      if (st.error) { urls.innerHTML = '<div class="fd-err">' + esc(st.error) + '</div>'; note.textContent = 'Try another port.'; return; }
      const list = (st.urls || []).slice();
      urls.innerHTML = list.map((u) => '<div class="fd-row"><code>' + esc(u) + '</code><button class="pl-btn" type="button" data-copy="' + esc(u) + '">Copy</button></div>').join('') +
        (list[0] ? '<div class="fd-row"><code>' + esc(list[0].replace(/^http:/, 'webcal:')) + '</code><button class="pl-btn" type="button" data-copy="' + esc(list[0].replace(/^http:/, 'webcal:')) + '">Copy</button></div>' : '');
      note.textContent = (cfg.lan ? 'Anyone on your network who has this link can read your plan, so keep it private. Windows may ask to let the app through its firewall. ' : 'Outlook on this computer can subscribe to it. To use it on a phone, choose "Devices on my network". ') + 'Calendars refresh on their own schedule, often every few hours.';
    };
    const apply = async () => { const st = await feedApply(); show(st); };
    const set = (patch) => { P.settings.feed = Object.assign(f(), patch); save(); return apply(); };
    $('#fdOn', bg).onchange = (e) => { body.hidden = !e.target.checked; set({ on: e.target.checked }); };
    $('#fdScope', bg).onchange = (e) => set({ lan: e.target.value === '1' });
    $('#fdPort', bg).onchange = (e) => set({ port: Math.min(65535, Math.max(1024, parseInt(e.target.value, 10) || 8765)) });
    $('#fdTitles', bg).onchange = (e) => set({ titles: e.target.checked });
    $('#fdNew', bg).onclick = () => set({ token: randToken() });
    urls.addEventListener('click', (e) => { const b = e.target.closest('[data-copy]'); if (b && navigator.clipboard) { navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1200); } });
    if (f().on) apply();
  }

  /* ---------- AI planning assistant ---------- */
  const fmtDay = (ms) => { const d = new Date(ms); return DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MONS[d.getMonth()].slice(0, 3); };
  const parseHM = (x) => { const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(String(x == null ? '' : x).trim()); if (!m) return null; const h = +m[1], mi = +(m[2] || 0); return h > 24 || mi > 59 ? null : h * 60 + mi; };
  const asMin = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? Math.max(15, Math.round(n / 15) * 15) : null; };
  const normPri = (v) => { const q = String(v || '').toLowerCase(); return q.indexOf('h') === 0 ? 'High' : q.indexOf('l') === 0 ? 'Low' : q.indexOf('m') === 0 ? 'Medium' : null; };
  const ALIAS = { wip: 'In Progress', doing: 'In Progress', progress: 'In Progress', finished: 'Done', complete: 'Done', completed: 'Done', blocked: 'Suspended', paused: 'Suspended', hold: 'Suspended', todo: 'Not Started', new: 'Not Started' };
  const normStatus = (v) => { const q = String(v || '').toLowerCase().replace(/[_-]/g, ' ').trim(); if (!q) return null; return STATUSES.find((x) => x.toLowerCase() === q) || STATUSES.find((x) => x.toLowerCase().indexOf(q) === 0) || ALIAS[q] || null; };
  const asProg = (v) => { const n = Number(v); if (!Number.isFinite(n)) return null; return Math.min(1, Math.max(0, n > 1 ? n / 100 : n)); };
  const dateOf = (v) => { const y = v ? (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : parseDay(v)) : null; return y && fromYmd(y) ? y : null; };

  function weekEnd() { const t = sod(new Date()), diff = (t.getDay() - P.settings.weekStart + 7) % 7; return ymd(addDays(t, 6 - diff)); }
  function findEvents(match, date) {
    const m = String(match || '').toLowerCase().trim();
    if (!m) return [];
    return P.events.filter((ev) => ev.title.toLowerCase().indexOf(m) >= 0).filter((ev) => {
      const d = date ? fromYmd(date) : null;
      return !d || E.occurrences(ev, d.getTime(), addDays(d, 1).getTime(), P.settings).length > 0;
    });
  }
  function keyOf(v) {
    const k = String(v == null ? '' : v).trim();
    if (!P.rowMap.has(k)) throw new Error('There is no task #' + k);
    return k;
  }
  const rowOf = (k) => P.rowMap.get(k);
  function matchedKeys(a) {
    const out = [];
    if (a.task != null && a.task !== '') { out.push(keyOf(a.task)); return out; }
    (P.itemList || []).concat(Object.keys(P.items).map((k) => P.items[k]).filter((x) => x.manual)).forEach((it) => {
      const inf = info(it.key);
      if (inf && inf.kind === 'row' && !out.includes(it.key) && matchSpec(a, inf, ROWS[inf.row])) out.push(it.key);
    });
    return out;
  }

  async function runAction(a, cx) {
    const t = String(a.type || a.action || '').toLowerCase().replace(/[\s-]/g, '_');
    switch (t) {
      case 'add_event': {
        const d = fromYmd(dateOf(a.date)), s = parseHM(a.start);
        if (!d) throw new Error('Event "' + (a.title || '') + '" needs a valid date');
        let e = parseHM(a.end);
        const allDay = a.all_day === true || a.allDay === true;
        if (!allDay && s == null) throw new Error('Event "' + (a.title || '') + '" needs a start time');
        if (!allDay && (e == null || e <= s)) e = s + 60;
        const rep = ['daily', 'workdays', 'weekly', 'monthly'].includes(a.repeat) ? a.repeat : 'none';
        const until = dateOf(a.until);
        const ev = { id: 'e' + uid(), title: String(a.title || 'Event').slice(0, 120), start: allDay ? d.getTime() : atMin(d, s), end: allDay ? addDays(d, 1).getTime() : atMin(d, e), allDay, blocks: a.blocks !== false, color: '#0284C7', repeat: rep, interval: Math.max(1, parseInt(a.interval, 10) || 1), byday: rep === 'weekly' ? [d.getDay()] : [], until: until ? fromYmd(until).getTime() : null, count: 0, skip: [] };
        P.events.push(ev);
        return 'Added event "' + ev.title + '", ' + fmtDay(ev.start) + (allDay ? ', all day' : ' ' + T(ev.start) + ' to ' + T(ev.end)) + (rep !== 'none' ? ' (repeats ' + rep + ')' : '');
      }
      case 'time_off': {
        const from = fromYmd(dateOf(a.from || a.date)), to = fromYmd(dateOf(a.to || a.from || a.date));
        if (!from) throw new Error('Time off needs a start date');
        const end = to && to >= from ? to : from;
        P.events.push({ id: 'e' + uid(), title: String(a.title || 'Time off').slice(0, 120), start: from.getTime(), end: addDays(end, 1).getTime(), allDay: true, blocks: true, color: '#64748B', repeat: 'none', interval: 1, byday: [], until: null, count: 0, skip: [] });
        return 'Time off ' + fmtDay(from.getTime()) + (end > from ? ' to ' + fmtDay(end.getTime()) : '') + ': nothing will be planned then';
      }
      case 'delete_event': {
        const found = findEvents(a.match, dateOf(a.date));
        if (!found.length) throw new Error('No event matches "' + (a.match || '') + '"');
        const ev = found[0], day = dateOf(a.date);
        if (ev.repeat && ev.repeat !== 'none' && day) { (ev.skip = ev.skip || []).push(day); return 'Removed "' + ev.title + '" on ' + fmtDay(fromYmd(day).getTime()) + ' only'; }
        P.events = P.events.filter((x) => x.id !== ev.id);
        return 'Deleted event "' + ev.title + '"';
      }
      case 'move_event': {
        const found = findEvents(a.match, dateOf(a.date));
        if (!found.length) throw new Error('No event matches "' + (a.match || '') + '"');
        const ev = found[0], nd = fromYmd(dateOf(a.to_date || a.date)), s = parseHM(a.start);
        if (!nd) throw new Error('Moving "' + ev.title + '" needs a new date');
        const dur = ev.end - ev.start, from = dateOf(a.date);
        let e = parseHM(a.end);
        const ns = s != null ? atMin(nd, s) : atMin(nd, new Date(ev.start).getHours() * 60 + new Date(ev.start).getMinutes());
        const ne = e != null && s != null && e > s ? atMin(nd, e) : ns + dur;
        if (ev.repeat && ev.repeat !== 'none' && from) {
          (ev.skip = ev.skip || []).push(from);
          P.events.push(Object.assign({}, JSON.parse(JSON.stringify(ev)), { id: 'e' + uid(), start: ns, end: ne, repeat: 'none', skip: [], until: null, count: 0 }));
        } else { ev.start = ns; ev.end = ne; }
        return 'Moved "' + ev.title + '" to ' + fmtDay(ns) + ' ' + T(ns) + ' to ' + T(ne);
      }
      case 'add_task': {
        const title = String(a.title || a.task || '').trim();
        if (!title) throw new Error('A new task needs a title');
        const key = createTask({ title: title.slice(0, 200), dur: asMin(a.duration_min || a.duration), pri: normPri(a.priority), due: dateOf(a.due), topic: a.topic ? matchVal('Topic', a.topic) : '', project: a.project ? matchVal('Project', a.project) : '' });
        const patch = {}, st = normStatus(a.status), pr = a.progress != null ? asProg(a.progress) : null;
        if (st) patch.Status = st;
        if (pr != null) patch['Progress %'] = pr; else if (st === 'Done') patch['Progress %'] = 1;
        if (a.comment) patch['Comment / Conclusion'] = String(a.comment).slice(0, 400);
        refreshRowMap();
        if (Object.keys(patch).length) patchRow(rowOf(key), patch);
        cx.rows = true;
        return 'Added task #' + key + ' "' + title + '"' + (patch.Status ? ' (' + patch.Status + ')' : '');
      }
      case 'update_task': {
        const key = keyOf(a.task), i = rowOf(key), patch = {}, bits = [];
        const st = normStatus(a.status), pr = a.progress != null ? asProg(a.progress) : null, pri = normPri(a.priority), due = dateOf(a.due);
        if (st) { patch.Status = st; bits.push(st); if (st === 'Done' && pr == null) patch['Progress %'] = 1; }
        if (pr != null) { patch['Progress %'] = pr; bits.push(Math.round(pr * 100) + '%'); }
        if (pri) { patch.Priority = pri; bits.push(pri + ' priority'); }
        if (due) { patch['Due Date'] = due; bits.push('due ' + due); }
        if (a.title) patch.Task = String(a.title).slice(0, 200);
        if (a.comment) { const c = col('Comment / Conclusion'), before = c >= 0 ? ROWS[i][c] : ''; patch['Comment / Conclusion'] = before ? before + ' — ' + a.comment : String(a.comment); bits.push('note added'); }
        const dm = asMin(a.duration_min || a.duration);
        if (dm) { setMeta(key, { dur: dm }); bits.push(fmtDur(dm) + ' estimate'); }
        patchRow(i, patch); cx.rows = true;
        return 'Updated #' + key + ' "' + info(key).title + '": ' + (bits.join(', ') || 'no changes');
      }
      case 'pin': {
        const key = keyOf(a.task), d = fromYmd(dateOf(a.date)), s = parseHM(a.start);
        if (!d || s == null) throw new Error('Pinning #' + key + ' needs a date and a start time');
        const it = P.items[key], e = parseHM(a.end);
        const len = e != null && e > s ? e - s : Math.max(15, Math.min((it && it.remaining) || durOf(key), P.settings.maxChunk));
        const m = P.meta[key] || (P.meta[key] = {});
        (m.pinned = m.pinned || []).push({ s: atMin(d, s), e: atMin(d, s + len) });
        return 'Pinned "' + info(key).title + '" to ' + fmtDay(atMin(d, s)) + ' ' + T(atMin(d, s)) + ' to ' + T(atMin(d, s + len));
      }
      case 'unpin': {
        const key = keyOf(a.task);
        setMeta(key, { pinned: null });
        return 'Unpinned "' + info(key).title + '"; the planner will place it again';
      }
      case 'focus': {
        const f = { topic: a.topic ? String(a.topic) : '', project: a.project ? String(a.project) : '', text: a.text ? String(a.text) : '', until: dateOf(a.until) || weekEnd() };
        if (!f.topic && !f.project && !f.text) throw new Error('Focus needs a topic, project or text to match');
        P.focus = f;
        return 'Focus on ' + focusLabel() + ' until ' + fmtDay(fromYmd(f.until).getTime()) + ': those tasks are planned first';
      }
      case 'clear_focus': P.focus = null; return 'Focus cleared';
      case 'prioritize': {
        const pri = normPri(a.priority);
        if (!pri) throw new Error('Prioritize needs High, Medium or Low');
        const keys = matchedKeys(a).slice(0, 40);
        if (!keys.length) throw new Error('No open task matches that');
        keys.forEach((k) => patchRow(rowOf(k), { Priority: pri }));
        cx.rows = true;
        return pri + ' priority set on ' + keys.length + (keys.length === 1 ? ' task' : ' tasks');
      }
      case 'say': return { text: String(a.text || '').slice(0, 300), info: true };
      case 'replan': return null;
      default: throw new Error('I did not understand the action "' + (a.type || a.action || '?') + '"');
    }
  }

  const snapshotPlanner = () => JSON.stringify({ events: P.events, meta: P.meta, recurring: P.recurring, doneOcc: P.doneOcc, past: P.past, focus: P.focus });
  async function applyActions(actions, say) {
    await ensureLoaded();
    refreshRowMap();
    const snap = snapshotPlanner(), cx = { rows: false }, lines = [];
    const list = Array.isArray(actions) ? actions.slice(0, 25) : [];
    for (const a of list) {
      try {
        const r = await runAction(a || {}, cx);
        if (r) lines.push(typeof r === 'string' ? { ok: true, text: r } : { ok: true, info: true, text: r.text });
      } catch (e) { lines.push({ ok: false, text: String((e && e.message) || e) }); }
    }
    const changed = lines.some((l) => l.ok && !l.info);
    let hist = null;
    if (cx.rows) { await commitChange(); hist = typeof HISTORY_INDEX !== 'undefined' ? HISTORY_INDEX : null; }
    refresh(true);
    if (changed) {
      P.lastAssist = { snap, rows: cx.rows, hist };
      const a2 = attention();
      lines.push({ ok: true, info: true, text: a2.late.length ? 'Plan updated: ' + a2.late.length + (a2.late.length === 1 ? ' task is' : ' tasks are') + ' at risk of missing a deadline.' : 'Plan updated: everything fits before its deadline.' });
    }
    return { say: say || '', lines, undo: !!P.lastAssist };
  }
  function undoAssist() {
    const la = P.lastAssist;
    if (!la) return { ok: false };
    const o = JSON.parse(la.snap);
    P.events = o.events; P.meta = o.meta; P.recurring = o.recurring; P.doneOcc = o.doneOcc; P.past = o.past; P.focus = o.focus;
    let rows = false, warn = null;
    if (la.rows) {
      if (typeof HISTORY_INDEX !== 'undefined' && HISTORY_INDEX === la.hist) { const b = document.getElementById('undoBtn'); if (b) { b.click(); rows = true; } }
      else warn = 'Your task table changed after that, so I left the table alone. Use Ctrl+Z for the table.';
    }
    P.lastAssist = null;
    refresh(true);
    return { ok: true, rows, warn };
  }

  function assistSystem() {
    const now = new Date(), S = P.settings, today = sod(now);
    const cal = [];
    for (let i = 0; i < 14; i++) { const d = addDays(today, i); cal.push(DOW[d.getDay()] + ' ' + ymd(d) + (S.days.includes(d.getDay()) ? '' : ' (day off)') + (i === 0 ? ' (today)' : '')); }
    const a = today.getTime(), b = addDays(today, 21).getTime(), evs = [];
    P.events.forEach((ev) => { const o = E.occurrences(ev, a, b, S)[0]; if (o) evs.push(ev.id + ' | ' + ev.title + ' | ' + ymd(o.s) + (ev.allDay ? ' all day' : ' ' + T(o.s) + '-' + T(o.e)) + (ev.repeat && ev.repeat !== 'none' ? ' | repeats ' + ev.repeat : '')); });
    const rows = (P.itemList || []).concat(Object.keys(P.items).map((k) => P.items[k]).filter((x) => x.manual)).map((it) => ({ it, inf: info(it.key) })).filter((x) => x.inf && x.inf.kind === 'row')
      .sort((x, y) => (x.inf.due || '9999').localeCompare(y.inf.due || '9999') || x.it.pri - y.it.pri).slice(0, 60);
    const tasks = rows.map(({ it, inf }) => { const nb = nextBlockOf(it.key); return it.key + ' | ' + inf.title.slice(0, 70) + ' | ' + (ROWS[inf.row][col('Topic')] || '-') + ' | ' + (ROWS[inf.row][col('Project')] || '-') + ' | ' + inf.status + ' | ' + Math.round(inf.prog * 100) + '% | ' + inf.priority + ' | due ' + (inf.due || '-') + ' | ' + (it.dur || durOf(it.key)) + ' min | ' + (nb ? 'next ' + ymd(nb.s) + ' ' + T(nb.s) : 'not planned'); });
    let tue = ymd(addDays(today, 1));
    for (let i = 1; i <= 7; i++) { const d = addDays(today, i); if (d.getDay() === 2) { tue = ymd(d); break; } }
    return [
      'You are the planning assistant inside a task planner for a telecom RAN/NPM engineer. You change the plan by returning actions.',
      'Reply with ONLY one JSON object, no markdown: {"say":"<one short sentence>","actions":[...]}.',
      'Now: ' + DOW[now.getDay()] + ' ' + ymd(now) + ' ' + T(now.getTime()) + '. Working hours ' + S.workStart + ' to ' + S.workEnd + ' on working days.',
      'The planner schedules every open task into free time around events automatically. So when you add events or change tasks, everything else re-flows by itself: never move tasks one by one.',
      '', 'Calendar (use these exact dates):', cal.join('\n'), '', 'Events (id | title | next date and time):', evs.join('\n') || '(none)', '',
      'Open tasks (id | title | topic | project | status | progress | priority | due | estimate | next planned):', tasks.join('\n') || '(none)', '',
      'Focus now: ' + (focusOn() ? focusLabel() + ' until ' + P.focus.until : 'none'), '',
      'Actions. Dates are YYYY-MM-DD, times are HH:MM in 24h:',
      '{"type":"add_event","title":"..","date":"..","start":"..","end":"..","repeat":"none|daily|workdays|weekly|monthly"}  a meeting, or time that must stay free',
      '{"type":"time_off","title":"..","from":"..","to":".."}',
      '{"type":"delete_event","match":"words from the title","date":"optional"}',
      '{"type":"move_event","match":"words from the title","date":"optional original date","to_date":"..","start":"..","end":".."}',
      '{"type":"add_task","title":"..","duration_min":60,"priority":"High|Medium|Low","due":"..","project":"..","topic":"..","status":"optional","progress":"optional 0-100","comment":"optional"}',
      '{"type":"update_task","task":<id>,"status":"Not Started|In Progress|Done|Suspended","progress":0-100,"comment":"..","priority":"..","due":"..","duration_min":60}',
      '{"type":"pin","task":<id>,"date":"..","start":"HH:MM","end":"HH:MM optional"}  fix a task at a time',
      '{"type":"unpin","task":<id>}',
      '{"type":"focus","topic":"..","project":"..","text":"..","until":"optional"}  plan matching tasks first; does not change the table',
      '{"type":"clear_focus"}',
      '{"type":"prioritize","topic":"..","project":"..","text":"..","task":<id>,"priority":"High|Medium|Low"}  changes the Priority column',
      '', 'Rules: use only task ids and event ids listed above and never invent one. Resolve weekdays with the calendar. If the user only reports work done, use update_task on the best matching task (or add_task if none matches). If it is a question, answer it in "say" with no actions. Keep "say" under 25 words.',
      '', 'Examples:',
      'User: I have a customer call Tuesday 10 to 12, move everything else',
      '{"say":"Blocked Tuesday 10:00 to 12:00; your other tasks will re-flow around it.","actions":[{"type":"add_event","title":"Customer call","date":"' + tue + '","start":"10:00","end":"12:00"}]}',
      'User: plan my week, VoLTE first',
      '{"say":"VoLTE tasks are planned first this week.","actions":[{"type":"focus","topic":"VoLTE"}]}',
      'User: finished the drive test, waiting on the X2 config',
      '{"say":"Logged progress on the drive test.","actions":[{"type":"update_task","task":<id of the matching task>,"status":"In Progress","progress":70,"comment":"Drive test done, waiting on X2 config"}]}'
    ].join('\n');
  }
  async function assist(text) {
    await ensureLoaded();
    computePlan(P.settings.auto);
    refreshRowMap();
    const obj = await callLLM(text, { system: assistSystem(), json: true });
    let actions = obj && obj.actions;
    if (!Array.isArray(actions)) {
      actions = [];
      if (obj && obj.action === 'update' && Number.isInteger(obj.taskIndex) && ROWS[obj.taskIndex]) actions = [{ type: 'update_task', task: ROWS[obj.taskIndex][col('Index')], status: obj.Status, progress: typeof obj.Progress === 'number' ? obj.Progress * 100 : undefined, comment: obj.Comment }];
      else if (obj && obj.action === 'add') actions = [{ type: 'add_task', title: obj.Task, topic: obj['Sub-Topic'] ? obj.Topic : obj.Topic, project: obj.Project, status: obj.Status, progress: typeof obj.Progress === 'number' ? obj.Progress * 100 : undefined, comment: obj.Comment }];
    }
    return applyActions(actions, obj && typeof obj.say === 'string' ? obj.say : '');
  }

  /* ---------- keyboard, timers ---------- */
  document.addEventListener('keydown', (e) => {
    if (!active() || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable || MODAL || POP) return;
    const k = e.key.toLowerCase();
    if (k === 't') { P.anchor = sod(new Date()); P.mini = sod(P.anchor); render(true); }
    else if (k === 'd' || k === 'w' || k === 'm') { P.view = { d: 'day', w: 'week', m: 'month' }[k]; save(); render(true); }
    else if (e.key === 'ArrowLeft') navigate(-1);
    else if (e.key === 'ArrowRight') navigate(1);
    else if (k === 'a') { refresh(true); toast('Plan rebuilt'); }
    else if (k === 'n') { e.preventDefault(); newEventAt(null, null); }
    else if (k === '+' || k === '=') timeZoom(8);
    else if (k === '-') timeZoom(-8);
    else return;
    e.preventDefault();
  });
  window.addEventListener('resize', () => { if (P.ready && active()) { const sc = $('.pl-scroll', $('#plCal')); if (sc) $('#plCal').style.setProperty('--sb', (sc.offsetWidth - sc.clientWidth) + 'px'); } });

  const notified = new Set();
  let ticks = 0;
  setInterval(() => {
    if (!P.loaded) return;
    ticks++;
    const now = Date.now();
    if (active()) {
      const line = $('.pl-col.today .pl-now');
      if (line) line.style.top = slotY((now - sod(now).getTime()) / MIN) + 'px';
    }
    if (ticks % 10 === 0 && P.settings.auto) { computePlan(true); if (P.ready && active()) render(); save(); feedPush(); }
    if (P.settings.notify && window.Notification && Notification.permission === 'granted') {
      allBlocks().forEach((b) => {
        const id = b.key + '@' + b.s;
        if (!b.done && b.s <= now + 60000 && b.s > now - 60000 && !notified.has(id)) {
          notified.add(id);
          const inf = info(b.key);
          if (inf) new Notification(inf.title, { body: T(b.s) + ' to ' + T(b.e) });
        }
      });
    }
  }, 30000);


  /* ---------- right-click menus ---------- */
  const SEP = '-';
  const mi = (label, run, o) => Object.assign({ label, run }, o || {});
  const CNAMES = ['Blue', 'Orange', 'Green', 'Purple', 'Red', 'Teal', 'Gold', 'Pink', 'Slate', 'Sky'];
  const dayStr = (n) => ymd(addDays(sod(new Date()), n));
  function setPri(key, p) { const inf = info(key); if (!inf) return; if (inf.kind === 'rec') { inf.rec.priority = p; save(); refresh(true); } else updateRow(inf.row, { Priority: p }); }
  function setDur(key, m) { const inf = info(key); if (!inf) return; if (inf.kind === 'rec') { inf.rec.dur = m; save(); } else setMeta(key, { dur: m }); refresh(true); }
  const curDur = (key) => { const inf = info(key); return inf && inf.kind === 'rec' ? inf.rec.dur : durOf(key); };
  const blkOf = (el) => ({ s: +el.dataset.s, e: +el.dataset.e, pin: el.classList.contains('pin'), pi: el.dataset.pi, done: el.dataset.done === '1', past: el.classList.contains('past') });
  const copy = (t) => { if (window.ctxmenu) window.ctxmenu.copyText(t); };

  function taskMenu(key, blk, el) {
    const inf = info(key);
    if (!inf) return null;
    const m = P.meta[key] || {}, isRec = inf.kind === 'rec', out = [];
    const anchor = el ? el.getBoundingClientRect() : { x: 220, y: 150 };
    const done = (blk && blk.done) || (!isRec && inf.status === 'Done');
    out.push(mi('Details and planning…', () => openTask(key, anchor, blk && !blk.done ? blk : nextBlockOf(key)), { icon: 'edit' }));
    out.push(mi(done ? 'Reopen' : 'Mark as done', () => toggleDone(key, blk ? blk.s : Date.now(), blk ? blk.e : Date.now(), !!done), { icon: 'check' }));
    out.push(SEP);
    if (blk && !blk.done && !blk.past) {
      out.push(blk.pin
        ? mi('Unpin this block', () => { const mm = P.meta[key]; if (mm && mm.pinned) { mm.pinned.splice(+blk.pi, 1); setMeta(key, {}); } refresh(true); }, { icon: 'pin' })
        : mi('Pin to this time', () => { const mm = P.meta[key] || (P.meta[key] = {}); (mm.pinned = mm.pinned || []).push({ s: blk.s, e: blk.e }); refresh(true); }, { icon: 'pin' }));
      out.push(mi('Move to', null, { children: [['Tomorrow', 1], ['In 2 days', 2], ['Next week', 7]].map(([l, n]) => mi(l, () => { const ns = addDays(new Date(blk.s), n).getTime(); commitTaskMove(key, blk.pi, blk.s, blk.e, ns, ns + (blk.e - blk.s)); })) }));
    }
    if ((m.pinned || []).length) out.push(mi('Unpin all blocks', () => { setMeta(key, { pinned: null }); refresh(true); }));
    out.push(mi('Time estimate', null, { children: [15, 30, 45, 60, 90, 120, 180, 240, 480].map((d) => mi(fmtDur(d), () => setDur(key, d), { checked: curDur(key) === d })) }));
    out.push(mi('Priority', null, { children: ['High', 'Medium', 'Low'].map((p) => mi(p, () => setPri(key, p), { checked: inf.priority === p })) }));
    if (!isRec) {
      out.push(mi('Deadline', null, { children: [['Today', 0], ['Tomorrow', 1], ['In 3 days', 3], ['In a week', 7]].map(([l, n]) => mi(l, () => updateRow(inf.row, { 'Due Date': dayStr(n) }), { checked: inf.due === dayStr(n) })).concat([SEP, mi('Clear deadline', () => updateRow(inf.row, { 'Due Date': '' }), { disabled: !inf.due })]) }));
      out.push(mi('Do not auto-schedule', () => { setMeta(key, { manual: !m.manual }); refresh(true); }, { checked: !!m.manual }));
    } else {
      out.push(mi('Skip this day', () => { P.doneOcc[key] = true; refresh(true); }));
      out.push(mi('Edit series…', () => editRecurring(inf.rec)));
      out.push(mi('Delete series…', () => { if (confirm('Delete the recurring task "' + inf.rec.title + '"?')) { P.recurring = P.recurring.filter((x) => x.id !== inf.rec.id); refresh(true); } }, { danger: true }));
    }
    out.push(SEP);
    if (!isRec) {
      if (window.evidence) out.push(mi('Evidence…', () => window.evidence.openFor(key, inf.title), { icon: 'clip' }));
      if (typeof showSubtasks === 'function') out.push(mi('Sub-tasks…', () => showSubtasks(inf.row), { icon: 'list' }));
      if (typeof showRowHistory === 'function') out.push(mi('Change history', () => showRowHistory(inf.row), { icon: 'hist' }));
      if (window.ctxmenu) out.push(mi('Show in table', () => window.ctxmenu.showInTable(key), { icon: 'list' }));
    }
    out.push(mi('Copy title', () => copy(inf.title), { icon: 'copy' }));
    if (!isRec && typeof deleteRow === 'function') out.push(SEP, mi('Delete task…', () => deleteRow(inf.row), { icon: 'trash', danger: true }));
    return out;
  }
  function eventMenu(id, occ, el) {
    const ev = P.events.find((x) => x.id === id);
    if (!ev) return null;
    const rec = !!(ev.repeat && ev.repeat !== 'none'), r = el.getBoundingClientRect();
    return [
      mi('Edit…', () => openEvent(ev, occ, r), { icon: 'edit' }),
      mi('Duplicate to the next day', () => { const c = JSON.parse(JSON.stringify(ev)), len = ev.end - ev.start; c.id = 'e' + uid(); c.repeat = 'none'; c.skip = []; c.until = null; c.count = 0; c.title = ev.title + ' (copy)'; c.start = addDays(new Date(rec ? occ : ev.start), 1).getTime(); c.end = c.start + len; P.events.push(c); refresh(true); toast('Event duplicated'); }),
      SEP,
      mi('Color', null, { children: PAL.map((c, i) => mi(CNAMES[i], () => { ev.color = c; refresh(true); }, { swatch: c, checked: ev.color === c })) }),
      mi('Blocks scheduling', () => { ev.blocks = ev.blocks === false; refresh(true); }, { checked: ev.blocks !== false }),
      mi('Copy title', () => copy(ev.title), { icon: 'copy' }),
      SEP,
      rec ? mi('Delete this occurrence', () => { (ev.skip = ev.skip || []).push(ymd(occ)); refresh(true); }, { danger: true }) : null,
      mi(rec ? 'Delete the whole series…' : 'Delete event', () => { const snapshot = JSON.stringify(ev); P.events = P.events.filter((x) => x.id !== ev.id); refresh(true); toast('Event deleted', { actionLabel: 'Undo', onAction: () => { P.events.push(JSON.parse(snapshot)); refresh(true); } }); }, { icon: 'trash', danger: true })
    ];
  }
  function dayMenu(day, pt) {
    const d = sod(day);
    return [
      mi('New event this day…', () => { const s = atMin(d, hm(P.settings.workStart)); newEventAt({ s, e: s + 60 * MIN }, null, pt); }, { icon: 'plus' }),
      mi('Add a task due this day', () => { const q = $('#plQuick'); if (!q) return; if (!P.settings.sidebar) { P.settings.sidebar = true; pane().classList.remove('no-side'); } q.value = '  due:' + ymd(d) + ' '; q.focus(); q.setSelectionRange(0, 0); }),
      mi('Mark as time off', () => editEvent({ id: 'e' + uid(), title: 'Time off', start: d.getTime(), end: addDays(d, 1).getTime(), allDay: true, blocks: true, color: '#64748B', repeat: 'none', interval: 1, byday: [], until: null, count: 0, skip: [] }, true, pt)),
      SEP,
      mi('Print this day…', () => window.printpages && window.printpages.open({ start: d, days: 1 }), { icon: 'dl' }),
      mi('Open day view', () => { P.anchor = d; P.mini = d; P.view = 'day'; save(); render(true); }),
      mi('Go to today', () => { P.anchor = sod(new Date()); P.mini = sod(new Date()); render(true); })
    ];
  }
  function plannerMenu() {
    const setV = (v) => { P.view = v; save(); render(true); };
    return [
      mi('Day', () => setV('day'), { checked: P.view === 'day' }), mi('Week', () => setV('week'), { checked: P.view === 'week' }), mi('Month', () => setV('month'), { checked: P.view === 'month' }),
      SEP,
      mi('Auto-schedule', () => { P.settings.auto = !P.settings.auto; if (P.settings.auto) refresh(true); else { save(); render(); } }, { checked: !!P.settings.auto }),
      mi('Re-plan now', () => { refresh(true); toast('Plan rebuilt'); }, { icon: 'refresh' }),
      mi('Stretch the time scale', () => timeZoom(8), { icon: 'plus' }), mi('Shrink the time scale', () => timeZoom(-8), { icon: 'minus' }),
      SEP,
      mi('New event…', () => newEventAt(null, null), { icon: 'plus' }),
      mi('Planner settings…', () => openSettings(), { icon: 'edit' }),
      mi('Print daily pages…', () => window.printpages && window.printpages.open(), { icon: 'dl' }),
      mi('Import calendar (.ics)…', () => importIcs()), mi('Export calendar and plan (.ics)', () => exportIcs(), { icon: 'dl' })
    ];
  }
  (window.__ctxProviders = window.__ctxProviders || []).push({
    name: 'planner',
    build(t, ev) {
      if (!P.ready || !pane() || !pane().contains(t)) return null;
      const blk = t.closest('.pl-blk');
      if (blk) return blk.dataset.type === 'ev' ? eventMenu(blk.dataset.id, +blk.dataset.occ, blk) : taskMenu(blk.dataset.k, blkOf(blk), blk);
      const chip = t.closest('.pl-chip');
      if (chip) return chip.dataset.type === 'ev' ? eventMenu(chip.dataset.id, +chip.dataset.occ, chip) : taskMenu(chip.dataset.k, null, chip);
      const side = t.closest('.pl-task[data-k]');
      if (side) return taskMenu(side.dataset.k, null, side);
      const rec = t.closest('.pl-rec[data-rec]');
      if (rec) {
        const r0 = P.recurring.find((x) => x.id === rec.dataset.rec);
        return r0 ? [mi('Edit…', () => editRecurring(r0), { icon: 'edit' }), mi('Delete…', () => { if (confirm('Delete the recurring task "' + r0.title + '"?')) { P.recurring = P.recurring.filter((x) => x.id !== r0.id); refresh(true); } }, { icon: 'trash', danger: true })] : null;
      }
      const pt = { x: ev.clientX, y: ev.clientY };
      const md = t.closest('.md[data-md]');
      if (md) return dayMenu(new Date(+md.dataset.md), pt);
      const col0 = t.closest('.pl-col');
      if (col0) {
        const ds = new Date(+col0.dataset.ds), m = Math.max(0, Math.min(24 * 60 - 15, snap(minAt(ev.clientY, col0)))), s = atMin(ds, m);
        return [mi('New event at ' + T(s) + '…', () => newEventAt({ s, e: s + 60 * MIN }, null, pt), { icon: 'plus' })].concat([SEP], dayMenu(ds, pt));
      }
      const dc = t.closest('.pl-mcell[data-day], .pl-dh[data-day], .pl-ad[data-day]');
      if (dc) return dayMenu(new Date(+dc.dataset.day), pt);
      if (t.closest('#plBar, #plCal, .pl-main')) return plannerMenu();
      return null;
    }
  });


  /* ---------- data for printed daily pages ---------- */
  function dayData(startMs, count) {
    const S = P.settings, blocks = allBlocks(true), out = [], first = sod(startMs);
    const openRows = [];
    if (typeof ROWS !== 'undefined') ROWS.forEach((r) => { const inf = info(String(r[col('Index')])); if (inf && inf.kind === 'row' && !OPEN_NOT.includes(inf.status)) openRows.push(inf); });
    const noteOf = (inf) => {
      if (inf.kind !== 'row') return '';
      const c = col('Comment / Conclusion');
      let t = c >= 0 ? String(ROWS[inf.row][c] || '').replace(/\s+/g, ' ').trim() : '';
      if (t.indexOf(' — ') >= 0) t = t.slice(t.lastIndexOf(' — ') + 3);
      return t.slice(0, 160);
    };
    const brief = (inf) => ({ key: inf.key, title: inf.title, project: inf.project, priority: inf.priority, due: inf.due, color: colorOf(inf.project), status: inf.status, prog: inf.prog, note: noteOf(inf) });
    for (let i = 0; i < count; i++) {
      const d = addDays(first, i), ds = d.getTime(), de = addDays(d, 1).getTime(), k = ymd(d);
      const events = [];
      P.events.forEach((ev) => E.occurrences(ev, ds, de, S).forEach((o) => events.push({ title: ev.title, allDay: !!ev.allDay, s: Math.max(o.s, ds), e: Math.min(o.e, de), color: ev.color || '#0284C7' })));
      const tasks = [];
      blocks.forEach((b) => {
        if (b.done || b.e <= ds || b.s >= de) return;
        const inf = info(b.key);
        if (!inf) return;
        tasks.push({ key: b.key, title: inf.title, project: inf.project, color: colorOf(inf.project), s: Math.max(b.s, ds), e: Math.min(b.e, de), late: !!b.late, rec: inf.kind === 'rec', priority: inf.priority, status: inf.status, prog: inf.kind === 'row' ? inf.prog : null, due: inf.kind === 'row' ? inf.due : null, note: noteOf(inf) });
      });
      const due = openRows.filter((inf) => inf.due === k).map(brief);
      const completed = [];
      const seenDone = new Set();
      if (typeof ROWS !== 'undefined') {
        ROWS.forEach((r, ri) => {
          if (r[col('Status')] !== 'Done') return;
          let ts = null;
          try { ts = LAST_EDITED_TS[rowHistoryKey(ri)]; } catch (e) { ts = null; }
          if (ts && ts >= ds && ts < de) { const inf = info(String(r[col('Index')])); if (inf && !seenDone.has(inf.key)) { seenDone.add(inf.key); completed.push(brief(inf)); } }
        });
      }
      P.past.forEach((p) => { if (p.s >= ds && p.s < de && !seenDone.has(p.key)) { const inf = info(p.key); if (inf && inf.kind === 'row') { seenDone.add(inf.key); completed.push(brief(inf)); } } });
      const routine = P.recurring
        .filter((rec) => E.matchRule(rec, fromYmd(rec.start) || first, d, S) && !P.doneOcc['r:' + rec.id + ':' + k] && !tasks.some((t) => t.key === 'r:' + rec.id + ':' + k))
        .map((rec) => ({ title: rec.title, dur: rec.dur, project: rec.project || '', color: colorOf(rec.project) }));
      out.push({ date: ds, working: S.days.includes(d.getDay()), events, tasks, due, completed, routine });
    }
    const overdue = openRows.filter((inf) => inf.due && fromYmd(inf.due) && fromYmd(inf.due).getTime() < first.getTime()).sort((a, b) => a.due.localeCompare(b.due)).map(brief);
    return { days: out, overdue, work: { start: S.workStart, end: S.workEnd, lunch: S.lunch, lunchStart: S.lunchStart, lunchEnd: S.lunchEnd }, weekStart: S.weekStart };
  }

  /* ---------- public API (used by the console) ---------- */
  function agenda(offset) {
    const d = addDays(sod(new Date()), offset || 0), items = dayItems(d, allBlocks());
    return items.sort((a, b) => a.s - b.s).map((i) => ({ s: i.s, e: i.e, type: i.type, title: i.type === 'ev' ? i.ev.title : (i.b.done ? i.b.title : (info(i.b.key) || {}).title) || '?', late: i.type === 'task' && !!i.b.late, done: i.type === 'task' && !!i.b.done }));
  }
  const api = {
    ready: ensureLoaded,
    // called by sync after data from another device was written to storage
    reload: async () => { if (!P.loaded) return; await load(); refreshRowMap(); P.planned = false; P.dirty = true; if (P.ready && active()) refresh(true); else if (feedOn()) { computePlan(true); feedPush(); } },
    replan: async () => { await ensureLoaded(); refresh(true); const a = attention(); return { atRisk: a.late.length, unscheduled: a.un.length, blocks: allBlocks().filter((b) => !b.done && b.e > Date.now()).length }; },
    agenda: async (off) => { await ensureLoaded(); computePlan(P.settings.auto); return agenda(off); },
    assist,
    act: (actions) => applyActions(actions, ''),
    dayData: async (start, count) => { await ensureLoaded(); refreshRowMap(); computePlan(P.settings.auto); return dayData(start, count); },
    openModal: (title, html, mount) => openModal(title, html, mount),
    closeModal: () => closeModal(),
    updateRow,
    setDuration: async (key, m) => { await ensureLoaded(); refreshRowMap(); setDur(key, m); },
    details: async (key, anchor) => { await ensureLoaded(); refreshRowMap(); computePlan(P.settings.auto); openTask(String(key), anchor || { x: 220, y: 150 }, nextBlockOf(String(key))); },
    jump: async (key) => {
      key = String(key);
      if (!active() && typeof switchTab === 'function') switchTab('planner');
      await loadOnce();
      for (let i = 0; i < 40 && !P.ready; i++) await new Promise((r) => setTimeout(r, 50));
      computePlan(P.settings.auto);
      const b = nextBlockOf(key);
      if (!b) { toast('That task has no planned time yet.'); return; }
      P.anchor = sod(b.s); P.mini = sod(b.s);
      if (P.view === 'month') P.view = 'week';
      render(true);
      const sc = $('.pl-scroll', $('#plCal'));
      if (sc) sc.scrollTop = Math.max(0, slotY((b.s - sod(b.s).getTime()) / MIN - 90));
      const el = $$('.pl-blk.task', $('#plCal')).find((e) => e.dataset.k === key && +e.dataset.s === b.s);
      if (el) { el.classList.add('pl-hit'); setTimeout(() => el.classList.remove('pl-hit'), 2200); }
    },
    canUndoAssist: () => !!P.lastAssist,
    undoAssist,
    titleOf: (k) => (info(k) || {}).title
  };
  window.planner = api;
  window.__planner = true;

  /* ---------- install into the dashboard ---------- */
  function focusTop() {
    const b = $('#tabBar');
    if (b) window.scrollTo({ top: Math.max(0, b.getBoundingClientRect().top + window.scrollY - (document.body.classList.contains('desktop') ? 46 : 10)) });
  }
  async function activate() {
    if (!pane()) return;
    if (!P.ready) {
      build();
      await loadOnce();
      P.ready = true;
      computePlan(P.settings.auto || !P.autoBlocks.length);
      render(true);
      P.dirty = false;
      focusTop();
      feedPush();
      return;
    }
    if (P.dirty) { P.dirty = false; refresh(); } else { computePlan(P.settings.auto); render(); }
    focusTop();
    const sc = $('.pl-scroll', $('#plCal'));
    if (sc && !sc.scrollTop) sc.scrollTop = Math.max(0, slotY(hm(P.settings.workStart) - 60));
  }

  function install() {
    const bar = $('#tabBar'), today = $('#tab-today');
    if (!bar || !today) return;
    const btn = document.createElement('button');
    btn.className = 'tab-btn'; btn.dataset.tab = 'planner';
    btn.innerHTML = '<span class="tab-ic">' + ic(ICON.cal) + '</span> Planner';
    bar.querySelector('[data-tab="today"]').after(btn);
    btn.onclick = () => switchTab('planner');
    const p = document.createElement('div');
    p.id = 'tab-planner'; p.className = 'tab-content';
    today.after(p);

    const st = window.switchTab;
    window.switchTab = function (name) { const r = st.apply(this, arguments); if (name === 'planner') activate(); return r; };
    ['commitChange', 'renderAll'].forEach((fn) => {
      const orig = window[fn];
      if (typeof orig !== 'function') return;
      window[fn] = function () {
        const r = orig.apply(this, arguments);
        if (r && typeof r.then === 'function') r.then(dataChanged, dataChanged); else dataChanged();
        return r;
      };
    });
    if (hasFeed()) setTimeout(async () => { try { await ensureLoaded(); await feedApply(); } catch (e) { /* feed is optional */ } }, 1500);
    // if the dashboard last closed on the planner tab, restore it
    Promise.resolve().then(() => AppStorage.get('last-tab', false)).then((r) => { if (r && r.value === 'planner') window.switchTab('planner'); }).catch(() => {});
  }
  install();
})();
