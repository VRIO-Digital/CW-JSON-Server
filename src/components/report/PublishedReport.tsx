/**
 * One report, rendered the way the tenant's own `Report_N_*.html` renders it.
 *
 * **A port of the rendered reports in `src/07_reports/`, not a transcription of them.** Those five files
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

import { Alert, Tag, Typography } from 'antd'

import type { Report } from '../../api/client'
import ReportBlockView from './ReportBlocks'
import './PublishedReport.css'

/** A tile's tone, as the report read its own figure. `null` is a plain figure, not a neutral verdict. */
const TONE_CLASS: Record<string, string> = {
  good: 'is-good',
  warn: 'is-warn',
  crit: 'is-crit',
}

export default function PublishedReport({ report }: { report: Report }) {
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
        * The facets the report can be sliced by, as its filter bar — rendered, and stating the frame it
        * was built under rather than offering to change it. See the note at the top of this file.
        */}
      {report.facets.length > 0 ? (
        <div className="pr-facets">
          <Typography.Text className="pr-facets-label">SLICEABLE BY</Typography.Text>
          {report.facets.map((facet) => (
            <span key={facet.key} className="pr-facet">
              {facet.label}
            </span>
          ))}
          <Typography.Text className="pr-facets-note">
            stated, not applied — this report was built on the whole scope above
          </Typography.Text>
        </div>
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
