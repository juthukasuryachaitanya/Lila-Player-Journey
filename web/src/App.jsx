import { useEffect, useMemo, useRef, useState } from 'react'
import { loadManifest, loadMap, EVENT_GROUPS } from './data.js'
import MapCanvas from './MapCanvas.jsx'
import MapErrorBoundary from './MapErrorBoundary.jsx'
import Controls from './Controls.jsx'
import Timeline from './Timeline.jsx'
import Inspector from './Inspector.jsx'

const DEFAULT_GROUPS = new Set(['loot', 'kill', 'killbot', 'death', 'storm']) // movement off by default

export default function App() {
  const [manifest, setManifest] = useState(null)
  const [err, setErr] = useState(null)
  const [mapId, setMapId] = useState('AmbroseValley')
  const [mapData, setMapData] = useState(null)
  const [loadingMap, setLoadingMap] = useState(false)

  const [dayFilter, setDayFilter] = useState('all')
  const [matchId, setMatchId] = useState('all')
  const [visibleGroups, setVisibleGroups] = useState(new Set(DEFAULT_GROUPS))
  const [showHumans, setShowHumans] = useState(true)
  const [showBots, setShowBots] = useState(true)
  const [heatMetric, setHeatMetric] = useState('traffic')

  const [playback, setPlayback] = useState({ playing: false, progress: 1, speed: 1 })
  const [statsCounts, setStatsCounts] = useState({})
  const matchMetaRef = useRef(null)
  const [matchMeta, setMatchMeta] = useState(null)

  // load manifest once
  useEffect(() => {
    loadManifest().then(setManifest).catch((e) => setErr(e.message))
  }, [])

  // load per-map payload on map change
  useEffect(() => {
    setLoadingMap(true)
    loadMap(mapId).then((d) => { setMapData(d); setLoadingMap(false) }).catch((e) => setErr(e.message))
  }, [mapId])

  // matches available for the current map + day
  const matches = useMemo(() => {
    if (!manifest) return []
    return manifest.matches.filter((m) => m.map === mapId && (dayFilter === 'all' || m.day === dayFilter))
  }, [manifest, mapId, dayFilter])

  // reset match selection when it leaves the filtered set
  useEffect(() => {
    if (matchId !== 'all' && !matches.some((m) => m.id === matchId)) setMatchId('all')
  }, [matches]) // eslint-disable-line

  const selectedMatchIndex = useMemo(() => {
    if (!manifest || matchId === 'all') return -1
    return manifest.matches.findIndex((m) => m.id === matchId)
  }, [manifest, matchId])
  const matchRecord = useMemo(
    () => (manifest && matchId !== 'all' ? manifest.matches.find((m) => m.id === matchId) : null),
    [manifest, matchId]
  )
  const mode = matchId === 'all' ? 'aggregate' : 'match'

  // set of manifest match indices visible under the current map + day (for aggregate filtering)
  const dayMatchSet = useMemo(() => {
    if (!manifest) return null
    const s = new Set()
    manifest.matches.forEach((m, i) => {
      if (m.map === mapId && (dayFilter === 'all' || m.day === dayFilter)) s.add(i)
    })
    return s
  }, [manifest, mapId, dayFilter])

  // when entering a match, show full journey; reset playback
  useEffect(() => {
    setPlayback((p) => ({ ...p, playing: false, progress: 1 }))
  }, [matchId])

  // playback clock — advances progress over ~8s at 1x
  useEffect(() => {
    if (mode !== 'match' || !playback.playing) return
    let raf, last = performance.now()
    const tick = (now) => {
      const dt = (now - last) / 1000; last = now
      setPlayback((p) => {
        let np = p.progress + (dt / 8) * p.speed
        if (np >= 1) return { ...p, progress: 1, playing: false }
        return { ...p, progress: np }
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [mode, playback.playing, playback.speed])

  const toggleGroup = (id) => setVisibleGroups((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  const onStats = useMemo(() => (counts, meta) => {
    if (counts) setStatsCounts(counts)
    if (meta !== undefined) { matchMetaRef.current = meta; setMatchMeta(meta) }
  }, [])

  if (err) return <div className="fatal">Could not load data: {err}<br /><small>Run the pipeline so <code>public/data/</code> exists, then reload.</small></div>
  if (!manifest) return <div className="boot"><span className="spinner" /> Loading telemetry…</div>

  return (
    <div className="app">
      <Controls
        manifest={manifest} mapId={mapId} setMapId={setMapId}
        dayFilter={dayFilter} setDayFilter={setDayFilter}
        matchId={matchId} setMatchId={setMatchId} matches={matches}
        visibleGroups={visibleGroups} toggleGroup={toggleGroup}
        showHumans={showHumans} setShowHumans={setShowHumans}
        showBots={showBots} setShowBots={setShowBots}
        heatMetric={heatMetric} setHeatMetric={setHeatMetric}
      />

      <main className="main">
        <div className="canvas-wrap">
          {mapData && !loadingMap ? (
            <MapErrorBoundary>
              <MapCanvas
                key={mapId}
                mapCfg={manifest.maps[mapId]} data={mapData}
                mode={mode} selectedMatch={selectedMatchIndex}
                heatMetric={mode === 'match' ? null : heatMetric}
                visibleGroups={visibleGroups}
                showHumans={showHumans} showBots={showBots}
                dayMatchSet={dayMatchSet}
                playback={playback} onStats={onStats}
              />
            </MapErrorBoundary>
          ) : (
            <div className="boot center"><span className="spinner" /> Loading {mapId}…</div>
          )}
        </div>
        <Timeline active={mode === 'match'} playback={playback} setPlayback={setPlayback} matchMeta={matchMeta} />
      </main>

      <Inspector
        mapId={mapId} dayFilter={dayFilter} matchId={matchId}
        statsCounts={statsCounts} matchMeta={matchMeta} matchRecord={matchRecord}
      />
    </div>
  )
}
