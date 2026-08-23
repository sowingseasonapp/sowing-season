import {
  computeMonth, applyTitheRules, applyChecksRules, buildNextMonth, fundSums,
  monthLabel, normFund, r2, migrateV2, migrateV3, migrateV4,
  autoPlanned, isOverridden, fundFlags, savingsMonthly, migrateV5,
  migrateV6, aumTotals, upsertSnapshot, aumLastUpdated, MONTH_NAMES,
} from './compute.js';
import {
  parseBankFile, buildVendorMap, suggestFund, findDuplicateScored,
  suggestStarterFunds, starterFundFor,
} from './csv.js';
import { groupedBars, barList, lineArea } from './charts.js';

const VIZ = { s1: '#2a78d6', s2: '#eb6834' };

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

let data = null;
let currentMonthId = null;
let view = 'budget';
let txSearch = '';
let txFundFilter = '';
let txAccountFilter = '';
let fundSearch = '';
let importState = null;
let flagPanel = null; // 'att' | 'off' | null — which flag list is expanded on the Budget page
let aumLogOpen = false; // AUM change-log section, collapsed by default

/* ---------------- persistence ---------------- */
let saveTimer = null;
function markDirty() {
  $('#saveStatus').textContent = 'Saving…';
  $('#saveStatus').classList.add('dirty');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 600);
}
async function flushSave() {
  clearTimeout(saveTimer); saveTimer = null;
  try {
    await window.budgetAPI.saveData(data);
    $('#saveStatus').textContent = 'All changes saved';
    $('#saveStatus').classList.remove('dirty');
  } catch (e) {
    $('#saveStatus').textContent = 'Save failed!';
    toast('Could not save: ' + e.message);
  }
}
// On window close, a pending debounced save must land before the process dies —
// use the synchronous IPC path so the write completes.
window.addEventListener('beforeunload', () => {
  if (saveTimer) {
    clearTimeout(saveTimer); saveTimer = null;
    if (window.budgetAPI.saveDataSync) window.budgetAPI.saveDataSync(data);
    else window.budgetAPI.saveData(data);
  }
});

/* ---------------- helpers ---------------- */
const fmtUSD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
function money(n, { paren = true } = {}) {
  if (n == null || isNaN(n)) return '';
  const s = fmtUSD.format(Math.abs(n));
  return n < -0.004 ? (paren ? `(${s})` : `-${s}`) : s;
}
function moneyCls(n) { return n < -0.004 ? 'neg' : n > 0.004 ? 'pos' : ''; }
function parseMoney(s) {
  if (typeof s !== 'string') return NaN;
  let t = s.replace(/[$,\s]/g, '');
  let negate = false;
  if (/^\(.*\)$/.test(t)) { negate = true; t = t.slice(1, -1); }
  const n = parseFloat(t);
  return isNaN(n) ? NaN : r2(negate ? -n : n);
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}
function curMonth() { return data.months.find((m) => m.id === currentMonthId); }
// Reporting helpers: honor the "exclude transfers" setting on aggregate numbers.
const exT = () => !!data.settings.excludeTransfers;
const actIncome = (c) => exT() ? c.summary.actualIncomeExT : c.summary.actualIncome;
const actExpense = (c) => exT() ? c.summary.actualExpenseExT : c.summary.actualExpense;
const actDiff = (c) => exT() ? c.summary.actualDiffExT : c.summary.actualDiff;
const catSpentAbs = (cat) => Math.abs(exT() ? r2(cat.totals.expensed - cat.totals.transfers) : cat.totals.expensed);
function newTxId() { return 't_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7); }
function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}
// Every fund of a month, grouped for <select>. Pass leftMap (normFund → leftover)
// to append each fund's current monthly leftover to its label.
function fundOptions(month, selected, leftMap) {
  const sel = normFund(selected);
  const label = (name) => {
    const l = leftMap ? leftMap[normFund(name)] : undefined;
    return esc(name) + (l !== undefined ? ` — ${money(l)} left` : '');
  };
  let html = `<option value="" ${sel ? '' : 'selected'}>— pick fund —</option>`;
  html += `<optgroup label="Income">`;
  for (const f of month.income) html += `<option value="${esc(f.fund)}" ${normFund(f.fund) === sel ? 'selected' : ''}>${label(f.fund)}</option>`;
  html += `</optgroup>`;
  for (const c of month.categories) {
    html += `<optgroup label="${esc(c.name)}">`;
    for (const f of c.funds) html += `<option value="${esc(f.fund)}" ${normFund(f.fund) === sel ? 'selected' : ''}>${label(f.fund)}</option>`;
    html += `</optgroup>`;
  }
  return html;
}

// normFund → leftover for a month (income funds included).
function leftoverMap(month) {
  const comp = computeMonth(month);
  const map = {};
  for (const f of comp.income) map[normFund(f.fund)] = f.leftover;
  for (const c of comp.categories) for (const f of c.funds) map[normFund(f.fund)] = f.leftover;
  return map;
}
function canonicalFund(month, name) {
  const n = normFund(name);
  for (const f of month.income) if (normFund(f.fund) === n) return f.fund;
  for (const c of month.categories) for (const f of c.funds) if (normFund(f.fund) === n) return f.fund;
  return null;
}
function recalcRules(month) {
  applyChecksRules(month);
  applyTitheRules(month, data.settings.tithePercent ?? 0.15);
}

// Average per-check actual over the last (up to) 3 months before `beforeId`
// where this fund had checks set up and actually received money. Used to
// suggest an estimate for variable-income funds; null when no history.
function recentPerCheckAvg(fundName, beforeId) {
  const prior = data.months
    .filter((m) => m.id < beforeId)
    .sort((a, b) => b.id.localeCompare(a.id));
  const vals = [];
  for (const m of prior) {
    if (vals.length >= 3) break;
    const chk = (m.checks || {})[fundName];
    if (!chk || !(chk.count > 0)) continue;
    const received = fundSums(m)[normFund(fundName)] || 0;
    if (received > 0) vals.push(received / chk.count);
  }
  return vals.length ? r2(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
}

/* ---------------- shell ---------------- */
function renderShell() {
  const selEl = $('#monthSelect');
  selEl.innerHTML = data.months.map((m) =>
    `<option value="${m.id}" ${m.id === currentMonthId ? 'selected' : ''}>${monthLabel(m.id)}</option>`).join('');
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
}
function render() {
  renderShell();
  const main = $('#main');
  main.onclick = null; main.onchange = null; // views own their handlers; clear the old view's
  if (view === 'budget') renderBudget(main);
  else if (view === 'transactions') renderTransactions(main);
  else if (view === 'import') renderImport(main);
  else if (view === 'reports') renderReports(main);
  else if (view === 'aum') renderAum(main);
  else if (view === 'settings') renderSettings(main);
  // An open fund panel shows live numbers and position-dependent actions, so it
  // refreshes with the page rather than going stale.
  if (panelRef) renderFundPanel();
}

/* ---------------- Name-input dialog (Electron has no window.prompt) ---------------- */
function promptName(title, placeholder, onSubmit, { okLabel = 'Add', initial = '' } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="width:360px">
      <h2 style="font-size:1.05rem">${esc(title)}</h2>
      <div class="modal-row" style="margin-top:10px">
        <input id="pnInput" class="search" style="flex:1" placeholder="${esc(placeholder)}" value="${esc(initial)}" maxlength="60">
      </div>
      <div class="modal-err" id="pnErr"></div>
      <div class="modal-actions">
        <button class="btn" id="pnCancel">Cancel</button>
        <button class="btn btn-accent" id="pnOk">${esc(okLabel)}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  const input = $('#pnInput', overlay);
  const submit = () => {
    const name = input.value.trim();
    if (!name) { $('#pnErr', overlay).textContent = 'Enter a name.'; return; }
    const err = onSubmit(name);
    if (err) { $('#pnErr', overlay).textContent = err; return; }
    close();
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter') submit();
  });
  $('#pnCancel', overlay).onclick = close;
  $('#pnOk', overlay).onclick = submit;
  input.focus();
  if (initial) input.select();
}

/* ---------------- Transfer dialog ---------------- */
// Local calendar date — never toISOString(), which is UTC and rolls a day ahead in the evening.
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function defaultDateFor(month) {
  const t = todayISO();
  return t.slice(0, 7) === month.id ? t : `${month.id}-01`;
}
function parseUserDate(s) {
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let y = Number(m[3]); if (y < 100) y += 2000;
  return `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
}
function showTransferModal(presetFrom = '', onDone = null) {
  const month = curMonth();
  const iso = defaultDateFor(month);
  const lmap = leftoverMap(month);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2>⇄ Transfer between funds</h2>
      <p class="muted">Moves money in ${monthLabel(month.id)} by adding a matched pair of transactions —
        the "from" fund goes down, the "to" fund goes up. Income/expense totals are unaffected.</p>
      <div class="modal-row"><label>From</label><select id="tFrom" class="inline">${fundOptions(month, presetFrom, lmap)}</select></div>
      <div class="modal-row"><label>To</label><select id="tTo" class="inline">${fundOptions(month, '', lmap)}</select></div>
      <div class="modal-row"><label>Amount</label><input id="tAmt" class="search" placeholder="$0.00" inputmode="decimal"></div>
      <div class="modal-row"><label>Date</label><input id="tDate" class="search" value="${fmtDate(iso)}" placeholder="m/d/yy"></div>
      <div class="modal-row"><label>Note</label><input id="tNote" class="search" placeholder="optional"></div>
      <div class="modal-err" id="tErr"></div>
      <div class="modal-actions">
        <button class="btn" id="tCancel">Cancel</button>
        <button class="btn btn-accent" id="tGo">Transfer</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  $('#tCancel', overlay).onclick = close;
  ($('#tFrom', overlay).value ? $('#tTo', overlay) : $('#tFrom', overlay)).focus();
  $('#tGo', overlay).onclick = () => {
    const from = $('#tFrom', overlay).value, to = $('#tTo', overlay).value;
    const amt = Math.abs(parseMoney($('#tAmt', overlay).value));
    const date = parseUserDate($('#tDate', overlay).value);
    const note = $('#tNote', overlay).value.trim();
    const err = $('#tErr', overlay);
    if (!from || !to) { err.textContent = 'Pick both funds.'; return; }
    if (normFund(from) === normFund(to)) { err.textContent = 'Pick two different funds.'; return; }
    if (isNaN(amt) || amt <= 0) { err.textContent = 'Enter an amount greater than zero.'; return; }
    if (!date) { err.textContent = 'Enter the date as m/d/yy.'; return; }
    month.transactions.push(
      { id: newTxId(), date, vendor: `Transfer to ${to}`, amount: -amt, fund: from, description: note, account: '', isTransfer: true },
      { id: newTxId(), date, vendor: `Transfer from ${from}`, amount: amt, fund: to, description: note, account: '', isTransfer: true },
    );
    markDirty(); close();
    toast(`Moved ${money(amt)}: ${from} → ${to}.`);
    if (onDone) onDone(); else render();
  };
}

/* ---------------- Fund setup form (shared by the panel and the add dialog) ----------------
 * One flat list of behaviours instead of the old Type → Savings mode → Build mode tree.
 * "Build forever vs. goal" is just an optional "stop at" amount.
 */
const INCOME_TYPES = [
  { key: 'standard', name: 'Standard Income', desc: 'Paychecks or a main source of income — planned as checks × per-check amount (or an estimate, if your pay varies).' },
  { key: 'bonus', name: 'Extra Income', desc: 'Inconsistent income you want to track — gifts, reimbursements and the like.' },
];

const FUND_BEHAVIORS = [
  { key: 'basic', name: 'Basic', desc: 'Everyday spending you plan each month. Great for utilities.' },
  { key: 'pacing', name: 'Pacing', desc: 'Many purchases a month, watched for pace. Great for groceries.' },
  { key: 'fixed', name: 'Fixed recurring', desc: 'The same charge on a schedule. Great for subscriptions.' },
  { key: 'goal', name: 'Savings goal', desc: 'Save a total by a target month. Great for Christmas or a vacation.' },
  { key: 'build', name: 'Build up', desc: 'Set aside monthly and spend as needed. Great for an emergency fund.' },
];

// setup object → behaviour key, and back again.
function behaviorOf(setup) {
  const s = setup || {};
  if (s.type === 'fixed') return 'fixed';
  if (s.type === 'savings') return s.savingsMode === 'build' ? 'build' : 'goal';
  if (s.type === 'pacing') return 'pacing';
  return 'basic';
}

function blankSetup() {
  return {
    type: 'basic', everyMonths: 1, totalAmount: 0, targetAmount: 0, targetMonth: null,
    savingsMode: 'target', monthlyAmount: 0, buildGoal: 0, excludeInsights: false,
  };
}

function defaultTargetMonth(monthId) {
  const [y, m] = monthId.split('-').map(Number);
  return `${y + 1}-${String(m).padStart(2, '0')}`;
}

// Read the form back into a setup object (expense) — returns {setup} or {error}.
function readSetupForm(root, monthId) {
  const b = root.querySelector('input[name="fsBehavior"]:checked').value;
  const s = blankSetup();
  s.excludeInsights = $('#fsQuiet', root).checked;
  if (b === 'pacing') s.type = 'pacing';
  else if (b === 'fixed') {
    const n = parseInt($('#fsN', root).value, 10);
    const tot = Math.abs(parseMoney($('#fsT', root).value));
    if (!n || n < 1 || n > 60) return { error: 'Months must be between 1 and 60.' };
    if (isNaN(tot) || tot <= 0) return { error: 'Enter the transaction total.' };
    s.type = 'fixed'; s.everyMonths = n; s.totalAmount = tot;
  } else if (b === 'goal') {
    const goal = Math.abs(parseMoney($('#fsGoal', root).value));
    const when = $('#fsWhen', root).value;
    if (isNaN(goal) || goal <= 0) return { error: 'Enter the savings goal.' };
    if (!when || when < monthId) return { error: 'Pick a target month (this month or later).' };
    s.type = 'savings'; s.savingsMode = 'target'; s.targetAmount = goal; s.targetMonth = when;
  } else if (b === 'build') {
    const amt = Math.abs(parseMoney($('#fsMonthly', root).value));
    if (isNaN(amt) || amt <= 0) return { error: 'Enter the monthly amount to set aside.' };
    const stop = Math.abs(parseMoney($('#fsBuildGoal', root).value));
    s.type = 'savings'; s.savingsMode = 'build'; s.monthlyAmount = amt;
    s.buildGoal = isNaN(stop) ? 0 : stop;
  }
  return { setup: s };
}

function setupFormHtml(setup, monthId) {
  const s = setup || blankSetup();
  const b = behaviorOf(s);
  return `
    <div class="behavior-picker">
      ${FUND_BEHAVIORS.map((t) => `
        <label class="behavior ${b === t.key ? 'sel' : ''}">
          <input type="radio" name="fsBehavior" value="${t.key}" ${b === t.key ? 'checked' : ''}>
          <span class="behavior-name">${t.name}</span>
          <span class="behavior-desc">${t.desc}</span>
        </label>`).join('')}
    </div>
    <div class="setup-fields" id="fsFields">
      <div data-for="fixed" class="modal-row"><label style="width:auto">Happens every</label>
        <input id="fsN" class="search" style="width:58px;flex:none" value="${s.everyMonths || 1}" inputmode="numeric">
        <span class="muted">month(s), totalling</span>
        <input id="fsT" class="search" style="width:110px;flex:none" value="${s.totalAmount ? money(s.totalAmount) : ''}" placeholder="$0.00" inputmode="decimal"></div>
      <div data-for="goal" class="modal-row"><label style="width:auto">Save up</label>
        <input id="fsGoal" class="search" style="width:110px;flex:none" value="${s.targetAmount ? money(s.targetAmount) : ''}" placeholder="$0.00" inputmode="decimal">
        <span class="muted">by</span>
        <input id="fsWhen" type="month" class="search" style="flex:none" value="${s.targetMonth || defaultTargetMonth(monthId)}" min="${monthId}"></div>
      <div data-for="build" class="modal-row"><label style="width:auto">Set aside</label>
        <input id="fsMonthly" class="search" style="width:110px;flex:none" value="${s.monthlyAmount ? money(s.monthlyAmount) : ''}" placeholder="$0.00" inputmode="decimal">
        <span class="muted">a month, stopping at</span>
        <input id="fsBuildGoal" class="search" style="width:110px;flex:none" value="${s.buildGoal > 0 ? money(s.buildGoal) : ''}" placeholder="no limit" inputmode="decimal"
          title="Leave blank to build forever. With an amount, contributions stop there and resume if the balance drops below it."></div>
    </div>
    <p class="setup-result" id="fsCalc"></p>
    <div class="setup-options">
      <label title="This fund never triggers Needs Attention or Available to Move, and shows no pace status. Numbers still compute normally — it just stays quiet.">
        <input type="checkbox" id="fsQuiet" ${s.excludeInsights ? 'checked' : ''}> Exclude fund from insights
      </label>
    </div>`;
}

// Show/hide the fields belonging to the selected behaviour and keep the result line live.
function wireSetupForm(root, { monthId, carryOver = 0, onChange = null }) {
  // `commit` separates "show me what this would do" (every keystroke) from
  // "save it" (blur / enter / picking a behaviour), so typing 2400 doesn't
  // briefly save 2, then 24, then 240.
  const refresh = (commit = false) => {
    const b = root.querySelector('input[name="fsBehavior"]:checked').value;
    $$('.behavior', root).forEach((el) => el.classList.toggle('sel', el.querySelector('input').checked));
    $$('#fsFields [data-for]', root).forEach((el) => { el.style.display = el.dataset.for === b ? '' : 'none'; });
    const res = readSetupForm(root, monthId);
    const calc = $('#fsCalc', root);
    if (res.error) calc.innerHTML = `<span class="muted">${esc(res.error)}</span>`;
    else {
      const auto = autoPlanned({ carryOver, setup: res.setup }, monthId);
      calc.innerHTML = auto == null
        ? `Planned this month: <b>you set it</b> <span class="muted">— this type doesn't calculate an amount.</span>`
        : `Planned this month: <b>${money(auto)}</b>${b === 'build' && res.setup.buildGoal > 0
            ? ` <span class="muted">— ${money(carryOver)} saved of ${money(res.setup.buildGoal)}</span>` : ''}`;
    }
    if (commit && onChange) onChange(res);
  };
  $$('input[name="fsBehavior"]', root).forEach((r) => r.onchange = () => refresh(true));
  $$('#fsFields input, #fsQuiet', root).forEach((el) => {
    el.oninput = () => refresh(false);
    el.onchange = () => refresh(true);
  });
  refresh(false);
  return refresh;
}

/* ---------------- Fund side panel ----------------
 * Everything about one fund in one place: its numbers, its setup, the actions
 * that used to be four buttons on every row, and its transactions this month.
 * Edits apply immediately, like the rest of the app.
 */
let panelRef = null; // {kind:'expense', ci, fi} | {kind:'income', idx}

// Escape closes the panel from anywhere — the listener lives on the document
// because the panel itself rarely holds focus (it re-renders with the app).
function panelEscHandler(e) { if (e.key === 'Escape') closeFundPanel(); }

function closeFundPanel() {
  panelRef = null;
  document.removeEventListener('keydown', panelEscHandler);
  const el = $('#fundPanel');
  if (el) el.remove();
}

// Locate the fund a panel ref points at; returns null if it no longer exists.
function panelFund(month) {
  if (!panelRef) return null;
  if (panelRef.kind === 'income') return month.income[panelRef.idx] || null;
  const cat = month.categories[panelRef.ci];
  return cat ? (cat.funds[panelRef.fi] || null) : null;
}

function showFundPanel(ref) {
  panelRef = ref;
  // Setup checklist: opening an income fund panel once counts as having
  // double-checked the paycheck numbers (latched, never un-latched).
  if (ref.kind === 'income' && Array.isArray(data.settings.setupChecklist)) {
    const item = data.settings.setupChecklist.find((i) => i.key === 'checks');
    if (item && !item.done) { item.done = true; markDirty(); render(); } // render includes the panel
  }
  document.addEventListener('keydown', panelEscHandler);
  renderFundPanel();
}

function renderFundPanel() {
  const existing = $('#fundPanel');
  // Keep where the reader was scrolled to when the panel refreshes with the app.
  const keepScroll = existing ? existing.querySelector('.panel-body').scrollTop : 0;
  if (existing) existing.remove();
  if (!panelRef) return;
  const month = curMonth();
  const f = panelFund(month);
  if (!f) { panelRef = null; return; }

  const isIncome = panelRef.kind === 'income';
  const comp = computeMonth(month);
  const live = isIncome
    ? comp.income[panelRef.idx]
    : comp.categories[panelRef.ci].funds[panelRef.fi];
  const txs = month.transactions
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => normFund(t.fund) === normFund(f.fund))
    .sort((a, b) => (b.t.date || '').localeCompare(a.t.date || ''));
  const chk = isIncome ? ((month.checks || {})[f.fund] || { count: 0, amount: 0, titheAmount: 0 }) : null;
  const chkAvg = (chk && chk.variable) ? recentPerCheckAvg(f.fund, month.id) : null;
  const sibCount = isIncome
    ? month.income.filter((x) => (x.group || 'bonus') === (f.group || 'bonus')).length
    : month.categories[panelRef.ci].funds.length;
  const pos = isIncome
    ? month.income.filter((x) => (x.group || 'bonus') === (f.group || 'bonus')).findIndex((x) => x === f)
    : panelRef.fi;

  const wrap = document.createElement('div');
  wrap.id = 'fundPanel';
  wrap.className = 'panel-wrap';
  wrap.innerHTML = `
    <div class="panel-scrim"></div>
    <aside class="side-panel" role="dialog" aria-label="Fund settings">
      <header class="panel-head">
        <div>
          <div class="panel-title">${esc(f.fund)}</div>
          <div class="panel-sub muted">${isIncome
            ? (f.group === 'standard' ? 'Standard Income' : 'Extra Income')
            : esc(month.categories[panelRef.ci].name)}</div>
        </div>
        <button class="btn-ghost panel-close" id="pnlClose" title="Close">✕</button>
      </header>
      <div class="panel-body">
        <section class="panel-sec">
          <div class="panel-nums">
            <label>Carry over<input class="money" id="pnlCarry" value="${money(f.carryOver)}"></label>
            <label>Planned<input class="money" id="pnlPlanned" value="${money(f.planned)}"></label>
            <div class="panel-num-ro"><span>${isIncome ? 'Received' : 'Spent'}</span>
              ${isIncome
                ? `<b class="${moneyCls(live.received)}">${money(live.received)}</b>`
                : `<b class="${live.expensed > 0.004 ? 'pos' : ''}">${live.expensed > 0.004 ? '+' + money(live.expensed) : money(Math.abs(live.expensed))}</b>`}</div>
            <div class="panel-num-ro"><span>Left</span>
              <b class="${isIncome && live.leftover < -0.004 ? 'muted' : moneyCls(live.leftover)}"${
                isIncome && live.leftover < -0.004 ? ` title="${money(-live.leftover)} still expected this month"` : ''}>${money(live.leftover)}</b></div>
          </div>
        </section>

        <section class="panel-sec">
          <h3>Setup <span class="muted">— from ${monthLabel(month.id)} forward</span></h3>
          ${isIncome ? `
            <div class="behavior-picker">
              ${INCOME_TYPES.map((t) => `
                <label class="behavior ${(f.group || 'bonus') === t.key ? 'sel' : ''}">
                  <input type="radio" name="pnlIncType" value="${t.key}" ${(f.group || 'bonus') === t.key ? 'checked' : ''}>
                  <span class="behavior-name">${t.name}</span>
                  <span class="behavior-desc">${t.desc}</span>
                </label>`).join('')}
            </div>
            <div class="setup-fields" id="pnlChecks" style="${f.group === 'standard' ? '' : 'display:none'}">
              <div class="modal-row"><label style="width:auto">Paychecks</label>
                <input class="money small-num" id="pnlChkCount" style="flex:none" value="${chk.count || 0}" title="Number of checks this month">
                <span class="muted">×</span>
                <input class="money" id="pnlChkAmount" style="width:110px;flex:none" value="${money(chk.amount || 0)}" title="${chk.variable
                  ? 'Estimated per check. Plan on the low side — you can only spend income after it arrives. When checks come in, the month review offers to update this to the real amount.'
                  : 'Deposited amount per check (after deductions)'}">
                <span class="muted">${chk.variable ? 'each (estimated)' : 'each'}</span></div>
              ${chk.variable && chkAvg != null ? `<div class="modal-row" style="margin-top:-4px">
                <span class="fund-note">Recent average: ${money(chkAvg)} per check</span>
                <button class="btn btn-sm" id="pnlChkUse" style="flex:none" title="Set the estimate to the recent average">Use</button></div>` : ''}
              <div class="setup-options" style="margin:2px 0 8px">
                <label title="For hourly, tips or commission pay. The per-check amount becomes an estimate — plan low, and the month review offers a one-tap update to what actually arrived.">
                  <input type="checkbox" id="pnlChkVar" ${chk.variable ? 'checked' : ''}> Per-check amount varies <span class="muted">(hourly, tips, commission)</span></label>
              </div>
              <div class="modal-row"><label style="width:auto" title="Per-check income the tithe is based on (before insurance/retirement deductions)">Titheable per check</label>
                <input class="money" id="pnlChkTithe" style="width:110px;flex:none" value="${money(chk.titheAmount || 0)}" title="Per-check income the tithe is based on (before insurance/retirement deductions)${
                  chk.variable ? '. If your pay varies, use a typical gross check — the tithe is an estimate.' : ''}"></div>
            </div>
            <p class="setup-result" id="pnlIncCalc"></p>
            <div class="setup-options">
              <label title="This fund's income doesn't count toward the tithe base."><input type="checkbox" id="pnlExempt" ${f.titheExempt ? 'checked' : ''}> Exempt from tithe</label>
              <label title="Off: resets to $0 carry-over each new month (right for paychecks). On: leftover rolls forward like an expense fund."><input type="checkbox" id="pnlCarryFwd" ${f.carryForward ? 'checked' : ''}> Carry leftover into next month</label>
            </div>`
          : setupFormHtml(f.setup, month.id)}
        </section>

        <section class="panel-sec">
          <h3>Actions</h3>
          <div class="panel-actions">
            <button class="btn btn-sm" id="pnlXfer">⇄ Transfer money</button>
            <button class="btn btn-sm" id="pnlUp" ${pos <= 0 ? 'disabled' : ''}>↑ Move up</button>
            <button class="btn btn-sm" id="pnlDown" ${pos >= sibCount - 1 ? 'disabled' : ''}>↓ Move down</button>
            <button class="btn btn-sm btn-danger" id="pnlDel">✕ Remove fund</button>
          </div>
          ${!isIncome ? `<div class="modal-row" style="margin-top:10px"><label>Category</label>
            <select class="inline" id="pnlCat">
              ${month.categories.map((c, i) => `<option value="${i}" ${i === panelRef.ci ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select></div>` : ''}
        </section>

        <section class="panel-sec">
          <h3>Transactions <span class="muted">— ${txs.length} this month</span></h3>
          ${txs.length ? `<table class="grid compact panel-tx"><tbody>
            ${txs.map(({ t }) => `<tr><td>${fmtDate(t.date)}</td><td>${esc(t.vendor || '—')}</td>
              <td class="${moneyCls(t.amount)}">${money(t.amount)}</td></tr>`).join('')}
          </tbody></table>
          <button class="btn btn-sm" id="pnlAllTx">See in Transactions</button>`
          : '<p class="muted">Nothing yet this month.</p>'}
        </section>
      </div>
    </aside>`;
  document.body.appendChild(wrap);
  if (keepScroll) $('.panel-body', wrap).scrollTop = keepScroll;

  $('.panel-scrim', wrap).onclick = closeFundPanel;
  $('#pnlClose', wrap).onclick = closeFundPanel;

  // Numbers apply immediately, same as the grid inputs.
  const applyNum = (el, key) => {
    el.onchange = () => {
      const v = parseMoney(el.value);
      if (isNaN(v)) return;
      if (key === 'planned' && f.rule) f.rule = null;
      f[key] = v;
      recalcRules(month); markDirty(); render();
    };
  };
  applyNum($('#pnlCarry', wrap), 'carryOver');
  applyNum($('#pnlPlanned', wrap), 'planned');

  if (isIncome) {
    const incRefresh = () => {
      const t = wrap.querySelector('input[name="pnlIncType"]:checked').value;
      $$('.behavior', wrap).forEach((el) => el.classList.toggle('sel', el.querySelector('input').checked));
      $('#pnlChecks', wrap).style.display = t === 'standard' ? '' : 'none';
      const c = (month.checks || {})[f.fund];
      $('#pnlIncCalc', wrap).innerHTML = t === 'standard' && c
        ? `Planned this month: <b>${money(r2((c.count || 0) * (c.amount || 0)))}</b> <span class="muted">· tithed on ${money(r2((c.count || 0) * (c.titheAmount || 0)))}</span>`
        : `Planned this month: <b>you set it</b> <span class="muted">— enter the amount you expect.</span>`;
    };
    $$('input[name="pnlIncType"]', wrap).forEach((r) => r.onchange = () => {
      const t = wrap.querySelector('input[name="pnlIncType"]:checked').value;
      if (t !== f.group) {
        f.group = t;
        if (t === 'standard') {
          f.rule = { type: 'checks' };
          if (!month.checks[f.fund]) month.checks[f.fund] = { count: 0, amount: 0, titheAmount: 0 };
          applyChecksRules(month);
        } else { f.rule = null; delete month.checks[f.fund]; }
        recalcRules(month); markDirty(); render();
      }
    });
    const chkApply = (el, key, isCount) => {
      if (!el) return;
      el.onchange = () => {
        const v = isCount ? parseFloat(el.value) : parseMoney(el.value);
        if (isNaN(v)) return;
        if (!month.checks[f.fund]) month.checks[f.fund] = { count: 0, amount: 0, titheAmount: 0 };
        month.checks[f.fund][key] = v;
        recalcRules(month); markDirty(); render();
      };
    };
    chkApply($('#pnlChkCount', wrap), 'count', true);
    chkApply($('#pnlChkAmount', wrap), 'amount');
    chkApply($('#pnlChkTithe', wrap), 'titheAmount');
    const varCb = $('#pnlChkVar', wrap);
    if (varCb) varCb.onchange = (e) => {
      if (!month.checks[f.fund]) month.checks[f.fund] = { count: 0, amount: 0, titheAmount: 0 };
      if (e.target.checked) month.checks[f.fund].variable = true;
      else delete month.checks[f.fund].variable;
      markDirty(); render();
    };
    const useAvg = $('#pnlChkUse', wrap);
    if (useAvg) useAvg.onclick = () => {
      month.checks[f.fund].amount = chkAvg;
      recalcRules(month); markDirty(); render();
      toast(`Estimated per check set to ${money(chkAvg)}.`);
    };
    $('#pnlExempt', wrap).onchange = (e) => { f.titheExempt = e.target.checked; recalcRules(month); markDirty(); render(); };
    $('#pnlCarryFwd', wrap).onchange = (e) => { f.carryForward = e.target.checked; markDirty(); render(); };
    incRefresh();
  } else {
    wireSetupForm(wrap, {
      monthId: month.id,
      carryOver: f.carryOver,
      onChange: (res) => {
        if (res.error) return; // incomplete input — leave the fund as it was
        f.setup = res.setup;
        const auto = autoPlanned(f, month.id);
        if (auto != null) { f.rule = null; f.planned = auto; }
        recalcRules(month); markDirty();
        render(); // the panel lives outside #main, so it survives the re-render
      },
    });
    $('#pnlCat', wrap).onchange = (e) => {
      const toCi = Number(e.target.value);
      if (toCi === panelRef.ci) return;
      month.categories[panelRef.ci].funds.splice(panelRef.fi, 1);
      month.categories[toCi].funds.push(f);
      panelRef = { kind: 'expense', ci: toCi, fi: month.categories[toCi].funds.length - 1 };
      recalcRules(month); markDirty(); render();
      toast(`"${f.fund}" moved to ${month.categories[toCi].name}.`);
    };
  }

  $('#pnlXfer', wrap).onclick = () => { closeFundPanel(); showTransferModal(f.fund); };
  $('#pnlUp', wrap).onclick = () => movePanelFund(-1);
  $('#pnlDown', wrap).onclick = () => movePanelFund(1);
  $('#pnlDel', wrap).onclick = () => {
    const arr = isIncome ? month.income : month.categories[panelRef.ci].funds;
    const idx = isIncome ? panelRef.idx : panelRef.fi;
    if (removeFundGuarded(month, arr, idx)) closeFundPanel();
  };
  const allTx = $('#pnlAllTx', wrap);
  if (allTx) allTx.onclick = () => {
    closeFundPanel();
    txFundFilter = f.fund; txSearch = ''; view = 'transactions'; render();
  };
}

function movePanelFund(dir) {
  const month = curMonth();
  const f = panelFund(month);
  if (!f) return;
  if (panelRef.kind === 'income') {
    const grp = f.group || 'bonus';
    const sibs = month.income.map((x, idx) => ({ x, idx })).filter(({ x }) => (x.group || 'bonus') === grp);
    const pos = sibs.findIndex((s) => s.x === f);
    const swap = sibs[pos + dir];
    if (!swap) return;
    const here = sibs[pos].idx;
    [month.income[here], month.income[swap.idx]] = [month.income[swap.idx], month.income[here]];
    panelRef = { kind: 'income', idx: swap.idx };
  } else {
    const funds = month.categories[panelRef.ci].funds;
    const to = panelRef.fi + dir;
    if (to < 0 || to >= funds.length) return;
    [funds[panelRef.fi], funds[to]] = [funds[to], funds[panelRef.fi]];
    panelRef = { kind: 'expense', ci: panelRef.ci, fi: to };
  }
  markDirty(); render();
}

// Shared by the panel and (previously) the grid: a fund may only be removed when
// it is balanced and has no transactions this month.
function removeFundGuarded(month, arr, idx) {
  const f = arr[idx];
  const used = month.transactions.some((t) => normFund(t.fund) === normFund(f.fund));
  if (used) { toast(`"${f.fund}" has transactions this month — reassign or transfer them first.`); return false; }
  const isIncome = arr === month.income;
  const bal = isIncome ? r2(f.carryOver - f.planned) : r2(f.carryOver + f.planned);
  if (Math.abs(bal) > 0.004) {
    toast(`"${f.fund}" isn't balanced — ${money(bal)} would be lost. Transfer it out or zero the amounts first.`);
    return false;
  }
  if (!confirm(`Remove fund "${f.fund}" from ${monthLabel(month.id)}? Past months keep it.`)) return false;
  arr.splice(idx, 1);
  if (isIncome && month.checks[f.fund]) delete month.checks[f.fund];
  recalcRules(month); markDirty(); render();
  return true;
}

/* ---------------- Add fund dialog (income or expense) ---------------- */
function showAddFund(preset = {}) {
  const month = curMonth();
  const side0 = preset.side || 'expense';
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="width:430px">
      <h2>Add a fund</h2>
      <div class="type-picker" style="margin-top:8px">
        <label class="type-opt" id="afInc" title="Money coming in — paychecks, gifts, reimbursements.">
          <input type="radio" name="afSide" value="income" ${side0 === 'income' ? 'checked' : ''}> Income
        </label>
        <label class="type-opt" id="afExp" title="Money going out — a budget envelope in one of your categories.">
          <input type="radio" name="afSide" value="expense" ${side0 === 'expense' ? 'checked' : ''}> Expense
        </label>
      </div>
      <div class="modal-row"><label>Name</label>
        <input id="afName" class="search" style="flex:1" placeholder="Fund name" maxlength="60"></div>
      <div id="afIncOpts" style="display:none">
        <div class="behavior-picker">
          ${INCOME_TYPES.map((t) => `
            <label class="behavior ${(preset.group || 'bonus') === t.key ? 'sel' : ''}">
              <input type="radio" name="afIncType" value="${t.key}" ${(preset.group || 'bonus') === t.key ? 'checked' : ''}>
              <span class="behavior-name">${t.name}</span>
              <span class="behavior-desc">${t.desc}</span>
            </label>`).join('')}
        </div>
      </div>
      <div id="afExpOpts" style="display:none">
        <div class="modal-row"><label>Category</label>
          <select id="afCat" class="inline">
            ${month.categories.map((c, i) => `<option value="${i}" ${i === (preset.ci ?? 0) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select></div>
        ${setupFormHtml(null, month.id)}
      </div>
      <div class="modal-err" id="afErr"></div>
      <div class="modal-actions">
        <button class="btn" id="afCancel">Cancel</button>
        <button class="btn btn-accent" id="afOk">Add fund</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); if (e.key === 'Enter') $('#afOk', overlay).click(); });
  $('#afCancel', overlay).onclick = close;
  const refresh = () => {
    const side = overlay.querySelector('input[name="afSide"]:checked').value;
    $('#afInc', overlay).classList.toggle('sel', side === 'income');
    $('#afExp', overlay).classList.toggle('sel', side === 'expense');
    $('#afIncOpts', overlay).style.display = side === 'income' ? '' : 'none';
    $('#afExpOpts', overlay).style.display = side === 'expense' ? '' : 'none';
    $$('#afIncOpts .behavior', overlay).forEach((el) => el.classList.toggle('sel', el.querySelector('input').checked));
  };
  $$('input[name="afSide"], input[name="afIncType"]', overlay).forEach((r) => r.onchange = refresh);
  // The expense side uses the shared setup form (no commits — read on "Add fund").
  wireSetupForm(overlay, { monthId: month.id, carryOver: 0 });
  refresh();
  $('#afName', overlay).focus();

  $('#afOk', overlay).onclick = () => {
    const err = $('#afErr', overlay);
    const nm = $('#afName', overlay).value.trim();
    if (!nm) { err.textContent = 'Enter a name.'; return; }
    if (canonicalFund(month, nm)) { err.textContent = 'A fund with that name already exists.'; return; }
    const side = overlay.querySelector('input[name="afSide"]:checked').value;
    if (side === 'income') {
      const grp = overlay.querySelector('input[name="afIncType"]:checked').value;
      month.income.push({
        fund: nm, carryOver: 0, planned: 0,
        rule: grp === 'standard' ? { type: 'checks' } : null,
        titheExempt: false, carryForward: false, group: grp,
      });
      if (grp === 'standard') month.checks[nm] = { count: 0, amount: 0, titheAmount: 0 };
    } else {
      const res = readSetupForm(overlay, month.id);
      if (res.error) { err.textContent = res.error; return; }
      const ci = Number($('#afCat', overlay).value);
      const fund = {
        fund: nm, carryOver: 0, planned: 0, rule: null, yearlyCharge: null, setup: res.setup,
      };
      const auto = autoPlanned(fund, month.id);
      if (auto != null) fund.planned = auto;
      month.categories[ci].funds.push(fund);
    }
    markDirty(); close(); render();
    toast(`"${nm}" added.`);
  };
}


/* ---------------- Budget view ---------------- */
function ruleChip(f) {
  if (!f.rule) return '';
  const t = f.rule.type;
  const pct = Math.round((f.rule.percent ?? 0.15) * 100);
  const label = t === 'tithe' ? `${pct}% of income`
    : t === 'yearlyDiv' ? `yearly ÷ ${f.rule.divisor}`
    : t === 'checks' ? 'checks × amount' : t;
  if (t === 'tithe') {
    return `<span class="rule-chip" title="Planned = ${pct}% × (checks × titheable-per-check for Standard Income, plus Extra Income planned; tithe-exempt funds excluded). Typing a value directly removes the auto rule.">auto: ${label}</span>`;
  }
  return `<span class="rule-chip" title="Planned is calculated automatically. Typing a value directly removes the auto rule.">auto: ${label}</span>`;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function ymLabel(ym) {
  if (!ym) return '?';
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_SHORT[m - 1]} ${y}`;
}

// A fund's identity mark: one glyph for how it behaves, with the full setup
// sentence in the tooltip. Basic funds carry no glyph — nothing to say.
function fundTypeMark(f, monthId) {
  const s = f.setup || {};
  const type = s.type || 'basic';
  let glyph = '', tip = '';
  if (type === 'fixed') {
    glyph = '↻';
    tip = `Fixed recurring — ${money(s.totalAmount)} every ${s.everyMonths} month(s), so ${money(autoPlanned(f, monthId))} a month.`;
  } else if (type === 'savings' && s.savingsMode === 'build') {
    glyph = '▲';
    tip = `Build up — ${money(s.monthlyAmount)} set aside monthly${s.buildGoal > 0 ? `, stopping at ${money(s.buildGoal)} (resumes if it drops below)` : ', no ceiling'}.`;
  } else if (type === 'savings') {
    glyph = '◎';
    tip = `Savings goal — ${money(s.targetAmount)} by ${ymLabel(s.targetMonth)}, so ${money(autoPlanned(f, monthId))} this month.`;
  } else if (type === 'pacing') {
    glyph = '▦';
    tip = 'Pacing — many purchases a month, watched for pace.';
  }
  let html = glyph ? `<span class="type-mark" title="${esc(tip)}">${glyph}</span>` : '';
  if (s.excludeInsights) {
    html += `<span class="type-mark quiet" title="Excluded from insights — never flagged for attention or as available to move.">⊘</span>`;
  }
  return html;
}

// At most one status chip per row, and only when it asks something of you.
// Priority: over > off pace > available > overridden; on-pace is a quiet dot.
function fundStatusChip(f, flag, monthId) {
  if (flag) {
    if (flag.attention === 'exceeded') {
      return `<span class="rule-chip chip-danger" title="Spent more than carry-over + planned.">over ${money(-flag.leftover)}</span>`;
    }
    if (flag.pace === 'off') {
      return `<span class="rule-chip chip-danger" title="${money(flag.spent)} of ${money(r2(flag.carryOver + flag.planned))} already spent — faster than the month is passing.">off pace</span>`;
    }
    if (flag.offset) {
      return `<span class="rule-chip chip-good" title="${money(flag.leftover)} is left and no more charges are expected — safe to transfer to another fund.">${money(flag.leftover)} free</span>`;
    }
    if (flag.pace === 'on') {
      return `<span class="pace-dot" title="On pace — spending is at or under the month's pace.">●</span>`;
    }
  }
  if (isOverridden(f, monthId)) {
    return `<span class="rule-chip chip-warn" title="This month's planned amount overrides the fund's setup. New months reset to the setup.">overridden</span>`;
  }
  return '';
}

function fundChips(f, flag, monthId) {
  return ruleChip(f) + fundTypeMark(f, monthId) + fundStatusChip(f, flag, monthId);
}

/* ---- Section open/closed state (device UI state — kept out of the data file) ---- */
const OPEN_KEY = (monthId) => `fb.open.${monthId}`;
function loadOpenState(monthId) {
  try {
    const raw = localStorage.getItem(OPEN_KEY(monthId));
    return raw ? new Set(JSON.parse(raw)) : null; // null = never visited
  } catch { return null; }
}
function saveOpenState(monthId, set) {
  try { localStorage.setItem(OPEN_KEY(monthId), JSON.stringify([...set])); } catch { /* ignore */ }
}
// First visit to a month: open the income sections and any category holding a
// flagged fund; leave the quiet ones closed.
function defaultOpenState(comp, flagMap) {
  const open = new Set(['inc:standard', 'inc:bonus']);
  comp.categories.forEach((c, ci) => {
    if (c.funds.some((f) => flagMap[normFund(f.fund)])) open.add(`cat:${ci}`);
  });
  return open;
}

// Column widths shared by every card: its heading row, its category head and
// its fund table, so a number always sits under its own column heading.
const FUND_COLS = `<colgroup>
  <col style="width:37%"><col style="width:15%"><col style="width:15%"><col style="width:15%">
  <col style="width:15%"><col style="width:68px"></colgroup>`;

// One collapsible section. Its header is a row on the same grid as the funds
// beneath it, so the category totals line up with the fund columns — and the
// body needs no totals row of its own.
function accordionHtml({ key, title, note, open, totals, actions, body, activity, kind = 'expense' }) {
  const cell = (v) => `<td class="${moneyCls(v)}">${money(v)}</td>`;
  // Spending is normal activity, not an alarm — show it as a plain positive
  // amount (like the Spent card up top) and keep red for actual problems.
  // A net-positive month on an expense fund means refunds came in.
  const spentCell = (v) => kind === 'income' ? cell(v)
    : v > 0.004 ? `<td class="pos" title="More came back in than went out this month">+${money(v)}</td>`
    : `<td>${money(Math.abs(v))}</td>`;
  // An income fund's negative leftover just means checks haven't arrived yet —
  // show it quietly instead of as a red warning.
  const leftCell = (v) => kind === 'income' && v < -0.004
    ? `<td class="muted" title="${money(-v)} still expected this month">${money(v)}</td>`
    : cell(v);
  // Column headings sit inside the card, right under the category name and on
  // the same grid, so they label the fund rows they belong to instead of
  // floating above the group. They stay pinned while the card is on screen.
  const colHead = `<div class="acc-col-head">
      <table class="grid tbl-fixed">${FUND_COLS}<thead><tr>
        <th>Fund</th><th>Carry over</th><th>Planned</th><th>${activity}</th><th>Leftover</th><th></th>
      </tr></thead></table>
    </div>`;
  // Open: the header carries just the name — the numbers live in a Total row at
  // the bottom, under the column headings that describe them. Collapsed: the
  // header row is the summary, numbers on the same grid as everything else.
  const totalCells = `${cell(totals.carryOver)}${cell(totals.planned)}${spentCell(totals.spent)}${leftCell(totals.leftover)}`;
  const totalRow = `<table class="grid tbl-fixed">${FUND_COLS}<tbody><tr class="total">
      <td>Total</td>${totalCells}<td></td></tr></tbody></table>`;
  return `<div class="acc ${open ? 'open' : ''}" data-acc="${key}">
    <table class="grid tbl-fixed acc-head-table" data-acc-toggle="${key}">${FUND_COLS}<tbody><tr class="acc-head-row">
      <td class="acc-title-cell"${open ? ' colspan="5"' : ''}>
        <div class="acc-title-wrap">
          <span class="acc-caret">${open ? '▾' : '▸'}</span>
          <span class="acc-title">${title}</span>
          ${note ? `<span class="muted acc-note">${note}</span>` : ''}
        </div>
      </td>
      ${open ? '' : totalCells}
      <td class="acc-actions">${open ? actions : ''}</td>
    </tr></tbody></table>
    <div class="acc-body">${open ? colHead + body + totalRow : ''}</div>
  </div>`;
}

/* ---- "Finish setting up" checklist (onboarding hand-off) ----
 * Lives at the top of the Budget page while settings.setupChecklist exists.
 * Items are done EITHER automatically (detection below, run at render time,
 * latched true, never un-latched) or by the user clicking the check control.
 * Kept visually quiet — it's an invitation, not a nag.
 */
function checklistAutoDetect(month, comp) {
  const list = data.settings.setupChecklist;
  if (!Array.isArray(list)) return;
  const detect = {
    // Every counted expense fund has a number (excludeFromTotals skipped).
    amounts: () => comp.categories.every((c) => c.excludeFromTotals
      || c.funds.every((f) => Math.abs(f.planned) > 0.004)),
    checks: () => false, // latched by opening an income fund panel (showFundPanel)
    tithe: () => Object.values(month.checks || {})
      .some((c) => Math.abs((c.titheAmount ?? 0) - (c.amount ?? 0)) > 0.004),
    import: () => data.months.some((m) => m.transactions.some((t) => (t.account || '').trim())),
    unassigned: () => comp.unassigned.length === 0,
  };
  let changed = false;
  for (const item of list) {
    if (!item.done && detect[item.key] && detect[item.key]()) { item.done = true; changed = true; }
  }
  if (changed) markDirty();
}

function checklistHtml(month) {
  const list = data.settings.setupChecklist;
  if (!Array.isArray(list) || !list.length) return '';
  const labels = {
    amounts: `Put a number in each envelope — how much is ${month.label} getting?`,
    checks: 'Double-check your paycheck numbers',
    tithe: 'Set the before-tax check amount your giving is based on',
    import: 'Bring in your bank transactions',
    unassigned: 'A few imported transactions need an envelope',
  };
  if (list.every((i) => i.done)) {
    return `<div class="section checklist">
      <div class="checklist-head"><b>🎉 You're set up.</b>
        <button class="btn btn-sm" data-cl-done>Done</button></div>
    </div>`;
  }
  return `<div class="section checklist">
    <div class="checklist-head"><b>Finish setting up</b>
      <button class="btn-ghost" data-cl-dismiss title="Dismiss this list for good">Dismiss</button></div>
    ${list.map((i) => `<div class="checklist-item ${i.done ? 'done' : ''}">
      <button class="cl-check" data-cl-mark="${i.key}" title="${i.done ? 'Done' : 'Mark as done'}">${i.done ? '✓' : ''}</button>
      ${i.key === 'amounts'
        ? `<span>${esc(labels[i.key])}</span>`
        : `<a href="#" data-cl-go="${i.key}">${esc(labels[i.key])}</a>`}
    </div>`).join('')}
  </div>`;
}

function checklistNavigate(key) {
  if (key === 'checks' || key === 'tithe') {
    const month = curMonth();
    const idx = month.income.findIndex((f) => (f.group || 'bonus') === 'standard');
    if (idx >= 0) showFundPanel({ kind: 'income', idx });
  } else if (key === 'import') {
    view = 'import'; render();
  } else if (key === 'unassigned') {
    txFundFilter = '__unassigned__'; txSearch = ''; view = 'transactions'; render();
  }
}

function renderBudget(main) {
  const month = curMonth();
  const comp = computeMonth(month);
  const s = comp.summary;
  const balanced = Math.abs(s.leftToAllocate) < 0.005;
  // Auto-calculated amounts (tithe %, yearly ÷ 12…) round to whole cents, so a
  // month can be "off" by a cent or two with nothing actually wrong. Say so
  // instead of raising a red flag over a penny.
  const roundingOnly = !balanced && Math.abs(s.leftToAllocate) <= 0.02;

  const flags = fundFlags(month, comp, todayISO());
  const attList = flags.filter((x) => x.attention);
  const offList = flags.filter((x) => x.offset);
  const flagMap = {};
  for (const x of flags) flagMap[normFund(x.fund)] = x;

  // Variable-income true-up: nudge when a paycheck estimate has drifted from
  // what actually arrived. Over-received nudges any time; under-received only
  // once the month is done — mid-month a low number just means checks haven't
  // landed yet, which the muted "still expected" leftover already covers.
  const nowMonth = todayISO().slice(0, 7);
  const [mYr, mMo] = month.id.split('-').map(Number);
  const monthDone = month.id < nowMonth ||
    (month.id === nowMonth && Number(todayISO().slice(8, 10)) >= new Date(mYr, mMo, 0).getDate());
  const checkIns = [];
  for (const f of comp.income) {
    if ((f.group || 'bonus') !== 'standard') continue;
    if (!(f.rule && f.rule.type === 'checks')) continue; // planned manually overridden — the estimate no longer drives it
    const chk = (month.checks || {})[f.fund];
    if (!chk || !chk.variable || !(chk.count > 0)) continue;
    const diff = r2(f.received - f.planned);
    if (diff > 1 || (diff < -1 && monthDone)) checkIns.push({ fund: f.fund, diff });
  }

  const reviewCount = attList.length + offList.length + checkIns.length + (comp.unassigned.length ? 1 : 0);

  // Which sections are expanded: search overrides, else remembered, else smart default.
  const q = fundSearch.trim().toLowerCase();
  const matches = (name) => !q || String(name).toLowerCase().includes(q);
  let openSet = loadOpenState(month.id) || defaultOpenState(comp, flagMap);
  const isOpen = (key) => (q ? true : openSet.has(key));

  checklistAutoDetect(month, comp);

  let html = `
    ${checklistHtml(month)}
    <div class="month-head">
      <div class="hero ${s.leftToAllocate >= -0.004 || roundingOnly ? 'good' : 'bad'}">
        <div class="k">Left to allocate</div>
        <div class="v">${money(s.leftToAllocate)}</div>
        <div class="note">${balanced ? 'Zero-based ✓ — every dollar has a job'
          : roundingOnly ? `Zero-based ✓ — the ${Math.round(Math.abs(s.leftToAllocate) * 100)}¢ is rounding from auto-calculated amounts`
          : s.leftToAllocate > 0 ? 'Income not yet assigned to a fund'
          : 'Planned more than your income'}
          · planned income ${money(s.plannedIncome)} · allocated ${money(s.allocated)}</div>
      </div>
      <div class="recap-stats month-stats">
        <div><span class="k">Income</span><span class="v pos">${money(actIncome(comp))}</span></div>
        <div><span class="k">Spent</span><span class="v">${money(Math.abs(actExpense(comp)))}</span></div>
        <div><span class="k">Net</span><span class="v ${actDiff(comp) >= 0 ? 'pos' : 'neg'}">${money(actDiff(comp))}</span></div>
      </div>
      ${exT() ? '<p class="muted month-head-note">Income, spent and net exclude fund-to-fund transfers.</p>' : ''}
    </div>
    <div class="toolbar">
      <input class="search" id="fundSearch" placeholder="Find a fund…" value="${esc(fundSearch)}"
        title="Filters the funds shown below. Categories with no match are hidden.">
      ${fundSearch ? `<button class="btn btn-sm" id="clearFundSearch">✕</button>` : ''}
      <button class="btn btn-sm" id="addFundBtn">+ Add fund</button>
      <button class="btn btn-sm" id="transferBtn" title="Move money from one fund to another">⇄ Transfer</button>
      <button class="btn btn-sm" id="expandAllBtn" title="Expand or collapse every section">${openSet.size ? 'Collapse all' : 'Expand all'}</button>
      <div class="spacer"></div>
      ${reviewCount ? `<button class="btn btn-sm review-badge ${attList.length ? 'has-att' : 'all-good'} ${flagPanel ? 'active' : ''}" id="reviewBtn">
        ${attList.length ? '⚠' : '💡'} Review · ${reviewCount}</button>` : '<span class="muted" style="font-size:.85rem">Nothing to review ✓</span>'}
    </div>`;

  // One review strip: what needs attention, what's free to move, what isn't filed.
  if (flagPanel && reviewCount) {
    const group = (title, hint, rows) => rows.length ? `
      <div class="review-group">
        <div class="review-group-head">${title} <span class="muted">· ${rows.length}</span>
          <span class="review-hint muted">${hint}</span></div>
        <table class="grid compact"><tbody>${rows.join('')}</tbody></table>
      </div>` : '';

    const attRows = attList.map((x) => `<tr>
      <td><a href="#" class="fund-name" data-review-fund="${esc(x.fund)}">${esc(x.fund)}</a>
        <span class="muted">· ${esc(x.category)}</span></td>
      <td>${x.attention === 'exceeded'
        ? `Over by ${money(-x.leftover)}`
        : `Off pace — ${money(x.spent)} of ${money(r2(x.carryOver + x.planned))} spent`}</td>
      <td class="${moneyCls(x.leftover)}">${money(x.leftover)}</td>
      <td style="width:40px"><button class="btn-ghost" data-xfer="${esc(x.fund)}" title="Move money into this fund">⇄</button></td></tr>`);

    const offRows = offList.map((x) => `<tr>
      <td><a href="#" class="fund-name" data-review-fund="${esc(x.fund)}">${esc(x.fund)}</a>
        <span class="muted">· ${esc(x.category)}</span></td>
      <td>Its transactions are in; no more expected</td>
      <td class="pos">${money(x.leftover)}</td>
      <td style="width:40px"><button class="btn-ghost" data-xfer="${esc(x.fund)}" title="Transfer this money to another fund">⇄</button></td></tr>`);

    const unRows = comp.unassigned.length ? [`<tr>
      <td colspan="3">${comp.unassigned.length} transaction(s) aren't assigned to a fund this month</td>
      <td style="width:40px"><button class="btn-ghost" data-act="show-unassigned" title="Review them">→</button></td></tr>`] : [];

    // Income estimates aren't problems, so they get their own group rather than
    // riding along under "Needs attention".
    const chkInRows = checkIns.map((x) => `<tr>
      <td><a href="#" class="fund-name" data-review-fund="${esc(x.fund)}">${esc(x.fund)}</a>
        <span class="muted">· Standard Income</span></td>
      <td>Checks came in ${money(Math.abs(x.diff))} ${x.diff > 0 ? 'over' : 'under'} the estimate</td>
      <td class="${moneyCls(x.diff)}">${money(x.diff)}</td>
      <td style="width:92px"><button class="btn btn-sm" data-use-actual="${esc(x.fund)}"
        title="Update the per-check estimate so planned matches what actually arrived — next month starts from the real number too">Use actual</button></td></tr>`);

    html += `<div class="review-strip">
      ${group('⚠ Needs attention', 'over budget or spending too fast', attRows)}
      ${group('💡 Available to move', 'safe to transfer elsewhere', offRows)}
      ${group('📥 Unassigned transactions', 'not counted in any fund', unRows)}
      ${group('💵 Paycheck check-in', 'update the estimate to what actually arrived', chkInRows)}
    </div>`;
  }

  // Income sections: Standard (paychecks) and Bonus (everything else)
  const incomeGroups = [
    { key: 'standard', title: 'Standard Income', hint: 'Paychecks, bonuses, or a main source of income. Planned = checks × per-check amount. The tithe uses the titheable amount (before insurance/retirement deductions), not the deposited amount. If your pay varies, open the fund and turn on "amount varies" — plan low and let the month review true it up.' },
    { key: 'bonus', title: 'Extra Income', hint: 'Inconsistent income you want to track — gifts, reimbursements, transfers. Tithed at the full planned amount unless exempt.' },
  ];
  // Transactions per fund this month (for the count column).
  const txCounts = {};
  for (const t of month.transactions) {
    const k = normFund(t.fund);
    if (k) txCounts[k] = (txCounts[k] || 0) + 1;
  }
  // Transaction count rides next to the fund name rather than owning a column.
  const txChip = (f) => {
    const n = txCounts[normFund(f.fund)] || 0;
    return n
      ? `<a href="#" class="tx-count" data-txfund="${esc(f.fund)}" title="See this fund's ${n} transaction${n === 1 ? '' : 's'} this month">${n}</a>`
      : '';
  };

  for (const g of incomeGroups) {
    const all = comp.income.map((f, i) => ({ f, i })).filter(({ f }) => (f.group || 'bonus') === g.key);
    const rows = all.filter(({ f }) => matches(f.fund));
    if (q && !rows.length) continue;
    const isStd = g.key === 'standard';
    const accKey = `inc:${g.key}`;
    const open = isOpen(accKey);
    // Same column grammar as the expense tables; this card's own heading row
    // labels the columns, so no per-section header row.
    let body = `<table class="grid tbl-fixed">${FUND_COLS}<tbody>`;
    for (const { f, i } of rows) {
      const chk = (month.checks || {})[f.fund] || { count: 0, amount: 0, titheAmount: 0 };
      // Paycheck maths live in the fund panel; the row just states the result.
      const caption = isStd && chk.count
        ? `<div class="fund-note">${chk.count} × ${money(chk.amount)}${chk.variable ? ' est.' : ''}${chk.titheAmount && Math.abs(chk.titheAmount - chk.amount) > 0.004
            ? ` · titheable ${money(chk.titheAmount)}` : ''}</div>`
        : '';
      body += `<tr>
        <td><a href="#" class="fund-name" data-inc-setup="${i}" title="Open this fund — income type, tithe, carry-over, paycheck">${esc(f.fund)}</a>${
          f.titheExempt ? '<span class="type-mark quiet" title="Exempt from tithe — not counted in the tithe base.">⊘</span>' : ''}${
          f.carryForward ? '<span class="type-mark" title="Leftover rolls into next month\'s carry-over instead of resetting to $0.">↷</span>' : ''}${txChip(f)}${caption}</td>
        <td><input class="money" data-inc="${i}" data-k="carryOver" value="${money(f.carryOver)}"></td>
        <td><input class="money" data-inc="${i}" data-k="planned" value="${money(f.planned)}"></td>
        <td class="${moneyCls(f.received)}"><a href="#" class="mono" data-txfund="${esc(f.fund)}" style="color:inherit">${money(f.received)}</a></td>
        <td class="${f.leftover < -0.004 ? 'muted' : moneyCls(f.leftover)}"${
          f.leftover < -0.004 ? ` title="${money(-f.leftover)} still expected this month"` : ''}>${money(f.leftover)}</td>
        <td class="row-actions"><button class="btn-ghost row-more" data-inc-setup="${i}" title="Open this fund — setup, transfer, reorder, transactions">⋯</button></td></tr>`;
    }
    body += `</tbody></table>`;
    const gt = {
      carryOver: r2(all.reduce((a, { f }) => a + f.carryOver, 0)),
      planned: r2(all.reduce((a, { f }) => a + f.planned, 0)),
      spent: r2(all.reduce((a, { f }) => a + f.received, 0)),
      leftover: r2(all.reduce((a, { f }) => a + f.leftover, 0)),
    };
    html += accordionHtml({
      key: accKey,
      activity: 'Received',
      kind: 'income',
      title: `<span title="${esc(g.hint)}">${g.title}</span>`,
      note: `${all.length} fund${all.length === 1 ? '' : 's'}`,
      open,
      totals: gt,
      actions: `<button class="btn-ghost" data-add-inc="${g.key}" title="Add a fund to ${esc(g.title)}">+</button>`,
      body,
    });
  }

  let hiddenCats = 0;
  comp.categories.forEach((c, ci) => {
    const shown = c.funds.map((f, fi) => ({ f, fi })).filter(({ f }) => matches(f.fund));
    if (q && !shown.length && !matches(c.name)) { hiddenCats++; return; }
    const rows = (q && !shown.length && matches(c.name)) ? c.funds.map((f, fi) => ({ f, fi })) : shown;
    const accKey = `cat:${ci}`;
    const open = isOpen(accKey);
    let body = `<table class="grid tbl-fixed">${FUND_COLS}<tbody>`;
    rows.forEach(({ f, fi }) => {
      body += `<tr>
        <td><a href="#" class="fund-name" data-fund-setup="${ci}:${fi}" title="Open this fund — type, schedule, goal, actions">${esc(f.fund)}</a>${fundChips(f, flagMap[normFund(f.fund)], month.id)}${txChip(f)}</td>
        <td><input class="money" data-cat="${ci}" data-fund="${fi}" data-k="carryOver" value="${money(f.carryOver)}"></td>
        <td><input class="money" data-cat="${ci}" data-fund="${fi}" data-k="planned" value="${money(f.planned)}"></td>
        <td class="${f.expensed > 0.004 ? 'pos' : ''}"><a href="#" class="mono" data-txfund="${esc(f.fund)}" style="color:inherit"${
          f.expensed > 0.004 ? ' title="More came back in than went out this month"' : ''}>${
          f.expensed > 0.004 ? '+' + money(f.expensed) : money(Math.abs(f.expensed))}</a></td>
        <td class="${moneyCls(f.leftover)}">${money(f.leftover)}</td>
        <td class="row-actions"><button class="btn-ghost row-more" data-fund-setup="${ci}:${fi}" title="Open this fund — setup, transfer, reorder, transactions">⋯</button></td></tr>`;
    });
    if (!rows.length) body += `<tr><td colspan="6" class="muted" style="padding:10px 12px">No funds yet — use “+ Add fund”.</td></tr>`;
    body += `</tbody></table>`;
    const t = c.totals;
    html += accordionHtml({
      key: accKey,
      activity: 'Spent',
      title: esc(c.name),
      note: `${c.funds.length} fund${c.funds.length === 1 ? '' : 's'}${c.excludeFromTotals ? ' · not counted in totals' : ''}`,
      open,
      totals: { carryOver: t.carryOver, planned: t.planned, spent: t.expensed, leftover: t.leftover },
      actions: `<button class="btn-ghost" data-add-fund="${ci}" title="Add a fund to ${esc(c.name)}">+</button>
        <button class="btn-ghost" data-del-cat="${ci}" title="Remove “${esc(c.name)}” (must be empty first; past months keep it)">✕</button>`,
      body,
    });
  });

  if (q && hiddenCats) html += `<p class="muted" style="margin-top:-6px">${hiddenCats} categor${hiddenCats === 1 ? 'y' : 'ies'} hidden by the search.</p>`;
  html += `<button class="btn" data-add-cat title="Add a new expense category to this month (rolls into future months)">+ Add category</button>`;

  main.innerHTML = html;

  // --- wire events ---
  $('#transferBtn').onclick = () => showTransferModal();
  $('#addFundBtn').onclick = () => showAddFund({ side: 'expense', ci: 0 });
  $('#expandAllBtn').onclick = () => {
    if (openSet.size) openSet = new Set();
    else {
      openSet = new Set(['inc:standard', 'inc:bonus']);
      comp.categories.forEach((_, ci) => openSet.add(`cat:${ci}`));
    }
    saveOpenState(month.id, openSet);
    render();
  };
  const fs = $('#fundSearch');
  fs.oninput = (e) => {
    fundSearch = e.target.value;
    render();
    const el = $('#fundSearch');
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  };
  const cfs = $('#clearFundSearch');
  if (cfs) cfs.onclick = () => { fundSearch = ''; render(); };
  const rv = $('#reviewBtn'); if (rv) rv.onclick = () => { flagPanel = flagPanel ? null : 'review'; render(); };
  main.onclick = (e) => {
    // Setup checklist: navigate, mark, dismiss, or celebrate-and-close.
    const clGo = e.target.closest('[data-cl-go]');
    if (clGo) { e.preventDefault(); checklistNavigate(clGo.dataset.clGo); return; }
    const clMark = e.target.closest('[data-cl-mark]');
    if (clMark) {
      const item = (data.settings.setupChecklist || []).find((i) => i.key === clMark.dataset.clMark);
      if (item) { item.done = !item.done; markDirty(); render(); }
      return;
    }
    if (e.target.closest('[data-cl-dismiss]')) {
      if (confirm("You can't get this list back — dismiss it?")) {
        delete data.settings.setupChecklist;
        markDirty(); render();
      }
      return;
    }
    if (e.target.closest('[data-cl-done]')) {
      delete data.settings.setupChecklist;
      markDirty(); render();
      return;
    }
    // Accordion toggle — but not when the click lands on a header action button.
    const accHead = e.target.closest('[data-acc-toggle]');
    if (accHead && !e.target.closest('.acc-actions')) {
      const key = accHead.dataset.accToggle;
      if (openSet.has(key)) openSet.delete(key); else openSet.add(key);
      saveOpenState(month.id, openSet);
      render();
      return;
    }
    const xfer = e.target.closest('[data-xfer]');
    if (xfer) { showTransferModal(xfer.dataset.xfer); return; }
    // Variable-income true-up: snap the per-check estimate to what actually
    // arrived. Never writes planned directly — recalcRules recomputes it from
    // count × amount, which keeps the checks rule alive and rolls the real
    // number into next month.
    const useAct = e.target.closest('[data-use-actual]');
    if (useAct) {
      const fInc = comp.income.find((x) => normFund(x.fund) === normFund(useAct.dataset.useActual));
      const chk = fInc && (month.checks || {})[fInc.fund];
      if (chk && chk.count > 0) {
        chk.amount = r2(fInc.received / chk.count);
        recalcRules(month); markDirty(); render();
        toast(`"${fInc.fund}" estimate updated to ${money(chk.amount)} per check.`);
      }
      return;
    }
    // Review-strip fund name → open that fund's panel wherever it lives.
    const rvFund = e.target.closest('[data-review-fund]');
    if (rvFund) {
      e.preventDefault();
      const name = normFund(rvFund.dataset.reviewFund);
      const ii = month.income.findIndex((f) => normFund(f.fund) === name);
      if (ii >= 0) { showFundPanel({ kind: 'income', idx: ii }); return; }
      for (let ci = 0; ci < month.categories.length; ci++) {
        const fi = month.categories[ci].funds.findIndex((f) => normFund(f.fund) === name);
        if (fi >= 0) { showFundPanel({ kind: 'expense', ci, fi }); return; }
      }
      return;
    }
    const a = e.target.closest('[data-txfund]');
    if (a) { e.preventDefault(); txFundFilter = a.dataset.txfund; txSearch = ''; view = 'transactions'; render(); return; }
    const showU = e.target.closest('[data-act="show-unassigned"]');
    if (showU) { txFundFilter = '__unassigned__'; txSearch = ''; view = 'transactions'; render(); return; }
    const addInc = e.target.closest('[data-add-inc]');
    if (addInc) {
      showAddFund({ side: 'income', group: addInc.dataset.addInc });
      return;
    }
    const incSetup = e.target.closest('[data-inc-setup]');
    if (incSetup) {
      e.preventDefault();
      showFundPanel({ kind: 'income', idx: Number(incSetup.dataset.incSetup) });
      return;
    }
    const addCat = e.target.closest('[data-add-cat]');
    if (addCat) {
      promptName('New category', 'Category name', (nm) => {
        if (month.categories.some((c) => c.name.toLowerCase() === nm.toLowerCase())) return 'That category already exists.';
        month.categories.push({ name: nm, excludeFromTotals: false, funds: [] });
        markDirty(); render();
      });
      return;
    }
    const delCat = e.target.closest('[data-del-cat]');
    if (delCat) {
      const ci = Number(delCat.dataset.delCat);
      const c = month.categories[ci];
      if (c.funds.length) return toast(`"${c.name}" still has ${c.funds.length} fund(s) — remove or empty them first.`);
      if (!confirm(`Remove category "${c.name}" from ${monthLabel(month.id)}? Past months keep it.`)) return;
      month.categories.splice(ci, 1);
      markDirty(); render();
      return;
    }
    const addF = e.target.closest('[data-add-fund]');
    if (addF) {
      showAddFund({ side: 'expense', ci: Number(addF.dataset.addFund) });
      return;
    }
    const setupLink = e.target.closest('[data-fund-setup]');
    if (setupLink) {
      e.preventDefault();
      const [ci, fi] = setupLink.dataset.fundSetup.split(':').map(Number);
      showFundPanel({ kind: 'expense', ci, fi });
      return;
    }
  };
  main.onchange = (e) => {
    const el = e.target;
    if (el.matches('[data-inc]')) {
      const f = month.income[Number(el.dataset.inc)];
      const v = parseMoney(el.value);
      if (!isNaN(v)) {
        if (el.dataset.k === 'planned' && f.rule) f.rule = null; // manual override clears auto rule
        f[el.dataset.k] = v;
        recalcRules(month); markDirty();
      }
      render(); return;
    }
    if (el.matches('[data-cat]')) {
      const f = month.categories[Number(el.dataset.cat)].funds[Number(el.dataset.fund)];
      const k = el.dataset.k;
      const v = parseMoney(el.value);
      if (!isNaN(v)) {
        if (k === 'planned' && f.rule) f.rule = null; // manual override clears auto rule
        f[k] = v;
        // Editing planned on a fixed-recurring fund is just a per-month override —
        // the setup stays, the "overridden" chip appears, and new months reset.
        recalcRules(month); markDirty();
      }
      render(); return;
    }
  };

}

/* ---------------- Transactions view ---------------- */
function renderTransactions(main) {
  const month = curMonth();
  const known = new Set();
  for (const f of month.income) known.add(normFund(f.fund));
  for (const c of month.categories) for (const f of c.funds) known.add(normFund(f.fund));

  const accounts = [...new Set(month.transactions.map((t) => (t.account || '').trim()).filter(Boolean))].sort();

  let list = month.transactions.map((t, i) => ({ t, i }));
  if (txFundFilter === '__unassigned__') list = list.filter(({ t }) => !known.has(normFund(t.fund)) || !normFund(t.fund));
  else if (txFundFilter) list = list.filter(({ t }) => normFund(t.fund) === normFund(txFundFilter));
  if (txAccountFilter) list = list.filter(({ t }) => (t.account || '').trim() === txAccountFilter);
  if (txSearch) {
    const q = txSearch.toLowerCase();
    list = list.filter(({ t }) =>
      (t.vendor || '').toLowerCase().includes(q) || (t.fund || '').toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q) || String(t.amount).includes(q));
  }
  list.sort((a, b) => (b.t.date || '0000').localeCompare(a.t.date || '0000') || b.i - a.i);
  const sum = r2(list.reduce((a, { t }) => a + t.amount, 0));
  const lmap = leftoverMap(month);

  let html = `<h1>Transactions — ${monthLabel(month.id)}</h1>
    <p class="sub">Expenses are negative, income positive. Type <span class="mono">-12.34</span> or <span class="mono">(12.34)</span> for an expense.</p>
    <div class="toolbar">
      <button class="btn btn-accent" id="addTx">+ Add transaction</button>
      <button class="btn" id="txTransferBtn" title="Move money from one fund to another">⇄ Transfer</button>
      <input class="search" id="txSearch" placeholder="Search vendor, fund, amount…" value="${esc(txSearch)}">
      ${accounts.length ? `<select class="inline" id="txAccount" title="Filter by account">
        <option value="">All accounts</option>
        ${accounts.map((a) => `<option value="${esc(a)}" ${a === txAccountFilter ? 'selected' : ''}>${esc(a)}</option>`).join('')}
      </select>` : ''}
      ${txFundFilter ? `<button class="btn btn-sm" id="clearFilter">Fund: ${esc(txFundFilter === '__unassigned__' ? 'unassigned' : txFundFilter)} ✕</button>` : ''}
      <div class="spacer"></div>
      <span class="muted">${list.length} shown · net ${money(sum)}</span>
    </div>
    <div class="section"><table class="grid"><thead><tr>
      <th style="width:110px;text-align:left">Date</th><th style="text-align:left">Vendor</th><th>Amount</th>
      <th style="text-align:left">Fund</th><th style="text-align:left">Description</th><th style="width:120px;text-align:left">Account</th><th style="width:34px"></th>
    </tr></thead><tbody>`;
  for (const { t, i } of list) {
    const bad = !known.has(normFund(t.fund)) || !normFund(t.fund);
    html += `<tr>
      <td><input class="inline-text inline-date" data-tx="${i}" data-k="date" value="${t.date ? fmtDate(t.date) : ''}" placeholder="m/d/yy"></td>
      <td><input class="inline-text" data-tx="${i}" data-k="vendor" value="${esc(t.vendor)}"></td>
      <td><input class="money" data-tx="${i}" data-k="amount" value="${money(t.amount)}"></td>
      <td><select class="inline ${bad ? 'missing' : ''}" data-tx="${i}" data-k="fund">${fundOptions(month, t.fund, lmap)}</select>
        ${bad && t.fund ? `<div class="fund-note">was: ${esc(t.fund)}</div>` : ''}</td>
      <td><input class="inline-text" data-tx="${i}" data-k="description" value="${esc(t.description || '')}"></td>
      <td><input class="inline-text" data-tx="${i}" data-k="account" value="${esc(t.account || '')}"></td>
      <td><button class="btn-ghost" data-del-tx="${i}" title="Delete">🗑</button></td></tr>`;
  }
  if (!list.length) html += `<tr><td colspan="7" class="muted" style="text-align:center;padding:24px">No transactions${txSearch || txFundFilter ? ' match the filter' : ' yet'}.</td></tr>`;
  html += `</tbody></table></div>`;
  main.innerHTML = html;

  $('#addTx').onclick = () => {
    month.transactions.push({ id: newTxId(), date: defaultDateFor(month), vendor: '', amount: 0, fund: '', description: '', account: '' });
    txSearch = ''; txFundFilter = '';
    markDirty(); render();
  };
  $('#txTransferBtn').onclick = () => showTransferModal();
  const acctSel = $('#txAccount');
  if (acctSel) acctSel.onchange = (e) => { txAccountFilter = e.target.value; render(); };
  $('#txSearch').oninput = (e) => { txSearch = e.target.value; render(); $('#txSearch').focus(); const v = $('#txSearch').value; $('#txSearch').setSelectionRange(v.length, v.length); };
  const cf = $('#clearFilter');
  if (cf) cf.onclick = () => { txFundFilter = ''; render(); };

  main.onchange = (e) => {
    const el = e.target;
    if (!el.matches('[data-tx]')) return;
    const t = month.transactions[Number(el.dataset.tx)];
    const k = el.dataset.k;
    if (k === 'amount') {
      const v = parseMoney(el.value);
      if (!isNaN(v)) t.amount = v;
    } else if (k === 'date') {
      const m = el.value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if (m) {
        let y = Number(m[3]); if (y < 100) y += 2000;
        t.date = `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
      } else if (!el.value.trim()) t.date = null;
    } else t[k] = el.value;
    markDirty(); render();
  };
  main.onclick = (e) => {
    const del = e.target.closest('[data-del-tx]');
    if (del) {
      const t = month.transactions[Number(del.dataset.delTx)];
      if (confirm(`Delete: ${fmtDate(t.date)} ${t.vendor} ${money(t.amount)}?`)) {
        month.transactions.splice(Number(del.dataset.delTx), 1);
        markDirty(); render();
      }
    }
  };
}

/* ---------------- Import view ---------------- */
// "Jan 5, 2026" — the summary band spells dates out so a wrong century or a
// day/month flip is obvious at a glance, which a 01/05/26 rendering never is.
function fmtDateWords(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${M[m - 1]} ${d}, ${y}`;
}
function fmtDateRange(min, max) {
  if (!min || !max) return '—';
  if (min === max) return fmtDateWords(min);
  if (min.slice(0, 4) === max.slice(0, 4)) return `${fmtDateWords(min).replace(/,.*$/, '')} – ${fmtDateWords(max)}`;
  return `${fmtDateWords(min)} – ${fmtDateWords(max)}`;
}

/* One report, two consumers (importer work order §4): the Import view and the
 * onboarding wizard render the importer's blocking questions identically —
 * the copy comes from parseBankFile and is never rewritten here. */
function csvQuestionsHtml(questions) {
  let html = `<div class="section import-questions">
    <div class="import-questions-head">Before this can be imported, the app needs your help — it won't guess:</div>`;
  questions.forEach((q, qi) => {
    html += `<div class="import-question"><p>${esc(q.message)}</p>`;
    if (q.samples?.length && q.kind === 'dateOrder') {
      html += `<table class="grid import-q-samples"><thead><tr><th style="text-align:left">In the file</th><th style="text-align:left">Month first</th><th style="text-align:left">Day first</th></tr></thead><tbody>`;
      for (const s of q.samples) {
        html += `<tr><td>${esc(s.raw)}${s.vendor ? ` <span class="fund-note">${esc(s.vendor.slice(0, 24))}</span>` : ''}</td>
          <td>${fmtDateWords(s.asMDY)}</td><td>${fmtDateWords(s.asDMY)}</td></tr>`;
      }
      html += `</tbody></table>`;
    }
    if (q.answerable) {
      for (const opt of q.options) {
        html += `<label class="import-q-opt"><input type="radio" name="impq-${qi}" value="${esc(opt.value)}" data-imp-q="${qi}"> ${esc(opt.label)}</label>`;
      }
    }
    html += `</div>`;
  });
  if (questions.some((q) => q.answerable)) {
    html += `<div class="toolbar"><button class="btn btn-accent" id="applyAnswers" disabled>Use these answers</button></div>`;
  }
  html += `</div>`;
  return html;
}

// Companion wiring for csvQuestionsHtml: enables the apply button once every
// answerable question has an answer, then hands the merged answers back so the
// caller re-runs parseBankFile with them.
function wireCsvQuestions(root, questions, prevAnswers, onApply) {
  if (!questions.some((q) => q.answerable)) return;
  const applyBtn = $('#applyAnswers', root);
  const chosen = () => questions.map((q, qi) => q.answerable
    ? root.querySelector(`input[name="impq-${qi}"]:checked`)?.value : 'n/a');
  root.querySelectorAll('[data-imp-q]').forEach((el) => {
    el.onchange = () => { if (applyBtn) applyBtn.disabled = chosen().some((v) => !v); };
  });
  if (applyBtn) {
    applyBtn.onclick = () => {
      const answers = { ...prevAnswers };
      questions.forEach((q, qi) => {
        if (!q.answerable) return;
        answers[q.answerKey] = root.querySelector(`input[name="impq-${qi}"]:checked`)?.value;
      });
      onApply(answers);
    };
  }
}

// One stored shape for imported rows, shared by the Import view and the
// onboarding wizard — wizard-imported rows must dedupe correctly against the
// user's next import, so the two paths can never drift apart.
function pushImportedTx(month, rec, fund, idTrusted) {
  // The memo (Comments / Extended Details) is often the real merchant string —
  // keep it on the transaction as its description. A validated bank
  // transaction id rides along so the next import of this account can dedupe
  // exactly instead of heuristically.
  const tx = {
    id: newTxId(), date: rec.date, vendor: rec.vendor, amount: rec.amount,
    fund, description: rec.memo || '', account: rec.account,
  };
  if (idTrusted && rec.externalId) tx.externalId = rec.externalId;
  month.transactions.push(tx);
  return tx;
}

// The import is the confirmation (importer §6): persist this file's resolved
// shape so the next export from the same bank skips inference and questions.
// Seed-recognised formats ship with the app and aren't re-persisted — unless
// the user had to answer something (a seed match that still asked, like the
// generic 3-column header), which is exactly what's worth saving.
function persistResolvedProfile(report, answers) {
  const rp = report?.resolvedProfile;
  if (!rp) return;
  const gaveAnswers = Object.keys(answers || {}).some((k) => k !== 'ignoreProfile');
  if (!gaveAnswers && report?.profile?.source === 'seed') return;
  window.budgetAPI.loadBankProfiles().then((store) => {
    const profiles = (store?.profiles || []).filter((p) => p.fingerprint !== rp.fingerprint);
    profiles.push({ ...rp, confirmedByUser: true, lastUsed: new Date().toISOString().slice(0, 10) });
    return window.budgetAPI.saveBankProfiles({ version: 1, profiles });
  }).catch(() => { /* profiles are a convenience — never block an import on them */ });
}

function renderImport(main) {
  let html = `<h1>Import bank CSV</h1>
    <p class="sub">Pick the CSV you export from your bank. The app works out the file's format, matches each row to a fund based on your history, flags duplicates and card payments, and nothing is saved until you click Import. If something about the file is unclear, it asks instead of guessing.</p>
    <div class="toolbar"><button class="btn btn-accent" id="pickCsv">📄 Choose CSV file…</button></div>`;

  if (importState && importState.refusal) {
    html += `<div class="section import-refusal">
      <b>${esc(importState.fileName)}</b> couldn't be imported.
      <p>${esc(importState.refusal)}</p>
    </div>`;
  } else if (importState) {
    const report = importState.report;
    const questions = report?.questions || [];
    const inc = importState.rows.filter((r) => r.include);
    html += `<div class="toolbar">
      <span><b>${esc(importState.fileName)}</b> — ${importState.rows.length} rows, <b>${inc.length}</b> selected to import</span>
      <div class="spacer"></div>
      <button class="btn" id="cancelImport">Cancel</button>
      <button class="btn btn-accent" id="doImport" ${inc.length && !questions.length ? '' : 'disabled'}>Import ${inc.length} transaction(s)</button>
    </div>`;

    // Summary band: the aggregates are what make a misread file obvious —
    // an inverted sign shows up as impossible income, a date bug as a wrong year.
    const recs = importState.rows.map((r) => r.rec);
    const inTotal = recs.reduce((a, r) => a + (r.amount > 0 ? r.amount : 0), 0);
    const outTotal = recs.reduce((a, r) => a + (r.amount < 0 ? r.amount : 0), 0);
    const dates = recs.map((r) => r.date).sort();
    const anomalies = report?.anomalies || [];
    const pending = report?.counts?.pending || 0;
    let balanceLine = '';
    if (report?.balanceCheck?.ok) {
      balanceLine = `<span class="pos">✓ Balance column reconciles across ${report.balanceCheck.tested} rows — the amounts are provably right</span>`;
    } else if (report && recs.length) {
      balanceLine = `<span class="muted">No balance column — amounts couldn't be verified automatically</span>`;
    }
    html += `<div class="section import-summary">
      ${report?.profile ? `<span><b>${esc(report.profile.name || "A format you've confirmed before")}</b> · recognised automatically <button class="btn btn-sm" id="notThisBank">Not this bank?</button></span>` : ''}
      <span><b>${recs.length}</b> row${recs.length === 1 ? '' : 's'} · ${fmtDateRange(dates[0], dates[dates.length - 1])}</span>
      <span>Money in <b class="pos">${money(inTotal)}</b></span>
      <span>Money out <b class="neg">${money(Math.abs(outTotal))}</b></span>
      ${balanceLine}
      ${pending ? `<span class="muted">${pending} pending row${pending === 1 ? '' : 's'} skipped (they'll re-appear as posted in a later export)</span>` : ''}
      ${(() => { const n = importState.rows.filter((r) => r.possibleDup).length;
        return n ? `<span class="muted">⚠ ${n} row${n === 1 ? ' looks' : 's look'} similar to entries you already have — marked “possible duplicate” below; untick any that are the same purchase</span>` : ''; })()}
      ${report?.signConvention?.verdict === 'flip' ? '<span class="muted">This bank writes spending as positive — amounts were converted so money out shows negative</span>' : ''}
      ${anomalies.length ? `<span class="import-anomaly">⚠ ${anomalies.length} row${anomalies.length === 1 ? '' : 's'} couldn't be read and ${anomalies.length === 1 ? 'was' : 'were'} left out — ${esc(anomalies.slice(0, 3).map((a) => `row ${a.row}: bad ${a.code === 'BadDate' ? 'date' : 'amount'} “${a.msg}”`).join(', '))}${anomalies.length > 3 ? ', …' : ''}</span>` : ''}
    </div>`;

    // Blocking questions: the importer refuses to guess — each answer re-reads
    // the file, and Import stays disabled until every question is resolved.
    if (questions.length) html += csvQuestionsHtml(questions);

    if (importState.rows.length) {
    html += `<div class="section"><table class="grid"><thead><tr>
      <th style="width:30px"></th><th style="text-align:left">Date</th><th style="text-align:left">Vendor</th>
      <th>Amount</th><th style="text-align:left">Month</th><th style="text-align:left">Fund</th><th style="text-align:left">Status</th>
    </tr></thead><tbody>`;
    importState.rows.forEach((row, i) => {
      const rec = row.rec;
      const badges = [];
      if (row.duplicate) badges.push('<span class="badge dup">duplicate</span>');
      else if (row.possibleDup) badges.push('<span class="badge dup-maybe" title="Same place and a similar amount within a few days of an entry you already have — often a tip or a gas-pump hold posting. It will import unless you untick it.">possible duplicate</span>');
      if (rec.isCardPayment) badges.push('<span class="badge pay">card payment</span>');
      if (!row.monthExists) badges.push(`<span class="badge warn">month not started</span>`);
      if (row.include && !row.fund) badges.push('<span class="badge warn">pick a fund</span>');
      if (row.include && row.fund && !row.duplicate && !row.possibleDup && !rec.isCardPayment) badges.push('<span class="badge new">ready</span>');
      const month = row.monthExists ? data.months.find((m) => m.id === row.monthId) : null;
      html += `<tr class="${row.include ? '' : 'import-row-off'}">
        <td><input type="checkbox" data-imp-inc="${i}" ${row.include ? 'checked' : ''} ${row.monthExists ? '' : 'disabled'}></td>
        <td>${fmtDate(rec.date)}</td>
        <td title="${esc(rec.vendor)}${rec.memo ? ' — ' + esc(rec.memo) : ''}">${esc(rec.vendor.length > 38 ? rec.vendor.slice(0, 38) + '…' : rec.vendor)}
          ${rec.account ? `<span class="fund-note"> · ${esc(rec.account)}</span>` : ''}
          ${rec.memo ? `<div class="fund-note">${esc(rec.memo.length > 44 ? rec.memo.slice(0, 44) + '…' : rec.memo)}</div>` : ''}</td>
        <td class="${moneyCls(rec.amount)}">${money(rec.amount)}</td>
        <td>${monthLabel(row.monthId)}</td>
        <td>${month ? `<select class="inline ${row.include && !row.fund ? 'missing' : ''}" data-imp-fund="${i}">${fundOptions(month, row.fund)}</select>` : '<span class="muted">—</span>'}
          ${row.suggestNote ? `<div class="fund-note">${esc(row.suggestNote)}</div>` : ''}</td>
        <td>${badges.join(' ')}</td></tr>`;
    });
    html += `</tbody></table></div>`;
    }
  }
  main.innerHTML = html;

  // Parse (or re-parse, once questions are answered) and build the preview.
  // Refusals and blocking questions come from the importer — the UI only renders.
  const loadCsvForImport = async (fileName, fileData, answers) => {
    let store = null;
    try { store = await window.budgetAPI.loadBankProfiles(); } catch { /* first run / dev */ }
    let result;
    try { result = parseBankFile(fileData, { answers, profiles: store?.profiles || [] }); }
    catch (err) { toast(err.message); return; }
    if (result.error) {
      importState = { fileName, fileData, rows: [], refusal: result.error, answers };
      render();
      return;
    }
    const { records, report } = result;
    if (!records.length && !report.questions.length) {
      toast('No transactions found in that file.');
      return;
    }
    const vendorMap = buildVendorMap(data.months);
    const claimed = new Set();
    const blocked = report.questions.length > 0;
    const rows = records.map((rec) => {
      const monthId = rec.date.slice(0, 7);
      const month = data.months.find((m) => m.id === monthId);
      // Scored matching (§8): ≥0.9 auto-marks as a duplicate; 0.6–0.9 is a
      // "possible duplicate" — still selected, badged for the user to review.
      const dup = month ? findDuplicateScored(data.months, rec, claimed,
        { idTrusted: report.externalIdTrusted }) : null;
      const duplicate = !!dup && dup.score >= 0.9;
      let fund = '', suggestNote = '';
      if (month) {
        // The memo often holds the real merchant string (credit-union exports
        // put a type code in Description) — try it when the vendor is unknown.
        const sug = suggestFund(vendorMap, rec.vendor)
          || (rec.memo ? suggestFund(vendorMap, rec.memo) : null);
        if (sug) {
          const canon = canonicalFund(month, sug.fund);
          if (canon) { fund = canon; suggestNote = `auto-matched (seen ${sug.n}×)`; }
        }
      }
      return {
        rec, monthId, monthExists: !!month, duplicate,
        possibleDup: !!dup && dup.score < 0.9, fund, suggestNote,
        include: !blocked && !!month && !duplicate && !rec.isCardPayment,
      };
    });
    importState = { fileName, fileData, rows, report, answers };
    render();
  };

  $('#pickCsv').onclick = async () => {
    const file = await window.budgetAPI.openCsv();
    if (!file) return;
    // Raw bytes when the IPC provides them (encoding detection); text otherwise.
    loadCsvForImport(file.path.split(/[\\/]/).pop(), file.bytes ?? file.text, {});
  };

  const notThis = $('#notThisBank');
  if (notThis) {
    notThis.onclick = () => loadCsvForImport(importState.fileName, importState.fileData,
      { ...importState.answers, ignoreProfile: true });
  }

  if (importState && !importState.refusal && importState.report?.questions?.length) {
    wireCsvQuestions(main, importState.report.questions, importState.answers,
      (answers) => loadCsvForImport(importState.fileName, importState.fileData, answers));
  }

  if (importState && !importState.refusal) {
    $('#cancelImport').onclick = () => { importState = null; render(); };
    $('#doImport').onclick = () => {
      const chosen = importState.rows.filter((r) => r.include);
      const missing = chosen.filter((r) => !r.fund);
      if (missing.length && !confirm(`${missing.length} selected row(s) have no fund picked — they'll show as "unassigned" until you fix them. Import anyway?`)) return;
      let n = 0, lastMonth = null;
      for (const row of chosen) {
        const month = data.months.find((m) => m.id === row.monthId);
        if (!month) continue;
        pushImportedTx(month, row.rec, row.fund, importState.report?.externalIdTrusted);
        n++; lastMonth = month.id;
      }
      persistResolvedProfile(importState.report, importState.answers);
      importState = null;
      markDirty();
      toast(`Imported ${n} transaction(s).`);
      if (lastMonth) { currentMonthId = lastMonth; view = 'transactions'; txSearch = ''; txFundFilter = ''; }
      render();
    };
    main.onchange = (e) => {
      const inc = e.target.closest('[data-imp-inc]');
      if (inc) { importState.rows[Number(inc.dataset.impInc)].include = inc.checked; render(); return; }
      const fs = e.target.closest('[data-imp-fund]');
      if (fs) {
        const row = importState.rows[Number(fs.dataset.impFund)];
        row.fund = fs.value; row.suggestNote = '';
        if (fs.value && !row.rec.isCardPayment && !row.duplicate) row.include = true;
        render(); return;
      }
    };
  }
}

/* ---------------- Reports view ---------------- */
function renderReports(main) {
  const comps = data.months.map((m) => ({ m, c: computeMonth(m) }));
  let html = `<h1>Year Overview</h1><p class="sub">Actuals per month. Click a month in the sidebar to drill in.</p>`;

  html += `<div class="section"><div class="section-head"><h2>Income vs spending</h2></div><div id="chartIncome"></div></div>`;
  html += `<div class="section"><div class="section-head"><h2>Where the money went (year to date)</h2></div><div id="chartCats"></div></div>`;

  html += `<div class="section report-wrap"><table class="grid compact"><thead><tr><th style="text-align:left">Category</th>`;
  for (const { m } of comps) html += `<th>${m.label.slice(0, 3)}</th>`;
  html += `<th>Total</th></tr></thead><tbody>`;

  // Income row
  html += `<tr><td><b>Income received</b>${exT() ? ' <span class="muted" style="font-weight:400">(excl. transfers)</span>' : ''}</td>`;
  let incTot = 0;
  for (const { c } of comps) { incTot = r2(incTot + actIncome(c)); html += `<td class="pos">${money(actIncome(c))}</td>`; }
  html += `<td class="pos"><b>${money(incTot)}</b></td></tr>`;

  // Category rows (spent shown as positive magnitude). Categories excluded from
  // totals (Work) still get a table row, marked so the columns visibly don't
  // feed the Net line.
  const catNames = [];
  const notCounted = new Set();
  for (const { m } of comps) for (const c of m.categories) {
    if (!catNames.includes(c.name)) catNames.push(c.name);
    if (c.excludeFromTotals) notCounted.add(c.name);
  }
  for (const name of catNames) {
    html += `<tr><td>${esc(name)}${notCounted.has(name) ? ' <span class="muted">· not counted in totals</span>' : ''}</td>`;
    let tot = 0;
    for (const { c } of comps) {
      const cat = c.categories.find((x) => x.name === name);
      const v = cat ? catSpentAbs(cat) : null;
      if (v != null) tot = r2(tot + v);
      html += v == null ? `<td class="dim">·</td>` : `<td>${v ? money(v) : '<span class="dim">—</span>'}</td>`;
    }
    html += `<td><b>${money(tot)}</b></td></tr>`;
  }
  // Net row
  html += `<tr class="total"><td>Net (income − spending)</td>`;
  let netTot = 0;
  for (const { c } of comps) {
    const v = actDiff(c);
    netTot = r2(netTot + v);
    html += `<td class="${moneyCls(v)}">${money(v)}</td>`;
  }
  html += `<td class="${moneyCls(netTot)}"><b>${money(netTot)}</b></td></tr>`;
  html += `</tbody></table></div>`;

  // Fund drilldown
  const allFunds = [];
  for (const m of data.months) {
    for (const c of m.categories) for (const f of c.funds) if (!allFunds.some((x) => normFund(x) === normFund(f.fund))) allFunds.push(f.fund);
  }
  allFunds.sort((a, b) => a.localeCompare(b));
  const sel = main.dataset.fundDrill || '';
  html += `<div class="section"><div class="section-head"><h2>Fund history</h2>
    <select class="inline" id="fundDrill"><option value="">— choose a fund —</option>
    ${allFunds.map((f) => `<option ${normFund(f) === normFund(sel) ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select></div>`;
  if (sel) {
    html += `<div id="chartFund"></div>`;
    html += `<table class="grid compact"><thead><tr><th style="text-align:left">Month</th><th>Carry over</th><th>Planned</th><th>Spent</th><th>Leftover</th></tr></thead><tbody>`;
    for (const { m, c } of comps) {
      for (const cat of c.categories) {
        const f = cat.funds.find((x) => normFund(x.fund) === normFund(sel));
        if (f) {
          html += `<tr><td>${monthLabel(m.id)}</td><td>${money(f.carryOver)}</td><td>${money(f.planned)}</td>
            <td class="${moneyCls(f.expensed)}">${money(f.expensed)}</td><td class="${moneyCls(f.leftover)}">${money(f.leftover)}</td></tr>`;
        }
      }
    }
    html += `</tbody></table>`;
  }
  html += `</div>`;
  main.innerHTML = html;

  // ---- mount charts ----
  const labels = comps.map(({ m }) => m.label.slice(0, 3));
  $('#chartIncome').appendChild(groupedBars({
    labels,
    series: [
      { name: 'Income', color: VIZ.s1, values: comps.map(({ c }) => actIncome(c)) },
      { name: 'Spending', color: VIZ.s2, values: comps.map(({ c }) => Math.abs(actExpense(c))) },
    ],
  }));
  // The chart shows household spending only — categories excluded from totals
  // would overstate it.
  const catRows = catNames
    .filter((name) => !notCounted.has(name))
    .map((name) => ({
      label: name,
      value: r2(comps.reduce((a, { c }) => {
        const cat = c.categories.find((x) => x.name === name);
        return a + (cat ? catSpentAbs(cat) : 0);
      }, 0)),
    }))
    .filter((r) => r.value > 0.004)
    .sort((a, b) => b.value - a.value);
  $('#chartCats').appendChild(barList({ rows: catRows, color: VIZ.s1 }));

  if (sel) {
    const months = [], planned = [], spent = [];
    for (const { m, c } of comps) {
      for (const cat of c.categories) {
        const f = cat.funds.find((x) => normFund(x.fund) === normFund(sel));
        if (f) { months.push(m.label.slice(0, 3)); planned.push(Math.max(0, f.planned)); spent.push(Math.abs(f.expensed)); }
      }
    }
    $('#chartFund').appendChild(groupedBars({
      labels: months, height: 190,
      series: [
        { name: 'Planned', color: VIZ.s1, values: planned },
        { name: 'Spent', color: VIZ.s2, values: spent },
      ],
    }));
  }

  $('#fundDrill').onchange = (e) => { main.dataset.fundDrill = e.target.value; renderReports(main); };
  main.dataset.fundDrill = sel;
}

/* ---------------- AUM walkthrough ----------------
 * First-visit guide to the AUM page (settings.aumHelpSeen gates it), reopenable
 * any time from the ? button in the page header. Slides are data; the modal
 * reuses the standard overlay pattern. The SeedTime link opens in the system
 * browser via the https-only openExternal IPC.
 */
const AUM_EPISODE_URL = 'https://seedtime.libsyn.com/aum-the-2nd-most-important-financial-metric-to-track';
const AUM_STALE_DAYS = 90; // drives the amber "stale" chip in the AUM view below

const AUM_SLIDES = [
  {
    img: 'assets/help/aum-overview.png',
    title: 'Meet your AUM',
    body: `AUM stands for <b>Assets Under Management</b> — everything you've been entrusted with,
      minus everything you owe. It's one number: <b>total assets − total debts</b>. We use AUM
      instead of "net worth" on purpose: your worth was never your balance sheet. You're the
      <i>manager</i> of what you've been given — and good managers know what they're managing.`,
  },
  {
    img: 'assets/help/aum-tables.png',
    title: 'List what you manage',
    body: `Add each asset with its rough current value: checking, savings, retirement accounts,
      your home, vehicles. Estimates are fine — you can refine any value later just by
      clicking it. The point is a complete picture, not a perfect one.`,
  },
  {
    img: 'assets/help/aum-tables.png',
    title: 'List what you owe',
    body: `Add each debt as the <b>amount still owed</b>, entered as a positive number — the app
      does the subtracting. Mortgage, car loans, cards, student loans. Seeing debts next to
      assets is the whole exercise: it's all one thing you're managing.`,
  },
  {
    img: 'assets/help/aum-trend.png',
    title: 'Watch the trend, not the number',
    body: `Every edit automatically saves a snapshot for today, and you can press <i>Record
      snapshot</i> any time. The chart and the Δ column show whether you're moving forward.
      That direction — not the number itself — is what faithful management looks like month
      over month. A <b>stale</b> chip means a value hasn't been touched in ${AUM_STALE_DAYS}+ days
      and probably needs a refresh.`,
  },
  {
    img: null,
    title: 'Keep it fresh',
    body: `Update your values about once a month — it takes ten minutes. The change log at the
      bottom remembers every edit. More questions about AUM? It comes from <b>SeedTime</b> —
      Bob &amp; Linda Lotich explain it in their podcast episode <i>"(AUM) The 2nd most important
      financial metric to track."</i>`,
    cta: true,
  },
];

function showAumWalkthrough() {
  // The help button and the first-run path can race a re-render — never two.
  if ($('.walkthrough-overlay')) return;
  let slide = 0;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay walkthrough-overlay';
  overlay.tabIndex = -1;
  overlay.innerHTML = `
    <div class="modal walkthrough">
      <button class="btn-ghost wt-close" id="wtClose" title="Close">✕</button>
      <div class="wt-media" id="wtMedia"></div>
      <h2 id="wtTitle"></h2>
      <p class="wt-body" id="wtBody"></p>
      <div class="wt-cta" id="wtCta"></div>
      <div class="wt-foot">
        <div class="wt-dots" id="wtDots"></div>
        <div class="wt-nav">
          <button class="btn" id="wtBack">Back</button>
          <button class="btn btn-accent" id="wtNext">Next</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => {
    overlay.remove();
    // Every dismissal counts as "seen" — Done, ✕, Escape, or overlay click.
    if (!data.settings.aumHelpSeen) { data.settings.aumHelpSeen = true; markDirty(); }
  };
  const paint = () => {
    const s = AUM_SLIDES[slide];
    const last = slide === AUM_SLIDES.length - 1;
    $('#wtMedia', overlay).innerHTML = s.img
      ? `<img src="${s.img}" alt="${esc(s.title)} — screenshot">` : '';
    $('#wtTitle', overlay).textContent = s.title;
    $('#wtBody', overlay).innerHTML = s.body;
    $('#wtCta', overlay).innerHTML = s.cta
      ? `<button class="btn" id="wtSeedtime">Listen to the SeedTime episode ↗</button>
         <div class="muted" style="font-size:.8rem;margin-top:8px">Reopen this guide any time with the ? button above.</div>`
      : '';
    $('#wtDots', overlay).innerHTML = AUM_SLIDES.map((_, i) =>
      `<button class="wt-dot ${i === slide ? 'on' : ''}" data-slide="${i}" title="Slide ${i + 1}"></button>`).join('');
    $('#wtBack', overlay).style.visibility = slide === 0 ? 'hidden' : 'visible';
    $('#wtNext', overlay).textContent = last ? 'Done' : 'Next';
    const st = $('#wtSeedtime', overlay);
    if (st) st.onclick = () => window.budgetAPI.openExternal(AUM_EPISODE_URL);
  };
  const go = (i) => { slide = Math.max(0, Math.min(AUM_SLIDES.length - 1, i)); paint(); };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { close(); return; }
    const dot = e.target.closest('.wt-dot');
    if (dot) go(Number(dot.dataset.slide));
  });
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') go(slide + 1);
    else if (e.key === 'ArrowLeft') go(slide - 1);
  });
  $('#wtClose', overlay).onclick = close;
  $('#wtBack', overlay).onclick = () => go(slide - 1);
  $('#wtNext', overlay).onclick = () => { if (slide === AUM_SLIDES.length - 1) close(); else go(slide + 1); };
  paint();
  overlay.focus();
}

/* ---------------- AUM view ----------------
 * Assets Under Management (SeedTime's framing of net worth): everything you
 * manage minus everything you owe. Month-independent — ignores the month
 * picker; the value of the tab is the timeline, so every mutation upserts
 * today's snapshot and writes a change-log entry via aumMutate().
 */
function newAumId(kind) {
  return (kind === 'asset' ? 'a_' : 'd_') + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

// "Aug 19", with the year appended once it isn't this year's date.
function fmtShortDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTH_SHORT[m - 1]} ${d}${y === Number(todayISO().slice(0, 4)) ? '' : ` ${y}`}`;
}

function aumDaysAgo(iso) {
  return Math.round((new Date(todayISO()) - new Date(iso)) / 86400000);
}

function findAumItem(id) {
  let item = data.aum.assets.find((x) => x.id === id);
  if (item) return { item, kind: 'asset', list: data.aum.assets };
  item = data.aum.debts.find((x) => x.id === id);
  return item ? { item, kind: 'debt', list: data.aum.debts } : null;
}

// Single choke point for every AUM edit: the caller applies the field change,
// this does the bookkeeping — change log (capped at 200), today's snapshot,
// save, re-render. Nothing can forget a step.
function aumMutate(action, kind, item, { from = null, to = null } = {}) {
  data.aum.log.push({ date: todayISO(), kind, name: item.name, from, to, action });
  if (data.aum.log.length > 200) data.aum.log.splice(0, data.aum.log.length - 200);
  upsertSnapshot(data.aum, todayISO());
  markDirty(); render();
}

function renderAum(main) {
  const aum = data.aum;
  const t = aumTotals(aum);
  const snaps = aum.snapshots;
  const last = snaps[snaps.length - 1], prev = snaps[snaps.length - 2];

  // Hero note: movement since the previous snapshot (needs two to compare).
  let deltaNote = '';
  if (last && prev) {
    const d = r2(last.aum - prev.aum);
    deltaNote = Math.abs(d) > 0.004
      ? `<span class="${d > 0 ? 'pos' : 'neg'}">${d > 0 ? '▲' : '▼'} ${money(Math.abs(d))}</span> since ${fmtShortDate(prev.date)} · `
      : `unchanged since ${fmtShortDate(prev.date)} · `;
  }

  const luAssets = aumLastUpdated(aum.assets);
  const luDebts = aumLastUpdated(aum.debts);

  // One assets/debts section: header carries the total, last-updated and + Add;
  // rows are biggest-first like the worksheet reads.
  const sectionHtml = (kind, title, items) => {
    const total = r2(items.reduce((a, x) => a + (x.value || 0), 0));
    const lu = aumLastUpdated(items);
    const sorted = [...items].sort((a, b) => (b.value || 0) - (a.value || 0));
    let rows = '';
    for (const it of sorted) {
      const days = it.updatedAt ? aumDaysAgo(it.updatedAt) : null;
      const stale = days != null && days > AUM_STALE_DAYS
        ? ` <span class="rule-chip chip-warn" title="Last checked ${days} days ago — worth re-checking the current value.">stale</span>` : '';
      rows += `<tr>
        <td><a href="#" class="fund-name" data-aum-name="${it.id}" title="Rename">${esc(it.name)}</a></td>
        <td><input class="money" data-aum-item="${it.id}" value="${money(it.value)}"></td>
        <td class="muted">${fmtShortDate(it.updatedAt)}${stale}</td>
        <td class="row-actions"><button class="btn-ghost" data-aum-del="${it.id}" title="Remove">✕</button></td></tr>`;
    }
    if (!sorted.length) rows = `<tr><td colspan="4" class="muted" style="padding:12px">Nothing here yet — use “+ Add”.</td></tr>`;
    return `<div class="section aum-section">
      <div class="section-head"><h2>${title} <span class="${kind === 'asset' ? 'pos' : ''}" style="font-weight:600">· ${money(total)}</span></h2>
        <div class="actions">
          ${lu ? `<span class="muted" style="font-size:.8rem;align-self:center">last updated ${fmtShortDate(lu)}</span>` : ''}
          <button class="btn btn-sm" data-aum-add="${kind}">+ Add</button>
        </div></div>
      <table class="grid compact tbl-fixed"><colgroup>
        <col style="width:44%"><col style="width:24%"><col style="width:24%"><col style="width:8%"></colgroup>
        <thead><tr><th>${kind === 'asset' ? 'Asset' : 'Debt'}</th><th>${kind === 'asset' ? 'Value' : 'Owed'}</th><th>Updated</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table>
    </div>`;
  };

  // History table, newest first, Δ vs the previous snapshot.
  let historyHtml = '';
  if (snaps.length) {
    let hrows = '';
    for (let i = snaps.length - 1; i >= 0; i--) {
      const s = snaps[i], p = snaps[i - 1];
      const d = p ? r2(s.aum - p.aum) : null;
      hrows += `<tr><td>${fmtShortDate(s.date)}</td><td>${money(s.assets)}</td><td>${money(s.debts)}</td>
        <td class="${moneyCls(s.aum)}">${money(s.aum)}</td>
        <td class="${d == null ? 'muted' : moneyCls(d)}">${d == null ? '—' : (d > 0.004 ? '+' : '') + money(d)}</td></tr>`;
    }
    historyHtml = `<table class="grid compact"><thead><tr>
      <th style="text-align:left">Date</th><th>Assets</th><th>Debts</th><th>AUM</th><th>Δ</th>
    </tr></thead><tbody>${hrows}</tbody></table>`;
  }

  // Change log rows, newest first.
  const logHtml = () => {
    if (!aum.log.length) return `<p class="muted" style="padding:12px 16px;margin:0">No changes logged yet.</p>`;
    const what = (e) => {
      if (e.action === 'add') return `added at ${money(e.to || 0)}`;
      if (e.action === 'remove') return `removed (was ${money(e.from || 0)})`;
      if (e.action === 'rename') return `renamed “${esc(e.from)}” → “${esc(e.to)}”`;
      return `${money(e.from || 0)} → ${money(e.to || 0)}`;
    };
    let rows = '';
    for (let i = aum.log.length - 1; i >= 0; i--) {
      const e = aum.log[i];
      rows += `<tr><td class="muted" style="white-space:nowrap">${fmtShortDate(e.date)}</td>
        <td>${e.kind === 'asset' ? 'Asset' : 'Debt'}</td><td style="text-align:left">${esc(e.name)}</td>
        <td style="text-align:left">${what(e)}</td></tr>`;
    }
    return `<table class="grid compact"><thead><tr>
      <th style="text-align:left">Date</th><th style="text-align:left">Type</th><th style="text-align:left">Name</th><th style="text-align:left">Change</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
  };

  main.innerHTML = `
    <h1>AUM <button class="help-btn" id="aumHelpBtn" title="How AUM works">?</button></h1>
    <p class="sub">Assets under management — everything you manage, minus everything you owe. Good managers know what they're managing: re-check the values now and then, and watch the line move.</p>
    <div class="month-head">
      <div class="hero ${t.aum >= -0.004 ? 'good' : 'bad'}">
        <div class="k">Assets under management</div>
        <div class="v">${money(t.aum)}</div>
        <div class="note">${deltaNote}assets ${money(t.assets)} − debts ${money(t.debts)}</div>
      </div>
      <div class="recap-stats month-stats">
        <div><span class="k">Assets</span><span class="v pos">${money(t.assets)}</span>
          <span class="muted" style="font-size:.75rem">${luAssets ? `last updated ${fmtShortDate(luAssets)}` : 'nothing tracked yet'}</span></div>
        <div><span class="k">Debts</span><span class="v">${money(t.debts)}</span>
          <span class="muted" style="font-size:.75rem">${luDebts ? `last updated ${fmtShortDate(luDebts)}` : 'nothing tracked yet'}</span></div>
      </div>
    </div>
    <div class="section">
      <div class="section-head"><h2>AUM over time</h2>
        <div class="actions"><button class="btn btn-sm" id="aumSnapBtn"
          title="Snapshots are recorded automatically whenever a value changes — this just marks today down deliberately.">Record snapshot</button></div></div>
      ${snaps.length >= 2
        ? `<div id="aumChart"></div>${historyHtml}`
        : `<p class="muted" style="padding:14px 16px;margin:0">${snaps.length === 0
            ? 'Add your assets and debts below — every edit records a snapshot, and the timeline appears once there are two days of history.'
            : 'One snapshot so far — the chart appears once a second day is recorded.'}</p>${historyHtml}`}
    </div>
    <div class="aum-grid">
      ${sectionHtml('asset', 'Assets', aum.assets)}
      ${sectionHtml('debt', 'Debts', aum.debts)}
    </div>
    <div class="section">
      <div class="section-head" id="aumLogToggle" style="cursor:pointer" title="Every add, edit, rename and removal, newest first (last 200 kept)">
        <h2><span class="acc-caret">${aumLogOpen ? '▾' : '▸'}</span> Change log <span class="muted" style="font-weight:400">· ${aum.log.length}</span></h2></div>
      ${aumLogOpen ? logHtml() : ''}
    </div>`;

  // Mount the chart: one AUM line, full snapshot in the tooltip.
  if (snaps.length >= 2) {
    $('#aumChart').appendChild(lineArea({
      color: VIZ.s1,
      points: snaps.map((s) => ({
        label: fmtShortDate(s.date),
        value: s.aum,
        tip: `<div>Assets: <b>${money(s.assets)}</b></div><div>Debts: <b>${money(s.debts)}</b></div><div>AUM: <b>${money(s.aum)}</b></div>`,
      })),
    }));
  }

  // First visit only — every dismissal sets the flag (see showAumWalkthrough).
  if (!data.settings.aumHelpSeen) showAumWalkthrough();

  // --- wire events ---
  main.onclick = (e) => {
    if (e.target.closest('#aumHelpBtn')) { showAumWalkthrough(); return; }
    const add = e.target.closest('[data-aum-add]');
    if (add) {
      const kind = add.dataset.aumAdd;
      const list = kind === 'asset' ? aum.assets : aum.debts;
      promptName(kind === 'asset' ? 'New asset' : 'New debt',
        kind === 'asset' ? 'e.g. House, 401(k), Car' : 'e.g. Mortgage, Car loan', (nm) => {
          if (list.some((x) => x.name.toLowerCase() === nm.toLowerCase())) return 'That name is already on the list.';
          const item = { id: newAumId(kind), name: nm, value: 0, updatedAt: todayISO() };
          list.push(item);
          aumMutate('add', kind, item, { to: 0 });
          toast(`"${nm}" added — click its value to set it.`);
        });
      return;
    }
    const ren = e.target.closest('[data-aum-name]');
    if (ren) {
      e.preventDefault();
      const found = findAumItem(ren.dataset.aumName);
      if (!found) return;
      const { item, kind, list } = found;
      promptName(`Rename ${kind}`, item.name, (nm) => {
        if (nm === item.name) return;
        if (list.some((x) => x !== item && x.name.toLowerCase() === nm.toLowerCase())) return 'That name is already on the list.';
        const old = item.name;
        item.name = nm;
        aumMutate('rename', kind, item, { from: old, to: nm });
      }, { okLabel: 'Rename', initial: item.name });
      return;
    }
    const del = e.target.closest('[data-aum-del]');
    if (del) {
      const found = findAumItem(del.dataset.aumDel);
      if (!found) return;
      const { item, kind, list } = found;
      if (!confirm(`Remove ${kind} "${item.name}" (${money(item.value)})? Past snapshots and the change log keep its history.`)) return;
      list.splice(list.indexOf(item), 1);
      aumMutate('remove', kind, item, { from: item.value });
      return;
    }
    if (e.target.closest('#aumSnapBtn')) {
      upsertSnapshot(aum, todayISO());
      markDirty(); render();
      toast('Snapshot recorded for today.');
      return;
    }
    if (e.target.closest('#aumLogToggle')) { aumLogOpen = !aumLogOpen; render(); }
  };
  main.onchange = (e) => {
    const el = e.target;
    if (!el.matches('[data-aum-item]')) return;
    const found = findAumItem(el.dataset.aumItem);
    if (!found) return;
    const { item, kind } = found;
    const v = parseMoney(el.value);
    if (isNaN(v)) { render(); return; }
    const nv = Math.abs(v); // both sides store positive numbers; AUM math subtracts
    if (Math.abs(nv - (item.value || 0)) < 0.005) { render(); return; }
    const from = item.value;
    item.value = nv;
    item.updatedAt = todayISO();
    aumMutate('update', kind, item, { from, to: nv });
  };
}

/* ---------------- Settings view ---------------- */
function renderSettings(main) {
  const month = curMonth();
  main.innerHTML = `
    <h1>Settings</h1><p class="sub"></p>
    <div class="settings-grid">
      <div class="section"><div class="section-head"><h2>Budget rules</h2></div>
        <div style="padding:12px 16px">
          <div class="field-row"><label>Tithe percentage</label>
            <input class="money small-num" id="tithePct" value="${Math.round((data.settings.tithePercent ?? 0.15) * 100)}"> %</div>
          <p class="muted" style="font-size:.85rem">Applied to funds with the "auto: % of income" rule.
            Base = checks × titheable-per-check for Standard Income (set on the Budget page), plus Extra Income planned. Tithe-exempt funds (like Transfer In) are excluded — set that per fund by clicking its name.</p>
          <div class="field-row"><label title="Fund-to-fund transfers stay visible inside each fund, but stop counting toward actual income and spending in the summary cards, Year Overview, and month recap.">Exclude transfers from income &amp; spending reporting</label>
            <input type="checkbox" id="exTransfers" ${data.settings.excludeTransfers ? 'checked' : ''}></div>
          <p class="muted" style="font-size:.85rem">Moving money between funds isn't real income or spending — this keeps the totals honest.</p>
        </div></div>
      <div class="section"><div class="section-head"><h2>Rename a fund</h2></div>
        <div style="padding:12px 16px">
          <div class="field-row"><select class="inline" id="renFund">${fundOptions(month, '')}</select>
            <input class="inline-text" id="renTo" placeholder="New name" style="border:1px solid var(--line);max-width:170px">
            <button class="btn btn-sm" id="renBtn">Rename</button></div>
          <p class="muted" style="font-size:.85rem">Renames the fund in <b>every month</b> and updates all its transactions.</p>
        </div></div>
      <div class="section"><div class="section-head"><h2>Categories</h2></div>
        <div style="padding:12px 16px">
          <div class="field-row"><input class="inline-text" id="newCat" placeholder="New category name" style="border:1px solid var(--line)">
            <button class="btn btn-sm" id="addCatBtn">Add to ${monthLabel(month.id)}</button></div>
          <p class="muted" style="font-size:.85rem">New categories start empty — add funds from the Budget page. They roll into future months automatically.
            To remove a category, empty its funds and click the ✕ on its header on the Budget page; past months are never affected.</p>
        </div></div>
      ${(data.settings.lastRetype || []).length ? `
      <div class="section"><div class="section-head"><h2>Fund types adjusted</h2></div>
        <div style="padding:12px 16px">
          <p class="muted" style="font-size:.85rem;margin-top:0">These funds were set to <b>Pacing</b> automatically when your
            spreadsheet was imported, but their spending arrives as one or two charges a month rather than spread across it —
            so they were reading as “off pace” the moment they posted. They're now <b>Basic</b>. Change any of them back by
            clicking the fund name on the Budget page.</p>
          <table class="grid compact"><tbody>
            ${data.settings.lastRetype.map((r) => `<tr><td>${esc(r.fund)}</td><td class="muted">${esc(r.category)}</td>
              <td>${r.daysPerMonth} spending day${r.daysPerMonth === 1 ? '' : 's'} a month</td></tr>`).join('')}
          </tbody></table>
          <div class="field-row" style="margin-top:10px"><label></label><button class="btn btn-sm" id="dismissRetype">Got it</button></div>
        </div></div>` : ''}
      <div class="section"><div class="section-head"><h2>Data</h2></div>
        <div style="padding:12px 16px">
          <div class="field-row"><label>Your data file (auto-saved, with rolling backups)</label>
            <button class="btn btn-sm" id="revealBtn">Show in folder</button></div>
          <div class="field-row"><label>Export a copy of all data</label>
            <button class="btn btn-sm" id="exportBtn">Export JSON…</button></div>
        </div></div>
    </div>`;

  $('#exTransfers').onchange = (e) => {
    data.settings.excludeTransfers = e.target.checked;
    markDirty();
    toast(e.target.checked
      ? 'Transfers are now excluded from income & spending reporting.'
      : 'Transfers count in income & spending reporting again.');
  };
  $('#tithePct').onchange = (e) => {
    const v = parseFloat(e.target.value);
    if (!isNaN(v) && v >= 0 && v <= 100) {
      data.settings.tithePercent = r2(v / 100);
      // Only the selected month and later get the new percent. Earlier months keep
      // their own rule.percent, so their numbers can never move — not even if they
      // are edited later (a recalc there uses the percent stored on their rule).
      for (const m of data.months) {
        if (m.id < currentMonthId) continue;
        let touched = false;
        for (const c of m.categories) for (const f of c.funds) {
          if (f.rule?.type === 'tithe') { f.rule.percent = data.settings.tithePercent; touched = true; }
        }
        if (touched) applyTitheRules(m, data.settings.tithePercent);
      }
      markDirty();
      toast(`Tithe set to ${v}% from ${monthLabel(currentMonthId)} forward — earlier months unchanged.`);
    }
    renderSettings(main);
  };
  $('#renBtn').onclick = () => {
    const from = $('#renFund').value, to = $('#renTo').value.trim();
    if (!from || !to) return toast('Pick a fund and type a new name.');
    for (const m of data.months) {
      if (canonicalFund(m, to) && normFund(to) !== normFund(from)) return toast(`"${to}" already exists in ${monthLabel(m.id)}.`);
    }
    let nStruct = 0, nTx = 0;
    for (const m of data.months) {
      for (const f of m.income) if (normFund(f.fund) === normFund(from)) { f.fund = to; nStruct++; }
      for (const c of m.categories) for (const f of c.funds) if (normFund(f.fund) === normFund(from)) { f.fund = to; nStruct++; }
      for (const t of m.transactions) if (normFund(t.fund) === normFund(from)) { t.fund = to; nTx++; }
      if (m.checks && m.checks[from]) { m.checks[to] = m.checks[from]; delete m.checks[from]; }
    }
    markDirty(); toast(`Renamed in ${nStruct} month table(s) and ${nTx} transaction(s).`);
    renderSettings(main);
  };
  $('#addCatBtn').onclick = () => {
    const name = $('#newCat').value.trim();
    if (!name) return;
    if (month.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) return toast('That category already exists.');
    month.categories.push({ name, excludeFromTotals: false, funds: [] });
    markDirty(); toast(`Added "${name}" to ${monthLabel(month.id)}.`);
    view = 'budget'; render();
  };
  const dr = $('#dismissRetype');
  if (dr) dr.onclick = () => { delete data.settings.lastRetype; markDirty(); renderSettings(main); };
  $('#revealBtn').onclick = () => window.budgetAPI.revealData();
  $('#exportBtn').onclick = async () => { if (await window.budgetAPI.exportData(data)) toast('Exported.'); };
}

/* ---------------- New month ---------------- */
function createNextMonth(last) {
  const next = buildNextMonth(last, data.settings.tithePercent ?? 0.15);
  data.months.push(next);
  currentMonthId = next.id;
  view = 'budget'; flagPanel = null;
  markDirty(); render();
  toast(`${monthLabel(next.id)} created — review planned amounts.`);
}

// End-of-month workflow: a short recap of the closing month (stats, pacing wins,
// savings progress), a pass over the outstanding insights with inline transfers,
// then month creation. Fully skippable.
function startNextMonth() {
  const last = data.months[data.months.length - 1];
  const nid = (() => { const [y, m] = last.id.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; })();
  showMonthCloseWorkflow(last, nid);
}

function showMonthCloseWorkflow(last, nid) {
  const comp = computeMonth(last);
  const s = comp.summary;
  const flags = fundFlags(last, comp, todayISO());
  const attList = flags.filter((x) => x.attention);
  const offList = flags.filter((x) => x.offset);

  // Category breakdown (planned vs spent), skipping empty ones.
  const catRows = comp.categories
    .filter((c) => !c.excludeFromTotals)
    .map((c) => ({ name: c.name, planned: r2(c.totals.carryOver + c.totals.planned), spent: catSpentAbs(c) }))
    .filter((c) => c.planned > 0.004 || c.spent > 0.004);
  const catsUnder = catRows.filter((c) => c.spent <= c.planned + 0.004).length;

  // Pacing wins: of the pacing funds that saw activity, which finished at-or-under budget.
  const pacingAll = [], pacingWins = [];
  for (const c of comp.categories) {
    if (c.excludeFromTotals) continue;
    for (const f of c.funds) {
      if ((f.setup?.type) !== 'pacing' || f.expensed >= -0.004) continue;
      pacingAll.push(f);
      if (f.leftover >= -0.004) pacingWins.push(f);
    }
  }
  // Savings goals that matured this month.
  const matured = [];
  for (const c of comp.categories) {
    for (const f of c.funds) {
      if (f.setup?.type === 'savings' && f.setup.targetMonth === last.id) matured.push(f);
    }
  }

  const wins = [];
  if (pacingWins.length && pacingAll.length) {
    const saved = r2(pacingWins.reduce((a, f) => a + Math.max(0, f.leftover), 0));
    wins.push(`🏆 ${pacingWins.length} of ${pacingAll.length} pacing fund${pacingAll.length > 1 ? 's' : ''} finished on pace${saved > 0.004 ? ` — ${money(saved)} unspent` : ''}: ${pacingWins.map((f) => esc(f.fund)).join(', ')}`);
  }
  if (catsUnder && catRows.length) wins.push(`✅ ${catsUnder} of ${catRows.length} categories came in at or under plan`);
  if (actDiff(comp) > 0.004) wins.push(`📈 You ended ${money(actDiff(comp))} ahead — income beat spending`);
  for (const f of matured) {
    const set = r2(f.carryOver + f.planned);
    wins.push(set >= f.setup.targetAmount - 0.004
      ? `🎯 "${esc(f.fund)}" hit its ${money(f.setup.targetAmount)} goal — enjoy it!`
      : `🎯 "${esc(f.fund)}" matured with ${money(set)} of ${money(f.setup.targetAmount)} saved`);
  }
  if (!wins.length) wins.push('📒 The month is logged and every dollar is accounted for — that\'s the win.');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const li = (x, why) => `<li><b>${esc(x.fund)}</b> <span class="muted">(${esc(x.category)})</span> — ${why}</li>`;
  overlay.innerHTML = `
    <div class="modal modal-wide">
      <h2>${monthLabel(last.id)} in review</h2>
      <div class="recap-stats">
        <div><span class="k">Income${exT() ? ' *' : ''}</span><span class="v pos">${money(actIncome(comp))}</span></div>
        <div><span class="k">Spent${exT() ? ' *' : ''}</span><span class="v">${money(Math.abs(actExpense(comp)))}</span></div>
        <div><span class="k">Net</span><span class="v ${actDiff(comp) >= 0 ? 'pos' : 'neg'}">${money(actDiff(comp))}</span></div>
      </div>
      ${exT() ? '<p class="muted" style="font-size:.78rem;margin:-8px 0 10px">* fund-to-fund transfers excluded</p>' : ''}
      <ul class="modal-list recap-wins">${wins.map((w) => `<li>${w}</li>`).join('')}</ul>
      <details class="recap-cats"><summary>Category breakdown</summary>
        <table class="grid compact"><thead><tr><th style="text-align:left">Category</th><th>Budget</th><th>Spent</th><th>Left</th></tr></thead><tbody>
        ${catRows.map((c) => `<tr><td>${esc(c.name)}</td><td>${money(c.planned)}</td><td>${money(c.spent)}</td>
          <td class="${moneyCls(r2(c.planned - c.spent))}">${money(r2(c.planned - c.spent))}</td></tr>`).join('')}
        </tbody></table></details>
      ${attList.length ? `<p style="margin:10px 0 4px"><b>⚠ Needs attention (${attList.length})</b></p><ul class="modal-list">
        ${attList.map((x) => li(x, x.attention === 'exceeded' ? `over by <span class="neg">${money(-x.leftover)}</span>` : 'off pace')).join('')}</ul>` : ''}
      ${offList.length ? `<p style="margin:10px 0 4px"><b>💡 Available to move (${offList.length})</b></p><ul class="modal-list">
        ${offList.map((x, i) => li(x, `<span class="pos">${money(x.leftover)}</span> free — <a href="#" data-wf-xfer="${esc(x.fund)}">transfer it</a>`)).join('')}</ul>` : ''}
      <div class="modal-actions">
        <button class="btn" id="wfCancel">Cancel</button>
        <button class="btn btn-accent" id="wfGo">${attList.length || offList.length ? `Start ${monthLabel(nid)} anyway` : `Start ${monthLabel(nid)}`}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { close(); return; }
    const x = e.target.closest('[data-wf-xfer]');
    if (x) {
      e.preventDefault();
      const from = x.dataset.wfXfer;
      currentMonthId = last.id;
      close();
      showTransferModal(from, () => showMonthCloseWorkflow(last, nid));
    }
  });
  $('#wfCancel', overlay).onclick = close;
  $('#wfGo', overlay).onclick = () => { close(); createNextMonth(last); };
}

/* ---------------- Onboarding wizard ----------------
 * First-run setup for a blank install (data.months is empty). Full-screen
 * stepper that owns #main with the sidebar hidden — this is data entry with
 * branching, not a tour, so it isn't the walkthrough modal. Everything lives
 * in a local state object until Finish: no markDirty()/saveData before the
 * final step, so quitting mid-wizard leaves no data file and the wizard runs
 * again next launch. It has its own paint loop — render() must not run while
 * it owns the screen (renderShell reads #monthSelect etc. against months).
 */

// The curated starter set (Step 5). Keys line up with starterFundFor /
// suggestStarterFunds in csv.js so bank-file suggestions land on these rows.
const STARTER_FUNDS = [
  { key: 'rent', name: 'Rent or Mortgage', cat: 'bills', type: 'basic', checked: true },
  { key: 'electricity', name: 'Electricity', cat: 'bills', type: 'basic', checked: true },
  { key: 'water', name: 'Water', cat: 'bills', type: 'basic', checked: true },
  { key: 'internet', name: 'Internet', cat: 'bills', type: 'basic', checked: true },
  { key: 'cellPhone', name: 'Cell Phone', cat: 'bills', type: 'basic', checked: true },
  { key: 'subscriptions', name: 'Subscriptions', cat: 'bills', type: 'basic', checked: true,
    note: 'Netflix, Spotify, all of it — one envelope is plenty to start' },
  { key: 'carInsurance', name: 'Car Insurance', cat: 'bills', type: 'basic', checked: false, cadence: true },
  { key: 'groceries', name: 'Groceries', cat: 'everyday', type: 'pacing', checked: true },
  { key: 'gas', name: 'Gas', cat: 'everyday', type: 'pacing', checked: true },
  { key: 'eatingOut', name: 'Eating Out', cat: 'everyday', type: 'pacing', checked: true },
  { key: 'funMoney', name: 'Fun Money', cat: 'everyday', type: 'pacing', checked: true },
  { key: 'everythingElse', name: 'Everything Else', cat: 'everyday', type: 'basic', checked: true,
    note: 'for the stuff that fits nowhere else' },
  { key: 'safetyNet', name: 'Safety Net', cat: 'saving', type: 'build', checked: true,
    note: 'A cushion for the month something breaks. Even $25 a month counts.' },
  { key: 'christmas', name: 'Christmas', cat: 'saving', type: 'target', checked: false,
    note: 'Spread the cost across the year.' },
  { key: 'vacation', name: 'Vacation', cat: 'saving', type: 'target', checked: false },
];

const WZ_GROUPS = [
  { cat: 'bills', title: 'Bills', desc: 'Regular bills, roughly the same each month.' },
  { cat: 'everyday', title: 'Everyday spending', desc: "Week-to-week spending — the app tells you if you're going through it too fast." },
  { cat: 'saving', title: 'Saving up', desc: "Money you're setting aside on purpose." },
];

// The coming December — for the Christmas fund's target month.
function comingDecember() {
  const [y, m] = todayISO().slice(0, 7).split('-').map(Number);
  return `${m === 12 ? y + 1 : y}-12`;
}

let wizard = null;

function renderOnboarding() {
  wizard = {
    step: 0,
    files: [],    // parsed OK: { name, records, report, answers }
    pending: null, // a file mid-flight: { name, fileData, answers, refusal?, report? }
    sources: [{ name: 'My paychecks', variable: false, count: 2, amount: null }],
    givingChoice: null, // 'yes' | 'no'
    givingPct: 10,
    funds: {},    // key → { checked, amount, userChecked, userSet, fromCsv, everyMonths, targetMonth }
    suggest: null, // suggestStarterFunds() over every parsed record
    error: '',
  };
  for (const sf of STARTER_FUNDS) {
    wizard.funds[sf.key] = { checked: !!sf.checked, amount: null, everyMonths: 1 };
    if (sf.key === 'christmas') wizard.funds[sf.key].targetMonth = comingDecember();
    if (sf.key === 'vacation') wizard.funds[sf.key].targetMonth = defaultTargetMonth(todayISO().slice(0, 7));
  }
  $('#sidebar').style.display = 'none';
  paintWizard();
}

/* ---- step bodies ---- */

function wzWelcomeHtml() {
  return `
    <h1>Let's set up your budget.</h1>
    <p class="wz-body">This takes about five minutes, and you can change everything later.</p>
    <p class="wz-body">The idea is simple: split your money into envelopes — one for groceries,
      one for rent, one for fun — so every dollar has a job. Here we call them <b>funds</b>.</p>
    <div class="wz-actions"><button class="btn btn-accent" data-wz-next>Let's go</button></div>`;
}

function wzCsvHtml() {
  const p = wizard.pending;
  let html = `
    <h1>Want a head start?</h1>
    <p class="wz-body">If you can download a file of your recent transactions from your bank's website
      (usually called "Export" or "Download CSV" — grab the last 90 days, or whatever you have),
      the app can use it to suggest envelopes and typical amounts for you.</p>
    <p class="wz-body">No internet involved — the file never leaves your computer.</p>`;

  // Files already read: one summary line each, straight from the report.
  for (const f of wizard.files) {
    html += `<div class="wz-file">✓ <b>${esc(f.name)}</b> — found ${f.report.counts.rows} transaction${f.report.counts.rows === 1 ? '' : 's'}
      from ${fmtDateRange(f.report.totals.dateMin, f.report.totals.dateMax)}</div>`;
  }

  if (p && p.refusal) {
    // The importer's refusal text verbatim — it's already plain-language and
    // names unsupported formats. One wizard-added line follows it.
    html += `<div class="section import-refusal">
      <b>${esc(p.name)}</b> couldn't be read.
      <p>${esc(p.refusal)}</p>
      <p>No problem — skip this step and set up by hand; you can try a different file later from the Import tab.</p>
    </div>`;
  } else if (p && p.report?.questions?.length) {
    html += csvQuestionsHtml(p.report.questions);
  }

  const haveFiles = wizard.files.length > 0;
  html += `<div class="wz-actions">
    <button class="btn ${haveFiles ? '' : 'btn-accent'}" data-wz-pick>${haveFiles ? 'Add another file…' : 'Choose file…'}</button>
    ${haveFiles ? `<span class="muted" style="font-size:.82rem">checking + credit card files work well together — deposits live in one, categories in the other</span>` : ''}
    <div class="spacer"></div>
    ${haveFiles
      ? `<button class="btn btn-accent" data-wz-next>Continue</button>`
      : `<button class="btn" data-wz-next>Skip — I'll start from scratch</button>`}
  </div>
  ${p && p.report?.questions?.length ? `<p class="muted" style="margin-top:8px;font-size:.85rem">Can't answer? That's fine — skipping this step is always OK.</p>` : ''}`;
  return html;
}

function wzIncomeHtml() {
  const det = wizard.suggest?.paycheck;
  let html = `<h1>How do you get paid?</h1>
    <p class="wz-body">One paycheck at a time — you can add a second earner below.</p>`;
  wizard.sources.forEach((src, i) => {
    const cadence = det && src.detected
      ? (det.perMonth === 2 ? 'every two weeks' : `${det.perMonth} time${det.perMonth === 1 ? '' : 's'} a month`)
      : '';
    html += `<div class="wz-card">
      ${wizard.sources.length > 1 ? `<button class="btn-ghost wz-remove" data-wz-del-src="${i}" title="Remove this paycheck">✕</button>` : ''}
      <div class="modal-row"><label class="wz-label">Whose paycheck is this?</label>
        <input class="search" style="flex:1" data-wz-src="${i}" data-k="name" value="${esc(src.name)}" placeholder="e.g. Sam's paychecks" maxlength="60"></div>
      <div class="modal-row" style="align-items:flex-start"><label class="wz-label">Is it the same amount every time?</label>
        <div class="wz-radio-col">
          <label><input type="radio" name="wzVar-${i}" value="no" data-wz-src="${i}" data-k="variable" ${src.variable ? '' : 'checked'}> Yes — same every check</label>
          <label><input type="radio" name="wzVar-${i}" value="yes" data-wz-src="${i}" data-k="variable" ${src.variable ? 'checked' : ''}> No — it changes (hourly, tips, overtime)</label>
          ${src.variable ? `<span class="fund-note">Give your best guess for a typical check — the app will help you adjust as real checks come in.</span>` : ''}
        </div></div>
      <div class="modal-row"><label class="wz-label">How many checks a month?</label>
        <input class="search small-num" style="flex:none" data-wz-src="${i}" data-k="count" value="${src.count}" inputmode="numeric"></div>
      <p class="fund-note" style="margin:-4px 0 8px">Paid every two weeks? Use 2 — a couple months a year you'll get a happy
        third check, and you can bump this number in those months.</p>
      <div class="modal-row"><label class="wz-label">How much is one check, after taxes?</label>
        <input class="search" style="width:130px;flex:none" data-wz-src="${i}" data-k="amount" value="${src.amount != null ? money(src.amount) : ''}" placeholder="$0.00" inputmode="decimal"></div>
      ${src.detected && det ? `<p class="fund-note" style="margin:-4px 0 0">Looks like about ${money(det.amount)} lands ${cadence} — sound right?</p>` : ''}
    </div>`;
  });
  html += `<button class="btn btn-sm" data-wz-add-src>+ Add another paycheck</button>
    ${wizard.error ? `<div class="modal-err">${esc(wizard.error)}</div>` : ''}
    <div class="wz-actions">
      <button class="btn" data-wz-back>Back</button>
      <div class="spacer"></div>
      <button class="btn btn-accent" data-wz-next>Next</button>
    </div>`;
  return html;
}

function wzGivingHtml() {
  const c = wizard.givingChoice;
  return `<h1>Do you give regularly?</h1>
    <p class="wz-body">Some people set aside a share of what they earn for church or charity — often
      called a tithe. If that's you, the app can work out the amount automatically from your paychecks.</p>
    <div class="wz-radio-col wz-card">
      <label><input type="radio" name="wzGiving" value="yes" ${c === 'yes' ? 'checked' : ''}> Yes, I give a share of what I earn</label>
      ${c === 'yes' ? `<div class="modal-row" style="margin:6px 0 0 24px"><label style="width:auto">What share?</label>
        <input class="search small-num" style="flex:none" id="wzPct" value="${wizard.givingPct}" inputmode="numeric"> <span class="muted">%</span></div>
      <span class="fund-note" style="margin-left:24px">We'll base this on your take-home checks to start. If you give based on
        your pay before taxes, you can set that number later — it's on the setup checklist.</span>` : ''}
      <label><input type="radio" name="wzGiving" value="no" ${c === 'no' ? 'checked' : ''}> Not right now</label>
    </div>
    ${wizard.error ? `<div class="modal-err">${esc(wizard.error)}</div>` : ''}
    <div class="wz-actions">
      <button class="btn" data-wz-back>Back</button>
      <div class="spacer"></div>
      <button class="btn btn-accent" data-wz-next>Next</button>
    </div>`;
}

function wzFundsHtml() {
  let html = `<h1>Pick your envelopes</h1>
    <p class="wz-body">Check the ones that fit your life. Amounts are optional — you can fill them in
      later; it's on the checklist.</p>`;
  for (const g of WZ_GROUPS) {
    html += `<div class="wz-group"><div class="wz-group-head"><b>${g.title}</b> <span class="muted">— ${g.desc}</span></div>`;
    for (const sf of STARTER_FUNDS.filter((s) => s.cat === g.cat)) {
      const st = wizard.funds[sf.key];
      html += `<div class="wz-fund-row ${st.checked ? '' : 'off'}">
        <label class="wz-fund-main"><input type="checkbox" data-wz-fund="${sf.key}" ${st.checked ? 'checked' : ''}>
          <span class="wz-fund-name">${sf.name}</span>
          ${st.fromCsv ? '<span class="rule-chip">from your bank file</span>' : ''}
        </label>
        ${st.checked ? `<input class="search wz-amt" data-wz-amt="${sf.key}" value="${st.amount != null ? money(st.amount) : ''}"
          placeholder="$ / month" inputmode="decimal" title="${sf.type === 'target' ? 'The total to save up' : 'How much to set aside each month'}">` : ''}
      </div>`;
      if (sf.note || (st.checked && (sf.cadence || sf.type === 'target'))) {
        html += `<div class="wz-fund-sub">`;
        if (sf.note) html += `<span class="fund-note">${sf.note}</span>`;
        if (st.checked && sf.cadence) {
          html += `<div class="modal-row" style="margin:4px 0 0"><label style="width:auto" class="muted">Do you pay this monthly, or every few months?</label>
            <select class="inline" data-wz-cadence="${sf.key}">
              <option value="1" ${st.everyMonths === 1 ? 'selected' : ''}>Every month</option>
              <option value="3" ${st.everyMonths === 3 ? 'selected' : ''}>Every 3 months</option>
              <option value="6" ${st.everyMonths === 6 ? 'selected' : ''}>Every 6 months</option>
              <option value="12" ${st.everyMonths === 12 ? 'selected' : ''}>Once a year</option>
            </select></div>`;
          if (st.everyMonths > 1) {
            html += `<span class="fund-note">Enter the whole bill above — the app sets aside a slice every month so the big bill never surprises you.</span>`;
          }
        }
        if (st.checked && sf.type === 'target') {
          html += `<div class="modal-row" style="margin:4px 0 0"><label style="width:auto" class="muted">saved up by</label>
            ${sf.key === 'christmas'
              ? `<b>${ymLabel(st.targetMonth)}</b>`
              : `<input type="month" class="search" style="flex:none" data-wz-tmonth="${sf.key}" value="${st.targetMonth}" min="${todayISO().slice(0, 7)}">`}
          </div>`;
        }
        html += `</div>`;
      }
    }
    html += `</div>`;
  }
  html += `<p class="muted" style="font-size:.85rem">Envelopes aren't set in stone — add, rename, or remove any of them later on the Budget page.</p>
    <div class="wz-actions">
      <button class="btn" data-wz-back>Back</button>
      <div class="spacer"></div>
      <button class="btn btn-accent" data-wz-next>Next</button>
    </div>`;
  return html;
}

// Current-month rows the wizard will bring in (older rows inform averages
// only — creating past months to hold them would start every fund in a hole).
function wzImportableRecords() {
  const nowMonth = todayISO().slice(0, 7);
  const out = [];
  for (const f of wizard.files) {
    for (const rec of f.records) {
      if (rec.date.slice(0, 7) === nowMonth && !rec.isCardPayment) {
        out.push({ rec, idTrusted: !!f.report?.externalIdTrusted });
      }
    }
  }
  return out;
}

function wzFinishHtml() {
  // Everything Else is kept even when nothing is checked (wzFinish) — never
  // promise fewer envelopes than the month will actually have.
  const nFunds = Math.max(1, STARTER_FUNDS.filter((sf) => wizard.funds[sf.key].checked).length)
    + (wizard.givingChoice === 'yes' ? 1 : 0);
  const nTx = wzImportableRecords().length;
  const nPay = wizard.sources.length;
  return `<h1>That's your foundation.</h1>
    <p class="wz-body">Your budget: <b>${nPay} paycheck${nPay === 1 ? '' : 's'}</b>, <b>${nFunds} envelope${nFunds === 1 ? '' : 's'}</b>${
      nTx ? `, <b>${nTx} transaction${nTx === 1 ? '' : 's'}</b> to bring in` : ''}.</p>
    <p class="wz-body">The numbers don't need to be perfect — you'll sharpen them as real life happens.
      The list on the next screen shows the few blanks worth filling in.</p>
    <div class="wz-actions">
      <button class="btn" data-wz-back>Back</button>
      <div class="spacer"></div>
      <button class="btn btn-accent" data-wz-finish>Finish setup</button>
    </div>`;
}

/* ---- paint + wire ---- */

const WZ_STEPS = [wzWelcomeHtml, wzCsvHtml, wzIncomeHtml, wzGivingHtml, wzFundsHtml, wzFinishHtml];

function paintWizard() {
  const main = $('#main');
  main.onclick = null; main.onchange = null;
  main.innerHTML = `<div class="wizard">
    <div class="wz-dots">${WZ_STEPS.map((_, i) =>
      `<span class="wz-dot ${i === wizard.step ? 'on' : i < wizard.step ? 'done' : ''}"></span>`).join('')}</div>
    ${WZ_STEPS[wizard.step]()}
  </div>`;
  main.scrollTop = 0;
  wireWizard(main);
}

function wzReadSources(main) {
  // Pull every visible income field into state before validating/navigating.
  main.querySelectorAll('[data-wz-src]').forEach((el) => {
    const src = wizard.sources[Number(el.dataset.wzSrc)];
    if (!src) return;
    const k = el.dataset.k;
    if (k === 'name') src.name = el.value.trim();
    else if (k === 'count') { const n = parseInt(el.value, 10); if (!isNaN(n)) src.count = n; }
    else if (k === 'amount') {
      const v = parseMoney(el.value);
      if (el.value.trim() === '') src.amount = null;
      else if (!isNaN(v)) { src.amount = Math.abs(v); src.userSet = true; }
    } else if (k === 'variable' && el.checked) src.variable = el.value === 'yes';
  });
}

function wireWizard(main) {
  wizard.error = '';
  main.onclick = async (e) => {
    if (e.target.closest('[data-wz-back]')) { wizard.step = Math.max(0, wizard.step - 1); paintWizard(); return; }
    if (e.target.closest('[data-wz-next]')) {
      if (wizard.step === 2) {
        wzReadSources(main);
        // Names must exist and not collide — they become fund names.
        const names = wizard.sources.map((s) => normFund(s.name));
        if (names.some((n) => !n)) { wizard.error = 'Give each paycheck a name.'; paintWizard(); return; }
        if (new Set(names).size !== names.length) { wizard.error = 'Two paychecks have the same name — make them different.'; paintWizard(); return; }
        if (names.some((n) => n === 'other income')) { wizard.error = '"Other Income" is reserved — pick another name.'; paintWizard(); return; }
        if (wizard.sources.some((s) => !(s.count >= 1))) { wizard.error = 'Checks a month needs to be at least 1.'; paintWizard(); return; }
      }
      if (wizard.step === 3) {
        if (!wizard.givingChoice) { wizard.error = 'Pick one — you can change it any time in Settings.'; paintWizard(); return; }
      }
      wizard.step = Math.min(WZ_STEPS.length - 1, wizard.step + 1);
      wizard.pending = null; // an unanswered file question dies with the step
      paintWizard();
      return;
    }
    if (e.target.closest('[data-wz-pick]')) {
      const file = await window.budgetAPI.openCsv();
      if (!file) return;
      wzParseFile(file.path.split(/[\\/]/).pop(), file.bytes ?? file.text, {});
      return;
    }
    if (e.target.closest('[data-wz-add-src]')) {
      wzReadSources(main);
      wizard.sources.push({ name: '', variable: false, count: 2, amount: null });
      paintWizard();
      return;
    }
    const del = e.target.closest('[data-wz-del-src]');
    if (del) {
      wzReadSources(main);
      wizard.sources.splice(Number(del.dataset.wzDelSrc), 1);
      paintWizard();
      return;
    }
    if (e.target.closest('[data-wz-finish]')) { wzFinish(); return; }
  };

  main.onchange = (e) => {
    const el = e.target;
    if (el.matches('[data-wz-src]')) {
      wzReadSources(main);
      if (el.dataset.k === 'variable') paintWizard(); // helper text appears/disappears
      return;
    }
    if (el.matches('input[name="wzGiving"]')) { wizard.givingChoice = el.value; paintWizard(); return; }
    if (el.id === 'wzPct') {
      const v = parseFloat(el.value);
      if (!isNaN(v) && v > 0 && v <= 100) wizard.givingPct = v;
      return;
    }
    if (el.matches('[data-wz-fund]')) {
      const st = wizard.funds[el.dataset.wzFund];
      st.checked = el.checked;
      st.userChecked = true;
      paintWizard();
      return;
    }
    if (el.matches('[data-wz-amt]')) {
      const st = wizard.funds[el.dataset.wzAmt];
      const v = parseMoney(el.value);
      if (el.value.trim() === '') { st.amount = null; st.userSet = true; }
      else if (!isNaN(v)) { st.amount = Math.abs(v); st.userSet = true; }
      return;
    }
    if (el.matches('[data-wz-cadence]')) {
      wizard.funds[el.dataset.wzCadence].everyMonths = parseInt(el.value, 10) || 1;
      paintWizard();
      return;
    }
    if (el.matches('[data-wz-tmonth]')) {
      const st = wizard.funds[el.dataset.wzTmonth];
      if (el.value && el.value >= todayISO().slice(0, 7)) st.targetMonth = el.value;
      return;
    }
  };

  // Blocking questions from the importer — shared rendering with the Import
  // view; answers re-run the parse. Skip stays available throughout.
  if (wizard.step === 1 && wizard.pending?.report?.questions?.length) {
    const p = wizard.pending;
    wireCsvQuestions(main, p.report.questions, p.answers,
      (answers) => wzParseFile(p.name, p.fileData, answers));
  }
}

async function wzParseFile(name, fileData, answers) {
  let store = null;
  try { store = await window.budgetAPI.loadBankProfiles(); } catch { /* first run / dev */ }
  let result;
  try { result = parseBankFile(fileData, { answers, profiles: store?.profiles || [] }); }
  catch (err) { result = { error: err.message }; }
  if (result.error) {
    wizard.pending = { name, fileData, answers, refusal: result.error };
  } else if (result.report.questions.length) {
    wizard.pending = { name, fileData, answers, report: result.report };
  } else if (!result.records.length) {
    wizard.pending = { name, fileData, answers, refusal: 'No transactions were found in that file.' };
  } else {
    wizard.pending = null;
    wizard.files.push({ name, records: result.records, report: result.report, answers });
    wzApplySuggestions();
  }
  paintWizard();
}

// Fold the parsed files into pre-checked envelopes with suggested amounts and
// a paycheck pre-fill. Suggestions never overwrite something the user already
// touched, and every computed number is a suggestion the user confirms.
function wzApplySuggestions() {
  const all = wizard.files.flatMap((f) => f.records);
  wizard.suggest = suggestStarterFunds(all);
  for (const s of wizard.suggest.suggestions) {
    const st = wizard.funds[s.starterKey];
    if (!st) continue;
    st.fromCsv = true;
    if (!st.userChecked) st.checked = true;
    if (!st.userSet) st.amount = s.monthlyAmount;
  }
  const p = wizard.suggest.paycheck;
  const src = wizard.sources[0];
  if (p && src && !src.userSet) {
    src.amount = p.amount;
    src.count = p.perMonth;
    src.detected = true;
  }
}

async function wzFinish() {
  const s = data.settings;
  const id = todayISO().slice(0, 7);
  const month = {
    id, label: MONTH_NAMES[Number(id.split('-')[1]) - 1],
    checks: {}, income: [], categories: [], transactions: [],
  };

  // Income: one Standard fund per paycheck source. planned stays 0 here —
  // NEVER hand-set it on a checks-rule fund; applyChecksRules computes it from
  // count × amount below (writing planned directly clears the rule).
  for (const src of wizard.sources) {
    month.income.push({
      fund: src.name, carryOver: 0, planned: 0, rule: { type: 'checks' },
      titheExempt: false, carryForward: false, group: 'standard',
    });
    const chk = { count: src.count || 0, amount: src.amount || 0, titheAmount: src.amount || 0 };
    if (src.variable) chk.variable = true;
    month.checks[src.name] = chk;
  }
  // Gifts and bonuses always have a home.
  month.income.push({
    fund: 'Other Income', carryOver: 0, planned: 0, rule: null,
    titheExempt: false, carryForward: false, group: 'bonus',
  });

  const giving = wizard.givingChoice === 'yes';
  if (giving) {
    s.tithePercent = r2((wizard.givingPct || 10) / 100);
    month.categories.push({
      name: 'Giving', excludeFromTotals: false,
      funds: [{
        fund: 'Tithe', carryOver: 0, planned: 0,
        rule: { type: 'tithe', percent: s.tithePercent },
        yearlyCharge: null, setup: blankSetup(),
      }],
    });
  }

  // Expense envelopes from the starter set. If literally everything was
  // unchecked, keep Everything Else so the month isn't structurally empty.
  const picked = STARTER_FUNDS.filter((sf) => wizard.funds[sf.key].checked);
  if (!picked.length) {
    wizard.funds.everythingElse.checked = true;
    picked.push(STARTER_FUNDS.find((sf) => sf.key === 'everythingElse'));
  }
  const fundNameByKey = {};
  const byCat = { bills: [], everyday: [], saving: [] };
  for (const sf of picked) {
    const st = wizard.funds[sf.key];
    const setup = blankSetup();
    if (sf.cadence && st.everyMonths > 1) {
      setup.type = 'fixed'; setup.everyMonths = st.everyMonths; setup.totalAmount = st.amount || 0;
    } else if (sf.type === 'pacing') setup.type = 'pacing';
    else if (sf.type === 'build') {
      setup.type = 'savings'; setup.savingsMode = 'build'; setup.monthlyAmount = st.amount || 0;
    } else if (sf.type === 'target') {
      setup.type = 'savings'; setup.savingsMode = 'target';
      setup.targetAmount = st.amount || 0; setup.targetMonth = st.targetMonth;
    }
    const fund = { fund: sf.name, carryOver: 0, planned: st.amount || 0, rule: null, yearlyCharge: null, setup };
    const auto = autoPlanned(fund, id);
    if (auto != null) fund.planned = auto; // fixed/savings compute their own slice
    byCat[sf.cat].push(fund);
    fundNameByKey[sf.key] = sf.name;
  }
  for (const g of WZ_GROUPS) {
    if (byCat[g.cat].length) {
      month.categories.push({ name: g.title, excludeFromTotals: false, funds: byCat[g.cat] });
    }
  }

  // Rules, in this order — the tithe base reads the checks.
  applyChecksRules(month);
  applyTitheRules(month, s.tithePercent ?? 0.10);

  // Bring in the current month's rows. The same table that suggested the
  // envelopes maps each row to its fund; unmapped rows import with fund: ''
  // and surface in the existing "unassigned" flow, which the checklist points
  // at. No duplicate check needed — the data file is empty by construction.
  let unmapped = 0;
  for (const { rec, idTrusted } of wzImportableRecords()) {
    const key = starterFundFor(rec);
    const fund = (key && fundNameByKey[key]) || '';
    pushImportedTx(month, rec, fund, idTrusted);
    if (!fund) unmapped++;
  }

  // The "Finish setting up" checklist that hands off to the Budget page.
  const checklist = [{ key: 'amounts', done: false }, { key: 'checks', done: false }];
  if (giving) checklist.push({ key: 'tithe', done: false });
  if (!wizard.files.length) checklist.push({ key: 'import', done: false });
  if (unmapped > 0) checklist.push({ key: 'unassigned', done: false });
  s.setupChecklist = checklist;
  s.onboardedAt = todayISO();

  data.months.push(month);
  await flushSave(); // the first write of the data file

  // A first-run user who confirmed their bank once should never see those
  // questions again on the Import tab.
  for (const f of wizard.files) persistResolvedProfile(f.report, f.answers);

  wizard = null;
  $('#sidebar').style.display = '';
  enterApp();
}

/* ---------------- boot ---------------- */
// Wire the shell and show the app. Reached two ways: normal boot with months,
// or the onboarding wizard finishing its first month.
function enterApp() {
  // Default to the current calendar month if it exists, else the latest.
  const nowId = todayISO().slice(0, 7);
  currentMonthId = data.months.some((m) => m.id === nowId) ? nowId : data.months[data.months.length - 1].id;
  view = 'budget';

  $('#monthSelect').onchange = (e) => { currentMonthId = e.target.value; txSearch = ''; txFundFilter = ''; txAccountFilter = ''; fundSearch = ''; flagPanel = null; render(); };
  $('#newMonthBtn').onclick = startNextMonth;
  $$('.nav-btn').forEach((b) => b.onclick = () => { view = b.dataset.view; txSearch = ''; txFundFilter = ''; txAccountFilter = ''; render(); });
  render();
}

async function boot() {
  data = await window.budgetAPI.loadData();
  let migrated = migrateV2(data) | migrateV3(data) | migrateV4(data);
  const v5 = migrateV5(data);
  migrated = migrated || v5.changed;
  // v6 must run after v5 — it bumps the version past 5, which would make
  // migrateV5 skip its re-type pass on a fresh seed.
  migrated = migrateV6(data) || migrated;
  // Record the re-typed list before saving so it survives a restart — the
  // migration only runs once, and the user should be able to review it later.
  if (v5.retyped.length) data.settings.lastRetype = v5.retyped;

  // A brand-new install has no months (and nothing downstream tolerates that —
  // the wizard is the only code path that can create a FIRST month). Nothing
  // is saved until the wizard finishes, so quitting mid-way is a clean no-op.
  if (!data.months.length) { renderOnboarding(); return; }

  if (migrated) await window.budgetAPI.saveData(data);
  if (v5.retyped.length) {
    setTimeout(() => toast(`${v5.retyped.length} single-charge fund(s) re-typed from Pacing to Basic — see Settings for the list.`), 800);
  }
  enterApp();
}
boot();
