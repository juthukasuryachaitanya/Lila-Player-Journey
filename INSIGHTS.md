# Insights

Three things the tool surfaced about LILA BLACK, from the Feb 10–14, 2026 production data (89,104 events · 796 matches · 339 players). Each was found by *looking at the map*, then confirmed in the numbers.

---

## 1. The game is PvE wearing a battle-royale costume

**What caught my eye.** Toggling the **"Kills by human"** layer on lights up the map; the **"Deaths (PvP)"** layer is almost empty. Players are killing bots constantly and each other essentially never. (Note: the event `BotKill` means *a human killed a bot* — the names describe the victim, not the killer.)

**The evidence.**
- Human-kills-bot (`BotKill`): **2,415**. Human-kills-human (`Kill`): **3**. That's an **805 : 1** PvE-to-PvP kill ratio.
- Of every way a human died: **94.3%** were killed by a **bot** (the "Kills by bot" layer), **5.3%** by the **storm**, and **0.4%** (3 events) by another **human**.
- Only **1 of 796 matches** contained more than one human player.

**Actionable.** The difficulty and "threat" a player feels is authored almost entirely by **where bots are placed and how hard they hit** — there is no meaningful emergent PvP to lean on. Action items: treat bot density / aggression at key locations as the primary difficulty dial; A/B bot counts at the central funnel (see #2); decide deliberately whether the design *wants* PvP and, if so, why the population/matchmaking isn't producing it.
*Metrics affected:* human survival rate, average kills-per-match, early-session difficulty spikes, retention.

**Why a level designer should care.** You are not balancing arenas for player-vs-player sightlines and cover — you are balancing **encounter design against AI**. Cover, chokepoints, and spawn placement should be tuned for the bot pathing and engagement ranges that are actually killing 94% of your players, not for a PvP meta that isn't happening.

---

## 2. One central junction *is* the playable map; the rest is scenery

**What caught my eye.** Every overlay — traffic, loot, kills, deaths — lights up the **same central river-junction / compound** on Ambrose Valley (now labelled **Central Compound**) and leaves the map's corners almost black.

**The evidence (Ambrose Valley, map divided into a 20×20 grid = 400 cells).**
- The busiest **5% of cells** contain **38% of all traffic**, **58% of all loot pickups**, **61% of all kills**, and **72% of all deaths**.
- The single deadliest cell alone accounts for **12.9%** of all deaths on the map.
- This holds across maps: loot-per-match is 17.6 (Ambrose), 14.9 (Grand Rift), 12.0 (Lockdown), but the *spatial* spread is consistently funnel-shaped.

**Actionable.** ~95% of the authored map is underused. Two coherent directions: **(a) lean in** — formally make the junction the intended arena and trim/repurpose the dead edges; or **(b) redistribute** — move high-value loot and objectives outward to pull players off the funnel and reward map coverage. Pair with storm direction (see #3) to push, not just pull.
*Metrics affected:* map coverage / spread, time-to-first-engagement, loot-route diversity, average distance travelled, build-cost-per-played-square-metre.

**Why a level designer should care.** The named POI labels make this concrete — you can point at exactly which hotspots (Central Compound, River Docks, …) players actually touch. Right now a large fraction of level-art and layout effort sits in zones almost no one enters — that's directly reclaimable, and the funnel itself is a lever you can widen or tighten on purpose.

---

## 3. The storm — the core extraction-shooter pressure — is doing almost nothing

**What caught my eye.** "Storm deaths" is the quietest layer in the whole tool: a handful of purple markers, mostly at the map edges, versus dense loot everywhere.

**The evidence.**
- **39** storm deaths in the entire 5-day window — **5.3%** of all deaths, vs **94.3%** to bots.
- Players pick up **5.3 loot items for every kill** (12,885 loot vs 2,418 total kills): the loop is loot-heavy and low-pressure.
- Per-match `ts` spans are sub-second and matches are small — sessions are ending (extraction or wipe) well before the storm becomes the thing that kills you.

**Actionable.** In an extraction shooter the storm is supposed to *create urgency and force movement*. At a 5% kill share it's effectively a backdrop. Action items: tighten storm timing/speed or start it sooner so it actively pushes players off the central funnel from #2; verify storm-edge telegraphing reads on the minimap; instrument extraction outcomes to see whether players are leaving early or simply never pressured.
*Metrics affected:* storm-death rate, extraction-vs-timeout rate, average match duration, % of match spent moving vs camping the loot funnel.

**Why a level designer should care.** Storm direction and timing are a **spatial design tool** — the cleanest way to break the single-junction problem in #2 is a storm that sweeps players *through* the underused parts of the map. If it's not creating pressure, the level's intended pacing and route-flow aren't being enforced.

---

### Bonus context for whoever picks the roadmap
- **Ambrose Valley is the franchise**: 566 of 796 matches (**71%**) and 61k of 89k events. Grand Rift is a rounding error (59 matches). Tuning Ambrose moves the headline numbers; the others are secondary.
- **Daily volume falls across the window** (285 → 201 → 162 → 112 → 37 matches, Feb 10→14; Feb 14 is a partial day) — worth confirming whether that's collection scope or an actual engagement slide.
