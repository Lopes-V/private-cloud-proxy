'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browser', {
  navigate: address => ipcRenderer.invoke('protected:navigate', String(address)),
  back: () => ipcRenderer.invoke('protected:back'),
  forward: () => ipcRenderer.invoke('protected:forward'),
  reload: () => ipcRenderer.invoke('protected:reload'),
  home: () => ipcRenderer.invoke('protected:home'),
  onState: handler => ipcRenderer.on('protected:state', (_event, state) => handler(state)),
  onFocusAddress: handler => ipcRenderer.on('protected:focus-address', handler)
});
