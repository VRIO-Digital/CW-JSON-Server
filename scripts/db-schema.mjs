/*
 * Writes mock-server/db/schema.sql from the model.
 *
 * The file is generated *and* committed, like db.json: a schema is the thing a
 * reviewer wants to read in a diff, and deriving it at migrate time would mean nobody
 * ever sees the table a model change added. `check-docs` regenerates it in memory and
 * fails if the committed copy differs, so the two cannot drift.
 *
 *     npm run db:schema
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { schemaSql } from '../mock-server/db/schema.mjs'
import { tableOrder } from '../mock-server/db/mapping.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export const SCHEMA_PATH = join(here, '..', 'mock-server', 'db', 'schema.sql')

const sql = schemaSql()
const before = existsSync(SCHEMA_PATH) ? readFileSync(SCHEMA_PATH, 'utf8') : null

writeFileSync(SCHEMA_PATH, sql, 'utf8')

const tables = tableOrder().length
const statements = sql.split('\n').filter((l) => /^(CREATE TABLE|ALTER TABLE|CREATE INDEX)/.test(l)).length

console.log(
  `db:schema — wrote mock-server/db/schema.sql: ${tables} tables, ${statements} statements` +
    `${before === sql ? ' (unchanged)' : ''}`,
)
