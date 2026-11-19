/**
 * Writes `data_model.suggestions` into `backend/risk/risk_catalogue.json`, from the Contract Risk
 * Analyst package's own scorecard signals (`Contract_risk_analyst/json/07_scorecard/signals.json`).
 *
 *   node backend/scripts/ingest-risk-data-model.mjs   (run AFTER ingest-risk-column-profiles.mjs)
 *
 * **Why the Data Modeling canvas showed 24 orphan tables and 0 relations.** The automatic suggester
 * (`dataModelSuggestions` in `server.js`) only proposes a join where a shared column is classed
 * `identifier` on at least one side — and RISK's 23 non-`master.contract` tables each carry exactly
 * one declared column (the single scorecard signal that reads them), none of them an identifier.
 * That is an honest zero: the package never ships a schema, so there is no foreign key anywhere to
 * find. It is not the only real evidence of a relationship this package carries, though.
 *
 * **A signal that reads two tables for one figure *is* evidence of a relationship, and it is the
 * package's own.** `signals.json`'s `source.name` sometimes names two `schema.table` identifiers
 * joined with " · " — "one real measure, computed by reading both tables together." Six such
 * signals exist (two of them on the same table pair), naming five real pairs:
 *
 *   - os1/os2 — `ehs.incident` · `ops.hours` (lost-time and recordable injury rates)
 *   - os3     — `ehs.observation` · `hr.roster` (observations per employee)
 *   - en2     — `plantdata.sample_schedule` · `plantdata.results` (missed required samples)
 *   - st6     — `hr.license` · `ops.labor_weekly` (licence holders and their hours)
 *   - im1     — `master.contract` · `fin.contract_pnl` (annual contract revenue)
 *
 * **Four of the five share the identical declared column id on both sides**, because
 * `ingest-risk-column-profiles.mjs` names a signal-derived column after the signal itself — so a
 * compound signal registers the same column id on both tables it reads (`lost_time_injuries` on
 * both `ehs.incident` and `ops.hours`, for instance). `im1` is the exception: `master.contract`'s
 * columns are `contracts.json`'s own real field names (`revenue_a_year`), not signal-derived, so the
 * join is stated across two differently-spelled columns that the same signal names as reading one
 * figure — `revenue_a_year` and `annual_contract_revenue` — rather than a shared id.
 *
 * **The cardinality is a stated inference, not a measurement, and the rationale says so.** Nothing
 * here samples a row — every one of these ten tables is declared, never profiled — so there is no
 * distinct count to derive `1:1`/`1:N`/`N:1`/`N:N` from the way the automatic suggester does. What
 * *is* real is each table's own stated `grain` (written by `ingest-risk-structured.mjs` from
 * `signals.json`'s own `data_sits_at`): every table on both sides of all five pairs is declared "one
 * row per facility/project/profit center" — the same real-world unit on both sides — which is the
 * grain-consistent reading and the one recorded here (`1:1`), stated as inferred rather than
 * measured. A reviewer who samples the real tables may find otherwise; that is what Confirm is for.
 *
 * Refuses to write a suggestion naming a table or column `risk_sources.json`'s `column_profiles`
 * does not carry.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const backend = join(here, '..')
const pkg = join(backend, '..', 'Contract_risk_analyst', 'json')
const sourcesPath = join(backend, 'risk', 'risk_sources.json')
const out = join(backend, 'risk', 'risk_catalogue.json')

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

const signals = readJson(join(pkg, '07_scorecard', 'signals.json'))
const { column_profiles: columnProfiles, projects } = readJson(sourcesPath)

const tableKeys = new Set(
  projects.flatMap((p) => p.datasets.flatMap((d) => d.tables.map((t) => `${d.dataset_id}.${t.table_id}`))),
)

/* Every id this package's own compound signals name — checked against the real column_profiles at
   write time rather than typed, so a rename upstream fails this script instead of reaching a reader
   who presses Confirm on a join that does not exist. */
const SUGGESTIONS = [
  {
    suggestion_id: 'sg_risk_incident_hours_ltif',
    from: 'ehs.incident',
    from_column: 'lost_time_injuries',
    to: 'ops.hours',
    to_column: 'lost_time_injuries',
    relationship_type: 'MEASURED_AGAINST_HOURS_WORKED',
    relationship_type_alternatives: ['HAS_HOURS_DENOMINATOR', 'LTIF_PAIR'],
    cardinality_hint: '1:1',
    confidence: 0.65,
    rationale:
      "Signal os1 (\"Lost-time injuries\") reads this exact column from both tables to compute one " +
      "rate per 200,000 hours — the package states the two tables together, not a shared key. Both " +
      "are declared one row per facility, which is the grain-consistent reading (1:1); neither side " +
      "has been sampled, so treat this as a starting point to confirm rather than a measured fact.",
  },
  {
    suggestion_id: 'sg_risk_incident_hours_recordable',
    from: 'ehs.incident',
    from_column: 'recordable_injuries',
    to: 'ops.hours',
    to_column: 'recordable_injuries',
    relationship_type: 'MEASURED_AGAINST_HOURS_WORKED',
    relationship_type_alternatives: ['HAS_HOURS_DENOMINATOR', 'RECORDABLE_RATE_PAIR'],
    cardinality_hint: '1:1',
    confidence: 0.65,
    rationale:
      "Signal os2 (\"Recordable injuries\") reads this same column from both tables for the same " +
      "reason os1 does, one row apart in the scorecard rather than a second, independent join. Both " +
      "tables are declared one row per facility; not sampled, so confirm before relying on 1:1.",
  },
  {
    suggestion_id: 'sg_risk_observation_roster',
    from: 'ehs.observation',
    from_column: 'safety_observations_per_employee',
    to: 'hr.roster',
    to_column: 'safety_observations_per_employee',
    relationship_type: 'OBSERVATIONS_PER_ROSTER_HEADCOUNT',
    relationship_type_alternatives: ['HAS_ROSTER_DENOMINATOR', 'RATE_PAIR'],
    cardinality_hint: '1:1',
    confidence: 0.6,
    rationale:
      "Signal os3 divides a facility's observation count by its roster headcount, so the package " +
      "names both tables for one figure. Both are declared one row per facility (hr.roster's own " +
      "grain is \"one row per project or facility\"), which is the grain-consistent 1:1 reading — " +
      "inferred from the stated grain, not from a sampled row count on either side.",
  },
  {
    suggestion_id: 'sg_risk_sample_schedule_results',
    from: 'plantdata.sample_schedule',
    from_column: 'required_samples_missed',
    to: 'plantdata.results',
    to_column: 'required_samples_missed',
    relationship_type: 'SCHEDULED_SAMPLE_HAS_RESULT',
    relationship_type_alternatives: ['MISSED_IF_NO_RESULT_BY_DUE_DATE', 'SCHEDULE_RESULT_PAIR'],
    cardinality_hint: '1:1',
    confidence: 0.6,
    rationale:
      "Signal en2 (\"Required samples missed\") is a schedule checked against whether a result landed " +
      "by its due date — the package states both tables for this one figure. Both are declared one " +
      "row per facility, the grain-consistent reading; a real sample-level join (one schedule row to " +
      "many result attempts) is plausible and would make this N:1 once somebody samples the tables.",
  },
  {
    suggestion_id: 'sg_risk_license_labor',
    from: 'hr.license',
    from_column: 'key_person_dependence',
    to: 'ops.labor_weekly',
    to_column: 'key_person_dependence',
    relationship_type: 'LICENCE_HOLDER_HOURS',
    relationship_type_alternatives: ['HAS_LABOR_RECORD', 'KEY_PERSON_PAIR'],
    cardinality_hint: '1:1',
    confidence: 0.55,
    rationale:
      "Signal st6 names a licence holder's hours by reading both tables together. Both are declared " +
      "one row per project, the grain-consistent reading — but a licence table plausibly carries one " +
      "row per holder and labor_weekly one row per employee per week, which would make this N:N once " +
      "sampled; recorded as 1:1 only because that is what the stated grain supports today.",
  },
  {
    suggestion_id: 'sg_risk_contract_pnl_revenue',
    from: 'master.contract',
    from_column: 'revenue_a_year',
    to: 'fin.contract_pnl',
    to_column: 'annual_contract_revenue',
    relationship_type: 'HAS_PNL_REVENUE',
    relationship_type_alternatives: ['BOOKED_UNDER_PROFIT_CENTER', 'CONTRACT_PNL_PAIR'],
    cardinality_hint: '1:1',
    confidence: 0.6,
    rationale:
      "Signal im1 (\"Annual contract revenue\") reads contracts.json's own revenue_a_year and " +
      "fin.contract_pnl's annual_contract_revenue as the same real figure, fee billed over the last " +
      "twelve months — two differently-spelled columns for one measure rather than a shared id. " +
      "master.contract.id and .profit_center are real identifiers; contract_pnl is declared one row " +
      "per profit center, the same unit a contract's own profit_center names, which is the " +
      "grain-consistent 1:1 reading rather than a sampled one.",
  },
]

const problems = []
for (const s of SUGGESTIONS) {
  for (const [side, key, column] of [
    ['from', s.from, s.from_column],
    ['to', s.to, s.to_column],
  ]) {
    if (!tableKeys.has(key)) {
      problems.push(`${s.suggestion_id}: names ${side} table "${key}", which risk_sources.json's projects do not carry`)
      continue
    }
    const profiled = columnProfiles[key]
    if (!Array.isArray(profiled) || !profiled.some((c) => c.column_id === column)) {
      problems.push(`${s.suggestion_id}: joins on ${key}.${column}, which that table's column_profiles entry does not carry`)
    }
  }
  if (s.from === s.to && s.from_column === s.to_column) {
    problems.push(`${s.suggestion_id}: joins a column to itself`)
  }
}

/* Confirms every compound (two-table) signal in the package is accounted for — a sixth one added
   upstream and not reflected here would silently leave a real relationship undeclared. */
const TABLE_RE = /^([a-z0-9_]+)\.([a-z0-9_]+)$/i
const compoundSignalIds = new Set()
for (const sig of signals) {
  if (sig.source?.kind !== 'table') continue
  const names = String(sig.source.name).split(' · ').map((n) => n.trim())
  if (names.filter((n) => TABLE_RE.test(n)).length >= 2) compoundSignalIds.add(sig.id)
}
const covered = new Set(['os1', 'os2', 'os3', 'en2', 'st6', 'im1'])
for (const id of compoundSignalIds) {
  if (!covered.has(id)) problems.push(`signals.json now has a compound-table signal "${id}" this script does not account for`)
}
for (const id of covered) {
  if (!compoundSignalIds.has(id)) problems.push(`this script names signal "${id}" as compound, but signals.json no longer does`)
}

if (problems.length > 0) {
  console.error(`refusing to write — ${problems.length} problem(s):\n  · ${problems.join('\n  · ')}`)
  process.exitCode = 1
  process.exit()
}

const existing = readJson(out)
existing.data_model = {
  ...existing.data_model,
  entities: existing.data_model?.entities ?? [],
  suggestions: SUGGESTIONS.map(
    ({ suggestion_id, from, from_column, to, to_column, relationship_type, relationship_type_alternatives, cardinality_hint, confidence, rationale }) => ({
      suggestion_id,
      from_table_key: from,
      from_column,
      to_table_key: to,
      to_column,
      relationship_type,
      relationship_type_alternatives,
      cardinality_hint,
      rationale,
      confidence,
    }),
  ),
}
writeFileSync(out, `${JSON.stringify(existing, null, 2)}\n`, 'utf8')

const touched = new Set(SUGGESTIONS.flatMap((s) => [s.from, s.to]))
console.log(
  `wrote ${SUGGESTIONS.length} data_model.suggestions into backend/risk/risk_catalogue.json, ` +
    `touching ${touched.size} of 24 real tables (${24 - touched.size} remain orphans — honestly, ` +
    `since the package names no evidence connecting them to anything)`,
)
