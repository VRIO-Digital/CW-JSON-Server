/**
 * The report specs the vendored renderers read for labels — served, never bundled.
 *
 * **Why this module exists at all.** The standalone app read its specs out of a 1.5 MB fixture it
 * imported statically, which made every label on screen a thing the bucket could not change. That is
 * the exact problem `src/reports/data.ts` was written to solve for the EPA prototype, and this is the
 * same shape: `GET /reports/:id` carries the specs beside the resolved run, `hydrate` assigns, and the
 * renderers see the served values without any of them changing.
 *
 * **The exports are `let`, and that is what makes one fetch reach every consumer.** ES module bindings
 * are live, so assigning here updates every importer. It holds only because **no consumer reads them at
 * module scope** — `reportById` is called from inside a render, which was checked before this was
 * written. The empty default is not a fallback: nothing renders against it, it exists so a stray render
 * during the fetch cannot throw on `undefined.find`.
 */

let specs = []

/** Every spec, keyed by nothing — the renderers look one up by id. */
export const hydrate = (served) => {
  specs = Array.isArray(served) ? served : []
}

/** True once a payload has been taken, so a caller can tell "empty" from "not yet". */
export const isHydrated = () => specs.length > 0

/**
 * One report's spec.
 *
 * Returns `undefined` for an id nothing carries, which is what the standalone `reportById` did — the
 * blocks that call it already guard, and inventing an empty spec would give a block labels for a report
 * that does not exist.
 */
export const reportById = (id) => specs.find((s) => s.id === id)
