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

const DB = new URL('../mock-server/db.json', import.meta.url)

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
 * Which persona each of the tenant's people signs in as.
 *
 * **This is what the login reads.** Signing in takes an email and a password; the role is *this*
 * user's role rather than something the form asks for, which is why there is no role picker any more.
 *
 * **The people are the document's, not this file's.** `db.reports.governance.data_scope` already names
 * every person the tenant has, with their address and the scope their reports are read under — so the
 * roster is read from there and only the *persona* is authored here. A name typed into this file would
 * be a second answer to "who exists", and the address is what report audiences and the What-if
 * publish dialog validate against, so the two must not drift. The seed refuses on a person the
 * document does not name, and on a person the document names that this map has no persona for.
 *
 * Each mapping is the persona whose `access_note` in `db.auth_roles` describes that person's own
 * scope row:
 *
 * - `sofia.lindqvist` — "All projects and all financials. Vendor commercial terms masked" is
 *   Data Analyst, word for word against her `Commercial terms masked` / `may_author` row.
 * - `dana.whitfield` — full scope, nothing masked, authors definitions: Domain Architect.
 * - `ellis.hargrove` — all 60, masked, authors nothing: the executive business user.
 * - `rei.nakamura` — also a business user, and business-unit scoped (8 of 60). CAPEX's pool has **no
 *   project-level business user**, so the scope stays where it is expressed — the `data_scope` row —
 *   rather than being turned into a persona this tenant does not declare.
 * - `adaeze.okonjo` — "No financial values", reports open empty: Platform Admin, which is the persona
 *   that administers the others rather than one that reads the figures.
 */
const PERSONA_FOR = {
  'sofia.lindqvist@northlinewater.com': 'analyst',
  'dana.whitfield@northlinewater.com': 'architect',
  'ellis.hargrove@northlinewater.com': 'business_user_exec',
  'rei.nakamura@northlinewater.com': 'business_user_exec',
  'adaeze.okonjo@northlinewater.com': 'admin',
}

const directory = db.reports?.governance?.data_scope ?? []
const USERS = directory
  .filter((row) => row.email)
  .map((row, i) => ({
    id: i + 1,
    role_id: PERSONA_FOR[String(row.email).toLowerCase()],
    name: row.name,
    email: row.email,
  }))

const on = (keys) => Object.fromEntries(NAV_KEYS.map((k) => [k, keys.includes(k)]))
const allExcept = (off) => Object.fromEntries(NAV_KEYS.map((k) => [k, !off.includes(k)]))

/**
 * The persona that administers the others, named once.
 *
 * Settings is on and **locked** here and off-but-configurable everywhere else, which is how it gets
 * granted. Written as an id rather than assumed to be last in the pool, and refused below if
 * `db.auth_roles` does not have it — a lock naming no persona is a lock nobody enforces.
 */
const ADMIN_ROLE = 'admin'

/**
 * Each persona's authored starting access, one entry per role in `db.auth_roles`.
 *
 * **Settings belongs to the admin persona.** It is the page that administers every other persona, so it
 * is on and locked there and off everywhere else — off but *configurable*, so it can be granted without
 * editing this file. That persona starts with nothing else, which is not a restriction but a starting
 * point: every other row on it is an ordinary toggle, and Settings staying on is what makes turning
 * them on possible.
 *
 * Derived from the pool rather than listed, so a fifth role is an `auth_roles` edit and a re-seed
 * rather than an edit here that is easy to forget — the check below still refuses a pool this cannot
 * cover.
 */
const DEFAULTS = Object.fromEntries(
  db.auth_roles.map((role) => [
    role.role_id,
    role.role_id === ADMIN_ROLE ? on(['settings']) : allExcept(['settings']),
  ]),
)

/**
 * The one fixed toggle in the whole section.
 *
 * Read-only *on*, and only for the admin persona: a persona that can reach Settings must not be able to
 * remove its own way back in. Every other row, on every persona, is configurable — including Settings
 * on the others, which is how it gets granted.
 */
const READ_ONLY = { [ADMIN_ROLE]: ['settings'] }

/* ------------------------------------------------------------------ checks */

const problems = []
const roleIds = db.auth_roles.map((r) => r.role_id)

if (directory.length === 0) {
  problems.push(
    'db.reports.governance.data_scope names nobody, so there is no roster to read — the login ' +
      'resolves a persona from it',
  )
}
if (!roleIds.includes(ADMIN_ROLE)) {
  problems.push(`the admin persona is "${ADMIN_ROLE}", which db.auth_roles does not have (${roleIds.join(', ')})`)
}

/*
 * **Both directions, because each fails differently.** A person the document names with no persona
 * here cannot sign in at all, and is also an address a report audience or a published scenario can
 * name — the publish dialog refuses a reader outside the directory, so the refusal would land on
 * somebody trying to share. A persona named here for somebody the document does not have is a user
 * invented in this file, which is the one thing it must not do.
 */
for (const row of directory) {
  if (!row.email) {
    problems.push(`a data_scope row for "${row.name ?? row.role_id}" carries no email`)
    continue
  }
  if (!PERSONA_FOR[String(row.email).toLowerCase()]) {
    problems.push(
      `db.reports.governance.data_scope names "${row.email}", which PERSONA_FOR has no persona for`,
    )
  }
  if (!row.name) problems.push(`the data_scope row for "${row.email}" carries no name`)
}
for (const email of Object.keys(PERSONA_FOR)) {
  if (!directory.some((row) => String(row.email).toLowerCase() === email)) {
    problems.push(`PERSONA_FOR names "${email}", whom db.reports.governance.data_scope does not`)
  }
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
}

/* One key replaced, every other carried through — the document is spread rather than rebuilt. A
   script that owns a subtree and rewrites its parent is how a subtree gets deleted. */
writeFileSync(DB, JSON.stringify({ ...db, settings }, null, 2) + '\n', 'utf8')
console.log(
  `seed-settings: ${USERS.length} users, ${Object.keys(DEFAULTS).length} personas, ` +
    `${NAV_KEYS.length} navigation items, ` +
    `${Object.values(READ_ONLY).flat().length} read-only rule(s).`,
)
