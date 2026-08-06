/**
 * The canvas legend, and the only place a group's colour is decided.
 *
 * Kept beside the component rather than inside it so the mapping can be
 * asserted, and so adding a group means editing one list. A group is a
 * **category**, not a status — the one state the canvas shows is "proposed",
 * and that carries a dashed outline and the word as well as its colour.
 */
export const CANVAS_GROUPS = [
  { key: 'assets', label: 'units & assets', color: '#f4562b' },
  { key: 'work', label: 'work & plans', color: '#1668dc' },
  { key: 'contracts', label: 'contracts & clauses', color: '#0f7b4f' },
  { key: 'proposed', label: 'proposed · under review', color: '#a16207' },
] as const

/** The filter chips, in the order they are shown. */
export const CANVAS_FILTERS = [
  { key: 'all', label: 'All types' },
  { key: 'low', label: 'conf < 0.85' },
  { key: 'review', label: 'needs review' },
  { key: 'authored', label: 'studio-authored' },
] as const

export type CanvasFilter = (typeof CANVAS_FILTERS)[number]['key']
