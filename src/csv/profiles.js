// Stage 3: the profile registry (proposal §6). A fingerprint of the header is
// looked up BEFORE any inference runs; a hit supplies the roles, date order and
// decimal mark outright, so a format the user has confirmed once never goes
// through heuristics again. The balance verification still always runs.
//
// Two tiers with different levels of trust:
//   seed  — shipped research data. Structure (roles/dates/decimal) is applied,
//           but a signed-amount signConvention is only EVIDENCE for detectSign
//           (§5.7d): the seed's own warnings document header collisions where
//           the same header means opposite signs (Amex vs generic, Discover vs
//           Chase). Two entries are recognitionOnly (D1) — matched only to
//           refuse by name.
//   user  — formats the owner has confirmed by importing. Fully authoritative,
//           including the sign and any question answers that were given.
import seedRegistry from './bank-profiles.seed.js';

// Seed role vocabulary → the pipeline's internal names.
const ROLE_MAP = {
  date_transaction: 'date', date_posted: 'datePosted', description: 'desc',
  amount_debit: 'debit', amount_credit: 'credit', check_number: 'check',
  external_id: 'id', status: 'direction', currency: 'ignore',
};
const mapRole = (r) => ROLE_MAP[r] ?? r;

// Normalise header cells the way the registry stores them: trimmed, lowered,
// with trailing empties dropped (a trailing delimiter adds a phantom cell).
export function normHeaderCells(cells) {
  const out = cells.map((c) => String(c ?? '').trim().toLowerCase());
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

// Stable fingerprint of a file shape: FNV-1a over the normalised header cells,
// the field count and the headerless flag. Exact — fuzzy matching is what the
// inference fallback is for.
export function fingerprintOf(headerCells, fieldCount, headerless) {
  const key = `${(headerCells || []).join('\u0001')}\u0002${fieldCount}\u0002${headerless ? 'H' : ''}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return 'fnv1a:' + h.toString(16).padStart(8, '0');
}

// userProfiles are entries persisted in bank-profiles.json (userData); they
// layer over the seed and win on equal match.
export function matchProfile(headerCells, arity, { userProfiles = [] } = {}) {
  const headerless = headerCells == null;
  const cells = headerless ? null : normHeaderCells(headerCells);

  for (const p of userProfiles) {
    if (!p?.match) continue;
    if (headerless) {
      if (p.match.headerless && p.match.fieldCount === arity) return { profile: p, source: 'user' };
    } else if (!p.match.headerless && sameCells(cells, p.match.headerCells)) {
      return { profile: p, source: 'user' };
    }
  }

  if (headerless) {
    // Headerless seed matching only on an explicit headerless flag, and only
    // when exactly one candidate has this field count — anything else falls
    // back to positional inference.
    const hits = seedRegistry.profiles.filter((p) => p.headerless && p.fieldCount === arity);
    return hits.length === 1 ? { profile: hits[0], source: 'seed' } : null;
  }
  for (const p of seedRegistry.profiles) {
    if (!p.headerCells) continue;
    const pc = p.headerCells;
    if (p.headerPrefixOnly) {
      if (cells.length >= pc.length && pc.every((c, i) => cells[i] === c)) return { profile: p, source: 'seed' };
    } else if (sameCells(cells, pc)) {
      return { profile: p, source: 'seed' };
    }
  }
  return null;
}

const sameCells = (a, b) => !!a && !!b && a.length === b.length && a.every((c, i) => c === b[i]);

// What a matched profile hands the pipeline. Roles come back in internal
// vocabulary; null means the profile can't drive this file (length mismatch —
// fall back to inference rather than misalign columns).
export function applyProfile(match, effArity) {
  const p = match.profile;
  const roles = (p.roles || []).map(mapRole);
  // A prefix-only profile (PayPal declares 10 of its 41 columns) covers the
  // leading columns; the caller infers roles for the rest and overlays these.
  if (p.headerPrefixOnly ? roles.length > effArity : roles.length !== effArity) return null;
  return {
    prefixOnly: !!p.headerPrefixOnly && roles.length < effArity,
    id: p.id,
    name: p.name || null,
    source: match.source,
    roles,
    dateOrder: p.dateOrder === 'AUTO' || p.dateOrder === 'UNKNOWN' ? null : p.dateOrder || null,
    decimalMark: p.decimalMark || null,
    signConvention: p.signConvention || null,
    // A user-confirmed sign is applied outright; a seed sign for a signed
    // amount column is only a hint (collision warnings in the seed itself).
    signAuthoritative: match.source === 'user',
    directionTokens: p.directionTokens || null,
    pendingRule: p.pendingRule || null,
    recognitionOnly: !!p.recognitionOnly,
  };
}

// The entry the app persists after a user-confirmed import (§6): everything
// the next import of this shape needs to skip inference entirely.
export function buildResolvedProfile({ headerCells, arity, headerless, report, matched }) {
  const cells = headerless ? null : normHeaderCells(headerCells);
  const fingerprint = fingerprintOf(cells, arity, headerless);
  return {
    fingerprint,
    id: matched?.id || 'user-' + fingerprint.slice(6),
    name: matched?.name || null,
    match: { headerCells: cells, fieldCount: arity, headerless },
    delimiter: report.delimiter,
    decimalMark: report.decimalMark,
    dateOrder: report.dateOrder,
    roles: report.roles,
    signConvention: report.signConvention?.stored || 'as-is',
    pendingRule: matched?.pendingRule || null,
  };
}
