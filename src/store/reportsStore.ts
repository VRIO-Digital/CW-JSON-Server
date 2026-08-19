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

import { getReport, getReports, type Report, type ReportsIndex } from '../api/client'
import { toMessage } from './asyncState'

type ReportsState = {
  /** The section: the five definitions, the publish counts, the governance view. */
  index: ReportsIndex | null
  loading: boolean
  error: string | null

  /** Which report is open, set the moment it is asked for. `null` is the list. */
  openId: string | null
  report: Report | null
  reportLoading: boolean
  reportError: string | null

  load: (asRole?: string | null) => Promise<void>
  open: (reportId: string) => Promise<void>
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
    /* Set first, so a second click is already the current request by the time the first returns. */
    set({ openId: reportId, report: null, reportError: null, reportLoading: true })
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

  close: () => set({ openId: null, report: null, reportError: null, reportLoading: false }),
}))

const NO_REPORTS: ReportsIndex['reports'] = []

/** Stable reference — `index?.reports ?? []` allocates every render and defeats memos downstream. */
export const selectReportSummaries = (s: ReportsState): ReportsIndex['reports'] =>
  s.index?.reports ?? NO_REPORTS
