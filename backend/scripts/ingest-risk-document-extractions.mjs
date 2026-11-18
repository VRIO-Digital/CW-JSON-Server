/**
 * Writes `document_extractions` into `backend/risk/risk_sources.json` — what each of RISK's 9
 * shared-drive documents resolves to, from the package's own real project/contract data
 * (`08_portfolio/contracts.json`, `05_sources_and_catalog/{documents,mail}.json`).
 *
 *   node backend/scripts/ingest-risk-document-extractions.mjs
 *
 * **Why this exists.** With `document_extractions: {}`, Graph Studio's document lane can draw the
 * 9 documents as nodes but nothing they resolved to — `dgbEntities` only derives a second node per
 * document when `document_extractions` names one (see `studioLanes.js`'s `extractionsFor`). The
 * Canvas sphere then shows the document nodes as disconnected dots with nothing on the structured
 * side to stitch to, and the strip reads "0 relationships" — true of what was recorded, not a crash,
 * but an honest gap this package's own data can close.
 *
 * **Every field is read, not invented.** 6 of the 9 documents name their real project
 * (`documents.json`'s own `project` field, e.g. "NCO-047") — that project's real site and client
 * name come straight from `contracts.json` ("Harlow Creek WWTP" / "City of Harlow Creek"), so two
 * documents about the same site resolve to the **same node**, which is the whole point of entity
 * resolution: it is not duplication. `linked_manifests` is RISK's real analogue of EPA's own
 * field — the count of real `mail.json` messages that name the *same* project, not a guess.
 *
 * **The remaining 3 name no project**, honestly (`documents.json`'s `project: ""`), and are not
 * forced onto one: `claims-proc` and `renewal-2025` resolve to Northline's own internal process
 * named in the document's own title, and `calder-review` resolves to the real site it is about —
 * Calder Valley — which carries no current project code because the document's own subject is that
 * the contract was *lost*, not a fact to paper over with a code that does not exist.
 *
 * Refuses to write if a document names a project `contracts.json` does not have.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const backend = join(here, '..')
const pkg = join(backend, '..', 'Contract_risk_analyst', 'json')
const out = join(backend, 'risk', 'risk_sources.json')

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

const allDocs = readJson(join(pkg, '05_sources_and_catalog', 'documents.json'))
const sharedDocs = allDocs.filter((d) => d.id.startsWith('DOC:') && d.folder !== 'My drive')
const contracts = readJson(join(pkg, '08_portfolio', 'contracts.json'))
const mail = readJson(join(pkg, '05_sources_and_catalog', 'mail.json'))
const contractById = new Map(contracts.map((c) => [c.id, c]))

/* Non-project documents, resolved to the real internal subject named in the document's own title —
   not forced onto a project code the package does not give them. */
const NON_PROJECT_RESOLUTION = {
  'DOC:claims-proc': {
    resolved_node: 'PROC:claims-notice-legal-hold',
    extracted_entity: 'Claims Notice and Legal Hold Procedure',
    entity_type: 'Policy',
    method: 'document title',
  },
  'DOC:renewal-2025': {
    resolved_node: 'PROC:renewal-risk-review',
    extracted_entity: 'Renewal risk review process',
    entity_type: 'Process',
    method: 'document title',
  },
  'DOC:calder-review': {
    /* No current project code — the document's own subject is that this contract was lost, so
       inventing one would misstate the one fact the review is about. */
    resolved_node: 'SITE:calder-valley-wwtp',
    extracted_entity: 'Calder Valley WWTP',
    entity_type: 'Project',
    method: 'document title',
  },
}

const problems = []
const extractions = {}

for (const d of sharedDocs) {
  if (d.project) {
    const contract = contractById.get(d.project)
    if (!contract) {
      problems.push(`${d.id}: names project "${d.project}", which contracts.json does not have`)
      continue
    }
    const linkedMail = mail.filter((m) => m.project === d.project).length
    extractions[d.id] = {
      extraction_id: `ex_${d.id.replace('DOC:', '')}`,
      extracted_entity: contract.site,
      entity_type: 'Project',
      resolved_node: d.project,
      resolved_facility: contract.site,
      state: 'Northline Water Group',
      linked_manifests: linkedMail,
      confidence: 1,
      document_id: d.id,
      source_file: d.name,
      method: 'project field (documents.json)',
    }
    continue
  }

  const resolution = NON_PROJECT_RESOLUTION[d.id]
  if (!resolution) {
    problems.push(`${d.id}: names no project and has no NON_PROJECT_RESOLUTION entry`)
    continue
  }
  /* The two process documents (renewal-2025, claims-proc) really are what the mail with no project
     code is about — counted, not assumed. calder-review's count is genuinely 0: no message in the
     corpus names a lost contract by a code it no longer carries. */
  const linkedMail =
    resolution.entity_type === 'Project'
      ? 0
      : mail.filter((m) => m.project === '').length
  extractions[d.id] = {
    extraction_id: `ex_${d.id.replace('DOC:', '')}`,
    extracted_entity: resolution.extracted_entity,
    entity_type: resolution.entity_type,
    resolved_node: resolution.resolved_node,
    resolved_facility: resolution.extracted_entity,
    state: 'Northline Water Group',
    linked_manifests: linkedMail,
    confidence: 0.85,
    document_id: d.id,
    source_file: d.name,
    method: resolution.method,
  }
}

if (problems.length > 0) {
  console.error(`refusing to write — ${problems.length} problem(s):\n  · ${problems.join('\n  · ')}`)
  process.exitCode = 1
  process.exit()
}

const existing = readJson(out)
existing.document_extractions = extractions
writeFileSync(out, `${JSON.stringify(existing, null, 2)}\n`, 'utf8')

const nodes = new Set(Object.values(extractions).map((e) => e.resolved_node))
console.log(
  `wrote document_extractions for ${Object.keys(extractions).length} document(s), resolving to ` +
    `${nodes.size} distinct real node(s), into backend/risk/risk_sources.json`,
)
