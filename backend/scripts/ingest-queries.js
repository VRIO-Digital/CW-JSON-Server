/*
 * Ingest a query set (v2) into a dataset document's `ask_answers`, and add the hero
 * questions it names to that document's suggestion pool.
 *
 * v2 supersedes the 40-query set already in the document and says so in its own `_note`.
 * Two things are new, and both are why this is a script rather than an edit:
 *
 *  - **Gmail is a RUNTIME source.** Answers that need a reason read correspondence at
 *    question time and carry it as `observation` blocks. The set states the rule itself —
 *    *"Nothing it produces becomes a graph element. An extraction from a message is an
 *    OBSERVATION … resolved at question time and never merged into the fact set"* — which
 *    is why an observation is a block on an answer and never a node on the canvas.
 *  - **Every query carries `citations`**, the numbered source list rendered under an
 *    answer. `evidence` is preserved unchanged beside it, exactly as the set preserves it,
 *    because the server's citation fallback is derived from `evidence` and a dropped field
 *    would silently change what an older answer cites.
 *
 * **Nothing here is transcribed.** The persona *label*, its keywords and its domains are
 * read out of the document's own `graph_personas` by the slug the query carries, so a pool
 * entry cannot come to disagree with the persona list; the tenant is checked rather than
 * assumed; and the counts the set states about itself are recomputed and refused on a
 * mismatch. The alternative — a persona map typed into this file — is the transcription
 * problem in miniature: correct on the day it is written, stale at the next export.
 *
 * **It writes a file and only a file**, like every other ingest here, so the flow when the
 * server reads S3 is: run this, check the diff, `npm run db:push -- CAPEX`.
 *
 * Idempotent: run it again and it writes the same document.
 *
 *     node scripts/ingest-queries.js [CAPEX] [path/to/query_set_v2.json]
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const argDataset = (process.argv[2] ?? 'CAPEX').toUpperCase()
const ROOT = new URL('../../', import.meta.url)

const die = (msg) => {
  console.error(`ingest:queries — refusing to write.\n  ${msg}`)
  process.exit(1)
}

/*
 * The set's own location. Defaulted by *pattern* rather than by name because the file
 * arrives from a download — `query_set_v2 (1).json` is the name it actually had — and a
 * script that accepts only one spelling of it sends the reader to rename a file instead of
 * running the ingest. An explicit path always wins, and two candidates is a refusal rather
 * than a guess at which one was meant.
 */
function findQuerySet() {
  const explicit = process.argv[3]
  if (explicit) return explicit
  const dir = fileURLToPath(ROOT)
  const hits = readdirSync(dir).filter((f) => /^query_set_v2.*\.json$/i.test(f))
  if (hits.length === 1) return `${dir}${hits[0]}`
  die(
    hits.length === 0
      ? `no query_set_v2*.json in ${dir} — pass the path as the second argument`
      : `${hits.length} candidates in ${dir} (${hits.join(', ')}) — pass the one you mean`,
  )
}

/* The primary is `db.json`; every other dataset is `db.<NAME>.json` — the same naming
   `store.js`'s `localDocPath` uses, so this cannot address a document the server would not. */
const dbUrl = new URL(
  argDataset === 'EPA' ? 'backend/db.json' : `backend/db.${argDataset}.json`,
  ROOT,
)

const setPath = findQuerySet()
const set = JSON.parse(readFileSync(setPath, 'utf8'))
let db
try {
  db = JSON.parse(readFileSync(dbUrl, 'utf8'))
} catch (err) {
  die(`cannot read ${fileURLToPath(dbUrl)} — ${err.message}`)
}

/*
 * **The tenant has to match, and this is the check that matters most.**
 *
 * Serving one tenant's figures under another's name is the single failure the dataset split
 * exists to prevent, and it is invisible on screen: Northline's capital answers under EPA
 * would render perfectly. The document states its own tenant in `_meta`, the set states its
 * own, and nothing here proceeds on a guess. A document with no `_meta` is not a package
 * export, and is refused for that reason rather than waved through.
 */
if (!set.tenant) die(`${setPath} states no tenant`)
if (db._meta?.tenant !== set.tenant) {
  die(
    `${argDataset} is "${db._meta?.tenant ?? '(no _meta.tenant)'}" and the query set is ` +
      `"${set.tenant}" — pass the dataset whose tenant matches, or these answers land ` +
      `under another tenant's name`,
  )
}

const queries = Array.isArray(set.queries) ? set.queries : []
if (queries.length === 0) die(`${setPath} carries no queries`)

/* What the set says about itself, held against what it holds. A count that disagrees means
   the file was assembled from two runs, and every figure below is then a guess. */
if (set.counts?.total !== undefined && set.counts.total !== queries.length) {
  die(`the set declares counts.total ${set.counts.total} and carries ${queries.length} queries`)
}

/* --------------- personas: the document's own list is the authority --------------- */

const personaBySlug = new Map((db.graph_personas ?? []).map((p) => [p.persona_id, p]))
for (const q of queries) {
  if (!personaBySlug.has(q.persona)) {
    die(
      `${q.id} names persona "${q.persona}", which ${argDataset}'s graph_personas does not ` +
        `have (it has ${[...personaBySlug.keys()].join(', ')})`,
    )
  }
}

/* --------------- ask_answers --------------- */

/*
 * One recorded answer, in the shape `matchAskAnswer` already serves.
 *
 * `kind` is the set's `type`, because that is what the server calls it, and a `decline` is
 * read there to withhold a confidence — the set scores its own declines 0.99, which is
 * certainty that it *cannot* answer, and reporting that as an answer's confidence would
 * read as a 0.99 answer.
 */
const answers = queries.map((q) => {
  const persona = personaBySlug.get(q.persona)
  const blocks = q.response?.blocks
  if (!Array.isArray(blocks) || blocks.length === 0) die(`${q.id} has no response blocks`)
  if (typeof q.response?.summary !== 'string' || !q.response.summary.trim()) {
    die(`${q.id} has no summary — it is the line Ask prints as the answer`)
  }
  if (typeof q.confidence?.score !== 'number' || typeof q.confidence?.level !== 'string') {
    die(`${q.id} has no { level, score } confidence`)
  }
  return {
    answer_id: q.id,
    persona: persona.name,
    kind: q.type,
    question: q.question,
    hero_ref: q.hero_ref ?? null,
    summary: q.response.summary,
    blocks,
    evidence: q.evidence ?? [],
    confidence_level: q.confidence.level,
    confidence: q.confidence.score,
    graph_refs: q.graph_refs ?? [],
    /*
     * v2's own numbered source list, stored verbatim.
     *
     * Kept *beside* `evidence` rather than replacing it: the server derives citations from
     * `evidence` for any answer that states none, so dropping either field changes what an
     * answer cites without changing the answer. No per-row confidence is added here — the
     * set states one score for the whole answer, and a number per row would be invented.
     */
    citations: q.citations ?? [],
  }
})

/*
 * Every block type the set uses has to have a renderer, and an unknown one is refused
 * *here* rather than in the browser: the client validates every block, so an unhandled type
 * arrives as a `ValidationError` under a message telling the reader to restart the mock
 * server — which is not the fault and not the fix.
 */
const KNOWN_BLOCKS = new Set(['text', 'metric', 'chart', 'table', 'observation'])
for (const a of answers) {
  for (const b of a.blocks) {
    if (!KNOWN_BLOCKS.has(b.type)) {
      die(
        `${a.answer_id} carries a "${b.type}" block, which no renderer handles — add it to ` +
          `ANSWER_BLOCK in client.ts and to AnswerBlocks.tsx first`,
      )
    }
  }
}

/*
 * An observation is a *claim read from correspondence*, so it has to say who claimed it and
 * when. A row missing either is not an observation, it is an assertion with no source —
 * and the whole point of the block is that its rows are attributed and uncounted.
 */
for (const a of answers) {
  for (const b of a.blocks) {
    if (b.type !== 'observation') continue
    if (!Array.isArray(b.items) || b.items.length === 0) {
      die(`${a.answer_id} has an observation block with no items`)
    }
    for (const it of b.items) {
      for (const key of ['message_id', 'from_name', 'sent_at', 'claim']) {
        if (typeof it[key] !== 'string' || !it[key].trim()) {
          die(`${a.answer_id} observation item ${it.message_id ?? '(no id)'} has no ${key}`)
        }
      }
    }
  }
}

/* --------------- the hero question pool --------------- */

/*
 * **Added beside the package's own, never over them.**
 *
 * The existing entries carry the package's authored `rationale`, and the use-case template
 * names 13 of them by id — `validateDb` refuses a template naming a question the pool does
 * not have, so a rewrite that regenerated those 13 would fail the boot the moment one
 * derived string came out differently. This only fills gaps, which is the rule
 * `seed:workspaces` already follows for the demo package's own source and drive.
 */
const pool = [...(db.graph_hero_questions ?? [])]
const haveIds = new Set(pool.map((h) => h.question_id))

/*
 * A decline is answerable but never *suggested*.
 *
 * Asking one still returns the recorded refusal — that is what the set records it for — but
 * offering it as a hero question on step 5 would write a question into the brief that the
 * graph is on record as unable to answer, and a suggestion chip is a promise the brief
 * already made.
 */
const suggestable = queries.filter((q) => q.hero_ref && q.type !== 'decline')

let added = 0
for (const q of suggestable) {
  if (haveIds.has(q.hero_ref)) continue
  const persona = personaBySlug.get(q.persona)
  const sources = [
    ...new Set((q.evidence ?? []).map((e) => e.source).filter((s) => s && s !== '—')),
  ]
  pool.push({
    question_id: q.hero_ref,
    text: q.question,
    /* The persona's own, so a question cannot claim a domain its asker does not work in. */
    domains: persona.domains,
    keywords: persona.keywords,
    persona: persona.name,
    answer_id: q.id,
    /*
     * Worded the way the package words its own, and *derived*: which sources it resolves
     * across, and at what confidence. A question with no evidence rows says so rather than
     * claiming to resolve across nothing.
     */
    rationale:
      sources.length > 0
        ? `Resolves across ${sources.join(' + ')} at ${q.confidence.level.toLowerCase()} confidence (${q.confidence.score.toFixed(2)}).`
        : `Recorded answer ${q.id} at ${q.confidence.level.toLowerCase()} confidence (${q.confidence.score.toFixed(2)}).`,
  })
  haveIds.add(q.hero_ref)
  added += 1
}

/*
 * Every pool entry's `answer_id` has to resolve, or the question is a suggestion with no
 * recorded answer behind it — which reads as the graph declining a question it offered.
 */
const answerIds = new Set(answers.map((a) => a.answer_id))
for (const h of pool) {
  if (h.answer_id && !answerIds.has(h.answer_id)) {
    die(
      `hero question ${h.question_id} names answer ${h.answer_id}, which the set does not carry`,
    )
  }
}
/* And every id the template names still has to be in the pool, which is the boot check
   this script would otherwise be the thing to break. */
for (const t of db.graph_use_case_templates ?? []) {
  for (const id of t.hero_questions ?? []) {
    if (!haveIds.has(id)) {
      die(`template ${t.template_id} names hero question ${id}, which the pool would not have`)
    }
  }
}

/* --------------- write --------------- */

/*
 * Two keys replaced, the rest of the document carried through untouched.
 *
 * Spread rather than assembled, because `x = { … }` on a shared parent deletes everything
 * not listed — which is how `ingest-reports.js` nearly dropped every report audience.
 */
const next = { ...db, ask_answers: answers, graph_hero_questions: pool }

writeFileSync(dbUrl, `${JSON.stringify(next, null, 2)}\n`, 'utf8')

const byKind = answers.reduce((m, a) => ({ ...m, [a.kind]: (m[a.kind] ?? 0) + 1 }), {})
const observations = answers.reduce(
  (n, a) => n + a.blocks.filter((b) => b.type === 'observation').length,
  0,
)
const citations = answers.reduce((n, a) => n + a.citations.length, 0)

console.log(`ingest:queries — wrote ${fileURLToPath(dbUrl)}`)
console.log(`  from ${setPath} (v${set.version ?? '?'}, ${set.tenant})`)
console.log(
  `  ask_answers: ${answers.length} (${Object.entries(byKind)
    .map(([k, n]) => `${n} ${k}`)
    .join(' · ')})`,
)
console.log(`  observation blocks: ${observations} · citations: ${citations}`)
console.log(`  hero questions: ${pool.length} in the pool (${added} added, ${pool.length - added} kept)`)
console.log(`  next: check the diff, then npm run db:push -- ${argDataset}`)
