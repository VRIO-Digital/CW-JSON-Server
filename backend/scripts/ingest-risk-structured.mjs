/**
 * Writes `projects` and `credentials` into `backend/risk/risk_sources.json`, from the Contract
 * Risk Analyst package's own real structured source
 * (`Contract_risk_analyst/json/05_sources_and_catalog/sources.json` and
 * `Contract_risk_analyst/json/07_scorecard/signals.json`).
 *
 *   node backend/scripts/ingest-risk-structured.mjs
 *
 * **The real source is named, and this had been missed.** `sources.json`'s own `connected` list
 * states "Operations data hub (214 tables)" as a system this tenant has — a real structured
 * source, which `risk_sources.json` left as `projects: []`, reading as "Sources: 0" in Settings'
 * Dataset table. That is wrong the same way leaving `whatif.document` as CAPEX's would have been
 * wrong the other way: the source exists and is named; the earlier claim that RISK "ships no
 * structured source" was made before this file had been read.
 *
 * **The package never gives a schema — a table dictionary, a column list, a row count.** What it
 * gives is which real tables the scorecard reads and, in `signals.json`'s own `source.how`, a
 * sentence per signal stating *what is computed from that table* ("Average receivables over
 * revenue, times the days in the period" for `fin.ar_aging`; "Weighted age of the critical
 * assets" for `asset.register`). That sentence is quoted verbatim as the table's `label` — joined
 * with `; ` where more than one signal reads the same table under a different computation — rather
 * than a description invented for it. **`grain` is built the same way**: `signals.json`'s own
 * `data_sits_at` ("Facility", "Profit center", "State", …) states the real level a measure is
 * reported at, which is what a grain states; "one row per facility" is that field restated as the
 * sentence the app's grain fields are written in, not a guess at what the table holds.
 *
 * **24 real tables, not 214.** `sources.json`'s `used_by_the_scorecard` names every table a signal
 * actually reads; several entries are two tables joined with " · " (`"ehs.incident · ops.hours"`)
 * because one signal reads both, and those are split into their own table rows rather than kept as
 * one fused identifier nothing else in this app would resolve. A handful of entries mix a table with
 * a document or a web source (`"lab.result · state rule register (web)"`) — only the `schema.table`
 * half is a table; the other half belongs to the document or web catalogue this script does not
 * touch. The other 190 tables the hub holds are real too and are simply not named anywhere in this
 * package, so nothing here invents them.
 *
 * **Every numeric stat is `null`, same as CAPEX's own 62-of-64 tables with no profile.** Nothing
 * sampled a row or counted a column here — these are read off a signal's own description of *what*
 * it reads, never *how many rows*. `rows`, `columns`, `pii_columns` and `size_gb` are `null` rather
 * than 0, which would claim the table is empty.
 *
 * Also writes one `credentials` row for the one project — the BigQuery/Azure-SQL twin of
 * `drive_credentials`: without it, `/sources/oauth/projects` answers with `credential_handle: null`
 * (`db.credentials.find(...)` finds nothing for a dataset with none) and the connect wizard's
 * pre-selected project carries an empty handle, exactly the bug `drive_credentials` had.
 *
 * Refuses to write if a signal names a table this script cannot parse into `schema.table`.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const backend = join(here, '..')
const pkg = join(backend, '..', 'Contract_risk_analyst', 'json')
const out = join(backend, 'risk', 'risk_sources.json')

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

const signals = readJson(join(pkg, '07_scorecard', 'signals.json'))

const TABLE_RE = /^([a-z0-9_]+)\.([a-z0-9_]+)$/i

/** schema.table -> { hows: Set<string>, sitsAt: Set<string> } */
const tables = new Map()

const problems = []

for (const s of signals) {
  if (s.source?.kind !== 'table') continue
  const names = String(s.source.name).split(' · ').map((n) => n.trim())
  const real = names.filter((n) => TABLE_RE.test(n))
  if (real.length === 0) {
    problems.push(`${s.id}: table-kind signal names no schema.table identifier ("${s.source.name}")`)
    continue
  }
  for (const name of real) {
    if (!tables.has(name)) tables.set(name, { hows: new Set(), sitsAt: new Set() })
    const entry = tables.get(name)
    if (s.source.how) entry.hows.add(s.source.how)
    if (s.data_sits_at) entry.sitsAt.add(s.data_sits_at)
  }
}

if (problems.length > 0) {
  console.error(`refusing to write — ${problems.length} problem(s):\n  · ${problems.join('\n  · ')}`)
  process.exitCode = 1
  process.exit()
}

/** schema -> [{ table_id, label, grain, ... }] */
const bySchema = new Map()

for (const [full, { hows, sitsAt }] of tables) {
  const [, schema, table] = full.match(TABLE_RE)
  if (!bySchema.has(schema)) bySchema.set(schema, [])
  bySchema.get(schema).push({
    table_id: table,
    label: [...hows].join('; '),
    type: 'TABLE',
    grain: `one row per ${[...sitsAt].map((s) => s.toLowerCase()).join(' or ')}`,
    rows: null,
    columns: null,
    pii_columns: null,
    size_gb: null,
    partitioned: false,
    profiled_in_full: false,
    rows_basis: 'not stated by the source — table name and the measures read from it only',
  })
}

const PROJECT_ID = 'risk-operations-data-hub'

/*
 * Not `null`: `GcpProject.location` (the oauth discovery payload) and `PreviewDataset.location`
 * (step 3's preview reply) are both `location: str` in client.ts, never nullable — so a `null` here
 * passes `validateDb` on the server and then fails the browser's own schema check on the very next
 * read, which the wizard's catch renders as "read-only access to 0 server(s)": not an error toast,
 * just an empty discovery because `listOauthProjects` threw before `setProjects` ever ran. The
 * honest content is still "no location is stated" — put in words, the same move `rows_basis` makes
 * two lines up, rather than invented as a plausible region.
 */
const NOT_STATED = 'not stated by the source'

const project = {
  project_id: PROJECT_ID,
  display_name: 'Operations data hub',
  location: NOT_STATED,
  datasets: [...bySchema.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([schema, tableRows]) => ({
      dataset_id: schema,
      dataset_ref: `ds_${schema}`,
      location: NOT_STATED,
      description:
        `Real tables the contract risk scorecard reads under the ${schema} schema of the ` +
        `tenant's operations data hub. The package never ships a column-level profile, so this ` +
        `dataset carries table names and what each is read for, not a sampled schema.`,
      semantic_layer: null,
      as_of: null,
      freshness: null,
      tables: tableRows.sort((a, b) => a.table_id.localeCompare(b.table_id)),
    })),
}

const handleFor = (id) => `project-handle-${createHash('sha256').update(id).digest('hex').slice(0, 8)}`

const existing = readJson(out)
existing.projects = [project]
existing.credentials = [{ project_id: PROJECT_ID, credential_handle: handleFor(PROJECT_ID) }]
writeFileSync(out, `${JSON.stringify(existing, null, 2)}\n`, 'utf8')

const tableCount = [...bySchema.values()].reduce((n, l) => n + l.length, 0)
console.log(
  `wrote 1 project (${bySchema.size} dataset(s)/schemas, ${tableCount} real table(s)) into backend/risk/risk_sources.json`,
)
