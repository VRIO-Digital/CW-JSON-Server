/**
 * Writes `goals` into `backend/risk/risk_goals.json`, from the Contract Risk Analyst package's own
 * demo script (`Contract_risk_analyst/json/03_goals/`).
 *
 *   node backend/scripts/ingest-risk-goals.mjs
 *
 * **It was `null`, on the reasoning that nothing reads it — which turned out to be only half the
 * fact.** `db.goals` has no route, no `DB_SHAPE` entry and no reader anywhere in `server.js` or the
 * frontend, for every dataset: RISK's own Goals page is the vendored `ContractRisk.html` prototype,
 * exactly as CAPEX's, Keolis's, Arcwood's and Supplychain's are their own vendored Goals/Submission
 * files (`goalsSubmissionFiles.ts`) — none of them call an API for this key. But all four of those
 * datasets carry real content here anyway, copied in from their own package's pre-merged document
 * (`ingest-arcwood-json.mjs` reads `00_merged/db.IRONBRIDGE.goals.json` verbatim). `null` was
 * therefore the odd one out: not a dead field treated consistently, but one dataset's left empty
 * where every sibling's is real.
 *
 * **There is no pre-merged `goals` object to copy — this package's `00_merged` file is a flat index
 * of every source file by path, not an assembled document — so this script builds one from
 * `03_goals/`'s own files**, the honest way the data actually exists: nested by the real folder and
 * file names rather than forced into CAPEX's own journey taxonomy (`once`/`watch`/`schedule`/
 * `generic`), which describes a different product's set of journey *kinds* that this package's
 * single real journey does not have. Every value is copied whole — nothing here is reshaped,
 * summarised or invented. A dataset reading this key in future gets RISK's own real demo script in
 * RISK's own real structure, not a shape borrowed from a dataset it was never written for.
 *
 * Refuses to write if `03_goals/` is missing a file this script expects.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const backend = join(here, '..')
const srcDir = join(backend, '..', 'Contract_risk_analyst', 'json', '03_goals')
const out = join(backend, 'risk', 'risk_goals.json')

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

const EXPECTED_TOP_LEVEL = [
  'journey_definition.json',
  'notifications_after_morning_check.json',
  'published_versions.json',
  'seeded_state.json',
  'session_end_state.json',
]

const problems = []
for (const name of EXPECTED_TOP_LEVEL) {
  try {
    statSync(join(srcDir, name))
  } catch {
    problems.push(`missing ${name} under 03_goals/`)
  }
}
if (problems.length > 0) {
  console.error(`refusing to write — ${problems.length} problem(s):\n  · ${problems.join('\n  · ')}`)
  process.exitCode = 1
  process.exit()
}

/** Walks a directory into a plain object keyed by filename-without-extension, recursing into subdirs. */
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

const goals = readTree(srcDir)

const existing = readJson(out)
existing.goals = goals
writeFileSync(out, `${JSON.stringify(existing, null, 2)}\n`, 'utf8')

console.log(
  `wrote goals into backend/risk/risk_goals.json: ${Object.keys(goals).length} top-level entries ` +
    `(journey_definition, notifications_after_morning_check, published_versions, seeded_state, ` +
    `session_end_state, transcripts — ${Object.keys(goals.transcripts ?? {}).length} transcript(s))`,
)
