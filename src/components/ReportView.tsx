import { Alert, Card, Tag, Typography } from 'antd'
import { Fragment, type ReactNode } from 'react'
import type { BuiltReport, Report } from '../api/client'
import ReportBlock from './ReportBlock'
import StatCards from './StatCards'
import '../pages/ReportsPage.css'
import { SP } from '../theme'

/*
 * **One report template, for all three ways a report is reached** — read off the section,
 * built in the wizard, or opened from the library.
 *
 * It is one component because they are one thing. The package ships five rendered reports
 * with a fixed anatomy — heading, the facility it is about, a lead note, the question, four
 * summary tiles, the blocks, and a footer stating the source table and the confidence — and
 * a report composed in the wizard is that same anatomy asked under a different frame. When
 * this layout lived in two files the wizard's copy had already drifted: no badge, its own
 * tag row, a different footer. Two templates for one document is two answers to "what does
 * a report look like".
 *
 * Everything here is rendered from the payload. The only things this component decides are
 * where a piece goes and what a missing piece means — a report with no lead note shows no
 * alert, a generated one shows no authored tiles, and a summary that is not defined for a
 * roster says so rather than leaving a gap.
 */
export default function ReportView({
  report,
  actions,
  provenance,
  onSlice,
  slicing,
}: {
  /** A written report, or a built one — a `BuiltReport` adds its variant and caveats. */
  report: Report | BuiltReport
  /** Buttons for this surface: Open, Edit, Save — the template has none of its own. */
  actions?: ReactNode
  /** Who saved it and when, where that applies. Never invented: absent unless passed. */
  provenance?: ReactNode
  /**
   * Called when a chip is picked — with the facet and value, or null for "all".
   *
   * The chip does not hide rows: it hands the slice up so the report is **re-asked**, and
   * every figure comes back computed for it. A local filter would leave the tiles and the
   * charts describing a set the table no longer shows, which is two answers on one screen.
   * A surface that cannot re-ask (there is none today) simply passes nothing and gets no bar.
   */
  onSlice?: (filter: { key: string; value: string } | null) => void
  slicing?: boolean
}) {
  const built = 'variant' in report ? report : null
  const active = built?.filters ?? []

  return (
    <>
      <div className="rp-view-head">
        <div>
          <div className="rp-chips">
            <Tag className="rp-chip">{report.reportTag}</Tag>
            {/* Written or generated, stated on the report itself: a generated report's
                figures were computed for its frame and are not the tenant's authored
                ones, and a reader has to be able to tell which they are reading. */}
            {built ? (
              <Tag className="rp-chip">
                {built.variant === 'written'
                  ? 'the standard report'
                  : 'generated for this frame'}
              </Tag>
            ) : null}
          </div>
          <Typography.Title level={3} className="rp-view-title">
            {report.heading}
          </Typography.Title>
          <p className="rp-view-sub">{report.subtitle}</p>
        </div>
        <div className="rp-view-aside">
          <span className="rp-badge">{report.badge}</span>
          {actions ? <span className="rp-view-actions">{actions}</span> : null}
        </div>
      </div>

      {/* Only two of the five carry a lead note, and it is the report's own claim about
          itself — printed as given rather than summarised. */}
      {report.note ? (
        /* The note alone, as the package prints it: a tinted paragraph. Using the report's
           `title` as a heading above it added a line the rendered report does not have, and
           put a second name on a document that already has one. */
        <Alert className="rp-note" type="info" description={report.note} />
      ) : null}

      {/*
       * The question, and the assumptions it was asked under. This is what makes the page a
       * report rather than a dashboard: the sentence states the scope, the ranking and the
       * window, so no figure below can be read out of context.
       */}
      <Card size="small" className="rp-reading" style={{ marginBottom: SP.lg }}>
        <Typography.Text strong>{report.question}</Typography.Text>
        <p className="rp-reading-text">{report.reading}</p>
        <div className="rp-chips">
          {report.assumptions.map((a) => (
            <Tag key={a.slot} className="rp-chip">
              {a.slot}: {a.label}
            </Tag>
          ))}
          {built?.filters.map((f) => (
            <Tag key={f.key} className="rp-chip">
              {f.label}: {f.valueLabel}
            </Tag>
          ))}
          {/* What it is about, in rows. "4 of 36" is the consent-decree report's whole
              point, and a report over its full spine says so plainly. */}
          <Tag className="rp-chip">
            {report.rowCount === report.spineTotal
              ? `all ${report.spineTotal} ${report.spine}`
              : `${report.rowCount} of ${report.spineTotal} ${report.spine}`}
          </Tag>
        </div>
      </Card>

      {/*
       * The chip bar, as the package's own reports carry it. Every value states its count, so
       * an empty facet reads as "none of these" rather than as a chip that failed, and the
       * chips are **neutral**: a slice is a category, not a state.
       */}
      {onSlice && report.facets.length > 0 ? (
        <div className="rp-fbar">
          {report.facets.map((facet) => (
            <div key={facet.key} className="rp-fgroup">
              <span className="rp-label">{facet.label}</span>
              <button
                type="button"
                className={`rp-fchip${active.every((f) => f.key !== facet.key) ? ' is-on' : ''}`}
                disabled={slicing}
                onClick={() => onSlice(null)}
              >
                All
              </button>
              {facet.values.map((v) => {
                const on = active.some((f) => f.key === facet.key && f.value === v.value)
                return (
                  <button
                    key={v.value}
                    type="button"
                    className={`rp-fchip${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    disabled={slicing}
                    onClick={() => onSlice(on ? null : { key: facet.key, value: v.value })}
                  >
                    {v.label}
                    <span className="rp-dim"> {v.count}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      ) : null}

      {/* Wrapped so the report's own density can be scoped to it: the package's tiles are
          compact — an 11.5px label over a 27px figure — and `StatCards` is shared with the
          telemetry pages, which set their own. */}
      {report.tiles.length > 0 ? (
        <div className="rp-tiles">
        <StatCards
          stats={report.tiles.map((t) => ({
            label: t.label,
            value: t.value,
            note: t.unit,
            tone: t.tone ?? undefined,
          }))}
        />
        </div>
      ) : null}
      {built?.summaryNote ? (
        <Alert
          type="info"
          showIcon
          title="No summary for this roster"
          description={built.summaryNote}
          style={{ marginBottom: SP.lg }}
        />
      ) : null}

      {report.blocks.map((block) => (
        <ReportBlock key={`${block.type}:${block.title}`} block={block} />
      ))}

      {/*
       * The footer is the report's own provenance — which table, how confident, what it is
       * scoped to — as the labelled segments the package wrote rather than one flattened
       * sentence, because the labels differ per report ("Bridge.", "Why it matters.") and
       * each is that report's own reading.
       */}
      <div className="rp-foot">
        <dl className="rp-foot-defs">
          {report.footer.map((f) => (
            <Fragment key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.text}</dd>
            </Fragment>
          ))}
        </dl>
        <p className="rp-dim">{report.sourceTrace}</p>
        {/* What the figures cannot say about themselves: the caveats the server computed,
            including the horizon's, and which published content answered this. */}
        {built?.caveats.map((c) => (
          <p key={c} className="rp-dim">
            {c}
          </p>
        ))}
        {report.graph ? (
          <p className="rp-dim">
            {report.graph.live === false ? 'Was asked of ' : 'Answered against '}
            <b>{report.graph.name}</b>
            {report.graph.version ? ` ${report.graph.version}` : ''}
            {report.graph.sha256 ? (
              <>
                {' · '}
                <code>{report.graph.sha256}</code>
              </>
            ) : null}
            {/* Who published that graph — the person who pressed Publish, recorded from
                the browser's own identity because the server has none to look up. It falls
                back to the tenant's account for a version published before that was wired,
                or by a caller that sent no identity. */}
            {report.graph.publishedBy ? `, published by ${report.graph.publishedBy}` : ''}
          </p>
        ) : null}
        {provenance}
      </div>
    </>
  )
}
