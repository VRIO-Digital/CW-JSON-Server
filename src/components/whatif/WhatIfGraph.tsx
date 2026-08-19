import type { WhatIfFrame, WhatIfGenerator, WhatIfScenario } from '../../api/client'
import './WhatIfGraph.css'

/*
 * The two graph references the What-if lens shows: the **frame** a pool draws from, and the
 * **sub-graph** one admitted load traverses.
 *
 * Hand-written inline SVG and no library, for the reason the ontology canvas has none and
 * the mock server has no dependencies.
 *
 * **Everything the drawing asserts comes from the payload.** The node types, their labels
 * and their colours are `graph_reference.node_types` — the package's own palette, so a
 * component is not inventing a legend; the pool frame's centre, its edge name and how many
 * generators may be drawn are `graph_reference.frame`; and a scenario's nodes and **edges**
 * are computed server-side from what the generator actually carries, with every edge label
 * taken from the graph's declared relationship list. A clean load therefore draws no
 * enforcement node and one under no decree draws no document: an absence has no circle.
 *
 * What this file decides is *where* a circle goes. These are two fixed schematics — a fan
 * into one centre, and a five-node traversal — not a layout over an unknown graph, which is
 * why there are no server positions here as there are on the studio canvas.
 *
 * Colour is never the only channel: every type is in the legend by name, the generator's
 * risk tier is also written on its row in the column beside this, and each circle carries
 * its own label. The one status-shaped use of colour is that risk tier, which is a state.
 */

/** The package names its palette in words; this is the only place they become pixels. */
const HUES: Record<string, string> = {
  orange: '#f2691d',
  red: '#dc4444',
  amber: '#b47d0a',
  green: '#0d9f6e',
  cyan: '#0284c7',
  purple: '#7c3aed',
  blue: '#2563eb',
}

const hue = (name: string | undefined) => (name && HUES[name]) || '#8994a8'

/** The fill for one node: its type's colour, or its risk tier where the type says so. */
function fillFor(frame: WhatIfFrame, key: string, risk: string | null): string {
  const type = frame.graphReference.nodeTypes.find((t) => t.key === key)
  if (type?.riskColors && risk) return hue(type.riskColors[risk])
  return hue(type?.color)
}

/** Two words is enough to recognise a generator, and all a 90px column can hold. */
const shortName = (name: string) => name.split(' ').slice(0, 2).join(' ')

function Legend({ frame }: { frame: WhatIfFrame }) {
  return (
    <ul className="wg-legend">
      {frame.graphReference.nodeTypes.map((t) => (
        <li key={t.key}>
          <span className="wg-swatch" style={{ background: hue(t.color) }} aria-hidden="true" />
          {t.label}
        </li>
      ))}
    </ul>
  )
}

/**
 * The frame: the pool's generators, and the facility they all ship to.
 *
 * Capped at `frame.maxDrawn` and **the cap is stated** in the header — a fan of seven
 * standing for twenty-four is a silent sample otherwise.
 */
export function PoolFrame({
  frame,
  members,
}: {
  frame: WhatIfFrame
  members: WhatIfGenerator[]
}) {
  const { frame: rules } = frame.graphReference
  const drawn = members.slice(0, rules.maxDrawn)
  const width = 500
  const rowH = 34
  const height = Math.max(drawn.length * rowH + 40, 160)
  const cx = 400
  const cy = height / 2
  const x = 120

  return (
    <div className="wg">
      <div className="wg-head">
        <span>
          {rules.description.replace(/\.$/, '')} — {members.length} in this pool
          {members.length > drawn.length ? `, first ${drawn.length} drawn` : ''}
        </span>
        {frame.facility ? <span className="wg-id">{frame.facility.id}</span> : null}
      </div>
      <svg
        className="wg-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${members.length} generators ${rules.edge} ${frame.facility?.name ?? 'the facility'}.`}
      >
        {drawn.map((g, i) => {
          const y = 26 + i * rowH
          return (
            <g key={g.id}>
              <line className="wg-edge" x1={x} y1={y} x2={cx} y2={cy} />
              {/* The edge is named once. Labelling all seven would draw the same word
                  seven times over the same fan. */}
              {i === 0 ? (
                <text className="wg-edge-label" x={(x + cx) / 2} y={(y + cy) / 2 - 5}>
                  {rules.edge}
                </text>
              ) : null}
              <circle cx={x} cy={y} r={7} fill={fillFor(frame, 'generator', g.risk)} />
              <text className="wg-node-label" x={x - 14} y={y + 4} textAnchor="end">
                {shortName(g.name)}
              </text>
            </g>
          )
        })}
        {frame.facility ? (
          <g>
            <circle cx={cx} cy={cy} r={16} fill={fillFor(frame, rules.centerNode, null)} />
            <text className="wg-node-mark" x={cx} y={cy + 4} textAnchor="middle">
              TSDF
            </text>
            <text className="wg-node-label" x={cx} y={cy + 32} textAnchor="middle">
              {frame.facility.name}
            </text>
          </g>
        ) : null}
      </svg>
      <Legend frame={frame} />
    </div>
  )
}

/*
 * Where each kind of node sits in the traversal. Records on the left, the generator in the
 * middle, the facility it ships to on the right — reading left to right in the direction
 * the risk travels, which is the whole claim the lens makes.
 */
const SLOTS: Record<string, { x: number; y: number; r: number; below?: boolean }> = {
  evaluation: { x: 110, y: 62, r: 12 },
  violation: { x: 110, y: 150, r: 12, below: true },
  enforcement: { x: 110, y: 238, r: 12, below: true },
  document: { x: 196, y: 66, r: 10 },
  generator: { x: 250, y: 150, r: 14, below: true },
  facility: { x: 420, y: 150, r: 15, below: true },
}

/** The sub-graph one admitted load traverses, as the server computed it. */
export function ScenarioSubgraph({
  frame,
  scenario,
}: {
  frame: WhatIfFrame
  scenario: WhatIfScenario
}) {
  const { nodes, edges } = scenario.subgraph
  const at = (key: string) => SLOTS[key] ?? { x: 250, y: 150, r: 10 }
  const drawn = nodes.filter((n) => n.key in SLOTS)

  return (
    <div className="wg">
      <div className="wg-head">
        <span>What this scenario traverses when the load is admitted</span>
        <span className="wg-id">{scenario.generator.id}</span>
      </div>
      <svg
        className="wg-svg"
        viewBox="0 0 500 300"
        role="img"
        aria-label={`${scenario.generator.name}: ${edges
          .map((e) => `${e.from} ${e.label} ${e.to}`)
          .join(', ')}.`}
      >
        {edges.map((e) => {
          const a = at(e.from)
          const b = at(e.to)
          return (
            <g key={`${e.from}-${e.to}`}>
              <line className="wg-edge" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
              {/* The relationship's own name, from the graph's list — cased against the
                  panel so it stays legible where it crosses a line. */}
              <text
                className="wg-edge-label"
                x={(a.x + b.x) / 2}
                y={(a.y + b.y) / 2 - 5}
                textAnchor="middle"
              >
                {e.label}
              </text>
            </g>
          )
        })}
        {drawn.map((n) => {
          const slot = at(n.key)
          return (
            <g key={n.key}>
              <circle
                cx={slot.x}
                cy={slot.y}
                r={slot.r}
                fill={fillFor(frame, n.key, n.risk)}
              />
              {/* The count inside the circle, where there is one: the figure is the point
                  of the node, and the type name beside it says what it counts. */}
              {n.count !== null ? (
                <text className="wg-node-mark" x={slot.x} y={slot.y + 4} textAnchor="middle">
                  {n.count}
                </text>
              ) : null}
              {n.key === 'facility' ? (
                <text className="wg-node-mark" x={slot.x} y={slot.y + 4} textAnchor="middle">
                  TSDF
                </text>
              ) : null}
              <text
                className="wg-node-label"
                x={slot.x}
                y={slot.below ? slot.y + slot.r + 14 : slot.y - slot.r - 7}
                textAnchor="middle"
              >
                {n.key === 'generator' ? shortName(n.label) : n.label}
              </text>
            </g>
          )
        })}
      </svg>
      <Legend frame={frame} />
    </div>
  )
}
