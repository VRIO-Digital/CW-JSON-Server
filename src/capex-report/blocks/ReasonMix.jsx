import React from 'react'

/* ───────────────────────────────────────────────────────────── REASON MIX ──
   The by-reason roll-up on its own. Every message that feeds it is already drawn,
   once, inside the project row it explains — so repeating the ledger here would
   print the same contractor email twice on one screen and leave the reader
   guessing whether that was two findings or one.

   THE COVERAGE BAR STAYS. A reason mix with no denominator invites the reader to
   treat the classes as exhaustive, and the whole argument of this surface is that
   they are not: the corpus is one mailbox class over one month, and the projects
   listed as having no stated reason may have one in a system this connector does
   not read.
   ========================================================================== */
export default function ReasonMix({ block: b }) {
  const cov = b.coverage || {}
  const cls = b.byClass || []
  const max = cls.reduce((m, c) => Math.max(m, c.pct || 0), 0) || 1

  return (
    <>
      {cov.headline ? (
        <div className="rlCov">
          <div className="rlCovBar" role="img"
               aria-label={((cov.pct || {}).display || '') + ' of material projects explained'}>
            <i style={{ width: Math.max(1, Math.min(100, (cov.pct || {}).raw || 0)) + '%' }} />
          </div>
          <div className="rlCovT">
            <b>{(cov.pct || {}).display || ''} explained</b> {cov.headline}
          </div>
          <div className="rlCovN">
            <span>{(cov.explainedMoney || {}).display || ''} accounted for</span>
            <span>of {(cov.materialMoney || {}).display || ''} that moved materially</span>
          </div>
        </div>
      ) : null}

      {b.leadNote ? <div className="rmLead">{b.leadNote}</div> : null}

      {cls.length ? (
        <div className="rmC">
          {cls.map(c => (
            <div className="rmR" key={c.label}>
              <span className="rmL">{c.label}</span>
              <span className="rmB">
                <i style={{ width: Math.max(2, Math.round((c.pct || 0) / max * 100)) + '%' }} />
              </span>
              <b className="rmA">{(c.amount || {}).display || ''}</b>
              <span className="rmN mono dim">
                {String(c.count)} msg · {String(c.projects)} proj
              </span>
              <span className="rmP mono dim">{(c.share || {}).display || ''}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">No message in the corpus clears both floors.</div>
      )}

      {b.note ? <div className="mini" style={{ marginTop: 11 }}>{b.note}</div> : null}
      {b.coverageNote ? <div className="mini">{b.coverageNote}</div> : null}
    </>
  )
}
