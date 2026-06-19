import { EVENT_NAME } from './data.js'

export default function Timeline({ active, playback, setPlayback, matchMeta }) {
  if (!active) {
    return (
      <div className="timeline disabled">
        <span className="tl-hint">Select a single match to replay its timeline.</span>
      </div>
    )
  }
  const { playing, progress, speed } = playback
  const pct = Math.round(progress * 100)

  const toggle = () => setPlayback((p) => ({
    ...p, playing: !p.playing, progress: p.progress >= 1 && !p.playing ? 0 : p.progress,
  }))
  const restart = () => setPlayback((p) => ({ ...p, progress: 0, playing: true }))
  const setSpeed = (s) => setPlayback((p) => ({ ...p, speed: s }))

  return (
    <div className="timeline">
      <button className="tl-btn primary" onClick={toggle}>{playing ? '❚❚' : '▶'}</button>
      <button className="tl-btn" onClick={restart} title="Restart">↺</button>
      <input
        className="scrubber" type="range" min={0} max={1000} value={Math.round(progress * 1000)}
        onChange={(e) => setPlayback((p) => ({ ...p, playing: false, progress: e.target.value / 1000 }))}
      />
      <span className="tl-pct">{pct}%</span>
      <div className="tl-speed">
        {[0.5, 1, 2, 4].map((s) => (
          <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>{s}x</button>
        ))}
      </div>
      {matchMeta && (
        <span className="tl-meta">
          {matchMeta.players.length} actors · sequence-ordered (ts spans &lt;1s, normalized)
        </span>
      )}
    </div>
  )
}
