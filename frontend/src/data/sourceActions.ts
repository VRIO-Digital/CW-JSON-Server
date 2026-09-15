/**
 * What the Disconnect and Delete confirmations ask, and the whole of what they say.
 *
 * **This is deliberately one sentence.** It used to be four: the question, then what happened to
 * the row, then whether the act could be undone, then which pages closed if it was the last
 * connected source. All three consequence lines were removed on request — see
 * `docs/REGRESSIONS.md`. What that costs is recorded there and worth knowing before adding
 * anything back: nothing on screen now says Disconnect is reversible and Delete is not, and
 * nothing says that deleting the last connected source closes the Data Catalog, Profiling jobs,
 * Traces and Validation. The *acts* are unchanged — Reconnect still restores every profiled
 * object, Delete still takes them — so the app is quieter about consequences it still has.
 *
 * **Copy, not a component.** A `Popconfirm` renders through a portal that `renderToString` will
 * not traverse, so a sentence written inline in the page cannot be asserted on. Held here it can
 * be called directly by a test, the way `profilingOutcome` and `connectSteps` are — and it is
 * written **once** rather than once per dialog, which is what stops the two coming to word the
 * same act differently.
 */
export type SourceAction = 'disconnect' | 'delete'

/**
 * The question, built from the act rather than written per branch.
 *
 * The interpolation is the point: two hardcoded sentences render perfectly well and let the delete
 * dialog come to ask about disconnecting.
 */
export const confirmSourceAction = (action: SourceAction) =>
  `Are you sure you want to ${action} this source?`

/**
 * What a completed delete reports, composed from what the server said it did.
 *
 * **A report of an act, not a warning before one** — which is why it can exist at all while the
 * two confirmations stay one sentence each. The dialogs were stripped of their consequence lines
 * on request and must stay that way; this is the other end, where the act has happened and what
 * changed is a fact rather than a prediction.
 *
 * **The counts are the server's own answer read back**, never the length of anything submitted —
 * the rule `acceptAllOutcome` keeps for the same numbers going the other way, because a sentence
 * built from the request is a claim about writes that may not have happened.
 *
 * **A kind with nothing in it contributes no clause**, and a delete that released nothing says
 * nothing about releasing — the rule `suggestionRunNote` keeps. Deleting a Drive or a mailbox
 * lands here every time and has no declarations to give back.
 */
export function deletedSourceOutcome(
  sourceName: string,
  released: { entities: number; relationships: number },
): string {
  const done = `${sourceName} deleted — connect it again to re-register.`
  const parts: string[] = []
  if (released.relationships > 0) {
    parts.push(
      `${released.relationships} relation${released.relationships === 1 ? '' : 's'}`,
    )
  }
  if (released.entities > 0) {
    parts.push(`${released.entities} entit${released.entities === 1 ? 'y' : 'ies'}`)
  }
  if (parts.length === 0) return done
  /* Said as what a reader will *see*, because the badge is where they meet it — "cleared
     confirmed_by" names a field nobody outside this repo has heard of. */
  return `${done} ${parts.join(' and ')} went back to Curated by AI.`
}
