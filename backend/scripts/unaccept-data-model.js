/**
 * Return every stored declaration to *unaccepted* — `npm run unaccept:data-model [-- CAPEX]`.
 *
 * **Stored is not confirmed, and this script is how a document says so.** A relationship in
 * `data_model` carries `confirmed_by`: an address means somebody pressed Accept (or Save Overview)
 * and the row reads *Confirmed by you*; `null` means nobody has, and the row reads **Curated by
 * AI** with Accept offered. Both are true statements, and which one a document makes is a fact
 * about who sat here — so a document whose relationships were written in an earlier session, or by
 * a script, and then stamped with whoever happened to be signed in is claiming an acceptance that
 * never happened. That is the exact fault `confirmed_by` was added to fix, reported from use as
 * twelve relationships credited to a reader who had accepted none of them.
 *
 * So this clears the field rather than setting it. It writes `null` — never deletes the key — for
 * the reason every nullable field here is nullable at each layer: `null` is the honest answer to
 * "who accepted this", and an absent key and a null one must not come to mean two things.
 *
 * **Entities take the same clearing, in the same run.** `tableDeclarationState` reads an
 * entity-level `confirmed_by` that only Save Overview writes, and it draws the pill in the Entity
 * detail header. Leaving those stamped while the rows beneath them read *Curated by AI* would put
 * one table's status at odds with every relationship on it, which is the panel-arguing-with-itself
 * fault this repo records elsewhere. One act, both levels.
 *
 * **It is idempotent and it reports what it found**, because a script that prints nothing is
 * indistinguishable from one that matched nothing. A second run says zero and changes no bytes.
 *
 * Writes a file and only a file, like every other seed here. Push it with `npm run db:push`
 * (`-- CAPEX` for a secondary dataset).
 */

import { readFile, writeFile } from 'node:fs/promises'
import { DATASETS, PRIMARY } from '../datasets.js'

const die = (message) => {
  console.error(`\nunaccept-data-model: ${message}\n`)
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
   the plain `backend/db.json`, and only a secondary takes a suffix. */
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

const model = doc.data_model
if (model === null || typeof model !== 'object' || !Array.isArray(model.entities)) {
  die(
    `backend/${name} carries no usable data_model — there is nothing to unaccept.\n` +
      `  Give it one first:  npm run seed:data-model${secondary ? ` -- ${target}` : ''}`,
  )
}

/* ---------------- clear, counting rather than assuming ---------------- */

const clearedEntities = []
const clearedRelationships = []

for (const entity of model.entities) {
  if (entity.confirmed_by != null) {
    clearedEntities.push(`${entity.table_key} (was ${entity.confirmed_by})`)
  }
  entity.confirmed_by = null

  for (const rel of entity.relationships ?? []) {
    if (rel.confirmed_by != null) {
      clearedRelationships.push(
        `${entity.table_key} ${rel.relationship_type} → ${rel.target_table_key} (was ${rel.confirmed_by})`,
      )
    }
    rel.confirmed_by = null
  }
}

const relationshipTotal = model.entities.reduce(
  (sum, entity) => sum + (entity.relationships ?? []).length,
  0,
)

await writeFile(path, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')

console.log(
  `unaccept-data-model: backend/${name} — cleared ${clearedRelationships.length} of ` +
    `${relationshipTotal} relationship acceptance(s) and ${clearedEntities.length} of ` +
    `${model.entities.length} entity acceptance(s).\n` +
    `  Every relation now reads "Curated by AI" and offers Accept.`,
)
const shown = 8
for (const line of clearedRelationships.slice(0, shown)) console.log(`    ${line}`)
if (clearedRelationships.length > shown) {
  console.log(`    … and ${clearedRelationships.length - shown} more (cap stated, not silent).`)
}
for (const line of clearedEntities) console.log(`    entity ${line}`)
console.log(
  `  Push it when you are happy with the diff:  npm run db:push${secondary ? ` -- ${target}` : ''}`,
)
