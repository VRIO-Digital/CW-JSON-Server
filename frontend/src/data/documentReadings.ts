/**
 * What the wizard says it read out of the documents attached to a brief — the panel on step 1, and
 * the metric candidates offered on step 4.
 *
 * **Nothing here opens the file, and that is the same arrangement the schema upload has.** The
 * attachment control is a showcase — only the filename travels, no bytes leave the browser — so
 * what a document "contains" is *synthesised* from its name, deterministically, the way
 * `synthesiseColumns` synthesises a column list and a drive document's entity list. The same file
 * always reads the same way, and two different files read differently, which is what a reader
 * would expect of a pass over their documents.
 *
 * **One pool behind both surfaces, which is the point of this file.** Step 1 says *what we read*
 * and step 4 offers *the measures we found*; those are two readings of one pass, so a metric a
 * reader approves on step 4 is the same row they saw quoted on step 1. Two pools would be two
 * answers to what a document contains, one screen apart — the duplication this repo refuses for
 * the consent scopes, the report audience and the governance readers alike.
 *
 * **Pure and in `src/data/` for the reason `profilingOutcome` is**: both surfaces sit inside state
 * `renderToString` gives its initial value, so a list assembled inside either component could only
 * be asserted by rendering a step with nothing attached. Here it can be called directly.
 *
 * **The pool is deliberately administrative and dataset-neutral.** A reading naming hazardous
 * waste would be a claim about EPA's documents that CAPEX's brief would then repeat, and a figure
 * inside one would be content nothing has read — so a row states a definition and the query that
 * computes it, never a measured value.
 */

/**
 * One measure a document defines: the two columns a metric pool holds (`name`, `definition`)
 * plus what a document carries that a pool does not — the query it printed, and the sentence it
 * used to explain the calculation.
 */
type MetricDefinition = {
  /** The measure's name, as the document writes it. */
  name: string
  /** What the document says it is *for* — the clause step 1's headline ends on. */
  purpose: string
  /** One sentence: what it measures. This is what becomes the metric's `description`. */
  description: string
  /** Who reads it, in the document's own words. */
  usedFor: string
  /** How the document describes the calculation — the caveat, not the formula. */
  note: string
  /** The query the document prints for it, as the document lays it out. */
  query: string
  /**
   * The question this measure exists to answer, as the document phrases it.
   *
   * On the same row as the measure rather than in a pool of its own, because that is the fact:
   * a memo defines a measure *because* somebody asks something, and step 5 offering a question
   * step 4 never mentioned would be two reads of one file that do not agree.
   */
  question: string
  /**
   * Whether the document frames it as one of the few that matter — a headline figure, or a
   * threshold something is escalated on.
   *
   * Authored rather than derived: a hero question's priority is the graph's contract, and
   * defaulting every one of them to `normal` would be as much of a claim as marking them all High.
   * It is what the row **arrives** as; High stays editable in the list below, which is where the
   * step already says the contract gets settled.
   */
  priority: 'high' | 'normal'
}

/**
 * The context lines — what a document says about the shape of the warehouse rather than about a
 * measure. One per document, always first on step 1, because that is the order a reader meets
 * them in: what this is, then what it defines. They define no measure, so step 4 never sees them.
 */
const CONTEXT = [
  'The maintenance warehouse uses the ops schema.',
  'Capital projects are keyed by project code, and a contract number is never one.',
  'A period closes on the fifth working day of the month that follows it.',
]

/** The measure definitions, in the shape a metrics memo states them. */
const DEFINITIONS: MetricDefinition[] = [
  {
    name: 'Maintenance Cost per Unit (MCU)',
    purpose:
      'is the headline figure in the monthly fleet review, and the number quarter close is judged against',
    description:
      "Total maintenance spend booked against a generating unit for a calendar month, divided by that unit's installed capacity.",
    usedFor: 'the monthly fleet review and the quarter-close pack.',
    note: 'Contract escalations are booked in the month they are invoiced, not the month the work was carried out.',
    query: `SELECT date_trunc('month', w.closed_at) AS month,
       SUM(w.cost_cents) / 100.0 / u.capacity_mw AS mcu
  FROM ops.work_orders w
  JOIN ops.units u ON u.unit_id = w.unit_id
 GROUP BY 1, u.unit_id
 ORDER BY 1;`,
    question:
      "Which units are driving this month's maintenance cost per unit, and by how much?",
    priority: 'high',
  },
  {
    name: 'Unplanned Outage Share',
    purpose:
      "is used to place next year's overhaul budget, where a share above 35% is read as a planned-maintenance interval that is too long",
    description:
      'Maintenance hours spent on unplanned, outage-driven repairs as a share of all maintenance hours in the period.',
    usedFor:
      "placing next year's overhaul budget, and the reliability section of the board pack.",
    note: "A share above 35% is treated as a sign that a unit's planned interval is too long.",
    query: `SELECT ROUND(100.0 * SUM(CASE WHEN w.kind = 'unplanned' THEN w.hours ELSE 0 END)
             / NULLIF(SUM(w.hours), 0), 1) AS unplanned_share
  FROM ops.work_orders w
 WHERE w.closed_at >= date_trunc('quarter', CURRENT_DATE);`,
    question:
      'How much of our maintenance effort went to unplanned, outage-driven work this quarter?',
    priority: 'normal',
  },
  {
    name: 'Contract Escalation Exposure',
    purpose:
      'is reviewed at quarter close with procurement, where anything above 8% is treated as an agreement that needs renegotiating',
    description:
      "The value of this period's work booked under contract lines carrying an escalation clause, as a share of contracted spend.",
    usedFor: 'the quarter-close review with procurement.',
    note: 'The escalation is read from the contract line and never re-derived from invoice totals.',
    query: `SELECT ROUND(100.0 * SUM(c.escalated_value)
             / NULLIF(SUM(c.contract_value), 0), 1) AS escalation_pct
  FROM ops.contract_lines c
 WHERE c.period = to_char(CURRENT_DATE, 'YYYY"Q"Q');`,
    question:
      'Which vendor agreements are carrying the escalation exposure we close the quarter on?',
    priority: 'high',
  },
  {
    name: 'Work Order Backlog Age',
    purpose:
      'is the number the weekly planning call runs on, and orders held for an outage window are deliberately not in it',
    description:
      'Median age in days of work orders that are open and past their scheduled start.',
    usedFor: 'the weekly planning call.',
    note: 'Orders held for parts are counted; orders held for an outage window are not, because that is a scheduling decision rather than a backlog.',
    query: `SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CURRENT_DATE - w.scheduled_start)
         AS backlog_age_days
  FROM ops.work_orders w
 WHERE w.status = 'open'
   AND w.scheduled_start < CURRENT_DATE;`,
    question:
      'Which open work orders are furthest past their scheduled start?',
    priority: 'normal',
  },
  {
    name: 'Cost per Work Order by Vendor',
    purpose:
      'is what the annual vendor review is scored on, and what rate negotiations open from',
    description:
      'Mean cost of a completed work order, grouped by the vendor that carried it out and normalised by work-order class.',
    usedFor: 'the annual vendor review and rate negotiations.',
    note: 'A work order spanning two vendors is attributed to the one that closed it.',
    query: `SELECT v.vendor_name,
       ROUND(AVG(w.cost_cents) / 100.0, 2) AS cost_per_wo
  FROM ops.work_orders w
  JOIN ops.vendors v ON v.vendor_id = w.closed_by_vendor
 GROUP BY 1
 ORDER BY 2 DESC;`,
    question:
      'Which vendors cost us most per work order, once class is taken into account?',
    priority: 'normal',
  },
  {
    name: 'Spend Against Authorised Envelope',
    purpose:
      'is what escalates a project to the steering group — crossing 90% before its midpoint milestone',
    description:
      'Committed plus actual spend on a capital project as a share of its authorised envelope.',
    usedFor: 'the monthly capital review.',
    note: 'A project crossing 90% before its midpoint milestone is escalated to the steering group.',
    query: `SELECT p.project_code,
       ROUND(100.0 * (p.committed + p.actual) / NULLIF(p.authorized, 0), 1) AS pct_envelope
  FROM capital.projects p
 ORDER BY 2 DESC;`,
    question:
      'Which projects will cross 90% of their authorised envelope before their midpoint milestone?',
    priority: 'high',
  },
  {
    name: 'Change Order Rate',
    purpose:
      'is reviewed at monthly steering, where a rate above 15% is read as scope that was underspecified at award',
    description:
      'Contracts amended by at least one change order this period, as a share of all active contracts.',
    usedFor: 'the monthly steering review.',
    note: 'A change order correcting a clerical error on the contract is excluded.',
    query: `SELECT ROUND(100.0 * COUNT(DISTINCT c.contract_id) FILTER (WHERE co.change_order_id IS NOT NULL)
           / NULLIF(COUNT(DISTINCT c.contract_id), 0), 1) AS change_order_rate
  FROM ops.contract_lines c
  LEFT JOIN ops.change_orders co ON co.contract_id = c.contract_id
 WHERE c.status = 'active';`,
    question:
      'Which active contracts have been amended by a change order this period?',
    priority: 'normal',
  },
  {
    name: 'Warehouse Parts Turns',
    purpose:
      "is what the annual inventory review is scored on, and what sets next year's stocking levels",
    description:
      "A maintenance warehouse's annualised inventory turnover: cost of parts issued over the trailing year, divided by average parts on hand.",
    usedFor: 'the annual inventory review.',
    note: 'Parts held against a specific scheduled outage are excluded from the average on hand.',
    query: `SELECT i.warehouse_id,
       ROUND(SUM(i.issued_cost_cents) / 100.0 / NULLIF(AVG(i.on_hand_cost_cents) / 100.0, 0), 2) AS parts_turns
  FROM ops.inventory_issues i
 WHERE i.issued_at >= CURRENT_DATE - INTERVAL '1 year'
 GROUP BY 1;`,
    question:
      'Which warehouses are turning parts inventory slowest?',
    priority: 'normal',
  },
  {
    name: 'Permit Cycle Time',
    purpose:
      'is what a capital project schedule is built around, and a slip on it is the first thing the monthly review checks',
    description: 'Median days from a capital project permit application to its approval.',
    usedFor: 'the monthly capital review and project scheduling.',
    note: 'A permit withdrawn and re-filed restarts the clock rather than counting from the original filing.',
    query: `SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY p.approved_at - p.filed_at) AS permit_days
  FROM capital.permits p
 WHERE p.approved_at IS NOT NULL;`,
    question:
      'Which permits are taking longest to clear, and which projects are they holding up?',
    priority: 'normal',
  },
]

/** How many definitions a document contributes, beside its one context line. */
const DEFINITIONS_PER_DOC = 3

/** FNV-1a, so the slice is decided by the name rather than by upload order. */
function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** The definitions one document is read as carrying, in the order it states them. */
function definitionsFor(file: string): MetricDefinition[] {
  const seed = hash(file)
  const out: MetricDefinition[] = []
  for (let i = 0; i < DEFINITIONS_PER_DOC; i += 1) {
    out.push(DEFINITIONS[(seed + i) % DEFINITIONS.length])
  }
  return out
}

/**
 * A file's window resolved against what earlier files in the same attached set have already
 * claimed.
 *
 * `definitionsFor` alone is per-file and blind to the rest of the set, so two attached documents
 * whose hashes land on overlapping windows were shown quoting the identical measure — the same
 * query, the same caveat — attributed to two different files, which is not what a reader would
 * expect of a pass that had actually looked at both. So a name another file in this set already
 * claimed is skipped in favour of the pool's next one, walked from this file's own hash and
 * wrapping around it: a file attached on its own, or first in the set, still reads exactly what
 * `definitionsFor` alone would give it. Only once every definition in the pool is already spoken
 * for does a later file repeat one — the pool is finite and a document cannot be read as
 * containing fewer measures than its neighbours.
 */
function resolveDefinitions(
  file: string,
  preferred: MetricDefinition[],
  claimed: Set<string>,
): MetricDefinition[] {
  const seed = hash(file)
  const picked: MetricDefinition[] = []
  for (let step = 0; step < DEFINITIONS.length && picked.length < DEFINITIONS_PER_DOC; step += 1) {
    const candidate = DEFINITIONS[(seed + step) % DEFINITIONS.length]
    if (!claimed.has(candidate.name)) picked.push(candidate)
  }
  /* The pool has fewer unclaimed names left than this file needs — fall back to its own
     preferred window rather than reading with fewer than three. */
  preferred.forEach((d) => {
    if (picked.length < DEFINITIONS_PER_DOC) picked.push(d)
  })
  picked.forEach((d) => claimed.add(d.name))
  return picked
}

/* ---------------------------------------------------------------- step 1 */

/** One thing the pass says it took from one document. */
export type DocumentReading = {
  /** Stable for a given file and slot — `${file}#${n}`. */
  id: string
  /** What was read, as a sentence. */
  headline: string
  /** The passage it was taken from, or `null` where the headline is the whole of it. */
  extract: string | null
  /** The document it is attributed to. */
  file: string
}

/**
 * What the pass read out of each attached document, in the order the documents were attached.
 *
 * Deterministic for a given set of files: attach the same documents in the same order and the
 * reading is the same every time, so removing a document and attaching it again does not
 * quietly rewrite what it was said to contain. It is no longer deterministic *per file in
 * isolation* — `definitionsFor(file)` alone is each document's starting point, but a measure
 * another file in this set has already claimed is resolved away in favour of the pool's next
 * one (`resolveDefinitions`), so two attached documents cannot come to quote the same query and
 * caveat under two different names.
 */
export function documentReadings(files: string[]): DocumentReading[] {
  const readings: DocumentReading[] = []
  const claimed = new Set<string>()

  for (const file of files) {
    readings.push({
      id: `${file}#0`,
      headline: CONTEXT[hash(file) % CONTEXT.length],
      extract: null,
      file,
    })

    /* `definitionsFor(file)` is this document's own starting window; `resolveDefinitions`
       reconciles it against what earlier files in this same pass already claimed. */
    resolveDefinitions(file, definitionsFor(file), claimed).forEach((d, i) => {
      readings.push({
        id: `${file}#${i + 1}`,
        headline: `${d.name} ${d.purpose}.`,
        /* The passage as a PDF pass would hand it over: the numbered definition, what it is
           used for, the caveat, and the query run together on one line. The query keeps its
           own layout where it is *read* — on step 4 — and is flattened here, because this is
           a quotation of the page rather than a code block. */
        extract: `${i + 1}. ${d.name} ${d.description} Used for: ${d.usedFor} ${d.note} Answers: "${d.question}" ${d.query.replace(/\s+/g, ' ')}`,
        file,
      })
    })
  }

  return readings
}

/**
 * The grey line under a reading: the passage it came from and the document it came from, or just
 * the document where there is no passage.
 *
 * **Composed here rather than interpolated in the panel** — `renderToString` splits
 * `text {expr} text` into separate nodes, so a sentence assembled in JSX cannot be asserted as
 * one string, which is the rule this repo already keeps for interpolated copy.
 */
export function readingFootnote(reading: DocumentReading): string {
  return reading.extract ? `${reading.extract} · ${reading.file}` : reading.file
}

/** The panel's own words, so the count and the heading cannot come to be worded in two places. */
export const readingsTitle = (count: number) =>
  `What we read from your documents (${count})`

/* ---------------------------------------------------------------- step 4 */

/**
 * A measure found in an attached document, offered on the Metrics step for approval.
 *
 * It carries **more than a metric does**, and that is the reason it is its own type rather than a
 * `Suggestion`: a suggestion says *why it was drafted* (a keyword match, a named use case), and
 * this says *where it was read* — the query the document printed and the sentence it explained the
 * calculation with. Approving keeps the two columns a metric has; the rest is the evidence a
 * reader judges it on, and it stays on this screen rather than being folded into the description.
 */
export type DocumentMetric = {
  /** Stable for a given file and slot — `${file}#m${n}`. */
  id: string
  /** The measure's name, as the document writes it. */
  name: string
  /** One sentence: what it measures — what an approved metric carries as its description. */
  description: string
  /** The query the document printed for it, as it laid it out. */
  query: string
  /** How the document describes the calculation. */
  note: string
  /** The document it was read from. */
  file: string
}

/**
 * The measures the attached documents define, in the order they were attached.
 *
 * The same rows step 1 quotes, structured rather than flattened — a reader who approves
 * *Unplanned Outage Share* here is approving the definition they saw quoted two steps back. Which
 * means it has to resolve the same cross-file collisions step 1 does, through the same
 * `resolveDefinitions`, and with its own `claimed` set — two independent passes over one `files`
 * array, so a document reads the same measures on both surfaces.
 */
export function documentMetrics(files: string[]): DocumentMetric[] {
  const claimed = new Set<string>()
  return files.flatMap((file) =>
    resolveDefinitions(file, definitionsFor(file), claimed).map((d, i) => ({
      id: `${file}#m${i + 1}`,
      name: d.name,
      description: d.description,
      query: d.query,
      note: d.note,
      file,
    })),
  )
}

/* ---------------------------------------------------------------- step 5 */

/**
 * The found-metrics panel's words.
 *
 * Copy rather than sentences written where they are printed, for the reason `sourceActions` is:
 * the panel's rows are inside a collapsible body that `renderToString` gives its *shut* initial
 * state, so a label written inline could not be asserted at all.
 */
export const foundMetricsCopy = {
  heading: 'Found in your documents',
  /** On a row, above the query. */
  queryLabel: 'Query found in the document',
  /** On a row, above the note. */
  noteLabel: 'How the document describes the calculation',
  /** The toggle, shut and open. */
  showLabel: "How it's calculated",
  hideLabel: 'Hide',
  approveLabel: 'Approve',
  approvedLabel: 'Approved',
  rejectLabel: 'Reject',
  /**
   * What approving does, said once above the list.
   *
   * It is the only thing on the panel that is not read off a row, and it is here because
   * *Approve* is the one control whose effect is on another part of the screen: the list below.
   */
  note: 'Approving adds the measure to the list below, with the definition the document gave it. Rejecting drops it from this list and changes nothing else.',
}

/* ------------------------------------------------- the rows the panel draws */

/*
 * The shape above, as the rows `FoundInDocuments` draws.
 *
 * **Here rather than in the page** for the reason the pools are: a row assembled inside a
 * component can only be checked by rendering that component, and `renderToString` gives the step
 * its initial state — nothing attached, so nothing to assert. These are pure and can be called.
 * They are also what keeps the labels on one side of the boundary: the panel knows a detail has a
 * label and some text, and nothing about measures or queries.
 */

/** A found measure, as a panel row: its name as the document writes it, then its evidence. */
export function metricFoundItems(metrics: DocumentMetric[]) {
  return metrics.map((m) => ({
    id: m.id,
    title: m.name,
    titleMono: true,
    source: foundMetricSource(m),
    summary: m.description,
    details: [
      { label: foundMetricsCopy.queryLabel, text: m.query, code: true },
      { label: foundMetricsCopy.noteLabel, text: m.note },
    ],
  }))
}

/** `revops-metrics.pdf` → `from revops-metrics.pdf`, as one string for the row's attribution. */
export const foundMetricSource = (metric: DocumentMetric) => `from ${metric.file}`
