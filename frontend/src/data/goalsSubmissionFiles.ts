/**
 * Which build of the Goals & Submission prototype each dataset ships.
 *
 * Shared between `GoalsSubmissionPage` (which frames one of these two files, frozen at first mount)
 * and `App` (which prefetches both into the browser's cache as soon as the app opens — see
 * `PrefetchGoalsSubmission` — so a multi-megabyte document is already downloaded by the time a reader
 * clicks through to Goals or Submission). One definition rather than two, or the pair could drift the
 * way the dataset/prefix constants elsewhere in this app are kept to a single declaration.
 *
 * A dataset with no build of its own gets KEOLIS's, as every dataset did before the second one arrived.
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
}

export const goalsSubmissionFilesFor = (dataset: string): GoalsSubmissionFiles =>
  GOALS_SUBMISSION_FILES[dataset.trim().toUpperCase()] ?? GOALS_SUBMISSION_FILES.KEOLIS
