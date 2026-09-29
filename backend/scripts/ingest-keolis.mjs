/**
 * Ingest the Keolis Valmont demo package into the KEOLIS dataset's split files.
 *
 * Reads the package's merged document — `frontend/keolis/json/00_merged/db.KEOLIS.json`, the one
 * file its own README says is canonical — and fans it out into `backend/keolis/keolis_*.json`,
 * the same one-file-per-feature-area layout `backend/capex/` has and `keolis-loader.js` reads.
 *
 * **Every key is either mapped, deliberately dropped, or the run refuses.** The package is
 * regenerated from its own `_build/` scripts, so a future rebuild can grow a key this mapping has
 * never seen — and a key that lands in no split file is data that silently never reaches the
 * server, which is the failure `writeSplitFiles` documents for the same mapping one layer up.
 *
 * What is deliberately dropped, and why:
 *
 * - `settings`, `auth_roles`, `google_account` — tenant-level keys. The loaders overlay the shared
 *   `backend/settings.json` after the dataset's own files, so a copy here would either be dead or
 *   fight the shared file. The package's own users are the same `@vriodigital.com` directory (its
 *   README: "Demo logins stay on @vriodigital.com, because the login resolves against
 *   settings.users"), so nothing is lost.
 * - `_meta`, `_provenance` — the package's account of itself. `commitDb` writes tenant-level keys
 *   back to the shared `backend/settings.json`, and `_meta` used to be on that list — a dataset's
 *   provenance landing in the shared file would be claimed by every dataset at the next boot.
 *
 * What is rewritten, and why — **the rendered-document pointers are stripped for now**:
 *
 * - `reports.documents` -> `[]`, `reports.authoring_document` -> null,
 *   `reports.governance.document` -> null, `whatif.document` removed.
 *
 *   The package names five HTML exports (`R1_intervention_review.html`, `R2_project_360.html`,
 *   `W1_what_if_lens.html`, …) that it does not ship — there is no .html anywhere in it. Serving
 *   the pointers anyway is worse than serving none: the client resolves a document by **basename**
 *   across every dataset folder, and two of these names collide with CAPEX's shipped files
 *   (`R2_project_360.html`, `W1_what_if_lens.html`) — so a Keolis row would frame **CAPEX's**
 *   report, which is the dataset bleed this repo refuses everywhere. With the pointers stripped,
 *   Audit & Governance falls back to the computed page over `reports.register`, and the report /
 *   What-if surfaces stay honestly gated until Keolis documents exist. When they do, restore the
 *   pointers here (with basenames unique to a `frontend/src/Keolis/` folder) in the same change
 *   that adds the files.
 *
 * Run it with `npm run ingest:keolis` (from the repo root or `backend/`), then restart the mock
 * server — the loaders read the split files at boot only.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const backendDir = join(here, '..')
const packageDoc = join(backendDir, '..', 'frontend', 'keolis', 'json', '00_merged', 'db.KEOLIS.json')
const outDir = join(backendDir, 'keolis')

/**
 * Which split file each key travels in — the same mapping `writeSplitFiles` in `server.js` uses,
 * with `data_model` and `change_signals` in the catalogue file because they are the dataset's own
 * (a data-model entity is keyed `"<dataset>.<table>"` into *this* dataset's tables).
 */
const SPLIT_MAPPING = [
  {
    file: 'keolis_sources.json',
    keys: [
      'projects',
      'credentials',
      'column_profiles',
      'column_vocabulary',
      'drives',
      'drive_credentials',
      'document_extractions',
      'mail_corpus',
    ],
  },
  { file: 'keolis_catalogue.json', keys: ['document_vocabulary', 'data_model', 'change_signals'] },
  {
    file: 'keolis_new_graph.json',
    keys: [
      'graph_domains',
      'graph_personas',
      'graph_hero_questions',
      'graph_use_cases',
      'graph_use_case_templates',
      'graph_metrics',
      'graph_answer_formats',
    ],
  },
  { file: 'keolis_graph_studio.json', keys: ['graph_studio', 'studio_graph'] },
  { file: 'keolis_reports.json', keys: ['reports', 'reports_prototype'] },
  { file: 'keolis_ask.json', keys: ['ask_answers'] },
  { file: 'keolis_whatif.json', keys: ['whatif'] },
  { file: 'keolis_audit_governance.json', keys: ['audit', 'traces', 'evals'] },
]

/** Tenant-level and provenance keys the split deliberately leaves behind — see the header. */
const DROPPED = ['settings', 'auth_roles', 'google_account', '_meta', '_provenance']

function fail(message) {
  console.error(`\ningest-keolis: refusing to write — ${message}\n`)
  process.exit(1)
}

let source
try {
  source = JSON.parse(readFileSync(packageDoc, 'utf8'))
} catch (error) {
  fail(`cannot read the package's merged document at ${packageDoc}: ${error.message}`)
}

/* Every key must be mapped or deliberately dropped — a key in neither is data that would
   silently never reach the server, so the run stops and names it. */
const mapped = new Set(SPLIT_MAPPING.flatMap((entry) => entry.keys))
const unaccounted = Object.keys(source).filter((key) => !mapped.has(key) && !DROPPED.includes(key))
if (unaccounted.length > 0) {
  fail(
    `the package document carries ${unaccounted.length} key(s) this mapping does not place: ` +
      `${unaccounted.join(', ')}. Add each one to SPLIT_MAPPING (or to DROPPED, saying why).`,
  )
}

/* ---------------- the rendered-document pointers, stripped — see the header ---------------- */

const reports = source.reports
if (!reports || typeof reports !== 'object') fail('the package document has no "reports" key')

const strippedPointers = []
if (Array.isArray(reports.documents) && reports.documents.length > 0) {
  strippedPointers.push(...reports.documents.map((d) => d.file))
  reports.documents = []
}
if (reports.authoring_document) {
  strippedPointers.push(reports.authoring_document)
  reports.authoring_document = null
}
if (reports.governance?.document) {
  strippedPointers.push(reports.governance.document.file)
  reports.governance.document = null
}
if (source.whatif?.document) {
  strippedPointers.push(source.whatif.document.file)
  delete source.whatif.document
}

/* ---------------- write the split files ---------------- */

mkdirSync(outDir, { recursive: true })

const summary = []
for (const { file, keys } of SPLIT_MAPPING) {
  const fileData = {}
  for (const key of keys) {
    if (key in source) fileData[key] = source[key]
  }
  const missing = keys.filter((key) => !(key in source))
  writeFileSync(join(outDir, file), `${JSON.stringify(fileData, null, 2)}\n`, 'utf8')
  summary.push(
    `  ${file} — ${Object.keys(fileData).join(', ') || '(empty)'}` +
      (missing.length > 0 ? ` (absent in package: ${missing.join(', ')})` : ''),
  )
}

console.log(`ingest-keolis: wrote ${SPLIT_MAPPING.length} split files to backend/keolis/`)
for (const line of summary) console.log(line)
if (strippedPointers.length > 0) {
  console.log(
    `  stripped ${strippedPointers.length} rendered-document pointer(s) the package names but does ` +
      `not ship: ${strippedPointers.join(', ')}`,
  )
}
console.log('  dropped (tenant-level, served from backend/settings.json): ' + DROPPED.join(', '))
console.log('\nRestart the mock server for the split files to be read.')
