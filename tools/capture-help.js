// Recaptures the AUM + Budget walkthrough screenshots (src/assets/help/*.png)
// from the real app running against FABRICATED demo data — never the owner's live
// file or data/seed.json. Run:  node_modules\.bin\electron tools\capture-help.js
//
// How: writes a demo budget-data.json into a scratch folder, points the app
// at it through the BUDGET_DATA_DIR escape hatch (main.js honours it before
// anything reads userData, and the legacy move-in is skipped under it), opens
// the normal window at 1160×800, drives the renderer to the AUM view via
// executeJavaScript, and shoots at 1:1 with webContents.capturePage (resampled
// captures anti-alias flat UI and balloon the PNGs). Crops come from element
// bounds so they track the layout.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'src', 'assets', 'help');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sowing-demo-'));
process.env.BUDGET_DATA_DIR = scratch;

// ---- fabricated demo data (round, invented numbers) ----
const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const monthId = iso(today).slice(0, 7);
const fund = (name, planned, type = 'basic', extra = {}) => ({ fund: name, carryOver: 0, planned, rule: null, yearlyCharge: null, setup: { type, everyMonths: 1, totalAmount: 0, targetAmount: 0, targetMonth: null, savingsMode: 'target', monthlyAmount: 0, buildGoal: 0, excludeInsights: false, ...extra } });
// Balanced to the dollar so the Budget hero shows "Left to allocate $0":
// income 3200 + 2100 + 100 = 5400 = planned expenses (tithe 540 is 10% of it).
const day = (d) => iso(new Date(today.getFullYear(), today.getMonth(), d));
const month = {
  id: monthId, label: monthId,
  checks: {
    "Sam's paychecks": { count: 2, amount: 1600, titheAmount: 1600 },
    "Alex's paychecks": { count: 2, amount: 1050, titheAmount: 1050 },
  },
  income: [
    { fund: "Sam's paychecks", carryOver: 0, planned: 3200, rule: { type: 'checks' }, group: 'standard', titheExempt: false },
    { fund: "Alex's paychecks", carryOver: 0, planned: 2100, rule: { type: 'checks' }, group: 'standard', titheExempt: false },
    { fund: 'Gifts', carryOver: 0, planned: 100, rule: null, group: 'bonus', titheExempt: false },
    { fund: 'Reimbursements', carryOver: 0, planned: 0, rule: null, group: 'bonus', titheExempt: true },
  ],
  categories: [
    { name: 'Giving', excludeFromTotals: false, funds: [fund('Tithe', 540), fund('Generosity', 60)] },
    { name: 'Home', excludeFromTotals: false, funds: [fund('Rent', 1450, 'fixed', { totalAmount: 1450 }), fund('Utilities', 220), fund('Internet', 70, 'fixed', { totalAmount: 70 }), fund('Phone', 95, 'fixed', { totalAmount: 95 }), fund('Home projects', 250, 'savings', { savingsMode: 'build', monthlyAmount: 250 })] },
    { name: 'Everyday', excludeFromTotals: false, funds: [fund('Groceries', 600, 'pacing'), fund('Gas', 180, 'pacing'), fund('Eating out', 150, 'pacing'), fund('Household', 105, 'pacing')] },
    { name: 'Family', excludeFromTotals: false, funds: [fund('Date nights', 80), fund('Kids activities', 120), fund('Clothing', 100)] },
    { name: 'Savings', excludeFromTotals: false, funds: [fund('Emergency fund', 550, 'savings', { savingsMode: 'build', monthlyAmount: 550 }), fund('Vacation', 400, 'savings', { targetAmount: 1800, targetMonth: '2027-06' }), fund('Christmas', 150, 'savings', { targetAmount: 600, targetMonth: `${today.getFullYear()}-12` }), fund('Car repairs', 280, 'savings', { savingsMode: 'build', monthlyAmount: 280 })] },
  ],
  transactions: [
    { id: 'd1', date: day(1), vendor: 'Direct deposit', amount: 1600, fund: "Sam's paychecks", description: '', account: 'Checking' },
    { id: 'd2', date: day(15), vendor: 'Direct deposit', amount: 1600, fund: "Sam's paychecks", description: '', account: 'Checking' },
    { id: 'd3', date: day(5), vendor: 'Direct deposit', amount: 1050, fund: "Alex's paychecks", description: '', account: 'Checking' },
    { id: 'd4', date: day(19), vendor: 'Direct deposit', amount: 1050, fund: "Alex's paychecks", description: '', account: 'Checking' },
    { id: 'd5', date: day(6), vendor: 'Birthday gift', amount: 50, fund: 'Gifts', description: '', account: 'Checking' },
    { id: 'd6', date: day(1), vendor: 'Landlord', amount: -1450, fund: 'Rent', description: '', account: 'Checking' },
    { id: 'd7', date: day(2), vendor: 'Corner Grocery', amount: -86.4, fund: 'Groceries', description: '', account: 'Card' },
    { id: 'd8', date: day(9), vendor: 'Corner Grocery', amount: -54.12, fund: 'Groceries', description: '', account: 'Card' },
    { id: 'd9', date: day(8), vendor: 'City Water', amount: -67.8, fund: 'Utilities', description: '', account: 'Checking' },
    { id: 'd10', date: day(5), vendor: 'Fuel Stop', amount: -42, fund: 'Gas', description: '', account: 'Card' },
    { id: 'd11', date: day(7), vendor: 'Riverside Diner', amount: -38.5, fund: 'Eating out', description: '', account: 'Card' },
  ],
};
const t = (d) => iso(d);
const assets = [
  { id: 'a_1', name: 'Checking', value: 3180, updatedAt: t(today) },
  { id: 'a_2', name: 'Savings', value: 11450, updatedAt: t(today) },
  { id: 'a_3', name: '401(k)', value: 46900, updatedAt: t(new Date(today - 9 * 864e5)) },
  { id: 'a_4', name: 'Home (est.)', value: 312000, updatedAt: t(new Date(today - 40 * 864e5)) },
  { id: 'a_5', name: 'Car', value: 13500, updatedAt: t(new Date(today - 120 * 864e5)) },
];
const debts = [
  { id: 'd_1', name: 'Mortgage', value: 238400, updatedAt: t(today) },
  { id: 'd_2', name: 'Car loan', value: 8900, updatedAt: t(new Date(today - 9 * 864e5)) },
  { id: 'd_3', name: 'Credit card', value: 640, updatedAt: t(today) },
];
// 12 monthly snapshots, gently rising with a dip in the middle.
const snapshots = [];
const series = [130200, 131050, 132400, 133100, 132300, 131800, 133900, 135400, 136100, 137600, 138300, 139090]; // ends at the live total (387,030 − 247,940)
for (let i = 0; i < 12; i++) {
  const d = new Date(today.getFullYear(), today.getMonth() - (11 - i), Math.min(today.getDate(), 28));
  const aum = series[i];
  snapshots.push({ date: t(d), assets: aum + 247940, debts: 247940, aum });
}
const data = {
  version: 6,
  settings: {
    tithePercent: 0.10, appName: 'Sowing Season',
    gardenIntroSeen: true, aumHelpSeen: true, budgetHelpSeen: true,
    // A mid-flight checklist so budget-hero.png shows the hand-off card.
    setupChecklist: [
      { key: 'amounts', done: true },
      { key: 'checks', done: false },
      { key: 'tithe', done: true },
      { key: 'import', done: true },
    ],
  },
  months: [month],
  aum: { assets, debts, snapshots, log: [
    { date: t(today), kind: 'asset', name: 'Checking', from: 2960, to: 3180, action: 'update' },
    { date: t(today), kind: 'debt', name: 'Credit card', from: 910, to: 640, action: 'update' },
    { date: t(new Date(today - 9 * 864e5)), kind: 'asset', name: '401(k)', from: 46200, to: 46900, action: 'update' },
  ] },
};
fs.writeFileSync(path.join(scratch, 'budget-data.json'), JSON.stringify(data));

// ---- drive the app ----
const { app, BrowserWindow } = require('electron');
require(path.join(ROOT, 'main.js')); // registers whenReady → createWindow

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  await wait(600);
  const win = BrowserWindow.getAllWindows()[0];
  win.setMenuBarVisibility(false);
  win.setSize(1160, 800);
  win.center();
  await wait(800);
  const wc = win.webContents;
  const js = (code) => wc.executeJavaScript(code, true);
  await js(`document.querySelector('[data-view="aum"]').click(); document.querySelector('.modal-overlay')?.remove(); document.querySelector('#main').scrollTop = 0; 'ok'`);
  await wait(700);
  const shot = async (name, rect) => {
    const img = await wc.capturePage(rect);
    fs.writeFileSync(path.join(OUT, name), img.toPNG());
    console.log(`wrote ${name} ${img.getSize().width}x${img.getSize().height}`);
  };
  // 1. overview: the whole window
  await shot('aum-overview.png');
  // 2. tables: the assets/debts grid
  const grid = await js(`(() => { const r = document.querySelector('.aum-grid').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  // make sure it is on screen
  await js(`document.querySelector('.aum-grid').scrollIntoView({ block: 'start' }); 'ok'`);
  await wait(300);
  const grid2 = await js(`(() => { const r = document.querySelector('.aum-grid').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  await shot('aum-tables.png', { x: Math.round(grid2.x), y: Math.round(grid2.y), width: Math.round(grid2.w), height: Math.min(Math.round(grid2.h), 800 - Math.round(grid2.y)) });
  // 3. trend: the chart section
  await js(`document.querySelector('#main').scrollTop = 0; document.querySelector('#aumChart').closest('.section').scrollIntoView({ block: 'start' }); 'ok'`);
  await wait(300);
  const sec = await js(`(() => { const r = document.querySelector('#aumChart').closest('.section').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  await shot('aum-trend.png', { x: Math.round(sec.x), y: Math.round(sec.y), width: Math.round(sec.w), height: Math.min(Math.round(sec.h), 800 - Math.round(sec.y)) });
  void grid;

  // ---- Budget walkthrough shots ----
  await js(`document.querySelector('[data-view="budget"]').click(); document.querySelector('.modal-overlay')?.remove(); document.querySelector('#main').scrollTop = 0; 'ok'`);
  await wait(700);
  // Open exactly the accordions each crop needs (each click re-renders).
  for (const key of ['inc:standard', 'inc:bonus', 'cat:2']) {
    await js(`(() => {
      const acc = document.querySelector('.acc[data-acc="${key}"]');
      if (acc && !acc.classList.contains('open')) acc.querySelector('[data-acc-toggle]').click();
      return 'ok';
    })()`);
    await wait(250);
  }
  const rect = async (expr, pad = 8) => {
    const r = await js(`(() => { const r = ${expr}; return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
    return {
      x: Math.max(0, Math.round(r.x) - pad), y: Math.max(0, Math.round(r.y) - pad),
      width: Math.round(r.w) + pad * 2,
      height: Math.min(Math.round(r.h) + pad * 2, 800 - Math.max(0, Math.round(r.y) - pad)),
    };
  };
  // 1+5. hero: checklist card + "Left to allocate" hero + toolbar, one crop.
  await js(`document.querySelector('#main').scrollTop = 0; 'ok'`);
  await wait(300);
  await shot('budget-hero.png', await rect(`(() => {
    const a = document.querySelector('.checklist').getBoundingClientRect();
    const b = document.querySelector('.toolbar').getBoundingClientRect();
    return { left: a.left, top: a.top, width: Math.max(a.width, b.width), height: b.bottom - a.top };
  })()`));
  // 2. income: Standard + Extra Income accordions, open.
  await js(`document.querySelector('.acc[data-acc="inc:standard"]').scrollIntoView({ block: 'start' }); document.querySelector('#main').scrollTop -= 10; 'ok'`);
  await wait(300);
  await shot('budget-income.png', await rect(`(() => {
    const a = document.querySelector('.acc[data-acc="inc:standard"]').getBoundingClientRect();
    const b = document.querySelector('.acc[data-acc="inc:bonus"]').getBoundingClientRect();
    return { left: a.left, top: a.top, width: Math.max(a.width, b.width), height: b.bottom - a.top };
  })()`));
  // 3+4. funds: the Everyday category open — rows with chips and all columns.
  await js(`document.querySelector('.acc[data-acc="cat:2"]').scrollIntoView({ block: 'start' }); document.querySelector('#main').scrollTop -= 10; 'ok'`);
  await wait(300);
  await shot('budget-funds.png', await rect(`document.querySelector('.acc[data-acc="cat:2"]').getBoundingClientRect()`));
  app.quit();
});
