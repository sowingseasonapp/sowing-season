// Empty-state spot illustrations (proposal-watercolor-app-wide §5). A painting
// only ever stands where content is absent — never beside live data. Static,
// max height ≈140px; the caption (in plain budget voice) is the caller's.
//
// All washes reuse the #nav-wc1..3 filters from index.html via the nw* classes
// (same-document refs; a static filtered element rasterizes once). NEVER use
// unprefixed #wc1..3 here — those ids belong to garden-scene.js's inline SVGs.
// Rule inherited from the icon set: no axis-aligned stroked paths inside a
// wash class (zero-area bbox → the filter region collapses and nothing draws).

const NS = 'xmlns="http://www.w3.org/2000/svg"';

const grassBand = (w, y) => `
  <ellipse class="nw2" cx="${w / 2}" cy="${y + 8}" rx="${w * 0.46}" ry="16" fill="#c9d9a6" opacity=".55"/>
  <ellipse class="nw1" cx="${w / 2}" cy="${y + 10}" rx="${w * 0.36}" ry="11" fill="#9fb884" opacity=".45"/>`;

const tuft = (x, y) => `
  <ellipse class="nw1" cx="${x}" cy="${y}" rx="2.4" ry="9" fill="#8aa84f" opacity=".8" transform="rotate(-14 ${x} ${y})"/>
  <ellipse class="nw3" cx="${x + 7}" cy="${y + 1}" rx="2.2" ry="7.4" fill="#6e8a50" opacity=".8" transform="rotate(18 ${x + 7} ${y + 1})"/>`;

const sprout = (x, y, s) => `
  <g transform="translate(${x},${y}) scale(${s})">
    <path class="nw1" d="M0,0 C0,-11 -1,-17 0,-24" stroke="#4a7c46" stroke-width="3" fill="none" stroke-linecap="round" opacity=".9"/>
    <ellipse class="nw2" cx="-8" cy="-24" rx="8" ry="4.2" fill="#9dc08a" opacity=".9" transform="rotate(-28 -8 -24)"/>
    <ellipse class="nw3" cx="8" cy="-26" rx="8" ry="4.2" fill="#9dc08a" opacity=".9" transform="rotate(26 8 -26)"/>
  </g>`;

// Transactions view, nothing logged yet: an empty basket on grass, one sprout.
export function spotTx() {
  return `<svg viewBox="0 0 320 140" ${NS} aria-hidden="true">
    ${grassBand(320, 108)}
    <g transform="translate(112,18) scale(0.9)">
      <path class="nw2" d="M28,56 L38,98 Q60,106 82,98 L92,56 Z" fill="#d8bd8f" opacity=".55"/>
      <path class="nw1" d="M31,58 L40,95 Q60,102 80,95 L89,58 Z" fill="#b99a6b" opacity=".95"/>
      <path class="nw3" d="M35,76 Q60,83 85,76" stroke="#8a6f4d" stroke-width="5" fill="none" opacity=".5"/>
      <path class="nw2" d="M26,55 Q60,50 94,55" stroke="#8a6f4d" stroke-width="9" fill="none" stroke-linecap="round" opacity=".9"/>
      <path class="nw1" d="M40,52 C46,24 74,24 80,52" stroke="#8a6f4d" stroke-width="6.4" fill="none" stroke-linecap="round" opacity=".9"/>
    </g>
    ${sprout(228, 112, 1.05)}
    ${tuft(66, 106)} ${tuft(258, 116)}
  </svg>`;
}

const packet = (x, y, rot, flap) => `
  <g transform="translate(${x},${y}) rotate(${rot})">
    <rect class="nw2" x="-20" y="-30" width="40" height="56" rx="6" fill="#f7f0da" opacity=".55"/>
    <rect class="nw1" x="-18" y="-28" width="36" height="52" rx="5" fill="#efe6cc" opacity=".95"/>
    <rect class="nw3" x="-18" y="-28" width="36" height="11" rx="5" fill="${flap}" opacity=".85"/>
    <path class="nw1" d="M0,14 C0,6 -1,2 0,-4" stroke="#4a7c46" stroke-width="4.6" fill="none" stroke-linecap="round" opacity=".9"/>
    <ellipse class="nw2" cx="-7" cy="-5" rx="6.4" ry="3.6" fill="#4a7c46" opacity=".9" transform="rotate(-28 -7 -5)"/>
    <ellipse class="nw3" cx="7" cy="-6" rx="6.4" ry="3.6" fill="#4a7c46" opacity=".9" transform="rotate(26 7 -6)"/>
  </g>`;

// Budget view, no funds at all yet: seed packets leaning on a bed sign.
export function spotBudget() {
  return `<svg viewBox="0 0 320 140" ${NS} aria-hidden="true">
    ${grassBand(320, 108)}
    <g transform="translate(236,58)">
      <rect class="nw1" x="-3.4" y="0" width="6.8" height="48" rx="3" fill="#8a6f4d" opacity=".9"/>
      <rect class="nw2" x="-34" y="-22" width="68" height="30" rx="6" fill="#d8bd8f" opacity=".6"/>
      <rect class="nw1" x="-31" y="-19" width="62" height="24" rx="5" fill="#b99a6b" opacity=".95"/>
    </g>
    ${packet(92, 84, -10, '#d9a53f')}
    ${packet(140, 88, 4, '#b8543a')}
    ${packet(184, 84, 12, '#4a7c46')}
    <ellipse class="nw1" cx="118" cy="122" rx="4.4" ry="3.2" fill="#8a6f4d" opacity=".9"/>
    <ellipse class="nw3" cx="206" cy="124" rx="4" ry="3" fill="#c9922f" opacity=".9"/>
    ${tuft(48, 110)}
  </svg>`;
}

// Import landing: watering can + a CSV sheet. Small — the view is all prose.
export function spotImport() {
  return `<svg viewBox="0 0 320 140" ${NS} aria-hidden="true">
    ${grassBand(320, 110)}
    <g transform="translate(96,60) scale(1.02)">
      <g transform="rotate(-16 20 20)">
        <rect class="nw2" x="-2" y="0" width="46" height="40" rx="9" fill="#d8bd8f" opacity=".5"/>
        <rect class="nw1" x="0" y="2" width="42" height="36" rx="8" fill="#8a6f4d" opacity=".9"/>
        <path class="nw2" d="M20,0 C14,-20 42,-22 46,-4" stroke="#8a6f4d" stroke-width="8" fill="none" stroke-linecap="round" opacity=".85"/>
        <path class="nw2" d="M0,10 L-22,28" stroke="#d8bd8f" stroke-width="15" stroke-linecap="round" opacity=".5"/>
        <path class="nw1" d="M0,10 L-21,27" stroke="#8a6f4d" stroke-width="9" stroke-linecap="round" opacity=".9"/>
      </g>
      <ellipse class="nw3" cx="-24" cy="46" rx="4.6" ry="6" fill="#6fa7bd" opacity=".8"/>
      <ellipse class="nw1" cx="-12" cy="58" rx="4" ry="5.4" fill="#3f7d96" opacity=".85"/>
    </g>
    <g transform="translate(196,34) rotate(6)">
      <path class="nw2" d="M0,0 H44 L64,20 V88 H0 Z" fill="#f7f0da" opacity=".55" transform="scale(0.94)"/>
      <path class="nw1" d="M2,2 H43 L61,20 V84 H2 Z" fill="#efe6cc" opacity=".95" transform="scale(0.94)"/>
      <path class="nw3" d="M43,2 L43,20 L61,20 Z" fill="#d8bd8f" opacity=".9" transform="scale(0.94)"/>
      <path class="nw3" d="M12,37 Q30,34 48,37" stroke="#5a6a4c" stroke-width="5" fill="none" stroke-linecap="round" opacity=".9"/>
      <path class="nw1" d="M12,51 Q30,48 48,51" stroke="#5a6a4c" stroke-width="5" fill="none" stroke-linecap="round" opacity=".9"/>
      <path class="nw2" d="M12,65 Q23,63 34,65" stroke="#4a7c46" stroke-width="5" fill="none" stroke-linecap="round" opacity=".9"/>
    </g>
    ${tuft(272, 116)}
  </svg>`;
}

// AUM with fewer than two snapshots: a sapling — the trend line's seed.
export function spotAum() {
  return `<svg viewBox="0 0 190 130" ${NS} aria-hidden="true">
    <ellipse class="nw2" cx="95" cy="112" rx="70" ry="13" fill="#c9d9a6" opacity=".55"/>
    <ellipse class="nw1" cx="95" cy="114" rx="52" ry="9" fill="#9fb884" opacity=".45"/>
    <path class="nw2" d="M95,108 C95,84 93,68 95,50" stroke="#e0cba3" stroke-width="10" fill="none" stroke-linecap="round" opacity=".5"/>
    <path class="nw1" d="M95,108 C95,84 93,68 95,50" stroke="#c9ad7e" stroke-width="5" fill="none" stroke-linecap="round" opacity=".9"/>
    <circle class="nw2" cx="78" cy="44" r="17" fill="#cfe0b8" opacity=".55"/>
    <circle class="nw3" cx="112" cy="42" r="17" fill="#cfe0b8" opacity=".55"/>
    <circle class="nw1" cx="95" cy="30" r="18" fill="#cfe0b8" opacity=".55"/>
    <circle class="nw1" cx="79" cy="44" r="13" fill="#9dc08a" opacity=".9"/>
    <circle class="nw2" cx="111" cy="42" r="13" fill="#9dc08a" opacity=".9"/>
    <circle class="nw3" cx="95" cy="31" r="14" fill="#9dc08a" opacity=".9"/>
    <ellipse class="nw3" cx="142" cy="108" rx="12" ry="7.4" fill="#b8ae98" opacity=".85"/>
    ${tuft(40, 104)}
  </svg>`;
}
