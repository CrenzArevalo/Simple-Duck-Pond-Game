/* ===========================================================
   game.js — state, ducks, catching, store, wardrobe and UI
   =========================================================== */
(function (global) {
  'use strict';

  var T = global.THREE;
  var K = global.DuckKit;
  var World = global.World;
  var Sound = global.Sound;
  var Preview = global.Preview;

  var COINS_PER_DUCK = 6;
  var RARE_PRICE_MULT = 2;   // rare + golden ducks sell for double
  var GOLDEN_CHANCE = 0.14;  // chance a fresh wild duck is the golden one
  var WILD_TARGET = 40;
  var CATCH_RADIUS = 2.15;
  var FLEE_RADIUS = 4.2;
  var BUMP_DIST = 1.25;     // ducks nudge apart at this body-to-body distance
  var FLOP_TIME = 0.6;      // seconds for a startled wing-flutter to settle
  var SPAWN_INTERVAL = 60;  // a fresh wild duck drifts in about this often (seconds)
  var SAVE_KEY = 'duckpond.save.v1';

  /* ---------------------------------------------------------
     state
     --------------------------------------------------------- */
  var state = {
    coins: 0,
    totalCaught: 0,
    owned: {},
    ducks: [],
    nextId: 1
  };

  var goldenSpawnedThisSession = false;

  var wild = [];
  var spawnQueue = [];
  var renderer, clock;
  var selectedId = null;
  var storeTab = (function () {
    for (var i = 0; i < K.CATEGORIES.length; i++) {
      if (K.CATEGORIES[i].id !== 'all') return K.CATEGORIES[i].id;
    }
    return 'all';
  })();
  var started = false;
  var firstCatchDone = false;
  var pointerDownAt = null;
  var lastPointer = { x: 0, y: 0, has: false };
  var openStack = [];
  var hintTimer = null;

  var ui = {};

  /* ---------------------------------------------------------
     save / load
     --------------------------------------------------------- */
  function loadSave() {
    try {
      var raw = global.localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return;
      state.coins = Math.max(0, data.coins | 0);
      state.totalCaught = Math.max(0, data.totalCaught | 0);
      state.nextId = Math.max(1, data.nextId | 0);
      state.owned = (data.owned && typeof data.owned === 'object') ? data.owned : {};
      state.ducks = Array.isArray(data.ducks) ? data.ducks.filter(function (d) {
        return d && typeof d.variant === 'string';
      }).map(function (d) {
        return {
          id: d.id | 0,
          variant: d.variant,
          name: typeof d.name === 'string' ? d.name : 'Duck',
          pattern: (d.pattern && typeof d.pattern === 'object') ? d.pattern : null,
          equip: (d.equip && typeof d.equip === 'object') ? d.equip : {}
        };
      }) : [];
      // keep ids unique & sane
      var maxId = 0;
      state.ducks.forEach(function (d) {
        if (!d.id || d.id <= maxId) d.id = ++maxId;
        else maxId = d.id;
      });
      state.nextId = Math.max(state.nextId, maxId + 1);
    } catch (e) { /* corrupt or unavailable storage — start fresh */ }
  }

  var saveTimer = null;
  function save() {
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = null;
      try {
        global.localStorage.setItem(SAVE_KEY, JSON.stringify({
          v: 1,
          coins: state.coins,
          totalCaught: state.totalCaught,
          nextId: state.nextId,
          owned: state.owned,
          ducks: state.ducks
        }));
      } catch (e) { /* ignore */ }
    }, 180);
  }

  function wipeSave() {
    try { global.localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  }

  /* ---------------------------------------------------------
     HUD helpers
     --------------------------------------------------------- */
  function updateHUD(bump) {
    ui.coinCount.textContent = state.coins;
    ui.duckCount.textContent = state.ducks.length;
    if (ui.storeCoins) ui.storeCoins.textContent = state.coins;
    if (ui.ducksCoins) ui.ducksCoins.textContent = state.coins;
    if (bump) {
      var el = ui.coinCount.parentElement;
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }
    if (started && document.getElementById('storeModal').classList.contains('show')) refreshAffordability();
  }

  function toast(msg, kind) {
    var el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    ui.toasts.appendChild(el);
    while (ui.toasts.children.length > 3) ui.toasts.removeChild(ui.toasts.firstChild);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { el.remove(); }, 320);
    }, 1900);
  }

  function floatText(html, worldPos) {
    var v = worldPos.clone().project(World.camera);
    var el = document.createElement('div');
    el.className = 'float-coin';
    el.innerHTML = html;
    el.style.left = ((v.x * 0.5 + 0.5) * global.innerWidth).toFixed(1) + 'px';
    el.style.top = ((-v.y * 0.5 + 0.5) * global.innerHeight).toFixed(1) + 'px';
    ui.fx.appendChild(el);
    var anim = el.animate([
      { transform: 'translate(-50%,-50%) scale(.55)', opacity: 0 },
      { transform: 'translate(-50%,-120%) scale(1.18)', opacity: 1, offset: 0.22 },
      { transform: 'translate(-50%,-210%) scale(1.02)', opacity: 1, offset: 0.62 },
      { transform: 'translate(-50%,-300%) scale(.94)', opacity: 0 }
    ], { duration: 1350, easing: 'cubic-bezier(.2,.8,.3,1)' });
    anim.onfinish = function () { el.remove(); };
  }

  /* ---------------------------------------------------------
     wild ducks
     --------------------------------------------------------- */
  function takenNames() {
    return wild.map(function (d) { return d.name; })
      .concat(state.ducks.map(function (d) { return d.name; }));
  }

  /* ---------------------------------------------------------
     duck pricing — rare + golden ducks sell for double
     --------------------------------------------------------- */
  function duckVariant(d) {
    if (!d || !d.variant) return null;
    return typeof d.variant === 'string' ? K.variantById(d.variant) : d.variant;
  }

  function duckRarity(d) {
    var v = duckVariant(d);
    return v && v.rarity ? v.rarity : 'common';
  }

  function isRareDuck(d) {
    var r = duckRarity(d);
    return r === 'rare' || r === 'epic';
  }

  function duckPrice(d) {
    return isRareDuck(d) ? COINS_PER_DUCK * RARE_PRICE_MULT : COINS_PER_DUCK;
  }

  function spawnDuck(opts) {
    opts = opts || {};
    var variant;
    if (opts.variant) {
      variant = K.variantById(opts.variant);
    } else if (!goldenSpawnedThisSession && Math.random() < GOLDEN_CHANCE) {
      variant = K.variantById('gold');
      goldenSpawnedThisSession = true;
    } else {
      variant = K.randomVariant();
    }
    var equip = opts.equip || {};
    var pattern = K.resolvePattern(opts.pattern) ? opts.pattern : K.randomPattern();
    var group = K.buildDuck(variant, { equip: equip, pattern: pattern });
    group.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    if (opts.at) {
      group.position.set(opts.at.x, 0, opts.at.z);
    } else {
      var a = opts.angle == null ? Math.random() * Math.PI * 2 : opts.angle;
      var r = opts.r == null ? World.SWIM_R * (0.55 + Math.random() * 0.4) : opts.r;
      group.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
    var px = group.position.x, pz = group.position.z;
    var outward = Math.atan2(-px, -pz);
    var heading = outward + (Math.random() - 0.5) * 1.2;

    var d = {
      group: group,
      variant: variant,
      pattern: pattern,
      equip: equip,
      name: opts.name || K.randomName(takenNames()),
      angle: heading,
      speed: 0.72,
      targetSpeed: 0.9,
      turnRate: 1.9 + Math.random() * 1.5,
      state: 'arriving',
      fade: 0,
      animT: 0,
      rippleT: Math.random() * 0.6,
      startleCd: 0,
      wanderT: 0,
      flop: 0,
      flopCd: 0,
      phase: Math.random() * 10
    };
    group.rotation.y = d.angle;
    group.scale.setScalar(0.35);

    World.scene.add(group);
    wild.push(d);
    return d;
  }

  function removeDuck(d) {
    var i = wild.indexOf(d);
    if (i >= 0) wild.splice(i, 1);
    World.scene.remove(d.group);
    RL.disposeTree(d.group);
  }

  function turnTowards(cur, target, maxStep) {
    var diff = target - cur;
    diff = ((diff + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    if (Math.abs(diff) <= maxStep) return target;
    return cur + Math.sign(diff) * maxStep;
  }

  function updateWild(dt) {
    var netPos = World.net.group.position;

    for (var i = wild.length - 1; i >= 0; i--) {
      var d = wild[i];
      var pos = d.group.position;

      /* ---- caught: play the pop animation and finish ---- */
      if (d.state === 'caught') {
        d.animT += dt / 0.62;
        var p = Math.min(1, d.animT);
        var ease = 1 - Math.pow(1 - p, 3);
        pos.x += (d.caughtTo.x - pos.x) * Math.min(1, dt * 9);
        pos.z += (d.caughtTo.z - pos.z) * Math.min(1, dt * 9);
        pos.y = Math.sin(p * Math.PI) * 1.25 + p * 0.55;
        d.group.rotation.y += dt * 16;
        var sc = Math.max(0.001, 1 - Math.pow(p, 1.6));
        d.group.scale.setScalar(sc);
        if (p >= 1) {
          removeDuck(d);
          /* the duck is now sitting in the bucket */
          World.setBucketFill(state.ducks.length);
          World.bucketPop();
        }
        continue;
      }

      /* ---- arriving: grow in from the waterline ---- */
      if (d.state === 'arriving') {
        d.fade += dt / 0.55;
        if (d.fade >= 1) { d.fade = 1; d.state = 'swim'; }
        var f = Math.min(1, d.fade);
        d.group.scale.setScalar(0.35 + 0.65 * (f * f * (3 - 2 * f)));
      }

      var dx = pos.x - netPos.x;
      var dz = pos.z - netPos.z;
      var netDist = Math.sqrt(dx * dx + dz * dz);

      var netActive = !World.net.isScooping() ? 1 : 1.6;
      var fleeing = netDist < FLEE_RADIUS * netActive;

      if (d.startleCd > 0) d.startleCd -= dt;

      if (fleeing && d.state !== 'arriving') {
        d.state = 'flee';
        var away = Math.atan2(dx, dz);
        d.angle = turnTowards(d.angle, away, d.turnRate * 2.2 * dt);
        var urgency = 1 - Math.max(0, netDist) / (FLEE_RADIUS * netActive);
        d.targetSpeed = 3.2 + urgency * 1.8;
      } else if (d.state === 'flee') {
        d.state = 'swim';
        d.targetSpeed = 0.9;
      }

      /* ---- wander steering ---- */
      if (d.state === 'swim' || d.state === 'arriving') {
        d.wanderT -= dt;
        if (d.wanderT <= 0) {
          d.wanderT = 1.6 + Math.random() * 3.4;
          d.targetSpeed = 0.6 + Math.random() * 0.8;
          var toC = Math.atan2(-pos.x, -pos.z);
          if (Math.sqrt(pos.x * pos.x + pos.z * pos.z) > World.SWIM_R * 0.92) {
            d.angle = turnTowards(d.angle, toC + (Math.random() - 0.5) * 1.1, 3.4);
          } else {
            d.angle += (Math.random() - 0.5) * 1.5;
          }
        }
      }

      d.speed += (d.targetSpeed - d.speed) * Math.min(1, dt * 3.8);
      d.angle = turnTowards(d.angle, d.angle, 0); // no-op keeps structure clear

      var dirX = Math.sin(d.angle);
      var dirZ = Math.cos(d.angle);
      pos.x += dirX * d.speed * dt;
      pos.z += dirZ * d.speed * dt;

      /* ---- keep inside the pond ---- */
      var r = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
      if (r > World.SWIM_R) {
        var nX = pos.x / r, nZ = pos.z / r;
        pos.x = nX * World.SWIM_R;
        pos.z = nZ * World.SWIM_R;
        var tX = -nZ, tZ = nX;
        if (Math.cos(d.angle - Math.atan2(tX, tZ)) < 0) { tX = -tX; tZ = -tZ; }
        d.angle = turnTowards(d.angle, Math.atan2(tX, tZ), 2.6 * dt + 0.25);
        d.wanderT = Math.min(d.wanderT, 0.4);
      }
      pos.y = 0;

      if (d.flop > 0) d.flop = Math.max(0, d.flop - dt / FLOP_TIME);
      if (d.flopCd > 0) d.flopCd -= dt;

      d.group.rotation.y = d.angle;
      K.tickDuck(d.group, clock.elapsedTime + d.phase, dt, d.speed, d.flop);

      /* ---- wake ripples ---- */
      if (d.speed > 0.55) {
        d.rippleT -= dt;
        if (d.rippleT <= 0) {
          d.rippleT = 0.42 + Math.random() * 0.5;
          World.ripple(pos.x - dirX * 0.55, pos.z - dirZ * 0.55, {
            s0: 0.24, s1: 0.95, dur: 1.5, o0: 0.2
          });
        }
      }

      /* ducks stay quiet while they paddle — they only quack when caught */
    }

    /* ---- duck-vs-duck bumps: nudge apart, then flop the little wings ---- */
    for (var a = 0; a < wild.length; a++) {
      var da = wild[a];
      if (da.state === 'caught' || da.fade < 0.5) continue;
      for (var b = a + 1; b < wild.length; b++) {
        var db = wild[b];
        if (db.state === 'caught' || db.fade < 0.5) continue;

        var ax = da.group.position.x, az = da.group.position.z;
        var bx = db.group.position.x, bz = db.group.position.z;
        var ddx = bx - ax, ddz = bz - az;
        var dist2 = ddx * ddx + ddz * ddz;
        if (dist2 >= BUMP_DIST * BUMP_DIST || dist2 < 1e-6) continue;

        /* they're overlapping — push them apart evenly */
        var dist = Math.sqrt(dist2);
        var nx = ddx / dist, nz = ddz / dist;
        var push = (BUMP_DIST - dist) * 0.5;
        da.group.position.x -= nx * push; da.group.position.z -= nz * push;
        db.group.position.x += nx * push; db.group.position.z += nz * push;

        /* …and turn each gently away so they don't just re-collide */
        da.angle = turnTowards(da.angle, Math.atan2(-nx, -nz), 0.7);
        db.angle = turnTowards(db.angle, Math.atan2(nx, nz), 0.7);

        /* the bump startles them into a quick wing-flop */
        if (da.flopCd <= 0) { da.flop = 1; da.flopCd = 1.1; }
        if (db.flopCd <= 0) { db.flop = 1; db.flopCd = 1.1; }

        /* keep the nudge inside the pond */
        [da, db].forEach(function (d) {
          var rr = Math.sqrt(d.group.position.x * d.group.position.x + d.group.position.z * d.group.position.z);
          if (rr > World.SWIM_R) {
            d.group.position.x *= World.SWIM_R / rr;
            d.group.position.z *= World.SWIM_R / rr;
          }
        });

        World.ripple((ax + bx) * 0.5, (az + bz) * 0.5, { s0: 0.18, s1: 0.8, dur: 0.9, o0: 0.16 });
      }
    }

    /* ---- top up the flock: one newcomer drifts in about every minute ---- */
    for (var q = spawnQueue.length - 1; q >= 0; q--) {
      spawnQueue[q] -= dt;
      if (spawnQueue[q] <= 0) {
        spawnQueue.splice(q, 1);
        if (wild.length < WILD_TARGET) spawnDuck();
      }
    }
    if (spawnQueue.length === 0 && wild.length < WILD_TARGET) {
      spawnQueue.push(SPAWN_INTERVAL);
    }
  }

  /* ---------------------------------------------------------
     catching
     --------------------------------------------------------- */
  function handleDip(x, z) {
    var best = null, bestD = CATCH_RADIUS;
    for (var i = 0; i < wild.length; i++) {
      var d = wild[i];
      if (d.state === 'caught' || d.fade < 0.65) continue;
      var dx = d.group.position.x - x;
      var dz = d.group.position.z - z;
      var dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < bestD) { bestD = dist; best = d; }
    }

    if (best) {
      catchDuck(best, x, z);
    } else {
      var pan = World.panFor(x, z);
      Sound.splash(pan, false);
      World.ripple(x, z, { s0: 0.5, s1: 2.5, dur: 1.15, o0: 0.4 });
      World.dropBurst(x, 0.12, z, 12, 1.0, 1.1);
    }
  }

  function catchDuck(d, x, z) {
    if (d.state === 'caught') return;
    d.state = 'caught';
    d.animT = 0;
    d.caughtTo = World.bucketDrop().clone();   // fly toward the bucket

    var wx = d.group.position.x, wz = d.group.position.z;
    var pan = World.panFor(wx, wz);

    /* a soft splash and a little quack as the net comes up */
    Sound.catchDuck(pan);
    if (Sound.quack) Sound.quack(pan);

    World.sparkBurst(wx, 0.75, wz, 16);
    World.ripple(wx, wz, { s0: 0.35, s1: 2.0, dur: 0.95, o0: 0.45 });

    /* Caught ducks drop into the bucket. They are NOT worth coins on their
       own — you only earn coins by selling them to a visiting buyer. */
    state.totalCaught++;

    var entry = {
      id: state.nextId++,
      variant: d.variant.id,
      pattern: d.pattern,
      name: d.name,
      equip: JSON.parse(JSON.stringify(d.equip || {}))
    };
    state.ducks.push(entry);
    updateHUD(false);
    save();
    if (openStack.indexOf('ducksModal') >= 0) {
      renderDuckList();
      refreshDuckViews();
    }

    floatText('into the <em>bucket</em>!', new T.Vector3(wx, 0.9, wz));

    if (!firstCatchDone) {
      firstCatchDone = true;
      toast('Caught one! Sell ducks to visitors for ' + COINS_PER_DUCK + ' coins 🪙', 'gold');
    } else if (d.variant.rarity === 'rare' || d.variant.rarity === 'epic') {
      toast((d.variant.rarity === 'epic' ? '✨ EPIC' : '🌟 Rare') + ' — you caught ' + d.name + '!', 'gold');
    }

    if (ui.hint) ui.hint.classList.add('hide');
  }

  /* ---------------------------------------------------------
     scoop input
     --------------------------------------------------------- */
  function doScoop() {
    if (isModalOpen()) return;
    if (World.net.isScooping()) return;
    if (World.net.startScoop()) {
      Sound.scoop(World.panFor(World.net.group.position.x, World.net.group.position.z));
    }
  }

  function updateNetTarget(clientX, clientY) {
    var nx = (clientX / global.innerWidth) * 2 - 1;
    var ny = -((clientY / global.innerHeight) * 2 - 1);
    var p = World.pointerToPond(nx, ny);
    var r = Math.sqrt(p.x * p.x + p.z * p.z);
    var maxR = World.POND_R - 0.55;
    if (r > maxR) { p.x = p.x / r * maxR; p.z = p.z / r * maxR; }
    World.net.setTarget(p.x, p.z);
    lastPointer.x = clientX;
    lastPointer.y = clientY;
    lastPointer.has = true;
  }

  /* ---------------------------------------------------------
     modals
     --------------------------------------------------------- */
  function isModalOpen() { return openStack.length > 0; }

  function openModal(id) {
    var el = document.getElementById(id);
    if (!el || el.classList.contains('show')) return;
    el.classList.add('show');
    el.setAttribute('aria-hidden', 'false');
    openStack.push(id);
    document.body.classList.add('modal-open');
    Sound.open();

    if (id === 'storeModal') { renderStore(); }
    if (id === 'ducksModal') {
      if (selectedId == null && state.ducks.length) selectedId = state.ducks[state.ducks.length - 1].id;
      renderDuckList();
      refreshDuckViews();
      requestAnimationFrame(function () {
        Preview.resize();
        Preview.snap();
      });
    }
    if (ui.hint) ui.hint.classList.add('hide');
  }

  function closeModal(id) {
    var el = document.getElementById(id);
    if (!el || !el.classList.contains('show')) return;
    el.classList.remove('show');
    el.setAttribute('aria-hidden', 'true');
    var i = openStack.indexOf(id);
    if (i >= 0) openStack.splice(i, 1);
    if (!openStack.length) document.body.classList.remove('modal-open');
    Sound.close();
  }

  function closeTopModal() {
    if (openStack.length) closeModal(openStack[openStack.length - 1]);
  }

  /* ---------------------------------------------------------
     store
     --------------------------------------------------------- */
  /* --- lazy store thumbnails: with a deep catalogue we only render
         an item's 3D preview once its card scrolls near the view --- */
  var thumbObserver = null;
  function ensureThumbObserver() {
    if (thumbObserver || typeof IntersectionObserver === 'undefined') return thumbObserver;
    thumbObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        thumbObserver.unobserve(en.target);
        fillThumb(en.target);
      });
    }, { root: null, rootMargin: '400px 0px' });
    return thumbObserver;
  }
  function fillThumb(card) {
    var it = card.__item;
    if (!it) return;
    var thumb = card.querySelector('.thumb');
    if (!thumb) return;
    var url = null;
    try { url = RL.itemThumb(it); } catch (e) { url = null; }
    thumb.innerHTML = '';
    if (url) {
      var img = document.createElement('img');
      img.src = url;
      img.alt = it.name;
      img.loading = 'lazy';
      thumb.appendChild(img);
    } else {
      var ph = document.createElement('span');
      ph.className = 'ph';
      ph.textContent = it.emoji;
      thumb.appendChild(ph);
    }
  }

  function renderStore() {
    ui.storeCoins.textContent = state.coins;
    ui.storeTabs.innerHTML = '';
    K.CATEGORIES.forEach(function (cat) {
      var b = document.createElement('button');
      b.className = 'tab' + (storeTab === cat.id ? ' active' : '');
      b.innerHTML = cat.emoji + ' ' + cat.name;
      b.onclick = function () {
        storeTab = cat.id;
        Sound.ui();
        renderStore();
      };
      ui.storeTabs.appendChild(b);
    });

    ui.storeGrid.innerHTML = '';
    var cards = [];
    K.CATALOG.filter(function (it) {
      return storeTab === 'all' || it.cat === storeTab;
    }).forEach(function (it) {
      var card = storeCard(it);
      cards.push(card);
      ui.storeGrid.appendChild(card);
    });

    /* render the first screenful now, lazy-load the rest as they scroll in */
    if (thumbObserver) thumbObserver.disconnect();
    var ob = ensureThumbObserver();
    cards.forEach(function (c, i) {
      if (ob && i > 11) ob.observe(c);
      else fillThumb(c);
    });

    var ownedCount = Object.keys(state.owned).length;
    ui.storeFoot.textContent = ownedCount + ' of ' + K.CATALOG.length +
      ' items owned · sell ducks to visitors for ' + COINS_PER_DUCK + ' coins 🪙';
  }

  function storeCard(it) {
    var owned = !!state.owned[it.id];
    var afford = state.coins >= it.price;

    var card = document.createElement('div');
    card.className = 'item' + (!owned && !afford ? ' unaffordable' : '');
    card.dataset.itemId = it.id;

    var thumb = document.createElement('div');
    thumb.className = 'thumb';
    var ph = document.createElement('span');
    ph.className = 'ph';
    ph.textContent = it.emoji;
    thumb.appendChild(ph);
    card.appendChild(thumb);
    card.__item = it;

    if (it.rarity && it.rarity !== 'common') {
      var rib = document.createElement('span');
      rib.className = 'ribbon ' + (it.rarity === 'epic' ? 'epic' : 'rare');
      rib.textContent = it.rarity === 'epic' ? 'epic' : 'rare';
      card.appendChild(rib);
    }

    var meta = document.createElement('div');
    meta.className = 'meta';
    var nm = document.createElement('div');
    nm.className = 'name';
    nm.textContent = it.name;
    meta.appendChild(nm);
    card.appendChild(meta);

    var desc = document.createElement('div');
    desc.className = 'desc';
    desc.textContent = it.desc || '';
    card.appendChild(desc);

    var price = document.createElement('div');
    price.className = 'price';
    price.textContent = '🪙 ' + it.price;
    card.appendChild(price);

    var btn = document.createElement('button');
    btn.className = 'buy';
    if (owned) {
      btn.classList.add('owned');
      btn.textContent = '✓ Owned';
      btn.disabled = true;
    } else if (!afford) {
      btn.textContent = 'Need ' + (it.price - state.coins) + ' more';
      btn.disabled = true;
    } else {
      btn.textContent = 'Buy';
      btn.onclick = function () { buyItem(it); };
    }
    card.appendChild(btn);
    return card;
  }

  function refreshAffordability() {
    if (!ui.storeGrid) return;
    ui.storeCoins.textContent = state.coins;
    Array.prototype.forEach.call(ui.storeGrid.querySelectorAll('.item'), function (card) {
      var it = K.itemById(card.dataset.itemId);
      if (!it) return;
      var owned = !!state.owned[it.id];
      var afford = state.coins >= it.price;
      card.classList.toggle('unaffordable', !owned && !afford);
      var btn = card.querySelector('.buy');
      if (!btn || owned) return;
      if (afford) {
        btn.disabled = false;
        btn.textContent = 'Buy';
        btn.onclick = function () { buyItem(it); };
      } else {
        btn.disabled = true;
        btn.textContent = 'Need ' + (it.price - state.coins) + ' more';
      }
    });
  }

  function buyItem(it) {
    if (state.owned[it.id]) { Sound.deny(); return; }
    if (state.coins < it.price) { Sound.deny(); toast('Not enough coins — sell a duck to a visitor!', 'warn'); return; }
    state.coins -= it.price;
    state.owned[it.id] = true;
    save();
    Sound.buy();
    updateHUD(false);
    toast('Bought ' + it.name + ' ' + (it.emoji || ''), 'good');
    renderStore();
  }

  /* ---------------------------------------------------------
     my ducks / wardrobe
     --------------------------------------------------------- */
  function selectedDuck() {
    for (var i = 0; i < state.ducks.length; i++) {
      if (state.ducks[i].id === selectedId) return state.ducks[i];
    }
    return null;
  }

  function renderDuckList() {
    ui.duckList.innerHTML = '';
    if (!state.ducks.length) {
      var empty = document.createElement('div');
      empty.className = 'duck-empty';
      empty.innerHTML = '<span class="big">🦆</span>No ducks yet.<br>Head to the pond and scoop some up!';
      ui.duckList.appendChild(empty);
      return;
    }
    state.ducks.slice().reverse().forEach(function (d) {
      var part = duckVariant(d);
      var rare = isRareDuck(d);
      var card = document.createElement('button');
      card.className = 'duck-card' + (d.id === selectedId ? ' active' : '') +
        (rare ? ' rare' : '') + (part && part.shine ? ' golden' : '');
      card.dataset.duckId = d.id;

      var pfp = document.createElement('div');
      pfp.className = 'pfp';
      var url = null;
      try { url = RL.duckThumb(d.variant, d.equip, { view: 'face', pattern: d.pattern }); } catch (e) { url = null; }
      if (url) {
        var img = document.createElement('img');
        img.src = url;
        img.alt = d.name;
        pfp.appendChild(img);
      } else {
        var ph = document.createElement('span');
        ph.className = 'ph';
        ph.textContent = '🦆';
        pfp.appendChild(ph);
      }
      card.appendChild(pfp);

      var info = document.createElement('div');
      info.className = 'info';
      var b = document.createElement('b');
      b.textContent = d.name;
      var small = document.createElement('small');
      var n = Object.keys(d.equip || {}).length;
      small.textContent = K.variantById(d.variant).name + ' · ' + K.patternName(d.pattern) +
        (n ? ' · ' + n + ' worn' : '');
      info.appendChild(b);
      info.appendChild(small);
      card.appendChild(info);

      var price = document.createElement('span');
      price.className = 'duck-price' + (rare ? ' rare' : '');
      price.textContent = (rare ? '💎' : '🪙') + duckPrice(d);
      price.title = rare ? 'Rare duck — sells for double!' : 'Sell price';
      card.appendChild(price);

      card.onclick = function () {
        selectedId = d.id;
        Sound.ui();
        renderDuckList();
        refreshDuckViews();
      };
      ui.duckList.appendChild(card);
    });
  }

  function renderSlots() {
    var d = selectedDuck();
    ui.slotRow.innerHTML = '';
    var order = ['head', 'face', 'neck', 'back', 'held'];
    order.forEach(function (slot) {
      var info = K.SLOT_INFO[slot];
      var itemId = d && d.equip ? d.equip[slot] : null;
      var it = itemId ? K.itemById(itemId) : null;
      var el = document.createElement('div');
      el.className = 'slot' + (it ? ' filled' : '');
      var ic = document.createElement('span');
      ic.className = 's-ico';
      ic.textContent = it ? (it.emoji || '✨') : info.emoji;
      var val = document.createElement('span');
      val.className = 's-val';
      val.textContent = it ? it.name : info.name;
      el.appendChild(ic);
      el.appendChild(val);
      el.title = info.name;
      ui.slotRow.appendChild(el);
    });
  }

  function renderWardrobe() {
    var d = selectedDuck();
    var owned = K.CATALOG.filter(function (it) { return state.owned[it.id]; });
    ui.ownedCount.textContent = '(' + owned.length + '/' + K.CATALOG.length + ')';
    ui.ownedGrid.innerHTML = '';

    if (!owned.length) {
      var empty = document.createElement('div');
      empty.className = 'owned-empty';
      empty.innerHTML = 'Your wardrobe is empty.<br>Visit the 🛍️ Store to buy cute outfits!';
      ui.ownedGrid.appendChild(empty);
      return;
    }

    owned.forEach(function (it) {
      var on = !!(d && d.equip && d.equip[it.cat] === it.id);
      var b = document.createElement('button');
      b.className = 'witem' + (on ? ' on' : '');
      b.title = it.name + ' (' + K.SLOT_INFO[it.cat].name + ')';
      b.disabled = !d;

      var url = null;
      try { url = RL.itemThumb(it); } catch (e) { url = null; }
      if (url) {
        var img = document.createElement('img');
        img.src = url;
        img.alt = it.name;
        b.appendChild(img);
      } else {
        var ph = document.createElement('div');
        ph.className = 'ph';
        ph.textContent = it.emoji || '✨';
        b.appendChild(ph);
      }
      var sp = document.createElement('span');
      sp.textContent = it.name;
      b.appendChild(sp);

      b.onclick = function () { toggleEquip(it); };
      ui.ownedGrid.appendChild(b);
    });
  }

  function toggleEquip(it) {
    var d = selectedDuck();
    if (!d) return;
    if (!d.equip) d.equip = {};
    if (d.equip[it.cat] === it.id) {
      delete d.equip[it.cat];
      Sound.unequip();
    } else {
      d.equip[it.cat] = it.id;
      Sound.equip();
    }
    save();
    RL.clearThumbCache('duck|');
    renderDuckList();
    refreshDuckViews();
  }

  function refreshDuckViews() {
    var d = selectedDuck();
    var has = !!d;
    ui.previewEmpty.classList.toggle('hide', has);
    ui.dressName.textContent = has ? (d.name + ' · ' + K.patternName(d.pattern)) : '—';
    ui.releaseDuck.disabled = !has;
    updateSellButton();
    renderSlots();
    renderWardrobe();
    if (has) {
      Preview.resize();
      Preview.show(d.variant, d.equip, d.pattern);
    } else {
      Preview.clear();
    }
    ui.ducksCoins.textContent = state.coins;
  }

  /** Show/hide the "sell the selected duck" button based on whether a buyer is waiting. */
  function updateSellButton() {
    if (!ui.sellDuck) return;
    var d = selectedDuck();
    var open = World.buyerReady();
    var show = !!(d && open);
    ui.sellDuck.hidden = !show;
    ui.sellDuck.disabled = !show;
    if (d) ui.sellDuck.textContent = 'Sell to visitor · ' + duckPrice(d) + ' 🪙';
  }

  function releaseDuck() {
    var d = selectedDuck();
    if (!d) return;
    var idx = state.ducks.indexOf(d);
    if (idx >= 0) state.ducks.splice(idx, 1);
    spawnDuck({ variant: d.variant, equip: d.equip, pattern: d.pattern, name: d.name });
    selectedId = state.ducks.length ? state.ducks[state.ducks.length - 1].id : null;
    save();
    RL.clearThumbCache('duck|');
    World.setBucketFill(state.ducks.length);
    Sound.open();
    toast(d.name + ' is back in the pond! 🌊', 'good');
    updateHUD(false);
    renderDuckList();
    refreshDuckViews();
  }

  /* ---------------------------------------------------------
     visitors & selling — the ONLY way to earn coins
     --------------------------------------------------------- */
  var buyerTimer = 15;
  var buyerWants = 1;
  var buyerBought = 0;

  function nextBuyerDelay() { return 28 + Math.random() * 24; }

  /** Which duck a sale takes: the one selected, else the newest in the bucket. */
  function pickDuckToSell() {
    var d = selectedDuck();
    if (d) return d;
    return state.ducks.length ? state.ducks[state.ducks.length - 1] : null;
  }

  function buyerLine() {
    var left = Math.max(0, buyerWants - buyerBought);
    if (!state.ducks.length) return 'Any ducks for sale today?';
    if (buyerBought === 0) {
      return 'What a lovely pond! I would like ' + buyerWants + ' duck' + (buyerWants > 1 ? 's' : '') + '.';
    }
    return 'Wonderful! ' + left + ' more, please.';
  }

  function sellDuck(duck) {
    if (!World.buyerReady()) { Sound.deny(); return; }
    var d = duck || pickDuckToSell();
    if (!d) {
      Sound.deny();
      toast('You have no ducks to sell — scoop one up first!', 'warn');
      return;
    }

    var idx = state.ducks.indexOf(d);
    if (idx >= 0) state.ducks.splice(idx, 1);
    var price = duckPrice(d);
    state.coins += price;
    buyerBought++;

    var hp = World.buyerHeadPos();
    Sound.sell(World.panFor(hp.x, hp.z));
    floatText('+' + price + ' <em>coins</em>', hp);

    World.setBucketFill(state.ducks.length);
    World.bucketPop();

    if (selectedId === d.id) {
      selectedId = state.ducks.length ? state.ducks[state.ducks.length - 1].id : null;
    }
    updateHUD(true);
    save();
    RL.clearThumbCache('duck|');
    if (openStack.indexOf('ducksModal') >= 0) {
      renderDuckList();
      refreshDuckViews();
    } else {
      updateSellButton();
    }

    toast('Sold ' + d.name + ' for ' + price + ' coins 🪙' +
      (isRareDuck(d) ? ' — a rare beauty! 💎' : ''), 'good');

    if (buyerBought >= buyerWants) {
      toast('The visitor is happy — thank you! 😊', 'good');
      World.dismissBuyer();
    }
  }

  /** Position the visitor's speech bubble above their head each frame. */
  function updateBuyerBubble() {
    if (!ui.buyerPrompt) return;
    var show = started && World.buyerReady() && !isModalOpen();
    ui.buyerPrompt.classList.toggle('hide', !show);
    ui.buyerPrompt.setAttribute('aria-hidden', show ? 'false' : 'true');
    if (!show) return;

    var v = World.buyerHeadPos().project(World.camera);
    var x = (v.x * 0.5 + 0.5) * global.innerWidth;
    var y = (-v.y * 0.5 + 0.5) * global.innerHeight;
    x = Math.max(130, Math.min(global.innerWidth - 130, x));
    y = Math.max(110, Math.min(global.innerHeight - 150, y));
    ui.buyerPrompt.style.left = x.toFixed(1) + 'px';
    ui.buyerPrompt.style.top = y.toFixed(1) + 'px';

    var target = pickDuckToSell();
    var has = !!target;
    ui.buyerText.textContent = buyerLine();
    ui.sellBtn.disabled = !has;
    ui.sellBtn.textContent = has
      ? ('Sell for ' + duckPrice(target) + ' 🪙' + (isRareDuck(target) ? ' 💎' : ''))
      : 'No ducks yet';
  }

  function updateMarket(dt) {
    if (World.buyerState() === 'away') {
      buyerTimer -= dt;
      if (buyerTimer <= 0) {
        buyerTimer = World.callBuyer() ? 1e9 : 5;
      }
    }
    updateBuyerBubble();
  }

  /* ---------------------------------------------------------
     boot
     --------------------------------------------------------- */
  function cacheUI() {
    ui.coinCount = document.getElementById('coinCount');
    ui.duckCount = document.getElementById('duckCount');
    ui.storeCoins = document.getElementById('storeCoins');
    ui.ducksCoins = document.getElementById('ducksCoins');
    ui.storeTabs = document.getElementById('storeTabs');
    ui.storeGrid = document.getElementById('storeGrid');
    ui.storeFoot = document.getElementById('storeFoot');
    ui.duckList = document.getElementById('duckList');
    ui.previewEmpty = document.getElementById('previewEmpty');
    ui.slotRow = document.getElementById('slotRow');
    ui.ownedGrid = document.getElementById('ownedGrid');
    ui.ownedCount = document.getElementById('ownedCount');
    ui.dressName = document.getElementById('dressName');
    ui.releaseDuck = document.getElementById('releaseDuck');
    ui.previewCanvas = document.getElementById('previewCanvas');
    ui.fx = document.getElementById('fx');
    ui.toasts = document.getElementById('toasts');
    ui.hint = document.getElementById('hint');
    ui.sellDuck = document.getElementById('sellDuck');
    ui.buyerPrompt = document.getElementById('buyerPrompt');
    ui.buyerText = document.getElementById('buyerText');
    ui.sellBtn = document.getElementById('sellBtn');
  }

  function wireUI() {
    document.getElementById('openStore').onclick = function () { openModal('storeModal'); };
    document.getElementById('openDucks').onclick = function () { openModal('ducksModal'); };
    document.getElementById('openHelp').onclick = function () { openModal('helpModal'); };
    document.getElementById('scoopBtn').onclick = function () { doScoop(); };
    ui.releaseDuck.onclick = function () { releaseDuck(); };
    if (ui.sellDuck) ui.sellDuck.onclick = function () { sellDuck(selectedDuck()); };
    if (ui.sellBtn) ui.sellBtn.onclick = function () { sellDuck(pickDuckToSell()); };

    Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) {
      b.onclick = function () { closeModal(b.dataset.close); };
    });
    Array.prototype.forEach.call(document.querySelectorAll('.modal'), function (m) {
      m.addEventListener('pointerdown', function (e) {
        if (e.target === m) closeModal(m.id);
      });
    });

    var soundBtn = document.getElementById('toggleSound');
    soundBtn.onclick = function () {
      var on = !Sound.enabled;
      Sound.setEnabled(on);
      soundBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      soundBtn.textContent = on ? '🔊' : '🔇';
      if (on) Sound.startMusic();
    };

    document.getElementById('playBtn').onclick = function () {
      var fresh = document.getElementById('freshStart').checked;
      if (fresh) {
        wipeSave();
        state.coins = 0; state.totalCaught = 0; state.owned = {}; state.ducks = []; state.nextId = 1;
        selectedId = null;
        updateHUD(false);
      }
      document.getElementById('startScreen').classList.remove('show');
      Sound.init().then(function () {
        Sound.startMusic();
      });
      started = true;
      buyerTimer = 12;
      World.setBucketFill(state.ducks.length);
      if (ui.hint) {
        ui.hint.classList.remove('hide');
        clearTimeout(hintTimer);
        hintTimer = setTimeout(function () { ui.hint.classList.add('hide'); }, 9000);
      }
    };

    /* keyboard */
    global.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeTopModal(); return; }
      if (!started) return;
      var k = e.key.toLowerCase();
      if (k === ' ' || e.code === 'Space') {
        if (isModalOpen()) return;
        e.preventDefault();
        doScoop();
      } else if (k === 'b') {
        openStack.indexOf('storeModal') >= 0 ? closeModal('storeModal') : openModal('storeModal');
      } else if (k === 'd') {
        openStack.indexOf('ducksModal') >= 0 ? closeModal('ducksModal') : openModal('ducksModal');
      } else if (k === 'm') {
        document.getElementById('toggleSound').click();
      }
    });

    /* pointer */
    var canvas = renderer.domElement;
    canvas.addEventListener('pointerdown', function (e) {
      if (isModalOpen()) return;
      pointerDownAt = { x: e.clientX, y: e.clientY };
      updateNetTarget(e.clientX, e.clientY);
    });
    canvas.addEventListener('pointerup', function (e) {
      if (isModalOpen()) { pointerDownAt = null; return; }
      if (pointerDownAt) {
        var moved = Math.hypot(e.clientX - pointerDownAt.x, e.clientY - pointerDownAt.y);
        if (moved < 12) doScoop();
      }
      pointerDownAt = null;
    });
    canvas.addEventListener('pointercancel', function () { pointerDownAt = null; });

    global.addEventListener('pointermove', function (e) {
      if (isModalOpen()) return;
      updateNetTarget(e.clientX, e.clientY);
    });

    global.addEventListener('resize', onResize);
    global.addEventListener('beforeunload', function () { save(); });
  }

  function onResize() {
    var w = global.innerWidth, h = global.innerHeight;
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    World.resize(w, h);
    if (openStack.indexOf('ducksModal') >= 0) Preview.resize();
  }

  function boot() {
    cacheUI();

    /* touch devices get an explicit Scoop button */
    if (global.matchMedia && global.matchMedia('(pointer: coarse)').matches) {
      document.body.classList.add('touch');
    }

    loadSave();

    var canvas = document.getElementById('scene');
    renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    renderer.setSize(global.innerWidth, global.innerHeight, false);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;

    RL.initEnv(renderer);

    World.init(renderer);
    World.resize(global.innerWidth, global.innerHeight);
    World.net.onDip = handleDip;
    if (global.RL && global.RL.getEnv()) {
      World.scene.environment = global.RL.getEnv();
    }

    /* --- the nest: eggs crack, ducklings waddle in, and become wild ducks --- */
    World.onNestCrack = function () { /* deliberately silent — no quacking in this pond */ };
    World.onHatch = function (variantId, pattern) {
      var wp = World.nestWaterPos();
      var d = spawnDuck({ variant: variantId, pattern: pattern, at: { x: wp.x, z: wp.z } });
      d.state = 'arriving';
      d.fade = 0.5;
      d.group.scale.setScalar(0.5);
      Sound.splash(World.panFor(wp.x, wp.z), false);   // a soft water plop
    };

    /* --- visitors: the only source of coins --- */
    World.onBuyerReady = function () {
      buyerWants = 1 + Math.floor(Math.random() * 3);
      buyerBought = 0;
      toast('🧺 A visitor wants ' + buyerWants + ' duck' + (buyerWants > 1 ? 's' : '') + '!', 'good');
      updateSellButton();
      if (openStack.indexOf('ducksModal') >= 0) refreshDuckViews();
    };
    World.onBuyerLeft = function () {
      buyerTimer = nextBuyerDelay();
      updateSellButton();
      if (openStack.indexOf('ducksModal') >= 0) refreshDuckViews();
    };
    World.onBuyerImpatient = function () {
      toast('The visitor got tired of waiting and wandered off…', 'warn');
    };

    World.setBucketFill(state.ducks.length);

    Preview.init(ui.previewCanvas);

    /* populate the pond */
    for (var i = 0; i < WILD_TARGET; i++) {
      var d = spawnDuck();
      d.state = 'swim';
      d.fade = 1;
      d.group.scale.setScalar(1);
    }

    updateHUD(false);
    wireUI();

    clock = new T.Clock();
    loop();
  }

  function loop() {
    global.requestAnimationFrame(loop);
    var dt = Math.min(0.05, clock.getDelta());
    World.update(dt);
    if (started) {
      updateWild(dt);
      updateMarket(dt);
    }
    renderer.render(World.scene, World.camera);
    if (openStack.indexOf('ducksModal') >= 0) Preview.tick(dt);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.Game = {
    state: state,
    spawnDuck: spawnDuck,
    sellDuck: sellDuck,
    pickDuckToSell: pickDuckToSell,
    COINS_PER_DUCK: COINS_PER_DUCK,
    duckPrice: duckPrice,
    isRareDuck: isRareDuck,
    get renderer() { return renderer; },
    get wild() { return wild; },
    get world() { return World; }
  };
})(window);
