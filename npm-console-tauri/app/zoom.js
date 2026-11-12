/* App zoom for the desktop builds (the browser already has its own zoom in the web version).
   Ctrl +, Ctrl -, Ctrl 0, Ctrl + mouse wheel, the buttons in the title bar, and /zoom in the console. */
(() => {
  'use strict';
  if (window.appZoom) return;
  const D = window.desktop, can = !!(D && D.zoom);
  const STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  let f = 1;
  const pct = () => Math.round(f * 100) + '%';

  function label() { const b = document.getElementById('dtbZoomPct'); if (b) { b.textContent = pct(); b.title = 'Zoom ' + pct() + '. Click to reset to 100%.'; } }
  function apply(n, save) {
    if (!can) return f;
    n = Math.min(3, Math.max(0.5, Math.round(n * 100) / 100));
    f = n;
    try { D.zoom.set(n); } catch (e) { /* ignore */ }
    window.__uiZoom = n;
    document.documentElement.style.setProperty('--zf', String(n));
    label();
    if (save !== false) { try { AppStorage.set('ui-zoom', String(n), false); } catch (e) { /* ignore */ } }
    if (typeof window.__syncOverlay === 'function') window.__syncOverlay();
    return n;
  }
  const zin = () => apply(STEPS.find((s) => s > f + 0.001) || STEPS[STEPS.length - 1]);
  const zout = () => apply([...STEPS].reverse().find((s) => s < f - 0.001) || STEPS[0]);
  const reset = () => apply(1);
  window.appZoom = { available: can, get: () => f, set: (n) => apply(n), in: zin, out: zout, reset };
  if (!can) return;

  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key, c = e.code;
    if (k === '=' || k === '+' || c === 'NumpadAdd') { e.preventDefault(); zin(); }
    else if (k === '-' || k === '_' || c === 'NumpadSubtract') { e.preventDefault(); zout(); }
    else if (k === '0' || c === 'Numpad0') { e.preventDefault(); reset(); }
  }, true);

  let last = 0;
  document.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.target.closest && e.target.closest('.pl-scroll')) return; // the calendar uses it for its own time scale
    e.preventDefault();
    const now = Date.now();
    if (now - last < 90) return;
    last = now;
    if (e.deltaY < 0) zin(); else if (e.deltaY > 0) zout();
  }, { passive: false, capture: true });

  function mountUi() {
    const bar = document.getElementById('dtb');
    if (!bar || document.getElementById('dtbZoom')) return !!bar;
    const g = document.createElement('div');
    g.id = 'dtbZoom'; g.className = 'dtb-zoom'; g.setAttribute('role', 'group'); g.setAttribute('aria-label', 'Zoom');
    g.innerHTML = '<button type="button" id="dtbZoomOut" aria-label="Zoom out" title="Zoom out (Ctrl -)">&minus;</button><button type="button" id="dtbZoomPct" class="pct">100%</button><button type="button" id="dtbZoomIn" aria-label="Zoom in" title="Zoom in (Ctrl +)">+</button>';
    const ctl = bar.querySelector('.dtb-ctl');
    if (ctl) bar.insertBefore(g, ctl); else bar.appendChild(g);
    document.getElementById('dtbZoomOut').onclick = zout;
    document.getElementById('dtbZoomIn').onclick = zin;
    document.getElementById('dtbZoomPct').onclick = reset;
    label();
    return true;
  }
  if (!mountUi()) { const mo = new MutationObserver(() => { if (mountUi()) mo.disconnect(); }); mo.observe(document.body, { childList: true }); setTimeout(() => mo.disconnect(), 8000); }

  Promise.resolve().then(() => AppStorage.get('ui-zoom', false)).then((r) => { const v = r && parseFloat(r.value); if (v && v >= 0.5 && v <= 3 && Math.abs(v - 1) > 0.001) apply(v, false); }).catch(() => {});
})();
