/**
 * Types for the vendored `ReportState.jsx` — see the note in `ReportView.d.ts`.
 *
 * **Only what this repo imports is declared, and it was read off the file rather than assumed.** A
 * declaration file is a claim the compiler *trusts*: the first draft of this one declared `Toasts` and
 * `ProvPopover` here, `tsc` accepted it, and the build failed with `"Toasts" is not exported by
 * ReportState.jsx` — they live in `Primitives.jsx`. So a `.d.ts` over vendored code moves an error from
 * the type checker to the bundler unless it is written against the actual exports.
 */
import type { ReactElement, ReactNode } from 'react'

/** The renderers' own context: the open modal, the lineage drawer, the toast queue. */
export function ReportStateProvider(props: { children: ReactNode }): ReactElement
