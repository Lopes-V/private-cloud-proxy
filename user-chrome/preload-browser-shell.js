const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('browserShell', {
  state: () => ipcRenderer.invoke('browser:state'),
  newTab: url => ipcRenderer.invoke('browser:new-tab', url),
  activate: id => ipcRenderer.invoke('browser:activate', id),
  close: id => ipcRenderer.invoke('browser:close', id),
  navigate: url => ipcRenderer.invoke('browser:navigate', url),
  command: name => ipcRenderer.invoke('browser:command', name),
  favorite: () => ipcRenderer.invoke('browser:favorite'),
  panel: name => ipcRenderer.invoke('browser:panel', name),
  networkSettings: () => ipcRenderer.invoke('browser:network-settings'),
  showDownload: id => ipcRenderer.invoke('browser:show-download', id),
  onState: callback => ipcRenderer.on('browser:state', (_event, state) => callback(state)),
  onAction: callback => ipcRenderer.on('browser:action', (_event, action) => callback(action))
})
