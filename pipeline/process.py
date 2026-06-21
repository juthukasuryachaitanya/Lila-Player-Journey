#!/usr/bin/env python3
"""
LILA BLACK — Player Journey data pipeline.

Reads the raw parquet "journey" files (one player, one match each), decodes the
event column, maps world (x, z) coordinates to normalized minimap UV, and emits
compact, web-ready JSON plus downscaled minimap images into the frontend's
public/ folder.

Run:  python pipeline/process.py --src /path/to/player_data --out web/public

Design notes
------------
* Coordinates are stored NORMALIZED (0..1, origin top-left) rather than in pixels.
  The README's transform targets a 1024px reference image, but the real minimap
  images are 2160-9000px. Storing UV lets the frontend scale to any rendered size.
* `ts` is kept in milliseconds purely for ORDERING. Per-match spans are sub-second,
  so timestamps are not real elapsed seconds — playback normalizes by sequence.
* Output is columnar (parallel arrays) per map to keep payloads small and fast to
  filter on the client.
"""
import argparse
import glob
import json
import os
import sys

import pandas as pd
import pyarrow.parquet as pq
from PIL import Image

# --- Map configuration (from README) -------------------------------------------------
# scale + origin define the world->UV transform. image = source minimap filename.
MAPS = {
    "AmbroseValley": {"scale": 900,  "originX": -370, "originZ": -473, "image": "AmbroseValley_Minimap.png"},
    "GrandRift":     {"scale": 581,  "originX": -290, "originZ": -290, "image": "GrandRift_Minimap.png"},
    "Lockdown":      {"scale": 1000, "originX": -500, "originZ": -500, "image": "Lockdown_Minimap.jpg"},
}

# Event vocabulary -> compact integer code. Order is stable and referenced by the UI.
EVENT_CODES = {
    "Position": 0,
    "BotPosition": 1,
    "Loot": 2,
    "BotKill": 3,      # human killed a bot
    "BotKilled": 4,    # human killed BY a bot
    "Kill": 5,         # human killed a human
    "Killed": 6,       # human killed BY a human
    "KilledByStorm": 7,
}

DAYS = ["February_10", "February_11", "February_12", "February_13", "February_14"]

DISPLAY_PX = 1536  # downscaled minimap edge length served to the browser


def decode_event(v):
    if isinstance(v, (bytes, bytearray)):
        return v.decode("utf-8", "replace")
    return v


def is_human_uid(uid: str) -> bool:
    # Humans have UUID ids (contain '-'); bots are short numeric ids.
    return "-" in str(uid)


def load_all(src_root: str) -> pd.DataFrame:
    frames = []
    for day in DAYS:
        folder = os.path.join(src_root, day)
        if not os.path.isdir(folder):
            continue
        for path in glob.glob(os.path.join(folder, "*.nakama-0")):
            try:
                df = pq.read_table(path).to_pandas()
            except Exception as e:
                print(f"  ! skip {path}: {e}", file=sys.stderr)
                continue
            df["event"] = df["event"].map(decode_event)
            df["day"] = day
            df["is_human"] = df["user_id"].map(is_human_uid)
            frames.append(df)
    if not frames:
        raise SystemExit(f"No parquet files found under {src_root}")
    return pd.concat(frames, ignore_index=True)


def world_to_uv(x, z, cfg):
    """World (x, z) -> normalized (u, v) with origin at TOP-LEFT (matches image)."""
    u = (x - cfg["originX"]) / cfg["scale"]
    v = 1.0 - (z - cfg["originZ"]) / cfg["scale"]  # flip: image y grows downward
    return u, v


def build_matches(df: pd.DataFrame):
    """One record per match with summary stats (used for the match list + filters)."""
    matches = []
    for mid, g in df.groupby("match_id"):
        ev = g["event"].value_counts().to_dict()
        ts = g["ts"].astype("datetime64[ms]").astype("int64")
        matches.append({
            "id": mid,
            "shortId": mid.split("-")[0],
            "map": g["map_id"].iloc[0],
            "day": g["day"].iloc[0],
            "humans": int(g.loc[g.is_human, "user_id"].nunique()),
            "bots": int(g.loc[~g.is_human, "user_id"].nunique()),
            "rows": int(len(g)),
            "tsMin": int(ts.min()),
            "tsMax": int(ts.max()),
            # Combat broken out by actor, mirroring the UI groups (see ARCHITECTURE.md).
            # Event names describe the VICTIM: BotKill = a human killed a bot,
            # BotKilled = a human was killed by a bot.
            "humanKills": int(ev.get("Kill", 0) + ev.get("BotKill", 0)),  # kills by a human
            "botKills": int(ev.get("BotKilled", 0)),                       # kills by a bot (human deaths to bots)
            "pvpDeaths": int(ev.get("Killed", 0)),                         # human killed by a human
            "stormDeaths": int(ev.get("KilledByStorm", 0)),               # human killed by the storm
            "loot": int(ev.get("Loot", 0)),
        })
    matches.sort(key=lambda m: (m["day"], m["map"], m["id"]))
    return matches


def build_map_payloads(df: pd.DataFrame, match_index):
    """Per-map columnar arrays. Coordinates normalized, ts kept for ordering."""
    out = {}
    for map_id, cfg in MAPS.items():
        g = df[df.map_id == map_id].copy()
        if g.empty:
            out[map_id] = {"u": [], "v": [], "e": [], "b": [], "m": [], "p": [], "ts": []}
            continue
        # stable player index within each match (0..n-1) so the UI can split journeys
        g["p"] = g.groupby("match_id")["user_id"].transform(lambda s: pd.factorize(s)[0])
        u, v = world_to_uv(g["x"].to_numpy(), g["z"].to_numpy(), cfg)
        ts = g["ts"].astype("datetime64[ms]").astype("int64").to_numpy()
        out[map_id] = {
            "u": [round(float(a), 4) for a in u],
            "v": [round(float(a), 4) for a in v],
            "e": [EVENT_CODES.get(e, 0) for e in g["event"]],
            "b": [0 if h else 1 for h in g["is_human"]],
            "m": [match_index[mid] for mid in g["match_id"]],
            "p": [int(p) for p in g["p"]],
            "ts": [int(t) for t in ts],
        }
    return out


def downscale_minimaps(src_root: str, out_dir: str):
    os.makedirs(out_dir, exist_ok=True)
    mapping = {}
    for map_id, cfg in MAPS.items():
        src = os.path.join(src_root, "minimaps", cfg["image"])
        im = Image.open(src).convert("RGB")
        im.thumbnail((DISPLAY_PX, DISPLAY_PX), Image.LANCZOS)
        name = f"{map_id}.jpg"
        im.save(os.path.join(out_dir, name), "JPEG", quality=86)
        mapping[map_id] = name
        print(f"  minimap {map_id}: {im.size} -> {name}")
    return mapping


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="root containing day folders + minimaps/")
    ap.add_argument("--out", required=True, help="frontend public/ dir")
    args = ap.parse_args()

    data_out = os.path.join(args.out, "data")
    map_img_out = os.path.join(args.out, "minimaps")
    os.makedirs(data_out, exist_ok=True)

    print("Loading parquet ...")
    df = load_all(args.src)
    print(f"  {len(df):,} rows across {df.match_id.nunique()} matches, {df.user_id.nunique()} users")

    print("Downscaling minimaps ...")
    img_map = downscale_minimaps(args.src, map_img_out)

    print("Building match index ...")
    matches = build_matches(df)
    match_index = {m["id"]: i for i, m in enumerate(matches)}

    print("Building per-map payloads ...")
    map_payloads = build_map_payloads(df, match_index)
    for map_id, payload in map_payloads.items():
        with open(os.path.join(data_out, f"map_{map_id}.json"), "w") as f:
            json.dump(payload, f, separators=(",", ":"))
        print(f"  map_{map_id}.json: {len(payload['u']):,} events")

    # Global, human-readable stats for the dashboard + sanity in docs.
    ev_total = df["event"].value_counts().to_dict()
    stats = {
        "rows": int(len(df)),
        "matches": int(df.match_id.nunique()),
        "users": int(df.user_id.nunique()),
        "humans": int(df.loc[df.is_human, "user_id"].nunique()),
        "bots": int(df.loc[~df.is_human, "user_id"].nunique()),
        "events": {k: int(v) for k, v in ev_total.items()},
        "perMap": {m: int((df.map_id == m).sum()) for m in MAPS},
    }

    manifest = {
        "generatedFrom": "LILA BLACK production telemetry (Feb 10-14, 2026)",
        "displayPx": DISPLAY_PX,
        "eventCodes": EVENT_CODES,
        "maps": {m: {**cfg, "image": img_map[m]} for m, cfg in MAPS.items()},
        "days": DAYS,
        "matches": matches,
        "stats": stats,
    }
    with open(os.path.join(data_out, "manifest.json"), "w") as f:
        json.dump(manifest, f, separators=(",", ":"))
    print(f"  manifest.json: {len(matches)} matches indexed")
    print("Done.")


if __name__ == "__main__":
    main()
