/**
 * What step 1 says it read out of the documents attached to a brief.
 *
 * **Nothing here opens the file, and that is the same arrangement the schema upload has.** The
 * attachment control is a showcase — only the filename travels, no bytes leave the browser — so
 * these readings are *synthesised* from the name, deterministically, the way `synthesiseColumns`
 * synthesises a column list and a drive document's entity list. The same file always reads the
 * same way, and two different files read differently, which is what a reader would expect of a
 * pass over their documents.
 *
 * **Pure and in `src/data/` for the reason `profilingOutcome` is**: the panel that prints these
 * sits inside a form whose state `renderToString` gives its initial value, so a list assembled
 * inside the component could only be asserted by rendering a step with nothing attached. Here it
 * can be called directly.
 *
 * **The pool is deliberately administrative and dataset-neutral.** A reading naming hazardous
 * waste would be a claim about EPA's documents that CAPEX's brief would then repeat, and a figure
 * inside one would be content nothing has read — so the extracts state definitions and the query
 * that computes them, never a measured value.
 */

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
 * The context lines — what a document says about the shape of the warehouse rather than about a
 * measure. One per document, always first, because that is the order a reader meets them in: what
 * this is, then what it defines.
 */
const CONTEXT = [
  'The maintenance warehouse uses the ops schema.',
  'Capital projects are keyed by project code, and a contract number is never one.',
  'A period closes on the fifth working day of the month that follows it.',
]

/** The measure definitions, in the shape a metrics memo states them. */
const DEFINITIONS: { headline: string; extract: string }[] = [
  {
    headline:
      'Maintenance Cost per Unit (MCU) is the headline figure in the monthly fleet review, and the number quarter close is judged against.',
    extract:
      "1. Maintenance Cost per Unit (MCU) Total maintenance spend booked against a generating unit for a calendar month, divided by that unit's installed capacity. Used for: the monthly fleet review and the quarter-close pack. Contract escalations are booked in the month they are invoiced, not the month the work was carried out. SELECT date_trunc('month', w.closed_at) AS month, SUM(w.cost_cents) / 100.0 / u.capacity_mw AS mcu FROM ops.work_orders w JOIN ops.units u ON u.unit_id = w.unit_id GROUP BY 1, u.unit_id ORDER BY 1;",
  },
  {
    headline:
      "Unplanned Outage Share is used to place next year's overhaul budget, where a share above 35% is read as a planned-maintenance interval that is too long.",
    extract:
      "2. Unplanned Outage Share Maintenance hours spent on unplanned, outage-driven repairs as a share of all maintenance hours in the period. Used for: placing next year's overhaul budget, and the reliability section of the board pack. A share above 35% is treated as a sign that a unit's planned interval is too long. SELECT ROUND(100.0 * SUM(CASE WHEN w.kind = 'unplanned' THEN w.hours ELSE 0 END) / NULLIF(SUM(w.hours), 0), 1) AS unplanned_share FROM ops.work_orders w WHERE w.closed_at >= date_trunc('quarter', CURRENT_DATE);",
  },
  {
    headline:
      'Contract Escalation Exposure is reviewed at quarter close with procurement, where anything above 8% is treated as an agreement that needs renegotiating.',
    extract:
      '3. Contract Escalation Exposure The value of this period\'s work booked under contract lines carrying an escalation clause, as a share of contracted spend. Used for: the quarter-close review with procurement. The escalation is read from the contract line and never re-derived from invoice totals. SELECT ROUND(100.0 * SUM(c.escalated_value) / NULLIF(SUM(c.contract_value), 0), 1) AS escalation_pct FROM ops.contract_lines c WHERE c.period = to_char(CURRENT_DATE, \'YYYY"Q"Q\');',
  },
  {
    headline:
      'Work Order Backlog Age is the number the weekly planning call runs on, and orders held for an outage window are deliberately not in it.',
    extract:
      "4. Work Order Backlog Age Median age in days of work orders that are open and past their scheduled start. Used for: the weekly planning call. Orders held for parts are counted; orders held for an outage window are not, because that is a scheduling decision rather than a backlog. SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CURRENT_DATE - w.scheduled_start) AS backlog_age_days FROM ops.work_orders w WHERE w.status = 'open' AND w.scheduled_start < CURRENT_DATE;",
  },
  {
    headline:
      'Cost per Work Order by Vendor is what the annual vendor review is scored on, and what rate negotiations open from.',
    extract:
      '5. Cost per Work Order by Vendor Mean cost of a completed work order, grouped by the vendor that carried it out and normalised by work-order class. Used for: the annual vendor review and rate negotiations. A work order spanning two vendors is attributed to the one that closed it. SELECT v.vendor_name, ROUND(AVG(w.cost_cents) / 100.0, 2) AS cost_per_wo FROM ops.work_orders w JOIN ops.vendors v ON v.vendor_id = w.closed_by_vendor GROUP BY 1 ORDER BY 2 DESC;',
  },
  {
    headline:
      'Spend Against Authorised Envelope is what escalates a project to the steering group — crossing 90% before its midpoint milestone.',
    extract:
      '6. Spend Against Authorised Envelope Committed plus actual spend on a capital project as a share of its authorised envelope. Used for: the monthly capital review; a project crossing 90% before its midpoint milestone is escalated to the steering group. SELECT p.project_code, ROUND(100.0 * (p.committed + p.actual) / NULLIF(p.authorized, 0), 1) AS pct_envelope FROM capital.projects p ORDER BY 2 DESC;',
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

/**
 * What the pass read out of each attached document, in the order the documents were attached.
 *
 * Deterministic: the same filename always yields the same four readings, so removing a document
 * and attaching it again does not quietly rewrite what it was said to contain.
 */
export function documentReadings(files: string[]): DocumentReading[] {
  const readings: DocumentReading[] = []

  for (const file of files) {
    const seed = hash(file)
    readings.push({
      id: `${file}#0`,
      headline: CONTEXT[seed % CONTEXT.length],
      extract: null,
      file,
    })

    for (let i = 0; i < DEFINITIONS_PER_DOC; i += 1) {
      const d = DEFINITIONS[(seed + i) % DEFINITIONS.length]
      readings.push({
        id: `${file}#${i + 1}`,
        headline: d.headline,
        extract: d.extract,
        file,
      })
    }
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
