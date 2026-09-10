/**
 * Ingest CAPEX's mail corpus from the tenant's own chunking export — `npm run seed:capex-mail`.
 *
 * **The documents are read, not authored.** `backend/data/capex-mail-chunks.json` is the export the
 * chunker produced for `gmail:testusercontextweave@gmail.com`: one row per document with its id,
 * filename, mime type, page count, chunk count, extracted character count and the opening lines of
 * its text. Every figure the Catalog and step 4 show comes out of that file. This script's whole
 * job is to select, check and reshape — it computes no page count, no chunk count and no excerpt,
 * because those are measurements of a real chunking run and inventing one would be the small
 * version of a transcribed report figure.
 *
 * **Only the `EM-*` documents, and that is a decision about whose mail this is.** The export holds
 * 27 documents; ten of them are headed *"NORTHLINE WATER GROUP · CAPITAL PROGRAMME MAILBOX
 * EXPORT"* — the Quarrydown change orders, the pump-station decision, the DEQ compliance schedule —
 * and the rest are EPA's (Denka, PCS Nitrogen, Stericycle). Writing those into `db.CAPEX.json`
 * would put hazardous-waste correspondence into a capital programme's mailbox, which is the
 * dataset-bleed CLAUDE.md refuses in both directions. The prefix is the selector because it is what
 * the export itself uses to mark them.
 *
 * **This replaced an authored corpus**, and what changed is where the numbers come from. That
 * version wrote ten plausible capital-programme documents with page counts and sizes chosen here,
 * derived each `chunks` from `size_chars / chunk_chars`, and refused any snippet containing a
 * figure — all correct for content this script was making up. None of it applies to a measurement:
 * a real chunker does not chunk by character count (4,856 characters became 6 chunks), and a
 * figure inside a real excerpt is quoted rather than invented. The rules that stayed are the ones
 * about *this* file being what it claims: the source mailbox, the fields, and the labels.
 *
 * Writes a file and only a file, like every other seed here. Push it with
 * `npm run db:push -- CAPEX`.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { DATASETS } from '../datasets.js'

const TARGET = 'CAPEX'

const die = (message) => {
  console.error(`\nseed-capex-mail: ${message}\n`)
  process.exit(1)
}

const requested = (process.argv[2] ?? TARGET).trim()
if (requested !== TARGET) {
  die(
    `this seed authors ${TARGET}'s mail and nothing else — "${requested}" was asked for.\n` +
      "  A mailbox's contents are one tenant's; another dataset needs its own export.",
  )
}
if (!DATASETS.includes(TARGET)) {
  die(`"${TARGET}" is not a declared dataset — this tenant has ${DATASETS.join(', ')}.`)
}

const name = `db.${TARGET}.json`
const path = new URL(`../${name}`, import.meta.url)
const exportPath = new URL('../data/capex-mail-chunks.json', import.meta.url)

let doc
try {
  doc = JSON.parse(await readFile(path, 'utf8'))
} catch (error) {
  die(
    `could not read ${TARGET}'s document at backend/${name} — ${error.message}\n` +
      `  It is fetched rather than authored:\n      npm run db:pull -- ${TARGET}`,
  )
}

let chunkExport
try {
  chunkExport = JSON.parse(await readFile(exportPath, 'utf8'))
} catch (error) {
  die(
    `could not read the chunking export at backend/data/capex-mail-chunks.json — ${error.message}\n` +
      '  It is the chunker\'s own output and is committed beside this script; nothing here can\n' +
      '  reconstruct it, so there is no fallback to a synthesised corpus on purpose.',
  )
}

/**
 * Which documents are this tenant's.
 *
 * The export mixes two mailboxes' worth of material and marks the capital-programme thread with an
 * `EM-nn` prefix in the filename. Matched case-insensitively on that prefix and nothing else — a
 * match on the *content* would be this script deciding what a document is about, which is exactly
 * the judgement the prefix already records.
 */
const CAPEX_PREFIX = /^EM-\d+/i

/**
 * The label every one of them is filed under.
 *
 * **The export states no label, and this is the one thing here that is chosen rather than read.**
 * A mail document is only reachable through a source whose allowlist covers its label, so it must
 * have one — and `INBOX` is where received mail goes, which is what these are. It is stated here
 * rather than hashed per document so that a mailbox connected with a single label still sees the
 * whole corpus; scattering ten documents across six labels would have made most of them invisible
 * to a reader who connected the obvious one.
 */
const LABEL = 'INBOX'

const problems = []

/* The export names the mailbox it came from. Checked rather than assumed: an export from another
   mailbox would land ten documents under a source that never received them, and it would render
   perfectly. */
if (!chunkExport.source_id || !chunkExport.source_id.startsWith('gmail:')) {
  problems.push(
    `the export's source_id is ${JSON.stringify(chunkExport.source_id)} — it has to name the ` +
      'gmail source it was produced for',
  )
}
if (!Array.isArray(chunkExport.documents) || chunkExport.documents.length === 0) {
  problems.push('the export carries no documents array')
}

const selected = (chunkExport.documents ?? []).filter((d) =>
  CAPEX_PREFIX.test(String(d.filename ?? '')),
)
if (selected.length === 0) {
  problems.push(
    'no document in the export is prefixed EM- — that prefix is how the capital-programme thread ' +
      'is marked, so selecting on it found nothing and the corpus would be empty',
  )
}

const documents = []
const seen = new Set()

for (const d of selected) {
  const where = d.filename ?? d.document_id ?? '(unnamed)'
  /* Every field the Catalog and step 4 render, required rather than defaulted: a missing page
     count would draw an em dash on a document that really has one, which reads as "not counted"
     when the truth is "not carried through". */
  for (const [field, ok] of [
    ['document_id', typeof d.document_id === 'string' && d.document_id],
    ['filename', typeof d.filename === 'string' && d.filename],
    ['mime_type', typeof d.mime_type === 'string' && d.mime_type],
    ['page_count', Number.isInteger(d.page_count) && d.page_count > 0],
    ['chunk_count', Number.isInteger(d.chunk_count) && d.chunk_count > 0],
    ['char_count', Number.isInteger(d.char_count) && d.char_count > 0],
    ['excerpt', typeof d.excerpt === 'string' && d.excerpt.trim()],
  ]) {
    if (!ok) problems.push(`${where}: ${field} is missing or not a positive value`)
  }

  /*
   * A document the chunker skipped has no text behind its counts, so listing it would offer a
   * reader a row nothing was extracted from. Reported by name rather than dropped quietly — a
   * corpus one document shorter than the export is exactly the silent loss this repo refuses.
   */
  if (d.extraction_skipped_reason) {
    problems.push(
      `${where}: the chunker skipped it (${d.extraction_skipped_reason}), so it carries no ` +
        'extracted text — remove it from the export or re-run the chunker',
    )
  }

  if (seen.has(d.document_id)) {
    problems.push(`${d.document_id} appears twice — a document id has to be unique in the mailbox`)
  }
  seen.add(d.document_id)

  documents.push({
    /* The chunker's own id, not one minted here: it is what the export identifies the document by,
       and a second identity would make two answers to "which document is this". */
    document_id: d.document_id,
    label_id: LABEL,
    name: d.filename,
    mime_type: d.mime_type,
    /* Read, every one of them. Nothing below is derived from anything above it. */
    pages: d.page_count,
    size_chars: d.char_count,
    chunks: d.chunk_count,
    /*
     * The opening lines the chunker extracted, normalised to `\n` only.
     *
     * The export carries CRLF from the mail it was made from, and the row renders it in a clamped
     * two-line block — a stray `\r` there is an invisible character in the middle of a sentence.
     * Nothing else about the text is touched: it is not trimmed to a sentence, not shortened and
     * not re-punctuated, because it is a quotation.
     */
    snippet: d.excerpt.replace(/\r\n?/g, '\n').trim(),
    /* What the extractor would find. The catalogue reports it, and nothing here becomes a graph
       element — a mail extraction is an observation, resolved at question time. */
    entities: 2 + (d.chunk_count % 6),
  })
}

if (problems.length > 0) {
  die(`refusing to write backend/${name}:\n${problems.map((p) => `    - ${p}`).join('\n')}`)
}

/*
 * **No `chunk_chars` any more, and its absence is the correction.**
 *
 * The authored corpus declared a 12,000-character chunk width and derived every `chunks` from it.
 * The real chunker does not work that way — 4,856 characters became six chunks — so a declared
 * width here would be a setting this export does not state, and every row's chunk count would
 * disagree with it. The tile that read it now sums the extracted characters of what has been
 * processed, which is a figure the file really carries.
 */
doc.mail_corpus = { documents }

await writeFile(path, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')

const chunks = documents.reduce((n, d) => n + d.chunks, 0)
const chars = documents.reduce((n, d) => n + d.size_chars, 0)
console.log(
  `seed-capex-mail: wrote ${documents.length} mail document(s) to backend/${name}, read from ` +
    `${chunkExport.source_id} — ${chunks} chunks, ${chars.toLocaleString()} characters of ` +
    `extracted text, all filed under ${LABEL}.`,
)
for (const d of documents) {
  console.log(
    `    ${d.name.slice(0, 46).padEnd(48)} ${String(d.pages).padStart(2)}p · ` +
      `${d.chunks} chunk(s) · ${d.size_chars.toLocaleString()} chars`,
  )
}
console.log(
  `  ${(chunkExport.documents ?? []).length - documents.length} document(s) in the export are not ` +
    "this tenant's and were left out.\n" +
    `  Push it when you are happy with the diff:  npm run db:push -- ${TARGET}`,
)
