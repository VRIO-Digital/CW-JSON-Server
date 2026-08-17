/**
 * What the Disconnect and Delete confirmations ask, and the whole of what they say.
 *
 * **This is deliberately one sentence.** It used to be four: the question, then what happened to
 * the row, then whether the act could be undone, then which pages closed if it was the last
 * connected source. All three consequence lines were removed on request — see
 * `docs/REGRESSIONS.md`. What that costs is recorded there and worth knowing before adding
 * anything back: nothing on screen now says Disconnect is reversible and Delete is not, and
 * nothing says that deleting the last connected source closes the Data Catalogue, Profiling jobs,
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
