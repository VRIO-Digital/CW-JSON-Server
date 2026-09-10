import { create } from 'zustand'
import {
  deleteUseCase,
  editMetric,
  listGraphDomains,
  listGraphSources,
  listUseCases,
  getDerivation,
  reviewCoverage,
  saveUseCase,
  startDerivation,
  suggestMetrics,
  suggestPersonas,
  suggestQuestions,
  type CoveragePayload,
  type DerivationRun,
  type GapChoice,
  type LlmRun,
  type DraftedItem,
  type GraphDomainsPayload,
  type GraphSourcesPayload,
  type GraphUseCase,
  type HeroQuestion,
  type SourcePick,
  type Suggestion,
  type UseCasesPayload,
} from '../api/client'
import { createReadStore, toMessage, type Result } from './asyncState'

export type { Result }

/** Step 1's domain options, ranked by what the connected data supports. */
export const useGraphDomainsStore = createReadStore<GraphDomainsPayload>(listGraphDomains)

/** Step 4's sources — what the Data Catalog has actually profiled. */
export const useGraphSourcesStore =
  createReadStore<GraphSourcesPayload>(listGraphSources)

interface SuggestState {
  suggestions: Suggestion[]
  /** Distinguishes "not asked yet" from "asked, nothing came back". */
  asked: boolean
  /**
   * Why nothing came back, when nothing did — the server's sentence, never one composed here.
   * Only it knows whether the pool held candidates for this domain at all.
   */
  emptyReason: string | null
  suggesting: boolean
  /** What the last call was doing and what it cost — null until one has run. */
  run: LlmRun | null

  suggest: (input: {
    domainId: string | null
    businessNeed: string
  }) => Promise<Result>
  /** Waving one away is a local act — nothing about it was ever saved. */
  dismiss: (id: string) => void
  /**
   * Correcting one is *not* local, where the pool can be written back — the row is replaced with
   * what the server stored rather than with what was submitted, so a title the API trimmed or
   * refused cannot leave the screen disagreeing with the document. `null` on a store whose pool
   * has no write route, which is what withholds the Edit button.
   */
  edit: null | ((input: { id: string; name: string; detail: string }) => Promise<Result>)
  reset: () => void
}

/**
 * A suggester for one wizard step. Kept out of the use-case store because a
 * suggestion is not part of the draft until the user adds it — nothing here is
 * saved, and opening another use case clears it.
 */
function createSuggestStore(
  fetcher: (input: {
    domainId: string | null
    businessNeed: string
  }) => Promise<{ suggestions: Suggestion[]; emptyReason: string | null; run: LlmRun }>,
  /*
   * How a corrected row is written back, for the one pool that has such a route. Passed in rather
   * than switched on inside, so a step with no writer has no `edit` action at all and the button
   * is withheld by there being no handler — the rule the Library's report acts already keep.
   */
  writer?: (input: {
    metricId: string
    name: string
    definition: string
  }) => Promise<Suggestion>,
) {
  return create<SuggestState>()((set) => ({
    suggestions: [],
    asked: false,
    emptyReason: null,
    suggesting: false,
    run: null,

    suggest: async (input) => {
      set({ suggesting: true })
      try {
        const result = await fetcher(input)
        set({
          suggestions: result.suggestions,
          asked: true,
          emptyReason: result.emptyReason,
          run: result.run,
        })
        return { ok: true }
      } catch (error) {
        return { ok: false, error: toMessage(error) }
      } finally {
        set({ suggesting: false })
      }
    },

    dismiss: (id) =>
      set((state) => ({
        suggestions: state.suggestions.filter((s) => s.id !== id),
      })),

    edit: writer
      ? async ({ id, name, detail }) => {
          try {
            const stored = await writer({ metricId: id, name, definition: detail })
            /*
             * The server's row, not the submitted one. `why` is the reason this suggestion was
             * *drafted* and an edit does not change it, so the route sends it empty and the
             * existing one is kept rather than blanked.
             */
            set((state) => ({
              suggestions: state.suggestions.map((s) =>
                s.id === id ? { ...s, name: stored.name, detail: stored.detail } : s,
              ),
            }))
            return { ok: true }
          } catch (error) {
            return { ok: false, error: toMessage(error) }
          }
        }
      : null,

    reset: () =>
      set({
        suggestions: [],
        asked: false,
        emptyReason: null,
        suggesting: false,
        run: null,
      }),
  }))
}

export const usePersonaSuggestStore = createSuggestStore(suggestPersonas)
/* The one pool with a write route behind it — see `editMetric`. */
export const useMetricSuggestStore = createSuggestStore(suggestMetrics, editMetric)
export const useQuestionSuggestStore = createSuggestStore(suggestQuestions)

interface DerivationState {
  run: DerivationRun | null
  starting: boolean
  error: string | null

  start: (input: {
    name: string
    sources: SourcePick[]
    heroQuestions: HeroQuestion[]
  }) => Promise<Result>
  /** One poll. The page owns the interval, and stops it when the run lands. */
  poll: () => Promise<void>
  reset: () => void
}

/**
 * The derivation between step 6 and step 7. Holds the run rather than the
 * answer, so the page can show what is happening while it happens.
 */
export const useDerivationStore = create<DerivationState>()((set, get) => ({
  run: null,
  starting: false,
  error: null,

  start: async (input) => {
    set({ starting: true, error: null })
    try {
      set({ run: await startDerivation(input) })
      return { ok: true }
    } catch (error) {
      const message = toMessage(error)
      set({ error: message })
      return { ok: false, error: message }
    } finally {
      set({ starting: false })
    }
  },

  poll: async () => {
    const current = get().run
    if (!current || current.status === 'complete') return
    try {
      set({ run: await getDerivation(current.derivationId) })
    } catch (error) {
      // A failed poll leaves the last known state rather than blanking the run.
      set({ error: toMessage(error) })
    }
  },

  reset: () => set({ run: null, starting: false, error: null }),
}))

interface CoverageState {
  data: CoveragePayload | null
  loading: boolean
  error: string | null
  review: (input: {
    name: string
    sources: SourcePick[]
    heroQuestions: HeroQuestion[]
  }) => Promise<Result>
  reset: () => void
}

/**
 * Step 7's review. Derived from the draft on every arrival rather than cached —
 * changing a source pick on step 4 must change what step 7 says it found.
 */
export const useCoverageStore = create<CoverageState>()((set) => ({
  data: null,
  loading: false,
  error: null,

  review: async (input) => {
    set({ loading: true })
    try {
      set({ data: await reviewCoverage(input), error: null, loading: false })
      return { ok: true }
    } catch (error) {
      const message = toMessage(error)
      set({ error: message, loading: false })
      return { ok: false, error: message }
    }
  },

  reset: () => set({ data: null, loading: false, error: null }),
}))

interface UseCasesState {
  data: UseCasesPayload | null
  loading: boolean
  error: string | null
  /** useCaseId of the row whose action is in flight, so only its button spins. */
  pending: string | null
  saving: boolean

  load: () => Promise<void>
  save: (input: {
    useCaseId?: string | null
    name: string
    domainId: string | null
    businessNeed: string
    personas: DraftedItem[]
    metrics: DraftedItem[]
    sources: SourcePick[]
    heroQuestions: HeroQuestion[]
    gapDecisions: GapChoice[]
    step: number
    status?: 'draft' | 'committed'
  }) => Promise<{ ok: true; useCase: GraphUseCase } | { ok: false; error: string }>
  remove: (useCaseId: string) => Promise<Result>
}

const EMPTY: GraphUseCase[] = []

export const useUseCasesStore = create<UseCasesState>()((set, get) => ({
  data: null,
  loading: false,
  error: null,
  pending: null,
  saving: false,

  load: async () => {
    set({ loading: true })
    try {
      set({ data: await listUseCases(), error: null, loading: false })
    } catch (error) {
      set({ error: toMessage(error), loading: false })
    }
  },

  save: async (input) => {
    // The name is what the drafts list shows, so an unnamed draft is unopenable.
    if (!input.name.trim()) {
      return { ok: false, error: 'Give the use case a name before saving it.' }
    }
    set({ saving: true })
    try {
      const useCase = await saveUseCase({ ...input, name: input.name.trim() })
      await get().load()
      return { ok: true, useCase }
    } catch (error) {
      return { ok: false, error: toMessage(error) }
    } finally {
      set({ saving: false })
    }
  },

  remove: async (useCaseId) => {
    set({ pending: useCaseId })
    try {
      await deleteUseCase(useCaseId)
      await get().load()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: toMessage(error) }
    } finally {
      set({ pending: null })
    }
  },
}))

/** Stable empty array so selectors don't churn on every render. */
export const selectUseCases = (s: UseCasesState) => s.data?.useCases ?? EMPTY
