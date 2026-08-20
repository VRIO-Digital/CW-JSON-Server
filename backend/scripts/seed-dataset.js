/**
 * Author an empty-but-servable `db.json` for a secondary dataset — `npm run seed:dataset -- CAPEX`.
 *
 * **A new dataset's problem is that "empty" is not a document.** `validateDb` requires 25 keys and
 * checks inside most of them, so an empty object refuses to boot; and the two obvious ways out are
 * both wrong. Seeding it with the primary's rows makes CAPEX show EPA's figures under CAPEX's name,
 * which is the one confusion this whole split exists to prevent. Leaving it invalid means the server
 * will not start at all once the dataset is declared.
 *
 * So this writes the third thing: **the primary's structure, with the primary's rows removed.**
 *
 * **What is copied and what is emptied comes from `MERGE_PLAN`, not from a second list here.** That
 * plan already had to distinguish a dataset's own rows (`union`, `keyed`) from the tenant's shared
 * vocabulary (`primary`) in order to answer `dataset=both`, and a seed disagreeing with it is how
 * `both` comes to double-count a key the seed thought was shared. One list, two readers.
 *
 * Two blocks are then overridden by hand, because carrying them over would put the primary's
 * *identity* on this dataset's pages rather than its vocabulary: the What-if facility (a named TSDF
 * with its own appetite line) and the report section's persona strip. Both are stated as belonging
 * to no dataset yet, which is what is true.
 *
 * The seed writes a **file** and only a file, like every other seed here — it must run without
 * credentials. Push it with `npm run db:push -- CAPEX`.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATASETS, MERGE_PLAN, PRIMARY } from '../datasets.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const die = (message) => {
  console.error(`\nseed-dataset: ${message}\n`)
  process.exit(1)
}

const target = process.argv[2]
if (!target) {
  die(
    'name the dataset to seed, e.g.\n      npm run seed:dataset -- CAPEX\n\n' +
      `  This tenant declares ${DATASETS.join(', ')} in backend/datasets.js.`,
  )
}
if (!DATASETS.includes(target)) {
  die(
    `"${target}" is not a declared dataset — this tenant has ${DATASETS.join(', ')}.\n` +
      '  Add it to DATASETS in backend/datasets.js first, with its MERGE_PLAN entries.',
  )
}
if (target === PRIMARY) {
  die(
    `${PRIMARY} is the primary dataset and holds the tenant's real data — this would empty it.\n` +
      '  Restore it with `npm run db:pull` instead.',
  )
}

/* ---------------- read the primary, which is the structure being copied ---------------- */

const sourcePath = join(root, 'db.json')
let source
try {
  source = JSON.parse(await readFile(sourcePath, 'utf8'))
} catch (error) {
  die(
    `could not read ${PRIMARY}'s document at backend/db.json — ${error.message}\n` +
      '  It is gitignored, so a fresh checkout has to fetch it first:\n      npm run db:pull',
  )
}

/* ---------------- empty what belongs to a dataset, keep what belongs to the tenant ---------------- */

/**
 * One value, emptied or carried according to its merge rule.
 *
 * `primary` is the tenant's own — the field dictionary, the wizard pools, the governance states, the
 * copy every page prints — so it is carried whole. A `union` or `keyed` rule marks rows that belong
 * to whichever dataset holds them, so those are emptied to the container they were.
 */
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
  die(`no merge rule for a value while seeding — MERGE_PLAN is incomplete`)
}

const seeded = {}
for (const [key, rule] of Object.entries(MERGE_PLAN)) {
  if (!(key in source)) {
    die(
      `${PRIMARY}'s document has no "${key}", which MERGE_PLAN declares.\n` +
        '  Its structure is what this seed copies, so it must be complete first:\n      npm run db:pull',
    )
  }
  seeded[key] = seedValue(rule, source[key])
}

/* ---------------- the two blocks that carry identity rather than vocabulary ---------------- */

/*
 * `whatif.facility` is a named TSDF with a baseline and a risk appetite, and `whatif` is `primary` in
 * the merge plan because one merged frame is not a frame. Carried over verbatim it would put EPA's
 * Deer Park facility, its 24 candidate generators and its 10-action appetite line on CAPEX's lens —
 * every figure on the page a claim about a facility this dataset has never heard of. Emptied to the
 * shape `validateDb` requires instead, which renders as a lens with nothing to compare.
 */
seeded.whatif = {
  ...seeded.whatif,
  facility: {
    id: `FAC:${target}-UNSET`,
    name: `${target} — no facility configured`,
    role: `This dataset has no facility yet. Populate ${target}/db.json to set one.`,
    baseline: {},
    appetite: {},
  },
  transporters: [],
  generators: [],
  candidate_pools: [],
  resolvable: [],
}

/*
 * The report section's persona strip names a person and their site ("EHS Compliance Lead · VLS Deer
 * Park") and its scope line names the network the figures are drawn from. Both are the primary's,
 * and printing them over an empty dataset would attribute CAPEX's blank report to EPA's analyst.
 */
seeded.reports = {
  ...seeded.reports,
  meta: {
    ...(source.reports?.meta ?? {}),
    persona_name: '—',
    persona_role: `${target} · no persona configured`,
    persona_initials: target.slice(0, 2).toUpperCase(),
    entity_plural: 'rows',
    scope_line: `the ${target} dataset, which holds no rows yet`,
    source_trace: `Traces to: nothing yet — ${target}/db.json has not been populated.`,
  },
}

/*
 * The telemetry payloads are `primary` in the merge plan because each carries totals computed over
 * its own rows — but those rows are the primary's events, policies and eval runs. Emptied here for
 * the same reason: an audit page listing EPA's six events under CAPEX is a claim about this dataset.
 */
seeded.audit = { ...seeded.audit, stats: [], events: [], policies: [], policy_total: 0 }
seeded.traces = { ...seeded.traces, stats: [], items: [] }
seeded.evals = { ...seeded.evals, stats: [], runs: [], checks: [] }

/*
 * The studio's pivot and its build counts are the primary's review decisions and the primary's
 * build. `generated` has to stay an object and `pivot` has to stay an object — both are checked —
 * so each is reduced to a stated absence rather than removed.
 */
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
 * The same rule every seed here follows: check before writing, so the failure lands in this terminal
 * rather than on the box that boots it. This cannot import `validateDb` — it lives inside
 * `server.js`, which starts a server on import — so it checks the one thing this script decides:
 * that every declared key is present and is still the container the plan says it is. `validateDb`
 * itself runs on the next boot and is the real gate.
 */
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
  die(`refusing to write — the seeded document is malformed:\n  · ${problems.join('\n  · ')}`)
}

const outPath = join(root, `db.${target}.json`)
await writeFile(outPath, `${JSON.stringify(seeded, null, 2)}\n`, 'utf8')

const emptied = Object.entries(MERGE_PLAN).filter(([, r]) => r !== 'primary').length
console.log(`seed-dataset: wrote backend/db.${target}.json`)
console.log(`  ${Object.keys(seeded).length} keys — ${emptied} emptied, the rest carried from ${PRIMARY}`)
console.log(`  push it with: npm run db:push -- ${target}`)
