/**
 * build-audio.js — turn the raw CC/PD source recordings in audio/_src into
 * small, normalised, game-ready mp3 clips, then bundle them as base64 data
 * URIs in js/sounds-data.js (so the game works from file:// with no fetch/CORS).
 *
 * Requires ffmpeg (see FFMPEG resolution below).
 * Source provenance + licences are recorded in audio/CREDITS.md
 *
 *   node tools/build-audio.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'audio', '_src');
const OUT = path.join(ROOT, 'audio');
const TMP = path.join(SRC, '_tmp');

/* ---------- locate ffmpeg ---------- */
function findFfmpeg() {
  const candidates = [
    process.env.FFMPEG,
    'C:\\Users\\aeval\\AppData\\Local\\Temp\\opencode\\ffmpegsetup\\node_modules\\ffmpeg-static\\ffmpeg.exe',
    'ffmpeg'
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      execFileSync(c, ['-version'], { stdio: 'ignore' });
      return c;
    } catch (_) { /* keep looking */ }
  }
  throw new Error('ffmpeg not found — set the FFMPEG environment variable');
}

const FF = findFfmpeg();
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

function run(args, capture) {
  const res = spawnSync(FF, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (res.error) throw res.error;
  const combined = (res.stdout || '') + (res.stderr || '');
  if (res.status !== 0) {
    throw new Error(`ffmpeg failed (${res.status})\n  ${args.join(' ')}\n${combined.slice(-2000)}`);
  }
  return capture ? combined : '';
}

/** Peak level of a file in dBFS (e.g. -3.2). */
function peakDb(file) {
  const out = run(['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', 'NUL'], true);
  const m = /max_volume:\s*(-?[\d.]+)\s*dB/.exec(out);
  if (!m) throw new Error('could not measure ' + file);
  return parseFloat(m[1]);
}

/** Grab a slice of a source file as mono WAV, with click-free fades. */
function slice(src, start, dur, outWav, opts) {
  opts = opts || {};
  const fadeIn = opts.fadeIn == null ? 0.015 : opts.fadeIn;
  const fadeOut = opts.fadeOut == null ? 0.08 : opts.fadeOut;
  const af = [
    `afade=t=in:st=0:d=${fadeIn}`,
    `afade=t=out:st=${Math.max(0, dur - fadeOut).toFixed(3)}:d=${fadeOut}`
  ].join(',');
  run(['-y', '-hide_banner', '-loglevel', 'error',
    '-i', src, '-ss', String(start), '-t', String(dur),
    '-ac', '1', '-ar', '44100', '-af', af, outWav]);
  return outWav;
}

/** Encode a wav to mono mp3 at a target peak level. */
function encode(wav, mp3, targetPeakDb, bitrate) {
  const gain = (targetPeakDb - peakDb(wav)).toFixed(2);
  run(['-y', '-hide_banner', '-loglevel', 'error',
    '-i', wav, '-af', `volume=${gain}dB`,
    '-ac', '1', '-ar', '44100',
    '-codec:a', 'libmp3lame', '-b:a', bitrate || '80k',
    '-write_xing', '0', mp3]);
  return mp3;
}

function buildClip(name, src, start, dur, targetPeakDb, bitrate, fades) {
  const wav = path.join(TMP, name + '.wav');
  const mp3 = path.join(OUT, name + '.mp3');
  slice(src, start, dur, wav, fades);
  encode(wav, mp3, targetPeakDb, bitrate);
  const kb = (fs.statSync(mp3).size / 1024).toFixed(1);
  console.log(`  ${name.padEnd(12)} ${dur.toFixed(2)}s  ${kb.padStart(6)} KB`);
  return mp3;
}

/* ------------------------------------------------------------------
   Sources (see audio/CREDITS.md)
   ------------------------------------------------------------------ */
const F = {
  duck: path.join(SRC, 'quack_pekin.ogg'),      // 82s of continuous duck vocals
  splash: path.join(SRC, 'splash_tub.ogg'),     // discrete water splashes
  coin: path.join(SRC, 'coin_wood.ogg'),        // coin on wood
  musicA: path.join(SRC, 'music_satie.ogg'),    // Satie, Gymnopedie No.1 (CC0)
  musicB: path.join(SRC, 'music_bach.ogg')      // Bach, Goldberg Variations — Aria (CC0)
};

for (const [k, v] of Object.entries(F)) {
  if (!fs.existsSync(v)) throw new Error(`missing source ${k}: ${v}\nRun the download step first (see README).`);
}

console.log('Building audio clips...\n');

/* ---- quacks: loud, well-separated duck moments from the recording ---- */
console.log('QUACKS');
const quackAt = [79.50, 71.75, 64.42, 75.38, 7.53];
quackAt.forEach((t, i) => {
  buildClip(`quack${i + 1}`, F.duck, Math.max(0, t - 0.17), 0.62, -1.2, '80k', { fadeIn: 0.008, fadeOut: 0.14 });
});

/* ---- splashes ---- */
console.log('\nSPLASHES');
const splashAt = [3.75, 7.28, 25.05];
splashAt.forEach((t, i) => {
  buildClip(`splash${i + 1}`, F.splash, Math.max(0, t - 0.30), 1.05, -1.5, '80k', { fadeIn: 0.006, fadeOut: 0.34 });
});

/* ---- coin ---- */
console.log('\nCOIN');
buildClip('coin', F.coin, 0.52, 1.00, -1.6, '80k', { fadeIn: 0.004, fadeOut: 0.20 });

/* ---- relaxing music: seamless loops with a musical crossfade ---- */
console.log('\nMUSIC (seamless loops)');
function buildMusic(name, src, start, loop, xf, peakDb, bitrate) {
  const mainWav = path.join(TMP, name + '_main.wav');
  const headWav = path.join(TMP, name + '_head.wav');
  const wav = path.join(TMP, name + '_raw.wav');
  const mp3 = path.join(OUT, name + '.mp3');

  // Two-pass: materialise the body and the wrap-around head, then crossfade.
  // (A single asplit+acrossfade graph cannot stream both branches at once.)
  run(['-y', '-hide_banner', '-loglevel', 'error', '-i', src,
    '-ss', String(start + xf), '-t', String(loop), '-ac', '1', '-ar', '44100', mainWav]);
  run(['-y', '-hide_banner', '-loglevel', 'error', '-i', src,
    '-ss', String(start), '-t', String(xf), '-ac', '1', '-ar', '44100', headWav]);

  run(['-y', '-hide_banner', '-loglevel', 'error',
    '-i', mainWav, '-i', headWav,
    '-filter_complex',
    `[0:a][1:a]acrossfade=d=${xf}:c1=tri:c2=tri,highpass=f=38,lowpass=f=13500[out]`,
    '-map', '[out]', '-ac', '1', '-ar', '44100', wav]);

  encode(wav, mp3, peakDb, bitrate);
  console.log(`  ${name.padEnd(12)} ${loop.toFixed(2)}s  ${(fs.statSync(mp3).size / 1024).toFixed(1).padStart(6)} KB`);
}

// Satie holds a very steady -28 dB — lovely even loop.
buildMusic('music1', F.musicA, 44.0, 26.0, 3.0, -6.0, '64k');
// The Goldberg Aria is a much quieter recording, so it needs a bigger lift.
buildMusic('music2', F.musicB, 62.0, 22.0, 3.0, -6.0, '64k');

/* ------------------------------------------------------------------
   Bundle everything into js/sounds-data.js
   ------------------------------------------------------------------ */
console.log('\nBundling into js/sounds-data.js ...');
const clips = {};
for (const file of fs.readdirSync(OUT)) {
  if (!file.endsWith('.mp3')) continue;
  const name = file.replace(/\.mp3$/, '');
  const b64 = fs.readFileSync(path.join(OUT, file)).toString('base64');
  clips[name] = 'data:audio/mpeg;base64,' + b64;
}

const js =
  '/* AUTO-GENERATED by tools/build-audio.js — do not edit by hand.\n' +
  '   Audio clips sourced from Wikimedia Commons (CC0 / public domain / CC BY-SA).\n' +
  '   See audio/CREDITS.md for provenance. Bundled as data URIs so the game\n' +
  '   works straight from file:// with no server and no network.\n' +
  '   Regenerate with:  node tools/build-audio.js  */\n' +
  'window.SOUND_DATA = ' + JSON.stringify(clips, null, 0).replace(/\},\{/g, '},\n{') + ';\n';

const jsPath = path.join(ROOT, 'js', 'sounds-data.js');
fs.writeFileSync(jsPath, js);

const total = Buffer.byteLength(js);
console.log(`  clips: ${Object.keys(clips).length}`);
console.log(`  js/sounds-data.js: ${(total / 1024).toFixed(0)} KB`);
console.log('\nDone.');
