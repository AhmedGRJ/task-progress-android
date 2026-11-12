/* Makes the Tauri runtime look like the desktop bridge the dashboard and console already use:
   window.storage (file-backed, via Rust) and window.desktop (AI fetch, hotkey event, window controls). */
(() => {
  const T = window.__TAURI__;
  if (!T || !T.core) return; // plain browser: nothing to do
  const invoke = T.core.invoke;
  const ua = navigator.userAgent;
  const platform = /Windows/.test(ua) ? 'win32' : /Mac/.test(ua) ? 'darwin' : 'linux';
  const win = T.window.getCurrentWindow();

  window.desktop = {
    isDesktop: true,
    engine: 'tauri',
    platform,
    customControls: true,
    fetch: (req) => invoke('net_fetch', { req }),
    onFocusConsole: (cb) => { T.event.listen('console:focus', () => cb()); },
    setOverlay: async () => {},
    zoom: { set: (f) => T.webview.getCurrentWebview().setZoom(f), get: () => 1 },
    feed: {
      configure: (cfg) => invoke('feed_configure', { cfg }),
      update: (body) => invoke('feed_update', { body })
    },
    update: {
      check: () => invoke('update_check'),
      status: () => invoke('update_status'),
      setUrl: (url) => invoke('update_set_url', { url }),
      install: () => invoke('update_install'),
      onStatus: (cb) => { T.event.listen('update:status', (e) => cb(e.payload)); }
    },
    win: {
      minimize: () => win.minimize(),
      toggleMaximize: () => win.toggleMaximize(),
      close: () => win.close(),
      isMaximized: () => win.isMaximized(),
      onResized: (cb) => win.onResized(cb)
    }
  };

  window.storage = {
    get: async (key, shared) => {
      const value = await invoke('store_get', { key });
      return value == null ? null : { key, value, shared: !!shared };
    },
    set: async (key, value, shared) => {
      await invoke('store_set', { key, value: String(value) });
      return { key, value, shared: !!shared };
    },
    delete: async (key, shared) => {
      await invoke('store_delete', { key });
      return { key, deleted: true, shared: !!shared };
    },
    list: async (prefix, shared) => {
      const keys = await invoke('store_list', { prefix: prefix || null });
      return { keys, prefix, shared: !!shared };
    }
  };
})();
