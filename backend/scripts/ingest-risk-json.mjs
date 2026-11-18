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
  /*
   * `whatif` is `primary` in MERGE_PLAN — "one facility, one appetite line... a merged frame is not
   * a frame" — so `seedValue` carries the whole object, `document` included. `seed-dataset.js`'s own
   * override list above does not clear it, which is a latent gap in that script: CAPEX's real
   * rendered lens (`W1_what_if_lens.html`, "What-if — Veolia CapEx") would otherwise show up under
   * RISK's name. The real per-package ingests already know to null this —
   * `ingest-arcwood-json.mjs` sets `whatif.document = null` for the identical reason, "CAPEX's
   * structure, rows emptied, no framed document" — so this follows that precedent rather than
   * seed-dataset.js's. With no document, the What-if page falls back to the *computed* lens, over
   * the facility/generators/candidate_pools just emptied above — "nothing to compare", not CAPEX's.
   */
  document: null,
}

/*
 * `new_role`/`document_readings` are `primary` too, and **this one is read** — `GET /role-library`
 * serves it straight to `hydrateRoleLibrary`, unlike `goals`/`submissions` below. Carried whole it
 * would hand RISK's New Role wizard CAPEX's own 4 roles under CAPEX's own `_meta`
 * (`package: "veolia_capex_demo_data_package_…"`, `dataset: "NORTHLINE"`) — a package RISK never
 * shipped, stated as if it had. Nulled instead: `hydrateRoleLibrary` already "ignores rather than
 * half-applies" a missing library, falling back to the bundled default role list (which happens to
 * be the same four generic roles) — so the wizard looks identical, minus the false provenance claim.
 */
seeded.new_role = null
seeded.document_readings = null

/*
 * `goals`/`submissions` are `primary` and **confirmed unread anywhere in server.js** — vestigial,
 * the same waiting-for-a-caller state `/change-signals` is in. That made them low *risk*, never
 * low *honesty*: carried whole they are 700+ KB each of CAPEX's own real goal journeys, chat
 * transcripts and submission templates sitting in RISK's own files under RISK's own name — found
 * by inspecting the file directly, which "nothing reads it" does not protect against. Nulled for
 * the same reason `_meta`/`_provenance` were: the moment anyone reads the file, a `null` reads as
 * "RISK has none yet," which is true, and CAPEX's content does not.
 */
seeded.goals = null
seeded.submissions = null

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
  /*
   * `authoring_document` is `primary` and, unlike `whatif`/`studio_graph`, a dataset that ships a
   * real package genuinely has its own — Arcwood's is "report_authoring_simplified_v3.html" too,
   * but *its own* `governance.document` names Ironbridge, a different roster_total, a different
   * file. RISK ships no such package at all, so CAPEX's value is not "the same artifact RISK also
   * has" — it is the one case this key's own MERGE_PLAN comment already names: "EPA has none, which
   * is why `both` shows no authoring document rather than CAPEX's." RISK is that case here.
   */
  authoring_document: null,
  /*
   * Same again: CAPEX's own description of its own roster ("projects", its own field list) and its
   * own 7-project authoring-preview fixture. Arcwood has its own of each (roster "generators", a
   * different fixture) because it ships a real package; RISK does not, so the MERGE_PLAN comment's
   * "EPA has neither" is RISK's answer too — low risk either way ("nothing reads them, so resolving
   * to undefined costs a description rather than a page"), but no reason to leave CAPEX's sitting
   * here misdescribing a roster RISK does not have.
   */
  register: null,
  authoring_fixture: null,
  governance: {
    ...seeded.reports.governance,
    /*
     * Same reasoning, for the **rendered** Audit & Governance screen a dataset ships instead of a
     * computed one: CAPEX's names Northline Water Group and a real `roster_total` (3768) computed
     * over CAPEX's own 60 projects. RISK has no register to compute one over, so null is the
     * documented answer for a dataset with no screen of its own — "EPA has none... both frames
     * nothing and falls back to the computed page, which is the honest answer."
     */
    document: null,
  },
}

seeded.audit = { ...seeded.audit, stats: [], events: [], policies: [], policy_total: 0 }
seeded.traces = { ...seeded.traces, stats: [], items: [] }
seeded.evals = { ...seeded.evals, stats: [], runs: [], checks: [] }

/*
 * `studio_graph` is *also* `primary` and separate from `graph_studio` above — "the graph a dataset
 * **ships**... CAPEX ships the real thing" (380 KB of its actual structured/document/bridge export).
 * `seedValue('primary', …)` carried it whole, same bug as `whatif.document`. MERGE_PLAN's own note
 * says the right value for a dataset that ships none: "EPA ships none, so `both` derives its lanes
 * exactly as it did" — null, so every lane reader falls back to deriving from RISK's own (empty)
 * `projects`/`document_extractions` instead of reading CAPEX's shipped graph.
 */
seeded.studio_graph = null

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

/*
 * `_meta`/`_provenance` are `primary` too, and MERGE_PLAN's own comment on `_meta` names exactly
 * this hazard under `both`: "claiming one package's provenance for it would be the most misleading
 * thing this key could do." A freshly-seeded RISK is not CAPEX's package's output either —
 * `seedValue` carried CAPEX's `_meta.package: "veolia_capex_demo_data_package_…"` verbatim, which
 * is that same false claim sitting in RISK's own file rather than behind a `both` merge.
 */
seeded._meta = {
  package: null,
  tenant: 'Northline Water Group',
  schema_source: `${TARGET}'s structure is CAPEX's, emptied — see ingest-risk-json.mjs`,
  generated_by: 'backend/scripts/ingest-risk-json.mjs',
  note: `${TARGET} ships no package of its own. Re-run ingest-risk-json.mjs to regenerate.`,
}
seeded._provenance = {}

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
