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
/* Resolved against this module rather than the working directory: these are run through npm from
   the package root, and a cwd-relative path breaks the moment they are run from anywhere else. */
const DB = new URL('../db.json', import.meta.url)

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

/* ---------------- 7. the publishing block, authored here ----------------
 *
 * `whatif_vls_data.json` predates the lens's v2 prototype ("what if lenses/", which
 * carries the publish flow) and ships **no publishing copy at all** — so unlike every
 * other section of `db.whatif`, this one is authored rather than transformed. The
 * strings are the prototype's own, read off `src/data/vlsDemo.ts` and
 * `src/components/PublishModal.tsx`.
 *
 * It lives *in the ingest* rather than beside it in a seed script for one reason: this
 * script rebuilds `db.whatif` wholesale (`db.whatif = { ...rest }`), so a block seeded
 * elsewhere would be deleted the next time anybody re-ingests. That is exactly how
 * `ingest-reports.mjs` nearly dropped every report audience — `x = { … }` on a shared
 * key deletes what it does not list. Authoring it here makes a re-ingest reproduce it.
 *
 * What is deliberately **not** here: the readers and the graph versions. The prototype
 * ships a five-person `vls.com` directory and a hard-coded `v3`/`v2` graph list; both
 * are answered by the app's own pools instead — `settings.json`'s users and the graphs
 * that are actually published — because a copy of either would be a second answer to
 * "who exists" and could offer a reader the API refuses.
 */
const PUBLISHING = {
  publish_title: 'Publish scenario',
  manage_title: 'Manage publishing',
  /* Why a case cannot be shared on its own. The whole premise of the authoring tab is
     that the frame is what makes a figure mean something. */
  call:
    'The whole scenario travels, or nothing does. A case is not separately shareable — a ' +
    'figure without its frame (what was watched, which pool it was drawn from) is a number ' +
    'without a question.',
  readers: {
    label: 'Readers',
    placeholder: 'Name or email…',
    empty_error: 'Add at least one reader.',
    /* The gate-1 caveat, stated where the decision is made. Required by CLAUDE.md in
       these words wherever a client-held audience is recorded. */
    caveat:
      'This narrows who is told the scenario exists. It is not access control: the ' +
      'directory comes from Settings, the role comes from the browser, and the API still ' +
      'serves every scenario to a caller that names nobody.',
    /* Reader-level scope is *declared*, never applied — the persona's own access note is
       printed beside them rather than a filter this lens invents and does not run. */
    scope_note:
      'Each reader opens the scenario through the data access their persona already ' +
      'carries. What that persona may see is stated beside them; this lens applies no ' +
      'filter of its own.',
  },
  graph: {
    label: 'Bind to a graph',
    note:
      'The scenario stores its frame and each case’s admitted load — never the numbers. ' +
      'Every figure a reader sees is recomputed by traversal against the graph version ' +
      'bound here.',
    empty: 'Nothing is published, so there is no graph to bind a scenario to.',
  },
  freshness: {
    label: 'Numbers freshness',
    /* One preset per recurrence the prototype offers. `sentence` is a template rather
       than a finished string because the custom one interpolates a live control — the
       same arrangement `runtime.headroom.sentence` already uses for {room}/{appetite}. */
    presets: [
      {
        id: 'open',
        label: 'Only when it’s opened',
        sentence: 'Figures recompute from the live tables each time a reader opens it — no schedule.',
      },
      {
        id: 'daily',
        label: 'Every weekday (Mon–Fri) at 6:00 AM',
        sentence: 'Figures refresh at 6:00 AM, Monday to Friday.',
      },
      {
        id: 'monday',
        label: 'Weekly on Monday at 6:00 AM',
        sentence: 'One refresh at the start of each week — Monday, 6:00 AM.',
      },
      {
        id: 'monthly',
        label: 'Monthly on the 1st at 6:00 AM',
        sentence: 'One refresh on the 1st of each month, 6:00 AM.',
      },
      { id: 'custom', label: 'Custom…', sentence: 'Occurs every {n} {when} at {time}.' },
    ],
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    times: ['6:00 AM', '7:00 AM', '8:00 AM', '12:00 PM', '6:00 PM'],
    units: ['day', 'week', 'month'],
    default: { preset: 'open', every: 1, unit: 'week', days: ['Mon'], time: '6:00 AM' },
    no_day_error: 'Pick at least one day of the week.',
  },
  done: {
    title: 'Scenario published',
    /* {name} and {n} are filled where the sentence is printed. A reader count written
       into the component would be a second source for the same number. */
    body:
      '{name} is now readable by {n}. They open the complete scenario — the frame and ' +
      'every case — never a single case on its own.',
    stored: 'the frame and each case’s admitted load — never the numbers',
  },
  buttons: {
    publish: 'Publish scenario',
    update: 'Update publication',
    unpublish: 'Unpublish',
    manage: 'Manage publishing…',
    open: 'Publish scenario…',
  },
  unpublished_note: 'Unpublished — the scenario stays in your library.',
}

/* Each of these fails by *answering*: a preset with no sentence prints an empty
   recurrence line, a default naming no preset opens the dialog on nothing, and an empty
   day roster makes the weekly branch unpickable while still offering it. */
const presetIds = new Set(PUBLISHING.freshness.presets.map((p) => p.id))
for (const p of PUBLISHING.freshness.presets) {
  if (!p.sentence) fail(`freshness preset "${p.id}" states no sentence — the recurrence line would be blank`)
}
if (!presetIds.has(PUBLISHING.freshness.default.preset)) {
  fail(`freshness default names preset "${PUBLISHING.freshness.default.preset}", which is not offered`)
}
if (!PUBLISHING.freshness.units.includes(PUBLISHING.freshness.default.unit)) {
  fail(`freshness default names unit "${PUBLISHING.freshness.default.unit}", which is not offered`)
}
for (const d of PUBLISHING.freshness.default.days) {
  if (!PUBLISHING.freshness.days.includes(d)) fail(`freshness default names day "${d}", which is not in the roster`)
}
if (!PUBLISHING.freshness.times.includes(PUBLISHING.freshness.default.time)) {
  fail(`freshness default names time "${PUBLISHING.freshness.default.time}", which is not offered`)
}
note(`publishing: ${presetIds.size} freshness presets · ${PUBLISHING.freshness.times.length} times`)

/* ---------------- 8. refuse, or write ---------------- */

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

/*
 * The one string the package no longer describes.
 *
 * Its subtitle ends "…swap loads in and out live, **save the ones worth keeping**, and
 * open any figure to the federal record it came from" — which described a library of
 * single loads. v2 made the scenario the saved and publishable object, so the sentence
 * is the v2 prototype's own (`what if lenses/src/App.tsx`). Overridden here rather than
 * hand-edited into the package, so a re-ingest of the untouched JSON still produces the
 * copy the page actually implements.
 */
const V2_SUBTITLE =
  'See the risk before you accept the next load. Authoring sets the scenario — which ' +
  'measures you watch, which pool of candidate generators you draw from, and its name. ' +
  'Then in Runtime you swap case loads in and out live, publish the complete scenario ' +
  'when it’s worth sharing, and open any figure to the federal record it came from. ' +
  'Nothing is predicted.'

/*
 * The third tab, for the same reason the subtitle is overridden.
 *
 * The package lists two — Authoring and Runtime — because when it was written a
 * publication had no surface of its own: publishing was something you did to a
 * library row, and what came of it was a tag on that row. Reading a publication
 * back is a third job now (who was told, which build they see, when it was
 * created as against when it was told), and it is a *reading* job: it changes
 * nothing, which is exactly why it does not belong inside Runtime, where every
 * control swaps a load.
 *
 * Authored here rather than hand-edited into db.json, so a re-ingest of the
 * untouched package still produces the tab list the page actually renders — the
 * mistake `ingest-reports.mjs` nearly made with the report audiences.
 */
const PUBLISHED_TAB = { key: 'published', label: 'Published scenarios' }

const tabs = rest.copy.tabs.some((t) => t.key === PUBLISHED_TAB.key)
  ? rest.copy.tabs
  : [...rest.copy.tabs, PUBLISHED_TAB]

db.whatif = {
  ...rest,
  copy: { ...rest.copy, subtitle: V2_SUBTITLE, tabs },
  headroom,
  publishing: PUBLISHING,
}

writeFileSync(DB, `${JSON.stringify(db, null, 2)}\n`, 'utf8')
note(`wrote db.whatif · ${Object.keys(db.whatif).length} sections`)
console.log('ok')
