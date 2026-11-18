/**
 * Writes `backend/risk/risk_*.json` — a new, empty-but-servable secondary dataset for Contract Risk
 * Analyst. RISK is the dataset code (not CONTRACTRISK) because the URL segment is a dataset's first
 * letter and CAPEX already owns C.
 *
 *   node backend/scripts/ingest-risk-json.mjs
 *
 * **This is the split-file equivalent of `npm run seed:dataset -- RISK`, not a real ingest.**
 * `seed-dataset.js` wants `backend/db.json` (the retired monolith) as the primary's structure to
 * copy; that file does not exist in this checkout and the server no longer reads it at all. CAPEX's
 * real structure is available anyway, split across `backend/capex/capex_*.json` — so this script
 * loads it the same way the server does (`loadCapexDocument`) and runs the *same* `seedValue` logic
 * `seed-dataset.js` uses against the *same* `MERGE_PLAN`, then writes the result out split rather
 * than as one `db.RISK.json`.
 *
 * **Why seeded-empty rather than a real ingest of the Contract Risk Analyst package.** That package
 * (`Contract_risk_analyst/`) is real and rich — role.json, people.json, regions.json, a 62-question
 * Ask library, scorecard factors/signals, 300 contracts — but it is shaped for the *prototype's own*
 * client-side data layer (`src/data/risk.ts` and friends), not for this app's `DB_SHAPE`. Its own
 * README states the prototype is self-contained: "Nothing is connected. The data is generated in the
 * file... Sources, Data Catalog, Graph Studio, New Role and Audit show 'Not part of this prototype'."
 * Mapping 300 scorecard rows into `projects`/`column_profiles`, or a question library into
 * `ask_answers`, would mean inventing a shape the source does not have — exactly what this repo
 * refuses everywhere. A seeded-empty secondary dataset is the honest backend equivalent of what the
 * prototype itself admits it is: nothing connected, so empty collections, which `validateDb` only
 * permits in a non-primary dataset.
 *
 * The prototype's own rich Ask/Goals/Submissions experience is served separately, as a framed static
 * document (`ContractRiskPage.tsx`, `frontend/src/ContractRisk/goals-submission/ContractRisk.html`)
 * that reads none of this — this dataset registration exists so RISK is a real, bootable, selectable
 * dataset (the Settings dataset picker, `GET /datasets`, `both`) rather than a name with nothing
 * behind it, which stops the boot per `DATASETS`' own rule.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadCapexDocument } from '../capex-loader.js'
import { MERGE_PLAN } from '../datasets.js'

const here = dirname(fileURLToPath(import.meta.url))
const backend = join(here, '..')
const out = join(backend, 'risk')
mkdirSync(out, { recursive: true })

const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')

const source = await loadCapexDocument()

/* ---------------- the same seedValue() seed-dataset.js uses, against the same MERGE_PLAN ---------------- */

function seedValue(rule, value) {
  if (rule === 'primary') return value
  if (rule === 'keyed') return {}
  if (rule && typeof rule === 'object' && 'union' in rule) return []
  if (rule && typeof rule === 'object' && rule.deep) {
    const out = { ...(value ?? {}) }
    for (const [key, sub] of Object.entries(rule.deep)) {
      if (!(key in out)) continue
      out[key] = seedValue(sub, out[key])
    }
    return out
  }
  throw new Error('no merge rule for a value while seeding — MERGE_PLAN is incomplete')
}

const seeded = {}
for (const [key, rule] of Object.entries(MERGE_PLAN)) {
  if (!(key in source)) throw new Error(`CAPEX's document has no "${key}", which MERGE_PLAN declares`)
  seeded[key] = seedValue(rule, source[key])
}

/* ---------------- the same identity-vs-vocabulary overrides seed-dataset.js makes ---------------- */

const TARGET = 'RISK'

seeded.whatif = {
  ...seeded.whatif,
  facility: {
    id: `FAC:${TARGET}-UNSET`,
    name: `${TARGET} — no facility configured`,
    role: `This dataset has no facility yet. Populate ${TARGET}/db.json to set one.`,
    baseline: {},
    appetite: {},
  },
  transporters: [],
  generators: [],
  candidate_pools: [],
  resolvable: [],
}

seeded.reports = {
  ...seeded.reports,
  meta: {
    ...(source.reports?.meta ?? {}),
    persona_name: '—',
    persona_role: `${TARGET} · no persona configured`,
    persona_initials: TARGET.slice(0, 2).toUpperCase(),
    entity_plural: 'rows',
    scope_line: `the ${TARGET} dataset, which holds no rows yet`,
    source_trace: `Traces to: nothing yet — ${TARGET}/db.json has not been populated.`,
  },
}

seeded.audit = { ...seeded.audit, stats: [], events: [], policies: [], policy_total: 0 }
seeded.traces = { ...seeded.traces, stats: [], items: [] }
seeded.evals = { ...seeded.evals, stats: [], runs: [], checks: [] }

seeded.graph_studio = {
  ...seeded.graph_studio,
  review_items: [],
  sanity_checks: [],
  canvas: { ...(seeded.graph_studio.canvas ?? {}), nodes: [], edges: [] },
  pivot: {},
  generated: {
    must_review_total: 0,
    confirmed_total: 0,
    auto_approved_total: 0,
    spot_check_quota: 0,
    sample_size: 0,
    subjects: [],
    predicates: [],
  },
}

/* ---------------- refuse to write something that cannot be served ---------------- */

const problems = []
for (const key of Object.keys(MERGE_PLAN)) {
  if (!(key in seeded)) problems.push(`"${key}" is missing`)
}
for (const [key, rule] of Object.entries(MERGE_PLAN)) {
  const value = seeded[key]
  if (rule && typeof rule === 'object' && 'union' in rule && !Array.isArray(value)) {
    problems.push(`"${key}" should have been emptied to an array`)
  }
  if (rule === 'keyed' && (value === null || typeof value !== 'object')) {
    problems.push(`"${key}" should have been emptied to an object`)
  }
}
if (problems.length > 0) {
  console.error(`refusing to write — the seeded document is malformed:\n  · ${problems.join('\n  · ')}`)
  process.exitCode = 1
  process.exit()
}

/* ---------------- write split, the same key -> file mapping writeSplitFiles uses ---------------- */

const FILES = [
  ['risk_sources.json', ['projects', 'credentials', 'column_profiles', 'column_vocabulary', 'drives', 'drive_credentials', 'document_extractions', 'mail_corpus', 'registered']],
  ['risk_catalogue.json', ['document_vocabulary', 'data_model', 'change_signals', '_meta', '_provenance']],
  ['risk_new_graph.json', ['graph_domains', 'graph_personas', 'graph_hero_questions', 'graph_use_cases', 'graph_use_case_templates', 'graph_metrics', 'graph_answer_formats', 'graph_kpis']],
  ['risk_graph_studio.json', ['graph_studio', 'studio_graph']],
  ['risk_reports.json', ['reports', 'reports_prototype', 'report_defaults', 'report_permissions']],
  ['risk_ask.json', ['ask_answers']],
  ['risk_whatif.json', ['whatif']],
  ['risk_audit_governance.json', ['audit', 'traces', 'evals']],
  ['risk_new_role.json', ['new_role', 'document_readings']],
  ['risk_goals.json', ['goals']],
  ['risk_submissions.json', ['submissions']],
]
const SHARED = ['settings', 'auth_roles', 'google_account']

const report = []
for (const [file, keys] of FILES) {
  const next = {}
  for (const key of keys) if (key in seeded) next[key] = seeded[key]
  writeJson(join(out, file), next)
  report.push(`${file}: ${Object.keys(next).join(', ')}`)
}

const covered = new Set([...FILES.flatMap(([, keys]) => keys), ...SHARED])
const problems2 = []
for (const key of Object.keys(seeded)) {
  if (!covered.has(key)) problems2.push(`"${key}" has no split file and was not written anywhere`)
}

console.log(report.join('\n'))
console.log(`\nwrote backend/risk/*.json (${FILES.length} files) — all empty except the keys CAPEX's MERGE_PLAN marks "primary"`)
if (problems2.length) {
  console.error(`\n${problems2.length} problem(s):\n- ${problems2.join('\n- ')}`)
  process.exitCode = 1
}
