/* ===========================================================
   renderer-utils.js — env lighting, offscreen thumbnails, disposal
   =========================================================== */
(function (global) {
  'use strict';

  var T = global.THREE;
  var K = global.DuckKit;

  var envTex = null;

  /* ---------------------------------------------------------
     Soft studio-ish environment map (gradient sky + warm floor)
     Gives every material gentle reflections so metals read well.
     --------------------------------------------------------- */
  function initEnv(renderer) {
    if (envTex) return envTex;
    var pmrem = new T.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();

    var scene = new T.Scene();

    var skyMat = new T.ShaderMaterial({
      side: T.BackSide,
      depthWrite: false,
      uniforms: {
        topCol: { value: new T.Color(0xdff3ff) },
        midCol: { value: new T.Color(0xbfe6f7) },
        botCol: { value: new T.Color(0xf6e2b8) }
      },
      vertexShader: [
        'varying vec3 vP;',
        'void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }'
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 topCol; uniform vec3 midCol; uniform vec3 botCol;',
        'varying vec3 vP;',
        'void main(){',
        '  float y = vP.y*0.5+0.5;',
        '  vec3 c = mix(botCol, midCol, smoothstep(0.0,0.55,y));',
        '  c = mix(c, topCol, smoothstep(0.5,1.0,y));',
        '  gl_FragColor = vec4(c,1.0);',
        '}'
      ].join('\n')
    });
    scene.add(new T.Mesh(new T.SphereGeometry(10, 32, 20), skyMat));

    // warm key "sun" blob so specular highlights have a source
    var sun = new T.Mesh(
      new T.SphereGeometry(2.2, 16, 12),
      new T.MeshBasicMaterial({ color: 0xfff6dd })
    );
    sun.position.set(4.5, 6.5, 3.0);
    scene.add(sun);

    envTex = pmrem.fromScene(scene, 0.04).texture;

    sun.geometry.dispose();
    sun.material.dispose();
    skyMat.dispose();
    pmrem.dispose();
    return envTex;
  }

  function getEnv() { return envTex; }

  /* ---------------------------------------------------------
     Disposal — geometries only (materials are cached & shared)
     --------------------------------------------------------- */
  function disposeTree(root) {
    root.traverse(function (o) {
      if (o.isMesh && o.geometry && !o.geometry.userData.keep) o.geometry.dispose();
    });
  }

  /* ---------------------------------------------------------
     Offscreen thumbnail renderer
     --------------------------------------------------------- */
  var thumb = null;
  var thumbCache = Object.create(null);

  function ensureThumb() {
    if (thumb) return thumb;
    var canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    var renderer = new T.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true
    });
    renderer.setPixelRatio(1);
    renderer.setSize(256, 256, false);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;

    var scene = new T.Scene();
    if (envTex) scene.environment = envTex;

    var hemi = new T.HemisphereLight(0xffffff, 0xbcd7e6, 2.1);
    scene.add(hemi);
    var key = new T.DirectionalLight(0xfff4e2, 2.6);
    key.position.set(3.2, 5.2, 4.2);
    scene.add(key);
    var rim = new T.DirectionalLight(0xbfe4ff, 1.5);
    rim.position.set(-4.0, 2.4, -3.2);
    scene.add(rim);
    var fill = new T.AmbientLight(0xffffff, 0.55);
    scene.add(fill);

    var camera = new T.PerspectiveCamera(32, 1, 0.05, 200);

    thumb = { renderer: renderer, scene: scene, camera: camera, canvas: canvas };
    return thumb;
  }

  function fitCamera(camera, object, padding, dir) {
    var box = new T.Box3().setFromObject(object);
    if (box.isEmpty()) { camera.position.set(0, 0, 3); camera.lookAt(0, 0, 0); return; }
    var size = new T.Vector3();
    var center = new T.Vector3();
    box.getSize(size);
    box.getCenter(center);

    var radius = Math.max(size.x, size.y, size.z) * 0.5;
    if (radius < 1e-4) radius = 0.5;
    if (camera.aspect < 1) radius /= Math.max(0.35, camera.aspect);

    var fov = camera.fov * Math.PI / 180;
    var dist = (radius / Math.sin(fov / 2)) * (padding == null ? 1.2 : padding);

    var d = dir || new T.Vector3(0.62, 0.5, 1.0).normalize();
    camera.position.copy(center).addScaledVector(d, dist);
    camera.lookAt(center);
    camera.near = Math.max(0.01, dist - radius * 3);
    camera.far = dist + radius * 6;
    camera.updateProjectionMatrix();
  }

  function snapshot() {
    var t = ensureThumb();
    t.renderer.render(t.scene, t.camera);
    return t.canvas.toDataURL('image/png');
  }

  /** Render a single catalog accessory to a data URL. */
  function itemThumb(item) {
    if (thumbCache[item.id]) return thumbCache[item.id];
    var t = ensureThumb();
    var obj;
    try { obj = item.build(); } catch (e) { return null; }
    obj.position.set(0, 0, 0);
    t.scene.add(obj);
    fitCamera(t.camera, obj, 1.34, new T.Vector3(0.55, 0.62, 0.95).normalize());
    var url = snapshot();
    t.scene.remove(obj);
    disposeTree(obj);
    thumbCache[item.id] = url;
    return url;
  }

  /** Render a duck wearing the given equipment + coat to a data URL. */
  function duckThumb(variantId, equip, opts) {
    opts = opts || {};
    var key = 'duck|' + variantId + '|' + JSON.stringify(opts.pattern || null) + '|' +
      JSON.stringify(equip || {}) + '|' + (opts.view || '');
    if (thumbCache[key]) return thumbCache[key];

    var t = ensureThumb();
    var duck = K.buildDuck(K.variantById(variantId), { equip: equip || {}, pattern: opts.pattern || null });
    // lift slightly so the whole duck is nicely centred
    t.scene.add(duck);
    var dir = opts.view === 'face'
      ? new T.Vector3(0.28, 0.42, 1.0).normalize()
      : new T.Vector3(0.75, 0.52, 0.85).normalize();
    fitCamera(t.camera, duck, opts.view === 'face' ? 1.16 : 1.24, dir);
    var url = snapshot();
    t.scene.remove(duck);
    disposeTree(duck);
    if (!opts.noCache) thumbCache[key] = url;
    return url;
  }

  function clearThumbCache(prefix) {
    if (!prefix) { thumbCache = Object.create(null); return; }
    Object.keys(thumbCache).forEach(function (k) {
      if (k.indexOf(prefix) === 0) delete thumbCache[k];
    });
  }

  global.RL = {
    initEnv: initEnv,
    getEnv: getEnv,
    disposeTree: disposeTree,
    itemThumb: itemThumb,
    duckThumb: duckThumb,
    clearThumbCache: clearThumbCache,
    fitCamera: fitCamera
  };
})(window);
