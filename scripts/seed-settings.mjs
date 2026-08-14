/*
 * Seeds `mock-server/settings.json` — the Settings section's own small database.
 *
 *     npm run seed:settings
 *
 * **A separate file from `db.json`, on purpose.** `db.json` is the tenant's *data*: sources, profiles,
 * the graph, the reports. This holds only what the Settings page administers — who the users are and
 * which navigation each persona may see — so a settings write can never touch a report, and re-running
 * an ingest can never drop a permission. It is also the reason `validateDb` says nothing about any of
 * this: two stores, two validators, one job each.
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
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const DB = new URL('../mock-server/db.json', import.meta.url)
const SETTINGS = new URL('../mock-server/settings.json', import.meta.url)

const db = JSON.parse(readFileSync(DB, 'utf8'))
const existing = existsSync(SETTINGS) ? JSON.parse(readFileSync(SETTINGS, 'utf8')) : {}

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
  'graphs',
  'new-graph',
  'ask',
  'reports',
  'sources',
  'catalogue',
  'graph-studio',
  'what-if',
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

/* ------------------------------------------------------------------ checks */

const problems = []
const roleIds = db.auth_roles.map((r) => r.role_id)

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
   */
  nav_permissions: Object.fromEntries(
    Object.keys(DEFAULTS).map((roleId) => [
      roleId,
      existing.nav_permissions?.[roleId]
        ? { ...DEFAULTS[roleId], ...existing.nav_permissions[roleId] }
        : { ...DEFAULTS[roleId] },
    ]),
  ),
}

writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n', 'utf8')
console.log(
  `seed-settings: ${USERS.length} users, ${Object.keys(DEFAULTS).length} personas, ` +
    `${NAV_KEYS.length} navigation items, ` +
    `${Object.values(READ_ONLY).flat().length} read-only rule(s).`,
)
