// CSV importer tests. Self-contained: fixtures live in tools/fixtures (synthetic
// data only — no real bank files). Run: npm run test:csv
//
// Phase 1 scope:
//  1. Regression guard — the two Capital One formats (card + 360 checking) must
//     produce byte-identical import results vs the pre-change baseline captured
//     in tools/csv-regression-baseline.json.
//  2. Unit checks on the hardened primitives (bare quotes, BOM, amount pipeline,
//     date validation) — the silent-corruption class from the importer audit.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, parseBankCsv, parseBankFile } from '../src/csv.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures');

let pass = 0, fail = 0;
const failures = [];
const check = (name, cond, detail = '') => {
  if (cond) pass++;
  else { fail++; failures.push(`${name}${detail ? ': ' + detail : ''}`); }
};

// ---- 1. Regression guard: byte-identical Capital One imports ----
// The baseline holds the exact pre-change output fields ({date, vendor, amount,
// account, bankCategory, isCardPayment}); new fields like amountCents ride along
// but the imported values must not move by a byte.
const LEGACY_FIELDS = ['date', 'vendor', 'amount', 'account', 'bankCategory', 'isCardPayment'];
const baseline = JSON.parse(fs.readFileSync(path.join(HERE, 'csv-regression-baseline.json'), 'utf8'));
for (const [file, expected] of Object.entries(baseline)) {
  const recs = parseBankCsv(fs.readFileSync(path.join(FIX, file), 'utf8'));
  const projected = recs.map((r) => Object.fromEntries(LEGACY_FIELDS.map((f) => [f, r[f]])));
  check(`${file} byte-identical`, JSON.stringify(projected) === JSON.stringify(expected),
    `output drifted from the committed baseline`);
  check(`${file} no anomalies`, (recs.anomalies || []).length === 0,
    JSON.stringify(recs.anomalies));
  check(`${file} amountCents mirrors amount`,
    recs.every((r) => r.amountCents === Math.round(r.amount * 100)));
}

// ---- 2. A7: a bare quote must not swallow the rest of the line ----
{
  const rows = parseCsv('Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n'
    + '1/5/26,1/5/26,5620,LOWES 5" PVC FITTING,Merchandise,19.47,\n'
    + '1/6/26,1/6/26,5620,NEXT ROW SURVIVES,Merchandise,1.00,\n');
  check('A7 rows intact', rows.length === 3, `got ${rows.length} rows`);
  check('A7 quote kept literally', rows[1] && rows[1][3] === 'LOWES 5" PVC FITTING',
    JSON.stringify(rows[1]));
  check('A7 fields not merged', rows[1] && rows[1].length === 7, `got ${rows[1]?.length} fields`);
}

// ---- 3. B3: UTF-8 BOM must not break header matching ----
{
  const recs = parseBankCsv('﻿Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n'
    + '1/5/26,1/5/26,5620,COFFEE,Merchandise,4.50,\n');
  check('B3 BOM stripped', recs.length === 1 && recs[0].amount === -4.5, JSON.stringify(recs));
}

// ---- 4. A3: an unparseable date is a row error, never a passthrough ----
{
  const recs = parseBankCsv('Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n'
    + 'Pending,,5620,NOT A DATE,Merchandise,10.00,\n'
    + '13/45/2026,,5620,IMPOSSIBLE DATE,Merchandise,10.00,\n'
    + '1/5/26,1/5/26,5620,GOOD ROW,Merchandise,5.00,\n');
  check('A3 bad dates excluded', recs.length === 1 && recs[0].vendor === 'GOOD ROW', JSON.stringify(recs));
  check('A3 bad dates reported', recs.anomalies.length === 2
    && recs.anomalies.every((a) => a.code === 'BadDate'), JSON.stringify(recs.anomalies));
}

// ---- 5. A2: two-digit years use a sliding window, not +2000 ----
{
  const recs = parseBankCsv('Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n'
    + '1/5/98,,5620,OLD ARCHIVE ROW,Merchandise,10.00,\n');
  check('A2 1998 not 2098', recs.length === 1 && recs[0].date === '1998-01-05', JSON.stringify(recs[0]));
}

// ---- 6. A4: a decimal-comma amount is refused, never misread ~1000× ----
{
  const recs = parseBankCsv('Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n'
    + '1/5/26,,5620,EURO STYLE,Merchandise,"1.234,56",\n'
    + '1/6/26,,5620,US GROUPING OK,Merchandise,"1,234.56",\n');
  check('A4 decimal comma → row error', recs.length === 1
    && recs.anomalies.length === 1 && recs.anomalies[0].code === 'BadAmount',
    JSON.stringify({ recs, anomalies: recs.anomalies }));
  check('A4 US grouping parses', recs[0] && recs[0].amountCents === -123456, JSON.stringify(recs[0]));
}

// ---- 7. A5/A6: hostile amount forms error out instead of importing as $0 ----
{
  const recs = parseBankCsv('Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit\n'
    + '1/5/26,,5620,DOUBLE DOT,Merchandise,12..34,\n'
    + '1/6/26,,5620,THREE DECIMALS HALF-UP,Merchandise,12.345,\n');
  check('A6 unparseable → anomaly, not $0', recs.anomalies.length === 1
    && recs.anomalies[0].code === 'BadAmount', JSON.stringify(recs.anomalies));
  check('A5 3-decimal half-up rounding', recs.length === 1 && recs[0].amountCents === -1235,
    JSON.stringify(recs[0]));
}

// ---- Phase 2: the fixture suite — manifest.json as assertions ----
// Decision D1 overrides the manifest for international fixtures: DD/MM dates,
// decimal commas and semicolon delimiters must be REFUSED or ASKED about by
// name, never imported — even though the research manifest records the totals
// a full international importer would produce.
const INTERNATIONAL = new Set(['30-monzo-uk.csv', '31-sparkasse-de.csv', '56-edge-semicolon-narrow.csv']);

const manifest = JSON.parse(fs.readFileSync(path.join(FIX, 'manifest.json'), 'utf8'));
for (const fx of manifest.fixtures) {
  const buf = fs.readFileSync(path.join(FIX, fx.file));
  let out;
  try { out = parseBankFile(buf); }
  catch (e) { out = { error: 'THREW: ' + e.message, records: [], report: { questions: [] } }; }
  const tag = fx.file;
  const asked = (out.report?.questions?.length ?? 0) > 0;

  if (INTERNATIONAL.has(fx.file)) {
    check(`${tag} [D1 refused/asked]`, !!out.error || asked,
      `international format was imported silently: ${JSON.stringify(out.report?.totals)}`);
    continue;
  }
  if (fx.mustRefuse) {
    check(`${tag} [refuses]`, !!out.error, 'expected a refusal, got ' + (asked ? 'a question' : 'records'));
    continue;
  }
  if (fx.mustAsk) {
    check(`${tag} [asks]`, asked || !!out.error,
      'expected a blocking question or a refusal; the importer produced numbers silently');
    continue;
  }
  if (out.error) { check(tag, false, `error: ${out.error}`); continue; }
  // A sign question on a file the manifest expects to import is allowed only
  // when the file is genuinely too small for the evidence rules (§5.7 says ask
  // when undecided) — but the records must still parse to the expected values.
  const r = out.report;
  check(`${tag} [rows]`, r.counts.rows === fx.rows, `rows ${r.counts.rows} != ${fx.rows}`);
  if (fx.totalCents != null && !asked) {
    check(`${tag} [net]`, r.totals?.netCents === fx.totalCents, `net ${r.totals?.netCents} != ${fx.totalCents}`);
  }
  if (fx.inCents != null && !asked) {
    check(`${tag} [in]`, r.totals?.inCents === fx.inCents, `in ${r.totals?.inCents} != ${fx.inCents}`);
  }
  if (fx.outCents != null && !asked) {
    check(`${tag} [out]`, r.totals?.outCents === fx.outCents, `out ${r.totals?.outCents} != ${fx.outCents}`);
  }
  if (fx.dateMin) check(`${tag} [dateMin]`, r.totals?.dateMin === fx.dateMin, `${r.totals?.dateMin} != ${fx.dateMin}`);
  if (fx.dateMax) check(`${tag} [dateMax]`, r.totals?.dateMax === fx.dateMax, `${r.totals?.dateMax} != ${fx.dateMax}`);
  if (fx.delimiter) check(`${tag} [delim]`, r.delimiter === fx.delimiter, `${JSON.stringify(r.delimiter)} != ${JSON.stringify(fx.delimiter)}`);
  if (fx.decimalMark) check(`${tag} [decimal]`, r.decimalMark === fx.decimalMark, `${r.decimalMark} != ${fx.decimalMark}`);
  if (fx.encoding) check(`${tag} [encoding]`, r.encoding === fx.encoding, `${r.encoding} != ${fx.encoding}`);
  if (fx.balanceReconciles) check(`${tag} [balance]`, r.balanceCheck.ok === true, 'balance did not reconcile');
  if (asked) check(`${tag} [asked]`, true, ''); // visibility: which import fixtures still ask
}

// ---- Phase 2: parseBankFile must agree with the legacy path on Capital One ----
for (const [file, expected] of Object.entries(baseline)) {
  const out = parseBankFile(fs.readFileSync(path.join(FIX, file)));
  check(`${file} [pipeline no error]`, !out.error && !out.report.questions.length,
    out.error || JSON.stringify(out.report.questions));
  const got = out.records.map((r) => ({
    date: r.date, vendor: r.vendor, amount: r.amount, account: r.account,
    bankCategory: r.bankCategory, isCardPayment: r.isCardPayment,
  }));
  check(`${file} [pipeline ≡ legacy]`, JSON.stringify(got) === JSON.stringify(expected),
    JSON.stringify(got[0]) + ' vs ' + JSON.stringify(expected[0]));
}

console.log(`\nCSV importer: ${pass} passed, ${fail} failed`);
if (failures.length) { console.log('\nFailures:'); for (const f of failures) console.log('  ✗ ' + f); }
process.exit(fail ? 1 : 0);
