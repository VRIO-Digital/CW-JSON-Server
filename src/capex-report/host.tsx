/**
 * The one thing the vendored renderers need from the app around them: a way to open another report.
 *
 * **Why this exists.** `Calendar.jsx` drills from a filing month into Project 360 at one project's
 * coordinate, and it did that with a `react-router` `<Link to="/reports/project-360?project=…">`. That is
 * a route the standalone app has and this one does not: `/reports` here is a single address and which
 * report is open is `openId` in the store. Left alone, the link rendered a control that navigated to
 * nothing — worse than a disabled one, and it crashed `renderToString` outright for want of a router.
 *
 * So the host injects the act instead of the renderer assuming a URL. `PublishedReportPane` supplies
 * `openReport`, which is the store's `open()` — the same path the Library's own button takes, so a drill
 * cannot end up somewhere the Library could not.
 *
 * **The coordinate travels with it, and is not applied.** This build carries **one resolved run per
 * report**, so opening Project 360 at a different project cannot re-resolve it — the figures would be
 * the run's own under a name the reader did not click, which is the single thing `ReportView`'s
 * `seedMismatch` notice exists to prevent. The coordinate is recorded and handed back so that notice can
 * say *"this run is resolved at X, not Y"*, exactly as the standalone app does from the query string.
 *
 * Default is a no-op with a null coordinate: the folder standing alone (or a host that provides nothing)
 * renders the chip as a disabled button rather than a link to nowhere, which is what `Calendar` already
 * does when it cannot resolve a drill target.
 */

import { createContext, useContext } from 'react'

export type ReportCoordinate = { param: string; value: string } | null

export type CapexHost = {
  /** Open another report in this pane. `coordinate` is what the reader asked for, not what is served. */
  openReport: (reportId: string, coordinate: ReportCoordinate) => void
  /** What the reader asked for when they arrived here, so a mismatch can be named. */
  coordinate: ReportCoordinate
}

const NO_HOST: CapexHost = {
  openReport: () => {},
  coordinate: null,
}

export const CapexHostContext = createContext<CapexHost>(NO_HOST)

/** The host's seam. Never null — an absent provider is the no-op host above. */
export const useCapexHost = (): CapexHost => useContext(CapexHostContext)
