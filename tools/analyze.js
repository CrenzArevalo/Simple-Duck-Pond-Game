/**
 * analyze.js — inspect decoded WAV PCM to find good audio segments.
 * Usage: node tools/analyze.js <file.wav> [topN]
 */
const fs = require('fs');

function readWav(path) {
  const buf = fs.readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not RIFF');
  let off = 12;
  let fmt = null;
  let data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = {
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14)
      };
    } else if (id === 'data') {
      data = buf.subarray(body, body + size);
    }
    off = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('missing fmt/data');
  // assume 16-bit
  const n = Math.floor(data.length / 2);
  const pcm = new Float32Array(n);
  for (let i = 0; i < n; i++) pcm[i] = data.readInt16LE(i * 2) / 32768;
  return { pcm, sampleRate: fmt.sampleRate, channels: fmt.channels, bits: fmt.bits };
}

function envelope(pcm, sr, winMs) {
  const w = Math.max(1, Math.round(sr * winMs / 1000));
  const frames = Math.floor(pcm.length / w);
  const rms = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const base = f * w;
    for (let i = 0; i < w; i++) { const v = pcm[base + i]; sum += v * v; }
    rms[f] = Math.sqrt(sum / w);
  }
  return { rms, winMs, frames, w };
}

function db(v) { return 20 * Math.log10(Math.max(1e-9, v)); }

const path = process.argv[2];
const topN = parseInt(process.argv[3] || '12', 10);
const winMs = parseFloat(process.argv[4] || '25');

const { pcm, sampleRate, channels, bits } = readWav(path);
const dur = pcm.length / sampleRate;
console.log(`${path}`);
console.log(`  sr=${sampleRate} ch=${channels} bits=${bits} dur=${dur.toFixed(2)}s`);

const { rms, frames } = envelope(pcm, sampleRate, winMs);
let sum = 0, peak = 0;
for (let i = 0; i < frames; i++) { sum += rms[i]; peak = Math.max(peak, rms[i]); }
const mean = sum / frames;
console.log(`  meanRMS=${db(mean).toFixed(1)}dB peakRMS=${db(peak).toFixed(1)}dB`);

// loudest windows
const idx = Array.from({ length: frames }, (_, i) => i);
idx.sort((a, b) => rms[b] - rms[a]);

// greedy non-overlapping picks, with a minimum spacing
const minGapFrames = Math.round(700 / winMs);   // >=700ms apart
const picked = [];
for (const i of idx) {
  if (rms[i] < mean * 0.8) break;
  if (picked.some(p => Math.abs(p - i) < minGapFrames)) continue;
  picked.push(i);
  if (picked.length >= topN) break;
}
picked.sort((a, b) => a - b);

console.log(`  top ${picked.length} distinct loud windows:`);
for (const i of picked) {
  console.log(`    t=${(i * winMs / 1000).toFixed(2)}s  ${db(rms[i]).toFixed(1)}dB`);
}

// silence runs to help trimming
const thr = mean * 0.15;
let runStart = -1;
const runs = [];
for (let i = 0; i < frames; i++) {
  if (rms[i] < thr) { if (runStart < 0) runStart = i; }
  else if (runStart >= 0) {
    if ((i - runStart) * winMs > 400) runs.push([runStart * winMs / 1000, i * winMs / 1000]);
    runStart = -1;
  }
}
if (runStart >= 0 && (frames - runStart) * winMs > 400) runs.push([runStart * winMs / 1000, frames * winMs / 1000]);
console.log(`  quiet runs (>400ms): ${runs.length}`);
runs.slice(0, 14).forEach(r => console.log(`    ${r[0].toFixed(2)} -> ${r[1].toFixed(2)}s`));
