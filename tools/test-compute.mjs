// Verifies the app's computation engine against the spreadsheet's own cached values.
import { createRequire } from 'module';
import {
  computeMonth, buildNextMonth, normFund, migrateV2, migrateV3, migrateV4, migrateV5,
  applyTitheRules, titheBase, autoPlanned, isOverridden, fundFlags, r2,
  savingsMonthly, monthAdd, monthDiff,
  migrateV6, migrateV7, resyncCarryOvers, aumTotals, upsertSnapshot, aumLastUpdated,
  fundSplit,
  applyChecksRules, incomeTrueUp, setIncomeActual, incomePlanFor, fundDeposits,
} from '../src/compute.js';
import { parseBankCsv, buildVendorMap, suggestFund, findDuplicate } from '../src/csv.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

// Machine-specific inputs (this suite verifies against the real spreadsheet and
// bank exports, which never live in the repo). Override with env vars:
//   BUDGET_XLSX   — the source workbook (default: Desktop\2026 Budget.xlsx)
//   CHECKING_CSV  — a checking-account export (section skipped when unset)
//   CARD_CSV      — a card export (section skipped when unset)
const XLSX_PATH = process.env.BUDGET_XLSX || path.join(os.homedir(), 'Desktop', '2026 Budget.xlsx');

const seed = JSON.parse(fs.readFileSync(new URL('../data/seed.json', import.meta.url), 'utf8'));
const wb = XLSX.readFile(XLSX_PATH, { cellFormula: true });

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
  // The seed stores every planned value rounded to the cent, but the sheet's totals sum
  // sub-penny formula results (G48/6, G52/12, tithe ×15%, …) — so a summed total can sit
  // up to half a cent per fund away from the sheet. Scale those tolerances by fund count.
  const nExp = comp.categories.filter((c) => !c.excludeFromTotals).reduce((a, c) => a + c.funds.length, 0);
  const nInc = comp.income.length;
  check(`${name} plannedIncome`, comp.summary.plannedIncome, v('C3'), 0.011 + 0.005 * nInc);
  check(`${name} allocated`, comp.summary.allocated, v('D3'), 0.011 + 0.005 * nExp);
  check(`${name} leftToAllocate`, comp.summary.leftToAllocate, v('E3'), 0.011 + 0.005 * (nInc + nExp));
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
  const chk = aug.checks[Object.keys(aug.checks)[0]]; // first paycheck row (sheet F2), whatever its label
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

// ---- income carry at the boundary (1.3.0 I1) + tithe exemption on standard income ----
// Pre-1.3.0 this block asserted carryForward: Reimb (flag on, carry 50, +75 in)
// rolled 125 into September. Under I1 nothing is derived from the flag: with no
// close decision recorded on August (no lateAtClose, no trueUp stamp), every
// income fund opens September at 0, not pending, and the flag is not copied.
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
  console.log(`Rollover: Pay carryOver=${pay.carryOver} (expect 0), Reimb carryOver=${reimb.carryOver} (expect 0 — nothing decided at close; was 125 under carryForward), pending=${reimb.carryPending} (expect false), carryForward copied=${'carryForward' in reimb} (expect false), exempt kept=${reimb.titheExempt}`);
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

// ---- v7: derived carry-overs (resyncCarryOvers + migrateV7) ----
{
  // Hard assertions: failures here count into `bad` and fail the run.
  const t = (label, cond, detail = '') => {
    if (cond) ok++; else { bad++; console.log(`FAIL v7 ${label}${detail ? ` — ${detail}` : ''}`); }
  };
  const expFund = (fund, carryOver, planned = 100) => ({ fund, carryOver, planned, rule: null, setup: { type: 'basic' } });
  const mkMonth = (id, funds, income = [], transactions = []) => ({
    id, label: 'M', checks: {}, income, categories: [{ name: 'C', excludeFromTotals: false, funds }], transactions,
  });
  const tx = (date, amount, fund) => ({ id: 'x' + Math.random().toString(36).slice(2), date, vendor: 'v', amount, fund });
  const groc = (d) => d.months.map((m) => m.categories[0].funds.find((f) => normFund(f.fund) === 'groc'));

  // 1. Three months, chained: a new transaction in month 1 moves months 2 AND 3.
  //    m1: carry 0 + planned 100 − 40 = 60 → m2: 60 + 100 − 50 = 110 → m3 carry 110.
  const d1 = { version: 7, settings: {}, months: [
    mkMonth('2026-01', [expFund('Groc', 0)], [], [tx('2026-01-05', -40, 'Groc')]),
    mkMonth('2026-02', [expFund('Groc', 60)], [], [tx('2026-02-05', -50, 'Groc')]),
    mkMonth('2026-03', [expFund('Groc', 110)]),
  ] };
  t('starts consistent', resyncCarryOvers(d1).length === 0);
  d1.months[0].transactions.push(tx('2026-01-20', -10, 'Groc'));
  const ch1 = resyncCarryOvers(d1);
  t('chained change count', ch1.length === 2, `got ${ch1.length}`);
  const [g1, g2, g3] = groc(d1);
  t('month 2 follows', g2.carryOver === 50, `got ${g2.carryOver}`);
  t('month 3 follows', g3.carryOver === 100, `got ${g3.carryOver}`); // 50 + 100 − 50
  t('changes record from/to', ch1[0].month === '2026-02' && ch1[0].from === 60 && ch1[0].to === 50,
    JSON.stringify(ch1[0]));
  t('planned untouched', g1.planned === 100 && g2.planned === 100 && g3.planned === 100);

  // 2. Income funds (1.3.0 I1): the carryForward flag decides nothing any more.
  //    m1 Pay: carry 0 + received 120 − planned 100 → leftover 20, Left to
  //    allocate 100 (no expense funds). A stale carry on m2 with no decision
  //    recorded on m1 resyncs to 0; the flag, on or off, is ignored.
  const inc = (carryOver, carryForward) => ({ fund: 'Pay', carryOver, planned: 100, rule: null, titheExempt: false, carryForward, group: 'bonus' });
  const d2 = { version: 7, settings: {}, months: [
    mkMonth('2026-01', [], [inc(0, false)], [tx('2026-01-05', 120, 'Pay')]),
    mkMonth('2026-02', [], [inc(20, true)]),
  ] };
  const ch2 = resyncCarryOvers(d2);
  t('income carryForward ignored → 0', d2.months[1].income[0].carryOver === 0 && ch2.length === 1 && ch2[0].income === true && ch2[0].from === 20 && ch2[0].to === 0,
    JSON.stringify({ carry: d2.months[1].income[0].carryOver, ch2 }));
  d2.months[1].income[0].carryForward = false;
  t('income flag off → still 0, no change', resyncCarryOvers(d2).length === 0 && d2.months[1].income[0].carryOver === 0);

  // 3. A fund present only from month 2 (opening balance) is never touched.
  const d3 = { version: 7, settings: {}, months: [
    mkMonth('2026-01', [expFund('Groc', 0)], [], [tx('2026-01-05', -40, 'Groc')]),
    mkMonth('2026-02', [expFund('Groc', 60), expFund("Sam's Club", 6.22, 0)]),
  ] };
  const ch3 = resyncCarryOvers(d3);
  t('opening balance untouched', ch3.length === 0 && d3.months[1].categories[0].funds[1].carryOver === 6.22,
    JSON.stringify(ch3));

  // 4. Idempotence: the second pass finds nothing.
  t('idempotent', resyncCarryOvers(d1).length === 0 && resyncCarryOvers(d2).length === 0);

  // 5. The live-case shape: Essentials snapshot −306.31 vs recomputed −443.58
  //    (prev: carry −243.58 + planned 100 − spent 300 = −443.58).
  const d5 = { version: 7, settings: {}, months: [
    mkMonth('2026-08', [expFund('Essentials', -243.58)], [], [tx('2026-08-31', -300, 'Essentials')]),
    mkMonth('2026-09', [expFund('Essentials', -306.31)]),
  ] };
  const ch5 = resyncCarryOvers(d5);
  t('live-case fix', ch5.length === 1 && ch5[0].from === -306.31 && ch5[0].to === -443.58,
    JSON.stringify(ch5));

  // 7. migrateV7 bumps the version and records lastCarryFix (§2.6 test 6 was
  //    dropped with D2 — no bankDate, rows always post to their real month).
  const d7 = { version: 6, settings: {}, months: [
    mkMonth('2026-08', [expFund('Essentials', -243.58)], [], [tx('2026-08-31', -300, 'Essentials')]),
    mkMonth('2026-09', [expFund('Essentials', -306.31)]),
  ] };
  const ran = migrateV7(d7, '2026-09-09');
  t('migrateV7 runs on v6', ran === true && d7.version === 7);
  t('lastCarryFix recorded', d7.settings.lastCarryFix?.at === '2026-09-09' && d7.settings.lastCarryFix?.changes.length === 1,
    JSON.stringify(d7.settings.lastCarryFix));
  t('migrateV7 skips on v7', migrateV7(d7, '2026-09-10') === false && d7.settings.lastCarryFix.at === '2026-09-09');
  const clean = { version: 6, settings: {}, months: [] };
  migrateV7(clean, '2026-09-09');
  t('clean data records no fix', clean.version === 7 && !clean.settings.lastCarryFix);

  // ---- S7 (3-year sim): a never-typed auto-planned value follows a late resync.
  //    Rule: when a fund's carry changes and planned equalled autoPlanned() on the
  //    OLD carry, planned becomes autoPlanned() on the new carry. Nothing else moves.
  const babyA = () => ({ fund: 'Baby', carryOver: 2310, planned: 190, rule: null,
    setup: { type: 'savings', savingsMode: 'target', targetAmount: 2500, targetMonth: '2026-03' } });
  const fundIn = (m, name) => m.categories[0].funds.find((f) => normFund(f.fund) === normFund(name));
  // R9 shape: March holds Baby, spends 250 → leftover 2,250; April is built from it
  // (target re-aimed at 2027-03, 12 months) → planned derived 20.83; a late March
  // row drops the carry to 2,000 → auto 41.67 and planned follows.
  const s7Fixture = () => {
    const A = mkMonth('2026-03', [babyA()], [], [tx('2026-03-10', -250, 'Baby')]);
    const B = buildNextMonth(A, 0);
    return { version: 7, settings: {}, months: [A, B] };
  };

  // S7-1. R9 shape.
  {
    const d = s7Fixture();
    const B = d.months[1], b = fundIn(B, 'Baby');
    const derived = b.planned;
    t('S7 built planned is derived', b.carryOver === 2250 && derived === 20.83 && !isOverridden(b, B.id),
      JSON.stringify({ carry: b.carryOver, planned: derived }));
    d.months[0].transactions.push(tx('2026-03-14', -250, 'Baby'));
    const ch = resyncCarryOvers(d);
    t('S7 R9 one change', ch.length === 1 && ch[0].month === '2026-04' && ch[0].from === 2250 && ch[0].to === 2000, JSON.stringify(ch));
    t('S7 R9 planned follows', ch[0].plannedFrom === derived && ch[0].plannedTo === autoPlanned(b, B.id) && b.planned === 41.67,
      JSON.stringify({ ch: ch[0], planned: b.planned }));
    t('S7 R9 not overridden after', isOverridden(b, B.id) === false);
    t('S7 R9 idempotent', resyncCarryOvers(d).length === 0);
  }

  // S7-2. A typed planned stays (Invariant 13).
  {
    const d = s7Fixture();
    const B = d.months[1], b = fundIn(B, 'Baby');
    b.planned = 300;
    d.months[0].transactions.push(tx('2026-03-14', -250, 'Baby'));
    const ch = resyncCarryOvers(d);
    t('S7 typed planned stays', ch.length === 1 && b.carryOver === 2000 && b.planned === 300 && !('plannedTo' in ch[0]) && !('plannedFrom' in ch[0]),
      JSON.stringify({ ch, planned: b.planned }));
  }

  // S7-3. A fixed fund's auto does not depend on the carry: planned stays, no plannedTo.
  {
    const fixed = { fund: 'Ins', carryOver: 0, planned: 100, rule: null, setup: { type: 'fixed', everyMonths: 12, totalAmount: 1200 } };
    const A = mkMonth('2026-03', [fixed], [], [tx('2026-03-10', -30, 'Ins')]);
    const B = buildNextMonth(A, 0);
    const d = { version: 7, settings: {}, months: [A, B] };
    const b = fundIn(B, 'Ins');
    t('S7 fixed built', b.carryOver === 70 && b.planned === 100);
    A.transactions.push(tx('2026-03-20', -20, 'Ins'));
    const ch = resyncCarryOvers(d);
    t('S7 fixed fund unmoved', ch.length === 1 && b.carryOver === 50 && b.planned === 100 && !('plannedTo' in ch[0]), JSON.stringify(ch));
  }

  // S7-4. Capped build fund: carry 280 at build → planned 20; a late −30 → carry 250 → planned 50.
  {
    const build = { fund: 'Eye', carryOver: 230, planned: 50, rule: null, setup: { type: 'savings', savingsMode: 'build', monthlyAmount: 50, buildGoal: 300 } };
    const A = mkMonth('2026-03', [build]);
    const B = buildNextMonth(A, 0);
    const d = { version: 7, settings: {}, months: [A, B] };
    const b = fundIn(B, 'Eye');
    t('S7 capped build built', b.carryOver === 280 && b.planned === 20, JSON.stringify({ carry: b.carryOver, planned: b.planned }));
    A.transactions.push(tx('2026-03-20', -30, 'Eye'));
    const ch = resyncCarryOvers(d);
    t('S7 capped build follows', ch.length === 1 && b.carryOver === 250 && b.planned === 50 && ch[0].plannedFrom === 20 && ch[0].plannedTo === 50,
      JSON.stringify(ch));
  }

  // S7-5. No setup: carry changes, planned untouched, no plannedTo.
  {
    const A = mkMonth('2026-03', [expFund('Groc', 0, 100)], [], [tx('2026-03-05', -40, 'Groc')]);
    const B = buildNextMonth(A, 0);
    const d = { version: 7, settings: {}, months: [A, B] };
    const b = fundIn(B, 'Groc');
    A.transactions.push(tx('2026-03-20', -10, 'Groc'));
    const ch = resyncCarryOvers(d);
    t('S7 no setup untouched', ch.length === 1 && b.carryOver === 50 && b.planned === 100 && !('plannedTo' in ch[0]), JSON.stringify(ch));
  }

  // S7-6. Cascade A→B→C: the re-derived planned in B feeds C's carry in the same pass.
  {
    const A = mkMonth('2026-03', [babyA()], [], [tx('2026-03-10', -250, 'Baby')]);
    const B = buildNextMonth(A, 0);
    const C = buildNextMonth(B, 0);
    const d = { version: 7, settings: {}, months: [A, B, C] };
    const b = fundIn(B, 'Baby'), c = fundIn(C, 'Baby');
    t('S7 cascade starts consistent', resyncCarryOvers(d).length === 0 && c.carryOver === 2270.83 && c.planned === 20.83,
      JSON.stringify({ carry: c.carryOver, planned: c.planned }));
    A.transactions.push(tx('2026-03-14', -250, 'Baby'));
    const ch = resyncCarryOvers(d);
    t('S7 cascade two changes', ch.length === 2 && ch.every((x) => x.plannedTo != null), JSON.stringify(ch));
    t('S7 cascade B', b.carryOver === 2000 && b.planned === 41.67, JSON.stringify({ carry: b.carryOver, planned: b.planned }));
    // C's carry is B's NEW leftover: 2000 + 41.67 − 0 = 2041.67; its planned re-derives to (2500 − 2041.67) / 11.
    t('S7 cascade C follows B\'s new leftover', c.carryOver === 2041.67 && c.planned === 41.67 && !isOverridden(c, C.id),
      JSON.stringify({ carry: c.carryOver, planned: c.planned }));
    t('S7 cascade idempotent', resyncCarryOvers(d).length === 0);
  }
  console.log(`\nV7 derived carry-overs: assertions folded into the pass/fail totals above (now ${ok} ok / ${bad} bad)`);
}

// ---- 1.2.1 sitting A: carried-in split (W1), pace on own money, S12 rule (a) (W2), pause this month (W6) ----
{
  const t = (label, cond, detail = '') => {
    if (cond) ok++; else { bad++; console.log(`FAIL 1.2.1 ${label}${detail ? ` — ${detail}` : ''}`); }
  };
  const mkMonth = (id, funds, transactions = []) => ({
    id, label: 'M', checks: {}, income: [], categories: [{ name: 'C', excludeFromTotals: false, funds }], transactions,
  });
  const basic = (fund, carryOver, planned, more = {}) => ({ fund, carryOver, planned, rule: null, setup: { type: 'basic' }, ...more });
  const pacing = (fund, carryOver, planned) => ({ fund, carryOver, planned, rule: null, setup: { type: 'pacing', everyMonths: 1, totalAmount: 0, targetAmount: 0, targetMonth: null } });
  const tx = (date, amount, fund) => ({ id: 'x' + Math.random().toString(36).slice(2), date, vendor: 'v', amount, fund });

  // W1: the six worked rows of the work order's table — fundSplit's four fields
  // and the attention fundFlags gives at month end (todayISO = the last day).
  // [carryOver, planned, spent, own, overThisMonth, carriedIn, carriedOnly, attention]
  const rows = [
    [0,    400, 450, -50,  -50,  0,    false, 'exceeded'],   // fresh — unchanged from today
    [100,  400, 550, -150, -50,  0,    false, 'exceeded'],   // the +100 carry was real money
    [-829, 400, 400, 0,    0,    -829, true,  null],         // carrying — on plan this month (A-11)
    [-829, 400, 360, 40,   0,    -829, true,  null],         // carrying — $40 under plan
    [-829, 400, 520, -120, -120, -829, false, 'exceeded'],   // over $120 this month · carrying
    [-100, 150, 30,  120,  0,    -100, false, null],         // paid back — a plain row with $20 left
  ];
  for (const [co, pl, sp, own, over, cin, conly, att] of rows) {
    const m = mkMonth('2026-08', [basic('F', co, pl)], [tx('2026-08-10', -sp, 'F')]);
    const comp = computeMonth(m);
    const f = comp.categories[0].funds[0];
    const s = fundSplit(f);
    const label = `split ${co}/${pl}/−${sp}`;
    t(`${label} own`, s.own === own, String(s.own));
    t(`${label} overThisMonth`, s.overThisMonth === over, String(s.overThisMonth));
    t(`${label} carriedIn`, s.carriedIn === cin, String(s.carriedIn));
    t(`${label} carriedOnly`, s.carriedOnly === conly, String(s.carriedOnly));
    const fl = fundFlags(m, comp, '2026-08-31')[0];
    t(`${label} attention at month end`, fl && fl.attention === att, JSON.stringify(fl));
    if (fl) t(`${label} entry carries the split`, fl.own === own && fl.carriedIn === cin && fl.overThisMonth === over && fl.carriedOnly === conly, JSON.stringify(fl));
  }
  // The gate: the carried-only row has an entry with attention null (and
  // nothing else to say); the paid-back row has no entry at all mid-month.
  {
    const co = mkMonth('2026-08', [basic('F', -829, 400)], [tx('2026-08-10', -400, 'F')]);
    const e = fundFlags(co, computeMonth(co), '2026-08-15');
    t('gate: carried-only fund gets an entry mid-month', e.length === 1 && e[0].attention === null && !e[0].offset && e[0].pace === null && e[0].carriedOnly === true, JSON.stringify(e));
    const pb = mkMonth('2026-08', [basic('F', -100, 150)], [tx('2026-08-10', -30, 'F')]);
    t('gate: deficit paid back → no entry mid-month', fundFlags(pb, computeMonth(pb), '2026-08-15').length === 0);
    const pbEnd = fundFlags(pb, computeMonth(pb), '2026-08-31')[0];
    t('gate: paid back at month end → plain "free" row, nothing carried', pbEnd && pbEnd.offset === true && pbEnd.attention === null && pbEnd.carriedOnly === false, JSON.stringify(pbEnd));
  }
  // Pace judges this month's own money (budget = max(carryOver, 0) + planned).
  {
    const p1 = mkMonth('2026-08', [pacing('G', -200, 400)], [tx('2026-08-10', -200, 'G')]);
    const f1 = fundFlags(p1, computeMonth(p1), '2026-08-15')[0];
    t('pace: −200 carry, 200 of 400 spent by the 15th → on (was off)', f1 && f1.pace === 'on' && f1.attention === null, JSON.stringify(f1));
    t('pace: budget carried out is this month\'s own money', f1 && f1.budget === 400, f1 && String(f1.budget));
    const p2 = mkMonth('2026-08', [pacing('G', 200, 400)], [tx('2026-08-10', -400, 'G')]);
    const f2 = fundFlags(p2, computeMonth(p2), '2026-08-15')[0];
    t('pace: +200 carry, 400 of 600 spent by the 15th → off', f2 && f2.pace === 'off' && f2.attention === 'pace' && f2.budget === 600, JSON.stringify(f2));
  }
  // The money didn't move: computeMonth is the same before and after fundFlags,
  // and fundFlags never writes into the computed month it reads.
  {
    const m = mkMonth('2026-08', [basic('F', -829, 400), pacing('G', 50, 300)], [tx('2026-08-10', -520, 'F'), tx('2026-08-12', -100, 'G')]);
    const before = JSON.stringify(computeMonth(m));
    const comp = computeMonth(m);
    fundFlags(m, comp, '2026-08-15'); fundFlags(m, comp, '2026-08-31');
    t('computeMonth serialises identically before and after fundFlags', JSON.stringify(computeMonth(m)) === before);
    t('fundFlags does not touch the computed month it reads', JSON.stringify(comp) === before);
  }
  // W2 — S12 rule (a): Basic is free only once the month is done; Fixed keeps
  // the one-charge rule; a goal in its target month only once the month is over.
  {
    const b = mkMonth('2026-08', [basic('Sub', 0, 85)], [tx('2026-08-03', -15.49, 'Sub')]);
    t('S12(a): basic, one charge on the 3rd → not free mid-month', fundFlags(b, computeMonth(b), '2026-08-15').length === 0);
    const bEnd = fundFlags(b, computeMonth(b), '2026-08-31')[0];
    t('S12(a): basic at month end → free, no $1 floor', bEnd && bEnd.offset === true && bEnd.leftover === 69.51, JSON.stringify(bEnd));
    const fx = mkMonth('2026-08', [{ fund: 'Net', carryOver: 0, planned: 80, rule: null, setup: { type: 'fixed', everyMonths: 1, totalAmount: 80 } }], [tx('2026-08-03', -70, 'Net')]);
    t('S12(a): fixed, one charge mid-month → free (unchanged)', fundFlags(fx, computeMonth(fx), '2026-08-15')[0]?.offset === true);
    const goal = { fund: 'Trip', carryOver: 1100, planned: 100, rule: null, setup: { type: 'savings', savingsMode: 'target', targetAmount: 1200, targetMonth: '2026-08', everyMonths: 1, totalAmount: 0 } };
    const gm = mkMonth('2026-08', [goal], [tx('2026-08-03', -500, 'Trip')]);
    t('S12(a): goal in its target month, one charge mid-month → not free', !(fundFlags(gm, computeMonth(gm), '2026-08-15')[0]?.offset));
    t('S12(a): goal in its target month at month end → free', fundFlags(gm, computeMonth(gm), '2026-08-31')[0]?.offset === true);
    const pennies = mkMonth('2026-08', [basic('Tiny', 0, 10)], [tx('2026-08-03', -9.96, 'Tiny')]);
    t('S12(a): four cents free at month end stays, honestly labelled', fundFlags(pennies, computeMonth(pennies), '2026-08-31')[0]?.leftover === 0.04);
  }
  // W6 — pause this month: fund.pausedPlanned comes back in buildNextMonth and
  // is never copied forward; this month's leftover is just carryOver + 0 + expensed.
  {
    const pm = mkMonth('2026-08', [basic('Groc', 0, 0, { pausedPlanned: 300 })], [tx('2026-08-10', -120, 'Groc')]);
    const pc = computeMonth(pm).categories[0].funds[0];
    t('pause: leftover = carryOver + 0 + expensed (Inv 2, nothing special)', pc.leftover === -120, String(pc.leftover));
    const nf = buildNextMonth(pm, 0.1).categories[0].funds[0];
    t('pause: next month gets the paused plan back', nf.planned === 300, String(nf.planned));
    t('pause: pausedPlanned is not copied into the next month', nf.pausedPlanned === undefined);
    t('pause: carry-over derives from the paused month\'s leftover', nf.carryOver === -120, String(nf.carryOver));
    const pf = mkMonth('2026-08', [{ fund: 'Claude', carryOver: 0, planned: 0, pausedPlanned: 20, rule: null, setup: { type: 'fixed', everyMonths: 1, totalAmount: 20 } }]);
    t('pause: a fixed $20/mo fund comes back at its auto amount', buildNextMonth(pf, 0.1).categories[0].funds[0].planned === 20);
    t('no pause: planned repeats as always', buildNextMonth(mkMonth('2026-08', [basic('X', 0, 55)]), 0.1).categories[0].funds[0].planned === 55);
  }
  console.log(`1.2.1 sitting A: assertions folded into the pass/fail totals above (now ${ok} ok / ${bad} bad)`);
}

// ---- checking-account CSV format ----
// ---- 1.3.0 I1: income true-up at close ----
// The work order's September/October table, row by row, plus the carry rules.
//   leftToAllocate = Σ income (planned + (carryPending ? 0 : carryOver)) − Σ expense planned
//   income carry next month = incomePlanFor(prev): pending (late, still short),
//   counted surplus (prev's Left to allocate at close, trueUp stamped, first
//   Standard fund not late), or 0.
{
  const t = (label, cond, detail = '') => {
    if (cond) ok++; else { bad++; console.log(`FAIL I1 ${label}${detail ? ` — ${detail}` : ''}`); }
  };
  const mk = (id, inc, exp, txs = [], checks = { Pay: { count: 2, amount: 2000, titheAmount: 2000 } }) =>
    ({ id, label: 'x', checks, income: inc, categories: [{ name: 'C', excludeFromTotals: false, funds: exp }], transactions: txs });
  const pay = (o = {}) => ({ fund: 'Pay', carryOver: 0, planned: 4000, rule: { type: 'checks' }, titheExempt: false, group: 'standard', ...o });
  const bonus = (o = {}) => ({ fund: 'Gifts', carryOver: 0, planned: 0, rule: null, titheExempt: false, group: 'bonus', ...o });
  const env = (p, o = {}) => ({ fund: 'Rent', carryOver: 0, planned: p, rule: null, setup: { type: 'basic' }, ...o });
  const dep = (date, amt, fund = 'Pay') => ({ id: date + fund + amt, date, vendor: 'EMPLOYER', amount: amt, fund });
  const LTA = (m) => computeMonth(m).summary.leftToAllocate;
  const CC = (m) => computeMonth(m).summary.countedCarry;
  const rows = (m) => incomeTrueUp(m, computeMonth(m));
  const incOf = (m, name = 'Pay') => m.income.find((f) => f.fund === name);
  const clone = (x) => JSON.parse(JSON.stringify(x));

  // Row 1 — Sept as it stands: planned 4,000, received 2,000, allocated 4,000.
  const sept = mk('2026-09', [pay()], [env(4000)], [dep('2026-09-15', 2000)]);
  t('sept LTA 0 before any decision', LTA(sept) === 0 && CC(sept) === 0);
  let r = rows(sept);
  t('sept one row', r.length === 1 && r[0].fund === 'Pay' && r[0].group === 'standard');
  t('sept row diff −2000, unresolved', r[0].diff === -2000 && r[0].resolved === false && r[0].planned === 4000 && r[0].received === 2000);
  t('sept row options fix + late', r[0].options.join() === 'fix,late' && r[0].carryPending === false && r[0].lateAtClose === false);
  t('within $1 → no row', rows(mk('2026-09', [pay()], [env(4000)], [dep('2026-09-15', 3999.5)])).length === 0);

  // Row 2 — fix the plan: planned := 2,000; Left to allocate −2,000 (D6 blocks).
  const sFix = clone(sept);
  const res = setIncomeActual(sFix, 'Pay', { mode: 'fix' });
  t('fix returns from/planned', res && res.from === 4000 && res.planned === 2000, JSON.stringify(res));
  t('fix: planned = received, truedUp', incOf(sFix).planned === 2000 && incOf(sFix).truedUp === true);
  t('fix: no pending flag written', incOf(sFix).carryPending === undefined);
  t('fix: LTA −2000', LTA(sFix) === -2000);
  t('fix: row gone', rows(sFix).length === 0);
  t('fix: estimate untouched (not variable)', sFix.checks.Pay.amount === 2000 && sFix.checks.Pay.count === 2);
  applyChecksRules(sFix);
  t('applyChecksRules leaves truedUp alone', incOf(sFix).planned === 2000);
  const sFixUntrued = clone(sFix); delete sFixUntrued.income[0].truedUp; applyChecksRules(sFixUntrued);
  t('applyChecksRules still rules an un-trued fund', incOf(sFixUntrued).planned === 4000);
  const nFix = buildNextMonth(sFix, 0.15);
  t('next month built from checks regardless of truedUp', incOf(nFix).planned === 4000 && incOf(nFix).truedUp === undefined && incOf(nFix).carryOver === 0 && incOf(nFix).carryPending === false);
  t('unknown fund → null', setIncomeActual(clone(sept), 'Nope', { mode: 'fix' }) === null);
  // fix on a non-rule fund: planned = received, no truedUp
  const sBonus = mk('2026-09', [pay(), bonus({ planned: 500 })], [env(4000)], [dep('2026-09-15', 4000), dep('2026-09-20', 120, 'Gifts')]);
  t('bonus under → row fix,late', rows(sBonus).length === 1 && rows(sBonus)[0].fund === 'Gifts' && rows(sBonus)[0].diff === -380 && rows(sBonus)[0].options.join() === 'fix,late');
  setIncomeActual(sBonus, 'Gifts', { mode: 'fix' });
  t('fix on a non-rule fund: planned = received, not truedUp', incOf(sBonus, 'Gifts').planned === 120 && incOf(sBonus, 'Gifts').truedUp === undefined && LTA(sBonus) === 120);
  // variable estimate: deposits === count → avg; 3 deposits vs count 2 → unchanged
  const sVar = mk('2026-09', [pay()], [env(4000)], [dep('2026-09-05', 1900), dep('2026-09-19', 1800)], { Pay: { count: 2, amount: 2000, titheAmount: 2000, variable: true } });
  setIncomeActual(sVar, 'Pay', { mode: 'fix' });
  t('variable, deposits = count → estimate = avg', sVar.checks.Pay.amount === 1850 && incOf(sVar).planned === 3700);
  const sVar3 = mk('2026-09', [pay()], [env(4000)], [dep('2026-09-05', 1900), dep('2026-09-12', 1800), dep('2026-09-19', 1700)], { Pay: { count: 2, amount: 2000, titheAmount: 2000, variable: true } });
  setIncomeActual(sVar3, 'Pay', { mode: 'fix' });
  t('variable, 3 deposits vs count 2 → estimate unchanged', sVar3.checks.Pay.amount === 2000 && incOf(sVar3).planned === 5400);
  t('fundDeposits counts positive non-transfer rows only', fundDeposits(sVar3, 'Pay').count === 3 && fundDeposits(sVar3, 'Pay').total === 5400
    && fundDeposits(mk('2026-09', [pay()], [], [dep('2026-09-05', 100), { id: 'x', date: '2026-09-06', vendor: 'Transfer from Rent', amount: 50, fund: 'Pay' }, dep('2026-09-07', -20)]), 'Pay').count === 1);

  // Row 3 — it's late: lateAtClose recorded, LTA stays 0, Start enabled.
  const sLate = clone(sept); incOf(sLate).lateAtClose = true; sLate.trueUp = { at: '2026-09-30' };
  r = rows(sLate);
  t('late: row stays, resolved; fix still offered, late not', r.length === 1 && r[0].resolved === true && r[0].lateAtClose === true && r[0].options.join() === 'fix');
  t('late: LTA 0', LTA(sLate) === 0);
  const octL = buildNextMonth(sLate, 0.15);
  t('late → Oct carry −2000 pending', incOf(octL).carryOver === -2000 && incOf(octL).carryPending === true);
  t('late → Oct lateAtClose/truedUp/carryForward not copied', incOf(octL).lateAtClose === undefined && incOf(octL).truedUp === undefined && !('carryForward' in incOf(octL)));
  t('Oct LTA excludes the pending carry', LTA(octL) === 0 && CC(octL) === 0);

  // Row 4 — Oct after "late", $6,000 lands: leftover 0, no row.
  const oct6 = clone(octL); oct6.transactions.push(dep('2026-10-02', 2000), dep('2026-10-15', 2000), dep('2026-10-29', 2000));
  const c6 = computeMonth(oct6).income[0];
  t('Oct $6,000: leftover 0 (the extra is September\'s)', c6.leftover === 0 && c6.received === 6000);
  t('Oct $6,000: no row', rows(oct6).length === 0 && LTA(oct6) === 0);
  // $6,500: over by 500 → actual only; planned := received + carry (it landed)
  const oct65 = clone(octL); oct65.transactions.push(dep('2026-10-02', 2500), dep('2026-10-15', 2000), dep('2026-10-29', 2000));
  r = rows(oct65);
  t('Oct $6,500: diff = leftover +500, actual only', r.length === 1 && r[0].diff === 500 && r[0].options.join() === 'actual' && r[0].carryPending === true);
  setIncomeActual(oct65, 'Pay', { mode: 'actual' });
  t('actual with pending: planned = received + carry, stays pending', incOf(oct65).planned === 4500 && incOf(oct65).carryPending === true && LTA(oct65) === 500);

  // Row 5 — Oct after "late", only $4,000: fix only; fix flips the carry to counted.
  const oct4 = clone(octL); oct4.transactions.push(dep('2026-10-15', 2000), dep('2026-10-29', 2000));
  r = rows(oct4);
  t('grace: diff = leftover −2000, fix only', r.length === 1 && r[0].diff === -2000 && r[0].options.join() === 'fix' && r[0].resolved === false);
  t('grace: LTA 0 until fixed', LTA(oct4) === 0);
  setIncomeActual(oct4, 'Pay', { mode: 'fix' });
  t('grace fix: carryPending === false (explicit), planned = received', incOf(oct4).carryPending === false && incOf(oct4).planned === 4000 && incOf(oct4).carryOver === -2000);
  t('grace fix: LTA −2000, countedCarry −2000', LTA(oct4) === -2000 && CC(oct4) === -2000);
  t('grace fix: row gone', rows(oct4).length === 0);
  const pair = { version: 7, settings: {}, months: [clone(sLate), oct4] };
  t('resync keeps the resolved carry counted', resyncCarryOvers(pair).length === 0 && incOf(pair.months[1]).carryPending === false && incOf(pair.months[1]).carryOver === -2000);

  // Row 6 — earned more, use actual: planned 6,000; LTA +2,000.
  const sMore = mk('2026-09', [pay()], [env(4000)], [dep('2026-09-05', 3000), dep('2026-09-19', 3000)]);
  r = rows(sMore);
  t('over: row actual only', r.length === 1 && r[0].diff === 2000 && r[0].options.join() === 'actual');
  setIncomeActual(sMore, 'Pay', { mode: 'actual' });
  t('actual: planned = received, truedUp, LTA +2000', incOf(sMore).planned === 6000 && incOf(sMore).truedUp === true && LTA(sMore) === 2000 && rows(sMore).length === 0);

  // Row 7 — an unassigned +2,000 carries counted (stamp required), until assigned.
  const noStamp = buildNextMonth(sMore, 0.15);
  t('no stamp → no carry', incOf(noStamp).carryOver === 0 && incOf(noStamp).carryPending === false && LTA(noStamp) === 0);
  sMore.trueUp = { at: '2026-09-30' };
  const plan = incomePlanFor(sMore);
  t('incomePlanFor: host Pay gets 2000 counted', plan.get('pay').carryOver === 2000 && plan.get('pay').carryPending === false);
  const octS = buildNextMonth(sMore, 0.15);
  t('stamped → Oct carry +2000 counted', incOf(octS).carryOver === 2000 && incOf(octS).carryPending === false);
  t('Oct LTA +2000, countedCarry 2000', LTA(octS) === 2000 && CC(octS) === 2000);
  octS.transactions.push(dep('2026-10-05', 2000), dep('2026-10-19', 2000));
  const cS = computeMonth(octS).income[0];
  t('Oct leftover +2000 but own = 0 → no row', cS.leftover === 2000 && rows(octS).length === 0);
  octS.categories[0].funds[0].planned = 6000; // allocate the surplus
  t('allocated → LTA 0', LTA(octS) === 0);
  octS.trueUp = { at: '2026-10-31' };
  const nov = buildNextMonth(octS, 0.15);
  t('an assigned surplus never rolls twice', incOf(nov).carryOver === 0 && incOf(nov).carryPending === false);
  // resync agrees with buildNextMonth (idempotence) on both pairs
  t('resync idempotent on [sept, oct] surplus pair', resyncCarryOvers({ version: 7, settings: {}, months: [clone(sMore), buildNextMonth(sMore, 0.15)] }).length === 0);
  t('resync idempotent on [sept, oct] late pair', resyncCarryOvers({ version: 7, settings: {}, months: [clone(sLate), buildNextMonth(sLate, 0.15)] }).length === 0);
  // resync derives a missing counted carry when the stamp is there
  const stale = { version: 7, settings: {}, months: [clone(sMore), clone(buildNextMonth(sMore, 0.15))] };
  stale.months[1].income[0].carryOver = 0;
  const chS = resyncCarryOvers(stale);
  t('resync restores a counted surplus from the stamp', chS.length === 1 && chS[0].income === true && chS[0].to === 2000 && incOf(stale.months[1]).carryOver === 2000 && incOf(stale.months[1]).carryPending === undefined);

  // A late import into Sept clears Oct's pending carry.
  const late2 = { version: 7, settings: {}, months: [clone(sLate), clone(octL)] };
  late2.months[0].transactions.push(dep('2026-09-30', 2000));
  const chL = resyncCarryOvers(late2);
  t('late import into prev → pending carry resynced to 0', chL.length === 1 && chL[0].from === -2000 && chL[0].to === 0 && incOf(late2.months[1]).carryOver === 0 && incOf(late2.months[1]).carryPending === undefined);
  t('…and Sept\'s late row now reads landed', rows(late2.months[0]).length === 1 && rows(late2.months[0])[0].resolved === true && rows(late2.months[0])[0].diff === 0);

  // Host choice: standard first; a late standard → first non-late fund.
  const two = mk('2026-09', [bonus({ planned: 1000 }), pay()], [env(4500)], [dep('2026-09-15', 4000), dep('2026-09-20', 1000, 'Gifts')]);
  two.trueUp = { at: '2026-09-30' };
  t('host: standard beats a bonus listed first', incomePlanFor(two).get('pay').carryOver === 500 && incomePlanFor(two).get('gifts').carryOver === 0);
  const twoLate = clone(two); twoLate.transactions = [dep('2026-09-15', 2000), dep('2026-09-20', 1000, 'Gifts')]; incOf(twoLate).lateAtClose = true;
  const pl = incomePlanFor(twoLate);
  t('host: late standard → pending; surplus on the first non-late fund', pl.get('pay').carryPending === true && pl.get('pay').carryOver === -2000 && pl.get('gifts').carryOver === 500 && pl.get('gifts').carryPending === false);
  const nTwo = buildNextMonth(twoLate, 0.15);
  t('buildNextMonth matches incomePlanFor', incOf(nTwo).carryOver === -2000 && incOf(nTwo).carryPending === true && incOf(nTwo, 'Gifts').carryOver === 500 && LTA(nTwo) === 500 - 4500 + 4000);

  // No stamp, no carry (two-month fixture, +500 at the first close).
  const a = mk('2026-09', [pay()], [env(3500)], [dep('2026-09-05', 2000), dep('2026-09-19', 2000)]);
  t('fixture LTA +500', LTA(a) === 500);
  const b = buildNextMonth(a, 0.15);
  const dNo = { version: 7, settings: {}, months: [clone(a), clone(b)] };
  t('no stamp: buildNextMonth carry 0', incOf(b).carryOver === 0 && incOf(b).carryPending === false);
  t('no stamp: resync leaves 0', resyncCarryOvers(dNo).length === 0 && incOf(dNo.months[1]).carryOver === 0);
  dNo.months[0].trueUp = { at: '2026-09-30' };
  const chN = resyncCarryOvers(dNo);
  t('stamped: resync writes +500 counted on the standard fund', chN.length === 1 && chN[0].to === 500 && incOf(dNo.months[1]).carryOver === 500 && incOf(dNo.months[1]).carryPending === undefined && LTA(dNo.months[1]) === 1000); // 4000 + 500 − 3500
  t('stamped: buildNextMonth agrees', incOf(buildNextMonth(dNo.months[0], 0.15)).carryOver === 500);

  // Pending carry is spread through to comp.income; countedCarry excludes it.
  const cPend = computeMonth(octL);
  t('comp.income carries carryPending through', cPend.income[0].carryPending === true && cPend.incomeTotals.carryOver === -2000 && cPend.summary.countedCarry === 0);
}

// ---- 1.3.0 sitting B: catch-up (W5), goal done (W6), next charge month (W7), late-over (W0) ----
{
  const t = (label, cond, detail = '') => {
    if (cond) ok++; else { bad++; console.log(`FAIL 1.3.0B ${label}${detail ? ` — ${detail}` : ''}`); }
  };
  const mk = (id, funds, txs = [], income = []) =>
    ({ id, label: 'x', checks: {}, income, categories: [{ name: 'C', excludeFromTotals: false, funds }], transactions: txs });
  const tx = (date, amount, fund) => ({ id: date + fund + amount, date, vendor: 'v', amount, fund });
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const fundOf = (m, name) => m.categories[0].funds.find((f) => f.fund === name);

  // W5 — Basic, carry −175, planned 400, N = 3 → 458.33 for three months, 400 after.
  {
    const f = { fund: 'Ess', carryOver: -175, planned: 400, rule: null,
      setup: { type: 'basic', catchUp: { base: 400, perMonth: r2(175 / 3), until: monthAdd('2026-09', 2) } } };
    t('W5 basic: autoPlanned 458.33 in month 1', autoPlanned(f, '2026-09') === 458.33, String(autoPlanned(f, '2026-09')));
    t('W5 basic: 458.33 in month 2 and 3', autoPlanned(f, '2026-10') === 458.33 && autoPlanned(f, '2026-11') === 458.33);
    t('W5 basic: null again after until', autoPlanned(f, '2026-12') === null);
    t('W5 basic: isOverridden false at the auto', isOverridden({ ...f, planned: 458.33 }, '2026-09') === false);
    t('W5 basic: isOverridden true when typed', isOverridden({ ...f, planned: 500 }, '2026-09') === true);
    // Walk it through buildNextMonth: each month spends exactly its base, so the carry climbs by 58.33 a month.
    const sep = mk('2026-09', [{ ...f, planned: 458.33 }], [tx('2026-09-10', -400, 'Ess')]);
    const oct = buildNextMonth(sep, 0.1);
    const fo = fundOf(oct, 'Ess');
    t('W5 basic: Oct carry −116.67, planned 458.33, plan kept', fo.carryOver === -116.67 && fo.planned === 458.33 && fo.setup.catchUp && fo.setup.catchUp.until === '2026-11', JSON.stringify(fo));
    oct.transactions.push(tx('2026-10-10', -400, 'Ess'));
    const nov = buildNextMonth(oct, 0.1);
    const fn = fundOf(nov, 'Ess');
    t('W5 basic: Nov (the until month) still on plan', fn.carryOver === -58.34 && fn.planned === 458.33 && !!fn.setup.catchUp, JSON.stringify(fn));
    nov.transactions.push(tx('2026-11-10', -400, 'Ess'));
    const dec = buildNextMonth(nov, 0.1);
    const fd = fundOf(dec, 'Ess');
    t('W5 basic: Dec past until → base 400, catchUp gone, carry −0.01 (rounding)', fd.planned === 400 && fd.setup.catchUp === undefined && fd.carryOver === -0.01, JSON.stringify(fd));
    // Early end: the carry is back to +10 in month 2 → month 2 opens at base and the plan is gone.
    const sep2 = mk('2026-09', [{ ...f, planned: 458.33 }], [tx('2026-09-10', -273.33, 'Ess')]);
    const oct2 = fundOf(buildNextMonth(sep2, 0.1), 'Ess');
    t('W5 basic: early end — carry +10 → base 400, catchUp gone', oct2.carryOver === 10 && oct2.planned === 400 && oct2.setup.catchUp === undefined, JSON.stringify(oct2));
    // A typed override on the until month is not carried: Dec opens at base either way.
    const novT = clone(nov); fundOf(novT, 'Ess').planned = 999;
    t('W5 basic: a typed planned on the last month does not outlive the plan', fundOf(buildNextMonth(novT, 0.1), 'Ess').planned === 400);
    // Pacing takes the same path (base is the typed planned).
    const pc = { fund: 'Groc', carryOver: -60, planned: 300, rule: null, setup: { type: 'pacing', catchUp: { base: 300, perMonth: 30, until: '2026-10' } } };
    t('W5 pacing: 330 on plan, null after', autoPlanned(pc, '2026-10') === 330 && autoPlanned(pc, '2026-11') === null);
  }
  // W5 — Build-up monthly 50, carry −120, N = 2 → 110, 110, then 50 (its own auto).
  {
    const b = { fund: 'Pot', carryOver: -120, planned: 110, rule: null,
      setup: { type: 'savings', savingsMode: 'build', monthlyAmount: 50, buildGoal: 0, catchUp: { base: null, perMonth: 60, until: '2026-10' } } };
    t('W5 build: 110 in month 1', autoPlanned(b, '2026-09') === 110);
    const sep = mk('2026-09', [b], [tx('2026-09-10', -50, 'Pot')]);
    const oct = buildNextMonth(sep, 0.1);
    const fo = fundOf(oct, 'Pot');
    t('W5 build: Oct 110 (carry −60), plan kept', fo.planned === 110 && fo.carryOver === -60 && !!fo.setup.catchUp, JSON.stringify(fo));
    oct.transactions.push(tx('2026-10-10', -50, 'Pot'));
    const fn = fundOf(buildNextMonth(oct, 0.1), 'Pot');
    t('W5 build: Nov back to its own auto 50, catchUp gone', fn.planned === 50 && fn.setup.catchUp === undefined && fn.carryOver === 0, JSON.stringify(fn));
    // Build-up with a cap: the add-on sits on top of the capped auto.
    const bc = { fund: 'Cap', carryOver: 470, planned: 0, rule: null, setup: { type: 'savings', savingsMode: 'build', monthlyAmount: 50, buildGoal: 500, catchUp: { base: null, perMonth: 20, until: '2026-12' } } };
    t('W5 build with cap: capped auto 30 + 20 = 50', autoPlanned(bc, '2026-09') === 50);
  }
  // W5 — S7 interplay: a prior-month transaction moves so the carry changes while
  // on plan → the resync change has no plannedTo (the auto doesn't read the carry).
  {
    const f = { fund: 'Ess', carryOver: 0, planned: 400, rule: null, setup: { type: 'basic' } };
    const sep = mk('2026-09', [f], [tx('2026-09-10', -575, 'Ess')]);
    const oct = buildNextMonth(sep, 0.1);
    const fo = fundOf(oct, 'Ess');
    t('W5 S7 fixture: Oct carry −175', fo.carryOver === -175);
    fo.setup.catchUp = { base: 400, perMonth: 58.33, until: '2026-12' };
    fo.planned = autoPlanned(fo, '2026-10');
    t('W5 S7 fixture: on plan at 458.33', fo.planned === 458.33);
    const d = { version: 7, settings: {}, months: [sep, oct] };
    t('W5 S7: resync is quiet while nothing moved', resyncCarryOvers(d).length === 0);
    sep.transactions[0].amount = -520;                       // the September charge was really $520
    const ch = resyncCarryOvers(d);
    t('W5 S7: carry resynced to −120, planned untouched (no plannedTo)', ch.length === 1 && ch[0].to === -120 && ch[0].plannedTo === undefined && fo.planned === 458.33 && fo.carryOver === -120, JSON.stringify(ch));
    t('W5 S7: autoPlanned on a plan ignores the carry', autoPlanned({ ...fo, carryOver: -900 }, '2026-10') === 458.33);
  }

  // W6 — goal done: autoPlanned 0, no +12 roll, Review offset at month end.
  {
    const g = { fund: 'Baby', carryOver: 300, planned: 0, rule: null,
      setup: { type: 'savings', savingsMode: 'target', targetAmount: 3000, targetMonth: '2027-05', everyMonths: 1, totalAmount: 0, done: true } };
    t('W6: done goal autoPlanned === 0 (before its month)', autoPlanned(g, '2027-03') === 0);
    t('W6: done goal autoPlanned === 0 (after its month)', autoPlanned(g, '2027-08') === 0);
    t('W6: a done goal gets no catch-up add-on', autoPlanned({ ...g, setup: { ...g.setup, catchUp: { base: null, perMonth: 50, until: '2027-12' } } }, '2027-08') === 0);
    const aug = mk('2027-08', [g]);
    const sep = fundOf(buildNextMonth(aug, 0.1), 'Baby');
    t('W6: buildNextMonth past the target month keeps targetMonth and done', sep.setup.targetMonth === '2027-05' && sep.setup.done === true && sep.planned === 0 && sep.carryOver === 300, JSON.stringify(sep));
    const notDone = { ...g, setup: { ...g.setup, done: false } };
    const sepN = fundOf(buildNextMonth(mk('2027-08', [notDone]), 0.1), 'Baby');
    t('W6: a goal that is not done still rolls +12 (Inv 14)', sepN.setup.targetMonth === '2028-05' && sepN.planned > 0, JSON.stringify(sepN));
    const mid = fundFlags(aug, computeMonth(aug), '2027-08-15')[0];
    t('W6: done goal with $300 left — not free mid-month (S12 rule a)', !mid || mid.offset === false, JSON.stringify(mid));
    const end = fundFlags(aug, computeMonth(aug), '2027-08-31')[0];
    t('W6: done goal with $300 left — free at month end', end && end.offset === true && end.leftover === 300, JSON.stringify(end));
    const nd = mk('2027-08', [notDone]);
    const endN = fundFlags(nd, computeMonth(nd), '2027-08-31')[0];
    t('W6: not-done goal outside its target month — not free at month end (unchanged)', !endN || endN.offset === false, JSON.stringify(endN));
    const empty = mk('2027-08', [{ ...g, carryOver: 0 }]);
    t('W6: done goal at $0 — no entry at all', fundFlags(empty, computeMonth(empty), '2027-08-31').length === 0);
  }

  // W7 — nextChargeMonth: (total − carry) ÷ months to the charge, inclusive; rolls +everyMonths.
  {
    const fx = (o) => ({ fund: 'Ins', carryOver: 0, planned: 0, rule: null, setup: { type: 'fixed', everyMonths: 12, totalAmount: 220, ...o } });
    t('W7: three months out, 220, carry 0 → 73.33', autoPlanned({ ...fx({ nextChargeMonth: '2026-11' }), carryOver: 0 }, '2026-09') === 73.33);
    t('W7: carry 75.08, 12 months → 12.08', autoPlanned({ ...fx({ nextChargeMonth: '2027-08' }), carryOver: 75.08 }, '2026-09') === 12.08);
    t('W7: Renters 220 every 12, 3 months out, $100 set aside → 40', autoPlanned({ ...fx({ nextChargeMonth: '2026-11' }), carryOver: 100 }, '2026-09') === 40);
    t('W7: in the charge month itself → the whole remainder', autoPlanned({ ...fx({ nextChargeMonth: '2026-09' }), carryOver: 150 }, '2026-09') === 70);
    t('W7: fully set aside → 0, never negative', autoPlanned({ ...fx({ nextChargeMonth: '2026-11' }), carryOver: 300 }, '2026-09') === 0);
    t('W7: no monthId → total ÷ everyMonths', autoPlanned(fx({ nextChargeMonth: '2026-11' }), undefined) === 18.33);
    // No field → identical to today, on Dustin's two fixtures.
    t('W7: Car Insurance 3316.44/6 carry 2644.05 → 552.74 (unchanged)', autoPlanned({ fund: 'Car', carryOver: 2644.05, planned: 0, setup: { type: 'fixed', everyMonths: 6, totalAmount: 3316.44 } }, '2026-09') === 552.74);
    t('W7: Renters Insurance 598/12 carry 144.92 → 49.83 (unchanged)', autoPlanned({ fund: 'Rent', carryOver: 144.92, planned: 0, setup: { type: 'fixed', everyMonths: 12, totalAmount: 598 } }, '2026-09') === 49.83);
    t('W7: nextChargeMonth null → unchanged too', autoPlanned({ ...fx({ nextChargeMonth: null }), carryOver: 100 }, '2026-09') === 18.33);
    // Roll: past the charge month → +everyMonths; before it → kept.
    const nov = mk('2026-11', [{ ...fx({ nextChargeMonth: '2026-11' }), carryOver: 146.67, planned: 73.33 }], [tx('2026-11-05', -220, 'Ins')]);
    const dec = fundOf(buildNextMonth(nov, 0.1), 'Ins');
    t('W7: past the charge month → rolled +12 to 2027-11, carry 0, planned 18.33', dec.setup.nextChargeMonth === '2027-11' && dec.carryOver === 0 && dec.planned === 18.33, JSON.stringify(dec));
    const oct = fundOf(buildNextMonth(mk('2026-09', [{ ...fx({ nextChargeMonth: '2026-11' }), planned: 73.33 }]), 0.1), 'Ins');
    t('W7: before the charge month → kept, planned re-derived (220 − 73.33) ÷ 2 = 73.34', oct.setup.nextChargeMonth === '2026-11' && oct.carryOver === 73.33 && oct.planned === 73.34, JSON.stringify(oct));
    const q = fundOf(buildNextMonth(mk('2026-09', [{ fund: 'Q', carryOver: 0, planned: 0, rule: null, setup: { type: 'fixed', everyMonths: 3, totalAmount: 90, nextChargeMonth: '2026-09' } }]), 0.1), 'Q');
    t('W7: every 3 → rolls +3', q.setup.nextChargeMonth === '2026-12');
  }

  // W0 — a late-marked fund whose money then came in over is NOT resolved.
  {
    const pay = (o = {}) => ({ fund: 'Pay', carryOver: 0, planned: 4000, rule: { type: 'checks' }, titheExempt: false, group: 'standard', ...o });
    const dep = (date, amt) => ({ id: date + amt, date, vendor: 'EMPLOYER', amount: amt, fund: 'Pay' });
    const base = () => ({ id: '2026-09', label: 'x', checks: { Pay: { count: 2, amount: 2000, titheAmount: 2000 } }, income: [pay({ lateAtClose: true })],
      categories: [{ name: 'C', excludeFromTotals: false, funds: [{ fund: 'Rent', carryOver: 0, planned: 4000, rule: null, setup: { type: 'basic' } }] }],
      transactions: [] });
    const sept = base(); sept.transactions = [dep('2026-09-05', 2500), dep('2026-09-19', 2000)];
    const r = incomeTrueUp(sept, computeMonth(sept));
    t('W0: late + $4,500 → row open, actual offered', r.length === 1 && r[0].resolved === false && r[0].diff === 500 && r[0].options.includes('actual'), JSON.stringify(r));
    t('W0: Left to allocate still 0 before the decision', computeMonth(sept).summary.leftToAllocate === 0);
    setIncomeActual(sept, 'Pay', { mode: 'actual' });
    const ra = incomeTrueUp(sept, computeMonth(sept));
    t('W0: after actual → planned 4,500, LTA +500, resolved', sept.income[0].planned === 4500 && computeMonth(sept).summary.leftToAllocate === 500 && ra.length === 1 && ra[0].resolved === true, JSON.stringify(ra));
    const late = base(); late.transactions = [dep('2026-09-05', 2000)];
    const rl = incomeTrueUp(late, computeMonth(late));
    t('W0: late and still short → resolved as before', rl.length === 1 && rl[0].resolved === true && rl[0].diff === -2000);
    const landed = base(); landed.transactions = [dep('2026-09-05', 2000), dep('2026-09-19', 2000)];
    const rd = incomeTrueUp(landed, computeMonth(landed));
    t('W0: late and landed exactly → resolved, row kept to clear the flag', rd.length === 1 && rd[0].resolved === true && rd[0].diff === 0);
  }
  console.log(`1.3.0 sitting B: assertions folded into the pass/fail totals above (now ${ok} ok / ${bad} bad)`);
}

if (!process.env.CHECKING_CSV) {
  console.log('\nChecking CSV section skipped — set CHECKING_CSV to a real checking export to run it.');
} else {
  const text = fs.readFileSync(process.env.CHECKING_CSV, 'utf8');
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
if (!process.env.CARD_CSV) {
  console.log('\nCard CSV section skipped — set CARD_CSV to a real card export to run it.');
} else {
  const text = fs.readFileSync(process.env.CARD_CSV, 'utf8');
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

// Fail the process when any check missed, so `npm test` goes red on regressions.
// The line above the fund rows counts the spreadsheet section only; this is the
// whole suite (spreadsheet + every hard-asserting block) — the number the work
// orders pin.
console.log(`
test-compute: ${ok} passed, ${bad} failed`);
process.exitCode = bad ? 1 : 0;
