import type { Connector } from './connectors'

/**
 * What the connector directory can be narrowed to.
 *
 * `all` is the default and is a real option rather than the absence of one: the control states
 * which filter is in force, so a reader who has narrowed the grid can see that they have.
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

/** The directory's words, out of the component so a `Modal` cannot hide them from a test. */
export const connectorDirectoryCopy = {
  searchPlaceholder: 'Search connectors',

  filterLabel: 'Filter',
  filterOptions: [
    { value: 'all' as const, label: 'All' },
    { value: 'available' as const, label: 'Available now' },
    { value: 'vision' as const, label: 'Product vision' },
  ],

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
