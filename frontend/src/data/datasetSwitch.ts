/**
 * What the dataset switch asks before it signs you out.
 *
 * **Copy, not a component**, for the reason `sourceActions` is: a `Modal` renders through a portal
 * `renderToString` will not traverse, so a sentence written inline in the panel cannot be asserted
 * on. Held here it can be called directly by a test.
 *
 * **Every line is interpolated from the two dataset names.** Two hardcoded sentences read perfectly
 * well and let the CAPEX dialog come to ask about EPA — the same reason
 * `confirmSourceAction` builds its question from the act rather than writing one per branch. The
 * names come from the served pool, so this cannot name a dataset the API does not have.
 *
 * **It states the sign-out, because the sign-out is the surprise.** Changing which dataset the
 * console reads is not a view toggle: every page, every store and every in-memory registration
 * belongs to the dataset it was made under, so the app returns to the login rather than repainting
 * in place. A dialog that only asked "switch to CAPEX?" would be hiding the one consequence the
 * reader cannot undo by switching back — they would still have to sign in again.
 */

export type DatasetSwitch = {
  /** The dataset being left. */
  from: string
  /** The dataset being moved to. */
  to: string
}

/** The dialog's heading — names both sides, so it can never describe the wrong move. */
export const datasetSwitchTitle = ({ from, to }: DatasetSwitch) =>
  `Change dataset from ${from} to ${to}?`

/**
 * What it does, in the order it happens.
 *
 * Three sentences and no more: what the console will read, what happens to this session, and where
 * the reader lands. The last one matters — "you will be signed out" without "sign in again to
 * continue" reads as the app closing rather than reopening on the other dataset.
 */
export const datasetSwitchBody = ({ from, to }: DatasetSwitch) => [
  `The console will read ${to} instead of ${from} — its own sources, graphs, reports and answers.`,
  'You will be signed out, because anything registered, built or published in this session belongs' +
    ` to ${from}.`,
  `Sign in again to continue in ${to}.`,
]

/** The button. Names the destination, so the confirming click cannot be about something else. */
export const datasetSwitchOk = ({ to }: DatasetSwitch) => `Switch to ${to} and sign out`
