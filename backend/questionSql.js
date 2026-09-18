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

/**
 * Words that carry no signal about which column a question is about.
 *
 * **The filler half matters more than it looks**, and it was missing. `columnScore` reads the
 * tenant's own description of a column as well as its name, and a description is a *sentence* — so
 * "Which explanations **came** from correspondence **rather than** from a person?" scored three
 * points against every long description containing the words "came", "rather" or "than", which is
 * most of them. The widest table won on filler alone. A word that no schema would ever be written in
 * is not evidence about which table answers a question.
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'for', 'to', 'and', 'or', 'is', 'are', 'was', 'were',
  'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how', 'many', 'much',
  'do', 'does', 'did', 'has', 'have', 'had', 'be', 'been', 'by', 'with', 'from', 'at', 'as',
  'each', 'all', 'any', 'across', 'per', 'their', 'this', 'that', 'these', 'those', 'our',
  'us', 'we', 'it', 'its', 'most', 'least', 'more', 'less', 'over', 'under', 'into', 'out',
  /* Asking words — how a reader opens a question, never how a column is named. */
  'show', 'tell', 'give', 'list', 'find', 'get', 'see', 'let', 'want', 'need', 'please',
  'me', 'my', 'you', 'your', 'them', 'they', 'him', 'her', 'his',
  /* Filler and connectives — the ones that were scoring against descriptions. */
  'came', 'come', 'comes', 'coming', 'rather', 'than', 'then', 'there', 'here', 'about',
  'also', 'still', 'yet', 'not', 'no', 'nor', 'but', 'so', 'if', 'else', 'while', 'during',
  'would', 'should', 'could', 'will', 'shall', 'may', 'might', 'must', 'can',
  'same', 'other', 'others', 'another', 'both', 'either', 'neither', 'only', 'just', 'very',
  'such', 'some', 'every', 'one', 'two', 'thing', 'things', 'something', 'anything',
  'been', 'being', 'having', 'doing', 'make', 'makes', 'made', 'use', 'used', 'using',
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

/**
 * Classes that identify or group a row — the left-hand side of a GROUP BY.
 *
 * **Both datasets' vocabularies, because a class is one document's fact.** EPA profiles a place as
 * `geo` and CAPEX as `geography`; CAPEX also has `organisation` and `lifecycle_state`, which EPA has
 * no counterpart for. A set written against one document silently stops finding dimensions in the
 * other: "the total forecast by region" fell through to grouping by `Project Code`, which is the
 * right shape and the wrong question. The same fault as `rows: num` — a declaration checked against
 * the one document that happens not to exercise it.
 */
const DIMENSION_CLASSES = new Set([
  'identifier', 'dimension', 'entity', 'label', 'classification', 'person', 'address', 'flag',
  'geo', 'geography', 'organisation', 'lifecycle_state',
])

/**
 * Is this class a quantity an aggregate may be taken over?
 *
 * A prefix rather than a list, because CAPEX names its measures by what they measure —
 * `measure_commitment`, `measure_projection`, `measure_record` — and a set naming only `measure`
 * found none of them, so no CAPEX question ever composed a SUM.
 *
 * **`derived_ratio` is deliberately not one**, though it is a number and looks like a measure: the
 * sum of sixty variance percentages is not the population's variance, and its mean is not either
 * unless every project is the same size. That is the rule the report section already states for
 * `m_variance_pct`, applied where a query would otherwise be composed to break it.
 */
const isMeasureClass = (cls) => /^measure/.test(String(cls)) || cls === 'period_accumulation'

/** Types that can be aggregated arithmetically. A `STRING` holding digits is not one of them — the
 *  query casts it explicitly where the profile says it is a measure, which is what `SAFE_CAST` is
 *  for and why it is not applied to everything. */
const NUMERIC_TYPES = /^(INTEGER|INT64|NUMERIC|FLOAT|FLOAT64|BIGNUMERIC|DECIMAL)/i

/** How many columns a row-returning query projects. It is also what a table is *ranked* on, because
 *  the columns past it never reach the query — see `questionSql`. */
const PROJECTION_MAX = 6

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

/**
 * **The words a reader asks in, mapped to the words a schema is written in.**
 *
 * A question says *explanations* and the column is called `Comment`; it says *correspondence* and
 * the column is `Source System`. Matching names alone, those reach nothing and the question is
 * refused — which is right when the tenant genuinely has no such column and wrong here, where it has
 * exactly the columns being asked about. Reported from use, on a CAPEX brief where three of the
 * tenant's own questions came back with no query over a schema that answers all three.
 *
 * **It reaches a real column and never invents one.** Every identifier in the output is still read
 * out of `column_profiles`; what this changes is which real column a question is found to be about.
 * A synonym is weaker evidence than the reader's own word, so it **scores lower** — and the query
 * names the column it settled on, which is the check: a reader who disagrees that *explanation*
 * means `Comment` can see that it did, and rewrite the query.
 *
 * Keyed on singular forms, because `singular()` folds the asked word before the lookup. One place,
 * recorded, in the manner of `AGGREGATES` and `DIMENSION_CLASSES` above.
 */
const SYNONYMS = {
  /* what a row says in prose */
  explanation: ['comment', 'note', 'reason', 'remark', 'narrative', 'justification', 'description', 'text'],
  explain: ['comment', 'note', 'reason', 'remark', 'narrative', 'justification', 'description', 'text'],
  rationale: ['comment', 'note', 'reason', 'justification', 'narrative', 'description'],
  justification: ['comment', 'note', 'reason', 'justification', 'narrative'],
  reasoning: ['comment', 'note', 'reason', 'justification'],
  message: ['comment', 'note', 'text', 'message', 'mail', 'email'],
  /* where a row came from */
  correspondence: ['source', 'system', 'mail', 'email', 'correspondence', 'channel', 'sender'],
  email: ['email', 'mail', 'source', 'contact'],
  mail: ['mail', 'email', 'source'],
  origin: ['source', 'system', 'origin'],
  system: ['system', 'source', 'origin'],
  /* who */
  person: ['person', 'name', 'owner', 'manager', 'author', 'prepared', 'reviewed', 'submitted', 'approver', 'contact', 'signature'],
  people: ['person', 'name', 'owner', 'manager', 'author', 'prepared', 'reviewed', 'contact'],
  human: ['person', 'name', 'owner', 'manager', 'author', 'prepared', 'reviewed'],
  owner: ['owner', 'manager', 'person', 'name', 'contact', 'prepared'],
  author: ['author', 'prepared', 'owner', 'person', 'name'],
  approver: ['approver', 'approved', 'reviewed', 'person', 'name'],
  /* organisations */
  vendor: ['vendor', 'supplier', 'contractor', 'counterparty', 'entity', 'organisation'],
  supplier: ['vendor', 'supplier', 'contractor', 'counterparty', 'entity'],
  contractor: ['contractor', 'counterparty', 'vendor', 'supplier', 'entity'],
  /* money */
  cost: ['cost', 'amount', 'spend', 'budget', 'actual', 'forecast', 'price', 'value', 'capital'],
  spend: ['spend', 'actual', 'amount', 'cost', 'capital'],
  money: ['amount', 'cost', 'budget', 'value', 'price', 'capital'],
  price: ['price', 'amount', 'cost', 'value'],
  budget: ['budget', 'plan', 'commitment', 'authorized', 'approved', 'amount'],
  /* movement */
  change: ['change', 'variation', 'movement', 'override', 'revision', 'adjustment', 'order'],
  variation: ['variation', 'change', 'movement', 'adjustment'],
  overrun: ['overrun', 'variance', 'movement', 'over'],
  /* time */
  date: ['date', 'month', 'year', 'period', 'day', 'vintage'],
  timing: ['date', 'month', 'year', 'period', 'schedule'],
  schedule: ['schedule', 'date', 'period', 'calendar', 'phase'],
  /* state */
  status: ['status', 'state', 'phase', 'stage', 'gate', 'flag'],
  stage: ['stage', 'phase', 'gate', 'status'],
  /* place */
  region: ['region', 'location', 'site', 'area', 'geography', 'unit'],
  location: ['location', 'region', 'site', 'address', 'area'],
  site: ['site', 'location', 'region', 'address'],
  /* filings */
  document: ['document', 'contract', 'file', 'form', 'paper', 'title'],
  contract: ['contract', 'document', 'agreement', 'award', 'form'],
  /* judgement */
  risk: ['risk', 'driver', 'exposure', 'confidence', 'severity'],
}

/** Word-split and singularised, the one way, so a name, a label and a description are all read the
 *  same. */
const partsOf = (text) =>
  String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(singular)

/**
 * How strongly this column answers the question's words.
 *
 * **Four signals, and they are deliberately not equal.** The reader's own word in the column's
 * *name* is the strongest thing there is; the same word in the sentence the tenant wrote *about* the
 * column is real evidence and weaker; and a vocabulary match is this module's reading of what the
 * reader meant, so it is weaker still. Scoring them the same would let a description mentioning
 * "project" in passing beat a column actually called `Project Code`.
 *
 * Each asked word contributes **once**, through the best signal it has — a word that matches the
 * name and the description is one reason, not two.
 */
export function columnMatch(column, asked) {
  const haystack = `${column.column_id} ${column.label ?? ''}`.toLowerCase()
  const parts = partsOf(haystack)
  /* The tenant's own sentence about this column. Read rather than authored here, which is what
     makes it evidence at all — and why it is scored above the vocabulary below it. */
  const described = partsOf(column.description)
  let score = 0
  /* **What this column contributes per asked word**, not just its total — so a *table* can be ranked
     by how well it answers each part of the question rather than by how many columns happen to brush
     against it. See `questionSql`. */
  const hits = new Map()
  for (const raw of asked) {
    const word = singular(raw)
    /*
     * Five tiers, and the split inside the vocabulary tier is load-bearing. A column *named*
     * `Comment` is what a reader asking about explanations means; one whose description merely
     * contains the word "text" is a much weaker reading of the same question. Scored equally, six
     * weak hits beat six strong ones and the widest table wins again by a different route — which
     * is what happened: `plan_project_forecast` (`Comment`, `Source System`, `Prepared By`) tied
     * with a view whose five "Free-text driver statement" descriptions each scored the same.
     */
    let gained = 0
    if (parts.includes(word)) gained = 4
    else if (haystack.includes(word)) gained = 2
    else if (described.includes(word)) gained = 2
    else {
      const meanings = SYNONYMS[word] ?? []
      if (meanings.some((m) => parts.includes(singular(m)))) gained = 2
      else if (meanings.some((m) => described.includes(singular(m)))) gained = 1
    }
    if (gained > 0) {
      score += gained
      hits.set(word, gained)
    }
  }
  return { score, hits }
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
 * A column, quoted **where it needs to be** — which for this tenant is most of them.
 *
 * CAPEX's cube columns are called `Project Code` and `Phase Order`, and a bare `SELECT Phase Order`
 * is two identifiers rather than one: the query is not merely ugly, it does not parse. It shipped
 * that way, which is the failure this whole module exists to prevent one level down — a query that
 * reads as an answer and fails only when somebody runs it.
 *
 * Quoted only when the name is not a plain identifier, so EPA's `generator_id` stays readable.
 */
const col = (name) =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name)) ? String(name) : `\`${String(name)}\``

/**
 * An alias for a computed column, as a name a warehouse will accept.
 *
 * `AS sum_Forecast Amount` is broken in exactly the way a bare column name is, and the aggregate
 * path is where this bites: the alias is *composed* here rather than read, so it is the one
 * identifier in the output this module owns and must therefore get right.
 */
const alias = (prefix, name) =>
  `${prefix}_${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`

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

  /*
   * The table that answers most of the question — **ranked by how much of it the table covers, and
   * only then by how strongly.**
   *
   * Summing every matching column's score was the obvious rule and the wrong one: it makes the
   * *widest* table win every question, because a 96-column view accumulates more total score than a
   * 22-column one that matches better per column. Reported from use — every CAPEX question composed
   * against `vw_project_plan_capex`, including one whose three words are each a column of
   * `plan_project_forecast`. A table reaching *explanation* and *correspondence* and *person*
   * answers the question; one reaching *person* six times does not.
   *
   * So: **how many of the question's words the table reaches**, then **how well it reaches each
   * one** — the best score any single column achieves for that word, summed. That second measure is
   * the one that cannot be gamed by width, because an extra column only helps if it answers some
   * part of the question *better* than everything already there. Summing the top six columns instead
   * still let a 96-column view win on six glancing description hits over a table whose six columns
   * are each named for exactly what was asked.
   *
   * Ties go to the first table, which is the order the use case's own picks are in: deterministic,
   * so the same question always composes the same query rather than shifting between runs.
   */
  let best = null
  for (const table of tables) {
    const scored = (table.columns ?? [])
      .map((column) => ({ column, ...columnMatch(column, asked) }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
    if (scored.length === 0) continue
    const bestPerWord = new Map()
    for (const c of scored) {
      for (const [word, gained] of c.hits) {
        bestPerWord.set(word, Math.max(bestPerWord.get(word) ?? 0, gained))
      }
    }
    const covered = bestPerWord.size
    const strength = [...bestPerWord.values()].reduce((n, g) => n + g, 0)
    const better =
      best === null ||
      covered > best.covered ||
      (covered === best.covered && strength > best.strength)
    if (better) best = { table, scored, covered, strength }
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
  const measures = matched.filter((c) => isMeasureClass(c.class))
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
  /* **Whether the SELECT actually aggregates**, which is what licenses a GROUP BY. A question saying
     "total" with no measure in reach falls through to the row branch, and emitting GROUP BY beside a
     bare projection is not merely odd — it does not parse. */
  let aggregated = false
  if (fn === 'COUNT') {
    aggregated = true
    /* Never the column being grouped by: counting the thing each row already is one of gives 1
       for every group, which is a query that looks right and answers nothing. */
    const counted =
      dimensions.find((c) => c !== groupBy) ?? measures[0] ?? matched.find((c) => c !== groupBy) ?? null
    const distinct = /distinct|unique/i.test(String(question))
    lines.push(
      `SELECT ${groupBy ? `${col(groupBy.column_id)}, ` : ''}` +
        `COUNT(${distinct ? 'DISTINCT ' : ''}${counted ? col(counted.column_id) : '*'}) AS ` +
        alias(distinct ? 'distinct' : 'count', counted ? `${counted.column_id}_count` : 'row_count'),
    )
  } else if (fn && measures.length > 0) {
    aggregated = true
    const measure = measures[0]
    /* `SAFE_CAST` only where the profile says the column is a measure held as text — casting a
       column that is already numeric would be noise, and casting one that is not a measure would be
       this module deciding the schema is wrong. */
    const expr = NUMERIC_TYPES.test(measure.type ?? '')
      ? col(measure.column_id)
      : `SAFE_CAST(${col(measure.column_id)} AS FLOAT64)`
    lines.push(
      `SELECT ${groupBy ? `${col(groupBy.column_id)}, ` : ''}${fn}(${expr}) AS ${alias(fn.toLowerCase(), measure.column_id)}`,
    )
  } else {
    /* No aggregate asked for, so the question wants rows. The columns it named, in the order the
       profile lists them — never `SELECT *`, which would claim the question is about every column. */
    const picked = matched.slice(0, PROJECTION_MAX).map((c) => col(c.column_id))
    lines.push(`SELECT ${picked.join(', ')}`)
  }

  lines.push(`FROM ${quoted(best.table.ref)}`)

  if (groupBy && aggregated) lines.push(`GROUP BY ${col(groupBy.column_id)}`)

  /* `ORDER BY 2` names the second selected column, so it needs there to be one: with no dimension to
     group by the SELECT is a single aggregate, and ordering by an ordinal past the end does not
     parse. Gated on the grouping rather than on the aggregate for exactly that reason. */
  if (aggregated && fn !== 'COUNT' && groupBy && measures.length > 0) {
    lines.push('ORDER BY 2 DESC NULLS LAST')
  }
  lines.push('LIMIT 1000')

  return {
    sql: lines.join('\n'),
    reason: null,
    table: best.table.ref,
    /* Which columns it matched on — the falsifiable part, so a reader can check the query against
       the Catalog rather than taking it on trust. */
    columns: matched.slice(0, PROJECTION_MAX).map((c) => c.column_id),
  }
}
