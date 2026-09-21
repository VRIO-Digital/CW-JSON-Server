/**
 * Give CAPEX's drive documents a file format and chunk figures — `npm run seed:capex-drive-chunks`.
 *
 * **Read this first: these chunk figures are DERIVED, not measured.** Everything else in this repo
 * that states a page count, a chunk count or an extracted-character count reports a real run —
 * `mail_corpus` comes out of `backend/data/capex-mail-chunks.json`, and My Drive's five markups come
 * out of the same export. The shared drive's 36 documents have **no export behind them**: nothing
 * has ever chunked them. This script computes a figure for each so the Catalog's columns are
 * populated for the demo, which was asked for directly after the alternative — an em dash on every
 * row — was tried and rejected.
 *
 * **What that costs is the thing to keep in view.** A derived figure sits in the same column as a
 * measured one and nothing on screen tells them apart. That is exactly the hazard `mail_corpus`'s
 * own note describes when it explains why the authored corpus was replaced by a real export. Two
 * things keep it as honest as a derivation can be:
 *
 *  - **It never overwrites a measurement.** A document that already carries `chunk_count` is left
 *    alone, so My Drive's five real rows stay real and re-running this cannot quietly replace them.
 *  - **`chunks_derived: true` is written on every row it computes**, so which figures are invented
 *    is a fact in the document rather than something to work out from which drive a file sits in.
 *    Nothing renders it today; it is there so the question stays answerable.
 *
 * **The derivation is calibrated against the real run rather than picked.** Across the five
 * measured documents the chunker produced one chunk per ~950 extracted characters (914, 1000, 972,
 * 800, 954), and between ~1,000 and ~2,700 characters per page. So a page count — which every
 * document really has — gives a character count, and the character count gives a chunk count at the
 * observed ratio. The per-document position in that range is **hashed from the document id**, so it
 * is deterministic: re-running produces the same figures, and two documents of the same length do
 * not come out identical.
 *
 * **The formats are assigned by what each document plainly is.** Asked for as *"some type document
 * like docs text csv excel"*. This corpus is 31 agreements and 5 scope documents, so most of it is
 * prose and stays PDF; what moves is what a reader would expect to open in something else:
 *
 *  - **Unit Price Agreements → `.xlsx`.** A priced schedule of rates really is a spreadsheet.
 *  - **Project Scope Documents → `.docx`.** A working document rather than an executed one.
 *  - **Sampling & Outreach and Materials Testing → `.csv`.** The loosest of the three, and worth
 *    naming as such: both are agreements, and what makes a CSV plausible is the returns they
 *    govern rather than the instrument itself.
 *
 * Nothing else is renamed. An executed construction agreement is a PDF, and turning one into a
 * spreadsheet to fill a column would be the small version of a transcribed figure.
 *
 * Writes a file and only a file, like every other seed here. Push it with
 * `npm run db:push -- CAPEX`.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { DATASETS } from '../datasets.js'

const TARGET = 'CAPEX'

const die = (message) => {
  console.error(`\nseed-capex-drive-chunks: ${message}\n`)
  process.exit(1)
}

const requested = (process.argv[2] ?? TARGET).trim()
if (requested !== TARGET) {
  die(`this seed authors ${TARGET}'s drives and nothing else — "${requested}" was asked for.`)
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

/** Stable per document, so a re-run reproduces every figure. */
const hash = (s) => parseInt(createHash('sha256').update(s).digest('hex').slice(0, 8), 16)

/**
 * The formats, by what the document is.
 *
 * Matched on the filename because that is what states the instrument — `doc_type` is `contract` for
 * all 31 and cannot tell a priced schedule from an executed agreement.
 */
const FORMATS = [
  {
    match: /Unit_Price_Agreement/i,
    ext: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  {
    match: /Project_Scope_Document/i,
    ext: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  { match: /Sampling_and_Outreach|Materials_Testing/i, ext: 'csv', mime: 'text/csv' },
]

/* The ratios the real run produced, which is what makes this a calibration rather than a guess. */
const CHARS_PER_CHUNK = 950
const CHARS_PER_PAGE = { min: 1000, max: 2700 }

const problems = []
let formatted = 0
let derived = 0
let measured = 0

for (const drive of doc.drives ?? []) {
  for (const folder of drive.folders ?? []) {
    for (const d of folder.documents ?? []) {
      const where = `${drive.drive_id}/${d.name}`

      /* A format, where the document is plainly one. Everything else stays as it is. */
      const format = FORMATS.find((f) => f.match.test(d.name))
      if (format && !d.name.toLowerCase().endsWith(`.${format.ext}`)) {
        const renamed = d.name.replace(/\.[^.]+$/, `.${format.ext}`)
        if (renamed === d.name) {
          problems.push(`${where}: has no extension to replace`)
          continue
        }
        d.name = renamed
        d.mime_type = format.mime
        formatted++
      }

      /* **Never over a measurement.** A document the chunker really read keeps its own figures. */
      if (Number.isInteger(d.chunk_count) && Number.isInteger(d.char_count)) {
        measured++
        continue
      }

      if (!Number.isInteger(d.pages) || d.pages <= 0) {
        problems.push(`${where}: has no page count, so there is nothing to derive a figure from`)
        continue
      }

      const spread = CHARS_PER_PAGE.max - CHARS_PER_PAGE.min
      const perPage = CHARS_PER_PAGE.min + (hash(d.document_id) % (spread + 1))
      const chars = d.pages * perPage
      d.char_count = chars
      d.chunk_count = Math.max(1, Math.round(chars / CHARS_PER_CHUNK))
      /* Stated in the document, so which figures were computed here stays answerable. */
      d.chunks_derived = true
      derived++
    }
  }
}

if (problems.length > 0) {
  die(`refusing to write backend/${name}:\n${problems.map((p) => `    - ${p}`).join('\n')}`)
}
if (derived === 0 && formatted === 0) {
  die('nothing to do — every drive document already carries a format and chunk figures')
}

await writeFile(path, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')

const kinds = {}
for (const drive of doc.drives ?? []) {
  for (const folder of drive.folders ?? []) {
    for (const d of folder.documents ?? []) {
      const ext = d.name.split('.').pop()
      kinds[ext] = (kinds[ext] ?? 0) + 1
    }
  }
}

console.log(
  `\nseed-capex-drive-chunks: wrote backend/${name}\n` +
    `    ${formatted} document(s) given a format that matches what they are\n` +
    `    ${derived} document(s) given DERIVED chunk figures (chunks_derived: true)\n` +
    `    ${measured} document(s) left on their measured figures, untouched\n` +
    `    formats now: ${Object.entries(kinds)
      .map(([k, v]) => `${v} ${k}`)
      .join(' · ')}\n\n` +
    '  The derived figures are computed from each document\'s own page count at the ratio the\n' +
    '  real chunking run produced. They are not measurements. Push when happy:\n' +
    `      npm run db:push -- ${TARGET}\n`,
)
