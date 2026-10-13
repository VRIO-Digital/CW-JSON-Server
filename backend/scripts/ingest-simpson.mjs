/**
 * Ingest the Simpson (Ridgeline Structural Products) demo package into the SIMPSON dataset's
 * split files.
 *
 * **The package's reference copy was removed once split** (the VLS arrangement), so this script is
 * dormant: the committed `backend/simpson/` split files are the store, and running this without
 * restoring the package refuses naming the missing path. To re-ingest a rebuilt package, drop it
 * back at `frontend/simpson-json/` and run `npm run ingest:simpson`.
 *
 * Reads the package's merged document — `frontend/simpson-json/json/00_merged/db.RIDGELINE.json`,
 * the one file its own `_meta` says is canonical — and fans it out into
 * `backend/simpson/simpson_*.json`, the same one-file-per-feature-area layout `backend/keolis/`
 * has and `simpson-loader.js` reads.
 *
 * **Every key is either mapped, deliberately dropped, or the run refuses.** The package is
 * regenerated from its own `_build/` scripts, so a future rebuild can grow a key this mapping has
 * never seen — and a key that lands in no split file is data that silently never reaches the
 * server, which is the failure `writeSplitFiles` documents for the same mapping one layer up.
 *
 * What is deliberately dropped, and why:
 *
 * - `settings`, `auth_roles`, `google_account` — tenant-level keys. The loaders overlay the shared
 *   `backend/settings.json` after the dataset's own files, so a copy here would either be dead or
 *   fight the shared file. The package's users are `@vriodigital.com` addresses; the ones the
 *   shared directory does not already hold (marcus.bell, priya.raman, elena.vasquez, tom.okafor,
 *   grace.lindqvist, raj.patel) are a `seed:settings` decision, not this script's.
 * - `_meta`, `_provenance` — the package's account of itself. A dataset's provenance landing in the
 *   shared settings file would be claimed by every dataset at the next boot.
 *
 * What is rewritten, and why — **the rendered-document pointers are stripped; the What-if pointer
 * is read from a shipped lens where one exists**:
 *
 * - `reports.documents` -> `[]`, `reports.authoring_document` -> null,
 *   `reports.governance.document` -> null.
 *
 *   The package names HTML exports (`R1_margin_gap_review.html`, `R2_family_360.html`,
 *   `R3_cost_to_price_pack.html`, `report_authoring_simplified_v3.html`,
 *   `governance_audit_rsp.html`) that it does not ship — there is no .html anywhere in
 *   `frontend/simpson-json/`. Serving the pointers anyway is worse than serving none: the client
 *   resolves a document by **basename** across every dataset folder, so a missing file frames the
 *   SPA's own index.html inside the report frame. With the pointers stripped, Audit & Governance
 *   falls back to the computed page over `reports.register` and the report surfaces stay honestly
 *   gated until Simpson documents exist. When they do, restore the pointers here (with basenames
 *   unique to a `frontend/src/Simpson/` folder) in the same change that adds the files.
 *
 * - `whatif.document` is rebuilt from a shipped lens in `frontend/src/Simpson/what-if-lens/` when
 *   that folder holds one — the arrangement `ingest-keolis.mjs` has — and stripped otherwise,
 *   which is the current state: the package names `whatif_rsp_demo.html` and ships no such file.
 *
 * SIMPSON is a **Microsoft-brand** dataset (`PROVIDER_BRANDS` in `backend/datasets.js`), like
 * KEOLIS, so its mail corpus is re-filed under Outlook's `Inbox` — see below.
 *
 * Run it with `npm run ingest:simpson` (from the repo root or `backend/`), then restart the mock
 * server — the loaders read the split files at boot only.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const backendDir = join(here, '..')
const packageDoc = join(
  backendDir,
  '..',
  'frontend',
  'simpson-json',
  'json',
  '00_merged',
  'db.RIDGELINE.json',
)
const outDir = join(backendDir, 'simpson')

/**
 * Which split file each key travels in — the same mapping `writeSplitFiles` in `server.js` uses,
 * with `data_model` and `change_signals` in the catalogue file because they are the dataset's own
 * (a data-model entity is keyed `"<dataset>.<table>"` into *this* dataset's tables).
 */
const SPLIT_MAPPING = [
  {
    file: 'simpson_sources.json',
    keys: [
      'projects',
      'credentials',
      'column_profiles',
      'column_vocabulary',
      'drives',
      'drive_credentials',
      'document_extractions',
      'mail_corpus',
    ],
  },
  { file: 'simpson_catalogue.json', keys: ['document_vocabulary', 'data_model', 'change_signals'] },
  {
    file: 'simpson_new_graph.json',
    keys: [
      'graph_domains',
      'graph_personas',
      'graph_hero_questions',
      'graph_use_cases',
      'graph_use_case_templates',
      'graph_metrics',
      'graph_answer_formats',
    ],
  },
  { file: 'simpson_graph_studio.json', keys: ['graph_studio', 'studio_graph'] },
  { file: 'simpson_reports.json', keys: ['reports', 'reports_prototype'] },
  { file: 'simpson_ask.json', keys: ['ask_answers'] },
  { file: 'simpson_whatif.json', keys: ['whatif'] },
  { file: 'simpson_audit_governance.json', keys: ['audit', 'traces', 'evals'] },
]

/** Tenant-level and provenance keys the split deliberately leaves behind — see the header. */
const DROPPED = ['settings', 'auth_roles', 'google_account', '_meta', '_provenance']

function fail(message) {
  console.error(`\ningest-simpson: refusing to write — ${message}\n`)
  process.exit(1)
}

let source
try {
  source = JSON.parse(readFileSync(packageDoc, 'utf8'))
} catch (error) {
  fail(`cannot read the package's merged document at ${packageDoc}: ${error.message}`)
}

/* Every key must be mapped or deliberately dropped — a key in neither is data that would
   silently never reach the server, so the run stops and names it. */
const mapped = new Set(SPLIT_MAPPING.flatMap((entry) => entry.keys))
const unaccounted = Object.keys(source).filter((key) => !mapped.has(key) && !DROPPED.includes(key))
if (unaccounted.length > 0) {
  fail(
    `the package document carries ${unaccounted.length} key(s) this mapping does not place: ` +
      `${unaccounted.join(', ')}. Add each one to SPLIT_MAPPING (or to DROPPED, saying why).`,
  )
}

/* ------------- the mail corpus, re-filed under Outlook's Inbox — SIMPSON is Microsoft-brand ------------- */

/*
 * SIMPSON is a Microsoft-brand dataset (`PROVIDER_BRANDS` in `backend/datasets.js`), so its mailbox
 * carries **Outlook's folders** (`OUTLOOK_FOLDERS` in `server.js`), not Gmail's labels. The package
 * files its corpus under Gmail's `INBOX`; left that way, every shipped mail document would be
 * filed under a folder the mailbox does not have — invisible in the catalogue rather than wrong on
 * screen, which is exactly the silent failure the label check exists to prevent. Received mail goes
 * to Outlook's `Inbox`, so the re-filing is a rename of the same fact, never a re-sorting.
 */
if (source.mail_corpus && Array.isArray(source.mail_corpus.documents)) {
  for (const doc of source.mail_corpus.documents) {
    if (doc.label_id === 'INBOX') doc.label_id = 'Inbox'
  }
}

/* ------------- the data model, re-shaped so first contact is a review rather than a verdict ------------- */

/*
 * The package ships its data model already decided: 33 bare anchor entities (no overview content —
 * each description says "created to anchor a declared relationship") carrying 29 relationships,
 * every one with `confirmed_by` set to a directory address. On the Data Modeling tab that renders
 * as relations **Confirmed by you** the first time anybody profiles the source — a claim about the
 * reader that is false for every row, the exact fault `confirmed_by` exists to prevent (nobody in
 * this app accepted them; a generator did). Asked for in those terms: on a first profile every
 * count should land under *suggested, pending*, as it does elsewhere.
 *
 * So each declared relationship becomes a **recorded suggestion** — the shape the review queue is
 * for: the row arrives pending with its name, join, cardinality and the package's own rationale,
 * and a reader's Accept is what writes `confirmed_by`. `relationship_type_alternatives` is empty
 * (the declaration stated none). `confidence` has to be a number — `validateDb` requires one on a
 * *recorded* suggestion, where it is a stated opinion — so it is 0.9: the generator wrote these as
 * outright facts, and a high stated confidence is the honest downgrade from "asserted" to
 * "proposed for review". The anchor entities go with the relationships they anchored — an entity
 * with no declaration and no content left is a row that reads "Curated by AI" over nothing.
 */
const CONVERTED_CONFIDENCE = 0.9
function pendingDataModel(dm) {
  const suggestions = [...(dm.suggestions ?? [])]
  const ids = new Set(suggestions.map((s) => s.suggestion_id))
  const pairKey = (a, b, ca, cb) => [`${a}.${ca}`, `${b}.${cb}`].sort().join('~')
  const pairs = new Set(suggestions.map((s) => pairKey(s.from_table_key, s.to_table_key, s.from_column, s.to_column)))
  const slug = (k) => k.replace(/[^a-z0-9]+/gi, '_').toLowerCase()
  let converted = 0
  let skipped = 0
  for (const e of dm.entities ?? []) {
    for (const r of e.relationships ?? []) {
      const key = pairKey(e.table_key, r.target_table_key, r.from_columns[0], r.to_columns[0])
      if (pairs.has(key)) {
        skipped += 1 /* two rows for one join would ask the reviewer the same question twice */
        continue
      }
      pairs.add(key)
      let id = `sg_rsp_${slug(e.table_key)}__${slug(r.target_table_key)}`
      for (let n = 2; ids.has(id); n += 1) id = `sg_rsp_${slug(e.table_key)}__${slug(r.target_table_key)}_${n}`
      ids.add(id)
      suggestions.push({
        suggestion_id: id,
        from_table_key: e.table_key,
        from_column: r.from_columns[0],
        to_table_key: r.target_table_key,
        to_column: r.to_columns[0],
        relationship_type: r.relationship_type,
        relationship_type_alternatives: [],
        cardinality_hint: r.cardinality_hint,
        rationale: r.rationale,
        confidence: CONVERTED_CONFIDENCE,
      })
      converted += 1
    }
  }
  return { out: { ...dm, entities: [], suggestions }, converted, skipped }
}

if (source.data_model) {
  const multi = (source.data_model.entities ?? []).flatMap((e) => e.relationships ?? []).filter(
    (r) => (r.from_columns ?? []).length > 1 || (r.to_columns ?? []).length > 1,
  )
  if (multi.length > 0) {
    /* A suggestion carries one column per side, so a multi-column declaration cannot become one
       without dropping columns in silence — a rebuilt package that ships one needs a decision. */
    fail(`${multi.length} declared relationship(s) join on more than one column — a recorded suggestion cannot carry that; decide how they convert`)
  }
  const { out, converted, skipped } = pendingDataModel(source.data_model)
  source.data_model = out
  console.log(
    `ingest-simpson: data model re-shaped — ${converted} declared relationship(s) now pending ` +
      `suggestions${skipped > 0 ? `, ${skipped} duplicate pair(s) folded` : ''}; anchor entities removed`,
  )
}

/* ------------- runtime.headroom, normalised to the shape the client schema requires ------------- */

/*
 * The client validates the whole `/whatif` payload at the boundary — before deciding whether the
 * lens is framed or computed — and `runtime.headroom` must carry `{ label, sentence, help }`. This
 * package's generator wrote the block in a different shape: the same `label` and `help`, but an
 * `items[]` list of per-pool answers in place of the `sentence` template every other dataset
 * carries. Without the field, every `/whatif` read under SIMPSON is refused with
 * `runtime.headroom.sentence should be a string, got undefined` — the whole page, not just the
 * computed lens the field belongs to.
 *
 * The sentence supplied is the product's own template, word for word what KEOLIS and CAPEX carry
 * (`{room}`, `{unit}` and `{driver}` are interpolated by the component) — template copy rather than
 * tenant prose, so nothing is put in the tenant's mouth. The package's `items` ride along
 * untouched; `shape()` ignores keys it does not declare. `label` and `help` are checked rather than
 * defaulted, because those really are the tenant's words.
 */
const rh = source.whatif?.runtime?.headroom
if (!rh || typeof rh.label !== 'string' || typeof rh.help !== 'string') {
  fail('whatif.runtime.headroom is missing its label or help — the runtime panel would render blank')
}
if (typeof rh.sentence !== 'string') {
  rh.sentence = '{room}{unit} more on {driver} before the base case crosses the envelope.'
}

/* ---------------- the rendered-document pointers, stripped — see the header ---------------- */

const reports = source.reports
if (!reports || typeof reports !== 'object') fail('the package document has no "reports" key')

/* ------------- the report spines and the register roster, re-pointed at the slot the rows ship in ------------- */

/*
 * The package generator carried the CAPEX schema, so its rows live in `reports.data.projects` —
 * but it wrote the **tenant's nouns** into the references: every report definition says
 * `spine: "families"` and the register says `roster: "accounts"`, and neither roster exists in
 * `reports.data`. Served that way, `validateDb` refuses the boot (a spine with no roster renders
 * tiles above an empty table), and the governance page resolves every rule against an empty
 * register. The rows are one list under one key, so the references are re-pointed at it; the
 * tenant's own nouns stay where they belong — in the labels and copy the rows carry. A rewrite
 * here rather than in the committed files, because the package is generated and `_meta` forbids
 * hand-editing: the next rebuild re-runs this ingest and gets the same correction.
 *
 * The rewrite is checked, not assumed: it refuses unless the rows really are there and carry the
 * label column (`n`) and every register field, so a rebuilt package that moves the rows fails
 * loudly instead of serving a spine that happens to parse.
 */
const ROWS_SLOT = 'projects'
const rosterRows = reports.data?.[ROWS_SLOT]
if (!Array.isArray(rosterRows) || rosterRows.length === 0) {
  fail(`reports.data.${ROWS_SLOT} is missing or empty — the report spines have no rows to point at`)
}
if (!rosterRows.every((row) => row && typeof row.n === 'string')) {
  fail(`reports.data.${ROWS_SLOT} rows do not all carry "n", the label column REPORT_LABEL_KEY declares for this spine`)
}
for (const def of reports.reports ?? []) {
  if (def.spine !== ROWS_SLOT) def.spine = ROWS_SLOT
}
if (reports.register && reports.register.roster !== ROWS_SLOT) {
  const rowKeys = new Set(Object.keys(rosterRows[0]))
  const unknownFields = (reports.register.fields ?? []).filter((f) => !rowKeys.has(f.key))
  if (unknownFields.length > 0) {
    fail(
      `the register's fields name column(s) the ${ROWS_SLOT} rows do not carry: ` +
        unknownFields.map((f) => f.key).join(', '),
    )
  }
  reports.register.roster = ROWS_SLOT
}

const strippedPointers = []
if (Array.isArray(reports.documents) && reports.documents.length > 0) {
  strippedPointers.push(...reports.documents.map((d) => d.file))
  reports.documents = []
}
if (reports.authoring_document) {
  strippedPointers.push(reports.authoring_document)
  reports.authoring_document = null
}
if (reports.governance?.document) {
  strippedPointers.push(reports.governance.document.file)
  reports.governance.document = null
}

/* ------------- the What-if lens pointer, rebuilt from a shipped document where one exists ------------- */

const lensDir = join(backendDir, '..', 'frontend', 'src', 'Simpson', 'what-if-lens')
let lensFiles = []
try {
  lensFiles = readdirSync(lensDir)
    .filter((f) => f.toLowerCase().endsWith('.html'))
    .sort()
} catch {
  /* No folder means no shipped lens — the pointer is stripped below. */
}
if (lensFiles.length > 1) {
  /* One lens per dataset: the What-if page frames one document, so a second would be unreachable. */
  fail(
    `${lensDir} holds ${lensFiles.length} lens documents (${lensFiles.join(', ')}) — ` +
      'the What-if page frames one, so a second would be unreachable. Remove one.',
  )
}

/* Tags out, entities decoded, whitespace collapsed — the standfirst is authored as markup. */
const text = (html) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

const packagedLens = source.whatif?.document ?? null
const restoredPointers = []
if (lensFiles.length === 1) {
  const file = lensFiles[0]
  const html = readFileSync(join(lensDir, file), 'utf8')
  const grab = (re) => {
    const m = re.exec(html)
    return m ? text(m[1]) : null
  }

  /* `What-if — … (draft v2)` splits into title / stage / version where the page stamps one; the
     two fields fall back to the package's own pointer — the generator's account of the same
     export — and the refusal below still fires if neither side states them. */
  const titleTag = grab(/<title>([\s\S]*?)<\/title>/)
  const stamped = /^(.*?)\s*\(\s*(?:([A-Za-z]+)\s+)?v(\d+)\s*\)\s*$/.exec(titleTag ?? '')

  const lensDocument = {
    document_id: packagedLens?.document_id ?? null,
    file,
    title: stamped ? stamped[1] : titleTag,
    version: stamped ? `v${stamped[3]}` : (packagedLens?.version ?? null),
    stage: stamped && stamped[2] ? stamped[2].toLowerCase() : (packagedLens?.stage ?? null),
    /* The page's own heading and standfirst, read so the pointer cannot disagree with the frame. */
    heading: grab(/<h1>([\s\S]*?)<\/h1>/),
    subtitle: grab(/<div class="sub">([\s\S]*?)<\/div>/),
    /* Re-read from the page's own buttons — the key from the `showTab(...)` call each one makes,
       the label from what it says. */
    tabs: [
      ...html.matchAll(
        /<button class="tab[^"]*"[^>]*onclick="showTab\('([^']+)'\)"[^>]*>([^<]*)<\/button>/g,
      ),
    ].map((m) => ({ key: m[1], label: text(m[2]) })),
  }

  for (const [key, value] of Object.entries(lensDocument)) {
    if (!value || (Array.isArray(value) && value.length === 0)) {
      fail(
        `${file} states no "${key}" (and the package pointer supplies none) — ` +
          'the What-if page would frame a document it cannot label',
      )
    }
  }

  /* The stored default has to name a tab the page actually has, or the lens opens on one that is
     not there. */
  const defaultTab = source.whatif?.state_defaults?.tab
  if (defaultTab && !lensDocument.tabs.some((t) => t.key === defaultTab)) {
    fail(
      `whatif.state_defaults.tab is "${defaultTab}", which ${file} does not declare ` +
        `(${lensDocument.tabs.map((t) => t.key).join(', ')})`,
    )
  }

  source.whatif.document = lensDocument
  restoredPointers.push(`${file} (${lensDocument.stage} ${lensDocument.version} — ${lensDocument.title})`)
} else if (packagedLens) {
  strippedPointers.push(packagedLens.file)
  delete source.whatif.document
}

/* ---------------- write the split files ---------------- */

mkdirSync(outDir, { recursive: true })

const summary = []
for (const { file, keys } of SPLIT_MAPPING) {
  const fileData = {}
  for (const key of keys) {
    if (key in source) fileData[key] = source[key]
  }
  const missing = keys.filter((key) => !(key in source))
  writeFileSync(join(outDir, file), `${JSON.stringify(fileData, null, 2)}\n`, 'utf8')
  summary.push(
    `  ${file} — ${Object.keys(fileData).join(', ') || '(empty)'}` +
      (missing.length > 0 ? ` (absent in package: ${missing.join(', ')})` : ''),
  )
}

console.log(`ingest-simpson: wrote ${SPLIT_MAPPING.length} split files to backend/simpson/`)
for (const line of summary) console.log(line)
if (strippedPointers.length > 0) {
  console.log(
    `  stripped ${strippedPointers.length} rendered-document pointer(s) the package names but does ` +
      `not ship: ${strippedPointers.join(', ')}`,
  )
}
if (restoredPointers.length > 0) {
  console.log(`  what-if lens pointer read from the shipped document: ${restoredPointers.join(', ')}`)
}
console.log('  dropped (tenant-level, served from backend/settings.json): ' + DROPPED.join(', '))
console.log('\nRestart the mock server for the split files to be read.')
