const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch (e) { /* not installed: updates are simply unavailable */ }

const HOTKEY = 'CommandOrControl+Shift+Space';
const ICON = path.join(__dirname, 'build', 'icon.png');
const isMac = process.platform === 'darwin';

app.setAppUserModelId('com.ahmedgraja.taskprogress');

let win = null;
let tray = null;
let quitting = false;

/* ---------- File-based store (replaces browser localStorage) ---------- */
const userDir = () => app.getPath('userData');
const storeFile = () => path.join(userDir(), 'store.json');
let store = {};
let flushTimer = null;

function loadStore() {
  try { store = JSON.parse(fs.readFileSync(storeFile(), 'utf8')); } catch { store = {}; }
  dailyBackup();
}

function dailyBackup() {
  try {
    if (!fs.existsSync(storeFile())) return;
    const dir = path.join(userDir(), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const target = path.join(dir, `store-${day}.json`);
    if (!fs.existsSync(target)) fs.copyFileSync(storeFile(), target);
    const files = fs.readdirSync(dir).filter(f => /^store-.*\.json$/.test(f)).sort();
    files.slice(0, Math.max(0, files.length - 14)).forEach(f => fs.unlinkSync(path.join(dir, f)));
  } catch { /* backups are best effort */ }
}

function flushStore() {
  clearTimeout(flushTimer);
  flushTimer = null;
  try {
    fs.mkdirSync(userDir(), { recursive: true });
    const tmp = storeFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store));
    fs.renameSync(tmp, storeFile());
  } catch (e) { console.error('store flush failed', e); }
}

ipcMain.handle('store:get', (_e, key) => (key in store ? store[key] : null));
ipcMain.handle('store:set', (_e, key, value) => {
  store[key] = value;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flushStore, 200);
  return true;
});
ipcMain.handle('store:delete', (_e, key) => {
  delete store[key];
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flushStore, 200);
  return true;
});
ipcMain.handle('store:list', (_e, prefix) => Object.keys(store).filter(k => !prefix || k.startsWith(prefix)));

/* ---------- Network bridge: AI calls run here, so CORS never applies ---------- */
ipcMain.handle('net:fetch', async (_e, req) => {
  try {
    if (!/^https?:\/\//i.test(req.url)) return { error: 'Only http(s) URLs are allowed' };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120000);
    const go = () => fetch(req.url, { method: req.method || 'GET', headers: req.headers, body: req.body, signal: ctrl.signal });
    // Sync requests are safe to repeat; a pooled connection the server just closed fails once, then works.
    const safe = /\/v1\/sync$/.test(req.url) || /^(GET|HEAD|PUT)$/i.test(req.method || 'GET');
    let res;
    try { res = await go(); }
    catch (e) { if (safe && e && e.cause && /UND_ERR_SOCKET|ECONNRESET|EPIPE/.test(e.cause.code || '')) res = await go(); else throw e; }
    const text = await res.text();
    clearTimeout(timer);
    const headers = {}; res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    return { ok: res.ok, status: res.status, text, headers };
  } catch (err) {
    const why = err && err.cause ? ' (' + (err.cause.code || err.cause.message) + ')' : '';
    return { error: err.name === 'AbortError' ? 'Request timed out after 120 s' : String(err.message || err) + why };
  }
});

ipcMain.handle('win:overlay', (_e, color, symbolColor, height) => {
  if (win && typeof win.setTitleBarOverlay === 'function') {
    const h = Math.min(120, Math.max(24, Math.round(Number(height) || 36)));
    try { win.setTitleBarOverlay({ color, symbolColor, height: h }); } catch { /* not supported here */ }
  }
});

/* ---------- Calendar feed: serves the plan as a subscribable .ics ---------- */
const feed = { server: null, cfg: null, error: null, body: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Task Progress//Planner//EN\r\nEND:VCALENDAR\r\n' };

function feedUrls(cfg) {
  const p = '/plan-' + cfg.token + '.ics', urls = ['http://127.0.0.1:' + cfg.port + p];
  if (cfg.lan) {
    Object.values(os.networkInterfaces()).forEach((list) => (list || []).forEach((n) => {
      if (n.family === 'IPv4' && !n.internal) urls.push('http://' + n.address + ':' + cfg.port + p);
    }));
  }
  return urls;
}
function feedStatus() {
  const ok = !!feed.server && !feed.error && !!feed.cfg;
  return { running: ok, error: feed.error, urls: ok ? feedUrls(feed.cfg) : [] };
}
function feedStop() {
  return new Promise((resolve) => {
    const s = feed.server;
    feed.server = null;
    if (!s) { resolve(); return; }
    try { if (s.closeAllConnections) s.closeAllConnections(); s.close(() => resolve()); } catch (e) { resolve(); }
  });
}
ipcMain.handle('feed:configure', async (_e, raw) => {
  const cfg = { on: !!raw.on, lan: !!raw.lan, port: Math.min(65535, Math.max(1024, parseInt(raw.port, 10) || 8765)), token: String(raw.token || '').replace(/[^a-zA-Z0-9]/g, '') };
  const same = cfg.on && feed.server && !feed.error && feed.cfg && feed.cfg.lan === cfg.lan && feed.cfg.port === cfg.port && feed.cfg.token === cfg.token;
  if (same) return feedStatus();
  await feedStop();
  feed.error = null; feed.cfg = cfg;
  if (!cfg.on || !cfg.token) return { running: false, error: null, urls: [] };
  return new Promise((resolve) => {
    const path = '/plan-' + cfg.token + '.ics';
    const srv = http.createServer((req, res) => {
      const u = (req.url || '').split('?')[0];
      if (req.method === 'GET' && u === path) {
        res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(feed.body);
      } else { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); }
    });
    srv.on('error', (err) => {
      feed.error = err.code === 'EADDRINUSE' ? 'Port ' + cfg.port + ' is already in use' : String(err.message);
      feed.server = null;
      resolve(feedStatus());
    });
    srv.listen(cfg.port, cfg.lan ? '0.0.0.0' : '127.0.0.1', () => { feed.server = srv; resolve(feedStatus()); });
  });
});
ipcMain.handle('feed:update', (_e, body) => { feed.body = String(body || ''); return true; });

/* ---------- Sync hub: lets your phone sync with this computer over Wi-Fi or VPN ---------- */
const hub = { server: null, cfg: null, error: null, relay: null };
function hubAddresses() {
  const out = [];
  Object.values(os.networkInterfaces()).forEach((list) => (list || []).forEach((n) => { if (n.family === 'IPv4' && !n.internal) out.push(n.address); }));
  return out;
}
function hubStatus() {
  const ok = !!hub.server && !hub.error && !!hub.cfg;
  return { running: ok, error: hub.error, port: hub.cfg ? hub.cfg.port : null, lan: !!(hub.cfg && hub.cfg.lan), addresses: ok && hub.cfg.lan ? hubAddresses() : [] };
}
function hubStop() {
  return new Promise((resolve) => {
    const s = hub.server; hub.server = null;
    if (hub.relay) { try { hub.relay.flushAll(); } catch (e) { /* ignore */ } }
    if (!s) { resolve(); return; }
    try { if (s.closeAllConnections) s.closeAllConnections(); s.close(() => resolve()); } catch (e) { resolve(); }
  });
}
ipcMain.handle('hub:status', () => hubStatus());
ipcMain.handle('hub:configure', async (_e, raw) => {
  const cfg = { on: !!raw.on, lan: !!raw.lan, port: Math.min(65535, Math.max(1024, parseInt(raw.port, 10) || 8083)), token: String(raw.token || '') };
  const same = cfg.on && hub.server && !hub.error && hub.cfg && hub.cfg.lan === cfg.lan && hub.cfg.port === cfg.port && hub.cfg.token === cfg.token;
  if (same) return hubStatus();
  await hubStop();
  hub.error = null; hub.cfg = cfg;
  if (!cfg.on) return hubStatus();
  if (cfg.token.length < 8) { hub.error = 'The token needs at least 8 characters'; return hubStatus(); }
  const { createRelay } = require('./sync-relay.js');
  hub.relay = createRelay({ dataDir: path.join(app.getPath('userData'), 'sync-hub'), token: cfg.token });
  try { hub.server = await hub.relay.listen(cfg.port, cfg.lan ? '0.0.0.0' : '127.0.0.1'); }
  catch (err) { hub.error = err.code === 'EADDRINUSE' ? 'Port ' + cfg.port + ' is already in use' : String(err.message); hub.server = null; }
  return hubStatus();
});

/* ---------- Shared sync file (a file inside a OneDrive / Google Drive / Dropbox folder) ---------- */
const contentTag = (t) => require('crypto').createHash('sha1').update(t).digest('hex');
const okSyncPath = (p) => typeof p === 'string' && path.isAbsolute(p) && /\.json$/i.test(p);
ipcMain.handle('sync:pick', async () => {
  const r = await dialog.showOpenDialog(win || undefined, { title: 'Choose or create the sync file', defaultPath: path.join(app.getPath('documents'), 'task-progress-sync.json'), properties: ['openFile', 'promptToCreate', 'createDirectory'], filters: [{ name: 'Sync file', extensions: ['json'] }] });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});
ipcMain.handle('sync:read', async (_e, p) => {
  if (!okSyncPath(p)) return { error: 'Choose a .json file' };
  try { const text = fs.readFileSync(p, 'utf8'); return { text, mtime: contentTag(text) }; } // 'mtime' carries a content hash: robust against timestamp quirks of cloud folders
  catch (e) { return e.code === 'ENOENT' ? { text: null, mtime: null } : { error: 'Cannot read the sync file: ' + e.message }; }
});
ipcMain.handle('sync:write', async (_e, p, text, expected) => {
  if (!okSyncPath(p)) return { error: 'Choose a .json file' };
  try {
    let cur = null; try { cur = contentTag(fs.readFileSync(p, 'utf8')); } catch (e) { /* new file */ }
    if (cur !== null && String(cur) !== String(expected)) return { conflict: true };
    if (cur === null && expected != null) return { conflict: true };
    const tmp = p + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, String(text)); fs.renameSync(tmp, p);
    return { ok: true };
  } catch (e) { return { error: 'Cannot write the sync file: ' + e.message }; }
});

/* ---------- Updates (installed app only) ---------- */
const UPD_KEY = '__update_url';
const upd = { state: 'idle', version: null, msg: null, percent: null };
const updateUrl = () => String(store[UPD_KEY] || process.env.UPDATE_URL || '').trim();
const updSnapshot = () => Object.assign({}, upd, { current: app.getVersion(), url: updateUrl() });
function setUpd(patch) {
  Object.assign(upd, { msg: null }, patch);
  if (win && !win.isDestroyed()) win.webContents.send('update:status', updSnapshot());
}
function initUpdater() {
  if (!autoUpdater) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => setUpd({ state: 'checking' }));
  autoUpdater.on('update-available', (i) => setUpd({ state: 'downloading', version: i.version }));
  autoUpdater.on('update-not-available', () => setUpd({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => setUpd({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => setUpd({ state: 'ready', version: i.version }));
  autoUpdater.on('error', (e) => setUpd({ state: 'error', msg: String((e && e.message) || e).split('\n')[0].slice(0, 200) }));
}
async function checkUpdates() {
  if (!app.isPackaged || !autoUpdater) { upd.state = 'dev'; return updSnapshot(); }
  const url = updateUrl();
  if (!url) { upd.state = 'nourl'; return updSnapshot(); }
  try {
    autoUpdater.setFeedURL({ provider: 'generic', url });
    await autoUpdater.checkForUpdates();
  } catch (e) { setUpd({ state: 'error', msg: String((e && e.message) || e).split('\n')[0].slice(0, 200) }); }
  return updSnapshot();
}
ipcMain.handle('update:check', () => checkUpdates());
ipcMain.handle('update:status', () => updSnapshot());
ipcMain.handle('update:setUrl', (_e, url) => {
  store[UPD_KEY] = String(url || '').trim();
  clearTimeout(flushTimer); flushTimer = setTimeout(flushStore, 200);
  return checkUpdates();
});
ipcMain.handle('update:install', () => {
  if (upd.state !== 'ready' || !autoUpdater) return Object.assign(updSnapshot(), { state: 'error', msg: 'No update is ready yet.' });
  quitting = true;
  autoUpdater.quitAndInstall();
  return updSnapshot();
});
ipcMain.handle('app:info', () => ({ version: app.getVersion(), packaged: app.isPackaged }));

/* ---------- Window ---------- */
function readBounds() {
  try { return JSON.parse(store['__window'] || 'null'); } catch { return null; }
}

function createWindow() {
  const b = readBounds() || {};
  win = new BrowserWindow({
    width: b.width || 1480,
    height: b.height || 920,
    x: b.x, y: b.y,
    minWidth: 900, minHeight: 600,
    show: false,
    backgroundColor: '#F6F7FA',
    title: 'Task Progress',
    icon: ICON,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#FFFFFF', symbolColor: '#C7000B', height: 36 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  if (b.maximized) win.maximize();

  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });

  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });

  const saveBounds = () => {
    if (!win || win.isDestroyed()) return;
    const bounds = win.isMaximized() ? (readBounds() || {}) : win.getBounds();
    store['__window'] = JSON.stringify({ ...bounds, maximized: win.isMaximized() });
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flushStore, 200);
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);

  win.on('close', (e) => {
    if (!quitting && tray) { e.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { win = null; });
}

function showWindow() {
  if (!win) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function openConsole() {
  showWindow();
  const send = () => win && win.webContents.send('console:focus');
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send); else send();
}

function createTray() {
  try {
    const img = nativeImage.createFromPath(ICON).resize({ width: 18, height: 18 });
    tray = new Tray(img);
    tray.setToolTip('Task Progress');
    const build = () => Menu.buildFromTemplate([
      { label: 'Open console', accelerator: HOTKEY, click: openConsole },
      { label: 'Show dashboard', click: showWindow },
      { label: upd.state === 'ready' ? 'Restart to update to ' + (upd.version || 'the new version') : 'Check for updates', click: () => { if (upd.state === 'ready') { quitting = true; autoUpdater.quitAndInstall(); } else { openConsole(); checkUpdates().then((s) => { if (win && !win.isDestroyed()) win.webContents.send('update:status', s); }); } } },
      { type: 'separator' },
      {
        label: 'Start with system', type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked })
      },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit(); } }
    ]);
    tray.setContextMenu(build());
    tray.on('click', () => (win && win.isVisible() && win.isFocused() ? win.hide() : showWindow()));
    tray.on('right-click', () => tray.setContextMenu(build()));
  } catch (e) {
    tray = null; // without a tray the close button quits normally
  }
}

/* ---------- App lifecycle ---------- */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', openConsole);

  app.whenReady().then(() => {
    if (!isMac) Menu.setApplicationMenu(null);
    loadStore();
    createWindow();
    createTray();
    initUpdater();
    setTimeout(() => { if (updateUrl()) checkUpdates(); }, 20000);
    setInterval(() => { if (updateUrl()) checkUpdates(); }, 6 * 3600 * 1000);
    if (!globalShortcut.register(HOTKEY, openConsole)) {
      console.warn(`Global shortcut ${HOTKEY} is taken by another app`);
    }
    app.on('activate', showWindow);
  });

  app.on('before-quit', () => { quitting = true; flushStore(); feedStop(); hubStop(); });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('window-all-closed', () => { if (!tray && !isMac) app.quit(); });
}
