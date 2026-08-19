import React from 'react'
import { asMinute, band } from '../format.js'
import { Note, NeedsResolver } from '../Primitives.jsx'
import { useReportState } from '../ReportState.jsx'

/* ───────────────────────────────────────────────────────────── ANNOTATIONS ──
   Provenance authored | extracted, visually AND STRUCTURALLY distinct; orphans
   render with their ORIGINAL binding; below-floor items are absent entirely.

   Structurally distinct means more than a different colour: an extracted note
   carries a confidence, a source connector and a link to the observation it came
   from, and an authored one carries a person and a role. They are different
   objects and they render as different objects, because a reader who cannot tell
   at a glance whether a human wrote this or a model inferred it will weigh them
   the same.

   AN ORPHAN KEEPS ITS ORIGINAL BINDING, SHOWN UNCHANGED. Rebinding it to whatever
   is nearest would move a person's words onto a different number.

   Below-floor extractions are ABSENT — not greyed, not collapsed. The count is
   printed because a silent drop is indistinguishable from nothing having been
   found, and those are different facts.
   ========================================================================== */
export default function Annotations({ block: b }) {
  const { linDispatch } = useReportState()
  const items = b.items || []

  return (
    <>
      <div className="anL">
        {items.length ? items.map(a => (
          <div className={'anI ' + (a.provenance === 'extracted' ? 'ex' : 'au')
            + (a.orphan ? ' orph' : '')} id={'an_' + a.id} key={a.id}>
            <div className="anH">
              <span className="anP">
                {a.provenance === 'extracted' ? '◇ extracted' : '● written'}
              </span>
              <span className="anWho">
                {a.authorName || a.author || ''}
                {a.authorRole ? <> <em>{a.authorRole}</em></> : null}
              </span>
              {a.confidence ? (
                <span className={'pill ' + band(a.confidenceBand)} title="Extraction confidence">
                  {a.confidence.display}
                </span>
              ) : null}
              <span className="anT mono">{asMinute(a.createdAt)}</span>
            </div>

            <div className="anB">{a.body}</div>

            <div className="anBind">
              <span className="anBk">bound to</span> {a.bindingLabel || ''}
              {a.coordStated ? <span className="anCo">{a.coordStated}</span> : null}
              {a.observation ? (
                <button className="tinyBtn"
                        onClick={() => linDispatch({ type: 'section', section: 'graph' })}>
                  the observation it came from
                </button>
              ) : null}
            </div>

            {a.orphan ? (
              <div className="anOrph">
                <b>Orphaned.</b> {a.orphanNote || ''} The binding above is the one it was written
                against and is shown unchanged — rebinding it to whatever is nearest would move a
                person's words onto a different number.
              </div>
            ) : null}

            {(a.history || []).length ? (
              <div className="anHist">
                {a.history.map((h, i) => (
                  <div key={i}>
                    <span className="mono">{asMinute(h.at)}</span>{' '}
                    {h.actorName || h.actor} — {h.action}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )) : (
          <div className="empty">No notes on this report yet.</div>
        )}
      </div>

      <div className="anMeta">
        <span>{b.authored} written</span>
        <span>{b.extracted} extracted</span>
        <span>{b.orphans} orphaned</span>
        {b.floor != null ? <span>publication floor {b.floor}</span> : null}
      </div>

      {b.belowFloorCount ? (
        <div className="anFloor">
          <b>{b.belowFloorCount} not shown.</b> {b.belowFloorNote || ''}
        </div>
      ) : null}

      {!b.mayAnnotate ? (
        <Note kind="plain" glyph="▤" style={{ marginTop: 10 }}
              title="You can read these, not write them">
          {b.mayAnnotateNote || 'Your scope class does not carry allowAnnotate. Entitlement to see a '
            + 'report is not entitlement to write on it.'}
        </Note>
      ) : (
        /* THE WRITE ACTIONS ARE ABSENT RATHER THAN INERT. The prototype's
           acknowledge / assign / resolve buttons post to annotationAction, and
           the refusal on an assign with no due date is the API's, not a
           client-side validation pretending to be one. There is no API here, so
           a button that appeared to record an action and recorded nothing would
           be the exact stub the product's own rules forbid. What this persona is
           entitled to do is stated instead. */
        (b.actions || []).length ? (
          <NeedsResolver title={'This persona may annotate — '
            + b.actions.map(x => x.label).join(', ').toLowerCase()}>
            Writing a note is a logged act against the annotation service, and the refusals that go
            with it (an assignment with no due date is rejected) belong to that service. This build
            renders the resolver's output and carries no write path, so the controls are absent
            rather than present and inert.
          </NeedsResolver>
        ) : null
      )}

      {b.actionRule ? <div className="mini" style={{ marginTop: 8 }}>{b.actionRule}</div> : null}
      {b.bindingNote ? <div className="mini">{b.bindingNote}</div> : null}
    </>
  )
}
