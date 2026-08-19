import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { reportById } from '../../lib/db.js'

/* ────────────────────────────────────────────────────────────── CALENDAR ──
   In-service by month, as a grid of month TILES.

   TWO OBLIGATIONS, BOTH LOAD-BEARING, AND THE SECOND IS THE HARDER ONE TO HOLD.

   (1) Each cell carries its own BASIS label. Months before the as-of read a
       recorded date and a capitalised value; months after read a forecast date
       and an approved budget. A record month and a projection month are different
       claims, and a grid that draws them identically is the failure this report
       was written to avoid.

   (2) THERE IS NO SINGLE WINDOW TOTAL. A twelve-cell grid of dollar figures with
       no total looks like an omission, so the absence is filled with the REASON
       for the absence, in the place the total would have gone. Adding a record
       month to a projection month produces a number that is not a quantity.

   An empty tile says WHICH KIND of nothing it is — nothing recorded, or nothing
   forecast. And the overdue list is not decoration: those projects were forecast
   into a record-basis month and have no recorded date, so they belong to no cell.
   A project that falls out of a calendar because of how the calendar is built is
   exactly the sort of thing nobody notices is missing.

   `+N more` EXPANDS IN PLACE and every row is already rendered — the control has
   something real to reveal and cannot fail against a payload the tile never
   received.
   ========================================================================== */
export default function Calendar({ block: b }) {
  const ms = b.months || []
  const drill = b.drill || null
  const acc = b.accounting || {}

  return (
    <>
      {acc.note ? (
        <div className={'calAcc' + (acc.sums ? '' : ' off')}>
          {acc.note}
          {acc.reconcileNote ? <> <b>{acc.reconcileNote}</b></> : null}
        </div>
      ) : null}

      {b.windowLabel ? (
        <div className="calHead">
          <span className="calWin">{b.windowLabel}</span>
          <span className="calLeg">
            {(b.legend || []).map(g => (
              <span className="calLegI" key={g.label}
                    title={`${g.label} — ${g.display} · ${g.n} project${g.n === 1 ? '' : 's'} · ${g.pct}% of the months on screen`}>
                <i className={'calDot ' + g.cls} />{g.label}
              </span>
            ))}
          </span>
        </div>
      ) : null}

      <div className="calG">
        {ms.map(m => <Tile m={m} drill={drill} key={m.label} />)}
      </div>

      {b.legendNote ? <div className="calLegN">{b.legendNote}</div> : null}

      <div className="calRule">
        <b>Two bases in one window.</b> {(b.basisPerMonth || {}).rule || ''}
        {(b.basisPerMonth || {}).recordThrough
          ? ' Record basis runs through ' + b.basisPerMonth.recordThrough + '.'
          : ''}
      </div>

      <div className="calNoTot"><b>No window total.</b> {b.whyNoTotal || ''}</div>

      {(b.placeholder || {}).unplaceable && b.placeholder.unplaceable.length ? (
        <div className="calPh">
          <div className="calPhH">
            Dated to the year-end default — {b.placeholder.unplaceable.length}{' '}
            project{b.placeholder.unplaceable.length === 1 ? '' : 's'}, no estimate behind it
          </div>
          <div className="mini">{b.placeholder.why || ''}</div>
          <div className="mini">{b.placeholder.unplaceableNote || ''}</div>
          <table className="tbl sm" style={{ marginTop: 8 }}>
            <tbody>
              <tr>
                <th>Project</th><th>Date column holds</th><th>Estimate</th>
                <th style={{ textAlign: 'right' }}>Value</th>
              </tr>
              {b.placeholder.unplaceable.map((o, i) => (
                <tr key={o.code || i}>
                  <td title={o.name}>{o.code}</td>
                  <td className="mono">{o.stated}</td>
                  <td className="mono calNone">none recorded</td>
                  <td className="num" style={{ textAlign: 'right' }}>{o.display}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {b.placeholder.redatedNote ? (
            <div className="mini calPhR">{b.placeholder.redatedNote}</div>
          ) : null}
        </div>
      ) : null}

      {(b.overdue || []).length ? (
        <div className="calOver">
          <div className="calOvH">
            In no tile — {b.overdue.length} project{b.overdue.length === 1 ? '' : 's'} due and
            unrecorded
          </div>
          <div className="mini">{b.overdueNote || ''}</div>
          {(b.overdueTests || {}).note ? <div className="mini">{b.overdueTests.note}</div> : null}
          <table className="tbl sm" style={{ marginTop: 8 }}>
            <tbody>
              <tr>
                <th>Project</th><th>Due</th><th>Due month</th><th>Found by</th>
                <th style={{ textAlign: 'right' }}>Value</th>
              </tr>
              {b.overdue.map((o, i) => (
                <tr key={o.code || i}>
                  <td title={o.name}>{o.code}</td>
                  <td className="mono">
                    {o.forecast}
                    {o.datedFrom === 'estimate' ? <span className="calEst">est</span> : null}
                  </td>
                  <td className="mono">{o.dueMonth}</td>
                  <td className={'calVia ' + o.via}>
                    {o.via === 'both' ? 'flag and dates' : o.via === 'flag' ? 'source flag' : 'the dates'}
                  </td>
                  <td className="num" style={{ textAlign: 'right' }}>{o.display}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {(b.peak || {}).declared ? (
        <div className="mini" style={{ marginTop: 9 }}>
          Declared peak {b.peak.declared}
          {b.peak.inWindow ? ', inside this window' : ', outside this window'}
          {b.peak.heaviestInSample
            ? `; heaviest month in the rows on screen is ${b.peak.heaviestInSample}`
            : ''}.{b.peak.note ? ' ' + b.peak.note : ''}
        </div>
      ) : null}

      {(b.footing || {}).note ? <div className="mini">{b.footing.note}</div> : null}
    </>
  )
}

function Tile({ m, drill }) {
  const [open, setOpen] = useState(false)
  const projects = m.projects || []
  const shown = projects.slice(0, m.shown)
  const hidden = projects.slice(m.shown)

  return (
    <div className={'calT ' + (m.empty ? 'e ' : '') + (m.isPeak ? 'pk ' : '') + 'bs-' + m.basis
      + (open ? ' open' : '')}>
      <div className="calTH">
        <span className="calTM">
          {m.label}{m.isPeak ? <span className="calPk">peak</span> : null}
        </span>
        <span className="calTN">{m.empty ? '— —' : m.n + ' proj'}</span>
      </div>

      {m.empty ? (
        <div className="calE">{m.emptyNote}</div>
      ) : (
        <>
          <div className="calTV">{m.display}</div>
          <div className="calMix">
            {(m.mix || []).map(g => (
              <i className={g.cls} key={g.label} style={{ width: g.pct + '%' }}
                 title={`${g.label} — ${g.display} · ${g.pct}%`} />
            ))}
          </div>
          <div className="calPr">
            {shown.map((p, i) => <ProjRow p={p} drill={drill} key={p.id || i} />)}
            {hidden.map((p, i) => (
              <div className="calHid" key={p.id || ('h' + i)}>
                <ProjRow p={p} drill={drill} />
              </div>
            ))}
          </div>
          {m.more ? (
            <button className="calMore" type="button" onClick={() => setOpen(o => !o)}>
              {open ? '− show fewer' : '+' + m.more + ' more'}
            </button>
          ) : null}
        </>
      )}

      <div className="calF">
        <span className="calB">{m.basis} basis</span>
        <span className="calYr">{String(m.year)}</span>
      </div>
    </div>
  )
}

/* A REDATED ROW SAYS SO ON THE ROW. The tile's month came from the estimated
   in-service date rather than from the column the report nominally reads, and a
   reader who cannot see which rows those are cannot tell a measured month from a
   substituted one. The marker carries both dates in its title.

   THE DESTINATION REPORT IS NEVER NAMED HERE. It comes off the block's `drill`
   payload — a report id in executable renderer code is the coupling the
   prototype's third renderer rule forbids, and hard-wiring the calendar to
   Project 360 would put that coupling in the one file that is supposed to know
   nothing about either. */
function ProjRow({ p, drill }) {
  const est = p.datedFrom === 'estimate'
  const title = p.code + ' · ' + p.name + (p.category ? ' · ' + p.category : '')
    + (est
      ? '\nDrawn from the estimated in-service date ' + (p.drawnDate || '')
        + '. The column this report reads holds ' + (p.statedDate || '') + ', the year-end default.'
      : '')

  const inner = (
    <>
      <i className={'calDot ' + (p.categoryCls || '')} />
      <span className="nm">{p.name}</span>
      {est ? <span className="calEst" aria-label="dated from estimate">est</span> : null}
      <span className="v">{p.display}</span>
    </>
  )

  const target = drill ? reportById(drill.report) : null
  if (!target) {
    return <button className={'calPrI' + (est ? ' est' : '')} type="button" disabled title={title}>{inner}</button>
  }

  /* The param is single-valued — it is a coordinate, not a filter — so it rides
     in the query string and the destination seeds it as the project it is
     resolved at. */
  const value = p[drill.key] || p.id
  return (
    <Link className={'calPrI' + (est ? ' est' : '')} title={title}
          to={`/reports/${target.slug}?${encodeURIComponent(drill.param)}=${encodeURIComponent(value)}`}>
      {inner}
    </Link>
  )
}
