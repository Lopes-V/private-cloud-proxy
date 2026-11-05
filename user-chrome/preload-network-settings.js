const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('networkSettings', {
  getState: () => ipcRenderer.invoke('network:get-state'),
  apply: config => ipcRenderer.invoke('network:apply', config),
  saveOnClose: config => ipcRenderer.send('network:save-on-close', config),
  diagnose: target => ipcRenderer.invoke('network:diagnose', target)
})
