/**
 * Replays `questionSql.js` against both shipped documents, with nothing running.
 *
 * **The composer is pure, which is what makes this possible** — the same arrangement
 * `verify-studio-lanes.js` and `verify-report-export.js` have. Its own docstring has promised this
 * script since it was written; it did not exist, so the one guarantee the module rests on was
 * checked by typing a question into a wizard and looking at the box.
 *
 * **What it asserts is the promise, not the prose.** The module's claim is that *every identifier in
 * the output is read rather than invented* — so the central check here re-parses each composed query
 * and holds every name in it against `column_profiles` for the table it names. A query naming a
 * column the warehouse does not have is worse than no query: it reads as an answer and fails only
 * when somebody runs it, which is precisely the failure nobody sees until a demo.
 *
 * The rest are the ways a *composed* query can be wrong while still looking right: an identifier
 * with a space in it that was never quoted (`SELECT Phase Order` is two names, and it shipped), a
 * GROUP BY beside a projection that does not aggregate, an `ORDER BY 2` over a single selected
 * expression, and a SUM taken over a ratio. Each of those parses as English and not as SQL.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { questionSql, words } from '../questionSql.js'

const backend = dirname(dirname(fileURLToPath(import.meta.url)))
const problems = []
let checks = 0

const ok = (label, detail = '') => {
  checks += 1
  console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`)
}
const expect = (label, condition, detail = '') => {
  if (condition) return ok(label, detail)
  checks += 1
  problems.push(`FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
}

const read = (file) => JSON.parse(readFileSync(join(backend, file), 'utf8'))

/**
 * Every identifier a composed query names, as written.
 *
 * Backticked names come out whole; bare ones are the single words left over. The point of taking
 * both is that an unquoted `Phase Order` arrives here as `Phase` and `Order` — neither of which is a
 * column — which is exactly how the check catches a name that needed quoting and did not get it.
 */
function identifiers(sql) {
  const out = []
  /* Everything after SELECT and before FROM, plus the GROUP BY tail: the parts that name columns. */
  const select = /SELECT\s+([\s\S]*?)\s+FROM/i.exec(sql)?.[1] ?? ''
  const group = /GROUP BY\s+(.+)/i.exec(sql)?.[1] ?? ''
  const region = `${select} ${group}`
  const quoted = [...region.matchAll(/`([^`]+)`/g)].map((m) => m[1])
  /* Strip the quoted spans, the aggregate calls, the SAFE_CAST types and the aliases this module
     composes itself — what is left is any bare identifier the query relied on. */
  const bare = region
    .replace(/`[^`]+`/g, ' ')
    .replace(/\bAS\s+[a-z0-9_]+/gi, ' ')
    .replace(/\b(SELECT|FROM|COUNT|DISTINCT|SUM|AVG|MIN|MAX|SAFE_CAST|FLOAT64|GROUP|BY)\b/gi, ' ')
    .split(/[^A-Za-z0-9_]+/)
    .filter(Boolean)
  out.push(...quoted, ...bare)
  return out
}

const PROBES = [
  /* The question this whole pass was written for: three words, none of which is a column name, all
     three of which the tenant has a column for. */
  'Which explanations came from correspondence rather than from a person?',
  'Show me the change orders with the message that explains each one.',
  'Who prepared the latest forecast for each project?',
  'What is the total forecast by region?',
  'How many projects are there per business unit?',
  'What is the average contract price?',
  'Which projects are over budget?',
  /* Aims an aggregate straight at a ratio, so the "no aggregate over a derived ratio" check below
     has something to be about. Without it that check passed over nothing — found by breaking it,
     which is the only way a vacuous assertion ever announces itself. */
  'What is the total calendarization percent by project?',
  'What is the average seasonality factor for each region?',
]

for (const file of ['db.json', 'db.CAPEX.json']) {
  const db = read(file)
  const tables = Object.entries(db.column_profiles ?? {}).map(([ref, columns]) => ({ ref, columns }))
  console.log(`\n${file} — ${tables.length} profiled tables`)

  const asked = [
    ...(db.graph_use_cases ?? []).flatMap((u) => (u.hero_questions ?? []).map((q) => q.text)),
    ...PROBES,
  ]

  let composed = 0
  let refused = 0
  for (const question of asked) {
    const result = questionSql(question, tables)
    if (!result.sql) {
      refused += 1
      /* A refusal is a first-class answer and must still say why — an empty box with no sentence is
         the state this module exists to replace. */
      expect(
        'a refusal states its reason',
        typeof result.reason === 'string' && result.reason.length > 20,
        question.slice(0, 48),
      )
      continue
    }
    composed += 1

    const table = tables.find((t) => t.ref === result.table)
    expect(
      'the table named is one that was offered',
      table !== undefined,
      `${result.table} · ${question.slice(0, 40)}`,
    )
    if (!table) continue

    /*
     * **The promise, checked.** Every name the query relies on has to be a column this document
     * really profiles against that table.
     */
    const known = new Set(table.columns.map((c) => c.column_id))
    const unknown = identifiers(result.sql).filter((name) => !known.has(name))
    expect(
      'every identifier in the query is a column of that table',
      unknown.length === 0,
      unknown.length ? `invented: ${unknown.join(', ')} in ${result.table}` : `${question.slice(0, 40)}`,
    )

    /* A name that needed quoting and did not get it — the `SELECT Phase Order` failure, which is the
       way this can produce something that is not SQL at all while looking fine in a box. */
    const unquoted = [...known].filter(
      (name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && new RegExp(`(^|[^\`])\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(result.sql) && !result.sql.includes(`\`${name}\``),
    )
    expect('a name that needs quoting is quoted', unquoted.length === 0, unquoted.join(', '))

    /* A GROUP BY beside a projection that does not aggregate does not parse. */
    const aggregates = /\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(result.sql)
    expect(
      'GROUP BY appears only beside an aggregate',
      !/GROUP BY/i.test(result.sql) || aggregates,
      question.slice(0, 40),
    )
    /* `ORDER BY 2` names the second selected expression, so there has to be one. */
    const selected = (/SELECT\s+([\s\S]*?)\s+FROM/i.exec(result.sql)?.[1] ?? '')
      .split(/,(?![^(]*\))/)
      .filter((s) => s.trim()).length
    expect(
      'ORDER BY 2 has a second selected expression to name',
      !/ORDER BY 2/i.test(result.sql) || selected >= 2,
      question.slice(0, 40),
    )

    /* A ratio is a number and is not a quantity: the sum of sixty variance percentages is not the
       population's variance. The report section states this rule; a composer that breaks it produces
       a figure nobody can defend. */
    const summedRatio = table.columns.filter(
      (c) => c.class === 'derived_ratio' && new RegExp(`(SUM|AVG)\\(\`?${c.column_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(result.sql),
    )
    expect(
      'no aggregate is taken over a derived ratio',
      summedRatio.length === 0,
      summedRatio.map((c) => c.column_id).join(', '),
    )

    /* Deterministic: the same question must always compose the same query, or a brief reopened next
       week shows a different one with nothing having changed. */
    expect(
      'the same question composes the same query twice',
      questionSql(question, tables).sql === result.sql,
      question.slice(0, 40),
    )
  }
  ok(`${composed} composed, ${refused} refused`, `${asked.length} questions`)

  /*
   * **The reported case, pinned.**
   *
   * "Which explanations came from correspondence rather than from a person?" is the question that
   * came back with no query at all, over a schema holding a column for each of its three words. It
   * is checked here on what the query *covers* rather than on which table it happens to name — a
   * table name would go stale the moment the tenant re-profiles, while "the query reaches an
   * explanation, a source and a person" is the thing that was actually wrong.
   *
   * It is pinned because the two rules that fix it are both invisible when broken: reverting the
   * table ranking to a sum over every matched column puts the widest view back on top, and every
   * identifier in *that* query is real too — so nothing above this catches it. Found by breaking it.
   */
  if (file === 'db.CAPEX.json') {
    const reported = questionSql(
      'Which explanations came from correspondence rather than from a person?',
      tables,
    )
    const chosen = tables.find((t) => t.ref === reported.table)
    const projected = (reported.columns ?? []).map((id) =>
      (chosen?.columns ?? []).find((c) => c.column_id === id),
    )
    const covers = (test) => projected.some((c) => c && test(c))
    expect(
      'the reported question composes a query at all',
      Boolean(reported.sql),
      reported.sql ? reported.table : `refused: ${reported.reason}`,
    )
    expect(
      'and it reaches an explanation, a source and a person',
      covers((c) => /comment|note|description|reason/i.test(c.column_id)) &&
        covers((c) => /source|system|mail|email/i.test(c.column_id)) &&
        covers((c) => c.class === 'person'),
      (reported.columns ?? []).join(', '),
    )
  }

  /* **Widening the matcher must not remove the refusal**, which is the rule the whole module rests
     on: a question naming nothing this tenant has still gets no query rather than a plausible one. */
  const nonsense = questionSql('Zqx wibble frobnicator plinth?', tables)
  expect(
    'a question naming nothing still refuses',
    nonsense.sql === null && /No profiled column matches/.test(nonsense.reason ?? ''),
    nonsense.sql ? `composed: ${nonsense.sql.split('\n')[0]}` : 'refused',
  )
}

/* The two refusals that need no document at all. */
expect('a question of only stopwords refuses', questionSql('What is it?', []).sql === null)
expect(
  'and so does a question with no tables in scope',
  questionSql('Which projects are over budget?', []).sql === null,
)
expect(
  'filler words are not treated as schema words',
  words('Which explanations came from correspondence rather than from a person?').join(',') ===
    'explanations,correspondence,person',
  words('Which explanations came from correspondence rather than from a person?').join(', '),
)

console.log(`\nverify:question-sql — ${checks} checks, ${problems.length} failed`)
if (problems.length > 0) {
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
