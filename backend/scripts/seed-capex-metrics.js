/**
 * Author CAPEX's metric pool from the tenant's measure sheet — `npm run seed:capex-metrics`.
 *
 * **The sheet is two columns, and that is the whole shape of a metric here.** Column 1 is the
 * measure's name as the finance team writes it (`Total_Anticipated_Cost`, `Overrun amount`);
 * column 2 is how it is calculated — a formula in their own notation, PowerBI DAX where the
 * measure needs it. Step 3 of the New Graph wizard renders exactly those two: the row's title and
 * the line beneath it. So `name` is column 1 and `definition` is column 2, verbatim, and nothing
 * here paraphrases either into a sentence: a formula rewritten into prose is a second answer to
 * how a measure is computed, and the reader cannot check it against the sheet any more.
 *
 * **It replaces the pool rather than adding beside it.** The 23 rows this supersedes are the demo
 * package's own generic capital measures (Approved Budget, Forecast, EAC Variance...); keeping
 * both would leave the suggester ranking 31 entries down to the four it drafts, so the measures
 * this tenant actually reports on might never surface — a change nobody can see on the screen it
 * was made for. The use-case template's `metrics` list is rewritten to the new ids in the same
 * write, because that list is ids into this pool and `validateDb` refuses a template naming a
 * metric the pool lacks. **Both halves or neither**: writing the pool and leaving the template
 * would stop the boot.
 *
 * **Everything except those two columns is derived, and three fields are deliberately not
 * written.** `metric_id` is the title slugified — one derivation, so the template's list is
 * computed from the same place rather than typed a second time — and `keywords` are the title's
 * own words, which is what the keyword ranker matches a brief against. `domains` is read off the
 * pool being replaced (all 23 carry `capital-projects`) rather than picked here, so this script
 * makes no claim about which domain a measure belongs to. `unit`, `source` and `glossary` are
 * *omitted*: the sheet states none of them, nothing in this repo reads them on a metric, and a
 * `source: 'ds_psoft_gl'` guessed from a formula naming PeopleSoft would be an invented claim
 * about which system feeds the measure.
 *
 * Writes a file and only a file, like every other seed here. Push it with
 * `npm run db:push -- CAPEX`.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { DATASETS } from '../datasets.js'

const TARGET = 'CAPEX'

const die = (message) => {
  console.error(`\nseed-capex-metrics: ${message}\n`)
  process.exit(1)
}

/*
 * CAPEX only, and refused by name rather than parameterised. These are one tenant's measures,
 * written in their own notation against their own EPBCS and PeopleSoft fields — writing them
 * under another dataset's prefix would describe measures that dataset has never reported.
 */
const requested = (process.argv[2] ?? TARGET).trim()
if (requested !== TARGET) {
  die(
    `this seed authors ${TARGET}'s metrics and nothing else — "${requested}" was asked for.\n` +
      "  These are one tenant's measures; another dataset needs its own sheet and its own script.",
  )
}
if (!DATASETS.includes(TARGET)) {
  die(
    `"${TARGET}" is not a declared dataset — this tenant has ${DATASETS.join(', ')}.\n` +
      '  Add it to DATASETS in backend/datasets.js first, with its MERGE_PLAN entries.',
  )
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

/* ---------------- the sheet ---------------- */

/**
 * The measure sheet, as it is: `[title, calculation]` per row, in the sheet's own order.
 *
 * Kept as a pair-array rather than as objects so that adding a row is transcribing a row, and so
 * that nothing about the shape of a metric can be typed differently on one line than another —
 * every other field below is derived from these two strings.
 *
 * **Two cells were truncated in the screenshot this was transcribed from**, both on the right
 * edge, and both are marked in the transcription rather than guessed at silently:
 *   - row 1's subtrahend reads `[Sum of FY2… YearTotal Actual]`; FY26 is the only reading
 *     consistent with the FY26 forecast it is subtracted from and the FY27–FY32 terms added to it.
 *   - row 8's `ExceptionCategories` list is cut after `"Plant roll-up"`. If the sheet names more
 *     categories, they belong in that brace list; re-run this script after adding them.
 */
const SHEET = [
  [
    'Total_Forecast_Remaining_Large_Proj',
    'Total_Forecast_Remaining_Large_Proj = [Sum of FY26 Working Forecast]-[Sum of FY26 ' +
      'YearTotal Actual]+[Sum of FY27 Working Budget]+[Sum of FY28 Working Budget]+[Sum of ' +
      'FY29 Working Budget]+[Sum of FY30 Working Budget]+[Sum of FY31 Working Budget]+[Sum of ' +
      'FY32 Working Budget]',
  ],
  [
    'Total_Anticipated_Cost',
    'Total_Anticipated_Cost = [Inception to Date (ITD) Actuals] + ' +
      '[Total_Forecast_Remaining_Large_Proj]',
  ],
  [
    'Budget_Consumed_to_Date',
    'Budget_Consumed_to_Date = [Inception to Date (ITD) Actuals] / [Most Recent Budget Plan in ' +
      'PeopleSoft (Value)]',
  ],
  [
    'Forecast Bud Consumed at Completion',
    'Forecast Bud Consumed at Completion = [Total_Anticipated_Cost] / [Most Recent Budget Plan ' +
      'in PeopleSoft (Value)]',
  ],
  [
    'Full Year Budget Variance',
    'Variance = [Forecast 6+6] - January_Calendarization Budget YTD',
  ],
  [
    'Year-to-Date (YTD) Budget Variance',
    'FY26 YearTotal Actual (Actual YTD) - FY26 January_Calendarization Budget YTD (Budget YTD)',
  ],
  [
    'Current Month Budget Variance',
    'Variance = Actual(Current Month) − Budget(Current Month)',
  ],
  [
    'Overrun amount',
    /*
     * The one multi-line cell. Its newlines are kept: DAX read as a single wrapped paragraph is
     * unreadable, and the wizard's suggestion row renders the description `pre-wrap` for exactly
     * this row's sake.
     */
    [
      'Overrun Amount =',
      'VAR ExceptionCategories =',
      '    { "Network blankets", "Lead Capex Budget Category", "Meter blankets", "Plant roll-up" }',
      'VAR ExceptionActuals =',
      '    CALCULATE (',
      "        SUM ( 'EPBCS_DATA_2'[FY26 YearTotal Actual] ),",
      "        KEEPFILTERS ( 'EPBCS_DATA_2'[Budget Category] IN ExceptionCategories )",
      '    )',
      'VAR StandardActuals =',
      '    CALCULATE (',
      "        SUM ( 'EPBCS_DATA_2'[Inception to Date (ITD) Actuals] ),",
      "        KEEPFILTERS ( NOT ( 'EPBCS_DATA_2'[Budget Category] IN ExceptionCategories ) )",
      '    )',
      'RETURN',
      '    ExceptionActuals + StandardActuals',
      "        - SUM ( 'EPBCS_DATA_2'[Most Recent Budget Plan in PeopleSoft (Value)] )",
    ].join('\n'),
  ],
]

/* ---------------- what is derived from it ---------------- */

const problems = []

/**
 * The title as an id: lowercase, every run of non-alphanumerics a single hyphen.
 *
 * One derivation, called both for the pool row and for the template's member list, because those
 * two are the same set of ids and typing them twice is how they come to disagree.
 */
const slug = (title) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/*
 * What the keyword ranker matches a brief against — the title's own words, so a brief mentioning
 * "overrun" drafts the overrun measure and says it matched on that word. Derived rather than
 * authored: a hand-written keyword list is a second description of the measure, and it goes stale
 * the first time a title is corrected.
 */
const STOPWORDS = new Set(['to', 'at', 'in', 'of', 'the', 'a', 'and', 'or', 'by'])
const keywordsFor = (title) => [
  ...new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 && !STOPWORDS.has(word)),
  ),
]

/*
 * The domains the pool being replaced **covered**, so this script states nothing of its own about
 * where a measure belongs — it keeps the reach the document already had.
 *
 * **The union, not the intersection, and that distinction was a real regression.** The first
 * version took every domain the *whole* pool shared, which for CAPEX collapsed 23 rows covering
 * `capital-projects` and `water-wastewater` down to `capital-projects` alone — so a brief on
 * water-wastewater, which used to draft two metrics, drafted **none**, and step 3 said "nothing
 * matched this brief". The suggester filters an entry out entirely when its domain does not match
 * and nothing in the brief hits its keywords, so narrowing the pool's reach does not make a
 * suggestion weaker, it deletes it. Replacing a pool must not shrink the set of domains the wizard
 * can draft anything on.
 *
 * Offering a measure on a domain it is a poor fit for costs a suggestion somebody dismisses;
 * withholding it costs a step that can draft nothing. Only the second reads as a broken wizard.
 */
const existing = Array.isArray(doc.graph_metrics) ? doc.graph_metrics : []
const domains = [...new Set(existing.flatMap((metric) => metric.domains ?? []))]

if (existing.length === 0) {
  problems.push(
    `backend/${name} carries no graph_metrics to read the domains off — this seed keeps the ` +
      'reach the pool already had rather than choosing one, so it cannot run against an empty pool',
  )
} else if (domains.length === 0) {
  problems.push(
    `the ${existing.length} metrics in backend/${name} name no domain at all, so "where do these ` +
      'measures get drafted" is not derivable from the pool — the answer has to be settled in the ' +
      'document first',
  )
}
for (const domain of domains) {
  if (!(doc.graph_domains ?? []).some((d) => d.domain_id === domain)) {
    problems.push(`the pool's domain "${domain}" is not one of this dataset's graph_domains`)
  }
}

const metrics = []
const seen = new Map()
for (const [title, calculation] of SHEET) {
  const metricId = slug(title)
  if (!title.trim()) problems.push('a sheet row has no title in column 1')
  if (!calculation.trim()) problems.push(`"${title}" has nothing in column 2`)
  if (!metricId) problems.push(`"${title}" slugifies to an empty id`)
  if (seen.has(metricId)) {
    /* Two titles landing on one id would silently drop a measure: the pool would carry seven rows
       for eight sheet lines, and a short list reads as an answer. */
    problems.push(
      `"${title}" and "${seen.get(metricId)}" both slugify to "${metricId}" — one of them would ` +
        'replace the other in the pool',
    )
  }
  seen.set(metricId, title)
  metrics.push({
    metric_id: metricId,
    /* Column 1, verbatim. */
    name: title,
    domains,
    keywords: keywordsFor(title),
    /* Column 2, verbatim — the calculation as the sheet states it, never paraphrased. */
    definition: calculation,
  })
}

/*
 * The template's member list is ids into the pool above. `validateDb` refuses a template naming a
 * metric the pool lacks — and `check-docs` asserts the same thing before a server is ever started
 * — so the two are rewritten in one act rather than left for a second command.
 */
const templates = (doc.graph_use_case_templates ?? []).map((template) => ({
  ...template,
  metrics: metrics.map((m) => m.metric_id),
}))
if (templates.length === 0) {
  problems.push(
    `backend/${name} declares no use-case template — the committed brief that makes this ` +
      "dataset's graph reachable is derived from one, so replacing the pool with no template to " +
      'point at it would leave the measures unreferenced',
  )
}

if (problems.length > 0) {
  die(
    `refusing to write backend/${name}:\n${problems.map((p) => `    - ${p}`).join('\n')}`,
  )
}

doc.graph_metrics = metrics
doc.graph_use_case_templates = templates

await writeFile(path, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')

console.log(
  `seed-capex-metrics: wrote ${metrics.length} metric(s) to backend/${name}, replacing ` +
    `${existing.length}, on domain ${domains.join(', ')}.`,
)
for (const metric of metrics) {
  console.log(`    ${metric.metric_id.padEnd(38)} ${metric.name}`)
}
console.log(
  `  Repointed ${templates.length} use-case template(s) at the new ids.\n` +
    '  A committed brief carries copies rather than ids, so re-run the ingest if you want this ' +
    "dataset's own brief rebuilt from them:\n" +
    '      npm run ingest:capex\n' +
    `  Push it when you are happy with the diff:  npm run db:push -- ${TARGET}`,
)
