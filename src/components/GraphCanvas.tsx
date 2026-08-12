import { Input } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CanvasNode, CanvasPayload } from '../api/client'
import {
  CANVAS_FILTERS,
  CANVAS_GROUPS,
  CANVAS_TYPE_RINGS,
  CANVAS_UNRINGED,
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
 * change to the graph. Zoom and pan are the same — a transform on one group, held in
 * this component, never sent anywhere.
 *
 * Three things on screen are data rather than styling. **The fill is the node's
 * origin class** — a source row, a document, a resolved name, or a type-level element
 * — which is the knowledge graph's own account of how it was built. **The ring is its
 * ontology type**, where a fill carries more than one. **Size is the node's degree**,
 * so the receiving TSDF is the biggest circle because 61 relationships land on it,
 * not because it is the subject.
 */

const GROUP = new Map(CANVAS_GROUPS.map((g) => [g.key, g]))
/* Keyed by plain string, not the literal union the `as const` list gives: the lookup
   is against `node.type`, which is whatever the graph holds. A new type has no ring
   yet, and that must be a miss rather than a compile error here. */
const RING = new Map<string, string>(CANVAS_TYPE_RINGS.map((r) => [r.type, r.color]))
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

/** Big enough to carry its own name; smaller nodes are labelled beside them. */
const LABEL_INSIDE_AT = 27
/**
 * The zoom at which the small labels and the edge labels all arrive.
 *
 * The layout is 1900 units wide and the panel is nearer 800px, so the fitted view
 * renders 9.5px text at about 4px — a grey smear, and 159 of these labels are wider
 * than the circles they belong to. Zooming is what makes them legible, so zoom is
 * what reveals them: past this scale the picture is labelled the way the demo viewer
 * labels it, and below it only the big nodes, the hovered one and the answer path
 * carry text. This is the same rule as before — "labels appear when they can be read"
 * — with the reader now able to *make* them readable.
 */
const LABEL_AT_ZOOM = 1.35
const ZOOM_MIN = 0.4
const ZOOM_MAX = 6
const IDENTITY = { k: 1, tx: 0, ty: 0 }

export default function GraphCanvas({
  canvas,
  selected,
  onSelect,
  fullViewHref,
  full = false,
}: {
  canvas: CanvasPayload
  selected: string | null
  onSelect: (nodeId: string | null) => void
  /**
   * Where the full-window view of this graph lives. Given by the studio tab, and
   * **omitted by the full view itself** — a button linking to the page you are on is
   * a dead control, and the absence is what makes it impossible.
   */
  fullViewHref?: string
  /** True in the full-window view: the drawing takes the viewport's height. */
  full?: boolean
}) {
  const [filter, setFilter] = useState<CanvasFilter>('all')
  const [groups, setGroups] = useState<string[]>([])
  const [types, setTypes] = useState<string[]>([])
  const [search, setSearch] = useState('')
  /** Local nudges from dragging. Never sent anywhere — this is reading aid. */
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>({})
  const [dragging, setDragging] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  /** Zoom and pan, also local. `k` is scale, `tx`/`ty` translate in view units. */
  const [view, setView] = useState(IDENTITY)
  const svgRef = useRef<SVGSVGElement>(null)
  const panFrom = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)

  const facetCount = {
    all: canvas.facets.all,
    low: canvas.facets.lowConfidence,
    review: canvas.facets.needsReview,
    authored: canvas.facets.studioAuthored,
  }
  const groupCount = new Map(canvas.facets.groups.map((g) => [g.key, g.count]))
  const typeCount = new Map(canvas.facets.types.map((t) => [t.key, t.count]))

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return new Set(
      canvas.nodes
        .filter((n) => matchesFilter(n, filter))
        .filter((n) => groups.length === 0 || groups.includes(n.group))
        .filter((n) => types.length === 0 || types.includes(n.type))
        .filter(
          (n) =>
            !term ||
            n.label.toLowerCase().includes(term) ||
            n.type.toLowerCase().includes(term) ||
            n.source.toLowerCase().includes(term),
        )
        .map((n) => n.nodeId),
    )
  }, [canvas.nodes, filter, groups, types, search])

  const at = useCallback(
    (node: CanvasNode) => moved[node.nodeId] ?? { x: node.x, y: node.y },
    [moved],
  )
  const byId = new Map(canvas.nodes.map((n) => [n.nodeId, n]))

  /*
   * The viewBox is measured from what the server sent rather than fixed here: a
   * hardcoded box is a second opinion about the layout, and the drag maths reads
   * from it, so the two disagreeing would make a node jump on the first drag.
   */
  const box = useMemo(() => {
    const pad = 16
    const xs = canvas.nodes.map((n) => n.x)
    const ys = canvas.nodes.map((n) => n.y)
    const maxR = Math.max(24, ...canvas.nodes.map((n) => n.r))
    return {
      w: Math.max(...xs, 0) + maxR + pad,
      h: Math.max(...ys, 0) + maxR + pad,
    }
  }, [canvas.nodes])

  /*
   * A client pixel is not a view unit, and a view unit is not a graph unit.
   *
   * `getScreenCTM` covers the first conversion — it already knows the viewBox, the
   * preserveAspectRatio letterboxing and the element's CSS size, all of which would
   * otherwise have to be reproduced here and would drift the moment the panel resized.
   * The pan/zoom transform is the second, and it is undone by hand because it is ours.
   */
  const toGraph = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current
      if (!svg) return null
      const ctm = svg.getScreenCTM()
      if (!ctm) return null
      const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
      return { view: p, graph: { x: (p.x - view.tx) / view.k, y: (p.y - view.ty) / view.k } }
    },
    [view],
  )

  /*
   * Zoom about the cursor, so the thing under the pointer stays under it. Attached by
   * hand rather than with `onWheel` because React registers wheel listeners as
   * passive, and a passive listener cannot `preventDefault` — without which the page
   * scrolls behind the zoom.
   */
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const p = toGraph(event.clientX, event.clientY)
      if (!p) return
      const next = Math.min(
        ZOOM_MAX,
        Math.max(ZOOM_MIN, view.k * (event.deltaY < 0 ? 1.12 : 1 / 1.12)),
      )
      setView({
        k: next,
        tx: p.view.x - p.graph.x * next,
        ty: p.view.y - p.graph.y * next,
      })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [toGraph, view.k])

  /*
   * Labels appear when they can be read.
   *
   * A big node always carries its own name inside it. A small one is labelled beside
   * it, and that text is wider than the node — 159 of them at once, on a layout whose
   * circles sit 26px apart, is a grey smear rather than a picture. So the small labels
   * and the edge labels arrive together once the view can hold them: zoomed in past
   * `LABEL_AT_ZOOM`, or narrowed by a filter, or on hover. The legend says so.
   */
  const visibleEdges = canvas.edges.filter(
    (e) => visible.has(e.from) && visible.has(e.to),
  )
  const zoomedIn = view.k >= LABEL_AT_ZOOM
  const labelEveryEdge = zoomedIn || visibleEdges.length <= 24
  const labelEveryNode = zoomedIn || visible.size <= 28
  const focus = hovered ?? selected

  /*
   * Selecting a node dims everything that is not it or one of its neighbours.
   *
   * At 189 nodes and 241 edges the picture is dense enough that "which of these lines
   * are mine" is not answerable by looking. This is the one interaction that makes a
   * dense graph readable, so it is the neighbourhood that stays lit rather than just
   * the node: a node with nothing around it tells you nothing about why it is there.
   * Hovering does not do this — only a click — because a dimming that follows the
   * pointer is a strobe.
   */
  const neighbourhood = useMemo(() => {
    if (!selected) return null
    const keep = new Set([selected])
    for (const e of canvas.edges) {
      if (e.from === selected) keep.add(e.to)
      if (e.to === selected) keep.add(e.from)
    }
    return keep
  }, [selected, canvas.edges])

  const lit = (nodeId: string) =>
    visible.has(nodeId) && (!neighbourhood || neighbourhood.has(nodeId))

  function onMove(event: React.MouseEvent<SVGSVGElement>) {
    if (dragging) {
      const p = toGraph(event.clientX, event.clientY)
      if (p) setMoved((m) => ({ ...m, [dragging]: p.graph }))
      return
    }
    if (panFrom.current) {
      const from = panFrom.current
      setView((v) => ({
        ...v,
        tx: from.tx + (event.clientX - from.x),
        ty: from.ty + (event.clientY - from.y),
      }))
    }
  }

  const endGesture = () => {
    setDragging(null)
    panFrom.current = null
  }

  const toggle = (list: string[], set: (v: string[]) => void, key: string) =>
    set(list.includes(key) ? list.filter((k) => k !== key) : [...list, key])

  return (
    <div className={`gc${full ? ' is-full' : ''}`}>
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

      <div className="gc-stage">
        <svg
          ref={svgRef}
          className={`gc-svg${panFrom.current ? ' is-panning' : ''}`}
          viewBox={`0 0 ${box.w} ${box.h}`}
          role="img"
          aria-label={`Ontology: ${canvas.nodeCount} entities, ${canvas.edgeCount} relationships`}
          onMouseDown={(event) => {
            // Only the background pans; a node's own mousedown starts a drag.
            if (event.target === event.currentTarget) {
              panFrom.current = {
                x: event.clientX,
                y: event.clientY,
                tx: view.tx,
                ty: view.ty,
              }
            }
          }}
          onMouseMove={onMove}
          onMouseUp={endGesture}
          onMouseLeave={() => {
            endGesture()
            setHovered(null)
          }}
          onClick={(event) => {
            // Clicking the background clears the selection, which un-dims everything.
            if (event.target === event.currentTarget) onSelect(null)
          }}
        >
          <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
            {canvas.edges.map((edge) => {
              const from = byId.get(edge.from)
              const to = byId.get(edge.to)
              if (!from || !to) return null
              const a = at(from)
              const b = at(to)
              const dim = !lit(edge.from) || !lit(edge.to)
              const incident =
                selected === edge.from ||
                selected === edge.to ||
                focus === edge.from ||
                focus === edge.to
              const labelled = !dim && (edge.onAnswerPath || incident || labelEveryEdge)
              /* Drawn to the rim rather than the centre, so an arrow does not vanish
                 under the circle it points at. */
              const angle = Math.atan2(b.y - a.y, b.x - a.x)
              const x1 = a.x + Math.cos(angle) * from.r
              const y1 = a.y + Math.sin(angle) * from.r
              const x2 = b.x - Math.cos(angle) * to.r
              const y2 = b.y - Math.sin(angle) * to.r
              const deg = ((angle * 180) / Math.PI + 360) % 360
              return (
                <g
                  key={edge.edgeId}
                  className={`gc-edge${edge.proposed ? ' is-proposed' : ''}${
                    edge.onAnswerPath ? ' is-path' : ''
                  }${dim ? ' is-dim' : ''}${incident ? ' is-focus' : ''}`}
                >
                  <line x1={x1} y1={y1} x2={x2} y2={y2} />
                  {labelled ? (
                    <text
                      x={(x1 + x2) / 2}
                      y={(y1 + y2) / 2 - 4}
                      textAnchor="middle"
                      transform={`rotate(${
                        // Along the line, but never upside down.
                        (deg > 90 && deg < 270
                          ? (angle * 180) / Math.PI + 180
                          : (angle * 180) / Math.PI
                        ).toFixed(2)
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
              const dim = !lit(node.nodeId)
              const fill = fillOf(node)
              /* The ring is the ontology type, and only the fills carrying more than
                 one type have one — `document` and `alias` hold a single type each, so
                 their fill already names it. */
              const ring = RING.get(node.type)
              const inside = node.r >= LABEL_INSIDE_AT
              const fontSize = inside ? Math.min(13, Math.max(9.5, node.r / 3.4)) : 9.5
              const lines = inside ? wrap(node.label, node.r, fontSize) : []
              const showOutside =
                !inside && (labelEveryNode || focus === node.nodeId || node.onAnswerPath)
              return (
                <g
                  key={node.nodeId}
                  className={`gc-node${node.proposed ? ' is-proposed' : ''}${
                    node.onAnswerPath ? ' is-path' : ''
                  }${dim ? ' is-dim' : ''}${selected === node.nodeId ? ' is-selected' : ''}${
                    node.degree >= 6 ? ' is-hub' : ''
                  }`}
                  onMouseDown={() => setDragging(node.nodeId)}
                  onMouseEnter={() => setHovered(node.nodeId)}
                  onClick={() => onSelect(selected === node.nodeId ? null : node.nodeId)}
                >
                  {/* The white halo is what separates a node from the page and from
                      whatever it overlaps; drawn under the fill so it cannot lighten
                      the colour the legend promises. */}
                  <circle className="gc-halo" cx={p.x} cy={p.y} r={node.r + 3} />
                  <circle className="gc-disc" cx={p.x} cy={p.y} r={node.r} fill={fill} />
                  {/* The type ring is its own circle rather than a stroke on the disc:
                      the disc's stroke is where the *states* are drawn (proposed,
                      selected, answer path), and a stylesheet rule beats a
                      presentation attribute — so a ring set there would be overridden
                      by the base style and would then fight those states. Drawn inside
                      the rim, so the state stroke still reads on the outer edge. */}
                  {ring ? (
                    <circle
                      className="gc-ring"
                      cx={p.x}
                      cy={p.y}
                      r={Math.max(2, node.r - 1.5)}
                      fill="none"
                      stroke={ring}
                      strokeWidth={2.4}
                    />
                  ) : null}
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
                  ) : showOutside ? (
                    /* Beside the circle, not under it: the label of a 23px node is
                       four times its width, and stacking those vertically is what
                       made them collide. Halo'd, so it survives crossing a line. */
                    <text
                      className="gc-node-outside"
                      x={p.x + node.r + 4}
                      y={p.y + 3}
                      textAnchor="start"
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
          </g>
        </svg>

        <div className="gc-view-controls">
          {/* Reset is only offered once the view has moved, so it is never a dead
              control — and it says what it would undo. */}
          {view.k !== IDENTITY.k || view.tx !== 0 || view.ty !== 0 ? (
            <button type="button" className="gc-view-btn" onClick={() => setView(IDENTITY)}>
              Reset view · {view.k.toFixed(2)}×
            </button>
          ) : null}
          {/*
            A plain anchor with `target="_blank"`, not a router navigation: the point is
            a second tab, so the studio keeps its place — its queue, its decisions and
            whatever the reader had already zoomed to. `rel="noreferrer"` because a new
            tab reached through `target` otherwise gets a handle on this window.
          */}
          {fullViewHref ? (
            <a
              className="gc-view-btn"
              href={fullViewHref}
              target="_blank"
              rel="noreferrer"
              title="Open this graph in a new tab, using the whole window"
            >
              Full view ↗
            </a>
          ) : null}
        </div>

        {selected ? (
          <div className="gc-focus-note">
            Showing <strong>{byId.get(selected)?.label}</strong> and its{' '}
            {(neighbourhood?.size ?? 1) - 1} neighbour(s). Click the background to show
            all {canvas.nodeCount}.
          </div>
        ) : null}
      </div>

      <div className="gc-legend">
        <div className="gc-legend-axis">
          <span className="gc-legend-axis-label">Fill · where it came from</span>
          {CANVAS_GROUPS.map((g) => (
            <button
              key={g.key}
              type="button"
              /* The legend *is* the origin filter. One control cannot disagree with
                 itself about what a colour means and what it shows. */
              className={`gc-legend-item${groups.includes(g.key) ? ' is-on' : ''}`}
              onClick={() => toggle(groups, setGroups, g.key)}
              aria-pressed={groups.includes(g.key)}
            >
              <span className="gc-dot" style={{ background: g.color }} aria-hidden="true" />
              {g.label}
              <span className="gc-legend-count">{groupCount.get(g.key) ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="gc-legend-axis">
          <span className="gc-legend-axis-label">Ring · what kind of thing</span>
          {CANVAS_TYPE_RINGS.map((r) => (
            <button
              key={r.type}
              type="button"
              className={`gc-legend-item${types.includes(r.type) ? ' is-on' : ''}`}
              onClick={() => toggle(types, setTypes, r.type)}
              aria-pressed={types.includes(r.type)}
            >
              <span
                className="gc-dot is-ring"
                style={{
                  borderColor: r.color,
                  background: GROUP.get(r.group)?.color ?? 'transparent',
                }}
                aria-hidden="true"
              />
              {r.type}
              <span className="gc-legend-count">{typeCount.get(r.type) ?? 0}</span>
            </button>
          ))}
          {/* No ring, because their fill already names them — said here rather than
              left as a gap the reader has to explain to themselves. */}
          {CANVAS_UNRINGED.map((u) => (
            <button
              key={u.type}
              type="button"
              className={`gc-legend-item${types.includes(u.type) ? ' is-on' : ''}`}
              onClick={() => toggle(types, setTypes, u.type)}
              aria-pressed={types.includes(u.type)}
              title={`${u.type} is the only type on the ${u.group} fill, so it carries no ring`}
            >
              <span
                className="gc-dot"
                style={{ background: GROUP.get(u.group)?.color ?? 'transparent' }}
                aria-hidden="true"
              />
              {u.type}
              <span className="gc-legend-count">{typeCount.get(u.type) ?? 0}</span>
            </button>
          ))}
        </div>

        <span className="gc-legend-hint">
          size = relationships · dashed = under review · glow = answer path. Scroll to
          zoom, drag the background to pan, click a node to see just its
          neighbourhood. Labels arrive once you zoom past {LABEL_AT_ZOOM}× or filter
          the view down; hover any node for its name, type and source.
        </span>
      </div>
    </div>
  )
}
