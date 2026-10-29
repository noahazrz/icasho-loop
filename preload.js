'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),
  setState: (patch) => ipcRenderer.invoke('state:set', patch),
  scan: (user) => ipcRenderer.invoke('scan:start', user),
  cancelScan: () => ipcRenderer.invoke('scan:cancel'),
  onScanProgress: (cb) => {
    const fn = (_e, data) => cb(data);
    ipcRenderer.on('scan:progress', fn);
    return () => ipcRenderer.removeListener('scan:progress', fn);
  },
  setAlwaysOnTop: (on) => ipcRenderer.invoke('win:alwaysOnTop', on),
  setOpacity: (v) => ipcRenderer.invoke('win:opacity', v),
  minimize: () => ipcRenderer.invoke('win:minimize'),
  close: () => ipcRenderer.invoke('win:close'),
});
