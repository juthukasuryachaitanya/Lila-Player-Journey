import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { EVENT, GROUP_OF_CODE, COLORS, HEAT_METRICS, minimapUrl } from './data.js'

// Pan/zoom is applied to the 2D context (not via CSS transform on a big canvas),
// and the canvas is CPU-backed (willReadFrequently) -> no GPU black-screen.
// Heatmap and markers are kept as SEPARATE baked layers so filters + the
// heatmap blend behave exactly as before.

const lerp = (a, b, t) => a + (b - a) * t

const RAMPS = {
  plasma: [[0, 12, 60], [40, 70, 200], [40, 200, 230], [200, 245, 120], [255, 255, 255]],
  kill: [[0, 30, 10], [30, 120, 40], [120, 230, 80], [200, 255, 140], [255, 255, 220]],
  death: [[40, 0, 12], [150, 30, 60], [240, 60, 90], [255, 150, 120], [255, 240, 210]],
  loot: [[40, 26, 0], [150, 100, 20], [240, 180, 50], [255, 220, 110], [255, 250, 220]],
}
function rampColor(stops, t) {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1)
  const i = Math.floor(x), f = x - i
  const a = stops[i], b = stops[Math.min(stops.length - 1, i + 1)]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

function tracePath(ctx, pts) {
  if (pts.length < 2) return
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  if (pts.length === 2) { ctx.lineTo(pts[1][0], pts[1][1]); return }
  for (let i = 1; i < pts.length - 1; i++) {
    const xc = (pts[i][0] + pts[i + 1][0]) / 2, yc = (pts[i][1] + pts[i + 1][1]) / 2
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], xc, yc)
  }
  const n = pts.length
  ctx.quadraticCurveTo(pts[n - 2][0], pts[n - 2][1], pts[n - 1][0], pts[n - 1][1])
}

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
    case 'frag':
      ctx.beginPath()
      ctx.moveTo(0, -r * 1.15); ctx.lineTo(r, r * 0.8); ctx.lineTo(-r, r * 0.8); ctx.closePath()
      ctx.fill(); ctx.stroke(); break
    case 'cross':
      ctx.lineWidth = Math.max(2, r * 0.6); ctx.strokeStyle = g.color
      ctx.beginPath()
      ctx.moveTo(-r, -r); ctx.lineTo(r, r); ctx.moveTo(r, -r); ctx.lineTo(-r, r); ctx.stroke(); break
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
  const imgRef = useRef(null)        // minimap Image
  const heatRef = useRef(null)       // baked heatmap layer (drawn with 'screen')
  const markersRef = useRef(null)    // baked marker layer (drawn 'source-over')
  const redrawRef = useRef(() => {})
  const drag = useRef(null)
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 })
  const [, setImgTick] = useState(0)

  const LAYER = 1600 // baked-layer resolution

  // load minimap
  useEffect(() => {
    imgRef.current = null
    const img = new Image()
    img.onload = () => { imgRef.current = img; setImgTick((t) => t + 1) }
    img.src = minimapUrl(mapCfg.image)
    return () => { img.onload = null }
  }, [mapCfg.image])

  const layout = () => {
    const wrap = wrapRef.current
    const W = wrap ? wrap.clientWidth : 1, H = wrap ? wrap.clientHeight : 1
    return { W, H, S: Math.min(W, H) * 0.94, cx: W / 2, cy: H / 2 }
  }

  const clampView = useCallback((v) => {
    const { W, H, S } = layout()
    const mapW = S * v.scale, mapH = S * v.scale
    const slackX = W * 0.3, slackY = H * 0.3
    const maxX = Math.max(0, (mapW - W) / 2) + slackX
    const maxY = Math.max(0, (mapH - H) / 2) + slackY
    return { scale: v.scale, tx: Math.max(-maxX, Math.min(maxX, v.tx)), ty: Math.max(-maxY, Math.min(maxY, v.ty)) }
  }, [])

  // filtered indices (aggregate)
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

  // smoothed per-player journeys (match mode)
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
    players.forEach((pl) => {
      pl.pts.sort((a, c) => a[2] - c[2])
      const raw = pl.pts
      if (raw.length >= 3) {
        const sm = []
        for (let i = 0; i < raw.length; i++) {
          const a = raw[Math.max(0, i - 1)], b = raw[i], c = raw[Math.min(raw.length - 1, i + 1)]
          sm.push([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, b[2]])
        }
        pl.pts = sm
      }
      let lo = Infinity, hi = -Infinity
      pl.pts.forEach((q) => { if (q[2] < lo) lo = q[2]; if (q[2] > hi) hi = q[2] })
      pl.events.forEach((q) => { if (q[2] < lo) lo = q[2]; if (q[2] > hi) hi = q[2] })
      pl.tmin = lo; pl.tmax = hi
    })
    return { players: [...players.values()] }
  }, [data, mode, selectedMatch, showHumans, showBots])

  // stats + match meta to parent
  useEffect(() => {
    if (!onStats) return
    const counts = {}
    const { e } = data
    for (const i of filtered) counts[e[i]] = (counts[e[i]] || 0) + 1
    onStats(counts)
  }, [filtered, data, onStats])
  useEffect(() => {
    if (mode === 'match' && journeys && onStats) onStats(null, journeys)
  }, [journeys, mode]) // eslint-disable-line

  // ---- draw ----
  const redraw = useCallback((progressOverride) => {
    const cv = canvasRef.current, wrap = wrapRef.current
    if (!cv || !wrap) return
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    const W = wrap.clientWidth, H = wrap.clientHeight
    const bw = Math.round(W * dpr), bh = Math.round(H * dpr)
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh }
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)

    const S = Math.min(W, H) * 0.94, cx = W / 2, cy = H / 2
    const { scale, tx, ty } = view
    ctx.save()
    ctx.translate(cx + tx, cy + ty)
    ctx.scale(scale, scale)
    ctx.translate(-S / 2, -S / 2)

    if (imgRef.current) ctx.drawImage(imgRef.current, 0, 0, S, S)
    else { ctx.fillStyle = '#0c1016'; ctx.fillRect(0, 0, S, S) }

    if (mode !== 'match') {
      if (heatRef.current) {
        ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.imageSmoothingEnabled = true
        ctx.drawImage(heatRef.current, 0, 0, S, S); ctx.restore()
      }
      if (markersRef.current) {
        ctx.imageSmoothingEnabled = true
        ctx.drawImage(markersRef.current, 0, 0, S, S)
      }
    } else if (journeys) {
      const groupsOn = (code) => { const g = GROUP_OF_CODE[code]; return g && visibleGroups.has(g.id) }
      const prog = progressOverride ?? playback.progress
      journeys.players.forEach((pl) => {
        const col = pl.bot ? COLORS.bot : COLORS.human
        const P = pl.pts, N = P.length
        let headTs = pl.tmax
        if (N >= 2) {
          const f = prog * (N - 1)
          const hi = Math.min(N - 1, Math.floor(f)), frac = f - hi, nx = Math.min(N - 1, hi + 1)
          const hx = lerp(P[hi][0], P[nx][0], frac), hy = lerp(P[hi][1], P[nx][1], frac)
          headTs = lerp(P[hi][2], P[nx][2], frac)
          const trail = []
          for (let i = 0; i <= hi; i++) trail.push([P[i][0] * S, P[i][1] * S])
          trail.push([hx * S, hy * S])
          if (trail.length > 1) {
            tracePath(ctx, trail)
            ctx.lineWidth = (pl.bot ? 2.4 : 3.6) / scale
            ctx.strokeStyle = col; ctx.globalAlpha = pl.bot ? 0.5 : 0.85
            ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); ctx.globalAlpha = 1
          }
          const HX = hx * S, HY = hy * S, rr = (pl.bot ? 5 : 7) / scale
          ctx.globalAlpha = 0.18; ctx.fillStyle = col
          ctx.beginPath(); ctx.arc(HX, HY, rr * 2.1, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1
          ctx.beginPath(); ctx.arc(HX, HY, rr, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill()
          ctx.lineWidth = 2 / scale; ctx.strokeStyle = 'rgba(5,8,12,0.9)'; ctx.stroke()
        } else if (N === 1) {
          headTs = pl.tmin + (pl.tmax - pl.tmin) * prog
          ctx.beginPath(); ctx.arc(P[0][0] * S, P[0][1] * S, (pl.bot ? 5 : 7) / scale, 0, Math.PI * 2)
          ctx.fillStyle = col; ctx.fill()
        } else {
          headTs = pl.tmin + (pl.tmax - pl.tmin) * prog
        }
        pl.events.forEach((q) => {
          if (q[2] <= headTs && groupsOn(q[3])) drawMarker(ctx, q[3], q[0] * S, q[1] * S, 9 / scale)
        })
      })
    }
    ctx.restore()
  }, [view, mode, journeys, playback.progress, visibleGroups])

  useEffect(() => { redrawRef.current = redraw; redraw() }, [redraw])

  // ---- bake heatmap layer (separate, drawn with 'screen') ----
  useEffect(() => {
    if (mode === 'match' || !heatMetric) { heatRef.current = null; redrawRef.current(); return }
    const metric = HEAT_METRICS.find((h) => h.id === heatMetric)
    const codes = new Set(metric.codes)
    const { u, v, e } = data
    const HM = 480, radius = 13
    const acc = new Float32Array(HM * HM)
    for (const i of filtered) {
      if (!codes.has(e[i])) continue
      const cx = u[i] * HM, cy = v[i] * HM
      const x0 = Math.max(0, (cx - radius) | 0), x1 = Math.min(HM - 1, (cx + radius) | 0)
      const y0 = Math.max(0, (cy - radius) | 0), y1 = Math.min(HM - 1, (cy + radius) | 0)
      for (let y = y0; y <= y1; y++) {
        const dy = y - cy
        for (let x = x0; x <= x1; x++) {
          const dx = x - cx, d2 = dx * dx + dy * dy
          if (d2 > radius * radius) continue
          acc[y * HM + x] += Math.exp(-d2 / (2 * (radius / 2.2) * (radius / 2.2)))
        }
      }
    }
    let max = 0
    for (let i = 0; i < acc.length; i++) if (acc[i] > max) max = acc[i]
    const off = document.createElement('canvas'); off.width = HM; off.height = HM
    const octx = off.getContext('2d', { willReadFrequently: true })
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
    redrawRef.current()
  }, [mode, filtered, heatMetric, data])

  // ---- bake marker layer (separate, drawn 'source-over') ----
  useEffect(() => {
    if (mode === 'match') { markersRef.current = null; redrawRef.current(); return }
    const off = document.createElement('canvas'); off.width = LAYER; off.height = LAYER
    const octx = off.getContext('2d', { willReadFrequently: true })
    const groupsOn = (code) => { const g = GROUP_OF_CODE[code]; return g && visibleGroups.has(g.id) }
    const { u, v, e, b } = data
    const r = LAYER * 0.0044
    for (const i of filtered) {
      if (!groupsOn(e[i])) continue
      if (e[i] === EVENT.Position || e[i] === EVENT.BotPosition) {
        octx.fillStyle = b[i] ? COLORS.bot : COLORS.human
        octx.globalAlpha = 0.28
        octx.fillRect(u[i] * LAYER - 1.5, v[i] * LAYER - 1.5, 3, 3)
        octx.globalAlpha = 1
      } else {
        drawMarker(octx, e[i], u[i] * LAYER, v[i] * LAYER, r)
      }
    }
    markersRef.current = off
    redrawRef.current()
  }, [mode, filtered, visibleGroups, data])

  // size to box
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => redrawRef.current())
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  // recover from a dropped context instead of going black
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const onLost = (e) => e.preventDefault()
    const onRestored = () => redrawRef.current()
    cv.addEventListener('contextlost', onLost)
    cv.addEventListener('contextrestored', onRestored)
    return () => { cv.removeEventListener('contextlost', onLost); cv.removeEventListener('contextrestored', onRestored) }
  }, [])

  // wheel zoom (non-passive) + pan
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const handler = (ev) => {
      ev.preventDefault()
      const rect = wrap.getBoundingClientRect()
      const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top
      setView((vw) => {
        const { S, cx, cy } = layout()
        const ns = Math.max(1, Math.min(8, vw.scale * (ev.deltaY < 0 ? 1.15 : 1 / 1.15)))
        const X = (sx - cx - vw.tx) / vw.scale + S / 2
        const Y = (sy - cy - vw.ty) / vw.scale + S / 2
        return clampView({ scale: ns, tx: sx - cx - ns * (X - S / 2), ty: sy - cy - ns * (Y - S / 2) })
      })
    }
    wrap.addEventListener('wheel', handler, { passive: false })
    return () => wrap.removeEventListener('wheel', handler)
  }, [clampView])

  const onPointerDown = (ev) => { drag.current = { x: ev.clientX, y: ev.clientY, tx: view.tx, ty: view.ty }; ev.target.setPointerCapture(ev.pointerId) }
  const onPointerMove = (ev) => {
    if (!drag.current) return
    setView((vw) => clampView({ ...vw, tx: drag.current.tx + (ev.clientX - drag.current.x), ty: drag.current.ty + (ev.clientY - drag.current.y) }))
  }
  const onPointerUp = () => { drag.current = null }
  const zoomBy = (k) => setView((v) => clampView({ ...v, scale: Math.max(1, Math.min(8, v.scale * k)) }))
  const resetView = () => setView({ scale: 1, tx: 0, ty: 0 })

  return (
    <div className="stage" ref={wrapRef}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
      <canvas ref={canvasRef} className="overlay" />
      <div className="zoom-tools">
        <button onClick={() => zoomBy(1.3)}>+</button>
        <button onClick={() => zoomBy(1 / 1.3)}>−</button>
        <button onClick={resetView} title="Reset view">⊙</button>
      </div>
      <div className="zoom-readout">{Math.round(view.scale * 100)}%</div>
    </div>
  )
}
