/*
 * Creates the database. `npm run db:create`
 *
 * Separate from `db:migrate` because they fail differently and are fixed differently:
 * "PostgreSQL is not running" and "the schema is out of date" are not one problem, and
 * a single command that did both would report the first as the second.
 *
 * Creating twice is not an error — a re-run is the normal case.
 */

import { createDatabase, connectionAdvice, closePool, target } from '../mock-server/db/pg.mjs'

try {
  const { created, database } = await createDatabase()
  console.log(
    created
      ? `db:create — created database "${database}" on ${target()}\n  Next: npm run db:migrate && npm run db:seed`
      : `db:create — database "${database}" is already there on ${target()} (nothing to do)`,
  )
} catch (error) {
  console.error(`\ndb:create failed — ${connectionAdvice(error)}\n`)
  process.exitCode = 1
} finally {
  await closePool()
}
