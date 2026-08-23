// Exercises the one-time "Family Budget" → "Sowing Season" data-folder copy
// against scratch folders. Run: npm run test:migrate
// Self-contained: never touches %APPDATA%.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { migrateLegacyData, LEGACY_APP_NAME } = require('../legacy-data.js');

let pass = 0, fail = 0;
const failures = [];
const check = (name, cond, detail = '') => {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ': ' + detail : ''}`); }
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sowing-migrate-'));
const scratch = (name) => { const p = path.join(root, name); fs.mkdirSync(p, { recursive: true }); return p; };
const write = (dir, rel, text) => {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));

check('legacy name is the old product name', LEGACY_APP_NAME === 'Family Budget');

// 1. The real case: old folder full, new folder absent → everything copies,
//    old folder untouched, second launch is a no-op.
{
  const oldDir = scratch('case1/Family Budget');
  const newDir = path.join(root, 'case1/Sowing Season'); // does not exist yet
  const DATA = JSON.stringify({ version: 6, months: [{ id: '2026-08' }] });
  write(oldDir, 'budget-data.json', DATA);
  write(oldDir, 'bank-profiles.json', '{"version":1,"profiles":[]}');
  write(oldDir, 'backups/budget-2026-08-01-09-00.json', DATA);
  write(oldDir, 'backups/budget-2026-08-02-09-00.json', DATA);
  write(oldDir, 'backups/notes.txt', 'not a backup');
  write(oldDir, 'budget-data.json.corrupt', 'x'); // must NOT travel

  const before = fs.readdirSync(oldDir).sort().join(',');
  const res = migrateLegacyData(oldDir, newDir);
  check('case1 migrated', res.migrated === true, JSON.stringify(res));
  check('case1 data copied', exists(newDir, 'budget-data.json') && read(newDir, 'budget-data.json') === DATA);
  check('case1 profiles copied', read(newDir, 'bank-profiles.json') === '{"version":1,"profiles":[]}');
  check('case1 backups copied', exists(newDir, 'backups/budget-2026-08-01-09-00.json') && exists(newDir, 'backups/budget-2026-08-02-09-00.json'));
  check('case1 non-json backup skipped', !exists(newDir, 'backups/notes.txt'));
  check('case1 .corrupt skipped', !exists(newDir, 'budget-data.json.corrupt'));
  check('case1 files list', res.files.length === 4, JSON.stringify(res.files));
  check('case1 old folder untouched', fs.readdirSync(oldDir).sort().join(',') === before);
  check('case1 old data still readable', read(oldDir, 'budget-data.json') === DATA);

  // Second launch: the renamed app has since written new data — never clobber it.
  write(newDir, 'budget-data.json', '{"version":6,"months":[{"id":"2026-08"},{"id":"2026-09"}]}');
  const again = migrateLegacyData(oldDir, newDir);
  check('case1 second run is a no-op', again.migrated === false, JSON.stringify(again));
  check('case1 second run kept the newer data', read(newDir, 'budget-data.json').includes('2026-09'));
}

// 2. Fresh install: no old folder → nothing happens, and the new folder is
//    not even created (the wizard's first save does that).
{
  const oldDir = path.join(root, 'case2/Family Budget');
  const newDir = path.join(root, 'case2/Sowing Season');
  const res = migrateLegacyData(oldDir, newDir);
  check('case2 fresh install no-op', res.migrated === false, JSON.stringify(res));
  check('case2 new folder not created', !fs.existsSync(newDir));
}

// 3. Old folder exists but holds no data file (e.g. only Electron cache) → no-op.
{
  const oldDir = scratch('case3/Family Budget');
  write(oldDir, 'Preferences', '{}');
  const newDir = path.join(root, 'case3/Sowing Season');
  const res = migrateLegacyData(oldDir, newDir);
  check('case3 cache-only old folder no-op', res.migrated === false && !fs.existsSync(newDir));
}

// 4. New folder exists (Electron creates it for its own cache before the data
//    file is ever written) but has no data yet → still migrates.
{
  const oldDir = scratch('case4/Family Budget');
  const newDir = scratch('case4/Sowing Season');
  write(oldDir, 'budget-data.json', '{"version":6}');
  write(newDir, 'Preferences', '{}');
  const res = migrateLegacyData(oldDir, newDir);
  check('case4 migrates into a cache-only new folder', res.migrated === true && read(newDir, 'budget-data.json') === '{"version":6}');
  check('case4 no backups dir invented', !exists(newDir, 'backups'));
}

fs.rmSync(root, { recursive: true, force: true });

console.log(`test-migrate: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log('  FAIL ' + f);
process.exit(fail ? 1 : 0);
