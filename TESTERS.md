# Sowing Season — notes for testers

Thanks for trying it! Sowing Season is a family budgeting app built around one
idea: split your money into named funds (groceries, rent, fun money…) so every
dollar has a job. It runs entirely on your computer — your numbers never leave
it, and the app doesn't touch the internet except when you press the
"Check for updates" button yourself. First launch walks you through a
five-minute setup; from then on, the Garden page is a living picture of your
month, and the Budget page is where the numbers live.

## Installing (the scary-looking Windows warning)

The app isn't code-signed yet (that's a paid certificate — coming later), so the
first time you run the installer, Windows shows a blue box that says
**"Windows protected your PC"**. That's SmartScreen not recognizing a new
program, not a virus verdict.

To continue: click the small **More info** link in that blue box, then the
**Run anyway** button that appears. You only have to do this once.

## Where your data lives

Everything is stored in one file on your computer, in your Windows profile
(`%APPDATA%\Sowing Season`). Backups are automatic — the app keeps a rolling set
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
