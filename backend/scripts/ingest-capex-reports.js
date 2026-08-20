/*
 * Seeds `db.CAPEX.json` from the CAPEX dataset's own rendered documents — its three reports and its
 * What-if lens.
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
 *
 * **The What-if lens is seeded here too, because it is the same kind of thing.** CAPEX ships a rendered
 * What-if page rather than a pool of candidate loads to traverse, so it is framed as a document exactly as
 * the reports are — and it is seeded by this script rather than a second one because both write
 * `db.CAPEX.json`, and two writers of one document is how a subtree gets dropped. The section below states
 * the rest of the reasoning.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'

const DB = new URL('../db.CAPEX.json', import.meta.url)
const DIR = new URL('../../frontend/src/Capex/Report/', import.meta.url)
/*
 * The What-if lens is a document too, and it lives in its own folder beside the reports.
 *
 * **The folder is what says which kind of document a file is.** `Report/` holds reports and
 * `what-if-lens/` holds the lens, so a second lens is a file drop rather than an edit here — the same
 * reasoning `reportDocuments.ts` gives for globbing per dataset folder rather than naming CAPEX.
 */
const LENS_DIR = new URL('../../frontend/src/Capex/what-if-lens/', import.meta.url)

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

/*
 * ---------------- the What-if lens, which is a document for the same reason the reports are ----------------
 *
 * **CAPEX's What-if is a rendered page, not a traversal.** EPA's lens admits a candidate load into the
 * published graph and traverses to that generator's federal record, so every figure on it is computed by
 * `whatifScenario` per request. CAPEX has no such pool, and its own `_not_applicable` block says why in as
 * many words: *"CAPEX exposes continuous levers, not a pool of swappable candidates"* — which is why its
 * `generators` and `candidate_pools` are legitimately empty. What it ships instead is a finished page whose
 * model is a cost decomposition moved by sliders, so the honest thing is to serve it as a document exactly
 * as its three reports are served — rather than bend the traversal lens into a shape its data cannot fill,
 * or transcribe the page's figures into components.
 *
 * **The fixture behind the page is already in this document, and stays untouched.** `whatif.slices`,
 * `levers`, `locked_slices` and `program` are a verbatim extract of this file's own `SLICES`/`PROGRAM` —
 * all five slice traces match character for character — so nothing here re-derives them. What was missing
 * is the pointer to the file, which is the only thing the app needs in order to frame it.
 */
const lensFiles = readdirSync(LENS_DIR).filter((f) => /^W\d+_.*\.html$/i.test(f)).sort()
if (lensFiles.length === 0) {
  problems.push(`no What-if lens document found in ${LENS_DIR.pathname} (expected W<n>_*.html)`)
} else if (lensFiles.length > 1) {
  /* One lens per dataset, because the What-if page frames one document — a second would be unreachable,
     which is the silent half of the duplicate-basename throw in `reportDocuments.ts`. */
  problems.push(
    `${LENS_DIR.pathname} holds ${lensFiles.length} lens documents (${lensFiles.join(', ')}) — ` +
      'the What-if page frames one, so the rest would be unreachable',
  )
}

/* Tags out, entities decoded, whitespace collapsed. The copy is authored as markup — the banner carries a
   `<b>` — and a heading printing a literal `<b>` reads as a broken export rather than as one this script
   failed to read. */
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

let lensDocument = null
if (lensFiles.length === 1) {
  const file = lensFiles[0]
  const html = readFileSync(new URL(file, LENS_DIR), 'utf8')
  const grab = (re) => {
    const m = re.exec(html)
    return m ? text(m[1]) : null
  }

  /*
   * The `<title>` carries two facts in one string — `What-if — Veolia CapEx (draft v2)` — so it is split
   * rather than stored whole: the name is what the bar beside the frame prints, and the stage and the
   * version are what say how finished the thing is. A page stating no version keeps a null and the check
   * below refuses, because a bar reading `· v` with nothing after it looks like a failed load.
   */
  const titleTag = grab(/<title>([\s\S]*?)<\/title>/)
  const stamped = /^(.*?)\s*\(\s*(?:([A-Za-z]+)\s+)?v(\d+)\s*\)\s*$/.exec(titleTag ?? '')

  lensDocument = {
    document_id: file.slice(0, file.indexOf('_')).toUpperCase(),
    file,
    /* The name the `<title>` gives, without the parenthetical the next two fields carry. */
    title: stamped ? stamped[1] : titleTag,
    version: stamped ? `v${stamped[3]}` : null,
    /*
     * "draft" — the document's own word for how finished it is, and deliberately **not** checked against
     * `governance.statuses`. Those are the lifecycle states of a governed Library row, and this is not
     * one: it is not listed in the Library, and nothing here publishes, approves or archives it.
     * Borrowing that vocabulary would claim a governance record that does not exist.
     */
    stage: stamped && stamped[2] ? stamped[2].toLowerCase() : null,
    /*
     * **No `category`, deliberately.** A report carries one because its own registry states one
     * ("Executive"), and this page states none. The two candidates were both worse than nothing: the
     * folder name yields "what if lens", which loses the hyphen the product name has, and typing
     * "What-if lens" would be this script putting a label in the document's mouth — the same
     * transcription the figures are kept out of components to avoid. The bar beside the frame prints
     * what the page does state: its name, its version and its stage.
     */
    /* The page's own heading and standfirst. The frame prints them itself, so nothing above it restates
       them; they are carried so a bar can label the frame and so the document can be listed at all. */
    heading: grab(/<h1>([\s\S]*?)<\/h1>/),
    subtitle: grab(/<div class="sub">([\s\S]*?)<\/div>/),
    /*
     * **The tab list is re-read, because it is the one thing in `whatif.copy` this page contradicted.**
     *
     * That block was extracted from an earlier build with three tabs — Author, Run & compare, Library —
     * and this page has two, Authoring and Runtime. `copy.tabs` is what the *React* lens renders, so for a
     * dataset whose lens is a framed document nothing prints them at all: a stale list is invisible rather
     * than visibly wrong, which is exactly how it would stay stale. Read from the page's own buttons — the
     * key from the `showTab(...)` call each one makes, the label from what it says.
     */
    tabs: [
      ...html.matchAll(
        /<button class="tab[^"]*"[^>]*onclick="showTab\('([^']+)'\)"[^>]*>([^<]*)<\/button>/g,
      ),
    ].map((m) => ({ key: m[1], label: text(m[2]) })),
  }

  for (const [key, value] of Object.entries(lensDocument)) {
    if (!value || (Array.isArray(value) && value.length === 0)) {
      problems.push(`${file} states no "${key}" — the What-if page would frame a document it cannot label`)
    }
  }

  /* The stored default has to name a tab the page actually has, or the state opens on one that is not
     there. Checked here rather than trusted, because the tab list is what just changed. */
  const defaultTab = db.whatif?.state_defaults?.tab
  if (lensDocument.tabs.length > 0 && defaultTab && !lensDocument.tabs.some((t) => t.key === defaultTab)) {
    problems.push(
      `whatif.state_defaults.tab is "${defaultTab}", which ${file} does not declare ` +
        `(${lensDocument.tabs.map((t) => t.key).join(', ')})`,
    )
  }
}

if (problems.length > 0) {
  console.error('\ningest-capex-reports: refusing to write —')
  for (const p of problems) console.error('  · ' + p)
  console.error('\n  Nothing was written. Fix the lens document or its title stamp.\n')
  process.exit(1)
}

/*
 * `whatif` is spread, not replaced: the slices, levers, measures, publishing block and graph reference are
 * the package's own extract and none of it is this script's to rewrite. Only the pointer to the document
 * and the tab list it just read are set — a script that owns a subtree and rewrites its parent is how a
 * subtree gets deleted, which this repo has been bitten by twice.
 */
db.whatif = {
  ...db.whatif,
  document: lensDocument,
  copy: { ...db.whatif.copy, tabs: lensDocument.tabs },
}

/*
 * ---------------- a committed brief, so the shipped graph is reachable in Graph Studio ----------------
 *
 * **The dataset ships a whole graph and nothing that names it.** `graph_studio` carries 442 canvas
 * nodes, 908 edges, seven must-review rows, a pivot and five recorded sanity checks — and
 * `graph_use_cases` was empty. The studio lists *use cases committed on the last step*, so it listed
 * nothing: the canvas was unreachable, no build could be started, no version could be published.
 *
 * **Which made the publish gate unsatisfiable, and that is why this exists.** Reports and the What-if
 * lens open once a graph is published, on request. For a dataset with no brief to build, "publish first"
 * had no path at all — the sections could never open, so the gate would have read as a broken page
 * rather than as a precondition. This writes the missing row; it does not touch the gate.
 *
 * **It is derived from the dataset's own use-case template, never typed here.** That template *is* the
 * tenant's account of what this graph is for: it states the id, the name, the description, and the
 * personas, KPIs and hero questions by id. So the brief is the template resolved — the same members the
 * wizard's suggesters would have drafted from it, which is why each is recorded `source: 'ai'`. A name
 * or a business need written in this script would be a second answer to a question the package answers.
 */
const template = db.graph_use_case_templates ?? []
if (template.length !== 1) {
  /* One template is the dataset's own use case; two would make "which one is the brief" a guess, and
     zero leaves nothing to derive from — either way this must not invent one. */
  problems.push(
    `db.CAPEX.json declares ${template.length} use-case templates — the committed brief is derived from ` +
      'exactly one, so it cannot be built from this',
  )
}

let brief = null
if (template.length === 1) {
  const t = template[0]
  const byId = (list, key) => new Map((list ?? []).map((row) => [row[key], row]))
  const personaById = byId(db.graph_personas, 'persona_id')
  const kpiById = byId(db.graph_kpis, 'kpi_id')
  const questionById = byId(db.graph_hero_questions, 'question_id')

  /* An id that does not resolve would drop a member silently, and the brief would then claim fewer
     personas than the use case names — the same failure `validateDb` refuses for the template itself. */
  const resolve = (ids, map, what) =>
    (ids ?? []).map((id) => {
      const row = map.get(id)
      if (!row) problems.push(`use-case template names ${what} "${id}", which this dataset has no row for`)
      return row
    })

  const personas = resolve(t.personas, personaById, 'persona')
  const kpis = resolve(t.kpis, kpiById, 'KPI')
  const questions = resolve(t.hero_questions, questionById, 'hero question')

  /*
   * **The domain is derived from what the members themselves say, not chosen here.** Every persona, KPI
   * and hero question carries a `domains` array, so the brief's domain is the one its own members name
   * most — and a tie is refused rather than resolved by picking the first, for the reason a tie between
   * two use-case templates matches nothing: an even split means the data does not say.
   */
  const tally = new Map()
  for (const row of [...personas, ...kpis, ...questions]) {
    for (const d of row?.domains ?? []) tally.set(d, (tally.get(d) ?? 0) + 1)
  }
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1])
  const domainId = ranked.length > 0 ? ranked[0][0] : null
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) {
    problems.push(
      `the use case's members name "${ranked[0][0]}" and "${ranked[1][0]}" equally often, so which ` +
        'domain the brief is on is not derivable — the tie has to be broken in the package',
    )
  }
  if (domainId && !(db.graph_domains ?? []).some((d) => d.domain_id === domainId)) {
    problems.push(`the derived domain "${domainId}" is not one of this dataset's graph_domains`)
  }

  brief = {
    /* The id the package gives its own use case, so re-running this replaces the row rather than adding
       a second one, and a build's decisions — keyed `useCaseId:itemId` — keep pointing at the same brief. */
    use_case_id: t.use_case_id,
    name: t.name,
    /* Committed, which is what puts it in Graph Studio: the studio lists briefs finished on the last
       step, and a draft is deliberately absent from that list. */
    status: 'committed',
    domain_id: domainId,
    /* The package's own description of the use case, which is exactly what the business-need field is. */
    business_need: t.description,
    personas: personas
      .filter(Boolean)
      .map((p) => ({ name: p.name, description: p.focus, source: 'ai' })),
    kpis: kpis.filter(Boolean).map((k) => ({ name: k.name, description: k.definition, source: 'ai' })),
    /*
     * **No sources, and that is the honest value rather than a placeholder.** Step 4 picks from
     * *profiled* sources, and a registration lives in the server's memory and dies with the process —
     * so any source id written here would name something that does not exist until somebody connects it,
     * and `/graph-sources` would refuse it. Empty says "nothing picked yet", which is true of a brief
     * nobody has connected a source for.
     */
    sources: [],
    hero_questions: questions
      .filter(Boolean)
      .map((q) => ({ text: q.text, priority: q.priority ?? 'normal', source: 'ai' })),
    /* Nothing derived, so nothing to decide. The build gate reads the review queue and the pivot. */
    gap_decisions: [],
    /* The last step of the wizard. Written rather than imported — a script cannot load the server — so
       `check-docs` compares it to `WIZARD_STEPS.length`, the way it compares NAV_KEYS to nav.ts. */
    step: 6,
    /* The package's as-of date rather than "now", so re-running the ingest does not churn the file. */
    updated_at: `${db._meta?.as_of ?? '1970-01-01'}T00:00:00.000Z`,
  }

  if (!brief.name || !brief.business_need || !brief.domain_id) {
    problems.push('the derived brief has no name, business need or domain — Graph Studio would list a blank row')
  }
  if (brief.personas.length === 0 || brief.kpis.length === 0 || brief.hero_questions.length === 0) {
    problems.push('the derived brief resolved no personas, KPIs or hero questions — its members did not resolve')
  }
}

if (problems.length > 0) {
  console.error('\ningest-capex-reports: refusing to write —')
  for (const p of problems) console.error('  · ' + p)
  console.error('\n  Nothing was written. Fix the use-case template or its member ids.\n')
  process.exit(1)
}

/*
 * **Upserted, so a re-run replaces this row and leaves every other one alone.** Anything else in
 * `graph_use_cases` is somebody's own draft — this repo keeps a saved brief through a restart precisely
 * because it is the user's work — and a seed that rewrote the collection would delete it. Matched on the
 * id, which is the package's own and therefore stable across runs.
 */
db.graph_use_cases = [
  brief,
  ...(db.graph_use_cases ?? []).filter((u) => u.use_case_id !== brief.use_case_id),
]

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
    (authoring ? `\n  authoring: ${authoring}` : '\n  authoring: none found') +
    `\n  what-if:   ${lensDocument.stage.padEnd(9)} ${lensDocument.version.padEnd(4)} ${lensDocument.title} (${lensDocument.file})` +
    `\n  tabs:      ${lensDocument.tabs.map((t) => t.label).join(' · ')}`,
)
