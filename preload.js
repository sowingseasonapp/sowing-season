const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('budgetAPI', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  saveDataSync: (data) => ipcRenderer.sendSync('data:save-sync', data),
  openCsv: () => ipcRenderer.invoke('csv:open'),
  loadBankProfiles: () => ipcRenderer.invoke('profiles:load'),
  saveBankProfiles: (store) => ipcRenderer.invoke('profiles:save', store),
  revealData: () => ipcRenderer.invoke('data:reveal'),
  exportData: (data) => ipcRenderer.invoke('data:export', data),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
});
