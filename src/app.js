import {
  computeMonth, applyTitheRules, applyChecksRules, buildNextMonth,
  monthLabel, normFund, r2, migrateV2, migrateV3, migrateV4,
  autoPlanned, isOverridden, fundFlags, savingsMonthly, migrateV5,
} from './compute.js';
import { parseBankCsv, buildVendorMap, suggestFund, findDuplicate } from './csv.js';
import { groupedBars, barList } from './charts.js';

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
  else if (view === 'settings') renderSettings(main);
  // An open fund panel shows live numbers and position-dependent actions, so it
  // refreshes with the page rather than going stale.
  if (panelRef) renderFundPanel();
}

/* ---------------- Name-input dialog (Electron has no window.prompt) ---------------- */
function promptName(title, placeholder, onSubmit) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="width:360px">
      <h2 style="font-size:1.05rem">${esc(title)}</h2>
      <div class="modal-row" style="margin-top:10px">
        <input id="pnInput" class="search" style="flex:1" placeholder="${esc(placeholder)}" maxlength="60">
      </div>
      <div class="modal-err" id="pnErr"></div>
      <div class="modal-actions">
        <button class="btn" id="pnCancel">Cancel</button>
        <button class="btn btn-accent" id="pnOk">Add</button>
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
  { key: 'standard', name: 'Standard Income', desc: 'Paychecks, bonuses, or a main source of income — planned as checks × per-check amount.' },
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

function closeFundPanel() {
  panelRef = null;
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
              <b class="${moneyCls(isIncome ? live.received : live.expensed)}">${money(isIncome ? live.received : live.expensed)}</b></div>
            <div class="panel-num-ro"><span>Left</span>
              <b class="${moneyCls(live.leftover)}">${money(live.leftover)}</b></div>
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
              <div class="modal-row"><label style="width:auto">Paycheck</label>
                <input class="money small-num" id="pnlChkCount" value="${chk.count || 0}" title="Number of checks this month">
                <span class="muted">×</span>
                <input class="money" id="pnlChkAmount" value="${money(chk.amount || 0)}" title="Deposited amount per check (after deductions)">
                <span class="muted">· titheable</span>
                <input class="money" id="pnlChkTithe" value="${money(chk.titheAmount || 0)}" title="Per-check income the tithe is based on (before insurance/retirement deductions)"></div>
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
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFundPanel(); });

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

// One collapsible section: header line carries the numbers so the body doesn't
// need a totals row.
function accordionHtml({ key, title, note, open, totals, actions, body, barPct, barOver }) {
  const num = (label, v, cls = '') =>
    `<span class="acc-num ${cls}"><span class="acc-num-k">${label}</span><span class="acc-num-v ${moneyCls(v)}">${money(v)}</span></span>`;
  return `<div class="acc ${open ? 'open' : ''}" data-acc="${key}">
    <div class="acc-head" data-acc-toggle="${key}">
      <span class="acc-caret">${open ? '▾' : '▸'}</span>
      <span class="acc-title">${title}${note ? ` <span class="muted acc-note">${note}</span>` : ''}</span>
      <span class="acc-bar" title="${barPct != null ? `${Math.round(barPct)}% of the plan spent` : ''}">${
        barPct != null ? `<span class="acc-bar-fill ${barOver ? 'over' : ''}" style="width:${Math.min(100, Math.max(0, barPct))}%"></span>` : ''
      }</span>
      <span class="acc-nums">
        ${num('carry', totals.carryOver, 'quiet')}${num('planned', totals.planned)}${num(totals.spentLabel || 'spent', totals.spent)}${num('left', totals.leftover)}
      </span>
      <span class="acc-actions">${open ? actions : ''}</span>
    </div>
    <div class="acc-body">${open ? body : ''}</div>
  </div>`;
}

// Column widths shared by every fund table so the sticky header lines up.
const FUND_COLS = `<colgroup>
  <col style="width:32%"><col style="width:13%"><col style="width:13%"><col style="width:13%">
  <col style="width:6%"><col style="width:13%"><col style="width:92px"></colgroup>`;

function renderBudget(main) {
  const month = curMonth();
  const comp = computeMonth(month);
  const s = comp.summary;
  const balanced = Math.abs(s.leftToAllocate) < 0.005;

  const flags = fundFlags(month, comp, todayISO());
  const attList = flags.filter((x) => x.attention);
  const offList = flags.filter((x) => x.offset);
  const flagMap = {};
  for (const x of flags) flagMap[normFund(x.fund)] = x;
  const reviewCount = attList.length + offList.length + (comp.unassigned.length ? 1 : 0);

  // Which sections are expanded: search overrides, else remembered, else smart default.
  const q = fundSearch.trim().toLowerCase();
  const matches = (name) => !q || String(name).toLowerCase().includes(q);
  let openSet = loadOpenState(month.id) || defaultOpenState(comp, flagMap);
  const isOpen = (key) => (q ? true : openSet.has(key));

  let html = `
    <div class="month-head">
      <div class="hero ${s.leftToAllocate >= -0.004 ? 'good' : 'bad'}">
        <div class="k">Left to allocate</div>
        <div class="v">${money(s.leftToAllocate)}</div>
        <div class="note">${balanced ? 'Zero-based ✓' : s.leftToAllocate > 0 ? 'Unallocated income' : 'Over-allocated'}
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

    html += `<div class="review-strip">
      ${group('⚠ Needs attention', 'over budget or spending too fast', attRows)}
      ${group('💡 Available to move', 'safe to transfer elsewhere', offRows)}
      ${group('📥 Unassigned transactions', 'not counted in any fund', unRows)}
    </div>`;
  }

  // Income sections: Standard (paychecks) and Bonus (everything else)
  const incomeGroups = [
    { key: 'standard', title: 'Standard Income', hint: 'Paychecks, bonuses, or a main source of income. Planned = checks × per-check amount. The tithe uses the titheable amount (before insurance/retirement deductions), not the deposited amount.' },
    { key: 'bonus', title: 'Extra Income', hint: 'Inconsistent income you want to track — gifts, reimbursements, transfers. Tithed at the full planned amount unless exempt.' },
  ];
  // Transactions per fund this month (for the count column).
  const txCounts = {};
  for (const t of month.transactions) {
    const k = normFund(t.fund);
    if (k) txCounts[k] = (txCounts[k] || 0) + 1;
  }
  const txCell = (f) => {
    const n = txCounts[normFund(f.fund)] || 0;
    return n
      ? `<td><a href="#" class="tx-count" data-txfund="${esc(f.fund)}" title="See this fund's ${n} transaction(s)">${n}</a></td>`
      : `<td><span class="tx-count-zero" title="No transactions yet this month">0</span></td>`;
  };

  for (const g of incomeGroups) {
    const all = comp.income.map((f, i) => ({ f, i })).filter(({ f }) => (f.group || 'bonus') === g.key);
    const rows = all.filter(({ f }) => matches(f.fund));
    if (q && !rows.length) continue;
    const isStd = g.key === 'standard';
    const accKey = `inc:${g.key}`;
    const open = isOpen(accKey);
    // Same column grammar as the expense tables; only the "Received" label differs.
    let body = `<table class="grid tbl-fixed">${FUND_COLS}<thead><tr>
      <th>Fund</th><th>Carry over</th><th>Planned</th><th>Received</th>
      <th title="Transactions in this fund this month">Tx</th><th>Leftover</th><th></th>
      </tr></thead><tbody>`;
    for (const { f, i } of rows) {
      const chk = (month.checks || {})[f.fund] || { count: 0, amount: 0, titheAmount: 0 };
      // Paycheck maths live in the fund panel; the row just states the result.
      const caption = isStd && chk.count
        ? `<div class="fund-note">${chk.count} × ${money(chk.amount)}${chk.titheAmount && Math.abs(chk.titheAmount - chk.amount) > 0.004
            ? ` · titheable ${money(chk.titheAmount)}` : ''}</div>`
        : '';
      body += `<tr>
        <td><a href="#" class="fund-name" data-inc-setup="${i}" title="Open this fund — income type, tithe, carry-over, paycheck">${esc(f.fund)}</a>${
          f.titheExempt ? '<span class="type-mark quiet" title="Exempt from tithe — not counted in the tithe base.">⊘</span>' : ''}${
          f.carryForward ? '<span class="type-mark" title="Leftover rolls into next month\'s carry-over instead of resetting to $0.">↷</span>' : ''}${caption}</td>
        <td><input class="money" data-inc="${i}" data-k="carryOver" value="${money(f.carryOver)}"></td>
        <td><input class="money" data-inc="${i}" data-k="planned" value="${money(f.planned)}"></td>
        <td class="${moneyCls(f.received)}"><a href="#" class="mono" data-txfund="${esc(f.fund)}" style="color:inherit">${money(f.received)}</a></td>
        ${txCell(f)}
        <td class="${moneyCls(f.leftover)}">${money(f.leftover)}</td>
        <td class="row-actions"><button class="btn-ghost row-more" data-inc-setup="${i}" title="Open this fund — setup, transfer, reorder, transactions">⋯</button></td></tr>`;
    }
    body += `</tbody></table>`;
    const gt = {
      carryOver: r2(all.reduce((a, { f }) => a + f.carryOver, 0)),
      planned: r2(all.reduce((a, { f }) => a + f.planned, 0)),
      spent: r2(all.reduce((a, { f }) => a + f.received, 0)),
      leftover: r2(all.reduce((a, { f }) => a + f.leftover, 0)),
      spentLabel: 'received',
    };
    html += accordionHtml({
      key: accKey,
      title: `<span title="${esc(g.hint)}">${g.title}</span>`,
      note: `${all.length} fund${all.length === 1 ? '' : 's'}`,
      open,
      totals: gt,
      barPct: gt.planned > 0.004 ? (gt.spent / gt.planned) * 100 : null,
      barOver: false,
      actions: `<button class="btn btn-sm" data-add-inc="${g.key}">+ Add fund</button>`,
      body,
    });
  }

  // Expense categories — one sticky column header for all of them.
  html += `<div class="grid-head">
    <table class="grid tbl-fixed">${FUND_COLS}<thead><tr>
      <th>Fund</th><th>Carry over</th><th>Planned</th><th>Spent</th>
      <th title="Transactions in this fund this month">Tx</th><th>Leftover</th><th></th>
    </tr></thead></table>
  </div>`;

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
        <td><a href="#" class="fund-name" data-fund-setup="${ci}:${fi}" title="Click for fund setup (fund type, schedule, savings goal, category)">${esc(f.fund)}</a>${fundChips(f, flagMap[normFund(f.fund)], month.id)}</td>
        <td><input class="money" data-cat="${ci}" data-fund="${fi}" data-k="carryOver" value="${money(f.carryOver)}"></td>
        <td><input class="money" data-cat="${ci}" data-fund="${fi}" data-k="planned" value="${money(f.planned)}"></td>
        <td class="${moneyCls(f.expensed)}"><a href="#" class="mono" data-txfund="${esc(f.fund)}" style="color:inherit">${money(f.expensed)}</a></td>
        ${txCell(f)}
        <td class="${moneyCls(f.leftover)}">${money(f.leftover)}</td>
        <td class="row-actions"><button class="btn-ghost row-more" data-fund-setup="${ci}:${fi}" title="Open this fund — setup, transfer, reorder, transactions">⋯</button></td></tr>`;
    });
    if (!rows.length) body += `<tr><td colspan="7" class="muted" style="padding:10px 12px">No funds yet — use “+ Add fund”.</td></tr>`;
    body += `</tbody></table>`;
    const t = c.totals;
    const budget = r2(t.carryOver + t.planned);
    html += accordionHtml({
      key: accKey,
      title: esc(c.name),
      note: `${c.funds.length} fund${c.funds.length === 1 ? '' : 's'}${c.excludeFromTotals ? ' · not counted in totals' : ''}`,
      open,
      totals: { carryOver: t.carryOver, planned: t.planned, spent: t.expensed, leftover: t.leftover },
      barPct: budget > 0.004 ? (Math.abs(t.expensed) / budget) * 100 : null,
      barOver: t.leftover < -0.004,
      actions: `<button class="btn btn-sm" data-add-fund="${ci}">+ Add fund</button>
        <button class="btn-ghost" data-del-cat="${ci}" title="Remove this category (must be empty first; past months keep it)">✕</button>`,
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
      <th style="text-align:left">Fund</th><th style="text-align:left">Description</th><th style="width:90px;text-align:left">Account</th><th style="width:34px"></th>
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
function renderImport(main) {
  let html = `<h1>Import bank CSV</h1>
    <p class="sub">Pick the CSV you export from your bank (Capital One format). The app matches each row to a fund based on your history, flags duplicates and card payments, and nothing is saved until you click Import.</p>
    <div class="toolbar"><button class="btn btn-accent" id="pickCsv">📄 Choose CSV file…</button></div>`;

  if (importState) {
    const inc = importState.rows.filter((r) => r.include);
    html += `<div class="toolbar">
      <span><b>${importState.fileName}</b> — ${importState.rows.length} rows, <b>${inc.length}</b> selected to import</span>
      <div class="spacer"></div>
      <button class="btn" id="cancelImport">Cancel</button>
      <button class="btn btn-accent" id="doImport" ${inc.length ? '' : 'disabled'}>Import ${inc.length} transaction(s)</button>
    </div>
    <div class="section"><table class="grid"><thead><tr>
      <th style="width:30px"></th><th style="text-align:left">Date</th><th style="text-align:left">Vendor</th>
      <th>Amount</th><th style="text-align:left">Month</th><th style="text-align:left">Fund</th><th style="text-align:left">Status</th>
    </tr></thead><tbody>`;
    importState.rows.forEach((row, i) => {
      const rec = row.rec;
      const badges = [];
      if (row.duplicate) badges.push('<span class="badge dup">duplicate</span>');
      if (rec.isCardPayment) badges.push('<span class="badge pay">card payment</span>');
      if (!row.monthExists) badges.push(`<span class="badge warn">month not started</span>`);
      if (row.include && !row.fund) badges.push('<span class="badge warn">pick a fund</span>');
      if (row.include && row.fund && !row.duplicate && !rec.isCardPayment) badges.push('<span class="badge new">ready</span>');
      const month = row.monthExists ? data.months.find((m) => m.id === row.monthId) : null;
      html += `<tr class="${row.include ? '' : 'import-row-off'}">
        <td><input type="checkbox" data-imp-inc="${i}" ${row.include ? 'checked' : ''} ${row.monthExists ? '' : 'disabled'}></td>
        <td>${fmtDate(rec.date)}</td>
        <td title="${esc(rec.vendor)}">${esc(rec.vendor.length > 38 ? rec.vendor.slice(0, 38) + '…' : rec.vendor)}
          ${rec.account ? `<span class="fund-note"> · ${esc(rec.account)}</span>` : ''}</td>
        <td class="${moneyCls(rec.amount)}">${money(rec.amount)}</td>
        <td>${monthLabel(row.monthId)}</td>
        <td>${month ? `<select class="inline ${row.include && !row.fund ? 'missing' : ''}" data-imp-fund="${i}">${fundOptions(month, row.fund)}</select>` : '<span class="muted">—</span>'}
          ${row.suggestNote ? `<div class="fund-note">${esc(row.suggestNote)}</div>` : ''}</td>
        <td>${badges.join(' ')}</td></tr>`;
    });
    html += `</tbody></table></div>`;
  }
  main.innerHTML = html;

  $('#pickCsv').onclick = async () => {
    const file = await window.budgetAPI.openCsv();
    if (!file) return;
    let recs;
    try { recs = parseBankCsv(file.text); }
    catch (err) { toast(err.message); return; }
    if (!recs.length) { toast('No transactions found in that file.'); return; }
    const vendorMap = buildVendorMap(data.months);
    const claimed = new Set();
    const rows = recs.map((rec) => {
      const monthId = rec.date.slice(0, 7);
      const month = data.months.find((m) => m.id === monthId);
      const dup = month ? !!findDuplicate(data.months, rec, claimed) : false;
      let fund = '', suggestNote = '';
      if (month) {
        const sug = suggestFund(vendorMap, rec.vendor);
        if (sug) {
          const canon = canonicalFund(month, sug.fund);
          if (canon) { fund = canon; suggestNote = `auto-matched (seen ${sug.n}×)`; }
        }
      }
      return {
        rec, monthId, monthExists: !!month, duplicate: dup, fund, suggestNote,
        include: !!month && !dup && !rec.isCardPayment,
      };
    });
    importState = { fileName: file.path.split(/[\\/]/).pop(), rows };
    render();
  };

  if (importState) {
    $('#cancelImport').onclick = () => { importState = null; render(); };
    $('#doImport').onclick = () => {
      const chosen = importState.rows.filter((r) => r.include);
      const missing = chosen.filter((r) => !r.fund);
      if (missing.length && !confirm(`${missing.length} selected row(s) have no fund picked — they'll show as "unassigned" until you fix them. Import anyway?`)) return;
      let n = 0, lastMonth = null;
      for (const row of chosen) {
        const month = data.months.find((m) => m.id === row.monthId);
        if (!month) continue;
        month.transactions.push({
          id: newTxId(), date: row.rec.date, vendor: row.rec.vendor, amount: row.rec.amount,
          fund: row.fund, description: '', account: row.rec.account,
        });
        n++; lastMonth = month.id;
      }
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

  // Category rows (spent shown as positive magnitude)
  const catNames = [];
  for (const { m } of comps) for (const c of m.categories) if (!catNames.includes(c.name)) catNames.push(c.name);
  for (const name of catNames) {
    html += `<tr><td>${esc(name)}</td>`;
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
  const catRows = catNames
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

/* ---------------- boot ---------------- */
async function boot() {
  data = await window.budgetAPI.loadData();
  let migrated = migrateV2(data) | migrateV3(data) | migrateV4(data);
  const v5 = migrateV5(data);
  migrated = migrated || v5.changed;
  // Record the re-typed list before saving so it survives a restart — the
  // migration only runs once, and the user should be able to review it later.
  if (v5.retyped.length) data.settings.lastRetype = v5.retyped;
  if (migrated) await window.budgetAPI.saveData(data);
  if (v5.retyped.length) {
    setTimeout(() => toast(`${v5.retyped.length} single-charge fund(s) re-typed from Pacing to Basic — see Settings for the list.`), 800);
  }
  // Default to the current calendar month if it exists, else the latest.
  const nowId = todayISO().slice(0, 7);
  currentMonthId = data.months.some((m) => m.id === nowId) ? nowId : data.months[data.months.length - 1].id;

  $('#monthSelect').onchange = (e) => { currentMonthId = e.target.value; txSearch = ''; txFundFilter = ''; txAccountFilter = ''; fundSearch = ''; flagPanel = null; render(); };
  $('#newMonthBtn').onclick = startNextMonth;
  $$('.nav-btn').forEach((b) => b.onclick = () => { view = b.dataset.view; txSearch = ''; txFundFilter = ''; txAccountFilter = ''; render(); });
  render();
}
boot();
