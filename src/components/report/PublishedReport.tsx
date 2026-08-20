/**
 * One report, rendered the way the tenant's own `Report_N_*.html` renders it.
 *
 * **The chrome is the standalone report app's; every figure is still the server's.** That folder held
 * five report components with their figures compiled in as TypeScript constants — five hundred lines of
 * transcribed rosters — and one component per report is one place per report for a number to go stale.
 * What came across is the *design*: the shell, the tiles, the cards, the table, the marks, all in
 * `./ui`. What did not come across is its data, because this section's whole premise is that a report
 * is a re-executable question rather than a stored table, and the fastest way to break it is to paste a
 * rendered figure into a component. Every number below is `reportView`'s, computed per request from the
 * roster in `s3://contextweave.com/EPA/db.json`.
 *
 * **So one component renders all five, not five components.** The reports differ in their blocks, and
 * the blocks are in the payload — a component per report could only differ by hardcoding what its
 * report happens to contain.
 *
 * Two things the rendered HTML did that deliberately did not come across:
 *
 * - **Chart.js from a CDN.** Charts are `AnswerChart` — the server emits a report's chart in the answer
 *   shape so one component draws both. Transcribing a `<script src="cdn…">` would be a dependency
 *   decision made by accident, through a gate that fails on any advisory at `low`.
 * - **Its filter chips as browser-side state.** The facets re-ask the report through
 *   `POST /reports/build`, so the table, the chart *and* the tiles recompute together. Both the HTML
 *   and the standalone port hid rows locally and left the chart and the KPIs describing the unfiltered
 *   set, which is two readings of one screen.
 */

import { Alert, Select } from 'antd'

import type { BuiltReport, ComputedReportBlock, Report } from '../../api/client'
import { useReportsStore } from '../../store/reportsStore'
import CapexBlockView, { CAPEX_BLOCK_KINDS, type CapexBlock } from './CapexBlocks'
import ReportBlockView from './ReportBlocks'
import { Footnote, KpiRow, Note, ReportShell, type KpiItem, type KpiTone } from './ui'

/**
 * A tile's tone, as the report read its own figure.
 *
 * `crit` is the payload's word and `risk` is the tile's class; the two vocabularies meet here rather
 * than either one being renamed, because `crit` is what every other status surface in this app says and
 * the class is the ported design's. `null` is a plain figure, not a neutral verdict.
 */
const TONE: Record<string, KpiTone> = {
  good: 'good',
  warn: 'warn',
  crit: 'risk',
}

export default function PublishedReport({ report }: { report: Report | BuiltReport }) {
  const filters = useReportsStore((s) => s.filters)
  const filtering = useReportsStore((s) => s.filtering)
  const setFacet = useReportsStore((s) => s.setFacet)

  /*
   * A re-asked report carries three fields the first read does not — `variant`, `summaryNote`, `caveats`.
   * Narrowed once here rather than tested at each use, so the report opened straight from the Library and
   * the report after a chip click render through the same component.
   */
  const isBuilt = 'variant' in report

  const tiles: KpiItem[] = report.tiles.map((tile) => ({
    label: tile.label,
    value: tile.value,
    unit: tile.unit,
    tone: tile.tone ? (TONE[tile.tone] ?? 'plain') : 'plain',
  }))

  return (
    <ReportShell
      crumb={report.title}
      title={report.heading}
      subtitle={report.subtitle}
      badge={report.badge}
    >
      {/*
        * The lead note, on the two reports that carry one. It is the tenant's sentence about what a
        * report *is*, so it is printed rather than paraphrased — and only where there is one, because an
        * absence has no box.
        */}
      {report.note ? <Note>{report.note}</Note> : null}

      {/*
        * The question this report re-asks, read back as a sentence. The HTML had no equivalent — a
        * rendered file has no question left in it — and it is the one thing the section promises above
        * all: a report is a question, and the reader should be able to see which.
        */}
      <section className="question">
        <span className="k">The question</span>
        <p>{report.reading}</p>
      </section>

      {/*
        * The summary tiles. `tone` is the report's own reading of its figure — which is the one place a
        * status colour is right on something that is not a state, because a tile *is* a stat.
        */}
      {tiles.length > 0 ? <KpiRow items={tiles} /> : null}

      {/*
        * Scope, and it is a figure rather than a phrase: "4 of 36 inbound generators" is what makes a
        * scoped report legible next to an unscoped one. Both numbers are the server's.
        */}
      <div className="scope">
        {/*
          * One expression, not `{a} of {b} {c}`. `renderToString` puts a comment node between every
          * interpolation and its neighbouring text, so a three-part scope line renders as
          * `4<!-- --> of <!-- -->36` and every assertion about the sentence passes over nothing —
          * which is exactly how it was caught here. The rule is written down; this is it applied.
          */}
        <span className="rows">
          {`${report.rowCount.toLocaleString()} of ${report.spineTotal.toLocaleString()} ${report.spine}`}
        </span>

        {/*
          * The frame's assumptions, stated. Each is a slot the question was filled in with — and the
          * horizon among them is **declared, not applied**: nothing in these rosters is sliced by time.
          */}
        {report.assumptions.map((a) => (
          <span key={a.slot} className="assume">
            {a.label}
          </span>
        ))}
      </div>

      {/*
        * ---------------- the filter bar, and it filters on the server ----------------
        *
        * One control per facet, each a multi-select whose values carry the count the server computed.
        * Changing one re-asks the report through `POST /reports/build`, so the table, the chart *and*
        * the tiles recompute together — the markup this was ported from held its chips in `useState` and
        * filtered rows in the browser, leaving its chart and its four KPIs describing the unfiltered
        * set, which is two readings of one screen.
        *
        * **Values on one facet are OR-ed and facets are AND-ed**, so High + Medium reads as "either" and
        * adding Consent-decree narrows that. That is the server's rule; this only sends the list.
        *
        * `disabled` while a re-ask is in flight rather than hidden: the control is what the reader just
        * used, and taking it away is how a second change becomes two questions.
        *
        * **A dropdown per facet, not a row of chips.** Chips fit four states and not twenty — the values
        * come from the roster, so their number is the data's business rather than the layout's, and a
        * facet that wraps onto three lines is the control deciding how much data is reasonable. Each is
        * multi-select because the frame is: an empty selection is that facet's "All", which is also what
        * clearing it means, so there is no separate All to keep in step with the selection.
        */}
      {report.facets.length > 0 ? (
        <div className="fbar">
          {report.facets.map((facet) => {
            const chosen = filters.filter((f) => f.key === facet.key).map((f) => f.value)
            return (
              <div key={facet.key} className="facet">
                <span className="lbl" id={`pr-facet-${facet.key}`}>
                  {facet.label}
                </span>

                <Select
                  className="facet-select"
                  size="small"
                  mode="multiple"
                  value={chosen}
                  disabled={filtering}
                  allowClear
                  /* Empty reads as "All" rather than as "nothing selected", which is what it means. */
                  placeholder="All"
                  aria-labelledby={`pr-facet-${facet.key}`}
                  /* Wide enough to read a value in, and the popup sizes to its content rather than the
                     control, so a long label is not truncated in the one place it has to be read. */
                  popupMatchSelectWidth={false}
                  /* A number, not `responsive`: that mode measures the control, so with no layout
                     yet it collapses every tag into "+N …" — which is what the first paint shows
                     and what a render test sees. Two tags then a count is the same information,
                     deterministically. */
                  maxTagCount={2}
                  onChange={(next: string[]) => void setFacet(facet.key, next)}
                  options={facet.values.map((value) => ({
                    value: value.value,
                    /* The count is the server's, so an option says how much it would leave. It is part of
                       the label rather than a rendered node so the selected tag carries it too. */
                    label: `${value.label} · ${value.count}`,
                  }))}
                />
              </div>
            )
          })}

          {/*
            * What the slice did, stated. `variant` is the server's own reading: `written` means the frame
            * is the one the report was authored for, so the authored tiles still describe it; `generated`
            * means the tiles were recomputed over the rows in view, and the report says so rather than
            * showing the tenant's figures against a frame they do not describe.
            */}
          {isBuilt && report.variant === 'generated' ? (
            <span className="fnote">filtered — every figure below is recomputed for this slice</span>
          ) : null}
          {filtering ? <span className="fnote">re-asking…</span> : null}
        </div>
      ) : null}

      {/*
        * A spine with no summary to compute says so, and a caveat the frame introduced is printed. Both
        * are the server's sentences — the horizon caveat in particular is the one that keeps the report
        * honest about a filter it states and does not apply.
        */}
      {isBuilt && report.summaryNote ? (
        <Alert className="pr-alert" type="info" showIcon={false} description={report.summaryNote} />
      ) : null}
      {isBuilt && report.caveats.length > 0 ? (
        <ul className="caveats">
          {report.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      ) : null}

{/*
        * A card per block, in the order the report defines them — drawn by whichever family the block
        * belongs to.
        *
        * **Two families, because the two tenants' reports are two different things.** EPA's blocks are
        * definitions the server resolves per request (`chart`, `table`, `facilities`, `quarterly`,
        * `traces`), so a facet chip re-asks the report and every figure moves together. Northline's
        * arrive already resolved from its own resolver, each figure carrying its coordinate, its exact
        * form and its provenance — seventeen kinds, none of which the five renderers know.
        *
        * Dispatching on the kind rather than on the report keeps both working and keeps the choice in
        * one place: a block is drawn by the family that has a renderer for it, and `CapexBlockView`
        * names an unknown kind rather than dropping it.
        */}
      {report.blocks.map((block, i) => {
        const key = `${block.type}-${i}`
        return CAPEX_BLOCK_KINDS.includes(block.type) ? (
          <CapexBlockView key={key} block={block as unknown as CapexBlock} />
        ) : (
          <ReportBlockView key={key} block={block as ComputedReportBlock} />
        )
      })}

      <Footnote>
        {report.footer.map((note) => (
          <p key={note.label}>
            <b>{note.label}</b> {note.text}
          </p>
        ))}

        {/* Where the figures came from, in the tenant's own words. */}
        {report.sourceTrace ? <p>{report.sourceTrace}</p> : null}

        {/*
          * And which published content answered it. A report is asked *of* a published graph, so naming
          * the version and its hash is what makes the figures checkable — the same claim Ask makes about
          * its answers, for the same reason.
          */}
        {report.graph ? (
          <p>
            <b>Answered from</b> {report.graph.name}
            {report.graph.version ? ` ${report.graph.version}` : ''}
            {report.graph.sha256 ? (
              <>
                {' '}
                · <code>{report.graph.sha256}</code>
              </>
            ) : null}
            {report.graph.publishedBy ? ` · published by ${report.graph.publishedBy}` : ''}
          </p>
        ) : null}
      </Footnote>
    </ReportShell>
  )
}
