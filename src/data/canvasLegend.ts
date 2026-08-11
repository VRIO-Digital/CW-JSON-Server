/**
 * The canvas legend, and the only place a group's colour is decided.
 *
 * Kept beside the component rather than inside it so the mapping can be
 * asserted, and so adding a group means editing one list. A group is a
 * **category**, not a status — the one state the canvas shows is "proposed",
 * and that carries a dashed outline and the word as well as its colour.
 *
 * **The colour says where a node came from, not what type it is.** The knowledge
 * graph is assembled from three sources plus resolution — rows become entity nodes,
 * distinct column values become dimension nodes, uploaded documents become document
 * nodes, and a raw name resolves through an alias — so those four are the classes
 * worth a hue. Four is also the ceiling: this palette is validated pairwise, and on
 * a canvas any two nodes can end up adjacent, so a seven-hue set keyed to the
 * ontology's types would have shipped two pairs nobody can tell apart. The type
 * itself is on the node's sublabel and in the inspector.
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
  { key: 'dimension', label: 'column value → dimension', color: '#1baf7a', ink: '#0f1729' },
  { key: 'document', label: 'document → extracted', color: '#eb6834', ink: '#0f1729' },
  { key: 'alias', label: 'raw name → resolved', color: '#c2427c', ink: '#ffffff' },
] as const

/** The filter chips, in the order they are shown. */
export const CANVAS_FILTERS = [
  { key: 'all', label: 'All types' },
  { key: 'low', label: 'conf < 0.85' },
  { key: 'review', label: 'needs review' },
  { key: 'authored', label: 'studio-authored' },
] as const

export type CanvasFilter = (typeof CANVAS_FILTERS)[number]['key']
