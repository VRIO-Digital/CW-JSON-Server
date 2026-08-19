import React from 'react'
import { Masked, Note } from '../Primitives.jsx'

/* ────────────────────────────────────────────────────── FILING CALENDAR ──
   Three obligations the block's contract says the renderer must not skip, and all
   three are here because each one, skipped, produces a plausible-looking wrong
   reading:

   (1) `derivedField` marks a column computed on this surface and held by no
       source system. It renders with the rule VISIBLE — a ✦ on the header and the
       derivation spelled out under the table — rather than as an ordinary date,
       because a date that looks like it came from a docket and did not is a date
       somebody will quote back to a commission.

   (2) Any cell carrying `why` renders its reason. Certification lead is tenant
       configuration — five jurisdictions with five different values — and a
       tenant-configured number with its justification hidden is a number nobody
       can dispute. The reason is on the cell as a marker AND in full underneath,
       not only in a tooltip, because a hover is not a disclosure.

   (3) A row with no squeeze window renders its note AS TEXT IN THE ROW. Not an
       empty cell, which reads as missing data, and not a zero, which reads as a
       search that found nothing. The window has zero width because the lead fits
       inside the gap — the check ran and the structure is benign, which is a
       third claim, different from both.
   ========================================================================== */
export default function FilingCalendar({ block: b }) {
  const cols = b.columns || []
  const rows = b.rows || []
  const span = cols.length
  const dv = b.derivedField || null

  const isNumeric = col => ['count', 'days'].indexOf(col.kind) > -1 || col.unit === 'USD'

  const Cell = ({ c, col }) => {
    if (!c) return <td />
    const numeric = isNumeric(col)
    if (c.masked) return (
      <td className={numeric ? 'num' : undefined}
          style={numeric ? { textAlign: 'right' } : undefined}
          title={c.maskReason || ''}>
        <Masked reason={c.maskReason} />
      </td>
    )
    const cls = [
      numeric ? 'num' : '',
      c.highlight === 'risk' ? 'fcRisk' : '',
      c.derived ? 'fcDrv' : '',
      (col.kind === 'days' && typeof c.raw === 'number' && c.raw < 0) ? 'neg' : '',
    ].filter(Boolean).join(' ')
    return (
      <td className={cls} style={numeric ? { textAlign: 'right' } : undefined}>
        {c.display}
        {c.derived ? (
          <span className="fcMk" title="Derived on this surface — see the rule below">✦</span>
        ) : null}
        {c.why ? <span className="fcMk why" title={c.why}>ⓘ</span> : null}
      </td>
    )
  }

  /* Collected from the cells rather than served as a list, because the reason
      belongs to the cell that carries it and a second list in the payload would
      be a second place for it to fall out of step. */
  const whys = []
  rows.forEach(r => (r.cells || []).forEach(c => {
    if (c.why) whys.push({ row: r.jurisdiction, label: c.label, display: c.display, why: c.why })
  }))

  const derivedCol = dv ? (cols.filter(c => c.key === dv.key)[0] || {}) : null

  return (
    <>
      <div className="tblWrap">
        <table className="tbl fc">
          <tbody>
            <tr>
              {cols.map(c => (
                <th key={c.key || c.label}
                    style={isNumeric(c) ? { textAlign: 'right' } : undefined}
                    title={c.note || undefined}>
                  {c.label}
                  {c.derived ? <span className="fcMk">✦</span> : null}
                  {c.hasWhy ? <span className="fcMk why">ⓘ</span> : null}
                </th>
              ))}
            </tr>

            {rows.map((r, ri) => (
              <React.Fragment key={r.jurisdiction || ri}>
                <tr className="fcR">
                  <td className="fcJ" title={(r.entryLabel || '') + ' · ' + (r.recurrence || '')}>
                    {r.jurisdiction}
                  </td>
                  {(r.cells || []).slice(1).map((c, i) => (
                    <Cell c={c} col={cols[i + 1] || {}} key={i} />
                  ))}
                </tr>
                <tr className="fcW">
                  <td colSpan={span}>
                    {(r.window || {}).present ? (
                      <>
                        <span className="fcWin">
                          Squeeze window {r.window.from} → {r.window.to}
                        </span>
                        <span className="fcWt">{r.window.note || ''}</span>
                      </>
                    ) : (
                      <>
                        <span className="fcNoWin">No squeeze window</span>
                        <span className="fcWt">{(r.window || {}).note || ''}</span>
                      </>
                    )}
                  </td>
                </tr>
              </React.Fragment>
            ))}

            {b.total ? (
              <tr className="fcT">
                <td><b>Total</b></td>
                <td colSpan={Math.max(1, span - 4)} className="mini">
                  {b.total.coordStated || ''}
                </td>
                <td className="num" style={{ textAlign: 'right' }}><b>{b.total.atRisk}</b></td>
                <td className="num" style={{ textAlign: 'right' }}>
                  <b>{b.total.deferredDisplay}</b>
                </td>
                <td />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {dv ? (
        <div className="fcRule">
          <span className="fcMk">✦</span>
          <div>
            <b>{(derivedCol.label || dv.key)} is derived here.</b> {dv.rule} {dv.note || ''}
            {dv.from ? <div className="mini">Reads {dv.from.join(' and ')}.</div> : null}
          </div>
        </div>
      ) : null}

      {whys.length ? (
        <div className="fcWhys">
          {whys.map((w, i) => (
            <div className="fcWhy" key={i}>
              <span className="fcWk">{w.row} · {w.label} {w.display}</span>
              {w.why}
            </div>
          ))}
        </div>
      ) : null}

      {(b.windows || {}).note ? (
        <div className="mini" style={{ marginTop: 9 }}>{b.windows.note}</div>
      ) : null}
      {b.total && b.total.whyAdditive ? <div className="mini">{b.total.whyAdditive}</div> : null}

      {/* Not modellable, and the caller is told WHICH FIGURE IS MISSING rather
          than shown a blank. A cost-of-delay number needs a carrying cost the
          dataset does not hold, and naming the gap is what lets somebody go and
          close it. */}
      {b.lagCost && b.lagCost.available === false ? (
        <Note kind="plain" glyph="▤" style={{ marginTop: 11 }} title="No cost-of-delay figure">
          {b.lagCost.why}
          <div className="mini" style={{ marginTop: 5 }}>Needs: {b.lagCost.needs}</div>
        </Note>
      ) : null}
    </>
  )
}
