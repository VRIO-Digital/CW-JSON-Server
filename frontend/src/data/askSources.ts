/**
 * The source picker's words, and the sentence the graph select says when nothing is live.
 *
 * Copy rather than markup, for the reason `sourceActions` and `connectSteps` are: a `Dropdown`
 * and a `Select`'s options both portal out of `renderToString`, so a sentence written inline in
 * the control cannot be asserted on. Nothing here interpolates a figure — the counts and the
 * names are the payload's, read where they are printed.
 */
export const askSourceCopy = {
  /*
   * **Eight fields stood here and went with the picker that read them.** `buttonHint`,
   * `modalTitle`, `heading`, `searchPlaceholder`, `noMatch`, `noMatchHint`, `emptyTitle` and
   * `emptyDetail` were a dialog's title, its search and its empty state — a grid of connected
   * sources to tick. There is no grid: every connected source is what a question with no graph
   * selected is asked of, so there is nothing to search and nothing to choose. Copy for a
   * control that does not exist is the half-removal this repo refuses — the shape that left
   * Gmail's Continue refusing over a name field its own step no longer had — so they are gone
   * rather than kept warm for a picker somebody might restore.
   */

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
   * What the graph select shows while a connected source is being asked instead.
   *
   * The two are exclusive, so a graph left named there would be naming something this question
   * will not be asked of. The control stays enabled: choosing a graph is how a reader switches
   * back, and doing so takes the connected sources out of scope.
   */
  graphPlaceholder: 'Asking a source — pick a graph to switch',

  /**
   * What stands where no graph is selected and there is nothing connected to read instead.
   *
   * **It named the `+`, and the `+` is gone.** An instruction pointing at a control that does
   * not exist is one nobody can carry out — word for word the fault Gmail's removed name field
   * left behind in the gate that went on validating it. What is true now is that a source is
   * asked by being *connected*, so the instruction names the page that connects one.
   */
  pickPrompt:
    'Connect a Gmail source on Sources to ask it here — a connected source is read whenever no graph is selected.',

  /**
   * The same instruction where a graph is also on offer.
   *
   * **A question is asked of one thing**, and with no graph selected that thing is every
   * connected source — so this names both routes rather than only the shorter one. Neither
   * asks the reader to pick a source: choosing a graph is the one choice on this screen, and
   * it is what takes the sources out of scope.
   */
  pickPromptWithGraph:
    'Choose a graph above to ask it, or connect a Gmail source on Sources to be asked directly. A question is asked of one or the other, not both.',
} as const

/*
 * **`filterAskSources` stood here and is gone with the picker it narrowed.** It searched a card's
 * own words — name, account, scope, connector — so a reader searching for what they could see found
 * it, and it lived here rather than in the component because a `Modal`'s grid is not traversed by
 * `renderToString`. There is no grid any more: every connected source is what a question is asked
 * of, so there is nothing to search and nothing to choose. Restoring the picker is this function,
 * the copy below it and the component.
 */

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
): { gated: boolean; canAsk: boolean; target: string } {
  return {
    gated: graphName === null && sources.length === 0,
    /*
     * **Connected is enough now, and it was not.** This required a source to have been *picked*
     * with the `+`, on the reasoning that connecting one is not choosing to read a question
     * against it. That control is gone — removed on request — so there is nothing left to express
     * the choice with, and a reader who has connected a mailbox and is looking at its own
     * questions has plainly chosen it. What answers is: the selected graph, or every connected
     * source.
     */
    canAsk: graphName !== null || sources.length > 0,
    target: graphName ?? sources.map((s) => s.name).join(', '),
  }
}

/**
 * The opener chips: what this page offers to ask, given what it is asking.
 *
 * **Whatever answers the question is what suggests it.** A graph answers where one is selected,
 * so its hero questions are the chips — unchanged. Otherwise the picked sources answer, so their
 * own recorded questions are, and the server draws those from the *same pool* its answerer
 * matches within, so a chip cannot be offered that the source would then abstain on.
 *
 * **A connected source's questions sit beside the graph's, not instead of them.** This returned the
 * hero questions alone whenever a graph was selected, so connecting a mailbox changed nothing a
 * reader could see until they deselected the graph — which is not something the page ever asked
 * them to do. Both are offered now: connecting a source is what makes its questions appear.
 *
 * **Each chip says what will answer it, because the two are not asked of the same thing.** The
 * route settles a request naming a graph *and* sources in the graph's favour, so a mail question
 * asked under a selected graph would be answered by the graph and attributed to it — a mail
 * answer wearing a graph's version. A chip therefore carries the source it came from, and the page
 * drops the graph before asking one. A hero question carries `null` and is asked of the graph.
 *
 * De-duplicated across sources, because two mailboxes drawing on one recorded set would
 * otherwise offer the same sentence twice, which reads as two different questions. The graph's own
 * are listed first: they are what the selected thing answers, and a reader scanning the row should
 * meet those before the correspondence.
 */
export interface AskChip {
  text: string
  /** The source that answers it, or `null` for one the selected graph answers. */
  sourceId: string | null
}

export function askSuggestions(
  graphQuestions: string[] | null,
  sources: { sourceId: string; suggestedQuestions: string[] }[],
): AskChip[] {
  const fromSources: AskChip[] = []
  const seen = new Set<string>()
  for (const source of sources) {
    for (const text of source.suggestedQuestions) {
      if (seen.has(text)) continue
      seen.add(text)
      fromSources.push({ text, sourceId: source.sourceId })
    }
  }
  if (graphQuestions === null) return fromSources
  /* A graph question and a source question can read the same; the graph's wins the slot, because
     it is what the current selection answers. */
  return [
    ...graphQuestions.map((text) => ({ text, sourceId: null })),
    ...fromSources.filter((c) => !graphQuestions.includes(c.text)),
  ]
}

/**
 * Which instruction to print when nothing is selected.
 *
 * A pure function beside `askAvailability` and for the same reason: a ternary inside the page
 * cannot be asserted without rendering the page’s own state.
 */
export const askPickPrompt = (graphsAvailable: boolean): string =>
  graphsAvailable ? askSourceCopy.pickPromptWithGraph : askSourceCopy.pickPrompt
