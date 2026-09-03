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
   * The dialog's own title, and the heading over the cards.
   *
   * **Both were removed once, and both are back on request** — the picker was reduced to its
   * rows, then asked for again in the connector directory's shape. What is *not* back is the
   * doctrine paragraph: `observationNote` still stands on the page, above a thread with no
   * graph behind it, where it bears on something the reader is looking at. A heading naming a
   * grid is a label; three lines explaining what an observation is were a paragraph in front of
   * a click, and only the first belongs over a control.
   *
   * The heading earns its place here in a way it did not over two bare checkboxes: it carries
   * the count, and with a search above it the count is the only thing telling a narrowed grid
   * from the whole list — the reason `ConnectorDirectory` puts one on each of its sections.
   */
  modalTitle: 'Sources',
  heading: 'Connected sources',

  searchPlaceholder: 'Search connected sources',
  /**
   * Names the query rather than saying "no sources".
   *
   * Over a grid the reader has just narrowed, the bare sentence is indistinguishable from a
   * picker that failed to load — the same reason the connector directory's own no-match state
   * quotes what was typed.
   */
  noMatch: (query: string) => `No connected source matches “${query.trim()}”.`,
  noMatchHint:
    'Search matches a source’s name, the account it connected as, and what it has in scope.',

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
   * What the graph select shows while a connected source is being asked instead.
   *
   * The two are exclusive, so a graph left named there would be naming something this question
   * will not be asked of. The control stays enabled: choosing a graph is how a reader switches
   * back, and doing so drops the source picks.
   */
  graphPlaceholder: 'Asking a source — pick a graph to switch',

  /**
   * What stands where nothing has been picked and no graph is live.
   *
   * The page is usable in that state — the box and the picker are both there — so what it
   * needs is an instruction rather than a gate. It names the control, because the + is the
   * only way from here to an answer.
   */
  pickPrompt:
    'Use the + to pick a connected source to read this question against.',

  /**
   * The same instruction where a graph is also on offer.
   *
   * **A question is asked of one thing**, so picking either clears the other, and with neither
   * picked the reader has two ways forward rather than one. Naming only the `+` would be an
   * instruction that works and hides the shorter route.
   */
  pickPromptWithGraph:
    'Choose a graph above, or use the + to pick a connected source. A question is asked of one or the other, not both.',
} as const

/**
 * The fields a row is searched on. Structural rather than `AskSource` itself, like every other
 * function in this file: `src/data/` states what it needs and the payload satisfies it.
 */
type SearchableSource = {
  name: string
  account: string | null
  scope: string
  connector: string
}

/**
 * Narrows the picker's grid.
 *
 * **A pure function here rather than a predicate inside the component**, for the reason
 * `filterConnectors` is one: the grid lives inside a `Modal`, which `renderToString` will not
 * traverse, so a filter written in the component could not be asserted at all — a check about it
 * would render the shut dialog and pass over nothing.
 *
 * **It searches what the card prints, and the connector's own key.** Name, account and scope are
 * the three things on a card, so a reader searching for what they can see finds it; `connector`
 * is included because "gmail" is the word somebody types for a mailbox and the mark is the only
 * place the card states it. It is deliberately *not* a filter on connector kind — that would be
 * the picker deciding which sources are askable, which is the server's answer and nobody else's.
 *
 * Case-insensitive, and an empty or whitespace query narrows nothing rather than matching
 * nothing: a search box that empties the grid the moment it is focused reads as broken.
 */
export function filterAskSources<T extends SearchableSource>(sources: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return sources
  return sources.filter((s) =>
    [s.name, s.account ?? '', s.scope, s.connector].some((f) => f.toLowerCase().includes(q)),
  )
}

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

/**
 * The opener chips: what this page offers to ask, given what it is asking.
 *
 * **Whatever answers the question is what suggests it.** A graph answers where one is selected,
 * so its hero questions are the chips — unchanged. Otherwise the picked sources answer, so their
 * own recorded questions are, and the server draws those from the *same pool* its answerer
 * matches within, so a chip cannot be offered that the source would then abstain on.
 *
 * **A source merely connected offers nothing.** Suggesting a question the reader cannot yet ask
 * — because they have not picked the source — would be a chip that refuses when clicked.
 *
 * De-duplicated across sources, because two mailboxes drawing on one recorded set would
 * otherwise offer the same sentence twice, which reads as two different questions.
 */
export function askSuggestions(
  graphQuestions: string[] | null,
  sources: { sourceId: string; suggestedQuestions: string[] }[],
  sourceIds: string[],
): string[] {
  if (graphQuestions !== null) return graphQuestions
  const picked = sources.filter((s) => sourceIds.includes(s.sourceId))
  return [...new Set(picked.flatMap((s) => s.suggestedQuestions))]
}

/**
 * Which instruction to print when nothing is selected.
 *
 * A pure function beside `askAvailability` and for the same reason: a ternary inside the page
 * cannot be asserted without rendering the page’s own state.
 */
export const askPickPrompt = (graphsAvailable: boolean): string =>
  graphsAvailable ? askSourceCopy.pickPromptWithGraph : askSourceCopy.pickPrompt
