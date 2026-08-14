/*
 * ============================================================================
 *  The store — PostgreSQL behind the same document the routes already close over
 * ============================================================================
 *
 * The server has 9,000 lines of routes that read a `db` object. Re-pointing them one
 * by one at SQL would have been 9,000 lines of risk for no gain: what makes this
 * relational is the *schema* — 76 tables and 38 foreign keys, so a canvas edge cannot
 * name a node that is not there — not whether a handler writes its own SELECT.
 *
 * So the boundary is drawn here. `loadDb()` reads every table once at boot and hands
 * back the document; `commitDb()` writes a whole document back inside one transaction.
 * Every route, every validator and every `check-docs` claim is untouched, and the
 * integrity moves from "a function remembers to check" to "the database refuses".
 *
 * That is the same trade the app already makes elsewhere: the What-if lens computes on
 * the server and returns a whole answer rather than teaching the client to compute.
 *
 * ---------------------------------------------------------------------------
 *  What a transaction bought, and what it replaced
 * ---------------------------------------------------------------------------
 *
 * Writing `db.json` needed three guarantees put back by hand once the write became
 * async, and `docs/REGRESSIONS.md` records each of them: writes chained per path so two
 * commits could not interleave on one temp file, the in-memory swap before the first
 * `await` so a second handler could not read the pre-edit document, and a rollback so a
 * failed write could not leave memory ahead of the file.
 *
 * A transaction is all three, and it is one word. `BEGIN` … `COMMIT` serialises the
 * write, and a failure rolls the *whole* document back rather than leaving 40 tables
 * written and 36 not — which is the failure mode a file rename could not have, and the
 * one a table-per-key store would have gained if it were not transactional.
 *
 * The in-memory swap still happens before the first `await`, for exactly the reason it
 * did before: the routes read `db` synchronously, and a swap after the write opens a
 * window where two overlapping edits each read the pre-edit document and the second
 * silently drops the first. The rollback restores it.
 *
 * ---------------------------------------------------------------------------
 *  Two things the JSON file did for free, and how they are done here
 * ---------------------------------------------------------------------------
 *
 * **jsonb wants a string.** `pg` serialises a JS object to JSON for a jsonb parameter
 * but sends a JS *array* as a PostgreSQL array literal, which a jsonb column rejects —
 * so every jsonb value is stringified explicitly. A `rows` block is an array; it would
 * have failed on the first written answer that carried a table.
 *
 * **No `numeric`, no `bigint`.** Both come back from `pg` as strings, so a confidence
 * of `0.9` would return `'0.9'` and rebuild a document that no longer matches. The
 * model uses `integer` and `double precision` only, and `npm run db:verify` is what
 * proves it.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import pg from 'pg'

import { tableOrder, toRows, fromRows } from './mapping.mjs'
import { SCHEMA } from './model.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export const SCHEMA_PATH = join(here, 'schema.sql')

/*
 * Connection settings.
 *
 * **Local is the default at every layer**, the same rule `VITE_API_BASE` follows — a
 * fresh clone runs `npm run db:reset` with nothing configured. `DATABASE_URL` overrides
 * the lot for a deployed box.
 */
export const DB_NAME = process.env.DATABASE_URL
  ? decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1)) || 'contextweave'
  : (process.env.PGDATABASE ?? 'contextweave')

const settings = () =>
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.PGHOST ?? 'localhost',
        port: Number(process.env.PGPORT ?? 5432),
        user: process.env.PGUSER ?? 'postgres',
        password: process.env.PGPASSWORD ?? 'postgres',
        database: DB_NAME,
      }

/** Where a connection is being attempted, for an error message that names the box. */
export const target = () =>
  process.env.DATABASE_URL
    ? process.env.DATABASE_URL.replace(/:[^:@/]*@/, ':***@')
    : `${settings().user}@${settings().host}:${settings().port}/${settings().database}`

let pool = null

export function getPool() {
  if (!pool) pool = new pg.Pool(settings())
  return pool
}

export async function closePool() {
  if (pool) {
    await pool.end()
    pool = null
  }
}

/*
 * A connection failure is the single most likely thing to go wrong here, and
 * `ECONNREFUSED 127.0.0.1:5432` is not a sentence anybody can act on. This is the same
 * job `toMessage()` does for a fetch that fails in the browser — it names the command
 * that fixes it, because "is the database running" and "does the database exist" have
 * different answers.
 */
export function connectionAdvice(error) {
  const code = error?.code
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT') {
    return (
      `cannot reach PostgreSQL at ${target()} — start it, then create and seed:\n` +
      '      docker compose -f deploy/docker-compose.db.yml up -d\n' +
      '      npm run db:reset'
    )
  }
  if (code === '3D000') {
    return `no database "${DB_NAME}" on ${target()} — create and seed it:\n      npm run db:reset`
  }
  if (code === '42P01' || code === '3F000') {
    return (
      `the "${SCHEMA}" schema is not there (or is missing a table) on ${target()} — apply it:\n` +
      '      npm run db:migrate && npm run db:seed'
    )
  }
  if (code === '28P01' || code === '28000') {
    return `PostgreSQL refused the credentials for ${target()} — set PGUSER/PGPASSWORD, or DATABASE_URL`
  }
  return `${error?.message ?? error} (connecting to ${target()})`
}

/* ---------------------------------------------------------------------------
 *  Creating the database, and applying the schema
 * ------------------------------------------------------------------------- */

/**
 * `CREATE DATABASE`, which cannot run inside a transaction and cannot run from a
 * connection to the database it is creating — so this one connects to `postgres`
 * instead. Existing is not an error: creating twice is what a re-run looks like.
 */
export async function createDatabase() {
  let config
  if (process.env.DATABASE_URL) {
    /* Keep the credentials from the URL but point at the maintenance database. */
    const url = new URL(process.env.DATABASE_URL)
    url.pathname = '/postgres'
    config = { connectionString: url.toString() }
  } else {
    config = { ...settings(), database: 'postgres' }
  }

  const admin = new pg.Client(config)
  await admin.connect()
  try {
    const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME])
    if (found.rowCount > 0) return { created: false, database: DB_NAME }
    /* No parameter binding for an identifier — quoted through pg's own escaper. */
    await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(DB_NAME)}`)
    return { created: true, database: DB_NAME }
  } finally {
    await admin.end()
  }
}

/** Apply the committed `schema.sql`. It drops the schema first, so it is a rebuild. */
export async function migrate() {
  const sql = readFileSync(SCHEMA_PATH, 'utf8')
  const client = await getPool().connect()
  try {
    await client.query(sql)
  } finally {
    client.release()
  }
  return { tables: tableOrder().length }
}

/* ---------------------------------------------------------------------------
 *  Reading and writing the document
 * ------------------------------------------------------------------------- */

const q = (name) => `"${name}"`
const qual = (table) => `${q(SCHEMA)}.${q(table)}`

/** jsonb wants text; everything else goes as-is. See the note at the top. */
function bind(spec, row) {
  return spec._columns.map((c) => {
    const v = row[c.name]
    if (v === undefined) return null
    if (c.type === 'jsonb') return v === null ? null : JSON.stringify(v)
    return v
  })
}

/**
 * Read every table and rebuild the document.
 *
 * One query per table rather than one big join: the whole store is 1,363 rows, the
 * mapper wants tables anyway, and a join would have to be written per nesting level.
 */
export async function loadDb() {
  const client = await getPool().connect()
  try {
    const tables = {}
    for (const spec of tableOrder()) {
      const { rows } = await client.query(`SELECT * FROM ${qual(spec.table)}`)
      tables[spec.table] = rows
    }
    return fromRows(tables)
  } finally {
    client.release()
  }
}

/**
 * Replace the whole document, in one transaction.
 *
 * Delete-then-insert rather than a diff: the callers all hand over a whole document
 * (that is the `commitDb(next)` contract the routes were written against), and a diff
 * would be a second, cleverer answer to "what changed" that could disagree with the one
 * the caller already computed. 1,363 rows is not worth being clever about.
 */
export async function writeDb(document) {
  const rows = toRows(document)
  const client = await getPool().connect()

  try {
    await client.query('BEGIN')

    /* Children before parents, or a foreign key refuses the delete. */
    for (const spec of [...tableOrder()].reverse()) {
      await client.query(`DELETE FROM ${qual(spec.table)}`)
    }

    for (const spec of tableOrder()) {
      const list = rows[spec.table] ?? []
      if (list.length === 0) continue

      const cols = spec._columns.map((c) => q(c.name)).join(', ')
      /*
       * PostgreSQL takes at most 65,535 parameters in one statement, so a wide table
       * with many rows has to be sent in batches. 189 canvas nodes × 13 columns is
       * nowhere near it today — the cap is here so a bigger package does not turn into
       * a "bind message has N parameter formats" error nobody can read.
       */
      const perRow = spec._columns.length
      const batch = Math.max(1, Math.floor(60000 / perRow))

      for (let start = 0; start < list.length; start += batch) {
        const slice = list.slice(start, start + batch)
        const values = []
        const tuples = slice.map((row, n) => {
          const bound = bind(spec, row)
          values.push(...bound)
          return `(${bound.map((_, k) => `$${n * perRow + k + 1}`).join(', ')})`
        })
        await client.query(
          `INSERT INTO ${qual(spec.table)} (${cols}) VALUES ${tuples.join(', ')}`,
          values,
        )
      }
    }

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

/** Is the schema there and populated? Used by the boot check and by `db:seed`. */
export async function isSeeded() {
  const client = await getPool().connect()
  try {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1`,
      [SCHEMA],
    )
    if (rows[0].n === 0) return { migrated: false, seeded: false, tables: 0 }
    const seeded = await client.query(`SELECT count(*)::int AS n FROM ${qual('auth_roles')}`)
    return { migrated: true, seeded: seeded.rows[0].n > 0, tables: rows[0].n }
  } finally {
    client.release()
  }
}

export { SCHEMA, tableOrder }
