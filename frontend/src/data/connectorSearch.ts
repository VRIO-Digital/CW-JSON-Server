import { connectorGroup, type Connector, type ConnectorGroup } from './connectors'

/**
 * What the connector directory can be narrowed to.
 *
 * `all` is the default and is a real option rather than the absence of one: the control states
 * which filter is in force, so a reader who has narrowed the grid can see that they have.
 *
 * **Two, matching the two sections.** There was briefly a third — the connectors that register a
 * source and profile nothing had a section and a filter of their own — and it was **removed on
 * request**: three headings over eleven cards was more taxonomy than the step could carry. A filter
 * offering a group the grid no longer draws a heading for would be a control naming a concept the
 * page does not have, so it went with the section rather than being left behind.
 *
 * **What that fact costs is nothing, because it never lived here.** Each of those cards says *"no
 * profiler yet"* in its own blurb, and `connectorPickerNote` says it again in the step's note — the
 * rule this repo keeps everywhere: state a fact where the reader is looking, not in a heading above
 * a group of things.
 */
export type ConnectorFilter = 'all' | 'available' | 'vision'

/**
 * Narrowing the directory.
 *
 * **A pure function in `src/data/`, for the reason `askAvailability` and `datasetPathFix` are:**
 * a filter written inside the wizard could only be asserted by rendering the wizard's own state,
 * and step 1 sits inside a `Modal` that `renderToString` will not traverse. Everything decidable
 * is here; the component renders what it returns.
 *
 * **It searches what a reader can see** — the name, the blurb and the type label — and nothing
 * else. Matching the `key` would make `osipi` find OSIsoft PI, which is a string this app never
 * shows anybody; matching the `reason` would make a vision card answer to words that appear only
 * after it has been clicked, so a search for "roadmap" would return three cards whose grid text
 * says nothing about roadmaps. A search result a reader cannot account for reads as a bug.
 *
 * The query is trimmed and case-folded, and an empty one narrows nothing rather than matching
 * nothing — an empty box is not a search.
 */
export function filterConnectors(
  connectors: Connector[],
  query: string,
  filter: ConnectorFilter,
): Connector[] {
  const q = query.trim().toLowerCase()
  return connectors.filter((c) => {
    if (filter === 'available' && !c.available) return false
    if (filter === 'vision' && c.available) return false
    if (q === '') return true
    return [c.name, c.blurb, c.typeLabel].some((field) =>
      field.toLowerCase().includes(q),
    )
  })
}

/**
 * Step 1's own note, composed from the directory rather than written out.
 *
 * **Names the connectors instead of counting them**, which the sentence has done since a third one
 * landed: a count goes stale the day a fourth does, and the names are what a reader is choosing
 * between. What is new is that there are now two kinds of pickable connector, and the note has to
 * tell them apart — it read *"the rest below are product vision only"*, which stopped being true
 * the moment a database card could be clicked.
 *
 * **The middle sentence is the load-bearing one.** A connector that registers a source and profiles
 * nothing is a decision rather than an unfinished feature, and a reader who clicks one has to know
 * that before they type six fields into it — not afterwards, from a Data Catalog that leaves the
 * row out.
 *
 * A group with nothing in it contributes no sentence, so this cannot come to describe an empty
 * section — the rule the directory's own headings follow.
 */
export function connectorPickerNote(connectors: Connector[]): string {
  const names = (group: ConnectorGroup) =>
    connectors.filter((c) => connectorGroup(c) === group).map((c) => c.name)

  const profiling = names('profiling')
  const credentials = names('credentials')
  const vision = names('vision')

  const parts: string[] = []
  if (profiling.length > 0) {
    parts.push(
      `${profiling.join(', ')} connect for real and carry a catalogue — pick one to sign in and browse what it holds.`,
    )
  }
  if (credentials.length > 0) {
    parts.push(
      `${credentials.join(', ')} take the connection details on the next step and register a source; nothing profiles them yet, so each is listed on Sources and not in the Data Catalog.`,
    )
  }
  if (vision.length > 0) {
    parts.push(`The ${vision.length} under Product vision are not built — clicking one shows why.`)
  }
  return parts.join(' ')
}

/** The directory's words, out of the component so a `Modal` cannot hide them from a test. */
export const connectorDirectoryCopy = {
  searchPlaceholder: 'Search connectors',

  filterLabel: 'Filter',
  filterOptions: [
    { value: 'all' as const, label: 'All' },
    { value: 'available' as const, label: 'Available now' },
    { value: 'vision' as const, label: 'Product vision' },
  ],

  /**
   * Two headings, and the distinction is the one search must not dissolve: a card that registers a
   * source, and a card that explains why it cannot.
   *
   * **A third heading was removed on request.** *Available now — pick one* therefore covers both
   * kinds of pickable connector, which is exactly what it says — it is a claim about being
   * pickable, not about carrying a catalogue. Which of them profile is on the cards themselves and
   * in the step's note, and nowhere does a heading answer for a card.
   */
  availableHeading: 'Available now — pick one',
  visionHeading: 'Product vision — not yet built',

  /**
   * When a search matches nothing.
   *
   * It **names the query**, because "no connectors" over a grid a reader has just narrowed is
   * indistinguishable from a directory that failed to load — the rule the Library's ungoverned
   * notice follows, and the reason a truncated list here would have to say it was truncated.
   */
  noMatch: (query: string) => `No connector matches “${query.trim()}”.`,
  noMatchHint: 'Clear the search, or widen the filter, to see the whole directory.',
} as const

