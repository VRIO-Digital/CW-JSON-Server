/**
 * Trim CAPEX's shared drive to a readable corpus — `npm run seed:capex-drive-trim`.
 *
 * **Asked for as "show only 15 documents".** The shared *Capital Delivery Docs* drive shipped 36
 * contracts across five project folders, which is a long scroll in the Catalog and a long run to
 * watch. This takes it to 15.
 *
 * **Evenly, `PER_FOLDER` from each project, rather than the first 15 in order.** Taking the first
 * fifteen would have emptied the last two folders outright — two projects showing no documents at
 * all, which reads as data that failed to load rather than as a corpus somebody shortened. Every
 * project stays represented and every folder stays non-empty.
 *
 * **Within a folder it keeps the first rows as the document lists them**, which is the package's
 * own order: a scope document where there is one, then the contracts by their own reference. Nothing
 * is re-sorted, because an order chosen here would be this script deciding which contracts matter.
 *
 * **What it does not touch**, each for a reason:
 *
 *  - **My Drive.** Its documents are the working copies `seed:capex-drive` authors and five of them
 *    carry real chunk measurements; it holds six, which was never the complaint.
 *  - **`document_extractions`.** The rows for trimmed documents are left in place. They are keyed by
 *    `document_id` and nothing reaches them once the document is gone, so removing them would be a
 *    second edit with no visible effect — and leaving them is what lets this be undone by putting
 *    the documents back.
 *
 * **It is destructive to the document and re-runnable**, which is the awkward pair to hold: running
 * it twice must not take 15 down to 3. So it is a *floor* rather than a cut — a folder already at or
 * under the limit is left exactly as it is, and the script says when there was nothing to do.
 *
 * Recovering the full 36 is `git checkout backend/db.CAPEX.json`, or a re-run of the package ingest.
 *
 * Writes a file and only a file, like every other seed here. Push it with
 * `npm run db:push -- CAPEX`.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { DATASETS } from '../datasets.js'

const TARGET = 'CAPEX'
const DRIVE = 'capital-delivery-docs'

/** How many documents each project folder keeps. Five folders, so fifteen documents. */
const PER_FOLDER = 3

const die = (message) => {
  console.error(`\nseed-capex-drive-trim: ${message}\n`)
  process.exit(1)
}

const requested = (process.argv[2] ?? TARGET).trim()
if (requested !== TARGET) {
  die(`this seed trims ${TARGET}'s shared drive and nothing else — "${requested}" was asked for.`)
}
if (!DATASETS.includes(TARGET)) {
  die(`"${TARGET}" is not a declared dataset — this tenant has ${DATASETS.join(', ')}.`)
}

const name = `db.${TARGET}.json`
const path = new URL(`../${name}`, import.meta.url)

let doc
try {
  doc = JSON.parse(await readFile(path, 'utf8'))
} catch (error) {
  die(`could not read backend/${name} — ${error.message}\n  npm run db:pull -- ${TARGET}`)
}

const drive = (doc.drives ?? []).find((d) => d.drive_id === DRIVE)
if (!drive) {
  die(
    `this document has no drive "${DRIVE}" — it has ` +
      `${(doc.drives ?? []).map((d) => d.drive_id).join(', ') || '(none)'}`,
  )
}

const before = (drive.folders ?? []).reduce((n, f) => n + (f.documents ?? []).length, 0)
const lines = []
let removed = 0

for (const folder of drive.folders ?? []) {
  const docs = folder.documents ?? []
  /* A floor, not a cut: re-running must not take 3 down to 3 again and then lower. */
  if (docs.length <= PER_FOLDER) {
    lines.push(`    ${String(docs.length).padStart(2)}  ${folder.name} (already at or under)`)
    continue
  }
  folder.documents = docs.slice(0, PER_FOLDER)
  removed += docs.length - folder.documents.length
  lines.push(
    `    ${String(folder.documents.length).padStart(2)}  ${folder.name} (was ${docs.length})`,
  )
}

const after = (drive.folders ?? []).reduce((n, f) => n + (f.documents ?? []).length, 0)

/* A folder left empty is the failure this script's whole shape exists to avoid, so it is checked on
   what was written rather than assumed from the rule. */
const empty = (drive.folders ?? []).filter((f) => (f.documents ?? []).length === 0)
if (empty.length > 0) {
  die(
    `refusing to write: ${empty.length} folder(s) would hold no documents — ` +
      `${empty.map((f) => f.name).join(', ')}`,
  )
}

if (removed === 0) {
  console.log(
    `\nseed-capex-drive-trim: nothing to do — every folder is already at or under ` +
      `${PER_FOLDER} document(s), ${after} in total.\n`,
  )
  process.exit(0)
}

await writeFile(path, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')

console.log(
  `\nseed-capex-drive-trim: wrote backend/${name}\n` +
    `    ${DRIVE}: ${before} document(s) -> ${after}, ${removed} removed\n` +
    `${lines.join('\n')}\n\n` +
    "  My Drive and document_extractions are untouched. Put the full corpus back with\n" +
    `  git checkout backend/${name}. Push when happy:  npm run db:push -- ${TARGET}\n`,
)
