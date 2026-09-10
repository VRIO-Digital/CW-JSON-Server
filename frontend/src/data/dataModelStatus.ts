/**
 * One table's declaration status, as the Entity detail header states it.
 *
 * **This replaced five per-field badges, and the replacement is the point.** Overview carried a
 * `ProvenanceBadge` beside *Entity name*, *What does this table represent?*, *Business purpose*,
 * *Grain* and *Confirmed identifier* — five marks answering the same question five times, on a form
 * whose every field is saved by one button. Removed on request: the question is about the table, so
 * it is answered once, beside the table's name.
 *
 * **Pure, and in `src/data/` for the reason `datasetPathFix` is.** A rule written inside the panel
 * could only be asserted by rendering the panel's own state, and `renderToString` gives that its
 * initial value — which is exactly the shape of test that passes over nothing.
 */

import type { ModelEntity } from '../api/client'

/** The three states a table can be in. */
export type TableDeclarationState = 'undeclared' | 'derived' | 'confirmed'

/**
 * What this table's declaration is.
 *
 * **Read off `confirmed_by`, which only a Save Overview writes.** That button is unambiguously a
 * person's act — every other way an entity comes into existence is machinery: an anchor for a
 * relationship, or fields seeded from the table's own catalogue row. So the three states are *no
 * entity at all*, *an entity nobody has saved*, and *an entity somebody saved*.
 *
 * It read *Declared* for any existing entity before, which was wrong for all 14 of CAPEX's: they
 * are anchors, minted by `relationshipWrites` whenever a relationship points at an undeclared
 * table, and their own description says so.
 */
export function tableDeclarationState(entity: ModelEntity | null): TableDeclarationState {
  if (!entity) return 'undeclared'
  return entity.confirmed_by ? 'confirmed' : 'derived'
}

/**
 * **Which `ProvenanceBadge` kind a declared table wears — and `null` where the answer is a status
 * rather than a provenance.**
 *
 * This is the correction the colour caught. The header first drew all three through `StatusPill`,
 * so *Curated by AI* arrived **amber** while the same words on every relationship row beside it were
 * **purple**. That is precisely the confusion the two marks are separate components to prevent:
 * status is green/amber/red and provenance is green/purple, and a single mark for both has to pick
 * one meaning for green. *Curated by AI* and *Confirmed by you* are statements about **who**, so
 * they belong to the provenance palette; *Not yet declared* is a state, so it keeps the neutral
 * status pill.
 *
 * **And the words are not repeated here.** They were, briefly — a `TABLE_STATUS_LABELS` map holding
 * "Curated by AI" and "Confirmed by you" a second time, beside `ProvenanceBadge`'s own
 * `PROVENANCE_WORDS`. Two spellings of one label is how a rename reaches one surface and not the
 * other, which is the drift `DERIVED_LABEL` exists as a single constant to stop. The badge owns its
 * words; this owns only which badge.
 */
export const TABLE_STATUS_KIND: Record<
  TableDeclarationState,
  'human' | 'derived' | null
> = {
  undeclared: null,
  derived: 'derived',
  confirmed: 'human',
}

/** The one label this module owns, because no provenance badge says it. */
export const TABLE_UNDECLARED_LABEL = 'Not yet declared'
