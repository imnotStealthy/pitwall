// electron/preload.cjs — safe IPC bridge for the settings window (contextIsolation on).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fh6', {
  getState: () => ipcRenderer.invoke('fh6:get-state'),
  setWidget: (id, on) => ipcRenderer.invoke('fh6:set-widget', id, on),
  setLocked: (v) => ipcRenderer.invoke('fh6:set-locked', v),
  setHidden: (v) => ipcRenderer.invoke('fh6:set-hidden', v),
  setGate: (v) => ipcRenderer.invoke('fh6:set-gate', v),
  setAppearance: (patch) => ipcRenderer.invoke('fh6:set-appearance', patch),
  setWidgetAppearance: (id, patch) => ipcRenderer.invoke('fh6:set-widget-appearance', id, patch),
  setAutostart: (v) => ipcRenderer.invoke('fh6:set-autostart', v),
  setNetwork: (patch) => ipcRenderer.invoke('fh6:set-network', patch),
  resetPositions: () => ipcRenderer.invoke('fh6:reset-positions'),
  reloadOverlays: () => ipcRenderer.invoke('fh6:reload-overlays'),
  openExternal: (url) => ipcRenderer.invoke('fh6:open-external', url),
  copyText: (text) => ipcRenderer.invoke('fh6:copy', text),
  // push: main → window when state changes elsewhere (tray, shortcut, foreground)
  onState: (cb) => ipcRenderer.on('fh6:state', (_e, s) => cb(s)),
});
