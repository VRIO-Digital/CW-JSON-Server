import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import { Button, Tooltip } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  arcPath,
  depthOpacity,
  depthScale,
  graticulePaths,
  labelledIds,
  LABELS_SHOWN,
  MIN_RADIUS,
  project,
  rimPath,
  ROTATION_STEP,
  type GlobeGraph,
  type GlobeView,
} from '../../data/studioGlobe'
import { colorFor, radiusFor } from '../../graph-viewer/lib/graph'
import { BRAND } from '../../theme'
import './GlobeCanvas.css'

/**
 * The combined graph as a revolvable sphere — the structured lane's hemisphere and the document
 * lane's, closed along the rim the Bridge stitches.
 *
 * **Hand-drawn SVG, for the reason every other drawing in this app is.** The answer charts, the
 * What-if frame and the Data Modeling canvas all are; a second graph library for one projection
 * would widen the dependency surface through a gate that fails on any advisory at `low`, and the
 * maths is one pure module.
 *
 * **The geometry is not here.** `src/data/studioGlobe.ts` owns the layout, the projection and the
 * arcs; this component owns the camera's rotation, the selection and the paint order. That split is
 * the one `dataModelCanvas` has, and for the same reason: a layout rule written inside a component
 * can only be asserted by rendering it, and `renderToString` hands it a rotation of zero and no
 * measured box.
 *
 * **Not all of it is visible at once, and that is the point of the frame rather than a limitation.**
 * A sphere has a far side; revolving is what brings it round. So the far side is faded rather than
 * cut — a mark that vanished the moment it crossed the rim would read as a node being deleted — and
 * the two buttons are the only way to see the rest.
 */

/** Painted before layout and in any `renderToString`, so the first frame draws a real sphere rather
 *  than a degenerate one. A zero-width box is what `clientWidth` reports before layout, and a sphere
 *  laid out on it collapses to a point. */
const FALLBACK_BOX = { w: 900, h: 560 }

/** The room the labels need outside the sphere; the radius is what is left of the smaller side. */
const PAD = 58

/** Each hemisphere's accent — used on the legend and the pole caption only, never on a node, whose
 *  colour stays the viewer's own `colorFor` so the globe and the flat canvas cannot disagree about
 *  what a type looks like. */
const HEMISPHERE = {
  structured: { accent: '#79b8ff', title: 'Structured', caption: 'tables and concepts' },
  documents: { accent: '#ab8dff', title: 'Documents', caption: 'the corpus and what it names' },
} as const

/* The night palette's own edge tokens — a lane's edge colour is its family's `mid`, and the
 * Bridge's is the sodium-amber the style guide gives a decided correspondence, warmer than the
 * app's own `BRAND` so it reads as the strongest mark on the drawing rather than a UI accent
 * borrowed from elsewhere. */
const EDGE_COLOR = {
  structured: '#79b8ff',
  documents: '#ab8dff',
  bridge: '#ffd88a',
} as const

/* One warm glow for every node, regardless of hemisphere — "the haze the whole scene is seen
 * through, and haze does not change colour per lamp." */
const GLOW_COLOR = '#ffb060'

/* `#rrggbb` -> `[r,g,b]`. No alpha, no shorthand — every colour this file mixes comes from
 * `colorFor`, which always returns six hex digits. */
const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]
const toHex = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
/** Mix a colour toward white (`t` > 0) or black (`t` < 0), `t` in [-1, 1]. */
const shade = (hex: string, t: number): string => {
  const [r, g, b] = rgb(hex)
  const toward = t >= 0 ? 255 : 0
  const amt = Math.abs(t)
  return `#${toHex(r + (toward - r) * amt)}${toHex(g + (toward - g) * amt)}${toHex(b + (toward - b) * amt)}`
}
/** A stable, DOM-safe id for a gradient keyed by the colour it renders — `colorFor` returns a
 *  small, fixed palette (24 hexes across both ontologies), so one `<radialGradient>` per unique
 *  colour is cheap to define and reused by every node that shares a type. */
const sphereGradientId = (hex: string) => `gl-sph-${hex.slice(1)}`

/* The night palette, as plain values rather than CSS custom properties — an inline `style`
 * cannot be beaten by anything in the cascade, which is what actually matters here: the stage's
 * ground kept losing to some other rule (never pinned down which) painting it back to a light
 * card background. Applying it inline sidesteps the question of *why* entirely. The `.gl-*`
 * classes in `GlobeCanvas.css` still carry layout, borders and typography — only the four
 * background-critical surfaces below are also set inline, as a floor nothing else can undercut. */
const NIGHT = {
  ground: '#0b0f18',
  groundMid: '#070a11',
  groundDeep: '#04060b',
  panel: 'rgba(11, 15, 24, 0.86)',
  panelBorder: 'rgba(232, 226, 214, 0.12)',
} as const

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function GlobeCanvas({ graph, height }: { graph: GlobeGraph; height: number }) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState(FALLBACK_BOX)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  /*
   * Two numbers, not one: `target` is where the reader has asked the sphere to be and `rotation` is
   * where it has got to. A single value stepped on the click would make each press a jump — the
   * revolve is the whole act being asked for here, so it has to be watchable.
   */
  const [target, setTarget] = useState(0)
  const [rotation, setRotation] = useState(0)
  const reduced = useMemo(prefersReducedMotion, [])

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      const w = el.clientWidth || rect.width
      const h = el.clientHeight || rect.height
      /* A box that has not been laid out measures 0, and a sphere centred on that is a dot in the
         corner — the same measurement trap the force viewer's `box()` guards against. */
      if (w > 0 && h > 0) setBox({ w, h })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  /*
   * One frame per render, toward the target — rather than a loop that owns the clock.
   *
   * A press moves the target and this chases it; when it is within a hair the last step lands
   * exactly on it, so twelve presses are exactly one turn and the reading never drifts. Reduced
   * motion takes the jump, because the state is legible either way: what changes is which nodes are
   * facing the reader, and that is visible without the travel.
   */
  useEffect(() => {
    const delta = target - rotation
    if (Math.abs(delta) < 0.0005) return
    if (reduced) {
      setRotation(target)
      return
    }
    const id = requestAnimationFrame(() => {
      setRotation((current) => {
        const remaining = target - current
        return Math.abs(remaining) < 0.01 ? target : current + remaining * 0.16
      })
    })
    return () => cancelAnimationFrame(id)
  }, [rotation, target, reduced])

  const revolve = useCallback((direction: 1 | -1) => {
    setTarget((current) => current + direction * ROTATION_STEP)
  }, [])

  const view: GlobeView = useMemo(
    () => ({
      rotation,
      radius: Math.max(MIN_RADIUS, Math.min(box.w, box.h) / 2 - PAD),
      cx: box.w / 2,
      cy: box.h / 2,
    }),
    [rotation, box],
  )

  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph])

  /* The clicked node and everything one hop from it — the same neighbourhood rule the flat viewer
     uses, so selecting means the same thing on both frames. */
  const hood = useMemo(() => {
    if (!selectedId) return null
    const nodes = new Set<string>([selectedId])
    const edges = new Set<string>()
    for (const edge of graph.edges) {
      if (edge.source !== selectedId && edge.target !== selectedId) continue
      nodes.add(edge.source)
      nodes.add(edge.target)
      edges.add(edge.id)
    }
    return { nodes, edges }
  }, [selectedId, graph])

  const placed = useMemo(
    () =>
      graph.nodes
        .map((node) => {
          const p = project(node, view)
          return {
            node,
            ...p,
            radius:
              radiusFor({ element_class: node.elementClass, degree: node.degree }) *
              depthScale(p.depth),
          }
        })
        /* Painter's order: the far side first, so a node in front covers what it is in front of.
           Without it the sphere has no near side at all. */
        .sort((a, b) => a.depth - b.depth),
    [graph, view],
  )

  const labels = useMemo(
    () => labelledIds(placed.map((r) => ({ id: r.node.id, depth: r.depth, radius: r.radius })), selectedId ? new Set([selectedId]) : new Set()),
    [placed, selectedId],
  )

  /* Every unique colour `colorFor` will be asked for by this graph — small and fixed (the palette
   * has 24 hexes across both ontologies), so one `<radialGradient>` per colour, defined once, is
   * cheap and lets every node of a type share the same "lamp" gradient rather than a flat fill. */
  const spherePalette = useMemo(
    () => Array.from(new Set(graph.nodes.map((node) => colorFor(node.type)))),
    [graph],
  )

  /* Bloom is a spotlight, not ambient light — applied to every node in a graph of a few hundred it
   * stopped reading as individual lamps and became a single warm haze (worst where many nodes of
   * one colour cluster, which is what turned a dense knot of green-family nodes into one solid
   * blob). So only the nodes actually worth drawing attention to get it: the ones labelled (already
   * capped at `LABELS_SHOWN`), the ones the Bridge names, and whichever is selected. Everything else
   * is a small, crisp, gradient-lit disc with no filter at all — legible at a glance rather than
   * blurred together. */
  const prominent = (id: string, bridged: boolean) => bridged || labels.has(id) || id === selectedId

  const arcs = useMemo(
    () =>
      graph.edges
        .map((edge) => {
          const a = byId.get(edge.source)
          const b = byId.get(edge.target)
          if (!a || !b) return null
          return { edge, ...arcPath(a, b, view) }
        })
        .filter((row): row is { edge: (typeof graph.edges)[number]; d: string; depth: number } =>
          Boolean(row),
        )
        .sort((a, b) => a.depth - b.depth),
    [graph, byId, view],
  )

  const wire = useMemo(() => graticulePaths(view), [view])
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null
  const counts = useMemo(
    () => ({
      structured: graph.nodes.filter((n) => n.hemisphere === 'structured').length,
      documents: graph.nodes.filter((n) => n.hemisphere === 'documents').length,
      bridge: graph.edges.filter((e) => e.kind === 'bridge').length,
    }),
    [graph],
  )

  const bearing = Math.round((((-rotation * 180) / Math.PI) % 360 + 360) % 360)
  const dimmed = (id: string) => Boolean(hood) && !hood!.nodes.has(id)

  const back = placed.filter((row) => row.depth <= 0)
  const front = placed.filter((row) => row.depth > 0)
  const backArcs = arcs.filter((row) => row.depth <= 0)
  const frontArcs = arcs.filter((row) => row.depth > 0)

  const drawArc = (row: (typeof arcs)[number]) => (
    <path
      key={row.edge.id}
      d={row.d}
      className={`gl-arc gl-arc-${row.edge.kind}`}
      stroke={EDGE_COLOR[row.edge.kind]}
      strokeWidth={row.edge.kind === 'bridge' ? 1.6 : 1}
      opacity={
        depthOpacity(row.depth) *
        (hood ? (hood.edges.has(row.edge.id) ? 1 : 0.12) : row.edge.kind === 'bridge' ? 0.95 : 0.6)
      }
    />
  )

  const drawNode = (row: (typeof placed)[number]) => {
    const { node } = row
    const isSelected = node.id === selectedId
    const spot = prominent(node.id, node.bridged)
    return (
      <g
        key={node.id}
        className="gl-node"
        transform={`translate(${row.x} ${row.y})`}
        opacity={depthOpacity(row.depth) * (dimmed(node.id) ? 0.15 : 1)}
        onClick={(event) => {
          event.stopPropagation()
          setSelectedId(node.id)
        }}
      >
        {/* The bloom, gated to the prominent set (see `prominent` above) — a small blurred halo
            behind a full-size, blurrier glow filter on top would compound into the wash this
            replaced, so a labelled/bridged/selected node gets ONE of the two: the halo, sized much
            tighter than the design tokens' 2.6x (which assumes a sparse, zoomed-in force graph, not
            a few hundred nodes on one disc). */}
        {spot ? (
          <circle
            className="gl-node-halo"
            r={row.radius * 1.7}
            fill={colorFor(node.type)}
            opacity={0.3}
            filter="url(#gl-halo-blur)"
          />
        ) : null}
        <circle
          r={row.radius}
          fill={`url(#${sphereGradientId(colorFor(node.type))})`}
          filter={spot ? 'url(#gl-glow)' : undefined}
          stroke={isSelected ? BRAND : 'rgba(8, 11, 18, 0.55)'}
          strokeWidth={isSelected ? 2.4 : 0.75}
        />
        {node.bridged ? <circle r={row.radius + 3.5} className="gl-node-seam" /> : null}
        {labels.has(node.id) ? (
          <text className="gl-node-label" y={-row.radius - 6} textAnchor="middle">
            {node.label.length > 26 ? `${node.label.slice(0, 25)}…` : node.label}
          </text>
        ) : null}
      </g>
    )
  }

  return (
    /* The height sits on the *stage*, not the frame: at narrow widths the panel drops below the
       sphere, and a height on the frame would divide the one number between the two rather than
       leaving the drawing the box it was sized for. */
    <div className="gl">
      <div
        className="gl-stage"
        ref={wrapRef}
        style={{
          height,
          background: `radial-gradient(120% 95% at 50% 45%, ${NIGHT.ground} 0%, ${NIGHT.groundMid} 55%, ${NIGHT.groundDeep} 100%)`,
        }}
      >
        <svg
          className="gl-svg"
          width={box.w}
          height={box.h}
          role="img"
          aria-label={`Combined graph as a sphere, revolved ${bearing} degrees`}
          onClick={() => setSelectedId(null)}
        >
          <defs>
            {/* The sphere's own body, lit from one corner rather than flat — the night palette's
                ground tones, so the ball reads as part of the sky it sits in rather than a paper
                disc laid over it. */}
            <radialGradient id="gl-body" cx="34%" cy="28%" r="78%">
              <stop offset="0%" stopColor="#141a29" />
              <stop offset="62%" stopColor="#0b0f18" />
              <stop offset="100%" stopColor="#05070d" />
            </radialGradient>
            {/* Every node's own "lamp" gradient — near-white core fading through its true
                colour to a darkened rim, the same four-stop shape the reference force graph uses
                per family. One per unique colour rather than per node: `colorFor` draws from a
                small, fixed palette, so the whole graph shares 10-24 of these regardless of node
                count. A flat fill read as a dull, muddy disc on this ground — these colours were
                tuned for a WHITE page — so lightening the centre is what makes a node read as
                something that emits rather than something merely tinted. */}
            {spherePalette.map((hex) => (
              <radialGradient key={hex} id={sphereGradientId(hex)} cx="42%" cy="38%" r="62%">
                <stop offset="0%" stopColor={shade(hex, 0.72)} />
                <stop offset="35%" stopColor={shade(hex, 0.32)} />
                <stop offset="70%" stopColor={hex} />
                <stop offset="100%" stopColor={shade(hex, -0.35)} />
              </radialGradient>
            ))}
            {/* The warm bloom a labelled/bridged/selected node carries — gated to that small set
                (see `prominent`), or hundreds of these compounding is exactly what washed every
                hue into one amber haze. `feDropShadow`, warm flood, soft spread. */}
            <filter id="gl-glow" x="-160%" y="-160%" width="420%" height="420%">
              <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor={GLOW_COLOR} floodOpacity="0.35" />
            </filter>
            <filter id="gl-halo-blur" x="-150%" y="-150%" width="400%" height="400%">
              <feGaussianBlur stdDeviation="3.5" />
            </filter>
          </defs>

          <circle cx={view.cx} cy={view.cy} r={view.radius} fill="url(#gl-body)" />
          <circle cx={view.cx} cy={view.cy} r={view.radius} className="gl-limb" />

          {/* The far half of the rim, dashed: it is behind everything the near half is in front of. */}
          <path d={rimPath(view, 'far')} className="gl-rim gl-rim-far" />
          {backArcs.map(drawArc)}
          {back.map(drawNode)}

          {/*
            * The glass: one wash over the far side, which is what a sphere does to what is behind it.
            * It is what makes "revolve to see the rest" true rather than merely said — and it is a
            * fill rather than a per-node opacity because the two are different claims: the fade is
            * about the mark, this is about the ball being in the way.
            */}
          <circle cx={view.cx} cy={view.cy} r={view.radius} className="gl-glass" />

          <g className="gl-wire">
            {wire.map((d, i) => (
              <path key={i} d={d} />
            ))}
          </g>

          <path d={rimPath(view, 'near')} className="gl-rim gl-rim-near" />
          {frontArcs.map(drawArc)}
          {front.map(drawNode)}

          <text
            className="gl-pole"
            x={view.cx}
            y={view.cy - view.radius - 16}
            textAnchor="middle"
            fill={HEMISPHERE.structured.accent}
          >
            {HEMISPHERE.structured.title.toUpperCase()}
          </text>
          <text
            className="gl-pole"
            x={view.cx}
            y={view.cy + view.radius + 26}
            textAnchor="middle"
            fill={HEMISPHERE.documents.accent}
          >
            {HEMISPHERE.documents.title.toUpperCase()}
          </text>
        </svg>

        <div
          className="gl-legend"
          style={{ background: NIGHT.panel, borderColor: NIGHT.panelBorder }}
        >
          {(['structured', 'documents'] as const).map((key) => (
            <div className="gl-legend-row" key={key}>
              <span className="gl-swatch" style={{ background: HEMISPHERE[key].accent }} />
              <span className="gl-legend-name">{HEMISPHERE[key].title}</span>
              <span className="gl-legend-count">{counts[key]}</span>
            </div>
          ))}
          <div className="gl-legend-row">
            <span
              className="gl-swatch gl-swatch-bridge"
              style={{ background: EDGE_COLOR.bridge }}
            />
            <span className="gl-legend-name">Bridge</span>
            <span className="gl-legend-count">{counts.bridge}</span>
          </div>
          <p className="gl-legend-note">
            {counts.bridge === 0
              ? 'No correspondence has been decided yet, so the rim carries no stitching — the two halves still close, and the Bridge tab is what draws them together.'
              : 'The ringed nodes are the ones the Bridge names; their edges cross the rim.'}
          </p>
        </div>

        <div
          className="gl-controls"
          style={{ background: NIGHT.panel, borderColor: NIGHT.panelBorder }}
        >
          <Tooltip title="Revolve left">
            <Button
              shape="circle"
              icon={<LeftOutlined />}
              aria-label="Revolve the sphere left"
              onClick={() => revolve(1)}
            />
          </Tooltip>
          <span className="gl-bearing">{bearing}°</span>
          <Tooltip title="Revolve right">
            <Button
              shape="circle"
              icon={<RightOutlined />}
              aria-label="Revolve the sphere right"
              onClick={() => revolve(-1)}
            />
          </Tooltip>
        </div>

        {/* One expression, not three: `renderToString` splits `text {expr} text` into separate
            nodes, so a cap interpolated into the middle of a sentence cannot be asserted at all —
            which is exactly how this one first passed over nothing. */}
        <div className="gl-hint">
          {`Revolve to bring the far side round · click a node to inspect it · at most ${LABELS_SHOWN} labels at once`}
        </div>
      </div>

      <aside
        className="gl-inspect"
        style={{
          background: `radial-gradient(140% 100% at 30% 0%, ${NIGHT.groundMid} 0%, ${NIGHT.groundDeep} 100%)`,
          borderColor: NIGHT.panelBorder,
        }}
      >
        {selected ? (
          <>
            <div className="gl-inspect-type" style={{ color: colorFor(selected.type) }}>
              {selected.type}
            </div>
            <h3 className="gl-inspect-name">{selected.label}</h3>
            <dl className="gl-inspect-facts">
              <div>
                <dt>Hemisphere</dt>
                <dd>
                  {HEMISPHERE[selected.hemisphere].title} — {HEMISPHERE[selected.hemisphere].caption}
                </dd>
              </div>
              <div>
                <dt>Edges</dt>
                <dd>{selected.degree}</dd>
              </div>
              {selected.subtype ? (
                <div>
                  <dt>Stated as</dt>
                  <dd>{selected.subtype}</dd>
                </div>
              ) : null}
              {selected.provenance ? (
                <div>
                  <dt>From</dt>
                  <dd>{selected.provenance}</dd>
                </div>
              ) : null}
            </dl>
            {selected.detail ? <p className="gl-inspect-detail">{selected.detail}</p> : null}
            <ul className="gl-inspect-rel">
              {graph.edges
                .filter((e) => e.source === selected.id || e.target === selected.id)
                .map((e) => {
                  const otherId = e.source === selected.id ? e.target : e.source
                  const other = byId.get(otherId)
                  if (!other) return null
                  return (
                    <li key={e.id}>
                      <span className={`gl-rel-kind gl-rel-${e.kind}`}>{e.label || e.kind}</span>
                      <button type="button" onClick={() => setSelectedId(other.id)}>
                        {other.label}
                      </button>
                    </li>
                  )
                })}
            </ul>
          </>
        ) : (
          <p className="gl-inspect-empty">
            Two lanes, one sphere: the structured graph is the upper half, the documents the lower,
            and the rim between them is where the Bridge's decided correspondences cross. Click any
            node to inspect it.
          </p>
        )}
      </aside>
    </div>
  )
}
