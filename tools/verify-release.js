// Verify what the in-app updaters will read from the live GitHub release.
// Usage: node tools/verify-release.js                   both feeds, package.json version
//        node tools/verify-release.js --version 1.2.3   expect this version (CI passes the tag)
//        node tools/verify-release.js --windows-only    skip latest-mac.yml
//
// The updater's contract, per platform feed (latest.yml, latest-mac.yml):
// releases/latest/download/{feed} names this version, and every file it lists
// resolves under the v{version} tag. A release missing its feed is a blind
// updater — the 1.0.4 near-miss (a run that died after the exe upload).
//
// Dependency-free: plain https and two regexes, no YAML lib. No auth — it
// reads exactly what an installed app reads.
'use strict';
const https = require('https');
const path = require('path');

const OWNER = 'sowingseasonapp';
const REPO = 'sowing-season';

const args = process.argv.slice(2);
const vAt = args.indexOf('--version');
if (vAt !== -1 && !args[vAt + 1]) { console.error('--version needs a value, e.g. --version 1.2.3'); process.exit(1); }
const version = vAt !== -1
  ? args[vAt + 1].replace(/^v/, '')
  : require(path.join(__dirname, '..', 'package.json')).version;
// `npm run release:verify --windows-only` (no `--` separator) never reaches
// argv — npm keeps the flag for itself and exposes it as npm_config_windows_only.
const windowsOnly = args.includes('--windows-only') || process.env.npm_config_windows_only === 'true';
const feeds = windowsOnly ? ['latest.yml'] : ['latest.yml', 'latest-mac.yml'];

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

function fail(msg) { console.error('verify failed:', msg); process.exit(1); }

// releases/latest can lag a few seconds after a release is published, so the
// feed fetch retries before it is called a failure.
async function verify(feed) {
  const feedUrl = `https://github.com/${OWNER}/${REPO}/releases/latest/download/${feed}`;
  let problem = null;
  let assets = [];
  for (let attempt = 1; attempt <= 5; attempt++) {
    if (attempt > 1) await sleep(3000);
    const r = await fetchFollow('GET', feedUrl);
    if (r.status !== 200) { problem = `GET ${feedUrl} → ${r.status}`; continue; }
    const v = (r.body.match(/^version:\s*(\S+)/m) || [])[1];
    if (v !== version) { problem = `${feed} says version ${v || '(none)'}, expected ${version}`; continue; }
    assets = [...r.body.matchAll(/^\s*-\s*url:\s*(\S+)/gm)].map((m) => m[1]);
    if (!assets.length) {
      const p = (r.body.match(/^path:\s*(\S+)/m) || [])[1];
      if (p) assets = [p];
    }
    problem = assets.length ? null : `${feed} has no url/path line`;
    break;
  }
  if (problem) fail(problem);
  for (const asset of assets) {
    const assetUrl = `https://github.com/${OWNER}/${REPO}/releases/download/v${version}/${asset}`;
    const h = await fetchFollow('HEAD', assetUrl);
    if (h.status !== 200) fail(`HEAD ${assetUrl} → ${h.status}`);
  }
  const what = assets.length === 1 ? assets[0] : `${assets.length} assets`;
  console.log(`verified: ${feed} v${version} → ${what} (200)`);
}

(async () => {
  for (const feed of feeds) await verify(feed);
})().catch((e) => { console.error(e); process.exit(1); });
