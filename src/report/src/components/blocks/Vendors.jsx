import React from 'react'
import { Masked } from '../Primitives.jsx'

/* ─────────────────────────────────────────────────────────────── VENDORS ──
   Commitment exposure by contractor, built from the contract packages rather than
   declared on the project — and the block says which, because the two do not
   always agree and the reconciliation line is where that shows.

   `unbacked` is a real population and not an error state: a contractor named on
   the project with no package behind it is a fact about the data, and dropping
   those rows would make the roll-up look complete when it is not.
   ========================================================================== */
export default function Vendors({ block: b }) {
  if (b.empty) return <div className="mini">{b.why || 'No vendors on this project.'}</div>

  const Cell = ({ c }) => c && c.masked
    ? <Masked reason={c.maskReason} />
    : <span title={(c && c.exact) || undefined}>{(c || {}).display || '——'}</span>

  const rec = b.reconciliation || {}

  return (
    <>
      <div className="tblWrap vnWrap">
        <table className="tbl vnT">
          <thead>
            <tr>
              <th>Contractor</th>
              <th className="num">Packages</th>
              <th className="num">Awarded</th>
              <th className="num">Approved change orders</th>
              <th className="num">Committed</th>
            </tr>
          </thead>
          <tbody>
            {(b.rows || []).map((r, i) => (
              <tr key={i}>
                <td>
                  <Cell c={r.vendor} />
                  {(r.packageNos || []).length ? (
                    <div className="vnPk mono">{r.packageNos.join(' · ')}</div>
                  ) : null}
                </td>
                <td className="num"><Cell c={r.packages} /></td>
                <td className="num"><Cell c={r.awarded} /></td>
                <td className={'num ' + ((r.changeOrders || {}).raw > 0 ? 'neg'
                  : (r.changeOrders || {}).raw < 0 ? 'pos' : '')}>
                  <Cell c={r.changeOrders} />
                  <span className="vnCoN">{(r.changeOrderCount || {}).display || ''}</span>
                </td>
                <td className="num"><b><Cell c={r.committed} /></b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {b.masked && b.maskNote ? <div className="vnMask">{b.maskNote}</div> : null}

      {(b.unbacked || []).length ? (
        <div className="vnUn">
          <div className="vnUnT">
            {b.unbacked.map((u, i) => <span className="chip" key={i}><Cell c={u.vendor} /></span>)}
          </div>
          <div className="vnUnW">{b.unbackedNote || ''}</div>
        </div>
      ) : null}

      <div className="vnBasis">
        <div><b>How this is built.</b> {(b.basis || {}).rule || ''}</div>
        <div>{(b.basis || {}).why || ''}</div>
        <div className="vnExt">{(b.basis || {}).extraction || ''}</div>
        {rec.declared ? (
          <div className={'vnRec ' + (rec.agrees === false ? 'off' : '')}>
            Contract roll-up {(rec.total || {}).display || ''} · project commitment{' '}
            {(rec.declared || {}).display || ''}{rec.note ? ' — ' + rec.note : ''}
          </div>
        ) : null}
      </div>
    </>
  )
}
