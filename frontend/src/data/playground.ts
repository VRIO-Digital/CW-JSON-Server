import type { GoldenQuery, PlaygroundFile, PlaygroundMetric } from '../api/client'

/**
 * The Playground's words and its rules — **copy and pure functions, never markup.**
 *
 * Both halves are here for the reason `sourceActions.ts` and `connectSteps.ts` are: the Add and Edit
 * surfaces are `Modal`s, and a `Modal` portals out of `renderToString`, so a sentence written inside
 * one cannot be asserted at all. A refusal decided inside a component has the same problem one level
 * down — `renderToString` gives it its *initial* state, in which nobody has typed anything, so the
 * branch that matters is exactly the one a render never reaches. The same reasoning as
 * `datasetPathFix` and `askAvailability`.
 */

/* ---------------- what a row's provenance tag says ---------------- */

/**
 * **Three states, because the data holds three** — and the middle one is the reason this is a
 * function rather than a ternary on `source`.
 *
 * `source` is two-valued (`ai` / `user`) and cannot tell a measure that was read out of an attached
 * document from one the suggester ranked out of the tenant's pool: both are `ai`. `origin` is set by
 * the document pass and by nothing else, so a row without one is never *claimed* to have come from a
 * document — it says who drafted it, which is the only thing that is known about it.
 */
export function provenanceTag(row: { source: 'ai' | 'user'; origin?: 'document' | null }): string {
  if (row.origin === 'document') return 'FROM DOCUMENT'
  return row.source === 'user' ? 'MANUAL' : 'AI-DRAFTED'
}

export const playgroundCopy = {
  intro:
    'What this use case asked for, in the two forms a graph is asked to answer in. These are the ' +
    'brief’s own rows — the metrics accepted on step 4 of New Graph and the hero questions ' +
    'accepted on step 5 — so nothing here is a second list that could disagree with it. What the ' +
    'Playground adds is the query each one is answered by.',

  metrics: {
    heading: 'METRICS',
    add: 'Add metric',
    addTitle: 'Add a metric',
    editTitle: 'Edit this metric',
    nameLabel: 'Metric',
    namePlaceholder: 'What is being measured',
    descriptionLabel: 'What it means',
    descriptionPlaceholder: 'How this measure is defined — the sentence a reader checks it against.',
    sqlLabel: 'The query that answers it',
    sqlPlaceholder: 'SELECT …',
    /*
     * Says where to write one rather than only that there is none: an empty code block reads as a
     * query that failed to load, and a bare "none" leaves the reader looking for the control.
     *
     * **Rarely the sentence a reader sees**, and that is the point: the server composes a metric's
     * query where the brief carries none, so a row reaching this state is one nothing in the
     * profiled schema matched — and it prints the server's own `sqlNote` instead, which says *why*.
     * This is the fallback for a row that has no reason either, which is an older server.
     */
    noSql: 'No SQL yet — click edit to add it.',
    empty:
      'No metric has been accepted for this use case yet. Step 4 of New Graph is where they are ' +
      'drafted and accepted; anything added here is yours and is marked MANUAL.',
    deleteConfirm: 'Remove this metric from the use case?',
    /* What removing costs, stated where the act is rather than after it. */
    deleteDetail:
      'It goes from the brief, so the wizard stops listing it too. Accepting it again on step 4 ' +
      'brings a drafted one back; a metric you typed here is gone.',
  },

  queries: {
    heading: 'GOLDEN QUERIES',
    add: 'Add question',
    addTitle: 'Add a golden query',
    editTitle: 'Edit this golden query',
    textLabel: 'The question',
    textPlaceholder: 'Ask it the way a reader would ask it.',
    sqlLabel: 'The query that answers it',
    sqlPlaceholder: 'SELECT …',
    highLabel: 'High — this one is the graph’s contract',
    noSql: 'No SQL yet — click edit to add it.',
    empty:
      'No hero question has been accepted for this use case yet. Step 5 of New Graph is where they ' +
      'are drafted and accepted; anything added here is yours and is marked MANUAL.',
    deleteConfirm: 'Remove this golden query from the use case?',
    deleteDetail:
      'It goes from the brief, so the wizard stops listing it too — along with whatever SQL is ' +
      'written against it here.',
  },

  files: {
    heading: 'ATTACHED FILES',
    add: 'Upload',
    /*
     * **The whole of what an upload does, said where the control is.** Only the name travels: no
     * parser reads this file and no question is added from it, because questions invented out of a
     * file are exactly what a golden-query list must not hold. Saying so is what stops a reader
     * waiting for rows that are never coming.
     */
    note:
      'Only the filename is recorded — no bytes leave this browser and nothing is read out of the ' +
      'file, so no question is added from it. It is a note of what was supplied, beside the questions ' +
      'it was supplied for.',
    empty: 'Nothing attached yet.',
    deleteConfirm: 'Remove this attachment?',
  },
} as const

/* ---------------- the rules ---------------- */

/** How a file's row credits it, for a file nobody was signed in for. */
export const uploadedByLabel = (file: PlaygroundFile): string =>
  file.uploadedBy ?? 'nobody signed in'

/**
 * Why this metric cannot be added, or `null`.
 *
 * **Three refusals, and the cap is one of them.** The server truncates at its cap when it reads a
 * document and *refuses* a list longer than it here, so the page must refuse before it offers — a
 * row that vanished on save is the silent cut this repo refuses everywhere. `existing` is the name
 * being edited, so a metric never collides with itself.
 */
export function metricProblem(
  name: string,
  metrics: PlaygroundMetric[],
  cap: number,
  existing: string | null,
): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'A metric needs a name — it is what the list is read by.'
  const clash = metrics.some(
    (m) => m.name.toLowerCase() === trimmed.toLowerCase() && m.name !== existing,
  )
  if (clash) return `This use case already has a metric called “${trimmed}”.`
  if (existing === null && metrics.length >= cap) {
    return `A use case keeps at most ${cap} metrics. Remove one before adding another.`
  }
  return null
}

/** The same three, for a golden query. Compared on the text, which is what a question is. */
export function queryProblem(
  text: string,
  queries: GoldenQuery[],
  cap: number,
  existing: string | null,
): string | null {
  const trimmed = text.trim()
  if (!trimmed) return 'A golden query needs a question — the SQL is what answers it.'
  const clash = queries.some(
    (q) => q.text.toLowerCase() === trimmed.toLowerCase() && q.text !== existing,
  )
  if (clash) return 'This use case already asks that question.'
  if (existing === null && queries.length >= cap) {
    return `A use case keeps at most ${cap} golden queries. Remove one before adding another.`
  }
  return null
}

/** And for an attachment, where the only clash is the same filename twice. */
export function fileProblem(name: string, files: PlaygroundFile[], cap: number): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'That file has no name.'
  if (files.some((f) => f.name.toLowerCase() === trimmed.toLowerCase())) {
    return `“${trimmed}” is already attached.`
  }
  if (files.length >= cap) return `At most ${cap} files can be attached. Remove one first.`
  return null
}

/* ---------------- the list transforms ---------------- */

/**
 * Add or replace a metric, **in place where it is an edit.**
 *
 * Replacing in place rather than removing and appending is what keeps a corrected row where the
 * reader left it: a list that reorders itself on every edit is a list nobody can work down.
 */
export function withMetric(
  metrics: PlaygroundMetric[],
  next: PlaygroundMetric,
  existing: string | null,
): PlaygroundMetric[] {
  if (existing === null) return [...metrics, next]
  return metrics.map((m) => (m.name === existing ? next : m))
}

export const withoutMetric = (metrics: PlaygroundMetric[], name: string): PlaygroundMetric[] =>
  metrics.filter((m) => m.name !== name)

export function withQuery(
  queries: GoldenQuery[],
  next: GoldenQuery,
  existing: string | null,
): GoldenQuery[] {
  if (existing === null) return [...queries, next]
  return queries.map((q) => (q.text === existing ? next : q))
}

export const withoutQuery = (queries: GoldenQuery[], text: string): GoldenQuery[] =>
  queries.filter((q) => q.text !== text)

export const withoutFile = (files: PlaygroundFile[], name: string): PlaygroundFile[] =>
  files.filter((f) => f.name !== name)

/**
 * A metric typed here is the reader's own, so it is `user` and carries no origin.
 *
 * **Never `ai`, and never `origin: 'document'`** — crediting a model or a document with a sentence
 * somebody typed is the provenance lie `ProvenanceBadge` and `evidence_kind` exist to prevent, in
 * miniature.
 */
export const manualMetric = (
  name: string,
  description: string,
  sql: string,
): PlaygroundMetric => ({
  name: name.trim(),
  description: description.trim(),
  source: 'user',
  origin: null,
  sql: sql.trim() ? sql : null,
  /* The server's to say, never the page's: a metric typed here with no query gets one composed on
     the save's own reply, and a reason only where nothing matched. Claiming either from this side
     would be the client answering a question about the schema. */
  sqlNote: null,
})

export const manualQuery = (text: string, sql: string, high: boolean): GoldenQuery => ({
  text: text.trim(),
  priority: high ? 'high' : 'normal',
  source: 'user',
  sql: sql.trim() ? sql : null,
})
