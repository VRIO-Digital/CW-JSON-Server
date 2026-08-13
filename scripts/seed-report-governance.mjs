/*
 * Seeds `db.reports.governance` — the governance facts the report section's three tabs render —
 * and pins `db.auth_roles` to the four app personas the frontend declares.
 *
 * Run it whenever the server refuses to boot naming `governance`, which is what a stale server
 * writing `db.json` back from memory does to a nested key it has never heard of:
 *
 *     node scripts/seed-report-governance.mjs
 *
 * Idempotent. The cross-references (a report id, a role id) are checked here and the write is
 * refused if one does not resolve, so a governance row naming a report that does not exist cannot
 * reach the server.
 *
 * **What is authored here and what is not.** Authored: a report's lifecycle state, its definition
 * version, its author, its category, the as-of date of the data it reads, its refresh schedule,
 * its approval, and which personas its audience names — governance decisions, none of which the
 * package implies. Derived at request time in `server.mjs` and never stored: every count, the
 * floor line, whether a report is parameterized, each entitlement cell, the publish checks and
 * the audit rows. A figure a component could compute is a second source for it.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const DB = new URL('../mock-server/db.json', import.meta.url)
const db = JSON.parse(readFileSync(DB, 'utf8'))

/*
 * The four app personas, which are also the login's pool and the pool a report audience is
 * validated against. The frontend declares them in `src/data/personas.ts`; this keeps the
 * server's copy identical, and `check-docs` fails if the two drift on id, label or note.
 */
const PERSONAS = [
  {
    role_id: 'business_user_executive',
    label: 'Business User — Executive',
    access_note: 'Business figures and KPI answers only. No underlying structure exposed.',
  },
  {
    role_id: 'domain_architect',
    label: 'Domain Architect',
    access_note: 'No cost or business figures. Structure and lineage for owned domains only.',
  },
  {
    role_id: 'business_user_project',
    label: 'Business User — Project Level',
    access_note:
      'Business figures for the assigned project only. No underlying structure exposed.',
  },
  {
    role_id: 'platform_admin',
    label: 'Platform Admin',
    access_note: 'No business figures. Structure, lineage, cost and access only.',
  },
]

/*
 * The lifecycle a report definition moves through, and the chip bar's own order.
 *
 * `blocked` is not `pending_approval` with worse manners: pending is waiting on a person, blocked
 * names a precondition that fails, so it carries `crit` and the row says which check it fails.
 * Both are *current* — only `archived` is not.
 */
const STATUSES = [
  { key: 'published', label: 'Published', tone: 'good' },
  { key: 'pending_approval', label: 'Pending approval', tone: 'warn' },
  { key: 'blocked', label: 'Blocked', tone: 'crit' },
  { key: 'archived', label: 'Archived', tone: 'neutral' },
]

const REPORTS = {
  risk: {
    status: 'published',
    version: 'v13',
    author: 'Dana Whitfield',
    category: 'Inbound risk',
    as_of: '2026-08-10',
    schedule: 'Daily 07:00 UTC',
    approval: 'two-person',
    audience: ['domain_architect', 'business_user_executive', 'business_user_project'],
    note: null,
  },
  facility: {
    status: 'blocked',
    version: 'v7',
    author: 'Dana Whitfield',
    category: 'Facility comparison',
    as_of: '2026-08-10',
    schedule: 'Weekly Mon 06:00 UTC',
    /*
     * Null, so the publish check that reads it fails — a blocked definition has to be blocked
     * on something a reader can see, not on a label. What separates it from `pending_approval`
     * is the note: pending is waiting on a person who means to approve, blocked names a reason
     * approving it as written would be wrong.
     */
    approval: null,
    audience: ['domain_architect', 'business_user_executive', 'business_user_project'],
    note: 'Approval withdrawn: gate 1 names Business User — Project Level, whose data scope admits one facility, and the scorecard compares five. Either the audience narrows or the scope widens — publishing it as written would settle that by showing rows the predicate excludes.',
  },
  quarterly: {
    status: 'published',
    version: 'v4',
    author: 'Ellis Hargrove',
    category: 'Volume & trend',
    as_of: '2026-08-10',
    schedule: 'Monthly 1st 06:00 UTC',
    approval: 'self-approved',
    audience: ['domain_architect', 'business_user_executive'],
    note: null,
  },
  cd: {
    status: 'pending_approval',
    version: 'v2',
    author: 'Dana Whitfield',
    category: 'Enforcement exposure',
    as_of: '2026-08-10',
    schedule: 'On demand',
    approval: null,
    audience: ['domain_architect', 'business_user_executive'],
    note: 'Submitted and awaiting a second person. Not visible to its audience until published — and publishing widens nobody’s data scope.',
  },
  trace: {
    status: 'archived',
    version: 'v9',
    author: 'Rei Nakamura',
    category: 'Custody',
    as_of: '2026-06-30',
    schedule: 'On demand',
    approval: 'self-approved',
    audience: ['domain_architect', 'business_user_project'],
    note: 'Archived when the manifest sample was cut to five traces. Opens by link for anyone entitled; it is not listed as current.',
  },
}

/*
 * Gate 2 — the data scope each persona carries.
 *
 * **Declared, not applied**, and the page says so where it is shown: no roster in this prototype
 * is filtered per persona, so applying a predicate would invent a filter and stating one silently
 * would claim a filter that never ran. That is the horizon's rule, and it is the honest way to
 * demo row scoping with no warehouse behind it.
 */
const SCOPE = {
  domain_architect: {
    scope: 'All facilities, detail grain',
    predicate: 'TRUE — the only persona that sees derivation, lineage and cost',
    grain: 'manifest line',
    masked: 'none',
    may_author: true,
  },
  business_user_executive: {
    scope: 'All facilities, summary grain',
    predicate: 'TRUE — every inbound generator, figures only',
    grain: 'generator',
    masked: 'derivation, lineage, cost',
    may_author: false,
  },
  business_user_project: {
    scope: 'Assigned facility only',
    predicate: "receiving_facility = 'VLS Deer Park'",
    grain: 'generator',
    masked: 'derivation, lineage, cost',
    may_author: false,
  },
  platform_admin: {
    scope: 'No business figures',
    predicate: 'FALSE — structure, lineage, cost and access, never a measure',
    grain: '—',
    masked: 'every measure',
    may_author: false,
  },
}

const problems = []
const ids = db.reports.reports.map((r) => r.report_id)
const roleIds = PERSONAS.map((p) => p.role_id)

for (const id of Object.keys(REPORTS)) {
  if (!ids.includes(id))
    problems.push(`governance names report "${id}", which db.reports.reports does not have`)
}
for (const id of ids) {
  if (!REPORTS[id]) problems.push(`report "${id}" has no governance row — every report needs a status`)
}
/*
 * A status the state pool does not declare is the silent one: it has no label, so the card prints
 * the raw key, and it matches no chip — so the row is reachable only under "All current" and every
 * other chip under-counts by one. Neither throws.
 */
const stateKeys = STATUSES.map((s) => s.key)
for (const [id, row] of Object.entries(REPORTS)) {
  if (!stateKeys.includes(row.status))
    problems.push(
      `report "${id}" is "${row.status}", which is not one of the lifecycle states ` +
        `(${stateKeys.join(', ')}) — it would match no chip`,
    )
}

for (const [id, row] of Object.entries(REPORTS)) {
  if (row.audience.length === 0) problems.push(`report "${id}" is entitled to nobody`)
  for (const role of row.audience) {
    if (!roleIds.includes(role))
      problems.push(`report "${id}" is entitled to "${role}", which is not one of the personas`)
  }
}
for (const role of roleIds) {
  if (!SCOPE[role])
    problems.push(`persona "${role}" has no data scope row — gate 2 would show a blank predicate`)
}
for (const role of Object.keys(SCOPE)) {
  if (!roleIds.includes(role)) problems.push(`data scope names "${role}", which is not a persona`)
}
if (!Object.values(SCOPE).some((s) => s.may_author)) {
  problems.push('no persona may author — the Author tab would refuse everyone')
}

/*
 * A saved report's audience must survive this write. Personas are also report-audience role ids,
 * so dropping one that a saved row names would leave a row visible to nobody.
 */
for (const saved of db.reports.saved ?? []) {
  for (const role of saved.viewer_roles ?? []) {
    if (!roleIds.includes(role))
      problems.push(`saved report "${saved.saved_id}" is visible to "${role}", which is not a persona`)
  }
}

if (problems.length > 0) {
  console.error('seed-report-governance: refusing to write —')
  for (const p of problems) console.error('  · ' + p)
  process.exit(1)
}

db.auth_roles = PERSONAS

db.reports.governance = {
  /*
   * The lifecycle states, in the order the chips show them, and the one place their labels and
   * tones are written — `server.mjs` reads the tone from here rather than keeping a second map,
   * because a state tinted `warn` on a card and `neutral` on a chip is two answers to what it is.
   *
   * `current` is not one of them: it is everything not archived, computed, because that is what a
   * reader means by "current". A blocked definition is current — it is this quarter's problem.
   */
  statuses: STATUSES,
  reports: Object.entries(REPORTS).map(([report_id, row]) => ({ report_id, ...row })),
  data_scope: Object.entries(SCOPE).map(([role_id, row]) => ({ role_id, ...row })),
  /* The copy the Operations tab leads with. Served rather than held in the component, so the
     page cannot print a second version of it. */
  gate_notes: {
    both: 'Two grids, administered separately, never collapsed into one. The first says who may see that a report exists. The second says which rows a viewer’s predicate admits. Merging them produces a single permission that is wrong in both directions — over-broad for the executive, over-narrow for the auditor.',
    entitlement:
      'Audience entitlement (gate 1) — who may see that a report EXISTS. It says nothing about which rows a viewer’s predicate admits; that is gate 2 below. A viewer can be entitled to a report and correctly see zero rows in it.',
    data_scope:
      'Data scope (gate 2) — which rows a session’s predicate admits and which columns are masked. Declared here and not applied: no roster in this prototype is filtered per persona, so a predicate that silently ran would claim a filter this mock does not have.',
    author:
      'Writing a new report definition is a separate permission because a report is a governed object — once published it is what an audience treats as the truth. Authoring rides on the data scope, not on the job title: a persona that cannot see the underlying figures cannot define what a report asserts about them.',
  },
}

writeFileSync(DB, JSON.stringify(db, null, 2) + '\n', 'utf8')
console.log(
  `seed-report-governance: ${db.auth_roles.length} personas, ` +
    `${db.reports.governance.reports.length} governed reports, ` +
    `${db.reports.governance.data_scope.length} scope rows.`,
)
