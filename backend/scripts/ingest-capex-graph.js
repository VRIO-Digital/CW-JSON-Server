/**
 * Ingest CAPEX's built graph from the platform's own export — `npm run ingest:capex-graph`.
 *
 * **The lanes are read, not derived.** `docs/samples/capex_usecase_graph.json` is what the real
 * services produced for this tenant's CAPEX use case: `StructuredGraphBuilderService.get_graph`,
 * `app.dgb.public.get_graph_version_snapshot` and `BridgeBuildService.list_type_links_page`, read
 * through and exported together. So the canvas draws the nodes and edges that build actually
 * produced — 5 tables, 91 columns, 12 concepts and 253 edges on the structured lane; 843 entities
 * and 925 relations on the document lane; 156 Type Links between them — rather than the shapes
 * `studioLanes.js` derives from `projects` and `document_extractions`.
 *
 * **The derivation is not replaced, it is out-ranked** — the arrangement `tableDictionary` has with
 * `synthesiseColumns` and `mailDocuments` has with its synthesiser. A dataset that ships a real
 * graph ships it; one that does not still derives a coherent lane from what it holds. EPA keeps
 * every figure it had.
 *
 * **This script selects, checks and reshapes. It computes no node, no edge and no count.** Every
 * figure the Build tab and the canvas show comes out of that file, because they are measurements of
 * a real run and inventing one is the small version of a transcribed report figure. What it *does*
 * add is the two fields the export has no reason to carry and this server's own readers need:
 * `kind: 'resolved'` on an entity (the export lists extracted entities and its documents
 * separately, so every row in `entities` is one) and an explicit `confidence: null` on a relation
 * (the export states none, and the client's schema is nullable — writing it out says so rather
 * than leaving a reader of the document to wonder).
 *
 * **And it strips the Bridge's attributions, keeping its verdicts.** The export records a review
 * that happened somewhere else; a decision made in another system is not one this reader made, so
 * every Type Link arrives as the deriver's proposal and the whole 156 reach the review queue. See
 * the block that builds `proposals` for why that is the export's own model rather than a shape
 * invented here.
 *
 * **It refuses to write rather than landing a graph that draws wrong.** Six checks, and each one
 * guards something that fails *quietly* on the canvas: an edge whose endpoint is not a node is
 * skipped while drawing, which is the silent-dropped-edge bug `validateDb` already refuses for
 * `graph_studio.canvas`; a relation between entities the snapshot does not hold is the same fault
 * one lane over; a Type Link naming a concept or an entity type neither lane has draws a Bridge
 * line from nowhere; and a count that disagrees with its own rows is a strip reporting a graph
 * nobody can see.
 *
 * Writes a file and only a file, like every other seed here. Push it with
 * `npm run db:push -- CAPEX`.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { DATASETS } from '../datasets.js'

const TARGET = 'CAPEX'

const die = (message) => {
  console.error(`\ningest-capex-graph: ${message}\n`)
  process.exit(1)
}

const requested = (process.argv[2] ?? TARGET).trim()
if (requested !== TARGET) {
  die(
    `this ingest writes ${TARGET}'s graph and nothing else — "${requested}" was asked for.\n` +
      '  A built graph is one tenant\'s lanes; another dataset needs its own export.',
  )
}
if (!DATASETS.includes(TARGET)) {
  die(`"${TARGET}" is not a declared dataset — this tenant has ${DATASETS.join(', ')}.`)
}

const name = `db.${TARGET}.json`
const path = new URL(`../${name}`, import.meta.url)
const exportPath = new URL('../../docs/samples/capex_usecase_graph.json', import.meta.url)

let doc
try {
  doc = JSON.parse(await readFile(path, 'utf8'))
} catch (error) {
  die(`could not read backend/${name} — ${error.message}`)
}

let graph
try {
  graph = JSON.parse(await readFile(exportPath, 'utf8'))
} catch (error) {
  die(
    `could not read docs/samples/capex_usecase_graph.json — ${error.message}\n` +
      '  That file is the export this dataset\'s graph is read from; without it there is nothing to ingest.',
  )
}

/* ---------------- what the export must be ---------------- */

const structured = graph.structured_graph
const documents = graph.document_graph
const bridge = graph.bridge

if (!structured || !documents || !bridge) {
  die(
    'the export is missing a lane — it must carry structured_graph, document_graph and bridge.\n' +
      `  It has: ${Object.keys(graph).join(', ')}`,
  )
}

const list = (value, what) => {
  if (!Array.isArray(value)) die(`the export's ${what} is not a list`)
  if (value.length === 0) die(`the export's ${what} is empty — there would be nothing to draw`)
  return value
}

const tables = list(structured.tables, 'structured_graph.tables')
const columns = list(structured.columns, 'structured_graph.columns')
const concepts = list(structured.concepts, 'structured_graph.concepts')
const edges = list(structured.edges, 'structured_graph.edges')
const entities = list(documents.entities, 'document_graph.entities')
const relations = list(documents.relations, 'document_graph.relations')
const entityTypes = list(documents.entity_types, 'document_graph.entity_types')
const typeLinks = list(bridge.type_links, 'bridge.type_links')
const classes = Array.isArray(documents.classes) ? documents.classes : []
const corpus = Array.isArray(documents.documents) ? documents.documents : []

if (!structured.story_group?.story_group_id) {
  die("the export's structured_graph carries no story_group — its COVERS edges would name nothing")
}

/*
 * **Every edge resolves inside this export's own rosters.**
 *
 * A canvas edge whose endpoint is not a node is *skipped while drawing* rather than raised — which
 * is exactly how 20 EPA edges once made 17 facilities look as though they had no enforcement. The
 * story group counts as a node here because `COVERS` edges start at it.
 */
const nodeRefs = new Set([
  ...tables.map((t) => t.table_ref),
  ...columns.map((c) => c.column_ref),
  ...concepts.map((c) => c.concept_ref),
  /* Both spellings, because the export writes the story group's own ref with its `story_group:`
     prefix on a COVERS edge and bare on the group itself. Accepting one of the two would refuse a
     perfectly good export over a prefix. */
  structured.story_group.story_group_id,
  `story_group:${structured.story_group.story_group_id}`,
])
const dangling = edges.filter((e) => !nodeRefs.has(e.src_ref) || !nodeRefs.has(e.dst_ref))
if (dangling.length > 0) {
  die(
    `${dangling.length} structured edge(s) name a ref this export has no node for, and an edge ` +
      'with an unresolved end is dropped while drawing rather than reported.\n' +
      dangling
        .slice(0, 5)
        .map((e) => `  · ${e.edge_type}  ${e.src_ref} → ${e.dst_ref}`)
        .join('\n'),
  )
}

/* The same rule one lane over: a relation between entities the snapshot does not hold draws nothing
   and says nothing about why. */
const entityIds = new Set(entities.map((e) => e.entity_id))
const orphanRelations = relations.filter(
  (r) => !entityIds.has(r.subject_entity_id) || !entityIds.has(r.object_entity_id),
)
if (orphanRelations.length > 0) {
  die(
    `${orphanRelations.length} relation(s) name an entity this snapshot does not hold.\n` +
      orphanRelations
        .slice(0, 5)
        .map((r) => `  · ${r.relation_type}  ${r.subject_entity_id} → ${r.object_entity_id}`)
        .join('\n'),
  )
}

/*
 * **A Type Link is a claim about two things both lanes must have.** The export says so itself —
 * *"after pruning links whose concept_ref or entity_type is absent from the two lanes it actually
 * drew"* — so a link that survived the pruning and still names something missing is an export that
 * disagrees with itself, and the Bridge would draw a line from a concept nobody can click.
 */
const conceptRefs = new Set(concepts.map((c) => c.concept_ref))
const typeSet = new Set(entityTypes)
const unresolvedLinks = typeLinks.filter(
  (t) => !conceptRefs.has(t.concept_ref) || !typeSet.has(t.entity_type),
)
if (unresolvedLinks.length > 0) {
  die(
    `${unresolvedLinks.length} Type Link(s) name a concept or an entity type neither lane has.\n` +
      unresolvedLinks
        .slice(0, 5)
        .map((t) => `  · ${t.entity_type} ⇔ ${t.concept_ref}`)
        .join('\n'),
  )
}

/* A verdict this app has no branch for renders as a row with no styling and no meaning. */
const DECISIONS = new Set(['identity', 'attribute', 'reject'])
const DECIDERS = new Set(['llm', 'human'])
for (const link of typeLinks) {
  if (!DECISIONS.has(link.decision)) {
    die(
      `Type Link ${link.type_link_id} has decision "${link.decision}", which is not one of ` +
        `${[...DECISIONS].join(' / ')}.`,
    )
  }
  if (!DECIDERS.has(link.decided_by)) {
    die(
      `Type Link ${link.type_link_id} says it was decided by "${link.decided_by}", which is not ` +
        `${[...DECIDERS].join(' or ')} — the review gate reads that field.`,
    )
  }
}

/*
 * **The verdicts are carried; the attributions are not.**
 *
 * The export records a review that happened **somewhere else** — 98 of its 156 rows carry a person's
 * name and a timestamp, and all 98 of them agreed with the deriver. A decision recorded in another
 * system is not a decision made here: this server keys a decision `bridgeBuildId:type_link_id` in
 * its own memory, and the reviewer sitting in front of this Bridge has decided nothing. Shipping
 * the attributions would open the tab with *Needs review (0)* and an unblocked Publish, crediting
 * this reader with judgements they never made.
 *
 * So each row arrives as the deriver's **proposal**: the verdict it reached, `decided_by: 'llm'`,
 * and nothing in the decided/original fields — `original_*` records what the deriver said *before a
 * person overrode it*, and on an undecided row there is no override to record. Accepting one writes
 * all of that, which is what *Accept all* is for.
 *
 * The export's own `decided_by` already draws this distinction: its 58 `llm` rows carry
 * `original_decision: null` and no timestamp, which is exactly the shape written here — so this is
 * the export's own model applied to every row rather than a shape invented for it.
 */
const proposals = typeLinks.map((link) => ({
  ...link,
  decided_by: 'llm',
  original_decision: null,
  original_confidence: null,
  original_reason: null,
  decided_by_user_id: null,
  decided_at: null,
}))

/*
 * **The counts are of the rows this server will serve**, not of the export's, because a strip
 * reporting a graph nobody can see is the figure this repo refuses everywhere. `needs_review` is
 * computed by *this app's* own rule rather than trusted: the gate that blocks publishing reads it,
 * and a stored count disagreeing with it is a tab saying one thing and the publish route another.
 */
const counted = {
  identity: proposals.filter((t) => t.decision === 'identity').length,
  attribute: proposals.filter((t) => t.decision === 'attribute').length,
  reject: proposals.filter((t) => t.decision === 'reject').length,
  low: proposals.filter((t) => t.confidence === 'low').length,
  all: proposals.length,
  needs_review: proposals.filter((t) => t.decided_by === 'llm').length,
}
if (counted.needs_review !== counted.all) {
  die(
    `${counted.all - counted.needs_review} row(s) arrived already decided, and every row is meant to ` +
      'reach the reviewer as a proposal.\n  A Bridge that opens partly decided credits this reader ' +
      'with judgements somebody else made.',
  )
}
/* The verdicts themselves are still the export's, so a drifted tally is still a refusal. */
for (const key of ['identity', 'attribute', 'reject', 'low']) {
  const theirs = bridge.counts?.[key]
  if (typeof theirs === 'number' && theirs !== counted[key]) {
    die(
      `the export's bridge.counts.${key} says ${theirs} and its own rows say ${counted[key]}.\n` +
        '  One of the two is stale, and a count that disagrees with its rows is a strip reporting a ' +
        'graph nobody can see.',
    )
  }
}
const total = bridge.total ?? bridge.counts?.all
if (typeof total === 'number' && total !== counted.all) {
  die(`the export says it holds ${total} Type Link(s) and carries ${counted.all}.`)
}

/* ---------------- what gets written ---------------- */

doc.studio_graph = {
  /*
   * Where it came from and when, carried rather than left to be remembered: a graph in a document
   * with no provenance is a graph nobody can date, and this one is a snapshot of a real build.
   */
  _source: {
    file: 'docs/samples/capex_usecase_graph.json',
    generated_at: graph.export?.generated_at ?? null,
    from: graph.export?.source ?? null,
    use_case_config_id: graph.use_case?.use_case_config_id ?? null,
    graph_version_id: graph.graph_version?.graph_version_id ?? null,
    sgb_build_id: structured.build_id ?? null,
    dgb_graph_version: documents.graph_version ?? null,
    bridge_build_id: bridge.bridge_build_id ?? null,
  },
  structured: {
    tables,
    columns,
    concepts,
    edges,
    story_group: {
      story_group_id: structured.story_group.story_group_id,
      story: structured.story_group.story,
      grain: structured.story_group.grain ?? {},
      uncertainties: structured.story_group.uncertainties ?? [],
      /* False, and not the export's own flag: what that flag records is whether somebody edited the
         story *in this server*, which nobody has. The studio sets it when they do. */
      edited_by_user: false,
    },
  },
  documents: {
    entity_types: entityTypes,
    classes,
    documents: corpus,
    /* `kind` is this server's, because the export has no reason to carry it: it lists extracted
       entities and its documents in two places, so every row here is a resolved one. The Bridge's
       own grid counts on that field. */
    entities: entities.map((e) => ({ ...e, kind: 'resolved' })),
    /* Stated rather than left absent: the export records no per-relation confidence, the client's
       schema is nullable, and writing the null says which of the two it is. */
    relations: relations.map((r) => ({ confidence: null, ...r })),
  },
  bridge: {
    bridge_build_id: bridge.bridge_build_id ?? null,
    type_links: proposals,
    counts: counted,
  },
}

await writeFile(path, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')

const edgeKinds = edges.reduce((acc, e) => {
  acc[e.edge_type] = (acc[e.edge_type] ?? 0) + 1
  return acc
}, {})

console.log(
  `ingest-capex-graph: wrote ${TARGET}'s built graph to backend/${name}, read from ` +
    `docs/samples/capex_usecase_graph.json (generated ${graph.export?.generated_at ?? 'unknown'}).`,
)
console.log(
  `    structured  ${tables.length} table(s) · ${columns.length} column(s) · ` +
    `${concepts.length} concept(s) · ${edges.length} edge(s)`,
)
console.log(
  `                ${Object.entries(edgeKinds)
    .map(([k, n]) => `${k} ${n}`)
    .join(' · ')}`,
)
console.log(
  `    documents   ${corpus.length} document(s) · ${entities.length} entities across ` +
    `${entityTypes.length} type(s) · ${relations.length} relation(s) · ${classes.length} class(es)`,
)
console.log(
  `    bridge      ${proposals.length} Type Link(s) — ${counted.identity} identity · ` +
    `${counted.attribute} attribute · ${counted.reject} reject`,
)
console.log(
  `                all ${counted.needs_review} arrive as the deriver's proposal, so the reviewer ` +
    'decides every one (Accept all sweeps them)',
)
console.log(`  Push it when you are happy with the diff:  npm run db:push -- ${TARGET}`)
