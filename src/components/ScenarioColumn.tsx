import { Button, Input, Select, Spin } from 'antd'
import { useState } from 'react'
import type { WhatIfFrame, WhatIfGenerator, WhatIfScenario } from '../api/client'
import type { ScenarioColumn as Column } from '../store/whatifStore'
import StatusTag from './StatusTag'
import './ScenarioColumn.css'

/*
 * One scenario column: what admitting this load would make the facility inherit.
 *
 * Every figure here came from the server, computed against today's graph. The column
 * itself stores only the *admitted load* — that is why swapping the dropdown refetches
 * rather than recalculating, and why a saved scenario re-opened later shows the record
 * as it stands then rather than as it stood when it was saved.
 *
 * The source tags are not decoration either. Each measure names the federal source it
 * came from (ECHO, RCRA, a document), and the trace panel repeats them against the
 * specific records, because "no value is invented" is a claim the reader has to be able
 * to check.
 */

/** The lettered column tag — A, B, C — so the compare strip can be talked about. */
const TAG = ['A', 'B', 'C', 'D']

/**
 * A source's tint. Four fixed keys from the package, so this is a lookup rather than a
 * palette decision — and it is a *category*, never a status: a figure from ECHO is not
 * worse than one from RCRA, it is from somewhere else.
 */
const SOURCE_CLASS: Record<string, string> = {
  MAN: 'is-man',
  RCRA: 'is-rcra',
  ECHO: 'is-echo',
  DOC: 'is-doc',
}

export default function ScenarioColumn({
  column,
  index,
  scenario,
  computing,
  frame,
  candidates,
  canRemove,
  pending,
  onSwap,
  onRename,
  onRemove,
  onSave,
}: {
  column: Column
  index: number
  scenario: WhatIfScenario | undefined
  computing: boolean
  frame: WhatIfFrame
  candidates: WhatIfGenerator[]
  canRemove: boolean
  pending: boolean
  onSwap: (generatorId: string) => void
  onRename: (name: string) => void
  onRemove: () => void
  onSave: () => void
}) {
  const [traceOpen, setTraceOpen] = useState(false)
  const [graphOpen, setGraphOpen] = useState(false)
  const { card } = frame.runtime

  /* A column linked to a library entry whose load has since been swapped is *dirty* —
     the button says "Update" rather than showing a saved flag that is no longer true. */
  const savedEntry = frame.saved.find((s) => s.savedId === column.savedId)
  const dirty = Boolean(savedEntry && savedEntry.generatorId !== column.generatorId)

  return (
    <div className="sc">
      <div className="sc-head">
        <span className="sc-tag">{TAG[index] ?? index + 1}</span>
        <Input
          size="small"
          value={column.name}
          onChange={(e) => onRename(e.target.value)}
          placeholder={card.namePlaceholder}
          aria-label={`Name for scenario ${TAG[index] ?? index + 1}`}
        />
        {/* Never offered on the last column: an empty compare strip has no control
            that would bring one back. */}
        {canRemove ? (
          <button
            type="button"
            className="sc-remove"
            onClick={onRemove}
            aria-label={`Remove scenario ${TAG[index] ?? index + 1}`}
            title="Remove this column"
          >
            ✕
          </button>
        ) : null}
      </div>

      <label className="sc-label" htmlFor={`load-${column.columnId}`}>
        {card.loadLabel}
      </label>
      <Select
        id={`load-${column.columnId}`}
        className="sc-select"
        size="small"
        value={column.generatorId}
        onChange={onSwap}
        /* Only the pool's loads. The frame is what decides that, so a dropdown offering
           more than the pool would make the authoring step decorative. */
        options={candidates.map((g) => ({
          value: g.id,
          label: `${g.name} — ${g.state} · ${g.risk}`,
        }))}
        showSearch
        optionFilterProp="label"
      />

      {computing && !scenario ? (
        <div className="sc-loading">
          <Spin size="small" />
        </div>
      ) : scenario ? (
        <>
          <ul className="sc-sources">
            {scenario.sources.map((s) => (
              <li key={s.key}>
                <span className={`sc-src ${SOURCE_CLASS[s.key] ?? ''}`}>{s.label}</span>
                <span className="sc-src-line">{s.line}</span>
              </li>
            ))}
          </ul>

          <div className="sc-measures">
            {scenario.measures.map((m) => (
              <div key={m.key} className={`sc-measure${m.breached ? ' is-breached' : ''}`}>
                <div className="sc-measure-top">
                  <span className="sc-measure-label">{m.label}</span>
                  {/* The figure judged against the appetite line. Red only on a real
                      breach — a status colour, and the only one on this card. */}
                  <span className="sc-measure-value">{m.valueText}</span>
                </div>
                <div className="sc-measure-foot">
                  {/* What this load brings, distinct from what the facility already
                      carries. A load that moves nothing says so rather than showing a
                      "+0" that reads like a measurement. */}
                  <span className={`sc-delta${m.moved ? ' is-up' : ''}`}>
                    {m.moved
                      ? `▲ ${m.inheritedText} inherited`
                      : m.baseline === null
                        ? 'none on this load'
                        : 'no change'}
                  </span>
                  {m.baselineText !== null ? (
                    <span className="sc-baseline">facility baseline {m.baselineText}</span>
                  ) : (
                    <span className="sc-baseline">no facility baseline</span>
                  )}
                </div>
                {m.breached && m.appetite !== null ? (
                  <div className="sc-breach">
                    <StatusTag tone="crit">
                      crosses the {m.appetite}-{m.unit || 'unit'} appetite line
                    </StatusTag>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          {/* Either the trace, or the plain statement that nothing connects. An empty
              trace panel would read as "not checked" rather than "checked, and clean". */}
          {scenario.flagged ? (
            <>
              <button
                type="button"
                className="sc-link"
                onClick={() => setTraceOpen((o) => !o)}
                aria-expanded={traceOpen}
              >
                {card.traceLink}
              </button>
              {traceOpen ? (
                <div className="sc-trace">
                  <div className="sc-trace-head">{card.traceHeader}</div>
                  {scenario.sources.map((s) => (
                    <div key={s.key} className="sc-trace-row">
                      <span className={`sc-src ${SOURCE_CLASS[s.key] ?? ''}`}>{s.label}</span>
                      <span>{s.line}</span>
                    </div>
                  ))}
                  {/* What the scenario cannot see, stated rather than implied away. */}
                  <div className="sc-trace-row is-residual">
                    <span className="sc-src">residual</span>
                    <span>{scenario.residualNote}</span>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="sc-clean">
              <StatusTag tone="good">{scenario.cleanNote}</StatusTag>
            </div>
          )}

          {/* The subgraph this load traverses — hand-drawn, like every other graph in
              this app, and built from what the generator actually carries so a clean
              load draws no enforcement node. */}
          <button
            type="button"
            className="sc-link"
            onClick={() => setGraphOpen((o) => !o)}
            aria-expanded={graphOpen}
          >
            {card.graphLink}
          </button>
          {graphOpen ? <Subgraph scenario={scenario} /> : null}

          <div className="sc-save">
            {savedEntry && !dirty ? (
              <span className="sc-saved-flag">{frame.runtime.library.savedFlag}</span>
            ) : (
              <Button size="small" loading={pending} onClick={onSave}>
                {savedEntry ? frame.runtime.library.updateBtn : frame.runtime.library.saveBtn}
              </Button>
            )}
          </div>
        </>
      ) : (
        <div className="sc-loading">This load could not be computed.</div>
      )}
    </div>
  )
}

/**
 * The path one admitted load traverses, drawn as a chain.
 *
 * Inline SVG and no library, for the reason the ontology canvas has none. It is a
 * *chain* here rather than a free layout because that is what the traversal is: the
 * generator's records lead to the generator, and the generator ships to the facility.
 */
function Subgraph({ scenario }: { scenario: WhatIfScenario }) {
  const nodes = scenario.subgraph.nodes
  const w = 300
  const rowH = 34
  const h = nodes.length * rowH + 8
  return (
    <svg
      className="sc-graph"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`Traversal: ${nodes.map((n) => n.label).join(' → ')}`}
    >
      {nodes.slice(0, -1).map((_, i) => (
        <line
          key={i}
          className="sc-graph-edge"
          x1={18}
          y1={i * rowH + 22}
          x2={18}
          y2={(i + 1) * rowH + 22}
        />
      ))}
      {nodes.map((n, i) => (
        <g key={`${n.key}-${n.label}`} className={`sc-graph-node is-${n.key}`}>
          <circle cx={18} cy={i * rowH + 22} r={6} />
          <text x={34} y={i * rowH + 25}>
            {n.label}
          </text>
        </g>
      ))}
    </svg>
  )
}
