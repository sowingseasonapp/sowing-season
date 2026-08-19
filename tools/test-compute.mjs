// Verifies the app's computation engine against the spreadsheet's own cached values.
import { createRequire } from 'module';
import {
  computeMonth, buildNextMonth, normFund, migrateV2, migrateV3, migrateV4, migrateV5,
  applyTitheRules, titheBase, autoPlanned, isOverridden, fundFlags, r2,
  savingsMonthly, monthAdd, monthDiff,
  migrateV6, aumTotals, upsertSnapshot, aumLastUpdated,
} from '../src/compute.js';
import { parseBankCsv, buildVendorMap, suggestFund, findDuplicate } from '../src/csv.js';
import fs from 'fs';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const seed = JSON.parse(fs.readFileSync(new URL('../data/seed.json', import.meta.url), 'utf8'));
const wb = XLSX.readFile('C:/Users/redacted/Desktop/2026 Budget.xlsx', { cellFormula: true });

const MONTHS = [
  ['December', '2025-12'], ['January', '2026-01'], ['February', '2026-02'],
  ['March', '2026-03'], ['April', '2026-04'], ['May', '2026-05'],
  ['June', '2026-06'], ['July', '2026-07'], ['August', '2026-08'],
];

let ok = 0, bad = 0;
function check(label, mine, sheet, tol = 0.011) { // app rounds to whole cents; sheet keeps sub-penny floats
  if (typeof sheet !== 'number') return;
  if (Math.abs(mine - sheet) < tol) ok++;
  else { bad++; console.log(`MISMATCH ${label}: app=${mine} sheet=${sheet}`); }
}

for (const [name, id] of MONTHS) {
  const fab = wb.Sheets[name + ' Fab'];
  const month = seed.months.find((m) => m.id === id);
  const comp = computeMonth(month);
  const v = (a) => { const c = fab[a]; return c ? c.v : undefined; };

  // Summary block: C3 allocated(income), D3 planned expenses, E3 leftover, C4 actual income, C5 actual expense, C6 diff
  check(`${name} plannedIncome`, comp.summary.plannedIncome, v('C3'));
  check(`${name} allocated`, comp.summary.allocated, v('D3'));
  check(`${name} leftToAllocate`, comp.summary.leftToAllocate, v('E3'));
  check(`${name} actualIncome`, comp.summary.actualIncome, v('C4'));
  check(`${name} actualExpense`, comp.summary.actualExpense, v('C5'));
  check(`${name} actualDiff`, comp.summary.actualDiff, v('C6'));

  // Every fund row on the sheet: leftover (col E) where col D is a SUMIF formula
  const range = XLSX.utils.decode_range(fab['!ref']);
  for (let r = 1; r <= range.e.r + 1; r++) {
    const cell = fab['D' + r];
    if (!cell || !cell.f || !/^SUMIF/i.test(cell.f)) continue;
    const fundName = v('A' + r);
    const isIncomeRow = comp.income.some((f) => normFund(f.fund) === normFund(fundName)) &&
      r < 36; // income section sits at the top
    let mine = null;
    if (isIncomeRow) {
      const f = comp.income.find((f) => normFund(f.fund) === normFund(fundName));
      if (f) mine = { got: f.received, left: f.leftover };
    } else {
      for (const c of comp.categories) {
        const f = c.funds.find((f) => normFund(f.fund) === normFund(fundName));
        if (f) { mine = { got: f.expensed, left: f.leftover }; break; }
      }
    }
    if (mine) {
      check(`${name} ${fundName} sum`, mine.got, v('D' + r));
      check(`${name} ${fundName} leftover`, mine.left, v('E' + r));
    } else { bad++; console.log(`MISSING fund ${name} ${fundName}`); }
  }
}
console.log(`\nCompute engine vs spreadsheet: ${ok} checks passed, ${bad} failed`);

// ---- next-month builder sanity: build January from December, compare carryovers to sheet January ----
{
  const dec = seed.months.find((m) => m.id === '2025-12');
  const janSheet = seed.months.find((m) => m.id === '2026-01');
  const jan = buildNextMonth(dec, 0.15);
  let cOk = 0, cDiff = 0;
  for (const c of jan.categories) {
    const sc = janSheet.categories.find((x) => x.name === c.name);
    if (!sc) continue;
    for (const f of c.funds) {
      const sf = sc.funds.find((x) => normFund(x.fund) === normFund(f.fund));
      if (!sf) continue;
      if (Math.abs(f.carryOver - sf.carryOver) < 0.006) cOk++;
      else { cDiff++; console.log(`carryover diff Jan ${f.fund}: built=${f.carryOver} sheet=${sf.carryOver}`); }
    }
  }
  console.log(`Next-month carryovers: ${cOk} match sheet January, ${cDiff} differ (manual sheet edits expected)`);
}

// ---- v2 migration: grouping + titheAmount defaults must preserve every tithe value ----
{
  const fresh = JSON.parse(fs.readFileSync(new URL('../data/seed.json', import.meta.url), 'utf8'));
  const before = {};
  for (const m of fresh.months) {
    for (const c of m.categories) for (const f of c.funds) {
      if (f.rule?.type === 'tithe') before[m.id] = f.planned;
    }
  }
  migrateV2(fresh);
  let mOk = 0, mExplained = 0, mBad = 0;
  for (const m of fresh.months) {
    // Dec–Mar the sheet's tithe formula excluded the Gifts row; the app's rule
    // (matching the sheet's April+ formula) includes it. Only a re-edit of those
    // months would recompute — stored values stay as imported.
    const gifts = m.income.find((f) => normFund(f.fund) === 'gifts')?.planned || 0;
    applyTitheRules(m, 0.15);
    for (const c of m.categories) for (const f of c.funds) {
      if (f.rule?.type === 'tithe') {
        const drift = f.planned - before[m.id];
        if (Math.abs(drift) < 0.011) mOk++;
        else if (Math.abs(drift - gifts * 0.15) < 0.011) mExplained++;
        else { mBad++; console.log(`MIGRATION TITHE DRIFT ${m.id}: was ${before[m.id]} now ${f.planned} (base ${titheBase(m)})`); }
      }
    }
  }
  console.log(`\nMigration: tithe preserved in ${mOk} months, ${mExplained} differ only by the sheet's pre-April Gifts exclusion, ${mBad} unexplained`);
  const aug = fresh.months.find((x) => x.id === '2026-08');
  console.log('August groups:', aug.income.map((f) => `${f.fund}=${f.group}${f.titheExempt ? '(exempt)' : ''}`).join(', '));
  // New-math sanity: titheable/check 4500 × 2 checks + bonus planned, ×15%
  const chk = aug.checks['the owner Checks'];
  chk.titheAmount = 4500;
  applyTitheRules(aug, 0.15);
  const bonusPlanned = aug.income.filter((f) => f.group === 'bonus' && !f.titheExempt).reduce((a, f) => a + f.planned, 0);
  const expected = Math.round((chk.count * 4500 + bonusPlanned) * 0.15 * 100) / 100;
  const tithe = aug.categories.flatMap((c) => c.funds).find((f) => f.rule?.type === 'tithe');
  console.log(`New tithe math: ${chk.count} checks × $4500 + bonus $${bonusPlanned} → tithe ${tithe.planned} (expected ${expected}) ${Math.abs(tithe.planned - expected) < 0.011 ? 'OK' : 'MISMATCH'}`);
}

// ---- v3 migration: fund setups + flags ----
{
  const d = JSON.parse(fs.readFileSync(new URL('../data/seed.json', import.meta.url), 'utf8'));
  migrateV2(d);
  const beforePlanned = {};
  for (const m of d.months) for (const c of m.categories) for (const f of c.funds) beforePlanned[m.id + '|' + normFund(f.fund)] = f.planned;
  migrateV3(d);
  let pOk = 0, pBad = 0, fixedCount = 0, multiCount = 0;
  for (const m of d.months) for (const c of m.categories) for (const f of c.funds) {
    if (Math.abs(f.planned - beforePlanned[m.id + '|' + normFund(f.fund)]) < 0.005) pOk++;
    else { pBad++; console.log(`V3 PLANNED DRIFT ${m.id} ${f.fund}`); }
    if (f.rule?.type === 'yearlyDiv') { pBad++; console.log(`V3 LEFTOVER RULE ${m.id} ${f.fund}`); }
  }
  const aug = d.months.find((x) => x.id === '2026-08');
  const augFund = (n) => aug.categories.flatMap((c) => c.funds).find((f) => normFund(f.fund) === normFund(n));
  for (const c of aug.categories) for (const f of c.funds) {
    if (f.setup?.fixedRecurring) fixedCount++;
    if (f.setup?.multipleTx) multiCount++;
  }
  console.log(`\nV3: planned preserved ${pOk}/${pOk + pBad}; August fixed-recurring: ${fixedCount}, multi-tx: ${multiCount}`);
  console.log('  Car Insurance setup:', JSON.stringify(augFund('Car Insurance').setup), '→ auto', autoPlanned(augFund('Car Insurance')));
  console.log('  Essentials setup:', JSON.stringify(augFund('Essentials').setup));
  console.log('  Netflix setup:', JSON.stringify(augFund('Netflix').setup));

  // override + rollover: override Netflix planned, then next month resets to setup
  const nf = augFund('Netflix');
  nf.planned = 25;
  console.log('  Netflix overridden after manual planned=25:', isOverridden(nf));
  const sep = buildNextMonth(aug, 0.15);
  const sepNf = sep.categories.flatMap((c) => c.funds).find((f) => normFund(f.fund) === 'netflix');
  console.log(`  Sept Netflix planned resets to auto: ${sepNf.planned} (expect ${autoPlanned(nf)}), setup carried: ${!!sepNf.setup}`);

  // flags on July (complete month, judged as finished)
  const july = d.months.find((x) => x.id === '2026-07');
  const flags = fundFlags(july, computeMonth(july), '2026-08-09');
  const att = flags.filter((x) => x.attention).map((x) => `${x.fund}(${x.attention})`);
  const off = flags.filter((x) => x.offset).map((x) => `${x.fund} ${x.leftover}`);
  console.log('  July attention:', att.join(', ') || 'none');
  console.log('  July offset-available:', off.join(', ') || 'none');
}

// ---- v4: fund types, savings calculator, pace tags ----
{
  const d = JSON.parse(fs.readFileSync(new URL('../data/seed.json', import.meta.url), 'utf8'));
  migrateV2(d); migrateV3(d); migrateV4(d);
  const aug = d.months.find((x) => x.id === '2026-08');
  const augFund = (n) => aug.categories.flatMap((c) => c.funds).find((f) => normFund(f.fund) === normFund(n));
  console.log(`\nV4 types: Essentials=${augFund('Essentials').setup.type} Netflix=${augFund('Netflix').setup.type} Compassion=${augFund('Compassion').setup.type} (expect pacing/fixed/basic)`);

  // Savings: Christmas $1,680 by Dec 2026
  const xmas = augFund('Christmas');
  xmas.setup = { type: 'savings', everyMonths: 1, totalAmount: 0, targetAmount: 1680, targetMonth: '2026-12' };
  let m = aug;
  const path = [];
  for (let i = 0; i < 6; i++) {
    m = buildNextMonth(m, 0.15);
    d.months.push(m);
    const f = m.categories.flatMap((c) => c.funds).find((x) => normFund(x.fund) === 'christmas');
    path.push(`${m.id}: carry ${f.carryOver} + planned ${f.planned} (target ${f.setup.targetMonth})`);
  }
  console.log('Savings path:\n  ' + path.join('\n  '));
  // Expect: Sept carry 1120 → planned (1680-1120)/4 = 140; by Dec carry+planned = 1680;
  // Jan 2027 target rolls to 2027-12 and planned restarts at (1680-carry)/12.
  const dec = d.months.find((x) => x.id === '2026-12');
  const decF = dec.categories.flatMap((c) => c.funds).find((x) => normFund(x.fund) === 'christmas');
  const decTotal = r2(decF.carryOver + decF.planned);
  console.log(`Dec 2026 saved total: ${decTotal} (expect 1680) ${Math.abs(decTotal - 1680) < 0.02 ? 'OK' : 'MISMATCH'}`);
  const jan = d.months.find((x) => x.id === '2027-01');
  const janF = jan.categories.flatMap((c) => c.funds).find((x) => normFund(x.fund) === 'christmas');
  console.log(`Jan 2027 recalibrated: target=${janF.setup.targetMonth} (expect 2027-12), planned=${janF.planned}`);

  // Pace tags on a synthetic current month
  const mk = (spent) => {
    const mo = {
      id: '2026-08', label: 'August', checks: {}, income: [],
      categories: [{ name: 'T', excludeFromTotals: false, funds: [{ fund: 'Groceries', carryOver: 0, planned: 100, rule: null, setup: { type: 'pacing', everyMonths: 1, totalAmount: 0, targetAmount: 0, targetMonth: null } }] }],
      transactions: spent ? [{ id: 'x', date: '2026-08-05', vendor: 'v', amount: -spent, fund: 'Groceries' }] : [],
    };
    return fundFlags(mo, computeMonth(mo), '2026-08-12')[0];
  };
  console.log(`Pace @ day 12/31 (39% elapsed, grace→54%): spent 60 → ${mk(60)?.pace} (expect off), spent 30 → ${mk(30)?.pace} (expect on)`);
  // Pacing offset only at month end
  const g1 = mk(30);
  const moEnd = (() => {
    const mo = { id: '2026-08', label: 'August', checks: {}, income: [], categories: [{ name: 'T', excludeFromTotals: false, funds: [{ fund: 'Groceries', carryOver: 0, planned: 100, rule: null, setup: { type: 'pacing', everyMonths: 1, totalAmount: 0, targetAmount: 0, targetMonth: null } }] }], transactions: [{ id: 'x', date: '2026-08-05', vendor: 'v', amount: -30, fund: 'Groceries' }] };
    return fundFlags(mo, computeMonth(mo), '2026-08-31')[0];
  })();
  console.log(`Pacing offset mid-month: ${!!g1?.offset} (expect false) · on last day: ${!!moEnd?.offset} (expect true)`);
}

// ---- savings Build Over Time mode ----
{
  const mk = (carryOver, planned, txAmt, when) => {
    const mo = {
      id: '2026-08', label: 'August', checks: {}, income: [],
      categories: [{ name: 'S', excludeFromTotals: false, funds: [{
        fund: 'Emergency', carryOver, planned, rule: null,
        setup: { type: 'savings', savingsMode: 'build', monthlyAmount: 200, everyMonths: 1, totalAmount: 0, targetAmount: 0, targetMonth: null },
      }] }],
      transactions: txAmt ? [{ id: 'x', date: '2026-08-05', vendor: 'v', amount: txAmt, fund: 'Emergency' }] : [],
    };
    return { mo, flags: fundFlags(mo, computeMonth(mo), when || '2026-08-31') };
  };
  const a = mk(500, 200, -100);       // spent some, leftover 600 → NO offset even at month end
  const b = mk(100, 200, -500);       // overspent → exceeded
  const c = mk(500, 200, -100, '2026-08-15'); // mid-month, no pace flags either
  console.log(`\nBuild Over Time: offset at month end=${!!a.flags[0]?.offset} (expect false), overspend flag=${b.flags[0]?.attention} (expect exceeded), mid-month flags=${c.flags.length} (expect 0)`);
  const f = a.mo.categories[0].funds[0];
  console.log(`autoPlanned=${autoPlanned(f, '2026-08')} (expect 200), next month planned=${buildNextMonth(a.mo, 0.15).categories[0].funds[0].planned} (expect 200)`);
}

// ---- exclude-insights, build goal cap, transfer exclusion ----
{
  const base = () => ({
    id: '2026-08', label: 'August', checks: {},
    income: [{ fund: 'Pay', carryOver: 0, planned: 1000, rule: null, titheExempt: false, group: 'bonus' }],
    categories: [{ name: 'C', excludeFromTotals: false, funds: [
      { fund: 'Groc', carryOver: 0, planned: 100, rule: null, setup: { type: 'pacing', excludeInsights: true } },
      { fund: 'Pot', carryOver: 950, planned: 0, rule: null, setup: { type: 'savings', savingsMode: 'build', monthlyAmount: 200, buildGoal: 1000 } },
    ] }],
    transactions: [
      { id: '1', date: '2026-08-05', vendor: 'Store', amount: -95, fund: 'Groc' },
      { id: '2', date: '2026-08-06', vendor: 'Job', amount: 1000, fund: 'Pay' },
      { id: '3', date: '2026-08-07', vendor: 'Transfer to Pot', amount: -50, fund: 'Groc', isTransfer: true },
      { id: '4', date: '2026-08-07', vendor: 'Transfer from Groc', amount: 50, fund: 'Pot', isTransfer: true },
    ],
  });
  const mo = base();
  const comp = computeMonth(mo);
  // excluded fund: spent 95+50 of 100 at 39% elapsed AND over budget → would flag hard, but must be silent
  const flags = fundFlags(mo, comp, '2026-08-12');
  console.log(`\nExclude insights: flags for excluded over-budget fund = ${flags.filter((x) => x.fund === 'Groc').length} (expect 0)`);
  // build goal cap: carry 950, goal 1000, monthly 200 → auto = 50; at goal → 0
  const pot = mo.categories[0].funds[1];
  console.log(`Build goal cap: auto=${autoPlanned(pot, '2026-08')} (expect 50), at-goal auto=${autoPlanned({ carryOver: 1000, setup: pot.setup }, '2026-08')} (expect 0), below resumes=${autoPlanned({ carryOver: 700, setup: pot.setup }, '2026-08')} (expect 200)`);
  // transfer exclusion: income 1000 vs 1050 raw; expense -145 vs -95 ex-transfers... Groc expensed -145 (incl -50 xfer), Pot +50
  const s = comp.summary;
  console.log(`Transfers: raw income=${s.actualIncome} exT=${s.actualIncomeExT} (expect 1000/1000) · raw expense=${s.actualExpense} exT=${s.actualExpenseExT} (expect -95/-95) · diff exT=${s.actualDiffExT} (expect 905)`);
}

// ---- income carry-forward + tithe exemption on standard income ----
{
  const mo = {
    id: '2026-08', label: 'August',
    checks: { 'Pay': { count: 2, amount: 1000, titheAmount: 1200 } },
    income: [
      { fund: 'Pay', carryOver: 0, planned: 2000, rule: { type: 'checks' }, titheExempt: false, carryForward: false, group: 'standard' },
      { fund: 'Reimb', carryOver: 50, planned: 0, rule: null, titheExempt: true, carryForward: true, group: 'bonus' },
    ],
    categories: [{ name: 'C', excludeFromTotals: false, funds: [{ fund: 'X', carryOver: 0, planned: 100, rule: null, setup: { type: 'basic' } }] }],
    transactions: [{ id: '1', date: '2026-08-05', vendor: 'work', amount: 75, fund: 'Reimb' }],
  };
  console.log(`\nIncome: tithe base=${titheBase(mo)} (expect 2400 — Pay 2×1200, exempt Reimb skipped)`);
  const next = buildNextMonth(mo, 0.15);
  const pay = next.income.find((f) => f.fund === 'Pay');
  const reimb = next.income.find((f) => f.fund === 'Reimb');
  console.log(`Rollover: Pay carryOver=${pay.carryOver} (expect 0), Reimb carryOver=${reimb.carryOver} (expect 125 = 50+75-0), flags kept=${reimb.carryForward && reimb.titheExempt}`);
  // exempt standard fund contributes nothing
  mo.income[0].titheExempt = true;
  console.log(`Exempt standard: tithe base=${titheBase(mo)} (expect 0)`);
}

// ---- v5: insight re-tune (re-typing + pace thresholds) ----
{
  const d = JSON.parse(fs.readFileSync(new URL('../data/seed.json', import.meta.url), 'utf8'));
  migrateV2(d); migrateV3(d); migrateV4(d);
  const before = {};
  for (const id of ['2026-07', '2026-08']) {
    const m = d.months.find((x) => x.id === id);
    const fl = fundFlags(m, computeMonth(m), id === '2026-08' ? '2026-08-10' : '2026-07-15');
    before[id] = fl.filter((x) => x.attention).length;
  }
  const res = migrateV5(d);
  console.log(`\nV5 re-typed ${res.retyped.length} fund(s) Pacing → Basic:`);
  for (const r of res.retyped) console.log(`   ${r.fund.padEnd(24)} (${r.category}) — ${r.daysPerMonth} spending days per month`);
  const stillPacing = new Set();
  for (const c of d.months.find((x) => x.id === '2026-08').categories) {
    for (const f of c.funds) if (f.setup?.type === 'pacing') stillPacing.add(f.fund);
  }
  console.log(`   still Pacing: ${[...stillPacing].join(', ') || 'none'}`);
  for (const id of ['2026-07', '2026-08']) {
    const m = d.months.find((x) => x.id === id);
    const fl = fundFlags(m, computeMonth(m), id === '2026-08' ? '2026-08-10' : '2026-07-15');
    console.log(`   ${id} needs-attention: ${before[id]} → ${fl.filter((x) => x.attention).length}`);
  }
  // Pace thresholds on a synthetic groceries fund: budget 100, day 12/31 (38.7%)
  const paceCase = (spent, day) => {
    const mo = {
      id: '2026-08', label: 'August', checks: {}, income: [],
      categories: [{ name: 'T', excludeFromTotals: false, funds: [{ fund: 'Groceries', carryOver: 0, planned: 100, rule: null, setup: { type: 'pacing' } }] }],
      transactions: [{ id: 'x', date: `2026-08-0${Math.min(9, day)}`, vendor: 'v', amount: -spent, fund: 'Groceries' }],
    };
    return fundFlags(mo, computeMonth(mo), `2026-08-${String(day).padStart(2, '0')}`)[0]?.pace;
  };
  console.log(`   pace @day12 (39% in): spent 60 → ${paceCase(60, 12)} (expect off) · spent 40 → ${paceCase(40, 12)} (expect on) · spent 25 → ${paceCase(25, 12)} (expect on)`);
  console.log(`   early grace @day4: spent 60 → ${paceCase(60, 4)} (expect on — too early to judge)`);
}

// ---- v6: AUM (assets under management) ----
{
  // Migration: runs once, idempotent, and never clobbers an existing aum block.
  const d = { version: 5, months: [] };
  const first = migrateV6(d);
  const again = migrateV6(d);
  const shapeOk = ['assets', 'debts', 'snapshots', 'log'].every((k) => Array.isArray(d.aum[k]));
  console.log(`\nV6 migration: ran=${first} (expect true) · second run=${again} (expect false) · version=${d.version} (expect 6) · shape ok=${shapeOk}`);
  const d2 = { version: 5, aum: { assets: [{ id: 'a_1', name: 'House', value: 425000, updatedAt: '2026-01-01' }], debts: [], snapshots: [], log: [] } };
  migrateV6(d2);
  console.log(`V6 keeps an existing aum: ${d2.aum.assets.length === 1 && d2.aum.assets[0].name === 'House'} (expect true)`);
  // Full boot order on the real seed (v6 must come after v5's re-type pass).
  const dSeed = JSON.parse(fs.readFileSync(new URL('../data/seed.json', import.meta.url), 'utf8'));
  migrateV2(dSeed); migrateV3(dSeed); migrateV4(dSeed); migrateV5(dSeed); migrateV6(dSeed);
  console.log(`Seed migrates to v${dSeed.version} (expect 6), aum starts empty: ${dSeed.aum.assets.length === 0 && dSeed.aum.snapshots.length === 0}`);

  // Totals: empty, positive, negative — r2-rounded.
  const empty = aumTotals({ assets: [], debts: [] });
  console.log(`AUM totals empty: ${JSON.stringify(empty)} (expect all 0)`);
  const t = aumTotals({ assets: [{ value: 425000 }, { value: 12500.555 }], debts: [{ value: 310000 }] });
  console.log(`AUM totals: assets=${t.assets} (expect 437500.56) · debts=${t.debts} (expect 310000) · aum=${t.aum} (expect 127500.56)`);
  const neg = aumTotals({ assets: [{ value: 100 }], debts: [{ value: 250 }] });
  console.log(`AUM negative: ${neg.aum} (expect -150)`);

  // Snapshots: same-day replaces, new day appends, out-of-order insert keeps date sort.
  const aum = { assets: [{ value: 1000 }], debts: [{ value: 400 }], snapshots: [], log: [] };
  upsertSnapshot(aum, '2026-08-10');
  aum.assets[0].value = 1200;
  upsertSnapshot(aum, '2026-08-18');
  aum.assets[0].value = 1300;
  upsertSnapshot(aum, '2026-08-18'); // same day again — replace, not append
  aum.assets[0].value = 1100;
  upsertSnapshot(aum, '2026-08-14'); // backdated — must land in the middle
  const dates = aum.snapshots.map((s) => s.date).join(',');
  const day18 = aum.snapshots.filter((s) => s.date === '2026-08-18');
  console.log(`Snapshots: n=${aum.snapshots.length} (expect 3) · dates=${dates} (expect 2026-08-10,2026-08-14,2026-08-18)`);
  console.log(`Same-day replaced: one entry=${day18.length === 1}, aum=${day18[0].aum} (expect 900 — the later value won)`);

  // Last updated: max date wins; empty list → null.
  const lu = aumLastUpdated([{ updatedAt: '2026-05-01' }, { updatedAt: '2026-08-02' }, { name: 'no date yet' }]);
  console.log(`Last updated: ${lu} (expect 2026-08-02) · empty=${aumLastUpdated([])} (expect null)`);
}

// ---- checking-account CSV format ----
{
  const text = fs.readFileSync('C:/Users/redacted/Desktop/2026-08-08_redacted.csv', 'utf8');
  const recs = parseBankCsv(text);
  console.log(`\nChecking CSV: ${recs.length} records`);
  for (const r of recs) {
    console.log(` ${r.date} ${String(r.amount).padStart(9)} acct=${r.account} ${r.isCardPayment ? '[CARD PMT] ' : ''}${r.vendor}`);
  }
  const pmt = recs.filter((r) => r.isCardPayment).length;
  const debitsNeg = recs.filter((r) => r.amount < 0).length;
  console.log(`card payments flagged: ${pmt} (expect 2) · negative amounts: ${debitsNeg}/${recs.length} (expect all — file is all Debits)`);
  // memo-stripping: teach the map a memo'd vendor, then match a different memo
  const fakeMonths = [{ transactions: [{ vendor: 'I love you kiddo - Withdrawal to Sophias Account XXXXXXX9008', fund: 'Kids Savings' }] }];
  const vm = buildVendorMap(fakeMonths);
  const hit = suggestFund(vm, 'for summer camp - Withdrawal to Sophias Account XXXXXXX9008');
  console.log('memo-changed vendor still matches:', hit ? hit.fund : 'NO MATCH');
}

// ---- CSV import pipeline on the real bank file ----
{
  const text = fs.readFileSync('C:/Users/redacted/Desktop/2026-07-26_transaction_download.csv', 'utf8');
  const recs = parseBankCsv(text);
  console.log(`\nCSV parse: ${recs.length} records`);
  const vendorMap = buildVendorMap(seed.months);
  const claimed = new Set();
  let dup = 0, pay = 0, matched = 0, unmatched = [];
  for (const rec of recs) {
    const month = seed.months.find((m) => m.id === rec.date.slice(0, 7));
    if (rec.isCardPayment) { pay++; continue; }
    if (month && findDuplicate(seed.months, rec, claimed)) dup++;
    const sug = suggestFund(vendorMap, rec.vendor);
    if (sug) matched++; else unmatched.push(rec.vendor);
  }
  console.log(`card payments detected: ${pay}, duplicates vs existing data: ${dup}`);
  console.log(`auto-matched: ${matched}/${recs.length - pay}, unmatched: ${unmatched.join(', ') || 'none'}`);
  const sample = recs.slice(0, 3).map((r) => `${r.date} ${r.vendor} ${r.amount} [${suggestFund(vendorMap, r.vendor)?.fund || '?'}]`);
  console.log('sample:', sample.join(' | '));
}
