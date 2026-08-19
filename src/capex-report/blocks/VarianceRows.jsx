import React, { useState } from 'react'
import { Masked } from '../Primitives.jsx'
import { Defect } from './BlockFrame.jsx'
import { asDate, band, signCell } from '../format.js'

/* ────────────────────────────────────────────────────── THE VARIANCE LEDGER ──
   Every project on one list; a row opens IN PLACE onto the change orders that
   moved it and the message each one was read from.

   THREE POPULATIONS, NOT TWO, and the distinction is the whole block. A project
   with change orders behind it, a project with correspondence but no change
   order, and a project nobody wrote anything about are three different findings —
   and a surface that draws the third as an empty expansion invites the reader to
   conclude the extractor failed rather than that nothing was written.

   Numeric where the column names a measure. `c.numeric` is NOT served — the
   resolver emits `measure`, `unit` and `signed`, and reading a field the api does
   not send is how an earlier table renderer ended up left-aligning every dollar
   column in the build. It is derived from what is actually there.
   ========================================================================== */
export default function VarianceRows({ block: b }) {
  const [open, setOpen] = useState({})
  if (b.withheld) return <Defect block={b} />

  const cols = b.columns || []
  const rows = b.rows || []
  const pops = b.populations || []
  const isNum = c => !!(c.measure || c.signed)

  const Cell = ({ c, num }) => {
    if (c.masked) return (
      <td className={(num ? 'num ' : '') + 'vrM'}
          title={c.why || c.maskReason || 'Masked by your data access'}>
        <Masked>{c.display || 'masked'}</Masked>
      </td>
    )
    return (
      <td className={(num ? 'num' : '') + signCell(c)} title={c.absent ? (c.why || '') : undefined}>
        {c.display}
      </td>
    )
  }

  const cueFor = ex => {
    const pop = ex.population || 'silent'
    if (pop === 'silent') return 'nothing written'
    if (pop === 'row-backed') {
      const n = (ex.loose || []).length
      return n + ' message' + (n === 1 ? '' : 's')
    }
    return ex.orderCount + ' change order' + (ex.orderCount === 1 ? '' : 's')
  }

  return (
    <>
      {b.expandNote ? <div className="vrNote">{b.expandNote}</div> : null}

      {pops.length ? (
        <div className="vrPops">
          {pops.map(p => (
            <span className={'vrPop vr-' + p.key} key={p.key}>
              <b>{String(p.count)}</b> {p.label}
            </span>
          ))}
        </div>
      ) : null}

      <div className="tblWrap vrWrap">
        <table className="tbl vrT">
          <thead>
            <tr>
              {cols.map(c => (
                <th className={isNum(c) ? 'num' : ''} key={c.key || c.label} title={c.coordStated || undefined}>
                  {c.label}
                  {c.masked ? <> <span className="pill lo">masked</span></> : null}
                </th>
              ))}
              <th className="vrX" title="Open the change orders raised against this project" />
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map(r => {
              const ex = (b.expansions || {})[r.id] || {}
              const pop = ex.population || 'silent'
              const isOpen = !!open[r.id]
              return (
                <React.Fragment key={r.id}>
                  <tr className={'vrR vr-' + pop + (isOpen ? ' on' : '')}
                      onClick={() => setOpen(o => ({ ...o, [r.id]: !o[r.id] }))}
                      title="Open what moved on this project">
                    {r.cells.map((c, i) => <Cell c={c} num={isNum(cols[i] || {})} key={i} />)}
                    <td className="vrX">
                      <span className="vrCue">{cueFor(ex)}</span>
                      <i className="vrChev">▸</i>
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr className="vrE">
                      <td colSpan={cols.length + 1}><Expansion ex={ex} /></td>
                    </tr>
                  ) : null}
                </React.Fragment>
              )
            }) : (
              <tr>
                <td colSpan={cols.length + 1} className="empty">
                  No project your scope admits varied in this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {b.rank ? (
        <div className="mini vrRank">
          {b.rank.stated || ''}{b.rank.why ? ' — ' + b.rank.why : ''}
        </div>
      ) : null}
      <div className="mini vrPkg">{b.noPackagesNote || ''}</div>
    </>
  )
}

/* The row body. Flat: change order, what it moved, and the message under it.
   Nested cards were tried and abandoned — the reader is comparing the amount a
   contractor claimed against the amount that landed in the forecast, and that
   comparison wants the two on one plane. */
function Expansion({ ex }) {
  return (
    <div className="vrBody">
      {(ex.orders || []).length ? (
        <>
          <div className="vrSum">
            <b>{String(ex.orderCount)}</b> change order{ex.orderCount === 1 ? '' : 's'} moving{' '}
            <b>{(ex.orderMoney || {}).display || ''}</b> ·{' '}
            <span className="dim">
              {String(ex.withMessage)} carr{ex.withMessage === 1 ? 'ies' : 'y'} a message that
              explains it
            </span>
          </div>
          <div className="vrCoL">
            {ex.orders.map((o, i) => <ChangeOrder o={o} key={o.ref || i} />)}
          </div>
        </>
      ) : null}

      {ex.emptyWhy ? <div className="vrEmpty">{ex.emptyWhy}</div> : null}

      {(ex.loose || []).length ? (
        <div className="vrLoose">
          <div className="sectLbl">
            Correspondence about this project, with no change order behind it
          </div>
          {ex.loose.map((e, i) => (
            <Mail e={e} key={i}
                  tag={e.checkableAgainst ? 'checkable against ' + e.checkableAgainst : ''} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

const sgn = f => (!f ? '' : ((f.raw || 0) > 0 ? ' up' : (f.raw || 0) < 0 ? ' dn' : ''))

function ChangeOrder({ o }) {
  return (
    <div className={'vrCo' + (o.status === 'approved' ? '' : ' pend')}>
      <div className="vrCoH">
        <span className="vrCoRef mono">{o.ref || ''}</span>
        <span className={'pill ' + (o.status === 'approved' ? 'hi' : 'md')}>{o.status || ''}</span>
        <span className="vrCoKind">{o.kind || ''}</span>
        <span className="vrCoVend">{(o.contractor || {}).display || ''}</span>
        <span className={'vrCoVal' + sgn(o.value)}>{(o.value || {}).display || ''}</span>
        {(o.days && o.days.raw) ? <span className="vrCoDay">{o.days.display}</span> : null}
        <span className="mono dim vrCoWhen" title="Date the contractor raised it">
          raised {asDate(o.raised)}
        </span>
      </div>
      <div className="vrCoWhy">{o.reason || ''}</div>
      {o.inForecastNote ? <div className="vrWarn">{o.inForecastNote}</div> : null}
      {o.email ? (
        <Mail e={o.email} tag={o.others > 0
          ? '+' + o.others + ' more message' + (o.others === 1 ? '' : 's') + ' on this change order'
          : ''} />
      ) : (
        <div className="vrNoMail">{o.emailAbsentWhy || ''}</div>
      )}
      {o.disagrees ? <div className="vrWarn">{o.disagrees}</div> : null}
    </div>
  )
}

/* THE MESSAGE IS EVIDENCE, SO IT IS SHOWN AS EVIDENCE — who sent it, from which
   side of the contract, when, what the extractor made of it, and how sure it is.
   The confidence is the extractor's own, on the claim that this message says this
   about this subject, and it is on the card rather than in a tooltip because a
   hover is not a disclosure. */
function Mail({ e, tag }) {
  return (
    <div className="vrMail">
      <div className="vrMailH">
        <span className="vrMailTag">{(e.source || {}).name || 'mailbox'}</span>
        <b>{e.from || ''}</b>
        {e.fromOrg ? <span className="dim">{e.fromOrg}</span> : null}
        {e.fromSide ? <em>{e.fromSide}</em> : null}
        <span className="mono dim vrMailWhen">{asDate(e.sentAt)}</span>
        {e.confidence ? (
          <span className={'pill ' + band(e.band)}
                title="How confident the extractor is that this message says this, about this subject">
            {e.confidence.display}
          </span>
        ) : null}
      </div>
      <div className="vrMailSubj mono">{e.subject || ''}</div>
      <div className="vrMailEx">{e.excerpt || ''}</div>
      <div className="vrMailF">
        {e.reasonLabel ? <span className="vrCls">{e.reasonLabel}</span> : null}
        {e.amount ? (
          <span className="mono">
            {e.amount.display}{e.amountBasis ? ' · ' + e.amountBasis : ''}
          </span>
        ) : null}
        {tag ? <span className="dim">{tag}</span> : null}
      </div>
      {e.uncertaintyNote ? <div className="mini">{e.uncertaintyNote}</div> : null}
    </div>
  )
}
