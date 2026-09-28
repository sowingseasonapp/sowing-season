// Publish a GitHub release for the current package.json version.
// Usage: node tools/publish-release.js            publish + verify
//        node tools/publish-release.js --verify-only   re-run only the verify step
//
// Expects dist-installer/release-v{version}/ to hold the dash-named assets
// (exe, blockmap, latest.yml — see RELEASING.md; GitHub mangles spaces to
// dots, which breaks latest.yml's url and blinds the in-app updater), and
// releases/v{version}.md to hold the user-facing notes (the release body).
//
// After the upload it verifies what the in-app updater will actually read:
// latest.yml via releases/latest must name this version, and the asset it
// points at must resolve — the 1.0.4 near-miss (a run that died after the exe
// upload left a release with no latest.yml, i.e. a blind updater).
//
// Auth: the same Windows Credential Manager entry git push uses
// (username sowingseasonapp), fetched via `git credential fill` so the token
// never appears on screen or in any file. GH_TOKEN overrides if set.
'use strict';
const { execSync } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');

const OWNER = 'sowingseasonapp';
const REPO = 'sowing-season';
const version = require(path.join(__dirname, '..', 'package.json')).version;
const stage = path.join(__dirname, '..', 'dist-installer', `release-v${version}`);
const assets = [
  `Sowing-Season-Setup-${version}.exe`,
  `Sowing-Season-Setup-${version}.exe.blockmap`,
  'latest.yml',
];

const verifyOnly = process.argv.includes('--verify-only');

for (const a of verifyOnly ? [] : assets) {
  if (!fs.existsSync(path.join(stage, a))) {
    console.error(`missing asset: ${path.join(stage, a)}`);
    process.exit(1);
  }
}

function getToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  const out = execSync('git credential fill', {
    input: `protocol=https\nhost=github.com\nusername=${OWNER}\n`,
  }).toString();
  const m = out.match(/^password=(.+)$/m);
  if (!m) { console.error('no GitHub credential found'); process.exit(1); }
  return m[1];
}

function api(token, method, host, reqPath, body, ctype) {
  return new Promise((resolve, reject) => {
    const data = body ? (Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))) : null;
    const req = https.request({
      hostname: host, path: reqPath, method,
      headers: {
        Authorization: `token ${token}`,
        'User-Agent': `${REPO}-release`,
        Accept: 'application/vnd.github+json',
        ...(data ? { 'Content-Type': ctype || 'application/json', 'Content-Length': data.length } : {}),
      },
    }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Release notes live in the repo, one file per version. A release with no
// notes is a mistake, not a default — refuse rather than publish a bare title.
const notesFile = path.join(__dirname, '..', 'releases', `v${version}.md`);
if (!fs.existsSync(notesFile) || !fs.readFileSync(notesFile, 'utf8').trim()) {
  console.error(`missing release notes: ${notesFile}
Write the user-facing notes for v${version} there first (see RELEASING.md).`);
  process.exit(1);
}
const notes = fs.readFileSync(notesFile, 'utf8');

// Plain GET/HEAD that follows redirects (GitHub 302s releases/latest and
// every asset to a CDN URL; Node's https doesn't follow on its own).
function fetchFollow(method, url, hops = 4) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method,
      headers: { 'User-Agent': `${REPO}-release` },
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops > 0) {
        res.resume();
        resolve(fetchFollow(method, new URL(res.headers.location, url).href, hops - 1));
        return;
      }
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject);
    req.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The updater's contract: releases/latest/download/latest.yml names this
// version and its url resolves. releases/latest can lag a few seconds after
// the release is created, so the fetch retries before it is called a failure.
async function verify() {
  const latestUrl = `https://github.com/${OWNER}/${REPO}/releases/latest/download/latest.yml`;
  let problem = null;
  let asset = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    if (attempt > 1) await sleep(3000);
    const r = await fetchFollow('GET', latestUrl);
    if (r.status !== 200) { problem = `GET ${latestUrl} → ${r.status}`; continue; }
    const v = (r.body.match(/^version:\s*(\S+)/m) || [])[1];
    if (v !== version) { problem = `latest.yml says version ${v || '(none)'}, package.json says ${version}`; continue; }
    asset = (r.body.match(/^\s*-\s*url:\s*(\S+)/m) || r.body.match(/^path:\s*(\S+)/m) || [])[1];
    if (!asset) { problem = 'latest.yml has no url/path line'; break; }
    problem = null;
    break;
  }
  if (problem) { console.error('verify failed:', problem); process.exit(1); }
  const assetUrl = `https://github.com/${OWNER}/${REPO}/releases/download/v${version}/${asset}`;
  const h = await fetchFollow('HEAD', assetUrl);
  if (h.status !== 200) { console.error(`verify failed: HEAD ${assetUrl} → ${h.status}`); process.exit(1); }
  console.log(`verified: latest.yml v${version} → ${asset} (200)`);
}

(async () => {
  if (verifyOnly) { await verify(); return; }
  const token = getToken();
  // Resumable: if the release already exists (a previous run died mid-upload —
  // v1.0.4 lost latest.yml that way, which blinds the in-app updater), fetch it
  // and upload only the assets it's missing.
  let release;
  const rel = await api(token, 'POST', 'api.github.com', `/repos/${OWNER}/${REPO}/releases`, {
    tag_name: `v${version}`, name: `Sowing Season v${version}`, body: notes, draft: false, prerelease: false,
  });
  if (rel.status === 201) {
    release = JSON.parse(rel.body);
    console.log('release created:', release.html_url);
  } else if (rel.status === 422) {
    const got = await api(token, 'GET', 'api.github.com', `/repos/${OWNER}/${REPO}/releases/tags/v${version}`);
    if (got.status !== 200) {
      console.error('release exists but fetch failed:', got.status, got.body.slice(0, 400));
      process.exit(1);
    }
    release = JSON.parse(got.body);
    console.log('release already exists, resuming:', release.html_url);
  } else {
    console.error('release create failed:', rel.status, rel.body.slice(0, 400));
    process.exit(1);
  }
  const have = new Set((release.assets || []).map((a) => a.name));
  for (const name of assets) {
    if (have.has(name)) { console.log('already uploaded:', name); continue; }
    const buf = fs.readFileSync(path.join(stage, name));
    const up = await api(token, 'POST', 'uploads.github.com',
      `/repos/${OWNER}/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
      buf, 'application/octet-stream');
    if (up.status !== 201) {
      console.error('upload failed:', name, up.status, up.body.slice(0, 300));
      process.exit(1);
    }
    console.log('uploaded:', name, `(${JSON.parse(up.body).size} bytes)`);
  }
  await verify();
  console.log('done: https://github.com/' + OWNER + '/' + REPO + '/releases/latest');
})().catch((e) => { console.error(e); process.exit(1); });
