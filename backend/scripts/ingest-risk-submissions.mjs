/**
 * Writes `submissions` into `backend/risk/risk_submissions.json`, from the Contract Risk Analyst
 * package's own demo script (`Contract_risk_analyst/json/04_submissions/`).
 *
 *   node backend/scripts/ingest-risk-submissions.mjs
 *
 * Same reasoning as `ingest-risk-goals.mjs`, the twin this script is: `db.submissions` has no
 * route, no `DB_SHAPE` entry and no reader anywhere — RISK's own Submissions page is the vendored
 * `ContractRisk.html` prototype, same as every other dataset's is its own vendored file — but
 * CAPEX, Keolis, Arcwood and Supplychain all carry real content here regardless, and `null` left
 * RISK the one dataset where this unread-but-conventionally-real field was actually empty.
 *
 * **No pre-merged object to copy, so this builds one from `04_submissions/`'s own files
 * directly** — `dashboard_versions`, `dashboard_views`, `templates`, and the four
 * `submissions_*` snapshots (`after_first_scoring`, `after_morning_check`, `after_version_2`,
 * `session_end`) — each copied verbatim. CAPEX's own `submissions` key has a different shape
 * (`described_outlines`/`journey_make_more`/`output_formats`/`visuals`) describing a different
 * product's submission flow; this does not borrow it, the same reason the goals script does not
 * borrow CAPEX's journey taxonomy.
 *
 * Refuses to write if `04_submissions/` is missing a file this script expects.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const backend = join(here, '..')
const srcDir = join(backend, '..', 'Contract_risk_analyst', 'json', '04_submissions')
const out = join(backend, 'risk', 'risk_submissions.json')

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

const EXPECTED = [
  'dashboard_versions.json',
  'dashboard_views.json',
  'submissions_after_first_scoring.json',
  'submissions_after_morning_check.json',
  'submissions_after_version_2.json',
  'submissions_session_end.json',
  'templates.json',
]

const problems = []
for (const name of EXPECTED) {
  try {
    statSync(join(srcDir, name))
  } catch {
    problems.push(`missing ${name} under 04_submissions/`)
  }
}
if (problems.length > 0) {
  console.error(`refusing to write — ${problems.length} problem(s):\n  · ${problems.join('\n  · ')}`)
  process.exitCode = 1
  process.exit()
}

function readTree(dir) {
  const result = {}
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      result[entry] = readTree(full)
    } else if (entry.endsWith('.json')) {
      result[entry.slice(0, -'.json'.length)] = readJson(full)
    }
  }
  return result
}

const submissions = readTree(srcDir)

const existing = readJson(out)
existing.submissions = submissions
writeFileSync(out, `${JSON.stringify(existing, null, 2)}\n`, 'utf8')

console.log(
  `wrote submissions into backend/risk/risk_submissions.json: ${Object.keys(submissions).join(', ')}`,
)
