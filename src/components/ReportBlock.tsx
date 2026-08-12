import { Card, Col, Row, Table, Tag, Typography, type TableColumnsType } from 'antd'
import type { ReportBlock as Block, ReportCell, ReportColumn, ReportRow } from '../api/client'
import { SP } from '../theme'
import AnswerChart from './AnswerChart'
import StatusTag from './StatusTag'
import '../pages/ReportsPage.css'

/*
 * One block of a report.
 *
 * Five kinds, and each is a way of reading one roster: a chart ranks it, a table lists
 * it, the scorecard compares the subject facility against its peers, the quarterly
 * block trends it, and the trace block walks a custody chain. The server decides what
 * each block contains — every series, every row order — so this file only renders.
 *
 * **Charts come from `AnswerChart`.** A report's chart payload *is* an answer's chart
 * payload, so the same hand-drawn SVG draws both: one hue for magnitude, a line for a
 * trend, a values table under each so nothing is colour-only. A second chart component
 * here would be a second set of rules about what a bar means.
 */

/** A risk tier is an assessment of state, so it wears a status tag — icon and label. */
const RISK_TONE = { high: 'crit', med: 'warn', low: 'good' } as const

/**
 * A cell, formatted for reading.
 *
 * Formatting only — nothing here derives a figure. `penalty` carries a currency mark
 * because a bare 397,500 in a column headed "Penalty exposure" is a number the reader
 * has to be told the unit of; a custody chain is a list and renders as its links; and a
 * boolean flag renders as a **neutral** tag, because "under a consent decree" is a
 * category and a status colour would make it a state.
 */
function cell(value: ReportCell, column: ReportColumn) {
  if (Array.isArray(value)) {
    return (
      <span className="rp-chain">
        {value.map((link) => (
          <span key={link} className="rp-chain-node">
            {link}
          </span>
        ))}
      </span>
    )
  }
  if (typeof value === 'boolean') return value ? <Tag>Yes</Tag> : <span className="rp-dim">—</span>
  if (column.key === 'risk' && typeof value === 'string' && value in RISK_TONE) {
    return <StatusTag tone={RISK_TONE[value as keyof typeof RISK_TONE]}>{value}</StatusTag>
  }
  if (typeof value === 'number') {
    const text = value.toLocaleString(undefined, { maximumFractionDigits: 1 })
    return column.key === 'penalty' ? `$${text}` : text
  }
  return value === '' || value === undefined ? <span className="rp-dim">—</span> : value
}

const columnsFor = (columns: ReportColumn[]): TableColumnsType<ReportRow> =>
  columns.map((c) => ({
    title: c.label,
    dataIndex: c.key,
    key: c.key,
    align: c.kind === 'num' ? 'right' : 'left',
    render: (value: ReportCell) => cell(value, c),
  }))

/** Every roster carries its own id column, so the row key comes from the columns. */
const rowKeyFor = (columns: ReportColumn[]) => (row: ReportRow) =>
  String(row[columns[0]?.key ?? ''] ?? JSON.stringify(row))

function RowTable({
  columns,
  rows,
  /** The scorecard's own facility, marked so the comparison has a subject. */
  subject,
}: {
  columns: ReportColumn[]
  rows: ReportRow[]
  subject?: string | null
}) {
  const subjectKey = columns[0]?.key
  return (
    <Table<ReportRow>
      className="rp-table"
      columns={columnsFor(columns)}
      dataSource={rows}
      rowKey={rowKeyFor(columns)}
      pagination={false}
      size="small"
      scroll={{ x: 'max-content' }}
      rowClassName={(row) =>
        subject && subjectKey && row[subjectKey] === subject ? 'rp-subject' : ''
      }
    />
  )
}

export default function ReportBlock({ block }: { block: Block }) {
  if (block.type === 'chart') {
    /*
     * The chart carries its own caption, so the card does not repeat it. A **companion** — the
     * share beside the ranking — sits in the next column, as the package draws them: the second
     * answers the question the first raises, so they belong on one row rather than stacked as
     * two findings.
     */
    return (
      <Card className="rp-block" style={{ marginBottom: SP.lg }}>
        <Row gutter={[SP.base, SP.base]}>
          <Col xs={24} xl={block.companion ? 14 : 24}>
            <AnswerChart block={block} />
          </Col>
          {block.companion ? (
            <Col xs={24} xl={10}>
              <AnswerChart block={block.companion} />
            </Col>
          ) : null}
        </Row>
      </Card>
    )
  }

  if (block.type === 'table') {
    return (
      <Card
        className="rp-block"
        title={block.title}
        /* The order, stated. A ranked table whose ranking is unnamed invites the reader
           to read the roster's own order as significant. */
        extra={
          block.sortedBy ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              ranked by {block.sortedBy.toLowerCase()}
            </Typography.Text>
          ) : null
        }
        style={{ marginBottom: SP.lg }}
      >
        <RowTable columns={block.columns} rows={block.rows} />
      </Card>
    )
  }

  if (block.type === 'facilities' || block.type === 'quarterly') {
    /*
     * **The charts and the table are two cards**, as the package's reports lay them out — a
     * drawing and the rows behind it are two readings of the roster, not one panel. Two charts
     * sit side by side where there are two; each is capped at its own viewBox width anyway, so
     * a half-width column is the size they were drawn for.
     */
    return (
      <>
        {block.charts.length > 0 ? (
          <Card className="rp-block" style={{ marginBottom: SP.lg }}>
            <Row gutter={[SP.base, SP.base]}>
              {block.charts.map((chart) => (
                <Col key={chart.title} xs={24} xl={block.charts.length > 1 ? 12 : 24}>
                  <AnswerChart block={chart} />
                </Col>
              ))}
            </Row>
          </Card>
        ) : null}
        <Card className="rp-block" title={block.title} style={{ marginBottom: SP.lg }}>
          <RowTable
            columns={block.columns}
            rows={block.rows}
            subject={block.type === 'facilities' ? block.subject : null}
          />
        </Card>
      </>
    )
  }

  /*
   * Traces. Not a grid: a manifest's transporters are *ordered*, and an order laid into
   * a cell reads as a set. Each row is its own chain — generator → each carrier in
   * custody order → the receiving facility — with the flags the manifest carries beside
   * it. The columns still come from the server, so a header here is never invented.
   */
  const label = (key: string) => block.columns.find((c) => c.key === key)?.label ?? key
  return (
    <Card className="rp-block" title={block.title} style={{ marginBottom: SP.lg }}>
      {block.rows.map((row) => (
        <div key={String(row.mtn)} className="rp-trace">
          <div className="rp-trace-head">
            <Typography.Text code>{String(row.mtn)}</Typography.Text>
            <span className="rp-trace-meta">
              {label('shipped')} {String(row.shipped)} · {label('received')}{' '}
              {String(row.received)} · {String(row.days)} {label('days').toLowerCase()} ·{' '}
              {String(row.tons)} tons
            </span>
            <span className="rp-trace-flags">
              {row.rejected === 'Y' ? <StatusTag tone="crit">{label('rejected')}</StatusTag> : null}
              {row.residue === 'Y' ? <StatusTag tone="warn">{label('residue')}</StatusTag> : null}
              <Tag>{String(row.status)}</Tag>
            </span>
          </div>
          <div className="rp-chain">
            <span className="rp-chain-node">
              {String(row.generator)} · {String(row.gen_state)}
            </span>
            {(Array.isArray(row.transporters) ? row.transporters : []).map((t) => (
              <span key={t} className="rp-chain-step">
                <span className="rp-chain-arrow">→</span>
                <span className="rp-chain-node">{t}</span>
              </span>
            ))}
            <span className="rp-chain-step">
              <span className="rp-chain-arrow">→</span>
              <span className="rp-chain-node is-end">Received at VLS</span>
            </span>
          </div>
        </div>
      ))}
    </Card>
  )
}
