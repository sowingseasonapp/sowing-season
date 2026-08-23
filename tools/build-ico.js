// Bundles the canvas-rendered PNGs (tools/icons/icon-*.png — rasterised from the
// watercolor mark build/icon.svg by tools/icon-export.html) into build/icon.ico.
// Windows Vista+ supports PNG-compressed ICO entries, so no BMP conversion needed.
const fs = require('fs');
const path = require('path');

const sizes = [256, 128, 64, 48, 32, 16];
const pngs = sizes.map((s) => ({
  size: s,
  data: fs.readFileSync(path.join(__dirname, 'icons', `icon-${s}.png`)),
}));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(pngs.length, 4);

const entries = [];
let offset = 6 + 16 * pngs.length;
for (const { size, data } of pngs) {
  const e = Buffer.alloc(16);
  e.writeUInt8(size === 256 ? 0 : size, 0);  // width (0 = 256)
  e.writeUInt8(size === 256 ? 0 : size, 1);  // height
  e.writeUInt8(0, 2);   // palette
  e.writeUInt8(0, 3);   // reserved
  e.writeUInt16LE(1, 4);  // planes
  e.writeUInt16LE(32, 6); // bit depth
  e.writeUInt32LE(data.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += data.length;
  entries.push(e);
}

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'icon.ico');
fs.writeFileSync(out, Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]));
console.log(`Wrote ${out} (${fs.statSync(out).size} bytes, ${pngs.length} sizes)`);
