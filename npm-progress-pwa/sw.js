// Service worker: app shell is precached; same-origin GETs are served cache-first and refreshed in the background.
// API calls (Ollama / Ascend) are cross-origin or non-GET and are never intercepted.
const CACHE = 'npm-console-v7';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'planner.js', 'printpages.js', 'uikit.css', 'zoom.js', 'movable.js', 'ctxmenu.js', 'console.css', 'console.js', 'evidence.css', 'evidence.js', 'planner-engine.js', 'planner.css', 'sync-core.js', 'sync.js', 'sync.css', 'mobile.css',
  'vendor/chart.umd.js', 'vendor/exceljs.min.js', 'vendor/jspdf.umd.min.js', 'vendor/fonts.css',
  'vendor/fonts/orbitron-latin-500-normal.woff2', 'vendor/fonts/orbitron-latin-700-normal.woff2', 'vendor/fonts/orbitron-latin-800-normal.woff2',
  'vendor/fonts/rajdhani-latin-400-normal.woff2', 'vendor/fonts/rajdhani-latin-500-normal.woff2',
  'vendor/fonts/rajdhani-latin-600-normal.woff2', 'vendor/fonts/rajdhani-latin-700-normal.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req).then(res => {
        if (res && res.status === 200) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      if (cached) { e.waitUntil(network); return cached; }
      return (await network) || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
    })
  );
});
