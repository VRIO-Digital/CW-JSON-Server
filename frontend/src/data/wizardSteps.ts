import type { DraftedItem, GraphSource, HeroQuestion, SourcePick } from '../api/client'

/**
 * Everything a step is judged on. One object rather than six signatures, so
 * adding a step's rule never changes a caller.
 */
export interface WizardDraft {
  name: string
  domainId: string | null
  personas: DraftedItem[]
  metrics: DraftedItem[]
  /** What step 4 can offer — its emptiness is a different problem to fix. */
  graphSources: GraphSource[]
  sourcePicks: SourcePick[]
  heroQuestions: HeroQuestion[]
}

/*
 * **`coverage` and `gapDecisions` were judged here and are not any more.** They fed the removed
 * step 6's build gate — every gap decided before building. The step went on request, so nothing
 * judges them; a brief that already carries gap decisions still keeps them (the page loads them and
 * sends them back untouched), and Ask still reads them as its standing caveats. What is gone is the
 * ability to make new ones, which is stated in CLAUDE.md rather than left to be discovered.
 */

/**
 * Why a step is not finished yet, or `null` when it is.
 *
 * The single definition of "complete" for the New Graph wizard: `Next`, the
 * stepper's lock and the build button all read this, so they cannot disagree
 * about whether a step is done. Lives outside the page for the same reason
 * `coverageIsDecided` does — it is assertable without a DOM.
 *
 * The message is shown to the user, so each one names the fix, not the rule.
 */
export function stepIssue(step: number, draft: WizardDraft): string | null {
  switch (step) {
    case 1:
      if (!draft.name.trim()) {
        return 'Name the use case — it is what your drafts list shows.'
      }
      if (!draft.domainId) return 'Pick a business domain before continuing.'
      return null

    case 2:
      if (draft.personas.length === 0) {
        return 'Add at least one persona — or use Suggest personas (LLM).'
      }
      return null

    case 3:
      if (draft.metrics.length === 0) {
        return 'Add at least one metric — the graph has to be able to compute something.'
      }
      return null

    /*
     * Step 4 is the one step that cannot be answered with nothing: every later
     * step derives from the data selected here, so advancing empty would build a
     * graph over no data at all. The four cases need four different fixes.
     */
    case 4:
      if (draft.graphSources.length === 0) {
        return 'Connect a data source on Sources first — there is nothing to select here yet.'
      }
      /*
       * **"Nothing profiled" has to mean nothing this step can use.**
       *
       * A runtime source is never profiled and never will be — Gmail has no profiler — so
       * testing profiled-ness alone refused a step whose one selectable source was sitting
       * right there, with advice (go and profile it) that nobody could carry out. The test
       * is whether any source has objects to point at, whichever way it got them.
       */
      if (!draft.graphSources.some((s) => s.objectCount > 0)) {
        return draft.graphSources.every((s) => s.runtime)
          ? 'No labels are in scope on the connected mailbox — reconnect it and pick at least one.'
          : 'Nothing is profiled yet — profile a source in the Data Catalog before continuing.'
      }
      if (draft.sourcePicks.length === 0) {
        return 'Select at least one source — the graph can only derive from data you point it at.'
      }
      {
        const emptyPick = draft.sourcePicks.find(
          (p) => p.mode === 'subset' && p.objects.length === 0,
        )
        if (emptyPick) {
          const source = draft.graphSources.find(
            (s) => s.sourceId === emptyPick.sourceId,
          )
          const unit = source?.unitLabel ?? 'tables'
          /* "all profiled labels" is not a thing a mailbox has, so the fix names the
             control the reader is actually looking at. */
          const all = source?.runtime ? `all ${unit}` : `all profiled ${unit}`
          return `Pick at least one ${unit.replace(/s$/, '')} for ${emptyPick.sourceId}, or switch it back to ${all}.`
        }
      }
      return null

    /*
     * **The last step, and therefore the build gate.** *Save & build graph* sits here now:
     * 'Entities & relationships' was step 6 and was removed on request, so nothing is judged after
     * the questions. What that step gated was the coverage review — every gap decided before
     * building — and that gate is gone with it, which is stated in CLAUDE.md rather than left to be
     * discovered. A brief with no hero question still cannot build: they are the contract.
     */
    case 5:
      if (draft.heroQuestions.length === 0) {
        return 'Add at least one hero question — they are the contract the graph is built against.'
      }
      return null

    default:
      return null
  }
}

/**
 * The first unfinished step at or before `upTo`, or `null` when all of them are
 * done. Used to answer "may I jump ahead?" — a step reached earlier can be made
 * incomplete again by deleting an answer behind it.
 */
export function firstIncompleteStep(
  upTo: number,
  draft: WizardDraft,
  from = 1,
): number | null {
  for (let step = from; step <= upTo; step += 1) {
    if (stepIssue(step, draft)) return step
  }
  return null
}
