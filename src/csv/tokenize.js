// Stage 2: text → rows[][], with a delimiter sniff and per-row anomaly notes.
// The tokenizer never throws — a parser that silently succeeds is the problem,
// so every deviation is reported as {row, code, msg} for the UI.

const CANDIDATES = [',', ';', '\t', '|'];

// Count fields per record for one candidate delimiter, honouring quotes.
function fieldCounts(text, delim, maxRecords = 40) {
  const counts = [];
  let inQ = false, n = 0, i = 0;
  const L = text.length;
  while (i < L && counts.length < maxRecords) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { i += 2; continue; } inQ = false; }
      i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === delim) { n++; i++; continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      counts.push(n + 1); n = 0; i++; continue;
    }
    i++;
  }
  if (n > 0 || counts.length === 0) counts.push(n + 1);
  return counts;
}

// Score = agreement*100 + headerAgrees*25 + log2(mode)*3 (proposal §5.2).
// headerAgrees is the term that catches an unquoted delimiter inside a
// description: every data row agrees with itself, only the header disagrees.
function scoreDelimiter(text, delim) {
  const raw = fieldCounts(text, delim);
  const multi = raw.filter((c) => c > 1);
  if (multi.length < 2) return { delim, score: -Infinity, mode: 0, agreement: 0, headerAgrees: 0 };
  const freq = new Map();
  for (const c of multi) freq.set(c, (freq.get(c) || 0) + 1);
  let mode = 0, modeN = 0;
  for (const [c, k] of freq) if (k > modeN || (k === modeN && c > mode)) { mode = c; modeN = k; }
  const agreement = modeN / multi.length;
  const headerAgrees = raw[0] === mode ? 1 : 0;
  return { delim, mode, agreement, headerAgrees, score: agreement * 100 + headerAgrees * 25 + Math.log2(mode) * 3 };
}

export function detectDelimiter(text) {
  const sample = text.slice(0, 64 * 1024);
  const results = CANDIDATES.map((d) => scoreDelimiter(sample, d)).sort((a, b) => b.score - a.score);
  const best = results[0];
  return { delimiter: best.score > 0 ? best.delim : ',', headerAgrees: best.headerAgrees, results };
}

// Tolerant RFC 4180: same quote rules as csv.js's parseCsv (a quote only opens
// at field start and only closes before a delimiter/newline/EOF), but with a
// configurable delimiter, blank rows kept (structure.js classifies them), and
// anomalies reported instead of swallowed.
export function tokenize(text, { delimiter = ',' } = {}) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [], anomalies = [];
  let row = [], field = '', i = 0;
  const L = text.length, D = delimiter;
  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };
  const note = (code, msg) => anomalies.push({ row: rows.length + 1, code, msg });

  while (i < L) {
    if (field === '' && D !== ' ' && D !== '\t') { // tolerate spaces before an opening quote
      let j = i;
      while (j < L && (text[j] === ' ' || (text[j] === '\t' && D !== '\t'))) j++;
      if (text[j] === '"') { if (j > i) note('SpaceBeforeQuote', ''); i = j; }
    }
    if (field === '' && text[i] === '"') {
      i++;
      for (;;) {
        if (i >= L) { note('UnterminatedQuote', 'the file ends inside a quoted value'); break; }
        if (text[i] === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          let k = i + 1;
          while (k < L && (text[k] === ' ' || text[k] === '\t') && text[k] !== D) k++;
          const c = text[k];
          if (c === undefined || c === D || c === '\n' || c === '\r') { i = k; break; }
          note('BareQuote', 'stray quote inside a quoted value (kept)');
          field += '"'; i++; continue;
        }
        field += text[i++]; // embedded newlines in quoted fields are preserved
      }
    } else {
      const start = i;
      while (i < L && text[i] !== D && text[i] !== '\n' && text[i] !== '\r') i++;
      field += text.slice(start, i);
      if (field.includes('"')) note('BareQuote', 'quote inside an unquoted value (kept literally)');
    }
    if (i >= L) break;
    if (text[i] === D) { endField(); i++; continue; }
    if (text[i] === '\r') { i += text[i + 1] === '\n' ? 2 : 1; endRow(); continue; }
    if (text[i] === '\n') { i++; endRow(); continue; }
  }
  if (field !== '' || row.length) endRow();
  if (rows.length && rows[rows.length - 1].every((f) => f === '')) rows.pop(); // trailing newline
  return { rows, anomalies };
}
