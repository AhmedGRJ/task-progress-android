/* Command bridge: a console docked at the bottom of the dashboard.
   Slash commands work offline; plain sentences go to the AI like "Add via AI".
   Shares globals (ROWS, HEADERS, commitChange, callLLM…) with the main script. */
(() => {
  'use strict';
  const D = window.desktop || null;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => (typeof escapeHtml === 'function' ? escapeHtml(v) : String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));

  /* ---------- Desktop shell: title bar, theme sync, AI through the main process ---------- */
  if (D) {
    document.body.classList.add('desktop');
    const bar = document.createElement('div');
    bar.id = 'dtb';
    bar.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="9" width="2.6" height="6" rx=".8"/><rect x="5" y="5" width="2.6" height="10" rx=".8"/><rect x="9" y="7.5" width="2.6" height="7.5" rx=".8"/><rect x="13" y="1" width="2.6" height="14" rx=".8"/></svg><span class="dtb-title">Task Progress</span>';
    document.body.prepend(bar);

    const syncOverlay = () => {
      if (!D.setOverlay) return;
      const cs = getComputedStyle(document.body);
      D.setOverlay(cs.getPropertyValue('--bg').trim() || '#0B0E14', cs.getPropertyValue('--signal').trim() || '#3FD6C5', Math.round(36 * (window.__uiZoom || 1)));
    };
    window.__syncOverlay = syncOverlay;
    const mo = new MutationObserver(syncOverlay);
    mo.observe(document.body, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
    syncOverlay();

    // callLLM uses this when present, so Ollama / Ascend are reached from the main process (no CORS).
    window.desktopFetch = async (url, opts) => {
      const r = await D.fetch({ url, method: opts.method, headers: opts.headers, body: opts.body });
      if (r.error) throw new Error(r.error);
      const hd = r.headers || {};
      return { ok: r.ok, status: r.status, headers: { get: (n) => hd[String(n).toLowerCase()] || null }, text: async () => r.text, json: async () => JSON.parse(r.text) };
    };
  }

  /* ---------- Bridge DOM ---------- */
  const bridge = document.createElement('section');
  bridge.className = 'bridge';
  bridge.id = 'bridge';
  bridge.dataset.open = 'false';
  bridge.setAttribute('aria-label', 'Command console');
  bridge.innerHTML =
    '<div class="bridge-edge"></div>' +
    '<div class="bridge-log" id="bridgeLog" role="log" aria-live="polite"></div>' +
    '<div class="bridge-sug" id="bridgeSug"></div>' +
    '<div class="bridge-bar">' +
    '<span class="bridge-prompt" aria-hidden="true">›</span>' +
    '<input id="bridgeInput" autocomplete="off" spellcheck="false" aria-label="Command or sentence" placeholder="Say what you did, or type / for commands">' +
    '<span class="bridge-link" id="bridgeLink" title="AI link"></span>' +
    '<span class="bridge-key">' + (D ? 'Ctrl+Shift+Space' : 'Ctrl+`') + '</span>' +
    '<button class="bridge-toggle" id="bridgeToggle" aria-label="Show or hide console history" title="Show or hide history">▴</button>' +
    '</div>';
  document.body.appendChild(bridge);
  document.body.classList.add('has-bridge');

  const log = $('bridgeLog'), input = $('bridgeInput'), sug = $('bridgeSug'), linkEl = $('bridgeLink'), toggle = $('bridgeToggle');

  function setOpen(open) {
    bridge.dataset.open = String(open);
    document.documentElement.style.setProperty('--bridge-log', open ? 'min(44vh, 400px)' : '0px');
    toggle.textContent = open ? '▾' : '▴';
    if (open) log.scrollTop = log.scrollHeight;
  }
  function openAndFocus() { setOpen(true); input.focus(); input.select(); }
  window.bridgeOpen = openAndFocus;
  if (D && D.onFocusConsole) D.onFocusConsole(openAndFocus);

  toggle.onclick = () => setOpen(bridge.dataset.open !== 'true');
  input.addEventListener('focus', () => { if (log.childElementCount) setOpen(true); });
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === '`' || e.code === 'Backquote')) {
      e.preventDefault();
      if (document.activeElement === input && bridge.dataset.open === 'true') { setOpen(false); input.blur(); } else openAndFocus();
    }
  });

  /* ---------- Output helpers ---------- */
  function row(html, cls) {
    const el = document.createElement('div');
    el.className = 'bl-row ' + (cls || '');
    el.innerHTML = html;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }
  const say = (text, cls) => row(esc(text), cls);
  const ok = (text) => say(text, 'bl-ok');
  const err = (text) => say(text, 'bl-err');
  const dim = (text) => say(text, 'bl-dim');

  function setLink(state, tip) {
    linkEl.dataset.s = state || '';
    linkEl.title = tip || ({ busy: 'AI is working', ok: 'AI replied', err: 'AI call failed' }[state] || 'AI link idle');
    bridge.dataset.busy = state === 'busy' ? 'true' : 'false';
  }

  /* ---------- Data helpers ---------- */
  const col = (n) => colIdx(n);
  const CANON = ['Not Started', 'In Progress', 'Done', 'Suspended', 'Routine'];
  const statusList = () => [...new Set([...CANON, ...uniqueVals('Status')])];
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  function parseDay(s) {
    s = String(s || '').trim().toLowerCase();
    const t = new Date(); t.setHours(0, 0, 0, 0);
    if (s === 'today') return iso(t);
    if (s === 'tomorrow' || s === 'tmr') { t.setDate(t.getDate() + 1); return iso(t); }
    let m = s.match(/^\+(\d+)d?$/);
    if (m) { t.setDate(t.getDate() + +m[1]); return iso(t); }
    m = s.match(/^\+(\d+)w$/);
    if (m) { t.setDate(t.getDate() + 7 * +m[1]); return iso(t); }
    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    if (/^[a-z]{3,9}$/.test(s) && days.includes(s.slice(0, 3))) {
      t.setDate(t.getDate() + ((days.indexOf(s.slice(0, 3)) - t.getDay() + 7) % 7 || 7));
      return iso(t);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s))) return s;
    m = s.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/); // dd/mm[/yyyy]
    if (m) {
      let y = m[3] ? +m[3] : t.getFullYear(); if (y < 100) y += 2000;
      const d = new Date(y, +m[2] - 1, +m[1]);
      if (!isNaN(d) && d.getMonth() === +m[2] - 1) return iso(d);
    }
    return null;
  }

  function normStatus(s) {
    const q = String(s || '').toLowerCase().replace(/[_-]/g, ' ').trim();
    if (!q) return null;
    const all = statusList();
    const alias = { todo: 'Not Started', new: 'Not Started', wip: 'In Progress', doing: 'In Progress', progress: 'In Progress', finished: 'Done', complete: 'Done', completed: 'Done', hold: 'Suspended', blocked: 'Suspended', paused: 'Suspended' };
    return all.find(x => x.toLowerCase() === q) || all.find(x => x.toLowerCase().startsWith(q)) || alias[q] || null;
  }

  function matchVal(colName, raw) {
    const q = String(raw || '').replace(/_/g, ' ').trim();
    const vals = uniqueVals(colName);
    return vals.find(v => v.toLowerCase() === q.toLowerCase()) || vals.find(v => v.toLowerCase().startsWith(q.toLowerCase())) || q;
  }

  const rowByIndex = (n) => { const c = col('Index'); return ROWS.findIndex(r => String(r[c]) === String(n)); };
  const titleOf = (r) => r[col('Task')] || r[col('Sub-Topic')] || '(untitled)';
  const idxOf = (i) => { const c = col('Index'); return c >= 0 ? ROWS[i][c] : i + 1; };
  const pctOf = (v) => (typeof v === 'number' ? Math.round(v * 100) + '%' : '');

  function touch(i, field, before, after) {
    try { LAST_EDITED_TS[rowHistoryKey(i)] = Date.now(); saveLastEditedTs(); } catch (e) { /* history is best effort */ }
    try { logRowChange(i, field, before, after); } catch (e) { /* same */ }
  }
  function setCell(i, name, val) {
    const c = col(name);
    if (c < 0) return false;
    const before = ROWS[i][c];
    ROWS[i][c] = val;
    touch(i, name, before, val);
    return true;
  }

  function taskLine(i) {
    const r = ROWS[i];
    const status = r[col('Status')] || '';
    const due = col('Due Date') >= 0 ? r[col('Due Date')] : '';
    const late = isOverdue(r);
    const color = (statusColors()[status]) || 'var(--grey)';
    const meta = [status, pctOf(r[col('Progress %')]), due ? 'due ' + due : ''].filter(Boolean).join('  ');
    return '<div class="bl-task"><span class="dot" style="background:' + color + '"></span><span class="idx">#' + esc(idxOf(i)) + '</span><span class="ttl">' + esc(titleOf(r)) + '</span><span class="meta' + (late ? ' late' : '') + '">' + esc(meta) + '</span></div>';
  }
  function printTasks(idxs, emptyMsg, limit) {
    if (!idxs.length) { dim(emptyMsg); return; }
    const cap = limit || 12;
    row(idxs.slice(0, cap).map(taskLine).join(''));
    if (idxs.length > cap) dim('+' + (idxs.length - cap) + ' more. Narrow it with /find or a status.');
  }
  function sortSoon(idxs) {
    const dc = col('Due Date'), pc = col('Priority');
    return idxs.sort((a, b) => {
      const da = dc >= 0 && ROWS[a][dc] ? ROWS[a][dc] : '9999', db = dc >= 0 && ROWS[b][dc] ? ROWS[b][dc] : '9999';
      if (da !== db) return da < db ? -1 : 1;
      const pa = pc >= 0 ? (PRIORITY_RANK[ROWS[a][pc]] ?? 3) : 3, pb = pc >= 0 ? (PRIORITY_RANK[ROWS[b][pc]] ?? 3) : 3;
      return pa - pb;
    });
  }
  function parseIdxs(str) {
    return String(str || '').split(/[\s,]+/).filter(Boolean).map(Number).filter(n => Number.isFinite(n));
  }

  /* ---------- Commands ---------- */
  const CMDS = [
    ['/help', '', 'Show every command'],
    ['/list', '[status or text]', 'Open tasks, soonest due first'],
    ['/find', '<text>', 'Search task, topic, project'],
    ['/stats', '', 'Status breakdown and progress'],
    ['/overdue', '', 'Tasks past their due date'],
    ['/add', '<title> #topic @project !priority due:fri', 'Create a task without AI'],
    ['/done', '<#> [<#> …]', 'Mark done at 100%'],
    ['/status', '<#> <status>', 'Change a task status'],
    ['/progress', '<#> <0-100>', 'Set progress'],
    ['/due', '<#> <date>', 'Date as 2026-10-20, 20/10, fri or +3d'],
    ['/note', '<#> <text>', 'Append to Comment / Conclusion'],
    ['/event', '<day> <10-12> <title>', 'Block time, e.g. /event tue 10-12 Customer call'],
    ['/focus', '<words|off>', 'Plan matching tasks first, e.g. /focus VoLTE'],
    ['/evidence', '<#>', 'Attach or view files and screenshots of a task'],
    ['/update', '[check|install|url <address>]', 'Check for a new version'],
    ['/zoom', 'in|out|reset|125', 'Zoom the whole app'],
    ['/print', '[days]', 'Print daily pages for your notebook'],
    ['/sync', '[setup|status]', 'Sync with your other devices now'],
    ['/undo', '', 'Undo the last change'],
    ['/redo', '', 'Redo it'],
    ['/plan', '', 'Rebuild the calendar plan'],
    ['/agenda', '[today|tomorrow|+n]', 'What is planned that day'],
    ['/report', '', 'Open the AI report'],
    ['/clear', '', 'Clear this console']
  ];

  const handlers = {
    help() {
      row('<div class="bl-cmd">' + CMDS.map(c => '<b>' + esc(c[0] + ' ' + c[1]) + '</b><span class="bl-dim">' + esc(c[2]) + '</span>').join('') + '</div>');
      dim('Anything that is not a command goes to the AI: "finished the VoLTE drive test, waiting on the X2 config".');
    },

    list(arg) {
      const q = arg.trim();
      const st = q ? normStatus(q) : null;
      let idxs = ROWS.map((_, i) => i);
      const sc = col('Status');
      if (st && q.split(/\s+/).length === 1) idxs = idxs.filter(i => ROWS[i][sc] === st);
      else if (q) return handlers.find(q);
      else idxs = idxs.filter(i => ['In Progress', 'Not Started'].includes(ROWS[i][sc]));
      printTasks(sortSoon(idxs), 'Nothing open. Add a task with /add or tell the AI what you did.');
    },

    find(arg) {
      const q = arg.trim().toLowerCase();
      if (!q) { err('Usage: /find <text>'); return; }
      const cols = ['Task', 'Topic', 'Sub-Topic', 'Project', 'Comment / Conclusion'].map(col).filter(c => c >= 0);
      const idxs = ROWS.map((_, i) => i).filter(i => cols.some(c => String(ROWS[i][c] || '').toLowerCase().includes(q)));
      printTasks(sortSoon(idxs), 'No task matches "' + arg.trim() + '".');
    },

    stats() {
      const sc = col('Status'), pc = col('Progress %');
      if (!ROWS.length) { dim('No tasks yet.'); return; }
      const colors = statusColors();
      const counts = {};
      ROWS.forEach(r => { counts[r[sc] || 'No status'] = (counts[r[sc] || 'No status'] || 0) + 1; });
      const order = [...CANON, ...Object.keys(counts).filter(k => !CANON.includes(k))].filter(k => counts[k]);
      row(order.map(k => '<div class="bl-bar"><span class="lbl">' + esc(k) + ' ' + counts[k] + '</span><span class="trk"><i style="width:' + Math.round(counts[k] / ROWS.length * 100) + '%;background:' + (colors[k] || 'var(--grey)') + '"></i></span></div>').join(''));
      const scored = ROWS.filter(r => r[sc] !== 'Routine' && typeof r[pc] === 'number');
      const avg = scored.length ? Math.round(scored.reduce((s, r) => s + r[pc], 0) / scored.length * 100) : null;
      const late = ROWS.filter(r => isOverdue(r)).length;
      const dc = col('Due Date'), today = new Date(); today.setHours(0, 0, 0, 0);
      const soon = dc < 0 ? 0 : ROWS.filter(r => {
        if (!r[dc] || ['Done', 'Suspended', 'Routine'].includes(r[sc])) return false;
        const d = new Date(r[dc]); const diff = (d - today) / 86400000;
        return !isNaN(d) && diff >= 0 && diff <= 7;
      }).length;
      say(ROWS.length + ' tasks' + (avg !== null ? ', average progress ' + avg + '% (Routine excluded)' : '') + '. ' + late + ' overdue, ' + soon + ' due in the next 7 days.');
    },

    overdue() {
      printTasks(sortSoon(ROWS.map((_, i) => i).filter(i => isOverdue(ROWS[i]))), 'Nothing is overdue.');
    },

    async add(arg) {
      const tokens = [];
      let rest = arg.replace(/(?<=^|\s)([#@])"([^"]+)"|(?<=^|\s)([#@!])(\S+)|(?<=^|\s)(due|status):(\S+)/g, (m, a1, v1, a2, v2, k, v3) => {
        tokens.push(a1 ? [a1, v1] : a2 ? [a2, v2] : [k, v3]);
        return ' ';
      }).replace(/\s+/g, ' ').trim();
      if (!rest) { err('Usage: /add <title> #topic @project !priority due:fri'); return; }
      const t = {};
      for (const [k, v] of tokens) {
        if (k === '#') t.topic = matchVal('Topic', v);
        else if (k === '@') t.project = matchVal('Project', v);
        else if (k === '!') { const p = ['High', 'Medium', 'Low'].find(x => x.toLowerCase().startsWith(v.toLowerCase())); if (p) t.priority = p; else { err('Priority must be high, medium or low.'); return; } }
        else if (k === 'due') { t.due = parseDay(v); if (!t.due) { err('I could not read the date "' + v + '". Try 2026-10-20, 20/10, fri or +3d.'); return; } }
        else if (k === 'status') { t.status = normStatus(v); if (!t.status) { err('Unknown status "' + v + '". Options: ' + statusList().join(', ') + '.'); return; } }
      }
      const now = new Date();
      const ic = col('Index');
      const next = ic >= 0 ? Math.max(0, ...ROWS.map(r => Number(r[ic]) || 0)) + 1 : ROWS.length + 1;
      const newRow = HEADERS.map(h => {
        switch (h) {
          case 'Index': return next;
          case 'Task': return rest;
          case 'Topic': return t.topic || '';
          case 'Project': return t.project || '';
          case 'Priority': return t.priority || '';
          case 'Due Date': return t.due || '';
          case 'Period': return now.getFullYear() + ' Q' + Math.ceil((now.getMonth() + 1) / 3);
          case 'Month': return now.toLocaleString('en-US', { month: 'long' });
          case 'Status': return t.status || 'Not Started';
          case 'Progress %': return t.status === 'Done' ? 1 : 0;
          default: return '';
        }
      });
      ROWS.push(newRow);
      await commitChange();
      ok('Added.');
      row(taskLine(ROWS.length - 1));
    },

    async done(arg) {
      const nums = parseIdxs(arg);
      if (!nums.length) { err('Usage: /done <#> [<#> …]'); return; }
      const hit = [];
      for (const n of nums) {
        const i = rowByIndex(n);
        if (i < 0) { err('No task #' + n + '.'); continue; }
        setCell(i, 'Status', 'Done'); setCell(i, 'Progress %', 1);
        hit.push(i);
      }
      if (!hit.length) return;
      await commitChange();
      ok('Marked done.');
      row(hit.map(taskLine).join(''));
    },

    async status(arg) {
      const [n, ...r] = arg.trim().split(/\s+/);
      const i = rowByIndex(n), st = normStatus(r.join(' '));
      if (i < 0) { err('Usage: /status <#> <status>. No task #' + n + '.'); return; }
      if (!st) { err('Unknown status. Options: ' + statusList().join(', ') + '.'); return; }
      setCell(i, 'Status', st);
      if (st === 'Done') setCell(i, 'Progress %', 1);
      await commitChange();
      ok('Status updated.');
      row(taskLine(i));
    },

    async progress(arg) {
      const [n, p] = arg.trim().split(/\s+/);
      const i = rowByIndex(n), v = parseFloat(String(p || '').replace('%', ''));
      if (i < 0 || !Number.isFinite(v) || v < 0 || v > 100) { err('Usage: /progress <#> <0-100>'); return; }
      setCell(i, 'Progress %', v / 100);
      await commitChange();
      ok('Progress updated.');
      row(taskLine(i));
    },

    async due(arg) {
      const [n, ...r] = arg.trim().split(/\s+/);
      const i = rowByIndex(n), d = parseDay(r.join(' '));
      if (i < 0) { err('Usage: /due <#> <date>. No task #' + n + '.'); return; }
      if (!d) { err('I could not read that date. Try 2026-10-20, 20/10, fri or +3d.'); return; }
      if (!setCell(i, 'Due Date', d)) { err('This table has no "Due Date" column.'); return; }
      await commitChange();
      ok('Due date set.');
      row(taskLine(i));
    },

    async note(arg) {
      const m = arg.trim().match(/^(\S+)\s+([\s\S]+)$/);
      const i = m ? rowByIndex(m[1]) : -1;
      if (!m || i < 0) { err('Usage: /note <#> <text>'); return; }
      const c = col('Comment / Conclusion');
      if (c < 0) { err('This table has no "Comment / Conclusion" column.'); return; }
      const before = ROWS[i][c];
      setCell(i, 'Comment / Conclusion', before ? before + ' — ' + m[2] : m[2]);
      await commitChange();
      ok('Note added.');
      row(taskLine(i));
    },

    undo() {
      if (window.planner && window.planner.canUndoAssist && window.planner.canUndoAssist()) {
        const r = window.planner.undoAssist();
        ok('Undone.' + (r.rows ? ' The task table was restored too.' : ''));
        if (r.warn) dim(r.warn);
        return;
      }
      if (HISTORY_INDEX <= 0) { dim('Nothing to undo.'); return; }
      $('undoBtn').click(); ok('Undone.');
    },
    redo() {
      if (HISTORY_INDEX >= HISTORY.length - 1) { dim('Nothing to redo.'); return; }
      $('redoBtn').click(); ok('Redone.');
    },

    async plan() {
      if (!window.planner) { err('The planner is not available in this build.'); return; }
      dim('Planning…');
      const r = await window.planner.replan();
      ok('Plan rebuilt: ' + r.blocks + ' task blocks.' + (r.atRisk ? ' ' + r.atRisk + ' at risk of missing a deadline.' : '') + (r.unscheduled ? ' ' + r.unscheduled + ' without a free slot.' : ''));
    },

    async agenda(arg) {
      if (!window.planner) { err('The planner is not available in this build.'); return; }
      const q = arg.trim().toLowerCase();
      const off = q === 'tomorrow' || q === 'tmr' ? 1 : /^\+\d+$/.test(q) ? parseInt(q.slice(1), 10) : 0;
      const items = await window.planner.agenda(off);
      const d = new Date(); d.setDate(d.getDate() + off);
      if (!items.length) { dim('Nothing planned for ' + iso(d) + '.'); return; }
      const hm = (ms) => { const x = new Date(ms); return String(x.getHours()).padStart(2, '0') + ':' + String(x.getMinutes()).padStart(2, '0'); };
      row(items.map(i => '<div class="bl-task"><span class="dot" style="background:' + (i.type === 'ev' ? 'var(--signal)' : i.late ? 'var(--coral)' : 'var(--amber)') + '"></span><span class="idx">' + hm(i.s) + '</span><span class="ttl">' + esc(i.title) + '</span><span class="meta' + (i.late ? ' late' : '') + '">' + hm(i.s) + ' to ' + hm(i.e) + (i.type === 'ev' ? '  meeting' : i.late ? '  past deadline' : '') + '</span></div>').join(''));
    },

    async report() {
      if (typeof generateReport !== 'function') { err('Report is not available in this build.'); return; }
      dim('Generating the report with the AI…');
      setLink('busy');
      try { await generateReport(); setLink('ok'); } catch (e) { setLink('err', e.message); }
    },

    async event(arg) {
      if (!window.planner) { err('The planner is not available in this build.'); return; }
      const m = arg.trim().match(/^(\S+)\s+(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?\s+([\s\S]+)$/);
      const day = m ? parseDay(m[1]) : null;
      if (!m || !day) { err('Usage: /event <day> <10-12> <title>, for example /event tue 10-12 Customer call'); return; }
      const hm = (h, mi) => String(h).padStart(2, '0') + ':' + (mi || '00');
      await showActions(await window.planner.act([{ type: 'add_event', title: m[6].trim(), date: day, start: hm(m[2], m[3]), end: hm(m[4], m[5]) }]));
    },

    async focus(arg) {
      if (!window.planner) { err('The planner is not available in this build.'); return; }
      const q = arg.trim();
      if (!q) { err('Usage: /focus <words> to plan matching tasks first, or /focus off'); return; }
      await showActions(await window.planner.act([/^(off|clear|none)$/i.test(q) ? { type: 'clear_focus' } : { type: 'focus', text: q }]));
    },

    evidence(arg) {
      if (!window.evidence) { err('Evidence is not available in this build.'); return; }
      const n = parseIdxs(arg)[0], i = n != null ? rowByIndex(n) : -1;
      if (i < 0) { err('Usage: /evidence <#> with the task number.'); return; }
      window.evidence.openFor(String(n), titleOf(ROWS[i]));
      dim('Opened the evidence of #' + n + '.');
    },

    async update(arg) {
      const U = D && D.update;
      if (!U) { err('Updates are only available in the desktop app.'); return; }
      const q = arg.trim(), m = q.match(/^url\s+(\S+)$/i);
      if (m) { const r = await U.setUrl(m[1]); ok('Update address saved.'); showUpdate(r); return; }
      if (/^install$/i.test(q)) { const r = await U.install(); if (r && r.state === 'error') err(r.msg); else dim('Restarting to install the update…'); return; }
      if (/^status$/i.test(q)) { showUpdate(await U.status()); return; }
      dim('Checking for updates…');
      showUpdate(await U.check());
    },

    print(arg) {
      if (!window.printpages) { err('Printing is not available in this build.'); return; }
      const n = parseInt(arg, 10);
      window.printpages.open(n > 0 ? { days: Math.min(400, n) } : {});
      dim('Opened the print dialog. The first day is tomorrow unless you change it.');
    },

    async sync(arg) {
      const S = window.appSync;
      if (!S) { err('Sync is not available in this build.'); return; }
      const q = arg.trim().toLowerCase();
      if (q === 'setup') { S.open(); dim('Opened the sync settings.'); return; }
      if (q === 'status') { const s = S.status(); dim(s.on ? s.text + (s.detail ? ' (' + s.detail + ')' : '') : 'Sync is off. Use /sync setup.'); return; }
      const st = S.status();
      if (!st.on) { S.open(); dim('Sync is off. Opened the settings.'); return; }
      const r = await S.syncNow();
      if (r) ok('Synced: sent ' + r.pushed + ', received ' + r.pulled + '.'); else err(S.status().text);
    },

    zoom(arg) {
      const Z = window.appZoom;
      if (!Z || !Z.available) { dim('In this version the browser does the zooming: press Ctrl and + or -.'); return; }
      const q = arg.trim().toLowerCase();
      if (q === 'in') Z.in(); else if (q === 'out') Z.out(); else if (q === 'reset' || q === '100' || q === '100%') Z.reset();
      else if (/^\d{2,3}%?$/.test(q)) Z.set(parseInt(q, 10) / 100);
      else if (q) { err('Usage: /zoom in, /zoom out, /zoom reset or /zoom 125'); return; }
      ok('Zoom is ' + Math.round(Z.get() * 100) + '%.');
    },

    clear() { log.innerHTML = ''; }
  };

  /* ---------- AI: plain sentences ---------- */
  async function aiApply(text) {
    setLink('busy');
    const thinking = row('<span class="bl-think">Thinking</span>', 'bl-dim');
    try {
      const topics = uniqueVals('Topic'), subtopics = uniqueVals('Sub-Topic'), projects = uniqueVals('Project');
      const statuses = uniqueVals('Status');
      const tai = col('Task');
      const existing = ROWS.map((r, i) => i + ': ' + (r[tai] || '')).join('\n');
      const sys = 'You are a conversational assistant for a telecom RAN/NPM engineer\'s task log. Today is ' + iso(new Date()) + '. The user describes what they just did, in plain language. Decide whether this is progress on an EXISTING task below, or a brand-new task.\n' +
        'Existing tasks (index: title):\n' + (existing || '(none yet)') + '\n\n' +
        'Respond with ONLY a JSON object, no markdown, no explanation.\n' +
        'If it clearly matches an existing task by meaning (not necessarily exact wording), respond:\n{"action":"update","taskIndex":<number>,"Status":"...","Progress":<0-1>,"Comment":"..."}\n' +
        'Otherwise respond:\n{"action":"add","Topic":"...","Sub-Topic":"...","Task":"...","Project":"...","Status":"...","Progress":<0-1>,"Comment":"...","Priority":"High|Medium|Low (optional)","Due":"YYYY-MM-DD (optional, only if the user gave a deadline)"}\n' +
        '"Progress" is 0 to 1. "Status" must be one of: ' + (statuses.join(', ') || CANON.join(', ')) + '. Only use "update" if genuinely confident about the match; when unsure, use "add". For "add", prefer reusing an existing Topic/Sub-Topic/Project if one fits: Topics: ' + topics.join(', ') + '; Sub-Topics: ' + subtopics.join(', ') + '; Projects: ' + projects.join(', ') + '.';
      const obj = await callLLM(text, { system: sys, json: true });
      thinking.remove();

      if (obj.action === 'update' && Number.isInteger(obj.taskIndex) && ROWS[obj.taskIndex]) {
        const i = obj.taskIndex;
        const st = normStatus(obj.Status);
        if (st) setCell(i, 'Status', st);
        if (typeof obj.Progress === 'number') setCell(i, 'Progress %', Math.min(1, Math.max(0, obj.Progress)));
        else if (st === 'Done') setCell(i, 'Progress %', 1);
        if (obj.Comment) {
          const c = col('Comment / Conclusion');
          if (c >= 0) { const before = ROWS[i][c]; setCell(i, 'Comment / Conclusion', before ? before + ' — ' + obj.Comment : obj.Comment); }
        }
        await commitChange();
        ok('Updated an existing task.');
        row(taskLine(i));
      } else {
        const now = new Date();
        const ic = col('Index');
        const next = ic >= 0 ? Math.max(0, ...ROWS.map(r => Number(r[ic]) || 0)) + 1 : ROWS.length + 1;
        const due = obj.Due ? parseDay(obj.Due) : null;
        const prio = ['High', 'Medium', 'Low'].includes(obj.Priority) ? obj.Priority : '';
        const newRow = HEADERS.map(h => {
          switch (h) {
            case 'Index': return next;
            case 'Topic': return obj.Topic || '';
            case 'Sub-Topic': return obj['Sub-Topic'] || '';
            case 'Task': return obj.Task || text;
            case 'Project': return obj.Project || '';
            case 'Period': return now.getFullYear() + ' Q' + Math.ceil((now.getMonth() + 1) / 3);
            case 'Month': return now.toLocaleString('en-US', { month: 'long' });
            case 'Status': return normStatus(obj.Status) || 'Done';
            case 'Progress %': return typeof obj.Progress === 'number' ? Math.min(1, Math.max(0, obj.Progress)) : 1;
            case 'Comment / Conclusion': return obj.Comment || '';
            case 'Priority': return prio;
            case 'Due Date': return due || '';
            default: return '';
          }
        });
        ROWS.push(newRow);
        await commitChange();
        ok('Added a new task. Review it below.');
        row(taskLine(ROWS.length - 1));
      }
      dim('Type /undo to revert.');
      setLink('ok');
    } catch (e) {
      thinking.remove();
      err('The AI call failed: ' + e.message);
      dim('Check the provider, URL and model in AI Assistant Settings, then try again.');
      setLink('err', e.message);
    }
  }

  /* ---------- Assistant: plain sentences become planner and task actions ---------- */
  async function showActions(r) {
    if (r.say) say(r.say);
    (r.lines || []).forEach((l) => (l.info ? dim(l.text) : l.ok ? ok(l.text) : err(l.text)));
    if (!(r.lines || []).length && !r.say) dim('Nothing to change.');
    if (r.undo) dim('Type /undo to revert.');
  }
  async function assistRun(text) {
    if (!window.planner || !window.planner.assist) return aiApply(text);
    setLink('busy');
    const thinking = row('<span class="bl-think">Thinking</span>', 'bl-dim');
    try {
      const r = await window.planner.assist(text);
      thinking.remove();
      await showActions(r);
      setLink('ok');
    } catch (e) {
      thinking.remove();
      err('The AI call failed: ' + e.message);
      dim('Check the provider, URL and model in AI Assistant Settings, then try again.');
      setLink('err', e.message);
    }
  }

  /* ---------- Updates ---------- */
  const UPD = { checking: 'Checking for updates…', none: 'You are up to date.', available: 'A new version is available and is downloading.', downloading: 'Downloading the update…', ready: 'The update is ready. Type /update install to restart into it.', nourl: 'No update address is set. Type /update url <address> (an address that serves the update files).', dev: 'Updates only work in the installed app, not in development mode.' };
  function showUpdate(s) {
    if (!s) return;
    const v = s.version ? ' (' + s.version + ')' : '';
    if (s.state === 'error') err('Update failed: ' + (s.msg || 'unknown error'));
    else dim((UPD[s.state] || s.state) + (s.state === 'ready' || s.state === 'available' || s.state === 'downloading' ? v : ''));
    if (s.current) dim('Installed version: ' + s.current);
  }
  if (D && D.update && D.update.onStatus) {
    let last = '';
    D.update.onStatus((s) => {
      if (!s || s.state === last) return;
      last = s.state;
      if (s.state === 'ready') {
        showUpdate(s);
        if (typeof showToast === 'function') showToast('Update ' + (s.version || '') + ' is ready.', { actionLabel: 'Restart now', onAction: () => D.update.install() });
      } else if (s.state === 'error') showUpdate(s);
    });
  }

  /* ---------- Input handling ---------- */
  let hist = [], hPos = 0, sugItems = [], sugSel = 0;
  try {
    AppStorage.get('bridge-history', false).then(r => { if (r && r.value) { hist = JSON.parse(r.value); hPos = hist.length; } }).catch(() => {});
  } catch (e) { /* storage not ready */ }

  async function run(raw) {
    const text = raw.trim();
    if (!text) return;
    if (hist[hist.length - 1] !== text) hist.push(text);
    hist = hist.slice(-50); hPos = hist.length;
    try { AppStorage.set('bridge-history', JSON.stringify(hist), false); } catch (e) { /* ignore */ }

    setOpen(true);
    row(esc(text), 'bl-user');
    if (!Array.isArray(ROWS) || !ROWS) { err('The task table is still loading. Try again in a moment.'); return; }
    if (text[0] === '/') {
      const m = text.match(/^\/(\S+)\s*([\s\S]*)$/);
      const name = m ? m[1].toLowerCase() : '';
      const fn = handlers[name];
      if (!fn) { err('Unknown command /' + name + '. Type /help.'); return; }
      try { await fn(m[2] || ''); } catch (e) { err('That failed: ' + e.message); }
    } else {
      await assistRun(text);
    }
  }

  function renderSug() {
    const v = input.value;
    if (v[0] !== '/' || /\s/.test(v)) { sug.classList.remove('show'); sugItems = []; return; }
    sugItems = CMDS.filter(c => c[0].startsWith(v.toLowerCase()));
    if (!sugItems.length) { sug.classList.remove('show'); return; }
    sugSel = Math.min(sugSel, sugItems.length - 1);
    sug.innerHTML = sugItems.map((c, i) => '<div data-i="' + i + '" class="' + (i === sugSel ? 'sel' : '') + '"><b>' + esc(c[0]) + '</b><span>' + esc((c[1] ? c[1] + '  ' : '') + c[2]) + '</span></div>').join('');
    sug.classList.add('show');
  }
  sug.addEventListener('mousedown', (e) => {
    const d = e.target.closest('[data-i]');
    if (!d) return;
    e.preventDefault();
    input.value = sugItems[+d.dataset.i][0] + ' ';
    sug.classList.remove('show'); input.focus();
  });
  input.addEventListener('input', () => { sugSel = 0; renderSug(); });

  input.addEventListener('keydown', (e) => {
    const sugOpen = sug.classList.contains('show');
    if (e.key === 'Enter') {
      e.preventDefault();
      if (sugOpen && input.value.trim() !== sugItems[sugSel][0]) { input.value = sugItems[sugSel][0] + ' '; sug.classList.remove('show'); return; }
      const v = input.value; input.value = ''; sug.classList.remove('show');
      run(v);
    } else if (e.key === 'Tab' && sugOpen) {
      e.preventDefault();
      input.value = sugItems[sugSel][0] + ' '; sug.classList.remove('show');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (sugOpen) { sugSel = (sugSel - 1 + sugItems.length) % sugItems.length; renderSug(); }
      else if (hPos > 0) { hPos--; input.value = hist[hPos]; }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (sugOpen) { sugSel = (sugSel + 1) % sugItems.length; renderSug(); }
      else if (hPos < hist.length) { hPos++; input.value = hist[hPos] || ''; }
    } else if (e.key === 'Escape') {
      if (sugOpen) sug.classList.remove('show');
      else if (input.value) input.value = '';
      else { setOpen(false); input.blur(); }
    }
  });

  row('Command bridge ready. Say what you did in plain words, or type / to see commands.', 'bl-dim');
  setLink('');
})();
