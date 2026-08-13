/*
 * Ingest 07_reports into db.json's `reports`.
 *
 * Two files per report, and they answer two different questions:
 *
 *  - **`report_authoring_data.json`** is the data. The rosters every report reads
 *    (36 generators, 5 facilities, 14 quarters, 5 manifest traces), the field
 *    dictionary those rosters are keyed by, the assumptions a report is asked
 *    under, and the five `starters` — which are the report definitions: a
 *    question, a spine, and the blocks it renders.
 *  - **`Report_N_*.html`** is the package's rendered report. Its heading,
 *    subtitle, badge, lead note, summary tiles and footer are copy the tenant
 *    wrote about that specific report, and none of it is in the JSON. It is
 *    extracted here so the page prints served copy rather than a component's
 *    idea of what a compliance report says.
 *
 * The join between them is the starter's own `report_tag` ("Report 2" →
 * `Report_2_*.html`), so nothing is matched by position.
 *
 * **The authored tiles are checked against the roster.** A tile is a figure, and a
 * figure transcribed from a rendered page is exactly the kind of number that goes
 * quietly stale: "With enforcement history 15 of 36" is a claim about the 36 rows
 * in this file. Each is recomputed here and the script refuses to write if one
 * disagrees — which is what keeps the tiles authored rather than invented. The
 * same goes for every reference a block makes: a table column or a chart measure
 * naming a field the roster does not carry would render as an empty column, and an
 * empty column reads as "no data" rather than as a broken reference.
 *
 * Idempotent: run it again and it writes the same document.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'vls_demo_data_package_2026-08-10/07_reports'
const SRC = join(DIR, 'report_authoring_data.json')
const DB = 'mock-server/db.json'

const pkg = JSON.parse(readFileSync(SRC, 'utf8'))
const db = JSON.parse(readFileSync(DB, 'utf8'))

const note = (...a) => console.log(' ', ...a)
const problems = []
const fail = (msg) => problems.push(msg)

/* ---------------- 1. the rosters, and the fields they are keyed by ---------------- */

/*
 * A spine is which roster a report reads. It is named on the starter, so a spine
 * pointing at a roster that is not here would leave a report with no rows —
 * rendered as an empty table, which reads as "nothing to report".
 */
const DATA = {
  generators: pkg.generators,
  facilities: pkg.facilities,
  quarters: pkg.quarters,
  traces: pkg.traces,
}
for (const [key, rows] of Object.entries(DATA)) {
  if (!Array.isArray(rows) || rows.length === 0) fail(`the package ships no ${key} — a report on that spine would render empty`)
}

const fieldByKey = new Map(pkg.fields.map((f) => [f.key, f]))
/* The generator roster is the one the field dictionary describes; every field it
   declares as available has to be on the rows, or a column renders blank. */
const generatorKeys = new Set(Object.keys(pkg.generators[0] ?? {}))
for (const f of pkg.fields) {
  if (f.avail === false) continue
  if (!generatorKeys.has(f.key)) {
    fail(`field "${f.key}" is declared available but no generator carries it`)
  }
}
for (const g of pkg.generators) {
  for (const k of generatorKeys) {
    if (!(k in g)) fail(`generator "${g.generator}" is missing "${k}", which its siblings carry`)
  }
}
note(
  `${pkg.generators.length} generators · ${pkg.facilities.length} facilities · ` +
    `${pkg.quarters.length} quarters · ${pkg.traces.length} traces`,
)
const unavailable = pkg.fields.filter((f) => f.avail === false)
for (const f of unavailable) {
  /* An unavailable field says why on the page ("waste codes live on individual
     manifests"). Without the note it would read as a field the app forgot. */
  if (!f.note) fail(`field "${f.key}" is unavailable but does not say why`)
}
note(`${pkg.fields.length} fields · ${unavailable.length} unavailable in this dataset`)

/* ---------------- 2. the assumptions a report is read under ---------------- */

/*
 * The reading sentence is a template with slots ("Rank {scope} by {measure},
 * {horizon}"). A slot with no assumption behind it would print the brace, and a
 * scope the option list does not offer would be an assumption nobody chose.
 */
for (const [slot, chosen] of Object.entries(pkg.assumptions)) {
  const options = pkg.opts[slot]?.options ?? []
  if (!options.some((o) => o.value === chosen.value)) {
    fail(`assumption "${slot}" is "${chosen.value}", which is not one of its options`)
  }
  if (!chosen.label) fail(`assumption "${slot}" has no label, so the reading sentence would print a blank`)
}

/*
 * Which generators a report is about.
 *
 * Four of the five reports are read under the file's own default scope — every
 * inbound generator. The consent-decree report is not: its question *is* the
 * narrowing ("generators under a consent decree"), and its own tiles count 4
 * rather than 36. `opts.scope` already offers that scope as an option, so this
 * names the option rather than inventing a filter — and the check below refuses
 * to write unless the scope selects exactly what the report's tiles claim.
 */
const SCOPE = { risk: 'all', cd: 'cd', facility: 'all', quarterly: 'all', trace: 'all' }
const SCOPED = {
  all: (rows) => rows,
  cd: (rows) => rows.filter((r) => r.cd === true),
  enf: (rows) => rows.filter((r) => r.enf > 0),
  oos: (rows) => rows.filter((r) => r.state !== 'TX'),
}

/* ---------------- 3. the authored copy, from the rendered reports ---------------- */

const files = readdirSync(DIR).filter((f) => /^Report_\d+_.*\.html$/.test(f))
note(`${files.length} rendered reports in the package`)

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
  '&mdash;': '—',
  '&ndash;': '–',
}
/** Rendered HTML → the sentence a reader saw. Tags out, entities back. */
const text = (html) =>
  String(html ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? e)
    .replace(/\s+/g, ' ')
    .trim()

const one = (html, re) => {
  const m = html.match(re)
  return m ? text(m[1]) : null
}

/*
 * The HTML tone classes are the report's own reading of a figure — `good` on a $0
 * penalty record, `risk` on 15 generators with enforcement history. They map onto
 * this app's three status tones; `crit` rather than `risk` because that is what
 * `StatCards` and `STATUS` call it, and an unknown class stays neutral rather than
 * being coloured by guess.
 */
const TONE = { good: 'good', warn: 'warn', risk: 'crit' }

function copyFrom(file) {
  const html = readFileSync(join(DIR, file), 'utf8')
  const tiles = [...html.matchAll(
    /class="kpi([^"]*)"><div class="k">([\s\S]*?)<\/div><div class="v"[^>]*>([\s\S]*?)<\/div><div class="u">([\s\S]*?)<\/div>/g,
  )].map((m) => ({
    label: text(m[2]),
    value: text(m[3]),
    unit: text(m[4]),
    tone: TONE[m[1].trim()] ?? null,
  }))
  /*
   * The footer is a run of labelled segments — "Source. … Confidence. … Scope. …" —
   * and the labels differ per report ("Bridge.", "Why it matters."). Kept as pairs
   * rather than one string so the page can set the label apart without knowing
   * which labels a report chose.
   */
  const foot = html.match(/class="foot">([\s\S]*?)<\/div>/)
  const footer = foot
    ? [...foot[1].matchAll(/<b>([^<]+)<\/b>([^<]*)/g)].map((m) => ({
        label: text(m[1]).replace(/\.$/, ''),
        text: text(m[2]),
      }))
    : []

  return {
    heading: one(html, /<h1>([\s\S]*?)<\/h1>/),
    subtitle: one(html, /class="sub">([\s\S]*?)<\/div>/),
    badge: one(html, /class="badge">([\s\S]*?)<\/div>/),
    /* Only two reports carry a lead note, so its absence is normal — null, not ''. */
    note: one(html, /class="note">([\s\S]*?)<\/div>/),
    tiles,
    footer,
    source_file: file,
  }
}

/* ---------------- 4. each starter becomes a report ---------------- */

/*
 * The columns each rendered report's table actually shows.
 *
 * The starter's `cols` is the authoring tool's short list — six for the register — while the
 * package's own Report 2 prints ten: evaluations, inbound tonnage and manifest counts as well.
 * Transcribed here, in the rendered order, and every key checked against the field dictionary
 * below, so a table that looks like the report is not a table that invented a column. A
 * report with no entry keeps its starter's list.
 */
const TABLE_COLS = {
  risk: ['generator', 'state', 'risk', 'evals', 'viols', 'enf', 'penalty', 'tons', 'manifests', 'cd'],
  cd: ['generator', 'state', 'penalty', 'tons', 'manifests', 'cd'],
}

/*
 * A `kpis` block is dropped, deliberately.
 *
 * It names four measure keys, and the tiles the package actually rendered carry a
 * label, a unit and a tone that a key list cannot express ("With enforcement
 * history · 15 · of 36"). The tiles are therefore the report's, at report level,
 * and rendering the block as well would print the same four figures twice — two
 * truths about one summary, which is the failure this repo keeps guarding. The keys
 * are still checked before the block is dropped, so a broken reference is not
 * hidden by the drop.
 */
const KEPT_BLOCKS = new Set(['chart', 'table', 'facilities', 'quarterly', 'traces'])

const reports = []
for (const s of pkg.starters) {
  const n = /Report (\d+)/.exec(s.report_tag)?.[1]
  const matches = files.filter((f) => f.startsWith(`Report_${n}_`))
  if (matches.length !== 1) {
    fail(`starter "${s.id}" is tagged "${s.report_tag}", which matches ${matches.length} rendered reports`)
    continue
  }
  const copy = copyFrom(matches[0])
  for (const [key, value] of Object.entries(copy)) {
    if (key === 'note' || key === 'tiles' || key === 'footer') continue
    if (!value) fail(`${matches[0]} has no ${key} — the report page prints it`)
  }
  if (copy.tiles.length === 0) fail(`${matches[0]} has no summary tiles to extract`)
  if (copy.footer.length === 0) fail(`${matches[0]} has no footer — that is where a report states its source`)

  if (!(s.spine in DATA)) fail(`starter "${s.id}" reads spine "${s.spine}", which is not a roster in this package`)
  if (!(s.id in SCOPE)) fail(`starter "${s.id}" has no scope — add it to SCOPE in this script`)
  const scope = SCOPE[s.id] ?? 'all'
  if (!pkg.opts.scope.options.some((o) => o.value === scope)) {
    fail(`starter "${s.id}" is scoped "${scope}", which is not one of the scope options`)
  }

  /* Every reference a block makes, checked before it can render blank. */
  const blocks = []
  for (let b of s.blocks) {
    if (b.type === 'kpis') {
      for (const k of b.kpis) {
        if (k !== 'count' && !fieldByKey.has(k)) fail(`starter "${s.id}" summarises "${k}", which is not a field`)
      }
      continue
    }
    if (!KEPT_BLOCKS.has(b.type)) {
      fail(`starter "${s.id}" renders a "${b.type}" block, which no renderer knows`)
      continue
    }
    if (b.type === 'chart') {
      const f = fieldByKey.get(b.measure)
      if (!f) fail(`starter "${s.id}" charts "${b.measure}", which is not a field`)
      else if (f.kind !== 'num') fail(`starter "${s.id}" charts "${b.measure}", which is categorical`)
      else if (f.avail === false) fail(`starter "${s.id}" charts "${b.measure}", which is not in this dataset`)
    }
    if (b.type === 'table') {
      /* The rendered report's own column set, where it has one. */
      b = { ...b, cols: TABLE_COLS[s.id] ?? b.cols }
      for (const c of b.cols) {
        if (!fieldByKey.has(c)) fail(`starter "${s.id}" tabulates "${c}", which is not a field`)
        else if (!generatorKeys.has(c)) fail(`starter "${s.id}" tabulates "${c}", which no generator row carries`)
      }
    }
    if (b.type === 'quarterly' && !(b.metric in (pkg.quarters[0] ?? {}))) {
      fail(`starter "${s.id}" trends "${b.metric}", which no quarter carries`)
    }
    blocks.push(b)
  }
  if (blocks.length === 0) fail(`starter "${s.id}" has no renderable block, so its report would be tiles alone`)

  /* Every slot the reading sentence opens has to have an assumption to fill it. */
  for (const slot of s.reading.slots) {
    if (!(slot in pkg.assumptions)) fail(`starter "${s.id}" reads "{${slot}}", which is not an assumption`)
  }

  /*
   * The reading sentence's slots are filled from the report's *own* assumptions, so
   * the label is stored beside the value it labels. Reading `{scope}` off the file's
   * default would tell the consent-decree report it covers all 36 generators, one
   * line above its own tile counting 4.
   *
   * The measure is the one its chart ranks by, falling back to the file's default for
   * a report that charts nothing. Both come from the option lists rather than from a
   * label written here, so a renamed option renames the sentence.
   */
  const measure = s.blocks.find((b) => b.type === 'chart')?.measure ?? pkg.assumptions.measure.value
  const label = (slot, value) => pkg.opts[slot].options.find((o) => o.value === value)?.label ?? null
  const scopeLabel = label('scope', scope)
  const measureLabel = label('measure', measure)
  if (!scopeLabel) fail(`starter "${s.id}" is scoped "${scope}", which no scope option labels`)
  if (!measureLabel) fail(`starter "${s.id}" ranks by "${measure}", which no measure option labels`)

  /*
   * Which facility a scorecard is *about*. The roster is one operator plus four
   * comparators, and the report highlights its own row — "the clean $0-penalty record
   * is only legible next to what peers carry". Read off the role rather than the name,
   * and refused unless exactly one row is the operator: two subjects, or none, would
   * silently mark the wrong row or no row at all.
   */
  let subject = null
  if (s.spine === 'facilities') {
    const own = pkg.facilities.filter((f) => f.role.startsWith('VLS'))
    if (own.length !== 1) fail(`the facility roster has ${own.length} operator rows — a scorecard has one subject`)
    subject = own[0]?.facility ?? null
  }

  reports.push({
    report_id: s.id,
    report_tag: s.report_tag,
    subject,
    title: s.title,
    question: s.q,
    spine: s.spine,
    scope,
    scope_label: scopeLabel,
    measure,
    measure_label: measureLabel,
    reading: s.reading,
    blocks,
    ...copy,
  })
}

/* ---------------- 5. the authored tiles, against the roster ---------------- */

/*
 * Each entry is "this report's tile labelled X says Y", with Y recomputed from the
 * rosters above. A tile is the most quotable figure on a report and the least
 * likely to be re-derived by hand, so every one that *can* be checked is.
 *
 * The label is matched loosely (a substring) because it is the package's own
 * wording; the value is compared exactly, formatted the way the report formats it.
 */
const g = pkg.generators
const q = pkg.quarters
const money = (v) => `$${Math.round(v / 1000)}k`
const int = (v) => Math.round(v).toLocaleString('en-US')
const sum = (rows, key) => rows.reduce((t, r) => t + r[key], 0)
const vls = pkg.facilities.find((f) => f.role.startsWith('VLS'))

const TILE_CHECKS = {
  risk: [
    ['Distinct generators', int(g.length)],
    ['With enforcement history', int(SCOPED.enf(g).length)],
    ['Consent-decree generators', int(SCOPED.cd(g).length)],
  ],
  cd: [
    ['Document-named generators', int(SCOPED.cd(g).length)],
    ['Tonnage exposure', int(sum(SCOPED.cd(g), 'tons'))],
    ['Their combined penalty', money(sum(SCOPED.cd(g), 'penalty'))],
  ],
  quarterly: [
    ['Total inbound manifests', int(sum(q, 'manifests'))],
    ['Total tonnage', int(sum(q, 'tons'))],
    ['Avg per quarter', int(sum(q, 'tons') / q.length)],
    ['Rejections / residue', `${int(sum(q, 'rej'))} / ${int(sum(q, 'res'))}`],
  ],
  trace: [
    ['Sample manifests traced', int(pkg.traces.length)],
    ['Avg days in possession', (sum(pkg.traces, 'days') / pkg.traces.length).toFixed(1)],
    ['Rejected loads', int(sum(q, 'rej'))],
    ['Residue manifests', int(sum(q, 'res'))],
  ],
  facility: [
    ['RCRA evaluations', int(vls?.evals ?? -1)],
    ['Violations', int(vls?.viols ?? -1)],
    ['Own penalties', `$${vls?.penalty ?? -1}`],
  ],
}

let checked = 0
for (const [reportId, checks] of Object.entries(TILE_CHECKS)) {
  const report = reports.find((r) => r.report_id === reportId)
  if (!report) {
    fail(`no report "${reportId}" to check tiles against — the starter list changed`)
    continue
  }
  for (const [label, expected] of checks) {
    const tile = report.tiles.find((t) => t.label.toLowerCase().includes(label.toLowerCase()))
    if (!tile) {
      fail(`${report.source_file} has no tile labelled "${label}" — it was checked against the roster`)
      continue
    }
    if (tile.value !== expected) {
      fail(
        `${report.source_file}: tile "${tile.label}" reads "${tile.value}", but the roster computes ` +
          `"${expected}". Whichever is right, the report and its data must not disagree`,
      )
      continue
    }
    checked++
  }
}
note(`${checked} authored tiles agree with the roster`)

/*
 * The scoped report has to select what its own tiles count. Without this, changing
 * SCOPE above (or the roster's `cd` flags) would silently widen the consent-decree
 * report to all 36 generators while its tiles still said 4.
 */
for (const r of reports.filter((x) => x.scope !== 'all')) {
  const rows = SCOPED[r.scope](DATA[r.spine]).length
  if (!r.tiles.some((t) => t.value === int(rows))) {
    fail(
      `report "${r.report_id}" is scoped "${r.scope}" and selects ${rows} rows, which none of its ` +
        'tiles counts — the scope and the report disagree about what it is about',
    )
  }
}

/* ---------------- 6. the summary catalogue, re-expressed as data ----------------
 *
 * The authoring prototype holds its ten summary tiles as closures — a label, a tone
 * class and a function over the rows in view. A report *generated* under assumptions
 * other than the written ones cannot use the authored tiles (those were computed over
 * the full register), so it needs these; and a closure cannot be served.
 *
 * So they are re-expressed as data, exactly as the What-if package re-expressed its
 * own: each tile declares the field it reads and how it aggregates, and the server
 * implements the aggregations. The labels and the tones are the prototype's, not this
 * script's. `bad` becomes `crit` because that is what `STATUS` and `StatCards` call it.
 */
const SUMMARY_CATALOG = [
  { key: 'count', label: `${pkg.meta.entity_plural} in view`, tone: null, agg: 'rows', field: null, format: 'int' },
  { key: 'enf', label: 'under EPA enforcement', tone: 'warn', agg: 'count_positive', field: 'enf', format: 'int' },
  { key: 'penalty', label: 'total penalty exposure', tone: 'crit', agg: 'sum', field: 'penalty', format: 'money' },
  { key: 'cd', label: 'under a consent decree / CAFO', tone: 'crit', agg: 'count_true', field: 'cd', format: 'int' },
  { key: 'tons', label: 'total tons shipped to VLS', tone: null, agg: 'sum', field: 'tons', format: 'tons' },
  { key: 'manifests', label: 'manifests on file', tone: null, agg: 'sum', field: 'manifests', format: 'int' },
  { key: 'viols', label: 'open RCRA violations', tone: 'warn', agg: 'sum', field: 'viols', format: 'int' },
  { key: 'highrisk', label: 'high-risk generators', tone: 'crit', agg: 'count_high', field: 'risk', format: 'int' },
  { key: 'oos', label: 'out-of-state generators', tone: null, agg: 'count_out_of_state', field: 'state', format: 'int' },
  { key: 'evals', label: 'RCRA evaluations on record', tone: null, agg: 'sum', field: 'evals', format: 'int' },
]
/* The aggregations the server implements. One named here that it does not would render
   as a blank tile, and a blank tile beside four figures reads as a zero. */
const KNOWN_AGGS = new Set(['rows', 'sum', 'count_positive', 'count_true', 'count_high', 'count_out_of_state'])
const KNOWN_FORMATS = new Set(['int', 'money', 'tons'])
for (const tile of SUMMARY_CATALOG) {
  if (!KNOWN_AGGS.has(tile.agg)) fail(`summary tile "${tile.key}" aggregates by "${tile.agg}", which the server does not implement`)
  if (!KNOWN_FORMATS.has(tile.format)) fail(`summary tile "${tile.key}" wants format "${tile.format}", which the server does not implement`)
  if (tile.field !== null && !generatorKeys.has(tile.field)) {
    fail(`summary tile "${tile.key}" reads "${tile.field}", which no generator carries`)
  }
}
const SUMMARY_DEFAULT = ['count', 'enf', 'penalty', 'cd']
const catalogKeys = new Set(SUMMARY_CATALOG.map((t) => t.key))
for (const key of SUMMARY_DEFAULT) {
  if (!catalogKeys.has(key)) fail(`the default summary names "${key}", which is not a tile`)
}
/* Each report's own summary, from the `kpis` block dropped above. Kept because a
   *generated* report needs to recompute the summary its written twin states. */
for (const r of reports) {
  const starter = pkg.starters.find((s) => s.id === r.report_id)
  const keys = starter?.blocks.find((b) => b.type === 'kpis')?.kpis ?? []
  for (const key of keys) {
    if (!catalogKeys.has(key)) fail(`report "${r.report_id}" summarises "${key}", which is not a summary tile`)
  }
  r.summary_keys = keys
}
note(`${SUMMARY_CATALOG.length} summary tiles · default ${SUMMARY_DEFAULT.join(', ')}`)

/* ---------------- 7. refuse, or write ---------------- */

if (problems.length > 0) {
  console.error(`\ningest-reports: ${problems.length} problem(s):`)
  for (const p of problems) console.error(`  - ${p}`)
  console.error(
    '\nEach of these renders as an answer: an empty column, a tile that no longer matches\n' +
      'its own roster, a report scoped to more rows than it claims. Fix the package or this\n' +
      'script rather than the symptom.',
  )
  process.exit(1)
}

db.reports = {
  /* `meta` here is the tenant's persona and provenance line — the page prints both —
     unlike the What-if package's `meta`, which described its own extraction. */
  meta: pkg.meta,
  fields: pkg.fields,
  assumptions: pkg.assumptions,
  /* The authoring wizard's three questions and their options, and the facets a
     generator report can be sliced by. Served, because the wizard prints them. */
  opts: pkg.opts,
  slice_default: pkg.slice_default,
  summary_catalog: SUMMARY_CATALOG,
  summary_default: SUMMARY_DEFAULT,
  data: DATA,
  reports,
  /*
   * The saved library is the user's work, not the package's, so a re-ingest carries it
   * forward rather than resetting it — the same asymmetry as `graph_use_cases`, which
   * survives a restart while a registered source does not. Overwriting it here would
   * silently delete saved questions on the next `npm run ingest:reports`.
   */
  saved: db.reports?.saved ?? [],
  /*
   * **Nothing under `db.reports` that this script does not author may be dropped here**, and
   * `db.reports = { … }` drops everything not listed. Two keys are not the package's:
   *
   * - `governance` — the lifecycle states, the audiences and the data scopes, authored by
   *   `node scripts/seed-report-governance.mjs`. It was added after this script and was not
   *   carried, so a re-ingest deleted it and the server then refused to boot naming `reports`.
   *   Loud rather than silent, which is the only reason it was survivable.
   * - `access_requests` — readers asking for a report they are not entitled to. Losing these is
   *   worse than loud: every row reads "no request made" and whoever asked waits on nothing.
   *
   * `??` and not `||`: an empty request list is a fact, not a missing one.
   */
  governance: db.reports?.governance,
  access_requests: db.reports?.access_requests ?? [],
}

/* Which is not a comment's job to enforce. A re-ingest that would drop governance stops here. */
if (!db.reports.governance) {
  console.error(
    'ingest-reports: refusing to write — db.reports.governance is missing, so this ingest would\n' +
      '  leave the section ungoverned and the server unable to boot. Seed it first:\n' +
      '      node scripts/seed-report-governance.mjs',
  )
  process.exit(1)
}

writeFileSync(DB, `${JSON.stringify(db, null, 2)}\n`, 'utf8')
note(`wrote db.reports · ${reports.length} reports · ${reports.reduce((t, r) => t + r.blocks.length, 0)} blocks`)
console.log('ok')
