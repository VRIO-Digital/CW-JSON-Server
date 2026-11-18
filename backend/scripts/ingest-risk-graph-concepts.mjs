/**
 * Writes `graph_studio.canvas` (concept nodes + concept-to-concept edges) into
 * `backend/risk/risk_graph_studio.json`, following the same pattern Supplychain's own
 * `graph_studio.canvas` uses (`backend/supplychain/supplychain_graph_studio.json`).
 *
 *   node backend/scripts/ingest-risk-graph-concepts.mjs   (run AFTER ingest-risk-column-profiles.mjs)
 *
 * **Why this exists.** `conceptsFor` in `studioLanes.js` reads the structured lane's concepts
 * straight off `graph_studio.canvas.nodes` filtered to `element_class === 'concept'` — "the package
 * already states them… nominating a second set would put two answers to what this graph models one
 * tab apart." With that array empty, `sgbGraph` derived `HAS_COLUMN` edges only: no `REALISES`, no
 * `DESCRIBES`, no `REL` — because there was nothing for a column's class to realise. That is what
 * made the Canvas sphere read "0 relationships": true of what was recorded, the same honest-zero
 * this whole dataset has carried elsewhere, but one this package's own real column set can close,
 * the same way Supplychain's canvas states its own.
 *
 * **Seven real concepts, chosen because they are what RISK's own 68 declared columns actually
 * name — checked by grepping the real column set, not picked first and hoped for**: Contract (15
 * columns mention it), Site (14), Client (5), Permit (4), Region (3), Project Leader (2), Regional
 * VP (1). `conceptForColumn` in `studioLanes.js` matches a concept to a column by substring —
 * the concept's own name has to appear in that column's real `column_id`/`description` — so these
 * are not invented categories, they are the names already sitting in the dictionary this dataset's
 * own ingest (`ingest-risk-column-profiles.mjs`) wrote from `contracts.json` and `signals.json`.
 *
 * **The six REL edges are real relationships `master.contract`'s own columns already assert on one
 * row** — a contract's client, site, region, regional VP and project leader are fields of the same
 * real record, not a relationship nominated separately from it; Site→Permit is signals.json's own
 * `en6` ("Permit renewal status"), read at the facility level.
 *
 * Refuses to write if a concept name matches zero real columns (the nomination would be unfounded).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const backend = join(here, '..')
const out = join(backend, 'risk', 'risk_graph_studio.json')

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const sourcesPath = join(backend, 'risk', 'risk_sources.json')
const columnProfiles = readJson(sourcesPath).column_profiles

const CONCEPTS = [
  { name: 'Contract', sublabel: 'An operations and maintenance contract between Northline and a client.' },
  { name: 'Client', sublabel: 'The municipality or utility Northline serves under a contract.' },
  { name: 'Site', sublabel: 'The physical plant or system a contract runs.' },
  { name: 'Region', sublabel: "One of the company's five operating regions." },
  { name: 'Regional VP', sublabel: 'The Regional VP who owns a set of contracts.' },
  { name: 'Project Leader', sublabel: 'The on-site leader running day-to-day delivery of a contract.' },
  { name: 'Permit', sublabel: 'A regulatory permit a site holds and must renew.' },
]

const REL_EDGES = [
  { from: 'Contract', to: 'Client', label: 'is held with', detail: "master.contract's own client field." },
  { from: 'Contract', to: 'Site', label: 'runs at', detail: "master.contract's own site field." },
  { from: 'Contract', to: 'Region', label: 'reports into', detail: "master.contract's own region field." },
  { from: 'Contract', to: 'Regional VP', label: 'is owned by', detail: "master.contract's own regional_vp field." },
  { from: 'Contract', to: 'Project Leader', label: 'is led on site by', detail: "master.contract's own project_leader field." },
  { from: 'Site', to: 'Permit', label: 'operates under', detail: 'signals.json\'s en6, "Permit renewal status".' },
]

const problems = []
let allColumns = []
for (const cols of Object.values(columnProfiles)) allColumns = allColumns.concat(cols)

const matches = (name) =>
  allColumns.filter((c) => `${c.column_id} ${c.description ?? ''}`.toLowerCase().includes(name.toLowerCase())).length

for (const c of CONCEPTS) {
  const n = matches(c.name)
  if (n === 0) problems.push(`concept "${c.name}" matches zero real columns — nothing grounds this nomination`)
}
if (problems.length > 0) {
  console.error(`refusing to write — ${problems.length} problem(s):\n  · ${problems.join('\n  · ')}`)
  process.exitCode = 1
  process.exit()
}

/* Simple deterministic circle layout — nothing here claims it is optimal, only that nodes do not
   overlap, which is all the flat canvas needs from x/y. */
const R = 220
const nodes = CONCEPTS.map((c, i) => {
  const angle = (2 * Math.PI * i) / CONCEPTS.length
  const degree = REL_EDGES.filter((e) => e.from === c.name || e.to === c.name).length
  return {
    node_id: `CONCEPT:${c.name.replace(/\s+/g, '')}`,
    label: c.name,
    sublabel: c.sublabel,
    type: 'Concept',
    element_class: 'concept',
    group: 'Concept',
    source: 'concept nomination; real column set (ingest-risk-column-profiles.mjs)',
    confidence: null,
    degree,
    r: 12,
    x: Math.round((300 + R * Math.cos(angle)) * 10) / 10,
    y: Math.round((300 + R * Math.sin(angle)) * 10) / 10,
  }
})

const nodeIdByName = new Map(nodes.map((n) => [n.label, n.node_id]))
const edges = REL_EDGES.map((e) => ({
  from: nodeIdByName.get(e.from),
  to: nodeIdByName.get(e.to),
  label: e.label,
  detail: e.detail,
}))

const existing = readJson(out)
existing.graph_studio = {
  ...existing.graph_studio,
  canvas: { nodes, edges },
}
writeFileSync(out, `${JSON.stringify(existing, null, 2)}\n`, 'utf8')

console.log(
  `wrote ${nodes.length} concept(s) and ${edges.length} REL edge(s) into backend/risk/risk_graph_studio.json`,
)
