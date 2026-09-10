import fs from 'fs'

const path = 'backend/db.CAPEX.json'
const db = JSON.parse(fs.readFileSync(path, 'utf8'))

const nextGlossaryId = (() => {
  const nums = db.graph_metrics
    .map((m) => /^CAPEX-GL-(\d+)$/.exec(m.glossary ?? ''))
    .filter(Boolean)
    .map((m) => Number(m[1]))
  const max = nums.length ? Math.max(...nums) : 0
  let n = max
  return () => {
    n += 1
    return `CAPEX-GL-${String(n).padStart(3, '0')}`
  }
})()

const newMetrics = [
  {
    metric_id: 'total-forecast-remaining-large-proj',
    name: 'Total Forecast Remaining (Large Projects)',
    domains: ['capital-projects'],
    keywords: ['forecast', 'remaining', 'large project'],
    definition:
      '[Sum of FY26 Working Forecast] - [Sum of FY26 YearTotal Actual] + [Sum of FY27 Working Budget] ' +
      '+ [Sum of FY28 Working Budget] + [Sum of FY29 Working Budget] + [Sum of FY30 Working Budget] ' +
      '+ [Sum of FY31 Working Budget] + [Sum of FY32 Working Budget]',
    unit: 'USD',
    source: 'ds_epbcs_plan',
    glossary: nextGlossaryId(),
  },
  {
    metric_id: 'total-anticipated-cost',
    name: 'Total Anticipated Cost',
    domains: ['capital-projects'],
    keywords: ['anticipated', 'cost', 'total'],
    definition:
      '[Inception to Date (ITD) Actuals] + [Total_Forecast_Remaining_Large_Proj]',
    unit: 'USD',
    source: 'ds_epbcs_plan',
    glossary: nextGlossaryId(),
  },
  {
    metric_id: 'budget-consumed-to-date',
    name: 'Budget Consumed to Date',
    domains: ['capital-projects'],
    keywords: ['budget', 'consumed', 'to date'],
    definition:
      '[Inception to Date (ITD) Actuals] / [Most Recent Budget Plan in PeopleSoft (Value)]',
    unit: '%',
    source: 'ds_epbcs_plan',
    glossary: nextGlossaryId(),
  },
  {
    metric_id: 'forecast-budget-consumed-at-completion',
    name: 'Forecast Budget Consumed at Completion',
    domains: ['capital-projects'],
    keywords: ['forecast', 'budget', 'consumed', 'completion'],
    definition:
      '[Total_Anticipated_Cost] / [Most Recent Budget Plan in PeopleSoft (Value)]',
    unit: '%',
    source: 'ds_epbcs_plan',
    glossary: nextGlossaryId(),
  },
  {
    metric_id: 'full-year-budget-variance',
    name: 'Full Year Budget Variance',
    domains: ['capital-projects'],
    keywords: ['full year', 'budget', 'variance'],
    definition: '[Forecast 6+6] - [January_Calendarization Budget YTD]',
    unit: 'USD',
    source: 'ds_epbcs_plan',
    glossary: nextGlossaryId(),
  },
  {
    metric_id: 'ytd-budget-variance',
    name: 'Year-to-Date (YTD) Budget Variance',
    domains: ['capital-projects'],
    keywords: ['ytd', 'year to date', 'budget', 'variance'],
    definition:
      '[FY26 YearTotal Actual] (Actual YTD) - [FY26 January_Calendarization Budget YTD] (Budget YTD)',
    unit: 'USD',
    source: 'ds_epbcs_plan',
    glossary: nextGlossaryId(),
  },
  {
    metric_id: 'current-month-budget-variance',
    name: 'Current Month Budget Variance',
    domains: ['capital-projects'],
    keywords: ['current month', 'budget', 'variance'],
    definition: '[Actual (Current Month)] - [Budget (Current Month)]',
    unit: 'USD',
    source: 'ds_epbcs_plan',
    glossary: nextGlossaryId(),
  },
  {
    metric_id: 'overrun-amount',
    name: 'Overrun Amount',
    domains: ['capital-projects'],
    keywords: ['overrun', 'exception', 'budget'],
    /* The tenant's own DAX, kept verbatim rather than paraphrased — the exception categories
       (Network blankets, Lead Capex Budget Category, Meter blankets, Plant roll-up) are read on
       FY26 YearTotal Actual, everything else on Inception-to-Date Actuals, summed and then
       measured against the most recent PeopleSoft budget plan. */
    definition:
      'VAR ExceptionCategories = {"Network blankets","Lead Capex Budget Category","Meter blankets","Plant roll-up"} ' +
      'VAR ExceptionActuals = CALCULATE(SUM(EPBCS_DATA_2[FY26 YearTotal Actual]), KEEPFILTERS(EPBCS_DATA_2[Budget Category] IN ExceptionCategories)) ' +
      'VAR StandardActuals = CALCULATE(SUM(EPBCS_DATA_2[Inception to Date (ITD) Actuals]), KEEPFILTERS(NOT(EPBCS_DATA_2[Budget Category] IN ExceptionCategories))) ' +
      'RETURN ExceptionActuals + StandardActuals - SUM(EPBCS_DATA_2[Most Recent Budget Plan in PeopleSoft (Value)])',
    unit: 'USD',
    source: 'ds_epbcs_plan',
    glossary: nextGlossaryId(),
  },
]

const existingIds = new Set(db.graph_metrics.map((m) => m.metric_id))
const toAdd = newMetrics.filter((m) => !existingIds.has(m.metric_id))
db.graph_metrics.push(...toAdd)

const template = db.graph_use_case_templates.find((t) => t.template_id === 'capital-programme-intelligence')
if (!template) {
  console.error('template not found')
  process.exit(1)
}
const existingMemberIds = new Set(template.metrics)
for (const m of toAdd) {
  if (!existingMemberIds.has(m.metric_id)) template.metrics.push(m.metric_id)
}

fs.writeFileSync(path, JSON.stringify(db, null, 2) + '\n')
console.log(`added ${toAdd.length} metric(s):`, toAdd.map((m) => m.metric_id).join(', '))
console.log('template metrics now:', template.metrics.length)
