/*
 * Seeds CAPEX's **My Drive** — the personal drive the connect wizard offers beside the shared one:
 *
 *     npm run seed:capex-drive
 *
 * **Why it exists.** The CAPEX package ships one drive, the shared `Capital Delivery Docs`, so step 2
 * of the connect wizard offered *My Drive (0)* beside *Shared drive (1)*. A kind of drive the account
 * has none of is offered with the count that says so — that is the wizard's rule and it is right — but
 * a tenant whose people plainly keep working papers reads a permanent 0 as a connector that cannot see
 * personal drives, which is a different fault with a different fix. So CAPEX gets a My Drive with
 * something in it.
 *
 * **Nothing here is invented, and that is the whole design.** Every document is a *working copy* of a
 * document the dataset already ships: the same entity, the same project code, the same contract
 * number, the same page count, and — through `document_extractions` — the same resolved graph node. A
 * personal drive holding markups of each project's lead agreement is what a capital-delivery manager's
 * drive holds; one holding six contractors nobody has heard of would put six entities into the Data
 * Catalog that the canvas has never seen, which is the failure EPA's own workspace seed states in the
 * same words.
 *
 * **Which is why this is a script and not an edit of `db.CAPEX.json`.** That document's `_meta` says
 * *"never hand-edit this file — change the generator and rebuild"*, and the derivation above is only
 * true while it is re-derived: a hand-typed copy of a contract's page count is a figure that goes stale
 * the first time the package is rebuilt. It is **idempotent** — what it authored last time is dropped
 * by id and re-appended — and it **refuses to write** rather than produce a document that would boot
 * into a wrong answer.
 *
 * **It owns one subtree and appends to two others**, the arrangement `seed-workspaces.js` follows for
 * EPA: a drive in `drives`, a handle in `drive_credentials`, a row per new document in
 * `document_extractions`. It rebuilds none of them, because a script that rewrites a key it does not
 * own is how a subtree gets deleted.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const DB = new URL('../db.CAPEX.json', import.meta.url)
const db = JSON.parse(readFileSync(DB, 'utf8'))

/** The package's own drive. Read from, never written to. */
const PACKAGE_DRIVE = 'capital-delivery-docs'

const DRIVE_ID = 'my-drive-capital-delivery'
const CREDENTIAL_HANDLE = 'drive-handle-7f31c9a2'

/**
 * When the copies were taken. One date fixed here rather than `new Date()`: a generated document that
 * changes every time it is generated cannot be diffed, and the diff is how a re-seed is checked.
 */
const COPIED_ON = '2026-06-12'

const problems = []

const packageDrive = db.drives?.find((d) => d.drive_id === PACKAGE_DRIVE)
if (!packageDrive) {
  console.error(
    `seed-capex-drive: ${PACKAGE_DRIVE} is not in db.CAPEX.json — restore it before seeding`,
  )
  process.exit(1)
}

/*
 * ---------------- which documents get copied ----------------
 *
 * **The first contract in each project folder**, in the order the drive lists them. A rule rather than
 * a list of ids, for the reason the reports ingest reads its titles out of the documents: a list typed
 * here would still name `DOC:qdn-2025-c01` after the package renamed it, and the seed would refuse to
 * write with no clue which end had moved.
 *
 * Scope documents are deliberately not copied. Every project folder holds exactly one, it is the
 * project's own record rather than a working paper, and five files all named
 * `Project_Scope_Document.pdf` in one personal drive is a drive nobody can read.
 */
const sources = packageDrive.folders
  .map((folder) => folder.documents.find((d) => d.doc_type === 'contract'))
  .filter(Boolean)

if (sources.length < 3) {
  problems.push(
    `only ${sources.length} project folder(s) hold a contract — nothing to take working copies of`,
  )
}

/*
 * ---------------- where they go ----------------
 *
 * Three folders and one level of nesting, because a personal drive that is a single flat list does not
 * exercise the wizard's tree at all: `FolderTreePicker` is built from `parent_id`, checking a folder
 * checks the folders inside it, and a container states two counts (`2 here · 4 with subfolders`). A
 * drive with no parent anywhere renders as the checkbox group the flat BigQuery allowlist already is.
 *
 * The split is by position rather than by any property of the contracts. They are all lead agreements,
 * so a rule claiming one belongs *under review* and another *to file* would be a claim about work
 * nobody has done.
 */
const FOLDERS = [
  {
    folder_id: 'f_my_capex_markups',
    parent_id: null,
    name: 'Contract markups',
    path: '/My Drive/Contract markups',
    description: "Working copies of each capital project's lead agreement.",
    takes: (i) => i < 2,
  },
  {
    folder_id: 'f_my_capex_markups_q1',
    parent_id: 'f_my_capex_markups',
    name: 'Q1 2026 review',
    path: '/My Drive/Contract markups/Q1 2026 review',
    description: 'The markups carried into the quarterly delivery review.',
    takes: (i) => i >= 2 && i < 4,
  },
  {
    folder_id: 'f_my_capex_to_file',
    parent_id: null,
    name: 'To file',
    path: '/My Drive/To file',
    description: 'Copies still to be filed back to the shared drive.',
    takes: (i) => i >= 4,
  },
]

/**
 * A working copy of one document.
 *
 * Everything factual is the source's — the entity it is about, the project it belongs to, its contract
 * number, how long it is. What changes is what a copy changes: its id, its filename, the fact that it
 * is a working copy, and when it was taken.
 */
const workingCopy = (source) => ({
  document_id: `DOC:my-${source.document_id.replace(/^DOC:/, '')}-markup`,
  name: source.name.replace(/\.pdf$/i, '_markup.pdf'),
  mime_type: source.mime_type,
  /* The type is the original's, so a working copy files under Contracts exactly as its original does —
     `doc_type` is what the chip counts. Only the *document's* own label says it is a copy. */
  doc_type: source.doc_type,
  doc_type_label: `${source.doc_type_label} (working copy)`,
  linked_entity: source.linked_entity,
  project_code: source.project_code,
  pages: source.pages,
  size_mb: source.size_mb,
  entities: source.entities,
  contract_no: source.contract_no,
  modified: COPIED_ON,
  /* Not stored on the document: the browse tree shows the entity, the graph joins on the resolution,
     and those are two different keys. Carried here to write `document_extractions` below. */
  _source_id: source.document_id,
})

const folders = FOLDERS.map(({ takes, ...folder }) => ({
  ...folder,
  documents: sources.filter((_, i) => takes(i)).map(workingCopy),
}))

const newDocs = folders.flatMap((f) => f.documents)

/* ---------------- refuse to write rather than produce a wrong document ---------------- */

/*
 * **Every copy resolves into the graph, to the node its original resolves to.** Without a row here the
 * document dictionary reports "nothing resolved yet" for documents that plainly name a project — which
 * reads as an answer rather than as a missing row, and is why `document_extractions` is required at
 * all.
 */
const extractions = {}
for (const doc of newDocs) {
  const source = db.document_extractions?.[doc._source_id]
  if (!source) {
    problems.push(
      `${doc._source_id} has no document_extractions row, so its copy would resolve to nothing`,
    )
    continue
  }
  extractions[doc.document_id] = {
    ...source,
    extraction_id: `ex_my_${doc.document_id.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`,
    document_id: doc.document_id,
    source_file: doc.name,
  }
}

/* A node this canvas has never heard of is the one thing a seed must not add. It is carried from the
   source, so this holds by construction — asserted because "by construction" is exactly what stops
   being true when somebody edits the copy rule above. */
const nodeIds = new Set((db.graph_studio?.canvas?.nodes ?? []).map((n) => n.node_id))
for (const [id, row] of Object.entries(extractions)) {
  if (!nodeIds.has(row.resolved_node)) {
    problems.push(`${id} resolves to ${row.resolved_node}, which is not a node on this canvas`)
  }
}

/* A doc_type with no facet chip sits at 0 and reads as "none of these in this corpus" rather than as a
   broken map. Checked against the corpus this dataset already ships, so a type invented here is
   refused without this script keeping a second copy of the server's map. */
const corpusTypes = new Set(
  db.drives
    .flatMap((d) => d.folders)
    .flatMap((f) => f.documents)
    .map((d) => d.doc_type),
)
for (const doc of newDocs) {
  if (!corpusTypes.has(doc.doc_type)) {
    problems.push(`${doc.document_id} has doc_type "${doc.doc_type}", which no chip counts`)
  }
}

/* An id already in use would put one document in two drives, and the dictionary keys by id. */
const existingDocIds = new Set(
  db.drives
    .filter((d) => d.drive_id !== DRIVE_ID)
    .flatMap((d) => d.folders)
    .flatMap((f) => f.documents)
    .map((d) => d.document_id),
)
for (const doc of newDocs) {
  if (existingDocIds.has(doc.document_id)) {
    problems.push(`${doc.document_id} is already in another drive`)
  }
}

/* A parent that is not a folder of this drive draws the child at the root, which reads as an allowlist
   covering more of the drive than it does. `validateDb` refuses it too; this says which folder. */
const own = new Set(folders.map((f) => f.folder_id))
for (const f of folders) {
  if (f.parent_id && !own.has(f.parent_id)) {
    problems.push(`folder ${f.folder_id} names parent ${f.parent_id}, which is not in ${DRIVE_ID}`)
  }
}

/* A folder holding nothing and containing nothing renders as a leaf reading 0 — the empty drive this
   seed exists to fix, one level down. */
for (const f of folders) {
  const nested = folders.some((child) => child.parent_id === f.folder_id)
  if (f.documents.length === 0 && !nested) {
    problems.push(`folder ${f.folder_id} is empty and has no subfolder`)
  }
}

if (problems.length > 0) {
  console.error('seed-capex-drive: refusing to write\n')
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}

/* ---------------- write ---------------- */

const strip = (folder) => ({
  ...folder,
  documents: folder.documents.map(({ _source_id, ...d }) => d),
})

/* Idempotence: drop what the last run authored, by id, so re-running is a rewrite rather than a second
   copy of the same drive. */
db.drives = db.drives.filter((d) => d.drive_id !== DRIVE_ID)
db.drive_credentials = (db.drive_credentials ?? []).filter((c) => c.drive_id !== DRIVE_ID)
for (const id of Object.keys(db.document_extractions ?? {})) {
  if (id.startsWith('DOC:my-')) delete db.document_extractions[id]
}

db.drives.push({
  drive_id: DRIVE_ID,
  display_name: 'My Drive',
  kind: 'my_drive',
  folders: folders.map(strip),
})
db.drive_credentials.push({ drive_id: DRIVE_ID, credential_handle: CREDENTIAL_HANDLE })
Object.assign(db.document_extractions, extractions)

/* `parent_id` on every folder of every drive, the package's own roots included: an absent key means
   "predates nesting" as readily as "has no parent", and the tree cannot tell those apart. */
for (const drive of db.drives) {
  for (const folder of drive.folders) {
    if (folder.parent_id === undefined) folder.parent_id = null
  }
}

writeFileSync(DB, JSON.stringify(db, null, 2) + '\n', 'utf8')

console.log(
  `seed-capex-drive: ${db.drives.length} drives ` +
    `(${db.drives.filter((d) => d.kind === 'my_drive').length} My Drive, ` +
    `${db.drives.filter((d) => d.kind === 'shared_drive').length} shared) · ` +
    `${folders.length} folders, ${folders.filter((f) => f.parent_id).length} of them nested · ` +
    `${newDocs.length} working copies, each resolved to the node its original resolves to.`,
)
