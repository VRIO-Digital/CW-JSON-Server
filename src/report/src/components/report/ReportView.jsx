import React from 'react'
import Block, { orderBlocks } from '../blocks/index.jsx'
import FilterBar from './FilterBar.jsx'
import TrustBar from './TrustBar.jsx'
import { Note, NeedsResolver } from '../Primitives.jsx'
import { useReportState, ViewProvider } from '../../state/ReportState.jsx'
import { asSecond } from '../../lib/format.js'

/* ══════════════════════════════════════════════════════════════ THE REPORT ══
   Head, filter bar, trust bar, canvas, foot — in that order, because the reader
   needs to know what they are looking at and how much to trust it before the first
   number.

   THE BLOCKS SIT ON A TWELVE-COLUMN GRID rather than in a stack, because a stack
   gives a three-number KPI strip the same visual weight as a twenty-row table and
   the reader has to work out the hierarchy themselves. The widths come from the
   SPEC — the resolver packs them and widens any row that does not add up — never
   from a corner someone dragged, because a report here is a governed object.
   ========================================================================== */
export default function ReportView({ view: v, seedMismatch }) {
  const { setModal, toast } = useReportState()

  return (
    <ViewProvider view={v}>
      <div className="repHead">
        <div style={{ flex: 1, minWidth: 280 }}>
          <h1>{v.name}</h1>
          <div className="rq">“{v.subtitle}”</div>
        </div>
        <div className="racts">
          {/* A refresh answers the question again — it does not redefine it, and
              the spec stays at the version it was approved at. It is also the one
              control here that must reach the sources, so it states that instead
              of spinning. */}
          <button className="btn sec sm"
                  onClick={() => toast('Refreshing re-runs the spec against the sources and moves the '
                    + 'as-of; the definition and the version stay put. That needs the resolver, which '
                    + 'this build does not carry — it renders one resolved run.', 'warn')}>
            ↻ Refresh
          </button>
          <button className="btn sec sm" onClick={() => setModal('export')}>Export</button>
        </div>
      </div>

      <FilterBar view={v} />
      <TrustBar view={v} />

      {/* A COORDINATE ARRIVED THAT THIS RUN IS NOT RESOLVED AT. The calendar drills
          into Project 360 at one project's coordinate, and Project 360 is a
          one-project report — so following the link for any project other than the
          one this run resolved would show the reader a different project's figures
          under the name they clicked. Named, not silently ignored. */}
      {seedMismatch ? (
        <NeedsResolver title={`This run is resolved at ${seedMismatch.have}, not ${seedMismatch.want}`}>
          You arrived here asking for a different {seedMismatch.param}. Moving the coordinate
          re-resolves the report — every figure is recomputed rather than re-added — and that needs
          the resolver. What is below is the run this build carries, and it is labelled with the
          coordinate it actually holds.
        </NeedsResolver>
      ) : null}

      <div id="repBody">
        {v.empty ? <EmptyResult v={v} /> : (
          <div className="repCanvas">
            {orderBlocks(v.blocks).map(b => <Block block={b} key={b.id} />)}
          </div>
        )}

        {/* WITHHELD BLOCKS ARE LISTED, NOT DROPPED. A section removed by
            entitlement that leaves no trace is indistinguishable from a section
            the spec never had. */}
        {(v.withheldBlocks || []).length ? (
          <Note kind="plain" glyph="▤" style={{ marginTop: 14 }}
                title={`${v.withheldBlocks.length} section${v.withheldBlocks.length === 1 ? '' : 's'} withheld from you`}>
            {v.withheldBlocks.map((w, i) => (
              <div key={i} className="mini">
                <b>{w.label || w.id}</b>{w.why ? ' — ' + w.why : ''}
              </div>
            ))}
          </Note>
        ) : null}

        <div className="repFoot">
          Resolved {asSecond(v.generatedAt)} UTC · v{v.version}{' '}
          {String(v.status).replace(/_/g, ' ')} ·{' '}
          <button className="tinyBtn" onClick={() => setModal('spec')}>
            View the specification</button>
        </div>
      </div>
    </ViewProvider>
  )
}

/* An empty result names WHICH NARROWING produced it, because one of them the
   viewer can undo and the other they cannot. Conflating the two turns a correct
   answer into a support ticket. */
function EmptyResult({ v }) {
  if (v.emptyCause === 'params') return (
    <Note kind="warn" glyph="◔" title="No projects match your filters">
      {v.rowsScoped} project{v.rowsScoped === 1 ? '' : 's'} are available to you on this report; the
      combination you selected matches none of them. Nothing is wrong — narrow differently.
    </Note>
  )
  return (
    <Note kind="warn" glyph="◔"
          title="Nothing here is available to you — and that is the correct answer, not an error">
      You are entitled to know this report exists. Your data access admits none of the {v.rowsTotal}{' '}
      project{v.rowsTotal === 1 ? '' : 's'} it covers. Those are two separate decisions, deliberately,
      so nobody has to guess whether a report is empty or forbidden.
    </Note>
  )
}
