# Sowing Season

A desktop envelope-budgeting app built from the "2026 Budget.xlsx" spreadsheet — tend your
money like a garden. All of the spreadsheet's logic is preserved: monthly funds with
carry-over → planned → spent → leftover, sinking funds for yearly charges (÷12, ÷6), tithe
as a % of planned income, a zero-based "left to allocate" check, and a Work category
excluded from totals. (The app was called **Family Budget** until 2026-08-23; see the
CHANGELOG for the rename and the data-folder move-in.)

## Running it

- **Packaged app**: `dist/Sowing Season-win32-x64/Sowing Season.exe` — double-click to run.
- **From source**: `npm start` in this folder.

Your data lives in `%APPDATA%\Sowing Season\budget-data.json` (auto-saved on every change,
with rolling backups in `%APPDATA%\Sowing Season\backups`, max 30, at most one per 10 min).
An install that was running as Family Budget finds its history copied forward on the first
launch after the rename (copy, never move — `%APPDATA%\Family Budget` is left untouched as
a safety net; see `legacy-data.js`).

A brand-new install starts empty and opens a **setup wizard**: an optional bank-file step
that suggests envelopes and paycheck numbers (the file never leaves the computer), then
paychecks, giving, and a curated starter set of envelopes. Finishing builds the current
month, imports the current month's bank rows, and leaves a quiet "Finish setting up"
checklist on the Budget page. Quitting mid-wizard saves nothing — it simply runs again
next launch. Existing installs (a data file already present) never see any of this.

## Views

- **Garden** — the home view. Every expense fund you tend is a plant in an inline-SVG
  garden: beds are your categories, plants are your funds, and each plant's state is a
  fact the Budget page already knows — **sown** (nothing spent yet), **growing** (within
  its envelope), **in bloom** (month done, or a pacing fund on pace late in the month),
  **thirsty** (off pace — a watering can appears), **wilted** (over — still green, a
  transfer waters it), **ready to harvest** (money free to move — it glows), **resting**
  (no budget, no activity). Work and excluded-from-insights funds grow no plants. Species
  follow the fund type (pacing → row crops, basic/fixed → shrubs, savings goals → fruit
  trees, build funds → evergreens) and are fixed per fund name. Stray unassigned
  transactions are **weeds** at the garden's edge; clicking them opens the unassigned
  flow ("Review N unassigned"). Hover a plant for its numbers (planned / spent / left, a
  bar, and the plain state — "$40 over"); click it to open that fund in Budget with the
  row highlighted. "Show labels" annotates every plant with its name and what's left.
  Beds that don't fit show a "+N" sign that opens Budget filtered to the category. Under
  the scene: a one-line plain status, up to three message cards (weeds → wilting → thirsty
  → harvest → paycheck check-in → setup → unsown), each with a button that names the tool
  it opens (Transfer…, Open Budget, Review N unassigned), and the garden's maturity. The
  Garden never edits anything itself — **the picture speaks garden, the words speak budget.**

  **The design rule:** behaviours drive the garden, outcomes decorate it. Plants respond
  only to what you control this month. AUM never wilts a plant — it sets the **season**
  (latest snapshot vs. ~90 days earlier: rising = growing light, flat = steady, falling =
  a lean autumn tint with a gentle note; no AUM data = steady) and lays **wall stones**
  (one per all-time-high snapshot; never removed). **Maturity** fixtures appear with
  months of history (3 path · 6 fence · 12 arbor · 18 pond · 24 bee hive) and the border
  tree grows with months closed; none of it ever regresses. Nothing dies, nothing nags:
  no points, badges, streaks-as-pressure or notifications. A one-slide intro shows on the
  first visit (`settings.gardenIntroSeen`; reopen via the ? by the title). Switching
  months in the sidebar shows that month's garden — past months as their final state,
  future months freshly sown. Engine: `src/garden.js` (pure, tested by
  `npm run test:garden`); drawing: `src/garden-scene.js` (pure, string out) — procedural
  **watercolor SVG**: layered translucent washes through three displacement filters plus a
  paper-grain filter, no image assets anywhere; season and time-of-day are tints; motion is
  CSS only (≤ 3 ambient elements, slow) and honours `prefers-reduced-motion`. The app draws
  the static scene into a canvas once per render (filters are expensive to keep live while
  anything animates — see CHANGELOG) with live SVG sprites only where something moves.
- **Budget** — the month, in layers. A hero figure (*Left to allocate*, with planned income
  and allocated beneath it) plus three stats: income, spent, net.

  Below that, **income groups and expense categories are collapsible**. Each card shows a
  progress line across its top and, on its header row, the category's carry-over / planned /
  spent / leftover lined up under one **sticky column header** per group (income reads
  *Received*, expenses *Spent*). Open/closed state is remembered per month — a month's first
  visit opens income plus anything flagged. *Expand all / Collapse all* sits in the toolbar,
  and **Find a fund** filters the page, auto-expanding matches.

  A fund row is its name, a type glyph, at most one status chip, then carry-over, planned,
  spent and leftover — carry-over and planned edit in place. The transaction count rides
  beside the name as a small chip; click it for that fund's transactions. Type glyphs are
  ↻ fixed recurring, ▦ pacing, ◎ savings goal, ▲ build up, ⊘ excluded from insights. Status
  is only shown when it asks something of you: `over`, `off pace`, `$X free`, `overridden`
  (on-pace is a quiet green dot).

  **The ⋯ at the end of a row opens the fund panel** — everything about that fund in one
  place: its numbers, its setup, its actions (transfer, move up/down, change category,
  remove) and its transactions this month. Fund types are five flat choices:
  **Basic** (everyday spending; leftover flags as available after the first transaction) ·
  **Pacing** (groceries-style, watched for pace; leftover frees up on the last day) ·
  **Fixed recurring** ($T every N months → planned = T÷N) ·
  **Savings goal** (a total by a target month; planned fills the gap evenly and the goal
  rolls to the same month next year once it passes) ·
  **Build up** (a fixed amount monthly, optionally *stopping at* an amount — contributions
  cap there and resume if the balance drops below). Any fund can be excluded from insights.
  Income funds get their own two types — **Standard Income** (paychecks: checks × per-check
  amount plus the titheable-per-check figure the tithe is based on) and **Extra Income**
  (gifts, reimbursements) — each with *Exempt from tithe* and *Carry leftover into next
  month* (off by default, so paycheck funds reset to $0 like the spreadsheet).

  Auto-calculated planned amounts can be overridden for a single month (an `overridden`
  chip appears; new months reset to the setup). Setup, type and category changes apply from
  the selected month forward — history never changes.

  One **Review** badge collects every insight: *needs attention* (over budget or off pace),
  *available to move* (transactions in, money left, none expected), and *unassigned
  transactions* — each with an inline ⇄ to move money.

  Categories are added with **+ Add category** and removed with the ✕ on their header;
  removal needs the category or fund balanced first and never touches past months.
- **Exclude transfers from reporting** (Settings) — fund-to-fund transfers stay visible
  inside each fund, but stop counting toward actual income/spending in the summary,
  Year Overview and month recap. Income funds named "Transfer …" count wholly as transfers.
- **End-of-month workflow** — "🌱 Sow {Month}" opens *The {Month} harvest*: a recap of the
  closing month (income/spent/net, wins, pacing results, matured savings goals, a wall
  stone when AUM hit a new high that month, a quiet row of baskets for consecutive sown
  months, category breakdown), lists outstanding insights with inline transfer links, then
  creates the month — or skip it all with one click.
- **Transactions** — add/edit/delete entries for the month. Expenses negative, income positive.
- **⇄ Transfer** — move money between any two funds in the month (toolbar button on the
  Budget and Transactions pages, or the ⇄ in a fund's panel or the Review strip to prefill "From"). A transfer is
  stored as a matched pair of transactions ("Transfer to X" / "Transfer from Y"), so the
  audit trail is kept and income/expense totals are unaffected.
- **Import CSV** — pick any US bank's CSV export. The importer works the format out itself
  (delimiter, header row, column roles, date order, sign convention), proves amounts against
  a running-balance column whenever one exists, and **refuses or asks a plain-language
  question instead of guessing** — day-first dates, comma decimals, semicolon files and
  multi-table investment exports are refused by name. A format you confirm once is
  remembered and imports silently after that. Pending rows are skipped (Status columns, or
  Apple Card's blank Clearing Date). Rows auto-match to funds from your history (memo
  prefixes like "note - Withdrawal to X" are handled, and second-description columns like
  Comments/Extended Details are searched too and kept as the transaction's description).
  Duplicate detection is scored: confident matches (same account + vendor + amount within
  −3…+7 days, or a matching bank transaction id) are deselected as **duplicate**, while
  near matches — a tip or a gas-pump hold changing the amount — show as **possible
  duplicate**, still selected for you to review. Card payments — including the
  checking-side "CAPITAL ONE … PMT" withdrawals — are flagged and deselected. Nothing
  saves until you press Import.
- **Year Overview** — income-vs-spending bars by month, a ranked "where the money went"
  chart, the monthly actuals table, and per-fund history with a planned-vs-spent chart.
- **AUM** — assets under management (SeedTime's take on net worth): everything you manage,
  minus everything you owe. Two hand-entered lists — assets and debts, no account syncing —
  under one headline number, with every value showing when it was last checked (a `stale`
  chip appears after 90 days). Every edit automatically records **today's snapshot**, so
  the AUM-over-time chart and history table build themselves; a collapsed change log keeps
  the last 200 item-level edits. Month-independent — the month picker doesn't apply here.
  Stored in the data file's `aum` block (data version 6). A 5-slide walkthrough opens on
  the first visit (and any time via the `?` button next to the title), ending with a link
  to the SeedTime podcast episode the concept comes from (opens in the system browser).
- **Settings** — tithe %, fund rename (updates all months + transactions), new categories,
  data export.

**🌱 Sow {Month}** rolls every expense fund's leftover into the new month's carry-over,
resets income carry-overs to zero, and re-applies planned rules — exactly like copying the
spreadsheet tab, minus the manual work.

## History

See [CHANGELOG.md](CHANGELOG.md) for what changed in each round of work, why, and the
decisions and gotchas behind them (data-model migrations, the tithe rules, the Windows
packaging trap, the BOM crash). Start there before changing behaviour.

## Development

- `npm start` — run the app.
- `npm run pack` — rebuild the packaged exe into `dist/` (via `tools/package-app.js`, which
  drives the packager's JS API: CLI `--ignore` regexes silently match nothing on Windows,
  which once bundled each previous build inside the next one).
- `npm test` — the verification suite: every month re-checked against the original
  workbook, plus the migration, tithe, savings, insight and CSV cases.
- `npm run test:garden` — the garden engine: every plant state, seasons, maturity, the
  scene cap and the message ladder against fixture months (self-contained).
- `npm run test:migrate` — the Family Budget → Sowing Season data-folder copy against
  scratch folders (never touches `%APPDATA%`).
- `npm run dev` — the browser dev harness on :5173 (in-memory, no persistence).
- `tools/extract-workbook.js` — the one-time spreadsheet → `data/seed.json` importer
  (historical; the app no longer reads the seed).
- `build/icon.svg` — the watercolor sprout mark. `tools/icon-export.html?save=1` (on the
  dev server) rasterises it to `tools/icons/icon-*.png`; `node tools/build-ico.js` bundles
  them into `build/icon.ico` (the only raster in the product, derived from the SVG).
- `tools/scene-preview.html` (dev server) — the garden scene alone, full-width, from
  `data/seed.json`, with month / season / time-of-day / labels switches for judging the art.
- `node_modules.binelectron toolscapture-help.js` — recaptures the AUM walkthrough
  screenshots from fabricated demo data (never real data) at 1:1.

First run (no `%APPDATA%\Sowing Season\budget-data.json` yet) starts empty and runs the
onboarding wizard. Deleting that file resets the app to the wizard. Wizard testing:
`npm run dev` then `http://localhost:5173/?blank=1` (add `&csv=/tools/fixtures/…` to feed
files to the Choose-file button), or point `BUDGET_DATA_DIR` at an empty folder.

### Repository note

`data/seed.json` is the imported spreadsheet snapshot — **real transaction history,
vendors and income figures**. Since 2026-08-22 it is git-ignored, untracked and excluded
from the packaged app; it exists only as the owner's local file and must never reach a repo
or a build.
