/**
 * Brings the CAPEX report documents' capital figures inside the range this demo is meant to show.
 *
 * **Why this script exists at all.** Each of the three rendered reports carries its own world — `CW.db`,
 * a fixture of some 600 KB inside a 2.6 MB file — and that world is a $152B, 4,500-project programme of
 * which the 60 projects in the fixture are a 1.54% sample. So the Variance Report opened on a `$5.00B`
 * period plan, and what was asked for is a demo whose figures read in the tens of millions.
 *
 * **It is a script rather than an edit, and the document's own header says why**: *"DO NOT HAND-EDIT.
 * Edit the generator that emits the fixture, re-run the chain."* That generator (`gen/port.py`) lives in
 * the demo package rather than in this repo, so the honest stand-in for changing it is a transform that
 * is **re-runnable, exhaustively classified, and verified against the document it just wrote**. When a
 * re-export lands, run this again — `check-docs` fails the build if a document comes back in billions.
 *
 * **One factor, which is the whole point.** Every capital figure is divided by the same `FACTOR`, so
 * every ratio the documents state — each variance percentage, the sample's 1.54% share, the gap as a
 * share of the programme — is still exactly true afterwards. Rescaling figure by figure would have left
 * the prose stating relationships the numbers no longer have.
 *
 * **What it does not touch, stated rather than left to be discovered.** Platform spend is dollars but
 * not capital: a `$100 / mo` model cost cap divided by a hundred is a dollar, which is a different claim
 * about a different thing. The What-if lens document and the authoring fixture in `db.CAPEX.json` are
 * already denominated in millions and are left alone. Only these three files change.
 *
 * The safety is in the shape of the thing:
 *
 * 1. **Every numeric literal is found by its *path*, never by its key name.** `scanLiterals` walks the
 *    fixture text and yields an offset plus `portfolio.byYear.workingBudget.FY26`. Key names collide —
 *    `value` is a contract's amount, a lever's position and a filter's threshold; `max` is a lever bound
 *    — and a key-driven rewrite would have to be right about all of them at once. Paths do not collide.
 * 2. **Inside the containers a report reads, every number is classified money or not-money, and an
 *    unclassified one refuses the run.** A missed field is the failure that matters here: one unscaled
 *    figure among scaled siblings is a report whose own subtotals disagree, and nothing errors.
 * 3. **The rewrite is verified against the document it produced.** The file is re-read, re-parsed, and
 *    every scaled path asserted to be exactly `old / FACTOR` with every other number byte-unchanged.
 * 4. **The prose is a table, not a pattern.** The fixture *quotes* figures — "a 60-row sample does not
 *    sum to $113.1B" — and each is listed with the path that holds it. A money-looking run the table
 *    does not name refuses the run, which is how `1.1 million gallon` stays a basin's volume.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const DIR = new URL('../../frontend/src/Capex/Report/', import.meta.url)
const FILES = [
  'R1_variance_report.html',
  'R2_project_360.html',
  'R3_rate_case_filing_calendar.html',
]

/**
 * The divisor, and the figure that decides it.
 *
 * 100 is pinned to the Variance Report's own tiles: `periodPlan` is $5.00B, so this lands it at exactly
 * $50.0M — the top of the range asked for — and every other figure the three reports print falls below.
 * `CEILING` is what the verification below and `check-docs` both re-check, so moving one without the
 * other fails rather than drifting.
 */
const FACTOR = 100
const CEILING = 50_000_000

/* ------------------------------------------------------------------ what counts as money */

/*
 * Money, by path — everything a report can print that is denominated in dollars.
 *
 * Grouped the way the fixture is, because that is how a reviewer checks this against the document: the
 * programme's own figures, the per-project rows, and the three contract-side collections that Project
 * 360's vendor and line-item blocks read.
 */
const MONEY = [
  /* The programme. `pisNext12moValue` and `rateBase` are null in this fixture and are listed anyway: a
     later export that fills them must not leave them a hundred times larger than everything else. */
  /^portfolio\.(sampleBudget|sampleForecast|budget5yr|forecast5yr|gap5yr|spentToDateInception|authorized5yr|planMovement|planMovementPfas|periodPlan|periodActual|periodVariance|samplePeriodPlan|samplePeriodActual|samplePeriodVariance|largeProjectBudget|megaProjectWorking|megaProjectThreshold|sampleLargeProjectBudget|rcSampleDeferredCapital|pisNext12moValue|rateBase)$/,
  /^portfolio\.pfas(Forecast|Budget|Gap)5yr$/,
  /* The four FY26 plan cuts, the size bands' edges, and the seven-year profile per plan vintage. */
  /^portfolio\.fy26PlanCuts\.[A-Za-z0-9_]+$/,
  /^portfolio\.eacBands\[\d+\]\.(floor|ceiling|working)$/,
  /^portfolio\.byYear\./,
  /^portfolio\.vintageMembers\[\d+\]\.total5yr$/,
  /^portfolio\.vintageMembers\[\d+\]\.by(Category|ExecCategory)\./,
  /^portfolio\.planBridgeByCategory\[\d+\]\.(from|to|delta)$/,
  /^portfolio\.variancePeriodByCategory\[\d+\]\.(plan|actual|variance)$/,
  /* The heatmap is money end to end — its cells, both margins, and its corner total. */
  /^portfolio\.varianceHeatmap\.(z|rowTotals|colTotals|total)/,
  /^portfolio\.rateCaseExposure\[\d+\]\.(deferredCapital|undatedCapital)$/,
  /* A project's position, at every coordinate the glossary defines. */
  /^projects\[\d+\]\.(budget|authorized|committed|actual|planPeriod|actualPeriod|periodVariance|cwip|capitalized|rateBase|forecast|eac|eacVariance|contingencyAlloc|contingencyUsed|contingencyRemaining|openPOs|inServiceValue|awarded|netChangeOrders|unawardedTotal)$/,
  /^projects\[\d+\]\.unawarded\[\d+\]\.value$/,
  /^projects\[\d+\]\.fy26\.(budget|planYtd|actual|workingForecast|f39|f66|f93)$/,
  /^projects\[\d+\]\.monthly\.(actual|plan|workingForecast|f39)\[\d+\]$/,
  /^projects\[\d+\]\.yearActuals\.FY\d+$/,
  /* Keyed by fiscal year rather than indexed, in all three vintages. */
  /^projects\[\d+\]\.yearPlan\.(working|mtp|optimized)\.FY\d+$/,
  /* A block's own dollar floor — "ignore anything under $5,000" — which has to move with the column
     it is a floor on, exactly as a filter's threshold does. Its name states the unit. */
  /^reports\[\d+\]\.spec\.blocks\[\d+\]\.policy\.floorUSD$/,
  /* What was let, what moved it, and the figure a letter names. */
  /^contracts\[\d+\]\.value$/,
  /^changeOrders\[\d+\]\.value$/,
  /^correspondence\[\d+\]\.extraction\.amount$/,
]

/*
 * Not money, in the same containers — and this list is as load-bearing as the one above.
 *
 * A count, a percentage, a day count, a year, a confidence and an array index all sit beside the figures
 * and would be nonsense divided by a hundred: a 37%-complete project would read 0.37%, and a 12-month
 * slip a tenth of a month. Every one is stated rather than inferred from how the key is spelled, because
 * inferring a unit from a name is how a day count becomes dollars — which is why the documents keep a
 * `FIELD_UNIT` table of their own.
 */
const NOT_MONEY = [
  /* Percentages and shares, however the key happens to end. */
  /(Pct|Share)$/,
  /^portfolio\.(gapPct|sampleShareOfPortfolio|pfasShareOfGap)$/,
  /* Counts — of projects, rows, packages, documents, jurisdictions. */
  /Count$/,
  /^portfolio\.(projectCountTotal|projectCountInFixture)$/,
  /^portfolio\.eacBands\[\d+\]\.count$/,
  /* Days, months, years. */
  /(Days|Months|Years)$/,
  /^portfolio\.horizonYears\[\d+\]$/,
  /^portfolio\.rateCaseExposure\[\d+\]\.daysToFilingBy$/,
  /^projects\[\d+\]\.(startYear|endYear|rcDaysOfSlack)$/,
  /^correspondence\[\d+\]\.extraction\.months$/,
  /^changeOrders\[\d+\]\.days$/,
  /* Physical progress, priority, risk, and the graph's own tallies. */
  /^projects\[\d+\]\.(pctComplete|engPctComplete|riskScore|capexPriority|connections)$/,
  /* An index into a month array, not a quantity. */
  /^projects\[\d+\]\.monthly\.closedThrough$/,
  /* Extraction confidence, a scored candidate, and the confidence floor an annotation was kept at. */
  /(extractedConf|confidence|score)$/,
  /^annotations\[\d+\]\.floor$/,
  /* A report definition's own shape: how many rows, where an axis is cut, which version it is, and
     which citation a block's note points at. */
  /^reports\[\d+\]\.(version|reportVersion)$/,
  /^reports\[\d+\]\.spec\.blocks\[\d+\]\.(months|limit|silentLimit|topPerMonth)$/,
  /^reports\[\d+\]\.spec\.blocks\[\d+\]\.(quadrant|scale|expand|rank)\./,
  /^reports\[\d+\]\.spec\.blocks\[\d+\]\.cites\[\d+\]\.n$/,
  /* A block's expansion policy — a confidence floor and a share of budget, both ratios. `floorUSD`
     sits beside them and is money, which is why these two are named rather than the whole object. */
  /^reports\[\d+\]\.spec\.blocks\[\d+\]\.policy\.(confidenceFloor|pctOfBudget)$/,
  /^reports\[\d+\]\.spec\.blocks\[\d+\]\.figures\[\d+\]\.(at|band)$/,
]

/**
 * The containers a report reads. Outside these a number belongs to another view and is left alone.
 *
 * `annotations` is here for its prose rather than its figures — a note quoting "CO-003 for $1,207,400"
 * is printed under Project 360, and its only numbers are extraction confidences.
 */
const IN_SCOPE = /^(portfolio|projects|contracts|changeOrders|correspondence|annotations|reports)\b/

/*
 * A report definition's money *thresholds*. "Projects above $1M" is a filter on a money column, so the
 * threshold has to move with the column or the filter selects a different population than the sentence
 * beside it describes. Decided from the filter's own `field`, which is the rule the whole file follows:
 * the document says what a field is, this script does not guess from the size of the number.
 */
const MONEY_FIELDS = new Set([
  'budget', 'authorized', 'committed', 'actual', 'forecast', 'eac', 'eacVariance', 'planPeriod',
  'actualPeriod', 'periodVariance', 'awarded', 'unawardedTotal', 'inServiceValue', 'netChangeOrders',
  'contingencyAlloc', 'contingencyUsed', 'contingencyRemaining', 'cwip', 'capitalized', 'rateBase',
])

/*
 * The figures the fixture *quotes in prose*, each with the path that holds it.
 *
 * These are the sentences that would otherwise contradict the figures beside them — "a 60-row sample
 * does not sum to $113.1B" over a programme now stated as $1.13B. Listed one by one rather than matched
 * by pattern, because the same shape of run is sometimes not money at all: `1.1 million gallon` is a
 * basin's volume, and a pattern confident enough to catch every figure is confident enough to shrink a
 * reservoir. `n` is asserted, so a re-export that rewords a sentence fails here instead of quietly
 * leaving one figure a hundred times the rest.
 */
const PROSE = [
  { path: 'portfolio.coverageNote', from: '$113.1B', to: '$1.13B', n: 1 },
  { path: 'portfolio.vintageWalkNote', from: '$4.22B', to: '$42.2M', n: 1 },
  { path: 'portfolio.megaProjectBasis', from: '$50M', to: '$500K', n: 1 },
  { path: 'projects[0].scope[3][1][0]', from: '$15,900,000', to: '$159,000', n: 1 },
  { path: 'projects[0].scope[7][1][0]', from: '$1.6 million', to: '$16,000', n: 1 },
  { path: 'projects[4].scope[2][1][2]', from: '$762,000', to: '$7,620', n: 1 },
  { path: 'annotations[2].body', from: '$1,207,400', to: '$12,074', n: 1 },
  { path: 'annotations[3].body', from: '$399,000', to: '$3,990', n: 1 },
  { path: 'annotations[4].body', from: '$1.58M', to: '$15,800', n: 2 },
  { path: 'annotations[5].body', from: '$847,600', to: '$8,476', n: 1 },
  { path: 'correspondence[27].excerpt', from: '$840,000', to: '$8,400', n: 1 },
  /* A letter's own figure, and the extraction's account of what it read there — the same number said
     twice on purpose, so both have to move or the extraction contradicts its source. */
  { path: 'correspondence[29].excerpt', from: '$9,400', to: '$94', n: 1 },
  { path: 'correspondence[29].extraction.statement', from: '$9,400', to: '$94', n: 1 },
  { path: 'correspondence[30].excerpt', from: '$4.8M', to: '$48,000', n: 1 },
  { path: 'correspondence[30].extraction.statement', from: '$4.8M', to: '$48,000', n: 1 },
  { path: 'correspondence[30].extraction.sourceNote', from: '$4.8M', to: '$48,000', n: 1 },
  /* The change order that moved a contract, quoted in its own reason as well as in the project's
     scope note above. */
  { path: 'changeOrders[19].reason', from: '$762,000', to: '$7,620', n: 1 },
  /* An illustration rather than a figure out of the data — and it keeps its point only if both halves
     move, since what it illustrates is the ratio between them. */
  { path: 'reports[1].spec.blocks[2].note', from: '$40k', to: '$400', n: 1 },
  { path: 'reports[1].spec.blocks[2].note', from: '$40M', to: '$400K', n: 1 },
  { path: 'reports[3].subtitle', from: '$1M', to: '$10K', n: 1 },
  { path: 'reports[3].spec.blocks[0].figures[0].note', from: '$1M', to: '$10K', n: 1 },
  { path: 'reports[3].spec.filters[0].why', from: '$1,000,000', to: '$10,000', n: 1 },
  { path: 'reports[3].spec.blocks[0].figures[3].label', from: '$15M', to: '$150K', n: 1 },
  { path: 'reports[3].spec.blocks[2].rank.why', from: '$1.2M', to: '$12K', n: 1 },
]

/** Money-shaped runs deliberately left alone, so the sweep can refuse everything it does not know. */
const PROSE_KEEP = new Set(['1.1 million'])

/* ------------------------------------------------------------------- reading the fixture */

const BACKSLASH = String.fromCharCode(92)

/** Brace-match from `at`, skipping strings and comments — a comment here holds prose full of braces. */
function matchBlock(src, at) {
  let depth = 0
  let inStr = null
  let esc = false
  let line = false
  let block = false
  for (let k = at; k < src.length; k++) {
    const c = src[k]
    const next = src[k + 1]
    if (line) {
      if (c === '\n') line = false
      continue
    }
    if (block) {
      if (c === '*' && next === '/') {
        block = false
        k++
      }
      continue
    }
    if (inStr) {
      if (esc) esc = false
      else if (c === BACKSLASH) esc = true
      else if (c === inStr) inStr = null
      continue
    }
    if (c === '/' && next === '/') {
      line = true
      k++
      continue
    }
    if (c === '/' && next === '*') {
      block = true
      k++
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      continue
    }
    if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') {
      depth--
      if (depth === 0) return k
    }
  }
  return -1
}

/** Every `CW.db… = <literal>` assignment: where it is, its text, and its evaluated value. */
function fixtureBlocks(src) {
  const out = []
  for (const m of src.matchAll(/^CW\.db(\.[A-Za-z0-9_]+)?\s*=\s*/gm)) {
    const at = m.index + m[0].length
    if (src[at] !== '{' && src[at] !== '[') continue
    const end = matchBlock(src, at)
    if (end < 0) throw new Error(`unterminated fixture block at ${at}`)
    const name = m[1] ? m[1].slice(1) : null
    const text = src.slice(at, end + 1)
    /* The fixture is JS rather than JSON — bare keys, comments, trailing commas — so it is evaluated
       rather than parsed. It is data in a file this build already ships and runs. */
    // eslint-disable-next-line no-new-func
    const value = new Function('return (' + text + ')')()
    out.push({ name, at, end, text, value })
  }
  return out
}

/** The whole fixture as one object, the way the document assembles it. */
function fixtureOf(blocks) {
  const db = {}
  for (const b of blocks) {
    if (b.name) db[b.name] = b.value
    else Object.assign(db, b.value)
  }
  return db
}

/**
 * Every numeric and string literal in a block's text, with the path that reaches it.
 *
 * A hand-written scan rather than a parse-and-reserialise, because reserialising would reformat 600 KB
 * of a generated file and lose every comment in it — and the comments are half of what makes these
 * documents readable. Offsets let the rewrite change the figures and nothing else, so the diff is
 * exactly the numbers that moved.
 */
function scanLiterals(text, root) {
  const nums = []
  const strs = []
  let i = 0

  const skip = () => {
    for (;;) {
      while (i < text.length && /\s/.test(text[i])) i++
      if (text[i] === '/' && text[i + 1] === '/') {
        while (i < text.length && text[i] !== '\n') i++
        continue
      }
      if (text[i] === '/' && text[i + 1] === '*') {
        i += 2
        while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
        i += 2
        continue
      }
      return
    }
  }

  const readString = () => {
    const quote = text[i]
    const start = i
    i++
    for (;;) {
      const c = text[i]
      if (c === BACKSLASH) {
        i += 2
        continue
      }
      i++
      if (c === quote) break
      if (i > text.length) throw new Error('unterminated string')
    }
    return { start, end: i, raw: text.slice(start, i) }
  }

  const readValue = (path) => {
    skip()
    const c = text[i]
    if (c === '{') {
      i++
      for (;;) {
        skip()
        if (text[i] === '}') {
          i++
          return
        }
        if (text[i] === ',') {
          i++
          continue
        }
        let key
        if (text[i] === '"' || text[i] === "'") key = JSON.parse('"' + readString().raw.slice(1, -1).replace(/\\'/g, "'") + '"')
        else {
          const start = i
          while (i < text.length && /[A-Za-z0-9_$]/.test(text[i])) i++
          key = text.slice(start, i)
        }
        skip()
        if (text[i] !== ':') throw new Error(`expected ':' after ${path}.${key} at ${i}`)
        i++
        readValue(path ? `${path}.${key}` : key)
      }
    }
    if (c === '[') {
      i++
      let n = 0
      for (;;) {
        skip()
        if (text[i] === ']') {
          i++
          return
        }
        if (text[i] === ',') {
          i++
          continue
        }
        readValue(`${path}[${n++}]`)
      }
    }
    if (c === '"' || c === "'" || c === '`') {
      const s = readString()
      strs.push({ path, ...s })
      return
    }
    const start = i
    while (i < text.length && /[-+0-9.eE]/.test(text[i])) i++
    if (i > start) {
      const raw = text.slice(start, i)
      if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(raw)) {
        nums.push({ path, start, end: i, raw, value: Number(raw) })
        return
      }
      i = start
    }
    /* true / false / null / undefined / an identifier — nothing this script rewrites. */
    while (i < text.length && /[A-Za-z0-9_$]/.test(text[i])) i++
    if (i === start) throw new Error(`could not read a value at ${start} of ${root}: ${text.slice(start, start + 30)}`)
  }

  readValue(root ?? '')
  return { nums, strs }
}

/* ------------------------------------------------------------------------------- the work */

const matches = (path, list) => list.some((re) => re.test(path))
const problems = []
/** Numbers inside a report's own data that neither list places, keyed by path shape. */
const unplaced = new Map()

/** `portfolio.byYear.workingBudget.FY26` → the value the parsed fixture holds there. */
function at(db, path) {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.')
  return parts.reduce((o, k) => (o == null ? o : o[k]), db)
}

/** The three reports this dataset ships, which are the ones the ceiling is about. */
const SHIPPED = ['rep_q_variance', 'rep_proj_360', 'rep_pis_calendar']

/**
 * Every figure the three reports actually print, resolved through each block's own `source`.
 *
 * The ceiling is a claim about **what a reader sees**, so it has to be measured there rather than over
 * the fixture: the programme's own $1.13B five-year budget is still in the data and no report block
 * names it, and a check over the biggest number in the file would fail on that while a check over the
 * file's average would pass with a tile reading $5.00B. A block declares its `figures`, its `series` and
 * its `baseline`; this walks them, takes the largest value each key holds in the collection the block
 * reads, and reports where it came from.
 */
function reportFigures(db) {
  const out = []
  for (const report of db.reports ?? []) {
    if (!SHIPPED.includes(report.id)) continue
    for (const block of report.spec?.blocks ?? []) {
      const keys = [
        ...(block.figures ?? []).map((x) => [x.key, x.measure]),
        ...(block.series ?? []).map((x) => [x.key, x.measure ?? block.measure]),
        ...(block.baseline ? [[block.baseline.key, block.baseline.measure ?? block.measure]] : []),
        ...(block.columns ?? []).map((c) => [c.key ?? c, c.measure ?? null]),
      ]
      for (const [key, measure] of keys) {
        /* Only the money ones: a percentage over 50,000,000 is not a thing, and a count of projects
           being under the ceiling says nothing about the report. */
        if (!measure || db.measures?.[measure]?.unit !== 'USD') continue
        const root = at(db, block.source === 'project' ? 'projects' : (block.source ?? 'portfolio'))
        const values = Array.isArray(root)
          ? root.map((r) => r?.[key])
          : root && typeof root === 'object'
            ? [root[key], ...(Array.isArray(root[key]) ? root[key] : [])]
            : []
        const numbers = values.flat().filter((v) => typeof v === 'number')
        if (numbers.length === 0) continue
        const value = numbers.reduce((m, v) => (Math.abs(v) > Math.abs(m) ? v : m), 0)
        out.push({ report: report.id, path: `${block.source ?? 'portfolio'}.${key}`, value })
      }
    }
  }
  return out
}

/** Whether one literal is capital money, and why — `null` when it is deliberately not. */
function moneyness(path, db) {
  if (!IN_SCOPE.test(path)) return { money: false, why: 'another view' }
  if (matches(path, NOT_MONEY)) return { money: false, why: 'not a money field' }
  if (matches(path, MONEY)) return { money: true }
  /* A filter's threshold is money when the column it filters is. */
  const filter = /^(reports\[\d+\]\.spec\.filters\[\d+\])\.value$/.exec(path)
  if (filter) {
    const field = at(db, `${filter[1]}.field`)
    if (MONEY_FIELDS.has(field)) return { money: true }
    return { money: false, why: `a filter on ${field}` }
  }
  return null
}

/**
 * A figure, divided and rounded back to the grain the fixture states for itself.
 *
 * **Whole dollars, because the document says so in as many words**: *"Financial measures are USD at
 * WHOLE-DOLLAR grain. The old millions-scaled unit is gone: it was a formatting choice wearing a unit's
 * clothes."* Two thirds of these values are not multiples of a hundred, so keeping the remainder would
 * have left 1,676 figures carrying cents — and `fmt` builds its `exact` string straight off the value,
 * the one string whose job is to be the unrounded record, so those cents would surface in every
 * provenance panel as `$24,497,475.78`. A demo figure at a hundredth of a dollar is a precision claim
 * the source never made.
 *
 * **What rounding costs is stated rather than hidden**: a sum of rounded terms can differ from the
 * rounded sum by up to a dollar per term, so the identity checks below carry their term count instead of
 * demanding exactness. Non-integers in the fixture — a percentage is one, though none of those reach
 * here — keep two decimals.
 */
const scale = (n) => {
  const v = n / FACTOR
  return Number.isInteger(n) ? String(Math.round(v)) : String(Number(v.toFixed(2)))
}

function rescale(file) {
  const path = new URL(file, DIR)
  const src = readFileSync(path, 'utf8')
  const blocks = fixtureBlocks(src)
  const db = fixtureOf(blocks)

  /* Already done? The period plan is the figure the factor was chosen for, so it is the sentinel. */
  if (db.portfolio.periodPlan < CEILING * 2) {
    problems.push(
      `${file} looks rescaled already — portfolio.periodPlan is ${db.portfolio.periodPlan}, ` +
        `which is below the ${CEILING * 2} this expects before a run. Running twice would divide twice.`,
    )
    return null
  }

  /* ---- classify every literal, and refuse on one this script cannot place ---- */
  const edits = []
  const scaled = []
  let skipped = 0
  for (const block of blocks) {
    const { nums, strs } = scanLiterals(block.text, block.name ?? '')
    for (const n of nums) {
      const verdict = moneyness(n.path, db)
      if (verdict === null) {
        /*
         * Reported by *shape* — `rateCaseExposure[*].deferredCapital`, not four rows of one sentence.
         * A refusal listing four thousand instances of a dozen fields is a refusal nobody reads, and
         * what has to be decided here is one line per field.
         */
        const shape = n.path.replace(/\[\d+\]/g, '[*]')
        const e = unplaced.get(shape) ?? { n: 0, sample: n.raw }
        e.n++
        unplaced.set(shape, e)
        continue
      }
      if (!verdict.money) {
        skipped++
        continue
      }
      edits.push({ at: block.at + n.start, end: block.at + n.end, text: scale(n.value) })
      scaled.push({ path: n.path, was: n.value })
    }

    /* ---- the prose, from the table, and a sweep that refuses anything the table does not name ---- */
    for (const s of strs) {
      /*
       * The sweep is scoped exactly as the figures are. Outside a report's own containers the dollars
       * are platform spend — a `$100 / mo` model cap, a build's `$27.40` — which is money this rescale
       * has nothing to say about, and demanding it be listed would be asking for a decision that has
       * already been made.
       */
      if (!IN_SCOPE.test(s.path)) continue
      const body = s.raw
      const wanted = PROSE.filter((p) => p.path === s.path)
      let next = body
      for (const p of wanted) {
        const hits = next.split(p.from).length - 1
        if (hits !== p.n) {
          problems.push(
            `${file}: expected ${p.n} × "${p.from}" in ${s.path} and found ${hits} — the document's ` +
              'wording changed, so this substitution has to be re-read rather than re-applied',
          )
          continue
        }
        next = next.split(p.from).join(p.to)
      }
      /*
       * What is left must hold no money-looking run this table did not put there.
       *
       * The pattern deliberately does not end on punctuation — an early version matched `$16,000.` and
       * then failed to recognise its own replacement, reporting a figure it had just written as one
       * nobody had accounted for. A decimal point counts only when digits follow it.
       */
      const left = next.replace(/\$\d(?:[\d,]*\d)?(?:\.\d+)?\s?(?:B|M|K|k)?|\b\d+(?:\.\d+)?\s?(?:B|bn|billion|million)\b/g, (hit) => {
        const bare = hit.trim()
        if (PROSE_KEEP.has(bare)) return ''
        if (PROSE.some((p) => p.to === bare)) return ''
        problems.push(
          `${file}: ${s.path} still states "${bare}" — add it to PROSE with its scaled form, or to ` +
            'PROSE_KEEP if it is not money',
        )
        return ''
      })
      void left
      if (next !== body) edits.push({ at: block.at + s.start, end: block.at + s.end, text: next })
    }
  }

  if (problems.length > 0) return null

  /* ---- rewrite from the end, so every offset still points where it was scanned ---- */
  edits.sort((a, b) => b.at - a.at)
  let out = src
  for (const e of edits) out = out.slice(0, e.at) + e.text + out.slice(e.end)

  /* ---- verify against what was written, not against what was intended ---- */
  const after = fixtureOf(fixtureBlocks(out))
  for (const s of scaled) {
    const now = at(after, s.path)
    const want = Number(scale(s.was))
    if (now !== want) {
      problems.push(`${file}: ${s.path} should now be ${want} and is ${now}`)
    }
  }
  /*
   * The arithmetic the fixture asserts about itself, re-checked on the rescaled document.
   *
   * This is what proves a uniform divide kept the world consistent — and it is the check that would
   * catch a field left out of `MONEY`, because an unscaled term makes its own total wrong by a factor of
   * a hundred rather than by a rounding cent. **The tolerance is one dollar per term**, which is exactly
   * what rounding each term to a whole dollar can cost; anything larger is a real disagreement.
   */
  const heat = after.portfolio.varianceHeatmap
  const identities = [
    ['periodVariance = periodActual - periodPlan', after.portfolio.periodActual - after.portfolio.periodPlan, after.portfolio.periodVariance, 2],
    ['gap5yr = forecast5yr - budget5yr', after.portfolio.forecast5yr - after.portfolio.budget5yr, after.portfolio.gap5yr, 2],
    ['sampleBudget = the 60 projects’ budgets', after.projects.reduce((t, p) => t + (p.budget ?? 0), 0), after.portfolio.sampleBudget, after.projects.length],
    ['heatmap total = its column totals', heat.colTotals.reduce((t, v) => t + v, 0), heat.total, heat.colTotals.length + 1],
    ['heatmap total = its row totals', heat.rowTotals.reduce((t, v) => t + v, 0), heat.total, heat.rowTotals.length + 1],
    [
      'periodVariance by category = actual - plan',
      after.portfolio.variancePeriodByCategory.reduce((t, r) => t + (r.actual - r.plan), 0),
      after.portfolio.variancePeriodByCategory.reduce((t, r) => t + r.variance, 0),
      after.portfolio.variancePeriodByCategory.length * 3,
    ],
  ]
  for (const [what, a, b, terms] of identities) {
    if (Math.abs(a - b) > terms) {
      problems.push(`${file}: ${what} — ${a} vs ${b}, past the ${terms} of rounding this allows`)
    }
  }

  /*
   * And the point of the whole exercise: nothing a report prints may exceed the ceiling. Checked over
   * every figure each of the three reports declares, resolved through the block's own source, because a
   * ceiling asserted over the fixture's biggest number would fail on the programme figures no report
   * shows — and a ceiling asserted over nothing at all would pass while a tile read $5.00B.
   */
  const printed = reportFigures(after)
  if (printed.length === 0) problems.push(`${file}: no printed figures were resolved — this check cannot run`)
  for (const p of printed) {
    if (Math.abs(p.value) > CEILING) {
      problems.push(`${file}: ${p.report} prints ${p.path} = ${p.value}, above the ${CEILING} ceiling`)
    }
  }

  return { path, out, scaled, skipped, after, printed }
}

/* --------------------------------------------------------------------------------- run it */

const results = FILES.map((f) => ({ file: f, ...(rescale(f) ?? {}) }))

if (unplaced.size > 0) {
  console.error("\nscale-capex-reports: refusing to write — these sit inside a report's own data and are")
  console.error('neither money nor listed as something else. Place each one, in MONEY or in NOT_MONEY:\n')
  for (const [shape, e] of [...unplaced.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.error(`  · ${shape}   ${e.n} value(s), e.g. ${e.sample}`)
  }
  console.error('')
  process.exit(1)
}

if (problems.length > 0) {
  console.error('\nscale-capex-reports: refusing to write —')
  for (const p of problems.slice(0, 25)) console.error('  · ' + p)
  if (problems.length > 25) console.error(`  … and ${problems.length - 25} more`)
  console.error('\n  Nothing was written.\n')
  process.exit(1)
}

/* The three documents are one document plus a trailing report id, so they must stay that way. */
const tails = results.map((r) => r.out.length)
const heads = results.map((r) => r.out.slice(0, 2_500_000))
if (!heads.every((h) => h === heads[0])) {
  console.error('\nscale-capex-reports: the three documents diverged before their trailing script.')
  console.error('  They are byte-identical up to it, and a rescale must not be the thing that changes that.\n')
  process.exit(1)
}

for (const r of results) writeFileSync(r.path, r.out)

const f = (n) => (Math.abs(n) >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : Math.round(n).toLocaleString())
const one = results[0]
const p = one.after.portfolio
console.log(`\nscale-capex-reports: ÷${FACTOR} across ${FILES.length} documents`)
console.log(`  ${one.scaled.length} figures scaled · ${one.skipped} numbers left alone · ${tails[0].toLocaleString()} bytes`)
console.log(`  period plan     ${f(p.periodPlan)}   (tile 1 of the Variance Report)`)
console.log(`  period actual   ${f(p.periodActual)}`)
console.log(`  period variance ${f(p.periodVariance)}`)
console.log(`  60-project total ${f(p.sampleBudget)} · largest project ${f(Math.max(...one.after.projects.map((x) => x.eac ?? 0)))}`)
console.log(`  programme 5yr   ${f(p.budget5yr)} budget · ${f(p.forecast5yr)} forecast (not printed by these three reports)`)

/*
 * The largest figure each report prints, said out loud — because the ceiling is a claim about what a
 * reader sees, and a claim nobody can read back is a claim on trust. The whole list is the check above;
 * this is the one line per report that makes the result checkable by eye.
 */
for (const id of SHIPPED) {
  const rows = one.printed.filter((x) => x.report === id)
  const top = rows.reduce((m, x) => (Math.abs(x.value) > Math.abs(m.value) ? x : m), { value: 0, path: '—' })
  console.log(`  ${id.padEnd(16)} ${rows.length} money figures · largest ${f(top.value)} (${top.path})`)
}
console.log(`  ceiling ${f(CEILING)} — every figure the three reports print is inside it\n`)
