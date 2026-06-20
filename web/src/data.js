// Data layer: manifest + per-map payload loading, event vocabulary, color tokens.

const DATA = import.meta.env.BASE_URL + 'data/'
const IMG = import.meta.env.BASE_URL + 'minimaps/'

// Event integer codes — must match pipeline/process.py EVENT_CODES.
export const EVENT = {
  Position: 0,
  BotPosition: 1,
  Loot: 2,
  BotKill: 3,
  BotKilled: 4,
  Kill: 5,
  Killed: 6,
  KilledByStorm: 7,
}
export const EVENT_NAME = Object.fromEntries(Object.entries(EVENT).map(([k, v]) => [v, k]))

// How events are grouped for filtering, legend, and heatmap metrics.
export const EVENT_GROUPS = [
  { id: 'movement', label: 'Movement', codes: [EVENT.Position, EVENT.BotPosition], color: '#4DA6FF', marker: 'dot' },
  { id: 'loot', label: 'Loot', codes: [EVENT.Loot], color: '#FFC53D', marker: 'diamond' },
  { id: 'kill', label: 'Kills by human', codes: [EVENT.Kill, EVENT.BotKill], color: '#7CFF6B', marker: 'frag' },
  { id: 'killbot', label: 'Kills by bot', codes: [EVENT.BotKilled], color: '#2DD4BF', marker: 'fragDown' },
  { id: 'death', label: 'Deaths (PvP)', codes: [EVENT.Killed], color: '#FF5470', marker: 'cross' },
  { id: 'storm', label: 'Storm deaths', codes: [EVENT.KilledByStorm], color: '#B98CFF', marker: 'storm' },
]
export const GROUP_OF_CODE = (() => {
  const m = {}
  EVENT_GROUPS.forEach((g) => g.codes.forEach((c) => (m[c] = g)))
  return m
})()

export const COLORS = {
  human: '#39E0FF',
  bot: '#FFA53D',
  accent: '#C6F24E',
}

// Named hotspots per map, placed on the busiest activity clusters in the data
// (positions are normalized u,v). Names are inferred from the minimap landmarks.
export const POIS = {
  AmbroseValley: [
    { u: 0.523, v: 0.568, name: 'Central Compound' },
    { u: 0.114, v: 0.386, name: 'West Facility' },
    { u: 0.205, v: 0.841, name: 'South Estate' },
    { u: 0.386, v: 0.795, name: 'River Docks' },
    { u: 0.614, v: 0.386, name: 'East Depot' },
  ],
  GrandRift: [
    { u: 0.477, v: 0.568, name: 'Central Rift' },
    { u: 0.205, v: 0.477, name: 'West Ridge' },
    { u: 0.841, v: 0.523, name: 'East Span' },
    { u: 0.432, v: 0.386, name: 'North Pass' },
  ],
  Lockdown: [
    { u: 0.614, v: 0.523, name: 'East Block' },
    { u: 0.205, v: 0.614, name: 'SW Yard' },
    { u: 0.205, v: 0.386, name: 'NW Gate' },
    { u: 0.523, v: 0.250, name: 'North Tower' },
  ],
}

// Heatmap metrics: which events feed the density field, and the ramp tint.
export const HEAT_METRICS = [
  { id: 'traffic', label: 'Traffic', codes: [EVENT.Position, EVENT.BotPosition], ramp: 'plasma' },
  { id: 'kills', label: 'Kill zones', codes: [EVENT.Kill, EVENT.BotKill], ramp: 'kill' },
  { id: 'deaths', label: 'Death zones', codes: [EVENT.Killed, EVENT.BotKilled, EVENT.KilledByStorm], ramp: 'death' },
  { id: 'loot', label: 'Loot zones', codes: [EVENT.Loot], ramp: 'loot' },
]

export async function loadManifest() {
  const r = await fetch(DATA + 'manifest.json')
  if (!r.ok) throw new Error('Failed to load manifest.json')
  return r.json()
}

const _mapCache = {}
export async function loadMap(mapId) {
  if (_mapCache[mapId]) return _mapCache[mapId]
  const r = await fetch(`${DATA}map_${mapId}.json`)
  if (!r.ok) throw new Error(`Failed to load map_${mapId}.json`)
  const d = await r.json()
  _mapCache[mapId] = d
  return d
}

export function minimapUrl(file) {
  return IMG + file
}

export function fmt(n) {
  return n?.toLocaleString?.() ?? String(n)
}

export function prettyDay(day) {
  // "February_10" -> "Feb 10"
  const [mon, d] = day.split('_')
  return `${mon.slice(0, 3)} ${d}`
}
