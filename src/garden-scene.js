// The garden scene — one inline SVG drawn from a gardenState (garden.js).
// Pure: markup in, string out, no DOM, no randomness. The same state always
// draws the same garden (bed order = category order, plant order = fund order,
// species = name hash). Nothing here is a raster asset.
//
// THE WATERCOLOR TECHNIQUE (proposal §4 v3, reference: _cowork/watercolor-svg-poc.html):
//  - Every shape is painted in up to three passes — a broad light wash, a mid
//    tone, a dark accent — at 40–70% opacity from one shared ramp per material
//    (leaf greens, soil browns, petal golds, wood, stone, water).
//  - Exactly four filter defs, lifted from the POC: three feTurbulence +
//    feDisplacementMap filters with different seeds (#wc1–#wc3) and a paper
//    grain (#paper) on the background rect only. Filters are applied at the
//    WASH-GROUP level — each symbol or fixture emits three <g> groups (light,
//    mid, dark), each pushed through a different filter, so the passes'
//    wobbled edges misregister. That misregistration is what reads as
//    watercolor. Never per-tiny-element.
//  - Colours are CSS custom properties (--g-*) so season and time-of-day tints
//    are class flips on .garden-wrap, not new SVG.
//  - Gotcha (hit in the POC): a CSS animation's transform REPLACES an SVG
//    attribute transform. Every animated/hover-lifted element sits inside an
//    outer positioning <g transform="translate(…)"> with the class on an inner
//    group.
//
// Layers, back to front: paper → sky washes → sun/clouds → hills → ground →
// season light → maturity fixtures (tree, wall, fence, arbor, hive, pond, path)
// → beds by category (soil, sign) → plants → weeds → foreground grass → ambient.
//
// TWO OUTPUT MODES (see sceneSvg):
//  - live:   stacked inline SVGs (bg / fg / ambient sprite). Used by the dev
//            preview and the tests. Fine while nothing animates.
//  - bitmap: ONE self-contained SVG string (palette colours substituted for the
//            var(--g-*) tokens, styles inlined) that the view rasterises once
//            into a <canvas> at device resolution, plus a transparent HIT
//            LAYER (plants / "+N" signs / weeds as focusable buttons) and a
//            manifest of plant positions for LIVE SPRITES (plantSprite). Why:
//            measured on the packaged build, Chromium re-rasterises every SVG
//            filter region in a layer whenever ANY frame is produced — a
//            drifting butterfly (or a toast, or a hover transition) cost
//            1.7 cores with ~170 live filter regions. With the static scene as
//            a bitmap, filters exist only in the one-off raster and in a
//            handful of tiny sprites, so ambient motion is ~free. Nothing is
//            stored or shipped — the bitmap is re-rendered from the SVG on
//            every render and on resize.
import { layoutBeds, MATURITY_MILESTONES, SCENE_PLANT_CEILING, hashName } from './garden.js';

const W = 1000;
const HORIZON = 150;
const LAWN_H = 38;            // grass between the horizon and the first bed
const BED_H = 116;            // sign line + ~62 units of plant + soil strip (+ optional labels)
const SOIL_Y = 86;            // soil line within a bed
const EDGE_H = 58;            // the garden's edge (weeds, grass tufts) at the bottom
const PLANT_MIN_GAP = 54;
const PLANT_SCALE = 1.0;      // POC symbols are ~34 wide × ~64 tall at 1.0; beds give ~62 units above the soil
// Families have their natural sizes: a shrub is broader than a lettuce.
const FAMILY_SCALE = { rowcrop: .95, shrub: 1.25, fruit: 1.05, evergreen: 1.0 };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n1 = (x) => Math.round(x * 10) / 10;

/* ---------- the four filter defs (verbatim from the POC) ---------- */
export function filterDefs() {
  return `<filter id="wc1" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency="0.055" numOctaves="4" seed="7" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="7" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <filter id="wc2" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="4" seed="23" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <filter id="wc3" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency="0.07" numOctaves="3" seed="41" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <filter id="paper">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="11" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.42  0 0 0 0 0.40  0 0 0 0 0.33  0 0 0 0.045 0"/>
      <feComposite operator="over" in2="SourceGraphic"/>
    </filter>`;
}

/* ---------- inline styles for the self-contained (bitmap) SVG ---------- */
export function sceneStyle() {
  return `<style>
    .wc1{filter:url(#wc1)}.wc2{filter:url(#wc2)}.wc3{filter:url(#wc3)}
    text{font-family:"Segoe UI",system-ui,-apple-system,sans-serif}
    .g-label{font-size:12px;fill:#636a59}
    .g-sign-text{font-size:11px;font-weight:600;fill:#4a3b28}
    .g-plant-label{font-size:10px;fill:#fbf7ec;paint-order:stroke;stroke:rgba(74,59,40,.55);stroke-width:2.5px;stroke-linejoin:round}
    .g-plant-label.num{font-variant-numeric:tabular-nums}.g-plant-label.num.neg{fill:#ffd9cc}
    .plant .body{transform-box:fill-box;transform-origin:50% 100%}
    .plant.st-thirsty .body{transform:rotate(4deg)}
    .plant.st-wilting .body{transform:rotate(12deg) scale(1,.88);opacity:.88}
    .plant.st-resting .body{opacity:.65}
    .glow{opacity:.22}
  </style>`;
}
// Tokens the bitmap mode must resolve (read from the wrapper's computed style).
export const PALETTE_TOKENS = ['paper', 'sky-1', 'sky-2', 'sun', 'hill-1', 'hill-2', 'grass-1', 'grass-2', 'grass-3',
  'soil-l', 'soil-m', 'soil-d', 'leaf-l', 'leaf-m', 'leaf-d', 'dry-l', 'dry-m', 'petal-l', 'petal-m', 'petal-c',
  'wood-l', 'wood-m', 'wood-d', 'stone-l', 'stone-m', 'stone-d', 'water-l', 'water-m', 'water-d', 'path-l', 'path-m',
  'weed-l', 'weed-m', 'glow', 'light', 'light-op'];
export function applyPalette(svg, palette) {
  return svg.replace(/var\(--g-([\w-]+)\)/g, (m, k) => (palette && palette[k] !== undefined && palette[k] !== '' ? String(palette[k]).trim() : m));
}

/* ---------- the painter: three passes, one filter each ---------- */
// pass 0 = light wash, 1 = mid tone, 2 = dark accent. `order` rotates which
// filter each pass gets so neighbouring symbols don't share an edge signature.
const ORDERS = [['wc2', 'wc1', 'wc3'], ['wc3', 'wc2', 'wc1'], ['wc1', 'wc3', 'wc2']];
class Painter {
  constructor(order = 0) { this.p = [[], [], []]; this.order = ORDERS[order % 3]; this.plain = []; }
  ell(cx, cy, rx, ry, fill, op, pass, rot = 0) {
    this.p[pass].push(`<ellipse cx="${n1(cx)}" cy="${n1(cy)}" rx="${n1(rx)}" ry="${n1(ry)}" fill="${fill}" opacity="${op}"${rot ? ` transform="rotate(${n1(rot)} ${n1(cx)} ${n1(cy)})"` : ''}/>`);
    return this;
  }
  circ(cx, cy, r, fill, op, pass) { this.p[pass].push(`<circle cx="${n1(cx)}" cy="${n1(cy)}" r="${n1(r)}" fill="${fill}" opacity="${op}"/>`); return this; }
  path(d, fill, op, pass, stroke = null, sw = 0) {
    this.p[pass].push(`<path d="${d}" fill="${stroke ? 'none' : fill}" opacity="${op}"${stroke ? ` stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"` : ''}/>`);
    return this;
  }
  rect(x, y, w, h, fill, op, pass, rx = 0) { this.p[pass].push(`<rect x="${n1(x)}" y="${n1(y)}" width="${n1(w)}" height="${n1(h)}" rx="${rx}" fill="${fill}" opacity="${op}"/>`); return this; }
  raw(markup) { this.plain.push(markup); return this; }
  emit() {
    return this.p.map((list, i) => (list.length ? `<g class="${this.order[i]}">${list.join('')}</g>` : '')).join('') + this.plain.join('');
  }
}

/* ---------- shared strokes ---------- */
// Leaf: light wash + mid tone (the light one a touch larger), optional dark.
function leaf(P, cx, cy, len, wid, rot, ramp, dark = false) {
  P.ell(cx, cy, len, wid, ramp.l, .5, 0, rot).ell(cx + 0.8, cy, len * .85, wid * .84, dark ? ramp.d : ramp.m, .55, dark ? 2 : 1, rot);
}
// Stem: broad light wash under a thin mid line.
function stem(P, d, ramp, w = 2.6) {
  P.path(d, null, .45, 0, ramp.l, w * 1.9).path(d, null, .8, 1, ramp.m, w);
}
// Flower head: petal wash, mid, dark centre — the POC's layered petal stack.
function flower(P, cx, cy, r, petal = PETAL) {
  P.circ(cx, cy, r, petal.l, .45, 0).circ(cx, cy, r * .75, petal.m, .55, 1).circ(cx, cy, r * .37, petal.c, .7, 2);
}
// Planting spot + the one shared soft shadow (sun upper-left → shadow lower-right).
function mound(P) {
  P.ell(0, 0, 22, 6.5, SOIL.l, .5, 0).ell(3, 1, 17, 5, SOIL.m, .55, 1).ell(5, 2, 12, 3.4, SOIL.d, .4, 2);
}
// Ripe fruit: glow (plain, animatable, unfiltered), two washes, a highlight.
function fruit(P, cx, cy, r, col, glow = true) {
  if (glow) P.raw(`<circle class="glow" cx="${n1(cx)}" cy="${n1(cy)}" r="${n1(r * 1.8)}" fill="var(--g-glow)"/>`);
  P.circ(cx, cy, r * 1.25, col.l, .55, 0).circ(cx, cy, r, col.d, .7, 1).circ(cx - r * .35, cy - r * .35, r * .33, '#f2d9a0', .8, 2);
}

/* ---------- material ramps (CSS vars so seasons re-tint them) ---------- */
const LEAF = { l: 'var(--g-leaf-l)', m: 'var(--g-leaf-m)', d: 'var(--g-leaf-d)' };
const DRY = { l: 'var(--g-dry-l)', m: 'var(--g-dry-m)', d: 'var(--g-dry-m)' };
const SOIL = { l: 'var(--g-soil-l)', m: 'var(--g-soil-m)', d: 'var(--g-soil-d)' };
const WOOD = { l: 'var(--g-wood-l)', m: 'var(--g-wood-m)', d: 'var(--g-wood-d)' };
const STONE = { l: 'var(--g-stone-l)', m: 'var(--g-stone-m)', d: 'var(--g-stone-d)' };
const PETAL = { l: 'var(--g-petal-l)', m: 'var(--g-petal-m)', c: 'var(--g-petal-c)' };
// Species accents: literal — they are the plant's own colour, not a season tint.
const ACCENT = {
  lettuce: { petal: { l: '#e3edb5', m: '#c9dc8a', c: '#9fb95f' }, fruit: { l: '#cfe3a3', d: '#9fc36b' } },
  beans: { petal: { l: '#f6f1e4', m: '#ece1c6', c: '#c9b37a' }, fruit: { l: '#b6d39a', d: '#6f9d5a' } },
  carrot: { petal: { l: '#f6f3e8', m: '#e9e4cf', c: '#d6c58c' }, fruit: { l: '#f0a863', d: '#df7f2e' } },
  tomato: { petal: { l: '#f0d98a', m: '#e0bd52', c: '#b9923a' }, fruit: { l: '#e07a61', d: '#c44a37' } },
  lavender: { petal: { l: '#c9b6e8', m: '#a78fd6', c: '#7b62b5' } },
  rosemary: { petal: { l: '#bcd0f0', m: '#8fb0e3', c: '#5f86c6' } },
  sage: { petal: { l: '#dfc3e6', m: '#c49bd0', c: '#9a6ca8' } },
  boxwood: { petal: { l: '#eef1c9', m: '#dde39f', c: '#b9c26c' } },
  apple: { fruit: { l: '#e57c6c', d: '#cf4b3d' }, petal: { l: '#fbeaea', m: '#f2cfd2', c: '#e2a3a8' } },
  pear: { fruit: { l: '#e3e39a', d: '#c7c455' }, petal: { l: '#fbf6e8', m: '#f1e8c8', c: '#d9c98a' } },
  cherry: { fruit: { l: '#cc5566', d: '#a5243d' }, petal: { l: '#fde8ee', m: '#f6c9d6', c: '#e59bb0' } },
  plum: { fruit: { l: '#9e78b8', d: '#6b3f8f' }, petal: { l: '#f5e9f5', m: '#e6cfe8', c: '#c6a3cc' } },
  pine: { cone: { l: '#b08d6a', d: '#7d5e42' } },
  spruce: { cone: { l: '#a8835f', d: '#6f5238' } },
  cypress: { cone: { l: '#b89a70', d: '#86674a' } },
  juniper: { cone: { l: '#8d9bc6', d: '#5b6fa0' } },
};

/* ---------- plant symbols (soil point at 0,0; POC coords minus (60,118)) ---------- */
// The POC's six drawings, ported, plus growth stages and family variants.
function sprout(P, ramp = LEAF) {
  stem(P, 'M0,-2 C0,-8 0,-12 0,-16', ramp, 2.2);
  leaf(P, -7, -17, 8, 4, -28, ramp); leaf(P, 7, -18, 8, 4, 26, ramp);
}

function rowcrop(P, sp, state, stage) {
  const A = ACCENT[sp];
  if (state === 'thirsty') { // POC p-thirsty: stem leaning, leaves angled down — still green
    stem(P, 'M0,-1 C0,-16 1,-26 9,-34', DRY);
    leaf(P, -13, -14, 12, 5, -38, DRY); leaf(P, 13, -18, 12, 5, 38, DRY);
    leaf(P, 14, -32, 9, 4, 48, DRY); leaf(P, 16, -35, 6, 7, 30, DRY);
    return;
  }
  if (state === 'wilting') { // POC p-wilting: drooped head, still green
    stem(P, 'M0,-1 C0,-16 12,-24 19,-17', DRY);
    leaf(P, -12, -12, 11, 4.6, -52, DRY); leaf(P, 10, -19, 11, 4.6, 58, DRY);
    leaf(P, 21, -14, 6.4, 8, 64, DRY); P.ell(25, -11, 5, 3.4, DRY.l, .5, 0, 78);
    return;
  }
  if (state === 'harvest') { // POC p-harvest: ripe produce + soft glow
    stem(P, 'M0,-1 C0,-14 -1,-26 0,-38', LEAF);
    P.path('M0,-14 C-8,-18 -13,-22 -16,-28', null, .7, 1, LEAF.m, 2).path('M0,-18 C8,-21 13,-25 17,-30', null, .7, 2, LEAF.m, 2);
    leaf(P, -8, -32, 12, 5, -26, LEAF); leaf(P, 10, -38, 12, 5, 22, LEAF, true);
    P.ell(0, -41, 6.4, 8, LEAF.l, .5, 0).ell(0, -40, 5, 6.4, LEAF.m, .55, 2);
    fruit(P, -16, -24, 6, A.fruit); fruit(P, 17, -26, 6, A.fruit); fruit(P, 3, -12, 6, A.fruit);
    return;
  }
  if (stage === 0) { sprout(P); return; }
  if (stage === 1) {
    stem(P, 'M0,-1 C0,-10 -0.5,-18 0,-26', LEAF, 2.2);
    leaf(P, -9, -12, 10, 4.6, -26, LEAF); leaf(P, 9, -15, 10, 4.6, 22, LEAF);
    P.ell(0, -27, 5, 6.5, LEAF.l, .5, 0).ell(0, -27, 4, 5.2, LEAF.m, .55, 1);
    return;
  }
  if (stage === 2 || state === 'growing') { // POC p-growing
    stem(P, 'M0,-1 C0,-16 -1.5,-28 0,-44', LEAF);
    leaf(P, -14, -15, 13, 5.5, -24, LEAF); leaf(P, 14, -20, 13, 5.5, 20, LEAF);
    leaf(P, -11, -31, 11, 4.8, -30, LEAF, true); leaf(P, 11, -36, 11, 4.8, 26, LEAF, true);
    P.ell(0, -47, 7, 9, LEAF.l, .5, 0).ell(0, -46, 5.6, 7.4, LEAF.m, .55, 1);
    return;
  }
  // stage 3 / blooming: POC p-blooming with species-tinted petals
  stem(P, 'M0,-1 C0,-18 1,-38 -1,-58', LEAF);
  leaf(P, -15, -18, 13, 5.5, -22, LEAF); leaf(P, 15, -26, 13, 5.5, 18, LEAF, true); leaf(P, -12, -38, 10, 4.4, -28, LEAF);
  flower(P, -1, -63, 12, A.petal); flower(P, -17, -52, 9, A.petal); flower(P, 14, -55, 9, A.petal);
}

function shrub(P, sp, state, stage) {
  const A = ACCENT[sp];
  const dry = state === 'thirsty' || state === 'wilting';
  const ramp = dry ? DRY : LEAF;
  if (!dry && state !== 'harvest' && stage === 0) { sprout(P); return; }
  const r = stage <= 1 && !dry && state !== 'harvest' ? 12 : 19;
  // woody stem, then a mound of three crowns (light / mid / dark lower-right)
  P.path('M0,0 L0,-8', null, .8, 1, WOOD.m, 2.4);
  P.ell(0, -r - 2, r, r * .85, ramp.l, .5, 0).ell(-r * .6, -r * .7, r * .62, r * .5, ramp.l, .5, 0).ell(r * .6, -r * .7, r * .62, r * .5, ramp.l, .5, 0);
  P.ell(-r * .2, -r - 3, r * .8, r * .68, ramp.m, .55, 1).ell(r * .55, -r * .72, r * .5, r * .4, ramp.m, .55, 1);
  P.ell(r * .35, -r * .75, r * .55, r * .36, ramp.d, .45, 2);
  if (dry) { // a couple of hanging leaves, slightly see-through: wilted, not gone
    leaf(P, -r - 3, -r * .55, 6, 3, 62, DRY); leaf(P, r + 2, -r * .45, 6, 3, -66, DRY);
    if (state === 'wilting') leaf(P, 2, -4, 6, 3, 80, DRY);
    return;
  }
  if (stage === 3 || state === 'blooming' || state === 'harvest') {
    const pts = [[-10, -r - 12], [0, -r - 15], [10, -r - 12], [-5, -r - 5], [6, -r - 6]];
    if (sp === 'lavender') for (const [x, y] of pts) P.ell(x, y - 3, 2.2, 7, A.petal.m, .6, 1).ell(x, y - 4, 1.4, 5, A.petal.c, .55, 2);
    else for (const [x, y] of pts) P.circ(x, y, 3.2, A.petal.l, .6, 0).circ(x, y, 2.2, A.petal.m, .65, 1).circ(x, y, 1, A.petal.c, .7, 2);
    if (state === 'harvest') for (const [x, y] of [[-12, -r + 2], [12, -r], [0, -r - 10]]) P.raw(`<circle class="glow" cx="${x}" cy="${y}" r="10" fill="var(--g-glow)"/>`);
  }
}

function fruitTree(P, sp, state, stage) {
  const A = ACCENT[sp];
  const dry = state === 'thirsty' || state === 'wilting';
  const ramp = dry ? DRY : LEAF;
  const st = dry ? 2 : Math.max(stage, state === 'harvest' || state === 'blooming' ? 3 : stage);
  const th = 10 + st * 5, cr = 7 + st * 4;
  P.path(`M-1.6,0 L1.6,0 L1.2,${-th} L-1.2,${-th} Z`, WOOD.m, .7, 0).path(`M-0.9,0 L0.9,0 L0.7,${-th} L-0.7,${-th} Z`, WOOD.d, .6, 2);
  if (st === 0) { leaf(P, -5, -th - 2, 5, 2.6, -30, ramp); leaf(P, 5, -th - 4, 5, 2.6, 30, ramp); return; }
  const cy = -th - cr * .8;
  P.ell(0, cy, cr, cr * .9, ramp.l, .5, 0).ell(-cr * .55, cy + cr * .3, cr * .6, cr * .55, ramp.l, .5, 0).ell(cr * .55, cy + cr * .25, cr * .6, cr * .55, ramp.l, .5, 0);
  P.ell(-cr * .15, cy - cr * .05, cr * .8, cr * .7, ramp.m, .55, 1).ell(cr * .45, cy + cr * .3, cr * .55, cr * .45, ramp.m, .5, 1);
  P.ell(cr * .35, cy + cr * .35, cr * .55, cr * .4, ramp.d, .45, 2);
  if (dry) { leaf(P, -cr - 2, cy + cr * .5, 6, 3, 64, DRY); leaf(P, cr + 1, cy + cr * .6, 6, 3, -70, DRY); if (state === 'wilting') leaf(P, 0, cy + cr * 1.05, 6, 3, 88, DRY); return; }
  if (state === 'blooming' && st >= 2) {
    for (const [x, y] of [[-cr * .5, cy - cr * .2], [cr * .3, cy - cr * .6], [0, cy + cr * .2], [cr * .65, cy + cr * .1], [-cr * .2, cy - cr * .7]]) P.circ(x, y, 2.6, A.petal.l, .75, 0).circ(x, y, 1.6, A.petal.m, .7, 1).circ(x, y, .7, A.petal.c, .7, 2);
  }
  if (st === 3 && state !== 'blooming') {
    const pts = [[-cr * .5, cy + cr * .1], [cr * .45, cy - cr * .35], [0, cy + cr * .45], [cr * .65, cy + cr * .3]];
    for (const [x, y] of pts) {
      if (sp === 'cherry') { fruit(P, x - 2, y, 1.9, A.fruit, state === 'harvest'); fruit(P, x + 2.2, y + 1, 1.9, A.fruit, false); }
      else if (sp === 'pear') { P.ell(x, y, 2.6, 3.4, A.fruit.l, .6, 0).ell(x, y + .4, 2.1, 2.8, A.fruit.d, .7, 1); if (state === 'harvest') P.raw(`<circle class="glow" cx="${n1(x)}" cy="${n1(y)}" r="6" fill="var(--g-glow)"/>`); }
      else fruit(P, x, y, 2.9, A.fruit, state === 'harvest');
    }
  }
}

function evergreen(P, sp, state, stage) {
  const A = ACCENT[sp];
  const dry = state === 'thirsty' || state === 'wilting';
  const ramp = dry ? DRY : LEAF;
  const st = dry ? 2 : Math.max(stage, state === 'harvest' || state === 'blooming' ? 3 : stage);
  const tiers = st === 0 ? 1 : st === 1 ? 2 : 3;
  const h = 16 + st * 12, w = 10 + st * 5;
  P.rect(-1.6, -6, 3.2, 6, WOOD.m, .75, 1);
  for (let t = 0; t < tiers; t++) {
    const y0 = -5 - (h / tiers) * t, tw = w * (1 - t * .22), tierH = (h / tiers) * 1.35;
    const d = `M${n1(-tw)},${n1(y0)} Q0,${n1(y0 + 2)} ${n1(tw)},${n1(y0)} L0,${n1(y0 - tierH)} Z`;
    P.path(d, ramp.l, .5, 0);
    P.path(`M${n1(-tw * .8)},${n1(y0 - 1)} Q0,${n1(y0 + 1)} ${n1(tw * .8)},${n1(y0 - 1)} L0,${n1(y0 - tierH * .9)} Z`, ramp.m, .55, 1);
    P.path(`M0,${n1(y0 - 1)} L${n1(tw * .75)},${n1(y0 - 1)} L0,${n1(y0 - tierH * .85)} Z`, ramp.d, .4, 2);
  }
  if (dry) { leaf(P, -w - 1, -8, 6, 3, 64, DRY); leaf(P, w + 1, -10, 6, 3, -68, DRY); return; }
  if (st === 3) { // cones (juniper: berries); harvest adds the glow
    const pts = [[-w * .45, -h * .45], [w * .4, -h * .6], [0, -h * .95]];
    for (const [x, y] of pts) {
      if (state === 'harvest') P.raw(`<circle class="glow" cx="${n1(x)}" cy="${n1(y)}" r="7" fill="var(--g-glow)"/>`);
      if (sp === 'juniper') P.circ(x, y, 2.2, A.cone.l, .7, 0).circ(x, y, 1.5, A.cone.d, .7, 2);
      else P.ell(x, y, 2, 3.2, A.cone.l, .7, 0).ell(x, y + .4, 1.4, 2.4, A.cone.d, .7, 2);
    }
  }
}

// Symbol id for a plant: family + species + state + stage (only what the drawing depends on).
function symbolId(p) {
  const stage = (p.state === 'growing' || p.state === 'planted') ? p.stage : 0;
  return `p-${p.family}-${p.species}-${p.state}-${stage}`;
}
function symbolMarkup(p, id) {
  const P = new Painter((hashName(p.species) + p.stage) % 3);
  mound(P);
  if (p.family === 'rowcrop') rowcrop(P, p.species, p.state, p.stage);
  else if (p.family === 'fruit') fruitTree(P, p.species, p.state, p.stage);
  else if (p.family === 'evergreen') evergreen(P, p.species, p.state, p.stage);
  else shrub(P, p.species, p.state, p.stage);
  return `<symbol id="${id}" overflow="visible">${P.emit()}</symbol>`;
}

// One plant instance: outer positioning <g> (attribute transform), inner
// groups for the CSS state lean / sway (.body) and the hover lift (.lift).
export function plantMarkup(p, x, y, scale, opts = {}) {
  const id = symbolId(p);
  const cls = ['plant', `st-${p.state}`, `fam-${p.family}`, opts.sway ? 'sway' : '', opts.changed ? `was-${opts.changed}` : ''].filter(Boolean).join(' ');
  return `<g class="${cls}" data-plant="${p.ci}:${p.fi}" transform="translate(${n1(x)},${n1(y)}) scale(${scale})" tabindex="0" role="button" aria-label="${esc(p.fund)} — ${esc(p.phrase || p.state)}">
    <rect class="hit" x="-28" y="-76" width="56" height="84" fill="transparent"/>
    <g class="body"><g class="lift"><use href="#${id}"/></g></g></g>`;
}

// A LIVE SPRITE: one plant in its own small <svg>, positioned by percent of
// the scene so it lines up with the bitmap underneath. Used for the hovered
// plant (lift), changed plants (was-* transition), harvest glow and sway.
// viewBox is in scene units so the drawing scale matches the bitmap exactly.
export function plantSprite(entry, sceneHeight, cls = '') {
  const { p, x, y, scale } = entry;
  const bw = 64 * scale, bh = 94 * scale;
  const id = symbolId(p);
  const pct = (v, of) => n1((v / of) * 100);
  const classes = ['plant', `st-${p.state}`, `fam-${p.family}`, cls].filter(Boolean).join(' ');
  return `<svg class="garden-live" data-live="${p.ci}:${p.fi}" viewBox="0 0 ${n1(bw)} ${n1(bh)}" style="left:${pct(x - 32 * scale, W)}%;top:${pct(y - 82 * scale, sceneHeight)}%;width:${pct(bw, W)}%" aria-hidden="true">
    <defs>${filterDefs()}${symbolMarkup(p, id)}</defs>
    <g transform="translate(${n1(32 * scale)},${n1(82 * scale)}) scale(${scale})"><g class="${classes}"><g class="body"><g class="lift"><use href="#${id}"/></g></g></g></g></svg>`;
}

/* ---------- fixtures (each a few wash groups, never per-element filters) ---------- */
function tree(size) {
  if (!size) return '';
  const P = new Painter(1);
  const th = 18 + size * 10, cr = 14 + size * 7, x = 92, y = HORIZON + 2;
  P.path(`M${x - 4},${y} L${x + 4},${y} L${x + 3},${y - th} L${x - 3},${y - th} Z`, WOOD.m, .7, 0).path(`M${x - 2},${y} L${x + 1.5},${y} L${x + 1.5},${y - th} L${x - 1.5},${y - th} Z`, WOOD.d, .6, 2);
  const cy = y - th - cr * .7;
  P.ell(x, cy, cr, cr * .8, LEAF.l, .5, 0).ell(x - cr * .6, cy + cr * .3, cr * .65, cr * .55, LEAF.l, .5, 0).ell(x + cr * .6, cy + cr * .25, cr * .65, cr * .55, LEAF.l, .5, 0);
  P.ell(x - cr * .15, cy, cr * .8, cr * .65, LEAF.m, .55, 1).ell(x + cr * .5, cy + cr * .3, cr * .55, cr * .45, LEAF.m, .5, 1);
  P.ell(x + cr * .35, cy + cr * .35, cr * .6, cr * .4, LEAF.d, .45, 2);
  if (size >= 4) P.ell(x, cy - cr * .55, cr * .7, cr * .5, LEAF.l, .5, 0);
  return `<g class="fx fx-tree"><title>The border tree — it grows a size every few months you close.</title>${P.emit()}</g>`;
}
function wall(stones) {
  if (!stones) return '';
  const P = new Painter(2);
  const perRow = 15, sw = 22, sh = 11, x0 = 630, y0 = HORIZON - 4;
  const shown = Math.min(stones, perRow * 3);
  for (let i = 0; i < shown; i++) {
    const row = Math.floor(i / perRow), col = i % perRow;
    const x = x0 + col * (sw + 2) + (row % 2 ? sw / 2 : 0), y = y0 - row * (sh + 2);
    P.rect(x, y, sw, sh, STONE.l, .6, 0, 3).rect(x + 2, y + 2, sw - 4, sh - 3, STONE.m, .45, 1, 2).rect(x + 3, y + sh - 4, sw - 5, 3, STONE.d, .35, 2, 1.5);
  }
  return `<g class="fx fx-wall"><title>The garden wall — ${stones} stone${stones === 1 ? '' : 's'}, one for every new high in what you manage. Stones are never taken away.</title>${P.emit()}${
    stones > shown ? `<text x="${x0 + perRow * (sw + 2) + 4}" y="${y0 + 9}" class="g-label">+${stones - shown}</text>` : ''}</g>`;
}
function fence() {
  const P = new Painter(0);
  for (let x = 190; x <= 440; x += 18) P.path(`M${x},${HORIZON + 4} v-20 l4,-5 l4,5 v20 z`, WOOD.l, .75, 0).path(`M${x + 5},${HORIZON + 3} v-21`, null, .5, 2, WOOD.d, 1.2);
  P.rect(186, HORIZON - 12, 266, 3, WOOD.m, .8, 1).rect(186, HORIZON - 2, 266, 3, WOOD.m, .8, 1);
  return `<g class="fx fx-fence"><title>The picket fence — six months tended.</title>${P.emit()}</g>`;
}
function arbor() {
  const P = new Painter(1), x = 520, y = HORIZON;
  P.rect(x - 26, y - 42, 4, 46, WOOD.m, .8, 1).rect(x + 22, y - 42, 4, 46, WOOD.m, .8, 1);
  P.path(`M${x - 28},${y - 40} Q${x},${y - 66} ${x + 28},${y - 40}`, null, .8, 1, WOOD.m, 4);
  P.ell(x - 22, y - 44, 8, 5.5, LEAF.l, .5, 0).ell(x + 20, y - 50, 8, 5.5, LEAF.l, .5, 0).ell(x - 4, y - 56, 7, 4.6, LEAF.l, .5, 0);
  P.ell(x - 21, y - 44, 6.5, 4.4, LEAF.m, .55, 2).ell(x + 19, y - 50, 6.5, 4.4, LEAF.m, .55, 2);
  P.circ(x - 14, y - 48, 2.4, '#d37fb3', .7, 0).circ(x + 10, y - 55, 2.4, '#d37fb3', .7, 0);
  return `<g class="fx fx-arbor"><title>The arbor — a year tended.</title>${P.emit()}</g>`;
}
function pond() {
  const P = new Painter(2), x = 880, y = HORIZON + 26;
  P.ell(x, y, 58, 15, SOIL.l, .5, 0).ell(x, y, 50, 11, 'var(--g-water-l)', .6, 0).ell(x + 4, y + 1, 40, 8, 'var(--g-water-m)', .5, 1).ell(x + 10, y + 2, 22, 4.5, 'var(--g-water-d)', .4, 2);
  P.ell(x - 14, y - 3, 9, 2.2, '#ffffff', .6, 1);
  P.ell(x + 24, y + 2, 6, 2.6, LEAF.l, .6, 0).ell(x - 28, y + 4, 5, 2.1, LEAF.l, .6, 0).ell(x + 24, y + 2, 4.5, 1.9, LEAF.m, .55, 2);
  return `<g class="fx fx-pond"><title>The pond — eighteen months tended.</title>${P.emit()}</g>`;
}
function hive() {
  const P = new Painter(0), x = 196, y = HORIZON + 2;
  for (let i = 0; i < 4; i++) P.ell(x, y - 4 - i * 6, 12 - i * 1.8, 4, '#e2b85a', .6, 0).ell(x + 1, y - 4 - i * 6, 10 - i * 1.8, 3, '#c9953a', .55, 1);
  P.rect(x - 2, y - 8, 4, 3, WOOD.d, .8, 2);
  P.circ(x + 16, y - 16, 1.4, '#3a2d14', .8, 2).circ(x + 22, y - 22, 1.4, '#3a2d14', .8, 2);
  return `<g class="fx fx-hive"><title>The bee hive — two years tended.</title>${P.emit()}</g>`;
}
function pathBand(height) {
  const P = new Painter(1), x = W / 2;
  const d = `M${x - 10},${height} C${x + 40},${height - 200} ${x - 50},${HORIZON + 140} ${x},${HORIZON + 8}`;
  P.path(d, null, .7, 0, 'var(--g-path-l)', 32).path(d, null, .45, 1, 'var(--g-path-m)', 22);
  return `<g class="fx fx-path"><title>The garden path — three months tended.</title>${P.emit()}</g>`;
}

/* ---------- bed sign: the scene's readable text is plain budget vocabulary ---------- */
function sign(x, y, text, P) {
  const w = Math.min(170, Math.max(44, text.length * 6.6 + 16));
  P.rect(x + w / 2 - 2, y + 18, 4, 14, WOOD.d, .8, 2);
  P.rect(x, y, w, 22, WOOD.l, .85, 0, 4).rect(x + 2, y + 2, w - 4, 18, WOOD.m, .7, 1, 3);
  return `<text x="${n1(x + w / 2)}" y="${y + 15}" class="g-sign-text" text-anchor="middle">${esc(text)}</text>`;
}

/* ---------- weeds = unassigned transactions (the words stay budget words) ---------- */
function weedsMarkup(n, y) {
  if (!n) return '';
  const P = new Painter(0);
  const shown = Math.min(n, 8);
  for (let i = 0; i < shown; i++) {
    const x = 960 - i * 30 - (i % 2) * 6;
    for (let k = 0; k < 5; k++) {
      const a = -36 + k * 18, rad = (a * Math.PI) / 180, len = 16;
      P.ell(x + Math.sin(rad) * len / 2, y - Math.cos(rad) * len / 2, 1.8, len / 2, k % 2 ? 'var(--g-weed-l)' : 'var(--g-weed-m)', .65, k % 2, a);
    }
    P.circ(x, y - 17, 2.8, '#f0e7a8', .8, 2);
  }
  const label = `${n} unassigned →`;
  return `<g class="weeds" data-weeds="1" tabindex="0" role="button" aria-label="Review ${n} unassigned"><title>${n} transaction${n === 1 ? '' : 's'} with no fund yet — click to review them.</title>
    <rect x="700" y="${y - 34}" width="290" height="42" fill="transparent"/>${P.emit()}
    <text x="694" y="${y - 6}" class="g-label" text-anchor="end">${esc(label)}</text></g>`;
}

/* ---------- sky, ground, foreground ---------- */
function skyMarkup(height) {
  const P = new Painter(0);
  // washes, not gradients: two sky bands, sun, clouds, two hill lines, ground
  P.rect(-10, -10, W + 20, HORIZON + 20, 'var(--g-sky-1)', .6, 0);
  P.rect(-10, HORIZON - 66, W + 20, 76, 'var(--g-sky-2)', .5, 1);
  P.circ(862, 52, 24, 'var(--g-sun)', .5, 2).circ(860, 50, 17, 'var(--g-sun)', .45, 1);
  for (const [cx, cy, s] of [[300, 54, 1], [700, 90, .7]]) {
    P.ell(cx, cy, 38 * s, 12 * s, '#ffffff', .7, 0).ell(cx + 26 * s, cy - 8 * s, 26 * s, 13 * s, '#ffffff', .7, 0).ell(cx - 20 * s, cy + 4 * s, 22 * s, 10 * s, '#ffffff', .65, 1);
  }
  P.path(`M-10,${HORIZON - 30} Q160,${HORIZON - 76} 330,${HORIZON - 34} T810,${HORIZON - 40} T1010,${HORIZON - 32} L1010,${HORIZON + 10} L-10,${HORIZON + 10} Z`, 'var(--g-hill-1)', .5, 2);
  P.path(`M-10,${HORIZON - 18} Q240,${HORIZON - 54} 470,${HORIZON - 22} T810,${HORIZON - 26} T1010,${HORIZON - 20} L1010,${HORIZON + 12} L-10,${HORIZON + 12} Z`, 'var(--g-hill-2)', .5, 1);
  P.rect(-10, HORIZON, W + 20, height - HORIZON + 10, 'var(--g-grass-1)', .55, 0);
  P.rect(-10, HORIZON + 14, W + 20, height - HORIZON, 'var(--g-grass-2)', .35, 1);
  return P.emit();
}
function foreground(height) {
  const P = new Painter(2);
  for (let x = 30; x < 640; x += 74) {
    for (let k = 0; k < 4; k++) {
      const a = -30 + k * 20, rad = (a * Math.PI) / 180, len = 14 + (k % 2) * 4;
      P.ell(x + Math.sin(rad) * len / 2, height - 6 - Math.cos(rad) * len / 2, 1.6, len / 2, k % 2 ? 'var(--g-grass-3)' : 'var(--g-grass-2)', .6, k % 2, a);
    }
  }
  return `<g class="fg">${P.emit()}</g>`;
}

/* ---------- ambient accents (≤3 concurrently animated; CSS-only motion) ---------- */
export function butterflySymbol() {
  return `<g id="butterfly">
      <ellipse class="wc3" cx="-4" cy="0" rx="5" ry="3.4" fill="#d9a53f" opacity=".7" transform="rotate(-24)"/>
      <ellipse class="wc1" cx="4" cy="0" rx="5" ry="3.4" fill="#b8543a" opacity=".6" transform="rotate(24)"/>
      <ellipse cx="0" cy="0" rx="1.2" ry="3" fill="#5a4632" opacity=".8"/>
    </g>`;
}
// Static fallen leaves (lean season) — drawn in the foreground layer.
function fallenLeaves(state, height) {
  if (state.season.kind !== 'lean') return '';
  const fallen = [[64, HORIZON + LAWN_H + 6], [590, height - 22], [330, HORIZON + LAWN_H + 10]]
    .map(([fx, fy], i) => `<ellipse cx="${fx}" cy="${fy}" rx="5" ry="2.6" fill="#c8873a" opacity=".6" transform="rotate(${20 + i * 35} ${fx} ${fy})"/>`).join('');
  return `<g class="fallen wc3">${fallen}</g>`;
}
// The animated accent is a SPRITE: its own small <svg>, positioned by percent
// of the scene so it scales with it. PERF: Chrome repaints an inline SVG's
// whole area when a descendant animates, so the sprite is only as big as the
// flight path (measured: a scene-sized ambient layer idled at 1.7 cores; a
// sprite is ~free). Deterministic placement: hash the month id; sky band only.
// Sprite symbols besides the butterfly (all procedural, tiny).
function beeSymbol() {
  return `<g id="bee">
      <ellipse class="wc3" cx="0" cy="-3" rx="3.2" ry="1.8" fill="#e8eef5" opacity=".7"/>
      <ellipse class="wc1" cx="0" cy="0" rx="3.4" ry="2.3" fill="#e0b23a" opacity=".85"/>
      <rect x="-1.1" y="-2.2" width="1.2" height="4.4" rx=".5" fill="#3a2d14" opacity=".8"/>
      <rect x="1.1" y="-2" width="1" height="4" rx=".5" fill="#3a2d14" opacity=".8"/>
    </g>`;
}
function fireflySymbol() {
  return `<g id="firefly">
      <circle cx="0" cy="0" r="6" fill="#f4e39a" opacity=".35"/>
      <circle cx="0" cy="0" r="2.6" fill="#fbf0b8" opacity=".8"/>
      <circle cx="0" cy="0" r="1.1" fill="#fff9dc"/>
    </g>`;
}
// AMBIENT LIFE (§4): ≤ 3 concurrently animated elements, CSS keyframes only,
// slow loops, sky and background bands only — never over message cards,
// tooltips or the status line, never attached to a plant the user must read.
// The pool is picked deterministically from the season, the time of day and
// a hash of the month id (no Math.random at render):
//   growing → butterfly and/or a bee near the blooms
//   steady  → butterfly only
//   lean    → one slowly falling leaf over static fallen ones
//   evening → the butterfly's slot becomes a single drifting firefly glow
// Each accent is its OWN small <svg> sprite with the animation class on the
// element itself (compositor thread — see the PERF note above).
export function ambientPlan(state, { tod = 'midday', placed = [] } = {}) {
  const h = hashName(state.monthId);
  const evening = tod === 'evening';
  const out = [];
  if (state.season.kind === 'lean') { out.push({ kind: 'leaf' }); return out; }
  out.push({ kind: evening ? 'firefly' : 'butterfly' });
  if (state.season.kind === 'growing' && (h & 0x40) && placed.some((e) => e.p.state === 'blooming')) out.push({ kind: 'bee' });
  return out.slice(0, 3);
}
function ambientSprite(state, height, opts = {}) {
  const h = hashName(state.monthId);
  const x = 120 + (h % 560), y = 56 + ((h >> 8) % 50);
  const pct = (v, of) => n1((v / of) * 100);
  const sprite = (cls, bw, bh, left, top, inner) =>
    `<svg class="garden-ambient ${cls}" viewBox="0 0 ${bw} ${bh}" style="left:${pct(left, W)}%;top:${pct(top, height)}%;width:${pct(bw, W)}%" aria-hidden="true">${inner}</svg>`;
  let out = '';
  for (const a of ambientPlan(state, opts)) {
    if (a.kind === 'leaf') {
      out += sprite('leaf-fall', 90, 200, x - 70, 24, `<g transform="translate(75,6)"><ellipse cx="0" cy="0" rx="5" ry="2.6" fill="#c8873a" opacity=".75"/></g>`);
    } else if (a.kind === 'butterfly') {
      out += sprite('flutter', 90, 40, x - 12, y - 22, `<defs>${butterflySymbol()}</defs><g transform="translate(12,22)"><use href="#butterfly"/></g>`);
    } else if (a.kind === 'firefly') {
      out += sprite('firefly', 80, 50, x - 10, y - 30, `<defs>${fireflySymbol()}</defs><g transform="translate(10,26)"><use href="#firefly"/></g>`);
    } else if (a.kind === 'bee') {
      // near the blooms: the lawn band just above the first bed row, on the
      // side of the first blooming plant — never over a plant itself
      const first = (opts.placed || []).find((e) => e.p.state === 'blooming');
      const bx = Math.min(W - 120, Math.max(40, (first ? first.x : 300) + 30 + ((h >> 4) % 40)));
      out += sprite('bee-loop', 60, 30, bx, HORIZON + 6, `<defs>${beeSymbol()}</defs><g transform="translate(10,15)"><use href="#bee"/></g>`);
    }
  }
  return out;
}

// The HIT LAYER for bitmap mode: transparent, focusable targets over the
// canvas — plants, "+N" signs, weeds — carrying the same data-* hooks and
// accessible names as the live markup, so renderGarden's handlers are shared.
function hitLayer(hits, height, label) {
  const rects = hits.map((h) => {
    const attrs = h.kind === 'plant' ? `data-plant="${h.key}"` : h.kind === 'more' ? `data-more="${h.ci}"` : 'data-weeds="1"';
    return `<g ${attrs} tabindex="0" role="button" aria-label="${esc(h.label)}">${h.title ? `<title>${esc(h.title)}</title>` : ''}<rect class="hit" x="${n1(h.x)}" y="${n1(h.y)}" width="${n1(h.w)}" height="${n1(h.h)}" rx="6"/></g>`;
  }).join('');
  return `<svg class="garden-svg garden-hit" viewBox="0 0 ${W} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Your garden for ${esc(label)}">${rects}</svg>`;
}

/**
 * @param {object} state  gardenState(...)
 * @param {object} opts   { monthLabel, labels, money, changed: Map<'ci:fi', prevState>, sway: number,
 *                          tod: 'morning'|'midday'|'golden'|'evening',
 *                          bitmap: boolean, palette: {token: colour}, skip: Set<'ci:fi'> }
 * @returns live:   {{ svg, bg, fg, ambient, height, symbols, placed, hits }}   svg = bg + fg + ambient
 *          bitmap: {{ svg, hit, ambient, height, symbols, placed, hits }}      svg = one self-contained SVG
 */
export function sceneSvg(state, opts = {}) {
  // The cap is what the beds physically fit: beds beyond four go two-up, each
  // bed holds as many plants as its width allows at a readable spacing, and
  // the whole scene never exceeds the ceiling. Anything over shows as "+N".
  const liveBeds = state.beds.filter((b) => b.plants.length);
  const twoCol = liveBeds.length > 4;
  const cols = twoCol ? 2 : 1;
  const colW = twoCol ? (W - 40 - 30) / 2 : W - 40;
  const perBed = Math.max(1, Math.floor((colW - 28 - 54) / PLANT_MIN_GAP));
  const beds = layoutBeds(state.beds, Math.min(SCENE_PLANT_CEILING, perBed * Math.max(1, liveBeds.length)), perBed);
  const rows = Math.ceil(beds.length / cols);
  const bedsTop = HORIZON + LAWN_H;
  const height = bedsTop + Math.max(1, rows) * BED_H + EDGE_H;
  const fx = state.maturity.fixtures;
  const money = opts.money || ((n) => '$' + Math.abs(n).toFixed(2));
  const symbols = new Map();
  const swayBudget = opts.sway ?? 6;
  let swayed = 0;
  const placed = [];   // every visible plant: { key, p, x, y, scale, sway, changed }
  const hits = [];     // click/hover targets for the hit layer
  const skip = opts.skip || null;

  let body = '';
  beds.forEach((bed, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const bx = 20 + col * (colW + 30), by = bedsTop + row * BED_H;
    const soilY = by + SOIL_Y;
    const n = bed.visible.length;
    const px0 = bx + 14, pw = colW - 28 - (bed.hidden ? 54 : 0);
    const gap = Math.max(PLANT_MIN_GAP, pw / Math.max(1, n));
    const startX = px0 + Math.max(0, (pw - gap * n) / 2) + gap / 2;
    const P = new Painter(i % 3);
    // soil bed: three washes, rounded ends, a lighter crumb strip on top
    P.rect(bx, soilY - 8, colW, 30, SOIL.l, .55, 0, 14).rect(bx + 6, soilY - 4, colW - 12, 22, SOIL.m, .5, 1, 11).rect(bx + 12, soilY + 6, colW - 24, 10, SOIL.d, .35, 2, 5);
    const signText = sign(bx + 6, by + 4, bed.category, P);
    body += `<g class="bed" data-bed="${bed.ci}">${P.emit()}${signText}`;
    bed.visible.forEach((p, k) => {
      const id = symbolId(p);
      if (!symbols.has(id)) symbols.set(id, symbolMarkup(p, id));
      const sway = p.state === 'blooming' && swayed < swayBudget && ++swayed > 0;
      const changed = opts.changed && opts.changed.get(`${p.ci}:${p.fi}`);
      const x = startX + k * gap;
      const scale = n1(PLANT_SCALE * (FAMILY_SCALE[p.family] || 1));
      const key = `${p.ci}:${p.fi}`;
      placed.push({ key, p, x: n1(x), y: soilY, scale, sway, changed: changed && changed !== p.state ? changed : '' });
      hits.push({ kind: 'plant', key, x: x - 32 * scale, y: soilY - 82 * scale, w: 64 * scale, h: 94 * scale, label: `${p.fund} — ${p.phrase || p.state}` });
      if (!skip || !skip.has(key)) body += plantMarkup(p, x, soilY, scale, { sway, changed: changed && changed !== p.state ? changed : '' });
      if (opts.labels) {
        body += `<text class="g-plant-label" x="${n1(x)}" y="${soilY + 14}" text-anchor="middle">${esc(p.fund.length > 12 ? p.fund.slice(0, 11).trimEnd() + '…' : p.fund)}</text>
          <text class="g-plant-label num ${p.leftover < -0.004 ? 'neg' : ''}" x="${n1(x)}" y="${soilY + 25}" text-anchor="middle">${esc(money(p.leftover))}${p.leftover < -0.004 ? ' over' : ' left'}</text>`;
      }
    });
    if (bed.hidden) {
      const sx = bx + colW - 46, sy = soilY - 34, Q = new Painter(2);
      Q.rect(sx + 18, sy + 18, 3, 14, WOOD.d, .8, 2).rect(sx, sy, 40, 20, WOOD.l, .85, 0, 3).rect(sx + 2, sy + 2, 36, 16, WOOD.m, .7, 1, 2);
      hits.push({ kind: 'more', ci: bed.ci, x: sx - 4, y: sy - 4, w: 48, h: 40, label: `${bed.hidden} more funds in ${bed.category} — open Budget`, title: `${bed.hidden} more fund${bed.hidden === 1 ? '' : 's'} in ${bed.category} — click to see them all in Budget.` });
      body += `<g class="more-sign" data-more="${bed.ci}" tabindex="0" role="button" aria-label="${bed.hidden} more funds in ${esc(bed.category)} — open Budget"><title>${bed.hidden} more fund${bed.hidden === 1 ? '' : 's'} in ${esc(bed.category)} — click to see them all in Budget.</title>
        ${Q.emit()}<text x="${sx + 20}" y="${sy + 14}" class="g-sign-text" text-anchor="middle">+${bed.hidden}</text></g>`;
    }
    body += `</g>`;
  });
  if (!beds.length) {
    body += `<text x="${W / 2}" y="${bedsTop + 48}" class="g-label" text-anchor="middle">No beds yet — add a category and a fund or two on the Budget page, and they'll show up here.</text>`;
  }

  // Three stacked SVGs. PERF (measured on the packaged build): any animation
  // frame repaints the damaged region, and Chrome re-runs every SVG filter
  // that intersects it — including the full-scene paper grain and the big sky
  // washes. So everything static and large lives in a BACKGROUND layer that
  // is promoted to its own compositor layer (CSS will-change) and never
  // repaints; beds, plants, weeds and the ambient accents live in the
  // FOREGROUND layer, whose repaints only touch small filter regions. The
  // defs (filters + symbols) live once, in the foreground; url(#…) and
  // <use href> resolve document-wide.
  const viewBox = `viewBox="0 0 ${W} ${height}" xmlns="http://www.w3.org/2000/svg"`;
  let bg = `<svg class="garden-svg garden-bg" ${viewBox} aria-hidden="true">
    <rect class="paper" x="0" y="0" width="${W}" height="${height}" fill="var(--g-paper)" filter="url(#paper)"/>
    ${skyMarkup(height)}
    <rect class="season-light" x="0" y="0" width="${W}" height="${height}" fill="var(--g-light)" opacity="var(--g-light-op)"/>`;
  if (fx.includes('path')) bg += pathBand(height - EDGE_H + 10);
  bg += tree(state.maturity.treeSize);
  if (fx.includes('hive')) bg += hive();
  if (fx.includes('fence')) bg += fence();
  if (fx.includes('arbor')) bg += arbor();
  bg += wall(state.maturity.stones);
  if (fx.includes('pond')) bg += pond();
  bg += `</svg>`;
  let fg = `<svg class="garden-svg garden-fg" ${viewBox} role="img" aria-label="Your garden for ${esc(opts.monthLabel || state.monthId)}">
    <defs>${filterDefs()}${[...symbols.values()].join('')}</defs>`;
  if (state.weeds) hits.push({ kind: 'weeds', x: 700, y: height - 48, w: 290, h: 42, label: `Review ${state.weeds} unassigned`, title: `${state.weeds} transaction${state.weeds === 1 ? '' : 's'} with no fund yet — click to review them.` });
  const ambient = ambientSprite(state, height, { tod: opts.tod, placed });

  if (opts.bitmap) {
    // One self-contained document: inline styles, defs, then every static layer.
    let one = `<svg ${viewBox} width="${W}" height="${height}">${sceneStyle()}<defs>${filterDefs()}${[...symbols.values()].join('')}</defs>`;
    one += bg.slice(bg.indexOf('>') + 1, bg.lastIndexOf('</svg>'));
    one += body + weedsMarkup(state.weeds, height - 14) + fallenLeaves(state, height) + foreground(height) + '</svg>';
    const svg = applyPalette(one, opts.palette);
    return { svg, hit: hitLayer(hits, height, opts.monthLabel || state.monthId), ambient, height, symbols: symbols.size, placed, hits };
  }

  fg += body;
  fg += weedsMarkup(state.weeds, height - 14);
  fg += fallenLeaves(state, height);
  fg += foreground(height);
  fg += `</svg>`;
  return { svg: bg + fg + ambient, bg, fg, ambient, height, symbols: symbols.size, placed, hits };
}

// A small keepsake strip (first-run intro, month-close vignette): a soil line
// with a few plants in their best states. Same symbols, same defs.
export function stripSvg(plants, { width = 320, height = 96 } = {}) {
  const symbols = new Map();
  let s = '';
  const gap = (width - 40) / Math.max(1, plants.length);
  plants.forEach((p, i) => {
    const id = symbolId(p);
    if (!symbols.has(id)) symbols.set(id, symbolMarkup(p, id));
    s += `<g class="plant st-${p.state}" transform="translate(${n1(20 + gap * (i + .5))},${height - 18}) scale(${n1(.92 * (FAMILY_SCALE[p.family] || 1))})"><g class="body"><use href="#${id}"/></g></g>`;
  });
  const P = new Painter(1);
  P.rect(8, height - 24, width - 16, 18, SOIL.l, .55, 0, 9).rect(14, height - 21, width - 28, 13, SOIL.m, .5, 1, 7);
  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" class="garden-strip">
    <defs>${filterDefs()}${[...symbols.values()].join('')}</defs>
    <rect width="${width}" height="${height}" fill="var(--g-paper)" filter="url(#paper)" rx="8"/>${P.emit()}${s}</svg>`;
}

export const GARDEN_MILESTONE_LABELS = Object.fromEntries(MATURITY_MILESTONES.map((m) => [m.id, m.label]));
