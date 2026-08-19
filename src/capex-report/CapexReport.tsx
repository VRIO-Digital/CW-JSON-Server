/**
 * One CAPEX report, drawn by its own package's renderers.
 *
 * **The host boundary, and the only file here this repo wrote.** Everything beside it is vendored from
 * `src/report/` — nineteen block renderers, the primitives, the filter and trust bars, the state
 * provider and a 2,322-line stylesheet — carried over the way `src/reports/` and `src/graph-viewer/`
 * were, rather than reimplemented. This file is the seam: it takes the payload the server served,
 * hydrates the specs the renderers look labels up in, and puts the whole thing inside the class its
 * stylesheet is scoped under.
 *
 * **Why a second report renderer exists at all.** `reportView` computes every figure per request from a
 * roster, which is right for a report defined as a question over rows this app holds — EPA's five are
 * exactly that. CAPEX's three are not: they are a resolver's output, every number already a `display` or
 * `exact` string, and re-deriving them here would be a second implementation of the aggregation rules
 * that agrees with the first until one of them is edited. So the server says which kind a report is and
 * this draws the kind it does not compute.
 *
 * **The wrapper class is load-bearing.** `capex-report.css` sets `*{margin:0;padding:0}` and bare `body`,
 * `a` and `h1,h2,h3` rules folded onto `.cw-capex-report`; without the class on an ancestor the sheet
 * does nothing, and with the sheet unscoped it would reset every antd component in the app. The
 * generated header on that file says the same thing from the other side.
 *
 * **It mounts no portal**, which is why nothing here needs the `display: contents` treatment the EPA
 * prototype's menu host required — that host portals to `document.body`, outside its wrapper, and lost
 * its `position` and background when its sheet was scoped, which is how Delete came to look like a dead
 * button. `Toasts` and `ProvPopover` render inside the tree. Re-check this if a renderer grows a portal.
 */

import { useEffect, useMemo, useState } from 'react'

/* Vendored, and untyped — `.jsx` with no annotations, exactly as it arrived. `allowJs` is off, so they
   resolve through `vendored.d.ts` beside this file rather than being type-checked. */
import ReportView from './ReportView.jsx'
import { ReportStateProvider } from './ReportState.jsx'
import { Toasts, ProvPopover } from './Primitives.jsx'
import { CapexHostContext, type ReportCoordinate } from './host'
import { hydrate as hydrateSpecs } from './specs.js'
import './capex-report.css'

/**
 * Whether the run on screen answers the coordinate the reader asked for.
 *
 * Vendored in behaviour from the standalone app's `findSeedMismatch`, which read the query string. Here
 * the coordinate comes from the drill that opened this report, because the host has no per-report URL.
 *
 * **Compared against `activeParams`, not a param's `selected`.** `activeParams` is the resolver's own
 * record of what the run was resolved at; a spec default can populate `selected` without the run having
 * been narrowed to it, so comparing against that would report a mismatch that is not one.
 */
function seedMismatchOf(view: unknown, coordinate: ReportCoordinate) {
  if (!coordinate) return null
  const v = (view ?? {}) as Record<string, unknown>
  const active = (v.activeParams ?? {}) as Record<string, unknown>
  const have = active[coordinate.param]
  if (!have) return null
  const haveList = Array.isArray(have) ? have.map(String) : [String(have)]
  if (haveList.includes(coordinate.value)) return null
  /* Named in the label the report uses for the coordinate, never the raw id. */
  const params = (v.params ?? []) as { id?: string; label?: string; labels?: Record<string, string> }[]
  const p = params.find((x) => x.id === coordinate.param) ?? {}
  const labelOf = (value: string) => p.labels?.[value] ?? value
  return {
    param: String(p.label ?? coordinate.param).toLowerCase(),
    have: haveList.map(labelOf).join(', '),
    want: labelOf(coordinate.value),
  }
}

export default function CapexReport({
  view,
  specs,
  onOpenReport,
  coordinate = null,
}: {
  /** The resolved run, verbatim from the document — `reports.resolved[reportId]`. */
  view: unknown
  /** The report specs the renderers look a label up in, served beside the run. */
  specs: unknown[]
  /**
   * Open another report in this pane. The calendar drills into Project 360 this way, because the host has
   * one `/reports` address rather than a route per report — see `host.tsx`.
   */
  onOpenReport?: (reportId: string, coordinate: ReportCoordinate) => void
  /** What the reader asked for, so a run resolved elsewhere can say so instead of quietly answering. */
  coordinate?: ReportCoordinate
}) {
  /*
   * Hydrated before the first render rather than in an effect, because a renderer that looked a label up
   * during the initial paint would get `undefined` and print the raw id. `useState`'s initialiser runs
   * once, in render, ahead of the children — the same reason `src/reports/data.ts` is hydrated before the
   * prototype mounts rather than beside it.
   */
  useState(() => {
    hydrateSpecs(specs)
    return null
  })

  /* And again if the served specs change under us, which happens when a reader opens a report from a
     different dataset without unmounting this component. */
  useEffect(() => {
    hydrateSpecs(specs)
  }, [specs])

  const host = useMemo(
    () => ({ openReport: onOpenReport ?? (() => {}), coordinate }),
    [onOpenReport, coordinate],
  )

  return (
    /*
     * **`data-theme="light"`, because this app is light and the vendored sheet defaults to dark.**
     *
     * The sheet declares its palette as `:root, [data-theme="dark"]{…}` with `[data-theme="light"]{…}`
     * below it — the standalone app shipped `data-theme="light"` on `<html>` and `Shell.jsx` toggled it.
     * `Shell` was dropped on the way in (this app draws its own chrome), so nothing set the attribute and
     * the report rendered **dark inside a light page** — the vendored-dark problem the graph viewer had,
     * except the light palette is already here and only needed asking for.
     *
     * Stated on the wrapper rather than left to the sheet's default, so the report cannot come back dark
     * because a token block was reordered. If this app ever grows a dark mode, this is the one line that
     * has to read it instead of being fixed.
     */
    <div className="cw-capex-report" data-theme="light">
      <CapexHostContext.Provider value={host}>
        <ReportStateProvider>
          <ReportView view={view} seedMismatch={seedMismatchOf(view, coordinate)} />
          {/* The vendored toast host and provenance popover, inside the scope rather than portalled. */}
          <Toasts />
          <ProvPopover />
        </ReportStateProvider>
      </CapexHostContext.Provider>
    </div>
  )
}
