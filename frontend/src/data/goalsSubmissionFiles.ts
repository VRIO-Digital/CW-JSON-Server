/**
 * Which build of the Goals & Submission prototype each dataset ships.
 *
 * Shared between `GoalsSubmissionPage` (which frames one of these two files, frozen at first mount)
 * and `App` (which prefetches both into the browser's cache as soon as the app opens — see
 * `PrefetchGoalsSubmission` — so a multi-megabyte document is already downloaded by the time a reader
 * clicks through to Goals or Submission). One definition rather than two, or the pair could drift the
 * way the dataset/prefix constants elsewhere in this app are kept to a single declaration.
 *
 * A dataset with no build of its own gets KEOLIS's, as every dataset did before the second one arrived
 * — which is why RISK could not be left missing rather than merely absent: a lookup that falls back
 * silently does not fail, it prefetches the *wrong* 5.7 MB document (Keolis's own) while RISK's real
 * one, `ContractRisk.html`, is never requested until a reader actually opens Ask, Goals or Submission
 * and meets it stone cold. Reported from use as those three pages loading slowly — the fetch, the parse
 * and the boot of a document this size are genuinely not instant, and nothing had given them a head
 * start the way every other dataset's Goals/Submission pair already gets.
 *
 * **RISK's one file answers for both slots**, because `ContractRiskPage` frames a single build behind
 * all three routes (Ask, Goals, Submissions), hash-routed rather than split into two documents the way
 * every other dataset's prototype is. Two `<link rel="prefetch">` tags resolving to the same URL is
 * harmless — the browser fetches it once — and it is what lets this table stay the one place either
 * reader needs to look, rather than `ContractRiskPage` growing a prefetch of its own.
 */
export interface GoalsSubmissionFiles {
  goals: string
  submission: string
}

export const GOALS_SUBMISSION_FILES: Record<string, GoalsSubmissionFiles> = {
  KEOLIS: { goals: 'Keolis_Goals.html', submission: 'Keolis_Submissions.html' },
  CAPEX: { goals: 'Capex-Goals.html', submission: 'Capex-Submission.html' },
  SUPPLYCHAIN: { goals: 'Supply_chain_goals.html', submission: 'Supply_chain_submission.html' },
  ARCWOOD: { goals: 'Arcwood_goals.html', submission: 'Arcwood_submission.html' },
  RISK: { goals: 'ContractRisk.html', submission: 'ContractRisk.html' },
}

export const goalsSubmissionFilesFor = (dataset: string): GoalsSubmissionFiles =>
  GOALS_SUBMISSION_FILES[dataset.trim().toUpperCase()] ?? GOALS_SUBMISSION_FILES.KEOLIS
