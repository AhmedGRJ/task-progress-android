/* Printable daily pages for a notebook (default 13 x 20 cm), laid out on A4.
   One drawing routine writes both the PDF (jsPDF, exact millimetres) and the on-screen preview, so they always match. */
(() => {
  'use strict';
  if (window.printpages) return;
  const A4 = { w: 210, h: 297 };
  const INK = [32, 32, 36], GREY = [112, 112, 118], FAINT = [205, 205, 210], SHADE = [243, 243, 245], ACCENT = [176, 0, 32];
  const DOW = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const MON = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => { d = new Date(d); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const fromYmd = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const hm = (s) => { const p = String(s || '0:0').split(':'); return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0); };
  const hhmm = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const fmtDur = (m) => { m = Math.round(m); const h = Math.floor(m / 60), r = m % 60; return h ? (r ? h + 'h' + pad(r) : h + 'h') : r + 'm'; };
  const isoWeek = (d) => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())), n = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - n); return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7); };
  const hex = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '')); const v = m ? parseInt(m[1], 16) : 0x3b82f6; return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
  const mix = (c, t) => hex(c).map((v) => Math.round(255 - (255 - v) * t));
  const SAFE = { '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"', '\u2013': '-', '\u2014': '-', '\u2026': '...', '\u00b7': '.', '\u2192': '->', '\u2022': '-', '\u00a0': ' ', '\u202f': ' ' };
  // the PDF's built-in font covers Latin text; anything else becomes "?"
  const safe = (s) => String(s == null ? '' : s).normalize('NFC').replace(/[\u2018\u2019\u201c\u201d\u2013\u2014\u2026\u00b7\u2192\u2022\u00a0\u202f]/g, (c) => SAFE[c]).replace(/[^\x20-\x7E\u00A1-\u00FF]/g, '?');

  /* ---------- two drawing back ends with the same few methods (all sizes in mm, text in points) ---------- */
  function pdfGfx(doc) {
    const dash = (a) => { const f = doc.setLineDashPattern || doc.setLineDash; f.call(doc, a || [], 0); };
    return {
      rect(x, y, w, h, o) {
        o = o || {};
        if (o.fill) doc.setFillColor(o.fill[0], o.fill[1], o.fill[2]);
        if (o.stroke) { doc.setDrawColor(o.stroke[0], o.stroke[1], o.stroke[2]); doc.setLineWidth(o.lw || 0.2); }
        dash(o.dash);
        const mode = o.fill && o.stroke ? 'FD' : o.fill ? 'F' : 'S';
        if (o.r) doc.roundedRect(x, y, w, h, o.r, o.r, mode); else doc.rect(x, y, w, h, mode);
      },
      line(x1, y1, x2, y2, o) { o = o || {}; const c = o.color || INK; doc.setDrawColor(c[0], c[1], c[2]); doc.setLineWidth(o.lw || 0.2); dash(o.dash); doc.line(x1, y1, x2, y2); },
      text(str, x, y, o) { o = o || {}; const c = o.color || INK; doc.setFont('helvetica', o.bold ? 'bold' : 'normal'); doc.setFontSize(o.size || 8); doc.setTextColor(c[0], c[1], c[2]); doc.text(str, x, y, { align: o.align || 'left' }); },
      width(str, size, bold) { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); return doc.getTextWidth(str); }
    };
  }
  function canvasGfx(ctx, s) {
    const px = (pt) => pt * 0.352778 * s, rgb = (c) => 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
    const font = (size, bold) => (bold ? 'bold ' : '') + px(size) + 'px Helvetica, Arial, sans-serif';
    const path = (x, y, w, h, r) => { ctx.beginPath(); if (r && ctx.roundRect) ctx.roundRect(x * s, y * s, w * s, h * s, r * s); else ctx.rect(x * s, y * s, w * s, h * s); };
    return {
      rect(x, y, w, h, o) {
        o = o || {}; path(x, y, w, h, o.r);
        if (o.fill) { ctx.fillStyle = rgb(o.fill); ctx.fill(); }
        if (o.stroke) { ctx.strokeStyle = rgb(o.stroke); ctx.lineWidth = (o.lw || 0.2) * s; ctx.setLineDash((o.dash || []).map((v) => v * s)); ctx.stroke(); ctx.setLineDash([]); }
      },
      line(x1, y1, x2, y2, o) { o = o || {}; ctx.beginPath(); ctx.moveTo(x1 * s, y1 * s); ctx.lineTo(x2 * s, y2 * s); ctx.strokeStyle = rgb(o.color || INK); ctx.lineWidth = (o.lw || 0.2) * s; ctx.setLineDash((o.dash || []).map((v) => v * s)); ctx.stroke(); ctx.setLineDash([]); },
      text(str, x, y, o) { o = o || {}; ctx.font = font(o.size || 8, o.bold); ctx.fillStyle = rgb(o.color || INK); ctx.textAlign = o.align || 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText(str, x * s, y * s); },
      width(str, size, bold) { ctx.font = font(size, bold); return ctx.measureText(str).width / s; }
    };
  }
  function fit(g, str, size, bold, maxW) {
    str = safe(str);
    if (maxW <= 0) return '';
    if (g.width(str, size, bold) <= maxW) return str;
    let lo = 0, hi = str.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (g.width(str.slice(0, mid) + '...', size, bold) <= maxW) lo = mid; else hi = mid - 1; }
    return lo ? str.slice(0, lo).replace(/\s+$/, '') + '...' : '';
  }
  function cluster(items) {
    items.sort((a, b) => a.s - b.s || b.e - a.e);
    const out = [];
    let cl = [], end = 0;
    const flush = () => { const ends = []; cl.forEach((it) => { let c = 0; while (ends[c] != null && ends[c] > it.s) c++; ends[c] = it.e; it.col = c; }); cl.forEach((it) => { it.cols = ends.length; }); out.push.apply(out, cl); cl = []; };
    items.forEach((it) => { if (cl.length && it.s >= end) { flush(); end = 0; } cl.push(it); end = Math.max(end, it.e); });
    if (cl.length) flush();
    return out;
  }

  /* ---------- one day page ---------- */
  const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dueText = (s) => { const d = fromYmd(s); return d ? DAYN[d.getDay()] + ' ' + d.getDate() + ' ' + MON3[d.getMonth()] : ''; };
  const pctOf = (p) => Math.round((p || 0) * 100);

  // Everything that belongs on the page for this day, one entry per task.
  function buildEntries(day, o, data, isFirst) {
    const map = new Map(), list = [];
    const get = (t) => {
      let e = map.get(t.key);
      if (!e) { e = { key: t.key, title: t.title, project: t.project || '', status: t.status, prog: t.prog, note: t.note || '', due: t.due, pri: t.priority, rec: !!t.rec, color: t.color, first: null, min: 0 }; map.set(t.key, e); list.push(e); }
      return e;
    };
    if (o.tasks) day.tasks.forEach((t) => { const e = get(t); e.first = e.first == null ? t.s : Math.min(e.first, t.s); e.min += (t.e - t.s) / 60000; if (t.late) e.late = true; });
    if (o.deadlines) day.due.forEach((t) => { get(t).dueToday = true; });
    if (o.done) (day.completed || []).forEach((t) => { get(t).doneToday = true; });
    const rank = (e) => (e.first != null ? 0 : e.dueToday ? 1 : e.doneToday ? 2 : 3);
    list.sort((a, b) => rank(a) - rank(b) || (a.first || 0) - (b.first || 0));
    if (o.routines) day.routine.forEach((r) => list.push({ title: r.title, routine: true, min: r.dur, project: r.project, color: r.color }));
    let moreOverdue = 0;
    if (o.overdue && isFirst && data.overdue.length) {
      data.overdue.forEach((t, i) => { if (map.has(t.key)) { map.get(t.key).overdue = true; return; } if (i - 0 < 4) { const e = get(t); e.overdue = true; list.push(list.splice(list.indexOf(e), 1)[0]); } else moreOverdue++; });
    }
    return { list, moreOverdue };
  }

  function drawDay(g, ox, oy, W, H, day, o, data, isFirst) {
    const mt = 9, mb = 8, bind = 7;
    const ml = 9 + (o.bind === 'left' ? bind : 0), mr = 9 + (o.bind === 'right' ? bind : 0);
    const x0 = ox + ml, cw = W - ml - mr, top = oy + mt, dt = new Date(day.date);
    if (o.frame) g.rect(ox, oy, W, H, { stroke: [165, 165, 170], lw: 0.15, dash: [1.4, 1.2] });
    const built = buildEntries(day, o, data, isFirst), entries = built.list;

    // header: big date, weekday, month, week number, progress summary
    const dn = String(dt.getDate());
    g.text(dn, x0, top + 11.8, { size: 40, bold: true });
    const nw = g.width(dn, 40, true), tx = x0 + nw + 3.6;
    g.text(DOW[dt.getDay()], tx, top + 5.4, { size: 12, bold: true });
    g.text(MON[dt.getMonth()] + ' ' + dt.getFullYear(), tx, top + 10.6, { size: 9, color: GREY });
    g.text('Week ' + isoWeek(dt), x0 + cw, top + 4.4, { size: 7, color: GREY, align: 'right' });
    const tracked = entries.filter((e) => !e.routine && e.prog != null);
    if (tracked.length) {
      const dn2 = tracked.filter((e) => e.status === 'Done' || e.prog >= 1).length, avg = Math.round((tracked.reduce((a, e) => a + (e.prog || 0), 0) / tracked.length) * 100);
      g.text(tracked.length + (tracked.length === 1 ? ' task' : ' tasks') + ', ' + dn2 + ' done, ' + avg + '% avg', x0 + cw, top + 8.4, { size: 7, bold: true, color: INK, align: 'right' });
    }
    if (!day.working) g.text('DAY OFF', x0 + cw, top + 12.2, { size: 7.5, bold: true, color: ACCENT, align: 'right' });
    let y = top + 15;
    g.line(x0, y, x0 + cw, y, { color: INK, lw: 0.35 });
    y += 2.4;

    // all-day events
    const allDay = o.events ? day.events.filter((e) => e.allDay) : [];
    if (allDay.length) {
      g.rect(x0, y, cw, 4.8, { fill: mix(allDay[0].color, 0.2), r: 0.8 });
      g.rect(x0, y, 1, 4.8, { fill: hex(allDay[0].color) });
      g.text(fit(g, allDay.map((e) => e.title).join(', '), 7.5, true, cw - 4), x0 + 2.4, y + 3.3, { size: 7.5, bold: true });
      y += 6.6;
    }

    // hourly schedule
    if (o.grid) {
      const timed = [];
      if (o.events) day.events.filter((e) => !e.allDay).forEach((e) => timed.push({ kind: 'ev', s: e.s, e: Math.max(e.e, e.s + 15 * 60000), title: e.title, color: e.color }));
      if (o.tasks) day.tasks.forEach((t) => timed.push({ kind: 'task', s: t.s, e: Math.max(t.e, t.s + 15 * 60000), title: t.title, color: t.color, late: t.late, rec: t.rec }));
      const ws = hm(data.work.start), we = hm(data.work.end);
      let h0 = Number.isFinite(o.hFrom) ? o.hFrom : Math.floor(ws / 60), h1 = Number.isFinite(o.hTo) ? o.hTo : Math.ceil(we / 60);
      timed.forEach((it) => { h0 = Math.min(h0, Math.floor((it.s - day.date) / 3600000)); h1 = Math.max(h1, Math.ceil((it.e - day.date) / 3600000)); });
      h0 = Math.max(0, h0); h1 = Math.min(24, Math.max(h1, h0 + 8)); if (h1 - h0 < 8) h0 = Math.max(0, h1 - 8);
      const n = h1 - h0, rowH = Math.min(9, Math.max(4.9, 60 / n)), gridH = rowH * n;
      const gx = x0 + 9.5, gw = cw - 9.5, hy = (hours) => y + (hours - h0) * rowH;
      const shade = (a, b) => { const A = Math.max(a, h0), B = Math.min(b, h1); if (B > A) g.rect(gx, hy(A), gw, (B - A) * rowH, { fill: SHADE }); };
      if (!day.working) shade(h0, h1); else { shade(h0, ws / 60); shade(we / 60, h1); if (data.work.lunch) shade(hm(data.work.lunchStart) / 60, hm(data.work.lunchEnd) / 60); }
      for (let h = h0; h <= h1; h++) {
        g.line(gx, hy(h), gx + gw, hy(h), { color: FAINT, lw: 0.15 });
        if (h < h1) g.line(gx, hy(h + 0.5), gx + gw, hy(h + 0.5), { color: [228, 228, 232], lw: 0.1, dash: [0.5, 0.7] });
        g.text(pad(h % 24) + ':00', gx - 1.6, hy(h) + 0.9, { size: 6, color: GREY, align: 'right' });
      }
      g.line(gx, y, gx, y + gridH, { color: FAINT, lw: 0.15 });
      const minMs = (3.7 / rowH) * 3600000;
      cluster(timed.map((it) => Object.assign({}, it, { re: it.e, e: Math.max(it.e, it.s + minMs) }))).forEach((it) => {
        const bx = gx + (it.col / it.cols) * gw + 0.4, bw = gw / it.cols - 0.8;
        const by = y + ((it.s - day.date) / 3600000 - h0) * rowH + 0.2, bh = Math.max(3.4, ((it.re - it.s) / 3600000) * rowH - 0.4);
        const c = it.color;
        if (it.kind === 'ev') {
          g.rect(bx, by, bw, bh, { fill: mix(c, 0.34), r: 0.7 });
          g.rect(bx, by, 1.1, bh, { fill: hex(c) });
          g.text(fit(g, it.title, 6.6, true, bw - 3.2), bx + 2.2, by + 2.8, { size: 6.6, bold: true });
          if (bh >= 6.6) g.text(hhmm(it.s) + '-' + hhmm(it.re), bx + 2.2, by + 5.4, { size: 5.8, color: GREY });
        } else {
          g.rect(bx, by, bw, bh, { fill: mix(c, 0.13), stroke: mix(c, 0.55), lw: 0.15, r: 0.7 });
          g.rect(bx, by, 0.9, bh, { fill: hex(c) });
          g.rect(bx + 1.9, by + 0.85, 2, 2, { stroke: INK, lw: 0.2 });
          g.text(fit(g, (it.rec ? '~ ' : '') + it.title, 6.6, true, bw - 6.4), bx + 5, by + 2.8, { size: 6.6, bold: true, color: it.late ? ACCENT : INK });
          if (bh >= 6.6) g.text(hhmm(it.s) + '-' + hhmm(it.re), bx + 5, by + 5.4, { size: 5.8, color: GREY });
        }
      });
      y += gridH + 5.2;
    } else y += 1;

    // tasks and progress
    const notesH = o.notes ? (o.grid ? 24 : 34) : 0, bottom = oy + H - mb, notesTop = bottom - notesH;
    g.text(o.detail ? 'TASKS AND PROGRESS' : 'TASKS', x0, y, { size: 7, bold: true, color: GREY });
    g.line(x0 + (o.detail ? 29 : 11), y - 0.8, x0 + cw, y - 0.8, { color: FAINT, lw: 0.15 });
    let cy = y + 2.2;
    const limit = (o.notes ? notesTop - 3 : bottom);
    const drawn = [];
    const heightOf = (e) => (e.routine || e.rec || !o.detail ? 5.4 : 9.4 + (e.note ? 3 : 0));
    let used = cy, hidden = 0;
    entries.forEach((e) => { const h = heightOf(e); if (used + h <= limit - 5.4 || (used + h <= limit && e === entries[entries.length - 1])) { drawn.push(e); used += h; } else hidden++; });
    let yy = cy;
    drawn.forEach((e) => {
      const h = heightOf(e), base = yy, done = e.status === 'Done' || e.doneToday;
      const flags = [];
      if (e.dueToday) flags.push('DUE TODAY'); if (e.overdue) flags.push('OVERDUE'); if (e.doneToday) flags.push('DONE TODAY'); if (e.late && !e.dueToday && !e.overdue) flags.push('LATE');
      const alert = !!(e.dueToday || e.overdue || e.late) && !done;
      g.line(x0, base + h - 0.4, x0 + cw, base + h - 0.4, { color: [226, 226, 230], lw: 0.1 });
      if (e.routine || e.rec || !o.detail) {
        const by = base + 3.7;
        g.rect(x0, by - 2.7, 3, 3, { stroke: INK, lw: 0.22 });
        if (done) { g.line(x0 + 0.6, by - 1.2, x0 + 1.3, by - 0.3, { lw: 0.35 }); g.line(x0 + 1.3, by - 0.3, x0 + 2.5, by - 2.2, { lw: 0.35 }); }
        let info = [e.first != null ? hhmm(e.first) : '', e.prog != null ? pctOf(e.prog) + '%' : '', (e.routine || e.rec) ? fmtDur(e.min) + ' repeat' : '', flags.join(' ')].filter(Boolean).join('  ');
        info = safe(info);
        const iw = info ? g.width(info, 6.6, alert) : 0;
        g.text(fit(g, e.title, 8, false, cw - 5.4 - iw - 2), x0 + 5, by, { size: 8, color: alert ? ACCENT : done ? GREY : INK });
        if (info) g.text(info, x0 + cw, by, { size: 6.6, bold: alert, color: alert ? ACCENT : GREY, align: 'right' });
        yy += h;
        return;
      }
      const p = e.prog || 0, pt = pctOf(p) + '%', pw = g.width(pt, 8, true);
      g.rect(x0, base + 0.6, 3, 3, { stroke: INK, lw: 0.22 });
      if (done) { g.line(x0 + 0.6, base + 2.1, x0 + 1.3, base + 3, { lw: 0.35 }); g.line(x0 + 1.3, base + 3, x0 + 2.5, base + 1.1, { lw: 0.35 }); }
      g.text(fit(g, e.title, 8, e.pri === 'High', cw - 5 - pw - 2), x0 + 5, base + 3.2, { size: 8, bold: e.pri === 'High', color: alert ? ACCENT : done ? GREY : INK });
      g.text(pt, x0 + cw, base + 3.2, { size: 8, bold: true, color: alert ? ACCENT : INK, align: 'right' });
      // progress bar with 25% ticks, to pencil in new progress
      const bx = x0 + 5, bw = cw - 5;
      g.rect(bx, base + 4.5, bw, 1.15, { fill: [226, 226, 230] });
      if (p > 0) g.rect(bx, base + 4.5, bw * Math.min(1, p), 1.15, { fill: alert ? ACCENT : INK });
      [0.25, 0.5, 0.75].forEach((t) => g.line(bx + bw * t, base + 4.2, bx + bw * t, base + 5.95, { color: [140, 140, 146], lw: 0.15 }));
      // status and details
      const parts = [e.status || '', e.project, e.first != null ? hhmm(e.first) + ' ' + fmtDur(e.min) : '', e.due && !e.dueToday && !e.overdue ? 'due ' + dueText(e.due) : (e.overdue && e.due ? 'was due ' + dueText(e.due) : '')].filter(Boolean);
      const fl = safe(flags.join('  ')), fw = fl ? g.width(fl, 6.2, true) : 0;
      g.text(fit(g, parts.join('  |  '), 6.3, false, cw - 5 - fw - 3), x0 + 5, base + 8.4, { size: 6.3, color: GREY });
      if (fl) g.text(fl, x0 + cw, base + 8.4, { size: 6.2, bold: true, color: ACCENT, align: 'right' });
      if (e.note) g.text(fit(g, 'Note: ' + e.note, 6.3, false, cw - 5), x0 + 5, base + 11.4, { size: 6.3, color: [80, 80, 86] });
      yy += h;
    });
    const more = hidden + built.moreOverdue;
    if (more > 0) { g.text('+' + more + ' more in the planner', x0, Math.min(yy + 3.2, limit - 0.5), { size: 7, color: GREY }); yy += 5.4; }
    // spare lines for things you add by hand
    for (let i = 0; i < 3 && yy + 5.4 <= limit; i++, yy += 5.4) {
      g.rect(x0, yy + 1, 3, 3, { stroke: INK, lw: 0.22 });
      g.line(x0, yy + 5, x0 + cw, yy + 5, { color: [226, 226, 230], lw: 0.1 });
    }

    // notes
    if (o.notes) {
      g.text('NOTES', x0, notesTop + 2.4, { size: 7, bold: true, color: GREY });
      g.line(x0 + 11, notesTop + 1.6, x0 + cw, notesTop + 1.6, { color: FAINT, lw: 0.15 });
      for (let ly = notesTop + 8.4; ly <= bottom - 0.5; ly += 6.2) g.line(x0, ly, x0 + cw, ly, { color: [214, 214, 219], lw: 0.12 });
    }
  }

  /* ---------- sheets and the PDF ---------- */
  function sheetPlan(o) {
    const W = o.w * 10, H = o.h * 10, m = 6;
    const two = o.layout !== 'one' && 2 * W <= 297 - m && H <= 210 - m;
    if (two) return { per: 2, land: true, W, H, ox: (297 - 2 * W) / 2, oy: (210 - H) / 2 };
    if (W <= 210 - m && H <= 297 - m) return { per: 1, land: false, W, H, ox: (210 - W) / 2, oy: (297 - H) / 2 };
    if (W <= 297 - m && H <= 210 - m) return { per: 1, land: true, W, H, ox: (297 - W) / 2, oy: (210 - H) / 2 };
    return null;
  }
  const defaults = () => ({ hFrom: null, hTo: null, w: 13, h: 20, layout: 'auto', bind: 'left', grid: true, detail: true, done: true, events: true, tasks: true, deadlines: true, routines: true, overdue: true, notes: true, frame: true });

  async function generate(opts, data) {
    const o = Object.assign(defaults(), opts), sp = sheetPlan(o);
    if (!sp) throw new Error('That page size does not fit on an A4 sheet.');
    const J = window.jspdf && window.jspdf.jsPDF;
    if (!J) throw new Error('The PDF library is not loaded.');
    const doc = new J({ unit: 'mm', format: 'a4', orientation: sp.land ? 'l' : 'p', compress: true });
    doc.setProperties({ title: 'Daily pages ' + ymd(data.days[0].date), creator: 'Task Progress' });
    const g = pdfGfx(doc);
    for (let i = 0; i < data.days.length; i += sp.per) {
      if (i > 0) doc.addPage('a4', sp.land ? 'l' : 'p');
      for (let k = 0; k < sp.per && i + k < data.days.length; k++) drawDay(g, sp.ox + k * sp.W, sp.oy, sp.W, sp.H, data.days[i + k], o, data, i + k === 0);
    }
    return { blob: doc.output('blob'), sheets: Math.ceil(data.days.length / sp.per), plan: sp };
  }
  function drawPreview(canvas, o, data, idx) {
    const W = o.w * 10, H = o.h * 10, s = Math.min(8, 1100 / H);
    canvas.width = Math.round(W * s); canvas.height = Math.round(H * s);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawDay(canvasGfx(ctx, s), 0, 0, W, H, data.days[idx], Object.assign({}, o, { frame: false }), data, idx === 0);
  }

  /* ---------- dialog ---------- */
  const OKEY = 'print-opts';
  async function loadOpts() { try { const r = await AppStorage.get(OKEY, false); return r && r.value ? JSON.parse(r.value) : {}; } catch (e) { return {}; } }
  function saveOpts(o) { try { AppStorage.set(OKEY, JSON.stringify(o), false); } catch (e) { /* ignore */ } }
  const toast = (m, x) => { if (typeof showToast === 'function') showToast(m, x); };

  async function open(init) {
    if (!window.planner || !window.planner.openModal) { toast('The planner is not ready yet.'); return; }
    init = init || {};
    const saved = await loadOpts(), o = Object.assign(defaults(), saved);
    const tomorrow = new Date(); tomorrow.setHours(0, 0, 0, 0); tomorrow.setDate(tomorrow.getDate() + 1);
    let start = init.start ? new Date(init.start) : tomorrow; start.setHours(0, 0, 0, 0);
    let days = init.days || Math.min(400, Math.max(1, +saved.days || 31)), data = null, idx = 0, busy = 0;
    const chk = (k, label) => '<label class="pp-chk"><input type="checkbox" data-o="' + k + '"' + (o[k] ? ' checked' : '') + '> ' + label + '</label>';
    const html = '<div class="pr-wrap"><div class="pr-form">' +
      '<div class="pp-grid"><label>First day<input type="date" id="prStart" value="' + ymd(start) + '"></label><label>Number of days<input type="number" id="prDays" min="1" max="400" value="' + days + '"></label></div>' +
      '<div class="pr-presets" id="prPre"><button type="button" class="dchip" data-d="0">Start today</button><button type="button" class="dchip" data-d="1">Start tomorrow</button><span class="pr-sp"></span>' + [7, 14, 31, 90, 365].map((n) => '<button type="button" class="dchip" data-n="' + n + '">' + n + ' days</button>').join('') + '</div>' +
      '<div class="pp-grid"><label>Notebook page width (cm)<input type="number" id="prW" min="8" max="29" step="0.5" value="' + o.w + '"></label><label>Notebook page height (cm)<input type="number" id="prH" min="8" max="29" step="0.5" value="' + o.h + '"></label></div>' +
      '<div class="pp-grid"><label>On the A4 sheet<select id="prLayout"><option value="auto"' + (o.layout === 'auto' ? ' selected' : '') + '>As many as fit (cut apart)</option><option value="one"' + (o.layout === 'one' ? ' selected' : '') + '>One page per sheet</option></select></label>' +
      '<label>Extra margin for binding<select id="prBind"><option value="left"' + (o.bind === 'left' ? ' selected' : '') + '>Left side</option><option value="right"' + (o.bind === 'right' ? ' selected' : '') + '>Right side</option><option value="none"' + (o.bind === 'none' ? ' selected' : '') + '>None</option></select></label></div>' +
      '<div class="pp-grid"><label>Schedule starts at (hour)<input type="number" id="prFrom" min="0" max="22" placeholder="auto" value="' + (Number.isFinite(o.hFrom) ? o.hFrom : '') + '"></label><label>Schedule ends at (hour)<input type="number" id="prTo" min="1" max="24" placeholder="auto" value="' + (Number.isFinite(o.hTo) ? o.hTo : '') + '"></label></div>' +
      '<div class="pp-sec">Show on each page</div>' +
      chk('detail', 'Task progress: status, progress bar, percentage and last note') + chk('tasks', 'Tasks planned that day') + chk('deadlines', 'Tasks due that day') + chk('done', 'Tasks completed that day') + chk('routines', 'Repeating routines') + chk('overdue', 'Overdue tasks, on the first page') + chk('events', 'Meetings and events') + chk('grid', 'Hourly schedule (switch off for a longer task list)') + chk('notes', 'Ruled notes area') + chk('frame', 'Dashed cut frame around each page (needs about 5 mm of free paper edge: switch it off if your printer cuts it)') +
      '<div class="pp-note" id="prInfo"></div>' +
      '<div class="pp-act"><button class="pl-btn pri" id="prGo" type="button">Download PDF</button></div></div>' +
      '<div class="pr-prev"><div class="pr-nav"><button class="pl-ic" id="prPrev" aria-label="Previous day">&lsaquo;</button><span id="prDate"></span><button class="pl-ic" id="prNext" aria-label="Next day">&rsaquo;</button></div><canvas id="prCanvas" aria-label="Preview of the page"></canvas></div></div>';
    window.planner.openModal('Print daily pages', html, (bg) => {
      bg.querySelector('.pl-card').style.width = 'min(1060px, 96vw)';
      const $ = (id) => bg.querySelector('#' + id);
      const read = () => {
        o.w = Math.min(29, Math.max(8, parseFloat($('prW').value) || 13)); o.h = Math.min(29, Math.max(8, parseFloat($('prH').value) || 20));
        o.layout = $('prLayout').value; o.bind = $('prBind').value;
        const f = parseInt($('prFrom').value, 10), t = parseInt($('prTo').value, 10);
        o.hFrom = Number.isFinite(f) ? Math.min(22, Math.max(0, f)) : null; o.hTo = Number.isFinite(t) ? Math.min(24, Math.max(1, t)) : null;
        bg.querySelectorAll('[data-o]').forEach((c) => { o[c.dataset.o] = c.checked; });
        days = Math.min(400, Math.max(1, parseInt($('prDays').value, 10) || 31));
        start = fromYmd($('prStart').value) || tomorrow;
      };
      const info = () => {
        const sp = sheetPlan(o);
        $('prInfo').textContent = !sp ? 'That page size does not fit on an A4 sheet.' : days + (days === 1 ? ' day' : ' days') + ' on ' + Math.ceil(days / sp.per) + (Math.ceil(days / sp.per) === 1 ? ' A4 sheet' : ' A4 sheets') + (sp.per === 2 ? ' (landscape, two pages per sheet: cut along the dashed lines)' : ' (page centred on the sheet)') + '. Print at 100% / actual size, not "fit to page".';
        $('prGo').disabled = !sp;
      };
      const paint = () => {
        if (!data || !data.days.length) return;
        idx = Math.min(Math.max(idx, 0), data.days.length - 1);
        const d = new Date(data.days[idx].date);
        $('prDate').textContent = DOW[d.getDay()].slice(0, 3) + ' ' + d.getDate() + ' ' + MON3[d.getMonth()] + ' ' + d.getFullYear();
        drawPreview($('prCanvas'), o, data, idx);
      };
      const reload = async () => {
        read(); info();
        const my = ++busy;
        const dd = await window.planner.dayData(start.getTime(), days);
        if (my !== busy) return;
        data = dd; paint();
      };
      let t = null;
      const later = () => { clearTimeout(t); t = setTimeout(reload, 220); };
      bg.addEventListener('input', later); bg.addEventListener('change', later);
      $('prPre').addEventListener('click', (e) => {
        const b = e.target.closest('[data-n]'), d = e.target.closest('[data-d]');
        if (b) { $('prDays').value = b.dataset.n; reload(); }
        else if (d) { const t = new Date(); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() + (+d.dataset.d)); $('prStart').value = ymd(t); reload(); }
      });
      $('prPrev').onclick = () => { idx--; paint(); }; $('prNext').onclick = () => { idx++; paint(); };
      $('prGo').onclick = async () => {
        read(); info();
        const btn = $('prGo'); btn.disabled = true; btn.textContent = 'Preparing…';
        try {
          const dd = await window.planner.dayData(start.getTime(), days);
          const r = await generate(o, dd);
          saveOpts(Object.assign({}, o, { days }));
          const a = document.createElement('a');
          a.href = URL.createObjectURL(r.blob); a.download = 'daily-pages-' + ymd(start) + '-' + days + 'd.pdf';
          document.body.appendChild(a); a.click();
          setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
          toast('PDF ready: ' + r.sheets + (r.sheets === 1 ? ' sheet' : ' sheets'));
        } catch (e) { toast(String((e && e.message) || e), { type: 'error' }); }
        btn.disabled = false; btn.textContent = 'Download PDF';
      };
      reload();
    });
  }

  window.printpages = { open, generate, drawDay, drawPreview, sheetPlan, defaults, fit, safe };

  // a Print button in the dashboard header, next to Commands
  function mountButton() {
    const ref = document.getElementById('cmdkBtn');
    if (!ref) return false;
    if (document.getElementById('printPagesBtn')) return true;
    const b = document.createElement('button');
    b.id = 'printPagesBtn'; b.type = 'button'; b.className = ref.className;
    b.title = 'Print one page per day for your notebook, filled with your plan and task progress';
    b.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align:-2px"><path d="M6 9V3h12v6M6 18H4a1 1 0 01-1-1v-6a2 2 0 012-2h14a2 2 0 012 2v6a1 1 0 01-1 1h-2"/><rect x="6" y="14" width="12" height="7"/></svg> Print pages';
    b.addEventListener('click', () => open());
    ref.after(b);
    return true;
  }
  if (!mountButton()) {
    const start = () => { if (!mountButton()) { const mo = new MutationObserver(() => { if (mountButton()) mo.disconnect(); }); mo.observe(document.body, { childList: true, subtree: true }); setTimeout(() => mo.disconnect(), 10000); } };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  }
})();
