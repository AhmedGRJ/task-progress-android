/* Movable windows: every dialog and popover can be dragged by its title area (or the grip at the top), or nudged with Alt+arrow keys.
   Double-click the title area to put it back. Dashboard dialogs return to the centre when they are closed. */
(() => {
  'use strict';
  if (window.movable) return;
  const SEL = '.modal-overlay .modal, .pl-pop, .pl-card, .ev-card, .cmdk-box';
  const HANDLE = ':scope > .pl-card-h, :scope > .ev-card-h, :scope > .pp-h, :scope > h1, :scope > h2, :scope > h3, :scope > .modal-title, :scope > .mv-handle';
  const INTERACTIVE = 'input, select, textarea, button, a, label, [contenteditable], .ev-th, .ev-add, .ev-box, .ev-hint, .cm';
  const BAND = 38;

  const off = (w) => { const m = /(-?[\d.]+)px\s+(-?[\d.]+)px/.exec(w.style.translate || ''); return m ? [parseFloat(m[1]), parseFloat(m[2])] : [0, 0]; };
  function setOff(w, x, y) {
    // keep at least a corner of the title area on screen
    const r = w.getBoundingClientRect(), [cx, cy] = off(w), vw = window.innerWidth, vh = window.innerHeight;
    let dx = x - cx, dy = y - cy;
    const left = r.left + dx, top = r.top + dy;
    if (left + r.width < 90) dx += 90 - (left + r.width);
    if (left > vw - 90) dx -= left - (vw - 90);
    if (top < 0) dy -= top;
    if (top > vh - BAND) dy -= top - (vh - BAND);
    const nx = cx + dx, ny = cy + dy;
    w.style.translate = nx || ny ? nx + 'px ' + ny + 'px' : '';
  }
  function reset(w) { w.style.translate = ''; }
  function closeWin(w) {
    const pick = w.querySelector('[data-x], [id$="CloseBtn"], [id$="Close"], .modal-close, [aria-label="Close"]') ||
      Array.from(w.querySelectorAll('button')).find((b) => /^\s*(close|cancel|done|ok|×|✕)/i.test(b.textContent));
    if (pick) { pick.click(); return; }
    const ov = w.closest('.modal-overlay');
    if (ov) ov.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }

  function inHandle(w, e) {
    if (e.target.closest(INTERACTIVE) && !e.target.closest('.mv-grip')) return false;
    if (e.target.closest('.mv-grip')) return true;
    const h = w.querySelector(HANDLE);
    if (h && h.contains(e.target)) return true;
    const r = w.getBoundingClientRect();
    return e.clientY - r.top < BAND;
  }

  let drag = null;
  function onDown(e) {
    const w = e.currentTarget;
    if (e.button !== 0 || !inHandle(w, e)) return;
    const [ox, oy] = off(w);
    drag = { w, x0: e.clientX, y0: e.clientY, ox, oy, moved: false };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }
  function onMove(e) {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
    if (!drag.moved) { drag.moved = true; drag.w.classList.add('mv-dragging'); document.body.classList.add('mv-active'); }
    setOff(drag.w, drag.ox + e.clientX - drag.x0, drag.oy + e.clientY - drag.y0);
  }
  function onUp() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    if (drag) drag.w.classList.remove('mv-dragging');
    document.body.classList.remove('mv-active');
    drag = null;
  }

  function attach(w) {
    if (w.dataset.mv || w.closest('#pinLockOverlay')) return;
    w.dataset.mv = '1';
    const grip = document.createElement('div');
    grip.className = 'mv-grip'; grip.title = 'Drag to move this window. Double-click to put it back.'; grip.setAttribute('aria-hidden', 'true');
    w.insertBefore(grip, w.firstChild);
    w.addEventListener('pointerdown', onDown);
    w.addEventListener('dblclick', (e) => { if (inHandle(w, e)) reset(w); });
  }
  function topWindow() {
    const ae = document.activeElement && document.activeElement.closest ? document.activeElement.closest('[data-mv]') : null;
    if (ae) return ae;
    const open = Array.from(document.querySelectorAll('[data-mv]')).filter((w) => { const r = w.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(w).visibility !== 'hidden'; });
    return open.length ? open[open.length - 1] : null;
  }
  document.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || !/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return;
    const w = topWindow();
    if (!w) return;
    e.preventDefault();
    const [x, y] = off(w), st = e.shiftKey ? 80 : 24;
    setOff(w, x + (e.key === 'ArrowRight' ? st : e.key === 'ArrowLeft' ? -st : 0), y + (e.key === 'ArrowDown' ? st : e.key === 'ArrowUp' ? -st : 0));
  });
  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.matches && root.matches(SEL)) attach(root);
    if (root.querySelectorAll) root.querySelectorAll(SEL).forEach(attach);
  }

  // dashboard dialogs: forget the position once the dialog is closed
  function watchOverlay(ov) {
    if (ov.dataset.mvWatch) return;
    ov.dataset.mvWatch = '1';
    new MutationObserver(() => { if (getComputedStyle(ov).display === 'none') ov.querySelectorAll('[data-mv]').forEach(reset); }).observe(ov, { attributes: true, attributeFilter: ['style', 'class'] });
  }

  function init() {
    scan(document.body);
    document.querySelectorAll('.modal-overlay').forEach(watchOverlay);
    new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((n) => { scan(n); if (n.nodeType === 1 && n.classList && n.classList.contains('modal-overlay')) watchOverlay(n); }))).observe(document.body, { childList: true });
  }
  window.movable = { reset, close: closeWin, attach, scan };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
