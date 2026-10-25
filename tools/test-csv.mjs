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
import {
  parseCsv, parseBankCsv, parseBankFile, scoreDuplicate, findDuplicateScored,
  findDuplicate, matchDuplicates, suggestStarterFunds, starterFundFor,
} from '../src/csv.js';

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

// ---- Phase 3: profile registry ----
// Seed profiles must recognise the fixtures for the institutions they cover —
// and since the whole manifest suite above already ran with the registry
// active, a profile whose stored shape diverged from inference would have
// broken those totals. Here we pin the actual matches.
{
  const expectMatch = {
    '01-chase-checking.csv': 'chase-checking-v3',
    '03-chase-card-2019.csv': 'chase-card-v3',
    '05-bofa-checking.csv': 'bofa-checking',
    '07-wellsfargo-headerless.csv': 'wellsfargo',
    '09-capitalone-card-iso.csv': 'capitalone-card',
    '10-capitalone-card-us.csv': 'capitalone-card',
    '11-capitalone-360.csv': 'capitalone-360',
    '14-suntrust-legacy.csv': 'suntrust-legacy',
    '17-amex-basic.csv': 'amex-basic',
    '19-discover-card.csv': 'discover-card',
    '20-apple-card.csv': 'apple-card',
    '23-usaa-bk_download.csv': 'usaa-legacy',
    '26-schwab-checking.csv': 'schwab-checking',
    '27-fidelity-cma.csv': 'fidelity-cma',
    '28-paypal-classic.csv': 'paypal-classic',
    '29-mint-export.csv': 'mint-classic',
  };
  for (const [file, id] of Object.entries(expectMatch)) {
    const out = parseBankFile(fs.readFileSync(path.join(FIX, file)));
    check(`${file} [profile=${id}]`, out.report?.profile?.id === id,
      `matched ${out.report?.profile?.id ?? 'nothing'}`);
  }
  // Citi's pendingRule fires through the profile path (and the row count in the
  // manifest run above already proved the pending row was skipped).
  const citi = parseBankFile(fs.readFileSync(path.join(FIX, '08-citi-card.csv')));
  check('08-citi [profile pending skip]', citi.report.counts.pending === 1 && citi.report.counts.rows === 8,
    JSON.stringify(citi.report.counts));
}

// Recognition-only (D1): Monzo is refused BY NAME, never imported.
{
  const out = parseBankFile(fs.readFileSync(path.join(FIX, '30-monzo-uk.csv')));
  check('30-monzo [named refusal]', /Monzo/.test(out.error || ''), out.error || 'no error');
}

// A generic 3-column header collides with the Amex seed profile — the seed's
// MDY/flip must NOT resolve an ambiguous file (that would be a smuggled guess).
{
  const out = parseBankFile(fs.readFileSync(path.join(FIX, '57-edge-duplicate-sameday.csv')));
  const kinds = (out.report.questions || []).map((q) => q.kind);
  check('57 [seed profile cannot answer for the user]',
    kinds.includes('dateOrder') && kinds.includes('signConvention'), JSON.stringify(kinds));
}

// Round trip: answer the questions once → the resolved profile is persisted →
// the next file of the same shape imports with ZERO questions (§6 steady state).
{
  const buf = fs.readFileSync(path.join(FIX, '57-edge-duplicate-sameday.csv'));
  const answered = parseBankFile(buf, { answers: { dateOrder: 'MDY', signConvention: 'as-is' } });
  const rp = answered.report.resolvedProfile;
  check('57 [answers produce a resolvedProfile]',
    !!rp && rp.dateOrder === 'MDY' && rp.signConvention === 'as-is' && rp.fingerprint?.startsWith('fnv1a:'),
    JSON.stringify(rp));
  const again = parseBankFile(buf, { profiles: [rp] });
  check('57 [user profile remembers the answers]',
    !again.error && again.report.questions.length === 0 && again.report.profile?.source === 'user'
      && again.report.counts.rows === 4 && again.report.totals.netCents === 198500,
    JSON.stringify({ q: again.report.questions, totals: again.report.totals, profile: again.report.profile }));
  // …and the escape hatch brings inference (and its questions) back.
  const ignored = parseBankFile(buf, { profiles: [rp], answers: { ignoreProfile: true } });
  check('57 [not-this-bank re-runs inference]', ignored.report.questions.length > 0 && !ignored.report.profile,
    JSON.stringify(ignored.report.questions.map((q) => q.kind)));
}

// ================= Phase 4 =================

// ---- Multi-table files are refused by name (the owner's decision) ----
{
  const out = parseBankFile(fs.readFileSync(path.join(FIX, '53-edge-multi-table.csv')));
  check('53 [refusal names the multi-table shape]', /more than one table/i.test(out.error || ''),
    out.error || 'no error');
}

// ---- Scored duplicate matcher (§8) ----
{
  const t = (over) => ({ id: over.id || 'tx', date: '2026-01-10', vendor: 'JOES GRILL', amount: -40,
    fund: 'Fast Food', description: '', account: '', ...over });
  const r = (over) => ({ date: '2026-01-10', vendor: 'JOES GRILL', amount: -40, amountCents: -4000,
    account: '', bankCategory: '', memo: '', ...over });

  check('dup exact = 1.0', scoreDuplicate(t({}), r({})) === 1);
  // Near-equal cents are "possible" (ticked, badged), never confident — a
  // second real purchase 5¢ apart must not be unticked (3-year sim S6).
  check('dup 2¢ off = 0.6 possible, not confident (S6)', scoreDuplicate(t({}), r({ amount: -40.02, amountCents: -4002 })) === 0.6);
  check('dup 0.5% off = 0.6 possible, not confident (S6)', scoreDuplicate(t({ amount: -500 }), r({ amount: -502, amountCents: -50200 })) === 0.6);
  check('dup tip at a grill, later and larger = 0.6',
    scoreDuplicate(t({}), r({ date: '2026-01-12', amount: -41.5, amountCents: -4150 })) === 0.6);
  check('dup 5% at a non-dining vendor = no match',
    scoreDuplicate(t({ vendor: 'ACE HARDWARE' }), r({ vendor: 'ACE HARDWARE', date: '2026-01-12', amount: -41.5, amountCents: -4150 })) === 0);
  check('dup tip where the EARLIER amount is larger = no match',
    scoreDuplicate(t({ amount: -41.5 }), r({ date: '2026-01-12', amount: -40, amountCents: -4000 })) === 0);

  // The window is asymmetric (−3…+7) for the POSSIBLE tiers: a CSV row posts up
  // to a week AFTER the entry the user typed, but at most 3 days before it. A
  // CONFIDENT match (same vendor, same cents) is only within ±3 days: an exact
  // match 4–7 days out is a weekly paycheck, not the same line twice, and is
  // NO match at all — not 0.6 (decision 2026-10-05, 3-year sim S1).
  check('dup csv +3 days after entry matches', scoreDuplicate(t({}), r({ date: '2026-01-13' })) === 1);
  check('dup csv +4 days after entry is no match (S1)', scoreDuplicate(t({}), r({ date: '2026-01-14' })) === 0);
  check('dup csv +7 days after entry is no match (S1)', scoreDuplicate(t({}), r({ date: '2026-01-17' })) === 0);
  check('dup csv +8 days after entry does not', scoreDuplicate(t({}), r({ date: '2026-01-18' })) === 0);
  check('dup near-equal +7 days is still possible', scoreDuplicate(t({}), r({ date: '2026-01-17', amount: -40.02, amountCents: -4002 })) === 0.6);
  check('dup csv −3 days before entry matches', scoreDuplicate(t({}), r({ date: '2026-01-07' })) === 1);
  check('dup csv −4 days before entry does not (old ±4 would have matched)',
    scoreDuplicate(t({}), r({ date: '2026-01-06' })) === 0);

  // Account in the match key (§8.2): the same $40 on two cards is two transactions.
  check('dup different accounts = no match', scoreDuplicate(t({ account: '1234' }), r({ account: '9999' })) === 0);
  check('dup one side missing its account still matches', scoreDuplicate(t({ account: '1234' }), r({})) === 1);

  // Bank transaction IDs (§8.1): exact when trusted, ignored when not.
  check('dup trusted equal ids = 1.0 even when the amount moved',
    scoreDuplicate(t({ externalId: 'A1' }), r({ externalId: 'A1', amount: -55, amountCents: -5500 }), { idTrusted: true }) === 1);
  check('dup trusted different ids = no match even when identical otherwise',
    scoreDuplicate(t({ externalId: 'A1' }), r({ externalId: 'B2' }), { idTrusted: true }) === 0);
  check('dup untrusted ids fall back to heuristics',
    scoreDuplicate(t({ externalId: 'A1' }), r({ externalId: 'B2' }), { idTrusted: false }) === 1);

  // The memo (real merchant string) is an alternate vendor key.
  check('dup matches on the memo when the vendor is a type code',
    scoreDuplicate(t({}), r({ vendor: 'DEBIT CARD PURCHASE', memo: 'JOES GRILL' })) === 1);
}

// ---- Multiplicity (57): three identical rows need three existing entries ----
{
  const buf = fs.readFileSync(path.join(FIX, '57-edge-duplicate-sameday.csv'));
  const { records } = parseBankFile(buf, { answers: { dateOrder: 'MDY', signConvention: 'as-is' } });
  const coffee = (id) => ({ id, date: '2026-01-05', vendor: 'BLUE BOTTLE COFFEE', amount: -5, fund: 'Fast Food', account: '' });
  const dedupe = (existing) => {
    const months = [{ id: '2026-01', transactions: existing }];
    const claimed = new Set();
    return records.map((rec) => findDuplicateScored(months, rec, claimed, {}));
  };
  const three = dedupe([coffee('a'), coffee('b'), coffee('c')]);
  check('57 [3 existing claim all 3 rows]', three.filter((d) => d && d.score === 1).length === 3,
    JSON.stringify(three.map((d) => d?.score ?? null)));
  check('57 [each claims a DISTINCT transaction]', new Set(three.filter(Boolean).map((d) => d.t.id)).size === 3);
  const two = dedupe([coffee('a'), coffee('b')]);
  check('57 [2 existing leave the 3rd row importable]',
    two.filter((d) => d && d.score === 1).length === 2 && two.filter((d) => !d).length === 2,
    JSON.stringify(two.map((d) => d?.score ?? null)));
  // Legacy surface: only a confident (≥0.9) match counts, and a 0.6-tier
  // candidate is neither returned nor claimed.
  const months = [{ id: '2026-01', transactions: [
    { id: 'g', date: '2026-01-10', vendor: 'JOES GRILL', amount: -40, fund: 'x', account: '' }] }];
  const claimed = new Set();
  const tipRec = { date: '2026-01-12', vendor: 'JOES GRILL', amount: -41.5, amountCents: -4150, account: '', bankCategory: '', memo: '' };
  check('findDuplicate [0.6 tier returns null and claims nothing]',
    findDuplicate(months, tipRec, claimed) === null && claimed.size === 0);
  check('findDuplicate [exact match still claims]',
    findDuplicate(months, { ...tipRec, date: '2026-01-10', amount: -40, amountCents: -4000 }, claimed)?.id === 'g'
      && claimed.has('g'));
}

// ---- Bank ID column validation (§8.1) ----
{
  const trusted = parseBankFile('Date,Description,Reference Number,Amount,Balance\n'
    + '2026-01-05,COFFEE,R100,-5.00,995.00\n'
    + '2026-01-06,GROCER,R101,-20.00,975.00\n'
    + '2026-01-07,LUNCH,R102,-10.00,965.00\n'
    + '2026-01-08,PAYROLL,R103,100.00,1065.00\n');
  check('id column distinct+full → trusted', trusted.report.externalIdTrusted === true,
    JSON.stringify({ err: trusted.error, q: trusted.report.questions }));
  // Zions repeats one reference (and the literal string "null") down the file.
  const zions = parseBankFile(fs.readFileSync(path.join(FIX, '16-zions-business.csv')));
  check('16-zions [constant reference column NOT trusted]', zions.report.externalIdTrusted === false);
}

// ---- Pending rows: blank Clearing Date (Apple Card) + settled-status vocabulary ----
{
  const apple = parseBankFile('Date,Clearing Date,Description,Amount,Balance\n'
    + '2026-01-05,2026-01-06,COFFEE,-5.00,995.00\n'
    + '2026-01-06,2026-01-07,GROCER,-20.00,975.00\n'
    + '2026-01-07,,CARD SWIPE STILL PENDING,-10.00,975.00\n'
    + '2026-01-08,2026-01-09,PAYROLL,100.00,1075.00\n');
  check('blank Clearing Date row skipped as pending',
    !apple.error && apple.report.counts.pending === 1 && apple.report.counts.rows === 3,
    JSON.stringify({ err: apple.error, counts: apple.report.counts, q: apple.report.questions }));
  check('blank Clearing Date [balance still reconciles without it]', apple.report.balanceCheck.ok === true);

  const statuses = parseBankFile('Date,Status,Description,Amount,Balance\n'
    + '2026-01-05,Completed,COFFEE,-5.00,995.00\n'
    + '2026-01-06,Denied,BAD CHARGE,-50.00,995.00\n'
    + '2026-01-07,Reversed,DISPUTED CHARGE,-30.00,995.00\n'
    + '2026-01-08,Completed,GROCER,-20.00,975.00\n'
    + '2026-01-09,Completed,PAYROLL,100.00,1075.00\n');
  check('Denied/Reversed statuses skipped like Pending',
    !statuses.error && statuses.report.counts.pending === 2 && statuses.report.counts.rows === 3,
    JSON.stringify({ err: statuses.error, counts: statuses.report.counts, q: statuses.report.questions }));
}

// ---- Second description (memo) is preserved ----
{
  const cu = parseBankFile(fs.readFileSync(path.join(FIX, '22-cu-comments.csv')));
  check('22-cu [memo carries the real merchant string]',
    cu.records[0]?.vendor === 'DEBIT CARD PURCHASE' && cu.records[0]?.memo === 'WHOLEFDS MKT 10123',
    JSON.stringify({ vendor: cu.records[0]?.vendor, memo: cu.records[0]?.memo }));
}

// ---- Direction tokens: data, never code (§5.4) ----
{
  // Same Af/Bij tokens, opposite meanings — only the balance column can say
  // which is which, and it must decide both ways.
  const afOut = 'Date,Description,Type,Amount,Balance\n'
    + '2026-01-05,COFFEE,Af,5.00,995.00\n'
    + '2026-01-06,PAYROLL,Bij,100.00,1095.00\n'
    + '2026-01-07,GROCER,Af,20.00,1075.00\n'
    + '2026-01-08,LUNCH,Af,10.00,1065.00\n';
  const a = parseBankFile(afOut);
  check('direction [balance proves Af=out]',
    !a.error && !a.report.questions.length && a.report.totals.netCents === 6500
      && a.report.signConvention.directionTokens?.af === 'out',
    JSON.stringify({ err: a.error, q: a.report.questions, totals: a.report.totals, sign: a.report.signConvention }));

  const afIn = 'Date,Description,Type,Amount,Balance\n'
    + '2026-01-05,REFUND A,Af,5.00,1005.00\n'
    + '2026-01-06,RENT,Bij,100.00,905.00\n'
    + '2026-01-07,REFUND B,Af,20.00,925.00\n'
    + '2026-01-08,REFUND C,Af,10.00,935.00\n';
  const b = parseBankFile(afIn);
  check('direction [same tokens, opposite balance ⇒ Af=in]',
    !b.error && !b.report.questions.length && b.report.totals.netCents === -6500
      && b.report.signConvention.directionTokens?.af === 'in',
    JSON.stringify({ err: b.error, q: b.report.questions, totals: b.report.totals, sign: b.report.signConvention }));

  // No balance column: unknown-direction tokens must ASK, and the answers
  // persist into the resolved profile so the next import is silent.
  const noBal = afOut.split('\n').map((l) => l.split(',').slice(0, 4).join(',')).join('\n');
  const q1 = parseBankFile(noBal);
  const kinds = (q1.report.questions || []).map((q) => q.kind);
  check('direction [no balance → asks per token]',
    kinds.filter((k) => k === 'direction').length === 2, JSON.stringify(q1.report.questions));
  const q2 = parseBankFile(noBal, { answers: { 'dir:af': 'out', 'dir:bij': 'in' } });
  check('direction [answers resolve it]',
    !q2.error && !q2.report.questions.length && q2.report.totals.netCents === 6500,
    JSON.stringify({ err: q2.error, q: q2.report.questions, totals: q2.report.totals }));
  check('direction [mapping lands in the resolved profile]',
    JSON.stringify(q2.report.resolvedProfile?.directionTokens) === JSON.stringify({ af: 'out', bij: 'in' }),
    JSON.stringify(q2.report.resolvedProfile));
  const q3 = parseBankFile(noBal, { profiles: [q2.report.resolvedProfile] });
  check('direction [user profile answers silently next time]',
    !q3.error && !q3.report.questions.length && q3.report.totals.netCents === 6500
      && q3.report.profile?.source === 'user',
    JSON.stringify({ err: q3.error, q: q3.report.questions, profile: q3.report.profile }));

  // The unambiguous families still work without any of that.
  const dc = parseBankFile('Date,Description,Type,Amount\n'
    + '2026-01-05,COFFEE,Debit,5.00\n'
    + '2026-01-06,PAYROLL,Credit,100.00\n'
    + '2026-01-07,GROCER,Debit,20.00\n'
    + '2026-01-08,LUNCH,Debit,10.00\n');
  check('direction [Debit/Credit family imports automatically]',
    !dc.error && !dc.report.questions.length && dc.report.totals.netCents === 6500,
    JSON.stringify({ err: dc.error, q: dc.report.questions, totals: dc.report.totals }));
}

// ---- Onboarding: starter-fund suggestions + paycheck detection ----
{
  const rec = (date, vendor, amount, extra = {}) => ({
    date, vendor, amount, amountCents: Math.round(amount * 100),
    account: '', bankCategory: '', isCardPayment: false, memo: '', ...extra,
  });
  // Card-style rows: bankCategory drives the mapping.
  const s1 = suggestStarterFunds([
    rec('2026-06-05', 'KROGER #1', -100, { bankCategory: 'Grocery' }),
    rec('2026-07-05', 'KROGER #1', -120, { bankCategory: 'Grocery' }),
    rec('2026-08-05', 'PUBLIX', -80, { bankCategory: 'Grocery' }),
    rec('2026-07-09', 'CHIPOTLE', -31, { bankCategory: 'Dining' }),
    rec('2026-07-12', 'RANDOM SHOP', -47, { bankCategory: 'Merchandise' }),
    rec('2026-07-13', 'CAPITAL ONE MOBILE PYMT', -500, { isCardPayment: true }),
    rec('2026-07-14', 'Transfer to Safety Net', -50),
  ]);
  const byKey = Object.fromEntries(s1.suggestions.map((s) => [s.starterKey, s]));
  check('starter [groceries avg ÷ months, rounded up to $5]',
    byKey.groceries?.monthlyAmount === 100 && byKey.groceries.txCount === 3, JSON.stringify(byKey.groceries));
  check('starter [dining maps to eatingOut, rounds up]',
    byKey.eatingOut?.monthlyAmount === 15, JSON.stringify(byKey.eatingOut));
  check('starter [merchandise lands in everythingElse]',
    byKey.everythingElse?.monthlyAmount === 20, JSON.stringify(byKey.everythingElse));
  check('starter [card payments and transfers excluded]',
    s1.suggestions.every((s) => s.monthlyAmount < 100 || s.starterKey === 'groceries'),
    JSON.stringify(s1.suggestions));
  check('starter [no payroll rows → no paycheck]', s1.paycheck === null, JSON.stringify(s1.paycheck));

  // Checking-style: vendor keywords + a biweekly payroll cluster.
  const s2 = suggestStarterFunds([
    rec('2026-06-05', 'ACME CO PAYROLL - Deposit', 1840),
    rec('2026-06-19', 'ACME CO PAYROLL - Deposit', 1850),
    rec('2026-07-03', 'ACME CO PAYROLL - Deposit', 1845),
    rec('2026-07-17', 'ACME CO PAYROLL - Deposit', 1860),
    rec('2026-08-01', 'ACME CO PAYROLL - Deposit', 1850),
    rec('2026-07-20', 'TAX REFUND Deposit', 4000), // different cluster, 1 hit — ignored
    rec('2026-07-06', 'WAL-MART GROCER', -63),
    rec('2026-07-08', 'SHELL OIL 1234', -41),
  ]);
  check('starter [paycheck cluster median ±10%]',
    s2.paycheck && Math.abs(s2.paycheck.amount - 1850) <= 10, JSON.stringify(s2.paycheck));
  check('starter [checks/month from the last full month]',
    s2.paycheck?.perMonth === 2, JSON.stringify(s2.paycheck));
  check('starter [S10: the ACME cluster reads biweekly]',
    s2.paycheck?.cadence === 'biweekly', JSON.stringify(s2.paycheck));

  // 3-year sim S10: cadence from the gaps between deposits, count from cadence.
  const pay = (dates, amount = 610, extra = []) => suggestStarterFunds([...dates.map((d) => rec(d, 'ACME PAYROLL - Deposit', amount)), ...extra]).paycheck;
  const p8 = pay(['2026-09-18', '2026-09-25', '2026-10-02']);
  check('starter [S10: P8 weekly $610 → weekly, 4, 610]',
    p8?.cadence === 'weekly' && p8.perMonth === 4 && p8.amount === 610, JSON.stringify(p8));
  const wk = pay(['2026-09-04', '2026-09-11', '2026-09-18', '2026-10-02', '2026-10-09']); // gaps 7, 7, 14, 7
  check('starter [S10: weekly with one missed week stays weekly]',
    wk?.cadence === 'weekly' && wk.perMonth === 4, JSON.stringify(wk));
  const semi = pay(['2026-06-01', '2026-06-15', '2026-07-01', '2026-07-15', '2026-08-01', '2026-08-15'], 1500); // gaps 14, 16, 14, 17, 14
  check('starter [S10: 1st and 15th → semimonthly, 2]',
    semi?.cadence === 'semimonthly' && semi.perMonth === 2, JSON.stringify(semi));
  const semiEom = pay(['2026-06-15', '2026-06-30', '2026-07-15', '2026-07-31', '2026-08-14', '2026-08-31'], 1500); // 15th and last day, one weekend shift
  check('starter [S10: 15th and last day → semimonthly, 2]',
    semiEom?.cadence === 'semimonthly' && semiEom.perMonth === 2, JSON.stringify(semiEom));
  const mo = pay(['2026-06-01', '2026-07-01', '2026-08-01'], 3000);
  check('starter [S10: one deposit a month → monthly, 1]',
    mo?.cadence === 'monthly' && mo.perMonth === 1, JSON.stringify(mo));
  const irr = pay(['2026-06-01', '2026-06-08', '2026-06-29', '2026-08-03'], 900); // gaps 7, 21, 35
  check('starter [S10: irregular → cadence null, perMonth from the last full month (3)]',
    irr?.cadence === null && irr.perMonth === 3, JSON.stringify(irr));
  check('starter [vendor keywords map checking rows]',
    s2.suggestions.some((s) => s.starterKey === 'groceries') && s2.suggestions.some((s) => s.starterKey === 'gas'),
    JSON.stringify(s2.suggestions));

  // Per-record mapping (used by the wizard's Step 6 import).
  check('starter [starterFundFor: category first]',
    starterFundFor(rec('2026-08-05', 'ANYTHING', -5, { bankCategory: 'Dining' })) === 'eatingOut');
  check('starter [starterFundFor: memo scanned too]',
    starterFundFor(rec('2026-08-05', 'POS 1234', -5, { memo: 'NETFLIX.COM' })) === 'subscriptions');
  check('starter [starterFundFor: unknown → null]',
    starterFundFor(rec('2026-08-05', 'SOME LOCAL SHOP', -5)) === null);
}

// ================= 3-year simulation, batch 1 (S1, S2, S4, S6) =================
{
  const mk = (id, date, vendor, amount, extra = {}) => ({ id, date, vendor, amount, fund: 'x', description: '', account: '', ...extra });
  const rec = (date, vendor, amount, extra = {}) => ({ date, vendor, amount, amountCents: Math.round(amount * 100), account: '', bankCategory: '', memo: '', ...extra });
  const months = (txs) => {
    const by = {};
    for (const t of txs) (by[t.date.slice(0, 7)] ||= []).push(t);
    return Object.keys(by).sort().map((id) => ({ id, transactions: by[id] }));
  };
  // What pushImportedTx stores for a parsed record (source stamp included).
  const stored = (r, i, report) => ({ id: 'e' + i, date: r.date, vendor: r.vendor, amount: r.amount, fund: 'x',
    description: r.memo || '', account: r.account, source: 'import',
    ...(report?.externalIdTrusted && r.externalId ? { externalId: r.externalId } : {}) });
  const ANS = { answers: { dateOrder: 'MDY', signConvention: 'as-is' } };

  // ---- S1: weekly paychecks are not duplicates of last week's ----
  const PAY = 'COOL AIR MECHANICAL PAYROLL';
  const pay = mk('p1', '2027-07-09', PAY, 610, { source: 'import' });
  check('S1 [weekly $610 seven days later scores 0]', scoreDuplicate(pay, rec('2027-07-16', PAY, 610)) === 0);
  check('S1 [… and the preview matcher leaves it included]',
    findDuplicateScored(months([pay]), rec('2027-07-16', PAY, 610), new Set(), { idTrusted: false }) === null);
  check('S1 [exact +3 days is still confident]', scoreDuplicate(pay, rec('2027-07-12', PAY, 610)) === 1);
  check('S1 [exact −3 days is still confident]', scoreDuplicate(pay, rec('2027-07-06', PAY, 610)) === 1);
  check('S1 [exact +4 days is no match, not 0.6]', scoreDuplicate(pay, rec('2027-07-13', PAY, 610)) === 0);

  // The same file imported twice: every row a confident duplicate (re-imports
  // and the "month not started" catch-up loop depend on this).
  for (const file of ['01-chase-checking.csv', '57-edge-duplicate-sameday.csv']) {
    const { records, report } = parseBankFile(fs.readFileSync(path.join(FIX, file)), ANS);
    const existing = records.map((r, i) => stored(r, i, report));
    const out = matchDuplicates(months(existing), records, new Set(), { idTrusted: report.externalIdTrusted });
    check(`S1 [${file} re-imported: every row a confident duplicate]`,
      records.length > 0 && out.every((d) => d && d.score >= 0.9),
      JSON.stringify(out.map((d, i) => d ? d.score : `${records[i].date} ${records[i].vendor} ${records[i].amount}`)));
    check(`S1 [${file} re-imported: each row claims a distinct entry]`,
      new Set(out.map((d) => d?.t.id)).size === records.length);
  }

  // Two overlapping checking files (newest first, as banks write them): file 1
  // Oct 9 – Nov 6, file 2 Nov 1 – Nov 30, $610 every Friday, one Nov 4 debit
  // in both. After both imports each paycheck exists exactly once, on its date.
  const chaseFile = (rowsOldestFirst) => {
    let bal = 1000;
    const lines = rowsOldestFirst.map(([d, v, a]) => { bal += a; return [d, v, a, bal]; }).reverse()
      .map(([d, v, a, b]) => `${a > 0 ? 'CREDIT' : 'DEBIT'},${d},"${v}",${a.toFixed(2)},${a > 0 ? 'ACH_CREDIT' : 'DEBIT_CARD'},${b.toFixed(2)},,`);
    return 'Details,Posting Date,"Description",Amount,Type,Balance,Check or Slip #,\r\n' + lines.join('\r\n') + '\r\n';
  };
  const file1 = chaseFile([
    ['10/09/2026', PAY, 610], ['10/14/2026', 'WAWA 5123', -20], ['10/16/2026', PAY, 610], ['10/23/2026', PAY, 610],
    ['10/30/2026', PAY, 610], ['11/04/2026', 'PUBLIX SUPER MAR 1234', -40], ['11/06/2026', PAY, 610],
  ]);
  const file2 = chaseFile([
    ['11/04/2026', 'PUBLIX SUPER MAR 1234', -40], ['11/06/2026', PAY, 610], ['11/13/2026', PAY, 610],
    ['11/18/2026', 'WAWA 5123', -20], ['11/20/2026', PAY, 610], ['11/27/2026', PAY, 610],
  ]);
  const budget = [{ id: '2026-10', transactions: [] }, { id: '2026-11', transactions: [] }];
  const importInto = (text, label) => {
    const { records, report, error } = parseBankFile(text, ANS);
    check(`S1 [overlap: ${label} parses`, !error && records.length > 0 && !report.questions.length, error || JSON.stringify(report?.questions));
    const out = matchDuplicates(budget, records, new Set(), { idTrusted: report.externalIdTrusted });
    records.forEach((r, i) => {
      if (out[i] && out[i].score >= 0.9) return; // the preview unticks it
      budget.find((m) => m.id === r.date.slice(0, 7)).transactions.push(stored(r, label + i, report));
    });
    return { records, out };
  };
  const first = importInto(file1, 'file 1');
  check('S1 [overlap: file 1 into an empty budget — nothing matches]', first.out.every((d) => d === null));
  const second = importInto(file2, 'file 2');
  const dupDates = second.records.filter((r, i) => second.out[i]?.score >= 0.9).map((r) => r.date).sort();
  check('S1 [overlap: file 2 — only the Nov 4 debit and the Nov 6 check are duplicates]',
    JSON.stringify(dupDates) === JSON.stringify(['2026-11-04', '2026-11-06']),
    JSON.stringify(second.out.map((d, i) => `${second.records[i].date} → ${d ? d.score : 'new'}`)));
  const checks = budget.flatMap((m) => m.transactions).filter((t) => t.vendor === PAY).map((t) => t.date).sort();
  check('S1 [overlap: each of the 8 Fridays exists exactly once, on its own date]',
    JSON.stringify(checks) === JSON.stringify(['2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30', '2026-11-06', '2026-11-13', '2026-11-20', '2026-11-27']),
    JSON.stringify(checks));
  check('S1 [overlap: the shared Nov 4 debit exists once]',
    budget[1].transactions.filter((t) => t.date === '2026-11-04').length === 1);

  // Claims are best-first across the file, not in file order: with a file
  // listed newest first, the row 2 days off must not steal the twin of the
  // same-date row listed after it.
  const wawa = mk('w1', '2026-11-04', 'WAWA 5123', -20, { source: 'import' });
  const bf = matchDuplicates(months([wawa]), [rec('2026-11-06', 'WAWA 5123', -20), rec('2026-11-04', 'WAWA 5123', -20)], new Set(), {});
  check('S1 [best-first: the same-date row claims the twin, the earlier-listed row stays new]',
    bf[0] === null && bf[1]?.t.id === 'w1' && bf[1].score === 1, JSON.stringify(bf.map((d) => d?.score ?? null)));
  // …and confident matches are assigned before possible ones, whatever the order.
  const grill = mk('g1', '2026-11-04', 'JOES GRILL', -40, { source: 'import' });
  const tiers = matchDuplicates(months([grill]), [rec('2026-11-06', 'JOES GRILL', -42), rec('2026-11-04', 'JOES GRILL', -40)], new Set(), {});
  check('S1 [confident matches are assigned before possible ones]',
    tiers[0] === null && tiers[1]?.score === 1, JSON.stringify(tiers.map((d) => d?.score ?? null)));
  check('S1 [each existing transaction is claimed at most once (Inv. 12)]',
    (() => { const c = new Set(); const o = matchDuplicates(months([grill]), [rec('2026-11-04', 'JOES GRILL', -40), rec('2026-11-04', 'JOES GRILL', -40)], c, {});
      return o.filter(Boolean).length === 1 && c.size === 1; })());

  // ---- S6: near-equal amounts are possible, never confident ----
  const tgt = mk('t1', '2028-11-26', 'TARGET 00012345', -45.18, { source: 'import' });
  const d6 = findDuplicateScored(months([tgt]), rec('2028-12-03', 'TARGET 00012345', -45.13), new Set(), {});
  check('S6 [TARGET 45.18 vs 45.13 a week later → possible (0.6), stays included]', !!d6 && d6.score === 0.6);
  const wal = mk('t2', '2029-05-10', 'WALMART.COM 8009256278', -73.63, { source: 'import', account: '9811' });
  check('S6 [WALMART 73.63 vs 73.71 six days later → possible]',
    scoreDuplicate(wal, rec('2029-05-16', 'WALMART.COM 8009256278', -73.71, { account: '9811' })) === 0.6);
  check('S6 [same cents same vendor same day is still 1.0]', scoreDuplicate(tgt, rec('2028-11-26', 'TARGET 00012345', -45.18)) === 1);

  // ---- S4: a typed entry and its bank line ----
  const typed = mk('h1', '2028-03-14', 'Hospital deposit', -250); // no source stamp = typed by hand
  const LRH = 'LAKELAND REGIONAL HEALTH';
  const d4 = findDuplicateScored(months([typed]), rec('2028-03-14', LRH, -250), new Set(), {});
  check('S4 [typed −250 on 03-14 vs bank −250 on 03-14, other vendor → 0.6, flagged typed]',
    !!d4 && d4.score === 0.6 && d4.typed === true && d4.t.id === 'h1', JSON.stringify(d4));
  check('S4 [… at +3 days too]', scoreDuplicate(typed, rec('2028-03-17', LRH, -250)) === 0.6);
  check('S4 [… at −3 days too]', scoreDuplicate(typed, rec('2028-03-11', LRH, -250)) === 0.6);
  check('S4 [… but not at +4 days]', scoreDuplicate(typed, rec('2028-03-18', LRH, -250)) === 0);
  check('S4 [… not when the cents differ]', scoreDuplicate(typed, rec('2028-03-14', LRH, -250.01)) === 0);
  check('S4 [… not when the sign differs]', scoreDuplicate(typed, rec('2028-03-14', LRH, 250)) === 0);
  check('S4 [not for an imported row (source stamp)]', scoreDuplicate({ ...typed, source: 'import' }, rec('2028-03-14', LRH, -250)) === 0);
  check('S4 [not for a row with a bank id]', scoreDuplicate({ ...typed, externalId: 'X1' }, rec('2028-03-14', LRH, -250)) === 0);
  check('S4 [not for a transfer leg (flag)]',
    scoreDuplicate(mk('tr', '2028-03-14', 'Transfer to Baby', -250, { isTransfer: true }), rec('2028-03-14', LRH, -250)) === 0);
  check('S4 [not for a transfer leg (vendor text only)]',
    scoreDuplicate(mk('tr2', '2028-03-14', 'Transfer from Savings', 250), rec('2028-03-14', 'ACME PAYROLL', 250)) === 0);
  check('S4 [typed entry with the same vendor and cents is still confident]',
    scoreDuplicate(typed, rec('2028-03-14', 'Hospital deposit', -250)) === 1);
  check('S4 [typed flag is only set by the cross-vendor rule]',
    findDuplicateScored(months([mk('g2', '2028-03-14', 'JOES GRILL', -40)]), rec('2028-03-16', 'JOES GRILL', -42), new Set(), {})?.typed === false);
  // Control: two imported $5.00 coffees at different shops the same day stay two transactions.
  const cafe = mk('c1', '2028-03-14', 'BLUE BOTTLE COFFEE', -5, { source: 'import' });
  const d4c = matchDuplicates(months([cafe]), [rec('2028-03-14', 'STARBUCKS 1234', -5)], new Set(), {});
  check('S4 [control: two imported $5 coffees at different shops → no match]', d4c[0] === null);
  // A typed card payment and the checking line that paid it: the row is a card
  // payment (unticked) AND a typed twin — both badges, nothing counted twice.
  const typedPay = mk('cp', '2026-11-15', 'Chase card payment', -612);
  const payRec = parseBankFile('Details,Posting Date,"Description",Amount,Type,Balance,Check or Slip #,\r\n'
    + 'DEBIT,11/15/2026,"Payment to Chase card ending in 4471 11/15",-612.00,LOAN_PMT,1388.00,,\r\n'
    + 'DEBIT,11/13/2026,"PUBLIX SUPER MAR 1234",-62.00,DEBIT_CARD,2000.00,,\r\n'
    + 'CREDIT,11/06/2026,"BRIGHT SMILES DENTAL PAYROLL",1205.00,ACH_CREDIT,2062.00,,\r\n', ANS).records;
  const d4p = matchDuplicates(months([typedPay]), payRec, new Set(), {});
  check('S4 [typed $612 card payment vs "Payment to Chase card ending in 4471" → typed twin + card payment]',
    d4p[0]?.typed === true && d4p[0].score === 0.6 && payRec[0].isCardPayment === true, JSON.stringify([d4p[0], payRec[0]?.isCardPayment]));

  // ---- S2: card payments from checking, through BOTH parsers ----
  const viaImport = (v) => parseBankFile(`Date,Description,Amount\n06/03/2028,${v},-100.00\n06/04/2028,WAWA 5123,-20.00\n06/05/2028,PAYROLL,900.00\n06/21/2028,PUBLIX,-30.00\n`, ANS).records[0]?.isCardPayment;
  const viaLegacy = (v) => parseBankCsv(`Account Number,Transaction Description,Transaction Date,Transaction Type,Transaction Amount,Balance\n1234,${v},06/03/2028,Debit,100.00,900.00\n`)[0]?.isCardPayment;
  const yes = [
    'Payment to Chase card ending in 4471 11/15', 'CHASE CREDIT CRD AUTOPAY', 'CHASE CREDIT CRD EPAY',
    'ACH DEBIT CAPITAL ONE CRCARDPMT 1872', 'DISCOVER E-PAYMENT', 'AMEX EPAYMENT ACH PMT', 'CITI AUTOPAY PAYMENT',
    'CARDMEMBER SERV WEB PYMT',
    // true before this change, must stay true
    'PAYMENT THANK YOU-MOBILE', 'CAPITAL ONE MOBILE PYMT', 'CAPITAL ONE ONLINE PMT', 'ONLINE PYMT 4471', 'AUTOPAY PYMT',
  ];
  const no = ['PAYMENT TO CITY WATER', 'FPL DIRECT DEBIT ELEC PYMT', 'PUBLIX SUPER MAR 1234', 'CHASE SAPPHIRE ANNUAL FEE', 'DISCOVER SAVINGS DEPOSIT', 'AMEX MEMBERSHIP FEE'];
  for (const v of yes) {
    check(`S2 [card payment via import.js: ${v}]`, viaImport(v) === true);
    check(`S2 [card payment via legacy csv.js: ${v}]`, viaLegacy(v) === true);
  }
  for (const v of no) {
    check(`S2 [not a card payment via import.js: ${v}]`, viaImport(v) === false);
    check(`S2 [not a card payment via legacy csv.js: ${v}]`, viaLegacy(v) === false);
  }
}

console.log(`\nCSV importer: ${pass} passed, ${fail} failed`);
if (failures.length) { console.log('\nFailures:'); for (const f of failures) console.log('  ✗ ' + f); }
process.exit(fail ? 1 : 0);
