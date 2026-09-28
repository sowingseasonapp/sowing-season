# Releasing Sowing Season

The distribution design lives in `_cowork/update-distribution-proposal.md` (rev 2):
NSIS one-click installer via **electron-builder**, updates via **electron-updater**'s
GitHub provider in strictly manual mode — the app touches the network only when the
user presses **Settings → Check for updates**.

## One-time setup (done — where things are)

The repo is **`sowingseasonapp/sowing-season`**, public, and that owner/repo pair
is wired into `package.json` (`build.publish`), `updater.js`, and the two tools
scripts. The remote URL carries the username (`https://sowingseasonapp@github.com/…`)
because the machine's credential store also holds a different GitHub account.

The pre-push scrub was completed on 2026-08-27: history was rewritten so that
`data/seed.json`, local user paths and personal names never appear in any
commit. Nothing about that needs repeating — just keep `data/seed.json` ignored.

Windows code signing is deferred to 1.1.0: every tester's first run shows
SmartScreen "Windows protected your PC" → **More info → Run anyway**, and
TESTERS.md walks them through it. Azure Artifact Signing slots in later via
`win.azureSignOptions` — config only, no code change.

## Every release

1. **Bump `version`** in package.json (semver — bump per build handed to anyone,
   even testers: 1.0.1, 1.0.2, …), add the CHANGELOG entry, and write the
   user-facing notes to `releases/v{version}.md` (they become the release body
   and surface in-app as release notes). Data-format rule: a release that
   changes the stored data shape must bump the data version and ship a
   migration (compute.js pattern, currently v7) — never ship a version that
   writes a format an older app can't read without that bump. When a
   migration runs, the app copies the pre-migration file to
   `backups/keep-before-v{N}-{stamp}.json`, which is never pruned — that's the
   way back if a release ever has to be pulled.
2. Commit, then `npm run release:check` — semver, tag unused (locally and on
   origin), clean tree, local branch not behind origin/main (a README edit made
   on the website once put the release tag on a stale commit), CHANGELOG mentions
   the version, notes file present, all four suites green. `npm run dist` runs it first anyway;
   `npm run dist:unchecked` is the escape hatch for local experiments.
3. `npm run dist` → installer in `dist-installer/`. Smoke-test it:
   - Install on a machine (or rehearse with `BUDGET_DATA_DIR` first), and
   - **verify existing data survives** — the app must keep resolving
     `%APPDATA%\Sowing Season\`. That's why `productName` must stay exactly
     `Sowing Season` and `appId` (`com.sowingseason.app`) is permanent.
4. Stage the dash-named copies into `dist-installer/release-v{version}/`
   (`Sowing-Season-Setup-{version}.exe`, its `.blockmap`, `latest.yml`) — GitHub
   turns spaces into dots, which breaks the URL in `latest.yml` and blinds the
   in-app update check.
5. Publish: `node tools/publish-release.js`. It creates the release and tag
   `v{version}` with `releases/v{version}.md` as the body (refuses if the file
   is missing), uploads the three assets (resumable — re-run it if it dies
   mid-upload), then **verifies** what the updater reads: `latest.yml` via
   `releases/latest` names this version and its asset URL resolves. The run
   isn't done until you see `verified: latest.yml v{version} → … (200)`.
   The README's Download link points at `releases/latest` and needs no edit.
   `node tools/publish-release.js --verify-only` re-runs just that check against
   whatever is live (it must fail with a version mismatch before you publish).

## Electron cadence

`electron`, `electron-builder` and `electron-updater` are pinned to exact
versions so a fresh `npm ci` reproduces the shipped build. Standing rule:
**bump Electron to the current major twice a year** (the March and September
releases), never more than two majors behind — Electron majors leave support
about six months after they ship. Bump `electron-builder` and `electron-updater`
together with it; they're a matched pair. The first scheduled bump is 1.1.0,
once CI is proving both platforms.

## macOS (prepared, not shipped)

Auto-update on macOS requires a signed + notarized build (Apple Developer,
~$99/yr) — there is no unsigned workaround. The updater is already isolated in
`updater.js` behind a capability flag: on an unsupported platform the app's
update button opens the releases page instead (`mode: 'check-only'`), and the
renderer never branches on `process.platform`.

As of 1.0.5 the Mac build **configuration** is committed and inert on Windows:
`build.mac` / `build.dmg` in package.json (dmg + zip, x64 + arm64 — the zip is
what electron-updater downloads), `build/entitlements.mac.plist`, and the
1024×1024 `build/icon.png`. `npm run dist` on Windows still builds only the
NSIS installer (electron-builder defaults to the host platform). The GitHub
Actions workflow that builds, signs and notarizes on a Mac runner
(`_cowork/mac-ci-workflow.md`) lands in 1.1.0, not before — publishing a
release would otherwise trigger a Mac build of a version that isn't ready.
Mac userData path for support questions: `~/Library/Application Support/Sowing Season/`.

## Build paths

- `npm run dist` → `dist-installer/` — the NSIS installer, the only build path
  (the `@electron/packager` folder build in `dist/` was retired in 1.0.5).
