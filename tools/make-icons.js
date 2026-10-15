/* Generates the PWA / Android icons:
     icon-192.png            rounded "any" icon
     icon-512.png            rounded "any" icon
     icon-maskable-512.png   full-bleed, safe-zone artwork (Android adaptive icon)
     apple-touch-icon.png    full-bleed 180px (iOS)
   Run:  node tools/make-icons.js
   Pure Node (zlib) — no dependencies. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------- tiny PNG encoder (RGBA, no filtering) ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePng(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- drawing helpers ---------- */
function blend(px, w, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= w) return;
  const i = (y * w + x) * 4;
  if (i + 3 >= px.length) return;
  const ia = 1 - a;
  px[i] = Math.round(px[i] * ia + r * a);
  px[i + 1] = Math.round(px[i + 1] * ia + g * a);
  px[i + 2] = Math.round(px[i + 2] * ia + b * a);
  px[i + 3] = Math.round(px[i + 3] * ia + 255 * a);
}

function ellipse(px, w, h, cx, cy, rx, ry, color, alpha) {
  const a = alpha == null ? 1 : alpha;
  const x0 = Math.max(0, Math.floor(cx - rx)), x1 = Math.min(w - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry)), y1 = Math.min(h - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d <= 1) {
        const edge = Math.min(1, (1 - d) * 6); // soft 1px edge
        blend(px, w, x, y, color[0], color[1], color[2], a * edge);
      }
    }
  }
}

function roundedBg(px, w, h, color, radiusFrac) {
  const r = w * radiusFrac;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let inside = true;
      if (r > 0) {
        const cx = x < r ? r : (x > w - r ? w - r : x);
        const cy = y < r ? r : (y > h - r ? h - r : y);
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > r * r) inside = false;
      }
      if (inside) blend(px, w, x, y, color[0], color[1], color[2], 1);
    }
  }
}

/* artwork authored in a 512x512 space; k scales it about the centre */
function makeIcon(size, opts) {
  const o = opts || {};
  const px = Buffer.alloc(size * size * 4, 0);
  const S = size / 512;
  const k = o.duckScale == null ? 1 : o.duckScale;
  const C = 256;
  const tx = (v) => (C + (v - C) * k) * S;
  const ty = (v) => (C + (v - C) * k) * S;
  const tr = (v) => v * k * S;

  roundedBg(px, size, size, [134, 201, 106], o.radiusFrac == null ? 0.18 : o.radiusFrac); // #86c96a
  ellipse(px, size, size, tx(256), ty(372), tr(190), tr(96), [143, 216, 232], 0.95);       // pond
  ellipse(px, size, size, tx(236), ty(300), tr(132), tr(100), [255, 217, 61], 1);          // body
  ellipse(px, size, size, tx(214), ty(306), tr(74), tr(58), [246, 185, 59], 1);            // wing
  ellipse(px, size, size, tx(322), ty(206), tr(78), tr(78), [255, 217, 61], 1);            // head
  ellipse(px, size, size, tx(402), ty(216), tr(46), tr(24), [255, 159, 67], 1);            // beak
  ellipse(px, size, size, tx(346), ty(188), tr(13), tr(13), [40, 40, 48], 1);              // eye
  ellipse(px, size, size, tx(350), ty(184), tr(5), tr(5), [255, 255, 255], 1);             // eye shine
  return encodePng(size, size, px);
}

const root = path.join(__dirname, '..');
fs.writeFileSync(path.join(root, 'icon-192.png'), makeIcon(192, { radiusFrac: 0.18, duckScale: 1 }));
fs.writeFileSync(path.join(root, 'icon-512.png'), makeIcon(512, { radiusFrac: 0.18, duckScale: 1 }));
fs.writeFileSync(path.join(root, 'icon-maskable-512.png'), makeIcon(512, { radiusFrac: 0, duckScale: 0.68 }));
fs.writeFileSync(path.join(root, 'apple-touch-icon.png'), makeIcon(180, { radiusFrac: 0, duckScale: 0.68 }));
console.log('wrote icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png');
