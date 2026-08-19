/*
 * Seeds `db.settings` — the Settings section's own subtree of `db.json`.
 *
 *     npm run seed:settings
 *
 * **It was `mock-server/settings.json`, a separate file, and the separation is now by key.** The
 * reasoning for two files was that a settings write could never touch a report and an ingest could
 * never drop a permission. Folding it in on request moved that guarantee rather than losing it:
 * `settings` is a `DB_SHAPE` key, so `validateDb` refuses a document without it and `commitDb`
 * validates it before **every** write — including a write from an ingest that rebuilt some other
 * subtree and forgot to carry this one forward, which is the exact failure the two files existed to
 * prevent and which `db.reports` has already suffered once.
 *
 * **What it does not hold is the persona pool.** The four personas are `db.auth_roles`, which is what
 * report audiences are validated against and what the login echoes back. This file names `role_id`s and
 * never a label, so there is one answer to "who exists" and this cannot drift from it. The seed refuses
 * to write a role id `db.json` does not have.
 *
 * Idempotent, and **it keeps whatever has been configured**: `nav_permissions` is only seeded for a
 * persona that has none. `defaults` is re-authored every run, because that is the thing this file is
 * the source of — Reset in the UI copies it over the live set.
 */
import { readFileSync, writeFileSync } from 'node:fs'

import { DATASETS, PRIMARY } from '../mock-server/datasets.mjs'

/*
 * Which dataset's settings to author — `npm run seed:settings` for the primary, or
 * `npm run seed:settings -- CAPEX` for another.
 *
 * **A secondary dataset's settings are its own, and this only fills the gaps.** The primary's block is
 * authored here in full, because this file is the source of it. A secondary dataset can arrive with a
 * complete block of its own — CAPEX does: a different tenant, five users at its own domain, four personas
 * of its own and its own locked row — and re-authoring that from the constants below would replace one
 * tenant's directory with another's. So for a secondary dataset this writes **only the blocks that are
 * missing**, and derives them from that document rather than from the constants here.
 *
 * This exists because `report_defaults` / `report_permissions` were added to `validateSettings` after
 * CAPEX's document was generated: it was internally consistent and the server still refused it, naming
 * this script as the fix. That refusal was right, and this is the fix it was naming.
 */
const dataset = (process.argv[2] ?? PRIMARY).trim()
if (!DATASETS.includes(dataset)) {
  console.error(
    `
seed-settings: "${dataset}" is not a declared dataset — this tenant has ${DATASETS.join(', ')}.
`,
  )
  process.exit(1)
}
const secondary = dataset !== PRIMARY

const DB = new URL(
  secondary ? `../mock-server/db.${dataset}.json` : '../mock-server/db.json',
  import.meta.url,
)

const db = JSON.parse(readFileSync(DB, 'utf8'))
/* Whatever is already configured, so a re-run keeps it — see the note on `nav_permissions` below. */
const existing = db.settings ?? {}

/*
 * The navigation keys a persona's access is configured over — the sidebar's own, in its order.
 *
 * Kept in step with `src/nav.ts` by `check-docs`, which compares the two and fails on a key here the
 * sidebar does not have (a permission nobody can exercise) or one there that is missing here (an item
 * no persona can hide). The server cannot import a `.tsx` module, so the list is written once here and
 * asserted rather than derived.
 *
 * **Nothing but keys goes inside the array.** The claim that compares the two parses this literal
 * by splitting on commas, so a comment in here — which has commas in it — is read as extra keys.
 * That is a brittle parse, but the fix belongs on this side: the list is data, and a note about it
 * is not.
 */
const NAV_KEYS = [
  'reports',
  'ask',
  'what-if',
  'new-graph',
  'sources',
  'catalog',
  'graph-studio',
  'audit',
  'settings',
]

/**
 * The four prototype users, one per persona.
 *
 * **This is what the login reads.** Signing in takes an email and a password; the role is *this* user's
 * role rather than something the form asks for, which is why there is no role picker any more. The
 * names are the tenant's own — Dana Whitfield and Ellis Hargrove author report definitions, Rei
 * Nakamura the custody report — so the section reads as part of the same demo.
 */
const USERS = [
  { id: 1, role_id: 'business_user_executive', name: 'Ellis Hargrove', email: 'ellis.hargrove@vriodigital.com' },
  { id: 2, role_id: 'domain_architect', name: 'Dana Whitfield', email: 'dana.whitfield@vriodigital.com' },
  { id: 3, role_id: 'business_user_project', name: 'Rei Nakamura', email: 'rei.nakamura@vriodigital.com' },
  { id: 4, role_id: 'platform_admin', name: 'Adaeze Okonjo', email: 'adaeze.okonjo@vriodigital.com' },
]

const on = (keys) => Object.fromEntries(NAV_KEYS.map((k) => [k, keys.includes(k)]))
const allExcept = (off) => Object.fromEntries(NAV_KEYS.map((k) => [k, !off.includes(k)]))

/**
 * Each persona's authored starting access.
 *
 * **Settings belongs to Platform Admin.** It is the page that administers every other persona, so it is
 * on and locked there and off everywhere else — off but *configurable*, so it can be granted without
 * editing this file. Platform Admin starts with nothing else, which is not a restriction but a starting
 * point: every other row on that persona is an ordinary toggle, and Settings staying on is what makes
 * turning them on possible.
 */
const DEFAULTS = {
  business_user_executive: allExcept(['settings']),
  domain_architect: allExcept(['settings']),
  business_user_project: allExcept(['settings']),
  platform_admin: on(['settings']),
}

/**
 * The one fixed toggle in the whole section.
 *
 * Read-only *on*, and only for Platform Admin: a persona that can reach Settings must not be able to
 * remove its own way back in. Every other row, on every persona, is configurable — including Settings
 * on the other three, which is how it gets granted.
 */
const READ_ONLY = { platform_admin: ['settings'] }

/**
 * The three acts a Library row offers, and each persona's authored starting access to them.
 *
 * **Written here because `server.mjs` cannot be imported by a seed**, the same reason `NAV_KEYS` is
 * written here — and `check-docs` compares this list to `REPORT_ACTIONS` for the same reason it
 * compares `NAV_KEYS` to `nav.ts`: an action here the server does not have is a permission `PATCH`
 * refuses, and one the server has that is missing here is a key `validateSettings` refuses to boot on.
 *
 * **The starting split follows the personas' own data scope rather than a guess.** Everyone may open a
 * report — the section is a reading surface, and a persona that cannot open one has no reason to be
 * offered the page at all. Editing a definition and deleting its governance row are the two acts that
 * change what a report *asserts*, so they start with the two personas whose scope already lets them
 * author: Domain Architect and Platform Admin. That is the same reasoning `may_author` in the
 * governance view applies, and it is a starting point rather than a restriction — every one of these is
 * an ordinary toggle.
 */
const REPORT_ACTIONS = ['open', 'edit', 'delete']
const reportAccess = (allowed) =>
  Object.fromEntries(REPORT_ACTIONS.map((a) => [a, allowed.includes(a)]))

const REPORT_DEFAULTS = {
  business_user_executive: reportAccess(['open']),
  domain_architect: reportAccess(['open', 'edit', 'delete']),
  business_user_project: reportAccess(['open']),
  platform_admin: reportAccess(['open', 'edit', 'delete']),
}

/* ------------------------------------------------------------------ checks */

const problems = []
const roleIds = db.auth_roles.map((r) => r.role_id)

/*
 * ---------------- a secondary dataset: derive the missing blocks from its own document ----------------
 *
 * Everything below the `if` is about the **primary's** authored constants and cannot apply to another
 * tenant: `DEFAULTS` and `REPORT_DEFAULTS` are keyed by EPA's role ids, so checking CAPEX's four personas
 * against them would report every one of them as missing a default.
 *
 * **And the report access is derived, not guessed.** CAPEX's own document states `may_author` per
 * *person* in `reports.governance.data_scope`, which is the same fact EPA's `may_author` expresses: a
 * persona that cannot see the underlying figures cannot define what a report asserts about them. So the
 * two authoring acts follow it, mapped person → persona through the document's own user list, and
 * everyone keeps `open` because the section is a reading surface.
 *
 * A persona whose people **disagree** about authoring is refused rather than resolved: the document's
 * model is per person there, and silently reducing it to per persona would grant a right one of them
 * lacks, or withhold one they have.
 */
if (secondary) {
  const settingsBlock = existing
  const byEmail = new Map(
    (settingsBlock.users ?? []).map((u) => [String(u.email).toLowerCase(), u.role_id]),
  )
  const authorByRole = new Map()
  for (const row of db.reports?.governance?.data_scope ?? []) {
    const roleId = byEmail.get(String(row.email ?? '').toLowerCase())
    if (!roleId) continue
    const seen = authorByRole.get(roleId)
    const mayAuthor = row.may_author === true
    if (seen === undefined) authorByRole.set(roleId, mayAuthor)
    else if (seen !== mayAuthor) authorByRole.set(roleId, 'split')
  }

  const derived = {}
  for (const roleId of roleIds) {
    const may = authorByRole.get(roleId)
    if (may === 'split') {
      problems.push(
        `persona "${roleId}" has people who disagree about may_author — the document states it per ` +
          'person, so it cannot be reduced to one report permission for the persona',
      )
      continue
    }
    /*
     * **Every persona starts with all three acts, and `may_author` is not what decides it.**
     *
     * Deriving them from the document's `may_author` looked principled and was wrong in practice: this
     * document marks its Platform Admin "No access yet", so the persona that administers the section
     * arrived unable to edit or delete a report — a Library whose Delete button is simply absent, which
     * reads as a broken card rather than as a permission.
     *
     * `may_author` is about **data scope** — whether a persona can see the figures a report asserts — and
     * these three are about which *controls* a Library row offers. Using one to decide the other conflated
     * two gates the rest of this app is careful to keep apart. So the authored start is permissive and the
     * narrowing is a decision somebody makes on **Settings → Report View**, which is what that tab is for.
     *
     * `may_author` is still read, and still refuses a persona whose people disagree about it: that
     * disagreement means the document's model is per person, which is worth stopping on whatever the
     * defaults are.
     */
    derived[roleId] = reportAccess(REPORT_ACTIONS)
  }

  if (problems.length > 0) {
    console.error('\nseed-settings: refusing to write —')
    for (const pr of problems) console.error('  · ' + pr)
    process.exit(1)
  }

  /*
   * **Only the missing blocks are written.** The users, the nav defaults, the live nav set and the locked
   * row are this dataset's own — a different tenant, its own people — and re-authoring them here would
   * replace one directory with another's. `report_permissions` starts from the derived defaults and keeps
   * whatever has already been configured, exactly as `nav_permissions` does for the primary.
   */
  const keptReports = Object.fromEntries(
    roleIds.map((roleId) => {
      const live = existing.report_permissions?.[roleId] ?? {}
      const kept = Object.fromEntries(
        REPORT_ACTIONS.filter((a) => typeof live[a] === 'boolean').map((a) => [a, live[a]]),
      )
      return [roleId, { ...derived[roleId], ...kept }]
    }),
  )

  const next = {
    ...existing,
    report_defaults: existing.report_defaults ?? derived,
    report_permissions: keptReports,
  }

  writeFileSync(DB, JSON.stringify({ ...db, settings: next }, null, 2) + '\n', 'utf8')
  console.log(
    `seed-settings (${dataset}): filled the missing report blocks for ${roleIds.length} personas — ` +
      roleIds
        .map((r) => `${r}=${REPORT_ACTIONS.filter((a) => keptReports[r][a]).join('/') || 'none'}`)
        .join(', ') +
      '\n  users, navigation and the locked row are this dataset’s own and were not touched.',
  )
  process.exit(0)
}

for (const u of USERS) {
  if (!roleIds.includes(u.role_id))
    problems.push(`user "${u.email}" is role "${u.role_id}", which db.auth_roles does not have`)
}
const emails = USERS.map((u) => u.email.toLowerCase())
if (new Set(emails).size !== emails.length) {
  problems.push('two users share an email — the login resolves a role by address, so it would be ambiguous')
}
for (const roleId of Object.keys(DEFAULTS)) {
  if (!roleIds.includes(roleId)) problems.push(`defaults name persona "${roleId}", which is not one`)
}
for (const roleId of roleIds) {
  if (!DEFAULTS[roleId])
    problems.push(`persona "${roleId}" has no default access — its sidebar would be undefined`)
}
/*
 * The report block, checked exactly as the navigation one is. A persona with no entry would resolve to
 * `{}` through `reportPermissionsFor`, and a row offering no actions at all is the symptom that got the
 * old access gate removed — so it is refused here rather than discovered on a card.
 */
for (const roleId of Object.keys(REPORT_DEFAULTS)) {
  if (!roleIds.includes(roleId)) problems.push(`report defaults name persona "${roleId}", which is not one`)
}
for (const roleId of roleIds) {
  if (!REPORT_DEFAULTS[roleId]) {
    problems.push(`persona "${roleId}" has no default report access — every row would offer it nothing`)
    continue
  }
  const keys = Object.keys(REPORT_DEFAULTS[roleId]).sort()
  if (keys.join(',') !== [...REPORT_ACTIONS].sort().join(',')) {
    problems.push(`"${roleId}" must carry exactly ${REPORT_ACTIONS.join(', ')} — it has ${keys.join(', ')}`)
  }
}
/* Nobody may be left unable to open a report: the page is a reading surface, so a persona with `open`
   off everywhere is one for whom the whole section is an empty list with no explanation. */
if (!Object.values(REPORT_DEFAULTS).some((r) => r.open)) {
  problems.push('no persona starts able to open a report — the Library would be unreadable for everyone')
}

for (const [roleId, keys] of Object.entries(READ_ONLY)) {
  if (!DEFAULTS[roleId]) problems.push(`read-only names persona "${roleId}", which has no defaults`)
  for (const key of keys) {
    if (!NAV_KEYS.includes(key)) problems.push(`read-only names "${key}", which is not a navigation item`)
    /* A locked *off* is a permission nobody can ever grant, which is a bug rather than a policy. */
    if (DEFAULTS[roleId]?.[key] !== true)
      problems.push(`"${roleId}" locks "${key}" but starts it off — a locked-off item can never be turned on`)
  }
}
/* Somebody has to be able to reach Settings, or the section administers nothing. */
if (!Object.values(DEFAULTS).some((perms) => perms.settings === true)) {
  problems.push('no persona starts with Settings — nobody could open the page that grants it')
}

if (problems.length > 0) {
  console.error('seed-settings: refusing to write —')
  for (const p of problems) console.error('  · ' + p)
  process.exit(1)
}

/* ------------------------------------------------------------------- write */

const settings = {
  users: USERS,
  /* Authored here and re-authored every run — this file is the source of the defaults. */
  defaults: DEFAULTS,
  read_only: READ_ONLY,
  /*
   * The live set, which is what the sidebar reads and the Settings page writes. Kept where it already
   * exists: these are somebody's decisions, and re-running the seed to pick up a new default should not
   * silently discard them. A persona with none starts from its defaults.
   *
   * **The carry-forward is narrowed to `NAV_KEYS`, and that is not tidiness.** A blind spread kept
   * whatever the old file held, so removing an item from the sidebar left its permission behind in the
   * live set while `defaults` — re-authored every run — lost it. `validateSettings` refuses exactly that
   * pair ("different navigation keys in defaults and nav_permissions"), so the seed would write a file
   * the server then refuses to boot on, naming this script as the fix. Removing `graphs` found it.
   */
  nav_permissions: Object.fromEntries(
    Object.keys(DEFAULTS).map((roleId) => {
      const live = existing.nav_permissions?.[roleId] ?? {}
      const kept = Object.fromEntries(
        NAV_KEYS.filter((k) => typeof live[k] === 'boolean').map((k) => [k, live[k]]),
      )
      return [roleId, { ...DEFAULTS[roleId], ...kept }]
    }),
  ),

  /* Authored every run, like `defaults` — this file is the source of both. */
  report_defaults: REPORT_DEFAULTS,

  /*
   * The live report access, carried forward exactly as `nav_permissions` is and narrowed to
   * `REPORT_ACTIONS` for the identical reason: a blind spread would keep a retired action in the live
   * set while `report_defaults` lost it, and `validateSettings` refuses that pair — so the seed would
   * write a file the server then refuses to boot on, naming this script as the fix.
   */
  report_permissions: Object.fromEntries(
    Object.keys(REPORT_DEFAULTS).map((roleId) => {
      const live = existing.report_permissions?.[roleId] ?? {}
      const kept = Object.fromEntries(
        REPORT_ACTIONS.filter((a) => typeof live[a] === 'boolean').map((a) => [a, live[a]]),
      )
      return [roleId, { ...REPORT_DEFAULTS[roleId], ...kept }]
    }),
  ),
}

/* One key replaced, every other carried through — the document is spread rather than rebuilt. A
   script that owns a subtree and rewrites its parent is how a subtree gets deleted. */
writeFileSync(DB, JSON.stringify({ ...db, settings }, null, 2) + '\n', 'utf8')
console.log(
  `seed-settings: ${USERS.length} users, ${Object.keys(DEFAULTS).length} personas, ` +
    `${NAV_KEYS.length} navigation items, ${REPORT_ACTIONS.length} report actions, ` +
    `${Object.values(READ_ONLY).flat().length} read-only rule(s).`,
)
