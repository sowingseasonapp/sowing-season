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
export function normVendor(s) {
  return String(s || '')
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

// Duplicate detection: same amount + same vendor (normalized) + date within ±4 days.
// (Manual entries often use the posted date, 1–2 days after the transaction date.)
// Each existing transaction can only claim ONE csv row — pass a shared `claimed` Set.
export function findDuplicate(months, rec, claimed) {
  const recTime = Date.parse(rec.date);
  const rv = normVendor(rec.vendor);
  for (const m of months) {
    for (const t of m.transactions) {
      if (claimed.has(t.id)) continue;
      if (!t.date || Math.abs(t.amount - rec.amount) >= 0.005) continue;
      if (Math.abs(Date.parse(t.date) - recTime) > 4 * 86400000) continue;
      if (normVendor(t.vendor) !== rv) continue;
      claimed.add(t.id);
      return t;
    }
  }
  return null;
}
