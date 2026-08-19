import React from 'react'
import { ProvMark, Masked } from '../Primitives.jsx'

/* ─────────────────────────────────────────────────────────── VALUE CHAIN ──
   Where the money sits: budget → authorization → commitment → actual → CWIP →
   capitalized → rate base.

   A BAR OR A STATED ABSENCE, NEVER A ZERO-HEIGHT BAR. A stage with no readable
   number gets no `<i>` at all and carries `.absent` or `.maskedStage`, which the
   stylesheet draws as a hatched well — because an empty bar column and a bar for
   $0 look identical on screen and mean opposite things. Three of the seven links
   on this fixture are genuinely absent: `cwip`, `capitalized` and `rateBase` are
   null on all sixty projects, and the block says so rather than drawing zero.

   The label under the value is the source system's NAME, never its `tag` — the
   tag is a CSS class token, and an earlier build printed it on screen as if it
   were a word.
   ========================================================================== */
export default function Chain({ block: b }) {
  return (
    <>
      <div className="chain">
        {(b.stages || []).map((s, i) => {
          const drawable = typeof s.pct === 'number' && !s.masked && !s.absent
          return (
            <div className={'chainStep ' + (s.cls || '') + ' ' + (s.state || '')}
                 key={s.label || i} title={s.def || ''}>
              <div className={'cBar' + (drawable ? '' : ' cBarNone')}>
                {drawable ? <i style={{ height: s.pct + '%' }} /> : null}
              </div>
              <div className="cV">
                {s.masked ? <Masked reason={s.maskReason} /> : s.display}
                {s.prov ? <ProvMark measure={s.measure} label={s.label} /> : null}
              </div>
              <div className="cK">
                {s.label}
                {s.source ? <span className="cSrc">{s.source.name}</span> : null}
              </div>
              {!drawable && s.why ? <div className="cWhy">{s.why}</div> : null}
            </div>
          )
        })}
      </div>
      {b.scaleNote ? <div className="chainScale">{b.scaleNote}</div> : null}
    </>
  )
}
