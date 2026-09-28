import {
  EMPTY_FILTERS,
  fillFor,
  filterForceGraph,
  filterOptions,
  forceGraphFromLanes,
  measureSpread,
  partitionKey,
  projectGlobe,
  seedBodies,
  stepSimulation,
  traceFor,
  warmupPasses,
  worldFor,
} from './src/data/studioForceGraph'
import type { DgbEntity, DgbRelation, SgbGraph, TypeLink } from './src/api/client'

/**
 * `npm run verify:studio-force` — **Canvas 2's physics and projection, replayed with nothing
 * running.**
 *
 * `src/data/studioForceGraph.ts` is pure — no `db`, no request, no DOM — which is what makes this
 * possible at all, exactly as `reportExport.js` and `studioLanes.js` are. It matters more here than
 * for most pure modules, because **every fault this file guards is silent**:
 *
 * - A spring applying the same *signed* vector to both endpoints leaves the relative displacement
 *   along the edge at exactly zero — so the simulation has no attraction in it whatsoever and every
 *   bit of its structure comes from the seed. It type-checks, it renders, and what it produces is a
 *   layout that merely looks loose. Nothing but measuring edge length before and after settling
 *   catches it.
 * - An equirectangular latitude (`lat = v · 90°` rather than `sin(lat) = v`) draws a perfectly
 *   plausible sphere with its nodes bunched at the poles.
 * - A Bridge edge fanned to instances rather than landing on the type node asserts something the
 *   Bridge does not claim, and looks like a richer drawing.
 *
 * The fixture is authored here rather than read from a document, and that is deliberate: this checks
 * the *rules*, and a fixture that has to hold one decided identity row, one decided attribute row,
 * one reject and one undecided row is one no real document is obliged to keep providing. What a real
 * document is held to is `verify:studio-lanes`, which replays the derivations this module builds on.
 */

let failed = 0
const ok = (name: string, condition: boolean, detail = '') => {
  console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!condition) failed += 1
}

const structured = {
  buildId: 'b1',
  tables: [
    { tableRef: 't.a', tableName: 'contracts', sourceId: 's1', schemaName: 'plan', comment: 'one contract', rowCountEstimate: 120 },
    { tableRef: 't.b', tableName: 'projects', sourceId: 's1', schemaName: 'plan', comment: 'one project', rowCountEstimate: 60 },
  ],
  columns: [
    { columnRef: 'c.1', tableRef: 't.a', columnName: 'contract_no' },
    { columnRef: 'c.2', tableRef: 't.a', columnName: 'vendor' },
    { columnRef: 'c.3', tableRef: 't.b', columnName: 'project_code' },
  ],
  concepts: [
    { conceptRef: 'k.contract', name: 'Contract', description: 'an agreement', declared: true },
    { conceptRef: 'k.project', name: 'Project', description: 'a delivery', declared: false },
  ],
  edges: [
    { srcRef: 'c.1', dstRef: 'k.contract', edgeType: 'REALISES' },
    { srcRef: 'c.2', dstRef: 'k.contract', edgeType: 'DESCRIBES' },
    { srcRef: 'c.3', dstRef: 'k.project', edgeType: 'REALISES' },
    { srcRef: 'c.1', dstRef: 'c.3', edgeType: 'FK_TO' },
  ],
} as unknown as SgbGraph

const entities: DgbEntity[] = []
for (let i = 0; i < 12; i += 1) {
  entities.push({
    entityId: `e${i}`,
    canonicalName: `Entity ${i}`,
    entityType: i < 5 ? 'Vendor' : i < 9 ? 'Contract' : 'ChangeOrder',
    aliases: [],
    mentionCount: 1 + (i % 4),
    /* The first five carry a resolved type that differs from the extracted one, which is the case a
       Type Link may name either way round. */
    resolvedType: i < 5 ? 'Supplier' : null,
  })
}

const relations: DgbRelation[] = []
for (let i = 0; i < 11; i += 1) {
  relations.push({
    relationId: `r${i}`,
    subjectEntityId: `e${i}`,
    objectEntityId: `e${i + 1}`,
    relationType: 'AWARDED_TO',
    chunkId: `ch${i}`,
    documentId: `d${i}`,
    classes: i % 2 === 0 ? ['commercial'] : ['schedule'],
    confidence: 0.8,
  })
}

const typeLinks = [
  { typeLinkId: 'tl1', entityType: 'Contract', conceptRef: 'k.contract', conceptName: 'Contract', decision: 'identity', decidedBy: 'human' },
  { typeLinkId: 'tl2', entityType: 'Supplier', conceptRef: 'k.contract', conceptName: 'Contract', decision: 'attribute', decidedBy: 'human' },
  { typeLinkId: 'tl3', entityType: 'ChangeOrder', conceptRef: 'k.project', conceptName: 'Project', decision: 'reject', decidedBy: 'human' },
  { typeLinkId: 'tl4', entityType: 'ChangeOrder', conceptRef: 'k.contract', conceptName: 'Contract', decision: 'identity', decidedBy: 'llm' },
] as unknown as TypeLink[]

const graph = forceGraphFromLanes({ structured, entities, relations, typeLinks })

console.log('\nthe adapter')
const typeNodes = graph.nodes.filter((n) => n.kind === 'entity_type')
ok('an entity type is a node, one per type the corpus holds', typeNodes.length === 3, typeNodes.map((n) => n.label).join(', '))
ok(
  'every entity is attached to exactly one type hub',
  graph.edges.filter((e) => e.kind === 'has_instance').length === entities.length,
)
ok(
  'the hub spokes are springs and never marks',
  graph.edges.filter((e) => e.kind === 'has_instance').every((e) => e.layoutOnly),
)
ok(
  'no node and no edge comes from anywhere but the shared derivations',
  graph.nodes.filter((n) => n.kind !== 'entity_type').length === 4 + entities.length,
  'two tables, two concepts, twelve entities',
)

console.log('\nthe Bridge, at the level the Bridge claims it')
const bridge = graph.edges.filter((e) => e.kind === 'bridge')
ok(
  'a Bridge edge lands on a type node, never on an instance',
  bridge.length > 0 && bridge.every((e) => e.source.startsWith('entity-type:')),
  bridge.map((e) => `${e.source} -> ${e.target}`).join(' · '),
)
ok(
  'the resolved-type spelling reaches the same hub the extracted one does',
  bridge.some((e) => e.source === 'entity-type:Vendor'),
  'tl2 names Supplier, which is Vendor’s resolved type',
)
ok('a reject is never drawn', !bridge.some((e) => e.target === 'k.project'))
ok('an undecided row is never drawn', bridge.length === 2, `${bridge.length} decided, non-reject`)
ok(
  'every Bridge edge states its verdict, so nothing draws it as a join',
  bridge.every((e) => e.verdict === 'identity' || e.verdict === 'attribute'),
)
ok(
  'a hub is not sized by how many rows it happens to hold',
  typeNodes.every((n) => n.degree <= 2),
  typeNodes.map((n) => `${n.label}:${n.degree}`).join(' '),
)

console.log('\nthe simulation')
const world = worldFor(graph.nodes.length)
const bodies = seedBodies(graph.nodes, world)
const byId = new Map(bodies.map((b) => [b.id, b]))
const linked = graph.edges.filter((e) => !e.layoutOnly)
const meanEdgeLength = () => {
  let total = 0
  for (const e of linked) {
    const a = byId.get(e.source)
    const b = byId.get(e.target)
    if (!a || !b) continue
    total += Math.hypot(a.x - b.x, a.y - b.y)
  }
  return total / linked.length
}
const before = meanEdgeLength()
for (let i = 0; i < warmupPasses(graph.nodes.length); i += 1) {
  stepSimulation({ bodies, edges: graph.edges, nodes: graph.nodes, world })
}
const after = meanEdgeLength()
ok(
  'the spring really attracts — a signed vector applied to both ends would move this not at all',
  after < before * 0.95,
  `mean edge ${before.toFixed(1)} -> ${after.toFixed(1)}`,
)
ok('nothing flew off: every body is finite', bodies.every((b) => Number.isFinite(b.x) && Number.isFinite(b.y)))

const laneOf = new Map(graph.nodes.map((n) => [n.id, n.lane]))
const meanX = (lane: string) => {
  const xs = bodies.filter((b) => laneOf.get(b.id) === lane).map((b) => b.x)
  return xs.reduce((a, c) => a + c, 0) / xs.length
}
ok(
  'the lanes settle apart rather than collapsing onto one point',
  meanX('structured') < meanX('documents'),
  `structured x=${meanX('structured').toFixed(0)} · documents x=${meanX('documents').toFixed(0)}`,
)

const seedA = seedBodies(graph.nodes, world)
const seedB = seedBodies(graph.nodes, world)
ok(
  'the seed is deterministic, which is what makes Reset a route back to the original layout',
  seedA.every((b, i) => b.x === seedB[i].x && b.y === seedB[i].y),
)
ok(
  'and Reset changes the layout identity, so cached positions cannot be carried over it',
  partitionKey(graph, 0) !== partitionKey(graph, 1),
)

console.log('\nthe projection')
const spread = measureSpread(bodies)
const fill = fillFor(bodies.length)
const camera = { rotation: 0, radius: 240, cx: 400, cy: 300 }
const points = bodies.map((b) => projectGlobe(b, spread, fill, camera))
ok('every projected point is finite', points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))
ok(
  'every point is on or inside the drawn sphere',
  points.every((p) => Math.hypot(p.x - camera.cx, p.y - camera.cy) <= camera.radius + 0.5),
)
ok('a handful of nodes gets a cap facing the reader; a full graph gets the whole sphere', fillFor(4) === 0.25 && fillFor(600) === 1)
/* Equal-area: `sin(lat) = v`, so an evenly spread column projects to an uneven ladder of screen y.
   An equirectangular mapping gives an even one, which is the silent failure this pins. */
const column = Array.from({ length: 9 }, (_, i) => ({ x: 0, y: -1 + i * 0.25 }))
const ys = column.map((b) => projectGlobe(b, { minX: -1, maxX: 1, minY: -1, maxY: 1 }, 1, camera).y)
const gaps = ys.slice(1).map((y, i) => Math.abs(y - ys[i]))
ok(
  'latitude is equal-area rather than equirectangular',
  Math.max(...gaps) - Math.min(...gaps) > 1,
  `gap spread ${(Math.max(...gaps) - Math.min(...gaps)).toFixed(1)}px across an even column`,
)
ok(
  'revolving changes what faces the reader',
  projectGlobe(bodies[0], spread, fill, camera).depth !==
    projectGlobe(bodies[0], spread, fill, { ...camera, rotation: 1.2 }).depth,
)
ok(
  'the spread is measured, so a layout in a corner still covers the sphere',
  measureSpread([
    { id: 'a', x: 10, y: 10, vx: 0, vy: 0, drag: false, pinned: false },
    { id: 'b', x: 20, y: 30, vx: 0, vy: 0, drag: false, pinned: false },
  ]).maxX === 20,
)

console.log('\nfilters, and the trace')
const options = filterOptions(graph)
ok('the options are the concepts themselves, keyed by id', options.concepts.length === 2)
ok('the class options are counted off the relations', options.classes.length === 2, options.classes.map((o) => o.label).join(' · '))
ok('no filter is a no-op rather than a copy', filterForceGraph(graph, EMPTY_FILTERS) === graph)
const narrowed = filterForceGraph(graph, { concepts: ['k.project'], classes: [] })
ok(
  'narrowing removes rows rather than dimming them',
  narrowed.nodes.length < graph.nodes.length && narrowed.nodes.some((n) => n.id === 'k.project'),
  `${graph.nodes.length} -> ${narrowed.nodes.length} nodes`,
)
ok(
  'every surviving edge has both endpoints on the drawing',
  narrowed.edges.every(
    (e) => narrowed.nodes.some((n) => n.id === e.source) && narrowed.nodes.some((n) => n.id === e.target),
  ),
)
const byClass = filterForceGraph(graph, { concepts: [], classes: ['commercial'] })
ok(
  'a class filter keeps the relations carrying it and the entities at their ends',
  byClass.nodes.length > 0 && byClass.nodes.length < graph.nodes.length,
  `${byClass.nodes.length} nodes`,
)
ok(
  'an entity that survives brings the type hub that names it',
  byClass.nodes.filter((n) => n.kind === 'entity').every((n) => byClass.nodes.some((h) => h.id === n.cluster)),
)
const trace = traceFor(graph, 'entity-type:Contract')
ok(
  'a trace lights painted edges only, never the layout springs',
  trace.edges.size > 0 &&
    [...trace.edges].every((id) => graph.edges.find((e) => e.id === id)?.layoutOnly === false),
)
ok('no selection is an empty trace rather than a null', traceFor(graph, null).nodes.size === 0)

const total = 30
console.log(
  `\nverify:studio-force — ${total} checks, ${failed} failed${failed === 0 ? '' : ' — see above'}`,
)
if (failed > 0) process.exit(1)
