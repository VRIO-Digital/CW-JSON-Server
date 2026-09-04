/**
 * The Data Modeling canvas's geometry — pure, and here rather than in the component for the reason
 * `datasetPathFix` is: a layout rule written inside a component can only be asserted by rendering
 * the component, and `renderToString` gives it its *initial* state with no measured box at all.
 *
 * Nothing in this file knows what a table is. It takes ids and heights and answers with rectangles,
 * so the canvas can be asserted against a fabricated set of five tables without a payload.
 */

/** One relationship the canvas can draw. */
export interface CanvasEdgeVM {
  id: string
  fromTableKey: string
  toTableKey: string
  /** The relationship's own name, e.g. `LINKED_BY_MANIFEST_TRACKING_NUMBER`. */
  name: string
  /** `1:N (one to many)` — absent on a suggestion nobody has confirmed yet. */
  cardinality?: string
  status: 'confirmed' | 'pending'
}

export interface NodeRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * A node card's width, and where the grid starts.
 *
 * The width is the reference build's own card width. The origin and the pitch are **not** — they are
 * tightened, because the reference spaced three fixed example cards and a real source brings up to
 * sixty-four of wildly different heights. Row pitch is computed per row from that row's tallest
 * card (see `layoutPositions`) rather than fixed, or a tall card overlaps the one below it.
 */
export const NODE_W = 168
const ORIGIN_X = 20
const ORIGIN_Y = 20
const COL_GAP = 40
const COL_PITCH = NODE_W + COL_GAP
const ROW_GAP = 24
const COLS = 2

/** The card head: a 20px mark plus 9px above and below. */
const HEADER_H = 38
/** The card body's own padding, 8px above and 10px below. */
const BODY_PAD = 18
/** One column row: 10.5px type at 1.5 line-height plus 1.5px above and below. */
export const ROW_H = 19
/**
 * A collapsible section header, taller than a row because it carries a chevron and a `+`.
 *
 * **One of them, since the Metrics section went with its tab.** The height below counted two, and
 * leaving it at two would have left every card 26px of empty space at the bottom — a gap that reads
 * as a layout fault rather than as a removed section, and the kind of thing a removal leaves behind
 * when only the markup is deleted.
 */
export const SECTION_ROW_H = 26
/**
 * Column rows a card shows before it collapses the rest into "and N more".
 *
 * A profiled table here can carry ninety columns; listing them would make one card taller than the
 * viewport and the canvas unreadable. The cap is **stated on the card**, never a silent truncation.
 */
export const MAX_COLUMN_ROWS = 6

export function nodeContentHeight(opts: {
  columnRowCount: number
  hasMoreLine: boolean
  hasSummaryLine: boolean
}): number {
  const plainRows =
    opts.columnRowCount + (opts.hasMoreLine ? 1 : 0) + (opts.hasSummaryLine ? 1 : 0)
  /* The Relationships section, always present, collapsed. */
  return HEADER_H + BODY_PAD + plainRows * ROW_H + SECTION_ROW_H
}

/**
 * x/y per table, laid out in a `COLS`-wide grid.
 *
 * A row's height is its own tallest card plus the gap, computed here rather than assumed, so two
 * stacked cards never overlap however many column rows either one renders.
 */
export function layoutPositions(
  tableKeys: string[],
  heightOf: (tableKey: string) => number,
): Record<string, { x: number; y: number }> {
  const rowMaxHeight: number[] = []
  tableKeys.forEach((key, i) => {
    const row = Math.floor(i / COLS)
    rowMaxHeight[row] = Math.max(rowMaxHeight[row] ?? 0, heightOf(key))
  })
  const rowY: number[] = []
  let acc = ORIGIN_Y
  for (let r = 0; r < rowMaxHeight.length; r += 1) {
    rowY[r] = acc
    acc += rowMaxHeight[r] + ROW_GAP
  }
  const positions: Record<string, { x: number; y: number }> = {}
  tableKeys.forEach((key, i) => {
    positions[key] = {
      x: ORIGIN_X + (i % COLS) * COL_PITCH,
      y: rowY[Math.floor(i / COLS)],
    }
  })
  return positions
}

export interface ContentBox {
  x: number
  y: number
  w: number
  h: number
}

/** The box every laid-out node fits in, with a margin — what **Fit** frames. */
export function contentBoundingBox(
  rects: Record<string, NodeRect>,
  padding = 24,
): ContentBox {
  const list = Object.values(rects)
  if (list.length === 0) return { x: 0, y: 0, w: 480, h: 320 }
  const minX = Math.min(...list.map((r) => r.x)) - padding
  const minY = Math.min(...list.map((r) => r.y)) - padding
  const maxX = Math.max(...list.map((r) => r.x + r.w)) + padding
  const maxY = Math.max(...list.map((r) => r.y + r.h)) + padding
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function rectCenter(r: NodeRect): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

/**
 * The point on `from`'s border facing `to`'s centre.
 *
 * An edge drawn centre-to-centre disappears under both cards; this is what makes it touch the edge
 * of each one instead.
 */
export function rectBoundaryToward(
  from: NodeRect,
  to: NodeRect,
): { x: number; y: number } {
  const c = rectCenter(from)
  const oc = rectCenter(to)
  const dx = oc.x - c.x
  const dy = oc.y - c.y
  if (dx === 0 && dy === 0) return c
  const scaleX = dx !== 0 ? from.w / 2 / Math.abs(dx) : Infinity
  const scaleY = dy !== 0 ? from.h / 2 / Math.abs(dy) : Infinity
  const scale = Math.min(scaleX, scaleY, 1)
  return { x: c.x + dx * scale, y: c.y + dy * scale }
}
