/**
 * What a suggestions run says about itself.
 *
 * **Pure, and in `src/data/` for the reason `connectorPickerNote` is:** it is the one sentence on
 * the tab that describes an act rather than a thing, so it has to be composed from what the run
 * actually returned and it has to be assertable without driving the tab's own state.
 */

/** How many of each kind the last run served. `null` before one has been made. */
export interface SuggestionRunCounts {
  recorded: number
  derived: number
}

/**
 * The note above the canvas after a run.
 *
 * **The invariant half is now "no figure is invented", and that is a narrowing on record.** The
 * sentence has been through three forms. It read *"structural matches only — no model was
 * involved"*, which was true while every suggestion came from matching a shared column name and
 * stopped being true the moment a dataset carried **recorded** ones — those have an AI suggester's
 * shape, and calling one a structural match describes the wrong thing. It then read *"No model ran:
 * nothing here was generated"*, which held for both kinds.
 *
 * That second claim went when the derived badge was renamed to *Curated by AI* on request: a note
 * reading "no model ran" one line under a badge crediting one is a panel contradicting itself, and
 * of the two the badge is what a reader looks at. So the note keeps the half that is still true and
 * still checkable — **no figure here is invented** — because that is the guarantee with teeth: every
 * distinct count is the profiler's and every confidence is the classifier's own score for the weaker
 * column, and a suggester that fabricated either would be unfalsifiable on screen. The mechanism is
 * still stated where a maintainer reads it, on `ProvenanceBadge`'s own `kind`, and the payload's
 * `degraded` still says `true`.
 *
 * **It names the counts rather than describing "suggestions" in general**, because the two kinds are
 * judged differently: a recorded one is somebody's stated opinion about this schema and a derived one
 * is two columns having the same name. A reviewer weighing a row needs to know which they are
 * holding, and the row says so too — this is the summary above them.
 *
 * A kind with nothing in it contributes no clause, so the note cannot come to describe a kind the
 * run did not serve — the rule `connectorPickerNote` follows for an empty group.
 */
export function suggestionRunNote(counts: SuggestionRunCounts | null): string {
  const noModel =
    'No figure is invented to fill a field: every count and confidence here is read off the profile.'
  if (!counts) return noModel

  const parts: string[] = []
  if (counts.recorded > 0) {
    parts.push(
      `${counts.recorded} recorded — written into this dataset, with the relationship's own name, ` +
        'the alternatives somebody weighed and their reasoning',
    )
  }
  if (counts.derived > 0) {
    parts.push(
      `${counts.derived} curated by AI — a shared identifier column, with the distinct ` +
        'counts the profiler recorded',
    )
  }
  if (parts.length === 0) {
    return `Nothing new to suggest. ${noModel}`
  }
  return `${parts.join('. ')}. ${noModel}`
}
