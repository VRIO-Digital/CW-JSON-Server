import { LeftOutlined, ReloadOutlined, RightOutlined } from '@ant-design/icons'
import { Button, Tooltip } from 'antd'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  depthOpacity,
  fillFor,
  labelledIds,
  LABELS_SHOWN,
  measureSpread,
  partitionKey,
  projectGlobe,
  ROTATION_STEP,
  seedBodies,
  stepSimulation,
  traceFor,
  typeColor,
  warmupPasses,
  worldFor,
  type Body,
  type Camera,
  type ForceGraph,
  type ForceNode,
} from '../../data/studioForceGraph'
import { radiusFor } from '../../graph-viewer/lib/graph'
import './ForceCanvas.css'

/**
 * Canvas 2 — **the settled graph, drawn as one body seen at night.**
 *
 * Hand-drawn SVG over a hand-rolled simulation, for the reason every other drawing in this app is
 * hand-drawn: a second graph library for one projection would widen the dependency surface through a
 * gate that fails on any advisory at `low`, and the maths is one pure module.
 *
 * **The geometry is not here.** `src/data/studioForceGraph.ts` owns the physics, the projection and
 * the trace; this component owns the camera, the paint order and the pointer. That split is the one
 * `studioGlobe` and `dataModelCanvas` have, and for the same reason: a rule written inside a
 * component can only be asserted by rendering it, and `renderToString` hands it an unsettled layout
 * with no measured box.
 *
 * **The simulation is flat and the sphere is presentation.** Depth is applied at paint time and
 * nowhere else, so dragging, hovering, picking and panning all work against the painted position —
 * which is what a projected point *is* once `paint` has run. Nothing opaque is drawn, so a far-side
 * node is dimmer and smaller and stays clickable.
 *
 * **Every `<defs>` id is prefixed per instance.** `url(#…)` resolves to the first match in document
 * order, so two canvases on one page with the same gradient ids would have the second one's marks
 * silently reading the first one's — in the first one's coordinate space.
 */

/** Painted before layout and in any `renderToString`, so the first frame draws a real sphere rather
 *  than a degenerate one: a zero-width box is what `clientWidth` reports before layout. */
const FALLBACK_BOX = { w: 920, h: 560 }

/** The room the labels need outside the sphere; the radius is what is left of the smaller side. */
const PAD = 64

/** How far a press may travel and still be a click rather than a pan. Below this a background press
 *  clears the selection; above it, it was a drag and must not. */
const CLICK_SLOP = 5

/** Relaxation passes per animation frame while the layout is still moving. */
const PASSES_PER_FRAME = 2

/**
 * The night palette — the canvas reads as a city seen from a plane after dark, and that premise
 * drives every value here.
 *
 * A node is a **light**, never a lit sphere: the gradient's focus is dead centre and starts from a
 * near-white core, because an off-centre focus with a dark rim reads as a ball lit from somewhere,
 * which is the one thing a light source is not. The shadow is a **glow** — warm for every family,
 * deliberately, because it is the haze the scene is seen through and haze does not change colour per
 * lamp.
 *
 * Bridge edges carry explicit night colours rather than theme tokens: those are picked for a light
 * surface and sink into this background.
 */
const BRIDGE_COLOR = { identity: '#ffc98a', attribute: '#c8924e' } as const
const LANE_EDGE_COLOR = { structured: '#6f86b8', documents: '#9b7fc4', has_instance: 'transparent' } as const

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function ForceCanvas({
  graph,
  height,
  resets,
  selectedId,
  onSelect,
  onReset,
}: {
  graph: ForceGraph
  height: number
  /** Bumped by Reset. Folded into the layout's identity so a reset really re-seeds — see
   *  `partitionKey`, where the reason this is a counter rather than a boolean is written down. */
  resets: number
  selectedId: string | null
  /** Nullable, because a selection has to be clearable: a callback that cannot express "nothing" is
   *  a selection with no way out, which is how a canvas comes to have a ring nobody can dismiss. */
  onSelect: (id: string | null) => void
  /** The tab's own Reset — this component only calls it. A button reachable from the canvas itself
   *  is the one asked for directly: the filter row above the drawing is not "on the graph", and a
   *  reader looking at a graph that has drifted under them should not have to look away from it to
   *  find the way back. Optional so a bare-`ForceCanvas` caller with nothing to reset (none exist
   *  yet, but the props already separate "select" from "reset" for exactly this reason) is not
   *  forced to wire a no-op. */
  onReset?: () => void
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState(FALLBACK_BOX)
  const ids = useId()

  const [target, setTarget] = useState(0)
  const [rotation, setRotation] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [hoverId, setHoverId] = useState<string | null>(null)
  /* A counter rather than the bodies themselves: the simulation mutates one array in place, and
     copying eight hundred bodies a frame to satisfy React's identity check would cost more than the
     pass that produced them. */
  const [tick, setTick] = useState(0)

  const reduced = useMemo(prefersReducedMotion, [])
  const world = useMemo(() => worldFor(graph.nodes.length), [graph.nodes.length])
  const key = useMemo(() => partitionKey(graph, resets), [graph, resets])

  const bodiesRef = useRef<Body[]>([])
  const keyRef = useRef<string>('')
  const energyRef = useRef(0)

  /*
   * The layout, re-seeded only when its identity changes.
   *
   * Reusing positions is what keeps a filter from throwing the reader's mental map away — and it is
   * exactly why Reset has to change the identity rather than only the camera, or it would restore
   * the view over a graph that had not moved.
   */
  if (keyRef.current !== key) {
    keyRef.current = key
    bodiesRef.current = seedBodies(graph.nodes, world)
    const passes = warmupPasses(graph.nodes.length)
    for (let i = 0; i < passes; i += 1) {
      stepSimulation({ bodies: bodiesRef.current, edges: graph.edges, nodes: graph.nodes, world })
    }
    energyRef.current = 30
  }

  /*
   * The camera's own half of Reset.
   *
   * `resets` re-seeding `key` above brings the LAYOUT back — new positions, a fresh warmup — but a
   * reader who had zoomed in, panned, or turned the globe before pressing Reset would see none of
   * that undone: the bodies moved under a camera that stayed exactly where it was, which reads as a
   * button that did nothing if the view was the thing they were trying to escape. Camera state
   * (rotation, zoom, pan) is React state here rather than folded into `key`, because re-seeding on
   * every pan would fight the reader's own drag — so it needs its own effect, watching the same
   * prop the layout reseed watches.
   */
  useEffect(() => {
    setTarget(0)
    setRotation(0)
    setZoom(1)
    setPan({ x: 0, y: 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to the Reset press, not to the camera state it is setting
  }, [resets])

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      const w = el.clientWidth || rect.width
      const h = el.clientHeight || rect.height
      /* A box that has not been laid out measures 0, and a sphere centred on that is a dot in the
         corner — the measurement trap every drawing in this app guards against. */
      if (w > 0 && h > 0) setBox({ w, h })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  /*
   * One frame while something is still moving, and **nothing at all between turns.**
   *
   * The loop is guarded on whether the layout still has energy or the rotation is still easing, so a
   * settled canvas with nobody touching it repaints zero times. A loop that owns the clock would
   * redraw eight hundred discs a frame to show a drawing that is not changing.
   */
  useEffect(() => {
    const easing = Math.abs(target - rotation) > 0.0005
    if (energyRef.current <= 0 && !easing) return
    const id = requestAnimationFrame(() => {
      if (energyRef.current > 0) {
        for (let i = 0; i < PASSES_PER_FRAME; i += 1) {
          stepSimulation({ bodies: bodiesRef.current, edges: graph.edges, nodes: graph.nodes, world })
        }
        energyRef.current -= 1
      }
      if (easing) {
        if (reduced) setRotation(target)
        else {
          const remaining = target - rotation
          /* The last sliver is snapped, or an exponential approach never arrives and fifteen presses
             stop being exactly one turn. */
          setRotation(Math.abs(remaining) < 0.01 ? target : rotation + remaining * 0.18)
        }
      }
      setTick((n) => n + 1)
    })
    return () => cancelAnimationFrame(id)
  }, [tick, target, rotation, reduced, graph, world])

  const revolve = useCallback((direction: 1 | -1) => {
    setTarget((current) => current + direction * ROTATION_STEP)
  }, [])

  const clearView = useCallback(() => {
    onSelect(null)
    setHoverId(null)
  }, [onSelect])

  /* Escape clears the selection, which is one of the four ways out — the others being a background
     click, clicking the selected mark again, and Reset. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearView()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clearView])

  /* Registered by hand with `{ passive: false }`: React attaches `onWheel` passively, and a passive
     listener cannot `preventDefault`, so a wheel zoom written as a JSX prop scrolls the page behind
     itself. */
  const stageRef = useRef<SVGSVGElement | null>(null)
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      setZoom((current) => Math.min(3.2, Math.max(0.45, current * (event.deltaY > 0 ? 0.92 : 1.08))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const camera: Camera = useMemo(
    () => ({
      rotation,
      radius: Math.max(70, (Math.min(box.w, box.h) / 2 - PAD) * zoom),
      cx: box.w / 2 + pan.x,
      cy: box.h / 2 + pan.y,
    }),
    [rotation, box, zoom, pan],
  )

  const nodeById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes])
  const trace = useMemo(() => traceFor(graph, selectedId), [graph, selectedId])

  /*
   * The paint list, rebuilt each frame from the bodies the simulation is mutating.
   *
   * **Sorted by depth, because SVG has no z-index**: paint order *is* depth order, so a near node
   * paints over a far one only if it is drawn after it.
   */
  const painted = useMemo(() => {
    void tick
    const bodies = bodiesRef.current
    const spread = measureSpread(bodies)
    const fill = fillFor(bodies.length)
    const byId = new Map(bodies.map((body) => [body.id, body]))

    const marks = bodies
      .map((body) => {
        const node = nodeById.get(body.id)
        if (!node) return null
        const point = projectGlobe(body, spread, fill, camera)
        return {
          node,
          body,
          x: point.x,
          y: point.y,
          depth: point.depth,
          radius: radiusFor({ element_class: node.elementClass, degree: node.degree }) * point.scale * zoom,
        }
      })
      .filter((mark): mark is NonNullable<typeof mark> => mark !== null)
      .sort((a, b) => a.depth - b.depth)

    const at = new Map(marks.map((mark) => [mark.node.id, mark]))
    const lines = graph.edges
      .filter((edge) => !edge.layoutOnly)
      .map((edge) => {
        const a = at.get(edge.source)
        const b = at.get(edge.target)
        if (!a || !b) return null
        return { edge, a, b, depth: (a.depth + b.depth) / 2 }
      })
      .filter((line): line is NonNullable<typeof line> => line !== null)
      .sort((a, b) => a.depth - b.depth)

    void byId
    return { marks, lines }
  }, [tick, camera, graph.edges, nodeById, zoom])

  const labels = useMemo(
    () =>
      labelledIds(
        painted.marks.map((mark) => ({ id: mark.node.id, depth: mark.depth, radius: mark.radius })),
        new Set([...trace.nodes, ...(hoverId ? [hoverId] : [])]),
      ),
    [painted.marks, trace.nodes, hoverId],
  )

  /* Which endpoint a Bridge names — the Bridge's correspondence is the thing this canvas exists to
     make legible, so its two ends stay a spotlight even when nothing is selected. */
  const bridged = useMemo(() => {
    const ids = new Set<string>()
    for (const edge of graph.edges) {
      if (edge.kind !== 'bridge') continue
      ids.add(edge.source)
      ids.add(edge.target)
    }
    return ids
  }, [graph.edges])

  /*
   * The bloom is a spotlight, not ambient light — every node carried it unconditionally (a blurred
   * halo AND a blur filter on the sphere itself), which at a few hundred nodes stopped reading as
   * individual lights and became one warm haze with the graph's actual shape lost inside it. Gated
   * to the small set worth drawing attention to: labelled (already capped), traced from a selection,
   * hovered, or a Bridge endpoint. Everything else is a small, crisp, unfiltered disc — legible at a
   * glance rather than blurred together, which is the reading a night sky actually gives a field of
   * distant lights next to the handful close enough to bloom. */
  const spotlit = (id: string): boolean =>
    labels.has(id) || trace.nodes.has(id) || id === hoverId || bridged.has(id)

  /* One gesture state for the pointer, because a drag on a node and a drag on the background are the
     same press until it moves — and the threshold is what tells a click from a pan. */
  const gesture = useRef<{
    id: string | null
    startX: number
    startY: number
    panX: number
    panY: number
    moved: boolean
  } | null>(null)

  const onPointerDown = (event: React.PointerEvent<SVGElement>, id: string | null) => {
    ;(event.target as Element).setPointerCapture?.(event.pointerId)
    gesture.current = {
      id,
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y,
      moved: false,
    }
    if (id) {
      const body = bodiesRef.current.find((candidate) => candidate.id === id)
      if (body) body.drag = true
    }
  }

  const onPointerMove = (event: React.PointerEvent<SVGElement>) => {
    const active = gesture.current
    if (!active) return
    const dx = event.clientX - active.startX
    const dy = event.clientY - active.startY
    if (!active.moved && Math.hypot(dx, dy) > CLICK_SLOP) active.moved = true
    if (!active.moved) return
    if (active.id) {
      /* A dragged node is moved in *world* units, which is what the simulation holds — the projection
         is one-way, so dragging against the painted position would move it by however much the
         sphere happened to foreshorten it there. */
      const body = bodiesRef.current.find((candidate) => candidate.id === active.id)
      if (body) {
        body.x += dx / (zoom * 1.4)
        body.y += dy / (zoom * 1.4)
        active.startX = event.clientX
        active.startY = event.clientY
        setTick((n) => n + 1)
      }
    } else {
      setPan({ x: active.panX + dx, y: active.panY + dy })
    }
  }

  const onPointerUp = () => {
    const active = gesture.current
    gesture.current = null
    if (!active) return
    if (active.id) {
      const body = bodiesRef.current.find((candidate) => candidate.id === active.id)
      if (body) {
        body.drag = false
        /* Dropped where it was put: the reader has stated where this one belongs, and letting the
           springs pull it back would undo the act in front of them. */
        if (active.moved) body.pinned = true
      }
      if (!active.moved) onSelect(active.id === selectedId ? null : active.id)
      /* A drag wakes the rest of the layout so its neighbours settle around the new position. */
      if (active.moved) energyRef.current = Math.max(energyRef.current, 18)
      return
    }
    if (!active.moved) clearView()
  }

  const dim = (id: string): boolean => selectedId !== null && !trace.nodes.has(id)

  return (
    <div className="fc">
      <Tooltip title="Revolve left">
        <Button
          className="fc-revolve"
          shape="circle"
          icon={<LeftOutlined />}
          aria-label="Revolve the graph left"
          onClick={() => revolve(1)}
        />
      </Tooltip>

      <div className="fc-stage" ref={wrapRef} style={{ height }}>
        {onReset ? (
          <Tooltip title="Reset view">
            <Button
              className="fc-reset"
              size="small"
              icon={<ReloadOutlined />}
              aria-label="Reset the graph view"
              onClick={onReset}
            />
          </Tooltip>
        ) : null}
        <svg
          ref={stageRef}
          className="fc-svg"
          width={box.w}
          height={box.h}
          viewBox={`0 0 ${box.w} ${box.h}`}
          role="img"
          aria-label="The structured and document lanes as one settled graph"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => {
            setHoverId(null)
            onPointerUp()
          }}
        >
          <defs>
            <radialGradient id={`${ids}-core`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#fffaf0" stopOpacity="1" />
              <stop offset="45%" stopColor="#ffd9a3" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#ffb459" stopOpacity="0.25" />
            </radialGradient>
            <filter id={`${ids}-glow`} x="-120%" y="-120%" width="340%" height="340%">
              {/* A glow rather than a drop shadow: `dy` is 0 and the flood is warm, because a light
                  blooms into the dark rather than casting onto it. */}
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feFlood floodColor="#ffb774" floodOpacity="0.5" result="warm" />
              <feComposite in="warm" in2="blur" operator="in" result="tint" />
              <feMerge>
                <feMergeNode in="tint" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Transparent, and in world coordinates: it is the hit target that makes background
              panning and background-click-to-deselect work, and painting it would put a rectangle
              inside the viewBox that comes into frame as soon as anybody zooms out. */}
          <rect
            className="fc-ground"
            x={0}
            y={0}
            width={box.w}
            height={box.h}
            onPointerDown={(event) => onPointerDown(event, null)}
          />

          <g className="fc-edges">
            {painted.lines.map(({ edge, a, b, depth }) => {
              const lit = trace.edges.has(edge.id)
              const color =
                edge.kind === 'bridge'
                  ? BRIDGE_COLOR[edge.verdict ?? 'attribute']
                  : LANE_EDGE_COLOR[edge.kind as keyof typeof LANE_EDGE_COLOR]
              /* A Bridge row is a claim, never a join — it is never traversable, the same rule the
                 flat Canvas tab and the Globe frame both keep. A lane edge (structured or documents)
                 IS an asserted, traversable relationship, so it is the one that flows: a real graph
                 reads as alive, and a static line beside a glowing sphere is the one thing on this
                 canvas that never moved. */
              const traversable = edge.kind === 'structured' || edge.kind === 'documents'
              const opacity =
                (selectedId !== null && !lit ? 0.12 : 1) * depthOpacity(depth) * (lit ? 1 : 0.7)
              const strokeWidth = edge.kind === 'bridge' ? (lit ? 2.4 : 1.5) : lit ? 1.8 : 0.9
              /* `<animateMotion>`'s `<mpath>` can only follow a `<path>`, not a `<line>` — so a
                 traversable edge is a straight-line PATH (renders identically to a line) with a
                 stable id the packet's motion path references; everything else stays the plain line
                 it always was, since nothing but the packet needs a referenceable geometry. */
              if (!traversable) {
                return (
                  <line
                    key={edge.id}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={color}
                    strokeWidth={strokeWidth}
                    strokeDasharray={edge.kind === 'bridge' ? '5 4' : undefined}
                    opacity={opacity}
                  />
                )
              }
              const pathId = `${ids}-edge-${edge.id}`
              return (
                <g key={edge.id}>
                  <path
                    id={pathId}
                    d={`M${a.x},${a.y} L${b.x},${b.y}`}
                    fill="none"
                    stroke={color}
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    strokeDasharray={reduced ? undefined : '7 9'}
                    opacity={opacity}
                  >
                    {!reduced ? (
                      <animate
                        attributeName="stroke-dashoffset"
                        from="64"
                        to="0"
                        dur="3s"
                        repeatCount="indefinite"
                      />
                    ) : null}
                  </path>
                  {/* The travelling light — a packet moving the join in the relationship's own
                      direction, which is what "flowing" actually means rather than merely implies.
                      Skipped under reduced motion, same as the dash above. */}
                  {!reduced ? (
                    <circle r={lit ? 2.6 : 2} fill={color} opacity={opacity}>
                      <animateMotion dur="3s" repeatCount="indefinite">
                        <mpath href={`#${pathId}`} />
                      </animateMotion>
                    </circle>
                  ) : null}
                </g>
              )
            })}
          </g>

          <g className="fc-nodes">
            {painted.marks.map((mark) => {
              const faded = dim(mark.node.id)
              const selected = mark.node.id === selectedId
              const opacity = depthOpacity(mark.depth) * (faded ? 0.18 : 1)
              const spot = spotlit(mark.node.id)
              return (
                <g key={mark.node.id} opacity={opacity}>
                  {spot ? (
                    <circle
                      className="fc-halo"
                      cx={mark.x}
                      cy={mark.y}
                      r={mark.radius * 2.6}
                      fill={typeColor(mark.node.type)}
                      opacity={0.55}
                    />
                  ) : null}
                  <circle
                    cx={mark.x}
                    cy={mark.y}
                    r={mark.radius}
                    fill={typeColor(mark.node.type)}
                    filter={spot ? `url(#${ids}-glow)` : undefined}
                  />
                  <circle
                    cx={mark.x}
                    cy={mark.y}
                    r={mark.radius * 0.55}
                    fill={`url(#${ids}-core)`}
                    pointerEvents="none"
                  />
                  {selected ? (
                    <circle
                      className="fc-ring"
                      cx={mark.x}
                      cy={mark.y}
                      r={mark.radius + 6}
                      pointerEvents="none"
                    />
                  ) : null}
                  {/* A hit circle of its own, so a 4px disc is still reachable — the mark is the
                      drawing and this is the target. */}
                  <circle
                    cx={mark.x}
                    cy={mark.y}
                    r={Math.max(11, mark.radius + 5)}
                    fill="transparent"
                    className="fc-hit"
                    onPointerDown={(event) => {
                      event.stopPropagation()
                      onPointerDown(event, mark.node.id)
                    }}
                    onPointerEnter={() => setHoverId(mark.node.id)}
                  />
                </g>
              )
            })}
          </g>

          <g className="fc-labels" pointerEvents="none">
            {painted.marks
              .filter((mark) => labels.has(mark.node.id) && !dim(mark.node.id))
              .map((mark) => (
                <text
                  key={mark.node.id}
                  x={mark.x}
                  y={mark.y - mark.radius - 7}
                  textAnchor="middle"
                  opacity={depthOpacity(mark.depth)}
                >
                  {mark.node.label}
                </text>
              ))}
          </g>
        </svg>
      </div>

      <Tooltip title="Revolve right">
        <Button
          className="fc-revolve"
          shape="circle"
          icon={<RightOutlined />}
          aria-label="Revolve the graph right"
          onClick={() => revolve(-1)}
        />
      </Tooltip>
    </div>
  )
}

/** Exported so the tab can state the cap beside the drawing rather than restating the number. */
export const labelCapNote = `at most ${LABELS_SHOWN} labels at once`

export type { ForceNode }
