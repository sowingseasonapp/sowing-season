// Reports (1.3.0 Sitting C, D2) — the pure module behind the Reports view and the
// Harvest recap. Same pattern as garden.js: reads compute.js, writes nothing,
// touches no DOM. app.js renders what comes back (esc() on every name there).
//
//   monthReport(data, monthId, todayISO) — This Month + the recap's catRows / wins
//   yearReport(data, range, todayISO)    — This Year; range = { kind: 'year', year }
//                                          | { kind: 'last12', uptoId }
//
// Rules that hold everywhere here (the proposal's invariants):
//  - the "exclude transfers" setting is read from data.settings and applied with
//    the same arithmetic as app.js (actIncome / actExpense / actDiff / catSpentAbs);
//  - a category with excludeFromTotals (Work) is out of every headline, ranking
//    and average — it may still appear in a table, marked `excluded`;
//  - averages use only months that are done (garden.js monthContext) and never
//    the report month itself; null with fewer than 2 such months;
//  - "over" is a fund's own month (compute.js fundSplit.overThisMonth), never the
//    raw leftover — a fund carrying old red would otherwise read over every month;
//  - every aggregate goes through r2; every fund comparison through normFund;
//  - transfers leave the vendor lists via isTransferTx.
import {
  computeMonth, buildNextMonth, fundSplit, isTransferTx, normFund, r2, monthAdd, MONTH_NAMES,
} from './compute.js';
import { monthContext, stonesLaidIn } from './garden.js';
import { vendorKey } from './csv.js';

// app.js money(): "$1,234.56", negatives in parentheses. The recap gate compares
// these strings, so the format is copied, not shared.
const fmtUSD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export function fmtMoney(n) {
  if (n == null || isNaN(n)) return '';
  const s = fmtUSD.format(Math.abs(n));
  return n < -0.004 ? `(${s})` : s;
}
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---- the exT accessors, as app.js has them ----
const exT = (data) => !!(data.settings && data.settings.excludeTransfers);
const actIncome = (data, c) => exT(data) ? c.summary.actualIncomeExT : c.summary.actualIncome;
const actExpense = (data, c) => exT(data) ? c.summary.actualExpenseExT : c.summary.actualExpense;
const actDiff = (data, c) => exT(data) ? c.summary.actualDiffExT : c.summary.actualDiff;
const catSpentAbs = (data, cat) => Math.abs(exT(data) ? r2(cat.totals.expensed - cat.totals.transfers) : cat.totals.expensed);
// A fund's spent as the Budget grid shows it: money out as a positive number;
// a month where more came back than went out reads negative.
const fundSpent = (f) => r2(-f.expensed);
const incomeReceived = (data, f) => exT(data) ? r2(f.received - f.transfers) : f.received;

// compute.js monthAdd is forward-only (a negative offset trips JS's % on
// negatives), so the trailing windows here use their own, which goes both ways.
function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12 + 12) % 12 + 1).padStart(2, '0')}`;
}
const sortedMonths = (data) => data.months.slice().sort((a, b) => a.id.localeCompare(b.id));
const isDone = (id, todayISO) => monthContext(id, todayISO).monthDone === true;

// The computed expense fund by name in a computed month, with its category — or null.
function findFund(comp, key) {
  for (const c of comp.categories) for (const f of c.funds) if (normFund(f.fund) === key) return { f, c };
  return null;
}
const findIncome = (comp, key) => comp.income.find((f) => normFund(f.fund) === key) || null;
const titleCase = (w) => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : '';

// Group a month's transactions by vendorKey. Expense funds outside Work only,
// transfers out, refunds (positive amounts) reduce the total — so `total` is the
// signed sum (spending negative) and the ranking is by −total.
function vendorRows(data, comps, limit) {
  const groups = new Map();
  for (const { m, c } of comps) {
    const expenseOf = new Map();
    for (const cat of c.categories) if (!cat.excludeFromTotals) for (const f of cat.funds) expenseOf.set(normFund(f.fund), f.fund);
    for (const t of m.transactions) {
      if (isTransferTx(t)) continue;
      if (!expenseOf.has(normFund(t.fund))) continue;
      const key = vendorKey(t.vendor);
      if (!key) continue;
      let g = groups.get(key);
      if (!g) { g = { key, total: 0, count: 0, raws: new Map() }; groups.set(key, g); }
      g.total = r2(g.total + t.amount);
      g.count++;
      const raw = String(t.vendor || '').trim();
      g.raws.set(raw, (g.raws.get(raw) || 0) + 1);
    }
  }
  const rows = [...groups.values()].map((g) => {
    // Display label: the most frequent raw string's first word, title-cased —
    // preferring the word that is the key itself, so "TFR TO SAVINGS" reads
    // "Savings", not "Tfr".
    let best = '', bestN = -1;
    for (const [raw, n] of g.raws) if (n > bestN) { best = raw; bestN = n; }
    const words = best.split(/\s+/).filter(Boolean);
    const hit = words.find((w) => vendorKey(w) === g.key);
    return { key: g.key, label: titleCase(hit || words[0] || g.key), count: g.count, total: g.total };
  });
  rows.sort((a, b) => a.total - b.total || a.label.localeCompare(b.label)); // most spent first
  return rows.slice(0, limit);
}

// The recap's rules (showMonthCloseWorkflow at f1b8e4e), character for character,
// as plain text. kind ∈ pacing | cats | ahead | goal | stone | logged.
function recapRows(data, month, comp) {
  const catRows = comp.categories
    .filter((c) => !c.excludeFromTotals)
    .map((c) => ({ name: c.name, planned: r2(c.totals.carryOver + c.totals.planned), spent: catSpentAbs(data, c) }))
    .filter((c) => c.planned > 0.004 || c.spent > 0.004);
  const catsUnder = catRows.filter((c) => c.spent <= c.planned + 0.004).length;
  const pacingAll = [], pacingWins = [];
  for (const c of comp.categories) {
    if (c.excludeFromTotals) continue;
    for (const f of c.funds) {
      if ((f.setup?.type) !== 'pacing' || f.expensed >= -0.004) continue;
      pacingAll.push(f);
      if (f.leftover >= -0.004) pacingWins.push(f);
    }
  }
  const matured = [];
  for (const c of comp.categories) for (const f of c.funds) {
    if (f.setup?.type === 'savings' && f.setup.targetMonth === month.id) matured.push(f);
  }
  const wins = [];
  if (pacingWins.length && pacingAll.length) {
    const saved = r2(pacingWins.reduce((a, f) => a + Math.max(0, f.leftover), 0));
    wins.push({ kind: 'pacing', text: `${pacingWins.length} of ${pacingAll.length} pacing fund${pacingAll.length > 1 ? 's' : ''} finished on pace${saved > 0.004 ? ` — ${fmtMoney(saved)} unspent` : ''}: ${pacingWins.map((f) => f.fund).join(', ')}` });
  }
  if (catsUnder && catRows.length) wins.push({ kind: 'cats', text: `${catsUnder} of ${catRows.length} categories came in at or under plan` });
  if (actDiff(data, comp) > 0.004) wins.push({ kind: 'ahead', text: `You ended ${fmtMoney(actDiff(data, comp))} ahead — income beat spending` });
  for (const f of matured) {
    const set = r2(f.carryOver + f.planned);
    const spentHere = f.expensed < -0.004 ? -f.expensed : 0;
    const hit = !(f.leftover < -0.004) && set >= f.setup.targetAmount - 0.004;
    wins.push({ kind: 'goal', fund: f.fund, hit, done: !!f.setup.done, text: f.leftover < -0.004
      ? `"${f.fund}" matured — ${fmtMoney(spentHere)} spent against ${fmtMoney(set)} saved`
      : hit
      ? `"${f.fund}" hit its ${fmtMoney(f.setup.targetAmount)} goal — enjoy it!`
      : `"${f.fund}" matured with ${fmtMoney(set)} of ${fmtMoney(f.setup.targetAmount)} saved` });
  }
  const laid = stonesLaidIn((data.aum || {}).snapshots, month.id);
  if (laid) wins.push({ kind: 'stone', text: `Your garden matured: +${laid} wall stone${laid === 1 ? '' : 's'} — what you manage reached a new high` });
  if (!wins.length) wins.push({ kind: 'logged', text: `The month is logged and every dollar is accounted for — that's the win.` });
  return { catRows, catsUnder, wins };
}

// What the month after `month` opens with: its stored funds when the month exists,
// else the engine's own buildNextMonth. Work categories are left out (nothing of
// theirs counts anywhere else on the page either).
function rolledForward(data, months, month) {
  const i = months.findIndex((m) => m.id === month.id);
  const existing = months[i + 1] && months[i + 1].id === monthAdd(month.id, 1) ? months[i + 1] : null;
  const next = existing || buildNextMonth(month, data.settings.tithePercent ?? 0.15);
  let total = 0, count = 0;
  const negatives = [];
  for (const c of next.categories) {
    if (c.excludeFromTotals) continue;
    for (const f of c.funds) {
      if (Math.abs(f.carryOver) <= 0.004) continue;
      total = r2(total + f.carryOver); count++;
      if (f.carryOver < -0.004) negatives.push({ fund: f.fund, amount: f.carryOver });
    }
  }
  negatives.sort((a, b) => a.amount - b.amount);
  const income = [];
  for (const f of next.income) {
    if (f.carryPending) income.push({ fund: f.fund, amount: f.carryOver, pending: true });
    else if (Math.abs(f.carryOver) > 0.004) income.push({ fund: f.fund, amount: f.carryOver, pending: false });
  }
  return { nextId: next.id, computed: !existing, total, count, negatives, income };
}

export function monthReport(data, monthId, todayISO) {
  const months = sortedMonths(data);
  const idx = months.findIndex((m) => m.id === monthId);
  if (idx < 0) return null;
  const month = months[idx];
  const comp = computeMonth(month);
  const prev = idx > 0 ? months[idx - 1] : null;
  const prevComp = prev ? computeMonth(prev) : null;

  // The trailing 12 done months before this one (newest first), computed once.
  const floor = addMonths(monthId, -12);
  const history = months
    .filter((m) => m.id < monthId && m.id >= floor && isDone(m.id, todayISO))
    .sort((a, b) => b.id.localeCompare(a.id))
    .map((m) => computeMonth(m));

  const headline = { income: actIncome(data, comp), spent: Math.abs(actExpense(data, comp)), net: actDiff(data, comp), exT: exT(data) };

  // Plan vs reality over the counted expense funds.
  let planned = 0, carriedIn = 0, spentAll = 0;
  for (const c of comp.categories) {
    if (c.excludeFromTotals) continue;
    planned = r2(planned + c.totals.carryOver + c.totals.planned);
    carriedIn = r2(carriedIn + c.totals.carryOver);
    spentAll = r2(spentAll + catSpentAbs(data, c));
  }
  const planVsReality = { planned, carriedIn, spent: spentAll, diff: r2(planned - spentAll) };

  // Funds table: grouped by category, over rows first (most over first), the rest
  // in budget order. Work funds ride along, marked, as the grid marks them.
  const funds = [];
  const overs = []; // candidates for "What changed"
  const unders = [];
  for (const c of comp.categories) {
    const rows = c.funds.map((f) => {
      const key = normFund(f.fund);
      const split = fundSplit(f);
      const spent = fundSpent(f);
      const last = prevComp ? findFund(prevComp, key) : null;
      const past = history.map((h) => findFund(h, key)).filter(Boolean);
      const avg = past.length >= 2 ? r2(past.reduce((a, x) => a + fundSpent(x.f), 0) / past.length) : null;
      const row = {
        fund: f.fund, category: c.name, excluded: !!c.excludeFromTotals, type: (f.setup && f.setup.type) || 'basic',
        planned: r2(f.carryOver + f.planned), spent, left: f.leftover,
        vsLast: last ? r2(spent - fundSpent(last.f)) : null,
        vsAvg: avg == null ? null : r2(spent - avg), avg,
        over: split.overThisMonth < -0.004, overBy: split.overThisMonth < -0.004 ? r2(-split.overThisMonth) : 0,
        own: split.own,
      };
      if (!c.excludeFromTotals) {
        if (row.over) overs.push(row);
        // An underspend is a fund with a plan it didn't use up this month. A
        // savings fund not spending is the point, not a change — left out.
        else if (row.type !== 'savings' && split.own > 0.004 && f.planned > 0.004) unders.push(row);
      }
      return row;
    });
    const overRows = rows.filter((r) => r.over).sort((a, b) => b.overBy - a.overBy);
    funds.push(...overRows, ...rows.filter((r) => !r.over));
  }

  const incomeFunds = comp.income.map((f) => {
    const key = normFund(f.fund);
    const last = prevComp ? findIncome(prevComp, key) : null;
    const received = incomeReceived(data, f);
    return {
      fund: f.fund, planned: f.planned, received, carryOver: f.carryOver, carryPending: !!f.carryPending,
      vsLast: last ? r2(received - incomeReceived(data, last)) : null,
    };
  });

  // What changed — at most three, in this order, each only when it exists.
  const changed = [];
  if (overs.length) {
    const top = overs.slice().sort((a, b) => b.overBy - a.overBy)[0];
    const key = normFund(top.fund);
    const recent = history.map((h) => findFund(h, key)).filter(Boolean).slice(0, 4);
    const n = recent.filter((x) => fundSplit(x.f).overThisMonth < -0.004).length;
    const clause = recent.length ? `; over in ${n} of the last ${recent.length} month${recent.length === 1 ? '' : 's'}` : '';
    changed.push({ kind: 'fund', fund: top.fund, text: `${top.fund} — ${fmtMoney(top.overBy)} over${clause}` });
  }
  if (unders.length) {
    const top = unders.slice().sort((a, b) => b.own - a.own)[0];
    changed.push({ kind: 'fund', fund: top.fund, text: `${top.fund} — ${fmtMoney(top.own)} under` });
  }
  {
    const expenseOf = new Map();
    for (const c of comp.categories) if (!c.excludeFromTotals) for (const f of c.funds) expenseOf.set(normFund(f.fund), f.fund);
    let big = null;
    for (const t of month.transactions) {
      if (isTransferTx(t) || !(t.amount < -0.004) || !expenseOf.has(normFund(t.fund))) continue;
      if (!big || t.amount < big.amount) big = t;
    }
    if (big) {
      const [, mo, d] = String(big.date || '').split('-').map(Number);
      const when = mo ? `${MONTH_SHORT[mo - 1]} ${d}` : '';
      const fundName = expenseOf.get(normFund(big.fund));
      changed.push({ kind: 'tx', fund: fundName, txId: big.id, amount: big.amount,
        text: `${String(big.vendor || '').trim()} ${fmtMoney(-big.amount)}${when ? ` on ${when}` : ''} — ${fundName} fund` });
    }
  }

  const vendors = vendorRows(data, [{ m: month, c: comp }], 5);
  const rolled = rolledForward(data, months, month);
  const recap = recapRows(data, month, comp);

  return {
    id: month.id, label: month.label, done: isDone(month.id, todayISO),
    prevId: prev ? prev.id : null, nextId: months[idx + 1] ? months[idx + 1].id : null,
    headline, planVsReality, funds, incomeFunds, changed, vendors, rolledForward: rolled,
    wins: recap.wins, catRows: recap.catRows, catsUnder: recap.catsUnder,
  };
}

// The months a range covers, oldest first: a calendar year, or the 12 ending at uptoId.
export function rangeMonths(data, range) {
  const months = sortedMonths(data);
  if (range.kind === 'last12') {
    const from = addMonths(range.uptoId, -11);
    return months.filter((m) => m.id >= from && m.id <= range.uptoId);
  }
  const y = String(range.year);
  return months.filter((m) => m.id.slice(0, 4) === y);
}

export function yearReport(data, range, todayISO) {
  const months = rangeMonths(data, range);
  const comps = months.map((m) => ({ m, c: computeMonth(m), done: isDone(m.id, todayISO) }));
  const doneComps = comps.filter((x) => x.done);

  // Headline.
  let income = 0, spent = 0, net = 0;
  for (const { c } of comps) {
    income = r2(income + actIncome(data, c));
    spent = r2(spent + Math.abs(actExpense(data, c)));
    net = r2(net + actDiff(data, c));
  }
  const savingsRate = income > 0.004 ? net / income : null;
  let aumChange = null;
  if (months.length) {
    const lo = `${months[0].id}-01`, hi = `${months[months.length - 1].id}-31`;
    const snaps = ((data.aum && data.aum.snapshots) || [])
      .filter((s) => s && typeof s.aum === 'number' && s.date >= lo && s.date <= hi)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (snaps.length >= 2) aumChange = { amount: r2(snaps[snaps.length - 1].aum - snaps[0].aum), from: snaps[0].date, to: snaps[snaps.length - 1].date };
  }
  const headline = { income, spent, net, savingsRate, aumChange, exT: exT(data) };

  const byMonth = comps.map(({ m, c, done }) => ({
    id: m.id, label: m.label, done, income: actIncome(data, c), spent: Math.abs(actExpense(data, c)), net: actDiff(data, c),
  }));

  // Categories, in first-seen order; Work marked and out of the ranking.
  const catNames = [], excludedCats = new Set();
  for (const { m } of comps) for (const c of m.categories) {
    if (!catNames.includes(c.name)) catNames.push(c.name);
    if (c.excludeFromTotals) excludedCats.add(c.name);
  }
  const cells = {}, totals = {}, averages = {};
  for (const name of catNames) {
    cells[name] = {}; let tot = 0, doneSum = 0, doneN = 0;
    for (const { m, c, done } of comps) {
      const cat = c.categories.find((x) => x.name === name);
      const v = cat ? catSpentAbs(data, cat) : null;
      cells[name][m.id] = v;
      if (v != null) { tot = r2(tot + v); if (done) { doneSum = r2(doneSum + v); doneN++; } }
    }
    totals[name] = tot;
    averages[name] = doneN ? r2(doneSum / doneN) : null;
  }
  const incomeRow = {}, netRow = {};
  let incomeTotal = 0, netTotal = 0, incDone = 0, netDone = 0, doneN = 0;
  for (const { m, c, done } of comps) {
    incomeRow[m.id] = actIncome(data, c); netRow[m.id] = actDiff(data, c);
    incomeTotal = r2(incomeTotal + incomeRow[m.id]); netTotal = r2(netTotal + netRow[m.id]);
    if (done) { incDone = r2(incDone + incomeRow[m.id]); netDone = r2(netDone + netRow[m.id]); doneN++; }
  }
  const grid = {
    cats: catNames.map((name) => ({ name, excluded: excludedCats.has(name) })),
    months: months.map((m) => m.id), cells, totals, averages,
    income: incomeRow, incomeTotal, incomeAvg: doneN ? r2(incDone / doneN) : null,
    net: netRow, netTotal, netAvg: doneN ? r2(netDone / doneN) : null,
  };
  const rankTotal = catNames.filter((n) => !excludedCats.has(n)).reduce((a, n) => r2(a + totals[n]), 0);
  const categories = catNames
    .filter((n) => !excludedCats.has(n) && totals[n] > 0.004)
    .map((n) => ({ name: n, total: totals[n], pct: rankTotal > 0.004 ? totals[n] / rankTotal : 0 }))
    .sort((a, b) => b.total - a.total);

  // Per fund over the range (expense funds outside Work). `over` is the fund's
  // own month; n and m count done months only, so an unfinished month never
  // reads as over or as on plan.
  const fundOrder = [], fundInfo = new Map();
  for (const { c } of comps) for (const cat of c.categories) {
    if (cat.excludeFromTotals) continue;
    for (const f of cat.funds) {
      const k = normFund(f.fund);
      if (!fundInfo.has(k)) { fundOrder.push(k); fundInfo.set(k, { fund: f.fund, category: cat.name, type: (f.setup && f.setup.type) || 'basic' }); }
    }
  }
  const perFund = fundOrder.map((k) => {
    const info = fundInfo.get(k);
    let planned = 0, sp = 0, overIn = 0, of = 0, present = 0;
    for (const { c, done } of comps) {
      const hit = findFund(c, k);
      if (!hit) continue;
      present++;
      planned = r2(planned + hit.f.planned); sp = r2(sp + fundSpent(hit.f));
      if (done) { of++; if (fundSplit(hit.f).overThisMonth < -0.004) overIn++; }
    }
    return { ...info, planned, spent: sp, diff: r2(planned - sp), overIn, of, present };
  }).sort((a, b) => b.overIn - a.overIn || a.fund.localeCompare(b.fund));

  const vendors = vendorRows(data, comps, 10);

  // Biggest five expense transactions in the range.
  const biggest = [];
  for (const { m, c } of comps) {
    const expenseOf = new Map();
    for (const cat of c.categories) if (!cat.excludeFromTotals) for (const f of cat.funds) expenseOf.set(normFund(f.fund), f.fund);
    for (const t of m.transactions) {
      if (isTransferTx(t) || !(t.amount < -0.004) || !expenseOf.has(normFund(t.fund))) continue;
      biggest.push({ txId: t.id, monthId: m.id, date: t.date, vendor: String(t.vendor || '').trim(), fund: expenseOf.get(normFund(t.fund)), amount: t.amount });
    }
  }
  biggest.sort((a, b) => a.amount - b.amount);
  const biggest5 = biggest.slice(0, 5);

  let highest = null, lowest = null;
  for (const b of byMonth) {
    if (!highest || b.income > highest.received) highest = { id: b.id, label: b.label, received: b.income };
    if (!lowest || b.income < lowest.received) lowest = { id: b.id, label: b.label, received: b.income };
  }
  const incomeMonths = { highest, lowest };

  // Fund history (the drilldown): every expense and income fund seen in range.
  const historyFunds = [];
  for (const { m } of comps) {
    for (const c of m.categories) for (const f of c.funds) if (!historyFunds.some((x) => normFund(x.name) === normFund(f.fund))) historyFunds.push({ name: f.fund, income: false });
    for (const f of m.income) if (!historyFunds.some((x) => normFund(x.name) === normFund(f.fund))) historyFunds.push({ name: f.fund, income: true });
  }
  historyFunds.sort((a, b) => a.name.localeCompare(b.name));
  const fundHistory = (name) => {
    const k = normFund(name);
    const rows = [];
    for (const { m, c, done } of comps) {
      const inc = findIncome(c, k);
      if (inc) {
        rows.push({ id: m.id, label: m.label, done, income: true, carryOver: inc.carryOver, carryPending: !!inc.carryPending,
          planned: inc.planned, received: incomeReceived(data, inc), spent: null, leftover: inc.leftover, over: false });
        continue;
      }
      const hit = findFund(c, k);
      if (hit) {
        const split = fundSplit(hit.f);
        rows.push({ id: m.id, label: m.label, done, income: false, carryOver: hit.f.carryOver, planned: hit.f.planned,
          received: null, spent: fundSpent(hit.f), leftover: hit.f.leftover, own: split.own,
          over: split.overThisMonth < -0.004, overBy: split.overThisMonth < -0.004 ? r2(-split.overThisMonth) : 0 });
      }
    }
    return rows;
  };

  // Wins for the year.
  const wins = [];
  const M = doneComps.length;
  if (M) {
    const N = doneComps.filter(({ c }) => Math.abs(c.summary.leftToAllocate) <= 0.02).length;
    wins.push({ kind: 'allocated', text: `${N} of ${M} month${M === 1 ? '' : 's'} fully allocated` });
    let best = null;
    for (const k of fundOrder) {
      let present = 0, on = 0;
      for (const { c } of doneComps) {
        const hit = findFund(c, k);
        if (!hit) continue;
        present++;
        if (!(fundSplit(hit.f).overThisMonth < -0.004)) on++;
      }
      if (!present || present * 2 < M || !on) continue;
      const ratio = on / present;
      if (!best || ratio > best.ratio + 1e-9 || (Math.abs(ratio - best.ratio) < 1e-9 && present > best.present)) {
        best = { fund: fundInfo.get(k).fund, on, present, ratio };
      }
    }
    if (best) wins.push({ kind: 'onplan', fund: best.fund, text: `${best.fund} on plan ${best.on} of ${best.present} month${best.present === 1 ? '' : 's'}` });
  }
  {
    let best = null;
    for (const k of fundOrder) {
      if (fundInfo.get(k).type !== 'savings') continue;
      let first = null, last = null;
      for (const { c } of comps) {
        const hit = findFund(c, k);
        if (!hit) continue;
        if (!first) first = hit.f;
        last = hit.f;
      }
      if (!first) continue;
      const grew = r2(last.leftover - first.carryOver);
      if (grew > 0.004 && (!best || grew > best.grew)) best = { fund: fundInfo.get(k).fund, grew };
    }
    if (best) wins.push({ kind: 'grew', fund: best.fund, text: `${best.fund} grew ${fmtMoney(best.grew)}` });
  }

  return {
    range, months: months.map((m) => m.id), doneMonths: doneComps.map((x) => x.m.id),
    headline, byMonth, categories, grid, perFund, vendors, biggest: biggest5, incomeMonths,
    funds: historyFunds, fundHistory, wins,
  };
}

// The calendar years present in the data, newest first — the range selector's options.
export function yearsPresent(data) {
  return [...new Set(data.months.map((m) => m.id.slice(0, 4)))].sort().reverse();
}

// The default This Month: the most recent done month, else the only/latest month.
export function defaultReportMonth(data, todayISO) {
  const months = sortedMonths(data);
  if (!months.length) return null;
  const done = months.filter((m) => isDone(m.id, todayISO));
  return (done.length ? done[done.length - 1] : months[months.length - 1]).id;
}

export { MONTH_NAMES };
