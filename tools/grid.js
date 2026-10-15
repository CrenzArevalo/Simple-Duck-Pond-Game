/**
 * grid.js — print a coarse colour map of a raw RGB24 image.
 * Usage: node tools/grid.js <raw> <w> <h>
 */
const fs = require('fs');
const [file, wS, hS] = process.argv.slice(2);
const w = parseInt(wS, 10), h = parseInt(hS, 10);
const buf = fs.readFileSync(file);

function name(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2 / 255;
  const s = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
  let hue = 0;
  if (max !== min) {
    if (max === r) hue = 60 * (((g - b) / (max - min)) % 6);
    else if (max === g) hue = 60 * ((b - r) / (max - min) + 2);
    else hue = 60 * ((r - g) / (max - min) + 4);
  }
  if (hue < 0) hue += 360;
  if (l < 0.14) return 'k';                 // black
  if (s < 0.10) return l > 0.82 ? 'W' : (l > 0.5 ? 'w' : 'x'); // white / grey / dark grey
  if (hue < 18 || hue >= 340) return 'R';
  if (hue < 45) return 'O';
  if (hue < 70) return 'Y';
  if (hue < 160) return 'G';
  if (hue < 200) return 'C';                // cyan
  if (hue < 255) return 'B';
  return 'P';
}

const counts = {};
let lines = [];
for (let y = 0; y < h; y++) {
  let row = '';
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    const r = buf[i], g = buf[i + 1], b = buf[i + 2];
    const c = name(r, g, b);
    counts[c] = (counts[c] || 0) + 1;
    row += c;
  }
  lines.push(row);
}
console.log(lines.join('\n'));
console.log('\nlegend: Y=yellow G=green C=cyan B=blue O=orange R=red P=purple W=white w=lightgrey x=grey k=black');
console.log('counts:', Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ':' + v).join(' '));
