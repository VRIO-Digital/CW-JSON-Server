import { create } from 'zustand'
import {
  askQuestionStreaming,
  listAskGraphs,
  type AnswerBlock,
  type AskAnswer,
  type AskGraph,
  type AskGraphsPayload,
  type AskSource,
  type AskStep,
  type Citations,
} from '../api/client'
import {
  chatTitle,
  clearChats,
  loadChats,
  newId,
  saveChats,
  type AskChat,
  type AskTurn,
} from '../data/askChats'
import { toMessage, type Result } from './asyncState'
import { useAuthStore } from './authStore'

/**
 * Ask's state: which live graph is selected, the chat being had, and the chats before it.
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

  /*
   * The conversation.
   *
   * `chats` is this user's history for the session, newest first, and `activeChatId` is the
   * one on screen — null for a new chat nobody has asked anything in yet, which is why
   * "New chat" needs no row until the first question lands. A chat is created *by asking*,
   * so the list never fills with empty entries somebody opened and left.
   *
   * There is no `answer` field any more. The last answer is the last turn of the active
   * chat, read through `selectActiveChat`: two homes for one answer is how the thread and
   * the history come to disagree about what was said.
   */
  chats: AskChat[]
  activeChatId: string | null

  /*
   * What has arrived so far, while `asking`. The answer is composed and streamed,
   * so the page renders this and switches to the stored turn when `done` lands — which
   * is also the only object that has been validated as a whole.
   *
   * Cleared at the start of each ask rather than at the end: a half-streamed
   * answer must not linger under the next question.
   */
  askedNow: string
  streamedSteps: AskStep[]
  streamedSummary: { answered: boolean; text: string } | null
  streamedBlocks: AnswerBlock[]
  /**
   * How many blocks the summary said were coming.
   *
   * The page draws one shimmer per paragraph not yet landed, and this is the number it counts
   * from — the server's, stated in the summary event, because the answer is composed before
   * the stream opens. A client-side guess would put a placeholder under an answer that had
   * finished, which is a promise nothing keeps.
   */
  streamedBlockCount: number

  /** What the reader requires of an answer — the Answer requirements tab. See below. */
  citations: Citations | null
  formatIds: string[]

  load: () => Promise<void>
  select: (useCaseId: string | null) => void

  /**
   * The connected sources this question is asked of, by id.
   *
   * **Beside the graph rather than instead of it**: a reader may ask a published graph, or a
   * connected runtime source, or both — the server decides how they combine, which is why
   * the picks travel with every question rather than being dropped when a graph is selected.
   */
  sourceIds: string[]
  toggleSource: (sourceId: string, on: boolean) => void
  setCitations: (citations: Citations) => void
  toggleFormat: (formatId: string, on: boolean) => void
  ask: (question: string) => Promise<Result>

  /** Start a fresh thread. Nothing is stored until a question is asked in it. */
  newChat: () => void
  openChat: (chatId: string) => void
  deleteChat: (chatId: string) => void
  clearHistory: () => void
  /** Re-read this session's chats — on arrival, and whenever the signed-in address changes. */
  syncHistory: () => void
}

const EMPTY_GRAPHS: AskGraph[] = []
/* Module-level, so an idle store hands out the same references every render. */
const EMPTY_STEPS: AskStep[] = []
const EMPTY_BLOCKS: AnswerBlock[] = []
const EMPTY_FORMATS: string[] = []
const EMPTY_CHATS: AskChat[] = []
/** Stable reference, the rule every selector here follows. */
const EMPTY_SOURCE_IDS: string[] = []
const EMPTY_SOURCES: AskSource[] = []

/** Who the history belongs to. Client-held, so it is read at call time rather than captured. */
const signedInAs = () => useAuthStore.getState().identity?.email ?? null

export const useAskStore = create<AskState>()((set, get) => ({
  data: null,
  loading: false,
  error: null,
  useCaseId: null,
  asking: false,
  chats: EMPTY_CHATS,
  activeChatId: null,
  askedNow: '',
  citations: null,
  formatIds: EMPTY_FORMATS,
  sourceIds: EMPTY_SOURCE_IDS,
  streamedSteps: EMPTY_STEPS,
  streamedBlocks: EMPTY_BLOCKS,
  streamedSummary: null,
  streamedBlockCount: 0,

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
      /*
       * Landing on a graph is for arrival, not for a reload — and never over a source pick. A
       * reader asking a mailbox who reloads must not find a graph selected under them, which
       * would silently change what the next question is asked of.
       */
      const hasPicks = get().sourceIds.length > 0
      const useCaseId = stillLive
        ? current
        : hasPicks
          ? null
          : (data.graphs[0]?.useCaseId ?? null)
      /*
       * **A source pick that is no longer connected is dropped**, the same rule the graph
       * selection follows one line up and for the same reason: a registration lives in the
       * mock server's memory and dies with the process, so a pick can outlive the source it
       * names. Keeping it would send an id the route refuses with a 404 the reader cannot act
       * on, over a control that no longer draws the row it came from.
       */
      const live = new Set(data.sources.map((r) => r.sourceId))
      const kept = get().sourceIds.filter((sid) => live.has(sid))
      const sourceIds =
        kept.length === get().sourceIds.length ? get().sourceIds : kept
      set({
        data,
        error: null,
        loading: false,
        useCaseId,
        sourceIds,
        ...(stillLive ? {} : { activeChatId: null }),
      })
      get().syncHistory()
    } catch (error) {
      // A failed reload keeps the picker and the thread on screen.
      set({ error: toMessage(error), loading: false })
    }
  },

  select: (useCaseId) => {
    if (get().useCaseId === useCaseId) return
    /*
     * A chat belongs to the graph and version that produced its answers, so switching
     * graphs starts a new thread rather than continuing one under a heading it did not come
     * from. The old chat is still in the history, filed under its own graph.
     *
     * The requirements are the *reader's*, not the graph's, so they stay.
     */
    /*
     * **And the source picks go, because a question is asked of one thing.** The route already
     * decided this — a `use_case_id` wins and the sources are ignored — so leaving them ticked
     * showed a count on the `+` for a mailbox contributing nothing to the answer beside it.
     * Reported from use. The control now says what the server does.
     */
    set({ useCaseId, sourceIds: EMPTY_SOURCE_IDS, activeChatId: null })
  },

  setCitations: (citations) => set({ citations }),

  /*
   * Picking a source does **not** start a new thread, unlike picking a graph. A graph and its
   * version are what produced an answer, so a thread belongs to them; a source pick is part
   * of the *next* question, and every answer already records which sources read it.
   */
  toggleSource: (sourceId, on) =>
    set((state) => {
      const sourceIds = on
        ? [...state.sourceIds, sourceId]
        : state.sourceIds.filter((s) => s !== sourceId)
      /*
       * **Picking a source deselects the graph, which is the same rule the other way round.**
       * One question is asked of one thing, and the server settles it by ignoring the sources
       * whenever a graph is named — so a mailbox ticked beside a selected graph was a control
       * that changed nothing.
       *
       * **It starts a new thread only when a graph was actually dropped**, because that is the
       * switch: what answers changed from a graph to correspondence, and an answer belongs to
       * whatever produced it. Adding a second mailbox to a mailbox is not a switch, and
       * clearing the thread there would throw away a conversation over a widened scope.
       */
      const dropsGraph = on && state.useCaseId !== null
      return {
        sourceIds,
        ...(dropsGraph ? { useCaseId: null, activeChatId: null } : {}),
      }
    }),

  toggleFormat: (formatId, on) =>
    set((state) => ({
      formatIds: on
        ? [...state.formatIds, formatId]
        : state.formatIds.filter((id) => id !== formatId),
    })),

  newChat: () => set({ activeChatId: null }),

  openChat: (chatId) => {
    const chat = get().chats.find((c) => c.chatId === chatId)
    if (!chat) return
    /* Opening a chat also selects the graph it was had against — an answer belongs to the
       version that produced it, and reading it under another graph's heading would be a
       claim about content that never answered it. */
    set({
      activeChatId: chatId,
      useCaseId: get().data?.graphs.some((g) => g.useCaseId === chat.useCaseId)
        ? chat.useCaseId
        : get().useCaseId,
    })
  },

  deleteChat: (chatId) => {
    const chats = get().chats.filter((c) => c.chatId !== chatId)
    saveChats(signedInAs(), chats)
    set({
      chats,
      activeChatId: get().activeChatId === chatId ? null : get().activeChatId,
    })
  },

  clearHistory: () => {
    clearChats(signedInAs())
    set({ chats: EMPTY_CHATS, activeChatId: null })
  },

  syncHistory: () => {
    const chats = loadChats(signedInAs())
    /* The active chat has to still exist — signing in as somebody else replaces the whole
       list, and pointing at a chat that is not in it renders an empty thread. */
    const activeChatId = chats.some((c) => c.chatId === get().activeChatId)
      ? get().activeChatId
      : null
    set({ chats, activeChatId })
  },

  ask: async (question) => {
    const useCaseId = get().useCaseId
    const sourceIds = get().sourceIds
    /*
     * **Either is enough.** This read `!useCaseId` alone, which was right while a graph was
     * the only thing that could be asked and refuses every mailbox question now — with the
     * sentence "No graph is live to ask", which is true and is not the reader's problem.
     */
    if (!useCaseId && sourceIds.length === 0) {
      return {
        ok: false,
        error: 'Pick a published graph, or a connected source with the + button, to ask.',
      }
    }
    if (!question.trim()) return { ok: false, error: 'Ask a question first.' }
    const asked = question.trim()

    /*
     * The streamed state is cleared here, at the start — a half-streamed answer must not
     * linger under the next question. The *thread* is not cleared: this is a conversation,
     * and the turns above stay where they are.
     */
    set({
      asking: true,
      askedNow: asked,
      streamedSteps: EMPTY_STEPS,
      streamedBlocks: EMPTY_BLOCKS,
      streamedSummary: null,
      streamedBlockCount: 0,
    })
    /* The served default stands in until the reader picks one, so "required" is
       defined in exactly one place — the payload. */
    const required =
      get().citations ?? get().data?.answerRequirements.defaultCitations ?? 'required'
    try {
      const answer = await askQuestionStreaming(
        useCaseId,
        asked,
        { citations: required, formats: get().formatIds },
        sourceIds,
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
              // What the shimmers are counted from — the server's own figure.
              streamedBlockCount: event.blockCount,
            })
          } else if (event.kind === 'block') {
            set({ streamedBlocks: [...get().streamedBlocks, event.block] })
          }
          // `done` is not applied here — the whole envelope is committed below, once,
          // from the validated object the fetcher returns.
        },
      )
      if (get().useCaseId !== useCaseId) return { ok: true }
      appendTurn(asked, answer)
      return { ok: true }
    } catch (error) {
      /*
       * The partial stream is dropped rather than left as a stump. Unlike a
       * failed *reload*, where keeping the old data on screen is right, half an
       * answer is not an answer — and the message says what went wrong. The turn is
       * *not* written: a question with no answer is not a turn, and restoring one would
       * be a spinner nobody can end.
       */
      set({
        streamedSteps: EMPTY_STEPS,
        streamedBlocks: EMPTY_BLOCKS,
        streamedSummary: null,
        streamedBlockCount: 0,
      })
      return { ok: false, error: toMessage(error) }
    } finally {
      set({ asking: false, askedNow: '' })
    }
  },
}))

/*
 * Committing a turn: into the active chat, or into a new one if this is the first question.
 *
 * Outside the store object because it is not an action a component calls — `ask` is the only
 * caller, and exposing it would be a second way to write history.
 */
function appendTurn(asked: string, answer: AskAnswer) {
  const state = useAskStore.getState()
  const graph = state.data?.graphs.find((g) => g.useCaseId === state.useCaseId)
  /*
   * **The subject is whatever answered**, and this used to return early without a graph —
   * which, once a connected source could answer on its own, meant a source-scoped answer
   * streamed to the screen and was then never filed: no turn, no chat, and the reply gone
   * the moment `asking` went false. A thread has to exist for every answer, or the page is
   * a stream with no memory.
   */
  const sources = state.data?.sources ?? []
  const picked = sources.filter((r) => state.sourceIds.includes(r.sourceId))
  const subject = graph?.name ?? picked.map((r) => r.name).join(', ')
  if (!state.useCaseId && picked.length === 0) return

  const turn: AskTurn = {
    turnId: newId(),
    question: asked,
    answer,
    askedAt: answer.askedAt,
  }
  const now = new Date().toISOString()
  const existing = state.chats.find((c) => c.chatId === state.activeChatId)

  const chat: AskChat = existing
    ? { ...existing, turns: [...existing.turns, turn], updatedAt: now }
    : {
        chatId: newId(),
        useCaseId: state.useCaseId,
        graphName: graph?.name ?? null,
        subject,
        title: chatTitle(asked),
        turns: [turn],
        createdAt: now,
        updatedAt: now,
      }

  /* Newest first, and the chat just written is the newest — so a reply moves its thread to
     the top of the history the way every message list does. */
  const chats = [chat, ...state.chats.filter((c) => c.chatId !== chat.chatId)]
  saveChats(useAuthStore.getState().identity?.email ?? null, chats)
  useAskStore.setState({ chats, activeChatId: chat.chatId })
}

/** Stable reference — `data?.graphs ?? []` would allocate every render. */
export const selectAskGraphs = (s: AskState) => s.data?.graphs ?? EMPTY_GRAPHS

/** The connected sources that can be asked directly. Empty when none is connected. */
export const selectAskSources = (s: AskState) => s.data?.sources ?? EMPTY_SOURCES

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

/** The thread on screen, or null for a new chat with nothing in it yet. */
export const selectActiveChat = (s: AskState) =>
  s.chats.find((c) => c.chatId === s.activeChatId) ?? null

/** This user's history, newest first — what the rail lists. */
export const selectChats = (s: AskState) => s.chats
