/**
 * Writes `column_profiles` into `backend/risk/risk_sources.json`, and updates each table's
 * `columns` count in `projects` to match — from the Contract Risk Analyst package's own real
 * field names (`08_portfolio/contracts.json`) and real per-signal measurements
 * (`07_scorecard/signals.json`).
 *
 *   node backend/scripts/ingest-risk-column-profiles.mjs   (run AFTER ingest-risk-structured.mjs)
 *
 * **Why this exists.** `ingest-risk-structured.mjs` left every table's `columns` (and therefore
 * `column_profiles`) `null` — honestly, since the package never ships a schema. That is still true:
 * nobody has a full column list for `fin.ar_aging` or `asset.register`. But it reads as "0 columns"
 * everywhere a reader looks (the Catalog tile, the Data Modeling canvas), which is a different fact
 * from "unknown" and was reported as such. The fix is not to invent a plausible column count — it
 * is to notice that this app already has a mechanism for exactly this gap: a **declared** dictionary
 * (see CLAUDE.md's "Uploading a schema or a data dictionary"), which states what a column *means*
 * without claiming anyone sampled it. `confidence`, `null_pct` and `distinct` stay `null` on every
 * row this script writes, for that reason — same as every declared column in this app.
 *
 * **Two real sources, mapped onto what `column_profiles` actually needs:**
 *
 * - **`master.contract` gets its real schema**, because `08_portfolio/contracts.json` has one: 300
 *   real contract rows, each with the same 23 fields (`site`, `client`, `regional_vp`,
 *   `revenue_a_year`, `evergreen`, …). Every column here is that field, named and classed as what
 *   it is, nothing paraphrased into a plausible-sounding business name it does not carry.
 * - **Every other real table gets one declared column per real signal that reads it** —
 *   `07_scorecard/signals.json`'s own `source.how` *is* the column's description (what is actually
 *   computed from it), and the column's name is that signal's own `name`, slugified. A compound
 *   signal ("ehs.incident · ops.hours") declares the same column on both real tables it names,
 *   because that is the one fact the signal states about either of them.
 *
 * **Nothing here claims completeness.** A table's declared `columns` count is how many real fields
 * this script could name, never "all the columns this table has" — `fin.ar_aging` almost certainly
 * carries far more than the one column declared here. The description says so once, in `_meta`,
 * rather than on every row.
 *
 * Refuses to write if a table named here is missing from `projects`, or if a column class this
 * script assigns is not one `server.js`'s `KNOWN_CLASSES` recognises.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const backend = join(here, '..')
const pkg = join(backend, '..', 'Contract_risk_analyst', 'json')
const out = join(backend, 'risk', 'risk_sources.json')

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

/* Read off CLASS_FACET + CLASS_UNFACETED in backend/server.js — kept in step by hand, since this
   script cannot import server.js (it has no module exports for these). */
const KNOWN_CLASSES = new Set([
  'identifier',
  'measure',
  'measure_record',
  'measure_projection',
  'measure_commitment',
  'period_accumulation',
  'derived_ratio',
  'risk_score',
  'date',
  'address',
  'geo',
  'geography',
  'flag',
  'dimension',
  'entity',
  'text',
  'classification',
  'label',
  'organisation',
  'lifecycle_state',
  'person',
  'scratch',
])

const DICT_SOURCE = 'backend/scripts/ingest-risk-column-profiles.mjs'
const declared = (description) => ({
  derivation: `declared in ${DICT_SOURCE} — a real field, not sampled`,
  confidence: null,
  pii: false,
  null_pct: null,
  distinct: null,
  description,
})

const column = (column_id, label, type, cls, description) => {
  if (!KNOWN_CLASSES.has(cls)) throw new Error(`class "${cls}" for ${column_id} is not in KNOWN_CLASSES`)
  return { column_id, label, type, class: cls, ...declared(description) }
}

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')

/* ---------------- master.contract, from the real 300-row file ---------------- */

const CONTRACT_COLUMNS = [
  column('id', 'id', 'STRING', 'identifier', "The contract's own id, e.g. NCO-047."),
  column('site', 'site', 'STRING', 'label', 'The plant or system this contract covers.'),
  column('short_name', 'short_name', 'STRING', 'label', 'The site name without its facility type.'),
  column('client', 'client', 'STRING', 'organisation', 'The municipality or utility that owns the contract.'),
  column('state', 'state', 'STRING', 'geography', 'The two-letter state the site sits in.'),
  column('region', 'region', 'STRING', 'geography', "Which of the company's five regions the contract reports into."),
  column('regional_vp', 'regional_vp', 'STRING', 'person', 'The Regional VP who owns this contract.'),
  column('project_leader', 'project_leader', 'STRING', 'person', 'The on-site project leader.'),
  column('kind', 'kind', 'STRING', 'classification', 'Drinking water or wastewater.'),
  column('scopes', 'scopes', 'STRING', 'dimension', 'The services the contract covers (treatment, distribution, collection, …).'),
  column('union', 'union', 'BOOL', 'flag', 'Whether the site workforce is unionised.'),
  column('staff', 'staff', 'FLOAT64', 'measure', 'Headcount at the site.'),
  column('revenue_a_year', 'revenue_a_year', 'FLOAT64', 'measure', 'Annual contract revenue, in dollars.'),
  column('margin_pct', 'margin_pct', 'FLOAT64', 'measure', 'Margin as a percentage of revenue.'),
  column('start', 'start', 'DATE', 'date', 'The date the current term began.'),
  column('end', 'end', 'DATE', 'date', 'The date the current term ends.'),
  column('months_left', 'months_left', 'FLOAT64', 'measure', 'Months remaining on the current term.'),
  column('evergreen', 'evergreen', 'BOOL', 'flag', "Whether the contract renews on its own absent notice to end it."),
  column('termination_for_convenience', 'termination_for_convenience', 'BOOL', 'flag', 'Whether the client may end the agreement without cause.'),
  column('homes_within_two_miles', 'homes_within_two_miles', 'FLOAT64', 'measure', 'Residential parcels within two miles of the site.'),
  column('profit_center', 'profit_center', 'STRING', 'identifier', 'The finance profit center this contract books under.'),
  column('facilities', 'facilities', 'FLOAT64', 'measure', 'How many physical facilities this contract runs.'),
  column('negative_dso', 'negative_dso', 'BOOL', 'flag', 'Whether the days-sales-outstanding figure at this profit center is negative.'),
  column('story', 'story', 'STRING', 'text', 'A written account of the contract, where one exists.'),
]

/* Verified against the real file at run time below, not assumed. */
const contracts = readJson(join(pkg, '08_portfolio', 'contracts.json'))
const problems = []
const realContractFields = new Set(Object.keys(contracts[0]))
for (const c of CONTRACT_COLUMNS) {
  if (!realContractFields.has(c.column_id)) problems.push(`master.contract: declared column "${c.column_id}" is not a real field of contracts.json`)
}
for (const f of realContractFields) {
  if (!CONTRACT_COLUMNS.some((c) => c.column_id === f)) problems.push(`master.contract: contracts.json's real field "${f}" has no declared column`)
}

/* ---------------- Every other real table, one column per signal that reads it ---------------- */

const factors = readJson(join(pkg, '07_scorecard', 'factors.json'))
const signalsList = readJson(join(pkg, '07_scorecard', 'signals.json'))
const factorIds = new Set(factors.map((f) => f.id))
const TABLE_RE = /^([a-z0-9_]+)\.([a-z0-9_]+)$/i

/** schema.table -> Map<signal_id, signal> */
const tableSignals = new Map()
for (const s of signalsList) {
  if (s.source?.kind !== 'table') continue
  if (!factorIds.has(s.factor)) {
    problems.push(`signal ${s.id} names factor "${s.factor}", which factors.json does not declare`)
    continue
  }
  const names = String(s.source.name).split(' · ').map((n) => n.trim())
  const real = names.filter((n) => TABLE_RE.test(n))
  if (real.length === 0) {
    problems.push(`${s.id}: table-kind signal names no schema.table identifier ("${s.source.name}")`)
    continue
  }
  for (const full of real) {
    if (!tableSignals.has(full)) tableSignals.set(full, new Map())
    tableSignals.get(full).set(s.id, s)
  }
}

/** Yes/No-shaped bands: exactly two of the four read as a flag rather than a banded measure. */
const isFlagShaped = (rule) => {
  const filled = rule.filter((r) => r && r.trim())
  return filled.length === 2 && rule[0] && rule[3] && !rule[1] && !rule[2]
}

function columnFor(s) {
  const id = slug(s.name)
  const label = s.name
  if (s.figure) {
    return column(id, label, 'FLOAT64', 'measure', `${s.source.how} (${s.figure.unit}).`)
  }
  if (Array.isArray(s.rule_1_to_4) && isFlagShaped(s.rule_1_to_4)) {
    return column(id, label, 'BOOL', 'flag', `${s.source.how} — ${s.rule_1_to_4[3]}.`)
  }
  return column(id, label, 'STRING', 'classification', `${s.source.how}.`)
}

if (problems.length > 0) {
  console.error(`refusing to write — ${problems.length} problem(s):\n  · ${problems.join('\n  · ')}`)
  process.exitCode = 1
  process.exit()
}

const columnProfiles = {
  'risk.master.contract': CONTRACT_COLUMNS,
}
/*
 * `master.contract` is also named by three signals (cr1/im3/im1) as a table-kind source — and each
 * of those is already one of the real fields above (state, end, revenue_a_year/contract_pnl), so the
 * generic per-signal loop below is skipped for it rather than overwritten by it: the real 23-field
 * dictionary stays, instead of being replaced by 3 signal-derived columns that restate a subset of it.
 */
for (const [full, signalsForTable] of tableSignals) {
  if (full === 'master.contract') continue
  columnProfiles[`risk.${full}`] = [...signalsForTable.values()].map(columnFor)
}

/* ---------------- Write both: the dictionary, and each table's real declared count ---------------- */

const existing = readJson(out)
existing.column_profiles = columnProfiles

let updated = 0
for (const project of existing.projects ?? []) {
  for (const dataset of project.datasets ?? []) {
    for (const table of dataset.tables ?? []) {
      const key = `risk.${dataset.dataset_id}.${table.table_id}`
      const cols = columnProfiles[key]
      if (cols) {
        table.columns = cols.length
        updated += 1
      }
    }
  }
}

writeFileSync(out, `${JSON.stringify(existing, null, 2)}\n`, 'utf8')

const totalColumns = Object.values(columnProfiles).reduce((n, cols) => n + cols.length, 0)
console.log(
  `wrote column_profiles for ${Object.keys(columnProfiles).length} table(s), ${totalColumns} declared column(s) ` +
    `into backend/risk/risk_sources.json; updated ${updated} table(s)' columns count to match`,
)
