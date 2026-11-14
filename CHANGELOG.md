# Changelog

Written for whoever picks this project up next — including a future Claude session.
It records **what changed and why**, plus the decisions and traps that aren't obvious
from the code. Newest first.

The app was built conversationally over several sessions; git arrived late (2026-08-16),
so entries before that are dated by when the work happened, not by commit.

---

### 2026-11-14 — 1.4.0 Sitting C (W0, W7–W11): giving designation, Reports Giving tab, recap line, maturity line, tithe vocabulary

Third of three sittings from the 1.4.0 work order, from `b1f80bb` (Sitting B). Files: `src/app.js`, `src/reports.js`,
`src/garden-scene.js` (W0 and W8's one label line only), `tools/test-reports.mjs`, `tools/test-garden.mjs`, this file.
`compute.js`, `garden.js`, `csv.js`, `main.js`, `preload.js`, `charts.js`, `spots.js`, `styles.css`, `index.html`,
`dev.html` are byte-identical to `b1f80bb` — the Giving tab needed no style hook. `data.version` stays 7; one new optional
key, `setup.giving` (true | false), written by W7 only; no migration. Suites: reports **94 → 100** (+5 W9, +1 W10) · garden
**225 → 227** (+1 W8 guard, +1 W11 guard; the §14 label check flipped in place) · compute 1255 · csv 621 · migrate 17, 0 failed.
No tag, no bump.

- **Correction to the Sitting B entry (W0 here).** The brook's end at x 640 was *twelve units past* the birdbath (x 652–678), not
  short of it — the water ran under the pedestal at 48+ months. It now ends at **x 692, fourteen units right of the birdbath's
  edge**: `M822,HORIZON+26 C780,+28 730,+36 692,+34`, glints at (790, HORIZON + 29) and (720, HORIZON + 34); still 598 B. And the
  bed-sign band is `bedsTop` = **HORIZON + 38**, not + 42 — the 8-wide stroke's lower edge reaches ≈ 188.3, 3.7 above the sign
  boards at 192, invisible and unchanged; the `brook()` comment says so now.
- **W0 — the willow fills out; the rabbit grows (garden-scene.js; Dustin's call 2026-11-14, "I want both").** `willow()` draws
  four washes instead of three stacked at 75° / 82° / 72°: an unrotated crown at (974, HORIZON − 22) rx 16 ry 9 spanning
  HORIZON − 31 … − 13, then three falls fanning both sides — left (960, −8) at 60°, centre (974, −6) at 65°, right (986, −9) at
  −62°; **707 → 789 B**, under the 1,536 B cap; trunk, foot and title unchanged. The rabbit sprite box is **48 × 32** at
  (W / 2 + 20, height − EDGE_H − 16), the symbol drawn through `translate(24,24) scale(1.3333)`, body fills `#bfae98` (was
  `#cfc3b2`; the white tail stays) — `left:52%; top:89.6%` on the 710-unit §13 scene, inside §10's > 60 % bound and §14's
  `top:(9\d|8\d)` match.
- **W7 — "This is a giving fund" (app.js).** `setupFormHtml(setup, monthId, rule = null)` adds a second `.setup-options` label
  (`#fsGiving`, ticked when `isGivingFund({ setup: s, rule })`); the panel passes `f.rule`, the add dialog nothing.
  `readSetupForm` **always** writes `s.giving = checked` — a Tithe fund saved ticked stores `true` (the heuristic agrees),
  unticked stores `false`, which wins over the rule; a setup never saved through the form has no key and `rule.type === 'tithe'`
  decides (the wizard's Tithe fund is untouched). The panel's `onChange` then writes `g.setup.giving` on every other month's
  same-named fund that has a setup (**Default 2 — the one Invariant-8 exception**: the designation is one fact about the fund,
  and nothing in `compute.js` reads it, so no number in any month moves). One `markDirty` per tick, so one Ctrl+Z takes the
  whole ten-month write back. Off-script and required: `wireSetupForm`'s commit selector (`'#fsFields input, #fsQuiet'`) gains
  `#fsGiving` — without it the box never fired `onChange`.
- **W8 — the maturity line and the meadow in words.** `GARDEN_MILESTONE_LABELS` is built from `[...MATURITY_MILESTONES,
  ...EARLY_FIXTURES]` (the one garden-scene.js line besides W0), so `renderGarden` names the early fixtures after the late ones
  and, after the stones, `N giving month(s)`; `next` stays last. The `.garden-maturity` title gains "The meadow beyond the
  fence grows a wildflower for every month you gave." Export copy, Sep 2026: *Tended 10 months · a garden path, a picket fence ·
  a wheelbarrow, a birdbath, a rain barrel · 2 wall stones · 10 giving months · an arbor at 12 months* (this copy's `allTimeHighs`
  says two stones); persona A at 36 months: *… a wheelbarrow, a birdbath · 1 wall stone · a brook at 48 months*, no giving clause.
- **W9 — Reports → Giving (reports.js `givingReport`, app.js third tab).** `givingReport(data, todayISO)` → `null` when no
  month has a giving fund (Default 8), else `{ funds (first-seen order), months: [{ id, label, planned, given, diff, done }]
  oldest first, year, thisYear, lifetime, count (months with given > 0.004), titheRule: { pct } | null }` — `given` = Σ
  `givenIn` over giving funds in counted categories (Work skipped; quiet funds **not** skipped), `planned` = Σ their planned,
  `year` the current calendar year or the latest present, `titheRule` when a giving fund in the newest month carries
  `rule.type 'tithe'`. The tab button renders only while the report is non-null; a selected Giving tab whose report turns null
  falls back to This Month. `reportsGivingHtml`: the range line *Given in 2026 $X · lifetime $Y · N months given*, the funds
  sentence, a `groupedBars` chart of the last 12 months (Given bars, planned line) mounted like This Year's fund chart, and a
  table *Month · Planned · Given · Difference* newest first (the open month *· under way*, the difference through `delta()`),
  plus *Planned is N% of your titheable income (Settings → Budget rules).* when `titheRule` — which, under W11, is exactly
  when it is true. **Copy rule:** the words are *given* and *planned*, the column is *Difference*; nothing on the page says
  short, behind, missed or streak. Working register. No CSS added. Export copy at 2026-09-28: *$14,110.91 · $15,146.59 · 10*, Dec
  2025 `$1,035.68 · $1,035.68 · $0.00`, Sep 2026 `$1,167.69 · $1,167.70 · +$0.01 · under way` (the tithe rule's rounding against
  the deposits — real, not a bug); persona B at 2029-09-28: *$13,222.00 · $64,373.95 · 46*, Sep 2029 `$1,322.20 · $1,983.30 ·
  +$661.10 · under way`; persona A has no Giving button.
- **W10 — the recap's giving line (reports.js `recapRows`).** After the *ahead* win and before the matured goals: Σ `givenIn`
  over giving funds in counted categories (the computed fund rows carry the raw `setup` and `rule`, so `isGivingFund` reads
  them directly), and when > 0.004 a win of kind `giving`: *You gave $X this month — the meadow grew.* Ceremony register — the
  garden half-sentence is allowed here. The Harvest recap and the Reports Wins list both read `rep.wins`. `WIN_ICON.giving` is
  `basket` (the sprite has no leaf). The recap gate is Cowork's: `compare --ignore-kind giving` expects 92 / 0, and 92 / 56
  without the flag.
- **W11 — tithe vocabulary follows the file (app.js; Default 6, #25).** `const fileHasTithe = () => data.months.some(hasTitheFund)`
  gates: the income panel's *Titheable per check* row and *Exempt from tithe* option (its handler is `if (exempt) exempt.onchange`
  — the old line threw without the element), the *no tithe* chip, the tithe sentence in each `incomeGroups` hint (built from
  parts), and Settings' *Tithe percentage* row with its paragraph (`if (tp) tp.onchange`). Three more surfaces the six-item list
  missed, found by the acceptance's `innerHTML.includes('tithe')` check and gated the same way: the income link's title (*income
  type, tithe, carry-over, paycheck*), the per-check note's *· titheable $X* clause, and the income result line's *· tithed on $X*.
  `titheMovedNote` already says nothing without a tithe fund. The data — `titheAmount`, `titheExempt`, `tithePercent` — is
  untouched and every surface returns the moment a tithe-rule fund exists. On the no-tithe fixture the Budget and Settings bodies
  carry the word only inside dev.html's own shim script; on the export copy everything reads as before.
- **Tests.** test-reports §12 (+6): `givingReport` null on the base fixture; a tithe-rule Fun → funds, rows to the cent (the
  January transfer excluded), lifetime, count, thisYear, year, `titheRule.pct`, `done` at two dates; a $0-net refund month not
  counted; `setup.giving` true on a quiet Gas adds it (first-seen order is `[Gas, Fun]` on this fixture); `giving: false` on
  the only tithe fund → null, and a Work fund's tithe rule never counts; W10's line exactly once on January, never on the base
  fixture. test-garden: §14's label check now asserts the early ids with their labels; §11 gains the W8 guard (giving months and
  the meadow sentence inside `renderGarden`) and the W11 guard (the gate and the two null-guarded handlers).
- **Verified in dev.html** (dev server, `Date` shimmed to the acceptance dates): Reports → Giving on the export copy and persona B,
  no tab on persona A; the Garden maturity line on the export copy and persona A; the W7 tick / untick round trip on Compassion
  and Tithe with the write counted across the ten months, the rule chip surviving, the Giving tab leaving and returning, and one
  Undo reverting the whole write; the W11 no-tithe fixture on Budget (three income panels open) and Settings.

### 2026-11-13 — 1.4.0 Sitting B (W0, W2(i), W4–W6): early fixtures, late fixtures, wildlife

Second of three sittings from the 1.4.0 work order (the amended W2, W4, W5, W6 items of 2026-11-13), from `d79d049`
(Sitting A). `garden.js` changes by W0's one token and W2(i)'s optional `comps` parameter and nothing else; `compute.js`,
`csv.js`, `main.js`, `preload.js`, `app.js`, `reports.js`, `charts.js`, `index.html`, `dev.html`, `spots.js` are byte-identical
to `d79d049`. `data.version` stays 7; nothing new is written. Suites: garden **205 → 225** (+1 W0, +1 W2(i), +18 §14) ·
compute 1255 · csv 621 · migrate 17 · reports 94, 0 failed. No tag, no bump.

- **W0 — the rain barrel waits for the close (garden.js).** In `earlyFixtures` the clean-month test keys on `m.id < nowMonth`
  (the birdbath's rule) instead of `monthContext().monthDone`, so a single sown, clean month on its last calendar day grows the
  wheelbarrow only — the barrel's title says *closed*. `fundAges` keeps `monthDone` (a plant's age is about its month being over).
- **W2(i) — one `computeMonth` pass per render (garden.js).** `gardenState` builds `comps = Map<monthId, computeMonth(m)>` once
  and hands it to `fundAges`, `givingMonths`, `earlyFixtures` and `maturityFor` (which forwards it); each reads
  `(comps && comps.get(m.id)) || computeMonth(m)`, so the defaults (`null`) leave every direct call and test exactly as before.
  `gardenState` on persona B (46 months), `performance.now()` median of 9: **≈ 12.6 ms → ≈ 7 ms** (12.3 / 12.9 before, 6.6 / 7.4 after,
  two runs each). +1 test: the four walks answer identically with and without the map.
- **W4 — three early fixtures (garden-scene.js, near band, ≤ 1,024 B each).** `wheelbarrow()` 871 B at the lawn's left edge above
  the first bed's sign (x 30–72, y 162–186; the wheel's centre is HORIZON + 31, not + 34, so its rim stays at 186 and clear of
  the sign line — the only position nudged from the spec); `birdbath()` 728 B right of the path under the wall's left end
  (x 654–676, y 163–184, foot at HORIZON + 34, rim at HORIZON + 16); `rainBarrel()` 821 B standing at the fence's right end
  (x 459–473, y 132–152) with a downspout stub curving up and left to the top rail at (452, HORIZON − 13). Each is one Painter
  with two or three wash passes, `<g class="fx fx-<id>"><title>…` like every fixture; drawn from `state.maturity.early || []`
  (hand-built states have no `early`).
- **W5 — five late fixtures (garden-scene.js, far band, ≤ 1,536 B each)**, measured in Chromium with `getBBox` on the §13 scene:
  `greenhouse()` 739 B on the far hill at x 696–744, y 91–116 — its base (HORIZON − 34) sits above the wall's top row (y 120);
  `bench()` 798 B at x 745–795, y 137–170 — slab centred on (760, HORIZON + 12), legs to HORIZON + 20, the lantern post at x 790 in
  front of the stones with a **static** `<circle class="glow">` (`.glow` animates only under `.plant.st-harvest`);
  `brook()` 598 B from the pond's left edge (822) to x 640, twelve units short of the birdbath — its centreline never goes
  below HORIZON + 36 because the bed-sign band starts at HORIZON + 42 (bedsTop + 4), so the 8-wide stroke's edge (≈ 190)
  clears the signs (192); `willow()` 707 B at x 951–996 with its trunk foot at (976, HORIZON + 14) in the lawn below the wall's
  bottom row (157) and three drooping washes in front of the wall's last stones; `orchard()` 836 B — three small silhouettes at
  x 16 / 44 / 72 on HORIZON − 36, the third partly behind the border tree's crown by design. Draw order in `sceneSvg`: orchard →
  tree → wheelbarrow → hive → meadow → fence → rain barrel → arbor → greenhouse → wall → bench → willow → pond → brook → birdbath.
  **§13 with every fixture drawn: 90.5 KB of the 96 KB ceiling** (was 83.5 before this sitting; the eight fixtures add 6.1 KB
  and the sprites ≈ 0.9 KB). The wall trim was not needed and was not used. `GARDEN_MILESTONE_LABELS` already carries the five
  late ids through `MATURITY_MILESTONES`; the three early ids are Sitting C's W8.
- **W6 — wildlife tied to fixtures (garden-scene.js, styles.css).** `ambientPlan` adds, after today's kinds and before the cut at 3:
  a robin when `early` has the birdbath and `hashName(monthId) & 0x100`, a rabbit when `fixtures` has the path and `& 0x200`, a
  dragonfly when it has the pond and `& 0x400` — so a month shows at most two of the three and the pool stays capped at 3 with
  today's kinds first (a growing evening with every fixture and every bit set is `firefly+bee+robin`). The lean early return is
  untouched; a state with no `maturity` answers as before. Sprites through the existing `sprite()` helper, each with its own
  `<defs>` symbol in literal colours and no wash class: `robin-hop` 30 × 20 at (650, HORIZON + 4) on the birdbath's rim,
  `rabbit-nibble` 36 × 24 at (W / 2 + 20, height − EDGE_H − 10) at the path's foot (top 90% on the 710-unit scene — the one
  sprite outside the sky/lawn band, matched by class in §10), `dragonfly-dart` 40 × 20 at (860, HORIZON + 2) over the pond.
  CSS: `.robin-hop` robinHop 9 s steps(12) (two ±3 / −4 px hops in the last third), `.rabbit-nibble` rabbitNibble 10 s steps(12)
  (an ear twitch as a ±2° rotate, one −5 px hop mid-loop), `.dragonfly-dart` dragonflyDart 7 s ease-in-out (a figure-eight
  within ±8 × ±4 px); all three in the `prefers-reduced-motion` block. On the export copy at 2026-09-28 the robin shows in
  Dec, Jan, Feb, May, Aug and Sep, the rabbit in Dec, Mar, Apr, May, Jun and Aug, July has the butterfly alone.
- **Tests (test-garden.mjs).** §10's sprite-band check and its ≤ 3 count learn the seven class names (the rabbit must be > 60 %);
  §11's reduced-motion and slow-loop checks gain the three names; §13's label drops "before Sitting B" and its line prints the
  fixture classes found; its fixture's first history month is now clean (no overspend, nothing unassigned) so the rain barrel is
  derived there rather than forced — ages, stones and giving months are unchanged by it. New §14 (18 checks): early fixtures via
  a hand-built state, draw order, late fixtures by months tended through `gardenState` (24 / 30 / 36 / 48 / 60 / 72), the static
  bench glow, all eight classes on §13, the labels, the one filter attribute, the hit layer identical with every fixture
  stripped, the eight byte caps, and six wildlife checks whose month ids are picked by hash bit in the test. The test imports
  `computeMonth` from `compute.js` to build the W2(i) map the way `gardenState` does.
- **Verified visually** (dev server, `dist-tmp\scene-140B.html` scratch page and `dist-tmp\scene-13.html`; screens in
  `_cowork\3yr-sim\pass4\140-verify\screens-B\`): export Sep 2026, persona B Sep 2029 (greenhouse and bench, no brook), the §13
  all-on scene; every animation name is `none` with the stylesheet's own reduced-motion rules applied.

### 2026-11-13 — 1.4.0 Sitting A (W1–W3): giving funds in the engine, plant ages, giving months, early fixtures, late milestones, the meadow

First of three sittings from the 1.4.0 work order (`_cowork/work-order-1.4.0.md`, on its eight §0 defaults), from `4978a59`
(v1.3.1). `compute.js` changes by W1's two exports and their comments and nothing else; `csv.js`, `main.js`, `preload.js`,
`app.js`, `reports.js`, `charts.js`, `styles.css`, `index.html`, `dev.html` are byte-identical to `4978a59`. `data.version`
stays 7; nothing new is written (this sitting only *reads* `setup.giving` — Sitting C writes it). Suites: compute **1251 → 1255**
(+4 W1) · garden **177 → 205** (+1 §6, +14 §9c, +13 §12) · csv 621 · migrate 17 · reports 94, 0 failed. The `## 1.4.0` heading,
version bump and tag are the release sitting's.

- **W1 — `isGivingFund` and `givenIn` (compute.js).** `isGivingFund(f)`: an explicit `setup.giving` (true | false) wins; otherwise
  `rule.type === 'tithe'` — the wizard's Tithe fund is giving for free. Independent of `excludeInsights`: a quiet fund can still be a
  giving fund (Dustin's is). `givenIn(month, fund)`: net giving from one fund in one month — money out minus money back, transfers
  excluded (Invariant 11), `r2`, positive = gave. Nothing in `compute.js` calls either; Cowork's seven-function identity is unchanged.
- **W2 — ages, giving months, early fixtures, late milestones, the lean note (garden.js).** A plant's **age** is the lifetime count
  of done months the fund finished on plan *in its own month* (`fundSplit().overThisMonth ≥ −0.004`, carried-in red ignored — D-P4)
  *and* was active (planned, carry or spending non-zero — a resting month doesn't age the plant); thresholds `AGE_THRESHOLDS = [3, 9, 18]`
  → age 0–3. Computed once per `gardenState` in `fundAges`, passed into `plantFor` as a sixth argument; it sizes the base the scene
  draws, never the state. Work and quiet funds are absent from the map. `givingMonths(data)` → `{ count, months, lifetime, byMonth }`
  over every month, giving funds in counted categories, quiet ones included; a month counts when its net is > $0.004. `earlyFixtures`
  (Default 3, derived, nothing stored): wheelbarrow = some month was ever sown, birdbath = a month is closed (the tree's first step
  arrives with it), rain barrel = some done month was sown with nothing unassigned and no counted, non-quiet fund over its own plan.
  `MATURITY_MILESTONES` gains greenhouse 30, bench 36, brook 48, willow 60, orchard 72; `maturityFor` returns `early` and
  `giving: { count, lifetime, months }` beside the old shape (`fixtures` and `level` keep their meaning — early ids are not in them).
  The lean note is softened (Default 7): *A quieter season — what you manage is down from a few months ago. A big change settles over
  a season; keep tending.* — `kind: 'lean'` and the rule untouched. On the export copy at 2026-09-28: lifetime given 15,146.59 ·
  10/10 months · ages 4 / 25 / 25 / 0, matching Cowork's precheck. **Timing:** `gardenState` on persona B (46 months) went from
  ≈ 1.5 ms to ≈ 12.6 ms — three more `computeMonth` walks over every month (fundAges 4.1, givingMonths 3.4, earlyFixtures 3.0 ms);
  above the work order's 10 ms, so memoisation in `renderGarden` is Sitting C's call.
- **W3 — the meadow and the age bases (garden-scene.js).** `meadow(ids, symbols)`: one wildflower per giving month on the hill
  behind the fence, x and y and species from `hashName(id)` (x 194–446, y HORIZON−30..−10; daisy / poppy / cornflower / buttercup as
  `#mf0`–`#mf3`), drawn in `bg` before `fence()` so the pickets stand in front, fence or no fence; visible cap 36, then a `g-label`
  `+N`. Every new symbol goes into the one `symbols` map → the single `<defs>` (foreground SVG, or bitmap mode's own) — no second
  `<defs>` anywhere. **Age bases:** age never changes a plant's height or symbol; it draws a base layer under it, one symbol per
  family × age (`#a-<family>-<age>`): rowcrop a row of 3 / 5 / 7 leaf lobes either side of the mound; shrub a woody crown, then a low
  skirt, then two low branches; fruit a root flare and wider trunk base, then fallen-leaf washes, then a sucker shoot; evergreen a
  wider skirt tier, a second, then exposed roots. Width ≤ 48 units at age 3, nothing above y = −20 or below y = +4; drawn inside
  `.lift` before the plant's `<use>` (`liftMarkup`, shared by `plantMarkup` and `plantSprite`) so hover-lift and the was-* transitions
  carry it; **age 0 prints byte-for-byte what 4978a59 printed** (pinned in §12). Bases are stroke paths per wash pass, not
  `leaf()`/`stem()`: flowers ≈ 450 B each, bases 250–470 B at age 1 and 600–1,020 B at age 3. **Ceiling 80 → 96 KB** (Default 4):
  the scene has been rasterised once into a canvas since 1.2.0, so the ceiling guards raster time and the bundle, not live filter
  regions, and the §10 fixture already sat at 64 KB. §10 now 68.9 KB; the new §13 all-on fixture (72 months, 36 giving months,
  45 stones, every inside-plan plant at age 3) 83.5 KB with 23 symbols — before Sitting B's fixtures, which have ≈ 12 KB left.
- **Tests moved by design:** §5's `/roots grow deepest in winter/` → `/A big change settles over a season/`; §6's `24 → every
  milestone` → `24 → the first five; next is the greenhouse at 30` plus a new `72 → every milestone`; §10's
  `fixtures.length === MATURITY_MILESTONES.length` → `fixtures.join() === 'path,fence,arbor,pond,hive'`; and §10's live-sprite
  regex now allows the base `<use>` before the plant's (the fixture's 23 closed months age every inside-plan plant to 3).

## 1.3.1 — 2026-11-12 — importer: memo-first for type-code banks; release leads

One sitting from the 1.3.1 work order. A patch: no `compute.js`, no `garden.js`, `data.version` stays 7, no new keys, no migration. The importer no longer learns a bank's type-code Description (`DEBIT CARD PURCHASE`, `ACH CREDIT`) as a vendor when the merchant is in a memo column — it learns and matches the memo, and Reports groups those rows by memo too; a `ResizeObserver` notice no longer raises the error toast; the first-launch carry-over notice merges an unseen record and separates expense corrections from income resets; the keep-backup label rule (`[a-z0-9-]{1,40}`) is documented at the handler and both call sites; a footnote under Reports' funds table explains the transfer split; CI actions bumped to v5. Verified by Cowork from copies: 0 regressions on 5,819 stored rows, recap gate 92 / 0.

### 2026-11-10 — 1.3.1 Sitting A (W1–W6): memo-first importer for type-code banks, ResizeObserver, carry-fix merge, label rule, Reports footnote, CI v5

The only sitting of the 1.3.1 work order (`_cowork/work-order-1.3.1.md`, approved 2026-11-10 with all four §0 defaults),
from `4f1f7ee` (v1.3.0). A patch: no `compute.js`, no `garden.js`, `data.version` stays 7, no new keys, no migration.
`compute.js`, `garden.js`, `charts.js`, `preload.js`, `styles.css`, `index.html` and `dev.html` are byte-identical to
`4f1f7ee`; `main.js` differs by W4's comment line only. Suites: csv **618 → 621** (+3 W1) · reports **93 → 94** (+1 W1) ·
garden 177 · migrate 17 · compute 1251, 0 failed. Recap gate: `recap gate: 92 months, 0 differences`; `w14-replay` on the
three data copies (5,819 stored rows): 0 regressions, 0 downgrades. The `## 1.3.1` heading, version bump and tag are the
release sitting's.

- **W1 — the type-code bank: memo first when the vendor is boilerplate.** The one real defect. `tools/fixtures/22-cu-comments.csv`
  (a credit-union shape: Description is `DEBIT CARD PURCHASE` / `ACH CREDIT`, the merchant is in Comments) stores the type code
  as every row's vendor, and `buildVendorMap` learned `t.vendor` only — so from the second file on, the exact pass answered every
  `DEBIT CARD PURCHASE` row with the bank's single most frequent fund, green `ready`, ticked: 3 of 8 rows wrong on the fixture,
  silently (`typecode-repro.mjs`: `3 of 8 rows would be auto-matched to the wrong fund` before, `0 of 8` after). Not Dustin's banks
  (merchant in Description on all of his; 0 boilerplate-vendor rows in the three copies), which is why nothing showed. New
  `csv.js` export `isBoilerplate(vendor)` — every token of `normVendor()` is in `KEY_STOP` (`PAYMENT - THANK YOU` is not boilerplate,
  THANK is a word; `''` is not). **Default 1:** `buildVendorMap` learns a boilerplate-vendor row by its `description` (the memo) and
  does not index the type code at all; a boilerplate vendor with no memo (`TRANSFER TO CHECKING`) is learned as before; `learn`
  skips `bumpKey` for a boilerplate string so W14's `byKey` never carries `DEBIT` / `ACH`. `loadCsvForImport` matches a
  boilerplate-vendor row on its memo **alone** — an unknown memo stays `pick a fund` rather than inheriting the type code's fund;
  every other row keeps the vendor-then-memo order. The W14 sign guard, `check it` and W15's same-vendor follow are untouched and
  apply to the memo answer. **Default 2:** `reports.js` `vendorRows` keys and labels a boilerplate-vendor row from the same source
  string, so a type-code bank's Top vendors reads Wholefds · Shell · Netflix instead of one line `Debit`. dev.html walk on the
  export copy: the fixture imported twice → every row `auto-matched (seen 1×)` to the fund picked for *that memo*, `PAYMENT - THANK
  YOU` to what was picked for it, no row inherits a neighbour's fund.
- **W2 — the ResizeObserver toast.** Maximizing the window raised `Something went wrong: ResizeObserver loop completed with
  undelivered notifications…` (seen twice on the live 1.3.0 check). It is a benign Chromium notice, not an exception: the global
  `error` listener now returns first on `/ResizeObserver loop/`; nothing logged, `unhandledrejection` untouched. A synthetic
  `boom` error still toasts.
- **W3 — `boot()` merges `lastCarryFix`; the notice intro follows the list.** Theoretical today (every known install is v7): a
  pre-v7 file reaching 1.3.x in one boot had `migrateV7`'s expense-correction list overwritten by the boot resync's income list,
  and `showCarryFixNotice` picked the income intro when *any* change was income, so a mixed list sat under the wrong paragraph.
  `boot()` now concatenates an unseen prior record's changes before its own; the notice splits the list by kind — the expense
  paragraph, its list and the penny-rounding `<details>` first (pennies are computed from expense lines only; income carries are
  never spreadsheet pennies), then the income paragraph as a second `<p class="muted">` above a plain list. One kind present →
  exactly 1.3.0's output (the W16 copy: one income paragraph, `September 2026 — Dustin Checks: ($100.00) → $0.00`, hero $64.47).
  Both intro strings unchanged character for character.
- **W4 — the keep-backup label rule, written where the next person will read it.** No behaviour. The rule, in its own sentence:
  a `keepBackup` label is `[a-z0-9-]{1,40}` — lowercase letters, digits and hyphens only, versions dashed — and `main.js` returns
  `false` on anything else *without logging* (1.3.0's spec wrote a dotted label and the smoke build wrote no keep file). A comment
  on the `data:keep-backup` handler (the only `main.js` hunk in this release) and the same one-line comment above both
  `keepBackup(` calls in `boot()`.
- **W5 — Reports funds-table footnote (Default 4).** Under the This Month funds table, when `excludeTransfers` is on: *Fund rows
  include money moved between funds; the totals above leave it out.* — the Sitting C lead (fund rows show raw `expensed`, the
  headline honours the setting). Static text, one muted line, nothing on This Year, nothing when the setting is off.
- **W6 — CI housekeeping.** `actions/checkout@v4` → `@v5` and `actions/setup-node@v4` → `@v5` in `.github/workflows/release.yml`
  (eight refs), nothing else in the workflow. Every run since 1.2.0 warned that v4 targets Node 20; the release sitting proves the
  bump (five jobs green, no warning). If `setup-node@v5`'s cache change breaks `npm ci` on the `windows` job, revert that one bump.

---

## 1.3.0 — 2026-11-09 — income true-up at close, catch-up plans, Reports

Four sittings from the 1.3.0 work order plus W16 at release. First `compute.js` line rewrite since 1.1.1 (`leftToAllocate` counts recorded income carry; `buildNextMonth` carries only what the close decided); no `data.version` bump; seven optional keys; `carryForward` no longer read. Expense side and Left to allocate verified identical on 92 simulated months with income carry at $0; a legacy income carry is reset and listed at first launch.

Headline for the release (filled in sitting by sitting): income carry-over becomes a month-close decision (fix / late / use actual); unassigned income carries counted; Start next month is disabled while the closing month is over-allocated (D6, Invariant 17); catch-up plans for carried-in red; Reports replaces Year Overview; goal done; next charge month + already saved; vendor key fallback. `data.version` **7 unchanged**; optional keys only; `carryForward` no longer read.

**Invariants (1.3.0 wording — the project instructions carry the same four).** **#2** Left to allocate = Σ income (planned + counted carry) − Σ expense planned; a pending income carry stays out. **#6** On a new month, expense funds roll leftover → carryOver; income funds carry only what the month-close true-up recorded: a late amount (`carryPending`, outside Left to allocate), a counted amount (an unassigned surplus — only out of a month stamped `trueUp` — or a late amount the grace month gave up on), or nothing — never derived after the fact beyond that record. **#14** Savings target dates roll +12 months once passed, unless the goal is marked done; a fixed fund's `nextChargeMonth` rolls +`everyMonths`. **#17 (new)** A month cannot be started while the previous month is over-allocated after its income true-up, or while an income row is unresolved — no "anyway" for that state.

### 2026-11-09 — W16: income carries from before 1.3.0 reset at boot, listed once (the 1.3.0 upgrade path)

- **What.** `boot()` runs `resyncCarryOvers` right after the migration chain and before the first paint; when it changes anything, the
  list is stashed in `settings.lastCarryFix` (the v7 shape), the on-disk file is copied to `backups/keep-before-1-3-0-carry-reset-…json` (dashed: the main-process label check allows `[a-z0-9-]` only — the dotted label the spec named was refused silently on the smoke build, caught at the live check),
  and the Carry-over check notice lists it once with an income paragraph when any change carries `income: true`. Healthy files are
  untouched — the resync returns 0 changes on all three data copies at `20ec283`, so the notice never shows there.
- **Why.** A 1.2.x "Start next month" with the `carryForward` tick wrote `carryOver = leftover` on an income fund (never counted then);
  1.3.0's `countedCarry` counts every income `carryOver` without `carryPending`, and the resync used to run only at the first edit
  (`markDirty` / `silentDirty` / `restoreSnapshot`) — so such a file opened with Left to allocate moved by that amount and snapped back
  at the first keystroke (Cowork's repro: first open `($1,271.57)`, first edit `($611.27)`). Dustin's real file has one: Bonuses $1.19
  in October and November 2026. Nothing in `compute.js`; suites unchanged (csv 618 · migrate 17 · garden 177 · compute 1251 · reports 93).

### 2026-11-09 — Importer: vendor-key best guess with "check it", sign guard, within-file follow; Reports sentence + income months, `vendorKey` hyphens (sitting D: W0, W14–W15)

Sitting D of the 1.3.0 work order (`_cowork/work-order-1.3.0.md`, items W14–W15 — proposal #28, Default 7 — plus
W0, three fixes to Sitting C, all Cowork's spec, verified 2026-11-03 on `0c2ef8a`). The last sitting before the
1.3.0 release. `src/compute.js`, `src/garden.js` and `src/charts.js` are byte-identical to `0c2ef8a`; `data.version`
stays 7 and **no new data keys** — `viaKey` lives on `suggestFund`'s answer and `guess` on the preview row, never on
a saved transaction. Suites: csv **611 → 618** (+1 W0 c, +6 W14) · migrate 17 · garden 177 · compute 1251 ·
reports **90 → 93** (+3), 0 failed; `release-check.js` still runs five suites.
Recap gate: `recap gate: 92 months, 0 differences`.

- **W0 — three Sitting C fixes (Cowork's spec).** (a) `monthReport`'s plan-vs-reality sentence used Σ `catSpentAbs`
  while the tile used `actExpense`, so a refund or the transfer setting made them disagree (September on the
  export copy: tile $8,141.62, sentence $9,399.84). `planVsReality.spent` is now `headline.spent` and `diff`
  follows; `catRows` keep `catSpentAbs` (the gate pins them). (b) Highest / lowest income month iterate the
  **finished** months only (`doneComps`; all months when none is finished, so a one-month file still gets a
  sentence) — a month under way always read as the lowest. The trailing clause reads `— received, finished months
  only`. (c) `vendorKey` joins a hyphen between letters before `normVendor` (`WAL-MART` → `WALMART`, `T-MOBILE` →
  `TMOBILE`, `CHICK-FIL-A` → `CHICKFILA`), so `WALMART.COM` and `WAL-MART` are one Top-vendors row (September: 8 rows,
  $616.13). `normVendor` itself is untouched — the duplicate scorer and the map's exact / prefix passes keep today's
  strings.
- **W14 — the key fallback in `suggestFund` (Default 7 + the sign guard).** `buildVendorMap` keeps a second counter
  keyed by `vendorKey()` (vendor and memo-stripped form, as `learn` already indexes both) and hangs `map.byKey`
  (`key → { fund, n, share }`, the top fund and its share of every row under the key). `suggestFund` tries it only
  after the exact and prefix passes (account first) return nothing, and only when the key is decisive: **n ≥ 3 and
  share ≥ 0.8**; the answer carries `viaKey`. Nothing above that line changed — every row that matched before
  matches the same way. The importer applies the **sign guard** to `viaKey` answers before `canonicalFund`: a
  deposit never lands on an expense fund and a debit never on income (`isExpenseFund`), so the row stays
  `pick a fund`. A surviving guess prefills the fund with an amber **`check it`** badge (never the green `ready`),
  the `<select>` gets the `guess` class (amber border) and the note reads `best guess — Geico rows have gone to Car
  Insurance 13×`; picking any fund clears it. Persona A's switch to a credit union (`2027-11-21_cu.csv` on the
  `persona-a-oct2027.json` fixture): 7 guesses / 0 wrong / 3 `pick a fund` — GEICO 13×, APPLE 13×, LAKELAND 13×,
  PUBLIX 79×, COOL 36×, NELNET 13×, GOOGLE 12× guessed; `DEPOSIT FROM CHASE BANK` +$300 (key CHASE → Card Payment,
  an expense fund) and `LAKELAND FAMILY DENTISTRY PAYROLL` +$1,415 (key LAKELAND → Electricity) held by the guard;
  `NEW MEMBER BONUS` has no history. +6 csv checks (the key hit, the share gate on AMAZON 6-of-56, the n gate on a
  2-row key, exact and account passes still first with no `viaKey`, `share` 1.0 / 0.8 passes / 0.6 fails).
- **W15 — within-file follow.** Picking a fund on a preview row that had **no suggestion at all** (no note, no
  guess, no fund) applies it to the file's other such rows from the same vendor — the memo when both rows carry
  one (credit-union exports put a type code in Description and the merchant in the memo), else the vendor string,
  both through `normVendor` — skipping duplicates, card payments and rows whose month doesn't exist; each follower
  reads `same vendor as the row you set` and is ticked. Toast only when at least one followed:
  `Applied "Maya Checks" to 1 more row from the same vendor.` A guessed (`check it`) or auto-matched row isn't
  blank, so picking on it drags nothing. Nothing is written until Import, as before.

### 2026-11-03 — Reports: This Month + This Year on `reports.js`, the recap reads one source, `vendorKey`; catch-up eligibility + rounding (sitting C: W0, W8–W13)

Sitting C of the 1.3.0 work order (`_cowork/work-order-1.3.0.md`, items W8–W13 — proposal §3.2–3.6, D2 — plus W0,
two fixes to Sitting B's W5 that Cowork's own spec left open; `_cowork/research-reporting.md`; three-year report
friction A-24 and the "over in n of m" trap). `src/compute.js` and `src/garden.js` are byte-identical to `f1b8e4e`;
`data.version` stays 7 and **no new data keys** — the Reports tab, month and range live in module variables.
Suites: csv **606 → 611** (+5) · migrate 17 · garden 177 (one §11 guard re-pointed) · compute 1251 (the W5 fixture's
values moved, not its count) · **new `test-reports` 90**, 0 failed; `release-check.js` runs five suites.
Recap gate: `recap gate: 92 months, 0 differences`.

- **W0 — two W5 fixes (Cowork's spec, verified on `f1b8e4e`).** (a) A rule-bearing fund is never offered a
  catch-up plan: `catchUpEligible(f) = !f.rule && catchUpEligibleSetup(f.setup)` gates the panel button, Review's
  carried-in row, `showCatchUpModal` and `startCatchUp` — Dustin's Tithe (`basic` + `rule tithe`) keeps ⇄ only,
  so `startCatchUp`'s `f.rule = null` can no longer stop the tithe following income. (b) `perMonth` rounds **up**
  to the cent (`Math.ceil(−carriedIn × 100 ÷ N) ÷ 100`) in `startCatchUp`, `catchUpChooserHtml` and
  `wireCatchUpChooser`, so −175 over 3 asks $58.34 and the fund opens the month after the plan at **+$0.02**, not
  −$0.01 with a `carrying ($0.01)` chip that never clears. The compute fixture follows (458.34 / −116.66 / −58.32 /
  +0.02; the early-end case spends $273.34 so its carry stays +$10 exactly).
- **W12 — `vendorKey` in `csv.js`.** The Reports grouping key: the first word of `normVendor()` that isn't bank
  boilerplate (`KEY_STOP`: TFR, WITHDRAWAL, DEPOSIT, TRANSFER, CHECK, … THE). `buildVendorMap` / `suggestFund`
  are untouched (Sitting D uses the key as a fallback). +5 csv checks, including the accent fold (`Café Du Monde`
  → `CAFE`).
- **W8 — `src/reports.js` + `tools/test-reports.mjs`.** A pure module (the `garden.js` pattern: imports
  `compute.js`, `monthContext`/`stonesLaidIn` from `garden.js`, `vendorKey` from `csv.js`; no DOM, no writes).
  `monthReport(data, monthId, todayISO)` → headline (the exact `actIncome`/`actExpense`/`actDiff` arithmetic, so
  the transfer setting matches Budget and the recap), plan vs reality (planned = Σ carry + planned, spent =
  Σ `catSpentAbs`), the funds table (grouped by category, over rows first; `over` is `fundSplit().overThisMonth`,
  never raw leftover; `vsLast` / `vsAvg` as ±$; the average uses only **finished** months in the trailing 12,
  never the report month, and is null with fewer than 2), the income table (`carryPending` carried through),
  What changed (≤ 3: biggest own-month overspend with "over in n of the last m" counted over the previous ≤ 4
  finished months the fund was in, biggest underspend — savings funds excluded, not spending is their job —
  and the biggest single expense transaction), top 5 vendors by `vendorKey` (transfers out via `isTransferTx`,
  refunds reduce the total, label = the most frequent raw string's first word, title-cased), what rolled forward
  (the next month's stored carries when it exists, else `buildNextMonth`; income carries as pending / counted),
  and the recap's `wins` / `catRows` / `catsUnder`. `yearReport(data, range, todayISO)` with
  `{ kind: 'year', year } | { kind: 'last12', uptoId }` → headline with savings rate (net ÷ income) and AUM change
  (first vs last snapshot in range, ≥ 2), by-month nets, ranked categories with % of total, the category × month
  grid (≤ 12 columns + Total + Average, average over finished months only), planned vs spent per fund with
  `Over in n of m` (finished months only, the fund's own month), top 10 vendors, biggest 5 transactions,
  highest / lowest income month (received), `fundHistory(name)` including income funds, and three year wins
  (`N of M months fully allocated`, `<fund> on plan n of m months`, `<fund> grew $X`). Work (`excludeFromTotals`)
  is out of every headline, ranking and average; it still appears in the funds table and the grid, marked.
  `compute.js`'s `monthAdd` is forward-only, so the module carries its own two-way `addMonths` for the trailing
  windows. **The suite runs on a synthetic three-month fixture built through `buildNextMonth`** (two counted
  categories + Work, two income funds with one pending carry, a cross-category transfer pair, a refund, one vendor
  under two raw strings, a fund over on its own in month 2 and carrying into month 3) plus a 14-month fixture for
  the ≤ 12-column rule — not the seed, so it runs in CI where the compute suite can't. 90 checks.
- **W11 — the recap reads `monthReport()`.** `showMonthCloseWorkflow`'s inline category table, pacing wins,
  matured goals and wins list are gone; it renders `rep.wins` as `icon(…ICON[kind]) + ' ' + esc(text)` with
  W6's Done / Again pair attached to `kind === 'goal'` lines by `w.fund` (`findExpenseFund`). The hit-its-goal
  line keeps `icon('target', 'goal reached')` through a `hit` flag the module sets — no string is re-parsed.
  Everything else in the modal (Income check, unassigned line, vignette, `recap-stats`, baskets, carried-in
  list, AUM stone text, import lapse) is where it was. Cowork's gate (`recap-gate.mjs` against the f1b8e4e
  baseline, 92 months of three files) prints 0 differences on `catRows`, `catsUnder` and every win's text.
- **W9 — This Month.** `renderReports` is rewritten: two tabs (`reportsTab`), `◀ Month ▶` within `data.months`,
  default = the most recent finished month. Headline in the `recap-stats` block with the `*` transfer note; the
  plan-vs-reality sentence (`(incl. … carried in)` only when the carry sum is positive); the funds table grouped
  by category with Fund · Planned · Spent · Left · vs last month · vs your average (`neg` on over rows only, no
  chips); the income table with the muted `pending` word; What changed as links (fund → Budget with
  `budgetFocus` on that month; transaction → Transactions filtered to the fund); top 5 vendors (click → Transactions
  with `txSearch` = the label); What rolled forward (`$X carried into October across N funds · k carried
  negative: Fund ($41.00), …` — `money()` parentheses, one pair; the income line `$2,000.00 expected from
  September, pending` / `+$64.47 unassigned carried into October on Dustin Checks`, absent when nothing
  carries; a note when the next month doesn't exist yet and the carries are computed); Wins with the recap's
  icons, no buttons.
- **W10 — This Year.** Range selector: the calendar years present + `Last 12 months`; default the current
  calendar year (the latest year present when the data has none of it). Headline tiles Income · Spent · Net ·
  `Savings rate · net ÷ income` · `AUM change` (when ≥ 2 snapshots fall in range); income vs spending by month
  with each month's net written under its pair; where the money went with `% of total`; the category × month
  grid scoped to the range (≤ 12 columns + Total + Average; `·` for a month without the category, `—` for zero;
  `Income received` and `Net` rows as before; a `*` on a month still under way). **The grid prints whole dollars
  with cents in each cell's tooltip** — 12 months + Total + Average at the compact size did not fit 1,144 px
  with cents (A-24), and the cents live in the fund tables anyway. Planned vs spent per fund (Fund · Category ·
  Planned Σ · Spent Σ · Difference · Over in n of m months, sorted by over-in desc then name, the work order's
  copy line under it; a fund name opens its history); top 10 vendors; biggest 5 transactions (click → that
  month's Transactions filtered to the fund); highest / lowest income month (received); Fund history including
  income funds, scoped, with the planned line over the bars and an `Own month` column (over / under / on plan)
  so "over in n of m" can be hand-counted; wins for the year. The `multiYear` short-label rule (`Dec '25`) stays.
- **W13 — nav, charts, styles.** Sidebar `Year Overview` → `Reports` (icon unchanged) in `index.html` and
  `dev.html`; the Settings transfer copy and two comments say Reports. `charts.js` `groupedBars` gains
  `plannedLine` (a 1.5 px polyline in the s1 ink at planned, included in the scale) and `sublabels` (a second
  x-label row — the least code for the net-under-each-month label); `barList` / `lineArea` untouched.
  `styles.css` adds `.report-tabs`, `.btn.sel`, `.report-range`, `.report-sentence`, `.callout`,
  `.report-table` (category rows, `over` rows), `.report-grid.dense` and `.section-body` / `.section-note`, all on
  the existing tokens. README names Reports where it named Year Overview.
- **Leads, not changed.** (1) With the transfer setting off, the plan-vs-reality `spent` (Σ `catSpentAbs`, the
  recap's arithmetic, per the work order) can exceed the headline's Spent: a category whose month nets to money
  in (a big transfer into Savings) is counted by its absolute value. With the setting on — Dustin's file — the two
  agree ($7,474.62 in September). (2) `vendorKey` keeps "WALMART.COM" and "WAL-MART" apart (`WALMART` vs `WAL`),
  by design; the label follows the raw string (`Walmart.com`). (3) The acceptance guess "top 5 vendors begin
  with Walmart/Amazon/Publix" doesn't hold on September's export copy by total: the mortgage (`Imt`, $3,280.62)
  and the tithe ($1,167.70) come first, then `Walmart.com`, `Wal-mart`, `Sams`.

### 2026-11-01 — Catch-up plans, goal done, next charge month; late-over and truedUp touch-ups (sitting B: W0, W5–W7)

Sitting B of the 1.3.0 work order (`_cowork/work-order-1.3.0.md`, items W5–W7 with §0 Defaults 4–6, plus W0 —
two Sitting A touch-ups from Cowork's second look at `e2e401a`; three-year report "The bigger story" / Option C,
wishlist #10, #15, "What Dustin would change" 11; friction A-18, A-20, B-09; re-run 1.2.1 B §5 lead 3). All three
items live in `autoPlanned` and `buildNextMonth`, so `autoPlanned` is restructured into one `auto` variable with
the catch-up add-on at the bottom; **no existing number moves**: `autoPlanned`, `buildNextMonth` and `fundFlags`
are identical before/after on every fund-month of the export copy (514, incl. the 24 fixed funds — Car Insurance
$552.74, iDrive $7.60) and both personas (794 + 2526). Three new optional setup keys, all absent from existing
files: `setup.catchUp = { base, perMonth, until }`, `setup.done` (bool), `setup.nextChargeMonth` ('YYYY-MM').
`data.version` stays 7. **Invariant 14 now reads:** a goal's `targetMonth` rolls +12 months when the month passes
*unless the goal is done*; a fixed fund's `nextChargeMonth` rolls +`everyMonths` once the charge month passes.
Suites: csv 606 · migrate 17 · garden 177 · compute **1205 → 1251** (+46), 0 failed.

- **W0 — touch-ups.** `incomeTrueUp`: a late-marked fund whose money then came in *over* is no longer "resolved"
  (`resolved = |diff| ≤ 1 || (lateAtClose && diff ≤ 1)`) — the row stays open with `Use actual` / `Not late
  after all`, the gate reads `Resolve 1 income difference first`, and after `actual` planned = $4,500 with Left
  to allocate +$500 (it was silently orphaned before). `truedUp` is now cleared wherever planned is typed (grid
  and panel) and on the panel's Reconnect, so a row never shows `set by hand` *and* `trued up to $X at close`,
  and Reconnect really reconnects (`applyChecksRules` skips `truedUp` funds).
- **W5 — "Make it back over N months" (Option C, Default 4).** On a Basic, Pacing or Build-up fund with
  `carriedIn < 0`, Review's carried-in row and the fund panel's Actions offer `Make it back…` → `Add [$58.33] a
  month for [3 ▾] months (1 · 2 · 3 · 6 · 12). Left to allocate drops by $58.33 while it runs.` → `Start` writes
  `setup.catchUp = { base, perMonth: r2(−carriedIn / N), until: monthAdd(month, N − 1) }` on this month's setup
  (Inv 8 — `buildNextMonth` copies it); `base` is today's planned for Basic/Pacing (a typed override becomes the
  base; a paused fund's base is the plan it paused), `null` for Build-up (its own auto). `autoPlanned` adds
  `perMonth` on top of the auto (Build-up) or `base` (Basic/Pacing) through `until` — it does not read the carry,
  so S7's resync never re-derives planned on a plan (tested). `buildNextMonth` drops the plan on the month after
  `until`, or early on the first month that opens with the carry ≥ 0, restoring `base` (Basic/Pacing) or the
  fund's own auto. Chips: `making back` (`chip-muted`, beside `carrying`, which stays until the carry is ≥ 0) with
  `Making back $X — $base + $perMonth a month through Mon YYYY.`; the type mark of a Pacing/Build-up fund says
  the same; the Review row reads `Carrying ($X) · making back $Y/mo`; the panel shows `making back $Y/mo · N
  months left` + `Stop the plan` (deletes the plan, planned back to base). A re-typed planned shows `overridden`
  as usual (Inv 13). Starting a plan can push Left to allocate below −$0.02 — the hero goes red and D6's gate
  reads `Fix $X over-allocated first`; that is the decided behaviour and the chooser's last line says so.
  `readSetupForm` carries `catchUp` (and `done`) over from the fund's current setup, so editing any other setup
  field never drops a plan.
- **W6 — goal done (#15, Default 5).** A target-mode goal can be marked done: the recap's matured-goal line gets
  `Done — stop asking` · `Again next year` (Again only hides the pair — today's roll), and the panel's Actions
  `✓ Goal done` / `Set a new target` (toggles `setup.done`). Done writes the flag on this month's setup only;
  this month's planned is left where it was (changing it at close would move money between months). From then
  on `autoPlanned` is 0 (and a done goal never gets a catch-up add-on), `buildNextMonth` does not roll
  `targetMonth`, and `fundFlags` offsets the leftover once the month is over (S12 rule (a) still gates on
  `monthDone`). `goalAskWords` leads with `Goal done — $T by Mon YYYY. $X still here; transfer it where it's
  needed, then remove the fund.` (`Nothing left — the fund can be removed.` at $0); a `goal done` chip
  (`chip-muted`) replaces the ask and the `overridden` chip. The wizard's Christmas/Vacation goals are never
  auto-done. (Editing another setup field on a done goal re-derives this month's planned to $0 — the existing
  "setup change wins" path.)
- **W7 — next charge month + already set aside (#10, Default 6) + lead 3.** `setupFormHtml`'s fixed row gains
  `· next charge [month]` when `everyMonths > 1` (shown/hidden live as the cadence changes); `readSetupForm`
  stores `nextChargeMonth` (null at a monthly cadence or when blank). With it, `autoPlanned` plans like a goal:
  `max(0, total − carryOver) ÷ months to the charge, inclusive` (the `savingsMonthly` convention); without it,
  `total ÷ everyMonths` exactly as before. `buildNextMonth` rolls it +`everyMonths` once the charge month passes.
  In the panel an existing fixed fund's picker is **blank** (not defaulted to next month) so touching another
  field can't silently change its formula; the add dialog defaults it to next month. The add dialog's expense
  side gains `Already set aside: $[ ]` for Fixed and Goal behaviours — the value becomes the new fund's opening
  `carryOver` and feeds the previewed monthly (`wireSetupForm` now reads `opts.carryOver` on every refresh).
  Type mark and result line share one sentence: `Fixed recurring — $220.00 every 12 months, next due Nov 2026,
  $100.00 already set aside, so $40.00 a month.` **Lead 3:** a fixed fund whose largest charge this month is
  ≥ `totalAmount − 0.02`, red, with no bill-went-up, titles its `over $X` chip `This cycle's charge posted; the
  fund was $X short of it — rounding over the cycle, or a cycle that started late.` (`cycleChargePosted` beside
  `billWentUp`; `fundStatusChip` takes it as a third argument).
- **Tests** (`test-compute.mjs`, new section `1.3.0 sitting B`): Basic −175/400/N=3 → 458.33 ×3 then 400 through
  `buildNextMonth`, early end at +10, typed value on the last month doesn't outlive the plan, Pacing; Build-up
  −120/50/N=2 → 110, 110, 50, and the add-on on a capped Build-up; S7 resync on a plan carries no `plannedTo`;
  done goal → 0, no roll, offset false mid-month / true at month end, not-done roll unchanged; `nextChargeMonth`
  73.33 / 12.08 / 40 / in-month remainder / fully set aside → 0 / no monthId, the two Dustin-shaped fixtures
  unchanged (552.74, 49.83), rolls +12 and +3; W0 late-over open → actual → +500, late-short and late-landed
  unchanged.

### 2026-11-01 — Income true-up at close, D6 start gate, import nudge (sitting A: W1–W4)

Sitting A of the 1.3.0 work order (`_cowork/work-order-1.3.0.md`, items W1–W4; proposal §3.0 I1, D5, D6;
three-year report S15, S20, "What Dustin would change" 5/6/14, wishlist #27; friction A-16, A-19, A-32, B-02,
B-03, B-07). The first `compute.js` change that **rewrites** a line rather than adding one — `computeMonth`'s
`leftToAllocate`. Expense side untouched: `categories`, `totals` and `leftToAllocate` byte-identical on all 92
months of the export copy and both personas, `resyncCarryOvers` → `[]` on all three
(`_cowork/3yr-sim/pass4/i1-precheck/i1verify.mjs`: identity 377 ok, 0 bad · worked table 401 ok, 0 bad).
New optional keys, all absent from existing files: income fund `carryPending`, `lateAtClose`, `truedUp`; month
`trueUp = { at }`. `carryForward` is no longer read or written (left in old data; next real version bump strips
it). Suites: csv 606 · migrate 17 · garden 177 · compute **1147 → 1205** (+58; the two old `carryForward` resync
checks are replaced one-for-one), 0 failed. `test-compute.mjs` now prints the whole-suite total as its last line.

- **W1 — the engine.** `leftToAllocate = Σ income (planned + (carryPending ? 0 : carryOver)) − Σ expense planned`
  (counted, non-Work); new summary field `countedCarry`. Income carry into the next month is exactly one of three
  recorded things, from the new `incomePlanFor(prev)`: **pending** (prev's fund marked `lateAtClose` and still
  short — negative, outside Left to allocate, one month's grace), **counted** (prev's Left to allocate at close on
  the first Standard fund that isn't late — Default 1 — or a late amount the grace month gave up on), or **0**.
  The surplus carries only out of a month stamped `trueUp` by `createNextMonth`, so nothing already in a file
  moves on upgrade (Dustin's Aug $26.39 / Sep $64.47 stay where they were). `buildNextMonth` and
  `resyncCarryOvers`' income loop both read that helper and agree by construction; the resync leaves alone a
  pending carry the user resolved in the grace month (`carryPending: false`, written explicitly). New
  `incomeTrueUp(month, comp)` — one row per income fund off its plan by more than $1 (`diff` = received − planned,
  or the whole leftover when a late carry is pending), with `options` fix / late / actual and `resolved`. New
  `setIncomeActual(month, fund, { mode })` — Default 2/3: `fix` → planned := received, a pending carry becomes
  counted; `actual` → planned := received (+ carry when pending — it landed); a checks-rule fund is written
  directly and marked `truedUp`, its per-check estimate moving only when `variable` and deposits === count.
  `applyChecksRules` skips a `truedUp` fund. `fundDeposits` moved from `garden.js` into `compute.js`
  (re-exported from `garden.js`, callers unchanged).
- **W2 — the close workflow.** New first section **Income check**: `Fund · Standard|Extra planned $X · received $Y
  · $D under|over` with `Fix the plan — set it to $Y` / `It's late — carry $D into Next` / `Use actual — set it to
  $Y`; grace month `Fix the plan — count Prev's $C against Left to allocate` (no late button); a late-marked row
  `marked late — carries ($D) into Next, pending` + `Not late after all`. Each click writes the decision, re-runs
  `applyTitheRules` only (not `recalcRules`), `markDirty`, `render`, and re-opens the modal; W10's tithe toast
  fires when a Bonus-group fix moves the tithe. Then the unassigned line: `$X of Month's income isn't assigned to
  a fund. It carries into Next on Host, counted toward Left to allocate.` **Start button (D6):** enabled only when
  every row is resolved and `leftToAllocate ≥ −0.02`; otherwise disabled reading `Resolve N income difference(s)
  first` or `Fix $X over-allocated first`, with an `Open Budget` link beside it. `… anyway` survives only for
  attention / available-to-move items. `createNextMonth` stamps `last.trueUp = { at }` before `buildNextMonth`
  and guards the same two states (toast + return). A month that hasn't begun keeps 1.2.1's `Create … anyway`
  path: no Income check, no gate — its income can't have arrived. Hero note: `· incl. $X carried from Prev` /
  `· ($X) counted from Prev's late income` when `countedCarry ≠ 0`.
- **W3 — rows and panel.** The `Carry leftover into next month` checkbox, its handler, the `↷` mark and
  `carryForward: false` in the three constructors are gone (`grep carryForward src/*.js` → nothing). Income row
  carry cell: pending → amount + `pending` (`Expected from Prev — it hadn't arrived when Prev closed. Stays out of
  Left to allocate until it does.`); counted → `carried in · counted` / `counted` with matching titles. Leftover
  title while pending and short: `$X still expected from Prev`. Caption on a trued-up fund `· trued up to $X at
  close`; a closed month's late-marked row gets a `late` chip. Panel: `expected from Prev — pending` under Carry
  over; `#pnlIncCalc` on a trued-up fund: `Planned this month: $X · trued up at close — the paycheck fields drive
  next month, not this one.` `applyActualChecks` (mid-month "Use actual": estimate = average of deposits, count
  unchanged) is deliberately **not** the close-time rule and is untouched; its comment says so.
- **W4 — #27.** Above the Income check, when the file has ever been imported into and the newest imported row is
  more than 7 days before the closing month's last day: `Your newest imported transaction is dated Mon D, YYYY. If
  the bank has more for Month, bring it in first — the recap below doesn't know about it yet.` + `Import CSV…`
  (closes, opens the importer). Rows imported before the `source` stamp only have an account; for those the
  newest transaction in the closing month stands in. One line, never a block.

**Invariants.** #2's Left-to-allocate clause → `Σ income (planned + counted carry) − Σ expense planned`.
#6 → expense funds roll leftover → carryOver; income funds carry only what the close recorded: a late amount
(pending, outside Left to allocate), a counted amount (an unassigned surplus, or a late amount the grace month
gave up on), or nothing — never derived after the fact beyond that record. **#17 (new)** → A month cannot be
started while the previous month is over-allocated after its income true-up, or while an income row is
unresolved.

**Known behaviour change, stated plainly:** a month that closes with unassigned planned income now opens the
next month with that amount carried in, counted (Default 1) — starting with the first month closed under 1.3.0.
On Dustin's file that would have been $26.39 → September and $64.47 → October.

---

## 1.2.1 — 2026-10-31 — carried-in split, Batches 4 + 4b

Two sittings from the 1.2.1 work order: the three-year simulation's Batches 4 and 4b — red is split into "over" (this month) and "carrying" (inherited), with no change to the numbers — plus wishes #12, #13, #17, #23, #24 and the B-16 chip. First `compute.js` change since 1.1.1, additive only (`fundSplit`, three `fundFlags` fields, S12 offsets, one `buildNextMonth` line); no data.version bump; one optional field added (`fund.pausedPlanned`). `computeMonth` verified byte-identical on 82 simulated months.

### 2026-10-31 — Bill went up, goal arithmetic in words, tithe preview, overdraw warning (sitting B: W7–W11)

Sitting B of the 1.2.1 work order (`_cowork/work-order-1.2.1.md`, items W7–W11; three-year report S14; pass-3
friction A-11, A-20, A-36, A-37, B-04, B-05; wishes #12, #13, #23, #24). `src/app.js` only, plus one §11 source
guard in `tools/test-garden.mjs`. Copy and one dialog guard — no engine change, no new data field, no
`data.version` bump. Nothing here writes `planned` or `carryOver` except the user's own W7 click.
Suites: csv 606 · migrate 17 · garden **176 → 177** · compute 1147, 0 failed.

- **W7 — S14, the bill went up.** A fixed fund that's red because this month's largest charge came in above
  `setup.totalAmount` no longer reads as overspending. Panel note under the numbers: `The bill came to $X — $D more
  than the $T this fund was set up for.` and a one-click offer, `Update the total to $X and top up $S from… ▾`
  with a fund picker (`fundOptions` with the leftover map) defaulting to the first expense fund that can cover the
  top-up outright — so the direct `pushTransferPair` never overdraws (W11's warning lives in the dialog, not on
  this path). The click sets `totalAmount` on *this month's* setup object (`buildNextMonth` copies it forward,
  Invariant 8), posts the matched pair with note `top-up` (Invariant 11), one `markDirty`, one toast. No fund can
  cover it → `Update the total to $X` alone, and the note ends `— the $S shortfall carries to next month.` The
  row's `over` chip title becomes `This cycle's charge was $X against $T set up — the bill went up. Open the fund
  to update it.` Planned stays as it was (this cycle's bill has posted; the new total drives next cycle), so the
  fund shows `overridden` for the rest of the month — true, and the panel line says why (W9). Transfers out are
  not "the charge". **No $1 rounding floor** — decided against (D-P4 "no penny floor").
- **W8 — #13, the goal's ask in words.** New `goalAskWords(f, monthId)` reads `autoPlanned` and decomposes it
  without re-deriving or writing anything back: `$58.33 = $50.00 toward the goal + $8.33 a month to make back
  $100.00 from before, over 12 months.` (also the "already saved" and "already set aside" variants). Shown in the
  ◎ type-mark tooltip (`Savings goal — $600.00 by Dec 2027. …`) and in the panel's setup result line for a goal.
  `monthDiff` is now imported from `compute.js`. test-garden §11 guards the sentence and the no-write-back.
- **W9 — #12, where the goal lands (and A-20).** Sitting A's `goalProjection(f, monthId)` hook is filled in: a
  goal overridden below its ask says `At $150.00 a month you'll have $1,200.00 of $3,000.00 by Mar 2028 —
  $1,800.00 short.` (`landing = max(0, carryOver) + planned × months`; a negative carry counts from zero and adds
  `after making back $X`); overridden above says `…you'll reach $T about N month(s) early.` or nothing. Appended
  to the `overridden` chip title. The panel result line now leads with the user's number when it overrides the
  setup: `Planned this month: $150.00 — you set it; the goal asks $407.14. <projection>` (fixed/build funds get
  the same lead with "the setup asks"; a paused fund keeps today's line — W6's button already says so). Only
  while the form still shows the saved setup; mid-edit the ask is what's moving. Nothing in the grid cell.
  **Fixed before release (2026-10-31):** the under-the-ask landing is now `net = carryOver + planned × months` — what
  the fund actually holds — so a carried-in deficit is paid back first instead of counted from zero. `net ≤ 0` reads
  `At $0.00 a month you'd still be $542.17 behind by Mar 2029, with nothing saved toward $2,500.00.`; otherwise the
  parenthesis `($542.17 of what you put in goes to making back what was carried in)` replaces `after making back`.
- **W10 — #24, the tithe moves in the open.** Panel, income fund, while the month has a `rule.type === 'tithe'`
  fund: `#pnlIncCalc` gains `· tithe becomes $X` on every keystroke in Planned, computed on a `structuredClone`
  of the month with the typed planned applied the way `onchange` will apply it and `applyTitheRules` run; shown
  only while it differs from today's tithe. After every commit that can move the tithe — grid income planned,
  panel planned, Exempt, the per-check fields — Σ tithe-rule planned is captured before and after `recalcRules`
  and, if it moved by more than a cent, `Tithe moved $1,167.69 → $1,431.69 with that change. Ctrl+Z undoes both.`
  (one `markDirty`, so one undo really does revert both — verified). Rides in the same toast as the W2d "set by
  hand" note when both apply. A month with no tithe-rule fund says nothing.
- **W11 — #23, the overdraw warning.** The Transfer dialog's `#tGo` checks the "from" fund's leftover (the
  `leftoverMap` it already builds for the option labels, so income funds warn too) after the amount/date checks
  and before the S5 month block. Overdraw → `#tErr` switches to `.modal-warn` with `"Safety Net" has $1,440.00
  left. Taking $4,531.37 out leaves it $3,091.37 short — the money has to come from somewhere later.` (already
  red: `"X" is already $A short. Taking $B out leaves it $C short.`), the button becomes `Transfer anyway`, and
  the (from, amount) pair is remembered; the same pair's second click goes through, changing either resets.
  Default 3: warn and ask, don't block. A transfer that doesn't overdraw is one click, as before.
- **Verified in `dev.html` on copies of the persona files:** A Jan 2027 Christmas tooltip and panel line (W8);
  A Sep 2027 Baby chip title and panel (W9, exact sentence); A Apr 2029 Safety Net $1,440.00 → $4,531.37
  (`$3,091.37 short`, then `Transfer anyway` moves it), Everything Else already $119.80 short → `$219.80 short`,
  a $10 transfer with money to spare → one click (W11); B Sep 2026 `Claude` ($100 charge against a $20 total,
  carry −$80.69) → note, offer from `Extra`, click leaves it at $0.00 with the ↻ tooltip reading $100.00 (W7);
  B Mar 2027 Bonuses: Exempt off → `$1,167.69 → $1,431.69`, panel preview `tithe becomes $1,442.69` at 2500,
  grid 2400 → `$1,442.69 → $1,431.69`, Exempt on → `$1,431.69 → $1,167.69`, Ctrl+Z reverts both (W10).
  **Note for Cowork:** B *Oct* 2026 `Claude` doesn't trigger W7 — its charge ($20) equals the total; the −$100
  there is carried in from Sep's $100 charge. Likewise B Jan 2027 iDrive's −$7.61 is the $99.50 charge against a
  $99.50 total (rounding of 12 × $8.29), not a raised bill.

### 2026-10-31 — Carried-in split, free-to-move rule, chip block, Review/recap/garden split, pause this month (sitting A: W1–W6)

Sitting A of the 1.2.1 work order (`_cowork/work-order-1.2.1.md`, items W1–W6; three-year report "The bigger
story", S12, S16, overlap table; Option B decided 2026-10-05). `src/compute.js`, `src/app.js`, `src/garden.js`,
`src/styles.css`, `tools/test-compute.mjs`, `tools/test-garden.mjs`. **First `compute.js` change since 1.1.1,
additive only, in three places. No data.version bump, no migration.** One optional field added,
`fund.pausedPlanned` on an expense fund inside one month, ignored by every migration.
Suites: csv 606 (unchanged) · migrate 17 (unchanged) · garden **156 → 176** · compute **1091 → 1147**, 0 failed.

- **W1 — the carried-in split (the big story).** One test, `leftover < 0`, used to drive the row chip, Review,
  the recap and the garden, so a fund that inherited −$829 and spent exactly its plan read "over $829" all
  month. New export `fundSplit(f)` → `{ own, carriedIn, overThisMonth, carriedOnly }`, computed from the three
  numbers the engine already produces. `fundFlags` entries gain those four fields plus `budget` (this month's
  own money); `attention: 'exceeded'` now means *this month overspent its own plan*; pace judges
  `max(carryOver, 0) + planned`, so a −$200 carry no longer makes steady spending "off pace" all month; a
  carried-only fund gets an entry with `attention: null` so the surfaces can say "carrying". `computeMonth`
  untouched (the new test serialises it before and after `fundFlags`); Cowork verifies byte-identity on the two
  persona files.
- **W2 — S12 rule (a).** A Basic or Pacing fund is "free to move" only once the month is done; a savings goal
  only once its target month is over; Fixed keeps the one-charge rule. No $1 floor (decided). The free chip's
  title and Review's "Available to move" line are type-aware.
- **W3 — the chip block.** `fundChips` = rule chip + type mark + ONE status chip (over · off pace · $X free ·
  on-pace dot) + modifier chips in order: `carrying ($X)` (muted) · `paused` (warn) · `overridden` (warn) ·
  `full` (muted, a build-up pot at its cap). Fixes A-29/B-08 (overridden hidden behind over) and B-16. `over`
  reads `overThisMonth`; its title names the carried-in amount when there is one. Hook `goalProjection()`
  returns `''` until sitting B's W9. `.rule-chip + .rule-chip` gets a 4px gap.
- **W4 — Review, the total line, the recap, S16.** Needs attention = this-month overs and off-pace only, rows
  read `Over by $overThisMonth`. New Review group **Carried in from earlier months** (`Carrying ($X) · this
  month on plan / $Y under plan / $Z over`), after Needs attention, counting as ONE in the Review badge. Under
  the month-head stats: `($X) of earlier overspending is still on the books across N funds · Review`. The
  recap splits the same way (`Carried in from earlier months (n) — ($X) in all`); "Start X anyway" still keys
  on `attList.length || offList.length` — carried-in red is not a reason. S16: a matured goal that was spent
  past what it saved reads `"X" matured — $spent spent against $saved saved` (neutral); met and unspent still
  says "enjoy it!".
- **W5 — the garden follows this month.** At close a plant blooms when it isn't red *or* when its red only came
  in from earlier months and this month stayed inside its plan (`fundSplit().own ≥ 0`). Wilting caption `Over
  by $X this month — a transfer covers it.`; every carrying plant's tooltip (and the quiet states' caption)
  ends `· carrying ($X) from before`; plants carry `overThisMonth` and `carriedIn`. Garden status line adds
  `N carrying from before`; new message `kind: 'carried'` (after thirsty, before harvest; neutral border
  `.msg-carried`); the wilting message totals this month's overspend.
- **W6 — #17 Pause this month.** Fund panel → `⏸ Pause this month` on an expense fund that isn't retiring:
  `pausedPlanned = planned; planned = 0; rule = null`, one `markDirty` (Ctrl+Z restores both), toast
  `"X" paused — $Y comes back when you start <month>.`; `▶ Unpause — put $Y back` restores. `buildNextMonth`
  uses `pausedPlanned ?? planned` and never copies the field; a fund with a setup gets its auto amount as
  always (Invariant 13). Typing a non-zero planned into a paused fund unpauses it.
- **Tests.** test-compute: new 1.2.1 section (the six W1 rows × 6, the gate, pace on/off, computeMonth
  before/after, S12 rule (a) per type incl. the four-cent case, pause ×6). test-garden: §1 `Electric` and §7b
  `C`/`D` fixtures moved to `fixed` so they keep asserting the one-charge rule where it still applies; §1's
  wilting caption and §7b's wilting total take the new "this month" wording; new §1b (rule (a) per type) and
  §1c (carried in: Rent/Groc/Gas); §11 guards that the recap has `matured — ` and no surface reads
  `money(-x.leftover)` any more.
- **Decisions recorded, not re-opened:** Option C (catch-up plan) → 1.3.0 I1; perennials ignore carried-in red
  → 1.4.0 reads `fundSplit().own`; no penny floor; carried-in red never triggers "Start anyway".

## 1.2.0 — 2026-10-26 — quick wins, Batch 5

Twelve small things from the post-1.1.0 roadmap and the three-year simulation's Batch 5, shipped as three sittings (A, B, C below). No data.version bump; no migration; three optional fields added (`settings.accountNames`, `settings.lastExportAt`, `fund.retireAtClose`). `view === 'import'` is aliased to Transactions for this release and goes away in 1.3.0.

### 2026-10-26 — Move and remove, AUM still right, six-letter vendor keys, UI fixes (sitting C: W9–W12)

Sitting C of the 1.2.0 work order (`_cowork/work-order-1.2.0.md`, items W9–W12; three-year report S13,
S18, S11 and roadmap Q5). `src/app.js`, `src/csv.js`, `tools/test-csv.mjs`, `src/index.html`,
`src/dev.html`. **No `compute.js` change, no data.version bump, no migration.** One optional field added,
`fund.retireAtClose` on an expense fund inside one month, ignored by every migration and by
`buildNextMonth`. Suites: csv **606** (599 + S11's seven) · garden 156 · migrate 17 · compute 1060
(1091 with the real-export sections), 0 failed.

- **W9 — remove a fund in one step (S13; friction A-31, B-15; Call 3 decided as option a).** Fund
  panel → Remove on an expense fund opens one dialog: `Remove "Discovery +"` · `It has $9.99 left. Move
  it to [Extra ▾] so nothing is lost.` · `Past months keep it. This month's transactions keep its name.`
  · `[Cancel] [Move $9.99 and remove]`. The move is a transfer pair — `pushTransferPair()` is now the one
  place the `Transfer to X` / `Transfer from Y` rows and `isTransfer` are written, shared with the
  Transfer dialog (Invariant 11; S4's typed-twin dedupe keys on those strings) — dated like the Transfer
  dialog's default (today inside the month, else the 1st). An overspent fund reads `It's $5.00 over.
  Cover it from [Extra ▾]` / `Cover $5.00 and remove` (the pair runs the other way). A $0.00 fund with no
  rows reads `Remove` and goes now. **A fund with transactions this month — always true once the pair
  posts — stays until the next month starts:** `compute.js` treats a row whose fund isn't in the month
  as unassigned and drops it from every total, so removing the fund outright would orphan the −$9.99 leg
  and move the hero's Spent. Instead `f.retireAtClose = true`; the Budget row shows a `removing at
  September 2026` chip (`removed at …` once that month exists), the panel's Remove becomes `Keep it
  after all`, the fund is left out of `fundOptions` (new Transactions rows, the Transfer dialog) unless
  it's the row's current value, and the importer's auto-match never suggests it. The import preview's
  per-row picker lists it as `Discovery + (removing)` so a late bank row can still be placed on it by
  hand — the work order's acceptance asks for exactly that and the spec's "left out of pickers for new
  rows" was read as *never suggested, never the default*. Toast: `"Discovery +" goes away when you start
  September 2026.` **At month start** (`createNextMonth`) every retiring fund that closed at $0.00
  (±0.004) is dropped from the new month; one that closed off zero stays, flag cleared, and the toast
  says why: `September 2026 created. "Discovery +" had activity after you removed it, so it's still here
  — ($4.99) left.` The closed month keeps the flag as its record. Income funds keep the old guard. One
  `markDirty` per removal: Ctrl+Z undoes pair and flag together.
- **W10 — confirming an unchanged AUM value clears "stale" (S18; P2, B-11; wish #22).** Typing the same
  value back used to return before `updatedAt` was set, so the only way to clear a 510-day chip was to
  change the number by a cent. Now it counts as checking: `updatedAt` = today, today's snapshot upserted
  (same-day snapshots replace each other — confirming 16 items adds one), log line `checked, unchanged
  ($300,000.00)`. Each row has a `✓` (`The value hasn't changed — mark it checked today`) and each list a
  `Mark all checked` button: one log line (`all 3 assets checked`), one snapshot, one undo step.
- **W11 — vendor learning: six-letter prefix keys, account-aware (S11; R5, B-M07, F5).**
  `suggestFund`'s prefix fallback had no minimum length — a vendor normalising to `BO` matched every
  vendor starting with BO (BOCA RATON REGIONAL HOSP → Restaurants). Now a prefix match needs both keys
  ≥ 6 characters *or* the shorter to be a whole first word of the longer (`AMAZON RETA` ↔ `AMAZON RETAIL`
  and `WALMART` ↔ `WALMART COM` match; `BO` ↔ `BOWLERO` doesn't). `buildVendorMap` keeps its Map shape
  and hangs `byAccount` on it (`${account}\0${normVendor}`); `suggestFund(vendorMap, vendor, account)`
  tries the record's account exact → all accounts exact → guarded prefix, account first — so `CAPITAL
  ONE MEMBER FEE` is Venture X on one card and Quicksilver on the other, and a card with no history for
  a vendor falls through to the all-accounts answer. Both importer call sites pass `rec.account`.
  `normVendor` untouched. Seven `test-csv` cases added (599 → 606). **Trade noted:** a short vendor that
  used to prefix-match will show "pick a fund" once and learn from there — a missed suggestion costs one
  click, a wrong one silently miscategorises.
- **W12 — small UI fixes (Q5).** Garden status omits zero segments (`October 2026 · fully allocated ✓ ·
  14 on plan`, no `0 need attention · 0 with money to move`). The Transactions delete button is a
  20px `si-trash` watercolor glyph (compost pail — fills carry the straight edges, every stroke is
  curved, per the si-* rule) in both `index.html` and `dev.html`, with `aria-label="Delete"`. The
  Transactions title is `Transactions` (the sidebar's month picker names the month).

### 2026-10-26 — Category panel, Settings cleanup, wizard restore door, export nudge (sitting B: W5–W8)

Sitting B of the 1.2.0 work order (`_cowork/work-order-1.2.0.md`, items W5–W8; roadmap Q2 and Q3,
three-year report wishes #20 and #21). `src/app.js`, `src/styles.css`, `README.md`. **No `compute.js`
change, no data.version bump, no migration.** One optional field added, `settings.lastExportAt`, ignored
by every migration and by `buildNextMonth`. Suites 599 / 1060 (1091 with the real-export sections) / 156 /
17, unchanged.

- **W5 — category ⋯ panel (Q2; roadmap asks 5 and 6).** Every category header carries a `⋯`, expanded
  *or collapsed* (the header's `+` and `✕` only rendered on an open card, so a collapsed 12-category page
  had no way to reach them). It opens a side panel in the fund panel's frame — `4 funds · planned
  $1,240.00 · spent $980.00`, then `+ Add fund · Rename · ↑ Up · ↓ Down · ✕ Remove category`, then the
  fund names. **Rename applies to every month** (Call 2, decided: a category name is a label, not money,
  and Year Overview merges by exact name — a forward-only rename would show two rows with a seam), refuses
  a name any month already uses (case-insensitive, `"X" already exists in December 2025.`), and files one
  undo step (`Renamed in 9 months.`). Up/Down reorder this month forward, like the fund panel's move; the
  accordion open-state (keyed by category index) swaps along so the open card stays open. Remove and
  + Add fund dispatch to the same guard and dialog the header buttons used (`removeCategoryGuarded`,
  `showAddFund({ side: 'expense', ci })`); the `data-del-cat` / `data-add-fund` handlers stay. The
  `accordionHtml` helper gained a `more` slot rendered in both states; the income groups' `+` still
  renders only when open. **Stacking fix:** `.modal-overlay` moves from z-index 40 to 46 — it sat *under*
  the side panel (45), so the Rename dialog opened from the fund panel (1.0.1 W7) or this one had its
  buttons covered by the panel's scrim; Enter worked, clicking didn't. No modal is ever opened under a
  panel, so nothing else changes.
- **W6 — Settings cleanup (Q3).** The "Rename a fund" section (a duplicate of the fund panel's Rename) and
  the "Categories" section (replaced by W5 and the Budget page's `+ Add category`) are gone. Settings is
  Budget rules · Fund types adjusted (only while the retype notice exists) · Data.
- **W7 — "I already have a budget" on the wizard's welcome step (#20; friction A-33).** Under "Let's go":
  `Already have a budget file from another computer? Bring it in — pick the file you exported from
  Settings, and the app opens on it.` The link runs the same `importDataFile` as Settings → Restore…; main
  validates the file and the app reloads into it (no wizard — `data.months` isn't empty any more). A bad
  file shows main.js's own message under the link (`Couldn't open it: …`), set as text, and the wizard
  stays. Nothing is written for the wizard before Finish, so there is no in-memory state to lose. Restores
  onto a non-empty install still go through Settings → Restore… with the pre-restore backup; untouched.
- **W8 — an occasional "save a copy somewhere safe" nudge (#21; report "Backups" health check).**
  `exportCopy()` is the one export path (Settings and the recap); on success it stamps
  `settings.lastExportAt = today` via `silentDirty` (a stamp, not an edit — no undo step). The month-close
  recap shows one line above its buttons when it's been **90+ days** since the last export, or there has
  never been one and the data holds **3+ months**: `It's been 3 months since you saved a copy of your
  budget somewhere safe. [Export a copy…]` / `You've never saved a copy of your budget outside this
  computer. [Export a copy…]`. Exporting from it removes the line and leaves the workflow open. Settings →
  Data shows `Last exported Oct 26, 2026` / `Never exported` under the Export row. No pop-ups, no launch
  toasts, nothing on the Garden. **The exported file carries the *previous* `lastExportAt`** (or none) —
  the stamp is set after the write returns. By design; don't "fix" it.
- **README:** category panel, Settings contents, and the wizard's restore door.

### 2026-10-26 — Importer summary, Import into Transactions, import starts the month, named accounts (sitting A: W1–W4)

Sitting A of the 1.2.0 work order (`_cowork/work-order-1.2.0.md`, items W1–W4; roadmap Q1 and Q4,
three-year report wishes #7 and #26). `src/app.js`, `src/index.html`, `src/dev.html`, `src/styles.css`,
`README.md`. **No `compute.js` change, no data.version bump, no migration.** One optional field added,
`settings.accountNames`, ignored by every migration and by `buildNextMonth`. Suites 599 / 1060 (1091 with
the real-export sections) / 156 / 17, unchanged from 1.1.1.

- **W1 — the importer summary reports what's being imported (Q1).** The band's headline — `Importing 35 of
  60 rows · Jan 3 – Jan 31, 2026`, Money in, Money out — is now summed over the *ticked* rows only, so an
  auto-unticked duplicate or card payment never inflates the number the Import button is about to act on.
  The whole file keeps a second, quieter line (`In this file: 60 rows · in $3,120.00 · out $4,210.55 — 20
  duplicates and 5 card payments are unticked`): that line is the misread-file tripwire (an inverted sign
  shows up as impossible income) and never moves with a checkbox. The clause names the non-zero reasons
  only (duplicates, card payments, rows in a month that hasn't started, rows you unticked). With
  everything unticked the headline reads `$0.00 / $0.00` and the date range falls back to the file's.
  The toolbar count uses the same phrasing. The `transaction(s)` / `row(s)` / `table(s)` plurals in the
  importer, the review strip and the rename toast are now real plurals.
- **W2 — Import leaves the sidebar and lives on Transactions (Q4, D3).** The sidebar is six items. The
  Transactions toolbar gains `Import CSV…` after ⇄ Transfer; one click opens the OS file dialog, and once a
  file is open the preview replaces the list, with `← Back to transactions` and Cancel both returning to it.
  `loadCsvForImport` was a closure inside `renderImport`; it is now module-level so the toolbar, the
  preview's re-parse paths (Not this bank?, blocking questions) and W3's re-read all share it. Every old
  door still works: the Garden's `Open Import` action and the finish-setting-up checklist's import item
  both land on Transactions and open the dialog (`openImportFromTransactions`). **`view === 'import'` is
  aliased to Transactions for this release and removed in 1.3.0.** Leaving Transactions mid-preview drops
  the preview. The landing-page painting (`spotImport`) is no longer rendered; the export stays in
  `spots.js`, unreferenced.
- **W3 — an import starts the month it needs (#7; friction A-15, A-26, B-07).** The import happens first,
  exactly as before. When the file also held rows dated in the month right after the newest one, the
  Transactions page shows one banner: `3 rows from chase-feb.csv are dated in March 2027, which hasn't
  started yet. [Start March 2027 and bring them in] [Not now]`. The button opens the normal month-close
  workflow for the closing month; when the month is created the **same file is re-read automatically** —
  no file dialog — and the preview opens with the held rows ticked and everything already imported
  badged `duplicate` (Batch 1's exact-match dedupe). Plumbing: `createNextMonth(last, onCreated)` and
  `showMonthCloseWorkflow(last, nid, onCreated)`; the inline-transfer re-entry passes the hook along.
  "Not now", leaving Transactions, or starting a month from the sidebar clears the banner. Rows two or
  more months ahead don't trigger it (badge and tooltip still explain them). Nothing is written to disk —
  the hold keeps the bytes the preview already held for "Not this bank?". `startNextMonth` now uses the
  `nextMonthId` already imported from `compute.js` instead of an inline copy.
- **W4 — name the accounts (#26; A-23, B-13).** The account filter's last option is `Name these accounts…`,
  which opens a dialog listing every distinct account string seen in **any** month, one text field each
  (40 chars). Names live in `data.settings.accountNames = { "7741": "Chase checking" }` and are display
  only: the filter, the import preview's `· 7741` note and the Account cell's hover title show
  `Chase checking · 7741`; the transaction's `account` field is never rewritten, so the CSV dedupe and the
  vendor map keep working on the bank's raw string. Clearing a name removes the key; the last cleared name
  removes the object. Every render of a name goes through `esc()`.
- **Dev harness:** `dev.html` accepts `?data=/path.json` to boot from an exported or sim-state file instead
  of the seed (used to walk W3 against the A-M06 state).

## 1.1.1 — 2026-10-25 — three-year simulation, batches 1–3

Three fix batches from the three-year longevity simulation, shipped together as one patch:
the importer (S1, S2, S4, S6, 2026-10-06), paycheck numbers (S3, S9, S10, S17) and money in
the right month (S5, S8, S7), both 2026-10-25. No data.version bump; no migration. Details in
the three dated entries below.

## 2026-10-25 — Money in the right month: dated transfers, import landing, auto-planned follows a resync (3-year sim S5, S8, S7)

Batch 3 of the three-year longevity simulation (`_cowork/3yr-sim/pass4/three-year-report.md`
S5, S8, S7; pass-2 evidence L1 and F4; pass-3 repro scripts P1 and P5). Three defects that
put money, or a planned amount, in the wrong month. `src/app.js`, `src/compute.js`,
`tools/test-compute.mjs`. **First batch to touch `compute.js`** since 1.1.0, and additive
only. **No data.version bump**: nothing saved changes shape — resync already rewrote
carry-overs on every `markDirty`; S7 lets it rewrite one more derived value under one
narrow condition. Suites 599 / 1060 (1091) / 156 / 17 (compute's v7 block was 1075; the
other three unchanged). **Batches 1–3 ship together as 1.1.1.**

- **S5 — A transfer posts to the month its date names, or is refused.** `showTransferModal`'s
  `#tGo` handler pushed both legs into the month on screen whatever date was typed, so a
  pair dated 10/15 with November open sat in November's math (and a date in a month that
  doesn't exist landed there too). It now follows the same rule as the Transactions date
  edit (W6): a date inside the open month behaves as before; a date in a month that doesn't
  exist is refused in the dialog's own error line ("September 2026 doesn't exist yet, so the
  date must stay inside August 2026."); a date in another existing month asks "This transfer
  is dated 7/15/26 — post it to July 2026?" and on OK pushes **both legs** there, with the
  toast adding "in July 2026". Cancel returns to the dialog with nothing pushed. One
  `markDirty` after both pushes, so Ctrl+Z still removes the pair as one step and the resync
  carries a cross-month pair forward from the month it landed in. The dialog now clears its
  error line at the start of each attempt, so a refusal doesn't outlive the fix. The
  month-close "transfer it" links open the same dialog with `currentMonthId` already set to
  the closing month, so their default date sits inside it — unchanged, re-verified. No
  balance check against the target month (that's 1.2.1's #23).
- **S8 — After an import, land on the newest month that got rows.** `#doImport` tracked the
  month of the *last* row pushed; bank files list newest first, so a file spanning months
  left you on its OLDEST month and the next edit landed in the past. It now tracks
  `newest = max(month.id)` over the rows actually pushed and switches there only when
  `newest >= currentMonthId`; when every row went to earlier months it stays on the current
  month. Either way the view is Transactions with the filter reset. The C3 toast still names
  the earlier months that got rows and the carry-over correction.
- **S7 — A never-typed auto-planned value follows a late resync.** `buildNextMonth` derives a
  target or capped-build fund's planned from the carry-over at build time. When a row later
  lands in an earlier month, `resyncCarryOvers` fixed the carry but left that derived
  planned, so the fund asked for the wrong amount and showed an `overridden` chip nobody set
  (R9: Baby built April from carry $2,250 → planned $20.83; a March line imported in May
  dropped the carry → auto $41.67, planned stayed $20.83). **The rule, in one sentence:
  planned follows a resync only when it equalled the auto value on the old carry.** Inside
  the expense loop, before the carry moves, `autoOld = autoPlanned(f, cur.id)`; if
  `|planned − autoOld| ≤ 0.004` (never typed) then after the new carry is set
  `autoNew = autoPlanned(f, cur.id)` and planned becomes `autoNew` when it differs by more
  than 0.004. Every other planned is untouched: a typed value (Invariant 13), a `fixed` fund
  (its auto doesn't depend on the carry, so nothing moves), a fund with no setup, a fund
  whose carry didn't change. Income funds are out of scope. It runs in the same iteration,
  before the next month is computed from this one, so the changed planned feeds the next
  month's carry in one pass and a second run still returns `[]` (Invariant 10). The change
  object gains `plannedFrom` / `plannedTo` when planned moved; `#doImport`'s toast adds
  "· 1 planned amount followed" (or "N planned amounts followed"); other `markDirty`
  callers ignore the extra keys. The rule is stated in a comment at the top of
  `resyncCarryOvers` — the roadmap I1 session that deletes the income loop needs to keep it.
  **Known limit:** this prevents new stale values; it does not heal one left by an earlier
  release, because the carry has to change for the rule to fire. Cowork's read-only check
  against the 2026-09-28 live export (`_cowork/3yr-sim/pass4/s7-live-check-2026-09-28.md`)
  found exactly one candidate — Eye Care, Sep 2026, planned $6.67 vs auto $6.70 (3¢) — not
  worth a migration. That check is unchanged after this release: 0 carry changes, 0 planned
  cells differ, a second run → 0.
- **Tests.** Six S7 cases in `tools/test-compute.mjs`'s v7 block (16 assertions): the R9
  shape (derived planned follows, `isOverridden` false afterwards), a typed planned stays,
  a fixed fund is unmoved, a capped build fund (carry 280 → planned 20; late −30 → carry
  250 → planned 50), a fund with no setup, and a three-month cascade whose second resync
  returns `[]`. `starts consistent`, `idempotent` and the migration tests are unchanged.
  The R9 fixture gives month A a −250 spend before the build so month B's derived planned
  is the report's $20.83 rather than $0 (a fund already at target). S5 and S8 live in
  app.js and have no unit tests; they're covered by Cowork's P1 and P5 scripts and the walks
  (a-L1-transfer-date, a-M20-catchup, b-M09-catchup), plus the dev-harness checks recorded
  in the Batch 3 session.
- Verified: `node repro.mjs R9` → does not reproduce (overridden false, planned 20.83);
  R1, R1b, R2, R3, R4 still "does not reproduce" (csv.js untouched).

## 2026-10-25 — Paycheck numbers: no $0 estimates, a real recent average, weekly pay detected (3-year sim S3, S9, S10, S17)

Batch 2 of the three-year longevity simulation (`_cowork/3yr-sim/pass4/three-year-report.md`;
pass-2 evidence F9b, pass-3 repro scripts P3, P8, P7). Four defects that put the wrong
number on a paycheck. `src/garden.js`, `src/app.js`, `src/csv.js`, `tools/test-garden.mjs`,
`tools/test-csv.mjs`. **No data.version bump**: nothing saved changes shape — the wizard's
paycheck suggestion gains an in-memory `cadence` field that never reaches the data file.
Suites 599 / 1060 (1075) / 156 / 17 (CSV was 592, garden 139; compute and migrate unchanged).

- **S3 — "Use actual" on an empty month set the paycheck to $0.** At month end a variable-pay
  fund that received $0 because nothing was logged got the same "came in $2,480.00 under the
  estimate [Use actual]" as one whose checks really were short, and one click wrote
  `amount: 0`, which every later month inherited. **The guard** lives in `incomeCheckIns`
  (garden.js), the one place both the Budget review strip and the Garden card build their
  buttons from: the under-received nudge now needs the month to be done **and** something to
  have been received (`received > 0.004`). The over-received nudge is unchanged, any time of
  month. A month whose checks really arrived short (A-M08: one $1,050 deposit against
  3 × $1,240, month over) is still offered. Roadmap 1.3.0 I1 moves `applyActualChecks` into
  compute.js as `setIncomeActual`; it keeps calling `incomeCheckIns`, so it inherits the guard.
- **S3 — "Use actual" divides by the checks that arrived, never writes $0.** `applyActualChecks`
  divided received by the *planned* count, so a lapse month with one deposit against a
  count of 3 wrote a third of a real check. **The deposit rule** (new `fundDeposits(month,
  fund)` in garden.js, shared with the helper below): the deposits are the positive,
  non-transfer (`isTransferTx`) transactions assigned to the fund, and the per-check figure
  is **Σ(their amounts) ÷ their count** — never the fund's `received` or `fundSums()`, which
  include transfers in and any negative adjustment on the fund. With no deposits, or a result
  that rounds to ≤ 0, it returns false without touching the month: no dirty mark, no toast,
  no render. `chk.count` is left alone — next month's planned is still count × the new amount,
  which is what the toast promises. `applyActualChecks` has no unit test (it lives in app.js);
  it is covered by Cowork's P3 script and the a-M05-close / a-M08-short walks.
- **S9 — the variable-pay helper averaged a wrong check count.** `recentPerCheckAvg` divided
  each prior month's received by that month's `chk.count`, so a count inherited by mistake
  during a lapse (A-M08: "$1,102.22 per check" for $1,240 pay) or weekly checks the importer
  had dropped (A-M17: "$462.00") poisoned the "[Use]" suggestion. It is now an exported pure
  function in garden.js, `recentPerCheckAvg(months, fund, beforeId)`, so test-garden covers
  it: walk prior months newest-first, take the ones with a `checks` entry for the fund (the
  `count > 0` requirement is gone — the count is exactly what's untrustworthy), count and sum
  their deposits by the rule above, skip months with no deposits without using up the window,
  stop after three months that had deposits, and return one pooled **Σ deposits ÷ deposit
  count** (not an average of three monthly averages). Still `null` with no history. The app.js
  caller keeps its `chk.variable` gate.
- **S10 — the wizard read weekly pay as "every two weeks".** `suggestStarterFunds` took the
  count from the newest "full" month, which for a file that starts mid-month is partial, and
  `wzIncomeHtml` labelled any count of 2 "every two weeks"; P8's file ($610 on Sep 18, 25,
  Oct 2) pre-filled a weekly payer at 2. **The cadence bands** (new `payCadence(dates, gaps)`,
  from the median gap in days between the cluster's deposits): 5–10 → `weekly`, 4 checks;
  11–17 → 2 checks, `semimonthly` when every deposit's day-of-month sits within ±1 of one of
  two anchor days (1 and 15, or 15 and the last day of the month), else `biweekly`; 26–35 →
  `monthly`, 1; anything else → `cadence: null` and the last-full-month count as before. The
  11–17 band is deliberately one band: 1st-and-15th pay has gaps 14, 17, 14, 17, so its
  median looks biweekly and only the day-of-month test tells them apart. The wizard labels
  from the cadence ("every week" / "every two weeks" / "twice a month" / "once a month";
  null falls back to "N times a month") and, for weekly, adds "Use 4; a few months a year
  bring a fifth check." The standing "Paid every two weeks? Use 2 …" note is unchanged, and
  the biweekly ACME fixture still gives `perMonth: 2` with the same median. Not done here:
  pre-filling a second earner from a second steady cluster (a wizard-state change, not a
  paycheck-number fix).
- **S17 — a closed month's shortfall read "still expected this month".** Copy only, in the
  three income-row titles (fund panel "Left", the Standard Income total in `accordionHtml`,
  which gains a `monthDone` option passed from `renderBudget`, and the Budget income row):
  once `monthContext(...).monthDone`, the gap reads "$X came in under plan"; the current and
  future months keep "still expected this month". The quiet `muted` class stays in both
  cases — a closed month's shortfall is not turned red, since S1 (fixed in Batch 1) is in
  that number for anyone with pre-Batch-1 history.
- Not in this batch, by design: `compute.js` is untouched (Batch 3 and roadmap I1 own it);
  `fundSums` is no longer used in app.js but its import line was left as is (compute import
  line out of scope). Cowork verifies in its sandbox: P3, P8, P7 → "NOT reproduced"; walks
  a-M05-close, a-M08-short, a-M01-wizard, a-M10-close.

---

## 2026-10-06 — Importer: money stops going missing or counting twice (3-year sim S1, S2, S4, S6)

Batch 1 of the three-year longevity simulation (`_cowork/3yr-sim/pass4/three-year-report.md`;
pass-2 evidence F1, F2, F3, F7). Four importer defects, all in how the preview decides
what is already in the budget. `src/csv.js`, `src/csv/import.js`, `tools/test-csv.mjs`,
and three small spots in `src/app.js`. **No data.version bump**: the one data-shape
addition is an optional `source: 'import'` key on imported transactions; absent means
"typed by hand, or imported before this date", and nothing migrates. Suites 592 / 1060 /
139 / 17 (CSV was 516; the other three unchanged).

- **S1 — weekly paychecks were thrown out as duplicates.** An identical vendor + amount
  up to 7 days after an existing row scored 1.0, so the first weekly check in nearly
  every new import file was unticked as a "duplicate" (Persona A lost 57 paychecks,
  $42,150, over 36 months). **The lag rule now** (Dustin, 2026-10-05): a *confident*
  match (score 1.0, auto-unticked) needs the same vendor, the same cents, **and |lag| ≤ 3
  days**. An exact match **4–7 days out is no match at all** — score 0, the row stays
  ticked with no badge — not a 0.6 "possible". A week-later identical line is a paycheck
  or a standing order, not the same line twice. The −3…+7 window still applies to the
  *possible* tiers (near-equal cents, tip/pump-hold, typed twin). A file imported twice
  still dedupes 100% (every row is a same-date exact match), which the catch-up loop and
  re-imports depend on; tested on two fixtures.
- **S1 — claims are assigned best-first across the whole file**, not in file order. Bank
  files are newest first, so the first row to score could claim an existing row whose
  real twin was further down the file. New `matchDuplicates(months, records, claimed,
  opts)` scores every pair inside the date window, then hands out claims in two tiers —
  all confident matches first, then possible ones — ordered by score, then smallest
  |lag|, then file position. Each existing transaction is still claimed at most once
  (Invariant 12; three identical coffees still dedupe as three). The preview in app.js
  now calls it once per file instead of `findDuplicateScored` once per row; the per-row
  function stays (same scoring, used by the tests and the simulation's `repro.mjs`).
  The "duplicate" badge gained a title explaining why it is unticked.
- **S6 — two real purchases a few cents apart became one.** The near-equal band (≤ 2¢ or
  ≤ 0.5%) scored 0.9, a confident duplicate, so TARGET −45.18 then −45.13 a week later
  unticked the second. It now scores 0.6 — "possible duplicate", ticked, badged — and the
  user decides. The tip/fuel 0.6 rule is unchanged.
- **S4 — a hand-typed payment and its bank line both counted.** Vendor equality was
  required before any amount test, so "Hospital deposit" typed on 3/14 and "LAKELAND
  REGIONAL HEALTH" imported on 3/14 never met. `pushImportedTx` now stamps
  `source: 'import'`. When the existing transaction has **no** source stamp, no
  `externalId`, and isn't a transfer leg, and the cents are equal with |lag| ≤ 3 days,
  the row scores 0.6 whatever the vendor text — the badge title says "You typed a $612.00
  entry on 11/15 — is this the same one?". **Not widened to imported rows**: two $5
  coffees at different shops the same day are two transactions (tested). Older imports
  lack the stamp and count as typed; worst case is an extra "possible" badge on a row
  that stays ticked.
- **S2 — paying the card from checking imported as spending.** `isCardPaymentRow` (the
  identical copy in `src/csv/import.js` and the legacy `src/csv.js`) only knew
  "online/autopay pymt", "payment thank you" and one Capital One string. Added the
  issuer + payment wording banks actually write: `payment to chase card`, `chase credit
  crd autopay|epay`, `capital one crcardpmt`, `discover e-payment`, `amex epayment`,
  `citi autopay`, `cardmember serv`. Anchored on the issuer name plus a card or payment
  word — "PAYMENT TO CITY WATER" and "FPL DIRECT DEBIT ELEC PYMT" stay bills (tested
  through both parsers). The flagged row's existing "card payment" badge already
  explains itself.
- **Decisions not in the work order**, flagged for review: (1) best-first matching and
  the typed-twin badge title both needed the preview's row-building code in app.js, not
  just `pushImportedTx` and the badge strings — the matcher call changed from per-row to
  per-file (3 lines) and each preview row now carries its `dup` match so the badge can
  name the typed entry. (2) The Chase pattern is `payment to chase card` (the "ending
  in" is optional) — still issuer + card + payment. (3) Rows dated in a month that
  doesn't exist yet still take no part in matching, as before.
- Verified: `node tools/test-csv.mjs` 592/0; compute 1060/0, garden 139/0, migrate 17/0;
  `_cowork/3yr-sim` `node repro.mjs R1 | R1b | R2 | R3 | R4` each "does not reproduce".

---

## 2026-09-28 — 1.1.0: first Mac release, one CI workflow, Electron 44

`_cowork/work-order-1.1.0.md` W1–W5 (sources: `release-plan-audit.md` R1, R4, R6,
R8; `macos-readiness-audit.md` M4, M5, M8–M10; `mac-ci-workflow.md`). **No
features, no Windows signing** (deferred 2026-09-28 to ~2 months before real
users), data version stays 7, no migration, `compute.js` and `updater.js`
untouched. The PC stops building releases: it writes code, runs tests, bumps,
tags, pushes. Suites 1075 / 516 / 139 / 17, unchanged.

- **W1 — Electron 43.3.0 → 44.4.5** (exact pin; the September bump per the
  standing rule). Needs Node ≥ 22.12.0. The 44 breaking changes were read against
  what the app calls — `BrowserWindow`, `Menu`, the three `dialog` methods,
  `ipcMain.handle/on`, `requestSingleInstanceLock`, `app.getPath/setPath`,
  `shell.openExternal/showItemInFolder`, `contextBridge`, `ipcRenderer`,
  `webContents.send`, `setWindowOpenHandler` — and **nothing applies**: the
  changes are the `clipboard` module (rearchitected, gone from the renderer; the
  app never used it), workers in subframes, `net.request` frame destinations,
  login-item attributes, 32-bit and Unity removal. One is relevant by
  coincidence: 44 drops macOS 12, which is why the Mac minimum is 13 Ventura.
  electron-builder 26.15.3 / electron-updater 6.8.9 deliberately not moved.
- **W1 — `win.artifactName`: `Sowing-Season-Setup-${version}.${ext}`.** The
  installer, its blockmap and `latest.yml`'s `url:` are dashed straight out of
  the build, matching the Mac block. The hand-rename into
  `dist-installer/release-v{version}/` is dead. It mattered now because CI
  uploads files by name, and GitHub turns spaces into dots. The name is what
  1.0.5's updater will fetch, so it has to stay exactly this.
- **W2 — `tools/publish-release.js` is gone**, and with it the
  `git credential fill` path. Its `verify()` / `fetchFollow()` survive as
  **`tools/verify-release.js`** (`npm run release:verify`), generalized: for
  `latest.yml` and `latest-mac.yml` it GETs the feed via `releases/latest`
  (5 tries, 3 s apart), asserts `version:`, collects **every** `url:` line (the
  Mac feed lists four) and HEADs each under the `v{version}` tag. `--version`
  overrides package.json (CI passes the tag); `--windows-only` skips the Mac
  feed. Trap: `npm run release:verify --windows-only` without the `--`
  separator never reaches argv — npm keeps the flag and sets
  `npm_config_windows_only` — so the script reads that too.
- **W2 — `npm run release` now means "check, tag, push"**:
  `release-check.js && tag-release.js`. It used to be
  `electron-builder --publish always`, the local-publish path.
  `tools/tag-release.js` has no checks of its own on purpose.
- **W2 — `release-check.js --ci`** skips the git checks (2, 3, 3b) and, when
  `GITHUB_REF_TYPE === 'tag'`, asserts `GITHUB_REF_NAME === 'v' + version`.
  Gated on the ref *type* because `GITHUB_REF_NAME` is always set in Actions
  (it's the branch name on a dry run). Without `--ci` nothing changed.
- **W2 — the compute suite cannot run in CI, and `--ci` says so instead of
  failing.** Not in the work order; found by running the preflight in a fresh
  clone. `tools/test-compute.mjs` reads `data/seed.json` and the source workbook
  — the owner's real history, git-ignored by design — so on a runner it dies
  with ENOENT and the `check` job could never go green. Under `--ci`, when
  `data/seed.json` is absent, `npm run test` is skipped with a printed `–` line;
  csv / garden / migrate still run there. The compute suite's gate is the local
  preflight inside `npm run release`, which runs before the tag exists. (So the
  workflow's "all four suites" comment is three on the runner.) The durable fix
  is a synthetic fixture for the compute suite — not this release.
- **W3 — `.github/workflows/release.yml`**, verbatim from the work order. A
  pushed `v*` tag runs `check` → `draft` → `windows` + `mac` → `publish`.
  - **Draft, then publish — and why.** The release is created as a draft and
    both jobs upload into it; only `publish` flips it to published + latest,
    then runs `verify-release.js`. A failure anywhere leaves a draft, which
    `releases/latest` and every installed app cannot see. The 1.0.4 failure —
    half a release went live, `latest.yml` missing, updater blind — can't
    happen. Both platforms ship or neither does (R8), enforced by the graph.
  - **`--publish never` + `gh release upload --clobber`**, not electron-builder's
    publisher: two jobs racing to create one release, and a publisher that
    behaves differently against drafts, both fail quietly. `--clobber` makes
    "Re-run failed jobs" safe and replaces the old resumable-upload logic.
  - **`--publish never` still writes `latest.yml` / `latest-mac.yml`** —
    `app-builder-lib@26.15.3` `PublishManager.js:136–160` writes update-info
    whenever the `publish` block resolves, independent of the publish policy.
    That is why the `build.publish` block must stay.
  - **`needs: [check, draft]` + `if: always() && …`** on the build jobs is the
    shape for "run after an optional job": the dry run skips `draft`, and the
    two result checks keep a real failure from being ignored. Don't simplify it
    to `needs: draft` — that skips the builds on a dry run.
  - **Dry run** = Actions → Run workflow: same builds, no release, installers
    attached to the run. It is the test of the workflow file itself.
  - **One departure from the work order's file, found by the first dry runs:
    the Mac job builds its own keychain and passes `CSC_KEYCHAIN` instead of
    `CSC_LINK` / `CSC_KEY_PASSWORD`.** electron-builder 26.15.3's `importCerts`
    (`macCodeSign.js`) calls `security set-key-partition-list -k` with the
    *certificate* password where the *keychain* password (random, generated a
    few lines earlier) belongs, so the build dies on "SecKeychainUnlock: The
    user name or passphrase you entered is not correct" right after a
    successful import. The builder stays pinned; the step goes away when it
    moves to a version that fixes this.
  - **Trap before that one: the `.p12` must be in the old format.** A `.p12`
    exported by OpenSSL 3 (Git for Windows) defaults to AES-256 + SHA-256 MAC,
    which macOS `security import` rejects as "MAC verification failed during
    PKCS12 import (wrong password?)" — with the right password. Export with
    `-keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1`.
  - **The sanity check validates the `.app` bundles, not the `.dmg`s.** The
    work order ran `xcrun stapler validate` on each `.dmg`, which fails with
    "does not have a ticket stapled to it" on a perfectly good build:
    electron-builder notarizes and staples the app, then wraps it, and the
    `.dmg` is neither signed nor stapled. The Mac job's timeout is 120 minutes
    — two notarizations per run, and the first took about half an hour.
  - The Mac job emits **eight** files plus `latest-mac.yml` (each `.dmg` has a
    blockmap too), so a release carries **twelve** assets, not ten.
- **W4 — docs.** RELEASING.md rewritten around the flow (§Every release,
  signing deferral, §macOS as shipped, cadence record, build paths). TESTERS.md
  gained "Installing on a Mac", "Updating" and the Mac data path. README's
  Download has a Mac bullet.
- **Mac ships untested on hardware, by decision.** Nobody on the team has a
  Mac. The acceptance test is the notarization ticket plus
  `xcrun stapler validate` in the CI log, and the docs say so to testers in
  plain words. On a Mac the app reports `check-only` and the update button opens
  the releases page; **M4** (widening `updater.js:36` to `win32 || darwin`) is
  1.1.1, after one Mac user confirms the .dmg opens with no Gatekeeper dialog.

---

## 2026-09-27 — 1.0.5: release-process debt paid, Mac prep committed but inert

`_cowork/work-order-1.0.5.md` P1–P12 (sources: `release-plan-audit.md` R1–R14,
`macos-readiness-audit.md` M1–M10). A **Windows-only** release shipped the
existing local way (`npm run dist` → `node tools/publish-release.js`). No Electron
bump, no CI, data version stays 7, no migration, **no new features** — Phone
Wallet and everything else user-facing waits until after 1.1.0 (decided
2026-09-27). The one thing a Windows user can notice: Settings → Restore can now
list `keep-*` rows. Suites 1075 / 516 / 139 / 17, unchanged.

- **P1 — second build system retired.** `tools/package-app.js`, `npm run pack`
  and the `@electron/packager` devDependency are gone; `npm run dist` is the only
  build path. The packager build had no electron-updater bundled (it silently ran
  check-only) and its KEEP allowlist was a hand-synced copy of `build.files`.
  `.gitignore` keeps `dist/` — the folder still exists on the owner's disk until
  the desktop shortcut is repointed at `%LOCALAPPDATA%\Programs\Sowing Season\`
  **after** 1.0.5 is installed (owner's step, not the code's).
- **P2 — dead code and notes-in-repo.** The two `OWNER_TBD` branches in
  `updater.js` are deleted. RELEASING §One-time setup now reads as done (repo,
  scrub, signing deferred). Release notes live in `releases/v{version}.md` —
  v1.0.2/3/4 backfilled from the live release bodies — and
  `tools/publish-release.js` **refuses to run** without the file rather than
  falling back to a bare title.
- **P3 — `tools/release-check.js` (`npm run release:check`)**: semver, tag unused
  locally and on origin, clean tree, CHANGELOG mentions the version in its first
  40 lines, notes file present, all four suites pass. `npm run dist` runs it
  first; `npm run dist:unchecked` is the escape hatch. README's Download link
  now points at `releases/latest` (it was one version stale — the finding proving
  itself), so RELEASING's "update the README link" step is gone.
- **P4 — post-publish verification.** `publish-release.js` ends with `verify()`:
  GET `releases/latest/download/latest.yml` following redirects (up to 5 tries,
  3 s apart — `releases/latest` can lag), assert `version:` equals package.json,
  HEAD the asset URL built from its `url:` line, print
  `verified: latest.yml v{version} → {asset} (200)` or exit 1 naming the failed
  assertion. Dependency-free (plain `https`, two regexes; no YAML lib).
- **P5 — one kept backup per migration, and the prune leaves the safety copies
  alone.** New IPC `data:keep-backup` (`keepBackup(label)` in preload; label must
  match `/^[a-z0-9-]{1,40}$/`) copies the **on-disk** `budget-data.json` to
  `backups/keep-{label}-{stamp}.json`. `boot()` captures `fromVersion` before the
  migration chain and calls `keepBackup(\`before-v${data.version}\`)` when
  `migrated && data.version > fromVersion` — guarded on the version, not on
  `migrated`, because the appName rewrite sets `migrated` without a format change
  — and it must run *before* the first save, since it is the file on disk that's
  copied. Naming convention: `keep-before-v{N}-{stamp}.json`. Traps fixed on the
  way:
  - The prune filter was `f.endsWith('.json')`, so `budget-prerestore-*` (the
    "what I had before I clicked Restore" copies) were prunable. It is now
    `/^budget-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.json$/` — only rolling backups go.
  - **The corruption-recovery ladder now sorts by mtime, not by name.** It took
    every `.json` and tried the alphabetically last first; `'k' > 'b'`, so a
    `keep-before-v7-…` file (old-format data) would have been tried before every
    rolling backup and silently recovered the user to pre-migration data. mtime
    descending also fixes the older quirk where `budget-prerestore-…` sorted
    after `budget-2026-…` regardless of age.
  - `backups:list` and `data:restore` accept `^(budget|keep)-`; the list carries a
    `kind` (`rolling | prerestore | keep`) and is ordered by the trailing stamp so
    the three kinds interleave chronologically. The Restore modal labels keep
    rows "· saved before the v7 update" (`backupRowNote`, number from the name).
  - Restoring a keep file re-runs the migration on reload, which writes a
    **new** keep file. Expected; they accumulate one per migration.
  - Rehearsed with `BUDGET_DATA_DIR` on a scratch copy of a v6 file: keep file
    byte-identical to the original, none on the second launch, prune leaves
    keep-*/prerestore-*, truncated main file recovers from the newest rolling
    backup (v7), not the keep file.
- **P6 — license.** `"license": "UNLICENSED"` in package.json, no LICENSE file
  (decided 2026-09-27): the public repo reads as all-rights-reserved on purpose.
- **P7 — macOS application menu (inert on Windows).** `installDarwinMenu()` in
  main.js, darwin only: App (about/hide/quit), Edit with **plain** Undo/Redo
  items on ⌘Z / ⇧⌘Z that send `menu:undo` / `menu:redo` to the renderer — *not*
  `role: 'undo'`, whose accelerator would swallow the key before the renderer's
  keydown listener ever saw it — then cut/copy/paste/selectAll roles; a View
  menu (reload/devtools) only when `!app.isPackaged`; Window roles. Renderer:
  `hotkeyUndoRedo(isUndo, target)` extracted from the keydown listener — text
  field → `document.execCommand('undo'|'redo')` (the menu path has no browser
  default to fall back on), no months / modal open → no-op, else `undo()` /
  `redo()`; returns true when it acted so the keydown path only
  `preventDefault`s then. Preload exposes `onMenuUndo` / `onMenuRedo`; `boot()`
  registers them behind `if (window.budgetAPI.onMenuUndo)` for the dev harness.
  Windows: no menu bar, Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z unchanged.
- **P8 — dialogs get a parent.** `csv:open`, `data:import-file`, `data:export`
  pass `mainWin` — a sheet on Mac, a window-modal dialog on Windows.
- **P9 — modifier key in tooltips.** Preload exposes `modKey` (`'⌘'` on darwin,
  `'Ctrl'` elsewhere — a value, so the renderer still never reads
  `process.platform`). `updateUndoButtons()` builds the titles: `⌘Z` / `⇧⌘Z` on
  Mac (⌘Y is not a Mac redo convention), `Ctrl+Z` / `Ctrl+Y` elsewhere. The
  hardcoded `title` attributes left `index.html` and `dev.html`; JS owns them
  (`seedUndoBaseline()` → `updateUndoButtons()` runs in `enterApp()`).
- **P10 — Mac build config committed, not built.** `build.mac` (dmg + zip, x64 +
  arm64, hardened runtime, notarize, `Sowing-Season-${version}-${arch}.${ext}`
  as a *literal* electron-builder template) and `build.dmg` in package.json;
  `build/entitlements.mac.plist` (allow-jit + allow-unsigned-executable-memory,
  nothing else); `build/icon.png` 1024×1024 RGBA rendered from `build/icon.svg`
  with the tile in an 880 px box → 99 px (~10 %) padding per side, Apple's grid
  (the existing 1024 render in `_cowork` filled the canvas to 3 %). Found on the
  way: the `#paper` grain filter's region extends 10 % past the tile rect, so it
  spilled a faint 6 %-alpha grey band into the transparent margin — `icon.svg`
  now clips that rect to `#tile`. `build/icon.ico` was **not** regenerated (the
  band is invisible at ≤256 px; regenerate on the next icon pass). **No
  `.github/workflows/mac-release.yml` in this release** — it would trigger a Mac
  build of a version whose updater gate and docs aren't ready; it lands in 1.1.0.
  `npm run dist` on Windows still builds only the NSIS installer.
- **P11 — exact pins.** `electron 43.3.0`, `electron-builder 26.15.3`,
  `electron-updater 6.8.9` (what the lockfile already held — no upgrade this
  cycle). RELEASING gains the standing rule: bump Electron to the current major
  twice a year (March/September), never more than two majors behind, builder and
  updater together; first scheduled bump is 1.1.0.
- **P12** — version 1.0.5, this entry, `releases/v1.0.5.md`.

---

## 2026-09-08 — Carry-over integrity: derived carry-over, locked cells, import guard (v7)

`_cowork/proposal-carry-over-integrity.md` C1–C5 in the D3 order, with Dustin's
decisions applied: **D1(a)** one rule, no exceptions (full resync, pennies
included); **D2** real month only (no "count in the new month" radio — `bankDate`
and the `scoreDuplicate` change were dropped with it). Root cause: carry-over
was a snapshot taken by "Start next month" and never re-checked, so anything
that changed an older month (the Sep-6 import of three Aug-31 rows, −$137.27 on
Essentials) silently left every later month wrong. Data version 6 → 7. All four
suites green (1075 / 516 / 139 / 17); verified end-to-end in the dev harness.

- **C1 `resyncCarryOvers(data)` (compute.js)**: pure, walks months in order —
  expense fund carry-over = previous month's recomputed leftover; income fund =
  `carryForward ? prev leftover : 0` using **month N's own** flag; a fund with
  no same-named predecessor (first month, or added mid-year like Sam's Club) is
  an opening balance and is never touched. 0.005 tolerance, returns a
  `changes[]` list, idempotent, chains through all months in one pass. Never
  touches `planned`. Called at the **save boundary only**: `markDirty()` (before
  the post-change baseline is cloned, so undo restores pre-change carry-overs
  correctly), `silentDirty()`, and `restoreSnapshot()` (a restored snapshot may
  itself be stale). `markDirty` now returns the changes so the import toast can
  report a follow-on correction honestly.
- **C2 carry-over is read-only** except the opening-balance case
  (`carryEditable()` mirrors the resync's matching). Grid rows render derived
  carry-over as plain `mono` text with "Carried from {prev}'s leftover. To
  change it, change {prev}."; editable cells keep the input plus a muted
  "opening" chip. Fund panel: same split — `#pnlCarry` only exists (and is only
  wired) in the opening case, labelled "Opening balance". Belt-and-braces guards
  in both grid `onchange` handlers; walkthrough slide 4 rewritten ("it can't be
  typed — fix last month and it follows").
- **C3 import guard**: `row.earlierMonth` = dated before the newest month.
  Preview shows a batch-level notice ("N rows are dated in July, which you've
  already moved past… carry-over follows automatically"), an "earlier month"
  warn badge in place of "ready", and "(closed)" in the Month column. Rows
  always post where their dates say (Option A); the import toast appends
  "· 3 posted to July — August's carry-over updated" only when the resync
  actually reported changes.
- **C4 `migrateV7(data, todayISO)`**: runs the resync once over history, bumps
  the version, stashes corrections in `settings.lastCarryFix = { at, changes }`
  (lastRetype pattern). `showCarryFixNotice()` after `enterApp()` shows a
  one-time modal — corrections ≥5¢ listed openly, the 1–3¢ spreadsheet-rounding
  moves collapsed behind a `<details>` ("and N penny rounding corrections…",
  capped at 38vh and scrollable — 55 lines pushed "Got it" off-screen before
  that). "Got it" sets `lastCarryFix.seen` via `silentDirty()`. `BLANK()` in
  main.js is now version 7.
- **C5 tests (test-compute.mjs)**: 15 hard assertions (they fail the run, unlike
  most of this file's log-and-eyeball sections) — chained three-month resync,
  income carryForward on/off decided by month N's flag, opening balance
  untouched, idempotence, the anonymised live case (−306.31 → −443.58), and
  migrateV7 version/lastCarryFix/skip/no-changes behaviour. §2.6's test 6
  (scoreDuplicate + bankDate) was dropped with D2. No compute fixtures needed
  re-baselining — the spreadsheet comparison never runs the resync.
- **Traps**: the resync belongs at the save boundary, never in individual
  handlers (do-not list §5); don't widen the 0.005 tolerance to hide pennies —
  that turns a 1¢ correction into permanent silent drift. Expected D1(a) side
  effects on live data: Tax Cost Aug $0.00→−$0.02 and Tithe Jul $0.00→−$0.01
  paint penny-red "exceeded" chips on two closed months, and the dev seed's
  August hero now reads ($0.01) left to allocate — rounding made visible, not a
  bug.

## 2026-09-06 — Undo/redo + pinnable "Left to allocate" card

Owner request: undo/redo with Ctrl+Z / Ctrl+Y, buttons by the save status, a
toast naming what was undone, and a way to keep the Left-to-allocate card in
view while scrolling — toggled by a watercolor pin on the card itself. All four
suites green (1060 / 516 / 139 / 17); verified in the dev harness. Data version
stays 6; one new settings key (`stickyAllocate`).

- **Undo/redo (app.js)**: snapshot-based. `markDirty(label)` now files the
  pre-change state (`undoBase`, a `structuredClone` refreshed on every commit)
  onto a 50-deep undo stack before scheduling the save; the whole budget is
  small JSON, so cloning beats threading inverse ops through ~40 call sites.
  Every call site passes a human label ("the planned change on \"Gas\"",
  "the $50.00 transfer", "starting October 2026") — `undo()`/`redo()` toast
  `Undid/Redid {label}.` Session-only by design; `seedUndoBaseline()` runs in
  `enterApp()` so migrations/wizard output are the floor. `restoreSnapshot`
  swaps `data`, repoints `currentMonthId` if the viewed month vanished (undoing
  "Start next month"), closes the fund panel (stale indices), saves via
  `scheduleSave()` (the no-snapshot half of the old markDirty), renders.
- **`silentDirty()`** — saves and folds the change into `undoBase` WITHOUT
  filing an undo step. Used for automatic bookkeeping (checklist auto-latch,
  walkthrough-seen flags, the recalc after `renameFundEverywhere` already
  filed the step): Ctrl+Z must never appear to do nothing because it reverted
  an invisible flag. Renames file exactly one step (panel caller downgraded
  to silentDirty — it used to double-fire with renameFundEverywhere's).
- **Shortcuts**: document-level Ctrl/Cmd+Z, Ctrl+Y and Ctrl+Shift+Z. Skipped
  while focus is in an input/textarea/select (native text undo wins), while a
  `.modal-overlay` is open (modals hold refs that would go stale over restored
  data), and while the wizard owns the screen (months empty — nothing saved).
  The fund side panel is fine: it re-resolves via `panelFund` and closes.
- **Buttons**: `↶ Undo / ↷ Redo` in the sidebar foot above the save status
  (index.html AND dev.html — the harness mirrors the sidebar), disabled states
  + tooltips naming the next step, wired in `enterApp`.
- **Pinnable hero**: the Budget hero moved OUT of `.month-head` to be a direct
  child of #main — position:sticky pins only within its parent, which is why
  it couldn't just get a class where it was. CSS `.month-head .hero` selectors
  generalized to `.hero` (AUM's hero unaffected). `.hero-solo.pinned` sticks at
  top:-26px (same #main-padding offset trick as `.acc-col-head`), z-index 6,
  soft shadow as the pinned cue. Column headings pin BELOW the pinned hero:
  renderBudget measures `hero.offsetHeight` each render into `--pin-offset` on
  #main and `.acc-col-head` adds it to its top. Pinned is the DEFAULT
  (`settings.stickyAllocate !== false`); the pin button toggles it (undoable),
  unpinned state tilts the pin 40°. New watercolor `si-pin` def in both html
  files (needle carries a curve — axis-aligned strokes in wash classes vanish).

---

## 2026-08-27 — Fund intro in the wizard + first-run Budget walkthrough · v1.0.2

Implements `_cowork\proposal-budget-walkthrough.md` in full (approved 2026-08-27;
the owner picked the §B1 title placement). Came out of his from-scratch test run:
the wizard never names the income-fund headings and the Budget page had no tour,
so a new user landed on it cold. compute.js, garden*.js, src/csv/, main.js,
preload.js, index.html and styles.css untouched; all four suites green
(1060 / 516 / 139 / 17). Data version stays 6.

- **Wizard copy (Part A)**: the paycheck step now says each paycheck becomes a
  row under **Standard Income** and names **Extra Income** (the first two
  headings the user meets on Budget); the Finish step promises the Budget
  page's layout and "a short guide will walk you through the page the first
  time" — the auto pop-up is expected, not surprising. Envelope vocabulary
  stays wizard-only per W8.
- **Budget walkthrough (Part B)**: 5 slides (hero/$0 goal → income funds →
  fund personalities → reading a row → Review/Transfer/checklist), fund
  vocabulary with one deliberate envelope-bridge sentence on slide 3. Fires
  once on first visit to the view (`settings.budgetHelpSeen`, set on any of
  the four dismissals, no migration); reopenable from a `?` in the page's new
  `view-title` — Budget was the only untitled view, so this fixes that
  inconsistency too.
- **Shared factory**: `showWalkthrough(slides, flagKey)` extracted from
  `showAumWalkthrough`; the AUM guide now calls it with its slides (SeedTime
  CTA moved into the slide as `cta` html + `wireCta`), behaviour unchanged.
  The Garden's one-slide intro stays bespoke. Slide 3's type blurbs paraphrase
  `FUND_BEHAVIORS` — keep them in step.
- **Screenshots**: `tools/capture-help.js` extended — richer fabricated month
  (two standard paychecks + Gifts/Reimbursements, balanced to the dollar so
  the hero shows $0.00, invented vendors like "Corner Grocery"/"City Water",
  a mid-flight setup checklist) and three Budget crops (hero / income
  accordions / Everyday category). Three new PNGs, 144 KB total. test-garden's
  raster-asset guard now allows exactly the 6 help PNGs.
- **Dev-server fix**: `/assets/*` now maps to `/src/assets/*` — dev.html is
  served at `/` but index.html lives in `src/`, so walkthrough images 404'd in
  the harness (packaged app was never affected).
- **Vocabulary follow-up (the owner's review, same day)**: the wizard now speaks
  **fund** throughout, not envelope — W8's "wizard speaks envelope language"
  half is retired. The welcome step's one establishing sentence ("split your
  money into envelopes… here we call them **funds**") is the only place the
  metaphor survives; picker title, subscriptions note, CSV step, footnote and
  both Finish-step lines all switched to "fund", and the walkthrough's slide-3
  envelope bridge was removed as obsolete. Screenshot paychecks renamed
  Sam/Alex → **Alex's / Samantha's** (capture-help.js), and the wizard's
  name placeholder now reads "e.g. Samantha's paychecks".

---

## 2026-08-26 — Simplicity round (W1–W15) + pre-UAT hardening (U1–U24) · v1.0.1

Implements `_cowork\proposal-simplicity.md` (approved 2026-08-26) and
`_cowork\proposal-pre-uat.md` (the owner's decisions 2026-08-27) in the proposal's
landing order. compute.js, garden*.js and src/csv/ untouched; all four suites
green with zero fixture changes (1060 / 516 / 139 / 17). Data version stays 6.

**Trust & recovery (Phase 1):**
- **W3 Restore + Import**: `backups:list` / `data:restore` / `data:import-file`
  IPC — names regex-validated AND resolved inside `backups/`, content validated
  by `looksLikeBudget` (months array), the current file saved as
  `budget-prerestore-*` first, atomic write. Settings → Data → Restore… modal
  (UTC stamps shown as local time). **U12 trap**: the pending debounced save is
  cleared before `location.reload()`, or `beforeunload` would write the
  abandoned in-memory state over the just-restored file.
- **W4 month guard + undo**: closing a month that hasn't started warns and the
  button reads "Create X anyway"; the newest month is removable from Budget
  while it's future+empty (pop() is safe only because of that three-condition
  guard). U15: removal also closes the fund panel (stale indices).
- **W1 sign warning (warn, never change)**: `isExpenseFund` helper; a positive
  amount on an expense fund toasts at entry (amount OR fund branch) and carries
  a persistent quiet `money in` chip. The typed sign is never altered.
  Transfers and income funds are never marked; imported refunds chip-only.
- **W2 paycheck disconnect**: the fund panel tells the truth when a Standard
  fund's checks rule was cleared ("set by hand" + Reconnect button), the Budget
  row carries a `set by hand` chip, switching income type no longer deletes the
  checks config (orphaned entries are harmless), and both rule-clear sites
  toast the disconnect.

**Friction (Phase 2):** W5 transfer-pair delete (partner = same date/opposite
amount/same note, complementary vendor preferred never required — renames don't
rewrite vendor strings; higher index spliced first), plus a once-per-render edit
warning on transfer legs. W6 cross-month date edits move the transaction after
a confirm (or revert; nonexistent month → revert + toast). W7
`renameFundEverywhere()` shared by Settings and a new panel Rename action.
W8 "envelope"→"fund" outside the wizard (U20 stragglers included). W9 invalid
date entry keeps the typed text with `missing` styling (U10: `parseUserDate`
rejects impossible month/day and is now the single validator for both entry
points). W10 month picker dims on AUM.

**Polish (Phase 3):** W11 income ⊘ → `no tithe` chip (the glyph now has exactly
one meaning), W12 nav "Import CSV" → "Import" (dev.html mirrored), W13
Expand/Collapse label driven by allOpen, W15 empty Settings sub removed.
W14 (styled confirms) deferred by decision.

**Pre-UAT hardening:** U1 single-instance lock (verified: second exe launch
fronts the first window). U2 will-navigate + window-open blocked in main,
drag/drop guard + toast in the renderer. U3 `app:version` IPC — Settings shows
the version and Send feedback appends it to the draft body. U4 global
error/unhandledrejection surface (console + one rate-limited calm toast; never
renders). U5 export failures toast plainly. U6 `loadData` validates shape via
`looksLikeBudget` — a valid-JSON-but-wrong-shape file takes the backup ladder
(verified on the packaged build: `.corrupt` copy + fresh start). U8 income
hints behind a "?" `help-bubble` (copy relocated verbatim). U9 the rolling
backup block can no longer fail the whole save. U11 wizard dedupes across
files. U14 charts.js escapes category names. U16 year-qualified report labels
("Dec '25"). U17 Enter submits the transfer dialog. U18 new tx row gets focus.

**Distribution (U7, `_cowork\update-distribution-proposal.md` rev 2):**
electron-builder NSIS one-click installer (`npm run dist` → `dist-installer/`),
electron-updater in strictly-manual mode isolated in `updater.js` behind a
capability flag (full on win32, check-only elsewhere; renderer never reads
process.platform). appId `com.sowingseason.app` is permanent; productName must
stay exactly "Sowing Season" (keys `%APPDATA%\Sowing Season`). budgetAPI is now
**18 methods**. `npm run pack` still works — KEEP gained `updater.js` +
`node_modules` (prune strips devDeps; asar grew 0.4 → 3.2 MB). RELEASING.md +
TESTERS.md written. **Open blockers before any release/push**: GitHub
owner/repo (OWNER_TBD in package.json + updater.js), and a history scrub of
personal data from early commits (working tree scrubbed in U22/U23; history
rewrite awaits the repo decision). Both resolved 2026-08-27: repo is
sowingseasonapp/sowing-season and the full history scrub ran before first push.

**Traps hit this round:** the dist asar lock (Claude.exe handle) struck again —
recovered via dist-tmp package → robocopy `/XF app.asar` → shared-write
overwrite, SHA-256 + tree-count verified. PowerShell 5.1 `Get-Content`/
`Set-Content` round-trips mojibake UTF-8 (dev.html was restored from git and
re-edited with the proper tool) — never string-edit UTF-8 files via PS5.1.

## 2026-08-25 — App-wide watercolor pass: "moments + materials"

Implements `_cowork\proposal-watercolor-app-wide.md` in full (Cowork proposal,
POC approved by the owner at `_cowork\watercolor-app-wide-poc.html` — all art lifted
from it). Intensity level the owner chose: watercolor at empty states and ceremony
moments plus quiet materials; tables, buttons and inputs stay crisp. The restraint
contract is §1 of the proposal — test any future watercolor idea against it.

- **§2 Materials** (`styles.css`, `charts.js`): paper-grain tile on `body` — a
  pre-baked data-URI `feTurbulence` SVG at 4% alpha, cached background image,
  never a live filter or fixed overlay. Warm-shadow fixes: `.viz-tip` shadow and
  the chart hover wash go warm-ink `rgba(38,48,31,…)`, `.viz-bl-track` warm
  `#f0efe7`. One brushstroke swash under each view `h1` via `h1.view-title::after`
  (baked data-URI with inline displacement filters; `width: min(120px, 100%)` so
  the short AUM title isn't overshot). Applied to the six view h1s only — the
  wizard's h1s deliberately don't get the class.
- **§3 Charts** (`app.js` VIZ + `--viz-s1/s2`): `#2a78d6/#eb6834` →
  **`#3f7d96` pond blue / `#b8543a` terracotta**. Same CVD-safe blue↔orange
  axis; both ≥4.2:1 on white and parchment (old orange was 2.93:1 on parchment,
  below the 3:1 graphical minimum). Terracotta doubles as the wilt red on
  purpose (spending = money leaving); if it ever reads as scolding, the one-line
  swap is `--amber #8f6a1c`.
- **§4 In-view icon set** (`index.html` + `dev.html` defs, mirrored as always;
  `icon()` helper in app.js; `.si` CSS): eleven `si-*` glyphs replace the inline
  emoji (⚠💡📥💵📄🎉🏆🎯🧱📒🧺) at a **fixed 20px** (18px `.sm` floor in the
  review badge and basket streak). Same 120-unit frame and `nw*` washes as the
  nav icons — no new filters. Meaning-bearing uses carry `role="img"` +
  `aria-label`; decorative ones `aria-hidden`. **Two glyphs beyond the
  proposal's inventory** (it missed them): recap ✅ → `si-bloom`, 📈 →
  `ni-chart` (helper accepts `ni-` ids), so the wins list isn't mixed media.
  `✓ ✕ ▸ ▾ ·` and the 🗑 button stay text.
- **§5 Empty-state spots** (`src/spots.js`, new): basket+sprout (Transactions,
  true-empty only — filtered-empty keeps text), seed packets + bed sign (Budget,
  only when the whole month has zero expense funds, and only in the first empty
  category — one painting per screen), watering can + CSV (Import landing only,
  gone once a file is open), sapling (AUM <2 snapshots; the 1-snapshot caption
  is now "Two check-ins make a trend line…"). All reuse `#nav-wc*` via `nw*`
  classes — never unprefixed `#wc*`. Fund panel and AUM change log stay
  text-only on purpose.
- **§6 Ceremony**: one butterfly drifts in the month-close vignette's sky band —
  deterministic placement (hash of month id, `>>>` not `>>`: the signed shift
  went negative on hashes ≥2³¹ and pinned it at top:1%), existing `.flutter`
  keyframes (reduced-motion already zeroes them), animation class on the sprite
  `<svg>` element itself per the garden's compositor pattern. The wizard welcome
  step gets a **static** three-sprout `stripSvg` header. That's the entire
  motion budget outside the Garden.
- **§8b bug fix (pre-existing, found by the POC)**: a filtered element with a
  zero-height/width bbox isn't rendered at all (`objectBoundingBox` region
  collapses). `ni-clipboard`'s three ruled lines, `ni-receipt`'s four and
  `ni-import`'s vertical shaft were silently invisible in the shipped sidebar.
  Fixed with 2–3-unit curves (`M45,51 Q60,48 75,51`), which also reads more
  hand-painted. **Rule for all future filtered art: no axis-aligned stroked
  paths inside a wash class.**
- dev.html defs were synced from index.html programmatically (regex swap of the
  hidden-SVG block) — keep doing that rather than hand-mirroring.
- Verified in the dev harness: all six swashes, review strip + badge icons,
  import/AUM/transactions spots, recap with butterfly + icon wins + basket
  streak, wizard strip via `?blank=1`. Suites green: garden 139, csv 516,
  migrate 17.

## 2026-08-25 — Copy fixes: walkthrough & explanation language

Implements `_cowork\proposal-copy-fixes.md` (Cowork audit 2026-08-24, approved by
the owner) — all 30 edits: PASS 1 accuracy (H1–H6), PASS 2 beginner clarity (M1–M10),
PASS 3 polish (L1–L9), PASS 4 approved additions (O1–O3). Copy only, except the
approved `hint` parameter on `accordionHtml` that renders the income-group teaching
text as a visible paragraph when the section is open (O3). Files: `src/app.js`,
`src/csv/import.js`, `main.js`, `src/index.html`. No schema/data changes;
`garden.js` untouched (test-garden still 139/139; compute/csv/migrate suites green).

- The proposal's line number for H4 (`showTransferModal`) was ~2244; the code
  actually sits at ~244. The OLD string matched verbatim and uniquely, so per the
  proposal's own ground rule the edit went ahead.
- **O2 scope note:** the proposal touched `src/index.html` only; the AUM nav
  tooltip was mirrored into `src/dev.html` as a follow-up the same day (the owner:
  "fix whatever needs to be fixed"), keeping the index/dev mirror convention.
  dev.html is excluded from packaging, so no rebuild was needed for it.
- Verified in the dev harness (demo data): income hints render only when open,
  expense sections unchanged, transfer dialog / Year Overview / Settings tithe /
  garden maturity tooltip all show the new copy.
- **Repackaging trap:** `npm run pack` failed — the Claude desktop app held an
  open handle on `dist\…\resources\app.asar` (no delete/rename sharing), and the
  script's `rmSync` died *after* deleting the rest of the build, leaving a broken
  dist. Recovery: packaged to a temp dir, robocopied the build back, then — since
  the handle *did* allow read/write sharing — overwrote the stale asar's bytes in
  place (`File.Open(…, 'ReadWrite', share ReadWrite)` + `SetLength(0)` + write;
  SHA-256 verified). Tested along the way: this Electron (43) loads `app.asar`
  in **preference** to an unpacked `resources\app` dir, so the app-dir-override
  trick does not work — in-place byte replacement is the workaround when the
  asar is lock-pinned. Packaged exe smoke-tested against a scratch
  `BUDGET_DATA_DIR`.

## 2026-08-23 — Sidebar footer links: Ko-fi tip jar + feedback email

Implements `kofi-support-link-proposal.md` (Cowork rev 2, approved by the owner; real
Ko-fi handle supplied at implementation time, so the proposal's `<HANDLE>` placeholder
never entered the code). Two quiet always-available links under the save status:
**"Help keep the lights on"** → https://ko-fi.com/sowingseason and **"Send feedback"**
→ mailto:sowingseasonapp@gmail.com (subject pre-filled "Sowing Season feedback").
Pure chrome — no data, schema, or engine changes.

- **`src/index.html` / `src/dev.html`** (mirrored, as always): `.foot-links` row in
  `.sidebar-foot` with two `<button class="foot-link">`s — buttons, not `<a href>`,
  same pattern as the SeedTime link, so nothing for Electron to intercept.
- **`src/app.js`**: `KOFI_URL` / `FEEDBACK_MAILTO` constants next to
  `AUM_EPISODE_URL`; bound once in `enterApp()` with the other static-shell handlers.
- **`main.js`** — the one change outside the renderer: `shell:open-external` guard
  widened from https-only to `/^(?:https:\/\/|mailto:)[^\s]+$/i`. Still strictly
  scheme-allowlisted; `http:`/`file:`/`javascript:` and whitespace-bearing strings
  stay rejected (regex unit-checked incl. the SeedTime URL regression). `preload.js`
  untouched. Note: on a Windows box with no default mail app, the mailto click can
  appear to do nothing — accepted, the tooltip explains the action.
- **`src/styles.css`**: `.foot-link` styled as quiet text on the pine sidebar —
  the proposal's `--muted`/`--ink` vars don't exist here; used `--sidebar-ink`
  (hover → underline + `#fff`). Row wraps to two lines at the 230 px sidebar width
  rather than truncating (by design). No outline suppression — the default
  `:focus-visible` ring shows (verified visible on the pine).
- Verified in the dev harness: both links render/wrap, clicks reach `openExternal`
  with the exact URLs, Tab focus lands with a visible ring. (Enter-activation
  couldn't be exercised by the browser-pane tooling — its synthetic key events
  don't trigger native button activation on ANY button incl. nav — but these are
  plain `<button>`s, so it's Chromium default behavior.)

---

## 2026-08-23 — Watercolor sidebar icons (Option A)

Implements `_cowork/proposal-watercolor-nav-icons.md`: the 8 sidebar emoji (🌱 brand +
7 nav) replaced with procedural watercolor SVG icons lifted from the POC
(`_cowork/watercolor-nav-icons-poc.html`). The owner locked in **Option A** — washes
painted straight on the pine, no paper chips, no retint blocks. Pure chrome: no data,
schema, or engine changes; version stays 6.

- **`src/index.html`** (and its mirror **`src/dev.html`** — the dev harness serves the
  same sidebar markup and crashes at boot if it drifts): one hidden defs `<svg>` at the
  top of `<body>` with the four filters **namespaced `#nav-wc1/2/3`/`#nav-paper`** and
  the eight `ni-*` groups. Namespacing matters: `garden-scene.js` emits its own
  `#wc1–#wc3`/`#paper` inside each scene SVG; duplicate ids would resolve to whichever
  def comes first in document order. Icons are drawn in a 120-unit viewBox, rendered at
  20 px nav / 26 px brand (displacement 5–9 units ≈ 1–1.5 px on screen — calibrated,
  don't redraw in a small viewBox; detail strokes must be ≥ 7 units or they vanish).
  Pigments are CSS vars with Option-A fallbacks (`var(--cm,#efe6cc)` …) — they always
  resolve to fallbacks today but keep the retint machinery for a future in-view icon
  pass on light backgrounds.
- **`src/styles.css`**: `.nav-btn`/`.brand` became flex rows (gap 10/8 px), `.ni`
  sizes, and `.nw1/.nw2/.nw3 { filter:url(#nav-wc…) }`. Static chrome — no animation,
  nothing for reduced-motion.
- **`src/app.js`** (one line): the boot-time brand writer used
  `$('.brand').textContent = …`, which would destroy the icon node; it now writes
  `$('.brand-label')` only. `data-view` wiring untouched (app.js only toggles
  `.active` and binds clicks — verified no other sidebar content writers).
- Verified in the dev harness: all 8 icons render, no emoji left, nav clicks and the
  `appName` write behave, garden view unaffected. `test:garden` 139 / `test:migrate`
  17 pass; repackaged (asar 0.7 MB).

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
parser on those files. **The owner's follow-up**: on the next 2–3 real imports, review the
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
