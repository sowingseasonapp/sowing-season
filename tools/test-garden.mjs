// Garden engine tests — fixture months exercising every plant state, the
// season layer, maturity milestones, the scene cap and the message ladder.
// Self-contained (synthetic data). Run: npm run test:garden
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  gardenState, plantFor, speciesFor, familyOf, hashName, seasonFor, allTimeHighs,
  stonesLaidIn, maturityFor, sownStreak, layoutBeds, incomeCheckIns, monthContext, recentPerCheckAvg, fundDeposits,
  SPECIES, PLANT_STATES, VISIBLE_PLANT_CAP, MATURITY_MILESTONES, ACTION_LABELS,
  fundAges, givingMonths, earlyFixtures, AGE_THRESHOLDS, EARLY_FIXTURES,
} from '../src/garden.js';
import { sceneSvg, stripSvg, filterDefs, plantSprite, plantMarkup, PALETTE_TOKENS, applyPalette, ambientPlan, GARDEN_MILESTONE_LABELS } from '../src/garden-scene.js';
import { computeMonth } from '../src/compute.js'; // 1.4.0 W2(i): to build the shared comps map the way gardenState does

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
        fund('Electric', 100, 'fixed'),            // harvest: paid, money left (one-charge rule — Fixed only since 1.2.1 W2)
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
  check('wilting caption: over by money this month, a transfer covers it', by.Water.caption === 'Over by $10.00 this month — a transfer covers it.', by.Water.caption);
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

// ---- 1b. S12 rule (a) (1.2.1 W2): Basic is free only once the month is done; a goal only once its target month is over ----
{
  const mk = (todayISO) => gardenState({ version: 6, settings: {}, months: [makeMonth('2026-08', {
    categories: [
      { name: 'Bills', excludeFromTotals: false, funds: [fund('Phone', 60, 'basic')] },
      { name: 'Savings', excludeFromTotals: false, funds: [fund('Trip', 100, 'savings', { setup: { targetAmount: 1200, targetMonth: '2026-08' }, fund: { carryOver: 1100 } })] },
    ],
    transactions: [tx('Phone', -45), tx('Trip', -500)],
  })], aum: { snapshots: [] } }, { monthId: '2026-08', todayISO });
  const mid = Object.fromEntries(mk(TODAY).plants.map((p) => [p.fund, p.state]));
  const end = Object.fromEntries(mk('2026-08-31').plants.map((p) => [p.fund, p.state]));
  check('basic paid mid-month with money left → growing, not harvest', mid.Phone === 'growing', mid.Phone);
  check('basic on the last day → harvest', end.Phone === 'harvest', end.Phone);
  check('goal in its target month, one charge mid-month → not harvest', mid.Trip === 'growing', mid.Trip);
  check('goal in its target month on the last day → harvest', end.Trip === 'harvest', end.Trip);
}

// ---- 1c. Carried in (1.2.1 W1/W5): plants follow this month; one card carries the deficit ----
{
  const month = makeMonth('2026-07', {
    income: [{ fund: 'Pay', carryOver: 0, planned: 550, rule: null, group: 'bonus' }],
    categories: [{ name: 'Everyday', excludeFromTotals: false, funds: [
      fund('Rent', 400, 'basic', { fund: { carryOver: -100 } }),  // carried-only: on plan this month → blooming at close
      fund('Groc', 100, 'basic', { fund: { carryOver: -50 } }),   // mixed: $30 over this month AND carrying $50
      fund('Gas', 50, 'basic'),                                    // fresh: $10 over this month
    ] }],
    transactions: [tx('Rent', -400, '2026-07-05'), tx('Groc', -130, '2026-07-12'), tx('Gas', -60, '2026-07-20')],
  });
  const g = gardenState({ version: 7, settings: {}, months: [month], aum: { snapshots: [] } }, { monthId: '2026-07', todayISO: '2026-07-31' });
  const by = Object.fromEntries(g.plants.map((p) => [p.fund, p]));
  check('carried-only fund on plan this month → blooming at close', by.Rent.state === 'blooming', by.Rent.state);
  check('carried-only caption says carrying, from before', /carrying \(\$100\.00\) from before\.$/.test(by.Rent.caption), by.Rent.caption);
  check('carried-only phrase carries it too', by.Rent.phrase === 'finished on plan · carrying ($100.00) from before', by.Rent.phrase);
  check('plant carries carriedIn', by.Rent.carriedIn === -100 && by.Groc.carriedIn === -50 && by.Gas.carriedIn === 0, JSON.stringify(g.plants.map((p) => [p.fund, p.carriedIn])));
  check('mixed fund → wilting on this month\'s overspend only', by.Groc.state === 'wilting' && by.Groc.caption === 'Over by $30.00 this month — a transfer covers it.', by.Groc.caption);
  check('mixed phrase: this month over, carrying from before', by.Groc.phrase === '$30.00 over · carrying ($50.00) from before', by.Groc.phrase);
  check('fresh fund → wilting, over by leftover', by.Gas.state === 'wilting' && by.Gas.caption === 'Over by $10.00 this month — a transfer covers it.' && by.Gas.overThisMonth === -10, by.Gas.caption);
  check('counts: 2 wilting, 1 blooming', g.counts.wilting === 2 && g.counts.blooming === 1, JSON.stringify(g.counts));
  check('ladder: wilting, carried, … (carried after thirsty, before harvest)', g.messages.map((m) => m.kind).slice(0, 2).join(',') === 'wilting,carried', g.messages.map((m) => m.kind).join(','));
  const w = g.messages.find((m) => m.kind === 'wilting'), cd = g.messages.find((m) => m.kind === 'carried');
  check('wilting total is this month\'s overspend', w && /\$40\.00 in all this month/.test(w.text), w && w.text);
  check('carried card names the funds and the total, opens Budget', cd && cd.text === '"Rent", "Groc" are carrying ($150.00) from earlier months between them.' && cd.action.kind === 'budget' && cd.action.label === 'Open Budget', cd && cd.text);
  // Single carried-only fund: says what this month did.
  const one = gardenState({ version: 7, settings: {}, months: [{ ...month, categories: [{ name: 'Everyday', excludeFromTotals: false, funds: [fund('Rent', 400, 'basic', { fund: { carryOver: -100 } })] }], transactions: [tx('Rent', -400, '2026-07-05')] }], aum: { snapshots: [] } }, { monthId: '2026-07', todayISO: '2026-07-31' });
  const c1 = one.messages.find((m) => m.kind === 'carried');
  check('single carried card: on plan this month', c1 && c1.text === '"Rent" is carrying ($100.00) from earlier months — this month it\'s on plan.', c1 && c1.text);
  // Paid back this month → nothing carried.
  const paid = gardenState({ version: 7, settings: {}, months: [{ ...month, categories: [{ name: 'Everyday', excludeFromTotals: false, funds: [fund('Rent', 150, 'basic', { fund: { carryOver: -100 } })] }], transactions: [tx('Rent', -30, '2026-07-05')] }], aum: { snapshots: [] } }, { monthId: '2026-07', todayISO: '2026-07-15' });
  check('deficit paid back → no flag entry, so nothing carried and no carried card', paid.plants[0].carriedIn === 0 && paid.plants[0].state === 'growing' && !/carrying/.test(paid.plants[0].phrase) && !paid.messages.some((m) => m.kind === 'carried'), JSON.stringify([paid.plants[0].state, paid.plants[0].carriedIn, paid.plants[0].phrase]));
  // Two-register guard over the new strings.
  const METAPHOR = /\b(water(s|ed|ing)?|harvest|replant|weeds?|sow|sown|bloom(ing)?|wilt(ed|ing)?|thirsty|tend(ing)?|garden|bed|seed|plant|drink(ing)?)\b/i;
  const stripNames = (t) => t.replace(/"[^"]*"/g, '"…"');
  check('carried card and phrases speak budget, not garden', !METAPHOR.test(stripNames(cd.text)) && !METAPHOR.test(by.Rent.phrase) && !METAPHOR.test(by.Groc.phrase), cd.text);
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
  check('falling → lean with the quieter-season note', falling.kind === 'lean' && /A big change settles over a season/.test(falling.note));
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
  check('24 → the first five; next is the greenhouse at 30', mk(24).fixtures.join() === 'path,fence,arbor,pond,hive' && mk(24).next.id === 'greenhouse');
  check('72 → every milestone, nothing next', mk(72).fixtures.length === MATURITY_MILESTONES.length && mk(72).next === null);
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
    // C and D are Fixed: the one-charge "free" rule is theirs alone since 1.2.1 W2.
    categories: [{ name: 'Bills', excludeFromTotals: false, funds: [fund('A', 50), fund('B', 50), fund('C', 100, 'fixed'), fund('D', 100, 'fixed'), fund('E', 700)] }],
    transactions: [tx('A', -60), tx('B', -75), tx('C', -20), tx('D', -30)],
  });
  const g = gardenState({ version: 6, settings: {}, months: [month], aum: { snapshots: [] } }, { monthId: '2026-08', todayISO: TODAY });
  const w = g.messages.find((m) => m.kind === 'wilting'), h = g.messages.find((m) => m.kind === 'harvest');
  check('multi-wilting text names funds + total, label Transfer…', w && w.text === '"A", "B" are over — $35.00 in all this month. A transfer from a fund with money to spare covers each one.' && w.action.label === 'Transfer…' && w.action.to === 'A', w && w.text);
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

  // 3-year sim S3: an empty month isn't evidence about pay — no "Use actual"
  // when nothing was received, even once the month is done. A month whose
  // checks really arrived short (A-M08: one $1,050 against 3 × $1,240) is.
  const ci = (received, planned, today) => incomeCheckIns(month, { income: [{ fund: 'Pay', group: 'standard', rule: { type: 'checks' }, received, planned }] }, today);
  check('S3: received 0, month done → no under-received nudge', ci(0, 2000, '2026-09-02').length === 0);
  check('S3: received 1050 of 3 × 1240, month done → still offered', ci(1050, 3720, '2026-09-02').length === 1 && ci(1050, 3720, '2026-09-02')[0].diff === -2670);
  check('S3: received 0 mid-month → quiet', ci(0, 2000, TODAY).length === 0);
  check('S3: over-received mid-month still nudges', ci(2150, 2000, TODAY).length === 1);
  check('calm affirmation when all clear', (() => {
    const mm = makeMonth('2026-08', { categories: [{ name: 'C', excludeFromTotals: false, funds: [fund('F', 1000)] }] });
    const gg = gardenState({ version: 6, settings: {}, months: [mm], aum: { snapshots: [] } }, { monthId: '2026-08', todayISO: TODAY });
    return gg.sown && gg.messages.length === 1 && gg.messages[0].kind === 'calm' && gg.messages[0].text === 'Everything\'s on plan. Nothing needs you today.' && gg.messages[0].action === null;
  })());
  check('unknown month → null', gardenState(data2, { monthId: '2030-01', todayISO: TODAY }) === null);
  check('PLANT_STATES covers the table', PLANT_STATES.length === 7);
}

// ---- 9b. recentPerCheckAvg — pooled over the deposits that actually posted (S9) ----
{
  const MAYA = 'Maya Checks';
  const inc = () => [{ fund: MAYA, carryOver: 0, planned: 0, rule: { type: 'checks' }, group: 'standard' }];
  const cats = () => [{ name: 'C', excludeFromTotals: false, funds: [fund('F', 100)] }];
  const payMonth = (id, count, deposits, extraTx = []) => {
    const m = makeMonth(id, { income: inc(), categories: cats(), transactions: [
      ...deposits.map((amt, i) => tx(MAYA, amt, `${id}-${String(5 + i * 7).padStart(2, '0')}`, { vendor: 'ACME PAYROLL' })),
      ...extraTx,
    ] });
    if (count != null) m.checks = { [MAYA]: { count, amount: 1240, titheAmount: 1240, variable: true } };
    return m;
  };
  const months = (...ms) => ms;

  // fundDeposits: the shared rule — positive, non-transfer, assigned to the fund.
  const dep = fundDeposits(payMonth('2027-01', 2, [1240, 1240], [
    tx(MAYA, 500, '2027-01-20', { vendor: 'Transfer from Safety Net' }),
    tx(MAYA, 300, '2027-01-21', { vendor: 'Move', isTransfer: true }),
    tx(MAYA, -40, '2027-01-22', { vendor: 'Adjustment' }),
    tx('Groceries', 75, '2027-01-23', { vendor: 'Refund' }),
  ]), MAYA);
  check('fundDeposits counts only positive non-transfer deposits on the fund', dep.count === 2 && dep.total === 2480, JSON.stringify(dep));

  // 4. A count inherited by mistake during a lapse no longer poisons the average.
  check('S9: inherited count 3 against two 1240 deposits → 1240 (old rule ≈ 1033.33)',
    recentPerCheckAvg(months(payMonth('2027-01', 2, [1240, 1240]), payMonth('2027-02', 3, [1240, 1240])), MAYA, '2027-03') === 1240);
  // 5. Empty months (checks entry, no deposits) are skipped and don't use up the window.
  check('S9: months with checks but no deposits are skipped and do not use up the 3-month window',
    recentPerCheckAvg(months(
      payMonth('2026-09', 2, [1000]), payMonth('2026-10', 2, []), payMonth('2026-11', 2, []),
      payMonth('2026-12', 2, [1240]), payMonth('2027-01', 2, [1240]),
    ), MAYA, '2027-02') === 1160); // (1240 + 1240 + 1000) ÷ 3, not (1240 + 1240) ÷ 2
  check('S9: a month with no checks entry for the fund is skipped',
    recentPerCheckAvg(months(payMonth('2026-12', null, [500]), payMonth('2027-01', 2, [1240])), MAYA, '2027-02') === 1240);
  check('S9: a count of 0 no longer disqualifies a month that had deposits',
    recentPerCheckAvg(months(payMonth('2027-01', 0, [1240, 1240])), MAYA, '2027-02') === 1240);
  check('S9: no prior months → null', recentPerCheckAvg(months(payMonth('2027-03', 2, [1240])), MAYA, '2027-03') === null);
  check('S9: only the current and later months → null', recentPerCheckAvg(months(payMonth('2027-03', 2, [1240]), payMonth('2027-04', 2, [1240])), MAYA, '2027-03') === null);
  // 6. Transfers into the fund are not deposits, and received is not the numerator.
  check('S9: 1240 + "Transfer from Safety Net" 500 → 1240',
    recentPerCheckAvg(months(payMonth('2027-01', 1, [1240], [tx(MAYA, 500, '2027-01-20', { vendor: 'Transfer from Safety Net' })])), MAYA, '2027-02') === 1240);
  check('S9: a flagged isTransfer transaction is not a deposit',
    recentPerCheckAvg(months(payMonth('2027-01', 1, [1240], [tx(MAYA, 500, '2027-01-20', { vendor: 'Move', isTransfer: true })])), MAYA, '2027-02') === 1240);
  check('S9: a negative adjustment on the fund does not lower the per-check figure',
    recentPerCheckAvg(months(payMonth('2027-01', 1, [1240], [tx(MAYA, -40, '2027-01-22', { vendor: 'Adjustment' })])), MAYA, '2027-02') === 1240);
  // 7. Pooled, not an average of monthly averages.
  check('S9: pooled — one 600 and three 1200 → 1050, not 900',
    recentPerCheckAvg(months(payMonth('2027-01', 1, [600]), payMonth('2027-02', 3, [1200, 1200, 1200])), MAYA, '2027-03') === 1050);
  check('S9: window is the newest three months that had deposits',
    recentPerCheckAvg(months(payMonth('2026-10', 1, [100]), payMonth('2026-11', 1, [1200]), payMonth('2026-12', 1, [1200]), payMonth('2027-01', 1, [1200])), MAYA, '2027-02') === 1200);
  check('S9: result is rounded to cents', recentPerCheckAvg(months(payMonth('2027-01', 3, [1000, 1000, 1001])), MAYA, '2027-02') === 1000.33);
}

// ---- 9c. 1.4.0 W2: ages, giving months, early fixtures ----
{
  // 20 done months (2024-12 .. 2026-07) plus the open 2026-08 (TODAY = 2026-08-15).
  const ids = [];
  for (let y = 2024, m = 12, i = 0; i < 21; i++) { ids.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  const SLIP_IDX = [2, 7, 13];                  // Slips over its own plan in 3 of the 20 done months
  const IDLE_IDX = [0, 4, 8, 12, 16];           // Idle planned + spent in 5 of the 20 done months
  const ZERO_NET_IDX = 10;                      // Tithe: −200 and +200 the same month
  const build = (opts = {}) => ({ version: 7, settings: {}, aum: { snapshots: [] }, months: ids.map((id, i) => {
    const idle = IDLE_IDX.includes(i);
    const funds = [
      fund('Steady', 100),
      fund('Slips', 100),
      fund('Carrying', 100, 'basic', { fund: { carryOver: -500 } }),
      fund('Idle', idle ? 100 : 0),
      fund('Quiet', 100, 'basic', { setup: { excludeInsights: opts.quietTithe ? false : true } }),
      fund('Tithe', 200, 'basic', { fund: { rule: { type: 'tithe', percent: 0.1 } }, setup: { ...(opts.titheGiving != null ? { giving: opts.titheGiving } : {}), ...(opts.quietTithe ? { excludeInsights: true } : {}) } }),
    ];
    if (opts.compassion) funds.push(fund('Compassion', 50, 'basic', { setup: { giving: true } }));
    const d = `${id}-10`;
    const txs = [
      tx('Steady', -80, d), tx('Slips', SLIP_IDX.includes(i) ? -130 : -80, d), tx('Carrying', -80, d),
      tx('Quiet', -80, d), tx('Payroll', -80, d), tx('Tithe', -200, d),
    ];
    if (idle) txs.push(tx('Idle', -50, d));
    if (i === ZERO_NET_IDX) txs.push(tx('Tithe', 200, d, { vendor: 'Refund' }));
    if (opts.compassion && [1, 5, 9, 15].includes(i)) txs.push(tx('Compassion', -50, d));
    return makeMonth(id, {
      income: [{ fund: 'Pay', carryOver: 0, planned: 2000, rule: null, group: 'bonus' }],
      categories: [
        { name: 'Everyday', excludeFromTotals: false, funds },
        { name: 'Work', excludeFromTotals: true, funds: [fund('Payroll', 100)] },
      ],
      transactions: txs,
    });
  }) });
  const data = build();
  const ages = fundAges(data, TODAY);
  const a = (n) => ages.get(n.toLowerCase());
  check('W2 ages: Steady → onPlan 20, age 3', a('Steady').onPlan === 20 && a('Steady').age === 3, JSON.stringify(a('Steady')));
  check('W2 ages: Slips (over 3 of 20) → onPlan 17, age 2', a('Slips').onPlan === 17 && a('Slips').age === 2, JSON.stringify(a('Slips')));
  check('W2 ages: Carrying (−500 carried, inside its own plan) → onPlan 20, age 3 (D-P4)', a('Carrying').onPlan === 20 && a('Carrying').age === 3, JSON.stringify(a('Carrying')));
  check('W2 ages: Idle (resting 15 of 20) → onPlan 5, age 1 (Default 1)', a('Idle').onPlan === 5 && a('Idle').present === 20 && a('Idle').age === 1, JSON.stringify(a('Idle')));
  check('W2 ages: Quiet and Payroll absent from the map', !ages.has('quiet') && !ages.has('payroll'), [...ages.keys()].join(','));
  const openOver = build(); openOver.months[20].transactions.push(tx('Steady', -500, '2026-08-12'));
  check('W2 ages: the open month does not count — −500 on Steady in 2026-08 → still onPlan 20', fundAges(openOver, TODAY).get('steady').onPlan === 20);
  const gm = givingMonths(data);
  // 21 months carry the Tithe fund: 20 done + the open one. Each gave 200 except the $0-net month → 20 months, 20 × 200 = 4000.00.
  check('W2 giving: count 20 (21 Tithe months, the $0-net month skipped, the open month counted), lifetime 4000.00', gm.count === 20 && gm.lifetime === 4000 && !gm.months.includes(ids[ZERO_NET_IDX]) && gm.months.includes('2026-08'), JSON.stringify([gm.count, gm.lifetime]));
  check('W2 giving: byMonth 2026-08 → planned 200, given 200', gm.byMonth.get('2026-08').planned === 200 && gm.byMonth.get('2026-08').given === 200, JSON.stringify(gm.byMonth.get('2026-08')));
  const plus = givingMonths(build({ compassion: true }));
  const only = givingMonths(build({ compassion: true, titheGiving: false }));
  check('W2 giving: a setup.giving basic fund adds its dollars (4200.00, same 20 months); Tithe giving:false → the 4 Compassion months, 200.00', plus.count === 20 && plus.lifetime === 4200 && only.count === 4 && only.lifetime === 200, JSON.stringify([plus.count, plus.lifetime, only.count, only.lifetime]));
  check('W2 giving: a quiet (excludeInsights) tithe-rule fund still counts — 20', givingMonths(build({ quietTithe: true })).count === 20);
  // earlyFixtures on a 1-month fixture, then a second month.
  const one = (planned, txs = [], id = '2026-08') => makeMonth(id, { income: [{ fund: 'Pay', carryOver: 0, planned: 1000, rule: null, group: 'bonus' }], categories: [{ name: 'C', excludeFromTotals: false, funds: [fund('F', planned)] }], transactions: txs });
  const ef = (months, today = TODAY) => earlyFixtures({ months, aum: { snapshots: [] } }, today).join();
  check('W2 early: 1 month, open, not sown → nothing; sown → wheelbarrow', ef([one(900)]) === '' && ef([one(1000)]) === 'wheelbarrow', ef([one(900)]) + ' | ' + ef([one(1000)]));
  check('W2 early: a closed month adds the birdbath; a clean close adds the rain barrel; a fund over its own plan in that month → no rain barrel',
    ef([one(900, [tx('F', -950, '2026-07-10')], '2026-07'), one(1000)]) === 'wheelbarrow,birdbath'
    && ef([one(1000, [tx('F', -900, '2026-07-10')], '2026-07'), one(1000)]) === 'wheelbarrow,birdbath,rainbarrel'
    && ef([one(1000, [tx('F', -1100, '2026-07-10')], '2026-07'), one(1000)]) === 'wheelbarrow,birdbath',
    [ef([one(900, [tx('F', -950, '2026-07-10')], '2026-07'), one(1000)]), ef([one(1000, [tx('F', -900, '2026-07-10')], '2026-07'), one(1000)]), ef([one(1000, [tx('F', -1100, '2026-07-10')], '2026-07'), one(1000)])].join(' | '));
  // 1.4.0 W0: the rain barrel waits for the close (m.id < nowMonth), like the birdbath — not for monthDone.
  check('W0 early: a single sown, clean month on its last calendar day is not closed → wheelbarrow only, no rain barrel (d79d049 returned wheelbarrow,rainbarrel)',
    ef([one(1000, [tx('F', -900, '2026-08-10')])], '2026-08-31') === 'wheelbarrow', ef([one(1000, [tx('F', -900, '2026-08-10')])], '2026-08-31'));
  const mat = maturityFor(data, TODAY);
  check('W2 maturityFor carries early (array), giving.count (number), and no early id in fixtures', Array.isArray(mat.early) && typeof mat.giving.count === 'number' && mat.giving.count === 20 && !mat.fixtures.some((id) => EARLY_FIXTURES.some((e) => e.id === id)) && AGE_THRESHOLDS.join() === '3,9,18', JSON.stringify(mat));
  const gs = gardenState(data, { monthId: '2026-08', todayISO: TODAY });
  check('W2 gardenState: plants carry age (Steady 3, Slips 2, Idle 1)', Object.fromEntries(gs.plants.map((p) => [p.fund, p.age])).Steady === 3 && gs.plants.find((p) => p.fund === 'Slips').age === 2 && gs.plants.find((p) => p.fund === 'Idle').age === 1, JSON.stringify(gs.plants.map((p) => [p.fund, p.age])));
  // 1.4.0 W2(i): the shared computeMonth pass changes nothing — with and without `comps` the four walks answer identically.
  const comps = new Map(data.months.map((m) => [m.id, computeMonth(m)]));
  const gmShape = (g) => JSON.stringify([g.count, g.lifetime, g.months, [...g.byMonth]]);
  check('W2(i): fundAges / earlyFixtures / givingMonths / maturityFor are identical with and without the shared comps map',
    JSON.stringify([...fundAges(data, TODAY, comps)]) === JSON.stringify([...fundAges(data, TODAY)])
    && JSON.stringify(earlyFixtures(data, TODAY, comps)) === JSON.stringify(earlyFixtures(data, TODAY))
    && gmShape(givingMonths(data, comps)) === gmShape(givingMonths(data))
    && JSON.stringify(maturityFor(data, TODAY, comps)) === JSON.stringify(maturityFor(data, TODAY))
    && comps.size === 21);
}

// ---- 10. The scene: watercolor rules from §4 ----
let hitPlants10 = 0; // data-plant targets in §10's bitmap hit layer, compared against §13's in §14
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
  check('scene fixture: 24 months → every fixture, growing season', g.maturity.fixtures.join() === 'path,fence,arbor,pond,hive' && g.season.kind === 'growing');
  const { svg, height, symbols } = sceneSvg(g, { monthLabel: 'August 2026' });
  check('scene markup ≤ 96 KB with 60+ plants', svg.length <= 96 * 1024, (svg.length / 1024).toFixed(1) + ' KB');
  console.log(`  §10 scene: ${(svg.length / 1024).toFixed(1)} KB, ${symbols} symbols`);
  check('exactly four filter defs (wc1, wc2, wc3, paper)', (svg.match(/<filter id=/g) || []).length === 4 && /id="wc1"/.test(svg) && /id="wc2"/.test(svg) && /id="wc3"/.test(svg) && /id="paper"/.test(svg));
  check('filter defs are the POC defs verbatim', svg.includes(filterDefs()) && /baseFrequency="0\.055" numOctaves="4" seed="7"/.test(filterDefs()) && /seed="23"/.test(filterDefs()) && /seed="41"/.test(filterDefs()));
  const filterAttrs = svg.match(/filter="url\(#[^)]+\)"/g) || [];
  check('the only filter attribute is the paper grain on the background rect', filterAttrs.length === 1 && filterAttrs[0] === 'filter="url(#paper)"', filterAttrs.join(','));
  const noButterfly = svg.replace(/<g id="butterfly">[\s\S]*?<\/g>/, '');
  check('wash classes sit on <g> groups, never on tiny elements', !/<(ellipse|circle|path|rect)[^>]*class="wc[123]"/.test(noButterfly));
  check('symbols are reused via <use>', symbols > 0 && symbols < 60 && (svg.match(/<use href="#p-/g) || []).length >= 40, symbols + ' symbols');
  check('every plant carries its click id and an accessible label', (svg.match(/data-plant="/g) || []).length === (svg.match(/role="button" aria-label="F/g) || []).length);
  check('ambient animation rides on the sprite <svg> element (compositor thread); its drawing keeps an attribute transform; no animated inner <g>',
    /<svg class="garden-ambient flutter"[^>]*>[\s\S]*<g transform="translate\(/.test(svg) && !/<g class="(flutter|leaf-fall)">/.test(svg));
  check('plant hover/lean classes live on inner groups, outer g keeps the attribute transform',
    /<g class="plant [^"]*" data-plant="[^"]+" transform="translate\([^"]+\) scale\([^"]+\)"[^>]*>\s*<rect class="hit"[^>]*\/>\s*<g class="body"><g class="lift">/.test(svg));
  const lean = sceneSvg({ ...g, season: { ...g.season, kind: 'lean' } }).svg;
  check('a growing season gets the butterfly, lean gets one falling leaf over static fallen ones', /garden-ambient flutter/.test(svg) && !/leaf-fall/.test(svg) && /garden-ambient leaf-fall/.test(lean) && !/flutter/.test(lean) && (lean.match(/leaf-fall/g) || []).length === 1 && /class="fallen wc3"/.test(lean) && !/class="fallen/.test(svg));
  check('≤ 3 concurrently animated ambient elements', ['flutter', 'leaf-fall', 'bee-loop', 'firefly', 'robin-hop', 'rabbit-nibble', 'dragonfly-dart'].reduce((a, k) => a + (svg.match(new RegExp(`garden-ambient ${k}"`, 'g')) || []).length, 0) <= 3); // 1.4.0 W6: all seven kinds
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
  hitPlants10 = (bm.hit.match(/data-plant="/g) || []).length; // 1.4.0 W6 §14: the §13 scene has the same beds
  const sp = plantSprite(bm.placed[0], bm.height, 'sway');
  check('live sprite: own svg with defs, positioned by percent, plant classes inside', /^<svg class="garden-live" data-live="0:0"/.test(sp) && /style="left:[\d.]+%;top:[\d.]+%;width:[\d.]+%"/.test(sp) && (sp.match(/<filter id=/g) || []).length === 4 && /class="plant st-\w+ fam-\w+ sway"/.test(sp) && /<g class="body"><g class="lift">(<use href="#a-[^"]+"\/>)?<use href="#p-/.test(sp)); // 1.4.0 W3: the fixture's plants are aged, so the base <use> may precede the plant's
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
  // 1.4.0 W6: the three wildlife classes join the alternation; every sprite's top is in the sky/lawn band (< 25%)
  // except the rabbit, which lives at the path's foot (> 60%) — matched in the same regex pass, not by loosening the bound.
  check('ambient sprites: each its own svg with the animation class on the element; sky/lawn bands only',
    (ev.ambient.match(/<svg class="garden-ambient (flutter|firefly|bee-loop|leaf-fall|robin-hop|rabbit-nibble|dragonfly-dart)"/g) || []).length === (ev.ambient.match(/<svg /g) || []).length && !/<g class="(flutter|firefly|bee-loop|leaf-fall|robin-hop|rabbit-nibble|dragonfly-dart)">/.test(ev.ambient)
    && [...ev.ambient.matchAll(/<svg class="garden-ambient ([\w-]+)"[^>]*top:([\d.]+)%/g)].every((m) => (m[1] === 'rabbit-nibble' ? Number(m[2]) > 60 : Number(m[2]) < 25)),
    [...ev.ambient.matchAll(/<svg class="garden-ambient ([\w-]+)"[^>]*top:([\d.]+)%/g)].map((m) => `${m[1]} ${m[2]}%`).join(', '));

  const strip = stripSvg([{ fund: 'a', family: 'rowcrop', species: 'tomato', state: 'blooming', stage: 3 }]);
  check('intro/vignette strip uses the same defs and symbols', (strip.match(/<filter id=/g) || []).length === 4 && /<use href="#p-rowcrop-tomato-blooming-0"/.test(strip));
}

// ---- 12. 1.4.0 W3: meadow and age bases ----
let g13, s13, bm13; // the §13 all-on fixture, shared with §14 (1.4.0 W4–W6)
{
  const monthIds = (n, y0 = 2026, m0 = 1) => { const out = []; let y = y0, m = m0; for (let i = 0; i < n; i++) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } } return out; };
  const stateFor = (months) => ({ monthId: '2026-08', beds: [], plants: [], weeds: 0, season: { kind: 'steady', note: '' }, sown: true,
    maturity: { fixtures: ['path', 'fence'], treeSize: 1, stones: 0, giving: { months, count: months.length, lifetime: 0 } } });
  const ten = sceneSvg(stateFor(monthIds(10)));
  check('meadow: 10 giving months → exactly 10 flowers inside fx-meadow, no +N label',
    (ten.svg.match(/<use href="#mf/g) || []).length === 10 && /<g class="fx fx-meadow"><title>The meadow — one wildflower for every month you gave\. They stay\.<\/title>(<use href="#mf\d" x="\d+" y="\d+"\/>){10}<\/g>/.test(ten.bg) && !/>\+\d+<\/text>/.test(ten.bg),
    String((ten.svg.match(/<use href="#mf/g) || []).length));
  const forty = sceneSvg(stateFor(monthIds(40)));
  check('meadow: 40 ids → 36 flowers and a g-label reading +4', (forty.bg.match(/<use href="#mf/g) || []).length === 36 && /<text class="g-label" x="452" y="136" text-anchor="end">\+4<\/text>/.test(forty.bg));
  check('meadow: 0 ids → no fx-meadow', !/fx-meadow/.test(sceneSvg(stateFor([])).svg) && !/fx-meadow/.test(sceneSvg({ ...stateFor([]), maturity: { fixtures: [], treeSize: 0, stones: 0 } }).svg));
  check('meadow: deterministic — same ids → identical bg', sceneSvg(stateFor(monthIds(10))).bg === ten.bg);
  const flowers = [...forty.bg.matchAll(/<use href="#mf\d" x="(\d+)" y="(\d+)"\/>/g)].map((m) => [Number(m[1]), Number(m[2])]);
  check('meadow: every flower sits behind the fence — y < 142, x within 194..446', flowers.length === 36 && flowers.every(([x, y]) => y < 150 - 8 && x >= 194 && x <= 446), JSON.stringify(flowers.slice(0, 5)));
  // 36 ids starting 2026-01 reach all four species (a 2027-01 start misses the daisy — checked while writing the test).
  const thirtySix = sceneSvg(stateFor(monthIds(36)));
  check('meadow: all four species across 36 hashed ids (2026-01..2028-12), each symbol once in the defs', ['mf0', 'mf1', 'mf2', 'mf3'].every((k) => (thirtySix.fg.match(new RegExp(`<symbol id="${k}" overflow="visible">`, 'g')) || []).length === 1), String(thirtySix.symbols));
  check('meadow: fence draws after the meadow (pickets in front)', ten.bg.indexOf('fx-meadow') < ten.bg.indexOf('fx-fence'));
  // Age 0 is byte-identical to 4978a59: the §1 Groceries plant, output pinned before the change.
  const groc = { ci: 0, fi: 0, fund: 'Groceries', family: 'rowcrop', species: speciesFor('Groceries', { type: 'pacing' }).species, state: 'thirsty', stage: 2, phrase: 'on pace to go over', age: 0 };
  const pinned = '<g class="plant st-thirsty fam-rowcrop" data-plant="0:0" transform="translate(100,200) scale(1)" tabindex="0" role="button" aria-label="Groceries — on pace to go over">\n    <rect class="hit" x="-28" y="-76" width="56" height="84" fill="transparent"/>\n    <g class="body"><g class="lift"><use href="#p-rowcrop-lettuce-thirsty-0"/></g></g></g>';
  check('age 0: plantMarkup is byte-identical to its 4978a59 output', plantMarkup(groc, 100, 200, 1) === pinned && groc.species === 'lettuce', plantMarkup(groc, 100, 200, 1));
  const aged = plantMarkup({ ...groc, fund: 'Rent', family: 'shrub', species: 'sage', state: 'blooming', stage: 3, phrase: 'finished on plan', age: 3 }, 100, 200, 1.25);
  check('age 3 shrub: base <use> inside .lift before the plant; hit rect unchanged', /<g class="lift"><use href="#a-shrub-3"\/><use href="#p-shrub-sage-blooming-0"\/><\/g>/.test(aged) && aged.includes('<rect class="hit" x="-28" y="-76" width="56" height="84" fill="transparent"/>'), aged);
  const sprite = plantSprite({ p: { ci: 1, fi: 2, fund: 'Trip', family: 'fruit', species: 'pear', state: 'growing', stage: 2, phrase: 'on plan', age: 2 }, x: 300, y: 270, scale: 1.05 }, 600);
  check('plantSprite for an age-2 fruit plant carries id="a-fruit-2" in its defs, base <use> before the plant <use>', /<defs>[\s\S]*<symbol id="a-fruit-2" overflow="visible">[\s\S]*<\/defs>/.test(sprite) && /<g class="lift"><use href="#a-fruit-2"\/><use href="#p-fruit-pear-growing-2"\/><\/g>/.test(sprite));
  // §13: the all-on fixture — §10's 64 plants over 72 months (history 71 + the open month), Tithe in 36 history months, 45 stones.
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
  const ids72 = monthIds(72, 2020, 9); // 2020-09 .. 2026-08
  const history = ids72.slice(0, 71).map((id, i) => {
    // 1.4.0 W4 (Sitting B): the first history month is clean — no overspend, nothing unassigned — so the rain barrel is derived, not forced.
    const m = { ...month, id, categories: cats.map((c) => ({ ...c, funds: [...c.funds] })), transactions: i === 0 ? txs.filter((t) => t.amount !== -120 && !/^Nobody/.test(t.fund)) : [...txs] };
    if (i >= 35) { // the last 36 history months carry a tithe-rule fund that gives $200
      m.categories[0] = { ...m.categories[0], funds: [...m.categories[0].funds, fund('Tithe', 200, 'basic', { fund: { rule: { type: 'tithe', percent: 0.1 } } })] };
      m.transactions.push(tx('Tithe', -200));
    }
    return m;
  });
  const snaps = Array.from({ length: 45 }, (_, i) => ({ date: ids72[i + 20] + '-01', aum: i + 1 }));
  const data13 = { version: 7, settings: {}, months: history.concat([month]), aum: { snapshots: snaps } };
  g13 = gardenState(data13, { monthId: '2026-08', todayISO: TODAY });
  s13 = sceneSvg(g13, { monthLabel: 'August 2026' });
  const insidePlan = g13.plants.filter((p) => p.leftover >= -0.004);
  check('§13 all-on: every milestone, 36 giving months, 45 stones, every inside-plan plant at age 3, 64 plants',
    g13.maturity.fixtures.length === MATURITY_MILESTONES.length && g13.maturity.giving.count === 36 && g13.maturity.stones === 45
    && insidePlan.length > 0 && insidePlan.every((p) => p.age === 3) && g13.plants.filter((p) => p.leftover < -0.004).every((p) => p.age === 0) && g13.plants.length === 64,
    JSON.stringify([g13.maturity.fixtures.length, g13.maturity.giving.count, g13.maturity.stones, insidePlan.length, g13.plants.length]));
  check('§13 all-on: scene markup ≤ 96 KB and symbols < 60 with every fixture drawn', s13.svg.length <= 96 * 1024 && s13.symbols < 60, (s13.svg.length / 1024).toFixed(1) + ' KB, ' + s13.symbols + ' symbols');
  console.log(`  §13 scene: ${(s13.svg.length / 1024).toFixed(1)} KB, ${s13.symbols} symbols, ${(s13.svg.match(/<use href="#a-/g) || []).length} age-base uses, ${(s13.svg.match(/<use href="#mf/g) || []).length} flowers, fixtures ${[...s13.bg.matchAll(/<g class="fx fx-(wheelbarrow|birdbath|rainbarrel|greenhouse|bench|brook|willow|orchard)"/g)].map((m) => m[1]).join(' ')}`);
  bm13 = sceneSvg(g13, { bitmap: true, palette: Object.fromEntries(PALETTE_TOKENS.map((k) => [k, k === 'light-op' ? '0.1' : '#abcdef'])) });
  check('§13 bitmap: the single <defs> holds each flower and base symbol once; bg slice carries the 36 flowers', (bm13.svg.match(/<defs>/g) || []).length === 1
    && ['mf0', 'mf1', 'mf2', 'mf3', 'a-rowcrop-3', 'a-shrub-3', 'a-fruit-3', 'a-evergreen-3'].every((k) => (bm13.svg.match(new RegExp(`<symbol id="${k}" `, 'g')) || []).length === 1)
    && (bm13.svg.match(/<use href="#mf/g) || []).length === 36);
}

// ---- 14. 1.4.0 W4–W6: fixtures and wildlife ----
{
  const EARLY = ['wheelbarrow', 'birdbath', 'rainbarrel'], LATE = ['greenhouse', 'bench', 'brook', 'willow', 'orchard'];
  const has = (s, id) => s.includes(`<g class="fx fx-${id}">`);
  const idx = (s, id) => s.indexOf(`<g class="fx fx-${id}">`);
  // Early fixtures via a hand-built state (§12's stateFor shape plus `early`).
  const stateFor = (early, fixtures = ['path', 'fence']) => ({ monthId: '2026-08', beds: [], plants: [], weeds: 0, season: { kind: 'steady', note: '' }, sown: true,
    maturity: { fixtures, treeSize: 1, stones: 0, early, giving: { months: [], count: 0, lifetime: 0 } } });
  const none = sceneSvg(stateFor([])).bg, wb = sceneSvg(stateFor(['wheelbarrow'])).bg, all3 = sceneSvg(stateFor(EARLY, ['path', 'fence', 'pond', 'hive'])).bg;
  check('W4 early fixtures: early [] → none of the three; [wheelbarrow] → that one only; all three → all three',
    EARLY.every((id) => !has(none, id)) && has(wb, 'wheelbarrow') && !has(wb, 'birdbath') && !has(wb, 'rainbarrel') && EARLY.every((id) => has(all3, id)),
    [none, wb, all3].map((s) => EARLY.filter((id) => has(s, id)).join(',')).join(' | '));
  check('W4 draw order: tree < wheelbarrow < hive; fence < rainbarrel; pond < birdbath',
    idx(all3, 'tree') < idx(all3, 'wheelbarrow') && idx(all3, 'wheelbarrow') < idx(all3, 'hive') && idx(all3, 'fence') < idx(all3, 'rainbarrel') && idx(all3, 'pond') < idx(all3, 'birdbath') && idx(all3, 'pond') > 0,
    ['tree', 'wheelbarrow', 'hive', 'fence', 'rainbarrel', 'pond', 'birdbath'].map((id) => `${id} ${idx(all3, id)}`).join(', '));
  // Late fixtures through gardenState on an n-month fixture ending at the open 2026-08 (two snapshots → a wall to order against).
  const mk = (n) => {
    const months = []; let y = 2026, m = 8;
    for (let i = 0; i < n; i++) { months.unshift(makeMonth(`${y}-${String(m).padStart(2, '0')}`, { categories: [{ name: 'C', excludeFromTotals: false, funds: [fund('F', 1000)] }] })); m--; if (m < 1) { m = 12; y--; } }
    return sceneSvg(gardenState({ version: 7, settings: {}, months, aum: { snapshots: [{ date: '2026-05-01', aum: 100 }, { date: '2026-08-01', aum: 200 }] } }, { monthId: '2026-08', todayISO: TODAY })).bg;
  };
  const late = Object.fromEntries([24, 30, 36, 48, 60, 72].map((n) => [n, mk(n)]));
  const drawn = (n) => LATE.filter((id) => has(late[n], id)).join(',');
  check('W5 late fixtures by months tended: 24 → none; 30 → greenhouse; 36 → +bench; 48 → +brook; 60 → +willow; 72 → +orchard',
    drawn(24) === '' && drawn(30) === 'greenhouse' && drawn(36) === 'greenhouse,bench' && drawn(48) === 'greenhouse,bench,brook' && drawn(60) === 'greenhouse,bench,brook,willow' && drawn(72) === LATE.join(','),
    [24, 30, 36, 48, 60, 72].map((n) => `${n}: ${drawn(n)}`).join(' | '));
  const s72 = late[72];
  check('W5 draw order at 72: orchard < tree; greenhouse < wall; willow < pond < brook',
    idx(s72, 'orchard') < idx(s72, 'tree') && idx(s72, 'greenhouse') < idx(s72, 'wall') && idx(s72, 'willow') < idx(s72, 'pond') && idx(s72, 'pond') < idx(s72, 'brook') && idx(s72, 'orchard') > 0 && idx(s72, 'wall') > 0,
    ['orchard', 'tree', 'greenhouse', 'wall', 'willow', 'pond', 'brook'].map((id) => `${id} ${idx(s72, id)}`).join(', '));
  const benchG = (s72.match(/<g class="fx fx-bench">[\s\S]*?<\/g>(?=<g class="fx|<\/svg>)/) || [''])[0];
  check('W5 the bench\'s glow is static: <circle class="glow" inside fx-bench, no st-harvest anywhere in the bg', /<circle class="glow" cx="790" cy="142" r="5"/.test(benchG) && !/st-harvest/.test(s72), benchG.slice(-160));
  // The §13 all-on fixture (from §12) draws all eight; labels, filters, the hit layer, the byte caps.
  const ALL8 = EARLY.concat(LATE);
  check('§13 draws all eight new fixture classes', ALL8.every((id) => has(s13.bg, id)), ALL8.filter((id) => !has(s13.bg, id)).join(','));
  check('GARDEN_MILESTONE_LABELS has greenhouse, bench, brook, willow, orchard (the early ids are Sitting C\'s W8)',
    LATE.every((id) => typeof GARDEN_MILESTONE_LABELS[id] === 'string' && GARDEN_MILESTONE_LABELS[id].length > 0) && EARLY.every((id) => !(id in GARDEN_MILESTONE_LABELS)), JSON.stringify(GARDEN_MILESTONE_LABELS));
  const filterAttrs13 = s13.svg.match(/filter="url\(#[^)]+\)"/g) || [];
  check('§13: the only filter attribute is still the paper grain on the background rect', filterAttrs13.length === 1 && filterAttrs13[0] === 'filter="url(#paper)"', filterAttrs13.join(','));
  const bare13 = sceneSvg({ ...g13, maturity: { ...g13.maturity, fixtures: [], early: [] } }, { bitmap: true, palette: Object.fromEntries(PALETTE_TOKENS.map((k) => [k, k === 'light-op' ? '0.1' : '#abcdef'])) });
  check('§13 hit layer is unchanged by fixtures: no fx- in it, the same data-plant count as §10\'s beds, identical with every fixture stripped',
    !/fx-/.test(bm13.hit) && (bm13.hit.match(/data-plant="/g) || []).length === hitPlants10 && bm13.hit === bare13.hit, `${(bm13.hit.match(/data-plant="/g) || []).length} vs ${hitPlants10}`);
  // Byte caps, measured as svg-budget.mjs does: the <g class="fx fx-<id>">…</g> group in the bg layer.
  const fxBytes = (id) => { const m = s13.bg.match(new RegExp(`<g class="fx fx-${id}">[\\s\\S]*?</g>(?=<g class="fx|</svg>)`)); return m ? m[0].length : -1; };
  const sizes = Object.fromEntries(ALL8.map((id) => [id, fxBytes(id)]));
  check('W4 byte caps: fx-wheelbarrow / fx-birdbath / fx-rainbarrel each ≤ 1,024 B', EARLY.every((id) => sizes[id] > 0 && sizes[id] <= 1024), EARLY.map((id) => `${id} ${sizes[id]} B`).join(', '));
  check('W5 byte caps: fx-greenhouse / fx-bench / fx-brook / fx-willow / fx-orchard each ≤ 1,536 B', LATE.every((id) => sizes[id] > 0 && sizes[id] <= 1536), LATE.map((id) => `${id} ${sizes[id]} B`).join(', '));
  console.log(`  §14 fixture bytes: ${ALL8.map((id) => `${id} ${sizes[id]}`).join(' · ')}`);
  // Wildlife (W6): month ids are picked by their hash bits over 2026-01..2040-12 (deterministic; the pick asserts one was found).
  const pick = (pred) => { for (let y = 2026; y <= 2040; y++) for (let m = 1; m <= 12; m++) { const id = `${y}-${String(m).padStart(2, '0')}`; if (pred(hashName(id))) return id; } return null; };
  const kinds = (st, o) => ambientPlan(st, o).map((a) => a.kind).join('+');
  const blooms = [{ p: { state: 'blooming' }, x: 300 }];
  const everyFx = { fixtures: ['path', 'fence', 'arbor', 'pond', 'hive', 'greenhouse', 'bench', 'brook', 'willow', 'orchard'], early: EARLY, treeSize: 4, stones: 45 };
  const allBits = pick((h) => (h & 0x740) === 0x740), noneBits = pick((h) => (h & 0x700) === 0);
  const onlyRobin = pick((h) => (h & 0x700) === 0x100), onlyRabbit = pick((h) => (h & 0x700) === 0x200), onlyDragonfly = pick((h) => (h & 0x700) === 0x400);
  check(`W6 picks found (all bits ${allBits}, none ${noneBits}, robin-only ${onlyRobin}, rabbit-only ${onlyRabbit}, dragonfly-only ${onlyDragonfly}); a lean season on ${allBits} with every fixture → 'leaf' alone`,
    [allBits, noneBits, onlyRobin, onlyRabbit, onlyDragonfly].every(Boolean) && kinds({ monthId: allBits, season: { kind: 'lean' }, maturity: everyFx }, { tod: 'evening', placed: blooms }) === 'leaf');
  const steadyOn = (id, maturity) => kinds({ monthId: id, season: { kind: 'steady' }, maturity }, { tod: 'midday', placed: blooms });
  check(`W6 robin: only with early birdbath and bit 0x100 (${onlyRobin} → butterfly+robin; no birdbath → butterfly; ${noneBits} with birdbath → butterfly)`,
    steadyOn(onlyRobin, { fixtures: [], early: ['birdbath'] }) === 'butterfly+robin' && steadyOn(onlyRobin, { fixtures: ['path', 'pond'], early: ['wheelbarrow'] }) === 'butterfly' && steadyOn(noneBits, { fixtures: [], early: ['birdbath'] }) === 'butterfly',
    [steadyOn(onlyRobin, { fixtures: [], early: ['birdbath'] }), steadyOn(onlyRobin, { fixtures: ['path', 'pond'], early: ['wheelbarrow'] }), steadyOn(noneBits, { fixtures: [], early: ['birdbath'] })].join(' | '));
  check(`W6 rabbit: only with the path and bit 0x200 (${onlyRabbit})`,
    steadyOn(onlyRabbit, { fixtures: ['path'], early: [] }) === 'butterfly+rabbit' && steadyOn(onlyRabbit, { fixtures: ['fence', 'pond'], early: EARLY }) === 'butterfly' && steadyOn(noneBits, { fixtures: ['path'], early: [] }) === 'butterfly',
    [steadyOn(onlyRabbit, { fixtures: ['path'], early: [] }), steadyOn(onlyRabbit, { fixtures: ['fence', 'pond'], early: EARLY }), steadyOn(noneBits, { fixtures: ['path'], early: [] })].join(' | '));
  check(`W6 dragonfly: only with the pond and bit 0x400 (${onlyDragonfly})`,
    steadyOn(onlyDragonfly, { fixtures: ['pond'], early: [] }) === 'butterfly+dragonfly' && steadyOn(onlyDragonfly, { fixtures: ['path', 'fence'], early: EARLY }) === 'butterfly' && steadyOn(noneBits, { fixtures: ['pond'], early: [] }) === 'butterfly',
    [steadyOn(onlyDragonfly, { fixtures: ['pond'], early: [] }), steadyOn(onlyDragonfly, { fixtures: ['path', 'fence'], early: EARLY }), steadyOn(noneBits, { fixtures: ['pond'], early: [] })].join(' | '));
  const full = kinds({ monthId: allBits, season: { kind: 'growing' }, maturity: everyFx }, { tod: 'evening', placed: blooms });
  check(`W6 pool: a growing evening on ${allBits} with every fixture and blooms → exactly 3, today's kinds first, then robin → rabbit → dragonfly, cut at 3 (firefly+bee+robin)`,
    full === 'firefly+bee+robin' && ambientPlan({ monthId: allBits, season: { kind: 'growing' }, maturity: everyFx }, { tod: 'evening', placed: blooms }).length === 3
    && kinds({ monthId: allBits, season: { kind: 'steady' }, maturity: everyFx }, { tod: 'midday', placed: blooms }) === 'butterfly+robin+rabbit', full);
  check(`W6 a state with no maturity at all answers as today (${allBits}: steady → butterfly; growing evening with blooms → firefly+bee)`,
    kinds({ monthId: allBits, season: { kind: 'steady' } }, { tod: 'midday', placed: blooms }) === 'butterfly' && kinds({ monthId: allBits, season: { kind: 'growing' } }, { tod: 'evening', placed: blooms }) === 'firefly+bee');
  // The sprites themselves: positions, own symbol defs, no wash classes (literal colours).
  const sp = sceneSvg({ ...g13, monthId: allBits, season: { kind: 'steady', note: '' } }, { monthLabel: 'x' }).ambient;
  check('W6 sprites: robin on the birdbath (left 65%, top HORIZON + 4), rabbit at the path\'s foot (> 60%), each with its own <defs> symbol and no wash class',
    /<svg class="garden-ambient robin-hop"[^>]*left:65%;top:21\.7%/.test(sp) && /<svg class="garden-ambient rabbit-nibble"[^>]*left:52%;top:(9\d|8\d)(\.\d+)?%/.test(sp)
    && /<defs><g id="robin">/.test(sp) && /<defs><g id="rabbit">/.test(sp) && !/<g id="(robin|rabbit|dragonfly)">[\s\S]*?class="wc/.test(sp), sp.replace(/<defs>[\s\S]*?<\/defs>/g, '<defs/>'));
}

// ---- 11. Acceptance guards: working views stay literal; motion honours reduced-motion ----
{
  const appSrc = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  check('Budget hero copy unchanged', appSrc.includes("'Zero-based ✓ — every dollar has a job'") && !/Every dollar sown/.test(appSrc));
  check('sidebar button unchanged', html.includes('>+ Start next month<') && !/Sow \$\{/.test(appSrc) && !/🌱 Sow/.test(appSrc));
  check('month-created toast stays literal', appSrc.includes('created — review planned amounts.') && !/is sown —/.test(appSrc));
  // 1.2.1 W4: the recap's S16 neutral line exists, and no surface says "over by" the whole leftover any more.
  // 1.3.0 W11: the recap's strings live in reports.js (monthReport); app.js only decorates them.
  const repSrc = fs.readFileSync(new URL('../src/reports.js', import.meta.url), 'utf8');
  check('recap: an overspent matured goal gets the neutral line (reports.js, W11)', repSrc.includes('matured — ') && !appSrc.includes('matured — ') && /const rep = monthReport\(data, last\.id, todayISO\(\)\);/.test(appSrc));
  check('Needs attention never reads over-by-leftover (split, W1/W4)', !appSrc.includes('money(-x.leftover)') && !appSrc.includes('money(-flag.leftover)'));
  // 1.2.1 W8: a goal's ask is explained in words (type mark + panel) and reads autoPlanned — never re-derives or writes the sum back.
  check('goal ask in words (W8): catch-up sentence, read from autoPlanned, never written back', (() => {
    const fn = appSrc.slice(appSrc.indexOf('function goalAskWords'), appSrc.indexOf('function goalProjection'));
    return fn.length > 0 && fn.includes(' toward the goal + ') && fn.includes(' a month to make back ') && fn.includes('const ask = autoPlanned(f, monthId)') && !fn.includes('f.planned =') && !fn.includes('planned =');
  })());
  check('month-close: ceremony title, literal action button', appSrc.includes('harvest</h2>') && /`Start \$\{monthLabel\(nid\)\} anyway` : `Start \$\{monthLabel\(nid\)\}`/.test(appSrc));
  check('Garden view has no editing controls (only buttons that navigate)', !/<input[^>]*class="money/.test(appSrc.slice(appSrc.indexOf('function renderGarden'), appSrc.indexOf('/* ---------------- Settings view'))));
  const rm = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  const rmBlock = rm.slice(0, rm.indexOf('}\n}') + 3);
  check('prefers-reduced-motion disables every garden animation class', ['.flutter', '.leaf-fall', '.bee-loop', '.firefly', '.robin-hop', '.rabbit-nibble', '.dragonfly-dart', '.plant.sway .body', '.plant.st-harvest .glow', '.garden-live', '.plant .lift'].every((k) => rmBlock.includes(k)), rmBlock.slice(0, 200));
  check('continuous plant motion is stepped (cheap to re-raster)', /\.plant\.sway \.body \{ animation: sway [^;]*steps\(/.test(css) && /\.plant\.st-harvest \.glow \{ animation: glow [^;]*steps\(/.test(css));
  const loops = [...css.matchAll(/\.(flutter|leaf-fall|bee-loop|firefly|robin-hop|rabbit-nibble|dragonfly-dart) \{ animation: \w+ (\d+)s/g)];
  check('ambient loops are slow (6–12 s)', loops.length === 7 && loops.every((m) => Number(m[2]) >= 6 && Number(m[2]) <= 12), loops.map((m) => `${m[1]} ${m[2]}s`).join(', '));
  check('no raster assets beyond the AUM/Budget help screenshots and the derived icon', (() => {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
    const rasters = walk(fileURLToPath(new URL('../src', import.meta.url))).filter((f) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(f));
    return rasters.length === 6 && rasters.every((f) => /assets\/help\/(aum|budget)-/.test(f));
  })());
}

console.log(`test-garden: ${pass} passed, ${fail} failed`);
for (const f of failures) console.log('  FAIL ' + f);
process.exit(fail ? 1 : 0);
