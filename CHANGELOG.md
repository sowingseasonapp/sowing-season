# Changelog

Written for whoever picks this project up next — including a future Claude session.
It records **what changed and why**, plus the decisions and traps that aren't obvious
from the code. Newest first.

The app was built conversationally over several sessions; git arrived late (2026-08-16),
so entries before that are dated by when the work happened, not by commit.

---

## 2026-08-23 — Sowing Season: rename, garden skin, and the Garden home view

Implements `_cowork/proposal-sowing-season-garden.md` in full (all four phases). The app
is now **Sowing Season**; the Garden is the landing view; the palette is warm
parchment + leaf green; the budget maths, fund flags and AUM computation are untouched.

- **Rename + data-folder move-in (the one dangerous line).** `productName` drives
  Electron's `userData`, so the rename moved the data folder from
  `%APPDATA%\Family Budget` to `%APPDATA%\Sowing Season`. `legacy-data.js`
  (pure Node, CommonJS, shipped in the package) copies `budget-data.json`,
  `bank-profiles.json` and `backups/*.json` forward on the first launch — **copy,
  never move**; guarded on the new folder having no data file (runs at most once, never
  clobbers); skipped entirely under `BUDGET_DATA_DIR` (demo runs must never pull real
  data in); wrapped in try/catch with a `dialog.showErrorBox` that names both folders
  and says nothing was removed. The data file is copied last so a half-failed copy
  retries cleanly next launch. `npm run test:migrate` (17 checks, scratch dirs).
  `settings.appName` now drives the sidebar brand; boot rewrites the stored
  `'Family Budget'` value to `'Sowing Season'` (a value change — **version stays 6**).
  The old `%APPDATA%\Family Budget` folder is deliberately left in place indefinitely.
- **Palette** (`styles.css :root`): `--bg #f7f5ee`, `--ink #26301f`, `--ink-soft
  #636a59`, `--line #e6e3d5`, `--accent #4a7c46`, `--red #b8543a` (terracotta),
  `--amber #8f6a1c`, `--sidebar #283a24`, `--sidebar-ink #d5ddcc`, `--radius 12px`;
  new helper tokens (`--accent-deep/-tint/-tint-line/-hover`, `--red-deep/-tint`,
  `--amber-tint`, `--head-bg`, `--hover-row`, `--line-faint`, `--sidebar-ctl`) replace
  the 40-odd hard-coded blues/greys. Every text-bearing pair checked ≥ 4.5:1
  (ink/bg 12.6, sidebar-ink/sidebar 8.7, white/accent 4.9, accent-deep on tint 5.6).
  Chart series colours (`--viz-s1/-s2`, the validated blue/orange pair) were left alone
  on purpose — they are data colours, not accent, and green/orange is a weaker pair.
- **Garden engine — `src/garden.js`** (pure; `npm run test:garden`, 81 checks).
  `gardenState(data, {monthId, todayISO})` → plants (state from `fundFlags` +
  `computeMonth`: exceeded → wilting, pace → thirsty, offset → harvest, zero budget &
  no activity → resting, month done & leftover ≥ 0 → blooming, on-pace pacing fund at
  ≥ 80 % of the month → blooming, no activity → planted, else growing), weeds
  (`unassigned.length`), season (latest AUM snapshot vs. the one nearest 90 days back,
  ≥ 30 days apart, flat within ±1 % or $100; no data → steady), maturity (milestones at
  3/6/12/18/24 months; tree size by closed months 1/3/6/12; wall stones = all-time-high
  snapshots, the first counting as the foundation stone), sown (|leftToAllocate| ≤ 2¢ —
  the Budget hero's own rounding rule, not the proposal's 0.5¢, so the two surfaces
  never disagree), and ≤ 3 messages. Species by type via FNV-1a of the normalized name.
  **v3 two-register pass (2026-08-23):** every caption on an actionable state is plain budget
  language ("Over by $40 — a transfer covers it.", "Spending faster than planned — on pace to go
  over.", "$120 unspent — free to move."), status-only states (planted/growing/blooming/resting)
  carry `action: null`, every plant carries a Budget `jump` (the click target, §3), a plain
  one-line `phrase` for tooltips ("$40 over", "on plan"), and the only action labels the engine
  emits are `ACTION_LABELS` (Transfer… / Open Budget / Open Import / Review N unassigned / Use
  actual / Finish setting up). Messages follow suit ("2 transactions this month have no fund
  yet." → Review 2 unassigned). The calm affirmation and season notes keep a light garden line
  (status-only). Asserted in test-garden (96 checks): allowed-label regex, no metaphor words in
  any actionable text or tooltip phrase, no banned words.
  Savings plants grow with their pot, not the calendar. `incomeCheckIns` moved here from
  `renderBudget` so the Budget strip and the Garden card share one rule.
  **Decision:** the proposal's flat cap of ~16 visible plants made the owner's 51-fund
  garden a thumbnail (one or two plants per bed, "+N" everywhere). The cap is now what
  the beds physically fit (two columns past four beds, ~9 plants per bed, ceiling 60),
  so "+N" appears only on a genuinely full bed; the scene stays 30–40 KB.
- **Scene — `src/garden-scene.js`** (pure, string out) — **v3 watercolor rewrite
  (2026-08-23)**, built on the approved proof of concept `_cowork/watercolor-svg-poc.html`:
  every shape is 2–3 translucent washes (light / mid / dark from one ramp per material),
  each pass pushed through a different `feTurbulence`+`feDisplacementMap` filter so the
  edges misregister like real watercolour; exactly the POC's four filter defs
  (`#wc1`–`#wc3`, `#paper` on the background rect only), applied at the *wash-group*
  level (a `Painter` collects strokes per pass and emits three filtered `<g>`s per symbol
  or fixture — never per tiny element). Plant drawings are the POC's six states ported to a
  soil-origin `<symbol>` space plus growth stages and family variants (row crops, shrubs,
  fruit trees, evergreens), emitted once and placed with `<use>`; ~45–60 KB for the owner's
  51 funds (budget ≤ 80 KB). Layers: paper → sky washes → sun/clouds → hills → ground →
  season light → fixtures → beds (soil washes + carved sign with the plain category name)
  → plants → weeds → foreground grass → ambient. Colours are `--g-*` tokens; season and
  time-of-day (morning/midday/golden/evening from the clock hour) are classes on
  `.garden-wrap`. Every animated or hover-lifted element sits inside an outer positioning
  `<g transform>` with the class on an inner group (the POC's CSS-transform gotcha).
  Ambient: growing/steady → the POC butterfly; lean → one slowly falling leaf over three
  static fallen ones (≤ 3 animated ambient elements, 7–11 s loops); blooming plants sway
  (capped at 6), harvest fruit glows; `prefers-reduced-motion` turns all of it off.
  Living feedback: `renderGarden` diffs plant states against the previous render of the
  same month and stamps `was-<state>` so CSS eases a wilted plant upright (~600 ms) or
  sparkles a newly harvest-ready one. `tools/scene-preview.html` (dev only) renders the
  scene full-width from `data/seed.json` with season/time/labels switches.
  **Perf decision — bitmap + live layer (2026-08-23, measured on the packaged build with
  the owner's 51 funds):** with ~170 live filter regions in the page, Chromium re-rasterised
  every one of them on every produced frame — the drifting butterfly alone idled the GPU
  process at **1.7 cores**, and so did an unrelated sidebar opacity animation (0.7). Layer
  promotion, a sprite-sized ambient SVG, compositor-thread transforms and stepped timing
  all left it at 1.7; disabling the filters (not the animations) took it to 0.26. So the
  app renders the scene in **bitmap mode**: `sceneSvg(g, { bitmap: true, palette, skip })`
  returns one self-contained SVG (the wrapper's computed `--g-*` colours substituted,
  styles inlined) that `renderGarden` rasterises once into a `<canvas>` at device
  resolution (decoded images cached by SVG string; redrawn on resize via
  ResizeObserver; nothing stored or shipped), a transparent **hit layer** (the same
  data-plant / data-more / data-weeds targets, focusable, with aria labels) and a
  `placed` manifest. **Live sprites** (`plantSprite`: one plant in its own small svg,
  positioned by percent) sit between canvas and hit layer only where motion is wanted —
  the hovered plant (lift is a transform on the HTML element), changed plants (was-*
  transition), harvest glow and up to six swaying blooms (both `steps()`-timed) — and the
  butterfly / falling leaf is a small sprite whose animation class is on the svg element
  (compositor thread). Result: **0.15 cpu-s/s idle with the butterfly drifting at 60 fps**
  (pure frame production), 0 when the window is occluded. Live mode (stacked inline SVGs)
  remains for the dev preview, the tests and as the in-app fallback if rasterisation fails.
- **Garden view** (`renderGarden`, v3): plain status line ("August · fully allocated ✓ ·
  45 on plan · 0 need attention · 1 with money to move"), scene, season note, message
  cards (weeds → wilting → thirsty → harvest → check-in → setup-checklist → unsown →
  calm) whose buttons name their destination, maturity line, and a **Show labels**
  toggle (fund name + left/over under every visible plant; a module variable, nothing
  stored). Tooltips are numbers: fund, category · plain phrase, a progress bar,
  planned/spent/left, then the caption. **Any plant click opens that fund in Budget**
  (category opened, row highlighted via `budgetFocus`); "+N" → Budget filtered to the
  category; weeds → the unassigned flow. Keyboard: plants/signs/weeds are focusable
  buttons (Enter/Space). The Garden has no editing controls of its own.
  `showTransferModal` gained a `presetTo` argument. One-slide intro on first visit
  (`settings.gardenIntroSeen`, the only new stored key). `view` starts as `'garden'`;
  `enterApp` lands there (so the wizard exits into the Garden); month-create and
  Settings jumps still go to Budget.
- **Ceremony + copy (v3 two-register rule):** the working views keep their vocabulary
  exactly — the Budget hero still reads "Zero-based ✓ — every dollar has a job", the
  sidebar button is still "+ Start next month", the month-created toast is still
  "{Month} created — review planned amounts." and the month-close action button is
  "Start {Month}" (an earlier v1-era pass had changed all four; reverted 2026-08-23).
  Garden phrasing lives only in ceremony: month close is **"The {Month} harvest"**, opening
  on a small static watercolor **vignette** of the month's final garden (`stripSvg`: up to
  six plants, harvest and blooms first) with one framing line ("The beds are in for
  August — here's what the month grew."), then the existing wins (+ "+N wall stone") and
  the quiet basket row; the numbers stay literal. Errors and money math stay literal.
  Banned words (failed/bad/behind/should have) are asserted absent; test-garden §11 guards
  the working-view strings, the reduced-motion block, stepped plant motion, 6–12 s ambient
  loops and the raster-asset rule (the only rasters in `src/` are the three AUM help
  screenshots) — 139 checks.
- **Ambient life (§4, Phase 4):** `ambientPlan(state, { tod, placed })` picks the accents
  deterministically from season × time of day × month hash, ≤ 3: growing → butterfly
  and/or a bee looping in the lawn band beside the first bloom (hash-gated, only when a
  plant is blooming); steady → butterfly only; lean → one falling leaf over three static
  fallen ones; evening light → the butterfly's slot becomes a single drifting firefly
  glow. Each accent is its own small sprite `<svg>` with the animation class on the element
  (compositor thread); all in the sky/lawn bands, never over cards, tooltips, the status
  line or a plant that needs reading; `prefers-reduced-motion` stops all of it.
- **AUM walkthrough screenshots** recaptured in the new palette by `tools/capture-help.js`
  (Electron `capturePage` at 1:1 from a 1160×800 window, fabricated demo data in a scratch
  folder via `BUDGET_DATA_DIR`, crops from element bounds) — 151 KB total.
- **App icon:** `build/icon.svg` is the watercolor sprout mark (same filters, no raster
  art); `tools/icon-export.html?save=1` (dev server) rasterises it to `tools/icons/` via
  canvas and `node tools/build-ico.js` bundles `build/icon.ico` — the only raster in the
  product, derived from the SVG.



Implements `_cowork/onboarding-proposal.md` (rev 1.1). Resolves the distribution
blocker: `data/seed.json` is the owner's real 9-month financial history and used to be
copied to every new install. New installs now start **empty** and run a setup wizard.

- **main.js**: first run returns a `BLANK()` state (version 6, no months) and writes
  **nothing** — the wizard's Finish does the first save, so quitting mid-wizard leaves
  no file and the wizard re-runs next launch. The corrupt-file fallback chain still
  prefers the newest good backup but its last resort is now `BLANK()` (a `.corrupt`
  copy of the unreadable file is kept first, since finishing the wizard later would
  overwrite it). `data/seed.json` is untracked (`.gitignore`), dropped from the
  packager's KEEP list, and the owner keeps his local copy; his install is untouched —
  the wizard only fires when `data.months` is empty.
- **The wizard** (`renderOnboarding` in app.js): full-screen 6-step stepper (hidden
  sidebar, own paint loop — never `render()` while it owns the screen; no
  `markDirty`/save before Finish). Welcome → optional bank file → paychecks → giving →
  envelopes → finish. Plain-language copy throughout per the owner's hard requirement.
  - **Bank file step** calls `parseBankFile` (never the legacy parser) and honours its
    full contract: refusals show the importer's text verbatim plus one skip line;
    blocking questions render through `csvQuestionsHtml`/`wireCsvQuestions` —
    **extracted from the Import view, shared, not forked** — and Skip stays available
    throughout. Multiple files add together (checking + card complement each other).
    Resolved profiles persist on Finish via the shared `persistResolvedProfile`, so a
    format confirmed in the wizard never asks again on the Import tab (verified).
  - `suggestStarterFunds(recs)` in csv.js (pure, unit-tested): card `bankCategory`
    mapping first, then ~10 conservative vendor keywords; monthly amount = total ÷
    months spanned rounded **up** to $5; unmapped spending inflates Everything Else.
    Paycheck detection clusters payroll-flavoured deposits (±10%), needs ≥2 hits on a
    steady cadence, suggests the median and the last-full-month count — worded as a
    suggestion the user confirms, never silently applied.
  - Paychecks become Standard Income funds + `month.checks` entries (`titheAmount`
    defaults to the net amount; hourly path sets `chk.variable`). `planned` is left at
    0 and computed by `applyChecksRules` — never hand-set on a checks-rule fund. An
    "Other Income" bonus fund is always added.
  - Giving is **offered, not assumed** (not pre-checked): yes → `settings.tithePercent`
    + a Giving category with a tithe-rule fund; no → nothing else changes.
  - Envelopes: curated starter set with pre-assigned types (pacing for everyday
    spending, build-mode Safety Net, target-mode Christmas/Vacation, Car Insurance
    optionally `fixed` every-N-months). CSV suggestions arrive pre-checked with
    amounts and a "from your bank file" chip. Unchecking everything still keeps
    Everything Else so the month is never structurally empty.
  - Finish builds the **current calendar month** only and imports only **current-month**
    rows via the shared `pushImportedTx` (same stored shape as the Import view, trusted
    external ids included). Older rows inform averages only — fabricating past months
    would poison the first real month with negative carryover (deliberate; don't
    "improve" it). Unmapped rows import with `fund: ''` into the unassigned flow.
- **"Finish setting up" checklist** on the Budget page (`settings.setupChecklist`):
  amounts / paycheck double-check / tithe base (if giving) / import (if CSV skipped) /
  unassigned (if any). Items auto-latch done at render time (never un-latch) or by
  clicking the check control; each is a link to the right spot; dismissible with a
  confirm; 🎉 card when everything's done. Quiet styling — an invitation, not a nag.
- `boot()` split: the wizard guard runs right after migrations (the old L2375
  `data.months[length-1].id` crash on empty months can't be reached), and
  `enterApp()` is shared by normal boot and wizard hand-off.
- Dev harness: `?blank=1` boots the empty state; `?csv=/path1,/path2` feeds files to
  "Choose file". Tested end-to-end in the browser: full path, skip-everything path,
  refusal (semicolon), blocking questions (ambiguous dates + sign), profile
  round-trip to the Import tab, checklist lifecycle, month rollover from the
  wizard-built month, and a seeded boot (no wizard, no card).



Implements `_cowork/bank-csv-research/` (research bundle from 2026-08-11; decisions in
`03-DECISIONS-AND-WORK-ORDER.md` and `PHASE-4-GO-AHEAD.md`). Four commits, one per phase.
The new pipeline lives in `src/csv/` (decode → tokenize → structure → roles → values →
sign → profiles → import), entry point `parseBankFile(bytesOrText, {answers, profiles})`
re-exported from csv.js; the six legacy csv.js exports keep their signatures. Cents are
exact integers (BigInt) inside the importer, dollars at the boundary; the stored JSON
shape is untouched and **no stored transactions were migrated**.

Core stance (D1): the importer **refuses or asks instead of guessing**. Day-first dates,
decimal commas, semicolon delimiters and recognised-but-unsupported formats (Monzo,
Sparkasse) refuse by name; genuine ambiguity raises blocking questions the Import button
waits on; a running-balance column is a hard reconciliation gate. User-confirmed profiles
persist to `bank-profiles.json` in userData (IPC `profiles:load/save`, honours
`BUDGET_DATA_DIR`) and are authoritative on repeat imports; seed profiles are structural
only.

Phase 4 (this commit) — the long-tail items, minus one:

- **Scored duplicate matcher** (proposal §8). `scoreDuplicate` tiers: exact = 1.0; within
  2¢ or 0.5% = 0.9; within 5% *and* the larger amount is the later one *and* the vendor
  looks like dining/fuel = 0.6 (tips, pump holds). ≥0.9 auto-marks **duplicate**
  (deselected); 0.6–0.9 renders **possible duplicate** — pre-checked so it imports unless
  unticked. The `claimed`-set multiplicity behaviour is kept (three identical coffees need
  three existing entries). New keys: account (same $50 on two cards ≠ duplicate) and bank
  transaction ids — trusted only when the id column is ≥95% non-empty and ≥95% distinct
  (`report.externalIdTrusted`; Zions ships a constant "null" reference column, which is
  why the validation exists). Trusted ids are stored on imported transactions so the next
  import of that account dedupes exactly. Date window is now **asymmetric −3…+7 days**
  (pending posts later). Legacy `findDuplicate` keeps its signature but returns only
  confident (≥0.9) matches. `normVendor` folds accents (NFKD) so a re-encoded "Café"
  can't double.
- **Full pending-row handling**: the status vocabulary covers the reference's flag list
  (Pending, Placed, Denied, Reversed, Issued, Failed, Expired, Declined, Reverted,
  Cancelled), and a **blank clearing/settle/completed date column marks a row pending**
  (Apple Card has no Status column at all — the blank Clearing Date is the marker).
- **Second descriptions**: memo-role columns (Comments, Extended Details, Notes) ride on
  each record, land in the transaction's `description` field, feed `suggestFund` and act
  as an alternate vendor key in duplicate matching — credit-union exports put a type code
  in Description and the real merchant in Comments.
- **Direction columns** (unsigned amounts + a Type/Credit-Debit indicator — Mint, Zions):
  which token means which direction is **data, never code**. Per token: balance proof >
  the user's answer > a stored profile mapping > the unambiguous debit/credit and
  withdrawal/deposit families. Anything else (Af/Bij, Sale/Payment…) asks a per-token
  question, and the answer persists into the resolved profile. The test suite proves the
  same Af/Bij tokens import with opposite signs when the balance column says so.
- **Multi-table files are REFUSED** (the owner's decision, reversing the proposal's "offer
  both tables"): a second table = an investment export (Vanguard, IBKR), which an
  envelope budget shouldn't ingest. `segment()` now scores a would-be second header with
  the rows beneath it, so the detection actually fires. Fixture 53 asserts the refusal.

Tests: `npm run test:csv` — 505 checks. Fixture #0 (both Capital One formats) is still
byte-identical to the pre-change baseline, and `parseBankFile` must agree with the legacy
parser on those files. **the owner's follow-up**: on the next 2–3 real imports, review the
"possible duplicate" rows specifically to confirm the 0.6–0.9 scoring feels right before
trusting it.

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
- `data/seed.json` holds **real financial history**. Since 2026-08-22 it is untracked,
  git-ignored and excluded from the packaged app — it must never come back into either.
  the owner's local copy stays on disk; the app no longer reads it.
