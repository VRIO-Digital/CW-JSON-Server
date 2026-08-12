/*
 * Ingest "09 What if lens"/whatif_vls_data.json into db.json's `whatif`.
 *
 * The package is already declarative — it says so in its own `meta.note`: the
 * prototype's closures (value reads, number formatting, pool filters) were
 * re-expressed as data, which is why a measure carries a `field` and a `format`
 * rather than a function. So this script transforms very little. What it does is
 * **check that every reference in it resolves**, because each of the following would
 * otherwise fail silently, and silence is the failure mode this whole repo guards
 * against:
 *
 *  - a measure whose `field` no generator carries → every scenario column shows that
 *    measure as `undefined`, or worse as 0, which reads as "no inherited risk";
 *  - a `resolvable` entry pointing at a measure key that does not exist → the author
 *    step reports "Resolved — added" and adds nothing;
 *  - a pool filter on a field no generator carries → a pool of 0 candidates, which
 *    reads as "no generator qualifies" rather than as a broken filter;
 *  - a generator naming a transporter the roster omits → a source line citing
 *    e-Manifest for a carrier that is not in the data;
 *  - a format a measure names but the package does not define → a figure printed raw.
 *
 * Idempotent: run it again and it writes the same document.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const PKG = 'vls_demo_data_package_2026-08-10/09_What if lens/whatif_vls_data.json'
const DB = 'mock-server/db.json'

const pkg = JSON.parse(readFileSync(PKG, 'utf8'))
const db = JSON.parse(readFileSync(DB, 'utf8'))

const note = (...a) => console.log(' ', ...a)
const problems = []
const fail = (msg) => problems.push(msg)

/* ---------------- 1. the generators, and the fields everything else reads ---------------- */

const generators = pkg.generators
if (generators.length === 0) fail('the package ships no generators — there is nothing to draw from')
const fieldsOn = new Set(Object.keys(generators[0]))
for (const g of generators) {
  for (const f of fieldsOn) {
    if (!(f in g)) fail(`generator ${g.id} is missing "${f}", which its siblings carry`)
  }
}
note(`${generators.length} generators · fields: ${[...fieldsOn].join(', ')}`)

const transporters = new Set(pkg.transporters)
for (const g of generators) {
  if (!transporters.has(g.transporter)) {
    fail(`generator ${g.id} names transporter "${g.transporter}", which is not in the roster`)
  }
}

/* ---------------- 2. the measures ---------------- */

const measureKeys = new Set(pkg.watched_measures.map((m) => m.key))
const formats = new Set(Object.keys(pkg.formats))
for (const m of pkg.watched_measures) {
  if (!fieldsOn.has(m.field)) {
    fail(`measure "${m.key}" reads generator field "${m.field}", which no generator carries`)
  }
  if (!formats.has(m.format)) {
    fail(`measure "${m.key}" wants format "${m.format}", which the package does not define`)
  }
  /* A baseline is the facility's own standing figure, added to what a load inherits.
     A measure claiming one the facility does not have would silently add nothing. */
  if (m.baseline_field !== null && !(m.baseline_field in pkg.facility.baseline)) {
    fail(`measure "${m.key}" names baseline "${m.baseline_field}", which the facility has no value for`)
  }
  if (m.appetite_field !== null && !(m.appetite_field in pkg.facility.appetite)) {
    fail(`measure "${m.key}" names appetite "${m.appetite_field}", which the facility has no value for`)
  }
  /* The breach rule is what turns a figure red. One pointing at nothing would leave a
     measure that can never breach, which reads as "always within appetite". */
  if (m.breach && !m.breach.against.startsWith('appetite.')) {
    fail(`measure "${m.key}" breaches against "${m.breach.against}", which is not an appetite line`)
  }
  if (m.breach && !(m.breach.against.slice('appetite.'.length) in pkg.facility.appetite)) {
    fail(`measure "${m.key}" breaches against "${m.breach.against}", which the facility has no value for`)
  }
}
note(`${measureKeys.size} watched measures · ${formats.size} formats`)

/* ---------------- 3. what a typed measure resolves to ---------------- */

for (const r of pkg.resolvable) {
  if (r.resolves_to !== null && !measureKeys.has(r.resolves_to)) {
    fail(`resolvable "${r.keywords[0]}" resolves to "${r.resolves_to}", which is not a measure`)
  }
  if (r.verdict === 'resolved' && r.resolves_to === null) {
    fail(`resolvable "${r.keywords[0]}" claims to resolve but names no measure`)
  }
  if (r.verdict === 'grounds_not_inherited' && r.resolves_to !== null) {
    fail(`resolvable "${r.keywords[0]}" is not inheritable, so it must not add a measure`)
  }
}
/* A keyword matching more than one entry would make the verdict depend on list order,
   which is the same "a tie matches nothing" problem `matchTemplate` has. */
const seen = new Map()
for (const r of pkg.resolvable) {
  for (const k of r.keywords) {
    if (seen.has(k)) fail(`keyword "${k}" appears on two resolvable entries, so its verdict is order-dependent`)
    seen.set(k, r)
  }
}
note(`${pkg.resolvable.length} resolvable phrasings over ${seen.size} keywords`)

/* ---------------- 4. the candidate pools ---------------- */

const OPS = {
  '>': (a, b) => a > b,
  '<': (a, b) => a < b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
  '>=': (a, b) => a >= b,
}
const poolMembers = (pool) =>
  pool.filter === null
    ? generators
    : generators.filter((g) => OPS[pool.filter.op](g[pool.filter.field], pool.filter.value))

for (const pool of pkg.candidate_pools) {
  if (pool.filter === null) continue
  if (!(pool.filter.op in OPS)) fail(`pool "${pool.key}" uses operator "${pool.filter.op}", which is not supported`)
  if (!fieldsOn.has(pool.filter.field)) {
    fail(`pool "${pool.key}" filters on "${pool.filter.field}", which no generator carries`)
  }
}
/*
 * An empty pool is not a validation error — it is a legitimate answer about the data,
 * and the Runtime says "0 generators in this pool" rather than showing a broken
 * dropdown. It is reported here so a pool that empties on re-ingest is visible.
 */
const counts = pkg.candidate_pools.map((p) => `${p.key} ${poolMembers(p).length}`)
note(`pools: ${counts.join(' · ')}`)
for (const pool of pkg.candidate_pools) {
  if (poolMembers(pool).length === 0) note(`  note: pool "${pool.key}" is empty against this roster`)
}

/* ---------------- 5. headroom, computed per pool ----------------
 *
 * The package states the formula rather than the answer:
 *   floor((appetite.enf - baseline.enf) / avg enforcement of carrying generators in pool)
 *
 * Computed here, per pool, so the figure has one source and the page never does
 * arithmetic on a measure. `null` where nothing in the pool carries enforcement —
 * dividing by zero would print `Infinity` as a headroom, and "unlimited room" is the
 * opposite of what an empty carrying set means.
 */
const headroomKey = pkg.runtime.headroom.measure
const headroomMeasure = pkg.watched_measures.find((m) => m.key === headroomKey)
if (!headroomMeasure) fail(`headroom is measured on "${headroomKey}", which is not a measure`)
const appetite = pkg.facility.appetite[headroomMeasure?.appetite_field ?? '']
if (typeof appetite !== 'number') fail('headroom has no appetite line to measure against')

const headroom = {}
for (const pool of pkg.candidate_pools) {
  const carrying = poolMembers(pool).filter((g) => g[headroomMeasure.field] > 0)
  if (carrying.length === 0) {
    headroom[pool.key] = { room: null, avg: null, carrying: 0, appetite }
    continue
  }
  const avg = carrying.reduce((t, g) => t + g[headroomMeasure.field], 0) / carrying.length
  headroom[pool.key] = {
    room: Math.max(0, Math.floor((appetite - pkg.facility.baseline[headroomMeasure.baseline_field]) / avg)),
    avg: Math.round(avg * 10) / 10,
    carrying: carrying.length,
    appetite,
  }
}
note(
  `headroom: ${Object.entries(headroom)
    .map(([k, h]) => `${k} ${h.room ?? '—'}`)
    .join(' · ')}`,
)

/* ---------------- 6. the graph reference ---------------- */

/* The subgraph a scenario traverses is drawn from these node types, so a type the
   drawing names but the reference omits would be an undrawn node. */
const nodeTypes = new Set(pkg.graph_reference.node_types.map((n) => n.key))
for (const n of pkg.graph_reference.scenario_subgraph.nodes) {
  const key = n.replace(/\(.*\)$/, '').replace(/s$/, '')
  if (!nodeTypes.has(key)) fail(`the scenario subgraph draws "${n}", which is not a declared node type`)
}
if (!nodeTypes.has(pkg.graph_reference.frame.center_node)) {
  fail(`the frame centres on "${pkg.graph_reference.frame.center_node}", which is not a declared node type`)
}

/* ---------------- 7. refuse, or write ---------------- */

if (problems.length > 0) {
  console.error(`\ningest-whatif: ${problems.length} unresolved reference(s):`)
  for (const p of problems) console.error(`  - ${p}`)
  console.error(
    '\nEach of these fails silently at runtime — a measure reading undefined, a pool of\n' +
      'nobody, a resolve that adds nothing. Fix the package rather than the symptom.',
  )
  process.exit(1)
}

/*
 * `meta` is deliberately dropped: it describes the extraction, not the tenant's data,
 * and a note about a prototype has no business being served to the app. Everything
 * else is stored as the package states it, plus the headroom this script computed.
 */
const { meta: _meta, ...rest } = pkg
db.whatif = { ...rest, headroom }

writeFileSync(DB, `${JSON.stringify(db, null, 2)}\n`, 'utf8')
note(`wrote db.whatif · ${Object.keys(db.whatif).length} sections`)
console.log('ok')
