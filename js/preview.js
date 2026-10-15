/* ===========================================================
   preview.js — the little 3D duck viewer inside "My Ducks"
   =========================================================== */
(function (global) {
  'use strict';

  var T = global.THREE;
  var K = global.DuckKit;

  var Preview = {
    inited: false,
    renderer: null,
    scene: null,
    camera: null,
    duck: null,
    canvas: null,
    yaw: 0.55,
    pitch: 0.20,
    targetYaw: 0.55,
    targetPitch: 0.20,
    autoSpin: true,
    dragging: false,
    lastX: 0,
    lastY: 0,
    t: 0,
    dirty: true
  };

  Preview.init = function (canvas) {
    if (Preview.inited) return;
    Preview.canvas = canvas;

    var renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    Preview.renderer = renderer;

    var scene = new T.Scene();
    if (global.RL && RL.getEnv()) scene.environment = RL.getEnv();
    Preview.scene = scene;

    var hemi = new T.HemisphereLight(0xeaf6ff, 0xc7d8c6, 2.0);
    scene.add(hemi);

    var key = new T.DirectionalLight(0xfff3dd, 2.9);
    key.position.set(3.0, 5.5, 3.6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 20;
    key.shadow.camera.left = -3;
    key.shadow.camera.right = 3;
    key.shadow.camera.top = 3;
    key.shadow.camera.bottom = -3;
    key.shadow.bias = -0.0012;
    scene.add(key);

    var rim = new T.DirectionalLight(0xa9d8ff, 1.7);
    rim.position.set(-4.0, 2.2, -3.0);
    scene.add(rim);

    scene.add(new T.AmbientLight(0xffffff, 0.45));

    var camera = new T.PerspectiveCamera(30, 1, 0.05, 60);
    Preview.camera = camera;

    /* soft shadow-catching disc under the duck */
    var disc = new T.Mesh(
      new T.CircleGeometry(1.5, 40),
      new T.MeshBasicMaterial({
        color: 0x7f9fb5, transparent: true, opacity: 0.16, depthWrite: false
      })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.01;
    disc.receiveShadow = false;
    scene.add(disc);
    Preview.disc = disc;

    bindPointer(canvas);
    Preview.inited = true;
    Preview.resize();
  };

  function bindPointer(canvas) {
    function down(e) {
      Preview.dragging = true;
      Preview.autoSpin = false;
      Preview.lastX = e.clientX;
      Preview.lastY = e.clientY;
      if (canvas.setPointerCapture && e.pointerId != null) {
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      }
    }
    function move(e) {
      if (!Preview.dragging) return;
      var dx = e.clientX - Preview.lastX;
      var dy = e.clientY - Preview.lastY;
      Preview.lastX = e.clientX;
      Preview.lastY = e.clientY;
      Preview.targetYaw += dx * 0.012;
      Preview.targetPitch = Math.max(-0.45, Math.min(0.85, Preview.targetPitch + dy * 0.008));
    }
    function up() { Preview.dragging = false; }

    canvas.addEventListener('pointerdown', down);
    global.addEventListener('pointermove', move);
    global.addEventListener('pointerup', up);
    global.addEventListener('pointercancel', up);
  }

  Preview.resize = function () {
    if (!Preview.inited) return;
    var c = Preview.canvas;
    var w = c.clientWidth || 300;
    var h = c.clientHeight || 200;
    if (w < 2 || h < 2) return;
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    Preview.renderer.setPixelRatio(dpr);
    Preview.renderer.setSize(w, h, false);
    Preview.camera.aspect = w / h;
    Preview.camera.updateProjectionMatrix();
    Preview.dirty = true;
  };

  Preview.show = function (variantId, equip, pattern) {
    if (!Preview.inited) return;
    if (Preview.duck) {
      Preview.scene.remove(Preview.duck);
      RL.disposeTree(Preview.duck);
      Preview.duck = null;
    }
    var duck = K.buildDuck(K.variantById(variantId), { equip: equip || {}, pattern: pattern || null });
    duck.traverse(function (o) {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; }
    });
    Preview.scene.add(duck);
    Preview.duck = duck;

    // frame it: the duck is ~1.5 tall, ~2.2 long
    Preview.camera.position.set(0, 0, 4.6);
    Preview.camera.lookAt(0, 0.78, 0);
    Preview.dirty = true;
    Preview.snap();
  };

  /** force an immediate render (so the canvas isn't blank before the next tick) */
  Preview.snap = function () {
    if (!Preview.inited || !Preview.duck) return;
    Preview.applyOrbit(0);
    Preview.duck.userData.__t = Preview.t;
    K.tickDuck(Preview.duck, Preview.t, 0.016, 0);
    Preview.renderer.render(Preview.scene, Preview.camera);
    Preview.dirty = false;
  };

  Preview.applyOrbit = function (dt) {
    if (Preview.autoSpin && !Preview.dragging) Preview.targetYaw += dt * 0.35;
    var k = Math.min(1, dt * 12);
    Preview.yaw += (Preview.targetYaw - Preview.yaw) * k;
    Preview.pitch += (Preview.targetPitch - Preview.pitch) * k;

    var g = Preview.duck;
    if (!g) return;
    g.rotation.y = Preview.yaw;
    g.position.y = 0;
    // simple camera height tilt
    Preview.camera.position.set(0, 0.78 + Math.sin(Preview.pitch) * 3.4, Math.cos(Preview.pitch) * 4.6);
    Preview.camera.lookAt(0, 0.78 + Math.sin(Preview.pitch) * 0.6, 0);
  };

  Preview.clear = function () {
    if (Preview.duck) {
      Preview.scene.remove(Preview.duck);
      RL.disposeTree(Preview.duck);
      Preview.duck = null;
    }
    if (Preview.inited) Preview.renderer.clear();
  };

  Preview.tick = function (dt) {
    if (!Preview.inited || !Preview.duck) return;
    Preview.t += dt;
    Preview.applyOrbit(dt);
    K.tickDuck(Preview.duck, Preview.t, dt, 0);
    Preview.renderer.render(Preview.scene, Preview.camera);
  };

  global.Preview = Preview;
})(window);
