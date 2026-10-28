/**
 * Writes `backend/supplychain/supplychain_*.json` from the Supply Chain Analyst package
 * (`frontend/json-supplychain/` — the Bramwell Environmental Group export).
 *
 *   node backend/scripts/ingest-supplychain-json.mjs
 *
 * The package is one merged document (`00_merged/db.BRAMWELL.json`) plus three fragments the app has
 * no route for yet: the New Role wizard's library, the Goals build's scripted state and the
 * Submissions build's. This fans them out into the split files `supplychain-loader.js` reads, by the
 * same key -> file mapping `writeSplitFiles` in `server.js` writes with.
 *
 * What it deliberately does **not** write:
 *   - `settings`, `auth_roles` and `google_account`. They are the tenant's, shared by every dataset,
 *     and live in `backend/settings.json`; the package carries its own copy (other people, other
 *     personas) and the loader reads the shared file last, so a copy here would be ignored anyway.
 *
 * `whatif` is the one key the package has no content for, so it is written as the structure of
 * CAPEX's with every row emptied and no framed document - `validateDb` permits an empty collection
 * in a non-primary dataset and the What-if page then says so rather than showing another tenant's lens.
 *
 * Exits non-zero if the package carries a key no split file takes, because a key silently dropped
 * from a split file reads as an answer ("nothing there").
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const backend = join(here, '..')
const pkg = join(backend, '..', 'frontend', 'json-supplychain')
const out = join(backend, 'supplychain')
mkdirSync(out, { recursive: true })

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')

const merged = readJson(join(pkg, '00_merged', 'db.BRAMWELL.json'))
const newRole = readJson(join(pkg, '00_merged', 'db.BRAMWELL.new_role.json'))
const goals = readJson(join(pkg, '00_merged', 'db.BRAMWELL.goals.json'))
const submissions = readJson(join(pkg, '00_merged', 'db.BRAMWELL.submissions.json'))
const readings = readJson(join(pkg, '01_new_role', 'document_readings.json'))

/** The same mapping `writeSplitFiles` uses. */
const FILES = [
  ['supplychain_sources.json', ['projects', 'credentials', 'column_profiles', 'column_vocabulary', 'drives', 'drive_credentials', 'document_extractions', 'mail_corpus', 'registered']],
  ['supplychain_catalogue.json', ['document_vocabulary', 'data_model', 'change_signals', '_meta', '_provenance']],
  ['supplychain_new_graph.json', ['graph_domains', 'graph_personas', 'graph_hero_questions', 'graph_use_cases', 'graph_use_case_templates', 'graph_metrics', 'graph_answer_formats', 'graph_kpis']],
  ['supplychain_graph_studio.json', ['graph_studio', 'studio_graph']],
  ['supplychain_reports.json', ['reports', 'reports_prototype', 'report_defaults', 'report_permissions']],
  ['supplychain_ask.json', ['ask_answers']],
  ['supplychain_audit_governance.json', ['audit', 'traces', 'evals']],
]
const SHARED = ['settings', 'auth_roles', 'google_account']

/* The Data Modeling payload requires `cross_attributes` and `updated_at` on every entity; the package
   omits them where empty / unedited. Defaulted exactly as the CAPEX ingest does. */
const packageDate = merged._meta?.as_of ? new Date(merged._meta.as_of).toISOString() : null
for (const entity of merged.data_model?.entities ?? []) {
  entity.cross_attributes ??= []
  if (packageDate) entity.updated_at ??= packageDate
}

const problems = []
const report = []

/* The three report definitions name a `positions` spine, but the package ships them as rendered
   documents and carries no roster by that name — their rows live inside the HTML. `validateDb`
   requires the spine to exist and permits it to be empty, so an empty roster is written rather than
   inventing rows (the `projects` rows in `reports.data` belong to the CAPEX schema the package carried). */
for (const def of merged.reports?.reports ?? []) {
  if (!(def.spine in merged.reports.data)) {
    merged.reports.data[def.spine] = []
    report.push(`reports.data.${def.spine}: written empty (spine of ${def.report_id})`)
  }
}

/* `validateDb` refuses a recorded suggestion that joins a column to itself (the Data Modeling canvas
   draws a join between two columns), and a refusal there stops the whole boot. The package carries one
   - a duplicate-vendor check on pur.vendor.tax_id - so it is left out of the written file and named
   here rather than loosening the guard or editing the package. */
const suggestions = merged.data_model?.suggestions ?? []
const selfJoins = suggestions.filter((s) => s.from_table_key === s.to_table_key && s.from_column === s.to_column)
if (selfJoins.length) {
  merged.data_model.suggestions = suggestions.filter((s) => !selfJoins.includes(s))
  report.push(`data_model.suggestions: left out ${selfJoins.length} self-join(s): ${selfJoins.map((s) => s.suggestion_id).join(', ')}`)
}

for (const [file, keys] of FILES) {
  const next = {}
  for (const key of keys) if (key in merged) next[key] = merged[key]
  writeJson(join(out, file), next)
  report.push(`${file}: ${Object.keys(next).join(', ')}`)
}

writeJson(join(out, 'supplychain_new_role.json'), { new_role: newRole.new_role, document_readings: readings })
writeJson(join(out, 'supplychain_goals.json'), { goals })
writeJson(join(out, 'supplychain_submissions.json'), { submissions })
report.push('supplychain_new_role.json: new_role, document_readings', 'supplychain_goals.json: goals', 'supplychain_submissions.json: submissions')

/* What-if: CAPEX's structure, rows emptied, no framed document. */
const emptied = (value) => {
  if (Array.isArray(value)) return []
  return value
}
const capexWhatif = readJson(join(backend, 'capex', 'capex_whatif.json')).whatif
const whatif = { ...capexWhatif }
for (const key of ['generators', 'candidate_pools', 'watched_measures', 'resolvable', 'scenario_library_seeds', 'slices', 'levers', 'locked_slices', 'transporters']) {
  if (key in whatif) whatif[key] = emptied(whatif[key])
}
whatif.document = null
writeJson(join(out, 'supplychain_whatif.json'), { whatif })
report.push('supplychain_whatif.json: whatif (structure only)')

/* SUPPLYCHAIN is a Microsoft-brand dataset (`PROVIDER_BRANDS`), so its mailbox carries Outlook's
   folders; a corpus filed under Gmail's INBOX / SENT would be invisible in the catalogue. */
const OUTLOOK_FOLDER = { INBOX: 'Inbox', SENT: 'Sent Items' }
const corpus = readJson(join(out, 'supplychain_sources.json'))
let refiled = 0
for (const doc of corpus.mail_corpus?.documents ?? []) {
  if (doc.label_id in OUTLOOK_FOLDER) {
    doc.label_id = OUTLOOK_FOLDER[doc.label_id]
    refiled += 1
  }
}
writeJson(join(out, 'supplychain_sources.json'), corpus)
if (refiled) report.push(`supplychain_sources.json: mail re-filed under Outlook folders (${refiled})`)

const covered = new Set([...FILES.flatMap(([, keys]) => keys), ...SHARED, 'whatif'])
for (const key of Object.keys(merged)) {
  if (!covered.has(key)) problems.push(`the package carries "${key}" and no split file takes it`)
}

console.log(report.join('\n'))
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`)
  process.exitCode = 1
}
