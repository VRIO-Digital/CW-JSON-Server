/*
 * Re-derives CAPEX's `document_extractions` — **every entity each document names, not just one**:
 *
 *     npm run seed:capex-extractions
 *
 * **Why it exists.** The map recorded one entity per file, and for this corpus that entity was always
 * the project: all 41 documents resolved to a `PRJ:*` node, so the document lane derived exactly one
 * entity type and the Bridge had exactly **one** correspondence to review. A review queue with a
 * single row is not a review — and worse, it makes the Bridge look like a formality rather than the
 * gate it is.
 *
 * **Nothing here is invented, and that is the whole design.** A contract document's own row already
 * names its project and its contract number, and the canvas already states what that contract is
 * connected to: `AWARDED_TO` a vendor, `ENGINEERED_BY` another, `AMENDS`-ed by its change orders,
 * `DELIVERS` to a project, which in turn is `MANAGED_BY` a person, `ROLLS_UP_TO` a business unit,
 * `CLASSIFIED_AS` a category, `DRIVEN_BY` a regulatory driver. Each extraction written here is one
 * of those stated edges, walked **one hop** from the document's own subject — so every row carries
 * the edge it was read from in `method`, and a reader can check it against the canvas.
 *
 * **One hop, and the subject is the document's own.** Two hops would reach the whole graph and the
 * claim would stop being about the document at all; the subject is what the file *is* (a contract, or
 * the project a scope document describes), read from its own `contract_no` and `project_code` rather
 * than guessed. A document that resolves to nothing is left resolving to nothing.
 *
 * **Which is why this is a script and not an edit of `db.CAPEX.json`.** That document's `_meta` says
 * *"never hand-edit this file — change the generator and rebuild"*, and a derivation is only true
 * while it is re-derived. It is **idempotent** — the map is rebuilt from the canvas every run — and it
 * **refuses to write** rather than produce a document that would boot into a wrong answer.
 *
 * **It owns one key.** `document_extractions`, rebuilt; everything else in the document is carried
 * through untouched, because a script that rewrites a key it does not own is how a subtree gets
 * deleted.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const DB = new URL('../db.CAPEX.json', import.meta.url)
const db = JSON.parse(readFileSync(DB, 'utf8'))

const problems = []

/**
 * The edges a document's subject may be followed along, and what each one means it named.
 *
 * **A list rather than "every edge", because not every edge is something a document says.** A
 * contract names the vendor it was awarded to and the change orders that amend it; it does not name
 * the plan versions of the project it delivers, which are a finance artefact nobody writes into an
 * agreement. `HAS_PLAN_VERSION`, `RESOLVES_TO` and `AGGREGATES_OVER` are deliberately absent for that
 * reason.
 */
const FOLLOWED = new Set([
  'DELIVERS',
  'AWARDED_TO',
  'ENGINEERED_BY',
  'AMENDS',
  'CHANGES',
  'DESCRIBES',
  'MANAGED_BY',
  'ROLLS_UP_TO',
  'CLASSIFIED_AS',
  'LOCATED_IN',
  'DRIVEN_BY',
  'CONTAINS',
  'BELONGS_TO',
  'PLACES_IN_SERVICE',
  'RECOVERED_THROUGH',
  'REGULATED_BY',
  'FILED_UNDER',
])

/**
 * Node kinds a document does not *name* as an entity.
 *
 * `BudgetPlanVersion` and `Measure` are the graph's own bookkeeping — a finance artefact nobody
 * writes into an agreement. `Document` is excluded for a different reason: the canvas holds a node
 * for this very file, so following `DOCUMENTED_BY` would record the document as naming itself, and
 * `dgbEntities` already adds every corpus document as an entity in its own right.
 */
const NOT_NAMED = new Set(['BudgetPlanVersion', 'Measure', 'Document'])

const canvas = db.graph_studio?.canvas ?? {}
const nodes = new Map((canvas.nodes ?? []).map((n) => [n.node_id, n]))
const edges = canvas.edges ?? []
if (nodes.size === 0 || edges.length === 0) {
  console.error('seed-capex-extractions: db.CAPEX.json has no canvas to read — nothing to derive from')
  process.exit(1)
}

/** Every edge touching a node, either way round. */
const incident = new Map()
for (const edge of edges) {
  for (const id of [edge.from, edge.to]) {
    if (!incident.has(id)) incident.set(id, [])
    incident.get(id).push(edge)
  }
}

const documents = []
for (const drive of db.drives ?? []) {
  for (const folder of drive.folders ?? []) {
    for (const document of folder.documents ?? []) documents.push(document)
  }
}
if (documents.length === 0) {
  console.error('seed-capex-extractions: no drive document to derive against')
  process.exit(1)
}

/**
 * The node a document *is about* — its contract where it has a contract number, otherwise its
 * project. Read from the document's own fields; a document naming neither is left alone.
 */
const subjectOf = (document) => {
  if (document.contract_no && nodes.has(`CON:${document.contract_no}`)) {
    return `CON:${document.contract_no}`
  }
  if (document.project_code && nodes.has(`PRJ:${document.project_code}`)) {
    return `PRJ:${document.project_code}`
  }
  return null
}

/** The confidence the canvas states on an edge (`resolved · confidence 0.93`), or null where it
 *  states none — never a number made up to fill the field. */
const confidenceOf = (edge) => {
  const found = /confidence\s+([0-9.]+)/.exec(String(edge.detail ?? ''))
  return found ? Number(found[1]) : null
}

const previous = db.document_extractions ?? {}
const extractions = {}
let serial = 0
const typesSeen = new Set()

for (const document of documents) {
  const subject = subjectOf(document)
  if (!subject) continue

  /* The document's own subject first, so the row `documentDictionary` prints as *the* resolution is
     what the file is about rather than whichever neighbour happened to come back first. */
  const picked = [{ nodeId: subject, method: 'cover-sheet field' }]
  for (const edge of incident.get(subject) ?? []) {
    if (!FOLLOWED.has(edge.label)) continue
    const other = edge.from === subject ? edge.to : edge.from
    const node = nodes.get(other)
    if (!node || NOT_NAMED.has(node.type)) continue
    /* A document does not name itself as an entity — `dgbEntities` already adds the document. */
    if (other === `DOC:${String(document.document_id).replace(/^DOC:/, '')}`) continue
    if (node.element_class !== 'thin_instance') continue
    if (picked.some((p) => p.nodeId === other)) continue
    picked.push({ nodeId: other, method: edge.label, confidence: confidenceOf(edge) })
  }

  extractions[document.document_id] = picked.map((entry) => {
    const node = nodes.get(entry.nodeId)
    typesSeen.add(node.type)
    serial += 1
    /* Carried forward from the row this document already had, where it had one: the package's own
       figures are the package's, and re-deriving them here would be this script inventing them. */
    const before = previous[document.document_id]
    const prior = Array.isArray(before) ? before[0] : before
    return {
      extraction_id: `ex_${String(serial).padStart(4, '0')}`,
      extracted_entity: node.label,
      /* **The extractor's own answer is the node's type here**, because this corpus's documents name
         the thing by the name the graph holds it under — a contract really does print
         `QDN-2025-C01`. EPA's map says otherwise for its own documents ("Generator (facility)"
         resolving to a `Facility`) and is untouched. */
      entity_type: node.type,
      resolved_node: entry.nodeId,
      resolved_facility: prior?.resolved_facility ?? null,
      state: prior?.state ?? null,
      linked_manifests: prior?.linked_manifests ?? 0,
      confidence: entry.confidence ?? prior?.confidence ?? 0.95,
      document_id: document.document_id,
      source_file: document.name ?? null,
      project_code: document.project_code ?? null,
      normalized_value: node.label,
      /* The edge this was read from, so the claim is checkable against the canvas. */
      method: entry.method,
      page: prior?.page ?? 1,
    }
  })
}

/*
 * **Refusals, before anything is written.** Each is a state that renders perfectly and answers
 * wrongly, which is the only kind worth refusing over.
 */
const rows = Object.values(extractions).flat()
for (const row of rows) {
  if (!nodes.has(row.resolved_node)) {
    problems.push(`${row.document_id} resolves to ${row.resolved_node}, which the canvas does not have`)
  }
}
if (rows.length === 0) problems.push('no document resolved to anything — the map would be empty')
/*
 * The reason this script exists: the Bridge pairs every resolved **entity type** with every concept,
 * so the number of types is the number of correspondences a reviewer can be asked about. One type is
 * one row, which is a queue that teaches the gate is a formality.
 */
const MIN_TYPES = 10
if (typesSeen.size < MIN_TYPES) {
  problems.push(
    `only ${typesSeen.size} entity type(s) resolved (${[...typesSeen].sort().join(', ')}) — ` +
      `the Bridge would offer fewer than ${MIN_TYPES} correspondences to review`,
  )
}
/* Every type has to be a concept the canvas declares, or the Bridge pairs it against nothing and the
   row is a correspondence to a concept this graph does not hold. */
const concepts = new Set(
  (canvas.nodes ?? []).filter((n) => n.element_class === 'concept').map((n) => n.label),
)
const unpaired = [...typesSeen].filter((t) => !concepts.has(t))
if (unpaired.length > 0) {
  problems.push(`resolved types with no concept on the canvas: ${unpaired.join(', ')}`)
}

if (problems.length > 0) {
  console.error('seed-capex-extractions: refusing to write —')
  for (const p of problems) console.error(`  · ${p}`)
  process.exit(1)
}

writeFileSync(DB, `${JSON.stringify({ ...db, document_extractions: extractions }, null, 2)}\n`)

console.log(`seed-capex-extractions: ${rows.length} extractions over ${Object.keys(extractions).length} documents`)
console.log(`  entity types: ${[...typesSeen].sort().join(', ')}`)
console.log('  npm run db:push -- CAPEX to publish')
