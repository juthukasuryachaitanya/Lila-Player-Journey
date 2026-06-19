import { EVENT_GROUPS, HEAT_METRICS, COLORS, prettyDay, fmt } from './data.js'

function Segment({ options, value, onChange }) {
  return (
    <div className="segment">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export default function Controls({
  manifest, mapId, setMapId, dayFilter, setDayFilter,
  matchId, setMatchId, matches, visibleGroups, toggleGroup,
  showHumans, setShowHumans, showBots, setShowBots, heatMetric, setHeatMetric,
}) {
  return (
    <aside className="rail">
      <div className="brand">
        <span className="dot" />
        <div>
          <div className="brand-title">LILA BLACK</div>
          <div className="brand-sub">Journey Console</div>
        </div>
      </div>

      <section className="ctrl">
        <label className="ctrl-label">Map</label>
        <div className="map-pills">
          {Object.keys(manifest.maps).map((m) => (
            <button key={m} className={`map-pill ${mapId === m ? 'on' : ''}`} onClick={() => setMapId(m)}>
              {m.replace(/([A-Z])/g, ' $1').trim()}
              <span className="map-pill-n">{fmt(manifest.stats.perMap[m])}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="ctrl">
        <label className="ctrl-label">Day</label>
        <select value={dayFilter} onChange={(e) => setDayFilter(e.target.value)}>
          <option value="all">All 5 days</option>
          {manifest.days.map((d) => <option key={d} value={d}>{prettyDay(d)}</option>)}
        </select>
      </section>

      <section className="ctrl">
        <label className="ctrl-label">Match {matchId !== 'all' && <span className="tag-live">playback ready</span>}</label>
        <select value={matchId} onChange={(e) => setMatchId(e.target.value)}>
          <option value="all">All matches ({matches.length})</option>
          {matches.map((m) => (
            <option key={m.id} value={m.id}>
              {m.shortId} · {m.humans}H/{m.bots}B · {m.rows} ev
            </option>
          ))}
        </select>
        {matchId === 'all'
          ? <p className="hint">Pick a match to draw player journeys and scrub the timeline.</p>
          : <p className="hint">Showing one match. Switch back to <b>All matches</b> for heatmaps.</p>}
      </section>

      <section className="ctrl">
        <label className="ctrl-label">Actors</label>
        <div className="toggle-row">
          <button className={`chip ${showHumans ? 'on' : ''}`} style={{ '--c': COLORS.human }} onClick={() => setShowHumans(!showHumans)}>
            <span className="swatch" /> Humans
          </button>
          <button className={`chip ${showBots ? 'on' : ''}`} style={{ '--c': COLORS.bot }} onClick={() => setShowBots(!showBots)}>
            <span className="swatch" /> Bots
          </button>
        </div>
      </section>

      <section className="ctrl">
        <label className="ctrl-label">Events</label>
        <div className="event-grid">
          {EVENT_GROUPS.map((g) => (
            <button key={g.id} className={`chip ${visibleGroups.has(g.id) ? 'on' : ''}`} style={{ '--c': g.color }} onClick={() => toggleGroup(g.id)}>
              <span className="swatch" /> {g.label}
            </button>
          ))}
        </div>
      </section>

      <section className="ctrl">
        <label className="ctrl-label">Heatmap</label>
        <div className="heat-grid">
          <button className={`heat-pill ${!heatMetric ? 'on' : ''}`} onClick={() => setHeatMetric(null)}>Off</button>
          {HEAT_METRICS.map((h) => (
            <button key={h.id} className={`heat-pill ${heatMetric === h.id ? 'on' : ''}`} onClick={() => setHeatMetric(h.id)}>
              {h.label}
            </button>
          ))}
        </div>
        <p className="hint">Density of the selected actors + day, blurred over the map.</p>
      </section>
    </aside>
  )
}
