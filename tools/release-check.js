// Release preflight — run as `npm run release:check` (and by `npm run dist`).
//
// Four version-bearing places are edited by hand (package.json, the tag, the
// release title, the notes file), and any one of them drifting either breaks
// the in-app update check or ships a release with no notes. Every check
// prints a ✓/✗ line; the process exits 1 if any check fails.
//
// `--ci` (the Release workflow's check job) swaps the git checks for a
// tag-equals-version assertion; everything else runs unchanged.
'use strict';
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const version = require(path.join(ROOT, 'package.json')).version;
const CI = process.argv.includes('--ci');
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

if (CI) {
  // In CI the tag exists by definition and the tree is a fresh checkout, so the
  // git checks (2, 3, 3b) are skipped. What can still drift is a tag pushed by
  // hand that doesn't match package.json. GITHUB_REF_NAME is always set in
  // Actions (it's the branch name on a dry run), so gate on the ref type.
  if (process.env.GITHUB_REF_TYPE === 'tag') {
    const ref = process.env.GITHUB_REF_NAME || '';
    report(ref === `v${version}`, `tag matches package.json version`,
      ref === `v${version}` ? ref : `tag is ${ref || '(none)'}, package.json says v${version}`);
  }
} else {
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

// 3b. local main is not behind origin. A commit made on the website (a README
// edit) that this clone never pulled makes the push fail AND lets GitHub put
// the release tag on the stale commit — it did on v1.0.5.
try {
  git('fetch --quiet origin');
  const behind = git('rev-list --count HEAD..origin/main');
  report(behind === '0', 'local branch is up to date with origin/main',
    behind === '0' ? '' : `behind by ${behind} commit(s) — run: git pull --rebase origin main`);
} catch (err) {
  report(false, 'local branch is up to date with origin/main', `couldn't check: ${err.message.split('\n')[0]}`);
}
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
// The compute suite checks the engine against the owner's real history
// (data/seed.json, git-ignored, and the source workbook) — files that must
// never reach the repo, so a CI checkout cannot run it. It is skipped there, out
// loud; the local preflight in `npm run release` runs it before the tag exists.
const hasSeed = fs.existsSync(path.join(ROOT, 'data', 'seed.json'));
for (const script of ['test', 'test:csv', 'test:garden', 'test:migrate']) {
  if (CI && script === 'test' && !hasSeed) {
    console.log('– npm run test skipped — data/seed.json is not in the repo (runs in the local preflight)');
    continue;
  }
  const r = spawnSync(`npm run ${script}`, { cwd: ROOT, shell: true, encoding: 'utf8' });
  report(r.status === 0, `npm run ${script} passes`, r.status === 0 ? '' : `exit ${r.status}`);
  if (r.status !== 0) process.stdout.write((r.stdout || '').slice(-2000) + (r.stderr || '').slice(-2000));
}

if (failed) { console.log('\nrelease check failed'); process.exit(1); }
console.log(`\nrelease check passed for v${version}`);
