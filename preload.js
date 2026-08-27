const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('budgetAPI', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  saveDataSync: (data) => ipcRenderer.sendSync('data:save-sync', data),
  openCsv: () => ipcRenderer.invoke('csv:open'),
  loadBankProfiles: () => ipcRenderer.invoke('profiles:load'),
  saveBankProfiles: (store) => ipcRenderer.invoke('profiles:save', store),
  revealData: () => ipcRenderer.invoke('data:reveal'),
  listBackups: () => ipcRenderer.invoke('backups:list'),
  restoreBackup: (name) => ipcRenderer.invoke('data:restore', name),
  importDataFile: () => ipcRenderer.invoke('data:import-file'),
  exportData: (data) => ipcRenderer.invoke('data:export', data),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
});
