#!/usr/bin/env node
/**
 * Doc-drift gate.
 *
 * CLAUDE.md and SKILLS.md state facts about the code — how many connectors
 * exist, what the pipeline stages are called, which db.json keys are required.
 * Those go stale silently as features land, and a confidently wrong doc is worse
 * than no doc, because the next session trusts it.
 *
 * This asserts the claims against the source. When it fails, the code and the
 * docs disagree: fix whichever is wrong. Do not delete the assertion to pass.
 *
 *   node scripts/check-docs.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const problems = []
const checked = []

const ok = (label, detail) => checked.push(`${label} — ${detail}`)
const bad = (label, detail) => problems.push(`${label}: ${detail}`)

/** Asserts a condition, recording either way. */
function expect(label, condition, detail) {
  if (condition) ok(label, detail)
  else bad(label, detail)
}

/* ---------------- the documents must exist ---------------- */

for (const file of ['CLAUDE.md', 'SKILLS.md', 'docs/REGRESSIONS.md']) {
  if (!existsSync(join(root, file))) {
    bad(file, 'is missing — the work loop depends on it')
  }
}
if (problems.length > 0) {
  console.error('check-docs: FAILED\n')
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}

const claude = read('CLAUDE.md')
const skills = read('SKILLS.md')
const server = read('mock-server/server.mjs')
const connectors = read('src/data/connectors.ts')
const indexCss = read('src/index.css')
const theme = read('src/theme.ts')
const nav = read('src/nav.ts')
const jobsTab = read('src/components/ProfilingJobsTab.tsx')

/* ---------------- connectors ---------------- */

/*
 * Asserted by name rather than by a count in prose: a count can be written as a
 * word, and a stale hardcoded fallback would make the check pass forever. Adding
 * a connector fails this until SKILLS.md mentions it, which is the point.
 */
// `\r?\n` on both sides: git checks these files out with CRLF on Windows, and a
// split that assumed LF found zero connectors and reported "0 of 0 available"
// — a stale-doc failure that was really a stale regex.
const connectorBlocks = connectors.split(/\r?\n {2}\{\r?\n/).slice(1)
const connectorList = connectorBlocks
  .map((block) => ({
    name: (block.match(/name: '([^']+)'/) ?? [])[1],
    available: /available: true/.test(block),
    hasReason: /reason:/.test(block),
  }))
  .filter((c) => c.name)

/**
 * Prose says "BigQuery", not "Google BigQuery" — so match the distinctive part
 * of the name, not the whole vendor string. Still fails for a connector nobody
 * mentioned, which is what this is for.
 */
const distinctive = (name) =>
  name.replace(/^Google /, '').replace(/ bucket$/, '').trim()

for (const c of connectorList) {
  const token = distinctive(c.name)
  expect(
    `connector "${c.name}" documented`,
    skills.includes(c.name) ||
      claude.includes(c.name) ||
      skills.includes(token) ||
      claude.includes(token),
    `${c.available ? 'available' : 'vision'} — "${token}" must appear in SKILLS.md flow 1`,
  )
  if (!c.available) {
    expect(
      `connector "${c.name}" explains itself`,
      c.hasReason,
      'an unavailable connector needs a `reason`, or the card does nothing when clicked',
    )
  }
}

expect(
  'at least one connector is usable',
  connectorList.some((c) => c.available),
  `${connectorList.filter((c) => c.available).length} of ${connectorList.length} available`,
)

/* ---------------- profiling pipeline ---------------- */

const pipelineBlock = server.match(/const PIPELINE = \[([\s\S]*?)\]/)
const stages = pipelineBlock
  ? [...pipelineBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
  : []

expect('pipeline stage count', stages.length === 5, `${stages.length} stages in server.mjs`)

for (const stage of stages) {
  expect(
    `stage "${stage}" documented`,
    skills.includes(stage) || claude.includes(stage),
    'must appear in SKILLS.md flow 3',
  )
}

expect(
  'pipeline stage total in docs',
  skills.includes(`${stages.length} stages`) || skills.includes(`5/5`),
  `SKILLS.md should reflect ${stages.length}`,
)

/* ---------------- db.json required keys ---------------- */

const shapeBlock = server.match(/const DB_SHAPE = \{([\s\S]*?)\n\}/)
const requiredKeys = shapeBlock
  ? [...shapeBlock[1].matchAll(/^ {2}(\w+):/gm)].map((m) => m[1])
  : []

expect('db required-key count', requiredKeys.length > 0, `${requiredKeys.length} keys guarded`)
expect(
  'db required-key count documented',
  skills.includes(`${requiredKeys.length} required keys`) ||
    skills.includes(`all eight required keys`) ||
    claude.includes(`${requiredKeys.length} required`),
  `code guards ${requiredKeys.length}: ${requiredKeys.join(', ')}`,
)

const db = JSON.parse(read('mock-server/db.json'))
const dbKeys = Object.keys(db)
for (const key of requiredKeys) {
  expect(`db.json has "${key}"`, dbKeys.includes(key), 'DB_SHAPE requires it')
}

/* ---------------- use-case templates resolve ---------------- */

/*
 * A template is nothing but ids into three other pools, so a typo does not
 * throw — the member drops out and the step drafts five personas where the use
 * case names six. A short list reads as an answer, which is why this is checked
 * here as well as in `validateDb`: the server catches it at boot, and this
 * catches it before the server is ever started.
 */
for (const [memberKey, poolKey, idKey] of [
  ['personas', 'graph_personas', 'persona_id'],
  ['kpis', 'graph_kpis', 'kpi_id'],
  ['hero_questions', 'graph_hero_questions', 'question_id'],
]) {
  for (const template of db.graph_use_case_templates ?? []) {
    const missing = template[memberKey].filter(
      (id) => !db[poolKey].some((entry) => entry[idKey] === id),
    )
    expect(
      `template "${template.template_id}" ${memberKey} all resolve`,
      missing.length === 0,
      `not in ${poolKey}: ${missing.join(', ')}`,
    )
  }
}

/*
 * A phrase that appears in two templates' descriptions makes both score it, and
 * a tie deliberately matches neither — so a well-meaning edit here silently
 * turns a template off rather than breaking anything visible.
 */
const normalise = (s) => s.toLowerCase().replace(/\s+/g, ' ')
for (const template of db.graph_use_case_templates ?? []) {
  const own = normalise(template.description)
  const strays = template.match_phrases.filter(
    (phrase) =>
      !own.includes(phrase) ||
      (db.graph_use_case_templates ?? []).some(
        (other) =>
          other.template_id !== template.template_id &&
          normalise(other.description).includes(phrase),
      ),
  )
  expect(
    `template "${template.template_id}" phrases are its own and unique`,
    strays.length === 0,
    `absent from its description or shared with another template: ${strays.join(', ')}`,
  )
}

/* ---------------- every response is validated ---------------- */

/*
 * CLAUDE.md promises a schema for every endpoint, and the promise was quietly
 * broken for fourteen fetchers — mostly writes, whose results are rendered just
 * like a read's. A doc line cannot enforce this, so the shape of the code does:
 * an exported fetcher that calls `request<...>` must also call `validate(`.
 *
 * Deliberately crude — it reads each exported function/const body up to the next
 * export. A false positive means writing the schema, which is the point.
 */
const client = read('src/api/client.ts')

/** Every top-level declaration, exported or not, with its body. */
const declarations = client
  .split(/\n(?:export )?(?:async function|function|const) /)
  .slice(1)
  .map((chunk) => ({
    name: chunk.match(/^(\w+)/)?.[1] ?? '(anonymous)',
    exported: false,
    body: chunk,
  }))

// Helpers that validate on a fetcher's behalf — `withStudio` is one. A fetcher
// delegating to one of these is checked, just not in its own body.
const validators = new Set(
  declarations.filter((d) => /\bvalidate[<(]/.test(d.body)).map((d) => d.name),
)

// `request` is the transport itself — it has no shape of its own to check.
const fetchers = declarations.filter(
  (d) => d.name !== 'request' && /\brequest[<(]/.test(d.body),
)

expect(
  'client fetchers are found',
  fetchers.length > 20,
  `${fetchers.length} fetchers call request()`,
)

const unvalidated = fetchers.filter((f) => {
  if (/\bvalidate[<(]/.test(f.body)) return false
  // Delegating to a helper that validates counts, as long as it is not itself.
  return ![...validators].some(
    (helper) => helper !== f.name && new RegExp(`\\b${helper}\\s*\\(`).test(f.body),
  )
})
expect(
  'every fetcher validates its response',
  unvalidated.length === 0,
  unvalidated.length === 0
    ? `${fetchers.length} fetchers, all checked at the boundary`
    : `no schema in: ${unvalidated.map((f) => f.name).join(', ')} — ` +
      'add one in client.ts; a write answers with a shape too',
)

/* ---------------- where the API lives ---------------- */

/*
 * The API origin is per-environment, so it lives in .env.development /
 * .env.production and nowhere else. Two ways that quietly stops being true, and
 * both are cheap to catch:
 *
 *   · someone hardcodes the deployed host in client.ts to unblock themselves,
 *     and every developer's `npm run dev` starts writing to the shared box;
 *   · the .env files are deleted or renamed, and `VITE_API_BASE` silently
 *     resolves to undefined — which falls back to /api, so development still
 *     works and only the production build is broken, in a browser, later;
 *   · the two are collapsed into one plain `.env`, which Vite loads in *every*
 *     mode. That is the worst of the three, because it fails in the opposite
 *     direction: `npm run dev` starts calling the deployed box, the local mock
 *     server is bypassed, and every db.json edit and server.mjs change appears
 *     to do nothing. Nothing errors — the page just serves production's answers.
 *     This one has actually happened; see docs/REGRESSIONS.md.
 */
for (const file of ['.env.development', '.env.production']) {
  expect(
    `${file} exists`,
    existsSync(join(root, file)),
    'VITE_API_BASE is read from it at build time',
  )
}

const plainEnv = existsSync(join(root, '.env')) ? read('.env') : ''
expect(
  'no VITE_API_BASE in a plain .env',
  !/^\s*VITE_API_BASE\s*=/m.test(plainEnv),
  'a plain .env applies to every mode — put the origin in .env.production',
)

expect(
  'client.ts reads the API base from the environment',
  /import\.meta\.env\.VITE_API_BASE/.test(client),
  'BASE must come from VITE_API_BASE, defaulting to /api',
)

const hardcodedOrigins = [...client.matchAll(/'https?:\/\/[^']+'/g)].map((m) => m[0])
expect(
  'no hardcoded API origin in client.ts',
  hardcodedOrigins.length === 0,
  hardcodedOrigins.length === 0
    ? 'the origin is environment-owned'
    : `${hardcodedOrigins.join(', ')} — move it to .env.production`,
)

/* ---------------- the consent connects the signed-in user ---------------- */

/*
 * `/sources/oauth/callback` used to answer every caller with `db.google_account`,
 * so the wizard's "Connected as …" named one seeded person no matter who was
 * signed in. The identity is client-held, so the fix has four legs and all four
 * have to hold: the server must read `as`, the client must send it, the wizard
 * must take it from the auth store, and the alert must *render* the signed-in
 * email rather than whatever the payload echoed — that last one is what makes the
 * page right against an older or deployed server too. Asserted here rather than
 * noted, because any one going missing restores the seeded email silently — nothing
 * errors, it just shows the wrong human.
 */
const wizard = read('src/components/ConnectSourceWizard.tsx')
const callbackRoute = (server.split("p === '/sources/oauth/callback'")[1] ?? '').slice(
  0,
  3000,
)
expect(
  'consent callback reads the connecting account from the request',
  /query\.get\('as'\)/.test(callbackRoute) &&
    !/account: db\.google_account/.test(callbackRoute),
  '`as` names who signed in; db.google_account is the no-caller fallback only',
)
expect(
  'client.ts sends the signed-in email with the consent callback',
  /&as=\$\{encodeURIComponent\(signedInAs\)\}/.test(client) &&
    (client.match(/callbackPath\(state, '(bigquery|drive)', signedInAs\)/g) ?? [])
      .length === 2,
  'both oauthCallback and driveOauthCallback go through callbackPath',
)
expect(
  'the connect wizard takes that email from the auth store',
  /useAuthStore\(\(s\) => s\.identity\?\.email\)/.test(wizard) &&
    (wizard.match(/OauthCallback\(start\.state, signedInAs\)|oauthCallback\(start\.state, signedInAs\)/g) ?? [])
      .length === 2,
  'BigQuery and Drive both pass signedInAs to their callback',
)
expect(
  'the "Connected as" alert renders the signed-in email',
  /signedInAs \?\? account\.email/.test(wizard) &&
    (wizard.match(/Connected as <strong>\{connectedAs\}<\/strong>/g) ?? []).length === 2 &&
    !/Connected as <strong>\{account\.email\}/.test(wizard),
  'connectedAs prefers the auth store, so a stale server cannot name a stranger',
)

/* ---------------- spacing scale ---------------- */

const tokens = [...indexCss.matchAll(/--sp-(\d):/g)].map((m) => Number(m[1]))
expect('spacing scale present', tokens.length >= 9, `--sp-1..--sp-${Math.max(...tokens, 0)}`)
expect('SP mirror in theme.ts', /export const SP = \{/.test(theme), 'JSX side of the scale')

const cssFiles = [
  'src/index.css',
  'src/App.css',
  'src/pages/CataloguePage.css',
  'src/pages/DbEditorPage.css',
  'src/components/Sidebar.css',
  'src/components/NoSourceConnected.css',
  'src/components/ProfiledColumnsPanel.css',
  'src/components/ProfilingJobsTab.css',
  'src/components/ConnectSourceModal.css',
]
const rawPx = []
for (const file of cssFiles) {
  if (!existsSync(join(root, file))) continue
  const hits =
    read(file).match(
      /^\s*(margin|padding|gap|row-gap|column-gap)[^:]*:\s*[^;]*\b\d+px/gm,
    ) ?? []
  for (const hit of hits) rawPx.push(`${file}: ${hit.trim()}`)
}
expect(
  'no raw px spacing',
  rawPx.length === 0,
  rawPx.length === 0 ? 'all spacing uses --sp-*' : rawPx.join(' | '),
)

/* ---------------- poll interval ---------------- */

const pollMs = Number((jobsTab.match(/POLL_MS = (\d+)/) ?? [])[1])
expect(
  'poll interval matches the UI copy',
  jobsTab.includes('refreshing every ${POLL_MS / 1000}s'),
  `POLL_MS=${pollMs} is interpolated into the status line, so they cannot drift`,
)

/* ---------------- routes vs the server's own route list ---------------- */

const declared = new Set(
  [...server.matchAll(/^ \* {3}(GET|POST|PUT|PATCH|DELETE) +(\S+)/gm)].map(
    (m) => `${m[1]} ${m[2]}`,
  ),
)
const routeCount = (server.match(/^ {4}method: '/gm) ?? []).length
expect(
  'server documents its routes',
  declared.size > 0 && routeCount >= declared.size,
  `${routeCount} routes implemented, ${declared.size} listed in the header comment`,
)

/* ---------------- nav / route parity ---------------- */

const navKeys = [...nav.matchAll(/^ *\{ key: '(\w+)'|^ *key: '(\w+)',/gm)]
  .map((m) => m[1] ?? m[2])
  .filter(Boolean)
const dbInNav = /^\s*\{ key: 'db'/m.test(nav)
expect(
  'CLAUDE.md matches whether /db is in the sidebar',
  dbInNav
    ? !claude.includes('commented out of')
    : claude.includes('commented out of'),
  dbInNav ? '/db is in NAV_ITEMS' : '/db is routed but not in NAV_ITEMS',
)
expect('nav items parse', navKeys.length >= 5, `${navKeys.length} nav keys`)

/* ---------------- audit allowlist ---------------- */

const gate = read('scripts/audit-gate.mjs')
const waivers = [...gate.matchAll(/id: '(GHSA-[\w-]+)'/g)].map((m) => m[1])
for (const id of waivers) {
  expect(
    `waiver ${id} documented`,
    claude.includes(id),
    'CLAUDE.md must explain why it is waived',
  )
}

/* ---------------- report ---------------- */

if (problems.length === 0) {
  console.log(`check-docs: OK — ${checked.length} claims verified.`)
  process.exit(0)
}

console.error(`\ncheck-docs: FAILED — ${problems.length} of ${checked.length + problems.length} claims are stale.\n`)
for (const p of problems) console.error(`  ✗ ${p}`)
console.error(
  '\nThe code and the docs disagree. Fix whichever is wrong — do not remove the\n' +
    'assertion to make this pass. See .claude/skills/contextweave-flow/SKILL.md.\n',
)
process.exit(1)
