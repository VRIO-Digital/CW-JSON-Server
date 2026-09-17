/**
 * The query a hero question would be answered by, derived from the tenant's own profiled schema.
 *
 * **Pure, so `npm run verify:question-sql` can replay it with nothing running** — the same
 * arrangement `reportExport.js` and `studioLanes.js` have. A generator that can only be checked by
 * typing a question into a wizard and looking at the box is one nobody checks.
 *
 * **Every identifier in the output is read, never invented.** The table is one the use case's own
 * source picks admit, and every column is one `column_profiles` records against that table — so a
 * query this produces names things that exist, and a reader can check it against the Data Catalog.
 * That is the whole point: a plausible query naming a column the warehouse does not have is worse
 * than no query at all, because it reads as an answer and fails only when somebody runs it.
 *
 * **No model runs here, and the payload says so.** `degraded: true` rides on every reply, for the
 * reason the story draft carries one: a figure or a phrase that implies a model wrote it is the one
 * claim on this screen a reader cannot check. What this does is match the question's words against
 * the profiled columns and compose a SELECT from what it found — which is a *scan*, and the tab
 * labels it as such.
 *
 * **Nothing matched is a refusal, not a guess.** A question whose words reach no profiled column
 * returns `sql: null` with the reason, and the box shows its empty state. Composing `SELECT * FROM
 * some_table` to fill the space would be inventing a claim about which table answers the question.
 */

/** Words that carry no signal about which column a question is about. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'for', 'to', 'and', 'or', 'is', 'are', 'was', 'were',
  'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how', 'many', 'much',
  'do', 'does', 'did', 'has', 'have', 'had', 'be', 'been', 'by', 'with', 'from', 'at', 'as',
  'each', 'all', 'any', 'across', 'per', 'their', 'this', 'that', 'these', 'those', 'our',
  'us', 'we', 'it', 'its', 'most', 'least', 'more', 'less', 'over', 'under', 'into', 'out',
])

/**
 * The aggregate a question is asking for, or `null`.
 *
 * Read off the question's own words rather than assumed: a question that asks *which* rows is not
 * asking for an average, and wrapping one in `AVG` would answer a question nobody put.
 */
const AGGREGATES = [
  { fn: 'AVG', words: ['average', 'avg', 'mean', 'typical'] },
  { fn: 'SUM', words: ['total', 'sum', 'combined', 'altogether'] },
  { fn: 'MAX', words: ['longest', 'highest', 'largest', 'maximum', 'max', 'greatest', 'oldest'] },
  { fn: 'MIN', words: ['shortest', 'lowest', 'smallest', 'minimum', 'min', 'newest'] },
  { fn: 'COUNT', words: ['count', 'number', 'how many', 'distinct'] },
]

/** Classes that identify or group a row — the left-hand side of a GROUP BY. */
const DIMENSION_CLASSES = new Set([
  'identifier', 'dimension', 'entity', 'label', 'classification', 'person', 'address', 'geo', 'flag',
])

/** Types that can be aggregated arithmetically. A `STRING` holding digits is not one of them — the
 *  query casts it explicitly where the profile says it is a measure, which is what `SAFE_CAST` is
 *  for and why it is not applied to everything. */
const NUMERIC_TYPES = /^(INTEGER|INT64|NUMERIC|FLOAT|FLOAT64|BIGNUMERIC|DECIMAL)/i

export const words = (text) =>
  String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))

/**
 * A word folded to its singular, so a question asking about "facilities" reaches a column called
 * `des_facility_name`.
 *
 * Deliberately three rules and no stemmer: a real stemmer would fold `address` to `addres` and
 * `business` to `busines`, matching nothing, which is a worse failure than missing a plural — and it
 * would need a dependency through a gate that fails on any advisory.
 */
const singular = (word) =>
  word.endsWith('ies') && word.length > 4
    ? `${word.slice(0, -3)}y`
    : word.endsWith('sses') || word.endsWith('ses')
      ? word.slice(0, -2)
      : word.endsWith('s') && !word.endsWith('ss') && word.length > 3
        ? word.slice(0, -1)
        : word

/**
 * What the question says it wants one row per — the word after "for each", "per" or "by".
 *
 * **Read from the question rather than inferred from scores**, because it is the one part of a
 * question that states the grain outright: "the average days in possession *for each transporter*"
 * groups by transporter however well `manifest_tracking_number` happens to match elsewhere. Without
 * it a question asking for one row per generator came back grouped by manifest — the right columns,
 * the wrong question.
 */
export function groupingWords(question) {
  const text = String(question ?? '').toLowerCase()
  const out = []
  const re = /(?:for each|with each|each|per|grouped by|by)\s+([a-z0-9_ ]{3,40})/g
  let m
  while ((m = re.exec(text))) {
    for (const w of m[1].split(/[^a-z0-9]+/).filter(Boolean)) {
      if (!STOPWORDS.has(w) && w.length > 2) out.push(singular(w))
    }
  }
  return out
}

/** Does this column's name or label carry one of the question's words? */
function columnScore(column, asked) {
  const haystack = `${column.column_id} ${column.label ?? ''}`.toLowerCase()
  const parts = haystack.split(/[^a-z0-9]+/).filter(Boolean).map(singular)
  let score = 0
  for (const raw of asked) {
    const word = singular(raw)
    if (parts.includes(word)) score += 3
    else if (haystack.includes(word)) score += 1
  }
  return score
}

function aggregateFor(question) {
  const text = String(question ?? '').toLowerCase()
  for (const agg of AGGREGATES) {
    if (agg.words.some((w) => text.includes(w))) return agg.fn
  }
  return null
}

/** Backticked, and split on the dot: BigQuery quotes each part, and quoting the whole
 *  `dataset.table` as one identifier is a name no warehouse has. */
const quoted = (tableRef) =>
  String(tableRef)
    .split('.')
    .map((part) => `\`${part}\``)
    .join('.')

/**
 * Compose the query for one question over one tenant's profiled tables.
 *
 * `tables` is `[{ ref, columns }]` — the caller resolves which tables the use case admits, because
 * that is the wizard's business and this module's job is only the query.
 */
export function questionSql(question, tables) {
  const asked = words(question)
  if (asked.length === 0) {
    return { sql: null, reason: 'This question carries no words that name anything in the schema.' }
  }
  if (!Array.isArray(tables) || tables.length === 0) {
    return {
      sql: null,
      reason:
        'No profiled table is in scope for this use case, so there is nothing to write a query ' +
        'against. Pick a structured source on step 2 and profile it in the Data Catalog.',
    }
  }

  /* The table whose columns the question reaches most. Ties go to the first, which is the order the
     use case's own picks are in — deterministic, so the same question always composes the same
     query rather than shifting between runs. */
  let best = null
  for (const table of tables) {
    const scored = (table.columns ?? [])
      .map((column) => ({ column, score: columnScore(column, asked) }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
    const total = scored.reduce((n, c) => n + c.score, 0)
    if (total > 0 && (best === null || total > best.total)) {
      best = { table, scored, total }
    }
  }

  if (best === null) {
    return {
      sql: null,
      reason:
        'No profiled column matches this question, so a query would have to name a table this ' +
        'tenant may not have. Write one yourself, or rephrase the question in the schema’s words.',
    }
  }

  const matched = best.scored.map((s) => s.column)
  const dimensions = matched.filter((c) => DIMENSION_CLASSES.has(c.class))
  const measures = matched.filter((c) => c.class === 'measure')
  const fn = aggregateFor(question)

  /* The column to group by: the best-matching dimension, or the table's own identifier where the
     question named no dimension — a GROUP BY has to name something, and the identifier is the one
     column every row of the table is distinguished by. */
  /* What the question said it wants one row per wins over what merely scored well — see
     `groupingWords`. Only a dimension can be grouped on, so a grain word naming a measure falls
     through rather than producing a GROUP BY over a number. */
  const grain = groupingWords(question)
  const named =
    grain.length > 0
      ? dimensions.find((c) =>
          `${c.column_id} ${c.label ?? ''}`
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(Boolean)
            .map(singular)
            .some((part) => grain.includes(part)),
        )
      : undefined
  const groupBy =
    named ??
    dimensions[0] ??
    (best.table.columns ?? []).find((c) => c.class === 'identifier') ??
    null

  const lines = []
  if (fn === 'COUNT') {
    /* Never the column being grouped by: counting the thing each row already is one of gives 1
       for every group, which is a query that looks right and answers nothing. */
    const counted =
      dimensions.find((c) => c !== groupBy) ?? measures[0] ?? matched.find((c) => c !== groupBy) ?? null
    const distinct = /distinct|unique/i.test(String(question))
    lines.push(
      `SELECT ${groupBy ? `${groupBy.column_id}, ` : ''}` +
        `COUNT(${distinct ? 'DISTINCT ' : ''}${counted ? counted.column_id : '*'}) AS ${
          distinct ? 'distinct_' : ''
        }${counted ? counted.column_id : 'row'}_count`,
    )
  } else if (fn && measures.length > 0) {
    const measure = measures[0]
    /* `SAFE_CAST` only where the profile says the column is a measure held as text — casting a
       column that is already numeric would be noise, and casting one that is not a measure would be
       this module deciding the schema is wrong. */
    const expr = NUMERIC_TYPES.test(measure.type ?? '')
      ? measure.column_id
      : `SAFE_CAST(${measure.column_id} AS FLOAT64)`
    lines.push(
      `SELECT ${groupBy ? `${groupBy.column_id}, ` : ''}${fn}(${expr}) AS ${fn.toLowerCase()}_${measure.column_id}`,
    )
  } else {
    /* No aggregate asked for, so the question wants rows. The columns it named, in the order the
       profile lists them — never `SELECT *`, which would claim the question is about every column. */
    const picked = matched.slice(0, 6).map((c) => c.column_id)
    lines.push(`SELECT ${picked.join(', ')}`)
  }

  lines.push(`FROM ${quoted(best.table.ref)}`)

  if (fn && fn !== 'COUNT' && groupBy) lines.push(`GROUP BY ${groupBy.column_id}`)
  else if (fn === 'COUNT' && groupBy) lines.push(`GROUP BY ${groupBy.column_id}`)

  if (fn && fn !== 'COUNT' && measures.length > 0) {
    lines.push(`ORDER BY 2 DESC NULLS LAST`)
  }
  lines.push('LIMIT 1000')

  return {
    sql: lines.join('\n'),
    reason: null,
    table: best.table.ref,
    /* Which columns it matched on — the falsifiable part, so a reader can check the query against
       the Catalog rather than taking it on trust. */
    columns: matched.slice(0, 6).map((c) => c.column_id),
  }
}
