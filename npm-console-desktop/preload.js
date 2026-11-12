const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,
  fetch: (req) => ipcRenderer.invoke('net:fetch', req),
  onFocusConsole: (cb) => { ipcRenderer.on('console:focus', () => cb()); },
  setOverlay: (color, symbolColor, height) => ipcRenderer.invoke('win:overlay', color, symbolColor, height),
  zoom: {
    set: (f) => { webFrame.setZoomFactor(f); return webFrame.getZoomFactor(); },
    get: () => webFrame.getZoomFactor()
  },
  feed: {
    configure: (cfg) => ipcRenderer.invoke('feed:configure', cfg),
    update: (body) => ipcRenderer.invoke('feed:update', body)
  },
  hub: {
    configure: (cfg) => ipcRenderer.invoke('hub:configure', cfg),
    status: () => ipcRenderer.invoke('hub:status')
  },
  syncFile: {
    pick: () => ipcRenderer.invoke('sync:pick'),
    read: (p) => ipcRenderer.invoke('sync:read', p),
    write: (p, text, expected) => ipcRenderer.invoke('sync:write', p, text, expected)
  },
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    status: () => ipcRenderer.invoke('update:status'),
    setUrl: (url) => ipcRenderer.invoke('update:setUrl', url),
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: (cb) => { ipcRenderer.on('update:status', (_e, s) => cb(s)); }
  }
});

// Same shape as the artifact storage bridge the dashboard already prefers,
// so every save lands in a real file on disk instead of browser storage.
contextBridge.exposeInMainWorld('storage', {
  get: async (key, shared) => {
    const value = await ipcRenderer.invoke('store:get', key);
    return value == null ? null : { key, value, shared: !!shared };
  },
  set: async (key, value, shared) => {
    await ipcRenderer.invoke('store:set', key, String(value));
    return { key, value, shared: !!shared };
  },
  delete: async (key, shared) => {
    await ipcRenderer.invoke('store:delete', key);
    return { key, deleted: true, shared: !!shared };
  },
  list: async (prefix, shared) => {
    const keys = await ipcRenderer.invoke('store:list', prefix || '');
    return { keys, prefix, shared: !!shared };
  }
});
