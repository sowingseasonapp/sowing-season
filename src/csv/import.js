// Stage 8: orchestration. parseBankFile(bytesOrText, opts) → {records, report}
// or {error, records: [], report}. The contract with the UI:
//   - error          → a plain-language refusal; nothing may be imported.
//   - report.questions non-empty → BLOCKING: the user must answer, then the
//     caller re-runs parseBankFile with opts.answers. Never guess (D1).
//   - otherwise      → records are safe to preview; report carries the evidence
//     (totals, date range, balance verdict) the summary band shows.
// Records: {date, vendor, amount (dollars), amountCents, account, bankCategory,
//   isCardPayment, memo, postedDate, externalId, checkNumber, balanceCents, rowIndex, raw}
import { decode } from './decode.js';
import { detectDelimiter, tokenize } from './tokenize.js';
import { findHeaderRow, segment, norm, isDateish, isMoneyish } from './structure.js';
import { assignRoles, positionalRoles, DIRECTION_TOKENS } from './roles.js';
import { stripAmount, decideDecimalMark, centsOf, inferDateOrder, parseDate } from './values.js';
import { detectSign, balanceEvidence } from './sign.js';

// Same heuristic as the legacy csv.js path, so both paths agree on what a
// card payment looks like.
function isCardPaymentRow(vendor, bankCategory) {
  return /payment\/credit/i.test(bankCategory)
    || /online pymt|autopay pymt|payment thank you/i.test(vendor)
    || /capital one.*\b(mobile|online|autopay)?\s*(pymt|pmt)\b/i.test(vendor);
}

const OUTFLOW_TOKENS = /^(debit|debits|withdrawal|withdrawals|d|db|dr|w|out|outflow|debit_card|ach_debit)$/i;

// "2026-01-05" → "Jan 5, 2026" for question copy shown to beginners.
const MONTH_WORDS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const inWords = (isoDate) => {
  if (!isoDate) return '?';
  const [y, m, d] = isoDate.split('-').map(Number);
  return `${MONTH_WORDS[m - 1]} ${d}, ${y}`;
};

const modeOf = (xs) => {
  const m = new Map();
  for (const x of xs) m.set(x, (m.get(x) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
};

export function parseBankFile(input, opts = {}) {
  const answers = opts.answers || {};
  const questions = [], notes = [], anomalies = [];
  const report = {
    encoding: 'utf-8', delimiter: null, decimalMark: null, dateOrder: null, headerRow: null,
    roles: null, signConvention: null, balanceCheck: { ran: false },
    counts: { rows: 0, junk: 0, pending: 0, anomalies: 0 },
    totals: null, questions, anomalies, notes,
  };
  const refuse = (error) => { report.counts.anomalies = anomalies.length; return { error, records: [], report }; };
  const blocked = (records = []) => { report.counts.anomalies = anomalies.length; return { records, report }; };

  let text;
  if (typeof input === 'string') {
    text = input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input;
  } else {
    const d = decode(input);
    text = d.text;
    report.encoding = d.encoding;
  }

  // ── delimiter + tokenize
  const del = detectDelimiter(text);
  report.delimiter = del.delimiter;
  if (del.delimiter === ';') {
    // Decision D1: semicolon columns mean a European export (day-first dates,
    // comma decimals). Recognise and refuse — never silently misread.
    return refuse('This file separates columns with semicolons, which is how European banks export CSVs. '
      + 'European formats aren’t supported yet, so nothing was imported.');
  }
  const tk = tokenize(text, { delimiter: del.delimiter });
  for (const a of tk.anomalies) {
    if (a.code === 'UnterminatedQuote') anomalies.push(a);
    else notes.push(`${a.code} near row ${a.row}`);
  }
  const rows = tk.rows;
  if (!rows.length || rows.every((r) => r.every((c) => String(c ?? '').trim() === ''))) {
    return refuse('The file is empty.');
  }
  // ── structure: find the header, cut the primary table out
  const hdr = findHeaderRow(rows);
  const useHeader = !!hdr && hdr.score >= 40 && hdr.kinds.includes('date')
    && (hdr.kinds.includes('amount') || hdr.kinds.includes('balance'));
  const headerIdx = useHeader ? hdr.index : null;
  const arity = useHeader ? hdr.cells.length : modeOf(rows.map((r) => r.length));
  const { body, dropped } = segment(rows, headerIdx, arity);
  report.headerRow = headerIdx;
  if (useHeader && body.length) {
    // Hard rule (§5.2): the header must split into the same number of columns
    // as the body, or an unquoted delimiter is shifting columns somewhere
    // (`ACME CORP, INC.` in an unquoted description). Never auto-import that.
    const bodyMode = modeOf(body.map((b) => b.cells.length));
    if (bodyMode !== arity) {
      questions.push({
        kind: 'columnAlignment', blocking: true, answerable: false,
        message: `The header row of this file splits into ${arity} columns but most rows below it split `
          + `into ${bodyMode} — usually an unquoted comma inside a description. The columns can’t be `
          + 'trusted to line up, so this file can’t be imported safely as-is.',
      });
      return blocked();
    }
  }
  report.counts.junk = dropped.filter((d) => d.why === 'JUNK').length;
  if (!body.length) return refuse('No transaction rows were found in this file.');
  if (report.counts.junk / (report.counts.junk + body.length) >= 0.2) {
    return refuse('Too much of this file doesn’t look like transaction rows to import it safely.');
  }

  // ── roles — sampled from rows that look like data, so a block of footer
  // text (Fidelity ships 14 disclaimer rows) can't dilute the column shapes
  const dataish = body.filter((b) => b.cells.some((c) => isDateish(c) || isMoneyish(c)));
  const sample = (dataish.length ? dataish : body).slice(0, 40).map((b) => b.cells);
  let roles = useHeader ? assignRoles(hdr.cells, sample) : positionalRoles(sample);
  if (useHeader && norm(hdr.cells[hdr.cells.length - 1]) === ''
      && sample.filter((r) => String(r[hdr.cells.length - 1] ?? '').trim() === '').length / sample.length >= 0.95) {
    roles = roles.slice(0, -1); // phantom column from a trailing delimiter
  }
  if (!roles.includes('date') && roles.includes('datePosted')) {
    roles[roles.indexOf('datePosted')] = 'date'; // "Posted Date" is the only date there is
  }
  report.roles = roles;
  const iOf = (r) => roles.indexOf(r);
  const iDate = iOf('date'), iDate2 = iOf('datePosted'), iAmt = iOf('amount'),
    iDeb = iOf('debit'), iCred = iOf('credit'), iBal = iOf('balance'),
    iDir = iOf('direction'), iId = iOf('id'), iCheck = iOf('check'),
    iCat = iOf('category'), iAcct = iOf('account');
  const descCols = roles.map((r, i) => (r === 'desc' ? i : -1)).filter((i) => i >= 0);
  const memoCols = roles.map((r, i) => (r === 'memo' ? i : -1)).filter((i) => i >= 0);
  const dirCols = roles.map((r, i) => (r === 'direction' ? i : -1)).filter((i) => i >= 0);
  if (iDate < 0) return refuse('No date column could be found in this file, so it can’t be imported.');
  if (iAmt < 0 && iDeb < 0 && iCred < 0) {
    return refuse('No amount column could be found in this file, so it can’t be imported.');
  }

  // ── date order — decided per column, never per value (§5.5)
  const ord = inferDateOrder(body.map((b) => b.cells[iDate]));
  if (ord.fatal) {
    return refuse('The date column mixes more than one date format — some rows read day-first and others '
      + 'month-first. This usually happens when a spreadsheet program half-converted the file. '
      + 'It can’t be read safely, so nothing was imported.');
  }
  let dateOrder = answers.dateOrder || ord.order;
  if (!dateOrder) {
    const samples = body.slice(0, 3).map((b) => ({
      raw: String(b.cells[iDate]).trim(),
      asMDY: parseDate(b.cells[iDate], 'MDY'),
      asDMY: parseDate(b.cells[iDate], 'DMY'),
      vendor: descCols.map((i) => String(b.cells[i] ?? '').trim()).filter(Boolean).join(' '),
    }));
    questions.push({
      kind: 'dateOrder', blocking: true, answerable: true, answerKey: 'dateOrder',
      message: 'Every date in this file could be read two ways — which is right?',
      samples,
      options: [
        { value: 'MDY', label: `Month first (US) — ${samples[0]?.raw} is ${inWords(samples[0]?.asMDY)}` },
        { value: 'DMY', label: `Day first — ${samples[0]?.raw} is ${inWords(samples[0]?.asDMY)}` },
      ],
    });
    // Parse on provisionally (month-first) so the preview has something to
    // show — the question BLOCKS the import until the user answers it.
    dateOrder = 'MDY';
  }
  if (dateOrder === 'DMY') {
    // Decision D1: day-first files are recognised and refused, never misread.
    return refuse('The dates in this file are day-first (DD/MM/YYYY). Day-first exports aren’t supported '
      + 'yet — importing one would put transactions in the wrong months — so nothing was imported.');
  }
  report.dateOrder = dateOrder;

  // ── decimal mark — one decision for all money columns pooled (§5.6)
  const moneyCols = [iAmt, iDeb, iCred, iBal].filter((i) => i >= 0);
  const pooled = body.flatMap((b) => moneyCols.map((i) => stripAmount(b.cells[i])))
    .filter((s) => s.cleaned).map((s) => s.cleaned);
  if (!pooled.length) return refuse('No readable amounts were found in this file.');
  const dm = decideDecimalMark(pooled);
  let mark = answers.decimalMark || (dm.conflict ? null : dm.mark);
  if (!mark) {
    questions.push({
      kind: 'decimalMark', blocking: true, answerable: true, answerKey: 'decimalMark',
      message: `Amounts like “${pooled[0]}” could be read two ways — which is right?`,
      options: [
        { value: '.', label: 'The comma groups thousands — 1,234 means one thousand two hundred thirty-four dollars' },
        { value: ',', label: 'The comma is the decimal point — 1,234 means about $1.23 (European style)' },
      ],
    });
    return blocked();
  }
  if (mark === ',') {
    // Decision D1: comma decimals are a European format — refuse by name.
    return refuse('The amounts in this file use a comma as the decimal mark (like 1.234,56), which European '
      + 'banks do. That format isn’t supported yet, so nothing was imported.');
  }
  report.decimalMark = mark;

  // ── build records in exact cents
  const col = (i) => (i < 0 ? null : body.map((b) => centsOf(stripAmount(b.cells[i]), mark)));
  const A = col(iAmt), Db = col(iDeb), Cr = col(iCred), Bl = col(iBal);
  const records = [];
  let pendingSkipped = 0;
  body.forEach((b, k) => {
    const rowNo = b.i + 1; // 1-based line-ish position in the file
    const date = parseDate(b.cells[iDate], dateOrder);
    const amountsEmpty = A ? A[k] == null : (Db ? Db[k] : null) == null && (Cr ? Cr[k] : null) == null;
    if (!date) {
      // A garbage date with no money on the row is footer noise; with money on
      // the row it's a real error the user must see (A3).
      if (!amountsEmpty) anomalies.push({ row: rowNo, code: 'BadDate', msg: String(b.cells[iDate]).trim() });
      return;
    }
    let amountCents;
    if (A) {
      const c = A[k];
      if (c == null) return; // populated balance + empty amount = "Beginning balance" style row
      if (Number.isNaN(c)) { anomalies.push({ row: rowNo, code: 'BadAmount', msg: String(b.cells[iAmt]).trim() }); return; }
      amountCents = c;
    } else {
      let d = Db ? Db[k] : null, c = Cr ? Cr[k] : null;
      if (Number.isNaN(d) || Number.isNaN(c)) {
        anomalies.push({ row: rowNo, code: 'BadAmount', msg: String(b.cells[Number.isNaN(d) ? iDeb : iCred]).trim() });
        return;
      }
      if (d != null && d < 0) { c = -d; d = null; } // a negative debit is a credit
      else if (c != null && c < 0) { d = -c; c = null; }
      const dz = !d, cz = !c; // null and 0 both mean "this side is unused"
      if (dz && cz) return; // spacer row
      if (!dz && !cz) { anomalies.push({ row: rowNo, code: 'BothSides', msg: 'both debit and credit are filled — not netted' }); return; }
      amountCents = dz ? Math.abs(c) : -Math.abs(d);
    }
    const dirVals = dirCols.map((i) => String(b.cells[i] ?? '').trim());
    if (dirVals.some((v) => /^pending$/i.test(v))) { pendingSkipped++; return; } // pending re-posts later (C3)
    const dedupe = [];
    for (const i of descCols) {
      const v = String(b.cells[i] ?? '').trim();
      if (v && !dedupe.some((x) => x.toLowerCase() === v.toLowerCase())) dedupe.push(v);
    }
    const vendor = dedupe.join(' · ');
    const memo = memoCols.map((i) => String(b.cells[i] ?? '').trim()).filter(Boolean).join(' · ');
    const bankCategory = iCat >= 0 ? String(b.cells[iCat] ?? '').trim() : '';
    records.push({
      date,
      vendor,
      amountCents,
      account: iAcct >= 0 ? String(b.cells[iAcct] ?? '').trim() : '',
      bankCategory,
      isCardPayment: isCardPaymentRow(vendor, bankCategory),
      memo,
      postedDate: iDate2 >= 0 ? parseDate(b.cells[iDate2], dateOrder) : null,
      externalId: iId >= 0 ? String(b.cells[iId] ?? '').trim() : '',
      checkNumber: iCheck >= 0 ? String(b.cells[iCheck] ?? '').trim() : '',
      balanceCents: Bl ? Bl[k] : null,
      direction: dirVals[0] || '',
      rowIndex: rowNo,
      raw: b.cells,
    });
  });
  if (!records.length) {
    report.counts.pending = pendingSkipped;
    return refuse('No usable transactions were found in this file.'
      + (anomalies.length ? ` ${anomalies.length} row(s) could not be read.` : ''));
  }

  // ── sign convention (§5.7)
  const usedSplit = !A;
  let sign;
  if (usedSplit) {
    sign = { verdict: 'as-is', decided: true, source: 'split-columns' };
  } else {
    // Unsigned amounts + a direction column = Mint's pattern.
    const dirTokens = records.map((r) => r.direction).filter(Boolean);
    const distinct = [...new Set(dirTokens.map((t) => t.toLowerCase()))];
    const looksDirectional = dirCols.length > 0
      && dirTokens.length >= records.length * 0.9
      && distinct.length <= 4
      && distinct.every((t) => DIRECTION_TOKENS.test(t))
      && records.every((r) => r.amountCents >= 0);
    if (looksDirectional) {
      for (const r of records) if (OUTFLOW_TOKENS.test(r.direction)) r.amountCents = -Math.abs(r.amountCents);
      sign = { verdict: 'as-is', decided: true, source: 'direction' };
      notes.push('applied the direction column to unsigned amounts');
    } else if (answers.signConvention) {
      sign = { verdict: answers.signConvention, decided: true, source: 'user' };
      if (answers.signConvention === 'flip') for (const r of records) r.amountCents = -r.amountCents;
    } else {
      sign = detectSign(records);
      if (sign.decided && sign.verdict === 'flip') for (const r of records) r.amountCents = -r.amountCents;
      if (!sign.decided) {
        const s = records.find((r) => r.amountCents < 0) || records[0];
        const amt = (Math.abs(s.amountCents) / 100).toFixed(2);
        const shown = `${s.amountCents < 0 ? '−' : ''}$${amt} ${s.vendor}`.trim();
        questions.push({
          kind: 'signConvention', blocking: true, answerable: true, answerKey: 'signConvention',
          message: `In this file, does “${shown}” mean money LEFT your account?`,
          samples: records.slice(0, 3).map((r) => ({ vendor: r.vendor, amountCents: r.amountCents, date: r.date })),
          options: s.amountCents < 0
            ? [{ value: 'as-is', label: 'Yes — negative amounts are money out' },
               { value: 'flip', label: 'No — negative amounts are money in (flip them)' }]
            : [{ value: 'flip', label: 'Yes — positive amounts are money out (flip them)' },
               { value: 'as-is', label: 'No — positive amounts are money in' }],
        });
      }
    }
  }
  report.signConvention = sign;

  // ── balance reconciliation — the hard gate (§5.7a). After any flip, the
  // final amounts must match the balance deltas or the file is refused.
  const withBalance = records.filter((r) => Number.isFinite(r.balanceCents)).length;
  if (withBalance >= 3) {
    const ev = balanceEvidence(records);
    if (ev && ev.verdict === 'as-is') {
      report.balanceCheck = { ran: true, ok: true, tested: ev.tested, rowOrder: ev.rowOrder };
    } else if (!questions.length) {
      // (While a sign question is open the amounts aren't final — the gate
      // re-runs on the answered pass.)
      report.balanceCheck = { ran: true, ok: false };
      return refuse('This file has a running-balance column, but the amounts don’t add up against it '
        + 'in any direction. The file may be mis-formatted or misread, so nothing was imported.');
    }
  }

  // ── report
  const included = records;
  const inC = included.reduce((a, r) => a + (r.amountCents > 0 ? r.amountCents : 0), 0);
  const outC = included.reduce((a, r) => a + (r.amountCents < 0 ? r.amountCents : 0), 0);
  const dates = included.map((r) => r.date).sort();
  report.counts = { rows: included.length, junk: report.counts.junk, pending: pendingSkipped, anomalies: anomalies.length };
  report.totals = { inCents: inC, outCents: outC, netCents: inC + outC, dateMin: dates[0], dateMax: dates[dates.length - 1] };

  // Dollars at the boundary — cents never leave the importer as `amount`.
  for (const r of records) r.amount = r.amountCents / 100;
  return blocked(records);
}
