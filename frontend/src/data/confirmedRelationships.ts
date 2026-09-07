/**
 * The confirmed-declarations review: its copy, and the one thing about it that is decidable.
 *
 * **The twin of `pendingSuggestions.ts`, and deliberately its own module.** That one is named for
 * the state it describes, and the two lists answer different questions — *what is waiting for a
 * decision* against *what this source has been told*. Folding this into it would give one module two
 * subjects and leave a reader of either half wondering which copy belonged to which list.
 *
 * **Here rather than in the component for the reason `sourceActions` is**: the list lives inside a
 * `Modal`, which portals out of `renderToString`, so a sentence or a grouping written inline in the
 * panel could not be asserted at all.
 */

import type { DeclaredRelationship } from './dataModelRelationships'

export const confirmedRelationshipsCopy = {
  title: 'Relationships confirmed',
  /**
   * **What a confirmed row *is*, stated where a reader is looking at nineteen of them.**
   *
   * The distinction this whole tab rests on is that a declaration persists and a suggestion does
   * not, and it is the pending dialog that currently says so. A reader who arrives here instead —
   * by clicking the other tile — is owed the same sentence from the other side: these are stored,
   * they survive a restart, and the graph builders are meant to read them.
   */
  lead:
    'Each of these is stored in this dataset, so it survives a restart and the graph builders read it. A suggestion is not — confirming one is the write that puts it here.',
  /**
   * **Where the acts are, said rather than offered.**
   *
   * The row is a link into the relationship dialog and nothing else. Editing and deleting a stored
   * declaration already live on one dialog that the canvas edge and the Entity detail row both open,
   * and putting a second Delete in this list would be a second surface for one write — the
   * arrangement this repo refuses from the report audience down. So the row hands over instead.
   */
  rowHint: 'Open it to edit or delete — the same dialog the canvas edge opens.',
  close: 'Close',
  /**
   * Reachable only if the dialog is opened with nothing confirmed, which the tile does not allow —
   * kept for the same reason `pendingSuggestionsCopy.empty` is: a panel that renders blank on an
   * unreachable branch is indistinguishable from one that failed.
   */
  empty:
    'Nothing is confirmed yet. Accept a suggestion, or declare a relationship the schema does not show.',
  /**
   * **Said under every heading, because the heading is a claim about storage.**
   *
   * A relationship touches two tables, so "grouped by table" is ambiguous until it says *which*
   * table — and the answer is not a display preference: a declaration is stored on the entity
   * anchored to its `from` side, which is why moving that side changes which entity owns it.
   */
  ownerNote: 'Declared on this entity — a relationship is stored on the table it points from.',
} as const

/** One heading and the declarations stored under it. */
export interface ConfirmedGroup {
  tableKey: string
  rows: DeclaredRelationship[]
}

/**
 * The confirmed rows, gathered under the entity that owns each one.
 *
 * **Grouped by `fromTableKey`, which is a fact rather than a choice.** `relationshipWrites` anchors
 * a declaration on its *from* table — that is the entity the row is written to, and an edit that
 * moves the from side is what changes which entity owns it. Grouping by the other end, or by
 * whichever end happened to be selected, would put a row under a heading that does not hold it.
 *
 * **Groups keep first-appearance order and rows keep theirs**, so this cannot become a second
 * ordering of the same list: the modal shows what it was handed, in the order it was handed it,
 * which is the order the canvas and the Entity detail panel already use. A sort here would be one
 * more thing that could disagree with them.
 *
 * A table with nothing confirmed contributes no group, so a heading can never stand over an empty
 * list — the rule `connectorPickerNote` keeps for an empty group.
 */
export function groupConfirmedByOwner(rows: DeclaredRelationship[]): ConfirmedGroup[] {
  const groups: ConfirmedGroup[] = []
  const byKey = new Map<string, ConfirmedGroup>()
  for (const row of rows) {
    let group = byKey.get(row.fromTableKey)
    if (!group) {
      group = { tableKey: row.fromTableKey, rows: [] }
      byKey.set(row.fromTableKey, group)
      groups.push(group)
    }
    group.rows.push(row)
  }
  return groups
}
