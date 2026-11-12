/* Right-click menus. One engine, and a list of providers: each provider looks at what was clicked and returns menu items.
   planner.js and evidence.js register their own providers in window.__ctxProviders; the built-in ones below cover the
   dashboard (table rows, cards, Today items), text fields, the console, tabs, movable windows and the rest of the page. */
(() => {
  'use strict';
  if (window.ctxmenu) return;
  const $ = (s, r) => (r || document).querySelector(s);
  const toast = (m, o) => { if (typeof showToast === 'function') showToast(m, o); };
  const SEP = '-';
  const mi = (label, run, o) => Object.assign({ label, run }, o || {});
  window.__ctxProviders = window.__ctxProviders || [];

  /* ---------- icons ---------- */
  const IC = {
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>', pin: '<path d="M12 17v5M9 3h6l-1 6 3 3H7l3-3z"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
    clip: '<path d="M21 12.5l-8.6 8.6a5 5 0 01-7.1-7.1l9-9a3.3 3.3 0 014.7 4.7l-9 9a1.7 1.7 0 01-2.4-2.4l8.3-8.3"/>',
    cal: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    hist: '<path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>', list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>',
    zin: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.5-4.5M11 8v6M8 11h6"/>', zout: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.5-4.5M8 11h6"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>', redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/>',
    term: '<path d="M4 17l6-5-6-5M12 19h8"/>', refresh: '<path d="M21 12a9 9 0 11-3-6.7L21 8"/><path d="M21 3v5h-5"/>', ai: '<path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>',
    dl: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>', plus: '<path d="M12 5v14M5 12h14"/>', home: '<path d="M4 11l8-7 8 7v9H4z"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
    move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>', sel: '<path d="M4 4h16v16H4z" stroke-dasharray="3 3"/>'
  };
  const icon = (n) => IC[n] ? '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[n] + '</svg>' : '';
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- engine ---------- */
  let M = null;
  function close() {
    if (!M) return;
    M.lists.forEach((l) => l.el.remove());
    document.removeEventListener('pointerdown', M.out, true); document.removeEventListener('keydown', M.key, true);
    window.removeEventListener('blur', close); window.removeEventListener('resize', close);
    document.removeEventListener('wheel', M.wheel, true);
    clearTimeout(M.hover);
    const back = M.returnFocus; M = null;
    if (back && back.isConnected && back.focus) { try { back.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }
  function clean(items) {
    const out = [];
    (items || []).forEach((it) => { if (!it) return; if (it === SEP && (!out.length || out[out.length - 1] === SEP)) return; out.push(it); });
    while (out.length && out[out.length - 1] === SEP) out.pop();
    return out;
  }
  function buildList(items, depth) {
    const el = document.createElement('div');
    el.className = 'cm'; el.setAttribute('role', 'menu'); el.dataset.depth = depth;
    items = clean(items);
    items.forEach((it) => {
      if (it === SEP) { const s = document.createElement('div'); s.className = 'cm-sep'; s.setAttribute('role', 'separator'); el.appendChild(s); return; }
      const d = document.createElement('div');
      d.className = 'cm-it' + (it.danger ? ' danger' : '') + (it.disabled ? ' off' : '');
      d.setAttribute('role', it.checked != null ? 'menuitemcheckbox' : 'menuitem'); d.tabIndex = -1;
      if (it.disabled) d.setAttribute('aria-disabled', 'true');
      if (it.checked != null) d.setAttribute('aria-checked', it.checked ? 'true' : 'false');
      const lead = it.swatch ? '<i class="cm-sw" style="background:' + esc(it.swatch) + '"></i>' : it.icon ? icon(it.icon) : '';
      d.innerHTML = '<span class="cm-ck">' + (it.checked ? icon('check') : lead) + '</span><span class="cm-lb">' + esc(it.label) + '</span>' +
        (it.hint ? '<span class="cm-hint">' + esc(it.hint) + '</span>' : '') + (it.children ? '<span class="cm-ar">&rsaquo;</span>' : '');
      d._it = it;
      el.appendChild(d);
    });
    return el;
  }
  function place(el, x, y) {
    document.body.appendChild(el);
    const w = el.offsetWidth, h = el.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    if (h > vh - 8) { el.style.maxHeight = (vh - 8) + 'px'; el.style.overflowY = 'auto'; }
    el.style.left = Math.max(4, Math.min(x, vw - el.offsetWidth - 4)) + 'px';
    el.style.top = Math.max(4, Math.min(y, vh - el.offsetHeight - 4)) + 'px';
  }
  function run(d) {
    const it = d._it;
    if (!it || it.disabled) return;
    if (it.children) { const sub = openSub(d, +d.parentNode.dataset.depth); const f = sub && enabledItems(sub)[0]; if (f) f.focus(); return; }
    close();
    try { const r = it.run && it.run(); if (r && r.catch) r.catch((e) => toast(String((e && e.message) || e), { type: 'error' })); } catch (e) { toast(String((e && e.message) || e), { type: 'error' }); }
  }
  function onOver(e) {
    const d = e.target.closest('.cm-it');
    if (!d || !M) return;
    const depth = +d.parentNode.dataset.depth;
    clearTimeout(M.hover);
    M.hover = setTimeout(() => {
      if (!M) return;
      if (d._it && d._it.children) { if (!d.classList.contains('open')) openSub(d, depth); }
      else closeFrom(depth + 1);
    }, 110);
    if (!d.classList.contains('off')) d.focus({ preventScroll: true });
  }
  function wire(el) {
    el.addEventListener('mouseover', onOver);
    el.addEventListener('click', (e) => { const d = e.target.closest('.cm-it'); if (d) run(d); });
  }
  function openSub(parentEl, depth) {
    closeFrom(depth + 1);
    const it = parentEl._it;
    if (!it || !it.children || it.disabled) return null;
    const el = buildList(typeof it.children === 'function' ? it.children() : it.children, depth + 1);
    wire(el);
    const r = parentEl.getBoundingClientRect();
    place(el, r.right - 3, r.top - 5);
    if (r.right - 3 + el.offsetWidth > window.innerWidth - 4) el.style.left = Math.max(4, r.left - el.offsetWidth + 3) + 'px';
    M.lists[depth + 1] = { el, parent: parentEl };
    M.lists.length = depth + 2;
    parentEl.classList.add('open');
    return el;
  }
  function closeFrom(depth) {
    while (M && M.lists.length > depth) { const l = M.lists.pop(); l.el.remove(); if (l.parent) l.parent.classList.remove('open'); }
  }
  const enabledItems = (el) => Array.from(el.querySelectorAll('.cm-it:not(.off)'));
  function show(x, y, items, opts) {
    close();
    items = clean(items);
    if (!items.length) return;
    const el = buildList(items, 0);
    wire(el);
    place(el, x, y);
    M = { lists: [{ el }], returnFocus: document.activeElement, hover: null };
    M.out = (e) => { if (!e.target.closest || !e.target.closest('.cm')) close(); };
    M.wheel = (e) => { if (!e.target.closest || !e.target.closest('.cm')) close(); };
    M.key = (e) => {
      if (!M) return;
      const active = document.activeElement && document.activeElement.closest ? document.activeElement.closest('.cm') : null;
      const depth = active ? +active.dataset.depth : M.lists.length - 1;
      const list = (M.lists[depth] || M.lists[0]).el, its = enabledItems(list), cur = its.indexOf(document.activeElement);
      const stop = () => { e.preventDefault(); e.stopPropagation(); };
      if (e.key === 'Escape') { stop(); if (depth > 0) { const p = M.lists[depth].parent; closeFrom(depth); if (p) p.focus(); } else close(); }
      else if (e.key === 'ArrowDown') { stop(); (its[(cur + 1) % its.length] || its[0]).focus(); }
      else if (e.key === 'ArrowUp') { stop(); (its[(cur - 1 + its.length) % its.length] || its[its.length - 1]).focus(); }
      else if (e.key === 'Home') { stop(); if (its[0]) its[0].focus(); }
      else if (e.key === 'End') { stop(); if (its.length) its[its.length - 1].focus(); }
      else if (e.key === 'ArrowRight') { stop(); const d = document.activeElement; if (d && d._it && d._it.children) { const sub = openSub(d, depth); const f = sub && enabledItems(sub)[0]; if (f) f.focus(); } }
      else if (e.key === 'ArrowLeft') { stop(); if (depth > 0) { const p = M.lists[depth].parent; closeFrom(depth); if (p) p.focus(); } }
      else if (e.key === 'Enter' || e.key === ' ') { stop(); const d = document.activeElement; if (d && d._it) run(d); }
      else if (e.key === 'Tab') { stop(); close(); }
    };
    document.addEventListener('pointerdown', M.out, true);
    document.addEventListener('keydown', M.key, true);
    document.addEventListener('wheel', M.wheel, { capture: true, passive: true });
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    if (opts && opts.focus) { const f = enabledItems(el)[0]; if (f) f.focus(); }
  }

  /* ---------- helpers for the built-in menus ---------- */
  const col = (n) => { try { return colIdx(n); } catch (e) { return -1; } };
  const STATUSES = ['Not Started', 'In Progress', 'Done', 'Suspended', 'Routine'];
  const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const dayPlus = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return ymd(d); };
  const fmtDur = (m) => { const h = Math.floor(m / 60), r = m % 60; return h ? (r ? h + 'h ' + r + 'm' : h + 'h') : r + 'm'; };
  async function patchRow(i, patch) {
    const r = ROWS[i];
    if (!r) return;
    Object.keys(patch).forEach((name) => {
      const c = col(name);
      if (c < 0) return;
      const before = r[c];
      r[c] = patch[name];
      try { LAST_EDITED_TS[rowHistoryKey(i)] = Date.now(); saveLastEditedTs(); } catch (e) { /* best effort */ }
      try { logRowChange(i, name, before, patch[name]); } catch (e) { /* best effort */ }
    });
    await commitChange();
  }
  const rowByKey = (k) => { const c = col('Index'); return c < 0 ? -1 : ROWS.findIndex((r) => String(r[c]) === String(k)); };
  const keyOfRow = (i) => { const c = col('Index'); return String(c >= 0 ? ROWS[i][c] : i + 1); };
  const titleOfRow = (r) => r[col('Task')] || r[col('Sub-Topic')] || '(untitled)';
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); toast('Copied'); }
    catch (e) { const ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('Copied'); } catch (e2) { toast('Could not copy', { type: 'error' }); } ta.remove(); }
  }
  function flash(el) { if (!el) return; el.classList.remove('cm-flash'); void el.offsetWidth; el.classList.add('cm-flash'); setTimeout(() => el.classList.remove('cm-flash'), 2200); }
  function showInTable(key) {
    const i = rowByKey(key);
    if (typeof switchTab === 'function') switchTab('board');
    if (typeof setView === 'function') { try { setView('table'); } catch (e) { /* ignore */ } }
    setTimeout(() => {
      const tr = document.querySelector('#bodyRows tr[data-row-i="' + i + '"]');
      if (!tr) { toast('That row is hidden by a filter or the current view.'); return; }
      tr.scrollIntoView({ block: 'center', behavior: 'smooth' }); flash(tr);
    }, 120);
  }

  /* ---------- text fields ---------- */
  const isTextField = (t) => t && t.closest && t.closest('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]):not([type=button]), textarea, [contenteditable="true"], [contenteditable=""]');
  function textItems(t) {
    const f = isTextField(t);
    if (!f) return null;
    const ro = f.readOnly || f.disabled || f.getAttribute('contenteditable') === 'false';
    const selected = () => (f.selectionStart != null && f.selectionStart !== f.selectionEnd) || (!!window.getSelection && String(window.getSelection()).length > 0 && f.isContentEditable);
    const has = selected();
    const focusIt = () => { try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ } };
    return [
      mi('Undo', () => { focusIt(); document.execCommand('undo'); }, { icon: 'undo', disabled: ro, hint: 'Ctrl+Z' }),
      SEP,
      mi('Cut', () => { focusIt(); document.execCommand('cut'); }, { disabled: ro || !has, hint: 'Ctrl+X' }),
      mi('Copy', () => { focusIt(); document.execCommand('copy'); }, { icon: 'copy', disabled: !has, hint: 'Ctrl+C' }),
      mi('Paste', async () => {
        focusIt();
        try { const txt = await navigator.clipboard.readText(); document.execCommand('insertText', false, txt); }
        catch (e) { toast('Press Ctrl+V to paste here.'); }
      }, { disabled: ro, hint: 'Ctrl+V' }),
      mi('Select all', () => { focusIt(); if (f.select && f.tagName !== 'DIV') f.select(); else document.execCommand('selectAll'); }, { hint: 'Ctrl+A' })
    ];
  }

  /* ---------- dashboard tasks: table rows, cards, Today items ---------- */
  function rowIndexOf(t) {
    const tr = t.closest('#bodyRows tr[data-row-i]');
    if (tr) return +tr.dataset.rowI;
    const card = t.closest('.task-card[data-k]');
    if (card) return rowByKey(card.dataset.k);
    const f = t.closest('[data-focus-row]');
    if (f) return +f.dataset.focusRow;
    return -1;
  }
  function taskItems(i, from) {
    const r = ROWS[i];
    if (!r) return null;
    const key = keyOfRow(i), P = window.planner, status = r[col('Status')], pri = r[col('Priority')], due = r[col('Due Date')];
    const done = status === 'Done', title = titleOfRow(r);
    const set = (patch) => patchRow(i, patch);
    const out = [];
    out.push(mi(done ? 'Reopen' : 'Mark as done', () => set(done ? { Status: 'In Progress', 'Progress %': Math.min(0.9, Number(r[col('Progress %')]) || 0) } : { Status: 'Done', 'Progress %': 1 }), { icon: 'check' }));
    out.push(mi('Status', null, { children: STATUSES.map((s) => mi(s, () => set(s === 'Done' ? { Status: s, 'Progress %': 1 } : { Status: s }), { checked: status === s })) }));
    out.push(mi('Priority', null, { children: ['High', 'Medium', 'Low'].map((p) => mi(p, () => set({ Priority: p }), { checked: pri === p })) }));
    out.push(mi('Due date', null, { children: [['Today', 0], ['Tomorrow', 1], ['In 3 days', 3], ['In a week', 7]].map(([l, n]) => mi(l, () => set({ 'Due Date': dayPlus(n) }), { checked: due === dayPlus(n) })).concat([SEP, mi('Clear due date', () => set({ 'Due Date': '' }), { disabled: !due })]) }));
    if (P && P.setDuration) out.push(mi('Time estimate', null, { children: [15, 30, 45, 60, 90, 120, 180, 240, 480].map((d) => mi(fmtDur(d), () => P.setDuration(key, d))) }));
    out.push(SEP);
    if (P && P.details) out.push(mi('Details and planning…', () => P.details(key, window.__ctxAnchor), { icon: 'edit' }));
    if (P && P.jump) out.push(mi('Show in planner', () => P.jump(key), { icon: 'cal' }));
    if (from !== 'table') out.push(mi('Show in table', () => showInTable(key), { icon: 'list' }));
    out.push(SEP);
    if (typeof showSubtasks === 'function') out.push(mi('Sub-tasks…', () => showSubtasks(i), { icon: 'list' }));
    if (window.evidence) out.push(mi('Evidence…', () => window.evidence.openFor(key, title), { icon: 'clip' }));
    if (typeof showRowHistory === 'function') out.push(mi('Change history', () => showRowHistory(i), { icon: 'hist' }));
    if (typeof draftComment === 'function') out.push(mi('Draft comment with AI', () => draftComment(i), { icon: 'ai' }));
    out.push(SEP);
    out.push(mi('Copy task title', () => copyText(title), { icon: 'copy' }));
    out.push(mi('Copy task details', () => copyText('#' + key + ' ' + title + '\nStatus: ' + (status || '-') + '\nPriority: ' + (pri || '-') + '\nDue: ' + (due || '-')), {}));
    out.push(SEP);
    if (typeof cloneRow === 'function') out.push(mi('Duplicate row', () => cloneRow(i)));
    if (typeof deleteRow === 'function') out.push(mi('Delete row…', () => deleteRow(i), { icon: 'trash', danger: true }));
    return out;
  }

  /* ---------- the page itself ---------- */
  const TABS = [['today', 'Today'], ['planner', 'Planner'], ['board', 'Board'], ['insights', 'Insights'], ['reports', 'Reports'], ['settings', 'Settings'], ['actions', 'Actions']];
  function pageItems() {
    const Z = window.appZoom, P = window.planner, out = [];
    const sel = window.getSelection ? String(window.getSelection()) : '';
    if (sel) out.push(mi('Copy', () => copyText(sel), { icon: 'copy' }), SEP);
    out.push(mi('Go to', null, { icon: 'home', children: TABS.filter(([k]) => document.querySelector('.tab-btn[data-tab="' + k + '"]')).map(([k, l]) => mi(l, () => switchTab(k), { checked: !!document.querySelector('#tab-' + k + '.active') })) }));
    if (P && P.replan) out.push(mi('Re-plan my week', () => { P.replan().then((r) => toast('Plan rebuilt: ' + r.blocks + ' task blocks' + (r.atRisk ? ', ' + r.atRisk + ' at risk' : ''))); }, { icon: 'refresh' }));
    if (typeof window.bridgeOpen === 'function') out.push(mi('Open console', () => window.bridgeOpen(), { icon: 'term', hint: 'Ctrl+`' }));
    out.push(SEP);
    if (Z && Z.available) out.push(mi('Zoom in', () => Z.in(), { icon: 'zin', hint: 'Ctrl +' }), mi('Zoom out', () => Z.out(), { icon: 'zout', hint: 'Ctrl -' }), mi('Actual size (' + Math.round(Z.get() * 100) + '%)', () => Z.reset(), { disabled: Math.abs(Z.get() - 1) < 0.001, hint: 'Ctrl 0' }), SEP);
    const ub = document.getElementById('undoBtn'), rb = document.getElementById('redoBtn');
    if (ub) out.push(mi('Undo last table change', () => ub.click(), { icon: 'undo', disabled: typeof HISTORY_INDEX !== 'undefined' && HISTORY_INDEX <= 0 }));
    if (rb) out.push(mi('Redo', () => rb.click(), { icon: 'redo', disabled: typeof HISTORY_INDEX !== 'undefined' && typeof HISTORY !== 'undefined' && HISTORY_INDEX >= HISTORY.length - 1 }));
    out.push(SEP, mi('Reload', () => location.reload(), { icon: 'refresh' }));
    return out;
  }

  /* ---------- built-in providers (planner and evidence add theirs through window.__ctxProviders) ---------- */
  const builtin = [
    { name: 'text', build: (t) => textItems(t) ? textItems(t).concat(((t.closest && t.closest('.cell')) ? [SEP].concat(rowMenuFor(t) || []) : [])) : null },
    { name: 'task', build: (t) => rowMenuFor(t) },
    { name: 'console', build: (t) => {
      const line = t.closest && t.closest('#bridgeLog .bl-row');
      if (!(t.closest && t.closest('#bridge'))) return null;
      const log = document.getElementById('bridgeLog');
      const out = [];
      if (line) out.push(mi('Copy line', () => copyText(line.innerText), { icon: 'copy' }));
      out.push(mi('Copy whole console', () => copyText(log ? log.innerText : ''), { disabled: !log || !log.childElementCount }));
      out.push(mi('Clear console', () => { if (log) log.innerHTML = ''; }, { icon: 'trash' }));
      return out;
    } },
    { name: 'tab', build: (t) => {
      const b = t.closest && t.closest('.tab-btn[data-tab]');
      if (!b) return null;
      const P = window.planner;
      const out = [mi('Open ' + b.textContent.trim(), () => switchTab(b.dataset.tab), { icon: 'home' })];
      if (b.dataset.tab === 'planner' && P && P.replan) out.push(mi('Re-plan my week', () => P.replan(), { icon: 'refresh' }));
      return out;
    } },
    { name: 'window', build: (t) => {
      const w = t.closest && t.closest('[data-mv]');
      if (!w) return null;
      const mv = window.movable;
      return [mi('Reset window position', () => mv && mv.reset(w), { icon: 'move', disabled: !w.style.translate }), mi('Close window', () => mv && mv.close(w), { icon: 'x' })];
    } }
  ];
  function rowMenuFor(t) {
    if (!t || !t.closest) return null;
    const i = rowIndexOf(t);
    if (i < 0) return null;
    return taskItems(i, t.closest('#bodyRows') ? 'table' : 'other');
  }

  function onContext(e) {
    const lock = document.getElementById('pinLockOverlay');
    if (lock && getComputedStyle(lock).display !== 'none') return;
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('.cm')) { e.preventDefault(); return; }
    const r = t.getBoundingClientRect ? t.getBoundingClientRect() : { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY };
    window.__ctxAnchor = { left: r.left, top: Math.min(e.clientY, r.top + 30), right: r.right, bottom: r.bottom, x: e.clientX, y: e.clientY };
    const list = window.__ctxProviders.concat(builtin);
    let items = null;
    for (const p of list) {
      try { items = p.build(t, e); } catch (err) { items = null; }
      if (items && items.length) break;
    }
    if (!items || !items.length) items = pageItems();
    e.preventDefault(); e.stopPropagation();
    // the old row menu of the dashboard must not appear as well
    const old = document.getElementById('rowContextMenu');
    if (old) old.style.display = 'none';
    const kb = e.clientX === 0 && e.clientY === 0 && e.button !== 2;
    show(kb ? r.left + 10 : e.clientX, kb ? r.bottom : e.clientY, items, { focus: kb });
  }
  document.addEventListener('contextmenu', onContext, true);

  window.ctxmenu = { show, close, SEP, mi, icon, copyText, showInTable, pageItems, isOpen: () => !!M };
})();
