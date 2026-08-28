/*
 * extract-workbook.js — one-time importer.
 * Reads "2026 Budget.xlsx" and produces data/seed.json in the app's data model.
 *
 * Usage: node tools/extract-workbook.js "C:/path/to/2026 Budget.xlsx"
 */
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const wbPath = process.argv[2] || path.join(require('os').homedir(), 'Desktop', '2026 Budget.xlsx');
const wb = XLSX.readFile(wbPath, { cellFormula: true, cellDates: false });

const MONTHS = [
  ['December', '2025-12'], ['January', '2026-01'], ['February', '2026-02'],
  ['March', '2026-03'], ['April', '2026-04'], ['May', '2026-05'],
  ['June', '2026-06'], ['July', '2026-07'], ['August', '2026-08'],
];

const cellV = (ws, addr) => { const c = ws[addr]; return c ? c.v : undefined; };
const cellF = (ws, addr) => { const c = ws[addr]; return c && c.f ? c.f : null; };
const num = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : 0);

// Classify a "Planned" cell formula into a rule the app can re-apply.
function classifyRule(f) {
  if (!f) return null;
  const s = f.replace(/\s+/g, '');
  if (/\*0?\.15\b/.test(s) || /0?\.15\*/.test(s)) return { type: 'tithe', percent: 0.15 };
  let m = s.match(/^G\d+\/(\d+)$/i);
  if (m) return { type: 'yearlyDiv', divisor: Number(m[1]) };
  if (/^G\d+\*H\d+$/i.test(s) || /^H\d+\*G\d+$/i.test(s)) return { type: 'checks' };
  return null;
}

function excelDateToISO(v) {
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  if (typeof v === 'string') {
    const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      let y = Number(m[3]); if (y < 100) y += 2000;
      return `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
    }
  }
  return null;
}

function extractFabSheet(ws, monthId) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  const rows = range.e.r + 1;
  const A = (r) => cellV(ws, 'A' + r);

  // Paychecks: F2/G2/H2 (first earner), F3/G3/H3 (second earner)
  const checks = {};
  for (const r of [2, 3]) {
    const label = cellV(ws, 'F' + r);
    if (label) checks[String(label).trim()] = { count: num(cellV(ws, 'G' + r)), amount: num(cellV(ws, 'H' + r)) };
  }

  // Find the Income section
  let incomeStart = null;
  for (let r = 1; r <= rows; r++) {
    if (A(r) === 'Income' && cellV(ws, 'A' + (r + 1)) === 'Fund Name') { incomeStart = r + 2; break; }
  }
  const income = [];
  let r = incomeStart;
  while (r <= rows && A(r) && !String(A(r)).startsWith('Total')) {
    income.push({
      fund: String(A(r)).trim(),
      carryOver: num(cellV(ws, 'B' + r)),
      planned: num(cellV(ws, 'C' + r)),
      rule: classifyRule(cellF(ws, 'C' + r)),
      titheExempt: /transfer/i.test(String(A(r))),
    });
    r++;
  }

  // Category sections: header row 'Fund Name' under a category-title row, after the income Total row.
  const categories = [];
  for (let rr = r + 1; rr <= rows; rr++) {
    if (cellV(ws, 'A' + rr) === 'Fund Name' && A(rr - 1)) {
      const name = String(A(rr - 1)).trim();
      const funds = [];
      let fr = rr + 1;
      while (fr <= rows && A(fr) && String(A(fr)).trim() !== 'Total') {
        const g = cellV(ws, 'G' + fr);
        funds.push({
          fund: String(A(fr)).trim(),
          carryOver: num(cellV(ws, 'B' + fr)),
          planned: num(cellV(ws, 'C' + fr)),
          rule: classifyRule(cellF(ws, 'C' + fr)),
          yearlyCharge: typeof g === 'number' ? num(g) : null,
        });
        fr++;
      }
      categories.push({ name, excludeFromTotals: name === 'Work', funds });
      rr = fr;
    }
  }
  return { id: monthId, checks, income, categories };
}

function extractTransactions(ws, monthId) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  const txns = [];
  for (let r = 2; r <= range.e.r + 1; r++) {
    const date = cellV(ws, 'A' + r);
    const vendor = cellV(ws, 'B' + r);
    const amount = cellV(ws, 'C' + r);
    if (date === undefined && vendor === undefined && amount === undefined) continue;
    if (typeof amount !== 'number') continue;
    txns.push({
      id: `${monthId}-x${r}`,
      date: excelDateToISO(date),
      vendor: vendor !== undefined ? String(vendor).trim() : '',
      amount: num(amount),
      fund: cellV(ws, 'E' + r) !== undefined ? String(cellV(ws, 'E' + r)).trim() : '',
      description: cellV(ws, 'F' + r) !== undefined ? String(cellV(ws, 'F' + r)).trim() : '',
      account: cellV(ws, 'G' + r) !== undefined ? String(cellV(ws, 'G' + r)).trim() : '',
    });
  }
  return txns;
}

const months = [];
for (const [name, id] of MONTHS) {
  const fab = wb.Sheets[name + ' Fab'];
  const tx = wb.Sheets[name + ' Transactions'];
  if (!fab) { console.error('Missing sheet:', name + ' Fab'); continue; }
  const m = extractFabSheet(fab, id);
  m.label = name;
  m.transactions = tx ? extractTransactions(tx, id) : [];
  months.push(m);
}

// ---- Verification: recompute Expensed/Leftover per fund and compare with sheet cached values ----
function normFund(s) { return String(s || '').trim().toLowerCase(); }
let checksOK = 0, checksBad = 0;
for (const [name, id] of MONTHS) {
  const fab = wb.Sheets[name + ' Fab'];
  const m = months.find((x) => x.id === id);
  if (!fab || !m) continue;
  // Recompute expensed per fund from our extracted transactions
  const sums = {};
  for (const t of m.transactions) {
    const k = normFund(t.fund);
    sums[k] = (sums[k] || 0) + t.amount;
  }
  // Compare against every category fund's cached Expensed (col D) on the Fab sheet
  const range = XLSX.utils.decode_range(fab['!ref']);
  for (let r = 1; r <= range.e.r + 1; r++) {
    const f = cellF(fab, 'D' + r);
    if (f && /^SUMIF\(/i.test(f)) {
      const fund = cellV(fab, 'A' + r);
      const cached = cellV(fab, 'D' + r);
      if (typeof cached !== 'number') continue;
      const mine = Math.round((sums[normFund(fund)] || 0) * 100) / 100;
      if (Math.abs(mine - cached) < 0.005) checksOK++;
      else { checksBad++; console.log(`MISMATCH ${name} ${fund}: sheet=${cached} mine=${mine}`); }
    }
  }
}
console.log(`Expensed verification: ${checksOK} funds match, ${checksBad} mismatches`);

// ---- Template for future months, from the latest sheet (August) ----
const latest = months[months.length - 1];
const template = {
  income: latest.income.map((f) => ({ fund: f.fund, rule: f.rule, titheExempt: f.titheExempt })),
  categories: latest.categories.map((c) => ({
    name: c.name,
    excludeFromTotals: c.excludeFromTotals,
    funds: c.funds.map((f) => ({ fund: f.fund, rule: f.rule, yearlyCharge: f.yearlyCharge, defaultPlanned: f.planned })),
  })),
  checks: latest.checks,
};

const seed = {
  version: 1,
  settings: { tithePercent: 0.15, appName: 'Family Budget' },
  template,
  months,
};

const out = path.join(__dirname, '..', 'data', 'seed.json');
fs.writeFileSync(out, JSON.stringify(seed, null, 1));
const totalTx = months.reduce((a, m) => a + m.transactions.length, 0);
console.log(`Wrote ${out}: ${months.length} months, ${totalTx} transactions`);
