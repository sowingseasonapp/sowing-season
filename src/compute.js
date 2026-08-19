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

  return {
    income, incomeTotals, categories, totals,
    summary: {
      plannedIncome: incomeTotals.planned,
      allocated: totals.planned,
      leftToAllocate: r2(incomeTotals.planned - totals.planned),
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

export function autoPlanned(f, monthId) {
  const s = f.setup;
  if (!s) return null;
  if (s.type === 'fixed' && s.everyMonths >= 1) return r2((s.totalAmount || 0) / s.everyMonths);
  if (s.type === 'savings') {
    if (s.savingsMode === 'build') {
      const amt = s.monthlyAmount || 0;
      // With a goal: contribute only up to the goal (capped), resume if it drops below.
      if (s.buildGoal > 0) return r2(Math.min(amt, Math.max(0, s.buildGoal - (f.carryOver || 0))));
      return r2(amt);
    }
    if (monthId) return savingsMonthly(monthId, f.carryOver || 0, s);
  }
  return null;
}

export function isOverridden(f, monthId) {
  const auto = autoPlanned(f, monthId);
  return auto != null && Math.abs(f.planned - auto) > 0.004;
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
      const budget = r2(f.carryOver + f.planned);
      let attention = null, offset = false, pace = null;

      if (f.leftover < -0.004) attention = 'exceeded';

      if (type === 'pacing' && isCurrent && !monthDone && budget > 0.004 && !attention) {
        // On/off pace. "Off" means the current spending rate is projected to
        // overrun the budget by a material amount — not merely being ahead of a
        // straight line, which flags every fund that front-loads its spending.
        if (monthPct >= PACE_GRACE_PCT) {
          const projected = spent / monthPct;          // spend at this rate all month
          const slack = Math.max(PACE_MIN_OVER, budget * PACE_OVER_FRACTION);
          pace = projected > budget + slack ? 'off' : 'on';
          if (pace === 'off') attention = 'pace';
        } else {
          pace = 'on'; // too early in the month to judge
        }
      }

      if (!attention && f.leftover > 0.004) {
        if (type === 'basic' || type === 'fixed') offset = (txCount[k] || 0) >= 1;
        else if (type === 'pacing') offset = monthDone;
        else if (type === 'savings') {
          // Build-over-time pots are never "available to move"; target-date goals
          // only in their maturity month.
          offset = s.savingsMode !== 'build' && month.id === s.targetMonth && ((txCount[k] || 0) >= 1 || monthDone);
        }
      }

      if (attention || offset || pace) {
        out.push({
          fund: f.fund, category: c.name, type, attention, offset, pace,
          leftover: f.leftover, planned: f.planned, spent: r2(spent), carryOver: f.carryOver,
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
  month.income = comp.income.map((f) => {
    let planned = 0;
    if (f.rule && f.rule.type === 'checks') {
      const chk = month.checks[f.fund] || { count: 0, amount: 0 };
      planned = r2(chk.count * chk.amount);
    }
    // Income funds reset to zero carry-over each month (spreadsheet convention)
    // unless the fund opts in to carrying its leftover forward.
    return {
      fund: f.fund,
      carryOver: f.carryForward ? r2(f.leftover) : 0,
      planned, rule: f.rule || null,
      titheExempt: !!f.titheExempt,
      carryForward: !!f.carryForward,
      group: f.group || 'bonus',
    };
  });
  month.categories = comp.categories.map((c) => ({
    name: c.name,
    excludeFromTotals: !!c.excludeFromTotals,
    funds: c.funds.map((f) => {
      const carryOver = r2(f.leftover);
      const s = f.setup ? { ...f.setup } : null;
      // Savings target has passed → recalibrate to the same month next year.
      if (s && s.type === 'savings' && s.targetMonth && id > s.targetMonth) {
        s.targetMonth = monthAdd(s.targetMonth, 12);
      }
      let planned = f.planned; // default: repeat last month's plan
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
export function applyChecksRules(month) {
  for (const f of month.income) {
    if (f.rule && f.rule.type === 'checks') {
      const chk = month.checks[f.fund];
      if (chk) f.planned = r2(chk.count * chk.amount);
    }
  }
}
