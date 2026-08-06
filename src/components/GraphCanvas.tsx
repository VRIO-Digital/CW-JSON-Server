import { Input } from 'antd'
import { useMemo, useState } from 'react'
import type { CanvasNode, CanvasPayload } from '../api/client'
import {
  CANVAS_FILTERS,
  CANVAS_GROUPS,
  type CanvasFilter,
} from '../data/canvasLegend'
import './GraphCanvas.css'

/*
 * The ontology, drawn by hand.
 *
 * Inline SVG rather than a graph library: the audit gate makes every dependency
 * expensive, and this is ~150 lines of ellipses and lines. Positions come from
 * the server so a reload draws the same picture; dragging moves a node locally,
 * because rearranging is for reading, not a change to the graph.
 */

const colorOf = (node: CanvasNode) =>
  node.proposed
    ? '#a16207'
    : (CANVAS_GROUPS.find((g) => g.key === node.group)?.color ?? '#8994a8')

const matchesFilter = (node: CanvasNode, filter: CanvasFilter) =>
  filter === 'all'
    ? true
    : filter === 'low'
      ? node.confidence < 0.85
      : filter === 'review'
        ? node.needsReview
        : node.origin === 'studio-authored'

export default function GraphCanvas({
  canvas,
  selected,
  onSelect,
}: {
  canvas: CanvasPayload
  selected: string | null
  onSelect: (nodeId: string | null) => void
}) {
  const [filter, setFilter] = useState<CanvasFilter>('all')
  const [search, setSearch] = useState('')
  /** Local nudges from dragging. Never sent anywhere — this is reading aid. */
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>({})
  const [dragging, setDragging] = useState<string | null>(null)

  const facetCount = {
    all: canvas.facets.all,
    low: canvas.facets.lowConfidence,
    review: canvas.facets.needsReview,
    authored: canvas.facets.studioAuthored,
  }

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return new Set(
      canvas.nodes
        .filter((n) => matchesFilter(n, filter))
        .filter((n) => !term || n.label.toLowerCase().includes(term))
        .map((n) => n.nodeId),
    )
  }, [canvas.nodes, filter, search])

  const at = (node: CanvasNode) => moved[node.nodeId] ?? { x: node.x, y: node.y }
  const byId = new Map(canvas.nodes.map((n) => [n.nodeId, n]))

  function onMove(event: React.MouseEvent<SVGSVGElement>) {
    if (!dragging) return
    const svg = event.currentTarget
    const box = svg.getBoundingClientRect()
    // The viewBox is 900×460, so a client pixel is not a canvas unit.
    const x = ((event.clientX - box.left) / box.width) * 900
    const y = ((event.clientY - box.top) / box.height) * 460
    setMoved((m) => ({ ...m, [dragging]: { x, y } }))
  }

  return (
    <div className="gc">
      <div className="gc-controls">
        <Input
          className="gc-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search entities…"
          aria-label="Search entities"
        />
        {CANVAS_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`gc-chip${filter === f.key ? ' is-active' : ''}`}
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
          >
            {f.label}
            {/* The count is on the chip, so an empty result reads as "none
                match" rather than as a broken filter. */}
            <span className="gc-chip-count">{facetCount[f.key]}</span>
          </button>
        ))}
      </div>

      <svg
        className="gc-svg"
        viewBox="0 0 900 460"
        role="img"
        aria-label={`Ontology: ${canvas.nodeCount} entities, ${canvas.edgeCount} relationships`}
        onMouseMove={onMove}
        onMouseUp={() => setDragging(null)}
        onMouseLeave={() => setDragging(null)}
      >
        {canvas.edges.map((edge) => {
          const from = byId.get(edge.from)
          const to = byId.get(edge.to)
          if (!from || !to) return null
          const a = at(from)
          const b = at(to)
          const dim = !visible.has(edge.from) || !visible.has(edge.to)
          return (
            <g
              key={`${edge.from}-${edge.to}`}
              className={`gc-edge${edge.proposed ? ' is-proposed' : ''}${
                edge.onAnswerPath ? ' is-path' : ''
              }${dim ? ' is-dim' : ''}`}
            >
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 6} textAnchor="middle">
                {edge.label}
              </text>
            </g>
          )
        })}

        {canvas.nodes.map((node) => {
          const p = at(node)
          const dim = !visible.has(node.nodeId)
          const color = colorOf(node)
          return (
            <g
              key={node.nodeId}
              className={`gc-node${node.proposed ? ' is-proposed' : ''}${
                node.onAnswerPath ? ' is-path' : ''
              }${dim ? ' is-dim' : ''}${selected === node.nodeId ? ' is-selected' : ''}`}
              onMouseDown={() => setDragging(node.nodeId)}
              onClick={() => onSelect(selected === node.nodeId ? null : node.nodeId)}
            >
              <ellipse cx={p.x} cy={p.y} rx={62} ry={22} stroke={color} />
              <text className="gc-node-label" x={p.x} y={p.y - 2} textAnchor="middle">
                {node.label}
              </text>
              <text className="gc-node-sub" x={p.x} y={p.y + 12} textAnchor="middle">
                {node.sublabel}
              </text>
            </g>
          )
        })}
      </svg>

      <div className="gc-legend">
        {CANVAS_GROUPS.map((g) => (
          <span key={g.key} className="gc-legend-item">
            <span className="gc-dot" style={{ background: g.color }} aria-hidden="true" />
            {g.label}
          </span>
        ))}
        <span className="gc-legend-hint">
          glow = answer path · drag to rearrange · click to inspect
        </span>
      </div>
    </div>
  )
}
