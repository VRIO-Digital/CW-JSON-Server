/**
 * The report section's list, and one report at a time.
 *
 * **A report is a question re-asked, so this store holds no figures of its own.** `db.reports` stores
 * no result and `reportView` computes every series, every table order and every tile per request — so
 * `open()` fetches and keeps what the server said, and nothing here sums a column. A selector that
 * derived a total would be a second answer to a figure the report already states.
 *
 * **The requested id is kept beside the report, and that is load-bearing.** Opening one report and then
 * another before the first returns would otherwise leave the slower reply overwriting the faster one —
 * one report's tiles under another's heading, which reads as data rather than as a race. `openId` is set
 * synchronously on the click and every reply is dropped unless it is still the one being asked for.
 */

import { create } from 'zustand'

import {
  buildReport,
  getReport,
  getReports,
  type BuiltReport,
  type Report,
  type ReportFrame,
  type ReportsIndex,
} from '../api/client'
import { toMessage } from './asyncState'

type ReportsState = {
  /** The section: the five definitions, the publish counts, the governance view. */
  index: ReportsIndex | null
  loading: boolean
  error: string | null

  /** Which report is open, set the moment it is asked for. `null` is the list. */
  openId: string | null
  report: Report | BuiltReport | null
  reportLoading: boolean
  reportError: string | null

  /**
   * The filters in force, as the frame carries them: one entry per selected value.
   *
   * **Two entries with the same key mean "either"** — the server ORs within a facet and ANDs across
   * them, so `risk=high, risk=med` reads as "high or medium". Kept here rather than in the component
   * because re-asking is a request, and a control holding the request's own state is how a chip comes to
   * show one thing while the report shows another.
   */
  filters: ReportFrame['filters']
  /** True while a re-ask is in flight, so the chips can say so without blanking the report. */
  filtering: boolean

  load: (asRole?: string | null) => Promise<void>
  open: (reportId: string) => Promise<void>
  /**
   * Re-ask with an explicit filter set. The two chip actions below are the callers; it is declared so
   * they share one request path rather than each building a frame.
   */
  reask: (filters: ReportFrame['filters']) => Promise<void>
  /**
   * Set every value selected on one facet, and re-ask.
   *
   * One action rather than add/remove/clear, because a multi-select reports its whole selection on every
   * change — reconstructing "what was added" from that would be inventing an event the control never
   * sent. An empty list is the facet's "All".
   */
  setFacet: (key: string, values: string[]) => Promise<void>
  close: () => void
}

export const useReportsStore = create<ReportsState>()((set, get) => ({
  index: null,
  loading: false,
  error: null,

  openId: null,
  report: null,
  reportLoading: false,
  reportError: null,
  filters: [],
  filtering: false,

  load: async (asRole) => {
    set({ loading: true })
    try {
      set({ index: await getReports(asRole ?? null), error: null, loading: false })
    } catch (error) {
      /* A failed reload leaves the previous list on screen rather than blanking it. */
      set({ error: toMessage(error), loading: false })
    }
  },

  open: async (reportId) => {
    /* Set first, so a second click is already the current request by the time the first returns. Filters
       reset with it: they belong to the report being read, and carrying them across would apply one
       report's slice to another's rows — or name a facet the new spine does not have, which the server
       would refuse with a sentence about a report the reader had already left. */
    set({
      openId: reportId,
      report: null,
      reportError: null,
      reportLoading: true,
      filters: [],
    })
    try {
      const { report } = await getReport(reportId)
      /* Still the report being asked for? If not, this reply belongs to a heading nobody is reading. */
      if (get().openId !== reportId) return
      set({ report, reportLoading: false })
    } catch (error) {
      if (get().openId !== reportId) return
      set({ reportError: toMessage(error), reportLoading: false })
    }
  },

  /**
   * Re-ask the open report with a changed filter set.
   *
   * The frame comes from the report the server last returned, so scope, measure, horizon and the graph
   * are the ones it was actually built under — reconstructing them here would be a second answer to what
   * the question was. Only the filters change.
   *
   * `filtering` rather than `reportLoading`, so the report stays on screen while it re-asks: blanking it
   * would flash the whole page on a chip click.
   */
  reask: async (filters) => {
    const current = get().report
    const openId = get().openId
    if (!current || !openId) return

    set({ filters, filtering: true })
    try {
      const next = await buildReport({ ...current.frame, filters })
      /* Still the same report, and still the same filters? A second click while this was in flight owns
         the answer, and this one is about a selection nobody is looking at. */
      if (get().openId !== openId || JSON.stringify(get().filters) !== JSON.stringify(filters)) return
      set({ report: next, filtering: false, reportError: null })
    } catch (error) {
      if (get().openId !== openId) return
      /* The report on screen is still the last good one, so this reports the *re-ask* failing rather
         than pretending the report is gone. */
      set({ reportError: toMessage(error), filtering: false })
    }
  },

  setFacet: async (key, values) => {
    /* Every other facet's selection is kept and this one is replaced wholesale — the control owns its own
       facet and nothing else's. */
    const others = get().filters.filter((f) => f.key !== key)
    await get().reask([...others, ...values.map((value) => ({ key, value }))])
  },

  close: () =>
    set({
      openId: null,
      report: null,
      reportError: null,
      reportLoading: false,
      filters: [],
      filtering: false,
    }),
}))

const NO_REPORTS: ReportsIndex['reports'] = []

/** Stable reference — `index?.reports ?? []` allocates every render and defeats memos downstream. */
export const selectReportSummaries = (s: ReportsState): ReportsIndex['reports'] =>
  s.index?.reports ?? NO_REPORTS
