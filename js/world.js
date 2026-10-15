/* ===========================================================
   world.js — the pond: water, shore, flora, sky, net and effects
   =========================================================== */
(function (global) {
  'use strict';

  var T = global.THREE;
  var K = global.DuckKit;

  var POND_R = 10.6;        // waterline radius
  var WATER_GEO_R = 11.0;   // water mesh extends slightly under the bank
  var SWIM_R = 9.1;         // how far out ducks may swim

  /* the nest and the catch bucket sit on the far bank; we keep this much
     open ground around them so grass, flowers and reeds never bury them */
  var NEST_A = 4.28, NEST_R = 11.55, NEST_CLEAR = 2.7;
  var BUCKET_A = 5.05, BUCKET_R = 11.6, BUCKET_CLEAR = 2.0;

  var scene, camera, sun, sunTarget;
  var water, waterMat;
  var net, netShadow;
  var ripples = [], drops = [], sparks = [];
  var clouds = [], dragonflies = [], pollen;
  var t = 0;

  /* =========================================================
     geometry helpers
     ========================================================= */
  function radialGeometry(radii, segs, yFn, colorFn) {
    var rings = radii.length;
    var verts = [], cols = [], idx = [];
    var hasColor = !!colorFn;
    for (var i = 0; i < rings; i++) {
      var r = radii[i];
      var y = yFn(r, i);
      for (var j = 0; j <= segs; j++) {
        var a = (j / segs) * Math.PI * 2;
        verts.push(Math.cos(a) * r, y, Math.sin(a) * r);
        if (hasColor) {
          var c = colorFn(r, i, j / segs);
          cols.push(c.r, c.g, c.b);
        }
      }
    }
    var row = segs + 1;
    for (var ri = 0; ri < rings - 1; ri++) {
      for (var cj = 0; cj < segs; cj++) {
        var a0 = ri * row + cj, b0 = a0 + 1, c0 = a0 + row, d0 = c0 + 1;
        idx.push(a0, c0, b0, b0, c0, d0);
      }
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(verts, 3));
    if (hasColor) g.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  function place(obj, r, a, y) {
    obj.position.set(Math.cos(a) * r, y == null ? 0 : y, Math.sin(a) * r);
    return obj;
  }

  /* =========================================================
     static batcher — collapses hundreds of scenery meshes into a
     couple of draw calls (big win for the shadow pass too)
     ========================================================= */
  function batchStatic(group, opts) {
    opts = opts || {};
    group.updateMatrixWorld(true);

    var buckets = new Map();
    var tmp = new T.Color();
    var collected = [];

    group.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      if (o.material && o.material.transparent) return;   // leave transparent bits alone
      var side = (o.material && o.material.side === T.DoubleSide) ? T.DoubleSide : T.FrontSide;
      var key = side + '|' + (o.castShadow ? 1 : 0) + '|' + (o.receiveShadow ? 1 : 0);
      var b = buckets.get(key);
      if (!b) {
        b = { side: side, cast: !!o.castShadow, receive: !!o.receiveShadow, geos: [], colors: [] };
        buckets.set(key, b);
      }
      var g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      if (!g.attributes.normal) g.computeVertexNormals();
      g.applyMatrix4(o.matrixWorld);
      var c = (o.material && o.material.color) || tmp.set(0xffffff);
      b.geos.push(g);
      b.colors.push(new T.Color().copy(c));
      collected.push(o);
    });

    var out = [];
    buckets.forEach(function (b) {
      var total = 0;
      b.geos.forEach(function (g) { total += g.attributes.position.count; });

      var pos = new Float32Array(total * 3);
      var nrm = new Float32Array(total * 3);
      var col = new Float32Array(total * 3);
      var off = 0;

      b.geos.forEach(function (g, gi) {
        var count = g.attributes.position.count;
        pos.set(g.attributes.position.array, off * 3);
        nrm.set(g.attributes.normal.array, off * 3);
        var cc = b.colors[gi];
        for (var i = 0; i < count; i++) {
          col[(off + i) * 3] = cc.r;
          col[(off + i) * 3 + 1] = cc.g;
          col[(off + i) * 3 + 2] = cc.b;
        }
        off += count;
      });

      var merged = new T.BufferGeometry();
      merged.setAttribute('position', new T.BufferAttribute(pos, 3));
      merged.setAttribute('normal', new T.BufferAttribute(nrm, 3));
      merged.setAttribute('color', new T.BufferAttribute(col, 3));

      var material = new T.MeshStandardMaterial({
        vertexColors: true,
        roughness: opts.roughness == null ? 0.94 : opts.roughness,
        metalness: 0,
        side: b.side,
        envMapIntensity: 0.25
      });

      var m = new T.Mesh(merged, material);
      m.castShadow = b.cast;
      m.receiveShadow = b.receive;
      out.push(m);
    });

    /* free the temporary clones (the source geometries were cloned, so this is safe) */
    buckets.forEach(function (b) { b.geos.forEach(function (g) { g.dispose(); }); });

    return out;
  }

  function addBatched(parent, group, opts) {
    var meshes = batchStatic(group, opts);
    meshes.forEach(function (m) { parent.add(m); });
    batchCleanup(group);
    return meshes;
  }

  /** Free the intermediate meshes/geometries that were just merged away. */
  function batchCleanup(group) {
    group.traverse(function (o) {
      if (o.isMesh && o.geometry && !o.geometry.userData.keep) o.geometry.dispose();
    });
    while (group.children.length) group.remove(group.children[0]);
  }

  /* =========================================================
     water
     ========================================================= */
  var WATER_VS = [
    'uniform float uTime;',
    'varying vec3 vWorld;',
    'varying vec3 vNrm;',
    'varying float vH;',
    'varying vec2 vXZ;',
    '',
    'void main(){',
    '  vec3 p = position;',
    '  vec2 xz = p.xz;',
    '  float h = 0.0;',
    '  vec2 grad = vec2(0.0);',
    '',
    '  vec2 d0 = normalize(vec2( 1.00, 0.35)); float f0=0.52, s0=0.95, a0=0.105;',
    '  float ph = dot(xz,d0)*f0 + uTime*s0; h += sin(ph)*a0; grad += d0*(cos(ph)*f0*a0);',
    '',
    '  vec2 d1 = normalize(vec2(-0.60, 0.95)); float f1=0.83, s1=1.35, a1=0.062;',
    '  ph = dot(xz,d1)*f1 + uTime*s1; h += sin(ph)*a1; grad += d1*(cos(ph)*f1*a1);',
    '',
    '  vec2 d2 = normalize(vec2( 0.25,-1.00)); float f2=1.45, s2=2.05, a2=0.028;',
    '  ph = dot(xz,d2)*f2 + uTime*s2; h += sin(ph)*a2; grad += d2*(cos(ph)*f2*a2);',
    '',
    '  vec2 d3 = normalize(vec2(-0.90,-0.35)); float f3=2.55, s3=2.95, a3=0.013;',
    '  ph = dot(xz,d3)*f3 + uTime*s3; h += sin(ph)*a3; grad += d3*(cos(ph)*f3*a3);',
    '',
    '  p.y += h;',
    '  vH = h;',
    '  vXZ = xz;',
    '  vNrm = normalize(vec3(-grad.x, 1.0, -grad.y));',
    '  vec4 wp = modelMatrix * vec4(p, 1.0);',
    '  vWorld = wp.xyz;',
    '  gl_Position = projectionMatrix * viewMatrix * wp;',
    '}'
  ].join('\n');

  var WATER_FS = [
    'uniform float uTime;',
    'uniform vec3 uSunDir;',
    'uniform vec3 uCamPos;',
    'uniform float uEdge;',
    'uniform vec3 uDeep;',
    'uniform vec3 uShallow;',
    'uniform vec3 uSky;',
    'varying vec3 vWorld;',
    'varying vec3 vNrm;',
    'varying float vH;',
    'varying vec2 vXZ;',
    '',
    'void main(){',
    '  vec3 N = normalize(vNrm);',
    '  vec3 V = normalize(uCamPos - vWorld);',
    '  vec3 col = mix(uDeep, uShallow, smoothstep(-0.13, 0.15, vH) * 0.75 + 0.2);',
    '',
    '  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.2);',
    '  col = mix(col, uSky, fres * 0.62);',
    '',
    '  vec3 H = normalize(uSunDir + V);',
    '  float ndh = max(dot(N, H), 0.0);',
    '  col += vec3(1.0, 0.97, 0.86) * pow(ndh, 95.0) * 1.5;',
    '  col += vec3(1.0, 0.99, 0.95) * pow(ndh, 420.0) * 1.3;',
    '',
    '  float d = length(vXZ);',
    '  float edge = smoothstep(uEdge * 0.90, uEdge * 1.005, d);',
    '  col = mix(col, vec3(0.92, 0.97, 0.99), edge * 0.5);',
    '',
    '  gl_FragColor = vec4(col, 1.0);',
    '  #include <tonemapping_fragment>',
    '  #include <colorspace_fragment>',
    '}'
  ].join('\n');

  function buildWater() {
    var radii = [];
    var N = 46;
    for (var i = 0; i <= N; i++) radii.push(WATER_GEO_R * Math.pow(i / N, 0.92));

    var g = radialGeometry(radii, 128, function () { return 0; }, null);

    waterMat = new T.ShaderMaterial({
      side: T.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: new T.Vector3(0.55, 0.72, 0.42).normalize() },
        uCamPos: { value: new T.Vector3() },
        uEdge: { value: POND_R },
        uDeep: { value: new T.Color(0x0d6d8e) },
        uShallow: { value: new T.Color(0x46bfd2) },
        uSky: { value: new T.Color(0xc6ebf9) }
      },
      vertexShader: WATER_VS,
      fragmentShader: WATER_FS
    });

    water = new T.Mesh(g, waterMat);
    water.renderOrder = 1;
    scene.add(water);
  }

  /* =========================================================
     shore / ground
     ========================================================= */
  function shoreY(r) {
    if (r <= 9.6) return -0.62;
    if (r <= 10.6) return -0.62 + (r - 9.6) / 1.0 * 0.62;        // up to waterline 0
    if (r <= 12.0) return 0.16 + (r - 10.6) / 1.4 * 0.30;        // 0.16 -> 0.46
    if (r <= 16.0) return 0.46 + (r - 12.0) / 4.0 * 0.42;        // 0.46 -> 0.88
    return 0.88 + Math.min(1.6, (r - 16.0) / 44.0 * 1.9);
  }

  var C_WET = new T.Color(0xbfa87a);
  var C_SAND = new T.Color(0xeedcaa);
  var C_GRASS = new T.Color(0x86c96a);
  var C_GRASS2 = new T.Color(0x5da354);
  var C_FAR = new T.Color(0x4e8c58);

  function shoreColor(r) {
    var c;
    if (r < 10.6) c = C_WET.clone().lerp(C_SAND, (r - 9.6) / 1.0);
    else if (r < 12.5) c = C_SAND.clone().lerp(C_GRASS, (r - 10.6) / 1.9);
    else if (r < 20) c = C_GRASS.clone().lerp(C_GRASS2, (r - 12.5) / 7.5);
    else c = C_GRASS2.clone().lerp(C_FAR, Math.min(1, (r - 20) / 25));
    // gentle noise so it isn't a flat wash
    var n = (Math.sin(r * 1.7) * 0.5 + 0.5) * 0.055 - 0.02;
    c.offsetHSL(0, 0, n);
    return c;
  }

  function buildShore() {
    var radii = [0, 1.6, 3.2, 4.8, 6.2, 7.4, 8.5, 9.2, 9.6, 10.0, 10.6, 11.4, 12.5, 14, 16, 18, 21, 25, 30, 37, 46, 58];
    var g = radialGeometry(radii, 112, function (r) {
      // slight wobble on the bank so it isn't a perfect circle
      return shoreY(r);
    }, shoreColor);

    // add a touch of irregularity to the bank silhouette
    var pos = g.attributes.position;
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), z = pos.getZ(i);
      var rr = Math.sqrt(x * x + z * z);
      if (rr > 9.4 && rr < 17) {
        var a = Math.atan2(z, x);
        var wob = Math.sin(a * 3.1) * 0.22 + Math.sin(a * 5.7 + 1.3) * 0.13 + Math.sin(a * 9.3 + 2.1) * 0.06;
        var k = (rr - 9.4) / 7.6;
        var f = 1 + wob * 0.035 * (1 - Math.abs(k - 0.4) * 1.6);
        pos.setX(i, x * f);
        pos.setZ(i, z * f);
        pos.setY(i, pos.getY(i) + wob * 0.06 * Math.min(1, k * 1.4));
      }
    }
    g.computeVertexNormals();

    var m = new T.MeshStandardMaterial({
      vertexColors: true, roughness: 0.95, metalness: 0.0, envMapIntensity: 0.25
    });
    var shore = new T.Mesh(g, m);
    shore.receiveShadow = true;
    shore.renderOrder = 0;
    scene.add(shore);
  }

  /* =========================================================
     flora + props
     ========================================================= */
  var rnd = (function () {
    var s = 987654321;
    return function () { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  })();

  function lilyPad() {
    var g = new T.Group();
    var leafMat = K.mat(0x4f9e4f, { roughness: 0.62, side: T.DoubleSide });
    var leaf = new T.Mesh(new T.CircleGeometry(0.5, 22, 0.42, Math.PI * 2 - 0.84), leafMat);
    leaf.rotation.x = -Math.PI / 2;
    leaf.receiveShadow = true;
    g.add(leaf);
    var vein = new T.Mesh(new T.RingGeometry(0.30, 0.34, 20, 1, 0.42, Math.PI * 2 - 0.84),
      K.mat(0x3f8a41, { roughness: 0.6, side: T.DoubleSide }));
    vein.rotation.x = -Math.PI / 2;
    vein.position.y = 0.004;
    g.add(vein);
    if (rnd() > 0.55) {
      var flower = new T.Group();
      for (var i = 0; i < 7; i++) {
        var a = (i / 7) * Math.PI * 2;
        var petal = new T.Mesh(new T.SphereGeometry(0.055, 8, 6),
          K.mat(0xfff2fa, { roughness: 0.5, side: T.DoubleSide }),
          Math.cos(a) * 0.07, 0, Math.sin(a) * 0.07);
        petal.scale.set(1.3, 0.35, 0.75);
        flower.add(petal);
      }
      flower.add(new T.Mesh(new T.SphereGeometry(0.042, 10, 8), K.mat(0xffd93d, { roughness: 0.45 })));
      flower.position.set(0.16, 0.05, -0.1);
      g.add(flower);
    }
    return g;
  }

  function cattail() {
    var g = new T.Group();
    var h = 1.7 + rnd() * 0.9;
    var stalk = new T.Mesh(new T.CylinderGeometry(0.024, 0.034, h, 6),
      K.mat(0x6fae5a, { roughness: 0.85 }));
    stalk.position.y = h / 2;
    stalk.castShadow = true;
    g.add(stalk);

    /* the brown "sausage" sits upright near the top (capsule = rounded ends) */
    var head = new T.Mesh(new T.CapsuleGeometry(0.05, 0.3, 5, 12),
      K.mat(0x7a5230, { roughness: 0.92 }));
    head.position.y = h - 0.02;
    head.castShadow = true;
    g.add(head);

    /* the thin spike that pokes out above the head */
    var spike = new T.Mesh(new T.CylinderGeometry(0.006, 0.013, 0.22, 5),
      K.mat(0x8fbf6a, { roughness: 0.85 }));
    spike.position.y = h + 0.31;
    g.add(spike);

    /* long, narrow leaves that rise almost straight up (no sideways canes) */
    var leaves = 3 + Math.floor(rnd() * 3);
    for (var i = 0; i < leaves; i++) {
      var lh = h * (0.6 + rnd() * 0.34);
      var blade = new T.Mesh(new T.ConeGeometry(0.03, lh, 4),
        K.mat(0x63a44f, { roughness: 0.86, side: T.DoubleSide }));
      var a = (i / leaves) * Math.PI * 2 + rnd() * 0.5;
      var lean = 0.07 + rnd() * 0.12;
      blade.position.set(Math.cos(a) * 0.03, lh * 0.5, Math.sin(a) * 0.03);
      blade.rotation.z = Math.cos(a) * lean;
      blade.rotation.x = -Math.sin(a) * lean;
      blade.scale.set(1, 1, 0.4);
      blade.castShadow = true;
      g.add(blade);
    }
    return g;
  }

  function reedClump() {
    var g = new T.Group();
    var n = 4 + Math.floor(rnd() * 4);
    for (var i = 0; i < n; i++) {
      var c = cattail();
      c.position.set((rnd() - 0.5) * 0.9, 0, (rnd() - 0.5) * 0.9);
      c.rotation.y = rnd() * 3;
      /* only a whisper of tilt so the clump reads as standing reeds */
      c.rotation.z = (rnd() - 0.5) * 0.07;
      c.scale.setScalar(0.8 + rnd() * 0.45);
      g.add(c);
    }
    return g;
  }

  function bush(scale) {
    var g = new T.Group();
    var cols = [0x5fa957, 0x74bd63, 0x4d9450, 0x8ac973];
    var n = 4 + Math.floor(rnd() * 4);
    for (var i = 0; i < n; i++) {
      var s = (0.42 + rnd() * 0.42) * (scale || 1);
      var b = new T.Mesh(new T.SphereGeometry(s, 12, 9),
        K.mat(cols[Math.floor(rnd() * cols.length)], { roughness: 0.92 }));
      b.position.set((rnd() - 0.5) * 1.5 * (scale || 1), s * 0.72 + rnd() * 0.2, (rnd() - 0.5) * 1.5 * (scale || 1));
      b.scale.y = 0.82 + rnd() * 0.3;
      b.castShadow = true;
      b.receiveShadow = true;
      g.add(b);
    }
    return g;
  }

  function tree() {
    var g = new T.Group();
    var th = 1.9 + rnd() * 2.4;
    var trunk = new T.Mesh(new T.CylinderGeometry(0.14, 0.24, th, 7),
      K.mat(0x8a6242, { roughness: 0.95 }));
    trunk.position.y = th / 2;
    trunk.castShadow = true;
    g.add(trunk);

    var cols = [0x4e9b4a, 0x5fae52, 0x43883f];
    var layers = 3;
    for (var i = 0; i < layers; i++) {
      var r = (1.5 - i * 0.34) * (0.9 + rnd() * 0.25);
      var hgt = 1.5 - i * 0.22;
      var cone = new T.Mesh(new T.ConeGeometry(r, hgt, 9),
        K.mat(cols[i % cols.length], { roughness: 0.9 }));
      cone.position.y = th * 0.72 + i * hgt * 0.52;
      cone.rotation.y = rnd() * 3;
      cone.castShadow = true;
      g.add(cone);
    }
    return g;
  }

  function rock() {
    var s = 0.4 + rnd() * 1.5;
    var geo = new T.IcosahedronGeometry(s, 0);
    // IcosahedronGeometry is non-indexed, so this yields per-face normals and
    // keeps the faceted look once the rock is merged into the scenery batch.
    geo.computeVertexNormals();
    var g = new T.Mesh(geo,
      K.mat(rnd() > 0.5 ? 0x9aa3a8 : 0xb8b2a4, { roughness: 0.98, flatShading: true }));
    g.scale.set(1 + rnd() * 0.5, 0.6 + rnd() * 0.5, 1 + rnd() * 0.4);
    g.rotation.set(rnd(), rnd() * 3, rnd());
    g.castShadow = true;
    g.receiveShadow = true;
    return g;
  }

  function grassTuft() {
    var g = new T.Group();
    var n = 5 + Math.floor(rnd() * 5);
    var greens = [0x6fbb56, 0x7fc95f, 0x5fa957, 0x8ed36a, 0x63a44f];
    for (var i = 0; i < n; i++) {
      var h = 0.24 + rnd() * 0.42;
      var blade = new T.Mesh(new T.ConeGeometry(0.03 + rnd() * 0.02, h, 3),
        K.mat(greens[Math.floor(rnd() * greens.length)], { roughness: 0.9, side: T.DoubleSide }));
      blade.position.set((rnd() - 0.5) * 0.34, h / 2, (rnd() - 0.5) * 0.34);
      blade.rotation.set((rnd() - 0.5) * 0.55, rnd() * 3, (rnd() - 0.5) * 0.7);
      g.add(blade);
    }
    return g;
  }

  /* a small clump of taller blades, used to soften the waterline */
  function tallGrass() {
    var g = new T.Group();
    var n = 6 + Math.floor(rnd() * 6);
    var greens = [0x63a44f, 0x74bd63, 0x5fa957];
    for (var i = 0; i < n; i++) {
      var h = 0.45 + rnd() * 0.6;
      var blade = new T.Mesh(new T.ConeGeometry(0.028 + rnd() * 0.018, h, 3),
        K.mat(greens[Math.floor(rnd() * greens.length)], { roughness: 0.92, side: T.DoubleSide }));
      var lean = (rnd() - 0.5) * 0.5;
      blade.position.set((rnd() - 0.5) * 0.4, h / 2, (rnd() - 0.5) * 0.4);
      blade.rotation.set(lean * 0.5, rnd() * 3, lean);
      g.add(blade);
    }
    return g;
  }

  /* one stemmed flower: kind decides the petal colour + arrangement */
  function flowerPlant(kind) {
    var g = new T.Group();
    var stemH = 0.3 + rnd() * 0.3;
    var stem = new T.Mesh(new T.CylinderGeometry(0.014, 0.02, stemH, 5),
      K.mat(0x5fae52, { roughness: 0.85 }));
    stem.position.y = stemH / 2;
    g.add(stem);

    // a couple of leaves on the stem
    for (var i = 0; i < 2; i++) {
      var leaf = new T.Mesh(new T.SphereGeometry(0.075, 8, 6),
        K.mat(0x63a44f, { roughness: 0.88, side: T.DoubleSide }));
      leaf.scale.set(1.5, 0.22, 0.8);
      leaf.position.set((i ? 1 : -1) * 0.05, stemH * 0.45, 0);
      leaf.rotation.z = (i ? 1 : -1) * 0.5;
      g.add(leaf);
    }

    var head = new T.Group();
    head.position.y = stemH;

    if (kind === 'tulip') {
      var tc = rnd() > 0.5 ? 0xff8fab : 0xffd93d;
      for (var p = 0; p < 4; p++) {
        var pa = (p / 4) * Math.PI * 2;
        var pet = new T.Mesh(new T.SphereGeometry(0.06, 8, 6),
          K.mat(tc, { roughness: 0.5, side: T.DoubleSide }));
        pet.scale.set(1.5, 0.6, 0.7);
        pet.position.set(Math.cos(pa) * 0.045, 0.05, Math.sin(pa) * 0.045);
        pet.rotation.z = Math.cos(pa) * 0.6;
        pet.rotation.x = -Math.sin(pa) * 0.6;
        head.add(pet);
      }
    } else if (kind === 'poppy') {
      for (var q = 0; q < 5; q++) {
        var qa = (q / 5) * Math.PI * 2;
        var pp = new T.Mesh(new T.SphereGeometry(0.07, 8, 6),
          K.mat(0xe4574f, { roughness: 0.55, side: T.DoubleSide }));
        pp.scale.set(1.4, 0.28, 0.85);
        pp.position.set(Math.cos(qa) * 0.05, 0, Math.sin(qa) * 0.05);
        pp.rotation.y = -qa;
        head.add(pp);
      }
      head.add(new T.Mesh(new T.SphereGeometry(0.03, 8, 6), K.mat(0x2a2a34, { roughness: 0.6 })));
    } else if (kind === 'bluebell') {
      var bell = new T.Mesh(new T.ConeGeometry(0.06, 0.11, 8),
        K.mat(0x8ecae6, { roughness: 0.6, side: T.DoubleSide }));
      bell.rotation.x = Math.PI;
      bell.position.y = -0.02;
      head.add(bell);
    } else {
      // daisy — the default
      var cols = [0xffffff, 0xfff2fa, 0xffd93d, 0xffb0c8, 0xbfe9ff];
      var dc = cols[Math.floor(rnd() * cols.length)];
      for (var d = 0; d < 7; d++) {
        var da = (d / 7) * Math.PI * 2;
        var dpet = new T.Mesh(new T.SphereGeometry(0.05, 8, 6),
          K.mat(dc, { roughness: 0.5, side: T.DoubleSide }));
        dpet.scale.set(1.5, 0.26, 0.7);
        dpet.position.set(Math.cos(da) * 0.055, 0, Math.sin(da) * 0.055);
        dpet.rotation.y = -da;
        head.add(dpet);
      }
      head.add(new T.Mesh(new T.SphereGeometry(0.032, 8, 6), K.mat(0xffc93a, { roughness: 0.45 })));
    }

    // face the flower up and tip it slightly toward the sky
    head.rotation.x = -0.25 - rnd() * 0.25;
    g.add(head);
    return g;
  }

  /* a scattered patch of mixed flowers */
  function flowerPatch() {
    var g = new T.Group();
    var kinds = ['daisy', 'daisy', 'tulip', 'poppy', 'bluebell'];
    var n = 3 + Math.floor(rnd() * 4);
    for (var i = 0; i < n; i++) {
      var f = flowerPlant(kinds[Math.floor(rnd() * kinds.length)]);
      f.position.set((rnd() - 0.5) * 1.1, 0, (rnd() - 0.5) * 1.1);
      f.rotation.y = rnd() * Math.PI * 2;
      f.scale.setScalar(0.85 + rnd() * 0.5);
      g.add(f);
    }
    return g;
  }

  function buildFlora() {
    var i, a, r, o;
    // Everything static is collected here and then merged into a handful of
    // meshes by batchStatic(), which keeps the draw-call count (and the shadow
    // pass) very cheap.
    var props = new T.Group();

    // lily pads in the water, hugging the edges
    for (i = 0; i < 22; i++) {
      a = rnd() * Math.PI * 2;
      r = 3.4 + rnd() * (SWIM_R - 3.0);
      o = lilyPad();
      o.scale.setScalar(0.65 + rnd() * 0.85);
      place(o, r, a, 0.045);
      o.rotation.y = rnd() * 3;
      props.add(o);
    }

    // reeds around the waterline
    for (i = 0; i < 40; i++) {
      a = rnd() * Math.PI * 2;
      r = 10.4 + rnd() * 1.9;
      o = reedClump();
      o.scale.setScalar(0.75 + rnd() * 0.6);
      place(o, r, a, shoreY(r) - 0.05);
      props.add(o);
    }

    // rocks on the bank
    for (i = 0; i < 34; i++) {
      a = rnd() * Math.PI * 2;
      r = 10.7 + rnd() * 8;
      o = rock();
      o.scale.multiplyScalar(0.55 + rnd() * 0.8);
      place(o, r, a, shoreY(r) - 0.1);
      props.add(o);
    }

    // grass tufts — a soft carpet across the bank
    for (i = 0; i < 340; i++) {
      a = rnd() * Math.PI * 2;
      r = 11.2 + rnd() * 20;
      o = grassTuft();
      o.scale.setScalar(0.8 + rnd() * 0.8);
      place(o, r, a, shoreY(r) - 0.03);
      o.rotation.y = rnd() * 3;
      props.add(o);
    }

    // a denser band of grass just up the bank from the water
    for (i = 0; i < 150; i++) {
      a = rnd() * Math.PI * 2;
      r = 11.8 + rnd() * 5.0;
      o = grassTuft();
      o.scale.setScalar(0.95 + rnd() * 0.7);
      place(o, r, a, shoreY(r) - 0.03);
      o.rotation.y = rnd() * 3;
      props.add(o);
    }

    // taller grass hugging the waterline so the pond edge grows in softly
    for (i = 0; i < 150; i++) {
      a = rnd() * Math.PI * 2;
      r = 10.7 + rnd() * 2.6;
      o = tallGrass();
      o.scale.setScalar(0.7 + rnd() * 0.6);
      place(o, r, a, shoreY(r) - 0.05);
      o.rotation.y = rnd() * 3;
      props.add(o);
    }

    // flowers dotted around the meadow
    for (i = 0; i < 46; i++) {
      a = rnd() * Math.PI * 2;
      r = 11.6 + rnd() * 16;
      o = flowerPatch();
      place(o, r, a, shoreY(r) - 0.03);
      props.add(o);
    }

    // a scattering of single flowers right by the water
    for (i = 0; i < 34; i++) {
      a = rnd() * Math.PI * 2;
      r = 11.0 + rnd() * 3.4;
      o = flowerPlant(['daisy', 'tulip', 'poppy', 'bluebell'][Math.floor(rnd() * 4)]);
      o.scale.setScalar(0.85 + rnd() * 0.5);
      place(o, r, a, shoreY(r) - 0.04);
      o.rotation.y = rnd() * 3;
      props.add(o);
    }

    // bushes
    for (i = 0; i < 26; i++) {
      a = rnd() * Math.PI * 2;
      r = 15 + rnd() * 18;
      o = bush(0.9 + rnd() * 0.9);
      place(o, r, a, shoreY(r) - 0.2);
      props.add(o);
    }

    // trees
    for (i = 0; i < 30; i++) {
      a = (i / 30) * Math.PI * 2 + rnd() * 0.2;
      r = 22 + rnd() * 26;
      o = tree();
      o.scale.setScalar(0.85 + rnd() * 0.8);
      place(o, r, a, shoreY(r) - 0.15);
      o.rotation.y = rnd() * 3;
      props.add(o);
    }

    // a few bigger rocks right at the water's edge
    for (i = 0; i < 10; i++) {
      a = rnd() * Math.PI * 2;
      r = 10.9 + rnd() * 1.2;
      o = rock();
      o.scale.multiplyScalar(1.0 + rnd() * 0.6);
      place(o, r, a, shoreY(r) - 0.25);
      props.add(o);
    }

    /* keep a patch of open ground around the nest and the catch bucket, so the
       carpet of grass/flowers/reeds can never bury the nest, the eggs, the
       hatchling or the bucket */
    var nx = Math.cos(NEST_A) * NEST_R, nz = Math.sin(NEST_A) * NEST_R;
    var bx = Math.cos(BUCKET_A) * BUCKET_R, bz = Math.sin(BUCKET_A) * BUCKET_R;
    for (i = props.children.length - 1; i >= 0; i--) {
      var ch = props.children[i];
      var px = ch.position.x, pz = ch.position.z;
      var dnx = px - nx, dnz = pz - nz;
      var dbx = px - bx, dbz = pz - bz;
      if (dnx * dnx + dnz * dnz < NEST_CLEAR * NEST_CLEAR ||
          dbx * dbx + dbz * dbz < BUCKET_CLEAR * BUCKET_CLEAR) {
        props.remove(ch);
      }
    }

    addBatched(scene, props, { roughness: 0.94 });
  }

  /* =========================================================
     sky, clouds, dragonflies, pollen
     ========================================================= */
  function buildSky() {
    var skyMat = new T.ShaderMaterial({
      side: T.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        cTop: { value: new T.Color(0x5fb8e8) },
        cMid: { value: new T.Color(0xbfe8f8) },
        cBot: { value: new T.Color(0xfdf3dc) },
        cSun: { value: new T.Color(0xfff2cf) },
        uSun: { value: new T.Vector3(0.55, 0.72, 0.42).normalize() }
      },
      vertexShader: [
        'varying vec3 vDir;',
        'void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }'
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 cTop; uniform vec3 cMid; uniform vec3 cBot; uniform vec3 cSun; uniform vec3 uSun;',
        'varying vec3 vDir;',
        'void main(){',
        '  float y = clamp(vDir.y, -1.0, 1.0);',
        '  vec3 c = mix(cBot, cMid, smoothstep(-0.06, 0.30, y));',
        '  c = mix(c, cTop, smoothstep(0.22, 0.95, y));',
        '  float s = max(dot(normalize(vDir), uSun), 0.0);',
        '  c += cSun * pow(s, 22.0) * 0.55;',
        '  c += cSun * pow(s, 4.0) * 0.10;',
        '  gl_FragColor = vec4(c, 1.0);',
        '  #include <tonemapping_fragment>',
        '  #include <colorspace_fragment>',
        '}'
      ].join('\n')
    });
    var sky = new T.Mesh(new T.SphereGeometry(240, 32, 20), skyMat);
    sky.renderOrder = -1;
    scene.add(sky);
  }

  function buildClouds() {
    var mat = K.mat(0xffffff, { roughness: 1.0, envMapIntensity: 0.9 });
    for (var i = 0; i < 9; i++) {
      var g = new T.Group();
      var n = 3 + Math.floor(rnd() * 4);
      for (var j = 0; j < n; j++) {
        var s = 2.0 + rnd() * 3.2;
        var b = new T.Mesh(new T.SphereGeometry(s, 12, 9), mat);
        b.position.set((rnd() - 0.5) * 9, (rnd() - 0.5) * 1.6, (rnd() - 0.5) * 5);
        b.scale.y = 0.62;
        g.add(b);
      }
      // merge the puff into one mesh, then place the whole cloud
      var merged = batchStatic(g, { roughness: 1.0 });
      var puff = new T.Group();
      merged.forEach(function (m) { puff.add(m); });
      batchCleanup(g);

      var a = (i / 9) * Math.PI * 2 + rnd();
      var r = 46 + rnd() * 40;
      puff.position.set(Math.cos(a) * r, 24 + rnd() * 14, Math.sin(a) * r);
      puff.userData.drift = 0.5 + rnd() * 0.7;
      scene.add(puff);
      clouds.push(puff);
    }
  }

  function dragonfly() {
    var g = new T.Group();
    var body = new T.Mesh(new T.CapsuleGeometry(0.035, 0.34, 3, 8),
      K.mat(0x3fa8d8, { roughness: 0.4, metalness: 0.15 }));
    body.rotation.z = Math.PI / 2;
    body.castShadow = true;
    g.add(body);
    var head = new T.Mesh(new T.SphereGeometry(0.062, 10, 8),
      K.mat(0x2d7ea6, { roughness: 0.35 }));
    head.position.x = 0.2;
    g.add(head);

    var wingMat = K.mat(0xdff6ff, {
      transparent: true, opacity: 0.45, roughness: 0.1, side: T.DoubleSide
    });
    var wings = [];
    [[-1, 1], [-1, -1], [1, 1], [1, -1]].forEach(function (sd) {
      var w = new T.Mesh(new T.PlaneGeometry(0.42, 0.13), wingMat);
      w.position.set(sd[0] * 0.09, 0.02, sd[1] * 0.08);
      w.rotation.x = -Math.PI / 2;
      w.userData.side = sd[1];
      w.userData.fb = sd[0];
      wings.push(w);
      g.add(w);
    });
    g.userData.wings = wings;
    return g;
  }

  function buildDragonflies() {
    for (var i = 0; i < 4; i++) {
      var d = dragonfly();
      d.userData.a = rnd() * Math.PI * 2;
      d.userData.r = 4 + rnd() * 5;
      d.userData.spd = 0.35 + rnd() * 0.4;
      d.userData.y = 1.3 + rnd() * 1.6;
      d.userData.ph = rnd() * 10;
      scene.add(d);
      dragonflies.push(d);
    }
  }

  function buildPollen() {
    var n = 260;
    var pos = new Float32Array(n * 3);
    var seed = [];
    for (var i = 0; i < n; i++) {
      var a = rnd() * Math.PI * 2;
      var r = Math.sqrt(rnd()) * 34;
      var y = 0.6 + rnd() * 9;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = Math.sin(a) * r;
      seed.push(rnd() * 100);
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    var m = new T.PointsMaterial({
      color: 0xfff6d0, size: 0.13, transparent: true, opacity: 0.72,
      depthWrite: false, sizeAttenuation: true
    });
    pollen = new T.Points(g, m);
    pollen.userData.seed = seed;
    pollen.userData.base = pos.slice(0);
    scene.add(pollen);
  }

  /* =========================================================
     the net
     ========================================================= */
  function buildNet() {
    var g = new T.Group();

    var cord = new T.MeshStandardMaterial({ color: 0xf7f4ea, roughness: 0.7, metalness: 0.0 });
    var frameMat = new T.MeshStandardMaterial({ color: 0x4fb0c4, roughness: 0.35, metalness: 0.35, envMapIntensity: 0.9 });

    /* ring */
    var ring = new T.Mesh(new T.TorusGeometry(2.0, 0.115, 12, 48), frameMat);
    ring.rotation.x = -Math.PI / 2;
    ring.castShadow = true;
    g.add(ring);

    /* inner lip so the ring reads from above */
    var lip = new T.Mesh(new T.TorusGeometry(1.86, 0.03, 8, 44),
      new T.MeshStandardMaterial({ color: 0xd8f2f8, roughness: 0.4, metalness: 0.2 }));
    lip.rotation.x = -Math.PI / 2;
    lip.position.y = 0.02;
    g.add(lip);

    /* net bag */
    var pts = [];
    var N = 12;
    for (var i = 0; i <= N; i++) {
      var tt = i / N;
      var y = -1.95 * tt;
      var rr = 1.96 * Math.cos(tt * Math.PI * 0.5) * (1 - 0.1 * tt);
      pts.push(new T.Vector2(Math.max(0.0015, rr), y));
    }
    var bagGeo = new T.LatheGeometry(pts, 30);

    var bag = new T.Mesh(bagGeo, new T.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.16,
      side: T.DoubleSide, depthWrite: false
    }));
    bag.renderOrder = 3;
    g.add(bag);

    var meshGeo = new T.LatheGeometry(pts, 12);
    var meshView = new T.Mesh(meshGeo, new T.MeshBasicMaterial({
      color: 0xeaf7fb, wireframe: true, transparent: true, opacity: 0.42,
      side: T.DoubleSide, depthWrite: false
    }));
    meshView.renderOrder = 4;
    g.add(meshView);

    /* handle */
    var handlePivot = new T.Group();
    handlePivot.position.set(0, 0.08, -1.95);
    handlePivot.rotation.x = -0.98;
    g.add(handlePivot);

    var pole = new T.Mesh(new T.CylinderGeometry(0.075, 0.09, 7.4, 12), frameMat);
    pole.position.y = 3.7;
    pole.castShadow = true;
    handlePivot.add(pole);

    var grip = new T.Mesh(new T.CylinderGeometry(0.105, 0.105, 1.15, 12),
      new T.MeshStandardMaterial({ color: 0xf2a03c, roughness: 0.85 }));
    grip.position.y = 6.5;
    handlePivot.add(grip);

    var cap = new T.Mesh(new T.SphereGeometry(0.1, 12, 10),
      new T.MeshStandardMaterial({ color: 0xffd93d, roughness: 0.4, metalness: 0.2 }));
    cap.position.y = 7.1;
    handlePivot.add(cap);

    /* shadow blob on the water */
    netShadow = new T.Mesh(
      new T.CircleGeometry(2.05, 32),
      new T.MeshBasicMaterial({ color: 0x0b3d55, transparent: true, opacity: 0.18, depthWrite: false })
    );
    netShadow.rotation.x = -Math.PI / 2;
    netShadow.position.y = 0.035;
    netShadow.renderOrder = 2;
    scene.add(netShadow);

    g.renderOrder = 5;
    scene.add(g);

    net = {
      group: g,
      x: 0, z: 0,
      y: 1.45,
      idleY: 1.45,
      bottomY: 0.06,
      scoopT: -1,
      scoopDur: 0.52,
      fired: false,
      onDip: null,
      tilt: 0,
      setTarget: function (x, z) { net.x = x; net.z = z; },
      startScoop: function () {
        if (net.scoopT >= 0) return false;
        net.scoopT = 0;
        net.fired = false;
        return true;
      },
      isScooping: function () { return net.scoopT >= 0; },
      update: function (dt) {
        // ease toward the pointer so the net feels weighty but responsive
        var g2 = net.group;
        var k = 1 - Math.pow(2.0e-8, dt);
        g2.position.x += (net.x - g2.position.x) * k;
        g2.position.z += (net.z - g2.position.z) * k;

        if (net.scoopT >= 0) {
          net.scoopT += dt / net.scoopDur;
          var p = net.scoopT;
          var dip = 0.34;
          var e;
          if (p < dip) {
            var u = p / dip;
            e = u * u * (3 - 2 * u);
            net.y = net.idleY + (net.bottomY - net.idleY) * e;
            net.tilt = e * 0.34;
          } else if (p < 1) {
            var v = (p - dip) / (1 - dip);
            e = v * v * (3 - 2 * v);
            net.y = net.bottomY + (net.idleY - net.bottomY) * e;
            net.tilt = (1 - e) * 0.34;
          } else {
            net.y = net.idleY;
            net.tilt = 0;
            net.scoopT = -1;
          }
          if (!net.fired && p >= dip) {
            net.fired = true;
            if (net.onDip) net.onDip(g2.position.x, g2.position.z);
          }
        } else {
          net.y = net.idleY + Math.sin(t * 2.1) * 0.075;
          net.tilt = Math.sin(t * 1.6) * 0.03;
        }

        g2.position.y = net.y;
        g2.rotation.x = net.tilt * 0.7;
        g2.rotation.z = Math.sin(t * 1.3) * 0.03;

        // shadow follows and fades with height
        var h = Math.max(0, net.y - 0.06);
        netShadow.position.x = g2.position.x;
        netShadow.position.z = g2.position.z;
        var s = 1 + h * 0.10;
        netShadow.scale.set(s, s, s);
        netShadow.material.opacity = 0.22 * (1 - Math.min(0.75, h / 3.0));
      }
    };
  }

  /* =========================================================
     effect pools
     ========================================================= */
  function makeRipplePool() {
    var geo = new T.RingGeometry(0.82, 1.0, 40);
    for (var i = 0; i < 46; i++) {
      var m = new T.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, depthWrite: false
      });
      var mesh = new T.Mesh(geo, m);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.05;
      mesh.visible = false;
      mesh.renderOrder = 2;
      scene.add(mesh);
      ripples.push({ mesh: mesh, life: 0, dur: 1, s0: 1, s1: 2, o0: 0.4 });
    }
  }

  function ripple(x, z, opts) {
    opts = opts || {};
    for (var i = 0; i < ripples.length; i++) {
      var r = ripples[i];
      if (r.life > 0) continue;
      r.life = 0.0001;
      r.dur = opts.dur || 1.25;
      r.s0 = opts.s0 == null ? 0.45 : opts.s0;
      r.s1 = opts.s1 == null ? 2.1 : opts.s1;
      r.o0 = opts.o0 == null ? 0.34 : opts.o0;
      r.mesh.material.color.set(opts.color == null ? 0xffffff : opts.color);
      r.mesh.position.set(x, opts.y == null ? 0.05 : opts.y, z);
      r.mesh.visible = true;
      return r;
    }
    return null;
  }

  function makeDropPool() {
    var geo = new T.SphereGeometry(0.055, 8, 6);
    var mat = new T.MeshBasicMaterial({ color: 0xf2fbff, transparent: true, opacity: 0.9, depthWrite: false });
    for (var i = 0; i < 90; i++) {
      var m = new T.Mesh(geo, mat.clone());
      m.visible = false;
      scene.add(m);
      drops.push({ mesh: m, life: 0, dur: 1, vx: 0, vy: 0, vz: 0 });
    }
  }

  function dropBurst(x, y, z, n, power, spread) {
    var made = 0;
    for (var i = 0; i < drops.length && made < n; i++) {
      var d = drops[i];
      if (d.life > 0) continue;
      made++;
      d.life = 0.0001;
      d.dur = 0.55 + Math.random() * 0.5;
      var a = Math.random() * Math.PI * 2;
      var sp = (0.4 + Math.random()) * power;
      d.vx = Math.cos(a) * sp * spread;
      d.vz = Math.sin(a) * sp * spread;
      d.vy = (1.4 + Math.random() * 1.5) * power;
      d.mesh.position.set(x, y, z);
      var sc = 0.6 + Math.random() * 0.9;
      d.mesh.scale.setScalar(sc);
      d.mesh.visible = true;
      d.mesh.material.opacity = 0.95;
    }
  }

  function makeSparkPool() {
    var geo = new T.OctahedronGeometry(0.09, 0);
    for (var i = 0; i < 60; i++) {
      var m = new T.Mesh(geo, new T.MeshBasicMaterial({
        color: 0xffd93d, transparent: true, opacity: 0, depthWrite: false
      }));
      m.visible = false;
      scene.add(m);
      sparks.push({ mesh: m, life: 0, dur: 1, vx: 0, vy: 0, vz: 0, spin: 0 });
    }
  }

  function sparkBurst(x, y, z, n) {
    var made = 0;
    for (var i = 0; i < sparks.length && made < n; i++) {
      var s = sparks[i];
      if (s.life > 0) continue;
      made++;
      s.life = 0.0001;
      s.dur = 0.75 + Math.random() * 0.75;
      var a = Math.random() * Math.PI * 2;
      var b = Math.acos(Math.random() * 1.6 - 0.6);
      var sp = 1.4 + Math.random() * 2.0;
      s.vx = Math.sin(b) * Math.cos(a) * sp;
      s.vz = Math.sin(b) * Math.sin(a) * sp;
      s.vy = Math.cos(b) * sp + 1.4;
      s.spin = (Math.random() - 0.5) * 12;
      s.mesh.position.set(x, y, z);
      s.mesh.material.color.set(Math.random() > 0.45 ? 0xffd93d : 0xfff3c0);
      var sc = 0.5 + Math.random() * 0.9;
      s.mesh.scale.setScalar(sc);
      s.mesh.visible = true;
      s.mesh.material.opacity = 1;
    }
  }

  /* =========================================================
     THE BUCKET — every duck you catch drops in here
     ========================================================= */
  var bucket = { group: null, ducks: [], fill: 0, pos: new T.Vector3(), drop: new T.Vector3() };

  function miniDuck(col) {
    var g = new T.Group();
    var body = new T.Mesh(new T.SphereGeometry(0.185, 14, 10), K.mat(col, { roughness: 0.72 }));
    body.scale.set(1, 0.9, 1.28);
    g.add(body);
    var head = new T.Mesh(new T.SphereGeometry(0.125, 14, 10), K.mat(col, { roughness: 0.72 }));
    head.position.set(0, 0.17, 0.14);
    g.add(head);
    var beak = new T.Mesh(new T.ConeGeometry(0.05, 0.11, 8), K.mat(0xff9a3c, { roughness: 0.45 }));
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.15, 0.27);
    g.add(beak);
    return g;   // deliberately shallow-cast: costs nothing while hidden
  }

  function buildBucket(a, r) {
    var g = new T.Group();
    var y = shoreY(r);
    var x = Math.cos(a) * r, z = Math.sin(a) * r;
    bucket.pos.set(x, y, z);
    bucket.drop.set(x, y + 1.35, z);
    g.position.set(x, y, z);
    g.rotation.y = -a + Math.PI / 2;

    var RT = 0.62, RB = 0.46, H = 0.74;
    var metal = K.mat(0x9aa7b4, { roughness: 0.32, metalness: 0.8 });

    var wall = new T.Mesh(new T.CylinderGeometry(RT, RB, H, 24, 1, true),
      K.mat(0xc08c52, { roughness: 0.8, side: T.DoubleSide }));
    wall.position.y = H / 2;
    wall.castShadow = true; wall.receiveShadow = true;
    g.add(wall);

    var bottom = new T.Mesh(new T.CircleGeometry(RB * 1.06, 24), K.mat(0x6f4a26, { roughness: 0.95 }));
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = 0.03;
    g.add(bottom);

    var rim = new T.Mesh(new T.TorusGeometry(RT, 0.06, 8, 28), K.mat(0x8a5f34, { roughness: 0.86 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = H;
    rim.castShadow = true;
    g.add(rim);

    [0.28, 0.74].forEach(function (f) {
      var rr = RB + (RT - RB) * (1 - f);
      var band = new T.Mesh(new T.TorusGeometry(rr + 0.012, 0.026, 8, 26), metal);
      band.rotation.x = Math.PI / 2;
      band.position.y = f * H;
      g.add(band);
    });

    var handle = new T.Mesh(new T.TorusGeometry(RT * 1.02, 0.022, 8, 24, Math.PI), metal);
    handle.position.y = H + 0.02;
    g.add(handle);

    /* a little heart badge so it reads as the duck basket */
    var badge = new T.Mesh(K.extrude(K.heartShape(0.16), 0.03), K.mat(0xffd93d, { roughness: 0.45 }));
    badge.position.set(0, H * 0.52, RT - 0.01);
    g.add(badge);

    var cols = [0xffd93d, 0xfff8ec, 0x9be8cf, 0x8fc9ff, 0xffb0c8, 0xcdb8ff, 0x63d2ea, 0xffc48f, 0xaef29a];
    bucket.ducks = [];
    for (var i = 0; i < 9; i++) {
      var d = miniDuck(cols[i % cols.length]);
      var ang = (i / 9) * Math.PI * 2 + 0.5;
      var rr2 = i < 3 ? 0.19 : 0.29;
      d.position.set(Math.cos(ang) * rr2, 0.28 + (i % 3) * 0.13 + (i > 5 ? 0.15 : 0), Math.sin(ang) * rr2);
      d.rotation.y = ang + 1.1;
      d.visible = false;
      g.add(d);
      bucket.ducks.push(d);
    }

    bucket.group = g;
    scene.add(g);
  }

  /* =========================================================
     THE NEST — a big clutch of eggs that crack into ducklings
     ========================================================= */
  var EGG_SPOTS = [
    [0, 0], [0.36, 0.12], [-0.35, 0.14], [0.14, -0.35], [-0.16, -0.33],
    [0.30, 0.33], [-0.31, 0.32]
  ];
  // how high a duckling sits above the nest floor (the bowl rim is 0.24 high,
  // so this keeps it nestled among the eggs without sinking into the bowl)
  var NEST_PERCH = 0.20;
  var nest = {
    group: null, eggs: [], shells: [], duckling: null,
    state: 'wait', timer: 4, t: 0, activeEgg: -1, hatched: 0,
    pos: new T.Vector3(), water: new T.Vector3()
  };

  function buildNest(a, r) {
    var g = new T.Group();
    var y = shoreY(r);
    var x = Math.cos(a) * r, z = Math.sin(a) * r;
    nest.pos.set(x, y, z);
    // the duckling waddles into open water — safely inside the swimming area so
    // the hatched duck never appears on the bank/among the reeds and rocks
    var wr = SWIM_R - 0.2;
    nest.water.set(Math.cos(a) * wr, -0.05, Math.sin(a) * wr);
    g.position.set(x, y, z);
    g.rotation.y = -a + Math.PI / 2;

    var twigM = K.mat(0xc2945c, { roughness: 0.9 });
    var bowl = new T.Mesh(new T.CylinderGeometry(0.88, 0.62, 0.24, 20), K.mat(0x8f6a3c, { roughness: 0.95 }));
    bowl.position.y = 0.12;
    bowl.receiveShadow = true;
    g.add(bowl);

    for (var i = 0; i < 30; i++) {
      var ang = (i / 30) * Math.PI * 2 + rnd() * 0.12;
      var tw = new T.Mesh(new T.CylinderGeometry(0.026, 0.022, 0.5 + rnd() * 0.3, 5), twigM);
      tw.position.set(Math.cos(ang) * 0.80, 0.23 + rnd() * 0.05, Math.sin(ang) * 0.80);
      tw.rotation.z = Math.PI / 2 + (rnd() - 0.5) * 0.7;
      tw.rotation.y = -ang + (rnd() - 0.5) * 0.6;
      tw.castShadow = true;
      g.add(tw);
    }

    nest.group = g;
    scene.add(g);
    fillNest();
  }

  function fillNest() {
    nest.eggs.forEach(function (e) { nest.group.remove(e.mesh); });
    nest.eggs = [];
    var tints = [0xfff4e0, 0xffffff, 0xeef7ff, 0xfff0d8, 0xf7f3ea, 0xfff7ee, 0xeaf3ff];
    for (var i = 0; i < EGG_SPOTS.length; i++) {
      var s = EGG_SPOTS[i];
      var tint = tints[i % tints.length];
      var mesh = new T.Mesh(new T.SphereGeometry(0.145, 16, 12), K.mat(tint, { roughness: 0.55 }));
      mesh.scale.set(1, 1.3, 1);
      mesh.castShadow = true;
      mesh.position.set(s[0], 0.30, s[1]);
      mesh.rotation.y = rnd() * Math.PI * 2;
      mesh.rotation.z = (rnd() - 0.5) * 0.5;
      nest.group.add(mesh);
      nest.eggs.push({
        mesh: mesh, baseY: 0.30, tint: tint, done: false,
        variant: K.randomVariant(), pattern: K.randomPattern()
      });
    }
  }

  function popShells(e) {
    var wp = new T.Vector3();
    e.mesh.getWorldPosition(wp);
    var gT = new T.SphereGeometry(0.15, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
    var gB = new T.SphereGeometry(0.15, 14, 8, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.6);
    [gT, gB].forEach(function (geo, i) {
      var m = new T.Mesh(geo, new T.MeshStandardMaterial({
        color: e.tint, roughness: 0.55, transparent: true, opacity: 1, side: T.DoubleSide
      }));
      m.scale.set(1, 1.3, 1);
      m.position.copy(wp);
      scene.add(m);
      nest.shells.push({
        mesh: m, life: 0,
        vx: (i ? -1 : 1) * (0.45 + Math.random() * 0.5),
        vy: 1.5 + Math.random() * 0.8,
        vz: (Math.random() - 0.5) * 0.8,
        sp: 4 + Math.random() * 5
      });
    });
    e.mesh.visible = false;
  }

  function releaseDuckling() {
    var e = nest.eggs[nest.activeEgg];
    if (!e) return;
    var dl = K.buildDuck(e.variant, { pattern: e.pattern });
    dl.scale.setScalar(0.42);
    dl.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    var wp = new T.Vector3();
    e.mesh.getWorldPosition(wp);
    dl.position.set(wp.x, nest.pos.y + NEST_PERCH, wp.z);
    dl.userData.variantId = e.variant.id;
    dl.userData.pattern = e.pattern;
    dl.userData.perch = NEST_PERCH;
    dl.userData.from = new T.Vector3(wp.x, 0, wp.z);
    dl.userData.to = new T.Vector3(nest.water.x, 0, nest.water.z);
    scene.add(dl);
    nest.duckling = dl;
  }

  function updateNest(dt) {
    if (!nest.group) return;
    nest.t += dt;

    /* shell fragments fly off in any state */
    for (var i = nest.shells.length - 1; i >= 0; i--) {
      var sh = nest.shells[i];
      sh.life += dt;
      sh.mesh.position.x += sh.vx * dt;
      sh.mesh.position.y += sh.vy * dt;
      sh.mesh.position.z += sh.vz * dt;
      sh.vy -= 4.2 * dt;
      sh.mesh.rotation.x += dt * sh.sp;
      sh.mesh.rotation.z += dt * sh.sp * 0.7;
      sh.mesh.material.opacity = Math.max(0, 1 - sh.life / 1.1);
      if (sh.life > 1.1) {
        scene.remove(sh.mesh);
        sh.mesh.geometry.dispose();
        sh.mesh.material.dispose();
        nest.shells.splice(i, 1);
      }
    }

    var e = nest.eggs[nest.activeEgg];

    if (nest.state === 'wait') {
      nest.timer -= dt;
      if (nest.timer <= 0) {
        var idx = -1;
        for (var j = 0; j < nest.eggs.length; j++) if (!nest.eggs[j].done) { idx = j; break; }
        if (idx < 0) { nest.state = 'refill'; nest.timer = 9; return; }
        nest.activeEgg = idx;
        nest.state = 'wobble';
        nest.t = 0;
      }
      return;
    }

    if (nest.state === 'wobble') {
      if (!e || e.done) { nest.state = 'wait'; nest.timer = 4; return; }
      var w = Math.min(1, nest.t / 1.6);
      e.mesh.rotation.z = Math.sin(nest.t * (16 + w * 36)) * (0.035 + w * 0.12);
      e.mesh.position.y = e.baseY + Math.abs(Math.sin(nest.t * 20)) * w * 0.08;
      if (w >= 1) {
        e.done = true;
        nest.state = 'crack';
        nest.t = 0;
        popShells(e);
        if (World.onNestCrack) World.onNestCrack(nest.pos.clone());
      }
      return;
    }

    if (nest.state === 'crack') {
      if (nest.t > 0.38) { nest.state = 'waddle'; nest.t = 0; releaseDuckling(); }
      return;
    }

    if (nest.state === 'waddle') {
      var dl = nest.duckling;
      if (!dl) { nest.state = 'wait'; nest.timer = 6; return; }
      var p = Math.min(1, nest.t / 2.4);
      var ex = 1 - Math.pow(1 - p, 2);
      var f = dl.userData.from, t2 = dl.userData.to;
      dl.position.x = f.x + (t2.x - f.x) * ex;
      dl.position.z = f.z + (t2.z - f.z) * ex;
      /* hug the bank as it walks down out of the nest and into the water */
      var dr = Math.sqrt(dl.position.x * dl.position.x + dl.position.z * dl.position.z);
      dl.position.y = Math.max(0, shoreY(dr))
        + (dl.userData.perch || 0) * (1 - ex)
        + Math.abs(Math.sin(p * Math.PI * 6)) * 0.10 * (1 - p);
      dl.rotation.y = Math.atan2(t2.x - f.x, t2.z - f.z);
      K.tickDuck(dl, nest.t + nest.hatched, dt, 1.8);
      if (p >= 1) {
        scene.remove(dl);
        if (global.RL && global.RL.disposeTree) global.RL.disposeTree(dl);
        nest.duckling = null;
        nest.hatched++;
        if (World.onHatch) World.onHatch(dl.userData.variantId, dl.userData.pattern);
        var left = 0;
        for (var k = 0; k < nest.eggs.length; k++) if (!nest.eggs[k].done) left++;
        if (left <= 0) { nest.state = 'refill'; nest.timer = 7 + Math.random() * 2; }
        else { nest.state = 'wait'; nest.timer = 9 + Math.random() * 2; }
      }
      return;
    }

    if (nest.state === 'refill') {
      nest.timer -= dt;
      if (nest.timer <= 0) {
        fillNest();
        nest.state = 'wait';
        nest.timer = 4 + Math.random() * 5;
        if (World.onNestRefill) World.onNestRefill();
      }
    }
  }

  /* =========================================================
     PEOPLE — bystanders around the pond + a visiting buyer
     ========================================================= */
  function shade(hex, f) {
    var c = new T.Color(hex);
    c.multiplyScalar(f);
    return c.getHex();
  }

  function buildPerson(o) {
    o = o || {};
    var g = new T.Group();
    var shirtCol = o.shirt == null ? 0x5bb3e0 : o.shirt;
    var pantsCol = o.pants == null ? 0x46567a : o.pants;
    var skinCol = o.skin == null ? 0xf3c9a4 : o.skin;
    var hairCol = o.hair == null ? 0x53341f : o.hair;

    var skin = K.mat(skinCol, { roughness: 0.72 });
    var skinD = K.mat(shade(skinCol, 0.88), { roughness: 0.74 });
    var shirt = K.mat(shirtCol, { roughness: 0.8 });
    var shirtD = K.mat(shade(shirtCol, 0.78), { roughness: 0.82 });
    var pants = K.mat(pantsCol, { roughness: 0.85 });
    var hairM = K.mat(hairCol, { roughness: 0.92 });
    var shoeM = K.mat(shade(pantsCol, 0.45), { roughness: 0.78 });
    var sockM = K.mat(0xfdf6ec, { roughness: 0.8 });
    var white = K.mat(0xffffff, { roughness: 0.32 });
    var dark = K.mat(0x2a2a34, { roughness: 0.3 });
    var blushM = K.mat(0xff9db4, { roughness: 0.7 });
    var mouthM = K.mat(0x9c4a3c, { roughness: 0.6 });

    function add(m) { m.castShadow = true; g.add(m); return m; }

    /* legs, socks and soft rounded shoes */
    [-1, 1].forEach(function (side) {
      var x = 0.105 * side;
      var leg = add(new T.Mesh(new T.CylinderGeometry(0.088, 0.072, 0.52, 12), pants));
      leg.position.set(x, 0.33, 0);
      var sock = new T.Mesh(new T.CylinderGeometry(0.076, 0.073, 0.10, 12), sockM);
      sock.position.set(x, 0.115, 0);
      g.add(sock);
      var shoe = add(new T.Mesh(new T.SphereGeometry(0.10, 14, 10), shoeM));
      shoe.scale.set(0.98, 0.6, 1.55);
      shoe.position.set(x, 0.055, 0.055);
    });

    /* hips + torso */
    var hips = add(new T.Mesh(new T.CapsuleGeometry(0.155, 0.10, 6, 16), pants));
    hips.scale.set(1.05, 0.85, 0.9);
    hips.position.y = 0.60;

    var torso = add(new T.Mesh(new T.CapsuleGeometry(0.175, 0.30, 8, 20), shirt));
    torso.scale.set(1.06, 1.0, 0.9);
    torso.position.y = 0.88;

    var collar = new T.Mesh(new T.TorusGeometry(0.118, 0.036, 8, 22), shirtD);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 1.055;
    g.add(collar);

    /* shoulders + arms + hands */
    [-1, 1].forEach(function (side) {
      var shoulder = add(new T.Mesh(new T.SphereGeometry(0.082, 12, 10), shirt));
      shoulder.position.set(0.195 * side, 1.02, 0);
      var arm = add(new T.Mesh(new T.CapsuleGeometry(0.053, 0.30, 5, 12), shirt));
      arm.position.set(0.232 * side, 0.83, 0.005);
      arm.rotation.z = 0.19 * side;
      var hand = add(new T.Mesh(new T.SphereGeometry(0.058, 12, 10), skin));
      hand.position.set(0.292 * side, 0.575, 0.012);
    });

    /* neck + head */
    var neck = new T.Mesh(new T.CylinderGeometry(0.058, 0.064, 0.10, 10), skinD);
    neck.position.y = 1.115;
    g.add(neck);

    var head = add(new T.Mesh(new T.SphereGeometry(0.155, 24, 18), skin));
    head.scale.set(1.0, 1.06, 1.0);
    head.position.y = 1.30;

    [-1, 1].forEach(function (side) {
      var ear = new T.Mesh(new T.SphereGeometry(0.032, 8, 8), skin);
      ear.scale.set(0.5, 1.0, 0.85);
      ear.position.set(0.152 * side, 1.295, 0.005);
      g.add(ear);
    });

    /* face — eyes, highlight, brow, blush, nose and a smile */
    [-1, 1].forEach(function (side) {
      var ex = 0.058 * side;
      var eyeW = new T.Mesh(new T.SphereGeometry(0.030, 10, 8), white);
      eyeW.scale.set(1.0, 1.12, 0.72);
      eyeW.position.set(ex, 1.315, 0.134);
      g.add(eyeW);
      var pupil = new T.Mesh(new T.SphereGeometry(0.019, 10, 8), dark);
      pupil.position.set(ex, 1.315, 0.150);
      g.add(pupil);
      var hi = new T.Mesh(new T.SphereGeometry(0.0075, 8, 6), white);
      hi.position.set(ex + 0.007 * side, 1.325, 0.164);
      g.add(hi);
      var brow = new T.Mesh(new T.BoxGeometry(0.048, 0.011, 0.014), hairM);
      brow.position.set(ex, 1.358, 0.148);
      brow.rotation.z = -0.14 * side;
      g.add(brow);
      var blush = new T.Mesh(new T.SphereGeometry(0.026, 8, 6), blushM);
      blush.scale.set(1.0, 0.68, 0.5);
      blush.position.set(0.094 * side, 1.272, 0.124);
      g.add(blush);
    });

    var nose = new T.Mesh(new T.SphereGeometry(0.027, 10, 8), skinD);
    nose.scale.set(0.85, 0.8, 1.05);
    nose.position.set(0, 1.292, 0.156);
    g.add(nose);

    var smile = new T.Mesh(new T.TorusGeometry(0.046, 0.010, 8, 18, Math.PI), mouthM);
    smile.rotation.z = Math.PI;
    smile.scale.set(1, 0.85, 1);
    smile.position.set(0, 1.258, 0.150);
    g.add(smile);

    /* hair — a few styles so the crowd reads as different people */
    var style = o.hairStyle || 'short';
    var cap = new T.Mesh(new T.SphereGeometry(0.168, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.58), hairM);
    cap.scale.set(1.0, 1.05, 1.02);
    cap.position.y = 1.305;
    g.add(cap);

    if (style === 'bob') {
      var back = new T.Mesh(new T.SphereGeometry(0.172, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.9), hairM);
      back.scale.set(1.0, 0.95, 1.06);
      back.position.set(0, 1.30, -0.02);
      g.add(back);
      [-1, 1].forEach(function (side) {
        var lobe = new T.Mesh(new T.SphereGeometry(0.062, 10, 10), hairM);
        lobe.scale.set(0.85, 1.35, 0.95);
        lobe.position.set(0.145 * side, 1.235, -0.01);
        g.add(lobe);
      });
    } else if (style === 'bun') {
      var bun = new T.Mesh(new T.SphereGeometry(0.072, 12, 10), hairM);
      bun.position.set(0, 1.40, -0.115);
      g.add(bun);
    } else if (style === 'ponytail') {
      var tie = new T.Mesh(new T.TorusGeometry(0.036, 0.014, 8, 14), K.mat(shade(shirtCol, 0.7), { roughness: 0.8 }));
      tie.rotation.x = Math.PI / 2;
      tie.position.set(0, 1.315, -0.145);
      g.add(tie);
      var tail = new T.Mesh(new T.CapsuleGeometry(0.05, 0.16, 5, 10), hairM);
      tail.position.set(0, 1.205, -0.19);
      tail.rotation.x = 0.4;
      g.add(tail);
    } else {
      [-1, 1].forEach(function (side) {
        var tuft = new T.Mesh(new T.SphereGeometry(0.055, 10, 8), hairM);
        tuft.scale.set(0.8, 1.0, 1.0);
        tuft.position.set(0.135 * side, 1.27, 0.02);
        g.add(tuft);
      });
    }

    /* optional hat */
    if (o.hat != null) {
      var hm = K.mat(o.hat, { roughness: 0.7 });
      var brim = new T.Mesh(new T.CylinderGeometry(0.265, 0.285, 0.032, 20), hm);
      brim.position.y = 1.415;
      g.add(brim);
      var crownH = new T.Mesh(new T.CylinderGeometry(0.155, 0.172, 0.16, 18), hm);
      crownH.position.y = 1.487;
      g.add(crownH);
      var band = new T.Mesh(new T.TorusGeometry(0.168, 0.022, 8, 20), K.mat(shade(o.hat, 0.72), { roughness: 0.75 }));
      band.rotation.x = Math.PI / 2;
      band.position.y = 1.425;
      g.add(band);
    }

    g.scale.setScalar(o.scale == null ? 1 : o.scale);
    return g;
  }

  function placePerson(parent, person, a, r, faceInward) {
    person.position.set(Math.cos(a) * r, shoreY(r), Math.sin(a) * r);
    person.rotation.y = faceInward === false ? -a + Math.PI / 2 : -a - Math.PI / 2;
    parent.add(person);
    return person;
  }

  function buildPeople() {
    var crowd = new T.Group();
    placePerson(crowd, buildPerson({
      shirt: 0x6ec6ff, pants: 0x3f4f6e, hat: 0xf2d377, hair: 0x3a2a1a, hairStyle: 'short', scale: 1.02
    }), 4.45, 14.6);
    placePerson(crowd, buildPerson({
      shirt: 0xffb3c8, pants: 0x8e6fb0, hair: 0x3a2a1a, hairStyle: 'bob', skin: 0xe8b48c, scale: 0.74
    }), 4.95, 14.3);
    placePerson(crowd, buildPerson({
      shirt: 0x9ee493, pants: 0x4a5a3a, hat: 0xd9b073, hair: 0x6b4423, hairStyle: 'short', skin: 0xc98a5c, scale: 1.0
    }), 5.30, 13.6);
    placePerson(crowd, buildPerson({
      shirt: 0xffd93d, pants: 0x5b6bb0, hair: 0x1f1712, hairStyle: 'ponytail', skin: 0xf6d0ac, scale: 0.97
    }), 5.12, 13.9);
    addBatched(scene, crowd, { roughness: 0.86 });
  }

  /* the visiting buyer who actually pays for ducks */
  var buyer = {
    group: null, state: 'away', t: 0, dur: 1,
    a: 0, r: 0, fromA: 0, toA: 0, fromR: 0, toR: 0,
    homeA: 3.95, homeR: 15.4, spotA: 4.62, spotR: 12.8,
    wait: 0, kind: 'any'
  };

  function buyerPerson() {
    if (buyer.group) return buyer.group;
    var g = buildPerson({
      shirt: 0xff8f6b, pants: 0x40507a, hair: 0x2c1c12, hat: 0xfff3d0, hairStyle: 'bun', skin: 0xf0c39c, scale: 1.03
    });
    /* a little shopping basket so it reads as "customer" */
    var wood = K.mat(0xc9a06a, { roughness: 0.85, side: T.DoubleSide });
    var woodD = K.mat(0x9c7746, { roughness: 0.8 });
    var basket = new T.Mesh(new T.CylinderGeometry(0.155, 0.115, 0.16, 14, 1, true), wood);
    basket.position.set(0.33, 0.60, 0.20);
    basket.castShadow = true;
    g.add(basket);
    var rim = new T.Mesh(new T.TorusGeometry(0.153, 0.016, 8, 18), woodD);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0.33, 0.68, 0.20);
    g.add(rim);
    var handle = new T.Mesh(new T.TorusGeometry(0.088, 0.013, 8, 16, Math.PI), woodD);
    handle.position.set(0.33, 0.69, 0.20);
    g.add(handle);
    /* a soft apron so the seller stands out */
    var apron = new T.Mesh(new T.BoxGeometry(0.22, 0.26, 0.02), K.mat(0xfff6e2, { roughness: 0.85 }));
    apron.position.set(0, 0.86, 0.155);
    g.add(apron);
    scene.add(g);
    buyer.group = g;
    return g;
  }

  function setBuyerAR(a, r) {
    buyer.a = a; buyer.r = r;
    var g = buyerPerson();
    g.position.set(Math.cos(a) * r, shoreY(r), Math.sin(a) * r);
    g.rotation.y = -a - Math.PI / 2;
  }

  function callBuyer() {
    if (buyer.state !== 'away') return false;
    buyer.kind = Math.random() < 0.4 ? 'striped' : 'any';
    buyer.fromA = buyer.homeA; buyer.fromR = buyer.homeR;
    buyer.toA = buyer.spotA; buyer.toR = buyer.spotR;
    buyer.state = 'arrive';
    buyer.t = 0;
    buyer.dur = 3.4;
    setBuyerAR(buyer.fromA, buyer.fromR);
    return true;
  }

  function dismissBuyer() {
    if (buyer.state === 'away' || buyer.state === 'leave') return;
    buyer.fromA = buyer.a; buyer.fromR = buyer.r;
    buyer.toA = buyer.homeA; buyer.toR = buyer.homeR;
    buyer.state = 'leave';
    buyer.t = 0;
    buyer.dur = 3.6;
  }

  function updateBuyer(dt) {
    if (buyer.state === 'away') return;
    buyer.t += dt;

    if (buyer.state === 'arrive' || buyer.state === 'leave') {
      var p = Math.min(1, buyer.t / buyer.dur);
      var e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      setBuyerAR(
        buyer.fromA + (buyer.toA - buyer.fromA) * e,
        buyer.fromR + (buyer.toR - buyer.fromR) * e
      );
      var g = buyer.group;
      g.position.y += Math.abs(Math.sin(p * Math.PI * 7)) * 0.05;
      if (p >= 1) {
        if (buyer.state === 'arrive') {
          buyer.state = 'ready';
          buyer.wait = 26;
          if (World.onBuyerReady) World.onBuyerReady();
        } else {
          buyer.state = 'away';
          if (buyer.group) buyer.group.visible = false;
          if (World.onBuyerLeft) World.onBuyerLeft();
        }
      }
      return;
    }

    if (buyer.state === 'ready') {
      buyer.wait -= dt;
      var gg = buyer.group;
      gg.position.y = shoreY(buyer.r) + Math.sin(t * 2.2) * 0.018;
      gg.rotation.y = -buyer.a - Math.PI / 2 + Math.sin(t * 0.9) * 0.18;
      if (buyer.wait <= 0) {
        dismissBuyer();
        if (World.onBuyerImpatient) World.onBuyerImpatient();
      }
    }
  }


  /* =========================================================
     init / update
     ========================================================= */
  var World = {
    POND_R: POND_R,
    SWIM_R: SWIM_R,
    shoreY: shoreY,
    ripple: ripple,
    dropBurst: dropBurst,
    sparkBurst: sparkBurst,

    /* --- bucket --- */
    bucketPos: function () { return bucket.pos; },
    bucketDrop: function () { return bucket.drop; },
    bucketFill: function () { return bucket.fill; },
    setBucketFill: function (n) {
      bucket.fill = n;
      var vis = Math.min(bucket.ducks.length, Math.max(0, n));
      for (var i = 0; i < bucket.ducks.length; i++) bucket.ducks[i].visible = i < vis;
    },
    bucketPop: function () {
      // a quick squash on the newest duck so the drop reads
      var i = Math.min(bucket.ducks.length, Math.max(1, bucket.fill)) - 1;
      var d = bucket.ducks[i];
      if (!d) return;
      d.userData.pop = 1;
    },
    tickBucket: function (dt) {
      for (var i = 0; i < bucket.ducks.length; i++) {
        var d = bucket.ducks[i];
        if (!d.visible) continue;
        var p = d.userData.pop || 0;
        if (p > 0) {
          p = Math.max(0, p - dt * 3.2);
          d.userData.pop = p;
          var s = 1 + Math.sin(p * Math.PI) * 0.35;
          d.scale.set(s, s, s);
        } else if (d.scale.x !== 1) {
          d.scale.setScalar(1);
        }
        d.position.y += Math.sin(t * 2 + i) * 0.0006;
      }
    },
    bucketDuckCount: function () { return bucket.ducks.length; },
    bucketDuckPos: function (i) {
      var d = bucket.ducks[i];
      var v = new T.Vector3();
      if (d) d.getWorldPosition(v);
      return v;
    },

    /* --- nest --- */
    nestPos: function () { return nest.pos; },
    nestWaterPos: function () { return nest.water; },
    nestEggs: function () { return nest.eggs; },
    nestHatched: function () { return nest.hatched; },

    /* --- buyer --- */
    callBuyer: function () { if (buyer.group) buyer.group.visible = true; return callBuyer(); },
    dismissBuyer: dismissBuyer,
    buyerState: function () { return buyer.state; },
    buyerKind: function () { return buyer.kind; },
    buyerReady: function () { return buyer.state === 'ready'; },
    buyerHeadPos: function () {
      var v = new T.Vector3();
      if (!buyer.group) return v;
      buyer.group.getWorldPosition(v);
      v.y += 1.5 * (buyer.group.scale.y || 1);
      return v;
    },

    init: function (renderer) {
      scene = new T.Scene();
      scene.fog = new T.Fog(0xcfe9f4, 62, 165);

      var env = RL.getEnv();
      if (env) scene.environment = env;

      camera = new T.PerspectiveCamera(42, 1, 0.5, 400);
      camera.position.set(0, 13.2, 15.2);
      camera.lookAt(0, 0, -0.6);

      /* --- lights --- */
      scene.add(new T.HemisphereLight(0xdff2ff, 0x9fbf7a, 1.75));
      scene.add(new T.AmbientLight(0xffffff, 0.34));

      sun = new T.DirectionalLight(0xfff0d2, 2.5);
      sun.position.set(15, 23, 11);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.near = 4;
      sun.shadow.camera.far = 70;
      sun.shadow.camera.left = -19;
      sun.shadow.camera.right = 19;
      sun.shadow.camera.top = 19;
      sun.shadow.camera.bottom = -19;
      sun.shadow.bias = -0.0009;
      sun.shadow.normalBias = 0.025;
      scene.add(sun);
      sunTarget = new T.Object3D();
      scene.add(sunTarget);
      sun.target = sunTarget;

      var rim = new T.DirectionalLight(0xa8d8ff, 0.7);
      rim.position.set(-12, 8, -10);
      scene.add(rim);

      buildSky();
      buildShore();
      buildWater();
      buildFlora();
      buildClouds();
      buildDragonflies();
      buildPollen();

      buildBucket(BUCKET_A, BUCKET_R);
      buildNest(NEST_A, NEST_R);
      buildPeople();

      makeRipplePool();
      makeDropPool();
      makeSparkPool();
      buildNet();

      World.scene = scene;
      World.camera = camera;
      World.sun = sun;
      World.water = water;
      World.net = net;
      return World;
    },

    resize: function (w, h) {
      if (!camera) return;
      camera.aspect = w / h;
      // keep the pond nicely framed on narrow screens
      var zoom = 1 + Math.max(0, (1.35 - camera.aspect)) * 0.85;
      camera.position.set(0, 13.2 * zoom, 15.2 * zoom);
      camera.lookAt(0, 0, -0.6);
      camera.updateProjectionMatrix();
    },

    /** Ray-cast a screen point onto the water plane (y = 0). */
    pointerToPond: function (nx, ny) {
      // nx, ny in normalised device coords (-1..1)
      var v = new T.Vector3(nx, ny, 0.5).unproject(camera);
      var dir = v.sub(camera.position).normalize();
      var denom = dir.y;
      if (Math.abs(denom) < 1e-5) return { x: 0, z: 0 };
      var dist = -camera.position.y / denom;
      if (dist < 0) dist = 100;
      return {
        x: camera.position.x + dir.x * dist,
        z: camera.position.z + dir.z * dist
      };
    },

    /** Screen-space pan (-1..1) for a world position, for stereo sfx. */
    panFor: function (x, z) {
      var p = new T.Vector3(x, 0, z).project(camera);
      return Math.max(-1, Math.min(1, p.x));
    },

    update: function (dt) {
      t += dt;

      if (waterMat) {
        waterMat.uniforms.uTime.value = t;
        waterMat.uniforms.uCamPos.value.copy(camera.position);
      }

      net.update(dt);

      /* ripples */
      for (var i = 0; i < ripples.length; i++) {
        var r = ripples[i];
        if (r.life <= 0) continue;
        r.life += dt / r.dur;
        if (r.life >= 1) { r.life = 0; r.mesh.visible = false; continue; }
        var e = r.life;
        var s = r.s0 + (r.s1 - r.s0) * Math.pow(e, 0.55);
        r.mesh.scale.set(s, s, s);
        r.mesh.material.opacity = r.o0 * (1 - e) * (1 - e);
      }

      /* droplets */
      for (var j = 0; j < drops.length; j++) {
        var d = drops[j];
        if (d.life <= 0) continue;
        d.life += dt / d.dur;
        if (d.life >= 1 || d.mesh.position.y < -0.4) {
          d.life = 0; d.mesh.visible = false; continue;
        }
        d.vy -= 9.2 * dt;
        d.mesh.position.x += d.vx * dt;
        d.mesh.position.y += d.vy * dt;
        d.mesh.position.z += d.vz * dt;
        d.mesh.material.opacity = 0.95 * (1 - d.life);
      }

      /* sparks */
      for (var k = 0; k < sparks.length; k++) {
        var s2 = sparks[k];
        if (s2.life <= 0) continue;
        s2.life += dt / s2.dur;
        if (s2.life >= 1) { s2.life = 0; s2.mesh.visible = false; continue; }
        s2.vy -= 4.2 * dt;
        s2.mesh.position.x += s2.vx * dt;
        s2.mesh.position.y += s2.vy * dt;
        s2.mesh.position.z += s2.vz * dt;
        s2.mesh.rotation.x += s2.spin * dt;
        s2.mesh.rotation.y += s2.spin * dt * 0.7;
        s2.mesh.material.opacity = 1 - s2.life;
        s2.mesh.scale.multiplyScalar(1 - dt * 0.7);
      }

      /* clouds */
      for (var c = 0; c < clouds.length; c++) {
        var cl = clouds[c];
        cl.position.x += cl.userData.drift * dt;
        if (cl.position.x > 120) cl.position.x = -120;
      }

      /* dragonflies */
      for (var f = 0; f < dragonflies.length; f++) {
        var df = dragonflies[f];
        var ud = df.userData;
        ud.a += ud.spd * dt;
        df.position.set(
          Math.cos(ud.a) * ud.r,
          ud.y + Math.sin(t * 1.7 + ud.ph) * 0.32,
          Math.sin(ud.a) * ud.r
        );
        df.rotation.y = -ud.a + Math.PI / 2;
        df.rotation.z = Math.sin(t * 2.3 + ud.ph) * 0.12;
        var flap = Math.sin(t * 42 + ud.ph) * 0.75;
        for (var w = 0; w < ud.wings.length; w++) {
          var wg = ud.wings[w];
          wg.rotation.z = flap * wg.userData.side * wg.userData.fb;
        }
      }

      /* pollen drift */
      if (pollen) {
        var pa = pollen.geometry.attributes.position;
        var seed = pollen.userData.seed;
        for (var p2 = 0; p2 < seed.length; p2++) {
          var yy = pa.getY(p2);
          yy += Math.sin(t * 0.6 + seed[p2]) * 0.0022 + 0.0035;
          if (yy > 10) yy = 0.6;
          pa.setY(p2, yy);
          pa.setX(p2, pa.getX(p2) + Math.cos(t * 0.35 + seed[p2]) * 0.0022);
        }
        pa.needsUpdate = true;
      }

      updateNest(dt);
      updateBuyer(dt);
      World.tickBucket(dt);
    }
  };

  global.World = World;
})(window);
