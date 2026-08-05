import { create } from 'zustand'
import {
  deleteUseCase,
  listGraphDomains,
  listUseCases,
  saveUseCase,
  type GraphDomainsPayload,
  type GraphUseCase,
  type UseCasesPayload,
} from '../api/client'
import { createReadStore, toMessage, type Result } from './asyncState'

export type { Result }

/** Step 1's domain options, ranked by what the connected data supports. */
export const useGraphDomainsStore = createReadStore<GraphDomainsPayload>(listGraphDomains)

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
