/**
 * Adopt a package-generated document as a dataset's own —
 * `npm run adopt:dataset -- CAPEX "src/report/db (2).json"`.
 *
 * **This is not `seed:dataset`, and the difference is the whole point.** That script writes the
 * primary's *structure* with the primary's *rows removed*, because a brand-new dataset has no rows
 * of its own and "empty" is not a servable document. This one is for the opposite case: a dataset
 * whose rows already exist, generated from its own demo package against this repo's schema. Seeding
 * over them would throw the package away; hand-editing them is refused by the package itself
 * ("Never hand-edit this file -- change the generator and rebuild"), and by the rule that every
 * document here is written by a script.
 *
 * So this **carries the package's document through unchanged** and fills only what it cannot know.
 *
 * **What it fills, and why that is not inventing data.** A package generator knows its own tenant's
 * projects, contracts and reports. It cannot know the keys `MERGE_PLAN` marks `primary`, because
 * those are the *tenant's* rather than a dataset's — `settings` (who exists), `reports_prototype`
 * (the authoring prototype's sample data), `auth_roles`, `google_account`. `both` already resolves
 * every one of them to the primary's value, so carrying the primary's here says exactly what the
 * merged view would say. Nothing is chosen that was not already decided in `MERGE_PLAN`.
 *
 * **What it refuses.** A missing key whose rule is a *collection* — `projects`, `drives`,
 * `ask_answers`, a report roster. Those are the dataset's own rows, and borrowing the primary's is
 * the single failure the dataset split exists to prevent: EPA's figures under CAPEX's name. The
 * refusal names the key and says to fix the generator.
 *
 * It writes a **file** and only a file, like every other script here, so it runs with no
 * credentials. Push it with `npm run db:push -- <NAME>`.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATASETS, MERGE_PLAN, PRIMARY } from '../mock-server/datasets.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const die = (message) => {
  console.error(`\nadopt-dataset: ${message}\n`)
  process.exit(1)
}

const [target, sourceArg, resolvedArg] = process.argv.slice(2)
if (!target || !sourceArg) {
  die(
    'name the dataset and the document to adopt, e.g.\n' +
      '      npm run adopt:dataset -- CAPEX "src/report/db (2).json" \\\n' +
      '        "src/report/src/data/db.json"\n\n' +
      `  This tenant declares ${DATASETS.join(', ')} in mock-server/datasets.mjs.`,
  )
}
if (!DATASETS.includes(target)) {
  die(
    `"${target}" is not a declared dataset — this tenant has ${DATASETS.join(', ')}.\n` +
      '  Add it to DATASETS in mock-server/datasets.mjs first, with its MERGE_PLAN entries.',
  )
}
if (target === PRIMARY) {
  die(
    `${PRIMARY} is the primary dataset and holds the tenant's real data — this would overwrite it.\n` +
      '  Restore it with `npm run db:pull` instead.',
  )
}

/* ---------------- the two documents: the package's, and the tenant's ---------------- */

const read = async (path, what, fix) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    die(`could not read ${what} at ${path} — ${error.message}\n  ${fix}`)
  }
}

const source = await read(
  join(root, sourceArg),
  `the ${target} package's document`,
  'Name the file the package generated, relative to the repo root.',
)
const tenant = await read(
  join(root, 'mock-server', 'db.json'),
  `${PRIMARY}'s document`,
  'It is gitignored, so a fresh checkout has to fetch it first:\n      npm run db:pull',
)

/* ---------------- carry the package's keys; fill only the tenant's ---------------- */

/*
 * **The tenant's directory travels as one unit, whether or not the package brought its own.**
 *
 * These three answer "who exists", they cross-reference each other, and `MERGE_PLAN` marks all
 * three `primary` for the reason it states: two datasets do not mean eight users. `validateDb`
 * enforces the cross-reference — every `settings.users[].role_id` must name one of the *document's*
 * `auth_roles` — so carrying half the pair is what breaks it. The CAPEX package generated its own
 * four personas (`analyst`, `architect`, …) from its report fixtures; carrying the tenant's users
 * beside them left every user naming a role the document did not have, and the boot said so.
 *
 * Set aside rather than merged, and **named on the way out** so it is not a silent substitution.
 * A dataset's own personas would be a second answer to who has signed in, and the login resolves a
 * persona against the tenant directory — one pool, whichever dataset is in view.
 *
 * This is deliberately **not** "every `primary` key comes from the primary". `whatif` is `primary`
 * too, and CAPEX has its own facility, its own candidate loads and its own appetite line: replacing
 * those with EPA's would be the single failure this split exists to prevent. `MERGE_PLAN` answers
 * what `both` *displays* for a single-valued key; it does not say a dataset may not hold its own.
 */
const TENANT_IDENTITY = ['auth_roles', 'settings', 'google_account']

const adopted = { ...source }
const carried = []
const setAside = []
const refusals = []

for (const key of TENANT_IDENTITY) {
  if (MERGE_PLAN[key] !== 'primary') {
    die(
      `"${key}" is treated here as the tenant's directory but MERGE_PLAN no longer marks it ` +
        'primary — reconcile the two before adopting a document.',
    )
  }
  if (!(key in tenant)) {
    refusals.push(`"${key}" is missing from ${PRIMARY}'s document — it is the tenant's directory`)
    continue
  }
  if (key in adopted && JSON.stringify(adopted[key]) !== JSON.stringify(tenant[key])) {
    setAside.push(key)
  }
  adopted[key] = tenant[key]
  carried.push(key)
}

for (const [key, rule] of Object.entries(MERGE_PLAN)) {
  if (key in adopted) continue
  if (rule === 'primary') {
    if (!(key in tenant)) {
      refusals.push(
        `"${key}" is missing from both documents — it is the tenant's, so ${PRIMARY}'s must carry it`,
      )
      continue
    }
    adopted[key] = tenant[key]
    carried.push(key)
    continue
  }
  /*
   * A collection. Filling it from the primary would put EPA's rows under this dataset's name, which
   * is the one confusion the split exists to prevent — so this is a refusal rather than a default,
   * and it names the generator as the place to fix it.
   */
  refusals.push(
    `"${key}" is missing and holds this dataset's own rows — the package generator has to produce it`,
  )
}

/* ---------------- the resolved report runs, which no figure here could recompute ---------------- */

/*
 * **A report's figures are a resolver's output, carried verbatim or not at all.**
 *
 * The package document holds each report's *definition*; the report layer's fixture holds what the
 * resolver returned for it — `resolved[reportId]`, one payload per report, every number already a
 * `display` or `exact` string. Recomputing them on this side would be a second implementation of the
 * aggregation rules, which agrees with the first exactly until one of them is edited.
 *
 * Folded into the document rather than imported by the client, for the reason `reports_prototype`
 * was: a fixture compiled into the bundle is the one thing on screen the bucket cannot change.
 *
 * `specs` rides along because three renderers read the report's own spec for labels (`reportById`),
 * and a label resolved from a second copy is a second answer to what a column is called.
 *
 * Optional: a dataset whose reports this app already computes needs none of this, and a document
 * without it is refused later by the format gate rather than here.
 */
if (resolvedArg) {
  const fixture = await read(
    join(root, resolvedArg),
    `the ${target} report layer's resolved runs`,
    'Name the report fixture the package generated, relative to the repo root.',
  )
  const resolved = fixture.resolved ?? null
  const specs = fixture.reports ?? null
  if (!resolved || Object.keys(resolved).length === 0) {
    refusals.push(`${resolvedArg} carries no "resolved" runs — that file is where the figures are`)
  } else if (!Array.isArray(specs) || specs.length === 0) {
    refusals.push(`${resolvedArg} carries no "reports" specs — three renderers read them for labels`)
  } else {
    /*
     * Every definition must have a run behind it, and every run a definition. A definition with no
     * run opens on an empty page; a run with no definition is a payload nothing can reach. Neither
     * throws, so both are refused here.
     */
    const defined = (adopted.reports?.reports ?? []).map((r) => r.report_id)
    for (const id of defined) {
      if (!resolved[id]) {
        refusals.push(`report "${id}" is defined but has no resolved run — it would open empty`)
      }
    }
    for (const id of Object.keys(resolved)) {
      if (!defined.includes(id)) {
        refusals.push(`resolved run "${id}" matches no report definition — nothing could open it`)
      }
    }
    adopted.reports = { ...adopted.reports, resolved, specs }
  }
}

/* ---------------- the one sentence a package cannot author, and it is load-bearing ---------------- */

/*
 * `reports.governance.audit.copy.not_enforced` is the sentence that stops the Audit & Governance
 * page implying a restriction runs. `validateDb` checks for the phrase itself rather than the key,
 * for the reason CLAUDE.md gives: a page that lets somebody author a restriction and stays quiet
 * about enforcement is implying one, which is the claim that whole section exists to avoid.
 *
 * The CAPEX package ships it as `null`. Carrying the primary's is not borrowing a *figure* — the
 * sentence is a statement about **this app's behaviour** ("no report or scenario in this app filters
 * its rows per persona yet"), which is equally true of every dataset it serves. It is the same
 * reasoning that makes `settings` and `auth_roles` `primary`.
 */
const tenantNotEnforced = tenant.reports?.governance?.audit?.copy?.not_enforced ?? null
const packageNotEnforced = adopted.reports?.governance?.audit?.copy?.not_enforced ?? null
let authoredNotEnforced = false
if (!/recorded, not enforced/.test(String(packageNotEnforced))) {
  if (!/recorded, not enforced/.test(String(tenantNotEnforced))) {
    refusals.push(
      'reports.governance.audit.copy.not_enforced says "recorded, not enforced" in neither ' +
        `document — re-author ${PRIMARY}'s with \`npm run seed:governance\``,
    )
  } else {
    adopted.reports = {
      ...adopted.reports,
      governance: {
        ...adopted.reports.governance,
        audit: {
          ...adopted.reports.governance.audit,
          copy: { ...adopted.reports.governance.audit.copy, not_enforced: tenantNotEnforced },
        },
      },
    }
    authoredNotEnforced = true
  }
}

/* ---------------- a recorded check whose walk the canvas cannot show ---------------- */

/*
 * **A recorded sanity check is dropped when its walk does not resolve, and each one is named.**
 *
 * `validateDb` refuses a check that walks a node or an edge the canvas does not have, for the
 * reason it states: the check still reports "the graph can answer this" while the canvas
 * highlights one hop fewer than the answer claims. Same class of bug as a dangling edge, and it
 * fails by answering rather than by throwing.
 *
 * The CAPEX package trips it. Its canvas is real — 442 nodes, 908 edges, ids `E0001`… — but four
 * of its five recorded checks list `t1`…`t4` in `edges_used`, which are the package's own
 * traversal-step labels rather than canvas edge ids. Nothing here can turn one into the other:
 * guessing which of 908 edges `t1` meant would be inventing the evidence the check cites.
 *
 * So the unresolvable ones are **dropped rather than repaired or served**. An empty
 * `sanity_checks` is a state the section already handles — `npm run seed:dataset` writes one, and
 * the Query tab falls through to the live walk, which abstains. An abstention reads as "the draft
 * cannot answer this", which is honest; a written verdict lighting up the wrong sub-graph does not.
 * Checks that resolve are kept, so this costs only what it has to.
 *
 * Every drop is printed with the reference that failed, because a section that is quietly four
 * checks shorter reads as a package that shipped fewer. Fix the generator and re-adopt to get them
 * back.
 */
const canvasNodeIds = new Set(
  (adopted.graph_studio?.canvas?.nodes ?? []).map((n) => n.node_id),
)
const canvasEdgeIds = new Set(
  (adopted.graph_studio?.canvas?.edges ?? []).map((e) => e.edge_id),
)
const droppedChecks = []
const keptChecks = (adopted.graph_studio?.sanity_checks ?? []).filter((check) => {
  const missing = [
    ...(check.path ?? []).filter((id) => !canvasNodeIds.has(id)).map((id) => `node "${id}"`),
    ...(check.edges_used ?? []).filter((id) => !canvasEdgeIds.has(id)).map((id) => `edge "${id}"`),
  ]
  if (missing.length === 0) return true
  droppedChecks.push(`${check.check_id} walks ${missing.join(', ')}`)
  return false
})
if (adopted.reports?.resolved) {
  const ids = Object.keys(adopted.reports.resolved)
  console.log(
    `  carried ${ids.length} resolved report run(s) — ${ids.join(
)} — plus their specs; ` +
      'every figure they print is the resolver\u2019s, not recomputed here'
  )
}
if (droppedChecks.length > 0) {
  adopted.graph_studio = { ...adopted.graph_studio, sanity_checks: keptChecks }
}

/* ---------------- refuse to write something that cannot be served ---------------- */

/*
 * The same rule every script here follows: check before writing, so the failure lands in this
 * terminal rather than on the box that boots it. This cannot import `validateDb` — it lives inside
 * `server.mjs`, which starts a server on import — so it checks what *this* script decides, and the
 * boot is still the real gate.
 *
 * The spine check is the one worth stating: every report names a spine, and `reportRows` reads
 * `reports.data[spine]` for it. A spine with no roster behind it does not throw — the report renders
 * its authored tiles above an empty table, which reads as "nothing to report" rather than as a
 * missing roster.
 */
for (const report of adopted.reports?.reports ?? []) {
  const roster = adopted.reports?.data?.[report.spine]
  if (!Array.isArray(roster)) {
    refusals.push(
      `report "${report.report_id}" is asked over the "${report.spine}" spine, which ` +
        `reports.data ${report.spine in (adopted.reports?.data ?? {}) ? 'holds as something other than an array' : 'does not have'}`,
    )
  } else if (roster.length === 0) {
    refusals.push(
      `report "${report.report_id}" is asked over the "${report.spine}" spine, whose roster is empty`,
    )
  }
}

if (refusals.length > 0) {
  die(`refusing to write ${target}'s document:\n  · ${refusals.join('\n  · ')}`)
}

const outPath = join(root, 'mock-server', `db.${target}.json`)
await writeFile(outPath, `${JSON.stringify(adopted, null, 2)}\n`, 'utf8')

console.log(`adopt-dataset: wrote mock-server/db.${target}.json`)
console.log(`  ${Object.keys(adopted).length} keys, ${Object.keys(source).length} from the package`)
if (carried.length > 0) {
  console.log(`  carried from ${PRIMARY} (MERGE_PLAN marks each "primary"): ${carried.join(', ')}`)
}
if (setAside.length > 0) {
  console.log(
    `  set aside the package's own ${setAside.join(', ')} — the tenant's directory is one pool ` +
      'across datasets, and a persona is resolved against it',
  )
}
if (droppedChecks.length > 0) {
  console.log(
    `  dropped ${droppedChecks.length} recorded sanity check(s) whose walk is not on the canvas — ` +
      'the Query tab abstains instead of highlighting the wrong sub-graph:',
  )
  for (const dropped of droppedChecks) console.log(`      · ${dropped}`)
}
if (authoredNotEnforced) {
  console.log(`  carried ${PRIMARY}'s "recorded, not enforced" sentence — the package shipped null`)
}
console.log(`  push it with: npm run db:push -- ${target}`)
