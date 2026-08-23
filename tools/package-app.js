/*
 * Builds the Windows app into dist/.
 *
 * Uses the packager's JS API rather than CLI --ignore regexes: on Windows the
 * paths handed to the ignore matcher use backslashes, so a pattern like
 * "^/dist" silently matches nothing — which quietly bundled each previous
 * build inside the next one (a 1.9 GB app.asar before this was caught).
 */
const path = require('path');
const fs = require('fs');
const { packager } = require('@electron/packager');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist');
const APP_NAME = 'Sowing Season';

// Only these top-level entries belong in the app bundle. NOTE: 'data' (the old
// seed.json) must never come back — it holds real financial history; new
// installs start blank and run the onboarding wizard instead.
const KEEP = new Set(['main.js', 'preload.js', 'legacy-data.js', 'package.json', 'src', 'build']);
// Dev-only files that live inside kept folders.
const EXCLUDE_FILES = new Set([path.join('src', 'dev.html')]);

function ignore(filePath) {
  // filePath is relative to ROOT and starts with a separator ('' for the root).
  if (!filePath) return false;
  const rel = filePath.replace(/^[\\/]/, '');
  if (!rel) return false;
  const parts = rel.split(/[\\/]/);
  if (!KEEP.has(parts[0])) return true;
  if (EXCLUDE_FILES.has(path.join(...parts))) return true;
  return false;
}

(async () => {
  const target = path.join(OUT, `${APP_NAME}-win32-x64`);
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
    console.log('removed previous build');
  }
  const [built] = await packager({
    dir: ROOT,
    name: APP_NAME,
    platform: 'win32',
    arch: 'x64',
    out: OUT,
    overwrite: true,
    icon: path.join(ROOT, 'build', 'icon.ico'),
    prune: true,
    ignore,
  });
  const asar = path.join(built, 'resources', 'app.asar');
  const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';
  console.log(`built: ${built}`);
  console.log(`app.asar: ${mb(fs.statSync(asar).size)}`);
  const total = (function size(p) {
    const s = fs.statSync(p);
    if (!s.isDirectory()) return s.size;
    return fs.readdirSync(p).reduce((a, f) => a + size(path.join(p, f)), 0);
  })(built);
  console.log(`total: ${mb(total)}`);
})().catch((err) => { console.error(err); process.exit(1); });
