# Changelog

Written for whoever picks this project up next — including a future Claude session.
It records **what changed and why**, plus the decisions and traps that aren't obvious
from the code. Newest first.

The app was built conversationally over several sessions; git arrived late (2026-08-16),
so entries before that are dated by when the work happened, not by commit.

---

## 2026-08-19 — AUM first-run walkthrough + persistent ? help

Implements `_cowork/proposal-aum-walkthrough.md` (the owner's 2026-08-20 decisions there:
real screenshots, ? button in the AUM header, full SeedTime framing, link to the
SeedTime podcast episode — not `/smrl-aum`, which is an email-capture page).

- **First visit to AUM** auto-opens a 5-slide walkthrough (`showAumWalkthrough` +
  `AUM_SLIDES` in app.js, directly above the AUM view section). Any dismissal — Done,
  ✕, Escape, or overlay click — sets `settings.aumHelpSeen` and saves through the
  normal `markDirty()` path. Additive boolean, absent = falsy: **no migration, data
  version stays 6**, seed.json untouched. A `?` button next to the AUM `<h1>` reopens
  it any time from slide 1; a guard refuses a second overlay (first-run and the button
  can race a re-render).
- **Trap that cost a debug cycle**: the slides template referenced `AUM_STALE_DAYS`,
  which was declared *below* it — a `const` temporal-dead-zone throw at module load
  left the whole renderer blank. The constant now lives at the top of the walkthrough
  section. If app.js ever renders nothing, check the console for exactly this class of
  error first.
- **New IPC #7, `shell:open-external`** (preload `openExternal`): slide 5's "Listen to
  the SeedTime episode ↗" opens the system browser. main.js allowlists `https://` only —
  never pass arbitrary strings to `shell.openExternal`. There is still no `will-navigate`
  guard app-wide (no `<a href>` to external hosts exists); noted as someday-hardening.
- **Screenshots** (`src/assets/help/`, ~145 KB total, bundled automatically — the
  packager keeps all of `src/`): captured from the real app running against **fabricated
  demo data**, never the owner's live file or seed.json. The capture path is the new
  `BUDGET_DATA_DIR` env escape hatch at the top of main.js (`app.setPath('userData', …)`
  before anything reads it), pointed at a scratch folder with invented assets/debts and
  12 invented snapshots. Kept because it's generally useful for dev profiles. Capture
  trick: shoot at 1:1 from a 1160×800 window — `nativeImage.resize()` resampling
  anti-aliases flat UI regions and ballooned the PNGs past the size budget.
- **dev.html** shim grew a matching `openExternal` stub (logs to console).

Implements `_cowork/variable-income-proposal.md` (designed for future public users —
hourly, tips, commission — per the owner's 2026-08-20 decisions there: nudge + one-click
fix, nothing changes without a tap). Variable income is **not a new income type**: it's
Standard Income with an *estimated* per-check amount plus a true-up nudge. All changes
live in app.js — compute.js is untouched, no data version bump.

- **Data**: one additive flag, `variable: true`, on a fund's `month.checks[fund]` entry.
  It travels with the paycheck settings, so `buildNextMonth` copies it forward for free
  and the existing Standard→Extra switch deletes it with the checks entry. Absent/falsy
  on all existing data — old files load unchanged.
- **Fund panel**: a "Per-check amount varies (hourly, tips, commission)" checkbox in the
  `#pnlChecks` block. When on, the per-check field reads as an estimate ("each
  (estimated)", plan-low tooltip) and a suggestion line appears when history exists:
  "Recent average: $X per check — [Use]" (`recentPerCheckAvg`: mean of per-check actuals,
  `received / checks.count`, over the last ≤3 prior months with checks set up and
  received > 0).
- **True-up nudge**: fourth review-strip group, **💵 Paycheck check-in**, built from
  `comp.income` (`fundFlags` stays expense-only). For each variable standard fund still
  on its checks rule, `diff = received − planned`: over by > $1 nudges any time;
  under by > $1 only once the month is done (mid-month a low number just means checks
  haven't landed — the muted "still expected" leftover already covers it). Counts toward
  the Review badge.
- **"Use actual"** sets `chk.amount = r2(received / chk.count)` then `recalcRules` —
  never writes `f.planned` directly (the planned handler clears the rule, and
  `applyChecksRules` would overwrite it anyway). Because next month copies `checks`
  forward, the trued-up number *is* next month's plan — "budget last month's income"
  falls out with zero new rollover logic. `count × r2(received/count)` can miss received
  by a cent when it doesn't divide evenly; that's under the $1 threshold, so no re-nudge.
- **Tithe unchanged**: still `count × titheAmount`. For variable funds the titheable
  field is a typical-gross estimate (tooltip says so). Exact tithing would need a
  per-check ledger — explicitly rejected in the proposal.
- Copy: Standard Income group hint and `INCOME_TYPES` description now mention varying
  pay; the budget-row caption appends "est." for variable funds ("2 × $950.00 est.").

Verified in the dev harness: toggle on/off, suggestion average (mixes trued-up and
salaried months correctly), over-nudge mid-month, under-nudge only after month end,
Use actual → leftover ≈ 0 with rule intact, rollover carries flag + trued-up amount.

## 2026-08-18 — Remove the category progress bars

The thin blue/red progress line across the top of each Budget-page card
(`.acc-progress`, added in the layering pass) turned out to be more distracting
than informative — the owner asked for it to go. The header totals and status
chips already tell the story, so the bar, its `barPct`/`barOver` plumbing and
its CSS were removed outright rather than hidden.

## 2026-08-18 — AUM tab (data v6)

New sidebar view: **🌱 AUM** (Assets Under Management) — SeedTime's (Bob & Linda Lotich)
framing of net worth: **AUM = total assets − total debts**, kept deliberately
worksheet-simple. Two flat hand-entered lists (assets and debts, both stored as positive
"current value"/"amount owed" numbers), one hero figure, and — the actual point — a
timeline: every mutation upserts **today's snapshot** (`{date, assets, debts, aum}`,
append-only, at most one per calendar day), so the "AUM over time" line chart and history
table build themselves. Each item carries `updatedAt` (set whenever its value changes),
with a `stale` chip after 90 days as a nudge to re-check; an item-level **change log**
(add / update / rename / remove, capped at 200 entries) answers "when was this logged".
The view is **month-independent** — it ignores the month picker entirely and reads
nothing from `data.months`.

**Data model v6**: one new top-level block, `data.aum = { assets, debts, snapshots, log }`
(`migrateV6` in compute.js). Persistence, backups and Settings → export all operate on the
whole `data` object, so `main.js` needed zero changes; `data/seed.json` is untouched
(first run migrates on boot). Pure logic (`aumTotals`, `upsertSnapshot`, `aumLastUpdated`,
`migrateV6`) lives in compute.js with coverage in `npm test`.

Decisions and traps:

- **`migrateV6` must run *after* `migrateV5` in `boot()`** — it bumps `version` past 5,
  and `migrateV5` keys off the version, so the other order silently skips the v5 re-type
  pass on a fresh seed. (Found while writing the plan wiring, confirmed with the fixture.)
- All AUM edits flow through one `aumMutate()` choke point (log entry → snapshot upsert →
  `markDirty()` → `render()`), so no edit path can forget the bookkeeping.
- `charts.js` gained `lineArea()` (same `el()`/`niceScale`/`viz-*`/tooltip conventions as
  `groupedBars`). It's the one chart that must handle **negative values**: the y-scale
  extends below zero and the `viz-baseline` is drawn at y(0), not the bottom edge.
  `fmtTick` learned to print `-$8k` instead of `$-8k` along the way.
- A "Record snapshot" button exists for a deliberate "mark it down" moment, but it's
  optional by design — snapshots are automatic on every edit.
- `promptName()` grew optional `okLabel`/`initial` options so the AUM rename dialog could
  reuse it (Electron still has no `window.prompt`; same trap as 2026-08-10).

## 2026-08-17 — Per-card column headings + full UX audit

**Column headings moved inside each card.** The one sticky header per group
(income, expenses) read as detached from the tables it labelled. Each accordion
now carries its own heading row (`.acc-col-head`) just under the category name,
on the same `FUND_COLS` grid, pinned while that card is on screen. Trap fixed in
the process: sticky elements pin **inside the scroll container's padding**, so
with `#main`'s 26px padding-top a `top: 0` header floated 26px down with rows
scrolling visibly through the gap — `.acc-col-head` needs `top: -26px`.

**Full audit pass** (structural + visual), aimed at keeping the app friendly for
someone who doesn't know much about finances:

- **A penny is not an emergency.** Auto-calculated amounts round to whole cents,
  so most months sit 1–2¢ off zero (the test suite's known ≤2¢ diffs). The hero
  used to show "($0.01) Over-allocated" in red; within 2¢ it now stays green:
  "Zero-based ✓ — the 1¢ is rounding from auto-calculated amounts".
- **Un-arrived paychecks are not a crisis.** Income leftovers are negative most
  of the month (checks haven't landed yet) and rendered as big red numbers.
  Negative income leftovers are now muted, with "still expected this month" in
  the tooltip. Red still means real problems.
- **Spending is not an alarm.** Spent columns showed ordinary activity as red
  "($90.00)" while the Spent stat card showed neutral "$757.00". Spent cells now
  show plain positive amounts; a net-refund month shows green "+$X".
- **Escape now closes the fund panel.** The key listener sat on the panel
  element, which almost never holds focus (the panel re-renders with the app);
  it's a document-level listener for the panel's lifetime now.
- **Paycheck form unwrapped.** In the income panel, the flex-1 inputs forced the
  titheable field onto its own full-width line; now two labelled rows
  ("Paychecks N × $X each" / "Titheable per check") with fixed-width inputs.
- **Year Overview consistency.** "Where the money went" included the Work
  category that every other total excludes; the chart now skips
  `excludeFromTotals` categories and the table marks them "· not counted in
  totals".
- Hero notes reworded in plain language ("every dollar has a job", "Planned more
  than your income"); Transactions' Account column widened so "Checking" stops
  truncating; progress-track colour nudged visible.

**Totals moved below open cards** (follow-up, same day). An expanded card's
header numbers sat *above* the column headings that actually describe the fund
rows *below* — jarring. Open cards now show a name-only header (the title cell
spans the numeric columns) and a bold **Total** row at the bottom of the fund
table; collapsed cards keep their totals in the header row. Same rule for
income sections. Two traps: the title cell's flex layout had to move to an
inner `.acc-title-wrap` div because a `display:flex` td stops being a
table-cell box and its `colspan` is ignored; and the fixed 108px `input.money`
overflowed its 15% column on narrow windows — inside `tbl-fixed` tables the
inputs are now `width:100%`.



The Budget page had grown feature-by-feature until every category, fund, status and
action competed at the same level: 12 always-open sections, 57 fund rows, 228 row
buttons, up to 4 chips per row. A plan was written and approved first
(`~/.claude/plans/scalable-wobbling-crown.md`) and executed in five phases.

**Layering.** Six summary cards became one hero (*Left to allocate*) plus three compact
stats. Categories and income groups became **accordions**: the header line carries
carry-over / planned / spent / leftover on the same grid as the funds below, so the
totals sit under their own column headings and the body needs no totals row. Open/closed
state lives in `localStorage` (`fb.open.<monthId>`); a month's first visit opens income
plus any category holding a flagged fund. Search auto-expands matches. Each category
card carries a thin progress line across its top edge, visible open or collapsed.

**One header per group.** All tables share `FUND_COLS` + `table-layout: fixed`, so a
single sticky column header serves each group (income says *Received*, expenses say
*Spent*). Each group is wrapped in `.fund-group` so its header sticks only over its own
section — without that wrapper both headers pile up at the top of the viewport.

**Fund side panel.** Rows lost all four action buttons (up/down/transfer/delete = 228 of
them); each row now ends in one `⋯` opening a right-hand panel with the fund's numbers,
setup, actions (transfer, move, change category, delete) and its transactions. The panel
re-renders from `render()` — without that, its position-dependent buttons (move up/down)
go stale after a move.

**Setup form.** `showFundSetup` and `showIncomeSetup` were deleted. One
`setupFormHtml` / `wireSetupForm` / `readSetupForm` trio is shared by the expense panel,
the income panel and the add-fund dialog. The old three-level tree
(Type → Savings mode → Build mode) is now **five flat behaviour cards**, and
"build forever vs. goal" is a single optional *stopping at* field. Presentation only —
`setup.type` / `savingsMode` / `buildGoal` kept their shape, so no migration was needed.
Editing commits on `change`, not on every keystroke, so typing `2400` doesn't briefly
save 2, then 24, then 240.

**Status system.** Up to four chips per row became a type glyph
(fixed / pacing / savings goal / build up / insights-off) plus **at most one** actionable
chip (over / off pace / $X free / overridden); on-pace is a green dot. The two insight
badges, their two panels and the unassigned warning box merged into one **Review strip**
with three groups.

**Insight re-tune (data model v5).** `migrateV3` had typed any fund averaging >1.5
transactions per active month as *pacing*, sweeping in monthly bills that merely post
twice. Such a fund is "100% spent" the moment it posts, so it read as off pace forever —
Electricity was flagged despite one transaction landing exactly on budget.

> Transaction **count** turned out to be useless as a signal (v3's own rule guaranteed
> >1.5). The real discriminator is **distinct spending days per active month**:
> Electricity 1.0, Kids Savings 1.13, Tithe 1.88 … versus Essentials 15.1, Christmas 9.0,
> Gas 4.5. `migrateV5` re-types anything below 3 days/month to Basic.

12 funds were re-typed; Essentials, Gas, Fast Food, Random Entertainment, Christmas,
Vacation, Fathers Day and Work Expenses stayed pacing. Off-pace now also requires a
projected overrun beyond `max($10, 5% of budget)` and ignores the first 20% of the month.
July's attention flags fell 11 → 4, August's 1 → 0. The re-typed list is shown in
Settings → *Fund types adjusted* so nothing changed silently.

**Two bugs found while verifying, both fixed:**

- A UTF-8 BOM in `budget-data.json` made the app start **blank** — `JSON.parse` throws on
  a BOM. `loadData` now strips it and, if the file is still unreadable, restores the
  newest backup and keeps the bad file as `.corrupt`.
- `electron-packager`'s CLI `--ignore="^/dist"` **never matched on Windows**, where paths
  arrive with backslashes. Every build had been bundling the previous build inside
  itself: `app.asar` had reached **1.9 GB** (2.2 GB total) around 0.4 MB of real code.
  Packaging moved to `tools/package-app.js`, which drives the JS API with an allow-list.

---

## 2026-08-10 — Income fund setup, Extra Income, fund search, reordering

- Income funds gained their own setup: **Standard Income** (paychecks — checks × per-check
  amount, plus the titheable-per-check figure) and **Extra Income** (renamed from "Bonus
  Income"), each with *Exempt from Tithe* and *Carry leftover into next month*
  (`carryForward`, off by default so paycheck funds keep resetting to $0).
- Adding a fund asks **Income or Expense** first, pre-selected by which button opened it.
- Budget page gained a fund search, per-fund transaction counts, and up/down reordering
  (later absorbed into the fund panel).
- **Electron has no `window.prompt()`** (`confirm` works). It silently did nothing, so the
  add-fund and add-category buttons appeared dead. Replaced with the `promptName()` modal.
  The browser dev harness masks this — test dialogs with `window.prompt = undefined`.

## 2026-08-09 — Fund types, insights, end-of-month workflow

- Four fund types — **Basic · Pacing · Fixed recurring · Savings** — with savings splitting
  into *Target Date* and *Build Over Time* (optionally capped by `buildGoal`, which makes
  the last contribution shrink to land exactly on the goal and resume if it drops below).
- **Insights**: "needs attention" (over budget, or pacing to exceed) and "available to
  move" (transactions in, money left, no more expected). Any fund can be excluded via
  `setup.excludeInsights`.
- **End-of-month workflow** on *Start next month*: a recap (income/spent/net, wins, pacing
  results, matured savings, category breakdown) and the outstanding insights with inline
  transfers — skippable in one click.
- Fund-to-fund **transfers** stored as a matched transaction pair
  ("Transfer to X" −amt / "Transfer from Y" +amt), mirroring what the spreadsheet did by
  hand. `settings.excludeTransfers` keeps them out of aggregate reporting.
- Category add/remove, and moving a fund between categories. Removal requires the fund or
  category to be **balanced** (leftover $0, no transactions this month) — the user's rule.

## 2026-08-08 — Tithe rework, income grouping, checking-account CSV

- Income split into Standard / Extra groups (data model **v2**); each paycheck carries a
  `titheAmount` — the pre-insurance/retirement figure the tithe is actually based on.
  Tithe = % × (Σ checks × titheAmount + Σ extra planned), exempt funds excluded.
- Tithe percentage changes apply **from the selected month forward only**; each month's
  rule stores its own `percent`, so history can't move even if an old month is edited.
- CSV import learned the **checking-account** format (Transaction Type + Amount) alongside
  the credit-card one, skipping card payments on both sides and stripping memo prefixes
  ("note - Withdrawal to X") for vendor matching.

## 2026-08-06 — First build

Electron app replacing `2026 Budget.xlsx`, seeded with Dec 2025 – Aug 2026 (744
transactions). Budget / Transactions / CSV import / Year Overview / Settings, the
month-rollover engine, bank CSV import with auto-categorisation, and the money-bag icon.

**Verified against the workbook: 1,049 of 1,060 cell-level checks match exactly**; the
remaining 11 differ by at most a cent because the app rounds to whole cents while Excel
carries values like `146.66666…`. Worth knowing: the sheet's Dec–Mar tithe formula
excluded the Gifts row and was fixed from April on — the app uses the corrected rule
everywhere, so re-editing one of those months would recompute its tithe slightly.

---

## Conventions worth keeping

- **Verify against the spreadsheet.** `npm test` re-checks every month against the real
  workbook. It must stay green; treat a new mismatch as a bug in the app.
- **History is immutable.** Setup, tithe %, fund type and category changes apply to the
  selected month forward. Past months keep their own stored rules.
- **Migrations are additive and idempotent**, keyed by `data.version` (now 6). Each one
  must preserve every existing planned amount — the test suite asserts this.
- **Money is rounded to whole cents** via `r2()`; compare with a tolerance of ~0.011.
- **Package with `npm run pack`.** Never use electron-packager's CLI `--ignore` on Windows.
- **Never write `budget-data.json` with PowerShell `Set-Content -Encoding utf8`** — it adds
  a BOM. Use node.
- `data/seed.json` is tracked and holds **real financial history**. Don't push this repo
  to a public host without removing it first.
