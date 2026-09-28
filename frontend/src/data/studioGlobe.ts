import type { DgbEntity, DgbRelation, SgbGraph, TypeLink } from '../api/client'
import type { RawLink, RawNode } from '../graph-viewer/types'
import { bridgeLinks, fromDgbGraph, fromSgbGraph } from './studioCanvas'

/**
 * The two lanes as **two hemispheres of one sphere**, and the geometry that revolves it.
 *
 * The structured lane is the northern half, the document lane the southern, and the Bridge is the
 * stitching across the rim between them — so the drawing says what the studio says: two graphs, one
 * use case, joined by the correspondences a person has decided. A flat canvas can only put the two
 * lanes side by side and hope the reader reads the seam; a closed sphere *is* the seam.
 *
 * **Everything here is on the unit sphere, and the radius is applied at projection time.** That is
 * what makes the answer to "and at a smaller radius?" uninteresting: the layout is scale-free, so
 * shrinking the drawing shrinks a sphere rather than degenerating into two arcs that no longer
 * close. `project` is the only function that has ever heard of a pixel.
 *
 * **Pure, and in `src/data/` for the reason `dataModelCanvas` is.** A layout rule written inside a
 * component can only be asserted by rendering the component, and `renderToString` gives it its
 * *initial* state — no measured box, rotation still at zero — so a test written that way would pass
 * over exactly the arrangement that matters. Nothing below reads a `db`, a request or the DOM.
 *
 * **It invents no membership.** The nodes and the lane edges come from `fromSgbGraph` and
 * `fromDgbGraph`, and the seam comes from `bridgeLinks` — the same three functions the flat frames
 * are built from, so the globe and the combined canvas cannot come to hold different graphs. What
 * this file adds is where each node *sits*, which is a fact about the drawing rather than about the
 * data.
 */

/** Which half of the sphere a node lives on. Derived from the lane that produced it, never stored. */
export type Hemisphere = 'structured' | 'documents'

export interface GlobeNode {
  id: string
  label: string
  type: string
  hemisphere: Hemisphere
  /** Degree over the combined edge list — what sizes the disc, exactly as on the flat canvas. */
  degree: number
  elementClass: RawNode['element_class']
  /** Radians. `+π/2` is the structured pole, `−π/2` the document pole, `0` the rim. */
  lat: number
  /** Radians, `0 … 2π`. Rotation is added to this at projection time and never written back. */
  lon: number
  /** Whether the Bridge names this node, which is what pulls it into the rim band. */
  bridged: boolean
  /** The node's own detail line — a table's columns, an entity's aliases. Read, never composed. */
  detail?: string
  provenance?: string
  subtype?: string
}

export interface GlobeEdge {
  id: string
  source: string
  target: string
  label: string
  /** `bridge` is the seam; the other two are a lane's own edges. */
  kind: Hemisphere | 'bridge'
}

export interface GlobeGraph {
  nodes: GlobeNode[]
  edges: GlobeEdge[]
}

/**
 * The tilt, in radians — the one thing about the view that is fixed rather than steered.
 *
 * Without it the rim projects to a straight horizontal line and the drawing reads as two stacked
 * fans rather than as a ball. Tipping the structured pole toward the reader turns the rim into an
 * ellipse, which is the whole of what makes a circle read as a sphere.
 *
 * **It is small because it costs the far pole.** Revolving turns the sphere about its polar axis, so
 * a node's best possible depth is `cos(lat − TILT)` however far it is revolved — which means every
 * degree of tilt buries a degree of the *southern* cap permanently. A node that no press can bring
 * round would be a node this frame cannot show at all, which is the one thing the revolve is
 * promising against, so the tilt and `POLE_CAP` below are chosen together and checked together.
 */
export const TILT = 0.26

/** One press of a revolve button. Twelve of them is a full turn, which is what makes it a revolve
 *  rather than a jump: every press moves the drawing by a readable amount and none of it teleports. */
export const ROTATION_STEP = Math.PI / 6

/** The floor on the drawn radius. Below this the labels collide with the rim and the sphere stops
 *  being readable — it still *closes*, because the layout is scale-free, but it says nothing. */
export const MIN_RADIUS = 80

const TAU = Math.PI * 2
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const DEG = Math.PI / 180

/** The rim band nodes never enter, so the join is a seam rather than a row of overlapping discs. */
const RIM_GAP = 7 * DEG
/**
 * The pole cap — how near the axis a node may be placed.
 *
 * Two reasons, and the second is the one that set the number. A node *on* the axis has no longitude
 * to revolve through, so it would sit still while everything around it moved. And under the tilt
 * above, the far cap can never be revolved to the front at all: at `POLE_CAP = 60°` the worst-placed
 * document node still reaches a depth of `cos(60° + TILT) ≈ 0.26`, which is comfortably in front of
 * the ball at some point in every turn.
 *
 * **It costs almost nothing, because the bands are distributed by area.** `sin 60°` is 0.87, so
 * capping at 60° leaves 87% of each hemisphere's surface in use — the excluded caps are the part
 * where an evenly-spread layout puts fewest nodes anyway.
 */
const POLE_CAP = 60 * DEG
/**
 * How far a concept's bridged entities fan either side of its meridian.
 *
 * **It grows with the fan rather than being fixed**, and that was a finding rather than a design: at
 * a fixed 24° a shipped graph — twelve concepts and eight hundred entities between them — put a
 * fifth of the whole sphere's nodes into one twelfth of the turn, which is a wall rather than a
 * hemisphere. The per-node step is what keeps a two-entity concept's stitch short while letting a
 * seventy-entity one open out into the fan it actually is; the maximum is what stops that fan
 * wrapping so far round that the stitch stops reading as a join.
 */
const SEAM_SPREAD_PER_NODE = 2.2 * DEG
const SEAM_SPREAD_MAX = 75 * DEG

/**
 * A latitude band, distributed by **equal area rather than equal angle**.
 *
 * Stepping the angle evenly crowds the poles: `sin` is what converts a band of latitude into the
 * surface it actually covers, so the rows near the rim get the room their circumference deserves and
 * the cap gets the little it deserves. Without it a fifty-node hemisphere draws forty of them in a
 * knot at the top.
 */
const band = (i: number, n: number, lo: number, hi: number): number =>
  Math.asin(Math.sin(lo) + ((i + 0.5) / Math.max(1, n)) * (Math.sin(hi) - Math.sin(lo)))

/**
 * Where the bridged band ends and the plain one begins, **by share of the hemisphere's population**.
 *
 * A fixed boundary is wrong in both directions and both are visible: with nothing bridged it leaves
 * a bald ring around the rim, and with everything bridged it packs the whole lane into a third of
 * its own half. Splitting by area share means the two bands are always exactly as wide as they have
 * nodes to fill, and a hemisphere with no bridged node simply uses all of it.
 */
const splitLat = (bridged: number, plain: number): number => {
  const total = bridged + plain
  if (total === 0) return POLE_CAP
  const lo = Math.sin(RIM_GAP)
  const hi = Math.sin(POLE_CAP)
  return Math.asin(lo + (bridged / total) * (hi - lo))
}

/** Circular mean, so two partners at 350° and 10° average to 0° rather than to 180°. */
const meanLon = (lons: number[]): number => {
  let x = 0
  let y = 0
  for (const lon of lons) {
    x += Math.cos(lon)
    y += Math.sin(lon)
  }
  if (x === 0 && y === 0) return 0
  return (Math.atan2(y, x) + TAU) % TAU
}

/**
 * Place every node on the unit sphere.
 *
 * Four rules, and each one is a thing the reader is owed:
 *
 * - **A lane is a hemisphere.** The sign of the latitude is the lane, so a node's half is readable
 *   from where it sits rather than from a colour somebody has to learn.
 * - **A bridged node sits near the rim.** The seam is the point of this drawing, and a
 *   correspondence whose two ends are at opposite poles is an edge straight through the middle of
 *   the ball, which reads as noise rather than as a join.
 * - **A bridged entity sits under the concept it corresponds with**, at the same meridian, so the
 *   seam edge is a short stitch across the rim instead of a chord across the equator. Where one
 *   concept holds many entities they fan either side of it, within a stated spread.
 * - **Longitudes are stepped by the golden angle**, which is the one step that never repeats a
 *   meridian — any rational fraction of a turn puts every *k*-th node on one line, and a line of
 *   nodes that all disappear together on the same press is the revolve looking broken.
 *
 * Returns new nodes; the input is not touched.
 */
export function layoutGlobe(nodes: GlobeNode[], edges: GlobeEdge[]): GlobeNode[] {
  const bridgedIds = new Set<string>()
  for (const edge of edges) {
    if (edge.kind !== 'bridge') continue
    bridgedIds.add(edge.source)
    bridgedIds.add(edge.target)
  }

  const placed = nodes.map((node) => ({ ...node, bridged: bridgedIds.has(node.id) }))
  const byId = new Map(placed.map((node) => [node.id, node]))

  const north = placed.filter((n) => n.hemisphere === 'structured')
  const south = placed.filter((n) => n.hemisphere === 'documents')

  /* The structured half first and whole, because the document half's bridged nodes are placed
     *relative to it* — a partner with no longitude yet cannot be followed. */
  const northBridged = north.filter((n) => n.bridged)
  const northPlain = north.filter((n) => !n.bridged)
  const northSplit = splitLat(northBridged.length, northPlain.length)

  northBridged.forEach((node, i) => {
    node.lat = band(i, northBridged.length, RIM_GAP, northSplit)
    node.lon = (i * GOLDEN_ANGLE) % TAU
  })
  northPlain.forEach((node, i) => {
    node.lat = band(i, northPlain.length, northSplit, POLE_CAP)
    /* A phase offset so the plain band does not land on the bridged band's meridians: two nodes at
       one longitude one latitude apart read as a single blurred mark at the sizes this draws at. */
    node.lon = (0.61 + i * GOLDEN_ANGLE) % TAU
  })

  const partnersOf = new Map<string, string[]>()
  for (const edge of edges) {
    if (edge.kind !== 'bridge') continue
    const push = (from: string, to: string) => {
      const list = partnersOf.get(from) ?? []
      list.push(to)
      partnersOf.set(from, list)
    }
    push(edge.source, edge.target)
    push(edge.target, edge.source)
  }

  const southBridged = south.filter((n) => n.bridged)
  const southPlain = south.filter((n) => !n.bridged)
  const southSplit = splitLat(southBridged.length, southPlain.length)

  /* Grouped by the meridian they are being drawn to, so a concept's entities fan around it in one
     block rather than being scattered by whatever order the payload listed them in. */
  const anchorOf = (node: GlobeNode): number | null => {
    const lons = (partnersOf.get(node.id) ?? [])
      .map((id) => byId.get(id))
      .filter((partner): partner is GlobeNode => partner?.hemisphere === 'structured')
      .map((partner) => partner.lon)
    return lons.length > 0 ? meanLon(lons) : null
  }

  const groups = new Map<string, GlobeNode[]>()
  for (const node of southBridged) {
    const anchor = anchorOf(node)
    const key = anchor === null ? 'unanchored' : anchor.toFixed(4)
    const list = groups.get(key) ?? []
    list.push(node)
    groups.set(key, list)
  }

  let index = 0
  for (const [key, members] of groups) {
    const anchor = key === 'unanchored' ? null : Number(key)
    members.forEach((node, i) => {
      node.lat = -band(index, southBridged.length, RIM_GAP, southSplit)
      if (anchor === null) {
        node.lon = (1.27 + index * GOLDEN_ANGLE) % TAU
      } else {
        /* Centred on the partner: one entity sits directly under its concept, and a group of them
           spreads symmetrically either side rather than trailing off in one direction. */
        const spread = Math.min(SEAM_SPREAD_MAX, SEAM_SPREAD_PER_NODE * (members.length - 1))
        const offset = members.length === 1 ? 0 : (i / (members.length - 1) - 0.5) * 2 * spread
        node.lon = (anchor + offset + TAU) % TAU
      }
      index += 1
    })
  }

  southPlain.forEach((node, i) => {
    node.lat = -band(i, southPlain.length, southSplit, POLE_CAP)
    node.lon = (2.14 + i * GOLDEN_ANGLE) % TAU
  })

  return placed
}

/** The camera: how far the sphere has been revolved, how big it is drawn, and where its centre is. */
export interface GlobeView {
  /** Radians added to every longitude. The two buttons move this and nothing else. */
  rotation: number
  radius: number
  cx: number
  cy: number
}

export interface Projected {
  x: number
  y: number
  /** `+1` facing the reader, `−1` on the far side. What decides whether a node is visible at all. */
  depth: number
}

/**
 * A point of the unit sphere, revolved and tilted — the whole of the 3D in this file.
 *
 * Rotation is about the polar axis, which is why revolving reveals everything: every node has a
 * longitude, so twelve presses bring each of them round to the front. The tilt is applied after, so
 * it stays fixed while the sphere turns underneath it.
 */
export const unitPoint = (
  lat: number,
  lon: number,
  rotation: number,
): [number, number, number] => {
  const lambda = lon + rotation
  const x = Math.cos(lat) * Math.sin(lambda)
  const y = Math.sin(lat)
  const z = Math.cos(lat) * Math.cos(lambda)
  return [x, y * Math.cos(TILT) - z * Math.sin(TILT), y * Math.sin(TILT) + z * Math.cos(TILT)]
}

export const project = (
  point: { lat: number; lon: number },
  view: GlobeView,
): Projected => {
  const [x, y, z] = unitPoint(point.lat, point.lon, view.rotation)
  return { x: view.cx + view.radius * x, y: view.cy - view.radius * y, depth: z }
}

/**
 * How much of a mark survives its depth.
 *
 * Continuous rather than a front/back switch: a node that vanished the instant it crossed the rim
 * would make the revolve read as things being deleted, where a fade reads as a thing going round the
 * back — which is what is happening. It never reaches 0, because a reader dragging a sphere is
 * entitled to see that there is something there to bring round.
 */
export const depthOpacity = (depth: number): number => {
  const t = Math.min(1, Math.max(0, (depth + 0.4) / 0.9))
  return 0.1 + 0.9 * t
}

/** A little perspective on the disc, so the front of the sphere reads as the near side. */
export const depthScale = (depth: number): number => 0.82 + 0.26 * ((depth + 1) / 2)

/**
 * An edge as an arc **over the surface**, never a chord through the middle.
 *
 * A straight line between two points of a sphere passes inside it, so on a canvas it crosses
 * whatever is in the way and says the two nodes are closer than they are. The control point is the
 * normalised midpoint of the two directions, lifted just clear of the surface — which for a seam
 * edge is what makes it visibly hoop over the rim.
 *
 * `depth` is the *midpoint's*, so an edge whose ends straddle the rim is drawn as half-visible
 * rather than as fully present or fully gone.
 */
export const arcPath = (
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  view: GlobeView,
): { d: string; depth: number } => {
  const p1 = project(a, view)
  const p2 = project(b, view)
  const ua = unitPoint(a.lat, a.lon, view.rotation)
  const ub = unitPoint(b.lat, b.lon, view.rotation)
  const mx = ua[0] + ub[0]
  const my = ua[1] + ub[1]
  const mz = ua[2] + ub[2]
  const len = Math.hypot(mx, my, mz)
  /* Antipodal ends have no midpoint direction — every great circle through them is as good as the
     next — so there is nothing to bulge toward and a straight segment is the honest answer. */
  if (len < 1e-6) {
    return { d: `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`, depth: (p1.depth + p2.depth) / 2 }
  }
  const lift = 1.05 / len
  const midX = view.cx + view.radius * mx * lift
  const midY = view.cy - view.radius * my * lift
  /* The control point of a quadratic is not on the curve: the curve passes through the average of
     the control and the two ends, so the control has to be thrown twice as far to put the arc where
     the surface is. */
  const cxp = 2 * midX - (p1.x + p2.x) / 2
  const cyp = 2 * midY - (p1.y + p2.y) / 2
  return {
    d: `M ${p1.x} ${p1.y} Q ${cxp} ${cyp} ${p2.x} ${p2.y}`,
    depth: (mz * lift) / 1.05,
  }
}

/** The rim, which is the equator, which is where the two lanes meet. Axis-aligned under this tilt,
 *  so it needs no arc maths — but it is two halves, because the near one is in front of everything
 *  the far one is behind. */
export const rimPath = (view: GlobeView, half: 'near' | 'far'): string => {
  const ry = view.radius * Math.sin(TILT)
  const sweep = half === 'near' ? 0 : 1
  return `M ${view.cx - view.radius} ${view.cy} A ${view.radius} ${ry} 0 0 ${sweep} ${
    view.cx + view.radius
  } ${view.cy}`
}

const GRATICULE_MERIDIANS = 12
const GRATICULE_PARALLELS = [-60, -30, 30, 60].map((d) => d * DEG)

/**
 * The wireframe — meridians and parallels, front faces only.
 *
 * It is the only thing on the drawing that makes a *revolve* legible when the nodes are sparse: a
 * dozen discs sliding sideways is a pan, and the same discs sliding across a turning grid is a
 * rotation. Dropping the back faces is what gives the surface a front at all; the alternative is a
 * wire ball, where every line has a twin and nothing reads as near.
 */
export const graticulePaths = (view: GlobeView): string[] => {
  const out: string[] = []

  const trace = (points: Array<[number, number]>) => {
    let run: string[] = []
    const flush = () => {
      if (run.length > 1) out.push(`M ${run.join(' L ')}`)
      run = []
    }
    for (const [lat, lon] of points) {
      const p = project({ lat, lon }, view)
      if (p.depth <= 0) flush()
      else run.push(`${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    }
    flush()
  }

  for (let m = 0; m < GRATICULE_MERIDIANS; m += 1) {
    const lon = (m * TAU) / GRATICULE_MERIDIANS
    const points: Array<[number, number]> = []
    for (let i = 0; i <= 40; i += 1) {
      points.push([-Math.PI / 2 + (i / 40) * Math.PI, lon])
    }
    trace(points)
  }

  for (const lat of GRATICULE_PARALLELS) {
    const points: Array<[number, number]> = []
    for (let i = 0; i <= 72; i += 1) {
      points.push([lat, (i / 72) * TAU])
    }
    trace(points)
  }

  return out
}

/**
 * How many labels the sphere carries at once, **and it is stated on the drawing.**
 *
 * A canvas of 843 entities cannot print 843 names, and this repo refuses a silent truncation
 * everywhere — so the cap is a constant, the hint line says what it is, and the act that reveals the
 * rest is the one the whole frame is about: revolve, or click the node.
 */
export const LABELS_SHOWN = 22

/** Ids worth a label: facing the reader, biggest first, capped. A node the reader has selected is
 *  labelled whatever its depth, because they asked for that one by name. */
export const labelledIds = (
  rows: Array<{ id: string; depth: number; radius: number }>,
  keep: Set<string> = new Set(),
): Set<string> => {
  const chosen = new Set(keep)
  const facing = rows
    .filter((row) => row.depth > 0.25 && !chosen.has(row.id))
    .sort((a, b) => b.radius - a.radius || b.depth - a.depth)
  for (const row of facing) {
    if (chosen.size >= LABELS_SHOWN) break
    chosen.add(row.id)
  }
  return chosen
}

/**
 * The combined graph as a sphere.
 *
 * Built from the *same three derivations* the flat frames use, so what the globe holds and what the
 * combined canvas holds is one answer; only the arrangement is this file's.
 */
export function globeFromLanes(input: {
  structured: SgbGraph | null
  entities: DgbEntity[]
  relations: DgbRelation[]
  typeLinks: TypeLink[]
}): GlobeGraph {
  const sgb = input.structured ? fromSgbGraph(input.structured) : { nodes: [], links: [] }
  const dgb = fromDgbGraph(input.entities, input.relations)
  const bridge = bridgeLinks(sgb.nodes, input.entities, input.typeLinks)

  const toNode = (node: RawNode, hemisphere: Hemisphere): GlobeNode => ({
    id: node.id,
    label: node.label,
    type: node.type,
    hemisphere,
    degree: 0,
    elementClass: node.element_class,
    lat: 0,
    lon: 0,
    bridged: false,
    detail: typeof node.l2 === 'string' ? node.l2 : undefined,
    provenance: node.provenance,
    subtype: node.subtype,
  })

  const nodes = [
    ...sgb.nodes.map((n) => toNode(n, 'structured')),
    ...dgb.nodes.map((n) => toNode(n, 'documents')),
  ]
  const known = new Map(nodes.map((n) => [n.id, n]))

  const edges: GlobeEdge[] = []
  const seen = new Set<string>()
  const add = (link: RawLink, kind: GlobeEdge['kind']) => {
    const source = known.get(link.source)
    const target = known.get(link.target)
    if (!source || !target || source === target) return
    /* A concept bridged to one entity type yields one edge per entity, and the same pair can arrive
       twice when a Type Link names both the extracted and the resolved type. Two identical arcs are
       one arc drawn twice — and on a sphere the second is invisible, so the only thing it does is
       count. */
    const key = `${kind}|${link.source}|${link.target}|${link.label ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    source.degree += 1
    target.degree += 1
    edges.push({
      id: `${kind}-${edges.length}`,
      source: link.source,
      target: link.target,
      label: link.label ?? '',
      kind,
    })
  }

  for (const link of sgb.links) add(link, 'structured')
  for (const link of dgb.links) add(link, 'documents')
  for (const link of bridge) add(link, 'bridge')

  return { nodes: layoutGlobe(nodes, edges), edges }
}
