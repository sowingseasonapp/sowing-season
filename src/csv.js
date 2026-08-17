// Bank CSV parsing (Capital One export format) + auto-categorization.
import { normFund } from './compute.js';

// Minimal RFC-4180 CSV parser (handles quoted fields, embedded commas/quotes).
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f.trim() !== '')) rows.push(row); }
  return rows;
}

// A row that is a credit-card payment (either side: the card statement's credit,
// or the checking account's withdrawal that funded it) — not a budget expense.
function isCardPaymentRow(vendor, bankCategory) {
  return /payment\/credit/i.test(bankCategory)
    || /online pymt|autopay pymt|payment thank you/i.test(vendor)
    || /capital one.*\b(mobile|online|autopay)?\s*(pymt|pmt)\b/i.test(vendor);
}

const num$ = (s) => parseFloat(String(s ?? '').replace(/[$,]/g, '')) || 0;

// Returns [{date, vendor, amount, account, bankCategory, isCardPayment}] or throws.
// Auto-detects the export format:
//  A) credit card:  Transaction Date, Posted Date, Card No., Description, Category, Debit, Credit
//  B) checking:     Account Number, Transaction Description, Transaction Date, Transaction Type, Transaction Amount, Balance
export function parseBankCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('The file is empty.');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => header.findIndex((h) => h === name.toLowerCase());

  // Format B: checking account (single amount column + Debit/Credit type)
  if (col('Transaction Type') >= 0 && col('Transaction Amount') >= 0) {
    const iDate = col('Transaction Date'), iDesc = col('Transaction Description'),
      iType = col('Transaction Type'), iAmt = col('Transaction Amount'),
      iAcct = col('Account Number');
    if (iDate < 0 || iDesc < 0) {
      throw new Error('This checking-account CSV is missing expected columns (Transaction Date, Transaction Description).');
    }
    const out = [];
    for (const r of rows.slice(1)) {
      const rawDate = (r[iDate] || '').trim();
      const amt = num$(r[iAmt]);
      if (!rawDate || !amt) continue;
      const vendor = (r[iDesc] || '').trim();
      const isDebit = /^debit$/i.test((r[iType] || '').trim());
      out.push({
        date: normalizeDate(rawDate),
        vendor,
        amount: Math.round((isDebit ? -amt : amt) * 100) / 100,
        account: iAcct >= 0 ? (r[iAcct] || '').trim() : '',
        bankCategory: '',
        isCardPayment: isCardPaymentRow(vendor, ''),
      });
    }
    return out;
  }

  // Format A: credit card (separate Debit / Credit columns)
  const iDate = col('Transaction Date'), iDesc = col('Description'),
    iCat = col('Category'), iDebit = col('Debit'), iCredit = col('Credit'),
    iCard = col('Card No.');
  if (iDate < 0 || iDesc < 0 || iDebit < 0 || iCredit < 0) {
    throw new Error('This does not look like a supported bank CSV export (expected either the credit-card format with Debit/Credit columns, or the checking format with Transaction Type/Amount).');
  }
  const out = [];
  for (const r of rows.slice(1)) {
    const rawDate = (r[iDate] || '').trim();
    if (!rawDate) continue;
    const debit = num$(r[iDebit]);
    const credit = num$(r[iCredit]);
    if (!debit && !credit) continue;
    const vendor = (r[iDesc] || '').trim();
    const bankCategory = iCat >= 0 ? (r[iCat] || '').trim() : '';
    out.push({
      date: normalizeDate(rawDate),
      vendor,
      amount: debit ? -Math.round(debit * 100) / 100 : Math.round(credit * 100) / 100,
      account: iCard >= 0 ? (r[iCard] || '').trim() : '',
      bankCategory,
      isCardPayment: isCardPaymentRow(vendor, bankCategory),
    });
  }
  return out;
}

function normalizeDate(s) {
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let y = Number(m[3]); if (y < 100) y += 2000;
    return `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  }
  return s;
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
