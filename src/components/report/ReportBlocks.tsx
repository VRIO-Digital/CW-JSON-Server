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
 * CDN, and the standalone port that replaced this markup wrapped Chart.js as a dependency; adding it
 * back would be a dependency decision made by transcription, through a gate that fails on any advisory
 * at `low`. `d3` is the single exception in this repo and it argued its own case.
 *
 * **A cell's mark is chosen by the column it is in, never by the shape of its value.** A compliance
 * tier is a `Tag`, a consent decree is the purple marker, an enforcement document is a `DocRef`, and a
 * custody chain is a `Chain`. Keying on the column means the register's `risk` column renders as a tier
 * on every report that carries it — sniffing the value would render any three-letter string as one.
 */

import type { ComputedReportBlock, ReportCell, ReportColumn, ReportRow } from '../../api/client'
import AnswerChart from '../AnswerChart'
import { Card, Chain, DocRef, DataTable, FlagPill, Tag, type Column, type TagKind } from './ui'

/** The compliance tiers the register carries, so an unexpected value renders as text rather than a tier. */
const TIERS: readonly string[] = ['high', 'med', 'low']

/**
 * One cell, marked by the column it sits in.
 *
 * The default is the value formatted for reading — a number with its thousands separators, a boolean as
 * a word, a list as a chain. Everything above that default is a column this section has a mark for.
 */
function cellOf(column: ReportColumn, value: ReportCell) {
  /* A list is a custody chain — the transporters in the order they held the waste. Joined with arrows
     rather than commas: "an order laid into a cell reads as a set". */
  if (Array.isArray(value)) return <Chain nodes={value} />

  if (column.key === 'risk' && typeof value === 'string' && TIERS.includes(value)) {
    return <Tag kind={value as TagKind} />
  }

  /* The bridge from the manifest stream to the enforcement corpus. `false` is not a decree, and an
     em dash says so without asserting a state. */
  if (column.key === 'cd') return value ? <Tag kind="cd">CD</Tag> : <>—</>

  /* The file the generator is named in, as the uploaded corpus names it. */
  if (column.key === 'document') return value ? <DocRef>{String(value)}</DocRef> : <>—</>

  /* A trace's exceptions. The roster carries these as `Y`/`N`, so only the `Y` is a marker: a pill
     reading "not rejected" would be a flag on a load that has none. */
  if (column.key === 'rejected') return value === 'Y' ? <FlagPill kind="rej" /> : <>—</>
  if (column.key === 'residue') return value === 'Y' ? <FlagPill kind="res" /> : <>—</>

  if (typeof value === 'boolean') return <>{value ? 'Yes' : 'No'}</>
  if (typeof value === 'number') return <>{value.toLocaleString()}</>
  return <>{value}</>
}

/** Which column names a row, per spine — how the subject row is found without guessing. */
const SUBJECT_KEY: Record<string, string> = {
  facilities: 'facility',
}

/**
 * The table every tabular block draws, with the subject row marked where there is one.
 *
 * Four of the five block kinds are a table over columns and rows; what differs is the subject and the
 * charts above it. One renderer, so a scorecard and a register cannot come to align their numbers
 * differently.
 */
function BlockTable({
  columns,
  rows,
  subjectKey,
  subject,
  sortedBy,
}: {
  columns: ReportColumn[]
  rows: ReportRow[]
  subjectKey?: string
  subject?: string | null
  sortedBy?: string | null
}) {
  const cols: Column<ReportRow>[] = columns.map((c) => ({
    header: c.label,
    /* Alignment is the column's declared `kind`, read once here and used by both the header and the
       cell — `DataTable` takes one flag, so the two can no longer drift apart. */
    num: c.kind === 'num',
    cell: (row) => cellOf(c, row[c.key]),
  }))

  return (
    <>
      {/* An unexplained order reads as significant, so a ranking says what it is ranked by.
          One expression, not `Ranked by {sortedBy}`: `renderToString` puts a comment node between an
          interpolation and its neighbouring text, so the two-part form renders as
          `Ranked by<!-- --> tonnage` and every assertion about the sentence passes over nothing. */}
      {sortedBy ? <span className="sorted">{`Ranked by ${sortedBy}`}</span> : null}

      <DataTable
        columns={cols}
        rows={rows}
        rowKey={(_, index) => String(index)}
        /* The facility the scorecard is *about*, marked rather than moved: a subject sorted to the top
           would misreport the ranking the server computed. */
        rowClassName={(row) =>
          subject && subjectKey && String(row[subjectKey] ?? '') === subject ? 'hl' : undefined
        }
      />

      {/* A count the reader can check the table against, rather than counting rows themselves.
          One expression — see the note on the scope line in PublishedReport. */}
      <span className="rowcount">{`${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`}</span>
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
function Charts({ charts }: { charts: readonly ComputedReportBlock[] }) {
  return (
    <div className={charts.length > 1 ? 'charts pair' : 'charts'}>
      {charts.map((c, i) => (
        <AnswerChart key={i} block={c as Extract<ComputedReportBlock, { type: 'chart' }>} />
      ))}
    </div>
  )
}

export default function ReportBlockView({ block }: { block: ComputedReportBlock }) {
  if (block.type === 'chart') {
    const { companion, ...chart } = block
    return (
      <Card>
        <Charts charts={companion ? [chart, companion] : [chart]} />
      </Card>
    )
  }

  return (
    <Card title={block.title}>
      {/* The charts a scorecard or a trend states above its detail, each the server's own. */}
      {'charts' in block && block.charts.length > 0 ? <Charts charts={block.charts} /> : null}

      <BlockTable
        columns={block.columns}
        rows={block.rows}
        subjectKey={SUBJECT_KEY[block.type]}
        subject={block.type === 'facilities' ? block.subject : null}
        sortedBy={block.type === 'table' ? block.sortedBy : null}
      />
    </Card>
  )
}
