/*
 * Seeds `db.reports.governance` — the governance facts the report section's three tabs render —
 * and pins `db.auth_roles` to the four app personas the frontend declares.
 *
 * Run it whenever the server refuses to boot naming `governance`, which is what a stale server
 * writing `db.json` back from memory does to a nested key it has never heard of:
 *
 *     node scripts/seed-report-governance.js
 *
 * Idempotent. The cross-references (a report id, a role id) are checked here and the write is
 * refused if one does not resolve, so a governance row naming a report that does not exist cannot
 * reach the server.
 *
 * **What is authored here and what is not.** Authored: a report's lifecycle state, its definition
 * version, its author, its category, the as-of date of the data it reads, its refresh schedule,
 * its approval, and which personas its audience names — governance decisions, none of which the
 * package implies. Derived at request time in `server.js` and never stored: every count, the
 * floor line, whether a report is parameterized, each entitlement cell, the publish checks and
 * the audit rows. A figure a component could compute is a second source for it.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const DB = new URL('../db.json', import.meta.url)
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
    status: 'published',
    version: 'v7',
    author: 'Dana Whitfield',
    category: 'Facility comparison',
    as_of: '2026-08-10',
    schedule: 'Weekly Mon 06:00 UTC',
    approval: 'two-person',
    audience: ['domain_architect', 'business_user_executive', 'business_user_project'],
    note: null,
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
    status: 'published',
    version: 'v2',
    author: 'Dana Whitfield',
    category: 'Enforcement exposure',
    as_of: '2026-08-10',
    schedule: 'On demand',
    approval: 'two-person',
    audience: ['domain_architect', 'business_user_executive'],
    note: 'Publishing widens nobody’s data scope — an entitled reader still sees only the rows their own predicate admits.',
  },
  trace: {
    status: 'published',
    version: 'v9',
    author: 'Rei Nakamura',
    category: 'Custody',
    as_of: '2026-06-30',
    schedule: 'On demand',
    approval: 'self-approved',
    audience: ['domain_architect', 'business_user_project'],
    note: 'Reads the five-trace manifest sample rather than the whole custody register — the floor line below says so.',
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
/*
 * `rule` is the machine form the Audit & Governance page edits; `predicate` is the prose the
 * tenant authored. **Seeded only where the prose says something this register can express.**
 *
 * Two predicates are literally TRUE, so those personas start `full` — that is a transcription, not
 * an interpretation. The other two are left with no rule: `receiving_facility` is not a column on
 * the generator register, and `FALSE — never a measure` is the absence of one. Inventing a rule to
 * fill those rows would put a restriction in the tenant's mouth, and the page's whole job is to let
 * somebody author the real one.
 */
const SCOPE = {
  domain_architect: {
    scope: 'All facilities, detail grain',
    predicate: 'TRUE — the only persona that sees derivation, lineage and cost',
    grain: 'manifest line',
    masked: 'none',
    may_author: true,
    full: true,
    mask: false,
    rule: null,
  },
  business_user_executive: {
    scope: 'All facilities, summary grain',
    predicate: 'TRUE — every inbound generator, figures only',
    grain: 'generator',
    masked: 'derivation, lineage, cost',
    may_author: false,
    full: true,
    mask: false,
    rule: null,
  },
  business_user_project: {
    scope: 'Assigned facility only',
    predicate: "receiving_facility = 'VLS Deer Park'",
    grain: 'generator',
    masked: 'derivation, lineage, cost',
    may_author: false,
    full: false,
    mask: false,
    rule: null,
  },
  platform_admin: {
    scope: 'No business figures',
    predicate: 'FALSE — structure, lineage, cost and access, never a measure',
    grain: '—',
    masked: 'every measure',
    may_author: false,
    full: false,
    mask: false,
    rule: null,
  },
}


/*
 * The publish dialog's copy.
 *
 * **Authored here, like every other governance decision, because the package does not ship it.**
 * The prototype's own dialog asks for a name and states that "a Domain Architect approves before
 * the audience sees it" — which stopped being true when the three-act model (publish → approve →
 * activate) was collapsed to publish/unpublish. A dialog promising an approval step that no code
 * performs is the one thing this section exists to avoid, so the sentence is replaced rather than
 * kept: publishing is immediate, and the readers are changeable afterwards.
 *
 * `ingest-reports.js` rebuilds `db.reports` and carries `governance` forward whole, so this
 * survives a re-ingest; re-running this seed re-authors it.
 */
const PUBLISHING_DEF = {
    title: 'Publish this report',
    republish_title: 'Publish your changes',
    /* States what publishing *is* here, in place of the approval claim it replaces. */
    lead: 'It goes live to the people you pick — no approval step. You can change readers or unpublish any time.',
    name: {
      label: 'Report name',
      help: 'Give it a name your audience will recognise in their library. You can rename it later.',
      placeholder: 'e.g. Inbound generator risk — Q3 2026',
    },
    readers: {
      label: 'Who can open it',
      placeholder: 'Type a name or email address…',
      empty: 'Nobody yet — this report will be private until you add a reader.',
      /*
       * Gate 1 and gate 2 in one sentence, and the order matters: picking a reader cannot widen
       * what they may see. The preview beside each person is their *declared* scope from
       * `data_scope`, never a filtered count — no roster here is filtered per persona, so a
       * figure like "sees 32 of 36" would state a filter that never ran.
       */
      note: 'Each person sees only what their data access rules allow — publishing never widens anyone’s access. Rules are managed in Audit & Governance; the preview above shows the result.',
      /* Required in these words wherever a client-held audience is recorded. */
      caveat:
        'This narrows who is shown the report. It is not access control: the role comes from the browser, and the API still serves every row to a caller that asks without one.',
      local_caveat:
        'This report is saved in your browser, so its readers are recorded here and nobody else can see them. It is not access control either.',
    },
    freshness: {
      label: 'Keep it fresh',
      /* One preset per recurrence, each stating its own sentence — the recurrence line is the
         tenant's words, never assembled in a component. `custom` interpolates {n}/{when}/{time}. */
      presets: [
        {
          id: 'open',
          label: 'Only when it’s opened',
          sentence: 'Re-runs against the live tables each time a reader opens it — no schedule.',
        },
        {
          id: 'daily',
          label: 'Every weekday (Mon–Fri) at 6:00 AM',
          sentence: 'Re-runs at 6:00 AM, Monday to Friday.',
        },
        {
          id: 'monday',
          label: 'Weekly on Monday at 6:00 AM',
          sentence: 'One re-run at the start of each week — Monday, 6:00 AM.',
        },
        {
          id: 'monthly',
          label: 'Monthly on the 1st at 6:00 AM',
          sentence: 'One re-run on the 1st of each month, 6:00 AM.',
        },
      ],
      default: 'open',
    },
    foot: 'Live immediately after you publish.',
    buttons: { publish: 'Publish report', republish: 'Publish update', cancel: 'Cancel' },
}

/*
 * The Audit & Governance page's copy.
 *
 * Authored here for the reason the publish dialog's is: the package ships no governance section,
 * and this script owns every governance decision. The three gate cards state what the page can and
 * cannot do — and the third one is the important sentence in the whole section: **a rule is
 * recorded, not enforced.** No roster in this app is filtered per persona, so a page that let you
 * author a restriction and then said nothing would be implying one runs.
 */
const AUDIT_DEF = {
  copy: {
    title: 'Audit & Governance',
    lead:
      'One place for who sees what. Authors decide who can open a report or scenario when they ' +
      'publish it; you decide which rows each persona may see — and every change here is recorded.',
    gates: [
      {
        key: 'open',
        title: 'Who can open it',
        detail:
          'Set by the author at publish time. Managed per report and per what-if below — a report ' +
          'names personas, a scenario names addresses, and neither is merged into the other.',
      },
      {
        key: 'scope',
        title: 'What they see inside',
        detail:
          'An access rule per persona: pick the field the restriction runs on, then the values ' +
          'they may see. It resolves against the live 36-generator register on every read.',
      },
      {
        key: 'trail',
        title: 'What has been recorded',
        detail:
          'Every rule change and every reader added or removed, with who did it. In memory, like ' +
          'publication — a restart forgets both together.',
      },
    ],
    /* The honesty note. Stated on the page, not only here. */
    not_enforced:
      'A rule is recorded, not enforced. No report or scenario in this app filters its rows per ' +
      'persona yet, so what a reader actually opens is unchanged by anything on this page — the ' +
      'resolution below says what the rule would admit, never what somebody saw.',
    empty_log: 'Nothing recorded yet. Change a rule or a reader and it appears here.',
    log_note:
      'Opens are not in this trail: nothing in this app serves a report to a reader, so an ' +
      '“opened” row would be an event that never happened.',
    basis_note:
      'The fields offered are the register’s own — its identity column plus every field the ' +
      'dictionary declares filterable. A field it does not declare cannot restrict anything.',
  },
  /* One per category the log can hold, in the order the chips show them. `all` leads and is not a
     stored category: it is everything, counted. */
  categories: [
    { key: 'all', label: 'All' },
    { key: 'rule', label: 'Rule changes' },
    { key: 'reader', label: 'Readers' },
    { key: 'publish', label: 'Publishing' },
  ],
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

/*
 * A seeded report entitled to nobody is refused, and **the API's Share action is not** — the two
 * are different surfaces. Private is a decision a reader makes on a row and the server records it;
 * an empty `audience` here is a maintainer's typo, and there is nothing on the seed's side to tell
 * the two apart. `validateDb` allows an empty audience for the same reason: once Share can set one,
 * the server has to boot with it.
 */
for (const [id, row] of Object.entries(REPORTS)) {
  if (row.audience.length === 0)
    problems.push(
      `report "${id}" is entitled to nobody — seed an audience, or make it private from Share`,
    )
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

/*
 * The publish dialog's own copy, checked for the failures that read as answers: a preset with no
 * sentence prints a blank freshness line under a control that plainly did something, and a default
 * naming no preset opens the select on nothing.
 */
const presetIds = PUBLISHING_DEF.freshness.presets.map((p) => p.id)
for (const p of PUBLISHING_DEF.freshness.presets) {
  if (!p.sentence) problems.push(`freshness preset "${p.id}" states no sentence — its line would be blank`)
}
if (!presetIds.includes(PUBLISHING_DEF.freshness.default)) {
  problems.push(
    `freshness default is "${PUBLISHING_DEF.freshness.default}", which is not one of the presets ` +
      `(${presetIds.join(', ')}) — the select would open on nothing`,
  )
}
/*
 * The claim the old dialog made and the code never kept. Refused here rather than only removed, so
 * nobody re-authors an approval step into copy while publish/unpublish is what actually happens.
 */
if (/approv/i.test(PUBLISHING_DEF.lead) && !/no approval/i.test(PUBLISHING_DEF.lead)) {
  problems.push(
    'the publish lead claims an approval step — publishing here is immediate, and a dialog that ' +
      'promises a sign-off nothing performs is the failure this section exists to avoid',
  )
}
/*
 * The one sentence the whole governance page turns on. A page that lets somebody author a
 * restriction and does not say it is unenforced implies one runs — which is the claim this repo
 * refuses everywhere else.
 */
if (!/recorded, not enforced/.test(AUDIT_DEF.copy.not_enforced)) {
  problems.push(
    'the audit copy must say a rule is "recorded, not enforced" — no roster here is filtered per ' +
      'persona, so a page that stays quiet about it implies a filter that never runs',
  )
}
if (!AUDIT_DEF.categories.some((c) => c.key === 'all')) {
  problems.push('the audit log has no "All" category — every other chip is a subset of it')
}
if (!PUBLISHING_DEF.readers.caveat.includes('not access control')) {
  problems.push(
    'the readers caveat must say "not access control" in those words — the role is client-held ' +
      'and the API serves every row to a caller that names none',
  )
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
   * tones are written — `server.js` reads the tone from here rather than keeping a second map,
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
  publishing: PUBLISHING_DEF,
  audit: AUDIT_DEF,
}


/*
 * `access_requests` held readers' asks for a report they were not entitled to, and this script used
 * to carry them forward. It went with the pending-approval state, so the key is dropped rather than
 * kept: a list nothing writes and nothing reads is a fact about the app that is no longer true.
 */
delete db.reports.access_requests

writeFileSync(DB, JSON.stringify(db, null, 2) + '\n', 'utf8')
console.log(
  `seed-report-governance: ${db.auth_roles.length} personas, ` +
    `${db.reports.governance.reports.length} governed reports, ` +
    `${db.reports.governance.data_scope.length} scope rows.`,
)
