/**
 * Writes `drives` into `backend/risk/risk_sources.json`, from the Contract Risk Analyst package's
 * own real documents (`Contract_risk_analyst/json/05_sources_and_catalog/documents.json`).
 *
 *   node backend/scripts/ingest-risk-drive.mjs
 *
 * **Ten real files, in the exact shape CAPEX's own shipped drive uses**
 * (`drive_id/display_name/kind/owner/folders[].documents[]`, each document carrying
 * `document_id/name/mime_type/doc_type/doc_type_label/linked_entity/project_code/pages/size_mb/
 * entities/contract_no/modified/char_count/chunk_count/chunks_derived/excerpt`).
 *
 * **Fourteen source rows, ten used.** The package names fourteen documents; four are `WEB:`-prefixed
 * web pages (a news article, a board agenda, a state survey, a court-docket style courier piece) —
 * real content, but not a *file in a drive*, which is what this connector models. Left out rather
 * than forced into a shape they are not; nothing here invents a "web" connector this app does not
 * have. The ten `DOC:` entries become two drives, matching what the source itself distinguishes:
 * nine filed under shared folders become one shared drive, and the one filed under `"My drive"`
 * (working notes, not meant to be shared) becomes a second, personal one — the same two-drive
 * pattern every other dataset ships, never one invented to fill a picker.
 *
 * **Every field but two is read, not invented.** `document_id`, `name`, `project_code` (the source's
 * own `project`), `modified` (`date`), and the full text (`pages`, already pre-chunked by the
 * source — each array entry becomes one chunk) all come straight off the record. `mime_type` is
 * derived from the source's own `fmt` by a fixed, honest map (pdf/xlsx/pptx to their real MIME
 * types), and `char_count`/`chunk_count`/`size_mb` are computed from the real text, not guessed.
 *
 * The two gaps, same as the mail ingest: `entities` (no extractor ran; `1` for every document, the
 * one confirmed link each has — its project code or org) and `contract_no` (left `null` — nothing
 * in the source names a contract document *number* distinct from the project code, and CAPEX's own
 * example keeps the two fields separate, so filling one from the other would be a guess dressed as
 * a fact).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const backend = join(here, '..')
const pkg = join(backend, '..', 'Contract_risk_analyst', 'json')
const out = join(backend, 'risk', 'risk_sources.json')

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

const MIME = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

const DOC_TYPE_LABEL_TO_SLUG = (label) => label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

const all = readJson(join(pkg, '05_sources_and_catalog', 'documents.json'))
const docs = all.filter((d) => d.id.startsWith('DOC:'))

const problems = []
const sharedFolders = new Map() // top-level folder name -> documents[]
const myDriveDocuments = []

for (const d of docs) {
  if (!MIME[d.fmt]) {
    problems.push(`${d.id}: unrecognised format "${d.fmt}"`)
    continue
  }
  const text = (d.pages ?? []).join('\n')
  const document = {
    document_id: d.id,
    name: d.name,
    mime_type: MIME[d.fmt],
    doc_type: DOC_TYPE_LABEL_TO_SLUG(d.type),
    doc_type_label: d.type,
    linked_entity: d.org || null,
    project_code: d.project || null,
    pages: d.pages?.length ?? 0,
    size_mb: Math.round((text.length / 1_000_000) * 1000) / 1000,
    entities: 1,
    contract_no: null,
    modified: d.date,
    char_count: text.length,
    chunk_count: d.pages?.length ?? 0,
    chunks_derived: true,
    excerpt: text.slice(0, 400),
  }

  if (d.folder === 'My drive') {
    myDriveDocuments.push(document)
    continue
  }

  const top = d.folder.split(' / ')[0]
  if (!sharedFolders.has(top)) sharedFolders.set(top, [])
  sharedFolders.get(top).push(document)
}

if (problems.length > 0) {
  console.error(`refusing to write — ${problems.length} problem(s):\n  · ${problems.join('\n  · ')}`)
  process.exitCode = 1
  process.exit()
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

const sharedDrive = {
  drive_id: 'risk-contract-repository',
  display_name: 'Contract Repository',
  kind: 'shared_drive',
  owner: 'nishant.srivastav@vriodigital.com',
  folders: [...sharedFolders.entries()].map(([name, documents], i) => ({
    folder_id: `f_${String(i + 1).padStart(2, '0')}_${slug(name)}`,
    name,
    path: `/Contract Repository/${name}`,
    description: `${name}, read off the Contract Risk Analyst package's own document catalogue.`,
    documents,
  })),
}

const myDrive = {
  drive_id: 'risk-my-drive',
  display_name: 'My Drive',
  kind: 'my_drive',
  owner: 'nishant.srivastav@vriodigital.com',
  folders: [
    {
      folder_id: 'f_01_my_drive',
      name: 'My Drive',
      path: '/My Drive',
      description: 'Personal working files, not filed under a shared folder.',
      documents: myDriveDocuments,
    },
  ],
}

/*
 * One `drive_credentials` row per drive, or `/sources/oauth/drives` answers every drive with
 * `credential_handle: null` (`db.drive_credentials.find((c) => c.drive_id === d.drive_id)` finds
 * nothing) — the wizard then reads an empty handle off the pre-selected drive and refuses Continue
 * with "sign in… or supply a drive ID and credential handle", even though a drive is plainly
 * selected on screen. Same opaque `drive-handle-<8 hex>` shape every other dataset's rows use
 * (CAPEX's `drive-handle-964dde4c`, Keolis's two); derived from the drive id so it is stable across
 * re-runs rather than a fresh random value each time.
 */
const handleFor = (driveId) => `drive-handle-${createHash('sha256').update(driveId).digest('hex').slice(0, 8)}`

const existing = readJson(out)
existing.drives = myDriveDocuments.length > 0 ? [sharedDrive, myDrive] : [sharedDrive]
existing.drive_credentials = existing.drives.map((d) => ({
  drive_id: d.drive_id,
  credential_handle: handleFor(d.drive_id),
}))
writeFileSync(out, `${JSON.stringify(existing, null, 2)}\n`, 'utf8')

const total = [...sharedFolders.values()].reduce((n, l) => n + l.length, 0) + myDriveDocuments.length
console.log(
  `wrote ${existing.drives.length} drive(s), ${sharedFolders.size} shared folder(s), ${total} document(s) into backend/risk/risk_sources.json`,
)
