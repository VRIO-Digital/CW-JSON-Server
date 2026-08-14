/*
 * Loads mock-server/db.json into PostgreSQL. `npm run db:seed`
 *
 * **`db.json` is now a seed, not the store.** It is still what the ingest scripts write
 * — `ingest:graph`, `ingest:whatif`, `ingest:reports`, `seed:governance` all rebuild
 * subtrees of it from the demo package, and none of them know about a database. So the
 * chain is unchanged at the front and gains one step at the end:
 *
 *     demo package ──► npm run ingest:* ──► db.json ──► npm run db:seed ──► PostgreSQL
 *
 * The server no longer reads `db.json` at all. That is the thing to remember when an
 * edit to it appears to do nothing: re-seed, or the running process is answering from
 * a database that never saw the edit. It is the same stale-process trap the mock server
 * already has, one layer down, so the boot message names the seed's age.
 *
 * The write goes through the same `writeDb` every route's `commitDb` uses, in one
 * transaction — so a seed either lands whole or not at all, and seeding cannot produce
 * a shape a commit could not.
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { writeDb, loadDb, isSeeded, connectionAdvice, closePool, target } from '../mock-server/db/pg.mjs'
import { diff, tableOrder, toRows } from '../mock-server/db/mapping.mjs'
import { readJsonDb } from '../mock-server/db/read-json.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(here, '..', 'mock-server', 'db.json')

/*
 * Read through the diagnostic loader, not `JSON.parse`.
 *
 * `db.json` is generated *and* committed, so a pull over a re-seeded copy leaves conflict
 * markers in it — and a byte offset names nothing anybody can act on. That diagnosis used
 * to live at boot because that is where the file was read; it moved here with the file.
 */
const document = readJsonDb(
  DB_PATH,
  'mock-server/db.json',
  'git checkout HEAD -- mock-server/db.json && npm run seed:governance',
)
const rows = toRows(document)
const rowCount = tableOrder().reduce((n, s) => n + (rows[s.table] ?? []).length, 0)

try {
  const state = await isSeeded()
  if (!state.migrated) {
    console.error('\ndb:seed refused — the schema is not there yet. Apply it first:\n      npm run db:migrate\n')
    process.exit(1)
  }

  await writeDb(document)

  /*
   * Read it straight back and compare.
   *
   * `db:verify` proves the *mapper* is lossless without a database; this proves the
   * database is, which is a different claim — a type that round-trips in JS can still
   * come back as a string from `pg`, and that failure renders rather than throwing.
   * Seeding is the one moment both documents are in hand, so it is checked here.
   */
  const back = await loadDb()
  const problems = diff(document, back)
  if (problems.length > 0) {
    console.error(`\ndb:seed FAILED — what came back out of PostgreSQL is not what went in:\n`)
    for (const p of problems) console.error(`  ✗ ${p}`)
    console.error(
      '\nThis is a column type in mock-server/db/model.mjs, not a bad seed: numeric and\n' +
        'bigint come back from pg as strings. Counts are integer, fractions are double\n' +
        'precision — nothing else.\n',
    )
    process.exit(1)
  }

  console.log(
    `db:seed — wrote ${rowCount} rows across ${tableOrder().length} tables to ${target()}\n` +
      '  · read back and compared: the document in PostgreSQL matches mock-server/db.json',
  )
} catch (error) {
  console.error(`\ndb:seed failed — ${connectionAdvice(error)}\n`)
  process.exitCode = 1
} finally {
  await closePool()
}
