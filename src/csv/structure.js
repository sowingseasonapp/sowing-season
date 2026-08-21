// Stage 3: locate the header row and cut the primary transaction table out of
// whatever surrounds it (account preambles, summary blocks, footers, repeated
// headers from concatenated exports, second tables).

// Column-name lexicon, multilingual so international files are recognised well
// enough to be refused BY NAME instead of looking like junk (decision D1).
const LEXICON = {
  date: ['date', 'transaction date', 'post date', 'posting date', 'posted date', 'value date',
    'booking date', 'effective date', 'tran date', 'trans date', 'run date', 'settle date',
    'settlement date', 'completed date', 'clearing date', 'origination date', 'datum',
    'buchungstag', 'valutadatum', 'wertstellung', 'valuta', 'fecha', 'date operation'],
  desc: ['description', 'payee', 'name', 'merchant', 'details', 'memo', 'narrative', 'particulars',
    'comments', 'transaction description', 'original description', 'security description',
    'counterparty', 'title', 'notes', 'extended details', 'action', 'verwendungszweck',
    'omschrijving', 'libelle'],
  amount: ['amount', 'amount usd', 'value', 'transaction amount', 'net amount', 'gross', 'net',
    'money in', 'money out', 'paid in', 'paid out', 'debit', 'credit', 'debits', 'credits',
    'withdrawal', 'withdrawals', 'deposit', 'deposits', 'inflow', 'outflow', 'charge',
    'betrag', 'importe', 'montant', 'bedrag', 'kwota', 'soll', 'haben'],
  balance: ['balance', 'running bal', 'running balance', 'current balance', 'daily balance',
    'ledger balance', 'available balance', 'balance after', 'account balance', 'saldo', 'daily'],
  id: ['transaction id', 'fitid', 'unique id', 'reference', 'reference number', 'ref no',
    'check number', 'check', 'cheque number', 'confirmation number', 'external id', 'id',
    'check or slip'],
  other: ['currency', 'waehrung', 'category', 'account', 'account number', 'account name',
    'account type', 'type', 'transaction type', 'status', 'cleared', 'tags', 'labels', 'card no',
    'card', 'cardmember', 'institution', 'fee', 'tax', 'time', 'timezone', 'quantity', 'symbol',
    'price', 'commission', 'credit debit', 'auftragskonto'],
};

// Normalise a header cell for matching: lowercase, drop punctuation/whitespace.
export const norm = (s) => String(s ?? '').toLowerCase()
  .replace(/[\s_\-.#/\\()&$]/g, '').replace(/[^a-z0-9äöüßéèàçñ]/g, '');

const FLAT = new Map();
for (const [kind, names] of Object.entries(LEXICON)) for (const n of names) FLAT.set(norm(n), kind);

export const isDateish = (v) => /^\s*(\d{1,4}[/.\-]\d{1,2}[/.\-]\d{1,4}|\d{8})/.test(String(v ?? ''));
export const isMoneyish = (v) => /\d/.test(String(v ?? '')) &&
  /^\s*[-+(]?\s*[\p{Sc}A-Z]{0,3}\s*\d[\d.,'\s  ]*\d?\s*\)?\s*(CR|DR)?\s*$/iu.test(String(v ?? '').trim());

// What kind of column would a header cell with this name be? Exact match first,
// then a tight fuzzy match (substring with a small length difference).
function kindOf(cell) {
  const n = norm(cell);
  if (!n) return null;
  let kind = FLAT.get(n);
  if (!kind) {
    for (const [key, v] of FLAT) {
      if (n.length > 3 && (n.includes(key) || key.includes(n)) && Math.abs(n.length - key.length) <= 4) { kind = v; break; }
    }
  }
  return kind || null;
}

// Score each of the first rows as a potential header (proposal §5.3): lexicon
// hits and date/amount/desc coverage push up, data-shaped cells push down, and
// agreement with the field count of the rows below is worth up to 25.
export function findHeaderRow(rows, { maxScan = 30 } = {}) {
  let best = null;
  for (let i = 0; i < Math.min(maxScan, rows.length); i++) {
    const cells = rows[i];
    if (!cells || cells.length < 2) continue;
    const nonEmpty = cells.filter((c) => String(c ?? '').trim() !== '').length;
    if (nonEmpty < 2) continue;
    let hits = 0;
    const kinds = new Set();
    for (const c of cells) { const k = kindOf(c); if (k) { hits++; kinds.add(k); } }
    const follow = rows.slice(i + 1, i + 11).filter((r) => r && r.length >= 2);
    const agree = follow.length ? follow.filter((r) => r.length === cells.length).length / follow.length : 0;
    const selfIsData = cells.filter((c) => isDateish(c) || isMoneyish(c)).length;
    const belowIsData = follow.length
      ? follow.reduce((a, r) => a + r.filter((c) => isDateish(c) || isMoneyish(c)).length, 0) / follow.length : 0;
    const score = hits * 10
      + (kinds.has('date') ? 15 : 0) + (kinds.has('amount') ? 15 : 0) + (kinds.has('desc') ? 8 : 0)
      + agree * 25 + Math.min(belowIsData, 3) * 5
      - selfIsData * 20 - i * 0.5 + (nonEmpty === cells.length ? 5 : 0);
    if (!best || score > best.score) best = { index: i, score, hits, kinds: [...kinds], cells };
  }
  return best;
}

const TOTAL_RE = /^\s*(total|totals|sub-?total|summe|gesamt|saldo|closing|opening|end(ing)?[ -]balance)/i;

// Classify every row after the header (proposal §5.3): keep data rows, drop
// blanks, repeated headers, TOTAL rows and short junk, and stop the primary
// table when a blank gap is followed by what scores as a new header.
export function segment(rows, headerIdx, arity) {
  const header = headerIdx == null ? null : rows[headerIdx];
  const body = [], dropped = [];
  let blankRun = 0;
  for (let i = headerIdx == null ? 0 : headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.every((c) => String(c ?? '').trim() === '')) { blankRun++; dropped.push({ i, why: 'BLANK' }); continue; }
    if (header && r.length === header.length &&
        r.filter((c, k) => norm(c) && norm(c) === norm(header[k])).length / r.length >= 0.6) {
      dropped.push({ i, why: 'REPEAT' }); continue;
    }
    if (TOTAL_RE.test(String(r[0] ?? '')) ||
        (String(r[0] ?? '').trim() === '' && r.some((c) => TOTAL_RE.test(String(c ?? ''))))) {
      dropped.push({ i, why: 'TOTAL' }); continue;
    }
    if (r.length === 1 || r.length < arity / 2) { dropped.push({ i, why: 'JUNK' }); continue; }
    if (blankRun > 0) {
      // Score this row WITH the rows under it — a second table's header only
      // reveals itself through the block of consistent rows that follows.
      const h = findHeaderRow(rows.slice(i), { maxScan: 1 });
      if (h && h.score >= 40) { dropped.push({ i, why: 'NEWTABLE' }); break; } // a second table starts
    }
    blankRun = 0;
    body.push({ i, cells: r });
  }
  return { body, dropped };
}
