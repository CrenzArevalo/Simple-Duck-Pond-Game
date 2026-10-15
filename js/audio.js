/* ===========================================================
   audio.js — game audio
   Real CC0/public-domain recordings (see audio/CREDITS.md) are bundled
   as base64 data URIs by tools/build-audio.js, decoded with WebAudio and
   played with pitch/pan variation. If anything fails to load we fall back
   to a small built-in synth so the game is never silent.
   =========================================================== */
(function (global) {
  'use strict';

  var ctx = null;
  var master = null;
  var sfxGain = null;
  var musicGain = null;
  var enabled = true;
  var buffers = Object.create(null);
  var loaded = false;
  var loadPromise = null;

  /* relaxing background music: two CC0 tracks, crossfaded forever */
  var MUSIC_LEVEL = 0.38;
  var MUSIC_TRACKS = ['music1', 'music2'];
  var MUSIC_XFADE = 2.6;
  var musicOn = false;
  var musicIdx = 0;
  var musicNextTime = 0;
  var musicPump = null;

  /* ---------------------------------------------------------
     init / loading
     --------------------------------------------------------- */
  function ensure() {
    if (ctx) return ctx;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { return null; }
    master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(ctx.destination);

    sfxGain = ctx.createGain();
    sfxGain.gain.value = 1.0;
    sfxGain.connect(master);

    musicGain = ctx.createGain();
    musicGain.gain.value = 0.0;
    musicGain.connect(master);
    return ctx;
  }

  function b64ToBuffer(dataUri) {
    var comma = dataUri.indexOf(',');
    var bin = global.atob(dataUri.slice(comma + 1));
    var len = bin.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  function decodeInto(name, dataUri) {
    return new Promise(function (resolve) {
      try {
        var ab = b64ToBuffer(dataUri);
        var maybe = ctx.decodeAudioData(ab, function (buf) {
          buffers[name] = buf; resolve(true);
        }, function () { resolve(false); });
        if (maybe && typeof maybe.then === 'function') {
          maybe.then(function (buf) { buffers[name] = buf; resolve(true); }, function () { resolve(false); });
        }
      } catch (e) { resolve(false); }
    });
  }

  function loadAll() {
    if (loadPromise) return loadPromise;
    if (!ensure()) { loadPromise = Promise.resolve(false); return loadPromise; }
    var data = global.SOUND_DATA;
    if (!data) { loadPromise = Promise.resolve(false); return loadPromise; }

    var jobs = Object.keys(data).map(function (k) { return decodeInto(k, data[k]); });
    loadPromise = Promise.all(jobs).then(function (results) {
      loaded = results.some(Boolean);
      return loaded;
    });
    return loadPromise;
  }

  function pick(names) {
    var avail = names.filter(function (n) { return buffers[n]; });
    if (!avail.length) return null;
    return avail[(Math.random() * avail.length) | 0];
  }

  /**
   * Play a loaded buffer with optional pan / pitch / gain.
   * Returns true when a real sample was played.
   */
  function sample(name, opts) {
    if (!enabled || !ctx || !buffers[name]) return false;
    opts = opts || {};
    var src = ctx.createBufferSource();
    src.buffer = buffers[name];
    var rate = opts.rate == null ? 1 : opts.rate;
    if (opts.jitter) rate *= 1 + (Math.random() * 2 - 1) * opts.jitter;
    src.playbackRate.value = rate;

    var g = ctx.createGain();
    g.gain.value = opts.gain == null ? 1 : opts.gain;

    var node = src;
    if (opts.pan != null && ctx.createStereoPanner) {
      var p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      node.connect(p); node = p;
    }
    node.connect(g);
    g.connect(sfxGain);
    src.start(ctx.currentTime + (opts.delay || 0));
    return true;
  }

  /* ---------------------------------------------------------
     synth fallback (also used for tiny UI blips)
     --------------------------------------------------------- */
  function tone(opt) {
    if (!enabled || !ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    var t0 = ctx.currentTime + (opt.delay || 0);
    var dur = opt.dur || 0.2;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = opt.type || 'sine';
    osc.frequency.setValueAtTime(opt.f0, t0);
    if (opt.f1 != null) {
      if (opt.exp === false) osc.frequency.linearRampToValueAtTime(opt.f1, t0 + dur);
      else osc.frequency.exponentialRampToValueAtTime(Math.max(1, opt.f1), t0 + dur);
    }
    var peak = opt.gain == null ? 0.2 : opt.gain;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + (opt.attack == null ? 0.008 : opt.attack));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    var last = osc;
    if (opt.filter) {
      var f = ctx.createBiquadFilter();
      f.type = opt.filter.type || 'lowpass';
      f.frequency.setValueAtTime(opt.filter.f0 || 1200, t0);
      if (opt.filter.f1) f.frequency.exponentialRampToValueAtTime(opt.filter.f1, t0 + dur);
      f.Q.value = opt.filter.q || 1;
      osc.connect(f); last = f;
    }
    last.connect(g); g.connect(sfxGain);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  function noiseBurst(opt) {
    if (!enabled || !ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    var t0 = ctx.currentTime + (opt.delay || 0);
    var dur = opt.dur || 0.3;
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource(); src.buffer = buf;
    var f = ctx.createBiquadFilter();
    f.type = opt.type || 'bandpass';
    f.frequency.setValueAtTime(opt.f0 || 900, t0);
    if (opt.f1) f.frequency.exponentialRampToValueAtTime(Math.max(40, opt.f1), t0 + dur);
    f.Q.value = opt.q == null ? 1.2 : opt.q;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opt.gain == null ? 0.16 : opt.gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(sfxGain);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }

  /* ---------------------------------------------------------
     relaxing music — two looped CC0 tracks, crossfaded forever.
     The schedule is queued ~40s ahead on the audio clock so the
     music keeps flowing even when the tab is throttled.
     --------------------------------------------------------- */
  function musicBaseLevel() { return enabled ? MUSIC_LEVEL : 0; }

  function pumpMusic() {
    if (!ctx || !musicOn) return;
    var now = ctx.currentTime;
    var guard = 0;
    while (musicNextTime < now + 40 && guard++ < 6) {
      var name = MUSIC_TRACKS[musicIdx % MUSIC_TRACKS.length];
      var buf = buffers[name];
      if (!buf) return;
      var dur = buf.duration;
      var xf = MUSIC_XFADE;
      var startAt = Math.max(musicNextTime, now + 0.06);
      var endAt = startAt + dur;

      var src = ctx.createBufferSource();
      src.buffer = buf;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, startAt);
      g.gain.linearRampToValueAtTime(1, startAt + xf);
      g.gain.setValueAtTime(1, Math.max(startAt + xf, endAt - xf));
      g.gain.linearRampToValueAtTime(0.0001, endAt);
      src.connect(g); g.connect(musicGain);
      try { src.start(startAt); src.stop(endAt + 0.1); } catch (e) { break; }

      musicNextTime = endAt - xf;   // next track overlaps this one's tail
      musicIdx++;
    }
  }

  function startMusic() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (!buffers[MUSIC_TRACKS[0]] && !buffers[MUSIC_TRACKS[1]]) return;
    if (!musicOn) {
      musicOn = true;
      musicNextTime = ctx.currentTime + 0.25;
    }
    musicGain.gain.setTargetAtTime(musicBaseLevel(), ctx.currentTime, 1.6);
    pumpMusic();
    if (!musicPump) {
      musicPump = setInterval(pumpMusic, 5000);
      global.addEventListener('visibilitychange', pumpMusic);
    }
  }

  function stopMusic() {
    musicOn = false;
    if (musicPump) { clearInterval(musicPump); musicPump = null; }
    if (ctx && musicGain) musicGain.gain.setTargetAtTime(0, ctx.currentTime, 0.7);
  }

  /** Briefly dip the music so a quack really cuts through. */
  function duckMusic(depth, dur) {
    if (!ctx || !musicGain || !musicOn) return;
    var base = musicBaseLevel();
    var t = ctx.currentTime;
    var d = depth == null ? 0.28 : depth;
    musicGain.gain.cancelScheduledValues(t);
    musicGain.gain.setValueAtTime(musicGain.gain.value, t);
    musicGain.gain.linearRampToValueAtTime(base * d, t + 0.04);
    musicGain.gain.setTargetAtTime(base, t + 0.04 + (dur == null ? 0.5 : dur), 0.22);
  }

  /* ---------------------------------------------------------
     public API
     --------------------------------------------------------- */
  var Sound = {
    get enabled() { return enabled; },
    get ready() { return loaded; },
    get hasSamples() { return loaded; },

    init: function () {
      ensure();
      if (ctx && ctx.state === 'suspended') ctx.resume();
      return loadAll();
    },

    setEnabled: function (v) {
      enabled = !!v;
      if (master) master.gain.value = enabled ? 0.85 : 0.0;
      if (musicGain && ctx) {
        musicGain.gain.setTargetAtTime(musicBaseLevel(), ctx.currentTime, 0.3);
      }
      if (enabled) Sound.init();
    },

    /* ---------- net & water ---------- */
    scoop: function (pan) {
      if (sample(pick(['splash2', 'splash3']), { pan: pan, rate: 1.5, jitter: 0.05, gain: 0.35 })) return;
      noiseBurst({ type: 'bandpass', f0: 2200, f1: 380, dur: 0.28, q: 0.8, gain: 0.13 });
    },

    splash: function (pan, big) {
      if (sample(pick(['splash1', 'splash2', 'splash3']), {
        pan: pan, rate: big ? 0.95 : 1.12, jitter: 0.07, gain: big ? 0.95 : 0.62
      })) return;
      noiseBurst({ type: 'lowpass', f0: 1600, f1: 260, dur: 0.42, q: 0.6, gain: 0.2 });
    },

    /* ---------- ducks ---------- */
    /**
     * A duck quack. NOTE: deliberately unused — the pond is calm and the ducks
     * never quack (see README). Kept, along with the quack*.mp3 samples, only as
     * an optional voice if a future version wants one.
     */
    quack: function (pan, opts) {
      opts = opts || {};
      var dly = opts.delay || 0;
      if (sample(pick(['quack1', 'quack2', 'quack3', 'quack4', 'quack5']), {
        pan: pan, rate: opts.rate || 1, jitter: 0.09,
        gain: opts.gain == null ? 0.95 : opts.gain, delay: dly
      })) return;
      // synth duck fallback
      tone({ type: 'sawtooth', f0: 440, f1: 205, dur: 0.15, gain: 0.11, delay: dly,
        filter: { type: 'bandpass', f0: 1100, f1: 620, q: 5 } });
      tone({ type: 'square', f0: 300, f1: 150, dur: 0.11, gain: 0.05, delay: dly + 0.012,
        filter: { type: 'lowpass', f0: 900, q: 2 } });
    },

    /**
     * The "you caught a duck" moment — the net lifts out with a soft splash.
     * The ducks themselves stay quiet; only the music and the water speak.
     */
    catchDuck: function (pan) {
      if (sample(pick(['splash1', 'splash2', 'splash3']), {
        pan: pan, rate: 0.94, jitter: 0.05, gain: 0.46
      })) return;
      tone({ type: 'sine', f0: 360, f1: 150, dur: 0.22, gain: 0.05 });
    },

    escape: function (pan) {
      sample(pick(['splash1', 'splash2', 'splash3']), { pan: pan, rate: 1.06, gain: 0.3 });
    },

    /* ---------- coins & shop ---------- */
    coin: function (i, pan) {
      i = i || 0;
      if (sample('coin', { pan: pan, rate: 0.95 + i * 0.06, gain: 0.55 })) return;
      tone({ type: 'square', f0: midi(88 + i * 2), f1: midi(95 + i * 2), dur: 0.1, gain: 0.09 });
      tone({ type: 'sine', f0: midi(100 + i * 2), dur: 0.12, gain: 0.06, delay: 0.05 });
    },

    /** One warm, satisfying coin — used when a duck is sold to a visitor. */
    sell: function (pan) {
      duckMusic(0.55, 0.4);
      sample('coin', { pan: pan, rate: 0.88, gain: 0.5 });
      tone({ type: 'triangle', f0: midi(79), f1: midi(88), dur: 0.26, gain: 0.1, delay: 0.03 });
      tone({ type: 'sine', f0: midi(91), dur: 0.3, gain: 0.06, delay: 0.1 });
    },

    buy: function () {
      [0, 4, 7, 12].forEach(function (s, i) {
        tone({ type: 'triangle', f0: midi(72 + s), dur: 0.42, gain: 0.13, delay: i * 0.06 });
      });
    },

    equip: function () {
      tone({ type: 'sine', f0: 880, f1: 1420, dur: 0.1, gain: 0.1 });
      tone({ type: 'sine', f0: 1320, dur: 0.14, gain: 0.07, delay: 0.07 });
    },

    unequip: function () {
      tone({ type: 'sine', f0: 920, f1: 520, dur: 0.12, gain: 0.09 });
    },

    /* ---------- UI ---------- */
    ui: function () { tone({ type: 'sine', f0: 640, f1: 820, dur: 0.07, gain: 0.07 }); },
    open: function () {
      tone({ type: 'sine', f0: 420, f1: 900, dur: 0.16, gain: 0.09 });
      tone({ type: 'sine', f0: 630, f1: 1250, dur: 0.2, gain: 0.06, delay: 0.05 });
    },
    close: function () { tone({ type: 'sine', f0: 760, f1: 340, dur: 0.15, gain: 0.08 }); },
    deny: function () { tone({ type: 'square', f0: 220, f1: 150, dur: 0.14, gain: 0.09 }); },

    sparkle: function (pan) {
      for (var i = 0; i < 5; i++) {
        tone({ type: 'sine', f0: 1200 + Math.random() * 1800, dur: 0.24, gain: 0.032, delay: i * 0.035 });
      }
    },

    /* ---------- relaxing background music ---------- */
    /** Start (or resume) the looped, crossfaded music bed. */
    startMusic: startMusic,
    stopMusic: stopMusic,

    setMusicLevel: function (v) {
      MUSIC_LEVEL = Math.max(0, Math.min(1, v));
      if (ctx && musicGain && musicOn) musicGain.gain.setTargetAtTime(musicBaseLevel(), ctx.currentTime, 0.6);
    },

    get musicPlaying() { return musicOn; },
    duckMusic: duckMusic,

    /* legacy aliases (older call sites) */
    startAmbience: function () { startMusic(); },
    setAmbienceLevel: function () { /* pond ambience retired in favour of music */ },
    stopAmbience: stopMusic
  };

  global.Sound = Sound;
})(window);
