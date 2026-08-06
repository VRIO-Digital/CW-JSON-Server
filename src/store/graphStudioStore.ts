import { create } from 'zustand'
import {
  activateVersion,
  approveVersion,
  askStudio,
  decideReviewItem,
  getGraphStudio,
  getStudioCanvas,
  listStudioGraphs,
  publishGraph,
  resolvePivot,
  runQualityCheck,
  type CanvasPayload,
  type GraphStudioPayload,
  type QualityReport,
  type QueryAnswer,
  type ReviewChoice,
  type ReviewItem,
  type StudioGraph,
  type StudioGraphsPayload,
} from '../api/client'
import { createReadStore, toMessage, type Result } from './asyncState'

/** The studio's front door — the graphs that have been built. Read-only. */
export const useStudioGraphsStore = createReadStore<StudioGraphsPayload>(listStudioGraphs)

interface StudioState {
  /** Which built graph is open. Null on the list. */
  useCaseId: string | null
  data: GraphStudioPayload | null
  loading: boolean
  error: string | null
  /** itemId whose decision is in flight, so only that row's buttons spin. */
  pending: string | null
  checking: boolean
  publishing: boolean
  report: QualityReport | null
  /** The ontology, and the last answer run against it. */
  canvas: CanvasPayload | null
  canvasLoading: boolean
  answer: QueryAnswer | null
  asking: boolean

  open: (useCaseId: string) => Promise<void>
  decide: (input: {
    itemId: string
    choice: ReviewChoice
    justification?: string
  }) => Promise<Result>
  choosePivot: (optionId: string) => Promise<Result>
  check: () => Promise<Result>
  publish: () => Promise<{ ok: true; version: string } | { ok: false; error: string }>
  loadCanvas: () => Promise<void>
  ask: (question: string) => Promise<Result>
  approve: (version: number, note?: string) => Promise<Result>
  activate: (version: number) => Promise<Result>
}

const EMPTY_ITEMS: ReviewItem[] = []
const EMPTY_GRAPHS: StudioGraph[] = []

export const useGraphStudioStore = create<StudioState>()((set, get) => ({
  useCaseId: null,
  data: null,
  loading: false,
  error: null,
  pending: null,
  checking: false,
  publishing: false,
  report: null,
  canvas: null,
  canvasLoading: false,
  answer: null,
  asking: false,

  open: async (useCaseId) => {
    // Opening a different graph must not show the previous one's queue while
    // the new one loads — the rows look alike and the id is not on screen.
    const switching = get().useCaseId !== useCaseId
    set({
      useCaseId,
      loading: true,
      ...(switching
        ? { data: null, report: null, canvas: null, answer: null, error: null }
        : {}),
    })
    try {
      set({ data: await getGraphStudio(useCaseId), error: null, loading: false })
    } catch (error) {
      // A failed reload keeps the queue on screen rather than blanking it.
      set({ error: toMessage(error), loading: false })
    }
  },

  decide: async (input) => {
    const useCaseId = get().useCaseId
    if (!useCaseId) return { ok: false, error: 'No graph is open.' }
    set({ pending: input.itemId })
    try {
      // The action answers with the whole studio, so the cards, the gate and
      // the row move together — no second fetch, and no chance of a card
      // disagreeing with the list beneath it.
      set({ data: await decideReviewItem({ useCaseId, ...input }) })
      /*
       * A decision changes what the canvas shows — an approved proposal stops
       * being dashed. Refresh it if it has been looked at, so the two tabs can
       * never tell different stories.
       */
      if (get().canvas) await get().loadCanvas()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: toMessage(error) }
    } finally {
      set({ pending: null })
    }
  },

  choosePivot: async (optionId) => {
    const useCaseId = get().useCaseId
    if (!useCaseId) return { ok: false, error: 'No graph is open.' }
    set({ pending: optionId })
    try {
      set({ data: await resolvePivot(useCaseId, optionId) })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: toMessage(error) }
    } finally {
      set({ pending: null })
    }
  },

  check: async () => {
    const useCaseId = get().useCaseId
    if (!useCaseId) return { ok: false, error: 'No graph is open.' }
    set({ checking: true })
    try {
      set({ report: await runQualityCheck(useCaseId) })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: toMessage(error) }
    } finally {
      set({ checking: false })
    }
  },

  publish: async () => {
    const useCaseId = get().useCaseId
    if (!useCaseId) return { ok: false, error: 'No graph is open.' }
    set({ publishing: true })
    try {
      const studio = await publishGraph(useCaseId)
      set({ data: studio })
      return { ok: true, version: studio.version }
    } catch (error) {
      return { ok: false, error: toMessage(error) }
    } finally {
      set({ publishing: false })
    }
  },

  loadCanvas: async () => {
    const useCaseId = get().useCaseId
    if (!useCaseId) return
    set({ canvasLoading: true })
    try {
      set({ canvas: await getStudioCanvas(useCaseId), error: null })
    } catch (error) {
      set({ error: toMessage(error) })
    } finally {
      set({ canvasLoading: false })
    }
  },

  ask: async (question) => {
    const useCaseId = get().useCaseId
    if (!useCaseId) return { ok: false, error: 'No graph is open.' }
    set({ asking: true })
    try {
      const answer = await askStudio(useCaseId, question)
      // The answer carries the canvas with its path already marked, so the
      // Canvas tab glows the route without a second request or a second truth.
      set({ answer, canvas: answer.canvas })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: toMessage(error) }
    } finally {
      set({ asking: false })
    }
  },

  approve: async (version, note) => {
    const useCaseId = get().useCaseId
    if (!useCaseId) return { ok: false, error: 'No graph is open.' }
    set({ pending: `approve-v${version}` })
    try {
      set({ data: await approveVersion(useCaseId, version, note) })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: toMessage(error) }
    } finally {
      set({ pending: null })
    }
  },

  activate: async (version) => {
    const useCaseId = get().useCaseId
    if (!useCaseId) return { ok: false, error: 'No graph is open.' }
    // Keyed apart from approve so the two buttons on one row spin separately.
    set({ pending: `live-v${version}` })
    try {
      set({ data: await activateVersion(useCaseId, version) })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: toMessage(error) }
    } finally {
      set({ pending: null })
    }
  },
}))

export const selectMustReview = (s: StudioState) => s.data?.mustReview ?? EMPTY_ITEMS

/** The whole gate in one line, so a button and a banner cannot disagree. */
export const selectBlocked = (s: StudioState) => s.data?.publish.blocked ?? true

export const selectGraphs = (s: { data: StudioGraphsPayload | null }) =>
  s.data?.graphs ?? EMPTY_GRAPHS
