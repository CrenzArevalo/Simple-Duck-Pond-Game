# Audio Credits & Licensing

Every sound in this game is a **real recording** sourced from the internet — nothing
is faked with synthesis. The clips are trimmed, normalised and encoded to mono MP3 by
`tools/build-audio.js`, then embedded as base64 data URIs in `js/sounds-data.js` so the
game has no network dependency and no CORS problems when opened from `file://`.

The original, unmodified source recordings are kept in `audio/_src/` so the pipeline
can be re-run.

**Everything shipped here is CC0 or public domain**, except the five optional `quack*.mp3`
clips (kept but not used — see below).

---

## 🎵 Music — `music1.mp3`, `music2.mp3`

Two gentle piano pieces that loop with a short crossfade.

### `music1.mp3` — Erik Satie, *Gymnopédie No. 1*

| | |
|---|---|
| **Composer** | Erik Satie (1866–1925) — composition in the public domain |
| **Performer** | Teknopazzo |
| **Source** | [`File:Gymnopedie No. 1..ogg`](https://commons.wikimedia.org/wiki/File:Gymnopedie_No._1..ogg) (Wikimedia Commons) |
| **Direct file** | https://upload.wikimedia.org/wikipedia/commons/b/b7/Gymnopedie_No._1..ogg |
| **Licence** | **CC0 1.0** (Public Domain Dedication) — no attribution legally required, credited here anyway |
| **Changes** | A 26-second seamless loop cut from the middle, crossfaded at the loop point (3 s), band-limited (38 Hz–13.5 kHz), mono, 64 kbps. |

### `music2.mp3` — J. S. Bach, *Goldberg Variations, BWV 988 — Aria*

| | |
|---|---|
| **Composer** | Johann Sebastian Bach (1685–1750) — composition in the public domain |
| **Performer** | Shelley Katz |
| **Source** | [`File:Bach, Goldberg Variations, Aria (Musopen version).ogg`](https://commons.wikimedia.org/wiki/File:Bach,_Goldberg_Variations,_Aria_(Musopen_version).ogg) (Wikimedia Commons) — from the **Musopen Kickstarter Project** |
| **Direct file** | https://upload.wikimedia.org/wikipedia/commons/a/af/Bach%2C_Goldberg_Variations%2C_Aria_%28Musopen_version%29.ogg |
| **Licence** | **CC0 1.0** (Public Domain Dedication) — Musopen requires uploaders to warrant their content is public domain |
| **Changes** | A 22-second seamless loop cut from later in the piece, crossfaded at the loop point (3 s), band-passed and lifted (the source is a quiet recording), mono, 64 kbps. |

The two tracks alternate and crossfade into one another while you play.

---

## 💦 Water splashes — `splash1.mp3` … `splash3.mp3`

| | |
|---|---|
| **Source** | [`File:Bathtub water splashes.ogg`](https://commons.wikimedia.org/wiki/File:Bathtub_water_splashes.ogg) |
| **Direct file** | https://upload.wikimedia.org/wikipedia/commons/8/83/Bathtub_water_splashes.ogg |
| **Author** | gradha (via [pdsounds.org](http://www.pdsounds.org/sounds/bathtub_water_splashes)) |
| **Licence** | **Public domain** |
| **Changes** | Three ~1.05 s excerpts taken from the individual splash events; mono, faded, peak-normalised, 80 kbps. |

Used for the net hitting the water, a catch, a duckling dropping into the pond, and misses.

## 🪙 Coin — `coin.mp3`

| | |
|---|---|
| **Source** | [`File:Coin dropped on wooden floor.ogg`](https://commons.wikimedia.org/wiki/File:Coin_dropped_on_wooden_floor.ogg) |
| **Direct file** | https://upload.wikimedia.org/wikipedia/commons/c/c5/Coin_dropped_on_wooden_floor.ogg |
| **Author** | ezwa (via [pdsounds.org](http://www.pdsounds.org/sounds/coin_dropped_on_wooden_floor)) |
| **Licence** | **Public domain** |
| **Changes** | A 1.0 s excerpt of the drop; mono, faded, peak-normalised, 80 kbps. |

Played when a visitor buys a duck (and for a couple of UI confirms).

---

## 🦆 Duck quacks — `quack1.mp3` … `quack5.mp3` *(bundled but unused)*

The ducks in this game are **deliberately silent** — see the "Sound" section of the
[README](../README.md). These five quack clips are still built into `js/sounds-data.js`
(and are available through `Sound.quack`) but **nothing calls them**. They are left in
place only so a future version could restore a quack without re-downloading anything.

| | |
|---|---|
| **Source** | [`File:Pekin duck & mallard.ogg`](https://commons.wikimedia.org/wiki/File:Pekin_duck_%26_mallard.ogg) |
| **Direct file** | https://upload.wikimedia.org/wikipedia/commons/3/39/Pekin_duck_%26_mallard.ogg |
| **Author** | WaderClub |
| **Licence** | **CC BY-SA 4.0** — https://creativecommons.org/licenses/by-sa/4.0/ |
| **Changes** | Five ~0.62 s excerpts cut from the loudest, most distinct moments of the 82-second recording; each was mono-downmixed, gently faded, peak-normalised and encoded at 80 kbps. |

---

## Note on share-alike

Only `quack*.mp3` derive from a **CC BY-SA 4.0** recording, and they are **not played** by
the game. Share-alike applies to adaptations of that audio, so if you redistribute this game
you should keep this attribution intact and be aware that those derived clips remain under
CC BY-SA 4.0. Everything the game actually plays is public domain or CC0.

If you'd rather avoid share-alike entirely, delete the quack build step in
`tools/build-audio.js` and re-run `node tools/build-audio.js`.

## Regenerating

```bash
# requires ffmpeg on PATH (or set the FFMPEG environment variable)
node tools/build-audio.js
```

This rewrites `audio/*.mp3` and `js/sounds-data.js`.

## Synth fallback

If a clip fails to decode (or `js/sounds-data.js` is missing), `js/audio.js` falls back to a
small built-in WebAudio synthesiser so the game is never silent. UI blips and the music bed
are always available this way too.
