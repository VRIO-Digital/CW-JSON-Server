/*
 * Rebuilds `db.reports.reports` from the CAPEX reports package in `src/report/`.
 *
 *     npm run ingest:capex-reports
 *
 * **What this package is, and why the reports arrive already resolved.** `report_specs.json` holds
 * the three report *definitions* — a spec names measures, coordinates, grains and filters and carries
 * no figures at all. `report_resolved.json` is what the product's own resolver returned when it ran
 * those specs at scope class `sc_author_all`, and its note says exactly what it is for: *"the JSON a
 * React frontend renders directly: each block already carries its figures, its coordinate statement,
 * its coverage seam and its refusal text."*
 *
 * **So these reports are `written`, in the vocabulary this section already has, and they cannot be
 * re-asked.** EPA's reports are a question this server answers per request — `reportView` computes
 * every figure from `db.reports.data`, which is why filtering recomputes the chart, the table and the
 * tiles together. Northline's figures come from a resolver that is not in this app: they carry
 * coordinates (basis × period frame × vintage), closure assertions, coverage seams and per-figure
 * provenance ids, and re-deriving them from the register would be reimplementing that resolver from
 * its output. Serving them as the tenant's own resolved reports is honest; recomputing a subset and
 * presenting it as the same report would not be. The server therefore marks them `written`, offers no
 * `generated` variant for them, and says so where a reader can see it.
 *
 * **Every figure is the package's. Nothing here computes one.** The tiles are lifted from the report's
 * own leading `figRow` block rather than transcribed, so a tile and the block beneath it cannot come to
 * disagree — the failure `npm run ingest:reports` guards for EPA by recomputing 17 identities.
 *
 * **It carries the rest of `db.reports` forward rather than rebuilding it.** `governance`, `data`,
 * `register`, `fields`, `opts`, `assumptions`, `summary_catalog`, `saved` and `authoring_fixture` are
 * owned elsewhere — by `npm run seed:governance`, by `npm run adopt:capex`, by the Share dialog — and a
 * script that owns a subtree and rewrites its parent is how a subtree gets deleted. `ingest-reports.mjs`
 * nearly dropped `governance` that exact way. The carry-forward list is derived from what
 * `validateDb` requires rather than remembered, and the script refuses to write a document that would
 * not boot.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const PKG = new URL('../src/report/', import.meta.url)
const DB = new URL('../mock-server/db.json', import.meta.url)

const problems = []
const notes = []

const read = (name) => {
  const at = new URL(name, PKG)
  if (!existsSync(at)) {
    console.error(`\ningest:capex-reports — src/report/${name} is not in this checkout.\n`)
    process.exit(1)
  }
  return JSON.parse(readFileSync(at, 'utf8'))
}

const resolved = read('report_resolved.json')
const specs = read('report_specs.json')
const authoring = read('report_authoring_data.json')
/*
 * The measure dictionary, so a report's headline measure gets the tenant's own label.
 *
 * A resolved report's `measures` is a list of **ids** (`["m_plan_period", "m_actual", …]`), not
 * objects — reading `measures[0].id` off it gave `undefined`, and the frame then carried a null
 * measure that the client refused at the boundary. The label lives in `report_data.json`, which is
 * the one place it is written.
 */
const measureDict = read('report_data.json').measures ?? {}
const db = JSON.parse(readFileSync(DB, 'utf8'))

/* ------------------------------------------------------------------ the reports */

const specById = new Map(specs.reports.map((r) => [r.id, r]))

/**
 * A report's four headline tiles, taken from its own leading `figRow`.
 *
 * **Lifted, never transcribed.** The tiles and the figures in the block are the same numbers, and
 * this section's whole history is figures going stale because they were written down twice — EPA's
 * ingest recomputes 17 of them against the roster for that reason. Here there is no roster to
 * recompute against, so the stronger guarantee is available instead: there is only one copy, and the
 * tile strip *is* the block.
 *
 * `display` is the package's own short form (`$5.00B`) and `exact` its full one, so a reader can see
 * the rounding rather than infer it. The tone comes from the figure's own sign where the figure says
 * it is signed — an unsigned magnitude has no good or bad direction and takes none.
 */
function tilesFrom(report) {
  const figRow = report.blocks.find((b) => b.type === 'figRow')
  if (!figRow) return []
  return figRow.figures.map((f) => ({
    label: f.label,
    value: f.display,
    unit: f.coordStated ?? null,
    tone: f.signed && typeof f.raw === 'number' ? (f.raw < 0 ? 'crit' : 'good') : null,
    exact: f.exact ?? null,
    measure: f.measure ?? null,
  }))
}

/**
 * The footer: what the report was read under, in the package's own words.
 *
 * The as-of line is the one figure on a report that is *about the report* rather than about the
 * programme, and it is the stalest contributing dataset rather than the freshest — the package
 * computes that and says so, so it is quoted rather than re-derived.
 */
function footerFrom(report) {
  const rows = []
  if (report.asOf?.note) rows.push({ label: 'As of', text: report.asOf.note })
  if (report.binding) {
    rows.push({
      label: 'Bound to',
      text:
        `${report.binding.graph} ${report.binding.graphVersion} · pack ${report.binding.pack} ` +
        `${report.binding.packVersion}` +
        (report.binding.overlay ? ` · overlay ${report.binding.overlay} ${report.binding.overlayVersion}` : ''),
    })
  }
  for (const caveat of report.caveats ?? []) {
    rows.push({ label: caveat.label ?? 'Caveat', text: caveat.text ?? String(caveat) })
  }
  if (report.watermark) rows.push({ label: 'Served', text: report.watermark })
  return rows
}

const built = []
for (const [id, report] of Object.entries(resolved.reports)) {
  const spec = specById.get(id)
  if (!spec) {
    problems.push(`resolved report "${id}" has no spec in report_specs.json — its definition is unknown`)
    continue
  }
  if (!Array.isArray(report.blocks) || report.blocks.length === 0) {
    problems.push(`resolved report "${id}" carries no blocks, so it would render as a heading over nothing`)
    continue
  }

  /*
   * The measure a report leads with — the first in its own list, which is the order the resolver
   * emitted and the order the report's blocks read them in. `rep_proj_360` is a single project's
   * page rather than a ranking, so a report with none is legitimate and stays null.
   */
  const headline = Array.isArray(report.measures) ? report.measures[0] : null
  if (headline && !measureDict[headline]) {
    problems.push(
      `report "${id}" leads with measure "${headline}", which report_data.json does not define — ` +
        'its label would fall back to the raw id on the read-back sentence',
    )
  }

  const tiles = tilesFrom(report)
  if (tiles.length === 0) {
    problems.push(`resolved report "${id}" has no figRow, so it has no headline figures to state`)
  }
  const footer = footerFrom(report)
  if (footer.length === 0) {
    problems.push(`resolved report "${id}" states nothing about how it was read — no as-of, binding or caveats`)
  }

  built.push({
    report_id: id,
    report_tag: spec.slug ?? id,
    subject: report.grain ?? spec.grain ?? null,
    title: report.name,
    question: report.objective ?? null,
    /* Every one of these is asked of the project register — the spine `validateDb` checks. */
    spine: 'projects',
    scope: report.scope?.id ?? 'sc_author_all',
    scope_label: report.scope?.label ?? 'Author -- all data',
    measure: headline ?? null,
    measure_label: headline ? (measureDict[headline]?.label ?? headline) : null,

    /*
     * **The read-back sentence, and it is `{ template, slots }` rather than a sentence.**
     *
     * `reportReading` walks `reading.slots` and substitutes each one from the report's own labels, so
     * the sentence the authoring step shows and the chips beneath it are filled from one place and
     * cannot disagree. Writing the objective here as a plain string made `report.reading.slots`
     * undefined and `reportView` threw `Cannot read properties of undefined (reading 'map')` — a 500
     * on every report, reported by the client as the report failing to load.
     *
     * The template is the report's own objective with the scope named, because that is what a
     * Northline report is read under: its scope is `sc_author_all` and the resolver already applied
     * it. `{measure}` is included only where the report states one — `rep_proj_360` is a single
     * project's page and names no ranking measure, and a sentence with an empty slot in it reads as a
     * template that failed to fill.
     */
    reading: {
      template: headline
        ? `${report.objective ?? report.name} Read over {scope}, by {measure}.`
        : `${report.objective ?? report.name} Read over {scope}.`,
      slots: headline ? ['scope', 'measure'] : ['scope'],
    },

    /* The resolved blocks, verbatim. This is the package's own output and the renderers' input. */
    blocks: report.blocks,

    heading: report.name,
    subtitle: report.subtitle ?? null,
    badge: report.category ?? null,
    note: report.objective ?? null,
    tiles,
    footer,
    source_file: `src/report/report_resolved.json#${id}`,
    summary_keys: [],

    /*
     * What the resolver stated about this run, carried so the page can say it rather than imply it:
     * who it was served to, how many rows it admitted of how many, and the version it is.
     */
    resolved: {
      version: report.version ?? null,
      status: report.status ?? null,
      persona: report.personaLabel ?? null,
      rows_served: report.rowsServed ?? null,
      rows_total: report.rowsTotal ?? null,
      rows_note: report.rowsServedNote ?? null,
      blocks_served: report.blocksServed ?? null,
      blocks_total: report.blocksTotal ?? null,
      as_of: report.asOf?.display ?? null,
      as_of_line: report.asOf?.line ?? null,
      watermark: report.watermark ?? null,
      export_formats: report.exportFormats ?? [],
      empty: Boolean(report.empty),
      empty_cause: report.emptyCause ?? null,
    },
  })
}

/* Every block kind the renderers have to handle, reported so a new one is never a surprise. */
const kinds = [...new Set(built.flatMap((r) => r.blocks.map((b) => b.type)))].sort()

/* ------------------------------------------------------------------ checks */

if (built.length === 0) problems.push('no report resolved — db.reports.reports would be empty')

const spine = db.reports?.data?.projects
if (!Array.isArray(spine) || spine.length === 0) {
  problems.push('db.reports.data.projects is missing — every report reads it as its spine')
}

/*
 * The keys this script does **not** own. Derived from what is already in the document rather than
 * listed here, so a key added by another seed cannot be forgotten by this one — the failure that
 * nearly deleted `governance`.
 */
const owned = new Set(['reports'])
const carried = Object.keys(db.reports ?? {}).filter((k) => !owned.has(k))
for (const key of ['data', 'fields', 'governance', 'register', 'opts', 'assumptions', 'summary_catalog']) {
  if (!carried.includes(key)) {
    problems.push(`db.reports.${key} is missing before this ingest runs — refusing to write a document without it`)
  }
}

if (problems.length > 0) {
  console.error('\ningest:capex-reports — refusing to write mock-server/db.json.\n')
  for (const p of problems) console.error(`  · ${p}`)
  console.error('')
  process.exit(1)
}

/* ------------------------------------------------------------------ write */

/* ------------------------------------------------------------------ the rendered report */

/*
 * **The tenant's own rendered reports, published once as a single page the Library can open.**
 *
 * The package ships three: `R1_variance_report.html`, `R2_project_360.html` and
 * `R3_rate_case_filing_calendar.html`. They are **not three reports** — normalise the one `REPORT_ID`
 * variable in each and all three hash identically. They are one 2.4 MB prototype, three times, each
 * copy pinned to a different report.
 *
 * So one copy is written and the id comes from the URL instead. That is a change to vendored code, so
 * it is exactly one line and it is *checked*: the three sources are compared with the id normalised
 * away, and a difference anywhere else refuses the write — because then one file would not be
 * equivalent to three and shipping one would silently drop whatever else they disagreed about.
 *
 * **Copied into `public/` because that is what a browser can fetch.** `src/` is compiled, not served;
 * `public/report/` is the same route `/login/data` already uses to frame a document. And it is copied
 * by this ingest rather than checked in twice, so the package folder stays the one source.
 *
 * **The href is served, never built in the client.** `GovernedCard` opens whatever the row carries, so
 * a report with no rendered file offers the in-app render instead — the same rule as every other pool
 * in this app: a list held in a component can offer a value the server has nothing behind.
 */
const RENDERED_SOURCES = {
  rep_q_variance: 'R1_variance_report.html',
  rep_proj_360: 'R2_project_360.html',
  rep_pis_calendar: 'R3_rate_case_filing_calendar.html',
}
const RENDERED_DIR = new URL('../public/report/', import.meta.url)
const RENDERED_FILE = 'capex-report.html'

/* One line, so the pinned id becomes a URL parameter. Written as a replacement of the exact literal
   each source carries, so a package revision that renames the variable refuses rather than ships a
   page that always opens on the same report. */
const idLine = (id) => `var REPORT_ID = "${id}";`
const PARAMETERISED =
  'var REPORT_ID = new URLSearchParams(location.search).get("report") || "rep_q_variance";'

let renderedHref = {}
{
  const normalised = new Map()
  for (const [id, file] of Object.entries(RENDERED_SOURCES)) {
    const at = new URL(file, PKG)
    if (!existsSync(at)) {
      problems.push(`src/report/${file} is missing — "${id}" would have no rendered report to open`)
      continue
    }
    const html = readFileSync(at, 'utf8')
    if (!html.includes(idLine(id))) {
      problems.push(
        `src/report/${file} does not pin REPORT_ID to "${id}" — the one line this ingest ` +
          'parameterises has moved, so it cannot be served as a single page',
      )
      continue
    }
    normalised.set(id, html.replace(idLine(id), PARAMETERISED))
  }

  const bodies = [...new Set(normalised.values())]
  if (normalised.size > 0 && bodies.length !== 1) {
    problems.push(
      `the ${normalised.size} rendered reports differ somewhere other than REPORT_ID, so one page ` +
        'cannot stand for all of them — ship them separately or find the second difference',
    )
  } else if (bodies.length === 1) {
    mkdirSync(RENDERED_DIR, { recursive: true })
    writeFileSync(new URL(RENDERED_FILE, RENDERED_DIR), bodies[0])
    renderedHref = Object.fromEntries(
      [...normalised.keys()].map((id) => [id, `/report/${RENDERED_FILE}?report=${id}`]),
    )
    notes.push(
      `public/report/${RENDERED_FILE}: one page for ${normalised.size} reports ` +
        `(${(bodies[0].length / 1024 / 1024).toFixed(2)} MB; the sources are identical but for REPORT_ID, ` +
        'which now comes from the URL)',
    )
  }
}

/* ------------------------------------------------------------------ the authoring dataset */

/*
 * **The authoring flow's own dataset, built from the package's authoring screen.**
 *
 * `report_authoring_simplified_v3.html` is the CAPEX counterpart of the vendored EPA prototype — the
 * same three steps (Ask → Confirm → Report), the same three block kinds (`kpis`, `chart`, `table`),
 * and a different vocabulary: `auth`/`comm`/`proj`/`varD` where EPA has `penalty`/`tons`/`viols`.
 * `report_authoring_data.json` is that screen's data, and this turns it into the dataset the flow
 * hydrates from — so the Author tab composes a report about **capital projects** instead of about
 * inbound generators, which is what it was doing while the dataset was EPA's.
 *
 * **Nothing is derived here at runtime, because the package already derived it.** `fixture.derived`
 * holds each project's variance, variance %, percent-of-envelope and delivery status, and
 * `fixture.derivationRules` states how each was reached. The rows are *materialised* — every field in
 * the catalogue becomes a real key — so the flow reads fields and computes nothing, which is the rule
 * this repo keeps everywhere: a component that recomputed a figure would be a second answer to it.
 *
 * **What is authored here, and why it has to be.** The screen's own `fmt()` decides that `auth` prints
 * as money and `varP` as a signed percent; the field catalogue records `kind: 'num'` for both and
 * cannot tell them apart. So `formats` states it per field, transcribed from that function, and
 * `kpis` states the four tiles its `kpisHTML()` builds. Both are declarations *of the screen's own
 * behaviour* rather than inventions — and putting them in the dataset is what lets one flow serve
 * either tenant instead of one tenant's vocabulary being compiled in.
 */
{
  const a = authoring
  const fixture = a.fixture ?? {}
  const catalog = a.fieldCatalog ?? {}
  const unit = fixture.unit ?? ''

  /*
   * One row per sample project, with the derived columns folded in.
   *
   * `fac` is `proj` because the package says so in as many words ("equals projected in this
   * fixture"); it is read from the rule rather than assumed, so a fixture that starts carrying a real
   * forecast refuses instead of quietly showing the projection under its name.
   */
  const facRule = String(fixture.derivationRules?.forecastAtCompletion ?? '')
  if (!/equals projected/i.test(facRule)) {
    problems.push(
      `report_authoring_data.json no longer says forecastAtCompletion equals projected ` +
        `("${facRule}") — the fixture now derives it some other way and this mapping must follow`,
    )
  }

  const rows = (fixture.projects ?? []).map((proj) => {
    const derived = fixture.derived?.[proj.name] ?? {}
    return {
      ...proj,
      fac: proj.proj,
      varD: derived.varianceDollarsM,
      varP: derived.variancePct,
      pct: derived.pctOfEnvelopeSpent,
      status: derived.status,
    }
  })

  /* Every available field must be a real key on every row, or a column renders blank. */
  const available = (catalog.fields ?? []).filter((f) => f.avail !== false)
  for (const f of available) {
    const missing = rows.filter((r) => r[f.key] === undefined)
    if (missing.length > 0) {
      problems.push(
        `the authoring fixture carries no "${f.key}" on ${missing.length} of ${rows.length} rows, ` +
          'so that column would render blank',
      )
    }
  }

  /* Transcribed from the screen's own `fmt()`; `kind` cannot distinguish money from a percentage. */
  const FORMATS = {
    auth: 'moneyM',
    comm: 'moneyM',
    proj: 'moneyM',
    fac: 'moneyM',
    varD: 'signedMoneyM',
    varP: 'signedPercent',
    pct: 'percent',
  }

  /* The four tiles its `kpisHTML()` builds, expressed as data rather than as a closure. */
  const KPIS = [
    {
      key: 'over',
      label: 'projects over envelope',
      agg: 'count_over',
      field: 'proj',
      against: 'auth',
      format: 'int',
      tone: 'bad',
    },
    {
      key: 'overrun',
      label: 'total projected overrun',
      agg: 'sum_over',
      field: 'proj',
      against: 'auth',
      format: 'moneyM',
      tone: 'bad',
    },
    {
      key: 'largest',
      label: 'largest single overrun',
      agg: 'max_over',
      field: 'proj',
      against: 'auth',
      format: 'moneyM',
      tone: 'warn',
    },
    { key: 'count', label: 'projects in view', agg: 'rows', field: null, format: 'int', tone: null },
  ]

  /* A starter per governed report: its own question and the screen's own default blocks. */
  const starters = built.map((r) => ({
    id: r.report_id,
    label: r.heading,
    report_tag: r.report_tag,
    q: r.question ?? r.heading,
    spine: 'register',
    title: r.heading,
    reading: r.reading,
    blocks: a.blocks?.default ?? [],
  }))

  /* The audiences are the categories the tenant's own definitions carry. */
  const audiences = [...new Set(built.map((r) => r.badge).filter(Boolean))].map((c) => ({
    key: String(c).toLowerCase(),
    label: String(c),
    d: `${built.filter((r) => r.badge === c).length} definition(s) in this category`,
  }))

  const graphSlot = {
    value: 'g_capital_programs',
    label: 'the Capital Programme Intelligence graph',
  }

  db.reports_prototype = {
    meta: db.reports?.meta ?? {},
    assumptions: { graph: graphSlot, ...(a.assumptions?.current ?? {}) },
    opts: {
      graph: { q: 'Which published graph?', options: [{ ...graphSlot, d: 'The tenant\'s built graph' }] },
      ...(a.assumptions?.options ?? {}),
    },
    fields: catalog.fields ?? [],
    /* Which field names a row — the label on a bar, the first column of a table. */
    label_field: 'name',
    unit,
    formats: FORMATS,
    kpis: KPIS,
    /* A chart may plot any available numeric field. Derived from the catalogue, not listed twice. */
    measures: available.filter((f) => f.kind === 'num').map((f) => f.key),
    filter_values: catalog.filterValues ?? {},
    register: rows,
    starters,
    presets: (a.blocks?.presets ?? []).map((pr) => ({
      label: pr.label,
      d: pr.description ?? pr.d ?? '',
      block: pr.block,
    })),
    slice_default: a.blocks?.sliceChips ?? [],
    audiences,
    /*
     * Empty, and that is a decision. The prototype's four seeded rows are its own fiction — other
     * people's reports with bylines nobody here has — and hosted the shelf already starts empty for
     * exactly that reason. Inventing Northline bylines to fill it would be worse.
     */
    library: [],
  }

  notes.push(
    `reports_prototype: rebuilt from report_authoring_data.json — ${rows.length} sample projects, ` +
      `${(catalog.fields ?? []).length} fields, ${starters.length} starters, ${KPIS.length} tiles`,
  )
}

/* ------------------------------------------------------------------ the prototype's persona */

/*
 * **The authoring prototype speaks in the tenant's nouns, or it speaks in the wrong tenant's.**
 *
 * `db.reports_prototype` is the vendored prototype's own sample dataset, and its `meta` came across
 * with EPA's document: persona *Ana Delgado, EHS Compliance Lead · VLS Deer Park*, entity plural
 * *"inbound generators"*. The Ask pane prints that plural in its own sentence — *"nothing runs against
 * your inbound generators"* — so a Northline console asked about a hazardous-waste corpus that is not
 * there.
 *
 * The tenant's answer to the same question is already in the document: `db.reports.meta` is the report
 * section's own persona and vocabulary. Copied rather than re-authored, so there is one place the
 * tenant's noun lives; `persona_initials` is derived from the name for the same reason the sidebar
 * avatar derives initials from an email — the field is not stated and inventing one is not needed.
 *
 * **Only `meta` is replaced.** The prototype's other collections describe its own EPA sample and its
 * panes read them field by field (`generators[].risk`, `.cd`, `penalty`); swapping the rows without
 * rewriting the prototype would fail its own validator. That is why the *starters* are hidden when
 * hosted rather than replaced — see the note in `AskPane`.
 */
const tenantMeta = db.reports?.meta
if (tenantMeta && db.reports_prototype?.meta) {
  const initials = String(tenantMeta.persona_name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2)
  db.reports_prototype = {
    ...db.reports_prototype,
    meta: {
      ...db.reports_prototype.meta,
      ...tenantMeta,
      persona_initials: initials || db.reports_prototype.meta.persona_initials,
    },
  }
  notes.push(
    `reports_prototype.meta: taken from the tenant's own reports.meta — ` +
      `"${tenantMeta.entity_plural}", ${tenantMeta.persona_name}`,
  )
}

/*
 * The rendered page is resolved after the reports are built — it needs the whole set to prove one
 * file stands for all of them — so the href is attached here rather than inside that loop.
 */
for (const r of built) r.rendered_href = renderedHref[r.report_id] ?? null

/* Spread, never rebuild: `reports` is one key of `db.reports`, which is one key of the document. */
db.reports = { ...db.reports, reports: built }
writeFileSync(DB, `${JSON.stringify(db, null, 2)}\n`)

console.log('\ningest:capex-reports — wrote db.reports.reports from src/report/report_resolved.json')
for (const r of built) {
  console.log(
    `  · ${r.report_id} — ${r.heading} · ${r.blocks.length} blocks · ${r.tiles.length} tiles · ` +
      `v${r.resolved.version} · ${r.resolved.rows_served} of ${r.resolved.rows_total} rows`,
  )
}
console.log(`  · ${kinds.length} block kinds to render: ${kinds.join(', ')}`)
console.log(`  · carried forward untouched: ${carried.join(', ')}`)
console.log(`  · the authoring fixture ships ${authoring.fixture?.projects?.length ?? 0} sample projects\n`)
