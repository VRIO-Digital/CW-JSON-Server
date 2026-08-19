import React from 'react'
import { asDate, band } from '../format.js'
import { Note } from '../Primitives.jsx'

/* ───────────────────────────────────────────────────────────── LINE ITEMS ──
   The project opened into its contract packages, with the change order and the
   message that explains it on the same row.

   TWO NUMBERS ON THIS BLOCK ARE NOT THE SAME KIND OF NUMBER. `Committed now` is
   the award plus its approved change orders and is measured; `Actual · allocated`
   is the project's actual spend spread across its packages by a rule, and it is
   marked `.der` with the rule on the header and in the footer. A derived column
   drawn like a measured one is a column somebody will reconcile against the
   ledger and lose an afternoon to.

   A package with no change order says so in words rather than showing an empty
   expansion: the award value and the committed value are the same number, and
   there is no variance there to explain. That is a third state, distinct from
   "not yet loaded" and from "we found nothing".
   ========================================================================== */
export default function LineItems({ block: b }) {
  if (b.empty) return <div className="empty">{b.why || 'Nothing to show.'}</div>

  return (
    <>
      <div className="liCov">
        <b>{(b.coverage || {}).headline || ''}.</b> {(b.coverage || {}).note || ''}
      </div>

      {b.masked ? (
        <Note kind="plain" glyph="▤" title="Contractor identity withheld">
          {b.maskNote || ''}
        </Note>
      ) : null}

      {(b.groups || []).map((g, i) => <Group g={g} allocation={b.allocation} key={g.projectCode || i} />)}

      <div className="liRules">
        <div><b>Variance, on a line item.</b> {b.varianceNote || ''}</div>
        <div>
          <b>Actual, allocated.</b> {(b.allocation || {}).rule || ''} {(b.allocation || {}).why || ''}
          {(b.allocation || {}).foots === false ? (
            <em className="liWarnT">DEFECT: the allocation does not foot to the project total.</em>
          ) : null}
        </div>
      </div>
    </>
  )
}

const sgn = f => (!f ? '' : ((f.raw || 0) > 0 ? ' up' : (f.raw || 0) < 0 ? ' dn' : ''))

function Group({ g, allocation }) {
  return (
    <div className="liG">
      <div className="liGh">
        <b>{g.projectName || ''}</b>
        <span className="mono dim">{g.projectCode || ''}</span>
        <span className="dim">{g.region || ''} · {g.category || ''}</span>
        <span className="liGn">{(g.packageCount || {}).display || ''} package(s)</span>
      </div>

      <div className="liHead">
        <span className="liNo">Package</span>
        <span className="liTitle">Scope of work</span>
        <span className="liVend">Contractor</span>
        <span className="liNum">Awarded</span>
        <span className="liNum">Change orders</span>
        <span className="liNum b">Committed now</span>
        <span className="liNum der" title={(allocation || {}).why || ''}>Actual · allocated</span>
        <span className="liNum dim">Drawn</span>
      </div>

      {(g.items || []).map((it, i) => <Item it={it} key={it.no || i} />)}

      <div className="liTot">
        <span className="liNo" />
        <span className="liTitle">Packages on this project</span>
        <span className="liVend" />
        <span className="liNum">{(g.totals.award || {}).display || ''}</span>
        <span className={'liNum' + sgn(g.totals.changeOrders)}>
          {(g.totals.changeOrders || {}).display || ''}</span>
        <span className="liNum b">{(g.totals.revised || {}).display || ''}</span>
        <span className="liNum der">{(g.totals.actual || {}).display || ''}</span>
        <span className="liNum dim" />
      </div>

      {g.outsideNote ? <div className="liSeam">{g.outsideNote}</div> : null}
    </div>
  )
}

function Item({ it }) {
  return (
    <details className="liItem" {...((it.orders || []).length ? {} : { 'data-noco': '1' })}>
      <summary className="liSum">
        <span className="liNo mono">{it.no || ''}</span>
        <span className="liTitle">
          {it.title || ''}
          <i>{it.role || ''}{it.form ? ' · ' + it.form : ''}</i>
        </span>
        <span className="liVend">{(it.contractor || {}).display || ''}</span>
        <span className="liNum">{(it.award || {}).display || ''}</span>
        <span className={'liNum' + sgn(it.changeOrders)}>{(it.changeOrders || {}).display || ''}</span>
        <span className="liNum b">{(it.revised || {}).display || ''}</span>
        <span className="liNum der" title={(it.actual || {}).why || 'Allocated, not measured'}>
          {(it.actual || {}).display || ''}</span>
        <span className="liNum dim">{(it.drawnPct || {}).display || '—'}</span>
      </summary>
      <div className="liBody">
        {(it.orders || []).length
          ? <div className="liCoL">{it.orders.map((o, i) => <ChangeOrder o={o} key={o.ref || i} />)}</div>
          : (
            <div className="liNoMail">
              No change order on this package. The award value and the committed value are the same
              number, and there is no variance here to explain.
            </div>
          )}
        {it.methodNote ? (
          <div className="liMeth"><b>How this package was read:</b> {it.methodNote}</div>
        ) : null}
      </div>
    </details>
  )
}

function ChangeOrder({ o }) {
  const e = o.email
  return (
    <div className={'liCo' + (o.status === 'approved' ? '' : ' pend')}>
      <div className="liCoH">
        <span className="liCoRef mono">{o.ref || ''}</span>
        <span className={'pill ' + (o.status === 'approved' ? 'hi' : 'md')}>{o.status || ''}</span>
        <span className="liCoKind">{o.kind || ''}</span>
        <span className={'liCoVal' + sgn(o.value)}>{(o.value || {}).display || ''}</span>
        {(o.days && o.days.raw) ? <span className="liCoDay">{o.days.display}</span> : null}
        <span className="liCoWhen mono dim" title="Date the contractor submitted it">
          raised {asDate(o.raised)}
        </span>
      </div>
      <div className="liCoWhy">{o.reason || ''}</div>
      {o.inForecastNote ? <div className="liCoWarn">{o.inForecastNote}</div> : null}

      {e ? (
        <div className="liMail">
          <div className="liMailH">
            <span className="liMailTag">{(e.source || {}).name || 'mailbox'}</span>
            <b>{e.from || ''}</b>
            {e.fromOrg ? <span className="dim">{e.fromOrg}</span> : null}
            {e.fromSide ? <em>{e.fromSide}</em> : null}
            <span className="mono dim liMailWhen">{asDate(e.sentAt)}</span>
            {e.confidence ? (
              <span className={'pill ' + band(e.band)}
                    title="How confident the extractor is that this message says this, about this change order">
                {e.confidence.display}
              </span>
            ) : null}
          </div>
          <div className="liMailSubj mono">{e.subject || ''}</div>
          <div className="liMailEx">{e.excerpt || ''}</div>
          <div className="liMailF">
            {e.reasonLabel ? <span className="liMailCls">{e.reasonLabel}</span> : null}
            {e.amount ? (
              <span className="mono">
                {e.amount.display}{e.amountBasis ? ' · ' + e.amountBasis : ''}
              </span>
            ) : null}
            {e.others > 0 ? (
              <span className="dim">
                +{e.others} more message{e.others === 1 ? '' : 's'} on this change order
              </span>
            ) : null}
          </div>
          {e.disagrees ? <div className="liCoWarn">{e.disagrees}</div> : null}
        </div>
      ) : (
        <div className="liNoMail">{o.emailAbsentWhy || ''}</div>
      )}
    </div>
  )
}
