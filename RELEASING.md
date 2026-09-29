# Releasing Sowing Season

The distribution design lives in `_cowork/update-distribution-proposal.md` (rev 2):
NSIS one-click installer via **electron-builder**, updates via **electron-updater**'s
GitHub provider in strictly manual mode — the app touches the network only when the
user presses **Settings → Check for updates**.

Since 1.1.0 every release is **built by GitHub Actions** (`.github/workflows/release.yml`)
from a pushed tag — Windows and Mac together, into a draft that is published only
when both builds are in it. The PC writes code, runs tests, bumps, tags and pushes.

## One-time setup (done — where things are)

The repo is **`sowingseasonapp/sowing-season`**, public, and that owner/repo pair
is wired into `package.json` (`build.publish`), `updater.js`, and
`tools/verify-release.js` / `tools/tag-release.js`. The remote URL carries the
username (`https://sowingseasonapp@github.com/…`) because the machine's
credential store also holds a different GitHub account.

The pre-push scrub was completed on 2026-08-27: history was rewritten so that
`data/seed.json`, local user paths and personal names never appear in any
commit. Nothing about that needs repeating — just keep `data/seed.json` ignored.

Windows code signing is **deferred** (decided 2026-09-28) until about two months
before real users: every tester's first run shows SmartScreen "Windows protected
your PC" → **More info → Run anyway**, and TESTERS.md walks them through it. The
setup is written up in `_cowork/azure-artifact-signing-setup.md`; when it lands
it is four `--config.win.azureSignOptions.*` flags on the Windows job's build
line — no code change.

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
2. Commit, then **`npm run release`**. It runs `tools/release-check.js` — semver,
   tag unused (locally and on origin), clean tree, local branch not behind
   origin/main (a README edit made on the website once put the release tag on a
   stale commit), CHANGELOG mentions the version, notes file present, all four
   suites green — and only then `tools/tag-release.js`, which tags `v{version}`
   and pushes `main` + the tag. The version is typed once, in package.json: the
   tag, the release title and the notes file lookup are all derived from it.
3. Watch **Actions → Release**. Five jobs: `check` → `draft` → `windows` + `mac`
   (in parallel) → `publish`. 15–25 minutes, most of it notarization. Green =
   the release is published, marked latest, and `verify-release.js` printed two
   `verified:` lines in the `publish` job (`latest.yml` and `latest-mac.yml`:
   each names this version and every file it lists resolves). The run isn't
   done until you've seen them. `npm run release:verify` re-runs the same check
   from the PC against whatever is live (`--windows-only` skips the Mac feed).
4. **If a job fails:** Actions → the run → **Re-run failed jobs**. The draft is
   untouched and invisible to `releases/latest` and to every installed app;
   uploads clobber. If the fix needs a code change, the tag is already on the
   wrong commit: `gh release delete v{version} --yes`,
   `git push origin :refs/tags/v{version}`, `git tag -d v{version}`, fix,
   commit, `npm run release` again. A version number is never published twice
   — if a *published* release is bad, ship the next patch version. If Apple is
   having a bad day and Windows has to go out alone, publish the draft by hand
   from the GitHub UI and say in the release body that Mac follows.
5. **Dry run:** Actions → Release → **Run workflow** (any branch). Builds both
   platforms, attaches the installers to the run as artifacts, creates no
   release and no tag. Use it after any change to the workflow, the build
   config, or Electron — and install the dry-run exe over the current version
   to **verify existing data survives**: the app must keep resolving
   `%APPDATA%\Sowing Season\`. That's why `productName` must stay exactly
   `Sowing Season` and `appId` (`com.sowingseason.app`) is permanent.

Two things the workflow depends on that are easy to break:

- **Artifact names are dashed on both platforms** (`win.artifactName`,
  `mac.artifactName`, `dmg.artifactName`). GitHub turns spaces in asset names
  into dots, which breaks the URL in `latest.yml` and blinds the in-app update
  check. `${version}` / `${arch}` / `${ext}` are electron-builder literals inside
  JSON strings.
- **The `build.publish` block stays**, even though CI builds with
  `--publish never` and uploads with `gh release upload`: it is what makes
  electron-builder write `latest.yml` / `latest-mac.yml` at all.

The `check` job runs `release-check.js --ci`: the git checks are replaced by
"the pushed tag equals `v{version}`", and the compute suite (`npm test`) is
skipped with a printed line, because it verifies the engine against
`data/seed.json` and the source workbook — the owner's real history, which
never reaches the repo. The other three suites run on the runner (Ubuntu, so
case-sensitive paths get checked once, cheaply). The compute suite's gate is the
local preflight in step 2.

## Electron cadence

`electron`, `electron-builder` and `electron-updater` are pinned to exact
versions so a fresh `npm ci` reproduces the shipped build. Standing rule:
**bump Electron to the current major twice a year** (the March and September
releases), never more than two majors behind — Electron majors leave support
about six months after they ship. `electron-builder` and `electron-updater` are
a matched pair: move them together, and only when there is something to gain.

- **September 2026 — 1.1.0: Electron 43.3.0 → 44.4.5.** Needs Node ≥ 22.12.0.
  Nothing in 44's breaking changes touched an API the app uses; 44 drops macOS
  12, which is where the Mac minimum (13 Ventura) comes from. electron-builder
  26.15.3 and electron-updater 6.8.9 deliberately not moved (27.x is alpha and
  reshapes the Windows signing config).
- **Next window: March 2027.**

## macOS

Shipped since 1.1.0, built, signed and notarized by the `mac` job on a GitHub
Mac runner: dmg + zip, x64 + arm64 (the zip is what electron-updater
downloads). Config is `build.mac` / `build.dmg` in package.json,
`build/entitlements.mac.plist`, and the 1024×1024 `build/icon.png`.
`npm run dist` on Windows still builds only the NSIS installer.

- **Secrets** (repo → Settings → Secrets and variables → Actions; the values
  live in the password manager and never in the repo): `MAC_CERT_P12`,
  `MAC_CERT_PASSWORD`, `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`,
  `APPLE_TEAM_ID`. The job fails on its first step with a plain message if the
  certificate or the API key is missing. How each was made:
  `_cowork/mac-ci-workflow.md` Part 1.
- **Minimum macOS 13 Ventura.**
- **userData path**, for support questions:
  `~/Library/Application Support/Sowing Season/`.
- **The updater on Mac is check-only until 1.1.1.** `updater.js` keeps its
  `win32` gate, so on a Mac the update button opens the releases page
  (`mode: 'check-only'`); the renderer never branches on `process.platform`.
  Widening the gate needs one Mac user's confirmation that the .dmg opens with
  no Gatekeeper dialog.
- **Nobody on the team has a Mac.** The Mac build is verified by the
  notarization ticket and the `xcrun stapler validate` lines in the CI log, and
  is labelled as untested-on-hardware in TESTERS.md and the README until a Mac
  user reports back. That is a decision, not an oversight.
- Runner images (`macos-latest`, `windows-latest`) are unpinned. If an image
  change ever breaks a build, pin to the last known-good one and note it here.

## Build paths

- **CI builds everything that ships** — `.github/workflows/release.yml`.
- `npm run dist` → `dist-installer/` — the **local smoke build**: the NSIS
  installer, unsigned, never published. It runs `release:check` first;
  `npm run dist:unchecked` is the escape hatch for local experiments.
  (The `@electron/packager` folder build in `dist/` was retired in 1.0.5.)
