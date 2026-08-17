import type {
  CoveragePayload,
  DraftedItem,
  GapChoice,
  GraphSource,
  HeroQuestion,
  SourcePick,
} from '../api/client'
import { coverageIsDecided } from './coverage'

/**
 * Everything a step is judged on. One object rather than six signatures, so
 * adding a step's rule never changes a caller.
 */
export interface WizardDraft {
  name: string
  domainId: string | null
  personas: DraftedItem[]
  kpis: DraftedItem[]
  /** What step 4 can offer — its emptiness is a different problem to fix. */
  graphSources: GraphSource[]
  sourcePicks: SourcePick[]
  heroQuestions: HeroQuestion[]
  coverage: CoveragePayload | null
  gapDecisions: GapChoice[]
}

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
      if (draft.kpis.length === 0) {
        return 'Add at least one KPI — the graph has to be able to compute something.'
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
      if (!draft.graphSources.some((s) => s.objectCount > 0)) {
        return 'Nothing is profiled yet — profile a source in the Data Catalogue before continuing.'
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
          return `Pick at least one ${unit.replace(/s$/, '')} for ${emptyPick.sourceId}, or switch it back to all profiled ${unit}.`
        }
      }
      return null

    case 5:
      if (draft.heroQuestions.length === 0) {
        return 'Add at least one hero question — they are the contract the graph is built against.'
      }
      return null

    /*
     * The build gate, and the last step — it was 7 while 'Answer requirements' sat at
     * 6. That step is gone: citations and the render format are chosen per question on
     * Ask, so nothing between hero questions and the coverage review is judged here.
     */
    case 6:
      if (!coverageIsDecided(draft.coverage, draft.gapDecisions)) {
        return 'Decide every gap in the review before building.'
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
