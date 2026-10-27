// Bank CSV parsing (Capital One export format) + auto-categorization.
// parseBankFile is the bank-agnostic pipeline (src/csv/) — it infers the
// format, refuses what it can't read safely, and asks instead of guessing.
import { normFund, r2, isTransferTx } from './compute.js';
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
// Checking-side lines that name the issuer plus a card or payment word (3-year
// sim S2): "Payment to Chase card ending in 4471", "CHASE CREDIT CRD AUTOPAY",
// "ACH DEBIT CAPITAL ONE CRCARDPMT 1872", "DISCOVER E-PAYMENT", "AMEX EPAYMENT
// ACH PMT", "CITI AUTOPAY PAYMENT", "CARDMEMBER SERV WEB PYMT". Issuer AND a
// card/payment word, never a bare payment word — "PAYMENT TO CITY WATER" and
// "FPL DIRECT DEBIT ELEC PYMT" are bills.
const ISSUER_CARD_PAYMENT = /payment to chase card|chase credit crd\s*(autopay|epay)|capital one crcardpmt|discover e-?payment|amex epayment|citi autopay|cardmember serv/i;
function isCardPaymentRow(vendor, bankCategory) {
  return /payment\/credit/i.test(bankCategory)
    || /online pymt|autopay pymt|payment thank you/i.test(vendor)
    || /capital one.*\b(mobile|online|autopay)?\s*(pymt|pmt)\b/i.test(vendor)
    || ISSUER_CARD_PAYMENT.test(vendor);
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
// Returns Map<normVendor, {fund, n}>; S11 (1.2.0) hangs a second map on it as
// `byAccount`, keyed `${account}\0${normVendor}` for rows that carry an account,
// so the same vendor string can mean different funds on different cards
// ("CAPITAL ONE MEMBER FEE" is Venture X on one, Quicksilver on the other).
// The property keeps suggestFund's first two arguments as they were.
const ACCT_SEP = '\u0000';
export function buildVendorMap(months) {
  const counts = new Map(); // key -> Map(normFund -> {n, fund})
  const bump = (key, fund) => {
    if (!counts.has(key)) counts.set(key, new Map());
    const per = counts.get(key);
    const k = normFund(fund);
    const e = per.get(k) || { n: 0, fund };
    e.n++;
    per.set(k, e);
  };
  const learn = (vendor, fund, account) => {
    const v = normVendor(vendor);
    if (!v) return;
    bump(v, fund);
    if (account) bump(account + ACCT_SEP + v, fund);
  };
  for (const m of months) {
    for (const t of m.transactions) {
      if (!t.vendor || !t.fund) continue;
      const account = String(t.account || '').trim();
      learn(t.vendor, t.fund, account);
      const rest = afterMemo(t.vendor);
      if (rest) learn(rest, t.fund, account); // index the memo-stripped form too
    }
  }
  const map = new Map();
  const byAccount = new Map();
  for (const [key, per] of counts) {
    let best = null;
    for (const e of per.values()) if (!best || e.n > best.n) best = e;
    if (best) (key.includes(ACCT_SEP) ? byAccount : map).set(key, { fund: best.fund, n: best.n });
  }
  map.byAccount = byAccount;
  return map;
}

// Prefix fallback guard (S11): "AMAZON RETA" ↔ "AMAZON RETAIL" should match,
// "BO" ↔ "BOWLERO" must not — a vendor that normalises to two letters used to
// prefix-match every vendor starting with them (BOCA RATON REGIONAL HOSP became
// Restaurants). Either both keys are six or more characters, or the shorter is
// a whole first word of the longer ("WALMART" ↔ "WALMART COM").
function prefixMatch(a, b) {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (!l.startsWith(s)) return false;
  if (s.length >= 6 && l.length >= 6) return true;
  return l.startsWith(s + ' ');
}

// Best fund for a bank row's vendor string (or memo — the importer tries both).
// Exact match first: the record's own account, then all accounts. Then the
// guarded prefix fallback, account first. An account with no history for the
// vendor falls through to the all-accounts answer, so a new card isn't blind.
export function suggestFund(vendorMap, vendor, account = '') {
  const candidates = [vendor, afterMemo(vendor)].filter(Boolean).map(normVendor).filter(Boolean);
  const acct = String(account || '').trim();
  const byAccount = acct && vendorMap.byAccount ? vendorMap.byAccount : null;
  for (const v of candidates) {
    if (byAccount && byAccount.has(acct + ACCT_SEP + v)) return byAccount.get(acct + ACCT_SEP + v);
    if (vendorMap.has(v)) return vendorMap.get(v);
  }
  for (const v of candidates) {
    if (byAccount) {
      const pre = acct + ACCT_SEP;
      for (const [key, val] of byAccount) {
        if (key.startsWith(pre) && prefixMatch(key.slice(pre.length), v)) return val;
      }
    }
    for (const [key, val] of vendorMap) {
      if (prefixMatch(key, v)) return val;
    }
  }
  return null;
}

/* ---------------- Duplicate detection (scored, §8) ---------------- */

// Vendors where the posted amount routinely differs from what was authorised:
// restaurants add a tip, gas pumps replace the pre-auth hold.
const TIP_OR_FUEL = /\b(restaurants?|grill|cafe|caffe|coffee|espresso|pizz(a|eria)|sushi|taco|burger|burrito|wings?|bbq|barbecue|steak(house)?|diner|deli|bistro|brewer(y|ies)|brewhouse|taphouse|bar|pub|cantina|kitchen|cocina|thai|pho|ramen|doordash|uber\s?eats|grubhub|postmates|shell|chevron|exxon|mobil|texaco|marathon|sunoco|valero|conoco|phillips\s?66|circle\s?k|speedway|quiktrip|racetrac|wawa|sheetz|caseys?|maverik|pilot|arco|fuel|gas\s?station)\b/i;
const DAY = 86400000;

// Was the stored transaction typed by hand? Imported rows carry
// source: 'import' (pushImportedTx, since 2026-10-06); rows with a bank id came from a
// file whatever the stamp says; transfer legs are the app's own. Rows imported
// before the stamp existed count as typed — the worst case is an extra
// "possible duplicate" badge on a row that stays ticked.
function isTypedTx(t) {
  return !t.source && !String(t.externalId || '').trim() && !isTransferTx(t);
}

// Score how likely `rec` (a CSV row) is a re-import of `t` (a stored
// transaction), with the reason. score: 0 = no match; 1.0 = the same vendor and
// the same cents within ±3 days; 0.6 = "possible" — a near-equal amount at the
// same vendor, the tip/pump-hold pattern, or (typed: true) a hand-typed entry
// with the same cents within ±3 days whatever its vendor text (3-year sim S4).
// The possible tiers use the asymmetric −3…+7 day window: pending appears
// BEFORE posted, so a CSV row posts up to a week after the entry the user
// typed, but rarely precedes it. A CONFIDENT match is tighter: an identical
// vendor + amount 4–7 days out is a weekly paycheck or a standing order, not
// the same line twice, and scores 0 — not 0.6 (decision 2026-10-05, S1).
function scoreDuplicateDetail(t, rec, { idTrusted = false } = {}) {
  if (!t.date || !rec.date) return { score: 0, typed: false };
  const tAcct = String(t.account || '').trim(), rAcct = String(rec.account || '').trim();
  if (tAcct && rAcct && tAcct !== rAcct) return { score: 0, typed: false }; // the same $50 on two cards is two transactions (§8.2)
  const tId = String(t.externalId || '').trim(), rId = String(rec.externalId || '').trim();
  if (idTrusted && tId && rId) return { score: tId === rId ? 1 : 0, typed: false }; // bank IDs are exact, not heuristic (§8.1)
  const lagDays = (Date.parse(rec.date) - Date.parse(t.date)) / DAY;
  if (lagDays < -3 || lagDays > 7) return { score: 0, typed: false };
  const a = Math.round(t.amount * 100);
  const b = Number.isFinite(rec.amountCents) ? rec.amountCents : Math.round(rec.amount * 100);
  const diff = Math.abs(a - b), mag = Math.max(Math.abs(a), Math.abs(b));
  const tv = normVendor(t.vendor);
  const sameVendor = !!tv && (tv === normVendor(rec.vendor) || (!!rec.memo && tv === normVendor(rec.memo)));
  if (!sameVendor) {
    // S4: "Hospital deposit" typed on the 14th, "LAKELAND REGIONAL HEALTH" in
    // the bank file on the 14th. Only a typed entry, only the same cents, only
    // within ±3 days, and only ever "possible" — this is NOT widened to
    // imported rows: two $5 coffees at different shops the same day are two
    // transactions.
    const typed = diff === 0 && Math.abs(lagDays) <= 3 && isTypedTx(t);
    return { score: typed ? 0.6 : 0, typed };
  }
  if (diff === 0) return { score: Math.abs(lagDays) <= 3 ? 1 : 0, typed: false };
  // Near-equal cents (rounding on the same posting — or a second real purchase
  // 5¢ apart, S6): the user decides, so never a confident duplicate.
  if (diff <= 2 || diff <= mag * 0.005) return { score: 0.6, typed: false };
  const largerIsLater = lagDays === 0 || (lagDays > 0) === (Math.abs(b) >= Math.abs(a));
  const tippable = TIP_OR_FUEL.test(rec.vendor || '') || TIP_OR_FUEL.test(rec.memo || '')
    || TIP_OR_FUEL.test(t.vendor || '') || /dining|restaurant|food|gas|fuel/i.test(rec.bankCategory || '');
  if (diff <= mag * 0.05 && largerIsLater && tippable) return { score: 0.6, typed: false };
  return { score: 0, typed: false };
}

export function scoreDuplicate(t, rec, opts) {
  return scoreDuplicateDetail(t, rec, opts).score;
}

// Match a whole file against the budget, best-first (S1). Every candidate pair
// inside the date window is scored; claims are then handed out in two tiers —
// confident (≥0.9) first, then possible — and within a tier by highest score,
// smallest |lag|, file order last. So a file's own copy of a line claims its
// twin before a week-later line can, whatever order the bank listed the rows
// in (bank files are newest first). Each existing transaction is claimed at
// most once (Invariant 12): the shared `claimed` Set preserves multiplicity —
// three identical coffees dedupe as three, not one. A null record is skipped.
// Returns an array aligned with `records`: {t, score, typed} or null.
function assignDuplicates(months, records, claimed, opts, minScore) {
  const cands = [];
  records.forEach((rec, i) => {
    if (!rec || !rec.date) return;
    const recMs = Date.parse(rec.date);
    for (const m of months) {
      for (const t of m.transactions) {
        if (claimed.has(t.id) || !t.date) continue;
        const lag = (recMs - Date.parse(t.date)) / DAY; // cheap gate before the vendor work
        if (!(lag >= -3 && lag <= 7)) continue;
        const d = scoreDuplicateDetail(t, rec, opts);
        if (d.score >= minScore) cands.push({ i, t, score: d.score, typed: d.typed, lag: Math.abs(lag) });
      }
    }
  });
  cands.sort((x, y) => (y.score >= 0.9) - (x.score >= 0.9) || y.score - x.score || x.lag - y.lag || x.i - y.i);
  const out = new Array(records.length).fill(null);
  for (const c of cands) {
    if (out[c.i] || claimed.has(c.t.id)) continue;
    claimed.add(c.t.id);
    out[c.i] = { t: c.t, score: c.score, typed: c.typed };
  }
  return out;
}

// Preview matcher for a whole file: ≥0.9 auto-marks as a duplicate, 0.6–0.9 is
// a "possible duplicate" the user reviews. Nothing is ever silently dropped.
export function matchDuplicates(months, records, claimed, opts) {
  return assignDuplicates(months, records, claimed, opts, 0.6);
}

// One row at a time (the same scoring; claims in call order). Kept for the
// tests and the simulation harness — the preview uses matchDuplicates.
export function findDuplicateScored(months, rec, claimed, opts) {
  return assignDuplicates(months, [rec], claimed, opts, 0.6)[0];
}

// Legacy surface (the onboarding wizard calls this): a duplicate is only a
// CONFIDENT scored match (≥0.9) — what the preview would auto-mark.
export function findDuplicate(months, rec, claimed) {
  return assignDuplicates(months, [rec], claimed, {}, 0.9)[0]?.t ?? null;
}

/* ---------------- Onboarding starter-fund suggestions ----------------
 * Pure functions over parseBankFile records: map spending to the wizard's
 * starter envelopes and sniff out a paycheck rhythm. Table-driven, precision
 * over recall — a wrong suggestion erodes trust faster than a missing one.
 * Keys match STARTER_FUNDS in app.js.
 */

// Card exports carry the bank's own category column — the strongest signal.
const CATEGORY_TO_STARTER = [
  [/dining/i, 'eatingOut'],
  [/gas|automotive/i, 'gas'],
  [/grocer/i, 'groceries'],
  [/entertainment/i, 'funMoney'],
  [/internet/i, 'internet'],
  [/phone|cable/i, 'cellPhone'],
  [/insurance/i, 'carInsurance'],
  [/merchandise|other/i, 'everythingElse'],
];

// Checking exports have no category — a short list of unmistakable vendors.
const VENDOR_TO_STARTER = [
  [/kroger|publix|aldi\b|wal-?mart|costco|trader joe|whole foods|grocer/i, 'groceries'],
  [/shell oil|exxon|chevron|marathon petro|speedway|wawa|racetrac|quiktrip|circle ?k|gas station|fuel/i, 'gas'],
  [/mcdonald|chick-?fil|wendy|taco bell|pizza|chipotle|starbucks|dunkin|restaurant|grill|cafe|doordash|uber ?eats|grubhub/i, 'eatingOut'],
  [/netflix|spotify|hulu|disney ?(plus|\+)|paramount\+|audible|prime video|youtube ?premium|apple\.com/i, 'subscriptions'],
  [/xfinity|comcast|spectrum|centurylink|frontier comm/i, 'internet'],
  [/verizon|t-?mobile|cricket wireless|mint mobile|boost mobile/i, 'cellPhone'],
  [/geico|progressive ins|state farm|allstate/i, 'carInsurance'],
  [/electric co|power co|duke energy|georgia power|fpl\b|power ?& ?light/i, 'electricity'],
  [/amc theat|regal cinema|cinemark|playstation|nintendo|steam games/i, 'funMoney'],
];

// One record → starter fund key ('everythingElse' counts; null = no idea).
// The memo often carries the real merchant string, so it's scanned too.
export function starterFundFor(rec) {
  if (rec.bankCategory) {
    for (const [re, key] of CATEGORY_TO_STARTER) if (re.test(rec.bankCategory)) return key;
  }
  const hay = `${rec.vendor || ''} ${rec.memo || ''}`;
  for (const [re, key] of VENDOR_TO_STARTER) if (re.test(hay)) return key;
  return null;
}

const PAY_RE = /payroll|direct dep|dir dep|deposit/i;
const DAY_MS = 86400000;
const centsAbs = (r) => Math.abs(Number.isFinite(r.amountCents) ? r.amountCents : Math.round(r.amount * 100));

// Records → { suggestions: [{starterKey, monthlyAmount, txCount, source}],
//             paycheck: {amount, perMonth, cadence} | null }.
// cadence is 'weekly' | 'biweekly' | 'semimonthly' | 'monthly' | null, read
// off the gaps between the cluster's deposits (see payCadence); it only feeds
// the wizard's label and count and never reaches the data file.
// monthlyAmount = total ÷ months spanned, rounded UP to the nearest $5
// (budgets should breathe). Pending rows never reach this function; card
// payments and fund-to-fund transfers are excluded on both sides.
// Pay cadence from the median gap (in days) between a cluster's sorted deposit
// dates: 5–10 → weekly; 11–17 → every two weeks or twice a month; 26–35 →
// monthly; anything else → null (irregular, or too few deposits to tell).
// The 11–17 band is one band on purpose: 1st-and-15th pay has gaps of 14 and
// 17, so its median (14) looks biweekly. Within the band it's 'semimonthly'
// when every deposit's day-of-month sits within ±1 of one of two anchor days
// (1 and 15, or 15 and the last day of the month — a weekend shift of a day is
// fine), else 'biweekly' (every-other-Friday pay drifts through the month).
// The median uses the same convention as the amount median (upper middle), so
// a weekly payer with one missed week (7, 7, 14, 7) still reads weekly.
export function payCadence(dates, gaps) {
  if (!gaps.length) return null;
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median >= 5 && median <= 10) return 'weekly';
  if (median >= 26 && median <= 35) return 'monthly';
  if (median < 11 || median > 17) return null;
  // Anchors: each day-of-month seen, plus "last day of the month" (whatever it is).
  const days = dates.map((d) => {
    const [y, m, day] = d.split('-').map(Number);
    return { day, fromEnd: new Date(y, m, 0).getDate() - day };
  });
  const near = (x, anchor) => anchor === 'eom' ? x.fromEnd <= 1 : Math.abs(x.day - anchor) <= 1;
  const anchors = [...new Set(days.map((x) => x.day)), 'eom'];
  for (let i = 0; i < anchors.length; i++) {
    for (let j = i; j < anchors.length; j++) {
      if (days.every((x) => near(x, anchors[i]) || near(x, anchors[j]))) return 'semimonthly';
    }
  }
  return 'biweekly';
}

export function suggestStarterFunds(recs) {
  // ── paycheck detection (checking format): payroll-flavoured deposits,
  // clustered by similar amount (±10%); a steady cluster of ≥2 wins.
  const hits = recs
    .filter((r) => r.amount > 0 && !r.isCardPayment && !isTransferTx({ vendor: r.vendor })
      && (PAY_RE.test(r.vendor || '') || PAY_RE.test(r.memo || '')))
    .sort((a, b) => a.amount - b.amount);
  const clusters = [];
  for (const r of hits) {
    const c = clusters.find((c) => Math.abs(r.amount - c.center) <= c.center * 0.1);
    if (c) { c.rows.push(r); c.center = c.rows.reduce((a, x) => a + x.amount, 0) / c.rows.length; }
    else clusters.push({ center: r.amount, rows: [r] });
  }
  let paycheck = null;
  const best = clusters.filter((c) => c.rows.length >= 2)
    .sort((a, b) => b.rows.length - a.rows.length)[0];
  if (best) {
    const dates = best.rows.map((r) => r.date).sort();
    const gaps = [];
    for (let i = 1; i < dates.length; i++) gaps.push((Date.parse(dates[i]) - Date.parse(dates[i - 1])) / DAY_MS);
    if (gaps.length && Math.max(...gaps) <= 40) { // roughly regular cadence
      const amts = best.rows.map((r) => r.amount).sort((a, b) => a - b);
      const median = amts[Math.floor(amts.length / 2)];
      // Checks per month from the cadence of the deposits (weekly → 4, every
      // two weeks / twice a month → 2, monthly → 1). Counting the newest "full"
      // month undercounted a file that starts mid-month — a weekly payer was
      // pre-filled at 2 (3-year sim S10). The count-a-month fallback stays for
      // deposits with no readable cadence.
      const cadence = payCadence(dates, gaps);
      let perMonth = cadence === 'weekly' ? 4 : cadence === 'monthly' ? 1 : cadence ? 2 : null;
      if (perMonth == null) {
        // Count in the last FULL month — the newest month in the file is
        // usually cut off mid-way and would undercount.
        const byMonth = {};
        for (const d of dates) byMonth[d.slice(0, 7)] = (byMonth[d.slice(0, 7)] || 0) + 1;
        const months = Object.keys(byMonth).sort();
        const newestData = recs.map((r) => r.date).sort()[recs.length - 1] || '';
        let mo = months[months.length - 1];
        if (months.length > 1 && mo === newestData.slice(0, 7)) mo = months[months.length - 2];
        perMonth = Math.min(5, Math.max(1, byMonth[mo]));
      }
      paycheck = { amount: r2(median), perMonth, cadence };
    }
  }

  // ── spending → starter envelopes
  const spend = recs.filter((r) => r.amount < 0 && !r.isCardPayment
    && !isTransferTx({ vendor: r.vendor }));
  const monthsSpanned = Math.max(1, new Set(spend.map((r) => r.date.slice(0, 7))).size);
  const groups = {}; // starterKey → { cents, n, source }
  for (const r of spend) {
    const key = starterFundFor(r);
    // Unmapped spending inflates the "Everything Else" suggestion — every
    // dollar the file saw gets a home somewhere.
    const g = groups[key || 'everythingElse'] =
      groups[key || 'everythingElse'] || { cents: 0, n: 0, source: key ? 'mapped' : 'leftover' };
    g.cents += centsAbs(r);
    g.n++;
    if (key) g.source = 'mapped';
  }
  const suggestions = Object.entries(groups).map(([starterKey, g]) => ({
    starterKey,
    monthlyAmount: Math.ceil(g.cents / 100 / monthsSpanned / 5) * 5,
    txCount: g.n,
    source: g.source,
  })).filter((s) => s.monthlyAmount > 0);
  return { suggestions, paycheck };
}
