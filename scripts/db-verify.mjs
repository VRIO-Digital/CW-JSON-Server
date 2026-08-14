/*
 * Proves the relational model is lossless, without a database.
 *
 *     fromRows(toRows(db.json)) deep-equals db.json
 *
 * The dangerous half of putting this app on PostgreSQL is the shape, not the SQL: a
 * column that drops an optional key, an array that loses its order, a number that
 * comes back as a string. None of those throw — they render. So this runs the mapper
 * both ways over the real 450 KB document and names the first paths that differ.
 *
 * It is in `preflight`, so the model cannot gain a table and lose a key in the same
 * commit.
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { toRows, fromRows, diff, tableOrder } from '../mock-server/db/mapping.mjs'
import { readJsonDb } from '../mock-server/db/read-json.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(here, '..', 'mock-server', 'db.json')

const db = readJsonDb(
  DB_PATH,
  'mock-server/db.json',
  'git checkout HEAD -- mock-server/db.json && npm run seed:governance',
)

const rows = toRows(db)
const back = fromRows(rows)

const problems = diff(db, back)

const tables = tableOrder()
const populated = tables.filter((s) => (rows[s.table] ?? []).length > 0)
const rowCount = tables.reduce((n, s) => n + (rows[s.table] ?? []).length, 0)

console.log(
  `db:verify — ${tables.length} tables, ${populated.length} populated, ` +
    `${rowCount} rows from ${Object.keys(db).length} top-level keys`,
)

/*
 * A table with no rows is usually correct (`reports.saved` is empty, and so are the
 * registered sources) but it is also exactly what a mis-pathed root looks like, so it
 * is listed rather than left to be noticed.
 */
const empty = tables.filter((s) => (rows[s.table] ?? []).length === 0).map((s) => s.table)
if (empty.length > 0) console.log(`  · no rows: ${empty.join(', ')}`)

if (problems.length === 0) {
  console.log('  · round trip is exact — the rebuilt document deep-equals db.json')
  process.exit(0)
}

console.error(`\ndb:verify FAILED — the rebuilt document differs from db.json in ${problems.length}+ place(s):\n`)
for (const p of problems) console.error(`  ✗ ${p}`)
console.error(
  '\nFix mock-server/db/model.mjs — a missing column, a key that needs opt(), or a root\n' +
    'whose kind is wrong. Never relax this check: every difference here is a shape the\n' +
    'app would render wrongly with nothing throwing.\n',
)
process.exit(1)
