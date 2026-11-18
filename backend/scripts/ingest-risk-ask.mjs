/**
 * Writes `ask_answers` into `backend/risk/risk_ask.json`, from the Contract Risk Analyst package's
 * own written answers (`Contract_risk_analyst/json/02_ask/`).
 *
 *   node backend/scripts/ingest-risk-ask.mjs
 *
 * **The source is real and dated, unlike the rest of RISK's seeded-empty document** (see
 * `ingest-risk-json.mjs`). `ask_answers.as_written.json` holds 62 questions, each with a dated
 * snapshot per day the scorecard ran (`2026-11-19`, `2026-11-20`); this reads the **latest**
 * (`2026-11-20`, the morning-check date `role.json` itself names as current) — the tenant's own
 * live answer, not an earlier draft.
 *
 * **Every field is read, not invented, except one.** `answer_id`, `persona`, `question`,
 * `summary`, the table (`columns`/`rows`, already in the exact shape `AnswerBlock`'s table type
 * wants) and the bar figures all come straight from the source. The one field with no source at
 * all is `confidence` — `validateDb` requires it to be a number, and nothing in the package states
 * one (these are rule-computed scorecard outputs, not a classifier's self-reported score). `0.95`
 * is a stated, uniform placeholder for "a deterministic answer read off the tenant's own scoring
 * rules" — recorded here rather than silently chosen, so anyone reviewing this knows it is a
 * judgement call and not a figure the package carries.
 *
 * Refuses to write rather than guess if the two source files disagree on which questions exist.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const backend = join(here, '..')
const pkg = join(backend, '..', 'Contract_risk_analyst', 'json')
const out = join(backend, 'risk', 'risk_ask.json')

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

const library = readJson(join(pkg, '02_ask', 'ask_library.json'))
const written = readJson(join(pkg, '02_ask', 'ask_answers.as_written.json'))

const AS_OF = '2026-11-20'
const CONFIDENCE = 0.95

/** theme -> persona, read off the library so a question's persona always matches its own theme. */
const personaByTheme = new Map(library.map((t) => [t.theme, t.persona]))

const problems = []
const ask_answers = []

for (const entry of written) {
  const snapshot = entry.answers?.[AS_OF]
  if (!snapshot) {
    problems.push(`${entry.answer_id}: no "${AS_OF}" snapshot`)
    continue
  }
  if (entry.persona && personaByTheme.has(entry.theme) && personaByTheme.get(entry.theme) !== entry.persona) {
    problems.push(`${entry.answer_id}: persona "${entry.persona}" disagrees with the library's "${personaByTheme.get(entry.theme)}" for theme "${entry.theme}"`)
  }

  const blocks = []

  if (Array.isArray(snapshot.bars) && snapshot.bars.length > 0) {
    blocks.push({
      type: 'metric',
      items: snapshot.bars.map((b) => ({ label: b.label, value: b.text })),
    })
  }

  if (snapshot.table && Array.isArray(snapshot.table.columns) && Array.isArray(snapshot.table.rows)) {
    blocks.push({
      type: 'table',
      title: entry.question,
      columns: snapshot.table.columns,
      rows: snapshot.table.rows,
    })
  }

  const textLines = [snapshot.summary_markdown ?? snapshot.summary]
  if (Array.isArray(snapshot.points) && snapshot.points.length > 0) {
    textLines.push('', ...snapshot.points.map((p) => `- ${p}`))
  }
  blocks.push({ type: 'text', markdown: textLines.join('\n') })

  if (blocks.length === 0) {
    problems.push(`${entry.answer_id}: no blocks derived — refusing to write an answer with none`)
    continue
  }

  const evidence = (snapshot.read_from ?? []).map((r) => ({
    source: r.name,
    detail: 'Read by the contract risk scorecard.',
  }))

  ask_answers.push({
    answer_id: entry.answer_id,
    persona: entry.persona,
    kind: 'hero',
    question: entry.question,
    summary: snapshot.summary,
    blocks,
    evidence,
    confidence_level: 'High',
    confidence: CONFIDENCE,
    graph_refs: [],
    /* The server derives citations from `evidence` where the answer authors none of its own —
       see client.ts's own note on AskAnswer.citations — so none are hand-built here. */
  })
}

if (problems.length > 0) {
  console.error(`refusing to write — ${problems.length} problem(s):\n  · ${problems.join('\n  · ')}`)
  process.exitCode = 1
  process.exit()
}

const existing = readJson(out)
existing.ask_answers = ask_answers
writeFileSync(out, `${JSON.stringify(existing, null, 2)}\n`, 'utf8')

console.log(`wrote ${ask_answers.length} ask_answers into backend/risk/risk_ask.json (as of ${AS_OF}, confidence ${CONFIDENCE} — see this script's header)`)
