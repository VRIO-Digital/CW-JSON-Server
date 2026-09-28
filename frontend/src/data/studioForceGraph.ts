import type { DgbEntity, DgbRelation, SgbGraph, TypeLink } from '../api/client'
import type { ElementClass } from '../graph-viewer/types'
import { colorFor, DEFAULT_COLOR } from '../graph-viewer/lib/graph'
import { fromDgbGraph, fromSgbGraph } from './studioCanvas'

/**
 * Canvas 2 — **the two lanes as one settled body, and the physics that settles them.**
 *
 * The Canvas tab draws the lanes with the vendored `src/graph-viewer`, and the Globe frame arranges
 * the same nodes on an authored sphere. This module is the third thing a reader can ask of that one
 * graph: *let it settle*. Nothing here is a second answer to what the graph **holds** — the nodes
 * and the lane edges come from `fromSgbGraph` and `fromDgbGraph`, the same two derivations both
 * existing frames are built from — and what it adds is where a node **comes to rest**, which is a
 * fact about the drawing rather than about the data.
 *
 * **Pure, and in `src/data/` for the reason `studioGlobe` and `dataModelCanvas` are.** A physics
 * rule written inside a component can only be asserted by rendering the component, and
 * `renderToString` hands it an unsettled layout with no measured box — so a test written that way
 * passes over exactly the arrangement that matters.
 *
 * **Three things this module does that the flat canvas deliberately does not:**
 *
 * - **An entity type is a node.** The document lane draws instances, and the Bridge's claim is about
 *   *types* — so on the flat canvas a correspondence has to be fanned out to every instance of its
 *   type to have something to attach to, which draws an instance-level line for a claim the Bridge
 *   does not make. A grouping node gives the edge the endpoint the data actually names. It costs no
 *   backend work: `entityType` is already on every entity.
 * - **Its spokes are springs and never marks.** `HAS_INSTANCE` runs type → instance so a type gathers
 *   its own members, and is `layoutOnly`: painting one spoke per instance *on top of* that instance's
 *   own relation edges is what turns a settled graph into a honeycomb.
 * - **A Bridge edge is never traversable.** A Type Link is a semantic claim and is never a join, so
 *   it is styled by its verdict and is excluded from anything that would draw it as a live join —
 *   which would assert precisely what the Bridge declines to assert.
 */

/** Which lane produced a node. Derived from the derivation that made it, never stored on the row. */
export type Lane = 'structured' | 'documents'

export type NodeKind = 'table' | 'concept' | 'entity' | 'entity_type'

export interface ForceNode {
  id: string
  label: string
  lane: Lane
  kind: NodeKind
  /** The well this node is pulled toward — its type inside the document lane, its lane otherwise. */
  cluster: string
  /** The viewer's own type key, so a disc's colour is the one the other two frames give it. */
  type: string
  elementClass: ElementClass
  /** Degree over the painted edges. What sizes the disc, exactly as on the flat canvas. */
  degree: number
  members?: number
  detail?: string
  subtype?: string
  provenance?: string
}

export type EdgeKind = 'structured' | 'documents' | 'has_instance' | 'bridge'

export interface ForceEdge {
  id: string
  source: string
  target: string
  label: string
  kind: EdgeKind
  /** Bridge rows only — what the correspondence claims. Never a confidence, which is categorical. */
  verdict?: 'identity' | 'attribute'
  /** A spring that shapes the layout and is never painted. */
  layoutOnly: boolean
  /** The classes a relation was asserted under, where the payload states any. */
  classes?: string[]
}

export interface ForceGraph {
  nodes: ForceNode[]
  edges: ForceEdge[]
}

/* ------------------------------------------------------------------ *
 * The adapter
 * ------------------------------------------------------------------ */

/**
 * Which grouping node an entity belongs to.
 *
 * The extractor's own `entityType`, not the resolved one: it is the field every entity carries, so
 * grouping on it can never leave an entity unattached. A resolved type that differs is reached
 * through the index below rather than by minting a second group, because one entity under two
 * grouping nodes would be counted twice by every figure that reads the fan.
 */
const groupKeyOf = (entity: DgbEntity): string => entity.entityType

const GROUP_PREFIX = 'entity-type:'

/**
 * The lanes, with the document lane's types raised to nodes.
 *
 * Every node and every painted lane edge comes from the two shared derivations; what this function
 * adds is the grouping layer and the Bridge's type-level claim.
 */
export function forceGraphFromLanes(input: {
  structured: SgbGraph | null
  entities: DgbEntity[]
  relations: DgbRelation[]
  typeLinks: TypeLink[]
}): ForceGraph {
  const sgb = input.structured ? fromSgbGraph(input.structured) : { nodes: [], links: [] }
  const dgb = fromDgbGraph(input.entities, input.relations)

  const nodes: ForceNode[] = []
  const nodeById = new Map<string, ForceNode>()
  const push = (node: ForceNode) => {
    if (nodeById.has(node.id)) return
    nodeById.set(node.id, node)
    nodes.push(node)
  }

  for (const raw of sgb.nodes) {
    push({
      id: raw.id,
      label: raw.label,
      lane: 'structured',
      kind: raw.type === 'Concept' ? 'concept' : 'table',
      /* One well for the whole structured lane: tables and the concepts they realise are few and
         already related, so splitting them further would part a graph that reads better whole. */
      cluster: 'structured',
      type: raw.type,
      elementClass: raw.element_class,
      degree: 0,
      members: typeof raw.members === 'number' ? raw.members : undefined,
      detail: typeof raw.l2 === 'string' ? raw.l2 : undefined,
      subtype: raw.subtype,
      provenance: raw.provenance,
    })
  }

  const groupOfEntity = new Map<string, string>()
  for (const entity of input.entities) {
    groupOfEntity.set(entity.entityId, `${GROUP_PREFIX}${groupKeyOf(entity)}`)
  }

  for (const raw of dgb.nodes) {
    const group = groupOfEntity.get(raw.id)
    push({
      id: raw.id,
      label: raw.label,
      lane: 'documents',
      kind: 'entity',
      /* Each type is its own gravity well, so instances orbit their own hub rather than pooling into
         one cloud where nothing can be told from anything. */
      cluster: group ?? 'documents',
      type: raw.type,
      elementClass: raw.element_class,
      degree: 0,
      members: typeof raw.members === 'number' ? raw.members : undefined,
      detail: typeof raw.l2 === 'string' ? raw.l2 : undefined,
      subtype: raw.subtype,
      provenance: raw.provenance,
    })
  }

  /* The grouping nodes themselves, one per type the corpus really holds — counted off the entities
     rather than off a list, so a type with no members cannot appear and a member cannot be orphaned. */
  const membersOfGroup = new Map<string, number>()
  for (const entity of input.entities) {
    const key = `${GROUP_PREFIX}${groupKeyOf(entity)}`
    membersOfGroup.set(key, (membersOfGroup.get(key) ?? 0) + 1)
  }
  for (const [id, members] of membersOfGroup) {
    const name = id.slice(GROUP_PREFIX.length)
    push({
      id,
      label: name,
      lane: 'documents',
      kind: 'entity_type',
      cluster: id,
      type: name,
      /* A hub, so the viewer's own radius rule draws it as one. It is a type rather than a row, and
         that is exactly what `concept` means to `radiusFor`. */
      elementClass: 'concept',
      degree: 0,
      members,
      detail: `${members} extracted ${members === 1 ? 'entity' : 'entities'} of this type`,
      subtype: 'entity type',
    })
  }

  const edges: ForceEdge[] = []
  const seen = new Set<string>()
  const add = (edge: Omit<ForceEdge, 'id'>) => {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) return
    if (edge.source === edge.target) return
    const key = `${edge.kind}|${edge.source}|${edge.target}|${edge.label}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ ...edge, id: `${edge.kind}-${edges.length}` })
  }

  for (const link of sgb.links) {
    add({
      source: link.source,
      target: link.target,
      label: link.label ?? '',
      kind: 'structured',
      layoutOnly: false,
    })
  }

  const classesOf = new Map<string, string[]>()
  for (const relation of input.relations) {
    classesOf.set(`${relation.subjectEntityId}|${relation.objectEntityId}|${relation.relationType}`, relation.classes)
  }
  for (const link of dgb.links) {
    add({
      source: link.source,
      target: link.target,
      label: link.label ?? '',
      kind: 'documents',
      layoutOnly: false,
      classes: classesOf.get(`${link.source}|${link.target}|${link.label ?? ''}`),
    })
  }

  for (const [entityId, group] of groupOfEntity) {
    add({ source: group, target: entityId, label: 'HAS_INSTANCE', kind: 'has_instance', layoutOnly: true })
  }

  for (const bridge of bridgeTypeEdges(sgb.nodes, input.entities, input.typeLinks)) add(bridge)

  /* Degree over the *painted* edges only. A type hub carries one spoke per member, and counting
     those would size it by how many rows the corpus happens to hold rather than by how connected it
     is — a figure the reader cannot check against anything on the drawing. */
  const byId = new Map(nodes.map((node) => [node.id, node]))
  for (const edge of edges) {
    if (edge.layoutOnly) continue
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    if (source) source.degree += 1
    if (target) target.degree += 1
  }

  return { nodes, edges }
}

/**
 * The Bridge's claims, **at the level the Bridge makes them.**
 *
 * `bridgeLinks` in `studioCanvas` fans one Type Link out to every instance of its type, because the
 * flat canvas has no type node for the edge to land on. This frame has one, so the edge says exactly
 * what the row says — *this entity type corresponds with this concept* — and nothing about any
 * individual entity. That is a narrower claim than the fan, never a wider one.
 *
 * **Decided and non-reject only**, which is the rule both other frames keep: a reject asserts
 * nothing, so drawing one would put a line on the canvas for a correspondence somebody declined, and
 * an undecided row is a *proposal*, which is the one thing a reviewer must not mistake for a fact.
 * So a Bridge nobody has reviewed draws no seam, and the Bridge tab is where that is settled.
 */
export function bridgeTypeEdges(
  sgbNodes: Array<{ id: string; type: string; label: string }>,
  entities: DgbEntity[],
  typeLinks: TypeLink[],
): Array<Omit<ForceEdge, 'id'>> {
  const conceptByName = new Map(
    sgbNodes.filter((n) => n.type === 'Concept').map((n) => [n.label.toLowerCase(), n.id]),
  )

  /* A Type Link may name the extracted type or the resolved one, so both spellings are indexed onto
     the group each entity actually sits in. Assuming one of the two is how a whole lane's seam comes
     to be missing with nothing failing. */
  const groupsForTypeName = new Map<string, Set<string>>()
  const index = (name: string | null | undefined, group: string) => {
    if (!name) return
    const key = name.toLowerCase()
    const set = groupsForTypeName.get(key) ?? new Set<string>()
    set.add(group)
    groupsForTypeName.set(key, set)
  }
  for (const entity of entities) {
    const group = `${GROUP_PREFIX}${groupKeyOf(entity)}`
    index(entity.entityType, group)
    index(entity.resolvedType, group)
  }

  const out: Array<Omit<ForceEdge, 'id'>> = []
  for (const link of typeLinks) {
    if (link.decision === 'reject') continue
    if (link.decidedBy === 'llm') continue
    const conceptId = conceptByName.get(link.conceptName.toLowerCase())
    if (!conceptId) continue
    for (const group of groupsForTypeName.get(link.entityType.toLowerCase()) ?? []) {
      out.push({
        source: group,
        target: conceptId,
        label: link.decision === 'identity' ? 'IS_A' : 'ATTRIBUTE_OF',
        kind: 'bridge',
        verdict: link.decision === 'identity' ? 'identity' : 'attribute',
        layoutOnly: false,
      })
    }
  }
  return out
}

/**
 * `colorFor`, extended for a type it does not know — never in place of it.
 *
 * `colorFor`'s own palette is keyed to the structured lane's ontology plus the CAPEX types this app
 * already ships, in `PascalCase`; a document lane's own entity types are the EXTRACTOR's words —
 * `BUSINESS_UNIT`, `FINANCIAL_FIGURE` — which match nothing in that map, however real and however
 * distinct from each other they are. Every one of them fell through to `DEFAULT_COLOR` together,
 * which read as "every node is the same colour" over a graph whose types genuinely differ.
 *
 * A type `colorFor` DOES know is left exactly as it draws it — this repo asserts that palette
 * elsewhere, and two answers to what one type looks like is the fault this whole app refuses. Only a
 * type that lands on the shared grey default gets a second look: a stable hue from a hash of the
 * TYPE STRING itself, never the element id, so every node of one type still reads as one colour and
 * two different types still read as two.
 *
 * **One definition, two readers.** `ForceCanvas` paints a node with it; the type filter's own
 * options (below) draw a swatch with it, so a reader can match a colour on the sphere to a name in
 * the control rather than the two surfaces silently disagreeing about what a type looks like.
 */
const FALLBACK_HUES = [
  '#c2540d',
  '#0e7c86',
  '#7a3ec2',
  '#1f8a3d',
  '#b8860b',
  '#c23d6b',
  '#2f6fb0',
  '#8a5a1f',
  '#3d8a5a',
  '#a23fa2',
] as const

export const typeColor = (type: string): string => {
  const known = colorFor(type)
  if (known !== DEFAULT_COLOR) return known
  let h = 0
  for (let i = 0; i < type.length; i += 1) h = (h * 31 + type.charCodeAt(i)) >>> 0
  return FALLBACK_HUES[h % FALLBACK_HUES.length]
}

/* ------------------------------------------------------------------ *
 * Filters
 * ------------------------------------------------------------------ */

export interface ForceFilters {
  /** Concept ids. Empty means every concept. */
  concepts: string[]
  /** Relation classes. Empty means every class. */
  classes: string[]
  /** Node types — the same string `typeColor` paints a node with. Empty means every type. */
  types: string[]
}

export const EMPTY_FILTERS: ForceFilters = { concepts: [], classes: [], types: [] }

/**
 * The options each control offers, **counted off the graph rather than declared.**
 *
 * There is no concept *taxonomy* in this payload — a concept carries a ref, a name, a description
 * and whether the brief declared it, and nothing that groups it — so the options *are* the concepts,
 * keyed by id rather than by name, since two concepts may share a display name across story groups.
 */
export function filterOptions(graph: ForceGraph): {
  concepts: Array<{ value: string; label: string }>
  classes: Array<{ value: string; label: string }>
  types: Array<{ value: string; label: string; color: string }>
} {
  const concepts = graph.nodes
    .filter((node) => node.kind === 'concept')
    .map((node) => ({ value: node.id, label: node.label }))
    .sort((a, b) => a.label.localeCompare(b.label))

  const counts = new Map<string, number>()
  for (const edge of graph.edges) {
    for (const name of edge.classes ?? []) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const classes = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, n]) => ({ value: name, label: `${name} · ${n}` }))

  /* Counted over what a node actually IS, excluding the entity-type hub itself — a hub carries its
     members' own type string, and counting it alongside them would count one type's population as
     one more than the corpus actually holds. Each option carries the exact colour `ForceCanvas`
     paints that type with, so the control and the drawing cannot come to disagree about what a type
     looks like — the same rule `typeColor` states for its two readers. */
  const typeCounts = new Map<string, number>()
  for (const node of graph.nodes) {
    if (node.kind === 'entity_type') continue
    typeCounts.set(node.type, (typeCounts.get(node.type) ?? 0) + 1)
  }
  const types = [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, n]) => ({ value: type, label: `${type} · ${n}`, color: typeColor(type) }))

  return { concepts, classes, types }
}

/**
 * Narrowing **removes rows; it does not dim them.**
 *
 * Dimming is a reasonable read on a flat sheet and a poor one here: a ghost still takes a seat the
 * physics has to settle and the projection has to measure around, so a sphere of ghosts is harder to
 * read than the unfiltered graph. Filtering at the data level means the layout, the measured spread
 * and the camera fit all adapt to what is left.
 *
 * **Class rides the edge, not the node** — an entity is global and a class is asserted on the
 * relation — so the class filter keeps the relations carrying a selected class and the entities at
 * their endpoints, which is the only thing "filter by class" can honestly mean here.
 */
export function filterForceGraph(graph: ForceGraph, filters: ForceFilters): ForceGraph {
  const narrowConcepts = filters.concepts.length > 0
  const narrowClasses = filters.classes.length > 0
  const narrowTypes = filters.types.length > 0
  if (!narrowConcepts && !narrowClasses && !narrowTypes) return graph

  const wanted = new Set<string>()
  const classSet = new Set(filters.classes)
  const typeSet = new Set(filters.types)

  if (narrowConcepts) {
    for (const id of filters.concepts) wanted.add(id)
    /* A concept's own neighbourhood: the tables that realise it and the entity types the Bridge
       corresponds it with. A lone concept disc is a filter that answers nothing. */
    for (const edge of graph.edges) {
      if (edge.layoutOnly) continue
      if (filters.concepts.includes(edge.source)) wanted.add(edge.target)
      if (filters.concepts.includes(edge.target)) wanted.add(edge.source)
    }
  }

  if (narrowClasses) {
    for (const edge of graph.edges) {
      if (!(edge.classes ?? []).some((name) => classSet.has(name))) continue
      wanted.add(edge.source)
      wanted.add(edge.target)
    }
  }

  /* A node's own type, never expanded to its neighbourhood — unlike Concepts, a type is a property
     of the node itself rather than a relation, so "filter by type" means exactly the nodes that ARE
     one of the selected types. Its entity-type hub survives anyway, through the `groupOf` pass below
     rather than a second rule here: the hub carries the same type string its members do, so it is
     already one of `wanted` by this same test. */
  if (narrowTypes) {
    for (const node of graph.nodes) {
      if (typeSet.has(node.type)) wanted.add(node.id)
    }
  }

  /* An entity that survived brings its type hub with it, or the fan it belongs to loses the node
     that names it and the lane reads as a scatter. */
  const groupOf = new Map(
    graph.edges
      .filter((edge) => edge.kind === 'has_instance')
      .map((edge) => [edge.target, edge.source]),
  )
  for (const id of [...wanted]) {
    const group = groupOf.get(id)
    if (group) wanted.add(group)
  }

  const nodes = graph.nodes.filter((node) => wanted.has(node.id))
  const kept = new Set(nodes.map((node) => node.id))
  const edges = graph.edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target))
  return { nodes, edges }
}

/* ------------------------------------------------------------------ *
 * The simulation
 * ------------------------------------------------------------------ */

export interface Body {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  /** Dragged by the reader this frame — the physics leaves it exactly where the pointer put it. */
  drag: boolean
  /** Left where it was dropped. */
  pinned: boolean
}

export interface World {
  w: number
  h: number
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/** The world grows with the population rather than being fixed, so a seven-node lane is not laid out
 *  across a field sized for eight hundred. */
export const worldFor = (count: number): World => {
  const side = Math.min(4200, Math.max(900, Math.round(Math.sqrt(Math.max(1, count)) * 130)))
  return { w: side, h: Math.round(side * 0.72) }
}

/**
 * Where a lane is anchored.
 *
 * **This replaces a single centring well, which is what collapsed every earlier attempt at a shared
 * simulation.** One gravity point pulls both clouds onto the same place however unlinked they are,
 * and all-pairs repulsion is capped and falls off as 1/d², so the two lanes interleave rather than
 * part. A fixed horizontal anchor per lane is what keeps them two halves of one drawing.
 */
export const laneAnchor = (lane: Lane, world: World): { x: number; y: number } => ({
  x: lane === 'structured' ? world.w * 0.25 : world.w * 0.75,
  y: world.h * 0.5,
})

/**
 * Where a cluster is anchored — a ring of wells about its lane's own anchor.
 *
 * Stepped by the golden angle for the reason the globe's meridians are: any rational fraction of a
 * turn puts every *k*-th well on one line, and a row of hubs in a line reads as a layout rule rather
 * than as a graph.
 */
export const clusterAnchor = (
  lane: Lane,
  index: number,
  total: number,
  world: World,
): { x: number; y: number } => {
  const centre = laneAnchor(lane, world)
  if (total <= 1) return centre
  const ring = Math.min(world.w, world.h) * 0.22
  const angle = index * GOLDEN_ANGLE
  return { x: centre.x + Math.cos(angle) * ring, y: centre.y + Math.sin(angle) * ring }
}

/**
 * The seed layout — **deterministic, and that is load-bearing rather than tidy.**
 *
 * There is no `Math.random` anywhere in this module, so the same element set always lands the same
 * way. That is what makes *Reset* honest: it re-seeds rather than re-settling, and a re-settle would
 * produce a **new** layout, moving nodes the reader never touched. A golden-angle sunflower about
 * each cluster's own anchor is the spread that neither bands nor clumps.
 */
export function seedBodies(nodes: ForceNode[], world: World): Body[] {
  const clusters = [...new Set(nodes.map((node) => node.cluster))]
  const anchorOf = new Map<string, { x: number; y: number }>()
  const perLane = new Map<Lane, number>()
  for (const cluster of clusters) {
    const lane = nodes.find((node) => node.cluster === cluster)?.lane ?? 'documents'
    const index = perLane.get(lane) ?? 0
    perLane.set(lane, index + 1)
    anchorOf.set(cluster, { x: index, y: 0 })
  }
  const laneTotals = new Map<Lane, number>()
  for (const lane of ['structured', 'documents'] as Lane[]) {
    laneTotals.set(lane, perLane.get(lane) ?? 0)
  }

  const seen = new Map<string, number>()
  return nodes.map((node) => {
    const slot = anchorOf.get(node.cluster) ?? { x: 0, y: 0 }
    const anchor = clusterAnchor(node.lane, slot.x, laneTotals.get(node.lane) ?? 1, world)
    const i = seen.get(node.cluster) ?? 0
    seen.set(node.cluster, i + 1)
    const radius = Math.sqrt(i + 0.5) * 26
    const angle = i * GOLDEN_ANGLE
    return {
      id: node.id,
      x: anchor.x + Math.cos(angle) * radius,
      y: anchor.y + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      drag: false,
      pinned: false,
    }
  })
}

export interface StepInput {
  bodies: Body[]
  edges: ForceEdge[]
  nodes: ForceNode[]
  world: World
}

/** Tuning. Named rather than inline so the one place a force is weighed is the one place it is read. */
const REPULSION = 2400
const REPULSION_CAP = 140
const SPRING = 0.016
const SPRING_LENGTH = 74
const HUB_SPRING_LENGTH = 52
const GRAVITY = 0.0032
const DAMPING = 0.86
const MAX_SPEED = 14
/** Only pairs inside this radius repel. What turns an unqualified O(n²) sweep into a local one. */
const NEIGHBOURHOOD = 190

/**
 * One relaxation pass.
 *
 * **Repulsion is bucketed rather than all-pairs**, which is the one place this departs from the
 * design it is ported from and does so deliberately: an unqualified O(n²) sweep over eight hundred
 * entities is 360,000 pairs a tick, so the warmup budget buys a large lane about eight passes and
 * what settles is very nearly the seed. The force is capped and falls off as 1/d² anyway, so a pair
 * further apart than `NEIGHBOURHOOD` contributes a rounding error — bucketing drops exactly the
 * pairs that were already contributing nothing, and the layout it produces is the same one.
 *
 * **The spring applies equal and opposite displacement, which is the whole of Hooke's law and is the
 * bug worth knowing about.** Applying the same *signed* vector to both endpoints leaves the relative
 * displacement along the edge at exactly zero: such a force can translate a pair bodily and can
 * never shorten or lengthen the edge between them, so a simulation written that way has no
 * attraction in it at all and every bit of its structure comes from the seed.
 *
 * **Accumulation is normalised by `1/sqrt(degree)`.** A type hub can carry hundreds of spokes, and
 * un-normalised it receives hundreds of pulls in one tick and flings itself across the world.
 */
export function stepSimulation({ bodies, edges, nodes, world }: StepInput): void {
  const byId = new Map(bodies.map((body) => [body.id, body]))
  const laneOf = new Map(nodes.map((node) => [node.id, node.lane]))
  const clusterOf = new Map(nodes.map((node) => [node.id, node.cluster]))

  const degree = new Map<string, number>()
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
  }

  /* One bucket grid per pass. Rebuilding it is O(n) and saves the sweep from being O(n²), so it pays
     for itself at every size this draws at. */
  const cell = NEIGHBOURHOOD
  const buckets = new Map<string, Body[]>()
  const keyOf = (body: Body) => `${Math.floor(body.x / cell)},${Math.floor(body.y / cell)}`
  for (const body of bodies) {
    const key = keyOf(body)
    const list = buckets.get(key) ?? []
    list.push(body)
    buckets.set(key, list)
  }

  for (const body of bodies) {
    if (body.drag) continue
    const cx = Math.floor(body.x / cell)
    const cy = Math.floor(body.y / cell)
    for (let gx = cx - 1; gx <= cx + 1; gx += 1) {
      for (let gy = cy - 1; gy <= cy + 1; gy += 1) {
        for (const other of buckets.get(`${gx},${gy}`) ?? []) {
          if (other === body) continue
          let dx = body.x - other.x
          let dy = body.y - other.y
          let d2 = dx * dx + dy * dy
          if (d2 > NEIGHBOURHOOD * NEIGHBOURHOOD) continue
          if (d2 < 0.01) {
            /* Coincident bodies have no direction to part along, so they are given one from their
               ids rather than from a random number — the determinism the seed depends on. */
            dx = ((body.id.charCodeAt(0) % 7) - 3) * 0.1 + 0.05
            dy = ((body.id.charCodeAt(1) % 7) - 3) * 0.1 + 0.05
            d2 = dx * dx + dy * dy
          }
          const force = Math.min(REPULSION_CAP, REPULSION / d2)
          const d = Math.sqrt(d2)
          body.vx += (dx / d) * force * 0.02
          body.vy += (dy / d) * force * 0.02
        }
      }
    }
  }

  for (const edge of edges) {
    const a = byId.get(edge.source)
    const b = byId.get(edge.target)
    if (!a || !b) continue
    const dx = b.x - a.x
    const dy = b.y - a.y
    const d = Math.hypot(dx, dy) || 0.001
    const rest = edge.kind === 'has_instance' ? HUB_SPRING_LENGTH : SPRING_LENGTH
    const pull = (d - rest) * SPRING
    const ux = (dx / d) * pull
    const uy = (dy / d) * pull
    const na = 1 / Math.sqrt(Math.max(1, degree.get(edge.source) ?? 1))
    const nb = 1 / Math.sqrt(Math.max(1, degree.get(edge.target) ?? 1))
    if (!a.drag && !a.pinned) {
      a.vx += ux * na
      a.vy += uy * na
    }
    if (!b.drag && !b.pinned) {
      b.vx -= ux * nb
      b.vy -= uy * nb
    }
  }

  const clusters = [...new Set(nodes.map((node) => node.cluster))]
  const laneIndex = new Map<string, number>()
  const laneCount = new Map<Lane, number>()
  for (const cluster of clusters) {
    const lane = nodes.find((node) => node.cluster === cluster)?.lane ?? 'documents'
    const index = laneCount.get(lane) ?? 0
    laneCount.set(lane, index + 1)
    laneIndex.set(cluster, index)
  }

  for (const body of bodies) {
    if (body.drag || body.pinned) continue
    const lane = laneOf.get(body.id) ?? 'documents'
    const cluster = clusterOf.get(body.id) ?? lane
    const anchor = clusterAnchor(lane, laneIndex.get(cluster) ?? 0, laneCount.get(lane) ?? 1, world)
    body.vx += (anchor.x - body.x) * GRAVITY
    body.vy += (anchor.y - body.y) * GRAVITY

    body.vx *= DAMPING
    body.vy *= DAMPING
    const speed = Math.hypot(body.vx, body.vy)
    if (speed > MAX_SPEED) {
      body.vx = (body.vx / speed) * MAX_SPEED
      body.vy = (body.vy / speed) * MAX_SPEED
    }
    body.x += body.vx
    body.y += body.vy
  }
}

/** How many passes to run before the first paint. Budgeted against the work a pass really does, now
 *  that a pass is local rather than all-pairs: every size this draws at gets a settled layout. */
export const warmupPasses = (count: number): number =>
  count <= 40 ? 260 : count <= 200 ? 200 : count <= 800 ? 140 : 90

/* ------------------------------------------------------------------ *
 * The globe projection
 * ------------------------------------------------------------------ */

export interface Spread {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/**
 * The layout's **measured** bounding box, not the nominal world.
 *
 * The world is sized from the node count while the settled layout occupies only as much of it as the
 * wells allow — two lanes clumped about their anchors leave most of it empty. Projecting the nominal
 * rect therefore maps the clumps onto a matching fraction of the sphere and leaves the rest bare,
 * which reads as a broken globe rather than as a sparse one. Normalising the measured box stretches
 * whatever spread exists across the whole surface.
 */
export function measureSpread(bodies: Body[]): Spread {
  if (bodies.length === 0) return { minX: -1, maxX: 1, minY: -1, maxY: 1 }
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const body of bodies) {
    if (body.x < minX) minX = body.x
    if (body.x > maxX) maxX = body.x
    if (body.y < minY) minY = body.y
    if (body.y > maxY) maxY = body.y
  }
  /* A single node, or a perfectly flat row, has no extent to normalise against; a unit box keeps the
     division defined and puts it at the centre, which is where one node belongs. */
  if (maxX - minX < 1) {
    minX -= 1
    maxX += 1
  }
  if (maxY - minY < 1) {
    minY -= 1
    maxY += 1
  }
  return { minX, maxX, minY, maxY }
}

/**
 * How much of the sphere this population is spread over.
 *
 * Normalising to the measured box means the extreme nodes *always* land at the ends of whatever span
 * is used. At a full span that is longitude ±180°, which is the **back** of the sphere — so filtering
 * down to two concepts would put both extremes behind the ball, one dimmed to the depth floor and
 * the other hidden by it. Latitude fails the same way, with the ends at a pole where `cos(lat)` is 0
 * and everything collapses onto the axis.
 *
 * So a handful of nodes gets a shallow cap facing the reader and a full graph gets the whole sphere,
 * and the crossover is gradual, because a filter that snapped between two different-looking layouts
 * would read as a different drawing rather than as a narrower one.
 */
export const fillFor = (count: number): number => Math.min(1, Math.max(0.25, count / 60))

export interface Camera {
  /** Radians, added to every longitude. The revolve buttons move this and nothing else. */
  rotation: number
  radius: number
  cx: number
  cy: number
}

export interface Projected {
  x: number
  y: number
  /** `+1` facing the reader, `−1` behind. What decides how much of a mark survives. */
  depth: number
  /** Perspective foreshortening, applied to the disc and its label. */
  scale: number
}

/** The camera distance, in radii. Small enough that the near side reads as nearer, large enough that
 *  the sphere does not fish-eye. */
const FOCAL = 2.6

/**
 * A settled position, as a point of the sphere.
 *
 * **Latitude is equal-area — `sin(lat) = v`, never `lat = v · 90°`.** A linear mapping is
 * equirectangular: it crushes the nodes at the poles and spreads them at the equator, so an evenly
 * settled layout arrives visibly bunched. Taking the arcsine is what "uniform on a sphere" means.
 *
 * **The simulation stays flat.** Depth is presentation, applied here and nowhere else, so drag,
 * hover, pan, zoom and picking all keep working against the painted position — which is what a
 * projected point *is* once this has run.
 */
export function projectGlobe(
  body: { x: number; y: number },
  spread: Spread,
  fill: number,
  camera: Camera,
): Projected {
  const halfW = (spread.maxX - spread.minX) / 2
  const halfH = (spread.maxY - spread.minY) / 2
  const u = (body.x - (spread.minX + halfW)) / halfW
  const v = (body.y - (spread.minY + halfH)) / halfH

  const lonHalf = Math.PI * fill
  const latScale = 0.45 + 0.55 * fill
  const lon = u * lonHalf + camera.rotation
  const lat = Math.asin(Math.min(1, Math.max(-1, v * latScale)))

  const x3 = Math.cos(lat) * Math.sin(lon)
  const y3 = Math.sin(lat)
  const z3 = Math.cos(lat) * Math.cos(lon)

  const depth = 1 - z3
  const scale = FOCAL / (FOCAL + depth)
  return {
    x: camera.cx + camera.radius * x3 * scale,
    y: camera.cy - camera.radius * y3 * scale,
    depth: z3,
    scale,
  }
}

/**
 * How much of a mark survives its depth.
 *
 * Continuous rather than a front/back switch, and it never reaches zero: nothing opaque is drawn, so
 * a far-side node is dimmer and smaller and stays clickable — and a mark that vanished the instant
 * it crossed the rim would make revolving read as things being deleted rather than as a thing going
 * round the back, which is what is happening.
 */
export const depthOpacity = (depth: number): number =>
  0.12 + 0.88 * Math.min(1, Math.max(0, (depth + 0.45) / 1.1))

/** One press of a revolve button. Fifteen of them is a full turn, so every press moves the drawing by
 *  a readable amount and none of it teleports. */
export const ROTATION_STEP = (24 * Math.PI) / 180

/**
 * How many labels the drawing carries at once, **and it is stated on the drawing.**
 *
 * A canvas of 843 entities cannot print 843 names, and a silent truncation is the failure this repo
 * refuses everywhere — so the cap is a constant, the hint line says what it is, and the acts that
 * reveal the rest are the ones this frame is about: revolve, filter, or click the node.
 */
export const LABELS_SHOWN = 26

/** Ids worth a label: facing the reader, biggest first, capped. Anything the reader has asked for by
 *  name — a selection, its neighbours — is labelled whatever its depth. */
export function labelledIds(
  rows: Array<{ id: string; depth: number; radius: number }>,
  keep: Set<string> = new Set(),
): Set<string> {
  const chosen = new Set(keep)
  const facing = rows
    .filter((row) => row.depth > 0.15 && !chosen.has(row.id))
    .sort((a, b) => b.radius - a.radius || b.depth - a.depth)
  for (const row of facing) {
    if (chosen.size >= LABELS_SHOWN) break
    chosen.add(row.id)
  }
  return chosen
}

/* ------------------------------------------------------------------ *
 * Selection
 * ------------------------------------------------------------------ */

export interface Trace {
  nodes: Set<string>
  edges: Set<string>
}

/**
 * What a selection lights: the node, its painted relationships, and the nodes at their far ends.
 *
 * **Layout-only spokes are excluded**, so selecting an entity does not light every sibling of its
 * type through a spring that is not on the drawing — a trace has to be readable against the marks
 * the reader can actually see.
 *
 * An empty trace for no selection rather than a null, because every caller asks it the same question
 * — *is this one lit* — and a null would make each of them answer it twice.
 */
export function traceFor(graph: ForceGraph, selectedId: string | null): Trace {
  const nodes = new Set<string>()
  const edges = new Set<string>()
  if (!selectedId) return { nodes, edges }
  nodes.add(selectedId)
  for (const edge of graph.edges) {
    if (edge.layoutOnly) continue
    if (edge.source !== selectedId && edge.target !== selectedId) continue
    edges.add(edge.id)
    nodes.add(edge.source)
    nodes.add(edge.target)
  }
  return { nodes, edges }
}

/**
 * The identity of a laid-out set, used to decide whether cached positions may be reused.
 *
 * **The reset counter is folded in, and that is the subtlest thing here.** Positions are reused
 * whenever this string is unchanged — so clearing the filters fires a rebuild that carries every
 * dragged position straight over, and a Reset that only moved the camera would snap the view back
 * while the graph underneath did not move. Folding the counter in invalidates the cache and forces a
 * full re-seed, which is safe as a route back to the original layout precisely because the seed is
 * deterministic: the same element set always lands the same way. Re-seeding unpins everything as a
 * side effect of building fresh bodies.
 */
export const partitionKey = (graph: ForceGraph, resets: number): string =>
  `${resets}|${graph.nodes.length}|${graph.edges.length}|${graph.nodes[0]?.id ?? ''}|${
    graph.nodes[graph.nodes.length - 1]?.id ?? ''
  }`
