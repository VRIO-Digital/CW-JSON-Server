import { create } from 'zustand'
import {
  buildReport,
  deleteSavedReport,
  setSavedReportRoles,
  getReport,
  getReports,
  getSavedReport,
  readReportQuestion,
  saveReport,
  type BuiltReport,
  type Report,
  type ReportFrame,
  type ReportGraph,
  type ReportReadBack,
  type ReportsIndex,
  type SavedReport,
} from '../api/client'
import { createReadStore, toMessage, type Result } from './asyncState'

/*
 * The report section, in two stores because it is two reads.
 *
 * `useReportsStore` is the section list and needs nothing but `createReadStore` —
 * one endpoint, no arguments, no state beyond what came back.
 *
 * `useReportStore` is one report, keyed by the id in the URL, which `createReadStore`
 * cannot express: its `load()` takes no argument. It keeps the id it loaded beside the
 * report so a page arriving at a different id re-fetches rather than rendering the
 * previous one under the new heading — the failure a plain `data` field invites.
 */
/*
 * The section list, read **as a persona**: `load(roleId)` forwards to `getReports(asRole)`, so
 * the entitlement banner's counts are true of the reader. A role the server does not know is
 * ignored there rather than refused — the safe direction for a control the copy calls a demo.
 */
export const useReportsStore = createReadStore<ReportsIndex, [(string | null)?]>(getReports)

interface ReportState {
  /** The id this store holds a report for, or was last asked for. */
  reportId: string | null
  report: Report | BuiltReport | null
  /** True while a chip's re-ask is in flight — the chips disable rather than lie. */
  slicing: boolean
  /** 0 while nothing is connected — the page shows the gate rather than a report. */
  connectedSources: number
  /** 0 while nothing is published, which is the second gate and a different fix. */
  publishedCount: number
  builtCount: number
  draftCount: number
  loading: boolean
  error: string | null
  load: (reportId: string) => Promise<void>
  /**
   * Re-ask this report with one facet filter, or none.
   *
   * A chip cannot hide rows locally: the tiles and the charts above the table are the
   * server's figures, and filtering only the rows would leave them describing a set the
   * table no longer shows. So the report is rebuilt under **its own frame** plus the
   * filter — the frame it states, not one reconstructed from its labels.
   */
  slice: (filter: { key: string; value: string } | null) => Promise<Result>
}

export const useReportStore = create<ReportState>()((set, get) => ({
  reportId: null,
  report: null,
  slicing: false,
  connectedSources: 0,
  publishedCount: 0,
  builtCount: 0,
  draftCount: 0,
  loading: false,
  error: null,

  load: async (reportId) => {
    /* A different report is a different page: the old one is dropped before the
       request, so a slow fetch cannot leave Report 2's tiles under Report 5's
       heading. Re-loading the *same* id keeps what is on screen. */
    const switching = get().reportId !== reportId
    set({
      reportId,
      loading: true,
      ...(switching ? { report: null, error: null } : {}),
    })
    try {
      const payload = await getReport(reportId)
      /* Answered after the reader moved on — dropped rather than rendered. */
      if (get().reportId !== reportId) return
      set({
        report: payload.report,
        connectedSources: payload.connectedSources,
        publishedCount: payload.publishedCount,
        builtCount: payload.builtCount,
        draftCount: payload.draftCount,
        error: null,
        loading: false,
      })
    } catch (error) {
      if (get().reportId !== reportId) return
      set({ error: toMessage(error), loading: false })
    }
  },

  slice: async (filter) => {
    const report = get().report
    if (!report) return { ok: false, error: 'No report is open.' }
    set({ slicing: true })
    try {
      const built = await buildReport({
        ...report.frame,
        filters: filter ? [filter] : [],
      })
      set({ report: built, slicing: false })
      return { ok: true }
    } catch (error) {
      set({ slicing: false })
      return { ok: false, error: toMessage(error) }
    }
  },
}))

/*
 * Authoring one report, over three steps.
 *
 * The step is state rather than a route, because a half-composed question is not a place
 * to link to: `/reports/new` is the flow, and where you are inside it is what you have
 * answered. The frame is the one piece of state everything reads — step 2's pickers write
 * it, step 3 builds from it, and saving stores it.
 *
 * **A frame change drops the built report.** Otherwise adjusting a picker after building
 * would leave last frame's figures on screen under this frame's sentence, which is the
 * same failure the report store guards against when the id changes.
 */
interface ReportAuthorState {
  /** 1 Graph, 2 Ask, 3 Confirm, 4 Report. */
  step: 1 | 2 | 3 | 4
  /** The published graph the question is asked of — chosen before it is asked. */
  graph: ReportGraph | null
  readBack: ReportReadBack | null
  frame: ReportFrame | null
  built: BuiltReport | null
  /** The library row this came from, when a saved report was opened for editing. */
  editing: SavedReport | null
  /** True on a report that is built but not yet kept — the page asks for a name. */
  needsName: boolean
  reading_busy: boolean
  building: boolean
  saving: boolean
  setStep: (step: 1 | 2 | 3 | 4) => void
  chooseGraph: (graph: ReportGraph) => void
  setFrame: (patch: Partial<ReportFrame>) => void
  reading: (input: { question?: string; reportId?: string }) => Promise<Result>
  build: () => Promise<Result>
  /** Build a standard report as it stands. Kept only once it is named. */
  generate: (input: { reportId: string }) => Promise<Result>
  save: (name: string, savedBy?: string | null) => Promise<Result>
  /** Re-ask a saved question: its frame, restored, straight to the Confirm step. */
  reopen: (saved: SavedReport) => Promise<Result>
  reset: () => void
}

const BLANK = {
  step: 1 as const,
  graph: null,
  readBack: null,
  frame: null,
  built: null,
  editing: null,
  needsName: false,
  reading_busy: false,
  building: false,
  saving: false,
}

export const useReportAuthorStore = create<ReportAuthorState>()((set, get) => ({
  ...BLANK,

  setStep: (step) => set({ step }),

  /* Choosing the graph drops anything read or built against the previous one: a sentence
     confirmed against one graph is not a sentence confirmed against another. */
  chooseGraph: (graph) => set({ graph, step: 2, readBack: null, frame: null, built: null }),

  setFrame: (patch) => {
    const frame = get().frame
    if (!frame) return
    set({ frame: { ...frame, ...patch }, built: null, needsName: false })
  },

  reading: async (input) => {
    set({ reading_busy: true })
    try {
      const readBack = await readReportQuestion({ ...input, useCaseId: get().graph?.useCaseId })
      set({ readBack, frame: readBack.frame, built: null, step: 3, reading_busy: false })
      return { ok: true }
    } catch (error) {
      set({ reading_busy: false })
      return { ok: false, error: toMessage(error) }
    }
  },

  build: async () => {
    const frame = get().frame
    if (!frame) return { ok: false, error: 'Read a question back first.' }
    set({ building: true })
    try {
      const built = await buildReport(frame)
      set({ built, step: 4, building: false })
      return { ok: true }
    } catch (error) {
      set({ building: false })
      return { ok: false, error: toMessage(error) }
    }
  },

  /*
   * A standard report picked directly: read, build and save in one act, because the user
   * asked for *that* report and there is no sentence to confirm. It still goes through all
   * three calls, so the saved row holds a frame the server validated rather than one this
   * page assembled.
   */
  generate: async ({ reportId }) => {
    set({ reading_busy: true })
    try {
      const readBack = await readReportQuestion({ reportId, useCaseId: get().graph?.useCaseId })
      const built = await buildReport(readBack.frame)
      /*
       * Built, not kept. Naming it is the last act, and it is the user's: a report saved
       * under a name the app chose is a row nobody recognises a week later, and the section
       * fills with "Inbound Generator Risk Register · v1" three times over. `needsName`
       * is what the page reads to ask for one.
       */
      set({
        readBack,
        frame: readBack.frame,
        built,
        editing: null,
        needsName: true,
        step: 4,
        reading_busy: false,
      })
      return { ok: true }
    } catch (error) {
      set({ reading_busy: false })
      return { ok: false, error: toMessage(error) }
    }
  },

  save: async (name, savedBy) => {
    const { frame, readBack, editing } = get()
    if (!frame) return { ok: false, error: 'Build the report before saving it.' }
    set({ saving: true })
    try {
      /* The frame and the question, never the figures — re-opening a saved report
         re-asks it, so a cached number would be a stale answer with a fresh date.
         `savedId` is set when this report came from the library, so editing one updates
         its row instead of leaving two rows asking the same question. */
      const saved = await saveReport({
        savedId: editing?.savedId ?? null,
        name,
        question: readBack?.question ?? null,
        frame,
        savedBy,
      })
      set({
        saving: false,
        needsName: false,
        editing: saved.find((row) => row.name === name) ?? editing,
      })
      return { ok: true }
    } catch (error) {
      set({ saving: false })
      return { ok: false, error: toMessage(error) }
    }
  },

  reopen: async (saved) => {
    const frame: ReportFrame = {
      reportId: saved.reportId,
      /* Only if that graph is still published — a frame naming an unpublished one is
         refused, and the saved report says so instead. */
      useCaseId: saved.graph?.live ? saved.graph.useCaseId : null,
      scope: saved.scope,
      measure: saved.measure,
      horizon: saved.horizon,
      filters: saved.filters.map((f) => ({ key: f.key, value: f.value })),
    }
    /* Straight to Confirm, on the graph it was saved against: editing a saved report is
       adjusting its frame, not choosing a graph again. `editing` is what makes the next
       save update this row rather than add a second one. */
    set({ frame, built: null, editing: saved, graph: saved.graph, step: 3 })
    /* The read-back is re-fetched rather than reconstructed here, so the sentence a
       reopened report shows is the server's, exactly as it was the first time. */
    try {
      const readBack = await readReportQuestion({
        reportId: saved.reportId,
        useCaseId: frame.useCaseId,
      })
      set({ readBack, frame })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: toMessage(error) }
    }
  },

  reset: () => set({ ...BLANK }),
}))

/**
 * Setting who a saved report is for. Returns the library, so the caller reloads nothing.
 *
 * A plain function rather than a store action for the reason `removeSavedReport` is one: the
 * library belongs to the section, and the section reloads itself after either.
 */
export async function setReportAudience(savedId: string, roleIds: string[]): Promise<Result> {
  try {
    await setSavedReportRoles(savedId, roleIds)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: toMessage(error) }
  }
}

/** Removing a saved question. Lives here because the library is the section's, not one report's. */
export async function removeSavedReport(savedId: string): Promise<Result> {
  try {
    await deleteSavedReport(savedId)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: toMessage(error) }
  }
}

/*
 * One saved report, opened.
 *
 * Keyed by its id for the reason `useReportStore` is keyed by a report id: a slow fetch
 * must not leave one saved report's figures under another's name. The row comes back with
 * the report because the page states what the figures cannot — who saved it, when, and
 * which graph it was asked of.
 */
interface SavedReportState {
  savedId: string | null
  saved: SavedReport | null
  report: BuiltReport | null
  /** True while a chip's re-ask is in flight. */
  slicing: boolean
  connectedSources: number
  publishedCount: number
  builtCount: number
  draftCount: number
  loading: boolean
  error: string | null
  load: (savedId: string) => Promise<void>
  /** Re-ask it with one facet filter, or none — the frame it states, plus the chip. */
  slice: (filter: { key: string; value: string } | null) => Promise<Result>
}

export const useSavedReportStore = create<SavedReportState>()((set, get) => ({
  savedId: null,
  saved: null,
  report: null,
  slicing: false,
  connectedSources: 0,
  publishedCount: 0,
  builtCount: 0,
  draftCount: 0,
  loading: false,
  error: null,

  load: async (savedId) => {
    const switching = get().savedId !== savedId
    set({
      savedId,
      loading: true,
      ...(switching ? { saved: null, report: null, error: null } : {}),
    })
    try {
      const payload = await getSavedReport(savedId)
      if (get().savedId !== savedId) return
      set({
        saved: payload.saved,
        report: payload.report,
        connectedSources: payload.connectedSources,
        publishedCount: payload.publishedCount,
        builtCount: payload.builtCount,
        draftCount: payload.draftCount,
        error: null,
        loading: false,
      })
    } catch (error) {
      if (get().savedId !== savedId) return
      set({ error: toMessage(error), loading: false })
    }
  },

  slice: async (filter) => {
    const report = get().report
    if (!report) return { ok: false, error: 'No report is open.' }
    set({ slicing: true })
    try {
      const built = await buildReport({ ...report.frame, filters: filter ? [filter] : [] })
      set({ report: built, slicing: false })
      return { ok: true }
    } catch (error) {
      set({ slicing: false })
      return { ok: false, error: toMessage(error) }
    }
  },
}))
