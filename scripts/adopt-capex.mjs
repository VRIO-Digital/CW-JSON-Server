/*
 * Turns the CAPEX demo package's document into the one this server serves.
 *
 *     npm run adopt:capex
 *
 * **Why a script rather than a hand-edited `db.json`.** `capex/db.json` is generated
 * (`_build/build_db.py`, per its own `_meta.note`: *"Never hand-edit this file — change the
 * generator and rebuild"*), and this repo already holds that rule for `db.json` itself: re-run the
 * ingest rather than editing 189 nodes by hand. So the repairs below live here, where they can be
 * read and re-run, instead of being baked once into a 1.1 MB file nobody can diff.
 *
 * It writes a file and only a file, like every other seed here, so the flow is: adopt, check the
 * diff, `npm run db:push`.
 *
 * **What it repairs, and why each one is a silent failure rather than an error.**
 *
 * 1. `column_profiles` arrives keyed `ds_epbcs_plan.vw_project_plan_capex`, but the Catalog looks a
 *    table up as `<dataset_id>.<table_id>` — `plan.vw_project_plan_capex`. Every key missed, so
 *    `tableDictionary` would fall through to `synthesiseColumns` for all of them: 194 real profiled
 *    columns quietly replaced by hashed ones, which is the failure CLAUDE.md names as the worst kind
 *    of wrong. Re-keyed by matching the table against the dataset ids `db.projects` really has, so
 *    an unresolvable key is a refusal rather than a guess.
 *
 * 2. `document_extractions` arrives keyed `ex_0001…ex_0423`, but `documentDictionary` looks a
 *    document's resolution up by `document_id`. Every lookup missed, so every document would report
 *    "nothing resolved yet" — a read fact rendered as an absence. Re-keyed by the `document_id` each
 *    row already carries. The package ships several extractions per document (423 over 36), so the
 *    **highest-confidence** one wins, ties broken by `extraction_id` so two runs cannot disagree, and
 *    the number that did not become a document's headline resolution is reported rather than dropped
 *    quietly.
 *
 * 3. `reports.data.authoring_fixture` is not a roster — it is the authoring screen's own
 *    seven-project sample, and its own `_note` says so. Left inside `data` it fails `validateDb`,
 *    which requires every value there to be a non-empty array. Moved up to
 *    `reports.authoring_fixture`, where the report work reads it. `reports.data.quarters` arrives
 *    `[]` and no report definition references it, so it is dropped: an empty roster nothing reads is
 *    not data, and keeping it would fail the same rule.
 *
 * 4. `reports.governance.audit.copy.not_enforced` arrives `null`. That field is the sentence that
 *    stops the Audit page implying a filter runs, so `validateDb` checks for the phrase rather than
 *    the key. Authored here — it is the app's own statement about its own behaviour, not a figure of
 *    the tenant's.
 *
 * **And one thing it adds: `reports.register`.** Both the report section and the Audit page were
 * written against EPA's register, whose roster is `generators` and whose identity column is
 * `generator`. CAPEX's is `projects`, keyed `n`. Rather than a second hardcoded name, the document
 * now *declares* which roster is the register and what its columns are, and the server reads that —
 * so neither dataset is the one the code is written for. The rows carry their own short keys (`reg`,
 * `cat`, `bu`) with no dictionary describing them, which is what `REPORT_LABELS` already exists for;
 * the labels are authored here, beside the keys they name.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const SOURCE = new URL('../capex/db.json', import.meta.url)
const OUT = new URL('../mock-server/db.json', import.meta.url)
/* EPA's document, kept unlisted when CAPEX took over — see mock-server/datasets.mjs. */
const EPA = new URL('../mock-server/db.EPA.json', import.meta.url)

const problems = []
const notes = []

if (!existsSync(SOURCE)) {
  console.error('\nadopt:capex — capex/db.json is not in this checkout, so there is nothing to adopt.\n')
  process.exit(1)
}

const db = JSON.parse(readFileSync(SOURCE, 'utf8'))

/* ------------------------------------------------- 1. column_profiles by <dataset>.<table> */

/** Every `<dataset_id>.<table_id>` the Catalog can actually serve, from `db.projects`. */
const catalogKeys = new Set(
  (db.projects ?? []).flatMap((p) =>
    (p.datasets ?? []).flatMap((d) => (d.tables ?? []).map((t) => `${d.dataset_id}.${t.table_id}`)),
  ),
)

const rekeyedProfiles = {}
for (const [key, columns] of Object.entries(db.column_profiles ?? {})) {
  if (catalogKeys.has(key)) {
    rekeyedProfiles[key] = columns
    continue
  }
  const table = key.split('.').slice(1).join('.')
  /*
   * The package's prefix is `ds_<project suffix>_<dataset id>`, so the dataset id is its tail — but
   * it is matched against the ids that exist rather than parsed out, because a parse would happily
   * produce a key for a dataset nobody has and the Catalog would fall back to synthesis in silence.
   */
  const match = [...catalogKeys].filter((k) => k.endsWith(`.${table}`))
  if (match.length === 1) {
    rekeyedProfiles[match[0]] = columns
    notes.push(`column_profiles: "${key}" -> "${match[0]}" (${columns.length} columns)`)
  } else if (match.length > 1) {
    problems.push(
      `column_profiles "${key}": table "${table}" is on ${match.length} datasets (${match.join(', ')})`,
    )
  } else {
    /*
     * `docs.document_corpus` lands here: it is the document corpus's own column list rather than a
     * Catalog table, and nothing looks it up by that key. Kept as it arrived — `validateDb` asks
     * only that every value be a non-empty array of well-formed columns — and reported, because a
     * profile no table can reach is worth saying out loud rather than discovering later.
     */
    rekeyedProfiles[key] = columns
    notes.push(`column_profiles: "${key}" names no Catalog table — kept, nothing reads it by that key`)
  }
}
db.column_profiles = rekeyedProfiles

for (const [key, columns] of Object.entries(rekeyedProfiles)) {
  if (!Array.isArray(columns) || columns.length === 0) problems.push(`column_profiles "${key}" is empty`)
}

/* ------------------------------------------------- 2. document_extractions by document_id */

const driveDocs = new Set(
  (db.drives ?? []).flatMap((d) =>
    (d.folders ?? []).flatMap((f) => (f.documents ?? []).map((x) => x.document_id)),
  ),
)

const extractions = Object.values(db.document_extractions ?? {})
const byDocument = new Map()
for (const row of extractions) {
  if (!row.document_id) {
    problems.push(
      `document_extractions "${row.extraction_id}" carries no document_id, so nothing could look it up`,
    )
    continue
  }
  const held = byDocument.get(row.document_id)
  /* Highest confidence wins; `extraction_id` breaks a tie so two runs cannot disagree. */
  const better =
    !held ||
    row.confidence > held.confidence ||
    (row.confidence === held.confidence && String(row.extraction_id) < String(held.extraction_id))
  if (better) byDocument.set(row.document_id, row)
}

for (const id of driveDocs) {
  if (!byDocument.has(id)) {
    problems.push(`document "${id}" has no extraction, so it would report "nothing resolved yet"`)
  }
}
for (const id of byDocument.keys()) {
  if (!driveDocs.has(id)) {
    problems.push(`document_extractions names "${id}", which is not a document on any drive`)
  }
}

db.document_extractions = Object.fromEntries(byDocument)
notes.push(
  `document_extractions: ${extractions.length} rows -> ${byDocument.size} documents, keyed by ` +
    `document_id (${extractions.length - byDocument.size} further per-document extractions are not a ` +
    'headline resolution and are not carried)',
)

/* ------------------------------------------------- 3. the authoring fixture, and an empty roster */

if (db.reports?.data?.authoring_fixture) {
  db.reports.authoring_fixture = db.reports.data.authoring_fixture
  delete db.reports.data.authoring_fixture
  notes.push(
    `reports.authoring_fixture: moved out of reports.data ` +
      `(${db.reports.authoring_fixture.projects?.length ?? 0} sample projects — the authoring ` +
      'screen preview, not a roster)',
  )
}

for (const [name, rows] of Object.entries(db.reports?.data ?? {})) {
  if (!Array.isArray(rows)) {
    problems.push(`reports.data.${name} is not an array — every value there is a roster`)
    continue
  }
  if (rows.length > 0) continue
  const referenced = JSON.stringify(db.reports.reports ?? []).includes(`"${name}"`)
  if (referenced) {
    problems.push(`reports.data.${name} is empty but a report definition references it`)
  } else {
    delete db.reports.data[name]
    notes.push(`reports.data.${name}: empty and referenced by no report definition — dropped`)
  }
}

/* ------------------------------------------------- 3b. the sanity checks' placeholder edge ids */

/*
 * Four recorded sanity checks arrive naming edges `t1`…`t4`, which are not edges — the package left
 * its traversal placeholders unresolved. `validateDb` refuses them, and rightly: an id that resolves
 * to nothing fails silently at request time, because the check still reports "the graph can answer
 * this" while the canvas highlights one hop fewer than the answer claims.
 *
 * **Resolved from the canvas rather than guessed.** A recorded traversal is a *sub-graph, not a
 * chain* — CLAUDE.md says so, and sc1 is exactly that: two measures hanging off `CONCEPT:Project`
 * with no edge between them, so walking the path pairwise would find nothing for the second hop. So
 * the edges a check walks are every canvas edge with **both endpoints among its own path nodes**,
 * which for all four resolves to precisely the number of placeholders the package listed — with one
 * correction it makes on the way: sc5 named one edge for a two-hop sub-graph through
 * `VIN:fc2026_3_9`, and both hops are now listed.
 *
 * A check whose `edges_used` already resolves is left alone, including the two that legitimately walk
 * no edges: deriving those would light up hops the package never claimed.
 */
const canvasEdges = db.graph_studio?.canvas?.edges ?? []
const edgeIds = new Set(canvasEdges.map((e) => e.edge_id))

for (const check of db.graph_studio?.sanity_checks ?? []) {
  const unresolved = (check.edges_used ?? []).filter((id) => !edgeIds.has(id))
  if (unresolved.length === 0) continue

  const walked = new Set(check.path ?? [])
  const derived = canvasEdges.filter((e) => walked.has(e.from) && walked.has(e.to))
  if (derived.length === 0) {
    problems.push(
      `graph_studio.sanity_checks "${check.check_id}" names edge(s) ${unresolved.join(', ')} that the ` +
        'canvas does not have, and no canvas edge joins two nodes of its path — so there is nothing to ' +
        'resolve them to',
    )
    continue
  }
  check.edges_used = derived.map((e) => e.edge_id)
  notes.push(
    `graph_studio.sanity_checks "${check.check_id}": ${unresolved.join(', ')} -> ` +
      `${check.edges_used.join(', ')} (resolved from the ${walked.size} nodes it walks)`,
  )
}

/* ------------------------------------------------- 4. the enforcement sentence */

const NOT_ENFORCED =
  'A rule is recorded, not enforced. No report or scenario in this app filters its rows per ' +
  'persona yet, so what a reader actually opens is unchanged by anything on this page — the ' +
  'resolution below says what the rule would admit, never what somebody saw.'

/*
 * And the trail's own limit. "Opens are not in this trail" is a statement about what this server
 * *saw* — nothing here serves a report to a reader, so an "opened" row would be an event that never
 * happened. It is the app's fact rather than the tenant's, so it is **appended** to whatever note the
 * package wrote rather than replacing it: overwriting would put this repo's words in the tenant's
 * mouth, and dropping it would leave a trail implying it records more than it does.
 */
const LOG_NOTE_LIMIT =
  'Opens are not in this trail — nothing here serves a report to a reader, so an “opened” row ' +
  'would be an event that never happened.'

const auditCopy = db.reports?.governance?.audit?.copy
if (!auditCopy) {
  problems.push('reports.governance.audit.copy is missing — the Audit page would render with no copy')
} else {
  if (!/recorded, not enforced/.test(String(auditCopy.not_enforced ?? ''))) {
    auditCopy.not_enforced = NOT_ENFORCED
    notes.push('reports.governance.audit.copy.not_enforced: authored (it arrived null)')
  }
  if (!/Opens are not in this trail/.test(String(auditCopy.log_note ?? ''))) {
    const own = String(auditCopy.log_note ?? '').trim()
    auditCopy.log_note = own ? `${own} ${LOG_NOTE_LIMIT}` : LOG_NOTE_LIMIT
    notes.push("reports.governance.audit.copy.log_note: the trail's own limit appended")
  }
}

/* ------------------------------------------------- 4b. "no rule" spelled the way EPA spells it */

/*
 * A persona with no access rule is `rule: null` in EPA's document and `rule: { basis: null, values: [] }`
 * in Northline's. They mean the same thing — nothing is restricted — and unlike the row counts and
 * derivations, **this one really is only a spelling**, so it is conformed rather than widened: no
 * value is invented and none is lost.
 *
 * It matters because the client validates `basis` as a string, so the Audit page refused its whole
 * payload (`people[0].rule.basis should be a string, got null`) and rendered an error — on a page
 * whose entire subject is which rules exist. The empty object was also doing nothing: both
 * `governanceRows` and `governanceResolution` test `rule.basis` before using it.
 */
for (const scope of db.reports?.governance?.data_scope ?? []) {
  if (scope.rule && !scope.rule.basis && (scope.rule.values ?? []).length === 0) {
    scope.rule = null
    notes.push(`data_scope "${scope.role_id}": empty rule object -> null, as EPA spells it`)
  }
}

/* ------------------------------------------------- 4c. a default summary that names real tiles */

/*
 * `summary_default` arrives as `["kpis", "proj", "table"]` — which are **block kinds**, not summary
 * tile keys. The package's generator appears to have filled it from the authoring screen's default
 * *blocks* rather than from `summary_catalog`, whose keys are all `m_*`. A generated report would
 * look each one up, find nothing, and render a blank strip where its summary should be.
 *
 * Dropped rather than remapped: there is no honest mapping from a block kind to a summary tile, and
 * an empty default is a true statement about this tenant — each of its reports names its own
 * `summary_keys`. What is dropped is reported rather than silently removed.
 */
const catalogKeysAvailable = new Set((db.reports?.summary_catalog ?? []).map((t) => t.key))
const defaults = db.reports?.summary_default ?? []
const unknownDefaults = defaults.filter((k) => !catalogKeysAvailable.has(k))
if (unknownDefaults.length > 0) {
  db.reports.summary_default = defaults.filter((k) => catalogKeysAvailable.has(k))
  notes.push(
    `reports.summary_default: dropped ${unknownDefaults.join(', ')} — block kinds, not summary tile ` +
      `keys; ${db.reports.summary_default.length} left`,
  )
}

/* ------------------------------------------------- 5. which roster is the register */

/**
 * The register: the roster the report section ranks and the Audit page resolves a rule against.
 *
 * `roster` names a key of `reports.data`, `identity` the column that names a row, and `fields` the
 * dictionary for the row's own short keys. The labels are authored — the rows carry `reg`/`cat`/`bu`
 * and nothing describes them, which is the gap `REPORT_LABELS` already covers for EPA's three
 * undescribed rosters — and every *value* comes from the roster itself.
 */
const REGISTER_FIELDS = [
  { key: 'n', label: 'Project', kind: 'text', filterable: false, avail: true, note: null },
  { key: 'reg', label: 'Region', kind: 'cat', filterable: true, avail: true, note: null },
  { key: 'cat', label: 'Budget category', kind: 'cat', filterable: true, avail: true, note: null },
  { key: 'bu', label: 'Business unit', kind: 'cat', filterable: true, avail: true, note: null },
  { key: 'phase', label: 'Phase', kind: 'cat', filterable: true, avail: true, note: null },
  { key: 'comp', label: 'Compliance constraint', kind: 'cat', filterable: true, avail: true, note: null },
]

const registerRoster = db.reports?.reports?.[0]?.spine ?? 'projects'
const registerRows = db.reports?.data?.[registerRoster]
if (!Array.isArray(registerRows) || registerRows.length === 0) {
  problems.push(`reports.data.${registerRoster} is the register and it is empty or missing`)
} else {
  const rowKeys = Object.keys(registerRows[0])
  for (const f of REGISTER_FIELDS) {
    if (!rowKeys.includes(f.key)) {
      problems.push(
        `register field "${f.key}" is not a column of reports.data.${registerRoster} (${rowKeys.join(', ')})`,
      )
    }
  }
  for (const key of rowKeys) {
    if (!REGISTER_FIELDS.some((f) => f.key === key)) {
      problems.push(
        `reports.data.${registerRoster} carries column "${key}", which no register field ` +
          'describes — it would reach a table header as its raw key',
      )
    }
  }
  db.reports.register = {
    roster: registerRoster,
    identity: REGISTER_FIELDS[0].key,
    fields: REGISTER_FIELDS,
  }
  notes.push(
    `reports.register: ${registerRoster} · ${registerRows.length} rows · identity ` +
      `"${REGISTER_FIELDS[0].key}" · ${REGISTER_FIELDS.length} described columns`,
  )
}

/* ------------------------------------------------- 6. the two tenant-level keys */

/*
 * **Carried forward rather than rebuilt, which is the rule a script that owns a subtree has to
 * keep.** `settings` is the Settings page's own — `npm run seed:settings` authors it — so rebuilding
 * `db.json` wholesale from the package would delete every permission somebody had configured, which
 * is how `ingest-reports.mjs` nearly dropped `governance` once. Taken from whatever is already at the
 * output path first, then from EPA's document, and left absent if neither has one, so the boot
 * refusal names `npm run seed:settings` rather than this script inventing a user list.
 */
const carried = ['settings', 'reports_prototype']
const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {}
const fallback = existsSync(EPA) ? JSON.parse(readFileSync(EPA, 'utf8')) : {}

for (const key of carried) {
  if (db[key]) continue
  if (previous[key]) {
    db[key] = previous[key]
    notes.push(`${key}: carried forward from the document already at mock-server/db.json`)
  } else if (fallback[key]) {
    db[key] = fallback[key]
    notes.push(`${key}: carried from mock-server/db.EPA.json — the CAPEX package supplies none`)
  } else {
    notes.push(`${key}: absent, and no copy to carry — the boot refusal names the command that writes it`)
  }
}

/* ------------------------------------------------- report */

if (problems.length > 0) {
  console.error('\nadopt:capex — refusing to write mock-server/db.json.\n')
  for (const p of problems) console.error(`  · ${p}`)
  console.error('\n  Fix capex/db.json (or its generator) and run again.\n')
  process.exit(1)
}

writeFileSync(OUT, `${JSON.stringify(db, null, 2)}\n`)

console.log('\nadopt:capex — wrote mock-server/db.json from capex/db.json')
console.log(`  tenant: ${db._meta?.tenant ?? 'unnamed'} · package ${db._meta?.package ?? '—'}`)
for (const n of notes) console.log(`  · ${n}`)
console.log('\n  Next: npm run seed:settings, then start the server. To publish: npm run db:push\n')
