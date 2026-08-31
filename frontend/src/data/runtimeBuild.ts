import type { GraphSource, SourcePick } from '../api/client'

/**
 * Which of a brief's picked sources are read at question time.
 *
 * The client half of the server's `runtimeSourcesIn`, and it asks the same question of the
 * same facts: a pick resolved against the served source list, kept only where that source
 * says `runtime`. `GET /graph-sources` lists connected sources only, so the "still
 * connected" test the server applies is already carried by the list this reads.
 *
 * **Never `kind === 'gmail'`.** `runtime` is served for the reason `profilable` is — a pair
 * of connector names written into a component is a second answer to which sources are
 * runtime, and it goes stale the day a second one lands.
 */
export function runtimePicks(
  sources: GraphSource[],
  picks: SourcePick[],
): GraphSource[] {
  const byId = new Map(sources.map((s) => [s.sourceId, s]))
  return picks
    .map((p) => byId.get(p.sourceId))
    .filter((s): s is GraphSource => s !== undefined && s.runtime)
}

/**
 * Whether this brief's build will publish itself.
 *
 * The one definition the wizard reads — the button's hand-off, the dialog's copy and the
 * assertion in `check-docs` all come through here, so they cannot disagree about which
 * graphs skip the studio.
 */
export const isRuntimeAnswered = (
  sources: GraphSource[],
  picks: SourcePick[],
): boolean => runtimePicks(sources, picks).length > 0

/**
 * The hand-off dialog's words.
 *
 * Copy rather than markup, for the reason `sourceActions` and `connectSteps` are: a `Modal`
 * portals out of `renderToString`, so a sentence written inline in the dialog cannot be
 * asserted on. Everything interpolated here is a fact the caller read off a payload — the
 * run's own pace, the version the server minted, the sources the brief picked — never a
 * number this file knows.
 */
export const runtimeBuildCopy = {
  /**
   * What the panel says while it holds.
   *
   * Phrases rather than the pipeline's stage/step readout: the build publishes itself and
   * there is nothing on this dialog to press, so a stage counter here is detail about a run
   * the reader has no act to take against — but a single line held for ten seconds reads as
   * a page that stopped, which is the same reason Ask shimmers its outstanding blocks. They
   * are named in the mailbox's own terms, they advance in order, and the last one stands
   * until the hold ends rather than looping: a phrase coming back round would say the work
   * had restarted.
   */
  analysing: [
    'Analysing Gmail data…',
    'Preparing the data…',
    'Finishing the analysis…',
  ] as const,

  /** Only ever said once Ask has been re-read and really lists the graph. */
  published: (version: string, by: string | null) =>
    `Published as ${version}${by ? `, credited to ${by}` : ''}. Ask lists it now.`,

  askAction: 'Ask a question',
} as const

/**
 * How long the hand-off holds before it offers Ask.
 *
 * Stated once, here beside the words it paces, so the dialog prints no duration of its own —
 * the rule every paced surface in this app keeps.
 */
export const ANALYSING_MS = 10_000

/**
 * How long each phrase stands.
 *
 * Divided rather than written down, so adding a phrase re-cuts the same hold instead of
 * making the reader wait longer — the derivation `specStepMs` makes for the same reason: what
 * ends this wait is the act it offers, so the total is what a reader is owed.
 */
export const analysingStepMs = () => ANALYSING_MS / runtimeBuildCopy.analysing.length
