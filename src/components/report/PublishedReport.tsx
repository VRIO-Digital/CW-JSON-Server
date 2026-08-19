/**
 * One report, rendered the way the tenant's own `Report_N_*.html` renders it.
 *
 * **A port of the demo package's rendered reports (`07_reports/Report_N_*.html`), not a transcription of
 * them.** Those five files
 * carry the layout — crumb, heading and badge, a lead note, four summary tiles, a filter bar, then a
 * card per block, then the footnotes — and *also* carry their figures as literal text. The layout is
 * what came across; every number here is `reportView`'s, computed per request from the roster in
 * `s3://contextweave.com/EPA/db.json`. That is the section's whole premise: a report is a re-executable
 * question, not a stored table, and the fastest way to break it is to paste a rendered figure into a
 * component.
 *
 * Two things the HTML did that deliberately did not come across:
 *
 * - **Chart.js from a CDN.** Charts are `AnswerChart` — the server emits a report's chart in the answer
 *   shape so one component draws both. Transcribing a `<script src="cdn…">` would be a dependency
 *   decision made by accident, through a gate that fails on any advisory at `low`.
 * - **Its filter chips as controls.** The facets are rendered, and they state the frame the report was
 *   built under; they do not re-ask it. `POST /reports/build` takes a frame and is wired to nothing, so
 *   a chip that looked clickable would promise a slice that never runs — the same "declared, not
 *   applied" line the horizon and the persona data scopes already draw.
 */

import { Alert, Select, Tag, Typography } from 'antd'

import type { BuiltReport, Report } from '../../api/client'
import { useReportsStore } from '../../store/reportsStore'
import ReportBlockView from './ReportBlocks'
import './PublishedReport.css'

/** A tile's tone, as the report read its own figure. `null` is a plain figure, not a neutral verdict. */
const TONE_CLASS: Record<string, string> = {
  good: 'is-good',
  warn: 'is-warn',
  crit: 'is-crit',
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

  return (
    <article className="pr">
      {/* Where the report sits, as its own rendered page states it. */}
      <nav className="pr-crumb" aria-label="Breadcrumb">
        Reports <span aria-hidden="true">·</span> <b>{report.title}</b>
      </nav>

      <header className="pr-head">
        <div className="pr-head-text">
          <h2 className="pr-heading">{report.heading}</h2>
          <p className="pr-sub">{report.subtitle}</p>
        </div>
        {/* The subject the report is about — the facility, the network — as the badge in the HTML. */}
        {report.badge ? <span className="pr-badge">{report.badge}</span> : null}
      </header>

      {/*
        * The lead note, on the two reports that carry one. It is the tenant's sentence about what a
        * report *is*, so it is printed rather than paraphrased — and only where there is one, because an
        * absence has no box.
        */}
      {report.note ? (
        <Alert className="pr-note" type="info" showIcon={false} description={report.note} />
      ) : null}

      {/*
        * The question this report re-asks, read back as a sentence. The HTML had no equivalent — a
        * rendered file has no question left in it — and it is the one thing the section promises above
        * all: a report is a question, and the reader should be able to see which.
        */}
      <section className="pr-question">
        <Typography.Text className="pr-question-label">THE QUESTION</Typography.Text>
        <p className="pr-question-text">{report.reading}</p>
      </section>

      {/*
        * The four summary tiles. `tone` is the report's own reading of its figure — which is the one
        * place a status colour is right on something that is not a state, because a tile *is* a stat.
        */}
      {report.tiles.length > 0 ? (
        <div className="pr-tiles">
          {report.tiles.map((tile) => (
            <div
              key={tile.label}
              className={`pr-tile${tile.tone ? ` ${TONE_CLASS[tile.tone] ?? ''}` : ''}`}
            >
              <span className="pr-tile-label">{tile.label}</span>
              <span className="pr-tile-value">{tile.value}</span>
              {tile.unit ? <span className="pr-tile-unit">{tile.unit}</span> : null}
            </div>
          ))}
        </div>
      ) : null}

      {/*
        * Scope, and it is a figure rather than a phrase: "4 of 36 inbound generators" is what makes a
        * scoped report legible next to an unscoped one. Both numbers are the server's.
        */}
      <div className="pr-scope">
        {/*
          * One expression, not `{a} of {b} {c}`. `renderToString` puts a comment node between every
          * interpolation and its neighbouring text, so a three-part scope line renders as
          * `4<!-- --> of <!-- -->36` and every assertion about the sentence passes over nothing —
          * which is exactly how it was caught here. The rule is written down; this is it applied.
          */}
        <Typography.Text className="pr-scope-text">
          {`${report.rowCount.toLocaleString()} of ${report.spineTotal.toLocaleString()} ${report.spine}`}
        </Typography.Text>

        {/*
          * The frame's assumptions, stated. Each is a slot the question was filled in with — and the
          * horizon among them is **declared, not applied**: nothing in these rosters is sliced by time.
          */}
        {report.assumptions.map((a) => (
          <Tag key={a.slot} variant="outlined" className="pr-assumption">
            {a.label}
          </Tag>
        ))}
      </div>

      {/*
        * ---------------- the filter bar, and it filters ----------------
        *
        * One row per facet: an **All** chip that clears it, then a chip per value with the count the
        * server computed. Clicking re-asks the report through `POST /reports/build`, so the table, the
        * chart *and* the tiles recompute together — the prototype these were ported from hid table rows
        * and left its chart and its four KPIs describing the unfiltered set, which is two readings of one
        * screen.
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
        <div className="pr-facets">
          {report.facets.map((facet) => {
            const chosen = filters.filter((f) => f.key === facet.key).map((f) => f.value)
            return (
              <div key={facet.key} className="pr-facet-row">
                <Typography.Text className="pr-facets-label" id={`pr-facet-${facet.key}`}>
                  {facet.label.toUpperCase()}
                </Typography.Text>

                <Select
                  className="pr-facet-select"
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
            <Typography.Text className="pr-facets-note">
              filtered — every figure below is recomputed for this slice
            </Typography.Text>
          ) : null}
          {filtering ? (
            <Typography.Text className="pr-facets-note">re-asking…</Typography.Text>
          ) : null}
        </div>
      ) : null}

      {/*
        * A spine with no summary to compute says so, and a caveat the frame introduced is printed. Both
        * are the server's sentences — the horizon caveat in particular is the one that keeps the report
        * honest about a filter it states and does not apply.
        */}
      {isBuilt && report.summaryNote ? (
        <Alert className="pr-note" type="info" showIcon={false} description={report.summaryNote} />
      ) : null}
      {isBuilt && report.caveats.length > 0 ? (
        <ul className="pr-caveats">
          {report.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      ) : null}

      {/* A card per block, in the order the report defines them. */}
      {report.blocks.map((block, i) => (
        <ReportBlockView key={`${block.type}-${i}`} block={block} />
      ))}

      <footer className="pr-foot">
        {report.footer.map((note) => (
          <p key={note.label} className="pr-foot-note">
            <b>{note.label}</b> {note.text}
          </p>
        ))}

        {/* Where the figures came from, in the tenant's own words. */}
        {report.sourceTrace ? (
          <p className="pr-foot-note pr-trace">{report.sourceTrace}</p>
        ) : null}

        {/*
          * And which published content answered it. A report is asked *of* a published graph, so naming
          * the version and its hash is what makes the figures checkable — the same claim Ask makes about
          * its answers, for the same reason.
          */}
        {report.graph ? (
          <p className="pr-foot-note pr-graph">
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
      </footer>
    </article>
  )
}
