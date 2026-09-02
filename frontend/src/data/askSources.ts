/**
 * The source picker's words, and the sentence the graph select says when nothing is live.
 *
 * Copy rather than markup, for the reason `sourceActions` and `connectSteps` are: a `Dropdown`
 * and a `Select`'s options both portal out of `renderToString`, so a sentence written inline in
 * the control cannot be asserted on. Nothing here interpolates a figure — the counts and the
 * names are the payload's, read where they are printed.
 */
export const askSourceCopy = {
  buttonHint: 'Add a connected source to read this question against',

  /**
   * Why a mailbox answer is not a graph answer.
   *
   * **Printed on the page, not in the picker.** The picker showed it under its rows and no
   * longer does — three lines of doctrine over two checkboxes is a paragraph in front of a
   * click. It stands where it bears on something the reader is actually reading: above a
   * thread with no graph behind it, saying what these answers are.
   *
   * The query set's own rule, in its own terms — the same sentence `ObservationBlock` and the
   * New Graph wizard's coverage step already state, because a reader meeting it in three places
   * should meet one claim rather than three paraphrases.
   */
  observationNote:
    'An extraction from a message is an observation — a claim about a subject, attributed to whoever made it. It is read when a question needs it and never merged into the graph.',

  emptyTitle: 'No source can be asked directly yet',
  /**
   * Named as a fact about the estate rather than as a failure.
   *
   * A connector whose data reaches an answer *through* the graph is not missing from this list;
   * it belongs on the other side of it. Saying so is what stops a reader with three healthy
   * BigQuery sources reading this as a broken picker.
   */
  emptyDetail:
    'Connect a Gmail source on Sources to ask it here. BigQuery and Drive sources are not listed: their data reaches an answer through the published graph rather than being read at question time.',

  /**
   * What the graph select says when the tenant has published nothing.
   *
   * The control is rendered either way and states this as a disabled option, rather than
   * disappearing — an absent picker says nothing about why it is absent, and this page can now
   * be worked with no graph at all, so its absence would be the reader's only clue that a graph
   * is even a thing to have.
   */
  noGraphOption: 'No graph published',

  /**
   * What stands where nothing has been picked and no graph is live.
   *
   * The page is usable in that state — the box and the picker are both there — so what it
   * needs is an instruction rather than a gate. It names the control, because the + is the
   * only way from here to an answer.
   */
  pickPrompt:
    'Use the + to pick a connected source to read this question against.',
} as const

/**
 * What this page can ask, and therefore what it may render.
 *
 * **A pure function rather than a test inside the component**, for the reason `datasetPathFix`
 * and `diagnose` are: a gate written inline can only be asserted by rendering the component's
 * own state, and `renderToString` gives a zustand component its *initial* state — so a check
 * about the gate would pass over an empty render. Everything decidable lives here; the page
 * renders what it returns.
 *
 * `gated` is the one that changed meaning. It used to be "no graph is live", which was the
 * whole precondition while a graph was the only thing this page could ask; it is now "there is
 * nothing here to ask at all" — no published graph *and* no connected source read at question
 * time. A reader with a mailbox connected never meets the empty state.
 */
export function askAvailability(
  graphName: string | null,
  sources: { sourceId: string; name: string }[],
  sourceIds: string[],
): { gated: boolean; canAsk: boolean; target: string } {
  const picked = sources.filter((s) => sourceIds.includes(s.sourceId))
  return {
    gated: graphName === null && sources.length === 0,
    /* A graph answers on its own; a source has to be *picked*, because connecting one is not
       choosing to read this question against it. */
    canAsk: graphName !== null || picked.length > 0,
    target: graphName ?? picked.map((s) => s.name).join(', '),
  }
}
