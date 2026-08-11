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
 * expensive, and this is circles, lines and text. Positions and radii come from the
 * server, so a reload draws the same picture and a node the reader just found does
 * not move; dragging nudges one locally, because rearranging is for reading, not a
 * change to the graph.
 *
 * Two things on screen are data rather than styling. **Colour is the node's origin
 * class** — a row, a column value, a document, a resolved name — which is the
 * knowledge graph's own account of how it was built. **Size is the node's degree**,
 * so the receiving TSDF is the biggest circle because 53 relationships land on it,
 * not because it is the subject.
 */

const GROUP = new Map(CANVAS_GROUPS.map((g) => [g.key, g]))
/** Proposed elements are amber wherever they appear — the one state drawn here. */
const PROPOSED = '#a16207'

const fillOf = (node: CanvasNode) =>
  node.proposed ? PROPOSED : (GROUP.get(node.group)?.color ?? '#8994a8')

const inkOf = (node: CanvasNode) =>
  node.proposed ? '#ffffff' : (GROUP.get(node.group)?.ink ?? '#ffffff')

const matchesFilter = (node: CanvasNode, filter: CanvasFilter) =>
  filter === 'all'
    ? true
    : filter === 'low'
      ? node.confidence < 0.85
      : filter === 'review'
        ? node.needsReview
        : node.origin === 'studio-authored'

/**
 * A label that fits inside a circle: whole words, at most three lines.
 *
 * Long labels are real here — "Chevron Phillips Chemical Cedar Bayou Plant" — so a
 * word that cannot fit is cut with an ellipsis rather than drawn past the edge. The
 * full label stays in the node's `<title>`, so nothing is only truncated.
 */
function wrap(label: string, radius: number, fontSize: number) {
  const perLine = Math.max(4, Math.floor((radius * 1.7) / (fontSize * 0.55)))
  const lines: string[] = []
  let line = ''
  for (const word of label.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (next.length <= perLine) {
      line = next
      continue
    }
    if (line) lines.push(line)
    line = word
    if (lines.length === 3) break
  }
  if (line && lines.length < 3) lines.push(line)
  return lines.slice(0, 3).map((l) => (l.length > perLine ? `${l.slice(0, perLine - 1)}…` : l))
}

/** Big enough to carry its own name; smaller nodes are labelled underneath. */
const LABEL_INSIDE_AT = 27

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
  const [groups, setGroups] = useState<string[]>([])
  const [search, setSearch] = useState('')
  /** Local nudges from dragging. Never sent anywhere — this is reading aid. */
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>({})
  const [dragging, setDragging] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)

  const facetCount = {
    all: canvas.facets.all,
    low: canvas.facets.lowConfidence,
    review: canvas.facets.needsReview,
    authored: canvas.facets.studioAuthored,
  }
  const groupCount = new Map(canvas.facets.groups.map((g) => [g.key, g.count]))

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return new Set(
      canvas.nodes
        .filter((n) => matchesFilter(n, filter))
        .filter((n) => groups.length === 0 || groups.includes(n.group))
        .filter(
          (n) =>
            !term ||
            n.label.toLowerCase().includes(term) ||
            n.type.toLowerCase().includes(term) ||
            n.source.toLowerCase().includes(term),
        )
        .map((n) => n.nodeId),
    )
  }, [canvas.nodes, filter, groups, search])

  const at = (node: CanvasNode) => moved[node.nodeId] ?? { x: node.x, y: node.y }
  const byId = new Map(canvas.nodes.map((n) => [n.nodeId, n]))

  /*
   * The viewBox is measured from what the server sent rather than fixed here: a
   * hardcoded box is a second opinion about the layout, and the drag maths reads
   * from it, so the two disagreeing would make a node jump on the first drag.
   */
  const box = useMemo(() => {
    const pad = 16
    const xs = canvas.nodes.map((n) => at(n).x)
    const ys = canvas.nodes.map((n) => at(n).y)
    const rs = canvas.nodes.map((n) => n.r)
    const maxR = Math.max(24, ...rs)
    return {
      w: Math.max(...xs, 0) + maxR + pad,
      h: Math.max(...ys, 0) + maxR + pad,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas.nodes])

  /*
   * Labels appear when they can be read.
   *
   * A big node always carries its own name inside it. A small one is labelled
   * underneath, and *that* text is wider than the node — 73 of them at once, on a
   * layout whose circles sit 26px apart, is a grey smear rather than a picture. So
   * the small labels and the edge labels arrive together, once the view is small
   * enough to hold them: after a filter, a search, or a hover. The legend says so.
   *
   * The thresholds are the only numbers in this file that are neither data nor
   * geometry, and they are counts of what is on screen, not of what exists.
   */
  const visibleEdges = canvas.edges.filter(
    (e) => visible.has(e.from) && visible.has(e.to),
  )
  const labelEveryEdge = visibleEdges.length <= 24
  const labelEveryNode = visible.size <= 28
  const focus = hovered ?? selected

  function onMove(event: React.MouseEvent<SVGSVGElement>) {
    if (!dragging) return
    const svg = event.currentTarget
    const rect = svg.getBoundingClientRect()
    // A client pixel is not a canvas unit: the box is scaled to the element.
    setMoved((m) => ({
      ...m,
      [dragging]: {
        x: ((event.clientX - rect.left) / rect.width) * box.w,
        y: ((event.clientY - rect.top) / rect.height) * box.h,
      },
    }))
  }

  const toggleGroup = (key: string) =>
    setGroups((g) => (g.includes(key) ? g.filter((k) => k !== key) : [...g, key]))

  return (
    <div className="gc">
      <div className="gc-controls">
        <Input
          className="gc-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search entities, types, sources…"
          aria-label="Search entities, types and sources"
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
        viewBox={`0 0 ${box.w} ${box.h}`}
        role="img"
        aria-label={`Ontology: ${canvas.nodeCount} entities, ${canvas.edgeCount} relationships`}
        onMouseMove={onMove}
        onMouseUp={() => setDragging(null)}
        onMouseLeave={() => {
          setDragging(null)
          setHovered(null)
        }}
      >
        {canvas.edges.map((edge) => {
          const from = byId.get(edge.from)
          const to = byId.get(edge.to)
          if (!from || !to) return null
          const a = at(from)
          const b = at(to)
          const dim = !visible.has(edge.from) || !visible.has(edge.to)
          const touchesFocus = focus === edge.from || focus === edge.to
          const labelled =
            !dim && (edge.onAnswerPath || touchesFocus || labelEveryEdge)
          /* Drawn to the rim rather than the centre, so an arrow does not vanish
             under the circle it points at. */
          const angle = Math.atan2(b.y - a.y, b.x - a.x)
          const x1 = a.x + Math.cos(angle) * from.r
          const y1 = a.y + Math.sin(angle) * from.r
          const x2 = b.x - Math.cos(angle) * to.r
          const y2 = b.y - Math.sin(angle) * to.r
          return (
            <g
              key={`${edge.from}-${edge.to}-${edge.label}`}
              className={`gc-edge${edge.proposed ? ' is-proposed' : ''}${
                edge.onAnswerPath ? ' is-path' : ''
              }${dim ? ' is-dim' : ''}${touchesFocus ? ' is-focus' : ''}`}
            >
              <line x1={x1} y1={y1} x2={x2} y2={y2} />
              {labelled ? (
                <text
                  x={(x1 + x2) / 2}
                  y={(y1 + y2) / 2 - 4}
                  textAnchor="middle"
                  transform={`rotate(${
                    // Along the line, but never upside down.
                    (((angle * 180) / Math.PI + 360) % 360 > 90 &&
                    ((angle * 180) / Math.PI + 360) % 360 < 270
                      ? (angle * 180) / Math.PI + 180
                      : (angle * 180) / Math.PI).toFixed(2)
                  } ${(x1 + x2) / 2} ${(y1 + y2) / 2 - 4})`}
                >
                  {edge.label}
                </text>
              ) : null}
              {/* The evidence is on the relationship, so hovering the line reports
                  it — a hidden edge property is one nobody checks. */}
              <title>{`${from.label} → ${edge.label} → ${to.label}${
                edge.detail ? `\n${edge.detail}` : ''
              }`}</title>
            </g>
          )
        })}

        {canvas.nodes.map((node) => {
          const p = at(node)
          const dim = !visible.has(node.nodeId)
          const fill = fillOf(node)
          const inside = node.r >= LABEL_INSIDE_AT
          const fontSize = inside ? Math.min(13, Math.max(9.5, node.r / 3.4)) : 9.5
          const lines = inside ? wrap(node.label, node.r, fontSize) : []
          return (
            <g
              key={node.nodeId}
              className={`gc-node${node.proposed ? ' is-proposed' : ''}${
                node.onAnswerPath ? ' is-path' : ''
              }${dim ? ' is-dim' : ''}${selected === node.nodeId ? ' is-selected' : ''}`}
              onMouseDown={() => setDragging(node.nodeId)}
              onMouseEnter={() => setHovered(node.nodeId)}
              onClick={() => onSelect(selected === node.nodeId ? null : node.nodeId)}
            >
              {/* The ring is the halo the picture reads by; drawn under the fill so
                  it cannot lighten the colour the legend promises. */}
              <circle className="gc-halo" cx={p.x} cy={p.y} r={node.r + 3} />
              <circle className="gc-disc" cx={p.x} cy={p.y} r={node.r} fill={fill} />
              {inside ? (
                <text
                  className="gc-node-label"
                  x={p.x}
                  y={p.y}
                  textAnchor="middle"
                  fill={inkOf(node)}
                  fontSize={fontSize}
                >
                  {lines.map((line, i) => (
                    <tspan
                      key={line}
                      x={p.x}
                      /* Centred as a block: the first line lifts by half the stack. */
                      dy={i === 0 ? -((lines.length - 1) * fontSize * 1.15) / 2 + fontSize * 0.34 : fontSize * 1.15}
                    >
                      {line}
                    </tspan>
                  ))}
                </text>
              ) : labelEveryNode || focus === node.nodeId || node.onAnswerPath ? (
                <text
                  className="gc-node-outside"
                  x={p.x}
                  y={p.y + node.r + 11}
                  textAnchor="middle"
                >
                  {node.label.length > 22 ? `${node.label.slice(0, 21)}…` : node.label}
                </text>
              ) : null}
              {/* Type and source on hover: the answer to "what is this, and which
                  table or file did it come from" without opening the inspector. */}
              <title>{`${node.label}\n${node.type} · ${node.sublabel}\n${node.source}\n${node.degree} relationship(s) · confidence ${node.confidence.toFixed(2)}`}</title>
            </g>
          )
        })}
      </svg>

      <div className="gc-legend">
        {CANVAS_GROUPS.map((g) => (
          <button
            key={g.key}
            type="button"
            /* The legend *is* the origin filter. One control cannot disagree with
               itself about what a colour means and what it shows. */
            className={`gc-legend-item${groups.includes(g.key) ? ' is-on' : ''}`}
            onClick={() => toggleGroup(g.key)}
            aria-pressed={groups.includes(g.key)}
          >
            <span className="gc-dot" style={{ background: g.color }} aria-hidden="true" />
            {g.label}
            <span className="gc-legend-count">{groupCount.get(g.key) ?? 0}</span>
          </button>
        ))}
        <span className="gc-legend-hint">
          size = relationships · dashed = under review · glow = answer path. Hover a
          node for its name and relationships, or filter to label them all; click to
          inspect, drag to rearrange.
        </span>
      </div>
    </div>
  )
}
