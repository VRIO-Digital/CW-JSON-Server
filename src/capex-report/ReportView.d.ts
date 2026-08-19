/**
 * Types for the vendored `ReportView.jsx`.
 *
 * **A sibling declaration rather than `allowJs` or a suppression.** `allowJs` is off and these are the
 * only untyped files under `src/`, so an import of one is "Cannot find module" rather than a silent
 * `any`. Turning `allowJs` on would change how `tsc` treats the whole project for the sake of one
 * vendored folder; `@ts-expect-error` would have to be repeated at every future call site *and* errors
 * once the error goes away, so converting a file later would break the build in a way that reads as
 * unrelated. `moduleResolution: "bundler"` resolves `./ReportView.jsx` to this file.
 *
 * The shape is deliberately loose. `view` is a resolver's output with ~40 top-level keys that only the
 * vendored renderers read; enumerating them here would be a second declaration of somebody else's
 * contract, stale the moment the package regenerates. The same reasoning leaves `PROTOTYPE_PAYLOAD`'s
 * `dataset` as `unknown` in `client.ts`.
 */
import type { ReactElement } from 'react'

/** One resolved report, drawn. `seedMismatch` names a coordinate this run is not resolved at. */
export default function ReportView(props: {
  view: unknown
  seedMismatch: { param: string; have: string; want: string } | null
}): ReactElement
