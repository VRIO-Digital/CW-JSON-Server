/**
 * The published report's primitives, ported from the standalone report app's `src/ui/`.
 *
 * **One file rather than seven, because they are one design.** The folder they came from had a module
 * per primitive so a report could import three of them; here every one of them is used by the same two
 * components, and seven files each holding a twenty-line function is a directory to navigate rather
 * than a boundary that means anything.
 *
 * **Two of the seven did not come across, and both for the same reason: they would have made a claim.**
 *
 * - `ReportChart` wrapped Chart.js. Charts here are `AnswerChart` — the server emits a report's chart in
 *   the answer shape exactly so one component draws an answer and a report, which is why the two cannot
 *   come to disagree about what a bar means. Bringing the wrapper would have added `chart.js` to a
 *   dependency list through a gate that fails on any advisory at `low`, by transcription rather than by
 *   argument.
 * - `FilterBar` held its chip selection in `useState` and filtered the rows in the browser. The facets
 *   here re-ask the report through `POST /reports/build`, so the table, the chart *and* the tiles
 *   recompute together; a local chip bar would leave the chart and the KPIs describing the unfiltered
 *   set, which is two readings of one screen. The strip's chrome survives in `report.css`; the control
 *   inside it is an antd multi-select that sends its selection to the server.
 *
 * Nothing here computes. Every figure these draw is `reportView`'s, per request.
 */

import { Fragment } from 'react'
import type { ReactNode } from 'react'

import './report.css'

/* ------------------------------------------------------------------ the frame */

/**
 * The page frame every report shares: the scoping class, the breadcrumb, the title block and the
 * subject badge.
 *
 * It owns `.cw-report`, which every rule in `report.css` hangs off — so a report carries its own styles
 * wherever it is mounted, and cannot restyle the page around it.
 */
export function ReportShell({
  crumb,
  title,
  subtitle,
  badge,
  children,
}: {
  /** Breadcrumb tail — the report's own title. */
  crumb: string
  title: string
  subtitle: ReactNode
  /** The subject the report is about: the facility, the network. Absent on a report with none. */
  badge?: string | null
  children: ReactNode
}) {
  return (
    <article className="cw-report">
      <div className="wrap">
        <nav className="crumb" aria-label="Breadcrumb">
          Reports &nbsp;·&nbsp; <b>{crumb}</b>
        </nav>

        <header className="rhead">
          <div>
            <h1>{title}</h1>
            <div className="sub">{subtitle}</div>
          </div>
          {/* An absence has no badge — the same rule the studio canvas draws for a node with nothing
              to say. */}
          {badge ? (
            <div className="badge">
              <span className="dot" />
              {badge}
            </div>
          ) : null}
        </header>

        {children}
      </div>
    </article>
  )
}

/** The tenant's lead sentence about what a report *is*, on the two reports that carry one. */
export function Note({ children }: { children: ReactNode }) {
  return <div className="note">{children}</div>
}

/** The source / confidence / graph line closing each report. */
export function Footnote({ children }: { children: ReactNode }) {
  return <div className="foot">{children}</div>
}

/* ------------------------------------------------------------------ the tiles */

/** A tile's tone is the report's own reading of its figure. `plain` is a figure, not a neutral verdict. */
export type KpiTone = 'plain' | 'good' | 'warn' | 'risk'

export type KpiItem = {
  label: string
  value: ReactNode
  unit?: string | null
  tone?: KpiTone
  /** Drops the value to 19px, for a text value such as "Class I". */
  small?: boolean
}

const TONE_CLASS: Record<KpiTone, string> = {
  plain: '',
  good: ' good',
  warn: ' warn',
  risk: ' risk',
}

export function Kpi({ label, value, unit, tone = 'plain', small }: KpiItem) {
  return (
    <div className={`kpi${TONE_CLASS[tone]}`}>
      <div className="k">{label}</div>
      <div className={small ? 'v sm' : 'v'}>{value}</div>
      {unit ? <div className="u">{unit}</div> : null}
    </div>
  )
}

/** The auto-fitting summary row. Four tiles on a report, but the grid does not assume it. */
export function KpiRow({ items }: { items: readonly KpiItem[] }) {
  return (
    <div className="kpis">
      {items.map((item) => (
        <Kpi key={item.label} {...item} />
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ the cards */

/** The bordered panel every chart, table and trace block sits in. */
export function Card({
  title,
  caption,
  children,
}: {
  title?: ReactNode
  caption?: ReactNode
  children?: ReactNode
}) {
  return (
    <section className="card">
      {title ? <h2>{title}</h2> : null}
      {caption ? <div className="cs">{caption}</div> : null}
      {children}
    </section>
  )
}

/* ------------------------------------------------------------------ the table */

export type Column<R> = {
  header: ReactNode
  /**
   * Right-aligned with tabular numerals.
   *
   * **Declared, not sniffed.** A report column states its `kind`, so a penalty column is right-aligned
   * because the field dictionary says it is numeric — never because every cell in this particular slice
   * happened to parse as a number, which is how one report right-aligns a column another leaves ragged.
   */
  num?: boolean
  cell: (row: R) => ReactNode
}

/**
 * The reports' one table shape: sticky uppercase header, hover rows, right-aligned numeric columns,
 * and its own horizontal scroll — an eight-column table must never make the page scroll sideways.
 */
export function DataTable<R>({
  columns,
  rows,
  rowKey,
  rowClassName,
  empty,
}: {
  columns: readonly Column<R>[]
  rows: readonly R[]
  rowKey: (row: R, index: number) => string
  /** Extra class per row — `hl` is the orange subject-row highlight. */
  rowClassName?: (row: R) => string | undefined
  /** Shown in place of the body when a slice matches nothing. */
  empty?: ReactNode
}) {
  return (
    <div className="tablescroll">
      <table>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th key={index} className={column.num ? 'num' : undefined}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="empty" colSpan={columns.length}>
                {/* A headers-only table reads as broken; a sentence reads as a slice that matched
                    nothing, which is what it is. */}
                {empty ?? 'No rows match the filters in force.'}
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr key={rowKey(row, rowIndex)} className={rowClassName?.(row)}>
                {columns.map((column, index) => (
                  <td key={index} className={column.num ? 'num' : undefined}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ the marks */

/** Compliance tiers, plus `cd` for the consent-decree marker. */
export type TagKind = 'high' | 'med' | 'low' | 'cd'

export function Tag({ kind, children }: { kind: TagKind; children?: ReactNode }) {
  return <span className={`tag ${kind}`}>{children ?? kind.toUpperCase()}</span>
}

/** Manifest exception markers: a rejected load, a residue re-manifest, an out-of-state generator. */
export type FlagKind = 'rej' | 'res' | 'oos'

const FLAG_LABEL: Record<FlagKind, string> = {
  rej: 'REJECTED',
  res: 'RESIDUE',
  oos: 'OUT-OF-STATE',
}

export function FlagPill({ kind }: { kind: FlagKind }) {
  return <span className={`flagpill ${kind}`}>{FLAG_LABEL[kind]}</span>
}

/** A file in the uploaded enforcement document set, named as the corpus names it. */
export function DocRef({ children }: { children: ReactNode }) {
  return <span className="docref">{children}</span>
}

/**
 * A custody chain: generator, then each transporter, then the receiving facility.
 *
 * **The order is the fact.** "An order laid into a cell reads as a set", and a comma is exactly that
 * mistake — a manifest's transporters held the waste in the sequence shown, so they are joined with
 * arrows and the last node is drawn as the destination.
 */
export function Chain({ nodes }: { nodes: readonly string[] }) {
  const last = nodes.length - 1
  return (
    <div className="chain">
      {nodes.map((node, index) => (
        <Fragment key={`${node}-${index}`}>
          {index > 0 ? (
            <span className="arw" aria-hidden="true">
              →
            </span>
          ) : null}
          <span className={index === last && last > 0 ? 'node dest' : 'node'}>
            {index === 0 ? <b>{node}</b> : node}
          </span>
        </Fragment>
      ))}
    </div>
  )
}
