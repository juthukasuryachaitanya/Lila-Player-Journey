import { EVENT_GROUPS, GROUP_OF_CODE, fmt } from './data.js'

export default function Inspector({ mapId, dayFilter, matchId, statsCounts, matchMeta, matchRecord }) {
  // roll up per-event counts into group totals
  const groupTotals = {}
  let total = 0
  for (const [code, n] of Object.entries(statsCounts || {})) {
    const g = GROUP_OF_CODE[code]
    if (!g) continue
    groupTotals[g.id] = (groupTotals[g.id] || 0) + n
    total += n
  }

  return (
    <aside className="inspector">
      <div className="insp-head">
        <div className="insp-title">{mapId.replace(/([A-Z])/g, ' $1').trim()}</div>
        <div className="insp-scope">
          {dayFilter === 'all' ? 'All days' : dayFilter.replace('_', ' ')}
          {matchId !== 'all' ? ' · single match' : ' · all matches'}
        </div>
      </div>

      <div className="insp-total">
        <span className="big">{fmt(total)}</span>
        <span className="big-label">events in view</span>
      </div>

      <div className="insp-bars">
        {EVENT_GROUPS.map((g) => {
          const n = groupTotals[g.id] || 0
          const w = total ? Math.max(2, (n / total) * 100) : 0
          return (
            <div className="bar-row" key={g.id}>
              <div className="bar-head">
                <span className="bar-label" style={{ color: g.color }}>{g.label}</span>
                <span className="bar-n">{fmt(n)}</span>
              </div>
              <span className="bar-track"><span className="bar-fill" style={{ width: `${w}%`, background: g.color }} /></span>
            </div>
          )
        })}
      </div>

      {matchRecord && (
        <div className="insp-match">
          <div className="insp-sub">Match {matchRecord.shortId}</div>
          <dl className="kv">
            <div><dt>Day</dt><dd>{matchRecord.day.replace('_', ' ')}</dd></div>
            <div><dt>Humans</dt><dd>{matchRecord.humans}</dd></div>
            <div><dt>Bots</dt><dd>{matchRecord.bots}</dd></div>
            <div><dt>Kills</dt><dd>{matchRecord.kills}</dd></div>
            <div><dt>Deaths</dt><dd>{matchRecord.deaths}</dd></div>
            <div><dt>Loot</dt><dd>{matchRecord.loot}</dd></div>
          </dl>
        </div>
      )}

      <div className="insp-foot">
        <span>Drag to pan · scroll to zoom</span>
      </div>
    </aside>
  )
}
