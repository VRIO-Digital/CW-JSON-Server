import type { GraphBuild, GraphSource, SourcePick } from '../api/client'

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
   * the reader has no act to take against — but a single line standing for the whole run reads as
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

  /**
   * What stands where the hold has ended and `GET /ask` did not list the graph.
   *
   * It reports the **analysis**, which is this dialog's own act and true either way, and says
   * nothing about publication — the claim only the row Ask returned can carry. Something has
   * to stand here: dropping the not-published warning left the branch empty, and a dialog
   * showing a button over blank space reads as one that failed to load its own contents.
   */
  done: 'Analysis complete.',

  /** Only ever said once Ask has been re-read and really lists the graph. */
  published: (version: string, by: string | null) =>
    `Published as ${version}${by ? `, credited to ${by}` : ''}. Ask lists it now.`,

  askAction: 'Ask a question',
} as const

/**
 * Which phrase the hand-off is on, read off the build's own progress.
 *
 * **The rows report the run; they are not a hold over it.** They were cut out of a
 * ten-second timer, which was wrong by about eighty seconds: a build is 31 substeps and the
 * server publishes a runtime-answered graph when the run *lands*, so a dialog that offered
 * Ask on its own clock handed the reader to a page whose graph did not exist yet — and Ask,
 * correctly, drew its no-published-graph gate. Reported from use.
 *
 * So this is the rule the rest of the app keeps after all: **a row advances because the run
 * advanced, never on a timer the client holds.** The page already polls the run for the
 * publication read-back, so the progress is in hand and nothing is fetched to get it.
 *
 * **The last row ticks only on completion**, whatever the arithmetic says. A finished list is
 * what enables the act, so a row completing early would offer Ask early — the very bug this
 * replaced, one row further on.
 */
export function analysingStage(
  run: Pick<GraphBuild, 'status' | 'stepIndex' | 'stepTotal'> | null,
): number {
  const rows = runtimeBuildCopy.analysing.length
  if (!run) return 0
  if (run.status === 'complete') return rows
  if (run.stepTotal <= 0) return 0
  const at = Math.floor((run.stepIndex / run.stepTotal) * rows)
  return Math.min(Math.max(at, 0), rows - 1)
}
