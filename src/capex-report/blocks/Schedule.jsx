import React from 'react'
import { ProvMark, Note } from '../Primitives.jsx'

/* ────────────────────────────────────────────────────────────── SCHEDULE ──
   Planned against forecast in-service, and the slip between them.

   The variance arrives signed and pre-formatted ("+1 mo"); the direction is ALSO
   stated in words, because a reader scanning a column of dates should not have to
   decode a plus sign to learn that the plant lands late.
   ========================================================================== */
export default function Schedule({ block: b }) {
  const Dt = ({ f, label }) => (
    <div className="fig">
      <div className="figV">{f && f.display != null ? f.display : '—'}</div>
      <div className="figK">{label}</div>
    </div>
  )

  const v = b.variance || null
  const late = v && v.raw > 0
  const onTime = v && v.raw === 0

  return (
    <>
      <div className="figRow">
        <Dt f={b.planned} label="Planned in-service" />
        <Dt f={b.forecast} label="Forecast in-service" />
        {v ? (
          <div className={'fig ' + (onTime ? '' : late ? 'sig' : 'ok')}>
            <div className="figV">
              {v.display}
              {v.pv ? <ProvMark measure={v.measure} label={v.measureLabel || v.label} /> : null}
            </div>
            <div className="figK">
              {v.label || 'Variance'}
              {v.coordStated ? <span className="figC">{v.coordStated}</span> : null}
            </div>
          </div>
        ) : null}
      </div>

      {v ? (
        <Note kind={onTime ? 'ok' : late ? 'warn' : 'ok'}
              glyph={onTime ? '✓' : late ? '⏳' : '✓'}
              style={{ marginTop: 13 }}
              title={onTime ? 'On the planned date'
                : late ? `In service ${v.display} later than planned`
                : `In service ${v.display} ahead of plan`}>
          {b.note || ''}
        </Note>
      ) : null}
    </>
  )
}
