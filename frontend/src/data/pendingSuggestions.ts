/**
 * The pending-suggestions review: its copy, and the two things about it that are decidable.
 *
 * **Here rather than in the component for the reason `sourceActions` is**: this list lives inside a
 * `Modal`, which portals out of `renderToString`, so a sentence written inline in the panel could
 * not be asserted on at all — and the accept-all outcome is exactly the sentence that must not be
 * allowed to drift, since it is what tells a reader whether nine writes really landed.
 */

import type { DeclaredRelationship } from './dataModelRelationships'

export const pendingSuggestionsCopy = {
  title: 'Suggested relationships, pending review',
  /**
   * The lead names the act rather than the list. Confirming one **writes** it — that is the whole
   * difference between the two kinds of row in this tab, and a reader about to press *Accept all*
   * is the one person who most needs it said.
   */
  lead:
    'Each of these is a suggestion nobody has accepted yet, so none of them is stored. Confirming one writes it to this dataset as a declaration; rejecting it drops it from this run.',
  /** Said where the button is, because it is the one consequence a reader cannot undo in one click. */
  acceptAllNote:
    'Accept all confirms every row below, one write at a time, and stops at the first refusal — so a partial run leaves the rest pending rather than losing them.',
  acceptAll: 'Accept all',
  accepting: 'Confirming',
  close: 'Close',
  /**
   * The two kinds, stated where the reviewer is judging them. A recorded row is somebody's opinion
   * about this schema; a derived one is two columns having the same name, and they are not weighed
   * the same way.
   */
  kindNote: {
    recorded:
      'Written into this dataset — carries the relationship’s own name, the alternatives somebody weighed, and their reasoning.',
    derived:
      'A shared identifier column this server matched, with the distinct counts the profiler recorded. No model ran.',
  },
  /** Reachable only if the tile is opened with nothing pending, which the tile does not allow. */
  empty: 'Nothing is pending. Run Suggest from schema to look for more.',
} as const

/**
 * The pending rows, split by where they came from and each half kept in its own order.
 *
 * A single flat list would leave a reviewer weighing an authored suggestion and a column-name match
 * by the same standard — the distinction the badge, the evidence label and the confidence label all
 * exist to draw, applied to the order they are read in.
 */
export function groupPendingByKind(rows: DeclaredRelationship[]): {
  recorded: DeclaredRelationship[]
  derived: DeclaredRelationship[]
} {
  return {
    recorded: rows.filter((r) => r.provenance === 'recorded'),
    derived: rows.filter((r) => r.provenance !== 'recorded'),
  }
}

/**
 * What an accept-all run reports when it is over.
 *
 * **Counted, never assumed.** The tempting sentence is "9 relationships confirmed" composed from the
 * length of the list that was submitted — which is a claim about writes that may not have happened,
 * and this repo's own history has one of those in it already (a settings toggle that reported a
 * failure for a write the server had committed). So it takes what actually landed, and a partial run
 * says so in both directions: how many were written, and how many are still pending.
 *
 * `error` is the server's own wording, kept rather than replaced — a refusal here names the table or
 * the column that could not resolve, which is the only part a reader can act on.
 */
export function acceptAllOutcome(args: {
  attempted: number
  accepted: number
  error?: string
}): { tone: 'success' | 'warning' | 'error'; message: string } {
  const { attempted, accepted, error } = args
  const rel = (n: number) => `${n} relationship${n === 1 ? '' : 's'}`

  if (accepted === 0) {
    return {
      tone: 'error',
      message: error
        ? `Nothing was confirmed — ${error}`
        : 'Nothing was confirmed.',
    }
  }
  if (accepted < attempted) {
    const left = attempted - accepted
    return {
      tone: 'warning',
      message: error
        ? `${rel(accepted)} confirmed, then the run stopped: ${error} ${left} still pending.`
        : `${rel(accepted)} confirmed. ${left} still pending.`,
    }
  }
  return { tone: 'success', message: `${rel(accepted)} confirmed and saved.` }
}

/** `"plan.e_manifest"` + `"generator_id"` → `"e_manifest.generator_id"`, for a row's join line. */
export function joinEnd(tableLabel: string, column: string): string {
  return `${tableLabel}.${column}`
}
