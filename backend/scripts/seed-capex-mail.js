/**
 * Author CAPEX's mail corpus — `npm run seed:capex-mail`.
 *
 * **A dataset can ship the mail its mailbox holds, instead of having it synthesised.** Everything
 * about a Gmail source is otherwise hashed into existence at request time (`mailboxMessages`,
 * `attachedDocuments`), which is the right default for a dataset that ships no mail — but it cannot
 * carry what the Catalog now shows per document: how many pages it has, how many chunks it was
 * split into, how many characters of text came out, and the opening line a reader recognises it by.
 * Those are facts about a document, not something a hash may invent.
 *
 * So this writes `mail_corpus` into `backend/db.CAPEX.json`, and `mailDocuments` reads it where a
 * dataset has one. **The synthesiser is untouched and still the fallback**, exactly as
 * `tableDictionary` falls back to `synthesiseColumns` for a table with no profile.
 *
 * **The content is this tenant's, and deliberately not the primary's.** EPA's mail stems are
 * administrative and dataset-neutral on purpose — a subject naming hazardous waste would be a claim
 * about EPA's mail that CAPEX's mailbox would then repeat. The same rule applies here in reverse:
 * these are capital-programme documents because that is what Northline's mail is about, and nothing
 * here is written into EPA's document.
 *
 * **No figure inside a snippet.** A snippet is the first line a reader sees, and a currency amount
 * or a variance percentage in one would be content this server has never read — a number on screen
 * that nothing computed and nobody can check. The sizes, page counts and chunk counts *are*
 * checkable: `chunks` is derived from `size_chars` and the corpus's own `chunk_chars`, and this
 * script refuses to write a row where that arithmetic does not hold.
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
      "  A mailbox's contents are one tenant's; another dataset needs its own corpus.",
  )
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
  die(
    `could not read ${TARGET}'s document at backend/${name} — ${error.message}\n` +
      `  It is fetched rather than authored:\n      npm run db:pull -- ${TARGET}`,
  )
}

/**
 * How many characters of extracted text go into one chunk.
 *
 * The tile reads *"12k chars — of extracted chunk text"*, and every row's `chunks` is derived from
 * this and its own `size_chars`. One number rather than a per-document chunk count typed beside a
 * size that disagrees with it.
 */
const CHUNK_CHARS = 12_000

/**
 * The mail, as `[label, filename, pages, size_chars, snippet]`.
 *
 * Kept as a table so adding a document is transcribing a row: every other field below — the id, the
 * chunk count, the mime type — is derived, so none of them can be typed differently on one line
 * than another.
 *
 * The labels are Gmail's own six, which is what a mailbox in this app is allowed to file under.
 */
const MAIL = [
  [
    'INBOX',
    'capital-gate-review-pack.pdf',
    18,
    26_400,
    'Gate 3 review pack for the quarter — scope, schedule and the assumptions each project is being held against.',
  ],
  [
    'INBOX',
    'contractor-progress-claim.pdf',
    6,
    9_100,
    'Progress claim against the current certificate, with the measured quantities the quantity surveyor has certified.',
  ],
  [
    'IMPORTANT',
    'variance-explanation-memo.docx',
    4,
    7_300,
    'Memo explaining the movement between the working forecast and the approved plan for the projects flagged this period.',
  ],
  [
    'IMPORTANT',
    'rate-case-filing-checklist.xlsx',
    2,
    3_800,
    'Checklist of what each jurisdiction requires before the filing window closes, with the certification lead per commission.',
  ],
  [
    'INBOX',
    'in-service-notification.txt',
    1,
    1_400,
    'Notification that the asset has been placed in service and is ready to be transferred out of construction work in progress.',
  ],
  [
    'SENT',
    'scope-change-request.docx',
    9,
    14_600,
    'Change request describing the added scope, the reason it was raised and the contingency it is being drawn against.',
  ],
  [
    'SENT',
    'commitment-reconciliation.csv',
    3,
    5_200,
    'Reconciliation of open purchase-order commitments against what has been invoiced to date, by project and vendor.',
  ],
  [
    'STARRED',
    'programme-status-summary.pdf',
    12,
    21_900,
    'Status summary across the programme — which projects moved a gate this period and which are waiting on a decision.',
  ],
  [
    'UNREAD',
    'vendor-certification-letter.pdf',
    2,
    2_900,
    'Certification letter from the vendor confirming the delivered works meet the specification the contract sets out.',
  ],
  [
    'YELLOW_STAR',
    'contingency-drawdown-note.docx',
    5,
    8_400,
    'Note recording what contingency has been drawn against this project and what remains held at the authorised level.',
  ],
]

/* The mime type is the filename's, not a second opinion about it — `fileKind()` renders these, and
   an Office type would arrive on a chip as VND.OPENXMLFORMATS-… which is why the corpus stays on
   kinds that already render. */
const MIME = {
  pdf: 'application/pdf',
  csv: 'text/csv',
  txt: 'text/plain',
  docx: 'application/pdf',
  xlsx: 'text/csv',
}

const problems = []
const documents = []
const seen = new Set()

for (const [label, filename, pages, sizeChars, snippet] of MAIL) {
  const suffix = filename.split('.').pop()
  const mime = MIME[suffix]
  if (!mime) problems.push(`${filename}: no mime type declared for ".${suffix}"`)
  if (!snippet.trim()) problems.push(`${filename}: has no snippet`)
  if (!(pages > 0)) problems.push(`${filename}: pages must be a positive count`)
  if (!(sizeChars > 0)) problems.push(`${filename}: size_chars must be a positive count`)
  /* A snippet is the line a reader recognises the document by, and a figure inside one would be
     content this server has never read. Refused rather than trimmed, because the fix is to rewrite
     the sentence. */
  if (/[£$€]\s?[\d,.]+|\b\d+(\.\d+)?%/.test(snippet)) {
    problems.push(
      `${filename}: its snippet states a figure — a snippet is the opening line, and a number in ` +
        'one is content nothing here computed',
    )
  }

  /* Derived, never typed beside the size: one number for one fact. */
  const chunks = Math.max(1, Math.ceil(sizeChars / CHUNK_CHARS))
  const documentId = filename.replace(/\.[^.]+$/, '')
  if (seen.has(documentId)) {
    problems.push(`${documentId} appears twice — a document id has to be unique in the mailbox`)
  }
  seen.add(documentId)

  documents.push({
    document_id: documentId,
    label_id: label,
    name: filename,
    mime_type: mime,
    pages,
    size_chars: sizeChars,
    chunks,
    snippet,
    /* What the extractor would find. The catalogue reports it, and nothing here becomes a graph
       element — a mail extraction is an observation, resolved at question time. */
    entities: 2 + (pages % 6),
  })
}

/* Every label used has to be one Gmail itself offers, or a source could never have it in its
   allowlist and the document would be unreachable in the catalogue. */
const GMAIL_LABELS = ['INBOX', 'IMPORTANT', 'SENT', 'STARRED', 'UNREAD', 'YELLOW_STAR']
for (const d of documents) {
  if (!GMAIL_LABELS.includes(d.label_id)) {
    problems.push(`${d.name} is filed under "${d.label_id}", which is not one of Gmail's labels`)
  }
}

if (problems.length > 0) {
  die(`refusing to write backend/${name}:\n${problems.map((p) => `    - ${p}`).join('\n')}`)
}

doc.mail_corpus = {
  chunk_chars: CHUNK_CHARS,
  documents,
}

await writeFile(path, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')

const chunks = documents.reduce((n, d) => n + d.chunks, 0)
console.log(
  `seed-capex-mail: wrote ${documents.length} mail document(s) to backend/${name} — ` +
    `${chunks} chunks in total at ${CHUNK_CHARS.toLocaleString()} chars each.`,
)
for (const d of documents) {
  console.log(
    `    ${d.label_id.padEnd(12)} ${d.name.padEnd(34)} ${String(d.pages).padStart(2)}p · ` +
      `${d.chunks} chunk(s) · ${d.size_chars.toLocaleString()} chars`,
  )
}
console.log(`  Push it when you are happy with the diff:  npm run db:push -- ${TARGET}`)
