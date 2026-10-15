# 🦆 Mini Duck Pond Game — Catch & Dress

*GitHub repository: **Simple Duck Pond Game***

A little 3D duck-catching game. Scoop cute ducks into your bucket with a net, **sell them to
the visitors** who wander up to the pond for **6 coins each**, then spend those coins in the
store on hats, glasses, scarves and toys to dress your ducks up.

Built with [Three.js](https://threejs.org/) (vendored locally), plain classic `<script>` tags,
and a hand-written GLSL water shader. **No build step, no server, no network.**

---

## ▶️ How to play

Just **open `index.html`** in a modern browser (Chrome, Edge or Firefox). That's it — it works
straight from `file://`.

If you'd prefer to serve it (e.g. for Safari), any static server works:

```bash
npx serve .          # or:  python -m http.server
```

### Controls

| Input | Action |
|---|---|
| **Move mouse / drag** | Move the net |
| **Click** or **Space** | Scoop the net into the water |
| **Scoop button** | Appears on touch devices |
| **B** | Toggle the store |
| **D** | Toggle My Ducks (dress-up) |
| **M** | Mute / unmute |
| **Esc** | Close a panel |
| **Drag the duck** | Spin it around in the dress-up viewer |

### The loop

1. Ducks paddle around the pond and **flee** when your net gets close — they're quick, so you
   have to corner them. Bump into each other and they politely nudge apart with a startled little
   wing-flop. The flock tops itself back up with a new duck about **once a minute**.
2. Dip the net and you'll scoop the nearest duck inside the hoop. It tumbles straight into your
   **🪣 bucket**.
3. **Catching does not pay on its own.** Coins come only from **selling**.
4. Every so often a **visitor** wanders up to the pond. A bubble appears above their head with a
   **Sell** button — an ordinary duck earns **6 coins** 🪙, while **rare** ducks and the **golden**
   duck pay **double (12 coins)**. (You can also sell the duck you have selected from inside
   🐣 *My Ducks*.)
5. Spend coins in the 🛍️ **Store**, then dress your ducks in 🐣 **My Ducks**.
6. Watch the **🥚 nest** by the pond: the eggs wobble, crack open, and the ducklings waddle
   straight into the water — then you can catch them like any other duck.
7. Want a duck back in the pond? Hit **Release** — it swims off wearing whatever you put on it.

Every duck also wears its own **coat pattern** — polka dots, stripes, waves, checker, hearts,
stars, speckles or a glowing **radiant** gradient, in a whole range of colour palettes.

Ducks come in a range of **rarities** — common, uncommon, **rare** and **epic**. Rare and epic
ducks are worth **double at market (12 coins)**, and the one-of-a-kind ✨ **golden** duck
*shines*: it glows with a warm halo, a soft golden light and twinkling sparks, so you can spot it
from across the pond. Only **one golden duck appears per game**.

Your coins, purchases and duck collection are saved automatically to `localStorage`
(key `duckpond.save.v1`). Tick **"Start fresh"** on the title screen to wipe the save.

---

## 🔊 Sound

The pond is **calm**: a gentle, looping piano soundtrack (Satie's *Gymnopédie No. 1* and the
*Aria* from Bach's *Goldberg Variations*, both CC0) plus soft water splashes. The wild ducks stay
**quiet** as they paddle — no pond chatter — but every time you **scoop a duck into the bucket**
you hear a quick quack, with the music still playing underneath.

Everything is a **real recording sourced from the internet**, trimmed, normalised and encoded by
`tools/build-audio.js`, then embedded as base64 data URIs so there is no fetch, no CORS, and no
network dependency.

Full provenance and licences: **[`audio/CREDITS.md`](audio/CREDITS.md)**.

Three.js, the UI blips and all music fallbacks are synthesised in `js/audio.js` if a sample
can't be decoded, so the game is never silent.

---

## 📁 Project layout

```
index.html               page skeleton, HUD, modals, script order
css/style.css            all the pastel/rounded UI styling
vendor/three.min.js      Three.js r159 (UMD, vendored so it runs offline)

js/sounds-data.js        AUTO-GENERATED base64 audio bundle (~600 KB, 11 clips)
js/audio.js              WebAudio engine: music player + real samples + synth fallback
js/items.js              DuckKit: duck bodies, coat patterns, ~300 accessories, catalog
js/renderer-utils.js     env lighting, offscreen 3D thumbnail renderer, disposal
js/preview.js            the little 3D duck viewer in the dress-up panel
js/world.js              pond: water shader, shore, flora, sky, net, bucket, nest, people
js/game.js               state, duck AI, catching, selling, store, wardrobe, UI wiring

audio/*.mp3              the encoded clips (the game actually uses sounds-data.js)
audio/_src/*.ogg         the untouched source recordings for the build script
audio/CREDITS.md         sound attribution + licences

tools/build-audio.js     rebuilds audio/*.mp3 and js/sounds-data.js from audio/_src
tools/analyze.js         WAV loudness/segment analyser (used to pick good excerpts)
tools/grid.js            renders a coarse colour map of an image (headless render checks)
```

---

## 🛠️ Rebuilding the audio

The generated bundle is committed, so you only need this if you change the sounds.

```bash
# needs ffmpeg on PATH (or set FFMPEG=/path/to/ffmpeg)
node tools/build-audio.js
```

This rewrites `audio/*.mp3` and `js/sounds-data.js` from the sources in `audio/_src/`.

---

## 🔧 Technical notes

- **No ES modules** — everything assigns to `window` from classic `<script>` tags, which is
  what makes `file://` work.
- **Water** is a custom `ShaderMaterial`: four summed sine waves for the surface height plus
  analytic normals, fresnel sky reflection, two specular lobes (broad + tight sparkle) and a
  foam ring at the waterline. It includes `<tonemapping_fragment>` / `<colorspace_fragment>`
  so it matches the tone-mapped scene.
- **Scenery batching** — hundreds of trees, reeds, rocks, grass tufts, flowers and lily pads are
  merged by side/shadow flags into a handful of vertex-coloured meshes, so the whole pond (plus the
  bucket, nest and bystanders) stays at roughly **250 draw calls at well over 100 fps**.
- **Store catalogue** — instead of hand-authoring every item, the shop is assembled from a small
  kit of parametric builders (`fam()` + options) plus palettes, yielding **~300 items across five
  slots** (hats, face, neck, back, toys). Spectacles are real frames — an extruded ring with a lens,
  bridge and tube geometry temple arms that hug the head — in round, square, cat-eye, aviator, hex,
  shield, heart, star, rimless and monocle shapes. With a catalogue that deep, the store renders an
  item's 3D thumbnail **lazily** via an `IntersectionObserver`, falling back to a big emoji tile
  until the card scrolls into view.
- **Thumbnails** — store items and duck portraits are rendered to real 3D images by an
  offscreen renderer with `preserveDrawingBuffer`, then cached as data URLs.
- **Duck convention** — ducks face `+Z`, accessories snap to named anchors
  (`head`, `face`, `neck`, `back`, `held`) with one item per slot.
- **Coat patterns** — each duck gets a `{ p, c }` pattern (design + palette). The pattern is
  painted into a cached `CanvasTexture` and applied to the body, head, tail and wings; the
  `radiant` design also drives a matching emissive glow.
- **Bucket & nest** — caught ducks animate toward the bucket and light up a matching mini-duck
  inside it. The nest runs a small state machine (`wait → wobble → crack → waddle → refill`) and
  reports each hatch through an `onHatch` callback, which spawns the duckling into the pond.
  Hatched ducklings perch *in* the basket of twigs (the bowl rim is 0.24 high, and a duckling
  sits 0.20 above the floor so it nestles among the eggs rather than sinking into the bowl), then
  waddle down the bank following `shoreY()` into open water.
- **Flock & difficulty** — the pond starts with 40 wild ducks and tops back up with **one newcomer
  about every minute** (`SPAWN_INTERVAL`). Ducks are deliberately lively — they cruise at
  ~0.6–1.4 and bolt at ~3.2–5.0 when the net gets near — so herding them into the hoop takes a
  little patience.
- **Visitors** — the buyer NPC walks in on a timer, waits (impatiently) and pays 6 coins per
  duck (12 for rare/epic and golden ducks). Selling is the only way to earn coins; catching just
  fills the bucket.
- **Duck collisions** — ducks keep a minimum body spacing from one another. Each frame a cheap
  O(n²) pass over the (small) flock separates overlapping pairs, steers both gently apart and
  sets a `flop` value that drives a fast, fading wing-beat and a little bob, so bumping reads
  as a startled flutter rather than the ducks passing through each other.
- **Rarity & pricing** — every duck variant carries a `rarity` (`common`/`uncommon`/`rare`/`epic`).
  Sell price is derived from it (`duckPrice()`): rare and epic (including the golden duck) pay
  `COINS_PER_DUCK × 2`. The golden variant (`shine: true`) spawns once per session
  (`GOLDEN_CHANCE`) and is built with a self-lit emissive coat plus a shine rig — an additive halo
  sprite, a warm `PointLight` and seven orbiting sparkles — animated in `DuckKit.tickDuck()`.
- **Audio** — a gentle music bed loops with a short crossfade between two CC0 piano tracks. All
  effects are real recordings; the wild flock stays silent so the pond feels calm, and a single
  quack plays the moment a duck is scooped into the bucket.
- Three.js r159's UMD build prints a deprecation warning about `build/three.min.js` being
  removed in r160. That warning is expected and harmless.

---

## 📜 Credits

Sound recordings: see [`audio/CREDITS.md`](audio/CREDITS.md).
Three.js is © three.js authors, MIT licensed.
