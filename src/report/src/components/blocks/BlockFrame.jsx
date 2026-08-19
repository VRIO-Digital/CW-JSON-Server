/* ==========================================================================
   THE CHROME AROUND EVERY BLOCK.

   Split out of the dispatcher for the reason the prototype split it out: a
   defect block gets the same frame as a good one. A defect rendered bare reads
   as a page that broke, rather than as a section that refused.

   The footer belongs to the FRAME, not to each renderer. In an earlier build it
   was called from nine renderers and from nowhere else, so `note` and
   `coverage.seam` — served on sixteen blocks, and the entire point of the
   coverage machinery — printed under some blocks and vanished under others
   depending on which renderer happened to draw them. A seam that appears only
   under a heatmap is not a disclosure, it is a coincidence.
   ========================================================================== */
import React from 'react'

/* A KPI strip is not a card. It is the headline of the section under it, and
   boxing it makes it compete with the analysis instead of introducing it — so
   `kpi` strips the border and renders the figures as a divided rule. */
const KPI_TYPES = { figRow: 1, progressSplit: 1 }

export function BlockFrame({ block, children }) {
  const b = block
  const kpi = !!KPI_TYPES[b.type]
  return (
    <div className={'repBlock w-' + (b.width || 'full') + (kpi ? ' kpi' : '')} id={'blk_' + b.id}>
      <div className="bHead">
        {/* `label`, not `title`. The api serves `label` on all of them; `title`
            is what an authored draft block carries before the resolver has
            labelled it, so it stays as the fallback rather than the primary. */}
        <div className="bTitle">{b.label || b.title || ''}</div>
        <div className="bActs">
          {b.extraction ? <span className="pill md">extracted from documents</span> : null}
          {/* STRICT === true. `recomputed` means two different things on two
              block types: a boolean flag here, and on a `blocked` block the
              api's independent re-derivation of the failure, which is an object
              and therefore truthy. Loose, every blocked block wore a
              "recomputed, not summed" pill — a caption about non-additivity
              stuck on a block that produced no number at all. */}
          {b.recomputed === true ? (
            <span className="pill neu"
              title="This figure is worked out fresh for the rows on screen. Adding the rows up would give a different, wrong answer.">
              recomputed, not summed
            </span>
          ) : null}
        </div>
      </div>
      {b.def ? <div className="bDef">{b.def}</div> : null}
      {children}
      <BlockFoot block={b} />
    </div>
  )
}

function BlockFoot({ block: b }) {
  const cov = b.coverage || null
  const out = []
  if (b.note) out.push(<div className="bNote" key="note">{b.note}</div>)
  /* THE FILTER THAT MOVED NOTHING SAYS SO, ON THE FIGURE THAT DID NOT MOVE.
     Narrowing a report whose figures are all declared programme aggregates
     changes the population line and leaves every number on screen
     byte-identical. The reader's two available conclusions are "the filter is
     broken" and "the number is wrong", and neither is true. Served as a
     sentence rather than composed here — the reason is a governance claim about
     how the figure was produced, and this renderer has no access to that. */
  if (b.paramsDoNotNarrow) out.push(
    <div className="bSeam pin" key="pin">
      <b>Unchanged by your filters.</b> {b.paramsDoNotNarrowNote || ''}
    </div>
  )
  if (cov && cov.seam) out.push(
    <div className="bSeam" key="seam"><b>{cov.label}.</b> {cov.seam}</div>
  )
  else if (cov && cov.kind === 'mixed' && cov.note) out.push(
    <div className="bSeam" key="mixed">{cov.note}</div>
  )
  return out.length ? <div className="bFoot">{out}</div> : null
}

/* A block the RESOLVER refused is not a block this client cannot draw. It keeps
   its original type, so without this guard it dispatches into a renderer whose
   payload was never produced and throws part-way through the report. */
export const Defect = ({ block: b }) => (
  <div className="note warn"><span>⚠</span><div className="body">
    <b>This section could not be resolved</b>
    {b.why || 'No reason given, which is itself the defect.'}
    {b.whyNote ? <div className="mini" style={{ marginTop: 6 }}>{b.whyNote}</div> : null}
    {b.implemented ? <div className="mini" style={{ marginTop: 6 }}>
      Implemented types: {b.implemented.join(', ')}</div> : null}
  </div></div>
)

/* Distinct from Defect, which is the api's own refusal: this is a type the
   CLIENT does not implement. Named rather than skipped — a silently dropped
   block is a wrong report that looks right. */
export const Unknown = ({ block: b }) => (
  <div className="note warn"><span>⚠</span><div className="body">
    <b>Unsupported block type “{b.type}”</b>
    The spec asks for a presentation this client does not implement. Named rather than skipped —
    a silently dropped block is a wrong report that looks right.
  </div></div>
)

/* A block carrying a resolver `failure` without being a `blocked` block — the
   failure is attached to an otherwise ordinary type. Drawing the chart and
   putting the warning beside it would let a reader take the picture and leave
   the caveat, so the failure REPLACES the body. */
export const Failure = ({ block: b }) => {
  const f = b.failure || {}
  return (
    <div className="note warn"><span>⚠</span><div className="body">
      <b>{f.summary || 'This block could not be drawn'}</b>
      {f.detail || ''}
      {(f.offending || []).length ? (
        <div className="blkFd">{f.offending.map((o, i) =>
          <span className="chip" key={i}>{(o.label || o.measure)} — {o.coord || ''}</span>)}</div>
      ) : null}
    </div></div>
  )
}

export const Empty = ({ children }) => <div className="empty">{children}</div>
