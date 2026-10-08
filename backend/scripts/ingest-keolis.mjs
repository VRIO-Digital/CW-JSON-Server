/**
 * Ingest the Keolis Valmont demo package into the KEOLIS dataset's split files.
 *
 * Reads the package's merged document — `frontend/keolis/json/00_merged/db.KEOLIS.json`, the one
 * file its own README says is canonical — and fans it out into `backend/keolis/keolis_*.json`,
 * the same one-file-per-feature-area layout `backend/capex/` has and `keolis-loader.js` reads.
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
 *   fight the shared file. The package's own users are the same `@vriodigital.com` directory (its
 *   README: "Demo logins stay on @vriodigital.com, because the login resolves against
 *   settings.users"), so nothing is lost.
 * - `_meta`, `_provenance` — the package's account of itself. `commitDb` writes tenant-level keys
 *   back to the shared `backend/settings.json`, and `_meta` used to be on that list — a dataset's
 *   provenance landing in the shared file would be claimed by every dataset at the next boot.
 *
 * What is rewritten, and why — **the report pointers are stripped; the What-if pointer is read
 * from the shipped lens**:
 *
 * - `reports.documents` -> `[]`, `reports.authoring_document` -> null,
 *   `reports.governance.document` -> null.
 *
 *   The package names HTML exports (`R1_intervention_review.html`, `R2_project_360.html`, …) that
 *   it does not ship — there is no .html anywhere in it. Serving the pointers anyway is worse than
 *   serving none: the client resolves a document by **basename** across every dataset folder, and
 *   `R2_project_360.html` collides with CAPEX's shipped file — so a Keolis row would frame
 *   **CAPEX's** report, which is the dataset bleed this repo refuses everywhere. With the pointers
 *   stripped, Audit & Governance falls back to the computed page over `reports.register`, and the
 *   report surfaces stay honestly gated until Keolis documents exist. When they do, restore the
 *   pointers here (with basenames unique to a `frontend/src/Keolis/` folder) in the same change
 *   that adds the files.
 *
 * - `whatif.document` is **rebuilt from the shipped lens** in `frontend/src/Keolis/what-if-lens/`
 *   — the arrangement `ingest-capex-reports.js` has for CAPEX's: every field the page states is
 *   read out of the file itself (title, heading, standfirst, tabs), so the pointer cannot disagree
 *   with what the frame shows, and the basename is the shipped one (`keolis_what_if_lens.html`,
 *   unique across datasets) rather than the colliding `W1_what_if_lens.html` the package names.
 *   The page stamps no `(stage vN)` into its <title>, so `version` and `stage` come from the
 *   package's own pointer — the generator's account of the same export — rather than being typed
 *   here. With no shipped lens the pointer is stripped, which was the prior behaviour throughout.
 *
 * Run it with `npm run ingest:keolis` (from the repo root or `backend/`), then restart the mock
 * server — the loaders read the split files at boot only.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const backendDir = join(here, '..')
const packageDoc = join(backendDir, '..', 'frontend', 'keolis', 'json', '00_merged', 'db.KEOLIS.json')
const outDir = join(backendDir, 'keolis')

/**
 * Which split file each key travels in — the same mapping `writeSplitFiles` in `server.js` uses,
 * with `data_model` and `change_signals` in the catalogue file because they are the dataset's own
 * (a data-model entity is keyed `"<dataset>.<table>"` into *this* dataset's tables).
 */
const SPLIT_MAPPING = [
  {
    file: 'keolis_sources.json',
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
  { file: 'keolis_catalogue.json', keys: ['document_vocabulary', 'data_model', 'change_signals'] },
  {
    file: 'keolis_new_graph.json',
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
  { file: 'keolis_graph_studio.json', keys: ['graph_studio', 'studio_graph'] },
  { file: 'keolis_reports.json', keys: ['reports', 'reports_prototype'] },
  { file: 'keolis_ask.json', keys: ['ask_answers'] },
  { file: 'keolis_whatif.json', keys: ['whatif'] },
  { file: 'keolis_audit_governance.json', keys: ['audit', 'traces', 'evals'] },
]

/** Tenant-level and provenance keys the split deliberately leaves behind — see the header. */
const DROPPED = ['settings', 'auth_roles', 'google_account', '_meta', '_provenance']

function fail(message) {
  console.error(`\ningest-keolis: refusing to write — ${message}\n`)
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

/* ------------- the mail corpus, re-filed under Outlook's Inbox — KEOLIS is Microsoft-brand ------------- */

/*
 * KEOLIS is a Microsoft-brand dataset (`PROVIDER_BRANDS` in `backend/datasets.js`), so its mailbox
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

/* ---------------- the rendered-document pointers, stripped — see the header ---------------- */

const reports = source.reports
if (!reports || typeof reports !== 'object') fail('the package document has no "reports" key')

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
/* ------------- the What-if lens pointer, rebuilt from the shipped document — see the header ------------- */

const lensDir = join(backendDir, '..', 'frontend', 'src', 'Keolis', 'what-if-lens')
let lensFiles = []
try {
  lensFiles = readdirSync(lensDir)
    .filter((f) => f.toLowerCase().endsWith('.html'))
    .sort()
} catch {
  /* No folder means no shipped lens — the pointer is stripped below, the prior behaviour. */
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

  /* `What-if — … (draft v2)` splits into title / stage / version where the page stamps one. This
     page stamps none, so the two fields fall back to the package's own pointer — the generator's
     account of the same export — and the refusal below still fires if neither side states them. */
  const titleTag = grab(/<title>([\s\S]*?)<\/title>/)
  const stamped = /^(.*?)\s*\(\s*(?:([A-Za-z]+)\s+)?v(\d+)\s*\)\s*$/.exec(titleTag ?? '')

  const lensDocument = {
    /* The package's id for this export — nothing in the page states one, and the filename's stem
       would be the whole basename, which is not an id. */
    document_id: packagedLens?.document_id ?? null,
    file,
    title: stamped ? stamped[1] : titleTag,
    version: stamped ? `v${stamped[3]}` : (packagedLens?.version ?? null),
    stage: stamped && stamped[2] ? stamped[2].toLowerCase() : (packagedLens?.stage ?? null),
    /* The page's own heading and standfirst, read so the pointer cannot disagree with the frame. */
    heading: grab(/<h1>([\s\S]*?)<\/h1>/),
    subtitle: grab(/<div class="sub">([\s\S]*?)<\/div>/),
    /* Re-read from the page's own buttons — the key from the `showTab(...)` call each one makes,
       the label from what it says — the rule CAPEX's ingest states for the same list. */
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

console.log(`ingest-keolis: wrote ${SPLIT_MAPPING.length} split files to backend/keolis/`)
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
