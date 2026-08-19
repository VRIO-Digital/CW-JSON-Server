import React from 'react'
import { ProvMark } from '../Primitives.jsx'

/* ───────────────────────────────────────────────────────────── NARRATIVE ──
   Analytical prose that belongs to the report rather than to a figure. On the
   variance report this is "Why underspend is not good news", which is a FINDING
   and not meta-commentary — the trailing commentary blocks ("What was not
   found", "Reading this", "What we have not asked") were dropped from these
   pages; this one stays because it is an argument about what the numbers mean.

   RENDERED FROM `parts`, NOT FROM `body`. The prototype injected `b.body` as
   markup, which was safe there because the resolver composed it — but the same
   payload carries `parts`, an array of `{text}` and `{token, figure}`, and a
   figure interpolated into a sentence is a figure like any other: it keeps its
   own provenance handle. Reading the structured form gets the markers back and
   costs no round trip. `body` stays as the fallback for a narrative the resolver
   served flat.
   ========================================================================== */
export default function Narrative({ block: b }) {
  const parts = b.parts || []

  return (
    <>
      <div className="para" style={{ fontSize: '12.5px', lineHeight: 1.7 }}>
        {parts.length
          ? parts.map((pt, i) => pt.token
            ? (
              <span className="hdTok" key={i}>
                {(pt.figure || {}).display == null ? '—' : pt.figure.display}
                <ProvMark measure={(pt.figure || {}).measure}
                          label={(pt.figure || {}).label || pt.token} />
              </span>
            )
            : <React.Fragment key={i}>{pt.text || ''}</React.Fragment>)
          : (b.body || '')}
      </div>

      {/* A token the resolver could not bind is named rather than silently left
          as a gap in a sentence — a paragraph with a hole in it reads as a
          rendering fault, and this is a binding fact worth stating. */}
      {(b.unbound || []).length ? (
        <div className="mini" style={{ marginTop: 9 }}>
          Unbound in this reading: {b.unbound.join(', ')}. {b.unboundNote || ''}
        </div>
      ) : null}

      {(b.cites || []).length ? (
        <div className="mini" style={{ marginTop: 7 }}>
          Cites {b.cites.map(c => (typeof c === 'string' ? c : c.label)).join(' · ')}
        </div>
      ) : null}
    </>
  )
}
