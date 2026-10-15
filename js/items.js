/* ===========================================================
   items.js — duck + accessory mesh builders and the shop catalog
   All models are procedural (no external assets).
   Convention: a duck faces +Z, up is +Y, feet near y=0.
   =========================================================== */
(function (global) {
  'use strict';

  var T = global.THREE;

  /* ---------------------------------------------------------
     shared material cache
     --------------------------------------------------------- */
  var matCache = new Map();

  function mat(color, opts) {
    var key = color + '|' + JSON.stringify(opts || {});
    var m = matCache.get(key);
    if (!m) {
      m = new T.MeshStandardMaterial(Object.assign({
        color: color,
        roughness: 0.68,
        metalness: 0.0,
        envMapIntensity: 0.55
      }, opts || {}));
      matCache.set(key, m);
    }
    return m;
  }

  function basic(color, opts) {
    var key = 'b' + color + '|' + JSON.stringify(opts || {});
    var m = matCache.get(key);
    if (!m) {
      m = new T.MeshBasicMaterial(Object.assign({ color: color }, opts || {}));
      matCache.set(key, m);
    }
    return m;
  }

  var GEO_CACHE = new Map();
  function geo(key, make) {
    var g = GEO_CACHE.get(key);
    if (!g) {
      g = make();
      // cached geometries are shared, so they must never be auto-disposed
      g.userData.keep = true;
      GEO_CACHE.set(key, g);
    }
    return g;
  }

  /* ---------------------------------------------------------
     small helpers
     --------------------------------------------------------- */
  function mesh(g, m, x, y, z) {
    var o = new T.Mesh(g, m);
    if (x !== undefined) o.position.set(x, y, z);
    o.castShadow = true;
    return o;
  }

  function sphere(r, seg, m, x, y, z) {
    return mesh(geo('s' + r + '_' + (seg || 20), function () {
      return new T.SphereGeometry(r, seg || 20, Math.max(8, Math.round((seg || 20) * 0.75)));
    }), m, x, y, z);
  }

  function starShape(outer, inner, points) {
    var s = new T.Shape();
    var n = points * 2;
    for (var i = 0; i < n; i++) {
      var r = (i % 2) ? inner : outer;
      var a = (i / n) * Math.PI * 2 - Math.PI / 2;
      var x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
    }
    s.closePath();
    return s;
  }

  function heartShape(s) {
    var sh = new T.Shape();
    sh.moveTo(0, -s);
    sh.bezierCurveTo(s * 1.5, s * 0.28, s * 0.78, s * 1.35, 0, s * 0.55);
    sh.bezierCurveTo(-s * 0.78, s * 1.35, -s * 1.5, s * 0.28, 0, -s);
    return sh;
  }

  function extrude(shape, depth, curveSeg) {
    return new T.ExtrudeGeometry(shape, {
      depth: depth || 0.04,
      bevelEnabled: false,
      curveSegments: curveSeg || 8
    });
  }

  /* ---------------------------------------------------------
     GOLDEN SHINE
     A soft radial "glow" used by the golden duck's halo and
     sparkles. Painted once on a canvas and shared by every glow
     sprite in the game.
     --------------------------------------------------------- */
  var _haloTexture = null;
  function haloTexture() {
    if (_haloTexture) return _haloTexture;
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var x = c.getContext('2d');
    var g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0.00, 'rgba(255,255,255,1.00)');
    g.addColorStop(0.22, 'rgba(255,246,196,0.85)');
    g.addColorStop(0.50, 'rgba(255,214,92,0.32)');
    g.addColorStop(1.00, 'rgba(255,198,60,0.00)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    var t = new T.CanvasTexture(c);
    if (T.SRGBColorSpace) t.colorSpace = T.SRGBColorSpace;
    _haloTexture = t;
    return t;
  }

  /* Build the golden duck's shine: a halo, a warm point light and a
     ring of twinkling sparkles. Animated in tickDuck. */
  function buildShine() {
    var g = new T.Group();
    g.position.set(0, 0.78, 0);

    var halo = new T.Sprite(new T.SpriteMaterial({
      map: haloTexture(), color: 0xffd24a, transparent: true,
      blending: T.AdditiveBlending, depthWrite: false, opacity: 0.6
    }));
    halo.scale.set(2.0, 2.0, 1);
    g.add(halo);

    var light = new T.PointLight(0xffd766, 4.0, 6.0, 2);
    light.position.set(0, 0.2, 0.15);
    g.add(light);

    var sparks = new T.Group();
    for (var i = 0; i < 7; i++) {
      var s = new T.Sprite(new T.SpriteMaterial({
        map: haloTexture(), color: 0xfff6c4, transparent: true,
        blending: T.AdditiveBlending, depthWrite: false, opacity: 0.8
      }));
      s.scale.set(0.26, 0.26, 1);
      sparks.add(s);
    }
    g.add(sparks);

    g.userData.core = halo;
    g.userData.light = light;
    g.userData.sparkles = sparks;
    return g;
  }

  /* ---------------------------------------------------------
     SURFACE PATTERNS
     Every duck wears a coat: polka dots, stripes, waves, checker,
     hearts, stars, speckles or a glowing "radiant" gradient. Each
     texture is painted on a small canvas and cached per
     (pattern, palette) pair, so many ducks still share a handful
     of materials.
     --------------------------------------------------------- */
  var PATTERNS = [
    { id: 'dots',    name: 'Polka Dots' },
    { id: 'stripes', name: 'Stripes' },
    { id: 'radiant', name: 'Radiant' },
    { id: 'waves',   name: 'Waves' },
    { id: 'checker', name: 'Checker' },
    { id: 'hearts',  name: 'Hearts' },
    { id: 'stars',   name: 'Stars' },
    { id: 'speckle', name: 'Speckles' }
  ];

  /* vivid, high-contrast coat pairings: a = base, b = accent */
  var PATTERN_PALETTES = [
    { a: 0xffd93d, b: 0xff5d8f },
    { a: 0xfff8ec, b: 0x59c8ee },
    { a: 0x9be8cf, b: 0xff86ab },
    { a: 0x8fc9ff, b: 0xfff4b8 },
    { a: 0xffb0c8, b: 0xffd93d },
    { a: 0xcdb8ff, b: 0x6fe0bf },
    { a: 0x63d2ea, b: 0xfff07a },
    { a: 0xffc48f, b: 0xff5d8f },
    { a: 0xffef9a, b: 0xff8f2e },
    { a: 0xaef29a, b: 0xffffff },
    { a: 0xff9fb8, b: 0x8fd8e8 },
    { a: 0xf6d98a, b: 0xc07a4a },
    { a: 0x86dcff, b: 0xffd93d },
    { a: 0xd8bcff, b: 0xfffaf0 },
    { a: 0xff8f6b, b: 0xffe08a },
    { a: 0x7fe3c4, b: 0x3f9fd8 }
  ];

  function cssHex(c) { return '#' + ('000000' + c.toString(16)).slice(-6); }

  function paintHeart(c, cx, cy, s) {
    c.beginPath();
    c.moveTo(cx, cy + s * 0.75);
    c.bezierCurveTo(cx - s * 1.5, cy - s * 0.5, cx - s * 0.4, cy - s * 1.2, cx, cy - s * 0.25);
    c.bezierCurveTo(cx + s * 0.4, cy - s * 1.2, cx + s * 1.5, cy - s * 0.5, cx, cy + s * 0.75);
    c.fill();
  }

  function paintStar(c, cx, cy, outer, inner, points) {
    c.beginPath();
    for (var i = 0; i < points * 2; i++) {
      var r = (i % 2) ? inner : outer;
      var a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      var px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
      if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.closePath();
    c.fill();
  }

  var PATTERN_TEX = new Map();
  function patternTexture(id, pal) {
    var key = id + '|' + pal.a + '|' + pal.b;
    var t = PATTERN_TEX.get(key);
    if (t) return t;

    var S = 256;
    var cv = document.createElement('canvas');
    cv.width = cv.height = S;
    var c = cv.getContext('2d');
    var base = cssHex(pal.a), acc = cssHex(pal.b);

    c.fillStyle = base;
    c.fillRect(0, 0, S, S);
    c.fillStyle = acc;
    c.strokeStyle = acc;

    var i, x, y, g, step;
    if (id === 'dots') {
      step = S / 4;
      for (y = 0; y < 4; y++) for (x = 0; x < 4; x++) {
        c.beginPath();
        c.arc(x * step + step * 0.5 + (y % 2 ? step * 0.5 : 0), y * step + step * 0.5, step * 0.27, 0, Math.PI * 2);
        c.fill();
      }
    } else if (id === 'stripes') {
      c.save();
      c.translate(S / 2, S / 2);
      c.rotate(-Math.PI / 4);
      c.translate(-S, -S);
      var w = S / 8;
      for (i = 0; i < 16; i++) if (i % 2 === 0) c.fillRect(i * w, -S, w, S * 3);
      c.restore();
    } else if (id === 'checker') {
      step = S / 8;
      for (y = 0; y < 8; y++) for (x = 0; x < 8; x++) {
        if ((x + y) % 2 === 0) c.fillRect(x * step, y * step, step, step);
      }
    } else if (id === 'waves') {
      var rows = 6, amp = S / 22;
      c.lineWidth = S / 26;
      c.lineCap = 'round';
      for (i = 0; i < rows; i++) {
        var yy = (i + 0.5) * (S / rows);
        c.beginPath();
        for (x = 0; x <= S; x += 4) {
          var yv = yy + Math.sin((x / S) * Math.PI * 4 + i) * amp;
          if (x === 0) c.moveTo(x, yv); else c.lineTo(x, yv);
        }
        c.stroke();
      }
    } else if (id === 'hearts') {
      step = S / 4;
      for (y = 0; y < 4; y++) for (x = 0; x < 4; x++) {
        paintHeart(c, x * step + step * 0.5, y * step + step * 0.5, step * 0.30);
      }
    } else if (id === 'stars') {
      step = S / 4;
      for (y = 0; y < 4; y++) for (x = 0; x < 4; x++) {
        paintStar(c, x * step + step * 0.5, y * step + step * 0.5, step * 0.33, step * 0.14, 5);
      }
    } else if (id === 'speckle') {
      for (i = 0; i < 190; i++) {
        c.beginPath();
        c.arc(Math.random() * S, Math.random() * S, 1.2 + Math.random() * 3.2, 0, Math.PI * 2);
        c.fill();
      }
    } else if (id === 'radiant') {
      g = c.createRadialGradient(S * 0.5, S * 0.40, S * 0.05, S * 0.5, S * 0.5, S * 0.78);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.26, base);
      g.addColorStop(0.66, acc);
      g.addColorStop(1, base);
      c.fillStyle = g;
      c.fillRect(0, 0, S, S);
      c.save();
      c.translate(S / 2, S / 2);
      c.globalAlpha = 0.20;
      c.fillStyle = '#ffffff';
      for (i = 0; i < 12; i++) {
        c.rotate(Math.PI * 2 / 12);
        c.beginPath();
        c.moveTo(0, 0);
        c.lineTo(S, -S * 0.05);
        c.lineTo(S, S * 0.05);
        c.closePath();
        c.fill();
      }
      c.restore();
    }

    t = new T.CanvasTexture(cv);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = 4;
    t.repeat.set(id === 'radiant' ? 1 : 2, id === 'radiant' ? 1 : 1.4);
    t.needsUpdate = true;
    PATTERN_TEX.set(key, t);
    return t;
  }

  function patternMat(id, pal, opts) {
    var key = 'p:' + id + '|' + pal.a + '|' + pal.b + '|' + JSON.stringify(opts || {});
    var m = matCache.get(key);
    if (!m) {
      m = new T.MeshStandardMaterial(Object.assign({
        map: patternTexture(id, pal),
        color: 0xffffff,
        roughness: 0.7,
        metalness: 0.0,
        envMapIntensity: 0.5
      }, opts || {}));
      matCache.set(key, m);
    }
    return m;
  }

  /** Normalise a stored pattern ({p,c} / {id,pal} / "dots") into {id, pal}. */
  function resolvePattern(p) {
    if (!p) return null;
    var id = typeof p === 'string' ? p : (p.p || p.id || 'dots');
    var pal;
    if (p.pal && typeof p.pal === 'object') pal = p.pal;
    else {
      var n = PATTERN_PALETTES.length;
      var ci = (typeof p.c === 'number') ? p.c : 0;
      pal = PATTERN_PALETTES[((ci % n) + n) % n];
    }
    var known = false;
    for (var i = 0; i < PATTERNS.length; i++) if (PATTERNS[i].id === id) known = true;
    return { id: known ? id : 'dots', pal: pal || PATTERN_PALETTES[0] };
  }

  /** Assign a fresh random coat. */
  function randomPattern() {
    return {
      p: PATTERNS[Math.floor(Math.random() * PATTERNS.length)].id,
      c: Math.floor(Math.random() * PATTERN_PALETTES.length)
    };
  }

  /** Human label, e.g. "Polka Dots". */
  function patternName(p) {
    var rp = resolvePattern(p);
    if (!rp) return 'Plain';
    for (var i = 0; i < PATTERNS.length; i++) if (PATTERNS[i].id === rp.id) return PATTERNS[i].name;
    return 'Pattern';
  }

  /* ---------------------------------------------------------
     DUCK
     --------------------------------------------------------- */
  var HEAD_CENTER = new T.Vector3(0, 1.06, 0.44);
  var HEAD_R = 0.44;

  var DUCK_VARIANTS = [
    { id: 'classic', name: 'Sunny', body: 0xffd93d, wing: 0xffc93a, beak: 0xff9a3c, cheek: 0xffa9bd, rarity: 'common' },
    { id: 'snow', name: 'Cloud', body: 0xfff8ec, wing: 0xffe9cc, beak: 0xffab3d, cheek: 0xffb9c6, rarity: 'common' },
    { id: 'mint', name: 'Minty', body: 0xa8ebd3, wing: 0x8fe0c4, beak: 0xffab3d, cheek: 0xffa9bd, rarity: 'common' },
    { id: 'sky', name: 'Bubbles', body: 0x9fd2ff, wing: 0x86c2f7, beak: 0xffab3d, cheek: 0xffb0c4, rarity: 'common' },
    { id: 'rose', name: 'Rosie', body: 0xffb8c8, wing: 0xffa2b8, beak: 0xffa03c, cheek: 0xff8fa8, rarity: 'common' },
    { id: 'lilac', name: 'Lila', body: 0xcbb8ff, wing: 0xb9a2f7, beak: 0xffab3d, cheek: 0xff9ec4, rarity: 'uncommon' },
    { id: 'choco', name: 'Cocoa', body: 0xc98d5c, wing: 0xb87a4c, beak: 0xffb84d, cheek: 0xff9d8a, rarity: 'uncommon' },
    { id: 'peach', name: 'Peaches', body: 0xffc99b, wing: 0xffb884, beak: 0xff9a3c, cheek: 0xff9db0, rarity: 'uncommon' },
    { id: 'ocean', name: 'Lagoon', body: 0x6fd3e8, wing: 0x57c2db, beak: 0xffab3d, cheek: 0xffa4c0, rarity: 'rare' },
    { id: 'gold', name: 'Golden', body: 0xffce3a, wing: 0xf0b71f, beak: 0xffa726, cheek: 0xffb27a, rarity: 'epic', metal: 0.5, rough: 0.22, glow: 0xffc93a, glowI: 0.95, shine: true }
  ];

  var DUCK_NAMES = ['Pip', 'Quackers', 'Waddles', 'Ducky', 'Puddles', 'Beaker', 'Noodle', 'Biscuit',
    'Mochi', 'Sprout', 'Buttons', 'Pudding', 'Tofu', 'Wobbles', 'Pebble', 'Dumpling', 'Peep',
    'Nibbles', 'Marbles', 'Poppy', 'Skipper', 'Chip', 'Mango', 'Boba', 'Pickles', 'Tater',
    'Squish', 'Doodle', 'Pipsqueak', 'Snowflake'];

  var ANCHORS = {
    head: { x: 0, y: 1.06, z: 0.44 },
    face: { x: 0, y: 1.06, z: 0.44 },
    neck: { x: 0, y: 0.62, z: 0.34 },
    back: { x: 0, y: 0.56, z: -0.30 },
    held: { x: 0.63, y: 0.42, z: 0.36 }
  };

  function buildDuck(variant, opts) {
    opts = opts || {};
    var v = variant || DUCK_VARIANTS[0];
    var g = new T.Group();

    var pat = resolvePattern(opts.pattern);
    var bodyMat, wingMat;
    if (pat) {
      /* patterned coat: body, head, tail and wings share one texture */
      var coatOpts = {
        roughness: v.rough == null ? 0.7 : v.rough,
        metalness: v.metal || 0
      };
      if (pat.id === 'radiant') {
        coatOpts.emissive = pat.pal.b;
        coatOpts.emissiveIntensity = 0.18;
      }
      if (v.shine) {
        coatOpts.emissive = v.glow || pat.pal.b;
        coatOpts.emissiveIntensity = v.glowI == null ? 0.4 : v.glowI;
      }
      bodyMat = patternMat(pat.id, pat.pal, coatOpts);
      wingMat = bodyMat;
    } else {
      bodyMat = mat(v.body, {
        roughness: v.rough == null ? 0.72 : v.rough,
        metalness: v.metal || 0,
        emissive: v.glow || 0x000000,
        emissiveIntensity: v.glow ? (v.glowI == null ? 0.22 : v.glowI) : 0
      });
      wingMat = mat(v.wing, {
        roughness: v.rough == null ? 0.74 : v.rough,
        metalness: (v.metal || 0) * 0.7,
        emissive: v.shine ? (v.glow || 0x000000) : 0x000000,
        emissiveIntensity: v.shine ? (v.glowI == null ? 0.4 : v.glowI * 0.7) : 0
      });
    }
    var beakMat = mat(v.beak, { roughness: 0.42 });
    var cheekMat = mat(v.cheek, { roughness: 0.6 });
    var eyeMat = mat(0x2a2a34, { roughness: 0.18, metalness: 0.05 });
    var whiteMat = mat(0xffffff, { roughness: 0.25 });

    /* --- body --- */
    var body = mesh(geo('body', function () { return new T.SphereGeometry(0.6, 30, 22); }), bodyMat);
    body.scale.set(1.0, 0.82, 1.3);
    body.position.set(0, 0.34, 0);
    g.add(body);

    /* --- tail --- */
    var tail = mesh(geo('tail', function () { return new T.ConeGeometry(0.26, 0.54, 14); }), wingMat);
    tail.rotation.x = -1.18;
    tail.position.set(0, 0.54, -0.84);
    tail.scale.set(1.1, 1, 0.72);
    g.add(tail);

    /* --- wings --- */
    var wings = [];
    [-1, 1].forEach(function (s) {
      var w = mesh(geo('wing', function () { return new T.SphereGeometry(0.3, 18, 14); }), wingMat);
      w.scale.set(0.32, 0.56, 1.02);
      w.position.set(0.55 * s, 0.40, -0.04);
      w.rotation.z = -0.22 * s;
      w.rotation.x = 0.06;
      w.userData.baseRotZ = w.rotation.z;
      w.userData.side = s;
      wings.push(w);
      g.add(w);
    });

    /* --- head --- */
    var head = new T.Group();
    head.position.copy(HEAD_CENTER);
    g.add(head);

    var skull = mesh(geo('skull', function () { return new T.SphereGeometry(HEAD_R, 28, 22); }), bodyMat);
    head.add(skull);

    /* beak — a soft rounded duck bill that curves gently downward (no pointy tip) */
    var bill = mesh(geo('bill', function () { return new T.CapsuleGeometry(0.082, 0.24, 7, 20); }), beakMat);
    bill.rotation.x = Math.PI / 2 + 0.06;
    bill.position.set(0, -0.052, 0.53);
    bill.scale.set(1.5, 0.78, 1.0);
    head.add(bill);

    /* rounded spatulate tip, tucked slightly under for the classic duck curve */
    var billTip = mesh(geo('billTip', function () { return new T.SphereGeometry(0.08, 16, 12); }), beakMat);
    billTip.position.set(0, -0.066, 0.66);
    billTip.scale.set(1.62, 0.66, 0.94);
    head.add(billTip);

    /* a subtle "nail" bump on top of the tip */
    var billNail = mesh(geo('billNail', function () { return new T.SphereGeometry(0.028, 10, 8); }), beakMat);
    billNail.position.set(0, -0.03, 0.69);
    billNail.scale.set(1.2, 0.7, 0.9);
    head.add(billNail);

    /* eyes */
    function headPoint(nx, ny, nz, dist) {
      var d = new T.Vector3(nx, ny, nz).normalize().multiplyScalar(dist);
      return d;
    }
    [-1, 1].forEach(function (s) {
      var p = headPoint(0.44 * s, 0.24, 0.86, 0.415);
      var eye = mesh(geo('eye', function () { return new T.SphereGeometry(0.088, 14, 12); }), eyeMat);
      eye.position.copy(p);
      head.add(eye);

      var hp = headPoint(0.30 * s, 0.44, 0.86, 0.45);
      var hi = mesh(geo('eyeHi', function () { return new T.SphereGeometry(0.036, 10, 8); }), whiteMat);
      hi.position.copy(hp);
      head.add(hi);

      /* cheek blush */
      var cp = headPoint(0.82 * s, -0.16, 0.55, 0.41);
      var cheek = mesh(geo('cheek', function () { return new T.SphereGeometry(0.085, 12, 10); }), cheekMat);
      cheek.position.copy(cp);
      cheek.scale.set(1, 0.66, 0.5);
      head.add(cheek);
    });

    g.add(head);

    /* --- accessory holder --- */
    var accGroup = new T.Group();
    g.add(accGroup);

    g.userData = {
      kind: 'duck',
      variant: v,
      pattern: pat,
      accGroup: accGroup,
      parts: { body: body, head: head, wings: wings, tail: tail },
      tick: null
    };

    if (v.shine) {
      var shine = buildShine();
      g.add(shine);
      g.userData.shine = shine;
    }

    DuckKit.applyEquip(g, opts.equip || {});
    return g;
  }

  /* ---------------------------------------------------------
     ACCESSORY BUILDERS
     Each returns a Group positioned relative to its slot anchor.
     --------------------------------------------------------- */
  function hat(baseY) { return baseY; }

  function buildPartyHat() {
    var g = new T.Group();
    var cone = mesh(geo('ph_cone', function () { return new T.ConeGeometry(0.27, 0.62, 20, 1, true); }),
      mat(0xff6f91, { roughness: 0.5, side: T.DoubleSide }));
    cone.position.y = 0.62 / 2 + 0.30;
    g.add(cone);

    // stripes
    [0.16, 0.34, 0.52].forEach(function (h, i) {
      var r = 0.25 * (1 - h / 0.62) + 0.02;
      var ring = mesh(new T.TorusGeometry(r * 1.02, 0.028, 8, 24),
        mat([0xffe066, 0x7ad7f0, 0xb6f0a0][i], { roughness: 0.45 }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = h + 0.30;
      g.add(ring);
    });

    var pom = sphere(0.085, 14, mat(0xffe066, { roughness: 0.9 }), 0, 0.98, 0);
    g.add(pom);
    return g;
  }

  function buildSunHat() {
    var g = new T.Group();
    var straw = mat(0xf7d98a, { roughness: 0.85 });
    var band = mat(0xff8fab, { roughness: 0.6 });

    var brim = mesh(new T.CylinderGeometry(0.80, 0.84, 0.045, 30), straw);
    brim.position.y = 0.34;
    g.add(brim);

    var crown = mesh(new T.CylinderGeometry(0.36, 0.41, 0.26, 26), straw);
    crown.position.y = 0.48;
    g.add(crown);

    var top = mesh(new T.SphereGeometry(0.36, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), straw);
    top.position.y = 0.61;
    top.scale.y = 0.5;
    g.add(top);

    var ribbon = mesh(new T.TorusGeometry(0.395, 0.045, 10, 26), band);
    ribbon.rotation.x = Math.PI / 2;
    ribbon.position.y = 0.39;
    g.add(ribbon);

    var bow = sphere(0.07, 12, band, 0.30, 0.40, 0.28);
    bow.scale.set(1.3, 0.8, 0.7);
    g.add(bow);
    return g;
  }

  function buildFlowerCrown() {
    var g = new T.Group();
    var ring = mesh(new T.TorusGeometry(0.445, 0.042, 10, 30), mat(0x74c69d, { roughness: 0.75 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.30;
    g.add(ring);

    var petalCols = [0xffd3e0, 0xffe8a3, 0xd9c9ff, 0xb6ecff, 0xffc9d6];
    var n = 9;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      var px = Math.cos(a) * 0.445, pz = Math.sin(a) * 0.445;
      var col = petalCols[i % petalCols.length];
      var flower = new T.Group();
      for (var p = 0; p < 5; p++) {
        var pa = (p / 5) * Math.PI * 2;
        var petal = mesh(new T.SphereGeometry(0.055, 10, 8), mat(col, { roughness: 0.6 }),
          Math.cos(pa) * 0.06, 0, Math.sin(pa) * 0.06);
        petal.scale.set(1.25, 0.45, 0.95);
        flower.add(petal);
      }
      flower.add(sphere(0.035, 10, mat(0xffd43b, { roughness: 0.5 }), 0, 0.018, 0));
      flower.position.set(px, 0.30, pz);
      flower.rotation.y = -a;
      flower.rotation.z = 0.22 * Math.cos(a * 2);
      g.add(flower);
    }
    return g;
  }

  function buildCrown() {
    var g = new T.Group();
    var gold = mat(0xffc93c, { roughness: 0.22, metalness: 0.85, envMapIntensity: 1.2 });
    var gem = mat(0xff4d8d, { roughness: 0.12, metalness: 0.1, emissive: 0x3a0018, emissiveIntensity: 0.4 });

    var band = mesh(new T.CylinderGeometry(0.36, 0.375, 0.19, 24, 1, true), gold);
    band.material.side = T.DoubleSide;
    band.position.y = 0.40;
    g.add(band);

    var rim = mesh(new T.TorusGeometry(0.365, 0.032, 8, 28), gold);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.31;
    g.add(rim);

    var spikes = 7;
    for (var i = 0; i < spikes; i++) {
      var a = (i / spikes) * Math.PI * 2;
      var h = i % 2 ? 0.11 : 0.19;
      var sp = mesh(new T.ConeGeometry(0.062, h * 2, 10), gold,
        Math.cos(a) * 0.35, 0.50 + h * 0.5, Math.sin(a) * 0.35);
      g.add(sp);
    }

    for (var j = 0; j < 4; j++) {
      var b = (j / 4) * Math.PI * 2 + 0.4;
      g.add(sphere(0.042, 12, gem, Math.cos(b) * 0.37, 0.40, Math.sin(b) * 0.37));
    }
    return g;
  }

  function buildWizardHat() {
    var g = new T.Group();
    var cloth = mat(0x5a4bd6, { roughness: 0.8 });
    var trim = mat(0xffd93d, { roughness: 0.5, metalness: 0.3 });

    var brim = mesh(new T.CylinderGeometry(0.62, 0.66, 0.05, 26), cloth);
    brim.position.y = 0.31;
    g.add(brim);

    var brimRim = mesh(new T.TorusGeometry(0.64, 0.035, 8, 30), trim);
    brimRim.rotation.x = Math.PI / 2;
    brimRim.position.y = 0.31;
    g.add(brimRim);

    var cone = mesh(new T.ConeGeometry(0.40, 1.0, 22), cloth);
    cone.position.y = 0.83;
    cone.rotation.z = 0.10;
    cone.rotation.x = -0.06;
    g.add(cone);

    var bandC = mesh(new T.TorusGeometry(0.375, 0.045, 8, 26), trim);
    bandC.rotation.x = Math.PI / 2;
    bandC.position.y = 0.38;
    g.add(bandC);

    var star = mesh(extrude(starShape(0.13, 0.055, 5), 0.03), mat(0xfff3b0, { emissive: 0xffd93d, emissiveIntensity: 0.8, roughness: 0.4 }));
    star.position.set(0, 0.42, 0.42);
    g.add(star);

    [0.62, 0.86].forEach(function (y, i) {
      var s2 = mesh(extrude(starShape(0.075, 0.03, 5), 0.025), mat(0xfff3b0, { emissive: 0xffd93d, emissiveIntensity: 0.6 }));
      var a = i ? 2.2 : -1.1;
      s2.position.set(Math.cos(a) * 0.24, y, Math.sin(a) * 0.24);
      s2.rotation.y = -a + Math.PI / 2;
      g.add(s2);
    });

    var tip = sphere(0.07, 12, trim, 0.13, 1.32, 0);
    g.add(tip);
    return g;
  }

  function buildPropellerCap() {
    var g = new T.Group();
    var red = mat(0xef5b62, { roughness: 0.6 });
    var blue = mat(0x4aa8e0, { roughness: 0.6 });
    var white = mat(0xfdfdfd, { roughness: 0.5 });

    var dome = mesh(new T.SphereGeometry(0.43, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), blue);
    dome.position.y = 0.30;
    dome.scale.y = 0.95;
    g.add(dome);

    var band = mesh(new T.TorusGeometry(0.425, 0.045, 10, 28), white);
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.30;
    g.add(band);

    /* brim at the front */
    var brim = mesh(new T.CylinderGeometry(0.30, 0.30, 0.04, 20, 1, false, -Math.PI / 2, Math.PI), red);
    brim.position.set(0, 0.29, 0.30);
    brim.scale.z = 0.9;
    g.add(brim);

    /* propeller */
    var stalk = mesh(new T.CylinderGeometry(0.02, 0.02, 0.14, 8), mat(0x9aa7b3, { metalness: 0.6, roughness: 0.35 }));
    stalk.position.y = 0.74;
    g.add(stalk);

    var prop = new T.Group();
    prop.position.y = 0.82;
    [0, Math.PI / 2].forEach(function (a) {
      var blade = mesh(new T.BoxGeometry(0.34, 0.02, 0.075), red, 0, 0, 0);
      blade.rotation.y = a;
      prop.add(blade);
    });
    prop.add(sphere(0.045, 12, mat(0xffd93d, { roughness: 0.4 }), 0, 0.02, 0));
    g.add(prop);

    g.userData.tick = function (t) { prop.rotation.y = t * 7; };
    return g;
  }

  function buildBeanie() {
    var g = new T.Group();
    var yarn = mat(0xff8fa3, { roughness: 0.95 });
    var yarn2 = mat(0xfff0f3, { roughness: 0.95 });

    var dome = mesh(new T.SphereGeometry(0.435, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), yarn);
    dome.position.y = 0.28;
    dome.scale.y = 1.02;
    g.add(dome);

    var fold = mesh(new T.TorusGeometry(0.425, 0.075, 12, 28), yarn2);
    fold.rotation.x = Math.PI / 2;
    fold.position.y = 0.31;
    g.add(fold);

    g.add(sphere(0.11, 14, yarn2, 0, 0.80, 0));
    return g;
  }

  /* --- face --- */
  function buildSunglasses() {
    var g = new T.Group();
    var frame = mat(0x2d3440, { roughness: 0.3, metalness: 0.35 });
    var lens = mat(0x2b3a55, { roughness: 0.08, metalness: 0.55, transparent: true, opacity: 0.86 });

    [-1, 1].forEach(function (s) {
      var l = mesh(new T.BoxGeometry(0.24, 0.17, 0.05), lens, 0.20 * s, 0.07, 0.40);
      l.rotation.y = -0.24 * s;
      g.add(l);

      var fr = mesh(new T.BoxGeometry(0.28, 0.21, 0.035), frame, 0.20 * s, 0.07, 0.375);
      fr.rotation.y = -0.24 * s;
      g.add(fr);

      var arm = mesh(new T.BoxGeometry(0.03, 0.028, 0.34), frame, 0.30 * s, 0.09, 0.22);
      arm.rotation.y = -0.5 * s;
      g.add(arm);
    });

    var bridge = mesh(new T.BoxGeometry(0.12, 0.032, 0.04), frame, 0, 0.09, 0.42);
    g.add(bridge);
    return g;
  }

  function buildStarGlasses() {
    var g = new T.Group();
    var frame = mat(0xff5fa2, { roughness: 0.35, metalness: 0.25 });
    var lens = mat(0xffe066, { roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.9, emissive: 0x3a2a00, emissiveIntensity: 0.3 });

    [-1, 1].forEach(function (s) {
      var st = mesh(extrude(starShape(0.20, 0.095, 5), 0.03, 6), lens, 0.235 * s, 0.08, 0.40);
      st.rotation.y = -0.3 * s;
      g.add(st);

      var arm = mesh(new T.BoxGeometry(0.032, 0.03, 0.34), frame, 0.31 * s, 0.09, 0.21);
      arm.rotation.y = -0.5 * s;
      g.add(arm);
    });

    g.add(mesh(new T.BoxGeometry(0.10, 0.03, 0.035), frame, 0, 0.09, 0.43));
    return g;
  }

  function buildHeartShades() {
    var g = new T.Group();
    var frame = mat(0xf25f8f, { roughness: 0.35 });
    var lens = mat(0xff9ec4, { roughness: 0.1, transparent: true, opacity: 0.88 });

    [-1, 1].forEach(function (s) {
      var h = mesh(extrude(heartShape(0.16), 0.032, 10), lens, 0.22 * s, 0.09, 0.40);
      h.rotation.y = -0.3 * s;
      h.rotation.z = Math.PI;
      g.add(h);

      var arm = mesh(new T.BoxGeometry(0.032, 0.03, 0.34), frame, 0.30 * s, 0.10, 0.21);
      arm.rotation.y = -0.5 * s;
      g.add(arm);
    });
    g.add(mesh(new T.BoxGeometry(0.10, 0.03, 0.035), frame, 0, 0.10, 0.43));
    return g;
  }

  /* --- neck --- */
  function buildScarf() {
    var g = new T.Group();
    var wool = mat(0xe4574f, { roughness: 0.95 });
    var wool2 = mat(0xf6e6c8, { roughness: 0.95 });

    var loop = mesh(new T.TorusGeometry(0.40, 0.105, 12, 26), wool);
    loop.rotation.x = Math.PI / 2;
    loop.position.y = 0.02;
    g.add(loop);

    var loop2 = mesh(new T.TorusGeometry(0.40, 0.09, 12, 26), wool2);
    loop2.rotation.x = Math.PI / 2;
    loop2.position.y = 0.055;
    g.add(loop2);

    var tail = mesh(new T.BoxGeometry(0.19, 0.46, 0.075), wool, 0.13, -0.20, 0.36);
    tail.rotation.x = 0.16;
    tail.rotation.z = 0.08;
    g.add(tail);

    var fringe = mesh(new T.BoxGeometry(0.195, 0.06, 0.08), wool2, 0.13, -0.44, 0.40);
    fringe.rotation.x = 0.16;
    g.add(fringe);
    return g;
  }

  function buildBowtie() {
    var g = new T.Group();
    var c = mat(0x3ba7d6, { roughness: 0.45 });
    [-1, 1].forEach(function (s) {
      var wing = mesh(new T.ConeGeometry(0.14, 0.24, 4), c, 0.13 * s, 0.06, 0.34);
      wing.rotation.z = (Math.PI / 2) * s;
      wing.rotation.y = Math.PI / 4;
      wing.scale.set(1, 1, 0.45);
      g.add(wing);
    });
    g.add(sphere(0.062, 12, mat(0x1e7fa8, { roughness: 0.4 }), 0, 0.06, 0.34));
    var collar = mesh(new T.TorusGeometry(0.33, 0.035, 8, 22), mat(0xffffff, { roughness: 0.5 }));
    collar.rotation.x = Math.PI / 2;
    collar.position.y = -0.02;
    g.add(collar);
    return g;
  }

  function buildPearls() {
    var g = new T.Group();
    var pearl = mat(0xfff9ec, { roughness: 0.12, metalness: 0.25, envMapIntensity: 1.1 });
    var n = 16;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      var r = 0.375;
      g.add(sphere(0.052, 12, pearl, Math.cos(a) * r, -0.02 - Math.abs(Math.cos(a)) * 0.02, Math.sin(a) * r));
    }
    g.add(mesh(extrude(heartShape(0.075), 0.03, 8), mat(0xf07aa8, { roughness: 0.2, metalness: 0.3 }),
      0, -0.20, 0.42));
    return g;
  }

  /* --- back --- */
  function buildBackpack() {
    var g = new T.Group();
    var cloth = mat(0x6ec6a8, { roughness: 0.85 });
    var strap = mat(0x4b9c81, { roughness: 0.85 });
    var metal = mat(0xd8dde2, { metalness: 0.7, roughness: 0.3 });

    var bag = mesh(geo('bp_bag', function () { return new T.SphereGeometry(0.30, 18, 14); }), cloth, 0, 0.02, -0.34);
    bag.scale.set(0.86, 1.05, 0.62);
    g.add(bag);

    var flap = mesh(new T.BoxGeometry(0.32, 0.14, 0.20), strap, 0, 0.16, -0.34);
    flap.rotation.x = 0.25;
    g.add(flap);

    var buckle = mesh(new T.TorusGeometry(0.045, 0.016, 8, 14), metal, 0, 0.04, -0.52);
    g.add(buckle);

    [-1, 1].forEach(function (s) {
      var st = mesh(new T.BoxGeometry(0.06, 0.34, 0.05), strap, 0.20 * s, 0.10, -0.12);
      st.rotation.x = -0.35;
      st.rotation.z = 0.2 * s;
      g.add(st);
    });

    var pocket = mesh(new T.BoxGeometry(0.20, 0.14, 0.06), strap, 0, -0.10, -0.50);
    pocket.rotation.x = -0.15;
    g.add(pocket);
    return g;
  }

  function buildCape() {
    var g = new T.Group();
    var cloth = mat(0xe0447a, { roughness: 0.8, side: T.DoubleSide });
    var trim = mat(0xffd93d, { roughness: 0.5, metalness: 0.3 });

    var shape = new T.Shape();
    shape.moveTo(-0.46, 0);
    shape.lineTo(0.46, 0);
    shape.quadraticCurveTo(0.52, -0.55, 0.34, -0.95);
    shape.quadraticCurveTo(0, -1.08, -0.34, -0.95);
    shape.quadraticCurveTo(-0.52, -0.55, -0.46, 0);

    var cape = mesh(new T.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false, curveSegments: 12 }), cloth);
    cape.position.set(0, 0.30, -0.42);
    cape.rotation.x = -0.1;
    g.add(cape);

    var star = mesh(extrude(starShape(0.15, 0.062, 5), 0.03), trim, 0, -0.16, -0.34);
    star.rotation.y = Math.PI;
    g.add(star);

    var collar = mesh(new T.TorusGeometry(0.36, 0.04, 8, 24, Math.PI * 1.35), trim);
    collar.rotation.x = Math.PI / 2;
    collar.rotation.z = Math.PI * 0.82;
    collar.position.y = 0.28;
    g.add(collar);
    return g;
  }

  function buildBubbleTank() {
    var g = new T.Group();
    var glass = mat(0xbfe9ff, { roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.5 });
    var cap = mat(0x9aa7b3, { metalness: 0.7, roughness: 0.3 });

    [-1, 1].forEach(function (s) {
      var tube = mesh(new T.CylinderGeometry(0.10, 0.10, 0.52, 16, 1, true), glass, 0.19 * s, 0.06, -0.40);
      tube.material.side = T.DoubleSide;
      g.add(tube);
      g.add(mesh(new T.CylinderGeometry(0.115, 0.115, 0.05, 16), cap, 0.19 * s, 0.33, -0.40));
      g.add(mesh(new T.SphereGeometry(0.108, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0.19 * s, -0.20, -0.40));
      for (var i = 0; i < 3; i++) {
        g.add(sphere(0.035 + Math.random() * 0.02, 10,
          mat(0xffffff, { transparent: true, opacity: 0.6, roughness: 0.05 }),
          0.19 * s + (Math.random() - 0.5) * 0.1, -0.14 + i * 0.16, -0.40));
      }
    });
    return g;
  }

  /* --- held --- */
  function buildDaisy() {
    var g = new T.Group();
    var stem = mesh(new T.CylinderGeometry(0.022, 0.026, 0.62, 8), mat(0x5cb85c, { roughness: 0.8 }), 0, 0.16, 0);
    stem.rotation.z = -0.12;
    g.add(stem);

    var head = new T.Group();
    head.position.set(-0.07, 0.47, 0);
    head.rotation.z = -0.12;
    for (var i = 0; i < 8; i++) {
      var a = (i / 8) * Math.PI * 2;
      var petal = mesh(new T.SphereGeometry(0.062, 10, 8), mat(0xfffdf5, { roughness: 0.5 }),
        Math.cos(a) * 0.085, Math.sin(a) * 0.085, 0);
      petal.scale.set(1.35, 0.55, 0.4);
      petal.rotation.z = a;
      head.add(petal);
    }
    head.add(sphere(0.058, 12, mat(0xffd93d, { roughness: 0.45 }), 0, 0, 0.01));
    g.add(head);

    var leaf = mesh(new T.SphereGeometry(0.075, 10, 8), mat(0x6cc26c, { roughness: 0.8 }), 0.07, 0.02, 0.01);
    leaf.scale.set(1.5, 0.3, 0.7);
    leaf.rotation.z = -0.5;
    g.add(leaf);
    return g;
  }

  function buildBubbleWand() {
    var g = new T.Group();
    var rod = mesh(new T.CylinderGeometry(0.026, 0.03, 0.60, 10), mat(0xff9ec4, { roughness: 0.45 }), 0, 0.20, 0);
    rod.rotation.z = -0.18;
    g.add(rod);

    var ring = mesh(new T.TorusGeometry(0.13, 0.026, 8, 22), mat(0xffb3d1, { roughness: 0.4 }));
    ring.position.set(-0.10, 0.50, 0);
    g.add(ring);

    var bubbles = [];
    for (var i = 0; i < 3; i++) {
      var b = sphere(0.05 + i * 0.016, 12,
        mat(0xe8f9ff, { transparent: true, opacity: 0.62, roughness: 0.03, metalness: 0.1 }),
        -0.10 + (i - 1) * 0.13, 0.66 + i * 0.10, (i - 1) * 0.05);
      bubbles.push({ o: b, base: b.position.clone(), ph: i * 1.7 });
      g.add(b);
    }
    g.userData.tick = function (t) {
      bubbles.forEach(function (b) {
        b.o.position.y = b.base.y + Math.sin(t * 2 + b.ph) * 0.05;
        b.o.position.x = b.base.x + Math.cos(t * 1.4 + b.ph) * 0.03;
      });
    };
    return g;
  }

  function buildBalloon() {
    var g = new T.Group();
    var string = mesh(new T.CylinderGeometry(0.008, 0.008, 0.42, 6), mat(0xf2f2f2, { roughness: 0.9 }), 0, 0.34, 0);
    g.add(string);

    var bal = mesh(new T.SphereGeometry(0.24, 20, 16), mat(0xff6b8a, { roughness: 0.18, metalness: 0.12 }), 0, 0.74, 0);
    bal.scale.set(1, 1.12, 1);
    g.add(bal);

    var knot = mesh(new T.ConeGeometry(0.05, 0.07, 8), mat(0xe04f6f, { roughness: 0.3 }), 0, 0.47, 0);
    knot.rotation.x = Math.PI;
    g.add(knot);

    var shine = sphere(0.055, 12, mat(0xffffff, { roughness: 0.1, transparent: true, opacity: 0.75 }), 0.08, 0.83, 0.14);
    shine.scale.set(1, 1.4, 0.6);
    g.add(shine);

    g.userData.tick = function (t) {
      g.rotation.z = Math.sin(t * 1.2) * 0.09;
      bal.position.y = 0.74 + Math.sin(t * 1.6) * 0.02;
    };
    return g;
  }

  /* ---------------------------------------------------------
     CATALOG
     --------------------------------------------------------- */
  var CATEGORIES = [
    { id: 'all', name: 'All', emoji: '✨' },
    { id: 'head', name: 'Hats', emoji: '🎩' },
    { id: 'face', name: 'Face', emoji: '🕶️' },
    { id: 'neck', name: 'Neck', emoji: '🧣' },
    { id: 'back', name: 'Back', emoji: '🎒' },
    { id: 'held', name: 'Toys', emoji: '🧸' }
  ];

  var SLOT_INFO = {
    head: { name: 'Hat', emoji: '🎩' },
    face: { name: 'Face', emoji: '🕶️' },
    neck: { name: 'Neck', emoji: '🧣' },
    back: { name: 'Back', emoji: '🎒' },
    held: { name: 'Toy', emoji: '🧸' }
  };

  var CATALOG = [
    { id: 'flower_crown', name: 'Flower Crown', cat: 'head', price: 12, emoji: '🌸', rarity: 'common', build: buildFlowerCrown,
      desc: 'A ring of springtime blossoms.' },
    { id: 'party_hat', name: 'Party Hat', cat: 'head', price: 18, emoji: '🎉', rarity: 'common', build: buildPartyHat,
      desc: 'It is always a duck birthday.' },
    { id: 'beanie', name: 'Cosy Beanie', cat: 'head', price: 20, emoji: '🧶', rarity: 'common', build: buildBeanie,
      desc: 'Knitted by a very patient grandma.' },
    { id: 'sun_hat', name: 'Sun Hat', cat: 'head', price: 24, emoji: '👒', rarity: 'common', build: buildSunHat,
      desc: 'Wide brim, zero sunburn.' },
    { id: 'propeller_cap', name: 'Propeller Cap', cat: 'head', price: 36, emoji: '🚁', rarity: 'uncommon', build: buildPropellerCap,
      desc: 'Spins when the duck gets excited.' },
    { id: 'wizard_hat', name: 'Wizard Hat', cat: 'head', price: 45, emoji: '🧙', rarity: 'uncommon', build: buildWizardHat,
      desc: 'Grants +2 to pond mischief.' },
    { id: 'crown', name: 'Royal Crown', cat: 'head', price: 60, emoji: '👑', rarity: 'epic', build: buildCrown,
      desc: 'Ruler of the whole pond.' },

    { id: 'sunglasses', name: 'Cool Shades', cat: 'face', price: 20, emoji: '😎', rarity: 'common', build: buildSunglasses,
      desc: 'Too cool for the pond.' },
    { id: 'heart_shades', name: 'Heart Shades', cat: 'face', price: 22, emoji: '💖', rarity: 'common', build: buildHeartShades,
      desc: 'Sees the world in pink.' },
    { id: 'star_glasses', name: 'Star Glasses', cat: 'face', price: 26, emoji: '🌟', rarity: 'uncommon', build: buildStarGlasses,
      desc: 'Every duck is a superstar.' },

    { id: 'bowtie', name: 'Dapper Bowtie', cat: 'neck', price: 14, emoji: '🎀', rarity: 'common', build: buildBowtie,
      desc: 'For formal pond occasions.' },
    { id: 'scarf', name: 'Snuggly Scarf', cat: 'neck', price: 16, emoji: '🧣', rarity: 'common', build: buildScarf,
      desc: 'Warm as a feather duvet.' },
    { id: 'pearls', name: 'Pearl Necklace', cat: 'neck', price: 28, emoji: '📿', rarity: 'uncommon', build: buildPearls,
      desc: 'Naturally pond-proof pearls.' },

    { id: 'cape', name: 'Hero Cape', cat: 'back', price: 34, emoji: '🦸', rarity: 'uncommon', build: buildCape,
      desc: 'Flaps dramatically in the wind.' },
    { id: 'backpack', name: 'Tiny Backpack', cat: 'back', price: 40, emoji: '🎒', rarity: 'uncommon', build: buildBackpack,
      desc: 'Holds exactly one breadcrumb.' },
    { id: 'bubble_tank', name: 'Bubble Tanks', cat: 'back', price: 52, emoji: '🫧', rarity: 'rare', build: buildBubbleTank,
      desc: 'Deep-sea duck explorer.' },

    { id: 'daisy', name: 'Little Daisy', cat: 'held', price: 10, emoji: '🌼', rarity: 'common', build: buildDaisy,
      desc: 'A shy little gift for a friend.' },
    { id: 'bubble_wand', name: 'Bubble Wand', cat: 'held', price: 30, emoji: '🪄', rarity: 'uncommon', build: buildBubbleWand,
      desc: 'Blows the roundest bubbles.' },
    { id: 'balloon', name: 'Red Balloon', cat: 'held', price: 32, emoji: '🎈', rarity: 'uncommon', build: buildBalloon,
      desc: 'Never, ever let go.' }
  ];

  /* =========================================================
     PARAMETRIC SHOP — a small kit of multi-purpose builders,
     combined with palettes so every category has a deep and
     varied catalogue.  Each entry wraps a builder with options.
     ========================================================= */
  function fam(cat, build, variants, defDesc) {
    variants.forEach(function (v) {
      var opts = v.opts || {};
      CATALOG.push({
        id: v.id, name: v.name, cat: cat, price: v.price, emoji: v.emoji,
        rarity: v.rarity || 'common', desc: v.desc || defDesc || '',
        build: (function (o) { return function () { return build(o); }; })(opts)
      });
    });
  }

  /* --- eyewear: real frames, lenses and temple arms ---------- */
  function eyewearOutline(kind, hw, hh, seg) {
    seg = seg || 30;
    var p = [], i, a, n;
    if (kind === 'heart') {
      n = seg;
      for (i = 0; i < n; i++) {
        a = (i / n) * Math.PI * 2;
        var hx = 16 * Math.pow(Math.sin(a), 3);
        var hy = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a);
        p.push([hx / 16 * hw, hy / 17 * hh + hh * 0.08]);
      }
      return p;
    }
    if (kind === 'star') {
      n = 10;
      for (i = 0; i < n; i++) {
        a = (i / n) * Math.PI * 2 - Math.PI / 2;
        var rr = (i % 2) ? 0.46 : 1.0;
        p.push([Math.cos(a) * hw * rr, Math.sin(a) * hh * rr]);
      }
      return p;
    }
    if (kind === 'hex') {
      for (i = 0; i < 6; i++) { a = (i / 6) * Math.PI * 2 + Math.PI / 6; p.push([Math.cos(a) * hw, Math.sin(a) * hh]); }
      return p;
    }
    if (kind === 'rect') {
      var r2 = Math.min(hw, hh) * 0.42, k = 5;
      var cs = [[hw - r2, hh - r2], [-(hw - r2), hh - r2], [-(hw - r2), -(hh - r2)], [hw - r2, -(hh - r2)]];
      var starts = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
      for (var c = 0; c < 4; c++) {
        for (i = 0; i <= k; i++) {
          a = starts[c] + (i / k) * (Math.PI / 2);
          p.push([cs[c][0] + Math.cos(a) * r2, cs[c][1] + Math.sin(a) * r2]);
        }
      }
      return p;
    }
    if (kind === 'cat') {
      return [[-hw, hh * 0.05], [-hw * 0.7, hh * 0.9], [hw * 0.3, hh * 0.72],
        [hw * 1.05, hh * 1.2], [hw, -hh * 0.15], [hw * 0.4, -hh], [-hw * 0.6, -hh * 0.85]];
    }
    if (kind === 'aviator') {
      return [[-hw, hh * 0.5], [-hw * 0.6, hh], [hw * 0.6, hh * 0.95], [hw, hh * 0.15],
        [hw * 0.8, -hh * 0.75], [0, -hh], [-hw * 0.85, -hh * 0.6]];
    }
    if (kind === 'captain') {
      return [[-hw, hh * 0.35], [-hw * 0.5, hh], [hw * 0.5, hh], [hw, hh * 0.35],
        [hw * 0.95, -hh * 0.5], [0, -hh * 1.05], [-hw * 0.95, -hh * 0.5]];
    }
    if (kind === 'shield') {
      return [[-hw, hh * 0.7], [0, hh], [hw, hh * 0.7], [hw * 0.9, -hh * 0.5], [0, -hh], [-hw * 0.9, -hh * 0.5]];
    }
    for (i = 0; i < seg; i++) { a = (i / seg) * Math.PI * 2; p.push([Math.cos(a) * hw, Math.sin(a) * hh]); }
    return p;
  }

  function shapeFromPts(pts) {
    var s = new T.Shape();
    if (!pts || !pts.length) return s;
    s.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
    s.closePath();
    return s;
  }
  function pathFromPts(pts) {
    var s = new T.Path();
    if (!pts || !pts.length) return s;
    s.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
    s.closePath();
    return s;
  }

  function buildEyewear(o) {
    o = o || {};
    var kind = o.shape || 'round';
    var hw = o.w || 0.105, hh = o.h || 0.088;
    var frameMat = mat(o.frame == null ? 0x2d3440 : o.frame, {
      roughness: o.frameRough == null ? 0.35 : o.frameRough,
      metalness: o.frameMetal == null ? 0.35 : o.frameMetal
    });
    var lensMat = mat(o.lens == null ? 0x2b3a55 : o.lens, {
      roughness: 0.06, metalness: 0.55, transparent: true, opacity: o.opacity == null ? 0.55 : o.opacity
    });
    var g = new T.Group();
    var sx = o.spread || (hw * 1.78 + 0.012);
    var y0 = o.y == null ? 0.10 : o.y;
    var z0 = o.z == null ? 0.40 : o.z;
    var yaw = o.yaw == null ? 0.30 : o.yaw;
    var sides = o.single ? [1] : [-1, 1];
    var dt = o.depth == null ? 0.05 : o.depth;

    sides.forEach(function (s) {
      var pivot = new T.Group();
      pivot.position.set(sx * s, y0, z0);
      pivot.rotation.y = -yaw * s;
      g.add(pivot);

      if (!o.rimless) {
        var outer = shapeFromPts(eyewearOutline(kind, hw, hh));
        outer.holes.push(pathFromPts(eyewearOutline(kind, hw * 0.8, hh * 0.78)));
        var ring = mesh(new T.ExtrudeGeometry(outer, { depth: dt, bevelEnabled: false, curveSegments: 6 }), frameMat);
        ring.position.z = -dt / 2;
        pivot.add(ring);
      }
      var lens = mesh(new T.ExtrudeGeometry(shapeFromPts(eyewearOutline(kind, hw * 0.82, hh * 0.8)),
        { depth: 0.018, bevelEnabled: false, curveSegments: 6 }), lensMat);
      lens.position.z = -0.006;
      lens.castShadow = false;
      pivot.add(lens);
    });

    if (!o.single) {
      var bridge = mesh(new T.BoxGeometry(Math.max(0.03, sx * 2 - hw * 1.9), 0.028, dt), frameMat);
      bridge.position.set(0, y0 + hh * 0.55, z0 - dt / 2 + 0.01);
      g.add(bridge);
    }

    sides.forEach(function (s) {
      var hinge = new T.Vector3(sx * s + hw * 0.92 * s, y0 + hh * 0.12, z0 - 0.03);
      var curve = new T.CatmullRomCurve3([
        hinge.clone(),
        new T.Vector3(0.43 * s, y0 + hh * 0.4, 0.13),
        new T.Vector3(0.33 * s, y0 + hh * 0.2, -0.17)
      ]);
      g.add(mesh(new T.TubeGeometry(curve, 8, 0.015, 6, false), frameMat));
      var h = mesh(new T.SphereGeometry(0.025, 8, 6), frameMat);
      h.position.copy(hinge);
      g.add(h);
    });

    if (o.single && o.chain) {
      var ch = new T.CatmullRomCurve3([
        new T.Vector3(sx + hw * 0.9, y0 + hh * 0.4, z0),
        new T.Vector3(sx + hw * 1.1, y0 - hh * 1.4, z0 - 0.05),
        new T.Vector3(sx + hw * 0.7, y0 - hh * 2.6, z0 - 0.04)
      ]);
      g.add(mesh(new T.TubeGeometry(ch, 10, 0.009, 5, false), mat(0xffd166, { roughness: 0.4, metalness: 0.6 })));
      g.add(sphere(0.02, 8, mat(0xffd166, { roughness: 0.4, metalness: 0.6 }), sx + hw * 0.7, y0 - hh * 2.75, z0 - 0.04));
    }
    return g;
  }

  /* --- generic bits ------------------------------------------ */
  function band(y, tube, colour, rough) {
    var r = mesh(new T.TorusGeometry(0.40, tube || 0.05, 10, 28), mat(colour, { roughness: rough == null ? 0.7 : rough }));
    r.rotation.x = Math.PI / 2;
    r.position.y = y;
    return r;
  }
  function stud(r, colour, x, y, z, rough) {
    return sphere(r, 12, mat(colour, { roughness: rough == null ? 0.4 : rough }), x, y, z);
  }
  function tubeBetween(a, b, r, colour, rough) {
    var dir = new T.Vector3().subVectors(b, a);
    var len = dir.length();
    var m = mesh(new T.CylinderGeometry(r, r, len, 8), mat(colour, { roughness: rough == null ? 0.6 : rough }));
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.clone().normalize());
    return m;
  }

  /* =========================================================
     HEAD
     ========================================================= */
  function buildCap2(o) {
    var g = new T.Group();
    var c = mat(o.c, { roughness: 0.82 });
    var dome = mesh(new T.SphereGeometry(0.42, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.56), c);
    dome.position.y = 0.30; g.add(dome);
    var brim = mesh(new T.SphereGeometry(0.33, 20, 10), c);
    brim.scale.set(1.0, 0.12, 1.3);
    brim.position.set(0, 0.31, 0.17); brim.rotation.x = 0.12; g.add(brim);
    g.add(stud(0.055, o.c2 == null ? 0xffffff : o.c2, 0, 0.60, 0, 0.6));
    return g;
  }
  function buildKnitHat(o) {
    var g = new T.Group();
    var c = mat(o.c, { roughness: 0.96 });
    var dome = mesh(new T.SphereGeometry(0.435, 22, 16, 0, Math.PI * 2, 0, Math.PI / 2), c);
    dome.position.y = 0.28; dome.scale.y = 1.04; g.add(dome);
    g.add(band(0.31, 0.075, o.c2 == null ? 0xfff0f3 : o.c2, 0.95));
    g.add(stud(0.11, o.pom === false ? o.c : (o.c2 == null ? 0xfff0f3 : o.c2), 0, 0.80, 0, 0.95));
    return g;
  }
  function buildTopHat(o) {
    var g = new T.Group();
    var c = mat(o.c, { roughness: 0.5, metalness: 0.1 });
    var brim = mesh(new T.CylinderGeometry(0.44, 0.46, 0.04, 26), c);
    brim.position.y = 0.34; g.add(brim);
    var crown = mesh(new T.CylinderGeometry(0.30, 0.32, 0.7, 26), c);
    crown.position.y = 0.70; g.add(crown);
    g.add(band(0.40, 0.045, o.c2 == null ? 0xff5d5d : o.c2, 0.5));
    return g;
  }
  function buildBucketHat(o) {
    var g = new T.Group();
    var c = mat(o.c, { roughness: 0.9 });
    var dome = mesh(new T.SphereGeometry(0.36, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.6), c);
    dome.position.y = 0.28; g.add(dome);
    var brim = mesh(new T.CylinderGeometry(0.30, 0.46, 0.22, 26, 1, true), c);
    brim.position.y = 0.20; g.add(brim);
    return g;
  }
  function buildCowboyHat(o) {
    var g = new T.Group();
    var c = mat(o.c, { roughness: 0.85 });
    var brim = mesh(new T.CylinderGeometry(0.62, 0.66, 0.05, 26), c);
    brim.position.y = 0.30; g.add(brim);
    var brimEdge = mesh(new T.TorusGeometry(0.63, 0.03, 8, 26), c);
    brimEdge.rotation.x = Math.PI / 2; brimEdge.position.y = 0.30; g.add(brimEdge);
    var crown = mesh(new T.SphereGeometry(0.34, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), c);
    crown.position.y = 0.34; crown.scale.set(1, 1.15, 0.9); g.add(crown);
    g.add(band(0.42, 0.05, o.c2 == null ? 0x6b4423 : o.c2, 0.8));
    return g;
  }
  function buildBeret(o) {
    var g = new T.Group();
    var c = mat(o.c, { roughness: 0.9 });
    var dome = mesh(new T.SphereGeometry(0.42, 20, 12), c);
    dome.scale.set(1, 0.42, 1); dome.position.y = 0.42; dome.rotation.x = 0.12; g.add(dome);
    g.add(stud(0.05, 0x2a2a34, 0, 0.58, 0, 0.5));
    return g;
  }
  function buildVisor(o) {
    var g = new T.Group();
    var c = mat(o.c, { roughness: 0.6 });
    g.add(band(0.30, 0.06, o.c, 0.6));
    var brim = mesh(new T.SphereGeometry(0.34, 20, 10), c);
    brim.scale.set(1.05, 0.10, 1.3); brim.position.set(0, 0.28, 0.18); brim.rotation.x = 0.14;
    g.add(brim);
    return g;
  }
  function buildHeadphones(o) {
    var g = new T.Group();
    var c = mat(o.c, { roughness: 0.45, metalness: 0.3 });
    var pad = mat(o.pad == null ? 0x2a2a34 : o.pad, { roughness: 0.9 });
    var arc = mesh(new T.TorusGeometry(0.46, 0.045, 10, 24, Math.PI), c);
    arc.position.y = 0.16; g.add(arc);
    [-1, 1].forEach(function (s) {
      var cup = mesh(new T.CylinderGeometry(0.16, 0.16, 0.11, 20), c);
      cup.rotation.z = Math.PI / 2; cup.position.set(0.44 * s, 0.18, 0); g.add(cup);
      var ring = mesh(new T.TorusGeometry(0.155, 0.035, 8, 18), pad);
      ring.rotation.y = Math.PI / 2; ring.position.set(0.49 * s, 0.18, 0); g.add(ring);
    });
    return g;
  }
  function buildBow(o) {
    var g = new T.Group();
    var c = mat(o.c, { roughness: 0.6 });
    var knot = mesh(new T.SphereGeometry(0.075, 12, 10), c);
    knot.position.set(0, 0.42, 0.30); g.add(knot);
    [-1, 1].forEach(function (s) {
      var loop = mesh(new T.TorusGeometry(0.12, 0.05, 8, 18), c);
      loop.scale.set(1, 0.75, 0.6);
      loop.position.set(0.14 * s, 0.44, 0.29);
      loop.rotation.set(0, 0, s > 0 ? -0.5 : 0.5);
      g.add(loop);
    });
    return g;
  }
  function buildChefHat(o) {
    var g = new T.Group();
    var col = o.c == null ? 0xffffff : o.c;
    var c = mat(col, { roughness: 0.95 });
    g.add(band(0.36, 0.16, col, 0.95));
    var puff = mesh(new T.SphereGeometry(0.40, 18, 14), c);
    puff.position.y = 0.78; puff.scale.set(1, 0.85, 1); g.add(puff);
    for (var i = 0; i < 5; i++) {
      var a = (i / 5) * Math.PI * 2;
      g.add(stud(0.13, col, Math.cos(a) * 0.28, 0.88, Math.sin(a) * 0.28, 0.95));
    }
    return g;
  }
  function buildGradCap(o) {
    var g = new T.Group();
    var col = o.c == null ? 0x2a2a34 : o.c;
    var c = mat(col, { roughness: 0.6 });
    var base = mesh(new T.CylinderGeometry(0.30, 0.34, 0.18, 20), c);
    base.position.y = 0.32; g.add(base);
    var board = mesh(new T.BoxGeometry(0.66, 0.035, 0.66), c);
    board.position.y = 0.44; board.rotation.y = Math.PI / 4; g.add(board);
    g.add(stud(0.05, 0xffd166, 0, 0.47, 0, 0.4));
    g.add(tubeBetween(new T.Vector3(0, 0.46, 0), new T.Vector3(0.28, 0.24, 0.14), 0.012, 0xffd166, 0.5));
    g.add(stud(0.04, 0xffd166, 0.28, 0.22, 0.14, 0.5));
    return g;
  }
  function buildViking(o) {
    var g = new T.Group();
    var c = mat(o.c == null ? 0xb9c2cc : o.c, { roughness: 0.4, metalness: 0.55 });
    var dome = mesh(new T.SphereGeometry(0.42, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), c);
    dome.position.y = 0.30; g.add(dome);
    var nose = mesh(new T.BoxGeometry(0.05, 0.22, 0.06), c);
    nose.position.set(0, 0.28, 0.42); g.add(nose);
    [-1, 1].forEach(function (s) {
      var horn = mesh(new T.ConeGeometry(0.075, 0.42, 12), mat(0xfff3d0, { roughness: 0.6 }));
      horn.position.set(0.42 * s, 0.52, 0);
      horn.rotation.z = -0.8 * s;
      g.add(horn);
    });
    return g;
  }
  function buildHalo(o) {
    var g = new T.Group();
    var col = o.c == null ? 0xffe066 : o.c;
    var ring = mesh(new T.TorusGeometry(0.34, 0.035, 10, 30),
      mat(col, { roughness: 0.3, metalness: 0.7, emissive: col, emissiveIntensity: 0.5 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.72;
    g.add(ring);
    g.userData.tick = function (t) { ring.position.y = 0.72 + Math.sin(t * 2) * 0.02; ring.rotation.z = t * 0.6; };
    return g;
  }
  function buildAntennae(o) {
    var g = new T.Group();
    var c = mat(o.c == null ? 0x2a2a34 : o.c, { roughness: 0.6 });
    [-1, 1].forEach(function (s) {
      var stem = mesh(new T.CylinderGeometry(0.016, 0.02, 0.34, 8), c);
      stem.position.set(0.16 * s, 0.66, 0); stem.rotation.z = -0.35 * s; g.add(stem);
      g.add(stud(0.06, o.ball == null ? 0xff5d5d : o.ball, 0.22 * s, 0.84, 0, 0.5));
    });
    return g;
  }
  function buildEarmuffs(o) {
    var g = new T.Group();
    var c = mat(o.c, { roughness: 0.9 });
    var arc = mesh(new T.TorusGeometry(0.46, 0.035, 8, 22, Math.PI), c);
    arc.position.y = 0.16; g.add(arc);
    [-1, 1].forEach(function (s) {
      g.add(stud(0.14, o.c, 0.45 * s, 0.17, 0, 0.9));
    });
    return g;
  }
  function buildSummerHat(o) {
    var g = new T.Group();
    var strawC = o.c == null ? 0xf7d98a : o.c;
    var straw = mat(strawC, { roughness: 0.88 });
    var dome = mesh(new T.SphereGeometry(0.34, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), straw);
    dome.position.y = 0.30; g.add(dome);
    var brim = mesh(new T.CylinderGeometry(0.34, 0.62, 0.045, 26), straw);
    brim.position.y = 0.30; g.add(brim);
    var bandR = mesh(new T.TorusGeometry(0.37, 0.045, 8, 22), mat(o.c2 == null ? 0xff8fab : o.c2, { roughness: 0.6 }));
    bandR.rotation.x = Math.PI / 2; bandR.position.y = 0.36; g.add(bandR);
    if (o.blossom !== false) {
      for (var i = 0; i < 5; i++) {
        var a = (i / 5) * Math.PI * 2;
        g.add(stud(0.05, o.blossomCol == null ? 0xfff2fa : o.blossomCol, 0.36 + Math.cos(a) * 0.05, 0.40, Math.sin(a) * 0.05, 0.6));
      }
      g.add(stud(0.045, 0xffd166, 0.36, 0.41, 0, 0.5));
    }
    return g;
  }

  /* =========================================================
     FACE
     ========================================================= */
  function facePoint(nx, ny, nz, dist) {
    return new T.Vector3(nx, ny, nz).normalize().multiplyScalar(dist);
  }
  function buildFreckles(o) {
    var g = new T.Group();
    var col = o.c == null ? 0xc9744a : o.c;
    [-1, 1].forEach(function (s) {
      for (var i = 0; i < 4; i++) {
        var p = facePoint(0.55 * s + (i - 1.5) * 0.12, -0.02, 0.72, 0.44);
        g.add(stud(0.017, col, p.x, p.y, p.z, 0.7));
      }
    });
    return g;
  }
  function buildMustache(o) {
    var g = new T.Group();
    var col = o.c == null ? 0x4a3524 : o.c;
    var c = mat(col, { roughness: 0.85 });
    var style = o.style || 'handlebar';
    var base = mesh(new T.SphereGeometry(0.10, 14, 10), c);
    base.scale.set(1.6, 0.42, 0.5);
    base.position.set(0, -0.02, 0.44);
    g.add(base);
    if (style === 'handlebar') {
      [-1, 1].forEach(function (s) {
        var p = new T.Vector3(0.27 * s, -0.06, 0.41);
        var q = new T.Vector3(0.36 * s, 0.06, 0.38);
        g.add(tubeBetween(p, q, 0.022, col, 0.85));
        g.add(stud(0.03, col, q.x, q.y, q.z, 0.85));
      });
    } else if (style === 'walrus') {
      [-1, 1].forEach(function (s) { g.add(stud(0.075, col, 0.20 * s, -0.07, 0.42, 0.85)); });
    } else if (style === 'pencil') {
      base.scale.set(1.9, 0.24, 0.5); base.position.y = 0.005;
    }
    return g;
  }
  function buildBlushHearts(o) {
    var g = new T.Group();
    var col = o.c == null ? 0xff6f91 : o.c;
    [-1, 1].forEach(function (s) {
      var p = facePoint(0.82 * s, -0.12, 0.6, 0.41);
      var h = mesh(extrude(heartShape(0.05), 0.012, 8), mat(col, { roughness: 0.5, emissive: col, emissiveIntensity: 0.15 }));
      h.position.set(p.x, p.y, p.z);
      h.rotation.z = Math.PI;
      h.rotation.y = -0.7 * s;
      g.add(h);
    });
    return g;
  }
  function buildStarCheeks(o) {
    var g = new T.Group();
    var col = o.c == null ? 0xffd166 : o.c;
    [-1, 1].forEach(function (s) {
      var p = facePoint(0.82 * s, -0.12, 0.6, 0.41);
      var st = mesh(extrude(starShape(0.055, 0.026, 5), 0.012, 6), mat(col, { roughness: 0.45, emissive: col, emissiveIntensity: 0.2 }));
      st.position.set(p.x, p.y, p.z);
      st.rotation.y = -0.7 * s;
      g.add(st);
    });
    return g;
  }
  function buildEyePatch(o) {
    var g = new T.Group();
    var col = o.c == null ? 0x2a2a34 : o.c;
    var c = mat(col, { roughness: 0.8 });
    var s = o.side || 1;
    var p = facePoint(0.44 * s, 0.24, 0.86, 0.44);
    var patch = mesh(new T.SphereGeometry(0.11, 14, 10), c);
    patch.position.set(p.x, p.y, p.z);
    patch.scale.set(1, 1.1, 0.45);
    g.add(patch);
    var strap = mesh(new T.TorusGeometry(0.44, 0.014, 6, 22, Math.PI * 1.15), c);
    strap.position.y = 0.12;
    strap.rotation.set(Math.PI / 2, 0, s > 0 ? 0.4 : -0.4);
    g.add(strap);
    return g;
  }
  function buildClownNose(o) {
    var g = new T.Group();
    g.add(stud(0.075, o.c == null ? 0xff3b30 : o.c, 0, -0.08, 0.55, 0.35));
    return g;
  }
  function buildFacePaint(o) {
    var g = new T.Group();
    var c = mat(o.c == null ? 0x2ec4b6 : o.c, { roughness: 0.5 });
    [-1, 1].forEach(function (s) {
      for (var i = 0; i < 3; i++) {
        var p = facePoint(0.7 * s, 0.08 - i * 0.14, 0.66, 0.435);
        var stripe = mesh(new T.BoxGeometry(0.028, 0.11, 0.02), c);
        stripe.position.set(p.x, p.y, p.z);
        stripe.rotation.y = -0.7 * s;
        g.add(stripe);
      }
    });
    return g;
  }
  function buildMask(o) {
    var g = new T.Group();
    var c = mat(o.c == null ? 0x5bb3e0 : o.c, { roughness: 0.8 });
    var shell = mesh(new T.SphereGeometry(0.445, 20, 14, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.4), c);
    shell.scale.set(1, 1, 0.92);
    g.add(shell);
    var border = mesh(new T.TorusGeometry(0.44, 0.02, 6, 24), mat(0xffffff, { roughness: 0.7 }));
    border.rotation.x = Math.PI / 2; border.position.y = 0.02; g.add(border);
    return g;
  }
  function buildBeard(o) {
    var g = new T.Group();
    var col = o.c == null ? 0x8a6242 : o.c;
    var style = o.style || 'full';
    if (style === 'full') {
      var beard = mesh(new T.SphereGeometry(0.4, 18, 14, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.42), mat(col, { roughness: 0.9 }));
      beard.position.y = -0.02; beard.scale.set(0.94, 1.15, 0.94); g.add(beard);
    } else if (style === 'goatee') {
      var go = mesh(new T.SphereGeometry(0.14, 12, 10), mat(col, { roughness: 0.9 }));
      go.position.set(0, -0.28, 0.38); go.scale.set(1, 1.3, 0.7); g.add(go);
    } else if (style === 'stubble') {
      var st = mesh(new T.SphereGeometry(0.42, 18, 14, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.34),
        mat(col, { roughness: 0.98, transparent: true, opacity: 0.5 }));
      st.position.y = -0.01; g.add(st);
    }
    return g;
  }
  function buildGem(o) {
    var g = new T.Group();
    var col = o.c == null ? 0xff006e : o.c;
    var p = facePoint(0, 0.52, 0.86, 0.44);
    var gem = new T.Mesh(new T.OctahedronGeometry(0.055, 0),
      mat(col, { roughness: 0.1, metalness: 0.4, emissive: col, emissiveIntensity: 0.3 }));
    gem.position.set(p.x, p.y, p.z);
    gem.castShadow = true;
    g.add(gem);
    return g;
  }
  function buildBandAid(o) {
    var g = new T.Group();
    var col = o.c == null ? 0xffd9c0 : o.c;
    var s = o.side || 1;
    var p = facePoint(0.6 * s, 0.36, 0.72, 0.44);
    var pad = mesh(new T.BoxGeometry(0.14, 0.045, 0.02), mat(col, { roughness: 0.7 }));
    pad.position.set(p.x, p.y, p.z);
    pad.rotation.z = 0.5 * s;
    pad.rotation.y = -0.6 * s;
    g.add(pad);
    g.add(stud(0.016, 0xc98b6b, p.x, p.y, p.z + 0.012, 0.7));
    return g;
  }

  /* =========================================================
     NECK
     ========================================================= */
  function buildBowtie2(o) {
    var g = new T.Group();
    var c = mat(o.c, { roughness: 0.5 });
    g.add(mesh(new T.BoxGeometry(0.1, 0.1, 0.06), c));
    [-1, 1].forEach(function (s) {
      var wing = mesh(new T.BoxGeometry(0.2, 0.17, 0.05), c);
      wing.position.x = 0.15 * s;
      wing.rotation.z = 0.1 * s;
      g.add(wing);
    });
    if (o.dot !== false) g.add(stud(0.022, o.dotC == null ? 0xffffff : o.dotC, 0, 0, 0.04, 0.4));
    return g;
  }
  function buildScarf2(o) {
    var g = new T.Group();
    var c = mat(o.c, { roughness: 0.96 });
    var c2 = mat(o.c2 == null ? 0xf6e6c8 : o.c2, { roughness: 0.96 });
    var loop = mesh(new T.TorusGeometry(0.40, 0.105, 12, 26), c);
    loop.rotation.x = Math.PI / 2; loop.position.y = 0.02; g.add(loop);
    var loop2 = mesh(new T.TorusGeometry(0.40, 0.09, 12, 26), c2);
    loop2.rotation.x = Math.PI / 2; loop2.position.y = 0.14; g.add(loop2);
    var tail = mesh(new T.BoxGeometry(0.16, 0.44, 0.06), c);
    tail.position.set(0.16, -0.24, 0.10); tail.rotation.z = 0.15; g.add(tail);
    for (var i = 0; i < 4; i++) g.add(stud(0.022, o.c2 == null ? 0xf6e6c8 : o.c2, 0.16 + (i % 2 ? 0.04 : -0.04), -0.4 + i * 0.02, 0.14, 0.9));
    return g;
  }
  function buildTie(o) {
    var g = new T.Group();
    var c = mat(o.c, { roughness: 0.45 });
    var knot = mesh(new T.BoxGeometry(0.09, 0.08, 0.05), c);
    knot.position.y = 0.12; g.add(knot);
    var blade = mesh(new T.ConeGeometry(0.09, 0.5, 4), c);
    blade.position.y = -0.18; blade.rotation.y = Math.PI / 4; blade.scale.set(1, 1, 0.5); g.add(blade);
    return g;
  }
  function buildPearls2(o) {
    var g = new T.Group();
    var col = o.c == null ? 0xfff6e8 : o.c;
    for (var i = 0; i < 15; i++) {
      var a = Math.PI * (0.08 + 0.84 * (i / 14));
      g.add(stud(0.045, col, Math.cos(a) * 0.36, -0.30 + Math.sin(a) * 0.30, 0.20 + Math.sin(a) * 0.06, 0.25));
    }
    return g;
  }
  function buildBellCollar(o) {
    var g = new T.Group();
    g.add(band(0.02, 0.05, o.c, 0.6));
    var bellCol = o.bell == null ? 0xffd166 : o.bell;
    var bell = mesh(new T.SphereGeometry(0.1, 14, 12), mat(bellCol, { roughness: 0.3, metalness: 0.7 }));
    bell.position.set(0, -0.08, 0.40); g.add(bell);
    var slot = mesh(new T.BoxGeometry(0.06, 0.02, 0.04), mat(0x5a4210, { roughness: 0.8 }));
    slot.position.set(0, -0.14, 0.44); g.add(slot);
    for (var i = 0; i < 6; i++) {
      var a = (i / 6) * Math.PI * 2;
      g.add(stud(0.022, bellCol, Math.cos(a) * 0.4, 0.02, Math.sin(a) * 0.4, 0.3));
    }
    return g;
  }
  function buildPendant(o) {
    var g = new T.Group();
    var chainMat = mat(o.chain == null ? 0xffd166 : o.chain, { roughness: 0.3, metalness: 0.7 });
    var ring = mesh(new T.TorusGeometry(0.28, 0.012, 6, 22), chainMat);
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.16; ring.scale.set(1, 1, 0.75); g.add(ring);
    var gem = new T.Mesh(new T.OctahedronGeometry(0.07, 0), mat(o.c == null ? 0x3a86ff : o.c, { roughness: 0.12, metalness: 0.35 }));
    gem.position.set(0, -0.04, 0.30); gem.castShadow = true; g.add(gem);
    return g;
  }
  function buildLei(o) {
    var g = new T.Group();
    var cols = o.cols || [0xff8fab, 0xffd166, 0xffffff, 0xcbb8ff, 0xffb4a2];
    for (var i = 0; i < 16; i++) {
      var a = (i / 16) * Math.PI * 2;
      var col = cols[i % cols.length];
      for (var k = 0; k < 5; k++) {
        var b = (k / 5) * Math.PI * 2;
        g.add(stud(0.032, col, Math.cos(a) * 0.4 + Math.cos(b) * 0.03, 0.04 + Math.sin(b) * 0.03, Math.sin(a) * 0.4, 0.6));
      }
    }
    return g;
  }
  function buildMedal(o) {
    var g = new T.Group();
    var rib = mat(o.c == null ? 0x3a86ff : o.c, { roughness: 0.8 });
    var medal = new T.Mesh(new T.CylinderGeometry(0.09, 0.09, 0.02, 20), mat(0xffd166, { roughness: 0.25, metalness: 0.85 }));
    medal.rotation.x = Math.PI / 2; medal.position.set(0, -0.06, 0.34); medal.castShadow = true; g.add(medal);
    var stripe = mesh(new T.BoxGeometry(0.07, 0.24, 0.02), rib);
    stripe.position.set(0, 0.12, 0.33); g.add(stripe);
    var star = mesh(extrude(starShape(0.045, 0.02, 5), 0.02, 5), mat(0xfff2b0, { roughness: 0.3, metalness: 0.5 }));
    star.position.set(0, -0.06, 0.36); g.add(star);
    return g;
  }
  function buildBandanaNeck(o) {
    var g = new T.Group();
    var c = mat(o.c, { roughness: 0.95 });
    var loop = mesh(new T.TorusGeometry(0.39, 0.075, 10, 26), c);
    loop.rotation.x = Math.PI / 2; loop.position.y = 0.06; g.add(loop);
    var point = mesh(new T.ConeGeometry(0.14, 0.24, 4), c);
    point.position.set(0, -0.08, 0.34); point.rotation.y = Math.PI / 4; point.scale.set(1, 1, 0.4); g.add(point);
    for (var i = 0; i < 6; i++) g.add(stud(0.015, 0xffffff, (i % 3 - 1) * 0.06, -0.04 - i * 0.02, 0.35, 0.6));
    return g;
  }
  function buildBolo(o) {
    var g = new T.Group();
    var cord = mesh(new T.TorusGeometry(0.34, 0.012, 6, 24, Math.PI), mat(o.c == null ? 0x6b4423 : o.c, { roughness: 0.6 }));
    cord.rotation.set(Math.PI / 2, 0, Math.PI); cord.position.set(0, 0.14, 0.2); g.add(cord);
    var clasp = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 0.015, 16), mat(0xffd166, { roughness: 0.25, metalness: 0.85 }));
    clasp.rotation.x = Math.PI / 2; clasp.position.set(0, 0.14, 0.36); g.add(clasp);
    return g;
  }

  /* =========================================================
     BACK
     ========================================================= */
  function buildBackpack2(o) {
    var g = new T.Group();
    var c = mat(o.c, { roughness: 0.85 });
    var c2 = mat(o.c2 == null ? 0xc9a06a : o.c2, { roughness: 0.9 });
    var body = mesh(new T.SphereGeometry(0.32, 16, 12), c);
    body.scale.set(1, 1.15, 0.7); body.position.y = 0.02; g.add(body);
    var flap = mesh(new T.BoxGeometry(0.34, 0.2, 0.24), c2);
    flap.position.set(0, 0.18, 0.04); g.add(flap);
    g.add(stud(0.03, 0xffd166, 0, 0.06, 0.22, 0.3));
    return g;
  }
  function buildCape2(o) {
    var g = new T.Group();
    var c = mat(o.c, { roughness: 0.75, side: T.DoubleSide });
    var cape = mesh(new T.SphereGeometry(0.5, 16, 12, 0, Math.PI, 0, Math.PI * 0.7), c);
    cape.rotation.y = Math.PI; cape.scale.set(1, 1.4, 0.5); cape.position.set(0, -0.1, -0.1);
    g.add(cape);
    var collar = mesh(new T.TorusGeometry(0.24, 0.05, 8, 18), mat(o.c2 == null ? 0xffd166 : o.c2, { roughness: 0.5 }));
    collar.rotation.x = Math.PI / 2; collar.position.y = 0.30; g.add(collar);
    g.userData.tick = function (t) { cape.rotation.z = Math.sin(t * 2.2) * 0.09; };
    return g;
  }
  function buildWings(o) {
    var g = new T.Group();
    var kind = o.kind || 'fairy';
    var c = o.c == null ? 0xbfe9ff : o.c;
    var c2 = o.c2 == null ? 0xffffff : o.c2;
    var wingMat = mat(c, { roughness: 0.4, transparent: true, opacity: 0.85, side: T.DoubleSide, emissive: c, emissiveIntensity: 0.15 });
    [-1, 1].forEach(function (s) {
      if (kind === 'bee') {
        var w = mesh(new T.SphereGeometry(0.3, 12, 10), wingMat);
        w.scale.set(0.6, 0.08, 1.0); w.position.set(0.3 * s, 0.34, -0.08); g.add(w);
      } else if (kind === 'butterfly') {
        [0.45, 0.22].forEach(function (yy, i) {
          var w = mesh(new T.SphereGeometry(i ? 0.2 : 0.28, 12, 10), wingMat);
          w.scale.set(1.0, 1.1, 0.12); w.position.set(0.36 * s, yy, -0.12); w.rotation.z = (0.3 + i * 0.2) * s; g.add(w);
        });
      } else if (kind === 'angel') {
        var w = mesh(new T.SphereGeometry(0.42, 14, 12), mat(c, { roughness: 0.6 }));
        w.scale.set(0.5, 1.5, 0.16); w.position.set(0.3 * s, 0.35, -0.2); w.rotation.z = 0.35 * s; g.add(w);
      } else if (kind === 'dragonfly') {
        [0.42, 0.3].forEach(function (yy) {
          var w = mesh(new T.CapsuleGeometry(0.06, 0.34, 4, 8), wingMat);
          w.rotation.z = (Math.PI / 2) * s; w.position.set(0.3 * s, yy, -0.12); g.add(w);
        });
      } else {
        var w2 = mesh(new T.SphereGeometry(0.34, 14, 12), wingMat);
        w2.scale.set(1.0, 1.35, 0.1); w2.position.set(0.34 * s, 0.42, -0.14); w2.rotation.z = 0.45 * s; g.add(w2);
        var inner = mesh(new T.SphereGeometry(0.18, 12, 10), mat(c2, { roughness: 0.4, transparent: true, opacity: 0.7 }));
        inner.scale.set(1.0, 1.2, 0.1); inner.position.set(0.32 * s, 0.4, -0.10); inner.rotation.z = 0.45 * s; g.add(inner);
      }
    });
    g.userData.tick = function (t) { g.rotation.y = Math.sin(t * 3) * 0.12; };
    return g;
  }
  function buildShell(o) {
    var g = new T.Group();
    var c = mat(o.c == null ? 0x8ac973 : o.c, { roughness: 0.7 });
    var c2 = mat(o.c2 == null ? 0x4d9450 : o.c2, { roughness: 0.7 });
    var shell = mesh(new T.SphereGeometry(0.46, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), c);
    shell.rotation.x = -Math.PI / 2 + 0.5; shell.scale.set(1, 1, 0.75); shell.position.set(0, 0.05, -0.28); g.add(shell);
    for (var i = 0; i < 5; i++) {
      var a = (i / 5) * Math.PI * 2;
      var line = mesh(new T.BoxGeometry(0.03, 0.46, 0.02), c2);
      line.position.set(Math.cos(a) * 0.2, 0.06, -0.3 + Math.sin(a) * 0.12);
      line.rotation.set(0.5, a, 0); g.add(line);
    }
    return g;
  }
  function buildJetpack(o) {
    var g = new T.Group();
    var c = mat(o.c == null ? 0xb9c2cc : o.c, { roughness: 0.35, metalness: 0.6 });
    [-1, 1].forEach(function (s) {
      var tank = mesh(new T.CapsuleGeometry(0.11, 0.34, 6, 12), c);
      tank.position.set(0.16 * s, 0.05, -0.2); g.add(tank);
      var noz = mesh(new T.ConeGeometry(0.08, 0.14, 12), mat(0x2a2a34, { roughness: 0.5 }));
      noz.position.set(0.16 * s, -0.22, -0.2); noz.rotation.x = Math.PI; g.add(noz);
      var flame = mesh(new T.ConeGeometry(0.06, 0.2, 10), mat(0xff7b00, { roughness: 0.4, emissive: 0xff7b00, emissiveIntensity: 0.8 }));
      flame.position.set(0.16 * s, -0.34, -0.2); flame.rotation.x = Math.PI; g.add(flame);
    });
    g.add(mesh(new T.BoxGeometry(0.3, 0.34, 0.12), c));
    return g;
  }
  function buildRocket(o) {
    var g = new T.Group();
    var c = mat(o.c == null ? 0xffffff : o.c, { roughness: 0.4, metalness: 0.3 });
    var finCol = o.c2 == null ? 0xff5d5d : o.c2;
    var body = mesh(new T.CapsuleGeometry(0.13, 0.44, 6, 14), c);
    body.position.y = 0.05; g.add(body);
    var nose = mesh(new T.ConeGeometry(0.13, 0.22, 14), mat(finCol, { roughness: 0.4 }));
    nose.position.y = 0.4; g.add(nose);
    [-1, 1].forEach(function (s) {
      var fin = mesh(new T.BoxGeometry(0.02, 0.18, 0.16), mat(finCol, { roughness: 0.5 }));
      fin.position.set(0.13 * s, -0.1, -0.05); fin.rotation.y = 0.4 * s; g.add(fin);
    });
    var flame = mesh(new T.ConeGeometry(0.09, 0.26, 10), mat(0xffb400, { roughness: 0.3, emissive: 0xff7b00, emissiveIntensity: 0.85 }));
    flame.position.y = -0.32; flame.rotation.x = Math.PI; g.add(flame);
    return g;
  }
  function buildBasketPack(o) {
    var g = new T.Group();
    var c = mat(o.c == null ? 0xc9a06a : o.c, { roughness: 0.9, side: T.DoubleSide });
    var b = mesh(new T.CylinderGeometry(0.3, 0.24, 0.4, 16, 1, true), c);
    b.position.set(0, 0.0, -0.22); g.add(b);
    var lid = mesh(new T.TorusGeometry(0.3, 0.03, 8, 18), mat(0x9c7746, { roughness: 0.8 }));
    lid.rotation.x = Math.PI / 2; lid.position.set(0, 0.2, -0.22); g.add(lid);
    for (var i = 1; i < 4; i++) {
      var hoop = mesh(new T.TorusGeometry(0.28, 0.014, 6, 18), mat(0x9c7746, { roughness: 0.8 }));
      hoop.rotation.x = Math.PI / 2; hoop.position.set(0, 0.2 - i * 0.11, -0.22); g.add(hoop);
    }
    return g;
  }
  function buildPlume(o) {
    var g = new T.Group();
    var cols = o.cols || [0x2ec4b6, 0x3a86ff, 0x8338ec, 0xffd166];
    for (var i = 0; i < 7; i++) {
      var a = -0.8 + (i / 6) * 1.6;
      var feather = mesh(new T.SphereGeometry(0.16, 10, 8), mat(cols[i % cols.length], { roughness: 0.6, side: T.DoubleSide }));
      feather.scale.set(0.5, 1.6, 0.12);
      feather.position.set(Math.sin(a) * 0.18, 0.42, -0.28 - Math.cos(a) * 0.05);
      feather.rotation.z = a * 0.6;
      g.add(feather);
      g.add(stud(0.03, 0x2a2a34, Math.sin(a) * 0.18, 0.5, -0.28, 0.5));
    }
    return g;
  }
  function buildFlag(o) {
    var g = new T.Group();
    var pole = mesh(new T.CylinderGeometry(0.02, 0.02, 0.9, 8), mat(0x6b4423, { roughness: 0.8 }));
    pole.position.set(0.2, 0.2, -0.2); g.add(pole);
    var cloth = mesh(new T.PlaneGeometry(0.34, 0.24), mat(o.c == null ? 0xff5d5d : o.c, { roughness: 0.7, side: T.DoubleSide }));
    cloth.position.set(0.38, 0.5, -0.19); g.add(cloth);
    if (o.dot) g.add(stud(0.05, o.dot, 0.38, 0.5, -0.18, 0.5));
    return g;
  }

  /* =========================================================
     HELD
     ========================================================= */
  function buildFlowerItem(o) {
    var g = new T.Group();
    var petal = mat(o.c == null ? 0xffd166 : o.c, { roughness: 0.55 });
    var s = mesh(new T.CylinderGeometry(0.02, 0.024, 0.5, 8), mat(0x5fae52, { roughness: 0.85 }));
    s.position.y = -0.2; g.add(s);
    var head = new T.Group();
    head.position.y = 0.12;
    var petals = o.petals || 6;
    for (var i = 0; i < petals; i++) {
      var a = (i / petals) * Math.PI * 2;
      var p = mesh(new T.SphereGeometry(0.085, 10, 8), petal);
      p.scale.set(1.5, 0.35, 0.85); p.position.set(Math.cos(a) * 0.09, 0, Math.sin(a) * 0.09);
      p.rotation.y = -a; head.add(p);
    }
    head.add(stud(0.06, o.center == null ? 0xffb400 : o.center, 0, 0.01, 0, 0.5));
    g.add(head);
    g.add(stud(0.06, 0x4f9e4f, 0.0, -0.14, 0.05, 0.8));
    return g;
  }
  function buildBalloon2(o) {
    var g = new T.Group();
    var c = mat(o.c == null ? 0xff5d5d : o.c, { roughness: 0.35, metalness: 0.05 });
    var b = mesh(new T.SphereGeometry(0.22, 18, 14), c);
    b.scale.set(1, 1.2, 1); b.position.y = 0.1; g.add(b);
    var knot = mesh(new T.ConeGeometry(0.05, 0.09, 8), c);
    knot.position.y = -0.16; knot.rotation.x = Math.PI; g.add(knot);
    var str = mesh(new T.CylinderGeometry(0.006, 0.006, 0.4, 5), mat(0xdddddd, { roughness: 0.5 }));
    str.position.y = -0.4; g.add(str);
    g.userData.tick = function (t) { g.rotation.z = Math.sin(t * 1.6) * 0.12; };
    return g;
  }
  function buildBubbleWand2(o) {
    var g = new T.Group();
    var stick = mesh(new T.CylinderGeometry(0.018, 0.022, 0.45, 8), mat(0xff8fab, { roughness: 0.5 }));
    stick.position.y = -0.15; g.add(stick);
    var ring = mesh(new T.TorusGeometry(0.09, 0.02, 8, 18), mat(o.c == null ? 0x7ad7f0 : o.c, { roughness: 0.4 }));
    ring.position.y = 0.14; g.add(ring);
    var bubble = mesh(new T.SphereGeometry(0.13, 14, 12), mat(0xbfe9ff, { roughness: 0.05, transparent: true, opacity: 0.4, metalness: 0.2 }));
    bubble.position.y = 0.14; bubble.castShadow = false; g.add(bubble);
    return g;
  }
  function buildIceCream(o) {
    var g = new T.Group();
    var cone = mesh(new T.ConeGeometry(0.09, 0.3, 12), mat(0xd4a373, { roughness: 0.8 }));
    cone.position.y = -0.12; cone.rotation.x = Math.PI; g.add(cone);
    g.add(stud(0.11, o.c == null ? 0xffb4a2 : o.c, 0, 0.1, 0, 0.5));
    g.add(stud(0.085, o.c2 == null ? 0xffe066 : o.c2, 0, 0.24, 0, 0.5));
    g.add(stud(0.028, 0xff5d5d, 0, 0.34, 0, 0.4));
    return g;
  }
  function buildLantern(o) {
    var g = new T.Group();
    var frame = mat(o.c == null ? 0x8a6242 : o.c, { roughness: 0.8 });
    var glowCol = o.glow == null ? 0xffd166 : o.glow;
    var glow = mat(glowCol, { roughness: 0.4, emissive: glowCol, emissiveIntensity: 0.9 });
    g.add(mesh(new T.BoxGeometry(0.16, 0.02, 0.16), frame));
    var top = mesh(new T.BoxGeometry(0.16, 0.02, 0.16), frame);
    top.position.y = 0.28; g.add(top);
    for (var i = 0; i < 4; i++) {
      var a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      var post = mesh(new T.CylinderGeometry(0.012, 0.012, 0.28, 6), frame);
      post.position.set(Math.cos(a) * 0.1, 0.14, Math.sin(a) * 0.1); g.add(post);
    }
    var glass = mesh(new T.BoxGeometry(0.13, 0.22, 0.13), glow);
    glass.position.y = 0.14; g.add(glass);
    var handle = mesh(new T.TorusGeometry(0.06, 0.012, 6, 14, Math.PI), frame);
    handle.position.y = 0.30; g.add(handle);
    return g;
  }
  function buildPlush(o) {
    var g = new T.Group();
    var c = mat(o.c == null ? 0xd4a373 : o.c, { roughness: 0.95 });
    var c2 = mat(o.c2 == null ? 0xfff0e0 : o.c2, { roughness: 0.95 });
    var body = mesh(new T.SphereGeometry(0.17, 14, 12), c);
    body.scale.set(1, 1.1, 0.9); g.add(body);
    var head = mesh(new T.SphereGeometry(0.12, 14, 12), c);
    head.position.y = 0.22; g.add(head);
    [-1, 1].forEach(function (s) {
      g.add(stud(0.05, c, 0.11 * s, 0.31, 0, 0.95));
      g.add(stud(0.035, c2, 0.03 * s, 0.2, 0.11, 0.95));
      var arm = mesh(new T.CapsuleGeometry(0.035, 0.09, 4, 8), c);
      arm.position.set(0.16 * s, 0.05, 0.02); g.add(arm);
    });
    g.add(stud(0.03, o.nose == null ? 0x3a2a1a : o.nose, 0, 0.19, 0.12, 0.5));
    [-1, 1].forEach(function (s) { g.add(stud(0.018, 0x2a2a34, 0.04 * s, 0.24, 0.11, 0.4)); });
    g.userData.tick = function (t) { head.rotation.z = Math.sin(t * 2) * 0.12; };
    return g;
  }
  function buildUmbrella(o) {
    var g = new T.Group();
    var pole = mesh(new T.CylinderGeometry(0.014, 0.014, 0.7, 8), mat(0x6b4423, { roughness: 0.7 }));
    pole.position.y = 0.08; g.add(pole);
    var canopy = mesh(new T.SphereGeometry(0.34, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
      mat(o.c == null ? 0xff6f91 : o.c, { roughness: 0.55, side: T.DoubleSide }));
    canopy.position.y = 0.42; canopy.scale.set(1, 0.62, 1); g.add(canopy);
    var rim = mesh(new T.TorusGeometry(0.34, 0.016, 6, 20), mat(o.c2 == null ? 0xffffff : o.c2, { roughness: 0.5 }));
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.42; g.add(rim);
    var hook = mesh(new T.TorusGeometry(0.05, 0.014, 6, 12, Math.PI), mat(0x6b4423, { roughness: 0.7 }));
    hook.position.y = -0.26; g.add(hook);
    return g;
  }
  function buildStarWand(o) {
    var g = new T.Group();
    var col = o.c == null ? 0xffd166 : o.c;
    var stick = mesh(new T.CylinderGeometry(0.016, 0.016, 0.42, 8), mat(0xffffff, { roughness: 0.5 }));
    stick.position.y = -0.1; g.add(stick);
    var star = mesh(extrude(starShape(0.11, 0.05, 5), 0.03, 6), mat(col, { roughness: 0.3, metalness: 0.45, emissive: col, emissiveIntensity: 0.35 }));
    star.position.y = 0.16; g.add(star);
    g.userData.tick = function (t) { star.rotation.z = t * 1.6; };
    return g;
  }
  function buildSign(o) {
    var g = new T.Group();
    var post = mesh(new T.CylinderGeometry(0.018, 0.018, 0.5, 8), mat(0x8a6242, { roughness: 0.85 }));
    post.position.y = -0.02; g.add(post);
    var board = mesh(new T.BoxGeometry(0.34, 0.24, 0.02), mat(o.c == null ? 0xfff3d0 : o.c, { roughness: 0.7 }));
    board.position.y = 0.22; g.add(board);
    var heart = mesh(extrude(heartShape(0.06), 0.01, 6), mat(0xff6f91, { roughness: 0.5 }));
    heart.position.set(0, 0.22, 0.02); heart.rotation.z = Math.PI; g.add(heart);
    return g;
  }
  function buildPinwheel(o) {
    var g = new T.Group();
    var stick = mesh(new T.CylinderGeometry(0.014, 0.014, 0.5, 8), mat(0xffffff, { roughness: 0.6 }));
    g.add(stick);
    var cols = o.cols || [0xff5d5d, 0xffd166, 0x3a86ff, 0x2ec4b6];
    var vane = new T.Group();
    vane.position.y = 0.28;
    for (var i = 0; i < 4; i++) {
      var blade = mesh(new T.CircleGeometry(0.11, 12, 0, Math.PI / 2), mat(cols[i % cols.length], { roughness: 0.55, side: T.DoubleSide }));
      blade.rotation.z = (i / 4) * Math.PI * 2;
      vane.add(blade);
    }
    g.add(vane);
    g.add(stud(0.02, 0xffffff, 0, 0.28, 0.01, 0.4));
    g.userData.tick = function (t) { vane.rotation.z = t * 5; };
    return g;
  }
  function buildBook(o) {
    var g = new T.Group();
    var cover = mat(o.c == null ? 0x8338ec : o.c, { roughness: 0.7 });
    var pages = mat(0xfff8ec, { roughness: 0.9 });
    var c1 = mesh(new T.BoxGeometry(0.26, 0.03, 0.34), pages);
    c1.position.y = 0.01; c1.rotation.x = 0.06; g.add(c1);
    var t2 = mesh(new T.BoxGeometry(0.28, 0.02, 0.36), cover);
    t2.position.y = 0.04; t2.rotation.x = 0.06; g.add(t2);
    var b2 = mesh(new T.BoxGeometry(0.28, 0.02, 0.36), cover);
    b2.position.y = -0.02; b2.rotation.x = 0.06; g.add(b2);
    g.add(stud(0.02, 0xffd166, 0, 0.05, -0.14, 0.3));
    return g;
  }

  /* =========================================================
     GENERATE — assemble the deep catalogue
     ========================================================= */
  (function generateShop() {
    /* ---------------- HEAD ---------------- */
    fam('head', buildCap2, [
      { id: 'cap_red', name: 'Red Cap', emoji: '🧢', price: 16, opts: { c: 0xff5d5d } },
      { id: 'cap_blue', name: 'Blue Cap', emoji: '🧢', price: 16, opts: { c: 0x3a86ff } },
      { id: 'cap_teal', name: 'Teal Cap', emoji: '🧢', price: 16, opts: { c: 0x2ec4b6 } },
      { id: 'cap_amber', name: 'Amber Cap', emoji: '🧢', price: 16, opts: { c: 0xffb400 } },
      { id: 'cap_purple', name: 'Purple Cap', emoji: '🧢', price: 18, rarity: 'uncommon', opts: { c: 0x8338ec } },
      { id: 'cap_mint', name: 'Mint Cap', emoji: '🧢', price: 18, rarity: 'uncommon', opts: { c: 0x06d6a0 } }
    ], 'Classic curved-brim cap.');
    fam('head', buildKnitHat, [
      { id: 'knit_rose', name: 'Rose Beanie', emoji: '🧶', price: 20, opts: { c: 0xff8fab, c2: 0xfff0f3 } },
      { id: 'knit_mint', name: 'Mint Beanie', emoji: '🧶', price: 20, opts: { c: 0x9ae7b4, c2: 0xf0fff4 } },
      { id: 'knit_sky', name: 'Sky Beanie', emoji: '🧶', price: 20, opts: { c: 0x8ecae6, c2: 0xeaf7ff } },
      { id: 'knit_plum', name: 'Plum Beanie', emoji: '🧶', price: 22, rarity: 'uncommon', opts: { c: 0x8338ec, c2: 0xefe6ff } },
      { id: 'knit_lemon', name: 'Lemon Beanie', emoji: '🧶', price: 20, opts: { c: 0xffe066, c2: 0xfff9d6 } }
    ], 'Knitted by a very patient grandma.');
    fam('head', buildTopHat, [
      { id: 'top_black', name: 'Black Top Hat', emoji: '🎩', price: 46, rarity: 'uncommon', opts: { c: 0x2a2a34, c2: 0xff5d5d } },
      { id: 'top_wine', name: 'Wine Top Hat', emoji: '🎩', price: 48, rarity: 'uncommon', opts: { c: 0x7b2233, c2: 0xffd166 } },
      { id: 'top_teal', name: 'Teal Top Hat', emoji: '🎩', price: 48, rarity: 'uncommon', opts: { c: 0x157a6e, c2: 0xfff3d0 } },
      { id: 'top_snow', name: 'Snow Top Hat', emoji: '🎩', price: 50, rarity: 'rare', opts: { c: 0xfff8ec, c2: 0x3a86ff } }
    ], 'For the most formal of pond occasions.');
    fam('head', buildBucketHat, [
      { id: 'bucket_sand', name: 'Sand Bucket Hat', emoji: '👒', price: 18, opts: { c: 0xd4a373 } },
      { id: 'bucket_blue', name: 'Blue Bucket Hat', emoji: '👒', price: 18, opts: { c: 0x6ec6ff } },
      { id: 'bucket_pink', name: 'Pink Bucket Hat', emoji: '👒', price: 18, opts: { c: 0xffb3c8 } },
      { id: 'bucket_khaki', name: 'Khaki Bucket Hat', emoji: '👒', price: 20, opts: { c: 0xa3b18a } }
    ], 'A soft floppy favourite.');
    fam('head', buildCowboyHat, [
      { id: 'cowboy_tan', name: 'Cowboy Hat', emoji: '🤠', price: 40, rarity: 'uncommon', opts: { c: 0xc9a06a, c2: 0x6b4423 } },
      { id: 'cowboy_dark', name: 'Midnight Cowboy', emoji: '🤠', price: 44, rarity: 'uncommon', opts: { c: 0x4a3b2a, c2: 0xd4a373 } },
      { id: 'cowboy_white', name: 'Ranch Hat', emoji: '🤠', price: 44, rarity: 'uncommon', opts: { c: 0xf3ead3, c2: 0x8a6242 } }
    ], 'Yeehaw, little duck.');
    fam('head', buildBeret, [
      { id: 'beret_red', name: 'Red Beret', emoji: '🎨', price: 22, opts: { c: 0xe4574f } },
      { id: 'beret_black', name: 'Black Beret', emoji: '🎨', price: 22, opts: { c: 0x2a2a34 } },
      { id: 'beret_mint', name: 'Mint Beret', emoji: '🎨', price: 22, opts: { c: 0x9ae7b4 } }
    ], 'Très chic.');
    fam('head', buildVisor, [
      { id: 'visor_pink', name: 'Pink Visor', emoji: '🧢', price: 14, opts: { c: 0xff8fab } },
      { id: 'visor_lime', name: 'Lime Visor', emoji: '🧢', price: 14, opts: { c: 0x9ae76a } },
      { id: 'visor_blue', name: 'Blue Visor', emoji: '🧢', price: 14, opts: { c: 0x6ec6ff } }
    ], 'Keeps the glare out of little duck eyes.');
    fam('head', buildHeadphones, [
      { id: 'hp_pink', name: 'Pink Headphones', emoji: '🎧', price: 38, rarity: 'uncommon', opts: { c: 0xff8fab, pad: 0xffe0e9 } },
      { id: 'hp_mint', name: 'Mint Headphones', emoji: '🎧', price: 38, rarity: 'uncommon', opts: { c: 0x9ae7b4, pad: 0xe6ffe9 } },
      { id: 'hp_dark', name: 'Studio Headphones', emoji: '🎧', price: 42, rarity: 'uncommon', opts: { c: 0x2a2a34, pad: 0x8a8f98 } },
      { id: 'hp_gold', name: 'Gold Headphones', emoji: '🎧', price: 60, rarity: 'rare', opts: { c: 0xffd166, pad: 0xfff3d0 } }
    ], 'Pond beats, all day long.');
    fam('head', buildBow, [
      { id: 'hairbow_pink', name: 'Pink Hair Bow', emoji: '🎀', price: 15, opts: { c: 0xff8fab } },
      { id: 'hairbow_blue', name: 'Blue Hair Bow', emoji: '🎀', price: 15, opts: { c: 0x6ec6ff } },
      { id: 'hairbow_red', name: 'Red Hair Bow', emoji: '🎀', price: 16, opts: { c: 0xff5d5d } },
      { id: 'hairbow_gold', name: 'Golden Hair Bow', emoji: '🎀', price: 34, rarity: 'uncommon', opts: { c: 0xffd166 } }
    ], 'A jaunty little ribbon.');
    fam('head', buildChefHat, [
      { id: 'chef_white', name: 'Chef Toque', emoji: '👨‍🍳', price: 34, rarity: 'uncommon', opts: { c: 0xffffff } },
      { id: 'chef_pink', name: 'Pastry Toque', emoji: '👨‍🍳', price: 36, rarity: 'uncommon', opts: { c: 0xffc2d1 } }
    ], 'Head chef of the pond kitchen.');
    fam('head', buildGradCap, [
      { id: 'grad_black', name: 'Grad Cap', emoji: '🎓', price: 44, rarity: 'uncommon', opts: { c: 0x2a2a34 } },
      { id: 'grad_blue', name: 'Blue Grad Cap', emoji: '🎓', price: 44, rarity: 'uncommon', opts: { c: 0x3a86ff } }
    ], 'Summa cum pond.');
    fam('head', buildViking, [
      { id: 'viking_steel', name: 'Viking Helm', emoji: '🛡️', price: 58, rarity: 'rare', opts: { c: 0xb9c2cc } },
      { id: 'viking_gold', name: 'Golden Viking Helm', emoji: '🛡️', price: 80, rarity: 'epic', opts: { c: 0xffd166 } }
    ], 'Ready to raid the lily pads.');
    fam('head', buildHalo, [
      { id: 'halo_gold', name: 'Angel Halo', emoji: '😇', price: 70, rarity: 'rare', opts: { c: 0xffe066 } },
      { id: 'halo_pink', name: 'Pink Halo', emoji: '😇', price: 70, rarity: 'rare', opts: { c: 0xffb4d8 } }
    ], 'A perfect little ring of light.');
    fam('head', buildAntennae, [
      { id: 'ant_red', name: 'Bug Antennae', emoji: '🐛', price: 18, opts: { c: 0x2a2a34, ball: 0xff5d5d } },
      { id: 'ant_gold', name: 'Glow Antennae', emoji: '🐛', price: 30, rarity: 'uncommon', opts: { c: 0x2a2a34, ball: 0xffd166 } },
      { id: 'ant_pink', name: 'Pink Antennae', emoji: '🐛', price: 18, opts: { c: 0x2a2a34, ball: 0xff8fab } }
    ], 'Twitchy and delightful.');
    fam('head', buildEarmuffs, [
      { id: 'muff_pink', name: 'Pink Earmuffs', emoji: '🎧', price: 22, opts: { c: 0xff8fab } },
      { id: 'muff_cream', name: 'Cream Earmuffs', emoji: '🎧', price: 22, opts: { c: 0xfff3d0 } },
      { id: 'muff_blue', name: 'Blue Earmuffs', emoji: '🎧', price: 22, opts: { c: 0x8ecae6 } }
    ], 'Cosy ears, cosy duck.');
    fam('head', buildSummerHat, [
      { id: 'straw_plain', name: 'Straw Sun Hat', emoji: '👒', price: 24, opts: { c: 0xf7d98a, c2: 0xff8fab } },
      { id: 'straw_blue', name: 'Ribbon Sun Hat', emoji: '👒', price: 26, opts: { c: 0xf7d98a, c2: 0x6ec6ff } },
      { id: 'straw_white', name: 'Lace Sun Hat', emoji: '👒', price: 26, opts: { c: 0xfff3d0, c2: 0xcbb8ff } }
    ], 'Wide brim, zero sunburn.');

    /* ---------------- FACE ---------------- */
    var shapes = [
      { k: 'round', w: 0.10, h: 0.10, nm: 'Round' },
      { k: 'rect', w: 0.115, h: 0.085, nm: 'Square' },
      { k: 'cat', w: 0.12, h: 0.075, nm: 'Cat-Eye' },
      { k: 'aviator', w: 0.115, h: 0.09, nm: 'Aviator' },
      { k: 'hex', w: 0.115, h: 0.1, nm: 'Hex' },
      { k: 'shield', w: 0.115, h: 0.09, nm: 'Shield' },
      { k: 'captain', w: 0.12, h: 0.085, nm: 'Captain' }
    ];
    var lensTints = [[0x2b3a55, 0x2d3440], [0x3d1f1f, 0x6b4423], [0x7fb2ff, 0xc0c0c0], [0xffe066, 0xffb400], [0xff9ec4, 0xff8fab], [0x9ae7b4, 0x2ec4b6]];
    var eyewearVariants = [];
    for (var si = 0; si < shapes.length; si++) {
      for (var ti = 0; ti < lensTints.length; ti++) {
        eyewearVariants.push({
          id: 'spec_' + shapes[si].k + '_' + ti,
          name: ['Cool ', 'Sunny ', 'Sky ', 'Gold ', 'Rosy ', 'Mint '][ti] + shapes[si].nm + ' Specs',
          emoji: '🕶️',
          price: 18 + ti * 4 + si * 2,
          rarity: (shapes[si].k === 'cat' && ti === 4) || (shapes[si].k === 'shield' && ti === 3) ? 'uncommon' : 'common',
          opts: { shape: shapes[si].k, w: shapes[si].w, h: shapes[si].h, frame: lensTints[ti][1], lens: lensTints[ti][0], opacity: 0.5 + ti * 0.04 }
        });
      }
    }
    [['heart', 0.115, 0.105, 'Heart'], ['star', 0.12, 0.115, 'Star']].forEach(function (sp) {
      [0xff6f91, 0xffd166, 0x7ad7f0, 0x9ae7b4].forEach(function (fc, i) {
        eyewearVariants.push({
          id: 'spec_' + sp[0] + '_' + i,
          name: ['Hot Pink ', 'Gold ', 'Sky ', 'Mint '][i] + sp[3] + ' Glasses',
          emoji: sp[0] === 'heart' ? '💖' : '🌟',
          price: 24 + i * 3,
          rarity: i >= 2 ? 'uncommon' : 'common',
          opts: { shape: sp[0], w: sp[1], h: sp[2], frame: fc, lens: 0xffe066, opacity: 0.8 }
        });
      });
    });
    eyewearVariants.push(
      { id: 'spec_rimless', name: 'Rimless Specs', emoji: '👓', price: 26, opts: { shape: 'round', w: 0.1, h: 0.1, rimless: true, frame: 0xffffff, lens: 0xbfe9ff, opacity: 0.35 } },
      { id: 'spec_rimless_gr', name: 'Green Rimless', emoji: '👓', price: 28, opts: { shape: 'rect', w: 0.115, h: 0.085, rimless: true, frame: 0xffffff, lens: 0x9ae7b4, opacity: 0.4 } },
      { id: 'spec_monocle', name: 'Gentle Duck Monocle', emoji: '🧐', price: 40, rarity: 'rare', desc: 'Quite distinguished, sir.',
        opts: { shape: 'round', w: 0.115, h: 0.115, single: true, chain: true, frame: 0xffd166, frameMetal: 0.8, frameRough: 0.2, lens: 0xffe066, opacity: 0.4 } },
      { id: 'spec_monocle_s', name: 'Silver Monocle', emoji: '🧐', price: 40, rarity: 'rare', desc: 'For the pond gentleduck.',
        opts: { shape: 'round', w: 0.115, h: 0.115, single: true, chain: true, frame: 0xc0c0c0, frameMetal: 0.85, frameRough: 0.15, lens: 0xbfe9ff, opacity: 0.4 } }
    );
    fam('face', buildEyewear, eyewearVariants, 'A pair of properly-made spectacles.');

    fam('face', buildFreckles, [
      { id: 'freck_brown', name: 'Freckles', emoji: '🟤', price: 12, opts: { c: 0xc9744a } },
      { id: 'freck_dark', name: 'Dark Freckles', emoji: '🟤', price: 12, opts: { c: 0x6b4423 } }
    ], 'A dusting of sunny freckles.');
    fam('face', buildMustache, [
      { id: 'mous_handle', name: 'Handlebar Mustache', emoji: '🥸', price: 20, opts: { style: 'handlebar', c: 0x4a3524 } },
      { id: 'mous_walrus', name: 'Walrus Mustache', emoji: '🥸', price: 20, opts: { style: 'walrus', c: 0x6b4423 } },
      { id: 'mous_pencil', name: 'Pencil Mustache', emoji: '🥸', price: 18, opts: { style: 'pencil', c: 0x2a2a34 } }
    ], 'Positively dashing, old chap.');
    fam('face', buildBlushHearts, [
      { id: 'blush_pink', name: 'Heart Blush', emoji: '💗', price: 16, opts: { c: 0xff6f91 } },
      { id: 'blush_red', name: 'Red Heart Blush', emoji: '💗', price: 16, opts: { c: 0xff3b30 } }
    ], 'Blushing with joy.');
    fam('face', buildStarCheeks, [
      { id: 'starcheck_gold', name: 'Star Cheeks', emoji: '⭐', price: 18, opts: { c: 0xffd166 } },
      { id: 'starcheck_pink', name: 'Pink Star Cheeks', emoji: '⭐', price: 18, opts: { c: 0xff8fab } }
    ], 'A twinkle on each cheek.');
    fam('face', buildEyePatch, [
      { id: 'patch_right', name: 'Eye Patch', emoji: '🏴‍☠️', price: 22, opts: { side: 1, c: 0x2a2a34 } },
      { id: 'patch_left', name: 'Port Eye Patch', emoji: '🏴‍☠️', price: 22, opts: { side: -1, c: 0x2a2a34 } }
    ], 'Arr, a pirate duck.');
    fam('face', buildClownNose, [
      { id: 'clown_red', name: 'Clown Nose', emoji: '🤡', price: 14, opts: { c: 0xff3b30 } },
      { id: 'clown_pink', name: 'Pink Clown Nose', emoji: '🤡', price: 14, opts: { c: 0xff8fab } }
    ], 'Honk honk.');
    fam('face', buildFacePaint, [
      { id: 'paint_teal', name: 'War Paint', emoji: '🎨', price: 16, opts: { c: 0x2ec4b6 } },
      { id: 'paint_red', name: 'Red War Paint', emoji: '🎨', price: 16, opts: { c: 0xff5d5d } }
    ], 'Cheek stripes, ready for battle.');
    fam('face', buildMask, [
      { id: 'mask_blue', name: 'Hero Mask', emoji: '🦸', price: 24, opts: { c: 0x5bb3e0 } },
      { id: 'mask_red', name: 'Red Hero Mask', emoji: '🦸', price: 24, opts: { c: 0xff5d5d } },
      { id: 'mask_dark', name: 'Shadow Mask', emoji: '🦸', price: 28, rarity: 'uncommon', opts: { c: 0x2a2a34 } }
    ], 'A mysterious pond vigilante.');
    fam('face', buildBeard, [
      { id: 'beard_brown', name: 'Full Beard', emoji: '🧔', price: 26, opts: { style: 'full', c: 0x8a6242 } },
      { id: 'beard_grey', name: 'Grey Beard', emoji: '🧔', price: 26, opts: { style: 'full', c: 0xbfc5cc } },
      { id: 'beard_goatee', name: 'Goatee', emoji: '🧔', price: 20, opts: { style: 'goatee', c: 0x4a3524 } },
      { id: 'beard_stubble', name: 'Five O-Clock Shadow', emoji: '🧔', price: 18, opts: { style: 'stubble', c: 0x8a6242 } }
    ], 'Wisdom grows on the chin.');
    fam('face', buildGem, [
      { id: 'gem_ruby', name: 'Ruby Bindi', emoji: '💎', price: 20, opts: { c: 0xff006e } },
      { id: 'gem_sapphire', name: 'Sapphire Bindi', emoji: '💎', price: 20, opts: { c: 0x3a86ff } },
      { id: 'gem_emerald', name: 'Emerald Bindi', emoji: '💎', price: 20, opts: { c: 0x06d6a0 } }
    ], 'A tiny jewel on the brow.');
    fam('face', buildBandAid, [
      { id: 'aid_plain', name: 'Band-Aid', emoji: '🩹', price: 10, opts: { side: 1, c: 0xffd9c0 } },
      { id: 'aid_blue', name: 'Blue Band-Aid', emoji: '🩹', price: 10, opts: { side: -1, c: 0xbfe9ff } },
      { id: 'aid_star', name: 'Star Plaster', emoji: '🩹', price: 12, opts: { side: 1, c: 0xffe066 } }
    ], 'A brave little scrape.');

    /* ---------------- NECK ---------------- */
    var bowCols = [[0xff5d5d, 'Cherry Bowtie'], [0x3a86ff, 'Cobalt Bowtie'], [0x2ec4b6, 'Teal Bowtie'], [0xffd166, 'Gold Bowtie'], [0x8338ec, 'Violet Bowtie'], [0xff006e, 'Magenta Bowtie']];
    fam('neck', buildBowtie2, bowCols.map(function (bc, i) {
      return { id: 'bowtie2_' + i, name: bc[1], emoji: '🎀', price: 14 + i, rarity: i >= 3 ? 'uncommon' : 'common', opts: { c: bc[0], dotC: 0xffffff } };
    }), 'For formal pond occasions.');
    fam('neck', buildScarf2, [
      { id: 'scarf_red', name: 'Snuggly Scarf', emoji: '🧣', price: 16, opts: { c: 0xe4574f, c2: 0xf6e6c8 } },
      { id: 'scarf_blue', name: 'Blue Scarf', emoji: '🧣', price: 16, opts: { c: 0x3a86ff, c2: 0xbfe9ff } },
      { id: 'scarf_green', name: 'Forest Scarf', emoji: '🧣', price: 16, opts: { c: 0x588157, c2: 0xe4ffe6 } },
      { id: 'scarf_pink', name: 'Candy Scarf', emoji: '🧣', price: 18, opts: { c: 0xff8fab, c2: 0xfff0f3 } },
      { id: 'scarf_purple', name: 'Plum Scarf', emoji: '🧣', price: 18, opts: { c: 0x8338ec, c2: 0xefe6ff } }
    ], 'Warm as a feather duvet.');
    fam('neck', buildTie, [
      { id: 'tie_red', name: 'Red Necktie', emoji: '👔', price: 20, opts: { c: 0xd7263d } },
      { id: 'tie_navy', name: 'Navy Necktie', emoji: '👔', price: 20, opts: { c: 0x1e3a5f } },
      { id: 'tie_green', name: 'Green Necktie', emoji: '👔', price: 20, opts: { c: 0x2f6b3a } },
      { id: 'tie_gold', name: 'Gold Necktie', emoji: '👔', price: 30, rarity: 'uncommon', opts: { c: 0xffd166 } }
    ], 'Business duck, reporting for duty.');
    fam('neck', buildPearls2, [
      { id: 'pearl_white', name: 'Pearl Necklace', emoji: '📿', price: 28, rarity: 'uncommon', opts: { c: 0xfff6e8 } },
      { id: 'pearl_pink', name: 'Pink Pearls', emoji: '📿', price: 30, rarity: 'uncommon', opts: { c: 0xffd6e6 } },
      { id: 'pearl_blue', name: 'Blue Pearls', emoji: '📿', price: 30, rarity: 'uncommon', opts: { c: 0xbfe9ff } },
      { id: 'pearl_gold', name: 'Golden Pearls', emoji: '📿', price: 44, rarity: 'rare', opts: { c: 0xffe066 } }
    ], 'Naturally pond-proof pearls.');
    fam('neck', buildBellCollar, [
      { id: 'collar_red', name: 'Red Bell Collar', emoji: '🔔', price: 16, opts: { c: 0xd7263d, bell: 0xffd166 } },
      { id: 'collar_blue', name: 'Blue Bell Collar', emoji: '🔔', price: 16, opts: { c: 0x3a86ff, bell: 0xffd166 } },
      { id: 'collar_pink', name: 'Pink Bell Collar', emoji: '🔔', price: 16, opts: { c: 0xff8fab, bell: 0xffd166 } },
      { id: 'collar_gold', name: 'Gold Bell Collar', emoji: '🔔', price: 34, rarity: 'uncommon', opts: { c: 0xb08d57, bell: 0xffe066 } }
    ], 'You will always hear it coming.');
    fam('neck', buildPendant, [
      { id: 'pend_sapphire', name: 'Sapphire Pendant', emoji: '💠', price: 26, rarity: 'uncommon', opts: { c: 0x3a86ff, chain: 0xffd166 } },
      { id: 'pend_ruby', name: 'Ruby Pendant', emoji: '💠', price: 28, rarity: 'uncommon', opts: { c: 0xff006e, chain: 0xffd166 } },
      { id: 'pend_emerald', name: 'Emerald Pendant', emoji: '💠', price: 28, rarity: 'uncommon', opts: { c: 0x06d6a0, chain: 0xffd166 } },
      { id: 'pend_silver', name: 'Moonstone Pendant', emoji: '💠', price: 30, rarity: 'uncommon', opts: { c: 0xbfe9ff, chain: 0xc0c0c0 } }
    ], 'A little treasure on a chain.');
    fam('neck', buildLei, [
      { id: 'lei_aloha', name: 'Aloha Lei', emoji: '🌺', price: 24, opts: { cols: [0xff8fab, 0xffd166, 0xffffff, 0xcbb8ff] } },
      { id: 'lei_tropic', name: 'Tropic Lei', emoji: '🌺', price: 24, opts: { cols: [0xff5d5d, 0xffb400, 0x2ec4b6, 0xffe066] } },
      { id: 'lei_pastel', name: 'Pastel Lei', emoji: '🌺', price: 24, opts: { cols: [0xffe0e9, 0xd9f0ff, 0xe4ffe6, 0xf0e6ff] } },
      { id: 'lei_sunset', name: 'Sunset Lei', emoji: '🌺', price: 28, rarity: 'uncommon', opts: { cols: [0xff7b00, 0xff006e, 0x8338ec, 0xffd166] } }
    ], 'Every day is a holiday.');
    fam('neck', buildMedal, [
      { id: 'medal_gold', name: 'Gold Medal', emoji: '🏅', price: 40, rarity: 'uncommon', opts: { c: 0x3a86ff } },
      { id: 'medal_red', name: 'Red Ribbon Medal', emoji: '🏅', price: 40, rarity: 'uncommon', opts: { c: 0xd7263d } },
      { id: 'medal_blue', name: 'Blue Ribbon Medal', emoji: '🏅', price: 40, rarity: 'uncommon', opts: { c: 0x1e3a5f } }
    ], 'First place in the pond games.');
    fam('neck', buildBandanaNeck, [
      { id: 'bneck_red', name: 'Red Bandana', emoji: '🧣', price: 15, opts: { c: 0xd7263d } },
      { id: 'bneck_blue', name: 'Blue Bandana', emoji: '🧣', price: 15, opts: { c: 0x3a86ff } },
      { id: 'bneck_black', name: 'Charcoal Bandana', emoji: '🧣', price: 15, opts: { c: 0x3a3f47 } },
      { id: 'bneck_paisley', name: 'Paisley Bandana', emoji: '🧣', price: 18, opts: { c: 0xff8fab } }
    ], 'Pioneer duck vibes.');
    fam('neck', buildBolo, [
      { id: 'bolo_tan', name: 'Bolo Tie', emoji: '🤠', price: 22, opts: { c: 0x6b4423 } },
      { id: 'bolo_black', name: 'Black Bolo Tie', emoji: '🤠', price: 22, opts: { c: 0x2a2a34 } }
    ], 'Howdy, partner.');

    /* ---------------- BACK ---------------- */
    var packCols = [[0xff5d5d, 'Red Backpack'], [0x3a86ff, 'Blue Backpack'], [0x2ec4b6, 'Teal Backpack'], [0xffb400, 'Amber Backpack'], [0x8338ec, 'Purple Backpack'], [0x06d6a0, 'Mint Backpack']];
    fam('back', buildBackpack2, packCols.map(function (pc, i) {
      return { id: 'pack_' + i, name: pc[1], emoji: '🎒', price: 22 + i * 2, rarity: i >= 4 ? 'uncommon' : 'common', opts: { c: pc[0] } };
    }), 'Holds exactly one breadcrumb.');
    fam('back', buildCape2, [
      { id: 'cape_red', name: 'Hero Cape', emoji: '🦸', price: 34, rarity: 'uncommon', opts: { c: 0xd7263d, c2: 0xffd166 } },
      { id: 'cape_blue', name: 'Azure Cape', emoji: '🦸', price: 34, rarity: 'uncommon', opts: { c: 0x3a86ff, c2: 0xbfe9ff } },
      { id: 'cape_purple', name: 'Royal Cape', emoji: '🦸', price: 48, rarity: 'rare', opts: { c: 0x6a4c93, c2: 0xffd166 } },
      { id: 'cape_green', name: 'Forest Cape', emoji: '🦸', price: 34, rarity: 'uncommon', opts: { c: 0x2f6b3a, c2: 0xd4a373 } },
      { id: 'cape_black', name: 'Shadow Cape', emoji: '🦸', price: 42, rarity: 'uncommon', opts: { c: 0x2a2a34, c2: 0xff5d5d } },
      { id: 'cape_white', name: 'Angel Cape', emoji: '🦸', price: 50, rarity: 'rare', opts: { c: 0xfff8ec, c2: 0xffd166 } }
    ], 'Flaps dramatically in the wind.');
    fam('back', buildWings, [
      { id: 'wing_fairy', name: 'Fairy Wings', emoji: '🧚', price: 46, rarity: 'rare', opts: { kind: 'fairy', c: 0xbfe9ff, c2: 0xffffff } },
      { id: 'wing_pink', name: 'Pink Fairy Wings', emoji: '🧚', price: 46, rarity: 'rare', opts: { kind: 'fairy', c: 0xffc2e0, c2: 0xffffff } },
      { id: 'wing_bee', name: 'Bee Wings', emoji: '🐝', price: 36, rarity: 'uncommon', opts: { kind: 'bee', c: 0xfff0b0 } },
      { id: 'wing_butterfly', name: 'Butterfly Wings', emoji: '🦋', price: 44, rarity: 'uncommon', opts: { kind: 'butterfly', c: 0x9ae7b4 } },
      { id: 'wing_monarch', name: 'Monarch Wings', emoji: '🦋', price: 48, rarity: 'rare', opts: { kind: 'butterfly', c: 0xffb400 } },
      { id: 'wing_dragonfly', name: 'Dragonfly Wings', emoji: '🪰', price: 34, rarity: 'uncommon', opts: { kind: 'dragonfly', c: 0xbfe9ff } },
      { id: 'wing_angel', name: 'Angel Wings', emoji: '😇', price: 60, rarity: 'rare', opts: { kind: 'angel', c: 0xfff8ec } },
      { id: 'wing_seraph', name: 'Seraph Wings', emoji: '😇', price: 86, rarity: 'epic', opts: { kind: 'angel', c: 0xffe066 } }
    ], 'A flutter of magic.');
    fam('back', buildShell, [
      { id: 'shell_green', name: 'Turtle Shell', emoji: '🐢', price: 30, rarity: 'uncommon', opts: { c: 0x8ac973, c2: 0x4d9450 } },
      { id: 'shell_teal', name: 'Sea Turtle Shell', emoji: '🐢', price: 32, rarity: 'uncommon', opts: { c: 0x57c2db, c2: 0x2b7a92 } },
      { id: 'shell_brown', name: 'Snapping Shell', emoji: '🐢', price: 30, rarity: 'uncommon', opts: { c: 0xb5651d, c2: 0x6b4423 } }
    ], 'Slow and steady.');
    fam('back', buildJetpack, [
      { id: 'jet_steel', name: 'Jetpack', emoji: '🚀', price: 54, rarity: 'rare', opts: { c: 0xb9c2cc } },
      { id: 'jet_gold', name: 'Golden Jetpack', emoji: '🚀', price: 78, rarity: 'epic', opts: { c: 0xffd166 } }
    ], 'Blast off over the pond.');
    fam('back', buildRocket, [
      { id: 'rocket_white', name: 'Pocket Rocket', emoji: '🚀', price: 44, rarity: 'uncommon', opts: { c: 0xffffff, c2: 0xff5d5d } },
      { id: 'rocket_blue', name: 'Blue Rocket', emoji: '🚀', price: 44, rarity: 'uncommon', opts: { c: 0x3a86ff, c2: 0xffd166 } }
    ], 'Three, two, one...');
    fam('back', buildBasketPack, [
      { id: 'woven_basket', name: 'Woven Basket', emoji: '🧺', price: 26, rarity: 'uncommon', opts: { c: 0xc9a06a } },
      { id: 'woven_dark', name: 'Dark Wicker Basket', emoji: '🧺', price: 26, rarity: 'uncommon', opts: { c: 0x8a6242 } }
    ], 'Picked fresh from the reeds.');
    fam('back', buildPlume, [
      { id: 'plume_rainbow', name: 'Rainbow Plume', emoji: '🦚', price: 52, rarity: 'rare', opts: { cols: [0x2ec4b6, 0x3a86ff, 0x8338ec, 0xffd166] } },
      { id: 'plume_pastel', name: 'Pastel Plume', emoji: '🦚', price: 52, rarity: 'rare', opts: { cols: [0xffc2e0, 0xbfe9ff, 0xe4ffe6, 0xfff3d0] } },
      { id: 'plume_fire', name: 'Fire Plume', emoji: '🦚', price: 60, rarity: 'rare', opts: { cols: [0xff5d5d, 0xffb400, 0xff006e, 0xffe066] } }
    ], 'A dazzling fan of feathers.');
    fam('back', buildFlag, [
      { id: 'flag_red', name: 'Little Red Flag', emoji: '🚩', price: 18, opts: { c: 0xff5d5d } },
      { id: 'flag_blue', name: 'Little Blue Flag', emoji: '🚩', price: 18, opts: { c: 0x3a86ff } },
      { id: 'flag_heart', name: 'Heart Flag', emoji: '🚩', price: 22, opts: { c: 0xff8fab, dot: 0xff006e } }
    ], 'Rally the flock.');

    /* ---------------- HELD ---------------- */
    fam('held', buildFlowerItem, [
      { id: 'flow_daisy', name: 'Little Daisy', emoji: '🌼', price: 10, opts: { c: 0xffffff, center: 0xffd166 } },
      { id: 'flow_sunflower', name: 'Sunflower', emoji: '🌻', price: 14, opts: { c: 0xffd166, center: 0x8a6242, petals: 10 } },
      { id: 'flow_rose', name: 'Red Rose', emoji: '🌹', price: 16, opts: { c: 0xff5d5d, center: 0xd7263d, petals: 8 } },
      { id: 'flow_tulip', name: 'Pink Tulip', emoji: '🌷', price: 14, opts: { c: 0xff8fab, center: 0xffd166, petals: 5 } },
      { id: 'flow_bluebell', name: 'Blue Bellflower', emoji: '💠', price: 14, opts: { c: 0x8ecae6, center: 0xffd166 } },
      { id: 'flow_violet', name: 'Violet Bloom', emoji: '💜', price: 16, opts: { c: 0xcbb8ff, center: 0xffd166, petals: 7 } }
    ], 'A shy little gift for a friend.');
    fam('held', buildBalloon2, [
      { id: 'bal_red', name: 'Red Balloon', emoji: '🎈', price: 20, opts: { c: 0xff5d5d } },
      { id: 'bal_blue', name: 'Blue Balloon', emoji: '🎈', price: 20, opts: { c: 0x3a86ff } },
      { id: 'bal_green', name: 'Green Balloon', emoji: '🎈', price: 20, opts: { c: 0x2ec4b6 } },
      { id: 'bal_pink', name: 'Pink Balloon', emoji: '🎈', price: 20, opts: { c: 0xff8fab } },
      { id: 'bal_gold', name: 'Golden Balloon', emoji: '🎈', price: 40, rarity: 'uncommon', opts: { c: 0xffd166 } }
    ], 'Never, ever let go.');
    fam('held', buildBubbleWand2, [
      { id: 'bwand_pink', name: 'Bubble Wand', emoji: '🪄', price: 26, opts: { c: 0xff8fab } },
      { id: 'bwand_blue', name: 'Blue Bubble Wand', emoji: '🪄', price: 26, opts: { c: 0x7ad7f0 } },
      { id: 'bwand_violet', name: 'Violet Bubble Wand', emoji: '🪄', price: 28, opts: { c: 0xcbb8ff } }
    ], 'Blows the roundest bubbles.');
    fam('held', buildIceCream, [
      { id: 'ice_straw', name: 'Strawberry Cone', emoji: '🍦', price: 22, opts: { c: 0xff9ec4, c2: 0xfff3d0 } },
      { id: 'ice_choc', name: 'Choco Cone', emoji: '🍦', price: 22, opts: { c: 0x8a6242, c2: 0xfff3d0 } },
      { id: 'ice_mint', name: 'Mint Cone', emoji: '🍦', price: 22, opts: { c: 0x9ae7b4, c2: 0xfff3d0 } },
      { id: 'ice_mango', name: 'Mango Cone', emoji: '🍦', price: 24, opts: { c: 0xffb400, c2: 0xfff3d0 } }
    ], 'Melting fast in the sun.');
    fam('held', buildLantern, [
      { id: 'lantern_warm', name: 'Paper Lantern', emoji: '🏮', price: 30, rarity: 'uncommon', opts: { c: 0x8a6242, glow: 0xffd166 } },
      { id: 'lantern_red', name: 'Red Lantern', emoji: '🏮', price: 30, rarity: 'uncommon', opts: { c: 0x8a6242, glow: 0xff5d5d } },
      { id: 'lantern_green', name: 'Jade Lantern', emoji: '🏮', price: 32, rarity: 'uncommon', opts: { c: 0x2f6b3a, glow: 0x9ae7b4 } }
    ], 'A cosy glow for evening swims.');
    fam('held', buildPlush, [
      { id: 'plush_bear', name: 'Teddy Bear', emoji: '🧸', price: 28, rarity: 'uncommon', opts: { c: 0xb5651d, c2: 0xfff0e0 } },
      { id: 'plush_bunny', name: 'Bunny Plush', emoji: '🐰', price: 28, rarity: 'uncommon', opts: { c: 0xfff8ec, c2: 0xffc2d1 } },
      { id: 'plush_panda', name: 'Panda Plush', emoji: '🐼', price: 30, rarity: 'uncommon', opts: { c: 0xffffff, c2: 0x2a2a34 } },
      { id: 'plush_duck', name: 'Baby Duck Plush', emoji: '🐤', price: 30, rarity: 'uncommon', opts: { c: 0xffd166, c2: 0xffb400 } },
      { id: 'plush_frog', name: 'Frog Plush', emoji: '🐸', price: 30, rarity: 'uncommon', opts: { c: 0x8ac973, c2: 0xe4ffe6 } },
      { id: 'plush_cat', name: 'Kitty Plush', emoji: '🐱', price: 30, rarity: 'uncommon', opts: { c: 0xcbb8ff, c2: 0xfff0f3 } }
    ], 'A cuddly pond companion.');
    fam('held', buildUmbrella, [
      { id: 'umb_pink', name: 'Pink Umbrella', emoji: '☂️', price: 34, rarity: 'uncommon', opts: { c: 0xff8fab, c2: 0xffffff } },
      { id: 'umb_blue', name: 'Blue Umbrella', emoji: '☂️', price: 34, rarity: 'uncommon', opts: { c: 0x6ec6ff, c2: 0xffffff } },
      { id: 'umb_red', name: 'Red Umbrella', emoji: '☂️', price: 34, rarity: 'uncommon', opts: { c: 0xff5d5d, c2: 0xfff3d0 } },
      { id: 'umb_rainbow', name: 'Rainbow Umbrella', emoji: '☂️', price: 48, rarity: 'rare', opts: { c: 0xffb400, c2: 0x2ec4b6 } }
    ], 'Singing in the rain.');
    fam('held', buildStarWand, [
      { id: 'swand_gold', name: 'Star Wand', emoji: '🪄', price: 32, rarity: 'uncommon', opts: { c: 0xffd166 } },
      { id: 'swand_pink', name: 'Pink Star Wand', emoji: '🪄', price: 32, rarity: 'uncommon', opts: { c: 0xff8fab } },
      { id: 'swand_blue', name: 'Blue Star Wand', emoji: '🪄', price: 32, rarity: 'uncommon', opts: { c: 0x7ad7f0 } }
    ], 'Make a wish, little duck.');
    fam('held', buildSign, [
      { id: 'sign_heart', name: 'Heart Sign', emoji: '🪧', price: 20, opts: { c: 0xfff3d0 } },
      { id: 'sign_blue', name: 'Blue Sign', emoji: '🪧', price: 20, opts: { c: 0xbfe9ff } }
    ], 'A cheerful little placard.');
    fam('held', buildPinwheel, [
      { id: 'pin_rainbow', name: 'Rainbow Pinwheel', emoji: '🎡', price: 24, opts: { cols: [0xff5d5d, 0xffd166, 0x3a86ff, 0x2ec4b6] } },
      { id: 'pin_pastel', name: 'Pastel Pinwheel', emoji: '🎡', price: 24, opts: { cols: [0xffc2e0, 0xbfe9ff, 0xe4ffe6, 0xfff3d0] } }
    ], 'Spins happily in the breeze.');
    fam('held', buildBook, [
      { id: 'book_violet', name: 'Story Book', emoji: '📖', price: 22, opts: { c: 0x8338ec } },
      { id: 'book_red', name: 'Red Story Book', emoji: '📖', price: 22, opts: { c: 0xd7263d } },
      { id: 'book_blue', name: 'Blue Story Book', emoji: '📖', price: 22, opts: { c: 0x3a86ff } }
    ], 'Bedtime tales for ducklings.');
  })();

  /* --- top-up so each category is nice and deep -------------- */
  (function topUpShop() {
    fam('back', buildBackpack2, [
      { id: 'pack_sunset', name: 'Sunset Backpack', emoji: '🎒', price: 34, rarity: 'uncommon', opts: { c: 0xff7b00, c2: 0xff006e } },
      { id: 'pack_sky', name: 'Sky Backpack', emoji: '🎒', price: 34, rarity: 'uncommon', opts: { c: 0x8ecae6, c2: 0x3a86ff } }
    ], 'Holds exactly one breadcrumb.');
    fam('back', buildCape2, [
      { id: 'cape_gold', name: 'Golden Cape', emoji: '🦸', price: 70, rarity: 'epic', opts: { c: 0xffd166, c2: 0xfff3d0 } },
      { id: 'cape_mint', name: 'Mint Cape', emoji: '🦸', price: 34, rarity: 'uncommon', opts: { c: 0x9ae7b4, c2: 0xffffff } }
    ], 'Flaps dramatically in the wind.');
    fam('back', buildWings, [
      { id: 'wing_violet', name: 'Violet Fairy Wings', emoji: '🧚', price: 46, rarity: 'rare', opts: { kind: 'fairy', c: 0xcbb8ff, c2: 0xffffff } },
      { id: 'wing_bee_gold', name: 'Golden Bee Wings', emoji: '🐝', price: 52, rarity: 'rare', opts: { kind: 'bee', c: 0xffe066 } },
      { id: 'wing_monarch_blue', name: 'Blue Morpho Wings', emoji: '🦋', price: 48, rarity: 'rare', opts: { kind: 'butterfly', c: 0x3a86ff } }
    ], 'A flutter of magic.');
    fam('back', buildShell, [
      { id: 'shell_gold', name: 'Gilded Shell', emoji: '🐢', price: 62, rarity: 'rare', opts: { c: 0xffd166, c2: 0xb08d57 } },
      { id: 'shell_violet', name: 'Violet Shell', emoji: '🐢', price: 32, rarity: 'uncommon', opts: { c: 0xcbb8ff, c2: 0x6a4c93 } }
    ], 'Slow and steady.');
    fam('back', buildPlume, [
      { id: 'plume_ocean', name: 'Ocean Plume', emoji: '🦚', price: 52, rarity: 'rare', opts: { cols: [0x2b7a92, 0x57c2db, 0xbfe9ff, 0x9ae7b4] } }
    ], 'A dazzling fan of feathers.');
    fam('back', buildBasketPack, [
      { id: 'woven_gold', name: 'Golden Basket', emoji: '🧺', price: 40, rarity: 'uncommon', opts: { c: 0xe0b96a } }
    ], 'Picked fresh from the reeds.');
    fam('back', buildFlag, [
      { id: 'flag_gold', name: 'Golden Pennant', emoji: '🚩', price: 30, rarity: 'uncommon', opts: { c: 0xffd166, dot: 0xff006e } }
    ], 'Rally the flock.');
    fam('back', buildJetpack, [
      { id: 'jet_silver', name: 'Silver Jetpack', emoji: '🚀', price: 54, rarity: 'rare', opts: { c: 0xd9d9d9 } }
    ], 'Blast off over the pond.');
    fam('back', buildRocket, [
      { id: 'rocket_mint', name: 'Mint Rocket', emoji: '🚀', price: 44, rarity: 'uncommon', opts: { c: 0x9ae7b4, c2: 0xff8fab } }
    ], 'Three, two, one...');

    fam('neck', buildBowtie2, [
      { id: 'bowtie2_mint', name: 'Mint Bowtie', emoji: '🎀', price: 18, opts: { c: 0x9ae7b4, dotC: 0xffffff } },
      { id: 'bowtie2_coral', name: 'Coral Bowtie', emoji: '🎀', price: 18, opts: { c: 0xff8fab, dotC: 0xffffff } }
    ], 'For formal pond occasions.');
    fam('neck', buildScarf2, [
      { id: 'scarf_amber', name: 'Amber Scarf', emoji: '🧣', price: 18, opts: { c: 0xffb400, c2: 0xfff3d0 } },
      { id: 'scarf_mint', name: 'Mint Scarf', emoji: '🧣', price: 18, opts: { c: 0x9ae7b4, c2: 0xf0fff4 } }
    ], 'Warm as a feather duvet.');
    fam('neck', buildTie, [
      { id: 'tie_mint', name: 'Mint Necktie', emoji: '👔', price: 20, opts: { c: 0x2ec4b6 } }
    ], 'Business duck, reporting for duty.');
    fam('neck', buildLei, [
      { id: 'lei_ocean', name: 'Ocean Lei', emoji: '🌺', price: 26, rarity: 'uncommon', opts: { cols: [0x8ecae6, 0x2b7a92, 0xbfe9ff, 0xffffff] } }
    ], 'Every day is a holiday.');
    fam('neck', buildMedal, [
      { id: 'medal_green', name: 'Green Ribbon Medal', emoji: '🏅', price: 40, rarity: 'uncommon', opts: { c: 0x2f6b3a } }
    ], 'First place in the pond games.');

    fam('held', buildFlowerItem, [
      { id: 'flow_buttercup', name: 'Buttercup', emoji: '🌼', price: 10, opts: { c: 0xffe066, center: 0xffb400, petals: 5 } },
      { id: 'flow_lavender', name: 'Lavender Sprig', emoji: '💜', price: 12, opts: { c: 0xcbb8ff, center: 0x9ae7b4, petals: 8 } }
    ], 'A shy little gift for a friend.');
    fam('held', buildBalloon2, [
      { id: 'bal_violet', name: 'Violet Balloon', emoji: '🎈', price: 20, opts: { c: 0x8338ec } }
    ], 'Never, ever let go.');
    fam('held', buildIceCream, [
      { id: 'ice_berry', name: 'Berry Cone', emoji: '🍦', price: 22, opts: { c: 0xcbb8ff, c2: 0xfff3d0 } }
    ], 'Melting fast in the sun.');
    fam('held', buildPlush, [
      { id: 'plush_owl', name: 'Owl Plush', emoji: '🦉', price: 30, rarity: 'uncommon', opts: { c: 0xb5651d, c2: 0xfff0e0 } }
    ], 'A cuddly pond companion.');
    fam('held', buildBook, [
      { id: 'book_mint', name: 'Mint Story Book', emoji: '📖', price: 22, opts: { c: 0x2ec4b6 } }
    ], 'Bedtime tales for ducklings.');
  })();

  var ITEM_BY_ID = {};
  CATALOG.forEach(function (it) { ITEM_BY_ID[it.id] = it; });

  /* ---------------------------------------------------------
     KIT
     --------------------------------------------------------- */
  var DuckKit = {
    mat: mat,
    basic: basic,
    geo: geo,
    mesh: mesh,
    sphere: sphere,
    starShape: starShape,
    heartShape: heartShape,
    extrude: extrude,

    DUCK_VARIANTS: DUCK_VARIANTS,
    DUCK_NAMES: DUCK_NAMES,
    ANCHORS: ANCHORS,
    CATEGORIES: CATEGORIES,
    SLOT_INFO: SLOT_INFO,
    CATALOG: CATALOG,

    PATTERNS: PATTERNS,
    PATTERN_PALETTES: PATTERN_PALETTES,
    patternTexture: patternTexture,
    patternMat: patternMat,
    resolvePattern: resolvePattern,
    randomPattern: randomPattern,
    patternName: patternName,

    HEAD_CENTER: HEAD_CENTER,
    HEAD_R: HEAD_R,

    buildDuck: buildDuck,

    itemById: function (id) { return ITEM_BY_ID[id] || null; },

    variantById: function (id) {
      for (var i = 0; i < DUCK_VARIANTS.length; i++) if (DUCK_VARIANTS[i].id === id) return DUCK_VARIANTS[i];
      return DUCK_VARIANTS[0];
    },

    randomVariant: function () {
      // weighted rarity
      var r = Math.random();
      var pool;
      if (r < 0.008) pool = 'epic';
      else if (r < 0.075) pool = 'rare';
      else if (r < 0.30) pool = 'uncommon';
      else pool = 'common';
      var list = DUCK_VARIANTS.filter(function (v) { return v.rarity === pool; });
      return list[Math.floor(Math.random() * list.length)] || DUCK_VARIANTS[0];
    },

    randomName: function (taken) {
      taken = taken || [];
      var avail = DUCK_NAMES.filter(function (n) { return taken.indexOf(n) === -1; });
      var list = avail.length ? avail : DUCK_NAMES;
      return list[Math.floor(Math.random() * list.length)];
    },

    rarityOf: function (id) {
      var it = ITEM_BY_ID[id];
      return it ? it.rarity : 'common';
    },

    /** Attach every accessory described by the equip map onto a duck group. */
    applyEquip: function (duckGroup, equip) {
      var g = duckGroup.userData.accGroup;
      if (!g) return;
      while (g.children.length) g.remove(g.children[0]);

      Object.keys(equip || {}).forEach(function (slot) {
        var id = equip[slot];
        if (!id) return;
        var item = ITEM_BY_ID[id];
        if (!item || !item.build) return;
        var obj;
        try { obj = item.build(); } catch (e) { return; }
        var a = ANCHORS[slot] || ANCHORS.head;
        obj.position.set(a.x, a.y, a.z);
        obj.userData.slot = slot;
        obj.userData.itemId = id;
        obj.traverse(function (c) { if (c.isMesh) c.castShadow = true; });
        g.add(obj);
      });
    },

    /** Per-frame animation for a duck (bobbing + accessory ticks).
     *  `flop` (0..1) is a startled wing-flutter, e.g. after bumping another duck. */
    tickDuck: function (duckGroup, t, dt, speed, flop) {
      var parts = duckGroup.userData.parts;
      if (!parts) return;
      flop = flop > 0 ? flop : 0;
      var bob = Math.sin(t * 2.6) * 0.035;
      if (flop > 0) bob += Math.abs(Math.sin(t * 40)) * 0.05 * flop;
      parts.body.position.y = 0.34 + bob;
      parts.head.position.y = DuckKit.HEAD_CENTER.y + bob;
      parts.head.rotation.z = Math.sin(t * 1.7) * 0.06;
      parts.tail.rotation.z = Math.sin(t * 3.1) * 0.12;

      var flap;
      if (flop > 0) {
        /* a fast, wide flutter that settles as flop decays back to 0 */
        flap = Math.sin(t * 40) * (0.5 + 0.5 * flop) * flop;
      } else {
        flap = speed > 0.6 ? Math.sin(t * 12) * 0.25 : Math.sin(t * 2.2) * 0.05;
      }
      parts.wings.forEach(function (w) {
        w.rotation.z = w.userData.baseRotZ + flap * w.userData.side * -1;
      });

      var acc = duckGroup.userData.accGroup;
      if (acc) {
        for (var i = 0; i < acc.children.length; i++) {
          var c = acc.children[i];
          if (c.userData && c.userData.tick) c.userData.tick(t);
        }
      }

      /* ---- golden shine: pulsing halo + orbiting sparkles ---- */
      var shine = duckGroup.userData.shine;
      if (shine) {
        var halo = shine.userData.core;
        if (halo) {
          halo.material.opacity = 0.48 + 0.22 * Math.sin(t * 3.0);
          var hs = 1.9 + 0.22 * Math.sin(t * 2.3);
          halo.scale.set(hs, hs, 1);
          halo.material.rotation = t * 0.4;
        }
        var lt = shine.userData.light;
        if (lt) lt.intensity = 4.0 + 1.3 * Math.sin(t * 4.1);

        var sparks = shine.userData.sparkles;
        if (sparks) {
          for (var s = 0; s < sparks.children.length; s++) {
            var q = sparks.children[s];
            var a = t * (0.8 + s * 0.16) + s * 1.05;
            var rr = 0.46 + 0.12 * Math.sin(t * 1.7 + s);
            q.position.set(Math.cos(a) * rr, 0.1 + 0.42 * Math.sin(a * 1.3 + s * 2), Math.sin(a) * rr);
            var tw = 0.5 + 0.5 * Math.sin(t * 6.2 + s * 1.9);
            q.material.opacity = 0.2 + 0.75 * tw * tw;
            var sc = 0.16 + 0.24 * tw;
            q.scale.set(sc, sc, 1);
          }
        }
      }
    }
  };

  global.DuckKit = DuckKit;
})(window);
