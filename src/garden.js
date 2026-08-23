// The garden engine — a pure mapping from the data the app already computes to
// the state of the garden. In the spirit of compute.js: pure functions, no DOM,
// no persistence, no writes. app.js draws what this returns; tools/test-garden.mjs
// pins every rule.
//
// The one rule that keeps the garden from backfiring (proposal §"Design
// philosophy"): BEHAVIOURS DRIVE THE GARDEN, OUTCOMES DECORATE IT.
//  - Plants respond only to things the user controls right now: keeping funds
//    inside their envelopes, staying on pace, logging transactions, assigning
//    strays. Every plant state below is a fact fundFlags/computeMonth already
//    produce — nothing here invents a new judgement.
//  - AUM never wilts a plant. It drives the slow layers only: a seasonal tint
//    when it trends down, permanent wall stones when it reaches new highs.
//  - Nothing ever dies. The worst plant is wilted-but-recoverable; the worst
//    garden is a lean season. Maturity elements never regress.
//  - Every negative state ships with its remedy, as a one-click path to an
//    existing tool (transfer dialog, Budget, the unassigned flow).
//  - Copy never scolds. Banned in captions: "failed", "bad", "behind",
//    "should have". The voice is a patient fellow gardener.
//  - THE TWO-REGISTER RULE (v3): the picture speaks garden, the words speak
//    budget. `state`/`species`/`stage` are for the drawing. Every caption on
//    an actionable state is plain budget language, every action label names
//    the real tool it opens (Transfer…, Open Budget, Review N unassigned), and
//    `phrase` is the one-line plain state for tooltips. Garden phrasing
//    survives only in status-only text (season note, the calm affirmation).
import { computeMonth, fundFlags, normFund, r2 } from './compute.js';

// ---- tunables (first guesses — revisit after a month of living with it) ----
export const SEASON_WINDOW_DAYS = 90;   // compare the latest AUM snapshot to ~this far back
export const SEASON_MIN_SPAN_DAYS = 30; // need this much history before calling a trend
export const SEASON_FLAT_PCT = 0.01;    // |Δ| under 1% …
export const SEASON_FLAT_ABS = 100;     // … or under $100 either way is "steady"
export const VISIBLE_PLANT_CAP = 16;    // layoutBeds default; the scene passes what its beds physically fit (see garden-scene.js)
export const SCENE_PLANT_CEILING = 60;  // hard ceiling for the scene however wide the beds are
export const SOWN_TOLERANCE = 0.02;     // same rule as the Budget hero: ≤2¢ is rounding, not idle money
export const LATE_MONTH_PCT = 0.8;      // an on-pace pacing fund this late in the month is in bloom

// Permanent fixtures by months of history (data.months.length). Monotonic —
// months are never deleted, so these only ever appear.
export const MATURITY_MILESTONES = [
  { months: 3, id: 'path', label: 'a garden path' },
  { months: 6, id: 'fence', label: 'a picket fence' },
  { months: 12, id: 'arbor', label: 'an arbor' },
  { months: 18, id: 'pond', label: 'a pond' },
  { months: 24, id: 'hive', label: 'a bee hive' },
];
// Border tree size (0–4) steps with the count of closed months.
export const TREE_STEPS = [1, 3, 6, 12];

// Species per fund family. A fund keeps its species for life: the pick is a
// hash of its normalized name, never Math.random().
export const SPECIES = {
  rowcrop: ['lettuce', 'beans', 'carrot', 'tomato'],      // pacing → leafy row crops
  shrub: ['lavender', 'rosemary', 'sage', 'boxwood'],      // basic / fixed → sturdy shrubs & herbs
  fruit: ['apple', 'pear', 'cherry', 'plum'],              // savings goal → fruit tree, fruits in its target month
  evergreen: ['pine', 'spruce', 'cypress', 'juniper'],     // savings build → evergreen that keeps thickening
};

export const PLANT_STATES = ['planted', 'growing', 'blooming', 'thirsty', 'wilting', 'harvest', 'resting'];
// Which plants stay visible when a bed is over the cap: most attention-worthy first.
const STATE_PRIORITY = { wilting: 0, thirsty: 1, harvest: 2, blooming: 3, growing: 4, planted: 5, resting: 6 };

const money = (n) => '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// FNV-1a over the normalized name: stable across sessions and machines.
export function hashName(name) {
  let h = 0x811c9dc5;
  const s = normFund(name);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

export function familyOf(setup) {
  const s = setup || {};
  if (s.type === 'pacing') return 'rowcrop';
  if (s.type === 'savings') return s.savingsMode === 'build' ? 'evergreen' : 'fruit';
  return 'shrub';
}

export function speciesFor(name, setup) {
  const family = familyOf(setup);
  const list = SPECIES[family];
  return { family, species: list[hashName(name) % list.length] };
}

// Same calendar maths as fundFlags, exposed so the UI and tests agree on "done".
export function monthContext(monthId, todayISO) {
  const nowMonth = todayISO.slice(0, 7);
  const isCurrent = nowMonth === monthId;
  const [y, mo] = monthId.split('-').map(Number);
  const daysIn = new Date(y, mo, 0).getDate();
  const day = isCurrent ? Number(todayISO.slice(8, 10)) : daysIn;
  const monthPct = monthId > nowMonth ? 0 : isCurrent ? day / daysIn : 1;
  const monthDone = monthId < nowMonth || (isCurrent && day >= daysIn);
  return { nowMonth, isCurrent, isFuture: monthId > nowMonth, daysIn, day, monthPct, monthDone };
}

// Captions: plain budget language on anything actionable; a light garden
// phrase is allowed only where nothing is asked of the user (blooming).
const CAPTIONS = {
  planted: 'Planned — no spending yet.',
  growing: 'On plan so far.',
  blooming: 'In bloom — finished on plan.',
  thirsty: 'Spending faster than planned — on pace to go over.',
  resting: '',
};
// The one-phrase plain state for tooltips ("numbers, not poetry").
const PHRASES = {
  planted: 'no spending yet',
  growing: 'on plan',
  blooming: 'finished on plan',
  thirsty: 'on pace to go over',
  resting: 'nothing planned',
};
// Action labels name the tool they open — the only labels the engine emits.
export const ACTION_LABELS = {
  transfer: 'Transfer…',
  budget: 'Open Budget',
  import: 'Open Import',
  unassigned: (n) => `Review ${n} unassigned`,
  useActual: 'Use actual',
  setup: 'Finish setting up',
};

// One fund → one plant. `f` is a computed fund (computeMonth), `flag` its
// fundFlags entry (or undefined), `txCount` its negative-amount transactions.
export function plantFor(f, category, flag, ctx, txCount) {
  const s = f.setup || {};
  const { family, species } = speciesFor(f.fund, s);
  const spent = f.expensed < 0 ? r2(-f.expensed) : 0;
  const budget = r2(f.carryOver + f.planned);
  const hasActivity = txCount > 0 || Math.abs(f.expensed) > 0.004;

  let state;
  if (flag && flag.attention === 'exceeded') state = 'wilting';
  else if (flag && flag.attention === 'pace') state = 'thirsty';
  else if (flag && flag.offset) state = 'harvest';
  else if (Math.abs(budget) <= 0.004 && !hasActivity) state = 'resting';
  else if (ctx.monthDone && f.leftover >= -0.004) state = 'blooming';
  else if (flag && flag.pace === 'on' && ctx.monthPct >= LATE_MONTH_PCT) state = 'blooming';
  else if (!hasActivity) state = 'planted';
  else state = 'growing';

  // Growth stage 0–3 for the drawing. Savings grow with their pot, not the
  // calendar: a fruit tree by progress toward its goal, an evergreen by how
  // much has been set aside.
  let progress = ctx.monthPct;
  if (s.type === 'savings') {
    if (s.savingsMode === 'build') {
      const span = s.buildGoal > 0 ? s.buildGoal : (s.monthlyAmount || 0) * 12;
      progress = span > 0 ? Math.min(1, Math.max(0, f.carryOver) / span) : (f.carryOver > 0 ? 1 : 0);
    } else if (s.targetAmount > 0) {
      progress = Math.min(1, Math.max(0, budget) / s.targetAmount);
    }
  }
  let stage;
  if (state === 'resting') stage = 0;
  else if (state === 'planted') stage = s.type === 'savings' ? Math.min(2, Math.floor(progress * 3)) : 0;
  else if (state === 'growing') stage = progress < 0.5 ? 1 : 2;
  else if (state === 'blooming' || state === 'harvest') stage = 3;
  else stage = 2; // thirsty / wilting: a grown plant that needs water
  if (s.type === 'savings' && (state === 'growing' || state === 'planted')) stage = Math.max(stage, Math.min(2, Math.floor(progress * 3)));

  let caption = CAPTIONS[state], phrase = PHRASES[state], action = null;
  // Clicking any plant opens that fund in Budget (§3); `action` is the named
  // remedy for the states that have one, `jump` the click target for all.
  const jump = { kind: 'budget', fund: f.fund, category, label: ACTION_LABELS.budget };
  if (state === 'wilting') {
    caption = `Over by ${money(f.leftover)} — a transfer covers it.`;
    phrase = `${money(f.leftover)} over`;
    action = { kind: 'transfer', to: f.fund, label: ACTION_LABELS.transfer };
  } else if (state === 'harvest') {
    caption = `${money(f.leftover)} unspent — free to move.`;
    phrase = `${money(f.leftover)} unspent`;
    action = { kind: 'transfer', from: f.fund, label: ACTION_LABELS.transfer };
  } else if (state === 'thirsty') {
    action = jump;
  }

  return {
    fund: f.fund, category, family, species, state, stage, progress: r2(progress),
    caption, phrase, action, jump, type: s.type || 'basic',
    planned: f.planned, carryOver: f.carryOver, spent, leftover: f.leftover, budget,
  };
}

// Variable-income true-up nudges (shared with the Budget page's review strip).
// Over-received nudges any time; under-received only once the month is done —
// mid-month a low number just means checks haven't landed yet.
export function incomeCheckIns(month, comp, todayISO) {
  const { monthDone } = monthContext(month.id, todayISO);
  const out = [];
  for (const f of comp.income) {
    if ((f.group || 'bonus') !== 'standard') continue;
    if (!(f.rule && f.rule.type === 'checks')) continue; // planned overridden by hand — the estimate no longer drives it
    const chk = (month.checks || {})[f.fund];
    if (!chk || !chk.variable || !(chk.count > 0)) continue;
    const diff = r2(f.received - f.planned);
    if (diff > 1 || (diff < -1 && monthDone)) out.push({ fund: f.fund, diff });
  }
  return out;
}

// ---- season (the AUM linkage: light and colour only) ----
const dayNum = (iso) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);

export function seasonFor(snapshots) {
  const steady = { kind: 'steady', note: '', delta: null, from: null, to: null };
  const snaps = (snapshots || []).filter((s) => s && typeof s.date === 'string' && typeof s.aum === 'number');
  if (snaps.length < 2) return steady;
  const last = snaps[snaps.length - 1];
  const target = dayNum(last.date) - SEASON_WINDOW_DAYS;
  let ref = null, best = Infinity;
  for (const s of snaps.slice(0, -1)) {
    const d = Math.abs(dayNum(s.date) - target);
    if (d < best) { best = d; ref = s; }
  }
  if (!ref || dayNum(last.date) - dayNum(ref.date) < SEASON_MIN_SPAN_DAYS) return steady;
  const delta = r2(last.aum - ref.aum);
  const flat = Math.abs(delta) < SEASON_FLAT_ABS || Math.abs(delta) < SEASON_FLAT_PCT * Math.abs(ref.aum);
  if (flat) return { ...steady, delta, from: ref.date, to: last.date };
  if (delta > 0) {
    return { kind: 'growing', delta, from: ref.date, to: last.date,
      note: 'A growing season — what you manage has grown over the last few months. The light is on your side.' };
  }
  return { kind: 'lean', delta, from: ref.date, to: last.date,
    note: 'A lean season — they happen to every garden. Keep tending; roots grow deepest in winter.' };
}

// ---- maturity (permanent; only ever grows) ----
// Wall stones: one per all-time-high snapshot — an entry strictly greater than
// every entry before it. The first snapshot has nothing before it and counts
// (the foundation stone). A later drop never removes a stone: what you built
// stays built.
export function allTimeHighs(snapshots) {
  let max = -Infinity, n = 0;
  for (const s of snapshots || []) {
    if (!s || typeof s.aum !== 'number') continue;
    if (s.aum > max) { n++; max = s.aum; }
  }
  return n;
}
// Stones laid during one month (for the harvest recap).
export function stonesLaidIn(snapshots, monthId) {
  let max = -Infinity, n = 0;
  for (const s of snapshots || []) {
    if (!s || typeof s.aum !== 'number') continue;
    if (s.aum > max) { if ((s.date || '').slice(0, 7) === monthId) n++; max = s.aum; }
  }
  return n;
}

export function maturityFor(data, todayISO) {
  const monthsTended = data.months.length;
  const nowMonth = todayISO.slice(0, 7);
  const monthsClosed = data.months.filter((m) => m.id < nowMonth).length;
  let treeSize = 0;
  for (const step of TREE_STEPS) if (monthsClosed >= step) treeSize++;
  const fixtures = MATURITY_MILESTONES.filter((m) => monthsTended >= m.months).map((m) => m.id);
  const stones = allTimeHighs(data.aum && data.aum.snapshots);
  const next = MATURITY_MILESTONES.find((m) => monthsTended < m.months) || null;
  return { monthsTended, monthsClosed, treeSize, fixtures, stones, level: fixtures.length + treeSize, next };
}

// Consecutive sown months ending at `uptoId` (inclusive).
export function sownStreak(data, uptoId) {
  const ids = data.months.map((m) => m.id).filter((id) => id <= uptoId).sort().reverse();
  let n = 0;
  for (const id of ids) {
    const m = data.months.find((x) => x.id === id);
    const left = computeMonth(m).summary.leftToAllocate;
    if (Math.abs(left) <= SOWN_TOLERANCE) n++; else break;
  }
  return n;
}

// ---- the scene cap ----
// Beds keep data order; within a bed the visible plants are the most
// attention-worthy, then shown in fund order. Every bed with plants keeps at
// least one; the remaining slots go to the bigger beds (largest remainder).
export function layoutBeds(beds, cap = VISIBLE_PLANT_CAP, perBed = Infinity) {
  const live = beds.filter((b) => b.plants.length);
  const total = live.reduce((a, b) => a + b.plants.length, 0);
  if (total <= cap && live.every((b) => b.plants.length <= perBed)) {
    return live.map((b) => ({ ...b, visible: b.plants, hidden: 0, total: b.plants.length }));
  }
  const quota = live.map(() => 1);
  let left = cap - live.length;
  if (left < 0) left = 0; // more beds than slots: one plant each, overflow is shown as "+N"
  const want = live.map((b) => Math.min(b.plants.length, perBed) - 1);
  const wantTotal = want.reduce((a, w) => a + w, 0);
  const share = want.map((w) => (wantTotal ? (w / wantTotal) * left : 0));
  const floor = share.map(Math.floor);
  let given = floor.reduce((a, x) => a + x, 0);
  floor.forEach((x, i) => { quota[i] += x; });
  // largest remainder, ties by bed order
  const order = share.map((s, i) => ({ i, rem: s - floor[i] })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of order) {
    if (given >= left) break;
    if (quota[i] < Math.min(live[i].plants.length, perBed)) { quota[i]++; given++; }
  }
  return live.map((b, i) => {
    const n = Math.min(quota[i], b.plants.length, perBed);
    const ranked = b.plants.map((p, idx) => ({ p, idx }))
      .sort((x, y) => STATE_PRIORITY[x.p.state] - STATE_PRIORITY[y.p.state] || x.idx - y.idx)
      .slice(0, n).sort((x, y) => x.idx - y.idx).map((x) => x.p);
    return { ...b, visible: ranked, hidden: b.plants.length - ranked.length, total: b.plants.length };
  });
}

// ---- the whole state ----
export function gardenState(data, { monthId, todayISO }) {
  const month = data.months.find((m) => m.id === monthId);
  if (!month) return null;
  const comp = computeMonth(month);
  const ctx = monthContext(month.id, todayISO);
  const flags = fundFlags(month, comp, todayISO);
  const flagMap = {};
  for (const x of flags) flagMap[normFund(x.fund)] = x;
  const txCount = {};
  for (const t of month.transactions) {
    if (t.amount >= 0) continue;
    const k = normFund(t.fund);
    if (k) txCount[k] = (txCount[k] || 0) + 1;
  }

  const beds = [];
  const plants = [];
  comp.categories.forEach((c, ci) => {
    if (c.excludeFromTotals) return; // Work: no plants, same as every other insight surface
    const bed = { category: c.name, ci, plants: [] };
    c.funds.forEach((f, fi) => {
      if (f.setup && f.setup.excludeInsights) return; // quiet funds simply don't grow plants
      const p = plantFor(f, c.name, flagMap[normFund(f.fund)], ctx, txCount[normFund(f.fund)] || 0);
      p.ci = ci; p.fi = fi;
      bed.plants.push(p); plants.push(p);
    });
    beds.push(bed);
  });

  const counts = {};
  for (const st of PLANT_STATES) counts[st] = 0;
  for (const p of plants) counts[p.state]++;

  const weeds = comp.unassigned.length;
  const left = comp.summary.leftToAllocate;
  const sown = Math.abs(left) <= SOWN_TOLERANCE;
  const checkIns = incomeCheckIns(month, comp, todayISO);
  const season = seasonFor(data.aum && data.aum.snapshots);
  const maturity = maturityFor(data, todayISO);

  // ≤3 encouragement lines, most useful first. Each carries its one-click remedy.
  const messages = [];
  const names = (list) => list.slice(0, 3).map((p) => `"${p.fund}"`).join(', ') + (list.length > 3 ? ` and ${list.length - 3} more` : '');
  if (weeds) {
    messages.push({ kind: 'weeds', text: weeds === 1
      ? '1 transaction this month has no fund yet.'
      : `${weeds} transactions this month have no fund yet.`,
      action: { kind: 'unassigned', label: ACTION_LABELS.unassigned(weeds) } });
  }
  const wilting = plants.filter((p) => p.state === 'wilting');
  if (wilting.length) {
    const first = wilting[0];
    const over = r2(wilting.reduce((a, p) => a + p.leftover, 0));
    messages.push({ kind: 'wilting', text: wilting.length === 1
      ? `"${first.fund}" is ${money(first.leftover)} over — a transfer from a fund with money to spare covers it.`
      : `${names(wilting)} are over — ${money(over)} in all. A transfer from a fund with money to spare covers each one.`,
      action: { kind: 'transfer', to: first.fund, label: ACTION_LABELS.transfer } });
  }
  const thirsty = plants.filter((p) => p.state === 'thirsty');
  if (thirsty.length) {
    const first = thirsty[0];
    messages.push({ kind: 'thirsty', text: thirsty.length === 1
      ? `"${first.fund}" is spending faster than planned — on pace to go over this month.`
      : `${names(thirsty)} are spending faster than planned — on pace to go over this month.`,
      action: { kind: 'budget', fund: first.fund, category: first.category, label: ACTION_LABELS.budget } });
  }
  const harvest = plants.filter((p) => p.state === 'harvest');
  if (harvest.length) {
    const first = harvest[0];
    const free = r2(harvest.reduce((a, p) => a + p.leftover, 0));
    messages.push({ kind: 'harvest', text: harvest.length === 1
      ? `"${first.fund}" has ${money(first.leftover)} unspent — free to move wherever it's needed.`
      : `${harvest.length} funds have ${money(free)} unspent between them — free to move: ${names(harvest)}.`,
      action: { kind: 'transfer', from: first.fund, label: ACTION_LABELS.transfer } });
  }
  for (const c of checkIns) {
    messages.push({ kind: 'checkin', text: `Checks for "${c.fund}" came in ${money(c.diff)} ${c.diff > 0 ? 'over' : 'under'} the estimate — update the plan to what really arrived.`,
      action: { kind: 'useActual', fund: c.fund, label: ACTION_LABELS.useActual } });
  }
  const checklist = data.settings && data.settings.setupChecklist;
  if (Array.isArray(checklist) && checklist.some((i) => !i.done)) {
    messages.push({ kind: 'setup', text: 'A few setup steps are still waiting on the Budget page.',
      action: { kind: 'budget', label: ACTION_LABELS.setup } });
  }
  if (!sown && !ctx.isFuture) {
    messages.push({ kind: 'unsown', text: left > 0
      ? `${money(left)} still to allocate — income not yet assigned to a fund.`
      : `${money(left)} more planned than this month's income.`,
      action: { kind: 'budget', label: ACTION_LABELS.budget } });
  }
  if (!messages.length) {
    // Status-only, so a light garden line is fine here.
    messages.push({ kind: 'calm', text: ctx.isFuture
      ? 'Freshly sown beds — this month hasn\'t started yet. Nothing needs you today.'
      : 'Everything\'s on plan. Nothing needs you today.', action: null });
  }

  return {
    monthId: month.id, ctx, plants, beds, counts, weeds, season, maturity, sown,
    leftToAllocate: left, checkIns, messages: messages.slice(0, 3),
  };
}
