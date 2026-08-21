// Stage 7: which way do the signs point? Four evidence sources (proposal §5.7).
// Balance reconciliation is exact integer math and wins outright; everything
// else only accumulates confidence, and an undecided verdict must ASK.

// (a) Balance deltas. balance[i] − balance[i−1] === amount[i] is an exact test
// in cents. Banks export newest-first too, so retry reversed, then date-sorted.
export function balanceEvidence(rows) {
  const r = rows.filter((x) => Number.isFinite(x.balanceCents) && Number.isFinite(x.amountCents));
  if (r.length < 3) return null;
  const test = (seq) => {
    let asIs = 0, flipped = 0, tested = 0;
    for (let i = 1; i < seq.length; i++) {
      const delta = seq[i].balanceCents - seq[i - 1].balanceCents;
      if (delta === 0 && seq[i].amountCents === 0) continue;
      tested++;
      if (delta === seq[i].amountCents) asIs++;
      else if (delta === -seq[i].amountCents) flipped++;
    }
    return { asIs, flipped, tested };
  };
  const orderings = [
    [r, 'file'],
    [[...r].reverse(), 'reversed'],
    [[...r].sort((a, b) => (a.date < b.date ? -1 : 1)), 'date-sorted'],
  ];
  for (const [seq, rowOrder] of orderings) {
    const { asIs, flipped, tested } = test(seq);
    if (!tested) continue;
    // ≥90%, not 100% — some banks compute the balance out of order for same-day clears.
    if (asIs / tested >= 0.9) return { verdict: 'as-is', confidence: asIs / tested, source: 'balance', tested, rowOrder };
    if (flipped / tested >= 0.9) return { verdict: 'flip', confidence: flipped / tested, source: 'balance', tested, rowOrder };
  }
  return { verdict: null, source: 'balance', tested: r.length };
}

// (b) Distribution: consumer accounts show many small debits, few large
// credits. Medians, not means — one payroll deposit dominates a mean.
export function distributionEvidence(rows) {
  const a = rows.map((r) => r.amountCents).filter((v) => Number.isFinite(v) && v !== 0);
  if (a.length < 6) return null;
  const neg = a.filter((v) => v < 0), pos = a.filter((v) => v > 0);
  if (!neg.length || !pos.length) return { verdict: null, source: 'distribution', unsigned: true };
  const med = (xs) => { const s = xs.map(Math.abs).sort((x, y) => x - y); return s[s.length >> 1]; };
  const negFrac = neg.length / a.length, negMed = med(neg), posMed = med(pos);
  const asIs = (negFrac > 0.6 ? 1 : 0) + (posMed > negMed * 2 ? 1 : 0);
  const flip = (negFrac < 0.4 ? 1 : 0) + (negMed > posMed * 2 ? 1 : 0);
  if (asIs === flip) return { verdict: null, source: 'distribution' }; // abstain — savings/investment pattern
  return { verdict: asIs > flip ? 'as-is' : 'flip', confidence: 0.5 + 0.15 * Math.abs(asIs - flip), source: 'distribution' };
}

// (c) Description keywords. Bare "payment" casts no vote — BILL PAYMENT is a
// debit while PAYMENT THANK YOU is the strongest credit token there is.
const CREDIT_WORDS = /\b(payment thank you|payment - thank|thank you|deposit|direct dep|payroll|salary|interest (paid|earned)|refund|reversal|cashback|dividend|rebate|reimbursement|transfer from)\b/i;
const DEBIT_WORDS = /\b(purchase|pos debit|card purchase|withdrawal|atm|fee|charge|check #|bill payment|payment to|subscription)\b/i;

export function keywordEvidence(rows) {
  let agree = 0, disagree = 0;
  for (const r of rows) {
    if (!r.vendor || !r.amountCents) continue;
    const c = CREDIT_WORDS.test(r.vendor), d = DEBIT_WORDS.test(r.vendor);
    if (c === d) continue; // abstain on both-or-neither
    ((r.amountCents > 0) === c) ? agree++ : disagree++;
  }
  const n = agree + disagree;
  if (n < 2) return null;
  const frac = Math.max(agree, disagree) / n;
  if (frac < 0.75) return { verdict: null, source: 'keywords' };
  return { verdict: agree > disagree ? 'as-is' : 'flip', confidence: frac, source: 'keywords', n };
}

// Combine. Balance wins outright; otherwise the top verdict must score ≥1.2
// AND lead by ≥0.5, or the caller has to ask the user.
export function detectSign(rows, { profileHint = null } = {}) {
  const bal = balanceEvidence(rows);
  if (bal?.verdict) return { ...bal, decided: true };
  const evidence = [distributionEvidence(rows), keywordEvidence(rows)].filter((e) => e?.verdict);
  if (profileHint) evidence.push({ verdict: profileHint, confidence: 0.8, source: 'profile' });
  if (!evidence.length) return { verdict: null, decided: false, balanceTried: !!bal };
  const score = {};
  for (const e of evidence) score[e.verdict] = (score[e.verdict] || 0) + e.confidence;
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  const decided = ranked[0][1] >= 1.2 && (!ranked[1] || ranked[0][1] - ranked[1][1] >= 0.5);
  return { verdict: ranked[0][0], confidence: ranked[0][1], decided, sources: evidence.map((e) => e.source) };
}
