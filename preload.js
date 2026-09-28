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
  keepBackup: (label) => ipcRenderer.invoke('data:keep-backup', label),
  importDataFile: () => ipcRenderer.invoke('data:import-file'),
  exportData: (data) => ipcRenderer.invoke('data:export', data),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  getVersion: () => ipcRenderer.invoke('app:version'),
  getUpdateCaps: () => ipcRenderer.invoke('update:caps'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateProgress: (cb) => ipcRenderer.on('update:progress', (_e, p) => cb(p)),
  // macOS application menu → renderer (main.js installDarwinMenu). Never
  // fires on Windows, where no menu is installed.
  onMenuUndo: (cb) => ipcRenderer.on('menu:undo', () => cb()),
  onMenuRedo: (cb) => ipcRenderer.on('menu:redo', () => cb()),
  // Display copy only: the renderer never reads process.platform itself.
  modKey: process.platform === 'darwin' ? '⌘' : 'Ctrl',
});
