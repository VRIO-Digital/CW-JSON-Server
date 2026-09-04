/**
 * Declared relationships, as the Data Modeling tab works with them.
 *
 * **A confirmed relationship is derived from the entities the tab already loaded, never held beside
 * them.** `GET /data-model/entities` returns each declaration inline on its owning entity, so the
 * server's copy is the only copy and there is nothing to keep in sync — a save posts and the tab
 * re-reads. What *is* local is a **pending suggestion**: a suggestion nobody has accepted is not a
 * declaration and must not be stored as one, so it lives in the component until somebody confirms
 * it, and confirming is the act that writes it.
 *
 * Everything here is pure. The writes are assembled as a list of `ModelEntityInput`s and handed back
 * for the store to post, rather than posted from here, for the reason `datasetPathFix` is a
 * function: a rule that decides *which entity owns a declaration* is worth asserting without a
 * server, and a module that fetches cannot be.
 */

import type { ModelEntity, ModelEntityInput, ModelRelationshipItem } from '../api/client'
import type { CanvasEdgeVM } from './dataModelCanvas'

/**
 * Structured cardinality. `A:B` reads "one row of the **from** table to B rows of the **to** table",
 * which is standard ER notation and the reason the from side is always the "A".
 *
 * Kept apart from the display label because a caller has to *reason* about multiplicity — the
 * modal preselects a stored relationship's side, and the canvas words its edge from it — and parsing
 * a display string to find that out is how the two come to disagree.
 */
export type CardinalityKind = '1:1' | '1:N' | 'N:1' | 'N:N'

/** The one label map, so the canvas, the modal and the panel cannot word a cardinality differently. */
export const CARDINALITY_LABELS: Record<CardinalityKind, string> = {
  '1:1': '1:1 (one to one)',
  '1:N': '1:N (one to many)',
  'N:1': 'N:1 (many to one)',
  'N:N': 'N:N (many to many)',
}

export const CARDINALITY_KINDS: CardinalityKind[] = ['1:1', '1:N', 'N:1', 'N:N']

/**
 * Reads a stored `cardinality_hint` back into a `CardinalityKind`.
 *
 * The server checks the four codes on the way in, so an unknown value here means a document edited
 * through `/db` — it falls back to `1:N` rather than throwing, because a relationship that will not
 * render at all is a worse answer than one whose advisory hint is the least committal of the four.
 */
export function cardinalityKindFromHint(hint: string | undefined): CardinalityKind {
  const trimmed = (hint ?? '').trim().toUpperCase()
  return (CARDINALITY_KINDS as string[]).includes(trimmed)
    ? (trimmed as CardinalityKind)
    : '1:N'
}

/**
 * What the suggestions run's `evidence_kind` says, in words a reader reads.
 *
 * **`recorded` is the one this dataset actually serves, and it does not say "AI".** A recorded
 * suggestion has an AI suggester's shape — a relationship name, the alternatives somebody weighed, a
 * paragraph of reasoning, a stated confidence — and it was *written into this dataset's document*.
 * Labelling it "model reasoning" would be the only untrue thing on the page, and it is the tempting
 * label precisely because everything around it looks generated.
 *
 * The two model values stay mapped rather than deleted: they are what a real suggester would send,
 * and a value this returned raw would print `llm_and_structural` at a reader.
 */
export function evidenceKindLabel(kind: string): string {
  if (kind === 'recorded') return 'Recorded in this dataset'
  if (kind === 'structural') return 'Structural analysis'
  if (kind === 'llm') return 'Model reasoning'
  if (kind === 'llm_and_structural') return 'Model reasoning + structural analysis'
  return kind
}

/** Whether this suggestion was written down rather than derived from a column scan. */
export const isRecordedSuggestion = (r: { evidenceKind?: string }): boolean =>
  r.evidenceKind === 'recorded'

/**
 * What a suggestion's confidence figure is a confidence *in* — one definition, two readings.
 *
 * The same number means different things by kind, and labelling both "classifier confidence" was
 * wrong for half of them: a **derived** suggestion's is the profiler's own score for the weaker of
 * the two columns it matched on, and a **recorded** one's is a stated opinion written down beside
 * the suggestion. A reviewer weighing 0.61 needs to know which of those they are reading.
 */
export const confidenceLabel = (r: { evidenceKind?: string }): string =>
  isRecordedSuggestion(r) ? 'Stated confidence' : 'Classifier confidence'

/**
 * One relationship as every surface here works with it.
 *
 * A `confirmed` one is a stored declaration and `id` addresses it (see `declaredRelationshipId`); a
 * `pending` one is an unaccepted suggestion living only in component state.
 */
export interface DeclaredRelationship {
  id: string
  fromTableKey: string
  fromColumn: string
  toTableKey: string
  toColumn: string
  /** The relationship's own name, distinct from either entity's. */
  name: string
  /** The display label for the cardinality — advisory. */
  cardinality: string
  /** The structured form of the same value. */
  cardinalityKind: CardinalityKind
  /** The declarer's business rationale, carried onto every edge the declaration produces. */
  rationale: string
  status: 'confirmed' | 'pending'
  /**
   * Where this came from, which is **not** the same question as `status`.
   *
   * A `confirmed` one is always `human` — it exists because somebody wrote it. A `pending` one is
   * `recorded` (written into this dataset's document) or `derived` (a shared identifier column this
   * server matched), and the two are judged differently by a reviewer: one is a stated opinion about
   * this schema, the other is two columns having the same name.
   */
  provenance: 'human' | 'derived' | 'recorded'
  /** A suggestion's own reasoning, with the figures it read. Pending only. */
  suggestionReasoning?: string
  confidence?: number
  /** What a confirmed declaration stands on, in words. */
  evidence?: string
  evidenceKind?: string
  /** Other names the run proposed for the same join, offered as quick-pick chips. Pending only. */
  nameAlternatives?: string[]
  /** The entity this declaration is stored on. Confirmed only. */
  owningEntityId?: string
}

/**
 * A stable address for a stored declaration: its owning entity plus its own natural key.
 *
 * Deliberately **not** an array index. An index shifts the moment a sibling is deleted, which would
 * silently retarget an in-flight edit at the wrong row — and the natural key is also what makes a
 * re-read after a save land on the same React key, so the row does not flicker out and back.
 */
export function declaredRelationshipId(
  entityId: string,
  item: ModelRelationshipItem,
): string {
  return [
    'declared',
    entityId,
    item.target_table_key,
    item.from_columns.join('+'),
    item.to_columns.join('+'),
  ].join('::')
}

const matchesId = (entityId: string, item: ModelRelationshipItem, id: string) =>
  declaredRelationshipId(entityId, item) === id

/**
 * Every stored declaration whose **both** ends are tables the canvas can draw.
 *
 * A declaration onto a table this source has not profiled has nowhere to land, and drawing it as a
 * half-edge reads as a rendering fault rather than as the cross-source declaration it is. Composite
 * joins collapse to their first column pair for display, and `evidence` *says* so — rendering part
 * of a join without naming it would misrepresent it.
 */
export function declaredRelationshipsFrom(
  entities: ModelEntity[],
  tableKeys: string[],
): DeclaredRelationship[] {
  const inScope = new Set(tableKeys)
  const out: DeclaredRelationship[] = []

  for (const entity of entities) {
    if (!inScope.has(entity.table_key)) continue
    for (const item of entity.relationships) {
      if (!inScope.has(item.target_table_key)) continue
      const fromColumn = item.from_columns[0]
      const toColumn = item.to_columns[0]
      if (!fromColumn || !toColumn) continue

      const kind = cardinalityKindFromHint(item.cardinality_hint)
      const composite = item.from_columns.length > 1
      out.push({
        id: declaredRelationshipId(entity.entity_id, item),
        fromTableKey: entity.table_key,
        fromColumn,
        toTableKey: item.target_table_key,
        toColumn,
        name: item.relationship_type,
        cardinality: CARDINALITY_LABELS[kind],
        cardinalityKind: kind,
        rationale: item.rationale,
        status: 'confirmed',
        provenance: 'human',
        evidence: composite
          ? `your declaration (composite join on ${item.from_columns.join(' + ')})`
          : 'your declaration',
        owningEntityId: entity.entity_id,
      })
    }
  }
  return out
}

/** The persisted form of one relationship. Never partial — the server refuses a half-declaration. */
export function toRelationshipItem(
  rel: Pick<
    DeclaredRelationship,
    'toTableKey' | 'fromColumn' | 'toColumn' | 'name' | 'cardinalityKind' | 'rationale'
  >,
): ModelRelationshipItem {
  return {
    target_table_key: rel.toTableKey,
    from_columns: [rel.fromColumn],
    to_columns: [rel.toColumn],
    relationship_type: rel.name.trim(),
    cardinality_hint: rel.cardinalityKind,
    rationale: rel.rationale.trim(),
  }
}

export function relationshipToCanvasEdge(r: DeclaredRelationship): CanvasEdgeVM {
  return {
    id: r.id,
    fromTableKey: r.fromTableKey,
    toTableKey: r.toTableKey,
    name: r.name,
    cardinality: r.status === 'confirmed' ? r.cardinality : undefined,
    status: r.status,
  }
}


/**
 * A minimal entity for a table nobody has written an Overview for yet.
 *
 * Declaring a relationship on such a table is perfectly reasonable and should not send the reader to
 * fill in a form first, so the anchor is created on the fly — seeded from the table's own name, with
 * a description that says plainly where it came from. The Overview panel edits the same row
 * afterwards; this only ever fills a gap and never touches an entity that already exists.
 */
export function anchorEntityInput(
  tableKey: string,
  tableLabel: string,
): ModelEntityInput {
  return {
    table_key: tableKey,
    entity_name: tableLabel,
    description: `Entity for ${tableLabel}, created to anchor a declared relationship.`,
  }
}

/** One write in the sequence a relationship save turns into. */
export interface RelationshipWrite {
  /** The `table_key` this write is about, so the caller can resolve an id after an anchor lands. */
  tableKey: string
  input: ModelEntityInput
}

/**
 * The writes that persist one declaration — assembled here, posted by the store.
 *
 * **Two things make this more than one save.** A declaration lives on the entity anchored to its
 * *from* table, so an edit that moves the from side to a different table changes which entity owns
 * it: the item has to be written to the new owner and removed from the old one. And the *to* table
 * needs an entity too, because a relationship between a declared entity and a bare table leaves one
 * end of the edge unnamed on the canvas.
 *
 * **The order is deliberate.** The new owner is written *before* the old one is cleaned up, so a
 * failure between the two duplicates a declaration — visible, and fixable in one click — rather than
 * dropping it, which is invisible.
 */
export function relationshipWrites(args: {
  rel: Pick<
    DeclaredRelationship,
    | 'fromTableKey'
    | 'toTableKey'
    | 'fromColumn'
    | 'toColumn'
    | 'name'
    | 'cardinalityKind'
    | 'rationale'
  >
  /** The `DeclaredRelationship.id` being edited, absent for a new declaration. */
  editId?: string
  entities: ModelEntity[]
  /** `table_key` → the label an anchor entity should be named after. */
  labelFor: (tableKey: string) => string
}): RelationshipWrite[] {
  const { rel, editId, entities, labelFor } = args
  const writes: RelationshipWrite[] = []

  const owner = entities.find((e) => e.table_key === rel.fromTableKey)
  const target = entities.find((e) => e.table_key === rel.toTableKey)
  if (!target) {
    writes.push({
      tableKey: rel.toTableKey,
      input: anchorEntityInput(rel.toTableKey, labelFor(rel.toTableKey)),
    })
  }

  const item = toRelationshipItem(rel)
  const previousOwner = editId
    ? entities.find((e) =>
        e.relationships.some((r) => matchesId(e.entity_id, r, editId)),
      )
    : undefined

  if (!owner) {
    writes.push({
      tableKey: rel.fromTableKey,
      input: {
        ...anchorEntityInput(rel.fromTableKey, labelFor(rel.fromTableKey)),
        relationships: [item],
      },
    })
  } else {
    /*
     * The owner's array with the edited item replaced, or the new one appended — and any exact
     * duplicate of the new natural key removed. Re-declaring the same join in the same direction is
     * an edit of that declaration, never a second copy of it.
     */
    const newId = declaredRelationshipId(owner.entity_id, item)
    const kept = owner.relationships.filter(
      (r) =>
        declaredRelationshipId(owner.entity_id, r) !== newId &&
        !(editId && matchesId(owner.entity_id, r, editId)),
    )
    writes.push({
      tableKey: owner.table_key,
      input: { entity_id: owner.entity_id, relationships: [...kept, item] },
    })
  }

  if (editId && previousOwner && previousOwner.table_key !== rel.fromTableKey) {
    writes.push({
      tableKey: previousOwner.table_key,
      input: {
        entity_id: previousOwner.entity_id,
        relationships: previousOwner.relationships.filter(
          (r) => !matchesId(previousOwner.entity_id, r, editId),
        ),
      },
    })
  }

  return writes
}

/**
 * The write that removes one stored declaration.
 *
 * `null` when the id addresses nothing: the caller's copy of the entities may simply be a refresh
 * behind, and failing loudly on an already-deleted row is noise rather than information.
 *
 * **It used to cascade into `metrics`**, because a metric whose relationship was gone had no columns
 * to resolve against. That went with the Metrics tab — there is nothing left to cascade into, and a
 * write that cleared a field nothing reads would be the half-removal this repo refuses.
 */
export function removeRelationshipWrite(
  id: string,
  entities: ModelEntity[],
): ModelEntityInput | null {
  const owner = entities.find((e) =>
    e.relationships.some((r) => matchesId(e.entity_id, r, id)),
  )
  if (!owner) return null
  return {
    entity_id: owner.entity_id,
    relationships: owner.relationships.filter(
      (r) => !matchesId(owner.entity_id, r, id),
    ),
  }
}

/** The column a table's entity declares as its identifier, or `undefined` where none is confirmed. */
export function confirmedIdentifier(entity: ModelEntity | null): string | undefined {
  return entity?.attributes.find((a) => a.is_identifier)?.name
}
