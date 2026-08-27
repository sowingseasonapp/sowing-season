/*
 * updater.js — the manual "Check for updates" flow
 * (_cowork/update-distribution-proposal.md rev 2, implemented for U7).
 *
 * The whole point is what this does NOT do: nothing here touches the network
 * until the user presses the button. No startup check, no timers, no telemetry.
 * autoDownload and autoInstallOnAppQuit are off; every step is a user click.
 *
 * Capability flag (Mac-readiness): on win32 (and later, a signed Mac build)
 * the module exposes the full check → download → install flow. On any other
 * platform — or when electron-updater isn't bundled — it reports
 * mode: 'check-only', where the renderer's Download button just opens the
 * releases page via the existing https-only openExternal. The renderer
 * branches on this flag, never on process.platform.
 */
const { app } = require('electron');

// GitHub coordinates for the updater and the releases page.
// >>> OWNER_TBD: fill in when the owner picks the account/repo (U7 open blocker) —
// >>> must match the `publish` block in package.json.
const REPO_OWNER = 'OWNER_TBD';
const REPO_NAME = 'sowing-season';
const RELEASES_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

// Calm, plain-language errors: being offline is the normal state, not a fault.
function friendly(err) {
  const m = String((err && err.message) || err);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|net::|internet/i.test(m)) {
    return "Couldn't reach the update server — if you're offline, that's all this is. Try again when you're connected.";
  }
  if (/404|not found/i.test(m)) return 'No published release was found to compare against.';
  if (/OWNER_TBD/.test(m)) return 'Updates aren’t configured yet in this build.';
  return m.split('\n')[0].slice(0, 200);
}

function registerUpdaterIpc(ipcMain, getWin) {
  let autoUpdater = null;
  if (process.platform === 'win32') {
    try {
      ({ autoUpdater } = require('electron-updater'));
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = false;
      autoUpdater.on('download-progress', (p) => {
        const win = getWin();
        if (win) win.webContents.send('update:progress', { percent: p.percent });
      });
    } catch { autoUpdater = null; } // not bundled (electron-packager build) → check-only
  }

  ipcMain.handle('update:caps', () => ({
    mode: autoUpdater ? 'full' : 'check-only',
    releasesUrl: RELEASES_URL,
    packaged: app.isPackaged,
  }));

  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) return { error: 'Update checks only work in the installed app.' };
    if (REPO_OWNER === 'OWNER_TBD') return { error: 'Updates aren’t configured yet in this build.' };
    if (!autoUpdater) return { error: 'Checking from inside the app isn’t supported on this platform yet.' };
    try {
      const r = await autoUpdater.checkForUpdates();
      const v = r && r.updateInfo && r.updateInfo.version;
      return v && v !== app.getVersion()
        ? {
            available: true,
            version: v,
            notes: typeof r.updateInfo.releaseNotes === 'string' ? r.updateInfo.releaseNotes : null,
          }
        : { available: false };
    } catch (err) { return { error: friendly(err) }; }
  });

  ipcMain.handle('update:download', async () => {
    if (!autoUpdater) return 'not supported on this platform';
    try { await autoUpdater.downloadUpdate(); return true; }
    catch (err) { return friendly(err); }
  });

  ipcMain.handle('update:install', () => {
    if (autoUpdater) autoUpdater.quitAndInstall();
    return true;
  });
}

module.exports = { registerUpdaterIpc, RELEASES_URL };
