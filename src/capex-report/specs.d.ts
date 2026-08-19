/** Types for `specs.js` — see the note in `ReportView.d.ts`. */

/** Take the served specs. Called before the first render, never in an effect. */
export function hydrate(served: unknown[]): void
/** True once a payload has been taken, so "empty" is distinguishable from "not yet". */
export function isHydrated(): boolean
/** One report's spec, or `undefined` for an id nothing carries. */
export function reportById(id: string): unknown
