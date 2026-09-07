// Publish a GitHub release for the current package.json version.
// Usage: node tools/publish-release.js
//
// Expects dist-installer/release-v{version}/ to hold the dash-named assets
// (exe, blockmap, latest.yml — see RELEASING.md; GitHub mangles spaces to
// dots, which breaks latest.yml's url and blinds the in-app updater).
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

for (const a of assets) {
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

const notesFile = path.join(stage, 'RELEASE_NOTES.md');
const notes = fs.existsSync(notesFile) ? fs.readFileSync(notesFile, 'utf8') : `Sowing Season v${version}`;

(async () => {
  const token = getToken();
  const rel = await api(token, 'POST', 'api.github.com', `/repos/${OWNER}/${REPO}/releases`, {
    tag_name: `v${version}`, name: `Sowing Season v${version}`, body: notes, draft: false, prerelease: false,
  });
  if (rel.status !== 201) {
    console.error('release create failed:', rel.status, rel.body.slice(0, 400));
    process.exit(1);
  }
  const release = JSON.parse(rel.body);
  console.log('release created:', release.html_url);
  for (const name of assets) {
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
  console.log('done — verify with: https://github.com/' + OWNER + '/' + REPO + '/releases/latest');
})().catch((e) => { console.error(e); process.exit(1); });
