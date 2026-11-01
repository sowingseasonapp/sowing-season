// Core budget math — mirrors the spreadsheet's formulas exactly.
// Expenses are negative amounts; income positive.
// Fund leftover = carryOver + planned + expensed   (expensed <= 0 normally)
// Income leftover = carryOver + received - planned

export const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const normFund = (s) => String(s || '').trim().toLowerCase();

export function fundSums(month) {
  const sums = {};
  for (const t of month.transactions) {
    const k = normFund(t.fund);
    sums[k] = r2((sums[k] || 0) + t.amount);
  }
  return sums;
}

// A fund-to-fund transfer: tagged by the transfer dialog, or recognizable by the
// vendor names the dialog (and the owner's own convention) uses.
export function isTransferTx(t) {
  return t.isTransfer === true || /^transfer (to|from) /i.test(String(t.vendor || ''));
}

function transferSums(month) {
  const sums = {};
  for (const t of month.transactions) {
    if (!isTransferTx(t)) continue;
    const k = normFund(t.fund);
    sums[k] = r2((sums[k] || 0) + t.amount);
  }
  return sums;
}

// All fund names (normalized) that exist in the month's structure.
export function knownFunds(month) {
  const set = new Set();
  for (const f of month.income) set.add(normFund(f.fund));
  for (const c of month.categories) for (const f of c.funds) set.add(normFund(f.fund));
  return set;
}

export function computeMonth(month) {
  const sums = fundSums(month);
  const xferSums = transferSums(month);
  const known = knownFunds(month);

  const income = month.income.map((f) => {
    const received = r2(sums[normFund(f.fund)] || 0);
    // An income fund named "Transfer …" exists to receive fund-to-fund moves —
    // everything in it is a transfer, whatever the transaction vendors say.
    const transfers = /transfer/i.test(f.fund) ? received : r2(xferSums[normFund(f.fund)] || 0);
    return { ...f, received, transfers, leftover: r2(f.carryOver + received - f.planned) };
  });
  const incomeTotals = {
    carryOver: r2(income.reduce((a, f) => a + f.carryOver, 0)),
    planned: r2(income.reduce((a, f) => a + f.planned, 0)),
    received: r2(income.reduce((a, f) => a + f.received, 0)),
    transfers: r2(income.reduce((a, f) => a + f.transfers, 0)),
    leftover: r2(income.reduce((a, f) => a + f.leftover, 0)),
  };

  const categories = month.categories.map((c) => {
    const funds = c.funds.map((f) => {
      const expensed = r2(sums[normFund(f.fund)] || 0);
      const transfers = r2(xferSums[normFund(f.fund)] || 0);
      return { ...f, expensed, transfers, leftover: r2(f.carryOver + f.planned + expensed) };
    });
    const totals = {
      carryOver: r2(funds.reduce((a, f) => a + f.carryOver, 0)),
      planned: r2(funds.reduce((a, f) => a + f.planned, 0)),
      expensed: r2(funds.reduce((a, f) => a + f.expensed, 0)),
      transfers: r2(funds.reduce((a, f) => a + f.transfers, 0)),
      leftover: r2(funds.reduce((a, f) => a + f.leftover, 0)),
    };
    return { ...c, funds, totals };
  });

  // Summary excludes categories flagged excludeFromTotals (Work).
  const counted = categories.filter((c) => !c.excludeFromTotals);
  const totals = {
    carryOver: r2(counted.reduce((a, c) => a + c.totals.carryOver, 0)),
    planned: r2(counted.reduce((a, c) => a + c.totals.planned, 0)),
    expensed: r2(counted.reduce((a, c) => a + c.totals.expensed, 0)),
    transfers: r2(counted.reduce((a, c) => a + c.totals.transfers, 0)),
    leftover: r2(counted.reduce((a, c) => a + c.totals.leftover, 0)),
  };

  // Transactions whose fund doesn't match any fund in this month.
  const unassigned = month.transactions.filter((t) => !known.has(normFund(t.fund)) || !normFund(t.fund));

  // 1.3.0 I1: a counted income carry (an unassigned surplus from last month, or a
  // late amount the grace month gave up on) is money to allocate; a pending one
  // (expected late) is not. Inv 2's Left-to-allocate clause.
  const countedCarry = r2(income.reduce((a, f) => a + (f.carryPending ? 0 : f.carryOver), 0));

  return {
    income, incomeTotals, categories, totals,
    summary: {
      plannedIncome: incomeTotals.planned,
      allocated: totals.planned,
      leftToAllocate: r2(incomeTotals.planned + countedCarry - totals.planned),
      countedCarry,                       // new summary field, for the hero's note
      actualIncome: incomeTotals.received,
      actualExpense: totals.expensed,
      actualDiff: r2(incomeTotals.received + totals.expensed),
      // Same actuals with fund-to-fund transfers factored out — used by the
      // reporting surfaces when the "exclude transfers" setting is on.
      actualIncomeExT: r2(incomeTotals.received - incomeTotals.transfers),
      actualExpenseExT: r2(totals.expensed - totals.transfers),
      actualDiffExT: r2((incomeTotals.received - incomeTotals.transfers) + (totals.expensed - totals.transfers)),
    },
    unassigned,
  };
}

// Tithe base:
//  - Standard income (paychecks): checks count × the per-check TITHEABLE amount
//    (gross-ish, before insurance/retirement deductions) — NOT the net planned amount.
//  - Bonus income: planned amount, unless the fund is tithe-exempt (Transfer In).
export function titheBase(month) {
  let base = 0;
  for (const f of month.income) {
    if (f.titheExempt) continue;
    if (f.group === 'standard') {
      const chk = (month.checks || {})[f.fund];
      // No checks set up → fall back to the planned amount.
      base += (chk && chk.count > 0) ? chk.count * (chk.titheAmount || 0) : f.planned;
    } else {
      base += f.planned;
    }
  }
  return r2(base);
}

// ---- Fund setup (v4: fund types) ----
// Every expense fund carries a setup { type, ... }:
//   basic   — all-purpose (utilities). Insights fire after the first transaction:
//             leftover > 0 → available to move; over → needs attention.
//   pacing  — groceries-style, many transactions; on-pace/off-pace through the
//             month is the point. Available-to-move only from the last day on.
//   fixed   — { everyMonths, totalAmount }: same charge on a schedule;
//             auto planned = total ÷ months.
//   savings — two modes (savingsMode, default 'target'):
//             'target' { targetAmount, targetMonth 'YYYY-MM' }: auto planned fills
//               the remaining gap evenly through the target month; insights only in
//               the target month; target rolls +1 year after it passes.
//             'build'  { monthlyAmount }: set aside a fixed amount every month and
//               spend from the pot as needed. Never flagged available-to-move;
//               the only insight is going negative.

export function monthAdd(ym, n) {
  let [y, m] = ym.split('-').map(Number);
  m += n;
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}
export function monthDiff(fromYm, toYm) {
  const [fy, fm] = fromYm.split('-').map(Number);
  const [ty, tm] = toYm.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

// Even monthly contribution to hit the savings target by its month (inclusive).
export function savingsMonthly(monthId, carryOver, s) {
  if (!s.targetMonth || !(s.targetAmount > 0)) return null;
  const months = Math.max(1, monthDiff(monthId, s.targetMonth) + 1);
  return r2(Math.max(0, s.targetAmount - carryOver) / months);
}

// The setup's monthly ask: null for Basic/Pacing (the user sets it), a number
// for Fixed, Build-up and Goal. 1.3.0 sitting B adds three optional setup keys:
//   nextChargeMonth (W7, fixed)  — plan like a goal does: (total − carry) ÷ months
//                                  to the charge, inclusive (the savingsMonthly
//                                  convention). Absent → total ÷ everyMonths, as always.
//   done (W6, target goal)       — the goal is finished: the ask is $0 for good.
//   catchUp (W5, Basic/Pacing/Build-up) — { base, perMonth, until }: a fixed
//                                  add-on through `until`, on top of the auto
//                                  (Build-up) or of `base` (Basic/Pacing).
export function autoPlanned(f, monthId) {
  const s = f.setup;
  if (!s) return null;
  let auto = null;
  if (s.type === 'fixed' && s.everyMonths >= 1) {
    if (s.nextChargeMonth && monthId) {
      const months = Math.max(1, monthDiff(monthId, s.nextChargeMonth) + 1);   // inclusive, like savingsMonthly
      auto = r2(Math.max(0, (s.totalAmount || 0) - (f.carryOver || 0)) / months);
    } else auto = r2((s.totalAmount || 0) / s.everyMonths);
  } else if (s.type === 'savings') {
    if (s.savingsMode === 'build') {
      const amt = s.monthlyAmount || 0;
      // With a goal: contribute only up to the goal (capped), resume if it drops below.
      if (s.buildGoal > 0) auto = r2(Math.min(amt, Math.max(0, s.buildGoal - (f.carryOver || 0))));
      else auto = r2(amt);
    } else {
      if (s.done) return 0;                                   // W6: a done goal never asks again (and gets no catch-up)
      if (monthId) auto = savingsMonthly(monthId, f.carryOver || 0, s);
    }
  }
  // W5: the catch-up add-on — a fixed amount a month through `until`. It does
  // not read carryOver, so a resync that moves the carry never moves planned (S7).
  const cu = s.catchUp;
  if (cu && monthId && monthId <= cu.until) return r2((auto != null ? auto : (cu.base || 0)) + cu.perMonth);
  return auto;
}

export function isOverridden(f, monthId) {
  const auto = autoPlanned(f, monthId);
  return auto != null && Math.abs(f.planned - auto) > 0.004;
}

// 1.2.1 (Option B): where a fund's position came from. Display-only — the
// leftover identity (Inv 2) and carry-over derivation (Inv 6) are untouched.
//   own           this month on its own terms (planned + expensed; ≥ 0 = inside its plan)
//   carriedIn     the negative carry-over that entered the month, else 0
//   overThisMonth with a deficit coming in, what THIS month added; with a
//                 positive carry that carry was spendable money, so over is over
//   carriedOnly   red only because of earlier months — on plan this month
export function fundSplit(f) {
  const own = r2(f.planned + f.expensed);
  const carriedIn = f.carryOver < -0.004 ? f.carryOver : 0;
  const red = f.leftover < -0.004;
  const overThisMonth = !red ? 0 : carriedIn < 0 ? r2(Math.min(0, own)) : f.leftover;
  return { own, carriedIn, overThisMonth, carriedOnly: red && carriedIn < 0 && own >= -0.004 };
}

// Attention/offset flags + pace tags for a computed month (expense funds only;
// Work excluded). todayISO paces the current calendar month; past months are
// judged as complete; future months as not started.
// Pace thresholds: no judging in the first fifth of the month, and the projected
// overrun has to be worth mentioning before a fund is called off pace.
const PACE_GRACE_PCT = 0.2;
const PACE_OVER_FRACTION = 0.05;
const PACE_MIN_OVER = 10;

export function fundFlags(month, comp, todayISO) {
  const nowMonth = todayISO.slice(0, 7);
  const isCurrent = nowMonth === month.id;
  const [y, mo] = month.id.split('-').map(Number);
  const daysIn = new Date(y, mo, 0).getDate();
  const day = isCurrent ? Number(todayISO.slice(8, 10)) : daysIn;
  const monthPct = month.id > nowMonth ? 0 : isCurrent ? day / daysIn : 1;
  const monthDone = month.id < nowMonth || (isCurrent && day >= daysIn);
  const txCount = {};
  for (const t of month.transactions) {
    if (t.amount >= 0) continue;
    const k = normFund(t.fund);
    if (k) txCount[k] = (txCount[k] || 0) + 1;
  }
  const out = [];
  for (const c of comp.categories) {
    if (c.excludeFromTotals) continue;
    for (const f of c.funds) {
      const k = normFund(f.fund);
      const s = f.setup || {};
      if (s.excludeInsights) continue; // fully quiet: no flags, no pace chips
      const type = s.type || 'basic';
      const spent = f.expensed < 0 ? -f.expensed : 0;
      // 1.2.1 (W1): pace judges this month's own money. A negative carry is a
      // debt, not a smaller budget — otherwise steady spending reads "off pace"
      // all month and then "carried-only, fine" at close.
      const ownBudget = r2(Math.max(f.carryOver, 0) + f.planned);
      let attention = null, offset = false, pace = null;

      // 'exceeded' means THIS month overspent its own plan (W1). A deficit that
      // only came in from earlier months is carried, not exceeded.
      const sp = fundSplit(f);
      if (sp.overThisMonth < -0.004) attention = 'exceeded';

      if (type === 'pacing' && isCurrent && !monthDone && ownBudget > 0.004 && !attention) {
        // On/off pace. "Off" means the current spending rate is projected to
        // overrun the budget by a material amount — not merely being ahead of a
        // straight line, which flags every fund that front-loads its spending.
        if (monthPct >= PACE_GRACE_PCT) {
          const projected = spent / monthPct;          // spend at this rate all month
          const slack = Math.max(PACE_MIN_OVER, ownBudget * PACE_OVER_FRACTION);
          pace = projected > ownBudget + slack ? 'off' : 'on';
          if (pace === 'off') attention = 'pace';
        } else {
          pace = 'on'; // too early in the month to judge
        }
      }

      // "Available to move" (S12 rule (a), 1.2.1 W2): a Fixed fund is done once
      // its one bill posts; Basic and Pacing only once the month is over.
      if (!attention && f.leftover > 0.004) {
        if (type === 'fixed') offset = (txCount[k] || 0) >= 1;        // one bill, then it's done
        else if (type === 'basic' || type === 'pacing') offset = monthDone;
        else if (type === 'savings') {
          // Build-over-time pots are never "available to move"; target-date goals
          // only once their target month is over — a goal is spent in its month,
          // not before. A done goal (1.3.0 W6) is free at any month's end.
          offset = s.savingsMode !== 'build' && monthDone && (month.id === s.targetMonth || s.done);
        }
      }

      // A carried-only fund has no attention, offset or pace, but the chips,
      // Review and garden still need its entry to say "carrying".
      if (attention || offset || pace || (sp.carriedIn < 0 && f.leftover < -0.004)) {
        out.push({
          fund: f.fund, category: c.name, type, attention, offset, pace,
          leftover: f.leftover, planned: f.planned, spent: r2(spent), carryOver: f.carryOver,
          own: sp.own, carriedIn: sp.carriedIn, overThisMonth: sp.overThisMonth, carriedOnly: sp.carriedOnly,
          budget: ownBudget,
        });
      }
    }
  }
  return out;
}

// v3 → v4: flag-shaped setups become typed setups.
export function migrateV4(data) {
  if ((data.version || 1) >= 4) return false;
  for (const m of data.months) {
    for (const c of m.categories) {
      for (const f of c.funds) {
        const s = f.setup;
        if (!s || s.type) continue;
        f.setup = {
          type: s.fixedRecurring ? 'fixed' : s.multipleTx ? 'pacing' : 'basic',
          everyMonths: s.everyMonths || 1,
          totalAmount: s.totalAmount || 0,
          targetAmount: 0,
          targetMonth: null,
        };
      }
    }
  }
  data.version = 4;
  return true;
}

// v2 → v3: turn yearly-cost rules into fund setups, and mark historically
// multi-transaction funds so they don't get false "available to move" flags.
export function migrateV3(data) {
  if ((data.version || 1) >= 3) return false;
  const txMonths = {}, txCount = {};
  for (const m of data.months) {
    const seen = {};
    for (const t of m.transactions) {
      if (t.amount >= 0) continue;
      const k = normFund(t.fund);
      if (!k) continue;
      txCount[k] = (txCount[k] || 0) + 1;
      if (!seen[k]) { seen[k] = true; txMonths[k] = (txMonths[k] || 0) + 1; }
    }
  }
  for (const m of data.months) {
    for (const c of m.categories) {
      for (const f of c.funds) {
        if (f.setup) continue;
        const k = normFund(f.fund);
        const avg = txMonths[k] ? txCount[k] / txMonths[k] : 0;
        if (f.rule && f.rule.type === 'yearlyDiv') {
          f.setup = {
            fixedRecurring: true,
            everyMonths: f.rule.divisor,
            totalAmount: f.yearlyCharge != null ? f.yearlyCharge : r2(f.planned * f.rule.divisor),
            multipleTx: false,
          };
          f.rule = null; // planned now comes from the setup
        } else {
          f.setup = { fixedRecurring: false, everyMonths: 1, totalAmount: 0, multipleTx: avg > 1.5 };
        }
      }
    }
  }
  data.version = 3;
  return true;
}

// v4 → v5: migrateV3 typed any fund averaging >1.5 transactions per active month
// as "pacing", which swept in monthly bills that merely post twice. Pace only
// means something when spending is actually spread across the month, so the
// better measure is how many distinct DAYS a fund spends on: a grocery fund
// touches ~15 days a month, an electricity bill exactly one. A one-day fund is
// "100% spent" the moment it posts and reads as off pace forever.
// Only funds still carrying the auto-assigned 'pacing' type are touched.
const PACED_MIN_DAYS_PER_MONTH = 3;

export function migrateV5(data) {
  if ((data.version || 1) >= 5) return { changed: false, retyped: [] };
  const activeMonths = {}, spendDays = {};
  for (const m of data.months) {
    const perFund = {};
    for (const t of m.transactions) {
      if (t.amount >= 0 || isTransferTx(t) || !t.date) continue;
      const k = normFund(t.fund);
      if (!k) continue;
      (perFund[k] = perFund[k] || new Set()).add(t.date);
    }
    for (const [k, days] of Object.entries(perFund)) {
      activeMonths[k] = (activeMonths[k] || 0) + 1;
      spendDays[k] = (spendDays[k] || 0) + days.size;
    }
  }
  const retyped = [];
  for (const m of data.months) {
    for (const c of m.categories) {
      for (const f of c.funds) {
        if (!f.setup || f.setup.type !== 'pacing') continue;
        const k = normFund(f.fund);
        if (!activeMonths[k]) continue; // no history — leave it alone
        const daysPerMonth = spendDays[k] / activeMonths[k];
        if (daysPerMonth < PACED_MIN_DAYS_PER_MONTH) {
          f.setup.type = 'basic';
          if (!retyped.some((r) => normFund(r.fund) === k)) {
            retyped.push({ fund: f.fund, category: c.name, daysPerMonth: Math.round(daysPerMonth * 100) / 100 });
          }
        }
      }
    }
  }
  data.version = 5;
  return { changed: true, retyped };
}

// ---- AUM (assets under management) — v6 ----
// SeedTime-style net worth: AUM = total assets − total debts. Two flat,
// hand-entered lists plus an append-only snapshot history (at most one per
// calendar day) and an item-level change log. Values are always positive for
// both sides ("amount owed" for debts); the subtraction happens here.
// Dates are YYYY-MM-DD strings supplied by the caller (app.js's todayISO()).

export function aumTotals(aum) {
  const sum = (arr) => r2((arr || []).reduce((a, x) => a + (x.value || 0), 0));
  const assets = sum(aum.assets);
  const debts = sum(aum.debts);
  return { assets, debts, aum: r2(assets - debts) };
}

// Write today's totals into the snapshot history: replace the same-day entry
// if one exists, else append — keeping the list sorted by date.
export function upsertSnapshot(aum, dateISO) {
  const t = aumTotals(aum);
  const snap = { date: dateISO, assets: t.assets, debts: t.debts, aum: t.aum };
  const i = aum.snapshots.findIndex((s) => s.date === dateISO);
  if (i >= 0) aum.snapshots[i] = snap;
  else {
    aum.snapshots.push(snap);
    aum.snapshots.sort((a, b) => a.date.localeCompare(b.date));
  }
  return snap;
}

// Most recent updatedAt across a list of assets/debts, or null when empty.
export function aumLastUpdated(items) {
  let max = null;
  for (const x of items) if (x.updatedAt && (!max || x.updatedAt > max)) max = x.updatedAt;
  return max;
}

// v5 → v6: add the top-level aum block. Must run after migrateV5 — it bumps
// the version past 5, which would make migrateV5 skip its re-type pass.
export function migrateV6(data) {
  if ((data.version || 1) >= 6) return false;
  if (!data.aum) data.aum = { assets: [], debts: [], snapshots: [], log: [] };
  data.version = 6;
  return true;
}

// ---- Carry-over integrity — v7 ----
// Carry-over is a derived number: an expense fund's carry-over IS month N−1's
// leftover. An income fund's (1.3.0 I1) follows the decision recorded when
// month N−1 closed — `lateAtClose` on the fund (a pending carry, outside Left to
// allocate) and the closing month's Left to allocate (a counted surplus on the
// host fund, only once `trueUp` is stamped) — see incomePlanFor. buildNextMonth
// seeds both; this keeps them true afterwards, whatever changes in an older
// month — an import, an edit, a deleted transaction, a moved date. Walks months in order,
// so a change anywhere chains forward through every later month in one pass.
// Idempotent: a second call returns []. A fund with no same-named predecessor
// (the budget's first month, or a fund added mid-year) is user-owned — its
// carry-over is an opening balance and is never touched.
//
// Planned (S7, 3-year sim): a planned amount the user typed never moves
// (Invariant 13). But buildNextMonth derives a target / capped-build fund's
// planned from the carry-over at build time, and that value was never typed —
// so when this resync changes an EXPENSE fund's carry-over and the fund's
// planned still equals autoPlanned() on the OLD carry, planned is re-derived as
// autoPlanned() on the new carry, in the same iteration, before the next month
// is computed from this one (that is what keeps a second pass at []). In every
// other case planned is untouched: a typed value, a fixed fund (its auto does
// not depend on the carry, so nothing moves), a fund with no setup, a fund
// whose carry did not change. Income funds are not in scope. Such a change is
// recorded with plannedFrom / plannedTo on the change object. The rule only
// fires when a carry changes, so it prevents new stale values; it does not heal
// one left by an earlier release. (1.3.0 I1 replaced the income loop below;
// this rule stays in the expense loop.)
//
// Income (I1): the one carry the resync must NOT re-derive is a pending carry
// the user already resolved in the grace month — setIncomeActual('fix') writes
// `carryPending: false` explicitly (not deleted), and the loop leaves it alone.
export function resyncCarryOvers(data) {
  const changes = [];
  const months = data.months || [];
  for (let i = 1; i < months.length; i++) {
    const cur = months[i];
    const comp = computeMonth(months[i - 1]);
    const prevExp = new Map();
    for (const c of comp.categories) for (const f of c.funds) prevExp.set(normFund(f.fund), f);
    for (const c of cur.categories) {
      for (const f of c.funds) {
        const p = prevExp.get(normFund(f.fund));
        if (!p) continue;
        const want = r2(p.leftover);
        if (Math.abs(want - f.carryOver) < 0.005) continue;
        const ch = { month: cur.id, fund: f.fund, from: f.carryOver, to: want };
        // S7: was planned following the auto value? Ask on the OLD carry, before it moves.
        const autoOld = autoPlanned(f, cur.id);
        const followed = autoOld != null && Math.abs(f.planned - autoOld) <= 0.004;
        f.carryOver = want;
        if (followed) {
          const autoNew = autoPlanned(f, cur.id);
          if (autoNew != null && Math.abs(autoNew - f.planned) > 0.004) {
            ch.plannedFrom = f.planned; ch.plannedTo = autoNew;
            f.planned = autoNew;
          }
        }
        changes.push(ch);
      }
    }
    const plans = incomePlanFor(months[i - 1], comp);
    for (const f of cur.income) {
      const p = plans.get(normFund(f.fund));
      if (!p) continue;
      const pendingWant = p.carryPending, want = p.carryOver;
      if (f.carryPending === false && pendingWant) continue; // resolved in the grace month — keep it counted
      if (Math.abs(want - f.carryOver) < 0.005 && !!f.carryPending === pendingWant) continue;
      changes.push({ month: cur.id, fund: f.fund, income: true, from: f.carryOver, to: want });
      f.carryOver = want;
      if (pendingWant) f.carryPending = true; else delete f.carryPending;
    }
  }
  return changes;
}

// v6 → v7: carry-overs become derived (see resyncCarryOvers). The one-time
// history resync happens here; anything it corrected is stashed in
// settings.lastCarryFix (same survive-a-restart pattern as v5's lastRetype)
// so the app can show the user what moved and why.
export function migrateV7(data, todayISO) {
  if ((data.version || 1) >= 7) return false;
  const changes = resyncCarryOvers(data);
  data.version = 7;
  if (changes.length) {
    data.settings = data.settings || {};
    data.settings.lastCarryFix = { at: todayISO, changes };
  }
  return true;
}

// v1 → v2: income funds get a group (standard = paychecks / bonus = everything else)
// and each checks entry gets a titheAmount, defaulting to the net per-check amount so
// every existing month's tithe value is preserved exactly.
export function migrateV2(data) {
  if ((data.version || 1) >= 2) return false;
  for (const m of data.months) {
    m.checks = m.checks || {};
    for (const f of m.income) {
      if (!f.group) {
        f.group = (f.rule && f.rule.type === 'checks') || /checks$/i.test(f.fund) ? 'standard' : 'bonus';
      }
      if (f.group === 'standard' && !m.checks[f.fund]) {
        m.checks[f.fund] = { count: 0, amount: 0 };
      }
    }
    for (const k of Object.keys(m.checks)) {
      const chk = m.checks[k];
      if (chk.titheAmount == null) {
        // Default so that count × titheAmount reproduces the fund's current planned
        // amount exactly (planned may have been tweaked away from count × amount) —
        // historical tithe values must not move until the user sets the real number.
        const fund = m.income.find((f) => f.fund === k);
        chk.titheAmount = (chk.count > 0 && fund) ? fund.planned / chk.count : (chk.amount || 0);
      }
    }
  }
  data.version = 2;
  return true;
}

export function applyTitheRules(month, tithePercent) {
  const base = titheBase(month);
  for (const c of month.categories) {
    for (const f of c.funds) {
      if (f.rule && f.rule.type === 'tithe') {
        f.planned = r2(base * (f.rule.percent || tithePercent));
      }
    }
  }
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export function nextMonthId(id) {
  const [y, m] = id.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

export function monthLabel(id) {
  const [y, m] = id.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

// Build the next month from the previous one: carryovers roll forward,
// planned amounts come from rules (checks, tithe, yearly/N) or repeat.
export function buildNextMonth(prev, tithePercent) {
  const comp = computeMonth(prev);
  const id = nextMonthId(prev.id);
  const month = {
    id,
    label: MONTH_NAMES[Number(id.split('-')[1]) - 1],
    checks: JSON.parse(JSON.stringify(prev.checks || {})),
    income: [],
    categories: [],
    transactions: [],
  };
  // 1.3.0 I1: an income fund's carry is what the close decided — pending (late),
  // counted (an unassigned surplus), or 0. The old per-fund carry-forward flag is
  // not read (nor copied) any more.
  const plans = incomePlanFor(prev, comp);
  month.income = comp.income.map((f) => {
    let planned = 0;
    if (f.rule && f.rule.type === 'checks') {
      const chk = month.checks[f.fund] || { count: 0, amount: 0 };
      planned = r2(chk.count * chk.amount);
    }
    const plan = plans.get(normFund(f.fund));
    return {
      fund: f.fund,
      carryOver: plan.carryOver, carryPending: plan.carryPending,
      planned, rule: f.rule || null,
      titheExempt: !!f.titheExempt,
      group: f.group || 'bonus',
    };
  });
  month.categories = comp.categories.map((c) => ({
    name: c.name,
    excludeFromTotals: !!c.excludeFromTotals,
    funds: c.funds.map((f) => {
      const carryOver = r2(f.leftover);
      const s = f.setup ? { ...f.setup } : null;
      // Savings target has passed → recalibrate to the same month next year
      // (Inv 14) — unless the goal is done (1.3.0 W6): a finished goal keeps
      // its month and asks $0 until it's emptied and removed.
      if (s && s.type === 'savings' && s.targetMonth && id > s.targetMonth && !s.done) {
        s.targetMonth = monthAdd(s.targetMonth, 12);
      }
      // 1.3.0 W7: a fixed fund's charge month has passed → the next charge is
      // one cycle later (Inv 14, extended).
      if (s && s.type === 'fixed' && s.nextChargeMonth && id > s.nextChargeMonth) {
        s.nextChargeMonth = monthAdd(s.nextChargeMonth, s.everyMonths);
      }
      // Default: repeat last month's plan. A fund paused for one month (1.2.1
      // W6, fund.pausedPlanned) gets its plan back here; the field itself is
      // not copied — the returned object lists its fields explicitly below.
      let planned = f.pausedPlanned != null ? f.pausedPlanned : f.planned;
      // 1.3.0 W5: a catch-up plan ends on its last month, or early once the carry
      // is back to ≥ 0 — the plan is dropped and a Basic/Pacing fund returns to
      // base. (The `auto` line below still runs, so a Build-up fund returns to
      // its own auto.)
      if (s && s.catchUp && (id > s.catchUp.until || carryOver >= -0.004)) {
        if (s.catchUp.base != null) planned = s.catchUp.base;
        delete s.catchUp;
      }
      const auto = autoPlanned({ ...f, setup: s, carryOver }, id);
      if (auto != null) {
        planned = auto; // fund setup wins: overrides reset each new month
      } else if (f.rule && f.rule.type === 'yearlyDiv' && f.yearlyCharge != null) {
        planned = r2(f.yearlyCharge / f.rule.divisor); // legacy pre-v3 data
      }
      return {
        fund: f.fund, carryOver, planned,
        rule: f.rule || null, yearlyCharge: f.yearlyCharge ?? null,
        setup: s,
      };
    }),
  }));
  applyTitheRules(month, tithePercent);
  return month;
}

// Recompute checks-rule income planned from the month's checks settings.
// A fund trued up at close (1.3.0 I1, `truedUp`) keeps its record; the next
// month is built from `checks` as always.
export function applyChecksRules(month) {
  for (const f of month.income) {
    if (f.rule && f.rule.type === 'checks' && !f.truedUp) {
      const chk = month.checks[f.fund];
      if (chk) f.planned = r2(chk.count * chk.amount);
    }
  }
}

// The paychecks that actually posted to an income fund this month: positive,
// non-transfer transactions assigned to it. Returns { count, total } where
// total is the sum of those deposits' amounts. This is the one deposit rule
// shared by "Use actual" (app.js applyActualChecks), setIncomeActual below and
// garden.js recentPerCheckAvg (re-exported there) — never substitute the fund's
// `received` / fundSums() for `total`: those include transfers in and any
// negative adjustment on the fund. Moved here from garden.js in 1.3.0 (I1).
export function fundDeposits(month, fundName) {
  const key = normFund(fundName);
  let count = 0, total = 0;
  for (const t of month.transactions || []) {
    if (!(t.amount > 0) || isTransferTx(t) || normFund(t.fund) !== key) continue;
    count++; total += t.amount;
  }
  return { count, total: r2(total) };
}

// ---- 1.3.0 I1: income true-up at close ----
// Income carry-over into the next month is exactly one of three things, recorded
// at close: a PENDING late amount (negative, outside Left to allocate; one
// month's grace), a COUNTED amount (any sign — a surplus that wasn't assigned,
// or a late amount the grace month gave up on), or 0. Nothing is derived from
// the old carry-forward flag any more (the key is left in old data, unread).

// The close-time list. One row per income fund whose month didn't match its
// plan. `diff` is what still needs a decision: received − planned normally;
// the whole leftover when a late carry is pending (the late money was expected
// inside this month). Tolerance ±$1, as incomeCheckIns. A fund marked late
// whose money then landed (|diff| ≤ 1) still appears, resolved, so the row can
// offer to clear the flag. A late fund whose money then came in OVER is not
// resolved (1.3.0 sitting B, W0): the extra needs the 'actual' decision, or
// Left to allocate never sees it.
export function incomeTrueUp(month, comp) {
  const out = [];
  for (const f of comp.income) {
    const diff = f.carryPending ? f.leftover : r2(f.received - f.planned);
    const resolved = Math.abs(diff) <= 1 || (f.lateAtClose === true && diff <= 1);
    const options = [];
    if (diff < -1) { options.push('fix'); if (!f.carryPending && !f.lateAtClose) options.push('late'); }
    if (diff > 1) options.push('actual');
    if (Math.abs(diff) > 1 || f.lateAtClose) out.push({ fund: f.fund, group: f.group || 'bonus', planned: f.planned, received: f.received,
      carryOver: f.carryOver, carryPending: !!f.carryPending, lateAtClose: !!f.lateAtClose, diff, resolved, options });
  }
  return out;
}

// Default 2/3: planned becomes what the month got. 'fix' (under): planned :=
// received; a pending carry becomes counted — the late money is written against
// Left to allocate. 'actual' (over): planned := received + carry when a pending
// carry exists (it landed), else received. Checks-rule funds are written
// directly and marked truedUp; the estimate moves only for a variable fund
// whose deposits matched the expected count (S3/S9 stay true). This is the
// close-time rule; app.js applyActualChecks is the mid-month one and differs
// on purpose. Returns { planned, from } or null.
export function setIncomeActual(month, fundName, { mode }) {
  const comp = computeMonth(month);
  const f = month.income.find((x) => normFund(x.fund) === normFund(fundName));
  const c = f && comp.income.find((x) => normFund(x.fund) === normFund(fundName));
  if (!f || !c) return null;
  const from = f.planned;
  let target = c.received;
  if (f.carryPending) {
    if (mode === 'actual') target = r2(c.received + f.carryOver);   // it landed
    else f.carryPending = false;                                     // it didn't — counted (explicit false, see resyncCarryOvers)
  }
  target = r2(Math.max(0, target));
  f.planned = target;
  if (f.rule && f.rule.type === 'checks') {
    f.truedUp = true;
    const chk = (month.checks || {})[f.fund];
    const dep = fundDeposits(month, f.fund);
    if (chk && chk.variable && dep.count > 0 && dep.count === chk.count) chk.amount = r2(dep.total / dep.count);
  }
  return { planned: target, from };
}

// What each income fund carries into the month after `prev`. pending: prev
// marked late and still short. counted surplus: prev's Left to allocate at
// close, on the first Standard fund that isn't late (Default 1), else the first
// fund that isn't. Shared by buildNextMonth and resyncCarryOvers so the two
// always agree.
export function incomePlanFor(prev, comp = computeMonth(prev)) {
  const plan = new Map();
  for (const f of comp.income) {
    const k = normFund(f.fund);
    if (f.lateAtClose && f.leftover < -0.02) plan.set(k, { carryOver: r2(f.leftover), carryPending: true });
    else plan.set(k, { carryOver: 0, carryPending: false });
  }
  // The surplus carries only out of a month that was closed through the
  // 1.3.0 workflow (prev.trueUp stamped by createNextMonth). Months closed
  // before 1.3.0 have no stamp, so history never grows a carry it never had.
  const surplus = prev.trueUp ? comp.summary.leftToAllocate : 0;
  if (surplus > 0.02) {
    const host = comp.income.find((f) => (f.group || 'bonus') === 'standard' && !plan.get(normFund(f.fund)).carryPending)
      || comp.income.find((f) => !plan.get(normFund(f.fund)).carryPending);
    if (host) plan.set(normFund(host.fund), { carryOver: r2(surplus), carryPending: false });
  }
  return plan;
}
