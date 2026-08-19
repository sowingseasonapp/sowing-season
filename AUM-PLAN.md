# AUM Tab — Integration Plan for Family Budget

*Plan for Claude Code. Written 2026-08-19 against the current codebase (data version 5,
`src/app.js` ~1,800 lines). Read `README.md` and `CHANGELOG.md` before starting.*

---

## 1. What "AUM" is (research summary)

AUM (Assets Under Management) is SeedTime's (Bob & Linda Lotich) reframing of **net worth**:

> **AUM = Total Assets − Total Debts**

They call it "the 2nd most important financial metric to track" and prefer the term over
"net worth" because it frames money as something you *manage/steward* rather than something
you *are worth*. Their worksheet is deliberately simple: one dated sheet with two columns —
**Assets** (name + estimated value) and **Debts** (name + amount owed) — totaled and
subtracted. The point is not precision; it's re-checking it on a regular rhythm (monthly or
quarterly) so you can see whether the number is moving in the right direction over time.
"Good managers know what they are managing."

Design implications for our tab:

1. Two flat lists (assets, debts) with a name and a current value each — no forced
   categories, no account syncing. Values are typed in by hand, like the worksheet.
2. The headline is one big number (AUM) with assets/debts totals beneath it.
3. The value of the feature is the **timeline**: AUM captured over time, plus knowing how
   stale each entry is ("last updated on X").

Sources: [SeedTime podcast — AUM: the 2nd most important financial metric](https://seedtime.libsyn.com/aum-the-2nd-most-important-financial-metric-to-track),
[SeedTime AUM worksheet (PDF)](https://seedtime.com/wp-content/uploads/True-Financial-Freedom-AUM-sheet.pdf),
[AUM sheet landing page](https://seedtime.com/smrl-aum/).

---

## 2. Product decisions (the owner's requirements)

- **Own tab**, fully separate from the Budget: new `AUM` entry in the sidebar nav. The AUM
  view is **month-independent** — it ignores the month picker and always shows "now" plus
  its own history. Do not tie AUM data to `data.months`.
- **Track AUM over time**: a snapshot history with a chart (AUM line over time, with
  assets/debts context) and a history table.
- **Track when changes are logged**: every asset and every debt shows "Updated on {date}",
  updated automatically whenever its value is edited. The section headers show the most
  recent update across the section ("Assets · last updated Aug 19").
- **Clean and easy**: match the existing visual language exactly (hero figure + stat cards +
  sections, same CSS variables, same edit-in-place money inputs). No new dependencies.

---

## 3. Data model — migration to version 6

Add a top-level `aum` object to the data file, and bump `version` to 6.

```js
data.aum = {
  assets: [
    // { id: 'a_xxx', name: 'House', value: 425000, updatedAt: '2026-08-19' }
  ],
  debts: [
    // { id: 'd_xxx', name: 'Mortgage', value: 310000, updatedAt: '2026-08-19' }
  ],
  snapshots: [
    // { date: '2026-08-19', assets: 425000, debts: 310000, aum: 115000 }
    // append-only, sorted by date, at most one per calendar day
  ],
  log: [
    // { date: '2026-08-19', kind: 'asset'|'debt', name: 'House',
    //   from: 420000, to: 425000, action: 'update'|'add'|'remove'|'rename' }
    // newest last; cap at 200 entries (drop oldest past the cap)
  ],
};
```

Notes:

- `id`s follow the existing pattern (`newTxId()` style): `'a_' + Date.now().toString(36) + '_' + rand`.
- `value` is always a **positive** number for both assets and debts (debts are "amount
  owed"); AUM math does the subtraction. Round with `r2()` from `compute.js`.
- `updatedAt` / `date` are `YYYY-MM-DD` strings (use the existing `todayISO()` in app.js;
  the pure helpers in compute.js should take the date as a parameter — see §5).
- **Snapshots** are written automatically on every mutation (add / edit / remove): compute
  totals, then upsert today's snapshot (replace if one already exists for today, else
  append). This gives the timeline for free — no "log snapshot" chore. Keep an optional
  "Record snapshot" button anyway for a deliberate "mark it down" moment (it just upserts
  today's snapshot even with no edits).
- **Log** answers "when were changes logged and what changed" at the item level, which is
  the audit trail the owner asked for beyond the per-item `updatedAt`.

### Migration (`migrateV6` in `src/compute.js`)

Follow the existing migration pattern exactly (see `migrateV4`):

```js
export function migrateV6(data) {
  if ((data.version || 1) >= 6) return false;
  if (!data.aum) data.aum = { assets: [], debts: [], snapshots: [], log: [] };
  data.version = 6;
  return true;
}
```

Wire it into `boot()` in `src/app.js` alongside the others:
`let migrated = migrateV2(data) | migrateV3(data) | migrateV4(data);` → add `| migrateV6(data)`
(keep the `migrateV5` special handling as is). Migrations run once and are saved back —
same as today. `data/seed.json` does **not** need to change (first-run seeding goes through
the migration on boot).

Persistence, backups and Settings → export all operate on the whole `data` object, so AUM
data is saved, backed up and exported with **zero changes** to `main.js`.

---

## 4. UI

### 4.1 Nav (src/index.html)

Add one button to `#nav`, between Year Overview and Settings:

```html
<button data-view="aum" class="nav-btn">🌱 AUM</button>
```

(🌱 nods to SeedTime; 🏦 or 📊 fine if it renders badly.) The generic nav click handler in
`boot()` already routes any `data-view` value — no change needed there. Add the render
branch in `render()`:

```js
else if (view === 'aum') renderAum(main);
```

### 4.2 The AUM view (`renderAum(main)` in src/app.js)

Layout, top to bottom — everything reuses existing classes (`.month-head .hero`, `.cards`,
`.card`, `.section`, `.section-head`, `.grid.compact`, `.btn`, `.muted`):

1. **Header**: `<h1>AUM</h1>` + sub line: *"Assets under management — everything you manage,
   minus everything you owe."*

2. **Hero**: the current AUM figure, `hero good` when ≥ 0, `hero bad` when negative.
   Note line: change since the previous snapshot, e.g. *"▲ $2,350 since Jul 12"* (omit when
   there's only one snapshot). Beside/beneath it, two stat cards:
   - **Assets** — total, note: "last updated {most recent updatedAt among assets}"
   - **Debts** — total, note: "last updated {most recent updatedAt among debts}"

3. **AUM over time** section: a line/area chart of snapshots (see §4.4). Hidden with a
   friendly empty-state line until there are ≥ 2 snapshots. Section header carries a
   **Record snapshot** button (`btn btn-sm`).

4. **Assets** section and **Debts** section (side by side ≥ ~1100px via a 2-col grid like
   `.settings-grid`; stacked below). Each is a `.section` whose header shows the section
   total and a `+ Add` button. Body is a compact table; each row:

   | Name | Value (edit-in-place) | Updated | ✕ |

   - Value edits use the same pattern as planned-amount edits on the Budget page: an
     `<input class="money">` parsed with `parseMoney()`, formatted with `money()` on blur,
     commit on change → set `updatedAt = todayISO()`, write log entry + upsert snapshot,
     `markDirty()`, re-render.
   - "Updated" column: short date ("Aug 19"; include year when not the current year),
     `muted`. If an entry is older than 90 days, add a "stale" chip using the existing
     `rule-chip chip-warn` styling — a gentle nudge to re-check it, in keeping with how the
     Budget page only surfaces chips when something asks for attention.
   - ✕ removes with a `confirm`-style guard (use the same pattern as `removeFundGuarded` /
     existing dialogs — Electron has no `window.prompt`, and the codebase already has
     `promptName` for name input; adding an item uses `promptName` then a value edit).
   - Rows sorted by value descending (biggest first, like the worksheet reads naturally);
     no drag-ordering needed.

5. **Change log** section, collapsed by default (reuse the accordion pattern or a simple
   details toggle): newest-first table of `log` entries — date, Asset/Debt, name, old → new
   value. This is the "keep track of when changes are logged" requirement made visible.

6. **History** table (can live inside the chart section, below the chart): one row per
   snapshot — date, assets, debts, AUM, Δ vs previous row. Newest first.

State: add `let aumLogOpen = false;` (or reuse the open-state helpers) — keep it simple,
module-level like `flagPanel`.

### 4.3 Mutation helper (single choke point)

All edits go through one function so the bookkeeping can't be missed:

```js
function aumMutate(action, kind, item, { from = null, to = null } = {}) {
  // 1. apply the change (caller already did the field write)
  // 2. push log entry { date: todayISO(), kind, name: item.name, from, to, action }
  //    and trim to 200
  // 3. upsert today's snapshot from aumTotals(data.aum)
  // 4. markDirty(); render();
}
```

### 4.4 Chart (`src/charts.js`)

Add a `lineArea({ points, color, height })` export alongside `groupedBars`/`barList`,
following the file's conventions exactly: same `el()` SVG helper, `niceScale`, `viz-*`
classes, `makeTooltip`, 900-wide viewBox, `fmtTick` y-axis labels. Specifics:

- `points: [{ label: 'Aug 19', value: 115000 }]` from snapshots (x = time, evenly spaced is
  fine at this cadence; thin the x labels when > ~12 points).
- A single AUM line with a soft area fill (`opacity ~.08`), dots on data points, tooltip
  showing date + assets / debts / AUM (pass the full snapshot through for the tooltip).
- Must handle negative AUM: extend `niceScale` usage to a min < 0 with a zero baseline
  (`viz-baseline`) drawn at y(0) — this is the one place the existing helpers need a small
  extension. Keep colors from the `VIZ` tokens in app.js (`s1` blue for AUM); pass color in
  as `groupedBars` does.

### 4.5 CSS (`src/styles.css`)

Should need almost nothing: a 2-col grid for the assets/debts pair (reuse/generalize
`.settings-grid`), a `.stale` chip if not already covered by existing chip styles, and
whatever the line chart needs (`.viz-*` additions consistent with current chart styles).
No new colors — use the existing `:root` variables only.

---

## 5. Pure logic in compute.js (+ tests)

Keep app.js dumb; put the calculable parts in `src/compute.js` so `npm test`
(`tools/test-compute.mjs`) can cover them:

```js
export function aumTotals(aum)                 // { assets, debts, aum } — r2-rounded
export function upsertSnapshot(aum, dateISO)   // replaces same-day, else appends; keeps sort
export function aumLastUpdated(items)          // max updatedAt or null
export function migrateV6(data)
```

Tests to add to `tools/test-compute.mjs` (follow the existing assert style):
totals with empty/positive/negative results; upsert replaces same-day and appends new day
and preserves date order; migration is idempotent (`migrateV6` twice → second returns
false) and doesn't clobber an existing `aum`; last-updated picks the max date.

---

## 6. Docs

- **CHANGELOG.md**: new dated section at the top describing the feature, the v6 migration,
  and any decisions/gotchas hit (that's the file's job — see its intro).
- **README.md**: add an **AUM** bullet under *Views* describing the tab in the same voice
  as the others, and mention the v6 data addition where the data file is described.

---

## 7. Explicit non-goals (v1)

No bank/investment account syncing or lookups; no scheduled reminders; no per-item value
history charts (the change log covers it — easy follow-up if wanted); no linking debts to
budget funds (e.g. auto-decrementing a mortgage from transactions). All values are manual,
worksheet-style, by design — that's the SeedTime model.

---

## 8. Suggested commit sequence

1. `compute.js`: `migrateV6` + `aumTotals`/`upsertSnapshot`/`aumLastUpdated` + tests green.
2. `index.html` nav + `render()` branch + minimal `renderAum` (hero + totals, add/edit/
   remove assets & debts with updatedAt + log + snapshot upsert working end-to-end).
3. `charts.js` `lineArea` + wire chart + history table + change-log accordion.
4. CSS polish pass (2-col layout, stale chip, chart styles) at 1440px and at 980px min width.
5. README + CHANGELOG; `npm test`; manual test: fresh `%APPDATA%\Family Budget` (delete
   `budget-data.json` → seed + migrate path) **and** an existing v5 file (migrate path);
   `npm run pack` still builds.
