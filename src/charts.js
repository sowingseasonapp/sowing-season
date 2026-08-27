// Small SVG chart components (no dependencies).
// Colors/ink follow the app's viz tokens defined in styles.css.

const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs = {}, children = []) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of children) e.appendChild(c);
  return e;
}
const fmtUSD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
// barList labels are user text (category names) going into innerHTML — escape
// them (same 5-entity map as app.js). Other chart labels are app-generated.
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtFull = (v) => fmtUSD.format(v);
// Negative ticks put the sign before the $ (lineArea can dip below zero).
const fmtTick = (v) => (v < 0 ? '-' : '') +
  (Math.abs(v) >= 1000 ? '$' + +(Math.abs(v) / 1000).toFixed(1) + 'k' : '$' + Math.round(Math.abs(v)));

// A "nice" max + tick step for the y scale.
function niceScale(max, tickCount = 4) {
  if (max <= 0) max = 1;
  const raw = max / tickCount;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  return { step, top: Math.ceil(max / step) * step };
}

// Bar with a 4px rounded data-end (top), flat baseline.
function barPath(x, yTop, w, h, r = 4) {
  r = Math.min(r, w / 2, h);
  const yb = yTop + h;
  return `M${x},${yb} L${x},${yTop + r} Q${x},${yTop} ${x + r},${yTop} L${x + w - r},${yTop} Q${x + w},${yTop} ${x + w},${yTop + r} L${x + w},${yb} Z`;
}

function makeTooltip(container) {
  const tip = document.createElement('div');
  tip.className = 'viz-tip';
  container.appendChild(tip);
  return {
    show(html, px, py) {
      tip.innerHTML = html;
      tip.style.display = 'block';
      const cw = container.clientWidth;
      const tw = tip.offsetWidth;
      let x = px + 12;
      if (x + tw > cw - 4) x = px - tw - 12;
      tip.style.left = Math.max(4, x) + 'px';
      tip.style.top = Math.max(4, py - tip.offsetHeight - 10) + 'px';
    },
    hide() { tip.style.display = 'none'; },
  };
}

// Grouped vertical bars. series: [{name, color, values:number[]}], labels: string[]
export function groupedBars({ labels, series, height = 230 }) {
  const wrap = document.createElement('div');
  wrap.className = 'viz-root';

  // Legend (2+ series → always present); ink stays text-colored, chip carries the hue.
  const legend = document.createElement('div');
  legend.className = 'viz-legend';
  for (const s of series) {
    const item = document.createElement('span');
    item.className = 'viz-legend-item';
    item.innerHTML = `<span class="viz-chip" style="background:${s.color}"></span>${s.name}`;
    legend.appendChild(item);
  }
  wrap.appendChild(legend);

  const plotWrap = document.createElement('div');
  plotWrap.style.position = 'relative';
  wrap.appendChild(plotWrap);

  const M = { l: 46, r: 8, t: 8, b: 22 };
  const W = 900, H = height;
  const innerW = W - M.l - M.r, innerH = H - M.t - M.b;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const { step, top } = niceScale(max);
  const y = (v) => M.t + innerH - (v / top) * innerH;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'viz-svg', role: 'img' });

  // Grid + y ticks (recessive)
  for (let t = 0; t <= top + 0.001; t += step) {
    const yy = y(t);
    svg.appendChild(el('line', { x1: M.l, x2: W - M.r, y1: yy, y2: yy, class: t === 0 ? 'viz-baseline' : 'viz-grid' }));
    const txt = el('text', { x: M.l - 6, y: yy + 3.5, class: 'viz-tick', 'text-anchor': 'end' });
    txt.textContent = fmtTick(t);
    svg.appendChild(txt);
  }

  const n = labels.length, ns = series.length;
  const groupW = innerW / n;
  const barGap = 2, groupPad = Math.max(4, groupW * 0.16);
  const barW = Math.min(26, (groupW - groupPad * 2 - barGap * (ns - 1)) / ns);
  const usedW = barW * ns + barGap * (ns - 1);

  const tooltip = makeTooltip(plotWrap);
  labels.forEach((lab, i) => {
    const gx = M.l + i * groupW;
    const x0 = gx + (groupW - usedW) / 2;
    series.forEach((s, si) => {
      const v = s.values[i] || 0;
      if (v > 0.004) {
        svg.appendChild(el('path', { d: barPath(x0 + si * (barW + barGap), y(v), barW, y(0) - y(v)), fill: s.color }));
      }
    });
    // x label
    const txt = el('text', { x: gx + groupW / 2, y: H - 6, class: 'viz-tick', 'text-anchor': 'middle' });
    txt.textContent = lab;
    svg.appendChild(txt);
    // hover hit target = whole group column
    const hit = el('rect', { x: gx, y: M.t, width: groupW, height: innerH, fill: 'transparent' });
    hit.addEventListener('mousemove', (e) => {
      const r = plotWrap.getBoundingClientRect();
      const rows = series.map((s) =>
        `<div><span class="viz-chip" style="background:${s.color}"></span>${s.name}: <b>${fmtFull(s.values[i] || 0)}</b></div>`).join('');
      tooltip.show(`<div class="viz-tip-title">${lab}</div>${rows}`, e.clientX - r.left, e.clientY - r.top);
      hover.setAttribute('x', gx); hover.style.display = 'block';
    });
    hit.addEventListener('mouseleave', () => { tooltip.hide(); hover.style.display = 'none'; });
    svg.appendChild(hit);
  });
  // hover wash behind the group (appended before hit rects would be ideal; use low opacity on top)
  const hover = el('rect', { y: M.t, width: groupW, height: innerH, fill: 'rgba(38,48,31,0.05)', 'pointer-events': 'none' });
  hover.style.display = 'none';
  svg.insertBefore(hover, svg.firstChild.nextSibling);

  plotWrap.appendChild(svg);
  return wrap;
}

// Single-series line with a soft area fill down to the zero baseline.
// points: [{ label, value, tip }] — tip is optional extra tooltip html shown
// under the label (lineArea's caller passes the full snapshot's rows through).
// Handles negative values: the scale extends below zero and the baseline is
// drawn at y(0), not at the bottom edge.
export function lineArea({ points, color, height = 230 }) {
  const wrap = document.createElement('div');
  wrap.className = 'viz-root';
  const plotWrap = document.createElement('div');
  plotWrap.style.position = 'relative';
  wrap.appendChild(plotWrap);

  const M = { l: 52, r: 10, t: 10, b: 22 };
  const W = 900, H = height;
  const innerW = W - M.l - M.r, innerH = H - M.t - M.b;
  const vals = points.map((p) => p.value);
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals);
  const { step } = niceScale(Math.max(1, max - min));
  const lo = Math.floor(min / step) * step;
  const hi = Math.max(Math.ceil(max / step) * step, lo + step);
  const y = (v) => M.t + innerH - ((v - lo) / (hi - lo)) * innerH;
  const x = (i) => points.length === 1 ? M.l + innerW / 2 : M.l + (i / (points.length - 1)) * innerW;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'viz-svg', role: 'img' });

  // Grid + y ticks; the zero line gets the baseline treatment wherever it sits.
  for (let t = lo; t <= hi + step / 1000; t += step) {
    const yy = y(t);
    svg.appendChild(el('line', { x1: M.l, x2: W - M.r, y1: yy, y2: yy, class: Math.abs(t) < step / 1000 ? 'viz-baseline' : 'viz-grid' }));
    const txt = el('text', { x: M.l - 6, y: yy + 3.5, class: 'viz-tick', 'text-anchor': 'end' });
    txt.textContent = fmtTick(t);
    svg.appendChild(txt);
  }

  // Area fill (to the zero baseline) beneath the line, then the line itself.
  const pts = points.map((p, i) => [x(i), y(p.value)]);
  const lineD = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px},${py}`).join(' ');
  if (pts.length > 1) {
    const y0 = y(0);
    svg.appendChild(el('path', {
      d: `${lineD} L${pts[pts.length - 1][0]},${y0} L${pts[0][0]},${y0} Z`,
      fill: color, opacity: '0.08',
    }));
    svg.appendChild(el('path', {
      d: lineD, fill: 'none', stroke: color, 'stroke-width': 2,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }));
  }

  // x labels, thinned so they never crowd past ~12.
  const every = Math.ceil(points.length / 12);
  points.forEach((p, i) => {
    if (i % every && i !== points.length - 1) return;
    const txt = el('text', { x: x(i), y: H - 6, class: 'viz-tick', 'text-anchor': 'middle' });
    txt.textContent = p.label;
    svg.appendChild(txt);
  });

  // Dots on data points; hover columns drive the tooltip.
  const tooltip = makeTooltip(plotWrap);
  const colW = innerW / Math.max(1, points.length);
  points.forEach((p, i) => {
    svg.appendChild(el('circle', { cx: x(i), cy: y(p.value), r: 3.5, fill: color, class: 'viz-dot' }));
    const hit = el('rect', { x: x(i) - colW / 2, y: M.t, width: colW, height: innerH, fill: 'transparent' });
    hit.addEventListener('mousemove', (e) => {
      const r = plotWrap.getBoundingClientRect();
      tooltip.show(`<div class="viz-tip-title">${p.label}</div>${p.tip || `<div><b>${fmtFull(p.value)}</b></div>`}`,
        e.clientX - r.left, e.clientY - r.top);
    });
    hit.addEventListener('mouseleave', () => tooltip.hide());
    svg.appendChild(hit);
  });

  plotWrap.appendChild(svg);
  return wrap;
}

// Horizontal ranked bar list (single hue → no legend; direct value labels in ink).
export function barList({ rows, color }) {
  const wrap = document.createElement('div');
  wrap.className = 'viz-root viz-barlist';
  const max = Math.max(1, ...rows.map((r) => r.value));
  for (const r of rows) {
    const line = document.createElement('div');
    line.className = 'viz-bl-row';
    const pct = Math.max(0.5, (r.value / max) * 100);
    line.innerHTML = `
      <span class="viz-bl-label" title="${esc(r.label)}">${esc(r.label)}</span>
      <span class="viz-bl-track"><span class="viz-bl-bar" style="width:${pct}%;background:${color}"></span></span>
      <span class="viz-bl-val">${fmtFull(r.value)}</span>`;
    wrap.appendChild(line);
  }
  return wrap;
}
