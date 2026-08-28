// Garden engine tests — fixture months exercising every plant state, the
// season layer, maturity milestones, the scene cap and the message ladder.
// Self-contained (synthetic data). Run: npm run test:garden
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  gardenState, plantFor, speciesFor, familyOf, hashName, seasonFor, allTimeHighs,
  stonesLaidIn, maturityFor, sownStreak, layoutBeds, incomeCheckIns, monthContext,
  SPECIES, PLANT_STATES, VISIBLE_PLANT_CAP, MATURITY_MILESTONES, ACTION_LABELS,
} from '../src/garden.js';
import { sceneSvg, stripSvg, filterDefs, plantSprite, PALETTE_TOKENS, applyPalette, ambientPlan } from '../src/garden-scene.js';

let pass = 0, fail = 0;
const failures = [];
const check = (name, cond, detail = '') => {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ': ' + detail : ''}`); }
};

const TODAY = '2026-08-15'; // mid-month; August has 31 days → monthPct ≈ 0.48
const setup = (type, extra = {}) => ({ type, everyMonths: 1, totalAmount: 0, targetAmount: 0, targetMonth: null, savingsMode: 'target', monthlyAmount: 0, buildGoal: 0, excludeInsights: false, ...extra });
const fund = (name, planned, type = 'basic', extra = {}) => ({ fund: name, carryOver: 0, planned, rule: null, yearlyCharge: null, setup: setup(type, extra.setup || {}), ...(extra.fund || {}) });
const tx = (fundName, amount, date = '2026-08-10', more = {}) => ({ id: 'x' + Math.random(), date, vendor: 'Shop', amount, fund: fundName, description: '', account: '', ...more });

function makeMonth(id, { categories, income, transactions = [] }) {
  return { id, label: id, checks: {}, income: income || [{ fund: 'Pay', carryOver: 0, planned: 1000, rule: null, group: 'bonus' }], categories, transactions };
}

// ---- 1. Every plant state in one current month ----
{
  const month = makeMonth('2026-08', {
    income: [{ fund: 'Pay', carryOver: 0, planned: 1100, rule: null, group: 'bonus' }],
    categories: [
      { name: 'Everyday', excludeFromTotals: false, funds: [
        fund('Groceries', 400, 'pacing'),          // thirsty: spending projected to overrun
        fund('Gas', 100, 'pacing'),                // growing: within envelope, in progress
        fund('Fun', 100, 'pacing'),                // planted: nothing spent yet
      ] },
      { name: 'Bills', excludeFromTotals: false, funds: [
        fund('Electric', 100, 'basic'),            // harvest: paid, money left
        fund('Water', 50, 'basic'),                // wilting: over
        fund('Unused', 0, 'basic'),                // resting
        fund('Quiet', 100, 'basic', { setup: { excludeInsights: true } }), // no plant
      ] },
      { name: 'Work', excludeFromTotals: true, funds: [fund('Work Expenses', 250)] }, // no plants
    ],
    transactions: [
      tx('Groceries', -300, '2026-08-12'),  // 300 of 400 by mid-month → projected 620 → off pace
      tx('Gas', -30),
      tx('Electric', -80),
      tx('Water', -60),
      tx('Quiet', -10),
      tx('Mystery', -12),                   // weed (unassigned)
      tx('', -5),                           // weed (blank fund)
    ],
  });
  const data = { version: 6, settings: {}, months: [month], aum: { assets: [], debts: [], snapshots: [], log: [] } };
  const g = gardenState(data, { monthId: '2026-08', todayISO: TODAY });
  const st = Object.fromEntries(g.plants.map((p) => [p.fund, p.state]));
  check('thirsty (off pace)', st.Groceries === 'thirsty', st.Groceries);
  check('growing', st.Gas === 'growing', st.Gas);
  check('planted', st.Fun === 'planted', st.Fun);
  check('harvest', st.Electric === 'harvest', st.Electric);
  check('wilting', st.Water === 'wilting', st.Water);
  check('resting', st.Unused === 'resting', st.Unused);
  check('excludeInsights grows no plant', !('Quiet' in st));
  check('Work grows no plant', !('Work Expenses' in st) && !g.beds.some((b) => b.category === 'Work'));
  check('weeds = unassigned count', g.weeds === 2, String(g.weeds));
  check('sown: 1100 income vs 850 planned → not sown', g.sown === false && Math.abs(g.leftToAllocate - 250) < 0.01, String(g.leftToAllocate));
  check('counts', g.counts.thirsty === 1 && g.counts.growing === 1 && g.counts.planted === 1 && g.counts.harvest === 1 && g.counts.wilting === 1 && g.counts.resting === 1, JSON.stringify(g.counts));
  check('no AUM data → steady, no note', g.season.kind === 'steady' && g.season.note === '');
  check('stages', g.plants.find((p) => p.fund === 'Fun').stage === 0 && g.plants.find((p) => p.fund === 'Gas').stage === 1
    && g.plants.find((p) => p.fund === 'Electric').stage === 3 && g.plants.find((p) => p.fund === 'Water').stage === 2,
    JSON.stringify(g.plants.map((p) => [p.fund, p.stage])));

  // Captions + actions
  const by = Object.fromEntries(g.plants.map((p) => [p.fund, p]));
  check('harvest caption: plain money, free to move', by.Electric.caption === '$20.00 unspent — free to move.', by.Electric.caption);
  check('harvest action = Transfer… from fund', by.Electric.action.kind === 'transfer' && by.Electric.action.from === 'Electric' && by.Electric.action.label === 'Transfer…');
  check('wilting caption: over by money, a transfer covers it', by.Water.caption === 'Over by $10.00 — a transfer covers it.', by.Water.caption);
  check('wilting action = Transfer… to fund', by.Water.action.kind === 'transfer' && by.Water.action.to === 'Water' && by.Water.action.label === 'Transfer…');
  check('thirsty caption is plain budget language', by.Groceries.caption === 'Spending faster than planned — on pace to go over.', by.Groceries.caption);
  check('thirsty action = Open Budget at the fund', by.Groceries.action.kind === 'budget' && by.Groceries.action.fund === 'Groceries' && by.Groceries.action.category === 'Everyday' && by.Groceries.action.label === 'Open Budget');
  check('planted/growing captions per spec', by.Fun.caption === 'Planned — no spending yet.' && by.Gas.caption === 'On plan so far.', by.Fun.caption + ' | ' + by.Gas.caption);
  check('status-only states carry no action', by.Fun.action === null && by.Gas.action === null && by.Unused.action === null);
  check('every plant has a Budget jump', g.plants.every((p) => p.jump && p.jump.kind === 'budget' && p.jump.fund === p.fund && p.jump.category === p.category));
  check('tooltip phrases are numbers, not poetry', by.Water.phrase === '$10.00 over' && by.Electric.phrase === '$20.00 unspent' && by.Groceries.phrase === 'on pace to go over' && by.Gas.phrase === 'on plan' && by.Fun.phrase === 'no spending yet' && by.Unused.phrase === 'nothing planned',
    JSON.stringify(g.plants.map((p) => [p.fund, p.phrase])));
  check('resting has no caption', by.Unused.caption === '');

  // Message ladder: weeds → wilting → thirsty → harvest → … capped at 3
  check('messages capped at 3', g.messages.length === 3, String(g.messages.length));
  check('message priority', g.messages.map((m) => m.kind).join(',') === 'weeds,wilting,thirsty', g.messages.map((m) => m.kind).join(','));
  check('weeds action names its destination', g.messages[0].action.kind === 'unassigned' && g.messages[0].action.label === 'Review 2 unassigned', g.messages[0].action.label);
  check('weeds text is plain', g.messages[0].text === '2 transactions this month have no fund yet.', g.messages[0].text);
  check('wilting message carries remedy', /a transfer from a fund with money to spare covers it/.test(g.messages[1].text) && g.messages[1].action.to === 'Water' && g.messages[1].action.label === 'Transfer…', g.messages[1].text);
  check('thirsty message is plain + Open Budget', /spending faster than planned/.test(g.messages[2].text) && g.messages[2].action.label === 'Open Budget', g.messages[2].text);

  // Two-register audit: the words on anything actionable speak budget, never garden.
  const ALLOWED_LABEL = /^(Transfer…|Open Budget|Open Import|Review \d+ unassigned|Use actual|Finish setting up)$/;
  const METAPHOR = /\b(water(s|ed|ing)?|harvest|replant|weeds?|sow|sown|bloom(ing)?|wilt(ed|ing)?|thirsty|tend(ing)?|garden|bed|seed|plant|drink(ing)?)\b/i;
  const actionable = [...g.plants.filter((p) => p.action).map((p) => ({ where: p.fund, text: p.caption, label: p.action.label })),
    ...g.messages.filter((m) => m.action).map((m) => ({ where: m.kind, text: m.text, label: m.action.label }))];
  check('two-register: every action label names its destination', actionable.every((a) => ALLOWED_LABEL.test(a.label)), actionable.filter((a) => !ALLOWED_LABEL.test(a.label)).map((a) => a.label).join(' | '));
  const stripNames = (t) => t.replace(/"[^"]*"/g, '"…"'); // fund names are user data, not copy
  check('two-register: no metaphor in actionable text', !actionable.some((a) => METAPHOR.test(stripNames(a.text))), actionable.filter((a) => METAPHOR.test(stripNames(a.text))).map((a) => a.text).join(' | '));
  check('two-register: no metaphor in tooltip phrases', !g.plants.some((p) => METAPHOR.test(p.phrase)), g.plants.map((p) => p.phrase).join(' | '));
  check('ACTION_LABELS exported for the UI', ACTION_LABELS.transfer === 'Transfer…' && ACTION_LABELS.unassigned(3) === 'Review 3 unassigned');

  // Copy never scolds
  const banned = /\b(failed|bad|behind|should have)\b/i;
  const allText = [...g.plants.map((p) => p.caption), ...g.messages.map((m) => m.text), g.season.note];
  check('no banned words', !allText.some((t) => banned.test(t)), allText.filter((t) => banned.test(t)).join(' | '));

  // Future month of the same data: every budgeted fund is freshly sown
  const future = gardenState({ ...data, months: [{ ...month, id: '2026-09', transactions: [] }] }, { monthId: '2026-09', todayISO: TODAY });
  check('future month → planted (except resting)', future.plants.every((p) => p.state === 'planted' || (p.state === 'resting' && p.fund === 'Unused')),
    JSON.stringify(future.plants.map((p) => [p.fund, p.state])));
  check('future month calm message', future.messages.length === 1 && future.messages[0].kind === 'calm' && /Freshly sown/.test(future.messages[0].text));
}

// ---- 2. Blooming: month done / pacing on pace late-month ----
{
  const past = makeMonth('2026-06', {
    categories: [{ name: 'Bills', excludeFromTotals: false, funds: [fund('Rent', 900, 'basic'), fund('Sub', 10, 'fixed', { setup: { everyMonths: 1, totalAmount: 10 } })] }],
    transactions: [tx('Rent', -900, '2026-06-02')], // exactly spent → leftover 0, no offset (needs >0) → blooming
  });
  const data = { version: 6, settings: {}, months: [past], aum: { assets: [], debts: [], snapshots: [], log: [] } };
  const g = gardenState(data, { monthId: '2026-06', todayISO: TODAY });
  const st = Object.fromEntries(g.plants.map((p) => [p.fund, p.state]));
  check('past month exact spend → blooming', st.Rent === 'blooming', st.Rent);
  check('past month untouched fixed fund → blooming (no tx → not offset)', st.Sub === 'blooming', st.Sub);
  check('past month calm message (sown 1000 vs 910? no → unsown)', g.messages[0].kind === 'unsown' && g.messages[0].text === '$90.00 still to allocate — income not yet assigned to a fund.' && g.messages[0].action.label === 'Open Budget', g.messages[0].text);

  // Late-month pacing fund on pace → blooming
  const cur = makeMonth('2026-08', {
    categories: [{ name: 'Everyday', excludeFromTotals: false, funds: [fund('Groceries', 400, 'pacing')] }],
    transactions: [tx('Groceries', -300, '2026-08-20')],
  });
  const g2 = gardenState({ ...data, months: [cur] }, { monthId: '2026-08', todayISO: '2026-08-28' });
  check('pacing on pace late-month → blooming', g2.plants[0].state === 'blooming', g2.plants[0].state);
  const mid = { ...cur, transactions: [tx('Groceries', -200, '2026-08-18')] }; // 200/0.645 → 310 projected: on pace
  const g3 = gardenState({ ...data, months: [mid] }, { monthId: '2026-08', todayISO: '2026-08-20' });
  check('same fund mid-month on pace → growing', g3.plants[0].state === 'growing', g3.plants[0].state);
}

// ---- 3. Species: deterministic, by family ----
{
  check('pacing → rowcrop', familyOf({ type: 'pacing' }) === 'rowcrop');
  check('basic → shrub', familyOf({ type: 'basic' }) === 'shrub' && familyOf(null) === 'shrub');
  check('fixed → shrub', familyOf({ type: 'fixed' }) === 'shrub');
  check('savings target → fruit', familyOf({ type: 'savings' }) === 'fruit' && familyOf({ type: 'savings', savingsMode: 'target' }) === 'fruit');
  check('savings build → evergreen', familyOf({ type: 'savings', savingsMode: 'build' }) === 'evergreen');
  const a = speciesFor('Groceries', { type: 'pacing' }), b = speciesFor('  GROCERIES ', { type: 'pacing' });
  check('species stable across case/whitespace', a.species === b.species && SPECIES.rowcrop.includes(a.species));
  check('hash is stable', hashName('Groceries') === hashName('groceries') && hashName('Gas') !== hashName('Groceries'));
  const seen = new Set(['Groceries', 'Gas', 'Fast Food', 'Restaurants', 'Coffee Shops', 'Essentials', 'Misc'].map((n) => speciesFor(n, { type: 'pacing' }).species));
  check('hash spreads across the species set', seen.size >= 3, [...seen].join(','));
}

// ---- 4. Savings plants grow with their pot ----
{
  const ctx = monthContext('2026-08', TODAY);
  const goal = { fund: 'Christmas', carryOver: 500, planned: 100, expensed: 0, leftover: 600, setup: setup('savings', { targetAmount: 1200, targetMonth: '2026-12' }) };
  const p = plantFor(goal, 'Savings', undefined, ctx, 0);
  check('goal fund half-way → planted at stage 1', p.state === 'planted' && p.stage === 1 && Math.abs(p.progress - 0.5) < 0.01, JSON.stringify([p.state, p.stage, p.progress]));
  const build = { fund: 'Safety Net', carryOver: 2400, planned: 100, expensed: 0, leftover: 2500, setup: setup('savings', { savingsMode: 'build', monthlyAmount: 100 }) };
  const q = plantFor(build, 'Savings', undefined, ctx, 0);
  check('build fund two years deep → stage 2 evergreen', q.family === 'evergreen' && q.stage === 2 && q.progress === 1, JSON.stringify([q.family, q.stage, q.progress]));
}

// ---- 5. Seasons ----
{
  const snap = (date, aum) => ({ date, assets: aum, debts: 0, aum });
  check('no snapshots → steady', seasonFor([]).kind === 'steady' && seasonFor(null).kind === 'steady');
  check('one snapshot → steady', seasonFor([snap('2026-08-01', 1000)]).kind === 'steady');
  check('two snapshots 10 days apart → steady (too short)', seasonFor([snap('2026-08-01', 1000), snap('2026-08-11', 5000)]).kind === 'steady');
  const rising = seasonFor([snap('2026-05-01', 10000), snap('2026-06-01', 10500), snap('2026-08-01', 12000)]);
  check('rising → growing, compares to the snapshot nearest 90 days back', rising.kind === 'growing' && rising.from === '2026-05-01' && rising.delta === 2000, JSON.stringify(rising));
  const falling = seasonFor([snap('2026-05-01', 12000), snap('2026-08-01', 9000)]);
  check('falling → lean with the winter note', falling.kind === 'lean' && /roots grow deepest in winter/.test(falling.note));
  check('flat within $100 → steady', seasonFor([snap('2026-05-01', 12000), snap('2026-08-01', 12080)]).kind === 'steady');
  check('flat within 1% → steady', seasonFor([snap('2026-05-01', 100000), snap('2026-08-01', 99200)]).kind === 'steady');
  check('−1.5% of 100k → lean', seasonFor([snap('2026-05-01', 100000), snap('2026-08-01', 98500)]).kind === 'lean');
  check('nearest-to-90-days picks the right reference', seasonFor([snap('2026-01-01', 1), snap('2026-05-05', 12000), snap('2026-07-25', 12000), snap('2026-08-01', 9000)]).from === '2026-05-05');
}

// ---- 6. Maturity: monotonic, AUM-drop-proof ----
{
  const snap = (date, aum) => ({ date, aum });
  check('ATH stones: 1,3,2,5,4 → 3 (first counts as the foundation stone)', allTimeHighs([snap('a', 1), snap('b', 3), snap('c', 2), snap('d', 5), snap('e', 4)]) === 3);
  check('ATH stones never decrease on a drop', allTimeHighs([snap('a', 5), snap('b', 4), snap('c', 3)]) === 1);
  check('stones laid in a month', stonesLaidIn([snap('2026-07-02', 1), snap('2026-08-03', 2), snap('2026-08-20', 1.5), snap('2026-08-25', 3)], '2026-08') === 2);
  const monthsOf = (n, from = '2025-12') => {
    const out = []; let [y, m] = from.split('-').map(Number);
    for (let i = 0; i < n; i++) { out.push({ id: `${y}-${String(m).padStart(2, '0')}`, categories: [], income: [], transactions: [], checks: {} }); m++; if (m > 12) { m = 1; y++; } }
    return out;
  };
  const mk = (n, snaps = [], today = TODAY) => maturityFor({ months: monthsOf(n), aum: { snapshots: snaps } }, today);
  check('2 months → nothing yet', mk(2).fixtures.length === 0 && mk(2).next.id === 'path');
  check('3 months → path', mk(3).fixtures.join() === 'path');
  check('9 months (the owner) → path,fence; 8 closed → tree 3', mk(9).fixtures.join() === 'path,fence' && mk(9).monthsClosed === 8 && mk(9).treeSize === 3, JSON.stringify(mk(9)));
  check('12 → arbor', mk(12).fixtures.includes('arbor') && mk(12).treeSize === 3);
  check('13 months, all closed (Jan 2027) → tree 4', mk(13, [], '2027-01-15').treeSize === 4 && mk(13, [], '2027-01-15').monthsClosed === 13);
  check('24 → every milestone', mk(24).fixtures.length === MATURITY_MILESTONES.length && mk(24).next === null);
  check('level = fixtures + tree', mk(9).level === 5);
  const before = mk(9, [snap('2026-06-01', 100), snap('2026-07-01', 200)]);
  const after = mk(9, [snap('2026-06-01', 100), snap('2026-07-01', 200), snap('2026-08-01', 50)]);
  check('AUM decline changes nothing in maturity', before.stones === 2 && after.stones === 2 && JSON.stringify(before.fixtures) === JSON.stringify(after.fixtures) && before.treeSize === after.treeSize);
}

// ---- 7. AUM decline: tint only — plant states untouched ----
{
  const month = makeMonth('2026-08', {
    categories: [{ name: 'Everyday', excludeFromTotals: false, funds: [fund('Groceries', 400, 'pacing'), fund('Electric', 100)] }],
    transactions: [tx('Groceries', -100), tx('Electric', -80)],
  });
  const base = { version: 6, settings: {}, months: [month], aum: { assets: [], debts: [], snapshots: [], log: [] } };
  const up = gardenState({ ...base, aum: { ...base.aum, snapshots: [{ date: '2026-05-01', aum: 10000 }, { date: '2026-08-01', aum: 12000 }] } }, { monthId: '2026-08', todayISO: TODAY });
  const down = gardenState({ ...base, aum: { ...base.aum, snapshots: [{ date: '2026-05-01', aum: 12000 }, { date: '2026-08-01', aum: 9000 }] } }, { monthId: '2026-08', todayISO: TODAY });
  check('season flips', up.season.kind === 'growing' && down.season.kind === 'lean');
  check('plant states identical either way', JSON.stringify(up.plants.map((p) => [p.fund, p.state, p.stage])) === JSON.stringify(down.plants.map((p) => [p.fund, p.state, p.stage])));
  check('messages identical either way', JSON.stringify(up.messages) === JSON.stringify(down.messages));
  check('maturity stones: up=2 down=1, never negative', up.maturity.stones === 2 && down.maturity.stones === 1);
}

// ---- 7b. Multi-fund message variants (two-register, with totals) ----
{
  const month = makeMonth('2026-08', {
    income: [{ fund: 'Pay', carryOver: 0, planned: 1000, rule: null, group: 'bonus' }],
    categories: [{ name: 'Bills', excludeFromTotals: false, funds: [fund('A', 50), fund('B', 50), fund('C', 100), fund('D', 100), fund('E', 700)] }],
    transactions: [tx('A', -60), tx('B', -75), tx('C', -20), tx('D', -30)],
  });
  const g = gardenState({ version: 6, settings: {}, months: [month], aum: { snapshots: [] } }, { monthId: '2026-08', todayISO: TODAY });
  const w = g.messages.find((m) => m.kind === 'wilting'), h = g.messages.find((m) => m.kind === 'harvest');
  check('multi-wilting text names funds + total, label Transfer…', w && w.text === '"A", "B" are over — $35.00 in all. A transfer from a fund with money to spare covers each one.' && w.action.label === 'Transfer…' && w.action.to === 'A', w && w.text);
  check('multi-harvest text names total + funds, label Transfer…', h && h.text === '2 funds have $150.00 unspent between them — free to move: "C", "D".' && h.action.label === 'Transfer…' && h.action.from === 'C', h && h.text);
  check('single weed label', gardenState({ version: 6, settings: {}, months: [{ ...month, transactions: [tx('Nobody', -1)] }], aum: { snapshots: [] } }, { monthId: '2026-08', todayISO: TODAY }).messages[0].action.label === 'Review 1 unassigned');
}

// ---- 8. Scene cap ----
{
  const mkBed = (name, n, state = 'growing') => ({ category: name, ci: 0, plants: Array.from({ length: n }, (_, i) => ({ fund: `${name}${i}`, state })) });
  const small = layoutBeds([mkBed('A', 3), mkBed('B', 2), { category: 'Empty', ci: 2, plants: [] }], 16);
  check('under cap: all visible, empty beds dropped', small.length === 2 && small.every((b) => b.hidden === 0 && b.visible.length === b.total));
  const beds = [mkBed('A', 12), mkBed('B', 10), mkBed('C', 6), mkBed('D', 1), mkBed('E', 1)];
  beds[0].plants[11].state = 'wilting'; beds[0].plants[5].state = 'harvest';
  const out = layoutBeds(beds, VISIBLE_PLANT_CAP);
  const visible = out.reduce((a, b) => a + b.visible.length, 0);
  check('over cap: exactly 16 visible', visible === 16, String(visible));
  check('every bed keeps at least one', out.every((b) => b.visible.length >= 1));
  check('hidden counts add up', out.reduce((a, b) => a + b.hidden, 0) === 30 - 16);
  const A = out[0];
  check('attention-worthy plants stay visible', A.visible.some((p) => p.state === 'wilting') && A.visible.some((p) => p.state === 'harvest'));
  check('visible plants keep fund order', A.visible.map((p) => p.fund).join() === A.visible.map((p) => p.fund).sort((x, y) => Number(x.slice(1)) - Number(y.slice(1))).join());
  check('bigger beds get more slots', A.visible.length >= out[1].visible.length && out[1].visible.length >= out[2].visible.length);
  check('deterministic', JSON.stringify(layoutBeds(beds, 16)) === JSON.stringify(out));
  const many = layoutBeds(Array.from({ length: 20 }, (_, i) => mkBed('B' + i, 2)), 16);
  check('more beds than slots: one each, overflow as hidden', many.every((b) => b.visible.length === 1 && b.hidden === 1));
}

// ---- 9. Sown streak + check-ins ----
{
  const m = (id, planned) => makeMonth(id, { income: [{ fund: 'Pay', carryOver: 0, planned: 1000, rule: null, group: 'bonus' }], categories: [{ name: 'C', excludeFromTotals: false, funds: [fund('F', planned)] }] });
  const data = { months: [m('2026-05', 1000), m('2026-06', 900), m('2026-07', 1000), m('2026-08', 1000.01)] };
  check('sown streak counts back to the first unsown month', sownStreak(data, '2026-08') === 2 && sownStreak(data, '2026-06') === 0 && sownStreak(data, '2026-05') === 1);

  const month = makeMonth('2026-08', {
    income: [{ fund: 'Pay', carryOver: 0, planned: 2000, rule: { type: 'checks' }, group: 'standard' }],
    categories: [{ name: 'C', excludeFromTotals: false, funds: [fund('F', 2000)] }],
    transactions: [tx('Pay', 2150, '2026-08-05')],
  });
  month.checks = { Pay: { count: 2, amount: 1000, titheAmount: 1000, variable: true } };
  const data2 = { version: 6, settings: {}, months: [month], aum: { snapshots: [] } };
  const g = gardenState(data2, { monthId: '2026-08', todayISO: TODAY });
  check('check-in surfaces as a message with its one-tap remedy', g.messages.some((x) => x.kind === 'checkin' && x.action.kind === 'useActual' && x.action.fund === 'Pay'), JSON.stringify(g.messages));
  check('incomeCheckIns over-received mid-month', incomeCheckIns(month, { income: [{ fund: 'Pay', group: 'standard', rule: { type: 'checks' }, received: 2150, planned: 2000 }] }, TODAY).length === 1);
  check('incomeCheckIns under-received mid-month stays quiet', incomeCheckIns(month, { income: [{ fund: 'Pay', group: 'standard', rule: { type: 'checks' }, received: 1000, planned: 2000 }] }, TODAY).length === 0);
  check('incomeCheckIns under-received once done nudges', incomeCheckIns(month, { income: [{ fund: 'Pay', group: 'standard', rule: { type: 'checks' }, received: 1000, planned: 2000 }] }, '2026-09-02').length === 1);
  check('calm affirmation when all clear', (() => {
    const mm = makeMonth('2026-08', { categories: [{ name: 'C', excludeFromTotals: false, funds: [fund('F', 1000)] }] });
    const gg = gardenState({ version: 6, settings: {}, months: [mm], aum: { snapshots: [] } }, { monthId: '2026-08', todayISO: TODAY });
    return gg.sown && gg.messages.length === 1 && gg.messages[0].kind === 'calm' && gg.messages[0].text === 'Everything\'s on plan. Nothing needs you today.' && gg.messages[0].action === null;
  })());
  check('unknown month → null', gardenState(data2, { monthId: '2030-01', todayISO: TODAY }) === null);
  check('PLANT_STATES covers the table', PLANT_STATES.length === 7);
}

// ---- 10. The scene: watercolor rules from §4 ----
{
  // 64-plant fixture: 8 categories × 8 funds, every family, most states, 2 weeds
  const cats = [];
  const types = ['pacing', 'basic', 'fixed', 'savings'];
  const txs = [];
  for (let c = 0; c < 8; c++) {
    const funds = [];
    for (let f = 0; f < 8; f++) {
      const name = `F${c}-${f}`;
      const type = types[(c + f) % 4];
      funds.push(fund(name, 100, type, type === 'savings' && f % 2 ? { setup: { savingsMode: 'build', monthlyAmount: 50 } } : {}));
      if (f % 4 === 1) txs.push(tx(name, -30));
      if (f % 4 === 2) txs.push(tx(name, -120));
      if (f % 4 === 3 && type === 'pacing') txs.push(tx(name, -90, '2026-08-12'));
    }
    cats.push({ name: 'Cat ' + c, excludeFromTotals: false, funds });
  }
  txs.push(tx('Nobody', -5), tx('Nobody2', -6));
  const month = makeMonth('2026-08', { income: [{ fund: 'Pay', carryOver: 0, planned: 6400, rule: null, group: 'bonus' }], categories: cats, transactions: txs });
  const history = [];
  for (let i = 0; i < 23; i++) { const m = 8 + i, y = 2024 + Math.floor((m - 1) / 12), mm = ((m - 1) % 12) + 1; history.push({ ...month, id: `${y}-${String(mm).padStart(2, '0')}` }); }
  const data = { version: 6, settings: {}, months: history.concat([month]), aum: { snapshots: [{ date: '2026-05-01', aum: 100 }, { date: '2026-08-01', aum: 200 }] } };
  const g = gardenState(data, { monthId: '2026-08', todayISO: TODAY });
  check('scene fixture has 64 plants and 2 weeds', g.plants.length === 64 && g.weeds === 2, g.plants.length + '/' + g.weeds);
  check('scene fixture: 24 months → every fixture, growing season', g.maturity.fixtures.length === MATURITY_MILESTONES.length && g.season.kind === 'growing');
  const { svg, height, symbols } = sceneSvg(g, { monthLabel: 'August 2026' });
  check('scene markup ≤ 80 KB with 60+ plants', svg.length <= 80 * 1024, (svg.length / 1024).toFixed(1) + ' KB');
  check('exactly four filter defs (wc1, wc2, wc3, paper)', (svg.match(/<filter id=/g) || []).length === 4 && /id="wc1"/.test(svg) && /id="wc2"/.test(svg) && /id="wc3"/.test(svg) && /id="paper"/.test(svg));
  check('filter defs are the POC defs verbatim', svg.includes(filterDefs()) && /baseFrequency="0\.055" numOctaves="4" seed="7"/.test(filterDefs()) && /seed="23"/.test(filterDefs()) && /seed="41"/.test(filterDefs()));
  const filterAttrs = svg.match(/filter="url\(#[^)]+\)"/g) || [];
  check('the only filter attribute is the paper grain on the background rect', filterAttrs.length === 1 && filterAttrs[0] === 'filter="url(#paper)"', filterAttrs.join(','));
  const noButterfly = svg.replace(/<g id="butterfly">[\s\S]*?<\/g>/, '');
  check('wash classes sit on <g> groups, never on tiny elements', !/<(ellipse|circle|path|rect)[^>]*class="wc[123]"/.test(noButterfly));
  check('symbols are reused via <use>', symbols > 0 && symbols < 40 && (svg.match(/<use href="#p-/g) || []).length >= 40, symbols + ' symbols');
  check('every plant carries its click id and an accessible label', (svg.match(/data-plant="/g) || []).length === (svg.match(/role="button" aria-label="F/g) || []).length);
  check('ambient animation rides on the sprite <svg> element (compositor thread); its drawing keeps an attribute transform; no animated inner <g>',
    /<svg class="garden-ambient flutter"[^>]*>[\s\S]*<g transform="translate\(/.test(svg) && !/<g class="(flutter|leaf-fall)">/.test(svg));
  check('plant hover/lean classes live on inner groups, outer g keeps the attribute transform',
    /<g class="plant [^"]*" data-plant="[^"]+" transform="translate\([^"]+\) scale\([^"]+\)"[^>]*>\s*<rect class="hit"[^>]*\/>\s*<g class="body"><g class="lift">/.test(svg));
  const lean = sceneSvg({ ...g, season: { ...g.season, kind: 'lean' } }).svg;
  check('a growing season gets the butterfly, lean gets one falling leaf over static fallen ones', /garden-ambient flutter/.test(svg) && !/leaf-fall/.test(svg) && /garden-ambient leaf-fall/.test(lean) && !/flutter/.test(lean) && (lean.match(/leaf-fall/g) || []).length === 1 && /class="fallen wc3"/.test(lean) && !/class="fallen/.test(svg));
  check('≤ 3 concurrently animated ambient elements', ((svg.match(/class="flutter"/g) || []).length + (svg.match(/class="leaf-fall"/g) || []).length) <= 3);
  check('bed signs carry the plain category name', /class="g-sign-text" text-anchor="middle">Cat 0</.test(svg));
  const weedsBlock = (svg.match(/<g class="weeds"[\s\S]*?<\/text>/) || [''])[0].replace('class="weeds"', '').replace('data-weeds', '').replace(/g-weed-[lm]/g, '');
  check('weeds label is budget vocabulary and names the destination', /2 unassigned →/.test(svg) && /aria-label="Review 2 unassigned"/.test(svg) && !/stray|weed/i.test(weedsBlock), weedsBlock.slice(0, 120));
  check('deterministic: same state → same markup', sceneSvg(g, { monthLabel: 'August 2026' }).svg === svg);
  const labelled = sceneSvg(g, { labels: true, money: (n) => '$' + Math.abs(n).toFixed(2) }).svg;
  check('labels overlay annotates every visible plant', (labelled.match(/class="g-plant-label"/g) || []).length === (labelled.match(/data-plant="/g) || []).length && /\$70\.00 left/.test(labelled) && / over</.test(labelled));
  const sceneSrc = fs.readFileSync(new URL('../src/garden-scene.js', import.meta.url), 'utf8');
  const engineSrc = fs.readFileSync(new URL('../src/garden.js', import.meta.url), 'utf8');
  const code = (s) => s.replace(/\/\/.*$/gm, ''); // comments may mention it; code may not call it
  check('no Math.random in the scene or engine', !/Math\.random/.test(code(sceneSrc)) && !/Math\.random/.test(code(engineSrc)));
  check('no gradients on shapes (washes only)', !/<linearGradient|<radialGradient/.test(svg));
  check('maturity fixtures all drawn at 24 months', ['fx-path', 'fx-fence', 'fx-arbor', 'fx-pond', 'fx-hive', 'fx-wall', 'fx-tree'].every((k) => svg.includes(k)));
  check('scene height is finite and sane', height > 300 && height < 2000, String(height));
  // Bitmap mode (what the app renders): one self-contained SVG + hit layer + sprite manifest
  const pal = Object.fromEntries(PALETTE_TOKENS.map((k) => [k, k === 'light-op' ? '0.1' : '#abcdef']));
  const bm = sceneSvg(g, { monthLabel: 'August 2026', bitmap: true, palette: pal, skip: new Set(['0:1']) });
  check('bitmap: one self-contained svg, styles inlined, palette substituted', (bm.svg.match(/<svg /g) || []).length === 1 && bm.svg.includes('<style>') && !/var\(--g-/.test(bm.svg) && (bm.svg.match(/<filter id=/g) || []).length === 4, String((bm.svg.match(/var\(--g-/g) || []).length));
  check('bitmap: skipped plant is left out of the raster but kept in the manifest', !bm.svg.includes('data-plant="0:1"') && bm.placed.some((e) => e.key === '0:1') && bm.placed.length === (svg.match(/data-plant="/g) || []).length);
  check('bitmap: hit layer carries every plant, the "+N" signs and the weeds as focusable buttons',
    (bm.hit.match(/data-plant="/g) || []).length === bm.placed.length && (bm.hit.match(/data-more="/g) || []).length === (svg.match(/class="more-sign"/g) || []).length && /data-weeds="1"/.test(bm.hit) && (bm.hit.match(/tabindex="0" role="button"/g) || []).length === bm.hits.length && /aria-label="Review 2 unassigned"/.test(bm.hit));
  check('bitmap: hit layer is transparent (no filters, no washes)', !/filter=|class="wc/.test(bm.hit));
  const sp = plantSprite(bm.placed[0], bm.height, 'sway');
  check('live sprite: own svg with defs, positioned by percent, plant classes inside', /^<svg class="garden-live" data-live="0:0"/.test(sp) && /style="left:[\d.]+%;top:[\d.]+%;width:[\d.]+%"/.test(sp) && (sp.match(/<filter id=/g) || []).length === 4 && /class="plant st-\w+ fam-\w+ sway"/.test(sp) && /<g class="body"><g class="lift"><use href="#p-/.test(sp));
  check('ambient sprite: animation class on the HTML svg element, not an inner <g>', /<svg class="garden-ambient flutter"/.test(bm.ambient) && !/<g class="flutter">/.test(bm.ambient));
  check('applyPalette leaves unknown tokens alone', applyPalette('fill="var(--g-leaf-l)" x="var(--g-nope)"', { 'leaf-l': '#111' }) === 'fill="#111" x="var(--g-nope)"');

  // Ambient pool (§4): deterministic by season × time of day × month hash; ≤ 3; rules
  const kinds = (st, o) => ambientPlan(st, o).map((a) => a.kind).join('+');
  const blooms = [{ p: { state: 'blooming' }, x: 300 }];
  const growing = { monthId: '2026-03', season: { kind: 'growing' } }, steady = { ...growing, season: { kind: 'steady' } }, leanSt = { ...growing, season: { kind: 'lean' } };
  check('ambient: lean → one falling leaf only, any time of day', kinds(leanSt, { tod: 'midday', placed: blooms }) === 'leaf' && kinds(leanSt, { tod: 'evening', placed: blooms }) === 'leaf');
  check('ambient: steady → butterfly only; evening swaps it for a firefly', kinds(steady, { tod: 'midday', placed: blooms }) === 'butterfly' && kinds(steady, { tod: 'evening' }) === 'firefly');
  check('ambient: growing → butterfly and/or a bee near blooms (hash-gated, needs a bloom)',
    kinds(growing, { tod: 'midday', placed: blooms }) === 'butterfly+bee' && kinds(growing, { tod: 'midday', placed: [] }) === 'butterfly' && kinds({ ...growing, monthId: '2026-07' }, { tod: 'midday', placed: blooms }) === 'butterfly');
  check('ambient: never more than 3, deterministic', [growing, steady, leanSt].every((st) => ambientPlan(st, { tod: 'evening', placed: blooms }).length <= 3) && kinds(growing, { tod: 'golden', placed: blooms }) === kinds(growing, { tod: 'golden', placed: blooms }));
  const ev = sceneSvg({ ...g, season: { ...g.season, kind: 'growing' } }, { tod: 'evening' });
  check('ambient sprites: each its own svg with the animation class on the element; sky/lawn bands only',
    (ev.ambient.match(/<svg class="garden-ambient (flutter|firefly|bee-loop|leaf-fall)"/g) || []).length === (ev.ambient.match(/<svg /g) || []).length && !/<g class="(flutter|firefly|bee-loop|leaf-fall)">/.test(ev.ambient)
    && [...ev.ambient.matchAll(/top:([\d.]+)%/g)].every((m) => Number(m[1]) < 25));

  const strip = stripSvg([{ fund: 'a', family: 'rowcrop', species: 'tomato', state: 'blooming', stage: 3 }]);
  check('intro/vignette strip uses the same defs and symbols', (strip.match(/<filter id=/g) || []).length === 4 && /<use href="#p-rowcrop-tomato-blooming-0"/.test(strip));
}

// ---- 11. Acceptance guards: working views stay literal; motion honours reduced-motion ----
{
  const appSrc = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  check('Budget hero copy unchanged', appSrc.includes("'Zero-based ✓ — every dollar has a job'") && !/Every dollar sown/.test(appSrc));
  check('sidebar button unchanged', html.includes('>+ Start next month<') && !/Sow \$\{/.test(appSrc) && !/🌱 Sow/.test(appSrc));
  check('month-created toast stays literal', appSrc.includes('created — review planned amounts.') && !/is sown —/.test(appSrc));
  check('month-close: ceremony title, literal action button', appSrc.includes('harvest</h2>') && /`Start \$\{monthLabel\(nid\)\} anyway` : `Start \$\{monthLabel\(nid\)\}`/.test(appSrc));
  check('Garden view has no editing controls (only buttons that navigate)', !/<input[^>]*class="money/.test(appSrc.slice(appSrc.indexOf('function renderGarden'), appSrc.indexOf('/* ---------------- Settings view'))));
  const rm = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  const rmBlock = rm.slice(0, rm.indexOf('}\n}') + 3);
  check('prefers-reduced-motion disables every garden animation class', ['.flutter', '.leaf-fall', '.bee-loop', '.firefly', '.plant.sway .body', '.plant.st-harvest .glow', '.garden-live', '.plant .lift'].every((k) => rmBlock.includes(k)), rmBlock.slice(0, 200));
  check('continuous plant motion is stepped (cheap to re-raster)', /\.plant\.sway \.body \{ animation: sway [^;]*steps\(/.test(css) && /\.plant\.st-harvest \.glow \{ animation: glow [^;]*steps\(/.test(css));
  check('ambient loops are slow (6–12 s)', [...css.matchAll(/\.(flutter|leaf-fall|bee-loop|firefly) \{ animation: \w+ (\d+)s/g)].every((m) => Number(m[2]) >= 6 && Number(m[2]) <= 12));
  check('no raster assets beyond the AUM/Budget help screenshots and the derived icon', (() => {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
    const rasters = walk(fileURLToPath(new URL('../src', import.meta.url))).filter((f) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(f));
    return rasters.length === 6 && rasters.every((f) => /assets\/help\/(aum|budget)-/.test(f));
  })());
}

console.log(`test-garden: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log('  FAIL ' + f);
process.exit(fail ? 1 : 0);
