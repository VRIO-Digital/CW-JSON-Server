import { create } from 'zustand'
import {
  askQuestion,
  listAskGraphs,
  type AskAnswer,
  type AskGraph,
  type AskGraphsPayload,
} from '../api/client'
import { toMessage, type Result } from './asyncState'

/**
 * Ask's state: which live graph is selected, and the last answer it gave.
 *
 * Not `createReadStore` — the list is a read, but asking is an action with its
 * own in-flight flag, and the selection has to survive a reload of the list.
 */
interface AskState {
  data: AskGraphsPayload | null
  loading: boolean
  error: string | null

  /** The graph being asked. Null until the list lands, or when none is live. */
  useCaseId: string | null
  asking: boolean
  answer: AskAnswer | null

  load: () => Promise<void>
  select: (useCaseId: string) => void
  ask: (question: string) => Promise<Result>
}

const EMPTY_GRAPHS: AskGraph[] = []

export const useAskStore = create<AskState>()((set, get) => ({
  data: null,
  loading: false,
  error: null,
  useCaseId: null,
  asking: false,
  answer: null,

  load: async () => {
    set({ loading: true })
    try {
      const data = await listAskGraphs()
      /*
       * Land on a graph rather than on an empty picker: with one live graph
       * there is no choice to make, and with several the newest publish is the
       * one someone just came from. A selection that is no longer live is
       * dropped — the version it answered against is gone.
       */
      const current = get().useCaseId
      const stillLive = data.graphs.some((g) => g.useCaseId === current)
      set({
        data,
        error: null,
        loading: false,
        useCaseId: stillLive ? current : (data.graphs[0]?.useCaseId ?? null),
        ...(stillLive ? {} : { answer: null }),
      })
    } catch (error) {
      // A failed reload keeps the picker and the answer on screen.
      set({ error: toMessage(error), loading: false })
    }
  },

  select: (useCaseId) => {
    if (get().useCaseId === useCaseId) return
    // An answer belongs to the graph and version that produced it, so switching
    // graphs clears it rather than leaving it under a heading it did not come
    // from.
    set({ useCaseId, answer: null })
  },

  ask: async (question) => {
    const useCaseId = get().useCaseId
    if (!useCaseId) return { ok: false, error: 'No graph is live to ask.' }
    if (!question.trim()) return { ok: false, error: 'Ask a question first.' }

    set({ asking: true })
    try {
      set({ answer: await askQuestion(useCaseId, question.trim()) })
      return { ok: true }
    } catch (error) {
      // The previous answer stays put: a failed ask should not erase the one
      // the user is still reading.
      return { ok: false, error: toMessage(error) }
    } finally {
      set({ asking: false })
    }
  },
}))

/** Stable reference — `data?.graphs ?? []` would allocate every render. */
export const selectAskGraphs = (s: AskState) => s.data?.graphs ?? EMPTY_GRAPHS

/** The selected graph itself, which carries the copy the page prints. */
export const selectCurrentGraph = (s: AskState) =>
  s.data?.graphs.find((g) => g.useCaseId === s.useCaseId) ?? null
