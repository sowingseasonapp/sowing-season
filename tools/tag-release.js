// Tag the current commit v{version} and push main + the tag — the push is what
// starts .github/workflows/release.yml, which builds, publishes and verifies.
//
// No checks of its own: it is only ever run through `npm run release`, after
// tools/release-check.js has passed (tag unused, clean tree, not behind origin).
'use strict';
const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const version = require(path.join(ROOT, 'package.json')).version;
const tag = `v${version}`;

function git(args) {
  console.log(`> git ${args}`);
  execSync(`git ${args}`, { cwd: ROOT, stdio: 'inherit' });
}

git(`tag -a ${tag} -m "Sowing Season ${tag}"`);
git('push origin main');
git(`push origin ${tag}`);
console.log(`\ntagged and pushed ${tag} — watch the Release workflow:`);
console.log('https://github.com/sowingseasonapp/sowing-season/actions');
