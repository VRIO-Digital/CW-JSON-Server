/**
 * Rewrites `backend/capex/capex_*.json` from the Northline package's merged export
 * (`backend/scripts/northline-export/00_merged/`) — the CAPEX dataset's latest requirement.
 *
 *   node backend/scripts/ingest-northline-json.mjs
 *
 * The export is one merged document (`db.NORTHLINE.json`) plus three fragments the app has no
 * route for yet: the New Role wizard's library, the Goals build's scripted state and the
 * Submissions build's. This script fans them back out into the split files the server loads, by the
 * same key → file mapping `writeSplitFiles` in `server.js` writes with.
 *
 * What it deliberately does **not** touch:
 *   - `settings`, `auth_roles` and `google_account`. They are the tenant's, shared by every dataset,
 *     and live in `backend/settings.json`; this export carries its own copy of them (different
 *     people, different personas), and writing it there would change who can sign in under EPA and
 *     KEOLIS. The loader reads the shared file last, so a copy here would be ignored anyway.
 *   - `whatif`. The export has none, and CAPEX's lens is the framed document under
 *     `frontend/src/Capex/what-if-lens/`; `capex_whatif.json` keeps the pointer to it.
 *
 * Reports (and exits non-zero) if an old file held a key neither the export nor the mapping carries,
 * because a key silently dropped from a split file reads as an answer ("nothing there").
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const backend = join(here, '..')
/* The export lives beside the script, not in the frontend: nothing in the SPA reads it, and `.ebignore`
   keeps `backend/scripts/` out of the deployed bundle, so a 2 MB source file is not shipped to the box. */
const exportDir = join(here, 'northline-export', '00_merged')
const out = join(backend, 'capex')

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')

const merged = readJson(join(exportDir, 'db.NORTHLINE.json'))
const newRole = readJson(join(exportDir, 'db.NORTHLINE.new_role.json'))
const goals = readJson(join(exportDir, 'db.NORTHLINE.goals.json'))
const submissions = readJson(join(exportDir, 'db.NORTHLINE.submissions.json'))

/* The new role fragment is `{ new_role }`; the document readings sit beside it in the export's own
   folder rather than in the merged file, and belong with the wizard. */
const readings = readJson(join(exportDir, '..', '01_new_role', 'document_readings.json'))

/** The same mapping `writeSplitFiles` uses, plus the files this export adds. */
const FILES = [
  ['capex_sources.json', ['projects', 'credentials', 'column_profiles', 'column_vocabulary', 'drives', 'drive_credentials', 'document_extractions', 'mail_corpus', 'registered']],
  ['capex_catalogue.json', ['document_vocabulary', 'data_model', 'change_signals', '_meta', '_provenance']],
  ['capex_new_graph.json', ['graph_domains', 'graph_personas', 'graph_hero_questions', 'graph_use_cases', 'graph_use_case_templates', 'graph_metrics', 'graph_answer_formats', 'graph_kpis']],
  ['capex_graph_studio.json', ['graph_studio', 'studio_graph']],
  ['capex_reports.json', ['reports', 'reports_prototype', 'report_defaults', 'report_permissions']],
  ['capex_ask.json', ['ask_answers']],
  ['capex_audit_governance.json', ['audit', 'traces', 'evals']],
]

/* The Data Modeling declarations the server validates carry `cross_attributes` (columns reassigned from
   another table) on every entity; the export omits the key where there are none. Defaulted, because
   absent and empty are the same fact and the validator refuses the first. */
/* `updated_at` likewise: the Data Modeling tab's payload requires it as a string (a declaration's age is
   shown), and the export has none, so it takes the package's own as-of date — when it was last true,
   which is the only honest answer for a row nobody has edited since. */
const packageDate = merged._meta?.as_of ? new Date(merged._meta.as_of).toISOString() : null
for (const entity of merged.data_model?.entities ?? []) {
  entity.cross_attributes ??= []
  if (packageDate) entity.updated_at ??= packageDate
}

const SHARED = ['settings', 'auth_roles', 'google_account']
const problems = []
const report = []

for (const [file, keys] of FILES) {
  const path = join(out, file)
  const before = existsSync(path) ? readJson(path) : {}
  const next = {}
  for (const key of keys) {
    if (key in merged) next[key] = merged[key]
    /* A key the old file held and the export lacks is kept as it was (`registered`, `graph_kpis`,
       the report defaults) — dropping it would be the export's silence read as a decision. */
    else if (key in before) next[key] = before[key]
  }
  for (const key of Object.keys(before)) {
    if (!(key in next)) problems.push(`${file}: the old file held "${key}" and neither the export nor the mapping carries it`)
  }
  writeJson(path, next)
  report.push(`${file}: ${Object.keys(next).join(', ')}`)
}

/* The three fragments the app has no consumer for yet — kept whole, under one key each. */
writeJson(join(out, 'capex_new_role.json'), { new_role: newRole.new_role, document_readings: readings })
writeJson(join(out, 'capex_goals.json'), { goals })
writeJson(join(out, 'capex_submissions.json'), { submissions })
report.push('capex_new_role.json: new_role, document_readings', 'capex_goals.json: goals', 'capex_submissions.json: submissions')

/* CAPEX presents the Microsoft connectors (PROVIDER_BRANDS), so its mailbox is Outlook's: folders are
   named Inbox, and a corpus filed under Gmail's INBOX would be invisible in the catalogue. The export
   still says INBOX — it predates the brand — so the rename is made here, on every run. */
const corpus = readJson(join(out, 'capex_sources.json'))
let renamed = 0
for (const doc of corpus.mail_corpus?.documents ?? []) {
  if (doc.label_id === 'INBOX') {
    doc.label_id = 'Inbox'
    renamed += 1
  }
}
writeJson(join(out, 'capex_sources.json'), corpus)
if (renamed) report.push(`capex_sources.json: mail re-filed under Inbox (${renamed})`)

const covered = new Set([...FILES.flatMap(([, keys]) => keys), ...SHARED, 'whatif'])
for (const key of Object.keys(merged)) {
  if (!covered.has(key)) problems.push(`the export carries "${key}" and no split file takes it`)
}

console.log(report.join('\n'))
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`)
  process.exitCode = 1
}
