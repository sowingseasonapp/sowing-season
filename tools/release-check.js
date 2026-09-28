// Release preflight — run as `npm run release:check` (and by `npm run dist`).
//
// Four version-bearing places are edited by hand (package.json, the tag, the
// release title, the notes file), and any one of them drifting either breaks
// the in-app update check or ships a release with no notes. Every check
// prints a ✓/✗ line; the process exits 1 if any check fails.
'use strict';
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const version = require(path.join(ROOT, 'package.json')).version;
let failed = false;

function report(ok, label, detail) {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed = true;
}

function git(args) {
  return execSync(`git ${args}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

// 1. semver (no prereleases yet)
report(/^\d+\.\d+\.\d+$/.test(version), `package.json version ${version} is x.y.z`);

// 2. tag v{version} exists neither locally nor on origin
try {
  const local = git(`tag -l v${version}`);
  const remote = git(`ls-remote --tags origin v${version}`);
  report(!local && !remote, `tag v${version} is unused`,
    local ? 'exists locally' : remote ? 'exists on origin' : '');
} catch (err) {
  report(false, `tag v${version} is unused`, `couldn't check: ${err.message.split('\n')[0]}`);
}

// 3. clean working tree
try {
  const dirty = git('status --porcelain');
  report(!dirty, 'working tree is clean', dirty ? `${dirty.split('\n').length} uncommitted path(s)` : '');
} catch (err) {
  report(false, 'working tree is clean', err.message.split('\n')[0]);
}

// 4. CHANGELOG mentions this version near the top
const changelogHead = fs.existsSync(path.join(ROOT, 'CHANGELOG.md'))
  ? fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').split('\n').slice(0, 40).join('\n')
  : '';
report(changelogHead.includes(version), `CHANGELOG.md mentions ${version} in its first 40 lines`);

// 5. release notes file
const notes = path.join(ROOT, 'releases', `v${version}.md`);
report(fs.existsSync(notes) && fs.readFileSync(notes, 'utf8').trim().length > 0,
  `releases/v${version}.md exists and is non-empty`);

// 6. the four suites
for (const script of ['test', 'test:csv', 'test:garden', 'test:migrate']) {
  const r = spawnSync(`npm run ${script}`, { cwd: ROOT, shell: true, encoding: 'utf8' });
  report(r.status === 0, `npm run ${script} passes`, r.status === 0 ? '' : `exit ${r.status}`);
  if (r.status !== 0) process.stdout.write((r.stdout || '').slice(-2000) + (r.stderr || '').slice(-2000));
}

if (failed) { console.log('\nrelease check failed'); process.exit(1); }
console.log(`\nrelease check passed for v${version}`);
