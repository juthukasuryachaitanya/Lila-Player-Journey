# Architecture

## What I built with, and why

| Layer | Choice | Why |
|---|---|---|
| Data pipeline | Python + pyarrow / pandas / Pillow | Parquet, the byte-encoded `event` column, bot detection, and the coordinate transform are all cheapest to solve **once**, offline, in the ecosystem built for it. |
| Transport | Pre-baked static JSON (columnar) + downscaled JPmaps | The dataset is small after cleaning (~89k rows). Baking it to static assets means **no backend, no DB, no API** — the tool is just files on a CDN. |
| Frontend | React 18 + Vite | Fast dev loop, tiny output, trivial static deploy. |
| Rendering | Hand-rolled `<canvas>` (no chart lib) | Full control over 60k-point scatter, journey polylines, playback reveal, and a custom heatmap — and no heavy dependency to fight with. |
| UI | Plain CSS | One designer-controlled stylesheet; no framework weight for ~6 components. |

The guiding decision: **a Level Designer is the user, not a data scientist.** So the headline view is an aggregate heatmap over the real map, with drill-down to a single match's journey + playback — not a notebook.

## How data flows

```
player_data/*.nakama-0 (parquet, 1 player × 1 match each)
        │  pipeline/process.py
        │   • read parquet, decode event bytes -> str
        │   • is_human = user_id contains '-'
        │   • world (x,z) -> normalized UV (0..1)
        │   • per-match player index for journey grouping
        │   • downscale minimaps 2160²–9000²  ->  1536²
        ▼
web/public/data/
   manifest.json        (map config, 796-match index, global stats)
   map_<Map>.json       (columnar arrays: u,v,event,bot,match,player,ts)
web/public/minimaps/<Map>.jpg
        │  fetch on demand (per map)
        ▼
React (App.jsx) holds filter state  →  MapCanvas.jsx
   • aggregate mode: filter indices, scatter + Gaussian-splat heatmap
   • match mode: group positions per player → polylines + timeline reveal
```

Payloads are **columnar** (parallel arrays `u[]`, `v[]`, `e[]`, …) rather than an array of objects — it roughly halves the JSON and lets the client filter with tight numeric loops. Ambrose (the big map) is ~2 MB and only loads when selected.

## Coordinate mapping — the tricky part

Each event has world coordinates `(x, y, z)`. `y` is **elevation** and is ignored for a top-down map; only `x` and `z` are used. Each map ships a `scale` and an origin `(originX, originZ)` (from the dataset README):

```
AmbroseValley  scale 900   origin (-370, -473)
GrandRift      scale 581   origin (-290, -290)
Lockdown       scale 1000  origin (-500, -500)
```

The transform is an axis-aligned affine map world → unit square, with the Z axis flipped because image Y grows downward:

```
u = (x - originX) / scale            # 0..1 across the map
v = 1 - (z - originZ) / scale        # 0..1, flipped so +Z is "up" on screen
```

Worked example (AmbroseValley), the README's own sample row `x=-301.45, z=-355.55`:

```
u = (-301.45 + 370) / 900 = 0.0762
v = 1 - (-355.55 + 473) / 900 = 1 - 0.1305 = 0.8695
→ on a 1024px ref image that's pixel (78, 890); on the real image, (u·W, v·H)
```

**The key decision: store UV (0–1), not pixels.** The dataset README says the minimaps are 1024×1024 — they are not; the actual files are 4320², 2160² and 9000². If I had baked pixel coordinates against the assumed 1024, every point would be wrong on the real images. Storing normalized UV makes rendering **resolution-independent**: the pipeline downscales the minimaps to 1536² for the web, the canvas renders at 2048², and `u·W, v·H` is correct at any size, including while zoomed.

I validated the transform by overlaying real events on the minimap: loot and kills sit exactly on buildings, the compound, and road junctions, and avoid water and open wilderness. **100% of points across all three maps land inside `[0,1]`** — a strong signal the scale/origin are right.

## Assumptions

| Ambiguity in the data | How I handled it |
|---|---|
| Minimaps documented as 1024² but actually 2160²–9000² | Store **normalized** coordinates; downscale images to 1536²; render relative to displayed size. |
| `ts` per match spans **< 1 second** (not real elapsed time) | Treat `ts` as an **ordering key only**. Playback animates over a fixed wall-clock duration in `ts` order, labelled "sequence-ordered (ts spans <1s, normalized)" so nobody mistakes it for real time. |
| No per-row player id (only `user_id`, dropped to save space) | Pipeline adds a small **per-match player index** so journeys can be split per player and coloured human/bot. |
| Almost every "match" is **1 human + bots** (only 1 of 796 has >1 human) | Multi-human replay wasn't the product. Aggregate heatmaps became the primary view; per-match journey + playback is the drill-down. |
| `Kill`/`Killed` (human-vs-human) extremely rare (3 each) | Kept as their own markers but grouped sensibly: "Kills (by human)" = `Kill`+`BotKill`, "Deaths" = `Killed`+`BotKilled`. |
| Feb 14 is a partial day | Surfaced as-is; day filter lets you exclude it. |
| Files have no `.parquet` extension | Read by path regardless; pyarrow handles them. |

## Major tradeoffs

| Decision | Alternative | Why I chose it |
|---|---|---|
| Pre-bake static JSON | Live backend / DuckDB-WASM query | Data is tiny after cleaning; static is zero-ops, instant, and trivially hostable. |
| Columnar arrays | Array of event objects | ~2× smaller payload, faster client-side filtering. |
| Canvas 2D + CSS-transform zoom | WebGL / deck.gl | 60k points is comfortable on 2D canvas; avoids a heavy dep and keeps the build simple and reliable. |
| Custom CPU heatmap (Gaussian splat) | heatmap.js / shader | One small function, themeable ramps per metric, recomputed only on filter change. |
| Paths only in single-match mode | Draw all journeys at once | 339 overlapping paths is noise; aggregate uses scatter + heatmap, drill-down uses paths. |
| Commit generated data to the repo | Build data in CI | Guarantees the deploy works with no access to the raw proprietary telemetry. |

## Three things I learned about the game (full write-up in INSIGHTS.md)

1. **Combat is ~entirely PvE** — 2,415 human-kills-bot vs **3** human-vs-human, and **94% of human deaths are to bots**. Bot placement *is* the difficulty curve.
2. **One central junction is the whole game** — the top 5% of Ambrose map cells hold 38% of traffic, 58% of loot, 61% of kills and **72% of deaths**; the outer map is nearly dead space.
3. **The storm is inert** — only 39 storm deaths (5% of all deaths) and 5.3 loot pickups per kill: the extraction-shooter's signature pressure mechanic isn't creating urgency.
