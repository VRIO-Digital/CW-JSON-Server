import React from 'react'
import { ProvMark, Masked } from '../Primitives.jsx'

/* ──────────────────────────────────────────────────────────────── FIG ROW ──
   The headline strip. Every figure carries its coordinate and its own lineage
   marker, because two figures in one row can come from different systems
   through different joins and a single report-level handle would have to pick
   one of them and call it the answer.
   ========================================================================== */
export default function FigRow({ block: b }) {
  const figs = b.figures || []

  /* Five grey tiles in a row is a lot of ink for one fact. When the scope masks
     EVERY figure in the strip, say the fact once and name the figures — the
     reader learns exactly what is being withheld, which is the point of showing
     a masked figure at all, without the strip pretending to be a strip. Any
     figure surviving and the tiles stay, because then the row is still a
     comparison and the grey ones carry their own meaning. */
  if (figs.length > 1 && figs.every(f => f.masked)) {
    return (
      <div className="figMaskAll">
        <span className="masked">masked</span>
        <div>
          <b>{figs.map(f => f.key).join(' · ')}</b>
          <div className="mini">
            {figs[0].maskReason || 'Masked by your data access'}. The section ran — these figures
            exist and are not yours to see. That is a different answer from no data.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="figRow">
      {figs.map((f, i) => (
        <div className="fig" key={f.key || i}>
          <div className="figV">
            {f.masked ? <Masked reason={f.maskReason} />
              : f.error ? <span title={f.error} style={{ color: 'var(--red)' }}>⚠</span>
              : f.display}
            <ProvMark measure={f.measure} label={f.measureLabel} />
          </div>
          <div className="figK">
            {f.key}
            {f.nonAdditive ? (
              <span className="pill neu" title="Recomputed at this grain, never summed">
                {f.scopeClass}</span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}
