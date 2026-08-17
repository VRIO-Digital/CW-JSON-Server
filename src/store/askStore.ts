import { create } from 'zustand'
import {
  askQuestionStreaming,
  listAskGraphs,
  type AnswerBlock,
  type AskAnswer,
  type AskGraph,
  type AskGraphsPayload,
  type AskStep,
  type Citations,
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
   * What the reader requires of an answer — the Answer requirements tab.
   *
   * This was step 6 of the New Graph wizard, declared once per brief. It is asked for
   * per question now, so it lives here and travels with the ask.
   *
   * `citations` is null until it is chosen, and the *served* default fills in — one
   * source for what "required" means by default, rather than a copy of it here that
   * could disagree with the payload.
   */
  citations: Citations | null
  formatIds: string[]

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
  setCitations: (citations: Citations) => void
  toggleFormat: (formatId: string, on: boolean) => void
  ask: (question: string) => Promise<Result>
}

const EMPTY_GRAPHS: AskGraph[] = []
/* Module-level, so an idle store hands out the same references every render. */
const EMPTY_STEPS: AskStep[] = []
const EMPTY_BLOCKS: AnswerBlock[] = []
const EMPTY_FORMATS: string[] = []

export const useAskStore = create<AskState>()((set, get) => ({
  data: null,
  loading: false,
  error: null,
  useCaseId: null,
  asking: false,
  answer: null,
  citations: null,
  formatIds: EMPTY_FORMATS,
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
    // from. The requirements are the *reader's*, not the graph's, so they stay.
    set({ useCaseId, answer: null })
  },

  setCitations: (citations) => set({ citations }),

  toggleFormat: (formatId, on) =>
    set((state) => ({
      formatIds: on
        ? [...state.formatIds, formatId]
        : state.formatIds.filter((id) => id !== formatId),
    })),

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
    /* The served default stands in until the reader picks one, so "required" is
       defined in exactly one place — the payload. */
    const required =
      get().citations ?? get().data?.answerRequirements.defaultCitations ?? 'required'
    try {
      const answer = await askQuestionStreaming(
        useCaseId,
        question.trim(),
        { citations: required, formats: get().formatIds },
        (event) => {
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
                text: event.answered
                  ? (event.summary ?? event.answer ?? '')
                  : event.reason,
              },
            })
          } else if (event.kind === 'block') {
            set({ streamedBlocks: [...get().streamedBlocks, event.block] })
          }
          // `done` is not applied here — the whole envelope is set below, once,
          // from the validated object the fetcher returns.
        },
      )
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

/** The requirement pool, once the list has landed. Null before that. */
export const selectRequirementOptions = (s: AskState) =>
  s.data?.answerRequirements ?? null

/**
 * What will be required of the next question — the reader's pick, or the served
 * default. The tab and the ask read this one function, so the control cannot show one
 * value while the request carries another.
 */
export const selectCitations = (s: AskState): Citations =>
  s.citations ?? s.data?.answerRequirements.defaultCitations ?? 'required'

/** The selected graph itself, which carries the copy the page prints. */
export const selectCurrentGraph = (s: AskState) =>
  s.data?.graphs.find((g) => g.useCaseId === s.useCaseId) ?? null
