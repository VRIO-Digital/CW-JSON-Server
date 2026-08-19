/**
 * The five kinds of block a report is made of, drawn from the payload the server computed.
 *
 * **Nothing here calculates.** `reportView` derives every series, every row order and every count per
 * request, because `db.reports` stores no result — so a component that summed a column would be a
 * second answer to a figure the report already states. These render.
 *
 * **Charts are `AnswerChart`, not a chart library.** The server emits a report's chart in the answer
 * shape exactly so one component draws both, which is why an answer and a report cannot come to
 * disagree about what a bar means. The rendered HTML these were converted from used Chart.js from a
 * CDN; adding it back would be a dependency decision made by transcription — and the audit gate is the
 * reason this repo hand-writes its SVG. `d3` is the single exception and it argued its own case.
 *
 * **Alignment is declared, not sniffed.** A report column states its `kind`, so a column of penalties
 * is right-aligned because the field dictionary says it is numeric — never because every cell in this
 * particular slice happened to parse as a number, which is how an empty column comes to be left-aligned
 * on one report and right on another.
 */

import { Typography } from 'antd'

import type { ReportBlock, ReportCell, ReportColumn, ReportRow } from '../../api/client'
import AnswerChart from '../AnswerChart'
import './ReportBlocks.css'

/**
 * One cell.
 *
 * A list is a **custody chain** — a manifest's transporters in the order they held the waste — so it is
 * joined with arrows rather than commas. "An order laid into a cell reads as a set" is the rule the
 * traces block exists to keep, and a comma is exactly that mistake.
 */
function Cell({ value }: { value: ReportCell }) {
  if (Array.isArray(value)) {
    return (
      <span className="rb-chain">
        {value.map((step, i) => (
          <span key={`${step}-${i}`} className="rb-chain-step">
            {i > 0 ? <span className="rb-chain-arrow" aria-hidden="true">→</span> : null}
            {step}
          </span>
        ))}
      </span>
    )
  }
  if (typeof value === 'boolean') return <>{value ? 'Yes' : 'No'}</>
  if (typeof value === 'number') return <>{value.toLocaleString()}</>
  return <>{value}</>
}

/**
 * The table every tabular block draws, with the subject row marked where there is one.
 *
 * Four of the five block kinds are a table over columns and rows; what differs is the subject and the
 * charts above it. One renderer, so a scorecard and a register cannot come to align their numbers
 * differently.
 */
function ReportTable({
  columns,
  rows,
  subjectKey,
  subject,
  sortedBy,
}: {
  columns: ReportColumn[]
  rows: ReportRow[]
  /** Which column carries the row's name, for marking the subject. */
  subjectKey?: string
  subject?: string | null
  sortedBy?: string | null
}) {
  return (
    <>
      {/* An unexplained order reads as significant, so a ranking says what it is ranked by. */}
      {sortedBy ? (
        <Typography.Text className="rb-sorted">Ranked by {sortedBy}</Typography.Text>
      ) : null}

      {/* Its own scroll container: an eight-column table must never make the page scroll sideways. */}
      <div className="rb-table-scroll">
        <table className="rb-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.kind === 'num' ? 'rb-num' : undefined}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              /* The facility the scorecard is *about*, marked rather than moved: a subject sorted to
                 the top would misreport the ranking the server computed. */
              const isSubject =
                Boolean(subject) && subjectKey ? String(row[subjectKey] ?? '') === subject : false
              return (
                <tr key={i} className={isSubject ? 'is-subject' : undefined}>
                  {columns.map((c) => (
                    <td key={c.key} className={c.kind === 'num' ? 'rb-num' : undefined}>
                      <Cell value={row[c.key]} />
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* A count the reader can check the table against, rather than counting rows themselves. */}
      {/* One expression — see the note on the scope line in PublishedReport. */}
      <Typography.Text className="rb-rowcount">
        {`${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`}
      </Typography.Text>
    </>
  )
}

/**
 * A report's chart, and the companion the server computed beside it where there is one.
 *
 * The companion answers a question the first chart *raises* — the decree report ranks four generators
 * by exposure and shows the whole register's compliance split next to it — so it is drawn beside rather
 * than folded in, and it is the server's chart, not a second reading of the first.
 */
function ChartCard({ block }: { block: Extract<ReportBlock, { type: 'chart' }> }) {
  const { companion, ...chart } = block
  return (
    <div className={companion ? 'rb-charts is-pair' : 'rb-charts'}>
      <AnswerChart block={chart} />
      {companion ? <AnswerChart block={companion} /> : null}
    </div>
  )
}

/** Which column names a row, per spine — how the subject row is found without guessing. */
const SUBJECT_KEY: Record<string, string> = {
  facilities: 'facility',
}

export default function ReportBlockView({ block }: { block: ReportBlock }) {
  if (block.type === 'chart') {
    return (
      <section className="rb-card">
        <ChartCard block={block} />
      </section>
    )
  }

  return (
    <section className="rb-card">
      <h3 className="rb-title">{block.title}</h3>

      {/* The charts a scorecard or a trend states above its detail, each the server's own. */}
      {'charts' in block && block.charts.length > 0 ? (
        <div className={block.charts.length > 1 ? 'rb-charts is-pair' : 'rb-charts'}>
          {block.charts.map((c, i) => (
            <AnswerChart key={i} block={c} />
          ))}
        </div>
      ) : null}

      <ReportTable
        columns={block.columns}
        rows={block.rows}
        subjectKey={SUBJECT_KEY[block.type === 'facilities' ? 'facilities' : block.type]}
        subject={block.type === 'facilities' ? block.subject : null}
        sortedBy={block.type === 'table' ? block.sortedBy : null}
      />
    </section>
  )
}
