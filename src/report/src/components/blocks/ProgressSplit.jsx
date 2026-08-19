import React from 'react'
import { ProvMark, Masked, Note } from '../Primitives.jsx'

/* ─────────────────────────────────────────────────── COST vs PHYSICAL ──
   Three figures that are not interchangeable: two are measured, one is an
   expression over two others, and the expression STATES WHAT IT READ. A derived
   figure that looks like a measured one is a figure somebody will go looking for
   in a source system.

   The divergence keeps its sign — cost can run either side of physical, so the
   sign is carrying information — and the sentence under it names the direction in
   words, so the sign is never the only cue.
   ========================================================================== */
export default function ProgressSplit({ block: b }) {
  const Fig = ({ f, cls }) => (
    <div className={'fig ' + (cls || '')}>
      <div className="figV">
        {f.masked ? <Masked reason={f.maskReason} />
          : f.error ? <span title={f.error} style={{ color: 'var(--red)' }}>⚠</span>
          : f.display}
        {f.pv ? <ProvMark measure={f.measure} label={f.label || f.measureLabel} /> : null}
      </div>
      <div className="figK">
        {f.label}
        {f.coordStated ? <span className="figC">{f.coordStated}</span> : null}
      </div>
    </div>
  )

  const d = b.costAheadOfPhysical || null
  const ahead = d && d.raw > 0

  return (
    <>
      <div className="figRow">
        {b.left ? <Fig f={b.left} /> : null}
        {b.right ? <Fig f={b.right} /> : null}
        {b.cost ? <Fig f={b.cost} cls="derived" /> : null}
        {d ? (
          <div className={'fig ' + (d.signal ? 'sig' : '')}>
            <div className="figV">{d.display}</div>
            <div className="figK">Cost {ahead ? 'ahead of' : 'behind'} physical</div>
          </div>
        ) : null}
      </div>

      {b.cost && b.cost.expr ? (
        <div className="figExpr">
          Cost progress is <code>{b.cost.expr}</code>
          {(b.cost.reads || []).length
            ? ' — computed here from ' + b.cost.reads.join(' and ') + ', not read from a field'
            : ''}.
        </div>
      ) : null}

      {d ? (
        <Note kind={d.signal ? 'warn' : 'plain'} glyph={d.signal ? '⚠' : 'ⓘ'}
              style={{ marginTop: 14 }}
              title={`Cost is running ${d.display} ${ahead ? 'ahead of' : 'behind'} physical progress`}>
          {b.signalNote || ''}
          {d.signal ? '' : ' Below the threshold that would raise a signal on this project.'}
        </Note>
      ) : null}
    </>
  )
}
