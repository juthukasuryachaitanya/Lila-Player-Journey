import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { EVENT, GROUP_OF_CODE, COLORS, HEAT_METRICS, minimapUrl } from './data.js'

const CANVAS = 2048 // internal resolution; CSS scales the stage for zoom

// ---- color ramps for heatmaps (t in 0..1) -------------------------------------------
const RAMPS = {
  plasma: [[0, 12, 60], [40, 70, 200], [40, 200, 230], [200, 245, 120], [255, 255, 255]],
  kill: [[0, 30, 10], [30, 120, 40], [120, 230, 80], [200, 255, 140], [255, 255, 220]],
  death: [[40, 0, 12], [150, 30, 60], [240, 60, 90], [255, 150, 120], [255, 240, 210]],
  loot: [[40, 26, 0], [150, 100, 20], [240, 180, 50], [255, 220, 110], [255, 250, 220]],
}
function rampColor(stops, t) {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1)
  const i = Math.floor(x)
  const f = x - i
  const a = stops[i]
  const b = stops[Math.min(stops.length - 1, i + 1)]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

// ---- event marker shapes ------------------------------------------------------------
function drawMarker(ctx, code, x, y, r) {
  const g = GROUP_OF_CODE[code]
  if (!g) return
  ctx.save()
  ctx.translate(x, y)
  ctx.lineWidth = Math.max(1.5, r * 0.45)
  ctx.strokeStyle = 'rgba(8,10,15,0.85)'
  ctx.fillStyle = g.color
  switch (g.marker) {
    case 'diamond':
      ctx.beginPath()
      ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.closePath()
      ctx.fill(); ctx.stroke(); break
    case 'frag': // upward triangle (a kill)
      ctx.beginPath()
      ctx.moveTo(0, -r * 1.15); ctx.lineTo(r, r * 0.8); ctx.lineTo(-r, r * 0.8); ctx.closePath()
      ctx.fill(); ctx.stroke(); break
    case 'cross': // an X (a death)
      ctx.lineWidth = Math.max(2, r * 0.6); ctx.strokeStyle = g.color
      ctx.beginPath()
      ctx.moveTo(-r, -r); ctx.lineTo(r, r); ctx.moveTo(r, -r); ctx.lineTo(-r, r); ctx.stroke()
      ctx.strokeStyle = 'rgba(8,10,15,0.6)'; ctx.lineWidth = 1; break
    case 'storm':
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      ctx.fillStyle = 'rgba(10,8,20,0.9)'; ctx.font = `${r * 1.6}px serif`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('\u26A1', 0, r * 0.1); break
    default:
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}

export default function MapCanvas({
  mapCfg, data, mode, selectedMatch, heatMetric, visibleGroups,
  showHumans, showBots, dayMatchSet, playback, onStats,
}) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const heatRef = useRef(null) // offscreen heat cache
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 })
  const drag = useRef(null)

  // --- filtered index set for AGGREGATE views (day + human/bot + groups) ---
  const filtered = useMemo(() => {
    const { e, b, m } = data
    const idx = []
    const matchOk = (mi) => (mode === 'match' ? mi === selectedMatch : (!dayMatchSet || dayMatchSet.has(mi)))
    for (let i = 0; i < e.length; i++) {
      if (!matchOk(m[i])) continue
      if (b[i] === 1 && !showBots) continue
      if (b[i] === 0 && !showHumans) continue
      idx.push(i)
    }
    return idx
  }, [data, mode, selectedMatch, showHumans, showBots, dayMatchSet])

  // --- per-player journeys for MATCH mode (ordered position polylines) ---
  const journeys = useMemo(() => {
    if (mode !== 'match') return null
    const { u, v, e, b, m, p, ts } = data
    const players = new Map()
    for (let i = 0; i < e.length; i++) {
      if (m[i] !== selectedMatch) continue
      if (b[i] === 1 && !showBots) continue
      if (b[i] === 0 && !showHumans) continue
      const key = p[i]
      if (!players.has(key)) players.set(key, { bot: b[i] === 1, pts: [], events: [] })
      const pl = players.get(key)
      if (e[i] === EVENT.Position || e[i] === EVENT.BotPosition) pl.pts.push([u[i], v[i], ts[i]])
      else pl.events.push([u[i], v[i], ts[i], e[i]])
    }
    let tMin = Infinity, tMax = -Infinity
    players.forEach((pl) => {
      pl.pts.sort((a, c) => a[2] - c[2])
      pl.pts.forEach((q) => { if (q[2] < tMin) tMin = q[2]; if (q[2] > tMax) tMax = q[2] })
      pl.events.forEach((q) => { if (q[2] < tMin) tMin = q[2]; if (q[2] > tMax) tMax = q[2] })
    })
    return { players: [...players.values()], tMin, tMax }
  }, [data, mode, selectedMatch, showHumans, showBots])

  // surface stats up to the parent (counts shown in the inspector)
  useEffect(() => {
    if (!onStats) return
    const counts = {}
    const { e } = data
    for (const i of filtered) counts[e[i]] = (counts[e[i]] || 0) + 1
    onStats(counts)
  }, [filtered, data, onStats])

  // --- build heatmap cache when metric / filter changes ---
  useEffect(() => {
    if (!heatMetric) { heatRef.current = null; redraw(); return }
    const metric = HEAT_METRICS.find((h) => h.id === heatMetric)
    const codes = new Set(metric.codes)
    const { u, v, e } = data
    const HM = 480
    const acc = new Float32Array(HM * HM)
    const radius = 13
    // accumulate gaussian-ish splats
    for (const i of filtered) {
      if (!codes.has(e[i])) continue
      const cx = u[i] * HM, cy = v[i] * HM
      const x0 = Math.max(0, (cx - radius) | 0), x1 = Math.min(HM - 1, (cx + radius) | 0)
      const y0 = Math.max(0, (cy - radius) | 0), y1 = Math.min(HM - 1, (cy + radius) | 0)
      for (let y = y0; y <= y1; y++) {
        const dy = y - cy
        for (let x = x0; x <= x1; x++) {
          const dx = x - cx
          const d2 = dx * dx + dy * dy
          if (d2 > radius * radius) continue
          acc[y * HM + x] += Math.exp(-d2 / (2 * (radius / 2.2) * (radius / 2.2)))
        }
      }
    }
    let max = 0
    for (let i = 0; i < acc.length; i++) if (acc[i] > max) max = acc[i]
    const off = document.createElement('canvas'); off.width = HM; off.height = HM
    const octx = off.getContext('2d')
    const img = octx.createImageData(HM, HM)
    const stops = RAMPS[metric.ramp]
    for (let i = 0; i < acc.length; i++) {
      if (acc[i] <= 0 || max <= 0) continue
      const t = Math.pow(acc[i] / max, 0.6)
      const [r, g, bl] = rampColor(stops, t)
      img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = bl
      img.data[i * 4 + 3] = Math.min(235, 60 + t * 200)
    }
    octx.putImageData(img, 0, 0)
    heatRef.current = off
    redraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heatMetric, filtered, data])

  // --- main draw ---
  const redraw = useCallback((progressOverride) => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    ctx.clearRect(0, 0, CANVAS, CANVAS)

    // heatmap underlay
    if (heatRef.current) {
      ctx.save(); ctx.globalCompositeOperation = 'screen'
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(heatRef.current, 0, 0, CANVAS, CANVAS)
      ctx.restore()
    }

    const groupsOn = (code) => {
      const g = GROUP_OF_CODE[code]; return g && visibleGroups.has(g.id)
    }

    if (mode === 'match' && journeys) {
      const { players, tMin, tMax } = journeys
      const prog = progressOverride ?? playback.progress
      const cutoff = tMin + (tMax - tMin) * prog
      players.forEach((pl) => {
        const col = pl.bot ? COLORS.bot : COLORS.human
        const pts = pl.pts.filter((q) => q[2] <= cutoff)
        if (pts.length > 1) {
          ctx.beginPath()
          ctx.moveTo(pts[0][0] * CANVAS, pts[0][1] * CANVAS)
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * CANVAS, pts[i][1] * CANVAS)
          ctx.lineWidth = pl.bot ? 2.2 : 3.4
          ctx.strokeStyle = col
          ctx.globalAlpha = pl.bot ? 0.55 : 0.9
          ctx.lineJoin = 'round'; ctx.lineCap = 'round'
          ctx.stroke(); ctx.globalAlpha = 1
        }
        // current head
        const head = pts[pts.length - 1]
        if (head) {
          ctx.beginPath(); ctx.arc(head[0] * CANVAS, head[1] * CANVAS, pl.bot ? 5 : 7, 0, Math.PI * 2)
          ctx.fillStyle = col; ctx.fill()
          ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(5,8,12,0.9)'; ctx.stroke()
        }
        // discrete events revealed so far
        pl.events.forEach((q) => {
          if (q[2] <= cutoff && groupsOn(q[3])) drawMarker(ctx, q[3], q[0] * CANVAS, q[1] * CANVAS, 9)
        })
      })
    } else {
      // aggregate: scatter discrete events (positions only if their group is on)
      const { u, v, e } = data
      for (const i of filtered) {
        if (!groupsOn(e[i])) continue
        if (e[i] === EVENT.Position || e[i] === EVENT.BotPosition) {
          ctx.fillStyle = (data.b[i] ? COLORS.bot : COLORS.human)
          ctx.globalAlpha = 0.28
          ctx.fillRect(u[i] * CANVAS - 1.2, v[i] * CANVAS - 1.2, 2.4, 2.4)
          ctx.globalAlpha = 1
        } else {
          drawMarker(ctx, e[i], u[i] * CANVAS, v[i] * CANVAS, 7)
        }
      }
    }
  }, [data, filtered, journeys, mode, playback.progress, visibleGroups])

  useEffect(() => { redraw() }, [redraw])

  // expose match time bounds to parent for the timeline label
  useEffect(() => {
    if (mode === 'match' && journeys && onStats) onStats(null, journeys)
  }, [journeys, mode]) // eslint-disable-line

  // --- zoom / pan ---
  const onWheel = (ev) => {
    ev.preventDefault()
    const rect = wrapRef.current.getBoundingClientRect()
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top
    setView((vw) => {
      const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15
      const ns = Math.max(1, Math.min(8, vw.scale * factor))
      const k = ns / vw.scale
      return { scale: ns, tx: mx - k * (mx - vw.tx), ty: my - k * (my - vw.ty) }
    })
  }
  const onPointerDown = (ev) => { drag.current = { x: ev.clientX, y: ev.clientY, tx: view.tx, ty: view.ty }; ev.target.setPointerCapture(ev.pointerId) }
  const onPointerMove = (ev) => {
    if (!drag.current) return
    setView((vw) => ({ ...vw, tx: drag.current.tx + (ev.clientX - drag.current.x), ty: drag.current.ty + (ev.clientY - drag.current.y) }))
  }
  const onPointerUp = () => { drag.current = null }
  const resetView = () => setView({ scale: 1, tx: 0, ty: 0 })

  return (
    <div className="stage" ref={wrapRef}
      onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
      <div className="stage-inner" style={{ transform: `translate(${view.tx}px,${view.ty}px) scale(${view.scale})` }}>
        <img className="minimap" src={minimapUrl(mapCfg.image)} alt="minimap" draggable={false} />
        <canvas ref={canvasRef} width={CANVAS} height={CANVAS} className="overlay" />
      </div>
      <div className="zoom-tools">
        <button onClick={() => setView((v) => ({ ...v, scale: Math.min(8, v.scale * 1.3) }))}>+</button>
        <button onClick={() => setView((v) => ({ ...v, scale: Math.max(1, v.scale / 1.3) }))}>−</button>
        <button onClick={resetView} title="Reset view">⊙</button>
      </div>
      <div className="zoom-readout">{Math.round(view.scale * 100)}%</div>
    </div>
  )
}
