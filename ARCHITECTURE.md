# Architecture

## What I built with, and why

| Layer | Choice | Why |
|---|---|---|
| Data pipeline | Python + pyarrow / pandas / Pillow | Parquet, the byte-encoded `event` column, bot detection, and the coordinate transform are all cheapest to solve **once**, offline, in the ecosystem built for it. |
| Transport | Pre-baked static JSON (columnar) + downscaled JPG maps | The dataset is small after cleaning (~89k rows). Baking it to static assets means **no backend, no DB, no API** — the tool is just files on a CDN. |
| Frontend | React 18 + Vite | Fast dev loop, tiny output, trivial static deploy. |
| Rendering | Hand-rolled `<canvas>` (no chart lib) | Full control over 60k-point scatter, journey polylines, playback reveal, and a custom heatmap — and no heavy dependency to fight with. |
| Resilience | React error boundary around the map | A render exception degrades to a recoverable "reset" card instead of unmounting the app (see KNOWN_ISSUES.md). |
| UI | Plain CSS | One designer-controlled stylesheet; no framework weight for ~7 components. |

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
   manifest.json        (map config, 796-match index, global + per-match stats)
   map_<Map>.json       (columnar arrays: u,v,event,bot,match,player,ts)
web/public/minimaps/<Map>.jpg
        │  fetch on demand (per map)
        ▼
React (App.jsx) holds filter state  →  MapErrorBoundary → MapCanvas.jsx
   • aggregate mode: filter indices, scatter + Gaussian-splat heatmap
   • match mode: group positions per player → polylines + smoothed timeline reveal
   • POI labels positioned in screen space (constant size under zoom)
   • cursor-anchored zoom; pan/zoom state null-guarded throughout
```

Payloads are **columnar** (parallel arrays `u[]`, `v[]`, `e[]`, …) rather than an array of objects — it roughly halves the JSON and lets the client filter with tight numeric loops. Ambrose (the big map) is ~2 MB and only loads when selected.

## Event taxonomy & the kill split

The event names describe the **victim**, not the actor, which is easy to get wrong. Verified counts across the dataset:

```
Position      51,347   movement (human)
BotPosition   21,712   movement (bot)
Loot          12,885   loot pickup
BotKill        2,415   a HUMAN killed a bot      (~92% logged by humans)
BotKilled        700   a human was KILLED BY a bot
KilledByStorm     39   a human killed by the storm
Kill               3   a human killed a human    (PvP)
Killed             3   a human killed by a human (PvP)
```

So `BotKill` is a kill *by* a human, and `BotKilled` is a death *to* a bot. Grouping combat by **who pulled the trigger** gives the UI:

| Group (UI label) | Event codes | Marker |
|---|---|---|
| Kills by human | `Kill` + `BotKill` | green ▲ |
| Kills by bot | `BotKilled` | teal ▼ |
| Deaths (PvP) | `Killed` | red ✕ |
| Storm deaths | `KilledByStorm` | purple |

The earlier version folded the bot-as-killer events into a single "Deaths" bucket, which hid the single most important combat fact in the data (94% of deaths are bot kills). Splitting "Kills by human" from "Kills by bot" surfaces it directly, and the inspector reports the two counts separately per selection. Heatmaps stay aggregate: **kill zones** = `Kill`+`BotKill`, **death zones** = `Killed`+`BotKilled`+`KilledByStorm`.

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

The same normalized space drives the **POI labels**: each hotspot is an `(u, v)` point named from the activity clusters + minimap landmarks. Labels render as screen-space overlays (not on the scaled canvas) so they stay constant-size and crisp at any zoom. Ambrose and Lockdown carry inferred labels; Grand Rift keeps its own built-in minimap labels.

## Interaction details

- **Cursor-anchored zoom.** Scroll-zoom keeps the point under the cursor fixed. Because the map scales about its center via a CSS transform, the wheel handler measures the cursor relative to the map **center** (not the top-left), so the zoom math matches the transform origin.
- **Smoothed playback.** Single-match playback interpolates between samples and smooths the head path so motion reads cleanly even though `ts` is only an ordering key.
- **Contained failures.** `MapErrorBoundary` wraps the canvas; any render exception shows a recoverable card instead of a blank screen.

## Assumptions

| Ambiguity in the data | How I handled it |
|---|---|
| Minimaps documented as 1024² but actually 2160²–9000² | Store **normalized** coordinates; downscale images to 1536²; render relative to displayed size. |
| `ts` per match spans **< 1 second** (not real elapsed time) | Treat `ts` as an **ordering key only**. Playback animates over a fixed wall-clock duration in `ts` order, labelled "sequence-ordered (ts spans <1s, normalized)" so nobody mistakes it for real time. |
| No per-row player id (only `user_id`, dropped to save space) | Pipeline adds a small **per-match player index** so journeys can be split per player and coloured human/bot. |
| Almost every "match" is **1 human + bots** (only 1 of 796 has >1 human) | Multi-human replay wasn't the product. Aggregate heatmaps became the primary view; per-match journey + playback is the drill-down. |
| Event names describe the **victim** (`BotKill` = human kills bot; `BotKilled` = killed by bot) | Grouped combat by **who acted**: "Kills by human" = `Kill`+`BotKill`, "Kills by bot" = `BotKilled`, "Deaths (PvP)" = `Killed`, "Storm" = `KilledByStorm`. Inspector shows human vs bot kills separately. |
| Feb 14 is a partial day | Surfaced as-is; day filter lets you exclude it. |
| Files have no `.parquet` extension | Read by path regardless; pyarrow handles them. |

## Major tradeoffs

| Decision | Alternative | Why I chose it |
|---|---|---|
| Pre-bake static JSON | Live backend / DuckDB-WASM query | Data is tiny after cleaning; static is zero-ops, instant, and trivially hostable. |
| Columnar arrays | Array of event objects | ~2× smaller payload, faster client-side filtering. |
| Canvas 2D + CSS-transform, cursor-anchored zoom | WebGL / deck.gl | 60k points is comfortable on 2D canvas; avoids a heavy dep and keeps the build simple and reliable. |
| Custom CPU heatmap (Gaussian splat) | heatmap.js / shader | One small function, themeable ramps per metric, recomputed only on filter change. |
| Screen-space POI labels + error boundary | Labels baked into canvas / no boundary | Labels stay crisp at any zoom; a render fault degrades gracefully instead of blanking. |
| Paths only in single-match mode | Draw all journeys at once | 339 overlapping paths is noise; aggregate uses scatter + heatmap, drill-down uses paths. |
| Commit generated data to the repo | Build data in CI | Guarantees the deploy works with no access to the raw proprietary telemetry. |

## Three things I learned about the game (full write-up in INSIGHTS.md)

1. **Combat is ~entirely PvE** — 2,415 human-kills-bot vs **3** human-vs-human, and **94% of human deaths are to bots**. Bot placement *is* the difficulty curve.
2. **One central junction is the whole game** — the top 5% of Ambrose map cells hold 38% of traffic, 58% of loot, 61% of kills and **72% of deaths**; the outer map is nearly dead space.
3. **The storm is inert** — only 39 storm deaths (5% of all deaths) and 5.3 loot pickups per kill: the extraction-shooter's signature pressure mechanic isn't creating urgency.
