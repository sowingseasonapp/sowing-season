// Stage 4: assign a role to every column. Named headers are matched against a
// synonym table and then sanity-checked against the column's data shape; a
// headerless file falls back to per-column likelihood scoring.
import { norm } from './structure.js';
import { stripAmount, parseAmountColumn } from './values.js';

// Role vocabulary (a working subset of Firefly III's):
//   date datePosted desc memo amount debit credit direction balance
//   id check category account ignore

const DATE_NAMES = /^(date|transactiondate|transdate|trandate|rundate|bookingdate|valuedate|valutadatum|buchungstag|datum|effectivedate|completeddate|settlementdate|settledate|originationdate|fecha)/;
const DATE2_NAMES = /^(postdate|postingdate|posteddate|cleardate|clearingdate)/;
const DESC_NAMES = /^(description|payee|merchant|narrative|particulars|transactiondescription|originaldescription|securitydescription|counterparty|title|verwendungszweck|omschrijving|libelle|name$)/;
const MEMO_NAMES = /^(memo|comments|notes|extendeddetails|note)/;
const DEBIT_NAMES = /^(debit|debits|withdrawal|withdrawals|outflow|moneyout|paidout|soll)$/;
const CREDIT_NAMES = /^(credit|credits|deposit|deposits|inflow|moneyin|paidin|haben)$/;
const AMOUNT_NAMES = /^(amount|amountusd|transactionamount|value$|gross|net$|betrag|importe|montant|bedrag|kwota|originalamount)/;
const BAL_NAMES = /^(balance|runningbal|runningbalance|currentbalance|dailybalance|daily$|ledgerbalance|saldo|endingbalance)/;
const ID_NAMES = /^(transactionid|fitid|referencenumber|reference$|externalid|id$|uniqueid|confirmationnumber)/;
const CHECK_NAMES = /^(check$|checknumber|chequenumber|checkorslip|num$)/;
const DIR_NAMES = /^(type$|transactiontype|creditdebit|debitcredit|direction|status)$/;
const CAT_NAMES = /^(category|tags|categoryname)/;
const ACCT_NAMES = /^(account$|accountnumber|accountname|cardno|card$|auftragskonto)/;

// Values that make a text column a direction indicator. Which token means
// which side is NOT hardcoded — the corpus has banks using both assignments.
export const DIRECTION_TOKENS = /^(debit|credit|withdrawal|deposit|dr|cr|d|c|w|dep|out|in|outflow|inflow|af|bij|soll|haben|debit_card|ach_credit|ach_debit|check|sale|payment|return|purchase|pos)$/i;

// The only tokens with a DEFAULT direction: the debit/credit and
// withdrawal/deposit families, whose meaning doesn't vary by bank. Everything
// else (af/bij, sale/payment, check…) must be pinned by the balance column, a
// profile, or the user — §5.4's rule that token meaning is data, not code.
export const OUT_TOKENS = /^(debit|debits|withdrawal|withdrawals|dr|d|db|w|out|outflow|debit_card|ach_debit)$/i;
export const IN_TOKENS = /^(credit|credits|deposit|deposits|cr|c|dep|in|inflow|ach_credit)$/i;

const RUN = { date: DATE_NAMES, datePosted: DATE2_NAMES, balance: BAL_NAMES, debit: DEBIT_NAMES,
  credit: CREDIT_NAMES, amount: AMOUNT_NAMES, check: CHECK_NAMES, id: ID_NAMES, category: CAT_NAMES,
  memo: MEMO_NAMES, desc: DESC_NAMES, direction: DIR_NAMES, account: ACCT_NAMES };

export function assignRoles(header, sample) {
  const roles = header.map(() => 'ignore');
  const names = header.map((h) => norm(h));
  const colVals = (i) => sample.map((r) => String(r[i] ?? '')).filter((v) => v.trim() !== '');
  const numericFrac = (i) => {
    const v = colVals(i);
    return v.length ? v.filter((x) => { const s = stripAmount(x); return !s.bad && !s.empty; }).length / v.length : 0;
  };
  const dateFrac = (i) => {
    const v = colVals(i);
    return v.length
      ? v.filter((x) => /^\s*(\d{1,4}[/.\-]\d{1,2}[/.\-]\d{1,4}|\d{8}$|\d{5}(\.\d+)?$)/.test(x)).length / v.length : 0;
  };

  for (let i = 0; i < header.length; i++) {
    const h = names[i];
    if (!h) continue;
    for (const [role, re] of Object.entries(RUN)) {
      if (!re.test(h)) continue;
      // Resolve name/data conflicts by data shape: a "Description" column that
      // is all dates is a date column, and a date-named column of prose isn't.
      if ((role === 'date' || role === 'datePosted') && dateFrac(i) <= 0.5) continue;
      if (role === 'amount' && numericFrac(i) <= 0.5) continue;
      // …and an empty desc-named column (Fidelity's "Security Description" on
      // cash rows) must not shadow the column that actually holds the payee.
      if (role === 'desc' && !colVals(i).some((v) => /[A-Za-z]/.test(v))) continue;
      roles[i] = role;
      break;
    }
  }

  // A desc-named column whose values are direction tokens (Chase's "Details"
  // holding DEBIT/CREDIT) is a direction column, not a description.
  for (let i = 0; i < roles.length; i++) {
    if (roles[i] !== 'desc') continue;
    const v = colVals(i);
    if (v.length && v.filter((x) => DIRECTION_TOKENS.test(x.trim())).length / v.length >= 0.9) roles[i] = 'direction';
  }

  // A signed Amount alongside a Money Out / Money In pair: the signed column
  // is authoritative, the split pair is a rendering of it.
  if (roles.includes('amount') && roles.includes('debit') && roles.includes('credit')) {
    roles.forEach((r, i) => { if (r === 'debit' || r === 'credit') roles[i] = 'ignore'; });
  }

  // Fall back on data shape for anything essential the names didn't give us.
  if (!roles.includes('date')) {
    let best = -1, bs = 0;
    for (let i = 0; i < header.length; i++) {
      if (roles[i] !== 'ignore') continue;
      const f = dateFrac(i);
      if (f > bs) { bs = f; best = i; }
    }
    if (bs > 0.8) roles[best] = 'date';
  }
  if (!roles.includes('amount') && !roles.includes('debit') && !roles.includes('credit')) {
    let best = -1, bs = 0;
    for (let i = 0; i < header.length; i++) {
      if (roles[i] !== 'ignore') continue;
      const f = numericFrac(i);
      if (f > bs) { bs = f; best = i; }
    }
    if (bs > 0.8) roles[best] = 'amount';
  }
  if (!roles.includes('desc')) {
    for (let i = 0; i < header.length; i++) {
      if (roles[i] !== 'ignore' && roles[i] !== 'memo') continue;
      if (colVals(i).some((v) => /[A-Za-z]{3}/.test(v))) { roles[i] = 'desc'; break; }
    }
  }
  return roles;
}

/* ---------------- headerless files ---------------- */

// Mutually-exclusive numeric pair = a debit/credit split (proposal §5.4).
// Handles the "literal 0 filler" case (0 counts as absent) and resolves which
// side is the outflow from a running balance when one exists.
export function findAmountPair(sample, skip = new Set()) {
  const width = Math.max(...sample.map((r) => r.length));
  const cents = [];
  for (let i = 0; i < width; i++) {
    if (skip.has(i)) { cents.push(null); continue; }
    const parsed = parseAmountColumn(sample.map((r) => r[i] ?? ''), '.');
    const ok = parsed.filter((v) => v != null && !Number.isNaN(v)).length / parsed.length;
    cents.push(ok >= 0.9 ? parsed : null);
  }
  const present = (v) => v != null && !Number.isNaN(v) && v !== 0;
  const numeric = cents.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);

  const pairs = [];
  for (const i of numeric) {
    for (const j of numeric) {
      if (i >= j) continue;
      let excl = 0, iN = 0, jN = 0;
      for (let k = 0; k < sample.length; k++) {
        const a = present(cents[i][k]), b = present(cents[j][k]);
        if (a !== b) excl++;
        if (a) iN++;
        if (b) jN++;
      }
      // Both sides must carry real data, or a constant column pairs with anything.
      if (excl / sample.length >= 0.95 && iN >= sample.length * 0.15 && jN >= sample.length * 0.15) pairs.push({ i, j });
    }
  }
  if (!pairs.length) return null;

  for (const { i, j } of pairs) {
    for (const b of numeric) {
      if (b === i || b === j) continue;
      let fwd = 0, rev = 0, tested = 0;
      for (let k = 1; k < sample.length; k++) {
        const delta = cents[b][k] - cents[b][k - 1];
        if (!Number.isFinite(delta)) continue;
        const vi = present(cents[i][k]) ? Math.abs(cents[i][k]) : 0;
        const vj = present(cents[j][k]) ? Math.abs(cents[j][k]) : 0;
        tested++;
        if (delta === vj - vi) fwd++; // i pays out, j pays in
        if (delta === vi - vj) rev++;
      }
      if (tested >= 2 && fwd / tested >= 0.9) return { debit: i, credit: j, balance: b };
      if (tested >= 2 && rev / tested >= 0.9) return { debit: j, credit: i, balance: b };
    }
  }
  return { debit: pairs[0].i, credit: pairs[0].j, balance: null, unresolved: true };
}

const dateLikelihood = (s) => {
  let k = 0;
  if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(s)) k += 10;
  if (/^[-/.\d:]+$/.test(s)) k += 5;
  const digits = s.replace(/[^-/.\d:]/g, '').length;
  if (digits > 3) k += digits;
  k -= s.replace(/[-/.\d:]/g, '').length;
  if (/^\d+[:/.-]\d+[:/.-]\d+$/.test(s)) k += 30;
  return k;
};
const moneyLikelihood = (s) => {
  let k = 0;
  if (/\d+[,.]\d{2}[^\d]*$/.test(s)) k += 40;
  if (s.length < 7) k += s.replace(/[^\d.\-+,()]/g, '').length;
  if (s.length > 12) k -= s.length;
  if (s.length && !/^[$+.\-,\d()]+$/.test(s)) k -= 20;
  return k;
};

export function positionalRoles(sample) {
  const width = Math.max(...sample.map((r) => r.length));
  const roles = Array.from({ length: width }, () => 'ignore');
  const argmax = (f, skip = new Set()) => {
    let best = -1, bs = -Infinity;
    for (let i = 0; i < width; i++) {
      if (skip.has(i)) continue;
      const s = sample.reduce((a, r) => a + f(String(r[i] ?? '')), 0);
      if (s > bs) { bs = s; best = i; }
    }
    return best;
  };
  const di = argmax(dateLikelihood);
  if (di >= 0) roles[di] = 'date';

  const pair = findAmountPair(sample, new Set([di]));
  if (pair && !pair.unresolved) {
    roles[pair.debit] = 'debit';
    roles[pair.credit] = 'credit';
    if (pair.balance != null) roles[pair.balance] = 'balance';
  } else {
    const mi = argmax(moneyLikelihood, new Set([di]));
    if (mi >= 0) roles[mi] = 'amount';
  }

  // Description: the remaining column with the most letters in it.
  let best = -1, bs = -1;
  for (let i = 0; i < width; i++) {
    if (roles[i] !== 'ignore') continue;
    const s = sample.reduce((a, r) => a + (/[A-Za-z]{3}/.test(String(r[i] ?? '')) ? String(r[i]).length : 0), 0);
    if (s > bs) { bs = s; best = i; }
  }
  if (best >= 0 && bs > 0) roles[best] = 'desc';
  return roles;
}
