import React from 'react'
import { Masked } from '../Primitives.jsx'

/* ─────────────────────────────────────────────────────────────── HEATMAP ──
   Variance across two dimensions, with the row, column and grand totals served
   rather than summed here.

   CLOSURE IS THE POINT OF THE BLOCK. `closes === false` gets a warning band, not
   a footnote: a grid that says it foots to its declared total and does not is the
   single failure this block type exists to surface. When it does close, the
   confirmation prints too — the reader learning the cells agree with the total is
   the block working.

   The colour intensity is geometry over `raw` against the served
   `extremeMagnitude`. The two hues are fixed rather than themed because they
   carry the sign, and a diverging scale whose ends swap under a theme change is
   a scale that means two things.
   ========================================================================== */
export default function Heatmap({ block: b }) {
  const ext = b.extremeMagnitude || 1
  const rt = k => (b.rowTotals || []).filter(x => x.row === k)[0]
  const ct = k => (b.colTotals || []).filter(x => x.col === k)[0]

  const Cell = ({ c }) => {
    if (!c) return <td className="hmCell" />
    if (c.masked) return (
      <td className="hmCell">
        <Masked reason={c.maskReason || 'masked by your data access'} />
      </td>
    )
    const t = Math.min(1, Math.abs(c.raw) / ext)
    const col = c.side === 'neg' ? '52,211,153' : '248,113,113'
    return (
      <td className="hmCell"
          style={{ background: `rgba(${col},${(t * 0.55).toFixed(3)})` }}
          title={`${c.row} · ${c.col} — ${c.exact || c.display} ${c.sideLabel || ''}`}>
        {c.display}
      </td>
    )
  }

  return (
    <>
      <div className="tblWrap">
        <table className="tbl hm">
          <tbody>
            <tr>
              <th />
              {(b.cols || []).map(c => <th className="hmH" key={c}>{c}</th>)}
              <th className="hmH tot">Total</th>
            </tr>
            {(b.rows || []).map((r, i) => (
              <tr key={r}>
                <th className="hmR">{r}</th>
                {((b.cells || [])[i] || []).map((c, j) => <Cell c={c} key={j} />)}
                <td className="hmCell tot">{(rt(r) || {}).display || ''}</td>
              </tr>
            ))}
            <tr className="hmFoot">
              <th className="hmR">Total</th>
              {(b.cols || []).map(c => (
                <td className="hmCell tot" key={c}>{(ct(c) || {}).display || ''}</td>
              ))}
              <td className="hmCell tot grand" title={(b.total || {}).exact || ''}>
                {(b.total || {}).display || ''}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="hmLeg">
        <span><i style={{ background: 'rgba(52,211,153,.5)' }} />
          {(b.scale || {}).negLabel || 'under'}</span>
        <span><i className="mid" />at the midpoint the scale declares</span>
        <span><i style={{ background: 'rgba(248,113,113,.5)' }} />
          {(b.scale || {}).posLabel || 'over'}</span>
        <span className="hmU">{b.coordStated || ''}</span>
      </div>

      {b.closes === false ? (
        <div className="note warn" style={{ marginTop: 11 }}><span>⚠</span><div className="body">
          <b>The cells do not sum to the declared total.</b>{b.closureNote || ''}
        </div></div>
      ) : b.closureNote ? (
        <div className="hmClose">✓ {b.closureNote}</div>
      ) : null}

      {b.reading ? <div className="hmRead">{b.reading}</div> : null}
      {b.unitNote ? <div className="mini" style={{ marginTop: 8 }}>{b.unitNote}</div> : null}
    </>
  )
}
