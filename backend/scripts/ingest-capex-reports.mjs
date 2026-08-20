/*
 * Seeds `db.CAPEX.json`'s `reports.documents` from the CAPEX dataset's own rendered reports.
 *
 *     npm run ingest:capex
 *
 * **The CAPEX reports are documents, not questions.** EPA's five reports are computed per request from
 * `db.reports` — every figure in `reportView`, nothing stored — because a report there *is* a question
 * re-asked of a published graph. CAPEX ships three finished HTML documents instead, each a 2.5 MB
 * standalone page with its own `<head>`, theme and inline scripts. There is no CAPEX roster to compute
 * from, so the honest thing is to serve the documents as documents and say so, rather than transcribe
 * their figures into components — which is the one change that would look right on screen and break the
 * section's premise.
 *
 * **So this ingests metadata and never figures.** Each row carries what the Library needs to list a
 * report and what a reader needs to trust it: the id, the title, the subtitle, the category, the state,
 * the version and the file. The numbers stay inside the document, which is the only place they exist.
 *
 * **And the metadata is read out of the documents rather than typed here.** Each file embeds the
 * prototype's own report registry — `"id": "rep_q_variance", "slug": …, "name": "Variance Report",
 * "subtitle": …` — so the title in the Library is the title the report gives itself. Typing them here
 * would be a second answer to what a report is called, and it would go stale the first time one of these
 * files was re-exported. The script **refuses to write** when a file's `REPORT_ID` has no registry entry
 * or an entry is missing a field, because a row titled `undefined` reads as a broken Library.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'

const DB = new URL('../db.CAPEX.json', import.meta.url)
const DIR = new URL('../../frontend/src/Capex/Report/', import.meta.url)

/*
 * The folder holds the three rendered reports plus the authoring exploration. The reports are matched
 * on the `R<n>_` prefix rather than by listing three filenames: a fourth report is then a file drop
 * plus a re-run, and the authoring page — which carries no `REPORT_ID` — cannot be mistaken for one.
 */
const files = readdirSync(DIR).filter((f) => /^R\d+_.*\.html$/i.test(f)).sort()

const problems = []
const documents = []

for (const file of files) {
  const html = readFileSync(new URL(file, DIR), 'utf8')

  /*
   * What this file *is*. The three documents are 99.9% the same 2.5 MB prototype and differ only in a
   * trailing script that names the report to open, so the id is read from there — it is the one thing
   * that distinguishes them, and it is what the registry entry is then looked up by.
   */
  const idMatch = /var\s+REPORT_ID\s*=\s*"([^"]+)"/.exec(html)
  if (!idMatch) {
    problems.push(`${file} declares no REPORT_ID — it is not one of the rendered reports`)
    continue
  }
  const reportId = idMatch[1]

  /* Whitespace is normalised once so the field patterns below do not have to care how the export was
     formatted; the registry is minified JSON inside a script tag either way. */
  const flat = html.replace(/\s+/g, ' ')
  const at = flat.indexOf(`"id": "${reportId}", "slug"`)
  if (at < 0) {
    problems.push(
      `${file} names report "${reportId}", which has no registry entry in the document — ` +
        'the Library would list a row with no title',
    )
    continue
  }
  const window = flat.slice(at, at + 1400)

  const field = (name) => {
    const m = new RegExp(`"${name}": "((?:[^"\\\\]|\\\\.)*)"`).exec(window)
    return m ? m[1] : null
  }

  /*
   * `version` is a **number** in the registry (`"version": 13`) and is rendered `v13` here, once, so
   * every surface prints the same thing. The EPA rows carry `v3` as a string; formatting it at the
   * boundary rather than in a card is what keeps the two datasets' Library rows looking alike.
   */
  const versionNumber = (/"version": (\d+)/.exec(window) ?? [])[1] ?? null

  const row = {
    document_id: file.slice(0, file.indexOf('_')).toUpperCase(),
    report_id: reportId,
    file,
    title: field('name'),
    subtitle: field('subtitle'),
    category: field('category'),
    status: field('status'),
    version: versionNumber ? `v${versionNumber}` : null,
    slug: field('slug'),
    /* Who wrote it and how fresh it is, both the document's own. `refresh.label` is already a sentence
       a reader can act on ("Daily 07:00 UTC"), which is why it is carried rather than the cron. */
    author: field('author'),
    refresh: (/"refresh": \{[^}]*"label": "([^"]*)"/.exec(window) ?? [])[1] ?? null,
    updated_at: (/"lastEditedAt": "([^"]+)"/.exec(window) ?? [])[1] ?? null,
  }

  /*
   * **The audience in the registry is deliberately not carried.** It names `persona_architect` and
   * friends — the CAPEX prototype's own personas, which are not `db.auth_roles` role ids. Mapping one
   * onto the other would invent a correspondence nobody stated, the same reason the prototype's
   * `audience` and this app's `viewerRoles` are kept as separate fields. Sharing a CAPEX document is
   * this app's own decision, recorded against this app's own roles.
   */

  for (const [key, value] of Object.entries(row)) {
    if (!value) problems.push(`${file} (${reportId}) has no "${key}" — a row cannot be listed without it`)
  }
  documents.push(row)
}

if (files.length === 0) problems.push(`no rendered reports found in ${DIR.pathname}`)

const db = JSON.parse(readFileSync(DB, 'utf8'))

/*
 * A state the pool does not declare has no label and no chip, so the card prints the raw key and every
 * count is short by one — the same cross-key check `validateDb` makes of the EPA governance rows, and
 * neither failure throws.
 */
const states = (db.reports?.governance?.statuses ?? []).map((s) => s.key)
for (const row of documents) {
  if (row.status && !states.includes(row.status)) {
    problems.push(
      `${row.file} is "${row.status}", which db.CAPEX.json's governance.statuses does not declare ` +
        `(${states.join(', ')})`,
    )
  }
}

/* Two documents claiming one id would make the Library's keys collide and the second row unreachable. */
const ids = documents.map((d) => d.document_id)
if (new Set(ids).size !== ids.length) problems.push('two documents share a document_id')

if (problems.length > 0) {
  console.error('\ningest-capex-reports: refusing to write —')
  for (const p of problems) console.error('  · ' + p)
  console.error('\n  Nothing was written. Fix the documents or the report registry inside them.\n')
  process.exit(1)
}

/*
 * The authoring exploration, carried beside the reports rather than among them.
 *
 * It is a *different kind of thing* — an exploration of how a report gets authored, not a report — so it
 * is a named field rather than a fourth row. Listing it in the Library would put a design study in a
 * list of published reports, and its own buttons do not save anywhere this app can see.
 */
const authoring = readdirSync(DIR).find((f) => /authoring/i.test(f)) ?? null

/*
 * ---------------- an authoring starter per report, so Edit works as it does for the primary ----------------
 *
 * **Edit has to land in the authoring wizard, editable, with a Save — the same act it is for EPA.** The
 * prototype offers that only for a row it can resolve to one of its own *starters*; a rendered document has
 * none, so Edit had nothing to open. Framing the static authoring page instead was tried and reported as
 * "it just opens the report": a page with no editing and no Save is not Edit.
 *
 * So each report gets a starter, and the **titles and questions are the dataset's own** — read from its
 * report definitions rather than invented here, joined on `report_tag`.
 *
 * **What the starter cannot borrow is the dataset's own spine.** These definitions are written for the
 * renderer that produced the HTML: `spine: "projects"`, `figRow` blocks, its own scope and measure ids.
 * This prototype's authoring engine is written against the generator roster — `selectRows` returns
 * `Generator[]`, and every block renderer reads those columns — so a `projects` spine would mean rewriting
 * the vendored engine's core rather than adding data to it. The starter therefore uses the spine and block
 * vocabulary the prototype actually has.
 *
 * **Which means the figures in the editor are the prototype's bundled sample data**, exactly as they are
 * when EPA's reports are edited: the Authoring tab has always drawn its own dataset and says so. The
 * difference is only that the sample happens to look like EPA's domain. Nothing about a *published* CAPEX
 * report changes — Open still frames the real rendered document.
 */
const starterBlocks = () => [
  { type: 'kpis', title: 'Summary', kpis: ['count', 'enf', 'penalty', 'cd'] },
  { type: 'chart', title: 'Ranked by measure', chartType: 'bar', measure: 'penalty' },
  {
    type: 'table',
    title: 'Detail',
    cols: ['generator', 'state', 'risk', 'viols', 'penalty', 'cd'],
  },
]

const definitions = db.reports?.reports ?? []
const starters = documents.map((row) => {
  const def = definitions.find((d) => d.report_tag === row.slug || d.report_id === row.report_id)
  return {
    id: row.report_id,
    /* Matched by `starterForTag` on the tag first and the id second; the governed row's tag is this
       slug, so both routes resolve. */
    report_tag: row.slug,
    label: row.title,
    title: row.title,
    /* The dataset's own question where it states one, and its subtitle otherwise — never a sentence
       written in this script. */
    q: def?.question ?? row.subtitle,
    /* The prototype's only editable spine — see the note above. */
    spine: 'generators',
    /* Its own four slots, so `assumptionsForStarter` resolves every one against `opts`. A slot the
       dataset's `opts` does not declare would leave the read-back with a hole in its sentence. */
    reading: {
      template: '{q} Using {graph}, over {scope}, by {measure}, {horizon}.'.replace('{q} ', ''),
      slots: ['graph', 'scope', 'measure', 'horizon'],
    },
    blocks: starterBlocks(),
  }
})

const slots = Object.keys(db.reports_prototype?.opts ?? {})
for (const s of starters) {
  for (const slot of s.reading.slots) {
    if (!slots.includes(slot)) {
      problems.push(
        `starter "${s.id}" reads slot "${slot}", which this dataset's reports_prototype.opts does not ` +
          `declare (${slots.join(', ')}) — the read-back sentence would have a hole in it`,
      )
    }
  }
  if (!(db.reports_prototype?.[s.spine] ?? []).length) {
    problems.push(
      `starter "${s.id}" is on spine "${s.spine}", which this dataset's reports_prototype has no rows ` +
        'for — the editor would open on an empty report',
    )
  }
}

if (problems.length > 0) {
  console.error('\ningest-capex-reports: refusing to write —')
  for (const p of problems) console.error('  · ' + p)
  console.error('\n  Nothing was written.\n')
  process.exit(1)
}

db.reports = {
  ...db.reports,
  documents,
  authoring_document: authoring,
}

/*
 * Only `starters` is replaced. The rest of `reports_prototype` — the rosters, the field dictionary, the
 * slot options, the persona — is the dataset's and is carried through: a script that owns a subtree and
 * rewrites its parent is how a subtree gets deleted, which this repo has been bitten by twice.
 */
db.reports_prototype = {
  ...db.reports_prototype,
  starters,
  /*
   * **The seeded shelf is emptied, because its rows were built from the starters just replaced.**
   *
   * This dataset arrived carrying the primary's five starters and four demo library rows built on them
   * (`built from unknown starter "facility"` and three more). Swapping in this dataset's own starters left
   * those rows pointing at ids that no longer exist — which the prototype's *own* validator refuses,
   * loudly and at hydration, so the section would not render at all. Found exactly that way.
   *
   * Emptying is the right resolution rather than keeping both sets: the shelf is the prototype's own
   * fiction — other people's reports, with bylines nobody here has — and hosted it starts empty anyway,
   * because a governed Library is present and the prototype defers to it. `library` may legitimately be
   * empty; a fresh workspace has published nothing.
   */
  library: [],
}

writeFileSync(DB, JSON.stringify(db, null, 2) + '\n', 'utf8')
console.log(
  `ingest-capex-reports: ${documents.length} documents -> db.CAPEX.json\n` +
    documents.map((d) => `  ${d.document_id}  ${d.status.padEnd(9)} ${d.version.padEnd(4)} ${d.title}`).join('\n') +
    (authoring ? `\n  authoring: ${authoring}` : '\n  authoring: none found'),
)
