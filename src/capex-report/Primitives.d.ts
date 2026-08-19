/** Types for the vendored `Primitives.jsx` — see the note in `ReportView.d.ts`. */
import type { ReactElement } from 'react'

/** The toast host. Renders **inside** the tree — it does not portal to `document.body`. */
export function Toasts(): ReactElement
/** The provenance popover, likewise in-tree. */
export function ProvPopover(): ReactElement
