import { create } from 'zustand'
import {
  deleteUseCase,
  listGraphDomains,
  listGraphSources,
  listUseCases,
  reviewCoverage,
  saveUseCase,
  suggestAnswerFormats,
  suggestKpis,
  suggestPersonas,
  suggestQuestions,
  type AnswerFormat,
  type Citations,
  type CoveragePayload,
  type GapChoice,
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

/** Step 4's sources — what the Data Catalogue has actually profiled. */
export const useGraphSourcesStore =
  createReadStore<GraphSourcesPayload>(listGraphSources)

interface SuggestState {
  suggestions: Suggestion[]
  /** Distinguishes "not asked yet" from "asked, nothing came back". */
  asked: boolean
  suggesting: boolean

  suggest: (input: {
    domainId: string | null
    businessNeed: string
  }) => Promise<Result>
  /** Waving one away is a local act — nothing about it was ever saved. */
  dismiss: (id: string) => void
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
  }) => Promise<{ suggestions: Suggestion[] }>,
) {
  return create<SuggestState>()((set) => ({
    suggestions: [],
    asked: false,
    suggesting: false,

    suggest: async (input) => {
      set({ suggesting: true })
      try {
        const result = await fetcher(input)
        set({ suggestions: result.suggestions, asked: true })
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

    reset: () => set({ suggestions: [], asked: false, suggesting: false }),
  }))
}

export const usePersonaSuggestStore = createSuggestStore(suggestPersonas)
export const useKpiSuggestStore = createSuggestStore(suggestKpis)
export const useQuestionSuggestStore = createSuggestStore(suggestQuestions)

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

/** Step 6's formats. Loaded on arrival rather than asked for — the step offers a
    choice between them, it does not accumulate them. */
export const useAnswerFormatStore = createSuggestStore(suggestAnswerFormats)

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
    kpis: DraftedItem[]
    sources: SourcePick[]
    heroQuestions: HeroQuestion[]
    citations: Citations
    answerFormats: AnswerFormat[]
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
