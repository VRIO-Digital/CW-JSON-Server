/**
 * The canvas legend, and the only place a group's colour is decided.
 *
 * Kept beside the component rather than inside it so the mapping can be
 * asserted, and so adding a group means editing one list. A group is a
 * **category**, not a status — the one state the canvas shows is "proposed",
 * and that carries a dashed outline and the word as well as its colour.
 *
 * **The colour says where a node came from, not what type it is.** The knowledge
 * graph is assembled from source rows plus documents plus resolution — a registry or
 * ledger row becomes an entity or event node, an uploaded document becomes a
 * document node, a raw name resolves through an alias — and the fourth class is the
 * elements that are not instances at all: the type-level concepts and the measure
 * elements the build nominated. Four is the ceiling: this palette is validated
 * pairwise, and on a canvas any two nodes can end up adjacent, so a nine-hue set
 * keyed to the ontology's types would have shipped several pairs nobody can tell
 * apart. The type and the element class are on the node's sublabel and in the
 * inspector.
 *
 * **`dimension` was one of these and is deliberately gone.** The earlier graph
 * promoted distinct column values to nodes — waste codes, violation types,
 * enforcement types. The demo package now lists all three under `not_nodes`: a code
 * carried on a row is an attribute of the shipment, not an entity with its own
 * registry. Keeping the row would be a colour with no members advertising a claim
 * the graph denies, which is worse than a missing legend entry — so the hue moved to
 * the class that replaced it.
 *
 * The hues pass the categorical checks all-pairs (lightness band, chroma floor, CVD
 * separation, normal-vision floor ≥ 15). The green sits below 3:1 against white,
 * which obligates the direct labels every node already carries.
 *
 * `ink` is the label colour **on** that fill, and it is measured rather than
 * chosen: white reaches 4.5:1 on the blue and the magenta but only 2.8:1 on the
 * green, so the two lighter hues take dark ink instead. `check-docs` recomputes
 * every pair, because a label nobody can read is not a label — and it earned its
 * keep immediately: the blue started at `#2a78d6`, which carries white at 4.42:1,
 * a hair under the floor. It is one step darker for that reason and no other.
 */
export const CANVAS_GROUPS = [
  { key: 'row', label: 'row → entity', color: '#2570cd', ink: '#ffffff' },
  { key: 'schema', label: 'type-level → concept / measure', color: '#1baf7a', ink: '#0f1729' },
  { key: 'document', label: 'document → extracted', color: '#eb6834', ink: '#0f1729' },
  { key: 'alias', label: 'raw name → resolved', color: '#c2427c', ink: '#ffffff' },
] as const

/**
 * The **type ring**: a stroke on the node's rim that names its ontology type.
 *
 * The fill answers "where did this come from"; the ring answers "what kind of thing
 * is it". Two encodings rather than one palette of nine, because nine categorical
 * fills cannot stay distinguishable when any two circles can be adjacent — that is
 * the same ceiling that caps `CANVAS_GROUPS` at four.
 *
 * **A ring only exists where a fill carries more than one type.** `row` holds five
 * (Facility · Manifest · Evaluation · Violation · Enforcement) and `schema` holds two
 * (Concept · Measure), so those seven are ringed. `document` and `alias` hold exactly
 * one type each — their fill already names it, and a ring there would encode the same
 * fact twice. It would also fail: the only hues close to those fills are the fills.
 *
 * That constraint is what makes the palette possible. A ring only has to separate its
 * *siblings on the same fill*, never all nine at once, so:
 *
 *  - against the page outside it, every ring clears **3:1**, the non-text bar;
 *  - against the fill inside it, **3:1 or a hue turn of 40°** — a boundary reads by
 *    either, and a ring dark enough to clear 3:1 against the mid-blue row fill would
 *    have to be near-black, which would make nine near-blacks and discriminate
 *    nothing;
 *  - against a sibling, a 40° hue gap or 2:1.
 *
 * `check-docs` recomputes all four rules. They were not free: a first pass used the
 * demo viewer's own light hues and failed twelve ways — light rings hold against
 * neither a mid-tone fill nor a white page — and Facility's slate-blue ring sat 6°
 * from the blue it was drawn on, which reads as no ring at all.
 */
export const CANVAS_TYPE_RINGS = [
  /* Facility is the row fill's baseline — 49 of 189 — so its ring is a true neutral:
     "a row, nothing further to say". */
  { type: 'Facility', group: 'row', color: '#3f3f46' },
  { type: 'Manifest', group: 'row', color: '#7c3aed' },
  { type: 'Evaluation', group: 'row', color: '#047857' },
  { type: 'Violation', group: 'row', color: '#b45309' },
  { type: 'Enforcement', group: 'row', color: '#be123c' },
  { type: 'Concept', group: 'schema', color: '#0f1729' },
  { type: 'Measure', group: 'schema', color: '#a21caf' },
] as const

/** Types the fill alone identifies, so they carry no ring. */
export const CANVAS_UNRINGED = [
  { type: 'Document', group: 'document' },
  { type: 'Alias', group: 'alias' },
] as const

/** The filter chips, in the order they are shown. */
export const CANVAS_FILTERS = [
  { key: 'all', label: 'All types' },
  { key: 'low', label: 'conf < 0.85' },
  { key: 'review', label: 'needs review' },
  { key: 'authored', label: 'studio-authored' },
] as const

export type CanvasFilter = (typeof CANVAS_FILTERS)[number]['key']
