import { create } from 'zustand'
import {
  askStudio,
  decideReviewItem,
  getGraphBuild,
  getGraphStudio,
  getStudioCanvas,
  listGraphBuilds,
  listStudioGraphs,
  publishVersion,
  resolvePivot,
  startGraphBuild,
  unpublishVersion,
  type CanvasPayload,
  type GraphBuild,
  type GraphStudioPayload,
  type QueryAnswer,
  type ReviewChoice,
  type ReviewItem,
  type StudioGraph,
  type StudioGraphsPayload,
} from '../api/client'
import { createReadStore, toMessage, type Result } from './asyncState'
import { useAuthStore } from './authStore'

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
  publishing: boolean
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
  /** Both name a version by its content hash — the identity of one build. */
  publish: (sha256: string) => Promise<Result>
  unpublish: (sha256: string) => Promise<Result>
  loadCanvas: () => Promise<void>
  ask: (question: string) => Promise<Result>
}

const EMPTY_ITEMS: ReviewItem[] = []
const EMPTY_GRAPHS: StudioGraph[] = []

export const useGraphStudioStore = create<StudioState>()((set, get) => ({
  useCaseId: null,
  data: null,
  loading: false,
  error: null,
  pending: null,
  publishing: false,
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
      ...(switching ? { data: null, canvas: null, answer: null, error: null } : {}),
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

  /*
   * Publish or unpublish one version, named by its content hash. Keyed into
   * `pending` per row, so two rows' buttons spin independently.
   */
  publish: async (sha256) => {
    const useCaseId = get().useCaseId
    if (!useCaseId) return { ok: false, error: 'No graph is open.' }
    set({ pending: `publish-${sha256}` })
    try {
      /* Who is publishing, from the one place that knows: the browser's own identity.
         A server route that names a person has to be told — the rule the consent
         callback established, and the reason every "published by" line can now say the
         person who pressed the button instead of the seeded account. */
      set({
        data: await publishVersion(
          useCaseId,
          sha256,
          useAuthStore.getState().identity?.email ?? null,
        ),
      })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: toMessage(error) }
    } finally {
      set({ pending: null })
    }
  },

  unpublish: async (sha256) => {
    const useCaseId = get().useCaseId
    if (!useCaseId) return { ok: false, error: 'No graph is open.' }
    set({ pending: `unpublish-${sha256}` })
    try {
      set({ data: await unpublishVersion(useCaseId, sha256) })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: toMessage(error) }
    } finally {
      set({ pending: null })
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

}))

interface BuildState {
  /** This graph's runs, newest first. */
  history: GraphBuild[]
  /** The one on screen — the newest on arrival, or whichever was loaded. */
  shown: GraphBuild | null
  loading: boolean
  starting: boolean
  error: string | null

  load: (useCaseId: string) => Promise<void>
  start: (useCaseId: string) => Promise<Result>
  /** Show a past run instead of the newest. */
  show: (buildId: string) => void
  /** One poll. The page owns the interval and stops it when the run lands. */
  poll: () => Promise<void>
}

const EMPTY_BUILDS: GraphBuild[] = []

/**
 * The Build tab's state.
 *
 * Its own store rather than more fields on the studio's: a build polls every few
 * hundred milliseconds, and putting it in the payload every tab reads would
 * re-render the review queue for each stage.
 */
export const useGraphBuildStore = create<BuildState>()((set, get) => ({
  history: EMPTY_BUILDS,
  shown: null,
  loading: false,
  starting: false,
  error: null,

  load: async (useCaseId) => {
    set({ loading: true })
    try {
      const history = await listGraphBuilds(useCaseId)
      /* Land on the newest run — a graph that was just built has one in flight,
         and that is the thing the user came to watch. */
      set({ history, shown: history[0] ?? null, error: null, loading: false })
    } catch (error) {
      // A failed reload keeps whatever was on screen.
      set({ error: toMessage(error), loading: false })
    }
  },

  start: async (useCaseId) => {
    set({ starting: true, error: null })
    try {
      const run = await startGraphBuild(useCaseId)
      set({ shown: run, history: [run, ...get().history] })
      return { ok: true }
    } catch (error) {
      const msg = toMessage(error)
      set({ error: msg })
      return { ok: false, error: msg }
    } finally {
      set({ starting: false })
    }
  },

  show: (buildId) => {
    const run = get().history.find((b) => b.buildId === buildId)
    if (run) set({ shown: run })
  },

  poll: async () => {
    const current = get().shown
    if (!current || current.status === 'complete') return
    try {
      const run = await getGraphBuild(current.useCaseId, current.buildId)
      set({
        shown: run,
        // Keep the history row in step, so the picker's label stops saying
        // "running" once the run it names has finished.
        history: get().history.map((b) => (b.buildId === run.buildId ? run : b)),
      })
    } catch (error) {
      // A failed poll leaves the last known stage rather than blanking the panel.
      set({ error: toMessage(error) })
    }
  },
}))

export const selectMustReview = (s: StudioState) => s.data?.mustReview ?? EMPTY_ITEMS

/** The whole gate in one line, so a button and a banner cannot disagree. */
export const selectBlocked = (s: StudioState) => s.data?.publish.blocked ?? true

export const selectGraphs = (s: { data: StudioGraphsPayload | null }) =>
  s.data?.graphs ?? EMPTY_GRAPHS
