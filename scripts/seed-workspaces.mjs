/*
 * Seeds the *extra* Google workspaces the connect wizard offers — the GCP projects beyond the
 * demo one, and the Drives beyond the single shared one:
 *
 *     node scripts/seed-workspaces.mjs
 *
 * Why a script rather than a hand edit of `db.json`: every project it adds has to carry a full
 * `column_profiles` entry (the catalogue's column count and the profile's length are asserted
 * against each other) and every document it adds has to carry a `document_extractions` row that
 * names the same entity the browse tree does. Authoring those by hand is exactly the 206-entry
 * problem the profiling workbook already has, so the arithmetic is done here and re-done on every
 * run. Idempotent: it removes what it authored last time by id, then appends.
 *
 * **What is authored here and what is not.** `vrio-contextweave-demo` and the `compliance-docs`
 * shared drive are the demo package's own, ingested elsewhere and never rewritten — this only adds
 * to them (the drive gains nested subfolders; its seven root documents are untouched). The
 * `epa_hazwaste` column profiles stay the workbook's; the profiles written here belong solely to
 * the projects written here, and say so in their `derivation`.
 *
 * **Nesting is a `parent_id`, not a nested array.** Folders stay one flat list per drive, so every
 * existing walk over `drive.folders` — counts, browse, the document dictionary, `validateDb` —
 * keeps working unchanged, and the wizard builds the tree from the parent pointers. A root folder
 * carries `parent_id: null`; the key is present on every folder, including the package's own, so
 * "no parent" and "an older document that predates nesting" are not the same absence.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const DB = new URL('../mock-server/db.json', import.meta.url)
const db = JSON.parse(readFileSync(DB, 'utf8'))

/** The demo package's own drive, added to but never rewritten here. Its project
 *  (`vrio-contextweave-demo`) is not named at all: this script only appends beside it. */
const PACKAGE_DRIVE = 'compliance-docs'

/* ---------------- the extra GCP projects ---------------- */

/**
 * A column profile row, in the shape `column_profiles` already holds — the catalogue's dictionary
 * reads these verbatim, so every field the panel prints is stated rather than defaulted.
 */
const col = (column_id, type, klass, description, extra = {}) => ({
  column_id,
  label: column_id.replace(/_/g, ' ').toUpperCase(),
  type,
  class: klass,
  description,
  /* Not `llm`: these were not inferred from a profiling run the way the workbook's 206 were.
     A derivation is a claim about where a description came from. */
  derivation: 'seeded',
  confidence: 0.9,
  pii: false,
  null_pct: 0,
  distinct: 0,
  ...extra,
})

const PROFILES = {
  'transport_ops.transporter_manifests': [
    col('manifest_tracking_number', 'STRING', 'identifier', 'EPA manifest tracking number (MTN) this leg belongs to. Joins to e_manifest.', { distinct: 1200, confidence: 0.97 }),
    col('transporter_epa_id', 'STRING', 'identifier', 'EPA identification number of the transporter carrying the leg.', { distinct: 62 }),
    col('transporter_name', 'STRING', 'entity', 'Registered name of the transporter company.', { distinct: 58 }),
    col('leg_sequence', 'INTEGER', 'dimension', 'Position of this leg in the shipment’s custody chain, starting at 1.', { distinct: 4 }),
    col('pickup_date', 'DATE', 'date', 'Date the transporter took custody of the shipment.', { distinct: 720 }),
    col('delivery_date', 'DATE', 'date', 'Date custody passed to the next transporter or to the receiving facility.', { distinct: 731, null_pct: 1.4 }),
    col('origin_state', 'STRING', 'dimension', 'US state the leg departed from.', { distinct: 31 }),
    col('destination_state', 'STRING', 'dimension', 'US state the leg arrived in.', { distinct: 28 }),
    col('quantity_tons', 'FLOAT', 'measure', 'Tonnage moved on this leg, as declared on the manifest.', { distinct: 1840 }),
    col('container_count', 'INTEGER', 'measure', 'Number of containers on the leg.', { distinct: 47 }),
    col('hazard_class', 'STRING', 'dimension', 'DOT hazard class declared for the load. An attribute of the shipment, not an entity.', { distinct: 9 }),
    col('signature_captured', 'BOOLEAN', 'flag', 'Whether an electronic signature was captured at hand-off.', { distinct: 2 }),
  ],
  'transport_ops.route_segments': [
    col('segment_id', 'STRING', 'identifier', 'Surrogate key for the origin→destination segment.', { distinct: 9640, confidence: 0.96 }),
    col('manifest_tracking_number', 'STRING', 'identifier', 'Manifest the segment belongs to. Joins to e_manifest and to transporter_manifests.', { distinct: 1200, confidence: 0.97 }),
    col('origin_facility_id', 'STRING', 'identifier', 'EPA handler id of the facility the segment departed from.', { distinct: 36 }),
    col('destination_facility_id', 'STRING', 'identifier', 'EPA handler id of the facility the segment arrived at.', { distinct: 11 }),
    col('origin_address', 'STRING', 'address', 'Street address on file for the origin handler.', { distinct: 36 }),
    col('destination_lat', 'FLOAT', 'geo', 'Latitude of the destination handler, from the FRS facility record.', { distinct: 11 }),
    col('destination_lon', 'FLOAT', 'geo', 'Longitude of the destination handler, from the FRS facility record.', { distinct: 11 }),
    col('distance_miles', 'FLOAT', 'measure', 'Road distance of the segment.', { distinct: 2410 }),
    col('transit_hours', 'FLOAT', 'measure', 'Elapsed hours between departure and arrival scans.', { distinct: 1880, null_pct: 3.2 }),
    col('departed_at', 'TIMESTAMP', 'date', 'Timestamp of the departure scan.', { distinct: 9310 }),
  ],
  'compliance_sandbox.enforcement_staging': [
    col('staging_id', 'STRING', 'identifier', 'Surrogate key for the staged enforcement row.', { distinct: 640, confidence: 0.95 }),
    col('facility_epa_id', 'STRING', 'identifier', 'EPA handler id the action is filed against.', { distinct: 118 }),
    col('facility_name', 'STRING', 'entity', 'Facility name as it appears on the filing, before resolution.', { distinct: 121 }),
    col('enforcement_type', 'STRING', 'dimension', 'Type of action filed. An attribute of the action, not an entity of its own.', { distinct: 6 }),
    col('filed_date', 'DATE', 'date', 'Date the action was filed.', { distinct: 512 }),
    col('penalty_usd', 'FLOAT', 'measure', 'Penalty assessed, in US dollars. Null where none was assessed.', { distinct: 209, null_pct: 41.7 }),
    col('reviewed', 'BOOLEAN', 'flag', 'Whether a reviewer has cleared the row for promotion.', { distinct: 2 }),
    col('reviewer_email', 'STRING', 'entity', 'Address of the reviewer who cleared the row. Personal data.', { distinct: 9, null_pct: 58.3, pii: true }),
    col('review_note', 'STRING', 'dimension', 'Free-text note the reviewer left when clearing or rejecting the row.', { distinct: 264, null_pct: 61.1, confidence: 0.78 }),
  ],
}

const EXTRA_PROJECTS = [
  {
    project_id: 'vrio-cw-transport-ops',
    display_name: 'VLS Transport Ops',
    location: 'US',
    credential_handle: 'cred-handle-3f7c91ab',
    datasets: [
      {
        dataset_id: 'transport_ops',
        location: 'US',
        description:
          'Custody-chain views: which transporter carried which manifest leg, and over what route.',
        semantic_layer: 'gold',
        tables: [
          {
            table_id: 'transporter_manifests',
            label: 'Transporter manifests (legs)',
            type: 'VIEW',
            grain: 'one manifest leg carried by one transporter',
            rows: 4820,
            size_gb: 0,
            partitioned: false,
          },
          {
            table_id: 'route_segments',
            label: 'Route segments',
            type: 'VIEW',
            grain: 'one origin→destination segment of a shipment',
            rows: 9640,
            size_gb: 0,
            partitioned: false,
          },
        ],
      },
    ],
  },
  {
    project_id: 'vrio-cw-sandbox',
    display_name: 'Compliance Sandbox',
    location: 'EU',
    credential_handle: 'cred-handle-c02de845',
    datasets: [
      {
        dataset_id: 'compliance_sandbox',
        location: 'EU',
        description:
          'Staging for enforcement filings that have not been resolved to a facility yet.',
        semantic_layer: 'bronze',
        tables: [
          {
            table_id: 'enforcement_staging',
            label: 'Enforcement staging',
            type: 'TABLE',
            grain: 'one enforcement action awaiting review',
            rows: 640,
            size_gb: 0,
            partitioned: false,
          },
        ],
      },
    ],
  },
]

/* ---------------- the extra Drives, and the nested folders ---------------- */

/**
 * A document, plus the resolution the graph already holds for the entity it names.
 *
 * Every document in `db.json` must resolve to a graph node — a document with no entry renders
 * "nothing resolved yet", which reads as an answer rather than as a gap. These name the same seven
 * facilities the package's own documents resolve to, so nothing here invents a node the canvas has
 * never heard of.
 */
const ENTITIES = {
  chemours: {
    entity: 'The Chemours Company Fayetteville Works',
    node: 'FAC:NCD844706749',
    entity_type: 'Generator (facility)',
    state: 'NC',
    linked_manifests: 19,
  },
  pcs: {
    entity: 'PCS Nitrogen Fertilizer LP',
    node: 'FAC:LAD663309076',
    entity_type: 'Generator (facility)',
    state: 'LA',
    linked_manifests: 21,
  },
  simplot: {
    entity: 'J.R. Simplot Company Don Plant',
    node: 'FAC:IDD698205633',
    entity_type: 'Generator (facility)',
    state: 'ID',
    linked_manifests: 15,
  },
  denka: {
    entity: 'Denka Performance Elastomer LLC',
    node: 'FAC:LAD727050419',
    entity_type: 'Generator (facility)',
    state: 'LA',
    linked_manifests: 28,
  },
  stericycle: {
    entity: 'Stericycle Environmental Solutions',
    node: 'FAC:ILR000067890',
    entity_type: 'Transporter',
    state: 'TX',
    linked_manifests: 197,
  },
}

/** `[document_id, file name, doc_type, doc_type_label, entity key, pages]` */
const doc = (document_id, name, doc_type, doc_type_label, key, pages) => ({
  document_id,
  name,
  mime_type: 'application/pdf',
  doc_type,
  doc_type_label,
  linked_entity: ENTITIES[key].entity,
  pages,
  size_mb: Math.round(pages * 0.09 * 10) / 10,
  entities: 8 + (pages % 17),
  modified: '2025-11-04T00:00:00Z',
  /* Carried through to `document_extractions` below rather than stored on the document: the
     browse tree shows the entity, the graph joins on the resolution, and they are two keys. */
  _entity_key: key,
})

/** Folders appended to the package's own drive. Nested under its `08_unstructured` root. */
const PACKAGE_DRIVE_FOLDERS = [
  {
    folder_id: 'f_08_decrees',
    parent_id: 'f_08_unstructured',
    name: 'decrees',
    path: '/Compliance Docs/08_unstructured/decrees',
    description: 'Consent decrees split out of the root folder, by filing.',
    documents: [
      doc('d_chemours_cd_appendix', 'chemours-cd-appendix-b.pdf', 'consent_decree', 'Consent Decree (appendix)', 'chemours', 24),
      doc('d_pcs_nitrogen_cd_exhibit', 'pcsnitrogenfertilizerlp-cd-exhibit-2.pdf', 'consent_decree', 'Consent Decree (exhibit)', 'pcs', 17),
    ],
  },
  {
    folder_id: 'f_08_decrees_2025',
    parent_id: 'f_08_decrees',
    name: '2025',
    path: '/Compliance Docs/08_unstructured/decrees/2025',
    description: 'Decree filings and modifications entered in 2025.',
    documents: [
      doc('d_simplot_don_cd_mod_signed', 'simplot-don-cd-modification-signed-2025.pdf', 'consent_decree', 'Consent Decree (modification)', 'simplot', 31),
    ],
  },
  {
    folder_id: 'f_08_settlements',
    parent_id: 'f_08_unstructured',
    name: 'settlements',
    path: '/Compliance Docs/08_unstructured/settlements',
    description: 'Stipulations and settlement orders.',
    documents: [
      doc('d_stericycle_settlement_exhibit', 'stericycle-settlement-exhibit-a.pdf', 'settlement', 'Settlement (exhibit)', 'stericycle', 12),
    ],
  },
]

const EXTRA_DRIVES = [
  {
    drive_id: 'my-drive-compliance-lead',
    display_name: 'My Drive',
    kind: 'my_drive',
    credential_handle: 'drive-handle-1c48fa03',
    folders: [
      {
        folder_id: 'f_my_intake',
        parent_id: null,
        name: 'Intake',
        path: '/My Drive/Intake',
        description: 'Filings dropped here before they are filed to the shared drive.',
        documents: [
          doc('d_denka_cafo_intake', 'denka-cafo-intake-copy.pdf', 'cafo', 'Consent Agreement/Final Order', 'denka', 38),
        ],
      },
      {
        folder_id: 'f_my_intake_q3',
        parent_id: 'f_my_intake',
        name: 'Q3 2025',
        path: '/My Drive/Intake/Q3 2025',
        description: 'Intake for the third quarter.',
        documents: [
          doc('d_chemours_cp_notes', 'chemours-complaint-working-notes.pdf', 'complaint', 'Complaint (working copy)', 'chemours', 9),
        ],
      },
      {
        folder_id: 'f_my_review',
        parent_id: null,
        name: 'Under review',
        path: '/My Drive/Under review',
        description: 'Documents a reviewer has open.',
        documents: [
          doc('d_stericycle_complaint_review', 'stericycle-complaint-review-copy.pdf', 'complaint', 'Complaint', 'stericycle', 21),
        ],
      },
    ],
  },
  {
    drive_id: 'vls-legal',
    display_name: 'VLS Legal',
    kind: 'shared_drive',
    credential_handle: 'drive-handle-9ab7e510',
    folders: [
      {
        /* Deliberately empty: a folder that only holds folders. The wizard has to draw it as a
           branch with no documents of its own rather than as a leaf with a zero beside it. */
        folder_id: 'f_legal_active',
        parent_id: null,
        name: 'Active matters',
        path: '/VLS Legal/Active matters',
        description: 'Open matters, one folder per state.',
        documents: [],
      },
      {
        folder_id: 'f_legal_active_la',
        parent_id: 'f_legal_active',
        name: 'Louisiana',
        path: '/VLS Legal/Active matters/Louisiana',
        description: 'Louisiana filings.',
        documents: [
          doc('d_pcs_nitrogen_cd_la', 'pcs-nitrogen-cd-la-filing.pdf', 'consent_decree', 'Consent Decree', 'pcs', 44),
        ],
      },
      {
        folder_id: 'f_legal_active_nc',
        parent_id: 'f_legal_active',
        name: 'North Carolina',
        path: '/VLS Legal/Active matters/North Carolina',
        description: 'North Carolina filings.',
        documents: [
          doc('d_chemours_cd_nc', 'chemours-cd-nc-filing.pdf', 'consent_decree', 'Consent Decree', 'chemours', 96),
        ],
      },
      {
        folder_id: 'f_legal_archive',
        parent_id: null,
        name: 'Archive',
        path: '/VLS Legal/Archive',
        description: 'Closed matters, retained for the record.',
        documents: [
          doc('d_denka_cafo_archive', 'denka-cafo-closed.pdf', 'cafo', 'Consent Agreement/Final Order', 'denka', 38),
        ],
      },
    ],
  },
]

/* ---------------- refuse before writing ---------------- */

const problems = []

/* The catalogue's column count and the profile's length are asserted against each other by
   `check-docs`; a table whose profile is short serves synthesised columns that look exactly as
   plausible as real ones. So the count is *derived* from the profile rather than typed twice. */
for (const project of EXTRA_PROJECTS) {
  for (const dataset of project.datasets) {
    for (const table of dataset.tables) {
      const key = `${dataset.dataset_id}.${table.table_id}`
      const columns = PROFILES[key]
      if (!columns) {
        problems.push(`${key} has no column profile — the catalogue would serve synthesised columns`)
        continue
      }
      const ids = new Set(columns.map((c) => c.column_id))
      if (ids.size !== columns.length) {
        problems.push(`${key} has duplicate column ids — they collide in the dictionary`)
      }
      table.columns = columns.length
    }
  }
}
const profiledKeys = new Set(
  EXTRA_PROJECTS.flatMap((p) =>
    p.datasets.flatMap((d) => d.tables.map((t) => `${d.dataset_id}.${t.table_id}`)),
  ),
)
for (const key of Object.keys(PROFILES)) {
  if (!profiledKeys.has(key)) problems.push(`profile ${key} names no table in this seed`)
}

/* Every class has to be one the client's union already declares, or the dictionary's facets count
   a column into a chip that does not exist. */
const KNOWN_CLASSES = new Set(
  Object.values(db.column_profiles ?? {})
    .flat()
    .map((c) => c.class),
)
for (const [key, columns] of Object.entries(PROFILES)) {
  for (const c of columns) {
    if (!KNOWN_CLASSES.has(c.class)) {
      problems.push(`${key}.${c.column_id} has class "${c.class}", which nothing else uses`)
    }
  }
}

/* Every doc_type must have a facet bucket, or its chip sits at 0 and reads as "none of these in
   this corpus" rather than as a broken map. */
const BUCKETED = new Set(['consent_decree', 'complaint', 'settlement', 'cafo'])
const allNewFolders = [
  ...PACKAGE_DRIVE_FOLDERS,
  ...EXTRA_DRIVES.flatMap((d) => d.folders),
]
const allNewDocs = allNewFolders.flatMap((f) => f.documents)
for (const d of allNewDocs) {
  if (!BUCKETED.has(d.doc_type)) problems.push(`document ${d.document_id} has no facet bucket`)
}

/* A parent that is not a folder of the same drive draws the child nowhere at all. */
for (const drive of [{ drive_id: PACKAGE_DRIVE, folders: PACKAGE_DRIVE_FOLDERS }, ...EXTRA_DRIVES]) {
  const own = new Set(drive.folders.map((f) => f.folder_id))
  const existing = new Set(
    (db.drives.find((d) => d.drive_id === drive.drive_id)?.folders ?? []).map((f) => f.folder_id),
  )
  for (const f of drive.folders) {
    if (f.parent_id && !own.has(f.parent_id) && !existing.has(f.parent_id)) {
      problems.push(`folder ${f.folder_id} names parent ${f.parent_id}, which is not in ${drive.drive_id}`)
    }
  }
}

if (problems.length > 0) {
  console.error('seed-workspaces: refusing to write\n')
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}

/* ---------------- write ---------------- */

const SEEDED_PROJECTS = new Set(EXTRA_PROJECTS.map((p) => p.project_id))
const SEEDED_DRIVES = new Set(EXTRA_DRIVES.map((d) => d.drive_id))
const SEEDED_FOLDERS = new Set(allNewFolders.map((f) => f.folder_id))
const SEEDED_DOCS = new Set(allNewDocs.map((d) => d.document_id))

/* Idempotence: drop the previous run's rows first, so re-running is a rewrite rather than a
   duplicate, and a row renamed here does not leave its old self behind. */
db.projects = db.projects.filter((p) => !SEEDED_PROJECTS.has(p.project_id))
db.credentials = db.credentials.filter((c) => !SEEDED_PROJECTS.has(c.project_id))
db.drives = db.drives.filter((d) => !SEEDED_DRIVES.has(d.drive_id))
db.drive_credentials = db.drive_credentials.filter((c) => !SEEDED_DRIVES.has(c.drive_id))
for (const id of SEEDED_DOCS) delete db.document_extractions[id]

for (const project of EXTRA_PROJECTS) {
  const { credential_handle, ...row } = project
  db.projects.push(row)
  db.credentials.push({ project_id: project.project_id, credential_handle })
}
for (const [key, columns] of Object.entries(PROFILES)) db.column_profiles[key] = columns

const strip = (folder) => ({
  ...folder,
  documents: folder.documents.map(({ _entity_key, ...d }) => d),
})

for (const drive of EXTRA_DRIVES) {
  const { credential_handle, folders, ...row } = drive
  db.drives.push({ ...row, folders: folders.map(strip) })
  db.drive_credentials.push({ drive_id: drive.drive_id, credential_handle })
}

const packageDrive = db.drives.find((d) => d.drive_id === PACKAGE_DRIVE)
if (!packageDrive) {
  console.error(`seed-workspaces: ${PACKAGE_DRIVE} is not in db.json — restore it before seeding`)
  process.exit(1)
}
packageDrive.folders = packageDrive.folders.filter((f) => !SEEDED_FOLDERS.has(f.folder_id))
packageDrive.folders.push(...PACKAGE_DRIVE_FOLDERS.map(strip))

/* `parent_id` on every folder of every drive, including the package's own roots: an absent key
   would mean "predates nesting" as readily as "has no parent", and the tree cannot tell them
   apart. */
for (const drive of db.drives) {
  for (const folder of drive.folders) {
    if (folder.parent_id === undefined) folder.parent_id = null
  }
}

for (const d of allNewDocs) {
  const e = ENTITIES[d._entity_key]
  db.document_extractions[d.document_id] = {
    extraction_id: `DOC:${d.document_id.replace(/^d_/, '')}`,
    extracted_entity: e.entity,
    entity_type: e.entity_type,
    resolved_node: e.node,
    resolved_facility: e.entity,
    state: e.state,
    linked_manifests: e.linked_manifests,
    confidence: 0.88,
  }
}

writeFileSync(DB, JSON.stringify(db, null, 2) + '\n', 'utf8')

const folderCount = db.drives.reduce((s, d) => s + d.folders.length, 0)
console.log(
  `seed-workspaces: ${db.projects.length} GCP projects · ` +
    `${db.drives.length} drives (${db.drives.filter((d) => d.kind === 'my_drive').length} My Drive, ` +
    `${db.drives.filter((d) => d.kind === 'shared_drive').length} shared) · ` +
    `${folderCount} folders, ${db.drives.reduce((s, d) => s + d.folders.filter((f) => f.parent_id).length, 0)} of them nested · ` +
    `${allNewDocs.length} documents added, each resolved into the graph.`,
)
