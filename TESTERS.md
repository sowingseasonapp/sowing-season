# Sowing Season — notes for testers

Thanks for trying it! Sowing Season is a family budgeting app built around one
idea: split your money into named funds (groceries, rent, fun money…) so every
dollar has a job. It runs entirely on your computer — your numbers never leave
it, and the app doesn't touch the internet except when you press the
"Check for updates" button yourself. First launch walks you through a
five-minute setup; from then on, the Garden page is a living picture of your
month, and the Budget page is where the numbers live.

## Installing (the scary-looking Windows warning)

The app isn't code-signed yet (signing is planned before the public launch), so the
first time you run the installer, Windows shows a blue box that says
**"Windows protected your PC"**. That's SmartScreen not recognizing a new
program, not a virus verdict.

To continue: click the small **More info** link in that blue box, then the
**Run anyway** button that appears. You only have to do this once.

## Installing on a Mac

Download `Sowing-Season-{version}-arm64.dmg` for Apple Silicon (any M-series
Mac) or `Sowing-Season-{version}-x64.dmg` for an Intel Mac. Open it, drag
Sowing Season to Applications, then open it from Applications. It needs
macOS 13 Ventura or newer.

The build is signed and notarized by Apple, so you should **not** see an
"unidentified developer" warning. **If you do see one, that is exactly the
report we need** — send it in along with your macOS version. (If macOS still
refuses to open the app, right-click it and choose **Open**.)

One plain fact: this is the first Mac build, and nobody on the team has a Mac
to test it on. The first Mac tester is the test.

## Updating

**Settings → Check for updates** looks for a newer version — only when you
press it. On Windows it downloads and installs the update in place. On a Mac it
currently opens the downloads page instead, where you grab the new `.dmg`;
updating in place arrives in a later version.

## Where your data lives

Everything is stored in one file on your computer — on Windows in your profile
(`%APPDATA%\Sowing Season`), on a Mac in
`~/Library/Application Support/Sowing Season/`. Backups are automatic — the app keeps a rolling set
as you work, and Settings → Restore… can take you back to any of them. You can
also export a copy any time from Settings.

## Found something odd? Send it in

Use the **Send feedback** link at the bottom-left of the app — it opens an email
draft addressed to the developer. Please keep the "App version" line the draft
ends with; it tells us exactly which build you were on. The perfect bug report
is: what you did, what you expected, what happened instead.

## Things the app refuses on purpose

- **Some bank files are declined by name.** European-style CSV exports
  (day-first dates, comma decimals, semicolon separators) and multi-table
  investment exports aren't supported — the importer says so plainly rather
  than guessing and importing wrong numbers.
- **The importer asks instead of guessing.** If a file is ambiguous (is 03/04
  March 4th or April 3rd?), it stops and asks you. If you can't answer, skipping
  the import is always fine.
- Nothing is ever imported or saved until you click the button that says so.

## The one real warning

**Don't run two copies of the app at once.** The app now guards against this
(a second launch just brings the first window forward), but if you ever find a
way around that guard, close one — two copies editing the same file can lose
edits.
