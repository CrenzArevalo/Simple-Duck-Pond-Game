/* Generates icon-192.png and icon-512.png for the PWA / Android package.
   Run:  node tools/make-icons.js
   Pure Node (zlib) — no dependencies. Draws a simple pond + duck badge. */
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
  a = alpha == null ? 1 : alpha;
  const x0 = Math.max(0, Math.floor(cx - rx)), x1 = Math.min(w - 1, Math.ceil(cx + rx));
  const y0 = Math.max(0, Math.floor(cy - ry)), y1 = Math.min(h - 1, Math.ceil(cy + ry));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d <= 1) {
        // soft 1px edge
        const edge = Math.min(1, (1 - d) * 6);
        blend(px, w, x, y, color[0], color[1], color[2], a * edge);
      }
    }
  }
}

function roundedBg(px, w, h, color) {
  const r = w * 0.18;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // rounded-corner mask
      let inside = true;
      const cx = x < r ? r : (x > w - r ? w - r : x);
      const cy = y < r ? r : (y > h - r ? h - r : y);
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy > r * r) inside = false;
      if (inside) blend(px, w, x, y, color[0], color[1], color[2], 1);
    }
  }
}

function makeIcon(size) {
  const px = Buffer.alloc(size * size * 4, 0);
  const S = size / 512;

  // grass background (rounded)
  roundedBg(px, size, size, [134, 201, 106]); // #86c96a
  // pond hint
  ellipse(px, size, size, 256 * S, 372 * S, 190 * S, 96 * S, [143, 216, 232], 0.95);

  // duck body
  ellipse(px, size, size, 236 * S, 300 * S, 132 * S, 100 * S, [255, 217, 61], 1);
  // wing
  ellipse(px, size, size, 214 * S, 306 * S, 74 * S, 58 * S, [246, 185, 59], 1);
  // head
  ellipse(px, size, size, 322 * S, 206 * S, 78 * S, 78 * S, [255, 217, 61], 1);
  // beak
  ellipse(px, size, size, 402 * S, 216 * S, 46 * S, 24 * S, [255, 159, 67], 1);
  // eye
  ellipse(px, size, size, 346 * S, 188 * S, 13 * S, 13 * S, [40, 40, 48], 1);
  ellipse(px, size, size, 350 * S, 184 * S, 5 * S, 5 * S, [255, 255, 255], 1);

  return encodePng(size, size, px);
}

const root = path.join(__dirname, '..');
fs.writeFileSync(path.join(root, 'icon-192.png'), makeIcon(192));
fs.writeFileSync(path.join(root, 'icon-512.png'), makeIcon(512));
console.log('wrote icon-192.png and icon-512.png');
