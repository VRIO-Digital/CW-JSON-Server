import React from 'react'
import { useView } from '../../state/ReportState.jsx'
import { NeedsResolver } from '../Primitives.jsx'
import { fmtWhen } from '../../lib/format.js'

/* ─────────────────────────────────────────────────────── THE ASK SURFACE ──
   Painted FIRST on every report, wherever the spec puts it — see repOrderBlocks
   in ReportBody. Every spec authors it last, because that is where it reads
   naturally in a document: figures, then reading, then "any questions". It is the
   wrong place on a screen. These reports run seven to eleven blocks and the ask
   surface sat below all of them, so the one control that answers a question the
   report did not anticipate was the one control nobody scrolled to.

   WHAT THIS BUILD CAN AND CANNOT DO. The binding line, the suggested questions
   and the disabled-with-reason state are all served, so all three are real here.
   Answering is not: a turn goes through the supervisor agent, gets an
   evidence-backed answer under the viewer's predicate, and refuses questions that
   would need data the reader is not cleared for. There is no agent in a build
   that ships the resolver's output, and a box that accepted a question and
   answered from nothing would be the worst possible stub on the one surface whose
   entire promise is that it shows its evidence. So the box states what it needs.
   ========================================================================== */
export default function Ask({ block: b }) {
  const v = useView()

  if (b.enabled === false) {
    return (
      <div className="embedAsk off">
        <div className="eaHead"><span>✦</span> Ask about this report</div>
        <div className="eaBind">
          {b.disabledWhy || 'This report does not carry an embedded ask surface.'}
        </div>
        <div className="mini" style={{ marginTop: 7 }}>
          The Ask view can still answer questions against the data you can see — this report just
          does not bind a thread to its own figures.
        </div>
      </div>
    )
  }

  return (
    <div className="embedAsk">
      <div className="eaHead"><span>✦</span> Ask about this report</div>
      <div className="eaBind">{bindLine(b.binding || {}, v)}</div>

      {(b.suggestions || []).length ? (
        <>
          <div className="inlineList" style={{ marginTop: 9 }}>
            {b.suggestions.map((s, i) => (
              <span className="tinyBtn" key={i} style={{ cursor: 'default' }}>{s}</span>
            ))}
          </div>
          <div className="mini" style={{ marginTop: 7 }}>
            The questions this report expects to be asked, as the spec declares them. Every answer
            shows its evidence and what it is not sure about, the same as the figures below.
          </div>
        </>
      ) : null}

      {/* An unresolved binding is a fact about the spec, not a rendering gap. */}
      {b.unresolved ? (
        <div className="mini" style={{ marginTop: 7 }}>{b.unresolvedWhy || ''}</div>
      ) : null}

      <NeedsResolver title="Asking needs the supervisor agent">
        A turn here is grounded in the knowledge graph, routed to the source systems and returned
        with its reasoning open — under the same predicate as the report, so a question needing data
        you are not cleared to see says so rather than quietly answering from a smaller set. This
        build renders the resolver's output for one run and carries no agent, so the input is absent
        rather than present and unable to answer.
      </NeedsResolver>
    </div>
  )
}

/* THE BINDING, IN THE READER'S NOUNS. It used to be stated as "Inherits graph cp
   v4, as-of …, predicate sha256:9f2c…". Every noun in that sentence is ours, not
   theirs. What a business user needs to know is that the answer cannot come from
   data the report is not showing them — say that, and say which date it is
   answering as of. The digest still exists; it is in the lineage drawer, where
   someone auditing wants it and nobody else has to walk past it. */
function bindLine(bd, v) {
  const when = fmtWhen(bd.asOf || ((v || {}).asOf || {}).at)
  const scope = ((v || {}).scope || {}).label
  return 'Answers use the same data as the report below, as of ' + (when || 'the last refresh')
    + (scope ? ', and stay inside ' + scope.toLowerCase() : '')
    + '. A question that would need something you are not cleared to see says so — it does not '
    + 'quietly answer from a smaller set.'
}
