/**
 * Give a dataset's document its `data_model` key — `npm run seed:data-model [-- CAPEX]`.
 *
 * **`data_model` is a required key holding nothing to begin with**, which is an odd pair until you
 * see what the alternative costs. The Data Modeling tab's declarations — the entity a curator wrote
 * for a table, the identifier they confirmed, the relationships they declared and the metrics built
 * on them — are somebody's work, written through `commitDb` so they survive a restart the way a
 * saved graph brief does. Losing the key does not throw: every card goes back to *Not yet declared*
 * and every edge off the canvas, which reads as a tenant that has modelled nothing rather than as
 * data that is gone. So `validateDb` requires it, and this is the command its refusal names.
 *
 * What it writes is `{ "entities": [] }` and nothing else. There is no seeded declaration, on
 * purpose: a relationship nobody drew is a claim about this tenant's schema, and the tab's own
 * suggestions run already derives candidates from the profiled columns — with `degraded: true` on
 * the payload, because there is no model behind this server and the tab says so.
 *
 * **It never rewrites a declaration that is already there.** A seed that owns a subtree and replaces
 * its parent is how a subtree gets deleted — the fault `ingest-reports.js` nearly committed against
 * `governance`. So an existing block is left exactly as it is, and a malformed one is *reported*
 * rather than flattened: the fix for a broken declaration is editing it, not losing it.
 *
 * Writes a file and only a file, like every other seed here. Push it with `npm run db:push`
 * (`-- CAPEX` for a secondary dataset).
 */

import { readFile, writeFile } from 'node:fs/promises'
import { DATASETS, PRIMARY } from '../datasets.js'

const die = (message) => {
  console.error(`\nseed-data-model: ${message}\n`)
  process.exit(1)
}

const target = (process.argv[2] ?? PRIMARY).trim()
if (!DATASETS.includes(target)) {
  die(
    `"${target}" is not a declared dataset — this tenant has ${DATASETS.join(', ')}.\n` +
      '  Add it to DATASETS in backend/datasets.js first, with its MERGE_PLAN entries.',
  )
}

/* The same naming `store.js`'s `localDocPath` gives a dataset's local stand-in: the primary keeps
   the plain `backend/db.json` every command in CLAUDE.md names, and only a secondary takes a
   suffix. */
const secondary = target !== PRIMARY
const name = secondary ? `db.${target}.json` : 'db.json'
const path = new URL(`../${name}`, import.meta.url)

let doc
try {
  doc = JSON.parse(await readFile(path, 'utf8'))
} catch (error) {
  die(
    `could not read ${target}'s document at backend/${name} — ${error.message}\n` +
      `  It is fetched rather than authored:\n      npm run db:pull${secondary ? ` -- ${target}` : ''}`,
  )
}

const existing = doc.data_model

if (existing === undefined) {
  doc.data_model = { entities: [] }
  await writeFile(path, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
  console.log(
    `seed-data-model: wrote data_model { entities: [] } to backend/${name}.\n` +
      `  Push it when you are happy with the diff:  npm run db:push${secondary ? ` -- ${target}` : ''}`,
  )
  process.exit(0)
}

/* ---------------- it is already there, so check it rather than replace it ---------------- */

if (existing === null || typeof existing !== 'object' || !Array.isArray(existing.entities)) {
  die(
    `backend/${name} already carries a data_model, and it is not ` +
      '{ "entities": [...] }.\n' +
      '  This seed will not overwrite declarations, so fix the block by hand (or in the /db editor) ' +
      'rather than losing what is in it.',
  )
}

/*
 * The one thing worth reporting: a declaration whose table the document no longer carries. It is
 * refused at boot — an entity on a table nobody has drops out of the tab silently, which reads as a
 * table nobody declared — so naming it here is what turns a failed boot into an edit.
 */
const tableKeys = new Set(
  (doc.projects ?? []).flatMap((p) =>
    (p.datasets ?? []).flatMap((d) =>
      (d.tables ?? []).map((t) => `${d.dataset_id}.${t.table_id}`),
    ),
  ),
)
const stranded = existing.entities.filter((e) => !tableKeys.has(e.table_key))

console.log(
  `seed-data-model: backend/${name} already carries data_model with ` +
    `${existing.entities.length} declaration(s) — left untouched.`,
)
if (stranded.length > 0) {
  console.log(
    `  ${stranded.length} of them name a table this document no longer carries, and the server ` +
      'will refuse to boot until each is edited or removed:',
  )
  for (const e of stranded) console.log(`    ${e.entity_id} → ${e.table_key}`)
}
