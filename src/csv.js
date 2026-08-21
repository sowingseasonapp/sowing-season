// Bank CSV parsing (Capital One export format) + auto-categorization.
// parseBankFile is the bank-agnostic pipeline (src/csv/) — it infers the
// format, refuses what it can't read safely, and asks instead of guessing.
import { normFund } from './compute.js';
export { parseBankFile } from './csv/import.js';

// Minimal RFC-4180 CSV parser (handles quoted fields, embedded commas/quotes).
// A quote only opens a field at field start, and only closes when followed
// (past optional spaces) by a comma, newline or EOF — so a bare quote in an
// unquoted description (`LOWES 5" PVC`) stays literal instead of swallowing
// the rest of the line.
export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // Excel adds a UTF-8 BOM
  const rows = [];
  let row = [], field = '', i = 0;
  const L = text.length;
  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); if (row.some((f) => f.trim() !== '')) rows.push(row); row = []; };
  while (i < L) {
    if (field === '') { // tolerate spaces before an opening quote
      let j = i;
      while (j < L && (text[j] === ' ' || text[j] === '\t')) j++;
      if (text[j] === '"') i = j;
    }
    if (field === '' && text[i] === '"') {
      i++;
      for (;;) {
        if (i >= L) break; // unterminated quote: close the field at EOF
        if (text[i] === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          let k = i + 1;
          while (k < L && (text[k] === ' ' || text[k] === '\t')) k++;
          const c = text[k];
          if (c === undefined || c === ',' || c === '\n' || c === '\r') { i = k; break; }
          field += '"'; i++; continue; // stray quote inside a quoted field: keep it
        }
        field += text[i++];
      }
    } else {
      const start = i;
      while (i < L && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') i++;
      field += text.slice(start, i);
    }
    if (i >= L) break;
    if (text[i] === ',') { endField(); i++; continue; }
    if (text[i] === '\r') { i += text[i + 1] === '\n' ? 2 : 1; endRow(); continue; }
    if (text[i] === '\n') { i++; endRow(); continue; }
  }
  if (field !== '' || row.length) endRow();
  return rows;
}

// A row that is a credit-card payment (either side: the card statement's credit,
// or the checking account's withdrawal that funded it) — not a budget expense.
function isCardPaymentRow(vendor, bankCategory) {
  return /payment\/credit/i.test(bankCategory)
    || /online pymt|autopay pymt|payment thank you/i.test(vendor)
    || /capital one.*\b(mobile|online|autopay)?\s*(pymt|pmt)\b/i.test(vendor);
}

// Amount cell → integer cents, null for an empty/non-numeric cell, or NaN for a
// value that cannot be trusted. Cents are exact (BigInt path) — floats only ever
// appear at the record boundary, where `amount` stays dollars for app.js.
// The step order is load-bearing: DR/CR and the trailing minus must be handled
// before letters are stripped, or `1,234.56 DR` silently flips to a credit.
function parseCents(raw) {
  if (raw == null) return null;
  let s = String(raw).replace(/﻿/g, '').trim(); // mid-file BOMs from concatenated exports
  if (s === '') return null;
  if (!/\d/.test(s)) return null; // letters-only cell: treat as empty, like before
  let neg = false;
  s = s.replace(/[−‒–—―﹣－]/g, '-'); // unicode minus family
  if (/^\(.*\)$/.test(s)) { neg = !neg; s = s.slice(1, -1).trim(); }
  if (/(^|\s)(DR|D)\s*$/i.test(s)) { neg = !neg; s = s.replace(/(^|\s)(DR|D)\s*$/i, ''); }
  else if (/(^|\s)(CR|C)\s*$/i.test(s)) { s = s.replace(/(^|\s)(CR|C)\s*$/i, ''); }
  if (/-\s*$/.test(s)) { neg = !neg; s = s.replace(/-\s*$/, ''); }
  s = s.replace(/^([^\d]*)-/, (_, pre) => { neg = !neg; return pre; });
  s = s.replace(/[\p{Letter}\p{Currency_Symbol}]/gu, '');
  s = s.replace(/[\s  ]/g, '').replace(/['’_+]/g, '');
  if (s === '' || !/^[\d.,]+$/.test(s)) return NaN;
  // US format only here: dot decimal, comma grouping. A decimal comma or any
  // malformed grouping is refused (row error) — never misread by ~1000×.
  if (s.includes(',') && !/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return NaN;
  const m = s.replace(/,/g, '').match(/^(\d*)(?:\.(\d*))?$/);
  if (!m || (!m[1] && !m[2])) return NaN;
  const frac = (m[2] || '').padEnd(2, '0');
  let v = BigInt(m[1] || '0') * 100n + BigInt(frac.slice(0, 2));
  if (frac.length > 2 && Number(frac[2]) >= 5) v += 1n; // half-up on 3+ decimals
  const cents = Number(v);
  return neg ? -cents : cents;
}

// Returns [{date, vendor, amount, amountCents, account, bankCategory, isCardPayment}]
// or throws. `amount` stays dollars (the app's stored shape); `amountCents` is the
// exact integer the amount was parsed as. Rows that can't be read are collected on
// the returned array as `.anomalies` [{row, code, msg}] instead of silently
// vanishing or importing as $0.
// Auto-detects the export format:
//  A) credit card:  Transaction Date, Posted Date, Card No., Description, Category, Debit, Credit
//  B) checking:     Account Number, Transaction Description, Transaction Date, Transaction Type, Transaction Amount, Balance
export function parseBankCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('The file is empty.');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => header.findIndex((h) => h === name.toLowerCase());
  const out = [];
  const anomalies = [];
  out.anomalies = anomalies;
  // Row numbers are 1-based counting the header; blank lines were already dropped.
  const bad = (k, code, msg) => anomalies.push({ row: k + 2, code, msg });

  // Format B: checking account (single amount column + Debit/Credit type)
  if (col('Transaction Type') >= 0 && col('Transaction Amount') >= 0) {
    const iDate = col('Transaction Date'), iDesc = col('Transaction Description'),
      iType = col('Transaction Type'), iAmt = col('Transaction Amount'),
      iAcct = col('Account Number');
    if (iDate < 0 || iDesc < 0) {
      throw new Error('This checking-account CSV is missing expected columns (Transaction Date, Transaction Description).');
    }
    rows.slice(1).forEach((r, k) => {
      const rawDate = (r[iDate] || '').trim();
      const cents = parseCents(r[iAmt]);
      if (!rawDate && !cents) return; // spacer row
      const date = rawDate ? normalizeDate(rawDate) : null;
      if (!date) { bad(k, 'BadDate', rawDate || '(empty)'); return; }
      if (Number.isNaN(cents)) { bad(k, 'BadAmount', String(r[iAmt]).trim()); return; }
      if (!cents) return; // zero/empty amount: skipped, as before
      const vendor = (r[iDesc] || '').trim();
      const isDebit = /^debit$/i.test((r[iType] || '').trim());
      const signed = isDebit ? -cents : cents;
      out.push({
        date,
        vendor,
        amount: signed / 100,
        amountCents: signed,
        account: iAcct >= 0 ? (r[iAcct] || '').trim() : '',
        bankCategory: '',
        isCardPayment: isCardPaymentRow(vendor, ''),
      });
    });
    return out;
  }

  // Format A: credit card (separate Debit / Credit columns)
  const iDate = col('Transaction Date'), iDesc = col('Description'),
    iCat = col('Category'), iDebit = col('Debit'), iCredit = col('Credit'),
    iCard = col('Card No.');
  if (iDate < 0 || iDesc < 0 || iDebit < 0 || iCredit < 0) {
    throw new Error('This does not look like a supported bank CSV export (expected either the credit-card format with Debit/Credit columns, or the checking format with Transaction Type/Amount).');
  }
  rows.slice(1).forEach((r, k) => {
    const rawDate = (r[iDate] || '').trim();
    const debit = parseCents(r[iDebit]);
    const credit = parseCents(r[iCredit]);
    if (!rawDate && !debit && !credit) return; // spacer row
    const date = rawDate ? normalizeDate(rawDate) : null;
    if (!date) { bad(k, 'BadDate', rawDate || '(empty)'); return; }
    if (Number.isNaN(debit) || Number.isNaN(credit)) {
      bad(k, 'BadAmount', String(Number.isNaN(debit) ? r[iDebit] : r[iCredit]).trim());
      return;
    }
    if (!debit && !credit) return;
    const vendor = (r[iDesc] || '').trim();
    const bankCategory = iCat >= 0 ? (r[iCat] || '').trim() : '';
    out.push({
      date,
      vendor,
      amount: debit ? -debit / 100 : credit / 100,
      amountCents: debit ? -debit : credit,
      account: iCard >= 0 ? (r[iCard] || '').trim() : '',
      bankCategory,
      isCardPayment: isCardPaymentRow(vendor, bankCategory),
    });
  });
  return out;
}

// Two-digit years: sliding window ending next year (statements are historical,
// post-dated up to +1y is allowed), so `98` is 1998, not 2098.
function expandYear(yy, today = new Date()) {
  const cy = today.getUTCFullYear();
  let y = Math.floor(cy / 100) * 100 + yy;
  if (y > cy + 1) y -= 100;
  return y;
}

// Returns YYYY-MM-DD, or null when the value isn't a date the app can trust —
// never the raw string (a passthrough made whole files vanish downstream).
function normalizeDate(s) {
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let y = Number(m[3]); if (y < 100) y = expandYear(y);
    const mo = Number(m[1]), d = Number(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}

// Strip store numbers / order codes so "AMAZON MKTPL*PK1T50MD3" ≈ "AMAZON MKTPL*GZ7OJ0KL3".
// Accents are folded first (§8.4): if one import decoded "Café" correctly and
// another didn't, an un-normalised key would see two vendors and double them.
export function normVendor(s) {
  return String(s || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[*#]\S*/g, ' ')       // *ORDERCODE, #617
    .replace(/\b\d{3,}\b/g, ' ')    // long numbers (store/phone ids)
    .replace(/[^A-Z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Checking-account descriptions can carry a free-text memo prefix
// ("I love you kiddo - Withdrawal to Sophias Account ..."). The stable,
// matchable part is what follows the memo.
function afterMemo(vendor) {
  const i = String(vendor).indexOf(' - ');
  return i >= 0 ? vendor.slice(i + 3) : null;
}

// Learn vendor → fund from all existing transactions. Most frequent fund wins.
export function buildVendorMap(months) {
  const counts = new Map(); // normVendor -> Map(normFund -> {n, fund})
  const bump = (vendor, fund) => {
    const v = normVendor(vendor);
    if (!v) return;
    if (!counts.has(v)) counts.set(v, new Map());
    const per = counts.get(v);
    const k = normFund(fund);
    const e = per.get(k) || { n: 0, fund };
    e.n++;
    per.set(k, e);
  };
  for (const m of months) {
    for (const t of m.transactions) {
      if (!t.vendor || !t.fund) continue;
      bump(t.vendor, t.fund);
      const rest = afterMemo(t.vendor);
      if (rest) bump(rest, t.fund); // index the memo-stripped form too
    }
  }
  const map = new Map();
  for (const [v, per] of counts) {
    let best = null;
    for (const e of per.values()) if (!best || e.n > best.n) best = e;
    if (best) map.set(v, { fund: best.fund, n: best.n });
  }
  return map;
}

export function suggestFund(vendorMap, vendor) {
  const candidates = [vendor, afterMemo(vendor)].filter(Boolean);
  for (const cand of candidates) {
    const v = normVendor(cand);
    if (v && vendorMap.has(v)) return vendorMap.get(v);
  }
  // Fallback: prefix match (e.g. "AMAZON RETA" vs "AMAZON RETAIL")
  for (const cand of candidates) {
    const v = normVendor(cand);
    if (!v) continue;
    for (const [key, val] of vendorMap) {
      if (key.startsWith(v) || v.startsWith(key)) return val;
    }
  }
  return null;
}

/* ---------------- Duplicate detection (scored, §8) ---------------- */

// Vendors where the posted amount routinely differs from what was authorised:
// restaurants add a tip, gas pumps replace the pre-auth hold.
const TIP_OR_FUEL = /\b(restaurants?|grill|cafe|caffe|coffee|espresso|pizz(a|eria)|sushi|taco|burger|burrito|wings?|bbq|barbecue|steak(house)?|diner|deli|bistro|brewer(y|ies)|brewhouse|taphouse|bar|pub|cantina|kitchen|cocina|thai|pho|ramen|doordash|uber\s?eats|grubhub|postmates|shell|chevron|exxon|mobil|texaco|marathon|sunoco|valero|conoco|phillips\s?66|circle\s?k|speedway|quiktrip|racetrac|wawa|sheetz|caseys?|maverik|pilot|arco|fuel|gas\s?station)\b/i;
const DAY = 86400000;

// Score how likely `rec` (a CSV row) is a re-import of `t` (a stored
// transaction). 0 = no match; 1.0 exact; 0.9 near-exact (rounding); 0.6 the
// tip/pump-hold pattern. The date window is asymmetric (−3…+7 days): pending
// appears BEFORE posted, so a CSV row posts up to a week after the entry the
// user typed, but rarely precedes it.
export function scoreDuplicate(t, rec, { idTrusted = false } = {}) {
  if (!t.date || !rec.date) return 0;
  const tAcct = String(t.account || '').trim(), rAcct = String(rec.account || '').trim();
  if (tAcct && rAcct && tAcct !== rAcct) return 0; // the same $50 on two cards is two transactions (§8.2)
  const tId = String(t.externalId || '').trim(), rId = String(rec.externalId || '').trim();
  if (idTrusted && tId && rId) return tId === rId ? 1 : 0; // bank IDs are exact, not heuristic (§8.1)
  const lagDays = (Date.parse(rec.date) - Date.parse(t.date)) / DAY;
  if (lagDays < -3 || lagDays > 7) return 0;
  const tv = normVendor(t.vendor);
  if (!tv || (tv !== normVendor(rec.vendor) && (!rec.memo || tv !== normVendor(rec.memo)))) return 0;
  const a = Math.round(t.amount * 100);
  const b = Number.isFinite(rec.amountCents) ? rec.amountCents : Math.round(rec.amount * 100);
  const diff = Math.abs(a - b), mag = Math.max(Math.abs(a), Math.abs(b));
  if (diff === 0) return 1;
  if (diff <= 2 || diff <= mag * 0.005) return 0.9;
  const largerIsLater = lagDays === 0 || (lagDays > 0) === (Math.abs(b) >= Math.abs(a));
  const tippable = TIP_OR_FUEL.test(rec.vendor || '') || TIP_OR_FUEL.test(rec.memo || '')
    || TIP_OR_FUEL.test(t.vendor || '') || /dining|restaurant|food|gas|fuel/i.test(rec.bankCategory || '');
  if (diff <= mag * 0.05 && largerIsLater && tippable) return 0.6;
  return 0;
}

// Best-scoring unclaimed transaction at or above minScore, or null. Claims the
// match: each existing transaction can claim only ONE csv row — the shared
// `claimed` Set preserves multiplicity (three identical coffees dedupe as
// three, not one).
function bestDuplicate(months, rec, claimed, minScore, opts) {
  let best = null, bestScore = 0;
  outer: for (const m of months) {
    for (const t of m.transactions) {
      if (claimed.has(t.id)) continue;
      const s = scoreDuplicate(t, rec, opts);
      if (s > bestScore) { best = t; bestScore = s; if (s === 1) break outer; }
    }
  }
  if (!best || bestScore < minScore) return null;
  claimed.add(best.id);
  return { t: best, score: bestScore };
}

// Preview matcher: ≥0.9 auto-marks as a duplicate, 0.6–0.9 is a "possible
// duplicate" the user reviews. Nothing is ever silently dropped.
export function findDuplicateScored(months, rec, claimed, opts) {
  return bestDuplicate(months, rec, claimed, 0.6, opts);
}

// Legacy surface (the onboarding wizard calls this): a duplicate is only a
// CONFIDENT scored match (≥0.9) — what the preview would auto-mark.
export function findDuplicate(months, rec, claimed) {
  return bestDuplicate(months, rec, claimed, 0.9)?.t ?? null;
}
