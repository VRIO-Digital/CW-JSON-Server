/*
 * Authors the primary dataset's **row model** — the block that tells the report-authoring prototype how
 * its rows are read:
 *
 *     npm run seed:prototype-model
 *
 * **Why this exists.** The prototype was vendored with one fixture, so how a row is read was written
 * into the engine: `p.generator` named it, `p.risk` toned it, `p.cd` drew a pill, a `switch` over three
 * ids picked the scope, and seven closures were the summary tiles. Each was right for EPA and wrong for
 * any second dataset — and wrong *silently*, because a column another dataset does not have reads as a
 * blank cell rather than as a column that is not there. Those literals are now `reports_prototype.
 * row_model`, and this writes the primary's so its behaviour is exactly what it was.
 *
 * **It is a script rather than an edit because `db.json` is 492 KB**, and because every column it names
 * has to exist: a model naming a field the fixture does not carry is a blank table with no error, which
 * is the failure the model was added to prevent. So it checks itself against the fixture and **refuses
 * to write** rather than authoring a model that renders nothing.
 *
 * The secondary datasets author their own — CAPEX's is written by `npm run ingest:capex`, from its own
 * shipped authoring fixture.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const DB = new URL('../db.json', import.meta.url)
const db = JSON.parse(readFileSync(DB, 'utf8'))

const proto = db.reports_prototype
if (!proto) {
  console.error('seed-prototype-model: db.json has no reports_prototype — restore it before seeding')
  process.exit(1)
}

/*
 * ---------------- the primary's model ----------------
 *
 * Every value below is transcribed from the code it replaces, not chosen: `label` is the column
 * `TableBlock` printed in its first cell, `scopes` are the three cases of `scopeSet`, `kpis` are
 * `KPI_DEFS` in `KPI_ORDER`, and `formats` are the branches of `fmt`. The point of the move is that the
 * engine stops knowing them, not that they change.
 */
const ROW_MODEL = {
  label: 'generator',
  /* The sub-line `TableBlock` drew under a generator's name, now a template over the row's own
     columns — interpolated the way the What-if lens interpolates `{room}`. */
  sublabel: '{evals} evaluations · last enforcement {last_enf}',
  status: 'risk',
  tones: { high: 'over', med: 'warn', low: 'ok' },
  /* `scopeSet`'s three cases. `all` carries no field: it is the deliberate "every row" case, which is
     what the old `default:` branch meant and the one reading a missing rule must not be given. */
  scopes: {
    all: {},
    enf: { field: 'enf', op: 'gt', value: 0 },
    oos: { field: 'state', op: 'ne', value: 'TX' },
    cd: { field: 'cd', op: 'truthy' },
  },
  measures: ['penalty', 'tons', 'viols', 'enf', 'evals', 'manifests'],
  kpis: [
    { key: 'count', label: 'Generators in scope', agg: 'rows' },
    { key: 'enf', label: 'Enforcement actions', agg: 'sum', field: 'enf', format: 'count', tone: 'bad' },
    { key: 'penalty', label: 'Penalty exposure', agg: 'sum', field: 'penalty', format: 'money', tone: 'bad' },
    { key: 'cd', label: 'Under consent decree', agg: 'count_true', field: 'cd', tone: 'warn' },
    { key: 'viols', label: 'Open violations', agg: 'sum', field: 'viols', format: 'count', tone: 'warn' },
    { key: 'tons', label: 'Tons shipped to VLS', agg: 'sum', field: 'tons', format: 'tons' },
    { key: 'manifests', label: 'Manifests', agg: 'sum', field: 'manifests', format: 'count' },
  ],
  formats: {
    penalty: 'money',
    tons: 'tons',
    evals: 'count',
    viols: 'count',
    enf: 'count',
    manifests: 'count',
    cd: 'yesno',
    risk: 'text',
    last_enf: 'text',
  },
  /* `labelize`'s one map. `cd` needs none: a `yesno` column prints Yes/No without being told. */
  labels: { risk: { high: 'High', med: 'Med', low: 'Low' } },
  /* The consent-decree column's pill words, which `TableBlock` had inline. */
  pills: { cd: { on: 'Decree', off: 'None' } },
  blocks: ['kpis', 'chart', 'table', 'facilities', 'quarterly', 'traces'],
  /* The table's closing sentence, which named three columns in the component. */
  footer: [
    { field: 'penalty', label: 'penalty exposure' },
    { field: 'tons', label: 'received' },
    { field: 'manifests', label: 'manifests' },
  ],
}

/** The two nouns and the example question the panes print, which the engine used to spell out. */
const META_ADDITIONS = {
  entity_singular: 'inbound generator',
  ask_placeholder: 'e.g. Which inbound generators carry the most compliance risk?',
}

/* ---------------- refuse to write a model the fixture cannot satisfy ---------------- */

const problems = []
const fieldKeys = new Set((proto.fields ?? []).map((f) => f.key))
const rows = proto.generators ?? []

const named = (key, where) => {
  if (!fieldKeys.has(key)) problems.push(`${where} names "${key}", which is not in reports_prototype.fields`)
}

named(ROW_MODEL.label, 'row_model.label')
if (ROW_MODEL.status) named(ROW_MODEL.status, 'row_model.status')
for (const m of ROW_MODEL.measures) named(m, 'row_model.measures')
for (const k of ROW_MODEL.kpis) if (k.field) named(k.field, `row_model.kpis.${k.key}`)
for (const f of ROW_MODEL.footer) named(f.field, 'row_model.footer')
for (const key of Object.keys(ROW_MODEL.formats)) named(key, 'row_model.formats')

/* Every scope the reader can pick needs a rule, or that option silently selects nothing. */
for (const option of proto.opts?.scope?.options ?? []) {
  if (!ROW_MODEL.scopes[option.value]) {
    problems.push(`row_model.scopes has no rule for the "${option.value}" scope`)
  }
}

/* And the rows have to satisfy it: a name, a tone the map covers, a number in every rankable column. */
rows.forEach((row, i) => {
  if (!row[ROW_MODEL.label]) problems.push(`generators[${i}] has no ${ROW_MODEL.label}`)
  if (ROW_MODEL.status && !ROW_MODEL.tones[String(row[ROW_MODEL.status])]) {
    problems.push(`generators[${i}].${ROW_MODEL.status} is "${row[ROW_MODEL.status]}", which tones does not cover`)
  }
  for (const m of ROW_MODEL.measures) {
    if (typeof row[m] !== 'number') problems.push(`generators[${i}].${m} is not a number`)
  }
})

/* The sub-line's placeholders are columns too, and a missing one prints "undefined evaluations". */
for (const [, key] of (ROW_MODEL.sublabel ?? '').matchAll(/\{(\w+)\}/g)) {
  named(key, 'row_model.sublabel')
}

if (problems.length > 0) {
  console.error('seed-prototype-model: refusing to write\n')
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}

/* ---------------- write ---------------- */

db.reports_prototype = {
  ...proto,
  meta: { ...proto.meta, ...META_ADDITIONS },
  row_model: ROW_MODEL,
}

writeFileSync(DB, JSON.stringify(db, null, 2) + '\n', 'utf8')

console.log(
  `seed-prototype-model: db.json · rows named by "${ROW_MODEL.label}", toned by "${ROW_MODEL.status}" · ` +
    `${ROW_MODEL.measures.length} measures, ${ROW_MODEL.kpis.length} tiles, ` +
    `${Object.keys(ROW_MODEL.scopes).length} scopes, ${rows.length} rows checked against it.`,
)
