# Releasing Sowing Season

The distribution design lives in `_cowork/update-distribution-proposal.md` (rev 2):
NSIS one-click installer via **electron-builder**, updates via **electron-updater**'s
GitHub provider in strictly manual mode — the app touches the network only when the
user presses **Settings → Check for updates**.

## One-time setup (still open — needs the owner)

1. **Pick the GitHub account/repo** and public vs. private+public-releases
   (public recommended — free macOS CI later). Then replace `OWNER_TBD` in
   **both** `package.json` (`build.publish`) and `updater.js`.
2. **Before the first push**: the pre-push scrub. As of 2026-08-26 the local
   history still contains `data/seed.json` (real financial history, initial
   commit) and `C:/Users/<name>/` paths in three tools files. The history must
   be rewritten (`git filter-repo`) or the repo pushed with fresh history —
   never push `main` as-is.
3. Code signing is deferred (accepted): every tester's first run shows
   SmartScreen "Windows protected your PC" → **More info → Run anyway**.
   TESTERS.md walks them through it. Azure Artifact Signing (~$10/mo) slots in
   later via `win.azureSignOptions` — config only.

## Every release

1. **Bump `version`** in package.json (semver — bump per build handed to anyone,
   even testers: 1.0.1, 1.0.2, …). Data-format rule: a release that changes the
   stored data shape must bump the data version and ship a migration
   (compute.js pattern, currently v6) — never ship a version that writes a
   format an older app can't read without that bump.
2. Run the suites: `npm test`, `npm run test:csv`, `npm run test:garden`,
   `npm run test:migrate`.
3. `npm run dist` → installer in `dist-installer/`. Smoke-test it:
   - Install on a machine (or rehearse with `BUDGET_DATA_DIR` first), and
   - **verify existing data survives** — the app must keep resolving
     `%APPDATA%\Sowing Season\`. That's why `productName` must stay exactly
     `Sowing Season` and `appId` (`com.sowingseason.app`) is permanent.
4. Publish: `npm run release` with a `GH_TOKEN` env var, or upload the artifacts
   by hand. The release **must** include the `.exe`, the `.blockmap`, and
   `latest.yml` — a release without `latest.yml` is invisible to the in-app check.
5. Tag `v{version}`; paste user-facing notes into the release body (they surface
   in-app as release notes).

## macOS (planned, not shipped)

Auto-update on macOS requires a signed + notarized build (Apple Developer,
~$99/yr) — there is no unsigned workaround. The updater is already isolated in
`updater.js` behind a capability flag: on an unsupported platform the app's
update button opens the releases page instead (`mode: 'check-only'`), and the
renderer never branches on `process.platform`. When Mac ships, add a `mac`
block (zip target required alongside dmg) and the same UI lights up.
Mac userData path for support questions: `~/Library/Application Support/Sowing Season/`.

## Build paths

- `npm run dist` → `dist-installer/` — the NSIS installer (what testers get).
- `npm run pack` → `dist/Sowing Season-win32-x64/` — the unpackaged folder build
  the owner's desktop shortcut points at. Both stay until the installer is proven.
