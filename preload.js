const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('budgetAPI', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  saveDataSync: (data) => ipcRenderer.sendSync('data:save-sync', data),
  openCsv: () => ipcRenderer.invoke('csv:open'),
  revealData: () => ipcRenderer.invoke('data:reveal'),
  exportData: (data) => ipcRenderer.invoke('data:export', data),
});
