# Family Budget

A desktop envelope-budgeting app built from the "2026 Budget.xlsx" spreadsheet. All of the
spreadsheet's logic is preserved: monthly funds with carry-over → planned → spent → leftover,
sinking funds for yearly charges (÷12, ÷6), tithe as a % of planned income, a zero-based
"left to allocate" check, and a Work category excluded from totals.

## Running it

- **Packaged app**: `dist/Family Budget-win32-x64/Family Budget.exe` — double-click to run.
- **From source**: `npm start` in this folder.

Your data lives in `%APPDATA%\Family Budget\budget-data.json` (auto-saved on every change,
with rolling backups in `%APPDATA%\Family Budget\backups`, max 30, at most one per 10 min).
The app ships with all 2026 spreadsheet history (Dec 2025 – Aug 2026) already imported.

## Views

- **Budget** — the monthly summary: income, every category and fund, editable carry-over /
  planned / yearly-cost cells. Funds with an `auto:` chip recalculate themselves (checks ×
  amount, tithe %, yearly ÷ N); typing a value directly removes the auto rule.
  Click any Spent/Received number to see the transactions behind it.
  Income is split into **Standard Income** (paychecks: checks × per-check amount, plus a
  **titheable/check** column — the pre-insurance/retirement figure the tithe is based on)
  and **Extra Income** (inconsistent income — gifts, reimbursements; tithed at full
  planned value unless exempt). Click an income fund's name for its setup: type,
  **Exempt from Tithe**, and **Carry leftover into next month** (off by default —
  paycheck funds reset to $0 like the spreadsheet). Adding a fund from any section asks
  Income vs Expense first (pre-selected by context).
  Tithe = % × (checks × titheable/check + bonus income planned).
  Categories can be added (+ Add category) and removed (✕ on the header) — removal
  requires the category/fund to be balanced first and never touches past months.
  A **Find a fund** box filters the page to matching funds (categories with no match are
  hidden; totals still reflect every fund). A **Tx** column shows each fund's transaction
  count for the month — click the number to jump to those transactions.

  The page is layered: a month hero (Left to allocate) plus three stats, then **collapsible
  categories** whose header line carries carry-over / planned / spent / left and a progress
  bar, all sharing **one sticky column header**. Open/closed state is remembered per month
  (first visit opens income and anything flagged); *Expand all / Collapse all* is in the
  toolbar and searching auto-expands matches.

  Every fund row ends in a **⋯** that opens the **fund panel** on the right — its numbers,
  its setup, its actions (transfer, move up/down, change category, remove) and its
  transactions, all in one place. Rows themselves carry only a type glyph (↻ fixed, ▦ pacing,
  ◎ savings goal, ▲ build up, ⊘ insights off) and at most one status chip
  (over / off pace / $X free / overridden); on-pace shows as a green dot.
  **Click a fund's name** to open its setup: pick a fund type and (optionally) move it
  to another category. Types: **Basic** (all-purpose; leftover flags as available after
  the first transaction) · **Pacing** (groceries-style; on-pace/off-pace chips through
  the month, leftover available on the last day) · **Fixed recurring** ($T every N
  months → planned = T÷N) · **Savings**, in two modes —
  *Target Date* (goal $ by target month → planned fills the gap evenly; the goal rolls to
  the same month next year after it passes; insights fire only in the target month) or
  *Build Over Time* (a fixed amount set aside every month to build a pot you draw from as
  needed; never flagged available-to-move, only flags if it goes negative — with either
  no ceiling ("Build Forever") or a goal: contributions cap to land exactly on the goal,
  pause there, and resume if the balance drops below it).
  Every fund type also has **"Exclude fund from insights"** — the fund never triggers
  Needs Attention / Available to Move and shows no pace chips.
- **Exclude transfers from reporting** (Settings) — fund-to-fund transfers stay visible
  inside each fund, but stop counting toward actual income/spending in the summary
  cards, Year Overview, and month recap. Income funds named "Transfer …" count entirely
  as transfers. Auto planned amounts are overridable per month (an "overridden"
  chip shows; new months reset). Badges at the top flag funds that **need attention**
  and money **available to move**. Setup and category changes apply current-month
  forward; history never changes.
- **End-of-month workflow** — "Start next month" opens a recap of the closing month
  (income/spent/net, wins, pacing results, matured savings goals, category breakdown),
  lists outstanding insights with inline transfer links, then creates the month —
  or skip it all with one click.
- **Transactions** — add/edit/delete entries for the month. Expenses negative, income positive.
- **⇄ Transfer** — move money between any two funds in the month (toolbar button on the
  Budget and Transactions pages, or the ⇄ on any fund row to prefill "From"). A transfer is
  stored as a matched pair of transactions ("Transfer to X" / "Transfer from Y"), so the
  audit trail is kept and income/expense totals are unaffected.
- **Import CSV** — pick a bank CSV export; both formats are auto-detected:
  the credit-card export (Debit/Credit columns) and the checking-account export
  (Transaction Type + Transaction Amount). Rows are auto-matched to funds from your history
  (memo prefixes like "note - Withdrawal to X" are handled), duplicates (same vendor + amount
  within ±4 days) and card payments — including the checking-side "CAPITAL ONE … PMT"
  withdrawals — are flagged and deselected. Nothing saves until you press Import.
- **Year Overview** — income-vs-spending bars by month, a ranked "where the money went"
  chart, the monthly actuals table, and per-fund history with a planned-vs-spent chart.
- **Settings** — tithe %, fund rename (updates all months + transactions), new categories,
  data export.

**+ Start next month** rolls every expense fund's leftover into the new month's carry-over,
resets income carry-overs to zero, and re-applies planned rules — exactly like copying the
spreadsheet tab, minus the manual work.

## Development

- `npm start` — run the app.
- `npm run pack` — rebuild the packaged exe into `dist/`.
- `node tools/test-compute.mjs` — verifies the computation engine against the original
  spreadsheet's cached values (needs the xlsx on the Desktop).
- `node tools/dev-server.js` — serves the UI at http://localhost:5173 for browser testing
  (in-memory only, no persistence).
- `tools/extract-workbook.js` — the one-time spreadsheet → `data/seed.json` importer.
- `build/icon.ico` — the app icon (💰), built by `node tools/build-ico.js` from PNGs in
  `tools/icons/` (rendered from the emoji via browser canvas; POST /save-icon on the dev
  server regenerates them). Pass `--icon=build/icon.ico` when packaging.

The seed data is only used on first run (when `%APPDATA%\Family Budget\budget-data.json`
doesn't exist yet). Deleting that file resets the app to the spreadsheet snapshot.
