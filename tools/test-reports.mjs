// Reports module tests (1.3.0 Sitting C, W8). Self-contained: a synthetic
// three-month fixture built through the engine's own buildNextMonth, so every
// carry-over is what the app would have written — not the seed (the compute
// suite needs the owner's workbook and can't run in CI; this one can).
// Run: npm run test:reports
import { buildNextMonth, computeMonth, r2 } from '../src/compute.js';
import { monthReport, yearReport, rangeMonths, yearsPresent, defaultReportMonth, fmtMoney } from '../src/reports.js';

let pass = 0, fail = 0;
const failures = [];
const check = (name, cond, detail = '') => {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ': ' + detail : ''}`); }
};
const j = (x) => JSON.stringify(x);

// ---- fixture builders ----
let seq = 0;
const tx = (fund, amount, vendor, date, more = {}) => ({ id: 't' + (++seq), date, vendor, amount, fund, description: '', account: '', ...more });
const basic = (name, planned, extra = {}) => ({ fund: name, carryOver: 0, planned, rule: null, yearlyCharge: null, setup: { type: 'basic' }, ...extra });
const income = (name, planned, extra = {}) => ({ fund: name, carryOver: 0, planned, rule: null, titheExempt: false, group: 'bonus', ...extra });
const setIncome = (m, name, planned, extra = {}) => { const f = m.income.find((x) => x.fund === name); f.planned = planned; Object.assign(f, extra); };

// Month 1 — January 2026. Two counted categories, one Work category, two income funds.
const jan = {
  id: '2026-01', label: 'January', checks: {},
  income: [income('Pay', 1150), income('Bonus', 500)],
  categories: [
    { name: 'Everyday', excludeFromTotals: false, funds: [
      { ...basic('Groceries', 400), setup: { type: 'pacing' } },
      basic('Gas', 100),
      basic('Fun', 50),
    ] },
    { name: 'Bills', excludeFromTotals: false, funds: [
      basic('Rent', 1000),
      { ...basic('Vacation', 100), setup: { type: 'savings', savingsMode: 'target', targetAmount: 300, targetMonth: '2026-03' } },
    ] },
    { name: 'Work', excludeFromTotals: true, funds: [basic('Work Expenses', 200)] },
  ],
  transactions: [
    tx('Rent', -1000, 'RENT CO', '2026-01-01'),
    tx('Groceries', -350, 'WALMART COM', '2026-01-05'),
    tx('Gas', -100, 'EXXON 123', '2026-01-08'),
    tx('Fun', -20, 'NETFLIX', '2026-01-10'),
    tx('Work Expenses', -150, 'HOTEL XYZ', '2026-01-12'),
    tx('Pay', 2000, 'EMPLOYER DIRECT DEP', '2026-01-15'),
    tx('Bonus', 500, 'EMPLOYER BONUS', '2026-01-20'),
    // The transfer pair: Fun → Vacation, across categories.
    tx('Fun', -10, 'Transfer to Vacation', '2026-01-22', { isTransfer: true }),
    tx('Vacation', 10, 'Transfer from Fun', '2026-01-22', { isTransfer: true }),
  ],
};
// Month 2 — February: the refund, the vendor under two raw strings, Gas over on its own, Bonus never arrives (marked late).
const feb = buildNextMonth(jan, 0.1);
setIncome(feb, 'Pay', 1145); setIncome(feb, 'Bonus', 500, { lateAtClose: true });
feb.transactions.push(
  tx('Rent', -1000, 'RENT CO', '2026-02-01'),
  tx('Groceries', -300, 'WALMART COM', '2026-02-03'),
  tx('Gas', -160, 'EXXON 123', '2026-02-05'),
  tx('Groceries', -120, 'WALMART COM SW TH ST', '2026-02-10'),
  tx('Groceries', 25, 'WALMART COM SW TH ST', '2026-02-12'),      // refund
  tx('Fun', -20, 'NETFLIX', '2026-02-14'),
  tx('Work Expenses', -50, 'HOTEL XYZ', '2026-02-16'),
  tx('Pay', 2000, 'EMPLOYER DIRECT DEP', '2026-02-15'),
);
// Month 3 — March: Gas carries −60 in but is on plan on its own; Bonus's carry is pending.
const mar = buildNextMonth(feb, 0.1);
setIncome(mar, 'Pay', 1200); setIncome(mar, 'Bonus', 500);
mar.transactions.push(
  tx('Rent', -1000, 'RENT CO', '2026-03-01'),
  tx('Groceries', -200, 'WALMART COM', '2026-03-04'),
  tx('Gas', -90, 'EXXON 123', '2026-03-06'),
  tx('Fun', -20, 'NETFLIX', '2026-03-08'),
  tx('Pay', 2000, 'EMPLOYER DIRECT DEP', '2026-03-15'),
  tx('Bonus', 500, 'EMPLOYER BONUS', '2026-03-10'),
);
const mkData = (settings = {}) => ({
  version: 7, settings: { tithePercent: 0.1, ...settings }, months: [jan, feb, mar],
  aum: { assets: [], debts: [], log: [], snapshots: [
    { date: '2026-01-20', assets: 1000, debts: 0, aum: 1000 },
    { date: '2026-02-20', assets: 1200, debts: 0, aum: 1200 },
    { date: '2026-03-10', assets: 1100, debts: 0, aum: 1100 },
  ] },
});
const data = mkData();
const dataExT = mkData({ excludeTransfers: true });
const IN_MARCH = '2026-03-15';   // March is under way: Jan and Feb are done
const IN_APRIL = '2026-04-15';   // everything done

// ---- fixture sanity (the engine wrote what the tests assume) ----
{
  const fm = (m, n) => m.categories.flatMap((c) => c.funds).find((f) => f.fund === n);
  check('fixture: Feb Gas opens at 0, Mar Gas opens at −60', fm(feb, 'Gas').carryOver === 0 && fm(mar, 'Gas').carryOver === -60, j([fm(feb, 'Gas').carryOver, fm(mar, 'Gas').carryOver]));
  check('fixture: Vacation reaches its $300 in March', fm(mar, 'Vacation').carryOver === 205 && fm(mar, 'Vacation').planned === 95);
  const b = mar.income.find((f) => f.fund === 'Bonus');
  check('fixture: Bonus carries −500 into March, pending', b.carryOver === -500 && b.carryPending === true, j(b));
}

// ---- 1. monthReport — headline, exT, Work ----
{
  const r = monthReport(data, '2026-01', IN_MARCH);
  check('Jan headline income/spent/net', r.headline.income === 2500 && r.headline.spent === 1470 && r.headline.net === 1030, j(r.headline));
  check('Jan headline leaves Work out (spent would be 1620 with it)', r.headline.spent === 1470);
  const x = monthReport(dataExT, '2026-01', IN_MARCH);
  check('exT on: headline unchanged when the pair nets to zero inside expenses', x.headline.income === 2500 && x.headline.spent === 1470 && x.headline.exT === true, j(x.headline));
  const everyday = r.catRows.find((c) => c.name === 'Everyday'), everydayX = x.catRows.find((c) => c.name === 'Everyday');
  const bills = r.catRows.find((c) => c.name === 'Bills'), billsX = x.catRows.find((c) => c.name === 'Bills');
  check('exT off: Everyday spent 480 (incl. the $10 out), Bills 990 (incl. the $10 in)', everyday.spent === 480 && bills.spent === 990, j(r.catRows));
  check('exT on: Everyday spent 470, Bills 1000 — catSpentAbs arithmetic', everydayX.spent === 470 && billsX.spent === 1000, j(x.catRows));
  check('catRows carry no Work row; catsUnder 2', r.catRows.length === 2 && r.catsUnder === 2);
  check('planVsReality Jan: planned 1650, spent 1470, diff 180, nothing carried in', j(r.planVsReality) === j({ planned: 1650, carriedIn: 0, spent: 1470, diff: 180 }), j(r.planVsReality));
  const f2 = monthReport(data, '2026-02', IN_MARCH);
  check('planVsReality Feb: planned includes carry (1825), carriedIn 180', f2.planVsReality.planned === 1825 && f2.planVsReality.carriedIn === 180 && f2.planVsReality.spent === 1575, j(f2.planVsReality));
}

// ---- 2. funds table: grouping, order, Work marked, over on own terms ----
{
  const r = monthReport(data, '2026-02', IN_MARCH);
  const names = r.funds.map((f) => f.fund);
  check('Feb funds: Gas (over) floats to the top of Everyday; Work fund present and marked',
    j(names) === j(['Gas', 'Groceries', 'Fun', 'Rent', 'Vacation', 'Work Expenses']) && r.funds.find((f) => f.fund === 'Work Expenses').excluded === true, j(names));
  const gas = r.funds.find((f) => f.fund === 'Gas');
  check('Feb Gas: planned 100, spent 160, left −60, over by 60', gas.planned === 100 && gas.spent === 160 && gas.left === -60 && gas.over === true && gas.overBy === 60, j(gas));
  check('Feb Gas vsLast = +60 (160 vs 100)', gas.vsLast === 60);
  check('Feb vsAvg null with one done month behind it', gas.vsAvg === null && r.funds.every((f) => f.vsAvg === null));
  const groc = r.funds.find((f) => f.fund === 'Groceries');
  check('Feb Groceries spent 395 — the refund reduced it; planned 450 incl. carry', groc.spent === 395 && groc.planned === 450 && groc.left === 55 && groc.over === false, j(groc));
  const m = monthReport(data, '2026-03', IN_MARCH);
  const gas3 = m.funds.find((f) => f.fund === 'Gas');
  check('Mar Gas: left −50 but NOT over — its own month is +10 under', gas3.left === -50 && gas3.over === false && gas3.own === 10, j(gas3));
  check('Mar Gas vsAvg −40: average of Jan+Feb (130), never March itself', gas3.avg === 130 && gas3.vsAvg === -40, j(gas3));
  const groc3 = m.funds.find((f) => f.fund === 'Groceries');
  check('Mar Groceries vsAvg −172.50 (avg 372.50)', groc3.avg === 372.5 && groc3.vsAvg === -172.5, j(groc3));
  // Even once March is done, its own numbers stay out of its average.
  const done = monthReport(data, '2026-03', IN_APRIL);
  check('Mar done: average still excludes the report month', done.funds.find((f) => f.fund === 'Gas').avg === 130);
  // An incomplete month before the report month is skipped: with today in Feb, only Jan is done → one month → null.
  const early = monthReport(data, '2026-03', '2026-02-10');
  check('an incomplete prior month is left out of the average (→ null with one done month)', early.funds.find((f) => f.fund === 'Gas').avg === null);
  check('Jan funds: no prior month → vsLast null', monthReport(data, '2026-01', IN_MARCH).funds.every((f) => f.vsLast === null));
}

// ---- 3. income table ----
{
  const r = monthReport(data, '2026-03', IN_MARCH);
  const bonus = r.incomeFunds.find((f) => f.fund === 'Bonus');
  check('Mar Bonus: planned 500, received 500, carry −500 pending, vsLast +500', bonus.planned === 500 && bonus.received === 500 && bonus.carryOver === -500 && bonus.carryPending === true && bonus.vsLast === 500, j(bonus));
  const pay = r.incomeFunds.find((f) => f.fund === 'Pay');
  check('Mar Pay: carry 0 not pending, vsLast 0', pay.carryOver === 0 && pay.carryPending === false && pay.vsLast === 0, j(pay));
  check('Jan income vsLast null', monthReport(data, '2026-01', IN_MARCH).incomeFunds.every((f) => f.vsLast === null));
}

// ---- 4. What changed ----
{
  const r = monthReport(data, '2026-02', IN_MARCH);
  check('Feb changed: three callouts in order over / under / tx', r.changed.length === 3 && r.changed.map((c) => c.kind).join() === 'fund,fund,tx', j(r.changed));
  check('Feb biggest overspend text with the n-of-last-m clause', r.changed[0].text === 'Gas — $60.00 over; over in 0 of the last 1 month' && r.changed[0].fund === 'Gas', r.changed[0].text);
  check('Feb biggest underspend: Fun $30.00 under (savings funds never count)', r.changed[1].text === 'Fun — $30.00 under' && r.changed[1].fund === 'Fun', r.changed[1].text);
  check('Feb biggest transaction: Rent $1,000.00 on Feb 1 — Rent fund, with txId', r.changed[2].text === 'RENT CO $1,000.00 on Feb 1 — Rent fund' && r.changed[2].fund === 'Rent' && /^t\d+$/.test(r.changed[2].txId), r.changed[2].text);
  const m = monthReport(data, '2026-03', IN_MARCH);
  check('Mar changed: no overspend callout (Gas is carrying, not over)', m.changed.every((c) => !/ over/.test(c.text)) && m.changed[0].kind === 'fund' && / under$/.test(m.changed[0].text), j(m.changed));
  // The n-of-last-m counts own-month overspends over the previous done months the fund was in (≤ 4).
  const apr = buildNextMonth(mar, 0.1); setIncome(apr, 'Pay', 1200); setIncome(apr, 'Bonus', 500);
  apr.transactions.push(tx('Gas', -200, 'EXXON 123', '2026-04-03'), tx('Pay', 2000, 'EMPLOYER DIRECT DEP', '2026-04-15'));
  const d4 = { ...data, months: [jan, feb, mar, apr] };
  const a = monthReport(d4, '2026-04', '2026-05-02');
  check('Apr overspend clause: $100 over on its own (−50 carried in is not this month\x27s doing); over in 1 of the last 3 months (Feb yes; Jan, Mar no — Mar carried, not over)', a.changed[0].text === 'Gas — $100.00 over; over in 1 of the last 3 months', a.changed[0].text);
}

// ---- 5. vendors ----
{
  const r = monthReport(data, '2026-02', IN_MARCH);
  check('Feb vendors: top 5 by spend, Work\'s hotel absent', j(r.vendors.map((v) => v.key)) === j(['RENT', 'WALMART', 'EXXON', 'NETFLIX']), j(r.vendors));
  const w = r.vendors.find((v) => v.key === 'WALMART');
  check('WALMART merges two raw strings: count 3, total −395 (the $25 refund reduced it)', w.count === 3 && w.total === -395, j(w));
  check('WALMART label is the most frequent raw string\'s first word, title-cased', w.label === 'Walmart', w.label);
  const t = monthReport(data, '2026-01', IN_MARCH);
  check('Jan vendors: the transfer pair is not a vendor', t.vendors.every((v) => !/transfer/i.test(v.key)) && t.vendors.length === 4, j(t.vendors));
  // 1.3.1 W1 (Default 2): a type-code bank stores vendor = "DEBIT CARD PURCHASE" and the merchant in description.
  const marB = { ...mar, transactions: [
    tx('Groceries', -80, 'DEBIT CARD PURCHASE', '2026-03-03', { description: 'WHOLEFDS MKT 10123' }),
    tx('Gas', -40, 'DEBIT CARD PURCHASE', '2026-03-04', { description: 'SHELL OIL 57444' }),
    tx('Groceries', -60, 'DEBIT CARD PURCHASE', '2026-03-05', { description: 'WHOLEFDS MKT 10123' }),
  ] };
  const dB = { ...mkData(), months: [jan, feb, marB] };
  const b = monthReport(dB, '2026-03', IN_APRIL);
  check('W1 (1.3.1): boilerplate vendor rows group by memo — Wholefds 2, Shell 1, no Debit',
    j(b.vendors.map((v) => v.key)) === j(['WHOLEFDS', 'SHELL']) && b.vendors[0].count === 2 && b.vendors[1].count === 1 && b.vendors[0].label === 'Wholefds' && !b.vendors.some((v) => v.key === 'DEBIT'), j(b.vendors));
}

// ---- 6. rolled forward ----
{
  const r = monthReport(data, '2026-01', IN_MARCH);
  check('Jan → Feb exists: read Feb\'s carries — 180 across 3 funds, none negative, not computed',
    r.rolledForward.nextId === '2026-02' && r.rolledForward.computed === false && r.rolledForward.total === 180 && r.rolledForward.count === 3 && r.rolledForward.negatives.length === 0, j(r.rolledForward));
  const f = monthReport(data, '2026-02', IN_MARCH);
  check('Feb → Mar: 250 across 4 funds · Gas −60 negative', f.rolledForward.total === 250 && f.rolledForward.count === 4 && j(f.rolledForward.negatives) === j([{ fund: 'Gas', amount: -60 }]), j(f.rolledForward));
  check('Feb → Mar income line: Bonus −500 pending', j(f.rolledForward.income) === j([{ fund: 'Bonus', amount: -500, pending: true }]), j(f.rolledForward.income));
  const m = monthReport(data, '2026-03', IN_MARCH);
  check('Mar → (no April) computed with buildNextMonth: 585 across 4 funds, Gas −50',
    m.rolledForward.computed === true && m.rolledForward.nextId === '2026-04' && m.rolledForward.total === 585 && m.rolledForward.count === 4 && j(m.rolledForward.negatives) === j([{ fund: 'Gas', amount: -50 }]), j(m.rolledForward));
  check('Mar → April: no income carry (nothing late, no stamp)', m.rolledForward.income.length === 0);
  check('Work carries stay out of rolled forward (Work Expenses carries 200 into March)', f.rolledForward.count === 4);
  // A counted (not pending) carry: close Feb through the workflow with a surplus.
  const febS = JSON.parse(JSON.stringify(feb)); febS.trueUp = { at: '2026-03-01' }; setIncome(febS, 'Pay', 1200); febS.income.find((x) => x.fund === 'Bonus').lateAtClose = false; // plans 1700 against 1645 allocated → 55 unassigned
  const dS = { ...data, months: [jan, febS] };
  const s = monthReport(dS, '2026-02', IN_MARCH);
  check('a counted income carry reads pending: false', s.rolledForward.income.length === 1 && s.rolledForward.income[0].pending === false && s.rolledForward.income[0].fund === 'Pay' && s.rolledForward.income[0].amount > 0, j(s.rolledForward.income));
}

// ---- 7. wins — every kind, the recap's exact strings ----
{
  const r = monthReport(data, '2026-01', IN_MARCH);
  const kinds = r.wins.map((w) => w.kind);
  check('Jan wins: pacing, cats, ahead, stone', j(kinds) === j(['pacing', 'cats', 'ahead', 'stone']), j(r.wins));
  check('pacing text', r.wins[0].text === '1 of 1 pacing fund finished on pace — $50.00 unspent: Groceries', r.wins[0].text);
  check('cats text', r.wins[1].text === '2 of 2 categories came in at or under plan', r.wins[1].text);
  check('ahead text', r.wins[2].text === 'You ended $1,030.00 ahead — income beat spending', r.wins[2].text);
  check('stone text', r.wins[3].text === 'Your garden matured: +1 wall stone — what you manage reached a new high', r.wins[3].text);
  const m = monthReport(data, '2026-03', IN_MARCH);
  const goal = m.wins.find((w) => w.kind === 'goal');
  check('Mar goal win: hit its goal, with fund + hit flag', goal && goal.text === '"Vacation" hit its $300.00 goal — enjoy it!' && goal.fund === 'Vacation' && goal.hit === true, j(goal));
  check('Mar: no stone (1100 < 1200)', !m.wins.some((w) => w.kind === 'stone'));
  // The other two goal variants.
  const g = (carry, planned, spent) => {
    const mm = { id: '2026-05', label: 'May', checks: {}, income: [income('Pay', 100)], categories: [{ name: 'Bills', excludeFromTotals: false, funds: [
      { ...basic('Vacation', planned), carryOver: carry, setup: { type: 'savings', savingsMode: 'target', targetAmount: 300, targetMonth: '2026-05' } }] }],
      transactions: spent ? [tx('Vacation', spent, 'TRIP', '2026-05-05')] : [] };
    return monthReport({ version: 7, settings: {}, months: [mm], aum: { snapshots: [] } }, '2026-05', '2026-06-01').wins.find((w) => w.kind === 'goal');
  };
  check('goal variant: matured — spent against saved', g(200, 100, -350).text === '"Vacation" matured — $350.00 spent against $300.00 saved', g(200, 100, -350).text);
  check('goal variant: matured with X of Y saved', g(100, 100, 0).text === '"Vacation" matured with $200.00 of $300.00 saved' && g(100, 100, 0).hit === false, g(100, 100, 0).text);
  // The fallback: nothing to cheer.
  const quiet = { id: '2026-06', label: 'June', checks: {}, income: [income('Pay', 100)], categories: [{ name: 'Everyday', excludeFromTotals: false, funds: [basic('Gas', 100)] }],
    transactions: [tx('Gas', -150, 'EXXON', '2026-06-05'), tx('Pay', 100, 'EMPLOYER', '2026-06-05')] };
  const q = monthReport({ version: 7, settings: {}, months: [quiet], aum: { snapshots: [] } }, '2026-06', '2026-07-01');
  check('logged fallback', j(q.wins) === j([{ kind: 'logged', text: "The month is logged and every dollar is accounted for — that's the win." }]), j(q.wins));
  check('fmtMoney matches money(): parentheses on negatives', fmtMoney(-41) === '($41.00)' && fmtMoney(1234.5) === '$1,234.50' && fmtMoney(0) === '$0.00');
}

// ---- 8. yearReport — both ranges ----
{
  const y = yearReport(data, { kind: 'year', year: 2026 }, IN_APRIL);
  check('year 2026: three months, all done', j(y.months) === j(['2026-01', '2026-02', '2026-03']) && y.doneMonths.length === 3);
  check('year headline: income 7000, spent 4355, net 2645, savings rate net ÷ income', y.headline.income === 7000 && y.headline.spent === 4355 && y.headline.net === 2645 && Math.abs(y.headline.savingsRate - 2645 / 7000) < 1e-12, j(y.headline));
  check('year AUM change: last in range − first in range = +100', y.headline.aumChange && y.headline.aumChange.amount === 100 && y.headline.aumChange.from === '2026-01-20' && y.headline.aumChange.to === '2026-03-10', j(y.headline.aumChange));
  check('byMonth nets', j(y.byMonth.map((b) => b.net)) === j([1030, 425, 1190]), j(y.byMonth));
  check('categories ranked, Work out, pct of the counted total', y.categories.length === 2 && y.categories[0].name === 'Bills' && y.categories[0].total === 2990 && Math.abs(y.categories[0].pct - 2990 / 4355) < 1e-12, j(y.categories));
  check('grid: 3 month columns, Work row marked, totals and averages', y.grid.months.length === 3 && y.grid.cats.find((c) => c.name === 'Work').excluded === true && y.grid.totals.Everyday === 1365 && y.grid.averages.Everyday === r2(1365 / 3), j(y.grid.totals) + ' ' + j(y.grid.averages));
  check('grid income/net rows', y.grid.incomeTotal === 7000 && y.grid.netTotal === 2645 && y.grid.net['2026-02'] === 425);
  const partial = yearReport(data, { kind: 'year', year: 2026 }, IN_MARCH);
  check('grid average excludes the month that isn\'t done (Jan+Feb only)', partial.grid.averages.Everyday === r2((480 + 575) / 2) && partial.grid.totals.Everyday === 1365 && partial.grid.incomeAvg === 2250, j(partial.grid.averages));
  const gas = y.perFund.find((f) => f.fund === 'Gas');
  check('perFund Gas: over in 1 of 3 — not 2 of 3 (March carried, not over)', gas.overIn === 1 && gas.of === 3 && gas.planned === 300 && gas.spent === 350 && gas.diff === -50, j(gas));
  check('perFund sorted over-in desc then name; Work fund absent', y.perFund[0].fund === 'Gas' && y.perFund[1].fund === 'Fun' && !y.perFund.some((f) => f.fund === 'Work Expenses'), j(y.perFund.map((f) => f.fund)));
  const gasP = partial.perFund.find((f) => f.fund === 'Gas');
  check('perFund with March unfinished: over in 1 of 2 (an open month is neither)', gasP.overIn === 1 && gasP.of === 2 && gasP.present === 3, j(gasP));
  check('year vendors top 10: Rent, Walmart, Exxon, Netflix', j(y.vendors.map((v) => v.label)) === j(['Rent', 'Walmart', 'Exxon', 'Netflix']) && y.vendors[1].total === -945 && y.vendors[1].count === 5, j(y.vendors));
  check('biggest 5 transactions: three rents first, then Groceries 350, 300', j(y.biggest.map((b) => b.amount)) === j([-1000, -1000, -1000, -350, -300]) && y.biggest[3].fund === 'Groceries' && y.biggest[3].vendor === 'WALMART COM' && y.biggest[3].monthId === '2026-01', j(y.biggest));
  check('income months: highest January (2500 — March ties, the earlier month keeps it), lowest February (2000)', y.incomeMonths.highest.id === '2026-01' && y.incomeMonths.highest.received === 2500 && y.incomeMonths.lowest.id === '2026-02' && y.incomeMonths.lowest.received === 2000, j(y.incomeMonths));
  check('fund history lists income funds too, sorted', j(y.funds.map((f) => f.name)) === j(['Bonus', 'Fun', 'Gas', 'Groceries', 'Pay', 'Rent', 'Vacation', 'Work Expenses']) && y.funds.find((f) => f.name === 'Pay').income === true, j(y.funds));
  const gh = y.fundHistory('Gas');
  check('fund history Gas: 3 rows, over only in Feb', gh.length === 3 && j(gh.map((r) => r.over)) === j([false, true, false]) && gh[2].carryOver === -60 && gh[2].leftover === -50, j(gh));
  const bh = y.fundHistory('bonus');
  check('fund history Bonus (normFund lookup): income rows with received and pending', bh.length === 3 && bh[2].income === true && bh[2].received === 500 && bh[2].carryPending === true && bh[1].received === 0, j(bh));
  check('year wins: allocated / onplan / grew', j(y.wins.map((w) => w.kind)) === j(['allocated', 'onplan', 'grew']), j(y.wins));
  check('allocated text: 2 of 3 months fully allocated (March plans 55 more than it earns)', y.wins[0].text === '2 of 3 months fully allocated', y.wins[0].text);
  check('onplan text: Groceries on plan 3 of 3 months', y.wins[1].text === 'Groceries on plan 3 of 3 months' && y.wins[1].fund === 'Groceries', y.wins[1].text);
  check('grew text: Vacation grew $300.00', y.wins[2].text === 'Vacation grew $300.00' && y.wins[2].fund === 'Vacation', y.wins[2].text);
  const l12 = yearReport(data, { kind: 'last12', uptoId: '2026-03' }, IN_APRIL);
  check('last12 up to March covers the same three months', j(l12.months) === j(y.months) && l12.headline.income === 7000);
  const l12b = yearReport(data, { kind: 'last12', uptoId: '2026-02' }, IN_APRIL);
  check('last12 up to February: two months, income 4500', j(l12b.months) === j(['2026-01', '2026-02']) && l12b.headline.income === 4500 && l12b.headline.aumChange.amount === 200, j(l12b.headline));
  check('exT on: year headline unchanged here, category totals move', yearReport(dataExT, { kind: 'year', year: 2026 }, IN_APRIL).grid.totals.Everyday === 1355 && yearReport(dataExT, { kind: 'year', year: 2026 }, IN_APRIL).headline.spent === 4355);
  const empty = yearReport(data, { kind: 'year', year: 2019 }, IN_APRIL);
  check('an empty range renders empty, not thrown', empty.months.length === 0 && empty.headline.income === 0 && empty.headline.savingsRate === null && empty.headline.aumChange === null && empty.wins.length === 0 && empty.incomeMonths.highest === null);
}

// ---- 9. the 14-month fixture: grid ≤ 12 columns, ranges ----
{
  let m = { id: '2025-01', label: 'January', checks: {}, income: [income('Pay', 100)], categories: [{ name: 'Everyday', excludeFromTotals: false, funds: [basic('Gas', 100)] }], transactions: [] };
  const months = [m];
  for (let i = 0; i < 13; i++) { m = buildNextMonth(m, 0.1); setIncome(m, 'Pay', 100); months.push(m); }
  for (const mm of months) mm.transactions.push(tx('Gas', -90, 'EXXON', mm.id + '-05'), tx('Pay', 100, 'EMPLOYER', mm.id + '-05'));
  const d14 = { version: 7, settings: {}, months, aum: { snapshots: [] } };
  check('14 months present', months.length === 14 && months[13].id === '2026-02');
  const l = yearReport(d14, { kind: 'last12', uptoId: '2026-02' }, '2026-03-01');
  check('last12 on 14 months → 12 columns, Mar 2025 → Feb 2026', l.grid.months.length === 12 && l.grid.months[0] === '2025-03' && l.grid.months[11] === '2026-02', j(l.grid.months));
  const y25 = yearReport(d14, { kind: 'year', year: 2025 }, '2026-03-01');
  check('year 2025 → 12 columns; 2026 → 2', y25.grid.months.length === 12 && yearReport(d14, { kind: 'year', year: 2026 }, '2026-03-01').grid.months.length === 2);
  check('12 of 12 months fully allocated · Gas on plan 12 of 12 months', y25.wins[0].text === '12 of 12 months fully allocated' && y25.wins[1].text === 'Gas on plan 12 of 12 months', j(y25.wins));
  check('yearsPresent newest first', j(yearsPresent(d14)) === j(['2026', '2025']));
  check('rangeMonths last12 is the same list the report used', rangeMonths(d14, { kind: 'last12', uptoId: '2026-02' }).length === 12);
  // The trailing-12 average window: month 14's average covers months 2–13 only.
  const last = monthReport(d14, '2026-02', '2026-03-01');
  check('monthReport average window is the 12 done months before the report month', last.funds[0].avg === 90 && last.funds[0].vsAvg === 0);
}

// ---- 10. defaults ----
{
  check('defaultReportMonth: the most recent done month (Feb while March is under way)', defaultReportMonth(data, IN_MARCH) === '2026-02');
  check('defaultReportMonth: March once it is done', defaultReportMonth(data, IN_APRIL) === '2026-03');
  check('defaultReportMonth: the only month when nothing is done yet', defaultReportMonth({ months: [jan] }, '2026-01-10') === '2026-01');
  check('monthReport on an unknown month → null', monthReport(data, '2031-01', IN_MARCH) === null);
  const r = monthReport(data, '2026-02', IN_MARCH);
  check('monthReport carries prev/next ids and done', r.prevId === '2026-01' && r.nextId === '2026-03' && r.done === true && monthReport(data, '2026-03', IN_MARCH).done === false);
}

// ---- 11. 1.3.0 Sitting D, W0 a/b — the sentence's spent is the headline's; income months use finished months ----
{
  // (a) A refund in a fourth counted category: the headline's Spent is the counted,
  // signed total (1310 − 80 = 1230); catRows keep the absolute per-category spend.
  const marR = { ...mar,
    categories: [...mar.categories, { name: 'Odds', excludeFromTotals: false, funds: [basic('Deposit Back', 0)] }],
    transactions: [...mar.transactions, tx('Deposit Back', 80, 'LANDLORD DEPOSIT REFUND', '2026-03-20')] };
  const dataRefund = { ...mkData(), months: [jan, feb, marR] };
  const dataRefundExT = { ...mkData({ excludeTransfers: true }), months: [jan, feb, marR] };
  const r = monthReport(dataRefund, '2026-03', IN_APRIL);
  const x = monthReport(dataRefundExT, '2026-03', IN_APRIL);
  check('W0 a: planVsReality.spent === headline.spent === 1230 (1310 − 80 refund), transfers counted; diff follows',
    r.planVsReality.spent === r.headline.spent && r.headline.spent === 1230 && r.planVsReality.diff === r2(r.planVsReality.planned - 1230), j([r.planVsReality, r.headline]));
  check('W0 a: the same with transfers excluded; catRows Odds keeps the absolute 80',
    x.planVsReality.spent === x.headline.spent && x.headline.spent === 1230 && r.catRows.find((c) => c.name === 'Odds').spent === 80, j([x.planVsReality, x.headline, r.catRows]));
  // (b) March without its Pay row receives 500: while March is under way the lowest is
  // still February (2000); once it is done, March (500). No finished month → all months.
  const marLow = { ...mar, transactions: mar.transactions.filter((t) => t.fund !== 'Pay') };
  const dataLow = { ...mkData(), months: [jan, feb, marLow] };
  const inMar = yearReport(dataLow, { kind: 'year', year: 2026 }, IN_MARCH).incomeMonths;
  const inApr = yearReport(dataLow, { kind: 'year', year: 2026 }, IN_APRIL).incomeMonths;
  const none = yearReport(dataLow, { kind: 'year', year: 2026 }, '2026-01-10').incomeMonths;
  check('W0 b: lowest income month is February (2000) while March is under way, March (500) once done; no finished month → all months',
    inMar.lowest.id === '2026-02' && inMar.lowest.received === 2000 && inMar.highest.id === '2026-01'
    && inApr.lowest.id === '2026-03' && inApr.lowest.received === 500 && inApr.highest.id === '2026-01'
    && none.highest.id === '2026-01' && none.lowest.id === '2026-03' && none.lowest.received === 500, j([inMar, inApr, none]));
}

console.log(`\ntest-reports: ${pass} passed, ${fail} failed`);

if (failures.length) { console.log('\nFailures:'); for (const f of failures) console.log('  ✗ ' + f); }
process.exit(fail ? 1 : 0);
