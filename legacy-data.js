// One-time move-in from the app's pre-rename data folder.
//
// The app was called "Family Budget" until 2026-08-23. Electron keys the
// userData folder off productName, so renaming the app silently moved it from
// %APPDATA%\Family Budget to %APPDATA%\Sowing Season — and the renamed app
// would have booted to an empty first-run wizard while months of history sat
// orphaned in the old folder. This copies that history forward, once.
//
// Rules (the only dangerous lines in the rename, so they are spelled out):
//  - COPY, never move. The old folder is left untouched as a safety net.
//  - Runs at most once: guarded on the NEW folder having no budget-data.json,
//    so it can never clobber data the renamed app has already written.
//  - Never migrates into a scratch dir (BUDGET_DATA_DIR): the caller skips it.
//  - Pure Node: no Electron import, so tools/test-migrate.mjs can exercise it
//    against scratch folders before it ever runs on real data.
const fs = require('fs');
const path = require('path');

const DATA_FILE = 'budget-data.json';
const EXTRA_FILES = ['bank-profiles.json'];

/**
 * @param {string} oldDir  previous userData folder (…\Family Budget)
 * @param {string} newDir  current userData folder (…\Sowing Season)
 * @returns {{ migrated: boolean, reason?: string, files?: string[] }}
 */
function migrateLegacyData(oldDir, newDir) {
  const src = path.join(oldDir, DATA_FILE);
  const dst = path.join(newDir, DATA_FILE);
  if (fs.existsSync(dst)) return { migrated: false, reason: 'new folder already has data' };
  if (!fs.existsSync(src)) return { migrated: false, reason: 'no legacy data to migrate' };

  const copied = [];
  fs.mkdirSync(newDir, { recursive: true });
  // The data file last: if anything above it throws, the guard still sees an
  // empty new folder next launch and the whole copy retries cleanly.
  for (const extra of EXTRA_FILES) {
    const p = path.join(oldDir, extra);
    if (fs.existsSync(p)) { fs.copyFileSync(p, path.join(newDir, extra)); copied.push(extra); }
  }
  const oldBk = path.join(oldDir, 'backups'), newBk = path.join(newDir, 'backups');
  if (fs.existsSync(oldBk)) {
    fs.mkdirSync(newBk, { recursive: true });
    for (const f of fs.readdirSync(oldBk).filter((f) => f.endsWith('.json'))) {
      fs.copyFileSync(path.join(oldBk, f), path.join(newBk, f));
      copied.push(`backups/${f}`);
    }
  }
  fs.copyFileSync(src, dst);
  copied.push(DATA_FILE);
  return { migrated: true, files: copied };
}

module.exports = { migrateLegacyData, LEGACY_APP_NAME: 'Family Budget' };
