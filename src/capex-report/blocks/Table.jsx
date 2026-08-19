import React from 'react'
import { Masked, ProvMark } from '../Primitives.jsx'
import { Unknown, Empty } from './BlockFrame.jsx'
import { useReportState } from '../ReportState.jsx'
import { signCell } from '../format.js'

/* ─────────────────────────────────────────────────────────── TABLE / PIVOT ──
   Not on any of the three published pages — their tabular exhibits are
   `varianceRows`, `vendors`, `lineItems` and `filingCalendar`, each of which
   carries structure a generic table cannot. It is here because `table` and
   `pivot` are live block types in the spec vocabulary and a report that added one
   should render it rather than fall through to "unsupported": a silently dropped
   block is a wrong report that looks right.

   NO LINEAGE MARKER ON EVERY CELL. A table of forty numbers with forty markers is
   unreadable, and the row is already reachable from the column header's definition
   and the drawer's measure glossary. The marker stays on the TOTALS row, which is
   the number people quote.

   The drill-down is absent rather than inert: it re-resolves the same spec at
   project grain under the same predicate, which needs the resolver.
   ========================================================================== */
export default function Table({ block: b }) {
  const { linDispatch } = useReportState()
  if (!b.columns) return <Unknown block={b} />
  if (!b.rows.length) return (
    <Empty>
      Nothing here that your data access lets you see. That is an answer, not an error — the section
      ran and came back empty for you.
    </Empty>
  )

  const numeric = b.columns.map(c => c.numeric)
  const hasBars = b.rows.some(r => r.bar != null)

  /* ◇ marks a column recomputed from the underlying rows rather than averaged
     down the column. Non-additivity is a property of the measure, not of the
     caller, and this is where the reader is told. */
  return (
    <>
      {/* .tblWrap so a wide table scrolls inside its own block instead of
          stretching the grid column it sits in and dragging every other block
          wider with it. */}
      <div className="tblWrap">
        <table className="tbl">
          <tbody>
            <tr>
              {b.columns.map(c => (
                <th key={c.key}
                    style={c.numeric ? { textAlign: 'right' } : undefined}
                    className={c.def ? 'rowlink' : undefined}
                    title={c.def ? c.def + ' — click for the full definition' : undefined}
                    onClick={c.def
                      ? () => linDispatch({ type: 'measure', key: c.key, label: c.label })
                      : undefined}>
                  {c.label}
                  {c.additive === false ? <span style={{ color: 'var(--purple)' }}> ◇</span> : null}
                </th>
              ))}
              {hasBars ? <th className="barCell" /> : null}
            </tr>

            {b.rows.map((r, ri) => (
              <tr className="projRow" key={r.key || ri}>
                {r.cells.map((c, i) => <Cell c={c} numeric={numeric[i]} key={i} />)}
                {r.bar != null ? (
                  <td className="barCell">
                    <div className="miniBar">
                      <i className={barClass(r, b)} style={{ width: r.bar + '%' }} />
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}

            {b.totalsRow ? (
              <tr style={{ borderTop: '2px solid var(--line2)' }}>
                {b.totalsRow.cells.map((c, i) => (
                  <Cell c={c} numeric={numeric[i]} isTotal key={i} />
                ))}
                {hasBars ? <td /> : null}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {b.totalsRow && b.columns.some(c => c.additive === false) ? (
        <div className="mini" style={{ marginTop: 9 }}>
          ◇ is recomputed from the underlying rows, not averaged down the column —{' '}
          <button className="tinyBtn"
                  onClick={() => linDispatch({ type: 'section', section: 'transforms' })}>
            why these differ
          </button>
        </div>
      ) : null}
    </>
  )
}

function Cell({ c, numeric, isTotal }) {
  if (c.masked) return (
    <td className={numeric ? 'num' : undefined}
        style={numeric ? { textAlign: 'right' } : undefined}
        title={c.maskReason}>
      <Masked reason={c.maskReason} />
    </td>
  )
  return (
    <td className={(numeric ? 'num' : '') + signCell(c)}
        style={numeric ? { textAlign: 'right' } : undefined}>
      {isTotal ? <b>{c.display}</b> : c.display}
      {isTotal && c.prov ? <ProvMark measure={c.measure} label={c.label} /> : null}
    </td>
  )
}

/* The bar takes its colour from the sign of the variance column, if the table has
   one. Red for over, green for under — and no class at all when the table has no
   variance to colour by, rather than a default that would look like a judgement. */
function barClass(r, b) {
  const vi = b.columns.findIndex(c => c.key === 'variance' || c.key === 'variancePct')
  if (vi < 0) return ''
  const c = r.cells[vi]
  if (!c || c.value == null) return ''
  return c.value > 0 ? 'bad' : 'ok'
}
