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
  /**
   * **"Relations", not "Relationships confirmed" — renamed on request, and the rename is the point.**
   *
   * The tile read *relationships confirmed* over twelve rows nobody in the session had accepted,
   * because being stored was being confirmed. Those two came apart (see `confirmedBy`), so the
   * count is of **relations this source holds** and each row says for itself whether anybody has
   * accepted it. A tile claiming twelve confirmations is the kind of figure a reader cannot check
   * and this one was wrong.
   */
  title: 'Relations',
  /** The tile's label. Declared beside the dialog's title so the two cannot come to disagree. */
  tileLabel: 'relations',
  /**
   * **What a row here *is*, stated where a reader is looking at twelve of them.**
   *
   * The distinction this tab rests on is that a declaration persists and a suggestion does not, and
   * the pending dialog says so from its side. What this one has to add is the second distinction:
   * stored is not accepted. So it says both — these are in the document, and the ones with nobody's
   * name on them are waiting for yours.
   */
  lead:
    'Each of these is stored in this dataset, so it survives a restart and the graph builders read it — but stored is not accepted. Accept one and it is recorded as yours; reject it and it goes back to the suggestions, pending.',
  /** The two acts on an undecided row, and what each does. */
  accept: 'Accept',
  reject: 'Reject',
  acceptNote: 'Records this relation as accepted by you.',
  /**
   * **The bulk accept, asked for at the top of this dialog, and it is the additive half only.**
   *
   * This list had no twin for the pending dialog's *Accept all* while it was a reading surface, and
   * the reason on record was that there is no bulk act on a stored declaration — which was about
   * **deletion**: nineteen removals in one press would be the least reversible button in the tab.
   * That still holds, so there is deliberately no *Reject all*. Accepting in bulk is the opposite
   * shape: it writes a name onto rows that already exist, changes nothing about the schema, and
   * every row it touches keeps its own *Reject* as the way back out.
   *
   * **It acts on the undecided rows and says how many**, never on the whole list: a row somebody
   * has already accepted needs no write, and a count taken from `rows.length` would promise writes
   * that do not happen — the settings-toggle fault, in a button label.
   *
   * **The note says it happens in one write, because that is what changed.** It ran the row's own
   * write down the list at first — one request per relation, and a refusal partway through left
   * half the list accepted with nothing on screen saying which half. The act is the server's now
   * (`POST /data-model/relationships/accept`), which resolves the scope before writing anything
   * and commits once: all of them or none. What a reader needs told is the guarantee, not the
   * round-trip count.
   */
  acceptAll: 'Accept all',
  accepting: 'Accepting',
  acceptAllNote:
    'Accept all records every relation nobody has accepted yet as yours, in one write — all of them or none, so a refusal leaves the list exactly as it is. Rows already accepted keep the name on them, and each row keeps its own Reject.',
  rejectNote:
    'Removes the stored declaration and puts it back with the suggestions, pending — nothing about the schema changes.',
  /**
   * **Where the *other* acts are, said rather than offered.**
   *
   * Accept and Reject are on the row because they are decisions about this list. Editing and
   * deleting a stored declaration are not: they live on one dialog that the canvas edge and the
   * Entity detail row both open, and a second Delete here would be a second surface for one write —
   * the arrangement this repo refuses from the report audience down. So the row hands those over.
   */
  rowHint: 'Open a row to edit or delete it — the same dialog the canvas edge opens.',
  close: 'Close',
  /**
   * Reachable only if the dialog is opened with nothing confirmed, which the tile does not allow —
   * kept for the same reason `pendingSuggestionsCopy.empty` is: a panel that renders blank on an
   * unreachable branch is indistinguishable from one that failed.
   */
  empty:
    'No relations are stored yet. Accept a suggestion, or declare one the schema does not show.',
  /**
   * **Said under every heading, because the heading is a claim about storage.**
   *
   * A relationship touches two tables, so "grouped by table" is ambiguous until it says *which*
   * table — and the answer is not a display preference: a declaration is stored on the entity
   * anchored to its `from` side, which is why moving that side changes which entity owns it.
   */
  /**
   * **Why a table's number here can be lower than the one beside it everywhere else.**
   *
   * Reported from use, and neither number was wrong. A relationship has a direction: it is stored
   * on the entity its *from* table names, so that table **owns** it. Both of its tables are
   * **involved in** it, which is what the table list's pill and the Entity detail panel count.
   * `plan_project_forecast` is involved in two and owns one, so it read 1 next to a rail saying 2
   * with nothing on screen saying they answer different questions.
   *
   * They cannot be reconciled by making them equal: owned-counts sum to the total in the title,
   * and involved-counts would sum to twice it, because every relationship involves two tables. So
   * the heading states **both**, and this note says what each is.
   */
  ownerNote:
    'Owned by this entity — a relationship is stored on the table it points from. The table list and Entity detail count every relationship a table is involved in, either end, so their number is the higher one.',
} as const

/**
 * The stored relations nobody has accepted yet — what *Accept all* acts on, and what its count says.
 *
 * **One definition, three readers**: the button's label, the run itself, and whether the button is
 * drawn at all. A control counting one set and writing another is the fault the confirmed tile
 * records one level up, where a tile that filtered and a modal that filtered again were two answers
 * to one count.
 *
 * `confirmedBy` is the test rather than `provenance`, because that is the field the act writes.
 * They agree today — `toRelationshipItem`'s reader maps an unnamed row to `derived` — and reading
 * the derived one would make this a claim about a label instead of about the document.
 */
export function unacceptedRelations(
  rows: DeclaredRelationship[],
): DeclaredRelationship[] {
  return rows.filter((r) => !r.confirmedBy)
}

/** One heading and the declarations stored under it. */
export interface ConfirmedGroup {
  tableKey: string
  rows: DeclaredRelationship[]
  /**
   * Confirmed relationships with this table at **either** end — what the table list's pill and the
   * Entity detail panel count, computed here so the modal can state it rather than leaving a reader
   * to notice it disagrees with them.
   *
   * **Named for what the heading calls it.** A field spelled one way and rendered another is how a
   * maintainer comes to read the wrong number as the wrong thing; `rows.length` is what the table
   * *owns* and this is what it is *involved in*, on screen and here alike.
   *
   * Always at least `rows.length`, since a relationship a table owns also involves it.
   */
  involved: number
}

/**
 * How a group's heading states its two numbers.
 *
 * **The second clause appears only when the two differ**, so a table that owns every relationship it
 * is involved in reads as one plain figure — the rule `connectorPickerNote` keeps for a group with
 * nothing in it, applied to a number that would otherwise repeat itself.
 *
 * A function rather than a template written in the panel, for two reasons: `renderToString` splits
 * `text {expr} text` into separate nodes, so a sentence assembled in JSX cannot be asserted as the
 * sentence it renders as, and this is the one piece of arithmetic on that heading.
 */
export function groupCountLabel(group: ConfirmedGroup): string {
  const owns = `owns ${group.rows.length}`
  return group.involved > group.rows.length
    ? `${owns} · involved in ${group.involved}`
    : owns
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
      group = { tableKey: row.fromTableKey, rows: [], involved: 0 }
      byKey.set(row.fromTableKey, group)
      groups.push(group)
    }
    group.rows.push(row)
  }
  /* Counted over the whole list rather than the group, because the other end of a relationship this
     table does not own is exactly what the rail is counting and this group does not hold. */
  for (const group of groups) {
    group.involved = rows.filter(
      (r) => r.fromTableKey === group.tableKey || r.toTableKey === group.tableKey,
    ).length
  }
  return groups
}

/**
 * What a decision on one relation reports.
 *
 * A pure function rather than a template in the tab, for the reason `acceptAllOutcome` is one: it
 * names the relation it acted on, because a bare "accepted" over a list of twelve leaves a reader
 * checking which row moved. It says *where* a rejected one went, since that is the half nobody
 * would guess — the row is not deleted, it is undecided again.
 */
export function relationDecision(what: 'accepted' | 'rejected', name: string): string {
  return what === 'accepted'
    ? `${name} accepted — recorded as yours.`
    : `${name} rejected — back with the suggestions, pending.`
}
