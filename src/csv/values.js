// Stage 4/5: value-level inference — amounts to exact integer cents, and a
// date order decided per COLUMN, never per value (proposal §5.5–5.6).

/* ---------------- amounts ---------------- */

// Normalise one raw amount cell. Returns {empty} | {bad} | {neg, cleaned} where
// `cleaned` holds only digits, dots and commas. The step order is load-bearing:
// DR/CR and the trailing minus must go before letters are stripped, or
// `1,234.56 DR` silently flips to a credit.
export function stripAmount(raw) {
  if (raw == null) return { empty: true };
  let s = String(raw).replace(/﻿/g, '').trim();
  if (s === '') return { empty: true };
  if (!/\d/.test(s)) return { empty: true }; // letters-only cell = no amount
  let neg = false;
  s = s.replace(/[−‒–—―﹣－]/g, '-'); // unicode minus family
  if (/^\(.*\)$/.test(s)) { neg = !neg; s = s.slice(1, -1).trim(); }
  if (/(^|\s)(DR|D)\s*$/i.test(s)) { neg = !neg; s = s.replace(/(^|\s)(DR|D)\s*$/i, ''); }
  else if (/(^|\s)(CR|C)\s*$/i.test(s)) { s = s.replace(/(^|\s)(CR|C)\s*$/i, ''); }
  if (/-\s*$/.test(s)) { neg = !neg; s = s.replace(/-\s*$/, ''); }
  s = s.replace(/^([^\d]*)-/, (_, pre) => { neg = !neg; return pre; });
  s = s.replace(/[\p{Letter}\p{Currency_Symbol}]/gu, '');
  s = s.replace(/[\s  ]/g, '').replace(/['’_+]/g, ''); // NBSPs; Swiss group marks
  if (s === '' || s === '-' || s === '.' || s === ',') return { bad: true };
  if (!/^[\d.,]+$/.test(s)) return { bad: true };
  return { neg, cleaned: s };
}

// Decide the decimal mark once for the whole column (proposal §5.6). One
// unambiguous value like `56,78` settles every row; a 3-digit tail casts no
// vote because `1,234` genuinely can't be decided alone.
export function decideDecimalMark(cleanedValues) {
  let dotDec = 0, commaDec = 0;
  for (const s of cleanedValues) {
    const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) { (lastDot > lastComma ? dotDec++ : commaDec++); continue; }
    const mark = lastDot >= 0 ? '.' : lastComma >= 0 ? ',' : null;
    if (!mark) continue;
    const idx = mark === '.' ? lastDot : lastComma;
    const count = s.split(mark).length - 1;
    if (count > 1) { (mark === '.' ? commaDec++ : dotDec++); continue; } // repeated ⇒ group mark
    const tail = s.length - idx - 1;
    if (tail === 3) continue; // undecidable per value
    (mark === '.' ? dotDec++ : commaDec++);
  }
  if (!dotDec && !commaDec) return { mark: null, ambiguous: true };
  if (dotDec && commaDec) return { mark: dotDec >= commaDec ? '.' : ',', conflict: true, dotDec, commaDec };
  return { mark: dotDec ? '.' : ',' };
}

// One cleaned value → integer cents under a known decimal mark, or NaN when
// the value doesn't fit the mark (a wrong mark must error, never misread).
export function centsOf(stage, mark) {
  if (stage.empty) return null;
  if (stage.bad) return NaN;
  const group = mark === '.' ? ',' : '.';
  const s = stage.cleaned;
  // Group marks must look like grouping (digits in threes) — anything else is
  // a misread waiting to happen.
  if (s.includes(group)) {
    const groupRe = mark === '.'
      ? /^\d{1,3}(,\d{3})+(\.\d+)?$/
      : /^\d{1,3}(\.\d{3})+(,\d+)?$/;
    if (!groupRe.test(s)) return NaN;
  }
  let n = s.split(group).join('');
  if (mark === ',') n = n.replace(',', '.');
  const m = n.match(/^(\d*)(?:\.(\d*))?$/);
  if (!m || (!m[1] && !m[2])) return NaN;
  const frac = (m[2] || '').padEnd(2, '0');
  let v = BigInt(m[1] || '0') * 100n + BigInt(frac.slice(0, 2)); // exact — no floats
  if (frac.length > 2 && Number(frac[2]) >= 5) v += 1n; // half-up on 3+ decimals
  return stage.neg ? -Number(v) : Number(v);
}

export function parseAmountColumn(rawValues, mark) {
  return rawValues.map((raw) => centsOf(stripAmount(raw), mark));
}

/* ---------------- dates ---------------- */

const NUM3 = /^(\d{1,4})([/.\-])(\d{1,2})\2(\d{1,4})$/;
const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10,
  nov: 11, dec: 12, mär: 3, mrz: 3, mai: 5, okt: 10, dez: 12, janv: 1, fév: 2, avr: 4,
  juin: 6, juil: 7, aout: 8, déc: 12, ene: 1, abr: 4, ago: 8, dic: 12, mei: 5, set: 9, out: 10,
};

// "Jan 5, 2026" / "05-Jan-26" → numeric so one parsing path handles everything.
export function normaliseMonthNames(s) {
  return s.replace(/\b([A-Za-zÀ-ÿ]{3,12})\.?\b/g, (m, word) => {
    const k = word.toLowerCase();
    for (const len of [4, 3]) { const v = MONTHS[k.slice(0, len)]; if (v) return String(v).padStart(2, '0'); }
    return m;
  });
}

// Decide the order for the whole column. "Both positions exceed 12" is FATAL —
// that's a half-converted Excel round-trip, and no single format can read it.
export function inferDateOrder(values) {
  let n = 0, ymdVotes = 0, aGt12 = 0, bGt12 = 0, dotSep = 0, serials = 0, iso8 = 0, total = 0;
  for (const raw of values) {
    const s = String(raw ?? '').trim();
    if (!s) continue;
    total++;
    if (/^\d{5}(\.\d+)?$/.test(s)) {
      // Only a bare integer inside 2000-01-01…2050-01-01 counts as an Excel serial.
      const v = Number(s);
      if (v >= 36526 && v <= 54789) { serials++; continue; }
    }
    if (/^\d{8}$/.test(s)) { iso8++; continue; }
    if (/^\d{4}-\d{1,2}-\d{1,2}([T ].*)?$/.test(s)) { n++; ymdVotes++; continue; } // ISO, maybe with a time part
    const m = normaliseMonthNames(s).match(NUM3);
    if (!m) continue;
    n++;
    if (m[2] === '.') dotSep++;
    if (m[1].length === 4) { ymdVotes++; continue; }
    const a = +m[1], b = +m[3];
    if (a > 31 || b > 31) return { order: null, reason: 'a component exceeds 31 — not a date column' };
    if (a > 12) aGt12++;
    if (b > 12) bGt12++;
  }
  if (serials && serials >= total * 0.8) return { order: 'EXCEL_SERIAL' };
  if (iso8 && iso8 >= total * 0.8) return { order: 'YMD8' };
  if (n === 0) return { order: null, reason: 'no recognisable dates' };
  if (ymdVotes === n) return { order: 'YMD' };
  if (aGt12 && bGt12) return { order: null, fatal: true, reason: 'the column mixes day-first and month-first dates' };
  if (aGt12) return { order: 'DMY' };
  if (bGt12) return { order: 'MDY' };
  // No value breaks the tie. A dot separator is a strong day-first prior
  // (de/at/ch/pl); otherwise it's genuinely ambiguous — the caller must ask.
  if (dotSep >= n * 0.8) return { order: 'DMY', viaPrior: 'dot-separator' };
  return { order: null, ambiguous: true };
}

// Two-digit years: sliding window ending next year, so 98 → 1998, not 2098.
export function expandYear(yy, today = new Date()) {
  const cy = today.getUTCFullYear();
  let y = Math.floor(cy / 100) * 100 + yy;
  if (y > cy + 1) y -= 100;
  return y;
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
export function fromExcelSerial(serial) {
  if (!Number.isFinite(serial) || serial < 1) return null;
  if (serial >= 60 && serial < 61) return null; // Excel's phantom 1900-02-29
  const adjusted = serial < 60 ? serial + 1 : serial;
  return new Date(EXCEL_EPOCH + Math.round(adjusted) * 86400000).toISOString().slice(0, 10);
}

// One raw cell → YYYY-MM-DD under a known order, or null. The calendar date is
// always taken from the STRING — never via new Date(string), whose timezone
// conversion can move a transaction across a month boundary.
export function parseDate(raw, order) {
  const s0 = String(raw ?? '').trim();
  if (!s0) return null;
  if (order === 'EXCEL_SERIAL' && /^\d{5}(\.\d+)?$/.test(s0)) return fromExcelSerial(Math.floor(Number(s0)));
  let m = s0.match(/^(\d{4})-(\d{2})-(\d{2})/); // ISO, with or without a time part
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  if (order === 'YMD8' && /^\d{8}$/.test(s0)) return `${s0.slice(0, 4)}-${s0.slice(4, 6)}-${s0.slice(6, 8)}`;
  const s = normaliseMonthNames(s0.replace(/\s+[A-Za-z]{3}$/, '')); // Amex glues a weekday on
  m = s.match(NUM3);
  if (!m) return null;
  let y = +m[4];
  const a = +m[1], b = +m[3];
  if (m[1].length === 4) return iso(a, b, y); // leading 4-digit year: Y-M-D
  if (y < 100) y = expandYear(y);
  if (order === 'DMY') return iso(y, b, a);
  if (order === 'MDY' || order === 'YMD') return iso(y, a, b);
  return null;
}

const iso = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31)
  ? `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  : null;
