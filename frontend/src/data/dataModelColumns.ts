/**
 * What a column's row on a canvas card shows for its type.
 *
 * **A module of its own because it outlived the one it lived in.** This sat in
 * `dataModelMetrics.ts`, which went with the Metrics tab — and it has nothing to do with metrics: it
 * is the canvas's own glyph for a column. Folding it into `dataModelCanvas.ts` instead would have
 * broken that file's stated rule (*"nothing in this file knows what a table is"* — it takes ids and
 * heights and answers with rectangles), so it gets a small file that says what it is.
 */

/**
 * The glyph a column row carries, from the facet the **server** already assigned.
 *
 * Read off `facet` rather than re-bucketed here, for the reason the dictionary's chips are: the panel
 * used to hold its own copy of the class→chip fold, and two copies disagree — a chip counting 69 and
 * listing 41. `null` for a class with no chip, which takes the plain text glyph.
 */
export function columnGlyph(facet: string | null): 'date' | 'number' | 'key' | 'text' {
  if (facet === 'dates') return 'date'
  if (facet === 'measures') return 'number'
  if (facet === 'ids') return 'key'
  return 'text'
}
