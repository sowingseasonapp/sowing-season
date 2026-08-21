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
import { assignRoles, positionalRoles, DIRECTION_TOKENS, OUT_TOKENS, IN_TOKENS } from './roles.js';
import { stripAmount, decideDecimalMark, centsOf, inferDateOrder, parseDate } from './values.js';
import { detectSign, balanceEvidence } from './sign.js';
import { matchProfile, applyProfile, buildResolvedProfile } from './profiles.js';

// Same heuristic as the legacy csv.js path, so both paths agree on what a
// card payment looks like.
function isCardPaymentRow(vendor, bankCategory) {
  return /payment\/credit/i.test(bankCategory)
    || /online pymt|autopay pymt|payment thank you/i.test(vendor)
    || /capital one.*\b(mobile|online|autopay)?\s*(pymt|pmt)\b/i.test(vendor);
}

// Status values that mean the money hasn't (or won't) settle — the flag list
// from the format reference: Citi/Schwab "Pending", PayPal Placed/Denied/
// Reversed, Venmo Issued/Failed/Expired, Revolut Declined/Reverted, Wise
// Cancelled. These rows re-post later (or never) — importing them now
// guarantees a duplicate or a phantom transaction (C3).
const NOT_SETTLED = /^(pending|placed|denied|reversed|issued|failed|expired|declined|reverted|cancell?ed)$/i;

// Which way does each direction token point? The mapping is DATA, never code
// (§5.4): the balance column proves it exactly; below that, an answer, a
// profile, or the unambiguous debit/credit families. Balance votes are taken
// per token over the same three row orderings the sign verifier uses.
function directionFromBalance(records, tokens) {
  const rows = records.map((r, i) => ({ a: Math.abs(r.amountCents), b: r.balanceCents, d: r.date, t: tokens[i] }))
    .filter((x) => Number.isFinite(x.b) && Number.isFinite(x.a) && x.t);
  if (rows.length < 3) return null;
  const orderings = [rows, [...rows].reverse(), [...rows].sort((p, q) => (p.d < q.d ? -1 : p.d > q.d ? 1 : 0))];
  for (const seq of orderings) {
    const votes = new Map(); // token → {out, in}
    let ok = 0, tested = 0;
    for (let i = 1; i < seq.length; i++) {
      const delta = seq[i].b - seq[i - 1].b, a = seq[i].a;
      if (delta === 0 && a === 0) continue;
      tested++;
      const v = votes.get(seq[i].t) || { out: 0, in: 0 };
      if (delta === -a) { v.out++; ok++; } else if (delta === a) { v.in++; ok++; }
      votes.set(seq[i].t, v);
    }
    if (tested < 2 || ok / tested < 0.9) continue;
    const mapping = {};
    let consistent = true;
    for (const [t, v] of votes) {
      const n = v.out + v.in;
      if (!n) continue;
      if (v.out / n >= 0.9) mapping[t] = 'out';
      else if (v.in / n >= 0.9) mapping[t] = 'in';
      else consistent = false; // one token points both ways — not a direction column
    }
    if (consistent && Object.keys(mapping).length) return mapping;
  }
  return null;
}

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
  if (dropped.some((d) => d.why === 'NEWTABLE')) {
    // the owner's Phase 4 decision: a file holding a second table is an
    // investment export (Vanguard, Interactive Brokers) — envelope budgeting
    // shouldn't ingest those, so refuse by shape instead of half-importing.
    return refuse('This file contains more than one table — investment and brokerage exports are laid out '
      + 'this way, and they aren’t something a budget can ingest safely. Nothing was imported. '
      + 'If this is a bank statement, try exporting just the transactions.');
  }
  if (!body.length) return refuse('No transaction rows were found in this file.');
  if (report.counts.junk / (report.counts.junk + body.length) >= 0.2) {
    return refuse('Too much of this file doesn’t look like transaction rows to import it safely.');
  }

  // ── roles — sampled from rows that look like data, so a block of footer
  // text (Fidelity ships 14 disclaimer rows) can't dilute the column shapes
  const dataish = body.filter((b) => b.cells.some((c) => isDateish(c) || isMoneyish(c)));
  const sample = (dataish.length ? dataish : body).slice(0, 40).map((b) => b.cells);
  const phantom = useHeader && norm(hdr.cells[hdr.cells.length - 1]) === ''
    && sample.filter((r) => String(r[hdr.cells.length - 1] ?? '').trim() === '').length / sample.length >= 0.95;
  const effArity = phantom ? arity - 1 : arity;

  // ── fingerprint-first (§6): a registry hit skips inference entirely. The
  // seed's non-US entries are recognition-only — matched just to refuse by name.
  let prof = null;
  if (!answers.ignoreProfile) {
    const m = matchProfile(useHeader ? hdr.cells : null, arity, { userProfiles: opts.profiles || [] });
    if (m?.profile.recognitionOnly) {
      return refuse(`This looks like a ${m.profile.name} export, which isn’t supported yet — `
        + 'it uses a format (day-first dates, or comma decimals) that would be misread as US data. '
        + 'Nothing was imported.');
    }
    if (m) {
      prof = applyProfile(m, effArity); // null on a length mismatch → fall back to inference
      if (prof) report.profile = { id: prof.id, name: prof.name, source: prof.source };
    }
  }

  let roles;
  if (prof && prof.prefixOnly) {
    roles = assignRoles(hdr.cells, sample);
    if (phantom) roles = roles.slice(0, -1);
    prof.roles.forEach((r, i) => { roles[i] = r; }); // declared prefix wins
  } else if (prof) {
    roles = prof.roles.slice();
  } else {
    roles = useHeader ? assignRoles(hdr.cells, sample) : positionalRoles(sample);
    if (phantom) roles = roles.slice(0, -1); // phantom column from a trailing delimiter
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
  // Precedence: a user answer, then what the data itself proves, then a
  // USER-confirmed profile's stored order (how an answered question is
  // remembered), then ask. Data beats profile so a stale profile can't misread
  // a column the values decide. A SEED profile's order deliberately can't
  // resolve ambiguity — generic headers collide (Amex's is literally
  // Date,Description,Amount), and a DD/MM file wearing that header must still
  // ask, never inherit MDY from a coincidental match.
  let dateOrder = answers.dateOrder || ord.order || (prof?.source === 'user' ? prof.dateOrder : null);
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
  // Same precedence as dates: answer, then the column's own evidence, then a
  // user-confirmed profile (a seed mark can't resolve ambiguity, for the same
  // collision reason as dates). A conflict in the data always asks.
  let mark = answers.decimalMark
    || (dm.conflict ? null : (dm.mark || (prof?.source === 'user' ? prof.decimalMark : null)));
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
  // A profile pendingRule names the column and value that mark pending rows
  // (Citi's Status=Pending); the generic direction-column check runs as well.
  let pendCol = -1, pendVal = null;
  if (prof?.pendingRule?.column && useHeader) {
    pendCol = hdr.cells.findIndex((c) => norm(c) === norm(prof.pendingRule.column));
    pendVal = String(prof.pendingRule.pendingValue ?? 'Pending').toLowerCase();
  }
  // Apple Card has no Status column at all — a blank Clearing Date IS the
  // pending marker. Generic: a clearing/settled/completed-flavoured second
  // date column left empty means the row hasn't posted yet.
  const blankPostedIsPending = iDate2 >= 0 && useHeader
    && /clear|settle|complet/.test(norm(hdr.cells[iDate2] ?? ''));
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
    if (dirVals.some((v) => NOT_SETTLED.test(v))
        || (pendCol >= 0 && String(b.cells[pendCol] ?? '').trim().toLowerCase() === pendVal)
        || (blankPostedIsPending && String(b.cells[iDate2] ?? '').trim() === '')) {
      pendingSkipped++; return; // pending re-posts later with a new date (C3)
    }
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
    // Unsigned amounts + a direction column = Mint's pattern. Each
    // direction-role column is evaluated as a signing candidate; the first one
    // whose tokens can ALL be pinned wins. Per token the precedence is:
    // balance proof > the user's answer > a profile's stored mapping > the
    // unambiguous debit/credit families. A direction-vocabulary token nothing
    // can pin ASKS; a column of tokens outside the vocabulary with no balance
    // proof simply isn't a direction column.
    let directional = null, dirQuestions = null;
    if (records.every((r) => r.amountCents >= 0)) {
      for (const ci of dirCols) {
        const tokens = records.map((r) => String(r.raw[ci] ?? '').trim().toLowerCase());
        const nonEmpty = tokens.filter(Boolean);
        const distinct = [...new Set(nonEmpty)];
        if (!distinct.length || distinct.length > 4 || nonEmpty.length < records.length * 0.9) continue;
        const fromBalance = directionFromBalance(records, tokens) || {};
        const mapping = {}, unresolved = [];
        let junk = false;
        for (const t of distinct) {
          const ans = answers['dir:' + t];
          const m = fromBalance[t]
            || (ans === 'out' || ans === 'in' ? ans : null)
            || prof?.directionTokens?.[t]
            || (OUT_TOKENS.test(t) ? 'out' : IN_TOKENS.test(t) ? 'in' : null);
          if (m === 'out' || m === 'in') mapping[t] = m;
          else if (DIRECTION_TOKENS.test(t)) unresolved.push(t);
          else { junk = true; break; }
        }
        if (junk) continue;
        if (unresolved.length) {
          const colName = useHeader ? String(hdr.cells[ci]).trim() : 'Type';
          dirQuestions = dirQuestions || unresolved.map((t) => ({
            kind: 'direction', blocking: true, answerable: true, answerKey: 'dir:' + t,
            message: `Every amount in this file is positive, and the “${colName}” column says which way the money went. Does “${t}” mean money LEFT your account?`,
            options: [
              { value: 'out', label: `Yes — “${t}” rows are money out` },
              { value: 'in', label: `No — “${t}” rows are money in` },
            ],
          }));
          continue; // another direction column may still resolve cleanly
        }
        directional = { tokens, mapping, provenByBalance: Object.keys(fromBalance).length > 0 };
        break;
      }
    }
    if (directional) {
      records.forEach((r, k) => {
        if (directional.mapping[directional.tokens[k]] === 'out') r.amountCents = -Math.abs(r.amountCents);
      });
      sign = { verdict: 'as-is', decided: true, source: 'direction', directionTokens: directional.mapping };
      notes.push(directional.provenByBalance
        ? 'the balance column proved which direction values are money out'
        : 'applied the direction column to unsigned amounts');
    } else if (dirQuestions) {
      questions.push(...dirQuestions);
      sign = { verdict: null, decided: false, source: 'direction' };
    } else if (answers.signConvention) {
      sign = { verdict: answers.signConvention, decided: true, source: 'user' };
      if (answers.signConvention === 'flip') for (const r of records) r.amountCents = -r.amountCents;
    } else if (prof?.signAuthoritative && (prof.signConvention === 'as-is' || prof.signConvention === 'flip'
        || prof.signConvention === 'parentheses')) {
      // A format the user confirmed before: zero heuristics (§6 steady state).
      const verdict = prof.signConvention === 'flip' ? 'flip' : 'as-is';
      sign = { verdict, decided: true, source: 'profile' };
      if (verdict === 'flip') for (const r of records) r.amountCents = -r.amountCents;
    } else {
      // A seed profile's sign is EVIDENCE, not a verdict — the seed documents
      // header collisions (Amex vs generic 3-column, Discover vs Chase) where
      // the same header carries opposite signs. detectSign weighs it at 0.8
      // against the distribution and keyword votes.
      const hint = prof && (prof.signConvention === 'flip' ? 'flip'
        : prof.signConvention === 'as-is' || prof.signConvention === 'parentheses' ? 'as-is' : null);
      sign = detectSign(records, { profileHint: hint });
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

  // ── bank transaction IDs (§8.1): usable for exact duplicate matching only
  // when the column is ≥95% non-empty AND ≥95% distinct within the file —
  // many "Reference" columns are really a category or a constant (Zions
  // repeats one value, or the literal string "null", down the whole column).
  if (iId >= 0 && records.length) {
    const ids = records.map((r) => r.externalId).filter((v) => v && !/^null$/i.test(v));
    report.externalIdTrusted = ids.length >= records.length * 0.95
      && new Set(ids).size >= ids.length * 0.95;
  } else {
    report.externalIdTrusted = false;
  }

  // ── report
  const included = records;
  const inC = included.reduce((a, r) => a + (r.amountCents > 0 ? r.amountCents : 0), 0);
  const outC = included.reduce((a, r) => a + (r.amountCents < 0 ? r.amountCents : 0), 0);
  const dates = included.map((r) => r.date).sort();
  report.counts = { rows: included.length, junk: report.counts.junk, pending: pendingSkipped, anomalies: anomalies.length };
  report.totals = { inCents: inC, outCents: outC, netCents: inC + outC, dateMin: dates[0], dateMax: dates[dates.length - 1] };

  // How this file's convention should be recorded if the user confirms it.
  sign.stored = usedSplit ? 'split-positive'
    : sign.source === 'direction' ? 'unsigned-with-direction'
    : sign.verdict === 'flip' ? 'flip' : 'as-is';
  // The profile the app persists after a user-confirmed import (§6) — with the
  // date order, decimal mark, roles and sign this run resolved (including any
  // question answers), so the next file of this shape skips inference entirely.
  if (!questions.length) {
    report.resolvedProfile = buildResolvedProfile({
      headerCells: useHeader ? hdr.cells : null,
      arity, headerless: !useHeader, report, matched: prof,
    });
  }

  // Dollars at the boundary — cents never leave the importer as `amount`.
  for (const r of records) r.amount = r.amountCents / 100;
  return blocked(records);
}
