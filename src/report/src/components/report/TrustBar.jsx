import React from 'react'
import { useReportState } from '../../state/ReportState.jsx'

/* ══════════════════════════════════════════════════════════════ TRUST BAR ══
   One line, four facts a business reader actually uses: how fresh, how much of the
   portfolio, how confident, and what the report will not tell them.

   The predicate, the digest, the grain ceiling and the trace ids are NOT here —
   they are in the drawer under "Audit detail", which is where the people who need
   them look and where the people who do not are not taxed by them.

   THE AS-OF IS A DATASET AND THE SERVER SAYS SO. This strip used to reach into
   `asOf.floorSource.name` and count `asOf.sources`, neither of which the resolver
   serves — and when it did, it composed its own sentence from the parts and
   disagreed with the library card about whether the stale thing was a table or a
   connector. The stamp is the age of the OLDEST contributing dataset, never the
   newest: three inputs can be current while the fourth holds the whole report
   back, and a figure stamped with its freshest input is lying about the others.
   ========================================================================== */
export default function TrustBar({ view: v }) {
  const { linDispatch } = useReportState()
  const stale = v.asOf.lagDays > 0
  const conf = v.confidence || null
  const lim = v.limits || { count: 0 }

  const go = section => () => linDispatch({ type: 'section', section })

  return (
    <div className="trustBar">
      <button className="tItem" onClick={go('sources')}>
        <span className="tk">Data as of</span>
        <b className={stale ? 'stale' : ''}>{v.asOf.display}</b>
        <span className="ts">
          {!v.asOf.floorName ? 'no dated dataset contributes'
            : v.asOf.datasetCount === 1
              ? 'the only dated input this report reads: ' + v.asOf.floorName
              : v.asOf.floorName + ' is the oldest of ' + v.asOf.datasetCount + ' datasets'}
        </span>
      </button>

      <button className="tItem" onClick={go('population')}>
        <span className="tk">Covering</span>
        <b>{v.rowsAdmitted} project{v.rowsAdmitted === 1 ? '' : 's'}</b>
        <span className="ts">
          {v.rowsAdmitted === v.rowsTotal ? 'the whole report' : 'of ' + v.rowsTotal + ' — see why'}
        </span>
      </button>

      {conf ? (
        <button className="tItem" onClick={go('transforms')}>
          <span className="tk">Confidence</span>
          <b className={'cf-' + conf.band}>{conf.display}</b>
          <span className="ts">{conf.basis.split(' · ')[0]}</span>
        </button>
      ) : null}

      <div className="tspace" />
      <button className="tBtn" onClick={go('sources')}>◈ Sources &amp; lineage</button>
      <button className={'tBtn' + (lim.count ? ' warn' : '')} onClick={go('limits')}>
        ⚠ Limits{lim.count ? <> <b>{lim.count}</b></> : null}
      </button>
    </div>
  )
}
