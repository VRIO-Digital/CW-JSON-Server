import React from 'react'
import { ProvMark } from '../Primitives.jsx'

/* ──────────────────────────────────────────────────────────────── HEADER ──
   Two jobs, and the second is the interesting one: when the title is
   parameterised the resolver does not interpolate the value into a string, it
   returns `labelParts` / `subParts` — an array of `{text}` and `{token, figure}` —
   so each substituted value keeps its own provenance handle.

   A project name in a report title is a figure like any other and gets the same
   lineage affordance. Falls back to the flat `label` / `sub` when the header is
   static.
   ========================================================================== */
export default function Header({ block: b }) {
  const Parts = ({ arr, flat }) => (arr && arr.length)
    ? arr.map((pt, i) => pt.token
      ? (
        <span className="hdTok" key={i}>
          {(pt.figure || {}).display == null ? '—' : pt.figure.display}
          <ProvMark measure={(pt.figure || {}).measure}
                    label={(pt.figure || {}).label || pt.token} />
        </span>
      )
      : <React.Fragment key={i}>{pt.text || ''}</React.Fragment>)
    : <>{flat || ''}</>

  const hasSub = (b.subParts && b.subParts.length) || b.sub

  return (
    <div className="hdB">
      <div className="hdL"><Parts arr={b.labelParts} flat={b.label} /></div>
      {hasSub ? <div className="hdS"><Parts arr={b.subParts} flat={b.sub} /></div> : null}
      {b.dynamic ? (
        <div className="hdDyn"
             title="Every substituted value in this heading carries its own lineage">
          resolved per project — the values in this heading are figures, not text
        </div>
      ) : null}
    </div>
  )
}
