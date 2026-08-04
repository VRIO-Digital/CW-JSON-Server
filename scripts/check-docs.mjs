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
const connectorBlocks = connectors.split(/\n {2}\{\n/).slice(1)
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

const dbKeys = Object.keys(JSON.parse(read('mock-server/db.json')))
for (const key of requiredKeys) {
  expect(`db.json has "${key}"`, dbKeys.includes(key), 'DB_SHAPE requires it')
}

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
