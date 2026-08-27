const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { migrateLegacyData, LEGACY_APP_NAME } = require('./legacy-data');

// Dev escape hatch: point userData at a scratch folder (demo data, screenshot
// capture) so the real %APPDATA%\Sowing Season file is never touched.
if (process.env.BUDGET_DATA_DIR) app.setPath('userData', process.env.BUDGET_DATA_DIR);

const DATA_DIR = () => app.getPath('userData');
const DATA_FILE = () => path.join(DATA_DIR(), 'budget-data.json');
const BACKUP_DIR = () => path.join(DATA_DIR(), 'backups');
// Bank profiles the user has confirmed by importing (CSV importer §6). App
// configuration, not budget history — kept out of budget-data.json so the
// rolling backups and the data version field never see it.
const PROFILES_FILE = () => path.join(DATA_DIR(), 'bank-profiles.json');
const MAX_BACKUPS = 30;

// A brand-new install starts empty: no months, current data version. The
// renderer sees the empty months array and runs the onboarding wizard, which
// does the first save when it finishes — deliberately nothing is written here,
// so quitting mid-wizard leaves no file and the wizard runs again next launch.
const BLANK = () => ({
  version: 6, // current — no migrations may run on it
  settings: { tithePercent: 0.10, appName: 'Sowing Season' },
  months: [],
  aum: { assets: [], debts: [], snapshots: [], log: [] },
});

// Tolerate a UTF-8 BOM — some editors and PowerShell add one, and JSON.parse chokes on it.
const parseJson = (text) => JSON.parse(text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text);

function loadData() {
  const file = DATA_FILE();
  if (!fs.existsSync(file)) return BLANK(); // first run → onboarding wizard
  try {
    return parseJson(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    // Unreadable data file: fall back to the newest good backup rather than
    // starting empty, and keep the bad file for inspection.
    const backups = fs.existsSync(BACKUP_DIR())
      ? fs.readdirSync(BACKUP_DIR()).filter((f) => f.endsWith('.json')).sort().reverse()
      : [];
    for (const b of backups) {
      try {
        const data = parseJson(fs.readFileSync(path.join(BACKUP_DIR(), b), 'utf8'));
        fs.copyFileSync(file, file + '.corrupt');
        fs.writeFileSync(file, JSON.stringify(data));
        dialog.showErrorBox('Budget data recovered',
          `The budget file couldn't be read (${err.message}).\n\nIt was restored from the backup taken ${b.replace(/^budget-|\.json$/g, '')}.\nThe unreadable file was kept as budget-data.json.corrupt.`);
        return data;
      } catch { /* try the next backup */ }
    }
    // Last resort: start fresh. Never overwrite the user's file in this path —
    // but keep a .corrupt copy, because finishing the setup wizard later will
    // write a new data file over the unreadable one.
    try { fs.copyFileSync(file, file + '.corrupt'); } catch { /* read-only dir — leave it */ }
    dialog.showErrorBox('Budget data could not be read',
      `${err.message}\n\nNo usable backup was found in:\n${BACKUP_DIR()}\n\nThe app will start fresh. A copy of the unreadable file was saved as budget-data.json.corrupt in case it can be recovered.`);
    return BLANK();
  }
}

let lastBackupAt = 0;
function saveData(data) {
  const file = DATA_FILE();
  const json = JSON.stringify(data);
  // Atomic write: temp file then rename.
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, json);
  fs.renameSync(tmp, file);
  // Rolling backup at most once every 10 minutes.
  const now = Date.now();
  if (now - lastBackupAt > 10 * 60 * 1000) {
    lastBackupAt = now;
    fs.mkdirSync(BACKUP_DIR(), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    fs.writeFileSync(path.join(BACKUP_DIR(), `budget-${stamp}.json`), json);
    const old = fs.readdirSync(BACKUP_DIR()).filter((f) => f.endsWith('.json')).sort();
    while (old.length > MAX_BACKUPS) fs.unlinkSync(path.join(BACKUP_DIR(), old.shift()));
  }
  return true;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#f7f5ee',
    title: 'Sowing Season',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

// The app was "Family Budget" until 2026-08-23. Its data folder followed the
// name, so the first launch after the rename copies the old folder forward
// (copy, never move — the old folder stays as a safety net). Demo/scratch runs
// (BUDGET_DATA_DIR) must never pull real data into themselves. A failure here
// is surfaced before anything else happens: silently booting the first-run
// wizard over nine months of history is exactly what this exists to prevent.
function migrateLegacyDataDir() {
  if (process.env.BUDGET_DATA_DIR) return;
  const oldDir = path.join(app.getPath('appData'), LEGACY_APP_NAME);
  try {
    const res = migrateLegacyData(oldDir, app.getPath('userData'));
    if (res.migrated) console.log(`Copied ${res.files.length} file(s) from "${oldDir}"`);
  } catch (err) {
    dialog.showErrorBox("Couldn't copy your existing budget data",
      `Sowing Season tried to copy your existing data from\n${oldDir}\nto\n${app.getPath('userData')}\nbut hit an error:\n\n${err.message}\n\nNothing was removed. The app will open without your history — close it, fix the problem (disk space, permissions), and launch again; the copy is retried on every start until it succeeds.`);
  }
}

app.whenReady().then(() => {
  migrateLegacyDataDir();
  ipcMain.handle('data:load', () => loadData());
  ipcMain.handle('data:save', (_e, data) => saveData(data));
  ipcMain.on('data:save-sync', (e, data) => { e.returnValue = saveData(data); });
  ipcMain.handle('csv:open', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Choose bank CSV export',
      filters: [{ name: 'CSV files', extensions: ['csv'] }, { name: 'All files', extensions: ['*'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths.length) return null;
    // Raw bytes so the importer can sniff the encoding (UTF-16, windows-1252);
    // `text` stays for compatibility with anything still reading it.
    const bytes = fs.readFileSync(res.filePaths[0]);
    return { path: res.filePaths[0], text: bytes.toString('utf8'), bytes };
  });
  ipcMain.handle('profiles:load', () => {
    try { return parseJson(fs.readFileSync(PROFILES_FILE(), 'utf8')); }
    catch { return { version: 1, profiles: [] }; }
  });
  ipcMain.handle('profiles:save', (_e, store) => {
    fs.mkdirSync(DATA_DIR(), { recursive: true });
    const tmp = PROFILES_FILE() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store, null, 1));
    fs.renameSync(tmp, PROFILES_FILE());
    return true;
  });
  ipcMain.handle('data:reveal', () => { shell.showItemInFolder(DATA_FILE()); return true; });
  // System-browser / mail-client links. https:// or mailto: only —
  // never pass arbitrary strings or other schemes to openExternal.
  const EXTERNAL_URL_OK = /^(?:https:\/\/|mailto:)[^\s]+$/i;
  ipcMain.handle('shell:open-external', (_e, url) => {
    if (typeof url === 'string' && EXTERNAL_URL_OK.test(url)) shell.openExternal(url);
    return true;
  });
  ipcMain.handle('data:export', async (_e, data) => {
    const res = await dialog.showSaveDialog({
      title: 'Export budget data',
      defaultPath: `budget-export-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return false;
    fs.writeFileSync(res.filePath, JSON.stringify(data, null, 1));
    return true;
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
