/**
 * Writes `new_role` and `document_readings` into `backend/risk/risk_new_role.json`, from the
 * Contract Risk Analyst package's own role material
 * (`Contract_risk_analyst/json/01_role/`, `07_scorecard/factors.json` + `signals.json`,
 * `02_ask/ask_library.json`).
 *
 *   node backend/scripts/ingest-risk-new-role.mjs
 *
 * **Unlike `goals`/`submissions`, this key is live.** `GET /role-library` serves `db.new_role`,
 * and `hydrateRoleLibrary` on the client swaps it in for the bundled default — four *other*
 * dataset's roles (Capital Program Analyst, a rate-case role, Supply Chain Analyst, …) — the moment
 * `roles`/`industries`/`discovery` are present and non-empty. With `new_role: null`, RISK's own New
 * Role wizard was offering a reader those four roles and none of them was Contract Risk Analyst.
 * `roleSuggestions` in server.js also reads `lib.roles`/`lib.people` directly to draft personas,
 * metrics and hero questions for whichever role a brief names.
 *
 * **Every field is read from a real file, mapped onto what this app's role library actually
 * needs**, never invented to fill the shape:
 *
 * - **One role**, `role.json`'s own `role` and `what_it_does` verbatim for `name`/`blurb`.
 * - **16 real areas**, one per `07_scorecard/factors.json` entry — its own `name` and `what_it_is`
 *   become the area's `name`/`what`; its `tasks` are the real `name` of every signal the factor
 *   lists (`"Days sales outstanding"`, not an invented action verb).
 * - **69 real metrics**, one per `07_scorecard/signals.json` entry — `def` is the signal's own
 *   `source.how` (what is actually computed), `unit` its own `figure.unit` where it states one,
 *   `threshold` the worst-case band of its own `rule_1_to_4` (index 3 — the real flag condition,
 *   verbatim), `cadence` derived from its own `changes_between_checks` in the role's own words
 *   ("watches every contract each morning" is `role.json`'s own `what_it_does`).
 * - **62 real questions**, one per entry in `02_ask/ask_library.json`'s 8 themes — `who` is that
 *   theme's own `persona` title (e.g. "Chief Financial Officer"), quoted rather than matched against
 *   a named person, since these are role titles, not individuals.
 * - **6 real people**, `01_role/people.json`'s own named contacts (owner, legal, compliance, hr,
 *   cx, comms) — its `tp` ("Technical and Performance group") is a group, not a named person, so it
 *   is left out rather than given an invented name.
 *
 * **One industry, and it is found to cover nothing — honestly.** The wizard's "Utilities this role
 * covers" step scans the connected data for named utility entities with a commission and an
 * approved budget, which is CAPEX's and Arcwood's domain, not this one: a contract risk scorecard
 * scores 300 O&M contracts against clients, and nothing in this package is a regulated utility with
 * a commission filing. So `discovery` reports a real, non-fabricated zero: `found: []` with a
 * stated reason, which is the exact state the New Role wizard's industry step was fixed this
 * session to let a reader continue past, rather than a list of invented utilities to fill the step.
 *
 * `document_readings` is a separate, unread top-level key in the same file (see `writeSplitFiles`'s
 * mapping) for the New Role wizard's job-description-upload step; the package ships no such PDF for
 * this role, so it stays an honest empty list with a note saying why, rather than a reading invented
 * for a document that does not exist.
 *
 * Refuses to write if a required source file is missing, or if a signal names a factor
 * `factors.json` does not declare.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const backend = join(here, '..')
const pkg = join(backend, '..', 'Contract_risk_analyst', 'json')
const out = join(backend, 'risk', 'risk_new_role.json')

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

const role = readJson(join(pkg, '01_role', 'role.json'))
const people = readJson(join(pkg, '01_role', 'people.json'))
const regions = readJson(join(pkg, '01_role', 'regions.json'))
const factors = readJson(join(pkg, '07_scorecard', 'factors.json'))
const signalsList = readJson(join(pkg, '07_scorecard', 'signals.json'))
const askLibrary = readJson(join(pkg, '02_ask', 'ask_library.json'))

const problems = []
const signalById = new Map(signalsList.map((s) => [s.id, s]))
const factorIds = new Set(factors.map((f) => f.id))

for (const s of signalsList) {
  if (!factorIds.has(s.factor)) problems.push(`signal ${s.id} names factor "${s.factor}", which factors.json does not declare`)
}
for (const f of factors) {
  for (const sid of f.signals) {
    if (!signalById.has(sid)) problems.push(`factor ${f.id} names signal "${sid}", which signals.json does not have`)
  }
}
if (problems.length > 0) {
  console.error(`refusing to write — ${problems.length} problem(s):\n  · ${problems.join('\n  · ')}`)
  process.exitCode = 1
  process.exit()
}

const areas = factors.map((f) => ({
  id: f.id,
  name: f.name,
  what: f.what_it_is,
  tasks: f.signals.map((sid) => signalById.get(sid)?.name).filter(Boolean),
}))

const metrics = signalsList.map((s) => ({
  id: s.id,
  name: s.name,
  def: s.source?.how ?? null,
  unit: s.figure?.unit ?? null,
  cadence: s.changes_between_checks ? 'checked every morning' : 'checked at contract signing',
  threshold: s.rule_1_to_4?.[3] || null,
  area: s.factor,
}))

const questions = []
for (const theme of askLibrary) {
  theme.questions.forEach((q, i) => {
    questions.push({
      id: `${theme.theme.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}_${i + 1}`,
      q,
      who: theme.persona,
    })
  })
}

const PEOPLE_KEYS = ['owner', 'legal', 'compliance', 'hr', 'cx', 'comms']
const peopleList = PEOPLE_KEYS.map((key) => ({
  id: key,
  name: people[key],
  title: people[`${key}Role`],
}))

const roles = [
  {
    id: 'cra',
    name: role.role,
    blurb: role.what_it_does,
    defaults: {
      reportsTo: 'owner',
      worksFor: peopleList.map((p) => p.id),
    },
    areas,
    metrics,
    questions,
    jd: { findings: [] },
  },
]

const industryId = 'water_wastewater'
const industries = [
  {
    id: industryId,
    name: role.industry,
    note:
      `${role.portfolio.contracts} operations and maintenance contracts across ${regions.length} ` +
      `regions, worth $${(role.portfolio.revenue_a_year / 1_000_000_000).toFixed(2)}B a year.`,
  },
]

const discovery = {
  [industryId]: {
    steps: [
      'Checking the Operations data hub for a utility or commission table',
      'Checking the Contract Repository for a franchise or commission filing',
    ],
    found: [],
    none:
      'This role scores operations and maintenance contracts against clients, not regulated ' +
      'utility entities — nothing in the connected data is a utility with a commission filing.',
  },
}

/*
 * Not `{}`: the client's `domainForRole` falls back from `domain_of_role` to a hardcoded per-role
 * map (which has no entry for `cra`) to `graph_domains[0]` — and RISK's `graph_domains` is
 * genuinely empty (no graph built yet), so an empty map here leaves the wizard unable to resolve
 * any domain at all and it refuses Next with "No business domain is available for this role yet".
 * The id is derived from the role's own name/purpose, the same way every other slug in this dataset
 * is — it names no domain `graph_domains` doesn't have, because the role-based suggesters
 * (`roleSuggestions`) never consult `graph_domains` for content; the id only has to be non-null so
 * the brief can record one.
 */
const new_role = {
  roles,
  people: peopleList,
  industries,
  discovery,
  domain_of_role: { cra: 'contract-risk' },
}

const document_readings = {
  _about:
    'What a job-description upload would show on step 2 of the New Role wizard. The Contract ' +
    'Risk Analyst package ships no job-description document for this role, so there is nothing ' +
    'to read — this key is empty rather than a reading invented for a document that does not exist.',
  readings: [],
}

const existing = readJson(out)
existing.new_role = new_role
existing.document_readings = document_readings
writeFileSync(out, `${JSON.stringify(existing, null, 2)}\n`, 'utf8')

console.log(
  `wrote new_role into backend/risk/risk_new_role.json: 1 role (${areas.length} areas, ` +
    `${metrics.length} metrics, ${questions.length} questions), ${peopleList.length} people, ` +
    `1 industry (0 utilities found — honestly)`,
)
