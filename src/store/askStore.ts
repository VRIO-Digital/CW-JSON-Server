import { create } from 'zustand'
import {
  askQuestionStreaming,
  listAskGraphs,
  type AnswerBlock,
  type AskAnswer,
  type AskGraph,
  type AskGraphsPayload,
  type AskStep,
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

  /*
   * What has arrived so far, while `asking`. The answer is composed and streamed,
   * so the page renders this and switches to `answer` when `done` lands — which
   * is also the only object that has been validated as a whole.
   *
   * Cleared at the start of each ask rather than at the end: a half-streamed
   * answer must not linger under the next question.
   */
  streamedSteps: AskStep[]
  streamedSummary: { answered: boolean; text: string } | null
  streamedBlocks: AnswerBlock[]

  load: () => Promise<void>
  select: (useCaseId: string) => void
  ask: (question: string) => Promise<Result>
}

const EMPTY_GRAPHS: AskGraph[] = []
/* Module-level, so an idle store hands out the same references every render. */
const EMPTY_STEPS: AskStep[] = []
const EMPTY_BLOCKS: AnswerBlock[] = []

export const useAskStore = create<AskState>()((set, get) => ({
  data: null,
  loading: false,
  error: null,
  useCaseId: null,
  asking: false,
  answer: null,
  streamedSteps: EMPTY_STEPS,
  streamedBlocks: EMPTY_BLOCKS,
  streamedSummary: null,

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

    /*
     * The previous answer is cleared here, at the start — not left up while the
     * next one streams in beneath it, which would put two answers on screen and
     * make the older one look like part of the new one.
     */
    set({
      asking: true,
      answer: null,
      streamedSteps: EMPTY_STEPS,
      streamedBlocks: EMPTY_BLOCKS,
      streamedSummary: null,
    })
    try {
      const answer = await askQuestionStreaming(useCaseId, question.trim(), (event) => {
        // A stale stream cannot write into the store: switching graphs mid-answer
        // changes `useCaseId`, and this one's events stop landing.
        if (get().useCaseId !== useCaseId) return
        if (event.kind === 'stage') {
          set({ streamedSteps: [...get().streamedSteps, event] })
        } else if (event.kind === 'summary') {
          set({
            streamedSummary: {
              answered: event.answered,
              // An abstention's text is its reason; an answer's is its summary.
              text: event.answered ? (event.summary ?? event.answer ?? '') : event.reason,
            },
          })
        } else if (event.kind === 'block') {
          set({ streamedBlocks: [...get().streamedBlocks, event.block] })
        }
        // `done` is not applied here — the whole envelope is set below, once,
        // from the validated object the fetcher returns.
      })
      if (get().useCaseId !== useCaseId) return { ok: true }
      set({ answer })
      return { ok: true }
    } catch (error) {
      /*
       * The partial stream is dropped rather than left as a stump. Unlike a
       * failed *reload*, where keeping the old data on screen is right, half an
       * answer is not an answer — and the message says what went wrong.
       */
      set({ streamedSteps: EMPTY_STEPS, streamedBlocks: EMPTY_BLOCKS, streamedSummary: null })
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
