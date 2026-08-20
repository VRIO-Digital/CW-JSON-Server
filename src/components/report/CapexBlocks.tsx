/**
 * The seventeen block kinds a Northline capital report is made of.
 *
 * **Nothing here computes a figure, and for a different reason than the EPA blocks.** Those render a
 * payload `reportView` derived per request, so a component that summed a column would be a second
 * answer to a number the server already gave. These render a payload the *tenant's own resolver*
 * produced: every figure arrives with `display` (the short form), `exact` (the full one), its
 * coordinate (`basis × period frame × vintage`), and often a provenance id. Recomputing any of it
 * would be reimplementing that resolver from its output — and the register these reports are asked of
 * carries a project's region, category and phase, not its actuals, so the recomputation would be
 * weaker figures under the same headings.
 *
 * So this file's whole job is to draw what it was given, and the interesting decisions are about what
 * it must *not* drop:
 *
 * - **A coordinate is not decoration.** `$4.41B` on record basis this period and `$5.00B` on
 *   commitment basis this period are different questions, and the package states the difference on
 *   every figure. `coordStated` is rendered wherever it exists; a figure shown without it invites the
 *   reader to subtract two numbers the report never licensed subtracting.
 * - **A coverage seam is the point of several of these blocks.** The 60 projects are a proportional
 *   sample of a declared 4,500-project programme; the tables foot to the sample and the headline
 *   cards foot to the programme. The package labels that seam per block and so does this.
 * - **A refusal is content.** `whyNoTotal`, `unbackedNote`, `maskNote`, `emptyCause`, `floorNote` and
 *   `noPackagesNote` all say why something a reader expects is absent. Dropping them leaves a gap
 *   that reads as a rendering fault instead of a stated limit.
 *
 * **Charts are hand-drawn SVG.** The rendered HTML in `src/report/` uses Chart.js from a CDN;
 * transcribing that would be a dependency decision made by accident, through a gate that fails on any
 * advisory at `low`. `d3` is this repo's one argued exception and it is the graph viewer's.
 */

import type { ReactNode } from 'react'
import './capex-report.css'

/* ---------------- the payload, as the resolver states it ---------------- */

/** One figure: a number or a string, already formatted, with the coordinate it was read at. */
export type Figure = {
  key?: string
  label?: string | null
  measure?: string | null
  measureLabel?: string | null
  unit?: string | null
  signed?: boolean
  coordStated?: string | null
  raw?: number | string | null
  display?: string | null
  exact?: string | null
  note?: string | null
  absent?: boolean
  masked?: boolean
  why?: string | null
}

type Population = { kind?: string; n?: number | null; label?: string | null; note?: string | null } | null

export type CapexBlock = {
  id: string
  type: string
  label?: string | null
  grain?: string | null
  source?: unknown
  note?: string | null
  coverage?: Population
  population?: Population
  [key: string]: unknown
}

/* ---------------- small shared marks ---------------- */

/** A figure's own value, with the exact form on hover and the coordinate beneath it. */
function Fig({ figure, size = 'md' }: { figure: Figure; size?: 'sm' | 'md' | 'lg' }) {
  const signed = figure.signed && typeof figure.raw === 'number'
  const tone = signed ? (Number(figure.raw) < 0 ? 'neg' : 'pos') : 'plain'
  return (
    <span className={`cxr-fig is-${size} is-${tone}`}>
      <span className="cxr-fig-value" title={figure.exact ?? undefined}>
        {figure.display ?? '——'}
      </span>
      {figure.coordStated ? <span className="cxr-fig-coord">{figure.coordStated}</span> : null}
    </span>
  )
}

/**
 * A note the package wrote, rendered as the tenant's words rather than paraphrased.
 *
 * Several of these are refusals — why there is no total, why a column is masked, why a row is
 * unbacked — and a refusal that is not shown reads as a rendering fault.
 */
function BlockNote({ children, kind = 'note' }: { children: ReactNode; kind?: 'note' | 'refusal' | 'seam' }) {
  if (!children) return null
  return <p className={`cxr-note is-${kind}`}>{children}</p>
}

/** The seam between the rows shown and the population they stand for. */
function Coverage({ population }: { population: Population }) {
  if (!population?.note && !population?.label) return null
  return (
    <BlockNote kind="seam">
      {population.label ? <strong>{population.label}. </strong> : null}
      {population.note}
    </BlockNote>
  )
}

function BlockFrame({
  block,
  children,
  wide,
}: {
  block: CapexBlock
  children: ReactNode
  wide?: boolean
}) {
  return (
    <section className={`cxr-block${wide ? ' is-wide' : ''}`} aria-label={block.label ?? block.type}>
      <header className="cxr-block-head">
        <h3 className="cxr-block-title">{block.label}</h3>
        {block.grain ? <span className="cxr-block-grain">{block.grain}</span> : null}
      </header>
      {children}
      <BlockNote>{block.note as string}</BlockNote>
      <Coverage population={(block.coverage ?? block.population) as Population} />
    </section>
  )
}

/* ---------------- 1. figRow — the headline figures ---------------- */

function FigRow({ block }: { block: CapexBlock }) {
  const figures = (block.figures ?? []) as Figure[]
  const bases = (block.basesPresent ?? []) as string[]
  return (
    <BlockFrame block={block}>
      <div className="cxr-figrow">
        {figures.map((f) => (
          <div className="cxr-figcard" key={f.key}>
            <span className="cxr-figcard-label">{f.label}</span>
            <Fig figure={f} size="lg" />
            {f.note ? <span className="cxr-figcard-note">{f.note}</span> : null}
          </div>
        ))}
      </div>
      {/* Which bases are on this strip, and what may be done across them. Two figures at two bases
          sitting side by side is exactly where a reader starts subtracting without a licence. */}
      {bases.length > 1 ? (
        <BlockNote kind="refusal">
          {block.combinesNote as string}
          {block.basisNote ? ` ${block.basisNote as string}` : null}
        </BlockNote>
      ) : null}
    </BlockFrame>
  )
}

/* ---------------- 2. bar — columns with a baseline drawn as a line ---------------- */

type Series = { key: string; label: string; coordStated?: string; values: Figure[] }

function Bar({ block }: { block: CapexBlock }) {
  const axis = (block.axis ?? []) as string[]
  const series = (block.series ?? []) as Series[]
  const baseline = block.baseline as (Series & { label: string }) | null
  const main = series[0]
  if (!main) return <BlockFrame block={block}>{null}</BlockFrame>

  const all = [
    ...main.values.map((v) => Number(v.raw ?? 0)),
    ...((baseline?.values ?? []).map((v) => Number(v.raw ?? 0))),
  ]
  const max = Math.max(1, ...all)

  return (
    <BlockFrame block={block} wide>
      {block.axisLabel ? <p className="cxr-axis-label">{block.axisLabel as string}</p> : null}
      <div className="cxr-bars">
        {axis.map((name, i) => {
          const value = main.values[i]
          const base = baseline?.values?.[i]
          const h = (Number(value?.raw ?? 0) / max) * 100
          const bh = base ? (Number(base.raw ?? 0) / max) * 100 : null
          return (
            <div className="cxr-bar-col" key={name}>
              <div className="cxr-bar-plot">
                <div className="cxr-bar-fill" style={{ height: `${h}%` }} title={value?.exact ?? undefined} />
                {/* The baseline is a *line over the bar*, not a second bar. The package says why:
                    plan is commitment basis and actual is record basis, and drawing them as equal
                    siblings invites a reader to add them. The gap is the one licensed subtraction. */}
                {bh !== null ? (
                  <div className="cxr-bar-baseline" style={{ bottom: `${bh}%` }} title={base?.exact ?? undefined}>
                    <span className="cxr-bar-baseline-tag">{base?.display}</span>
                  </div>
                ) : null}
              </div>
              <span className="cxr-bar-value">{value?.display}</span>
              <span className="cxr-bar-name">{name}</span>
            </div>
          )
        })}
      </div>
      <div className="cxr-legend">
        <span className="cxr-legend-item">
          <i className="cxr-swatch is-fill" /> {main.label}
          {main.coordStated ? <em> · {main.coordStated}</em> : null}
        </span>
        {baseline ? (
          <span className="cxr-legend-item">
            <i className="cxr-swatch is-line" /> {baseline.label}
            {baseline.coordStated ? <em> · {baseline.coordStated}</em> : null}
          </span>
        ) : null}
      </div>
    </BlockFrame>
  )
}

/* ---------------- 3. heatmap — signed dollars on a diverging scale ---------------- */

type Cell = { row: string; col: string; raw: number; display: string; exact?: string; side?: string; sideLabel?: string }

function Heatmap({ block }: { block: CapexBlock }) {
  const rows = (block.rows ?? []) as string[]
  const cols = (block.cols ?? []) as string[]
  const cells = (block.cells ?? []) as Cell[][]
  const extreme = Math.max(1, Number(block.extremeMagnitude ?? 1))
  const rowTotals = (block.rowTotals ?? []) as { row: string; display: string }[]
  const colTotals = (block.colTotals ?? []) as { col: string; display: string }[]
  const total = block.total as Figure | undefined

  return (
    <BlockFrame block={block} wide>
      <div className="cxr-scroll">
        <table className="cxr-heat">
          <thead>
            <tr>
              <th />
              {cols.map((c) => (
                <th key={c} className="cxr-heat-colhead">
                  {c}
                </th>
              ))}
              <th className="cxr-heat-total">Row total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={r}>
                <th className="cxr-heat-rowhead">{r}</th>
                {cols.map((c, ci) => {
                  const cell = cells[ri]?.[ci]
                  /* Intensity is |value| against the block's own stated extreme, so the darkest cell
                     is the largest one the resolver found — never a scale chosen here. */
                  const weight = cell ? Math.abs(Number(cell.raw)) / extreme : 0
                  return (
                    <td
                      key={c}
                      className={`cxr-heat-cell is-${cell?.side ?? 'zero'}`}
                      style={{ '--w': weight } as React.CSSProperties}
                      title={cell ? `${cell.exact ?? cell.display} — ${cell.sideLabel ?? ''}` : undefined}
                    >
                      {cell?.display ?? '—'}
                    </td>
                  )
                })}
                <td className="cxr-heat-total">{rowTotals.find((t) => t.row === r)?.display ?? '—'}</td>
              </tr>
            ))}
            <tr className="cxr-heat-footrow">
              <th className="cxr-heat-rowhead">Total</th>
              {cols.map((c) => (
                <td key={c} className="cxr-heat-total">
                  {colTotals.find((t) => t.col === c)?.display ?? '—'}
                </td>
              ))}
              <td className="cxr-heat-total is-grand">{total?.display ?? '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="cxr-legend">
        <span className="cxr-legend-item">
          <i className="cxr-swatch is-neg" /> {(block.scale as { negLabel?: string })?.negLabel}
        </span>
        <span className="cxr-legend-item">
          <i className="cxr-swatch is-pos" /> {(block.scale as { posLabel?: string })?.posLabel}
        </span>
        {block.coordStated ? <span className="cxr-legend-coord">{block.coordStated as string}</span> : null}
      </div>
      {/* The closure assertion is the block's own check that its cells sum to the declared total.
          It is rendered because a heatmap that silently does not close is a table of plausible
          numbers. */}
      <BlockNote kind={block.closes ? 'note' : 'refusal'}>
        {(block.closureNote as string) ?? null}
      </BlockNote>
      <BlockNote>{block.unitNote as string}</BlockNote>
    </BlockFrame>
  )
}

/* ---------------- 4. bubble — two coordinates plotted against each other ---------------- */

type Point = { id: string; label: string; colorBy?: string; x: Figure; y: Figure; r?: Figure }

function Bubble({ block }: { block: CapexBlock }) {
  const points = (block.points ?? []) as Point[]
  const axes = (block.axes ?? []) as { dim: string; label: string; coordStated?: string }[]
  const quadrant = block.quadrant as
    | { xAt: number; yAt: number; labels: Record<string, string>; why?: string }
    | undefined
  const xs = points.map((p) => Number(p.x?.raw ?? 0))
  const ys = points.map((p) => Number(p.y?.raw ?? 0))
  const xMin = Math.min(0, ...xs)
  const xMax = Math.max(1, ...xs)
  const yMin = Math.min(...ys, 0)
  const yMax = Math.max(...ys, 0)
  const px = (v: number) => ((v - xMin) / (xMax - xMin || 1)) * 100
  const py = (v: number) => 100 - ((v - yMin) / (yMax - yMin || 1)) * 100
  const categories = [...new Set(points.map((p) => p.colorBy).filter(Boolean))] as string[]

  return (
    <BlockFrame block={block} wide>
      <div className="cxr-bubble">
        {quadrant ? (
          <>
            <div className="cxr-quad-v" style={{ left: `${px(quadrant.xAt)}%` }} />
            <div className="cxr-quad-h" style={{ top: `${py(quadrant.yAt)}%` }} />
            {(['tl', 'tr', 'bl', 'br'] as const).map((corner) => (
              <span key={corner} className={`cxr-quad-label is-${corner}`}>
                {quadrant.labels?.[corner]}
              </span>
            ))}
          </>
        ) : null}
        {points.map((p) => (
          <span
            key={p.id}
            className={`cxr-dot is-c${categories.indexOf(p.colorBy ?? '') % 5}`}
            style={{ left: `${px(Number(p.x?.raw ?? 0))}%`, top: `${py(Number(p.y?.raw ?? 0))}%` }}
            title={`${p.label} · ${axes[0]?.label}: ${p.x?.display} · ${axes[1]?.label}: ${p.y?.display}`}
          />
        ))}
      </div>
      <div className="cxr-axes">
        {axes.map((a) => (
          <span key={a.dim} className="cxr-axis">
            <strong>{a.dim.toUpperCase()}</strong> {a.label}
            {a.coordStated ? <em> · {a.coordStated}</em> : null}
          </span>
        ))}
      </div>
      <div className="cxr-legend">
        {categories.map((c, i) => (
          <span className="cxr-legend-item" key={c}>
            <i className={`cxr-swatch is-c${i % 5}`} /> {c}
          </span>
        ))}
      </div>
      {/* Both axes are coordinates, and the note says they are compared rather than summed. */}
      <BlockNote kind="refusal">{block.axesNote as string}</BlockNote>
      {quadrant?.why ? <BlockNote>{quadrant.why}</BlockNote> : null}
    </BlockFrame>
  )
}

/* ---------------- 5. varianceRows — every admitted row, expandable ---------------- */

type Col = { key: string; label: string; coordStated?: string; signed?: boolean; masked?: boolean }
type Row = { id: string; cells: Figure[] }

function VarianceRows({ block }: { block: CapexBlock }) {
  const columns = (block.columns ?? []) as Col[]
  const rows = (block.rows ?? []) as Row[]
  const rank = block.rank as { stated?: string; why?: string } | undefined
  const populations = (block.populations ?? []) as { key: string; count: number; label: string }[]

  return (
    <BlockFrame block={block} wide>
      {rank?.stated ? (
        <p className="cxr-rank">
          {rank.stated}. <span className="cxr-rank-why">{rank.why}</span>
        </p>
      ) : null}
      <div className="cxr-scroll">
        <table className="cxr-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.signed ? 'is-num' : undefined}>
                  {c.label}
                  {c.coordStated ? <span className="cxr-th-coord">{c.coordStated}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {row.cells.map((cell, i) => (
                  <td key={columns[i]?.key ?? i} className={columns[i]?.signed ? 'is-num' : undefined}>
                    {columns[i]?.masked ? <span className="cxr-masked">masked</span> : <Fig figure={cell} size="sm" />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* How many rows are backed by what. Three populations here, and the third — "the money moved
          and nobody wrote it down" — is the finding, not a footnote. */}
      {populations.length > 0 ? (
        <ul className="cxr-populations">
          {populations.map((p) => (
            <li key={p.key}>
              <strong>{p.count}</strong> {p.label}
            </li>
          ))}
        </ul>
      ) : null}
      <BlockNote>{block.expandNote as string}</BlockNote>
      <BlockNote kind="refusal">{block.noPackagesNote as string}</BlockNote>
      {block.truncated ? <BlockNote kind="refusal">{block.truncationNote as string}</BlockNote> : null}
    </BlockFrame>
  )
}

/* ---------------- 6. reasonMix — what the variance was for ---------------- */

function ReasonMix({ block }: { block: CapexBlock }) {
  const byClass = (block.byClass ?? []) as {
    cls: string
    label: string
    count: number
    projects: number
    amount: Figure
    share: Figure
    pct: number
  }[]
  return (
    <BlockFrame block={block}>
      <BlockNote>{block.leadNote as string}</BlockNote>
      <div className="cxr-mix">
        {byClass.map((c, i) => (
          <div className="cxr-mix-row" key={c.cls}>
            <span className="cxr-mix-label">{c.label}</span>
            <span className="cxr-mix-track">
              <span className={`cxr-mix-fill is-c${i % 5}`} style={{ width: `${c.pct}%` }} />
            </span>
            <span className="cxr-mix-figs">
              <strong title={c.amount?.exact ?? undefined}>{c.amount?.display}</strong>
              <em>{c.share?.display}</em>
              <span className="cxr-mix-count">
                {c.count} across {c.projects} project(s)
              </span>
            </span>
          </div>
        ))}
      </div>
      <BlockNote>{block.coverageNote as string}</BlockNote>
      <BlockNote>{block.grainNote as string}</BlockNote>
    </BlockFrame>
  )
}

/* ---------------- 7. narrative — the tenant's prose, with bound figures ---------------- */

function Narrative({ block }: { block: CapexBlock }) {
  const parts = (block.parts ?? []) as { text?: string; token?: string; figure?: Figure }[]
  return (
    <section className="cxr-block is-narrative" aria-label={block.label ?? 'Narrative'}>
      <h3 className="cxr-block-title">{block.label}</h3>
      <p className="cxr-narrative">
        {parts.map((p, i) =>
          p.figure ? (
            /* A token in the prose is a *bound figure*, so it carries the same value and the same
               exact form as everywhere else it appears. Prose with a number typed into it is the
               oldest way for a report to contradict itself. */
            <strong key={i} className="cxr-narrative-fig" title={p.figure.exact ?? undefined}>
              {p.figure.display}
            </strong>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </p>
      {block.unbound ? <BlockNote kind="refusal">{block.unboundNote as string}</BlockNote> : null}
    </section>
  )
}

/* ---------------- 8. ask — the questions this report can be asked ---------------- */

function Ask({ block }: { block: CapexBlock }) {
  const suggestions = (block.suggestions ?? []) as string[]
  const enabled = block.enabled !== false
  return (
    <section className="cxr-block is-ask" aria-label={block.label ?? 'Ask'}>
      <h3 className="cxr-block-title">{block.label}</h3>
      {enabled ? (
        <ul className="cxr-chips">
          {suggestions.map((s) => (
            <li className="cxr-chip" key={s}>
              {s}
            </li>
          ))}
        </ul>
      ) : (
        <BlockNote kind="refusal">{(block.disabledWhy as string) ?? 'Not available on this report.'}</BlockNote>
      )}
      {/* Which graph and scope an answer would be bound to — the same claim Ask itself makes. */}
      {block.binding ? (
        <p className="cxr-binding">
          Bound to {(block.binding as { graph: string }).graph} · scope{' '}
          {(block.binding as { scope: string }).scope}
        </p>
      ) : null}
    </section>
  )
}

/* ---------------- 9. header — a report's own subject line ---------------- */

function Header({ block }: { block: CapexBlock }) {
  return (
    <section className="cxr-block is-header" aria-label={block.label ?? 'Header'}>
      <h2 className="cxr-header-title">{block.label}</h2>
      {block.sub ? <p className="cxr-header-sub">{block.sub as string}</p> : null}
    </section>
  )
}

/* ---------------- 10. chain — where the money sits, stage by stage ---------------- */

function Chain({ block }: { block: CapexBlock }) {
  const stages = (block.stages ?? []) as Figure[]
  const steps = (block.steps ?? []) as {
    from: string
    to: string
    label: string
    display: string
    crossesBasis?: boolean
    crossesBasisNote?: string | null
  }[]
  const max = Math.max(1, ...stages.map((s) => Math.abs(Number(s.raw ?? 0))))

  return (
    <BlockFrame block={block} wide>
      <div className="cxr-chain">
        {stages.map((s) => (
          <div className="cxr-chain-stage" key={s.key}>
            <span className="cxr-chain-label">{s.label}</span>
            <span className="cxr-chain-track">
              <span
                className="cxr-chain-fill"
                style={{ width: `${(Math.abs(Number(s.raw ?? 0)) / max) * 100}%` }}
              />
            </span>
            <Fig figure={s} size="sm" />
          </div>
        ))}
      </div>
      {steps.length > 0 ? (
        <ul className="cxr-steps">
          {steps.map((st) => (
            <li key={`${st.from}-${st.to}`} className={st.crossesBasis ? 'is-crossing' : undefined}>
              <span className="cxr-step-label">{st.label}</span>
              <span className="cxr-step-delta">{st.display}</span>
              {/* A step that crosses a basis says so: the two ends are different questions, and the
                  delta between them is only meaningful because the package declares it. */}
              {st.crossesBasisNote ? <span className="cxr-step-why">{st.crossesBasisNote}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {/* There is deliberately no total. The reason stands where the total would have gone. */}
      <BlockNote kind="refusal">{block.whyNoTotal as string}</BlockNote>
      <BlockNote>{block.scaleNote as string}</BlockNote>
    </BlockFrame>
  )
}

/* ---------------- 11. progressSplit — cost against physical progress ---------------- */

function ProgressSplit({ block }: { block: CapexBlock }) {
  const left = block.left as Figure
  const right = block.right as Figure
  const cost = block.cost as (Figure & { expr?: string }) | undefined
  const ahead = block.costAheadOfPhysical as (Figure & { signal?: boolean }) | undefined
  const meters: [string, Figure | undefined][] = [
    [left?.label ?? 'Physical', left],
    [right?.label ?? 'Engineering', right],
    [cost?.label ?? 'Cost', cost],
  ]

  return (
    <BlockFrame block={block}>
      <div className="cxr-meters">
        {meters.map(([label, f]) => (
          <div className="cxr-meter" key={label}>
            <span className="cxr-meter-label">{label}</span>
            <span className="cxr-meter-track">
              {/* An absent measure draws no bar. The package marks it `absent` and shows `——`;
                  a zero-width bar would read as 0% complete, which is a different claim. */}
              {f && !f.absent && typeof f.raw === 'number' ? (
                <span className="cxr-meter-fill" style={{ width: `${Math.max(0, Math.min(100, Number(f.raw)))}%` }} />
              ) : null}
            </span>
            <span className="cxr-meter-value">{f?.display ?? '——'}</span>
          </div>
        ))}
      </div>
      {ahead ? (
        <p className={`cxr-signal${ahead.signal ? ' is-on' : ''}`}>
          Cost ahead of physical: <strong>{ahead.display}</strong>
        </p>
      ) : null}
      <BlockNote>{block.signalNote as string}</BlockNote>
    </BlockFrame>
  )
}

/* ---------------- 12. schedule — planned against forecast in-service ---------------- */

function Schedule({ block }: { block: CapexBlock }) {
  const planned = block.planned as Figure
  const forecast = block.forecast as Figure
  const variance = block.variance as Figure
  return (
    <BlockFrame block={block}>
      <div className="cxr-schedule">
        <div className="cxr-sched-cell">
          <span className="cxr-sched-label">Planned in-service</span>
          <strong>{planned?.display ?? '——'}</strong>
        </div>
        <div className="cxr-sched-cell">
          <span className="cxr-sched-label">Forecast in-service</span>
          <strong>{forecast?.display ?? '——'}</strong>
        </div>
        <div className="cxr-sched-cell">
          <span className="cxr-sched-label">{variance?.label ?? 'Slip'}</span>
          <Fig figure={variance} />
        </div>
      </div>
    </BlockFrame>
  )
}

/* ---------------- 13. vendors — commitment exposure by contractor ---------------- */

type VendorRow = Record<string, Figure | string[] | boolean | string>

function Vendors({ block }: { block: CapexBlock }) {
  const columns = (block.columns ?? []) as (string | Col)[]
  const rows = (block.rows ?? []) as VendorRow[]
  const cols = columns.map((c) => (typeof c === 'string' ? { key: c, label: c } : c))
  const rec = block.reconciliation as
    | { total?: Figure; declared?: Figure; agrees?: boolean; note?: string | null }
    | undefined

  return (
    <BlockFrame block={block} wide>
      <div className="cxr-scroll">
        <table className="cxr-table">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={String((row as { id?: string }).id ?? i)}>
                {cols.map((c) => {
                  const v = row[c.key]
                  if (Array.isArray(v)) return <td key={c.key}>{v.join(', ')}</td>
                  if (v && typeof v === 'object') return <td key={c.key}><Fig figure={v as Figure} size="sm" /></td>
                  return <td key={c.key}>{String(v ?? '—')}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Whether the rows foot to the project's declared commitment. A vendor table that does not
          reconcile is a list of plausible numbers, so the check is shown either way. */}
      {rec ? (
        <p className={`cxr-recon${rec.agrees ? ' is-ok' : ' is-off'}`}>
          Rows total {rec.total?.display} against a declared {rec.declared?.display} —{' '}
          {rec.agrees ? 'they agree' : 'they do not agree'}.{rec.note ? ` ${rec.note}` : null}
        </p>
      ) : null}
      {block.masked ? <BlockNote kind="refusal">{block.maskNote as string}</BlockNote> : null}
      {(block.unbacked as unknown[])?.length ? (
        <BlockNote kind="refusal">{block.unbackedNote as string}</BlockNote>
      ) : null}
      {(block.basis as { rule?: string })?.rule ? (
        <BlockNote>{(block.basis as { rule: string }).rule}</BlockNote>
      ) : null}
    </BlockFrame>
  )
}

/* ---------------- 14. lineItems — the contract lines under a project ---------------- */

function LineItems({ block }: { block: CapexBlock }) {
  const groups = (block.groups ?? []) as {
    project: string
    projectCode: string
    projectName: string
    items: Record<string, unknown>[]
  }[]
  if (block.empty) {
    return (
      <BlockFrame block={block}>
        <BlockNote kind="refusal">{(block.why as string) ?? 'Nothing to show.'}</BlockNote>
      </BlockFrame>
    )
  }
  return (
    <BlockFrame block={block} wide>
      {groups.map((g) => (
        <div className="cxr-group" key={g.project}>
          <h4 className="cxr-group-head">
            {g.projectCode} · {g.projectName}
          </h4>
          <ul className="cxr-items">
            {g.items.map((it, i) => (
              <li key={String(it.id ?? i)}>
                <span className="cxr-item-no">{String(it.no ?? '')}</span>
                <span className="cxr-item-title">{String(it.title ?? '')}</span>
                {it.form ? <span className="cxr-item-form">{String(it.form)}</span> : null}
                {it.value && typeof it.value === 'object' ? <Fig figure={it.value as Figure} size="sm" /> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {(block.allocation as { rule?: string })?.rule ? (
        <BlockNote>{(block.allocation as { rule: string }).rule}</BlockNote>
      ) : null}
      <BlockNote>{block.varianceNote as string}</BlockNote>
      {block.masked ? <BlockNote kind="refusal">{block.maskNote as string}</BlockNote> : null}
    </BlockFrame>
  )
}

/* ---------------- 15. annotations — what people and connectors said ---------------- */

function Annotations({ block }: { block: CapexBlock }) {
  const items = (block.items ?? []) as {
    id: string
    provenance: string
    authorName: string
    authorRole?: string
    createdAt: string
    body: string
    bindingLabel?: string
    coordStated?: string
    confidence?: number | null
  }[]
  return (
    <BlockFrame block={block}>
      <ul className="cxr-annos">
        {items.map((a) => (
          <li key={a.id} className={`cxr-anno is-${a.provenance}`}>
            <div className="cxr-anno-head">
              <span className="cxr-anno-author">{a.authorName}</span>
              {a.authorRole ? <span className="cxr-anno-role">{a.authorRole}</span> : null}
              {/* Authored and extracted are different claims about where a note came from, and the
                  tag says which rather than letting both read as somebody's opinion. */}
              <span className="cxr-anno-prov">{a.provenance}</span>
            </div>
            <p className="cxr-anno-body">{a.body}</p>
            {a.bindingLabel ? <span className="cxr-anno-bind">{a.bindingLabel}</span> : null}
          </li>
        ))}
      </ul>
      {Number(block.belowFloorCount ?? 0) > 0 ? (
        <BlockNote kind="refusal">{block.belowFloorNote as string}</BlockNote>
      ) : null}
      <BlockNote>{block.bindingNote as string}</BlockNote>
    </BlockFrame>
  )
}

/* ---------------- 16. filingCalendar — jurisdictions and their windows ---------------- */

function FilingCalendar({ block }: { block: CapexBlock }) {
  const columns = (block.columns ?? []) as Col[]
  const rows = (block.rows ?? []) as {
    id: string
    entryLabel?: string
    recurrence?: string
    cells: Figure[]
    atRisk?: number
  }[]
  return (
    <BlockFrame block={block} wide>
      <div className="cxr-scroll">
        <table className="cxr-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.signed ? 'is-num' : undefined}>
                  {c.label}
                  {c.coordStated ? <span className="cxr-th-coord">{c.coordStated}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} title={r.entryLabel}>
                {r.cells.map((cell, i) => (
                  <td key={columns[i]?.key ?? i} className={columns[i]?.signed ? 'is-num' : undefined}>
                    {columns[i]?.masked ? <span className="cxr-masked">masked</span> : <Fig figure={cell} size="sm" />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* A derived column says what it was derived from, so a filing date the source never stated
          is never read as one it did. */}
      {(block.derivedField as { rule?: string; note?: string })?.rule ? (
        <BlockNote>
          {(block.derivedField as { rule: string }).rule}{' '}
          {(block.derivedField as { note?: string }).note}
        </BlockNote>
      ) : null}
    </BlockFrame>
  )
}

/* ---------------- 17. calendar — a tile per month, each with its own basis ---------------- */

function Calendar({ block }: { block: CapexBlock }) {
  const months = (block.months ?? []) as {
    month: string
    label: string
    labelShort?: string
    basis?: string
    coordStated?: string
    display?: string | null
    raw?: number | null
    n?: number
    empty?: boolean
    emptyNote?: string | null
    isPeak?: boolean
    shown?: number
    more?: number
    projects?: { id: string; code: string; name: string; display: string; categoryCls?: string }[]
    mix?: { key: string; label: string; cls?: string; display?: string; pct: number }[]
  }[]
  const legend = (block.legend ?? []) as {
    key: string
    label: string
    cls?: string
    display?: string
    pct?: number
    n?: number
  }[]
  /*
   * The mix palette is assigned across the **whole window** in descending value, never per tile —
   * the package's own contract says so, and the reason is that a category changing colour between
   * January and February makes the stacked bar a lie. The legend is that assignment, so a segment
   * takes its hue from the legend's position rather than from its own index within the month.
   */
  const hueFor = (key: string) => legend.findIndex((l) => l.key === key)

  return (
    <BlockFrame block={block} wide>
      {block.windowLabel ? <p className="cxr-window">{block.windowLabel as string}</p> : null}
      <div className="cxr-months">
        {months.map((m) => (
          <div className={`cxr-month${m.empty ? ' is-empty' : ''}${m.isPeak ? ' is-peak' : ''}`} key={m.month}>
            <div className="cxr-month-head">
              <span className="cxr-month-name">{m.labelShort ?? m.label}</span>
              {/* Each tile carries its own basis. The window spans two, which is why there is no
                  single total — adding a recorded quantity to a projected one is the failure this
                  report exists to avoid, and the reason stands where the total would be. */}
              {m.coordStated ? <span className="cxr-month-basis">{m.coordStated}</span> : null}
            </div>
            {m.empty ? (
              /* An empty tile says *which kind* of nothing it is — nothing recorded, or nothing
                 projected — because those are different facts about the same month, and the package
                 writes the distinction per tile. */
              <span className="cxr-month-empty">{m.emptyNote ?? 'nothing in this month'}</span>
            ) : (
              <>
                <span className="cxr-month-value">{m.display}</span>
                {m.mix && m.mix.length > 0 ? (
                  <span className="cxr-month-mix">
                    {m.mix.map((seg) => (
                      <i
                        key={seg.key}
                        className={`cxr-mix-seg is-c${Math.max(0, hueFor(seg.key)) % 5}`}
                        style={{ width: `${seg.pct}%` }}
                        title={`${seg.label} · ${seg.display} · ${seg.pct}%`}
                      />
                    ))}
                  </span>
                ) : null}
                {m.projects && m.projects.length > 0 ? (
                  <ul className="cxr-month-top">
                    {m.projects.map((pr) => (
                      <li key={pr.id}>
                        <span title={pr.name}>{pr.code}</span>
                        <strong>{pr.display}</strong>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {/* The tile ranks its projects and states the cap, so a truncated list is never a
                    silent one — the rule every capped list in this app follows. */}
                {m.more ? <span className="cxr-month-more">+{m.more} more</span> : null}
              </>
            )}
          </div>
        ))}
      </div>
      {legend.length > 0 ? (
        <div className="cxr-legend">
          {legend.map((l, i) => (
            <span className="cxr-legend-item" key={l.key}>
              <i className={`cxr-swatch is-c${i % 5}`} /> {l.label}
              {l.display ? <em> · {l.display}</em> : null}
            </span>
          ))}
        </div>
      ) : null}
      <BlockNote kind="refusal">{block.whyNoTotal as string}</BlockNote>
      <BlockNote>{block.legendNote as string}</BlockNote>
      {block.overdue ? <BlockNote kind="refusal">{block.overdueNote as string}</BlockNote> : null}
    </BlockFrame>
  )
}

/* ---------------- the dispatcher ---------------- */

const RENDERERS: Record<string, (props: { block: CapexBlock }) => ReactNode> = {
  figRow: FigRow,
  bar: Bar,
  heatmap: Heatmap,
  bubble: Bubble,
  varianceRows: VarianceRows,
  reasonMix: ReasonMix,
  narrative: Narrative,
  ask: Ask,
  header: Header,
  chain: Chain,
  progressSplit: ProgressSplit,
  schedule: Schedule,
  vendors: Vendors,
  lineItems: LineItems,
  annotations: Annotations,
  filingCalendar: FilingCalendar,
  calendar: Calendar,
}

/** Every kind this file can draw — read by `check-docs` so the payload and the renderers cannot drift. */
export const CAPEX_BLOCK_KINDS = Object.keys(RENDERERS)

/**
 * One block.
 *
 * **An unknown kind says so rather than rendering nothing.** A block the resolver emitted and this
 * file has never heard of is a gap between the package and the app, and a silently skipped block is a
 * report that is quietly one section short — indistinguishable, on screen, from a report that has
 * that much to say.
 */
export default function CapexBlockView({ block }: { block: CapexBlock }) {
  const Renderer = RENDERERS[block.type]
  if (!Renderer) {
    return (
      <section className="cxr-block is-unknown">
        <h3 className="cxr-block-title">{block.label ?? block.type}</h3>
        <BlockNote kind="refusal">
          This report contains a <code>{block.type}</code> block, which this app has no renderer for —
          so it is named rather than dropped. Add one to <code>CapexBlocks.tsx</code>.
        </BlockNote>
      </section>
    )
  }
  return <Renderer block={block} />
}
